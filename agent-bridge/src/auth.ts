/**
 * auth.ts -- passphrase sign-in, short-lived tokens and the lockout.
 *
 * @kosmos-system  Agent bridge (Mission Control, DB-044)
 * @kosmos-owner   Platform
 *
 * The headset sends no identity, and `X-World-Address` is a header anyone can
 * type. So the bridge trusts exactly one thing: the passphrase, typed in the
 * world, exchanged for a random token that lives in the world's memory.
 *
 *   - One sign-in at a time: a new sign-in ends the old one.
 *   - A token dies after 30 minutes without use, or 8 hours after sign-in.
 *   - The bridge stores only SHA-256(token), never the token.
 *   - Wrong passphrases: after 5 in a row, sign-in is refused for 15 minutes.
 *     After 10 inside 24 hours, the bridge writes LOCKED and refuses sign-in
 *     until the PC runs `npm run unlock`. There is no identity to lock out
 *     per person, so the lock is global: a stranger can lock the CEO out, but
 *     never in. That trade is stated in DB-044.
 *   - At most one attempt every 2 seconds, so guessing is slow even before the lock.
 */

import crypto from "node:crypto";
import { isHardLocked, hardLock } from "./killswitch.js";

export const TOKEN_IDLE_MS = 30 * 60 * 1000;
export const TOKEN_MAX_MS = 8 * 60 * 60 * 1000;
export const SOFT_LOCK_AFTER = 5;
export const SOFT_LOCK_MS = 15 * 60 * 1000;
export const HARD_LOCK_AFTER = 10;
export const HARD_LOCK_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MIN_ATTEMPT_GAP_MS = 2000;

export type SignInResult =
  | { ok: true; token: string; expiresInS: number }
  | { ok: false; reason: "wrong" | "locked" | "hard_locked" | "too_fast" | "not_set"; retryAfterS?: number };

interface Session {
  hash: string;
  createdAt: number;
  lastSeen: number;
}

function sha(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export class AuthGate {
  private session: Session | null = null;
  private consecutiveFails = 0;
  private failTimes: number[] = [];
  private softLockUntil = 0;
  private lastAttemptAt = -Infinity;

  constructor(
    private readonly verify: (pass: string) => boolean,
    private readonly isSet: () => boolean,
    private readonly now: () => number = Date.now,
  ) {}

  signIn(pass: string): SignInResult {
    const t = this.now();
    if (!this.isSet()) return { ok: false, reason: "not_set" };
    if (isHardLocked()) return { ok: false, reason: "hard_locked" };
    if (t < this.softLockUntil) return { ok: false, reason: "locked", retryAfterS: Math.ceil((this.softLockUntil - t) / 1000) };
    if (t - this.lastAttemptAt < MIN_ATTEMPT_GAP_MS) return { ok: false, reason: "too_fast", retryAfterS: 2 };
    this.lastAttemptAt = t;

    if (!this.verify(pass)) {
      this.consecutiveFails++;
      this.failTimes = this.failTimes.filter((x) => t - x < HARD_LOCK_WINDOW_MS);
      this.failTimes.push(t);
      if (this.failTimes.length >= HARD_LOCK_AFTER) {
        hardLock(`${this.failTimes.length} wrong passphrases in 24 h`);
        this.signOut();
        return { ok: false, reason: "hard_locked" };
      }
      if (this.consecutiveFails >= SOFT_LOCK_AFTER) {
        this.softLockUntil = t + SOFT_LOCK_MS;
        this.consecutiveFails = 0;
        return { ok: false, reason: "locked", retryAfterS: SOFT_LOCK_MS / 1000 };
      }
      return { ok: false, reason: "wrong" };
    }

    this.consecutiveFails = 0;
    const token = crypto.randomBytes(32).toString("base64url");
    this.session = { hash: sha(token), createdAt: t, lastSeen: t };
    return { ok: true, token, expiresInS: TOKEN_IDLE_MS / 1000 };
  }

  /** True (and the idle clock restarts) when `token` is the live session's token. */
  check(token: string | undefined | null): boolean {
    if (!token || !this.session) return false;
    const t = this.now();
    const s = this.session;
    if (t - s.lastSeen > TOKEN_IDLE_MS || t - s.createdAt > TOKEN_MAX_MS || isHardLocked()) {
      this.session = null;
      return false;
    }
    const a = Buffer.from(sha(token), "hex");
    const b = Buffer.from(s.hash, "hex");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    s.lastSeen = t;
    return true;
  }

  signOut(): void {
    this.session = null;
  }

  get signedIn(): boolean {
    return this.session !== null;
  }
}
