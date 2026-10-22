//! Host tests for Type Test: every line fits the world-text limits, the masked
//! field's lines never carry its text, and the press -> Enter -> re-arm ->
//! navigate flow runs in order against the stand-in host.
//!
//! @kosmos-system  Content (KosmosWorlds) -- Type Test (temporary)
//! @kosmos-owner   Type Test

use super::*;

/// k_ui_show_world_text: 1..=128 bytes, at most 4 lines.
fn fits(s: &str) {
    assert!(!s.is_empty() && s.len() <= 128, "{} bytes: {s:?}", s.len());
    assert!(s.split('\n').count() <= 4, "more than 4 lines: {s:?}");
}

fn field(masked: bool) -> Field {
    let mut f = Field::new(masked);
    f.node = 7;
    f
}

#[test]
fn buf_numbers() {
    let mut b: Buf<32> = Buf::new();
    b.push_i32(0).push(" ").push_i32(-11).push(" ").push_i32(i32::MIN).push(" ").push_i32(1013);
    assert_eq!(b.as_str(), "0 -11 -2147483648 1013");
}

#[test]
fn buf_stops_on_a_char_boundary() {
    let mut b: Buf<5> = Buf::new();
    b.push("ab\u{20AC}\u{20AC}");
    assert_eq!(b.as_str(), "ab\u{20AC}");
}

#[test]
fn counts_characters_not_bytes() {
    assert_eq!(count_chars(b"hunter2"), 7);
    assert_eq!(count_chars("p\u{E4}ss\u{20AC}".as_bytes()), 5);
    assert_eq!(count_chars(b""), 0);
}

#[test]
fn wipe_clears() {
    let mut b = [1u8, 2, 3];
    wipe(&mut b);
    assert_eq!(b, [0, 0, 0]);
}

#[test]
fn every_line_fits_in_its_worst_case() {
    fits(LABEL_PLAIN);
    fits(LABEL_PASSWORD);
    fits(title_text(5, 0).as_str());
    fits(title_text(i32::MIN, i32::MIN).as_str());
    fits(nav_text(Nav::NotYet, -1).as_str());
    fits(nav_text(Nav::Pending { enter_s: 0.0 }, 7).as_str());
    fits(nav_text(Nav::Returned(i32::MIN, false), 0).as_str());

    let mut f = field(false);
    fits(result_text(&f).as_str());
    for s in ["W".repeat(48), "\u{1F600}".repeat(12), "a b ".repeat(12)] {
        f.read_once = true;
        f.plain.clear();
        f.plain.push(&s);
        fits(result_text(&f).as_str());
    }
    f.open = Open::Refused(i32::MIN);
    f.text_read = Some(i32::MIN);
    f.ended = Ended::Other(i32::MIN);
    fits(status_text(&f).as_str());
    for o in [Open::No, Open::Yes { via: Via::Press }, Open::Yes { via: Via::Enter }, Open::Yes { via: Via::EnterOrPress }, Open::Retrying(i32::MIN), Open::Again { via: Via::EnterOrPress, code: i32::MIN }] {
        f.open = o;
        fits(status_text(&f).as_str());
    }

    let mut m = field(true);
    fits(result_text(&m).as_str());
    m.masked_chars = Some(128);
    fits(result_text(&m).as_str());
}

#[test]
fn plain_result_shows_the_text_wrapped() {
    let mut f = field(false);
    assert_eq!(result_text(&f).as_str(), "You typed:\n(nothing yet)");
    f.read_once = true;
    assert_eq!(result_text(&f).as_str(), "You typed:\n(empty)");
    f.plain.push("hello");
    assert_eq!(result_text(&f).as_str(), "You typed:\nhello");
    f.plain.clear();
    f.plain.push(&"x".repeat(48));
    let t = result_text(&f);
    let lines: Vec<&str> = t.as_str().split('\n').collect();
    assert_eq!(lines.len(), 4);
    assert_eq!(lines[1].len(), WRAP_CHARS);
    assert_eq!(lines[1..].concat().len(), 48);
}

