// set-bridge-host.mjs -- points Mission Control at the CEO's tunnel host, in both places at once.
//
// @kosmos-system Content (KosmosWorlds) -- Mission Control (DB-043)
// @kosmos-owner  Content lane
//
// Usage:  node mission-control-tools/set-bridge-host.mjs bridge.example.dev
//
// Writes bridge-origin.txt (compiled into world.wasm) and the manifest's
// network.connect + privacy_url, which must name the same origin. Then rebuild:
//   powershell -NoProfile -ExecutionPolicy Bypass -File mission-control-tools\build_wasm.ps1
//
// Refuses what the headset and the publisher would refuse anyway (NET_002/NET_003):
// anything that isn't a plain DNS name, and any host under kosmosvr.com or
// theworldpublishing.com (the client refuses operator hosts).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "mission-control");
const host = (process.argv[2] ?? "").trim().toLowerCase().replace(/^https:\/\//, "").replace(/\/$/, "");

const label = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const labels = host.split(".");
const problems = [];
if (!host) problems.push("give the tunnel's host name, e.g. bridge.example.dev");
if (labels.length < 2 || !labels.every((l) => label.test(l))) problems.push("not a plain DNS name");
if (!/^[a-z]/.test(labels[labels.length - 1] ?? "")) problems.push("the last label must start with a letter (no IP addresses)");
for (const s of ["kosmosvr.com", "theworldpublishing.com"]) if (host === s || host.endsWith("." + s)) problems.push(`the headset refuses hosts under ${s}`);
for (const s of ["localhost", "local", "internal", "arpa"]) if (host === s || host.endsWith("." + s)) problems.push(`.${s} names are refused`);
if (problems.length) {
  console.error(`Refused "${host}": ${problems.join("; ")}.`);
  process.exit(1);
}

const origin = `https://${host}`;
fs.writeFileSync(path.join(pkg, "bridge-origin.txt"), origin + "\n");
const mf = path.join(pkg, "manifest.json");
const m = JSON.parse(fs.readFileSync(mf, "utf8"));
m.network.connect = [origin];
m.network.privacy_url = `${origin}/privacy`;
fs.writeFileSync(mf, JSON.stringify(m, null, 2) + "\n");
console.log(`Mission Control now calls ${origin}`);
console.log("Next: rebuild world.wasm (mission-control-tools\\build_wasm.ps1), then bundle and validate WITHOUT --offline");
console.log(`so the publisher fetches ${origin}/.well-known/world-network.json from the running bridge.`);
