#!/usr/bin/env node
/**
 * scenario.mjs -- Visual Pack Check (VR and MR) against the mock host: every page,
 * every button, the hover cases and the cancelled travel, with every return code
 * the world shows checked against what the client's contract says it must be.
 *
 * @kosmos-system  Content (KosmosWorlds) -- Visual Pack Check
 * @kosmos-owner   KOS-699 (builder vp-w1)
 *
 * Usage (from the repo root):
 *   node visual-pack-check/tools/scenario.mjs [--vr <dir>] [--mr <dir>] [--snapshots <out dir>]
 *
 * --vr / --mr name a folder holding world.glb, world.wasm, manifest.json (and media/):
 * by default the source folders world-vr/ and world-mr/; pass the folders
 * unpack_bundle.mjs wrote to check what the publisher's optimizer actually ships.
 * --snapshots writes one state file per page for render_review.py.
 *
 * tools/mock-host.mjs is a model of the client (a1936d8), not the client. It does not
 * render, so the look (K1, K3, K4, the plate on the Adreno) is the device's to judge.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Host } from "./mock-host.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const VR = arg("--vr", path.join(ROOT, "world-vr"));
const MR = arg("--mr", path.join(ROOT, "world-mr"));
const SNAP = arg("--snapshots", null);
if (SNAP) fs.mkdirSync(SNAP, { recursive: true });

let failures = 0;
const ok = (cond, msg) => {
  if (!cond) {
    failures++;
    console.error(`  FAIL ${msg}`);
  } else console.log(`  ok   ${msg}`);
};
// 1.0.1: a plaque's text is on its anchor, "<plaque>Text" (build_glb.mjs plaque()); any other node carries its own.
const txt = (h, node) => (h.byName.has(node + "Text") ? h.textOf(node + "Text") : h.textOf(node));
const has = (h, node, s) => ok((txt(h, node) ?? "").includes(s), `${node} shows ${JSON.stringify(s)}  [${JSON.stringify(txt(h, node))}]`);
const snap = (h, name) => SNAP && fs.writeFileSync(path.join(SNAP, `${name}.json`), JSON.stringify(h.scene(), null, 1));

/**
 * 1.0.1: the outline fits the plaque. For every plaque with a text anchor in the
 * GLB this run loads: the plaque's mesh reaches no lower, higher or wider than its
 * body (primitive 0; no keel), the anchor sits at the plaque's own place and turn,
 * and the anchor's box lies wholly inside the body, behind its front face.
 * Positions are read in each mesh's local frame, dequantised when the optimizer
 * stored them as normalised integers.
 */
function checkAnchors(glbPath, want) {
  const b = fs.readFileSync(glbPath);
  const json = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString("utf8"));
  const box = (prim) => {
    const a = json.accessors[prim.attributes.POSITION];
    const k = a.normalized ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType] : 1;
    return { min: a.min.map((v) => v / k), max: a.max.map((v) => v / k) };
  };
  const union = (boxes) => ({ min: [0, 1, 2].map((i) => Math.min(...boxes.map((x) => x.min[i]))), max: [0, 1, 2].map((i) => Math.max(...boxes.map((x) => x.max[i]))) });
  const byName = new Map(json.nodes.map((n) => [n.name, n]));
  const xf = (n) => JSON.stringify([n.translation ?? [0, 0, 0], n.rotation ?? [0, 0, 0, 1], n.scale ?? [1, 1, 1]]);
  let anchors = 0;
  for (const anc of json.nodes) {
    if (!anc.name?.endsWith("Text") || anc.mesh === undefined) continue;
    const base = byName.get(anc.name.slice(0, -4));
    if (!base || base.mesh === undefined) continue;
    anchors++;
    const prims = json.meshes[base.mesh].primitives.map(box);
    const body = prims[0], all = union(prims);
    const a = union(json.meshes[anc.mesh].primitives.map(box));
    const eps = 1e-4;
    const noKeel = [1, 2].every((i) => Math.abs(all.min[i] - body.min[i]) < eps && Math.abs(all.max[i] - body.max[i]) < eps);
    const inside = [0, 1, 2].every((i) => a.min[i] > body.min[i] - eps && a.max[i] < body.max[i] + eps) && a.min[0] > body.min[0];
    if (!noKeel || !inside || xf(base) !== xf(anc)) ok(false, `${base.name}: no keel ${noKeel}, anchor inside ${inside}, same place ${xf(base) === xf(anc)}`);
  }
  ok(anchors === want, `${anchors} plaques (want ${want}): each mesh is just its body and bars, and each text anchor lies inside its plaque`);
}

