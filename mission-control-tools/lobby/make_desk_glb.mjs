// make_desk_glb.mjs -- builds mission-control/desk_assembly.glb: the Kosmos Desk board's nodes, parked.
//
// @kosmos-system Content (KosmosWorlds) -- the Kosmos Desk board in the Lobby
// @kosmos-owner  Content lane
//
//   node mission-control-tools/lobby/make_desk_glb.mjs [--check]
//
// The board is a separate panel to the owner's LEFT: 2.5 m out at 72 degrees (where the throne's
// left side is open dais for about 4 m, measured from the live 1.1.1 scene), facing the eye.
// 1.66 m x 1.33 m, z 0.95 to 2.28 above the seat (the eye is at 1.60), so from the eye it spans
// azimuth 54 to 90 degrees and elevation -15 to +15, above the decision puck's plate (whose top
// is about -20 degrees from the eye) and clear of every Mission Control panel, which never shows
// with it anyway (the world hides the board whenever the arc is open or moving).
//
// Nodes (mission-control/nodes.json `desk_text`, `desk_world`):
//   McDeskBoard        one opaque panel (the chrome bar's smoke, opaque: never a third translucent
//                      layer) with cyan light bars top and bottom and a hairline under the heading;
//   TxDeskHead         the heading's anchor (two lines, centred);
//   TxDeskA..TxDeskH   one card a line, 11.5 cm apart; the bridge shifts each along the board
//                      (`O`) so it reads left-aligned.
// Every anchor is a 3 cm x 3 cm x 2 mm plaque, 4 cm in front of the panel, its rotation on the
// node and never baked (the client prints flat only on a thin anchor, judged in local bounds).
// Every node is a mesh (k_node_find sees meshes only on device) with the `script_node` extra (the
// publisher's merge and prune keep it), authored 200 m below the floor like Mission Control's.
//
// Coordinates: the viewer frame (feet on the seat, +X ahead, +Y the owner's left, Z up) maps to
// glTF as (14.8 - x, 1.46 + z, y); the program moves nodes in those glTF axes. The board's yaw is
// -108 degrees about +Y, so its local +X points away from the eye (as every Mission Control plaque
// does) and its local +Z is the board's right as the owner sees it: src/lib.rs DESK_RIGHT, which
// make_desk_glb.test.mjs checks against this file.
//
// The output is deterministic: --check rebuilds in memory and exits 1 if the committed GLB differs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const OUT = path.join(repo, 'mission-control', 'desk_assembly.glb');
const NODES = JSON.parse(fs.readFileSync(path.join(repo, 'mission-control', 'nodes.json'), 'utf8'));

export const STAND = { x: 14.8, seat: 1.46 };
export const PARK_DROP_M = 200;
export const AZIMUTH_DEG = 72;
export const DISTANCE_M = 2.5;
export const YAW_DEG = -(180 - AZIMUTH_DEG); // -108
export const PANEL = { w: 1.66, h: 1.33, t: 0.02, zMid: 1.615 };
export const HEAD_Z = 2.03;
export const CARD_TOP_Z = 1.855;
export const CARD_STEP = 0.115;
export const ANCHOR_FRONT = 0.04;

const rad = (d) => (d * Math.PI) / 180;
const yaw = rad(YAW_DEG);
const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
/** R_y(yaw) applied to a local vector. */
const rot = ([x, y, z]) => [x * c + z * s, y, -x * s + z * c];
const r6 = (v) => Math.round(v * 1e6) / 1e6;

/** The board's centre in glTF (parked), from the viewer frame. */
function viewerToGltf(vx, vy, vz) {
  return [STAND.x - vx, STAND.seat + vz - PARK_DROP_M, vy];
}
const centre = viewerToGltf(DISTANCE_M * Math.cos(rad(AZIMUTH_DEG)), DISTANCE_M * Math.sin(rad(AZIMUTH_DEG)), PANEL.zMid);
const QUAT = [0, r6(Math.sin(yaw / 2)), 0, r6(Math.cos(yaw / 2))];

