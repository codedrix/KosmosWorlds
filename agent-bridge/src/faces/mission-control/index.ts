/**
 * faces/mission-control/index.ts -- Mission Control v2: the Pairing Seal, Job Cubes, the decision
 * puck and the three-panel arc.
 *
 * @kosmos-system  Agent bridge (Mission Control, DB-044 v2)
 * @kosmos-owner   Platform
 *
 * The contract is mission-control/V2_CONTRACT.md. Modes (`M`):
 *
 *   lock   anonymous: nothing of the owner's is shown; the seal waits on the throne.
 *   pair   a pairing is waiting: the ring shows its code (only to the headset holding the id).
 *   cubes  signed in, arc folded: the ledge holds one cube per running job (calm / needs you /
 *          idle) and a "+" cube; the puck on the left armrest shows the oldest pending approval.
 *   arc    signed in, arc open (v2.1, V2_CONTRACT section 8): left = jobs only (ticker, rail,
 *          done today); centre = one job's conversation (header, 10 lines or 5 above the ask
 *          plate, quick replies, reply, fold, stop, status), or with no job open the start-a-job
 *          set (presets, New task, project); the chrome bar = group watch and sign-out; right =
 *          the page spot only (DB-043, a placeholder). The ledge and the puck stay. Sign out
 *          lives on the chrome bar, so it is offered unfolded only; folded, the owner leaves with
 *          Close on the ledge (a world node, V2_CONTRACT 8.7).
 *
 * Ops: `view` (long poll), `press`, `signin` (the passphrase fallback), `watch` (a group member's
 * read-only arc) and `pair` (mint, then a long poll on the pairing id).
 *
 * SECURITY, BY CONSTRUCTION:
 *   - Agent text appears only on TxConv* lines, behind "Claude:". Every header, button, cube label,
 *     puck label, approval title and the ticker are the bridge's own words; an approval shows the
 *     agent's REQUEST (tool + exact command, cleaned by jobs.ts), never its prose. Everything an
 *     agent or a tool wrote was redacted and defanged when it entered the store (jobs.ts).
 *   - A press names a node and the snapshot version the world was showing. The face looks up what
 *     that node meant IN THAT SNAPSHOT, so a press can never land on something the visitor did not
 *     see. Anonymous callers have their own version space and press map.
 *   - An approval is approvable from the headset (the ask plate or the puck) only when its whole
 *     command is on show and nothing in it was redacted: "you approve what you read".
 *   - The pairing code appears only in answers to the `pair` op, for the holder of its id. No op
 *     approves a pairing (ctx.pair has no such verb).
 *   - Colour is chosen in ONE function, `paint`; text and visibility in the render functions.
 */

import type { Job, JobEvent, Approval } from "../../jobs.js";
import { PRESETS, QUICK_REPLIES } from "../../presets.js";
import { formatPairCode } from "../../pairing.js";
import { clipBytes, clipWidth, estimateWidthM, toWallAscii, wrapWidth, WORLD_TEXT_MAX_BYTES } from "../../sanitize.js";
import { Snapshot, type HueState, type WorldRequest } from "../../wire.js";
import type { Face, FaceContext, FaceReply } from "../types.js";
import {
  ARC_BUTTON_NODES,
  ARC_TEXT_NODES,
  BUTTON_NODES,
  CONV_LEFT_M,
  CONV_SLOTS,
  CONV_ABOVE_ASK,
  CUBE_SLOTS,
  HUE_NODES,
  RAIL_SLOTS,
  SHOW_NODES,
  TEXT_NODES,
  W,
} from "./layout.js";

export const WORLD_ADDRESS = "world://lobby.micknerks";
/** A long poll waits at most this long for a change (the headset gives up at 10 s). */
export const LONG_POLL_MS = 6500;
/** Snapshots kept for press lookups. */
const KEEP_RENDERS = 12;
/** A notice stays on the status line this long. */
const NOTICE_MS = 20000;

type OwnerMode = "cubes" | "arc";

interface ViewState {
  mode: OwnerMode;
  focus?: string;
  /** Pages up from the newest (0 = follow the newest lines). */
  pageBack: number;
  /** Lines in the conversation when the visitor last looked at the newest page. */
  seenLines: number;
  /** Lines a page held last time (10, or 5 above the ask plate), so paging survives the change. */
  per?: number;
  /** The index after the last line on show last time. */
  lastEnd?: number;
  project?: string;
  notice?: string;
  noticeAt?: number;
}

interface Paging {
  pageBack: number;
  seenLines: number;
  per?: number;
  lastEnd?: number;
}

type ActionMap = Map<string, string>;

