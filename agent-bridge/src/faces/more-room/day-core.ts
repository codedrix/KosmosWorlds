/**
 * day-core.ts -- More Room's day: the store, the DAY/1 wire, and the ops.
 *
 * @kosmos-system  Agent bridge (More Room face) -- KosmosWorlds
 * @kosmos-owner   More Room v1 (design session 2026-10-14)
 *
 * The one source of truth for More Room's side of the bridge. It does no I/O
 * of its own: `index.ts` wraps it as a bridge Face (src/faces/types.ts), and
 * more-room/bridge-day-face/mock-bridge.mjs runs the same file under Node's
 * type stripping for the world's tests. So it imports nothing but types, and
 * uses no TypeScript that stripping can't erase (no enums, no namespaces).
 *
 * The wire (worlds are no_std Rust: one record a line, TAB-separated fields,
 * printable ASCII, every field clipped to the caps below):
 *   ops    POST /v1/faces/more-room/<op>, JSON body {"tok", ...fields}
 *   signin {"pass"}           -> TOKEN <token> <seconds>    (ctx.signIn: the bridge's one session)
 *   changes {"tok","since"}   -> DAY/1 rev <n>, then SAME, or the whole day; END
 *   act {"tok","op","id"}     -> OK <rev> <note>
 *   prep {"tok","event"}      -> PREP <id>, P lines, END
 * A day is about 3 KiB; "changes" answers the whole day whenever anything
 * changed, so a missed poll never leaves the room out of step.
 *
 * Nothing is ever sent from here. "approve" on a draft is the CEO's press in
 * the room: a draft that is a bridge Approval goes to `decide` (Mission
 * Control's approval path, one log, one sender); a sample draft is only
 * marked "sent (mock)".
 */

// ---------------------------------------------------------------------------
// The data
// ---------------------------------------------------------------------------

export type Src = "gmail" | "slack" | "github" | "linear";
export type Pile = "in" | "later" | "done" | "quiet";

export interface DayEvent { id: string; start: number; end: number; title: string; prep?: string[] }
export interface DayTask { id: string; pin: boolean; state: "open" | "doing" | "done" | "rolled"; title: string }
export interface DayMessage { id: string; src: Src; vip: boolean; from: string; subject: string; preview: string }
export interface DayDraft { id: string; msg: string; state: "pending" | "sent" | "denied"; to: string; text: string; approval?: string }

/** A day as a source describes it (the sample, or the bridge's reads). */
export interface DayData {
  date: string;
  /** A banner shown on every mode, e.g. "SAMPLE DAY: nothing here is real yet". Empty for a real day. */
  note: string;
  weather: string;
  sunsetMin: number;
  headline: string;
  brief: string[];
  events: DayEvent[];
  tasks: DayTask[];
  messages: DayMessage[];
  arrivals: DayMessage[];
  wrapFirstTomorrow: string;
  drafts: Record<string, string>;
  defaultDraft: string;
}

export interface Store {
  date: string;
  note: string;
  weather: string;
  sunsetMin: number;
  headline: string;
  brief: string[];
  events: DayEvent[];
  tasks: DayTask[];
  messages: (DayMessage & { pile: Pile; read: boolean })[];
  arrivals: DayMessage[];
  drafts: DayDraft[];
  cannedDrafts: Record<string, string>;
  defaultDraft: string;
  wrapFirstTomorrow: string;
  nextTask: number;
}

export const WIRE = "DAY/1";

/** Wrong passphrases this face passes to the bridge in 24 h before it pauses its own sign-in (the bridge hard-locks at 10). */
export const WRONG_CAP = 4;
const DAY_MS = 24 * 3600 * 1000;

/** Field caps, in characters. Brief and prep lines are 30: 4 x 30 + 3 newlines fits a 128-byte world text. */
export const CAP = Object.freeze({
  line: 30,
  eventTitle: 14,
  from: 22,
  subject: 28,
  preview: 80,
  task: 24,
  draft: 300,
  weather: 12,
  headline: 56,
});

const ASCII_FOLD: Record<string, string> = {
  "‘": "'", "’": "'", "“": '"', "”": '"',
  "–": "-", "—": "-", "…": "...", " ": " ",
};

/** Printable ASCII, no TAB or newline, clipped to `max` with "..." when cut. */
export function clean(s: unknown, max: number): string {
  let out = "";
  for (const ch of String(s ?? "")) {
    const f = ASCII_FOLD[ch];
    if (f !== undefined) out += f;
    else if (ch >= " " && ch <= "~") out += ch;
    else if (ch === "\t" || ch === "\n" || ch === "\r") out += " ";
  }
  out = out.replace(/\s+/g, " ").trim();
  if (out.length > max) out = out.slice(0, Math.max(0, max - 3)).trimEnd() + "...";
  return out;
}

