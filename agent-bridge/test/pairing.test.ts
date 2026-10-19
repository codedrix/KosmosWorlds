/**
 * test/pairing.test.ts -- the Pairing Seal: the verb, its threat model (one test per line of
 * V2_CONTRACT.md section 5), the local approvers, and the flow over HTTP.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { tempHome, startBridge, call, PASS, parseSnapshot, worldBody, sleep } from "./helpers.js";

const home = tempHome();
const P = await import("../src/pairing.js");
const { Pairing, PAIR_TTL_MS, PAIR_MIN_GAP_MS, PAIR_MINTS_PER_MINUTE, PAIR_WRONG_LIMIT, PAIR_ALPHABET, formatPairCode } = P;
const { AuthGate } = await import("../src/auth.js");
const { hashPassphrase, verifyPassphrase } = await import("../src/config.js");
const { hardLock, clearHardLock, kill, unkill } = await import("../src/killswitch.js");

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, tick: (ms: number) => (t += ms) };
}

/** A pairing whose code is not `avoid` (codes are random; a clash is 1 in 64 million). */
function mintAvoiding(p: InstanceType<typeof Pairing>, c: ReturnType<typeof clock>, avoid: string) {
  for (;;) {
    c.tick(PAIR_MIN_GAP_MS);
    const m = p.mint();
    assert.ok(m.ok);
    if (m.ok && m.code !== avoid) return m;
  }
}

// ---------------------------------------------------------------------------
// The verb
// ---------------------------------------------------------------------------

test("a pairing: six letters from the 20-consonant set, shown as KXT WMP; the id is 16 random bytes in hex", () => {
  const c = clock();
  const p = new Pairing(c.now);
  const m = p.mint();
  assert.ok(m.ok);
  if (!m.ok) return;
  assert.match(m.code, new RegExp(`^[${PAIR_ALPHABET}]{6}$`));
  assert.equal(PAIR_ALPHABET.length, 20);
  assert.match(m.id, /^[0-9a-f]{32}$/);
  assert.equal(formatPairCode("KXTWMP"), "KXT WMP");
  const st = p.state(m.id);
  assert.equal(st.state, "pending");
  assert.equal(p.state("0".repeat(32)).state, "expired", "an unknown id learns nothing");
  assert.equal(p.state(undefined).state, "expired");
});

test("threat: a pairing lives 120 s from the mint; after that it can't be approved or taken", () => {
  const c = clock();
  const p = new Pairing(c.now);
  const m = p.mint();
  assert.ok(m.ok);
  if (!m.ok) return;
  c.tick(PAIR_TTL_MS - 1);
  assert.equal(p.state(m.id).state, "pending");
  c.tick(1);
  assert.equal(p.state(m.id).state, "expired");
  assert.equal(p.approveTyped(m.code).outcome, "none");
  assert.equal(p.take(m.id), false);
});

test("threat: single use: the first take after approval wins; nothing is left after it", () => {
  const c = clock();
  const p = new Pairing(c.now);
  const m = p.mint();
  assert.ok(m.ok);
  if (!m.ok) return;
  assert.equal(p.take(m.id), false, "not approved yet: nothing to take");
  assert.equal(p.approveTyped(m.code).outcome, "approved");
  assert.equal(p.state(m.id).state, "approved");
  assert.equal(p.take("f".repeat(32)), false, "only the holder of the id takes it");
  assert.equal(p.take(m.id), true);
  assert.equal(p.take(m.id), false, "single use");
  assert.equal(p.state(m.id).state, "expired");
  assert.equal(p.approveTyped(m.code).outcome, "none", "an approved, taken code can't be approved again");
});

