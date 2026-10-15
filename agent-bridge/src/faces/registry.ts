/**
 * faces/registry.ts -- finds faces by folder.
 *
 * @kosmos-system  Agent bridge (Mission Control, DB-044)
 * @kosmos-owner   Platform
 *
 * Every subfolder of `faces/` with an `index.js` whose default export is a Face
 * is loaded. Adding a room means adding a folder; no file here or in another
 * face changes. Two faces with the same name refuse to start.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Face } from "./types.js";

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

function isFace(x: unknown): x is Face {
  const f = x as Face;
  return !!f && typeof f.name === "string" && Array.isArray(f.worlds) && typeof f.handle === "function" && typeof f.reset === "function";
}

export async function loadFaces(dir = path.dirname(fileURLToPath(import.meta.url))): Promise<Map<string, Face>> {
  const faces = new Map<string, Face>();
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    const file = path.join(dir, e.name, "index.js");
    if (!fs.existsSync(file)) continue;
    const mod = (await import(pathToFileURL(file).href)) as { default?: unknown };
    if (!isFace(mod.default)) throw new Error(`faces/${e.name}/index.js does not export a Face`);
    const face = mod.default;
    if (!NAME_RE.test(face.name)) throw new Error(`face name "${face.name}" is not lowercase letters, digits and hyphens`);
    if (faces.has(face.name)) throw new Error(`two faces are named "${face.name}"`);
    faces.set(face.name, face);
  }
  return faces;
}
