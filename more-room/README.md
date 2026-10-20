# More Room (working title)

Your day, given a place around you, in smoked glass and thin cyan light. **v2, the Day Ring:** your day is a ring of time around you at eye height, with now always straight ahead; messages drop onto a low arc in front of you, face-down; triage makes them rise and fan out; focus closes the room in around one task. It opens on an invented sample day; its owner can later connect it to a bridge on their own PC.

- `world://more-room.micknerks` is the VR version, on a plain grid.
- `world://more-room-mr.micknerks` is the MR version, in your real room.

v2 is on branch `feat/more-room-v2-ring` and is **not published**: the live worlds are v1 (1.0.0, published unlisted on 2026-10-19). Both open on a **built-in sample day** (everything invented, with a banner saying so) and an **About** panel; Owner sign in switches to the bridge. Publishing is Class C: see [PUBLISH.md](PUBLISH.md).

| Read | For |
|---|---|
| [DESIGN.md](DESIGN.md) | The room, the four modes, the budgets as measured, the bridge's day face, message sources, wall pinning, and the device check list |
| [PLATFORM_ASK_v2.md](PLATFORM_ASK_v2.md) | v2: pinning cards to the real wall, and what the platform needs first |
| [PUBLISH.md](PUBLISH.md) | The steps to publish, in order, with whose act each is |
| [renders/](renders/) | Lit renders of every mode, in VR and in MR (`<vr\|mr>-<mode>-<view>.jpg`) |

## Layout

| Path | What |
|---|---|
| `world-vr/`, `world-mr/` | The two world packages: `manifest.json`, `world.glb`, `world.wasm` (one script for both) and `tick.wav` |
| `script/` | The world script (no_std Rust): `lib.rs` (modes, the ring, cards, the fan, the cocoon, network, the sample, About), `style.rs` (the one place text placement and state colours are chosen), `model.rs` (the DAY/1 reader), `text.rs` (world-text layout within 128 bytes and 4 lines), `layout.rs` (positions, mirrored from `build_glb.mjs`), `sample_day.txt` (the built-in sample, generated) |
| `../agent-bridge/src/faces/more-room/` | More Room's **face on the shared agent bridge** (Mission Control's, PR #5): `index.ts` (the Face), `day-core.ts` (the day, the DAY/1 wire and the ops; the one source of truth), `sample-day.ts` (an invented day). Its tests on the real bridge server: `../agent-bridge/test/more-room-face.test.ts` |
| `bridge-day-face/` | `mock-bridge.mjs` (a model of the bridge server running the real `day-core.ts`, for the world's tests) and `server.mjs` (the same on `http://127.0.0.1:8787`) |
| `tools/` | `gen_sample.mjs` (bakes the face's sample day into the world), `build_glb.mjs`, `build_wasm.ps1`, `mock-host.mjs` (the client's limits, modelled), `scenario.mjs` (310 checks), `stress.mjs` (a heavy day), `extract_scene.mjs`, `render_modes.py` and `to_jpeg.py` (Blender), `make_sheet.py` (the renders beside the art-direction references) |

## Rebuild and test

From the repo root, with Node 22.6+ (the tests run the face's TypeScript through `--experimental-strip-types`), Rust with `wasm32-unknown-unknown`, `wasm-tools`, Blender 5.1 (for renders only), and a publisher CLI at main `fced9cf` or later.

```
node --experimental-strip-types more-room/tools/gen_sample.mjs
node more-room/tools/build_glb.mjs both
powershell -NoProfile -ExecutionPolicy Bypass -File more-room\tools\build_wasm.ps1
node --experimental-strip-types more-room/tools/scenario.mjs --snapshots
node --experimental-strip-types more-room/tools/stress.mjs
```

To render:

```
blender -b --factory-startup --python more-room/tools/render_modes.py -- vr more-room/renders/png
blender -b --factory-startup --python more-room/tools/render_modes.py -- mr more-room/renders/png
blender -b --factory-startup --python more-room/tools/to_jpeg.py
```

To make the side-by-side sheet against the two holographic-glass references (they are the CEO's, so they and the sheet stay outside this repo):

```
uv run --with pillow python more-room/tools/make_sheet.py <ref-1> <ref-2> more-room/renders/png <out.jpg>
```

To try the mock bridge in a browser or with curl:

```
node --experimental-strip-types more-room/bridge-day-face/server.mjs --dev
```

Its passphrase is `sample-day`. That is the mock's test value; the real bridge's passphrase is the CEO's.
