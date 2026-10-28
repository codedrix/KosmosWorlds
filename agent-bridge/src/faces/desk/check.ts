/**
 * faces/desk/check.ts -- `npm run desk-check -- [file]`: what the board would show for a snapshot file.
 *
 * @kosmos-system  Agent bridge (Kosmos Desk face, read-only)
 * @kosmos-owner   Platform
 *
 * For the hub session that writes the file (SCHEMA.md) and for the CEO: prints the AB1 records
 * the face would send the headset now, and exits 1 when the board would say "Desk offline".
 * Reads the file only; starts no server and touches no bridge setting.
 */

import { deskFile, parseDesk, readDeskFile, renderBoard } from "./core.js";

const file = process.argv[2] ?? deskFile();
const now = Date.now();
const got = await readDeskFile(file);
const read = got.ok ? parseDesk(got.text, now) : { state: "offline" as const, why: got.why };
process.stdout.write(`${file}: ${read.state === "ok" ? `${read.total} card(s), ${read.cards.length} shown` : `offline (${read.why})`}\n`);
process.stdout.write(renderBoard(read, now).toString());
process.exitCode = read.state === "ok" ? 0 : 1;
