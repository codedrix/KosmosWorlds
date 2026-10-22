# Type Test (`world://type-test.micknerks`) -- TEMPORARY

A test room for host API level 5, world text input. The CEO approved it on 2026-10-21: "go ahead and do the type test, MickNerks, and we can test it. After we test it and it works, please destroy that world." On 2026-10-22 he ruled: "The remaining checks can be done during the level 6 headset session."

**This world is meant to be destroyed once the level-5 checks pass.** It is unlisted. 1.0.0 was published from an untracked folder; this folder now holds its source (built from the first commit, every asset and the manifest match the published 1.0.0; only the bundle container differs, in its `validation.validated_at` build stamp) and 1.1.0.

## 1.1.0: the checks 1.0.0 could not show

kosmos-project #213 records the 1.0.0 run on Build 1013 and lists what it did not show. 1.1.0 keeps the first row exactly as it was and adds seven cards (`script/src/checks.rs`). The cards' button and plaque layout is new; the first row is 1.0.0's.

| Where | Card | What the CEO does | What a pass looks like on the card |
|---|---|---|---|
| ahead | first row (1.0.0's flow) | Press **Press to type (plain)**, type, press the keyboard's **Enter** key (not its close button, and do not point away) | the plain plaque shows the text and "ended: Enter"; **the password keyboard opens by itself** and its status reads "open: yes (Enter), begin 0". If the Enter came less than a second after the field opened, it reads "open: retrying, begin -6" for up to a second first (the one-a-second rule; the world retries for 3 s). The navigate line above the row reads "returned -11, conclusive" only when the Enter came 2 s or more after your last press (the call is made 6.5 s after the press, so it is then inside the Enter's own 5 s): **take at least 2 s before pressing Enter**. "inconclusive" means the -11 says nothing about the Enter |
| left, nearest | **World closes it** | Press once, type a few letters, then **stop typing** and wait for the 3 s mark | the keyboard goes away by itself; "begin 0, end 0", "events after end: 0 (pass)", "read: N at end, -7 next". A stray event shows as "after end: N, code C (FAIL)"; if it is code 1 and you typed in the last moment before 3 s, it is likely a client delivery-order finding (a keystroke in the last frame delivered after the end), not a world defect: record the code |
| left, middle | **Open twice, fast** | Press, then press again within a second | "1st: begin 0, end 0", then "again after 0.xx s: -6" and "-6: one a second (pass)". The pass words depend on the measured gap: a -6 at 1 s or more reads "-6: another field was open" (a different rule; close any other keyboard and retry); a 0 at 1 s or more reads "opened: over 1 s, retry" (press twice again, faster); **a 0 under 1 s reads "FAIL: host let it open"**: that is the host's failure, not yours |
| left, far | **Press twice** | Press once (a keyboard opens), **wait more than a second**, then press the card again with the keyboard up | "2nd after 1.xx s: -6" and "-6: one field per world (pass)". Under a second the one-a-second rule alone answers -6, so the card says "under 1 s: inconclusive" (press again). A 0 reads "FAIL: the host opened a second field". If it reads -11, the keyboard held the world's input and the press did not count: record that |
| right, nearest | **Size limits** | Press once; type about 20 more characters after the 500 already in the field; press Enter | "plain 513: -7, pw 129: -7", "pw start: -7, 600>512: -7", "512 field: begin 0", "read 512 bytes, max 512" |
| right, middle | **Password, number pad** | Press; **look at the keyboard**; type 10 characters; Enter | the **password keyboard** shows, not a number pad (masked forces it, whatever the layout asks); "got 8 bytes (cap 8)" |
| right, far | **Plain, number pad** | Press; look at the keyboard; type digits; Enter | a **number pad** shows (the contrast with the card before); "You typed: <digits>" |
| behind | **Audit (no echo)** | Type the audit marker (below), Enter | "received N bytes (never copied or shown)". The world reads only the length; it never copies the text |
| every card | the keyboard band | Each time a keyboard opens, read the Kosmos band above it | it names who receives the typing: **micknerks** first, `world://type-test.micknerks` beneath |

Each plaque shows the return code of every call in plain words: 0 ok, -6 too soon (a field is open, or one began less than a second ago), -7 bad size, -8 unsupported, -11 no fresh press.

### The audit: typing goes nowhere else

The world imports no `k_log`, no `k_state_*` and no `k_net_*` (the scenario asserts it), so anything that shows the marker in a log came from Kosmos, not the world. **Never type a real password into any field of this world**: the plain fields are shown on plaques by design, and the markers below are made up. HS2 is the Quest 3S `340YC10GBQ1FYK`; use the other serial for HS3.

```powershell
$adb = 'E:\Andriod\Sdk\platform-tools\adb.exe'; $s = '340YC10GBQ1FYK'
& $adb -s $s logcat -G 16M
& $adb -s $s logcat -c
$pid0 = (& $adb -s $s shell pidof com.kosmos.client).Trim()
# In the world: on the Audit card type QZXV7731 and press Enter.
# Then on the first row's password button type PWQZXV7731 and press Enter.
$pid1 = (& $adb -s $s shell pidof com.kosmos.client).Trim()
"same app process throughout: $($pid0 -eq $pid1)"
& $adb -s $s logcat -d -v threadtime > E:\wt\l5-audit-logcat.txt
Select-String -Path E:\wt\l5-audit-logcat.txt -SimpleMatch -Pattern 'QZXV7731'
# Every UE log file on the headset, the current one and every rotated -backup-<time>.log:
$logs = '/sdcard/Android/data/com.kosmos.client/files/UnrealGame/KosmosClient/KosmosClient/Saved/Logs'
& $adb -s $s shell "ls -l $logs/"
& $adb -s $s shell "grep -c QZXV7731 $logs/*.log"
# The positive control: the capture covers the typing (Kosmos lines from those minutes exist).
(Select-String -Path E:\wt\l5-audit-logcat.txt -Pattern " $pid1 ").Count
Select-String -Path E:\wt\l5-audit-logcat.txt -Pattern 'KTextInput|KDomUI|KActivation'
```

**Pass:** "same app process throughout: True" (no restart, so no log was rotated away mid-test); `Select-String ... QZXV7731` prints nothing; the `grep -c` prints `0` for **every** log file it lists (the current `KosmosClient.log` and any `KosmosClient-backup-*.log`); and the positive control counts lines from the Kosmos process (non-zero), so the capture was live while typing. If the process changed, the test is void: run it again. The text-input lines themselves may not appear at this build's log verbosity (#213 found none on Build 1013); if any do, they name a request id and a byte count, never the text. The Audit card's own "received N bytes" shows the typing reached the world. A line from another process (the Quest's own keyboard, for example) is recorded with its process name and reported; it is not Kosmos's, but it is worth knowing. Telemetry and the group wire are not visible from the headset log: the client's `Kosmos.TextInput.NeverLogged` test covers the log, and the text-input code has no telemetry or sync call (KWorldTextInput.h's privacy rule).

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

The bundle to publish is `release/type-test-1.1.0.worldbundle` (the bundler is not byte-reproducible, so the reviewed bytes are kept). The commands are in the PR. 1.1.0 replaces 1.0.0 at the same address. As for 1.0.0, publishing a level-5 test world before the `deployed` bump is the CEO's call (the runbook's section 6.5 warning).

## Destroy (after the CEO's checks pass)

The CEO asked for the world to be destroyed once it works. `kosmos-wp` delete is a **purge** (KOS-573) and is the CEO's call to run; a soft takedown is `--status removed` through the registry.
