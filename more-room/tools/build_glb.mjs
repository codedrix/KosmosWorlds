#!/usr/bin/env node
/**
 * build_glb.mjs -- writes world.glb for More Room, VR and MR.
 *
 * @kosmos-system  Content (KosmosWorlds) -- More Room
 * @kosmos-owner   More Room v1 (design session 2026-10-14)
 *
 * Usage (from the repo root):
 *   node more-room/tools/build_glb.mjs vr   -> more-room/world-vr/world.glb
 *   node more-room/tools/build_glb.mjs mr   -> more-room/world-mr/world.glb
 *   node more-room/tools/build_glb.mjs both
 *
 * No dependencies and no Blender: a hand-written glTF of boxes, byte-for-byte
 * deterministic (the glTF writer is net-check's, KOS-983). The look is a
 * calm dark room on purpose: world text is always white.
 *
 * Coordinates are glTF: metres, Y up. The spawn is the origin and the visitor
 * faces +X; +Z is their right. The layout, by distance from the spawn:
 *   0.42-1.12 m  the desk (top 0.74 m): mode bar at the front edge, the message
 *                grid, the inbox tray (back left), the Later and Done piles,
 *                the triage action row at the back edge
 *   0.95-1.60 m  the side table on the right (a draft waiting for Approve)
 *   1.8 m right  the pinned tasks column
 *   2.4 m        the stage (brief, focus task, prep, wrap-up)
 *   3.0 m        the calendar strip with its glowing now line
 *   2.4 m left   the window (weather, sunset, one headline)
 *   1.7 m behind the quiet shelf
 * Every position the script also uses is in LAYOUT below and is mirrored in
 * ../script/src/layout.rs; ../tools/mock-host.mjs checks the two agree.
 *
 * Device traps this file is careful about (memory notes, 2026-10-06/08):
 *   1. The client strips a trailing `_<digit>` from node names: no name here
 *      ends in a digit (TaskA, never Task_1).
 *   2. `k_node_find` sees only nodes WITH A MESH: every text anchor is a mesh
 *      (a 1 cm stud), never an empty.
 *   3. The publisher's merge bakes childless meshes with no extras into
 *      anonymous geometry: every node the script finds carries an extra
 *      (`interactable` for what is pressed, `script_node` for the rest).
 *   4. World text yaw-faces the camera and is depth-tested: nothing solid sits
 *      within 0.5 m behind a text anchor.
 *
 * VR vs MR: the same nodes the script needs are in both. VR adds the grid
 * floor, the desk and the side table; MR adds only a faint desk mat, because
 * the real room is the room (no floor, sky "void").
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** Positions the script also uses. Mirrored in ../script/src/layout.rs. */
export const LAYOUT = {
  deskTopY: 0.74,
  cardY: 0.752,
  gridCols: [-0.42, -0.14, 0.14, 0.42], // z
  gridRows: [0.6, 0.74, 0.88], // x
  inbox: [0.95, 0.752, -0.8],
  pileLater: [0.6, 0.752, -0.72],
  pileDone: [0.6, 0.752, 0.72],
  shelfY: 1.012,
  shelfX: -1.7,
  shelfSlots: [-0.5, -0.3, -0.1, 0.1, 0.3, 0.5], // z
  calX: 2.98,
  calY: 2.05,
  calZ0: -2.1, // 07:00
  calZPerHour: 0.35, // so 19:00 is +2.1
  templatePark: [0, -3, 0], // under the floor, hidden
};

// ---------------------------------------------------------------------------
// A minimal glTF writer (net-check's, KOS-983, plus alpha and emission)
// ---------------------------------------------------------------------------

class Gltf {
  constructor(generator) {
    this.j = {
      asset: { version: "2.0", generator },
      scene: 0,
      scenes: [{ name: "Scene", nodes: [] }],
      nodes: [],
      meshes: [],
      materials: [],
      accessors: [],
      bufferViews: [],
      buffers: [{ byteLength: 0 }],
    };
    this.chunks = [];
    this.byteLength = 0;
    this.materialIndex = new Map();
    this.names = new Set();
  }

