import { test, after } from "node:test";
import assert from "node:assert/strict";
import { tempHome, startBridge, call, PASS } from "./helpers.js";

tempHome();
const b = await startBridge();
after(() => b.close());
const { kill, unkill } = await import("../src/killswitch.js");

test("the opt-in file lists the world and is served without a sign-in", async () => {
  const r = await call(b.port, "/.well-known/world-network.json", { method: "GET" });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.text), { world_network: 1, worlds: ["world://mission-control.micknerks"] });
});

test("the privacy page is served, plain text, without a sign-in", async () => {
  const r = await call(b.port, "/privacy", { method: "GET" });
  assert.equal(r.status, 200);
  assert.match(r.text, /File contents, command output\nand diffs never leave the computer/);
});

test("a request for another host name is refused (DNS rebinding)", async () => {
  const r = await call(b.port, "/v1/health", { method: "GET", headers: { Host: "evil.example" } });
  assert.equal(r.status, 421);
});

test("anything with a browser's Origin, Cookie or Referer is refused", async () => {
  const headers: Record<string, string>[] = [{ Origin: "https://evil.example" }, { Cookie: "a=b" }, { Referer: "https://evil.example/" }];
  for (const h of headers) {
    const r = await call(b.port, "/v1/session", { body: JSON.stringify({ passphrase: PASS }), headers: h });
    assert.equal(r.status, 403, JSON.stringify(h));
  }
});

test("bodies over 16 KiB are refused", async () => {
  const r = await call(b.port, "/v1/session", { body: "x".repeat(16 * 1024 + 1) });
  assert.equal(r.status, 413);
});

test("a face refuses a request without its world's address", async () => {
  const r = await call(b.port, "/v1/faces/mission-control/view", { body: "AB1\n", headers: { "X-World-Address": "someone-else.attacker" } });
  assert.equal(r.status, 403);
});

test("the JSON API needs the token; a wrong passphrase gets nothing", async () => {
  assert.equal((await call(b.port, "/v1/jobs", { body: "{}" })).status, 401);
  assert.equal((await call(b.port, "/v1/session", { body: JSON.stringify({ passphrase: "guess" }) })).status, 401);
  await new Promise((r) => setTimeout(r, 2100));
  const s = await call(b.port, "/v1/session", { body: JSON.stringify({ passphrase: PASS }) });
  assert.equal(s.status, 200);
  const tok = JSON.parse(s.text).token as string;
  const jobs = await call(b.port, "/v1/jobs", { body: JSON.stringify({ tok }) });
  assert.equal(jobs.status, 200);
  assert.deepEqual(JSON.parse(jobs.text).projects, ["kosmos-registry"]);

  // There is no verb that runs text: an unknown preset is refused, and typed text becomes a job's prompt.
  const bad = await call(b.port, "/v1/jobs/start", { body: JSON.stringify({ tok, preset: "rm -rf /" }) });
  assert.equal(bad.status, 409);
  const started = await call(b.port, "/v1/jobs/new", { body: JSON.stringify({ tok, text: "rm -rf /" }) });
  assert.equal(started.status, 200);
  const id = JSON.parse(started.text).job.id as string;
  const ev = await call(b.port, `/v1/jobs/${id}/events`, { body: JSON.stringify({ tok, since: 0 }) });
  const first = JSON.parse(ev.text).events[0];
  assert.equal(first.kind, "user");
  assert.equal(first.text, "rm -rf /");
  await call(b.port, `/v1/jobs/${id}/stop`, { body: JSON.stringify({ tok }) });
});

test("the kill switch refuses everything, ends the sign-in and stops jobs", async () => {
  await new Promise((r) => setTimeout(r, 2100));
  const s = await call(b.port, "/v1/session", { body: JSON.stringify({ passphrase: PASS }) });
  const tok = JSON.parse(s.text).token as string;
  const started = await call(b.port, "/v1/jobs/start", { body: JSON.stringify({ tok, preset: "tests" }) });
  assert.equal(started.status, 200);
  kill("test");
  try {
    assert.equal((await call(b.port, "/v1/jobs", { body: JSON.stringify({ tok }) })).status, 503);
    const health = await call(b.port, "/v1/health", { method: "GET" });
    assert.deepEqual(JSON.parse(health.text), { ok: true, stopped: true });
    // The opt-in file stays up, so the registry's weekly check does not drop the world.
    assert.equal((await call(b.port, "/.well-known/world-network.json", { method: "GET" })).status, 200);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(b.bridge.auth.signedIn, false);
    assert.equal(b.bridge.store.running().length, 0);
  } finally {
    unkill();
  }
  assert.equal((await call(b.port, "/v1/jobs", { body: JSON.stringify({ tok }) })).status, 401, "the old token is gone");
});

test("the global rate limit answers 429", async () => {
  const slow = await startBridge(5, 300, { perSecond: 1, burst: 3 });
  try {
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await call(slow.port, "/v1/health", { method: "GET" })).status);
    assert.deepEqual(codes, [200, 200, 200, 429, 429]);
  } finally {
    await slow.close();
  }
});

test("logs never carry a body or a token", () => {
  const all = b.logs.join("\n");
  assert.doesNotMatch(all, /horse|passphrase|tok/i);
});
