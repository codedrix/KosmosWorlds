# Mission Control (`world://mission-control.micknerks`)

The CEO's own Claude Code jobs, running on the CEO's PC, on a wall in Kosmos. Start a job, read the
conversation, approve what Claude asks to run, without taking the headset off.
Brief: **DB-044** (kosmos-project). The PC side is `../agent-bridge/`.

- **Status:** built and validated; **not published**. Publishing is Class C (the CEO's), after
  the tunnel exists. See "Publishing" below and DB-044's step list.
- **Host API level:** **4** (`k_net_*`, `OnNetResult`); also level 3 (`k_haptic_pulse`,
  `k_node_clone`, `k_node_destroy`, `k_log`).
- **Capabilities:** `scene_read`, `scene_write`, `transform`, `events`, `ui_basic`, `audio`,
  `player_write` (the buzz), `network`. Never `player_read` (NET_005), `scene_query` or
  `spatial_anchor`.
- **Publish as:** **unlisted**, under `micknerks`. It is private by passphrase, not by access mode:
  anyone who finds it sees a locked wall.
- **Size:** about 17,000 triangles, 96 scripted nodes, a 12.5 KB script, a 53 KB chime; the bundle
  is 1.2 MB.

## The room

A dark round room, 3.4 m across, open to a night sky. The visitor stands in a ring of light; the
wall curves around in front:

| Where | What |
|---|---|
| Overhead | the **ticker**: "3 working \| 1 needs you \| 2 done today \| 20:36" |
| Left (56°) | **Start a job**: Run all tests, Review open PRs, Summarize today, Draft release notes, **+ New task**; the project in use and CHANGE PROJECT; Sign out |
| Centre | **Working now**: up to four cards (project, task, status, progress, elapsed, files touched); a card waiting on the CEO turns **amber**; **Done today** on the shelf below |
| Right (-56°) | **Needs you**: up to three approvals, each opening its job |
| Behind | a door back to the Lobby (a declarative link) |

Pressing a card, a "Needs you" item or New task turns the centre into that job's **chat**: a slim
agent rail on the left, a header with STOP and BACK TO WALL, twelve conversation lines (paged with
the ^ and v buttons), the approval inline (the exact command, APPROVE / DENY / ASK WHY), and quick
replies (Keep going, Explain simply, Stop + summarize) plus Reply... (the typing sheet).

A new approval buzzes **both controllers** twice (`k_haptic_pulse`, 0.8 for 140 ms) and plays a soft
two-note chime, so it is noticed from anywhere in the room. The headset itself has no motor.

## How it works

The script (`src/lib.rs`) is deliberately dumb. The bridge decides every word; the world applies
the snapshot it is sent (the AB1 line format, `../agent-bridge/src/wire.ts`) and reports presses:

- **One long poll** at a time (`POST /v1/faces/mission-control/view`): the bridge answers when the
  wall changes, or after 6.5 s with "same". Never more than about one request a second, which keeps
  inside the host's 1/s refill and leaves its burst of 10 for presses.
- **A press** sends the node name plus the snapshot version on screen. The bridge resolves what that
  node meant in that snapshot, so a press can't land on something the visitor didn't see.
- **Typing** uses the system typing sheet (`k_ui_prompt`, level 2), opened inside the press that
  asked for it. The bridge marks which buttons type (`P` records): Sign in, New task, Reply.
- **Text** is world text on 32 anchors (the host's limit; chat mode shows 26 at once). Every anchor
  is a **3 cm plaque, 2 mm thin, parallel to its panel**: the client prints text flat on a thin
  plane and never turns it (`KWorldTextPool.cpp`, Build 1009). The bridge shifts each conversation
  line by half its measured width so centred text reads as left-aligned.
- **Progress bars** are scaled with `k_transform_set_scale(bar, 1, f, 1)` (a raw UE relative scale;
  the bar runs along UE Y with its origin at the left end).
- **Done chips** are copies of one mesh (`k_node_clone`, up to 12); every pressable control is an
  authored node.

## Files

| Path | What it is |
|---|---|
| `manifest.json` | eight capabilities, `requires.host_api: 4`, the `network` block (one origin) |
| `bridge-origin.txt` | the bridge's public origin, compiled into the script. A placeholder until the CEO's tunnel exists; `../mission-control-tools/set-bridge-host.mjs` sets it and the manifest together |
| `nodes.json` | every node name the script finds. GENERATED from the bridge's face layout; the bridge's and the script's tests both pin it |
| `world.glb`, `world.wasm`, `audio/chime.wav` | the built world |
| `src/lib.rs`, `Cargo.toml`, `build.rs` | the script (no dependencies) |
| `blender/build_world.py` | builds every node, exports `world.glb`, renders the review |
| `blender/measure_roboto.py` | measures Roboto's advance widths for the bridge's text layout |
| `review/*.snapshot`, `review/*.jpg` | the captured snapshots and the lit renders made from them |

Build tooling lives beside the package in `../mission-control-tools/` (ASSET_006 refuses a `.ps1`
in a bundle): `build_wasm.ps1`, `make_chime.mjs`, `set-bridge-host.mjs`, `mockhost.mjs` and
`lobby-door/`.

## Rebuilding

```
node agent-bridge/scripts/write-nodes-json.mjs          (after npm run build in agent-bridge)
node agent-bridge/scripts/capture-review-snapshots.mjs
"E:/Blender/blender-5.1/Blender Foundation/Blender 5.1/blender.exe" -b -P mission-control/blender/build_world.py
powershell -NoProfile -ExecutionPolicy Bypass -File mission-control-tools\build_wasm.ps1
node mission-control-tools/mockhost.mjs
kosmos-wp validate mission-control --offline
```

`mockhost.mjs` runs the built `world.wasm` in Node with every `kosmos.*` import stubbed and
`k_net_*` sent over real HTTP to a local bridge (fake adapter), and plays a visit: sign in, start a
preset, the approval arrives with two pulses and one chime, approve, the job finishes, back to the
wall. It passes. It does not check rendering, the real typing sheet or real haptics.

## The lit-render review (2026-10-14)

The renders apply the captured snapshots exactly as the script does, and draw world text as white
Roboto at 8 cm on the plaques. The light stands in for the client's pawn rig plus `sky: "night"`.
**These are renders, not pixels**: the device checkpoint is the real check.

What the review caught and what changed:

1. **Conversation lines drifted right.** The first width table guessed Roboto about 25% too wide.
   Fixed by measuring the font (`measure_roboto.py`); lines now start on one edge.
2. **Long lines swung into the panel** and were clipped, because the anchors were 1 cm cubes and
   text on a non-plane anchor turns toward the eye (the net-check 1.0.0 defect). Fixed by the
   plaques above.
3. **Full-ring light lines** floated across the open sky behind the visitor. Now arcs on the wall.
4. **Glossy panels mirrored the text.** Panels are matte (and the review drops specular, which the
   publisher strips anyway, GLTF_019).
5. **A closed parapet ring** would have become one solid collision box over the floor (GLTF_007).
   Now an open 160° arc.

## Device checks owed (the checkpoint, on Build 1009)

1. Text: plaques print flat; 8 cm Roboto is readable at 2.6 m; the conversation's left edge is
   straight. If widths differ on device, set `textScale` in the bridge's config (no new world).
2. The bars grow left to right (the raw-scale axis).
3. Both controllers buzz and the chime plays on a new approval; nothing buzzes on a press.
4. The typing sheet opens from Sign in, New task and Reply, and nothing on the wall hides it.
5. **Dictation:** on the typing sheet's keyboard, does the microphone key appear and type into
   Kosmos? Found so far, without wearing the headset: Kosmos uses the Android keyboard service (the
   Oculus Keyboard, `com.oculus.vrshell/...keyboardv2`), the headsets have an on-device speech
   service (`com.oculus.systemintelligence/.android.speech.OnDeviceRecognitionService`), and Kosmos
   holds RECORD_AUDIO. Whether the mic key shows and works is **unverified**.
6. The Lobby door (`../mission-control-tools/lobby-door/`) and the door home both travel.

## Publishing (Class C, the CEO's)

Only after the tunnel serves `/.well-known/world-network.json` (DB-044's steps):
`set-bridge-host.mjs <host>`, rebuild the wasm, `kosmos-wp validate mission-control` **without**
`--offline`, bundle with the version bumped, `kosmos-wp publish <bundle> --status unlisted` signed in
as `micknerks`. Then the Lobby 1.1.2 candidate with the door, never before.

## Known limitations

- The passphrase shows on the typing sheet as it is typed (`k_ui_prompt` has no masked field). The
  ruled R5 world text field (`k_ui_text_begin`, masked flag) fixes this once the publisher and
  registry accept level 5.
- Four jobs at once (four cards); a fifth waits for one to stop.
- No world presence: a second visitor sees the same locked wall and can't sign in without the
  passphrase.
