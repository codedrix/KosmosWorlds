/**
 * faces/types.ts -- what a face is.
 *
 * @kosmos-system  Agent bridge (Mission Control, DB-044)
 * @kosmos-owner   Platform
 *
 * A FACE turns the bridge's jobs into one room's wall, and that room's presses
 * into the bridge's verbs. Mission Control is one face; More Room (a separate
 * brief) adds its own folder beside it, `src/faces/more-room/index.ts`, and
 * never edits Mission Control's files: the registry finds faces by folder.
 *
 * The server owns everything security-relevant, so a face cannot forget it:
 * request size, the kill switch, the token check (`ctx.authed`), sign-in rate
 * limits and the lockout, and the pairing's stop and config checks (`ctx.pair`). A face only
 * renders and maps presses to `Actions`. No face can APPROVE a pairing: `ctx.pair` has no such
 * verb (approval happens only at the PC, pairing.ts).
 */

import type { Bridge } from "../bridge.js";
import type { SignInResult } from "../auth.js";
import type { WorldRequest } from "../wire.js";
import type { PairState } from "../pairing.js";

/** What a face may do with the Pairing Seal: mint, read its own pairing, and take it once approved. */
export interface PairAccess {
  /** A new pairing (replacing any other). Refused while stopped, when pairing is off, or beyond the rate. */
  mint(): { ok: true; id: string; code: string; expiresAt: number } | { ok: false; reason: "rate" | "stopped" | "off" };
  /** The state the holder of `id` may see; `expired` while stopped. */
  state(id: string | undefined): PairState;
  /** Take an APPROVED pairing (once) and start a session; watching starts off. */
  signIn(id: string | undefined): { ok: true; token: string; expiresInS: number } | { ok: false };
}

export interface FaceContext {
  bridge: Bridge;
  /** True when the request carried the live sign-in token. */
  authed: boolean;
  /** True when the PC's kill switch is on. */
  killed: boolean;
  signIn(passphrase: string): SignInResult;
  signOut(): void;
  pair: PairAccess;
  /** Resolves when the bridge's jobs change, or after `ms`. */
  waitForChange(ms: number): Promise<void>;
}

export interface FaceReply {
  status?: number;
  body: string;
  contentType?: string;
}

export interface Face {
  /** URL segment: /v1/faces/<name>/<op>. Lowercase letters, digits and hyphens. */
  readonly name: string;
  /** World addresses this face serves; listed in /.well-known/world-network.json. */
  readonly worlds: readonly string[];
  handle(op: string, req: WorldRequest, ctx: FaceContext): Promise<FaceReply>;
  /** Forget per-sign-in state (sign-out, expiry, kill). */
  reset(): void;
}
