#!/usr/bin/env node
/**
 * build_glb.mjs -- writes world-vr/world.glb and world-mr/world.glb for Visual Pack Check.
 *
 * @kosmos-system  Content (KosmosWorlds) -- Visual Pack Check
 * @kosmos-owner   KOS-699 (builder vp-w1). Writer: type-test/tools/build_glb.mjs, extended
 *                 with lit materials, UVs, one embedded texture and a node hierarchy.
 *
 * Usage (from the repo root): node visual-pack-check/tools/build_glb.mjs
 * (run make_images.mjs first: the picture quads embed tools/placeholder.png)
 *
 * No Blender: a hand-written glTF, byte-for-byte deterministic. Coordinates are
 * glTF: metres, Y up. The spawn is the origin and the visitor faces +X; +Z is
 * their right. at(r, deg, y) is a point r metres out at deg (0 = straight ahead,
 * + = right). A node at at(r, deg, y) yawed by facing(deg) shows its local -X
 * face to the visitor.
 *
 * The client's rules every node here keeps (memory: the runtime gotchas index):
 *   - k_node_find sees only meshes, so every node the script finds has one;
 *   - a trailing `_<digits>` is stripped from names, so none ends in a digit;
 *   - the publisher's merge eats childless meshes with no extras, so every node
 *     carries an extra;
 *   - text prints flat on a thin upright plane (thinnest extent <= 1/5 of the
 *     next, the next over 1 cm), so every text anchor is a plaque or a stud;
 *   - a mesh in front of a button steals its press, so nothing sits between the
 *     visitor and a button (tools/scenario.mjs ray-checks every press);
 *   - the picture quads carry UV0 AND a (non-flat) base-colour texture, because
 *     prune drops a TEXCOORD_0 no texture reads.
 *
 * Material kinds (DB-045 Appendix A): `lit` is glTF PBR (it has an emissive input,
 * so glow works); `unlit` is KHR_materials_unlit (glow answers -8); `blend` is
 * alphaMode BLEND (only those fade; opacity on anything else answers -8).
 *
 * @integration
 *   @kosmos-nodes  must build exactly script/src/nodes.rs's NAMED (for each world) and GROUPS (VR).
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
// Geometry
// ---------------------------------------------------------------------------

function geom() {
  return { pos: [], nrm: [], uv: [], idx: [] };
}
function quad(g, a, b, c, d, n, uvs = [[0, 1], [1, 1], [1, 0], [0, 0]]) {
  const base = g.pos.length / 3;
  for (const p of [a, b, c, d]) g.pos.push(...p);
  for (let k = 0; k < 4; k++) g.nrm.push(...n);
  for (const t of uvs) g.uv.push(...t);
  g.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
/** A box of size [x, y, z] centred at c. The -X face's UVs run left to right as the visitor sees it. */
function boxGeom(size, c = [0, 0, 0]) {
  const g = geom();
  const [hx, hy, hz] = size.map((v) => v / 2);
  const P = (x, y, z) => [c[0] + x, c[1] + y, c[2] + z];
  quad(g, P(hx, -hy, hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), [1, 0, 0]);
  // -X (the visitor's side): left is -Z, right is +Z; v = 0 at the top (glTF UVs).
  quad(g, P(-hx, -hy, -hz), P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz), [-1, 0, 0], [[0, 1], [1, 1], [1, 0], [0, 0]]);
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
    this.byName = new Map();
  }
  /** kind: "lit" | "unlit" | "blend" (lit, BLEND) | "unseen" (unlit, BLEND, alpha 0). */
  material(name, rgb, kind = "lit", texture) {
    if (this.materialIndex.has(name)) return this.materialIndex.get(name);
    const i = this.j.materials.length;
    const alpha = kind === "unseen" ? 0 : kind === "blend" ? 0.95 : 1;
    const m = { name, pbrMetallicRoughness: { baseColorFactor: [...rgb, alpha], metallicFactor: 0, roughnessFactor: 0.8 } };
    if (kind === "blend" || kind === "unseen") m.alphaMode = "BLEND";
    if (kind === "unlit" || kind === "unseen") {
      m.extensions = { KHR_materials_unlit: {} };
      this.used.add("KHR_materials_unlit");
    }
    if (texture !== undefined) m.pbrMetallicRoughness.baseColorTexture = { index: texture };
    this.j.materials.push(m);
    this.materialIndex.set(name, i);
    return i;
  }
  texture(pngPath) {
    const bytes = fs.readFileSync(pngPath);
    this.j.images ??= [];
    this.j.textures ??= [];
    this.j.samplers ??= [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }];
    const img = this.j.images.length;
    this.j.images.push({ name: path.basename(pngPath), mimeType: "image/png", bufferView: this.view(bytes) });
    this.j.textures.push({ sampler: 0, source: img });
    return this.j.textures.length - 1;
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
  /** parts: [[geom, material, {uv: bool}]]. UV0 only where asked (a mesh with no UV0 is a test case). */
  mesh(name, parts) {
    const a = this.j.accessors;
    const primitives = parts.map(([gm, materialIndex, opts = {}]) => {
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
      const attributes = { POSITION: posA, NORMAL: nrmA };
      if (opts.uv) {
        attributes.TEXCOORD_0 = a.length;
        a.push({ bufferView: this.view(Buffer.from(new Float32Array(gm.uv).buffer), 34962), componentType: 5126, count: n, type: "VEC2" });
      }
      const idxA = a.length;
      a.push({ bufferView: this.view(Buffer.from(new Uint16Array(gm.idx).buffer), 34963), componentType: 5123, count: gm.idx.length, type: "SCALAR" });
      return { attributes, indices: idxA, material: materialIndex, mode: 4 };
    });
    const m = this.j.meshes.length;
    this.j.meshes.push({ name, primitives });
    return m;
  }
  /** A mesh node. parent: a node name already built (its translation and yaw are then relative). */
  node(name, t, parts, extras, yawRad = 0, parent = null) {
    if (this.names.has(name)) throw new Error(`duplicate node name ${name}`);
    if (/\d$/.test(name)) throw new Error(`node name ends in a digit (the client strips it): ${name}`);
    if (!extras || !Object.keys(extras).length) throw new Error(`${name}: every node carries an extra (the publisher's merge)`);
    this.names.add(name);
    const node = { name, mesh: this.mesh(name, parts), translation: t.map((v) => Math.round(v * 1e5) / 1e5), extras };
    if (yawRad) node.rotation = [0, Math.sin(yawRad / 2), 0, Math.cos(yawRad / 2)].map((v) => Math.round(v * 1e7) / 1e7);
    const idx = this.j.nodes.length;
    this.j.nodes.push(node);
    this.byName.set(name, idx);
    if (parent) {
      const p = this.j.nodes[this.byName.get(parent)];
      (p.children ??= []).push(idx);
    } else this.j.scenes[0].nodes.push(idx);
    return idx;
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
// Text measure (Roboto Regular at 8 cm: the plain look; agent-bridge/src/roboto-advance.ts)
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
const textH = (n) => 0.08 + (n - 1) * 0.084;

// ---------------------------------------------------------------------------
// The node contract: nodes.rs and app.rs
// ---------------------------------------------------------------------------

const nodesRs = fs.readFileSync(path.join(ROOT, "script", "src", "nodes.rs"), "utf8");
const appRs = fs.readFileSync(path.join(ROOT, "script", "src", "app.rs"), "utf8");
const NAMED = [...nodesRs.matchAll(/^\s+(\w+) = "(\w+)": ([A-Z_| ]+),$/gm)].map((m) => ({ id: m[1], name: m[2], mr: m[3].trim() === "P_MR" }));
// 1.0.1: the plaques with a text anchor, "<name>" + TEXT_SUFFIX (nodes.rs TEXT_ANCHORED).
const anchoredBlock = nodesRs.match(/pub const TEXT_ANCHORED: &\[N\] = &\[([^\]]*)\];/);
if (!anchoredBlock) throw new Error("nodes.rs: TEXT_ANCHORED not found");
const TEXT_SUFFIX = nodesRs.match(/pub const TEXT_SUFFIX: &str = "(\w+)";/)?.[1];
if (TEXT_SUFFIX !== "Text") throw new Error(`nodes.rs: TEXT_SUFFIX is ${TEXT_SUFFIX}`);
const ANCHORED = new Set([...anchoredBlock[1].matchAll(/N::(\w+)/g)].map((m) => {
  const n = NAMED.find((x) => x.id === m[1]);
  if (!n) throw new Error(`nodes.rs: TEXT_ANCHORED names ${m[1]}, which is not in NAMED`);
  return n.name;
}));
const GROUPS = [...nodesRs.matchAll(/\("(\w+)", (\d+), (true|false), P_\w+\)/g)].map((m) => ({ prefix: m[1], count: +m[2], two: m[3] === "true" }));
if (NAMED.length < 90 || GROUPS.length !== 5) throw new Error(`nodes.rs parse: ${NAMED.length} named, ${GROUPS.length} groups`);
const groupName = (gp, i) => (gp.two ? `${gp.prefix}${String.fromCharCode(65 + Math.floor(i / 8))}${String.fromCharCode(97 + (i % 8))}` : `${gp.prefix}${String.fromCharCode(65 + i)}`);
const constF = (n) => {
  const m = appRs.match(new RegExp(`pub const ${n}: f32 = ([0-9.]+);`));
  if (!m) throw new Error(`${n} not in app.rs`);
  return +m[1];
};
const W = { tab: constF("W_TAB"), btn: constF("W_BTN"), status: constF("W_STATUS"), title: constF("W_TITLE"), log: constF("W_LOG") };

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

