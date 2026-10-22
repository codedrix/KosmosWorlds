# Visual Pack Check (`world://visual-pack-check.micknerks` and `world://visual-pack-check-mr.micknerks`) -- TEMPORARY

Two unlisted test rooms for the CEO's level-6 headset checkpoint: the DB-045 visual pack (styled text and the plate, colour, glow, fade and reset, pictures from the bundle, and hover). They follow the device checkpoint in `docs/DB045_VISUAL_PACK_SITTING_RUNBOOK_v1.0.md` section 7.2 (K1 to K11, and the extras the reviews asked for). The level-5 checks the CEO ruled into the same session are in `type-test/` (1.1.0).

**Publishing these is the CEO's call** (see "Publishing" below): the runbook holds every level-6 world back until the `deployed` bump, and these are the test worlds the checkpoint itself runs on. They are meant to be taken down once the checkpoint is recorded.

The VR room and the MR room run the same `world.wasm`; the script tells them apart by the node `MrMarker`, which only the MR scene has. Every call's return code is shown on a plaque, in plain words. Tabs, buttons, captions and status lines use today's plain look (`k_ui_show_world_text`), so only what is under test uses the new call.

## Before the session

**Order:** run the Colour page's K6 (**256: make**) first, before Pictures, Hover and Travel (it resets every look anyway, but running it first keeps the other pages' looks). Then the pages in tab order.

- **The cook:** a level-6 cook of `feat/device-p2-2026-10` at `a1936d8` or later, with the sitting's assets (Inter and the plate) if the sitting has happened. Without them the client falls back to Roboto and a square, fully dark plate (runbook section 5): K1's and K4's look then waits for a later sitting.
- **The two worlds published unlisted** (see "Publishing"), and `world://type-test.micknerks` 1.1.0, which the Travel page's door goes to.
- **Logs** (PowerShell; HS2 is the Quest 3S `340YC10GBQ1FYK`, HS3 the Quest 3 `2G0YC1ZF9H06CW`):

  ```powershell
  $adb = 'E:\Andriod\Sdk\platform-tools\adb.exe'; $s = '340YC10GBQ1FYK'
  & $adb -s $s logcat -G 16M
  & $adb -s $s logcat -c      # just before entering the world
  ```

## The VR room: the tabs on your left

Stand at the spawn. The six tabs are on your left; the current one reads `> Name`. The page's title is above the board ahead of you; its two status plaques are on your right. Buttons are in short columns either side of the board.

### Text (K1, K3)

