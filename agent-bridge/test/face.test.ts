import { test, after } from "node:test";
import assert from "node:assert/strict";
import { tempHome, startBridge, call, PASS, parseSnapshot, worldBody, sleep } from "./helpers.js";

tempHome();
const b = await startBridge(5, 300);
after(() => b.close());
const { conversationLines, pressLabel, statusWords, watchLines, WORDS, SEAL_HINT, PASSPHRASE_QUESTION } = await import("../src/faces/mission-control/index.js");
const { estimateWidthM, wrapWidth, WORLD_TEXT_MAX_BYTES } = await import("../src/sanitize.js");
const { TEXT_NODES, BUTTON_NODES, SHOW_NODES, HUE_NODES, ARC_TEXT_NODES, ARC_BUTTON_NODES, W } = await import("../src/faces/mission-control/layout.js");
const known = new Set<string>([...TEXT_NODES, ...BUTTON_NODES, ...SHOW_NODES]);

let tok = "";
let v = 0;

async function view(extra: Record<string, string | number> = {}) {
  const r = await call(b.port, "/v1/faces/mission-control/view", { body: worldBody({ ...(tok ? { tok } : {}), ...extra }) });
  assert.equal(r.status, 200);
  const s = parseSnapshot(r.text);
  checkSnapshot(s);
  if (!s.same) v = s.v;
  return s;
}

async function press(node: string, text?: string, version = v) {
  const r = await call(b.port, "/v1/faces/mission-control/press", { body: worldBody({ ...(tok ? { tok } : {}), v: version, press: node }, text) });
  assert.equal(r.status, 200);
  const s = parseSnapshot(r.text);
  checkSnapshot(s);
  v = s.v;
  if (s.token) tok = s.token;
  return s;
}

/**
 * Every snapshot: known node names only (hue bases only in H), legal hue states, labels inside 128
 * bytes and 4 lines, plain ASCII, at most 32 labels shown, at most 29 in the arc.
 */
function checkSnapshot(s: ReturnType<typeof parseSnapshot>) {
  for (const n of [...s.text.keys(), ...s.hidden, ...s.visible.keys(), ...s.gauge.keys(), ...s.offset.keys(), ...s.prompt.keys(), ...s.copies.keys()]) {
    assert.ok(known.has(n), `unknown node ${n}`);
  }
  for (const [n, st] of s.hue) {
    const states = HUE_NODES[n];
    assert.ok(states, `${n} is not a hue base`);
    assert.ok(st === "off" || states.includes(st as never), `${n} has no ${st} state`);
  }
  for (const [n, t] of s.text) {
    assert.ok(Buffer.byteLength(t) <= 128, `${n} is ${Buffer.byteLength(t)} bytes`);
    assert.ok(t.split("\n").length <= 4, `${n} has more than 4 lines`);
    assert.match(t, /^[\x20-\x7e\n]*$/, `${n} is not plain ASCII`);
  }
  assert.ok(s.texts <= 32, `${s.texts} labels shown`);
  if (s.mode === "arc") assert.ok(s.texts <= 29, `the arc shows ${s.texts} labels`);
  for (const [, q] of s.prompt) assert.ok(Buffer.byteLength(q) <= 256);
}

async function until(pred: (s: ReturnType<typeof parseSnapshot>) => boolean, what: string) {
  for (let i = 0; i < 100; i++) {
    const s = await view();
    if (pred(s)) return s;
    await sleep(20);
  }
  assert.fail(`timed out waiting for ${what}`);
}

test("signed out: the lock clears everything; only the seal's passphrase fallback answers a press", async () => {
  const s = await view();
  assert.equal(s.mode, "lock");
  assert.equal(s.texts, 0, "nothing is shown");
  for (const n of TEXT_NODES) if (n !== "TxSealHint") assert.ok(s.hidden.has(n), `${n} hidden`);
  for (const n of BUTTON_NODES) if (n !== "BtnSealType") assert.equal(s.visible.get(n), false, `${n} hidden`);
  assert.equal(s.hue.get("CubeA"), "off");
  assert.equal(s.hue.get("Puck"), "off");
  assert.equal(s.hue.get("SealRing"), "off");
  assert.equal(s.visible.get("BtnSealType"), true);
  assert.ok(s.prompt.has("BtnSealType"));
  const r = await press("BtnTests");
  assert.ok(r.events.includes("stale"), "BtnTests means nothing while signed out");
  assert.equal(b.bridge.store.list().length, 0);
});

