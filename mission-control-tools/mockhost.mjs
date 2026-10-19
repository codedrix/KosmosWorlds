// mockhost.mjs -- runs the BUILT Lobby program (Mission Control v2) against the REAL bridge, end
// to end, without a headset.
//
// @kosmos-system Content (KosmosWorlds) -- Mission Control (DB-044 addendum, V2_CONTRACT.md)
// @kosmos-owner  Content lane
//
// A Node stand-in for the Kosmos host: it implements every kosmos.* import the program uses
// (nodes, world text, visibility, transforms, events, the typing sheet, haptics, audio, k_log,
// and k_net_* over real HTTP to a bridge on 127.0.0.1 with the scripted fake adapter). It runs
// TWO copies of the program, each with its own memory, the way two headsets would:
//
//   the owner:   the Lobby loads (music, zero network calls); presses the seal: the ring rises
//                with a code; the code is approved AT THE PC by writing it into the bridge's
//                PAIR_APPROVE file (as `npm run approve -- <code>` does); the ring locks, the
//                ledge and the puck grow in; CubePlus unfolds the arc; a preset raises an
//                approval (two pulses, one chime, the puck goes amber with the command);
//                Approve on the PUCK, without the arc; Fold; a cube unfolds it again; Group
//                watch on;
//   a watcher:   types the code at the Watch post and gets the arc only, turned to face the
//                hall; never the ledge, the puck or the seal; its presses send nothing; it
//                never buzzes;
//   the owner:   Close parks everything; the watcher's next update is refused.
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
const home = fs.mkdtempSync(path.join(os.tmpdir(), "mc-mockhost-"));
process.env.AGENT_BRIDGE_HOME = home;
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
const PARKED_Y = 3.0 - 200;

