//! Host tests for Mission Control v2 (run single-threaded: the program's state is global).
//!
//! @kosmos-system  Content (KosmosWorlds) -- Mission Control (DB-044 addendum)
//! @kosmos-owner   Content lane
//!
//! `cargo test -- --test-threads=1` (mission-control-tools/build_wasm.ps1 does this).

use super::*;

const PAIR_HEX: &str = "0123456789abcdef0123456789abcdef";
const DT: f32 = 1.0 / 72.0;

fn json_array(src: &str, key: &str) -> Vec<String> {
    let start = src.find(&format!("\"{key}\"")).expect(key);
    let open = start + src[start..].find('[').unwrap();
    let close = open + src[open..].find(']').unwrap();
    src[open + 1..close].split(',').map(|s| s.trim().trim_matches('"').to_string()).filter(|s| !s.is_empty()).collect()
}

/// nodes.json `hue`: [(base, [states])], in file order.
fn json_hue(src: &str) -> Vec<(String, Vec<String>)> {
    let start = src.find("\"hue\"").expect("hue");
    let open = start + src[start..].find('{').unwrap();
    let close = open + src[open..].find('}').unwrap();
    let body = &src[open + 1..close];
    let mut out = Vec::new();
    for chunk in body.split(']') {
        let Some(colon) = chunk.find(':') else { continue };
        let base = chunk[..colon].trim().trim_start_matches(',').trim().trim_matches('"').to_string();
        let states = chunk[colon + 1..]
            .trim()
            .trim_start_matches('[')
            .split(',')
            .map(|s| s.trim().trim_matches('"').to_string())
            .filter(|s| !s.is_empty())
            .collect();
        out.push((base, states));
    }
    out
}

fn reset() {
    host::reset_host();
    unsafe {
        MODE = Mode::Closed;
        STAGE = Stage::Seal;
        TOKEN_LEN = 0;
        PAIR_LEN = 0;
        MINT_IN_FLIGHT = false;
        WATCH_ENDED = false;
        PROMPT_OPEN = 0;
        PROMPT_NODE = [NONE; MAX_PROMPTS];
        VISIBLE = [-1; N_ALL];
        TEXT_HASH = [0; N_TEXT];
        TEXT_LEN = [0; N_TEXT];
        HUE_STATE = [OFF; N_HUE];
        TWEENS = [NO_TWEEN; N_GROUPS];
        SHIFT = [0.0; N_ALL];
        DELTA = [0.0; 3];
        ADJUST = [0.0; 3];
        TURNED = false;
        NOW_S = 0.0;
        POLL_IN_FLIGHT = false;
        NEXT_POLL_AT = 0.0;
        LAST_NET = i32::MIN;
        SECOND_BUZZ_AT = -1.0;
        LAST_Z = -1;
        M_ARC = false;
        ARC_SHOWN = false;
        PICKED = NONE;
        PRESSED_CUBE = NONE;
        LAST_PATH = "";
    }
    k_init();
}

fn h(name: &str) -> i32 {
    unsafe { HANDLES[idx(name)] }
}
fn vis(name: &str) -> bool {
    unsafe { host::VIS[h(name) as usize] == 1 }
}
fn text_on(name: &str) -> bool {
    unsafe { host::TEXT_ON[h(name) as usize] }
}
fn pos(name: &str) -> [f32; 3] {
    unsafe { host::POS[h(name) as usize] }
}
fn scale(name: &str) -> f32 {
    unsafe { host::SCALE[h(name) as usize] }
}
fn fetches() -> i32 {
    unsafe { host::FETCHES }
}
fn body() -> String {
    // The last request written (REQ_BUF up to its first zero past the end is not tracked, so
    // rebuild it the way the program does for a poll).
    let n = build_request(None, &[]);
    unsafe { String::from_utf8(REQ_BUF[..n].to_vec()).unwrap() }
}
fn press(name: &str) {
    on_press(0, h(name), 0, 0);
}
fn run(secs: f32) {
    let n = (secs / DT).ceil() as usize;
    for _ in 0..n {
        k_tick(DT);
    }
}
fn snap(s: &str) {
    apply_snapshot(s.as_bytes());
}
fn close3(a: [f32; 3], b: [f32; 3]) -> bool {
    (0..3).all(|k| (a[k] - b[k]).abs() < 1e-3)
}

fn pair_records() -> String {
    format!(
        "AB1\nV 1000002\nM pair\nI {PAIR_HEX}\nT TxSeal KXT WMP\nT TxSealHint At the PC, type the code on this ring\nH SealRing armed\nU BtnSealType 1\nE pair_wait\n"
    )
}

