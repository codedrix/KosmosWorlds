# More Room — design v1 (working title)

> **Status:** proposal plus a v1 build that passes its tests. Not ratified and not published.
> - Publishing is Class C, and the steps are in [PUBLISH.md](PUBLISH.md).
> - The v2 platform ask is in [PLATFORM_ASK_v2.md](PLATFORM_ASK_v2.md).
>
> **Written:** 2026-10-14, by the More Room session (a side session of "Server-connected Kosmos worlds"). It pairs with Mission Control, which builds the bridge this room reuses.

**Addresses (proposed):**
- `world://more-room.micknerks` for VR, on a plain grid;
- `world://more-room-mr.micknerks` for MR, in your real room.

Both slugs:
- pass `WORLD_ID_REGEX` (`^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$`);
- are not on `RESERVED_WORLD_SLUGS`;
- answered `{"found":false}` at the registry on 2026-10-14.

The `-mr` suffix is only a name: modality endings are rejected as identity (DB-004), and `stream-check-mr.micknerks` is the precedent. The name echoes the unratified line "Give possibility more room".

---

## 1. The idea in one paragraph

A phone puts your calendar, mail, tasks, weather and the news through one rectangle, one at a time, each pushing the last aside. More Room gives each of them a place around you:
- the day runs along a strip on the wall in front of you, with a glowing line at *now*;
- messages lie face-down on the desk until you turn them over;
- tasks stand on your right;
- a window on your left shows the weather, the sunset and one headline;
- muted things go to a quiet shelf behind you.

**The rule of the room: everything has a place, and nothing jumps in front of you; it lands where it lives.** A new message slides out of the inbox tray into its slot on the desk. It never pops up in your face. Only a VIP makes a sound: one tick, from the tray.

It is the working answer to the brand question *"How much of your life are you trying to fit into a rectangle?"*

**It opens on a sample day, built in** (CEO, 2026-10-14: "show sample for now and make it a very elaborate setup and info").
- The world carries a whole invented day: 10 events with prep, 30 messages, and 16 tasks across To do, Doing and Done.
- So it is full the moment it loads, with no PC, no bridge and no sign-in.
- A banner on every mode reads **"SAMPLE DAY: nothing here is real yet"**.
- In the sample, every press works in the room itself and sends nothing; the status line says so ("Sent (sample: nothing left the room)").
- **Sign in** switches the room to the bridge.
- **About** opens a short paged panel: what the room is, that the day is a sample, the modes and piles, how the real one connects, the visitor's steps, and what is coming.
- The sample's source is the bridge face's `sample-day.ts`. `tools/gen_sample.mjs` bakes it into `script/src/sample_day.txt`, so the world and the bridge show the same day.

## 2. The room

Distances are from where you stand when the world loads, facing forward (+X), with +Z on your right. VR and MR share every scripted position; the script is one file for both.

| Where | What | Height |
|---|---|---|
| 0.42–1.12 m ahead | **The desk.** The message grid (12 slots); the **inbox tray** at the back left, where up to 3 messages that have no slot yet wait in a stack (unread VIPs first, then the newest; it is pressed from the top); the **Later** pile at the front left and the **Done** pile at the front right | top 0.74 m |
| 1.04 m ahead, raised | **The action row** (triage): Done, Later, Reply, Task, Mute | 0.90 m |
| 1.1 m ahead, above the action row | **The open card**: from, subject, preview | 1.04–1.38 m |
| 1.3 m ahead, 1.3 m left | **The mode column**: Sign in at the top (until signed in), then About, then Morning, Focus, Triage and Wrap-up | 0.98–1.86 m |
| 1.9 m ahead | **The About panel** (when open): one short page, with Next to its right | 1.25–1.6 m |
| 2.6 m ahead | **The banner**: "SAMPLE DAY: nothing here is real yet", between the stage and the calendar | 1.8 m |
| 1.2 m ahead, 1.25 m right | **The side table**: a draft waiting for Approve or Deny | 0.95–1.45 m |
| 1.8 m ahead, 2.0 m right | **Pinned tasks** (three tiles) | 1.1–1.7 m |
| 2.4 m ahead | **The stage**: the brief, the focus task and its timer, a prep sheet, the wrap-up | 1.0–1.7 m |
| 3.0 m ahead | **The calendar strip**, 7:00 to 19:00 across 4.2 m, with the glowing **now line** | 2.0–2.55 m |
| 1.6 m ahead, 2.4 m left | **The window**: a pane that turns from day to dusk to night against the bridge's sunset time, with weather, sunset and one headline under it; the status line sits beneath that | 0.7–1.9 m |
| 1.7 m behind | **The quiet shelf**: muted messages | 1.0 m |

