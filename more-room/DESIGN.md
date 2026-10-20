# More Room — design v2, the Day Ring (working title)

> **Status:** v2 (the Day Ring) on branch `feat/more-room-v2-ring`: built and tested, **not published**. The live worlds are v1 (1.0.0, published unlisted on 2026-10-19 from PR #4) and stay as they are until the CEO has seen v2's renders.
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

A phone puts your calendar, mail, tasks, weather and the news through one rectangle, one at a time, each pushing the last aside. More Room gives each of them a place around you.

**v2, the Day Ring** (CEO, 2026-10-19: "Take Job Cubes, the Pairing Seal and the Day Ring forward"; the day before, of v1: "I wouldn't demo more room. It looks so basic and clunky. How can we make this look more futuristic so that it also works better in 3D space?"). The look follows the published study "The Day Ring" (claude.ai/artifact/FQrnCbYquEjougBZED8hiy), built on what a world can draw today:
- **Your day is a ring of time around you**, 2.4 m out at eye height. **Now is always straight ahead**, at a glowing amber bar; the next hours wait to your right and the morning fades to your left. The whole ring turns as time passes, a little every frame.
- **Messages land, they don't pop.** A new message drops onto a low arc in front of you, face-down. A VIP's card has an amber rim and makes one soft tick.
- **Triage makes the cards rise** and fan out face-up at reading height, ready to sort.
- **Focus closes the room in** around one task and its timer; the next event is the only other thing you see.
- A window on your left shows the weather, the sunset and one headline; muted things go to a quiet shelf behind you.

**The rule of the room: everything has a place, and nothing jumps in front of you; it lands where it lives.**

It is the working answer to the brand question *"How much of your life are you trying to fit into a rectangle?"*

**It opens on a sample day, built in** (CEO, 2026-10-14: "show sample for now and make it a very elaborate setup and info").
- The world carries a whole invented day: 10 events with prep, 30 messages, and 16 tasks across To do, Doing and Done.
- So it is full the moment it loads, with no PC, no bridge and no sign-in.
- A banner on every mode reads **"SAMPLE DAY: nothing here is real yet"**. It sits inside the focus cocoon, so it shows in Focus too.
- In the sample, every press works in the room itself and sends nothing; the status line says so ("Sent (sample: nothing left the room)").
- **Owner sign in** switches the room to the bridge (section 5: sign-in is the owner's, and wrong guesses stop at 4 a day).
- **About** opens seven short pages on the stage.
- The sample's source is the bridge face's `sample-day.ts`. `tools/gen_sample.mjs` bakes it into `script/src/sample_day.txt`, so the world and the bridge show the same day.

## 2. The room

Distances are from where you stand when the world loads, facing forward (+X), with +Z on your right; an angle is measured from straight ahead, + to the right. VR and MR share every scripted position; the script is one file for both. Positions are in `tools/build_glb.mjs` (`LAYOUT`) and mirrored in `script/src/layout.rs`; the scenario checks the two agree.

| Where | What | Height |
|---|---|---|
| 2.4 m, all round | **The Day Ring**: a thin segmented cyan light ring with tick marks, over a dark glass band; **events as dark glass pills** with a light ring at top and bottom (past: dim; now: amber; later: cyan), each labelled with its time and title on one of two rows; hour ticks (every third one longer); the amber **now bar** straight ahead. Pills more than 100° round are hidden; 19:00 is behind you at 10:00 | 1.78 m |
| 1.8 m ahead | **The banner**, under the now bar: the sample line, and for 90 s after a VIP lands a second line naming them (the room's one notice band). In triage it moves up, just above the fan | 1.46–1.65 m (triage 1.62–1.80 m) |
| 1.7 m ahead | **The stage**, a dark glass panel: the brief, a prep sheet, the wrap-up, the About pages. Close (prep) and Next (About) are a capsule to its right, clear of it | 0.98–1.42 m |
| 1.0 m, -55° to +55° | **The landing arc**: 12 slots where cards lie face-down. VR: a curved shelf of 17 flat dark facets, 0.18 m deep, with a cyan front edge and a teal back edge; MR: the two edges only | 0.79 m |
| 1.0 m, -67° and +67° | **Later** and **Done**, glass pads with teal rings at the arc's ends, told apart by their counts (amber is kept for what needs you) | 0.79 m |
| 1.3 m ahead, behind the arc | **The inbox well**: up to 3 messages that have no slot yet wait here (unread VIPs on top), and its label counts the rest | 0.79 m |
| 1.45 m, 60° left | **The mode column**: outlined glass capsules for Owner sign in (until signed in), About, Morning, Focus, Triage and Wrap-up; the status line under them | 0.84–1.92 m |
| 1.6 m, 52° right | **Pinned tasks**: a line of counts, then three task cards, below the ring's labels | 0.86–1.66 m |
| 1.75 m, -42° to +42° | **The fan** (triage): five face-up cards; a VIP's card has an amber frame | 1.29–1.55 m |
| 1.4 m ahead | **The reading card** (triage): from, subject, preview. The five action capsules are under it, 1.15 m out at 0.83 m | 0.9–1.3 m |
| 1.4 m ahead | **A draft** (triage): "Draft to …" takes the reading card's place; Approve, Deny and More take the action row's | 0.9–1.3 m |
| 1.45 m ahead | **Focus**: the task and its timer, with Start/Pause to the right and "Next: …" above | 0.88–1.76 m |
| 1.95 m, all round | **The cocoon** (focus): 16 dark flat facets that slide in from 3 m | 0–2.6 m |
| 2.1 m, 82° left | **The window**: a pane framed by light bars, its sky turning from day to dusk to night against the sunset time, with weather, sunset and one headline on its sill | 0.87–1.91 m |
| 1.7 m behind | **The quiet shelf**: muted messages, with a label card above it | 1.0 m |

**How the look is made** (the client can only print white text and cannot change a colour at runtime):
- **State colours are pre-built variants.** An event pill comes in three tones and a card in six templates (the four sources share one cyan rim for now, a VIP is amber, a read card dim; the sources keep their own templates for the visual pack); when a state changes, the room swaps in a clone of the other variant, in the same place. All of these choices live in `style.rs`: `style::template`, `style::event_tone`, `style::card_tone`, `style::pane` (the window) and `style::fan_frame` (a VIP's amber frame in the fan).
- **Text sits on dark glass cards (plaques).** The client prints text on a thin upright plane flat on its face. So the stage, the fan, the reading card, the draft, the tasks, the window sill, the focus cards, the banner and the quiet label each carry their own text, and in MR each card is its own plate. Every text goes through one function, `App::say` with a `style::Place`.
- **Nothing is rotated at runtime.** What moves is round about the vertical (pills and discs), so it looks the same from anywhere; what is flat is built already facing you, its yaw in the node.
- **Motion is per frame** (`k_tick`): the ring turns, cards fall, the fan and the reading card rise, the cocoon closes in.

**The look: holographic glass** (CEO, 2026-10-19, on the first v2 renders: "It looks like very early-2000s forms when we have the ability to improve that and change that"). The direction is `work-in-vr-design/ART_DIRECTION_HOLO_GLASS.md`, after two references the CEO sent. All of it is authored geometry, materials and bundle textures, so it runs on today's API:
- **Everything is unlit** (`KHR_materials_unlit`), so nothing catches a light or a specular streak. The first glass pass was lit: the ring's band read as a grey wall and glare washed out button labels.
- **Text sits on solid near-black glass.** Panels, capsules, pills and cards are solid, darker than the room around them; so is the focus cocoon in VR. The references keep their text fields clean; a translucent banner let the now bar and the ring labels run through its words (review round 1). Translucent: the Day Ring's band (alpha 0.6 VR, 0.8 MR), the MR plates (0.84), the halo, and in MR the cocoon (0.8: passthrough never hides a virtual pixel, so a solid cocoon would hide the real room, and Guardian is off while passthrough shows).
- **Light bars carry the structure**: a 3 mm unlit cyan bar along each panel's top and bottom, small teal corner brackets. Every light is an unlit colour at most 1.0 (the headset renders LDR, with no bloom), so it reads crisp, not glowing. Amber marks only what needs you (the now bar, the banner, a VIP); green and red only Approve and Deny.
- **The Day Ring is a segmented light ring**: 120 dashes with hour ticks, two teal hairline rails, and a dark glass band of 21 facets behind it, in both worlds.
- **Buttons are outlined glass capsules**, the label printed on the glass: a thin cyan outline over a dark fill (Approve green, Deny red).
- **Cards are dark glass chips with a light rim**; a VIP's rim is wider and amber. Events are dark glass pills with a light ring at their top and bottom.
- **The floor carries a projected ring and grid** (a 1024² decal texture, 6 m across): rings under the landing arc and the Day Ring, ticks every 5° and 15°, and a half-metre grid that fades out by 2.6 m. VR only: in MR, passthrough never hides a virtual pixel, so any floor ring would be painted across your real desk and chairs. The headset loads textures without mipmaps, so every line is at least 2.5 texels wide. The decal is a cut-out (`MASK`), drawn in the opaque pass, so it never sorts over the glass.
- **One faked halo**: a soft amber quad behind the top of the now bar. It also hides in triage and focus.
- **The window** is a sky gradient (a small texture per pane), with stars at night; its sill is a glass panel.
- **No fake readable data**: every readable word is real world text.
- **The translucency guardrail** (no pixel behind more than two translucent layers) holds by construction: the only translucent surfaces are the band, the MR plates, the halo and the MR cocoon. The halo has only the band behind it; a plate has at most the band behind it; in Focus the band and the halo are hidden, so the MR cocoon has at most a plate behind it, and its facets meet edge to edge rather than overlapping; everything in front of them is solid. The frame time is a device check (section 9, item 11).
- **Never Kosmos chrome**: no amber Kosmos logo and no menu or sheet shapes; the room's capsules and panels are its own.

A side-by-side sheet against the two references is made by `tools/make_sheet.py`; the references are the CEO's and stay outside this repo, so the sheet does too.

**VR** (`more-room`):
- a dark floor carrying the projected ring-and-grid decal;
- sky `night`, because world text is always white and needs a dark field.

**MR** (`more-room-mr`):
- `presentation.mode: immersive-ar`, `blend: alpha-blend`, sky `void`;
- no floor and no floor decal (it would be painted across your real furniture); the landing arc is a cyan front edge and a teal back edge;
- **the dark glass band behind the Day Ring** is denser (alpha 0.8), so the ring and its labels read against a light wall;
- dark plates behind only the text that floats (the status line, the inbox count and the two pile counts): every other text now sits on its own glass panel or capsule.

The room floats at fixed spots relative to where you stand when the world loads. MR worlds register the room to the world once, in the travel fade (D-062). No room data is read (section 8).

## 3. The four modes

One capsule each, on the mode column. The current mode reads `[Triage]`.

Renders: [renders/](renders/), as `vr-<mode>-<view>.jpg` and `mr-<mode>-<view>.jpg`. The views are `eye` (standing, straight ahead), `arc` (looking down at the landing arc), `overview` (from above and behind), `seated` (a 1.2 m eye, at a desk), for Morning, `left` (the window and the modes) and `right` (the tasks), and for Focus and Triage, `column` (a head turn to the mode column and its status line) and, in Focus, `go` (a head turn to Start/Pause). The eye views use a 16 mm lens, about 97° wide, so text at their edges (the status line 60° left, Pause 26° right) is stretched there; the head-turn views, at 24 mm, show it as a visitor turning to it would.

### Morning brief
- **The stage:** Claude's brief, up to four lines ("3 things need you today: …").
- **The Day Ring:** five labels around now: the event just past, and the next ones.
- **The tasks:** "8 to do, 3 doing, 5 done", and the three pinned tasks.
- **The landing arc** with the inbox well: "Inbox 30, 2 VIP / +15 more".
- **Press a task** to focus on it. **Press a card** to read it (that opens Triage). **Press an event** for its prep.

### Focus
- **The room closes in:** 16 dark facets slide in from 3 m to 1.95 m around you. The ring and the window are outside; the tasks, the shelf's label and the cards on the arc (inside the cocoon) are put away.
- **In front of you:** "Focus on: Answer counsel on terms", a 25-minute timer under it, Start and Pause to its right, and above it the only other thing you see: "Next: 10:30 Counsel call".
- **Messages keep landing**, out of sight and **silent**.
- **A VIP ticks once, from the well**, and for 90 seconds the banner gains a second line, "VIP: Dana Whitfield": the banner is the room's one low notice band. Nothing moves toward you.
- Any mode capsule opens the room out again.

### Triage
- **The cards rise:** five cards rise from the arc and fan out face-up at reading height (sender and subject), unread VIPs first in an amber frame. Their discs leave the arc while they are up.
- **The ring clears in front of you:** the banner rises to just under the ring, so the pills, labels and now bar within 24° of now step aside (`TRIAGE_CLEAR_DEG`); seen seated, the banner would otherwise cut them in half (review, glass round 2).
- **Press a card in the fan** to read it: the reading card rises in front of you (from, subject, a preview), with five capsules under it.
- **Done** archives it to the Done pile; **Later** snoozes it to the Later pile; **Mute** sends it to the quiet shelf behind you; **Task** ("Make a task") creates a Linear ticket from it, and the status names the ticket.
- **Reply** ("Claude drafts reply"): the bridge asks Claude for a draft, which takes the reading card's place, front and centre, as "Draft to …" in pages of three lines; **Approve**, **Deny** and **More 1/3** take the action row's place while it waits.
  - **Approve** hands it to the bridge, which sends it through Mission Control's approval path.
  - **Deny** discards it. For 0.3 s after the row swaps, its capsules ignore presses, so a double press on Reply can't land on Deny.
  - **Nothing is sent without that press.** The test asserts that no approval reaches the bridge before it.
- The fan refills from what is left. Leaving triage puts the fan away and the cards back on the arc.

### Wrap-up
- **The stage:** "Done: 5 tasks, 2 messages", the two latest done tasks, and "First tomorrow: …".
- **The tasks:** "Roll to tomorrow: press one", and every open task. A press rolls it to tomorrow.

### About this room
- **The About capsule** (second on the mode column) opens seven short pages on the stage, while the room around it clears. The banner stays.
  1. What the room is: the rectangle question, and a place for each part of the day.
  2. Sample day: nothing here is real yet.
  3. The ring and the modes.
  4. The piles and actions.
  5. How the real room will connect: its owner's bridge on their PC, with mail, calendar and Linear; Kosmos stores none of the mail.
  6. Going live needs steps on the owner's PC; iPhone texts can't be read, and Android would need a small app.
  7. What is coming: pinning the cards to your real wall, which needs the room permission sheet first.
- **Next** pages through them, and **Close about** returns.
- A test asserts that every page fits whole: 4 lines of 30 characters, no cut.

### Always there
- **Prep:** press any event pill (outside focus) and the stage shows its prep sheet, which Claude gathers: attendees, agenda, related mail and tickets. A Close capsule returns.
- **The window:** weather, sunset and one headline.
- **The quiet shelf:** "Quiet shelf: 1" and the senders' names.
- **The status line**, under the mode column: "Sample day. Only the owner can sign in.", "Live. Updated 3 s ago", "Press a card in the fan to read it." in triage, or a plain error ("Wrong passphrase", "The bridge did not answer. Is the PC awake?", "Network is off for this world", "Signed out by the bridge. Sign in again.").

## 4. Budgets, measured

Every number below was measured by running the built `world.wasm`:
- in `tools/mock-host.mjs`, a model of the client's limits at cook `C-20261013-ecad7c5` (sources are in that file's header);
- against the mock bridge;
- on the source GLBs **and** on the optimized scenes inside the built bundles (`--packaged`).

| Budget | Limit (source) | Sample day | Heavy day (`tools/stress.mjs`) |
|---|---|---|---|
| World texts at once | 32 (`KWasm::MAX_WORLD_TEXT`) | peak 25 | busiest screen (triage: the fan, a long draft up front, both piles): 22 |
| Bytes per text / lines | 128 / 4, refused not cut | every text built by `text::Lines`; 0 refusals | 0 refusals |
| Created objects | 128 (`MAX_CREATED_NODES`) | peak 30 | peak 39 (30 cards drawn + 8 events) |
| Creates per frame | 16 (`MAX_NODE_CREATES_PER_FRAME`) | at most 12 (the script's own cap; the rest wait a frame) | at most 12 |
| Request body | 16 KiB | largest 83 B | — |
| Answer | 256 KiB, text or JSON only | largest 4.8 KB (the whole sample day) | 7.7 KB for 40 messages |
| Requests | 4 in flight, 1 a second with bursts of 10 | 15 polls plus presses; never rate-limited | — |
| Wasm | 256 KB | 107.9 KB (6.4 KB of it is the built-in sample, about 20 KB a scratch day a live answer is read into first) | — |
| Triangles | 1,000,000 | 16,846 VR, 16,676 MR (doctor; the glass pass added light bars, capsules and rings) | — |
| Texture memory | 48 MB | 4.2 MB VR (the floor decal, the halo and three window skies), 0.2 MB MR (no floor decal) | — |

**Per frame**, the ring moves 10 pills and 13 ticks only when its clock has moved, and sets visibility only when it changes; the cocoon moves 16 facets only while it is closing in or opening out.

**What the room draws when the day doesn't fit:**
- the arc shows 12 cards, up to 3 more wait in the well, and the well's label counts the rest ("+15 more" on the sample day);
- the ring labels at most 5 events around now (2 in triage, none in focus); every pill stays pressable for its prep. A label is shown again once its event has moved 6° round, so it faces you again (the client faces a label once, when it is shown);
- each pile shows 5 cards and counts the rest;
- the shelf shows 6.

**Per mode, the most texts at once** (sample day):

| Mode | Texts |
|---|---|
| Morning | about 23 |
| Focus | about 13 |
| Triage, with a card being read | 26 (a draft replaces the card and the actions) |
| Wrap-up | about 21 |

**Test totals:**
- `tools/scenario.mjs`: 310 checks across both worlds, all passing (including the halo, the band in both worlds, the ring clearing in triage, and the MR plate names matching between the scene and the script). Part 1 runs the built-in sample with **no request at all**: the ring turning with the clock, a past/now/later pill (and 25 minutes on, the counsel call amber under the now bar), prep, About, the cocoon closing in, the fan rising, the reading card rising, every triage action and the wrap-up. Part 2 signs in and runs the live day: a cut answer, a card falling onto the well, a VIP's single tick in focus, the VIPs leading the fan, Approve reaching the bridge, a sign-out and network off;
- `cargo test`: 21 host tests, including "the baked sample is a complete DAY/1 day", "every About page fits whole", the ring's angles, and the sine and cosine the room computes without a math library;
- `kosmos-wp validate` and `bundle` at publisher main `fced9cf` (CLI 0.8.1, 83 rules) pass both worlds against level 4;
- `kosmos-wp doctor`: VR 17 ✅, 0 ⚠️, 0 ❌; MR 17 ✅, 0 ⚠️, 0 ❌;
- the wasm imports only the host's `kosmos.*` functions (no math library, no `k_transform_set_rotation`) and passes `wasm-tools validate`.

**Plates never block a press.** Every press in the scenario traces a ray from eye height to its target and fails if anything visible is hit first. The ring's track is tested as a ring, not a disc (`hollow` in `tools/build_glb.mjs`).

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

**Sign-in is for the room's owner, and guesses can't lock the bridge** (review lens B, 2026-10-19).
- The worlds are unlisted links that others may open. The bridge locks for 15 minutes after 5 wrong passphrases in a row, and hard-locks after 10 in 24 h; a hard lock also takes Mission Control down until the CEO unlocks it at his PC.
- So the room says plainly that sign-in is the owner's ("Owner sign in"; "Sample day. Only the owner can sign in."; the sheet's own text says wrong guesses pause sign-in here).
- The face stops passing wrong guesses to the bridge after **4 in 24 h** (`WRONG_CAP` in `day-core.ts`) and answers `room_locked` ("Too many wrong tries. Wait a day or restart bridge."). Any number of visitors' guesses in this room can then never reach the bridge's hard lock. Only this room's sign-in pauses. A test pins this: the fifth guess never reaches the bridge.

**One sign-in at a time, for the whole bridge.** Signing in to More Room is signing in to the bridge. If the CEO then signs in from the Lobby (Mission Control), More Room's token stops working, and the room says "Signed out by the bridge"; the same holds the other way round. That is the bridge's rule, and More Room follows it.

**Approve and Deny.** These are the CEO's press in the room.
- A draft that is a **bridge Approval** is decided through `ctx.bridge.actions.decide`, which is Mission Control's path, log and sender. A test asserts this.
- If the bridge refuses ("approve this one at the desk", or already answered), the draft stays pending.
- A sample draft is only marked "sent (mock)". Nothing is sent from the face.

**Built against a mock "sample day" only.** [sample-day.ts](../agent-bridge/src/faces/more-room/sample-day.ts) is invented: every person, company and message in it is fake. `node --experimental-strip-types more-room/bridge-day-face/server.mjs --dev` serves it on `http://127.0.0.1:8787`. **Connecting the CEO's real accounts is his act (Class C).**

**When the real day arrives** (review lens A, 2026-10-19): the face must map real ids to short, clean ones (a Linear id is 36 characters; the room's id slot is 32), and a draft that is a bridge Approval must show the Approval's exact text, since that is what Mission Control decides and sends.

**What comes next on the bridge** (verbs to propose for `bridge.ts`, the one shared file, per API.md §4):
1. **"Today"**: today's calendar with each event's prep (attendees, agenda, related mail and tickets), the inbox summary (sender, subject, a short preview, a VIP flag), pinned and open Linear tasks, the weather, the sunset and one headline. These fill the face's store in place of the sample.
2. **"Draft a reply to message X"**: a Claude job whose send step becomes a bridge **Approval**. Its id goes on the draft, so Approve is `actions.decide`.
3. **Message moves:** archive, snooze, mute (labels), and "make a Linear ticket from message X".

**Tested on the real bridge.** In a throwaway copy of Mission Control's branch with this face folder dropped in, `tsc` was clean and the bridge's whole suite passed: the whole suite (on 2026-10-19 the bridge branch had grown to 62 tests), More Room's 11 included in `agent-bridge/test/more-room-face.test.ts`. Those 11 cover:
- the registry finds the face, and the opt-in file lists both worlds;
- another world's address is refused, and nothing is served before sign-in;
- wrong-then-right sign-in through the shared session, whose token also works on `/v1/jobs`;
- the day is served to both worlds;
- turn, draft and approve;
- the dev-only op is absent;
- sign-out ends the room;
- a bridge Approval goes through `decide`;
- wrong guesses through this room stop at 4 a day.

## 6. Headset facts that shaped the design

Each was found reading the client at the cooked commit, or in the lit review of this design.

1. **No `player_read` beside `network` (NET_005).** The room never knows where your head or hands are. Everything sits at fixed spots around the spawn, and nothing can follow your gaze.
2. **World text is white, 8 cm, at most 32 at once, 128 bytes and 4 lines each.** It turns to face you only about the vertical axis, and it is depth-tested.
   - Every text is built by one layout routine with a width in characters, so nothing is ever cut by the host.
   - Lines are at most 30 characters at 2.4 m, and 14 to 22 in crowded places.
   - Nothing solid sits within 0.5 m behind a text anchor.
3. **Desk-level labels are hard to read, and the signed-out room was blank at eye height** (both found in v1's lit review; v2 keeps text off low surfaces: the cards are face-down discs with no text, and the counts float above them). From 1.62 m, a label on the desk is seen 50–60° from above. Because text turns only about the vertical, it is foreshortened and its own button clips it.
   - So the mode buttons moved off the desk, to a column at chest height on the left.
   - The action row rose 15 cm.
   - The low labels lifted.
   - Sign in sits at the top of the mode column. A second review (2026-10-19) moved it there from the column's bottom, where its label ran into the inbox count. The About plate in MR was widened to frame its Next button.
4. **`k_node_find` sees only meshes, and names lose a trailing `_<digits>`.** Every text anchor is a 1 cm mesh with an extra, and no name ends in a digit. Clone names are letters only (`MrCaaaab`).
5. **The publisher's optimizer can eat script nodes.** The scenario was run again on the optimized scene inside each bundle, and every script node survived.
6. **In MR, white text on a light real wall is unreadable** (found in the lit review). So MR has dark translucent **plates** behind each text group.
   - Each plate sits 0.5 m beyond its text on the line from the spawn, faces the spawn, and shows only while its text shows.
   - Each plate is centred on the middle of its text. The first version centred plates on the text anchor, which is the text's bottom edge, and the top line spilled onto the wall.
   - v2 puts most text on dark cards, which are their own plates; the Day Ring has a dark band of flat facets behind it.
   - Passthrough is drawn under every virtual pixel, so a real monitor never hides the room's text. It does make what lies behind the landing arc busy, which only a headset check can judge.
7. **The sign-in sheet is plain, unmasked text** (`k_ui_prompt`: "never a password field").
   - The passphrase shows while you type it.
   - The sheet's footer says the text goes to this world, and the room sends it once, to the face's `signin` op only (a test asserts this), then wipes its buffers.
   - The token lives in memory for the visit only, never in `k_state_*` (that state syncs to groups).
   - A masked field arrives with R5's `k_ui_text_*` at the level of the cook that carries them. Until then, see section 11's alternative.
8. **A clone keeps its source's visibility and collision**, so the hidden templates' clones are shown on creation.
   - Presses on clones dispatch through the handle registry. This is **inferred from source, not yet seen on a headset**, and it is on the device check list.
   - Every clone's `OnInteract` subscription is released when it is destroyed. Subscriptions are a capped pool (256).
9. **`k_transform_set_rotation` replaces a node's relative rotation with a raw engine rotator** (`KDomTransform.cpp`, client `944abfa`): it overrides whatever rotation the glTF importer gave the node. So v2 never rotates anything at runtime (a test asserts the wasm does not import it). What moves is round about the vertical: pills and discs look the same from anywhere. What is flat (the fan, the panels, the capsules, the facets, the plates) is built already facing the spawn, with its yaw in the node, and moves only by position. A card "turns over" by swapping its face: the face-down disc is destroyed and a read-face disc is cloned in its place.
10. **Text plaques** (`KWorldTextPool.cpp`, KOS-981, in both installed cooks `00d9a69` and `ecad7c5`): text on a thin upright plane (its thinnest extent at most a fifth of the next, its rotation in the node, not baked) is printed flat on the plane's face, a hair in front, and never turned. Any other anchor gets upright text faced toward your eye **once, when it is shown**, then carried with its node. v2 puts most text on dark cards for this reason, and shows a Day Ring label again once its pill has moved 6° round, so it faces you again. The renders (`tools/render_modes.py`) follow the same rule.
11. **A text's bottom sits at its anchor's rendered centre plus `offset_y`, and a negative offset is clamped to 0** (`KDomUI.cpp`: metres, clamped to 0..5 m). So text can only rise from a card's middle, never centre on it. Each v2 card therefore hangs a hair-thin dark keel below it, which lowers its rendered centre by half the height of the most lines it holds; `style::offset(Place::Plaque(max), n)` then lifts n lines by the difference, so any text is centred and no offset is negative. The mock host and the renders use the same rendered centre. And when only a held text's words change, the client keeps its first placement and offset: so the room hides and shows a text again whenever its offset must change (a card going from one line to two), and the mock host keeps the first offset too, so a test catches it.

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
- the 300-check scenario on both worlds (the built-in sample with no request, then the live day);
- the face on the real bridge server (the bridge's whole suite, More Room's 11 tests among them);
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
3. The Day Ring: is it readable and comfortable at 2.4 m, standing and seated? Does it turn smoothly (no judder) as the minutes pass? Do the labels face you, and does a label shown again after its pill moved look right? Does the amber now bar read as "now"?
4. The cocoon: does it close in smoothly, and does Focus feel calmer, not claustrophobic? It is solid in VR and see-through (alpha 0.8) in MR. **Safety, MR:** Guardian is suppressed while passthrough renders, so check that the desk and anything you could walk into stay visible through it. Do the facets draw correctly over passthrough (mobile alpha)?
5. Cards: does a new card falling onto the arc read as landing, not popping? Do the fan and the reading card rise smoothly, and is the fan readable at 1.75 m?
6. The text is readable at eye height in VR and in MR (plates against a real wall). Is the open card readable over a real monitor? Do translucent plates and mats draw correctly over passthrough on the headset (mobile alpha)? Do the 1 cm text-anchor studs show as specks on a real wall? Is the inbox count on the well readable in MR (it has its own plate, `PlateInbox`)? Is text printed flat on the dark cards as the plaque rule says? Check it all standing **and seated at a real desk**: the plates are sized for any eye from 1.15 m to 1.75 m (`EYE_LOW`, `EYE_HIGH` in `tools/build_glb.mjs`), and the renders include a seated view (`*-seated`).
   - **The glass look on the headset** (2026-10-19): do the unlit glass, the light bars and the textures (the floor decal, the halo, the window skies) draw as in the renders? glTFRuntime must honour `KHR_materials_unlit` with BLEND (the band, the plates, the halo) and MASK (the VR floor decal); the client's source maps both. Is the halo soft, not a hard square? The headset loads textures without mipmaps: does the floor decal shimmer or moiré 2 to 4 m out? Do the thin lines hold or crawl: the 3.5 mm panel bars at 1.4 to 1.8 m, the 2 mm ring rails at 2.4 m and the band's 3 to 4 mm bars at 2.95 m (about 1 px each)? Over passthrough, does the glass read against a real wall as in `mr-*-eye`?
7. Presses on clones (cards, event pills, the fan's cards) work, including a low controller angle on the arc (the tests trace the press from the eye, not the hand). If they don't, the fallback is authored slots instead of clones.
8. Read, Done, Later, Mute, Task, Reply → Approve: each lands where it lives (in the sample, nothing is sent; signed in, Approve reaches Mission Control's approval log).
9. Focus: a VIP arriving ticks once from the well; a normal message is silent.
10. Put the headset to sleep and wake it, then turn off the PC: the status says "The bridge did not answer. Is the PC awake?", and nothing crashes.
11. Frame time with the full room visible stays within 13.8 ms. The room is about 16,800 triangles, 170 authored nodes (VR), the VR floor decal (a 6 m alpha-tested cut-out: its alpha-test cost counts), several translucent glass panels (the guardrail: never more than two stacked on a pixel) and up to about 40 clones; the ring moves 23 nodes a frame while its clock moves, so it is expected to be fine.

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
