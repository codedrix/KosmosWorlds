//! The level-5 checks kosmos-project #213 left unshown (type-test 1.1.0).
//!
//! @kosmos-system  Content (KosmosWorlds) -- Type Test (temporary)
//! @kosmos-owner   Type Test 1.1.0, KOS-699 (builder vp-w1). CEO 2026-10-22: "The remaining
//!                 checks can be done during the level 6 headset session."
//! @kosmos-level   host API level 5 (`k_ui_text_begin`, `k_ui_text_read`, `k_ui_text_end`,
//!                 the event `OnTextInput`).
//!
//! Seven cards, each a button with a result plaque above it. #213's list of what
//! was NOT shown, and the card that shows it:
//!
//! | #213 item                                           | card                     |
//! |-----------------------------------------------------|--------------------------|
//! | (5) `k_ui_text_end` closes a field, no event        | C1 "World closes it"     |
//! | (4) a second begin within a second is refused       | C2 "Open twice, fast"    |
//! | (4) one session per world                           | C3 "Press twice" (and the|
//! |                                                     | first row's buttons)     |
//! | (3) 512 bytes plain, 128 masked                     | C4 "Size limits"         |
//! | (2) masked forces the password keyboard             | C5 "Password, number pad"|
//! |     (and its contrast, a plain number pad)          | C6 "Plain, number pad"   |
//! | (6) the typing goes nowhere else                    | C7 "Audit (no echo)"     |
//! | (1) the keyboard-zone chrome names the author       | every card (observed)    |
//! | Enter re-arm, the first run                         | the first row, unchanged |
//!
//! Each card's plaque shows every return code its calls got, in plain words.
//!
//! The host's check order (KDomUI.cpp k_ui_text_begin at the client's
//! feat/device-p2-2026-10 a1936d8, unchanged since 944abfa / Build 1013) is what
//! makes these cards possible from a single press:
//!   bad flags or caps -7  ->  multi-line -8  ->  no fresh press -11  ->  a
//!   session is open or one began < 1 s ago -6.
//! So C4's four refusals (-7) cost nothing and do not spend the press, and the
//! fifth begin, a valid one, still has the press to open with. And -6 needs a
//! fresh press: C2 and C3 each need a second press from the visitor.
//!
//! THE PRIVACY RULE (the same as lib.rs): nothing typed is logged, saved or sent.
//! C5 (masked) copies the text only to count its bytes, then wipes it. C7 never
//! copies the text at all: it asks `k_ui_text_read` for the length only
//! (`out_cap` 0). C4 and C6 show what was typed, on their own plaque only.

use super::*;

/// flags bits 4-7: the keyboard layout. 2 = the number layout.
pub const FLAG_LAYOUT_NUMBER: i32 = 2 << 4;

/// C1: the world closes its own field this long after it opened.
pub const END_AFTER_S: f32 = 3.0;

/// C4: the plain field's cap and its start text's length.
pub const LIMIT_PLAIN: i32 = 512;
pub const LIMIT_MASKED: i32 = 128;
pub const START_BYTES: usize = 500;
/// C4's over-cap probe: a start text longer than the 512 cap.
pub const START_OVER_BYTES: usize = 600;
/// C5: a masked field with a small cap, so the cap shows after a few key presses.
pub const MASKED_SMALL_CAP: i32 = 8;
/// C6's cap.
pub const NUMBER_CAP: i32 = 16;
/// C1, C2, C3, C7: a plain field's cap.
pub const SMALL_CAP: i32 = 64;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Kind {
    EndByWorld,
    TwiceFast,
    OneAtATime,
    Limits,
    MaskedNumber,
    PlainNumber,
    Audit,
}