**VR** (`more-room`):
- a dark grid floor 12 × 12 m, a desk and a side table;
- sky `night`, because world text is always white and needs a dark field.

**MR** (`more-room-mr`):
- `presentation.mode: immersive-ar`, `blend: alpha-blend`, sky `void`;
- no floor, no desk, only a dark translucent mat where the cards lie;
- dark plates behind each text group (section 6, finding 6).

The cards float at fixed spots relative to where you stand when the world loads. MR worlds register the room to the world once, in the travel fade (D-062). No room data is read (section 8).

## 3. The four modes

One button each, on the mode column. The current mode reads `[Triage]`.

Renders: [renders/](renders/), as `vr-<mode>-<view>.jpg` and `mr-<mode>-<view>.jpg`. The views are eye height, the desk, and an overview. Signed out, the room shows only a Sign in button at eye height in front of the stage, with its messages on the stage (`*-signin-eye.jpg`).

### Morning brief
- **The stage:** Claude's brief, up to four lines ("3 things need you today: …"), and under it the message count ("7 messages, 1 from VIPs").
- **The task tiles:** the three pinned tasks.
- **The calendar:** every event labelled, at alternating heights so neighbours never overlap.
- **Press a task** to focus on it. **Press a card** to jump to triage with that card turned over.

### Focus
- **The stage:** one task, large ("Focus on: Approve counsel reply"), and a 25-minute timer under it, with Start and Pause.
- **Everything else is dimmed:** translucent veils fall over the calendar, the window, the tasks and the desk. Event labels hide; only the next event shows ("Next: 10:30 Counsel call").
- **The desk does not answer in focus:** the veil sits over it, and the laser check in `tools/mock-host.mjs` proves a press on a card is blocked.
- **Messages keep landing**, face-down and **silent**, in their slots.
- **A VIP ticks once, from the tray**, and a line reads "VIP: Counsel (sample)" for 90 seconds. Nothing moves toward you.

### Triage
- **Press a card to turn it over.** It shows its read face, and the open card floats above the action row (from, subject, a two-line preview).
- **Done** archives it to the Done pile.
- **Later** snoozes it to the Later pile.
- **Mute** sends it to the quiet shelf behind you.
- **Task** ("Make a task") creates a Linear ticket from it, and the status line names the ticket.
- **Reply** ("Claude drafts reply"): the bridge asks Claude for a draft, which appears on the side table as "Draft to …" in pages of three lines (More 1/3).
  - **Approve** hands it to the bridge, which sends it through Mission Control's approval path.
  - **Deny** discards it.
  - **Nothing is sent without that press.** The test asserts that no approval reaches the bridge before it.

### Wrap-up
- **The stage:** "Done: 2 tasks, 2 messages", the two latest done tasks, and "Press a task to roll it".
- **The task tiles:** every open task, as "Roll: …". A press rolls it to tomorrow.
- **Under the stage:** "First tomorrow: Send the tester invites at 9".

