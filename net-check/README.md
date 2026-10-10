# Network Check (`world://net-check.micknerks`)

The device-test world for **worlds that call servers** (DB-038, the network
cook, host API level 4). Each button makes one request and the board shows the
answer, what was expected, and `PASS` or `CHECK`. It goes with
`net-required.micknerks` (`../net-required/`) and the two test servers in
`../net-test-servers/`.

- **Ticket:** KOS-983 (lane TW of `NETWORK_BUILD_PLAN.md`; the device check list is its §3)
- **Host API level:** **4**: it imports `k_net_fetch`, `k_net_read` and `k_net_status`
- **Capabilities:** `scene_read`, `events`, `ui_basic`, `network`. None of
  `player_read`, `scene_query` or `spatial_anchor` (NET_005, NET_006)
- **Publish as:** **unlisted**, under `micknerks`
- **Size:** 396 triangles, 33 mesh nodes, no textures, a 7.6 KB wasm module, a 23 KB bundle

## The servers

| | Address | Opted in? | Job |
|---|---|---|---|
| **A** | `https://kosmos-net-test-a.micknerks.workers.dev` | yes | every route the buttons call |
| **B** | `https://kosmos-net-test-b.micknerks.workers.dev` | **no** | the witness: it must record **zero world requests** all session |

Read B's verdict at `https://kosmos-net-test-b.micknerks.workers.dev/hits`: the
check is `"world_count": 0` (`"pass": true`). A world request is one carrying
`X-World-Address` or a `Kosmos/` user agent, which the headset sends on every
call. Anything else, such as crawlers, link previews or you opening a B address
in a browser, is logged as `background_count` and never fails the test. B's
URL drew VirusTotal and python-requests fetches within seconds of appearing on
a public PR, which is why the verdict is not the raw count. A's request log is
at `https://kosmos-net-test-a.micknerks.workers.dev/hits` (method, path,
`X-World-Address`, and whether a Cookie, Authorization, Referer or Origin header
arrived).

## The buttons

Eleven buttons stand on an arc 1.6 m in front of the spawn. The board behind
them shows, top to bottom: the title; `k_net_status` and the last button
pressed; the result line; four lines of the response body; the counters.

| Button | Request | Expected on the board | Plan §3 check |
|---|---|---|---|
| **ECHO** | GET A `/echo` | `HTTP 200 … (expect 200) PASS`. The body starts `{"addr":"net-check.micknerks","cookie":false,"auth":false,"referer":false,"origin":false,…` | 2, 8 |
| **SCORE +** | POST A `/score`, JSON `{"name":"quest","score":101}` (the score goes up by one per press) | `HTTP 200`, body `{"ok":true,…}` | 3 |
| **SCORES** | GET A `/scores` | `HTTP 200`, the top 10, including the ones just posted | 3 |
| **NAME (prompt)** | opens the system prompt sheet, then POSTs the answer as the score name | the sheet's footer says the answer can be sent to `kosmos-net-test-a…`; then `HTTP 200` | 16 |
| **BIG 300K** | GET A `/big` (300 KiB) | `-5 too large (expect -5) PASS` | 4 |
| **SLOW 12s** | GET A `/slow` (answers after 12 s) | `0 no answer` after about 10 s | 5, 14 |
| **REDIR A** | GET A `/same-redirect` (302 to A `/echo`) | `HTTP 200` | 6 |
| **REDIR to B** | GET A `/cross-redirect` (307 to B) | `-2 refused in flight`, and B's `/hits` still reads `world_count: 0` | 6 |
| **GZIP** | GET A `/gzip` (`Content-Encoding: x-gzip`, 8 MiB of zeros compressed to 8 KB) | `0 no answer`, with no memory spike in logcat | 7 |
| **GZIP via CF** | GET A `/gzip-std` (the same bomb labelled `gzip`) | `-5 too large`. See "Measured on Cloudflare" | 7 (variant) |
| **SERVER B** | GET B `/echo` (B is not in `network.connect`) | `fetch refused: ERR_PERMISSION_DENIED (-2) (expect fetch -2) PASS`, at once, and B's `/hits` still reads `world_count: 0` | 6 |

For the rate limit (check 8), press **ECHO** 15 times fast: after the burst the
result line reads `fetch refused: ERR_RATE_LIMITED (-6)`, and the counters line
splits `queued` from `refused at once`. For the switch, Ghost, guest and
airplane-mode checks (9 to 13), the status line re-reads `k_net_status` on every
press, so `k_net_status 0 NOT available` appears before the result does.

## Measured on Cloudflare (2026-10-10)

Three things the Workers platform does that change what the device test can see:

1. **The edge rewrites `Accept-Encoding`.** curl sent `identity`, and the Worker
   saw `gzip, br`. So `/echo`'s `ae` field is not evidence of what the headset
   sent. `/gzip` is the real test of that header.
