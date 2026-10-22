//! Host tests for Visual Pack Check: every text fits its plaque (plain chrome measured
//! with Roboto's advances at 8 cm, styled samples with Inter's), every styled call is
//! one the host accepts, the node names survive the client's name rules, and the
//! presses drive the calls each check needs.
//!
//! @kosmos-system  Content (KosmosWorlds) -- Visual Pack Check
//! @kosmos-owner   KOS-699 (builder vp-w1)

use crate::app::*;
use crate::buf::Buf;
use crate::host;
use crate::nodes::*;

/// Roboto Regular advances in em, U+0020..U+007E (KosmosWorlds agent-bridge/src/roboto-advance.ts).
const ROBOTO_EM: [f32; 95] = [
    0.1873, 0.1983, 0.2697, 0.4695, 0.4389, 0.5511, 0.4695, 0.1637, 0.2498, 0.2528, 0.3252, 0.4275,
    0.1486, 0.3396, 0.2016, 0.3127, 0.4242, 0.4242, 0.4242, 0.4242, 0.4242, 0.4242, 0.4242, 0.4242,
    0.4242, 0.4242, 0.1902, 0.1932, 0.3826, 0.4242, 0.3944, 0.3584, 0.6744, 0.4765, 0.479, 0.4772,
    0.5103, 0.4157, 0.4157, 0.5103, 0.5302, 0.213, 0.4132, 0.479, 0.4143, 0.6545, 0.5305, 0.5136,
    0.479, 0.525, 0.4794, 0.4606, 0.4507, 0.5099, 0.4765, 0.6486, 0.4765, 0.4765, 0.4507, 0.2031,
    0.3113, 0.2031, 0.3149, 0.3425, 0.2358, 0.4143, 0.4283, 0.3944, 0.4283, 0.3944, 0.248, 0.4283,
    0.4283, 0.1898, 0.195, 0.3863, 0.1898, 0.6586, 0.4283, 0.4283, 0.4283, 0.4283, 0.2638, 0.394,
    0.2539, 0.4283, 0.379, 0.5703, 0.379, 0.379, 0.379, 0.2561, 0.1865, 0.2561, 0.5118,
];
/// Inter 4.x advances in em (measured from a local dry-run copy of Inter-Regular.ttf and
/// Inter-SemiBold.ttf; the sitting imports the official release, which may differ slightly).
const INTER_REGULAR_EM: [f32; 95] = [0.2813, 0.2876, 0.4658, 0.6333, 0.6416, 0.9819, 0.6440, 0.2998, 0.3647, 0.3647, 0.5010, 0.6616, 0.2881, 0.4600, 0.2881, 0.3604, 0.6309, 0.4067, 0.6099, 0.6177, 0.6460, 0.5933, 0.6201, 0.5659, 0.6187, 0.6201, 0.2881, 0.3018, 0.6616, 0.6616, 0.6616, 0.5112, 0.9658, 0.6899, 0.6543, 0.7305, 0.7217, 0.6011, 0.5903, 0.7461, 0.7432, 0.2686, 0.5708, 0.6719, 0.5654, 0.9033, 0.7534, 0.7646, 0.6387, 0.7646, 0.6436, 0.6416, 0.6455, 0.7441, 0.6899, 0.9854, 0.6821, 0.6787, 0.6289, 0.3647, 0.3604, 0.3647, 0.4712, 0.4561, 0.3228, 0.5615, 0.6123, 0.5713, 0.6123, 0.5830, 0.3701, 0.6133, 0.5913, 0.2422, 0.2422, 0.5488, 0.2422, 0.8760, 0.5908, 0.5996, 0.6123, 0.6123, 0.3765, 0.5278, 0.3271, 0.5913, 0.5620, 0.8184, 0.5459, 0.5620, 0.5522, 0.4263, 0.3325, 0.4263, 0.6616];
const INTER_SEMIBOLD_EM: [f32; 95] = [0.2520, 0.3213, 0.5229, 0.6436, 0.6504, 1.0044, 0.6626, 0.3257, 0.3730, 0.3730, 0.5396, 0.6729, 0.3188, 0.4653, 0.3188, 0.3789, 0.6597, 0.4229, 0.6230, 0.6362, 0.6660, 0.6123, 0.6396, 0.5762, 0.6401, 0.6396, 0.3188, 0.3291, 0.6729, 0.6729, 0.6729, 0.5435, 0.9990, 0.7275, 0.6592, 0.7368, 0.7222, 0.6055, 0.5879, 0.7490, 0.7456, 0.2769, 0.5796, 0.7031, 0.5654, 0.9224, 0.7593, 0.7686, 0.6450, 0.7729, 0.6523, 0.6504, 0.6602, 0.7358, 0.7275, 1.0200, 0.7197, 0.7134, 0.6523, 0.3730, 0.3789, 0.3730, 0.4814, 0.4692, 0.3511, 0.5742, 0.6240, 0.5825, 0.6240, 0.5913, 0.3887, 0.6255, 0.6123, 0.2617, 0.2617, 0.5693, 0.2617, 0.9004, 0.6118, 0.6089, 0.6240, 0.6240, 0.3970, 0.5493, 0.3530, 0.6123, 0.5869, 0.8394, 0.5688, 0.5884, 0.5659, 0.4546, 0.3589, 0.4546, 0.6729];

