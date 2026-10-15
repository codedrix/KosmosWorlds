# Mission Control, inside the Lobby (`world://lobby.micknerks`)

The CEO's own Claude Code jobs, running on the CEO's PC, on a panel in the Lobby. Start a job,
read the conversation and approve what Claude asks to run, without taking the headset off.
Brief: **DB-044** (kosmos-project). The PC side is `../agent-bridge/` (its contract: `API.md`).

This folder is not a world of its own any more. It builds **the Lobby's program and Mission
Control's nodes**, and `../mission-control-tools/lobby/package_lobby.mjs` merges them into the live
Lobby package to make **Lobby 1.2.0**.

- **Status:** built, validated (publisher 0.8.1, 83 rules: PASSED, offline) and run end to end
  against the real bridge; **not published**. Publishing the Lobby is Class C (the CEO's OK is
  recorded in DB-044, after the independent review).
- **Host API level:** **4** (`k_net_*`, `OnNetResult`); also level 3 (`k_haptic_pulse`,
  `k_node_clone`, `k_node_destroy`, `k_log`) and level 2 (`k_ui_prompt`). **Lobby 1.2.0 opens only
  on a level-4 client** (Build 921 or later); an older headset is told the world isn't available for
  its version. Both of the CEO's headsets run Build 1009.
- **Capabilities added to the Lobby's `audio`:** `scene_read`, `scene_write`, `transform`, `events`,
  `ui_basic`, `player_write` (the buzz), `network`. Never `player_read` (NET_005), `scene_query` or
  `spatial_anchor`.
- **Network:** one origin, `https://kosmos-agent-bridge.micknerks.workers.dev`, the relay Worker in
  front of the bridge (`../agent-bridge/relay-worker/`). Visibility stays **unlisted**.

## The ritual: a hidden door, not a lock

The Lobby looks and sounds exactly as before (the music is ported byte for byte in behaviour), and
**makes no network call at all** until one of two things happens:

1. **The owner's ritual.** Stand on the stone throne on the gallery dais, facing into the hall.
   Point at the small dark disc set into the front of the seat (`McSeal`) and press A. The system
   typing sheet asks for the Mission Control passphrase; the first network call is that sign-in.
   The panel then rises in front of the throne.
2. **A watch code.** Press the **Watch** post beside the dais (`McWatchJoin`) and type the 6-digit
   code the owner shared. That visitor gets a read-only copy of the owner's panel.

Anyone who watches the owner can repeat the gesture, so the gesture hides the door; **the passphrase
is the lock** (the bridge's lockout: 5 wrong in a row = 15 minutes, 10 in a day = locked until the
CEO unlocks it at the PC). The ritual can't check that the visitor is really on the throne facing
the hall: no host function reports where the player stands or looks to world code without
`player_read`, which a network world may not hold. That check is a platform ask in DB-044.

The panel is authored **200 m below the floor** and moved in front of the throne when it opens. It
exists only on the headset that opened it: other visitors in the Lobby see nothing (the scene is
not synced).

## The panel

| Where | What |
|---|---|
| Top | the **ticker**: "3 working \| 1 needs you \| 2 done today \| 21:48" |
| Left | **Start a job**: Run all tests, Review open PRs, Summarize today, Draft release notes, **+ New task**; the project and CHANGE PROJECT; Sign out |
| Centre | **Working now**: up to four cards (project, task, status, progress, elapsed, files touched); a card waiting on the owner turns **amber**; **Done today** below |
| Right | **Needs you**: up to three approvals, each opening its job |
| Bottom row | **Group watch** (and "Let my group watch: off/on, code 123 456"), the move handles **< ^ v > Near Far**, **Close** |

Pressing a card, a "Needs you" item or New task turns the centre into that job's **chat**: an agent
rail on the left, a header with STOP and BACK TO WALL, twelve conversation lines (paged), the
approval inline (the exact command; APPROVE / DENY / ASK WHY) and quick replies (Keep going,
Explain simply, Stop + summarize) plus Reply... (the typing sheet).

