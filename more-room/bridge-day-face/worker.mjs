/**
 * worker.mjs -- a SKETCH of the always-on front for the bridge (PUBLISH.md 0.3).
 * Never deployed by this lane: deploying a public endpoint is the CEO's act.
 *
 * @kosmos-system  Content (KosmosWorlds) -- More Room
 * @kosmos-owner   More Room v1 (design session 2026-10-14)
 *
 * Why it exists: the registry fetches /.well-known/world-network.json at
 * register and about weekly. An origin that fails a weekly check and its
 * confirming re-check (1-24 h later) is dropped from `network_origins` until a
 * later pass (kosmos-registry workers/networkOriginRecheck.ts). A PC that
 * sleeps through both would take the room offline for up to a week. This
 * Worker answers the opt-in file and /privacy itself, and forwards /day/* to
 * the bridge through the tunnel.
 *
 * Settings (wrangler vars and secrets, names to agree with Mission Control):
 *   TUNNEL_ORIGIN   e.g. https://bridge.<the CEO's tunnel hostname>  (secret or var)
 *   FRONT_SECRET    a shared secret the bridge checks on every forwarded request,
 *                   so the tunnel answers only this Worker (secret)
 *
 * It forwards bodies as they are, adds no cookie, and never logs a body (the
 * session route carries the passphrase).
 */

import { WORLDS, LIMITS } from "./day-face.mjs";

const PRIVACY =
  "More Room bridge. It serves one person's day (calendar, messages, tasks) to the worlds " +
  "world://more-room.micknerks and world://more-room-mr.micknerks, after that person signs in. " +
  "It keeps no data about anyone else, and no visitor data at all.\n";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/.well-known/world-network.json") {
      return new Response(JSON.stringify({ world_network: 1, worlds: WORLDS }), {
        headers: { "content-type": "application/json", "cache-control": "max-age=300" },
      });
    }
    if (request.method === "GET" && url.pathname === "/privacy") {
      return new Response(PRIVACY, { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    if (!url.pathname.startsWith("/day/v1/") || request.method !== "POST") {
      return new Response("NO\tnot here\n", { status: 404, headers: { "content-type": "text/plain" } });
    }
    const body = await request.arrayBuffer();
    if (body.byteLength > LIMITS.requestMaxBytes) {
      return new Response("NO\ttoo large\n", { status: 413, headers: { "content-type": "text/plain" } });
    }
    try {
      const upstream = await fetch(env.TUNNEL_ORIGIN + url.pathname, {
        method: "POST",
        body,
        headers: { "content-type": "application/json", "x-front-secret": env.FRONT_SECRET },
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
      });
      const text = await upstream.text();
      return new Response(text, {
        status: upstream.status,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      });
    } catch {
      // The PC is asleep or the tunnel is down: say so in the room's words.
      return new Response("NO\tbridge asleep\n", { status: 503, headers: { "content-type": "text/plain" } });
    }
  },
};
