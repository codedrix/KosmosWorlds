// make_desk_glb.test.mjs -- checks mission-control/desk_assembly.glb against nodes.json and src/lib.rs.
//
// @kosmos-system Content (KosmosWorlds) -- the Kosmos Desk board in the Lobby
// @kosmos-owner  Content lane
//   node mission-control-tools/lobby/make_desk_glb.test.mjs
//
// The committed GLB is what make_desk_glb.mjs builds (byte for byte, twice); it carries exactly the
// nodes.json desk nodes, each a mesh with the script_node extra and no trailing _<digit>; every
// node's local +Z is lib.rs DESK_RIGHT (the direction the world shifts a card along) and its local
// +X points away from the owner's eye; the anchors are 3 cm x 3 cm x 2 mm plaques in front of the
// panel, on its face, with room for a full 1.5 m line plus the largest shift lib.rs allows inside
// the board's width only after the left-alignment offset. Exits non-zero on any failure.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, STAND, PARK_DROP_M, PANEL, ANCHOR_FRONT } from './make_desk_glb.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const nodesJson = JSON.parse(fs.readFileSync(path.join(repo, 'mission-control', 'nodes.json'), 'utf8'));
const lib = fs.readFileSync(path.join(repo, 'mission-control', 'src', 'lib.rs'), 'utf8');
const committed = fs.readFileSync(path.join(repo, 'mission-control', 'desk_assembly.glb'));

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
const near = (a, b, eps = 1e-4) => Math.abs(a - b) <= eps;