#[test]
fn masked_result_is_length_only() {
    let mut m = field(true);
    // Even if a bug left text in the plain buffer of a masked field, its lines never show it.
    m.plain.push("hunter2");
    m.read_once = true;
    assert_eq!(result_text(&m).as_str(), "Password received:\n(nothing yet)");
    m.masked_chars = Some(1);
    assert_eq!(result_text(&m).as_str(), "Password received:\n1 character");
    m.masked_chars = Some(7);
    assert_eq!(result_text(&m).as_str(), "Password received:\n7 characters");
    m.text_read = Some(7);
    m.ended = Ended::Enter;
    m.open = Open::Yes { via: Via::Enter };
    assert!(!result_text(&m).as_str().contains("hunter2"));
    assert!(!status_text(&m).as_str().contains("hunter2"));
    // The status line gives the same character count as the result line, never a byte count.
    assert_eq!(status_text(&m).as_str(), "open: yes (Enter), begin 0\ntext: yes, 7 characters\nended: Enter");
}

/// A press heard between a field opening and its Enter makes the next field's
/// opener ambiguous (the host tries an unused press first), and the label says so.
#[test]
fn a_press_before_the_enter_is_labelled() {
    let mut a = App::new();
    a.fields[0].node = 11;
    a.fields[1].node = 12;
    a.now_s = 10.0;
    a.last_press_s = 10.0;
    a.last_open_s = 10.0;
    assert_eq!(after_enter_via(&a), Via::Enter, "the press that opened the field is not ambiguous");
    a.now_s = 11.0;
    a.last_press_s = 11.0; // e.g. a refused press on the other button, or a wall
    a.now_s = 13.0;
    assert_eq!(after_enter_via(&a), Via::EnterOrPress);
    a.now_s = 11.0 + PRESS_WINDOW_S + 0.1;
    assert_eq!(after_enter_via(&a), Via::Enter, "that press's window has closed");
}

#[test]
fn status_names_each_step() {
    let mut f = field(false);
    assert_eq!(status_text(&f).as_str(), "open: no\ntext: no\nended: no");
    f.open = Open::Yes { via: Via::Press };
    f.text_read = Some(5);
    f.ended = Ended::Enter;
    assert_eq!(status_text(&f).as_str(), "open: yes (press), begin 0\ntext: yes, read 5\nended: Enter");
    f.open = Open::Refused(-11);
    assert!(status_text(&f).as_str().starts_with("open: NO, begin -11"));
}

