//! Guestbook — the Wave 2 device-checkpoint world.
//!
//! @kosmos-system  Content (KosmosWorlds)
//! @kosmos-owner   NEW-10 (Phase B web-bloodstream plan, Wave 2)
//! @kosmos-level   host API level 2 (`k_ui_prompt`) — built with `--features level2`
//!
//! This world exists to be *looked at on a headset*. Every object in it is a
//! checkpoint step from `docs/CLIENT_COOK_SITTING_RUNBOOK_2026-09.md` section 6
//! step 3, and the README maps them one to one. It is deliberately small: a
//! single room, 268 triangles, no textures, two world texts, one timer.
//!
//! ## What this file proves
//!
//! | Proves | How |
//! |---|---|
//! | world text renders and is DEPTH-TESTED | the count text sits behind `Partition` from half the floor |
//! | `k_ui_prompt` is a system-drawn sheet | pressing `Plinth` asks a question the world never draws |
//! | the activation gate lets a real press through | the prompt is issued from inside `OnInteract` and nowhere else |
//! | a world-drawn panel cannot pass for chrome | `PhishPanel` mimics a system sheet, in world type, in the scene |
//! | per-user state + derived aggregates | the visitor writes `guest_name`; the REGISTRY derives `guest_count` |
//! | KOS-353: timer callbacks fire | `Beacon` turns, and NOTHING in `k_tick` turns it |
//! | the declarative tier needs no program | `Door_Home` is a `link` extra; this file never mentions it |
//!
//! ## The one rule this file is most careful about
//!
//! **The world writes `guest_name`. It never writes `guest_count`.**
//!
//! `guest_count`, `last_guest` and `last_signed_at` are *derived* world-scope
//! rows: the registry computes them from every visitor's per-user `guest_name`
//! row (`world_state_aggregate_defs`, NEW-07a), and a Postgres trigger REFUSES
//! any direct write to a world-scope row. A world that "incremented the
//! counter" would be writing its own per-user copy of a shared number — which
//! is precisely the failure that design guards against, and it would read back
//! wrong the moment a second visitor arrived.
//!
//! So there is no `claim_authority` call here and no shared-counter write. The
//! honest shape is: say who you are, and let the registry count. A non-authority
//! never PUTs a shared row because this world never asks it to.

// On wasm the module is `no_std`; on the host (cargo check / IDE) it keeps std
// so the SDK's mock-host stubs link. Same shape as the SDK's own examples.
#![cfg_attr(target_arch = "wasm32", no_std, no_main)]

use kosmos_sdk::prelude::*;
use kosmos_sdk::ui::{PromptBuffer, PromptResult};

#[cfg(not(target_arch = "wasm32"))]
fn main() {}

// ---------------------------------------------------------------------------
// Contract constants — mirrored in blender/build_world.py and README.md.
// ---------------------------------------------------------------------------

/// The glTF node a visitor presses. Carries `interactable` in the export.
const PLINTH_NODE: &str = "Plinth";
/// The world-drawn panel that apes a system sheet. Not interactable.
const PHISH_NODE: &str = "PhishPanel";
/// The object the TIMER turns.
const BEACON_NODE: &str = "Beacon";

/// Height above the plinth's origin for the live count, in **glTF metres**.
/// The plinth's origin is at its base on the floor, so this is eye height.
const COUNT_TEXT_OFFSET_M: f32 = 1.4;
/// Height above the phishing panel's origin, in metres: the centre of its face.
const PHISH_TEXT_OFFSET_M: f32 = 1.26;

/// The per-user key. `world_state_aggregate_defs` names this exact string as
/// the source of all three guestbook aggregates; changing it silently detaches
/// the count from the signatures.
const KEY_GUEST_NAME: &str = "guest_name";
/// The DERIVED world-scope key. Read only. See the module header.
const KEY_GUEST_COUNT: &str = "guest_count";

/// Echoed back as `OnPromptResult`'s `param1`, so a result from some other
/// question could never be mistaken for this one.
const REQ_SIGN_THE_BOOK: i32 = 1;

/// What the sheet asks. 43 bytes, well inside the 256-byte prompt limit.
const PROMPT_TEXT: &str = "Sign the guestbook (up to 64 characters)";

/// The visitor's answer is clipped to this before it is stored — the question
/// promised 64 characters, so 64 characters is what the world keeps.
const MAX_NAME_CHARS: usize = 64;
/// …and to this many bytes, because `k_state_set_string` caps values at 256 and
/// 64 four-byte scalars would land exactly on that edge.
const MAX_NAME_BYTES: usize = 200;

/// Beacon rotation: 20 Hz, 3 degrees a step — one turn every six seconds.
const BEACON_INTERVAL_MS: u32 = 50;
const BEACON_DEGREES_PER_STEP: f32 = 3.0;

