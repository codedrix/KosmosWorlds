# Type Test (`world://type-test.micknerks`) -- TEMPORARY

A test room for host API level 5, world text input. The CEO approved it on 2026-10-21: "go ahead and do the type test, MickNerks, and we can test it. After we test it and it works, please destroy that world." On 2026-10-22 he ruled: "The remaining checks can be done during the level 6 headset session."

**This world is meant to be destroyed once the level-5 checks pass.** It is unlisted. 1.0.0 was published from an untracked folder; this folder now holds its source (the first commit reproduces the published 1.0.0 byte for byte) and 1.1.0.

## 1.1.0: the checks 1.0.0 could not show

kosmos-project #213 records the 1.0.0 run on Build 1013 and lists what it did not show. 1.1.0 keeps the first row exactly as it was and adds seven cards (`script/src/checks.rs`). The cards' button and plaque layout is new; the first row is 1.0.0's.

| Where | Card | What the CEO does | What a pass looks like on the card |
|---|---|---|---|
| ahead | first row (unchanged) | Press **Press to type (plain)**, type, press the keyboard's **Enter** key (not its close button, and do not point away) | the plain plaque shows the text and "ended: Enter"; **the password keyboard opens by itself** and its status reads "open: yes (Enter), begin 0". If the Enter came less than a second after the field opened, it reads "open: retrying, begin -6" for up to a second first (the one-a-second rule; the world retries for 3 s) |
| left, nearest | **World closes it** | Press once, type a few letters, wait 3 s | the keyboard goes away by itself; "begin 0, end 0", "events after end: 0 (pass)", "read: N at end, -7 next" |
| left, middle | **Open twice, fast** | Press, then press again within a second | "1st: begin 0, end 0", then "again after 0.x s: -6" and "-6: one a second (pass)". If the second press took over a second the card says "opened: over 1 s, retry": press twice again, faster |
| left, far | **Press twice** | Press once (a keyboard opens), then press the card again with the keyboard up | "2nd, still open: -6" and "-6: one field per world (pass)". If it reads -11 instead, the keyboard held the world's input and the press did not count: record that (it is not a failure of the -6 rule, which the middle card also shows) |
| right, nearest | **Size limits** | Press once; type about 20 more characters after the 500 already in the field; press Enter | "plain 513: -7, pw 129: -7", "pw start: -7, 600>512: -7", "512 field: begin 0", "read 512 bytes, max 512" |
| right, middle | **Password, number pad** | Press; **look at the keyboard**; type 10 characters; Enter | the **password keyboard** shows, not a number pad (masked forces it, whatever the layout asks); "got 8 bytes (cap 8)" |
| right, far | **Plain, number pad** | Press; look at the keyboard; type digits; Enter | a **number pad** shows (the contrast with the card before); "You typed: <digits>" |
| behind | **Audit (no echo)** | Type the audit marker (below), Enter | "received N bytes (never copied or shown)". The world reads only the length; it never copies the text |
| every card | the keyboard band | Each time a keyboard opens, read the Kosmos band above it | it names who receives the typing: **micknerks** first, `world://type-test.micknerks` beneath |

Each plaque shows the return code of every call in plain words: 0 ok, -6 too soon (a field is open, or one began less than a second ago), -7 bad size, -8 unsupported, -11 no fresh press.

### The audit: typing goes nowhere else

The world imports no `k_log`, no `k_state_*` and no `k_net_*` (the scenario asserts it), so anything that shows the marker in a log came from Kosmos, not the world. HS2 is the Quest 3S `340YC10GBQ1FYK`; use the other serial for HS3.

```powershell
$adb = 'E:\Andriod\Sdk\platform-tools\adb.exe'; $s = '340YC10GBQ1FYK'
& $adb -s $s logcat -G 16M
& $adb -s $s logcat -c
# In the world: on the Audit card type QZXV7731 and press Enter.
# Then on the first row's password button type PWQZXV7731 and press Enter.
& $adb -s $s logcat -d -v threadtime > E:\wt\l5-audit-logcat.txt
Select-String -Path E:\wt\l5-audit-logcat.txt -SimpleMatch -Pattern 'QZXV7731'
& $adb -s $s shell "grep -c QZXV7731 /sdcard/Android/data/com.kosmos.client/files/UnrealGame/KosmosClient/KosmosClient/Saved/Logs/KosmosClient.log"
# The positive control: the capture did see the typing happen (request ids and byte counts only).
Select-String -Path E:\wt\l5-audit-logcat.txt -Pattern 'KTextInput|KDomUI'
```

**Pass:** `Select-String ... QZXV7731` prints nothing; the `grep -c` prints `0`; and the positive control prints `[KTextInput]` or `[KDomUI]` lines (if it prints none, raise the log verbosity or read the UE log file instead, and say which). A line from another process (the Quest's own keyboard, for example) is recorded with its process name and reported; it is not Kosmos's, but it is worth knowing. Telemetry and the group wire are not visible from the headset log: the client's `Kosmos.TextInput.NeverLogged` test covers the log, and the text-input code has no telemetry or sync call (KWorldTextInput.h's privacy rule).

## Build and check

From the repository root, with the publisher at `kosmos-worldpublisher` main `ee473e7` (which carries #154's level-5 and level-6 table) or later:

```
powershell -NoProfile -ExecutionPolicy Bypass -File type-test\tools\build_wasm.ps1
node type-test/tools/build_glb.mjs
node type-test/tools/scenario.mjs
kosmos-wp validate type-test/world
kosmos-wp bundle --deployed-level 4 type-test/world --output type-test/dist/type-test.worldbundle
kosmos-wp doctor type-test/dist/type-test.worldbundle
node type-test/tools/unpack_bundle.mjs type-test/dist/type-test.worldbundle <dir> --kwld <kosmos-worldpublisher>/packages/kwld/dist/index.js
node type-test/tools/scenario.mjs --glb <dir>/world.glb --wasm <dir>/world.wasm --snapshot <dir>/snapshot.json --snapshot-initial <dir>/snapshot0.json
blender -b --factory-startup --python type-test/tools/render_review.py -- --glb <dir>/world.glb --snapshot <dir>/snapshot.json --views type-test/tools/review_views.json --out <renders>
```

`build_wasm.ps1` runs the host tests (`cargo test`) first. `scenario.mjs` runs the world in `tools/mock-host.mjs`, a model of the client's text-input rules (not the client), as a level-5 client (Build 1013, 32 texts) and a level-6 one (64). WASM_007 warns that level 5 is above the deployed level: expected until `deployed` is bumped.

The world needs only level 5: it runs on Build 1013 and on the level-6 cook.

## Publish (unlisted) -- only when the cook is ready, after review

See the PR. 1.1.0 replaces 1.0.0 at the same address. Never publish against level 5 or 6 before the CEO's `deployed` bump unless he says so for this test world (the runbook's warning).

## Destroy (after the CEO's checks pass)

The CEO asked for the world to be destroyed once it works. `kosmos-wp` delete is a **purge** (KOS-573) and is the CEO's call to run; a soft takedown is `--status removed` through the registry.