| Check | What to do | Pass |
|---|---|---|
| K1 | Look at the board from the spawn (about 2.6 m), then walk up to it. Three columns: left aligned, centred, right aligned; in each, `Ag` at 160 mm SemiBold (amber) and Regular (cyan), and a line at 10 mm in each weight. Each column has a thin line: left-aligned text starts at it, right-aligned text ends at it | reads at 2 m (the 10 mm lines are for arm's length); edges soft, no blockiness or halo; the plate dark, rounded, a hair behind the text. The plate's look on the Adreno is the CEO's taste call. Also look from the side and from the back of the room |
| K1 | **Plates: on/off** | every sample's plate goes and comes back; nothing else changes |
| K1 | **Try bad values** | the right-hand lower plaque: alpha FE, 9 mm, 161 mm, strong + Roboto, align 3, flag 32, 129 bytes and empty text each read **-7** |
| K1 | the violet `size 0 = 80 mm` | the default size |
| extra | **Old call: top middle** | the top middle `Ag` turns plain white Roboto with no plate (the old call on a styled node resets it); press again to restore |
| K3 | Turn right, a little behind you: `Behind a wall` with a short wall in front of its left half. Walk around it; open the menu in front of it | the wall hides both the text and its plate where it covers them; the address band, notices and menu draw over both |

The upper status plaque says `styled shows: 14 of 14 answered 0` and the level the headset reports (6).

### 64 texts (K2)

Press the tab. The board shows 64 plated texts in eight colours, all three alignments and both weights: **every text slot the world has**. The tabs, title and status hide to make room; the first cell is the summary:

- `64 texts. 65th: -5`: a 65th show on another mesh is refused (the pool is full);
- the frame time over the last second, average and worst, from the world's own `k_tick`;
- `hover on/off, deep in/out`: the tower on your left is 16 nested levels; only its root listens. Point at its top block: `deep` counts an Enter and an Exit on the root, 15 levels up;
- **press the tower's root block** (the lowest) to turn the world's hover subscriptions off and on: compare the frame time with hover on and off (a world that does not subscribe should pay nothing);
- press any cell to go back to the Text page.

**This room is not the Lobby.** K2's pass criterion is 72 Hz in the Lobby with Mission Control open; that reading is taken there. This page adds a 64-plate reading and the deep-hierarchy hover cost.

### Colour (K5, K6, K8)

Objects on a line ahead: a lit cube, a BLEND panel, an opaque panel, an unlit tile, two cubes sharing one material (A and B), and the "Done" chip with an empty frame beside it. Buttons left and right.

| Check | Buttons | Pass |
|---|---|---|
| K5 colour | **Colour (cycle)** | the cube turns amber, teal, red, white: colours show as written; `colour 0` |
| K5 glow | **Glow 0.5 / 1 / 0** | a flat bright amber, brighter at 1, nothing above 1, no halo; `glow 0 at 0.5`, then `at 1.0` |
| K5 fade | **Fade 0.3 / 1** | the BLEND panel fades to 0.3 and back; `fade 0 to 0.3` |
| K5 -8 | **Try the -8 cases** | `fade opaque -8, glow unlit -8`; `colour on unlit` shows what the host answers for an unlit material's colour |
| K5 reset | **Reset the cube** | the authored grey is back; `reset 0` |
| extra | **Colour shared A** | A turns teal and **B does not** (each mesh gets its own copy) |
| K8 | **Clone the chip**, then **Colour the clone** | the source chip turns amber, then a copy appears in the frame **with the authored grey**, not amber; then the copy turns green. `chip 0, clone <handle>, moved 0, green 0` |
| K6 | **256: make**; read; **65 in one frame**; **256: release** | it first resets every look the world has changed on any page (colours, pictures, hover lights, travel looks), waits a frame, then the tile wall above takes 256 colours over four frames: `256: made 256, refused 0 (pass)`, then `257th -5 (pass)`. `65 writes: 65th -6 (pass)`. `released 0`. Because of the reset it can be run at any point; running it **first**, before Pictures, Hover and Travel, keeps those pages' looks. Record the frame time (the title's last line) and the memory (below) |

K6 memory, before **256: make** and after it (and after release):

```powershell
& $adb -s $s shell dumpsys meminfo com.kosmos.client | Select-String 'TOTAL PSS|Graphics|GL mtrack'
```

### Pictures (K7)

Six quads ahead, and a small one with no UV0 on the right.

