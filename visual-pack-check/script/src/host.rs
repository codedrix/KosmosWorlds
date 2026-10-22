//! Host imports (module "kosmos") for Visual Pack Check, and the stand-ins host tests link against.
//!
//! @kosmos-system  Content (KosmosWorlds) -- Visual Pack Check
//! @kosmos-owner   KOS-699 (builder vp-w1)
//!
//! Every signature is the client's committed `host-api-levels.json` at
//! feat/device-p2-2026-10 a1936d8 (current_level 6); the capability each needs is
//! on its line. Level 6: `k_ui_show_world_text_ex`, the four `k_material_*` and
//! `k_texture_set_bundle`, and the events `OnHoverEnter` / `OnHoverExit`.
//! Level 3: `k_node_clone`. Level 2: `k_api_version`. The rest are level 0.
//!
//! @integration
//!   @kosmos-calls  KDomUI.cpp, KDomMaterial.cpp, KDomSceneGraph.cpp, KDomTransform.cpp,
//!                  KDomEvents.cpp, KDomWorld.cpp (client a1936d8)

#[cfg(target_arch = "wasm32")]
mod imp {
    #[link(wasm_import_module = "kosmos")]
    extern "C" {
        /// "(ii)i", scene_read. A handle > 0, 0 for no such MESH node.
        pub fn k_node_find(name_ptr: i32, name_len: i32) -> i32;
        /// "(ii)i", scene_write. Hiding also turns collision off.
        pub fn k_node_set_visible(node: i32, visible: i32) -> i32;
        /// "(iiii)i", scene_write, level 3. A copy on top of the source; parent 0 = the source's parent.
        pub fn k_node_clone(src: i32, parent: i32, name_ptr: i32, name_len: i32) -> i32;
        /// "(iiii)i", scene_read. World position, Kosmos Y-up metres, written as three f32.
        pub fn k_transform_get_position(node: i32, out_x: i32, out_y: i32, out_z: i32) -> i32;
        /// "(ifff)i", transform. World position, Kosmos Y-up metres.
        pub fn k_transform_set_position(node: i32, x: f32, y: f32, z: f32) -> i32;
        /// "(iiii)i", events.
        pub fn k_event_subscribe(name_ptr: i32, name_len: i32, node: i32, callback_fn_index: i32) -> i32;
        /// "(iii)i", events.
        pub fn k_event_subscribe_global(name_ptr: i32, name_len: i32, callback_fn_index: i32) -> i32;
        /// "(i)i", events.
        pub fn k_event_unsubscribe(subscription: i32) -> i32;
        /// "(iiif)i", ui_basic. The plain look: white, 8 cm, Roboto, centred, no plate.
        pub fn k_ui_show_world_text(node: i32, text_ptr: i32, text_len: i32, offset_y: f32) -> i32;
        /// "(iiifiii)i", ui_basic, level 6. rgba 0xRRGGBBAA (AA = 0xFF), size_mm 0 or 10..160,
        /// flags align 0/1/2 | strong 4 | plate 8 | engine font 16.
        pub fn k_ui_show_world_text_ex(node: i32, text_ptr: i32, text_len: i32, offset_y: f32, rgba: i32, size_mm: i32, flags: i32) -> i32;
        /// "(i)i", ui_basic.
        pub fn k_ui_hide_world_text(node: i32) -> i32;
        /// "(ii)i", world_navigate. -11 without a local press in the last 5 s.
        pub fn k_world_navigate(url_ptr: i32, url_len: i32) -> i32;
        /// "()i", level 2.
        pub fn k_api_version() -> i32;
        /// "(iii)i", scene_write, level 6. 0xRRGGBBAA, AA must be 0xFF.
        pub fn k_material_set_color(node: i32, slot: i32, rgba: i32) -> i32;
        /// "(iiif)i", scene_write, level 6. 0x00RRGGBB, strength 0..1.
        pub fn k_material_set_emissive(node: i32, slot: i32, rgb: i32, strength: f32) -> i32;
        /// "(iif)i", scene_write, level 6. BLEND materials only.
        pub fn k_material_set_opacity(node: i32, slot: i32, opacity: f32) -> i32;
        /// "(ii)i", scene_write, level 6.
        pub fn k_material_reset(node: i32, slot: i32) -> i32;
        /// "(iiii)i", scene_write, level 6. A decoded assets.images[] entry, else -4.
        pub fn k_texture_set_bundle(node: i32, slot: i32, path_ptr: i32, path_len: i32) -> i32;
    }
}