fn width(table: &[f32; 95], line: &str, size_m: f32) -> f32 {
    line.chars()
        .map(|c| {
            let i = c as usize;
            (if (32..127).contains(&i) { table[i - 32] } else { 0.75 }) * size_m
        })
        .sum()
}

/// The widest line of a plain text, at the plain look's 8 cm Roboto.
fn plain_w(t: &str) -> f32 {
    t.split('\n').map(|l| width(&ROBOTO_EM, l, 0.08)).fold(0.0, f32::max)
}

/// The host's own limits on any world text: 1..128 bytes; the 4th line feed onwards becomes a space.
fn fits(t: &str) {
    assert!(!t.is_empty() && t.len() <= 128, "{} bytes: {t:?}", t.len());
    assert!(t.split('\n').count() <= 4, "more than 4 lines: {t:?}");
}

/// A fresh App with handles 1.. for every named node and group member.
fn test_app(page: Page) -> App {
    let mut a = App::new();
    for i in 0..NAMED_COUNT {
        a.named[i] = 1 + i as i32;
    }
    for g in 0..GROUPS.len() {
        for i in 0..GROUPS[g].1 {
            a.groups[g][i] = 1000 + (g * 100 + i) as i32;
        }
    }
    a.page = page;
    a.level = 6;
    a
}

fn calls() -> Vec<String> {
    host::CALLS.with(|c| std::mem::take(&mut *c.borrow_mut()))
}

fn is_btn(n: N) -> bool {
    let name = NAMED[n as usize].0;
    name.starts_with("Btn") || name.starts_with("MrBtn") || n == N::DoorReal || n == N::DoorNowhere
}

fn is_tab(n: N) -> bool {
    matches!(n, N::TabText | N::TabGrid | N::TabColour | N::TabPics | N::TabHover | N::TabTravel)
}

#[test]
fn names_never_end_in_a_digit_and_never_collide() {
    let mut all: Vec<String> = NAMED.iter().map(|(n, _)| n.to_string()).collect();
    let mut nb = [0u8; 16];
    for g in 0..GROUPS.len() {
        for i in 0..GROUPS[g].1 {
            let n = group_name(g, i, &mut nb);
            all.push(String::from_utf8(nb[..n].to_vec()).unwrap());
        }
    }
    for n in &all {
        assert!(!n.chars().last().unwrap().is_ascii_digit(), "{n} ends in a digit");
    }
    let mut sorted = all.clone();
    sorted.sort();
    sorted.dedup();
    assert_eq!(sorted.len(), all.len(), "duplicate names");
    assert!(all.len() < 300, "{} handles; the client registers 512 at most", all.len());
    assert_eq!(group_name(G_CELL, 9, &mut nb), 6);
    assert_eq!(&nb[..6], b"CellBb");
    assert_eq!(group_name(G_BAR, 11, &mut nb), 4);
    assert_eq!(&nb[..4], b"BarL");
}

