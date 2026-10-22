#!/usr/bin/env node
/**
 * build_glb.mjs -- writes type-test/world/world.glb for Type Test.
 *
 * @kosmos-system  Content (KosmosWorlds) -- Type Test (temporary)
 * @kosmos-owner   Type Test (writer copied from more-room/tools/build_glb.mjs)
 *
 * Usage (from the repo root): node type-test/tools/build_glb.mjs
 *
 * No dependencies and no Blender: a hand-written glTF, byte-for-byte
 * deterministic, no textures at all. Coordinates are glTF: metres, Y up. The
 * spawn is the origin and the visitor faces +X; +Z is their right. at(r, deg, y)
 * is a point r metres out at deg (0 = straight ahead, + = right).
 *
 * The room: a 6 x 6 m dark floor, four dark walls 2.8 m tall, sky "night"
 * (manifest). Ahead, at chest height 1.5 m out, two buttons; above each its
 * result plaque and below it its status plaque, both 12 cm farther out than the
 * button so a laser that reaches a button always hits the button first. Higher
 * up and farther out, the title and the navigate-check plaque.
 *
 * Text (KWorldTextPool.cpp, Build 1013): white 8 cm Roboto, bottom-aligned,
 * printed flat on a thin upright plane's face a hair in front, centred on the
 * mesh's bounds. Every plaque carries an invisible keel under it so a block of
 * n lines sits centred on the plaque (the More Room pattern). Every node the
 * script finds has a mesh and an extra, and no name ends in a digit.
 *
 * @integration
 *   @kosmos-nodes  must build exactly the names in script/src/lib.rs NODES and OTHER_NODES (checked below).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const RAD = Math.PI / 180;
const at = (r, deg, y) => [r * Math.cos(deg * RAD), y, r * Math.sin(deg * RAD)];
const facing = (deg) => -deg * RAD;

// ---------------------------------------------------------------------------
// The glTF writer (more-room/tools/build_glb.mjs, trimmed to boxes)
// ---------------------------------------------------------------------------

function geom() {
  return { pos: [], nrm: [], idx: [], uv: null };
}
function quad(g, a, b, c, d, n) {
  const base = g.pos.length / 3;
  for (const p of [a, b, c, d]) g.pos.push(...p);
  for (let k = 0; k < 4; k++) g.nrm.push(...n);
  g.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
function boxGeom(size, c = [0, 0, 0]) {
  const g = geom();
  const [hx, hy, hz] = size.map((v) => v / 2);
  const P = (x, y, z) => [c[0] + x, c[1] + y, c[2] + z];
  quad(g, P(hx, -hy, hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), [1, 0, 0]);
  quad(g, P(-hx, -hy, -hz), P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz), [-1, 0, 0]);
  quad(g, P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz), P(-hx, hy, -hz), [0, 1, 0]);
  quad(g, P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz), [0, -1, 0]);
  quad(g, P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz), [0, 0, 1]);
  quad(g, P(hx, -hy, -hz), P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz), [0, 0, -1]);
  return g;
}

class Gltf {
  constructor(generator) {
    this.j = {
      asset: { version: "2.0", generator },
      scene: 0,
      scenes: [{ name: "Scene", nodes: [] }],
      nodes: [],
      meshes: [],
      materials: [],
      accessors: [],
      bufferViews: [],
      buffers: [{ byteLength: 0 }],
    };
    this.chunks = [];
    this.byteLength = 0;
    this.materialIndex = new Map();
    this.names = new Set();
    this.used = new Set();
  }
  /** Unlit (KHR_materials_unlit, allowlisted); opts.alpha < 1 makes it BLEND. */
  material(name, rgb, opts = {}) {
    if (this.materialIndex.has(name)) return this.materialIndex.get(name);
    const i = this.j.materials.length;
    const m = {
      name,
      pbrMetallicRoughness: { baseColorFactor: [...rgb, opts.alpha ?? 1], metallicFactor: 0, roughnessFactor: 0.9 },
    };
    if (opts.alpha !== undefined && opts.alpha < 1) m.alphaMode = "BLEND";
    m.extensions = { KHR_materials_unlit: {} };
    this.used.add("KHR_materials_unlit");
    this.j.materials.push(m);
    this.materialIndex.set(name, i);
    return i;
  }
  view(bytes, target) {
    const pad = (4 - (this.byteLength % 4)) % 4;
    if (pad) {
      this.chunks.push(Buffer.alloc(pad));
      this.byteLength += pad;
    }
    const i = this.j.bufferViews.length;
    const v = { buffer: 0, byteOffset: this.byteLength, byteLength: bytes.length };
    if (target) v.target = target;
    this.j.bufferViews.push(v);
    this.chunks.push(bytes);
    this.byteLength += bytes.length;
    return i;
  }
  mesh(name, parts) {
    const a = this.j.accessors;
    const primitives = parts.map(([gm, materialIndex]) => {
      const n = gm.pos.length / 3;
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let v = 0; v < n; v++) {
        for (let k = 0; k < 3; k++) {
          const x = Math.fround(gm.pos[v * 3 + k]);
          if (x < min[k]) min[k] = x;
          if (x > max[k]) max[k] = x;
        }
      }
      const posA = a.length;
      a.push({ bufferView: this.view(Buffer.from(new Float32Array(gm.pos).buffer), 34962), componentType: 5126, count: n, type: "VEC3", min, max });
      const nrmA = a.length;
      a.push({ bufferView: this.view(Buffer.from(new Float32Array(gm.nrm).buffer), 34962), componentType: 5126, count: n, type: "VEC3" });
      const idxA = a.length;
      a.push({ bufferView: this.view(Buffer.from(new Uint16Array(gm.idx).buffer), 34963), componentType: 5123, count: gm.idx.length, type: "SCALAR" });
      return { attributes: { POSITION: posA, NORMAL: nrmA }, indices: idxA, material: materialIndex, mode: 4 };
    });
    const m = this.j.meshes.length;
    this.j.meshes.push({ name, primitives });
    return m;
  }
  node(name, t, parts, extras, yawRad = 0) {
    if (this.names.has(name)) throw new Error(`duplicate node name ${name}`);
    if (/_?\d$/.test(name)) throw new Error(`node name ends in a digit (the client strips it): ${name}`);
    this.names.add(name);
    const node = { name, mesh: this.mesh(name, parts), translation: t.map((v) => Math.round(v * 1e5) / 1e5) };
    if (yawRad) node.rotation = [0, Math.sin(yawRad / 2), 0, Math.cos(yawRad / 2)];
    if (extras) node.extras = extras;
    this.j.scenes[0].nodes.push(this.j.nodes.length);
    this.j.nodes.push(node);
  }
  empty(name, t, extras) {
    this.names.add(name);
    this.j.scenes[0].nodes.push(this.j.nodes.length);
    this.j.nodes.push({ name, translation: t, extras });
  }
  glb() {
    const bin = Buffer.concat(this.chunks);
    const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
    this.j.buffers[0].byteLength = bin.length;
    if (this.used.size) this.j.extensionsUsed = [...this.used].sort();
    let jsonBuf = Buffer.from(JSON.stringify(this.j), "utf8");
    jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binPadded.length, 8);
    const jh = Buffer.alloc(8);
    jh.writeUInt32LE(jsonBuf.length, 0);
    jh.writeUInt32LE(0x4e4f534a, 4);
    const bh = Buffer.alloc(8);
    bh.writeUInt32LE(binPadded.length, 0);
    bh.writeUInt32LE(0x004e4942, 4);
    return Buffer.concat([header, jh, jsonBuf, bh, binPadded]);
  }
}

