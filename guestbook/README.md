# Guestbook — `world://guestbook.micknerks`

The **Wave 2 device-checkpoint world**. Every object in this room exists to make
one line of `docs/CLIENT_COOK_SITTING_RUNBOOK_2026-09.md` §6 step 3 answerable by
looking at a headset, not by reading a test report.

- **Ticket:** NEW-10 (`docs/PHASE_B_EXECUTION_BOARD_v1.0.md`)
- **Host API level:** **2** — it calls `k_ui_prompt`, which no cooked client
  registers yet. That is deliberate, and it is why this world publishes
  **unlisted** and validates through the `--host-surface` escape hatch.
- **Size:** 268 source triangles (244 after the publisher's optimize pass),
  12 nodes, 9 materials, **0 textures**, a 3.8 KB wasm module, a 26 KB bundle.

---

## What is in the room, and what each thing proves

```
                       N
        +--------------------------------------+
        |                  [Door_Home] ->      |   world://home.micknerks
        |  [Plinth]  [PhishPanel]  [Beacon]    |   (a `link` extra, no code)
        |                                      |
   W    |=========================             |    E     <- Partition, x -4.0..-0.8
        |  (the occluder)        ^ gap         |
        |                                      |
        |                           (o) SPAWN  |
        +--------------------------------------+
                       S
```

| # | Thing | Checkpoint step it answers | Mechanism |
|---|---|---|---|
| 1 | **`Plinth`** — `interactable` | *"the prompt sheet appears under the address band"* | `OnInteract` → `k_ui_prompt` |
| 2 | **the count above it** | *"the live aggregate text renders **and is occluded by a wall**"* | `k_ui_show_world_text` on `Plinth`, `offset_y = 1.4` m |
| 3 | **`Partition`** | the occluder for step 2 | a 3.2 × 2.6 m wall at `y = 0` |
| 4 | **`PhishPanel`** | *"…with the phishing fixture, and the visitor can tell it from world-drawn text"* | a second `k_ui_show_world_text`, on world geometry styled as chrome |
| 5 | **`Door_Home`** | *"the door's hover label shows the resolved address"* | a Blender `link` custom property. **Nothing in `src/lib.rs` mentions it** |
| 6 | **`Beacon`** | *"a timer-driven animation moves"* — KOS-353, on device, not in a test | `k_timer_set_interval` → a **one-argument** callback |
| 7 | **the count after leaving and returning** | *"the guestbook count increments on return"* | per-user `guest_name` → registry-derived `guest_count` |
| 8 | **following the door** | *"a link followed shows up in `telemetry_events` within a minute (`link_follow`)"* | the client records it; this world only has to offer a link worth pressing |

### Where to stand

The occlusion test is a walk, not a screenshot:

- **Spawn** (south-east, the red disc in `review/above.png`): the count text is
  **visible** — the sight line passes east of the `Partition`'s end.
  → `review/spawn.png`
- **Walk five metres west**, still along the south wall: the same text is
  **gone**, and only the beacon and the door show past the wall's edge.
  → `review/occluded.png`

If the text stays visible from the second position, world text is not being
depth-tested and the checkpoint has failed — that is the whole reason the wall
is there.

---

## The state model — the part worth reading twice

**This world writes `guest_name`. It never writes `guest_count`.**

`guest_count`, `last_guest` and `last_signed_at` are **derived world-scope rows**.
The registry computes them from every visitor's own per-user `guest_name` row
(`world_state_aggregate_defs`, NEW-07a), and a Postgres trigger *refuses* any
direct write to a world-scope row. So:

```rust
state::set_string("guest_name", name)   // the visitor's own row. The only write.
state::get_i32("guest_count")           // the registry's number. Read only.
state::on_changed("guest_count", cb)    // pushed after an inbound sync applies.
```

There is no `claim_authority` call in this world and no shared-counter write,
because there is nothing here a non-authority could be tempted to PUT. A world
that "incremented the counter" would be writing its own private copy of a shared
number, and it would read back wrong the moment a second visitor arrived.

The one local liberty is named in the code: after a successful signature the
world nudges its **displayed** number by one so the text answers the press
immediately. That number is never written to state, and the next
`on_changed` push replaces it with the registry's.

**Client-side dependency (NEW-09 WP-F).** For the "increments on return" step to
pass, the client has to seed `k_state` from the state route's `aggregates` field
at load and PUT the per-user rows on leave. Until it does, a fresh visit reads
`guest_count` as `0` and the text says *"No one has signed yet"* — which is
honest, and is exactly what a checkpoint failure should look like.

---

## The level-2 problem, stated plainly

`k_ui_prompt` is a **level-2** host function. The deployed fleet is level 1.
Two separate things follow, and only one of them is handled:

**1. WASM_007 warns — working as designed.** `validate` with
`--host-surface tools/host-api-levels-level2.json`:

> `[WASM_007] This world requires host API level 2 (it imports
> kosmos.k_ui_prompt, introduced at level 2), but the deployed client is at
> level 1. Once the registry negotiates host API levels it will be served only
> to clients at level 2 or higher — headsets below it are told the world is not
> available for their version, rather than being handed one that dies on the
> first call. Publish it when the level-2 client ships, or drop the level-2
> imports to reach today's fleet.`

That is a WARN, not a REJECT, precisely so the Wave 2 guestbook is publishable
before its own cook (HOST_API_LEVELS_v1.0 §6.3).

**2. WASM_003 rejects — a publisher gap, not a world defect.** The capability
cross-check reads a *hardcoded* map (`HOST_FUNCTION_CAPABILITIES`,
`packages/core/src/constants.ts`), which stops at the 72 level-1 functions and
has no `k_ui_prompt` row. `--host-surface` does not reach it. On
`kosmos-worldpublisher` `origin/main` `e66ccfd` **no level-2 world can validate,
whatever surface is passed**; this world is just the first to prove it.

The fix is one row in the publisher, in the level-2 lane (NEW-06b), not here —
`review/validate.txt` shows the same command with and without it, and shows that
it is the only thing standing between this world and a clean bundle. NEW-10 owns
`guestbook/**` in KosmosWorlds and deliberately changes nothing else.

`tools/host-api-levels-level2.json` is a **local checkpoint table**, not canon:
the publisher's vendored table copied verbatim, plus the three level-2 rows
(`k_ui_prompt`, `k_api_version`, `k_has_fn`) at `introduced_at: 2`, with
`deployed_hint.level` left at **1** on purpose — moving it to 2 would silence
WASM_007, which is the one message this world exists to produce.

**Nothing in this PR bumps anything to level 2.** Not the publisher's table, not
the SDK's default features, not the registry's `deployed` value. The SDK is
pulled with `features = ["level2"]`, which is the non-default feature the SDK
provides for exactly this case.

---

## Rebuilding

Prerequisites: Blender 5.1, a Rust toolchain with `wasm32-unknown-unknown`,
Node 20, and two sibling clones:

```
<parent>/KosmosWorlds/guestbook      <- this directory
<parent>/kosmos-creator-sdk          <- at edf6176 (NEW-12a: the `level2` feature)
```

**1. Geometry + the lit-render review** (writes `world.glb` and all of `review/*.png`):

```
"E:/Blender/blender-5.1/Blender Foundation/Blender 5.1/blender.exe" -b -P blender/build_world.py
```

The export is deterministic — rebuilding without editing the script reproduces
`world.glb` byte for byte.

**2. The wasm module.** Build outside the package: `kosmos-wp` rejects hidden
directories (SEC_002) and a `target/` inside the package would be bundled into
nothing useful and measured into everything.

```
CARGO_TARGET_DIR=../../.build/guestbook cargo build --release --target wasm32-unknown-unknown
cp ../../.build/guestbook/wasm32-unknown-unknown/release/guestbook_script.wasm world.wasm
```

`cargo test` runs the two host-side unit tests (string clipping and the count
line) against the SDK's mock-host stubs.

**3. Validate and bundle.** From a built checkout of
`kosmos-worldpublisher` `origin/main` (`npm ci && npm run build`), with
`CLI=packages/cli/dist/index.js`:

```
node $CLI spawn-sync .
node $CLI doctor .
node $CLI validate . --host-surface tools/host-api-levels-level2.json
node $CLI bundle   . --host-surface tools/host-api-levels-level2.json
```

`doctor` has no `--host-surface` flag, so it reports the same WASM_003 finding
as RUN 1 of `review/validate.txt`; every other doctor check is green.

**4. Publishing is not part of this PR.** `guestbook.worldbundle` is committed
here; the orchestrator publishes it **unlisted** under the CEO's key. Do not
bump the registry's `deployed` level until the cook has passed its checkpoint on
a headset — an agent's green assertion is not pixels.

---

## Files

| Path | What it is |
|---|---|
| `manifest.json` | the world manifest; `requires.host_api: 2`, six capabilities, `sky: "day"` |
| `world.glb` | the room, with the `spawn_point` / `interactable` / `link` extras |
| `world.wasm` | the compiled script, 3.8 KB, 11 `kosmos.*` imports |
| `guestbook.worldbundle` | the built bundle, 26 KB — `links[]` lifted, `host_api_table` recorded |
| `src/lib.rs` | the world script |
| `Cargo.toml`, `build.rs` | SDK path dep + `level2`; `--import-memory` and `--export-table` |
| `blender/build_world.py` | geometry, glTF export, and the five review renders — one script |
| `tools/host-api-levels-level2.json` | the local checkpoint levels table (see above) |
| `review/*.png` | the lit-render review |
| `review/validate.txt` | the validator output, both runs |

## Known limitations

- The review renders approximate the client's lighting with a sun and a sky.
  They are for composition and occlusion, not photometry; the client's pawn
  carries its own baked rig.
- The world text and the hover label do not exist in `world.glb` — they are
  runtime calls. The renders stand flat Blender text at the exact positions
  those calls will occupy, added *after* the export so they can never leak into
  it.
- `k_ui_prompt` traps on a level-1 client. Not gracefully: WAMR links imports
  lazily, so the world loads, runs, and dies on the first press of the plinth.
  That is the compatibility promise working as specified, and it is why this
  world stays unlisted until the cook lands.