test("threat: pairings are keyed by id: a code approves only its own pairing, and the others keep waiting", () => {
  const c = clock();
  const p = new Pairing(c.now);
  const a = p.mint();
  assert.ok(a.ok);
  if (!a.ok) return;
  const b = mintAvoiding(p, c, a.code);
  if (!b.ok) return;
  assert.equal(p.state(a.id).state, "pending", "a second mint no longer cancels the first");
  assert.equal(p.state(b.id).state, "pending");
  assert.equal(p.approveTyped(b.code).outcome, "approved");
  assert.equal(p.state(b.id).state, "approved");
  assert.equal(p.state(a.id).state, "pending", "approving one code approves nothing else");
  assert.equal(p.take(a.id), false, "the other id takes nothing");
  assert.equal(p.take(b.id), true);
  assert.equal(p.approveTyped(b.code).outcome, "wrong", "a used code approves nothing");
  assert.equal(p.waiting()?.count, 1);
});

test("threat: a stranger minting at the cap for 130 s never evicts the owner's pairing inside its life", () => {
  const c = clock();
  const p = new Pairing(c.now);
  const owner = p.mint();
  assert.ok(owner.ok);
  if (!owner.ok) return;
  let strangerMints = 0;
  // The stranger presses the seal every 3 s (the gap limit); the 6-a-minute cap refuses the rest.
  for (let t = PAIR_MIN_GAP_MS; t <= 130_000; t += PAIR_MIN_GAP_MS) {
    c.tick(PAIR_MIN_GAP_MS);
    if (p.mint().ok) strangerMints++;
    const st: string = p.state(owner.id).state;
    if (t < PAIR_TTL_MS) assert.equal(st, "pending", `the owner's pairing is alive at ${t / 1000} s`);
    else assert.equal(st, "expired", "and it ends at its own 120 s");
  }
  assert.ok(strangerMints >= 12, `the stranger minted ${strangerMints} times`);
  assert.ok(P.PAIR_SLOTS > PAIR_MINTS_PER_MINUTE * (PAIR_TTL_MS / 60_000), "more slots than the rate can fill in one life");
});

test("threat: residual risk, stated: a stranger at the cap uses up the mint rate, so the owner's own press can be refused", () => {
  const c = clock();
  const p = new Pairing(c.now);
  for (let i = 0; i < PAIR_MINTS_PER_MINUTE; i++) {
    assert.ok(p.mint().ok);
    c.tick(PAIR_MIN_GAP_MS);
  }
  const owner = p.mint();
  assert.ok(!owner.ok && owner.reason === "rate", "refused: a nuisance, never a sign-in");
});

test("a full table replaces its oldest pairing (a backstop the rate limit makes unreachable)", () => {
  const c = clock();
  const p = new Pairing(c.now);
  const ids: string[] = [];
  for (let i = 0; i < P.PAIR_SLOTS + 1; i++) {
    (p as unknown as { mints: number[] }).mints = []; // only here: step past the rate to reach the backstop
    c.tick(1);
    const m = p.mint();
    assert.ok(m.ok);
    if (m.ok) ids.push(m.id);
  }
  assert.equal(p.state(ids[0]).state, "expired", "the oldest went");
  assert.equal(p.state(ids[1]).state, "pending");
  assert.equal(p.waiting()?.count, P.PAIR_SLOTS);
});

test("threat: minting is rate-limited: 3 s apart, and at most 6 a minute across everyone", () => {
  const c = clock();
  const p = new Pairing(c.now);
  assert.ok(p.mint().ok);
  c.tick(PAIR_MIN_GAP_MS - 1);
  const fast = p.mint();
  assert.ok(!fast.ok && fast.reason === "rate", "too soon after the last mint");
  for (let i = 1; i < PAIR_MINTS_PER_MINUTE; i++) {
    c.tick(PAIR_MIN_GAP_MS);
    assert.ok(p.mint().ok, `mint ${i + 1}`);
  }
  c.tick(PAIR_MIN_GAP_MS);
  const seventh = p.mint();
  assert.ok(!seventh.ok && seventh.reason === "rate", "the seventh in a minute is refused");
  c.tick(60_000);
  assert.ok(p.mint().ok, "a minute later it works again");
});

