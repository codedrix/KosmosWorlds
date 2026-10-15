#!/usr/bin/env node
/**
 * scenario.mjs -- the sample day, pressed through end to end, on both worlds.
 *
 * @kosmos-system  Content (KosmosWorlds) -- More Room
 * @kosmos-owner   More Room v1 (design session 2026-10-14)
 *
 * Usage:  node more-room/tools/scenario.mjs [--snapshots]
 *
 * Runs the built world-vr/world.wasm and world-mr/world.wasm in mock-host.mjs
 * against the mock bridge (bridge-day-face/day-face.mjs, in process), presses
 * through all four modes, and fails on the first broken promise. With
 * --snapshots it writes renders/state-<vr|mr>-<mode>.json, which
 * render_modes.py turns into the lit renders.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Host, LIMITS } from "./mock-host.mjs";
import { createDayFace, LIMITS as BRIDGE } from "../bridge-day-face/day-face.mjs";
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
  const face = createDayFace({ passphrase: "sample-day", nowMin: () => clock, dev: true });
  const host = new Host({
    wasmPath: path.join(dir, "world.wasm"),
    glbPath: PACKAGED ? path.join(ROOT, "dist", `scene-${variant}.glb`) : path.join(dir, "world.glb"),
    manifest,
    net: (method, p, body) => face.handle(method, p, body),
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
  const cardsAt = (pred) => [...host.nodes.values()].filter((n) => n.alive && n.created && n.source?.startsWith("TplMsg") && pred(n));
  const onDesk = (n) => n.pos[0] > 0.42 && n.pos[0] < 1.12 && Math.abs(n.pos[2]) < 0.95 && n.pos[1] > 0.7 && n.pos[1] < 0.9;

  // --- Every import is one the levels table knows, and none is player_read.
  ok(!host.imports.some((i) => /k_player_get_/.test(i.name)), "no player_read import");
  host.init();
  host.run(0.5);
  textsOk("signed out");
  ok(host.textOf("BtnSignIn") === "Sign in", "signed out: the Sign in button is labelled");
  ok(host.shownTexts().length === 2, `signed out: only the sign-in label and the status (${host.shownTexts().map((t) => t.name)})`);
  ok(host.requests.length === 0, "signed out: no request is made before sign-in");
  snap("signin");

  // --- A wrong passphrase.
  host.press("BtnSignIn");
  ok(host.prompt?.text.includes("passphrase"), "the sign-in sheet opens on the press");
  host.answerPrompt("wrong");
  host.run(0.3);
  ok(/Wrong passphrase/.test(host.textOf("TxtStage") ?? ""), `wrong passphrase is said (${host.textOf("TxtStage")})`);
  ok(host.requests.at(-1).url.endsWith("/day/v1/session"), "sign-in goes to /session");
  // The passphrase never appears in any later request.
  host.press("BtnSignIn");
  host.answerPrompt("sample-day");
  host.run(1.0);
  ok(host.textOf("BtnSignIn") === undefined, "signed in: the sign-in label is gone");
  const firstSnapshot = host.requests.find((r) => r.url.endsWith("/day/v1/changes"));
  ok(firstSnapshot && JSON.parse(firstSnapshot.body).since === 0, "the first poll asks for everything (since 0)");
  ok(!host.requests.slice(2).some((r) => r.body.includes("sample-day")), "the passphrase is sent once, to /session only");

  // --- Morning.
  host.run(0.5);
  textsOk("morning");
  ok((host.textOf("TxtStage") ?? "").startsWith("3 things need you today"), `morning: the brief is on the stage (${host.textOf("TxtStage")})`);
  ok(/7 messages, 1 from VIPs/.test(host.textOf("TxtStageLow") ?? ""), `morning: the message count (${host.textOf("TxtStageLow")})`);
  ok(/Approve counsel/.test(host.textOf("TaskA") ?? ""), "morning: the first pinned task");
  ok(/\[Morning\]/.test(host.textOf("BtnModeMorning") ?? ""), "morning: the mode bar marks Morning");
  const cards = cardsAt(() => true);
  ok(cards.length === 7, `seven cards (${cards.length})`);
  ok(cards.every(onDesk), "every card lies on the desk");
  const events = [...host.nodes.values()].filter((n) => n.alive && n.source === "TplEvent");
  ok(events.length === 5, `five events on the strip (${events.length})`);
  ok(events.every((n) => Math.abs(n.pos[0] - LAYOUT.calX) < 1e-6 && n.pos[2] >= -2.2 && n.pos[2] <= 2.3), "events sit on the strip");
  const now = host.byName.get("NowLine");
  ok(Math.abs(now.pos[2] - (LAYOUT.calZ0 + ((10 * 60 + 5 - 420) / 60) * LAYOUT.calZPerHour)) < 1e-4, "the now line is at 10:05");
  ok(host.byName.get("PaneDay").visible && !host.byName.get("PaneNight").visible, "the window shows day at 10:05");
  snap("morning");

  // --- Prep: press the counsel call.
  const counsel = events[1];
  host.press(counsel.handle);
  host.run(0.3);
  ok(/Counsel call 10:30/.test(host.textOf("TxtStage") ?? ""), `prep shows on the stage (${host.textOf("TxtStage")})`);
  ok(host.textOf("BtnPrepClose") === "Close", "prep has a Close");
  snap("prep");
  host.press("BtnPrepClose");
  host.run(0.1);

  // --- Focus: press the first pinned task.
  host.press("TaskA");
  host.run(0.2);
  textsOk("focus");
  ok(/Approve counsel/.test(host.textOf("TxtStage") ?? ""), "focus: the task is large on the stage");
  ok(/25:00/.test(host.textOf("TxtStageLow") ?? ""), `focus: the timer reads 25:00 (${host.textOf("TxtStageLow")})`);
  ok(["VeilCal", "VeilWindow", "VeilTasks", "VeilDesk"].every((v) => host.byName.get(v).visible), "focus: the veils dim the rest");
  ok(events.every((e) => !host.texts.has(e.handle)), "focus: event labels are hidden");
  ok(/Next: 10:30 Counsel call/.test(host.textOf("TxtNext") ?? ""), `focus: only the next event shows (${host.textOf("TxtNext")})`);
  host.press("BtnFocusGo");
  host.run(3.1);
  ok(/24:5[67] +focus/.test(host.textOf("TxtStageLow") ?? ""), `focus: the timer runs (${host.textOf("TxtStageLow")})`);
  // A normal message lands: silent, face-down, in its slot, from the inbox tray.
  const soundsBefore = host.sounds.length;
  face.handle("POST", "/day/v1/_mock/arrive", Buffer.from("{}"));
  host.run(0.3);
  let fresh = cardsAt(() => true).find((n) => !cards.includes(n));
  host.run(4.5); // the next poll, then the slide
  fresh = cardsAt(() => true).filter((n) => !cards.includes(n));
  ok(fresh.length === 1, `focus: the new message landed (${fresh.length})`);
  ok(onDesk(fresh[0]) && fresh[0].source !== "TplMsgRead", "focus: it lies face-down on the desk");
  ok(host.sounds.length === soundsBefore, "focus: a normal message makes no sound");
  // A VIP message lands: one tick, from the tray, and the VIP line.
  face.handle("POST", "/day/v1/_mock/arrive", Buffer.from("{}"));
  host.run(4.6);
  ok(host.sounds.length === soundsBefore + 1 && host.sounds.at(-1).at === "InboxTray", `focus: a VIP ticks once, from the tray (${JSON.stringify(host.sounds)})`);
  ok(/VIP: Counsel/.test(host.textOf("TxtVip") ?? ""), "focus: the VIP line names the sender");
  ok(cardsAt((n) => n.source === "TplMsgVip").every(onDesk), "focus: the VIP card lands on the desk, not in front of you");
  textsOk("focus with a VIP");
  snap("focus");

  // --- Triage: turn over the first VIP card.
  host.press("BtnModeTriage");
  host.run(0.2);
  textsOk("triage");
  ok((host.textOf("TxtStage") ?? "").includes("Press a card"), "triage: says what to do");
  const vip = cardsAt((n) => n.source === "TplMsgVip")[0];
  host.press(vip.handle);
  host.run(0.2);
  ok(/Counsel \(sample\)/.test(host.textOf("TxtOpen") ?? ""), `triage: the card is turned over (${host.textOf("TxtOpen")})`);
  ok(["BtnDone", "BtnLater", "BtnReply", "BtnTask", "BtnMute"].every((b) => host.byName.get(b).visible), "triage: the five actions show");
  ok(host.requests.some((r) => JSON.parse(r.body).op === "turn"), "triage: the turn is sent");
  host.run(4.5);
  ok(cardsAt((n) => n.source === "TplMsgRead").length >= 1, "triage: the turned card now shows its read face");
  // Claude drafts a reply; it waits for Approve.
  host.press("BtnReply");
  host.run(4.6);
  ok(/Draft to/.test(host.textOf("TxtDraft") ?? ""), `triage: the draft waits on the side table (${host.textOf("TxtDraft")})`);
  ok(host.byName.get("BtnApprove").visible && host.byName.get("BtnDeny").visible, "triage: Approve and Deny show");
  ok(!face.log.some((l) => l.op === "approve"), "nothing is approved without the press");
  textsOk("triage with a draft");
  snap("triage");
  const pages = /More 1\/(\d)/.exec(host.textOf("BtnMore") ?? "");
  if (pages) {
    host.press("BtnMore");
    host.run(0.1);
    ok(/More 2\//.test(host.textOf("BtnMore") ?? ""), "triage: More pages the draft");
  }
  host.press("BtnApprove");
  host.run(4.8);
  ok(face.log.some((l) => l.op === "approve"), "Approve reached the bridge");
  ok(face.store.drafts.at(-1).state === "sent", "the draft is marked sent (mock)");
  ok(host.textOf("TxtDraft") === undefined, "the side table is clear after Approve");
  // Make a task from another card; Later one; Mute one; Done one.
  const desk = () => cardsAt((n) => onDesk(n) && n.pos[2] > -0.6 && n.pos[2] < 0.6);
  host.press(desk()[0].handle);
  host.run(0.2);
  host.press("BtnTask");
  host.run(0.4);
  ok(/KOS-MOCK-1 created/.test(host.textOf("TxtStatus") ?? ""), `Make a task says what it made (${host.textOf("TxtStatus")})`);
  host.press("BtnDone");
  host.run(0.6);
  host.press(desk()[0].handle);
  host.run(0.2);
  host.press("BtnLater");
  host.run(0.6);
  host.press(desk()[0].handle);
  host.run(0.2);
  host.press("BtnMute");
  host.run(5.0);
  const later = cardsAt((n) => Math.abs(n.pos[2] - LAYOUT.pileLater[2]) < 0.01 && Math.abs(n.pos[0] - LAYOUT.pileLater[0]) < 0.01);
  const done = cardsAt((n) => Math.abs(n.pos[2] - LAYOUT.pileDone[2]) < 0.01);
  const shelf = cardsAt((n) => Math.abs(n.pos[0] - LAYOUT.shelfX) < 0.01);
  ok(later.length === 1, `Later: one card on the Later pile (${later.length})`);
  ok(done.length === 2, `Done: two cards on the Done pile (${done.length})`);
  ok(shelf.length === 1, `Mute: one card on the quiet shelf behind you (${shelf.length})`);
  ok(/Quiet shelf: 1/.test(host.textOf("TxtQuiet") ?? ""), "the quiet shelf counts it");
  ok(/Done 2/.test(host.textOf("PileDone") ?? "") && /Later 1/.test(host.textOf("PileLater") ?? ""), "the piles are counted");
  textsOk("triage after the actions");
  snap("triage-after");

  // --- Wrap-up.
  face.handle("POST", "/day/v1/act", Buffer.from(JSON.stringify({ token: [...faceTokens(host)][0], op: "complete", id: "t-a" })));
  clock = 18 * 60 + 40;
  host.press("BtnModeWrap");
  host.run(4.6);
  textsOk("wrap-up");
  ok(/^Done: 2 tasks, 2 messages\n- Approve counsel reply\n- Cook ledger row\nPress a task to roll it$/.test(host.textOf("TxtStage") ?? ""), `wrap-up: what got done (${host.textOf("TxtStage")})`);
  ok(/First tomorrow:\nSend the tester invites/.test(host.textOf("TxtStageLow") ?? ""), "wrap-up: the first thing tomorrow");
  ok(/Roll:/.test(host.textOf("TaskA") ?? ""), "wrap-up: open tasks offer to roll");
  host.press("TaskA");
  host.run(4.6);
  ok(face.store.tasks.find((t) => t.id === "t-b").state === "rolled", "wrap-up: pressing a task rolls it to tomorrow");
  ok(host.byName.get("PaneDusk").visible, "the window shows dusk at 6:40");
  snap("wrap");

  // --- The bridge signs the room out: it says so and stops polling.
  face.handle("POST", "/day/v1/session/end", Buffer.from(JSON.stringify({ token: [...faceTokens(host)][0] })));
  host.run(4.6);
  ok(/Sign\sin again/.test(host.textOf("TxtStage") ?? ""), `a 401 signs the room out, out loud (${host.textOf("TxtStage")})`);
  const n0 = host.requests.length;
  host.run(10);
  ok(host.requests.length === n0, "signed out: polling stops");

  // --- Network off: said once, never a crash.
  host.netAvailable = false;
  host.press("BtnSignIn");
  host.answerPrompt("sample-day");
  host.run(6);
  ok(/Network is off/.test(host.textOf("TxtStage") ?? ""), `network off is said (${host.textOf("TxtStage")})`);

  // --- The headset's budgets over the whole run.
  ok(host.textPeak <= LIMITS.maxTexts, `peak texts ${host.textPeak} <= 32`);
  ok(host.createdPeak <= LIMITS.maxCreated, `peak created objects ${host.createdPeak} <= 128`);
  ok(host.maxRequestBytes <= LIMITS.requestBytes, `largest request ${host.maxRequestBytes} B <= 16 KiB`);
  ok(host.maxResponseBytes <= BRIDGE.responseMaxBytes, `largest answer ${host.maxResponseBytes} B <= 256 KiB`);
  ok(!host.netRefusals.some((r) => r.rc === -6), `never rate-limited (${JSON.stringify(host.netRefusals.filter((r) => r.rc === -6))})`);
  const polls = host.requests.filter((r) => r.url.endsWith("/changes"));
  const span = polls.at(-1).t - polls[0].t;
  console.log(
    `${variant}: ${checks} checks so far | texts peak ${host.textPeak}/32 | created peak ${host.createdPeak}/128 | ` +
      `${host.requests.length} requests (${polls.length} polls over ${span.toFixed(0)} s) | largest request ${host.maxRequestBytes} B, answer ${host.maxResponseBytes} B`,
  );
}

/** The mock bridge's live session tokens (the harness reads them to act as the bridge would). */
function faceTokens(host) {
  const tokens = new Set();
  for (const r of host.requests) {
    try {
      const b = JSON.parse(r.body);
      if (b.token) tokens.add(b.token);
    } catch {}
  }
  return [...tokens].reverse();
}

checkLayoutMirror();
for (const v of ["vr", "mr"]) runVariant(v);
console.log(`PASS: ${checks} checks`);
