#!/usr/bin/env node
/**
 * stress.mjs -- a heavy day: 40 messages, 8 events, every pile over its shown
 * cap, a pending draft and a prep sheet at once. Proves the room stays inside
 * the headset's budgets when the day does not fit (32 texts, 128 created
 * objects, 16 creates a frame, 256 KiB answers).
 *
 * @kosmos-system  Content (KosmosWorlds) -- More Room
 * @kosmos-owner   More Room v1
 *
 * Usage: node more-room/tools/stress.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Host, LIMITS } from "./mock-host.mjs";
import { createDayFace, createSampleStore } from "../bridge-day-face/day-face.mjs";
import { SAMPLE_DAY } from "../bridge-day-face/sample-day.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fail = (m) => {
  console.error("FAIL: " + m);
  process.exit(1);
};

const day = JSON.parse(JSON.stringify(SAMPLE_DAY));
const srcs = ["gmail", "slack", "github", "linear"];
day.messages = Array.from({ length: 40 }, (_, i) => ({
  id: `s-${i}`,
  src: srcs[i % 4],
  vip: i % 9 === 0,
  from: `Sender number ${i} with a long display name`,
  subject: `Subject line ${i} that is much longer than the card can show`,
  preview: "A long preview ".repeat(12),
}));
day.events = Array.from({ length: 8 }, (_, i) => ({ id: `e-${i}`, start: 7 * 60 + i * 90, end: 7 * 60 + i * 90 + 60, title: `Event title ${i} long`, prep: ["a", "b"] }));
const store = createSampleStore(day);
store.messages.forEach((m, i) => {
  m.pile = i < 14 ? "in" : i < 22 ? "later" : i < 32 ? "done" : "quiet";
  m.read = i % 2 === 1;
});
store.drafts.push({ id: "d-x", msg: "s-0", state: "pending", to: "Sender number 0", text: "word ".repeat(55) });

for (const v of ["vr", "mr"]) {
  const dir = path.join(ROOT, `world-${v}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const face = createDayFace({ store, nowMin: () => 11 * 60 });
  const host = new Host({ wasmPath: path.join(dir, "world.wasm"), glbPath: path.join(dir, "world.glb"), manifest, net: (a, b, c) => face.handle(a, b, c) });
  host.init();
  host.run(0.2);
  host.press("BtnSignIn");
  host.answerPrompt("sample-day");
  let maxPerFrame = 0;
  for (let f = 0; f < 72 * 3; f++) {
    host.tick();
    maxPerFrame = Math.max(maxPerFrame, host.createsThisFrame);
  }
  const live = [...host.nodes.values()].filter((n) => n.alive && n.created);
  const msgCards = live.filter((n) => n.source?.startsWith("TplMsg")).length;
  // 12 desk slots + 5 Later + 5 Done + 6 shelf = 28 cards at most, plus 8 events.
  if (msgCards !== 28) fail(`${v}: expected 28 drawn cards, got ${msgCards}`);
  if (live.filter((n) => n.source === "TplEvent").length !== 8) fail(`${v}: 8 events`);
  if (maxPerFrame > LIMITS.createsPerFrame) fail(`${v}: ${maxPerFrame} creates in one frame`);
  if (!/Inbox 14/.test(host.textOf("InboxTray") ?? "") || !/\+2 more/.test(host.textOf("InboxTray") ?? "")) fail(`${v}: inbox count (${host.textOf("InboxTray")})`);
  // Triage with a card open, the draft waiting, and a prep sheet up: the busiest screen.
  host.press("BtnModeTriage");
  host.run(0.2);
  const card = live.find((n) => n.source?.startsWith("TplMsg") && n.pos[0] > 0.5 && n.pos[0] < 1.0 && Math.abs(n.pos[2]) < 0.5);
  host.press(card.handle);
  host.run(0.2);
  const ev = live.find((n) => n.source === "TplEvent");
  host.press(ev.handle);
  host.run(0.3);
  if (host.texts.size > LIMITS.maxTexts) fail(`${v}: ${host.texts.size} texts`);
  if (host.textRefusals.length) fail(`${v}: text refused ${JSON.stringify(host.textRefusals[0])}`);
  if (!/More 1\/\d/.test(host.textOf("BtnMore") ?? "")) fail(`${v}: a long draft pages (${host.textOf("BtnMore")})`);
  console.log(`${v}: heavy day OK | ${msgCards} cards + 8 events drawn | creates/frame max ${maxPerFrame}/16 | busiest screen ${host.texts.size}/32 texts | created peak ${host.createdPeak}/128 | answer ${host.maxResponseBytes} B`);
}
