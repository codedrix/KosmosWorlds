/**
 * adapters/types.ts -- what an agent adapter is.
 *
 * @kosmos-system  Agent bridge (Mission Control, DB-043)
 * @kosmos-owner   Platform
 *
 * One adapter per agent product. Claude Code is first (claude.ts); Codex is a
 * later adapter with the same shape. An adapter turns three verbs into its
 * agent's own API and reports back through the job's JobSink. It never sees
 * the network, a token or a face.
 */

import type { JobSink } from "../jobs.js";

export interface StartOptions {
  /** The first message, already chosen by a preset or typed by the CEO. */
  prompt: string;
  /** Resume this agent session instead of starting a new one. */
  resume?: string;
  /** End the job after its first turn (presets). Conversations stay open. */
  oneShot?: boolean;
}

export interface AgentAdapter {
  /** "claude", later "codex". Shown on the wall's agent rail. */
  readonly name: string;
  /** Start the job. Resolves when the agent accepted it (not when it finishes). */
  start(sink: JobSink, opts: StartOptions): Promise<void>;
  /** True while the job's session is open and can take a message. */
  isLive(jobId: string): boolean;
  /** A follow-up message from the CEO, as a prompt. Never a shell command. */
  send(jobId: string, text: string): Promise<void>;
  /** Interrupt the current turn; the session stays resumable at the desk. */
  interrupt(jobId: string): Promise<void>;
  /** End the job for good. */
  stop(jobId: string): Promise<void>;
  /** Stop everything (kill switch, shutdown). */
  stopAll(): Promise<void>;
}
