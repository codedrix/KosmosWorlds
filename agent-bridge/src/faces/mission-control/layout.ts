/**
 * faces/mission-control/layout.ts -- the node names and sizes of Mission Control v2.
 *
 * @kosmos-system  Agent bridge (Mission Control, DB-044 v2: Job Cubes, the decision puck, the Pairing Seal)
 * @kosmos-owner   Platform
 *
 * These names are the contract with the world (`mission-control/V2_CONTRACT.md` sections 2 and 3):
 * `mission-control/nodes.json` lists the same names (written from this file by
 * `scripts/write-nodes-json.mjs`), the Blender script builds them, and the world script finds them.
 * `test/layout.test.ts` fails if this file and nodes.json disagree.
 *
 * Groups (the world decides them by name; the face only needs the lists):
 *   seal   SealRing*, TxSeal, TxSealHint, BtnSealType, McSealCancel
 *   ledge  McLedge, Cube*, TxCube*
 *   puck   Puck*, BtnPuck*, TxPuck
 *   arc    every other panel node (left = jobs, centre = the conversation or the start-a-job set,
 *          the chrome bar under it = group watch and sign-out, right = the page spot)
 *
 * Sizes are metres of 8 cm world text on the panels the Blender script builds.
 *
 * INTEGRATION POINT: nodes.json (world lane) and src/lib.rs must list the same names.
 */

export const RAIL_SLOTS = ["A", "B", "C", "D"] as const;
export const CONV_SLOTS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"] as const;
/**
 * Conversation lines that stay above the ask plate while an approval shows. The plate sits
 * 8 cm in front of the panel with its top at z 1.358 (build_panel.py), and line E's baseline
 * is at 1.374, so lines F-J would be hidden behind it: they carry the newest words.
 */
export const CONV_ABOVE_ASK = 5;
export const CUBE_SLOTS = ["A", "B", "C", "D"] as const;

/** The arc's world text (24 anchors). */
export const ARC_TEXT_NODES = [
  "TxTicker",
  "TxStatus",
  "TxProject",
  ...RAIL_SLOTS.map((s) => `TxRail${s}`),
  "TxDone",
  "TxHeader",
  ...CONV_SLOTS.map((s) => `TxConv${s}`),
  "TxPage",
  "TxAskA",
  "TxAskB",
  "TxWatch",
  "TxPageSpot",
] as const;

export const LEDGE_TEXT_NODES = CUBE_SLOTS.map((s) => `TxCube${s}`);
export const PUCK_TEXT_NODES = ["TxPuck"] as const;
export const SEAL_TEXT_NODES = ["TxSeal", "TxSealHint"] as const;

/**
 * World-text anchors. The host's pool holds 32 shown at once; the arc state shows at most 29
 * (the 24 arc anchors, the four cube labels and the puck's label).
 */
export const TEXT_NODES = [...ARC_TEXT_NODES, ...LEDGE_TEXT_NODES, ...PUCK_TEXT_NODES, ...SEAL_TEXT_NODES] as const;

/** The arc's pressable nodes. Each button's words are part of its own mesh. */
export const ARC_BUTTON_NODES = [
  ...RAIL_SLOTS.map((s) => `Rail${s}`),
  "BtnTests",
  "BtnPrs",
  "BtnToday",
  "BtnNotes",
  "BtnNewTask",
  "BtnProject",
  "BtnFold",
  "BtnStop",
  "BtnApprove",
  "BtnDeny",
  "BtnWhy",
  "BtnKeep",
  "BtnSimple",
  "BtnSummary",
  "BtnReply",
  "BtnPageUp",
  "BtnPageDown",
  "BtnWatch",
  "BtnSignOut",
] as const;

export const CUBE_NODES = CUBE_SLOTS.map((s) => `Cube${s}`);
export const LEDGE_BUTTON_NODES = [...CUBE_NODES, "CubePlus"] as const;
export const PUCK_BUTTON_NODES = ["BtnPuckApprove", "BtnPuckDeny"] as const;
export const SEAL_BUTTON_NODES = ["BtnSealType"] as const;