const PRESET_BUTTONS: Record<string, string> = { BtnTests: "tests", BtnPrs: "prs", BtnToday: "today", BtnNotes: "notes" };
const QUICK_BUTTONS: Record<string, string> = { BtnKeep: "keep", BtnSimple: "simple", BtnSummary: "summary" };
const HUE_BASES = Object.keys(HUE_NODES);

const STATUS_WORD: Record<Job["status"], string> = {
  starting: "STARTING",
  running: "WORKING",
  waiting: "NEEDS YOU",
  idle: "YOUR TURN",
  done: "DONE",
  failed: "FAILED",
  stopped: "STOPPED",
};

const SEAL_HINT = ["At the PC, type this code", "to approve. It lasts 2 minutes."];
const PASSPHRASE_QUESTION = "Mission Control passphrase (it shows on screen as you type)";

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

/** True when the label holds these lines whole (no byte clip). */
function fitsLabel(lines: string[]): boolean {
  const joined = lines.join("\n");
  return label(lines) === joined;
}

/** The same characters, ignoring the whitespace wrapping may move or drop. */
function sameNonSpace(a: string, b: string): boolean {
  return a.replace(/\s+/g, "") === b.replace(/\s+/g, "");
}

/** Wrap each paragraph to `maxM` metres. */
function wrapAll(paras: string[], maxM: number): string[] {
  return paras.flatMap((p) => wrapWidth(p, maxM));
}

// ---------------------------------------------------------------------------
// Colour: the ONE place a state becomes a colour state (DB-045 replaces only the world's side).
// ---------------------------------------------------------------------------

export type Paint =
  | { kind: "job"; job: Job; needsYou: boolean }
  | { kind: "empty" }
  | { kind: "puck"; pending: boolean }
  | { kind: "seal"; stage: "waiting" | "locked" | "closed" };

export function paint(s: Snapshot, node: string, p: Paint): void {
  let state: HueState;
  switch (p.kind) {
    case "job":
      state = p.needsYou ? "need" : p.job.status === "idle" ? "idle" : "calm";
      break;
    case "empty":
      state = "off";
      break;
    case "puck":
      state = p.pending ? "need" : "calm";
      break;
    case "seal":
      state = p.stage === "waiting" ? "armed" : p.stage === "locked" ? "locked" : "off";
      break;
  }
  const allowed = HUE_NODES[node];
  if (!allowed || (state !== "off" && !allowed.includes(state))) throw new Error(`no ${state} variant for ${node}`);
  s.hue(node, state);
}

export class MissionControlFace implements Face {
  readonly name = "mission-control";
  readonly worlds = [WORLD_ADDRESS] as const;

  /** How long a view waits for a change before answering "same" (tests shorten it). */
  longPollMs = LONG_POLL_MS;
  private state: ViewState = { mode: "cubes", pageBack: 0, seenLines: 0 };
  private version = 0;
  private lastKey = "";
  private renders = new Map<number, ActionMap>();
  /** Which job each cube holds: a cube keeps its job while the job lives (V2_CONTRACT 8.10). */
  private cubeJobs: (string | undefined)[] = CUBE_SLOTS.map(() => undefined);

  reset(): void {
    this.state = { mode: "cubes", pageBack: 0, seenLines: 0 };
    this.cubeJobs = CUBE_SLOTS.map(() => undefined);
  }

  async handle(op: string, req: WorldRequest, ctx: FaceContext): Promise<FaceReply> {
    if (op === "view") return this.view(req, ctx);
    if (op === "press") return this.press(req, ctx);
    // The passphrase fallback ("Use passphrase" under the ring): the passphrase as the text.
    if (op === "signin") return this.signIn(req, ctx);
    if (op === "watch") return this.watchView(req, ctx);
    if (op === "pair") return this.pair(req, ctx);
    return { status: 404, body: "unknown op\n" };
  }

  // -------------------------------------------------------------------------
  // pair: the Pairing Seal (anonymous; approval happens only at the PC)
  // -------------------------------------------------------------------------

  private async pair(req: WorldRequest, ctx: FaceContext): Promise<FaceReply> {
    if (!req.pair) {
      const m = ctx.pair.mint();
      if (!m.ok) {
        const why: Record<string, string> = {
          rate: "Too many pairings just now. Wait a few seconds, then press the seal again.",
          stopped: "Stopped on the PC. At the desk: npm run unkill",
          off: "Pairing is off on the PC.",
        };
        return this.reply(this.renderPairEnd(ctx, why[m.reason] ?? "Refused.").event("pair_refused"));
      }
      return this.reply(this.renderSeal(ctx, m.code, m.id).event("pair_wait"));
    }
    let st = ctx.pair.state(req.pair);
    if (st.state === "pending") {
      // A long poll: answer when the owner approves at the PC, or the code expires, or after the wait.
      const deadline = Math.min(Date.now() + this.longPollMs, st.expiresAt + 50);
      while (Date.now() < deadline) {
        await ctx.waitForChange(Math.max(1, deadline - Date.now()));
        st = ctx.pair.state(req.pair);
        if (st.state !== "pending") break;
      }
    }
    if (st.state === "approved") {
      const r = ctx.pair.signIn(req.pair);
      if (r.ok) return this.paired(ctx, r.token);
      st = { state: "expired" };
    }
    if (st.state === "pending") return this.reply(this.renderSeal(ctx, st.code).event("pair_wait"));
    if (ctx.killed) return this.reply(this.renderPairEnd(ctx, "Stopped on the PC. At the desk: npm run unkill").event("pair_refused"));
    return this.reply(this.renderPairEnd(ctx, "That code expired. Press the seal for a new one.").event("pair_expired"));
  }