const PRESS = { interactable: true };
const anchor = (role) => ({ script_node: role });
const FRONT = -0.006;
/** A text anchor's studs: 2 mm cubes. Its bounds are 2 * ANCHOR_HALF tall. */
const STUD = 0.002;
const ANCHOR_HALF = 0.015;
/** The studs' front faces sit this far behind the plaque's front face, so a laser always meets the plaque. */
const STUD_INSET = 0.00025;

/** Materials are made on first use, so a world carries only the ones it uses. */
function palette(g, tex) {
  return {
    get floor() {
      return g.material("Floor", [0.02, 0.022, 0.03], "unlit");
    },
    get wall() {
      return g.material("Wall", [0.035, 0.04, 0.055], "unlit");
    },
    get board() {
      return g.material("Board", [0.09, 0.105, 0.14], "unlit");
    },
    get panel() {
      return g.material("Panel", [0.006, 0.01, 0.018], "unlit");
    },
    get button() {
      return g.material("Button", [0.02, 0.06, 0.08], "unlit");
    },
    get cell() {
      return g.material("Cell", [0.16, 0.18, 0.24], "unlit");
    },
    get cyan() {
      return g.material("LightCyan", [0.37, 0.9, 1.0], "unlit");
    },
    get amber() {
      return g.material("LightAmber", [0.95, 0.66, 0.23], "unlit");
    },
    get teal() {
      return g.material("LightTeal", [0.12, 0.45, 0.55], "unlit");
    },
    get guide() {
      return g.material("Guide", [0.55, 0.62, 0.75], "unlit");
    },
    get unseen() {
      return g.material("Unseen", [0, 0, 0], "unseen");
    },
    // Under test: lit (glow works), unlit (glow -8), BLEND (fade works).
    get litGrey() {
      return g.material("LitGrey", [0.6, 0.63, 0.7], "lit");
    },
    get litBlue() {
      return g.material("LitBlue", [0.32, 0.42, 0.62], "lit");
    },
    get litOpaque() {
      return g.material("LitOpaque", [0.7, 0.72, 0.76], "lit");
    },
    get blend() {
      return g.material("BlendPanel", [0.45, 0.62, 0.95], "blend");
    },
    get unlitTile() {
      return g.material("UnlitViolet", [0.62, 0.45, 0.95], "unlit");
    },
    get shared() {
      return g.material("SharedMaterial", [0.5, 0.55, 0.64], "lit");
    },
    get chip() {
      return g.material("ChipGrey", [0.58, 0.6, 0.64], "lit");
    },
    get tile() {
      return [0, 1, 2, 3].map((k) => g.material(`TileQuarter${"ABCD"[k]}`, [0.2 + 0.06 * k, 0.23 + 0.06 * k, 0.3 + 0.06 * k], "lit"));
    },
    deep: (k) => g.material(`DeepLevel${String.fromCharCode(65 + k)}`, [0.25 + 0.03 * k, 0.3 + 0.025 * k, 0.45], "lit"),
    get pic() {
      return g.material("PicPlaceholder", [1, 1, 1], "lit", tex);
    },
    get noUv() {
      return g.material("NoUvGrey", [0.42, 0.45, 0.52], "lit");
    },
  };
}

