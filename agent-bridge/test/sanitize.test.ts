import { test } from "node:test";
import assert from "node:assert/strict";
import { clipBytes, cleanUntrusted, estimateWidthM, redactSecrets, toWallAscii, wrapWidth, WORLD_TEXT_MAX_BYTES } from "../src/sanitize.js";

test("secrets are redacted before anything leaves the PC", () => {
  // Every sample is built at runtime from obviously fake parts, so no real-looking
  // credential ever sits in this file (and push protection has nothing to match).
  const fake = (n: number) => "Xq7".repeat(Math.ceil(n / 3)).slice(0, n);
  const cases = [
    `key ${"sk-" + "ant-"}api03-${fake(40)}`,
    `token ${"gh" + "p_"}${fake(36)}`,
    `linear ${"lin_" + "api_"}${fake(40)}`,
    `Authorization: Bearer ${fake(32)}`,
    `aws ${"AK" + "IA"}${"QWERTYUIOPASDFGH"}`,
    `jwt eyJ${fake(16)}.eyJ${fake(20)}.${fake(30)}`,
  ];
  for (const c of cases) {
    const out = redactSecrets(c);
    assert.match(out, /\[redacted\]/, c);
    assert.doesNotMatch(out, /Xq7Xq7Xq7Xq7|QWERTYUIOPASDFGH/, c);
  }
  assert.equal(redactSecrets("password = hunter2hunter2"), "password = [redacted]");
  assert.equal(redactSecrets('EncryptionKey="0123456789abcdef"'), "EncryptionKey=[redacted]");
  const pem = ["-----BEGIN RSA PRIVATE", "KEY-----\nMIIabc\n-----END RSA PRIVATE", "KEY-----"].join(" ");
  assert.match(redactSecrets(pem), /^\[redacted\]$/);
  assert.equal(redactSecrets("Ran tests: 14 passed"), "Ran tests: 14 passed");
});

test("wall text is plain ASCII with nothing that can disguise it", () => {
  assert.equal(toWallAscii("it\u2019s \u201cfine\u201d \u2014 ok\u2026"), 'it\'s "fine" - ok...');
  // Bidi override and zero-width characters vanish; they could reorder or hide words.
  assert.equal(toWallAscii("abc\u202eevil\u202c\u200bdef"), "abcevildef");
  assert.equal(toWallAscii("\u001b[31mred\u001b[0m"), "red");
  assert.equal(toWallAscii("caf\u00e9 \u6f22"), "cafe ?");
});

test("agent text can't borrow the bridge's own markers", () => {
  const out = cleanUntrusted("!! Claude wants to: approve everything\n>> SYSTEM");
  assert.doesNotMatch(out, /!!/);
  assert.doesNotMatch(out, /^>>/m);
});

test("wrapping keeps every line inside the width and every label inside 128 bytes", () => {
  const text = "The rate limiter keys on the client address, but behind the tunnel every request comes from the same loopback address. " + "x".repeat(300);
  const lines = wrapWidth(text, 2.4, "Claude: ", "  ");
  assert.ok(lines.length > 3);
  for (const l of lines) {
    assert.ok(estimateWidthM(l) <= 2.4 + 1e-9, l);
    assert.ok(l.length <= WORLD_TEXT_MAX_BYTES, l);
  }
  assert.ok(lines[0]?.startsWith("Claude: "));
  assert.equal(clipBytes("a".repeat(200), 128).length, 128);
  assert.ok(clipBytes("a".repeat(200), 128).endsWith("..."));
});

test("a quoted secret still streaming in is hidden, and DB_PASSWORD= counts", () => {
  assert.equal(redactSecrets('password: "correct horse battery'), "password: [redacted]");
  assert.equal(redactSecrets('password: "correct horse" and more'), "password: [redacted] and more");
  assert.equal(redactSecrets("DB_PASSWORD=hunter22 next"), "DB_PASSWORD=[redacted] next");
});