/// (button node, result node, kind, button label). ../tools/build_glb.mjs builds these nodes.
pub const CARDS: [(&str, &str, Kind, &str); 7] = [
    ("BtnEnd", "TxtEnd", Kind::EndByWorld, "World closes it"),
    ("BtnTwice", "TxtTwice", Kind::TwiceFast, "Open twice, fast"),
    ("BtnOne", "TxtOne", Kind::OneAtATime, "Press twice"),
    ("BtnLimits", "TxtLimits", Kind::Limits, "Size limits"),
    ("BtnPin", "TxtPin", Kind::MaskedNumber, "Password, number pad"),
    ("BtnDigits", "TxtDigits", Kind::PlainNumber, "Plain, number pad"),
    ("BtnAudit", "TxtAudit", Kind::Audit, "Audit (no echo)"),
];
/// The header plaque behind the visitor.
pub const HEADER_NODE: &str = "TxtChecks";
/// Every node this module finds (for build_glb.mjs's node contract).
pub const CHECK_NODES: [&str; 15] = [
    "BtnEnd", "TxtEnd", "BtnTwice", "TxtTwice", "BtnOne", "TxtOne", "BtnLimits", "TxtLimits",
    "BtnPin", "TxtPin", "BtnDigits", "TxtDigits", "BtnAudit", "TxtAudit", "TxtChecks",
];

pub const HEADER_TEXT: &str = "Level 5 checks, part 2\nLeft: closing, refusals\nRight: limits, keyboards\nBehind you: the audit field";

#[derive(Clone, Copy)]
pub struct Card {
    pub kind: Kind,
    pub node: i32,
    pub txt: i32,
    /// The open session's request id (0: none of this card's).
    pub req: i32,
    pub open: bool,
    /// The last begin's answer that opened (or refused) this card's field.
    pub begin: Option<i32>,
    pub ended: Ended,
    /// Bytes as last read (C4, C5, C7), or the plain text (C6, C4's tail).
    pub bytes: Option<i32>,
    pub text: Buf<32>,
    // C1 and C2: k_ui_text_end and what followed it.
    pub end_at_s: f32,
    pub end_code: Option<i32>,
    pub ended_req: i32,
    pub events_after_end: i32,
    pub read_same: Option<i32>,
    pub read_next: Option<i32>,
    pub read_next_due: bool,
    // C2: the second press.
    pub last_begin_s: f32,
    pub again: Option<(i32, f32)>,
    pub again_end: Option<i32>,
    // C3: the press while open.
    pub second: Option<i32>,
    // C4: the four refusals.
    pub probes: [Option<i32>; 4],
    pub dirty: bool,
}

impl Card {
    pub const fn new(kind: Kind) -> Self {
        Card {
            kind,
            node: 0,
            txt: 0,
            req: 0,
            open: false,
            begin: None,
            ended: Ended::No,
            bytes: None,
            text: Buf::new(),
            end_at_s: 0.0,
            end_code: None,
            ended_req: 0,
            events_after_end: 0,
            read_same: None,
            read_next: None,
            read_next_due: false,
            last_begin_s: -1.0,
            again: None,
            again_end: None,
            second: None,
            probes: [None; 4],
            dirty: true,
        }
    }
}

pub struct Checks {
    pub cards: [Card; 7],
    pub header: i32,
    pub header_dirty: bool,
    pub labels_dirty: bool,
}

impl Checks {
    pub const fn new() -> Self {
        Checks {
            cards: [
                Card::new(Kind::EndByWorld),
                Card::new(Kind::TwiceFast),
                Card::new(Kind::OneAtATime),
                Card::new(Kind::Limits),
                Card::new(Kind::MaskedNumber),
                Card::new(Kind::PlainNumber),
                Card::new(Kind::Audit),
            ],
            header: 0,
            header_dirty: true,
            labels_dirty: true,
        }
    }
}

/// C4's start texts, built once in `init`: ten-byte blocks "......0010", "......0020", ...
/// so the visitor can see where the 500 bytes end ("...0500") in the keyboard's box.
static mut START: [u8; START_OVER_BYTES] = [b'.'; START_OVER_BYTES];
/// Where the plain cards' text is read (C4 needs the full 512).
static mut READ_BUF: [u8; 512] = [0; 512];

