#!/usr/bin/env node
/**
 * gen_sample.mjs -- bakes the sample day into the world (script/src/sample_day.txt).
 *
 * @kosmos-system  Content (KosmosWorlds) -- More Room
 * @kosmos-owner   More Room v1
 *
 * Usage: node --experimental-strip-types more-room/tools/gen_sample.mjs
 *
 * The published room opens on the sample day with no PC, no bridge and no
 * sign-in. The day comes from the same source the bridge face serves
 * (agent-bridge/src/faces/more-room/sample-day.ts), written in the face's own
 * DAY/1 wire plus PREPL (prep lines) and REPLY (canned drafts) records, at the
 * sample's clock (10:05). script/src/lib.rs include_bytes!-es the file and
 * reads it with the same DAY/1 reader as a live answer.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCore, createStore } from "../../agent-bridge/src/faces/more-room/day-core.ts";
import { SAMPLE_DAY } from "../../agent-bridge/src/faces/more-room/sample-day.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const core = createCore({ store: createStore(SAMPLE_DAY), nowMin: () => 10 * 60 + 5 });
const doc = core.baked();
const out = path.join(ROOT, "script", "src", "sample_day.txt");
fs.writeFileSync(out, doc);
console.log(`wrote ${path.relative(ROOT, out)} (${Buffer.byteLength(doc)} bytes, ${doc.split("\n").length - 1} records)`);
