# Mission Control v2: the contract (Job Cubes, the decision puck, the Pairing Seal)

DB-044 addendum (kosmos-project #210). CEO, 2026-10-19: "Take Job Cubes, the Pairing Seal and the
Day Ring forward." The Day Ring is More Room's. This contract covers Mission Control only.

**Hard limits:**
- Today's host API only: level 4 plus what the Lobby already imports. No new client functions.
- Live Lobby 1.2.0 is NOT republished from this work: the CEO sees renders first.

This file is the one contract between the bridge (`agent-bridge/`) and the world (`mission-control/`).
`nodes.json` (beside this file) is the node list. The bridge's `layout.ts` must reproduce it exactly
(`scripts/write-nodes-json.mjs`), and `src/lib.rs` must list the same names.

## 1. What the owner experiences

1. **Sign in: the Pairing Seal.**
   - Press the seal on the throne seat. A ring rises from it to eye height, about 1.1 m ahead
     (the nearest rung of the depth ladder), and shows a short code, e.g. `KXT WMP`.
   - At the PC, approve it in the bridge's console (type the code you see on the ring), or from
     any terminal with `npm run approve -- KXT-WMP`.
   - The ring locks: it turns amber, then shrinks away. The ledge of job cubes and the decision
     puck grow in.
   - Nothing secret is typed in the headset. A small "Use passphrase" button under the ring keeps
     the old typed passphrase as a fallback (config `passphraseSignIn`, default true).
2. **Job Cubes.**
   - A low ledge, about 1.0 m ahead and about 1.0 m above the feet, holds one small glass cube per
     running job (up to 4), plus a "+" cube for a new job.
   - A calm job glows blue, a job that needs you glows amber, an idle job glows dim. Each cube has a
     one-word label (the short project name).
3. **Unfold.**
   - Pressing a cube makes it rise and unfold into a three-panel arc: left = jobs, centre = that
     job's conversation, right = the browser spot (DB-043's dock, a placeholder now).
   - The centre panel is about 1.7 m away, centred about 5 degrees below eye height.
   - "Fold" on the centre panel reverses it into the cube. The animation runs every frame in
     `k_tick`.
4. **The decision puck.**
   - Fixed on the throne's LEFT armrest at hand height.
   - When any job needs you, it glows amber and shows the oldest pending approval as one short label
     and Approve / Deny, with the double buzz and the chime (as today).
   - Approve works without opening the arc, under the same rule as the wall: only if the whole
     command is visible.