pub fn fill_start(buf: &mut [u8]) {
    for (i, chunk) in buf.chunks_mut(10).enumerate() {
        let n = (i + 1) * 10;
        for b in chunk.iter_mut() {
            *b = b'.';
        }
        let digits = [b'0' + ((n / 1000) % 10) as u8, b'0' + ((n / 100) % 10) as u8, b'0' + ((n / 10) % 10) as u8, b'0' + (n % 10) as u8];
        let len = chunk.len();
        if len >= 4 {
            chunk[len - 4..].copy_from_slice(&digits);
        }
    }
}

#[allow(static_mut_refs)]
fn start_text() -> &'static [u8] {
    unsafe { &*core::ptr::addr_of!(START) }
}

fn begin_raw(node: i32, flags: i32, max: i32, init: &[u8], req: i32) -> i32 {
    unsafe { host::k_ui_text_begin(node, flags, max, init.as_ptr() as i32, init.len() as i32, req) }
}

fn end_raw(req: i32) -> i32 {
    unsafe { host::k_ui_text_end(req) }
}

/// Read a plain card's text into READ_BUF; returns the host's answer (the FULL byte length, or an error).
fn read_plain(req: i32) -> (i32, &'static [u8]) {
    let ptr = core::ptr::addr_of_mut!(READ_BUF) as *mut u8;
    let n = unsafe { host::k_ui_text_read(req, ptr as usize as i32, 512) };
    let got = if n > 0 { (n as usize).min(512) } else { 0 };
    // SAFETY: READ_BUF is a 512-byte static, touched only here, single-threaded.
    (n, unsafe { core::slice::from_raw_parts(ptr, got) })
}

/// C5: read the masked text only to count it, then wipe it at once.
fn read_masked_len(req: i32) -> i32 {
    let ptr = core::ptr::addr_of_mut!(MASK_BUF) as *mut u8;
    let n = unsafe { host::k_ui_text_read(req, ptr as usize as i32, MASKED_MAX_BYTES) };
    // SAFETY: MASK_BUF is lib.rs's 128-byte static, single-threaded.
    let buf = unsafe { core::slice::from_raw_parts_mut(ptr, MASKED_MAX_BYTES as usize) };
    wipe(buf);
    n
}

/// C7: the length only. out_cap 0 copies nothing ("out_cap 0 peeks the length").
fn read_len_only(req: i32) -> i32 {
    unsafe { host::k_ui_text_read(req, 0, 0) }
}

pub fn init(a: &mut App) {
    #[allow(static_mut_refs)]
    unsafe {
        fill_start(&mut *core::ptr::addr_of_mut!(START));
    }
    a.checks.header = find(HEADER_NODE);
    let ev = "OnInteract";
    for (i, (btn, txt, _, _)) in CARDS.iter().enumerate() {
        let node = find(btn);
        a.checks.cards[i].node = node;
        a.checks.cards[i].txt = find(txt);
        if node <= 0 {
            a.init_error = if node == 0 { -1 } else { node };
            continue;
        }
        let s = unsafe { host::k_event_subscribe(ev.as_ptr() as i32, ev.len() as i32, node, on_card_press as usize as i32) };
        if s <= 0 {
            a.init_error = if s == 0 { -1 } else { s };
        }
    }
    // A press on a result plaque opens the activation window too: note it, as lib.rs does for its walls.
    for (_, txt, _, _) in CARDS.iter() {
        let node = find(txt);
        if node > 0 {
            unsafe { host::k_event_subscribe(ev.as_ptr() as i32, ev.len() as i32, node, on_any_press as usize as i32) };
        }
    }
    if a.checks.header > 0 {
        unsafe { host::k_event_subscribe(ev.as_ptr() as i32, ev.len() as i32, a.checks.header, on_any_press as usize as i32) };
    }
}

fn card_of_node(a: &App, node: i32) -> Option<usize> {
    (0..CARDS.len()).find(|&i| a.checks.cards[i].node > 0 && a.checks.cards[i].node == node)
}

fn next_req(a: &mut App) -> i32 {
    let r = a.next_request;
    a.next_request += 1;
    r
}

