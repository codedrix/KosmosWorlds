/**
 * kosmos-net-test-a -- Server A (opted in) for the network device test (KOS-983, lane TW).
 *
 * @kosmos-system  Content (KosmosWorlds) -- network test fixtures
 * @kosmos-owner   TW (KOS-983)
 *
 * The one origin `world://net-check.micknerks` and `world://net-required.micknerks`
 * declare in `network.connect`. It opts in by serving the well-known file, and it
 * has one route per device check in NETWORK_BUILD_PLAN.md section 3.
 *
 * | Route                          | Device check | What it does |
 * |--------------------------------|--------------|--------------|
 * | GET  /.well-known/world-network.json | 1 | the opt-in: 200, application/json, the two test worlds |
 * | GET  /echo                     | 2, 8         | server time + the header audit (Cookie/Authorization/Referer/Origin present? X-World-Address value) |
 * | POST /echo                     | --           | echoes a small body (<= 1 KiB) back, plus the audit |
 * | POST /score                    | 3            | stores {name, score} (strongly consistent: a Durable Object) |
 * | GET  /scores                   | 3            | the top 10 |
 * | GET  /big                      | 4            | 300 KiB of text: over the 256 KiB response cap, so the headset answers -5 |
 * | GET  /slow                     | 5, 14        | answers after 12 s: past the 10 s request timeout, so the headset answers 0 |
 * | GET  /same-redirect            | 6            | 302 -> this origin's /echo (followed: 200) |
 * | GET  /cross-redirect           | 6            | 307 -> Server B (refused: -2; B must record no hit) |
 * | GET  /gzip                     | 7            | Content-Encoding: x-gzip over 8 MiB of zeros (refused at the header: 0, no memory spike) |
 * | GET  /gzip-std                 | 7 (variant)  | the same labelled gzip: Cloudflare inflates it for an identity client, so -5 |
 * | GET  /privacy                  | --           | the privacy page the manifests' `privacy_url` points at |
 * | GET  /hits                     | --           | this server's hit log (method, path, X-World-Address, header audit) |
 * | GET  /egress-check             | registry MED-1 | a plain fetch("https://127.0.0.1.nip.io/") from the Workers runtime, and what happened |
 *
 * Every request is logged (console + the hit log) with its path and the
 * `X-World-Address` header. Never a query string and never a body.
 *
 * Integration points:
 *   - RESOLVE_SPEC_v1.0.md section 10.9 (opt-in file, headers, limits)
 *   - CONTENT_SPEC_v1.0.md section 3 (the manifest `network` block that names this origin)
 *   - net-check/src/lib.rs (the world whose buttons call these routes)
 */

import { DurableObject } from "cloudflare:workers";
import { GZIP_BOMB_B64, GZIP_BOMB_DECODED_BYTES } from "./gzip-bomb.js";

/** The worlds this origin opts in to (RESOLVE_SPEC 10.9.2). */
const OPTED_IN_WORLDS = ["world://net-check.micknerks", "world://net-required.micknerks"];

/** /big: 300 KiB, comfortably over the 262,144-byte response cap. */
const BIG_BYTES = 300 * 1024;
/** /slow: 12 s, past the 10,000 ms request timeout. */
const SLOW_MS = 12000;
/** POST /echo and POST /score bodies are clipped to this. */
const MAX_ECHO_BYTES = 1024;

// ---------------------------------------------------------------------------
// The log: one SQLite-backed Durable Object, so a score written is a score read
// back on the very next request (KV's list is eventually consistent, and check 3
// is "POST twice, then GET: both entries are back").
// ---------------------------------------------------------------------------

