# More Room — publish steps (ready for the CEO's OK)

**Publishing is Class C, and nothing here has been run against production.** Each step says whose act it is. "Agent" steps are safe to hand to a session. **CEO** steps are his.

## 0. Before anything

| # | Step | Whose | Check |
|---|---|---|---|
| 0.1 | Mission Control settles the bridge's origin, sign-in route and approval route. Put the origin in `script/src/lib.rs` `ORIGIN` and in both manifests' `network.connect` and `privacy_url`, and adjust `/day/v1/session` if the sign-in differs. Rebuild (§1) | Agent, with Mission Control | `grep -rn more-room-bridge more-room/` shows only the new origin |
| 0.2 | **The origin must not be a Kosmos host:** not `*.kosmosvr.com` and not `*.theworldpublishing.com` (NET_003 refuses both). A `workers.dev` name or the CEO's own domain works | — | `validate` passes NET_003 |
| 0.3 | **An always-on front for the opt-in file.** The registry fetches `/.well-known/world-network.json` at register and again weekly. If a weekly check fails, and the confirming check 1–24 h later also fails, the origin is dropped until the next weekly pass, which can take up to a week. So a small Worker should answer that file itself and forward `/day/*` through the tunnel to the PC. Then a sleeping PC means "The bridge did not answer", not a week offline | **CEO** to deploy (it is a public endpoint). The code is `bridge-day-face/worker.mjs`, a sketch to adapt to Mission Control's tunnel | `curl -s https://<origin>/.well-known/world-network.json` returns `{"world_network":1,"worlds":["world://more-room.micknerks","world://more-room-mr.micknerks"]}` with status 200 and no redirect |
| 0.4 | `micknerks` is on the registry's `network_registrants` allowlist (it was for net-check on 2026-10-11) | Agent, read-only | `registry_settings.network_registrants` contains `micknerks` |
| 0.5 | The bridge serves the day face with the **CEO's real connectors** (Gmail, Calendar, Linear) | **CEO** (connecting accounts is Class C) | `POST /day/v1/changes` after sign-in returns his day, not the sample |

## 1. Build and check (agent)

```
node more-room/tools/build_glb.mjs both
powershell -NoProfile -ExecutionPolicy Bypass -File more-room\tools\build_wasm.ps1
node more-room/tools/scenario.mjs --snapshots
node more-room/tools/stress.mjs
kosmos-wp validate more-room/world-vr
kosmos-wp validate more-room/world-mr
kosmos-wp bundle more-room/world-vr --output more-room/dist/more-room-vr.worldbundle
kosmos-wp bundle more-room/world-mr --output more-room/dist/more-room-mr.worldbundle
node more-room/tools/extract_scene.mjs
node more-room/tools/scenario.mjs --packaged
```

- Use a publisher at main `fced9cf` or later (CLI 0.8.1). The globally installed `kosmos-wp` on this PC is 0.3.0 and too old.
- Online (without `--offline`), `validate` probes the origin, so NET_007 must PASS.
- Expected warnings: none, or WASM_007 if the vendored deployed hint still says level 2. The registry's live `deployed` is 4 (DEPLOY_LEDGER `DATA-20261012-deployed-level-4`).

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

Then append a DEPLOY_LEDGER row for each publish.

## 4. The device checkpoint (CEO, on Build 1009 or later)

This is the checklist in [DESIGN.md](DESIGN.md) §9. Record it in `docs/COOK_LEDGER.md` style notes on the More Room ticket. Do not call the room working until it passes. An agent's green checks are not pixels.

## Rollback

`kosmos-wp` delete is a **purge** (KOS-573), so prefer `--status removed` through the registry for a soft takedown. Turning the bridge off, or removing the world from the opt-in file, stops every call at the next check.
