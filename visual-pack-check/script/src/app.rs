//! Visual Pack Check: the state, the pages, the presses and the hover events.
//!
//! @kosmos-system  Content (KosmosWorlds) -- Visual Pack Check
//! @kosmos-owner   KOS-699 (builder vp-w1)
//!
//! The world is a set of pages, one per group of checks in the DB-045 runbook
//! (docs/DB045_VISUAL_PACK_SITTING_RUNBOOK_v1.0.md section 7.2), chosen with
//! the tabs on the visitor's left:
//!
//!   Text     K1 styled text (each alignment, both weights, 10 mm and 160 mm,
//!            the plate on and off, eight refused values), K3 a wall in front
//!            of a plated text, and the old call on a styled node.
//!   64 texts K2: exactly 64 plated texts (the world's whole pool), the 65th
//!            refused, the frame time, and a 16-level hover tower.
//!   Colour   K5 colour, glow 0.5 / 1.0, fade 0.3, reset, the -8 cases; K6 256
//!            instances and the 257th; the 65th write in a frame; K8 the clone.
//!   Pictures K7: six 1024 x 1024 pictures from assets.images[], swap, tint,
//!            reset, an unlisted path (-4) and a mesh with no UV0 (-8).
//!   Hover    K9: Enter and Exit per hand, the 60 ms rest (thin bars), the 10 a
//!            second cap (a strip of tiles), an arch with a wall behind its hole,
//!            and a hover followed by k_world_navigate (-11).
//!   Travel   K11 and the cancelled-travel restore.
//! The mixed-reality twin has one page (K4): plated texts over passthrough.
//!
//! Every call's return code is shown on a plaque. Everything that is not under
//! test (tabs, buttons, captions, status) uses today's plain look,
//! k_ui_show_world_text, so only the styled samples use the new call.

use crate::buf::{fnv, Buf};
use crate::host;
use crate::nodes::*;

// ---------------------------------------------------------------------------
// Contract constants (client a1936d8)
// ---------------------------------------------------------------------------

pub const ALIGN_C: i32 = 0;
pub const ALIGN_L: i32 = 1;
pub const ALIGN_R: i32 = 2;
pub const STRONG: i32 = 4;
pub const PLATE: i32 = 8;
pub const ENGINE: i32 = 16;

pub const AMBER: u32 = 0xF3A83AFF;
pub const CYAN: u32 = 0x5EE6FFFF;
pub const WHITE: u32 = 0xF2F4F8FF;
pub const GREEN: u32 = 0x3DDC84FF;
pub const TEAL: u32 = 0x2EC4B6FF;
pub const RED: u32 = 0xE5484DFF;
pub const VIOLET: u32 = 0xB497FFFF;
pub const PINK: u32 = 0xFF6FA8FF;
pub const LIME: u32 = 0xC6F25AFF;
pub const SKY: u32 = 0x7FB2FFFF;
pub const WARM: u32 = 0xFFD9A0FF;
/// The eight cell colours of the 64-text grid.
pub const PALETTE: [u32; 8] = [AMBER, CYAN, WHITE, GREEN, VIOLET, PINK, LIME, SKY];

/// The six pictures, in manifest order (assets.images[]).
pub const PICTURES: [&str; 6] = [
    "media/pic-1-png-rgb.png",
    "media/pic-2-png-grey.png",
    "media/pic-3-jpeg-baseline.jpg",
    "media/pic-4-jpeg-progressive.jpg",
    "media/pic-5-jpeg-grey.jpg",
    "media/pic-6-png-rgb.png",
];
/// Not in assets.images[]: k_texture_set_bundle must answer -4.
pub const UNLISTED: &str = "media/not-listed.png";

pub const DOOR_REAL: &str = "world://type-test.micknerks";
pub const DOOR_NOWHERE: &str = "world://visual-pack-nowhere.micknerks";
/// The hover-then-travel target names a world that does not exist, so even a wrong 0 goes nowhere.
pub const HOVER_NOWHERE: &str = "world://visual-pack-hover-nowhere.micknerks";
/// A hover-driven k_world_navigate waits until the last press is this old (the window is 5 s).
pub const PRESS_SETTLE_S: f32 = 6.5;
/// After the real door's k_world_navigate answers 0, the world changes two meshes this much
/// later, while the travel is pending (the "newer value wins" and "a reset stays reset" checks).
pub const PENDING_WRITE_S: f32 = 1.0;

/// Plaque widths in metres, for the plain 8 cm Roboto text on them (tests.rs measures
/// every line against these; ../tools/build_glb.mjs reads them to size the plaques).
pub const W_TAB: f32 = 0.56;
pub const W_BTN: f32 = 0.42;
pub const W_STATUS: f32 = 1.36;
pub const W_TITLE: f32 = 2.5;
pub const W_LOG: f32 = 0.9;

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Page {
    Text,
    Grid,
    Colour,
    Pics,
    Hover,
    Travel,
    Mr,
}

impl Page {
    pub fn mask(self) -> u8 {
        match self {
            Page::Text => P_TEXT,
            Page::Grid => P_GRID,
            Page::Colour => P_COLOUR,
            Page::Pics => P_PICS,
            Page::Hover => P_HOVER,
            Page::Travel => P_TRAVEL,
            Page::Mr => P_MR,
        }
    }
}

/// The tabs, in order: (node, page, label).
pub const TABS: [(N, Page, &str); 6] = [
    (N::TabText, Page::Text, "Text"),
    (N::TabGrid, Page::Grid, "64 texts"),
    (N::TabColour, Page::Colour, "Colour"),
    (N::TabPics, Page::Pics, "Pictures"),
    (N::TabHover, Page::Hover, "Hover"),
    (N::TabTravel, Page::Travel, "Travel"),
];

// ---------------------------------------------------------------------------
// Texts wanted on screen
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Debug)]
pub struct Style {
    pub rgba: u32,
    pub size: i32,
    pub flags: i32,
}

/// Where a show's return code is kept.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Tag {
    None,
    Named(N),
    Cell(u8),
}

#[derive(Clone, Copy)]
pub struct Want {
    pub node: i32,
    pub text: Buf<128>,
    pub style: Option<Style>,
    pub offset: f32,
    pub tag: Tag,
}

impl Want {
    pub const fn new() -> Self {
        Want { node: 0, text: Buf::new(), style: None, offset: 0.0, tag: Tag::None }
    }
    pub fn hash(&self) -> u32 {
        let s = self.style.unwrap_or(Style { rgba: 0, size: -1, flags: -1 });
        fnv(self.text.as_bytes(), &[s.rgba as i32, s.size, s.flags, (self.offset * 1000.0) as i32])
    }
}

pub const MAX_WANTS: usize = 72;

pub struct Wants<'a> {
    pub v: &'a mut [Want],
    pub n: usize,
}