function load(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const images = {};
  for (const p of manifest.assets.images ?? []) images[p] = fs.readFileSync(path.join(dir, p));
  return new Host({ wasmPath: path.join(dir, "world.wasm"), glbPath: path.join(dir, "world.glb"), manifest, level: 6, images });
}

/** Run, checking after every frame that the world never holds more than 64 texts. */
function run(h, s) {
  const end = h.time + s;
  while (h.time < end - 1e-9) {
    h.tick();
    if (h.texts.size > 64) throw new Error(`${h.texts.size} texts at once`);
  }
}

// ---------------------------------------------------------------------------
console.log("\n== VR: visual-pack-check ==");
{
  const h = load(VR);
  const imports = h.imports.filter((i) => i.kind === "function").map((i) => i.name);
  ok(!imports.some((n) => /^k_(log|state_|net_|player_)/.test(n)), `no k_log / k_state_* / k_net_* / k_player_* import (${imports.length} imports)`);
  for (const f of ["k_ui_show_world_text_ex", "k_material_set_color", "k_material_set_emissive", "k_material_set_opacity", "k_material_reset", "k_texture_set_bundle"]) ok(imports.includes(f), `imports ${f}`);
  ok(h.images.size === 6 && h.imageBytes === 24 * 1024 * 1024, `six pictures decoded, ${h.imageBytes} bytes (24 MiB, the budget exactly)`);
  checkAnchors(path.join(VR, "world.glb"), 39);
  h.init();
  run(h, 1.5);
  ok(["TabText", "TabColour", "TxtTitle", "TxtStatus", "BtnPlate", "HoverPad", "DoorReal"].every((n) => h.textOf(n) == null) && h.textOf("TabTextText") != null, "text is shown on the anchors, never on a pressed plaque");
  ok(h.textRefusals.length === 0, `no text refused (${JSON.stringify(h.textRefusals)})`);
  has(h, "TxtStatus", "styled shows: 14 of 14 answered 0");
  has(h, "TxtStatus", "level 6");
  has(h, "TxtStatus", "every node found and subscribed");
  has(h, "TxtStatus", "texts refused 0");
  has(h, "TabText", "> Text");
  ok(h.styleOf("SampLeftBigStrong")?.align === "left" && h.styleOf("SampLeftBigStrong")?.strong && h.styleOf("SampLeftBigStrong")?.sizeMm === 160, "left, strong, 160 mm");
  ok(h.styleOf("SampRightSmallReg")?.align === "right" && h.styleOf("SampRightSmallReg")?.sizeMm === 10, "right, regular, 10 mm");
  ok(h.styleOf("SampDefault")?.sizeMm === 80, "size 0 draws at 80 mm");
  ok(h.styleOf("SampBehind")?.plate, "the K3 sample is plated");
  ok(!h.byName.get("GridBoard").visible && h.byName.get("SampMidBigReg").visible, "only the text page's meshes are visible");
  snap(h, "text");

  h.press("BtnBadValues");
  run(h, 0.2);
  has(h, "TxtStatusB", "alpha FE -7, 9 mm -7, 161 mm -7");
  has(h, "TxtStatusB", "strong+Roboto -7, align 3 -7");
  has(h, "TxtStatusB", "flag 32 -7, 129 B -7, empty -7");
  h.press("BtnPlate");
  run(h, 0.2);
  ok(!h.styleOf("SampLeftBigStrong").plate, "plates off");
  h.press("BtnOldCall");
  run(h, 0.2);
  ok(h.styleOf("SampMidBigStrong").engine && h.styleOf("SampMidBigStrong").color === "ffffff", "the old call puts a styled node back to plain white");
  h.press("BtnOldCall");
  h.press("BtnPlate");
  run(h, 0.2);
  ok(h.styleOf("SampMidBigStrong").plate && !h.styleOf("SampMidBigStrong").engine, "styled and plated again");

  // --- K2
  h.press("TabGrid");
  run(h, 1.2);
  ok(h.texts.size === 64, `64 texts on the grid page (${h.texts.size})`);
  ok([...h.texts.values()].every((t) => t.style.plate && !t.style.engine), "all 64 styled and plated");
  ok(txt(h, "TabText") === undefined && txt(h, "TxtTitle") === undefined, "the chrome is hidden to free the pool");
  ok(!h.byName.get("TabText").visible, "the tabs are hidden too");
  has(h, "CellAa", "65th: -5");
  has(h, "CellAa", "hover on, deep 0/0");
  h.point(0, "DeepP");
  run(h, 0.2);
  has(h, "CellAa", "deep 1/0");
  ok(h.events.some((e) => e.kind === "OnHoverEnter" && e.node === "DeepA"), "pointing at the 16th level enters its subscribed root, DeepA");
  h.point(0, null);
  run(h, 0.2);
  has(h, "CellAa", "deep 1/1");
  snap(h, "grid");
  h.press("DeepA");
  run(h, 0.2);
  has(h, "CellAa", "hover off");
  h.point(0, "DeepP");
  run(h, 0.3);
  has(h, "CellAa", "deep 1/1");
  h.point(0, null);
  h.press("DeepA");
  run(h, 0.2);
  has(h, "CellAa", "hover on");
  h.press("CellDd");
  run(h, 0.5);
  has(h, "TabText", "> Text");
  ok(h.texts.size <= 64 && h.textOf("CellAa") === undefined, "back on the text page, the grid's texts gone");

  // --- K5, K6, K8
  h.press("TabColour");
  run(h, 0.3);
  h.press("BtnColour");
  h.press("BtnGlow");
  run(h, 0.2);
  has(h, "TxtStatus", "colour 0, glow 0 at 0.5");
  ok(h.materialOf("ColCube")?.color === "f3a83a" && h.materialOf("ColCube")?.strength === 0.5, "the cube is amber, glowing at 0.5");
  h.press("BtnGlow");
  run(h, 0.1);
  ok(h.materialOf("ColCube").strength === 1, "glow at 1.0");
  h.press("BtnFade");
  run(h, 0.1);
  has(h, "TxtStatus", "fade 0 to 0.3");
  h.press("BtnTryEight");
  run(h, 0.1);
  has(h, "TxtStatus", "-8 cases: fade opaque -8, glow unlit -8");
  h.press("BtnShareA");
  run(h, 0.1);
  ok(h.materialOf("ColShareA")?.color === "2ec4b6" && h.materialOf("ColShareB") === undefined, "shared A changed, shared B kept its authored look");
  h.press("BtnClone");
  run(h, 0.1);
  const copy = h.byName.get("ColChipCopy");
  ok(copy && h.materialOf("ColChip")?.color === "f3a83a" && h.materialOf("ColChipCopy") === undefined, "the source is amber; its copy starts with the authored look");
  const spot = h.worldOf(h.byName.get("ColChipSpot")).pos;
  ok(copy && copy.pos.every((v, k) => Math.abs(v - spot[k]) < 1e-4), "the copy moved onto its marker");
  has(h, "TxtStatusB", ", moved 0");
  h.press("BtnCloneColour");
  run(h, 0.1);
  ok(h.materialOf("ColChipCopy")?.color === "3ddc84", "the copy takes its own colour");
  h.press("BtnResetCube");
  run(h, 0.1);
  ok(h.materialOf("ColCube") === undefined, "reset: the cube's authored material is back");
  h.press("BtnGlow");
  run(h, 0.2);
  snap(h, "colour");
  h.press("BtnMany");
  run(h, 0.3);
  has(h, "TxtStatusB", "256: made 256, refused 0");
  has(h, "TxtStatusB", "257th -5");
  ok(h.mat.size === 256, `256 instances live (${h.mat.size})`);
  h.press("BtnFrameCap");
  run(h, 0.1);
  has(h, "TxtStatusB", "65 writes: 65th -6 (pass)");
  has(h, "TxtStatusB", "256: made 256, refused 0 (pass)");
  has(h, "TxtStatusB", "257th -5 (pass)");
  snap(h, "colour-256");
  h.press("BtnMany");
  run(h, 0.1);
  has(h, "TxtStatusB", "released 0");
  ok(h.mat.size === 0, "every instance released");

  // --- K7
  h.press("TabPics");
  run(h, 0.3);
  h.press("BtnPicShow");
  run(h, 0.1);
  has(h, "TxtStatus", "show: 0 0 0 0 0 0");
  ok(h.materialOf("PicA")?.texture === "media/pic-1-png-rgb.png" && h.materialOf("PicF")?.texture === "media/pic-6-png-rgb.png", "each quad shows its picture");
  snap(h, "pictures");
  h.press("BtnPicSwap");
  h.press("BtnPicTint");
  h.press("BtnPicMissing");
  h.press("BtnPicNoUv");
  run(h, 0.1);
  has(h, "TxtStatus", "swap 0, tint 0");
  has(h, "TxtStatus", "unlisted path -4 (pass)");
  has(h, "TxtStatus", "no UV0 0 (expected: see right)");
  has(h, "TxtStatusB", "DB-045 says -8");
  h.press("BtnPicReset");
  run(h, 0.1);
  has(h, "TxtStatus", "reset 0");

  // --- K9
  h.press("TabHover");
  run(h, 0.3);
  h.point(0, "HoverPad");
  run(h, 0.03);
  ok(!h.events.some((e) => e.kind === "OnHoverEnter" && e.node === "HoverPad"), "no Enter before the 60 ms rest");
  run(h, 0.1);
  h.point(1, "HoverPad");
  run(h, 0.15);
  has(h, "TxtStatus", "left: in 1, out 0; right: in 1, out 0");
  ok(h.materialOf("HoverPad")?.color === "f2f4f8", "both hands: the pad is white");
  h.setMenuOpen(true);
  h.tick();
  has(h, "TxtStatus", "left: in 1, out 1; right: in 1, out 1");
  run(h, 0.5);
  has(h, "TxtStatus", "left: in 1, out 1; right: in 1, out 1");
  h.setMenuOpen(false);
  run(h, 0.15);
  has(h, "TxtStatus", "left: in 2, out 1; right: in 2, out 1");
  h.point(1, null);
  h.point(0, null);
  run(h, 0.2);
  // A quick sweep: 25 ms on each bar is less than the rest, so none is entered; a slow one enters each.
  for (let i = 0; i < 12; i++) {
    h.point(0, `Bar${String.fromCharCode(65 + i)}`);
    run(h, 0.025);
  }
  h.point(0, null);
  run(h, 0.2);
  has(h, "TxtStatus", "bars entered: 0 of 12");
  run(h, 1.2);
  for (let i = 0; i < 6; i++) {
    h.point(0, `Bar${String.fromCharCode(65 + i)}`);
    run(h, 0.15);
  }
  h.point(0, null);
  run(h, 1.5);
  has(h, "TxtStatus", "bars entered: 6 of 12");
  // The 10-a-second cap: both hands across the 20 tiles three times, 100 ms a tile (about 20 Enters a second asked for, for 3 s).
  for (let i = 0; i < 30; i++) {
    h.point(0, `Rate${String.fromCharCode(65 + 2 * (i % 10))}`);
    h.point(1, `Rate${String.fromCharCode(66 + 2 * (i % 10))}`);
    run(h, 0.1);
  }
  h.point(0, null);
  h.point(1, null);
  run(h, 0.3);
  const m = txt(h, "TxtStatus").match(/most Enters: (\d+) in 1 s, (\d+) in 3 s/) ?? [];
  ok(+m[1] <= 20 && +m[2] <= 40 && +m[2] >= 30, `the most Enters: ${m[1]} in 1 s (a full bucket allows 20), ${m[2]} in 3 s (the cap allows 40)`);
  ok(h.events.some((e) => e.kind === "hover_refused"), "some Enters were refused by the rate cap");
  // The arch is one node with a hole; from where the visitor stands, the ray through the hole reaches the wall.
  ok(h.firstHit(h.byName.get("HoverBehind"))?.name === "HoverBehind", "the ray through the arch's hole reaches the wall behind it (per-primitive boxes)");
  ok(h.firstHit(h.byName.get("HoverArch"))?.name === "HoverArch", "the ray to the arch's own middle hits the arch");
  h.point(0, "HoverBehind");
  run(h, 0.2);
  h.point(0, null);
  run(h, 0.2);
  has(h, "TxtStatusB", "wall behind 1");
  // Hover, then travel: the last press (the tab) is long past; the call comes 1 s after the Enter.
  ok(h.time - h.lastPress > 5, "no press in the last 5 s");
  h.point(1, "HoverGo");
  run(h, 0.5);
  has(h, "TxtStatusB", "hover, then travel: in ");
  run(h, 0.8);
  has(h, "TxtStatusB", "hover, then travel: -11 (pass)");
  ok(h.navigations.at(-1)?.url === "world://visual-pack-hover-nowhere.micknerks" && h.navigations.at(-1)?.rc === -11, "k_world_navigate 1 s after a hover alone: -11");
  snap(h, "hover");
  h.point(1, null);
  run(h, 0.3);
  // A press, then the hover within a second: the press's own window decides, so INCONCLUSIVE.
  h.press("HoverPad");
  run(h, 0.4);
  h.point(1, "HoverGo");
  run(h, 1.4);
  has(h, "TxtStatusB", "hover, then travel: INCONCLUSIVE 0");
  has(h, "TxtStatusB", "a press was <5 s before: wait");
  h.point(1, null);
  run(h, 0.3);

  // --- K11 and the cancelled travel
  h.press("TabTravel");
  run(h, 0.3);
  h.press("BtnLooks");
  run(h, 0.1);
  has(h, "TxtStatus", "looks: colour 0, glow 0, fade 0\npicture 0");
  snap(h, "travel");
  h.press("DoorReal");
  ok(h.navigations.at(-1)?.rc === 0 && h.navigations.at(-1)?.url === "world://type-test.micknerks", "the door's k_world_navigate answers 0");
  h.travelStart();
  ok(h.mat.size === 0 && h.images.size === 0, "travel start: every override and picture released");
  run(h, 1.3);
  has(h, "TxtStatus", "while travelling: green 0, reset 0 at 1.0");
  h.travelStopped();
  ok(h.materialOf("TrvCube")?.color === "3ddc84", "after Cancel: the cube keeps the newer green");
  ok(h.materialOf("TrvGlow") === undefined, "after Cancel: the glow mesh reset meanwhile stays reset");
  ok(Math.abs(h.materialOf("TrvBlend")?.opacity - 0.3) < 1e-6 && h.materialOf("TrvPic")?.texture === "media/pic-1-png-rgb.png" && h.images.size === 6, "after Cancel: the fade and the picture are back");
  h.press("BtnLooks");
  run(h, 0.1);
  h.press("DoorNowhere");
  h.travelStart();
  run(h, 0.3);
  h.travelStopped();
  ok(h.materialOf("TrvCube")?.color === "f3a83a" && h.materialOf("TrvGlow")?.emissive === "2ec4b6", "a refused travel gives every look back");
  // K6 frees every look in the world first, so it still makes 256 after every other page.
  h.press("BtnLooks");
  h.press("TabColour");
  run(h, 0.3);
  h.press("BtnMany");
  run(h, 0.3);
  has(h, "TxtStatusB", "256: made 256, refused 0 (pass)");
  has(h, "TxtStatusB", "257th -5 (pass)");
  h.press("BtnMany");
  run(h, 0.2);
  ok(h.textRefusals.length === 1 && h.textRefusals[0].text === "the 65th", `the only text refused in the whole run is the deliberate 65th (${JSON.stringify(h.textRefusals)})`);
  ok(h.textPeak <= 64, `at most ${h.textPeak} texts at once`);
}