test("a wrong passphrase is refused; the right one gives a token and the cubes", async () => {
  await view();
  const bad = await press("BtnSealType", "wrong words");
  assert.ok(bad.events.includes("refused"));
  assert.equal(bad.token, "");
  assert.match(bad.text.get("TxSealHint") ?? "", /passphrase is wrong/);
  await sleep(2100);
  await view();
  const ok = await press("BtnSealType", PASS);
  assert.ok(ok.token.length > 20);
  assert.equal(ok.mode, "cubes");
  assert.equal(ok.visible.get("CubePlus"), true);
  for (const n of ["CubeA", "CubeB", "CubeC", "CubeD"]) {
    assert.equal(ok.visible.get(n), false, `${n}: no job`);
    assert.equal(ok.hue.get(n), "off");
  }
  assert.equal(ok.hue.get("Puck"), "calm");
  assert.ok(ok.hidden.has("TxPuck"));
  assert.equal(ok.visible.get("BtnPuckApprove"), false);
  for (const n of ARC_TEXT_NODES) assert.ok(ok.hidden.has(n), `${n}: the arc is folded`);
  for (const n of ARC_BUTTON_NODES) assert.ok(!ok.visible.has(n), `${n}: folded arc buttons keep their last U record (Sign out included: folded, Close on the ledge leaves)`);
  assert.equal(ok.texts, 0);
});

test("the + cube opens the arc with no job; a preset opens its job; an approval buzzes, turns its cube amber and lights the puck", async () => {
  await view();
  const open = await press("CubePlus");
  assert.equal(open.mode, "arc");
  assert.equal(open.text.get("TxHeader"), "Start here\nPick a task below, or press + New task.", "no jobs at all: the one first step");
  assert.equal(open.text.get("TxRailA"), "No jobs yet", "the empty rail says so");
  assert.equal(open.visible.get("RailA"), false, "and offers nothing to press");
  for (const n of ["TxRailB", "TxRailC", "TxRailD"]) assert.ok(open.hidden.has(n), `${n} hidden`);
  assert.equal(open.visible.get("BtnFold"), true);
  assert.equal(open.text.get("TxPageSpot"), "A page you pin goes here.");
  assert.equal(open.text.get("TxWatch"), "Not shared");
  assert.match(open.text.get("TxTicker") ?? "", /^0 working/);
  const s = await press("BtnTests");
  assert.equal(s.mode, "arc");
  assert.match(s.text.get("TxHeader") ?? "", /^Run all tests/);
  assert.equal(s.visible.get("CubeA"), true);
  assert.equal(s.visible.get("RailSelA"), true, "the focused job leads the rail");
  const buzzBefore = s.buzz;
  const withApproval = await until((x) => x.visible.get("BtnApprove") === true, "the approval");
  assert.equal(withApproval.buzz, buzzBefore + 1, "Z rose by one: the world buzzes and chimes");
  assert.match(withApproval.text.get("TxAskA") ?? "", /^!! Claude wants to: Run a command\nnpm test$/);
  assert.equal(withApproval.hue.get("CubeA"), "need", "the cube that needs you is amber");
  assert.equal(withApproval.hue.get("Puck"), "need");
  assert.equal(withApproval.text.get("TxPuck"), "registry: run npm test", "one line: project, verb, command (8.5)");
  assert.equal(withApproval.visible.get("BtnPuckApprove"), true, "the whole command is on the puck");
  assert.equal(withApproval.text.get("TxCubeA"), "registry");
  // Claude's words are on conversation lines, shifted to read left-aligned.
  const conv = [...withApproval.text.entries()].filter(([n]) => n.startsWith("TxConv"));
  const job = b.bridge.store.list().at(-1);
  assert.ok(job);
  const all = conversationLines(job.events);
  assert.ok(all.some((t) => t.startsWith("Claude: ")), "Claude speaks behind its name");
  assert.ok(all.includes("   - Read 3 files"));
  // With the ask plate up, only the five lines above it are used (newest last); F-J would sit
  // behind the plate, so they are hidden rather than written there.
  assert.deepEqual(conv.map(([, t]) => t), all.slice(-5).filter((t) => t !== ""), "with an approval up: the last five lines, above the plate");
  for (const slot of ["F", "G", "H", "I", "J"]) assert.ok(withApproval.hidden.has(`TxConv${slot}`), `TxConv${slot} is hidden behind the plate`);
  for (const [n] of conv) assert.ok(withApproval.offset.has(n));
  assert.equal(withApproval.visible.get("BtnKeep"), false, "quick replies wait while an approval is open");
  assert.ok(withApproval.texts <= 29);
});