/// Sets every counter and code on a test App to a worst case.
fn worst(a: &mut App) {
    a.ft_avg_ms = 13.9;
    a.ft_max_ms = 1234.5;
    a.text.plate = false;
    a.text.old_call = true;
    a.text.bad_run = true;
    a.text.bad = [-7; 8];
    a.grid.refused65 = Some(-5);
    a.grid.deep_in = 999;
    a.grid.deep_out = 999;
    let c = &mut a.colour;
    c.c_colour = Some(-7);
    c.c_glow = Some((-6, 0.5));
    c.c_reset = Some(0);
    c.c_fade = Some((-8, 0.3));
    c.c_fade_opaque = Some(-8);
    c.c_glow_unlit = Some(-8);
    c.c_colour_unlit = Some(-8);
    c.c_share = Some(0);
    c.c_chip = Some(0);
    c.clone = 512;
    c.c_clone_pos = Some(-3);
    c.c_clone_colour = Some(-1);
    c.many_made = 256;
    c.many_refused = 256;
    c.many_257 = Some(-5);
    c.many_released = Some(0);
    c.frame_cap = Some((65, -6));
    c.many_phase = MANY_DONE;
    a.pics.show = [Some(-4); 6];
    a.pics.swap = Some(-6);
    a.pics.tint = Some(-8);
    a.pics.reset = Some(0);
    a.pics.missing = Some(-4);
    a.pics.nouv = Some(-8);
    let h = &mut a.hover;
    h.enters = [999, 999];
    h.exits = [999, 999];
    h.bars = 0xFFF;
    h.peak_1s = 20;
    h.peak_3s = 64;
    h.arch = 999;
    h.behind = 999;
    h.others = 999;
    h.go_code = Some((-11, false));
    h.log_n = 4;
    h.log = [(1, 5, 1, 999.9); 4];
    a.travel.looks = [Some(-8); 4];
    a.travel.looks_off = Some(0);
    a.travel.door = Some((-11, true));
    a.travel.newer = Some((0, 0, 1.0));
    a.mrs.c_fade = Some(-8);
    a.missing = 99;
    a.sub_err = -6;
    a.now = 999.0;
    a.last_press = 0.0;
}

/// Every page's texts, in several states: within the host's limits, within the pool,
/// and the plain ones within their plaques.
#[test]
fn every_page_fits() {
    let pages = [Page::Text, Page::Grid, Page::Colour, Page::Pics, Page::Hover, Page::Travel, Page::Mr];
    for &p in &pages {
        for state in 0..3 {
            let mut a = test_app(p);
            a.ft_avg_ms = 13.9;
            a.ft_max_ms = 15.2;
            if state >= 1 {
                worst(&mut a);
            }
            if state == 2 {
                a.hover.go_pending = true;
                a.hover.go_code = None;
                a.last_press = 998.0;
                a.travel.newer = None;
                a.travel.pending = true;
                a.travel.door = Some((0, false));
            }
            let mut v = [Want::new(); MAX_WANTS];
            let mut w = Wants { v: &mut v, n: 0 };
            build_wants(&a, &mut w);
            assert!(w.n <= 64, "{p:?}: {} texts, over the pool of 64", w.n);
            if p == Page::Grid {
                assert_eq!(w.n, 64, "the grid page is exactly 64 texts");
            }
            for x in &w.v[..w.n] {
                let t = x.text.as_str();
                fits(t);
                assert!(!x.text.cut, "{p:?} state {state}: a text was cut at 128 bytes: {t:?}");
                match x.style {
                    None => {
                        let lim = match x.tag {
                            Tag::Named(N::TxtTitle) => W_TITLE,
                            Tag::Named(N::TxtStatus) | Tag::Named(N::TxtStatusB) | Tag::Named(N::MrStatus) | Tag::Named(N::MrTitle) => W_STATUS,
                            Tag::Named(N::TxtLog) => W_LOG,
                            Tag::Named(n) if is_tab(n) => W_TAB,
                            Tag::Named(n) if is_btn(n) => W_BTN,
                            _ => 1.2, // captions over objects: no plaque, kept short
                        };
                        assert!(plain_w(t) <= lim * 0.97, "{p:?} state {state}: {t:?} is {:.3} m on a {lim} m plaque", plain_w(t));
                    }
                    Some(s) => {
                        // Every styled call here is one the host accepts (the refusals are only in bad_values).
                        assert_eq!(s.rgba & 0xFF, 0xFF, "{t:?}: alpha must be FF");
                        assert!(s.size == 0 || (10..=160).contains(&s.size), "{t:?}: size {}", s.size);
                        assert_eq!(s.flags & !(3 | STRONG | PLATE | ENGINE), 0);
                        assert_ne!(s.flags & 3, 3);
                        assert!(!(s.flags & STRONG != 0 && s.flags & ENGINE != 0));
                    }
                }
            }
        }
    }
}

