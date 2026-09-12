# Guestbook — `world://guestbook.micknerks`

The **Wave 2 device-checkpoint world**. Every object in this room exists to make
one line of `docs/CLIENT_COOK_SITTING_RUNBOOK_2026-09.md` §6 step 3 answerable by
looking at a headset, not by reading a test report.

- **Ticket:** NEW-10 (`docs/PHASE_B_EXECUTION_BOARD_v1.0.md`)
- **Host API level:** **2** — it calls `k_ui_prompt`, which no cooked client
  registers yet. That is deliberate, and it is why this world publishes
  **unlisted** and validates through the `--host-surface` escape hatch.
- **Size:** 292 source triangles (268 after the publisher's optimize pass),
  13 nodes, 10 materials, **0 textures**, a 5.5 KB wasm module, a 30 KB bundle.

---

## What is in the room, and what each thing proves

```
                       N
        +--------------------------------------+
        |                  [Door_Home] ->      |   world://home.micknerks
        | [Status] [Plinth] [Phish]  [Beacon]  |   (a `link` extra, no code)
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
| 7 | **the count after leaving and returning** | *"the guestbook count increments on return"* — see the solo sequence below | per-user `guest_name` → registry-derived `guest_count` |
| 8 | **following the door** | *"a link followed shows up in `telemetry_events` within a minute (`link_follow`)"* | the client records it; this world only has to offer a link worth pressing |
| 9 | **`StatusPlate`** | *why* a host call was refused — not a runbook step, but how you read every other one | a third `k_ui_show_world_text`, naming the host's return code |

### What the count does for ONE operator

`guest_count` is `count_users` — **distinct** users — and a returning visitor
re-PUTs the same `guest_name` row. So a solo operator signing on every visit
sees, and should record as a pass:

| visit | on entry | after signing |
|---|---|---|
| 1 | `No one has signed yet` | `1 visitor signed` |
| 2 | `1 visitor signed` | `2 visitors signed` ← a local, display-only nudge |
| 3 | `1 visitor signed` | `2 visitors signed` |

**`0 → 1` on the first return is the pass.** It does not keep climbing for one
person, and the `1` on the third entry is not a regression: it is the registry's
true distinct-user count reasserting itself over the nudge, which is never
written to state. Two different operators signing is what makes it read `2`.

The nudge cannot manufacture a false pass in the other direction — `k_init`
re-reads `guest_count` on every entry, so a dead state pipeline still shows
`No one has signed yet` on re-entry.

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

**The visible half is a SIGHT-LINE test, not a legibility test.** The spawn is
**5.2 m** from the count text, and the contract's legibility target is *readable
at 2 m on device* (LINK_TEXT_PROMPT §2.5) — world-text glyph size is fixed by
the client and a world cannot set it. So read the number from the **approach
position, about 2.9 m out** (`review/approach.png`), then step back to the spawn
and confirm it is still *present*. Scoring "the live aggregate text renders" as
a failure because the glyphs are small from the spawn would be measuring the
wrong thing. This world is the pixel test §2.5 defers to, so the sitting should
record the measured on-device legibility distance as that section's data point.

### What the status plate says, and why it exists

Beside the plinth, a small plate carries the last host result **in words and in
numbers** — `prompt refused: ERR_NO_ACTIVATION (-11)`. A press that produces no
sheet has at least five causes that look identical from inside the room:
`ERR_NO_ACTIVATION` (the activation stamp landed in the wrong place in one of
the three dispatch entry points — *the* thing this cook tests),
`ERR_RATE_LIMITED`, `ERR_PERMISSION_DENIED`, `ERR_INVALID_ARGUMENT`, or a
genuinely broken sheet. Likewise a count that does not move is either a refused
state write or a perfectly healthy world with an unseeded pipeline. Those must
not look alike at a sitting, and nobody should need a USB cable to tell them
apart.

At `k_init` the plate reads `init: text ok | timer ok`. If it is **blank**,
either `StatusPlate` is missing from the GLB or world text is not drawing at all
— the one thing this world cannot report about itself, and worth knowing before
anyone presses anything. → `review/status.png`

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

**How to validate this world today** — on the publisher as it ships, with no
patch of any kind:

```
kosmos-wp validate . --host-surface tools/host-api-levels-level2.json
```

One WASM_007 warning, nothing else. The committed `guestbook.worldbundle` is
that command's output. `review/validate.txt` carries the run verbatim, plus the
same command without the flag so you can see why the flag is still needed.

**WASM_007 warns — working as designed.**

> `[WASM_007] This world requires host API level 2 (it imports
> kosmos.k_ui_prompt, introduced at level 2), but the deployed client is at
> level 1. Once the registry negotiates host API levels it will be served only
> to clients at level 2 or higher — headsets below it are told the world is not
> available for their version, rather than being handed one that dies on the
> first call. Publish it when the level-2 client ships, or drop the level-2
> imports to reach today's fleet.`

That is a WARN, not a REJECT, precisely so the Wave 2 guestbook is publishable
before its own cook (HOST_API_LEVELS_v1.0 §6.3).

### When the flag stops being needed

This world was built against publisher `e66ccfd`, where the escape hatch did not
work at all: `WASM_003` read a hardcoded capability map the `--host-surface`
flag never reached, so **no** level-2 world could validate whatever surface was
passed. This package was the first to prove that, and reported it as a finding
for the publisher lane.

It has since been fixed, twice over, by other people:

- **publisher PR #86** (`fb9b801`) made `WASM_003` resolve through
  `resolveImportCapability` — canon first, the levels table second — so the flag
  now reaches the check. That is what makes the command above work unpatched.
- **publisher PR #88** puts `k_ui_prompt` into the canon map itself. Once it
  merges, a plain `kosmos-wp validate .` gives the same single WASM_007 warning,
  and **this package should delete `tools/` and drop the flag**.

A real publish additionally needs the **registry** to deploy its re-vendored copy
of the same levels table (registry PR #90, after #88); until then a publish 409s
on the recomputed level whatever the publisher says.

`tools/host-api-levels-level2.json` is a **local checkpoint table**, not canon.
It is the publisher's vendored table with **four** changes, and the last three
of them are forced rather than chosen:

1. the three level-2 function rows — `k_ui_prompt` `(iiiii)i`, `k_api_version`
   `()i`, `k_has_fn` `(ii)i` — at `introduced_at: 2`;
2. `current_level` `1 → 2`;
3. `levels."2".count` `null → 75`;
4. **`levels."2"."status": "planned"` deleted.**

(2)–(4) are not optional dressing. The loader derives `current_level` from the
rows and throws if the declared value disagrees, then throws again unless every
level at or below it carries **no `status`** and a `count` equal to the derived
row count — `packages/core/src/validator/host-api-levels.ts:320-359`. The moment
the three rows exist, that spelling is the only legal one.

Item (4) deserves saying out loud, because it is the guard being lifted: the
publisher's own comment calls `"status": "planned"` *"what keeps a level-2 world
out of the registry before a level-2 client exists"* (`validator/wasm.ts:941-943`).
Removing it is exactly how the escape hatch works, and it is why this world is
published **unlisted** and why `deployed_hint.level` is left at **1** — moving
that to 2 would silence WASM_007, the one message this world exists to produce.
No existing function row is touched (`assertNoHistoryRewrite` would refuse it).

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

**1. Geometry + the lit-render review** (writes `world.glb` and all six `review/*.png`):

```
"E:/Blender/blender-5.1/Blender Foundation/Blender 5.1/blender.exe" -b -P blender/build_world.py
```

The export is deterministic: verified byte-identical across two consecutive runs
(`world.glb` sha256 `f47f3018…`).

**2. The wasm module.** Build outside the package: `kosmos-wp` rejects hidden
directories (SEC_002) and a `target/` inside the package would be bundled into
nothing useful and measured into everything.

```
CARGO_TARGET_DIR=../../.build/guestbook cargo build --release --target wasm32-unknown-unknown
cp ../../.build/guestbook/wasm32-unknown-unknown/release/guestbook_script.wasm world.wasm
```

`cargo test` runs the six host-side unit tests (string clipping, the count line,
negative-number printing, and every error code fitting the status plate) against
the SDK's mock-host stubs.

**3. Validate and bundle.** From a built checkout of
`kosmos-worldpublisher` `origin/main` (`npm ci && npm run build`), with
`CLI=packages/cli/dist/index.js`:

```
node $CLI spawn-sync .
node $CLI doctor .
node $CLI validate . --host-surface tools/host-api-levels-level2.json
node $CLI bundle   . --host-surface tools/host-api-levels-level2.json
```

`doctor` has no `--host-surface` flag, so until publisher PR #88 merges it
reports the one WASM_003 finding on `k_ui_prompt` (16 ✅ · 0 ⚠️ · 1 ❌); every
other check is green, and `validate`/`bundle` with the flag are clean.

The committed bundle was produced exactly this way, on `origin/main` `71de5ef`
(core 0.4.2 / CLI 0.3.1), unpatched.

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
| `world.wasm` | the compiled script, 5.5 KB, 11 `kosmos.*` imports |
| `guestbook.worldbundle` | the built bundle, 30 KB — `links[]` lifted, `host_api_table` recorded |
| `src/lib.rs` | the world script |
| `Cargo.toml`, `build.rs` | SDK path dep + `level2`; `--import-memory` and `--export-table` |
| `blender/build_world.py` | geometry, glTF export, and the six review renders — one script |
| `tools/host-api-levels-level2.json` | the local checkpoint levels table (see above) |
| `review/*.png` | the lit-render review — six renders |
| `review/validate.txt` | the validator output, with and without the flag, plus the history |

## Known limitations

- The review renders approximate the client's lighting with a sun and a sky.
  They are for composition and occlusion, not photometry; the client's pawn
  carries its own baked rig.
- The world text and the hover label do not exist in `world.glb` — they are
  runtime calls. The renders stand flat Blender text at the exact positions
  those calls will occupy, added *after* the export so they can never leak into
  it, and cast no shadow, because the real thing does not.
- The proxies' **size** is this world's guess at the client's, which a world
  cannot set. What the renders prove is *where* each string sits and *what
  occludes it*, never how large it will read on device. `StatusPlate` is a
  backing, not a frame: a long status line may well overhang its edges.
- `k_ui_prompt` traps on a level-1 client. Not gracefully: WAMR links imports
  lazily, so the world loads, runs, and dies on the first press of the plinth.
  That is the compatibility promise working as specified, and it is why this
  world stays unlisted until the cook lands.
