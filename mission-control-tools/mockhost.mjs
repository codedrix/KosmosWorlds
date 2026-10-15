// mockhost.mjs -- runs the BUILT world.wasm against the REAL bridge, end to end, without a headset.
//
// @kosmos-system Content (KosmosWorlds) -- Mission Control (DB-043)
// @kosmos-owner  Content lane
//
// A Node stand-in for the Kosmos host: it implements every kosmos.* import the
// world uses (nodes, world text, visibility, transforms, clones, events, the
// typing sheet, haptics, audio, k_log, and k_net_* over real HTTP to a bridge on
// 127.0.0.1 with the fake adapter). Then it plays a visit: sign in, start a
// preset, wait for the approval (and check the buzz + chime), approve, watch the
// job finish, go back to the wall.
//
// It checks the world's wire client against the bridge's face. It does NOT
// check the headset: rendering, the real typing sheet and haptics are the device
// checkpoint's job.
//
// Usage (after `npm run build` in agent-bridge and building world.wasm):
//   node mission-control-tools/mockhost.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.AGENT_BRIDGE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "mc-mockhost-"));
const bridgeDist = path.join(repo, "agent-bridge", "dist", "src");
const { Bridge } = await import(new URL(`file:///${path.join(bridgeDist, "bridge.js")}`).href);
const { FakeAdapter } = await import(new URL(`file:///${path.join(bridgeDist, "adapters", "fake.js")}`).href);
const { createServer } = await import(new URL(`file:///${path.join(bridgeDist, "server.js")}`).href);
const { MissionControlFace } = await import(new URL(`file:///${path.join(bridgeDist, "faces", "mission-control", "index.js")}`).href);
const { hashPassphrase, defaultConfig } = await import(new URL(`file:///${path.join(bridgeDist, "config.js")}`).href);

// --- the bridge -------------------------------------------------------------
const PASS = "mock host passphrase";
const proj = fs.mkdtempSync(path.join(os.tmpdir(), "mc-mockhost-proj-"));
const config = { ...defaultConfig(), projects: [{ name: "kosmos-registry", path: proj }], passphrase: hashPassphrase(PASS) };
const bridge = new Bridge(config, new FakeAdapter(30));
const face = new MissionControlFace();
face.longPollMs = 400;
const server = createServer(bridge, new Map([[face.name, face]]), { port: 0, log: () => {} });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

// --- the host ---------------------------------------------------------------
const nodes = JSON.parse(fs.readFileSync(path.join(repo, "mission-control", "nodes.json"), "utf8"));
const names = [...nodes.text, ...nodes.buttons, ...nodes.show];
const handleOf = new Map(names.map((n, i) => [n, i + 1]));
const nameOf = new Map(names.map((n, i) => [i + 1, n]));
const text = new Map();
const visible = new Map();
const scale = new Map();
const position = new Map();
const created = new Map();
const subs = new Map(); // handle -> fn index (OnInteract)
const globals = new Map(); // event name -> fn index
const log = { haptic: [], audio: [], klog: [], prompts: [] };
const net = { pending: [], done: [], bodies: new Map() };
let nextHandle = 1000;
let mem;
let table;
const memory = new WebAssembly.Memory({ initial: 17, maximum: 128 });
const bytes = (p, l) => new Uint8Array(memory.buffer, p, l);
const str = (p, l) => new TextDecoder().decode(bytes(p, l));

const kosmos = {
  k_node_find: (p, l) => handleOf.get(str(p, l)) ?? 0,
  k_node_set_visible: (h, v) => (visible.set(nameOf.get(h) ?? h, v !== 0), 0),
  k_node_clone: (src, _parent, p, l) => {
    const h = nextHandle++;
    created.set(h, str(p, l));
    return h;
  },
  k_node_destroy: (h) => (created.delete(h), 0),
  k_transform_get_position: (h, x, y, z) => {
    const dv = new DataView(memory.buffer);
    const [px, py, pz] = position.get(h) ?? [2.9, 1.5, 0];
    dv.setFloat32(x, px, true);
    dv.setFloat32(y, py, true);
    dv.setFloat32(z, pz, true);
    return 0;
  },
  k_transform_set_position: (h, x, y, z) => (position.set(h, [x, y, z]), 0),
  k_transform_set_scale: (h, x, y, z) => (scale.set(nameOf.get(h), [x, y, z]), 0),
  k_ui_show_world_text: (h, p, l) => {
    if (l > 128) return -7;
    text.set(nameOf.get(h), str(p, l));
    return 0;
  },
  k_ui_hide_world_text: (h) => (text.delete(nameOf.get(h)), 0),
  k_ui_prompt: (qp, ql, out, cap, id) => {
    log.prompts.push({ q: str(qp, ql), out, cap, id });
    return 0;
  },
  k_event_subscribe: (p, l, h, fn) => (subs.set(h, fn), 1),
  k_event_subscribe_global: (p, l, fn) => (globals.set(str(p, l), fn), 1),
  k_haptic_pulse: (hand, intensity, ms) => (log.haptic.push({ hand, intensity, ms, at: Date.now() }), 0),
  k_audio_play: (n, p, l) => (log.audio.push(str(p, l)), 0),
  k_log: (lv, p, l) => (log.klog.push(str(p, l)), 0),
  k_net_status: () => 1,
  k_net_fetch: (method, up, ul, bp, bl, flags, id) => {
    const url = str(up, ul);
    const body = Buffer.from(bytes(bp, bl));
    if (bl > 16384) return -5;
    if (net.pending.length >= 4) return -6;
    // The world calls https://<bridge host>/...; the mock sends it to the local bridge.
    const local = url.replace(/^https:\/\/[^/]+/, `http://127.0.0.1:${port}`);
    const p = fetch(local, { method: method === 1 ? "POST" : "GET", body: method === 1 ? body : undefined, headers: { "X-World-Address": "mission-control.micknerks", "Content-Type": "text/plain" } })
      .then(async (r) => ({ id, status: r.status, body: Buffer.from(await r.arrayBuffer()) }))
      .catch(() => ({ id, status: 0, body: Buffer.alloc(0) }));
    net.pending.push(p);
    p.then((res) => {
      net.pending.splice(net.pending.indexOf(p), 1);
      net.done.push(res);
    });
    return 0;
  },
  k_net_read: (id, out, cap) => {
    const b = net.bodies.get(id);
    if (!b) return -7;
    if (cap === 0) return b.length;
    const n = Math.min(cap, b.length);
    bytes(out, n).set(b.subarray(0, n));
    return n;
  },
};