// ---------------------------------------------------------------------------
// Text measures (Roboto Regular, KosmosWorlds agent-bridge/src/roboto-advance.ts)
// ---------------------------------------------------------------------------

const ROBOTO_ADVANCE_EM = [
  0.1873, 0.1983, 0.2697, 0.4695, 0.4389, 0.5511, 0.4695, 0.1637, 0.2498, 0.2528, 0.3252, 0.4275,
  0.1486, 0.3396, 0.2016, 0.3127, 0.4242, 0.4242, 0.4242, 0.4242, 0.4242, 0.4242, 0.4242, 0.4242,
  0.4242, 0.4242, 0.1902, 0.1932, 0.3826, 0.4242, 0.3944, 0.3584, 0.6744, 0.4765, 0.479, 0.4772,
  0.5103, 0.4157, 0.4157, 0.5103, 0.5302, 0.213, 0.4132, 0.479, 0.4143, 0.6545, 0.5305, 0.5136,
  0.479, 0.525, 0.4794, 0.4606, 0.4507, 0.5099, 0.4765, 0.6486, 0.4765, 0.4765, 0.4507, 0.2031,
  0.3113, 0.2031, 0.3149, 0.3425, 0.2358, 0.4143, 0.4283, 0.3944, 0.4283, 0.3944, 0.248, 0.4283,
  0.4283, 0.1898, 0.195, 0.3863, 0.1898, 0.6586, 0.4283, 0.4283, 0.4283, 0.4283, 0.2638, 0.394,
  0.2539, 0.4283, 0.379, 0.5703, 0.379, 0.379, 0.379, 0.2561, 0.1865, 0.2561, 0.5118,
];
const GLYPH_M = 0.08;
/** Width in metres of one line of ASCII at 8 cm. */
const lineW = (s) => [...s].reduce((w, c) => w + (ROBOTO_ADVANCE_EM[c.charCodeAt(0) - 32] ?? 0.6745) * GLYPH_M, 0);
/** The height of a block of n lines (8 cm glyphs, spaced). */
const textH = (n) => 0.08 + (n - 1) * 0.084;

