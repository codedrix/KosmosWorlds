#!/usr/bin/env node
/**
 * make_images.mjs -- writes the six K7 pictures (world-vr/media/) and the small
 * placeholder texture the picture quads are authored with (tools/placeholder.png).
 *
 * @kosmos-system  Content (KosmosWorlds) -- Visual Pack Check
 * @kosmos-owner   KOS-699 (builder vp-w1)
 *
 * Usage (from the repo root):
 *   node visual-pack-check/tools/make_images.mjs --sharp <path to node_modules/sharp>
 *
 * K7 (runbook 7.2): six pictures at 1024 x 1024 fill the 24 MiB decoded budget
 * exactly (6 x 1024 x 1024 x 4 = 25,165,824 bytes, which passes). Each file is at
 * most 512 KB, and together they cover the formats ASSET_007 and the headset's
 * decoder accept: PNG RGB, PNG greyscale, a baseline JPEG and a progressive JPEG
 * (both 8-bit RGB with 4:2:0 chroma, which the Quest's jpgd decodes), and a
 * greyscale JPEG. Each picture says its number, its format and TOP, and has a
 * corner mark, so a picture shown upside down or mirrored is obvious.
 *
 * The placeholder is not flat on purpose: the publisher's prune folds a
 * one-colour texture into the material factor, and the quad would then lose the
 * UV0 the picture needs.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const i = process.argv.indexOf("--sharp");
if (i < 0) {
  console.error("usage: make_images.mjs --sharp <path to node_modules/sharp>");
  process.exit(2);
}
const require = createRequire(import.meta.url);
const sharp = require(path.resolve(process.argv[i + 1]));

const LIMIT = 512 * 1024;
const PICS = [
  { file: "pic-1-png-rgb.png", n: 1, fmt: "PNG, RGB 8-bit", bg: "#1d3557", fg: "#f1faee", accent: "#e63946" },
  { file: "pic-2-png-grey.png", n: 2, fmt: "PNG, greyscale 8-bit", bg: "#3a3a3a", fg: "#ffffff", accent: "#9a9a9a", grey: true },
  { file: "pic-3-jpeg-baseline.jpg", n: 3, fmt: "JPEG baseline, 4:2:0", bg: "#2a9d8f", fg: "#fefae0", accent: "#e9c46a" },
  { file: "pic-4-jpeg-progressive.jpg", n: 4, fmt: "JPEG progressive, 4:2:0", bg: "#6a4c93", fg: "#fff3b0", accent: "#ff924c" },
  { file: "pic-5-jpeg-grey.jpg", n: 5, fmt: "JPEG, greyscale", bg: "#505050", fg: "#f0f0f0", accent: "#b0b0b0", grey: true },
  { file: "pic-6-png-rgb.png", n: 6, fmt: "PNG, RGB 8-bit", bg: "#bc4749", fg: "#f2e8cf", accent: "#386641" },
];

function svg(p, size = 1024) {
  const checker = [];
  for (let k = 0; k < 32; k++) {
    checker.push(`<rect x="${64 + k * 28}" y="860" width="14" height="14" fill="${p.fg}"/>`);
    checker.push(`<rect x="${78 + k * 28}" y="874" width="14" height="14" fill="${p.fg}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="100%" height="100%" fill="${p.bg}"/>
  <rect x="16" y="16" width="${size - 32}" height="${size - 32}" fill="none" stroke="${p.accent}" stroke-width="16"/>
  <polygon points="16,16 176,16 16,176" fill="${p.accent}"/>
  <text x="44" y="78" font-family="Segoe UI, Arial, sans-serif" font-size="44" font-weight="700" fill="${p.bg}">TL</text>
  <text x="512" y="130" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="72" font-weight="700" fill="${p.fg}">TOP</text>
  <text x="512" y="560" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="420" font-weight="700" fill="${p.fg}">${p.n}</text>
  <text x="512" y="700" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="58" fill="${p.fg}">Picture ${p.n} of 6</text>
  <text x="512" y="780" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="50" fill="${p.accent}">${p.fmt}</text>
  ${checker.join("\n  ")}
  <text x="512" y="960" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="40" fill="${p.fg}">1024 x 1024: sharp edges, no blur</text>
</svg>`;
}

const media = path.join(ROOT, "world-vr", "media");
fs.mkdirSync(media, { recursive: true });
for (const p of PICS) {
  let img = sharp(Buffer.from(svg(p))).flatten({ background: p.bg }).removeAlpha();
  if (p.grey) img = img.greyscale();
  const out = path.join(media, p.file);
  if (p.file.endsWith(".png")) {
    img = img.png({ compressionLevel: 9, palette: false });
    if (p.grey) img = img.toColourspace("b-w");
  } else {
    img = img.jpeg({ quality: 86, chromaSubsampling: "4:2:0", progressive: p.file.includes("progressive"), mozjpeg: false });
    if (p.grey) img = img.toColourspace("b-w");
  }
  await img.toFile(out);
  const meta = await sharp(out).metadata();
  const size = fs.statSync(out).size;
  if (size > LIMIT) throw new Error(`${p.file} is ${size} bytes, over 512 KB`);
  if (meta.width !== 1024 || meta.height !== 1024) throw new Error(`${p.file} is ${meta.width}x${meta.height}`);
  console.log(`${p.file}: ${meta.format} ${meta.width}x${meta.height} ${meta.channels} channel(s) ${meta.isProgressive ? "progressive " : ""}${meta.chromaSubsampling ?? ""} ${size} B`);
}

// The placeholder the quads are authored with: a 64 x 64 grey grid with a darker frame.
const ph = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
  <rect width="64" height="64" fill="#5a6274"/>
  <rect x="2" y="2" width="60" height="60" fill="none" stroke="#2c3240" stroke-width="4"/>
  <path d="M0 32 H64 M32 0 V64" stroke="#7a8296" stroke-width="2"/>
</svg>`;
const phOut = path.join(HERE, "placeholder.png");
await sharp(Buffer.from(ph)).removeAlpha().png({ compressionLevel: 9, palette: false }).toFile(phOut);
console.log(`placeholder.png ${fs.statSync(phOut).size} B`);