const PAIRED: &str = "AB1\nV 7\nK tok123\nE paired\nH SealRing locked\nM cubes\nU CubeA 1\nT TxCubeA registry\nH CubeA calm\nU CubeB 1\nT TxCubeB portal\nH CubeB calm\nU CubeC 0\nH CubeC off\nX TxCubeC\nU CubeD 0\nH CubeD off\nU CubePlus 1\nH Puck calm\nX TxPuck\nU BtnPuckApprove 0\nU BtnPuckDeny 0\nZ 0\n";

/// Closed -> seal up -> paired -> the lock animation -> signed in, cubes.
fn sign_in_to_cubes() {
    reset();
    press("McSeal");
    snap(&pair_records());
    snap(PAIRED);
    run(0.6 + 0.35 + 0.4 + 0.1);
    assert_eq!(stage(), Stage::Signed);
}

/// Every arc button and text the face can name, for a full `M arc` render.
fn full_arc_snapshot() -> String {
    let mut s = String::from("AB1\nV 9\nM arc\n");
    for &n in NODES_BUTTON.iter().chain(NODES_SHOW.iter()) {
        if group_by_name(n) == G_ARC {
            s += &format!("U {n} 1\n");
        }
    }
    for &n in NODES_TEXT.iter() {
        if group_by_name(n) == G_ARC {
            s += &format!("T {n} line for {n}\n");
        }
    }
    s
}

#[test]
fn node_names_match_nodes_json() {
    let src = include_str!("../nodes.json");
    let v = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    assert_eq!(json_array(src, "text"), v(&NODES_TEXT));
    assert_eq!(json_array(src, "buttons"), v(&NODES_BUTTON));
    assert_eq!(json_array(src, "show"), v(&NODES_SHOW));
    assert_eq!(json_array(src, "world"), v(&NODES_WORLD));
    let hue = json_hue(src);
    assert_eq!(hue.len(), N_HUE);
    for (k, (base, states)) in hue.iter().enumerate() {
        assert_eq!(base, HUE_BASES[k]);
        assert_eq!(states, &v(HUE_STATES[k]), "{base}");
        for st in states {
            let variant = format!("{base}{}{}", st[..1].to_uppercase(), &st[1..]);
            assert!(NODES_WORLD.contains(&variant.as_str()), "{variant} is a world node");
        }
    }
    for n in NODES_TEXT.iter().chain(&NODES_BUTTON).chain(&NODES_SHOW).chain(&NODES_WORLD) {
        assert!(!n.ends_with(|c: char| c.is_ascii_digit()), "{n}");
    }
    // init_hues resolves every variant.
    reset();
    for k in 0..N_HUE {
        for j in 0..HUE_STATES[k].len() {
            assert_ne!(unsafe { HUE_VARIANT[k][j] }, NONE);
        }
    }
}

#[test]
fn groups_are_decided_by_name() {
    for (n, g) in [
        ("McSeal", G_FIXTURE),
        ("McWatchJoin", G_FIXTURE),
        ("SealRing", G_SEAL),
        ("SealRingLocked", G_SEAL),
        ("TxSeal", G_SEAL),
        ("TxSealHint", G_SEAL),
        ("BtnSealType", G_SEAL),
        ("McSealCancel", G_SEAL),
        ("McLedge", G_LEDGE),
        ("CubePlus", G_LEDGE),
        ("CubeCNeed", G_LEDGE),
        ("TxCubeD", G_LEDGE),
        ("Puck", G_PUCK),
        ("PuckNeed", G_PUCK),
        ("BtnPuckDeny", G_PUCK),
        ("TxPuck", G_PUCK),
        ("TxTicker", G_ARC),
        ("BtnFold", G_ARC),
        ("McClose", G_LEDGE),
        ("McPageDock", G_ARC),
        ("AskPanel", G_ARC),
        ("McCenterFrame", G_ARC),
        ("TxPageSpot", G_ARC),
    ] {
        assert_eq!(group_by_name(n), g, "{n}");
    }
    let arc_texts = NODES_TEXT.iter().filter(|n| group_by_name(n) == G_ARC).count();
    assert_eq!(arc_texts, 24);
    // The arc state shows at most its 24 texts plus TxPuck (cube labels hold back): under 32.
    assert!(arc_texts + 1 <= 29);
}

