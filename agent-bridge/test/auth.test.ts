import { test } from "node:test";
import assert from "node:assert/strict";
import { tempHome } from "./helpers.js";

tempHome();
const { AuthGate, SOFT_LOCK_AFTER, SOFT_LOCK_MS, TOKEN_IDLE_MS, TOKEN_MAX_MS, HARD_LOCK_AFTER } = await import("../src/auth.js");
const { hashPassphrase, verifyPassphrase } = await import("../src/config.js");
const { clearHardLock, isHardLocked } = await import("../src/killswitch.js");

const h = hashPassphrase("Correct Horse  Battery Staple");

function gate() {
  let t = 1_000_000;
  const g = new AuthGate((p) => verifyPassphrase(p, h), () => true, () => t);
  return { g, tick: (ms: number) => (t += ms) };
}

test("the passphrase ignores case and extra spaces, and only a hash is kept", () => {
  assert.ok(verifyPassphrase("correct horse battery staple", h));
  assert.ok(verifyPassphrase("  CORRECT horse battery   staple ", h));
  assert.ok(!verifyPassphrase("correct horse battery", h));
  assert.ok(!JSON.stringify(h).includes("horse"));
});

test("sign-in gives a token; a new sign-in ends the old one", () => {
  const { g, tick } = gate();
  const a = g.signIn("correct horse battery staple");
  assert.ok(a.ok);
  tick(2500);
  const b = g.signIn("correct horse battery staple");
  assert.ok(b.ok);
  assert.ok(a.ok && b.ok && !g.check(a.token));
  assert.ok(b.ok && g.check(b.token));
  assert.ok(!g.check("not-a-token"));
});

test("tokens die after 30 idle minutes and after 8 hours regardless", () => {
  const { g, tick } = gate();
  const a = g.signIn("correct horse battery staple");
  assert.ok(a.ok);
  tick(TOKEN_IDLE_MS - 1000);
  assert.ok(a.ok && g.check(a.token), "used within the idle window");
  tick(TOKEN_IDLE_MS + 1);
  assert.ok(a.ok && !g.check(a.token), "idle too long");

  tick(5000);
  const b = g.signIn("correct horse battery staple");
  assert.ok(b.ok);
  for (let used = 0; used < TOKEN_MAX_MS; used += TOKEN_IDLE_MS / 2) {
    tick(TOKEN_IDLE_MS / 2);
  }
  assert.ok(b.ok && !g.check(b.token), "past the absolute limit");
});

test("attempts are spaced, five wrong in a row lock for 15 minutes", () => {
  const { g, tick } = gate();
  assert.equal((g.signIn("nope") as { reason: string }).reason, "wrong");
  assert.equal((g.signIn("nope") as { reason: string }).reason, "too_fast");
  for (let i = 1; i < SOFT_LOCK_AFTER; i++) {
    tick(2100);
    const r = g.signIn("nope");
    assert.equal((r as { reason: string }).reason, i === SOFT_LOCK_AFTER - 1 ? "locked" : "wrong");
  }
  tick(2100);
  assert.equal((g.signIn("correct horse battery staple") as { reason: string }).reason, "locked", "even the right passphrase waits");
  tick(SOFT_LOCK_MS);
  assert.ok(g.signIn("correct horse battery staple").ok);
});

test("ten wrong inside 24 hours lock sign-in until the PC unlocks it", () => {
  const { g, tick } = gate();
  let last: { ok: boolean; reason?: string } = { ok: true };
  for (let i = 0; i < HARD_LOCK_AFTER; i++) {
    tick(SOFT_LOCK_MS + 3000);
    last = g.signIn("nope") as { ok: boolean; reason?: string };
  }
  assert.equal(last.reason, "hard_locked");
  assert.ok(isHardLocked());
  tick(SOFT_LOCK_MS * 10);
  assert.equal((g.signIn("correct horse battery staple") as { reason: string }).reason, "hard_locked");
  clearHardLock();
  tick(3000);
  assert.ok(g.signIn("correct horse battery staple").ok);
});
