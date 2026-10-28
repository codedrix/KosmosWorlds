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
        PENDING_PRESS_ID = 0;
        COMMIT_CUBE = NONE;
        RAIL_SWITCH = false;
        REPLY_ID = 0;
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
/// Mission Control's own calls: every fetch but the Desk board's.
fn mc_fetches() -> i32 {
    unsafe { host::FETCHES - host::BY_ID[REQ_DESK as usize] }
}
fn desk_fetches() -> i32 {
    unsafe { host::BY_ID[REQ_DESK as usize] }
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
/// The bridge's answer to the last press (or call) the world sent.
fn reply(s: &str) {
    apply_reply(unsafe { host::LAST_FETCH_ID }, s.as_bytes());
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
    // Polls now go to view, with the token (one went out during the animation), and the Desk
    // board asked once, as the ledge landed.
    assert!(unsafe { host::BY_ID[REQ_VIEW as usize] } > 0);
    assert_eq!(desk_fetches(), 1);
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

    reply(&full_arc_snapshot());
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
    let q = place(G_ARC, [WATCH_PIVOT_X, 3.0 - PARK_DROP_M, 0.0], 0.5, true);
    assert!(close3(q, [WATCH_PIVOT_X, 3.0 - WATCH_LOWER_M, 0.5]), "{q:?}");
    let parked = [13.8, 3.0 - PARK_DROP_M, 0.0];
    assert!(close3(place(G_LEDGE, parked, 0.0, true), parked));
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
    let n = mc_fetches();
    press("BtnPuckApprove");
    assert_eq!(mc_fetches(), n, "no press while the puck grows");
    run(0.4);
    assert!(text_on("TxPuck"));
    press("BtnPuckApprove");
    assert_eq!(mc_fetches(), n + 1, "pressed once its words show");
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
    reply(&full_arc_snapshot());
    run(0.55);
    assert!(!vis("CubeA") && vis("CubeB"));
    // Another cube pressed with the arc open: the arc moves to that job, and that cube hides.
    press("CubeB");
    reply(&full_arc_snapshot());
    assert!(vis("CubeA") && !vis("CubeB"), "the picked cube follows the job on show");
    snap("AB1\nM cubes\n");
    assert!(close3(unsafe { FOLD_TO }, placed(idx("CubeB"))), "the fold goes into CubeB");
    run(0.45);
    assert!(vis("CubeB"));
    // The job's cube goes away while the arc is open: the fold goes to the ledge's centre.
    press("CubeA");
    reply(&full_arc_snapshot());
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
fn closing_retries_the_sign_out_until_the_host_takes_it() {
    sign_in_to_cubes();
    unsafe { host::REFUSE = 2; } // the first try (in Close) and the next tick's are refused
    let (n, attempts) = (fetches(), unsafe { host::ATTEMPTS });
    press("McClose");
    assert_eq!(mode(), Mode::Closing, "parked, still holding the token for the sign-out");
    assert!(unsafe { TOKEN_LEN } > 0);
    assert!(!vis("McLedge") && !vis("Puck") && !vis("McClose"), "everything parks at once");
    let p = pos("McLedge");
    assert!((p[1] - (3.0 - PARK_DROP_M)).abs() < 1.0, "parked: {p:?}");
    assert_eq!(fetches(), n, "refused, nothing sent yet");
    k_tick(DT);
    assert_eq!(mode(), Mode::Closing);
    k_tick(DT);
    assert_eq!(mode(), Mode::Closed, "the third try went out");
    assert_eq!(fetches(), n + 1);
    assert_eq!(unsafe { host::ATTEMPTS }, attempts + 3);
    assert_eq!(unsafe { LAST_PATH }, PATH_PRESS);
    let len = build_request(Some(idx("BtnSignOut")), &[]);
    let sent = unsafe { String::from_utf8(REQ_BUF[..len].to_vec()).unwrap() };
    assert!(!sent.contains("tok "), "the token is gone after the sign-out went out: {sent}");
    assert_eq!(unsafe { TOKEN_LEN }, 0);
    let attempts = unsafe { host::ATTEMPTS };
    run(3.0);
    press("BtnTests");
    assert_eq!(unsafe { host::ATTEMPTS }, attempts, "Closed makes no call at all");

    // A host that never takes it: after about 5 s the token is dropped anyway, and then silence.
    sign_in_to_cubes();
    unsafe { host::REFUSE = 1_000_000; }
    press("McSeal"); // the seal closes too
    assert_eq!(mode(), Mode::Closing);
    run(CLOSING_MAX_S - 0.2);
    assert_eq!(mode(), Mode::Closing, "still trying");
    run(0.4);
    assert_eq!(mode(), Mode::Closed);
    assert_eq!(unsafe { TOKEN_LEN }, 0);
    let attempts = unsafe { host::ATTEMPTS };
    run(3.0);
    assert_eq!(unsafe { host::ATTEMPTS }, attempts, "no call after Closed");
    unsafe { host::REFUSE = 0; }
}

#[test]
fn a_cube_press_commits_only_through_a_reply_that_takes_it() {
    sign_in_to_cubes();
    press("CubeA");
    reply(&full_arc_snapshot());
    run(0.55);
    assert!(!vis("CubeA"));
    // Stale: the bridge answers the current render with E stale; nothing changes.
    press("CubeB");
    reply(&(full_arc_snapshot() + "E stale\n"));
    assert!(!vis("CubeA") && vis("CubeB"), "a stale press changes nothing");
    assert!(close3(unsafe { FOLD_TO }, placed(idx("CubeA"))));
    // Lost: no answer (status 0), then a poll; nothing changes.
    press("CubeB");
    on_net_result(0, 0, unsafe { host::LAST_FETCH_ID }, 0);
    snap(&full_arc_snapshot());
    assert!(!vis("CubeA") && vis("CubeB"), "a lost press changes nothing");
    // A poll that lands before the press's own reply does not commit it either...
    press("CubeB");
    snap(&full_arc_snapshot());
    assert!(!vis("CubeA") && vis("CubeB"));
    // ...the reply that takes it does.
    reply(&full_arc_snapshot());
    assert!(vis("CubeA") && !vis("CubeB"));
    assert!(close3(unsafe { FOLD_TO }, placed(idx("CubeB"))));
    close_panel();
    // Folded: a refused cube press leaves the unfold to the ledge's centre.
    sign_in_to_cubes();
    press("CubeB");
    reply(&(full_arc_snapshot() + "E refused\n"));
    assert!(close3(pos("McCenterFrame"), placed(idx("McLedge"))), "unfolds from the ledge's centre");
    assert!(vis("CubeB"));
    close_panel();
}

#[test]
fn the_unfold_comes_from_the_pressed_cube_when_the_poll_lands_first() {
    // The bridge's press handler wakes the view poll with the same M arc (correctness review 3,
    // HIGH-2): the poll's reply reaches the world before the press's own.
    sign_in_to_cubes();
    press("CubeB");
    let press_id = unsafe { host::LAST_FETCH_ID };
    snap(&full_arc_snapshot()); // the poll's reply (REPLY_ID 0)
    assert!(unsafe { ARC_SHOWN });
    assert!(close3(pos("McCenterFrame"), placed(idx("CubeB"))), "unfolds from the pressed cube");
    assert!(!vis("CubeB"), "the pressed cube hides at once");
    run(0.2);
    apply_reply(press_id, full_arc_snapshot().as_bytes()); // then the press's own reply
    assert!(!vis("CubeB") && vis("CubeA"));
    assert_eq!(unsafe { PICKED }, idx("CubeB"));
    run(0.4);
    snap("AB1\nM cubes\n");
    assert!(close3(unsafe { FOLD_TO }, placed(idx("CubeB"))), "and folds back into it");
    close_panel();
}

#[test]
fn the_unfold_comes_from_the_pressed_cube_when_the_press_reply_lands_first() {
    sign_in_to_cubes();
    press("CubeB");
    reply(&full_arc_snapshot()); // the press's own reply first
    assert!(close3(pos("McCenterFrame"), placed(idx("CubeB"))), "unfolds from the pressed cube");
    assert!(!vis("CubeB"));
    snap(&full_arc_snapshot()); // then the poll's
    assert!(!vis("CubeB") && unsafe { PICKED } == idx("CubeB"));
    close_panel();
    // CubePlus the same way.
    sign_in_to_cubes();
    press("CubePlus");
    snap(&full_arc_snapshot());
    assert!(close3(pos("McCenterFrame"), placed(idx("CubePlus"))));
    assert!(!vis("CubePlus"));
    close_panel();
}

#[test]
fn a_refused_or_stale_cube_press_never_moves_the_unfold() {
    // The poll opens the arc from the pending cube, then the press's reply refuses it: the cube
    // shows again and the fold goes to the ledge's centre.
    sign_in_to_cubes();
    press("CubeB");
    let press_id = unsafe { host::LAST_FETCH_ID };
    snap(&full_arc_snapshot());
    assert!(!vis("CubeB"));
    apply_reply(press_id, (full_arc_snapshot() + "E stale\n").as_bytes());
    assert!(vis("CubeB"), "the refused cube shows again");
    assert_eq!(unsafe { PICKED }, NONE);
    assert!(close3(unsafe { FOLD_TO }, placed(idx("McLedge"))));
    close_panel();
    // No answer to the press (status 0): the same.
    sign_in_to_cubes();
    press("CubeB");
    let press_id = unsafe { host::LAST_FETCH_ID };
    on_net_result(0, 0, press_id, 0);
    snap(&full_arc_snapshot());
    assert!(close3(pos("McCenterFrame"), placed(idx("McLedge"))), "a lost press leaves the ledge's centre");
    assert!(vis("CubeB"));
    close_panel();
    // A pending pick that outlives its timeout is not used.
    sign_in_to_cubes();
    press("CubeB");
    run(PICK_TIMEOUT_S + 0.2);
    snap(&full_arc_snapshot());
    assert!(close3(pos("McCenterFrame"), placed(idx("McLedge"))), "a stale pick times out");
    close_panel();
    // Close clears it.
    sign_in_to_cubes();
    press("CubeB");
    press("McClose");
    assert_eq!(unsafe { PENDING_PICK }, NONE);
}

#[test]
fn the_seal_rings_turn_slowly_one_call_a_frame() {
    reset();
    press("McSeal");
    snap(&pair_records());
    let h = h("SealRing") as usize;
    run(0.7); // the ring has risen (no spin while it moves)
    let r0 = unsafe { host::ROLL[h] };
    let c0 = unsafe { host::CALLS };
    k_tick(DT);
    let per_tick = unsafe { host::CALLS } - c0;
    assert!(per_tick <= 2, "a quiet seal frame costs the spin and nothing more: {per_tick}");
    run(1.0);
    let turned = unsafe { host::ROLL[h] } - r0;
    assert!((turned - SEAL_SPIN_DEG_S * (1.0 + DT)).abs() < 0.5, "about 6 degrees a second: {turned}");
    // Steady: equal steps, never back and forth.
    let mut last = unsafe { host::ROLL[h] };
    for _ in 0..30 {
        k_tick(DT);
        let now = unsafe { host::ROLL[h] };
        let step = (now - last + 360.0) % 360.0;
        assert!((step - SEAL_SPIN_DEG_S * DT).abs() < 1e-3, "{step}");
        last = now;
    }
    // Signed in, the ring is gone and nothing turns.
    snap(PAIRED);
    run(1.6);
    let r1 = unsafe { host::ROLL[h] };
    run(1.0);
    assert_eq!(unsafe { host::ROLL[h] }, r1, "no spin once the seal is down");
    close_panel();
    let r2 = unsafe { host::ROLL[h] };
    run(1.0);
    assert_eq!(unsafe { host::ROLL[h] }, r2, "no spin while closed");
}

#[test]
fn a_rail_press_folds_to_the_ledge_centre() {
    sign_in_to_cubes();
    press("CubeA");
    reply(&full_arc_snapshot());
    run(0.55);
    assert!(!vis("CubeA"));
    // The left panel moves the arc to another job; the face doesn't name that job's cube.
    press("RailB");
    reply(&full_arc_snapshot());
    assert!(vis("CubeA"), "the cube the arc came from shows again");
    assert_eq!(unsafe { PICKED }, NONE);
    snap("AB1\nM cubes\n");
    assert!(close3(unsafe { FOLD_TO }, placed(idx("McLedge"))), "the fold goes to the ledge's centre");
    // A refused rail press changes nothing.
    run(0.5);
    press("CubeA");
    reply(&full_arc_snapshot());
    run(0.55);
    press("RailB");
    reply(&(full_arc_snapshot() + "E stale\n"));
    assert!(!vis("CubeA"));
    close_panel();
}

/// Every point of an arc part on a grid (independent of `arc_clear`'s separating axes).
fn part_points(p: &[f32; 7], a: [f32; 3]) -> Vec<[f32; 3]> {
    let yaw = p[6].to_radians();
    let (u, v) = ([yaw.cos(), yaw.sin()], [-yaw.sin(), yaw.cos()]);
    let mut out = Vec::new();
    let steps = |n: usize| (0..=n).map(move |k| -1.0 + 2.0 * k as f32 / n as f32);
    for sd in steps(2) {
        for sw in steps(40) {
            for sh in steps(30) {
                let dx = p[3] * sd * u[0] + p[4] * sw * v[0];
                let dy = p[3] * sd * u[1] + p[4] * sw * v[1];
                out.push([p[0] + dx - a[0], p[1] + dy - a[2], p[2] + p[5] * sh + a[1]]);
            }
        }
    }
    out
}

#[test]
fn no_reachable_handle_setting_puts_the_arc_into_the_ledge_or_the_puck() {
    sign_in_to_cubes();
    snap(&full_arc_snapshot());
    run(0.6);
    // Breadth-first over every setting the six handles can reach from the start.
    let key = |a: [f32; 3]| ((a[0] * 100.0).round() as i32, (a[1] * 100.0).round() as i32, (a[2] * 100.0).round() as i32);
    let mut seen = std::collections::HashSet::new();
    let mut queue = vec![[0.0f32; 3]];
    seen.insert(key([0.0; 3]));
    let handles = ["McMoveCloser", "McMoveFarther", "McMoveUp", "McMoveDown", "McMoveLeft", "McMoveRight"];
    let mut reached = Vec::new();
    while let Some(a) = queue.pop() {
        reached.push(a);
        for h in handles {
            unsafe { ADJUST = a; }
            press(h);
            let b = unsafe { ADJUST };
            if seen.insert(key(b)) {
                queue.push(b);
            }
        }
    }
    assert!(reached.len() > 500, "the handles still reach a lot: {}", reached.len());
    for a in &reached {
        for p in ARC_PARTS.iter() {
            for q in part_points(p, *a) {
                for k in KEEP_OUT.iter() {
                    let inside = (0..3).all(|i| q[i] > k[i] && q[i] < k[i + 3]);
                    assert!(!inside, "ADJUST {a:?} puts {q:?} inside {k:?}");
                }
            }
        }
    }
    // Each extreme on its own is still reachable.
    let has = |t: [f32; 3]| reached.iter().any(|a| key(*a) == key(t));
    assert!(has([MOVE_NEAR, 0.0, 0.0]) && has([-MOVE_FAR, 0.0, 0.0]));
    assert!(has([0.0, -MOVE_UPDOWN, 0.0]) && has([0.0, MOVE_UPDOWN, 0.0]));
    assert!(has([0.0, 0.0, MOVE_SIDE]) && has([0.0, 0.0, -MOVE_SIDE]));
    // The review's corner (all the way near, all the way sideways, one step down) is not.
    assert!(!has([MOVE_NEAR, -MOVE_STEP_M, MOVE_SIDE]));
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


/// Every handle setting the six handles can reach from the start (breadth-first), each one
/// reached by pressing a handle, as the owner would.
fn reach_every_handle_setting(mut each: impl FnMut([f32; 3])) -> usize {
    let key = |a: [f32; 3]| ((a[0] * 100.0).round() as i32, (a[1] * 100.0).round() as i32, (a[2] * 100.0).round() as i32);
    let mut seen = std::collections::HashSet::new();
    let mut queue = vec![[0.0f32; 3]];
    seen.insert(key([0.0; 3]));
    let handles = ["McMoveCloser", "McMoveFarther", "McMoveUp", "McMoveDown", "McMoveLeft", "McMoveRight"];
    let mut n = 0;
    while let Some(a) = queue.pop() {
        n += 1;
        for hd in handles {
            // Back to setting a, as if reached by presses (the program syncs the ring on each).
            unsafe { ADJUST = a; }
            sync_node(FLOOR_I);
            press(hd);
            let b = unsafe { ADJUST };
            each(b);
            if seen.insert(key(b)) {
                queue.push(b);
            }
        }
    }
    n
}

#[test]
fn the_floor_ring_stays_on_the_hall_floor_whatever_the_handles_do() {
    assert_eq!(node_name(FLOOR_I), "McFloorRing", "FLOOR_I is nodes.json's last world-only node");
    sign_in_to_cubes();
    snap(&full_arc_snapshot());
    run(0.6);
    assert!(vis("McFloorRing"), "the ring shows with the arc open and the handles at rest");
    let home = pos("McFloorRing");
    assert!(close3(home, placed(FLOOR_I)));
    let centre = pos("McCenterFrame");
    let (mut shown, mut hidden) = (0, 0);
    let n = reach_every_handle_setting(|a| {
        assert!(close3(pos("McFloorRing"), home), "ADJUST {a:?} moved the floor ring to {:?}", pos("McFloorRing"));
        assert!(close3(placed(FLOOR_I), home), "ADJUST {a:?} would place the floor ring elsewhere");
        assert_eq!(vis("McFloorRing"), floor_clear(a), "ADJUST {a:?}: the ring shows exactly when nothing stacks over it");
        if vis("McFloorRing") { shown += 1 } else { hidden += 1 }
    });
    assert!(n > 500, "the handles still reach a lot: {n}");
    assert!(shown > 100 && hidden > 0, "shown {shown}, hidden {hidden}");
    // The handles do move the rest of the arc.
    unsafe { ADJUST = [0.0; 3]; }
    press("McMoveUp");
    assert!(pos("McCenterFrame")[1] > centre[1] + 0.1 && close3(pos("McFloorRing"), home));
    press("McMoveDown");
    // It still folds and unfolds with the arc.
    let mut fold = String::from("AB1\nV 10\nM cubes\n");
    fold += "U CubeA 1\n";
    snap(&fold);
    run(0.2);
    assert!(scale("McFloorRing") < 1.0, "the ring folds with the arc");
    run(0.6);
    assert!(!vis("McFloorRing"), "folded away");
    close_panel();
    // A watcher never shows it: a_watcher_through_the_wire_never_sees_the_floor_ring_or_an_owner_node.
}

/// The real watch path (the Watch post, the typed code, `watch` polls answered through
/// apply_snapshot): every frame, the floor ring and every owner-only node stay hidden, the
/// host is never told to show them, and the arc itself shows.
#[test]
fn a_watcher_through_the_wire_never_sees_the_floor_ring_or_an_owner_node() {
    reset();
    press("McWatchJoin");
    unsafe { PROMPT_ANSWER[..7].copy_from_slice(b"412 892"); }
    on_prompt_result(0, 0, REQ_PROMPT_WATCH, 7);
    assert_eq!(mode(), Mode::Watcher);
    let owner_only: Vec<usize> = (0..N_ALL).filter(|&i| group(i) != G_ARC && !is_fixture(i)).collect();
    assert!(owner_only.len() > 30, "the seal, ledge and puck groups: {}", owner_only.len());
    let check = |when: &str| {
        let ring = unsafe { host::VIS[h("McFloorRing") as usize] };
        assert!(ring != 1, "{when}: the floor ring was shown to a watcher");
        for &i in &owner_only {
            let hd = unsafe { HANDLES[i] } as usize;
            assert!(unsafe { host::VIS[hd] } != 1, "{when}: {} was shown to a watcher", node_name(i));
        }
    };
    check("joined");
    // The owner's whole face arrives through the watch poll: the arc and every owner-only thing.
    let mut s = full_arc_snapshot();
    s += "U CubeA 1\nT TxCubeA x\nH CubeA need\nU CubeB 1\nH CubeB calm\nU CubePlus 1\nT TxPuck x\nU BtnPuckApprove 1\nU BtnPuckDeny 1\nH Puck need\nT TxSeal KXT WMP\nH SealRing armed\nU BtnSealType 1\nZ 2\n";
    run(0.1);
    assert_eq!(unsafe { LAST_PATH }, PATH_WATCH, "a watch poll went out");
    snap(&s);
    check("first answer");
    for k in 0..40 {
        k_tick(DT);
        check(&format!("frame {k}"));
    }
    assert!(vis("McCenterFrame"), "the watcher's arc shows");
    // The handles move a watcher's arc too; the ring still never shows.
    for hd in ["McMoveUp", "McMoveFarther", "McMoveLeft", "McMoveDown", "McMoveDown", "McMoveCloser"] {
        press(hd);
        run(0.1);
        check(hd);
    }
    // A fold and an unfold seen by the watcher (the owner's M changes).
    snap("AB1\nV 7\nM cubes\nZ 3\n");
    run(0.6);
    check("folded");
    snap(&s);
    run(0.6);
    check("unfolded again");
    assert!(!vis("McFloorRing"));
    close_panel();
}

/// Mirrors blender/build_panel.py's ledge: LEDGE_X, the cube slots, CUBE, the need halo
/// (radially 9 cm behind each cube's centre, HALO_W wide, z HALO_Z0 to HALO_Z1).
const T_LEDGE_X: f32 = 0.90;
const T_SLOTS: [f32; 4] = [0.495, 0.165, -0.165, -0.495];
const T_CUBE: f32 = 0.12;
const T_CUBE_Z: [f32; 2] = [0.802, 0.922];
const T_HALO_BACK: f32 = 0.09;
const T_HALO_W: f32 = 0.24;
const T_HALO_Z: [f32; 2] = [0.71, 0.93];

fn decal_samples() -> Vec<[f32; 2]> {
    let mut v = Vec::new();
    let (nx, ny) = (40, 120);
    for i in 0..=nx {
        for j in 0..=ny {
            let x = FLOOR_X0 + (FLOOR_X1 - FLOOR_X0) * i as f32 / nx as f32;
            let y = -FLOOR_HALF_W + 2.0 * FLOOR_HALF_W * j as f32 / ny as f32;
            v.push([x, y]);
        }
    }
    v
}

/// Where the eye's sightline to floor point `f` crosses the vertical plane `dot(p, b) = d`
/// (b a horizontal unit vector): (lateral offset along b's left normal, height), if in front.
fn cross(f: [f32; 2], b: [f32; 2], d: f32) -> Option<(f32, f32)> {
    let along = f[0] * b[0] + f[1] * b[1];
    if along <= d {
        return None;
    }
    let t = d / along;
    let lateral = t * (f[0] * -b[1] + f[1] * b[0]);
    Some((lateral, EYE_Z + t * (FLOOR_Z_VIEW - EYE_Z)))
}

#[test]
fn no_sightline_to_the_floor_ring_crosses_two_other_translucent_layers() {
    let samples = decal_samples();
    // The ledge is fixed to the throne: no cube's glass and no need halo lies over the decal.
    for &y in T_SLOTS.iter() {
        let rc = (T_LEDGE_X * T_LEDGE_X + y * y).sqrt();
        let b = [T_LEDGE_X / rc, y / rc];
        for f in &samples {
            if let Some((lat, z)) = cross(*f, b, rc + T_HALO_BACK) {
                assert!(!(lat.abs() <= T_HALO_W / 2.0 && z >= T_HALO_Z[0] && z <= T_HALO_Z[1]),
                    "the need halo of slot {y} lies over decal point {f:?}");
            }
            for d in [rc - T_CUBE / 2.0, rc, rc + T_CUBE / 2.0] {
                if let Some((lat, z)) = cross(*f, b, d) {
                    // half the diagonal: conservative for a cube turned to face the eye
                    assert!(!(lat.abs() <= T_CUBE * 0.71 && z >= T_CUBE_Z[0] && z <= T_CUBE_Z[1]),
                        "cube glass at slot {y} lies over decal point {f:?}");
                }
            }
        }
    }
    // The arc moves with the handles: wherever the ring shows, the ask plate (glass over the
    // centre panel's glass) never lies over it. Checked by casting each sightline, independently
    // of floor_clear's algebra, at both faces of the plate.
    sign_in_to_cubes();
    snap(&full_arc_snapshot());
    run(0.6);
    let p = ARC_PARTS[1];
    let mut checked = 0;
    reach_every_handle_setting(|a| {
        if !vis("McFloorRing") {
            return;
        }
        checked += 1;
        let (yl, yr) = (p[1] - a[2] - p[4], p[1] - a[2] + p[4]);
        let (zb, zt) = (p[2] - p[5] + a[1], p[2] + p[5] + a[1]);
        for xp in [p[0] - p[3] - a[0], p[0] + p[3] - a[0]] {
            for f in &samples {
                if let Some((lat, z)) = cross(*f, [1.0, 0.0], xp) {
                    assert!(!(lat >= yl && lat <= yr && z >= zb && z <= zt),
                        "ADJUST {a:?}: the ask plate lies over decal point {f:?}");
                }
            }
        }
    });
    assert!(checked > 100, "checked {checked} settings with the ring shown");
    close_panel();
}

/// Roboto Regular's advance in metres at the world-text size (8 cm), from the bridge's generated
/// table (agent-bridge/src/roboto-advance.ts, measured from the font by measure_roboto.py).
fn text_width_m(line: &str) -> f32 {
    let src = include_str!("../../agent-bridge/src/roboto-advance.ts");
    let body = &src[src.find("= [").unwrap() + 3..src.rfind(']').unwrap()];
    let adv: Vec<f32> = body.split(',').map(str::trim).filter(|s| !s.is_empty()).map(|s| s.parse().unwrap()).collect();
    line.bytes().map(|b| adv.get((b as usize).wrapping_sub(32)).copied().unwrap_or(0.5)).sum::<f32>() * 0.08
}

fn stored_text(name: &str) -> String {
    let i = idx(name);
    unsafe { String::from_utf8(TEXT_STORE[i][..TEXT_LEN[i] as usize].to_vec()).unwrap() }
}

/// Clarity pass A and B (CLARITY_PASS.md): the typing sheets ask in plain words, the seal's
/// question is the bridge face's PASSPHRASE_QUESTION byte for byte, and no question says a word
/// that reads as "PIN" or "pen".
#[test]
fn the_typing_sheets_ask_in_plain_words() {
    assert_eq!(SEAL_QUESTION, "Mission Control passphrase (shows as you type)");
    assert_eq!(
        WATCH_QUESTION,
        "Group watch code (6 digits). The person on the throne gets it by pressing Share with group."
    );
    let face = include_str!("../../agent-bridge/src/faces/mission-control/index.ts");
    let key = "const PASSPHRASE_QUESTION = \"";
    let at = face.find(key).expect("the face's PASSPHRASE_QUESTION") + key.len();
    let bridge_q = &face[at..at + face[at..].find('"').unwrap()];
    assert_eq!(SEAL_QUESTION, bridge_q, "the world's and the bridge's passphrase question must be equal");
    for q in [SEAL_QUESTION, WATCH_QUESTION, WATCH_POST_OWNER] {
        let lower = q.to_ascii_lowercase();
        for w in lower.split(|c: char| !c.is_ascii_alphanumeric()) {
            assert!(w != "pin" && w != "pen", "{q:?} says {w:?}");
        }
        assert!(q.len() <= HOST_TEXT_MAX_BYTES, "{q:?} is over a slot's 128 bytes");
    }
}

/// Clarity pass A: the owner pressing the Watch post is told what it is for, in two lines that
/// each fit the status line (W.status 1.2 m), and nothing is sent or opened.
#[test]
fn the_owner_at_the_watch_post_is_told_what_it_is_for() {
    sign_in_to_cubes();
    snap(&full_arc_snapshot());
    run(0.6);
    let n = fetches();
    let prompts = unsafe { host::PROMPTS };
    press("McWatchJoin");
    assert_eq!(fetches(), n, "no call");
    assert_eq!(unsafe { host::PROMPTS }, prompts, "no typing sheet for the owner");
    assert_eq!(mode(), Mode::Owner);
    let said = stored_text("TxStatus");
    assert_eq!(said, WATCH_POST_OWNER);
    assert_eq!(said, "This post is for a second headset.\nLet someone watch: press Share with group.");
    for line in said.split('\n') {
        assert!(text_width_m(line) <= 1.21, "{line:?} is {} m wide", text_width_m(line));
    }
    // Before signing in (the seal up), the same words go to the seal's hint.
    reset();
    press("McSeal");
    snap(&pair_records());
    run(0.62);
    press("McWatchJoin");
    assert_eq!(stored_text("TxSealHint"), WATCH_POST_OWNER);
    close_panel();
}

// ---------------------------------------------------------------------------
// The Kosmos Desk board (read-only, beside the throne)
// ---------------------------------------------------------------------------

fn dj(name: &str) -> usize {
    (0..N_DESK).find(|&j| desk_name(j) == name).expect(name)
}
fn dh(name: &str) -> i32 {
    unsafe { DESK_H[dj(name)] }
}
fn desk_label_on(name: &str) -> bool {
    unsafe { host::TEXT_ON[dh(name) as usize] }
}
fn board_shown() -> bool {
    unsafe { host::VIS[dh("McDeskBoard") as usize] == 1 }
}
fn desk_pos(name: &str) -> [f32; 3] {
    unsafe { host::POS[dh(name) as usize] }
}
fn desk_labels_on() -> usize {
    DESK_TEXT.iter().filter(|n| desk_label_on(n)).count()
}
/// Every world-text label the host is showing now, Mission Control's and the board's.
fn labels_on() -> usize {
    unsafe { host::TEXT_ON.iter().filter(|&&b| b).count() }
}
fn desk_stored(name: &str) -> String {
    let j = dj(name);
    unsafe { String::from_utf8(DESK_STORE[j][..DESK_LEN[j] as usize].to_vec()).unwrap() }
}
/// The face's answer with a full board: the heading and all 8 cards, left-aligned.
fn desk_full() -> String {
    let mut s = String::from("AB1\nV 1\nT TxDeskHead KOSMOS DESK\\n8 of 11 waiting on you - 3 min ago\n");
    for c in "ABCDEFGH".chars() {
        s += &format!("O TxDesk{c} -200\nT TxDesk{c} Decision {c} - hub, today\n");
    }
    s
}
/// Signed in with every cube label and the puck's label up: Mission Control's most in cubes mode.
fn sign_in_with_full_ledge() {
    sign_in_to_cubes();
    snap("AB1\nV 8\nM cubes\nT TxCubeC kosmos-web\nT TxCubeD client\nT TxPuck registry: run npm test\n");
    assert!(text_on("TxCubeA") && text_on("TxCubeD") && text_on("TxPuck"));
}

#[test]
fn desk_node_names_match_nodes_json() {
    let src = include_str!("../nodes.json");
    let v = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    assert_eq!(json_array(src, "desk_text"), v(&DESK_TEXT));
    assert_eq!(json_array(src, "desk_world"), v(&DESK_WORLD));
    for n in DESK_TEXT.iter().chain(&DESK_WORLD) {
        assert!(node_index(n.as_bytes()).is_none(), "{n} is the board's, not Mission Control's");
        assert!(!n.ends_with(|c: char| c.is_ascii_digit()), "{n}");
    }
    reset();
    for j in 0..N_DESK {
        assert_eq!(unsafe { DESK_H[j] }, (N_ALL + j + 1) as i32, "found after Mission Control's nodes, in order");
        assert!(unsafe { host::VIS[DESK_H[j] as usize] } == 0, "hidden at load");
    }
}

#[test]
fn the_desk_board_shows_signed_in_in_cubes_mode_only() {
    reset();
    run(2.0);
    assert_eq!(desk_fetches(), 0, "closed: nothing");
    press("McSeal");
    snap(&pair_records());
    run(1.0);
    assert_eq!(desk_fetches(), 0, "the seal is up: no board");
    assert!(!board_shown() && desk_labels_on() == 0);
    snap(PAIRED);
    run(0.6 + 0.35 + 0.2);
    assert_eq!(stage(), Stage::Grow);
    assert!(!board_shown() && desk_fetches() == 0, "not while the ledge grows in");
    run(0.25);
    assert_eq!(stage(), Stage::Signed);
    assert!(board_shown(), "after the seal, with the ledge");
    assert!(desk_label_on("TxDeskHead") && desk_stored("TxDeskHead") == DESK_ASKING);
    assert_eq!(desk_fetches(), 1);
    let n = build_desk_request();
    let sent = unsafe { String::from_utf8(REQ_BUF[..n].to_vec()).unwrap() };
    assert_eq!(sent, "AB1\ntok tok123\n", "the sign-in's own token, nothing else: no press, no version, no text");
    let base = unsafe { DESK_BASE[dj("McDeskBoard")] };
    assert!(close3(desk_pos("McDeskBoard"), [base[0], base[1] + PARK_DROP_M, base[2]]), "raised with the owner's panel");

    on_net_result(0, 0, REQ_DESK, 200);
    apply_desk(desk_full().as_bytes());
    assert_eq!(desk_labels_on(), 9);
    let b = unsafe { DESK_BASE[dj("TxDeskA")] };
    let want = [b[0] + DESK_RIGHT[0] * -0.2, b[1] + PARK_DROP_M, b[2] + DESK_RIGHT[2] * -0.2];
    assert!(close3(desk_pos("TxDeskA"), want), "a card is shifted along the board by its O record");

    // A cube unfolds the arc: the whole board goes in that same call, and is parked.
    press("CubeA");
    reply(&full_arc_snapshot());
    assert!(unsafe { ARC_SHOWN });
    assert!(!board_shown() && desk_labels_on() == 0, "the board hides the moment the arc unfolds");
    assert!(close3(desk_pos("McDeskBoard"), base), "and parks");
    run(60.0);
    assert_eq!(desk_fetches(), 1, "no asking while the arc is open");
    assert!(!board_shown() && desk_labels_on() == 0);

    // Fold: still hidden while it folds; back (with the cards it had) when it lands, and it asks.
    snap("AB1\nV 10\nM cubes\n");
    run(0.2);
    assert!(!board_shown() && desk_labels_on() == 0, "not while the arc folds");
    run(0.3);
    assert!(board_shown() && desk_labels_on() == 9);
    assert_eq!(desk_fetches(), 2, "the board was due, so it asks as it comes back");
    close_panel();
}

#[test]
fn the_world_text_budget_holds_in_every_mode_frame_by_frame() {
    const HOST_MAX: usize = 32;
    let mut worst = 0;
    let mut check = |what: &str, with_board: bool| {
        let n = labels_on();
        worst = worst.max(n);
        assert!(n <= HOST_MAX, "{what}: {n} labels");
        if !with_board {
            assert_eq!(desk_labels_on(), 0, "{what}: the board shows nothing");
        }
    };
    // The seal.
    reset();
    press("McSeal");
    snap(&pair_records());
    for _ in 0..90 {
        k_tick(DT);
        check("seal", false);
    }
    assert_eq!(labels_on(), 2, "the seal's code and hint");
    // Cubes, the board full.
    sign_in_with_full_ledge();
    apply_desk(desk_full().as_bytes());
    check("cubes", true);
    assert_eq!(labels_on(), 4 + 1 + 9, "four cube labels, the puck's, the board's nine");
    // The arc, frame by frame through the unfold, with a late board answer landing mid-way.
    press("CubeA");
    reply(&full_arc_snapshot());
    for k in 0..45 {
        k_tick(DT);
        if k == 20 {
            apply_desk(desk_full().as_bytes());
        }
        check("unfold", false);
    }
    let arc = labels_on();
    assert!(arc > 20 && arc <= 29, "the arc's labels and the puck's: {arc}");
    // A board answer while the arc is open changes nothing on screen.
    apply_desk(desk_full().as_bytes());
    on_net_result(0, 0, REQ_DESK, 0);
    check("arc", false);
    assert_eq!(labels_on(), arc);
    // The fold, frame by frame, back to cubes with the board.
    snap("AB1\nV 11\nM cubes\n");
    for _ in 0..45 {
        k_tick(DT);
        check("fold", true);
        if desk_labels_on() > 0 {
            assert!(!unsafe { ARC_SHOWN || TWEENS[G_ARC as usize].active }, "never the board and the arc together");
        }
    }
    assert!(board_shown() && desk_labels_on() >= 1);
    close_panel();
    check("closed", false);
    assert_eq!(labels_on(), 0);
    // A watcher: the arc only, never the board, never a board call.
    reset();
    press("McWatchJoin");
    unsafe { PROMPT_ANSWER[..6].copy_from_slice(b"296951"); }
    on_prompt_result(0, 0, REQ_PROMPT_WATCH, 6);
    snap(&full_arc_snapshot());
    apply_desk(desk_full().as_bytes());
    for _ in 0..(60.0 / DT) as usize {
        k_tick(DT);
    }
    check("watcher", false);
    assert!(!board_shown());
    assert_eq!(desk_fetches(), 0, "a watcher never asks for the board");
    assert!(worst <= HOST_MAX);
    close_panel();
}

#[test]
fn a_desk_answer_can_only_write_the_boards_own_labels() {
    sign_in_to_cubes();
    let status = stored_text("TxStatus");
    apply_desk(
        b"AB1\nK evil\nM arc\nM lock\nE signed_out\nU McSeal 0\nU McLedge 0\nT TxStatus hacked\nT TxCubeA hacked\nH CubeA need\nZ 99\nI 0123456789abcdef0123456789abcdef\nP TxDeskA Type here\nU McDeskBoard 0\nT McDeskBoard x\nT TxDeskA Real card - hub, today\nO TxDeskB 99999\nT TxDeskB Shifted - hub, today\n",
    );
    assert_eq!(mode(), Mode::Owner);
    assert_eq!(stage(), Stage::Signed);
    assert_eq!(unsafe { &TOKEN[..TOKEN_LEN] }, b"tok123", "the board can't sign anyone in or out");
    assert!(unsafe { !M_ARC && !ARC_SHOWN }, "nor open the arc");
    assert_eq!(stored_text("TxStatus"), status);
    assert_eq!(stored_text("TxCubeA"), "registry", "nor write on Mission Control's labels");
    assert!(vis("McLedge") && vis("CubeACalm") && !vis("CubeANeed"));
    assert_eq!(unsafe { host::HAPTICS }, 0);
    assert_eq!(unsafe { PROMPT_NODE }, [NONE; MAX_PROMPTS]);
    assert!(board_shown(), "U on the board is ignored too: the world alone decides it");
    assert!(desk_label_on("TxDeskA") && desk_stored("TxDeskA") == "Real card - hub, today");
    assert!((unsafe { DESK_SHIFT[dj("TxDeskB")] } - DESK_SHIFT_MAX_M).abs() < 1e-6, "a shift is clamped to the board");
    close_panel();
}

#[test]
fn no_answer_draws_desk_offline_and_leaves_mission_control_alone() {
    for status in [0, -2, -5, 401, 404, 502, 503, 200] {
        sign_in_to_cubes();
        apply_desk(desk_full().as_bytes());
        let mc_status = stored_text("TxStatus");
        // (The host stand-in can't read a body, so even a 200 here has nothing to apply.)
        on_net_result(0, 0, REQ_DESK, status);
        assert_eq!(desk_stored("TxDeskHead"), DESK_OFFLINE, "status {status}");
        assert!(desk_label_on("TxDeskHead") && desk_labels_on() == 1, "status {status}: no card stays up");
        assert_eq!(stored_text("TxStatus"), mc_status, "status {status}: Mission Control's status line untouched");
        assert_eq!(mode(), Mode::Owner);
        close_panel();
    }
    sign_in_to_cubes();
    apply_desk(b"HTTP/1.1 200 OK\nT TxDeskA nope\n");
    assert_eq!(desk_stored("TxDeskHead"), DESK_OFFLINE, "not AB1: offline");
    assert_eq!(desk_labels_on(), 1);
    close_panel();
}

#[test]
fn the_desk_asks_every_30_seconds_and_never_after_close() {
    sign_in_to_cubes();
    assert_eq!(desk_fetches(), 1);
    run(10.0);
    assert_eq!(desk_fetches(), 1, "one in flight at a time");
    on_net_result(0, 0, REQ_DESK, 404);
    run(18.0);
    assert_eq!(desk_fetches(), 1);
    run(3.0);
    assert_eq!(desk_fetches(), 2, "every 30 s");
    on_net_result(0, 0, REQ_DESK, 404);
    unsafe { host::REFUSE = 1; }
    run(30.5);
    assert_eq!(desk_fetches(), 2, "the host refused it (too fast)");
    run(3.1);
    assert_eq!(desk_fetches(), 3, "retried after the usual gap");
    on_net_result(0, 0, REQ_DESK, 404);
    apply_desk(desk_full().as_bytes());
    assert!(board_shown());
    close_panel();
    run(6.0);
    assert_eq!(mode(), Mode::Closed);
    let base = unsafe { DESK_BASE[dj("McDeskBoard")] };
    assert!(!board_shown() && desk_labels_on() == 0 && close3(desk_pos("McDeskBoard"), base), "closed: hidden and parked");
    assert_eq!(desk_stored("TxDeskHead"), DESK_ASKING, "and forgotten");
    assert_eq!(desk_stored("TxDeskA"), "");
    let n = desk_fetches();
    run(90.0);
    assert_eq!(desk_fetches(), n, "closed: no call");
    // A late answer after Close is dropped.
    on_net_result(0, 0, REQ_DESK, 200);
    apply_desk(desk_full().as_bytes());
    assert!(!board_shown() && desk_labels_on() == 0);
}

#[test]
fn a_refused_desk_label_is_asked_again_once_a_second_not_every_frame() {
    sign_in_to_cubes();
    unsafe { host::TEXT_FULL = true; }
    apply_desk(desk_full().as_bytes());
    let before = unsafe { host::TEXT_SHOWS };
    run(0.5);
    let shows = unsafe { host::TEXT_SHOWS } - before;
    assert!(shows <= 1, "the host was asked {shows} times in half a second");
    unsafe { host::TEXT_FULL = false; }
    run(1.2);
    assert_eq!(desk_labels_on(), 9, "once the pool has room, every label shows");
    close_panel();
}
