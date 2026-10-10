# Network test servers A and B (KOS-983, lane TW)

Two tiny Cloudflare Workers on workers.dev for the network device test. They sit
outside every production zone. Deployed 2026-10-10 under the CEO's delegation
for test-Worker deploys (`NETWORK_BUILD_PLAN.md`, lead addendum), on
"Micknerks@gmail.com's Account".

| | Worker | URL | Opted in? |
|---|---|---|---|
| **A** | `kosmos-net-test-a` | `https://kosmos-net-test-a.micknerks.workers.dev` | yes: `/.well-known/world-network.json` lists `world://net-check.micknerks` and `world://net-required.micknerks` |
| **B** | `kosmos-net-test-b` | `https://kosmos-net-test-b.micknerks.workers.dev` | **no**: it must record zero **world** requests for the whole session |

Each keeps its log in one SQLite-backed Durable Object, so a write is visible on
the next read. KV was not used, because its list is eventually consistent:
check 3 (post twice, then read both back) and B's zero both need a read that is
never stale. Logs record the path and `X-World-Address`, never a query or a body
(scores excepted, which are the point of `/score`). `[observability]` is on, so
`npx wrangler tail kosmos-net-test-a` also shows each request live.

## Server A routes

`src/index.js`'s header has the full table. In short: the opt-in file, `/echo`
(GET: the header audit; POST: echoes up to 1 KiB), `POST /score` and
`GET /scores`, `/big` (300 KiB), `/slow` (12 s), `/same-redirect` (302 to A),
`/cross-redirect` (307 to B), `/gzip` (`x-gzip`) and `/gzip-std` (`gzip`),
`/privacy`, `/hits`, and `/egress-check`.

`/egress-check` is the registry review's MED-1 check: a fixed
`fetch("https://127.0.0.1.nip.io/")` from the Workers runtime. It takes no
parameters, so it can never be used as a proxy. **Result, 2026-10-10: HTTP 403
from Cloudflare, `error code: 1002`** (the DNS name points to a prohibited IP).
The runtime refused the loopback-resolving name and nothing reached 127.0.0.1.

`src/gzip-bomb.js` is generated (its header has the one-line command): gzip -9
of 8 MiB of ASCII `0`, 8,176 bytes.

## Server B

Every request on any path and method is logged, except `GET /hits`. `/hits`
splits the log in two:

- **`world_count`**: requests carrying `X-World-Address` or a `Kosmos/` user
  agent. The headset sends both on every network call, so a headset that
  reached B matches either way. **This must be 0** (`"pass": true`).
- **`background_count`**: everything else, logged and never the verdict.
  Measured 2026-10-10: within seconds of B's URL appearing on a public GitHub
  PR, VirusTotal, python-requests and browser link-preview fetches hit `/` and
  `/favicon.ico` (15 by the time the split shipped). A witness that counted
  those would fail every session for a reason that has nothing to do with the
  headset.

The split was proven locally with `wrangler dev` (a plain request is
background; one with `X-World-Address` and one with a `Kosmos/` user agent are
both world requests), never by sending a world-shaped request to the deployed
B, so the deployed `world_count` has only ever been 0. It is computed from the stored
`X-World-Address` and user agent at read time, so rows logged
before the split are classified the same way.

## Deploy

```
cd net-test-servers/b && npx wrangler deploy
cd net-test-servers/a && npx wrangler deploy
```

Deploy B first: A's `SERVER_B_ORIGIN` (in `a/wrangler.toml`) points at it. No
secrets: neither Worker has any.

## Tearing down

When the network test is over: `npx wrangler delete --name kosmos-net-test-a`
and the same for `-b`. That also removes their logs. Do it only after the
worlds that name A are unpublished, or their opt-in check will start failing.