2. **The edge inflates `Content-Encoding: gzip` for an `identity` client.** A
   plain `gzip` label never reaches the headset: it gets 8 MiB of identity text.
   That is why there are two routes. `/gzip` uses the RFC 9110 alias `x-gzip`,
   which passed through untouched (8,176 bytes, magic `1f 8b`), so it tests the
   client's refusal of any non-identity encoding before the first body byte
   (`KNetTransport.cpp`, `EncodingRefused`). `/gzip-std` shows what happens to a
   real gzip server behind Cloudflare: the 256 KiB cap applies (`-5`).
3. **The egress check (registry review MED-1).** `GET A /egress-check` runs a
   plain `fetch("https://127.0.0.1.nip.io/")` inside the Worker. The result was
   **HTTP 403 from Cloudflare, body `error code: 1002`** (Cloudflare 1002: the
   DNS name points to a prohibited IP), in about 0.3 to 0.8 s. The Workers
   runtime refused to connect to a loopback-resolving name; nothing reached
   127.0.0.1.

## Publishing

**Not published yet.** On publisher `main` (`2b0487c`, core 0.11.0 / CLI 0.7.2,
with P1 merged) a plain `kosmos-wp validate` REJECTs both worlds: `WASM_003` and
`WASM_007` do not know `k_net_*`, because the level-4 levels table and the three
`k_net_* → network` capability rows are lane P1b's re-vendor, which has not
merged.

With the client's own level-4 table both worlds pass, with the one expected
WARN (`WASM_007`: level 4 is above the deployed level). That table is
`../net-test-tools/host-api-levels-client-a47d33b.json`, copied byte for byte
from kosmos-client `a47d33b` `Plugins/KosmosWasm/Resources/host-api-levels.json`
(not edited):

```
kosmos-wp validate net-check --host-surface net-test-tools/host-api-levels-client-a47d33b.json
kosmos-wp bundle   net-check --host-surface net-test-tools/host-api-levels-client-a47d33b.json --output net-check/net-check.worldbundle
```

`NET_007` (the opt-in probe) passed against server A: A's log shows
`GET /.well-known/world-network.json` from `WorldPublisher-OriginCheck/1`.
`doctor` has no `--host-surface` flag, so until P1b merges it reports the
`k_net_*` imports as unknown; every other check is green.

**The publish order:**
1. P1b merges (publisher level-4 table and the capability rows).
2. The registry deploys R1a/R1b with its level-4 table (otherwise publish fails
   with the registry's 409 on the level it recomputes from the bundle bytes).
3. Rebuild the bundles on that publisher **without** `--host-surface`, then:
   `kosmos-wp publish net-check/net-check.worldbundle --status unlisted` (and the
   same for `net-required`), signed in as `micknerks`.

A successful publish registers the world and **withholds it from every headset
below level 4**. That is the compatibility promise working, not a failure. Do
not bump the registry's `deployed` level until the network cook passes its
device checkpoint.

## Rebuilding

From the repo root. Node 20+, a Rust toolchain with `wasm32-unknown-unknown`,
and `wasm-tools`. No Blender, and no SDK checkout: the world declares its few
host imports itself, because the SDK's `net` module (lane SDK-1) has not merged.

```
node net-test-tools/build_glb.mjs net-check
node net-test-tools/build_glb.mjs net-required
powershell -NoProfile -ExecutionPolicy Bypass -File net-test-tools\build_wasm.ps1
kosmos-wp spawn-sync net-check
```

`build_wasm.ps1` runs the host unit tests (6 here, 1 in net-required), builds
with `-C target-cpu=mvp -C link-arg=--compress-relocations` (the headset's WAMR
has reference types off), checks each module against the device feature set
with `wasm-tools validate`, and copies it to `world.wasm`. The cargo target
directory is outside the repo (`../.build/`).

The servers deploy with `npx wrangler deploy` from `net-test-servers/a` and
`net-test-servers/b` (see `../net-test-servers/README.md`).

## Files

| Path | What it is |
|---|---|
| `manifest.json` | the manifest: four capabilities, `requires.host_api: 4`, the `network` block naming server A |
| `world.glb` | the room: floor, back wall, 11 buttons on stands, the board and its 8 text anchors, the `spawn_point` marker |
| `world.wasm` | the compiled script, 7.6 KB; imports 8 `kosmos.*` functions |
| `net-check.worldbundle` | the bundle, built with `--host-surface` as above |
| `src/lib.rs` | the world script |
| `Cargo.toml`, `build.rs` | no dependencies; `--import-memory` and `--export-table` |

## Known limitations

- No lit-render review: these are unlisted test worlds, and the look is plain boxes.
- Which way the visitor faces at the spawn is set by the client. The console is
  along +X (UE forward at yaw 0); if it is behind you, turn around.
- World text is a fixed 8 cm. The board is 2.6 m from the spawn; step closer to read the body lines.
