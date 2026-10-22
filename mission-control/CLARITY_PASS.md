# Mission Control clarity pass (Lobby 1.4.0)

The contract both lanes build to for the clarity pass. Owner: the lead (Mission Control session).

## Why

The CEO tested Lobby 1.3.0 on the headset on 2026-10-21/22 with the bridge live. Sign-in worked and
"It looked great", but, in his words:

1. "I wasn't sure what the watch stand was for. There's a watch right beside the throne, and it asked
   me for a pen. I wasn't sure what the pen was." (the Watch post and its code)
2. "The 'use pass key' came up, and then it also gave me the number to type in ... I didn't know where
   to type it on the desktop." (the Pairing Seal's code beside the passphrase option)
3. "We are going to have to work on the user interface of the dashboard overall because I couldn't
   necessarily figure out what was supposed to do what."

His approval: "go ahead and send the dashboard clarity pass to the mission control session."

## Rules

- **A clarity pass, not a redesign.** The look, the layout, the colours and the art pass stay. Change
  words, labels and, where a label needs room, a plate's size.
- **No node changes.** `mission-control/nodes.json` stays byte-identical: no node added, removed or
  renamed. At most 32 world texts show at once (today the arc state shows 29).
- **No wire change.** The AB1 records and the request fields stay as they are. A 1.3.0 world with the
  new bridge, and the new world with the old bridge (the CEO's PC runs `cee4f69` until he updates),
  must both work; only the words differ.
- **Text limits:** world text is white 8 cm Roboto, at most 128 bytes a slot, clipped to each
  anchor's width in `layout.ts` `W`. Button words are mesh text in `build_panel.py` (free, no slot).
- **Plain words:** say what a control does, in the visitor's words. No jargon ("snapshot", "face",
  "token"), and never a word that reads as "PIN" or "pen": say "code".

## A. The Watch post (world lane)

- The plaque says what it is from where the CEO stands: two lines, **"GROUP WATCH"** and **"for a
  second headset"**. Enlarge the plate to fit, readable from the throne (about 1.5 m).
- `WATCH_QUESTION` (`src/lib.rs`), the typing sheet's question: **"Group watch code (6 digits). The
  person on the throne gets it by pressing Share with group."**
- The owner's press on it keeps its local message; make it plain: "This post is for a second
  headset. To let someone watch, press Share with group on your panels."

## B. Signing in at the seal (both lanes)

Decision (the lead's): **keep both ways, each saying where it is done.**
- The ring's code is the **PC way**. `TxSealHint` (bridge) says exactly where: line 1 **"Sign in
  from your PC: type this code in"**, line 2 **"the bridge window (where npm start runs)."** Keep
  "It lasts 2 minutes" only if it fits; the expiry message already explains a lapsed code.
- The passphrase is the **headset way**. `BtnSealType`'s mesh words become **"Or type passphrase
  here"**, wider so the words fit; it stays hidden when `passphraseSignIn` is off.
- `McSealCancel` stays "Cancel".
- The typing sheet's question (`SEAL_QUESTION` in `lib.rs` and `PASSPHRASE_QUESTION` in the face,
  which must stay equal): **"Mission Control passphrase (shows as you type)"**.

Why not show the code only when the passphrase is off: pairing is the way that keeps the passphrase
out of the headset, so hiding it whenever the passphrase is on would retire it in practice. The
confusion was not knowing where the code goes, so the fix is to say where.

## C. The dashboard (both lanes)

Every control says what it does, and a visitor arriving cold sees one obvious first step.

**Mesh words (world lane, `build_panel.py`):**

| Today | Becomes |
|---|---|
| FOLD | Hide to ledge |
| STOP | Stop this job |
| page arrows (BtnPageUp / BtnPageDown) | Older / Newer |
| CHANGE PROJECT | Change project |
| Near / Far | Closer / Farther |
| the move cluster (< ^ v > Closer Farther) | add a static word before it: "Move panels" |
| Group watch | Share with group |
| CubePlus (a "+" mark only) | add the words "New job" under the mark |
| CLOSE (the ledge) | Close + sign out |
| BROWSER SPOT (heading) | Web page (coming soon) |

APPROVE, DENY, ASK WHY, Keep going, Explain simply, Stop + summarize, Reply..., the four presets,
"+ New task" and "Sign out" keep their words unless a reviewer finds one unclear. Every new word must
fit its plate with margin. Widen the plate where needed and keep the arc's overall widths.

**Bridge words (bridge lane, `faces/mission-control/index.ts`):**

- **The first step.** Signed in with no jobs: `TxHeader` reads **"Start here"** / **"Pick a task
  below, or press + New task."**, the rail's first slot says **"No jobs yet"**, and the ticker stays
  plain. The current "No job open" header stays for "jobs exist but none is open", reworded **"No job
  open"** / **"Pick a job on the left, or start one below."**
- **The status line:** `N/M jobs running  |  emergency stop: npm run kill on your PC`, clipped to
  `W.status`. If it doesn't fit, use "stop all: npm run kill (PC)".
- **`TxWatch`** (beside Share with group): when off, **"Not shared"**; when on, **"Code 123 456: they
  type it at the Watch post"** (the code grouped 3 + 3).
- **The page spot:** `TxPageSpot` reads **"A web page you pin will show here."** (one line, `W.pageSpot`).
- Re-read every note and refusal in the face (`note(...)`, the `why` maps) for plain words, with the
  same meaning. Keep every refusal's meaning and event name.

## D. Renders (world lane)

- Lit renders at seated eye height on the throne, inside the live Lobby, from the real bridge
  snapshots: `seal_ring`, `arc` (a job open), a new **`arc_empty`** (signed in, no jobs: the cold
  arrival; the bridge lane adds its snapshot to `capture-review-snapshots.mjs`), `cubes_calm`,
  `puck_close`, `watcher`, and a new **`watch_post`** (standing in front of the post at 1.6 m eye
  height, and one from the throne showing it).
- **A side-by-side sheet, `review/clarity_sheet.jpg`:** for each view, the 1.3.0 render (main at
  `cee4f69`) on the left and the new one on the right, labelled "1.3.0" and "1.4.0".

## E. Package

Lobby **1.4.0**: `lobby-manifest.patch.json` version 1.4.0, built from the live 1.1.1 base exactly
as 1.3.0 was. Capabilities, the network block and host API level stay as in 1.3.0.

## F. Tests

Every suite stays green: the bridge `npm test`, the world host tests (byte-identical rebuild), the
mockhost run, the merge tests, the Blender build with its sightline audit and negative control, and
`validate --offline`. Tests that pin old strings are updated to the new ones, not deleted.
