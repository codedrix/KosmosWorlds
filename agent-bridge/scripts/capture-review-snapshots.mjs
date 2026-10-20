// Captures the snapshots the v2 lit-render review draws (mission-control/V2_CONTRACT.md section 7):
// pair, paired, cubes, cubes_need, arc and watch.
//
// Runs the REAL bridge and the REAL Mission Control face with the scripted fake adapter (no
// tokens, no projects touched), drives it the way the world would, and writes the exact bodies
// the world would receive to ../mission-control/review/<name>.snapshot. The Blender script then
// applies them the way src/lib.rs does, so the renders show what the headset would show.
//
// The pairing is approved the way the owner does it at the PC (Pairing.approveTyped, the local
// approver), never through the face. Secrets never reach a review file: the token is written as
// "K <token>" and the pairing id as "I <pairid>". The ring's code is a dead, single-use code.
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
// Slow enough that a job reaches its approval about 0.66 s after it starts (11 steps).
const STEP = 60;
const bridge = new Bridge(config, new FakeAdapter(STEP));
const face = new MissionControlFace();
face.longPollMs = 1;
let tok = "";
let v = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The same context server.ts builds (no HTTP needed for a capture).
const ctx = () => ({
  bridge,
  authed: bridge.auth.check(tok),
  killed: false,
  signIn: (p) => bridge.auth.signIn(p),
  signOut: () => bridge.auth.signOut(),
  pair: {
    mint: () => bridge.pairing.mint(),
    state: (id) => bridge.pairing.state(id),
    signIn: (id) => {
      if (!bridge.pairing.take(id)) return { ok: false };
      const r = bridge.auth.issue();
      bridge.watch.close();
      return r;
    },
  },
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
  // The token and the pairing id are secrets even in a review file: never write them.
  const clean = body.replace(/^K .*$/m, "K <token>").replace(/^I .*$/m, "I <pairid>");
  fs.writeFileSync(path.join(outDir, `${name}.snapshot`), clean);
  console.log(`wrote review/${name}.snapshot (${body.split("\n").length - 1} records)`);
};
async function untilApproval(jobId) {
  for (let i = 0; i < 600; i++) {
    const a = bridge.store.pendingFor(jobId);
    if (a) return a;
    await sleep(5);
  }
  throw new Error("no approval appeared");
}
async function untilStatus(jobId, statuses) {
  for (let i = 0; i < 600; i++) {
    if (statuses.includes(bridge.store.jobs.get(jobId)?.status)) return;
    await sleep(10);
  }
  throw new Error("status never reached");
}

fs.mkdirSync(outDir, { recursive: true });

// 1. The seal: the headset presses it and the ring shows a code.
const minted = await op("pair", {});
const id = /^I (\S+)$/m.exec(minted)[1];
const code = /^T TxSeal (.*)$/m.exec(minted)[1];
save("pair", minted);

// 2. The owner types the code at the PC; the headset's next poll is paired.
bridge.pairing.approveTyped(code);
save("paired", await op("pair", { pair: id }));

// Two jobs finished earlier today, for "Done today".
for (const [preset, project] of [["today", "kosmos-project"], ["notes", "kosmos-portal"]]) {
  const r = await bridge.actions.startPreset(preset, project);
  bridge.store.decide((await untilApproval(r.job.id)).id, "approve");
  await untilStatus(r.job.id, ["done"]);
}

// 3. Three working now, all calm.
const tests = (await bridge.actions.startPreset("tests", "kosmos-registry")).job;
await sleep(100);
const prs = (await bridge.actions.startPreset("prs", "kosmos-portal")).job;
await sleep(100);
const task = (await bridge.actions.startTask("Fix the rate limiter so one busy client can't throttle everyone", "kosmos-web")).job;
await sleep(100);
const now = Date.now();
// Make the elapsed times read like a real afternoon, not milliseconds.
tests.startedAt = now - (4 * 60 + 12) * 1000;
prs.startedAt = now - (1 * 60 + 47) * 1000;
task.startedAt = now - 38 * 1000;
if (bridge.store.pendingApprovals().length) throw new Error("an approval arrived too early for the calm capture");
save("cubes", await view());

// 4. The first job needs the owner: its cube and the puck turn amber.
await untilApproval(tests.id);
const need = await view();
if (bridge.store.pendingApprovals().length !== 1) throw new Error("expected exactly one approval for cubes_need");
save("cubes_need", need);

// 5. Its cube unfolds into the arc, on that job.
face.state.notice = undefined; // the everyday status line, not "Signed in at the seal."
const slot = /^T TxCube([A-D]) registry$/m.exec(need)[1];
await press(`Cube${slot}`);
save("arc", await view());

// 6. The owner lets the group watch; a member's world asks with the code (no token).
await press("BtnWatch");
const watchCode = bridge.watch.current;
const ownerTok = tok;
tok = "";
const watchBody = await op("watch", { watch: watchCode });
tok = ownerTok;
save("watch", watchBody);

await bridge.shutdown();
process.exit(0);
