/**
 * faces/mission-control/index.ts -- the Mission Control wall and its chat.
 *
 * @kosmos-system  Agent bridge (Mission Control, DB-044)
 * @kosmos-owner   Platform
 *
 * Three modes:
 *
 *   lock  signed out (or stopped on the PC): the title, one line and SIGN IN.
 *   wall  the ticker; "Start a job" on the left; "Working now" cards in the
 *         centre (a card waiting on the CEO turns amber); "Needs you" on the
 *         right; "Done today" on the shelf below.
 *   chat  pressing a card, a "Needs you" item or New task turns the centre into
 *         that job's conversation: a slim agent rail on the left, a header with
 *         Stop and Back to wall, the conversation (paged), an inline approval
 *         with the exact command, quick replies and a reply field.
 *
 * SECURITY, BY CONSTRUCTION:
 *   - Agent text appears only in TxConv* lines, behind "Claude:". Every header,
 *     button, card status, approval title and the ticker are the bridge's own
 *     words; an approval shows the agent's REQUEST (tool + exact command), never
 *     its prose.
 *   - A press names a node and the snapshot version the world was showing. The
 *     face looks up what that node meant IN THAT SNAPSHOT, so a press can never
 *     land on something the visitor did not see (an approval that changed, a
 *     card that moved).
 *   - An approval is only approvable from the headset when its whole command is
 *     on the wall and nothing in it was redacted: "you approve what you read".
 */

import type { Job, JobEvent, Approval } from "../../jobs.js";
import { PRESETS, QUICK_REPLIES } from "../../presets.js";
import { clipBytes, clipWidth, estimateWidthM, toWallAscii, wrapWidth, WORLD_TEXT_MAX_BYTES } from "../../sanitize.js";
import { Snapshot, type WorldRequest } from "../../wire.js";
import type { Face, FaceContext, FaceReply } from "../types.js";
import { BUTTON_NODES, CARD_SLOTS, CONV_LEFT_M, CONV_SLOTS, MAX_CHIPS, NEED_SLOTS, RAIL_SLOTS, SHOW_NODES, TEXT_NODES, W } from "./layout.js";

export const WORLD_ADDRESS = "world://mission-control.micknerks";
/** A long poll waits at most this long for a change (the headset gives up at 10 s). */
export const LONG_POLL_MS = 6500;
/** Snapshots kept for press lookups. */
const KEEP_RENDERS = 12;

type Mode = "lock" | "wall" | "chat";

interface ViewState {
  mode: Mode;
  focus?: string;
  /** Pages up from the newest (0 = follow the newest lines). */
  pageBack: number;
  /** Lines in the conversation when the visitor last looked at the newest page. */
  seenLines: number;
  project?: string;
  notice?: string;
  noticeAt?: number;
}

type ActionMap = Map<string, string>;

const PRESET_BUTTONS: Record<string, string> = { BtnTests: "tests", BtnPrs: "prs", BtnToday: "today", BtnNotes: "notes" };
const QUICK_BUTTONS: Record<string, string> = { BtnKeep: "keep", BtnSimple: "simple", BtnSummary: "summary" };

const STATUS_WORD: Record<Job["status"], string> = {
  starting: "STARTING",
  running: "WORKING",
  waiting: "NEEDS YOU",
  idle: "YOUR TURN",
  done: "DONE",
  failed: "FAILED",
  stopped: "STOPPED",
};

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