/// OnInteract on a card's button.
#[no_mangle]
pub extern "C" fn on_card_press(_event_type: i32, node: i32, _p1: i32, _p2: i32) {
    let a = app();
    let Some(i) = card_of_node(a, node) else { return };
    a.last_press_s = a.now_s;
    a.chain = None; // a press supersedes a pending Enter re-arm, as in lib.rs
    press(a, i);
}

/// The press, testable without the extern wrapper.
pub fn press(a: &mut App, i: usize) {
    let now = a.now_s;
    let kind = a.checks.cards[i].kind;
    let node = a.checks.cards[i].node;
    match kind {
        Kind::EndByWorld => {
            if a.checks.cards[i].open {
                return; // the world is about to close it; a second press would only be -6
            }
            let req = next_req(a);
            let r = begin_raw(node, 0, SMALL_CAP, &[], req);
            let c = &mut a.checks.cards[i];
            *c = Card { node: c.node, txt: c.txt, ..Card::new(kind) };
            c.begin = Some(r);
            if r == 0 {
                c.req = req;
                c.open = true;
                c.end_at_s = now + END_AFTER_S;
            }
        }
        Kind::TwiceFast => {
            let req = next_req(a);
            let r = begin_raw(node, 0, SMALL_CAP, &[], req);
            // Opened: close it at once, so the next press meets no open session, only the one-a-second rule.
            let e = if r == 0 { Some(end_raw(req)) } else { None };
            let c = &mut a.checks.cards[i];
            let first = c.begin.is_none() || c.again.is_some() || c.last_begin_s < 0.0;
            if first {
                c.begin = Some(r);
                c.end_code = e;
                c.again = None;
                c.again_end = None;
                c.events_after_end = 0;
            } else {
                c.again = Some((r, now - c.last_begin_s));
                c.again_end = e;
            }
            if r == 0 {
                c.last_begin_s = now;
                c.ended_req = req;
            }
        }
        Kind::OneAtATime => {
            if a.checks.cards[i].open {
                // The second press while this card's keyboard is still up.
                let req = next_req(a);
                let r = begin_raw(node, 0, SMALL_CAP, &[], req);
                let c = &mut a.checks.cards[i];
                c.second = Some(r);
                if r == 0 {
                    // Not expected: the host let a second field open. Track it as the open one.
                    c.req = req;
                }
            } else {
                let req = next_req(a);
                let r = begin_raw(node, 0, SMALL_CAP, &[], req);
                let c = &mut a.checks.cards[i];
                *c = Card { node: c.node, txt: c.txt, ..Card::new(kind) };
                c.begin = Some(r);
                if r == 0 {
                    c.req = req;
                    c.open = true;
                }
            }
        }
        Kind::Limits => {
            if a.checks.cards[i].open {
                return;
            }
            let start = start_text();
            let one = [b'x'];
            let probes = [
                begin_raw(node, 0, LIMIT_PLAIN + 1, &[], next_req(a)),
                begin_raw(node, FLAG_MASKED, LIMIT_MASKED + 1, &[], next_req(a)),
                begin_raw(node, FLAG_MASKED, LIMIT_MASKED, &one, next_req(a)),
                begin_raw(node, 0, LIMIT_PLAIN, &start[..START_OVER_BYTES], next_req(a)),
            ];
            let req = next_req(a);
            let r = begin_raw(node, 0, LIMIT_PLAIN, &start[..START_BYTES], req);
            let c = &mut a.checks.cards[i];
            *c = Card { node: c.node, txt: c.txt, ..Card::new(kind) };
            c.probes = [Some(probes[0]), Some(probes[1]), Some(probes[2]), Some(probes[3])];
            c.begin = Some(r);
            if r == 0 {
                c.req = req;
                c.open = true;
            }
        }
        Kind::MaskedNumber | Kind::PlainNumber | Kind::Audit => {
            if a.checks.cards[i].open {
                // A second press while open: show the refusal, keep the field.
                let req = next_req(a);
                let r = begin_raw(node, 0, SMALL_CAP, &[], req);
                let c = &mut a.checks.cards[i];
                c.second = Some(r);
                if r == 0 {
                    c.req = req; // not expected: track the field the host opened
                }
                c.dirty = true;
                return;
            }
            let (flags, cap) = match kind {
                Kind::MaskedNumber => (FLAG_MASKED | FLAG_LAYOUT_NUMBER, MASKED_SMALL_CAP),
                Kind::PlainNumber => (FLAG_LAYOUT_NUMBER, NUMBER_CAP),
                _ => (0, SMALL_CAP),
            };
            let req = next_req(a);
            let r = begin_raw(node, flags, cap, &[], req);
            let c = &mut a.checks.cards[i];
            *c = Card { node: c.node, txt: c.txt, ..Card::new(kind) };
            c.begin = Some(r);
            if r == 0 {
                c.req = req;
                c.open = true;
            }
        }
    }
    a.checks.cards[i].dirty = true;
}