test("a press from an older snapshot can't approve (the ask plate or the puck)", async () => {
  const old = v - 5;
  for (const n of ["BtnApprove", "BtnPuckApprove"]) {
    const s = await press(n, undefined, old);
    assert.ok(s.events.includes("stale"));
  }
  assert.equal(b.bridge.store.pendingApprovals().length, 1);
});

test("Fold returns to the cubes; the puck approves without opening the arc; the job lands in Done today", async () => {
  await view();
  const folded = await press("BtnFold");
  assert.equal(folded.mode, "cubes");
  for (const n of ARC_TEXT_NODES) assert.ok(folded.hidden.has(n), `${n} hidden at the fold`);
  const stale = await press("BtnApprove");
  assert.ok(stale.events.includes("stale"), "an arc button means nothing while folded");
  assert.equal(b.bridge.store.pendingApprovals().length, 1);
  await view();
  const s = await press("BtnPuckApprove");
  assert.equal(s.mode, "cubes");
  assert.equal(s.hue.get("Puck"), "calm");
  await until((x) => x.visible.get("CubeA") === false, "the job to finish");
  const arc = await press("CubePlus");
  assert.equal(arc.text.get("TxHeader"), "No job open\nPick a job on the left, or start one below.", "jobs exist, none open");
  assert.match(arc.text.get("TxDone") ?? "", /^Done today: 1  \|  Run all/, "one line");
  assert.match(arc.text.get("TxRailA") ?? "", /^registry: Run all tests\nDONE/);
  const rail = await press("RailA");
  const conv = [...rail.text.values()].join("\n");
  assert.match(conv, /You approved: npm test/);
  assert.match(conv, /Ran tests: 14 passed/);
});

test("a long poll answers 'same' when nothing changed", async () => {
  const s = await view();
  const t0 = Date.now();
  const again = await view({ v: s.v });
  assert.ok(again.same);
  assert.ok(Date.now() - t0 >= 250, "it waited for a change first");
});

test("New task sends the typed words as a prompt; Ask why and Deny answer the prompt", async () => {
  await view();
  const open = await press("CubePlus");
  assert.equal(open.visible.get("BtnNewTask"), true, "the start-a-job set shows while no job is open");
  const s = await press("BtnNewTask", "Fix the rate limiter");
  for (const n of ["BtnTests", "BtnPrs", "BtnToday", "BtnNotes", "BtnNewTask", "BtnProject"]) assert.equal(s.visible.get(n), false, `${n} hides while a job is open (8.2)`);
  assert.ok(s.hidden.has("TxProject"));
  assert.equal(s.mode, "arc");
  await until((x) => x.visible.get("BtnWhy") === true, "the approval");
  await press("BtnWhy");
  const why = await until((x) => [...x.text.values()].some((t) => t.includes("You asked why")), "the decision line");
  assert.ok(why);
  const job = b.bridge.store.list().at(-1);
  assert.equal(job?.events[0]?.text, "Fix the rate limiter");
});

