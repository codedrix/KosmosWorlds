/**
 * pairing.ts -- the Pairing Seal: sign in by approving a code at the PC, never by typing a secret
 * in the headset.
 *
 * @kosmos-system  Agent bridge (Mission Control, DB-044 v2)
 * @kosmos-owner   Platform
 *
 * The flow (mission-control/V2_CONTRACT.md section 5):
 *   1. The headset presses the seal. The face mints a pairing: a random id (16 bytes, hex) that only
 *      that headset holds, and a short code (`KXT WMP`) its ring shows.
 *   2. The owner, at the PC, types the code he reads off HIS ring: in the bridge's console (a TTY),
 *      or with `npm run approve -- <code>`, which writes PAIR_APPROVE in the bridge's home.
 *   3. The headset's next poll (it echoes the id) takes a normal session token, once.
 *
 * Threat model, each line a test (test/pairing.test.ts):
 *   - Approval is LOCAL ONLY. No HTTP route can approve: nothing in server.ts or a face calls
 *     `approveTyped`, and the face only mints, reads and takes.
 *   - 120 s lifetime from the mint; single use (the first poll after approval takes it, and it is gone).
 *   - Up to 16 live pairings, each keyed by its id (V2_CONTRACT section 8.9). Minting is at most 6 a
 *     minute across everyone and at least 3 s apart, and a pairing lives 120 s, so at most 12 are
 *     ever alive: a stranger pressing the seal at the cap never evicts the owner's pairing inside
 *     its life. A full table would replace its oldest (a backstop the rate makes unreachable).
 *   - A typed code approves only the pairing whose code it is. The owner types the code on HIS
 *     ring, so a stranger's pairing is never approved by accident.
 *   - The typed code is normalised (letters only, upper case) and compared in constant time against
 *     every waiting pairing; five wrong codes in a row cancel every waiting pairing.
 *   - Residual risk, stated: a bot minting at the cap uses up the mint rate, so the owner's own
 *     press can be refused ("pair_refused": wait a few seconds). A nuisance, never a sign-in; the
 *     passphrase fallback stays.
 *   - The kill switch refuses minting and clears what is pending (Bridge.enforceKill).
 *   - Logs: no code, no id, no token, ever. The console prompt says only that a headset asks and how
 *     long ago; the owner must read the code off his own ring.
 *
 * INTEGRATION POINTS: server.ts gives faces `ctx.pair` (mint, state, signIn: the kill-switch and
 * config checks live there); main.ts runs the console approver and reads PAIR_APPROVE every second.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { bridgeHome } from "./config.js";

export const PAIR_TTL_MS = 120_000;
export const PAIR_MINTS_PER_MINUTE = 6;
export const PAIR_MIN_GAP_MS = 3000;
export const PAIR_WRONG_LIMIT = 5;
/** Live pairings kept at once. The rate (6 a minute) and the life (120 s) allow at most 12. */
export const PAIR_SLOTS = 16;
/** 20 consonants, no vowels (no words), no look-alikes with digits: 20^6 = 64 million codes. */
export const PAIR_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
export const PAIR_CODE_LEN = 6;
/** PAIR_APPROVE holds at most this many bytes; a longer file is refused unread. */
export const PAIR_APPROVE_MAX_BYTES = 32;

export type MintResult = { ok: true; id: string; code: string; expiresAt: number } | { ok: false; reason: "rate" };
export type PairState =
  | { state: "pending"; code: string; mintedAt: number; expiresAt: number }
  | { state: "approved"; expiresAt: number }
  | { state: "expired" };
export type ApproveOutcome = "approved" | "wrong" | "cancelled" | "none";
export interface ApproveResult {
  outcome: ApproveOutcome;
  /** Wrong codes typed in a row so far (0 when none waits). */
  wrong: number;
}
export type PairEvent = "minted" | "approved" | "cancelled" | "expired" | "taken" | "cleared";

interface Slot {
  id: string;
  code: string;
  mintedAt: number;
  expiresAt: number;
  approved: boolean;
}

/** `KXTWMP` reads `KXT WMP` on the ring. */
export function formatPairCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