#[test]
fn closed_means_no_network_call_ever() {
    reset();
    run(3.0);
    press("BtnTests");
    press("CubeA");
    press("BtnPuckApprove");
    press("BtnSealType");
    on_net_result(0, 0, REQ_VIEW, 200);
    snap("AB1\nK stolen\nM arc\nU CubeA 1\n");
    run(1.0);
    assert_eq!(fetches(), 0, "closed: zero calls");
    assert_eq!(unsafe { TOKEN_LEN }, 0, "closed: no token kept");
    assert!(!vis("CubeA") && !vis("SealRing") && !vis("McCenterFrame"), "closed: nothing shows");
    // The Watch post opens a typing sheet, and still nothing is sent...
    press("McWatchJoin");
    assert_eq!(unsafe { host::PROMPTS }, 1);
    // ...and an answer that isn't six digits opens nothing.
    unsafe { PROMPT_ANSWER[..3].copy_from_slice(b"abc"); }
    on_prompt_result(0, 0, REQ_PROMPT_WATCH, 3);
    assert_eq!(mode(), Mode::Closed);
    assert_eq!(fetches(), 0);
}

#[test]
fn the_seal_mints_first_then_polls_pair_about_every_second() {
    reset();
    press("McSeal");
    assert_eq!(mode(), Mode::Owner);
    assert_eq!(fetches(), 1, "the first call");
    assert_eq!(unsafe { LAST_PATH }, PATH_PAIR);
    assert_eq!(unsafe { host::LAST_FETCH_ID }, REQ_PAIR_MINT);
    assert_eq!(body(), "AB1\nv 0\n", "a mint carries no pair id and no token");
    // The ring rises from the seal on the seat: small at first, full size after 0.6 s.
    assert!(vis("SealRing") && vis("McSealCancel"));
    assert!(scale("SealRing") < 0.05);
    assert!(close3(pos("SealRing"), placed(idx("McSeal"))), "it starts at the seal");
    assert!(!vis("McLedge") && !vis("Puck") && !vis("McCenterFrame"));
    on_net_result(0, 0, REQ_PAIR_MINT, 200);
    snap(&pair_records());
    run(0.62);
    assert!((scale("SealRing") - 1.0).abs() < 1e-6);
    assert!(close3(pos("SealRing"), placed(idx("SealRing"))));
    assert!(vis("SealRingArmed") && !vis("SealRingLocked"));
    assert!(text_on("TxSeal") && text_on("TxSealHint"));
    assert!(vis("BtnSealType"));
    // A malformed id is never kept.
    snap("AB1\nI 0123456789ABCDEF0123456789ABCDEF\n");
    assert_eq!(unsafe { &PAIR_ID[..PAIR_LEN] }, PAIR_HEX.as_bytes());
    // Polls: `pair <id>`, one at a time, at least 1.1 s apart.
    let before = fetches();
    let mut sent_at = Vec::new();
    for step in 0..(6.0 / DT) as usize {
        let n = fetches();
        k_tick(DT);
        if fetches() > n {
            sent_at.push(step as f32 * DT);
            assert_eq!(unsafe { LAST_PATH }, PATH_PAIR);
            assert_eq!(body(), format!("AB1\npair {PAIR_HEX}\nv 1000002\n"));
            on_net_result(0, 0, REQ_VIEW, 200); // answered at once ("still pending")
        }
    }
    assert!(fetches() - before >= 4 && fetches() - before <= 6, "{sent_at:?}");
    for w in sent_at.windows(2) {
        assert!(w[1] - w[0] >= VIEW_MIN_GAP_S - 0.02, "{sent_at:?}");
    }
    // Expired: polling stops; the seal mints again when pressed.
    snap("AB1\nM lock\nX TxSeal\nT TxSealHint The code expired. Press the seal again.\nH SealRing off\nE pair_expired\n");
    assert_eq!(unsafe { PAIR_LEN }, 0);
    let n = fetches();
    run(3.0);
    assert_eq!(fetches(), n, "nothing to poll");
    assert!(!vis("SealRingArmed") && !text_on("TxSeal"));
    press("McSeal");
    assert_eq!(fetches(), n + 1);
    assert_eq!(unsafe { LAST_PATH }, PATH_PAIR);
}