A new approval buzzes **both controllers** twice (`k_haptic_pulse`, 0.8 for 140 ms) and plays a
two-note chime, for the owner only.

**Moving it.** The handles move the panel in 15 cm steps (nearer up to 1.2 m, farther up to 1.0 m,
up or down up to 0.9 m, sideways up to 1.5 m). **After moving the panel with the handles, press Dock
again** on the pinned web page beside it, so the page re-reads its dock (`McPageDock`, about 1 m from
standing eye height) and follows.

**Closing.** Close, or leaving the Lobby, signs out, hides everything and parks the panel again.

## Group watch (off by default)

The owner presses **Group watch**; the bridge makes a 6-digit code (shown on the owner's panel as
"Let my group watch: on, code 123 456") and the owner reads it out. A watcher types it at the Watch
post. The watcher's copy is turned to face the hall and lowered to the floor, so it can be read from
the gallery; it shows what the owner sees plus "pressed: <button>" so the watcher can follow along.

A watcher never signs in, never gets a token and never sends a press (the program refuses to, and
the bridge refuses a press that carries only a watch code). No typing sheet opens and nothing
buzzes on a watcher's headset. The code dies when the owner turns watching off, signs out or
closes the panel, after 20 s without the owner's panel asking for updates (the owner left the Lobby),
or after 2 hours; ten wrong codes a minute are refused. The owner's own watch line never reaches a
watcher.

