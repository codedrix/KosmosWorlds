/**
 * jobs.ts -- the jobs, their conversations and their approvals.
 *
 * @kosmos-system  Agent bridge (Mission Control, DB-044)
 * @kosmos-owner   Platform
 *
 * The JobStore is the one thing every face reads and every adapter writes. It
 * holds SUMMARIES only (DB-044 "only summaries leave the PC"):
 *
 *   - the CEO's own messages;
 *   - the agent's reply text, cleaned (sanitize.ts);
 *   - one activity line per tool use ("Read 6 files", "Edited a.ts +84 -3",
 *     "Ran tests: 14 passed"), built from the tool's NAME and INPUT, plus counts
 *     read out of a test run's output; never the output itself, a diff or a
 *     file's contents;
 *   - each approval request: the tool and the exact command, cleaned.
 *
 * Everything else an agent produces stays inside the agent's own session on
 * the PC, where the CEO can open it at the desk (`claude --resume <id>`).
 *
 * Integration points:
 *   - adapters/*.ts write through `JobSink`;
 *   - faces/*\/index.ts read `JobStore` and act through `Actions` (server.ts);
 *   - server.ts waits on `waitForChange` for long polls.
 */

import path from "node:path";
import { cleanUntrusted, toWallAscii } from "./sanitize.js";

/** idle = the agent finished its turn and waits for the CEO's next message. */
export type JobStatus = "starting" | "running" | "waiting" | "idle" | "done" | "failed" | "stopped";
export type EventKind = "user" | "agent" | "activity" | "approval" | "decision" | "notice";
export type Decision = "approve" | "deny" | "why";
export type ApprovalStatus = "pending" | "approved" | "denied" | "asked" | "cancelled";

export interface JobEvent {
  /** Stable id; an event that grows (streamed reply text, a coalesced activity) keeps it. */
  id: number;
  /** Bumped every time the event changes: `events since N` returns everything with seq > N. */
  seq: number;
  at: number;
  kind: EventKind;
  text: string;
  approvalId?: string;
}

export interface Approval {
  id: string;
  jobId: string;
  /** Monotonic across the bridge: the wall buzzes when it rises. */
  number: number;
  tool: string;
  /** What the agent wants, in the bridge's own words ("Run a command"). */
  title: string;
  /** The exact command or target, cleaned. */
  command: string;
  /** False when cleaning changed the command (a secret was redacted): then it can't be approved from the headset. */
  exact: boolean;
  status: ApprovalStatus;
  createdAt: number;
  decidedAt?: number;
}

export interface Job {
  id: string;
  agent: string;
  project: string;
  cwd: string;
  title: string;
  status: JobStatus;
  startedAt: number;
  endedAt?: number;
  /** 0..1 when the agent keeps a to-do list, else undefined. */
  progress?: number;
  files: Set<string>;
  events: JobEvent[];
  sessionId?: string;
  /** Short result line once done ("Done: 3 files changed"). */
  outcome?: string;
}

/** Bytes of reply text kept per agent event; the rest stays in the session on the PC. */
export const MAX_AGENT_EVENT_CHARS = 6000;
/** Raw streamed text kept on the PC per message, so redaction always sees the whole message. */
const MAX_AGENT_RAW_CHARS = MAX_AGENT_EVENT_CHARS * 2;
/** Tools whose approval target is a file path. */
const FILE_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
/** Events kept per job; older ones fall off the wall (the session keeps them). */
export const MAX_EVENTS_PER_JOB = 400;
/** Characters of a command shown in an approval. A longer command can't be approved from the headset. */
export const MAX_APPROVAL_COMMAND_CHARS = 220;

type ApprovalWaiter = (d: Decision) => void;

/** What an adapter calls while a job runs. */
export interface JobSink {
  readonly jobId: string;
  readonly cwd: string;
  agentText(text: string, opts?: { newMessage?: boolean }): void;
  toolUse(id: string, tool: string, input: Record<string, unknown>): void;
  toolResult(id: string, output: string, isError: boolean): void;
  requestApproval(tool: string, input: Record<string, unknown>): Promise<Decision>;
  setStatus(status: JobStatus, outcome?: string): void;
  setSessionId(id: string): void;
  notice(text: string): void;
}