test("threat: the typed code is normalised (letters only, any case) and five wrong codes cancel the pairing", () => {
  const c = clock();
  const p = new Pairing(c.now);
  const m = p.mint();
  assert.ok(m.ok);
  if (!m.ok) return;
  const wrong = m.code === "BBBBBB" ? "CCCCCC" : "BBBBBB";
  for (let i = 1; i < PAIR_WRONG_LIMIT; i++) {
    const r = p.approveTyped(wrong);
    assert.deepEqual(r, { outcome: "wrong", wrong: i });
  }
  assert.equal(p.approveTyped(m.code.slice(0, 5)).outcome, "cancelled", "the fifth wrong code (a short one) cancels");
  assert.equal(p.state(m.id).state, "expired");
  assert.equal(p.approveTyped(m.code).outcome, "none", "the right code comes too late");

  c.tick(PAIR_MIN_GAP_MS);
  const n = p.mint();
  assert.ok(n.ok);
  if (!n.ok) return;
  const typed = `  ${n.code.slice(0, 3).toLowerCase()}-${n.code.slice(3)} \n`;
  assert.equal(p.approveTyped(typed).outcome, "approved", "'kxt-wmp' with spaces approves KXTWMP");
  c.tick(PAIR_MIN_GAP_MS);
  const o = p.mint();
  assert.ok(o.ok);
  if (!o.ok) return;
  assert.equal(p.approveTyped(`${o.code}${o.code}`).outcome, "wrong", "a longer string containing the code is not the code");
});

test("threat: clear() (the kill switch) forgets the waiting and the approved pairing", () => {
  const c = clock();
  const p = new Pairing(c.now);
  const m = p.mint();
  assert.ok(m.ok);
  if (!m.ok) return;
  p.approveTyped(m.code);
  p.clear();
  assert.equal(p.state(m.id).state, "expired");
  assert.equal(p.take(m.id), false);
});

test("auth: a paired session ignores the passphrase lockout and survives LOCKED; it is still one session", () => {
  let t = 1_000_000;
  const h = hashPassphrase("correct horse battery staple");
  const g = new AuthGate((x) => verifyPassphrase(x, h), () => true, () => t);
  for (let i = 0; i < 5; i++) {
    g.signIn("nope");
    t += 2100;
  }
  assert.equal((g.signIn("correct horse battery staple") as { reason: string }).reason, "locked", "the soft lock is on");
  const a = g.issue();
  assert.ok(g.check(a.token), "pairing still signs in");
  hardLock("test");
  try {
    assert.ok(g.check(a.token), "LOCKED is about passphrase guessing; it does not end a paired session");
    const b = g.issue();
    assert.ok(!g.check(a.token), "one session at a time: the new one ends the old");
    assert.ok(g.check(b.token));
  } finally {
    clearHardLock();
  }
  t += 3000;
  const pass = g.signIn("correct horse battery staple");
  if (pass.ok) {
    hardLock("test");
    try {
      assert.ok(!g.check(pass.token), "a PASSPHRASE session still ends at LOCKED");
    } finally {
      clearHardLock();
    }
  }
});

// ---------------------------------------------------------------------------
// The local approvers: PAIR_APPROVE (npm run approve) and the console
// ---------------------------------------------------------------------------

