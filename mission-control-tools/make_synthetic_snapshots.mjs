// make_synthetic_snapshots.mjs -- AB1 snapshots per the v2 contract, for the lit review.
//
// @kosmos-system Content (KosmosWorlds) -- Mission Control (DB-044 addendum)
// @kosmos-owner  Content lane
//
//   node mission-control-tools/make_synthetic_snapshots.mjs
//
// Writes mission-control/review/synthetic/{pair,paired,cubes,cubes_need,arc,watch}.snapshot.
// These stand in for the real bridge's snapshots (agent-bridge/scripts/capture-review-
// snapshots.mjs) until both halves meet: the lead re-renders from the real ones at
// integration (`MC_SNAPSHOTS=<dir>` for build_panel.py). Records follow V2_CONTRACT.md and
// the bridge builder's stated render (2026-10-19): widths from layout.ts W, conversation
// lines shifted by CONV_LEFT_M + width / 2 with the same Roboto advance table.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(repo, "mission-control", "review", "synthetic");
const nodes = JSON.parse(fs.readFileSync(path.join(repo, "mission-control", "nodes.json"), "utf8"));

// agent-bridge/src/roboto-advance.ts (Roboto-Regular advance widths, em, from " " to "~").
const ADV = [
  0.1873, 0.1983, 0.2697, 0.4695, 0.4389, 0.5511, 0.4695, 0.1637, 0.2498, 0.2528, 0.3252, 0.4275,
  0.1486, 0.3396, 0.2016, 0.3127, 0.4242, 0.4242, 0.4242, 0.4242, 0.4242, 0.4242, 0.4242, 0.4242,
  0.4242, 0.4242, 0.1902, 0.1932, 0.3826, 0.4242, 0.3944, 0.3584, 0.6744, 0.4765, 0.479, 0.4772,
  0.5103, 0.4157, 0.4157, 0.5103, 0.5302, 0.213, 0.4132, 0.479, 0.4143, 0.6545, 0.5305, 0.5136,
  0.479, 0.525, 0.4794, 0.4606, 0.4507, 0.5099, 0.4765, 0.6486, 0.4765, 0.4765, 0.4507, 0.2031,
  0.3113, 0.2031, 0.3149, 0.3425, 0.2358, 0.4143, 0.4283, 0.3944, 0.4283, 0.3944, 0.248, 0.4283,
  0.4283, 0.1898, 0.195, 0.3863, 0.1898, 0.6586, 0.4283, 0.4283, 0.4283, 0.4283, 0.2638, 0.394,
  0.2539, 0.4283, 0.379, 0.5703, 0.379, 0.379, 0.379, 0.2561, 0.1865, 0.2561, 0.5118,
];
const GLYPH_M = 0.08;
// V2_CONTRACT.md section 2 (layout.ts W).
const W = { ticker: 0.95, status: 1.2, project: 0.85, rail: 0.85, done: 0.9, header: 1.2, conv: 1.2, ask: 1.1, pageSpot: 0.9, cube: 0.34, puck: 0.8, seal: 0.45, sealHint: 1.0 };
const CONV_LEFT_M = -0.6;

const width = (s) => [...s].reduce((a, ch) => a + (ADV[ch.charCodeAt(0) - 32] ?? 0.5), 0) * GLYPH_M;
function clip(s, maxM) {
  if (width(s) <= maxM) return s;
  let o = s;
  while (o.length && width(o + "...") > maxM) o = o.slice(0, -1);
  return o.trimEnd() + "...";
}
const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");

class Snap {
  constructor(v) {
    this.lines = ["AB1", `V ${v}`];
  }
  r(...parts) {
    this.lines.push(parts.join(" "));
    return this;
  }
  t(node, s) {
    return s ? this.r("T", node, esc(s)) : this.r("X", node);
  }
  u(node, on) {
    return this.r("U", node, on ? 1 : 0);
  }
  toString() {
    return this.lines.join("\n") + "\n";
  }
}

const SEAL_HINT = "At the PC, type this code to approve";
const arcTexts = nodes.text.filter((n) => !/^Tx(Cube|Puck|Seal)/.test(n));

function seal(s) {
  return s
    .r("M", "pair")
    .r("I", "5f0c1e9a7b3d48e2a6c4f1d0b9e8a7c6")
    .t("TxSeal", clip("KXT WMP", W.seal))
    .t("TxSealHint", clip(SEAL_HINT, W.sealHint))
    .r("H", "SealRing", "armed")
    .u("BtnSealType", true)
    .r("P", "BtnSealType", "Mission Control passphrase (it shows on screen as you type)")
    .r("E", "pair_wait");
}

const JOBS = [
  { slot: "A", project: "registry", state: "need" },
  { slot: "B", project: "portal", state: "calm" },
  { slot: "C", project: "web", state: "calm" },
];