### About this room
- **The About button** (top of the mode column) opens seven short pages, at 1.9 m, while everything else on the walls clears. The banner stays.
  1. What the room is: the rectangle question, and a place for each part of the day.
  2. Sample day: nothing here is real yet.
  3. The four modes.
  4. The piles and actions.
  5. How the real room connects: your own bridge on your PC, with your Gmail, calendar and Linear; Kosmos never sees your mail.
  6. Your steps: connect your accounts on your PC, and tell us your phone (iPhone texts can't be read).
  7. What is coming: pinning the cards to your real wall, which needs the room permission sheet first.
- **Next** pages through them, and **Close about** returns.
- A test asserts that every page fits whole: 4 lines of 30 characters, no cut.

### Always there
- **The calendar's prep:** press any event (outside focus) and the stage shows its prep sheet, which Claude gathers: attendees, agenda, related mail and tickets. A Close button returns.
- **The window:** weather, sunset and one headline.
- **The quiet shelf:** "Quiet shelf: 1" and the senders' names.
- **The status line:** "Live. Updated 3 s ago", or a plain error. The errors are "Wrong passphrase", "The bridge did not answer. Is the PC awake?", "Network is off for this world" and "Signed out by the bridge. Sign in again."

## 4. Budgets, measured

Every number below was measured by running the built `world.wasm`:
- in `tools/mock-host.mjs`, a model of the client's limits at cook `C-20261013-ecad7c5` (sources are in that file's header);
- against the mock bridge;
- on the source GLBs **and** on the optimized scenes inside the built bundles (`--packaged`).

