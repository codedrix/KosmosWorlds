import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadFaces } from "../src/faces/registry.js";

test("faces are found by folder; Mission Control is one of them", async () => {
  const faces = await loadFaces();
  assert.ok(faces.has("mission-control"));
  assert.deepEqual([...(faces.get("mission-control")?.worlds ?? [])], ["world://mission-control.micknerks"]);
});

test("a new room is a new folder, nothing else", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "faces-"));
  fs.mkdirSync(path.join(dir, "more-room"));
  fs.writeFileSync(
    path.join(dir, "more-room", "index.js"),
    `export default { name: "more-room", worlds: ["world://more-room.micknerks"], async handle() { return { body: "AB1\\nV 1\\n" }; }, reset() {} };\n`,
  );
  const faces = await loadFaces(dir);
  assert.deepEqual([...faces.keys()], ["more-room"]);
});