export function createStore(day: DayData): Store {
  const d = JSON.parse(JSON.stringify(day)) as DayData;
  return {
    date: d.date,
    note: d.note,
    weather: d.weather,
    sunsetMin: d.sunsetMin,
    headline: d.headline,
    brief: d.brief,
    events: d.events,
    tasks: d.tasks,
    messages: d.messages.map((m) => ({ ...m, pile: "in" as Pile, read: false })),
    arrivals: d.arrivals,
    drafts: [],
    cannedDrafts: d.drafts,
    defaultDraft: d.defaultDraft,
    wrapFirstTomorrow: d.wrapFirstTomorrow,
    nextTask: 1,
  };
}

// ---------------------------------------------------------------------------
// The ops
// ---------------------------------------------------------------------------

export interface Reply { status: number; body: string }

export type SignIn =
  | { ok: true; token: string; expiresInS: number }
  | { ok: false; reason: string; retryAfterS?: number };

export interface Hooks {
  /** The bridge's one session (ctx.signIn). */
  signIn(pass: string): SignIn;
  /** Mission Control's approval path (ctx.bridge.actions.decide), for drafts that are bridge Approvals. */
  decide?(approvalId: string, d: "approve" | "deny"): { ok: boolean };
}

export interface CoreOptions {
  store: Store;
  /** Minutes after local midnight. */
  nowMin?: () => number;
  /** Epoch ms, for the face's own cap on wrong guesses (default Date.now). */
  nowMs?: () => number;
  /** true enables the op "arrive", which lands the next sample message (the mock and its tests only). */
  dev?: boolean;
}

export interface Core {
  handle(op: string, fields: Record<string, string>, authed: boolean, hooks: Hooks): Reply;
  snapshot(): string;
  /** The whole day plus REPLY and PREPL records: the sample the world carries built in. */
  baked(): string;
  reset(): void;
  store: Store;
  log: { op: string; id: string; rev: number; note: string }[];
  rev(): number;
}