test("Approve never shows for a command that can't be shown whole (the ask plate and the puck)", async () => {
  // One line, under the 220-char cap, wraps to three lines, but the two labels together can't
  // hold it: the "| sh" tail would be cut off while Approve was still offered.
  // Words under 48 characters, so no redaction pattern fires: the command is exact, and only
  // the clip check can keep Approve hidden.
  // At the ask plate's 1.1 m this wraps to three lines whose last two make a 132-byte label.
  const w = (c: string) => c.repeat(31);
  const cmd = `echo ${w("i")} ${w("l")} ${w("i")} ${w("l")} ${w("i")} | sh`;
  const job = b.bridge.store.createJob({ agent: "claude", project: "cliptest", cwd: "C:/p", title: "Clip test", firstMessage: "Clip test" });
  const p = b.bridge.store.sink(job.id).requestApproval("Bash", { command: cmd });
  const a = b.bridge.store.pendingFor(job.id);
  assert.ok(a);
  assert.equal(a.exact, true, "exact: the clip check, not redaction, is what hides Approve");
  const cubes = await view();
  assert.equal(b.bridge.store.pendingApprovals()[0]?.id, a.id, "the oldest pending approval is on the puck");
  assert.equal(cubes.visible.get("BtnPuckApprove"), false, "not approvable from the puck");
  assert.equal(cubes.text.get("TxPuck"), "cliptest: open its cube");
  assert.equal(cubes.visible.get("BtnPuckDeny"), true);
  const slot = [...cubes.text.entries()].find(([n, t]) => n.startsWith("TxCube") && t === "cliptest");
  assert.ok(slot, "the job has a cube");
  const s = await press(slot[0].replace(/^Tx/, ""));
  assert.equal(s.mode, "arc");
  assert.equal(s.visible.get("BtnApprove"), false, "not approvable from the ask plate");
  assert.match(s.text.get("TxAskB") ?? "", /^Approve this one on your PC, not here\.\n/, "the reason is never clipped off");
  await view();
  const denied = await press("BtnPuckDeny");
  assert.equal(denied.events.includes("refused"), false, "the puck denies it");
  assert.equal(await p, "deny");
  await view();
  await press("BtnStop");
});

test("a redacted command: the puck says the PC only and offers only Deny", async () => {
  const job = b.bridge.store.createJob({ agent: "claude", project: "kosmos-web", cwd: "C:/p", title: "Secret", firstMessage: "Secret" });
  const fakeKey = ["sk", "ant", "x".repeat(24)].join("-");
  const p = b.bridge.store.sink(job.id).requestApproval("Bash", { command: `curl -H "x-api-key: ${fakeKey}" api.example` });
  const a = b.bridge.store.pendingFor(job.id);
  assert.ok(a && a.exact === false);
  const s = await view();
  assert.equal(s.visible.get("BtnPuckApprove"), false);
  assert.equal(s.text.get("TxPuck"), "web: approve on your PC", "a redacted command: the cube can't approve it either, so the puck says the PC");
  assert.equal(s.visible.get("BtnPuckDeny"), true, "Deny stays");
  assert.ok(!s.raw.includes(fakeKey), "the key never leaves the PC");
  b.bridge.store.decide(a.id, "deny");
  await p;
  b.bridge.store.sink(job.id).setStatus("stopped");
});

test("signing out drops back to the lock and the token stops working", async () => {
  await view();
  const s = await press("BtnSignOut");
  assert.equal(s.mode, "lock");
  assert.ok(s.events.includes("signed_out"));
  assert.equal(s.texts, 0);
  const after = await view();
  assert.equal(after.mode, "lock");
});

// ---------------------------------------------------------------------------
// v2.1 (V2_CONTRACT section 8)
// ---------------------------------------------------------------------------

async function signInAgain() {
  await sleep(2100);
  tok = "";
  await view();
  const s = await press("BtnSealType", PASS);
  assert.ok(s.token, "signed in");
  return s;
}

test("8.10: a cube keeps its job while the job lives; a new job takes the free cube", async () => {
  await signInAgain();
  for (const j of b.bridge.store.running()) b.bridge.store.sink(j.id).setStatus("stopped");
  const mk = (project: string) => b.bridge.store.createJob({ agent: "claude", project, cwd: "C:/p", title: project, firstMessage: project });
  const one = mk("kosmos-alpha");
  const two = mk("kosmos-beta");
  const s1 = await view();
  assert.equal(s1.text.get("TxCubeA"), "alpha");
  assert.equal(s1.text.get("TxCubeB"), "beta");
  b.bridge.store.sink(one.id).setStatus("done");
  const s2 = await view();
  assert.equal(s2.visible.get("CubeA"), false, "the finished job's cube empties");
  assert.equal(s2.hue.get("CubeA"), "off");
  assert.equal(s2.text.get("TxCubeB"), "beta", "the other job stays on its cube (no shift left)");
  const three = mk("kosmos-gamma");
  const s3 = await view();
  assert.equal(s3.text.get("TxCubeA"), "gamma", "a new job takes the first free cube");
  assert.equal(s3.text.get("TxCubeB"), "beta");
  for (const j of [two, three]) b.bridge.store.sink(j.id).setStatus("stopped");
});

