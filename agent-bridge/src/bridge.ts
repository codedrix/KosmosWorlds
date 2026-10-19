/**
 * bridge.ts -- the core: jobs, adapters, sign-in and the kill switch, wired together.
 *
 * @kosmos-system  Agent bridge (Mission Control, DB-044)
 * @kosmos-owner   Platform
 *
 * Faces act ONLY through `Actions`, a fixed list of verbs. That list is the
 * allowlist DB-044 promises: start a preset, start a typed task, send a
 * message, use a quick reply, decide an approval, stop a job. There is no verb
 * that runs text as a command.
 */

import fs from "node:fs";
import { AuthGate } from "./auth.js";
import { WatchGate } from "./watch.js";
import { Pairing } from "./pairing.js";
import { type BridgeConfig, verifyPassphrase } from "./config.js";
import { type Decision, type Job, JobStore } from "./jobs.js";
import { isKilled } from "./killswitch.js";
import { MAX_TYPED_CHARS, PRESETS, QUICK_REPLIES, newTaskPrompt } from "./presets.js";
import type { AgentAdapter } from "./adapters/types.js";

export type ActionResult = { ok: true; job?: Job } | { ok: false; why: string };

export interface Actions {
  projects(): string[];
  startPreset(presetId: string, project: string): Promise<ActionResult>;
  startTask(text: string, project: string): Promise<ActionResult>;
  send(jobId: string, text: string): Promise<ActionResult>;
  quick(jobId: string, quickId: string): Promise<ActionResult>;
  decide(approvalId: string, d: Decision): ActionResult;
  stop(jobId: string): Promise<ActionResult>;
}

export class Bridge {
  readonly store: JobStore;
  readonly auth: AuthGate;
  /** Group watching (off until the owner turns it on from the panel). */
  readonly watch: WatchGate;
  /** The Pairing Seal (v2). Approved only at the PC; see pairing.ts. */
  readonly pairing: Pairing;
  private stopping = false;

  constructor(
    readonly config: BridgeConfig,
    private readonly adapter: AgentAdapter,
    readonly now: () => number = Date.now,
  ) {
    this.store = new JobStore(now);
    this.auth = new AuthGate((p) => verifyPassphrase(p, this.config.passphrase), () => !!this.config.passphrase, now);
    this.watch = new WatchGate(now);
    this.pairing = new Pairing(now, () => this.store.poke());
  }

  get killed(): boolean {
    return isKilled();
  }

  /** The kill switch was found on: end the sign-in and any pairing, deny every approval, stop every job. */
  async enforceKill(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    try {
      this.auth.signOut();
      this.watch.close();
      this.pairing.clear();
      this.store.cancelApprovals();
      await this.adapter.stopAll();
      this.store.poke();
    } finally {
      this.stopping = false;
    }
  }

  private projectPath(name: string): string | undefined {
    const p = this.config.projects.find((x) => x.name === name);
    if (!p) return undefined;
    return fs.existsSync(p.path) ? p.path : undefined;
  }

  private capacity(): string | undefined {
    if (this.store.running().length >= this.config.maxJobs) return `Four jobs are running. Stop one first.`;
    return undefined;
  }

  readonly actions: Actions = {
    projects: () => this.config.projects.map((p) => p.name),

    startPreset: async (presetId, project) => {
      if (this.killed) return { ok: false, why: "stopped on the PC" };
      const preset = PRESETS.find((p) => p.id === presetId);
      if (!preset) return { ok: false, why: "unknown preset" };
      const cwd = this.projectPath(project);
      if (!cwd) return { ok: false, why: "that project folder is not set up on the PC" };
      const full = this.capacity();
      if (full) return { ok: false, why: full };
      const job = this.store.createJob({ agent: this.adapter.name, project, cwd, title: preset.title, firstMessage: preset.label });
      await this.adapter.start(this.store.sink(job.id), { prompt: preset.prompt, oneShot: true });
      return { ok: true, job };
    },

    startTask: async (text, project) => {
      if (this.killed) return { ok: false, why: "stopped on the PC" };
      const t = text.trim().slice(0, MAX_TYPED_CHARS);
      if (!t) return { ok: false, why: "nothing typed" };
      const cwd = this.projectPath(project);
      if (!cwd) return { ok: false, why: "that project folder is not set up on the PC" };
      const full = this.capacity();
      if (full) return { ok: false, why: full };
      const title = t.split(/\s+/).slice(0, 6).join(" ");
      const job = this.store.createJob({ agent: this.adapter.name, project, cwd, title, firstMessage: t });
      await this.adapter.start(this.store.sink(job.id), { prompt: newTaskPrompt(t) });
      return { ok: true, job };
    },

    send: async (jobId, text) => {
      if (this.killed) return { ok: false, why: "stopped on the PC" };
      const job = this.store.jobs.get(jobId);
      if (!job) return { ok: false, why: "no such job" };
      const t = text.trim().slice(0, MAX_TYPED_CHARS);
      if (!t) return { ok: false, why: "nothing typed" };
      this.store.addUserMessage(jobId, t);
      if (this.adapter.isLive(jobId)) {
        await this.adapter.send(jobId, t);
      } else if (job.sessionId) {
        // A finished job picks up where it left off: same session, same folder.
        await this.adapter.start(this.store.sink(jobId), { prompt: t, resume: job.sessionId });
      } else {
        return { ok: false, why: "this job can't take messages" };
      }
      return { ok: true, job };
    },

    quick: async (jobId, quickId) => {
      const q = QUICK_REPLIES.find((x) => x.id === quickId);
      if (!q) return { ok: false, why: "unknown quick reply" };
      if (q.interruptFirst && this.adapter.isLive(jobId)) {
        this.store.cancelApprovals(jobId);
        await this.adapter.interrupt(jobId);
      }
      return this.actions.send(jobId, q.text);
    },

    decide: (approvalId, d) => {
      if (this.killed) return { ok: false, why: "stopped on the PC" };
      const a = this.store.approvals.get(approvalId);
      if (!a) return { ok: false, why: "no such approval" };
      if (a.status !== "pending") return { ok: false, why: "already answered" };
      if (d === "approve" && !a.exact) return { ok: false, why: "approve this one at the desk" };
      return this.store.decide(approvalId, d) ? { ok: true } : { ok: false, why: "already answered" };
    },

    stop: async (jobId) => {
      const job = this.store.jobs.get(jobId);
      if (!job) return { ok: false, why: "no such job" };
      this.store.cancelApprovals(jobId);
      if (this.adapter.isLive(jobId)) await this.adapter.stop(jobId);
      else if (job.status !== "done" && job.status !== "failed" && job.status !== "stopped") this.store.sink(jobId).setStatus("stopped", "Stopped from the headset");
      return { ok: true, job };
    },
  };

  async shutdown(): Promise<void> {
    this.store.cancelApprovals();
    await this.adapter.stopAll();
  }
}
