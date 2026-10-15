# More Room — publish steps (ready for the CEO's OK)

**Publishing is Class C.** The CEO approved it on 2026-10-14, relayed verbatim: "Yes, my OK also covers publishing the More Room worlds (VR and MR), unlisted, once they pass review." The conditions:
- the independent two-lens review passes, and `kosmos/qa-pass` is on the head SHA;
- KosmosWorlds #5 has merged, and the relay Worker is deployed with both worlds in `WORLDS`;
- each publish is verified by resolve (`network_origins` present, NET_007 passes);
- both versions and their hashes are recorded.

It does not cover connecting the CEO's accounts or new bridge verbs.

**Nothing here has been run against production yet.** Each step says whose act it is. "Agent" steps are safe to hand to a session. **CEO** steps are his.

## 0. Before anything

| # | Step | Whose | Check |
|---|---|---|---|
| 0.1 | Settled 2026-10-14: the shared agent bridge's relay Worker, `https://kosmos-agent-bridge.micknerks.workers.dev`, is the origin (in `script/src/lib.rs` `ORIGIN` and both manifests). More Room is the face `more-room` on that bridge (`agent-bridge/src/faces/more-room/`). PR #5 (the bridge) merges before or with PR #4 (this) | Mission Control lane, then the CEO (Class C merges) | the bridge's `npm test` passes with the face folder in it (52 of 52 on 2026-10-14) |
| 0.2 | **The origin must not be a Kosmos host:** not `*.kosmosvr.com` and not `*.theworldpublishing.com` (NET_003 refuses both). A `workers.dev` name or the CEO's own domain works | — | `validate` passes NET_003 |
| 0.3 | **The always-on front for the opt-in file is Mission Control's relay Worker** (`agent-bridge/relay-worker/`; one front door, one secret, one kill switch; More Room deploys no Worker). It answers the opt-in file while the PC sleeps, which matters: the registry drops an origin whose weekly check and its confirm 1–24 h later both fail, for up to a week. **Its `WORLDS` var must list `world://more-room.micknerks` and `world://more-room-mr.micknerks`** (on 2026-10-14 it lists only Mission Control's world) | Mission Control lane edits `WORLDS`; the **CEO** deploys the Worker (a public endpoint) | `curl -s https://kosmos-agent-bridge.micknerks.workers.dev/.well-known/world-network.json` lists both More Room worlds, status 200, no redirect (on 2026-10-14 the Worker was not deployed yet: Cloudflare error 1042) |
| 0.4 | `micknerks` is on the registry's `network_registrants` allowlist (it was for net-check on 2026-10-11) | Agent, read-only | `registry_settings.network_registrants` contains `micknerks` |
| 0.5 | The bridge serves the day face with the **CEO's real connectors** (Gmail, Calendar, Linear) | **CEO** (connecting accounts is Class C) | `POST /v1/faces/more-room/changes` after sign-in returns his day, not the sample (needs the "today" verb, DESIGN.md §5) |

## 1. Build and check (agent)

```
node more-room/tools/build_glb.mjs both
powershell -NoProfile -ExecutionPolicy Bypass -File more-room\tools\build_wasm.ps1
node --experimental-strip-types more-room/tools/scenario.mjs --snapshots
node --experimental-strip-types more-room/tools/stress.mjs
kosmos-wp validate more-room/world-vr
kosmos-wp validate more-room/world-mr
kosmos-wp bundle more-room/world-vr --output more-room/dist/more-room-vr.worldbundle
kosmos-wp bundle more-room/world-mr --output more-room/dist/more-room-mr.worldbundle
node more-room/tools/extract_scene.mjs
node --experimental-strip-types more-room/tools/scenario.mjs --packaged
```

- Use a publisher at main `fced9cf` or later (CLI 0.8.1). The globally installed `kosmos-wp` on this PC is 0.3.0 and too old.
- Online (without `--offline`), `validate` probes the origin, so NET_007 must PASS.
- Without `--deployed-level 4`, `validate` and `bundle` **will** warn WASM_007: the vendored hint still says level 2, while the registry's live `deployed` is 4 (DEPLOY_LEDGER `DATA-20261012-deployed-level-4`). It is a warning only; pass `--deployed-level 4` to check against the deployed level. `publish` reads the registry's live level itself.

## 2. Publish (CEO)

Signed in to the CLI as `micknerks`:

```
kosmos-wp publish more-room/dist/more-room-vr.worldbundle --status unlisted
kosmos-wp publish more-room/dist/more-room-mr.worldbundle --status unlisted
```

- **Access stays `open`** (the default). The bundles hold nothing personal; the day lives behind the bridge's passphrase.
- For `private`, first do DB-023's private-bucket steps (the CEO's), then `kosmos-wp access more-room --mode private`. The headset opens a private world for its signed-in owner (KOS-803).

## 3. Confirm (agent, read-only)

```
curl -s "https://api.kosmosvr.com/api/v1/worlds/micknerks/more-room?host_api=4"
curl -s "https://api.kosmosvr.com/api/v1/worlds/micknerks/more-room-mr?host_api=4"
```

Each should show `semver 1.0.0`, `host_api_level 4`, `status unlisted`, and `world.network_origins` naming the bridge's origin. Without `?host_api=4`, the answer is `CLIENT_TOO_OLD`, as designed.

Then record each publish:
- the world, its `semver` and its `content_hash` (from the resolve answer; `bundle` prints the same digest) on KOS-994 and in this file's "Published" section;
- a DEPLOY_LEDGER row for each.

## 4. The device checkpoint (CEO, on Build 1009 or later)

This is the checklist in [DESIGN.md](DESIGN.md) §9. Record it in `docs/COOK_LEDGER.md` style notes on the More Room ticket. Do not call the room working until it passes. An agent's green checks are not pixels.

## Rollback

`kosmos-wp` delete is a **purge** (KOS-573), so prefer `--status removed` through the registry for a soft takedown. Turning the bridge off, or removing the world from the opt-in file, stops every call at the next check.