/** Nodes the visitor presses: a press on any of these is sent to the bridge. */
export const BUTTON_NODES = [...ARC_BUTTON_NODES, ...LEDGE_BUTTON_NODES, ...PUCK_BUTTON_NODES, ...SEAL_BUTTON_NODES] as const;

/** Nodes the face only shows and hides (`U`). All are arc nodes. */
export const SHOW_NODES = ["AskPanel", ...RAIL_SLOTS.map((s) => `RailSel${s}`)] as const;

/** A colour state (`H <node> <state>`, wire.ts). `off` shows no variant at all. */
import type { HueState } from "../../wire.js";
export type { HueState };

/**
 * Base nodes the face colours with `H <node> <state>`, and the states each one has. Each state is a
 * pre-built variant node named `<base><State>` (CubeANeed), listed in WORLD_ONLY_NODES.
 */
export const HUE_NODES: Readonly<Record<string, readonly HueState[]>> = {
  ...Object.fromEntries(CUBE_NODES.map((n) => [n, ["calm", "need", "idle"] as const])),
  Puck: ["calm", "need"],
  SealRing: ["armed", "locked"],
};

/** `CubeA` + `need` = `CubeANeed`. */
export function hueVariant(base: string, state: HueState): string {
  return `${base}${state.charAt(0).toUpperCase()}${state.slice(1)}`;
}

/**
 * Width of one line on each panel, metres (contract section 2, narrowed for the v2.1 panels of
 * section 8: side panels 0.85 m wide, the chrome bar leaves TxWatch 0.50 m).
 */
export const W = {
  ticker: 0.78,
  status: 1.2,
  project: 0.85,
  rail: 0.74,
  done: 0.78,
  header: 1.2,
  conv: 1.2,
  ask: 1.1,
  pageSpot: 0.72,
  cube: 0.34,
  puck: 0.8,
  seal: 0.45,
  sealHint: 1.0,
  watch: 0.5,
} as const;

/** The conversation's left edge, relative to the conversation anchors' centre line. */
export const CONV_LEFT_M = -0.6;

/**
 * Nodes only the WORLD touches; the face never shows, hides or labels them (the hue bases Puck
 * and SealRing are coloured only through `H`). Listed here so nodes.json stays the one list the
 * Blender script builds and the world script finds.
 *   McSeal        the seal on the throne seat: pressing it starts the pairing
 *   McWatchJoin   the Watch button by the throne (visible to every visitor)
 *   McClose       closes the panel (signs out first)
 *   McMove*       the handle buttons: closer, farther, left, right, up, down
 *   Mc*Frame      the arc's static frames (moved and hidden with the arc)
 *   McPageDock    the reserved spot for the pinned web page (DB-043), on the arc's right
 *   McLedge       the ledge that holds the job cubes
 *   Puck          the decision puck's body (hue base)
 *   SealRing      the ring that rises from the seal (hue base)
 *   McSealCancel  closes the raised seal
 *   <base><State> every hue variant
 *   McFloorRing   the projected floor ring on the hall floor (the world shows it only when nothing stacks over it)
 */
export const WORLD_ONLY_NODES = [
  "McSeal",
  "McWatchJoin",
  "McClose",
  "McMoveCloser",
  "McMoveFarther",
  "McMoveLeft",
  "McMoveRight",
  "McMoveUp",
  "McMoveDown",
  "McCenterFrame",
  "McLeftFrame",
  "McRightFrame",
  "McPageDock",
  "McLedge",
  "Puck",
  "SealRing",
  "McSealCancel",
  ...Object.entries(HUE_NODES).flatMap(([base, states]) => states.map((st) => hueVariant(base, st))),
  "McFloorRing",
] as const;
