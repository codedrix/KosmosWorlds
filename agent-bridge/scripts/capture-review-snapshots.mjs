// Captures the snapshots the lit-render review draws: lock, wall and chat.
//
// Runs the REAL bridge and the REAL Mission Control face with the scripted fake
// adapter (no tokens, no projects touched), drives it the way the world would,
// and writes the exact bodies the world would receive to
// ../mission-control/review/<name>.snapshot. The Blender script then applies
// them the way src/lib.rs does, so the renders show what the headset would show.
//
// Usage (after `npm run build`): node scripts/capture-review-snapshots.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "..", "..", "mission-control", "review");
process.env.AGENT_BRIDGE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "mc-review-"));

const { Bridge } = await import("../dist/src/bridge.js");
const { FakeAdapter } = await import("../dist/src/adapters/fake.js");
const { MissionControlFace } = await import("../dist/src/faces/mission-control/index.js");
const { hashPassphrase, defaultConfig } = await import("../dist/src/config.js");
const { parseWorldRequest } = await import("../dist/src/wire.js");

const PASS = "review passphrase words";
const projects = ["kosmos-registry", "kosmos-portal", "kosmos-web", "kosmos-project"].map((name) => {
  const p = path.join(os.tmpdir(), "mc-review-proj", name);
  fs.mkdirSync(p, { recursive: true });
  return { name, path: p };
});
const config = { ...defaultConfig(), projects, passphrase: hashPassphrase(PASS) };
const STEP = 25;
const bridge = new Bridge(config, new FakeAdapter(STEP));
const face = new MissionControlFace();
face.longPollMs = 1;
let tok = "";
let v = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ctx = () => ({
  bridge,
  authed: bridge.auth.check(tok),
  killed: false,
  signIn: (p) => bridge.auth.signIn(p),
  signOut: () => bridge.auth.signOut(),
  waitForChange: (ms) => bridge.store.waitForChange(bridge.store.currentVersion, ms),
});
async function op(name, fields = {}, text) {
  const lines = ["AB1", ...(tok ? [`tok ${tok}`] : []), ...Object.entries(fields).map(([k, x]) => `${k} ${x}`)];
  if (text !== undefined) lines.push("---", text);
  const r = await face.handle(name, parseWorldRequest(lines.join("\n"), "text/plain"), ctx());
  const m = /^V (\d+)$/m.exec(r.body);
  if (m) v = Number(m[1]);
  const k = /^K (\S+)$/m.exec(r.body);
  if (k) tok = k[1];
  return r.body;
}
const view = () => op("view", {});
const press = (node, text) => op("press", { v, press: node }, text);
const save = (name, body) => {
  // The token is a secret even in a review file: never write it.
  fs.writeFileSync(path.join(outDir, `${name}.snapshot`), body.replace(/^K .*$/m, "K <token>"));
  console.log(`wrote review/${name}.snapshot (${body.split("\n").length} records)`);
};
async function untilApproval(jobId) {
  for (let i = 0; i < 400; i++) {
    const a = bridge.store.pendingFor(jobId);
    if (a) return a;
    await sleep(10);
  }
  throw new Error("no approval appeared");
}
async function untilStatus(jobId, statuses) {
  for (let i = 0; i < 400; i++) {
    if (statuses.includes(bridge.store.jobs.get(jobId)?.status)) return;
    await sleep(10);
  }
  throw new Error("status never reached");
}

fs.mkdirSync(outDir, { recursive: true });
save("lock", await view());
await press("BtnSignIn", PASS);

// Two jobs finished earlier today, for the shelf.
for (const [preset, project] of [["today", "kosmos-project"], ["notes", "kosmos-portal"]]) {
  const r = await bridge.actions.startPreset(preset, project);
  bridge.store.decide((await untilApproval(r.job.id)).id, "approve");
  await untilStatus(r.job.id, ["done"]);
}

// Three working now: one waits on the CEO (amber), two still going.
const tests = (await bridge.actions.startPreset("tests", "kosmos-registry")).job;
await untilApproval(tests.id);
const prs = (await bridge.actions.startPreset("prs", "kosmos-portal")).job;
const task = (await bridge.actions.startTask("Fix the rate limiter so one busy client can't throttle everyone", "kosmos-web")).job;
await sleep(STEP * 6);
// Make the elapsed times read like a real afternoon, not milliseconds.
const now = Date.now();
tests.startedAt = now - (4 * 60 + 12) * 1000;
prs.startedAt = now - (1 * 60 + 47) * 1000;
task.startedAt = now - 38 * 1000;
bridge.store.poke();
face.state.notice = undefined; // show the everyday status line, not "Signed in."
save("wall", await view());

// The amber card opens its conversation, with the approval inline.
await press("CardA");
save("chat", await view());

// The owner lets the group watch; a member's world asks with the code (no token).
await press("BtnWatch");
const code = bridge.watch.current;
const ownerTok = tok;
tok = "";
const watchBody = await op("watch", { watch: code });
tok = ownerTok;
save("watch", watchBody);

await bridge.shutdown();
process.exit(0);