function lightBars(w, h, d, mat) {
  const t = 0.004;
  const x = -d / 2 + FRONT;
  return [
    [boxGeom([0.004, t, w * 0.96], [x, h / 2 - t / 2, 0]), mat],
    [boxGeom([0.004, t, w * 0.96], [x, -h / 2 + t / 2, 0]), mat],
  ];
}

/**
 * The studs of a plaque's text anchor, in the plaque's own frame (front = -x).
 * Their bounds are centred k below the plaque's centre, k being half the height
 * of maxLines lines of 8 cm text; ANCHOR_HALF each way vertically, nearly the
 * plaque's width across, and STUD deep, so the client reads them as a thin
 * upright plane that faces the spawn (KWorldTextPool.cpp ComputeFixedFacing)
 * and prints the text a hair in front of the plaque's face. Both studs lie
 * wholly inside the plaque's body, so no part of the anchor can be pointed at
 * or pressed.
 *
 * @returns {Array} mesh parts for Gltf.node
 * @throws if the studs would not fit inside the body
 */
function textAnchorParts(P, name, w, h, d, maxLines) {
  const k = textH(maxLines) / 2;
  const x = -d / 2 + STUD_INSET + STUD / 2;
  const z = w / 2 - STUD;
  if (-k - ANCHOR_HALF < -h / 2 + 0.001 || -k + ANCHOR_HALF > h / 2 - 0.001) throw new Error(`${name}: a text anchor for ${maxLines} lines does not fit inside a ${h} m plaque`);
  if (STUD + STUD_INSET > d) throw new Error(`${name}: a text anchor does not fit inside a ${d} m deep plaque`);
  return [
    [boxGeom([STUD, STUD, STUD], [x, -k + ANCHOR_HALF - STUD / 2, -z]), P.unseen],
    [boxGeom([STUD, STUD, STUD], [x, -k - ANCHOR_HALF + STUD / 2, z]), P.unseen],
  ];
}

