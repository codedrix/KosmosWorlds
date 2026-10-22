//! Visual Pack Check -- the level-6 device-checkpoint world.
//!
//! @kosmos-system  Content (KosmosWorlds) -- Visual Pack Check
//! @kosmos-owner   KOS-699 (builder vp-w1, 2026-10-22). The DB-045 visual pack's
//!                 device checkpoint (runbook section 7.2, K1-K11 and the reviews' extras).
//! @kosmos-level   host API level 6 (`k_ui_show_world_text_ex`, `k_material_*`,
//!                 `k_texture_set_bundle`, the events `OnHoverEnter` / `OnHoverExit`);
//!                 level 3 (`k_node_clone`); level 2 (`k_api_version`); level 0 for the rest.
//!
//! One module for two worlds: `world://visual-pack-check.micknerks` (VR, six pages)
//! and `world://visual-pack-check-mr.micknerks` (mixed reality, one page for K4).
//! The script tells them apart by the node `MrMarker`, which only the MR scene has.
//! See app.rs for the pages and README.md for the session's run sheet.
//!
//! Nothing here is saved, sent or synced: the module imports no `k_state_*`,
//! `k_net_*` or `k_log`, and every colour, picture and text is local to the
//! visitor's headset (the visual pack never syncs).
//!
//! @integration
//!   @kosmos-calls  see host.rs
//!   @kosmos-nodes  ../tools/build_glb.mjs builds every node in nodes.rs

#![cfg_attr(target_arch = "wasm32", no_std, no_main)]

#[cfg(all(target_arch = "wasm32", not(test)))]
#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

pub mod app;
pub mod buf;
pub mod host;
pub mod nodes;

use app::{App, Want, MAX_WANTS};

static mut APP: App = App::new();
static mut WANTS: [Want; MAX_WANTS] = [Want::new(); MAX_WANTS];

#[allow(static_mut_refs)]
fn app() -> &'static mut App {
    // Single-threaded world wasm: one App, reached only from host callbacks.
    unsafe { &mut *core::ptr::addr_of_mut!(APP) }
}

#[allow(static_mut_refs)]
fn wants() -> &'static mut [Want; MAX_WANTS] {
    unsafe { &mut *core::ptr::addr_of_mut!(WANTS) }
}

#[no_mangle]
pub extern "C" fn k_init() {
    let a = app();
    app::init(a, on_press as usize as i32, on_hover_enter as usize as i32, on_hover_exit as usize as i32);
}

#[no_mangle]
pub extern "C" fn k_tick(delta: f32) {
    let a = app();
    let dt = if delta.is_finite() && delta > 0.0 { delta.min(0.25) } else { 0.0 };
    app::tick(a, dt);
    app::render(a, wants());
}

#[no_mangle]
pub extern "C" fn k_shutdown() {}

/// OnInteract on any subscribed node.
#[no_mangle]
pub extern "C" fn on_press(_event_type: i32, node: i32, _p1: i32, _p2: i32) {
    app::press(app(), node);
}

/// OnHoverEnter (global): `node` is the press target, `hand` 0 left, 1 right (RESOLVE_SPEC 10.10.4).
#[no_mangle]
pub extern "C" fn on_hover_enter(_event_type: i32, node: i32, _player: i32, hand: i32) {
    app::hover_enter(app(), node, hand);
}

/// OnHoverExit (global).
#[no_mangle]
pub extern "C" fn on_hover_exit(_event_type: i32, node: i32, _player: i32, hand: i32) {
    app::hover_exit(app(), node, hand);
}

#[cfg(test)]
mod tests;