  /** opts: {alpha: 0..1, emissive: [r,g,b], rough} */
  material(name, rgb, opts = {}) {
    if (this.materialIndex.has(name)) return this.materialIndex.get(name);
    const i = this.j.materials.length;
    const m = {
      name,
      pbrMetallicRoughness: { baseColorFactor: [...rgb, opts.alpha ?? 1], metallicFactor: 0, roughnessFactor: opts.rough ?? 0.85 },
    };
    if (opts.alpha !== undefined && opts.alpha < 1) m.alphaMode = "BLEND";
    if (opts.emissive) m.emissiveFactor = opts.emissive;
    this.j.materials.push(m);
    this.materialIndex.set(name, i);
    return i;
  }

  view(bytes, target) {
    const pad = (4 - (this.byteLength % 4)) % 4;
    if (pad) {
      this.chunks.push(Buffer.alloc(pad));
      this.byteLength += pad;
    }
    const i = this.j.bufferViews.length;
    this.j.bufferViews.push({ buffer: 0, byteOffset: this.byteLength, byteLength: bytes.length, target });
    this.chunks.push(bytes);
    this.byteLength += bytes.length;
    return i;
  }

  /** An axis-aligned box mesh centred on its node's origin. size = [x, y, z] metres. */
  boxMesh(name, size, materialIndex) {
    const [hx, hy, hz] = size.map((v) => v / 2);
    const faces = [
      { n: [1, 0, 0], v: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]] },
      { n: [-1, 0, 0], v: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]] },
      { n: [0, 1, 0], v: [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]] },
      { n: [0, -1, 0], v: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]] },
      { n: [0, 0, 1], v: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
      { n: [0, 0, -1], v: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]] },
    ];
    const pos = new Float32Array(72);
    const nrm = new Float32Array(72);
    const idx = new Uint16Array(36);
    faces.forEach((f, fi) => {
      f.v.forEach((p, vi) => {
        pos.set(p, (fi * 4 + vi) * 3);
        nrm.set(f.n, (fi * 4 + vi) * 3);
      });
      const b = fi * 4;
      idx.set([b, b + 1, b + 2, b, b + 2, b + 3], fi * 6);
    });
    const a = this.j.accessors;
    const posA = a.length;
    a.push({ bufferView: this.view(Buffer.from(pos.buffer), 34962), componentType: 5126, count: 24, type: "VEC3", min: [-hx, -hy, -hz], max: [hx, hy, hz] });
    const nrmA = a.length;
    a.push({ bufferView: this.view(Buffer.from(nrm.buffer), 34962), componentType: 5126, count: 24, type: "VEC3" });
    const idxA = a.length;
    a.push({ bufferView: this.view(Buffer.from(idx.buffer), 34963), componentType: 5123, count: 36, type: "SCALAR" });
    const m = this.j.meshes.length;
    this.j.meshes.push({ name, primitives: [{ attributes: { POSITION: posA, NORMAL: nrmA }, indices: idxA, material: materialIndex, mode: 4 }] });
    return m;
  }

  box(name, t, size, materialIndex, extras, yawRad = 0) {
    if (this.names.has(name)) throw new Error(`duplicate node name ${name}`);
    if (/_?\d$/.test(name)) throw new Error(`node name ends in a digit (the client strips it): ${name}`);
    this.names.add(name);
    const node = { name, mesh: this.boxMesh(name, size, materialIndex), translation: t };
    if (yawRad) node.rotation = [0, Math.sin(yawRad / 2), 0, Math.cos(yawRad / 2)];
    if (extras) node.extras = extras;
    this.j.scenes[0].nodes.push(this.j.nodes.length);
    this.j.nodes.push(node);
  }

  empty(name, t, extras) {
    this.names.add(name);
    this.j.scenes[0].nodes.push(this.j.nodes.length);
    this.j.nodes.push({ name, translation: t, extras });
  }

  glb() {
    const bin = Buffer.concat(this.chunks);
    const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
    this.j.buffers[0].byteLength = bin.length;
    let jsonBuf = Buffer.from(JSON.stringify(this.j), "utf8");
    jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binPadded.length, 8);
    const jh = Buffer.alloc(8);
    jh.writeUInt32LE(jsonBuf.length, 0);
    jh.writeUInt32LE(0x4e4f534a, 4);
    const bh = Buffer.alloc(8);
    bh.writeUInt32LE(binPadded.length, 0);
    bh.writeUInt32LE(0x004e4942, 4);
    return Buffer.concat([header, jh, jsonBuf, bh, binPadded]);
  }
}

