#!/usr/bin/env node
/**
 * scenario.mjs -- the sample day, pressed through end to end, on both worlds.
 *
 * @kosmos-system  Content (KosmosWorlds) -- More Room
 * @kosmos-owner   More Room v2, the Day Ring
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
import { LAYOUT, at } from "./build_glb.mjs";

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
  const num = (name) => Number(rs.match(new RegExp(`pub const ${name}: (?:f32|usize) = ([-0-9.]+)`))[1]);
  const arr = (name) => rs.match(new RegExp(`pub const ${name}: \\[f32; \\d+\\] = \\[([^\\]]+)\\]`))[1].split(",").map(Number);
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const pairs = [
    ["RING_R", LAYOUT.ringR],
    ["RING_Y", LAYOUT.ringY],
    ["RING_DEG_PER_HOUR", LAYOUT.ringDegPerHour],
    ["RING_SHOW_DEG", LAYOUT.ringShowDeg],
    ["ARC_R", LAYOUT.arcR],
    ["CARD_Y", LAYOUT.cardY],
    ["DROP_H", LAYOUT.dropH],
    ["PILE_LATER_DEG", LAYOUT.pileLaterDeg],
    ["PILE_DONE_DEG", LAYOUT.pileDoneDeg],
    ["PILE_STEP_Y", LAYOUT.pileStepY],
    ["SHELF_X", LAYOUT.shelfX],
    ["SHELF_Y", LAYOUT.shelfY],
    ["FAN_R", LAYOUT.fanR],
    ["FAN_Y", LAYOUT.fanY],
    ["READ_R", LAYOUT.readR],
    ["READ_Y", LAYOUT.readY],
    ["RISE_FROM_Y", LAYOUT.riseFromY],
    ["BANNER_Y", LAYOUT.bannerY],
    ["BANNER_TRIAGE_Y", LAYOUT.bannerTriageY],
    ["COCOON_R", LAYOUT.cocoonR],
    ["COCOON_FROM_R", LAYOUT.cocoonFromR],
    ["COCOON_FACETS", LAYOUT.cocoonFacets],
    ["COCOON_Y", LAYOUT.cocoonY],
  ];
  for (const [rsName, js] of pairs) ok(near(num(rsName), js), `layout: ${rsName}`);
  for (const [rsName, js] of [["ARC_SLOTS_DEG", LAYOUT.arcSlotsDeg], ["SHELF_SLOTS", LAYOUT.shelfSlots], ["FAN_DEG", LAYOUT.fanDeg], ["WELL", LAYOUT.well]]) {
    const v = arr(rsName);
    ok(v.length === js.length && v.every((x, i) => near(x, js[i])), `layout: ${rsName}`);
  }
}

const deg = (p) => (Math.atan2(p[2], p[0]) * 180) / Math.PI;
const radius = (p) => Math.hypot(p[0], p[2]);

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
  const inGrid = (n) => Math.abs(radius(n.pos) - LAYOUT.arcR) < 1e-3 && Math.abs(n.pos[1] - LAYOUT.cardY) < 1e-4 && Math.abs(deg(n.pos)) < 56;
  const inWell = (n) => Math.abs(n.pos[0] - LAYOUT.well[0]) < 1e-4 && Math.abs(n.pos[2] - LAYOUT.well[2]) < 1e-4;
  const onPile = (d) => (n) => { const p = at(LAYOUT.arcR, d, 0); return Math.abs(n.pos[0] - p[0]) < 0.01 && Math.abs(n.pos[2] - p[2]) < 0.01; };
  const events = () => [...host.nodes.values()].filter((n) => n.alive && n.source?.startsWith("TplEvent")).sort((a, b) => a.handle - b.handle);
  const fan = () => ["FanA", "FanB", "FanC", "FanD", "FanE"].map((x) => host.byName.get(x));
  const cocoon = () => [...host.nodes.values()].filter((n) => /^Cocoon[A-P]$/.test(n.name));
  const status = () => host.textOf("TxtStatus") ?? "";

  // ---------------------------------------------------------------------------
  // Part 1: the built-in sample day. No PC, no bridge, no sign-in, and no request.
  // ---------------------------------------------------------------------------
  ok(!host.imports.some((i) => /k_player_get_/.test(i.name)), "no player_read import");
  ok(!host.imports.some((i) => /k_transform_set_rotation/.test(i.name)), "nothing is rotated at runtime (no set_rotation import)");
  host.init();
  host.run(0.5);
  textsOk("sample, morning");
  ok(host.textOf("TxtBanner") === "SAMPLE DAY: nothing here is real yet", `the sample banner shows (${host.textOf("TxtBanner")})`);
  ok(host.textOf("BtnSignIn") === "Owner sign in" && host.textOf("BtnAbout") === "About", "Owner sign in and About are labelled");
  ok((host.textOf("TxtStage") ?? "").startsWith("3 things need you today"), `the brief is on the stage (${host.textOf("TxtStage")})`);
  ok(host.textOf("TxtTasks") === "8 to do, 3 doing, 5 done", `the tasks are counted above them (${host.textOf("TxtTasks")})`);
  ok(/Answer counsel/.test(host.textOf("TaskA") ?? ""), "the first pinned task (a doing one)");
  ok(/Sample day/.test(status()), `the status says it is a sample (${status()})`);
  ok(cardsAt(inGrid).length === 12, `twelve cards on the landing arc (${cardsAt(inGrid).length})`);
  ok(cardsAt(inGrid).every((n) => n.visible), "the arc's cards are face-down and in view");
  ok(cardsAt(inWell).length === 3, `three waiting in the inbox well (${cardsAt(inWell).length})`);
  ok(/^Inbox 30\n2 VIP\n\+15 more$/.test(host.textOf("InboxWell") ?? ""), `the well counts the rest (${host.textOf("InboxWell")})`);
  ok(cardsAt((n) => n.source === "TplMsgVip").length === 2, "two VIP cards wear the amber rim");

  // The Day Ring: ten pills on the ring, now straight ahead, later to the right.
  ok(events().length === 10, `ten events on the ring (${events().length})`);
  ok(events().every((n) => !n.visible || (Math.abs(radius(n.pos) - LAYOUT.ringR) < 1e-3 && Math.abs(n.pos[1] - LAYOUT.ringY) < 1e-4)), "every pill in view sits on the ring");
  const labelled = events().filter((e) => host.texts.has(e.handle)).length;
  ok(labelled === 5, `five ring labels around now, the budget (${labelled})`);
  const counsel = events()[2];
  ok(/10:30/.test(host.textOf(counsel.name) ?? ""), `the third pill is the 10:30 counsel call (${host.textOf(counsel.name)})`);
  const counselDeg0 = deg(counsel.pos);
  ok(Math.abs(counselDeg0 - ((630 - 605) / 60) * LAYOUT.ringDegPerHour) < 0.2, `10:30 sits 25 minutes to the right of now (${counselDeg0.toFixed(2)} deg)`);
  ok(deg(events()[0].pos) < 0 && events()[0].source === "TplEventPast", "the 9:00 standup is past: to the left, dimmed");
  ok(counsel.source === "TplEvent", "the counsel call is still ahead: blue");
  const tick7 = host.byName.get("HourTickA"), tick19 = host.byName.get("HourTickM");
  ok(tick7.visible && deg(tick7.pos) < -40 && !tick19.visible, "hour ticks turn with the day; 19:00 is round the back, hidden");
  const nowBar = host.byName.get("NowBar");
  ok(Math.abs(deg(nowBar.pos)) < 1e-6, "the now bar is straight ahead");
  // The ring turns as time passes: a minute later the call is a quarter of a degree nearer.
  host.run(61);
  const counselDeg1 = deg(events()[2].pos);
  ok(counselDeg1 < counselDeg0 - 0.2 && counselDeg1 > counselDeg0 - 0.3, `the ring turned with the clock (${counselDeg0.toFixed(3)} -> ${counselDeg1.toFixed(3)})`);
  if (variant === "mr") ok(host.byName.get("RingBandK").visible, "MR: the ring's dark band shows behind its labels");
  snap("morning");

  // Prep, from the sample itself.
  host.press(events()[2].handle);
  host.run(0.2);
  ok(/Counsel call 10:30/.test(host.textOf("TxtStage") ?? ""), `prep shows on the stage (${host.textOf("TxtStage")})`);
  ok(host.textOf("BtnPrepClose") === "Close", "prep has a Close");
  textsOk("sample prep");
  snap("prep");
  host.press("BtnPrepClose");
  host.run(0.1);

  // About: seven short pages on the stage, each whole, then closed.
  host.press("BtnAbout");
  host.run(0.1);
  textsOk("about");
  ok(/rectangle/.test(host.textOf("TxtStage") ?? ""), `About opens on what the room is (${host.textOf("TxtStage")})`);
  ok(host.textOf("BtnAboutNext") === "Next 1/7" && host.textOf("BtnAbout") === "Close about", "About has Next and Close about");
  ok(host.textOf("TaskA") === undefined && host.textOf("InboxWell") === undefined && events().every((e) => !host.texts.has(e.handle)), "About clears the room around it");
  ok(host.textOf("TxtBanner") !== undefined, "the sample banner stays while About is open");
  snap("about");
  const pages = [];
  for (let p = 0; p < 7; p++) {
    pages.push(host.textOf("TxtStage") ?? "");
    host.press("BtnAboutNext");
    host.run(0.05);
  }
  ok(host.textOf("BtnAboutNext") === "Next 1/7", "Next comes round to the first page");
  ok(pages.every((t) => t.length > 0 && !t.endsWith("...") && t.split("\n").length <= 4), `every About page is whole (${JSON.stringify(pages)})`);
  ok(/SAMPLE DAY/.test(pages[1]) && /stores none of the\smail/.test(pages[4]) && /iPhone/.test(pages[5]) && /room permission/.test(pages[6]), "About says sample, how it connects, your steps, and what is coming");
  host.press("BtnAbout");
  host.run(0.1);
  ok((host.textOf("TxtStage") ?? "").startsWith("3 things"), "Close about restores the room");

  // Focus on the first pinned task: the room closes in.
  host.press("TaskA");
  host.run(0.1);
  ok(cocoon().every((c) => c.visible), "focus: the cocoon's facets appear");
  host.run(1.5);
  textsOk("sample focus");
  ok(cocoon().length === 16 && cocoon().every((c) => c.visible && Math.abs(radius(c.pos) - LAYOUT.cocoonR) < 0.01), "focus: 16 facets have closed in to 1.95 m");
  ok(/Answer counsel on terms/.test(host.textOf("TxtFocus") ?? ""), "focus: the task is large in front of you");
  ok(/25:00/.test(host.textOf("TxtTimer") ?? ""), `focus: the timer reads 25:00 (${host.textOf("TxtTimer")})`);
  ok(events().every((e) => !host.texts.has(e.handle) && !e.visible), "focus: the ring is outside, unlabelled");
  ok(cardsAt(() => true).every((n) => !n.visible || Math.abs(n.pos[0] - LAYOUT.shelfX) < 0.01), "focus: the arc's cards are put away");
  ok(/Next: 10:30 Counsel call/.test(host.textOf("TxtNext") ?? ""), `focus: only the next event shows (${host.textOf("TxtNext")})`);
  ok(host.textOf("TxtBanner") !== undefined, "focus: the sample banner is inside the cocoon, still shown");
  host.press("BtnFocusGo");
  host.run(3.1);
  ok(/24:5[67] +focus/.test(host.textOf("TxtTimer") ?? ""), `focus: the timer runs (${host.textOf("TxtTimer")})`);
  snap("focus");

  // Triage, all local: the fan rises; read, reply, approve, task, done, later, mute.
  host.press("BtnModeTriage");
  host.run(0.1);
  ok(fan().every((f) => f.visible) && fan().some((f) => f.pos[1] < LAYOUT.fanY - 0.1), "triage: the cards start rising from the arc");
  host.run(1.6);
  ok(cocoon().every((c) => !c.visible), "triage: the cocoon has opened out and gone");
  textsOk("sample triage");
  ok(fan().every((f) => Math.abs(f.pos[1] - LAYOUT.fanY) < 1e-4 && Math.abs(radius(f.pos) - LAYOUT.fanR) < 1e-3), "triage: five cards fanned out face-up at reading height");
  ok(/^(Dana Whitfield|Sam Okoro)/.test(host.textOf("FanA") ?? "") && host.byName.get("FanVipA").visible, `triage: an unread VIP leads the fan, amber-framed (${host.textOf("FanA")})`);
  ok(cardsAt(inGrid).filter((n) => !n.visible).length >= 3, `triage: the fanned cards' discs left the arc (${cardsAt(inGrid).filter((n) => !n.visible).length})`);
  ok(/Press a card/.test(status()), `triage: the status says what to do (${status()})`);
  ok(Math.abs(host.byName.get("TxtBanner").pos[1] - LAYOUT.bannerTriageY) < 1e-4 && host.textOf("TxtBanner") !== undefined, "triage: the banner moves up, clear of the fan, still shown");
  host.press("FanA");
  host.run(0.1);
  ok(host.byName.get("TxtOpen").visible && host.byName.get("TxtOpen").pos[1] < LAYOUT.readY - 0.05, "the reading card rises in front of you");
  host.run(0.6);
  ok(Math.abs(host.byName.get("TxtOpen").pos[1] - LAYOUT.readY) < 1e-4, "the reading card is up");
  ok(/^(Dana Whitfield|Sam Okoro) \(VIP\)/.test(host.textOf("TxtOpen") ?? ""), `the card is read (${host.textOf("TxtOpen")})`);
  ok(["BtnDone", "BtnLater", "BtnReply", "BtnTask", "BtnMute"].every((b) => host.byName.get(b).visible), "the five actions show");
  host.press("BtnReply");
  host.run(0.2);
  ok(/^Draft to (Dana|Sam)/.test(host.textOf("TxtDraft") ?? ""), `the sample's draft waits on the right (${host.textOf("TxtDraft")})`);
  ok(/Draft ready/.test(status()), `the status says so (${status()})`);
  textsOk("sample triage with a draft");
  snap("triage");
  // Deny, then draft again: the new draft has its own id and Approve clears it (review lens A, MED-2).
  host.press("BtnDeny");
  host.run(0.2);
  ok(/Draft discarded/.test(status()) && host.textOf("TxtDraft") === undefined, `Deny clears the draft (${status()})`);
  host.press("FanA");
  host.run(0.6);
  host.press("BtnReply");
  host.run(0.2);
  ok(/^Draft to/.test(host.textOf("TxtDraft") ?? ""), "a second draft waits");
  host.press("BtnApprove");
  host.run(0.7);
  ok(/Sent \(sample/.test(status()), `Approve, in the sample, sends nothing and says so (${status()})`);
  ok(host.textOf("TxtDraft") === undefined, "the draft is gone after Approve");
  const readFan = () => {
    host.press("FanC");
    host.run(0.6);
  };
  readFan();
  host.press("BtnTask");
  host.run(0.2);
  ok(/KOS-SAMPLE-17 made\s\(sample\)/.test(status()), `Make a task says what it made (${status()})`);
  host.press("BtnDone");
  host.run(0.8);
  readFan();
  host.press("BtnLater");
  host.run(0.8);
  readFan();
  host.press("BtnMute");
  host.run(1.0);
  const later = cardsAt(onPile(LAYOUT.pileLaterDeg));
  const done = cardsAt(onPile(LAYOUT.pileDoneDeg));
  const shelf = cardsAt((n) => Math.abs(n.pos[0] - LAYOUT.shelfX) < 0.01);
  ok(later.length === 1, `Later: one card on the Later pile (${later.length})`);
  ok(done.length === 2, `Done: the approved one and the done one (${done.length})`);
  ok(shelf.length === 1, `Mute: one card on the quiet shelf behind you (${shelf.length})`);
  ok(/Quiet shelf: 1/.test(host.textOf("TxtQuiet") ?? ""), "the quiet shelf counts it");
  ok(host.textOf("PileLater") === "Later 1" && host.textOf("PileDone") === "Done 2", `the piles are counted (${host.textOf("PileLater")}, ${host.textOf("PileDone")})`);
  ok(cardsAt(inGrid).length === 12, `waiting cards moved up to fill the arc (${cardsAt(inGrid).length})`);
  ok(fan().every((f) => f.visible && host.texts.has(f.handle)), "the fan refills from what is left");
  textsOk("sample triage after the actions");
  snap("triage-after");

  // Wrap-up.
  host.press("BtnModeWrap");
  host.run(0.6);
  ok(fan().every((f) => !f.visible), "leaving triage puts the fan away");
  ok(cardsAt(inGrid).every((n) => n.visible), "and the cards are back on the arc");
  textsOk("sample wrap-up");
  ok(/^Done: 5 tasks, 2 messages\n- Release notes row\n- Sign the office lease\nFirst tomorrow:/.test(host.textOf("TxtStage") ?? ""), `wrap-up: what got done, and the first thing tomorrow (${host.textOf("TxtStage")})`);
  ok(/^Roll to tomorrow/.test(host.textOf("TxtTasks") ?? ""), "wrap-up: open tasks offer to roll");
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
  const inboxBefore = host.textOf("InboxWell");
  // Move the day on the bridge (a Done made elsewhere), then cut the answer that carries it.
  bridge.core.handle("act", { op: "done", id: "m-ad" }, true, { signIn: () => ({ ok: false, reason: "wrong" }) });
  bridge.cutNextAnswer();
  // Step until the cut answer has been read (the next poll), not a fixed time.
  for (let k = 0; k < 72 * 6 && !/cannot read/.test(status()); k++) host.tick(1 / 72);
  ok(/cannot read/.test(status()), `a cut answer is said (${status()})`);
  ok(host.textOf("InboxWell") === inboxBefore, `a cut answer leaves the day as it was (${host.textOf("InboxWell")})`);
  host.run(4.6);
  ok(/^Inbox 29/.test(host.textOf("InboxWell") ?? ""), `the next poll brings the whole day (${host.textOf("InboxWell")})`);
  host.run(10);
  ok(cardsAt(inGrid).length === 12 && cardsAt(inWell).length === 3, "the bridge's day fills the arc and the well");

  // A message lands while you watch: it falls onto its place, face-down.
  host.press("BtnModeWrap");
  host.run(0.5);
  const wellBefore = cardsAt(inWell).map((n) => n.handle);
  const quietBefore = host.sounds.length;
  arrive();
  let falling = null;
  for (let k = 0; k < 72 * 5 && !falling; k++) {
    host.tick(1 / 72);
    falling = cardsAt((n) => !wellBefore.includes(n.handle) && Math.abs(n.pos[0] - LAYOUT.well[0]) < 1e-4 && n.pos[1] > LAYOUT.well[1] + 0.2)[0];
  }
  ok(falling, "a new message falls from above onto the well");
  host.run(1.0);
  ok(Math.abs(falling.pos[1] - LAYOUT.well[1]) < 0.06 && falling.pos[1] < LAYOUT.well[1] + 0.06, `and settles there (${falling.pos[1].toFixed(3)})`);
  ok(host.sounds.length === quietBefore, "a normal message makes no sound");

  // Focus while messages arrive: silent and out of sight; a VIP ticks once.
  host.press("TaskA");
  host.run(0.2);
  const soundsBefore = host.sounds.length;
  arrive(); // the sample's last arrival is a VIP
  host.run(4.6);
  ok(host.sounds.length === soundsBefore + 1 && host.sounds.at(-1).at === "InboxWell", `focus: a VIP ticks once, from the well (${JSON.stringify(host.sounds)})`);
  ok(/VIP: Dana Whitfield/.test(host.textOf("TxtVip") ?? ""), `focus: the VIP line names the sender (${host.textOf("TxtVip")})`);
  textsOk("live focus with a VIP");

  // Live triage: the unread VIPs lead the fan; a draft from the bridge, approved through the bridge.
  host.press("BtnModeTriage");
  host.run(1.0);
  const vipFanned = fan().filter((f) => host.byName.get(`FanVip${f.name.slice(3)}`).visible);
  ok(vipFanned.length >= 2 && vipFanned[0].name === "FanA", `live: the unread VIPs lead the fan (${vipFanned.map((f) => f.name)})`);
  host.press("FanA");
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
  host.press("BtnModeMorning");
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