/// The whole flow against the stand-in host (begin answers 0, read answers -7,
/// navigate answers -11). One test, because the App is one static.
#[test]
fn press_enter_rearm_then_navigate() {
    let a = app();
    *a = App::new();
    // 1.1.0: the stand-in's answers are shared statics; the card tests change them.
    unsafe {
        host::STUB_BEGIN = 0;
        host::STUB_READ = -7;
    }
    a.fields[0].node = 11;
    a.fields[1].node = 12;

    // A press on the plain button opens the plain field.
    a.now_s = 1.0;
    on_press(0, 11, 0, 0);
    assert_eq!(a.last_press_s, 1.0);
    let (k, req, via) = a.session.expect("plain session open");
    assert_eq!((k, via), (0, Via::Press));
    assert_eq!(a.fields[0].open, Open::Yes { via: Via::Press });

    // A stale request id is ignored.
    on_text_input(0, 11, req + 100, CODE_SUBMITTED);
    assert!(a.session.is_some());

    // Text changes, then a real Enter.
    on_text_input(0, 11, req, CODE_CHANGED);
    assert_eq!(a.fields[0].text_read, Some(-7));
    a.now_s = 2.0;
    on_text_input(0, 11, req, CODE_SUBMITTED);
    assert_eq!(a.fields[0].ended, Ended::Enter);
    // The Enter re-arm opened the password field, with no press.
    let (k2, req2, via2) = a.session.expect("password session opened by Enter");
    assert_eq!((k2, via2), (1, Via::Enter));
    assert_ne!(req2, req);
    assert_eq!(a.fields[1].open, Open::Yes { via: Via::Enter });
    assert_eq!(a.nav, Nav::Pending { enter_s: 2.0 });

    // An Enter on the field the Enter opened does not chain again.
    on_text_input(0, 12, req2, CODE_SUBMITTED);
    assert!(a.session.is_none());
    assert!(a.chain.is_none());

    // The navigate call waits until the press is PRESS_SETTLE_S old (1.0 + 6.5).
    for _ in 0..21 {
        k_tick(0.25); // now 2.0 -> 7.25
    }
    assert!(matches!(a.nav, Nav::Pending { .. }), "called too early at {}", a.now_s);
    for _ in 0..2 {
        k_tick(0.25); // -> 7.75
    }
    // The Enter came 1.0 s after the press: the call is 5.5 s after the Enter, so it says nothing.
    assert_eq!(a.nav, Nav::Returned(-11, false));
    assert!(nav_text(a.nav, 0).as_str().ends_with("returned -11, inconclusive"));
    assert_eq!(a.nav_calls, 1);
    // Once: more ticks call nothing.
    k_tick(0.25);
    assert_eq!(a.nav_calls, 1);

    // A press while a session is open is a fresh begin (the stand-in host accepts it).
    on_press(0, 12, 0, 0);
    assert_eq!(a.session.map(|s| s.0), Some(1));
    // The visitor closes the keyboard.
    let (_, req3, _) = a.session.unwrap();
    on_text_input(0, 12, req3, CODE_CLOSED);
    assert_eq!(a.fields[1].ended, Ended::Closed);
    assert_eq!(a.nav, Nav::Returned(-11, false), "a closed keyboard is not an Enter");

    // A second press on the field whose keyboard is up keeps it open and shows the code.
    on_press(0, 11, 0, 0);
    assert_eq!(a.session.map(|s| s.0), Some(0));
    unsafe { host::STUB_BEGIN = -6 };
    on_press(0, 11, 0, 0);
    assert_eq!(a.fields[0].open, Open::Again { via: Via::Press, code: -6 });
    assert_eq!(a.session.map(|s| s.0), Some(0), "the open session is untouched");
    // A press on the OTHER field while one is open is refused, with its code.
    on_press(0, 12, 0, 0);
    assert_eq!(a.fields[1].open, Open::Refused(-6));

    // An Enter whose re-arm keeps being refused: the world retries, then gives up and says so.
    let (_, req4, _) = a.session.unwrap();
    unsafe { host::STUB_BEGIN = -11 };
    on_text_input(0, 11, req4, CODE_SUBMITTED);
    assert_eq!(a.fields[1].open, Open::Retrying(-11));
    assert!(a.chain.is_some());
    for _ in 0..30 {
        k_tick(0.25);
    }
    assert!(a.chain.is_none());
    assert_eq!(a.fields[1].open, Open::Refused(-11));
    unsafe { host::STUB_BEGIN = 0 };
    k_shutdown();
}

// ---------------------------------------------------------------------------
// 1.1.0: the cards (checks.rs)
// ---------------------------------------------------------------------------

use checks::{card_text, Card, Kind, CARDS, HEADER_TEXT};

/// A fresh App whose cards have nodes 101.. and plaques 201.., and the stand-in host reset.
fn card_app() -> App {
    let mut a = App::new();
    for i in 0..CARDS.len() {
        a.checks.cards[i].node = 101 + i as i32;
        a.checks.cards[i].txt = 201 + i as i32;
    }
    unsafe {
        host::STUB_BEGIN = 0;
        host::STUB_READ = -7;
        host::STUB_END = 0;
        host::STUB_LAST_READ_CAP = -1;
    }
    a
}

fn idx(k: Kind) -> usize {
    CARDS.iter().position(|c| c.2 == k).unwrap()
}