test("npm run approve: the serve loop reads PAIR_APPROVE, deletes it and approves; PAIR_PENDING never holds the code", () => {
  const c = clock(Date.now());
  const p = new Pairing(c.now);
  const detach = P.attachPendingFile(p);
  const logs: string[] = [];
  try {
    const m = p.mint();
    assert.ok(m.ok);
    if (!m.ok) return;
    const pending = fs.readFileSync(P.pairPendingFile(), "utf8");
    assert.ok(!pending.includes(m.code) && !pending.includes(m.id), "PAIR_PENDING: the time only");
    assert.match(P.describeWaitingFromFile(c.now()), /^A pairing is waiting \(made 0 s ago/);
    assert.ok(!P.describeWaitingFromFile(c.now()).includes(m.code));

    assert.equal(P.pollApproveFile(p, (l) => logs.push(l)), null, "no file, nothing happens");
    P.writeApproveFile(formatPairCode(m.code).toLowerCase());
    assert.ok(fs.readFileSync(P.pairApproveFile(), "utf8").length <= P.PAIR_APPROVE_MAX_BYTES);
    assert.equal(P.pollApproveFile(p, (l) => logs.push(l)), "approved");
    assert.ok(!fs.existsSync(P.pairApproveFile()), "read and deleted");
    assert.equal(fs.readFileSync(P.pairResultFile(), "utf8").trim(), "approved");
    assert.ok(!fs.existsSync(P.pairPendingFile()), "nothing waits any more");
    assert.equal(P.describeWaitingFromFile(c.now()), "No pairing is waiting.");
    for (const l of logs) assert.ok(!l.includes(m.code) && !l.includes(m.id), `no code in "${l}"`);
  } finally {
    detach();
  }
});

test("threat: PAIR_APPROVE over 32 bytes is refused unread, and a stale one is cleared at serve start", () => {
  const c = clock(Date.now());
  const p = new Pairing(c.now);
  const m = p.mint();
  assert.ok(m.ok);
  if (!m.ok) return;
  fs.writeFileSync(P.pairApproveFile(), `${m.code}${"x".repeat(40)}`);
  assert.equal(P.pollApproveFile(p, () => {}), "refused");
  assert.ok(!fs.existsSync(P.pairApproveFile()));
  assert.equal(p.state(m.id).state, "pending", "not approved, not even counted as a wrong code");

  fs.writeFileSync(P.pairApproveFile(), m.code);
  P.clearPairingFiles();
  assert.ok(!fs.existsSync(P.pairApproveFile()), "a file left from before a restart is gone");
  assert.equal(p.state(m.id).state, "pending");
});

test("threat: PAIR_APPROVE that is a link is removed, never followed", (t) => {
  const target = path.join(home, "elsewhere.txt");
  fs.writeFileSync(target, "KEEPME");
  try {
    fs.symlinkSync(target, P.pairApproveFile());
  } catch {
    t.skip("this account can't make symlinks");
    return;
  }
  const p = new Pairing();
  assert.equal(P.pollApproveFile(p, () => {}), "refused");
  assert.ok(!fs.existsSync(P.pairApproveFile()));
  assert.equal(fs.readFileSync(target, "utf8"), "KEEPME", "the link's target is untouched");
  assert.throws(() => {
    fs.symlinkSync(target, P.pairApproveFile());
    P.writeApproveFile("ABCDEF");
  }, /not a plain file/);
  fs.rmSync(P.pairApproveFile(), { force: true });
});

test("the console approver asks without the code, and approves the code typed off the ring", async () => {
  const c = clock(Date.now());
  const p = new Pairing(c.now);
  const input = new PassThrough();
  let out = "";
  const stop = P.startConsoleApprover(p, input, (s) => (out += s), c.now);
  try {
    const m = p.mint();
    assert.ok(m.ok);
    if (!m.ok) return;
    assert.match(out, /A headset asks to pair \(0 s ago\)\. Type the code shown on YOUR ring to approve:/);
    c.tick(7000);
    input.write("\n");
    await sleep(20);
    assert.match(out, /\(7 s ago\)/, "an empty line repeats the prompt with the age");
    input.write("BBBBBC\n");
    await sleep(20);
    assert.match(out, /not the code on any waiting ring \(1 of 5 wrong\)/);
    input.write(`${m.code.toLowerCase()}\n`);
    await sleep(20);
    assert.match(out, /Pairing approved/);
    assert.equal(p.state(m.id).state, "approved");
    assert.ok(!out.includes(m.code) && !out.includes(formatPairCode(m.code)) && !out.includes(m.id), "the console never prints the code or the id");
  } finally {
    stop();
  }
});

// ---------------------------------------------------------------------------
// Over HTTP
// ---------------------------------------------------------------------------

const b = await startBridge(5, 300);
after(() => b.close());
const FACE = "/v1/faces/mission-control";

function resetMintRate(): void {
  // The mint rate is global and real-time; tests that mint often start from a clean minute.
  (b.bridge.pairing as unknown as { mints: number[] }).mints = [];
}

async function op(name: string, fields: Record<string, string | number>, text?: string) {
  const r = await call(b.port, `${FACE}/${name}`, { body: worldBody(fields, text) });
  assert.equal(r.status, 200);
  return parseSnapshot(r.text);
}

test("the face: seal, approve at the PC, paired: K, E paired, the ring locked, then the cubes", async () => {
  resetMintRate();
  const s = await op("pair", {});
  assert.equal(s.mode, "pair");
  assert.match(s.pairId, /^[0-9a-f]{32}$/);
  assert.ok(s.events.includes("pair_wait"));
  const shown = s.text.get("TxSeal") ?? "";
  assert.match(shown, /^[A-Z]{3} [A-Z]{3}$/);
  assert.equal(s.hue.get("SealRing"), "armed");
  assert.equal(s.visible.get("BtnSealType"), true, "the passphrase fallback is on by default");
  assert.equal(s.token, "");

  // Still waiting: a poll answers the seal again after the long-poll wait, without the id.
  const t0 = Date.now();
  const again = await op("pair", { pair: s.pairId });
  assert.ok(Date.now() - t0 >= 250, "it waited");
  assert.equal(again.mode, "pair");
  assert.equal(again.text.get("TxSeal"), shown);
  assert.equal(again.pairId, "", "the id rides only in the mint's answer");

  // The owner types the code at the PC while the headset is polling.
  const poll = op("pair", { pair: s.pairId });
  await sleep(50);
  assert.equal(b.bridge.pairing.approveTyped(shown).outcome, "approved");
  const done = await poll;
  assert.ok(done.token.length > 20, "a token");
  assert.ok(done.events.includes("paired"));
  assert.equal(done.hue.get("SealRing"), "locked");
  assert.equal(done.mode, "cubes");
  const lines = done.raw.split("\n");
  assert.ok(lines.indexOf(`K ${done.token}`) < lines.indexOf("M cubes"), "K, E paired and H SealRing locked come before the owner's render");
  assert.equal(done.visible.get("CubePlus"), true);
  assert.equal(done.hue.get("Puck"), "calm");

  // Single use, and the token works.
  const used = await op("pair", { pair: s.pairId });
  assert.ok(used.events.includes("pair_expired"));
  assert.equal(used.token, "");
  const view = await op("view", { tok: done.token });
  assert.equal(view.mode, "cubes");
  // Leave signed out for the next tests.
  await op("press", { tok: done.token, v: view.v, press: "BtnSignOut" }).catch(() => undefined);
  b.bridge.auth.signOut();
});

test("threat: no HTTP route approves a pairing (every route, every field, with and without a token)", async () => {
  resetMintRate();
  const s = await op("pair", {});
  const code = s.text.get("TxSeal") ?? "";
  const bare = code.replace(" ", "");
  assert.ok(bare.length === 6);
  // Any call to the approver during the walk fails the test.
  const real = b.bridge.pairing.approveTyped.bind(b.bridge.pairing);
  let calls = 0;
  b.bridge.pairing.approveTyped = (x: string) => {
    calls++;
    return real(x);
  };
  await sleep(2100);
  const pass = await call(b.port, "/v1/session", { body: JSON.stringify({ passphrase: PASS }) });
  const tok = JSON.parse(pass.text).token as string;
  try {
    const textBodies = [
      worldBody({ pair: s.pairId }, bare),
      worldBody({ pair: s.pairId, press: "BtnSealType", v: s.v }, bare),
      worldBody({ pair: s.pairId, approve: bare, code: bare }, code),
      worldBody({ tok, pair: s.pairId, approve: bare }, bare),
      worldBody({ tok, press: "BtnApprove", v: 1 }, bare),
    ];
    const jsonBodies = [
      JSON.stringify({ code: bare, pair: s.pairId, approve: bare, passphrase: bare, text: bare }),
      JSON.stringify({ tok, code: bare, pair: s.pairId, decision: "approve", text: bare }),
    ];
    const posts = [
      `${FACE}/view`, `${FACE}/press`, `${FACE}/signin`, `${FACE}/watch`, `${FACE}/approve`, `${FACE}/pairapprove`, `${FACE}/nothing`,
      "/v1/session", "/v1/session/end", "/v1/jobs", "/v1/jobs/start", "/v1/jobs/new",
      "/v1/jobs/abc/events", "/v1/jobs/abc/message", "/v1/jobs/abc/stop",
      `/v1/approvals/${s.pairId.slice(0, 16)}/decide`, "/v1/approvals/abc/decide",
      "/v1/pair", "/v1/pair/approve", "/v1/pairing/approve", "/v1/approve",
      "/v1/faces/more-room/approve",
    ];
    for (const p of posts) {
      for (const body of [...textBodies, ...jsonBodies]) {
        await call(b.port, p, { body });
        assert.notEqual(b.bridge.pairing.state(s.pairId).state, "approved", `${p} approved it`);
      }
    }
    for (const p of ["/.well-known/world-network.json", "/privacy", "/v1/health", `/v1/pair?code=${bare}`, `${FACE}/pair?approve=${bare}`]) {
      await call(b.port, p, { method: "GET" });
      assert.notEqual(b.bridge.pairing.state(s.pairId).state, "approved", `GET ${p} approved it`);
    }
    // The pair op itself, with the code in every place it could carry it, only polls.
    for (const body of textBodies.filter((x) => x.includes(`pair ${s.pairId}`))) {
      const r = parseSnapshot((await call(b.port, `${FACE}/pair`, { body })).text);
      assert.ok(!r.events.includes("paired"));
    }
    assert.equal(calls, 0, "no route reached the approver");
    assert.equal(b.bridge.pairing.state(s.pairId).state, "pending", "still waiting for the PC");
  } finally {
    b.bridge.pairing.approveTyped = real;
    b.bridge.auth.signOut();
    // The walk typed the code as a passphrase a few times: start the next tests from a clean count.
    Object.assign(b.bridge.auth as unknown as Record<string, unknown>, { consecutiveFails: 0, softLockUntil: 0, failTimes: [] });
    clearHardLock();
  }
});

test("threat: the server and the faces never name the approver (static check of the built code)", () => {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
  const files = [path.join(dist, "server.js"), path.join(dist, "bridge.js"), path.join(dist, "faces", "types.js"), path.join(dist, "faces", "registry.js")];
  for (const d of fs.readdirSync(path.join(dist, "faces"), { withFileTypes: true })) {
    if (d.isDirectory()) for (const f of fs.readdirSync(path.join(dist, "faces", d.name))) if (f.endsWith(".js")) files.push(path.join(dist, "faces", d.name, f));
  }
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    assert.doesNotMatch(src, /approveTyped|pollApproveFile|startConsoleApprover|writeApproveFile/, f);
  }
});