export class TestLog extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS hits (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         ts TEXT NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL,
         world_address TEXT, user_agent TEXT,
         cookie INTEGER, authorization INTEGER, referer INTEGER, origin INTEGER,
         accept TEXT, accept_encoding TEXT, content_type TEXT)`
    );
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS scores (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         ts TEXT NOT NULL, name TEXT NOT NULL, score INTEGER NOT NULL, world_address TEXT)`
    );
  }

  /** Record one request. Param: the audit object from auditHeaders(). Returns nothing. */
  recordHit(a) {
    this.ctx.storage.sql.exec(
      `INSERT INTO hits (ts, method, path, world_address, user_agent, cookie, authorization, referer, origin,
                         accept, accept_encoding, content_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      a.ts, a.method, a.path, a.addr, a.ua,
      a.cookie ? 1 : 0, a.auth ? 1 : 0, a.referer ? 1 : 0, a.origin ? 1 : 0,
      a.accept, a.ae, a.ct
    );
  }

  /** Returns { count, recent: the 50 newest hits }. Read-only. */
  hits() {
    const count = this.ctx.storage.sql.exec("SELECT COUNT(*) AS n FROM hits").one().n;
    const recent = this.ctx.storage.sql.exec("SELECT * FROM hits ORDER BY id DESC LIMIT 50").toArray();
    return { count, recent };
  }

  /** Store one score. Returns the stored row and how many scores exist. */
  addScore(name, score, addr) {
    const ts = new Date().toISOString();
    this.ctx.storage.sql.exec(
      "INSERT INTO scores (ts, name, score, world_address) VALUES (?, ?, ?, ?)", ts, name, score, addr
    );
    const total = this.ctx.storage.sql.exec("SELECT COUNT(*) AS n FROM scores").one().n;
    return { ts, name, score, total };
  }

  /** Returns the top 10 scores, highest first, newest first on a tie. */
  topScores() {
    return this.ctx.storage.sql
      .exec("SELECT name, score, ts FROM scores ORDER BY score DESC, id DESC LIMIT 10")
      .toArray();
  }
}

function testLog(env) {
  return env.TEST_LOG.get(env.TEST_LOG.idFromName("server-a"));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The header audit for one request (device check 2). Booleans for the four
 * headers a headset must NEVER send, the values of the ones it must.
 */
function auditHeaders(request, url) {
  const h = request.headers;
  return {
    ts: new Date().toISOString(),
    method: request.method,
    path: url.pathname,
    addr: h.get("x-world-address"),
    cookie: h.has("cookie"),
    auth: h.has("authorization"),
    referer: h.has("referer"),
    origin: h.has("origin"),
    ua: h.get("user-agent"),
    accept: h.get("accept"),
    ae: h.get("accept-encoding"),
    ct: h.get("content-type"),
  };
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

function text(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

/** Read at most `max` bytes of the request body as UTF-8 (lossy). */
async function readClipped(request, max) {
  const buf = new Uint8Array(await request.arrayBuffer());
  return { text: new TextDecoder().decode(buf.subarray(0, max)), bytes: buf.length };
}

/**
 * The registry review's MED-1 egress check: can the Workers runtime reach a
 * name that resolves to loopback? `127.0.0.1.nip.io` resolves to 127.0.0.1.
 * The target is FIXED -- this route takes no parameters, so it is never a proxy.
 * Returns a JSON-able description of what happened; never throws.
 */
async function egressCheck() {
  const target = "https://127.0.0.1.nip.io/";
  const started = Date.now();
  try {
    const r = await fetch(target, { redirect: "manual", signal: AbortSignal.timeout(8000) });
    let snippet = "";
    try {
      snippet = (await r.text()).slice(0, 300);
    } catch (e) {
      snippet = `<body read failed: ${e && e.message}>`;
    }
    return {
      target,
      outcome: "response",
      status: r.status,
      status_text: r.statusText,
      server: r.headers.get("server"),
      cf_ray: r.headers.get("cf-ray"),
      content_type: r.headers.get("content-type"),
      body_snippet: snippet,
      elapsed_ms: Date.now() - started,
    };
  } catch (e) {
    return {
      target,
      outcome: "error",
      error_name: e && e.name,
      error_message: e && String(e.message),
      elapsed_ms: Date.now() - started,
    };
  }
}

const PRIVACY_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Network test server: privacy</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;color:#111;background:#fff}</style>
</head><body>
<h1>Network test server: privacy</h1>
<p>This server exists only to test how the worlds <code>world://net-check.micknerks</code> and
<code>world://net-required.micknerks</code> talk to the internet. It is run by the Kosmos team for testing.</p>
<h2>What it records</h2>
<ul>
<li>For each request: the time, the method, the path, the world address the browser sends, the browser's
user-agent string, and whether a cookie, login, referrer or origin header arrived (yes or no only).</li>
<li>Scores you submit from the test world: the name and number in the request.</li>
</ul>
<p>It does not record query strings, request bodies other than scores, or anything that identifies your account or device.
Cloudflare, which hosts this server, processes your network address to deliver the response.</p>
<h2>How long, and deletion</h2>
<p>The records are test data and are deleted when the test ends. To ask for deletion sooner, email
<a href="mailto:privacy@kosmosvr.com">privacy@kosmosvr.com</a>.</p>
</body></html>
`;

/**
 * A gzip-bomb response carrying the given Content-Encoding label.
 * encodeBody "manual": the bytes are already encoded and Workers must not re-encode them.
 */
function gzipResponse(label) {
  return new Response(gzipBombBytes(), {
    status: 200,
    encodeBody: "manual",
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-encoding": label,
      "cache-control": "no-store, no-transform",
      "x-decoded-bytes": String(GZIP_BOMB_DECODED_BYTES),
    },
  });
}

function gzipBombBytes() {
  const bin = atob(GZIP_BOMB_B64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// The router
// ---------------------------------------------------------------------------

export default {
  /**
   * Log, then route. Side effects: one Durable Object write per request (two for
   * POST /score); one console line per request (path and X-World-Address only).
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const audit = auditHeaders(request, url);
    const log = testLog(env);

    console.log(JSON.stringify({ server: "a", method: audit.method, path: audit.path, x_world_address: audit.addr }));
    // The log write must not delay /slow's clock or a redirect, so it runs beside the response.
    ctx.waitUntil(log.recordHit(audit));

    const route = `${request.method} ${url.pathname}`;
    switch (route) {
      case "GET /.well-known/world-network.json":
        return json({ world_network: 1, worlds: OPTED_IN_WORLDS });

      case "GET /echo":
        // Audit fields first: the world shows the first ~190 bytes of the body.
        // `ae` is NOT evidence of what the headset sent: measured 2026-10-10, the
        // Cloudflare edge rewrites Accept-Encoding before the Worker sees it (curl's
        // `identity` arrives as "gzip, br"). /gzip is the real Accept-Encoding test.
        return json({
          addr: audit.addr,
          cookie: audit.cookie,
          auth: audit.auth,
          referer: audit.referer,
          origin: audit.origin,
          t: audit.ts,
          ae: audit.ae,
          accept: audit.accept,
          ua: audit.ua,
        });

      case "POST /echo": {
        const body = await readClipped(request, MAX_ECHO_BYTES);
        return json({ addr: audit.addr, ct: audit.ct, bytes: body.bytes, echo: body.text, t: audit.ts });
      }

      case "POST /score": {
        const body = await readClipped(request, MAX_ECHO_BYTES);
        let name = "anon";
        let score = 0;
        try {
          const v = JSON.parse(body.text);
          if (v && typeof v.name === "string") name = v.name.slice(0, 32);
          if (v && Number.isFinite(v.score)) score = Math.trunc(v.score);
        } catch {
          return json({ ok: false, error: "body must be JSON {name, score}" }, 400);
        }
        const row = await log.addScore(name, score, audit.addr);
        return json({ ok: true, n: row.name, s: row.score, total: row.total });
      }

      case "GET /scores": {
        const top = await log.topScores();
        return json(top.map((r) => ({ n: r.name, s: r.score })));
      }

      case "GET /big":
        return text("x".repeat(BIG_BYTES));

      case "GET /slow":
        await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
        return json({ slow: true, waited_ms: SLOW_MS, t: new Date().toISOString() });

      case "GET /same-redirect":
        return new Response(null, { status: 302, headers: { location: `${url.origin}/echo`, "cache-control": "no-store" } });

      case "GET /cross-redirect":
        return new Response(null, {
          status: 307,
          headers: { location: `${env.SERVER_B_ORIGIN}/echo`, "cache-control": "no-store" },
        });

      case "GET /gzip":
        // The gzip bomb, labelled with the RFC 9110 alias `x-gzip`. Measured 2026-10-10:
        // the Cloudflare edge INFLATES a `Content-Encoding: gzip` body for a client that
        // sends `Accept-Encoding: identity` (the headset always does), so a plain `gzip`
        // label never reaches the headset (see /gzip-std). `x-gzip` passes through
        // untouched (8,176 bytes, magic 1f 8b), so this is the route that tests the
        // client's refusal of a non-identity Content-Encoding before the first body byte.
        return gzipResponse("x-gzip");

      case "GET /gzip-std":
        // The same bomb labelled plain `gzip`. Through Cloudflare it reaches the headset
        // INFLATED: 8 MiB of identity text with no Content-Encoding. The expected device
        // answer is therefore -5 (over 256 KiB) with no memory spike, not "no answer".
        return gzipResponse("gzip");

      case "GET /privacy":
        return new Response(PRIVACY_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });

      case "GET /hits":
        return json({ server: "kosmos-net-test-a", ...(await log.hits()) });

      case "GET /egress-check":
        return json(await egressCheck());

      case "GET /":
        return text(
          "kosmos-net-test-a: network test server A (opted in). Routes: /.well-known/world-network.json, " +
            "/echo, POST /echo, POST /score, /scores, /big, /slow, /same-redirect, /cross-redirect, /gzip, /gzip-std, " +
            "/privacy, /hits, /egress-check\n"
        );

      default:
        return json({ error: "not found", path: url.pathname }, 404);
    }
  },
};