impl<'a> Wants<'a> {
    fn add(&mut self, node: i32, text: &str, style: Option<Style>, offset: f32, tag: Tag) {
        if node <= 0 || self.n >= self.v.len() {
            return;
        }
        let w = &mut self.v[self.n];
        w.node = node;
        w.text.clear();
        w.text.push(text);
        w.style = style;
        w.offset = offset;
        w.tag = tag;
        self.n += 1;
    }
    /// As add, carrying the source buffer's cut flag (the tests fail on a cut text).
    fn add_buf<const M: usize>(&mut self, node: i32, b: &Buf<M>, style: Option<Style>, offset: f32, tag: Tag) {
        let before = self.n;
        self.add(node, b.as_str(), style, offset, tag);
        if self.n > before && b.cut {
            self.v[before].text.cut = true;
        }
    }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[derive(Clone, Copy)]
pub struct TextState {
    pub plate: bool,
    pub old_call: bool,
    /// The eight refused values (alpha FE, 9 mm, 161 mm, strong + engine, align 3, flag 32, 129 bytes, empty).
    pub bad: [i32; 8],
    pub bad_run: bool,
}

#[derive(Clone, Copy)]
pub struct GridState {
    pub refused65: Option<i32>,
    pub deep_in: i32,
    pub deep_out: i32,
}

#[derive(Clone, Copy)]
pub struct ColourState {
    pub colour_i: usize,
    pub glow_i: usize,
    pub fade_low: bool,
    pub c_colour: Option<i32>,
    pub c_glow: Option<(i32, f32)>,
    pub c_reset: Option<i32>,
    pub c_fade: Option<(i32, f32)>,
    pub c_fade_opaque: Option<i32>,
    pub c_glow_unlit: Option<i32>,
    pub c_colour_unlit: Option<i32>,
    pub c_share: Option<i32>,
    pub c_chip: Option<i32>,
    pub clone: i32,
    pub c_clone_pos: Option<i32>,
    pub c_clone_colour: Option<i32>,
    /// 0 idle; 1..=4 making (the next frame's batch); 5 the 257th; 6 made.
    pub many_phase: u8,
    pub many_made: i32,
    pub many_refused: i32,
    pub many_257: Option<i32>,
    pub many_released: Option<i32>,
    pub frame_cap: Option<(i32, i32)>,
}

#[derive(Clone, Copy)]
pub struct PicsState {
    pub show: [Option<i32>; 6],
    pub offset: usize,
    pub swap: Option<i32>,
    pub tint: Option<i32>,
    pub reset: Option<i32>,
    pub missing: Option<i32>,
    pub nouv: Option<i32>,
}

#[derive(Clone, Copy)]
pub struct HoverState {
    pub enters: [i32; 2],
    pub exits: [i32; 2],
    /// What each hand is on now (a node handle, 0 for nothing).
    pub on: [i32; 2],
    pub last_enter_s: [f32; 2],
    pub bars: u16,
    pub arch: i32,
    pub behind: i32,
    pub others: i32,
    /// The last 64 Enter times (newest first) and the most seen in any 1 s and any 3 s.
    pub times: [f32; 64],
    pub times_n: usize,
    pub peak_1s: i32,
    pub peak_3s: i32,
    pub go_pending: bool,
    pub go_code: Option<i32>,
    pub log: [(u8, u8, u8, f32); 4],
    pub log_n: usize,
    pub subs_on: bool,
}

#[derive(Clone, Copy)]
pub struct TravelState {
    pub looks: [Option<i32>; 4],
    pub looks_off: Option<i32>,
    pub door: Option<(i32, bool)>,
    pub door_at: f32,
    pub pending: bool,
    pub newer: Option<(i32, i32, f32)>,
}

#[derive(Clone, Copy)]
pub struct MrState {
    pub plate: bool,
    pub fade_low: bool,
    pub c_fade: Option<i32>,
}

pub struct App {
    pub now: f32,
    pub mr: bool,
    pub page: Page,
    pub level: i32,
    pub missing: i32,
    pub sub_err: i32,
    pub named: [i32; NAMED_COUNT],
    pub groups: [[i32; 64]; 5],
    pub last_press: f32,
    pub shown: [(i32, u32); 64],
    pub shown_n: usize,
    pub named_code: [i32; NAMED_COUNT],
    pub cell_code: [i32; 64],
    pub text_refusals: i32,
    pub last_refusal: i32,
    pub dirty: bool,
    pub next_text_try: f32,
    pub ft_acc: f32,
    pub ft_n: u32,
    pub ft_max: f32,
    pub ft_avg_ms: f32,
    pub ft_max_ms: f32,
    pub hover_subs: [i32; 2],
    pub text: TextState,
    pub grid: GridState,
    pub colour: ColourState,
    pub pics: PicsState,
    pub hover: HoverState,
    pub travel: TravelState,
    pub mrs: MrState,
}

impl App {
    pub const fn new() -> Self {
        App {
            now: 0.0,
            mr: false,
            page: Page::Text,
            level: 0,
            missing: 0,
            sub_err: 0,
            named: [0; NAMED_COUNT],
            groups: [[0; 64]; 5],
            last_press: -100.0,
            shown: [(0, 0); 64],
            shown_n: 0,
            named_code: [1; NAMED_COUNT],
            cell_code: [1; 64],
            text_refusals: 0,
            last_refusal: 0,
            dirty: true,
            next_text_try: 0.0,
            ft_acc: 0.0,
            ft_n: 0,
            ft_max: 0.0,
            ft_avg_ms: 0.0,
            ft_max_ms: 0.0,
            hover_subs: [0; 2],
            text: TextState { plate: true, old_call: false, bad: [1; 8], bad_run: false },
            grid: GridState { refused65: None, deep_in: 0, deep_out: 0 },
            colour: ColourState {
                colour_i: 0,
                glow_i: 0,
                fade_low: false,
                c_colour: None,
                c_glow: None,
                c_reset: None,
                c_fade: None,
                c_fade_opaque: None,
                c_glow_unlit: None,
                c_colour_unlit: None,
                c_share: None,
                c_chip: None,
                clone: 0,
                c_clone_pos: None,
                c_clone_colour: None,
                many_phase: 0,
                many_made: 0,
                many_refused: 0,
                many_257: None,
                many_released: None,
                frame_cap: None,
            },
            pics: PicsState { show: [None; 6], offset: 0, swap: None, tint: None, reset: None, missing: None, nouv: None },
            hover: HoverState {
                enters: [0; 2],
                exits: [0; 2],
                on: [0; 2],
                last_enter_s: [-1.0; 2],
                bars: 0,
                arch: 0,
                behind: 0,
                others: 0,
                times: [-100.0; 64],
                times_n: 0,
                peak_1s: 0,
                peak_3s: 0,
                go_pending: false,
                go_code: None,
                log: [(0, 0, 0, 0.0); 4],
                log_n: 0,
                subs_on: false,
            },
            travel: TravelState { looks: [None; 4], looks_off: None, door: None, door_at: 0.0, pending: false, newer: None },
            mrs: MrState { plate: true, fade_low: false, c_fade: None },
        }
    }