function hhmm(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Join lines and keep the label inside the host's 128-byte limit. */
function label(lines: string[]): string {
  return clipBytes(lines.join("\n"), WORLD_TEXT_MAX_BYTES);
}

export class MissionControlFace implements Face {
  readonly name = "mission-control";
  readonly worlds = [WORLD_ADDRESS] as const;

  /** How long a view waits for a change before answering "same" (tests shorten it). */
  longPollMs = LONG_POLL_MS;
  private state: ViewState = { mode: "lock", pageBack: 0, seenLines: 0 };
  private version = 0;
  private lastKey = "";
  private renders = new Map<number, ActionMap>();

  reset(): void {
    this.state = { mode: "lock", pageBack: 0, seenLines: 0 };
  }

  async handle(op: string, req: WorldRequest, ctx: FaceContext): Promise<FaceReply> {
    if (op === "view") return this.view(req, ctx);
    if (op === "press") return this.press(req, ctx);
    return { status: 404, body: "unknown op\n" };
  }

  // -------------------------------------------------------------------------
  // view: a long poll
  // -------------------------------------------------------------------------

  private async view(req: WorldRequest, ctx: FaceContext): Promise<FaceReply> {
    let snap = this.render(ctx);
    if (req.v !== undefined && req.v === this.version) {
      // Nothing new for this world yet: wait for a change, then answer once.
      const deadline = Date.now() + this.longPollMs;
      while (Date.now() < deadline) {
        await ctx.waitForChange(Math.max(1, deadline - Date.now()));
        snap = this.render(ctx);
        if (this.version !== req.v) break;
      }
      if (this.version === req.v) return this.reply(new Snapshot().version(this.version).same());
    }
    return this.reply(snap);
  }

  private reply(s: Snapshot): FaceReply {
    return { body: s.toString(), contentType: "text/plain; charset=utf-8" };
  }

  // -------------------------------------------------------------------------
  // press
  // -------------------------------------------------------------------------

  private async press(req: WorldRequest, ctx: FaceContext): Promise<FaceReply> {
    const node = req.press;
    const map = req.v !== undefined ? this.renders.get(req.v) : undefined;
    const action = node && map ? map.get(node) : undefined;
    if (!action) {
      this.note("That changed before your press arrived. Look again.");
      return this.reply(this.render(ctx).event("stale"));
    }

    if (action === "signin") return this.signIn(req, ctx);
    if (!ctx.authed || ctx.killed) {
      this.reset();
      return this.reply(this.render(ctx).event("signed_out"));
    }

    const a = ctx.bridge.actions;
    const [verb, arg, arg2] = action.split(":");
    const text = (req.text ?? "").trim();
    const project = this.project(ctx);
    let result: { ok: boolean; why?: string; job?: Job } = { ok: true };

    switch (verb) {
      case "signout":
        ctx.signOut();
        this.reset();
        return this.reply(this.render(ctx).event("signed_out"));
      case "preset":
        result = await a.startPreset(arg ?? "", project);
        if (result.ok && result.job) this.focus(result.job.id);
        break;
      case "new":
        if (!text) {
          this.note("Nothing typed, so nothing was started.");
          break;
        }
        result = await a.startTask(text, project);
        if (result.ok && result.job) this.focus(result.job.id);
        break;
      case "project": {
        const names = a.projects();
        if (names.length > 0) {
          const i = names.indexOf(project);
          this.state.project = names[(i + 1) % names.length];
        }
        break;
      }
      case "open":
      case "rail":
        this.focus(arg ?? "");
        break;
      case "back":
        this.state.mode = "wall";
        this.state.focus = undefined;
        break;
      case "stop":
        result = await a.stop(arg ?? "");
        break;
      case "approve":
      case "deny":
      case "why":
        result = a.decide(arg ?? "", verb);
        break;
      case "quick":
        result = await a.quick(arg2 ?? "", arg ?? "");
        this.state.pageBack = 0;
        break;
      case "reply":
        if (!text) {
          this.note("Nothing typed, so nothing was sent.");
          break;
        }
        result = await a.send(arg ?? "", text);
        this.state.pageBack = 0;
        break;
      case "pageup":
        this.state.pageBack++;
        break;
      case "pagedown":
        this.state.pageBack = Math.max(0, this.state.pageBack - 1);
        break;
      default:
        result = { ok: false, why: "unknown button" };
    }
    if (!result.ok) this.note(`Not done: ${result.why ?? "refused"}.`);
    const snap = this.render(ctx);
    if (!result.ok) snap.event("refused");
    return this.reply(snap);
  }

  private signIn(req: WorldRequest, ctx: FaceContext): FaceReply {
    const r = ctx.signIn(req.text ?? "");
    if (r.ok) {
      this.state = { mode: "wall", pageBack: 0, seenLines: 0 };
      this.note("Signed in.");
      // The token rides in the reply that follows sign-in; it is never logged.
      const snap = this.renderWith({ ...ctx, authed: true }, true);
      snap.token(r.token);
      return this.reply(snap);
    }
    const why: Record<string, string> = {
      wrong: "That passphrase is wrong.",
      locked: `Too many wrong tries. Wait ${Math.ceil((r.retryAfterS ?? 900) / 60)} minutes.`,
      hard_locked: "Locked after too many wrong tries. Unlock it at the PC: npm run unlock.",
      too_fast: "Too fast. Wait two seconds and try again.",
      not_set: "No passphrase is set. At the PC: npm run set-passphrase.",
    };
    this.note(why[r.reason] ?? "Sign-in refused.");
    return this.reply(this.render(ctx).event("refused"));
  }

  private focus(jobId: string): void {
    this.state.mode = "chat";
    this.state.focus = jobId;
    this.state.pageBack = 0;
  }

  private note(s: string): void {
    this.state.notice = s;
    this.state.noticeAt = Date.now();
  }

  private project(ctx: FaceContext): string {
    const names = ctx.bridge.actions.projects();
    if (this.state.project && names.includes(this.state.project)) return this.state.project;
    return names[0] ?? "";
  }

  // -------------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------------

  /** Render, assigning a new version only when the content changed. */
  private render(ctx: FaceContext): Snapshot {
    return this.renderWith(ctx, false);
  }

  private renderWith(ctx: FaceContext, forceNewVersion: boolean): Snapshot {
    const actions: ActionMap = new Map();
    const body = new Snapshot();
    const live = ctx.authed && !ctx.killed;
    if (!live && this.state.mode !== "lock") this.state = { mode: "lock", pageBack: 0, seenLines: 0, notice: this.state.notice, noticeAt: this.state.noticeAt };
    if (this.state.mode === "chat" && !ctx.bridge.store.jobs.has(this.state.focus ?? "")) this.state.mode = "wall";

    const mode = this.state.mode;
    body.mode(mode);
    if (mode === "lock") this.renderLock(body, actions, ctx);
    else {
      this.renderCommon(body, actions, ctx);
      if (mode === "wall") this.renderWall(body, actions, ctx);
      else this.renderChat(body, actions, ctx);
    }

    const key = body.contentKey();
    if (forceNewVersion || key !== this.lastKey) {
      this.version++;
      this.lastKey = key;
      this.renders.set(this.version, actions);
      for (const v of this.renders.keys()) if (v <= this.version - KEEP_RENDERS) this.renders.delete(v);
    }
    return body.version(this.version);
  }

  private statusLine(ctx: FaceContext, fallback: string): string {
    const n = this.state.notice;
    if (n && Date.now() - (this.state.noticeAt ?? 0) < 20000) return clipWidth(n, W.status);
    return clipWidth(fallback, W.status);
  }

  private renderLock(s: Snapshot, actions: ActionMap, ctx: FaceContext): void {
    for (const n of TEXT_NODES) if (n !== "TxTicker" && n !== "TxStatus" && n !== "TxLock") s.hide(n);
    for (const n of [...BUTTON_NODES, ...SHOW_NODES]) if (n !== "BtnSignIn" && n !== "LockPanel") s.visible(n, false);
    s.visible("LockPanel", true);
    s.copies("ChipDone", 0);
    s.text("TxTicker", "MISSION CONTROL | signed out");
    if (ctx.killed) {
      s.visible("BtnSignIn", false);
      s.text("TxLock", label(["Stopped on the PC.", "At the desk: npm run unkill"]));
      s.text("TxStatus", "The bridge refuses everything until it is restarted.");
      return;
    }
    s.visible("BtnSignIn", true);
    s.prompt("BtnSignIn", "Mission Control passphrase (it shows on screen as you type)");
    actions.set("BtnSignIn", "signin");
    s.text("TxLock", label(["Press SIGN IN and type", "your passphrase."]));
    s.text("TxStatus", this.statusLine(ctx, "Kosmos sends nothing about you; the passphrase is the only key."));
  }

  private renderCommon(s: Snapshot, actions: ActionMap, ctx: FaceContext): void {
    const store = ctx.bridge.store;
    const running = store.running();
    const pending = store.pendingApprovals();
    const done = store.doneToday();
    const now = ctx.bridge.now();

    s.visible("LockPanel", false);
    s.visible("BtnSignIn", false);
    s.hide("TxLock");
    s.buzz(store.approvalsEver);

    // The ticker: the bridge's own words plus counts. Never agent prose.
    const parts = [`${running.length} working`, `${pending.length} need${pending.length === 1 ? "s" : ""} you`, `${done.length} done today`, hhmm(now)];
    s.text("TxTicker", clipWidth(parts.join("  |  "), W.ticker));
    s.text("TxStatus", this.statusLine(ctx, `Signed in  |  ${running.length}/${ctx.bridge.config.maxJobs} jobs  |  Stop at the PC: npm run kill`));
    s.visible("BtnSignOut", true);
    actions.set("BtnSignOut", "signout");

    // Start a job (left).
    const project = this.project(ctx);
    s.text("TxProject", label([clipWidth(`Project: ${project || "none set"}`, W.project)]));
    s.visible("BtnProject", true);
    actions.set("BtnProject", "project");
    for (const [node, id] of Object.entries(PRESET_BUTTONS)) {
      s.visible(node, true);
      actions.set(node, `preset:${id}`);
    }
    s.visible("BtnNewTask", true);
    s.prompt("BtnNewTask", `New task for Claude in ${project || "the default project"}: what should it do?`);
    actions.set("BtnNewTask", "new");

    // Needs you (right).
    NEED_SLOTS.forEach((slot, i) => {
      const a = pending[i];
      const node = `Need${slot}`;
      if (!a) {
        s.visible(node, false);
        s.hide(`TxNeed${slot}`);
        return;
      }
      const job = store.jobs.get(a.jobId);
      s.visible(node, true);
      s.text(`TxNeed${slot}`, label([clipWidth(job?.project ?? "?", W.need), clipWidth(a.title, W.need), clipWidth(a.command, W.need), "Press to open"]));
      actions.set(node, `open:${a.jobId}`);
    });
  }

  private renderWall(s: Snapshot, actions: ActionMap, ctx: FaceContext): void {
    const store = ctx.bridge.store;
    const running = store.running();
    const now = ctx.bridge.now();

    for (const n of ["ChatPanel", "AskPanel", "BtnStop", "BtnBack", "BtnApprove", "BtnDeny", "BtnWhy", "BtnKeep", "BtnSimple", "BtnSummary", "BtnReply", "BtnPageUp", "BtnPageDown"]) s.visible(n, false);
    for (const slot of RAIL_SLOTS) {
      s.visible(`Rail${slot}`, false);
      s.visible(`RailSel${slot}`, false);
      s.hide(`TxRail${slot}`);
    }
    for (const slot of CONV_SLOTS) s.hide(`TxConv${slot}`);
    for (const n of ["TxHeader", "TxPage", "TxAskA", "TxAskB"]) s.hide(n);
    s.visible("WallPanel", true);

    CARD_SLOTS.forEach((slot, i) => {
      const job = running[i];
      const card = `Card${slot}`;
      const show = (n: string, on: boolean) => s.visible(`${n}${slot}`, on);
      if (!job) {
        s.visible(card, false);
        for (const n of ["PillRun", "PillWait", "PillIdle", "Glow", "BarBg", "Bar"]) show(n, false);
        if (i === 0 && running.length === 0) {
          s.visible(card, true);
          s.text(`TxCard${slot}`, label(["Nothing is running.", "Start a job on the left."]));
        } else s.hide(`TxCard${slot}`);
        return;
      }
      const waiting = job.status === "waiting";
      s.visible(card, true);
      show("Glow", waiting);
      show("PillWait", waiting);
      show("PillIdle", job.status === "idle");
      show("PillRun", !waiting && job.status !== "idle");
      const pct = job.progress !== undefined ? `  ${Math.round(job.progress * 100)}%` : "";
      const files = job.files.size;
      s.text(
        `TxCard${slot}`,
        label([
          clipWidth(job.project, W.card),
          clipWidth(job.title, W.card),
          clipWidth(`${STATUS_WORD[job.status]}${pct}  ${formatElapsed(now - job.startedAt)}`, W.card),
          `${files} file${files === 1 ? "" : "s"} touched`,
        ]),
      );
      show("BarBg", job.progress !== undefined);
      show("Bar", job.progress !== undefined && job.progress > 0);
      if (job.progress !== undefined) s.gauge(`Bar${slot}`, Math.max(0.02, job.progress));
      actions.set(card, `open:${job.id}`);
    });

    // Done today (the shelf).
    const done = store.doneToday();
    s.visible("DoneShelf", true);
    s.copies("ChipDone", Math.min(MAX_CHIPS, done.length));
    s.visible("ChipDone", done.length > 0);
    const recent = done.slice(-2).reverse().map((j) => clipWidth(`${j.title} (${j.project})${j.outcome ? ": " + j.outcome : ""}`, W.done));
    s.text("TxDone", label([`Done today: ${done.length}`, ...recent]));
  }

  private renderChat(s: Snapshot, actions: ActionMap, ctx: FaceContext): void {
    const store = ctx.bridge.store;
    const job = store.jobs.get(this.state.focus ?? "") as Job;
    const now = ctx.bridge.now();

    s.visible("WallPanel", false);
    s.visible("DoneShelf", false);
    s.visible("ChipDone", false);
    s.copies("ChipDone", 0);
    s.hide("TxDone");
    for (const slot of CARD_SLOTS) {
      s.visible(`Card${slot}`, false);
      s.hide(`TxCard${slot}`);
      for (const n of ["PillRun", "PillWait", "PillIdle", "Glow", "BarBg", "Bar"]) s.visible(`${n}${slot}`, false);
    }
    s.visible("ChatPanel", true);

    // The rail: the focused job first, then the others still working, then today's.
    const others = store.running().filter((j) => j.id !== job.id);
    const rail = [job, ...others, ...store.doneToday().filter((j) => j.id !== job.id).reverse()].slice(0, RAIL_SLOTS.length);
    RAIL_SLOTS.forEach((slot, i) => {
      const j = rail[i];
      if (!j) {
        s.visible(`Rail${slot}`, false);
        s.visible(`RailSel${slot}`, false);
        s.hide(`TxRail${slot}`);
        return;
      }
      s.visible(`Rail${slot}`, true);
      s.text(`TxRail${slot}`, label([clipWidth(shortProject(j.project), W.rail), clipWidth(STATUS_WORD[j.status], W.rail)]));
      s.visible(`RailSel${slot}`, j.id === job.id);
      actions.set(`Rail${slot}`, `rail:${j.id}`);
    });

    // Header.
    const live = job.status === "running" || job.status === "waiting" || job.status === "starting" || job.status === "idle";
    s.text("TxHeader", label([clipWidth(`${job.title}  |  ${job.project}  |  ${STATUS_WORD[job.status]} ${formatElapsed((job.endedAt ?? now) - job.startedAt)}`, W.header)]));
    s.visible("BtnBack", true);
    actions.set("BtnBack", "back");
    s.visible("BtnStop", live);
    if (live) actions.set("BtnStop", `stop:${job.id}`);

    // The conversation, paged.
    const lines = conversationLines(job.events);
    const per = CONV_SLOTS.length;
    const pages = Math.max(1, Math.ceil(lines.length / per));
    if (this.state.pageBack > pages - 1) this.state.pageBack = pages - 1;
    const end = lines.length - this.state.pageBack * per;
    const start = Math.max(0, end - per);
    const shown = lines.slice(start, end);
    if (this.state.pageBack === 0) this.state.seenLines = lines.length;
    CONV_SLOTS.forEach((slot, i) => {
      const line = shown[i];
      const node = `TxConv${slot}`;
      if (line === undefined || line === "") {
        s.hide(node);
        return;
      }
      s.text(node, line);
      // World text is centred on its anchor; shift it so the line starts at the left edge.
      s.offset(node, CONV_LEFT_M + estimateWidthM(line) / 2);
    });
    const page = pages - this.state.pageBack;
    const newBelow = this.state.pageBack > 0 && lines.length > this.state.seenLines;
    s.text("TxPage", pages > 1 ? `${page}/${pages}${newBelow ? "\nnew" : ""}` : job.status === "running" ? "..." : "");
    s.visible("BtnPageUp", this.state.pageBack < pages - 1);
    s.visible("BtnPageDown", this.state.pageBack > 0);
    actions.set("BtnPageUp", "pageup");
    actions.set("BtnPageDown", "pagedown");

    // The inline approval.
    const a = store.pendingFor(job.id);
    this.renderAsk(s, actions, a);

    // Quick replies and the reply field.
    const canTalk = job.sessionId !== undefined || live;
    for (const [node, id] of Object.entries(QUICK_BUTTONS)) {
      s.visible(node, canTalk && !a);
      if (canTalk && !a) actions.set(node, `quick:${id}:${job.id}`);
    }
    s.visible("BtnReply", canTalk && !a);
    if (canTalk && !a) {
      s.prompt("BtnReply", `Reply to Claude about "${job.title}"`);
      actions.set("BtnReply", `reply:${job.id}`);
    }
  }

  private renderAsk(s: Snapshot, actions: ActionMap, a: Approval | undefined): void {
    if (!a) {
      for (const n of ["AskPanel", "BtnApprove", "BtnDeny", "BtnWhy"]) s.visible(n, false);
      s.hide("TxAskA");
      s.hide("TxAskB");
      return;
    }
    const cmd = wrapWidth(a.command, W.ask);
    const fits = cmd.length <= 3;
    const approvable = a.exact && fits;
    s.visible("AskPanel", true);
    s.text("TxAskA", label([clipWidth(`!! Claude wants to: ${a.title}`, W.ask), ...(fits ? cmd.slice(0, 1) : [])]));
    if (approvable) {
      if (cmd.length > 1) s.text("TxAskB", label(cmd.slice(1, 3)));
      else s.hide("TxAskB");
    }
    else s.text("TxAskB", label([clipWidth(cmd[0] ?? "", W.ask), "Too long or has a secret: approve it at the desk."]));
    s.visible("BtnApprove", approvable);
    if (approvable) actions.set("BtnApprove", `approve:${a.id}`);
    s.visible("BtnDeny", true);
    actions.set("BtnDeny", `deny:${a.id}`);
    s.visible("BtnWhy", true);
    actions.set("BtnWhy", `why:${a.id}`);
  }
}

/** "kosmos-registry" reads "registry" on the slim rail. */
export function shortProject(name: string): string {
  return name.replace(/^kosmos-/i, "");
}

/** The conversation as wall lines: who said it, then what, wrapped by width. */
export function conversationLines(events: JobEvent[]): string[] {
  const out: string[] = [];
  const ordered = [...events].sort((x, y) => x.id - y.id);
  for (const e of ordered) {
    const t = toWallAscii(e.text);
    switch (e.kind) {
      case "user":
        out.push(...wrapWidth(t, W.conv, "You: ", "     "));
        break;
      case "agent":
        out.push(...wrapWidth(t, W.conv, "Claude: ", "  "));
        break;
      case "activity":
        out.push(...wrapWidth(t, W.conv, "   - ", "     "));
        break;
      case "approval":
        out.push(...wrapWidth(t, W.conv, "!! Needs you: ", "     "));
        break;
      case "decision":
        out.push(...wrapWidth(t, W.conv, "   ", "     "));
        break;
      case "notice":
        out.push(...wrapWidth(t, W.conv, "   (", "     ").map((l, i, arr) => (i === arr.length - 1 ? `${l})` : l)));
        break;
    }
  }
  return out.map((l) => clipBytes(l, WORLD_TEXT_MAX_BYTES));
}

const face = new MissionControlFace();
export default face;

// For tests and the README's numbers.
export const _internals = { PRESETS, QUICK_REPLIES };
