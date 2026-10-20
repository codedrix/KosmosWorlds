// merge_glb.mjs — append a small GLB (a door) to a COPY of the Lobby GLB, changing no original byte.
//
// @kosmos-system WorldPublisher-content (integration packaging)
// @kosmos-owner Content lane (copied unchanged in logic from the Omni Demo lane's merge_orb.mjs, 2026-10-14)
//   node merge_glb.mjs <lobby.glb> <door.glb> <out.glb> <report.json>
//
// Guarantees, each checked before writing and recorded in the report:
//   * the Lobby BIN chunk is a byte-identical prefix of the output BIN;
//   * every original node, mesh, accessor, bufferView, material, texture, image, sampler, animation,
//     skin and the scene's other properties are JSON-identical at the same index;
//   * the orb's nodes/meshes/accessors/bufferViews/materials are appended (indices offset), and its
//     root nodes are appended to the default scene's root list only;
//   * the orb's embedded images (bufferView PNG/JPEG), samplers and textures are appended too, with
//     their bufferView/source/sampler indices offset and every material texture reference
//     (baseColor, metallicRoughness, normal, occlusion, emissive) offset by the texture count
//     (Mission Control v2's art pass carries three small textures); an image by URI is refused;
//   * extensionsUsed is the union of both files; the orb may not require an extension;
//   * the orb file carries no animations or skins (asserted).
import fs from 'node:fs';
import crypto from 'node:crypto';

