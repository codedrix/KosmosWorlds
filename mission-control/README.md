# Mission Control v2, inside the Lobby (`world://lobby.micknerks`)

The CEO's own Claude Code jobs, running on the CEO's PC, in the Lobby. Start a job, read the
conversation and approve what Claude asks to run, without taking the headset off.
Brief: **DB-044** and its v2 addendum (kosmos-project #210). The contract between the two halves is
**`V2_CONTRACT.md`** (beside this file), revised by its section 8 (v2.1, the look-review of
2026-10-19); the PC side is `../agent-bridge/` (its API: `API.md`).

This folder is not a world of its own. It builds **the Lobby's program and Mission Control's
nodes**, and `../mission-control-tools/lobby/package_lobby.mjs` merges them into the live Lobby
package.

- **Status:** v2.1 built, with the holographic-glass art pass (contract section 9; see "The art
  pass" below); the package validates offline with publisher **0.8.1 or later** (83
  rules: PASSED). Its warnings are the live Lobby's own (GLTF_007/008/009), plus two that belong to
  this candidate: NET_007 (the relay's opt-in file is not fetched offline; the registry checks it at
  register) and WASM_007 (level 4 against the vendored deployed hint of 2). The art pass's three
  PNGs carry no hidden data (IHDR, IDAT, IEND only), so they raise no SEC_004. It runs end to end
  against the v2.1 bridge in `mockhost.mjs` and was reviewed in lit renders. **Not published**: the
  CEO sees the renders first, and publishing the Lobby is Class C. The package version stays 1.2.0
  until the lead picks it.
- **Host API level:** **4** (`k_net_*`, `OnNetResult`); also level 3 (`k_haptic_pulse`, `k_log`)
  and level 2 (`k_ui_prompt`). Nothing new is asked of the client.
- **Capabilities added to the Lobby's `audio`:** `scene_read`, `scene_write`, `transform`, `events`,
  `ui_basic`, `player_write` (the buzz), `network`. Never `player_read`, `scene_query` or
  `spatial_anchor`.
- **Network:** one origin, the relay Worker in front of the bridge. Visibility stays **unlisted**.

## What the owner does

1. **The Pairing Seal.** Stand on the throne facing the hall and press the seal on the seat
   (`McSeal`). A ring rises from it to eye height, 1.1 m ahead, and shows a short code (`KXT WMP`).
   The first network call mints that pairing; the world then long-polls `pair`, at least 1.1 s
   apart. **At the PC**, type the code into the bridge's console, or run
   `npm run approve -- KXT-WMP`. The ring turns amber (0.6 s), shrinks away (0.35 s), and the ledge
   and the puck grow in (0.4 s). Nothing secret is typed in the headset. **Use passphrase** under
   the ring opens the old typing sheet (the fallback `signin`); **Cancel** closes everything. A mint
   that fails says what to do ("wait a few seconds and press the seal again").
2. **Job Cubes.** A ledge 0.90 m ahead, 0.80 m up, holds one glass cube per running job (up to
   four; a cube stays with its job), a **+** cube on the right end and **CLOSE** on the left end.
   Calm glows blue, "needs you" amber, idle dim; each has its project's name above it.
3. **Unfold.** Press a cube (or +): the arc unfolds from it, every piece moving out of the cube and
   growing (0.5 s, eased), the words appearing when it lands:
   - **left** (36 degrees): the jobs: the ticker, four tall rails, the done line;
   - **centre**: that job's conversation (1.7 m away), with the ask plate 8 cm in front; with no job
     open (after +) the same area holds the start-a-job set (project, presets, New task);
   - **right** (-36 degrees): the browser spot (DB-043's dock, a placeholder now);
   - **under the centre**: one slim chrome bar: Sign out, Group watch and its line, the six move
     handles.
   **Fold** reverses it: the words go at once, the arc folds back into the cube of the job on show
   (or the ledge's centre if that cube is gone), then hides. The picked cube is hidden while the arc
   is open; pressing another cube moves the arc to that job and makes it the picked cube. A folded
   cube press (or +) unfolds the arc **from that cube**, whichever reply lands first: the bridge
   wakes the view poll with the same `M arc` as the press's own reply, so the press records a
   pending origin and either reply that opens the arc uses it. The press's own reply clears it if
   it says stale, refused, busy or signed out (and if the poll had already unfolded the arc from
   that cube, the cube shows again and the fold goes to the ledge's centre); a few seconds with no
   reply, or Close, clears it too. **Choosing a job from the left panel's rails folds to the
   ledge's centre**, not to that job's cube: the snapshot names the job, not which cube carries it,
   so the world can't tell where that cube sits (the correctness review's LOW, kept on purpose).
   The cube the arc came from shows again. Moving an open arc to another cube or rail changes the
   origin only once the bridge's own reply takes the press: a stale, refused or lost press changes
   nothing.
4. **The decision puck**, on a stem from the throne's LEFT armrest at hand height. When a job needs
   the owner it glows amber, a small dark plate above it shows one line
   (`registry: run npm test`, or `<project>: open its cube` when the whole command doesn't fit),
   and **Approve** / **Deny** tabs sit beside it: two buzzes and the chime. It approves without
   opening the arc, only when the whole command is shown.
5. **Leaving** is one press away whenever signed in: **CLOSE** on the ledge, or the seal on the seat
   again (it toggles). Both park everything at once; the world keeps the token only to send the
   sign-out, retrying on the next frames until the headset takes the call (at most about 5 s), then
   drops it and is Closed. A sign-out from the bridge, or a token the
   bridge no longer knows (expiry, a restart, the kill switch), closes everything the same way: the
   ring never comes up blank.
6. **Watchers** (Group watch, a 6-digit code typed at the Watch post) see the **arc only**, turned
   to face the hall and lowered to its floor, with no action buttons; never the ledge, the puck or
   the seal; never a token, never a press. A watcher leaves at the Watch post.

**Closed** (every visitor until one of the two doors above), the program makes **no network call
at all**, and every node sits parked 200 m below the floor.

## How it works (`src/lib.rs`)

The bridge decides every word and every colour (AB1 snapshots); the world decides where things are
and when its groups show.

- **Groups by name:** seal (`SealRing*`, `TxSeal*`, `BtnSealType`, `McSealCancel`), ledge
  (`McLedge`, `McClose`, `Cube*`, `TxCube*`), puck (`Puck*`, `BtnPuck*`, `TxPuck`), arc (everything
  else, the chrome bar included); `McSeal` and `McWatchJoin` are fixtures.
- **`McFloorRing`**, the projected floor ring, is a world-only node: it is listed in `nodes.json`
  like the others (the bridge's `WORLD_ONLY_NODES`), and the bridge never names it on the wire;
  `build_panel.py`'s contract check requires an exact match with `nodes.json`. It is in the arc
  group, so it shows, unfolds and folds with the arc, but `place` never applies the handle
  adjustment to it: it stays on the hall floor at every handle setting (correctness review 4,
  MEDIUM-1). It is hidden for a watcher, and while the handles hold the arc where the ask plate
  would lie over it from the eye (`floor_clear`, below).
- **Two-layer visibility:** a node shows when the snapshot wants it (`U`, `T` and `H`, stored per
  node) AND its group is on for the stage (seal / lock animation / signed in) and the mode
  (`M cubes` or `M arc`; a watcher: the arc). A tween keeps its group on while it runs.
- **One text function (`show`) and one colour function (`paint(base, state)`):** `paint` shows the
  `<base><State>` variant and hides the others (`off` hides all). DB-045 (the visual pack) replaces
  the bodies of those two functions and nothing else. The puck's label plate is part of its
  `need` variant, so a calm puck is just the puck.
- **Animations** run every frame in `k_tick`, moving only the shown nodes of the moving group (a
  position and a scale each). The worst frame in the host test is 126 host calls (budget 200).
  A face button whose group is still moving is not pressed: its words are not shown yet.
- **Requests:** `AB1`, then `tok <token>` or (no token yet) `pair <id>`, then `v`, `press`, `---`.
  A mint carries neither. A watcher's carries only `watch <code>` and `v`.
- **The handles** move the arc only (the ledge and the puck belong to the throne): 15 cm steps,
  up to 0.5 m nearer, 1.0 m farther, 0.6 m up or down, 1.2 m sideways. A step that would bring any
  arc part (the panels, the ask plate, the bar) into the ledge or the puck is refused
  (`arc_clear`, a separating-axis test against keep-out boxes); a host test walks every setting
  the handles can reach and checks the clearance point by point.
- **The pending pick** (correctness review 3, HIGH-2): `send_press` records a folded cube press as
  `PENDING_PICK` with its request id and time; `update_arc` unfolds from it when any reply opens
  the arc within `PICK_TIMEOUT_S` (4 s); `refuse_pick` drops it on the press's own refusal or
  failed fetch and, if it was already used, un-picks the cube and folds to the ledge's centre.
  Host tests: `the_unfold_comes_from_the_pressed_cube_when_the_poll_lands_first`,
  `the_unfold_comes_from_the_pressed_cube_when_the_press_reply_lands_first`,
  `a_refused_or_stale_cube_press_never_moves_the_unfold`; `a_rail_press_folds_to_the_ledge_centre`
  keeps the rail behaviour.
- **The floor ring's clearance** (`floor_clear`, correctness review 4, MEDIUM-2): the ask plate
  always sits on the centre panel, so plate glass, panel glass and the decal would be three
  layers. `floor_clear` casts the plate's two faces down from the eye onto the decal's footprint
  (x 4.65 to 6.05 m, +-1.8 m) and the ring shows only where none lands on it. With the handles at
  rest, Farther, Up and sideways it shows; one step Nearer or Down hides it (the plate's
  sightlines then land on the decal), and it comes back when the arc returns.
- **The seal's slow turn** (contract 9.5): while the ring shows and isn't animating, `spin_seal`
  turns `SealRing` about its own facing axis at 6 degrees a second (one turn a minute, never an
  oscillation): one host call a frame (`the_seal_rings_turn_slowly_one_call_a_frame`). The code,
  hint and buttons stay still.
- **Closing** is a short stage: parked and hidden at once, holding the token only for the sign-out
  press, retried until the host takes it or `CLOSING_MAX_S` (5 s) passes. Closed makes no call.
- `k_node_find` sees meshes only on device, so every node the program finds is a mesh.

## Geometry (`blender/build_panel.py`, contract sections 2 and 8)

Viewer frame: origin at the owner's feet, facing +X, +Y the owner's left, eye at 1.60 m; turned 180
degrees and set on the seat (STAND 14.8, 0, 1.46). Seat and arms measured from the live scene by
`../mission-control-tools/lobby/measure_throne.py` (arms at y +-1.0, top 2.10).

| Part | Where |
|---|---|
| Seal ring | 1.10 m ahead at eye height, 0.50 m across; code inside, hint and buttons below |
| Ledge | 0.90 m ahead, top 0.80 m, 1.80 m wide; CLOSE, A, B, C, D, + at 0.33 m steps |
| Puck | viewer (0.15, +0.95, 1.00) on a stem from the left arm; the label plate (0.86 x 0.12) above it, 9 cm behind its centre, facing the eye, on a post from the armrest behind the disc; Approve / Deny tabs (0.22 x 0.10) beside it, tilted to the eye |
| Centre panel | 1.70 m, azimuth 0, z 0.79 to 2.19, 1.32 m wide; ask plate 8 cm in front (z 0.815 to 1.36) |
| Chrome bar | under the centre panel, top 0.765 m, 0.10 m tall, 1.56 m wide, same plane |
| Side panels | 1.80 m at +-36 degrees, 0.85 m wide, z 0.95 to 2.16, each turned (yaw only) to face the eye |

From the eye, the cubes and their labels sit below the chrome bar, and the ask plate's bottom stays
above the bar.

## Files

| Path | What it is |
|---|---|
| `V2_CONTRACT.md`, `nodes.json` | the contract and the node list (both owned by the bridge lane; a host test pins the node list) |
| `src/lib.rs`, `src/tests.rs`, `Cargo.toml`, `build.rs` | the Lobby's program (the music plus Mission Control) and its 32 host tests |
| `world.wasm` | the built program; it becomes the Lobby's `module.wasm`; it rebuilds byte-identical from a fresh checkout |
| `mc_assembly.glb` | every node (parked), merged into the Lobby's `scene.glb`; carries three embedded PNGs (the floor ring, 2048 x 1024; two halos, 128 x 128), which `lobby/merge_glb.mjs` appends with their images, sampler and textures (every original Lobby index still checked identical) |
| `lobby-manifest.patch.json` | what the package changes in the Lobby's manifest |
| `bridge-origin.txt` | the origin compiled into the program |
| `audio/chime.wav` | the approval chime |
| `blender/build_panel.py` | builds every node, exports `mc_assembly.glb`, renders the review inside the live Lobby |
| `review/*.snapshot` | the bridge's real snapshots (`agent-bridge/scripts/capture-review-snapshots.mjs`) |
| `review/*.jpg` | the v2.1 lit renders with the art pass, and `art_sheet.jpg` beside the CEO's references (the v1 ones were removed) |
| `review/synthetic/*.snapshot` | contract-shaped stand-ins, from `make_synthetic_snapshots.mjs` |

Tools live in `../mission-control-tools/` (ASSET_006 refuses a `.ps1` in a bundle):
`build_wasm.ps1`, `make_chime.mjs`, `make_synthetic_snapshots.mjs`, `set-bridge-host.mjs`,
`mockhost.mjs`, and `lobby/`.

## Rebuilding

```
node agent-bridge/scripts/write-nodes-json.mjs                 (bridge lane; after npm run build)
node agent-bridge/scripts/capture-review-snapshots.mjs         (bridge lane: review/*.snapshot)
"E:/Blender/blender-5.1/Blender Foundation/Blender 5.1/blender.exe" -b -P mission-control/blender/build_panel.py
powershell -NoProfile -ExecutionPolicy Bypass -File mission-control-tools\build_wasm.ps1
node mission-control-tools/mockhost.mjs                         (AGENT_BRIDGE_DIST=<dist/src> for another checkout)
node mission-control-tools/lobby/package_lobby.mjs <live lobby 1.1.1 package> <out>
node <publisher 0.8.1 or later>/packages/cli/dist/index.js validate <out> --offline
```

`build_panel.py` reads `review/*.snapshot` (the real ones) unless `MC_SNAPSHOTS` names another
folder (`MC_SNAPSHOTS=review/synthetic` for the stand-ins); `-- --only arc,watcher` renders a
subset; `-- --no-render` only exports. An older publisher (0.5.x) has no `--offline` and fails the
level-3/4 imports.

`mockhost.mjs` runs **two copies** of the built program in Node with every `kosmos.*` import
stubbed and `k_net_*` sent over real HTTP to a local bridge (fake adapter), and runs the bridge's
`PAIR_APPROVE` poll (it lives in the bridge CLI's serve loop): the Lobby loads with zero calls; the
seal mints and polls; the code is approved through `PAIR_APPROVE`; the ring locks, the ledge and
the puck grow in; CubePlus unfolds the arc; a preset raises an approval (puck amber, two pulses, one
chime); Fold; Approve on the puck, with CLOSE on the ledge; a job cube unfolds the arc; Group watch;
a watcher gets the arc only, turned, and sends nothing; Close parks everything and the watcher is
told nobody is sharing. **It passes** against the v2.1 bridge. It does not check rendering, the
real typing sheet or real haptics.

## The lit-render review (v2.1, 2026-10-19)

Rendered inside the live Lobby 1.1.1 scene from the **v2.1 bridge's real snapshots**, applying them
the way `lib.rs` does. Eye renders use a headset-like 90 degrees across (about 80 high). **Renders,
not pixels**: the device checkpoint is the real check.

| Render | What it shows |
|---|---|
| `seal_ring.jpg` | the ring raised, blue, with its code, the two-line hint, Use passphrase and Cancel |
| `seal_locked.jpg` | the same ring turned amber (the 0.6 s hold before it shrinks) |
| `cubes_calm.jpg` | over the owner's shoulder: CLOSE, three calm cubes and + on the ledge, the calm puck |
| `cubes_need.jpg` | the same with "registry" amber, the puck amber with its one-line plate and Approve / Deny |
| `puck_close.jpg` | the puck from the eye, at hand height |
| `arc.jpg` | the arc open on a job, from the eye, with the chrome bar and the ledge below it |
| `arc_left.jpg` | the head turned to the left panel: ticker, four rails, done |
| `arc_right.jpg` | the head turned to the right panel: the browser spot |
| `arc_unfolding.jpg` | the arc half way out of its cube (no words yet) |
| `arc_floor.jpg` | a review camera, not the owner's eye: an elevated three-quarter view from behind and above the throne, a step to its right, over the floating arc at its several depths to the projected floor ring on the hall floor (how reference 2 is shot) |
| `watcher.jpg` | a watcher's copy from the hall: the arc only, turned and lowered, no action buttons |
| `art_sheet.jpg` | the look check: CEO reference 1 (the glass wall) beside `arc.jpg` and `seal_ring.jpg`; reference 2 (the floating panels) beside `arc_floor.jpg` and `watcher.jpg` |

What the v2.1 review fixed: a 16:9 eye frame cropped the arc (eye renders are now 90 x 80
degrees); the ask plate's bottom edge sat on the chrome bar as the eye sees it (the plate's bottom
raised to 0.815, the bar's top lowered to 0.765); an empty dark label plate floated over a calm
puck (the plate is now part of the puck's `need` look).

## The art pass (holographic glass, contract section 9, 2026-10-19)

Only `build_panel.py` changed for the look: the node list, every behaviour, the layout and every
text placement are as before, and no node was renamed. The look follows the two CEO references and
`ART_DIRECTION_HOLO_GLASS.md`:

- **Panels:** one flat smoked-glass quad each (dark navy, alpha 0.82), with thin cyan light bars on
  the top and bottom edges, corner brackets and hairline dividers; the ask plate is amber-tinted
  glass with amber bars and brackets; the browser spot keeps its heading over a faint grid.
- **Buttons:** outlined glass: an opaque dark fill with a thin coloured outline (cyan, red, green,
  amber), the label unchanged.
- **Job Cubes:** clear glass (alpha 0.14) with glowing edge lines and an opaque emissive core
  (cyan calm, amber need, grey idle); a need cube has a small soft amber halo behind it (24 x 22 cm,
  its top at 0.93 m so its sightlines land short of the floor ring); + is two lines
  inside a glass cube. The ledge is an opaque shelf with a cyan light bar along its front.
- **The puck:** a glass disc with a teal rim and a cyan ring; in need, an amber ring and dot, and
  the one-line plate in smoked glass with amber bars, on its post.
- **The Pairing Seal:** a smoked disc behind segmented HUD rings, tick marks and inner arcs with a
  soft cyan halo; locked, the rings turn amber and whole. The ring turns slowly (`spin_seal`).
- **The floor:** a projected ring and grid (one 2048 x 1024 PNG decal, its own node
  `McFloorRing` in the arc group, so it shows only while the arc is open) pinned to the hall floor
  4.65 to 6.05 m out: past where any cube or need halo lies from the eye, and short of where the
  ask plate does. The eye sees it under the arc, past the ledge and partly through the chrome bar.
- **Colours:** the PNGs store the palette in sRGB, #5fe6ff cyan and #f3a83a amber (read back from
  the exported GLB); `_write_png` encodes the linear material colours (correctness review 4,
  LOW-1).

**Guardrails, checked:** every emission factor is at most 1.0 (LDR, no bloom; the halos are
painted gradients, not glow); textures are 2048 x 1024 and 128 x 128; nothing imitates Kosmos
chrome (no amber Kosmos logo, no system-sheet shapes; the buttons and panels are Mission Control's
own); white text sits on darker glass than before. **Two stacked translucent layers at most:**
each panel is a single quad; button fills, cube cores and the shelf are opaque. How it is checked,
three ways:
1. **On the real meshes** (`build_panel.py` `audit_layers`, every full build): 265,041
   sightlines from the eye, every 0.25 degrees across azimuth -75 to 75 and elevation -70 to 40,
   counting Mission Control's translucent faces before anything opaque, faces seen from behind
   culled, the decal and halos counted over their whole quads. Three states, each with every
   cube and the puck in need: the seal raised, folded, and the arc open. All three: worst 2, none
   over two; with the arc open, 2,707 sightlines reach the floor ring through one layer and 658
   through two. **Negative control:** with the decal and halo put back where the review found
   them, the same audit stops the build: 672 sightlines through three layers, CubeC + its need
   halo + the floor ring, the review's MEDIUM-2 exactly.
2. **Every handle setting** (host test
   `no_sightline_to_the_floor_ring_crosses_two_other_translucent_layers`): for each setting the
   handles can reach where the ring shows, 4,961 sightlines to the decal are cast against both
   faces of the moved ask plate, independently of `floor_clear`'s algebra; and against every
   cube's glass and need halo (fixed to the throne). None crosses. (It caught a fault in the first
   `floor_clear` before it shipped: only the plate's near face was tested.)
3. **The ring never moves** (host test `the_floor_ring_stays_on_the_hall_floor_whatever_the_handles_do`):
   at every one of the handles' 500-plus settings the ring's position is unchanged, and it shows
   exactly when `floor_clear` says nothing stacks over it; it still folds with the arc, and a
   watcher never sees it.

**What the look review iterated on:** the floor decal and halos first rendered blank (the joined
parts lost their UV layer; fixed); a decal on the dais hid behind the ledge (moved to the hall
floor past the steps); the seal's halo washed over its code (softened twice); text on 0.70 glass
read worse than before (raised to 0.82); the browser spot's grid competed with its heading
(dimmed); the review renders showed mirrored text in the glass (the render-only glass specular is
zero now; the exported materials don't carry it). After review 4: the decal and halos read
darker and redder than the palette (now sRGB-correct: the need halo is amber, the seal's halo the
palette cyan); the floor ring in `arc_floor.jpg` slipped behind the right panel once it moved
out (the review camera was lowered so the ring sits clear beneath the arc).

**Trade-offs, on the record:** (1) the glass is alpha 0.82, darker than the contract's "about
0.6", because white text must read at least as well as before; (2) button fills are opaque, not
glass, to keep every pixel at two translucent layers or fewer; (3) every need cube has its own
halo, so when several jobs need you more than two halos show at once (the seal's halo never shows
with them); (4) the watcher never sees the floor ring (in the mirrored copy it would lie under the
floor); (5) the browser spot keeps its "BROWSER SPOT" heading mesh; (6) the floor ring hides while
the arc is one or more steps Nearer or Down, where the ask plate would stack over it; (7) the need
halo is smaller (24 x 22 cm, was 30 x 30) so it stays off the ring; it reads as a tight amber glow
around the cube; (8) `McFloorRing` is a node the bridge never names on the wire, but it is listed in
`nodes.json` (the lead's ruling: one node list, no private exceptions). (9) The audit covers resting states: during
the 0.5 s unfold (0.4 s fold) the shrinking ring travels with the arc and can pass behind the ask
plate for a moment.

## Device checks owed (the checkpoint, on Build 1009 or later)

1. The seal on the seat takes the press; the ring rises from it facing the owner; the code reads.
2. Approving at the PC locks the ring; the ledge and the puck grow in; nothing is left behind.
3. Cubes press; the arc unfolds from the pressed cube and folds back into the cube of the job on
   show; texts appear only when it lands; the picked cube is hidden while the arc is open.
4. CLOSE on the ledge and the seal press both close, folded or open.
5. Alpha-blended glass and glows read on the mobile renderer (LDR, no bloom): the smoked panels,
   the clear cubes, the halos and the floor ring; white text reads through the glass; the seal's
   slow turn is smooth and comfortable.
6. The puck's Approve / Deny tabs are reachable from the throne with the left hand.
7. Both controllers buzz and the chime plays on a new approval; never for a watcher.
8. Group watch on two headsets: the watcher's arc faces the hall; the watcher can't press.
9. The Lobby itself is unchanged: music, the coastal video, the Omni Demo orb.

## Known limitations

- The fallback passphrase shows on the typing sheet as it is typed (`k_ui_prompt` has no masked
  field); the Pairing Seal is the reason it is now a fallback.
- The seal can't check where the visitor stands or looks (no `player_read` in a network world).
- A watcher's turned arc stands at the dais steps, in front of the Omni Demo orb's label, on the
  watcher's headset only. A watcher has no CLOSE (it is on the ledge, which a watcher never sees);
  the Watch post ends the watch.
- The `X-World-Address` header is forgeable; the pairing approval at the PC, the relay key and
  the bridge's own checks are the protection.
