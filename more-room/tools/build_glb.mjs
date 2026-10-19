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
 *   1.15-1.4 m   triage's action pucks and the reading card (shown in triage)
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
 * client 944abfa). So what moves is round about the vertical (pills, discs,
 * pucks: they look the same from every side), and what is flat is built
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

/** A primitive's geometry: positions, normals and triangle indices. */
function geom() {
  return { pos: [], nrm: [], idx: [] };
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
  }

  /** opts: {alpha: 0..1, emissive: [r,g,b], rough, metal} */
  material(name, rgb, opts = {}) {
    if (this.materialIndex.has(name)) return this.materialIndex.get(name);
    const i = this.j.materials.length;
    const m = {
      name,
      pbrMetallicRoughness: { baseColorFactor: [...rgb, opts.alpha ?? 1], metallicFactor: opts.metal ?? 0, roughnessFactor: opts.rough ?? 0.85 },
    };
    if (opts.alpha !== undefined && opts.alpha < 1) m.alphaMode = "BLEND";
    if (opts.emissive) m.emissiveFactor = opts.emissive;
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
    this.j.bufferViews.push({ buffer: 0, byteOffset: this.byteLength, byteLength: bytes.length, target });
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
// The look: one palette. State colours are chosen by which pre-built variant
// the script shows (script/src/style.rs); the visual pack (DB-045) will later
// set them at runtime instead.
// ---------------------------------------------------------------------------

const PRESS = { interactable: true };
const anchor = (role) => ({ script_node: role });

function palette(g) {
  const glow = (name, rgb, k = 0.55) => g.material(name, rgb, { emissive: rgb.map((v) => v * k) });
  return {
    floor: g.material("Floor", [0.02, 0.025, 0.035]),
    grid: g.material("GridLine", [0.1, 0.14, 0.2], { emissive: [0.02, 0.04, 0.07] }),
    shelf: g.material("Shelf", [0.05, 0.06, 0.08], { rough: 0.4, metal: 0.3 }),
    shelfVr: g.material("ArcShelf", [0.07, 0.08, 0.11], { rough: 0.35, metal: 0.2 }),
    arcMat: g.material("ArcMat", [0.02, 0.03, 0.06], { alpha: 0.7 }),
    edge: glow("EdgeGlow", [0.32, 0.6, 1.0], 0.8),
    track: glow("RingTrack", [0.3, 0.42, 0.62], 0.5),
    tick: glow("HourTick", [0.38, 0.5, 0.7], 0.45),
    tickMajor: glow("HourTickMajor", [0.55, 0.7, 0.9], 0.6),
    now: g.material("NowBar", [1.0, 0.82, 0.45], { emissive: [1.0, 0.75, 0.32] }),
    nowHalo: g.material("NowHalo", [1.0, 0.7, 0.3], { alpha: 0.28, emissive: [0.9, 0.55, 0.15] }),
    evFuture: glow("EventFuture", [0.35, 0.72, 1.0], 0.7),
    evNow: g.material("EventNow", [1.0, 0.72, 0.28], { emissive: [0.95, 0.6, 0.18] }),
    evPast: g.material("EventPast", [0.2, 0.23, 0.3], { emissive: [0.03, 0.04, 0.06] }),
    card: g.material("CardBody", [0.06, 0.08, 0.13], { rough: 0.45 }),
    cardRead: g.material("CardRead", [0.22, 0.26, 0.34], { rough: 0.5 }),
    gmail: glow("SrcGmail", [0.95, 0.38, 0.32]),
    slack: glow("SrcSlack", [0.65, 0.42, 0.95]),
    github: glow("SrcGithub", [0.62, 0.68, 0.78], 0.35),
    linear: glow("SrcLinear", [0.42, 0.52, 1.0]),
    vip: g.material("SrcVip", [1.0, 0.82, 0.32], { emissive: [1.0, 0.72, 0.2] }),
    plaque: g.material("Plaque", [0.035, 0.045, 0.075], { rough: 0.5 }),
    plaqueEdge: glow("PlaqueEdge", [0.3, 0.5, 0.8], 0.45),
    focusEdge: g.material("FocusEdge", [1.0, 0.7, 0.25], { emissive: [0.85, 0.52, 0.14] }),
    plate: g.material("TextPlate", [0.02, 0.03, 0.06], { alpha: 0.84 }),
    band: g.material("RingBand", [0.015, 0.02, 0.04], { alpha: 0.8 }),
    cocoon: g.material("Cocoon", [0.004, 0.006, 0.012], { alpha: 0.88 }),
    // Fully transparent: text anchors and plaque keels must exist (for k_node_find
    // and the rendered centre) but never show (review v2, lens B, LOW-3 and LOW-4).
    stud: g.material("Unseen", [0, 0, 0], { alpha: 0 }),
    puck: glow("ModePuck", [0.32, 0.55, 0.95], 0.55),
    signin: g.material("SignInPuck", [1.0, 0.7, 0.28], { emissive: [0.6, 0.38, 0.08] }),
    about: glow("AboutPuck", [0.7, 0.75, 0.85], 0.35),
    action: glow("ActionPuck", [0.55, 0.6, 0.72], 0.3),
    done: glow("DonePuck", [0.25, 0.85, 0.5]),
    later: glow("LaterPuck", [1.0, 0.72, 0.25]),
    mute: glow("MutePuck", [0.45, 0.48, 0.58], 0.3),
    approve: glow("ApprovePuck", [0.25, 0.9, 0.5], 0.7),
    deny: glow("DenyPuck", [1.0, 0.35, 0.3], 0.6),
    focus: g.material("FocusPuck", [1.0, 0.7, 0.28], { emissive: [0.6, 0.38, 0.08] }),
    frame: g.material("WindowFrame", [0.06, 0.07, 0.09], { rough: 0.35, metal: 0.4 }),
    paneDay: g.material("PaneDay", [0.45, 0.7, 0.95], { emissive: [0.3, 0.5, 0.75] }),
    paneDusk: g.material("PaneDusk", [0.98, 0.55, 0.32], { emissive: [0.75, 0.36, 0.17] }),
    paneNight: g.material("PaneNight", [0.04, 0.06, 0.16], { emissive: [0.02, 0.03, 0.1] }),
    well: glow("WellRim", [0.35, 0.6, 1.0], 0.6),
    pile: g.material("PilePad", [0.08, 0.1, 0.15], { rough: 0.4 }),
    quiet: g.material("QuietCard", [0.16, 0.17, 0.2]),
  };
}

const CARD_R = 0.065;
const CARD_H = 0.014;
const PUCK_R = 0.034;
const PUCK_H = 0.05;
const PLAQUE_D = 0.012;

/** A pressable or findable vertical puck. */
function puck(g, name, t, mat, extras = PRESS) {
  g.node(name, t, [[cylGeom(PUCK_R, -PUCK_H / 2, PUCK_H / 2, 20), mat]], extras);
}

/** The height of a block of n lines of world text (8 cm glyphs, spaced). Mirrors style.rs. */
export const textH = (n) => 0.08 + (n - 1) * 0.084;

/**
 * A plaque: a thin dark card that faces the spawn, with a glowing hairline
 * along its bottom edge. Text shown on it is printed flat on its face.
 *
 * The client puts a text's BOTTOM at the anchor's rendered centre plus
 * offset_y, and clamps a negative offset to 0 (KDomUI.cpp). So a hair-thin
 * dark keel hangs under the card, lowering its rendered centre by half the
 * height of `maxLines` lines: then a positive offset (style::offset) centres
 * any 1..maxLines of text on the card.
 */
function plaque(g, P, name, r, deg, y, w, h, maxLines, extras, edgeMat = P.plaqueEdge) {
  const k = textH(maxLines) / 2;
  const body = boxGeom([PLAQUE_D, h, w]);
  const edge = boxGeom([PLAQUE_D * 1.2, 0.006, w], [0, -h / 2 + 0.003, 0]);
  const keel = boxGeom([0.002, 2 * k, 0.002], [0, -h / 2 - k, 0]);
  if (textH(maxLines) > h) throw new Error(`${name}: ${maxLines} lines do not fit ${h} m`);
  g.node(name, at(r, deg, y), [[body, P.plaque], [edge, edgeMat], [keel, P.stud]], extras, facing(deg));
}

/** A text anchor for floating (upright) text: a 1 cm stud the script can find. */
function stud(g, P, name, t) {
  g.box(name, t, [0.01, 0.01, 0.01], P.stud, anchor("text"));
}

/** A face-down card: a dark disc with a coloured rim (the rim is its state colour; a VIP's is wider). */
function cardParts(rimMat, topMat, rimW = 0.01) {
  return [
    [cylGeom(CARD_R, -CARD_H / 2, CARD_H / 2, 24), topMat],
    [ringGeom(CARD_R + 0.002 - rimW, CARD_R + 0.002, -CARD_H / 2 - 0.001, CARD_H / 2 + 0.001, 24), rimMat],
  ];
}

function scripted(g, P, variant) {
  const L = LAYOUT;
  const T = L.templatePark;

  // --- The Day Ring: a thin track, hour ticks the script turns with the day,
  //     and the now bar, always straight ahead.
  // `hollow`: a ring, not a disc. The mock host's laser check tests the band itself
  // (on the headset the laser passes through the ring's open middle).
  g.node("RingTrack", [0, L.ringY, 0], [[ringGeom(L.ringR - 0.004, L.ringR + 0.004, -0.003, 0.003, 144), P.track]], { script_node: "ring", hollow: [L.ringR - 0.004, L.ringR + 0.004, -0.003, 0.003] });
  for (let h = 7; h <= 19; h++) {
    const major = h % 3 === 0;
    const len = major ? 0.09 : 0.05;
    g.node(`HourTick${String.fromCharCode(65 + h - 7)}`, at(L.ringR, 0, L.ringY), [[cylGeom(0.004, -len / 2, len / 2, 8), major ? P.tickMajor : P.tick]], anchor("tick"));
  }
  // It stops just above the pills, under the labels' lower row (they start 0.1 m up).
  g.node("NowBar", at(L.ringR - 0.03, 0, L.ringY), [[cylGeom(0.009, -0.2, 0.09, 12), P.now], [cylGeom(0.035, -0.22, 0.095, 20), P.nowHalo]], anchor("now"));
  // --- The banner, under the now bar, on every mode: inside the focus cocoon, so
  //     it stays readable when the room closes in.
  plaque(g, P, "TxtBanner", 1.8, 0, L.bannerY, 1.45, 0.19, 2, anchor("text"), P.focusEdge);

  // --- The mode column on the left: Owner sign in, About, then the four modes.
  //     Pucks are round, so they read the same from anywhere; labels sit above each.
  const modeDeg = -60, modeR = 1.45;
  [["BtnSignIn", 1.86, P.signin], ["BtnAbout", 1.7, P.about], ["BtnModeMorning", 1.54, P.puck], ["BtnModeFocus", 1.38, P.puck], ["BtnModeTriage", 1.22, P.puck], ["BtnModeWrap", 1.06, P.puck]].forEach(
    ([n, y, m]) => puck(g, n, at(modeR, modeDeg, y), m),
  );
  stud(g, P, "TxtStatus", at(modeR, modeDeg, 0.84));

  // --- The stage, front and centre: the brief, prep, wrap-up, About.
  plaque(g, P, "TxtStage", 1.7, 0, 1.2, 1.5, 0.44, 4, anchor("text"));
  puck(g, "BtnPrepClose", at(1.6, 25, 1.05), P.action);
  puck(g, "BtnAboutNext", at(1.6, 25, 1.05 + 0.0001), P.about);

  // --- The landing arc. VR: a curved low shelf of flat facets; MR: a faint mat.
  const facetDeg = 10;
  for (let k = 0; k < 17; k++) {
    const deg = -80 + k * facetDeg;
    const w = 2 * L.arcR * Math.tan((facetDeg / 2) * RAD) + 0.004;
    const name = `ArcFacet${String.fromCharCode(65 + k)}`;
    if (variant === "vr") g.box(name, at(L.arcR, deg, L.cardY - CARD_H / 2 - 0.012), [0.3, 0.024, w], P.shelfVr, undefined, facing(deg));
    else g.box(name, at(L.arcR, deg, L.cardY - CARD_H / 2 - 0.004), [0.3, 0.006, w], P.arcMat, undefined, facing(deg));
    g.box(`ArcEdge${String.fromCharCode(65 + k)}`, at(L.arcR - 0.152, deg, L.cardY - CARD_H / 2 - 0.006), [0.006, 0.01, w], P.edge, undefined, facing(deg));
  }
  // Later and Done at the arc's ends; their counts ride on them.
  g.node("PileLater", at(L.arcR, L.pileLaterDeg, L.cardY - CARD_H / 2 - 0.002), [[cylGeom(CARD_R + 0.012, -0.002, 0.002, 24), P.pile], [ringGeom(CARD_R + 0.008, CARD_R + 0.014, -0.0025, 0.0025, 24), P.later]], anchor("pile"));
  g.node("PileDone", at(L.arcR, L.pileDoneDeg, L.cardY - CARD_H / 2 - 0.002), [[cylGeom(CARD_R + 0.012, -0.002, 0.002, 24), P.pile], [ringGeom(CARD_R + 0.008, CARD_R + 0.014, -0.0025, 0.0025, 24), P.done]], anchor("pile"));
  // The inbox well, front and centre behind the arc: what waits for a slot stacks here.
  g.node("InboxWell", [L.well[0], L.cardY - CARD_H / 2 - 0.002, L.well[2]], [[cylGeom(CARD_R + 0.016, -0.002, 0.002, 28), P.pile], [ringGeom(CARD_R + 0.01, CARD_R + 0.018, -0.003, 0.003, 28), P.well]], anchor("inbox"));

  // --- Triage: the fan of five face-up cards (built facing the spawn, hidden until
  //     triage; the script raises each from its card's slot), the reading card, the
  //     five action pucks, and the draft with Approve, Deny and More.
  L.fanDeg.forEach((deg, i) => {
    const s = String.fromCharCode(65 + i);
    plaque(g, P, `Fan${s}`, L.fanR, deg, L.fanY, 0.62, 0.26, 2, PRESS);
    // A VIP's amber frame, just behind its card.
    g.node(`FanVip${s}`, at(L.fanR + 0.012, deg, L.fanY), [[boxGeom([0.006, 0.29, 0.65]), P.vip]], anchor("fanvip"), facing(deg));
  });
  plaque(g, P, "TxtOpen", L.readR, 0, L.readY, 1.12, 0.4, 4, anchor("text"));
  [["BtnDone", -24, P.done], ["BtnLater", -12, P.later], ["BtnReply", 0, P.action], ["BtnTask", 12, P.action], ["BtnMute", 24, P.mute]].forEach(([n, deg, m]) =>
    puck(g, n, at(1.15, deg, 0.8), m),
  );
  // A draft takes the reading card's place, front and centre, and Approve, Deny and
  // More take the action row's (review v2: the side draft ran off the comfortable band
  // and its buttons' labels ran together). Never shown at the same time as the card
  // and the five actions, so the shared spots never both take a press.
  plaque(g, P, "TxtDraft", L.readR, 0, L.readY, 1.12, 0.4, 4, anchor("text"));
  [["BtnApprove", -20, P.approve], ["BtnDeny", 0, P.deny], ["BtnMore", 20, P.action]].forEach(([n, deg, m]) => puck(g, n, at(1.15, deg, 0.8 + 0.0001), m));

  // --- Pinned tasks on the right, with a header line of counts.
  // Below the Day Ring's labels (they start 0.1 m above the ring at 1.78 m).
  plaque(g, P, "TxtTasks", 1.6, 52, 1.6, 1.0, 0.12, 1, anchor("text"));
  [["TaskA", 1.4], ["TaskB", 1.18], ["TaskC", 0.96]].forEach(([n, y]) => plaque(g, P, n, 1.6, 52, y, 0.8, 0.19, 2, PRESS));

  // --- Focus: the task and its timer, close and centred; the next event above;
  //     start or pause; and the cocoon, 16 flat facets that close in from 3 m.
  // Low enough that a seated eye still sees the banner over it (review v2, lens B, MED-3).
  plaque(g, P, "TxtFocus", 1.45, 0, 1.2, 1.1, 0.3, 3, anchor("text"), P.focusEdge);
  plaque(g, P, "TxtTimer", 1.45, 0, 0.94, 0.8, 0.13, 1, anchor("text"));
  puck(g, "BtnFocusGo", at(1.3, 26, 0.94), P.focus);
  stud(g, P, "TxtNext", at(1.4, 0, 1.72));
  for (let k = 0; k < L.cocoonFacets; k++) {
    const deg = (k * 360) / L.cocoonFacets;
    const w = 2 * L.cocoonR * Math.tan((180 / L.cocoonFacets) * RAD) + 0.01;
    g.box(`Cocoon${String.fromCharCode(65 + k)}`, at(L.cocoonFromR, deg, L.cocoonY), [0.02, 2.6, w], P.cocoon, anchor("cocoon"), facing(deg));
  }

  // --- The window, on the left: a frame, three panes (day, dusk, night) and a sill
  //     carrying the weather and one headline.
  const winDeg = -82, winR = 2.1, winY = 1.52;
  g.box("WindowFrame", at(winR + 0.02, winDeg, winY), [0.04, 0.78, 1.0], P.frame, undefined, facing(winDeg));
  g.box("PaneDay", at(winR, winDeg, winY), [0.01, 0.68, 0.9], P.paneDay, anchor("pane"), facing(winDeg));
  g.box("PaneDusk", at(winR - 0.004, winDeg, winY), [0.01, 0.68, 0.9], P.paneDusk, anchor("pane"), facing(winDeg));
  g.box("PaneNight", at(winR - 0.008, winDeg, winY), [0.01, 0.68, 0.9], P.paneNight, anchor("pane"), facing(winDeg));
  g.box("WindowBarV", at(winR - 0.014, winDeg, winY), [0.012, 0.68, 0.025], P.frame, undefined, facing(winDeg));
  g.box("WindowBarH", at(winR - 0.014, winDeg, winY), [0.012, 0.025, 0.9], P.frame, undefined, facing(winDeg));
  plaque(g, P, "TxtWindow", winR - 0.02, winDeg, 1.0, 1.0, 0.26, 3, anchor("text"));

  // --- The quiet shelf behind you, with its label above it.
  g.node("QuietShelf", [L.shelfX, 0.99, 0], [[boxGeom([0.3, 0.03, 1.4]), P.shelf], [boxGeom([0.006, 0.008, 1.4], [0.153, 0.012, 0]), P.edge]], anchor("shelf"));
  plaque(g, P, "TxtQuiet", Math.abs(L.shelfX) + 0.1, 180, 1.26, 1.0, 0.2, 2, anchor("text"));

  // --- Templates the script clones (parked under the floor, hidden at init).
  const tpl = (name, i, parts, extras = PRESS) => g.node(name, [T[0] + i * 0.3, T[1], T[2]], parts, extras);
  tpl("TplMsgGmail", 0, cardParts(P.gmail, P.card));
  tpl("TplMsgSlack", 1, cardParts(P.slack, P.card));
  tpl("TplMsgGithub", 2, cardParts(P.github, P.card));
  tpl("TplMsgLinear", 3, cardParts(P.linear, P.card));
  tpl("TplMsgVip", 4, cardParts(P.vip, P.card, 0.02));
  tpl("TplMsgRead", 5, cardParts(P.edge, P.cardRead));
  // 11 cm wide: 2.6 degrees at 2.4 m, over the research's 2.5 degree minimum target.
  const pill = (mat) => [[cylGeom(0.055, -0.085, 0.085, 24), mat]];
  tpl("TplEvent", 6, pill(P.evFuture));
  tpl("TplEventNow", 7, pill(P.evNow));
  tpl("TplEventPast", 8, pill(P.evPast));
  g.empty("spawn_point", [0, 0, 0], { spawn_point: true });
  g.box(variant === "mr" ? "VariantMr" : "VariantVr", [T[0], T[1] - 1, T[2]], [0.01, 0.01, 0.01], P.stud, anchor("variant"));
}

function vrRoom(g, P) {
  // A dark floor with a faint grid, a line every metre, and a glowing ring on the
  // floor under the Day Ring. No walls: sky "night".
  g.box("Floor", [0, -0.05, 0], [14, 0.1, 14], P.floor);
  for (let i = -7; i <= 7; i++) {
    const s = String.fromCharCode(76 + i); // E..S, never a digit
    g.box(`GridX${s}`, [i, 0.002, 0], [0.008, 0.004, 14], P.grid);
    g.box(`GridZ${s}`, [0, 0.002, i], [14, 0.004, 0.008], P.grid);
  }
  g.node("FloorRing", [0, 0.004, 0], [[ringGeom(LAYOUT.ringR - 0.01, LAYOUT.ringR + 0.01, -0.002, 0.002, 144), P.track]], { hollow: [LAYOUT.ringR - 0.01, LAYOUT.ringR + 0.01, -0.002, 0.002] });
}

function mrRoom(g, P) {
  // The real room is the room. Dark plates sit behind the text that floats.
  mrPlates(g, P);
  // The Day Ring's band: dark flat facets 0.55 m behind the ring, from -100 to
  // +100 degrees, so its labels read against a light wall. Shown while a ring label shows.
  for (let k = 0; k < 21; k++) {
    const deg = -100 + k * 10;
    const r = LAYOUT.ringR + 0.55;
    const w = 2 * r * Math.tan(5 * RAD) + 0.006;
    g.box(`RingBand${String.fromCharCode(65 + k)}`, at(r, deg, 2.08), [0.01, 0.95, w], P.band, anchor("band"), facing(deg));
  }
}

/**
 * MR only: dark plates behind the floating text groups (plaque text needs
 * none: its card is its plate). Each plate sits 0.5 m beyond its text along the
 * line from the spawn and is sized to frame the text from any eye height from
 * seated (EYE_LOW) to standing (EYE_HIGH). The script shows a plate only while
 * its text shows (PLATES in script/src/lib.rs). Every plate is farther from the
 * spawn than anything pressable in its direction, so it never blocks a press.
 */
export const PLATES = [
  // name, text centre (glTF), text width x height (m)
  ["PlateModes", [...at(1.45, -60, 1.42)], [0.9, 1.25]],
  ["PlateActions", [...at(1.15, 0, 0.87)], [1.3, 0.12]],
  ["PlateInbox", [LAYOUT.well[0], 0.92, LAYOUT.well[2]], [0.5, 0.28]],
  ["PlateLater", [...at(1.0, LAYOUT.pileLaterDeg, 0.88)], [0.42, 0.12]],
  ["PlateDone", [...at(1.0, LAYOUT.pileDoneDeg, 0.88)], [0.42, 0.12]],
  ["PlateStageBtn", [...at(1.6, 25, 1.12)], [0.42, 0.12]],
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
  const P = palette(g);
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
