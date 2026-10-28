# The Kosmos Desk snapshot file (`desk.json`)

The hub session that keeps the CEO's Kosmos Desk artifact current writes this file. The agent
bridge's `desk` face reads it when the Lobby asks (`POST /v1/faces/desk/board`), and the board
beside the throne in `world://lobby.micknerks` shows it. The bridge never reads the artifact's
database and never signs in anywhere to get it: this file is the only way in.

## Where

`E:\Kosmos_Desk\desk.json` on the CEO's PC. Set `KOSMOS_DESK_FILE` in the bridge's environment to
use another path; the bridge's `config.json` is not involved. The folder is outside `%APPDATA%` on
purpose: an agent's sandboxed shell can't write `%APPDATA%` for real.

Write it atomically: write `desk.json.tmp` beside it, then rename it over `desk.json`. The face
reads the whole file on every request, so it must never find half a file.

## Shape

```json
{
  "updatedAt": "2026-10-28T16:05:00Z",
  "cards": [
    { "key": "merge-portal-legal", "title": "Merge the portal legal links fix", "session": "hub", "day": "2026-10-28" }
  ]
}
```

| Field | Type | Rule |
|---|---|---|
| `updatedAt` | string | When the hub last wrote the file. ISO 8601 with a zone (`Z` or `+01:00`). Write it every time, even if no card changed. |
| `cards` | array | The **Needs you** cards only, most urgent first. At most **8**. |
| `cards[].key` | string | A stable id for the card: 1 to 64 of `A-Z a-z 0-9 . _ : -`. Never shown. A card whose key repeats an earlier one is dropped. |
| `cards[].title` | string | What the CEO must decide, in plain words, **at most 40 characters**. |
| `cards[].session` | string | Which agent session is waiting, as the Desk names it (`hub`, `client`), at most 24 characters. |
| `cards[].day` | string | The day the card was raised, `YYYY-MM-DD`. The board says "today", "yesterday" or "Oct 26". |

Nothing else. In particular **no links, no PR or issue numbers, no branch names, no commands, no
file paths, no keys or tokens**, and no text copied from a PR body, a comment or a page: only words
the hub wrote itself. The headset is not a secure screen, and the words pass through the relay.

## What the board does with it

The face trusts nothing in the file. Before anything reaches the headset it:

- refuses a file over 16 KiB unread, and reads only the first 64 cards;
- cuts `title` to 40 characters and `session` to 24, makes them plain ASCII on one line, removes
  control characters, links (`https://...`, `www....`) and `#123`-style numbers, and replaces key
  shapes with `[redacted]` (the bridge's `cleanUntrusted`);
- drops a card with no usable `key` or `title`, and ignores a `day` that is not a real date;
- shows at most 8 cards; with more, the heading says "8 of 11 waiting on you";
- cuts a line that is still too wide for the board (1.5 m of 8 cm text) at the title, never at
  the session or day.

It shows **Desk offline** instead of any card when the file is missing, unreadable, over 16 KiB,
not JSON of this shape, stamped more than 5 minutes in the future, or older than **15 minutes**
("Desk offline: no update for 40 min"). An empty `cards` array is not offline: the board says
"Nothing is waiting on you".

## Check a file

From `agent-bridge/` after `npm run build`:

```
npm run desk-check -- E:\Kosmos_Desk\desk.json
```

It prints the board exactly as the headset would get it, and exits 1 if the board would say
"Desk offline".

Example: `desk.example.json` beside this file.
