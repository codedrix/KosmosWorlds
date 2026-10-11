# Network Check (`world://net-check.micknerks`)

The device-test world for **worlds that call servers** (DB-038, the network
cook, host API level 4). Each button makes one request and the board shows the
answer, what was expected, and `PASS` or `CHECK`. **Current version: 1.0.1**
(see "1.0.1: what changed after the first sitting"). It goes with
`net-required.micknerks` (`../net-required/`) and the two test servers in
`../net-test-servers/`.

- **Ticket:** KOS-983 (lane TW of `NETWORK_BUILD_PLAN.md`; the device check list is its §3)
- **Host API level:** **4**: it imports `k_net_fetch`, `k_net_read` and `k_net_status`
- **Capabilities:** `scene_read`, `events`, `ui_basic`, `network`. None of
  `player_read`, `scene_query` or `spatial_anchor` (NET_005, NET_006)
- **Publish as:** **unlisted**, under `micknerks`
- **Size:** 408 triangles, 34 mesh nodes, no textures, a 9.5 KB wasm module, a 24.6 KB bundle

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

Eleven numbered buttons stand on an arc 1.6 m in front of the spawn, each with
a two-line label saying what it tests and what it should do. The labels sit at
two alternating heights so neighbours never overlap. **Green** buttons should
succeed, **red** ones must be refused, and **blue** (4) opens the prompt.

The board floats 3 m out, and the dark back wall is 1.4 m behind it. Top to bottom:

| Line | Shows |
|---|---|
| title | `NETWORK CHECK 1.0.1 - press a numbered button` |
| network | `network: AVAILABLE (k_net_status 1)` or `NOT AVAILABLE (… 0)`. It is re-read every second and on every press |
| pressed | the button, e.g. `pressed: 1 ECHO A`, or the prompt's answer: `prompt answer: "Kendrick" (8 B)` |
| fetch | what `k_net_fetch` returned **at once**: `fetch: 0 queued as request 3`, or `fetch: REFUSED -2 network off or not allowed` (also -6 rate limited, -7 invalid, -8 switched off remotely) |
| answer | what `OnNetResult` said later: `answer to 1 ECHO A: HTTP 200, 151 bytes`, `-5 too large`, `0 no answer`, `-2 refused in flight`, or `answer: none - refused before sending` |
| verdict | `verdict for 1: PASS (expected answer 200)` or `CHECK (…)` |
| body × 3 | the first 168 bytes of the response, printable ASCII |
| footer | the score-board name, then the `queued`, `refused` and `answered` counts |

| # | Label | Request | PASS when | Plan §3 check |
|---|---|---|---|---|
| 1 | **1 ECHO A** / expect 200 | GET A `/echo` | answer `HTTP 200`; the body starts `{"addr":"net-check.micknerks","cookie":false,"auth":false,"referer":false,"origin":false,…` | 2, 8 |
| 2 | **2 POST SCORE** / expect 200 | POST A `/score`, JSON `{"name":"quest","score":101}` (the score goes up by one per press) | answer `HTTP 200`, body `{"ok":true,…}` | 3 |
| 3 | **3 READ SCORES** / expect 200 | GET A `/scores` | answer `HTTP 200`; the top 10 include the ones just posted | 3 |
| 4 | **4 TYPE NAME** / prompt, then post | opens the system prompt sheet; the answer is shown on the board at once, then POSTed as the score name | the sheet's footer names `kosmos-net-test-a…`; the board shows the answer; then `HTTP 200` | 16 |
| 5 | **5 BIG 300 KB** / must fail: -5 | GET A `/big` (300 KiB) | answer `-5 too large` | 4 |
| 6 | **6 SLOW 12 s** / must fail: 0 | GET A `/slow` (answers after 12 s) | answer `0 no answer` after about 10 s | 5, 14 |
| 7 | **7 REDIRECT A>A** / expect 200 | GET A `/same-redirect` (302 to A `/echo`) | answer `HTTP 200` | 6 |
| 8 | **8 REDIRECT A>B** / must fail: -2 | GET A `/cross-redirect` (307 to B) | answer `-2 refused in flight`, and B's `/hits` still reads `world_count: 0` | 6 |
| 9 | **9 GZIP** / must fail: 0 | GET A `/gzip` (`Content-Encoding: x-gzip`, 8 MiB of zeros compressed to 8 KB) | answer `0 no answer`, with no memory spike in logcat | 7 |
| 10 | **10 GZIP via CF** / must fail: -5 | GET A `/gzip-std` (the same bomb labelled `gzip`) | answer `-5 too large` (see "Measured on Cloudflare") | 7 (variant) |
| 11 | **11 SERVER B** / must fail: -2 | GET B `/echo` (B is not in `network.connect`) | `fetch: REFUSED -2` at once, and B's `/hits` still reads `world_count: 0` | 6 |

**While network is unavailable**, every fetch reads `fetch: REFUSED -2 network
off or not allowed` and the verdict is `CHECK`, except 11, which passes,
because that refusal is what it expects. The prompt still opens and its answer
still appears.