const [, , lobbyPath, orbPath, outPath, reportPath] = process.argv;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const pad4 = (n) => (n + 3) & ~3;
function readGlb(p) {
  const b = fs.readFileSync(p);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${p}: not a GLB`);
  const jl = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jl).toString('utf8'));
  const bh = 20 + jl;
  if (b.readUInt32LE(bh + 4) !== 0x004e4942) throw new Error(`${p}: second chunk is not BIN`);
  return { raw: b, json, bin: b.subarray(bh + 8, bh + 8 + b.readUInt32LE(bh)) };
}
const L = readGlb(lobbyPath), O = readGlb(orbPath);
const G = structuredClone(L.json), S = O.json;
for (const k of ['animations', 'skins']) if (S[k]?.length) throw new Error(`orb has ${k}`);
if (S.extensionsRequired?.length) throw new Error('orb requires extensions: ' + S.extensionsRequired.join(','));
for (const im of S.images || []) if (im.bufferView === undefined || im.uri !== undefined) throw new Error('orb image is not embedded: ' + (im.name || '?'));
// A source index inside an extension (KHR_texture_basisu, EXT_texture_webp, EXT_texture_avif...) would be
// copied un-offset and point at a Lobby image: refused (security review 4, LOW-1).
for (const t of [...(S.textures || []), ...(S.images || [])]) for (const [k, v] of Object.entries(t.extensions || {}))
  if (v && typeof v === 'object' && 'source' in v) throw new Error('orb texture or image has a source index inside the extension ' + k + '; merge_glb does not remap extension indices');
if (G.buffers.length !== 1 || S.buffers.length !== 1) throw new Error('expected one buffer each');

const base = pad4(L.bin.length);
const off = { node: G.nodes.length, mesh: G.meshes.length, acc: G.accessors.length, bv: G.bufferViews.length, mat: G.materials.length,
  img: (G.images || []).length, smp: (G.samplers || []).length, tex: (G.textures || []).length };
const TEX_SLOTS = [['pbrMetallicRoughness', 'baseColorTexture'], ['pbrMetallicRoughness', 'metallicRoughnessTexture'],
  [null, 'normalTexture'], [null, 'occlusionTexture'], [null, 'emissiveTexture']];
function offsetMaterial(m) {
  const c = structuredClone(m);
  for (const [outer, slot] of TEX_SLOTS) {
    const holder = outer ? c[outer] : c;
    if (holder && holder[slot]) holder[slot].index += off.tex;
  }
  const left = JSON.stringify(c.extensions || {});
  if (/"index"/.test(left)) throw new Error('orb material has a texture inside an extension: ' + c.name);
  return c;
}
for (const bv of S.bufferViews) G.bufferViews.push({ ...bv, buffer: 0, byteOffset: base + (bv.byteOffset || 0) });
for (const a of S.accessors) G.accessors.push({ ...a, bufferView: a.bufferView + off.bv });
for (const m of S.materials) G.materials.push(offsetMaterial(m));
if (S.images?.length) { G.images ||= []; for (const im of S.images) G.images.push({ ...im, bufferView: im.bufferView + off.bv }); }
if (S.samplers?.length) { G.samplers ||= []; for (const sm of S.samplers) G.samplers.push({ ...sm }); }
if (S.textures?.length) { G.textures ||= []; for (const t of S.textures) G.textures.push({ ...t,
  source: t.source === undefined ? undefined : t.source + off.img, sampler: t.sampler === undefined ? undefined : t.sampler + off.smp }); }
if (S.extensionsUsed?.length) G.extensionsUsed = [...new Set([...(G.extensionsUsed || []), ...S.extensionsUsed])];
for (const me of S.meshes) G.meshes.push({ ...me, primitives: me.primitives.map((p) => ({
  ...p, indices: p.indices + off.acc, material: p.material === undefined ? undefined : p.material + off.mat,
  attributes: Object.fromEntries(Object.entries(p.attributes).map(([k, v]) => [k, v + off.acc])) })) });
for (const n of S.nodes) G.nodes.push({ ...n, mesh: n.mesh === undefined ? undefined : n.mesh + off.mesh,
  children: n.children ? n.children.map((c) => c + off.node) : undefined });
const orbRoots = S.scenes[S.scene || 0].nodes.map((i) => i + off.node);
G.scenes[G.scene || 0].nodes.push(...orbRoots);
const bin = Buffer.concat([L.bin, Buffer.alloc(base - L.bin.length), O.bin, Buffer.alloc(pad4(O.bin.length) - O.bin.length)]);
G.buffers[0].byteLength = bin.length;

// checks
const checks = {};
checks.binPrefixIdentical = bin.subarray(0, L.bin.length).equals(L.bin);
for (const k of ['nodes', 'meshes', 'accessors', 'bufferViews', 'materials', 'textures', 'images', 'samplers', 'animations', 'skins']) {
  const a = L.json[k] || [], b = (G[k] || []).slice(0, a.length);
  checks[`${k}OriginalsIdentical`] = JSON.stringify(a) === JSON.stringify(b);
}
const sc0 = { ...L.json.scenes[L.json.scene || 0] }, sc1 = { ...G.scenes[G.scene || 0] };
checks.sceneOriginalRootsKept = JSON.stringify(sc0.nodes) === JSON.stringify(sc1.nodes.slice(0, sc0.nodes.length));
delete sc0.nodes; delete sc1.nodes; checks.sceneOtherPropsIdentical = JSON.stringify(sc0) === JSON.stringify(sc1);
const names = G.nodes.map((n) => n.name);
checks.extensionsRequiredUnchanged = JSON.stringify(L.json.extensionsRequired || null) === JSON.stringify(G.extensionsRequired || null);
checks.lobbyExtensionsUsedKept = (L.json.extensionsUsed || []).every((e) => (G.extensionsUsed || []).includes(e));
checks.orbTextureRefsInRange = G.materials.slice(off.mat).every((m) => TEX_SLOTS.every(([o, sl]) => {
  const h = o ? m[o] : m; return !h || !h[sl] || (h[sl].index >= off.tex && h[sl].index < (G.textures || []).length); }));
checks.orbNamesUnique = S.nodes.every((n) => names.filter((x) => x === n.name).length === 1);
if (!Object.values(checks).every(Boolean)) throw new Error('merge check failed: ' + JSON.stringify(checks));

let js = Buffer.from(JSON.stringify(G), 'utf8');
js = Buffer.concat([js, Buffer.alloc(pad4(js.length) - js.length, 0x20)]);
const h = Buffer.alloc(12); h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
const out = Buffer.concat([h, jh, js, bh, bin]);
fs.writeFileSync(outPath, out);
const report = { lobby: { path: lobbyPath, sha256: sha(L.raw), bytes: L.raw.length }, orb: { path: orbPath, sha256: sha(O.raw) },
  output: { path: outPath, sha256: sha(out), bytes: out.length }, appended: { nodes: S.nodes.map((n) => n.name), roots: orbRoots, images: (S.images || []).map((i) => i.name), textures: (S.textures || []).length },
  checks };
fs.writeFileSync(reportPath, JSON.stringify(report, null, 1));
console.log(`merged: ${outPath} ${out.length} B; checks ${Object.keys(checks).length}/${Object.keys(checks).length} passed`);
