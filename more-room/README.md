# More Room (working title)

Your day, given a place around you: the calendar on the wall, messages face-down on the desk, tasks beside you, a window, and a quiet shelf behind. It is live, from a bridge on your own PC.

- `world://more-room.micknerks` is the VR version, on a plain grid.
- `world://more-room-mr.micknerks` is the MR version, in your real room.

Both are **built and tested, not published.** Publishing is Class C: see [PUBLISH.md](PUBLISH.md).

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
| `script/` | The world script (no_std Rust): `lib.rs` (modes, cards, network), `model.rs` (the DAY/1 reader), `text.rs` (world-text layout within 128 bytes and 4 lines), `layout.rs` |
| `bridge-day-face/` | The bridge's "day" face: `day-face.mjs` (the handler the real bridge can mount), `sample-day.mjs` (an invented day), `server.mjs` (a local mock), `worker.mjs` (a sketch of the always-on front; never deployed by this lane) |
| `tools/` | `build_glb.mjs`, `build_wasm.ps1`, `mock-host.mjs` (the client's limits, modelled), `scenario.mjs` (175 checks), `stress.mjs` (a heavy day), `extract_scene.mjs`, `render_modes.py` and `to_jpeg.py` (Blender) |

## Rebuild and test

From the repo root, with Node 20+, Rust with `wasm32-unknown-unknown`, `wasm-tools`, Blender 5.1 (for renders only), and a publisher CLI at main `fced9cf` or later.

```
node more-room/tools/build_glb.mjs both
powershell -NoProfile -ExecutionPolicy Bypass -File more-room\tools\build_wasm.ps1
node more-room/tools/scenario.mjs --snapshots
node more-room/tools/stress.mjs
```

To render:

```
blender -b --factory-startup --python more-room/tools/render_modes.py -- vr more-room/renders/png
blender -b --factory-startup --python more-room/tools/render_modes.py -- mr more-room/renders/png
blender -b --factory-startup --python more-room/tools/to_jpeg.py
```

To try the mock bridge in a browser or with curl:

```
node more-room/bridge-day-face/server.mjs --dev
```

Its passphrase is `sample-day`. That is the mock's test value; the real bridge's passphrase is the CEO's.
