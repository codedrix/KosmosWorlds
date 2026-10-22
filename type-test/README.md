# Type Test (`world://type-test.micknerks`) -- TEMPORARY

A throwaway room for checking host API level 5's world text input on the CEO's headsets (Build 1013, versionCode 1013, `current_level` 5). Approved by the CEO on 2026-10-21: "go ahead and do the type test, MickNerks, and we can test it. After we test it and it works, please destroy that world."

**This world is meant to be destroyed once the test passes.** It is published unlisted and has no PR.

## What it does

- Two buttons 1.5 m ahead at chest height: **Press to type (plain)** (left, cyan) and **Press to type (password)** (right, amber).
- A press opens the system keyboard with `k_ui_text_begin`: flags 0 for plain, flags 1 (masked, the password keyboard) for password.
- The plaque above each button shows what arrived through `OnTextInput` and `k_ui_text_read`: the plain text itself, or for the password **only its length** ("Password received: N characters").
- The plaque below each button shows the steps (field open, text received, ended) with each call's return code.
- A real Enter on a field opened by a press opens the other field by itself (the Enter re-arm, no press).
- After each Enter the world calls `k_world_navigate` once, to `world://type-test-nowhere.micknerks` (an address that does not exist), and shows the number it returned. The call waits until the last press is 6.5 s old, so the press's 5 s window has closed. The activation gate expects -11.
- Nothing typed is logged, saved or sent: the module imports no `k_log`, no `k_state_*` and no `k_net_*`, and the manifest has no `state` or `network`.

## Build and check

```
powershell -NoProfile -ExecutionPolicy Bypass -File type-test\tools\build_wasm.ps1
node type-test/tools/build_glb.mjs
kosmos-wp validate --deployed-level 4 type-test/world
kosmos-wp bundle --deployed-level 4 type-test/world --output type-test/dist/type-test.worldbundle
kosmos-wp doctor type-test/dist/type-test.worldbundle
```

Use the publisher at `kosmos-worldpublisher` main `ee473e7` or later. WASM_007 warns that level 5 is above the deployed level 4: expected for this test.

## Publish (unlisted) and check

```
kosmos-wp publish type-test/dist/type-test.worldbundle --status unlisted
curl -s "https://api.kosmosvr.com/api/v1/worlds/micknerks/type-test?host_api=5"
```

## Destroy (after the CEO's test passes)

The CEO asked for the world to be destroyed once it works. `kosmos-wp` delete is a **purge** (KOS-573) and is the CEO's call to run; a soft takedown is `--status removed` through the registry. Then remove the `type-test-l5` branch and its worktree.
