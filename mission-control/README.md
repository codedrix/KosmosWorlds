# Mission Control v2, inside the Lobby (`world://lobby.micknerks`)

The CEO's own Claude Code jobs, running on the CEO's PC, in the Lobby. Start a job, read the
conversation and approve what Claude asks to run, without taking the headset off.
Brief: **DB-044** and its v2 addendum (kosmos-project #210). The contract between the two halves is
**`V2_CONTRACT.md`** (beside this file); the PC side is `../agent-bridge/` (its API: `API.md`).

This folder is not a world of its own. It builds **the Lobby's program and Mission Control's
nodes**, and `../mission-control-tools/lobby/package_lobby.mjs` merges them into the live Lobby
package.

- **Status:** v2 built and validated offline (83 rules: PASSED; every warning is the live Lobby's
  own), run end to end against the v2 bridge in `mockhost.mjs`, and reviewed in lit renders.
  **Not published**: the CEO sees the renders first, and publishing the Lobby is Class C. The
  package version stays 1.2.0 until the lead picks it.
- **Host API level:** **4** (`k_net_*`, `OnNetResult`); also level 3 (`k_haptic_pulse`, `k_log`)
  and level 2 (`k_ui_prompt`). Nothing new is asked of the client. v2 no longer imports
  `k_node_clone` / `k_node_destroy` (no done chips).
- **Capabilities added to the Lobby's `audio`:** `scene_read`, `scene_write`, `transform`, `events`,
  `ui_basic`, `player_write` (the buzz), `network`. Never `player_read`, `scene_query` or
  `spatial_anchor`.
- **Network:** one origin, the relay Worker in front of the bridge. Visibility stays **unlisted**.

## What the owner does

1. **The Pairing Seal.** Stand on the throne facing the hall and press the seal on the seat
   (`McSeal`). A ring rises from it to eye height, 1.1 m ahead, and shows a short code (`KXT WMP`).
   The first network call mints that pairing; the world then polls `pair` about every 1.1 s.
   **At the PC**, type the code into the bridge's console, or run `npm run approve -- KXT-WMP`.
   The ring turns amber (0.6 s), shrinks away (0.35 s), and the ledge and the puck grow in (0.4 s).
   Nothing secret is typed in the headset. **Use passphrase** under the ring opens the old typing
   sheet (the fallback `signin`); **Cancel** closes everything.
2. **Job Cubes.** A ledge 1.0 m ahead holds one glass cube per running job (up to four) and a
   **+** cube. Calm glows blue, "needs you" amber, idle dim; each has its project's name above it.
3. **Unfold.** Press a cube (or +): the arc unfolds from it, every piece moving out of the cube and
   growing (0.5 s, eased), the words appearing when it lands: **left** the jobs (rails, presets,
   New task), **centre** that job's conversation (1.7 m away, 5 degrees below the eye) with the ask
   plate 8 cm in front, **right** the browser spot (DB-043's dock, a placeholder now) with Group
   watch, Sign out, the move handles and Close. **Fold** reverses it: the words go at once, the arc
   folds back into its cube, then hides. The picked cube is hidden while the arc is open.
4. **The decision puck**, on a stem from the throne's LEFT armrest at hand height. When a job needs
   the owner it glows amber and shows the oldest approval (project, title, command) with
   **Approve** / **Deny** beside it: two buzzes and the chime, as before. It approves without
   opening the arc, under the wall's rule (only when the whole command is shown).
5. **Watchers** (Group watch, a 6-digit code typed at the Watch post) see the **arc only**, turned
   to face the hall and lowered to its floor; never the ledge, the puck or the seal; never a token,
   never a press.

**Closed** (every visitor until one of the two doors above), the program makes **no network call
at all**, and every node sits parked 200 m below the floor.

## How it works (`src/lib.rs`)

The bridge decides every word and every colour (AB1 snapshots); the world decides where things are
and when its groups show.

- **Groups by name:** seal (`SealRing*`, `TxSeal*`, `BtnSealType`, `McSealCancel`), ledge
  (`McLedge`, `Cube*`, `TxCube*`), puck (`Puck*`, `BtnPuck*`, `TxPuck`), arc (everything else);
  `McSeal` and `McWatchJoin` are fixtures.
- **Two-layer visibility:** a node shows when the snapshot wants it (`U`, `T` and `H`, stored per
  node) AND its group is on for the stage (seal / lock animation / signed in) and the mode
  (`M cubes` or `M arc`; a watcher: the arc). A tween keeps its group on while it runs.
- **One text function (`show`) and one colour function (`paint(base, state)`):** `paint` shows the
  `<base><State>` variant and hides the others (`off` hides all). DB-045 (the visual pack) replaces
  the bodies of those two functions and nothing else.
- **Animations** run every frame in `k_tick`, moving only the shown nodes of the moving group (a
  position and a scale each). The worst frame in the host test is 126 host calls (budget 200).
- **Requests:** `AB1`, then `tok <token>` or (no token yet) `pair <id>`, then `v`, `press`, `---`.
  A mint carries neither. A watcher's carries only `watch <code>` and `v`.
- **The handles** move the arc only (the ledge and the puck belong to the throne): 15 cm steps,
  up to 0.6 m nearer, 1.0 m farther, 0.6 m up or down, 1.2 m sideways.
- `k_node_find` sees meshes only on device, so every node the program finds is a mesh.

## Geometry (`blender/build_panel.py`, contract section 2)

Viewer frame: origin at the owner's feet, facing +X, +Y the owner's left, eye at 1.60 m; turned 180
degrees and set on the seat (STAND 14.8, 0, 1.46). Seat and arms measured from the live scene by
`../mission-control-tools/lobby/measure_throne.py` (arms at y +-1.0, top 2.10).

| Part | Where |
|---|---|
| Seal ring | 1.10 m ahead at eye height, 0.50 m across; code inside, hint and buttons below |
| Ledge | 1.0 m ahead, top **0.95 m**, 1.64 m wide; slots 0.36 m apart, CubePlus on the right |
| Puck | viewer (0.15, +0.95, 1.00) on a stem from the left arm; Approve to its right, Deny to its left, tilted to the eye; its label 0.18 m above |
| Centre panel | 1.70 m, azimuth 0, z **0.79 to 2.19**, 1.32 m wide; ask plate 8 cm in front |
| Side panels | 1.80 m at +-40 degrees, flat facets facing the eye, z **0.83 to 2.16**, 1.02 m wide |

## Files

| Path | What it is |
|---|---|
| `V2_CONTRACT.md`, `nodes.json` | the contract and the node list (both owned by the bridge lane; a host test pins the node list) |
| `src/lib.rs`, `src/tests.rs`, `Cargo.toml`, `build.rs` | the Lobby's program (the music plus Mission Control) and its 18 host tests |
| `world.wasm` | the built program; it becomes the Lobby's `module.wasm` |
| `mc_assembly.glb` | every node (parked), merged into the Lobby's `scene.glb` |
| `lobby-manifest.patch.json` | what the package changes in the Lobby's manifest |
| `bridge-origin.txt` | the origin compiled into the program |
| `audio/chime.wav` | the approval chime |
| `blender/build_panel.py` | builds every node, exports `mc_assembly.glb`, renders the review inside the live Lobby |
| `review/*.jpg` | the v2 lit renders (and the v1 ones they replace, kept for comparison) |
| `review/synthetic/*.snapshot` | contract-shaped stand-ins, from `make_synthetic_snapshots.mjs` |

Tools live in `../mission-control-tools/` (ASSET_006 refuses a `.ps1` in a bundle):
`build_wasm.ps1`, `make_chime.mjs`, `make_synthetic_snapshots.mjs`, `set-bridge-host.mjs`,
`mockhost.mjs`, and `lobby/`.

## Rebuilding

```
node agent-bridge/scripts/write-nodes-json.mjs                 (bridge lane; after npm run build)
node agent-bridge/scripts/capture-review-snapshots.mjs         (bridge lane: review/*.snapshot)
MC_SNAPSHOTS=<dir with the real snapshots> "E:/Blender/blender-5.1/Blender Foundation/Blender 5.1/blender.exe" -b -P mission-control/blender/build_panel.py
powershell -NoProfile -ExecutionPolicy Bypass -File mission-control-tools\build_wasm.ps1
node mission-control-tools/mockhost.mjs                         (AGENT_BRIDGE_DIST=<dist/src> for another checkout)
node mission-control-tools/lobby/package_lobby.mjs <live lobby 1.1.1 package> <out>
node <publisher>/packages/cli/dist/index.js validate <out> --offline
```

`build_panel.py` reads `review/synthetic/` unless `MC_SNAPSHOTS` names another folder;
`-- --only arc,watcher` renders a subset; `-- --no-render` only exports.

`mockhost.mjs` runs **two copies** of the built program in Node with every `kosmos.*` import
stubbed and `k_net_*` sent over real HTTP to a local bridge (fake adapter), and runs the bridge's
`PAIR_APPROVE` poll (it lives in the bridge CLI's serve loop): the Lobby loads with zero calls; the
seal mints and polls; the code is approved through `PAIR_APPROVE`; the ring locks, the ledge and
the puck grow in; CubePlus unfolds the arc; a preset raises an approval (puck amber, two pulses, one
chime); Fold; Approve on the puck; a job cube unfolds the arc; Group watch; a watcher gets the arc
only, turned, and sends nothing; Close parks everything and the watcher is told nobody is
sharing. **It passes** against the v2 bridge lane's build (feat/mc2-bridge 847dce5). It does not
check rendering, the real typing sheet or real haptics.

## The lit-render review (2026-10-19)

Rendered inside the live Lobby 1.1.1 scene from the **v2 bridge's real snapshots**
(feat/mc2-bridge 847dce5), applying them the way `lib.rs` does. **Renders, not pixels**: the device
checkpoint is the real check.

| Render | What it shows |
|---|---|
| `seal_ring.jpg` | the ring raised, blue, with its code, the two-line hint, Use passphrase and Cancel |
| `seal_locked.jpg` | the same ring turned amber (the 0.6 s hold before it shrinks) |
| `cubes_calm.jpg` | over the owner's shoulder: the ledge with three calm cubes and +, the puck calm |
| `cubes_need.jpg` | the same with "registry" amber, the puck amber with its three-line label and Approve / Deny |
| `puck_close.jpg` | the puck from the eye, at hand height |
| `arc.jpg` | the arc open on a job, from the eye |
| `arc_unfolding.jpg` | the arc half way out of its cube (no words yet) |
| `watcher.jpg` | a watcher's copy from the hall: the arc only, turned and lowered |

What this review fixed: no labels drawn at all (the review read a text's "wanted" from `U`); every
label's shadow drawn as a ghost on the panel behind it (the sun now casts none, as on the headset);
the cubes covering the ask plate's Approve row and the right panel's Close row as the eye sees
them (the ledge dropped to 0.95 m, the bottom rows raised); the bridge's two-line header and ticker
and three-line done list and page-spot text running into neighbours (the centre and side panels
grew upward, the page-spot words moved inside the spot, Group watch joined the Sign out / Close
row); the seal hint running over the ring; a pale "calm" blue.

## Device checks owed (the checkpoint, on Build 1009 or later)

1. The seal on the seat takes the press; the ring rises from it facing the owner; the code reads.
2. Approving at the PC locks the ring; the ledge and the puck grow in; nothing is left behind.
3. Cubes press; the arc unfolds from the pressed cube and folds back into it; texts appear only
   when it lands; the picked cube is hidden while the arc is open.
4. Alpha-blended glass and glows read on the mobile renderer (LDR, no bloom).
5. The puck's Approve / Deny are reachable from the throne with the left hand.
6. Both controllers buzz and the chime plays on a new approval; never for a watcher.
7. Group watch on two headsets: the watcher's arc faces the hall; the watcher can't press.
8. The Lobby itself is unchanged: music, the coastal video, the Omni Demo orb.

## Known limitations

- The fallback passphrase shows on the typing sheet as it is typed (`k_ui_prompt` has no masked
  field); the Pairing Seal is the reason it is now a fallback.
- The seal can't check where the visitor stands or looks (no `player_read` in a network world).
- A watcher's turned arc stands at the dais steps, in front of the Omni Demo orb's label, on the
  watcher's headset only.
- The `X-World-Address` header is forgeable; the pairing approval at the PC, the relay key and
  the bridge's own checks are the protection.
