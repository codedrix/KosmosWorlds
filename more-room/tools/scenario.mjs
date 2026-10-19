#!/usr/bin/env node
/**
 * scenario.mjs -- the sample day, pressed through end to end, on both worlds.
 *
 * @kosmos-system  Content (KosmosWorlds) -- More Room
 * @kosmos-owner   More Room v1 (design session 2026-10-14)
 *
 * Usage:  node --experimental-strip-types more-room/tools/scenario.mjs [--snapshots] [--packaged]
 *
 * Part 1 runs the room on its built-in sample day (no request at all), the About
 * panel included; part 2 signs in and runs the live day.
 * Runs the built world-vr/world.wasm and world-mr/world.wasm in mock-host.mjs
 * against the mock bridge (bridge-day-face/mock-bridge.mjs, in process, running the
 * real face logic agent-bridge/src/faces/more-room/day-core.ts), presses
 * through all four modes, and fails on the first broken promise. With
 * --snapshots it writes renders/state-<vr|mr>-<mode>.json, which
 * render_modes.py turns into the lit renders.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Host, LIMITS } from "./mock-host.mjs";
import { createMockBridge, LIMITS as BRIDGE } from "../bridge-day-face/mock-bridge.mjs";
import { LAYOUT } from "./build_glb.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SNAP = process.argv.includes("--snapshots");
/** --packaged: run against the optimized scene inside dist/more-room-<v>.worldbundle (extract with tools/extract_scene.mjs). */
const PACKAGED = process.argv.includes("--packaged");
let checks = 0;

function ok(cond, what) {
  checks++;
  if (!cond) {
    console.error(`FAIL: ${what}`);
    process.exitCode = 1;
    throw new Error(what);
  }
}

/** layout.rs must say what build_glb.mjs says. */
function checkLayoutMirror() {
  const rs = fs.readFileSync(path.join(ROOT, "script/src/layout.rs"), "utf8");
  const num = (name) => Number(rs.match(new RegExp(`pub const ${name}: f32 = ([-0-9.]+)`))[1]);
  const arr = (name) => rs.match(new RegExp(`pub const ${name}: \\[f32; \\d+\\] = \\[([^\\]]+)\\]`))[1].split(",").map(Number);
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  ok(near(num("CARD_Y"), LAYOUT.cardY), "layout: CARD_Y");
  ok(arr("GRID_COLS").every((v, i) => near(v, LAYOUT.gridCols[i])), "layout: GRID_COLS");
  ok(arr("GRID_ROWS").every((v, i) => near(v, LAYOUT.gridRows[i])), "layout: GRID_ROWS");
  for (const [rsName, js] of [["INBOX", LAYOUT.inbox], ["PILE_LATER", LAYOUT.pileLater], ["PILE_DONE", LAYOUT.pileDone]]) {
    ok(arr(rsName).every((v, i) => near(v, js[i])), `layout: ${rsName}`);
  }
  ok(arr("SHELF_SLOTS").every((v, i) => near(v, LAYOUT.shelfSlots[i])), "layout: SHELF_SLOTS");
  for (const [rsName, js] of [["SHELF_X", LAYOUT.shelfX], ["SHELF_Y", LAYOUT.shelfY], ["CAL_X", LAYOUT.calX], ["CAL_Y", LAYOUT.calY], ["CAL_Z0", LAYOUT.calZ0], ["CAL_Z_PER_HOUR", LAYOUT.calZPerHour]]) {
    ok(near(num(rsName), js), `layout: ${rsName}`);
  }
}

