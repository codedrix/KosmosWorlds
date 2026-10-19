/**
 * server.ts -- the HTTP surface. Loopback only; the tunnel is the only way in.
 *
 * @kosmos-system  Agent bridge (Mission Control, DB-044)
 * @kosmos-owner   Platform
 *
 * What every request goes through, in order (a face can't skip any of it):
 *
 *   1. Host check: only 127.0.0.1:<port>, localhost:<port> or the configured
 *      tunnel host (a DNS-rebinding page can't reach the bridge by another name).
 *   2. No browser context: a request carrying Origin, Cookie or Referer is
 *      refused. The headset sends none of them (WORLD_NETWORK \u00a710.9); a web page
 *      always sends Origin on a POST, so no web page can drive the bridge.
 *   3. Size: request bodies over 16 KiB are refused (the headset's own cap).
 *   4. Rate: a global bucket (there is no identity to bucket by).
 *   5. The kill switch: when STOP exists, everything but the opt-in file and
 *      /v1/health answers 503 (faces draw "stopped on the PC").
 *   6. The token, checked here, passed to the face as `authed`.
 *
 * Routes:
 *   GET  /.well-known/world-network.json      the opt-in file (always served)
 *   GET  /privacy                             what this server keeps (the manifest's privacy_url)
 *   GET  /v1/health                           {"ok":true,"stopped":false}
 *   POST /v1/faces/<face>/<op>                a world's wall (wire.ts format)
 *   POST /v1/session                          {"passphrase"} -> {"token","expires_in"}
 *   POST /v1/session/end                      {"tok"}
 *   POST /v1/jobs                             {"tok"} -> job summaries
 *   POST /v1/jobs/start                       {"tok","preset","project"}
 *   POST /v1/jobs/new                         {"tok","text","project"}
 *   POST /v1/jobs/<id>/events                 {"tok","since"} -> events with seq > since
 *   POST /v1/jobs/<id>/message                {"tok","text"}
 *   POST /v1/jobs/<id>/stop                   {"tok"}
 *   POST /v1/approvals/<id>/decide            {"tok","decision":"approve"|"deny"|"why"}
 *
 * Logs carry method, path, status and time: never a body, a token or a header value.
 */

import crypto from "node:crypto";
import http from "node:http";
import type { Bridge } from "./bridge.js";
import type { Decision, Job } from "./jobs.js";
import type { Face } from "./faces/types.js";
import { parseWorldRequest } from "./wire.js";

export const MAX_BODY_BYTES = 16 * 1024;

/** The page the world's manifest names as its privacy_url (NET_004). Plain words, no tracking. */
export const PRIVACY_TEXT = [
  "Mission Control bridge - privacy",
  "",
  "This server runs on its owner's own computer and serves one person: the owner, who signs in",
  "with a passphrase inside the Kosmos world world://lobby.micknerks.",
  "",
  "What it receives: the buttons the owner presses on the wall and the words the owner types.",
  "What it sends back: short summaries of the owner's own Claude Code jobs (titles, status,",
  "Claude's replies, one line per action, and approval requests). File contents, command output",
  "and diffs never leave the computer.",
  "What it keeps: nothing about anyone else. The headset sends no identity. The server keeps",
  "its jobs in memory and writes a request log (method, path, status, time) to its own console;",
  "it stores no request bodies, no tokens and no addresses.",
  "",
  "Questions or deletion requests: privacy@kosmosvr.com",
  "",
].join("\n");
export const MAX_RESPONSE_EVENTS = 200;

export interface ServerOptions {
  port: number;
  /** The tunnel's public host name (e.g. "bridge.example.dev"); requests for it are accepted. */
  publicHost?: string;
  log?: (line: string) => void;
  /** Requests per second across everyone, and the burst (default 10 and 30). */
  rate?: { perSecond: number; burst: number };
}

