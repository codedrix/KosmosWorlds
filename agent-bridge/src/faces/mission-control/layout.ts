/**
 * faces/mission-control/layout.ts -- the node names and sizes of the Mission Control wall.
 *
 * @kosmos-system  Agent bridge (Mission Control, DB-044)
 * @kosmos-owner   Platform
 *
 * These names are the contract with the world: `KosmosWorlds/mission-control/nodes.json`
 * lists the same names, the Blender script builds them, and the world script
 * finds them. `test/layout.test.ts` fails if this file and nodes.json disagree.
 *
 * Sizes are metres of 8 cm world text on the panels the Blender script builds.
 */

export const CARD_SLOTS = ["A", "B", "C", "D"] as const;
export const NEED_SLOTS = ["A", "B", "C"] as const;
export const RAIL_SLOTS = ["A", "B", "C", "D"] as const;
export const CONV_SLOTS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"] as const;

/** World-text anchors. At most 32 may show at once (the host's pool); chat mode shows 26. */
export const TEXT_NODES = [
  "TxTicker",
  "TxStatus",
  "TxLock",
  "TxProject",
  ...CARD_SLOTS.map((s) => `TxCard${s}`),
  ...NEED_SLOTS.map((s) => `TxNeed${s}`),
  "TxDone",
  ...RAIL_SLOTS.map((s) => `TxRail${s}`),
  "TxHeader",
  ...CONV_SLOTS.map((s) => `TxConv${s}`),
  "TxPage",
  "TxAskA",
  "TxAskB",
] as const;

/** Nodes the visitor presses. Each button's words are part of its own mesh. */
export const BUTTON_NODES = [
  "BtnSignIn",
  "BtnSignOut",
  "BtnTests",
  "BtnPrs",
  "BtnToday",
  "BtnNotes",
  "BtnNewTask",
  "BtnProject",
  ...CARD_SLOTS.map((s) => `Card${s}`),
  ...NEED_SLOTS.map((s) => `Need${s}`),
  ...RAIL_SLOTS.map((s) => `Rail${s}`),
  "BtnStop",
  "BtnBack",
  "BtnApprove",
  "BtnDeny",
  "BtnWhy",
  "BtnKeep",
  "BtnSimple",
  "BtnSummary",
  "BtnReply",
  "BtnPageUp",
  "BtnPageDown",
] as const;

/** Nodes the face only shows, hides, scales or copies. */
export const SHOW_NODES = [
  "LockPanel",
  "WallPanel",
  "ChatPanel",
  "AskPanel",
  "DoneShelf",
  "ChipDone",
  ...CARD_SLOTS.flatMap((s) => [`PillRun${s}`, `PillWait${s}`, `PillIdle${s}`, `Glow${s}`, `BarBg${s}`, `Bar${s}`]),
  ...RAIL_SLOTS.map((s) => `RailSel${s}`),
] as const;

/** Width of one line on each panel, metres. */
export const W = {
  ticker: 3.3,
  status: 3.0,
  lock: 2.6,
  project: 0.9,
  card: 1.3,
  need: 1.0,
  done: 3.0,
  rail: 0.56,
  header: 2.3,
  conv: 2.4,
  ask: 2.3,
} as const;

/** The conversation's left edge, relative to the conversation anchors' centre line. */
export const CONV_LEFT_M = -1.2;
/** Copies of the done chip the shelf can show. */
export const MAX_CHIPS = 12;