#[test]
fn every_card_fits_in_its_worst_case() {
    fits(HEADER_TEXT);
    for (_, _, _, label) in CARDS {
        fits(label);
    }
    for (_, _, kind, _) in CARDS {
        let mut c = Card::new(kind);
        fits(card_text(&c).as_str());
        c.begin = Some(i32::MIN);
        fits(card_text(&c).as_str());
        c.begin = Some(0);
        c.open = true;
        fits(card_text(&c).as_str());
        c.open = false;
        c.ended = Ended::Other(i32::MIN);
        c.end_code = Some(i32::MIN);
        c.events_after_end = i32::MIN;
        c.read_same = Some(i32::MIN);
        c.read_next = Some(i32::MIN);
        c.again = Some((i32::MIN, 999.0));
        c.again_end = Some(i32::MIN);
        c.second = Some(i32::MIN);
        c.probes = [Some(i32::MIN); 4];
        c.bytes = Some(i32::MIN);
        fits(card_text(&c).as_str());
        c.bytes = Some(i32::MAX);
        c.text.push(&"W".repeat(32));
        fits(card_text(&c).as_str());
        for r2 in [-6, -11, 0] {
            c.again = Some((r2, 0.4));
            c.second = Some(r2);
            fits(card_text(&c).as_str());
        }
    }
}

#[test]
fn start_text_marks_every_ten_bytes() {
    let mut b = [0u8; checks::START_OVER_BYTES];
    checks::fill_start(&mut b);
    assert_eq!(&b[..10], b"......0010");
    assert_eq!(&b[40..50], b"......0050");
    assert_eq!(&b[490..500], b"......0500");
    assert_eq!(&b[590..600], b"......0600");
}

/// C4: the four over-limit begins are refused by the argument rules (-7) before the
/// press is looked at, so the fifth, valid begin still opens.
#[test]
fn limits_card_refuses_four_then_opens() {
    let mut a = card_app();
    let i = idx(Kind::Limits);
    checks::press(&mut a, i);
    let c = &a.checks.cards[i];
    assert_eq!(c.probes, [Some(-7); 4]);
    assert_eq!(c.begin, Some(0));
    assert!(c.open);
    let t = card_text(c);
    assert!(t.as_str().starts_with("plain 513: -7, pw 129: -7\npw start: -7, 600>512: -7\n512 field: begin 0"), "{}", t.as_str());
    unsafe { host::STUB_READ = 512 };
    let req = c.req;
    assert!(checks::on_text_input(&mut a, req, CODE_SUBMITTED));
    let c = &a.checks.cards[i];
    assert_eq!(c.bytes, Some(512));
    assert_eq!(c.ended, Ended::Enter);
    assert!(card_text(c).as_str().ends_with("read 512 bytes, max 512"), "{}", card_text(c).as_str());
}

/// C1: the world ends its own field after 3 s; the text is readable in that tick and
/// not in the next; any event afterwards is counted as a failure.
#[test]
fn end_card_closes_and_counts_stray_events() {
    let mut a = card_app();
    let i = idx(Kind::EndByWorld);
    a.now_s = 1.0;
    checks::press(&mut a, i);
    let req = a.checks.cards[i].req;
    assert!(a.checks.cards[i].open);
    a.now_s = 3.9;
    checks::tick(&mut a);
    assert!(a.checks.cards[i].open, "not before 3 s");
    unsafe { host::STUB_READ = 5 };
    a.now_s = 4.0;
    checks::tick(&mut a);
    let c = &a.checks.cards[i];
    assert_eq!((c.end_code, c.read_same, c.open, c.ended_req), (Some(0), Some(5), false, req));
    unsafe { host::STUB_READ = -7 };
    a.now_s = 4.02;
    checks::tick(&mut a);
    assert_eq!(a.checks.cards[i].read_next, Some(-7));
    let t = card_text(&a.checks.cards[i]);
    assert!(t.as_str().contains("events after end: 0 (pass)"), "{}", t.as_str());
    assert!(t.as_str().contains("read: 5 at end, -7 next"), "{}", t.as_str());
    assert!(checks::on_text_input(&mut a, req, CODE_CLOSED));
    assert!(card_text(&a.checks.cards[i]).as_str().contains("after end: 1, code -1 (FAIL)"), "{}", card_text(&a.checks.cards[i]).as_str());
}