For the rate limit (check 8), press **1** fifteen times fast: after the burst
the fetch line reads `fetch: REFUSED -6 rate limited, slow down`, and the
footer splits `queued` from `refused`. For the switch, Ghost, guest and
airplane-mode checks (9 to 13), watch the network line: it changes within a
second, without a press.

## 1.0.1: what changed after the first sitting

The CEO's first sitting (2026-10-11) reported *"I could not tell what pressing
the boxes was triggering"* and, after typing a name, *"nothing showed"*. That
sitting's client also refused every fetch with -2, because of a client bug
that is being fixed separately. The 1.0.0 world had three defects that made
this worse:

1. **Its text was buried in the scenery.** World text turns to face the camera
   and is depth-tested. 1.0.0 drew 64-character lines (about 2.3 m wide) 2 cm in
   front of a solid backboard, so a few degrees off-axis, half of every line
   swung into the board. 1.0.1 has no board: the lines are at most 56
   characters and float with 1.4 m of clear space behind them.
2. **White on light grey.** World text is always white (`KWorldTextPool.cpp`).
   1.0.0's floor and wall were light grey and its sky was `day`. 1.0.1 has a
   near-black floor and wall and `sky: "night"`.
3. **Terse labels, and one line for two meanings.** The labels said `ECHO` and
   `BIG 300K`. The immediate refusal and the later answer shared one line, and
   the prompt's answer was never shown. 1.0.1 numbers every label and says what
   it should do, gives the fetch return code its own line, and shows the prompt
   answer as soon as it arrives.

Also: every string is clipped to the host's 128-byte world-text limit
(`KWasm::MAX_WORLD_TEXT_BYTES`; the host refuses longer text rather than
truncating it), and the tests assert that every fixed and worst-case line fits.
A Node mock host ran the built `world.wasm` both with every fetch refused (-2)
and with fetches answered (200); every press changed the board as the tables
above say.

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

**1.0.0 published unlisted as `micknerks`, 2026-10-11 00:39 UTC; 1.0.1 at 02:34 UTC**, from publisher
`main` `64c76b1` (P1b merged, so no `--host-surface`), against registry
version `18290b01` (level-4 table; `deployed` stays 2).

| World | Version | content_hash |
|---|---|---|
| `world://net-check.micknerks` | **1.0.1** (current) | `sha256:422fa6202354b959953357990bddc734361fdf5b5916e0432b29ec1e8600ee83` |
| `world://net-required.micknerks` | **1.0.1** (current) | `sha256:4e2e06bd200b588288f7ab8d5f4db1f9d521c471c1835f413699a81a49dd3753` |
| `world://net-check.micknerks` | 1.0.0 | `sha256:525b50f23bb8e6e6fb32b26d21634f1dadb4f02ec8487537e5da6bbc44047edd` |
| `world://net-required.micknerks` | 1.0.0 | `sha256:6b9cf65aacb22a6bc09bbb054d39bf9c19969b57b7d21a02548dd77674b6295c` |

`validate`, `bundle` and `publish` all passed with the one expected WARN
(`WASM_007`: level 4 is above the deployed level 2). Both opt-in probes hit
server A: `WorldPublisher-OriginCheck/1` at validate and publish, and
`Kosmos-Registry-OriginCheck/1` at register.

**Resolve** (`GET https://api.kosmosvr.com/api/v1/worlds/micknerks/<slug>`):

| Query | Both worlds |
|---|---|
| `?host_api=4` | 200, `semver: 1.0.1`, `host_api_level: 4`, `status: unlisted`, `world.network_origins: ["https://kosmos-net-test-a.micknerks.workers.dev"]` |
| no `host_api` | 404 `{"found":false,"code":"CLIENT_TOO_OLD","host_api_level":4}` |
| `?host_api=2` | 404 `{"found":false,"code":"CLIENT_TOO_OLD","host_api_level":4}` |

So every headset below level 4 is told the world is not for its version. That
is the compatibility promise working, not a failure. Do not bump the registry's
`deployed` level until the network cook passes its device checkpoint.

To republish after a change: rebuild (below), `kosmos-wp bundle <world> --output
<world>/<world>.worldbundle`, bump `world.version`, then `kosmos-wp publish
<world>/<world>.worldbundle --status unlisted`, signed in as `micknerks`.
`net-test-tools/host-api-levels-client-a47d33b.json` is no longer needed for
publishing; it stays as the record of the table the first bundles were checked
against.

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

`build_wasm.ps1` runs the host unit tests (7 here, 1 in net-required), builds
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
| `world.glb` | the room: dark floor and back wall, 11 colour-coded buttons on stands, 10 floating text anchors, the `spawn_point` marker |
| `world.wasm` | the compiled script, 9.5 KB; imports 8 `kosmos.*` functions |
| `net-check.worldbundle` | the published 1.0.1 bundle (publisher `64c76b1`, no `--host-surface`) |
| `src/lib.rs` | the world script |
| `Cargo.toml`, `build.rs` | no dependencies; `--import-memory` and `--export-table` |

## Known limitations

- No lit-render review: these are unlisted test worlds, and the look is plain boxes.
- Which way the visitor faces at the spawn is set by the client. The console is
  along +X (UE forward at yaw 0); if it is behind you, turn around.
- World text is a fixed 8 cm. The board is 3 m from the spawn; step closer to read the body lines.