function runVariant(variant) {
  const dir = path.join(ROOT, `world-${variant}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  let clock = 10 * 60 + 5; // 10:05, before the counsel call
  let host = null;
  const bridge = createMockBridge({ passphrase: "sample-day", nowMin: () => clock, nowMs: () => 1.7e12 + (host ? host.time * 1000 : 0), dev: true });
  const face = { store: bridge.store, log: bridge.core.log };
  const addr = { "x-world-address": `${manifest.world.id}.${manifest.world.author}` };
  const arrive = () => bridge.handle("POST", "/v1/faces/more-room/arrive", Buffer.from("{}"), addr);
  host = new Host({
    wasmPath: path.join(dir, "world.wasm"),
    glbPath: PACKAGED ? path.join(ROOT, "dist", `scene-${variant}.glb`) : path.join(dir, "world.glb"),
    manifest,
    net: (method, p, body, headers) => bridge.handle(method, p, body, headers),
  });
  const snap = (mode) => {
    if (!SNAP) return;
    const out = path.join(ROOT, "renders", `state-${variant}-${mode}.json`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ variant, mode, ...host.scene() }, null, 1));
  };
  const textsOk = (where) => {
    ok(host.texts.size <= LIMITS.maxTexts, `${variant} ${where}: ${host.texts.size} texts > 32`);
    ok(host.textRefusals.length === 0, `${variant} ${where}: text refused ${JSON.stringify(host.textRefusals.slice(0, 3))}`);
  };
  const isCard = (n) => n.alive && n.created && n.source?.startsWith("TplMsg");
  const cardsAt = (pred) => [...host.nodes.values()].filter((n) => isCard(n) && pred(n));
  const onDesk = (n) => n.pos[0] > 0.42 && n.pos[0] < 1.12 && Math.abs(n.pos[2]) < 0.95 && n.pos[1] > 0.7 && n.pos[1] < 0.9;
  const inGrid = (n) => onDesk(n) && Math.abs(n.pos[2]) < 0.6 && Math.abs(n.pos[1] - LAYOUT.cardY) < 1e-4;
  const onTray = (n) => Math.abs(n.pos[0] - LAYOUT.inbox[0]) < 1e-4 && Math.abs(n.pos[2] - LAYOUT.inbox[2]) < 1e-4;
  const events = () => [...host.nodes.values()].filter((n) => n.alive && n.source === "TplEvent");
  const status = () => host.textOf("TxtStatus") ?? "";

  // ---------------------------------------------------------------------------
  // Part 1: the built-in sample day. No PC, no bridge, no sign-in, and no request.
  // ---------------------------------------------------------------------------
  ok(!host.imports.some((i) => /k_player_get_/.test(i.name)), "no player_read import");
  host.init();
  host.run(0.5);
  textsOk("sample, morning");
  ok(host.textOf("TxtBanner") === "SAMPLE DAY: nothing here is real yet", `the sample banner shows (${host.textOf("TxtBanner")})`);
  ok(host.textOf("BtnSignIn") === "Owner sign in" && host.textOf("BtnAbout") === "About", "Owner sign in and About are labelled");
  ok((host.textOf("TxtStage") ?? "").startsWith("3 things need you today"), `the brief is on the stage (${host.textOf("TxtStage")})`);
  ok(/^30 messages, 2 from VIPs\nTasks: 8 to do, 3 doing, 5 done$/.test(host.textOf("TxtStageLow") ?? ""), `messages and tasks are counted (${host.textOf("TxtStageLow")})`);
  ok(/Answer counsel/.test(host.textOf("TaskA") ?? ""), "the first pinned task (a doing one)");
  ok(/Sample day/.test(status()), `the status says it is a sample (${status()})`);
  ok(cardsAt(inGrid).length === 12, `twelve cards on the desk (${cardsAt(inGrid).length})`);
  ok(cardsAt(onTray).length === 3, `three waiting on the inbox tray (${cardsAt(onTray).length})`);
  ok(/Inbox 30\n2 VIP\n\+15 more$/.test(host.textOf("InboxTray") ?? ""), `the inbox counts the rest (${host.textOf("InboxTray")})`);
  ok(events().length === 10, `ten events on the strip (${events().length})`);
  const labelled = events().filter((e) => host.texts.has(e.handle)).length;
  ok(labelled === 5, `five event labels around now, the budget (${labelled})`);
  ok(events().every((n) => Math.abs(n.pos[0] - LAYOUT.calX) < 1e-6 && n.pos[2] >= -2.2 && n.pos[2] <= 2.3), "events sit on the strip");
  const now = host.byName.get("NowLine");
  ok(Math.abs(now.pos[2] - (LAYOUT.calZ0 + ((10 * 60 + 5 - 420) / 60) * LAYOUT.calZPerHour)) < 1e-4, "the now line is at 10:05");
  ok(host.byName.get("PaneDay").visible && !host.byName.get("PaneNight").visible, "the window shows day at 10:05");
  snap("morning");

  // Prep, from the sample itself.
  const counsel = events()[2];
  host.press(counsel.handle);
  host.run(0.2);
  ok(/Counsel call 10:30/.test(host.textOf("TxtStage") ?? ""), `prep shows on the stage (${host.textOf("TxtStage")})`);
  ok(host.textOf("BtnPrepClose") === "Close", "prep has a Close");
  textsOk("sample prep");
  snap("prep");
  host.press("BtnPrepClose");
  host.run(0.1);

  // About: seven short pages, each whole, then closed.
  host.press("BtnAbout");
  host.run(0.1);
  textsOk("about");
  ok(/rectangle/.test(host.textOf("TxtAbout") ?? ""), `About opens on what the room is (${host.textOf("TxtAbout")})`);
  ok(host.textOf("BtnAboutNext") === "Next 1/7" && host.textOf("BtnAbout") === "Close about", "About has Next and Close about");
  ok(host.textOf("TxtStage") === undefined && host.textOf("TxtOpen") === undefined, "About clears the walls");
  ok(host.textOf("TxtBanner") !== undefined, "the sample banner stays while About is open");
  snap("about");
  const pages = [];
  for (let p = 0; p < 7; p++) {
    pages.push(host.textOf("TxtAbout") ?? "");
    host.press("BtnAboutNext");
    host.run(0.05);
  }
  ok(host.textOf("BtnAboutNext") === "Next 1/7", "Next comes round to the first page");
  ok(pages.every((t) => t.length > 0 && !t.endsWith("...") && t.split("\n").length <= 4), `every About page is whole (${JSON.stringify(pages)})`);
  ok(/SAMPLE DAY/.test(pages[1]) && /never sees the mail/.test(pages[4]) && /iPhone/.test(pages[5]) && /room permission/.test(pages[6]), "About says sample, how it connects, your steps, and what is coming");
  host.press("BtnAbout");
  host.run(0.1);
  ok(host.textOf("TxtAbout") === undefined && (host.textOf("TxtStage") ?? "").startsWith("3 things"), "Close about restores the room");

  // Focus on the first pinned task.
  host.press("TaskA");
  host.run(0.2);
  textsOk("sample focus");
  ok(/Answer counsel on terms/.test(host.textOf("TxtStage") ?? ""), "focus: the task is large on the stage");
  ok(/25:00/.test(host.textOf("TxtStageLow") ?? ""), `focus: the timer reads 25:00 (${host.textOf("TxtStageLow")})`);
  ok(["VeilCal", "VeilWindow", "VeilTasks", "VeilDesk"].every((v) => host.byName.get(v).visible), "focus: the veils dim the rest");
  ok(events().every((e) => !host.texts.has(e.handle)), "focus: event labels are hidden");
  ok(/Next: 10:30 Counsel call/.test(host.textOf("TxtNext") ?? ""), `focus: only the next event shows (${host.textOf("TxtNext")})`);
  host.press("BtnFocusGo");
  host.run(3.1);
  ok(/24:5[67] +focus/.test(host.textOf("TxtStageLow") ?? ""), `focus: the timer runs (${host.textOf("TxtStageLow")})`);
  snap("focus");

  // Triage, all local: turn, reply, approve, task, done, later, mute.
  host.press("BtnModeTriage");
  host.run(0.2);
  textsOk("sample triage");
  const vip = cardsAt((n) => n.source === "TplMsgVip" && inGrid(n))[0];
  ok(vip, "a VIP card is on the desk");
  host.press(vip.handle);
  host.run(0.2);
  ok(/^(Dana Whitfield|Sam Okoro) \(VIP\)/.test(host.textOf("TxtOpen") ?? ""), `the card is turned over (${host.textOf("TxtOpen")})`);
  ok(["BtnDone", "BtnLater", "BtnReply", "BtnTask", "BtnMute"].every((b) => host.byName.get(b).visible), "the five actions show");
  host.press("BtnReply");
  host.run(0.2);
  ok(/^Draft to (Dana|Sam)/.test(host.textOf("TxtDraft") ?? ""), `the sample's draft waits on the side table (${host.textOf("TxtDraft")})`);
  ok(/Draft ready/.test(status()), `the status says so (${status()})`);
  textsOk("sample triage with a draft");
  snap("triage");
  // Deny, then draft again: the new draft has its own id and Approve clears it (review lens A, MED-2).
  host.press("BtnDeny");
  host.run(0.2);
  ok(/Draft discarded/.test(status()) && host.textOf("TxtDraft") === undefined, `Deny clears the side table (${status()})`);
  host.press(cardsAt((n) => n.source === "TplMsgRead" && inGrid(n))[0].handle);
  host.run(0.2);
  host.press("BtnReply");
  host.run(0.2);
  ok(/^Draft to/.test(host.textOf("TxtDraft") ?? ""), "a second draft waits");
  host.press("BtnApprove");
  host.run(0.7);
  ok(/Sent \(sample/.test(status()), `Approve, in the sample, sends nothing and says so (${status()})`);
  ok(host.textOf("TxtDraft") === undefined, "the side table is clear after Approve");
  const deskCard = () => cardsAt(inGrid)[0];
  host.press(deskCard().handle);
  host.run(0.2);
  host.press("BtnTask");
  host.run(0.2);
  ok(/KOS-SAMPLE-17 made\s\(sample\)/.test(status()), `Make a task says what it made (${status()})`);
  host.press("BtnDone");
  host.run(0.6);
  host.press(deskCard().handle);
  host.run(0.2);
  host.press("BtnLater");
  host.run(0.6);
  host.press(deskCard().handle);
  host.run(0.2);
  host.press("BtnMute");
  host.run(0.8);
  const later = cardsAt((n) => Math.abs(n.pos[2] - LAYOUT.pileLater[2]) < 0.01 && Math.abs(n.pos[0] - LAYOUT.pileLater[0]) < 0.01);
  const done = cardsAt((n) => Math.abs(n.pos[2] - LAYOUT.pileDone[2]) < 0.01);
  const shelf = cardsAt((n) => Math.abs(n.pos[0] - LAYOUT.shelfX) < 0.01);
  ok(later.length === 1, `Later: one card on the Later pile (${later.length})`);
  ok(done.length === 2, `Done: the approved one and the done one (${done.length})`);
  ok(shelf.length === 1, `Mute: one card on the quiet shelf behind you (${shelf.length})`);
  ok(/Quiet shelf: 1/.test(host.textOf("TxtQuiet") ?? ""), "the quiet shelf counts it");
  ok(cardsAt(inGrid).length === 12, `a waiting card moved up to fill the desk (${cardsAt(inGrid).length})`);
  textsOk("sample triage after the actions");
  snap("triage-after");

  // Wrap-up.
  host.press("BtnModeWrap");
  host.run(0.2);
  textsOk("sample wrap-up");
  ok(/^Done: 5 tasks, 2 messages\n- Cook ledger row\n- Sign the office lease\nPress a task to roll it$/.test(host.textOf("TxtStage") ?? ""), `wrap-up: what got done (${host.textOf("TxtStage")})`);
  ok(/First tomorrow:\nSend the tester invites at 9/.test(host.textOf("TxtStageLow") ?? ""), "wrap-up: the first thing tomorrow");
  ok(/^Roll:/.test(host.textOf("TaskA") ?? ""), "wrap-up: open tasks offer to roll");
  host.press("TaskA");
  host.run(0.2);
  ok(/Rolled/.test(status()), "wrap-up: pressing a task rolls it");
  snap("wrap");
  ok(host.requests.length === 0, `the sample made no request at all (${host.requests.length})`);

  // ---------------------------------------------------------------------------
  // Part 2: signing in to the bridge, and the live day.
  // ---------------------------------------------------------------------------
  host.press("BtnModeMorning");
  host.press("BtnSignIn");
  ok(host.prompt?.text.includes("passphrase"), "the sign-in sheet opens on the press");
  host.answerPrompt("wrong");
  host.run(0.3);
  ok(/Wrong passphrase/.test(status()), `wrong passphrase is said (${status()})`);
  ok(host.requests.at(-1).url.endsWith("/v1/faces/more-room/signin"), "sign-in goes to the face's signin op (the bridge's one session)");
  host.press("BtnSignIn");
  host.answerPrompt("sample-day");
  host.run(0.3);
  ok(/every 2 seconds/.test(status()), `too fast is said (${status()})`);
  host.run(2.0);
  host.press("BtnSignIn");
  host.answerPrompt("sample-day");
  host.run(1.0);
  ok(host.textOf("BtnSignIn") === undefined && !host.byName.get("BtnSignIn").visible, "signed in: Sign in is gone");
  const firstPoll = host.requests.find((r) => r.url.endsWith("/v1/faces/more-room/changes"));
  ok(firstPoll && JSON.parse(firstPoll.body).since === 0, "the first poll asks for everything (since 0)");
  ok(host.requests.filter((r) => r.body.includes("sample-day")).every((r) => r.url.endsWith("/signin")), "the passphrase goes only to signin");
  ok(host.requests.filter((r) => !r.url.endsWith("/signin")).every((r) => typeof JSON.parse(r.body).tok === "string"), "every other call carries tok in the body");
  host.run(0.5);
  textsOk("live morning");
  ok(/Signed in/.test(status()), `sign-in is confirmed (${status()})`);
  host.run(10); // "Signed in." is held for 10 s, then the live status takes over
  ok(/Live/.test(status()), `the status says live (${status()})`);
  // A cut answer: the room keeps its day, says so, and recovers on the next poll (review lens A, MED-1).
  const inboxBefore = host.textOf("InboxTray");
  // Move the day on the bridge (a Done made elsewhere), then cut the answer that carries it.
  bridge.core.handle("act", { op: "done", id: "m-ad" }, true, { signIn: () => ({ ok: false, reason: "wrong" }) });
  bridge.cutNextAnswer();
  host.run(4.6);
  ok(/cannot read/.test(status()), `a cut answer is said (${status()})`);
  ok(host.textOf("InboxTray") === inboxBefore, `a cut answer leaves the day as it was (${host.textOf("InboxTray")})`);
  host.run(4.6);
  ok(/^Inbox 29/.test(host.textOf("InboxTray") ?? ""), `the next poll brings the whole day (${host.textOf("InboxTray")})`);
  host.run(10);
  ok(cardsAt(inGrid).length === 12 && cardsAt(onTray).length === 3, "the bridge's day fills the desk and the tray");

  // Focus while messages arrive: silent, face-down, on the tray; a VIP ticks once.
  host.press("TaskA");
  host.run(0.2);
  const soundsBefore = host.sounds.length;
  const trayBefore = cardsAt(onTray).map((n) => n.handle);
  arrive();
  host.run(4.6);
  const trayNow = cardsAt(onTray);
  ok(trayNow.length === 3 && trayNow.some((n) => !trayBefore.includes(n.handle)), "a new message lands on top of the inbox tray");
  ok(host.sounds.length === soundsBefore, "focus: a normal message makes no sound");
  arrive();
  host.run(4.6);
  ok(host.sounds.length === soundsBefore + 1 && host.sounds.at(-1).at === "InboxTray", `focus: a VIP ticks once, from the tray (${JSON.stringify(host.sounds)})`);
  ok(/VIP: Dana Whitfield/.test(host.textOf("TxtVip") ?? ""), `focus: the VIP line names the sender (${host.textOf("TxtVip")})`);
  textsOk("live focus with a VIP");

  // Live triage: a draft from the bridge, approved through the bridge.
  host.press("BtnModeTriage");
  host.run(0.2);
  // The desk kept its cards through sign-in; unread VIPs wait on top of the inbox tray.
  const vipLive = cardsAt((n) => n.source === "TplMsgVip" && (inGrid(n) || onTray(n)));
  ok(vipLive.length >= 2 && vipLive.some(onTray), `live: the unread VIPs are in view, on the tray (${vipLive.length})`);
  // A stack is pressed from the top, and the most important card is on top.
  const top = vipLive.reduce((hi, n) => (n.pos[1] > hi.pos[1] ? n : hi));
  host.press(top.handle);
  host.run(0.2);
  ok(host.requests.some((r) => JSON.parse(r.body).op === "turn"), "live: the turn is sent");
  host.press("BtnReply");
  host.run(4.6);
  ok(/^Draft to (Dana|Sam)/.test(host.textOf("TxtDraft") ?? ""), `live: the bridge's draft waits (${host.textOf("TxtDraft")})`);
  ok(!face.log.some((l) => l.op === "approve"), "nothing is approved without the press");
  host.press("BtnApprove");
  host.run(4.8);
  ok(face.log.some((l) => l.op === "approve"), "Approve reached the bridge");
  ok(face.store.drafts.at(-1).state === "sent", "the bridge marks it sent (mock)");
  textsOk("live triage");

  // The bridge signs the room out: it says so, stops polling, and shows the sample again.
  bridge.handle("POST", "/v1/session/end", Buffer.from(JSON.stringify({ tok: faceTokens(host)[0] })), addr);
  host.run(4.6);
  ok(/Sign\sin again/.test(status()), `a 401 signs the room out, out loud (${status()})`);
  ok(host.textOf("TxtBanner") === "SAMPLE DAY: nothing here is real yet" && host.textOf("BtnSignIn") === "Owner sign in", "signed out: back to the sample, with Owner sign in");
  const n0 = host.requests.length;
  host.run(10);
  ok(host.requests.length === n0, "signed out: polling stops");

  // Network off: said, never a crash.
  host.netAvailable = false;
  host.press("BtnSignIn");
  host.answerPrompt("sample-day");
  host.run(1);
  ok(/Network is off/.test(status()), `network off is said (${status()})`);

  // The headset's budgets over the whole run.
  ok(host.textPeak <= LIMITS.maxTexts, `peak texts ${host.textPeak} <= 32`);
  ok(host.createdPeak <= LIMITS.maxCreated, `peak created objects ${host.createdPeak} <= 128`);
  ok(host.maxRequestBytes <= LIMITS.requestBytes, `largest request ${host.maxRequestBytes} B <= 16 KiB`);
  ok(host.maxResponseBytes <= BRIDGE.responseMaxBytes, `largest answer ${host.maxResponseBytes} B <= 256 KiB`);
  ok(!host.netRefusals.some((r) => r.rc === -6), `never rate-limited (${JSON.stringify(host.netRefusals.filter((r) => r.rc === -6))})`);
  const polls = host.requests.filter((r) => r.url.endsWith("/changes"));
  console.log(
    `${variant}: ${checks} checks so far | texts peak ${host.textPeak}/32 | created peak ${host.createdPeak}/128 | ` +
      `${host.requests.length} requests (${polls.length} polls) | largest request ${host.maxRequestBytes} B, answer ${host.maxResponseBytes} B`,
  );
}

/** The mock bridge's live session tokens (the harness reads them to act as the bridge would). */
function faceTokens(host) {
  const tokens = new Set();
  for (const r of host.requests) {
    try {
      const b = JSON.parse(r.body);
      if (b.tok) tokens.add(b.tok);
    } catch {}
  }
  return [...tokens].reverse();
}

checkLayoutMirror();
for (const v of ["vr", "mr"]) runVariant(v);
console.log(`PASS: ${checks} checks`);
