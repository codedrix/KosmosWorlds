/**
 * faces/desk/index.ts -- the Kosmos Desk board in the Lobby: read-only, one op.
 *
 * @kosmos-system  Agent bridge (Kosmos Desk face, read-only)
 * @kosmos-owner   Platform
 *
 * Route: POST /v1/faces/desk/board, from world://lobby.micknerks, carrying the token Mission
 * Control's sign-in already holds (`tok <token>`). The server does the size, rate, relay-key,
 * kill-switch, X-World-Address and token checks before `handle` runs (src/server.ts); this file
 * adds no file of Mission Control's and edits none (the registry finds faces by folder).
 *
 * What it does NOT do, on purpose:
 * - sign in: it never calls ctx.signIn or ctx.pair, so it can never open a second session or
 *   end the CEO's own; without the live token it answers 401 and draws nothing;
 * - write: there is no op but `board`, and a press or typed text in the request is ignored;
 *   approving merges from the headset is a later phase with its own safety design;
 * - keep anything: the file is read on each request and nothing is held between them.
 *
 * The data is the hub session's snapshot file (`SCHEMA.md`); `core.ts` reads and sanitizes it.
 * Integration points: mission-control/src/lib.rs (the world: `PATH_DESK`, `apply_desk`) and
 * mission-control/nodes.json (`desk_text`, `desk_world`, from `layout.ts`).
 */

import type { Face, FaceContext, FaceReply } from "../types.js";
import type { WorldRequest } from "../../wire.js";
import { deskFile, parseDesk, readDeskFile, renderBoard } from "./core.js";

export const WORLDS = ["world://lobby.micknerks"] as const;
const TEXT = "text/plain; charset=utf-8";

export interface DeskOptions {
  /** The snapshot file to read (default: KOSMOS_DESK_FILE, else E:\Kosmos_Desk\desk.json). */
  file?: () => string;
  /** The PC's clock in ms (tests move it). */
  now?: () => number;
}

export function createDeskFace(opts: DeskOptions = {}): Face {
  const file = opts.file ?? deskFile;
  const now = opts.now ?? Date.now;
  return {
    name: "desk",
    worlds: WORLDS,
    async handle(op: string, _req: WorldRequest, ctx: FaceContext): Promise<FaceReply> {
      if (op !== "board") return { status: 404, body: "AB1\nE no_op\n", contentType: TEXT };
      if (ctx.killed) return { status: 503, body: "AB1\nE stopped\n", contentType: TEXT };
      if (!ctx.authed) return { status: 401, body: "AB1\nE signed_out\n", contentType: TEXT };
      const t = now();
      const got = await readDeskFile(file());
      const read = got.ok ? parseDesk(got.text, t) : { state: "offline" as const, why: got.why };
      return { status: 200, body: renderBoard(read, t).toString(), contentType: TEXT };
    },
    reset(): void {
      // Nothing is kept between requests.
    },
  };
}

export default createDeskFace();
