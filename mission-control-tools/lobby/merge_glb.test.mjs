// merge_glb.test.mjs -- crafted-input tests for merge_glb.mjs.
//
// @kosmos-system WorldPublisher-content (integration packaging)
// @kosmos-owner  Content lane
//   node mission-control-tools/lobby/merge_glb.test.mjs
//
// Builds a small synthetic Lobby with non-zero counts (2 nodes, 2 meshes, 2 accessors, 3 buffer
// views, 2 materials, 1 image, 1 texture, 1 sampler), then crafted orbs, and runs merge_glb.mjs
// on each in a temporary folder. Every orb that carries an index the merger would copy un-offset
// must be REFUSED (non-zero exit, a clear message, no output written); the clean orbs must merge
// with every index offset past the Lobby's. Exits non-zero if any case goes the wrong way.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const merger = path.join(here, 'merge_glb.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-glb-test-'));

/** A GLB from a glTF JSON object and a BIN payload. */
function glb(json, bin) {
  let js = Buffer.from(JSON.stringify(json), 'utf8');
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const b = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const h = Buffer.alloc(12); h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(28 + js.length + b.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(b.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([h, jh, js, bh, b]);
}
function readJson(p) {
  const b = fs.readFileSync(p);
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
}

// A triangle: positions (36 B) and indices (6 B, padded to 8), plus a 4-byte "image".
function triangleBin() {
  const pos = Buffer.alloc(36);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, i) => pos.writeFloatLE(v, i * 4));
  const idx = Buffer.alloc(8);
  [0, 1, 2].forEach((v, i) => idx.writeUInt16LE(v, i * 2));
  return Buffer.concat([pos, idx, Buffer.from([0x89, 0x50, 0x4e, 0x47])]);
}
function baseDoc(names) {
  return {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: names.map((_, i) => i) }],
    nodes: names.map((n, i) => ({ name: n, mesh: i })),
    meshes: names.map((n, i) => ({ name: n + 'Mesh', primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: i % 2 }] })),
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 6 }, { buffer: 0, byteOffset: 44, byteLength: 4 }],
    buffers: [{ byteLength: 48 }],
    materials: [{ name: names[0] + 'Mat' }, { name: names[0] + 'Mat2', emissiveTexture: { index: 0 } }],
    images: [{ bufferView: 2, mimeType: 'image/png', name: names[0] + 'Img' }],
    samplers: [{ magFilter: 9729 }],
    textures: [{ source: 0, sampler: 0 }],
  };
}

const lobbyPath = path.join(dir, 'lobby.glb');
fs.writeFileSync(lobbyPath, glb(baseDoc(['LobbyA', 'LobbyB']), triangleBin()));

/** Runs the merger on an orb document; returns { ok, message, out }. */
function merge(name, doc) {
  const orb = path.join(dir, name + '.glb');
  const out = path.join(dir, name + '.out.glb');
  fs.writeFileSync(orb, glb(doc, triangleBin()));
  try {
    execFileSync(process.execPath, [merger, lobbyPath, orb, out, path.join(dir, name + '.json')], { stdio: 'pipe' });
    return { ok: true, out };
  } catch (e) {
    const line = String(e.stderr).split('\n').find((l) => l.includes('Error:')) || String(e.stderr).trim();
    return { ok: false, message: line, wrote: fs.existsSync(out) };
  }
}
function orb(edit) {
  const d = baseDoc(['OrbA', 'OrbB']);
  edit(d);
  return d;
}

let failed = 0;
function expectRefused(name, doc, needle) {
  const r = merge(name, doc);
  const good = !r.ok && r.message.includes(needle) && !r.wrote;
  console.log(`${good ? 'ok  ' : 'FAIL'} refused: ${name}${r.ok ? ' (merged!)' : ` -- ${r.message.trim()}`}`);
  if (!good) failed++;
}
function expectMerged(name, doc, check) {
  const r = merge(name, doc);
  let good = r.ok;
  let why = r.ok ? '' : ` -- ${r.message}`;
  if (good) {
    try { check(readJson(r.out)); } catch (e) { good = false; why = ` -- ${e.message}`; }
  }
  console.log(`${good ? 'ok  ' : 'FAIL'} merged: ${name}${why}`);
  if (!good) failed++;
}
const must = (cond, what) => { if (!cond) throw new Error(what); };

