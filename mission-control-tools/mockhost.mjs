// mockhost.mjs -- runs the BUILT Lobby program against the REAL bridge, end to end, without a headset.
//
// @kosmos-system Content (KosmosWorlds) -- Mission Control (DB-044)
// @kosmos-owner  Content lane
//
// A Node stand-in for the Kosmos host: it implements every kosmos.* import the program
// uses (nodes, world text, visibility, transforms and rotations, clones, events, the
// typing sheet, haptics, audio, k_log, and k_net_* over real HTTP to a bridge on
// 127.0.0.1 with the scripted fake adapter). It runs TWO copies of the program, each with
// its own memory, the way two headsets would:
//
//   the owner:   the Lobby loads (music starts, zero network calls), the ritual (press the
//                seal, type the passphrase), the wall, a preset, the approval with two
//                pulses and a chime, Approve, the job finishes, Group watch on;
//   a watcher:   presses the Watch button, types the code, gets the read-only copy turned
//                to face the hall; its presses send nothing; it never buzzes;
//   the owner:   Close parks the panel; the watcher's next update is refused.
//
// It checks the program against the bridge. It does NOT check the headset: rendering, the
// real typing sheet and real haptics are the device checkpoint's job.
//
// Usage (after `npm run build` in agent-bridge and building world.wasm):
//   node mission-control-tools/mockhost.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.AGENT_BRIDGE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "mc-mockhost-"));
const dist = path.join(repo, "agent-bridge", "dist", "src");
const load = (p) => import(pathToFileURL(path.join(dist, p)).href);
const { Bridge } = await load("bridge.js");
const { FakeAdapter } = await load("adapters/fake.js");
const { createServer } = await load("server.js");
const { MissionControlFace } = await load("faces/mission-control/index.js");
const { hashPassphrase, defaultConfig } = await load("config.js");

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