// ---------------------------------------------------------------------------
// Module state
//
// World wasm is single-threaded: the host calls k_init, k_tick and every
// callback from one thread and never re-enters. `static mut` is read and
// written by value only (never borrowed), which keeps it clear of the
// `static_mut_refs` lint.
// ---------------------------------------------------------------------------

/// The host writes the visitor's answer in here, LATER — after `prompt()` has
/// already returned. It must outlive the call, which is why the SDK will only
/// accept a `&'static PromptBuffer`.
static ANSWER: PromptBuffer = PromptBuffer::new();

static mut PLINTH: NodeId = NodeId::NONE;
static mut BEACON: NodeId = NodeId::NONE;
static mut BEACON_TIMER: TimerId = TimerId::NONE;
static mut BEACON_YAW_DEG: f32 = 0.0;

/// What the world text currently claims. Seeded from the derived aggregate at
/// load, nudged once locally when THIS visitor signs, and overwritten by the
/// real aggregate whenever `k_state_on_changed` pushes one.
static mut DISPLAYED_COUNT: i32 = 0;
/// So a visitor who signs twice in one visit does not double-count the local
/// display. The registry counts DISTINCT users and would never have been fooled;
/// this only keeps the text honest between pushes.
static mut SIGNED_THIS_VISIT: bool = false;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

kosmos_main! {
    let plinth = scene::find(PLINTH_NODE);
    let phish = scene::find(PHISH_NODE);
    let beacon = scene::find(BEACON_NODE);

    // SAFETY: single-threaded world wasm; see the module state header.
    unsafe {
        PLINTH = plinth;
        BEACON = beacon;
        DISPLAYED_COUNT = state::get_i32(KEY_GUEST_COUNT);
        SIGNED_THIS_VISIT = false;
        BEACON_YAW_DEG = 0.0;
    }

    // The press that opens the prompt. NOTHING here opens it: a prompt at
    // k_init is the abusive pattern the activation gate exists to stop, and
    // calling ui::prompt from this block would return NoActivation by design.
    if plinth.is_valid() {
        events::subscribe("OnInteract", plinth, cb_index(on_plinth_interact));
    }

    // The answer comes back as a GLOBAL event, because a host->wasm callback
    // carries four i32s and cannot carry a string. `events` capability.
    events::subscribe_global("OnPromptResult", cb_index(on_prompt_result));

    // The derived aggregate, pushed after an inbound state sync applies.
    state::on_changed(KEY_GUEST_COUNT, cb_index(on_guest_count_changed));

    refresh_count_text();

    // The phishing fixture. World-drawn text, in the world's own typeface, on
    // world geometry, standing an arm's length from the plinth — so pressing
    // the plinth puts the REAL system sheet and this imitation in front of the
    // visitor within a second of each other. If a person at the checkpoint
    // cannot tell them apart, the system sheet is the thing that needs fixing:
    // the chrome type, the origin headline and the address band are what make
    // the difference, and this panel has none of them.
    if phish.is_valid() {
        ui::show_world_text(phish, "Enter your password to continue", PHISH_TEXT_OFFSET_M).ok();
    }

    // KOS-353's device proof. If timer callbacks do not fire, the beacon stands
    // still — and k_tick below is deliberately empty so nothing else can move
    // it and flatter the result.
    if beacon.is_valid() {
        let id = timer::set_interval(BEACON_INTERVAL_MS, timer_cb_index(on_beacon_step));
        unsafe { BEACON_TIMER = id; }
    }
}

kosmos_tick! {
    // Deliberately empty.
    //
    // The beacon is turned by `on_beacon_step`, a TIMER callback. Accumulating
    // `timer::delta()` here would turn it whether or not KOS-353 is fixed, and
    // the checkpoint step "a timer-driven animation moves" would then pass on a
    // client where timers are still dead. An empty tick is the measurement.
}

kosmos_shutdown! {
    // SAFETY: single-threaded; see the module state header.
    let id = unsafe { BEACON_TIMER };
    if id.is_valid() {
        timer::cancel(id).ok();
    }
}

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

/// The visitor pressed the plinth.
///
/// This is the only place in the world that asks a question, and it is inside
/// the visitor's own press — which is exactly what makes it legal. The
/// activation window is 5 seconds wide and this call is inside the dispatch
/// that opened it.
#[no_mangle]
pub extern "C" fn on_plinth_interact(_event_type: i32, _node: i32, _p1: i32, _p2: i32) {
    // Ok(()) means only "accepted": exactly one OnPromptResult will follow.
    // Every error is a fact about this world, not about the visitor, so there
    // is nothing to show them here.
    ui::prompt(PROMPT_TEXT, &ANSWER, REQ_SIGN_THE_BOOK).ok();
}