/// C2: a press opens and closes at once; a second press within a second is the host's -6.
#[test]
fn twice_card_shows_the_second_begin() {
    let mut a = card_app();
    let i = idx(Kind::TwiceFast);
    a.now_s = 10.0;
    checks::press(&mut a, i);
    assert_eq!((a.checks.cards[i].begin, a.checks.cards[i].end_code), (Some(0), Some(0)));
    assert!(card_text(&a.checks.cards[i]).as_str().contains("now press again, fast"));
    unsafe { host::STUB_BEGIN = -6 };
    a.now_s = 10.4;
    checks::press(&mut a, i);
    let t = card_text(&a.checks.cards[i]);
    assert!(t.as_str().contains("again after 0.40 s: -6"), "{}", t.as_str());
    assert!(t.as_str().contains("-6: one a second (pass)"));
    unsafe { host::STUB_BEGIN = 0 };
    a.now_s = 12.0;
    checks::press(&mut a, i);
    assert_eq!(a.checks.cards[i].again, None, "a new pair");
    a.now_s = 13.5;
    checks::press(&mut a, i);
    let t = card_text(&a.checks.cards[i]);
    assert!(t.as_str().contains("again after 1.50 s: 0, end 0\nopened: over 1 s, retry"), "{}", t.as_str());
    // The gap decides the words: -6 at a second or more is another open field, not the
    // one-a-second rule; 0 inside a second is the host's failure, not the visitor's.
    let mut c = Card::new(Kind::TwiceFast);
    c.begin = Some(0);
    c.end_code = Some(0);
    c.again = Some((-6, 1.2));
    assert!(card_text(&c).as_str().contains("again after 1.20 s: -6\n-6: another field was open"), "{}", card_text(&c).as_str());
    c.again = Some((0, 0.4));
    assert!(card_text(&c).as_str().contains("\nFAIL: host let it open"), "{}", card_text(&c).as_str());
    c.again = Some((-6, 0.999));
    assert!(card_text(&c).as_str().contains("again after 0.99 s: -6\n-6: one a second (pass)"), "{}", card_text(&c).as_str());
}

/// C3: the second press while the card's keyboard is up. Only a -6 a second or more after
/// the field opened shows the one-field rule (inside a second the one-a-second rule answers).
#[test]
fn one_card_records_the_second_press() {
    let mut a = card_app();
    let i = idx(Kind::OneAtATime);
    a.now_s = 1.0;
    checks::press(&mut a, i);
    assert!(a.checks.cards[i].open);
    unsafe { host::STUB_BEGIN = -6 };
    a.now_s = 1.5;
    checks::press(&mut a, i);
    assert_eq!(a.checks.cards[i].second, Some(-6));
    assert!(a.checks.cards[i].open, "the open field is untouched");
    let t = card_text(&a.checks.cards[i]);
    assert!(t.as_str().contains("2nd after 0.50 s: -6\nunder 1 s: inconclusive."), "{}", t.as_str());
    a.now_s = 2.5;
    checks::press(&mut a, i);
    let t = card_text(&a.checks.cards[i]);
    assert!(t.as_str().contains("2nd after 1.50 s: -6\n-6: one field per world\n(pass)"), "{}", t.as_str());
    unsafe { host::STUB_BEGIN = -11 };
    checks::press(&mut a, i);
    assert!(card_text(&a.checks.cards[i]).as_str().contains("-11: the keyboard held"));
    unsafe { host::STUB_BEGIN = 0 };
    a.now_s = 3.0;
    checks::press(&mut a, i);
    assert!(card_text(&a.checks.cards[i]).as_str().contains("FAIL: the host opened\na second field"), "{}", card_text(&a.checks.cards[i]).as_str());
}

