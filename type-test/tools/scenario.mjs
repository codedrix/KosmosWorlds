#!/usr/bin/env node
/**
 * scenario.mjs -- Type Test 1.1.1 against the mock host: every card, the first
 * row's press -> Enter -> re-arm -> navigate flow, the text pool, and the
 * privacy rule (a typed marker never reaches a world text).
 *
 * @kosmos-system  Content (KosmosWorlds) -- Type Test (temporary)
 * @kosmos-owner   Type Test 1.1.1, KOS-699 (builder vp-w1)
 *
 * Usage (from the repo root):
 *   node type-test/tools/scenario.mjs [--glb <scene.glb>] [--wasm <world.wasm>] [--snapshot <out.json>]
 *
 * --glb / --wasm default to type-test/world/; pass the files unpacked from the
 * built bundle to check what the publisher's optimizer actually ships.
 * --snapshot writes the end state (texts and visible meshes) for render_review.py;
 * --snapshot-initial the state one second after load, before any press.
 *
 * Runs twice: as a level-5 client (Build 1013: a pool of 32 texts) and as a
 * level-6 client (the visual-pack cook: 64). The world needs only level 5.
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
const GLB = arg("--glb", path.join(ROOT, "world", "world.glb"));
const WASM = arg("--wasm", path.join(ROOT, "world", "world.wasm"));
const SNAP = arg("--snapshot", null);
const SNAP0 = arg("--snapshot-initial", null);
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "world", "manifest.json"), "utf8"));

let failures = 0;
const ok = (cond, msg) => {
  if (!cond) {
    failures++;
    console.error(`  FAIL ${msg}`);
  } else console.log(`  ok   ${msg}`);
};
// 1.1.1: a plaque's text is shown on its anchor, "<plaque>Text" (build_glb.mjs plaque()).
const has = (h, node, s) => ok((h.textOf(node + "Text") ?? "").includes(s), `${node}Text shows ${JSON.stringify(s)}  [${JSON.stringify(h.textOf(node + "Text"))}]`);

/**
 * 1.1.1: the outline fits the plaque. For every plaque with a text anchor, in the
 * GLB this run loads: the plaque's mesh reaches no lower or wider than its body
 * (primitive 0; no keel), the anchor sits at the plaque's own place and turn,
 * and the anchor's box lies wholly inside the body, behind its front face.
 * Positions are read in each mesh's local frame, dequantised when the optimizer
 * stored them as normalised integers.
 */
function checkAnchors(glbPath) {
  console.log(`\n== text anchors in ${path.basename(glbPath)} ==`);
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
    const noKeel = Math.abs(all.min[1] - body.min[1]) < eps && Math.abs(all.max[1] - body.max[1]) < eps && Math.abs(all.min[2] - body.min[2]) < eps && Math.abs(all.max[2] - body.max[2]) < eps;
    const inside = [0, 1, 2].every((i) => a.min[i] > body.min[i] - eps && a.max[i] < body.max[i] + eps) && a.min[0] > body.min[0];
    if (!noKeel || !inside || xf(base) !== xf(anc)) ok(false, `${base.name}: no keel ${noKeel}, anchor inside ${inside}, same place ${xf(base) === xf(anc)}`);
  }
  ok(anchors === 23, `${anchors} plaques (want 23): each mesh is just its body and bars, and each text anchor lies inside its plaque`);
}
checkAnchors(GLB);

