#!/usr/bin/env node
/**
 * extract_scene.mjs -- pulls the optimized scene GLB out of each built bundle,
 * so scenario.mjs --packaged runs against what the headset will load (the
 * publisher's merge and prune stages can eat script nodes; memory note
 * 2026-10-06).
 *
 * @kosmos-system  Content (KosmosWorlds) -- More Room
 * @kosmos-owner   More Room v1
 *
 * Usage: node more-room/tools/extract_scene.mjs   (after `kosmos-wp bundle` into more-room/dist/)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
for (const v of ["vr", "mr"]) {
  const b = fs.readFileSync(path.join(DIST, `more-room-${v}.worldbundle`));
  if (b.subarray(0, 4).toString("latin1") !== "KWLD") throw new Error(`${v}: not a KWLD bundle`);
  const i = b.indexOf(Buffer.from("glTF"));
  if (i < 0) throw new Error(`${v}: no GLB inside the bundle`);
  const len = b.readUInt32LE(i + 8);
  fs.writeFileSync(path.join(DIST, `scene-${v}.glb`), b.subarray(i, i + len));
  console.log(`${v}: scene-${v}.glb (${len} bytes)`);
}
