/**
 * faces/more-room/index.ts -- More Room's face on the shared agent bridge.
 *
 * @kosmos-system  Agent bridge (More Room face) -- KosmosWorlds
 * @kosmos-owner   More Room v1 (design session 2026-10-14)
 *
 * Routes: POST /v1/faces/more-room/<op>, from world://more-room.micknerks (VR)
 * and world://more-room-mr.micknerks (MR). The server does the size, rate,
 * relay-key, kill-switch, X-World-Address and token checks before `handle`
 * runs (src/server.ts); this file adds no file of Mission Control's and edits
 * none (the registry finds faces by folder).
 *
 * - Sign-in uses the bridge's one session: the op `signin` calls ctx.signIn,
 *   so signing in here is signing in to the bridge (one sign-in at a time).
 * - Approve and Deny on a draft that is a bridge Approval go through
 *   ctx.bridge.actions.decide: Mission Control's path, log and sender.
 * - The day itself is the invented sample day (sample-day.ts) until the
 *   bridge gains the read verbs More Room proposes (more-room/DESIGN.md §5:
 *   "today's calendar", "inbox summary", "draft a reply"); then `store` is
 *   filled from them instead.
 *
 * Integration points: day-core.ts (the logic, shared with More Room's tests);
 * more-room/script (the world, which reads this wire).
 */

import type { Face, FaceContext, FaceReply } from "../types.js";
import type { WorldRequest } from "../../wire.js";
import { createCore, createStore, type Core } from "./day-core.js";
import { SAMPLE_DAY } from "./sample-day.js";

export const WORLDS = ["world://more-room.micknerks", "world://more-room-mr.micknerks"] as const;

let core: Core = createCore({ store: createStore(SAMPLE_DAY) });

const face: Face = {
  name: "more-room",
  worlds: WORLDS,
  async handle(op: string, req: WorldRequest, ctx: FaceContext): Promise<FaceReply> {
    if (ctx.killed) return { status: 503, body: "NO\tstopped on the PC\n" };
    const r = core.handle(op, req.fields, ctx.authed, {
      signIn: (pass) => ctx.signIn(pass),
      decide: (id, d) => ctx.bridge.actions.decide(id, d),
    });
    return { status: r.status, body: r.body, contentType: "text/plain; charset=utf-8" };
  },
  reset(): void {
    // A new sign-in starts from a fresh sample day; the real day will be re-read.
    core = createCore({ store: createStore(SAMPLE_DAY) });
  },
};

export default face;
