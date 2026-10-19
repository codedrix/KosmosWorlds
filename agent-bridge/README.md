# agent-bridge

A small service on the CEO's PC that lets Kosmos worlds start and steer **Claude Code** jobs in the
CEO's real project folders, with the CEO's own login, settings, CLAUDE.md, memory, skills and MCP servers.
Mission Control (`../mission-control/`) is its first room; More Room (a separate brief) plugs in
beside it without editing Mission Control's files. Brief: **DB-044** (kosmos-project).

**It listens on 127.0.0.1 only.** The headset refuses home-network addresses, so the world reaches
it through a tunnel **the CEO sets up** (DB-044, "Your steps"). Nothing here creates a tunnel, an
account or a key.

**The recommended front door (DB-044 option A)** is `relay-worker/`: a ~90-line Cloudflare Worker on
`kosmos-agent-bridge.micknerks.workers.dev` that serves the opt-in file and `/privacy` itself (so
they stay up when the PC sleeps; the registry drops an origin whose weekly check fails twice) and
relays `POST /v1/*` to the PC's tunnel with a shared secret. `npm run make-relay-secret` makes the
secret, hands it to `wrangler secret put RELAY_SECRET` through stdin and saves it to the bridge's
config; it is never printed (deploy the Worker once first, signed in with `npx wrangler login`).
With the secret set, the bridge refuses any `/v1/` call that didn't come through the Worker. The
Worker's opt-in file lists `world://lobby.micknerks` (Mission Control) and More Room's two worlds,
`world://more-room.micknerks` and `world://more-room-mr.micknerks` (`relay-worker/wrangler.toml`).

## Run it

```
cd agent-bridge
npm install
npm run build
npm run init              # allow the Kosmos project folders that exist on this PC
npm run set-passphrase    # asked twice, hidden; only an scrypt hash is stored
npm start                 # the real Claude adapter, on http://127.0.0.1:8787
npm run demo              # or: a scripted fake agent (no tokens, no folders touched)
```

Stop everything at once from any terminal (works with the bridge running or not, and survives a
restart): `npm run kill`. Lift it: `npm run unkill`. After ten wrong passphrases in a day:
`npm run unlock`. See what is set without printing any secret: `npm run status`.

**Signing in from the headset (Mission Control v2, the Pairing Seal).** Press the seal on the throne:
a ring rises with a short code (`KXT WMP`). At the PC, approve it one of two ways:

- in the bridge's own console, when `npm start` runs in a terminal: it prints "A headset asks to pair
  (N s ago). Type the code shown on YOUR ring to approve:" (it never prints the code: read it off your
  own ring, so a stranger's code is never approved by accident), then type the code;
- or from any terminal: `npm run approve -- KXT-WMP` (any case; spaces and dashes are ignored). It
  waits up to 3 s for the bridge's answer. `npm run approve` with no code says whether a pairing is
  waiting and how old it is, never the code.

The ring locks and the job cubes grow in. Nothing secret is typed in the headset. The typed
passphrase stays as a fallback ("Use passphrase" under the ring) unless you turn it off.

