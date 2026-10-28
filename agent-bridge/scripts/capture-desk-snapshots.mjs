// Captures the Kosmos Desk board's review snapshots: the bodies the REAL desk face answers, written
// to ../mission-control/review/desk_<name>.snapshot for mission-control/blender/desk_review.py.
//
//   desk          the example file (src/faces/desk/desk.example.json), 3 minutes after its stamp
//   desk_full     eleven cards (eight shown, "8 of 11"), every title at the 40-character cap
//   desk_offline  no file at all
//
// Usage (after `npm run build`): node scripts/capture-desk-snapshots.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "..", "..", "mission-control", "review");
const { createDeskFace } = await import("../dist/src/faces/desk/index.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "desk-review-"));
const example = JSON.parse(fs.readFileSync(path.join(here, "..", "src", "faces", "desk", "desk.example.json"), "utf8"));
const at = Date.parse(example.updatedAt) + 3 * 60_000;
const titles = [
  "Merge the portal legal links and redirect",
  "Deploy the registry friends list endpoint",
  "Approve the TEST cook for both headsets",
  "Publish Lobby 1.5.0 unlisted from the PC",
  "Read the browser gap map and pick calls",
  "Sign the KOSMOS VR LLC banking paperwork",
  "Rotate the relay key after the alpha week",
  "Choose the alpha ring testers for Friday",
  "Review the thesis document's three lines",
  "Answer the Meta developer support ticket",
  "Check the Omni Demo world on the headset",
];
const full = {
  updatedAt: example.updatedAt,
  cards: titles.map((title, i) => ({ key: `card-${i + 1}`, title, session: ["hub", "registry", "client", "desk-board"][i % 4], day: "2026-10-28" })),
};

const shots = { desk: example, desk_full: full, desk_offline: null };
fs.mkdirSync(outDir, { recursive: true });
for (const [name, body] of Object.entries(shots)) {
  const file = path.join(tmp, `${name}.json`);
  if (body) fs.writeFileSync(file, JSON.stringify(body));
  const face = createDeskFace({ file: () => file, now: () => at });
  const reply = await face.handle("board", { tok: "" }, { authed: true, killed: false });
  if (reply.status !== 200) throw new Error(`${name}: ${reply.status}`);
  fs.writeFileSync(path.join(outDir, `${name}.snapshot`), reply.body);
  console.log(`wrote review/${name}.snapshot (${reply.body.length} B)`);
}
fs.rmSync(tmp, { recursive: true, force: true });
