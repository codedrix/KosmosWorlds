/**
 * relay-worker -- the bridge's always-on front door (DB-043, option A).
 *
 * @kosmos-system  Agent bridge (Mission Control, DB-043)
 * @kosmos-owner   Platform
 *
 * Why it exists:
 *   1. A stable https origin with no domain to buy: <name>.micknerks.workers.dev
 *      (the headset refuses kosmosvr.com and theworldpublishing.com hosts).
 *   2. The opt-in file and the privacy page stay up when the PC is off. The
 *      registry re-checks /.well-known/world-network.json weekly and drops the
 *      origin after a confirming failure 1-24 h later; a PC that sleeps would
 *      otherwise take Mission Control off the registry.
 *   3. A second lock: it adds X-Relay-Key, a secret only the Worker and the
 *      bridge know, so the tunnel's own URL is useless to anyone who finds it.
 *
 * It forwards POST /v1/* to the PC's tunnel (BRIDGE_ORIGIN) and nothing else:
 * only the body, Content-Type and X-World-Address go through; Cookie,
 * Authorization, Origin and Referer never do. It stores nothing and logs
 * nothing beyond Cloudflare's own request log.
 *
 * Settings (wrangler secrets, never in the repo):
 *   BRIDGE_ORIGIN   https://<the tunnel's host>   e.g. the Tailscale Funnel name
 *   RELAY_SECRET    a long random string; the same value goes in the bridge's config.json
 * Var (wrangler.toml): WORLDS = "world://mission-control.micknerks" (comma-separated)
 */

const PRIVACY = [
  "Mission Control bridge - privacy",
  "",
  "This server relays requests to one person's own computer and serves one person: its owner, who",
  "signs in with a passphrase inside the Kosmos world world://mission-control.micknerks.",
  "It receives the buttons the owner presses and the words the owner types, and returns short",
  "summaries of the owner's own Claude Code jobs. File contents, command output and diffs never",
  "leave the computer. Nothing about anyone else is kept; the headset sends no identity.",
  "",
  "Questions or deletion requests: privacy@kosmosvr.com",
  "",
].join("\n");

const MAX_BODY = 16 * 1024;

function text(body, status = 200, type = "text/plain; charset=utf-8", extra = {}) {
  return new Response(body, { status, headers: { "Content-Type": type, "X-Content-Type-Options": "nosniff", ...extra } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const worlds = String(env.WORLDS ?? "")
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean);

    if (request.method === "GET" && url.pathname === "/.well-known/world-network.json") {
      return text(JSON.stringify({ world_network: 1, worlds }), 200, "application/json", { "Cache-Control": "max-age=300" });
    }
    if (request.method === "GET" && url.pathname === "/privacy") return text(PRIVACY);
    if (request.method !== "POST" || !url.pathname.startsWith("/v1/")) return text("not found\n", 404);
    if (request.headers.has("origin") || request.headers.has("cookie") || request.headers.has("referer")) {
      return text('{"error":"browser_context_refused"}', 403, "application/json");
    }
    if (!env.BRIDGE_ORIGIN || !env.RELAY_SECRET) return text('{"error":"relay_not_configured"}', 503, "application/json");

    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY) return text('{"error":"too_large"}', 413, "application/json");

    const headers = new Headers({ "X-Relay-Key": env.RELAY_SECRET });
    const ct = request.headers.get("content-type");
    if (ct) headers.set("Content-Type", ct);
    const addr = request.headers.get("x-world-address");
    if (addr) headers.set("X-World-Address", addr);

    let upstream;
    try {
      upstream = await fetch(new URL(url.pathname, env.BRIDGE_ORIGIN).toString(), { method: "POST", body, headers, redirect: "manual" });
    } catch {
      // The PC is off, asleep or the tunnel is down: the world shows "Can't reach the bridge".
      return text('{"error":"bridge_unreachable"}', 502, "application/json");
    }
    if (upstream.status >= 300 && upstream.status < 400) return text('{"error":"bridge_redirected"}', 502, "application/json");
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("content-type") ?? "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  },
};
