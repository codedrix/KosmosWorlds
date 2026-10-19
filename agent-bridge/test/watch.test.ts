import { test, after } from "node:test";
import assert from "node:assert/strict";
import { tempHome, startBridge, call, PASS, parseSnapshot, worldBody, sleep } from "./helpers.js";

tempHome();
const { WatchGate, OWNER_GONE_MS, WRONG_PER_MINUTE } = await import("../src/watch.js");
const b = await startBridge(5, 200);
after(() => b.close());

let tok = "";
let v = 0;
async function op(name: string, fields: Record<string, string | number>, text?: string) {
  const r = await call(b.port, `/v1/faces/mission-control/${name}`, { body: worldBody(fields, text) });
  assert.equal(r.status, 200);
  const s = parseSnapshot(r.text);
  if (s.token) tok = s.token;
  if (!s.same && name !== "watch") v = s.v;
  return s;
}

test("the Lobby ritual signs in with one call: the passphrase as text, no snapshot needed", async () => {
  const s = await op("signin", {}, PASS);
  assert.ok(tok.length > 20, "a token came back");
  assert.equal(s.mode, "cubes");
  assert.equal(b.bridge.watch.current, null, "watching is off by default");
  const arc = await op("press", { tok, v, press: "CubePlus" });
  assert.equal(arc.text.get("TxWatch"), "Let my group watch: off");
});

test("watching: off by default; the owner turns it on; a watcher gets a read-only copy", async () => {
  const refused = await op("watch", { watch: "123456" });
  assert.ok(refused.events.includes("watch_refused"));
  assert.match(refused.text.get("TxStatus") ?? "", /Nobody is sharing/);

  await op("view", { tok });
  const on = await op("press", { tok, v, press: "BtnWatch" });
  assert.equal(on.mode, "arc");
  const m = /code (\d{3}) (\d{3})/.exec(on.text.get("TxWatch") ?? "");
  assert.ok(m, on.text.get("TxWatch"));
  const code = `${m[1]}${m[2]}`;

  await op("press", { tok, v, press: "BtnTests" });
  const w = await op("watch", { watch: code });
  assert.equal(w.mode, "arc", "the watcher sees the owner's arc");
  assert.match(w.text.get("TxHeader") ?? "", /^Run all tests/, "on the owner's focus");
  assert.equal(w.hue.size, 0, "no ledge, puck or seal records");
  assert.equal(w.buzz, -1, "no buzz: the chime is the owner's");
  assert.equal(w.visible.get("BtnFold"), false);
  for (const n of ["TxCubeA", "TxPuck", "TxSeal", "CubeA", "CubePlus", "BtnPuckApprove", "BtnSealType"]) {
    assert.ok(!w.text.has(n) && !w.visible.has(n) && !w.hidden.has(n), `${n} never reaches a watcher`);
  }
  assert.equal(w.token, "", "never a token");
  assert.equal(w.prompt.size, 0, "never a typing sheet");
  assert.equal(w.visible.get("BtnWatch"), false);
  assert.equal(w.visible.get("BtnSignOut"), false);
  assert.match(w.text.get("TxStatus") ?? "", /pressed: Run all tests/);
  assert.equal(w.text.get("TxWatch"), "Watching (read-only)");
  assert.ok(!w.raw.includes(m[1] + " " + m[2]), "the owner's watch line never reaches a watcher");
});

test("a watch code can't act: a press carrying it and no token is refused", async () => {
  const before = b.bridge.store.list().length;
  const code = b.bridge.watch.current ?? "";
  const r = await call(b.port, "/v1/faces/mission-control/press", { body: worldBody({ watch: code, v, press: "BtnTests" }) });
  const s = parseSnapshot(r.text);
  assert.ok(s.events.includes("signed_out") || s.events.includes("stale"));
  assert.equal(b.bridge.store.list().length, before, "nothing was started");
});

test("anonymous callers can't disturb the owner's wall (no state reset, no version churn)", async () => {
  await op("view", { tok });
  const ownerV = v;
  for (let i = 0; i < 3; i++) {
    const r = await call(b.port, "/v1/faces/mission-control/view", { body: worldBody({}) });
    assert.equal(parseSnapshot(r.text).mode, "lock", "a stranger sees the lock screen");
    await call(b.port, "/v1/faces/mission-control/press", { body: worldBody({ v: ownerV, press: "BtnSignOut" }) });
  }
  const again = await op("view", { tok });
  assert.notEqual(again.mode, "lock", "the owner is still on the wall");
  assert.ok(b.bridge.auth.signedIn, "and the owner is still signed in");
  // The owner's press from the snapshot shown before the strangers' calls still resolves.
  const r = await call(b.port, "/v1/faces/mission-control/press", { body: worldBody({ tok, v: ownerV, press: "BtnProject" }) });
  assert.ok(!parseSnapshot(r.text).events.includes("stale"), "not stale");
});

test("signing out ends watching", async () => {
  const code = b.bridge.watch.current ?? "";
  assert.ok(code);
  await op("view", { tok });
  await op("press", { tok, v, press: "BtnSignOut" });
  const w = await op("watch", { watch: code });
  assert.ok(w.events.includes("watch_refused"));
});

test("a code dies when the owner's wall stops asking (left the Lobby), and guessing is capped", async () => {
  let t = 1_000_000;
  const g = new WatchGate(() => t);
  const code = g.open();
  assert.equal(g.check(code), "ok");
  t += OWNER_GONE_MS + 1;
  assert.equal(g.check(code), "owner_gone");
  g.ownerSeen();
  assert.equal(g.check(code), "off", "the code died; the owner coming back does not revive it");
  t += 61_000;
  const fresh = g.open();
  for (let i = 0; i < WRONG_PER_MINUTE; i++) assert.equal(g.check("000000" === fresh ? "111111" : "000000"), "wrong");
  assert.equal(g.check(fresh), "too_many", "even the right code waits after ten wrong ones");
  t += 61_000;
  g.ownerSeen();
  assert.equal(g.check(fresh), "ok");
  await sleep(1);
});

test("a new sign-in always starts with watching off", async () => {
  await sleep(2100);
  await op("signin", {}, PASS);
  await op("view", { tok });
  await op("press", { tok, v, press: "CubePlus" });
  await op("press", { tok, v, press: "BtnWatch" });
  const code = b.bridge.watch.current ?? "";
  assert.ok(code, "watching is on");
  await sleep(2100);
  const again = await op("signin", {}, PASS);
  assert.equal(b.bridge.watch.current, null, "the old code is gone");
  assert.equal(again.mode, "cubes");
  const arc = await op("press", { tok, v, press: "CubePlus" });
  assert.equal(arc.text.get("TxWatch"), "Let my group watch: off");
  const w = await op("watch", { watch: code });
  assert.ok(w.events.includes("watch_refused"));
});

test("a flood of wrong codes doesn't end a real watcher's view", async () => {
  await sleep(2100);
  await op("signin", {}, PASS);
  await op("view", { tok });
  await op("press", { tok, v, press: "CubePlus" });
  await op("press", { tok, v, press: "BtnWatch" });
  const code = b.bridge.watch.current ?? "";
  assert.ok(code);
  for (let i = 0; i < WRONG_PER_MINUTE; i++) await op("watch", { watch: code === "000000" ? "111111" : "000000" });
  const w = await op("watch", { watch: code });
  assert.ok(!w.events.includes("watch_refused"), "no refusal: the watcher keeps polling");
  assert.ok(w.events.includes("watch_wait"));
  assert.ok(w.same, "nothing new, nothing lost");
});
