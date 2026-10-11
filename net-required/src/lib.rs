//! net-required — a network world with `network.required: true` (`world://net-required.micknerks`).
//!
//! @kosmos-system  Content (KosmosWorlds) — network test worlds
//! @kosmos-owner   TW (KOS-983)
//! @kosmos-level   host API level 4 (`k_net_status`)
//!
//! The test is the LOAD, not this program: a visitor who cannot have network
//! (a guest, a Ghost, a switch off) must be refused at load with "This world
//! needs the internet" (`NETWORK_BUILD_PLAN.md` §3, check 12). A visitor who
//! gets in sees one line saying what `k_net_status` answered, which should
//! always be `1`: if it reads `0`, the world loaded when it should not have.
//!
//! It imports `k_net_status` and nothing else from the network surface, so the
//! module needs the `network` capability (WASM_003) and level 4, like
//! `net-check`. No call is ever made to a server.

#![cfg_attr(target_arch = "wasm32", no_std, no_main)]

#[cfg(not(target_arch = "wasm32"))]
fn main() {}

#[cfg(all(target_arch = "wasm32", not(test)))]
#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

#[cfg(target_arch = "wasm32")]
mod host {
    #[link(wasm_import_module = "kosmos")]
    extern "C" {
        /// `(ii)i` scene_read, level 0.
        pub fn k_node_find(name_ptr: i32, name_len: i32) -> i32;
        /// `(iiif)i` ui_basic, level 0 (real since 2).
        pub fn k_ui_show_world_text(node: i32, text_ptr: i32, text_len: i32, offset_y: f32) -> i32;
        /// `()i` network, level 4. 1 available, 0 not, -2 capability undeclared.
        pub fn k_net_status() -> i32;
    }
}

#[cfg(not(target_arch = "wasm32"))]
mod host {
    pub unsafe fn k_node_find(_p: i32, _l: i32) -> i32 { 0 }
    pub unsafe fn k_ui_show_world_text(_n: i32, _p: i32, _l: i32, _o: f32) -> i32 { 0 }
    pub unsafe fn k_net_status() -> i32 { 0 }
}

/// The text anchor on the board (net-test-tools/build_glb.mjs).
const STATUS_NODE: &str = "StatusLine";

/// The text for each `k_net_status` value: up to 4 short lines (the host keeps
/// 4 and refuses more than 128 bytes). Short lines on purpose: world text turns
/// to face the camera, and 1.0.0's single 90-character line was wide enough to
/// swing into the scenery behind it.
fn status_line(s: i32) -> &'static str {
    match s {
        1 => "NETWORK REQUIRED 1.0.1\nnetwork: AVAILABLE (k_net_status 1)\nPASS: expected 1",
        0 => "NETWORK REQUIRED 1.0.1\nnetwork: NOT AVAILABLE (k_net_status 0)\nCHECK: this world should have\nbeen refused at load",
        -2 => "NETWORK REQUIRED 1.0.1\nk_net_status -2: capability undeclared\nCHECK: packaging error",
        _ => "NETWORK REQUIRED 1.0.1\nk_net_status: unknown value\nCHECK",
    }
}

#[no_mangle]
pub extern "C" fn k_init() {
    let node = unsafe { host::k_node_find(STATUS_NODE.as_ptr() as i32, STATUS_NODE.len() as i32) };
    let text = status_line(unsafe { host::k_net_status() });
    if node != 0 {
        unsafe { host::k_ui_show_world_text(node, text.as_ptr() as i32, text.len() as i32, 0.01) };
    }
}

#[no_mangle]
pub extern "C" fn k_tick(_delta: f32) {}

#[no_mangle]
pub extern "C" fn k_shutdown() {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_line_fits_the_world_text_limit() {
        for s in [-2, -1, 0, 1, 2] {
            let t = status_line(s);
            assert!(t.len() <= 128, "{t:?}");
            assert!(t.matches('\n').count() <= 3, "{t:?}");
            for part in t.split('\n') {
                assert!(part.chars().count() <= 40, "{part:?}");
            }
        }
    }
}