/// OnTextInput for a card's request. Returns true when the event was a card's.
pub fn on_text_input(a: &mut App, request_id: i32, code: i32) -> bool {
    for i in 0..CARDS.len() {
        let c = &mut a.checks.cards[i];
        if c.ended_req != 0 && request_id == c.ended_req {
            // After k_ui_text_end the host owes no event; count any that comes.
            c.events_after_end += 1;
            c.dirty = true;
            return true;
        }
        if c.req == 0 || request_id != c.req {
            continue;
        }
        match c.kind {
            Kind::MaskedNumber => {
                let n = read_masked_len(request_id);
                if n >= 0 || c.bytes.is_none() {
                    c.bytes = Some(n);
                }
            }
            Kind::Audit => {
                let n = read_len_only(request_id);
                if n >= 0 || c.bytes.is_none() {
                    c.bytes = Some(n);
                }
            }
            _ => {
                let (n, bytes) = read_plain(request_id);
                if n >= 0 || c.bytes.is_none() {
                    c.bytes = Some(n);
                }
                if n >= 0 {
                    c.text.clear();
                    // C4 keeps the tail (the start text is 500 dots and numbers); C6 the head.
                    let shown = if c.kind == Kind::Limits && bytes.len() > 16 { &bytes[bytes.len() - 16..] } else { bytes };
                    match core::str::from_utf8(shown) {
                        Ok(s) => c.text.push(s),
                        Err(_) => c.text.push("(not UTF-8)"),
                    };
                }
            }
        }
        c.dirty = true;
        if code == CODE_CHANGED {
            return true;
        }
        c.ended = match code {
            CODE_SUBMITTED => Ended::Enter,
            CODE_CLOSED => Ended::Closed,
            CODE_TAKEN => Ended::Taken,
            x => Ended::Other(x),
        };
        c.open = false;
        c.req = 0;
        return true;
    }
    false
}

/// Is a card's session open (so lib.rs's pair knows a press there will be refused)?
pub fn any_open(a: &App) -> bool {
    a.checks.cards.iter().any(|c| c.open)
}

pub fn tick(a: &mut App) {
    let now = a.now_s;
    for c in a.checks.cards.iter_mut() {
        // C1: the read on the tick after the end, then the world's own close.
        if c.read_next_due {
            let (n, _) = read_plain(c.ended_req);
            c.read_next = Some(n);
            c.read_next_due = false;
            c.dirty = true;
        }
        if c.kind == Kind::EndByWorld && c.open && now >= c.end_at_s {
            let req = c.req;
            let e = end_raw(req);
            c.end_code = Some(e);
            // Readable until the first tick after the end: read it now, then on the next tick.
            let (n, _) = read_plain(req);
            c.read_same = Some(n);
            c.read_next_due = true;
            c.open = false;
            c.req = 0;
            c.ended_req = req;
            c.dirty = true;
        }
    }
}

fn code_word(c: i32) -> &'static str {
    match c {
        0 => "ok",
        -1 => "no node",
        -2 => "no permission",
        -3 => "bad pointer",
        -6 => "too soon",
        -7 => "bad size",
        -8 => "unsupported",
        -11 => "no fresh press",
        _ => "code",
    }
}