function parse(buf) {
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
}
/** Rotates v by the unit quaternion q = [x, y, z, w]. */
function qrot([x, y, z, w], v) {
  const t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
  return [v[0] + w * t[0] + (y * t[2] - z * t[1]), v[1] + w * t[1] + (z * t[0] - x * t[2]), v[2] + w * t[2] + (x * t[1] - y * t[0])];
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => a.map((v, i) => v - b[i]);
const num = (re) => { const m = lib.match(re); if (!m) throw new Error(`lib.rs: ${re} not found`); return m; };

// 1. Deterministic and current.
const a = build(), b = build();
check(a.equals(b), 'two builds are byte-identical');
check(a.equals(committed), 'the committed desk_assembly.glb is what make_desk_glb.mjs builds');

const gl = parse(committed);
const byName = Object.fromEntries(gl.nodes.map((n) => [n.name, n]));

// 2. Exactly the nodes.json desk nodes, each a mesh the optimizer keeps, with a device-safe name.
const want = [...nodesJson.desk_text, ...nodesJson.desk_world].sort();
check(JSON.stringify(gl.nodes.map((n) => n.name).sort()) === JSON.stringify(want), `nodes are exactly nodes.json desk_text + desk_world (${want.length})`);
for (const n of gl.nodes) {
  check(Number.isInteger(n.mesh) && n.extras?.script_node === true, `${n.name}: a mesh with extras.script_node`);
  check(!/_\d+$/.test(n.name), `${n.name}: no trailing _<digit>`);
  check(n.translation[1] < -PARK_DROP_M + 10, `${n.name}: authored parked (y ${n.translation[1].toFixed(3)})`);
}
check(gl.nodes.every((n) => !n.children && gl.scenes[0].nodes.includes(gl.nodes.indexOf(n))), 'every node is a scene root (merge_glb appends roots)');

// 3. Orientation: local +Z is lib.rs DESK_RIGHT; local +X points away from the eye.
const m = num(/const DESK_RIGHT: \[f32; 3\] = \[([-\d._]+), ([-\d._]+), ([-\d._]+)\];/);
const deskRight = [1, 2, 3].map((i) => Number(m[i].replace(/_/g, '')));
const eye = [STAND.x, STAND.seat + 1.6 - PARK_DROP_M, 0];
for (const n of gl.nodes) {
  const z = qrot(n.rotation, [0, 0, 1]);
  check(deskRight.every((v, i) => near(v, z[i])), `${n.name}: local +Z ${z.map((v) => v.toFixed(5))} = DESK_RIGHT`);
  check(dot(qrot(n.rotation, [1, 0, 0]), sub(n.translation, eye)) > 0, `${n.name}: local +X points away from the eye`);
}

// 4. Where it stands: 2.5 m out at 72 degrees to the owner's left, panel z 0.95..2.28 above the seat.
const board = byName.McDeskBoard;
const vx = STAND.x - board.translation[0], vy = board.translation[2], vz = board.translation[1] + PARK_DROP_M - STAND.seat;
check(near(Math.hypot(vx, vy), 2.5, 1e-3) && near((Math.atan2(vy, vx) * 180) / Math.PI, 72, 0.01), `the board stands 2.5 m out at 72 degrees (vx ${vx.toFixed(3)}, vy ${vy.toFixed(3)})`);
check(near(vz - PANEL.h / 2, 0.95, 1e-3) && near(vz + PANEL.h / 2, 2.28, 1e-3), `the panel spans z ${(vz - PANEL.h / 2).toFixed(3)}..${(vz + PANEL.h / 2).toFixed(3)}`);

// 5. Plaques: thin along local X, 3 cm square, in front of the panel and on its face.
const meshBounds = (n) => {
  const mins = [Infinity, Infinity, Infinity], maxs = [-Infinity, -Infinity, -Infinity];
  for (const p of gl.meshes[n.mesh].primitives) {
    const acc = gl.accessors[p.attributes.POSITION];
    acc.min.forEach((v, i) => { mins[i] = Math.min(mins[i], v); });
    acc.max.forEach((v, i) => { maxs[i] = Math.max(maxs[i], v); });
  }
  return { mins, maxs };
};
const layoutTs = fs.readFileSync(path.join(repo, 'agent-bridge', 'src', 'faces', 'desk', 'layout.ts'), 'utf8');
const W = Number((layoutTs.match(/line:\s*([\d.]+)/) ?? [])[1]);
const shiftMax = Number(num(/const DESK_SHIFT_MAX_M: f32 = ([\d.]+);/)[1]);
check(W > 0 && W <= PANEL.w - 0.1, `the bridge's line width ${W} m fits the ${PANEL.w} m board with margin`);
check(shiftMax >= W / 2 && shiftMax <= PANEL.w / 2, `lib.rs DESK_SHIFT_MAX_M ${shiftMax} covers a left-aligned short line (W/2 = ${W / 2}) and stays on the board`);
for (const name of nodesJson.desk_text) {
  const n = byName[name];
  const { mins, maxs } = meshBounds(n);
  const size = maxs.map((v, i) => v - mins[i]);
  check(near(size[0], 0.002, 1e-6) && near(size[1], 0.03, 1e-6) && near(size[2], 0.03, 1e-6), `${name}: a 2 mm x 3 cm x 3 cm plaque`);
  // The anchor in the board's local frame.
  const d = sub(n.translation, board.translation);
  const lx = dot(d, qrot(board.rotation, [1, 0, 0])), ly = dot(d, qrot(board.rotation, [0, 1, 0])), lz = dot(d, qrot(board.rotation, [0, 0, 1]));
  check(near(lx, -(PANEL.t / 2 + ANCHOR_FRONT), 1e-4), `${name}: ${(-lx * 100).toFixed(1)} cm toward the eye from the board centre`);
  check(near(lz, 0, 1e-4) && ly > -PANEL.h / 2 && ly + 0.1 < PANEL.h / 2, `${name}: on the board's face (local y ${ly.toFixed(3)})`);
}
const heads = nodesJson.desk_text.map((nm) => byName[nm].translation[1]);
check(heads.every((y, i) => i === 0 || y < heads[i - 1]), 'heading on top, then cards A..H downward');
check(heads.slice(1).every((y, i) => i === 0 || near(heads[i] - y, 0.115, 1e-4)), 'cards are 11.5 cm apart (a line of 8 cm text plus a gap)');

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