test("threat: the request log carries no code, no id and no token", async () => {
  resetMintRate();
  const s = await op("pair", {});
  const code = s.text.get("TxSeal") ?? "";
  const poll = op("pair", { pair: s.pairId });
  await sleep(30);
  b.bridge.pairing.approveTyped(code);
  const done = await poll;
  assert.ok(done.token);
  const all = b.logs.join("\n");
  for (const secret of [code, code.replace(" ", ""), s.pairId, done.token]) assert.ok(!all.includes(secret), "a secret reached the log");
  assert.match(all, /POST \/v1\/faces\/mission-control\/pair 200/);
  b.bridge.auth.signOut();
});

test("threat: a watcher never sees pairing: no I, no seal, no hue, no code", async () => {
  await sleep(2100);
  const signed = await op("signin", {}, PASS);
  const tok = signed.token;
  assert.ok(tok);
  const v1 = await op("view", { tok });
  const on = await op("press", { tok, v: v1.v, press: "CubePlus" });
  const w1 = await op("press", { tok, v: on.v, press: "BtnWatch" });
  assert.match(w1.text.get("TxWatch") ?? "", /code \d{3} \d{3}/);
  const watchCode = b.bridge.watch.current ?? "";
  resetMintRate();
  const s = await op("pair", {});
  const code = s.text.get("TxSeal") ?? "";
  const w = await op("watch", { watch: watchCode });
  assert.equal(w.mode, "arc");
  assert.equal(w.pairId, "");
  assert.equal(w.hue.size, 0, "no hue records at all (no ledge, puck or seal)");
  assert.equal(w.token, "");
  assert.equal(w.prompt.size, 0);
  assert.ok(!w.raw.includes(code) && !w.raw.includes(s.pairId));
  for (const n of ["TxSeal", "TxSealHint", "TxCubeA", "TxPuck", "BtnSealType", "CubeA", "CubePlus", "BtnPuckApprove"]) {
    assert.ok(!w.text.has(n) && !w.visible.has(n) && !w.hidden.has(n), `${n} is not in a watcher's snapshot`);
  }
  // The pairing replaced nothing of the owner's: still signed in, and watching still on.
  assert.ok(b.bridge.auth.signedIn);
  // A paired sign-in, like every sign-in, closes the watch code.
  const poll = op("pair", { pair: s.pairId });
  await sleep(30);
  b.bridge.pairing.approveTyped(code);
  const done = await poll;
  assert.ok(done.events.includes("paired"));
  assert.equal(b.bridge.watch.current, null, "the old watch code is gone");
  const after = await op("watch", { watch: watchCode });
  assert.ok(after.events.includes("watch_refused"));
  assert.equal((await op("view", { tok })).mode, "lock", "and the old session ended (one at a time)");
  b.bridge.auth.signOut();
});