#[test]
fn paired_locks_then_the_ledge_and_puck_grow_in() {
    reset();
    press("McSeal");
    snap(&pair_records());
    run(0.7);
    snap(PAIRED);
    assert_eq!(stage(), Stage::Hold);
    assert_eq!(unsafe { &TOKEN[..TOKEN_LEN] }, b"tok123");
    assert_eq!(unsafe { PAIR_LEN }, 0, "the id is dropped once paired");
    assert!(vis("SealRingLocked") && !vis("SealRingArmed"), "the ring shows locked");
    assert!(!vis("McLedge") && !vis("CubeA"), "the ledge waits");
    run(0.6);
    assert_eq!(stage(), Stage::Shrink);
    assert!(!text_on("TxSeal"), "the words go at once");
    run(0.36);
    assert_eq!(stage(), Stage::Grow);
    assert!(!vis("SealRing") && !vis("SealRingLocked") && !vis("BtnSealType"), "the seal is gone");
    assert!(vis("McLedge") && vis("CubeA") && vis("CubeACalm") && vis("CubePlus") && vis("Puck") && vis("PuckCalm"));
    assert!(!vis("CubeC") && !vis("CubeCCalm"), "an empty slot stays empty");
    assert!(!text_on("TxCubeA"), "labels wait for the end");
    assert!(scale("CubeA") < 1.0);
    run(0.42);
    assert_eq!(stage(), Stage::Signed);
    assert!(text_on("TxCubeA") && text_on("TxCubeB"));
    assert!((scale("CubeA") - 1.0).abs() < 1e-6 && close3(pos("CubeA"), placed(idx("CubeA"))));
    assert!(!vis("McCenterFrame"), "cubes: the arc is folded");
    // Polls now go to view, with the token (one went out during the animation).
    assert_eq!(unsafe { LAST_PATH }, PATH_VIEW);
    on_net_result(0, 0, REQ_VIEW, 200);
    let n = fetches();
    run(1.2);
    assert!(fetches() > n);
    assert_eq!(unsafe { LAST_PATH }, PATH_VIEW);
    assert_eq!(body(), "AB1\ntok tok123\nv 7\n");
}

#[test]
fn cancel_closes_and_parks() {
    reset();
    press("McSeal");
    snap(&pair_records());
    run(0.3);
    press("McSealCancel");
    assert_eq!(mode(), Mode::Closed);
    assert_eq!(unsafe { PAIR_LEN }, 0);
    assert!(!vis("SealRing") && !vis("SealRingArmed") && !text_on("TxSeal"));
    let p = pos("SealRing");
    assert!((p[1] - (3.0 - PARK_DROP_M)).abs() < 1.0, "parked again: {p:?}");
    assert!((scale("SealRing") - 1.0).abs() < 1e-6);
    let n = fetches();
    run(3.0);
    assert_eq!(fetches(), n, "closed again: no calls");
}

#[test]
fn use_passphrase_opens_the_typing_sheet_and_signs_in() {
    reset();
    press("McSeal");
    snap(&pair_records());
    run(0.62); // the ring has risen (a moving button is not pressed)
    press("BtnSealType");
    assert_eq!(unsafe { PROMPT_OPEN }, REQ_PROMPT_SEAL);
    let pass = b"correct horse battery staple";
    unsafe { PROMPT_ANSWER[..pass.len()].copy_from_slice(pass); }
    let n = fetches();
    on_prompt_result(0, 0, REQ_PROMPT_SEAL, pass.len() as i32);
    assert_eq!(fetches(), n + 1);
    assert_eq!(unsafe { LAST_PATH }, PATH_SIGNIN);
    let len = build_request(None, pass);
    let sent = unsafe { String::from_utf8(REQ_BUF[..len].to_vec()).unwrap() };
    assert_eq!(sent, format!("AB1\npair {PAIR_HEX}\nv 1000002\n---\ncorrect horse battery staple"));
    snap("AB1\nV 3\nK tok9\nM cubes\nU CubeA 1\n");
    assert_eq!(stage(), Stage::Hold, "the same lock animation");
    // Signed in, the fallback never opens again.
    unsafe { PROMPT_OPEN = 0; }
    press("BtnSealType");
    assert_eq!(unsafe { PROMPT_OPEN }, 0);
    close_panel();
}