/**
 * A plaque facing the spawn: w wide, h tall, d deep, as two nodes. `name` is
 * the body and its light bars: the node a press goes to and the pointing
 * outline boxes. `name` + "Text" is its invisible text anchor
 * (textAnchorParts), on which maxLines lines of 8 cm text sit centred on the
 * plaque (the script shows the plaque's text there: app.rs App::t). `lines`
 * are its widest texts (checked).
 */
function plaque(g, P, name, pos, deg, w, h, d, maxLines, lines, bodyMat, barMat, extras, parent = null) {
  if (textH(maxLines) > h + 1e-6) throw new Error(`${name}: ${maxLines} lines do not fit ${h} m`);
  if (d > 0.2 * Math.min(w, h)) throw new Error(`${name}: ${d} m deep is not a thin plane`);
  for (const s of lines) {
    for (const l of s.split("\n")) {
      const lw = [...l].reduce((a, c) => a + (ROBOTO_ADVANCE_EM[c.charCodeAt(0) - 32] ?? 0.6745) * 0.08, 0);
      if (lw > w * 0.97) throw new Error(`${name}: "${l}" is ${lw.toFixed(3)} m, wider than ${w} m`);
    }
  }
  if (!ANCHORED.has(name)) throw new Error(`${name}: a plaque, but not in nodes.rs TEXT_ANCHORED`);
  const parts = [[boxGeom([d, h, w]), bodyMat], ...(barMat !== null ? lightBars(w, h, d, barMat) : [])];
  const idx = g.node(name, pos, parts, extras, facing(deg), parent);
  g.node(name + TEXT_SUFFIX, pos, textAnchorParts(P, name, w, h, d, maxLines), anchor("text"), facing(deg), parent);
  return idx;
}

/** A 3 x 3 cm x 2 mm invisible stud: a text anchor that prints its text flat and shows nothing itself. */
function stud(g, P, name, pos, deg, extras = anchor("text"), parent = null) {
  return g.node(name, pos, [[boxGeom([0.002, 0.03, 0.03]), P.unseen]], extras, facing(deg), parent);
}

/** A button: a plaque with one line of plain 8 cm text. */
function button(g, P, name, pos, deg, label, bar) {
  return plaque(g, P, name, pos, deg, W.btn, 0.2, 0.02, 2, [label], P.button, bar, PRESS);
}

