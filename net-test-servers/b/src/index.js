/**
 * kosmos-net-test-b -- Server B for the network device test (KOS-983, lane TW).
 *
 * @kosmos-system  Content (KosmosWorlds) -- network test fixtures
 * @kosmos-owner   TW (KOS-983)
 *
 * Server B has NOT opted in: it serves no `/.well-known/world-network.json`
 * (that path answers 404 like every other unknown path). No world names it in
 * a `network.connect` list, so the registry never probes it either.
 *
 * Its whole job is to be a witness. It records EVERY request it receives, and
 * the device test passes only if it records ZERO for the whole session:
 *   - `net-check` calls B directly       -> the headset must refuse it (-2) before connecting;
 *   - Server A's `/cross-redirect` -> B  -> the headset must refuse the redirect (-2) and not follow it.
 * A non-zero count means a headset (or something else) reached a server that
 * never opted in -- the exact failure the opt-in exists to prevent.
 *
 * Routes:
 *   GET /hits    -> the hit log and the count. Reading it is NOT itself counted,
 *                   so checking the witness cannot spoil the evidence. Every
 *                   other request, on any path and any method, is counted.
 *
 * Integration points:
 *   - RESOLVE_SPEC_v1.0.md section 10.9.2 (the opt-in file B deliberately lacks)
 *   - E:\wt\p2b-notes\NETWORK_BUILD_PLAN.md section 3, device check 6
 */

import { DurableObject } from "cloudflare:workers";

/**
 * HitLog -- one strongly consistent log (a single SQLite-backed Durable Object).
 * KV was rejected for this: its list is eventually consistent, and a witness
 * whose zero might be a not-yet-visible one is no witness.
 */
export class HitLog extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS hits (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         ts TEXT NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL,
         world_address TEXT, user_agent TEXT, ip_country TEXT)`
    );
  }

  /** Record one hit. Params: a plain object of the fields above. Returns nothing. */
  record(hit) {
    this.ctx.storage.sql.exec(
      "INSERT INTO hits (ts, method, path, world_address, user_agent, ip_country) VALUES (?, ?, ?, ?, ?, ?)",
      hit.ts, hit.method, hit.path, hit.world_address, hit.user_agent, hit.ip_country
    );
  }

  /** Returns { count, recent: up to 50 newest hits }. Read-only. */
  summary() {
    const count = this.ctx.storage.sql.exec("SELECT COUNT(*) AS n FROM hits").one().n;
    const recent = this.ctx.storage.sql
      .exec("SELECT ts, method, path, world_address, user_agent, ip_country FROM hits ORDER BY id DESC LIMIT 50")
      .toArray();
    return { count, recent };
  }
}

/** The one log instance. */
function hitLog(env) {
  return env.HIT_LOG.get(env.HIT_LOG.idFromName("server-b"));
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2) + "\n", {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export default {
  /**
   * Every request: count it (unless it is the GET /hits read), log it, answer.
   * Side effects: one Durable Object write per counted request; one console line.
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    const log = hitLog(env);

    if (request.method === "GET" && url.pathname === "/hits") {
      const s = await log.summary();
      return json({
        server: "kosmos-net-test-b",
        opted_in: false,
        expected_count: 0,
        pass: s.count === 0,
        count: s.count,
        note: "Reading /hits is not counted. Any other request to this server is a test failure.",
        recent: s.recent,
      });
    }

    const hit = {
      ts: new Date().toISOString(),
      method: request.method,
      path: url.pathname,
      world_address: request.headers.get("x-world-address"),
      user_agent: request.headers.get("user-agent"),
      ip_country: request.cf && request.cf.country ? String(request.cf.country) : null,
    };
    // Path only: never the query, never a body.
    console.log(JSON.stringify({ server: "b", event: "UNEXPECTED_HIT", ...hit }));
    await log.record(hit);

    return json({ server: "kosmos-net-test-b", opted_in: false, error: "this server never opted in" }, 404);
  },
};