class Bucket {
  private tokens: number;
  private last = Date.now();
  constructor(private readonly rate: number, private readonly burst: number) {
    this.tokens = burst;
  }
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

function jobSummary(j: Job, now: number) {
  return {
    id: j.id,
    agent: j.agent,
    project: j.project,
    title: j.title,
    status: j.status,
    started_at: new Date(j.startedAt).toISOString(),
    elapsed_s: Math.floor(((j.endedAt ?? now) - j.startedAt) / 1000),
    progress: j.progress ?? null,
    files_touched: j.files.size,
    outcome: j.outcome ?? null,
    // The session id lets the CEO pick the job up at the desk: claude --resume <id>.
    session_id: j.sessionId ?? null,
  };
}

export function createServer(bridge: Bridge, faces: Map<string, Face>, opts: ServerOptions): http.Server {
  const log = opts.log ?? ((l: string) => console.log(l));
  // Watchers long-poll too, so the global bucket leaves room for a group of them.
  const bucket = new Bucket(opts.rate?.perSecond ?? 20, opts.rate?.burst ?? 60);
  const publicHost = opts.publicHost?.toLowerCase();
  const hostAllowed = (host: string, localPort: number | undefined): boolean =>
    host === `127.0.0.1:${localPort}` || host === `localhost:${localPort}` || (publicHost !== undefined && (host === publicHost || host === `${publicHost}:443`));

  const worlds = new Set<string>(bridge.config.worlds);
  for (const f of faces.values()) for (const w of f.worlds) worlds.add(w);
  const wellKnown = JSON.stringify({ world_network: 1, worlds: [...worlds].sort() });

  const send = (res: http.ServerResponse, status: number, body: string, type = "application/json") => {
    res.writeHead(status, {
      "Content-Type": type,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
  };
  const json = (res: http.ServerResponse, status: number, v: unknown) => send(res, status, JSON.stringify(v));

  const handler = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<number> => {
    const host = (req.headers.host ?? "").toLowerCase();
    if (!hostAllowed(host, req.socket.localPort)) {
      json(res, 421, { error: "wrong_host" });
      return 421;
    }
    if (req.headers.origin !== undefined || req.headers.cookie !== undefined || req.headers.referer !== undefined) {
      json(res, 403, { error: "browser_context_refused" });
      return 403;
    }
    if (!bucket.take()) {
      res.setHeader("Retry-After", "1");
      json(res, 429, { error: "slow_down" });
      return 429;
    }
    const url = new URL(req.url ?? "/", "http://bridge.invalid");
    const p = url.pathname;

    if (req.method === "GET" && p === "/.well-known/world-network.json") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "max-age=300", "Content-Length": Buffer.byteLength(wellKnown) });
      res.end(wellKnown);
      return 200;
    }
    if (req.method === "GET" && p === "/privacy") {
      send(res, 200, PRIVACY_TEXT, "text/plain; charset=utf-8");
      return 200;
    }
    if (req.method === "GET" && p === "/v1/health") {
      json(res, 200, { ok: true, stopped: bridge.killed });
      return 200;
    }
    if (req.method !== "POST") {
      json(res, 405, { error: "post_only" });
      return 405;
    }
    // Behind the relay Worker (DB-044 option A), only the Worker knows this key.
    const relaySecret = bridge.config.relaySecret;
    if (relaySecret) {
      const got = Buffer.from(String(req.headers["x-relay-key"] ?? ""));
      const want = Buffer.from(relaySecret);
      if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) {
        json(res, 403, { error: "relay_only" });
        return 403;
      }
    }