/** A box from local min/max: 24 vertices with flat normals, 36 indices. */
function box(min, max) {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  const faces = [
    [[1, 0, 0], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]],
    [[-1, 0, 0], [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]]],
    [[0, 1, 0], [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]]],
    [[0, -1, 0], [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]]],
    [[0, 0, 1], [[x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1]]],
    [[0, 0, -1], [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]]],
  ];
  const pos = [], nor = [], idx = [];
  for (const [n, quad] of faces) {
    const b = pos.length / 3;
    for (const p of quad) { pos.push(...p); nor.push(...n); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return { pos, nor, idx };
}

const MATERIALS = [
  { name: 'deskSmoke', pbrMetallicRoughness: { baseColorFactor: [0.01, 0.02, 0.045, 1], metallicFactor: 0, roughnessFactor: 0.6 } },
  { name: 'deskCyanLine', doubleSided: true, emissiveFactor: [0.11443537473678589, 0.7912979125976562, 1], pbrMetallicRoughness: { baseColorFactor: [0.11443537473678589, 0.7912979125976562, 1, 1], metallicFactor: 0, roughnessFactor: 0.6 } },
  { name: 'deskHairline', doubleSided: true, emissiveFactor: [0.013702083379030228, 0.2746773064136505, 0.366252601146698], pbrMetallicRoughness: { baseColorFactor: [0.013702083379030228, 0.2746773064136505, 0.366252601146698, 1], metallicFactor: 0, roughnessFactor: 0.6 } },
  { name: 'deskStud', pbrMetallicRoughness: { baseColorFactor: [0.02, 0.03, 0.05, 1], metallicFactor: 0, roughnessFactor: 0.6 } },
];
const MAT = Object.fromEntries(MATERIALS.map((m, i) => [m.name, i]));

export function build() {
  const hw = PANEL.w / 2, hh = PANEL.h / 2, ht = PANEL.t / 2;
  const front = -ht; // the face toward the eye (local -X)
  const head = HEAD_Z - PANEL.zMid;
  const parts = {
    McDeskBoard: [
      [MAT.deskSmoke, box([-ht, -hh, -hw], [ht, hh, hw])],
      [MAT.deskCyanLine, box([front - 0.012, hh - 0.016, -hw], [front, hh, hw])],
      [MAT.deskCyanLine, box([front - 0.012, -hh, -hw], [front, -hh + 0.016, hw])],
      [MAT.deskHairline, box([front - 0.004, head - 0.035, -hw + 0.07], [front, head - 0.031, hw - 0.07])],
    ],
  };
  const anchors = { TxDeskHead: HEAD_Z };
  'ABCDEFGH'.split('').forEach((k, i) => { anchors[`TxDesk${k}`] = CARD_TOP_Z - i * CARD_STEP; });

  const want = [...NODES.desk_text, ...NODES.desk_world];
  const names = [...Object.keys(anchors), ...Object.keys(parts)];
  if (JSON.stringify([...want].sort()) !== JSON.stringify([...names].sort())) throw new Error(`nodes.json desk nodes ${want} != built ${names}`);

  const chunks = [], bufferViews = [], accessors = [], meshes = [], nodes = [];
  let byteLength = 0;
  const push = (arr, type, target, comp, count, extra = {}) => {
    const b = type === 'f32' ? Buffer.from(new Float32Array(arr).buffer) : Buffer.from(new Uint16Array(arr).buffer);
    const pad = (4 - (b.length % 4)) % 4;
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: b.length, target });
    chunks.push(b, Buffer.alloc(pad));
    byteLength += b.length + pad;
    accessors.push({ bufferView: bufferViews.length - 1, componentType: comp, count, type: type === 'f32' ? 'VEC3' : 'SCALAR', ...extra });
    return accessors.length - 1;
  };
  const prim = (mat, g) => {
    const min = [0, 1, 2].map((k) => Math.min(...g.pos.filter((_, i) => i % 3 === k)));
    const max = [0, 1, 2].map((k) => Math.max(...g.pos.filter((_, i) => i % 3 === k)));
    const POSITION = push(g.pos, 'f32', 34962, 5126, g.pos.length / 3, { min, max });
    const NORMAL = push(g.nor, 'f32', 34962, 5126, g.nor.length / 3);
    const indices = push(g.idx, 'u16', 34963, 5123, g.idx.length);
    return { attributes: { POSITION, NORMAL }, indices, material: mat };
  };
  for (const name of names) {
    const p = parts[name] ?? [[MAT.deskStud, box([-0.001, -0.015, -0.015], [0.001, 0.015, 0.015])]];
    meshes.push({ name, primitives: p.map(([m, g]) => prim(m, g)) });
    const local = parts[name] ? [0, 0, 0] : [-ht - ANCHOR_FRONT, anchors[name] - PANEL.zMid, 0];
    const off = rot(local);
    nodes.push({ name, mesh: meshes.length - 1, translation: centre.map((v, k) => r6(v + off[k])), rotation: QUAT, extras: { script_node: true } });
  }
  const json = { asset: { version: '2.0', generator: 'KosmosWorlds make_desk_glb.mjs' }, scene: 0, scenes: [{ name: 'Scene', nodes: nodes.map((_, i) => i) }],
    nodes, meshes, materials: MATERIALS, accessors, bufferViews, buffers: [{ byteLength }] };
  const bin = Buffer.concat(chunks);
  let js = Buffer.from(JSON.stringify(json), 'utf8');
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const h = Buffer.alloc(12); h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(28 + js.length + bin.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([h, jh, js, bh, bin]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = build();
  if (process.argv.includes('--check')) {
    const same = fs.existsSync(OUT) && fs.readFileSync(OUT).equals(out);
    console.log(same ? `desk_assembly.glb is current (${out.length} B)` : 'desk_assembly.glb is NOT what make_desk_glb.mjs builds');
    process.exit(same ? 0 : 1);
  }
  fs.writeFileSync(OUT, out);
  console.log(`wrote ${OUT}: ${out.length} B`);
}