5. **Watchers:**
   - see the arc only, turned to face the hall (as today's watcher copy), never the ledge, the puck
     or the seal;
   - never get a token, never send a press.

## 2. Geometry (the viewer frame, as `build_panel.py` uses it)

- **Frame.** Origin at the owner's feet; facing +X; +Y is the owner's LEFT; Z up; metres. Eye at
  (0, 0, 1.60). The builder turns everything 180 degrees and sets it at STAND (14.8, 0, 1.46) facing
  -X, exactly as today.
- **Centre panel** (active-job rung):
  - surface 1.70 m from the eye, azimuth 0;
  - centre height 1.45 (5 degrees below the eye); about 1.30 w x 1.30 h (z 0.80 to 2.10).
- **Side panels** (wall rung):
  - surfaces 1.80 m out, at azimuth +40 (left: jobs) and -40 (right: browser spot);
  - each faces the eye (flat facets, never curved); about 1.00 w x 1.20 h (z 0.85 to 2.05).
- **Ask plate** (decision rung): on the centre panel's lower part, 8 cm in front of the panel
  (1.62 m), holding TxAskA/TxAskB and Approve / Deny / Ask why.
- **Seal ring** (sign-in rung, nearest):
  - about 1.10 m ahead at eye height, about 0.50 m across, facing the eye;
  - TxSeal (the code) sits inside it, TxSealHint below it, and BtnSealType and McSealCancel below that.
- **Ledge:**
  - about 1.0 m ahead, top at about 1.0 m above the feet, about 1.6 m wide (within ±40 degrees);
  - 5 slots: CubeA..D, then CubePlus on the right end; about 12 cm cubes about 0.36 m apart;
  - TxCubeX label about 0.12 m above each cube, facing the eye.
- **Puck:**
  - on a short stem rising from the left armrest: viewer frame about (0.15, +0.95, 1.00);
  - Puck (body) with PuckCalm / PuckNeed glow variants, and BtnPuckApprove / BtnPuckDeny beside it;
  - TxPuck about 0.18 m above, facing the eye.
- **Text:** world text is 8 cm, white and flat on 3 cm x 3 cm x 2 mm plaques parallel to their
  panel, the plaque rotation kept on the node (today's rule). Nothing is head-locked.
- **Line widths** (`layout.ts` W, metres):
  - ticker 0.95, status 1.20, project 0.85, rail 0.85, done 0.90;
  - header 1.20, conv 1.20 (CONV_LEFT_M = -0.60), ask 1.10;
  - pageSpot 0.90, cube 0.34, puck 0.80, seal 0.45, sealHint 1.00.

## 3. Nodes (`nodes.json`)

- `text`: world-text anchors, at most 29 shown at once (the arc state); the host allows 32.
- `buttons`: pressable. A press on any of these is sent to the bridge. The exception is the world's
  own controls in `world`, which the world handles itself.
- `show`: nodes the face shows and hides with `U`.
- `hue`: base nodes the face colours with `H <node> <state>`. Each lists its states; each state
  is a pre-built variant node named `<base><State>` (for example `CubeANeed`), listed in `world`.
- `world`: nodes only the world touches. The face never names them.

Groups (the world decides them by name; the bridge needn't know):
- **seal:** SealRing*, TxSeal, TxSealHint, BtnSealType, McSealCancel;
- **ledge:** McLedge, Cube*, TxCube*;
- **puck:** Puck*, BtnPuck*, TxPuck;
- **arc:** every other panel node.
The fixtures McSeal and McWatchJoin are visible to every visitor and never move.

## 4. Wire additions (AB1, `agent-bridge/src/wire.ts`)

Snapshot records (bridge to world), added:
- `H <node> <state>`: paint `<node>` in `<state>` (`calm`, `need`, `idle`, `armed`, `locked`, `off`).
  The world maps it to variant visibility today, and to a material call when the visual pack ships
  (DB-045). This is the ONE place a colour is chosen.
- `I <id>`: a pairing id (32 lowercase hex). Keep it in memory and echo it as `pair <id>` while waiting.

Modes (`M`):
- `lock`: anonymous;
- `pair`: a pairing is waiting;
- `cubes`: signed in, arc folded;
- `arc`: signed in, arc open.

New events (`E`):
- `pair_wait`;
- `paired` (comes with `K`);
- `pair_expired`;
- `pair_refused` (rate-limited, kill switch, or pairing off);
- `passphrase_off`.

Request field (world to bridge), added: `pair <id>`.

Face ops (`POST /v1/faces/mission-control/<op>`):
- **`pair`** (new; anonymous):
  - with no `pair` field: mint a pairing and answer with `I`, the seal records and `E pair_wait`;
  - with `pair <id>`: a long poll, answered on change or after the usual long-poll wait. Pending:
    the seal records again. Approved: `K <token>`, `E paired`, `H SealRing locked`, then the full
    owner render (`M cubes`). Expired or unknown: `E pair_expired`.
- **`signin`:** unchanged, but refused with `E passphrase_off` when `passphraseSignIn` is false.
- **`view`, `press`, `watch`:** unchanged.

Face actions (press map):
- `cube:<jobId>` opens the arc on that job; `cube:none` opens the arc with no job (CubePlus).
- `fold` returns to `cubes`.
- `rail:<id>`, presets, `new`, `project`, `stop`, `approve`/`deny`/`why`, `quick`, `reply`,
  `pageup`/`pagedown`, `watch`, `signout` stay as today.
- BtnPuckApprove / BtnPuckDeny map to `approve:<id>` / `deny:<id>` for the oldest pending approval.
  Approve shows only when that approval passes the same "the whole command is visible" rule
  (`exact`, and it fits the puck label, W.puck).

## 5. The pairing verb (bridge, `src/pairing.ts`)

- **Code:** 6 characters from `BCDFGHJKLMNPQRSTVWXZ` (64 million codes), shown as `KXT WMP`. The id is
  16 random bytes in hex.
- **Lifetime:** 120 s. **Single use:** the first poll after approval takes the token, and the
  pairing is deleted.
- **Pending slots: see §8.9** (up to 16, keyed by id). Originally: a new mint replaced the pending one. A stranger can't hold a slot,
  and a replaced code can no longer be approved.
- **Mint rate:** at most 6 a minute across everyone, and at least 3 s apart; beyond that,
  `pair_refused`. The kill switch refuses minting and clears what is pending.
- **Approval is local only. No HTTP route approves.**
  1. When the bridge runs in a terminal (TTY), the bridge's own console prints "A headset asks to
     pair (N s ago). Type the code shown on YOUR ring to approve:". The console never prints the
     code: the owner must read it off his own ring, so a stranger's code is never approved by
     accident.
  2. `npm run approve -- <code>` writes `PAIR_APPROVE` (at most 32 bytes) into the bridge's home.
     The bridge reads it within a second (beside the STOP check) and deletes it.
  3. The typed code is normalised (letters only, upper case) and compared in constant time. Five
     wrong codes cancel the pending pairing.
- **Approval issues a normal session token** (same lifetime, one session at a time), whether or not
  the passphrase lockout is engaged. It starts with watching off, as every new sign-in does.
- **Logs:** the request log has no codes, no ids and no tokens. The console line carries no code.
- **Watchers:** they see nothing of pairing (the ring exists only on the requesting headset).
- **Passphrase fallback:** `config.passphraseSignIn` (default true). `false` refuses `signin` with
  `passphrase_off`, and the face hides BtnSealType.

## 6. World behaviour (`src/lib.rs`)

- **Closed:** zero network calls (unchanged).
  - McSeal mints a pairing (the first call), raises the seal group (0.6 s ease) and polls `pair` about
    every 1.1 s.
  - McSealCancel closes. BtnSealType opens the typing sheet (the fallback `signin`).
- **On `E paired` with `K`:** the ring shows `locked` for 0.6 s, the seal group shrinks away (0.35 s),
  then the ledge and the puck grow in (0.4 s). Mode becomes Owner, polling `view`.
- **`M cubes` to `M arc`:**
  - the arc unfolds from the pressed cube (or CubePlus, or the ledge centre): every arc node moves
    from that point to its place and scales from 0.02 to 1 (0.5 s, ease in-out);
  - arc texts appear only when the unfold ends;
  - the picked cube hides while the arc is open.
- **`M arc` to `M cubes`:** texts hide at once, then the arc folds back into the cube (0.4 s), then the
  arc nodes hide.
- **Visibility is two-layer:** a node shows when the snapshot wants it (`U`, `T` and `H` stored per
  node) AND its group is on for the current stage and mode. A tween can override the group for its
  duration. One function places text (`show`) and one chooses a state colour (`paint`). DB-045
  replaces the bodies of those two functions, nothing else.
- **Watcher:** arc group only, turned to face the hall (re-derive WATCH_PIVOT_X and WATCH_LOWER_M for
  the 1.7 m arc). No ledge, puck or seal.
- **Buzz and chime:** on a `Z` rise, owner only (unchanged).
- **Cost:** per-frame tweens touch only the nodes of the moving group. Count the host calls per
  tick in a host test and keep them under 200.

## 7. Renders owed (lit, inside the live Lobby scene, LOOKED AT)

1. `seal_ring.jpg`: the ring raised with a code.
2. `seal_locked.jpg`: the ring amber.
3. `cubes_calm.jpg`: the ledge with three calm cubes plus "+", and the puck calm.
4. `cubes_need.jpg`: one cube amber, the puck amber with its label and Approve / Deny.
5. `puck_close.jpg`: the puck seen at hand height.
6. `arc.jpg`: unfolded on a job.
7. `arc_unfolding.jpg`: mid-unfold, about 50%.
8. `watcher.jpg`: the watcher's view from the hall.

Snapshots come from the real bridge (`scripts/capture-review-snapshots.mjs`): `pair`, `paired`,
`cubes`, `cubes_need`, `arc`, `watch`.

## 8. Revision v2.1: the look-review of 2026-10-19 (angles, density, grouping)

The coordinator reviewed the renders against the CEO's bar ("modern, sleek"). The look itself waits
for DB-045. This revision fixes what today's API can fix.

1. **Side panels face the eye, flat.**
   - Azimuth ±36° (was ±40°), 1.80 m, about 0.85 m wide.
   - Each panel's normal points at the eye (0, 0, 1.60). Yaw only: **zero pitch and zero roll**.
   - Check: the centre's half-angle is 20.9° and a side's is 13.3°, so at 36° a side spans
     22.7°–49.3° and clears the centre.
2. **Fewer, larger rows.**
   - **The left panel holds jobs only:** TxTicker (two lines), then RailA–D as four tall rows (each about
     0.20 m, two-line text), then TxDone (one line) at the bottom.
   - **The "start a job" set moves into the centre panel:** BtnTests, BtnPrs, BtnToday, BtnNotes,
     BtnNewTask, BtnProject and TxProject. It shows ONLY when no job is open (after CubePlus). The face
     shows and hides it with `U` as today. While a job is open, the conversation uses that space.
   - **The right panel is the browser spot only:** frame, McPageDock and TxPageSpot.
3. **One slim chrome bar (the "ornament") under the centre panel:**
   - McMoveLeft/Up/Down/Right, McMoveCloser, McMoveFarther;
   - BtnWatch with TxWatch beside it, BtnSignOut, McClose.
   About 0.10 m tall, its top just under the centre panel's bottom edge, facing the eye. Nothing else
   lives there.
4. **The ledge moves closer and lower** so it never covers the bar from the throne: about 0.90 m out,
   top about 0.80 m above the feet. Seen from the eye, the cubes sit below the bar.
5. **The puck reads as one object:**
   - **The label:** TxPuck is ONE short line, `<project>: <verb> <command>` (e.g.
     `registry: run npm test`), on a small dark plate right above the puck, flat and facing the eye.
     If the whole command doesn't fit the line (W.puck), it reads `<project>: open its cube` and
     Approve is hidden. Deny stays.
   - **The buttons:** BtnPuckApprove and BtnPuckDeny become bigger tabs (about 0.22 × 0.10 m) beside the
     puck, facing the eye, words merged in.
6. **Renders.**
   - The eye renders use a headset-like field of view (about 90° horizontal), not a wide angle.
   - Add `arc_left.jpg` and `arc_right.jpg`, with the head turned to each side panel: that is how a side
     panel is read.
   - Keep `seal_ring.jpg` as it is (the review liked it).
7. **Leaving is always one press away** (correctness MED-1):
   - McClose lives on the LEDGE's left end, visible whenever the owner is signed in, whether folded or
     unfolded. The chrome bar has no Close.
   - Pressing the seal while signed in also closes (signs out, parks everything), so the seal toggles.
8. **Sign-out and a dropped session close cleanly** (correctness MED-2): on `E signed_out`, or `M lock`
   while the world holds a token, the world closes fully (Closed, everything parked, the ring down).
   It never shows a blank ring. The owner presses the seal to start again.
9. **Pairing slots** (security LOW-1, which replaces §5's "one pending at a time"):
   - Up to **16** pending pairings, each keyed by its id. The mint rate (6 a minute, 3 s apart) and
     the 120 s TTL allow at most 12 alive at once, so rate-limited minting can never evict a live
     pairing. Replacing the OLDEST stays only as a backstop for a full table. (First drafted as 4 slots;
     the bridge builder showed a stranger at the cap would evict the owner after about 12 s.)
   - **Residual risk:** a bot minting at the cap uses up the mint rate, so the owner's press can be
     refused (`pair_refused`). That is a nuisance, not a takeover; the passphrase fallback remains.
   - Approval by typed code matches whichever pending pairing has that code. The owner types the code
     on his own ring, so a stranger's pairing is never approved by accident.
   - Mint rate unchanged.
10. **Smaller fixes:**
    - The world ignores face-button presses while that button's group is tweening (security LOW-2).
    - The face's content key includes the oldest pending approval's id (security LOW-3).
    - A watcher is drawn no action buttons (Approve, Deny, Ask why, Stop, Fold, the quick replies,
      Reply).
    - Cube slots stay with their job while it lives (keyed by job id).
    - The fold goes back to the cube of the job on show, or the ledge centre if that cube is gone.
    - The page number doesn't jump when the ask plate appears.
    - A refused mint says what to do ("wait a few seconds and press the seal again").
    - The README and API.md are corrected (stale v1 lines; the validate line needs publisher ≥ 0.8.1).