/// The visitor answered, cancelled, or was never asked because they had muted
/// this world's prompts.
#[no_mangle]
pub extern "C" fn on_prompt_result(_event_type: i32, _node: i32, p1: i32, p2: i32) {
    match PromptResult::from_params(&ANSWER, p1, p2, REQ_SIGN_THE_BOOK) {
        Some(PromptResult::Answer(raw)) => sign(raw),
        // An empty submission is a real, different answer from a cancel, and
        // this world treats both the same: nothing is written. A guestbook
        // entry with no name is not an entry.
        Some(PromptResult::Empty) => {}
        Some(PromptResult::Cancelled) => {}
        // Three cancels muted us. Stop asking is the whole contract; there is
        // no retry, no nag, and no second prompt on the next press — the host
        // will resolve those to Muted too.
        Some(PromptResult::Muted) => {}
        Some(PromptResult::WriteFailed) => {}
        // Not our request id, or a payload this SDK build cannot interpret.
        None => {}
    }
}

/// Store the signature and move the local display.
fn sign(raw: &str) {
    let name = clip(raw, MAX_NAME_CHARS, MAX_NAME_BYTES);
    if name.is_empty() {
        return;
    }

    // THE PER-USER WRITE, and the only write this world makes. The client
    // persists it as this visitor's own row; the registry recomputes
    // `guest_count` / `last_guest` / `last_signed_at` from every visitor's row.
    if state::set_string(KEY_GUEST_NAME, name).is_err() {
        return;
    }

    // SAFETY: single-threaded; see the module state header.
    unsafe {
        if !SIGNED_THIS_VISIT {
            SIGNED_THIS_VISIT = true;
            // A LOCAL, DISPLAY-ONLY nudge so the text answers the press
            // immediately. It is never written back to state — see the module
            // header — and the next `on_guest_count_changed` push replaces it
            // with the registry's real number.
            DISPLAYED_COUNT = DISPLAYED_COUNT.saturating_add(1);
        }
    }
    refresh_count_text();
}

/// The derived aggregate changed: take the registry's number over ours.
#[no_mangle]
pub extern "C" fn on_guest_count_changed(_event_type: i32, _node: i32, _p1: i32, _p2: i32) {
    // The callback knows its key from registration and reads the new value
    // back; the four parameters carry nothing useful for a state change.
    // SAFETY: single-threaded; see the module state header.
    unsafe { DISPLAYED_COUNT = state::get_i32(KEY_GUEST_COUNT); }
    refresh_count_text();
}

/// One rotation step. **One argument** — the timer id — which is the whole
/// point: KOS-353's fix is a second invoke path for one-arg timer callbacks,
/// and a four-argument function registered here would trap on the fixed client.
#[no_mangle]
pub extern "C" fn on_beacon_step(_timer_id: u32) {
    // SAFETY: single-threaded; see the module state header.
    let (beacon, yaw) = unsafe {
        BEACON_YAW_DEG += BEACON_DEGREES_PER_STEP;
        if BEACON_YAW_DEG >= 360.0 {
            BEACON_YAW_DEG -= 360.0;
        }
        (BEACON, BEACON_YAW_DEG)
    };
    if beacon.is_valid() {
        // The yaw is accumulated locally rather than read back from the host
        // each step: a get/modify/set round trip accumulates the host's own
        // rounding, and after a few thousand steps the beacon visibly drifts.
        transform::set_rotation(beacon, Euler::new(0.0, yaw, 0.0)).ok();
    }
}

// ---------------------------------------------------------------------------
// The world text
// ---------------------------------------------------------------------------

fn refresh_count_text() {
    // SAFETY: single-threaded; see the module state header.
    let (plinth, count) = unsafe { (PLINTH, DISPLAYED_COUNT) };
    if !plinth.is_valid() {
        return;
    }

    let mut line = TextBuf::new();
    if count <= 0 {
        line.push("No one has signed yet");
    } else {
        line.push_i32(count);
        line.push(if count == 1 { " visitor signed" } else { " visitors signed" });
    }

    // Showing text on a node that already has text REPLACES it in the same pool
    // slot, so this costs nothing on repeat and never approaches the 32-text
    // quota.
    ui::show_world_text(plinth, line.as_str(), COUNT_TEXT_OFFSET_M).ok();
}

// ---------------------------------------------------------------------------
// Small no_std helpers
// ---------------------------------------------------------------------------

/// Clip a string to at most `max_chars` scalars AND at most `max_bytes` bytes,
/// always on a character boundary.
///
/// Both bounds matter: the prompt promised the visitor 64 characters, and
/// `k_state_set_string` counts bytes. Slicing on a byte index alone would panic
/// mid-scalar, which in a world module is a trap that takes the world down.
fn clip(s: &str, max_chars: usize, max_bytes: usize) -> &str {
    let mut end = 0usize;
    let mut chars = 0usize;
    for (start, c) in s.char_indices() {
        let next = start + c.len_utf8();
        if chars >= max_chars || next > max_bytes {
            break;
        }
        end = next;
        chars += 1;
    }
    &s[..end]
}