/// The first row's navigate result is conclusive only for an Enter 2 s or more after the last press.
#[test]
fn navigate_after_enter_is_labelled_conclusive_only_when_it_can_be() {
    assert_eq!(nav_text(Nav::Returned(-11, true), 0).as_str(), "After Enter, k_world_navigate\nreturned -11, conclusive");
    let a = app();
    *a = App::new();
    unsafe {
        host::STUB_BEGIN = 0;
        host::STUB_READ = -7;
    }
    a.fields[0].node = 11;
    a.fields[1].node = 12;
    a.now_s = 1.0;
    on_press(0, 11, 0, 0);
    let (_, req, _) = a.session.unwrap();
    a.now_s = 3.5; // the Enter, 2.5 s after the press
    on_text_input(0, 11, req, CODE_SUBMITTED);
    for _ in 0..24 {
        k_tick(0.25);
    }
    assert_eq!(a.nav, Nav::Returned(-11, true));
    k_shutdown();
}

/// C5 never keeps the text, and C7 never even copies it (out_cap 0).
#[test]
fn masked_and_audit_cards_never_hold_the_text() {
    let mut a = card_app();
    let m = idx(Kind::MaskedNumber);
    checks::press(&mut a, m);
    assert_eq!(a.checks.cards[m].begin, Some(0));
    unsafe { host::STUB_READ = 8 };
    let req = a.checks.cards[m].req;
    checks::on_text_input(&mut a, req, CODE_SUBMITTED);
    assert_eq!(a.checks.cards[m].bytes, Some(8));
    assert!(a.checks.cards[m].text.as_bytes().is_empty());
    assert!(card_text(&a.checks.cards[m]).as_str().contains("got 8 bytes (cap 8)"));
    #[allow(static_mut_refs)]
    let mask = unsafe { &*core::ptr::addr_of!(MASK_BUF) };
    assert!(mask.iter().all(|&b| b == 0), "wiped");

    let au = idx(Kind::Audit);
    checks::press(&mut a, au);
    let req = a.checks.cards[au].req;
    unsafe { host::STUB_READ = 14 };
    checks::on_text_input(&mut a, req, CODE_CHANGED);
    assert_eq!(unsafe { host::STUB_LAST_READ_CAP }, 0, "the audit card reads the length only");
    assert!(a.checks.cards[au].text.as_bytes().is_empty());
    assert!(card_text(&a.checks.cards[au]).as_str().contains("received 14 bytes"));
}

/// C5 asks for the number layout on a masked field (the host must still show the password keys).
#[test]
fn the_number_cards_send_the_layout_bits() {
    assert_eq!(checks::FLAG_LAYOUT_NUMBER, 0x20);
    assert_eq!(FLAG_MASKED | checks::FLAG_LAYOUT_NUMBER, 0x21);
}

/// Roboto Regular advances in em for U+0020..U+007E (KosmosWorlds agent-bridge/src/roboto-advance.ts,
/// the same table ../../tools/build_glb.mjs uses). World text on a level-5 client is Roboto at 8 cm.
const ROBOTO_ADVANCE_EM: [f32; 95] = [
    0.1873, 0.1983, 0.2697, 0.4695, 0.4389, 0.5511, 0.4695, 0.1637, 0.2498, 0.2528, 0.3252, 0.4275,
    0.1486, 0.3396, 0.2016, 0.3127, 0.4242, 0.4242, 0.4242, 0.4242, 0.4242, 0.4242, 0.4242, 0.4242,
    0.4242, 0.4242, 0.1902, 0.1932, 0.3826, 0.4242, 0.3944, 0.3584, 0.6744, 0.4765, 0.479, 0.4772,
    0.5103, 0.4157, 0.4157, 0.5103, 0.5302, 0.213, 0.4132, 0.479, 0.4143, 0.6545, 0.5305, 0.5136,
    0.479, 0.525, 0.4794, 0.4606, 0.4507, 0.5099, 0.4765, 0.6486, 0.4765, 0.4765, 0.4507, 0.2031,
    0.3113, 0.2031, 0.3149, 0.3425, 0.2358, 0.4143, 0.4283, 0.3944, 0.4283, 0.3944, 0.248, 0.4283,
    0.4283, 0.1898, 0.195, 0.3863, 0.1898, 0.6586, 0.4283, 0.4283, 0.4283, 0.4283, 0.2638, 0.394,
    0.2539, 0.4283, 0.379, 0.5703, 0.379, 0.379, 0.379, 0.2561, 0.1865, 0.2561, 0.5118,
];