interface PendingTool {
  eventId: number;
  verb: string;
  label: string;
}

let idCounter = 0;
function shortId(prefix: string): string {
  idCounter = (idCounter + 1) % 1296;
  const r = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, "0");
  return `${prefix}${r}${idCounter.toString(36).padStart(2, "0")}`;
}

export class JobStore {
  readonly jobs = new Map<string, Job>();
  readonly approvals = new Map<string, Approval>();
  private waiters = new Map<string, ApprovalWaiter>();
  private seq = 0;
  private eventId = 0;
  private approvalNumber = 0;
  private version = 0;
  private listeners = new Set<() => void>();
  private pendingTools = new Map<string, Map<string, PendingTool>>();
  private lastActivity = new Map<string, { verb: string; eventId: number; count: number }>();
  /** The raw text of the message each job is streaming now (never leaves the PC). */
  private agentRaw = new Map<string, { eventId: number; raw: string }>();

  constructor(private readonly now: () => number = Date.now) {}

  get currentVersion(): number {
    return this.version;
  }

  get approvalsEver(): number {
    return this.approvalNumber;
  }

  private changed(): void {
    this.version++;
    for (const l of [...this.listeners]) l();
  }

  /** Resolves when the store changes after `sinceVersion`, or after `timeoutMs`. */
  waitForChange(sinceVersion: number, timeoutMs: number): Promise<void> {
    if (this.version !== sinceVersion) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.listeners.delete(done);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      this.listeners.add(done);
    });
  }

  /** Wake every long poll now (sign-out, kill). */
  poke(): void {
    this.changed();
  }

  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => a.startedAt - b.startedAt);
  }

  running(): Job[] {
    return this.list().filter((j) => j.status === "starting" || j.status === "running" || j.status === "waiting" || j.status === "idle");
  }

  doneToday(): Job[] {
    const midnight = new Date(this.now());
    midnight.setHours(0, 0, 0, 0);
    return this.list().filter((j) => (j.status === "done" || j.status === "failed" || j.status === "stopped") && (j.endedAt ?? 0) >= midnight.getTime());
  }

  pendingApprovals(): Approval[] {
    return [...this.approvals.values()].filter((a) => a.status === "pending").sort((a, b) => a.number - b.number);
  }

  pendingFor(jobId: string): Approval | undefined {
    return this.pendingApprovals().find((a) => a.jobId === jobId);
  }

  eventsSince(jobId: string, since: number): JobEvent[] {
    const job = this.jobs.get(jobId);
    if (!job) return [];
    return job.events.filter((e) => e.seq > since).sort((a, b) => a.seq - b.seq);
  }

  createJob(o: { agent: string; project: string; cwd: string; title: string; firstMessage?: string }): Job {
    const job: Job = {
      id: shortId("j"),
      agent: o.agent,
      project: o.project,
      cwd: o.cwd,
      title: toWallAscii(o.title).slice(0, 60),
      status: "starting",
      startedAt: this.now(),
      files: new Set(),
      events: [],
    };
    this.jobs.set(job.id, job);
    this.pendingTools.set(job.id, new Map());
    if (o.firstMessage) this.addUserMessage(job.id, o.firstMessage);
    this.changed();
    return job;
  }

  addUserMessage(jobId: string, text: string): void {
    // The CEO's own words are still cleaned: they are shown on a wall and travel the tunnel.
    this.push(jobId, "user", cleanUntrusted(text).slice(0, 2000));
    const job = this.jobs.get(jobId);
    if (job && (job.status === "idle" || job.status === "done" || job.status === "stopped" || job.status === "failed")) {
      job.status = "running";
      job.endedAt = undefined;
    }
    this.lastActivity.delete(jobId);
    this.changed();
  }

  /** Decide an approval. Returns false when it is not pending (already decided, or unknown). */
  decide(approvalId: string, d: Decision): boolean {
    const a = this.approvals.get(approvalId);
    if (!a || a.status !== "pending") return false;
    if (d === "approve" && !a.exact) return false;
    a.status = d === "approve" ? "approved" : d === "deny" ? "denied" : "asked";
    a.decidedAt = this.now();
    const words = d === "approve" ? "You approved" : d === "deny" ? "You denied" : "You asked why";
    this.push(a.jobId, "decision", `${words}: ${a.command.slice(0, 80)}`, a.id);
    const w = this.waiters.get(approvalId);
    this.waiters.delete(approvalId);
    const job = this.jobs.get(a.jobId);
    if (job && job.status === "waiting" && !this.pendingFor(job.id)) job.status = "running";
    this.changed();
    w?.(d);
    return true;
  }

  /** Cancel every pending approval (stop, kill, job end). Each waiting agent is told "deny". */
  cancelApprovals(jobId?: string): void {
    for (const a of this.pendingApprovals()) {
      if (jobId && a.jobId !== jobId) continue;
      a.status = "cancelled";
      a.decidedAt = this.now();
      const w = this.waiters.get(a.id);
      this.waiters.delete(a.id);
      w?.("deny");
    }
    this.changed();
  }

  sink(jobId: string): JobSink {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`no job ${jobId}`);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const store = this;
    return {
      jobId,
      cwd: job.cwd,
      agentText(text, opts) {
        store.agentText(jobId, text, opts?.newMessage ?? false);
      },
      toolUse(id, tool, input) {
        store.toolUse(jobId, id, tool, input);
      },
      toolResult(id, output, isError) {
        store.toolResult(jobId, id, output, isError);
      },
      requestApproval(tool, input) {
        return store.requestApproval(jobId, tool, input);
      },
      setStatus(status, outcome) {
        store.setStatus(jobId, status, outcome);
      },
      setSessionId(id) {
        job.sessionId = id;
        store.changed();
      },
      notice(text) {
        store.push(jobId, "notice", cleanUntrusted(text).slice(0, 300));
        store.changed();
      },
    };
  }

  // -------------------------------------------------------------------------

  private push(jobId: string, kind: EventKind, text: string, approvalId?: string): JobEvent | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;
    if (kind !== "agent") this.flushAgent(jobId);
    const e: JobEvent = { id: ++this.eventId, seq: ++this.seq, at: this.now(), kind, text, approvalId };
    job.events.push(e);
    if (job.events.length > MAX_EVENTS_PER_JOB) job.events.splice(0, job.events.length - MAX_EVENTS_PER_JOB);
    return e;
  }

  private touch(job: JobEvent): void {
    job.seq = ++this.seq;
  }

  /** Show a streaming message (redacted as a whole); returns false when nothing shows yet. */
  private renderAgent(jobId: string, cur: { eventId: number; raw: string }, final: boolean): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    let shown = cur.raw;
    if (!final) {
      const m = /\s(?=\S*$)/.exec(shown);
      shown = m ? shown.slice(0, m.index + 1) : "";
    }
    let text = cleanUntrusted(shown).replace(/^\s+/, "");
    if (text.length > MAX_AGENT_EVENT_CHARS || cur.raw.length >= MAX_AGENT_RAW_CHARS) {
      text = text.slice(0, MAX_AGENT_EVENT_CHARS) + "\n(The rest is in the session on the PC.)";
    }
    if (!text) return false;
    if (cur.eventId) {
      const ev = job.events.find((e) => e.id === cur.eventId);
      if (ev && ev.text !== text) {
        ev.text = text;
        this.touch(ev);
      }
    } else {
      const e = this.push(jobId, "agent", text);
      if (e) cur.eventId = e.id;
    }
    return true;
  }

  /** The message ended: show all of it, redacted, including the held-back last word. */
  private flushAgent(jobId: string): void {
    const cur = this.agentRaw.get(jobId);
    if (!cur) return;
    this.agentRaw.delete(jobId);
    if (this.renderAgent(jobId, cur, true)) this.changed();
  }

  /**
   * Streamed reply text. Redacting each delta on its own would let a key split across deltas
   * through whole, so the raw message stays here on the PC and the shown text is the whole
   * message redacted again on every delta. While a message streams, the trailing partial word
   * is held back (a half-arrived key can't match a pattern yet); it is shown, redacted, once
   * whitespace follows it or the message ends (any other event, or a status change).
   */
  private agentText(jobId: string, delta: string, newMessage: boolean): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    let cur = this.agentRaw.get(jobId);
    if (newMessage || !cur) {
      this.flushAgent(jobId);
      cur = { eventId: 0, raw: "" };
      this.agentRaw.set(jobId, cur);
    }
    if (cur.raw.length < MAX_AGENT_RAW_CHARS) cur.raw = (cur.raw + delta).slice(0, MAX_AGENT_RAW_CHARS);
    if (!this.renderAgent(jobId, cur, false)) return;
    this.lastActivity.delete(jobId);
    if (job.status === "starting" || job.status === "idle") job.status = "running";
    this.changed();
  }

  private toolUse(jobId: string, toolUseId: string, tool: string, input: Record<string, unknown>): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    if (job.status === "starting") job.status = "running";
    const d = describeTool(tool, input, job.cwd);
    if (d.file) job.files.add(d.file);
    if (d.progress !== undefined) job.progress = d.progress;

    // Coalesce runs of the same countable verb: "Read 6 files".
    const prev = this.lastActivity.get(jobId);
    if (d.countable && prev && prev.verb === d.verb) {
      const ev = job.events.find((e) => e.id === prev.eventId);
      if (ev) {
        prev.count++;
        ev.text = `${d.verb} ${prev.count} ${d.countable}`;
        this.touch(ev);
        this.pendingTools.get(jobId)?.set(toolUseId, { eventId: ev.id, verb: d.verb, label: ev.text });
        this.changed();
        return;
      }
    }
    const ev = this.push(jobId, "activity", d.line);
    if (!ev) return;
    this.pendingTools.get(jobId)?.set(toolUseId, { eventId: ev.id, verb: d.verb, label: d.line });
    if (d.countable) this.lastActivity.set(jobId, { verb: d.verb, eventId: ev.id, count: 1 });
    else this.lastActivity.delete(jobId);
    this.changed();
  }

  private toolResult(jobId: string, toolUseId: string, output: string, isError: boolean): void {
    const job = this.jobs.get(jobId);
    const p = this.pendingTools.get(jobId)?.get(toolUseId);
    if (!job || !p) return;
    this.pendingTools.get(jobId)?.delete(toolUseId);
    if (p.verb !== "Ran") return;
    const ev = job.events.find((e) => e.id === p.eventId);
    if (!ev) return;
    // Counts only, never the output.
    const counts = testCounts(output);
    if (counts) ev.text = `${p.label}: ${counts}`;
    else if (isError) ev.text = `${p.label}: failed`;
    else return;
    this.touch(ev);
    this.changed();
  }

  private requestApproval(jobId: string, tool: string, input: Record<string, unknown>): Promise<Decision> {
    const job = this.jobs.get(jobId);
    if (!job) return Promise.resolve("deny");
    const raw = approvalTarget(tool, input, job.cwd);
    // A multi-line command can't be read as one line (a "#" on line 1 hides line 2 from the eye,
    // not from the shell), so it is shown with a visible marker and is never approvable here.
    const multiLine = /[\r\n]/.test(raw);
    const cleaned = cleanUntrusted(raw).replace(/\s*\r?\n\s*/g, " [newline] ");
    // A file change outside the project folder is shown with its whole path and approved at the desk.
    const filePath = str(input.file_path) || str(input.notebook_path);
    const outside = FILE_TOOLS.has(tool) && !insideProject(filePath, job.cwd);
    const exact = !multiLine && !outside && cleaned === raw && cleaned.length <= MAX_APPROVAL_COMMAND_CHARS;
    const a: Approval = {
      id: shortId("a"),
      jobId,
      number: ++this.approvalNumber,
      tool: toWallAscii(tool).slice(0, 40),
      // Always the bridge's own words: never the SDK's rendered sentence, which quotes tool input.
      title: approvalTitle(tool).slice(0, 60),
      command: cleaned.length > MAX_APPROVAL_COMMAND_CHARS ? cleaned.slice(0, MAX_APPROVAL_COMMAND_CHARS - 3) + "..." : cleaned,
      exact,
      status: "pending",
      createdAt: this.now(),
    };
    this.approvals.set(a.id, a);
    job.status = "waiting";
    this.push(jobId, "approval", `${a.title}: ${a.command}`, a.id);
    this.lastActivity.delete(jobId);
    this.changed();
    return new Promise((resolve) => this.waiters.set(a.id, resolve));
  }

  private setStatus(jobId: string, status: JobStatus, outcome?: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    this.flushAgent(jobId);
    job.status = status;
    if (outcome) job.outcome = cleanUntrusted(outcome).slice(0, 80);
    if (status === "done" || status === "failed" || status === "stopped") {
      job.endedAt = this.now();
      if (status === "done") job.progress = 1;
      this.cancelApprovals(jobId);
    }
    this.changed();
  }
}

