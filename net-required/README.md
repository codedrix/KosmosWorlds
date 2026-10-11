# Network Required (`world://net-required.micknerks`)

A network world with **`network.required: true`** (KOS-983, lane TW). The test
is the **load**, not the program: a visitor who cannot have network (a guest, a
Ghost, the per-world or master switch off) must be refused at load with "This
world needs the internet" (`NETWORK_BUILD_PLAN.md` §3, check 12).

A visitor who gets in sees a short floating text in front of the spawn: what
`k_net_status` answered. It should read `network: AVAILABLE (k_net_status 1)`
and `PASS: expected 1`. If it reads `NOT AVAILABLE`, the world loaded when it
should have been refused. 1.0.1 (2026-10-11) splits the text into short lines,
removes the solid board that buried 1.0.0's 90-character line, and darkens the
room (`sky: "night"`); `../net-check/README.md` explains why.

- **Host API level 4** (it imports `k_net_status`; it never calls a server)
- **Capabilities:** `scene_read`, `ui_basic`, `network`
- **`network.connect`:** server A (`https://kosmos-net-test-a.micknerks.workers.dev`), which opts this world in
- **Published:** unlisted, under `micknerks`; 1.0.0 then **1.0.1**, 2026-10-11 (resolve results in `../net-check/README.md`, "Publishing")
- **Size:** 36 triangles, 3 mesh nodes, a 741-byte wasm module, a 5.9 KB bundle

Rebuild: see `../net-check/README.md`, "Rebuilding" (one script builds both worlds).

| Path | What it is |
|---|---|
| `manifest.json` | three capabilities, `requires.host_api: 4`, `network.required: true` |
| `world.glb` | dark floor, back wall, the floating `StatusLine` anchor, the `spawn_point` marker |
| `world.wasm` | the script: `k_net_status` onto `StatusLine` at `k_init`; imports 3 `kosmos.*` functions |
| `net-required.worldbundle` | the published 1.0.1 bundle (publisher `64c76b1`) |
| `src/lib.rs`, `Cargo.toml`, `build.rs` | the script and its build |
