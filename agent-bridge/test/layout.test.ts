import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TEXT_NODES, BUTTON_NODES, SHOW_NODES } from "../src/faces/mission-control/layout.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const nodesFile = path.resolve(here, "..", "..", "..", "mission-control", "nodes.json");

test("the world's nodes.json is the face's layout, name for name", () => {
  const j = JSON.parse(fs.readFileSync(nodesFile, "utf8"));
  assert.deepEqual(j.text, [...TEXT_NODES]);
  assert.deepEqual(j.buttons, [...BUTTON_NODES]);
  assert.deepEqual(j.show, [...SHOW_NODES]);
});

test("node names follow the device rules", () => {
  const all = [...TEXT_NODES, ...BUTTON_NODES, ...SHOW_NODES];
  assert.equal(new Set(all).size, all.length, "no duplicates");
  for (const n of all) {
    // The client strips a trailing _<digit>; k_node_find wants plain names.
    assert.match(n, /^[A-Z][A-Za-z]{1,30}$/, n);
  }
  assert.ok(TEXT_NODES.length <= 32 + 8, "anchors exist for both modes; at most 32 show at once");
});