#[test]
fn a_cube_unfolds_the_arc_and_fold_reverses_it() {
    sign_in_to_cubes();
    // The press goes to the bridge, naming the cube.
    let n = fetches();
    press("CubeB");
    assert_eq!(fetches(), n + 1);
    assert_eq!(unsafe { LAST_PATH }, PATH_PRESS);
    let len = build_request(Some(idx("CubeB")), &[]);
    let sent = unsafe { String::from_utf8(REQ_BUF[..len].to_vec()).unwrap() };
    assert!(sent.ends_with("press CubeB\n"), "{sent}");
    let origin = placed(idx("CubeB"));

    snap(&full_arc_snapshot());
    assert!(unsafe { ARC_SHOWN });
    assert!(!vis("CubeB") && !vis("CubeBCalm"), "the picked cube became the arc");
    assert!(vis("CubeA"), "the other cubes stay");
    assert!(!text_on("TxCubeA"), "cube labels hold back while the arc is up");
    assert!(vis("McCenterFrame") && vis("BtnFold"));
    assert!(close3(pos("McCenterFrame"), origin), "it starts at the cube");
    assert!(scale("McCenterFrame") < 0.05);
    assert!(!text_on("TxHeader"), "words only at the end");

    run(0.25);
    let target = placed(idx("McCenterFrame"));
    let p = pos("McCenterFrame");
    let s = scale("McCenterFrame");
    assert!(s > 0.2 && s < 0.8, "half way: {s}");
    for k in 0..3 {
        let lo = origin[k].min(target[k]) - 1e-3;
        let hi = origin[k].max(target[k]) + 1e-3;
        assert!(p[k] >= lo && p[k] <= hi, "between the cube and its place: {p:?}");
    }
    assert!(!text_on("TxHeader"));
    run(0.27);
    assert!(close3(pos("McCenterFrame"), target) && (scale("McCenterFrame") - 1.0).abs() < 1e-6);
    assert!(text_on("TxHeader") && text_on("TxConvA") && text_on("TxPageSpot"), "the words show at the end");
    assert!(!vis("CubeB"), "still hidden while open");

    // Fold: words hide at once, the arc shrinks back into the cube, then hides.
    let mut fold = String::from("AB1\nV 10\nM cubes\n");
    for &n in NODES_TEXT.iter() {
        if group_by_name(n) == G_ARC {
            fold += &format!("X {n}\n");
        }
    }
    snap(&fold);
    assert!(!text_on("TxHeader") && !text_on("TxConvA"), "words hide at once");
    assert!(vis("McCenterFrame"), "the arc folds before it hides");
    run(0.2);
    assert!(scale("McCenterFrame") < 0.9);
    run(0.25);
    assert!(!vis("McCenterFrame") && !vis("BtnFold"), "folded away");
    assert!(vis("CubeB") && vis("CubeBCalm") && text_on("TxCubeA"), "the cube and the labels come back");
    assert!((scale("McCenterFrame") - 1.0).abs() < 1e-6, "full size again for next time");
}

#[test]
fn without_a_cube_press_the_arc_unfolds_from_the_ledge_centre() {
    sign_in_to_cubes();
    snap(&full_arc_snapshot());
    assert!(close3(pos("McCenterFrame"), placed(idx("McLedge"))));
    assert!(vis("CubeA") && vis("CubeB"), "no cube was picked");
    close_panel();
}

#[test]
fn host_calls_per_tick_stay_under_200_during_the_animations() {
    sign_in_to_cubes();
    press("CubePlus");
    let mut worst = 0u32;
    let mut measure = |f: &mut dyn FnMut()| {
        let c0 = unsafe { host::CALLS };
        f();
        let c = unsafe { host::CALLS } - c0;
        worst = worst.max(c);
        c
    };
    let full = full_arc_snapshot();
    measure(&mut || snap(&full));
    for _ in 0..((UNFOLD_S + 0.1) / DT) as usize {
        measure(&mut || k_tick(DT));
    }
    let mut fold = String::from("AB1\nV 10\nM cubes\n");
    for &n in NODES_TEXT.iter() {
        if group_by_name(n) == G_ARC {
            fold += &format!("X {n}\n");
        }
    }
    measure(&mut || snap(&fold));
    for _ in 0..((FOLD_S + 0.1) / DT) as usize {
        measure(&mut || k_tick(DT));
    }
    println!("worst frame during unfold/fold: {worst} host calls");
    assert!(worst < 200, "worst frame: {worst} host calls");
    // A steady frame mid-tween only moves the shown arc nodes (position + scale).
    snap(&full);
    k_tick(DT);
    let c0 = unsafe { host::CALLS };
    k_tick(DT);
    let mid = unsafe { host::CALLS } - c0;
    let shown_arc = (0..N_ALL).filter(|&i| group(i) == G_ARC && unsafe { VISIBLE[i] } == 1).count() as u32;
    assert!(mid <= shown_arc * 2 + 4, "{mid} calls for {shown_arc} nodes");
    close_panel();
}