/// A fixed 64-byte line builder. `alloc` is not available in a `no_std` world
/// module, and 64 bytes is already half the 128-byte world-text budget.
struct TextBuf {
    buf: [u8; 64],
    len: usize,
}

impl TextBuf {
    const fn new() -> Self {
        Self { buf: [0u8; 64], len: 0 }
    }

    /// Append, dropping anything past the end rather than panicking. The only
    /// strings that reach this are literals and a decimal count, so the cap is
    /// a backstop, not a behaviour.
    fn push(&mut self, s: &str) {
        for &b in s.as_bytes() {
            if self.len >= self.buf.len() {
                return;
            }
            self.buf[self.len] = b;
            self.len += 1;
        }
    }

    fn push_i32(&mut self, v: i32) {
        if v < 0 {
            self.push("0");
            return;
        }
        let mut digits = [0u8; 10];
        let mut n = 0usize;
        let mut rest = v as u32;
        if rest == 0 {
            self.push("0");
            return;
        }
        while rest > 0 {
            digits[n] = b'0' + (rest % 10) as u8;
            rest /= 10;
            n += 1;
        }
        while n > 0 {
            n -= 1;
            if self.len >= self.buf.len() {
                return;
            }
            self.buf[self.len] = digits[n];
            self.len += 1;
        }
    }

    /// Always valid UTF-8: everything pushed is ASCII, and `push` only ever
    /// truncates at a byte boundary that is therefore also a scalar boundary.
    fn as_str(&self) -> &str {
        core::str::from_utf8(&self.buf[..self.len]).unwrap_or("")
    }
}

/// The function-table index of a four-argument event callback.
///
/// On wasm32 a function pointer's value IS its index in the module's indirect
/// function table, and taking the address here is what puts the function in
/// that table at all. (`--export-table` in `build.rs` then exports the table
/// under `__indirect_function_table`, which WAMR does not need but a non-WAMR
/// host does — SDK-1 / RESOLVE_SPEC §10.4.)
fn cb_index(f: extern "C" fn(i32, i32, i32, i32)) -> u32 {
    f as usize as u32
}

/// The same, for the ONE-argument timer callback shape.
fn timer_cb_index(f: extern "C" fn(u32)) -> u32 {
    f as usize as u32
}

// ---------------------------------------------------------------------------
// Host-side tests (`cargo test`, against the SDK's mock-host stubs)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clip_keeps_whole_characters_under_both_bounds() {
        assert_eq!(clip("Kendrick", 64, 200), "Kendrick");
        assert_eq!(clip("", 64, 200), "");
        // Character bound bites first for ASCII.
        assert_eq!(clip(&"a".repeat(80), 64, 200).len(), 64);
        // Byte bound bites first for wide scalars, and never mid-sequence.
        let wide = "書".repeat(80); // 3 bytes each
        let out = clip(&wide, 64, 200);
        assert!(out.len() <= 200);
        assert_eq!(out.len() % 3, 0); // never stopped mid-sequence
        // 64 three-byte scalars is 192 bytes, so the CHARACTER bound is the
        // one that bites here, not the byte bound.
        assert_eq!(out.chars().count(), 64);
        // A 4-byte scalar run: 64 of them would be 256 bytes, over the state
        // limit, so the byte bound must stop it short of 64 characters.
        let emoji = "🌍".repeat(64);
        assert!(clip(&emoji, 64, 200).chars().count() < 64);
    }

    /// The exact line `refresh_count_text` builds, for the values a checkpoint
    /// actually passes through: none, the first signature, and a number with
    /// more than one digit.
    fn line(n: i32) -> String {
        let mut b = TextBuf::new();
        if n <= 0 {
            b.push("No one has signed yet");
        } else {
            b.push_i32(n);
            b.push(if n == 1 { " visitor signed" } else { " visitors signed" });
        }
        b.as_str().to_owned()
    }

    #[test]
    fn count_line_reads_correctly_at_the_edges() {
        assert_eq!(line(0), "No one has signed yet");
        assert_eq!(line(-3), "No one has signed yet");
        assert_eq!(line(1), "1 visitor signed");
        assert_eq!(line(2), "2 visitors signed");
        assert_eq!(line(1234), "1234 visitors signed");
        assert_eq!(line(i32::MAX), "2147483647 visitors signed");
    }

    /// The line is always inside the 128-byte world-text budget, even at the
    /// widest count the host could ever report.
    #[test]
    fn count_line_always_fits_the_world_text_budget() {
        for n in [-1, 0, 1, 9, 10, 99, 1_000_000, i32::MAX] {
            assert!(line(n).len() <= 128, "n = {n}");
        }
    }
}
