#!/usr/bin/env node
/**
 * build_glb.mjs -- writes world.glb for the two network test worlds (KOS-983, lane TW).
 *
 * @kosmos-system  Content (KosmosWorlds) -- network test worlds
 * @kosmos-owner   TW (KOS-983)
 *
 * Usage (from the repo root):
 *   node net-test-tools/build_glb.mjs net-check     -> net-check/world.glb
 *   node net-test-tools/build_glb.mjs net-required  -> net-required/world.glb
 *
 * No dependencies and no Blender: every object is a box, so a hand-written glTF
 * is shorter than a Blender script and byte-for-byte deterministic. These are
 * test worlds (unlisted), so the look is plain on purpose.
 *
 * Coordinates are glTF: metres, Y up. The spawn is the origin; the console faces
 * it along +X (UE forward at yaw 0) on an arc 1.6 m out, and the text column
 * floats 3.0 m out with nothing solid behind it for 1.4 m.
 *
 * Three device traps this file is careful about (memory notes, 2026-10-06/08):
 *   1. The client strips a trailing `_<digit>` from node names, so no name here
 *      ends in a digit (`LineA`, never `Line_1`).
 *   2. `k_node_find` sees only nodes WITH A MESH, so every text anchor is a mesh
 *      (a 1 cm floating stud), never an empty.
 *   3. The publisher's merge stage bakes childless, non-interactable, extras-less
 *      meshes into anonymous geometry, so every node the script finds carries an
 *      extra (`interactable` for buttons, `script_node` for the rest).
 *
 * Integration points:
 *   - net-check/src/lib.rs and net-required/src/lib.rs find these node names.
 *   - `kosmos-wp spawn-sync` reads the `spawn_point` node into manifest.json.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");

/** The eleven buttons, in arc order (left to right as seen from the spawn). Mirrored in net-check/src/lib.rs. */
export const BUTTONS = [
  "BtnEcho",
  "BtnScore",
  "BtnScores",
  "BtnName",
  "BtnBig",
  "BtnSlow",
  "BtnRedirA",
  "BtnRedirB",
  "BtnGzip",
  "BtnGzipStd",
  "BtnServerB",
];

/** The board's text lines, top to bottom. Mirrored in net-check/src/lib.rs. */
export const LINES = ["LineA", "LineB", "LineC", "LineD", "LineE", "LineF", "LineG", "LineH", "LineI", "LineJ"];

// ---------------------------------------------------------------------------
// A minimal glTF writer
// ---------------------------------------------------------------------------

class Gltf {
  constructor() {
    this.j = {
      asset: { version: "2.0", generator: "KosmosWorlds net-test-tools/build_glb.mjs" },
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
  }

  material(name, rgb) {
    if (this.materialIndex.has(name)) return this.materialIndex.get(name);
    const i = this.j.materials.length;
    this.j.materials.push({
      name,
      pbrMetallicRoughness: { baseColorFactor: [...rgb, 1], metallicFactor: 0, roughnessFactor: 0.85 },
    });
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
    this.j.bufferViews.push({ buffer: 0, byteOffset: this.byteLength, byteLength: bytes.length, target });
    this.chunks.push(bytes);
    this.byteLength += bytes.length;
    return i;
  }

  /** An axis-aligned box mesh centred on its node's origin. size = [x, y, z] metres. */
  boxMesh(name, size, materialIndex) {
    const [hx, hy, hz] = size.map((v) => v / 2);
    // 6 faces x 4 vertices, each face with its own normal.
    const faces = [
      { n: [1, 0, 0], v: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]] },
      { n: [-1, 0, 0], v: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]] },
      { n: [0, 1, 0], v: [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]] },
      { n: [0, -1, 0], v: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]] },
      { n: [0, 0, 1], v: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
      { n: [0, 0, -1], v: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]] },
    ];
    const pos = new Float32Array(72);
    const nrm = new Float32Array(72);
    const idx = new Uint16Array(36);
    faces.forEach((f, fi) => {
      f.v.forEach((p, vi) => {
        pos.set(p, (fi * 4 + vi) * 3);
        nrm.set(f.n, (fi * 4 + vi) * 3);
      });
      const b = fi * 4;
      idx.set([b, b + 1, b + 2, b, b + 2, b + 3], fi * 6);
    });
    const a = this.j.accessors;
    const posA = a.length;
    a.push({
      bufferView: this.view(Buffer.from(pos.buffer), 34962),
      componentType: 5126, count: 24, type: "VEC3",
      min: [-hx, -hy, -hz], max: [hx, hy, hz],
    });
    const nrmA = a.length;
    a.push({ bufferView: this.view(Buffer.from(nrm.buffer), 34962), componentType: 5126, count: 24, type: "VEC3" });
    const idxA = a.length;
    a.push({ bufferView: this.view(Buffer.from(idx.buffer), 34963), componentType: 5123, count: 36, type: "SCALAR" });
    const m = this.j.meshes.length;
    this.j.meshes.push({
      name,
      primitives: [{ attributes: { POSITION: posA, NORMAL: nrmA }, indices: idxA, material: materialIndex, mode: 4 }],
    });
    return m;
  }

  /** Add a box node at `t` (its centre), optionally yawed `yawDeg` about +Y, with `extras`. */
  box(name, t, size, materialIndex, extras, yawDeg = 0) {
    const node = { name, mesh: this.boxMesh(name, size, materialIndex), translation: t };
    if (yawDeg) {
      const r = (yawDeg * Math.PI) / 360; // half angle
      node.rotation = [0, Math.sin(r), 0, Math.cos(r)];
    }
    if (extras) node.extras = extras;
    this.addNode(node);
  }

  /** An empty marker node (the spawn). */
  empty(name, t, extras) {
    this.addNode({ name, translation: t, extras });
  }

  addNode(node) {
    this.j.scenes[0].nodes.push(this.j.nodes.length);
    this.j.nodes.push(node);
  }

  /** Serialise as a GLB (glTF 2.0 binary). */
  glb() {
    const bin = Buffer.concat(this.chunks);
    const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
    this.j.buffers[0].byteLength = bin.length;
    let jsonBuf = Buffer.from(JSON.stringify(this.j), "utf8");
    jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0); // "glTF"
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binPadded.length, 8);
    const jh = Buffer.alloc(8);
    jh.writeUInt32LE(jsonBuf.length, 0);
    jh.writeUInt32LE(0x4e4f534a, 4); // "JSON"
    const bh = Buffer.alloc(8);
    bh.writeUInt32LE(binPadded.length, 0);
    bh.writeUInt32LE(0x004e4942, 4); // "BIN\0"
    return Buffer.concat([header, jh, jsonBuf, bh, binPadded]);
  }
}