fn line_width_m(s: &str) -> f32 {
    s.chars().map(|c| {
        let i = c as usize;
        let em = if (32..127).contains(&i) { ROBOTO_ADVANCE_EM[i - 32] } else { 0.6745 };
        em * 0.08
    }).sum()
}

/// Every card line, in every state a headset can reach (realistic codes, byte counts
/// up to 512, gaps up to 9.9 s, a typed 16-digit number), fits checks::CARD_WIDTH_M.
#[test]
fn every_card_line_fits_its_plaque() {
    let codes = [0, -1, -2, -3, -6, -7, -8, -11];
    let ends = [Ended::No, Ended::Enter, Ended::Closed, Ended::Taken, Ended::Other(-11)];
    let mut worst = (0.0f32, String::new());
    let mut check = |t: &str| {
        for l in t.split('\n') {
            let w = line_width_m(l);
            if w > worst.0 {
                worst = (w, l.to_string());
            }
        }
    };
    check(HEADER_TEXT);
    for (_, _, kind, _) in CARDS {
        for &r in &codes {
            for &e in &ends {
                for &open in &[false, true] {
                    for &r2 in &codes {
                        let mut c = Card::new(kind);
                        check(card_text(&c).as_str());
                        c.begin = Some(r);
                        c.open = open;
                        c.ended = e;
                        check(card_text(&c).as_str());
                        c.end_code = Some(r2);
                        c.read_same = Some(512);
                        c.read_next = Some(-7);
                        c.events_after_end = 99;
                        c.again = Some((r2, 9.9));
                        c.again_end = Some(r2);
                        c.second = Some(r2);
                        c.second_gap = if r == -6 { 0.5 } else { 9.99 };
                        c.stray_code = -11;
                        c.probes = [Some(r2); 4];
                        c.bytes = Some(512);
                        c.text.push("9999999999999999");
                        check(card_text(&c).as_str());
                    }
                }
            }
        }
    }
    let label_w = CARDS.iter().map(|c| line_width_m(c.3)).fold(0.0f32, f32::max);
    assert!(worst.0 <= checks::CARD_WIDTH_M * 0.97, "{:.3} m: {:?}", worst.0, worst.1);
    assert!(label_w <= checks::BUTTON_WIDTH_M * 0.97, "a label is {label_w:.3} m");
}

/// 1.1.1: every plaque the script shows text on has its own anchor, named
/// "<plaque>Text", and text goes only to anchors, never to a pressed node.
#[test]
fn text_anchors_are_named_after_their_plaques() {
    for (plaque, text) in NODES.iter().zip(TEXT_NODES.iter()) {
        assert_eq!(*text, std::format!("{plaque}Text"));
        assert!(!OTHER_NODES.contains(text) && !NODES.contains(text), "{text} is a pressed node");
    }
    for (i, (btn, txt, _, _)) in CARDS.iter().enumerate() {
        assert_eq!(checks::CARD_TEXT_NODES[i].0, std::format!("{btn}Text"));
        assert_eq!(checks::CARD_TEXT_NODES[i].1, std::format!("{txt}Text"));
        assert!(checks::CHECK_TEXT_NODES.contains(&checks::CARD_TEXT_NODES[i].0));
        assert!(checks::CHECK_TEXT_NODES.contains(&checks::CARD_TEXT_NODES[i].1));
    }
    assert_eq!(checks::HEADER_TEXT_NODE, std::format!("{}Text", checks::HEADER_NODE));
    assert!(checks::CHECK_TEXT_NODES.contains(&checks::HEADER_TEXT_NODE));
    assert_eq!(checks::CHECK_TEXT_NODES.len(), 2 * CARDS.len() + 1);
    for n in checks::CHECK_TEXT_NODES {
        assert!(!checks::CHECK_NODES.contains(&n), "{n} is a pressed node");
    }
}