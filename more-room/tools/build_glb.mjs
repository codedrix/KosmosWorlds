#!/usr/bin/env node
/**
 * build_glb.mjs -- writes world.glb for More Room, VR and MR.
 *
 * @kosmos-system  Content (KosmosWorlds) -- More Room
 * @kosmos-owner   More Room v2, the Day Ring (CEO 2026-10-19: "Take ... the Day Ring forward")
 *
 * Usage (from the repo root):
 *   node more-room/tools/build_glb.mjs vr   -> more-room/world-vr/world.glb
 *   node more-room/tools/build_glb.mjs mr   -> more-room/world-mr/world.glb
 *   node more-room/tools/build_glb.mjs both
 *
 * No dependencies and no Blender: a hand-written glTF, byte-for-byte
 * deterministic (the writer is net-check's, KOS-983, grown to boxes,
 * cylinders and rings with more than one material per mesh).
 *
 * Coordinates are glTF: metres, Y up. The spawn is the origin and the visitor
 * faces +X; +Z is their right. An angle `deg` is measured from straight ahead
 * toward the right, so `at(r, deg, y)` = [r cos, y, r sin]. The room, by
 * distance from the spawn:
 *   1.0 m        the landing arc (cards land face-down here), Later and Done at its ends
 *   1.15-1.4 m   triage's action capsules and the reading card (shown in triage)
 *   1.3 m        the inbox well, front and centre, behind the arc
 *   1.45 m left  the mode column (Owner sign in, About, the four modes) and the status
 *   1.7 m        the stage (brief, prep, wrap-up); triage's fan of five cards at 1.75 m
 *   1.6 m right  the pinned tasks
 *   1.95 m       the focus cocoon (16 flat facets that slide in from 3 m)
 *   2.1 m left   the window
 *   2.4 m        the Day Ring at 1.78 m: events as pills, now always straight ahead
 *   1.7 m behind the quiet shelf
 * Every position the script also uses is in LAYOUT below and is mirrored in
 * ../script/src/layout.rs; ../tools/scenario.mjs checks the two agree.
 *
 * Nothing in this room is rotated at runtime: `k_transform_set_rotation`
 * replaces a node's relative rotation in raw engine degrees (KDomTransform.cpp,
 * client 944abfa). So what moves is round about the vertical (pills and discs:
 * they look the same from every side), and what is flat is built
 * already facing the spawn (its yaw is in the node, never baked into the
 * vertices, so the client's plaque rule can read it).
 *
 * Text and the plaque rule (KWorldTextPool.cpp, KOS-981, in every installed
 * cook): text on a thin upright plane is printed flat on its face, a hair in
 * front; any other anchor gets upright text, faced toward the eye once, when
 * it is shown, and then carried with its node. So most text here sits on its
 * own dark card (a plaque), which is also its plate in mixed reality.
 *
 * Device traps this file is careful about (memory notes, 2026-10-06/08):
 *   1. The client strips a trailing `_<digit>` from node names: no name here
 *      ends in a digit (TaskA, never Task_1).
 *   2. `k_node_find` sees only nodes WITH A MESH: every text anchor is a mesh.
 *   3. The publisher's merge bakes childless meshes with no extras into
 *      anonymous geometry: every node the script finds carries an extra
 *      (`interactable` for what is pressed, `script_node` for the rest).
 *   4. Floating (non-plaque) text yaw-faces the eye and is depth-tested:
 *      nothing solid sits within 0.5 m behind it.
 */

import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const RAD = Math.PI / 180;
/** A point `r` metres out at `deg` (0 = straight ahead, + = right), height `y`. */
export const at = (r, deg, y) => [r * Math.cos(deg * RAD), y, r * Math.sin(deg * RAD)];
/** The yaw that turns a node's +X axis to point from the spawn out through (r, deg). */
const facing = (deg) => -deg * RAD;

/** Positions the script also uses. Mirrored in ../script/src/layout.rs. */
export const LAYOUT = {
  // The Day Ring.
  ringR: 2.4,
  ringY: 1.78,
  ringDegPerHour: 15,
  ringShowDeg: 100,
  // The landing arc: 12 slots from -55 to +55 degrees.
  arcR: 1.0,
  cardY: 0.794,
  arcSlotsDeg: [-55, -45, -35, -25, -15, -5, 5, 15, 25, 35, 45, 55],
  dropH: 0.9,
  pileLaterDeg: -67,
  pileDoneDeg: 67,
  pileStepY: 0.016,
  well: [1.3, 0.794, 0],
  // The quiet shelf behind you.
  shelfX: -1.7,
  shelfY: 1.012,
  shelfSlots: [-0.5, -0.3, -0.1, 0.1, 0.3, 0.5], // z
  // Triage: the fan of five cards, and the reading card.
  fanR: 1.75,
  fanY: 1.42,
  fanDeg: [-42, -21, 0, 21, 42],
  readR: 1.4,
  readY: 1.1,
  riseFromY: 0.62,
  // The banner: under the now bar, or (in triage) just above the fan.
  bannerY: 1.555,
  bannerTriageY: 1.71,
  // Focus: the cocoon's facets slide in from cocoonFromR to cocoonR.
  cocoonR: 1.95,
  cocoonFromR: 3.0,
  cocoonFacets: 16,
  cocoonY: 1.3,
  templatePark: [0, -3, 0], // under the floor, hidden
};

// ---------------------------------------------------------------------------
// A minimal glTF writer (net-check's, KOS-983, plus alpha, emission and
// meshes of several primitives)
// ---------------------------------------------------------------------------

