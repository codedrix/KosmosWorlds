/**
 * faces/desk/layout.ts -- the node names and sizes of the Kosmos Desk board in the Lobby.
 *
 * @kosmos-system  Agent bridge (Kosmos Desk face, read-only)
 * @kosmos-owner   Platform
 *
 * The board is a separate panel beside the throne, to the owner's left (`mission-control/README.md`
 * "The Kosmos Desk board"). These names are the contract with the world: `mission-control/nodes.json`
 * lists them under `desk_text` and `desk_world` (written from this file by
 * `scripts/write-nodes-json.mjs`), `mission-control-tools/lobby/make_desk_glb.mjs` builds them,
 * and `mission-control/src/lib.rs` (`DESK_TEXT`, `DESK_WORLD`) finds them. `test/layout.test.ts`
 * fails if this file and nodes.json disagree.
 *
 * World-text budget: the host shows at most 32 labels at once. The board shows only with the
 * arc folded, where Mission Control shows 5 (the four cube labels and the puck's); 5 + 9 = 14.
 * With the arc open (up to 29) the world hides every board label first.
 */

export const DESK_CARD_SLOTS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
/** The heading: two lines, "KOSMOS DESK" over the count and the freshness (or "Desk offline"). */
export const DESK_HEAD_NODE = "TxDeskHead";
/** One card a line, top to bottom. */
export const DESK_CARD_NODES = DESK_CARD_SLOTS.map((s) => `TxDesk${s}`);
/** The board's world-text anchors (9). */
export const DESK_TEXT_NODES = [DESK_HEAD_NODE, ...DESK_CARD_NODES] as const;
/** The board itself: one opaque panel the world shows and hides; the bridge never names it. */
export const DESK_WORLD_NODES = ["McDeskBoard"] as const;

/** At most this many cards (the snapshot file's own limit, and the board's rows). */
export const MAX_CARDS = DESK_CARD_SLOTS.length;

/** Width of one line on the board, metres of 8 cm world text (the panel is 1.66 m wide). */
export const DESK_W = { line: 1.5, head: 1.5 } as const;
