// package_lobby.mjs -- builds the Lobby 1.1.2 CANDIDATE package with the Mission Control door.
//
// @kosmos-system Content (KosmosWorlds) -- Mission Control (DB-044)
// @kosmos-owner  Content lane
//
//   node package_lobby.mjs <live 1.1.1 package dir> <scene_with_door.glb> <out package dir>
//
// Copies the LIVE Lobby package (unpacked from its 1.1.1 bundle, content_hash
// sha256:b1dd1df5...), swaps in the merged scene (merge_glb.mjs: every original
// byte kept), bumps the version, and adds the door's two manifest.links[] entries.
// It publishes nothing: publishing the Lobby is the CEO's (Class C), and only after
// Mission Control itself is live, so the door never points at a missing address.
import fs from "node:fs";
import path from "node:path";

const [, , live, scene, out] = process.argv;
if (!live || !scene || !out) {
  console.error("usage: node package_lobby.mjs <live package dir> <scene_with_door.glb> <out dir>");
  process.exit(1);
}
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(live, out, { recursive: true });
fs.copyFileSync(scene, path.join(out, "scene.glb"));
const mf = path.join(out, "manifest.json");
const m = JSON.parse(fs.readFileSync(mf, "utf8"));
if (m.world.version !== "1.1.1") throw new Error(`expected the live 1.1.1 package, got ${m.world.version}`);
m.world.version = "1.1.2";
m.world.description =
  "Concrete gallery with a living coastal panorama, a throne, an orbiting sphere and background music on entry. Beside the throne, an orb opens the Omni Demo and a door opens Mission Control.";
const door = { url: "world://mission-control.micknerks", label: "Mission Control" };
m.links = (m.links ?? []).filter((l) => l.url !== door.url);
m.links.push({ node: "mission_control_portal", ...door }, { node: "mission_control_label", ...door });
delete m.validation; // the bundler writes a fresh one
fs.writeFileSync(mf, JSON.stringify(m, null, 2) + "\n");
console.log(`wrote ${out}: lobby ${m.world.version}, ${m.links.length} links`);
