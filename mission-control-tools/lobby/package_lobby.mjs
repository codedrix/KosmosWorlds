// package_lobby.mjs -- builds the Lobby 1.2.0 CANDIDATE package with Mission Control inside.
//
// @kosmos-system Content (KosmosWorlds) -- Mission Control (DB-044)
// @kosmos-owner  Content lane
//
//   node mission-control-tools/lobby/package_lobby.mjs <live 1.1.1 package dir> <out package dir>
//
// Starts from the LIVE Lobby package (unpacked from its 1.1.1 bundle, content_hash
// sha256:b1dd1df5...) and:
//   1. merges mission-control/mc_assembly.glb into scene.glb (merge_glb.mjs: every original
//      byte of the live scene kept, and checked);
//   2. replaces module.wasm with mission-control/world.wasm (the Lobby's music, ported
//      exactly, plus Mission Control);
//   3. adds audio/chime.wav;
//   4. applies mission-control/lobby-manifest.patch.json (capabilities, host API level 4,
//      the network block, version 1.2.0); visibility is unchanged.
// It publishes nothing: publishing the Lobby is the CEO's (Class C).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const mc = path.join(repo, "mission-control");
const [, , live, out] = process.argv;
if (!live || !out) {
  console.error("usage: node package_lobby.mjs <live 1.1.1 package dir> <out dir>");
  process.exit(1);
}
const liveManifest = JSON.parse(fs.readFileSync(path.join(live, "manifest.json"), "utf8"));
if (liveManifest.world.version !== "1.1.1") throw new Error(`expected the live 1.1.1 package, got ${liveManifest.world.version}`);

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(live, out, { recursive: true });

execFileSync(process.execPath, [path.join(here, "merge_glb.mjs"), path.join(live, "scene.glb"), path.join(mc, "mc_assembly.glb"), path.join(out, "scene.glb"), path.join(out, "..", "merge_report.json")], { stdio: "inherit" });
fs.copyFileSync(path.join(mc, "world.wasm"), path.join(out, "module.wasm"));
fs.mkdirSync(path.join(out, "audio"), { recursive: true });
fs.copyFileSync(path.join(mc, "audio", "chime.wav"), path.join(out, "audio", "chime.wav"));

const patch = JSON.parse(fs.readFileSync(path.join(mc, "lobby-manifest.patch.json"), "utf8"));
const m = structuredClone(liveManifest);
m.world.version = patch.version;
m.capabilities = [...new Set([...(m.capabilities ?? []), ...patch.add_capabilities])];
m.requires = { ...(m.requires ?? {}), host_api: patch.requires_host_api };
m.assets.audio = [...new Set([...(m.assets.audio ?? []), ...patch.add_audio])];
m.network = patch.network;
delete m.validation; // the bundler writes a fresh one
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(m, null, 2) + "\n");
console.log(`wrote ${out}: lobby ${m.world.version}, capabilities ${m.capabilities.join(",")}, host_api ${m.requires.host_api}`);