test("threat: minting is refused beyond the rate (pair_refused), and an expired id answers pair_expired", async () => {
  resetMintRate();
  const first = await op("pair", {});
  assert.ok(first.events.includes("pair_wait"));
  const fast = await op("pair", {});
  assert.ok(fast.events.includes("pair_refused"));
  assert.equal(fast.mode, "lock");
  assert.equal(fast.pairId, "");
  assert.ok(!fast.text.has("TxSeal"));
  assert.match(fast.text.get("TxSealHint") ?? "", /Too many pairings/);
  const unknown = await op("pair", { pair: "a".repeat(32) });
  assert.ok(unknown.events.includes("pair_expired"));
  assert.equal(unknown.hue.get("SealRing"), "off");
});

test("threat: the kill switch refuses minting and clears what is pending", async () => {
  resetMintRate();
  const s = await op("pair", {});
  kill("test");
  try {
    const r = await op("pair", {});
    assert.ok(r.events.includes("pair_refused"));
    assert.match(r.text.get("TxSealHint") ?? "", /Stopped on the PC/);
    assert.equal(r.visible.get("BtnSealType"), false, "no passphrase fallback while stopped");
    assert.equal(b.bridge.pairing.state(s.pairId).state, "expired", "the waiting pairing is gone");
    const poll = await op("pair", { pair: s.pairId });
    assert.ok(poll.events.includes("pair_refused"));
    assert.equal(b.bridge.pairing.approveTyped(s.text.get("TxSeal") ?? "").outcome, "none");
  } finally {
    unkill();
  }
});