/// K2's cells and header in Inter at their sizes stay inside a 0.32 m cell.
#[test]
fn grid_cells_fit_their_cells() {
    let mut a = test_app(Page::Grid);
    worst(&mut a);
    a.ft_avg_ms = 99.9;
    a.ft_max_ms = 250.0;
    let h = grid_header(&a);
    for l in h.as_str().split('\n') {
        assert!(width(&INTER_REGULAR_EM, l, 0.022) <= 0.30, "{l:?} {}", width(&INTER_REGULAR_EM, l, 0.022));
    }
    for i in 1..64 {
        let t = cell_text(i);
        let s = cell_style(i);
        let table = if s.flags & STRONG != 0 { &INTER_SEMIBOLD_EM } else { &INTER_REGULAR_EM };
        assert!(width(table, t.as_str(), 0.05) <= 0.26, "{:?}", t.as_str());
    }
}

/// K1's 160 mm and 10 mm samples fit their columns (1.0 m apart; left starts and right ends at the column line).
#[test]
fn text_samples_fit_their_columns() {
    let big = width(&INTER_SEMIBOLD_EM, "Ag", 0.16);
    assert!(big < 0.45, "{big}");
    let small = width(&INTER_SEMIBOLD_EM, "10 mm SemiBold, centre", 0.01);
    assert!(small < 0.45, "{small}");
    let def = width(&INTER_REGULAR_EM, "size 0 = 80 mm", 0.08);
    assert!(def < 0.9, "{def}");
    let behind = width(&INTER_SEMIBOLD_EM, "Behind a wall", 0.06);
    assert!(behind < 0.7, "{behind}");
}

#[test]
fn bad_values_send_eight_refusable_calls() {
    let mut a = test_app(Page::Text);
    calls();
    { let h = a.h(N::BtnBadValues); press(&mut a, h); }
    let c = calls();
    let ex: Vec<&String> = c.iter().filter(|s| s.starts_with("textex")).collect();
    assert_eq!(ex.len(), 8);
    assert!(ex[0].ends_with("f3a83afe 40 0"), "{}", ex[0]);
    assert!(ex[1].ends_with(" 9 0"));
    assert!(ex[2].ends_with(" 161 0"));
    assert!(ex[3].ends_with(" 40 20"), "strong + engine: {}", ex[3]);
    assert!(ex[4].ends_with(" 40 3"));
    assert!(ex[5].ends_with(" 40 32"));
    assert!(ex[6].contains(" 129 "), "129 bytes: {}", ex[6]);
    assert!(ex[7].starts_with(&format!("textex {} 0 ", a.h(N::SampDefault))), "empty: {}", ex[7]);
    assert!(a.text.bad_run);
}

/// K6: 256 pairs over four frames (64 a frame), then the 257th on a new pair.
#[test]
fn many_makes_256_then_tries_the_257th() {
    let mut a = test_app(Page::Colour);
    { let h = a.h(N::BtnMany); press(&mut a, h); }
    let c = calls();
    assert!(c.iter().filter(|s| s.starts_with("reset")).count() >= 50, "every look reset first: {}", c.len());
    assert!(c.iter().any(|s| *s == format!("reset {} 0", a.h(N::PicA))), "the pictures too");
    assert!(c.iter().any(|s| *s == format!("reset {} 0", a.g(G_BAR, 0))), "the hover bars too");
    assert!(c.iter().any(|s| *s == format!("reset {} 0", a.h(N::TrvCube))), "the travel looks too");
    tick(&mut a, 1.0 / 72.0);
    assert!(calls().is_empty(), "nothing more in the press's frame");
    for f in 0..4 {
        tick(&mut a, 1.0 / 72.0);
        let c = calls();
        assert_eq!(c.iter().filter(|s| s.starts_with("color")).count(), 64, "frame {f}");
    }
    assert_eq!(a.colour.many_made, 256);
    tick(&mut a, 1.0 / 72.0);
    let c = calls();
    assert_eq!(c, vec![format!("color {} 0 f3a83aff", a.h(N::ColCube))]);
    assert_eq!(a.colour.many_phase, MANY_DONE);
    { let h = a.h(N::BtnMany); press(&mut a, h); }
    assert_eq!(calls().iter().filter(|s| s.starts_with("reset")).count(), 256);
}

/// The 65-writes test makes 65 calls in one press.
#[test]
fn frame_cap_writes_65_times() {
    let mut a = test_app(Page::Colour);
    calls();
    { let h = a.h(N::BtnFrameCap); press(&mut a, h); }
    assert_eq!(calls().iter().filter(|s| s.starts_with("color")).count(), 65);
}

