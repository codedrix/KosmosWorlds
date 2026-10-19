import { test, after } from "node:test";
import assert from "node:assert/strict";
import { tempHome, startBridge, call, PASS, parseSnapshot, worldBody, sleep } from "./helpers.js";

tempHome();
const b = await startBridge(5, 300);
after(() => b.close());
const { conversationLines } = await import("../src/faces/mission-control/index.js");
const { TEXT_NODES, BUTTON_NODES, SHOW_NODES, HUE_NODES, ARC_TEXT_NODES, ARC_BUTTON_NODES } = await import("../src/faces/mission-control/layout.js");
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
  for (const n of ARC_BUTTON_NODES) assert.ok(!ok.visible.has(n), `${n}: folded arc buttons keep their last U record`);
  assert.equal(ok.texts, 0);
});

test("the + cube opens the arc with no job; a preset opens its job; an approval buzzes, turns its cube amber and lights the puck", async () => {
  await view();
  const open = await press("CubePlus");
  assert.equal(open.mode, "arc");
  assert.match(open.text.get("TxHeader") ?? "", /^No job open/);
  assert.equal(open.visible.get("BtnFold"), true);
  assert.match(open.text.get("TxPageSpot") ?? "", /DB-043/);
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
  assert.equal(withApproval.text.get("TxPuck"), "registry\nRun a command\nnpm test");
  assert.equal(withApproval.visible.get("BtnPuckApprove"), true, "the whole command is on the puck");
  assert.equal(withApproval.text.get("TxCubeA"), "registry");
  // Claude's words are on conversation lines, shifted to read left-aligned.
  const conv = [...withApproval.text.entries()].filter(([n]) => n.startsWith("TxConv"));
  const job = b.bridge.store.list().at(-1);
  assert.ok(job);
  const all = conversationLines(job.events);
  assert.ok(all.some((t) => t.startsWith("Claude: ")), "Claude speaks behind its name");
  assert.ok(all.includes("   - Read 3 files"));
  assert.deepEqual(conv.map(([, t]) => t), all.slice(-10).filter((t) => t !== ""), "the newest page: the last ten lines");
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
  assert.match(arc.text.get("TxDone") ?? "", /^Done today: 1\nRun all tests \(kosmos-registry\)/);
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
  const s = await press("BtnNewTask", "Fix the rate limiter");
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
  assert.match(cubes.text.get("TxPuck") ?? "", /^cliptest\nToo long here: open its cube/);
  assert.equal(cubes.visible.get("BtnPuckDeny"), true);
  const slot = [...cubes.text.entries()].find(([n, t]) => n.startsWith("TxCube") && t === "cliptest");
  assert.ok(slot, "the job has a cube");
  const s = await press(slot[0].replace(/^Tx/, ""));
  assert.equal(s.mode, "arc");
  assert.equal(s.visible.get("BtnApprove"), false, "not approvable from the ask plate");
  assert.match(s.text.get("TxAskB") ?? "", /approve it at the desk/, "the reason is never clipped off");
  await view();
  const denied = await press("BtnPuckDeny");
  assert.equal(denied.events.includes("refused"), false, "the puck denies it");
  assert.equal(await p, "deny");
  await view();
  await press("BtnStop");
});

test("a redacted command: the puck says desk only and offers only Deny", async () => {
  const job = b.bridge.store.createJob({ agent: "claude", project: "kosmos-web", cwd: "C:/p", title: "Secret", firstMessage: "Secret" });
  const fakeKey = ["sk", "ant", "x".repeat(24)].join("-");
  const p = b.bridge.store.sink(job.id).requestApproval("Bash", { command: `curl -H "x-api-key: ${fakeKey}" api.example` });
  const a = b.bridge.store.pendingFor(job.id);
  assert.ok(a && a.exact === false);
  const s = await view();
  assert.equal(s.visible.get("BtnPuckApprove"), false);
  assert.match((s.text.get("TxPuck") ?? "").replace(/\n/g, " "), /^web Desk only: approve it at the PC\./);
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