  /** The approved pairing's answer: K, E paired, the ring locked, then the owner's cubes. */
  private paired(ctx: FaceContext, token: string): FaceReply {
    this.state = { mode: "cubes", pageBack: 0, seenLines: 0 };
    this.anonNotice = null;
    this.note("Signed in at the seal.");
    const body = this.renderWith({ ...ctx, authed: true }, true);
    const out = new Snapshot().version(body.versionNumber).token(token).event("paired");
    paint(out, "SealRing", { kind: "seal", stage: "locked" });
    // The token rides in this one reply; it is never logged.
    return this.reply(out.extend(body));
  }

  // -------------------------------------------------------------------------
  // watch: a group member's read-only copy of the owner's arc
  // -------------------------------------------------------------------------

  private watchVersion = 0;
  private watchKey = "";
  private lastPress: { node: string; at: number } | null = null;

  private async watchView(req: WorldRequest, ctx: FaceContext): Promise<FaceReply> {
    const verdict = ctx.killed || !ctx.bridge.auth.signedIn ? "off" : ctx.bridge.watch.check(req.fields.watch);
    if (verdict === "too_many") {
      // Someone is guessing codes. That must not end a real watcher's view: answer "nothing new"
      // (no watch_refused, so the headset keeps polling) and let the guesser wait out the minute.
      return this.reply(new Snapshot().version(req.v ?? 0).event("watch_wait").same());
    }
    if (verdict !== "ok") {
      const why: Record<string, string> = {
        wrong: "That watch code is wrong.",
        off: "Nobody is sharing Mission Control right now.",
        owner_gone: "The owner has left Mission Control.",
        too_many: "Too many wrong codes. Wait a minute.",
      };
      const s = new Snapshot().version(0).mode("lock");
      s.text("TxStatus", why[verdict] ?? "Refused.");
      return this.reply(s.event("watch_refused"));
    }
    let snap = this.renderWatcher(ctx);
    if (req.v !== undefined && req.v === this.watchVersion) {
      const deadline = Date.now() + this.longPollMs;
      while (Date.now() < deadline) {
        await ctx.waitForChange(Math.max(1, deadline - Date.now()));
        snap = this.renderWatcher(ctx);
        if (this.watchVersion !== req.v) break;
      }
      if (this.watchVersion === req.v) return this.reply(new Snapshot().version(this.watchVersion).same());
    }
    return this.reply(snap);
  }

  /**
   * The arc as the owner would see it, always open (focus = the owner's focus, or the first running
   * job), minus anything that acts: no ledge, puck or seal records, no prompts, no token, no
   * fold, watch or sign-out buttons. It never reads or changes the owner's press maps or paging.
   */
  private renderWatcher(ctx: FaceContext): Snapshot {
    const store = ctx.bridge.store;
    const ownerFocus = this.state.focus && store.jobs.has(this.state.focus) ? this.state.focus : undefined;
    const focusId = ownerFocus ?? store.running()[0]?.id;
    const job = focusId ? store.jobs.get(focusId) : undefined;
    const paging: Paging = focusId === ownerFocus ? { pageBack: this.state.pageBack, seenLines: this.state.seenLines, per: this.state.per, lastEnd: this.state.lastEnd } : { pageBack: 0, seenLines: 0 };
    const body = new Snapshot().mode("arc");
    this.renderArc(body, new Map(), ctx, job, paging, "");
    body.dropPrompts();
    // Overrides replace the owner's records, so the owner's watch line (with its code) never reaches a watcher.
    // A watcher is drawn no action button (V2_CONTRACT 8.10): every arc button but the rail's
    // rows is hidden, and the start-a-job set's project line with them.
    for (const n of [...WATCHER_HIDDEN, "TxProject", "TxWatch", "TxStatus"]) body.forget(n);
    for (const n of WATCHER_HIDDEN) body.visible(n, false);
    body.hide("TxProject");
    const pressed = this.lastPress ? [clipWidth(`pressed: ${pressLabel(this.lastPress.node)} ${formatElapsed(Date.now() - this.lastPress.at)} ago`, W.status)] : [];
    body.text("TxWatch", clipWidth("read-only", W.watch));
    body.text("TxStatus", label([clipWidth("Watching Mission Control", W.status), ...pressed]));
    const key = body.contentKey();
    if (key !== this.watchKey) {
      this.watchVersion++;
      this.watchKey = key;
    }
    return body.version(this.watchVersion);
  }