export function createCore(opts: CoreOptions): Core {
  const store = opts.store;
  const nowMin =
    opts.nowMin ??
    (() => {
      const t = new Date();
      return t.getHours() * 60 + t.getMinutes();
    });
  let rev = 1;
  const nowMs = opts.nowMs ?? (() => Date.now());
  // Wrong passphrases through THIS face in the last 24 h. The room is an unlisted
  // link others may open; the bridge hard-locks itself after 10 wrong in 24 h
  // (auth.ts), which would also take Mission Control down. Stopping at
  // WRONG_CAP here keeps any number of visitors' guesses in this room from
  // ever reaching that lock. Only this room's sign-in pauses.
  const wrongAt: number[] = [];
  const log: Core["log"] = [];
  const bump = () => ++rev;
  const text = (status: number, body: string): Reply => ({ status, body });

  function snapshot(extra: string[] = []): string {
    const L: string[] = [];
    const rec = (...f: (string | number)[]) => L.push(f.join("\t"));
    rec(WIRE, "rev", rev);
    rec("NOW", nowMin(), store.sunsetMin);
    rec("DATE", clean(store.date, 16));
    if (store.note) rec("NOTE", clean(store.note, 40));
    for (const b of store.brief.slice(0, 4)) rec("BRIEF", clean(b, CAP.line));
    for (const e of store.events.slice(0, 10)) rec("EV", e.id, e.start, e.end, clean(e.title, CAP.eventTitle), e.prep ? 1 : 0);
    for (const t of store.tasks.slice(0, 24)) rec("TASK", t.id, t.pin ? 1 : 0, t.state, clean(t.title, CAP.task));
    for (const m of store.messages.slice(0, 48)) {
      rec("MSG", m.id, m.src, m.vip ? 1 : 0, m.pile, m.read ? 1 : 0, clean(m.from, CAP.from), clean(m.subject, CAP.subject), clean(m.preview, CAP.preview));
    }
    for (const dr of store.drafts.slice(-4)) rec("DRAFT", dr.id, dr.msg, dr.state, clean(dr.to, CAP.from), clean(dr.text, CAP.draft));
    rec("WIN", clean(store.weather, CAP.weather), clean(store.headline, CAP.headline));
    rec("WRAP", "first", clean(store.wrapFirstTomorrow, CAP.task + 8));
    L.push(...extra);
    rec("END");
    return L.join("\n") + "\n";
  }

  function baked(): string {
    const extra: string[] = [];
    for (const e of store.events.slice(0, 10)) for (const p of (e.prep ?? []).slice(0, 4)) extra.push(["PREPL", e.id, clean(p, CAP.line)].join("\t"));
    for (const [msg, text] of Object.entries(store.cannedDrafts).slice(0, 12)) extra.push(["REPLY", msg, clean(text, CAP.draft)].join("\t"));
    extra.push(["REPLY", "*", clean(store.defaultDraft, CAP.draft)].join("\t"));
    return snapshot(extra);
  }

  function act(fields: Record<string, string>, hooks: Hooks): Reply {
    const op = String(fields.op ?? "");
    const id = String(fields.id ?? "");
    const msg = store.messages.find((m) => m.id === id);
    const task = store.tasks.find((t) => t.id === id);
    const draft = store.drafts.find((d) => d.id === id);
    let note = "";
    switch (op) {
      case "turn":
        if (!msg) return text(404, "NO\tno such message\n");
        msg.read = true;
        break;
      case "done":
        if (!msg) return text(404, "NO\tno such message\n");
        msg.pile = "done";
        msg.read = true;
        break;
      case "later":
        if (!msg) return text(404, "NO\tno such message\n");
        msg.pile = "later";
        break;
      case "quiet":
        if (!msg) return text(404, "NO\tno such message\n");
        msg.pile = "quiet";
        break;
      case "draft": {
        if (!msg) return text(404, "NO\tno such message\n");
        store.drafts.push({
          id: `d-${msg.id}-${store.drafts.length + 1}`,
          msg: msg.id,
          state: "pending",
          to: msg.from,
          text: store.cannedDrafts[msg.id] ?? store.defaultDraft,
        });
        note = "Draft ready: Approve or Deny";
        break;
      }
      case "approve":
      case "deny": {
        if (!draft || draft.state !== "pending") return text(409, "NO\tnothing to decide\n");
        if (draft.approval) {
          // A real draft: the bridge's approval path decides, logs and sends.
          const r = hooks.decide?.(draft.approval, op) ?? { ok: false };
          if (!r.ok) return text(409, "NO\talready answered, or approve it at the desk\n");
        }
        draft.state = op === "approve" ? "sent" : "denied";
        if (op === "approve") {
          const m = store.messages.find((x) => x.id === draft.msg);
          if (m) {
            m.pile = "done";
            m.read = true;
          }
        }
        note = op === "approve" ? (draft.approval ? "Approved: the bridge sends it" : "Sent (mock: nothing left)") : "Draft discarded";
        break;
      }
      case "task": {
        if (!msg) return text(404, "NO\tno such message\n");
        const key = `KOS-MOCK-${store.nextTask++}`;
        store.tasks.push({ id: `t-${key}`, pin: false, state: "open", title: clean(`${key} ${msg.subject}`, CAP.task) });
        note = `${key} created (mock)`;
        break;
      }
      case "complete":
        if (!task) return text(404, "NO\tno such task\n");
        task.state = "done";
        break;
      case "roll":
        if (!task) return text(404, "NO\tno such task\n");
        task.state = "rolled";
        break;
      case "pin":
        if (!task) return text(404, "NO\tno such task\n");
        task.pin = !task.pin;
        break;
      default:
        return text(400, "NO\tunknown op\n");
    }
    const r = bump();
    log.push({ op, id, rev: r, note });
    return text(200, `OK\t${r}\t${clean(note, 40)}\n`);
  }

  function handle(op: string, fields: Record<string, string>, authed: boolean, hooks: Hooks): Reply {
    if (op === "signin") {
      const t = nowMs();
      while (wrongAt.length && (wrongAt[0] ?? 0) < t - DAY_MS) wrongAt.shift();
      if (wrongAt.length >= WRONG_CAP) {
        const retry = Math.ceil(((wrongAt[0] ?? t) + DAY_MS - t) / 1000);
        return text(429, `NO\troom_locked\t${retry}\n`);
      }
      const r = hooks.signIn(String(fields.pass ?? ""));
      if (!r.ok && r.reason === "wrong") wrongAt.push(t);
      if (r.ok) return text(200, `TOKEN\t${r.token}\t${r.expiresInS}\n`);
      const status = r.reason === "wrong" || r.reason === "not_set" ? 401 : 429;
      return text(status, `NO\t${clean(r.reason, 16)}\t${r.retryAfterS ?? 0}\n`);
    }
    // Dev only (the mock and its tests, never a deployed bridge): land the next sample message.
    if (opts.dev && op === "arrive") {
      const next = store.arrivals.shift();
      if (!next) return text(200, "OK\t0\tnone left\n");
      store.messages.push({ ...next, pile: "in", read: false });
      return text(200, `OK\t${bump()}\t${next.id}\n`);
    }
    if (!authed) return text(401, "AUTH\tsign in again\n");
    if (op === "changes") {
      const since = Number(fields.since ?? 0);
      if (since === rev) return text(200, `${WIRE}\trev\t${rev}\nNOW\t${nowMin()}\t${store.sunsetMin}\nSAME\nEND\n`);
      return text(200, snapshot());
    }
    if (op === "act") return act(fields, hooks);
    if (op === "prep") {
      const ev = store.events.find((e) => e.id === String(fields.event ?? ""));
      if (!ev) return text(404, "NO\tno such event\n");
      const lines = (ev.prep ?? ["Nothing gathered for this one"]).slice(0, 4).map((l) => `P\t${clean(l, CAP.line)}`);
      return text(200, `PREP\t${ev.id}\n${lines.join("\n")}\nEND\n`);
    }
    return text(404, "NO\tnot here\n");
  }

  return { handle, snapshot: () => snapshot(), baked, reset: () => undefined, store, log, rev: () => rev };
}
