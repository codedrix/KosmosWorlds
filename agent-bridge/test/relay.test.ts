import { test, after } from "node:test";
import assert from "node:assert/strict";
import { tempHome, startBridge, PASS } from "./helpers.js";

tempHome();
// A plain JS Worker module (no types), loaded by path from dist/test/.
const relayPath = "../../relay-worker/src/index.js";
const relay = ((await import(relayPath)) as { default: { fetch: (r: Request, env: Record<string, string>) => Promise<Response> } }).default;

const SECRET = "relay-secret-for-tests-0123456789";
const b = await startBridge(5, 300);
b.bridge.config.relaySecret = SECRET;
after(() => b.close());
const env = { BRIDGE_ORIGIN: `http://127.0.0.1:${b.port}`, RELAY_SECRET: SECRET, WORLDS: "world://lobby.micknerks" };
const W = "https://kosmos-agent-bridge.example.workers.dev";

test("the relay serves the opt-in file and the privacy page itself (up when the PC is off)", async () => {
  const off = { ...env, BRIDGE_ORIGIN: "http://127.0.0.1:1" };
  const wk = await relay.fetch(new Request(`${W}/.well-known/world-network.json`), off);
  assert.equal(wk.status, 200);
  assert.deepEqual(await wk.json(), { world_network: 1, worlds: ["world://lobby.micknerks"] });
  const privacy = await relay.fetch(new Request(`${W}/privacy`), off);
  assert.equal(privacy.status, 200);
  const page = await privacy.text();
  for (const w of ["world://lobby.micknerks", "world://more-room.micknerks", "world://more-room-mr.micknerks"]) {
    assert.ok(page.includes(w), `the privacy page covers ${w}`);
  }
  const down = await relay.fetch(new Request(`${W}/v1/faces/mission-control/view`, { method: "POST", body: "AB1\n" }), off);
  assert.equal(down.status, 502);
});

test("the deployed config opts in the Lobby and both More Room worlds", async () => {
  const fs = await import("node:fs");
  const toml = fs.readFileSync(new URL("../../relay-worker/wrangler.toml", import.meta.url), "utf8");
  const m = /^WORLDS = "([^"]*)"$/m.exec(toml);
  assert.ok(m);
  const wk = await relay.fetch(new Request(`${W}/.well-known/world-network.json`), { ...env, WORLDS: m[1] ?? "" });
  assert.deepEqual((await wk.json()).worlds, ["world://lobby.micknerks", "world://more-room.micknerks", "world://more-room-mr.micknerks"]);
});

test("the relay forwards a world's call with the secret; the bridge refuses calls without it", async () => {
  const r = await relay.fetch(
    new Request(`${W}/v1/session`, { method: "POST", body: JSON.stringify({ passphrase: PASS }), headers: { "Content-Type": "application/json", "X-World-Address": "lobby.micknerks" } }),
    env,
  );
  assert.equal(r.status, 200);
  assert.ok((await r.json()).token);

  // Straight to the bridge (as if someone found the tunnel URL): no relay key, refused.
  const direct = await fetch(`http://127.0.0.1:${b.port}/v1/jobs`, { method: "POST", body: "{}" });
  assert.equal(direct.status, 403);
});

test("the relay drops browser context and anything but POST /v1/*", async () => {
  const withOrigin = await relay.fetch(new Request(`${W}/v1/jobs`, { method: "POST", body: "{}", headers: { Origin: "https://evil.example" } }), env);
  assert.equal(withOrigin.status, 403);
  assert.equal((await relay.fetch(new Request(`${W}/v1/jobs`), env)).status, 404);
  assert.equal((await relay.fetch(new Request(`${W}/admin`, { method: "POST" }), env)).status, 404);
});