// ---------------------------------------------------------------------------
// The room
// ---------------------------------------------------------------------------

const PRESS = { interactable: true };
const anchor = (role) => ({ script_node: role });

function palette(g) {
  return {
    floor: g.material("Floor", [0.035, 0.04, 0.05]),
    grid: g.material("GridLine", [0.16, 0.2, 0.26], { emissive: [0.03, 0.05, 0.08] }),
    desk: g.material("Desk", [0.11, 0.1, 0.095], { rough: 0.6 }),
    deskLeg: g.material("DeskLeg", [0.06, 0.06, 0.07]),
    mat: g.material("DeskMat", [0.03, 0.05, 0.09], { alpha: 0.78 }),
    plate: g.material("TextPlate", [0.02, 0.03, 0.06], { alpha: 0.82 }),
    stud: g.material("Stud", [0.05, 0.05, 0.06]),
    mode: g.material("ModeButton", [0.22, 0.38, 0.62], { emissive: [0.02, 0.05, 0.1] }),
    action: g.material("ActionButton", [0.3, 0.32, 0.38]),
    done: g.material("DoneButton", [0.18, 0.55, 0.32]),
    later: g.material("LaterButton", [0.75, 0.55, 0.18]),
    approve: g.material("ApproveButton", [0.15, 0.62, 0.3], { emissive: [0.0, 0.06, 0.02] }),
    deny: g.material("DenyButton", [0.7, 0.18, 0.16]),
    signin: g.material("SignInButton", [0.95, 0.68, 0.25], { emissive: [0.12, 0.07, 0.0] }),
    tray: g.material("Tray", [0.16, 0.17, 0.2]),
    pile: g.material("PileBase", [0.14, 0.15, 0.17]),
    strip: g.material("CalStrip", [0.1, 0.13, 0.18]),
    tick: g.material("HourTick", [0.25, 0.3, 0.38]),
    now: g.material("NowLine", [1.0, 0.78, 0.35], { emissive: [1.0, 0.62, 0.2] }),
    event: g.material("EventTile", [0.27, 0.45, 0.72], { emissive: [0.03, 0.06, 0.12] }),
    frame: g.material("WindowFrame", [0.08, 0.08, 0.09]),
    paneDay: g.material("PaneDay", [0.45, 0.68, 0.92], { emissive: [0.28, 0.45, 0.7] }),
    paneDusk: g.material("PaneDusk", [0.95, 0.52, 0.3], { emissive: [0.7, 0.32, 0.15] }),
    paneNight: g.material("PaneNight", [0.05, 0.07, 0.18], { emissive: [0.02, 0.03, 0.1] }),
    task: g.material("TaskTile", [0.2, 0.24, 0.3]),
    shelf: g.material("Shelf", [0.09, 0.09, 0.1]),
    veil: g.material("FocusVeil", [0.0, 0.0, 0.0], { alpha: 0.72 }),
    focus: g.material("FocusButton", [0.95, 0.68, 0.25], { emissive: [0.1, 0.06, 0.0] }),
    gmail: g.material("SrcGmail", [0.78, 0.25, 0.22]),
    slack: g.material("SrcSlack", [0.45, 0.28, 0.6]),
    github: g.material("SrcGithub", [0.32, 0.35, 0.4]),
    linear: g.material("SrcLinear", [0.32, 0.38, 0.8]),
    vip: g.material("SrcVip", [0.95, 0.74, 0.28], { emissive: [0.15, 0.1, 0.0] }),
    read: g.material("CardRead", [0.08, 0.1, 0.14]),
    quiet: g.material("QuietCard", [0.18, 0.18, 0.2]),
  };
}