test("config: pairSignIn false refuses pairing; passphraseSignIn false answers passphrase_off and hides the fallback", async () => {
  resetMintRate();
  b.bridge.config.pairSignIn = false;
  try {
    const r = await op("pair", {});
    assert.ok(r.events.includes("pair_refused"));
    assert.match(r.text.get("TxSealHint") ?? "", /Pairing is off/);
  } finally {
    b.bridge.config.pairSignIn = true;
  }
  b.bridge.config.passphraseSignIn = false;
  try {
    resetMintRate();
    const s = await op("pair", {});
    assert.equal(s.visible.get("BtnSealType"), false, "the face hides BtnSealType");
    assert.ok(!s.prompt.has("BtnSealType"));
    await sleep(2100);
    const r = await op("signin", { pair: s.pairId }, PASS);
    assert.ok(r.events.includes("passphrase_off"));
    assert.equal(r.token, "");
    assert.equal(r.mode, "pair", "typed from the raised seal: the ring keeps its code");
    assert.match(r.text.get("TxSealHint") ?? "", /Passphrase sign-in is off/);
    const lock = await op("signin", {}, PASS);
    assert.ok(lock.events.includes("passphrase_off"));
    assert.equal(lock.mode, "lock");
    const json = await call(b.port, "/v1/session", { body: JSON.stringify({ passphrase: PASS }) });
    assert.equal(json.status, 403);
    assert.equal(JSON.parse(json.text).error, "passphrase_off");
    assert.equal(b.bridge.auth.signedIn, false);
  } finally {
    b.bridge.config.passphraseSignIn = true;
  }
});