function ledge(s, need) {
  for (const slot of ["A", "B", "C", "D"]) {
    const j = JOBS.find((x) => x.slot === slot);
    if (!j) {
      s.u(`Cube${slot}`, false).r("H", `Cube${slot}`, "off").t(`TxCube${slot}`, "");
      continue;
    }
    const state = j.state === "need" && !need ? "calm" : j.state;
    s.u(`Cube${slot}`, true).r("H", `Cube${slot}`, state).t(`TxCube${slot}`, clip(j.project, W.cube));
  }
  s.u("CubePlus", true);
  if (need) {
    s.r("H", "Puck", "need").t("TxPuck", clip("registry: npm test", W.puck)).u("BtnPuckApprove", true).u("BtnPuckDeny", true);
  } else {
    s.r("H", "Puck", "calm").t("TxPuck", "").u("BtnPuckApprove", false).u("BtnPuckDeny", false);
  }
  return s;
}

/** M cubes: the arc's words are X'd; its buttons keep their last U (the bridge builder). */
function cubes(v, need) {
  const s = new Snap(v).r("M", "cubes").r("Z", need ? 1 : 0);
  for (const n of arcTexts) s.t(n, "");
  return ledge(s, need);
}

const CONV = [
  "You: Run all tests",
  "   - Read 3 files",
  "   - Updated the plan: 1 of 3 done",
  "   - Edited worker/src/index.ts +84 -3",
  "Claude: The rate limiter keyed on the client",
  "  address, but behind the tunnel every",
  "  request comes from one address. I keyed it on",
  "  session instead and added a test for it.",
  "   - Ran tests",
  "!! Needs you: Run a command: npm test",
];

function arc(v, forWatcher) {
  const s = new Snap(v).r("M", "arc");
  if (!forWatcher) s.r("Z", 1);
  s.t("TxTicker", clip("3 working | 1 needs you | 22:00", W.ticker));
  s.t("TxStatus", clip(forWatcher ? "Watching  |  pressed: Run all tests" : "Signed in  |  3/4 jobs  |  Stop: npm run kill", W.status));
  s.t("TxProject", clip("Project: kosmos-registry", W.project));
  const rails = [["registry", "NEEDS YOU"], ["portal", "WORKING"], ["web", "WORKING"], ["", ""]];
  ["A", "B", "C", "D"].forEach((slot, i) => {
    const [p, st] = rails[i];
    s.u(`Rail${slot}`, !!p).u(`RailSel${slot}`, i === 0).t(`TxRail${slot}`, p ? `${clip(p, W.rail)}\n${st}` : "");
  });
  for (const b of ["BtnTests", "BtnPrs", "BtnToday", "BtnNotes", "BtnNewTask", "BtnProject"]) s.u(b, true);
  s.t("TxDone", clip("Done: Summarize today (portal)", W.done));
  s.t("TxHeader", clip("Run all tests  |  registry  |  NEEDS YOU 4m", W.header));
  s.u("BtnFold", !forWatcher).u("BtnStop", true);
  CONV.forEach((line, i) => {
    const node = `TxConv${"ABCDEFGHIJ"[i]}`;
    const l = clip(line, W.conv);
    s.t(node, l).r("O", node, Math.round((CONV_LEFT_M + width(l) / 2) * 1000));
  });
  s.t("TxPage", "1/2").u("BtnPageUp", true).u("BtnPageDown", true);
  s.u("AskPanel", true).t("TxAskA", `${clip("!! Claude wants to: Run a command", W.ask)}\nnpm test`).t("TxAskB", "");
  s.u("BtnApprove", true).u("BtnDeny", true).u("BtnWhy", true);
  for (const b of ["BtnKeep", "BtnSimple", "BtnSummary", "BtnReply"]) s.u(b, false);
  s.t("TxPageSpot", clip("A pinned web page docks here", W.pageSpot));
  s.u("BtnWatch", !forWatcher).t("TxWatch", forWatcher ? "Watching (read-only)" : "Let my group watch: off");
  s.u("BtnSignOut", !forWatcher);
  if (!forWatcher) ledge(s, true);
  return s;
}

const paired = ledge(new Snap(7).r("K", "synthetic-token").r("E", "paired").r("H", "SealRing", "locked").r("M", "cubes"), false);
for (const n of arcTexts) paired.t(n, "");

const files = {
  pair: seal(new Snap(1000002)),
  paired,
  cubes: cubes(8, false),
  cubes_need: cubes(9, true),
  arc: arc(10, false),
  watch: arc(3, true),
};
// Every record names a node in nodes.json.
const known = new Set([...nodes.text, ...nodes.buttons, ...nodes.show, ...nodes.world]);
fs.mkdirSync(out, { recursive: true });
for (const [name, s] of Object.entries(files)) {
  for (const line of s.lines.slice(2)) {
    const [k, n] = line.split(" ");
    if ("TXUHOP".includes(k) && !known.has(n)) throw new Error(`${name}: unknown node ${n}`);
  }
  fs.writeFileSync(path.join(out, `${name}.snapshot`), s.toString());
  console.log(`wrote review/synthetic/${name}.snapshot (${s.lines.length - 2} records)`);
}