/** A text anchor: a 1 cm stud the script can find. */
function stud(g, P, name, t) {
  g.box(name, t, [0.01, 0.01, 0.01], P.stud, anchor("text"));
}

function scripted(g, P, variant) {
  const L = LAYOUT;
  // --- The mode bar: a column floating at chest height on the left, so its labels
  //     face you (world text turns only about the vertical; desk-level labels seen
  //     from 1.6 m are foreshortened and clipped by their own buttons).
  [["BtnModeMorning", 1.46], ["BtnModeFocus", 1.3], ["BtnModeTriage", 1.14], ["BtnModeWrap", 0.98]].forEach(([n, y]) =>
    g.box(n, [1.3, y, -1.3], [0.05, 0.05, 0.16], P.mode, PRESS),
  );
  // --- Sign in (centre of the desk, shown only when signed out).
  // At eye height in front of the stage, so it is the first thing you see (hidden once signed in).
  g.box("BtnSignIn", [1.6, 1.22, 0], [0.06, 0.09, 0.3], P.signin, PRESS);
  // --- The triage action row, raised on a rail above the desk's back edge.
  g.box("ActionRail", [1.06, 0.86, 0], [0.03, 0.02, 1.2], P.deskLeg);
  [["BtnDone", -0.5, P.done], ["BtnLater", -0.25, P.later], ["BtnReply", 0, P.action], ["BtnTask", 0.25, P.action], ["BtnMute", 0.5, P.action]].forEach(([n, z, m]) =>
    g.box(n, [1.04, 0.895, z], [0.05, 0.05, 0.12], m, PRESS),
  );
  // --- Focus: start / pause, where the action row is (shown only in focus).
  g.box("BtnFocusGo", [1.04, 0.9, 0], [0.06, 0.06, 0.2], P.focus, PRESS);
  // --- The opened card's text floats above the action row; nothing behind it for 1.3 m.
  stud(g, P, "TxtOpen", [1.1, 1.04, 0]);
  // --- Inbox tray and the two piles. Their counts ride on them.
  g.box("InboxTray", [L.inbox[0], 0.745, L.inbox[2]], [0.14, 0.012, 0.24], P.tray, anchor("inbox"));
  g.box("PileLater", [L.pileLater[0], 0.743, L.pileLater[2]], [0.14, 0.006, 0.24], P.pile, anchor("pile"));
  g.box("PileDone", [L.pileDone[0], 0.743, L.pileDone[2]], [0.14, 0.006, 0.24], P.pile, anchor("pile"));
  // --- The side table on the right: a draft waiting for Approve or Deny.
  stud(g, P, "TxtDraft", [1.25, 1.12, 1.25]);
  g.box("BtnApprove", [1.2, 0.95, 0.98], [0.06, 0.06, 0.16], P.approve, PRESS);
  g.box("BtnDeny", [1.2, 0.95, 1.28], [0.06, 0.06, 0.16], P.deny, PRESS);
  g.box("BtnMore", [1.2, 0.95, 1.56], [0.06, 0.06, 0.12], P.action, PRESS);
  // --- The stage: one large text, and one line under it.
  stud(g, P, "TxtStage", [2.4, 1.3, 0]);
  stud(g, P, "TxtStageLow", [2.4, 1.0, 0]);
  g.box("BtnPrepClose", [2.3, 1.1, 1.1], [0.06, 0.08, 0.16], P.action, PRESS);
  // --- The VIP line, up and right of the stage. (Status sits under the window.)
  stud(g, P, "TxtVip", [2.4, 1.6, 1.55]);
  // --- Pinned tasks, on the right.
  [["TaskA", 1.62], ["TaskB", 1.36], ["TaskC", 1.1]].forEach(([n, y]) => g.box(n, [1.8, y, 2.0], [0.05, 0.06, 0.32], P.task, PRESS));
  // --- The calendar strip with hour ticks and the now line.
  g.box("CalStrip", [3.02, L.calY - 0.06, 0], [0.03, 0.02, 4.3], P.strip, anchor("calendar"));
  for (let h = 7; h <= 19; h++) {
    const z = L.calZ0 + (h - 7) * L.calZPerHour;
    g.box(`HourTick${String.fromCharCode(65 + h - 7)}`, [3.02, L.calY - 0.03, z], [0.02, h % 3 === 0 ? 0.06 : 0.03, 0.006], P.tick);
  }
  g.box("NowLine", [L.calX - 0.02, L.calY + 0.02, 0], [0.02, 0.3, 0.012], P.now, anchor("now"));
  stud(g, P, "TxtNext", [2.9, 2.32, 0]);
  // --- The window, on the left.
  g.box("WindowFrame", [1.6, 1.55, -2.45], [0.95, 0.75, 0.04], P.frame);
  g.box("PaneDay", [1.6, 1.55, -2.42], [0.85, 0.65, 0.01], P.paneDay, anchor("pane"));
  g.box("PaneDusk", [1.6, 1.55, -2.415], [0.85, 0.65, 0.01], P.paneDusk, anchor("pane"));
  g.box("PaneNight", [1.6, 1.55, -2.41], [0.85, 0.65, 0.01], P.paneNight, anchor("pane"));
  // Under the frame (bottom 1.175 m), never in front of it; status under that.
  stud(g, P, "TxtWindow", [1.4, 0.88, -2.35]);
  stud(g, P, "TxtStatus", [1.4, 0.7, -2.35]);
  // --- The quiet shelf behind you.
  g.box("QuietShelf", [L.shelfX, 0.99, 0], [0.3, 0.03, 1.4], P.shelf, anchor("shelf"));
  stud(g, P, "TxtQuiet", [L.shelfX + 0.25, 1.15, 0]);
  // --- Focus veils: translucent dark panels that dim what focus leaves alone.
  g.box("VeilCal", [2.85, L.calY + 0.12, 0], [0.02, 0.62, 4.5], P.veil, anchor("veil"));
  g.box("VeilWindow", [1.6, 1.55, -2.35], [1.0, 0.8, 0.02], P.veil, anchor("veil"));
  g.box("VeilTasks", [1.74, 1.36, 2.0], [0.02, 0.85, 0.5], P.veil, anchor("veil"));
  g.box("VeilDesk", [0.74, 0.79, 0], [0.34, 0.02, 1.1], P.veil, anchor("veil"));
  // --- Templates the script clones (parked under the floor, hidden at init).
  const T = L.templatePark;
  const card = [0.11, 0.012, 0.22];
  [["TplMsgGmail", P.gmail], ["TplMsgSlack", P.slack], ["TplMsgGithub", P.github], ["TplMsgLinear", P.linear], ["TplMsgVip", P.vip], ["TplMsgRead", P.read]].forEach(([n, m], i) =>
    g.box(n, [T[0] + i * 0.3, T[1], T[2]], card, m, PRESS),
  );
  g.box("TplEvent", [T[0], T[1], T[2] + 1], [0.03, 0.08, 0.2], P.event, PRESS);
  g.box("TplQuiet", [T[0], T[1], T[2] + 2], [0.18, 0.012, 0.16], P.quiet, anchor("template"));
  g.empty("spawn_point", [0, 0, 0], { spawn_point: true });
  g.box(variant === "mr" ? "VariantMr" : "VariantVr", [T[0], T[1] - 1, T[2]], [0.01, 0.01, 0.01], P.stud, anchor("variant"));
}