// ---------------------------------------------------------------------------
// Tool descriptions (names and inputs only)
// ---------------------------------------------------------------------------

interface ToolLine {
  verb: string;
  line: string;
  /** The plural noun when runs of this verb coalesce ("files"). */
  countable?: string;
  file?: string;
  progress?: number;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** True when `p` resolves inside the job's project folder. */
export function insideProject(p: string, cwd: string): boolean {
  if (!p) return false;
  try {
    const r = path.relative(path.resolve(cwd), path.resolve(cwd, p));
    return r === "" || (!r.startsWith("..") && !path.isAbsolute(r));
  } catch {
    return false;
  }
}

/**
 * A path as the wall shows it: relative inside the project, and the WHOLE path outside it, so
 * a write to ~/.ssh/authorized_keys can never pass for a project file of the same name.
 */
function rel(p: string, cwd: string): string {
  if (!p) return "";
  try {
    const full = path.resolve(cwd, p);
    const shown = insideProject(p, cwd) ? path.relative(path.resolve(cwd), full) : full;
    return toWallAscii(shown.replace(/\\/g, "/"));
  } catch {
    return toWallAscii(p.replace(/\\/g, "/"));
  }
}

function lines(s: string): number {
  if (!s) return 0;
  return s.split("\n").length;
}

/** One activity line per tool use. Tool input is untrusted (a planted description, a key in a
 * command), so every line and file name is redacted and defanged on the way out. */
export function describeTool(tool: string, input: Record<string, unknown>, cwd: string): ToolLine {
  const d = describeToolRaw(tool, input, cwd);
  return { ...d, line: cleanUntrusted(d.line), ...(d.file !== undefined ? { file: cleanUntrusted(d.file) } : {}) };
}

function describeToolRaw(tool: string, input: Record<string, unknown>, cwd: string): ToolLine {
  switch (tool) {
    case "Read":
      return { verb: "Read", line: "Read 1 file", countable: "files" };
    case "Grep":
    case "Glob":
      return { verb: "Searched", line: "Searched 1 time", countable: "times" };
    case "Edit": {
      const f = rel(str(input.file_path), cwd);
      return { verb: "Edited", line: `Edited ${f} +${lines(str(input.new_string))} -${lines(str(input.old_string))}`, file: f };
    }
    case "MultiEdit": {
      const f = rel(str(input.file_path), cwd);
      const edits = Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]) : [];
      let add = 0;
      let del = 0;
      for (const e of edits) {
        add += lines(str(e.new_string));
        del += lines(str(e.old_string));
      }
      return { verb: "Edited", line: `Edited ${f} +${add} -${del}`, file: f };
    }
    case "Write": {
      const f = rel(str(input.file_path), cwd);
      return { verb: "Wrote", line: `Wrote ${f} +${lines(str(input.content))}`, file: f };
    }
    case "NotebookEdit": {
      const f = rel(str(input.notebook_path), cwd);
      return { verb: "Edited", line: `Edited ${f}`, file: f };
    }
    case "Bash":
    case "PowerShell": {
      // Redact the whole text before shortening it: cutting first could leave a key's prefix
      // too short to match a pattern, and that prefix would then leave the PC.
      const desc = cleanUntrusted(str(input.description).trim());
      const cmd = cleanUntrusted(str(input.command).trim()).split("\n")[0] ?? "";
      const what = desc || (cmd.length > 48 ? cmd.slice(0, 45) + "..." : cmd);
      const isTest = /\b(test|tests|jest|vitest|pytest|cargo test|go test|npm t\b|node --test)\b/i.test(desc + " " + cmd);
      return { verb: "Ran", line: isTest ? "Ran tests" : `Ran ${toWallAscii(what)}` };
    }
    case "WebFetch":
      return { verb: "Fetched", line: "Read 1 web page", countable: "web pages" };
    case "WebSearch":
      return { verb: "Searched the web", line: "Searched the web 1 time", countable: "times" };
    case "TodoWrite": {
      const todos = Array.isArray(input.todos) ? (input.todos as Record<string, unknown>[]) : [];
      const total = todos.length;
      const done = todos.filter((t) => t.status === "completed").length;
      return { verb: "Planned", line: `Updated the plan: ${done} of ${total} done`, progress: total > 0 ? done / total : undefined };
    }
    case "Task":
    case "Agent":
      return { verb: "Delegated", line: "Started a helper agent", countable: "helper agents" };
    default: {
      const m = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(tool);
      if (m) return { verb: "Used", line: `Used ${toWallAscii(m[2] ?? tool).slice(0, 30)}` };
      return { verb: "Used", line: `Used ${toWallAscii(tool).slice(0, 30)}` };
    }
  }
}