| Button | Pass |
|---|---|
| **Show pictures** | 1 to 6 appear, each upright (TOP at the top, TL in the top-left corner), sharp: `show: 0 0 0 0 0 0` |
| **Swap pictures** | they move one quad along, at once (a parameter swap, no hitch): `swap 0` |
| **Tint pictures** | warm and blue tints: `tint 0` |
| **Unlisted path** | `unlisted path -4 (want -4)` |
| **Mesh with no UV0** | **Expected: `no UV0 0 (expected: see right)`.** DB-045 says `-8` for a mesh with no UV0, but the client returns 0: its glTF loader (glTFRuntime) always builds at least one UV channel, filling it with zeros when the glTF has none, so the client's `-8` branch cannot fire for a world mesh. **This is a contract gap and a client finding, not a pass**; the right-hand plaque says so. If it ever reads `-8`, the card says `(DB-045's -8)` |
| **Reset pictures** | the placeholders are back: `reset 0` |

The six are decoded once, under the loading cover: 6 x 1024 x 1024 x 4 = 24 MiB, the budget exactly. Formats: PNG RGB, PNG greyscale, baseline JPEG and progressive JPEG (4:2:0), greyscale JPEG, PNG RGB. Each file is under 60 KB. The decode lines:

```powershell
& $adb -s $s logcat -d | Select-String 'KBundleImages'
```

Pass: six `decoded 'media/pic-...' 1024x1024 (4194304 bytes; ... of 25165824 this world)` lines and no `skipped`. The optional over-budget case (a 7th picture) is refused at publish, so it is covered by the client's headless `Kosmos.Material.Images.Refusals`, not here.

### Hover (K9)

Point; do not press. The upper status counts Enters and Exits per hand; the plaque under it, the last four events with their times.

| Check | What to do | Pass |
|---|---|---|
| per hand | Rest the left ray on **Point here**, then the right | the pad turns cyan (left), amber (right), white (both); `left: in 1 ... right: in 1` |
| the 60 ms rest | Sweep one ray quickly across the twelve thin bars, then slowly | a quick sweep lights few or none (a bar lights green when entered); a slow one lights each |
| the rate cap | Sweep both rays back and forth along the row of small tiles for several seconds | `most Enters: N in 1 s, M in 3 s`. The cap is a bucket of 10 a second with bursts of 10, so from rest at most 20 in one second and at most 40 in three |
| the menu | Rest a ray on the pad, open the menu | an `out` at once in the log; no `in` while the menu is open; one after it closes |
| concave target | Point through the arch's opening at the wall behind it, then at the arch's sides | the **wall behind** counts through the hole, the **arch** counts on its sides. If the arch counts through its hole, the hover ray traces simple collision: record it (reading R-15) |
| hover then travel | Do not press anything for **more than 5 s** (the plaque's `last press N s ago`), then rest a ray on **Point, then wait** and keep the menu closed | `hover, then travel: in N s`, then **`-11 (pass)`**. The world calls `k_world_navigate` 1 s after the hover Enter, inside the 5 s window a stamp would open, so a hover that stamped activation would read **`0 (FAIL)`**. If your last press was less than 5 s before the call, the press's own window decides and the card reads **`INCONCLUSIVE`** with `a press was <5 s before: wait`: wait, point away, and point again. Lost input focus (the menu open) also reads -11: keep the menu closed |
| tracked hands | Put the controllers down and repeat the pad check with hands | the same; two hands on one target give two Enters |
| `world_hover` | Optional, the CEO's act: put `world_hover` on the client policy's off-list (registry setting, a DEPLOY_LEDGER row), then travel in again | no hover at all; every page still works plainly |
| PhysicsBody | not possible from a world | a world's meshes are WorldDynamic; no world can make a PhysicsBody prop. See follow-ups |

**Clear the counts** resets the page.

### Travel (K11, and the cancelled-travel restore)

1. **Set the looks**: the cube amber, the glow mesh teal at 0.8, the BLEND panel at 0.3, the picture quad showing picture 1. Status: `looks: colour 0, glow 0, fade 0 / picture 0`.
2. **Door: Type Test**, then press **Cancel** in the travel cover (forward travel holds the cover about 5 s). While the travel is pending, 1 s after the door, the world turns the cube green and resets the glow mesh, if it still ticks: `while travelling: green 0, reset 0 at 1.0` (`waiting` means it did not tick while the cover was up).
3. After Cancel: **the cube green** (the newer value), **the glow mesh as modelled** (reset since), **the panel faded and the picture back**. While the cover closes, the meshes show their modelled look: expected.
4. **Door: nowhere** (`world://visual-pack-nowhere.micknerks` does not exist): the registry refuses it; everything comes back the same way. (The level-6 cook carries KOS-742, so a refused travel no longer strips the source world.)
5. **K11:** set the looks and show the pictures again, then take **Door: Type Test** and let it travel. In Type Test:

```powershell
& $adb -s $s logcat -d | Select-String '\[KDomMaterial\] released|\[KBundleImages\] released|\[KWorldText\]'
```