/// K8: colour the source, clone it, move the copy onto its marker.
#[test]
fn clone_colours_the_source_then_copies() {
    let mut a = test_app(Page::Colour);
    calls();
    { let h = a.h(N::BtnClone); press(&mut a, h); }
    let c = calls();
    assert!(c[0].starts_with(&format!("color {} 0 f3a83aff", a.h(N::ColChip))), "{c:?}");
    assert!(c[1].starts_with(&format!("clone {} 0", a.h(N::ColChip))), "{c:?}");
    assert!(c[2].starts_with(&format!("getpos {}", a.h(N::ColChipSpot))), "{c:?}");
    assert!(c[3].starts_with("setpos 900"), "{c:?}");
    assert_eq!(a.colour.clone, 900);
}

/// Hover: per hand counts and the pad's colour by hand.
#[test]
fn hover_counts_per_hand() {
    let mut a = test_app(Page::Hover);
    a.now = 10.0;
    a.last_press = 0.0;
    calls();
    { let h = a.h(N::HoverPad); hover_enter(&mut a, h, 0); }
    { let h = a.h(N::HoverPad); hover_enter(&mut a, h, 1); }
    assert_eq!(a.hover.enters, [1, 1]);
    let c = calls();
    assert!(c.last().unwrap().ends_with("f2f4f8ff"), "both hands: white: {c:?}");
    { let h = a.h(N::HoverPad); hover_exit(&mut a, h, 0); }
    assert!(calls().last().unwrap().ends_with("f3a83aff"), "right hand only: amber");
}

/// Run the hover-then-travel check against the stand-in host, which models the 5 s
/// activation window. `press_at`: the last press; `hover_stamps`: a defective host that
/// lets a hover stamp activation. Returns the status plaque's second and third lines.
fn hover_then_travel(press_at: f32, hover_stamps: bool) -> (String, String, Option<(i32, bool)>) {
    let mut a = test_app(Page::Hover);
    a.last_press = press_at;
    host::STAMP.with(|s| *s.borrow_mut() = press_at);
    a.now = 10.0;
    host::NOW.with(|n| *n.borrow_mut() = a.now);
    if hover_stamps {
        host::STAMP.with(|s| *s.borrow_mut() = a.now);
    }
    { let h = a.h(N::HoverGo); hover_enter(&mut a, h, 1); }
    assert!(a.hover.go_pending);
    assert!(!calls().iter().any(|s| s.starts_with("navigate")), "nothing before the delay");
    for _ in 0..90 {
        tick(&mut a, 1.0 / 72.0);
        host::NOW.with(|n| *n.borrow_mut() = a.now);
    }
    assert!(calls().iter().any(|s| s.starts_with("navigate")), "called within 1.25 s of the Enter");
    let (l2, l3) = go_lines(&a);
    host::STAMP.with(|s| *s.borrow_mut() = -100.0);
    (l2.as_str().to_string(), l3.as_str().to_string(), a.hover.go_code)
}

/// The check is conclusive, and fails, when a hover stamps activation: the call is made 1 s
/// after the Enter, inside the window a stamp would open.
#[test]
fn hover_then_travel_fails_if_hover_stamps_activation() {
    // A correct host, the last press long before: -11, a conclusive pass.
    let (l2, _, code) = hover_then_travel(0.0, false);
    assert_eq!(code, Some((-11, true)));
    assert_eq!(l2, "hover, then travel: -11 (pass)");
    // A defective host whose hover stamps activation: the call answers 0, a conclusive FAIL.
    let (l2, _, code) = hover_then_travel(0.0, true);
    assert_eq!(code, Some((0, true)));
    assert_eq!(l2, "hover, then travel: 0 (FAIL)");
    // A press 1 s before the hover: the press's own window decides, so nothing is concluded,
    // whatever the host does.
    for stamps in [false, true] {
        let (l2, l3, code) = hover_then_travel(9.0, stamps);
        assert_eq!(code.map(|c| c.1), Some(false));
        assert!(l2.starts_with("hover, then travel: INCONCLUSIVE"), "{l2}");
        assert_eq!(l3, "a press was <5 s before: wait");
    }
}