/** A free-standing test object: a lit or unlit box, its own mesh and material(s). */
function object(g, name, pos, deg, size, mats, extras, uv = false) {
  const parts = mats.map((m, k) => [boxGeom(size, [0, 0, 0]), m, { uv }]).slice(0, 1);
  return g.node(name, pos, parts, extras, facing(deg));
}

// ---------------------------------------------------------------------------
// The VR world
// ---------------------------------------------------------------------------

/** The widest texts each plain plaque carries (app.rs; tests.rs measures every state). */
const WIDEST_STATUS = ["left: in 999, out 999; right: in 999, out 999"];

function buildVr() {
  const g = new Gltf("KosmosWorlds visual-pack-check/tools/build_glb.mjs (VR)");
  const tex = g.texture(path.join(HERE, "placeholder.png"));
  const P = palette(g, tex);
  const ROOM = anchor("room");

  // The room: 10 x 10 m, walls 3.2 m. The front board carries the text page's samples,
  // the 64-text grid, the tile wall and the pictures.
  g.node("Floor", [0, -0.05, 0], [[boxGeom([10, 0.1, 10]), P.floor]], ROOM);
  g.node("WallFront", [5.05, 1.6, 0], [[boxGeom([0.1, 3.2, 10.2]), P.wall]], ROOM);
  g.node("WallBack", [-5.05, 1.6, 0], [[boxGeom([0.1, 3.2, 10.2]), P.wall]], ROOM);
  g.node("WallLeft", [0, 1.6, -5.05], [[boxGeom([10.2, 3.2, 0.1]), P.wall]], ROOM);
  g.node("WallRight", [0, 1.6, 5.05], [[boxGeom([10.2, 3.2, 0.1]), P.wall]], ROOM);
  g.node("Board", [2.62, 1.7, 0], [[boxGeom([0.04, 2.2, 4.4]), P.board]], ROOM);
  g.empty("spawn_point", [0, 0, 0], { spawn_point: true });

  // The chrome: tabs on the left, the title over the board, two status plaques on the right.
  const TABS = [["TabText", "> Text"], ["TabGrid", "> 64 texts"], ["TabColour", "> Colour"], ["TabPics", "> Pictures"], ["TabHover", "> Hover"], ["TabTravel", "> Travel"]];
  TABS.forEach(([n, l], k) => plaque(g, P, n, at(1.6, -64, 1.78 - k * 0.15), -64, W.tab, 0.12, 0.02, 1, [l], P.button, P.cyan, PRESS));
  plaque(g, P, "TxtTitle", [2.55, 2.97, 0], 0, W.title, 0.38, 0.008, 4, ["Colour, glow, fade, reset (K5); 256 (K6); clone (K8)\nfor reading width only"], P.panel, P.cyan, anchor("title"));
  plaque(g, P, "TxtStatus", at(1.9, 66, 1.78), 66, W.status, 0.38, 0.008, 4, WIDEST_STATUS, P.panel, P.teal, anchor("status"));
  plaque(g, P, "TxtStatusB", at(1.9, 66, 1.33), 66, W.status, 0.38, 0.008, 4, WIDEST_STATUS, P.panel, P.teal, anchor("status"));

  // --- Text (K1, K3)
  const COLS = [["Left", -1.1], ["Mid", 0], ["Right", 1.1]];
  for (const [c, z] of COLS) {
    stud(g, P, `Samp${c}BigStrong`, [2.58, 2.3, z], 0);
    stud(g, P, `Samp${c}BigReg`, [2.58, 1.96, z], 0);
    stud(g, P, `Samp${c}SmallStrong`, [2.58, 1.66, z], 0);
    stud(g, P, `Samp${c}SmallReg`, [2.58, 1.54, z], 0);
    plaque(g, P, `Cap${c}`, [2.585, 2.66, z], 0, 0.62, 0.12, 0.008, 1, ["Right aligned"], P.panel, null, anchor("caption"));
    // The column's line: left-aligned text starts at it, right-aligned text ends at it.
    g.node(`Guide${c}`, [2.595, 1.96, z], [[boxGeom([0.004, 0.9, 0.006]), P.guide]], anchor("guide"));
  }
  stud(g, P, "SampDefault", [2.58, 1.12, 0], 0);
  [["BtnPlate", "Plates:\noff"], ["BtnBadValues", "Try bad\nvalues"], ["BtnOldCall", "Old call:\ntop middle"]].forEach(([n, l], k) =>
    button(g, P, n, at(1.55, -40, 1.75 - k * 0.23), -40, l, P.amber),
  );
  // K3: a plated text to the right, and a short wall covering the left half of it as the visitor sees it.
  stud(g, P, "SampBehind", at(2.5, 100, 1.55), 100);
  g.node("OccWall", at(1.9, 97.3, 1.58), [[boxGeom([0.04, 0.4, 0.22]), P.litOpaque]], anchor("occluder"), facing(97.3));

  // --- 64 texts (K2): the grid board and its 64 cells (children: a press on any cell is the board's).
  const GW = 0.34, GH = 0.18;
  g.node("GridBoard", [2.6, 1.72, 0], [[boxGeom([0.02, 8 * GH + 0.08, 8 * GW + 0.08]), P.board]], PRESS);
  const cell = GROUPS.find((x) => x.prefix === "Cell");
  for (let i = 0; i < cell.count; i++) {
    const r = Math.floor(i / 8), c = i % 8;
    const pos = [-0.02, (3.5 - r) * GH, (c - 3.5) * GW];
    g.node(groupName(cell, i), pos, [[boxGeom([0.004, GH - 0.02, GW - 0.02]), P.cell]], anchor("cell"), 0, "GridBoard");
  }
  // The deep-hierarchy hover tower: DeepA (subscribed) and fifteen levels nested under it.
  const deep = GROUPS.find((x) => x.prefix === "Deep");
  let parent = null;
  for (let i = 0; i < deep.count; i++) {
    const name = groupName(deep, i);
    const pos = i === 0 ? at(1.7, -36, 0.9) : [0, 0.065, 0];
    const s = 0.16 - i * 0.005;
    g.node(name, pos, [[boxGeom([s, 0.05, s]), P.deep(i)]], i === 0 ? PRESS : anchor("deep"), i === 0 ? facing(-36) : 0, parent);
    parent = name;
  }

  // --- Colour (K5, K6, K8)
  const OBJ = [
    ["ColCube", -24, [0.22, 0.22, 0.22], P.litGrey],
    ["ColBlend", -17, [0.02, 0.3, 0.22], P.blend],
    ["ColOpaque", -10, [0.02, 0.3, 0.22], P.litOpaque],
    ["ColUnlit", -3, [0.2, 0.2, 0.2], P.unlitTile],
    ["ColShareA", 4, [0.18, 0.18, 0.18], P.shared],
    ["ColShareB", 11, [0.18, 0.18, 0.18], P.shared],
    ["ColChip", 18, [0.03, 0.08, 0.18], P.chip],
  ];
  for (const [n, deg, size, m] of OBJ) object(g, n, at(2.3, deg, 1.25), deg, size, [m], anchor("object"));
  // Where the clone goes: a thin frame (the copy lands inside it).
  g.node("ColChipSpot", at(2.3, 25, 1.25), [
    [boxGeom([0.01, 0.006, 0.22], [0.02, 0.055, 0]), P.guide],
    [boxGeom([0.01, 0.006, 0.22], [0.02, -0.055, 0]), P.guide],
  ], anchor("clone_spot"), facing(25));
  const COLBTN = [
    ["BtnColour", "Colour\n(cycle)"], ["BtnGlow", "Glow\n0.5 / 1 / 0"], ["BtnResetCube", "Reset\nthe cube"], ["BtnFade", "Fade\n0.3 / 1"], ["BtnTryEight", "Try the\n-8 cases"],
    ["BtnShareA", "Colour\nshared A"], ["BtnClone", "Clone\nthe chip"], ["BtnCloneColour", "Colour\nthe clone"], ["BtnMany", "256:\nrelease"], ["BtnFrameCap", "65 in\none frame"],
  ];
  COLBTN.forEach(([n, l], k) => {
    const side = k < 5 ? -40 : 40;
    button(g, P, n, at(1.55, side, 1.75 - (k % 5) * 0.23), side, l, k < 5 ? P.amber : P.cyan);
  });
  // The tile wall: 64 tiles of four quarters, four authored materials: 256 (node, slot) pairs.
  g.node("TileBoard", [2.6, 2.28, 0], [[boxGeom([0.02, 0.86, 1.34]), P.board]], anchor("tile_board"));
  const tile = GROUPS.find((x) => x.prefix === "Tile");
  for (let i = 0; i < tile.count; i++) {
    const r = Math.floor(i / 8), c = i % 8;
    const T = 0.15, q = T / 2 - 0.006;
    const quarters = [0, 1, 2, 3].map((k) => [boxGeom([0.006, q, q], [0, (k < 2 ? 1 : -1) * T / 4, (k % 2 ? 1 : -1) * T / 4]), P.tile[k]]);
    g.node(groupName(tile, i), [2.58, 2.28 + (3.5 - r) * 0.1, (c - 3.5) * 0.16], quarters, anchor("tile"));
  }

  // --- Pictures (K7): six quads with UV0 and the placeholder texture, and one quad with no UV0.
  const PICS = ["PicA", "PicB", "PicC", "PicD", "PicE", "PicF"];
  PICS.forEach((n, k) => {
    const pos = [2.56, k < 3 ? 2.2 : 1.56, (k % 3 - 1) * 0.66];
    g.node(n, pos, [[boxGeom([0.01, 0.56, 0.56]), P.pic, { uv: true }]], anchor("picture"));
  });
  g.node("PicNoUv", [2.56, 1.2, 1.25], [[boxGeom([0.01, 0.3, 0.3]), P.noUv]], anchor("picture_no_uv"));
  [["BtnPicShow", "Show\npictures"], ["BtnPicSwap", "Swap\npictures"], ["BtnPicTint", "Tint\npictures"], ["BtnPicReset", "Reset\npictures"], ["BtnPicMissing", "Unlisted\npath"], ["BtnPicNoUv", "Mesh with\nno UV0"]].forEach(([n, l], k) => {
    const side = k < 3 ? -40 : 40;
    button(g, P, n, at(1.55, side, 1.75 - (k % 3) * 0.23), side, l, k < 3 ? P.amber : P.cyan);
  });

  // --- Hover (K9)
  plaque(g, P, "HoverPad", at(2.0, 0, 1.45), 0, 0.6, 0.4, 0.02, 1, ["Point here"], P.litBlue, null, PRESS);
  const bar = GROUPS.find((x) => x.prefix === "Bar");
  for (let i = 0; i < bar.count; i++) {
    g.node(groupName(bar, i), [2.2, 2.08, (i - (bar.count - 1) / 2) * 0.07], [[boxGeom([0.02, 0.26, 0.03]), P.litBlue]], PRESS);
  }
  const rate = GROUPS.find((x) => x.prefix === "Rate");
  for (let i = 0; i < rate.count; i++) {
    g.node(groupName(rate, i), [2.2, 0.95, (i - (rate.count - 1) / 2) * 0.08], [[boxGeom([0.02, 0.06, 0.06]), P.litBlue]], PRESS);
  }
  // The arch: two pillars and a lintel, one node, with a 0.3 m hole; a wall behind the hole.
  g.node("HoverArch", at(2.0, -20, 1.35), [
    [boxGeom([0.06, 0.6, 0.12], [0, 0, -0.21]), P.litGrey],
    [boxGeom([0.06, 0.6, 0.12], [0, 0, 0.21]), P.litGrey],
    [boxGeom([0.06, 0.12, 0.54], [0, 0.36, 0]), P.litGrey],
  ], PRESS, facing(-20));
  g.node("HoverBehind", at(2.65, -20, 1.35), [[boxGeom([0.02, 0.8, 0.8]), P.litBlue]], PRESS, facing(-20));
  plaque(g, P, "HoverGo", at(2.0, 22, 1.45), 22, 0.62, 0.3, 0.02, 1, ["Point, then wait"], P.litBlue, null, PRESS);
  button(g, P, "BtnHoverClear", at(1.55, -40, 1.75), -40, "Clear\nthe counts", P.amber);
  plaque(g, P, "TxtLog", at(1.9, 66, 0.86), 66, W.log, 0.38, 0.008, 4, ["out behind R 999.9"], P.panel, P.teal, anchor("log"));

  // --- Travel (K11 and the cancelled-travel restore)
  object(g, "TrvCube", at(2.3, -15, 1.3), -15, [0.22, 0.22, 0.22], [P.litGrey], anchor("object"));
  object(g, "TrvGlow", at(2.3, -5, 1.3), -5, [0.22, 0.22, 0.22], [P.litGrey], anchor("object"));
  object(g, "TrvBlend", at(2.3, 5, 1.3), 5, [0.02, 0.3, 0.22], [P.blend], anchor("object"));
  g.node("TrvPic", at(2.3, 15, 1.3), [[boxGeom([0.01, 0.3, 0.3]), P.pic, { uv: true }]], anchor("picture"), facing(15));
  [["BtnLooks", "Set the\nlooks"], ["BtnLooksOff", "Clear the\nlooks"]].forEach(([n, l], k) => button(g, P, n, at(1.55, -40, 1.75 - k * 0.23), -40, l, P.amber));
  [["DoorReal", "Door:\nType Test"], ["DoorNowhere", "Door:\nnowhere"]].forEach(([n, l], k) => button(g, P, n, at(1.55, 40, 1.75 - k * 0.23), 40, l, P.cyan));
  return g;
}