#[test]
fn a_watcher_sees_the_arc_only_never_sends_a_press_or_keeps_a_token() {
    reset();
    press("McWatchJoin");
    unsafe { PROMPT_ANSWER[..7].copy_from_slice(b"296 951"); }
    on_prompt_result(0, 0, REQ_PROMPT_WATCH, 7);
    assert_eq!(mode(), Mode::Watcher);
    assert_eq!(fetches(), 0, "nothing until the first tick");
    run(0.1);
    assert_eq!(unsafe { LAST_PATH }, PATH_WATCH);
    let n = build_request(Some(idx("BtnApprove")), b"typed");
    let sent = unsafe { String::from_utf8(REQ_BUF[..n].to_vec()).unwrap() };
    assert_eq!(sent, "AB1\nwatch 296951\nv 0\n");
    let mut s = full_arc_snapshot();
    s += "K nope\nI 0123456789abcdef0123456789abcdef\nU CubeA 1\nT TxCubeA x\nH CubeA need\nT TxPuck x\nU BtnPuckApprove 1\nH Puck need\nT TxSeal KXT WMP\nH SealRing armed\nU BtnSealType 1\nZ 5\n";
    snap(&s);
    snap("AB1\nV 5\nM arc\nZ 6\n");
    assert_eq!(unsafe { TOKEN_LEN }, 0, "a watcher never keeps a token");
    assert_eq!(unsafe { PAIR_LEN }, 0, "nor a pairing id");
    assert_eq!(unsafe { host::HAPTICS }, 0, "no buzz for a watcher");
    assert!(vis("McCenterFrame") && text_on("TxHeader"), "the arc shows at once (no animation)");
    for n in ["McLedge", "McClose", "CubeA", "CubeANeed", "Puck", "PuckNeed", "BtnPuckApprove", "SealRing", "SealRingArmed", "BtnSealType"] {
        assert!(!vis(n), "{n} never shows for a watcher");
    }
    for n in ["TxCubeA", "TxPuck", "TxSeal"] {
        assert!(!text_on(n), "{n} never shows for a watcher");
    }
    assert!(unsafe { TURNED }, "turned to face the hall");
    assert_eq!(unsafe { host::YAW[h("McCenterFrame") as usize] }, 360.0);
    assert_eq!(unsafe { host::YAW[h("McLedge") as usize] }, 0.0, "only the arc turns");
    let before = fetches();
    press("BtnApprove");
    press("CubeA");
    assert_eq!(fetches(), before, "a watcher's press is never sent");
    // The centre panel sits on the turning axis: a point there stays put sideways, drops to
    // the floor, and the viewer's right flips. Other groups stay parked.
    let q = place(G_ARC, [WATCH_PIVOT_X, 3.0 - PARK_DROP_M, 0.0], 0.5);
    assert!(close3(q, [WATCH_PIVOT_X, 3.0 - WATCH_LOWER_M, 0.5]), "{q:?}");
    let parked = [13.8, 3.0 - PARK_DROP_M, 0.0];
    assert!(close3(place(G_LEDGE, parked, 0.0), parked));
    snap("AB1\nV 6\nE watch_refused\n");
    assert!(unsafe { WATCH_ENDED });
    close_panel();
    assert!(unsafe { !TURNED }, "closing turns it back");
}

#[test]
fn the_bridge_can_not_touch_the_worlds_own_nodes() {
    sign_in_to_cubes();
    snap("AB1\nU McSeal 0\nU McLedge 0\nU Puck 0\nU CubeAIdle 1\nU SealRingArmed 1\nT McClose hi\nO McClose 500\nO McLedge 500\nH McClose calm\nH CubeA purple\nP McSeal hello\n");
    assert!(vis("McLedge") && vis("Puck"), "the world's own nodes are not the bridge's to hide");
    assert!(!vis("CubeAIdle") && !vis("SealRingArmed"), "variants show only through paint");
    assert!(vis("CubeACalm"), "an unknown state changes nothing");
    assert_eq!(unsafe { SHIFT[idx("McClose")] }, 0.0);
    assert_eq!(unsafe { SHIFT[idx("McLedge")] }, 0.0);
    assert!(prompt_slot(idx("McSeal")).is_none());
    close_panel();
}

#[test]
fn paint_shows_one_variant_and_off_hides_all() {
    sign_in_to_cubes();
    paint("CubeA", "need");
    assert!(vis("CubeANeed") && !vis("CubeACalm") && !vis("CubeAIdle"));
    paint("CubeA", "idle");
    assert!(vis("CubeAIdle") && !vis("CubeANeed"));
    paint("CubeA", "off");
    assert!(!vis("CubeAIdle") && !vis("CubeANeed") && !vis("CubeACalm"));
    paint("Puck", "need");
    assert!(vis("PuckNeed") && !vis("PuckCalm"));
    // Two layers: a colour never shows on a base that is hidden.
    snap("AB1\nH CubeB need\nU CubeB 0\n");
    assert!(!vis("CubeB") && !vis("CubeBNeed"));
    snap("AB1\nU CubeB 1\n");
    assert!(vis("CubeBNeed"), "the stored state comes back with its base");
    close_panel();
}

