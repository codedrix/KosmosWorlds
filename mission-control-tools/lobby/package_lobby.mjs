// package_lobby.mjs -- builds the Lobby CANDIDATE package (1.5.0: Mission Control v2, the clarity pass, the Kosmos Desk board).
//
// @kosmos-system Content (KosmosWorlds) -- Mission Control (DB-044)
// @kosmos-owner  Content lane
//
//   node mission-control-tools/lobby/package_lobby.mjs <live 1.1.1 package dir> <out package dir>
//
// Starts from the LIVE Lobby package (unpacked from its 1.1.1 bundle, content_hash
// sha256:b1dd1df5...) and:
//   1. merges mission-control/mc_assembly.glb into scene.glb (merge_glb.mjs: every original
//      byte of the live scene kept, and checked), then mission-control/desk_assembly.glb (the
//      Kosmos Desk board, built by make_desk_glb.mjs and checked current first) the same way;
//   2. replaces module.wasm with mission-control/world.wasm (the Lobby's music, ported
//      exactly, plus Mission Control);
//   3. adds audio/chime.wav;
//   4. applies mission-control/lobby-manifest.patch.json (capabilities, host API level 4,
//      the network block, the version: 1.5.0 since the Kosmos Desk board); visibility is unchanged (the package sets none).
// It still starts from the live 1.1.1 package: 1.5.0 is 1.1.1 plus Mission Control v2, the clarity
// pass and the desk board, built fresh exactly as 1.3.0 and 1.4.0 were (never from 1.2.0, which carried v1).
// It publishes nothing: publishing the Lobby is the CEO's (Class C).
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
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

// The desk board's GLB is generated; refuse a committed copy that is not what the generator builds.
execFileSync(process.execPath, [path.join(here, "make_desk_glb.mjs"), "--check"], { stdio: "inherit" });
const withMc = path.join(out, "..", "scene_mc.glb");
execFileSync(process.execPath, [path.join(here, "merge_glb.mjs"), path.join(live, "scene.glb"), path.join(mc, "mc_assembly.glb"), withMc, path.join(out, "..", "merge_report.json")], { stdio: "inherit" });
execFileSync(process.execPath, [path.join(here, "merge_glb.mjs"), withMc, path.join(mc, "desk_assembly.glb"), path.join(out, "scene.glb"), path.join(out, "..", "merge_report_desk.json")], { stdio: "inherit" });
fs.rmSync(withMc);
// Rebuild the program from the checked-out source first, so the shipped bytes are never a
// stale committed binary (Gate 2 security review, LOW-5). The build is reproducible across
// folders; the hash printed below is the one to record in the publish evidence.
if (!process.argv.includes("--no-rebuild")) {
  execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(repo, "mission-control-tools", "build_wasm.ps1")], { stdio: "inherit" });
}
fs.copyFileSync(path.join(mc, "world.wasm"), path.join(out, "module.wasm"));
const wasmHash = crypto.createHash("sha256").update(fs.readFileSync(path.join(out, "module.wasm"))).digest("hex");
console.log(`module.wasm sha256:${wasmHash}`);
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