function approvalTitle(tool: string): string {
  switch (tool) {
    case "Bash":
    case "PowerShell":
      return "Run a command";
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
      return "Change a file";
    case "WebFetch":
      return "Open a web page";
    case "WebSearch":
      return "Search the web";
    default:
      return `Use ${tool}`;
  }
}

/** The exact thing the CEO approves: the command, the file, the address. */
export function approvalTarget(tool: string, input: Record<string, unknown>, cwd: string): string {
  switch (tool) {
    case "Bash":
    case "PowerShell":
      return str(input.command).trim();
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
      return rel(str(input.file_path) || str(input.notebook_path), cwd);
    case "WebFetch":
      return str(input.url);
    case "WebSearch":
      return str(input.query);
    default: {
      const compact = JSON.stringify(input);
      return `${tool} ${compact}`;
    }
  }
}

/** "14 passed, 1 failed" out of common test-runner summaries; undefined when none found. */
export function testCounts(output: string): string | undefined {
  const tail = output.slice(-20000);
  const pick = (re: RegExp): number | undefined => {
    let last: number | undefined;
    for (const m of tail.matchAll(re)) last = Number(m[1]);
    return last;
  };
  const passed = pick(/(?:^|[^\w])(\d+) (?:passed|passing)\b/gim) ?? pick(/^# pass (\d+)/gim) ?? pick(/test result: \w+\. (\d+) passed/gim);
  const failed = pick(/(?:^|[^\w])(\d+) (?:failed|failing)\b/gim) ?? pick(/^# fail (\d+)/gim);
  if (passed === undefined && failed === undefined) return undefined;
  const parts: string[] = [];
  if (passed !== undefined) parts.push(`${passed} passed`);
  if (failed !== undefined && failed > 0) parts.push(`${failed} failed`);
  return parts.join(", ") || undefined;
}