Why a code and not "group members": the publisher has no `multiplayer` block yet (MULTIPLAYER_001–003
aren't built) and state sync is room-wide and off by default, so world code can't tell who is in the
owner's group.

## How it works

The program (`src/lib.rs`) is deliberately dumb. The bridge decides every word; the world applies
the snapshot it is sent (the AB1 line format, `../agent-bridge/src/wire.ts`) and reports presses:

- **One long poll** at a time (`POST /v1/faces/mission-control/view`, or `/watch` for a watcher):
  the bridge answers when the panel changes, or after 6.5 s with "same". About one request a second
  at most, inside the host's 1/s refill, leaving its burst of 10 for presses.
- **A press** sends the node name plus the snapshot version on screen; the bridge resolves what that
  node meant in that snapshot. The bridge may only name the face's nodes: the seal, the Watch post,
  the handles, the frames and the Dock spot are the world's own and never the bridge's to move.
- **Typing** uses the system typing sheet (`k_ui_prompt`), opened inside the press that asked for it.
- **Text** is world text on 32 anchors (the host's limit). Each anchor is a **3 cm plaque, 2 mm
  thin**, parallel to its panel, so the client prints the text flat (`KWorldTextPool.cpp`, Build
  1009). The bridge shifts each conversation line by half its measured width, so centred text
  reads as left-aligned.
- **Progress bars** use `k_transform_set_scale(bar, 1, f, 1)` (a raw UE relative scale).
- **Done chips** are copies of one mesh (`k_node_clone`, up to 12).
- `k_node_find` sees meshes only on device, so every node the program finds is a mesh.

## Files

| Path | What it is |
|---|---|
| `src/lib.rs`, `Cargo.toml`, `build.rs` | the Lobby's program: the music plus Mission Control (no dependencies) |
| `world.wasm` | the built program; it becomes the Lobby's `module.wasm` |
| `mc_assembly.glb` | Mission Control's nodes (parked), merged into the Lobby's `scene.glb` |
| `lobby-manifest.patch.json` | what 1.2.0 changes in the Lobby's manifest: version, capabilities, host API 4, the chime, the `network` block |
| `bridge-origin.txt` | the origin compiled into the program (the relay Worker); `../mission-control-tools/set-bridge-host.mjs` sets it and the patch together |
| `nodes.json` | every node name the program finds. GENERATED from the bridge's face layout; both sides' tests pin it |
| `audio/chime.wav` | the approval chime |
| `blender/build_panel.py` | builds the panel and fixtures, exports `mc_assembly.glb`, renders the review inside the live Lobby |
| `blender/measure_roboto.py` | measures Roboto's advance widths for the bridge's text layout |
| `review/*.snapshot`, `review/*.jpg` | the captured snapshots and the lit renders made from them |

Tools live in `../mission-control-tools/` (ASSET_006 refuses a `.ps1` in a bundle):
`build_wasm.ps1`, `make_chime.mjs`, `set-bridge-host.mjs`, `mockhost.mjs`, and `lobby/`
(`measure_throne.py`, `merge_glb.mjs`, `package_lobby.mjs`).

## Rebuilding

```
node agent-bridge/scripts/write-nodes-json.mjs          (after npm run build in agent-bridge)
node agent-bridge/scripts/capture-review-snapshots.mjs
"E:/Blender/blender-5.1/Blender Foundation/Blender 5.1/blender.exe" -b -P mission-control/blender/build_panel.py
powershell -NoProfile -ExecutionPolicy Bypass -File mission-control-tools\build_wasm.ps1
node mission-control-tools/mockhost.mjs
node mission-control-tools/lobby/package_lobby.mjs <live lobby 1.1.1 package> <out>
node <publisher>/packages/cli/dist/index.js validate <out>
```

`mockhost.mjs` runs **two copies** of the built program in Node, every `kosmos.*` import stubbed and
`k_net_*` sent over real HTTP to a local bridge (fake adapter): the Lobby loads with its music and
zero network calls; the owner does the ritual and signs in; a job raises an approval (two pulses, one
chime); the owner turns on group watch; the second copy joins with the code and gets the read-only
copy; the owner closes, and the watcher is told nobody is sharing. It passes. It does not check
rendering, the real typing sheet or real haptics.

## The lit-render review (2026-10-14)

The renders import the **live Lobby 1.1.1 scene**, merge the panel, apply the captured snapshots
exactly as the program does, and draw world text as white Roboto at 8 cm on the plaques. **These
are renders, not pixels**: the device checkpoint is the real check. `ritual_seal.jpg` (the disc on
the seat), `watch_button.jpg`, `lock.jpg`, `wall.jpg`, `chat.jpg`, `chat_close.jpg`, `hall_view.jpg`
(the panel's blank back, from the hall) and `watcher.jpg` (the watcher's copy, from the gallery).

What earlier reviews caught and fixed: the width table guessed Roboto about 25% too wide (now
measured); long lines swung into the panel on non-plane anchors (now plaques); glossy panels mirrored
the text (now matte); a closed ring would have been one solid collision box (GLTF_007).

## Device checks owed (the checkpoint, on Build 1009)

1. The ritual: the disc on the seat takes the press from the throne, the typing sheet opens, and the
   panel rises in front of the throne facing the hall; the Watch post opens its sheet.
2. Text: plaques print flat; 8 cm Roboto is readable; the conversation's left edge is straight. If
   widths differ on device, set `textScale` in the bridge's config (no new world).
3. The bars grow left to right; the handles move the panel; Close parks it; leaving the Lobby parks
   it.
4. Both controllers buzz and the chime plays on a new approval; nothing buzzes on a press or for a
   watcher.
5. Group watch on two headsets: the code joins, the watcher's copy faces the hall, the watcher can't
   press anything, and closing ends it.
6. **Dictation:** on the typing sheet's keyboard, does the microphone key appear and type into
   Kosmos? Found so far, without wearing the headset: Kosmos uses the Oculus Keyboard
   (`com.oculus.vrshell/...keyboardv2`), the headsets have an on-device speech service
   (`com.oculus.systemintelligence/.android.speech.OnDeviceRecognitionService`), and Kosmos holds
   RECORD_AUDIO. Whether the mic key shows and works is **unverified**.
7. The Lobby itself is unchanged: music, the coastal video, the Omni Demo orb.

## Known limitations

- The passphrase shows on the typing sheet as it is typed (`k_ui_prompt` has no masked field). The
  ruled R5 world text field (`k_ui_text_begin`, masked) fixes this once a cook carries it.
- The ritual can't check where the visitor stands or looks (see above).
- Four jobs at once (four cards); a fifth waits for one to stop.
- The `X-World-Address` header the bridge checks is forgeable by anyone with an HTTP client; the
  passphrase, the relay key and the bridge's own checks are the protection, not the header.