#[test]
fn the_puck_shows_the_oldest_approval_and_buzzes_the_owner_only() {
    sign_in_to_cubes();
    snap("AB1\nV 11\nH CubeA need\nH Puck need\nT TxPuck registry: npm test\nU BtnPuckApprove 1\nU BtnPuckDeny 1\nZ 1\n");
    assert!(vis("PuckNeed") && vis("BtnPuckApprove") && vis("BtnPuckDeny") && text_on("TxPuck"));
    assert!(vis("CubeANeed"));
    assert_eq!(unsafe { host::HAPTICS }, 1);
    assert_eq!(unsafe { host::CHIMES }, 1);
    run(0.3);
    assert_eq!(unsafe { host::HAPTICS }, 2, "the double buzz");
    let n = fetches();
    press("BtnPuckApprove");
    assert_eq!(fetches(), n + 1);
    let len = build_request(Some(idx("BtnPuckApprove")), &[]);
    let sent = unsafe { String::from_utf8(REQ_BUF[..len].to_vec()).unwrap() };
    assert!(sent.starts_with("AB1\ntok tok123\n") && sent.ends_with("press BtnPuckApprove\n"), "{sent}");
    close_panel();
    // Before sign-in a Z rise never buzzes.
    reset();
    press("McSeal");
    snap("AB1\nZ 1\n");
    snap("AB1\nZ 2\n");
    assert_eq!(unsafe { host::HAPTICS }, 0);
}

#[test]
fn signing_out_closes_fully_never_a_blank_ring() {
    for lost in ["E signed_out", "M lock"] {
        sign_in_to_cubes();
        snap(&format!("AB1\nV 12\n{lost}\nX TxCubeA\nU CubeA 0\nH CubeA off\nH Puck off\nX TxSeal\nH SealRing off\nU BtnSealType 1\n"));
        assert_eq!(mode(), Mode::Closed, "{lost}: closed");
        assert_eq!(unsafe { TOKEN_LEN }, 0);
        for n in ["SealRing", "BtnSealType", "McSealCancel", "McLedge", "McClose", "Puck", "McCenterFrame"] {
            assert!(!vis(n), "{lost}: {n} hidden");
        }
        let p = pos("SealRing");
        assert!((p[1] - (3.0 - PARK_DROP_M)).abs() < 1.0, "{lost}: parked: {p:?}");
        let n = fetches();
        run(3.0);
        assert_eq!(fetches(), n, "{lost}: closed means no calls");
        // The seal starts again: it mints.
        press("McSeal");
        assert_eq!(fetches(), n + 1);
        assert_eq!(unsafe { LAST_PATH }, PATH_PAIR);
        close_panel();
    }
    // Before sign-in, M lock (an expired code) keeps the seal up: the hint says what to do.
    reset();
    press("McSeal");
    snap(&pair_records());
    snap("AB1\nM lock\nX TxSeal\nT TxSealHint The code expired. Press the seal again.\nH SealRing off\nE pair_expired\n");
    run(0.62); // the ring's words show once it has risen
    assert_eq!(mode(), Mode::Owner);
    assert!(vis("SealRing") && text_on("TxSealHint"));
    close_panel();
}

#[test]
fn a_failed_mint_says_what_to_do_and_the_seal_mints_again() {
    for status in [0, 429, 502, 503] {
        reset();
        press("McSeal");
        on_net_result(0, 0, REQ_PAIR_MINT, status);
        assert!(unsafe { !MINT_IN_FLIGHT });
        let i = idx("TxSealHint");
        let hint = unsafe { core::str::from_utf8(&TEXT_STORE[i][..TEXT_LEN[i] as usize]).unwrap().to_string() };
        assert!(hint.contains("press the seal again"), "{status}: {hint}");
        let n = fetches();
        press("McSeal");
        assert_eq!(fetches(), n + 1, "{status}: the seal mints again");
        close_panel();
    }
}

#[test]
fn close_is_on_the_ledge_and_the_seal_toggles() {
    sign_in_to_cubes();
    assert!(vis("McClose"), "Close shows with the ledge, the arc folded");
    snap(&full_arc_snapshot());
    run(0.6);
    assert!(vis("McClose"), "and with the arc open");
    press("McClose");
    assert_eq!(mode(), Mode::Closed);
    // The seal press while signed in also closes, signing out on the way.
    sign_in_to_cubes();
    let n = fetches();
    press("McSeal");
    assert_eq!(mode(), Mode::Closed);
    assert_eq!(fetches(), n + 1, "the sign-out press");
    assert_eq!(unsafe { LAST_PATH }, PATH_PRESS);
    assert!(!vis("McClose") && !vis("McLedge"));
    // During the seal (not signed in) Close is not shown: Cancel is.
    press("McSeal");
    assert!(!vis("McClose") && vis("McSealCancel"));
    close_panel();
}