fn push_end(b: &mut Buf<128>, e: Ended) {
    match e {
        Ended::No => b.push("open"),
        Ended::Enter => b.push("ended: Enter"),
        Ended::Closed => b.push("ended: closed"),
        Ended::Taken => b.push("ended: taken"),
        Ended::Other(x) => b.push("ended: code ").push_i32(x),
    };
}

/// One decimal place, for a seconds value 0..999.
fn push_secs(b: &mut Buf<128>, s: f32) {
    let t = (s.max(0.0) * 10.0 + 0.5) as i32;
    b.push_i32(t / 10).push(".").push_i32(t % 10).push(" s");
}

pub fn card_text(c: &Card) -> Buf<128> {
    let mut b = Buf::new();
    match c.kind {
        Kind::EndByWorld => match (c.begin, c.end_code) {
            (None, _) => {
                b.push("Press: a field opens and\nthe world closes it after\n3 s with k_ui_text_end.\nNo event should follow.");
            }
            (Some(r), _) if r != 0 => {
                b.push("begin ").push_i32(r).push(" (").push(code_word(r)).push(")\nnothing opened");
            }
            (Some(_), None) => {
                b.push("begin 0: open\nthe world closes it soon\n");
                if c.ended != Ended::No {
                    b.push("you closed it first:\n");
                    push_end(&mut b, c.ended);
                } else {
                    b.push("(watch the keyboard go)");
                }
            }
            (Some(_), Some(e)) => {
                b.push("begin 0, end ").push_i32(e).push("\nevents after end: ").push_i32(c.events_after_end);
                b.push(if c.events_after_end == 0 { " (pass)" } else { " (FAIL)" });
                b.push("\nread: ");
                match c.read_same {
                    Some(n) => b.push_i32(n),
                    None => b.push("-"),
                };
                b.push(" at end, ");
                match c.read_next {
                    Some(n) => b.push_i32(n),
                    None => b.push("-"),
                };
                b.push(" next");
                b.push("\nkeyboard should be gone");
            }
        },
        Kind::TwiceFast => match (c.begin, c.again) {
            (None, _) => {
                b.push("Press, then press again\nwithin a second.\nEach press opens a field\nand closes it at once.");
            }
            (Some(r), again) => {
                b.push("1st: begin ").push_i32(r);
                if let Some(e) = c.end_code {
                    b.push(", end ").push_i32(e);
                }
                match again {
                    None => {
                        b.push("\nnow press again, fast");
                    }
                    Some((r2, gap)) => {
                        b.push("\nagain after ");
                        push_secs(&mut b, gap);
                        b.push(": ").push_i32(r2);
                        if let Some(e2) = c.again_end {
                            b.push(", end ").push_i32(e2);
                        }
                        b.push(match r2 {
                            -6 => "\n-6: one a second (pass)",
                            0 => "\nopened: over 1 s, retry",
                            _ => "\nunexpected code",
                        });
                    }
                }
                b.push("\nevents after end: ").push_i32(c.events_after_end);
            }
        },
        Kind::OneAtATime => match (c.begin, c.second) {
            (None, _) => {
                b.push("Press once to open a field.\nWith its keyboard up,\npress this card again.");
            }
            (Some(r), None) => {
                b.push("1st: begin ").push_i32(r);
                if r != 0 {
                    b.push(" (").push(code_word(r)).push(")");
                } else {
                    if c.open {
                        b.push(" (open)\nnow press this card again\nwith the keyboard up");
                    } else {
                        b.push("\n");
                        push_end(&mut b, c.ended);
                        b.push("\npress again to retry");
                    }
                }
            }
            (Some(r), Some(r2)) => {
                b.push("1st: begin ").push_i32(r);
                b.push("\n2nd, still open: ").push_i32(r2);
                b.push(match r2 {
                    -6 => "\n-6: one field per world\n(pass)",
                    -11 => "\n-11: the keyboard held\nthe press (record it)",
                    _ => "\nunexpected code",
                });
            }
        },
        Kind::Limits => match c.begin {
            None => {
                b.push("Press once: four refusals,\nthen a 512-byte field with\n500 bytes in it. Type 20\nmore, then press Enter.");
            }
            Some(r) => {
                let p = |k: usize| c.probes[k].unwrap_or(1);
                b.push("plain 513: ").push_i32(p(0)).push(", pw 129: ").push_i32(p(1));
                b.push("\npw start: ").push_i32(p(2)).push(", 600>512: ").push_i32(p(3));
                b.push("\n512 field: begin ").push_i32(r);
                if r != 0 {
                    b.push(" (").push(code_word(r)).push(")");
                }
                if let Some(n) = c.bytes {
                    b.push("\nread ").push_i32(n).push(" bytes, max 512");
                }
            }
        },
        Kind::MaskedNumber | Kind::PlainNumber | Kind::Audit => {
            let intro = match c.kind {
                Kind::MaskedNumber => "Masked + number layout:\nexpect the PASSWORD keys,\nnot numbers. Cap 8 bytes:\ntype 10, then Enter.",
                Kind::PlainNumber => "Plain + number layout:\nexpect the NUMBER keys.\nType a few digits,\nthen Enter.",
                _ => "Type the audit marker,\nthen Enter. The world never\ncopies or shows the text:\nit reads the length only.",
            };
            match c.begin {
                None => {
                    b.push(intro);
                }
                Some(r) => {
                    b.push("begin ").push_i32(r);
                    if r != 0 {
                        b.push(" (").push(code_word(r)).push(")");
                    }
                    match (c.kind, c.bytes) {
                        (_, None) => {
                            b.push("\nnothing typed yet");
                        }
                        (Kind::PlainNumber, Some(n)) if n >= 0 => {
                            b.push("\nYou typed: ").push(c.text.as_str());
                        }
                        (Kind::MaskedNumber, Some(n)) if n >= 0 => {
                            b.push("\ngot ").push_i32(n).push(" bytes (cap 8)");
                        }
                        (_, Some(n)) if n >= 0 => {
                            b.push("\nreceived ").push_i32(n).push(" bytes\n(never copied or shown)");
                        }
                        (_, Some(n)) => {
                            b.push("\nread error ").push_i32(n);
                        }
                    }
                    b.push("\n");
                    push_end(&mut b, c.ended);
                    if let Some(s) = c.second {
                        b.push(", again ").push_i32(s);
                    }
                }
            }
        }
    }
    b
}