/** One headset: its own memory, scene state and network queue. */
async function headset(label) {
  const handleOf = new Map(names.map((n, i) => [n, i + 1]));
  const nameOf = new Map(names.map((n, i) => [i + 1, n]));
  const hs = {
    label,
    text: new Map(),
    visible: new Map(),
    position: new Map(),
    scale: new Map(),
    rotation: new Map(),
    subs: new Map(),
    globals: new Map(),
    log: { haptic: [], audio: [], music: [], klog: [], prompts: [], fetches: [] },
    net: { pending: 0, done: [], bodies: new Map() },
  };
  const memory = new WebAssembly.Memory({ initial: 17, maximum: 256 });
  const bytes = (p, l) => new Uint8Array(memory.buffer, p, l);
  const str = (p, l) => new TextDecoder().decode(bytes(p, l));
  const f32 = (p, v) => new DataView(memory.buffer).setFloat32(p, v, true);
  const kosmos = {
    k_node_find: (p, l) => handleOf.get(str(p, l)) ?? 0,
    k_node_set_visible: (h, v) => (hs.visible.set(nameOf.get(h) ?? h, v !== 0), 0),
    k_transform_get_position: (h, x, y, z) => {
      // Authored parked: 200 m below the Lobby, a distinct spot per node.
      f32(x, 12.0 + h * 0.01);
      f32(y, PARKED_Y);
      f32(z, -h * 0.01);
      return 0;
    },
    k_transform_set_position: (h, x, y, z) => (hs.position.set(nameOf.get(h) ?? h, [x, y, z]), 0),
    k_transform_set_scale: (h, x) => (hs.scale.set(nameOf.get(h) ?? h, x), 0),
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
      hs.log.fetches.push({ path: url.replace(/^https:\/\/[^/]+/, ""), body: body.toString("utf8") });
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
  hs.press = (name) => {
    const fn = hs.subs.get(handleOf.get(name));
    assert.ok(fn !== undefined, `${label}: ${name} has no press handler`);
    hs.call(fn, 0, handleOf.get(name), 0, 0);
  };
  hs.answer = (s) => {
    const p = hs.log.prompts.at(-1);
    const b = new TextEncoder().encode(s);
    bytes(p.out, b.length).set(b);
    hs.call(hs.globals.get("OnPromptResult"), 0, 0, p.id, b.length);
  };
  hs.shown = (n) => hs.visible.get(n) === true;
  hs.paths = () => hs.log.fetches.map((f) => f.path);
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
const near = (a, b) => a && b && a.every((v, k) => Math.abs(v - b[k]) < 1e-3);
const ARC = ["McCenterFrame", "McLeftFrame", "McRightFrame"];

// --- the visit ----------------------------------------------------------------

const owner = await headset("owner");
assert.deepEqual(owner.log.music[0], ["lobby_ypsilon_01.ogg", 0.4], "the Lobby's music starts as before");
for (let i = 0; i < 60; i++) owner.tick();
assert.equal(owner.log.fetches.length, 0, "a Lobby visitor's program makes no network call");
console.log("1. Lobby loaded: music on, everything parked, zero network calls");

// The Pairing Seal: the first call mints a pairing; the ring shows the code.
owner.press("McSeal");
assert.equal(owner.paths()[0], "/v1/faces/mission-control/pair", "the first call mints a pairing");
assert.ok(!/\bpair |\btok /.test(owner.log.fetches[0].body), "a mint carries no id and no token");
await until([owner], () => /^[A-Z]{3} [A-Z]{3}$/.test(owner.text.get("TxSeal") ?? ""), "the code on the ring");
assert.ok(owner.shown("SealRing") && owner.shown("SealRingArmed"), "the ring is up, armed");
assert.ok(!owner.shown("McLedge") && !owner.shown("Puck") && !owner.shown("McCenterFrame"));
const code = owner.text.get("TxSeal");
await until([owner], () => owner.log.fetches.some((f) => /\npair [0-9a-f]{32}\n/.test(f.body)), "a pair poll with the id");
console.log("2. seal raised; ring shows", JSON.stringify(code), "; polling pair");

// Approve AT THE PC: what `npm run approve -- <code>` does (V2_CONTRACT section 5).
fs.writeFileSync(path.join(home, "PAIR_APPROVE"), code.replace(/\s+/g, "-"));
await until([owner], () => owner.shown("SealRingLocked"), "the ring to lock", 10000);
await until([owner], () => owner.shown("McLedge") && owner.shown("CubePlus") && owner.shown("Puck"), "the ledge and the puck");
await until([owner], () => !owner.shown("SealRing") && (owner.scale.get("McLedge") ?? 1) === 1, "the grow-in to finish");
assert.ok(!owner.text.has("TxSeal"), "the code is gone");
assert.ok(!owner.shown("McCenterFrame"), "cubes: the arc is folded");
assert.ok(!owner.log.fetches.some((f) => /\npair /.test(f.body) && /\ntok /.test(f.body)));
await until([owner], () => owner.paths().at(-1) === "/v1/faces/mission-control/view", "polling view with the token");
console.log("3. paired at the PC: the ring locked, the ledge and the puck grew in");

// CubePlus unfolds the arc from itself.
const plusAt = owner.position.get("CubePlus");
owner.press("CubePlus");
await until([owner], () => owner.shown("McCenterFrame"), "the unfold to start");
assert.ok((owner.scale.get("McCenterFrame") ?? 1) < 0.5, "it starts small");
assert.ok(near(owner.position.get("McCenterFrame"), plusAt) || owner.scale.get("McCenterFrame") > 0.02, "it starts at the cube");
await until([owner], () => owner.scale.get("McCenterFrame") === 1 && owner.text.has("TxProject"), "the unfold to end, words shown");
assert.ok(!owner.shown("CubePlus"), "the picked cube became the arc");
console.log("4. CubePlus unfolded the arc; project:", owner.text.get("TxProject"));

// A job raises an approval: the puck goes amber with its label; two pulses, one chime.
owner.press("BtnTests");
await until([owner], () => owner.shown("PuckNeed") && owner.shown("BtnPuckApprove"), "the puck to ask");
await until([owner], () => owner.log.haptic.length >= 2, "the second pulse");
assert.equal(owner.log.audio.filter((a) => a === "chime.wav").length, 1);
assert.ok(owner.log.haptic.every((h) => h.hand === 2));
console.log("5. approval on the puck:", JSON.stringify(owner.text.get("TxPuck")), "| pulses:", owner.log.haptic.length, "| chime: 1");

// Fold first: the puck approves without the arc.
owner.press("BtnFold");
await until([owner], () => !owner.text.has("TxHeader"), "the words to hide at once", 3000);
await until([owner], () => ARC.every((n) => !owner.shown(n)) && owner.shown("CubePlus"), "the fold to finish");
owner.press("BtnPuckApprove");
await until([owner], () => !owner.shown("PuckNeed"), "the approval to clear");
console.log("6. folded; approved on the puck without the arc");

// A job cube unfolds the arc on that job; Group watch on.
await until([owner], () => ["CubeA", "CubeB", "CubeC", "CubeD"].some((c) => owner.shown(c)), "a job cube");
const cube = ["CubeA", "CubeB", "CubeC", "CubeD"].find((c) => owner.shown(c));
owner.press(cube);
await until([owner], () => owner.scale.get("McCenterFrame") === 1 && owner.text.has("TxHeader"), "the arc on the job");
assert.ok(!owner.shown(cube), "its cube became the arc");
owner.press("BtnWatch");
await until([owner], () => /code \d{3} \d{3}/.test(owner.text.get("TxWatch") ?? ""), "the watch code");
const watchCode = /code (\d{3}) (\d{3})/.exec(owner.text.get("TxWatch")).slice(1).join("");
console.log("7.", cube, "unfolded the arc on its job; group watch on:", owner.text.get("TxWatch"));

const watcher = await headset("watcher");
watcher.press("McWatchJoin");
watcher.answer(watchCode.slice(0, 3) + " " + watchCode.slice(3));
await until([owner, watcher], () => watcher.shown("McCenterFrame") && watcher.text.has("TxHeader"), "the watcher's arc");
assert.ok(watcher.paths().every((p) => p === "/v1/faces/mission-control/watch"), "a watcher only ever asks to watch");
assert.ok(watcher.log.fetches.every((f) => !/\ntok |\npair |\npress /.test(f.body)), "no token, no pairing, no press");
assert.equal(watcher.rotation.get("McCenterFrame")?.[1], 360, "the arc is turned 180 degrees to face the hall");
for (const n of ["McLedge", "CubePlus", "Puck", "PuckNeed", "SealRing", "BtnPuckApprove"]) assert.ok(!watcher.shown(n), `a watcher never sees ${n}`);
for (const n of ["TxCubeA", "TxPuck", "TxSeal"]) assert.ok(!watcher.text.has(n), `a watcher never sees ${n}`);
const before = watcher.log.fetches.length;
watcher.press("BtnTests");
watcher.tick();
assert.equal(watcher.log.fetches.length, before, "a watcher's press sends nothing");
assert.equal(watcher.log.haptic.length, 0, "a watcher never buzzes");
console.log("8. watcher: the arc only, turned; status", JSON.stringify(watcher.text.get("TxStatus")));

owner.press("McClose");
for (let i = 0; i < 5; i++) owner.tick();
for (const n of ["McCenterFrame", "McLedge", "Puck", "SealRing"]) {
  assert.equal(owner.position.get(n)?.[1], PARKED_Y, `Close parks ${n}`);
  assert.ok(!owner.shown(n));
}
await until([watcher], () => watcher.log.fetches.length > before + 1 && !/Watching/.test(watcher.text.get("TxStatus") ?? "Watching"), "the watcher refused after the owner left", 12000);
console.log("9. owner closed (signed out, parked); watcher told:", JSON.stringify(watcher.text.get("TxStatus")));

for (const h of [owner, watcher]) for (const [n, t] of h.text) assert.ok(Buffer.byteLength(t) <= 128, `${h.label} ${n} over 128 bytes`);
console.log("PASS: two copies of the built Lobby program drove the real bridge end to end (v2).");
server.close();
await bridge.shutdown();
process.exit(0);
