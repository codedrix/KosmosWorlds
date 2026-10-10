# Network Required (`world://net-required.micknerks`)

A network world with **`network.required: true`** (KOS-983, lane TW). The test
is the **load**, not the program: a visitor who cannot have network (a guest, a
Ghost, the per-world or master switch off) must be refused at load with "This
world needs the internet" (`NETWORK_BUILD_PLAN.md` §3, check 12).

A visitor who gets in sees one line on the board: what `k_net_status` answered.
It should always read `k_net_status 1 (available)`. If it reads `0`, the world
loaded when it should have been refused.

- **Host API level 4** (it imports `k_net_status`; it never calls a server)
- **Capabilities:** `scene_read`, `ui_basic`, `network`
- **`network.connect`:** server A (`https://kosmos-net-test-a.micknerks.workers.dev`), which opts this world in
- **Publish as:** unlisted, under `micknerks`, after the same steps as `net-check` (see `../net-check/README.md`, "Publishing")
- **Size:** 48 triangles, 4 mesh nodes, a 681-byte wasm module, a 7 KB bundle

Rebuild: see `../net-check/README.md`, "Rebuilding" (one script builds both worlds).

| Path | What it is |
|---|---|
| `manifest.json` | three capabilities, `requires.host_api: 4`, `network.required: true` |
| `world.glb` | floor, back wall, the board and its `StatusLine` anchor, the `spawn_point` marker |
| `world.wasm` | the script: `k_net_status` onto `StatusLine` at `k_init`; imports 3 `kosmos.*` functions |
| `net-required.worldbundle` | the bundle, built with `--host-surface` (P1b has not merged) |
| `src/lib.rs`, `Cargo.toml`, `build.rs` | the script and its build |