What these lines show: at the travel start, `[KDomMaterial] released N material override(s)` and `[KBundleImages] released 6 image texture(s)`, so **the release ran**. They do **not** show that the live counts reached zero after the cover: there is no console command or log line for the live counters (`FKMaterialOverrides::GetLiveInstanceCountGlobal`, `FKBundleImages::GetLiveTextureCountGlobal`), and the text plates have no release line at all. K11 is therefore only partly evidenced from a world (see follow-ups).

### K10: two headsets

Both headsets in this room. Change colours, show pictures and hover on one: **the other shows none of it**. The world imports no `k_state_*` and no `k_net_*`; the visual pack never syncs.

## The MR room (K4)

**K4 runs in this world's MR twin, `world://visual-pack-check-mr.micknerks`, not in `more-room-mr`** as runbook section 7.2 names; the plate-over-passthrough check is the same. Record which world was used in the ledger row.

`world://visual-pack-check-mr.micknerks`: plated texts at 20 to 120 mm floating over your real room, a BLEND panel and a solid one, two buttons. The world is room-scale: everything is within reach of the spawn.

| Check | Pass |
|---|---|
| plates over passthrough | each plate darkens only its own footprint; the room around it is never dimmed |
| **Plates: on/off** | the plates go and come back |
| **Fade 0.4 / 1** | the BLEND panel fades over the room; `fade 0` |

The status reads `styled shows: 6 of 6 answered 0`.

## Build and check

From the repository root, with `kosmos-worldpublisher` main `ee473e7` (which carries #154: the level-5 and level-6 table and ASSET_007) built in a worktree, and Blender 5.1:

```
node visual-pack-check/tools/make_images.mjs --sharp <kosmos-worldpublisher>/node_modules/sharp
node visual-pack-check/tools/build_glb.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File visual-pack-check\tools\build_wasm.ps1
node visual-pack-check/tools/scenario.mjs
kosmos-wp validate visual-pack-check/world-vr
kosmos-wp validate visual-pack-check/world-mr
kosmos-wp bundle --deployed-level 4 visual-pack-check/world-vr --output visual-pack-check/dist/visual-pack-check.worldbundle
kosmos-wp bundle --deployed-level 4 visual-pack-check/world-mr --output visual-pack-check/dist/visual-pack-check-mr.worldbundle
node visual-pack-check/tools/unpack_bundle.mjs <bundle> <dir> --kwld <kosmos-worldpublisher>/packages/kwld/dist/index.js
node visual-pack-check/tools/scenario.mjs --vr <vr dir> --mr <mr dir> --snapshots <snap dir>
blender -b --factory-startup --python visual-pack-check/tools/render_review.py -- --glb <vr dir>/world.glb --snapshot <snap dir>/text.json --views visual-pack-check/tools/review_views_vr.json --out <renders> --images <vr dir> --font <dir with Inter-Regular.ttf and Inter-SemiBold.ttf>
```

- `build_wasm.ps1` runs the host tests first (every text measured against its plaque with Roboto's or Inter's advances, every styled call one the host accepts, no text cut at 128 bytes, the node names' rules, and the call sequences of each check).
- `scenario.mjs` runs the module in `tools/mock-host.mjs`, a model of the client at `a1936d8` (not the client), page by page; with `--vr`/`--mr` it runs the bundle's optimized scene. It writes one state per page for the renders.
- WASM_007 warns that level 6 is above the deployed level: expected until the bump.
- The bundler is not byte-reproducible (the bundle records its build time), so the bundles reviewed are the ones in `release/`.

## Publishing (unlisted) -- only when the cook is ready, after review

The runbook says no world may be published against level 6 until the `deployed` bump (section 6.5's warning). These two are the test worlds the checkpoint itself runs on, so publishing them first is an exception only the CEO can make (as he did for `type-test` 1.0.0 at level 5). The registry stores them with `min_host_api` 6 and serves them to no headset below that level. The commands are in the PR.
