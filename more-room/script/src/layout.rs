//! Positions the script places clones at. Mirrors `LAYOUT` in
//! ../../tools/build_glb.mjs; ../../tools/mock-host.mjs checks they agree.
//!
//! @kosmos-system  Content (KosmosWorlds) -- More Room
//! @kosmos-owner   More Room v1
//!
//! glTF metres, Y up, the visitor at the origin facing +X, +Z on their right.
//! `k_transform_set_position` takes exactly these (world space).

pub const CARD_Y: f32 = 0.752;
pub const GRID_COLS: [f32; 4] = [-0.42, -0.14, 0.14, 0.42]; // z
pub const GRID_ROWS: [f32; 3] = [0.6, 0.74, 0.88]; // x
pub const GRID_SLOTS: usize = GRID_COLS.len() * GRID_ROWS.len();
pub const INBOX: [f32; 3] = [0.95, 0.752, -0.8];
pub const PILE_LATER: [f32; 3] = [0.6, 0.752, -0.72];
pub const PILE_DONE: [f32; 3] = [0.6, 0.752, 0.72];
/// Each card on a pile sits this much higher than the one below it.
pub const PILE_STEP_Y: f32 = 0.014;
/// A pile shows at most this many cards; the rest are counted, not drawn.
pub const PILE_SHOWN: usize = 5;
/// The inbox tray shows the newest of the messages waiting for a desk slot, at most this many.
pub const TRAY_SHOWN: usize = 3;
pub const SHELF_X: f32 = -1.7;
pub const SHELF_Y: f32 = 1.012;
pub const SHELF_SLOTS: [f32; 6] = [-0.5, -0.3, -0.1, 0.1, 0.3, 0.5]; // z
pub const CAL_X: f32 = 2.98;
pub const CAL_Y: f32 = 2.05;
pub const CAL_Z0: f32 = -2.1; // 07:00
pub const CAL_Z_PER_HOUR: f32 = 0.35;
pub const CAL_FIRST_MIN: i32 = 7 * 60;
pub const CAL_LAST_MIN: i32 = 19 * 60;
pub const NOW_LINE_X: f32 = CAL_X - 0.02;
pub const NOW_LINE_Y: f32 = CAL_Y + 0.02;
/// Event tiles are 0.2 m wide; their centre sits this far after the start time.
pub const EVENT_HALF_W: f32 = 0.1;

pub fn grid_slot(i: usize) -> [f32; 3] {
    let row = i / GRID_COLS.len();
    let col = i % GRID_COLS.len();
    [GRID_ROWS[row.min(GRID_ROWS.len() - 1)], CARD_Y, GRID_COLS[col]]
}

pub fn cal_z(min: i32) -> f32 {
    let m = min.clamp(CAL_FIRST_MIN, CAL_LAST_MIN);
    CAL_Z0 + (m - CAL_FIRST_MIN) as f32 / 60.0 * CAL_Z_PER_HOUR
}