// ---------------------------------------------------------------------------
// The MR world (K4): no room, no floor (MR worlds need none), plates over passthrough
// ---------------------------------------------------------------------------

function buildMr() {
  const g = new Gltf("KosmosWorlds visual-pack-check/tools/build_glb.mjs (MR)");
  const P = palette(g, undefined);
  g.empty("spawn_point", [0, 0, 0], { spawn_point: true });
  // The marker that tells the script it is the MR world: an invisible stud at the visitor's feet, off to the side.
  stud(g, P, "MrMarker", [0.4, 0.02, -0.6], 0, anchor("mr_marker"));
  plaque(g, P, "MrTitle", at(1.4, -38, 1.62), -38, W.status, 0.3, 0.008, 3, ["A plate darkens only its own footprint:"], P.panel, P.cyan, anchor("title"));
  plaque(g, P, "MrStatus", at(1.4, -38, 1.24), -38, W.status, 0.3, 0.008, 3, ["styled shows: 6 of 6 answered 0"], P.panel, P.teal, anchor("status"));
  const SAMP = [["MrTxtA", 1.3, -8, 1.72], ["MrTxtB", 1.5, 2, 1.55], ["MrTxtC", 1.8, -4, 1.3], ["MrTxtD", 2.0, 12, 1.62], ["MrTxtE", 1.6, 18, 1.2], ["MrTxtF", 1.4, 26, 1.42]];
  for (const [n, r, deg, y] of SAMP) stud(g, P, n, at(r, deg, y), deg);
  g.node("MrFade", at(1.5, 40, 1.3), [[boxGeom([0.02, 0.3, 0.4]), P.blend]], anchor("object"), facing(40));
  g.node("MrSolid", at(1.5, 58, 1.3), [[boxGeom([0.02, 0.3, 0.4]), P.litOpaque]], anchor("object"), facing(58));
  button(g, P, "MrBtnPlates", at(1.3, 38, 0.96), 38, "Plates:\noff", P.amber);
  button(g, P, "MrBtnFade", at(1.3, 60, 0.96), 60, "Fade\n0.4 / 1", P.cyan);
  return g;
}

