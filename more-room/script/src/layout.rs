//! Positions the script places and moves things at. Mirrors `LAYOUT` in
//! ../../tools/build_glb.mjs; ../../tools/scenario.mjs checks they agree.
//!
//! @kosmos-system  Content (KosmosWorlds) -- More Room
//! @kosmos-owner   More Room v2, the Day Ring
//!
//! glTF metres, Y up, the visitor at the origin facing +X, +Z on their right.
//! An angle in degrees is measured from straight ahead toward the right.
//! `k_transform_set_position` takes exactly these (world space).

// --- The Day Ring --------------------------------------------------------------
pub const RING_R: f32 = 2.4;
pub const RING_Y: f32 = 1.78;
/// How far the ring turns per hour of the day (degrees).
pub const RING_DEG_PER_HOUR: f32 = 15.0;
/// Pills and ticks farther round than this are hidden (degrees).
pub const RING_SHOW_DEG: f32 = 100.0;
pub const RING_FIRST_MIN: i32 = 7 * 60;

// --- The landing arc -------------------------------------------------------------
pub const ARC_R: f32 = 1.0;
pub const CARD_Y: f32 = 0.794;
pub const ARC_SLOTS_DEG: [f32; 12] = [-55.0, -45.0, -35.0, -25.0, -15.0, -5.0, 5.0, 15.0, 25.0, 35.0, 45.0, 55.0];
pub const GRID_SLOTS: usize = ARC_SLOTS_DEG.len();
/// A new card falls this far onto its slot.
pub const DROP_H: f32 = 0.9;
pub const PILE_LATER_DEG: f32 = -67.0;
pub const PILE_DONE_DEG: f32 = 67.0;
/// Each card on a pile sits this much higher than the one below it.
pub const PILE_STEP_Y: f32 = 0.016;
/// A pile shows at most this many cards; the rest are counted, not drawn.
pub const PILE_SHOWN: usize = 5;
/// The inbox well, behind the arc's middle: what waits for a slot stacks here.
pub const WELL: [f32; 3] = [1.3, 0.794, 0.0];
/// The well shows the most important of the waiting messages, at most this many.
pub const TRAY_SHOWN: usize = 3;

// --- The quiet shelf behind you -----------------------------------------------------
pub const SHELF_X: f32 = -1.7;
pub const SHELF_Y: f32 = 1.012;
pub const SHELF_SLOTS: [f32; 6] = [-0.5, -0.3, -0.1, 0.1, 0.3, 0.5]; // z

// --- Triage ----------------------------------------------------------------------------
pub const FAN_R: f32 = 1.75;
pub const FAN_Y: f32 = 1.42;
pub const FAN_DEG: [f32; 5] = [-42.0, -21.0, 0.0, 21.0, 42.0];
pub const READ_R: f32 = 1.4;
pub const READ_Y: f32 = 1.1;
/// Fan cards and the reading card rise from this height.
pub const RISE_FROM_Y: f32 = 0.62;
/// The banner, 1.8 m ahead: under the now bar, or in triage just above the fan.
pub const BANNER_R: f32 = 1.8;
pub const BANNER_Y: f32 = 1.53;
pub const BANNER_TRIAGE_Y: f32 = 1.71;

// --- Focus -----------------------------------------------------------------------------
pub const COCOON_R: f32 = 1.95;
pub const COCOON_FROM_R: f32 = 3.0;
pub const COCOON_FACETS: usize = 16;
pub const COCOON_Y: f32 = 1.3;

/// A point `r` metres out at `deg` (0 = straight ahead, + = right), height `y`.
pub fn at(r: f32, deg: f32, y: f32) -> [f32; 3] {
    let a = deg * (core::f32::consts::PI / 180.0);
    [r * cosf(a), y, r * sinf(a)]
}

/// A card's place on the landing arc.
pub fn grid_slot(i: usize) -> [f32; 3] {
    at(ARC_R, ARC_SLOTS_DEG[i.min(GRID_SLOTS - 1)], CARD_Y)
}

/// Where the ring puts a time of day (minutes after midnight) when "now" is
/// `now_min` (fractional): degrees from straight ahead, right = later.
pub fn ring_deg(min: f32, now_min: f32) -> f32 {
    (min - now_min) / 60.0 * RING_DEG_PER_HOUR
}

pub fn ring_at(deg: f32) -> [f32; 3] {
    at(RING_R, deg, RING_Y)
}

/// The Later and Done piles: k cards up.
pub fn pile_at(deg: f32, k: usize) -> [f32; 3] {
    let p = at(ARC_R, deg, CARD_Y);
    [p[0], p[1] + k as f32 * PILE_STEP_Y, p[2]]
}

pub fn fan_at(i: usize, y: f32) -> [f32; 3] {
    at(FAN_R, FAN_DEG[i.min(FAN_DEG.len() - 1)], y)
}

pub fn cocoon_at(k: usize, r: f32) -> [f32; 3] {
    at(r, k as f32 * 360.0 / COCOON_FACETS as f32, COCOON_Y)
}

// no_std has no libm: small, exact-enough sine and cosine for layout (|error| < 1e-6
// over a turn after range reduction), so the wasm needs no math import.
fn reduce(x: f32) -> f32 {
    let two_pi = 2.0 * core::f32::consts::PI;
    // Not `x % two_pi`: f32 remainder lowers to a `fmodf` call, an import the
    // host does not have (WASM_007). A truncating cast is a wasm instruction.
    let mut v = x - ((x / two_pi) as i32) as f32 * two_pi;
    if v > core::f32::consts::PI {
        v -= two_pi;
    } else if v < -core::f32::consts::PI {
        v += two_pi;
    }
    v
}

pub fn sinf(x: f32) -> f32 {
    // sin on [-pi, pi]: fold to [-pi/2, pi/2], then a Taylor series to x^11.
    let mut v = reduce(x);
    let half = core::f32::consts::FRAC_PI_2;
    if v > half {
        v = core::f32::consts::PI - v;
    } else if v < -half {
        v = -core::f32::consts::PI - v;
    }
    let v2 = v * v;
    v * (1.0 - v2 / 6.0 * (1.0 - v2 / 20.0 * (1.0 - v2 / 42.0 * (1.0 - v2 / 72.0 * (1.0 - v2 / 110.0)))))
}

pub fn cosf(x: f32) -> f32 {
    sinf(x + core::f32::consts::FRAC_PI_2)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trig_is_close() {
        for k in -720..=720 {
            let d = k as f32 * 0.5;
            let a = d * core::f32::consts::PI / 180.0;
            assert!((sinf(a) - (a as f64).sin() as f32).abs() < 2e-6, "sin {d}");
            assert!((cosf(a) - (a as f64).cos() as f32).abs() < 2e-6, "cos {d}");
        }
    }

    #[test]
    fn now_is_straight_ahead() {
        assert_eq!(ring_deg(600.0, 600.0), 0.0);
        assert!((ring_deg(660.0, 600.0) - 15.0).abs() < 1e-6);
        let p = ring_at(0.0);
        assert!((p[0] - RING_R).abs() < 1e-6 && p[2].abs() < 1e-6);
        let r = ring_at(90.0);
        assert!(r[0].abs() < 1e-5 && (r[2] - RING_R).abs() < 1e-5, "later is to the right");
    }
}