#[cfg(target_arch = "wasm32")]
pub use imp::*;

/// Host-side stand-ins so `cargo test` links: a tiny recorder. Every call is
/// logged; answers come from `ANSWER` (0 unless a test sets it).
#[cfg(not(target_arch = "wasm32"))]
mod imp {
    use std::cell::RefCell;
    thread_local! {
        pub static CALLS: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
        pub static ANSWER: RefCell<i32> = const { RefCell::new(0) };
    }
    fn rec(s: String) -> i32 {
        CALLS.with(|c| c.borrow_mut().push(s));
        ANSWER.with(|a| *a.borrow())
    }
    pub unsafe fn k_node_find(_p: i32, _l: i32) -> i32 { 1 }
    pub unsafe fn k_node_set_visible(n: i32, v: i32) -> i32 { rec(format!("visible {n} {v}")) }
    pub unsafe fn k_node_clone(s: i32, p: i32, _np: i32, _nl: i32) -> i32 { rec(format!("clone {s} {p}")); 900 }
    pub unsafe fn k_transform_get_position(n: i32, _x: i32, _y: i32, _z: i32) -> i32 { rec(format!("getpos {n}")) }
    pub unsafe fn k_transform_set_position(n: i32, x: f32, y: f32, z: f32) -> i32 { rec(format!("setpos {n} {x} {y} {z}")) }
    pub unsafe fn k_event_subscribe(_p: i32, _l: i32, n: i32, _c: i32) -> i32 { rec(format!("sub {n}")); 1 }
    pub unsafe fn k_event_subscribe_global(_p: i32, _l: i32, _c: i32) -> i32 { rec("subg".to_string()); 1 }
    pub unsafe fn k_event_unsubscribe(s: i32) -> i32 { rec(format!("unsub {s}")) }
    pub unsafe fn k_ui_show_world_text(n: i32, _p: i32, l: i32, _o: f32) -> i32 { rec(format!("text {n} {l}")) }
    pub unsafe fn k_ui_show_world_text_ex(n: i32, _p: i32, l: i32, _o: f32, c: i32, s: i32, f: i32) -> i32 {
        rec(format!("textex {n} {l} {c:08x} {s} {f}"))
    }
    pub unsafe fn k_ui_hide_world_text(n: i32) -> i32 { rec(format!("hide {n}")) }
    pub unsafe fn k_world_navigate(_p: i32, l: i32) -> i32 { rec(format!("navigate {l}")); -11 }
    pub unsafe fn k_api_version() -> i32 { 6 }
    pub unsafe fn k_material_set_color(n: i32, s: i32, c: i32) -> i32 { rec(format!("color {n} {s} {c:08x}")) }
    pub unsafe fn k_material_set_emissive(n: i32, s: i32, c: i32, k: f32) -> i32 { rec(format!("glow {n} {s} {c:06x} {k}")) }
    pub unsafe fn k_material_set_opacity(n: i32, s: i32, o: f32) -> i32 { rec(format!("opacity {n} {s} {o}")) }
    pub unsafe fn k_material_reset(n: i32, s: i32) -> i32 { rec(format!("reset {n} {s}")) }
    pub unsafe fn k_texture_set_bundle(n: i32, s: i32, _p: i32, l: i32) -> i32 { rec(format!("picture {n} {s} {l}")) }
}

#[cfg(not(target_arch = "wasm32"))]
pub use imp::*;