const nodes = JSON.parse(fs.readFileSync(path.join(repo, "mission-control", "nodes.json"), "utf8"));
const names = [...nodes.text, ...nodes.buttons, ...nodes.show, ...nodes.world];
const wasm = fs.readFileSync(path.join(repo, "mission-control", "world.wasm"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One headset: its own memory, scene state and network queue. */
async function headset(label) {
  const handleOf = new Map(names.map((n, i) => [n, i + 1]));
  const nameOf = new Map(names.map((n, i) => [i + 1, n]));
  const hs = {
    label,
    text: new Map(),
    visible: new Map(),
    position: new Map(),
    rotation: new Map(),
    created: new Map(),
    subs: new Map(),
    globals: new Map(),
    log: { haptic: [], audio: [], music: [], klog: [], prompts: [], fetches: [] },
    net: { pending: 0, done: [], bodies: new Map() },
  };
  let nextHandle = 1000;
  const memory = new WebAssembly.Memory({ initial: 17, maximum: 256 });
  const bytes = (p, l) => new Uint8Array(memory.buffer, p, l);
  const str = (p, l) => new TextDecoder().decode(bytes(p, l));
  const f32 = (p, v) => new DataView(memory.buffer).setFloat32(p, v, true);
  const kosmos = {
    k_node_find: (p, l) => handleOf.get(str(p, l)) ?? 0,
    k_node_set_visible: (h, v) => (hs.visible.set(nameOf.get(h) ?? h, v !== 0), 0),
    k_node_clone: (_s, _p, p, l) => (hs.created.set(nextHandle, str(p, l)), nextHandle++),
    k_node_destroy: (h) => (hs.created.delete(h), 0),
    k_transform_get_position: (h, x, y, z) => {
      // Authored parked: 200 m below a Lobby-like spot in front of the throne.
      f32(x, 11.9);
      f32(y, 3.0 - 200);
      f32(z, 0);
      return 0;
    },
    k_transform_set_position: (h, x, y, z) => (hs.position.set(nameOf.get(h) ?? h, [x, y, z]), 0),
    k_transform_set_scale: () => 0,
    k_transform_get_rotation: (h, p, y, r) => (f32(p, 0), f32(y, 180), f32(r, 0), 0),
    k_transform_set_rotation: (h, p, y, r) => (hs.rotation.set(nameOf.get(h) ?? h, [p, y, r]), 0),
    k_ui_show_world_text: (h, p, l) => (l > 128 ? -7 : (hs.text.set(nameOf.get(h), str(p, l)), 0)),
    k_ui_hide_world_text: (h) => (hs.text.delete(nameOf.get(h)), 0),
    k_ui_prompt: (qp, ql, out, cap, id) => (hs.log.prompts.push({ q: str(qp, ql), out, cap, id }), 0),
    k_event_subscribe: (_p, _l, h, fn) => (hs.subs.set(h, fn), 1),
    k_event_subscribe_global: (p, l, fn) => (hs.globals.set(str(p, l), fn), 1),
    k_haptic_pulse: (hand, intensity, ms) => (hs.log.haptic.push({ hand, intensity, ms }), 0),
    k_audio_play: (_n, p, l) => (hs.log.audio.push(str(p, l)), 0),
    k_audio_play_ex: (_n, p, l, vol) => (hs.log.music.push([str(p, l), Math.round(vol * 100) / 100]), 0),
    k_audio_stop: () => 0,
    k_log: (_lv, p, l) => (hs.log.klog.push(str(p, l)), 0),
    k_net_status: () => 1,
    k_net_fetch: (method, up, ul, bp, bl, _flags, id) => {
      const url = str(up, ul);
      const body = Buffer.from(bytes(bp, bl));
      if (bl > 16384) return -5;
      if (hs.net.pending >= 4) return -6;
      hs.log.fetches.push(url.replace(/^https:\/\/[^/]+/, ""));
      const local = url.replace(/^https:\/\/[^/]+/, `http://127.0.0.1:${port}`);
      hs.net.pending++;
      fetch(local, { method: method === 1 ? "POST" : "GET", body: method === 1 ? body : undefined, headers: { "X-World-Address": "lobby.micknerks", "Content-Type": "text/plain" } })
        .then(async (r) => ({ id, status: r.status, body: Buffer.from(await r.arrayBuffer()) }))
        .catch(() => ({ id, status: 0, body: Buffer.alloc(0) }))
        .then((res) => {
          hs.net.pending--;
          hs.net.done.push(res);
        });
      return 0;
    },
    k_net_read: (id, out, cap) => {
      const b = hs.net.bodies.get(id);
      if (!b) return -7;
      if (cap === 0) return b.length;
      const n = Math.min(cap, b.length);
      bytes(out, n).set(b.subarray(0, n));
      return n;
    },
  };
  const { instance } = await WebAssembly.instantiate(wasm, { env: { memory }, kosmos });
  const table = instance.exports.__indirect_function_table;
  hs.call = (fn, ...a) => table.get(fn)(...a);
  hs.tick = (dt = 0.05) => {
    hs.net.bodies.clear();
    for (const res of hs.net.done.splice(0)) {
      hs.net.bodies.set(res.id, res.body);
      hs.call(hs.globals.get("OnNetResult"), 0, 0, res.id, res.status);
    }
    instance.exports.k_tick(dt);
  };
  hs.press = (name) => hs.call(hs.subs.get(handleOf.get(name)), 0, handleOf.get(name), 0, 0);
  hs.answer = (s) => {
    const p = hs.log.prompts.at(-1);
    const b = new TextEncoder().encode(s);
    bytes(p.out, b.length).set(b);
    hs.call(hs.globals.get("OnPromptResult"), 0, 0, p.id, b.length);
  };
  instance.exports.k_init();
  return hs;
}

async function until(hss, pred, what, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    for (const h of hss) h.tick();
    if (pred()) return;
    await sleep(20);
  }
  throw new Error(`timed out waiting for ${what}`);
}

// --- the visit ----------------------------------------------------------------


const owner = await headset("owner");
assert.deepEqual(owner.log.music[0], ["lobby_ypsilon_01.ogg", 0.4], "the Lobby's music starts as before");
for (let i = 0; i < 60; i++) owner.tick();
assert.equal(owner.log.fetches.length, 0, "a Lobby visitor's program makes no network call");
console.log("1. Lobby loaded: music on, panel parked, zero network calls");

owner.press("McSeal");
assert.match(owner.log.prompts.at(-1).q, /passphrase/);
owner.answer(PASS);
assert.equal(owner.log.fetches[0], "/v1/faces/mission-control/signin", "the first call is the sign-in");
await until([owner], () => /working/.test(owner.text.get("TxTicker") ?? ""), "the wall after the ritual");
assert.equal(owner.position.get("TxTicker")[1], 3.0, "the panel rose 200 m to its place");
console.log("2. ritual + sign-in: the panel rose; ticker:", owner.text.get("TxTicker"));

owner.press("BtnTests");
await until([owner], () => owner.visible.get("BtnApprove") === true, "the inline approval");
await until([owner], () => owner.log.haptic.length >= 2, "the second pulse");
assert.equal(owner.log.audio.filter((a) => a === "chime.wav").length, 1);
assert.ok(owner.log.haptic.every((h) => h.hand === 2));
console.log("3. approval:", JSON.stringify(owner.text.get("TxAskA")), "| pulses:", owner.log.haptic.length, "| chime: 1");
owner.press("BtnApprove");
await until([owner], () => /DONE/.test(owner.text.get("TxHeader") ?? ""), "the job to finish");
owner.press("BtnBack");
await until([owner], () => owner.visible.get("WallPanel") === true, "the wall");
owner.press("BtnWatch");
await until([owner], () => /code \d{3} \d{3}/.test(owner.text.get("TxWatch") ?? ""), "the watch code");
const code = /code (\d{3}) (\d{3})/.exec(owner.text.get("TxWatch")).slice(1).join("");
console.log("4. done; group watch on:", owner.text.get("TxWatch"));

const watcher = await headset("watcher");
watcher.press("McWatchJoin");
watcher.answer(code.slice(0, 3) + " " + code.slice(3));
await until([owner, watcher], () => watcher.text.get("TxWatch") === "Watching (read-only)", "the watcher's copy");
assert.ok(watcher.log.fetches.every((f) => f === "/v1/faces/mission-control/watch"), "a watcher only ever asks to watch");
assert.equal(watcher.rotation.get("TxTicker")?.[1], 360, "turned 180 degrees to face the hall");
const before = watcher.log.fetches.length;
watcher.press("BtnTests");
watcher.tick();
assert.equal(watcher.log.fetches.length, before, "a watcher's press sends nothing");
assert.equal(watcher.log.haptic.length, 0, "a watcher never buzzes");
console.log("5. watcher:", JSON.stringify(watcher.text.get("TxStatus")));

owner.press("McClose");
for (let i = 0; i < 5; i++) owner.tick();
assert.equal(owner.position.get("TxTicker")[1], 3.0 - 200, "Close parks the panel again");
await until([watcher], () => /Nobody is sharing|owner has left/.test(watcher.text.get("TxStatus") ?? ""), "the watcher refused after the owner left", 12000);
console.log("6. owner closed (signed out, parked); watcher told:", JSON.stringify(watcher.text.get("TxStatus")));

for (const h of [owner, watcher]) for (const [n, t] of h.text) assert.ok(Buffer.byteLength(t) <= 128, `${h.label} ${n} over 128 bytes`);
console.log("PASS: two copies of the built Lobby program drove the real bridge end to end.");
server.close();
await bridge.shutdown();
process.exit(0);