// ---------------------------------------------------------------------------
console.log("\n== VR against a DEFECTIVE host whose hover stamps activation ==");
{
  const manifest = JSON.parse(fs.readFileSync(path.join(VR, "manifest.json"), "utf8"));
  const images = {};
  for (const p of manifest.assets.images ?? []) images[p] = fs.readFileSync(path.join(VR, p));
  const h = new Host({ wasmPath: path.join(VR, "world.wasm"), glbPath: path.join(VR, "world.glb"), manifest, level: 6, images, hoverStampsActivation: true });
  h.init();
  run(h, 1.0);
  h.press("TabHover");
  run(h, 6.0);
  h.point(1, "HoverGo");
  run(h, 1.4);
  has(h, "TxtStatusB", "hover, then travel: 0 (FAIL)");
  ok(h.navigations.at(-1)?.rc === 0, "the defect is caught: navigate answered 0 inside the hover's window");
}

// ---------------------------------------------------------------------------
console.log("\n== MR: visual-pack-check-mr ==");
{
  const h = load(MR);
  checkAnchors(path.join(MR, "world.glb"), 4);
  h.init();
  run(h, 1.5);
  ok(h.textRefusals.length === 0, "no text refused");
  has(h, "MrStatus", "styled shows: 6 of 6 answered 0");
  has(h, "MrStatus", "level 6, texts refused 0");
  has(h, "MrTitle", "darkens only its own footprint");
  ok(h.styleOf("MrTxtB")?.plate && h.styleOf("MrTxtB")?.sizeMm === 40, "plated, 40 mm");
  snap(h, "mr");
  h.press("MrBtnFade");
  h.press("MrBtnPlates");
  run(h, 0.2);
  has(h, "MrStatus", "plates: off, fade 0");
  ok(!h.styleOf("MrTxtB").plate, "plates off over the room");
  ok(Math.abs(h.materialOf("MrFade")?.opacity - 0.4) < 1e-6, "the BLEND panel faded to 0.4");
  h.press("MrBtnPlates");
  run(h, 0.2);
  snap(h, "mr-faded");
}

console.log(failures ? `\n${failures} FAILED` : "\nscenario PASSED");
process.exit(failures ? 1 : 0);