// ---------------------------------------------------------------------------
// The room
// ---------------------------------------------------------------------------

const PRESS = { interactable: true };
const anchor = (role) => ({ script_node: role });
const FRONT = -0.006;

function palette(g) {
  return {
    floor: g.material("Floor", [0.006, 0.007, 0.011]),
    wall: g.material("Wall", [0.012, 0.014, 0.022]),
    glass: g.material("Panel", [0.006, 0.01, 0.018]),
    button: g.material("Button", [0.02, 0.06, 0.08]),
    cyan: g.material("LightCyan", [0.37, 0.9, 1.0]),
    amber: g.material("LightAmber", [0.95, 0.66, 0.23]),
    teal: g.material("LightTeal", [0.12, 0.45, 0.55]),
    // Fully transparent: the keel exists only to move the mesh's rendered centre.
    stud: g.material("Unseen", [0, 0, 0], { alpha: 0 }),
  };
}

/** Light bars along a panel's top and bottom edges (in front of its face, toward the spawn). */
function lightBars(w, h, d, mat) {
  const t = 0.004;
  const x = -d / 2 + FRONT;
  return [
    [boxGeom([0.004, t, w * 0.96], [x, h / 2 - t / 2, 0]), mat],
    [boxGeom([0.004, t, w * 0.96], [x, -h / 2 + t / 2, 0]), mat],
  ];
}

/**
 * A plaque facing the spawn at (r, deg, y): w wide, h tall, d deep, with a keel
 * so maxLines lines of text sit centred on it. `lines` are the widest texts it
 * will carry (checked to fit).
 */
function plaque(g, P, name, r, deg, y, w, h, d, maxLines, lines, bodyMat, barMat, extras) {
  if (textH(maxLines) > h) throw new Error(`${name}: ${maxLines} lines do not fit ${h} m`);
  if (d > 0.2 * Math.min(w, h)) throw new Error(`${name}: ${d} m deep is not a thin plane`);
  for (const s of lines) {
    if (s.split("\n").length > maxLines) throw new Error(`${name}: too many lines in ${JSON.stringify(s)}`);
    for (const l of s.split("\n")) {
      if (lineW(l) > w * 0.97) throw new Error(`${name}: "${l}" is ${lineW(l).toFixed(3)} m, wider than ${w} m`);
    }
  }
  const k = textH(maxLines) / 2;
  const keel = [boxGeom([0.002, 2 * k, 0.002], [0, -h / 2 - k, 0]), P.stud];
  g.node(name, at(r, deg, y), [[boxGeom([d, h, w]), bodyMat], ...lightBars(w, h, d, barMat), keel], extras, facing(deg));
}

/** The widest texts each plaque carries (mirrors script/src/lib.rs; its tests check bytes and lines). */
const WIDEST = {
  label: ["Press to type (plain)", "Press to type (password)"],
  title: ["Type test: host API level 5\nThis headset reports level -2147483648\nEnter on a pressed field opens the other"],
  nav: ["After Enter, k_world_navigate\nreturned -2147483648"],
  result: ["You typed:\nWWWWWWWWWWWWWWWWWWWWWW\nWWWWWWWWWWWWWWWWWWWWWW\nWWWW", "Password received:\n128 characters"],
  status: ["open: yes (Enter or press), again -6\ntext: read error -2147483648\nended: taken by Kosmos", "open: retrying, begin -2147483648", "open: yes (Enter or press), begin 0\ntext: yes, 128 characters"],
};