const wasm = fs.readFileSync(path.join(repo, "mission-control", "world.wasm"));
const { instance } = await WebAssembly.instantiate(wasm, { env: { memory }, kosmos });
table = instance.exports.__indirect_function_table;
mem = memory;
const call = (fn, ...args) => table.get(fn)(...args);

function tick(dt = 0.05) {
  // Deliver finished requests one per tick, then k_tick (a body lives until the next tick).
  net.bodies.clear();
  for (const res of net.done.splice(0)) {
    net.bodies.set(res.id, res.body);
    call(globals.get("OnNetResult"), 0, 0, res.id, res.status);
  }
  instance.exports.k_tick(dt);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function run(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    tick();
    await sleep(20);
  }
}
async function until(pred, what, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    tick();
    if (pred()) return;
    await sleep(20);
  }
  throw new Error(`timed out waiting for ${what}; ticker=${text.get("TxTicker")} status=${text.get("TxStatus")}`);
}
function press(name) {
  call(subs.get(handleOf.get(name)), 0, handleOf.get(name), 0, 0);
}
function answerPrompt(answer) {
  const p = log.prompts.at(-1);
  const b = new TextEncoder().encode(answer);
  bytes(p.out, b.length).set(b);
  call(globals.get("OnPromptResult"), 0, 0, p.id, b.length);
}

// --- the visit ----------------------------------------------------------------
instance.exports.k_init();
assert.equal(text.get("TxLock"), "Connecting to the bridge\non the PC...");
await until(() => visible.get("BtnSignIn") === true, "the lock screen from the bridge");
console.log("1. lock screen:", JSON.stringify(text.get("TxLock")));

press("BtnSignIn");
assert.match(log.prompts.at(-1).q, /passphrase/);
answerPrompt(PASS);
await until(() => /working/.test(text.get("TxTicker") ?? ""), "the wall after sign-in");
console.log("2. signed in, ticker:", text.get("TxTicker"));

press("BtnTests");
await until(() => /Run all tests/.test(text.get("TxHeader") ?? ""), "the chat for the preset");
console.log("3. chat open:", text.get("TxHeader"));

await until(() => visible.get("BtnApprove") === true, "the inline approval");
await run(400);
assert.equal(log.audio.filter((a) => a === "chime.wav").length, 1, "one chime");
assert.equal(log.haptic.length, 2, "two pulses");
assert.ok(log.haptic.every((h) => h.hand === 2), "both controllers");
console.log("4. approval:", JSON.stringify(text.get("TxAskA")), "| haptic pulses:", log.haptic.length, "| chime:", log.audio.length);
const conv = names.filter((n) => n.startsWith("TxConv")).map((n) => text.get(n)).filter(Boolean);
assert.ok(conv.some((l) => l.startsWith("Claude: ")), "Claude's words on the wall");
assert.ok([...position.keys()].length > 0, "conversation lines were shifted to read left-aligned");

press("BtnApprove");
await until(() => /DONE/.test(text.get("TxHeader") ?? ""), "the job to finish");
console.log("5. finished:", text.get("TxHeader"));

press("BtnBack");
await until(() => visible.get("WallPanel") === true, "the wall");
assert.match(text.get("TxDone") ?? "", /^Done today: 1/);
assert.equal(created.size, 0, "one done job shows the authored chip only (no copies)");
console.log("6. back on the wall:", JSON.stringify(text.get("TxDone")));

for (const [n, t] of text) assert.ok(Buffer.byteLength(t) <= 128, `${n} over 128 bytes`);
console.log(`PASS: the built world.wasm drove the real bridge end to end (${log.klog.length} k_log lines, ${text.size} labels showing).`);
server.close();
await bridge.shutdown();
process.exit(0);
