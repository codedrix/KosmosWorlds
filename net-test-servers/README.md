# Network test servers A and B (KOS-983, lane TW)

Two tiny Cloudflare Workers on workers.dev for the network device test. They sit
outside every production zone. Deployed 2026-10-10 under the CEO's delegation
for test-Worker deploys (`NETWORK_BUILD_PLAN.md`, lead addendum), on
"Micknerks@gmail.com's Account".

| | Worker | URL | Opted in? |
|---|---|---|---|
| **A** | `kosmos-net-test-a` | `https://kosmos-net-test-a.micknerks.workers.dev` | yes: `/.well-known/world-network.json` lists `world://net-check.micknerks` and `world://net-required.micknerks` |
| **B** | `kosmos-net-test-b` | `https://kosmos-net-test-b.micknerks.workers.dev` | **no**: it must record zero hits for the whole session |

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

Every request on any path and method is counted, except `GET /hits`, which
reports the count and the 50 newest hits. **Do not open any other B URL**:
that is a real hit and fails the test. The counter was proven locally with
`wrangler dev` (two requests, count 2) rather than against the deployed Worker,
so the deployed B has never been hit.

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