function run(level) {
  console.log(`\n== level ${level} client ==`);
  const h = new Host({ wasmPath: WASM, glbPath: GLB, manifest, level });
  const imports = h.imports.filter((i) => i.kind === "function").map((i) => i.name);
  ok(!imports.some((n) => /^k_(log|state_|net_)/.test(n)), `no k_log / k_state_* / k_net_* import (${imports.length} imports)`);
  ok(imports.includes("k_ui_text_end"), "imports k_ui_text_end (1.0.0 did not)");
  h.init();
  h.run(1.0);
  ok(h.textRefusals.length === 0, `no world text refused (${JSON.stringify(h.textRefusals)})`);
  ok(h.textPeak <= 32, `${h.textPeak} world texts, within a level-5 client's 32`);
  has(h, "TxtTitle", "This headset reports level " + level);
  has(h, "TxtChecks", "Level 5 checks, part 2");
  has(h, "BtnEnd", "World closes it");
  const pressed = ["BtnPlain", "BtnPassword", "BtnEnd", "BtnAudit", "TxtTitle", "TxtNav", "TxtPlainResult", "TxtPassStatus", "TxtEnd", "TxtChecks"];
  ok(pressed.every((n) => h.textOf(n) == null), "no text is shown on a pressed node, only on the anchors");
  if (SNAP0 && level === 6) fs.writeFileSync(SNAP0, JSON.stringify(h.scene(), null, 1));

  // --- the first row (1.0.0's flow, unchanged): plain, Enter, the password field opens by itself.
  h.press("BtnPlain");
  h.run(1.6); // a person takes more than a second to type; the re-arm begin would meet the 1 s rule otherwise (the world retries for 3 s)
  h.type("hello there");
  h.run(0.5);
  h.enter();
  h.tick();
  h.tick();
  has(h, "TxtPlainResult", "hello there");
  has(h, "TxtPlainStatus", "ended: Enter");
  has(h, "TxtPassStatus", "open: yes (Enter), begin 0");
  ok(h.ti.keyboards.at(-1).keyboard === "password", "the Enter opened the masked field with the password keyboard");
  h.run(1.0);
  h.type("pw-QZXV7731");
  h.tick();
  h.enter();
  h.run(8.0);
  has(h, "TxtPassResult", "11 characters");
  has(h, "TxtNav", "returned -11, conclusive");

  // --- C1: the world closes its own field.
  h.press("BtnEnd");
  h.tick();
  has(h, "TxtEnd", "begin 0: open");
  h.type("abc");
  h.run(3.2);
  has(h, "TxtEnd", "begin 0, end 0");
  has(h, "TxtEnd", "events after end: 0 (pass)");
  has(h, "TxtEnd", "read: 3 at end, -7 next");
  ok(!h.events.some((e) => e.kind === "text_event" && e.req === h.ti.session.req && e.code !== 1), "no OnTextInput end code after k_ui_text_end");
  h.run(1.0);

  // --- C2: open twice within a second.
  h.press("BtnTwice");
  h.run(0.3);
  has(h, "TxtTwice", "1st: begin 0, end 0");
  h.press("BtnTwice");
  h.tick();
  has(h, "TxtTwice", "-6: one a second (pass)");
  has(h, "TxtTwice", "again after 0.");
  h.run(1.5);

  // --- C3: one field per world.
  h.press("BtnOne");
  h.tick();
  has(h, "TxtOne", "(open)");
  h.run(0.5);
  h.press("BtnOne");
  h.tick();
  has(h, "TxtOne", "under 1 s: inconclusive.");
  h.run(0.8);
  h.press("BtnOne");
  h.tick();
  has(h, "TxtOne", "-6: one field per world");
  // ...and the first row's button meets the same open session.
  h.run(1.2);
  h.press("BtnPassword");
  h.tick();
  has(h, "TxtPassStatus", "open: NO, begin -6");
  h.closeKeyboard();
  h.run(1.2);

  // --- C4: the limits.
  h.press("BtnLimits");
  h.tick();
  has(h, "TxtLimits", "plain 513: -7, pw 129: -7");
  has(h, "TxtLimits", "pw start: -7, 600>512: -7");
  has(h, "TxtLimits", "512 field: begin 0");
  const start = h.ti.session.text;
  ok(Buffer.byteLength(start) === 500 && start.endsWith("......0500"), "the field opens with the 500-byte start text");
  h.type(start + "abcdefghijklmnopqrstuvwxyz");
  h.tick();
  h.enter();
  h.run(1.2);
  has(h, "TxtLimits", "read 512 bytes, max 512");

  // --- C5: masked + number layout: the password keyboard, cut at 8 bytes.
  h.press("BtnPin");
  h.tick();
  ok(h.ti.keyboards.at(-1).keyboard === "password", `C5 asks for the password keyboard (got ${h.ti.keyboards.at(-1).keyboard})`);
  h.type("1234567890");
  h.tick();
  h.enter();
  h.run(1.2);
  has(h, "TxtPin", "got 8 bytes (cap 8)");

  // --- C6: plain + number layout.
  h.press("BtnDigits");
  h.tick();
  ok(h.ti.keyboards.at(-1).keyboard === "number", "C6 asks for the number keyboard");
  h.type("12345");
  h.tick();
  h.enter();
  h.run(1.2);
  has(h, "TxtDigits", "You typed: 12345");

  // --- C7: the audit field.
  h.press("BtnAudit");
  h.tick();
  h.type("QZXV7731");
  h.tick();
  h.enter();
  h.run(1.2);
  has(h, "TxtAudit", "received 8 bytes");
  // --- An Enter less than a second after the field opened: the re-arm's begin meets
  // the one-a-second rule (-6), and the world retries until it opens.
  h.run(2.0);
  h.press("BtnPlain");
  h.run(0.2);
  h.type("fast");
  h.run(0.1);
  h.enter();
  h.tick();
  h.tick();
  has(h, "TxtPassStatus", "open: retrying, begin -6");
  h.run(1.2);
  has(h, "TxtPassStatus", "open: yes (Enter), begin 0");
  h.closeKeyboard();
  h.run(1.0);

  const shown = [...h.texts.values()].map((t) => t.text).join("\n");
  ok(!shown.includes("QZXV7731"), "the audit marker and the password marker appear in no world text");
  ok(h.textRefusals.length === 0, "no world text was refused in the whole run");
  return h;
}

run(5);
const h6 = run(6);
if (SNAP) {
  fs.writeFileSync(SNAP, JSON.stringify(h6.scene(), null, 1));
  console.log(`\nwrote ${SNAP}`);
}
console.log(failures ? `\n${failures} FAILED` : "\nscenario PASSED");
process.exit(failures ? 1 : 0);