function vrRoom(g, P) {
  // A plain grid floor, 12 x 12 m, with a line every metre. No walls: sky "night".
  g.box("Floor", [0, -0.05, 0], [12, 0.1, 12], P.floor);
  for (let i = -6; i <= 6; i++) {
    const s = String.fromCharCode(77 + i); // G..S, never a digit
    g.box(`GridX${s}`, [i, 0.002, 0], [0.012, 0.004, 12], P.grid);
    g.box(`GridZ${s}`, [0, 0.002, i], [12, 0.004, 0.012], P.grid);
  }
  // The desk, 0.70 x 1.90 m, top at 0.74 m.
  g.box("DeskTop", [0.77, 0.72, 0], [0.7, 0.04, 1.9], P.desk);
  [[0.47, -0.9], [0.47, 0.9], [1.07, -0.9], [1.07, 0.9]].forEach(([x, z], i) =>
    g.box(`DeskLeg${String.fromCharCode(65 + i)}`, [x, 0.35, z], [0.04, 0.7, 0.04], P.deskLeg),
  );
  // The side table for drafts.
  g.box("SideTable", [1.2, 0.88, 1.27], [0.3, 0.03, 0.8], P.desk);
  g.box("SideTableLeg", [1.2, 0.44, 1.27], [0.05, 0.87, 0.05], P.deskLeg);
}