    pub fn h(&self, n: N) -> i32 {
        self.named[n as usize]
    }
    pub fn g(&self, g: usize, i: usize) -> i32 {
        self.groups[g][i]
    }
}

// ---------------------------------------------------------------------------
// Host wrappers
// ---------------------------------------------------------------------------

pub fn find(name: &[u8]) -> i32 {
    unsafe { host::k_node_find(name.as_ptr() as i32, name.len() as i32) }
}
fn show_plain(node: i32, text: &[u8], offset: f32) -> i32 {
    unsafe { host::k_ui_show_world_text(node, text.as_ptr() as i32, text.len() as i32, offset) }
}
fn show_styled(node: i32, text: &[u8], offset: f32, s: Style) -> i32 {
    unsafe { host::k_ui_show_world_text_ex(node, text.as_ptr() as i32, text.len() as i32, offset, s.rgba as i32, s.size, s.flags) }
}
fn hide_text(node: i32) -> i32 {
    unsafe { host::k_ui_hide_world_text(node) }
}
fn set_visible(node: i32, v: bool) -> i32 {
    if node <= 0 {
        return -1;
    }
    unsafe { host::k_node_set_visible(node, v as i32) }
}
pub fn color(node: i32, slot: i32, rgba: u32) -> i32 {
    unsafe { host::k_material_set_color(node, slot, rgba as i32) }
}
pub fn glow(node: i32, slot: i32, rgba: u32, strength: f32) -> i32 {
    unsafe { host::k_material_set_emissive(node, slot, (rgba >> 8) as i32, strength) }
}
pub fn opacity(node: i32, slot: i32, o: f32) -> i32 {
    unsafe { host::k_material_set_opacity(node, slot, o) }
}
pub fn reset(node: i32, slot: i32) -> i32 {
    unsafe { host::k_material_reset(node, slot) }
}
pub fn picture(node: i32, slot: i32, path: &str) -> i32 {
    unsafe { host::k_texture_set_bundle(node, slot, path.as_ptr() as i32, path.len() as i32) }
}
fn navigate(url: &str) -> i32 {
    unsafe { host::k_world_navigate(url.as_ptr() as i32, url.len() as i32) }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/// Find every node, decide VR or MR, subscribe, and show the first page.
pub fn init(a: &mut App, on_press_fn: i32, on_enter_fn: i32, on_exit_fn: i32) {
    a.level = unsafe { host::k_api_version() };
    for (i, (name, _)) in NAMED.iter().enumerate() {
        a.named[i] = find(name.as_bytes());
    }
    let mut nb = [0u8; 16];
    for g in 0..GROUPS.len() {
        for i in 0..GROUPS[g].1 {
            let n = group_name(g, i, &mut nb);
            a.groups[g][i] = find(&nb[..n]);
        }
    }
    a.mr = a.h(N::MrMarker) > 0;
    // Count what this scene should have and did not find.
    a.missing = 0;
    for (i, (_, mask)) in NAMED.iter().enumerate() {
        let here = if a.mr { *mask == P_MR } else { *mask != P_MR };
        if here && a.named[i] <= 0 {
            a.missing += 1;
        }
    }
    if !a.mr {
        for g in 0..GROUPS.len() {
            for i in 0..GROUPS[g].1 {
                if a.groups[g][i] <= 0 {
                    a.missing += 1;
                }
            }
        }
    }

    // OnInteract on everything a visitor might press. The room's own meshes are
    // subscribed too, only so the world knows when the last press was (a press on
    // any mesh opens the 5 s activation window, and the hover-then-travel check
    // must wait until that window has closed).
    let mut targets: [i32; 96] = [0; 96];
    let mut t = 0;
    let mut push = |h: i32| {
        if h > 0 && t < targets.len() {
            targets[t] = h;
            t += 1;
        }
    };
    let named_targets: &[N] = &[
        N::Floor, N::WallFront, N::WallBack, N::WallLeft, N::WallRight, N::Board,
        N::TabText, N::TabGrid, N::TabColour, N::TabPics, N::TabHover, N::TabTravel,
        N::BtnPlate, N::BtnBadValues, N::BtnOldCall, N::GridBoard,
        N::BtnColour, N::BtnGlow, N::BtnResetCube, N::BtnFade, N::BtnTryEight, N::BtnShareA,
        N::BtnClone, N::BtnCloneColour, N::BtnMany, N::BtnFrameCap,
        N::BtnPicShow, N::BtnPicSwap, N::BtnPicTint, N::BtnPicReset, N::BtnPicMissing, N::BtnPicNoUv,
        N::HoverPad, N::HoverGo, N::HoverArch, N::HoverBehind, N::BtnHoverClear,
        N::BtnLooks, N::BtnLooksOff, N::DoorReal, N::DoorNowhere,
        N::MrBtnPlates, N::MrBtnFade,
    ];
    for n in named_targets {
        push(a.h(*n));
    }
    push(a.g(G_DEEP, 0));
    for i in 0..GROUPS[G_BAR].1 {
        push(a.g(G_BAR, i));
    }
    for i in 0..GROUPS[G_RATE].1 {
        push(a.g(G_RATE, i));
    }
    let ev = "OnInteract";
    for &h in &targets[..t] {
        let s = unsafe { host::k_event_subscribe(ev.as_ptr() as i32, ev.len() as i32, h, on_press_fn) };
        if s <= 0 {
            a.sub_err = if s == 0 { -1 } else { s };
        }
    }
    a.hover_subs = [0; 2];
    hover_subscribe(a, on_enter_fn, on_exit_fn);

    a.page = if a.mr { Page::Mr } else { Page::Text };
    apply_visibility(a);
    a.dirty = true;
}

/// Global OnHoverEnter / OnHoverExit (two subscriptions; the world filters by node).
pub fn hover_subscribe(a: &mut App, on_enter_fn: i32, on_exit_fn: i32) {
    let e = "OnHoverEnter";
    let x = "OnHoverExit";
    a.hover_subs[0] = unsafe { host::k_event_subscribe_global(e.as_ptr() as i32, e.len() as i32, on_enter_fn) };
    a.hover_subs[1] = unsafe { host::k_event_subscribe_global(x.as_ptr() as i32, x.len() as i32, on_exit_fn) };
    a.hover.subs_on = a.hover_subs[0] > 0 && a.hover_subs[1] > 0;
    if !a.hover.subs_on {
        a.sub_err = if a.hover_subs[0] <= 0 { a.hover_subs[0] } else { a.hover_subs[1] };
    }
}

pub fn hover_unsubscribe(a: &mut App) {
    for s in a.hover_subs.iter_mut() {
        if *s > 0 {
            unsafe { host::k_event_unsubscribe(*s) };
        }
        *s = 0;
    }
    a.hover.subs_on = false;
}

/// Show the nodes on this page and hide the rest (hiding also turns their collision off).
pub fn apply_visibility(a: &mut App) {
    let m = a.page.mask();
    for (i, (_, mask)) in NAMED.iter().enumerate() {
        if *mask == ROOM || a.named[i] <= 0 {
            continue;
        }
        set_visible(a.named[i], *mask & m != 0);
    }
    for g in 0..GROUPS.len() {
        let on = GROUPS[g].3 & m != 0;
        for i in 0..GROUPS[g].1 {
            set_visible(a.groups[g][i], on);
        }
    }
    if a.colour.clone > 0 {
        set_visible(a.colour.clone, m & P_COLOUR != 0);
    }
}

pub fn go_to(a: &mut App, p: Page) {
    if a.page == p {
        return;
    }
    a.page = p;
    apply_visibility(a);
    if p == Page::Hover {
        // The hover counts start when the page opens (the 64-text page's tower has its own).
        let keep = a.hover.subs_on;
        a.hover = App::new().hover;
        a.hover.subs_on = keep;
    }
    a.dirty = true;
    a.next_text_try = 0.0;
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

pub fn tick(a: &mut App, dt: f32) {
    a.now += dt;
    // Frame time, over one-second windows (k_tick's delta is the frame's).
    a.ft_acc += dt;
    a.ft_n += 1;
    if dt > a.ft_max {
        a.ft_max = dt;
    }
    if a.ft_acc >= 1.0 {
        a.ft_avg_ms = a.ft_acc * 1000.0 / a.ft_n as f32;
        a.ft_max_ms = a.ft_max * 1000.0;
        a.ft_acc = 0.0;
        a.ft_n = 0;
        a.ft_max = 0.0;
        if matches!(a.page, Page::Grid | Page::Colour) {
            a.dirty = true;
        }
    }
    many_step(a);
    // The hover-then-travel check, once the last press is PRESS_SETTLE_S old.
    if a.hover.go_pending && a.now - a.last_press >= PRESS_SETTLE_S {
        a.hover.go_pending = false;
        a.hover.go_code = Some(navigate(HOVER_NOWHERE));
        a.dirty = true;
    }
    // The writes made while the real door's travel is pending.
    if a.travel.pending && a.now - a.travel.door_at >= PENDING_WRITE_S {
        a.travel.pending = false;
        let c = color(a.h(N::TrvCube), 0, GREEN);
        let r = reset(a.h(N::TrvGlow), 0);
        a.travel.newer = Some((c, r, a.now - a.travel.door_at));
        a.dirty = true;
    }
    if a.page == Page::Hover && a.hover.go_pending {
        a.dirty = true; // the countdown
    }
}

// ---------------------------------------------------------------------------
// Presses
// ---------------------------------------------------------------------------

/// Which named node a handle is (None for a group member or an unknown handle).
pub fn named_of(a: &App, h: i32) -> Option<N> {
    if h <= 0 {
        return None;
    }
    (0..NAMED_COUNT).find(|&i| a.named[i] == h).map(|i| unsafe { core::mem::transmute::<u8, N>(i as u8) })
}

pub fn member_of(a: &App, g: usize, h: i32) -> Option<usize> {
    if h <= 0 {
        return None;
    }
    (0..GROUPS[g].1).find(|&i| a.groups[g][i] == h)
}

pub fn press(a: &mut App, node: i32) {
    a.last_press = a.now;
    a.dirty = true;
    if let Some(i) = member_of(a, G_DEEP, node) {
        if i == 0 {
            // The tower's root: hover subscriptions off and on (K2's baseline).
            if a.hover.subs_on {
                hover_unsubscribe(a);
            } else {
                hover_subscribe(a, crate::on_hover_enter as usize as i32, crate::on_hover_exit as usize as i32);
            }
        }
        return;
    }
    if member_of(a, G_BAR, node).is_some() || member_of(a, G_RATE, node).is_some() {
        return; // pressing a hover target does nothing but note the press
    }
    let Some(n) = named_of(a, node) else { return };
    for (tab, page, _) in TABS {
        if n == tab {
            go_to(a, page);
            return;
        }
    }
    match n {
        // --- Text
        N::BtnPlate => a.text.plate = !a.text.plate,
        N::BtnOldCall => a.text.old_call = !a.text.old_call,
        N::BtnBadValues => bad_values(a),
        // --- Grid: any cell goes back
        N::GridBoard => go_to(a, Page::Text),
        // --- Colour
        N::BtnColour => {
            let cs = [AMBER, TEAL, RED, WHITE];
            let c = cs[a.colour.colour_i % 4];
            a.colour.colour_i += 1;
            a.colour.c_colour = Some(color(a.h(N::ColCube), 0, c));
        }
        N::BtnGlow => {
            let ss = [0.5, 1.0, 0.0];
            let s = ss[a.colour.glow_i % 3];
            a.colour.glow_i += 1;
            a.colour.c_glow = Some((glow(a.h(N::ColCube), 0, AMBER, s), s));
        }
        N::BtnResetCube => {
            a.colour.c_reset = Some(reset(a.h(N::ColCube), 0));
            a.colour.colour_i = 0;
            a.colour.glow_i = 0;
        }
        N::BtnFade => {
            a.colour.fade_low = !a.colour.fade_low;
            let o = if a.colour.fade_low { 0.3 } else { 1.0 };
            a.colour.c_fade = Some((opacity(a.h(N::ColBlend), 0, o), o));
        }
        N::BtnTryEight => {
            a.colour.c_fade_opaque = Some(opacity(a.h(N::ColOpaque), 0, 0.3));
            a.colour.c_glow_unlit = Some(glow(a.h(N::ColUnlit), 0, AMBER, 1.0));
            a.colour.c_colour_unlit = Some(color(a.h(N::ColUnlit), 0, TEAL));
        }
        N::BtnShareA => a.colour.c_share = Some(color(a.h(N::ColShareA), 0, TEAL)),
        N::BtnClone => clone_chip(a),
        N::BtnCloneColour => {
            a.colour.c_clone_colour = Some(if a.colour.clone > 0 { color(a.colour.clone, 0, GREEN) } else { -1 });
        }
        N::BtnMany => {
            if a.colour.many_phase == 0 {
                // Free every instance this page made, then make 256 over four frames.
                for n in [N::ColCube, N::ColBlend, N::ColOpaque, N::ColUnlit, N::ColShareA, N::ColShareB, N::ColChip] {
                    reset(a.h(n), 0);
                }
                if a.colour.clone > 0 {
                    reset(a.colour.clone, 0);
                }
                a.colour.many_phase = 1;
                a.colour.many_made = 0;
                a.colour.many_refused = 0;
                a.colour.many_257 = None;
                a.colour.many_released = None;
            } else if a.colour.many_phase == 6 {
                let mut bad = 0;
                for i in 0..64 {
                    for s in 0..TILE_SLOTS {
                        if reset(a.g(G_TILE, i), s) != 0 {
                            bad += 1;
                        }
                    }
                }
                a.colour.many_released = Some(bad);
                a.colour.many_phase = 0;
            }
        }
        N::BtnFrameCap => frame_cap(a),
        // --- Pictures
        N::BtnPicShow => pics_bind(a, false),
        N::BtnPicSwap => {
            a.pics.offset = (a.pics.offset + 1) % 6;
            pics_bind(a, true);
        }
        N::BtnPicTint => {
            let mut worst = 0;
            for (k, p) in [N::PicA, N::PicB, N::PicC, N::PicD, N::PicE, N::PicF].iter().enumerate() {
                let r = color(a.h(*p), 0, if k % 2 == 0 { WARM } else { SKY });
                if r != 0 {
                    worst = r;
                }
            }
            a.pics.tint = Some(worst);
        }
        N::BtnPicReset => {
            let mut worst = 0;
            for p in [N::PicA, N::PicB, N::PicC, N::PicD, N::PicE, N::PicF, N::PicNoUv] {
                let r = reset(a.h(p), 0);
                if r != 0 {
                    worst = r;
                }
            }
            a.pics.reset = Some(worst);
            a.pics.show = [None; 6];
        }
        N::BtnPicMissing => a.pics.missing = Some(picture(a.h(N::PicA), 0, UNLISTED)),
        N::BtnPicNoUv => a.pics.nouv = Some(picture(a.h(N::PicNoUv), 0, PICTURES[0])),
        // --- Hover
        N::BtnHoverClear => {
            let keep = a.hover.subs_on;
            for i in 0..GROUPS[G_BAR].1 {
                reset(a.g(G_BAR, i), 0);
            }
            reset(a.h(N::HoverArch), 0);
            reset(a.h(N::HoverBehind), 0);
            reset(a.h(N::HoverPad), 0);
            a.hover = App::new().hover;
            a.hover.subs_on = keep;
        }
        // --- Travel
        N::BtnLooks => {
            a.travel.looks = [
                Some(color(a.h(N::TrvCube), 0, AMBER)),
                Some(glow(a.h(N::TrvGlow), 0, TEAL, 0.8)),
                Some(opacity(a.h(N::TrvBlend), 0, 0.3)),
                Some(picture(a.h(N::TrvPic), 0, PICTURES[0])),
            ];
        }
        N::BtnLooksOff => {
            let mut worst = 0;
            for n in [N::TrvCube, N::TrvGlow, N::TrvBlend, N::TrvPic] {
                let r = reset(a.h(n), 0);
                if r != 0 {
                    worst = r;
                }
            }
            a.travel.looks_off = Some(worst);
            a.travel.looks = [None; 4];
            a.travel.newer = None;
        }
        N::DoorReal => {
            let r = navigate(DOOR_REAL);
            a.travel.door = Some((r, true));
            a.travel.door_at = a.now;
            a.travel.pending = r == 0;
            a.travel.newer = None;
        }
        N::DoorNowhere => {
            let r = navigate(DOOR_NOWHERE);
            a.travel.door = Some((r, false));
            a.travel.pending = false;
        }
        // --- MR
        N::MrBtnPlates => a.mrs.plate = !a.mrs.plate,
        N::MrBtnFade => {
            a.mrs.fade_low = !a.mrs.fade_low;
            a.mrs.c_fade = Some(opacity(a.h(N::MrFade), 0, if a.mrs.fade_low { 0.4 } else { 1.0 }));
        }
        _ => {}
    }
}

/// K1's refused values: each call names SampDefault with one bad argument; all must be -7.
fn bad_values(a: &mut App) {
    let node = a.h(N::SampDefault);
    let ok = b"bad value";
    let long = [b'x'; 129];
    let s = |rgba: u32, size: i32, flags: i32| Style { rgba, size, flags };
    a.text.bad = [
        show_styled(node, ok, 0.0, s(0xF3A83AFE, 40, 0)),
        show_styled(node, ok, 0.0, s(AMBER, 9, 0)),
        show_styled(node, ok, 0.0, s(AMBER, 161, 0)),
        show_styled(node, ok, 0.0, s(AMBER, 40, STRONG | ENGINE)),
        show_styled(node, ok, 0.0, s(AMBER, 40, 3)),
        show_styled(node, ok, 0.0, s(AMBER, 40, 32)),
        show_styled(node, &long, 0.0, s(AMBER, 40, 0)),
        show_styled(node, b"", 0.0, s(AMBER, 40, 0)),
    ];
    a.text.bad_run = true;
}

/// K8: colour the source chip, then copy it; the copy must start with the authored look.
fn clone_chip(a: &mut App) {
    a.colour.c_chip = Some(color(a.h(N::ColChip), 0, AMBER));
    let name = "ColChipCopy";
    let c = unsafe { host::k_node_clone(a.h(N::ColChip), 0, name.as_ptr() as i32, name.len() as i32) };
    if c > 0 {
        a.colour.clone = c;
        // Move it onto its marker: read the marker's world position, write it to the copy.
        static mut XYZ: [f32; 3] = [0.0; 3];
        let p = core::ptr::addr_of_mut!(XYZ) as *mut f32;
        let g = unsafe { host::k_transform_get_position(a.h(N::ColChipSpot), p as i32, p.wrapping_add(1) as i32, p.wrapping_add(2) as i32) };
        let s = if g == 0 {
            let v = unsafe { *core::ptr::addr_of!(XYZ) };
            unsafe { host::k_transform_set_position(c, v[0], v[1], v[2]) }
        } else {
            g
        };
        a.colour.c_clone_pos = Some(s);
    } else {
        a.colour.c_clone_pos = Some(c);
    }
}

/// K6: 64 (node, slot) pairs a frame for four frames (256), then the 257th on a new pair.
fn many_step(a: &mut App) {
    let p = a.colour.many_phase;
    if (1..=4).contains(&p) {
        let base = (p as usize - 1) * 16;
        for t in base..base + 16 {
            for s in 0..TILE_SLOTS {
                let c = PALETTE[(t + s as usize) % 8];
                let r = color(a.g(G_TILE, t), s, c);
                if r == 0 {
                    a.colour.many_made += 1;
                } else {
                    a.colour.many_refused += 1;
                }
            }
        }
        a.colour.many_phase += 1;
        a.dirty = true;
    } else if p == 5 {
        a.colour.many_257 = Some(color(a.h(N::ColCube), 0, AMBER));
        a.colour.many_phase = 6;
        a.dirty = true;
    }
}

/// The per-frame cap: 65 writes in one frame on one pair; the 65th must be -6. With the 256
/// made, the pair is a tile's (an existing instance), so the instance cap cannot answer first.
fn frame_cap(a: &mut App) {
    let node = if a.colour.many_phase == 6 { a.g(G_TILE, 0) } else { a.h(N::ColShareB) };
    let mut first_bad = 0;
    let mut bad_at = 0;
    for k in 1..=65 {
        let r = color(node, 0, if k % 2 == 0 { PINK } else { LIME });
        if r != 0 && bad_at == 0 {
            first_bad = r;
            bad_at = k;
        }
    }
    a.colour.frame_cap = Some((bad_at, first_bad));
}

fn pics_bind(a: &mut App, swap: bool) {
    let mut worst = 0;
    for (k, p) in [N::PicA, N::PicB, N::PicC, N::PicD, N::PicE, N::PicF].iter().enumerate() {
        let r = picture(a.h(*p), 0, PICTURES[(k + a.pics.offset) % 6]);
        if !swap {
            a.pics.show[k] = Some(r);
        }
        if r != 0 {
            worst = r;
        }
    }
    if swap {
        a.pics.swap = Some(worst);
    }
}

// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------

/// What a hover target is, for the log: 0 other, 1 pad, 2 go, 3 arch, 4 behind, 5 deep, 6 bar, 7 rate.
fn hover_kind(a: &App, node: i32) -> (u8, u8) {
    if node == a.h(N::HoverPad) {
        (1, 0)
    } else if node == a.h(N::HoverGo) {
        (2, 0)
    } else if node == a.h(N::HoverArch) {
        (3, 0)
    } else if node == a.h(N::HoverBehind) {
        (4, 0)
    } else if node == a.g(G_DEEP, 0) {
        (5, 0)
    } else if let Some(i) = member_of(a, G_BAR, node) {
        (6, i as u8)
    } else if let Some(i) = member_of(a, G_RATE, node) {
        (7, i as u8)
    } else {
        (0, 0)
    }
}

fn pad_colour(a: &App) -> Option<u32> {
    let pad = a.h(N::HoverPad);
    match (a.hover.on[0] == pad, a.hover.on[1] == pad) {
        (true, true) => Some(WHITE),
        (true, false) => Some(CYAN),
        (false, true) => Some(AMBER),
        (false, false) => None,
    }
}

fn log_event(a: &mut App, enter: bool, kind: u8, hand: u8) {
    let l = &mut a.hover.log;
    l.copy_within(0..3, 1);
    l[0] = (enter as u8, kind, hand, a.now);
    a.hover.log_n = (a.hover.log_n + 1).min(4);
}

pub fn hover_enter(a: &mut App, node: i32, hand: i32) {
    let hd = if hand == 1 { 1 } else { 0 };
    a.hover.enters[hd] += 1;
    a.hover.on[hd] = node;
    a.hover.last_enter_s[hd] = a.now;
    // The most Enters in any 1 s and any 3 s. The per-world cap is a bucket of 10 a second
    // with bursts of 10: at most 20 in one second from a full bucket, at most 40 in three.
    let t = &mut a.hover.times;
    t.copy_within(0..63, 1);
    t[0] = a.now;
    a.hover.times_n = (a.hover.times_n + 1).min(64);
    let within = |w: f32| a.hover.times[..a.hover.times_n].iter().filter(|&&x| a.now - x < w).count() as i32;
    let (in1, in3) = (within(1.0), within(3.0));
    a.hover.peak_1s = a.hover.peak_1s.max(in1);
    a.hover.peak_3s = a.hover.peak_3s.max(in3);
    let (kind, i) = hover_kind(a, node);
    log_event(a, true, kind, hd as u8);
    match kind {
        1 => {
            if let Some(c) = pad_colour(a) {
                color(node, 0, c);
            }
        }
        2 => {
            a.hover.go_pending = true;
            a.hover.go_code = None;
            if a.now - a.last_press >= PRESS_SETTLE_S {
                a.hover.go_pending = false;
                a.hover.go_code = Some(navigate(HOVER_NOWHERE));
            }
        }
        3 => {
            a.hover.arch += 1;
            color(node, 0, AMBER);
        }
        4 => {
            a.hover.behind += 1;
            color(node, 0, CYAN);
        }
        5 => a.grid.deep_in += 1,
        6 => {
            a.hover.bars |= 1 << i;
            color(node, 0, GREEN);
        }
        7 => {
            color(node, 0, AMBER);
        }
        _ => a.hover.others += 1,
    }
    a.dirty = true;
}

pub fn hover_exit(a: &mut App, node: i32, hand: i32) {
    let hd = if hand == 1 { 1 } else { 0 };
    a.hover.exits[hd] += 1;
    if a.hover.on[hd] == node {
        a.hover.on[hd] = 0;
    }
    let (kind, _) = hover_kind(a, node);
    log_event(a, false, kind, hd as u8);
    match kind {
        1 => {
            match pad_colour(a) {
                Some(c) => color(node, 0, c),
                None => reset(node, 0),
            };
        }
        3 | 4 | 7 => {
            reset(node, 0);
        }
        5 => a.grid.deep_out += 1,
        _ => {}
    }
    a.dirty = true;
}

// ---------------------------------------------------------------------------
// The texts each page wants
// ---------------------------------------------------------------------------

fn code(b: &mut Buf<128>, c: Option<i32>) {
    match c {
        Some(x) => b.push_i32(x),
        None => b.push("-"),
    };
}

fn st(rgba: u32, size: i32, flags: i32) -> Option<Style> {
    Some(Style { rgba, size, flags })
}

const KIND_NAMES: [&str; 8] = ["other", "pad", "go", "arch", "behind", "deep", "bar", "rate"];

/// The page title and its instructions (plain), four lines at most.
pub fn title_text(a: &App) -> Buf<128> {
    let mut b = Buf::new();
    match a.page {
        Page::Text => {
            b.push("Styled text (K1); a wall in front (K3)\nRead it from 2 m, then walk up to it.\nLeft starts at the line; right ends at it.");
        }
        Page::Grid => {}
        Page::Colour => {
            b.push("Colour, glow, fade, reset (K5); 256 (K6); clone (K8)\nGlow is a flat bright colour: no halo.\n");
            b.push("frame ").push_f1(a.ft_avg_ms).push(" ms avg, ").push_f1(a.ft_max_ms).push(" max");
        }
        Page::Pics => {
            b.push("Pictures from the bundle (K7)\nSix at 1024 x 1024: 24 MiB decoded, the budget.\nEach says its number and format, and TOP.");
        }
        Page::Hover => {
            b.push("Hover (K9): point, do not press\nA quick sweep over the bars misses some.\nOpen the menu while pointing: Exit at once.");
        }
        Page::Travel => {
            b.push("Travel (K11), and Cancel restores the looks\nSet the looks, press Door: Type Test,\nthen Cancel in the cover. Check the looks.");
        }
        Page::Mr => {}
    }
    b
}

pub fn status_texts(a: &App) -> (Buf<128>, Buf<128>) {
    let mut s = Buf::new();
    let mut t = Buf::new();
    match a.page {
        Page::Text => {
            let samples = [
                N::SampLeftBigStrong, N::SampLeftBigReg, N::SampLeftSmallStrong, N::SampLeftSmallReg,
                N::SampMidBigStrong, N::SampMidBigReg, N::SampMidSmallStrong, N::SampMidSmallReg,
                N::SampRightBigStrong, N::SampRightBigReg, N::SampRightSmallStrong, N::SampRightSmallReg,
                N::SampDefault, N::SampBehind,
            ];
            let ok = samples.iter().filter(|n| a.named_code[**n as usize] == 0).count();
            let bad = samples.iter().find(|n| a.named_code[**n as usize] < 0).map(|n| a.named_code[*n as usize]);
            s.push("styled shows: ").push_i32(ok as i32).push(" of 14 answered 0");
            if let Some(c) = bad {
                s.push(" (one ").push_i32(c).push(")");
            }
            s.push("\nplates: ").push(if a.text.plate { "on" } else { "off" });
            s.push(", old call: ").push(if a.text.old_call { "on" } else { "off" });
            if a.missing != 0 || a.sub_err != 0 {
                s.push("\nMISSING nodes ").push_i32(a.missing).push(", subscribe ").push_i32(a.sub_err);
            } else {
                s.push("\nevery node found and subscribed");
            }
            s.push("\nlevel ").push_i32(a.level).push(", texts refused ").push_i32(a.text_refusals);
            if a.text_refusals != 0 {
                s.push(" (").push_i32(a.last_refusal).push(")");
            }
            if a.text.bad_run {
                t.push("bad values (all should be -7):\nalpha FE ").push_i32(a.text.bad[0]);
                t.push(", 9 mm ").push_i32(a.text.bad[1]).push(", 161 mm ").push_i32(a.text.bad[2]);
                t.push("\nstrong+Roboto ").push_i32(a.text.bad[3]).push(", align 3 ").push_i32(a.text.bad[4]);
                t.push("\nflag 32 ").push_i32(a.text.bad[5]).push(", 129 B ").push_i32(a.text.bad[6]).push(", empty ").push_i32(a.text.bad[7]);
            } else {
                t.push("Try bad values: eight calls\nwith one bad argument each.\nEvery one should answer -7.");
            }
        }
        Page::Colour => {
            let c = &a.colour;
            s.push("colour ");
            code(&mut s, c.c_colour);
            s.push(", glow ");
            match c.c_glow {
                Some((r, k)) => s.push_i32(r).push(" at ").push_f1(k),
                None => s.push("-"),
            };
            s.push(", reset ");
            code(&mut s, c.c_reset);
            s.push("\nfade ");
            match c.c_fade {
                Some((r, k)) => s.push_i32(r).push(" to ").push_f1(k),
                None => s.push("-"),
            };
            s.push(", shared A ");
            code(&mut s, c.c_share);
            s.push("\n-8 cases: fade opaque ");
            code(&mut s, c.c_fade_opaque);
            s.push(", glow unlit ");
            code(&mut s, c.c_glow_unlit);
            s.push("\ncolour on unlit: ");
            code(&mut s, c.c_colour_unlit);
            t.push("chip ");
            code(&mut t, c.c_chip);
            t.push(", clone ");
            t.push_i32(c.clone);
            t.push(", moved ");
            code(&mut t, c.c_clone_pos);
            t.push(", green ");
            code(&mut t, c.c_clone_colour);
            t.push("\n256: made ").push_i32(c.many_made).push(", refused ").push_i32(c.many_refused);
            t.push("\n257th ");
            code(&mut t, c.many_257);
            t.push(", released ");
            code(&mut t, c.many_released);
            t.push("\n65 in a frame: ");
            match c.frame_cap {
                Some((at, r)) if at > 0 => t.push("write ").push_i32(at).push(" got ").push_i32(r),
                Some(_) => t.push("none refused"),
                None => t.push("-"),
            };
        }
        Page::Pics => {
            let p = &a.pics;
            s.push("show:");
            for k in 0..6 {
                s.push(" ");
                code(&mut s, p.show[k]);
            }
            s.push("\nswap ");
            code(&mut s, p.swap);
            s.push(", tint ");
            code(&mut s, p.tint);
            s.push(", reset ");
            code(&mut s, p.reset);
            s.push("\nunlisted path ");
            code(&mut s, p.missing);
            s.push(" (want -4)");
            s.push("\nno UV0 ");
            code(&mut s, p.nouv);
            s.push(" (want -8)");
            t.push("The pictures were decoded\nunder the loading cover.\nShowing and swapping is a\nquick parameter swap.");
        }
        Page::Hover => {
            let h = &a.hover;
            s.push("left: in ").push_i32(h.enters[0]).push(", out ").push_i32(h.exits[0]);
            s.push("; right: in ").push_i32(h.enters[1]).push(", out ").push_i32(h.exits[1]);
            s.push("\nbars entered: ").push_i32(h.bars.count_ones() as i32).push(" of 12");
            s.push("\nmost Enters: ").push_i32(h.peak_1s).push(" in 1 s, ").push_i32(h.peak_3s).push(" in 3 s");
            s.push("\nhover: ").push(if h.subs_on { "subscribed" } else { "OFF" });
            t.push("arch ").push_i32(h.arch).push(", wall behind ").push_i32(h.behind);
            t.push("\nhover, then travel: ");
            match (h.go_pending, h.go_code) {
                (true, _) => {
                    let left = PRESS_SETTLE_S - (a.now - a.last_press);
                    t.push("in ").push_f1(left.max(0.0)).push(" s")
                }
                (false, Some(c)) => t.push_i32(c).push(if c == -11 { " (pass)" } else { " (FAIL)" }),
                (false, None) => t.push("not yet"),
            };
            t.push("\nlast press ").push_f1(a.now - a.last_press).push(" s ago");
            t.push("\nother targets: ").push_i32(h.others);
        }
        Page::Travel => {
            let v = &a.travel;
            s.push("looks: colour ");
            code(&mut s, v.looks[0]);
            s.push(", glow ");
            code(&mut s, v.looks[1]);
            s.push(", fade ");
            code(&mut s, v.looks[2]);
            s.push("\npicture ");
            code(&mut s, v.looks[3]);
            s.push(", cleared ");
            code(&mut s, v.looks_off);
            s.push("\ndoor: ");
            match v.door {
                Some((r, real)) => s.push(if real { "Type Test " } else { "nowhere " }).push_i32(r),
                None => s.push("-"),
            };
            s.push("\nwhile travelling: ");
            match v.newer {
                Some((c, r, at)) => s.push("green ").push_i32(c).push(", reset ").push_i32(r).push(" at ").push_f1(at),
                None if v.pending => s.push("waiting"),
                None => s.push("-"),
            };
            t.push("After Cancel you should see:\ncube GREEN (the newer value),\nglow mesh as modelled (reset),\npanel faded and the picture back.");
        }
        Page::Grid | Page::Mr => {}
    }
    (s, t)
}

pub fn log_text(a: &App) -> Buf<128> {
    let mut b = Buf::new();
    if a.hover.log_n == 0 {
        b.push("event log: none yet");
    }
    for k in 0..a.hover.log_n {
        let (enter, kind, hand, t) = a.hover.log[k];
        if k > 0 {
            b.push("\n");
        }
        b.push(if enter == 1 { "in  " } else { "out " });
        b.push(KIND_NAMES[kind as usize]).push(if hand == 1 { " R " } else { " L " }).push_f1(t);
    }
    b
}

/// K2's first cell: the summary, at 22 mm (it shares the cell size).
pub fn grid_header(a: &App) -> Buf<128> {
    let mut b = Buf::new();
    b.push("64 texts. 65th: ");
    match a.grid.refused65 {
        Some(c) => b.push_i32(c),
        None => b.push("-"),
    };
    b.push("\n").push_f1(a.ft_avg_ms).push(" ms, max ").push_f1(a.ft_max_ms);
    b.push("\nhover ").push(if a.hover.subs_on { "on" } else { "off" }).push(", deep ");
    b.push_i32(a.grid.deep_in).push("/").push_i32(a.grid.deep_out);
    b.push("\npress: go back");
    b
}

/// A grid cell's own text (cells 1..63): its letters and number.
pub fn cell_text(i: usize) -> Buf<128> {
    let mut b = Buf::new();
    b.push_bytes(&[b'A' + (i / 8) as u8, b'a' + (i % 8) as u8]).push(" ").push_i32(i as i32);
    b
}

pub fn cell_style(i: usize) -> Style {
    let align = [ALIGN_L, ALIGN_C, ALIGN_R][i % 3];
    let strong = if (i / 8) % 2 == 1 { STRONG } else { 0 };
    Style { rgba: PALETTE[i % 8], size: 50, flags: align | strong | PLATE }
}

pub fn build_wants(a: &App, w: &mut Wants) {
    // The chrome (plain), on every VR page but the grid.
    if a.page != Page::Grid && a.page != Page::Mr {
        for (tab, page, label) in TABS {
            let mut b: Buf<32> = Buf::new();
            if page == a.page {
                b.push("> ");
            }
            b.push(label);
            w.add_buf(a.h(tab), &b, None, 0.0, Tag::Named(tab));
        }
        let t = title_text(a);
        w.add_buf(a.h(N::TxtTitle), &t, None, 0.0, Tag::Named(N::TxtTitle));
        let (s, s2) = status_texts(a);
        w.add_buf(a.h(N::TxtStatus), &s, None, 0.0, Tag::Named(N::TxtStatus));
        w.add_buf(a.h(N::TxtStatusB), &s2, None, 0.0, Tag::Named(N::TxtStatusB));
    }
    match a.page {
        Page::Text => {
            let plate = if a.text.plate { PLATE } else { 0 };
            let cols = [(ALIGN_L, "left"), (ALIGN_C, "centre"), (ALIGN_R, "right")];
            let nodes = [
                [N::SampLeftBigStrong, N::SampLeftBigReg, N::SampLeftSmallStrong, N::SampLeftSmallReg],
                [N::SampMidBigStrong, N::SampMidBigReg, N::SampMidSmallStrong, N::SampMidSmallReg],
                [N::SampRightBigStrong, N::SampRightBigReg, N::SampRightSmallStrong, N::SampRightSmallReg],
            ];
            for (c, (align, word)) in cols.iter().enumerate() {
                let [bs, br, ss, sr] = nodes[c];
                if c == 1 && a.text.old_call {
                    // The old call on a styled node puts it back to plain white (VISUAL_PACK.md section 3).
                    w.add(a.h(bs), "Ag", None, 0.0, Tag::Named(bs));
                } else {
                    w.add(a.h(bs), "Ag", st(AMBER, 160, align | STRONG | plate), 0.0, Tag::Named(bs));
                }
                w.add(a.h(br), "Ag", st(CYAN, 160, align | plate), 0.0, Tag::Named(br));
                let mut b: Buf<64> = Buf::new();
                b.push("10 mm SemiBold, ").push(word);
                w.add_buf(a.h(ss), &b, st(WHITE, 10, align | STRONG | plate), 0.0, Tag::Named(ss));
                b.clear();
                b.push("10 mm Regular, ").push(word);
                w.add_buf(a.h(sr), &b, st(WHITE, 10, align | plate), 0.0, Tag::Named(sr));
            }
            w.add(a.h(N::SampDefault), "size 0 = 80 mm", st(VIOLET, 0, ALIGN_C | plate), 0.0, Tag::Named(N::SampDefault));
            w.add(a.h(N::SampBehind), "Behind a wall", st(WHITE, 60, ALIGN_C | STRONG | PLATE), 0.0, Tag::Named(N::SampBehind));
            w.add(a.h(N::CapLeft), "Left aligned", None, 0.0, Tag::Named(N::CapLeft));
            w.add(a.h(N::CapMid), "Centred", None, 0.0, Tag::Named(N::CapMid));
            w.add(a.h(N::CapRight), "Right aligned", None, 0.0, Tag::Named(N::CapRight));
            w.add(a.h(N::BtnPlate), if a.text.plate { "Plates:\non" } else { "Plates:\noff" }, None, 0.0, Tag::Named(N::BtnPlate));
            w.add(a.h(N::BtnBadValues), "Try bad\nvalues", None, 0.0, Tag::Named(N::BtnBadValues));
            w.add(a.h(N::BtnOldCall), "Old call:\ntop middle", None, 0.0, Tag::Named(N::BtnOldCall));
        }
        Page::Grid => {
            for i in 0..64 {
                if i == 0 {
                    let t = grid_header(a);
                    w.add_buf(a.g(G_CELL, 0), &t, st(WHITE, 22, ALIGN_L | PLATE), 0.0, Tag::Cell(0));
                } else {
                    let t = cell_text(i);
                    w.add_buf(a.g(G_CELL, i), &t, Some(cell_style(i)), 0.0, Tag::Cell(i as u8));
                }
            }
        }
        Page::Colour => {
            let labels: [(N, &str); 10] = [
                (N::BtnColour, "Colour\n(cycle)"),
                (N::BtnGlow, "Glow\n0.5 / 1 / 0"),
                (N::BtnResetCube, "Reset\nthe cube"),
                (N::BtnFade, "Fade\n0.3 / 1"),
                (N::BtnTryEight, "Try the\n-8 cases"),
                (N::BtnShareA, "Colour\nshared A"),
                (N::BtnClone, "Clone\nthe chip"),
                (N::BtnCloneColour, "Colour\nthe clone"),
                (N::BtnMany, if a.colour.many_phase == 6 { "256:\nrelease" } else { "256:\nmake" }),
                (N::BtnFrameCap, "65 in\none frame"),
            ];
            for (n, l) in labels {
                w.add(a.h(n), l, None, 0.0, Tag::Named(n));
            }
            let caps: [(N, &str); 7] = [
                (N::ColCube, "Lit cube"),
                (N::ColBlend, "BLEND panel"),
                (N::ColOpaque, "Opaque"),
                (N::ColUnlit, "Unlit"),
                (N::ColShareA, "Shared A"),
                (N::ColShareB, "Shared B"),
                (N::ColChip, "Done chip"),
            ];
            // The objects are 0.28 m apart and a caption is up to 0.42 m wide: alternate heights.
            for (k, (n, l)) in caps.iter().enumerate() {
                w.add(a.h(*n), l, None, if k % 2 == 0 { 0.16 } else { 0.3 }, Tag::Named(*n));
            }
        }
        Page::Pics => {
            let labels: [(N, &str); 6] = [
                (N::BtnPicShow, "Show\npictures"),
                (N::BtnPicSwap, "Swap\npictures"),
                (N::BtnPicTint, "Tint\npictures"),
                (N::BtnPicReset, "Reset\npictures"),
                (N::BtnPicMissing, "Unlisted\npath"),
                (N::BtnPicNoUv, "Mesh with\nno UV0"),
            ];
            for (n, l) in labels {
                w.add(a.h(n), l, None, 0.0, Tag::Named(n));
            }
            w.add(a.h(N::PicNoUv), "No UV0", None, 0.0, Tag::Named(N::PicNoUv));
        }
        Page::Hover => {
            w.add(a.h(N::BtnHoverClear), "Clear\nthe counts", None, 0.0, Tag::Named(N::BtnHoverClear));
            let l = log_text(a);
            w.add_buf(a.h(N::TxtLog), &l, None, 0.0, Tag::Named(N::TxtLog));
            w.add(a.h(N::HoverPad), "Point here", None, 0.0, Tag::Named(N::HoverPad));
            w.add(a.h(N::HoverGo), "Point, then wait", None, 0.0, Tag::Named(N::HoverGo));
            w.add(a.h(N::HoverArch), "Arch", None, 0.45, Tag::Named(N::HoverArch));
            w.add(a.h(N::HoverBehind), "Wall behind", None, 0.0, Tag::Named(N::HoverBehind));
        }
        Page::Travel => {
            let labels: [(N, &str); 4] = [
                (N::BtnLooks, "Set the\nlooks"),
                (N::BtnLooksOff, "Clear the\nlooks"),
                (N::DoorReal, "Door:\nType Test"),
                (N::DoorNowhere, "Door:\nnowhere"),
            ];
            for (n, l) in labels {
                w.add(a.h(n), l, None, 0.0, Tag::Named(n));
            }
            let caps: [(N, &str); 4] = [(N::TrvCube, "Colour"), (N::TrvGlow, "Glow"), (N::TrvBlend, "Fade"), (N::TrvPic, "Picture")];
            for (n, l) in caps {
                w.add(a.h(n), l, None, 0.16, Tag::Named(n));
            }
        }
        Page::Mr => {
            let plate = if a.mrs.plate { PLATE } else { 0 };
            let mut t: Buf<128> = Buf::new();
            t.push("Plates over your room (K4)\nA plate darkens only its own footprint:\nthe room around it is never dimmed.");
            w.add_buf(a.h(N::MrTitle), &t, None, 0.0, Tag::Named(N::MrTitle));
            let mut s: Buf<128> = Buf::new();
            let samples = [N::MrTxtA, N::MrTxtB, N::MrTxtC, N::MrTxtD, N::MrTxtE, N::MrTxtF];
            let ok = samples.iter().filter(|n| a.named_code[**n as usize] == 0).count();
            s.push("styled shows: ").push_i32(ok as i32).push(" of 6 answered 0");
            s.push("\nplates: ").push(if a.mrs.plate { "on" } else { "off" }).push(", fade ");
            code(&mut s, a.mrs.c_fade);
            if a.missing != 0 || a.sub_err != 0 {
                s.push("\nMISSING nodes ").push_i32(a.missing).push(", subscribe ").push_i32(a.sub_err);
            } else {
                s.push("\nlevel ").push_i32(a.level).push(", texts refused ").push_i32(a.text_refusals);
            }
            w.add_buf(a.h(N::MrStatus), &s, None, 0.0, Tag::Named(N::MrStatus));
            let items: [(N, &str, u32, i32, i32); 6] = [
                (N::MrTxtA, "Plate at 20 mm", WHITE, 20, ALIGN_C),
                (N::MrTxtB, "Plate at 40 mm", AMBER, 40, ALIGN_C | STRONG),
                (N::MrTxtC, "80 mm", CYAN, 80, ALIGN_C),
                (N::MrTxtD, "120", GREEN, 120, ALIGN_C | STRONG),
                (N::MrTxtE, "Left on the room", WHITE, 40, ALIGN_L),
                (N::MrTxtF, "Right on the room", PINK, 40, ALIGN_R | STRONG),
            ];
            for (n, txt, c, size, f) in items {
                w.add(a.h(n), txt, st(c, size, f | plate), 0.0, Tag::Named(n));
            }
            w.add(a.h(N::MrBtnPlates), if a.mrs.plate { "Plates:\non" } else { "Plates:\noff" }, None, 0.0, Tag::Named(N::MrBtnPlates));
            w.add(a.h(N::MrBtnFade), "Fade\n0.4 / 1", None, 0.0, Tag::Named(N::MrBtnFade));
            w.add(a.h(N::MrFade), "BLEND panel", None, 0.14, Tag::Named(N::MrFade));
            w.add(a.h(N::MrSolid), "Solid", None, 0.14, Tag::Named(N::MrSolid));
        }
    }
}

// ---------------------------------------------------------------------------
// Showing the texts
// ---------------------------------------------------------------------------

/// Bring the world texts in line with what the page wants: hide what is no longer
/// wanted (first, so the pool has room), then show what changed. A refused show is
/// tried again a second later.
pub fn render(a: &mut App, scratch: &mut [Want]) {
    if !a.dirty || a.now < a.next_text_try {
        return;
    }
    let mut w = Wants { v: scratch, n: 0 };
    build_wants(a, &mut w);
    let n = w.n;
    let wants = &w.v[..n];
    let mut i = 0;
    while i < a.shown_n {
        let node = a.shown[i].0;
        if !wants.iter().any(|x| x.node == node) {
            hide_text(node);
            a.shown[i] = a.shown[a.shown_n - 1];
            a.shown_n -= 1;
        } else {
            i += 1;
        }
    }
    let mut failed = false;
    let mut showed = false;
    for x in wants {
        let h = x.hash();
        let at = (0..a.shown_n).find(|&k| a.shown[k].0 == x.node);
        if let Some(k) = at {
            if a.shown[k].1 == h {
                continue;
            }
        }
        let r = match x.style {
            Some(s) => show_styled(x.node, x.text.as_bytes(), x.offset, s),
            None => show_plain(x.node, x.text.as_bytes(), x.offset),
        };
        showed = true;
        match x.tag {
            Tag::Named(nn) => a.named_code[nn as usize] = r,
            Tag::Cell(c) => a.cell_code[c as usize] = r,
            Tag::None => {}
        }
        if r == 0 {
            match at {
                Some(k) => a.shown[k].1 = h,
                None if a.shown_n < a.shown.len() => {
                    a.shown[a.shown_n] = (x.node, h);
                    a.shown_n += 1;
                }
                None => {}
            }
        } else {
            failed = true;
            a.text_refusals += 1;
            a.last_refusal = r;
        }
    }
    // K2: once all 64 are up, one more styled show on another mesh must be refused (-5).
    if a.page == Page::Grid && a.grid.refused65.is_none() && a.shown_n == 64 {
        let t = b"the 65th";
        let r = show_styled(a.g(G_DEEP, 0), t, 0.0, Style { rgba: WHITE, size: 40, flags: PLATE });
        if r == 0 {
            hide_text(a.g(G_DEEP, 0)); // not expected: the pool let a 65th in; take it down again
        }
        a.grid.refused65 = Some(r);
        a.dirty = true;
        return;
    }
    // A status line counts the codes this pass just got: one more pass picks them up
    // (it shows only what changed, so it settles at once).
    a.dirty = failed || showed;
    if failed {
        a.next_text_try = a.now + 1.0;
    }
}