/// Pass labels on the other cards, pinned (the scenario checks them too).
#[test]
fn pass_labels_are_pinned() {
    let mut a = test_app(Page::Pics);
    a.pics.missing = Some(-4);
    a.pics.nouv = Some(0);
    let (s, t) = status_texts(&a);
    assert!(s.as_str().contains("unlisted path -4 (pass)"), "{}", s.as_str());
    assert!(s.as_str().contains("no UV0 0 (expected: see right)"), "{}", s.as_str());
    assert!(t.as_str().contains("DB-045 says -8"), "{}", t.as_str());
    a.pics.missing = Some(0);
    a.pics.nouv = Some(-8);
    let (s, _) = status_texts(&a);
    assert!(s.as_str().contains("unlisted path 0 (FAIL: want -4)"), "{}", s.as_str());
    assert!(s.as_str().contains("no UV0 -8 (DB-045's -8)"), "{}", s.as_str());
    let mut a = test_app(Page::Colour);
    a.colour.many_phase = MANY_DONE;
    a.colour.many_made = 256;
    a.colour.many_257 = Some(-5);
    a.colour.frame_cap = Some((65, -6));
    let (_, t) = status_texts(&a);
    assert!(t.as_str().contains("256: made 256, refused 0 (pass)"), "{}", t.as_str());
    assert!(t.as_str().contains("257th -5 (pass)"), "{}", t.as_str());
    assert!(t.as_str().contains("65 writes: 65th -6 (pass)"), "{}", t.as_str());
    a.colour.many_257 = Some(0);
    a.colour.frame_cap = Some((64, -6));
    let (_, t) = status_texts(&a);
    assert!(t.as_str().contains("257th 0 (FAIL)"), "{}", t.as_str());
    assert!(t.as_str().contains("65 writes: #64 -6 (FAIL)"), "{}", t.as_str());
}

/// The real door: the two writes while the travel is pending.
#[test]
fn the_real_door_writes_while_pending() {
    let mut a = test_app(Page::Travel);
    a.travel.door = Some((0, true));
    a.travel.door_at = 1.0;
    a.travel.pending = true;
    a.now = 1.5;
    calls();
    tick(&mut a, 0.0);
    assert!(a.travel.newer.is_none());
    tick(&mut a, 0.6);
    let c = calls();
    assert!(c.contains(&format!("color {} 0 3ddc84ff", a.h(N::TrvCube))), "{c:?}");
    assert!(c.contains(&format!("reset {} 0", a.h(N::TrvGlow))), "{c:?}");
    assert!(a.travel.newer.is_some());
}

/// Rendering hides what a new page does not want before it shows anything new.
#[test]
fn render_hides_before_it_shows() {
    let mut a = test_app(Page::Text);
    let mut v = [Want::new(); MAX_WANTS];
    calls();
    render(&mut a, &mut v);
    let first = calls();
    assert!(first.iter().all(|s| !s.starts_with("hide")));
    let shown = a.shown_n;
    assert!(shown > 20);
    go_to(&mut a, Page::Grid);
    calls();
    render(&mut a, &mut v);
    let c = calls();
    let first_show = c.iter().position(|s| s.starts_with("text")).unwrap();
    assert_eq!(c[..first_show].iter().filter(|s| s.starts_with("hide")).count(), shown, "every old text hidden before the first new one");
    assert_eq!(a.shown_n, 64);
    // Then the 65th, on a mesh that holds no text (the stand-in answers 0, so the world takes it down again; the client answers -5).
    assert_eq!(a.grid.refused65, Some(0));
    assert_eq!(c.last().unwrap(), &format!("hide {}", a.g(G_DEEP, 0)));
}

#[test]
fn numbers_print() {
    let mut b: Buf<32> = Buf::new();
    b.push_i32(-11).push(" ").push_f1(13.88).push(" ").push_f1(0.04).push(" ").push_i32(i32::MIN);
    assert_eq!(b.as_str(), "-11 13.9 0.0 -2147483648");
}

/// 1.0.1: every plaque's text anchor is "<plaque>Text": unique, a legal node name
/// (no trailing digit), within the 32-byte buffer, and never one of NAMED itself.
#[test]
fn text_anchors_are_named_after_their_plaques() {
    let mut seen: std::vec::Vec<std::string::String> = std::vec::Vec::new();
    for &n in TEXT_ANCHORED {
        let mut b = [0u8; 32];
        let len = text_anchor_name(n, &mut b);
        let name = core::str::from_utf8(&b[..len]).unwrap().to_string();
        assert_eq!(name, std::format!("{}Text", NAMED[n as usize].0));
        assert!(!name.ends_with(|c: char| c.is_ascii_digit()), "{name}");
        assert!(!NAMED.iter().any(|(x, _)| *x == name), "{name} is a named node");
        assert!(!seen.contains(&name), "{name} twice");
        seen.push(name);
    }
    assert_eq!(seen.len(), 43);
}