// ---------------------------------------------------------------------------

function check(g, mr) {
  const want = new Set(NAMED.filter((x) => x.mr === mr).map((x) => x.name));
  for (const x of NAMED) if (x.mr === mr && ANCHORED.has(x.name)) want.add(x.name + TEXT_SUFFIX);
  if (!mr) for (const gp of GROUPS) for (let i = 0; i < gp.count; i++) want.add(groupName(gp, i));
  for (const n of want) if (!g.names.has(n)) throw new Error(`${mr ? "MR" : "VR"}: nodes.rs finds ${n}, which this file does not build`);
  for (const nd of g.j.nodes) if (nd.mesh !== undefined && !want.has(nd.name)) throw new Error(`${mr ? "MR" : "VR"}: mesh ${nd.name} is not in nodes.rs`);
  const meshes = g.j.nodes.filter((n) => n.mesh !== undefined).length;
  if (meshes > 400) throw new Error(`${meshes} mesh nodes; the client gives handles to 512 at most`);
  return meshes;
}

for (const [dir, build, mr] of [["world-vr", buildVr, false], ["world-mr", buildMr, true]]) {
  const g = build();
  const meshes = check(g, mr);
  const out = path.join(ROOT, dir, "world.glb");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, g.glb());
  console.log(`wrote ${path.relative(ROOT, out)} (${fs.statSync(out).size} bytes, ${g.j.nodes.length} nodes, ${meshes} meshes)`);
}