  // -------------------------------------------------------------------------
  // view: a long poll
  // -------------------------------------------------------------------------

  private async view(req: WorldRequest, ctx: FaceContext): Promise<FaceReply> {
    // The owner is in Mission Control: watch codes stay alive only while this keeps happening.
    if (ctx.authed) ctx.bridge.watch.ownerSeen();
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
    const live = ctx.authed && !ctx.killed;
    // Anonymous callers and the owner have separate snapshots, versions and press maps,
    // so nothing an anonymous caller sends can touch the owner's view.
    const maps = live ? this.renders : this.anonRenders;
    const map = req.v !== undefined ? maps.get(req.v) : undefined;
    const action = node && map ? map.get(node) : undefined;
    if (!action) {
      if (live) this.note("That changed before your press arrived. Look again.");
      return this.reply(this.render(ctx).event("stale"));
    }

    if (action === "signin") return this.signIn(req, ctx);
    if (!live) return this.reply(this.render(ctx).event("signed_out"));

    const a = ctx.bridge.actions;
    const store = ctx.bridge.store;
    const [verb, arg, arg2] = action.split(":");
    if (node) this.lastPress = { node, at: Date.now() };
    const text = (req.text ?? "").trim();
    const project = this.project(ctx);
    let result: { ok: boolean; why?: string; job?: Job } = { ok: true };

    switch (verb) {
      case "signout":
        ctx.signOut();
        this.reset();
        return this.reply(this.render({ ...ctx, authed: false }).event("signed_out"));
      case "cube":
        this.state.mode = "arc";
        this.state.focus = arg && arg !== "none" && store.jobs.has(arg) ? arg : undefined;
        this.state.pageBack = 0;
        break;
      case "fold":
        this.state.mode = "cubes";
        break;
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
      case "rail":
        this.focus(arg ?? "");
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
      case "watch":
        if (ctx.bridge.watch.current) {
          ctx.bridge.watch.close();
          this.note("Group watching is off.");
        } else {
          ctx.bridge.watch.open();
          this.note("Share the watch code with your group; they type it at the Watch button.");
        }
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
    // Navigation changes only this face's state, not the jobs: wake waiting long polls so a
    // watcher's copy follows the owner at once instead of up to 6.5 s later.
    ctx.bridge.store.poke();
    return this.reply(snap);
  }

  /** The passphrase fallback. Refused with `passphrase_off` when the PC turned it off. */
  private signIn(req: WorldRequest, ctx: FaceContext): FaceReply {
    const r = ctx.signIn(req.text ?? "");
    if (r.ok) {
      this.state = { mode: "cubes", pageBack: 0, seenLines: 0 };
      this.anonNotice = null;
      this.note("Signed in.");
      // The token rides in the reply that follows sign-in; it is never logged.
      const snap = this.renderWith({ ...ctx, authed: true }, true);
      snap.token(r.token);
      return this.reply(snap);
    }
    const why: Record<string, string> = {
      wrong: "That passphrase is wrong.",
      locked: ctx.killed ? "Stopped on the PC. At the desk: npm run unkill" : `Too many wrong tries. Wait ${Math.ceil((r.retryAfterS ?? 900) / 60)} minutes.`,
      hard_locked: "Locked after too many wrong tries. Unlock it at the PC: npm run unlock.",
      too_fast: "Too fast. Wait two seconds and try again.",
      not_set: "No passphrase is set. At the PC: npm run set-passphrase.",
      off: "Passphrase sign-in is off. Approve the ring's code at the PC.",
    };
    const text = why[r.reason] ?? "Sign-in refused.";
    const event = r.reason === "off" ? "passphrase_off" : "refused";
    // Typed from the raised seal while a pairing waits: keep showing its code, with the reason.
    const st = req.pair ? ctx.pair.state(req.pair) : undefined;
    if (st && st.state === "pending") return this.reply(this.renderSeal(ctx, st.code, undefined, text).event(event));
    this.anonNotice = { text, at: Date.now() };
    return this.reply(this.render(ctx).event(event));
  }

  private focus(jobId: string): void {
    this.state.mode = "arc";
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

  // Anonymous callers (signed out, pairing, or the bridge stopped) get renders from their own
  // version space and press map. They never read or write the owner's view state.
  private anonVersion = 1_000_000;
  private anonKey = "";
  private anonRenders = new Map<number, ActionMap>();
  private anonNotice: { text: string; at: number } | null = null;

  private versionAnon(body: Snapshot, actions: ActionMap): Snapshot {
    const key = body.contentKey();
    if (key !== this.anonKey) {
      this.anonVersion++;
      this.anonKey = key;
      this.anonRenders.set(this.anonVersion, actions);
      for (const v of this.anonRenders.keys()) if (v <= this.anonVersion - KEEP_RENDERS) this.anonRenders.delete(v);
    }
    return body.version(this.anonVersion);
  }

  /** "Use passphrase" under the ring: shown only while the passphrase fallback is on. */
  private sealTypeButton(s: Snapshot, actions: ActionMap, ctx: FaceContext): void {
    const on = ctx.bridge.config.passphraseSignIn && !ctx.killed;
    s.visible("BtnSealType", on);
    if (!on) return;
    s.prompt("BtnSealType", PASSPHRASE_QUESTION);
    actions.set("BtnSealType", "signin");
  }

  /**
   * lock: everything of the owner's is cleared (every text hidden, every button and panel hidden,
   * every hue off). Only a notice (a refused sign-in, the stop) may show, under the seal.
   */
  private renderAnon(ctx: FaceContext): Snapshot {
    const actions: ActionMap = new Map();
    const s = new Snapshot().mode("lock");
    for (const n of TEXT_NODES) if (n !== "TxSealHint") s.hide(n);
    for (const n of [...BUTTON_NODES, ...SHOW_NODES]) if (n !== "BtnSealType") s.visible(n, false);
    for (const n of HUE_BASES) paint(s, n, { kind: "empty" });
    const n = this.anonNotice;
    if (ctx.killed) s.text("TxSealHint", label(wrapAll(["Stopped on the PC.", "At the desk: npm run unkill"], W.sealHint)));
    else if (n && Date.now() - n.at < NOTICE_MS) s.text("TxSealHint", label(wrapWidth(n.text, W.sealHint)));
    else s.hide("TxSealHint");
    this.sealTypeButton(s, actions, ctx);
    return this.versionAnon(s, actions);
  }

  /** pair: the raised ring with its code, for the holder of the pairing id only. */
  private renderSeal(ctx: FaceContext, code: string, id?: string, hint?: string): Snapshot {
    const actions: ActionMap = new Map();
    const s = new Snapshot().mode("pair");
    if (id) s.pairId(id);
    s.text("TxSeal", clipWidth(formatPairCode(code), W.seal));
    s.text("TxSealHint", label(hint ? wrapWidth(hint, W.sealHint) : wrapAll(SEAL_HINT, W.sealHint)));
    paint(s, "SealRing", { kind: "seal", stage: "waiting" });
    this.sealTypeButton(s, actions, ctx);
    return this.versionAnon(s, actions);
  }

  /** A pairing that ended without a sign-in (expired, refused): the code is gone, the reason shows. */
  private renderPairEnd(ctx: FaceContext, why: string): Snapshot {
    const actions: ActionMap = new Map();
    const s = new Snapshot().mode("lock");
    s.hide("TxSeal");
    s.text("TxSealHint", label(wrapWidth(why, W.sealHint)));
    paint(s, "SealRing", { kind: "seal", stage: "closed" });
    this.sealTypeButton(s, actions, ctx);
    return this.versionAnon(s, actions);
  }

  private renderWith(ctx: FaceContext, forceNewVersion: boolean): Snapshot {
    const live = ctx.authed && !ctx.killed;
    if (!live) return this.renderAnon(ctx);
    const store = ctx.bridge.store;
    const actions: ActionMap = new Map();
    const body = new Snapshot();
    if (this.state.focus && !store.jobs.has(this.state.focus)) this.state.focus = undefined;

    const mode = this.state.mode;
    body.mode(mode);
    body.buzz(store.approvalsEver);
    this.renderLedge(body, actions, ctx);
    this.renderPuck(body, actions, ctx);
    if (mode === "arc") {
      const job = this.state.focus ? store.jobs.get(this.state.focus) : undefined;
      this.renderArc(body, actions, ctx, job, this.state, this.statusLine(ctx));
    } else {
      // Folded: the arc's words leave the world at once. Its buttons keep their last U record so
      // the world can fold them away; the press map below no longer knows them.
      for (const n of ARC_TEXT_NODES) body.hide(n);
    }

    // The key holds what every press means too (the oldest pending approval's id among them), so
    // two renders that read the same but act differently never share a version (V2_CONTRACT 8.10).
    const key = `${body.contentKey()}\n#${[...actions].map(([n, a]) => `${n}=${a}`).join(" ")}`;
    if (forceNewVersion || key !== this.lastKey) {
      this.version++;
      this.lastKey = key;
      this.renders.set(this.version, actions);
      for (const v of this.renders.keys()) if (v <= this.version - KEEP_RENDERS) this.renders.delete(v);
    }
    return body.version(this.version);
  }

  private statusLine(ctx: FaceContext): string {
    const n = this.state.notice;
    if (n && Date.now() - (this.state.noticeAt ?? 0) < NOTICE_MS) return clipWidth(n, W.status);
    const running = ctx.bridge.store.running().length;
    return clipWidth(`${running}/${ctx.bridge.config.maxJobs} jobs  |  stop at the PC: npm run kill`, W.status);
  }

  /** The ledge: one cube per running job (up to four) and the "+" cube. */
  private renderLedge(s: Snapshot, actions: ActionMap, ctx: FaceContext): void {
    const store = ctx.bridge.store;
    const running = store.running();
    const live = new Set(running.map((j) => j.id));
    // A cube keeps its job while the job runs; a new job takes the first free cube.
    this.cubeJobs = this.cubeJobs.map((id) => (id && live.has(id) ? id : undefined));
    for (const j of running) {
      if (this.cubeJobs.includes(j.id)) continue;
      const free = this.cubeJobs.indexOf(undefined);
      if (free >= 0) this.cubeJobs[free] = j.id;
    }
    CUBE_SLOTS.forEach((slot, i) => {
      const id = this.cubeJobs[i];
      const job = id ? store.jobs.get(id) : undefined;
      const node = `Cube${slot}`;
      if (!job) {
        s.visible(node, false);
        paint(s, node, { kind: "empty" });
        s.hide(`TxCube${slot}`);
        return;
      }
      s.visible(node, true);
      paint(s, node, { kind: "job", job, needsYou: job.status === "waiting" || store.pendingFor(job.id) !== undefined });
      s.text(`TxCube${slot}`, clipWidth(cubeWord(job.project), W.cube));
      actions.set(node, `cube:${job.id}`);
    });
    s.visible("CubePlus", true);
    actions.set("CubePlus", "cube:none");
  }

  /** The puck: the oldest pending approval, approvable only when its whole command is on the label. */
  private renderPuck(s: Snapshot, actions: ActionMap, ctx: FaceContext): void {
    const store = ctx.bridge.store;
    const a = store.pendingApprovals()[0];
    paint(s, "Puck", { kind: "puck", pending: a !== undefined });
    if (!a) {
      s.hide("TxPuck");
      s.visible("BtnPuckApprove", false);
      s.visible("BtnPuckDeny", false);
      return;
    }
    const job = store.jobs.get(a.jobId);
    const proj = toWallAscii(shortProject(job?.project ?? "?"));
    // ONE line, "<project>: <verb> <command>" (V2_CONTRACT 8.5). Approvable only when that whole
    // line fits the puck (width, the host's byte limit, one line) and the approval is exact: the ask
    // plate's "you approve what you read". An exact command too long for the line says to open the
    // cube; one that isn't exact (redacted, multi-line, outside the project, runs code by itself)
    // can't be approved from the headset at all, so it says so. Deny stays in both cases.
    const line = `${proj}: ${puckVerb(a)} ${a.command}`;
    const approvable = a.exact && !line.includes("\n") && estimateWidthM(line) <= W.puck && line.length <= WORLD_TEXT_MAX_BYTES;
    if (approvable) {
      s.text("TxPuck", line);
    } else {
      const tail = a.exact ? ": open its cube" : ": approve at the desk";
      s.text("TxPuck", `${clipWidth(proj, Math.max(0.1, W.puck - estimateWidthM(tail)))}${tail}`);
    }
    s.visible("BtnPuckApprove", approvable);
    if (approvable) actions.set("BtnPuckApprove", `approve:${a.id}`);
    s.visible("BtnPuckDeny", true);
    actions.set("BtnPuckDeny", `deny:${a.id}`);
  }

  /** The arc: left = jobs, centre = `job`'s conversation (or the start-a-job set), the chrome bar, right = the page spot. */
  private renderArc(s: Snapshot, actions: ActionMap, ctx: FaceContext, job: Job | undefined, paging: Paging, status: string): void {
    const store = ctx.bridge.store;
    const running = store.running();
    const pending = store.pendingApprovals();
    const done = store.doneToday();
    const now = ctx.bridge.now();

    // ---- left: jobs --------------------------------------------------------
    s.text(
      "TxTicker",
      label([
        clipWidth(`${running.length} working  |  ${pending.length} need${pending.length === 1 ? "s" : ""} you`, W.ticker),
        clipWidth(`${done.length} done today  |  ${hhmm(now)}`, W.ticker),
      ]),
    );
    const others = running.filter((j) => j.id !== job?.id);
    const rail = [...(job ? [job] : []), ...others, ...done.filter((j) => j.id !== job?.id).reverse()].slice(0, RAIL_SLOTS.length);
    RAIL_SLOTS.forEach((slot, i) => {
      const j = rail[i];
      if (!j) {
        s.visible(`Rail${slot}`, false);
        s.visible(`RailSel${slot}`, false);
        s.hide(`TxRail${slot}`);
        return;
      }
      s.visible(`Rail${slot}`, true);
      s.text(`TxRail${slot}`, label([clipWidth(`${toWallAscii(shortProject(j.project))}: ${j.title}`, W.rail), clipWidth(`${STATUS_WORD[j.status]}  ${formatElapsed((j.endedAt ?? now) - j.startedAt)}`, W.rail)]));
      s.visible(`RailSel${slot}`, j.id === job?.id);
      actions.set(`Rail${slot}`, `rail:${j.id}`);
    });
    const last = done[done.length - 1];
    s.text("TxDone", clipWidth(`Done today: ${done.length}${last ? `  |  ${last.title}` : ""}`, W.done));

    // ---- centre: the conversation, or (no job open) the start-a-job set -------
    s.visible("BtnFold", true);
    actions.set("BtnFold", "fold");
    s.text("TxStatus", status);

    if (!job) {
      s.text("TxHeader", label([clipWidth("No job open", W.header), clipWidth("Pick one on the left, or start one below.", W.header)]));
      CONV_SLOTS.forEach((slot) => s.hide(`TxConv${slot}`));
      s.hide("TxPage");
      for (const n of ["BtnPageUp", "BtnPageDown", "BtnStop", "BtnReply", ...Object.keys(QUICK_BUTTONS)]) s.visible(n, false);
      this.renderAsk(s, actions, undefined);
      const project = this.project(ctx);
      for (const [node, id] of Object.entries(PRESET_BUTTONS)) {
        s.visible(node, true);
        actions.set(node, `preset:${id}`);
      }
      s.visible("BtnNewTask", true);
      s.prompt("BtnNewTask", `New task for Claude in ${project || "the default project"}: what should it do?`);
      actions.set("BtnNewTask", "new");
      s.text("TxProject", label([clipWidth(`Project: ${project || "none set"}`, W.project)]));
      s.visible("BtnProject", true);
      actions.set("BtnProject", "project");
    } else {
      // A job is open: the conversation uses the start set's space.
      for (const n of START_SET) s.visible(n, false);
      s.hide("TxProject");
      this.renderConversation(s, actions, job, store.pendingFor(job.id), paging, now);
    }

    // ---- the chrome bar under the centre: group watch and sign out (a watcher's copy hides both) ----
    const code = ctx.bridge.watch.current;
    s.text("TxWatch", clipWidth(code ? `code ${code.slice(0, 3)} ${code.slice(3)}` : "off", W.watch));
    s.visible("BtnWatch", true);
    actions.set("BtnWatch", "watch");
    s.visible("BtnSignOut", true);
    actions.set("BtnSignOut", "signout");

    // ---- right: the page spot (DB-043's dock; a placeholder until that panel ships) ----
    s.text("TxPageSpot", label(wrapAll(["Page panel (DB-043)", "A pinned web page will show here."], W.pageSpot)));
  }

  private renderConversation(s: Snapshot, actions: ActionMap, job: Job, a: Approval | undefined, paging: Paging, now: number): void {
    const live = job.status === "running" || job.status === "waiting" || job.status === "starting" || job.status === "idle";
    s.text(
      "TxHeader",
      label([clipWidth(job.title, W.header), clipWidth(`${toWallAscii(shortProject(job.project))}  |  ${STATUS_WORD[job.status]} ${formatElapsed((job.endedAt ?? now) - job.startedAt)}`, W.header)]),
    );
    s.visible("BtnStop", live);
    if (live) actions.set("BtnStop", `stop:${job.id}`);

    // The conversation, paged.
    const lines = conversationLines(job.events);
    // While an approval shows, the ask plate covers the lower lines, so a page holds only the
    // lines above it (newest last); the rest of the slots are hidden.
    const per = a ? CONV_ABOVE_ASK : CONV_SLOTS.length;
    if (paging.per !== undefined && paging.per !== per && paging.pageBack > 0 && paging.lastEnd !== undefined) {
      // The page size changed under a reader paged back: pick the page that still shows the line
      // that was last on show, so the text doesn't jump elsewhere (V2_CONTRACT 8.10). Lines only
      // grow at the end, so that line keeps its index.
      paging.pageBack = Math.max(0, Math.floor((lines.length - paging.lastEnd) / per));
    }
    paging.per = per;
    const pages = Math.max(1, Math.ceil(lines.length / per));
    if (paging.pageBack > pages - 1) paging.pageBack = pages - 1;
    const end = lines.length - paging.pageBack * per;
    const start = Math.max(0, end - per);
    const shown = lines.slice(start, end);
    paging.lastEnd = end;
    if (paging.pageBack === 0) paging.seenLines = lines.length;
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
    const page = pages - paging.pageBack;
    const newBelow = paging.pageBack > 0 && lines.length > paging.seenLines;
    s.text("TxPage", pages > 1 ? `${page}/${pages}${newBelow ? "\nnew" : ""}` : job.status === "running" ? "..." : "");
    s.visible("BtnPageUp", paging.pageBack < pages - 1);
    s.visible("BtnPageDown", paging.pageBack > 0);
    actions.set("BtnPageUp", "pageup");
    actions.set("BtnPageDown", "pagedown");

    // The ask plate.
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
    const head = [clipWidth(`!! Claude wants to: ${a.title}`, W.ask), ...cmd.slice(0, 1)];
    const tail = cmd.slice(1, 3);
    // Approve shows only when every character of the command is on show: three lines at most,
    // neither label cut by the host's 128-byte limit, and nothing lost to wrapping.
    const shownAll = cmd.length <= 3 && fitsLabel(head) && fitsLabel(tail) && sameNonSpace(cmd.join(""), a.command);
    const approvable = a.exact && shownAll;
    s.visible("AskPanel", true);
    if (approvable) {
      s.text("TxAskA", label(head));
      if (tail.length > 0) s.text("TxAskB", label(tail));
      else s.hide("TxAskB");
    } else {
      s.text("TxAskA", label(head.slice(0, 1)));
      // The reason first, so the byte clip can only shorten the command, never the reason.
      s.text("TxAskB", label(["Not from the headset: approve it at the desk.", clipWidth((cmd[0] ?? "") + (cmd.length > 1 ? " ..." : ""), W.ask)]));
    }
    s.visible("BtnApprove", approvable);
    if (approvable) actions.set("BtnApprove", `approve:${a.id}`);
    s.visible("BtnDeny", true);
    actions.set("BtnDeny", `deny:${a.id}`);
    s.visible("BtnWhy", true);
    actions.set("BtnWhy", `why:${a.id}`);
  }
}

/** The start-a-job set: shown in the centre only while no job is open (V2_CONTRACT 8.2). */
const START_SET = [...Object.keys(PRESET_BUTTONS), "BtnNewTask", "BtnProject"];

/** Every arc button a watcher must not be drawn: all but the rail's rows (V2_CONTRACT 8.10). */
const WATCHER_HIDDEN = ARC_BUTTON_NODES.filter((n) => !/^Rail[A-D]$/.test(n));

/** The puck's verb for a tool, in the bridge's own words ("run npm test"). */
export function puckVerb(a: Pick<Approval, "tool">): string {
  switch (a.tool) {
    case "Bash":
    case "PowerShell":
      return "run";
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return "edit";
    case "Write":
      return "write";
    case "WebFetch":
      return "open";
    case "WebSearch":
      return "search";
    default:
      return `use ${toWallAscii(a.tool).slice(0, 24)}`;
  }
}

const PRESS_WORDS: Record<string, string> = {
  BtnApprove: "Approve",
  BtnDeny: "Deny",
  BtnWhy: "Ask why",
  BtnStop: "Stop",
  BtnFold: "Fold",
  BtnKeep: "Keep going",
  BtnSimple: "Explain simply",
  BtnSummary: "Stop + summarize",
  BtnReply: "Reply",
  BtnTests: "Run all tests",
  BtnPrs: "Review open PRs",
  BtnToday: "Summarize today",
  BtnNotes: "Draft release notes",
  BtnNewTask: "New task",
  BtnProject: "Change project",
  BtnPageUp: "Page up",
  BtnPageDown: "Page down",
  BtnWatch: "Group watch",
  CubePlus: "the + cube",
  BtnPuckApprove: "Approve (puck)",
  BtnPuckDeny: "Deny (puck)",
};

/** What a watcher is told the owner pressed: the button's words, never anything typed. */
export function pressLabel(node: string): string {
  if (PRESS_WORDS[node]) return PRESS_WORDS[node] as string;
  if (/^Cube[A-D]$/.test(node)) return "a job cube";
  if (/^Rail[A-D]$/.test(node)) return "a job on the rail";
  return "a button";
}

/** "kosmos-registry" reads "registry". */
export function shortProject(name: string): string {
  return name.replace(/^kosmos-/i, "");
}

/** A cube's one-word label: the short project name's first word, plain ASCII. */
export function cubeWord(project: string): string {
  return toWallAscii(shortProject(project)).split(/[\s/\\]+/)[0] ?? "";
}

/** The conversation as panel lines: who said it, then what, wrapped by width. */
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
export const _internals = { PRESETS, QUICK_REPLIES, ARC_BUTTON_NODES };