Settings and secrets live outside the repository, in `%APPDATA%\kosmos-agent-bridge\` (`config.json`
holds the projects, the port, an optional `model`, an optional `claudeExecutable`, `textScale`, the
passphrase hash, `passphraseSignIn` (default `true`; `false` refuses the typed passphrase everywhere,
the face hides "Use passphrase" and `POST /v1/session` answers `403 passphrase_off`) and `pairSignIn`
(default `true`; `false` refuses every pairing); `STOP` and `LOCKED` are the stop files;
`PAIR_APPROVE`, `PAIR_PENDING` and `PAIR_RESULT` are the pairing's hand-off files, cleared at start,
never holding a token and, except for the code you typed into `PAIR_APPROVE`, never a code).

## What it does

```
headset (world script)  --HTTPS-->  tunnel  --HTTP-->  127.0.0.1:8787  agent-bridge
                                                         |  server.ts   Host/Origin/size/rate/stop/token checks
                                                         |  faces/      one folder per room (the wall's words)
                                                         |  bridge.ts   the verb list (Actions)
                                                         |  jobs.ts     jobs, conversations, approvals (summaries only)
                                                         |  adapters/   claude.ts now; codex.ts later
                                                         v
                                                       Claude Agent SDK -> Claude Code, in the project folder
```

- **One adapter per agent.** `adapters/claude.ts` drives Claude Code through the Claude Agent SDK
  (`@anthropic-ai/claude-agent-sdk` 0.3.286, which bundles Claude Code 2.1.286) with
  `settingSources: ["user","project","local"]`, so a job loads exactly what the CLI loads. Codex is a
  later adapter with the same four verbs (start, send, interrupt, stop); its CLI is not on PATH today.
- **Approvals are Claude Code's own permission prompts, one to one.** `permissionMode` is always
  `"default"`, set explicitly (an omitted mode follows the settings' `defaultMode`, which could be
  `auto`). Claude Code's rules decide first; every case where it would show a prompt reaches
  `canUseTool` and becomes one approval on the wall. Approve = allow this once (never "always");
  Deny = deny; Ask why = deny with "explain in two sentences, then ask again".
- **A typed message is a prompt, never a command.** There is no verb that runs text.
- **Only summaries leave the PC**: Claude's reply text, one line per tool use built from the tool's
  name and input ("Read 6 files", "Edited a.ts +84 -3"), counts read out of a test run ("14
  passed"), and approval requests. Never file contents, command output or diffs. Everything is
  secret-redacted and stripped to plain ASCII on the way out.

## Picking a job up at the desk (found, 2026-10-14)

- A session the bridge starts **does not appear in the Claude desktop app's Code sidebar on its own**:
  the app lists the sessions it has indexed itself (`%APPDATA%\Claude\claude-code-sessions\...`), and
  a headless probe session never showed up there.
- The desktop app (2.37337) has a menu item **"Import Claude Code CLI Sessions..."** that scans this
  computer for sessions "started in the Code tab or the terminal" and adopts them. Found in the app
  bundle, **not run** (the bridge never drives the app's window).
- **`claude --resume <session id>` in the same project folder works** (verified: the CLI on PATH,
  2.1.143, resumed a session the bridge's SDK 2.1.286 started, and answered from its history). The
  JSON API's `/v1/jobs` returns each job's `session_id`.
- The CLI on PATH (2.1.143) is older than the SDK's and the desktop app's (2.1.293); updating it is
  the CEO's call.

## The API (stable; faces build on it)

| | |
|---|---|
| `GET /.well-known/world-network.json` | the opt-in file, listing every face's world (served even when stopped) |
| `GET /privacy` | the manifest's `privacy_url` (served even when stopped) |
| `GET /v1/health` | `{"ok":true,"stopped":false}` |
| `POST /v1/faces/<face>/<op>` | a room's view, in the AB1 line format (`src/wire.ts`); Mission Control's ops are `view`, `press`, `signin`, `watch` and `pair` (API.md section 5) |
| `POST /v1/session` | `{"passphrase"}` -> `{"token","expires_in"}` |
| `POST /v1/session/end` | `{"tok"}` |
| `POST /v1/jobs` | `{"tok"}` -> jobs, pending approvals, projects |
| `POST /v1/jobs/start` | `{"tok","preset","project"}` (presets: tests, prs, today, notes) |
| `POST /v1/jobs/new` | `{"tok","text","project"}` |
| `POST /v1/jobs/<id>/events` | `{"tok","since"}` -> events with `seq > since` (an event that grows keeps its `id` and gets a new `seq`) |
| `POST /v1/jobs/<id>/message` | `{"tok","text"}` |
| `POST /v1/jobs/<id>/stop` | `{"tok"}` |
| `POST /v1/approvals/<id>/decide` | `{"tok","decision":"approve"\|"deny"\|"why"}` |

Every authenticated call is a POST with the token in the body, because a world can't set headers.

## Adding a room (a face)

Add `src/faces/<name>/index.ts` whose default export is a `Face` (`src/faces/types.ts`). The registry
loads every face folder; nothing else changes. The server does auth, limits, the stop and the
Host/Origin checks before a face runs, and passes `ctx.authed`; a face acts only through
`ctx.bridge.actions`.

## Security (DB-044 has the reasoning)

| Threat | What v1 does |
|---|---|
| The headset sends no identity; `X-World-Address` is forgeable | The passphrase is the only key. The header is still required on face routes (a seat belt, not a lock) |
| The tunnel puts the bridge on the internet | Loopback bind; Host allowlist (DNS rebinding); any `Origin`, `Cookie` or `Referer` refused (no web page can drive it); 16 KiB bodies; a global rate limit |
| Passphrase guessing | scrypt hash; one attempt per 2 s; 5 wrong = 15 min lock; 10 wrong in 24 h = locked until `npm run unlock` (global, so a stranger can lock the CEO out, never in). The Pairing Seal still signs the CEO in under the lock, and `passphraseSignIn: false` turns typed passphrases off |
| A stranger at the seal (the Pairing Seal) | Approval is **local only**: no HTTP route approves (a test walks every route); the console and `npm run approve` are the only approvers. The console never prints the code, so the CEO types the code off HIS ring. 120 s life, single use, up to 16 pairings keyed by id (a code approves only its own; at 6 mints a minute and 3 s apart at most 12 are ever alive, so a stranger pressing the seal never evicts the CEO's pairing inside its life), five wrong codes in a row cancel every waiting one, constant-time compare, the kill switch clears them. Residual risk: a bot minting at the cap uses up the mint rate, so the CEO's own press can be refused ("wait a few seconds"); a nuisance, never a sign-in, and the passphrase fallback stays. Watchers see nothing of pairing. No code, id or token in any log |
| A stolen token | 30 min idle / 8 h absolute; one sign-in at a time; never logged; only its SHA-256 is kept |
| "Run this text as a shell command" | No such verb. Typed text is a prompt; Claude Code's permission rules decide what runs |
| Commands the CEO's settings pre-allow (131 rules in the Kosmos Project, incl. `Bash(powershell:*)`, `Bash(curl:*)`) | The headset policy: `managedSettings.permissions.ask` = `Bash`, `PowerShell`, and `Edit(...)` rules for `.claude/`, `.git/`, `.githooks/`, `.husky/`, `.vscode/`, `.devcontainer/`, `.mcp.json`, `.claude.json` and `.envrc` (`DEFAULT_ALWAYS_ASK` in `src/adapters/claude.ts`), so every shell command, and every edit to config that runs code by itself, asks on the wall (ask beats allow). Verified live: a pre-allowed `node --version` ran with no approval under the CEO's rules and raised one approval under the policy; an allowed Write ran unasked while a Write into `.claude/` asked once. `alwaysAsk` in config.json REPLACES the whole list (`[]` turns the policy off and drops the Edit rules too); the bridge's own desk-only check for those files stays either way |
| Approving something unseen | An approval is approvable from the headset (the ask plate or the puck) only if its whole command is on show and nothing was redacted; the puck shows one line, `<project>: <verb> <command>`, and says "open its cube" otherwise; a press names the snapshot version, and a version changes whenever what a press means changes, so it can't land on a changed approval |
| Prompt injection in agent output | Agent text only ever appears on conversation lines behind "Claude:"; headers, buttons, statuses, the ticker and the approval panel are the bridge's own words; control, bidi and zero-width characters stripped; the bridge's markers can't be forged |
| Data leaving the PC | Summaries only; secrets redacted; the tunnel provider can read traffic (TLS ends at its edge) |
| Something goes wrong | `npm run kill`: refuses everything, denies every approval, stops every job, ends the sign-in |

## Tests

`npm test`: 97 tests (sanitizing, auth and lockout, jobs and approvals, the HTTP surface and kill
switch, the Mission Control v2 face end to end with the fake adapter (lock, cubes, the arc, the puck,
watchers), the Pairing Seal (one test per threat-model line, the local approvers, the flow over HTTP,
and a walk of every route proving none approves), the Claude adapter against a scripted SDK, face
discovery, the node contract (nodes.json byte for byte), the relay Worker in front of a live bridge).
One test (a symlinked PAIR_APPROVE) skips on an account that can't make symlinks.
`node scripts/capture-review-snapshots.mjs` (after `npm run build`) writes the six v2 review snapshots
to `../mission-control/review/` from the real face; `node scripts/write-nodes-json.mjs` rewrites
`../mission-control/nodes.json` from `layout.ts`. A live run against the real SDK turned one real
Claude Code permission prompt into one approval and got the answer back (2026-10-14).