test("8.10: two approvals that read the same on the puck still get their own versions (LOW-3)", async () => {
  await view();
  const mk = () => b.bridge.store.createJob({ agent: "claude", project: "kosmos-registry", cwd: "C:/p", title: "Twin", firstMessage: "Twin" });
  const a = mk();
  const c = mk();
  const pa = b.bridge.store.sink(a.id).requestApproval("Bash", { command: "npm test" });
  const pc = b.bridge.store.sink(c.id).requestApproval("Bash", { command: "npm test" });
  const s = await view();
  assert.equal(s.text.get("TxPuck"), "registry: run npm test");
  const after = await press("BtnPuckApprove");
  assert.equal(after.text.get("TxPuck"), "registry: run npm test", "the second reads exactly the same");
  const second = await press("BtnPuckApprove");
  assert.ok(!second.events.includes("refused"), "the second press decides the second approval, not the first again");
  assert.equal(await pa, "approve");
  assert.equal(await pc, "approve");
  assert.equal(b.bridge.store.pendingApprovals().length, 0);
  for (const j of [a, c]) b.bridge.store.sink(j.id).setStatus("stopped");
});

test("8.10: the page doesn't jump when the ask plate appears", async () => {
  await view();
  const job = b.bridge.store.createJob({ agent: "claude", project: "kosmos-paging", cwd: "C:/p", title: "Paging", firstMessage: "Paging" });
  const sink = b.bridge.store.sink(job.id);
  sink.setSessionId("fake-paging");
  for (let i = 1; i <= 30; i++) sink.agentText(`line number ${i} of the long answer`, { newMessage: true });
  const cubes = await view();
  const slot = [...cubes.text.entries()].find(([n, t]) => n.startsWith("TxCube") && t === "paging");
  assert.ok(slot);
  await press(slot[0].replace(/^Tx/, ""));
  const back = await press("BtnPageUp");
  const lastShown = (s: ReturnType<typeof parseSnapshot>) => [...s.text.entries()].filter(([n]) => n.startsWith("TxConv")).at(-1)?.[1];
  const before = lastShown(back);
  assert.ok(before, "a page back is on show");
  const p = sink.requestApproval("Bash", { command: "npm test" });
  const withAsk = await view();
  assert.equal(withAsk.visible.get("AskPanel"), true);
  const shown = [...withAsk.text.entries()].filter(([n]) => n.startsWith("TxConv")).map(([, t]) => t);
  assert.ok(shown.includes(before), "the line that was last on show is still on show above the plate");
  assert.ok(shown.length <= 5, "five lines above the plate");
  b.bridge.store.decide(b.bridge.store.pendingFor(job.id)?.id ?? "", "deny");
  await p;
  sink.setStatus("stopped");
});

test("8.7: Sign out lives on the chrome bar: offered unfolded, never folded; a folded close still signs out", async () => {
  await view();
  const folded = await press("BtnFold");
  assert.equal(folded.mode, "cubes");
  assert.ok(!folded.visible.has("BtnSignOut"), "folded, the face doesn't offer it (Close on the ledge leaves)");
  // The world's closing stage sends BtnSignOut when the owner closes while folded (Close on the
  // ledge, or the seal). The face must honour it although the folded map doesn't offer the button.
  b.bridge.watch.open();
  assert.ok(b.bridge.watch.current, "group watch is on before the close");
  const closed = await press("BtnSignOut");
  assert.ok(closed.events.includes("signed_out"), "a folded close signs out");
  assert.equal(b.bridge.auth.signedIn, false);
  assert.equal(b.bridge.watch.current, null, "and ends group watch");
  // Sign back in for the unfolded case.
  await sleep(2100);
  await view();
  const again = await press("BtnSealType", PASS);
  assert.ok(again.token.length > 20, "signed in again with the passphrase fallback");
  const arc = await press("CubePlus");
  assert.equal(arc.visible.get("BtnSignOut"), true, "unfolded, it is on the chrome bar");
  const out = await press("BtnSignOut");
  assert.equal(out.mode, "lock");
  assert.ok(out.events.includes("signed_out"));
  assert.equal(b.bridge.auth.signedIn, false);
});

