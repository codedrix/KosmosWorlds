#!/usr/bin/env node
/**
 * unpack_bundle.mjs -- write a .worldbundle's manifest and assets to a folder, so
 * the scenario and the render review can run against what the publisher's
 * optimizer actually ships (not the source GLB).
 *
 * @kosmos-system  Content (KosmosWorlds) -- the level-5/6 checkpoint worlds
 * @kosmos-owner   KOS-699 (builder vp-w1). Same file in type-test/tools and visual-pack-check/tools.
 *
 * Usage:
 *   node <world>/tools/unpack_bundle.mjs <bundle> <out_dir> --kwld <path to @kosmos/kwld dist/index.js>
 *
 * It reads through the publisher's own KWLD reader (@kosmos/kwld, built from the
 * kosmos-worldpublisher checkout used for the bundle), never a second parser.
 * Prints the bundle's sha256 and every asset's path and size.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

const [bundle, out] = process.argv.slice(2);
const k = process.argv.indexOf("--kwld");
if (!bundle || !out || k < 0) {
  console.error("usage: unpack_bundle.mjs <bundle> <out_dir> --kwld <kwld dist/index.js>");
  process.exit(2);
}
const { parseBundle } = await import(pathToFileURL(path.resolve(process.argv[k + 1])).href);
const bytes = fs.readFileSync(bundle);
const parsed = parseBundle(new Uint8Array(bytes));
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "manifest.json"), Buffer.from(parsed.manifestBytes));
console.log(`bundle sha256 ${crypto.createHash("sha256").update(bytes).digest("hex")}`);
for (const a of parsed.assets) {
  const p = a.path ?? a.name;
  const dst = path.join(out, p);
  if (path.relative(out, dst).startsWith("..")) throw new Error(`asset path escapes: ${p}`);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, Buffer.from(a.data ?? a.bytes));
  console.log(`  ${p}  ${(a.data ?? a.bytes).length} B`);
}
