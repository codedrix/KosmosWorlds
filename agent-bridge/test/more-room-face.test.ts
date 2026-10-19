/**
 * test/more-room-face.test.ts -- More Room's face on the real bridge server,
 * beside Mission Control's (KosmosWorlds PR #4 on top of #5).
 *
 * @kosmos-system  Agent bridge (More Room face)
 * @kosmos-owner   More Room v1
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { tempHome, call, PASS, sleep } from "./helpers.js";

tempHome();
const { Bridge } = await import("../src/bridge.js");
const { FakeAdapter } = await import("../src/adapters/fake.js");
const { createServer } = await import("../src/server.js");
const { MissionControlFace } = await import("../src/faces/mission-control/index.js");
const { hashPassphrase, defaultConfig } = await import("../src/config.js");
const { loadFaces } = await import("../src/faces/registry.js");
const moreRoom = (await import("../src/faces/more-room/index.js")).default;
const { createCore, createStore } = await import("../src/faces/more-room/day-core.js");
const { SAMPLE_DAY } = await import("../src/faces/more-room/sample-day.js");

const project = fs.mkdtempSync(path.join(os.tmpdir(), "agent-bridge-proj-"));
const config = { ...defaultConfig(), port: 0, projects: [{ name: "kosmos-registry", path: project }], passphrase: hashPassphrase(PASS) };
const bridge = new Bridge(config, new FakeAdapter(5));
const mc = new MissionControlFace();
const faces = new Map<string, typeof moreRoom>([[mc.name, mc], [moreRoom.name, moreRoom]]);
const server = createServer(bridge, faces, { port: 0, log: () => undefined, rate: { perSecond: 1000, burst: 1000 } });
await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
const port = (server.address() as AddressInfo).port;
(server as unknown as { __host: string }).__host = `127.0.0.1:${port}`;
after(async () => {
  await bridge.shutdown();
  await new Promise<void>((r) => server.close(() => r()));
});

const VR = { "X-World-Address": "more-room.micknerks", "Content-Type": "application/json" };
const MR = { "X-World-Address": "more-room-mr.micknerks", "Content-Type": "application/json" };
const op = (o: string, body: object, headers = VR) => call(port, `/v1/faces/more-room/${o}`, { body: JSON.stringify(body), headers });
let tok = "";

test("the registry finds the face by its folder", async () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "faces");
  const found = await loadFaces(dir);
  assert.ok(found.has("more-room"));
  assert.ok(found.has("mission-control"));
});

test("the opt-in file lists both More Room worlds beside every other face's", async () => {
  const r = await call(port, "/.well-known/world-network.json", { method: "GET" });
  const worlds = JSON.parse(r.text).worlds as string[];
  // Mission Control's address is its face's to say (it moved to the Lobby on 2026-10-14).
  for (const w of ["world://more-room.micknerks", "world://more-room-mr.micknerks", ...mc.worlds]) assert.ok(worlds.includes(w), w);
});

test("another world's address is refused", async () => {
  const other = (mc.worlds[0] ?? "world://lobby.micknerks").replace("world://", "");
  const r = await op("changes", {}, { "X-World-Address": other, "Content-Type": "application/json" });
  assert.equal(r.status, 403);
});

test("nothing is served before sign-in", async () => {
  const r = await op("changes", { since: 0 });
  assert.equal(r.status, 401);
  assert.match(r.text, /^AUTH\t/);
});

test("sign-in uses the bridge's one session: wrong, then right", async () => {
  const wrong = await op("signin", { pass: "nope" });
  assert.equal(wrong.status, 401);
  assert.match(wrong.text, /^NO\twrong\t/);
  await sleep(2100); // one try every 2 seconds (auth.ts)
  const right = await op("signin", { pass: PASS });
  assert.equal(right.status, 200);
  const m = /^TOKEN\t([A-Za-z0-9_-]+)\t(\d+)\n$/.exec(right.text);
  assert.ok(m, right.text);
  tok = m[1] ?? "";
  assert.ok(tok.length <= 64, "fits the room's 64-byte token slot");
  // The same token works on the shared JSON API: it is the bridge's session.
  const jobs = await call(port, "/v1/jobs", { body: JSON.stringify({ tok }) });
  assert.equal(jobs.status, 200);
});

test("the day, from either world", async () => {
  for (const h of [VR, MR]) {
    const r = await op("changes", { tok, since: 0 }, h);
    assert.equal(r.status, 200);
    assert.match(r.text, /^DAY\/1\trev\t\d+\n/);
    assert.match(r.text, /\nEND\n$/);
    assert.ok(Buffer.byteLength(r.text) < 256 * 1024);
  }
});

test("a press round-trip: turn, draft, approve (sample drafts send nothing)", async () => {
  assert.match((await op("act", { tok, op: "turn", id: "m-a" })).text, /^OK\t\d+\t/);
  assert.match((await op("act", { tok, op: "draft", id: "m-a" })).text, /Draft ready/);
  const day = (await op("changes", { tok, since: 0 })).text;
  const draft = /\nDRAFT\t([^\t]+)\tm-a\tpending\t/.exec(day);
  assert.ok(draft, day);
  const r = await op("act", { tok, op: "approve", id: draft[1] });
  assert.match(r.text, /^OK\t\d+\tSent \(mock/);
});

test("the dev-only op 'arrive' does not exist on a real bridge", async () => {
  const r = await op("arrive", { tok });
  assert.equal(r.status, 404);
});

test("signing out ends the room's session too", async () => {
  await call(port, "/v1/session/end", { body: JSON.stringify({ tok }) });
  const r = await op("changes", { tok, since: 0 });
  assert.equal(r.status, 401);
});

test("a draft that is a bridge Approval is decided through actions.decide", () => {
  const core = createCore({ store: createStore(SAMPLE_DAY) });
  const decided: string[] = [];
  const hooks = { signIn: () => ({ ok: false as const, reason: "wrong" }), decide: (id: string, d: string) => (decided.push(`${id}:${d}`), { ok: true }) };
  core.store.drafts.push({ id: "d-x", msg: "m-a", state: "pending", to: "Counsel", text: "Yes.", approval: "ap-7" });
  const r = core.handle("act", { op: "approve", id: "d-x" }, true, hooks);
  assert.equal(r.status, 200);
  assert.deepEqual(decided, ["ap-7:approve"]);
  assert.match(r.body, /Approved: the bridge sends it/);
  // An approval the bridge refuses (already answered) leaves the draft pending.
  core.store.drafts.push({ id: "d-y", msg: "m-c", state: "pending", to: "Alex", text: "Ok.", approval: "ap-8" });
  const no = core.handle("act", { op: "approve", id: "d-y" }, true, { ...hooks, decide: () => ({ ok: false }) });
  assert.equal(no.status, 409);
  assert.equal(core.store.drafts.find((d) => d.id === "d-y")?.state, "pending");
});

test("the room's guess cap outlives reset(), which the bridge runs on every sign-in and sign-out", async () => {
  // The face itself, as the server calls it (review round 3, lens A, MED-1).
  let calls = 0;
  const ctx = {
    killed: false,
    authed: false,
    signIn: () => (calls++, { ok: false as const, reason: "wrong" as const }),
    bridge: { actions: { decide: () => ({ ok: true }) } },
  } as unknown as Parameters<typeof moreRoom.handle>[2];
  const guess = () => moreRoom.handle("signin", { fields: { pass: "guess" } } as unknown as Parameters<typeof moreRoom.handle>[1], ctx);
  let r = await guess();
  for (let k = 0; k < 6 && r.status !== 429; k++) r = await guess();
  assert.match(String(r.body), /^NO\troom_locked\t/);
  const spent = calls;
  moreRoom.reset();
  moreRoom.reset();
  r = await guess();
  assert.match(String(r.body), /^NO\troom_locked\t/, "still paused after the bridge's resets");
  assert.equal(calls, spent, "no guess reaches the bridge after a reset");
});

test("wrong guesses through this room stop at 4 a day", () => {
  let t = 1_000_000;
  let calls = 0;
  const core = createCore({ store: createStore(SAMPLE_DAY), nowMs: () => t });
  const hooks = { signIn: () => (calls++, { ok: false as const, reason: "wrong" }) };
  for (let k = 0; k < 4; k++) {
    const r = core.handle("signin", { pass: "guess" }, false, hooks);
    assert.equal(r.status, 401);
    t += 3000;
  }
  const fifth = core.handle("signin", { pass: "guess" }, false, hooks);
  assert.equal(fifth.status, 429);
  assert.match(fifth.body, /^NO\troom_locked\t\d+\n$/);
  assert.equal(calls, 4, "the fifth guess never reaches the bridge's lock (which hard-locks at 10)");
  // Not counted: a refusal that checked nothing (too fast).
  t += 24 * 3600 * 1000 + 1;
  const tooFast = { signIn: () => (calls++, { ok: false as const, reason: "too_fast", retryAfterS: 2 }) };
  for (let k = 0; k < 6; k++) assert.equal(core.handle("signin", { pass: "x" }, false, tooFast).status, 429);
  assert.equal(calls, 10, "after a day, and for refusals that are not wrong guesses, the bridge is asked again");
});