// --- refused: an index the merger would copy un-offset ---
expectRefused('texture-basisu-source', orb((d) => { d.textures[0].extensions = { KHR_texture_basisu: { source: 0 } }; }), 'source index inside the extension KHR_texture_basisu');
expectRefused('texture-webp-source', orb((d) => { d.textures[0].extensions = { EXT_texture_webp: { source: 0 } }; }), 'EXT_texture_webp');
expectRefused('texture-avif-source', orb((d) => { d.textures[0].extensions = { EXT_texture_avif: { source: 0 } }; }), 'EXT_texture_avif');
expectRefused('image-extension-source', orb((d) => { d.images[0].extensions = { X_any: { source: 0 } }; }), 'X_any');
expectRefused('material-extension-index', orb((d) => { d.materials[0].extensions = { KHR_materials_transmission: { transmissionTexture: { index: 0 } } }; }), 'texture inside an extension');
expectRefused('node-gpu-instancing', orb((d) => { d.nodes[0].extensions = { EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: 0, ROTATION: 0, SCALE: 0 } } }; }), 'nodes[0].extensions (EXT_mesh_gpu_instancing)');
expectRefused('primitive-draco', orb((d) => { d.meshes[0].primitives[0].extensions = { KHR_draco_mesh_compression: { bufferView: 0, attributes: { POSITION: 0 } } }; }), 'primitives[0].extensions (KHR_draco_mesh_compression)');
expectRefused('primitive-variants', orb((d) => { d.meshes[0].primitives[0].extensions = { KHR_materials_variants: { mappings: [{ material: 0, variants: [0] }] } }; }), 'KHR_materials_variants');
expectRefused('mesh-extension', orb((d) => { d.meshes[1].extensions = { X_mesh: { accessor: 0 } }; }), 'meshes[1].extensions');
expectRefused('accessor-extension', orb((d) => { d.accessors[0].extensions = { X_acc: { bufferView: 0 } }; }), 'accessors[0].extensions');
expectRefused('bufferview-extension', orb((d) => { d.bufferViews[0].extensions = { EXT_meshopt_compression: { buffer: 0 } }; }), 'bufferViews[0].extensions');
expectRefused('root-extension', orb((d) => { d.extensions = { KHR_lights_punctual: { lights: [{ type: 'point' }] } }; }), 'at extensions (KHR_lights_punctual)');
expectRefused('scene-extension', orb((d) => { d.scenes[0].extensions = { X_scene: { node: 0 } }; }), 'scenes[0].extensions');
expectRefused('extensions-required', orb((d) => { d.extensionsRequired = ['KHR_draco_mesh_compression']; }), 'requires extensions');
expectRefused('image-by-uri', orb((d) => { d.images[0] = { uri: '../../../../etc/passwd' }; }), 'not embedded');
expectRefused('name-collision', orb((d) => { d.nodes[0].name = 'LobbyA'; }), 'merge check failed');

// --- merged: everything offset past the Lobby ---
expectMerged('clean', orb(() => {}), (g) => {
  must(g.nodes.length === 4 && g.nodes[2].name === 'OrbA' && g.nodes[2].mesh === 2, 'node and mesh offset');
  must(g.meshes[2].primitives[0].attributes.POSITION === 2 && g.meshes[2].primitives[0].indices === 3, 'accessor offset');
  must(g.meshes[3].primitives[0].material === 3, 'material offset');
  must(g.accessors[2].bufferView === 3, 'bufferView offset');
  must(g.images[1].bufferView === 5, 'image bufferView offset');
  must(g.textures[1].source === 1 && g.textures[1].sampler === 1, 'texture source and sampler offset');
  must(g.materials[3].emissiveTexture.index === 1, 'material texture index offset');
  must(JSON.stringify(g.scenes[0].nodes) === '[0,1,2,3]', 'roots appended');
});
expectMerged('texture-transform-on-material', orb((d) => {
  d.materials[1].emissiveTexture.extensions = { KHR_texture_transform: { scale: [2, 2] } };
  d.extensionsUsed = ['KHR_texture_transform'];
}), (g) => {
  must(g.materials[3].emissiveTexture.index === 1, 'texture index still offset');
  must(g.materials[3].emissiveTexture.extensions.KHR_texture_transform.scale[0] === 2, 'transform kept');
  must((g.extensionsUsed || []).includes('KHR_texture_transform'), 'extensionsUsed united');
});
expectMerged('texture-extension-without-source', orb((d) => { d.textures[0].extensions = { X_hint: { quality: 1 } }; }), (g) => {
  must(g.textures[1].source === 1, 'source offset');
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(failed ? `${failed} case(s) went the wrong way` : 'all merge_glb cases pass');
process.exit(failed ? 1 : 0);