    // Read the body, refusing anything over 16 KiB.
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > MAX_BODY_BYTES) {
        json(res, 413, { error: "too_large" });
        req.destroy();
        return 413;
      }
      chunks.push(c as Buffer);
    }
    const body = Buffer.concat(chunks).toString("utf8");

    const killed = bridge.killed;
    if (killed) void bridge.enforceKill();

    // Faces: the worlds' walls.
    const fm = /^\/v1\/faces\/([a-z0-9-]{1,32})\/([a-z]{1,16})$/.exec(p);
    if (fm) {
      const face = faces.get(fm[1] ?? "");
      if (!face) {
        json(res, 404, { error: "no_face" });
        return 404;
      }
      // X-World-Address is forgeable; it is a seat belt, not a lock. A world's
      // request always carries it, so a request without the right one is refused.
      const addr = String(req.headers["x-world-address"] ?? "");
      if (!face.worlds.some((w) => w === `world://${addr}`)) {
        json(res, 403, { error: "wrong_world" });
        return 403;
      }
      const wr = parseWorldRequest(body, req.headers["content-type"]);
      const authed = !killed && bridge.auth.check(wr.tok);
      const reply = await face.handle(fm[2] ?? "", wr, {
        bridge,
        authed,
        killed,
        signIn: (pass) => {
          if (killed) return { ok: false, reason: "locked" };
          const r = bridge.auth.signIn(pass);
          // Every new session starts with watching off: an old code never revives.
          if (r.ok) bridge.watch.close();
          return r;
        },
        signOut: () => {
          bridge.auth.signOut();
          bridge.watch.close();
          for (const f of faces.values()) f.reset();
          bridge.store.poke();
        },
        waitForChange: (ms) => bridge.store.waitForChange(bridge.store.currentVersion, ms),
      });
      send(res, reply.status ?? 200, reply.body, reply.contentType ?? "text/plain; charset=utf-8");
      return reply.status ?? 200;
    }

    if (killed) {
      json(res, 503, { error: "stopped_on_pc" });
      return 503;
    }

    let j: Record<string, unknown> = {};
    try {
      const parsed = body ? JSON.parse(body) : {};
      if (parsed && typeof parsed === "object") j = parsed as Record<string, unknown>;
    } catch {
      json(res, 400, { error: "bad_json" });
      return 400;
    }

    if (p === "/v1/session") {
      const r = bridge.auth.signIn(typeof j.passphrase === "string" ? j.passphrase : "");
      if (r.ok) {
        bridge.watch.close();
        for (const f of faces.values()) f.reset();
        json(res, 200, { token: r.token, expires_in: r.expiresInS });
        return 200;
      }
      const status = r.reason === "wrong" || r.reason === "not_set" ? 401 : 429;
      if (r.retryAfterS) res.setHeader("Retry-After", String(r.retryAfterS));
      json(res, status, { error: r.reason });
      return status;
    }

    if (!bridge.auth.check(typeof j.tok === "string" ? j.tok : undefined)) {
      json(res, 401, { error: "sign_in" });
      return 401;
    }
    const a = bridge.actions;
    const now = bridge.now();
    const out = (r: { ok: boolean; why?: string; job?: Job }) => {
      if (r.ok) json(res, 200, { ok: true, job: r.job ? jobSummary(r.job, now) : undefined });
      else json(res, 409, { ok: false, error: r.why });
      return r.ok ? 200 : 409;
    };

    if (p === "/v1/session/end") {
      bridge.auth.signOut();
          bridge.watch.close();
      for (const f of faces.values()) f.reset();
      json(res, 200, { ok: true });
      return 200;
    }
    if (p === "/v1/jobs") {
      json(res, 200, {
        jobs: bridge.store.list().map((x) => jobSummary(x, now)),
        approvals: bridge.store.pendingApprovals().map((x) => ({ id: x.id, job: x.jobId, number: x.number, title: x.title, command: x.command, exact: x.exact })),
        projects: a.projects(),
      });
      return 200;
    }
    if (p === "/v1/jobs/start") return out(await a.startPreset(String(j.preset ?? ""), String(j.project ?? a.projects()[0] ?? "")));
    if (p === "/v1/jobs/new") return out(await a.startTask(String(j.text ?? ""), String(j.project ?? a.projects()[0] ?? "")));

    const jm = /^\/v1\/jobs\/([a-z0-9]{1,16})\/(events|message|stop)$/.exec(p);
    if (jm) {
      const id = jm[1] ?? "";
      if (!bridge.store.jobs.has(id)) {
        json(res, 404, { error: "no_job" });
        return 404;
      }
      if (jm[2] === "events") {
        const since = typeof j.since === "number" ? j.since : 0;
        const events = bridge.store.eventsSince(id, since).slice(0, MAX_RESPONSE_EVENTS);
        json(res, 200, { job: jobSummary(bridge.store.jobs.get(id) as Job, now), events: events.map((e) => ({ id: e.id, seq: e.seq, at: new Date(e.at).toISOString(), kind: e.kind, text: e.text, approval: e.approvalId ?? null })) });
        return 200;
      }
      if (jm[2] === "message") return out(await a.send(id, String(j.text ?? "")));
      return out(await a.stop(id));
    }
    const am = /^\/v1\/approvals\/([a-z0-9]{1,16})\/decide$/.exec(p);
    if (am) {
      const d = String(j.decision ?? "");
      if (d !== "approve" && d !== "deny" && d !== "why") {
        json(res, 400, { error: "decision" });
        return 400;
      }
      return out(a.decide(am[1] ?? "", d as Decision));
    }
    json(res, 404, { error: "not_found" });
    return 404;
  };

  const server = http.createServer((req, res) => {
    const t0 = Date.now();
    handler(req, res)
      .then((status) => log(`${new Date().toISOString()} ${req.method} ${(req.url ?? "").split("?")[0]} ${status} ${Date.now() - t0}ms`))
      .catch((err) => {
        log(`${new Date().toISOString()} ${req.method} ${(req.url ?? "").split("?")[0]} 500 ${String((err as Error)?.message ?? err).slice(0, 120)}`);
        if (!res.headersSent) json(res, 500, { error: "internal" });
      });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}