test("pairing works while the passphrase is hard-locked, and the paired token keeps working", async () => {
  hardLock("test");
  try {
    await sleep(2100);
    const refused = await op("signin", {}, PASS);
    assert.ok(refused.events.includes("refused"), "the passphrase is locked");
    resetMintRate();
    const s = await op("pair", {});
    const poll = op("pair", { pair: s.pairId });
    await sleep(30);
    b.bridge.pairing.approveTyped(s.text.get("TxSeal") ?? "");
    const done = await poll;
    assert.ok(done.token);
    assert.equal((await op("view", { tok: done.token })).mode, "cubes");
  } finally {
    clearHardLock();
    b.bridge.auth.signOut();
  }
});

test("npm run approve: with no code it says whether one waits (never the code); with a code it waits for the bridge's answer", async () => {
  const { spawn } = await import("node:child_process");
  const main = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "main.js");
  const run = (args: string[]) =>
    new Promise<{ code: number | null; out: string }>((resolve) => {
      const child = spawn(process.execPath, [main, "approve", ...args], { env: { ...process.env, AGENT_BRIDGE_HOME: home } });
      let out = "";
      child.stdout.on("data", (d: Buffer) => (out += d.toString()));
      child.stderr.on("data", (d: Buffer) => (out += d.toString()));
      child.on("close", (code) => resolve({ code, out }));
    });
  P.clearPairingFiles();
  assert.match((await run([])).out, /No pairing is waiting/);

  // Nobody serving: the file is taken back, so it can never approve a later pairing.
  const alone = await run(["ABCDEF"]);
  assert.equal(alone.code, 1);
  assert.match(alone.out, /didn't pick it up/);
  assert.ok(!fs.existsSync(P.pairApproveFile()));

  // A serve loop (this process) reads it within a second.
  const p = new Pairing();
  const detach = P.attachPendingFile(p);
  const m = p.mint();
  assert.ok(m.ok);
  if (!m.ok) return;
  const waiting = await run([]);
  assert.match(waiting.out, /A pairing is waiting \(made \d+ s ago/);
  assert.ok(!waiting.out.includes(m.code));
  const loop = setInterval(() => P.pollApproveFile(p, () => {}), 100);
  try {
    const wrong = await run([m.code === "BBBBBB" ? "CCCCCC" : "BBBBBB"]);
    assert.match(wrong.out, /not the code on the waiting ring|not the code on any waiting ring/);
    const ok = await run([formatPairCode(m.code).toLowerCase().replace(" ", "-")]);
    assert.equal(ok.code, 0);
    assert.match(ok.out, /^Approved\./);
    assert.ok(!ok.out.includes(m.code));
    assert.equal(p.state(m.id).state, "approved");
  } finally {
    clearInterval(loop);
    detach();
  }
});