/// Wipe what the cards read (k_shutdown).
pub fn shutdown() {
    #[allow(static_mut_refs)]
    unsafe {
        wipe(&mut *core::ptr::addr_of_mut!(READ_BUF));
    }
}

/// Show every card whose text changed. Returns true when the host refused one (lib.rs retries).
pub fn render(a: &mut App) -> bool {
    let mut failed = false;
    if a.checks.labels_dirty {
        let mut ok = true;
        for (i, (_, _, _, label)) in CARDS.iter().enumerate() {
            ok &= show(a.checks.cards[i].node, label) == 0;
        }
        a.checks.labels_dirty = !ok;
        failed |= !ok;
    }
    if a.checks.header_dirty {
        a.checks.header_dirty = show(a.checks.header, HEADER_TEXT) != 0;
        failed |= a.checks.header_dirty;
    }
    for i in 0..CARDS.len() {
        if a.checks.cards[i].dirty {
            let t = card_text(&a.checks.cards[i]);
            a.checks.cards[i].dirty = show(a.checks.cards[i].txt, t.as_str()) != 0;
            failed |= a.checks.cards[i].dirty;
        }
    }
    failed
}

/// The result plaque's width and the button's, in metres (../tools/build_glb.mjs builds these sizes;
/// tests.rs checks every line against them with Roboto's advances).
pub const CARD_WIDTH_M: f32 = 1.0;
pub const BUTTON_WIDTH_M: f32 = 0.86;
