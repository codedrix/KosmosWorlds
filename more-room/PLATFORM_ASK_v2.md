# More Room v2 — the platform ask: pinning things to the real wall

> **What this is:** an ask to the platform, from the More Room design (2026-10-14). It is **not built** and **not ruled**.
> - Both routes touch §7 canon (D-038, D-052, D-131), so each is at least T3 and its rulings are the CEO's.
> - It changes nothing in v1. v1 floats its cards at fixed spots measured from where you stand, with no room data ([DESIGN.md](DESIGN.md) §8).

## What the CEO asked for

Pin the calendar to the real wall and the cards to the real desk, while he works. The pins should come back to the same places next visit. And **the pin spots must never be sent to any server**: not More Room's bridge, and not Kosmos's own saved progress.

## Why v1 can't

1. **A world with servers can't read the room today.** The deployed registry refuses `scene_query` or `spatial_anchor` beside `network` at register (NET_006). It will keep refusing until the CEO turns on `registry_settings.room_network_origins` (the Spatial-privacy-model row, as corrected 2026-10-13).
2. **No world can remember a place in the room.** `spatial_anchor` is designed (DB-041 B) but unshipped: there are no `k_anchor_*` functions at any deployed level.
3. **The one store that survives a visit is held by Kosmos's servers.**
   - Login-lite's saved progress (`k_state_save`) is stored by Kosmos under the account. R3 says so for room worlds, in so many words: "a signed-in visitor's saved progress, room facts included, is stored by Kosmos."
   - The older `k_state_set_*` is shared world state, synced to a group.
   - So a world that saved a pin's position would send room geometry to a server. That is the one thing the CEO ruled out.

## Route A — the pieces already designed (sooner)

| Step | What | Whose act | Status |
|---|---|---|---|
| A1 | **R3 switch-on:** `registry_settings.room_network_origins` on, so a world can declare `scene_query`/`spatial_anchor` beside `network` and ask each visitor on the system sheet | **CEO** (Class C, a DEPLOY_LEDGER row). First: the sheet's cook passes its device checkpoint, the KOS-556 correction is sent, and the receipts, privacy page and creator terms are live | Designed and ruled 2026-10-12. The registry gate is deployed (`6de88e5`) |
| A2 | **`spatial_anchor` ships** as DB-041 B designed it: anchors saved **on the headset only** (local storage, never shared), `k_anchor_enumerate_saved`, `k_node_attach_to_anchor`, one save per press | Client lane, then a cook, then a device checkpoint, then the lockstep | Designed (DB-041 B, KOS-949). Its gates are not met |
| A3 | **The small addition this ask needs: a name on each saved anchor.** `k_anchor_save(a, name_ptr, name_len)` (or a sibling `k_anchor_set_name`), and `k_anchor_get_name(a, out, cap)` on the handles `k_anchor_enumerate_saved` returns. Names are up to 16 bytes, stored on the headset beside the anchor, and never leave it | Fold into A2's brief before it is built | **New.** Without it, a world can't tell which saved pin was the calendar, except by writing that down in saved progress, which is on a server |
| A4 | **More Room v2 built on A1–A3:** read the wall planes (`scene_query`), draw a row of "pin here" dots on the real wall, and on a press create, name and save an anchor there, then attach the strip. Point and press, never dragging | This lane | After A1–A3 |

**What A costs, stated plainly.** Under R3, the headset can't tell room data from other data, so the world is the unit.
- More Room would show the R3 sheet ("where your walls, floor and furniture are, and their sizes. Never camera images.") and need **Allow** before it could reach the bridge.
- That is true even though More Room never needs to send the room anywhere.
- The CEO would be granting a permission the room doesn't use, to get one it does.

## Route B — "blind pins" (recommended)

**The idea:** the headset, not the world, places and remembers the pin. The world says "pin this card", and it never learns where the pin is. With no room data reaching world code, a world with servers needs no room permission at all. The requirement "never sent to a server" is then enforced by the platform, not promised by the world.

| Step | What | Notes |
|---|---|---|
| B1 | **A brief** (T3, or T4 if it touches D-052): system pins as a capability-free (or `spatial_anchor`-gated) surface that is **exempt from NET_006**, because world code receives no pose | Name the leaks to close in B3. Under Option C, the room notice still applies ("This world pinned things in your room") with its off switch |
| B2 | **The functions, at the level of the cook that carries them:** `k_pin_request(node, name_ptr, name_len)` (activation-gated) starts a **system placement**: the visitor points the system laser at a real surface and presses, and the headset creates and saves a local anchor keyed by (visitor, `name.author` origin, name) and attaches the node; the answer arrives as an event, `placed` or `cancelled`. `k_pin_restore(node, name)` at load re-attaches and answers only found or not found. `k_pin_clear(name)` | Placement is drawn by the system, never by the world, which makes it a natural place for the menu-IA style. Point and press, never dragging |
| B3 | **The leak audit**, every way a world could learn a pinned node's pose: `k_transform_get_position` / `_local_position` / `_rotation` on the node **and on its descendants**; `k_physics_raycast` hits on it; trigger volumes; anything placed relative to it that the world can read back. Each answers the authored value, or refuses | This is the work. It is why B is a brief and not a ticket |
| B4 | **The backend spike:** DB-041's create, save, relaunch and find check on the EXT and MetaXR paths. B shares it with A2 | Same spike |
| B5 | **The device checkpoint**, then More Room v2 with pins: "Pin the calendar here", "Pin the cards here" | — |

**Why B is the better product.**
- No permission sheet asks to share the room with a mail server.
- No pin spot is in any saved progress.
- The pin survives because the **headset** remembers it, per visitor and per world, like a browser keeps a site's local data.
- Other worlds want the same thing: a poster on your wall, a plant on your desk.

**What B costs:** a new surface with a real leak audit, landing after A2's backend spike, so later than A.

## The order we suggest

1. **Now:** nothing changes. v1 floats at fixed spots.
2. **Brief B1** at the next decision window. It can share DB-041's backend spike (A2/B4).
3. If the CEO wants pins **before** B can land, do **A1 → A2 (with A3 folded in) → A4**, accepting the sheet's cost.
4. Either way, **A3 (names on saved anchors)** is worth folding into DB-041 before its lane is built. It is cheap, and it removes the only reason a world would write pin positions into server-stored saved progress.
