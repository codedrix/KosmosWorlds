# agent-bridge API (v2)

The contract between the bridge on the CEO's PC and any world (or other client) that uses it.
Mission Control is the first face; More Room adds its own. Brief: **DB-044** (kosmos-project PR #210)
and its v2 addendum, `mission-control/V2_CONTRACT.md` (Job Cubes, the decision puck, the Pairing Seal).
Code: KosmosWorlds `agent-bridge/` (v2: KosmosWorlds PR #6, branch `feat/mission-control-v2`; v2.1 is the contract's section 8).

Status marks: **built** (in the code, tested) · **planned** (this lane, next commits).

## 1. One origin

Worlds call **one** HTTPS origin. Recommended (DB-044 option A): the relay Worker
`https://kosmos-agent-bridge.micknerks.workers.dev` (`agent-bridge/relay-worker/`), which:

- answers `GET /.well-known/world-network.json` and `GET /privacy` itself, so they stay up while the
  PC sleeps (the registry drops an origin whose weekly check and its confirm 1-24 h later both fail);
- relays `POST /v1/*` to the PC's tunnel, adding `X-Relay-Key`; refuses anything else, and any call
  carrying a cookie, `Origin` or `Referer`.

One Worker and one bridge serve every room: the opt-in file lists every face's world
(`{"world_network":1,"worlds":[...]}`, from each face's `worlds` plus the Worker's `WORLDS` var).
A second Worker per room is not needed; add your world to `WORLDS` and to your face. **built**

## 2. Auth: the token rides in the BODY

A world can't send an `Authorization` header, a cookie or a query it controls safely, so **every
authenticated call is a POST with the token in the body**:

- wire-format bodies (worlds): a `tok <token>` line;
- JSON bodies (other clients): a `"tok"` field.

Sign-in, three ways, one session store (one sign-in at a time for the whole bridge):

| Route | Body | Answer | |
|---|---|---|---|
| `POST /v1/session` | `{"passphrase":"..."}` | `200 {"token","expires_in"}` · `401 {"error":"wrong"\|"not_set"}` · `429 {"error":"locked"\|"hard_locked"\|"too_fast"}` + `Retry-After` · `403 {"error":"passphrase_off"}` when `passphraseSignIn` is false | **built** |
| `POST /v1/session/end` | `{"tok"}` | `200 {"ok":true}` | **built** |
| a face's sign-in press | the face calls `ctx.signIn(passphrase)` | the face renders the result | **built** |
| the Pairing Seal (v2) | the face's `pair` op mints; the owner approves **at the PC**; the face calls `ctx.pair.signIn(id)` | `K <token>` in the face's answer (section 5) | **built** |

Token: 30 min idle, 8 h absolute, stored only as its SHA-256. Lockout: one attempt per 2 s; 5 wrong
in a row = 15 min; 10 wrong in 24 h = locked until `npm run unlock` on the PC. **built**

A paired session is the same session (same token rules, one at a time). It is issued whatever the
passphrase lockout says, and the LOCKED file does not end it: that lock is about passphrase guessing,
and a pairing was approved at the PC. Every new session, paired or not, starts with group watching
off. **No HTTP route can approve a pairing**; `ctx.pair` has no approve verb (section 5.1).

The headset sends `X-World-Address: <name.author>` on every call. It is forgeable; faces still
require their own world's address (a seat belt, not a lock). **built**

## 3. The JSON API (shared by every face and client)

All `POST`, JSON in and out, token in the body. **built**

| Route | Body | Answer |
|---|---|---|
| `/v1/jobs` | `{"tok"}` | `{"jobs":[Job],"approvals":[Approval],"projects":[name]}` |
| `/v1/jobs/start` | `{"tok","preset","project"}` | `{"ok":true,"job":Job}` · `409 {"ok":false,"error"}`. Presets: `tests`, `prs`, `today`, `notes` |
| `/v1/jobs/new` | `{"tok","text","project"}` | same. `text` becomes the agent's prompt (max 1,000 chars) |
| `/v1/jobs/<id>/events` | `{"tok","since":N}` | `{"job":Job,"events":[Event]}`: events with `seq > N`, oldest first, max 200 |
| `/v1/jobs/<id>/message` | `{"tok","text"}` | `{"ok":true,"job":Job}`. A finished job resumes its session |
| `/v1/jobs/<id>/stop` | `{"tok"}` | `{"ok":true,"job":Job}` |
| `/v1/approvals/<id>/decide` | `{"tok","decision":"approve"\|"deny"\|"why"}` | `{"ok":true}` · `409` already answered, or "approve this one at the desk" |

```
Job      = { id, agent, project, title, status, started_at, elapsed_s, progress|null,
             files_touched, outcome|null, session_id|null }
           status: starting | running | waiting | idle | done | failed | stopped
Event    = { id, seq, at, kind, text, approval|null }
           kind: user | agent | activity | approval | decision | notice
           An event that grows (streamed reply text, "Read 6 files") keeps its id and gets a new seq:
           upsert by id.
Approval = { id, job, number, title, command, exact }
           number rises across the bridge: a new one is the moment to buzz.
           exact=false: the command was redacted, is too long or spans lines, or the file is
           outside the project or runs code by itself (.claude/, .git/, .mcp.json, ...);
           approve it at the desk.
```

There is **no verb that runs text**. Everything a client types is a prompt; Claude Code's own
permission rules decide what runs, and each of its prompts becomes one Approval.

## 4. Faces (one folder per room)

`POST /v1/faces/<face>/<op>`: the room's wall, in the face's own format. **built**

- Add `src/faces/<name>/index.ts` with a default-exported `Face` (`src/faces/types.ts`):
  `{ name, worlds, handle(op, req, ctx), reset() }`. The registry finds it by folder; no other file
  changes, Mission Control's included.
- The server does the Host, Origin, size, rate, relay-key, stop and token checks first, and gives the
  face `ctx.authed`, `ctx.signIn`, `ctx.signOut`, `ctx.pair` (`mint`, `state`, `signIn`: the stop and
  config checks live in the server; there is no approve), `ctx.waitForChange(ms)` and `ctx.bridge`
  (`.store` to read, `.actions` to act: `startPreset`, `startTask`, `send`, `quick`, `decide`, `stop`).
- `req` is parsed from either the AB1 lines or JSON (`tok`, `v`, `press`, `pair`, other `[a-z]{1,12}`
  fields, `text`), so a face may answer JSON or anything else it likes.
- A face that needs a new VERB (say, "read today's calendar") proposes it in its brief: `bridge.ts` is
  the one shared file.

### Mission Control's face: the AB1 wire format (`src/wire.ts`) **built**

Request (text/plain):
```
AB1
tok <token>            (signed in)   or   pair <id>   (waiting on a pairing: 32 lowercase hex)
v <snapshot version on screen>
press <NodeName>
---
<typed text, raw>
```
Snapshot (text/plain, one record a line, integers only):
`V n` version · `M lock|pair|cubes|arc` · `K token` · `I id` a pairing id (keep it in memory and echo
it as `pair <id>` while waiting) · `E code` · `T node text` (`\n`, `\\` escaped) · `X node` hide text ·
`U node 0|1` visibility · `H node state` paint a hue base (`calm`, `need`, `idle`, `armed`, `locked`,
or `off` = no variant; the world shows the variant node `<node><State>`, e.g. `CubeANeed`) ·
`O node mm` sideways shift · `P node question` the press opens the typing sheet · `Z n` approvals ever
(buzz when it rises) · `S` nothing changed. (`G` gauges and `C` copies stay in the format; v2 sends
neither.)

Events (`E`): `stale`, `refused`, `signed_out`, `pair_wait`, `paired` (comes with `K`), `pair_expired`,
`pair_refused` (rate-limited, the kill switch, or pairing off), `passphrase_off`, and for watchers
`watch_refused` and `watch_wait`.

`view` is a long poll: send the version you show; the bridge answers when the view changes (at most
about once a second) or after 6.5 s with `S`. `press` names a node and the version: the bridge resolves
what that node meant in that snapshot, and refuses a stale one.

### The Kosmos Desk face (`src/faces/desk/`) **built**

`POST /v1/faces/desk/board`, from `world://lobby.micknerks` only. **Read-only**: `board` is its one op
(any other answers 404), and a `press` or typed text in the request is ignored. It never calls
`ctx.signIn`, `ctx.signOut` or `ctx.pair`: it rides the token Mission Control's sign-in already holds,
so it can't open a second session or end the CEO's.

- Request: `AB1` then `tok <token>`. Without the live token: 401 `E signed_out` and no card. With the
  kill switch on: 503 `E stopped`.
- Answer (200): `V 1`, then `T TxDeskHead KOSMOS DESK\n<count and freshness, or Desk offline>`, then for
  each of the 8 rows `TxDeskA`..`TxDeskH` either `O <node> <mm>` + `T <node> <title - session, day>`
  (left-aligned on the board) or `X <node>`. No other node is ever named.
- The data: the hub session's snapshot file, `E:\Kosmos_Desk\desk.json` (or `KOSMOS_DESK_FILE`),
  read on every request and sanitized again. Its schema, and what makes the board say "Desk offline"
  (missing, malformed, over 16 KiB, from the future, older than 15 minutes): `src/faces/desk/SCHEMA.md`.
  `npm run desk-check -- <file>` prints the board a file would make.

## 5. Mission Control inside the Lobby (v2)

The node list is `mission-control/nodes.json` (written from `src/faces/mission-control/layout.ts` by
`scripts/write-nodes-json.mjs`): `text`, `buttons`, `show`, `hue` (base to states) and `world` (nodes
only the world touches, the hue variants among them). Modes:

| `M` | who | what the face sends |
|---|---|---|
| `lock` | anonymous | every text `X`, every button and panel `U 0`, every hue `off`; a refused sign-in or the stop may show in `TxSealHint`; `BtnSealType` while the passphrase fallback is on |
| `pair` | the headset holding a pairing id | `TxSeal` (the code, `KXT WMP`), `TxSealHint`, `H SealRing armed`, `BtnSealType` |
| `cubes` | the owner, arc folded | the ledge (`CubeA..D` with `H calm/need/idle` and `TxCubeX` = the short project name; a cube keeps its job while the job runs, a new job takes the first free cube; empty slots `U 0` and `H off`; `CubePlus`) and the puck; every arc text `X` (the arc buttons, `BtnSignOut` among them, keep their last `U`, so the world can fold them; the press map no longer knows them). Folded, the owner leaves with Close on the ledge, a world node (contract 8.7) |
| `arc` | the owner, arc open | the ledge, the puck and the arc. Left = jobs only: `TxTicker` (two lines), the rail (`RailA..D`, two-line rows), `TxDone` (one line). Centre = header, the conversation (10 lines, or the 5 above the ask plate while an approval shows), page, the ask plate, quick replies, reply, fold, stop, status; with NO job open, the start-a-job set instead (`BtnTests`, `BtnPrs`, `BtnToday`, `BtnNotes`, `BtnNewTask`, `BtnProject`, `TxProject`), hidden (`U 0`, `X`) while a job is open. The chrome bar: `BtnWatch` with `TxWatch` (`off` or `code 123 456`), `BtnSignOut`. Right = `TxPageSpot` only (a placeholder naming DB-043's page panel). At most 29 labels |

Press actions: `cube:<jobId>` opens the arc on that job; `cube:none` (`CubePlus`) opens it with no job;
`fold` (`BtnFold`) returns to `cubes`; `rail:<id>`, presets, `new`, `project`, `stop`, `approve`/`deny`/
`why`, `quick`, `reply`, `pageup`/`pagedown`, `watch` and `signout` as before. `BtnPuckApprove` and
`BtnPuckDeny` are `approve:<id>` and `deny:<id>` for the OLDEST pending approval. `TxPuck` is ONE
line, `<project>: <verb> <command>` (`registry: run npm test`); Approve shows only when the approval
is `exact` and that whole line fits `W.puck` (and the host's 128 bytes): the ask plate's "you approve
what you read". An exact command too long for the line reads `<project>: open its cube`; an approval
that isn't exact (redacted, multi-line, outside the project, runs code by itself) reads
`<project>: approve at the desk`, since the cube can't approve it either. Only Deny shows in both. Colour is
chosen in one function (`paint`) and leaves the PC only as `H`. A render's version changes whenever
what it shows OR what any press means changes (the oldest pending approval's id included), so two
approvals that read the same never share a press map. When an approval appears or clears while the
owner is paged back, the page that still shows the last line on show is kept.

- **`pair`** (anonymous): with no `pair` field, mint a pairing and answer `M pair`, `I <id>`, the seal
  records and `E pair_wait`. With `pair <id>`, a long poll: answered when the owner approves, the code
  expires, or after the usual wait. Pending: the seal records again (no `I`). Approved: `K <token>`,
  `E paired`, `H SealRing locked`, then the owner's `M cubes`. Expired, taken or unknown: `M lock`,
  `X TxSeal`, `H SealRing off`, `E pair_expired`. Refused (rate, stop, pairing off): `E pair_refused`
  with the reason in `TxSealHint` (for the rate: "Wait a few seconds, then press the seal again.").
- **`signin`** (the passphrase fallback, "Use passphrase" under the ring): the passphrase as the text.
  Unchanged, except: `E passphrase_off` when the PC set `passphraseSignIn` false (and the face hides
  `BtnSealType`); and a refusal sent with a live `pair <id>` answers the seal records again, with the
  reason in `TxSealHint`.
- **Group watching** (off by default): the owner presses `BtnWatch` in the arc; the bridge makes a
  six-digit code and `TxWatch` shows it. A group member's world calls `watch` with a `watch <code>`
  line instead of `tok`, and gets a read-only ARC (always open: the owner's focus, or the first running
  job): no ledge, puck or seal records, no `H`, no `Z`, no `K`, no typing-sheet records, and NO action
  button at all (every arc button but the rail's rows is `U 0`: Approve, Deny, Ask why, Stop, Fold,
  the quick replies, Reply, paging, the start-a-job set, watch, sign-out); `TxWatch` reads `read-only`
  and the status line names the last button the owner pressed (its words, never anything typed). A long poll on its own version numbers; it maps no presses. A code dies at
  toggle-off, any new sign-in (paired too), sign-out, the kill switch, 2 hours, or 45 s after the
  owner's own view stopped asking. At most 10 wrong codes a minute across everyone.
- **Anonymous callers** get `lock` (or their own `pair`) from their own version space and press map;
  nothing they send touches the owner's view.
- **Zero calls before the seal** (world side): the Lobby program makes no network call until the
  visitor presses the seal, or types a watch code at the Watch button.

### 5.1 The pairing verb (`src/pairing.ts`) **built**

- **Code:** 6 letters from `BCDFGHJKLMNPQRSTVWXZ` (64 million), shown `KXT WMP`. **Id:** 16 random
  bytes, hex. **Lifetime:** 120 s from the mint. **Single use:** the first poll after approval takes
  the token and the pairing is gone.
- **Slots (contract 8.9):** up to 16 live pairings, each keyed by its id. A typed code approves only
  the pairing whose code it is; the others keep waiting. The rate and the 120 s life allow at most 12
  alive at once, so a stranger pressing the seal at the cap never evicts the owner's pairing inside its
  life; a full table would replace its oldest, a backstop the rate makes unreachable.
- **Mint rate:** at most 6 a minute across everyone, at least 3 s apart; beyond that `pair_refused`.
- **Residual risk, stated:** a bot minting at the cap uses up the mint rate, so the owner's own press
  can be refused (`pair_refused`, "wait a few seconds"). A nuisance, never a sign-in; the passphrase
  fallback is still there.
- **Approval is local only:** (1) in a terminal, `npm start` itself prints "A headset asks to pair
  (N s ago). Type the code shown on YOUR ring to approve:" and never prints the code; (2)
  `npm run approve -- <code>` writes `PAIR_APPROVE` (letters only, at most 32 bytes) in the bridge's
  home, which the serve loop reads and deletes within a second, beside the STOP check, and answers
  through `PAIR_RESULT`. `npm run approve` with no code says whether one is waiting and how old it is
  (from `PAIR_PENDING`, which holds the newest mint time and how many pairings wait, never a code or
  an id). A file that isn't a plain file, or is over 32
  bytes, is removed unread; `serve` clears all three files at start.
- **The typed code** is normalised (letters only, upper case) and compared in constant time against
  every waiting pairing; five wrong codes in a row cancel every waiting pairing.
- **The kill switch** refuses minting and clears what is pending. `pairSignIn: false` in config.json
  refuses every pairing.
- **Logs:** the request log has no codes, ids or tokens; the console's lines name no code.

## 6. Limits a client must respect

The headset allows a world 4 requests in flight, 1 a second with bursts of 10, 16 KiB up and 256 KiB
down per call. The bridge refuses bodies over 16 KiB and rate-limits globally (20 a second, burst 60).