test("clarity pass: every fixed string fits its width unclipped (CLARITY_PASS.md B and C)", () => {
  const fits = (line: string, w: number, what: string) => {
    assert.ok(estimateWidthM(line) <= w, `${what}: "${line}" is ${estimateWidthM(line).toFixed(3)} m, wider than ${w} m`);
    assert.match(line, /^[\x20-\x7e]*$/, `${what} is plain ASCII`);
  };
  // The ring: two lines of W.sealHint, as written.
  assert.deepEqual(SEAL_HINT, ["Sign in from your PC: type this code", "in the window where npm start runs."]);
  for (const l of SEAL_HINT) fits(l, W.sealHint, "SEAL_HINT");
  // The headers (two lines of W.header each).
  for (const k of ["startHere", "noJobOpen", "watcherNoJob"] as const) for (const l of WORDS[k]) fits(l, W.header, k);
  fits(WORDS.noJobsYet, W.rail, "noJobsYet");
  fits(WORDS.pageSpot, W.pageSpot, "pageSpot (one line)");
  fits(WORDS.askAtPc, W.ask, "askAtPc");
  fits(WORDS.watchReadOnly, W.watch, "watchReadOnly");
  // TxWatch, off and on: the code grouped 3 + 3, and where it is typed.
  assert.deepEqual(watchLines(null), ["Not shared"]);
  assert.deepEqual(watchLines("123456"), ["Code 123 456", "type it at the Watch post"]);
  for (const code of [null, "000000", "999999", "888888"]) for (const l of watchLines(code)) fits(l, W.watch, "TxWatch");
  // The status line at every job count the config allows (maxJobs 1..4), and every note.
  for (let m = 1; m <= 4; m++) for (let n = 0; n <= m; n++) fits(statusWords(n, m), W.status, "status line");
  for (const k of ["signedInSeal", "signedIn", "stale", "nothingStarted", "nothingSent", "watchOn", "watchClosed", "watchWrong", "watchNobody", "watchOwnerGone", "watchTooMany"] as const) fits(WORDS[k], W.status, k);
  fits(`Not done: ${WORDS.unknownButton}.`, W.status, "unknownButton");
  // The puck's tails leave room for a project word.
  for (const k of ["puckOpenCube", "puckAtPc"] as const) assert.ok(estimateWidthM(`registry${WORDS[k]}`) <= W.puck, k);
  // Seal messages wrap to at most two lines (the hint grows up and stops below the ring).
  for (const k of ["stopped", "pairRate", "pairOff", "pairExpired", "passWrong", "passHardLocked", "passTooFast", "passNotSet", "passOff"] as const) {
    const lines = wrapWidth(WORDS[k], W.sealHint);
    assert.ok(lines.length <= 2, `${k} wraps to ${lines.length} lines: ${JSON.stringify(lines)}`);
    assert.ok(lines.join("\n").length <= WORLD_TEXT_MAX_BYTES, `${k} fits the byte limit`);
  }
  for (const mins of [1, 15]) assert.ok(wrapWidth(`Too many wrong tries. Wait ${mins} minutes.`, W.sealHint).length <= 2);
});

test("clarity pass: the typing sheet's question is the world's, and no word reads as PIN", () => {
  assert.equal(PASSPHRASE_QUESTION, "Mission Control passphrase (shows as you type)", "must equal SEAL_QUESTION in mission-control/src/lib.rs");
  const all = [...SEAL_HINT, ...Object.values(WORDS).flat(), ...watchLines("123456"), statusWords(1, 4)];
  for (const t of all) assert.doesNotMatch(t, /\b(pin code|PIN|pen|snapshot|face|token)\b/, `"${t}" uses a word the contract bans`);
});

test("clarity pass: a watcher is told the owner's press in the panel's new words", () => {
  assert.equal(pressLabel("BtnFold"), "Hide to ledge");
  assert.equal(pressLabel("BtnStop"), "Stop this job");
  assert.equal(pressLabel("BtnPageUp"), "Older");
  assert.equal(pressLabel("BtnPageDown"), "Newer");
  assert.equal(pressLabel("BtnWatch"), "Share with group");
  assert.equal(pressLabel("CubePlus"), "New job");
  assert.equal(pressLabel("CubeB"), "a job cube");
});
