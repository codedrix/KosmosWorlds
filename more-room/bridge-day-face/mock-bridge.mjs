/**
 * mock-bridge.mjs -- the shared agent bridge, as far as More Room meets it.
 *
 * @kosmos-system  Content (KosmosWorlds) -- More Room
 * @kosmos-owner   More Room v1 (design session 2026-10-14)
 *
 * A model of agent-bridge/src/server.ts (KosmosWorlds branch feat/mission-control,
 * PR #5; API.md) for the world's tests, running More Room's REAL face logic
 * (agent-bridge/src/faces/more-room/day-core.ts) under Node's type stripping:
 *   node --experimental-strip-types more-room/tools/scenario.mjs
 *
 * Modelled from server.ts and auth.ts (read 2026-10-14):
 *   - GET /.well-known/world-network.json lists every face's worlds;
 *   - POST /v1/faces/<face>/<op>: 403 unless X-World-Address is one of the
 *     face's worlds; the body is parsed as JSON into fields ([a-z]{1,12} keys,
 *     values cut to 200 characters); `tok` checks the one session;
 *   - POST /v1/session {"passphrase"} -> {"token","expires_in"}, 401/429;
 *     POST /v1/session/end {"tok"};
 *   - one session for the whole bridge: 30 min idle, 8 h absolute; one try per
 *     2 s; 5 wrong in a row locks for 15 min.
 * Not modelled: the relay Worker, the tunnel, the kill switch, Claude's jobs.
 */

import crypto from "node:crypto";
import { createCore, createStore } from "../../agent-bridge/src/faces/more-room/day-core.ts";
import { SAMPLE_DAY } from "../../agent-bridge/src/faces/more-room/sample-day.ts";

export const FACE = "more-room";
export const WORLDS = ["world://more-room.micknerks", "world://more-room-mr.micknerks"];
export const LIMITS = Object.freeze({ requestMaxBytes: 16 * 1024, responseMaxBytes: 256 * 1024 });
const IDLE_MS = 30 * 60 * 1000;
const ABSOLUTE_MS = 8 * 3600 * 1000;

/**
 * @param opts.passphrase  the bridge passphrase (default "sample-day", the mock's test value)
 * @param opts.store       a day store (default: the sample day)
 * @param opts.nowMin      () => minutes after midnight, for the room's clock
 * @param opts.nowMs       () => epoch ms, for sessions and lockouts
 * @param opts.dev         enable the face op "arrive" (lands the next sample message)
 */
export function createMockBridge(opts = {}) {
  const passphrase = opts.passphrase ?? "sample-day";
  const nowMs = opts.nowMs ?? (() => Date.now());
  const store = opts.store ?? createStore(SAMPLE_DAY);
  const core = createCore({ store, nowMin: opts.nowMin, nowMs, dev: opts.dev });
  let session = null; // {hash, createdAt, lastSeen}
  let cutNext = false; // tests: cut the next whole-day answer short
  let lastAttempt = -1e15;
  let wrongInRow = 0;
  let lockUntil = 0;
  const hash = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");

  function signIn(pass) {
    const t = nowMs();
    if (t < lockUntil) return { ok: false, reason: "locked", retryAfterS: Math.ceil((lockUntil - t) / 1000) };
    if (t - lastAttempt < 2000) return { ok: false, reason: "too_fast", retryAfterS: 2 };
    lastAttempt = t;
    const a = Buffer.from(String(pass)), b = Buffer.from(passphrase);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      if (++wrongInRow >= 5) {
        lockUntil = t + 15 * 60 * 1000;
        wrongInRow = 0;
      }
      return { ok: false, reason: "wrong" };
    }
    wrongInRow = 0;
    const token = crypto.randomBytes(32).toString("base64url"); // 43 characters, as auth.ts
    session = { hash: hash(token), createdAt: t, lastSeen: t }; // one sign-in at a time
    return { ok: true, token, expiresInS: IDLE_MS / 1000 };
  }

  function check(tok) {
    const t = nowMs();
    if (!session || !tok || hash(tok) !== session.hash) return false;
    if (t - session.lastSeen > IDLE_MS || t - session.createdAt > ABSOLUTE_MS) {
      session = null;
      return false;
    }
    session.lastSeen = t;
    return true;
  }

  const json = (status, v) => ({ status, contentType: "application/json", body: JSON.stringify(v) });

  /** One request, as server.ts would answer it. headers: lower-case names. */
  function handle(method, path, raw, headers = {}) {
    const body = Buffer.from(raw ?? []).toString("utf8");
    if (method === "GET" && path === "/.well-known/world-network.json") {
      return json(200, { world_network: 1, worlds: [...WORLDS].sort() });
    }
    if (method === "GET" && path === "/privacy") {
      return { status: 200, contentType: "text/plain", body: "Agent bridge (mock). It serves one person's day to their own worlds.\n" };
    }
    if (method !== "POST") return json(405, { error: "post_only" });
    if (Buffer.byteLength(body) > LIMITS.requestMaxBytes) return json(413, { error: "too_large" });

    const fm = /^\/v1\/faces\/([a-z0-9-]{1,32})\/([a-z]{1,16})$/.exec(path);
    if (fm) {
      if (fm[1] !== FACE) return json(404, { error: "no_face" });
      const addr = String(headers["x-world-address"] ?? "");
      if (!WORLDS.includes(`world://${addr}`)) return json(403, { error: "wrong_world" });
      const fields = {};
      try {
        const j = JSON.parse(body || "{}");
        for (const [k, v] of Object.entries(j)) {
          if (/^[a-z]{1,12}$/.test(k) && (typeof v === "string" || typeof v === "number")) fields[k] = String(v).slice(0, 200);
        }
      } catch {
        // server.ts falls back to the AB1 line format; More Room never sends it.
      }
      const r = core.handle(fm[2], fields, check(fields.tok), { signIn });
      if (cutNext && fm[2] === "changes" && r.status === 200 && !r.body.includes("\nSAME\n")) {
        // Tests only: a whole-day answer cut short, as a dropped connection would leave it.
        cutNext = false;
        return { status: 200, contentType: "text/plain; charset=utf-8", body: r.body.slice(0, Math.floor(r.body.length / 2)) };
      }
      return { status: r.status, contentType: "text/plain; charset=utf-8", body: r.body };
    }

    let j = {};
    try {
      j = JSON.parse(body || "{}");
    } catch {
      return json(400, { error: "bad_json" });
    }
    if (path === "/v1/session") {
      const r = signIn(typeof j.passphrase === "string" ? j.passphrase : "");
      if (r.ok) return json(200, { token: r.token, expires_in: r.expiresInS });
      return json(r.reason === "wrong" ? 401 : 429, { error: r.reason });
    }
    if (!check(j.tok)) return json(401, { error: "sign_in" });
    if (path === "/v1/session/end") {
      session = null;
      return json(200, { ok: true });
    }
    return json(404, { error: "not_here" });
  }

  return { handle, core, store, signOut: () => (session = null), cutNextAnswer: () => (cutNext = true) };
}