/** What the owner typed, as the ring's letters: letters only, upper case ("kxt-wmp" = "KXTWMP"). */
export function normalizeTypedCode(typed: string): string {
  return typed.toUpperCase().replace(/[^A-Z]/g, "");
}

function sameSecret(a: string, b: string): boolean {
  // Pad both to one length so the compare itself takes the same time; the length check is separate.
  const n = Math.max(a.length, b.length, 1);
  const x = Buffer.alloc(n);
  const y = Buffer.alloc(n);
  x.write(a);
  y.write(b);
  return crypto.timingSafeEqual(x, y) && a.length === b.length;
}

export class Pairing {
  /** Live pairings, oldest first. */
  private slots: Slot[] = [];
  private mints: number[] = [];
  /** Wrong codes typed in a row (reset by an approval, or when nothing waits). */
  private wrong = 0;
  private listeners = new Set<(e: PairEvent) => void>();

  constructor(
    private readonly now: () => number = Date.now,
    /** Called on every change, so long polls wake (Bridge passes store.poke). */
    private readonly onChange: () => void = () => {},
  ) {}

  /** Listen for changes (the console approver and the PAIR_PENDING file use this). Returns an unsubscribe. */
  on(listener: (e: PairEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: PairEvent): void {
    for (const l of [...this.listeners]) {
      try {
        l(e);
      } catch {
        // A listener's failure (a file the disk refused) never breaks pairing itself.
      }
    }
    this.onChange();
  }

  /** The live slots, after dropping the expired ones. */
  private live(): Slot[] {
    const t = this.now();
    const before = this.slots.length;
    this.slots = this.slots.filter((s) => t < s.expiresAt);
    if (this.slots.length !== before) this.emit("expired");
    if (!this.slots.some((s) => !s.approved)) this.wrong = 0;
    return this.slots;
  }

  /** The slot `id` names, comparing every slot's id in constant time (no early exit). */
  private find(id: string | undefined): Slot | undefined {
    if (!id) return undefined;
    let hit: Slot | undefined;
    for (const s of this.live()) if (sameSecret(id, s.id)) hit = s;
    return hit;
  }

  /**
   * Mint a pairing into a free slot. Refused beyond 6 a minute or within 3 s of the last. A full
   * table (16) replaces its oldest, a backstop the rate limit makes unreachable: at 6 a minute
   * and a 120 s life, at most 12 pairings are ever alive at once.
   */
  mint(): MintResult {
    const t = this.now();
    this.mints = this.mints.filter((x) => t - x < 60_000);
    const last = this.mints[this.mints.length - 1];
    if (this.mints.length >= PAIR_MINTS_PER_MINUTE || (last !== undefined && t - last < PAIR_MIN_GAP_MS)) return { ok: false, reason: "rate" };
    this.mints.push(t);
    const slots = this.live();
    if (slots.length >= PAIR_SLOTS) slots.shift();
    let code = "";
    for (let i = 0; i < PAIR_CODE_LEN; i++) code += PAIR_ALPHABET[crypto.randomInt(0, PAIR_ALPHABET.length)];
    const id = crypto.randomBytes(16).toString("hex");
    slots.push({ id, code, mintedAt: t, expiresAt: t + PAIR_TTL_MS, approved: false });
    this.emit("minted");
    return { ok: true, id, code, expiresAt: t + PAIR_TTL_MS };
  }

  /** What the holder of `id` may know. A replaced, taken, cancelled or unknown id is `expired`. */
  state(id: string | undefined): PairState {
    const s = this.find(id);
    if (!s) return { state: "expired" };
    if (s.approved) return { state: "approved", expiresAt: s.expiresAt };
    return { state: "pending", code: s.code, mintedAt: s.mintedAt, expiresAt: s.expiresAt };
  }

  /** Single use: true once, for the holder of an approved pairing's id; the pairing is then gone. */
  take(id: string | undefined): boolean {
    const s = this.find(id);
    if (!s || !s.approved) return false;
    this.slots = this.slots.filter((x) => x !== s);
    this.emit("taken");
    return true;
  }

  /**
   * LOCAL ONLY: the owner typed `typed` at the PC (console or PAIR_APPROVE). It approves the ONE
   * waiting pairing whose code it is (every slot is compared, in constant time, no early exit);
   * five wrong codes in a row cancel every waiting pairing. Never reachable from HTTP
   * (test/pairing.test.ts walks every route to prove it).
   */
  approveTyped(typed: string): ApproveResult {
    const waiting = this.live().filter((s) => !s.approved);
    if (waiting.length === 0) return { outcome: "none", wrong: 0 };
    const t = normalizeTypedCode(typed).slice(0, 16);
    let hit: Slot | undefined;
    for (const s of waiting) if (sameSecret(t, s.code)) hit = hit ?? s;
    if (hit) {
      hit.approved = true;
      const wrong = this.wrong;
      this.wrong = 0;
      this.emit("approved");
      return { outcome: "approved", wrong };
    }
    this.wrong++;
    if (this.wrong >= PAIR_WRONG_LIMIT) {
      this.slots = this.slots.filter((s) => s.approved);
      this.wrong = 0;
      this.emit("cancelled");
      return { outcome: "cancelled", wrong: PAIR_WRONG_LIMIT };
    }
    this.onChange();
    return { outcome: "wrong", wrong: this.wrong };
  }

  /** Pairings waiting for approval: how many, and when the newest was made. Never a code or an id. */
  waiting(): { count: number; newestMintedAt: number } | null {
    const w = this.live().filter((s) => !s.approved);
    const newest = w[w.length - 1];
    return newest ? { count: w.length, newestMintedAt: newest.mintedAt } : null;
  }

  /** The kill switch: forget every pairing, waiting or approved. */
  clear(): void {
    this.wrong = 0;
    if (this.slots.length) {
      this.slots = [];
      this.emit("cleared");
    }
  }
}

// ---------------------------------------------------------------------------
// The words the PC shows (never a code, an id or a token)
// ---------------------------------------------------------------------------

export function consolePairPrompt(ageS: number, count = 1): string {
  const who = count > 1 ? `${count} headsets ask to pair (the newest` : "A headset asks to pair (";
  return `${who}${count > 1 ? " " : ""}${Math.max(0, Math.floor(ageS))} s ago). Type the code shown on YOUR ring to approve: `;
}

export function describeApprove(r: ApproveResult): string {
  switch (r.outcome) {
    case "approved":
      return "Pairing approved. The headset signs in on its next check.";
    case "wrong":
      return `That is not the code on any waiting ring (${r.wrong} of ${PAIR_WRONG_LIMIT} wrong). Read it off your own ring.`;
    case "cancelled":
      return `${PAIR_WRONG_LIMIT} wrong codes: every waiting pairing is cancelled. Press the seal again.`;
    default:
      return "No pairing is waiting.";
  }
}

// ---------------------------------------------------------------------------
// The files in the bridge's home (`npm run approve` talks to `npm start` through these)
// ---------------------------------------------------------------------------

/** Written by `npm run approve -- <code>`; read and deleted by the serve loop within a second. */
export function pairApproveFile(): string {
  return path.join(bridgeHome(), "PAIR_APPROVE");
}
/** While a pairing waits: when it was minted (ms). No code, no id. */
export function pairPendingFile(): string {
  return path.join(bridgeHome(), "PAIR_PENDING");
}
/** The outcome of the last PAIR_APPROVE (approved | wrong | cancelled | none | refused). */
export function pairResultFile(): string {
  return path.join(bridgeHome(), "PAIR_RESULT");
}

function removeQuietly(p: string): void {
  try {
    fs.rmSync(p, { force: true });
  } catch {
    // nothing to do
  }
}

/** At serve start: a file left from before a restart must never approve a new pairing. */
export function clearPairingFiles(): void {
  for (const f of [pairApproveFile(), pairPendingFile(), pairResultFile()]) removeQuietly(f);
}

/**
 * Read PAIR_APPROVE and delete it. `null` = no file. `{ refused }` = not a plain file, or over
 * PAIR_APPROVE_MAX_BYTES: it is deleted unread (a symlink is removed, never followed).
 */
export function takeApproveFile(): { text: string } | { refused: true } | null {
  const p = pairApproveFile();
  let st: fs.Stats;
  try {
    st = fs.lstatSync(p);
  } catch {
    return null;
  }
  if (!st.isFile() || st.size > PAIR_APPROVE_MAX_BYTES) {
    removeQuietly(p);
    return { refused: true };
  }
  let text = "";
  try {
    text = fs.readFileSync(p, "utf8").slice(0, PAIR_APPROVE_MAX_BYTES);
  } finally {
    removeQuietly(p);
  }
  return { text };
}

/** `npm run approve -- <code>`: only the letters, at most 32 bytes. Refuses to write through a link. */
export function writeApproveFile(typed: string): void {
  const p = pairApproveFile();
  fs.mkdirSync(bridgeHome(), { recursive: true });
  try {
    const st = fs.lstatSync(p);
    if (!st.isFile()) throw new Error(`${p} is not a plain file; remove it by hand`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  fs.writeFileSync(p, normalizeTypedCode(typed).slice(0, PAIR_APPROVE_MAX_BYTES), { mode: 0o600 });
}

/** Keep PAIR_PENDING in step with the pairing (for `npm run approve` with no code). */
export function attachPendingFile(pairing: Pairing): () => void {
  const write = () => {
    const w = pairing.waiting();
    if (w) fs.writeFileSync(pairPendingFile(), `${w.newestMintedAt} ${w.count}\n`, { mode: 0o600 });
    else removeQuietly(pairPendingFile());
  };
  return pairing.on(() => write());
}

/** One serve-loop tick: approve from PAIR_APPROVE if it is there. Logs words, never the code. */
export function pollApproveFile(pairing: Pairing, log: (line: string) => void): ApproveOutcome | "refused" | null {
  const got = takeApproveFile();
  if (!got) return null;
  if ("refused" in got) {
    log("PAIR_APPROVE was not a plain file of at most 32 bytes: ignored and removed.");
    try {
      fs.writeFileSync(pairResultFile(), "refused\n", { mode: 0o600 });
    } catch {
      // the CLI then reports that it got no answer
    }
    return "refused";
  }
  const r = pairing.approveTyped(got.text);
  log(describeApprove(r));
  try {
    fs.writeFileSync(pairResultFile(), `${r.outcome}\n`, { mode: 0o600 });
  } catch {
    // the CLI then reports that it got no answer
  }
  return r.outcome;
}

/** What `npm run approve` (no code) says about the waiting pairing, from PAIR_PENDING. */
export function describeWaitingFromFile(now = Date.now()): string {
  let minted = NaN;
  let count = 1;
  try {
    const [m, c] = fs.readFileSync(pairPendingFile(), "utf8").trim().split(/\s+/);
    minted = Number(m);
    if (c !== undefined && /^\d{1,2}$/.test(c)) count = Number(c);
  } catch {
    return "No pairing is waiting.";
  }
  if (!Number.isFinite(minted) || now - minted >= PAIR_TTL_MS) return "No pairing is waiting.";
  const age = Math.floor((now - minted) / 1000);
  const what = count > 1 ? `${count} pairings are waiting (the newest made ${age} s ago` : `A pairing is waiting (made ${age} s ago`;
  return `${what}; each lasts ${PAIR_TTL_MS / 1000} s). Approve yours with: npm run approve -- <the code on your ring>`;
}

/**
 * The console approver, when the bridge runs in a terminal: on each mint it prints the prompt (no
 * code); a typed line is checked against the waiting pairing. An empty line repeats the prompt with
 * the age. Returns a stop function.
 */
export function startConsoleApprover(
  pairing: Pairing,
  input: NodeJS.ReadableStream,
  write: (s: string) => void,
  now: () => number = Date.now,
  terminal = false,
): () => void {
  const rl = readline.createInterface({ input, terminal });
  const off = pairing.on((e) => {
    if (e === "minted") write("\n" + consolePairPrompt(0, pairing.waiting()?.count ?? 1));
  });
  rl.on("line", (line) => {
    const w = pairing.waiting();
    if (!line.trim()) {
      write(w ? consolePairPrompt((now() - w.newestMintedAt) / 1000, w.count) : "No pairing is waiting.\n");
      return;
    }
    write(describeApprove(pairing.approveTyped(line)) + "\n");
  });
  return () => {
    off();
    rl.close();
  };
}
