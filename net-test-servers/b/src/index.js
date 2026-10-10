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
 * the device test passes only if it records ZERO WORLD REQUESTS for the whole session:
 *   - `net-check` calls B directly       -> the headset must refuse it (-2) before connecting;
 *   - Server A's `/cross-redirect` -> B  -> the headset must refuse the redirect (-2) and not follow it.
 * A non-zero world count means a headset reached a server that never opted
 * in -- the exact failure the opt-in exists to prevent.
 *
 * A "world request" is one carrying `X-World-Address` OR a `Kosmos/` user agent:
 * the headset sends both on every network call (RESOLVE_SPEC 10.9.5), so a
 * headset request matches even if one of the two were lost. Everything else is
 * BACKGROUND (still logged, never the verdict). Measured 2026-10-10: within
 * seconds of B's URL appearing on a public GitHub PR, VirusTotal, python-requests
 * and browser link-preview fetches hit `/` and `/favicon.ico`. A witness that
 * counted them would fail every session for a reason unrelated to the headset.
 *
 * Routes:
 *   GET /hits    -> the verdict, both counts and the newest hits of each kind.
 *                   Reading it is NOT itself logged, so checking the witness
 *                   cannot spoil the evidence. Every other request, on any path
 *                   and any method, is logged.
 *
 * Integration points:
 *   - RESOLVE_SPEC_v1.0.md section 10.9.2 (the opt-in file B deliberately lacks)
 *   - E:\wt\p2b-notes\NETWORK_BUILD_PLAN.md section 3, device check 6
 */

import { DurableObject } from "cloudflare:workers";

/**
 * A world request: the headset's X-World-Address, or its `Kosmos/<version>`
 * user agent (SQLite LIKE is ASCII case-insensitive, which is the safe side here).
 */
const WORLD_HIT_SQL = "(world_address IS NOT NULL OR user_agent LIKE 'Kosmos/%')";

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

  /**
   * Returns { world_count, background_count, world_recent, background_recent }
   * (up to 25 newest of each). Read-only. The classification is computed here,
   * not stored, so rows logged before it existed are classified the same way.
   */
  summary() {
    const sql = this.ctx.storage.sql;
    const cols = "ts, method, path, world_address, user_agent, ip_country";
    const count = (where) => sql.exec(`SELECT COUNT(*) AS n FROM hits WHERE ${where}`).one().n;
    const recent = (where) => sql.exec(`SELECT ${cols} FROM hits WHERE ${where} ORDER BY id DESC LIMIT 25`).toArray();
    return {
      world_count: count(WORLD_HIT_SQL),
      background_count: count(`NOT (${WORLD_HIT_SQL})`),
      world_recent: recent(WORLD_HIT_SQL),
      background_recent: recent(`NOT (${WORLD_HIT_SQL})`),
    };
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
   * Every request: log it (unless it is the GET /hits read), answer 404.
   * Side effects: one Durable Object write per logged request; one console line.
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    const log = hitLog(env);

    if (request.method === "GET" && url.pathname === "/hits") {
      const s = await log.summary();
      return json({
        server: "kosmos-net-test-b",
        opted_in: false,
        pass: s.world_count === 0,
        world_count: s.world_count,
        expected_world_count: 0,
        background_count: s.background_count,
        note:
          "A world request carries X-World-Address or a Kosmos/ user agent; any one of them fails the test. " +
          "Background requests (crawlers, link previews, people opening this URL) are logged but never the verdict. " +
          "Reading /hits is not logged.",
        world_recent: s.world_recent,
        background_recent: s.background_recent,
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
    const isWorld = hit.world_address !== null || (hit.user_agent || "").toLowerCase().startsWith("kosmos/");
    console.log(JSON.stringify({ server: "b", event: isWorld ? "WORLD_HIT_TEST_FAILURE" : "background_hit", ...hit }));
    await log.record(hit);

    return json({ server: "kosmos-net-test-b", opted_in: false, error: "this server never opted in" }, 404);
  },
};
