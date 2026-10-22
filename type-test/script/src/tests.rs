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
    fits(nav_text(Nav::Returned(i32::MIN), 0).as_str());

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
    assert_eq!(a.nav, Nav::Returned(-11));
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
    assert_eq!(a.nav, Nav::Returned(-11), "a closed keyboard is not an Enter");

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