| Budget | Limit (source) | Sample day | Heavy day (`tools/stress.mjs`) |
|---|---|---|---|
| World texts at once | 32 (`KWasm::MAX_WORLD_TEXT`) | peak 28 | busiest screen (triage, open card, draft, prep): 28 |
| Bytes per text / lines | 128 / 4, refused not cut | every text built by `text::Lines`; 0 refusals | 0 refusals |
| Created objects | 128 (`MAX_CREATED_NODES`) | peak 30 | peak 39 (30 cards drawn + 8 events) |
| Creates per frame | 16 (`MAX_NODE_CREATES_PER_FRAME`) | at most 12 (the script's own cap; the rest wait a frame) | at most 12 |
| Request body | 16 KiB | largest 84 B | — |
| Answer | 256 KiB, text or JSON only | largest 4.7 KB (the whole sample day) | 7.7 KB for 40 messages |
| Requests | 4 in flight, 1 a second with bursts of 10 | 19 polls in 49 s plus presses; never rate-limited | — |
| Wasm | 256 KB | 80.1 KB (6.4 KB of it is the built-in sample) | — |
| Triangles | 1,000,000 | 504 (doctor) | — |

**What the room draws when the day doesn't fit:**
- a full desk shows 12 cards, up to 3 more wait on the inbox tray, and the tray's label counts the rest ("+15 more" on the sample day);
- the calendar labels at most 5 events, around now (the one just past and the next ones); every tile stays pressable for its prep;
- the window's caption is hidden in Triage as well as Focus (desk work, and the text budget);
- each pile shows 5 cards and counts the rest;
- the shelf shows 6.

**Per mode, the most texts at once** (sample day):

| Mode | Texts |
|---|---|
| Signed out | 2 |
| Morning | about 20 |
| Focus | about 13 |
| Triage, with a draft | 26 |
| Wrap-up | about 20 |

**Test totals:**
- `tools/scenario.mjs`: 215 checks across both worlds, all passing. Part 1 runs the built-in sample with **no request at all**, the About panel included; part 2 signs in and runs the live day;
- `cargo test`: 16 host tests, including "the baked sample is a complete DAY/1 day" and "every About page fits whole";
- `kosmos-wp validate` at publisher main `fced9cf` (CLI 0.8.1, 83 rules) passes both worlds against level 4 (the registry's deployed level since 2026-10-12). The one warning is NET_007, "origin not checked (offline)";
- `kosmos-wp doctor`: VR 17 ✅, 0 ⚠️, 0 ❌; MR 16 ✅, 1 ⚠️, 0 ❌. The MR warning is head clearance under an hour tick on the calendar strip, which doesn't apply in MR, where the visitor doesn't move by stick (`MOVE_None`);
- the wasm passes `wasm-tools validate` with the device feature set.

**MR plates never block a press.** Every press in the scenario traces a ray from eye height to the button, and fails if anything visible is hit first.

## 5. The brain: a face on the shared agent bridge

More Room calls **one origin, the same one Mission Control uses**: the shared agent bridge on the CEO's PC (KosmosWorlds `agent-bridge/`, PR #5; its contract is `agent-bridge/API.md`; its brief is DB-044). The front door is Mission Control's relay Worker, `https://kosmos-agent-bridge.micknerks.workers.dev`.
- **It answers the opt-in file and `/privacy` itself**, so they stay up while the PC sleeps. The registry drops an origin whose weekly check and its confirm 1–24 h later both fail, which would take the room offline for up to a week.
- **It relays `POST /v1/*` through the tunnel to the PC**, adding a relay secret.
- **One front door, one secret, one kill switch.** More Room deploys no Worker of its own.
- On the bridge, Claude, with the CEO's mail, calendar and Linear connectors, does the reading, summarizing, drafting and ticket-making.

More Room is a **face** on that bridge: the folder [agent-bridge/src/faces/more-room/](../agent-bridge/src/faces/more-room/).
- The bridge's registry finds it by folder. It adds no file of Mission Control's and edits none.
- The server does the size, rate, relay-key, kill-switch, `X-World-Address` and token checks before the face runs.
- The face's logic is [day-core.ts](../agent-bridge/src/faces/more-room/day-core.ts). The same file runs in the real bridge and, through Node's type stripping, in More Room's own tests ([bridge-day-face/mock-bridge.mjs](bridge-day-face/mock-bridge.mjs)).

| Route (all `POST`, JSON body; the headset adds `X-World-Address`) | Body | Answer (text, one record per line, TAB fields: `DAY/1`) |
|---|---|---|
| `/v1/faces/more-room/signin` | `{"pass"}` | `TOKEN <token> <seconds>` from the bridge's **one session** (`ctx.signIn`); or `NO <reason> <retry s>`: 401 `wrong` or `not_set`, 429 `too_fast` (one try every 2 s), `locked` (15 min after 5 wrong) or `hard_locked` |
| `/v1/faces/more-room/changes` | `{"tok","since":N}` | `DAY/1 rev M`, then either `SAME` or the whole day (`NOW`, `DATE`, `BRIEF`, `EV`, `TASK`, `MSG`, `DRAFT`, `WIN`, `WRAP`), then `END`; 401 `AUTH` when the session has ended |
| `/v1/faces/more-room/act` | `{"tok","op","id"}` with op `turn`, `done`, `later`, `quiet`, `draft`, `approve`, `deny`, `task`, `complete`, `roll` or `pin` | `OK <rev> <note>` (e.g. "KOS-MOCK-1 created (mock)") |
| `/v1/faces/more-room/prep` | `{"tok","event"}` | `PREP <id>`, then up to four `P` lines, then `END` |
| `GET /.well-known/world-network.json` (the relay) | — | every face's worlds: Mission Control's, `world://more-room.micknerks` and `world://more-room-mr.micknerks` |

**Why the wire looks like this.** Each choice is forced by a headset fact.
- **The token (`tok`) travels in the JSON body.** A world can send no Authorization header and no cookie, and a token in a URL ends up in logs.
- **Plain text, one record per line.** The world is no_std Rust: a line reader is a few dozen lines, where JSON is a few hundred.
- **"What changed since N" answers the whole day** whenever anything changed, and `SAME` otherwise. A day is about 3 KiB, so a missed poll can never leave the room out of step.
- **The room polls every 4 seconds.** That also keeps the bridge session's 30-minute idle timer alive. The session's 8-hour limit ends with "Signed out by the bridge. Sign in again."
- **The bridge sends ASCII only, clipped to the field caps.** The world clips again.

**One sign-in at a time, for the whole bridge.** Signing in to More Room is signing in to the bridge. If the CEO then signs in from the Lobby (Mission Control), More Room's token stops working, and the room says "Signed out by the bridge"; the same holds the other way round. That is the bridge's rule, and More Room follows it.

**Approve and Deny.** These are the CEO's press in the room.
- A draft that is a **bridge Approval** is decided through `ctx.bridge.actions.decide`, which is Mission Control's path, log and sender. A test asserts this.
- If the bridge refuses ("approve this one at the desk", or already answered), the draft stays pending.
- A sample draft is only marked "sent (mock)". Nothing is sent from the face.

**Built against a mock "sample day" only.** [sample-day.ts](../agent-bridge/src/faces/more-room/sample-day.ts) is invented: every person, company and message in it is fake. `node --experimental-strip-types more-room/bridge-day-face/server.mjs --dev` serves it on `http://127.0.0.1:8787`. **Connecting the CEO's real accounts is his act (Class C).**

**What comes next on the bridge** (verbs to propose for `bridge.ts`, the one shared file, per API.md §4):
1. **"Today"**: today's calendar with each event's prep (attendees, agenda, related mail and tickets), the inbox summary (sender, subject, a short preview, a VIP flag), pinned and open Linear tasks, the weather, the sunset and one headline. These fill the face's store in place of the sample.
2. **"Draft a reply to message X"**: a Claude job whose send step becomes a bridge **Approval**. Its id goes on the draft, so Approve is `actions.decide`.
3. **Message moves:** archive, snooze, mute (labels), and "make a Linear ticket from message X".

**Tested on the real bridge.** In a throwaway copy of Mission Control's branch with this face folder dropped in, `tsc` was clean and the bridge's whole suite passed: 52 of 52, including More Room's 10 in `agent-bridge/test/more-room-face.test.ts`. Those 10 cover:
- the registry finds the face, and the opt-in file lists both worlds;
- another world's address is refused, and nothing is served before sign-in;
- wrong-then-right sign-in through the shared session, whose token also works on `/v1/jobs`;
- the day is served to both worlds;
- turn, draft and approve;
- the dev-only op is absent;
- sign-out ends the room;
- a bridge Approval goes through `decide`.

## 6. Headset facts that shaped the design

Each was found reading the client at the cooked commit, or in the lit review of this design.

1. **No `player_read` beside `network` (NET_005).** The room never knows where your head or hands are. Everything sits at fixed spots around the spawn, and nothing can follow your gaze.
2. **World text is white, 8 cm, at most 32 at once, 128 bytes and 4 lines each.** It turns to face you only about the vertical axis, and it is depth-tested.
   - Every text is built by one layout routine with a width in characters, so nothing is ever cut by the host.
   - Lines are at most 30 characters at 2.4 m, and 14 to 22 in crowded places.
   - Nothing solid sits within 0.5 m behind a text anchor.
3. **Desk-level labels are hard to read, and the signed-out room was blank at eye height** (both found in the lit review). From 1.62 m, a label on the desk is seen 50–60° from above. Because text turns only about the vertical, it is foreshortened and its own button clips it.
   - So the mode buttons moved off the desk, to a column at chest height on the left.
   - The action row rose 15 cm.
   - The low labels lifted.
   - Sign in sits at the top of the mode column. A second review (2026-10-19) moved it there from the column's bottom, where its label ran into the inbox count. The About plate in MR was widened to frame its Next button.
4. **`k_node_find` sees only meshes, and names lose a trailing `_<digits>`.** Every text anchor is a 1 cm mesh with an extra, and no name ends in a digit. Clone names are letters only (`MrCaaaab`).
5. **The publisher's optimizer can eat script nodes.** The scenario was run again on the optimized scene inside each bundle, and every script node survived.
6. **In MR, white text on a light real wall is unreadable** (found in the lit review). So MR has dark translucent **plates** behind each text group.
   - Each plate sits 0.5 m beyond its text on the line from the spawn, faces the spawn, and shows only while its text shows.
   - Each plate is centred on the middle of its text. The first version centred plates on the text anchor, which is the text's bottom edge, and the top line spilled onto the wall.
   - The desk mat is dark for the same reason: it is what you see behind a desk label when you look down.
   - Passthrough is drawn under every virtual pixel, so a real monitor never hides the room's text. It does make the middle of the desk busy, which only a headset check can judge.
7. **The sign-in sheet is plain, unmasked text** (`k_ui_prompt`: "never a password field").
   - The passphrase shows while you type it.
   - The sheet's footer says the text goes to this world, and the room sends it once, to the face's `signin` op only (a test asserts this), then wipes its buffers.
   - The token lives in memory for the visit only, never in `k_state_*` (that state syncs to groups).
   - A masked field arrives with R5's `k_ui_text_*` at the level of the cook that carries them. Until then, see section 11's alternative.
8. **A clone keeps its source's visibility and collision**, so the hidden templates' clones are shown on creation.
   - Presses on clones dispatch through the handle registry. This is **inferred from source, not yet seen on a headset**, and it is on the device check list.
   - Every clone's `OnInteract` subscription is released when it is destroyed. Subscriptions are a capped pool (256).
9. **Rotations are relative and in raw engine degrees**, so the room never rotates a clone. A card "turns over" by swapping its face: the face-down tile is destroyed and a read-face tile is cloned in its place.
10. **Text plaques** (from Mission Control, client `ecad7c5`, `KWorldTextPool.cpp`): text on an anchor that is a thin plane (3 cm x 3 cm x 2 mm, rotation not baked) is printed flat and never turned. That could put the desk labels flat on the desk, readable from above. It is not used in v1: the layout avoids desk-level text instead.

## 7. Message sources

| Source | Can the bridge read it? | How | Cost and caveat |
|---|---|---|---|
| **Email (Gmail)** | **Yes** | Claude's Gmail connector on the bridge: read, label, draft; send only after Approve | The connector is configured by the CEO (Class C). Attachments and images never reach the room: answers are text only, up to 256 KiB |
| **Calendar** | **Yes** | Claude's Google Calendar connector | The same |
| **Linear** | **Yes** | Claude's Linear connector: read, and create tickets ("Make a task") | The same |
| **Slack** | **Yes**, through its API | A Slack app with user-token scopes (`channels:history`, `im:history`, `search:read`), or Claude's Slack connector | Workspace admins can see installed apps; DMs need user-token scopes |
| **GitHub notifications** | **Yes** | `GET /notifications` with a fine-grained token | Low risk; read-only |
| **Discord** | **Partly** | A bot reads the servers it is added to (the Message Content intent) | **Your own DMs can't be read**: reading a user account through automation (a "self-bot") breaks Discord's terms |
| **Telegram** | **Yes, two ways** | (a) the Bot API: only chats with the bot; (b) the user API (TDLib or MTProto, with your own `api_id`): all your chats | (b) puts a full logged-in session of your account on the PC; treat its key like a password |
| **iPhone texts (iMessage, SMS)** | **No** | Apple offers no API, so no server can read them | Two unsupported paths exist, and neither is recommended: (1) a **Mac** signed into Messages keeps a local database a program can read with Full Disk Access (it breaks with macOS updates, and Apple doesn't support it); (2) Windows **Phone Link** mirrors iPhone notifications over Bluetooth, with no API and no history |
| **Android texts and notifications** | **Only with a companion app** | A small app with notification access (`NotificationListenerService`) forwards notifications to the bridge over HTTPS | **The privacy cost:** it sees *every* notification from *every* app (one-time codes, bank alerts, other people's words), so it has to filter on the phone (an allowlist of apps; never forward codes), and it is sideloaded (Google Play restricts notification-access apps). Replies can't be sent this way, and history only starts when the app is installed |
| **Kosmos friend messages** | **Never** | — | They travel headset to headset (the Together row, D-134). Worlds never see a message or a keystroke, and More Room doesn't try |

**Which phone the CEO has isn't recorded anywhere this session could read.** If it is an iPhone, texts stay out of More Room, unless he keeps a Mac signed in and accepts the unsupported path. If it is Android, the companion app is a small separate build, with the cost stated above.

## 8. Pinning things to the real wall (MR)

**v1, built: fixed spots, no room data.**
- `more-room-mr` declares no `scene_query` and no `spatial_anchor`. The deployed registry refuses either beside `network` (NET_006) until the CEO turns on `registry_settings.room_network_origins` (the Spatial-privacy-model row as corrected 2026-10-13).
- So the cards float at fixed spots measured from where you stand when the world loads. To put the strip on your wall, stand about 3 m from it, facing it, when you open the world.

**v2, real pinning, needs platform work, and is not built.** [PLATFORM_ASK_v2.md](PLATFORM_ASK_v2.md) sets out two routes and their order.
- **A:** R3's room permission plus DB-041's anchors plus a small label for each saved pin.
- **B, recommended:** "blind pins". The headset places and remembers each pin, and the world only says "pin this card", never learning where. The CEO's requirement that pin spots never reach a server is then enforced by the platform, not promised by the world.

## 9. What is verified, and what is not

**Verified here:**
- the 215-check scenario on both worlds (the built-in sample with no request, then the live day);
- the face on the real bridge server (52 of 52 bridge tests, More Room's 10 among them);
- the heavy day;
- the packaged scenes;
- the host tests;
- `validate`, `bundle` and `doctor` at publisher main;
- the lit renders of every mode in VR and MR.

**Not verified here** (all of these are the device checkpoint's):
- anything on a headset;
- the real tunnel and the relay Worker (not deployed when this was written);
- TLS;
- the registry's opt-in probe;
- the real font;
- the night sky and pawn lights (the renders use a lit review rig);
- passthrough (the MR renders composite a modelled stand-in room, not the CEO's room).

**Device check list (one sitting, on Build 1009 or later at level ≥ 4):**
1. Open each world: it is full at once on the sample day, with the banner. Press Sign in: the system sheet names the world (its address and author), and the room's own prompt text says the passphrase goes to your bridge. A wrong passphrase says so, and the right one switches to the bridge's day.
2. About: all seven pages are readable from where you stand, and Next and Close about work.
3. The text is readable at eye height in VR and in MR (plates against a real wall). Is the open card readable over a real monitor? Do translucent plates and mats draw correctly over passthrough on the headset (mobile alpha)? Do the 1 cm text-anchor studs show as specks on a real wall? Is the inbox count on the desk readable in MR (it has no plate: one there would block the mode column)?
4. Presses on clones (cards, events, the top card of the inbox tray) work. If they don't, the fallback is authored card slots instead of clones.
5. Turn over, Done, Later, Mute, Task, Reply → Approve: each lands where it lives (in the sample, nothing is sent; signed in, Approve reaches Mission Control's approval log).
6. Focus: a VIP arriving ticks once from the tray; a normal message is silent.
7. Put the headset to sleep and wake it, then turn off the PC: the status says "The bridge did not answer. Is the PC awake?", and nothing crashes.
8. Frame time with the full room visible stays within 13.8 ms. The room is about 600 triangles and about 60 objects, so it is expected to be fine.

## 10. Publishing

The steps, in order, are in [PUBLISH.md](PUBLISH.md). In short:
- Mission Control's relay Worker is deployed with both More Room worlds in its `WORLDS` var;
- the bridge runs with this face folder (PR #4 on top of PR #5);
- then `kosmos-wp publish --status unlisted` for both worlds, signed in as micknerks.

**Access:** the brief asks for a "private" world.
- The headset opens a private world for its signed-in owner (KOS-803).
- But private bundles need DB-023's private-bucket steps first, which are the CEO's, and the 2026-09-29 ledger records `PRIVATE_BUNDLES` unbound.
- So the default here is **open + unlisted**. The bundle holds nothing personal: the day lives behind the bridge's passphrase.
- Private is a one-command change once DB-023 is done.

## 11. Open questions

1. **Bridge verbs:** "today", "draft a reply" and the message moves (section 5), to propose for `bridge.ts`.
2. **Which phone?** (section 7).
3. **The passphrase on an unmasked sheet.** Accept it for v1, or use **pairing** instead? Pairing is the device-flow pattern Kosmos already uses: the room shows a short code, the CEO approves it on Mission Control on his PC or phone, and the room gets its token without anything secret being typed in the headset. It would be a bridge verb, shared with the Lobby.
4. **v2 route:** A (sooner) or B (better)? See [PLATFORM_ASK_v2.md](PLATFORM_ASK_v2.md).
5. **Name:** "More Room" is a working title.