#[test]
fn a_face_button_is_not_pressed_while_its_group_moves() {
    reset();
    press("McSeal");
    snap(&pair_records());
    run(0.7);
    // Paired with an approval already pending: the puck grows in with Approve on it.
    let paired = PAIRED.replace(
        "H Puck calm\nX TxPuck\nU BtnPuckApprove 0\nU BtnPuckDeny 0\n",
        "H Puck need\nT TxPuck registry: run npm test\nU BtnPuckApprove 1\nU BtnPuckDeny 1\n",
    );
    assert_ne!(paired, PAIRED);
    snap(&paired);
    run(0.6 + 0.35 + 0.1);
    assert_eq!(stage(), Stage::Grow);
    assert!(vis("BtnPuckApprove") && !text_on("TxPuck"), "the button grows, its words wait");
    let n = fetches();
    press("BtnPuckApprove");
    assert_eq!(fetches(), n, "no press while the puck grows");
    run(0.4);
    assert!(text_on("TxPuck"));
    press("BtnPuckApprove");
    assert_eq!(fetches(), n + 1, "pressed once its words show");
    // The same for the arc's Approve during the unfold, and during the fold.
    snap(&full_arc_snapshot());
    let n = fetches();
    press("BtnApprove");
    assert_eq!(fetches(), n, "no press during the unfold");
    run(0.55);
    press("BtnApprove");
    assert_eq!(fetches(), n + 1);
    snap("AB1\nM cubes\n");
    press("BtnApprove");
    assert_eq!(fetches(), n + 1, "no press during the fold");
    close_panel();
}

#[test]
fn the_fold_goes_to_the_cube_of_the_job_on_show() {
    sign_in_to_cubes();
    press("CubeA");
    snap(&full_arc_snapshot());
    run(0.55);
    assert!(!vis("CubeA") && vis("CubeB"));
    // Another cube pressed with the arc open: the arc moves to that job, and that cube hides.
    press("CubeB");
    snap(&full_arc_snapshot());
    assert!(vis("CubeA") && !vis("CubeB"), "the picked cube follows the job on show");
    snap("AB1\nM cubes\n");
    assert!(close3(unsafe { FOLD_TO }, placed(idx("CubeB"))), "the fold goes into CubeB");
    run(0.45);
    assert!(vis("CubeB"));
    // The job's cube goes away while the arc is open: the fold goes to the ledge's centre.
    press("CubeA");
    snap(&full_arc_snapshot());
    run(0.55);
    snap("AB1\nU CubeA 0\nH CubeA off\nM cubes\n");
    assert!(close3(unsafe { FOLD_TO }, placed(idx("McLedge"))), "the ledge's centre");
    close_panel();
}

#[test]
fn the_handles_move_the_arc_only() {
    sign_in_to_cubes();
    snap(&full_arc_snapshot());
    run(0.6);
    let ledge = pos("McLedge");
    let frame = pos("McCenterFrame");
    press("McMoveUp");
    assert!((pos("McCenterFrame")[1] - frame[1] - MOVE_STEP_M).abs() < 1e-4);
    assert!(close3(pos("McLedge"), ledge), "the ledge stays at the throne");
    for _ in 0..20 {
        press("McMoveCloser");
    }
    assert!((unsafe { ADJUST[0] } - MOVE_NEAR).abs() < 1e-6, "clamped");
    close_panel();
}

#[test]
fn music_alternates_tracks_like_the_old_program() {
    unsafe { host::AUDIO_PLAYS = 0; }
    music::init();
    assert_eq!(unsafe { host::AUDIO_PLAYS }, 1);
    for _ in 0..(240 * 20) {
        music::tick(0.05);
    }
    assert_eq!(unsafe { host::AUDIO_PLAYS }, 2, "the second track starts after the first's 239.35 s");
    music::shutdown();
}

#[test]
fn numbers_parse() {
    assert_eq!(parse_i32(b"-894"), -894);
    assert_eq!(parse_u32(b"99999999999"), u32::MAX);
    let mut t = TextBuf::new();
    unescape_into(b"a\\nb\\\\c", &mut t);
    assert_eq!(t.as_str(), "a\nb\\c");
    assert!(ease(0.0).abs() < 1e-6 && (ease(1.0) - 1.0).abs() < 1e-6 && (ease(0.5) - 0.5).abs() < 1e-6);
}