export function build() {
  const g = new Gltf("KosmosWorlds type-test/tools/build_glb.mjs");
  const P = palette(g);

  // A small dark room. Sky "night" shows above the walls.
  // The script finds these too and notes presses on them (a press on any mesh opens the activation window).
  const ROOM = anchor("room");
  g.node("Floor", [0, -0.05, 0], [[boxGeom([6, 0.1, 6]), P.floor]], ROOM);
  g.node("WallFront", [3.05, 1.4, 0], [[boxGeom([0.1, 2.8, 6.2]), P.wall]], ROOM);
  g.node("WallBack", [-3.05, 1.4, 0], [[boxGeom([0.1, 2.8, 6.2]), P.wall]], ROOM);
  g.node("WallLeft", [0, 1.4, -3.05], [[boxGeom([6.2, 2.8, 0.1]), P.wall]], ROOM);
  g.node("WallRight", [0, 1.4, 3.05], [[boxGeom([6.2, 2.8, 0.1]), P.wall]], ROOM);
  g.empty("spawn_point", [0, 0, 0], { spawn_point: true });

  // The two press targets, 1.5 m out, chest height, plain left and password right.
  const BTN = { r: 1.5, deg: 24, y: 1.3, w: 1.0, h: 0.16, d: 0.025 };
  plaque(g, P, "BtnPlain", BTN.r, -BTN.deg, BTN.y, BTN.w, BTN.h, BTN.d, 1, [WIDEST.label[0]], P.button, P.cyan, PRESS);
  plaque(g, P, "BtnPassword", BTN.r, BTN.deg, BTN.y, BTN.w, BTN.h, BTN.d, 1, [WIDEST.label[1]], P.button, P.amber, PRESS);

  // Result above, status below, 12 cm farther out than the buttons.
  const COL = { r: 1.62, w: 1.25, d: 0.006 };
  plaque(g, P, "TxtPlainResult", COL.r, -BTN.deg, 1.66, COL.w, 0.38, COL.d, 4, WIDEST.result, P.glass, P.teal, anchor("result"));
  plaque(g, P, "TxtPassResult", COL.r, BTN.deg, 1.66, COL.w, 0.38, COL.d, 4, WIDEST.result, P.glass, P.teal, anchor("result"));
  plaque(g, P, "TxtPlainStatus", COL.r, -BTN.deg, 0.96, COL.w, 0.3, COL.d, 3, WIDEST.status, P.glass, P.teal, anchor("status"));
  plaque(g, P, "TxtPassStatus", COL.r, BTN.deg, 0.96, COL.w, 0.3, COL.d, 3, WIDEST.status, P.glass, P.teal, anchor("status"));

  // The title and the navigate check, high and farther out, straight ahead.
  plaque(g, P, "TxtTitle", 2.7, 0, 2.42, 1.95, 0.3, 0.008, 3, WIDEST.title, P.glass, P.cyan, anchor("title"));
  plaque(g, P, "TxtNav", 2.7, 0, 2.08, 1.45, 0.22, 0.008, 2, WIDEST.nav, P.glass, P.teal, anchor("nav"));

  // The script's node contract: every name in NODES and OTHER_NODES, and every mesh is one of them.
  const lib = fs.readFileSync(path.join(ROOT, "script", "src", "lib.rs"), "utf8");
  const want = new Set();
  for (const list of ["NODES", "OTHER_NODES"]) {
    const m = lib.match(new RegExp(`pub const ${list}: \\[&str; \\d+\\] = \\[([^\\]]*)\\]`));
    if (!m) throw new Error(`${list} not found in lib.rs`);
    for (const x of m[1].matchAll(/"([^"]+)"/g)) want.add(x[1]);
  }
  for (const n of want) if (!g.names.has(n)) throw new Error(`lib.rs finds ${n}, which this file does not build`);
  for (const nd of g.j.nodes) if (nd.mesh !== undefined && !want.has(nd.name)) throw new Error(`mesh ${nd.name} is not in lib.rs's lists`);
  return g;
}

const g = build();
const out = path.join(ROOT, "world", "world.glb");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, g.glb());
console.log(`wrote ${path.relative(ROOT, out)} (${fs.statSync(out).size} bytes, ${g.j.nodes.length} nodes)`);