function mrRoom(g, P) {
  // The real room is the room. A dark mat shows where cards land, and is what
  // you see behind the desk labels when you look down at them.
  g.box("DeskMat", [0.77, 0.738, 0], [0.7, 0.004, 1.9], P.mat);
  g.box("SideMat", [1.2, 0.878, 1.27], [0.3, 0.004, 0.8], P.mat);
  mrPlates(g, P);
}

/**
 * MR only: dark plates behind the text groups. World text is always white, and
 * passthrough of a light wall behind it is unreadable (found in the lit review,
 * 2026-10-14). Each plate sits 0.5 m beyond its text along the line from the
 * spawn (the clearance rule: nothing solid within 0.5 m behind text), faces the
 * spawn, and is scaled up by distance so it still frames the text. The script
 * shows a plate only while its text shows (PLATES in script/src/lib.rs). Every
 * plate is farther from the spawn than anything pressable in its direction, so
 * it never blocks a press (../DESIGN.md section 4).
 */
export const PLATES = [
  // name, text centre (glTF; anchors are text BOTTOMS, so this is higher), text width x height (m)
  ["PlateStage", [2.4, 1.32, 0], [1.25, 0.82]],
  ["PlateCal", [2.98, 2.28, 0], [4.6, 0.62]],
  ["PlateOpen", [1.1, 1.16, 0], [1.05, 0.56]],
  ["PlateDraft", [1.25, 1.25, 1.25], [0.95, 0.62]],
  ["PlateTasks", [1.8, 1.46, 2.0], [0.7, 0.86]],
  ["PlateModes", [1.3, 1.25, -1.3], [0.36, 0.66]],
  ["PlateWindow", [1.4, 0.92, -2.35], [0.85, 0.5]],
  ["PlateVip", [2.4, 1.64, 1.55], [0.9, 0.2]],
  ["PlateQuiet", [-1.45, 1.22, 0], [0.85, 0.24]],
];

function mrPlates(g, P) {
  const eyeY = 1.62;
  for (const [name, c, [w, h]] of PLATES) {
    const r = Math.hypot(c[0], c[2]);
    const k = (r + 0.5) / r;
    const pos = [c[0] * k, eyeY + (c[1] - eyeY) * k, c[2] * k];
    // Face the spawn: the box's thin axis is X; turn it about +Y onto the radial line.
    const yaw = Math.atan2(-c[2], c[0]);
    g.box(name, pos, [0.01, h * k, w * k], P.plate, anchor("plate"), yaw);
  }
}

export function build(variant) {
  const g = new Gltf(`KosmosWorlds more-room/tools/build_glb.mjs (${variant})`);
  const P = palette(g);
  if (variant === "vr") vrRoom(g, P);
  else mrRoom(g, P);
  scripted(g, P, variant);
  return g;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("build_glb.mjs")) {
  const which = process.argv[2] ?? "both";
  const variants = which === "both" ? ["vr", "mr"] : [which];
  for (const v of variants) {
    if (!["vr", "mr"].includes(v)) {
      console.error("usage: node more-room/tools/build_glb.mjs vr|mr|both");
      process.exit(2);
    }
    const out = path.join(ROOT, `world-${v}`, "world.glb");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const g = build(v);
    fs.writeFileSync(out, g.glb());
    console.log(`wrote ${path.relative(ROOT, out)} (${fs.statSync(out).size} bytes, ${g.j.nodes.length} nodes)`);
  }
}