// ---------------------------------------------------------------------------
// The two scenes
// ---------------------------------------------------------------------------

function room(g) {
  // DARK on purpose (1.0.1, after the CEO's first sitting): world text is always
  // WHITE (KWorldTextPool.cpp SetTextRenderColor), and 1.0.0's light grey floor and
  // wall left the button labels close to invisible.
  const floor = g.material("Floor", [0.1, 0.1, 0.12]);
  const wall = g.material("Wall", [0.04, 0.04, 0.05]);
  // A 9 x 9 m floor slab, top face at y = 0, and a 4 m back wall far behind the text.
  g.box("Floor", [0, -0.05, 0], [9, 0.1, 9], floor);
  g.box("BackWall", [4.4, 2, 0], [0.2, 4, 9], wall);
  // The spawn: the publisher's spawn-sync turns this into manifest.world.spawn_point.
  g.empty("spawn_point", [0, 0, 0], { spawn_point: true });
}

/**
 * A column of FLOATING text anchors, one per line, with nothing solid near them.
 *
 * World text yaw-faces the camera and is depth-tested. 1.0.0 put 2.3 m-wide lines
 * 2 cm in front of a solid board, so a few degrees off-axis half of every line
 * swung INTO the board and vanished -- the "nothing showed" at the first sitting.
 * The nearest surface behind these anchors is now the back wall, 1.4 m away, which
 * clears a 2 m line turned up to about 90 degrees.
 */
function textColumn(g, x, names, topY, pitch) {
  const studMat = g.material("Stud", [0.05, 0.05, 0.06]);
  names.forEach((name, i) => {
    g.box(name, [x, topY - i * pitch, 0], [0.01, 0.01, 0.01], studMat, { script_node: "text_line" });
  });
}

/** Button colours: green = expected to succeed, red = expected to be refused, blue = the prompt. */
const EXPECTS_FAILURE = new Set(["BtnBig", "BtnSlow", "BtnRedirB", "BtnGzip", "BtnGzipStd", "BtnServerB"]);

function netCheck() {
  const g = new Gltf();
  room(g);
  const okMat = g.material("ButtonExpectOk", [0.15, 0.75, 0.3]);
  const failMat = g.material("ButtonExpectRefused", [0.85, 0.18, 0.15]);
  const promptMat = g.material("ButtonPrompt", [0.2, 0.45, 0.95]);
  const standMat = g.material("Stand", [0.3, 0.32, 0.36]);
  // The arc: radius 1.6 m about the spawn, from -66 to +66 degrees (0.37 m apart);
  // button tops at 1.02 m. Labels alternate between two heights (src/lib.rs), so
  // labels at the same height are 0.74 m apart and never overlap.
  const n = BUTTONS.length;
  BUTTONS.forEach((name, i) => {
    const deg = -66 + (132 * i) / (n - 1);
    const rad = (deg * Math.PI) / 180;
    // Facing +X with +Y up, the visitor's right is +Z (forward x up), so -66 degrees
    // (negative Z) is the left end. Each button is yawed to face the spawn.
    const x = 1.6 * Math.cos(rad);
    const z = 1.6 * Math.sin(rad);
    const yaw = -deg;
    const mat = name === "BtnName" ? promptMat : EXPECTS_FAILURE.has(name) ? failMat : okMat;
    g.box(`${name}Stand`, [x, 0.44, z], [0.12, 0.88, 0.12], standMat, undefined, yaw);
    g.box(name, [x, 0.95, z], [0.26, 0.14, 0.26], mat, { interactable: true }, yaw);
  });
  // Ten lines, 2.75 m down to 1.67 m, 3.0 m in front of the spawn.
  textColumn(g, 3.0, LINES, 2.75, 0.12);
  return g;
}

function netRequired() {
  const g = new Gltf();
  room(g);
  textColumn(g, 2.4, ["StatusLine"], 1.6, 0.12);
  return g;
}

const which = process.argv[2];
const builders = { "net-check": netCheck, "net-required": netRequired };
if (!builders[which]) {
  console.error("usage: node net-test-tools/build_glb.mjs net-check|net-required");
  process.exit(2);
}
const out = path.join(REPO, which, "world.glb");
fs.writeFileSync(out, builders[which]().glb());
console.log(`wrote ${path.relative(REPO, out)} (${fs.statSync(out).size} bytes)`);