/** A primitive's geometry: positions, normals, triangle indices, and (for textured parts) UVs. */
function geom() {
  return { pos: [], nrm: [], idx: [], uv: null };
}
function quad(g, a, b, c, d, n) {
  const base = g.pos.length / 3;
  for (const p of [a, b, c, d]) g.pos.push(...p);
  for (let k = 0; k < 4; k++) g.nrm.push(...n);
  g.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** An axis-aligned box, centred on `c`. */
export function boxGeom(size, c = [0, 0, 0]) {
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

/** A vertical cylinder of radius r from y0 to y1 (smooth-shaded sides, so it reads round; capped). */
export function cylGeom(r, y0, y1, sides = 20) {
  const g = geom();
  for (let s = 0; s < sides; s++) {
    const a0 = (s / sides) * 2 * Math.PI, a1 = ((s + 1) / sides) * 2 * Math.PI;
    const p0 = [r * Math.cos(a0), r * Math.sin(a0)], p1 = [r * Math.cos(a1), r * Math.sin(a1)];
    const n0 = [Math.cos(a0), 0, Math.sin(a0)], n1 = [Math.cos(a1), 0, Math.sin(a1)];
    const base = g.pos.length / 3;
    for (const p of [[p1[0], y0, p1[1]], [p0[0], y0, p0[1]], [p0[0], y1, p0[1]], [p1[0], y1, p1[1]]]) g.pos.push(...p);
    for (const n of [n1, n0, n0, n1]) g.nrm.push(...n);
    g.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    // Caps as thin triangles (a degenerate quad keeps one writer).
    quad(g, [0, y1, 0], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]], [0, y1, 0], [0, 1, 0]);
    quad(g, [0, y0, 0], [p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [0, y0, 0], [0, -1, 0]);
  }
  return g;
}

/** A flat ring band around the vertical axis: radii r0..r1, from y0 to y1. */
export function ringGeom(r0, r1, y0, y1, segs = 96) {
  const g = geom();
  for (let s = 0; s < segs; s++) {
    const a0 = (s / segs) * 2 * Math.PI, a1 = ((s + 1) / segs) * 2 * Math.PI;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const am = (a0 + a1) / 2, cm = Math.cos(am), sm = Math.sin(am);
    quad(g, [r1 * c1, y0, r1 * s1], [r1 * c0, y0, r1 * s0], [r1 * c0, y1, r1 * s0], [r1 * c1, y1, r1 * s1], [cm, 0, sm]);
    quad(g, [r0 * c0, y0, r0 * s0], [r0 * c1, y0, r0 * s1], [r0 * c1, y1, r0 * s1], [r0 * c0, y1, r0 * s0], [-cm, 0, -sm]);
    quad(g, [r0 * c0, y1, r0 * s0], [r0 * c1, y1, r0 * s1], [r1 * c1, y1, r1 * s1], [r1 * c0, y1, r1 * s0], [0, 1, 0]);
    quad(g, [r0 * c1, y0, r0 * s1], [r0 * c0, y0, r0 * s0], [r1 * c0, y0, r1 * s0], [r1 * c1, y0, r1 * s1], [0, -1, 0]);
  }
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

  /** A PNG texture embedded in the binary chunk; returns its texture index. */
  texture(name, png) {
    const j = this.j;
    j.images = j.images ?? [];
    j.textures = j.textures ?? [];
    j.samplers = j.samplers ?? [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }];
    const bv = this.view(png);
    j.images.push({ name, bufferView: bv, mimeType: "image/png" });
    j.textures.push({ name, source: j.images.length - 1, sampler: 0 });
    return j.textures.length - 1;
  }

  /** opts: {alpha: 0..1, emissive, rough, metal, texture, blend (a texture with soft alpha), mask (a cut-out texture), doubleSided, unlit} */
  material(name, rgb, opts = {}) {
    if (this.materialIndex.has(name)) return this.materialIndex.get(name);
    const i = this.j.materials.length;
    const m = {
      name,
      pbrMetallicRoughness: { baseColorFactor: [...rgb, opts.alpha ?? 1], metallicFactor: opts.metal ?? 0, roughnessFactor: opts.rough ?? 0.85 },
    };
    if (opts.alpha !== undefined && opts.alpha < 1) m.alphaMode = "BLEND";
    if (opts.emissive) m.emissiveFactor = opts.emissive;
    if (opts.texture !== undefined) {
      m.pbrMetallicRoughness.baseColorTexture = { index: opts.texture };
      // Opaque unless the texture's alpha is meant: BLEND for soft alpha (the halo),
      // MASK for a cut-out drawn in the depth-tested opaque pass (the floor decal).
      if (opts.blend) m.alphaMode = "BLEND";
      if (opts.mask) {
        m.alphaMode = "MASK";
        m.alphaCutoff = 0.5;
      }
    }
    if (opts.doubleSided) m.doubleSided = true;
    if (opts.unlit) {
      // KHR_materials_unlit (allowlisted): the colour is drawn as is, unshaded. The headset
      // renders LDR with no bloom, so a light bar reads as crisp, not glowing.
      m.extensions = { KHR_materials_unlit: {} };
      this.used.add("KHR_materials_unlit");
    }
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

  /**
   * A mesh of one or more primitives: [[geom, materialIndex], ...]. The FIRST
   * primitive should be the whole outline: the mock host reads its bounds for
   * the laser check.
   */
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
      const attributes = { POSITION: posA, NORMAL: nrmA };
      if (gm.uv) {
        attributes.TEXCOORD_0 = a.length;
        a.push({ bufferView: this.view(Buffer.from(new Float32Array(gm.uv).buffer), 34962), componentType: 5126, count: n, type: "VEC2" });
      }
      return { attributes, indices: idxA, material: materialIndex, mode: 4 };
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

  box(name, t, size, materialIndex, extras, yawRad = 0) {
    this.node(name, t, [[boxGeom(size), materialIndex]], extras, yawRad);
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
// The look: holographic glass (CEO, 2026-10-19: "It looks like very early-2000s
// forms when we have the ability to improve that and change that"; art
// direction in work-in-vr-design/ART_DIRECTION_HOLO_GLASS.md). Smoked-glass
// panels, thin unlit cyan light bars and hairlines, outlined glass buttons, a
// segmented light ring with ticks, a projected floor ring and grid, and one
// faked halo. All of it authored here: geometry, materials and two bundle
// textures. Amber means "needs you" (now, a VIP); green and red only on Approve
// and Deny.
//
// Guardrails (the art direction's): at most two translucent layers on any pixel
// (glass panels never overlap each other in view; the halo hides when the banner
// or the cocoon would stack on it); emission at most 1.0 (LDR, no bloom: the
// light bars are unlit colour, so they read crisp); the world's glass never
// imitates Kosmos's own chrome (no amber Kosmos logo, no menu or sheet shapes).
//
// State colours are still chosen by which pre-built variant the script shows
// (script/src/style.rs); the visual pack (DB-045) will later set them at runtime.
// ---------------------------------------------------------------------------

const PRESS = { interactable: true };
const anchor = (role) => ({ script_node: role });

// --- PNG textures, made here (no dependencies), byte-for-byte deterministic ---

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** An RGBA PNG from a w x h pixel function (x, y) -> [r, g, b, a] in 0..255. */
export function png(w, h, px) {
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    for (let x = 0; x < w; x++) {
      const c = px(x, y);
      raw.set(c.map((v) => Math.max(0, Math.min(255, Math.round(v)))), y * (1 + w * 4) + 1 + x * 4);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const CYAN = [95, 230, 255];
const FLOOR_M = 6; // the floor decal spans 6 x 6 m, centred on the spawn (about 6 mm a texel)
/**
 * The projected floor ring and grid: rings under the arc and the Day Ring, tick marks,
 * a fading grid. The headset loads textures without mipmaps, so every line is at least
 * 2.5 texels wide and the grid stops at 2.6 m. A cut-out (MASK): the colour carries the
 * strength, the alpha is 0 or 1. VR only: in MR, passthrough never hides a virtual
 * pixel, so any floor ring would be painted across the real desk and chairs.
 */
function floorTexture() {
  const S = 1024;
  const line = (d, w) => Math.max(0, 1 - Math.abs(d) / w);
  return png(S, S, (x, y) => {
    const wx = ((x + 0.5) / S - 0.5) * FLOOR_M, wz = ((y + 0.5) / S - 0.5) * FLOOR_M;
    const r = Math.hypot(wx, wz);
    const ang = (Math.atan2(wz, wx) * 180) / Math.PI;
    const arcDist = (step) => {
      const d = ang - Math.round(ang / step) * step;
      return (Math.abs(d) * Math.PI * r) / 180;
    };
    const parts = [
      0.55 * line(r - LAYOUT.arcR, 0.02),
      0.9 * line(r - LAYOUT.ringR, 0.025),
      0.35 * line(r - (LAYOUT.ringR + 0.22), 0.018),
      0.3 * line(r - 0.45, 0.018),
      // tick marks just outside the Day Ring's floor ring: every 5 degrees, longer every 15
      r > LAYOUT.ringR + 0.03 && r < LAYOUT.ringR + 0.12 ? 0.6 * line(arcDist(5), 0.02) : 0,
      r > LAYOUT.ringR + 0.03 && r < LAYOUT.ringR + 0.2 ? 0.8 * line(arcDist(15), 0.022) : 0,
      // a grid every half metre, fading out by 2.6 m
      0.18 * Math.max(line(wx - Math.round(wx * 2) / 2, 0.018), line(wz - Math.round(wz * 2) / 2, 0.018)) * Math.max(0, Math.min(1, (2.6 - r) / 1.0)),
    ];
    const a = 1 - parts.reduce((acc, v) => acc * (1 - v), 1);
    // The strength darkens the cyan, as a blend over the dark floor would.
    return a < 0.08 ? [0, 0, 0, 0] : [...CYAN.map((c) => c * a), 255];
  });
}
/** A soft round glow (the one faked halo): white, alpha falling off from the centre. */
function haloTexture() {
  const S = 128;
  return png(S, S, (x, y) => {
    const d = Math.hypot((x + 0.5) / S - 0.5, (y + 0.5) / S - 0.5) / 0.5;
    return [255, 255, 255, 255 * Math.max(0, Math.exp(-d * d * 4) - 0.02)];
  });
}

/** A window pane: a sky that fades from its top colour to its horizon, with stars at night. Abstract, never a photo. */
function skyTexture(top, horizon, stars) {
  const W = 128, H = 96;
  const hash = (x, y) => {
    let h = (x * 374761393 + y * 668265263) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return (h ^ (h >>> 16)) / 4294967296;
  };
  return png(W, H, (x, y) => {
    const t = Math.pow(y / (H - 1), 1.4);
    const c = top.map((v, i) => v + (horizon[i] - v) * t);
    if (stars && y < H * 0.7 && hash(x, y) > 0.985) return [200, 220, 255, 255];
    return [...c, 255];
  });
}

function palette(g, variant) {
  const unlit = (name, rgb) => g.material(name, rgb, { unlit: true });
  // Every surface is UNLIT, so it never catches a light or a specular streak (the
  // headset renders LDR; lit glass read as a grey wall and washed out the words on it).
  // Text fields, capsules, pills and chips (and the VR cocoon) are SOLID near-black
  // glass: the references keep text fields clean, and a translucent field showed the now
  // bar and the ring through the banner's words (review round 1). Only the ring's band,
  // the MR plates, the halo and the MR cocoon are translucent, so no pixel sees more
  // than two translucent layers; the floor decal is a cut-out drawn in the opaque pass.
  return {
    floor: unlit("Floor", [0.008, 0.012, 0.02]),
    floorDecal: variant === "vr" ? g.material("FloorDecal", [1, 1, 1], { unlit: true, texture: g.texture("FloorRing", floorTexture()), mask: true, doubleSided: true }) : undefined,
    halo: g.material("NowHalo", [1.0, 0.66, 0.23], { unlit: true, texture: g.texture("Halo", haloTexture()), blend: true, doubleSided: true }),
    glass: unlit("SmokedGlass", [0.004, 0.008, 0.016]),
    glassPill: unlit("GlassPill", [0.02, 0.07, 0.09]),
    glassNow: unlit("GlassPillNow", [0.13, 0.075, 0.018]),
    glassPast: unlit("GlassPillPast", [0.012, 0.017, 0.026]),
    // VR: solid. MR: see-through, so the real room (the desk, what you could walk into)
    // stays in view in Focus; with the band hidden in Focus it is the only glass there.
    cocoon: variant === "mr" ? g.material("CocoonGlass", [0.003, 0.006, 0.012], { alpha: 0.8, unlit: true }) : unlit("CocoonGlass", [0.003, 0.006, 0.012]),
    band: g.material("BandGlass", [0.004, 0.008, 0.016], { alpha: variant === "mr" ? 0.8 : 0.6, unlit: true }),
    plate: g.material("TextPlate", [0.004, 0.008, 0.016], { alpha: 0.84, unlit: true }),
    shelfVr: unlit("ArcShelf", [0.02, 0.03, 0.045]),
    shelf: unlit("Shelf", [0.02, 0.03, 0.045]),
    // The floor and the shelves are unlit too: a lit floor caught a white glare streak.
    // Light: unlit colour, at most 1.0.
    cyan: unlit("LightCyan", [0.37, 0.9, 1.0]),
    teal: unlit("LightTeal", [0.12, 0.45, 0.55]),
    dim: unlit("LightDim", [0.08, 0.22, 0.28]),
    amber: unlit("LightAmber", [0.95, 0.66, 0.23]),
    amberCore: unlit("NowCore", [1.0, 0.85, 0.55]),
    green: unlit("LightGreen", [0.3, 0.9, 0.55]),
    red: unlit("LightRed", [1.0, 0.42, 0.36]),
    paneDay: g.material("PaneDay", [1, 1, 1], { unlit: true, texture: g.texture("SkyDay", skyTexture([22, 62, 110], [92, 150, 186], false)) }),
    paneDusk: g.material("PaneDusk", [1, 1, 1], { unlit: true, texture: g.texture("SkyDusk", skyTexture([34, 26, 64], [196, 104, 52], false)) }),
    paneNight: g.material("PaneNight", [1, 1, 1], { unlit: true, texture: g.texture("SkyNight", skyTexture([3, 6, 18], [14, 24, 52], true)) }),
    // Fully transparent: text anchors and plaque keels must exist (for k_node_find
    // and the rendered centre) but never show.
    stud: g.material("Unseen", [0, 0, 0], { alpha: 0 }),
  };
}

// The action row: above the VR shelf's back edge from a seated or standing eye, below the reading card.
const ACTION_Y = 0.83;

const CARD_R = 0.065;
const CARD_H = 0.012;
const FRONT = -0.006; // light bars sit this far in front of a panel's glass (toward the spawn)

/** The height of a block of n lines of world text (8 cm glyphs, spaced). Mirrors style.rs. */
export const textH = (n) => 0.08 + (n - 1) * 0.084;

/** A keel: invisible, hanging under a panel so its rendered centre is half of maxLines of text lower. */
function keel(P, h, maxLines) {
  const k = textH(maxLines) / 2;
  return [boxGeom([0.002, 2 * k, 0.002], [0, -h / 2 - k, 0]), P.stud];
}

/** Light bars along a panel's top and bottom edge, and small corner brackets: the structure. */
function lightBars(P, w, h, mat) {
  const t = 0.0035;
  const parts = [
    [boxGeom([0.004, t, w * 0.94], [FRONT, h / 2 - t / 2, 0]), mat],
    [boxGeom([0.004, t, w * 0.94], [FRONT, -h / 2 + t / 2, 0]), mat],
  ];
  const b = Math.min(0.05, h / 3), bt = 0.0025;
  for (const sy of [1, -1]) {
    for (const sz of [1, -1]) {
      const cy = sy * (h / 2 + 0.012), cz = sz * (w / 2 + 0.012);
      parts.push([boxGeom([0.003, bt, b], [FRONT, cy, cz - sz * (b / 2)]), P.teal]);
      parts.push([boxGeom([0.003, b, bt], [FRONT, cy - sy * (b / 2), cz]), P.teal]);
    }
  }
  return parts;
}

/**
 * A glass panel that faces the spawn: smoked glass, a light bar along its top
 * and bottom edges, corner brackets, and a keel (see keel()). Text shown on it
 * is printed flat on its face (the client's plaque rule), centred by the keel.
 */
function plaque(g, P, name, r, deg, y, w, h, maxLines, extras, barMat = P.cyan) {
  if (textH(maxLines) > h) throw new Error(`${name}: ${maxLines} lines do not fit ${h} m`);
  const body = boxGeom([0.006, h, w]);
  g.node(name, at(r, deg, y), [[body, P.glass], ...lightBars(P, w, h, barMat), keel(P, h, maxLines)], extras, facing(deg));
}

/** A stadium (a capsule outline) in the panel plane (z across, y up), at depth x, inset by `inset`. */
function stadiumPoints(w, h, inset = 0, n = 10) {
  const rr = h / 2 - inset, cz = w / 2 - h / 2;
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const a = -Math.PI / 2 + (k / n) * Math.PI;
    pts.push([cz + rr * Math.cos(a), rr * Math.sin(a)]);
  }
  for (let k = 0; k <= n; k++) {
    const a = Math.PI / 2 + (k / n) * Math.PI;
    pts.push([-cz + rr * Math.cos(a), rr * Math.sin(a)]);
  }
  return pts;
}
function stadiumFill(w, h, x) {
  const g = geom();
  const pts = stadiumPoints(w, h);
  for (const [face, nx] of [[x - 0.003, -1], [x + 0.003, 1]]) {
    const base = g.pos.length / 3;
    g.pos.push(face, 0, 0);
    g.nrm.push(nx, 0, 0);
    for (const [z, y] of pts) {
      g.pos.push(face, y, z);
      g.nrm.push(nx, 0, 0);
    }
    for (let k = 0; k < pts.length; k++) {
      const a = base + 1 + k, b = base + 1 + ((k + 1) % pts.length);
      if (nx < 0) g.idx.push(base, a, b);
      else g.idx.push(base, b, a);
    }
  }
  return g;
}
function stadiumOutline(w, h, t, x) {
  const g = geom();
  const o = stadiumPoints(w, h, 0), i = stadiumPoints(w, h, t);
  for (let k = 0; k < o.length; k++) {
    const k2 = (k + 1) % o.length;
    quad(g, [x, o[k][1], o[k][0]], [x, o[k2][1], o[k2][0]], [x, i[k2][1], i[k2][0]], [x, i[k][1], i[k][0]], [-1, 0, 0]);
  }
  return g;
}

/**
 * A button: an outlined glass capsule facing the spawn, its label printed on it
 * (centred by its keel). Outlines are cyan; green and red only on Approve and Deny.
 */
function capsule(g, P, name, r, deg, y, w, h, outline, extras = PRESS) {
  g.node(name, at(r, deg, y), [[stadiumFill(w, h, 0), P.glass], [stadiumOutline(w, h, 0.004, FRONT), outline], keel(P, h, 1)], extras, facing(deg));
}

/** A text anchor for floating (upright) text: a 1 cm stud the script can find. */
function stud(g, P, name, t) {
  g.box(name, t, [0.01, 0.01, 0.01], P.stud, anchor("text"));
}

/** An arc of a flat ring band around the vertical axis, from angle a0 to a1 (radians). */
function arcGeom(r0, r1, y0, y1, a0, a1, segs) {
  const g = geom();
  for (let s = 0; s < segs; s++) {
    const b0 = a0 + ((a1 - a0) * s) / segs, b1 = a0 + ((a1 - a0) * (s + 1)) / segs;
    const c0 = Math.cos(b0), s0 = Math.sin(b0), c1 = Math.cos(b1), s1 = Math.sin(b1);
    const bm = (b0 + b1) / 2, cm = Math.cos(bm), sm = Math.sin(bm);
    quad(g, [r1 * c1, y0, r1 * s1], [r1 * c0, y0, r1 * s0], [r1 * c0, y1, r1 * s0], [r1 * c1, y1, r1 * s1], [cm, 0, sm]);
    quad(g, [r0 * c0, y0, r0 * s0], [r0 * c1, y0, r0 * s1], [r0 * c1, y1, r0 * s1], [r0 * c0, y1, r0 * s0], [-cm, 0, -sm]);
    quad(g, [r0 * c0, y1, r0 * s0], [r0 * c1, y1, r0 * s1], [r1 * c1, y1, r1 * s1], [r1 * c0, y1, r1 * s0], [0, 1, 0]);
    quad(g, [r0 * c1, y0, r0 * s1], [r0 * c0, y0, r0 * s0], [r1 * c0, y0, r1 * s0], [r1 * c1, y0, r1 * s1], [0, -1, 0]);
  }
  return g;
}
/** A segmented light ring: `n` dashes with gaps (a HUD ring, never a solid torus). */
function segmentedRing(r0, r1, y0, y1, n, duty) {
  const g = geom();
  const step = (2 * Math.PI) / n;
  for (let k = 0; k < n; k++) {
    const part = arcGeom(r0, r1, y0, y1, k * step, k * step + step * duty, 2);
    const base = g.pos.length / 3;
    g.pos.push(...part.pos);
    g.nrm.push(...part.nrm);
    g.idx.push(...part.idx.map((i) => i + base));
  }
  return g;
}

/** A face-down card: a glass chip with a light rim (the rim is its state colour; a VIP's is wider, amber). */
function cardParts(P, rimMat, rimW = 0.006) {
  return [
    [cylGeom(CARD_R, -CARD_H / 2, CARD_H / 2, 28), P.glass],
    [ringGeom(CARD_R + 0.001 - rimW, CARD_R + 0.001, -CARD_H / 2 - 0.0015, CARD_H / 2 + 0.0015, 28), rimMat],
  ];
}

/** An event: a glass pill with a light ring at its top and bottom (its tone), round so it reads the same from anywhere. */
function pillParts(P, glassMat, lightMat) {
  const r = 0.055, h = 0.085;
  return [
    [cylGeom(r, -h, h, 24), glassMat],
    [ringGeom(r - 0.001, r + 0.003, h - 0.008, h - 0.002, 24), lightMat],
    [ringGeom(r - 0.001, r + 0.003, -h + 0.002, -h + 0.008, 24), lightMat],
  ];
}

function scripted(g, P, variant) {
  const L = LAYOUT;
  const T = L.templatePark;

  // --- The Day Ring: a segmented cyan light ring with a teal rail above and below,
  //     hour ticks the script turns with the day, and the now bar straight ahead.
  // `hollow`: a ring, not a disc. The mock host's laser check tests the band itself
  // (on the headset the laser passes through the ring's open middle).
  g.node("RingTrack", [0, L.ringY, 0], [[segmentedRing(L.ringR - 0.005, L.ringR + 0.005, -0.0025, 0.0025, 120, 0.78), P.cyan]], { script_node: "ring", hollow: [L.ringR - 0.005, L.ringR + 0.005, -0.0025, 0.0025] });
  for (const [name, dy] of [["RingRailHi", 0.07], ["RingRailLo", -0.07]]) {
    g.node(name, [0, L.ringY + dy, 0], [[ringGeom(L.ringR - 0.002, L.ringR + 0.002, -0.001, 0.001, 144), P.teal]], { hollow: [L.ringR - 0.002, L.ringR + 0.002, -0.001, 0.001] });
  }
  for (let h = 7; h <= 19; h++) {
    const major = h % 3 === 0;
    const len = major ? 0.16 : 0.09;
    g.node(`HourTick${String.fromCharCode(65 + h - 7)}`, at(L.ringR, 0, L.ringY), [[cylGeom(0.0025, -len / 2, len / 2, 8), major ? P.cyan : P.teal]], anchor("tick"));
  }
  // It stops just above the pills, under the labels' lower row (they start 0.1 m up).
  g.node("NowBar", at(L.ringR - 0.03, 0, L.ringY), [[cylGeom(0.006, -0.2, 0.09, 12), P.amberCore], [ringGeom(0.012, 0.018, 0.085, 0.09, 16), P.amber], [ringGeom(0.012, 0.018, -0.2, -0.195, 16), P.amber]], anchor("now"));
  // The one faked halo: a soft amber glow behind the top of the now bar. Only the band
  // is translucent behind it, and everything in front of it is solid, so it never
  // makes a third layer (the script also hides it in triage and focus).
  {
    const hq = geom(), hw = 0.34, hh = 0.3;
    quad(hq, [0, -hh / 2, -hw / 2], [0, -hh / 2, hw / 2], [0, hh / 2, hw / 2], [0, hh / 2, -hw / 2], [-1, 0, 0]);
    hq.uv = [0, 1, 1, 1, 1, 0, 0, 0];
    g.node("NowHalo", at(L.ringR + 0.02, 0, L.ringY + 0.04), [[hq, P.halo]], anchor("halo"), facing(0));
  }
  // --- The banner, under the now bar, on every mode: inside the focus cocoon, so
  //     it stays readable when the room closes in. Amber bars: it is the notice band.
  plaque(g, P, "TxtBanner", 1.8, 0, L.bannerY, 1.45, 0.19, 2, anchor("text"), P.amber);

  // --- The mode column on the left: outlined glass capsules with their labels on them.
  const modeDeg = -60, modeR = 1.45;
  [["BtnSignIn", 1.86, 0.56], ["BtnAbout", 1.715, 0.44], ["BtnModeMorning", 1.57, 0.44], ["BtnModeFocus", 1.425, 0.44], ["BtnModeTriage", 1.28, 0.44], ["BtnModeWrap", 1.135, 0.44]].forEach(
    ([n, y, w]) => capsule(g, P, n, modeR, modeDeg, y, w, 0.11, P.cyan),
  );
  stud(g, P, "TxtStatus", at(modeR, modeDeg, 0.84));

  // --- The stage, front and centre: the brief, prep, wrap-up, About.
  plaque(g, P, "TxtStage", 1.7, 0, 1.2, 1.5, 0.44, 4, anchor("text"));
  capsule(g, P, "BtnPrepClose", 1.6, 31, 1.05, 0.33, 0.11, P.cyan);
  capsule(g, P, "BtnAboutNext", 1.6, 31, 1.05 + 0.0001, 0.33, 0.11, P.cyan);

  // --- The landing arc. VR: a curved low shelf of dark flat facets with a light
  //     edge; MR: only the light edge (the floor ring is projected on the real floor).
  const facetDeg = 10;
  for (let k = 0; k < 17; k++) {
    const deg = -80 + k * facetDeg;
    const w = 2 * L.arcR * Math.tan((facetDeg / 2) * RAD) + 0.004;
    // 0.18 m deep (0.91 to 1.09 m), so it never hides the action row's labels at 1.15 m.
    if (variant === "vr") g.box(`ArcFacet${String.fromCharCode(65 + k)}`, at(L.arcR, deg, L.cardY - CARD_H / 2 - 0.012), [0.18, 0.024, w * 0.985], P.shelfVr, undefined, facing(deg));
    g.box(`ArcEdge${String.fromCharCode(65 + k)}`, at(L.arcR - 0.092, deg, L.cardY - CARD_H / 2 - 0.004), [0.004, 0.004, w * 0.9], P.cyan, undefined, facing(deg));
    g.box(`ArcEdgeBack${String.fromCharCode(65 + k)}`, at(L.arcR + 0.092, deg, L.cardY - CARD_H / 2 - 0.004), [0.003, 0.003, w * 0.9], P.teal, undefined, facing(deg));
  }
  // Later and Done at the arc's ends; their counts ride on them.
  const pad = (mat) => [[cylGeom(CARD_R + 0.012, -0.002, 0.002, 28), P.glass], [ringGeom(CARD_R + 0.008, CARD_R + 0.013, -0.0025, 0.0025, 28), mat]];
  g.node("PileLater", at(L.arcR, L.pileLaterDeg, L.cardY - CARD_H / 2 - 0.002), pad(P.teal), anchor("pile"));
  g.node("PileDone", at(L.arcR, L.pileDoneDeg, L.cardY - CARD_H / 2 - 0.002), pad(P.teal), anchor("pile"));
  // The inbox well, front and centre behind the arc: what waits for a slot stacks here.
  g.node("InboxWell", [L.well[0], L.cardY - CARD_H / 2 - 0.002, L.well[2]], [[cylGeom(CARD_R + 0.016, -0.002, 0.002, 28), P.glass], [ringGeom(CARD_R + 0.011, CARD_R + 0.017, -0.003, 0.003, 28), P.cyan]], anchor("inbox"));

  // --- Triage: the fan of five glass cards (built facing the spawn, hidden until
  //     triage; the script raises each from its card's slot), the reading card, the
  //     five action capsules, and a draft with Approve, Deny and More.
  L.fanDeg.forEach((deg, i) => {
    const s = String.fromCharCode(65 + i);
    plaque(g, P, `Fan${s}`, L.fanR, deg, L.fanY, 0.62, 0.26, 2, PRESS);
    // A VIP's amber frame: four thin bars just outside its card.
    const w = 0.62, h = 0.26, t = 0.004;
    g.node(`FanVip${s}`, at(L.fanR + 0.004, deg, L.fanY), [
      [boxGeom([0.004, t, w + 0.03], [FRONT, h / 2 + 0.015, 0]), P.amber],
      [boxGeom([0.004, t, w + 0.03], [FRONT, -h / 2 - 0.015, 0]), P.amber],
      [boxGeom([0.004, h + 0.03, t], [FRONT, 0, w / 2 + 0.015]), P.amber],
      [boxGeom([0.004, h + 0.03, t], [FRONT, 0, -w / 2 - 0.015]), P.amber],
    ], anchor("fanvip"), facing(deg));
  });
  plaque(g, P, "TxtOpen", L.readR, 0, L.readY, 1.12, 0.4, 4, anchor("text"));
  [["BtnDone", -26], ["BtnLater", -13], ["BtnReply", 0], ["BtnTask", 13], ["BtnMute", 26]].forEach(([n, deg]) => capsule(g, P, n, 1.15, deg, ACTION_Y, 0.23, 0.1, P.cyan));
  // A draft takes the reading card's place, front and centre, and Approve, Deny and
  // More take the action row's. Never shown at the same time as the card and the five
  // actions, so the shared spots never both take a press.
  plaque(g, P, "TxtDraft", L.readR, 0, L.readY, 1.12, 0.4, 4, anchor("text"));
  [["BtnApprove", -20, 0.34, P.green], ["BtnDeny", 0, 0.26, P.red], ["BtnMore", 20, 0.34, P.cyan]].forEach(([n, deg, w, m]) => capsule(g, P, n, 1.15, deg, ACTION_Y + 0.0001, w, 0.1, m));

  // --- Pinned tasks on the right, with a header line of counts.
  // Below the Day Ring's labels (they start 0.1 m above the ring at 1.78 m).
  plaque(g, P, "TxtTasks", 1.6, 52, 1.6, 1.0, 0.12, 1, anchor("text"), P.teal);
  [["TaskA", 1.4], ["TaskB", 1.18], ["TaskC", 0.96]].forEach(([n, y]) => plaque(g, P, n, 1.6, 52, y, 0.8, 0.19, 2, PRESS));

  // --- Focus: the task and its timer, close and centred; the next event above;
  //     start or pause; and the cocoon, 16 dark glass facets that close in from 3 m,
  //     each with a light bar along its top and bottom.
  plaque(g, P, "TxtFocus", 1.45, 0, 1.2, 1.1, 0.3, 3, anchor("text"));
  plaque(g, P, "TxtTimer", 1.45, 0, 0.94, 0.8, 0.13, 1, anchor("text"), P.teal);
  capsule(g, P, "BtnFocusGo", 1.3, 26, 0.94, 0.28, 0.11, P.cyan);
  stud(g, P, "TxtNext", at(1.4, 0, 1.72));
  for (let k = 0; k < L.cocoonFacets; k++) {
    const deg = (k * 360) / L.cocoonFacets;
    const w = 2 * L.cocoonR * Math.tan((180 / L.cocoonFacets) * RAD) + (variant === "mr" ? 0 : 0.01);
    g.node(`Cocoon${String.fromCharCode(65 + k)}`, at(L.cocoonFromR, deg, L.cocoonY), [
      [boxGeom([0.02, 2.6, w]), P.cocoon],
      [boxGeom([0.004, 0.004, w * 0.9], [FRONT - 0.01, 0.9, 0]), P.teal],
      [boxGeom([0.004, 0.004, w * 0.9], [FRONT - 0.01, -0.9, 0]), P.teal],
    ], anchor("cocoon"), facing(deg));
  }

  // --- The window, on the left: three panes (day, dusk, night) framed by light
  //     bars and brackets, and a glass sill carrying the weather and one headline.
  const winDeg = -82, winR = 2.1, winY = 1.52;
  g.node("WindowFrame", at(winR - 0.016, winDeg, winY), lightBars(P, 0.9, 0.68, P.cyan), undefined, facing(winDeg));
  const pane = (name, dr, mat) => {
    const q = geom();
    quad(q, [0, -0.34, -0.45], [0, -0.34, 0.45], [0, 0.34, 0.45], [0, 0.34, -0.45], [-1, 0, 0]);
    q.uv = [0, 1, 1, 1, 1, 0, 0, 0];
    g.node(name, at(winR - dr, winDeg, winY), [[q, mat]], anchor("pane"), facing(winDeg));
  };
  pane("PaneDay", 0, P.paneDay);
  pane("PaneDusk", 0.004, P.paneDusk);
  pane("PaneNight", 0.008, P.paneNight);
  g.box("WindowBarV", at(winR - 0.014, winDeg, winY), [0.004, 0.66, 0.004], P.dim, undefined, facing(winDeg));
  g.box("WindowBarH", at(winR - 0.014, winDeg, winY), [0.004, 0.004, 0.88], P.dim, undefined, facing(winDeg));
  plaque(g, P, "TxtWindow", winR - 0.02, winDeg, 1.0, 1.0, 0.26, 3, anchor("text"), P.teal);

  // --- The quiet shelf behind you, with its label above it.
  g.node("QuietShelf", [L.shelfX, 0.99, 0], [[boxGeom([0.3, 0.02, 1.4]), P.shelf], [boxGeom([0.004, 0.004, 1.4], [0.152, 0.012, 0]), P.teal]], anchor("shelf"));
  plaque(g, P, "TxtQuiet", Math.abs(L.shelfX) + 0.1, 180, 1.26, 1.0, 0.2, 2, anchor("text"), P.teal);

  // --- Templates the script clones (parked under the floor, hidden at init).
  // The message cards' rims follow the palette (structure cyan, VIP amber), not the
  // sources' brand colours; the sources keep their own templates for the visual pack.
  const tpl = (name, i, parts, extras = PRESS) => g.node(name, [T[0] + i * 0.3, T[1], T[2]], parts, extras);
  tpl("TplMsgGmail", 0, cardParts(P, P.cyan));
  tpl("TplMsgSlack", 1, cardParts(P, P.cyan));
  tpl("TplMsgGithub", 2, cardParts(P, P.cyan));
  tpl("TplMsgLinear", 3, cardParts(P, P.cyan));
  tpl("TplMsgVip", 4, cardParts(P, P.amber, 0.014));
  tpl("TplMsgRead", 5, cardParts(P, P.dim));
  tpl("TplEvent", 6, pillParts(P, P.glassPill, P.cyan));
  tpl("TplEventNow", 7, pillParts(P, P.glassNow, P.amber));
  tpl("TplEventPast", 8, pillParts(P, P.glassPast, P.dim));
  g.empty("spawn_point", [0, 0, 0], { spawn_point: true });
  g.box(variant === "mr" ? "VariantMr" : "VariantVr", [T[0], T[1] - 1, T[2]], [0.01, 0.01, 0.01], P.stud, anchor("variant"));
}

/** The projected floor ring and grid: one textured quad on the floor. */
function floorDecal(g, P, y) {
  const q = geom(), h = FLOOR_M / 2;
  quad(q, [-h, 0, h], [h, 0, h], [h, 0, -h], [-h, 0, -h], [0, 1, 0]);
  q.uv = [0, 1, 1, 1, 1, 0, 0, 0];
  g.node("FloorDecal", [0, y, 0], [[q, P.floorDecal]]);
}

/**
 * The Day Ring's band: dark glass facets 0.55 m behind the ring, from -100 to
 * +100 degrees, each with a light bar along its top and bottom (the glass wall of
 * the first reference). Its labels read against it; shown while a ring label shows.
 */
function ringBand(g, P) {
  for (let k = 0; k < 21; k++) {
    const deg = -100 + k * 10;
    const r = LAYOUT.ringR + 0.55;
    const w = 2 * r * Math.tan(5 * RAD) + 0.006;
    g.node(`RingBand${String.fromCharCode(65 + k)}`, at(r, deg, 2.08), [
      [boxGeom([0.01, 0.95, w]), P.band],
      [boxGeom([0.004, 0.004, w * 0.98], [FRONT, 0.475 - 0.004, 0]), P.cyan],
      [boxGeom([0.004, 0.003, w * 0.98], [FRONT, -0.475 + 0.004, 0]), P.teal],
    ], anchor("band"), facing(deg));
  }
}

function vrRoom(g, P) {
  // A dark glossy floor with the projected ring and grid. No walls: sky "night".
  g.box("Floor", [0, -0.05, 0], [14, 0.1, 14], P.floor);
  floorDecal(g, P, 0.003);
  ringBand(g, P);
}

function mrRoom(g, P) {
  // The real room is the room: no floor decal (it would be painted across the real
  // furniture), and dark plates sit behind the text that floats.
  ringBand(g, P);
  mrPlates(g, P);
}

/**
 * MR only: dark plates behind the floating text groups (text on glass panels and
 * capsules needs none). Each plate sits 0.5 m beyond its text along the line from
 * the spawn and is sized to frame the text from any eye height from seated
 * (EYE_LOW) to standing (EYE_HIGH). The script shows a plate only while its text
 * shows (PLATES in script/src/lib.rs). Every plate is farther from the spawn than
 * anything pressable in its direction, so it never blocks a press.
 */
export const PLATES = [
  // name, text centre (glTF), text width x height (m)
  ["PlateStatus", [...at(1.45, -60, 0.92)], [1.05, 0.2]],
  ["PlateInbox", [LAYOUT.well[0], 0.92, LAYOUT.well[2]], [0.5, 0.28]],
  ["PlateLater", [...at(1.0, LAYOUT.pileLaterDeg, 0.88)], [0.42, 0.12]],
  ["PlateDone", [...at(1.0, LAYOUT.pileDoneDeg, 0.88)], [0.42, 0.12]],
];

// The eye heights a plate must frame its text from: seated at a desk to standing.
export const EYE_LOW = 1.15;
export const EYE_HIGH = 1.75;

function mrPlates(g, P) {
  for (const [name, c, [w, h0]] of PLATES) {
    const r = Math.hypot(c[0], c[2]);
    const k = (r + 0.5) / r;
    const top = (c[1] + h0 / 2) * k + EYE_LOW * (1 - k);
    const bot = (c[1] - h0 / 2) * k + EYE_HIGH * (1 - k);
    const h = (top - bot) / k;
    const pos = [c[0] * k, (top + bot) / 2, c[2] * k];
    const yaw = Math.atan2(-c[2], c[0]);
    g.box(name, pos, [0.01, h * k, w * k], P.plate, anchor("plate"), yaw);
  }
}

export function build(variant) {
  const g = new Gltf(`KosmosWorlds more-room/tools/build_glb.mjs (${variant})`);
  const P = palette(g, variant);
  if (variant === "vr") vrRoom(g, P);
  else mrRoom(g, P);
  scripted(g, P, variant);
  return g;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("build_glb.mjs")) {
  const which = process.argv[2] ?? "both";
  const variants = which === "both" ? ["vr", "mr"] : [which];
  for (const v of variants) {
    if (!["vr", "mr"].includes(v)) {
      console.error("usage: node more-room/tools/build_glb.mjs vr|mr|both");
      process.exit(2);
    }
    const out = path.join(ROOT, `world-${v}`, "world.glb");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const g = build(v);
    fs.writeFileSync(out, g.glb());
    console.log(`wrote ${path.relative(ROOT, out)} (${fs.statSync(out).size} bytes, ${g.j.nodes.length} nodes)`);
  }
}
