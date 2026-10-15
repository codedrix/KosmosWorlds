# agent-bridge API (v1)

The contract between the bridge on the CEO's PC and any world (or other client) that uses it.
Mission Control is the first face; More Room adds its own. Brief: **DB-044** (kosmos-project PR #210).
Code: KosmosWorlds `agent-bridge/` (branch `feat/mission-control`).

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

Sign-in, two ways, one session store (one sign-in at a time for the whole bridge):

| Route | Body | Answer | |
|---|---|---|---|
| `POST /v1/session` | `{"passphrase":"..."}` | `200 {"token","expires_in"}` · `401 {"error":"wrong"\|"not_set"}` · `429 {"error":"locked"\|"hard_locked"\|"too_fast"}` + `Retry-After` | **built** |
| `POST /v1/session/end` | `{"tok"}` | `200 {"ok":true}` | **built** |
| a face's sign-in press | the face calls `ctx.signIn(passphrase)` | the face renders the result | **built** |

Token: 30 min idle, 8 h absolute, stored only as its SHA-256. Lockout: one attempt per 2 s; 5 wrong
in a row = 15 min; 10 wrong in 24 h = locked until `npm run unlock` on the PC. **built**

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
           exact=false: the command was redacted or is too long; approve it at the desk.
```

There is **no verb that runs text**. Everything a client types is a prompt; Claude Code's own
permission rules decide what runs, and each of its prompts becomes one Approval.

## 4. Faces (one folder per room)

`POST /v1/faces/<face>/<op>`: the room's wall, in the face's own format. **built**

- Add `src/faces/<name>/index.ts` with a default-exported `Face` (`src/faces/types.ts`):
  `{ name, worlds, handle(op, req, ctx), reset() }`. The registry finds it by folder; no other file
  changes, Mission Control's included.
- The server does the Host, Origin, size, rate, relay-key, stop and token checks first, and gives the
  face `ctx.authed`, `ctx.signIn`, `ctx.signOut`, `ctx.waitForChange(ms)` and `ctx.bridge`
  (`.store` to read, `.actions` to act: `startPreset`, `startTask`, `send`, `quick`, `decide`, `stop`).
- `req` is parsed from either the AB1 lines or JSON (`tok`, `v`, `press`, other `[a-z]{1,12}` fields,
  `text`), so a face may answer JSON or anything else it likes.
- A face that needs a new VERB (say, "read today's calendar") proposes it in its brief: `bridge.ts` is
  the one shared file.

### Mission Control's face: the AB1 wire format (`src/wire.ts`) **built**

Request (text/plain):
```
AB1
tok <token>
v <snapshot version on screen>
press <NodeName>
---
<typed text, raw>
```
Snapshot (text/plain, one record a line, integers only):
`V n` version · `M lock|wall|chat` · `K token` · `E code` · `T node text` (`\n`, `\\` escaped) ·
`X node` hide text · `U node 0|1` visibility · `G node 0..1000` gauge · `O node mm` sideways shift ·
`C node count` copies · `P node question` the press opens the typing sheet · `Z n` approvals ever
(buzz when it rises) · `S` nothing changed.

`view` is a long poll: send the version you show; the bridge answers when the wall changes (at most
about once a second) or after 6.5 s with `S`. `press` names a node and the version: the bridge resolves
what that node meant in that snapshot, and refuses a stale one.

## 5. Mission Control inside the Lobby

- **The ritual's sign-in** (built): `POST /v1/faces/mission-control/signin` with the passphrase as the
  body's text (after `---`). No snapshot version is needed, so it can be a world's first call. The
  answer is the owner's wall with a `K <token>` record, or the lock screen with `E refused`.
- **Group watching** (built; off by default): the owner presses `BtnWatch` on the panel; the bridge
  makes a six-digit code and the panel shows it (`TxWatch`). A group member's world calls
  `POST /v1/faces/mission-control/watch` with a `watch <code>` line instead of `tok`, and gets a
  read-only copy of the owner's wall: no token, no typing-sheet records, no watch toggle, and the
  status line names the last button the owner pressed (its words, never anything typed). It is a long
  poll like `view`, on its own version numbers. A watch code can never approve, type, start or stop
  anything (the watch op maps no presses). It dies at toggle-off, sign-out, the kill switch, 2 hours,
  or 20 s after the owner's own wall stopped asking for updates (the owner left). At most 10 wrong
  codes a minute across everyone.
- **Anonymous callers** get the lock screen from their own version space and press map; nothing they
  send touches the owner's wall.
- **Zero calls before the ritual** (world side): the Lobby program makes no network call until the
  ritual's sign-in, or until a visitor types a watch code at the Watch button.

## 6. Limits a client must respect

The headset allows a world 4 requests in flight, 1 a second with bursts of 10, 16 KiB up and 256 KiB
down per call. The bridge refuses bodies over 16 KiB and rate-limits globally (10 a second, burst 30).
