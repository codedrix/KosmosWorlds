/**
 * faces/types.ts -- what a face is.
 *
 * @kosmos-system  Agent bridge (Mission Control, DB-043)
 * @kosmos-owner   Platform
 *
 * A FACE turns the bridge's jobs into one room's wall, and that room's presses
 * into the bridge's verbs. Mission Control is one face; More Room (a separate
 * brief) adds its own folder beside it, `src/faces/more-room/index.ts`, and
 * never edits Mission Control's files: the registry finds faces by folder.
 *
 * The server owns everything security-relevant, so a face cannot forget it:
 * request size, the kill switch, the token check (`ctx.authed`), sign-in rate
 * limits and the lockout. A face only renders and maps presses to `Actions`.
 */

import type { Bridge } from "../bridge.js";
import type { SignInResult } from "../auth.js";
import type { WorldRequest } from "../wire.js";

export interface FaceContext {
  bridge: Bridge;
  /** True when the request carried the live sign-in token. */
  authed: boolean;
  /** True when the PC's kill switch is on. */
  killed: boolean;
  signIn(passphrase: string): SignInResult;
  signOut(): void;
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
