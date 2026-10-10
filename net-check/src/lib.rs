//! net-check — the network device-test world (`world://net-check.micknerks`).
//!
//! @kosmos-system  Content (KosmosWorlds) — network test worlds
//! @kosmos-owner   TW (KOS-983)
//! @kosmos-level   host API level 4 (`k_net_fetch`, `k_net_read`, `k_net_status`, `OnNetResult`)
//!
//! One button per case in `NETWORK_BUILD_PLAN.md` §3. Each press issues ONE
//! call and the board shows what came back, with what was expected and a
//! PASS/CHECK verdict, so a sitting needs no USB cable to read a result.
//!
//! | Button       | Call                                    | Expected |
//! |--------------|-----------------------------------------|----------|
//! | `BtnEcho`    | GET  A/echo                             | 200, header audit with no cookie/auth/referer/origin |
//! | `BtnScore`   | POST A/score (JSON)                     | 200 |
//! | `BtnScores`  | GET  A/scores                           | 200, the entries just posted |
//! | `BtnName`    | `k_ui_prompt`, then POST A/score with the answer | the sheet's footer names A; then 200 |
//! | `BtnBig`     | GET  A/big (300 KiB)                    | -5 too large |
//! | `BtnSlow`    | GET  A/slow (12 s)                      | 0 no answer, at about 10 s |
//! | `BtnRedirA`  | GET  A/same-redirect (302 → A/echo)     | 200 |
//! | `BtnRedirB`  | GET  A/cross-redirect (307 → B)         | -2 refused in flight; B records no hit |
//! | `BtnGzip`    | GET  A/gzip (`Content-Encoding: x-gzip`)| 0 no answer (refused at the header) |
//! | `BtnGzipStd` | GET  A/gzip-std (`gzip`; Cloudflare inflates it) | -5 too large |
//! | `BtnServerB` | GET  B/echo (B is not in `connect`)     | `k_net_fetch` returns -2 at once; B records no hit |
//!
//! The host functions are declared here (`mod host`) rather than through the
//! SDK, because the SDK's `net` module (lane SDK-1) has not merged. Every
//! signature is the client's levels table at `a47d33b`.
//!
//! **Nothing here discards a return code.** A press that shows nothing would
//! have half a dozen causes that look alike in a headset.

#![cfg_attr(target_arch = "wasm32", no_std, no_main)]

#[cfg(not(target_arch = "wasm32"))]
fn main() {}

#[cfg(all(target_arch = "wasm32", not(test)))]
#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

// ---------------------------------------------------------------------------
// Host imports (module "kosmos"). Signatures: client host-api-levels.json @ a47d33b.
// ---------------------------------------------------------------------------

#[cfg(target_arch = "wasm32")]
mod host {
    #[link(wasm_import_module = "kosmos")]
    extern "C" {
        /// `(ii)i` scene_read, level 0. Returns a node handle, 0 = not found.
        pub fn k_node_find(name_ptr: i32, name_len: i32) -> i32;
        /// `(iiif)i` ui_basic, level 0 (real since 2). Text is 1..=256 bytes.
        pub fn k_ui_show_world_text(node: i32, text_ptr: i32, text_len: i32, offset_y: f32) -> i32;
        /// `(iiiii)i` ui_basic, level 2. Activation-gated; the answer arrives as `OnPromptResult`.
        pub fn k_ui_prompt(prompt_ptr: i32, prompt_len: i32, out_ptr: i32, out_cap: i32, request_id: i32) -> i32;
        /// `(iiii)i` events, level 0. Returns a subscription id, 0 = failed.
        pub fn k_event_subscribe(name_ptr: i32, name_len: i32, node: i32, callback_fn_index: i32) -> i32;
        /// `(iii)i` events, level 0.
        pub fn k_event_subscribe_global(name_ptr: i32, name_len: i32, callback_fn_index: i32) -> i32;
        /// `(iiiiiii)i` network, level 4. 0 = queued; the result arrives as `OnNetResult`.
        pub fn k_net_fetch(method: i32, url_ptr: i32, url_len: i32, body_ptr: i32, body_len: i32, flags: i32, request_id: i32) -> i32;
        /// `(iii)i` network, level 4. `out_cap == 0` peeks the length.
        pub fn k_net_read(request_id: i32, out_ptr: i32, out_cap: i32) -> i32;
        /// `()i` network, level 4. 1 available, 0 not, -2 capability undeclared.
        pub fn k_net_status() -> i32;
    }
}

/// Host-side stand-ins so `cargo test` links. They model "no host": nothing found,
/// every network call refused.
#[cfg(not(target_arch = "wasm32"))]
#[allow(clippy::too_many_arguments)]
mod host {
    pub unsafe fn k_node_find(_p: i32, _l: i32) -> i32 { 0 }
    pub unsafe fn k_ui_show_world_text(_n: i32, _p: i32, _l: i32, _o: f32) -> i32 { 0 }
    pub unsafe fn k_ui_prompt(_p: i32, _l: i32, _o: i32, _c: i32, _r: i32) -> i32 { 0 }
    pub unsafe fn k_event_subscribe(_p: i32, _l: i32, _n: i32, _c: i32) -> i32 { 0 }
    pub unsafe fn k_event_subscribe_global(_p: i32, _l: i32, _c: i32) -> i32 { 0 }
    pub unsafe fn k_net_fetch(_m: i32, _u: i32, _ul: i32, _b: i32, _bl: i32, _f: i32, _r: i32) -> i32 { -2 }
    pub unsafe fn k_net_read(_r: i32, _o: i32, _c: i32) -> i32 { -7 }
    pub unsafe fn k_net_status() -> i32 { 0 }
}

// ---------------------------------------------------------------------------
// Contract constants — node names mirror net-test-tools/build_glb.mjs; URLs mirror the
// deployed test Workers and manifest.json's `network.connect`.
// ---------------------------------------------------------------------------

const A: &str = "https://kosmos-net-test-a.micknerks.workers.dev";
const B: &str = "https://kosmos-net-test-b.micknerks.workers.dev";

const METHOD_GET: i32 = 0;
const METHOD_POST: i32 = 1;
/// `flags` bit 1: the body is JSON (`application/json`).
const FLAG_JSON: i32 = 1 << 1;

/// What a case expects back. `Sync(code)`: `k_net_fetch` itself returns `code`.
/// `Event(status)`: the call queues and `OnNetResult` carries `status`.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Expect {
    Sync(i32),
    Event(i32),
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Kind {
    Echo,
    Score,
    Scores,
    Name,
    Big,
    Slow,
    RedirA,
    RedirB,
    Gzip,
    GzipStd,
    ServerB,
}

struct Case {
    node: &'static str,
    label: &'static str,
    kind: Kind,
    expect: Expect,
}

/// In arc order, left to right. 11 labels + 8 board lines = 19 of the 32 world texts.
const CASES: [Case; 11] = [
    Case { node: "BtnEcho", label: "ECHO", kind: Kind::Echo, expect: Expect::Event(200) },
    Case { node: "BtnScore", label: "SCORE +", kind: Kind::Score, expect: Expect::Event(200) },
    Case { node: "BtnScores", label: "SCORES", kind: Kind::Scores, expect: Expect::Event(200) },
    Case { node: "BtnName", label: "NAME (prompt)", kind: Kind::Name, expect: Expect::Event(200) },
    Case { node: "BtnBig", label: "BIG 300K", kind: Kind::Big, expect: Expect::Event(-5) },
    Case { node: "BtnSlow", label: "SLOW 12s", kind: Kind::Slow, expect: Expect::Event(0) },
    Case { node: "BtnRedirA", label: "REDIR A", kind: Kind::RedirA, expect: Expect::Event(200) },
    Case { node: "BtnRedirB", label: "REDIR to B", kind: Kind::RedirB, expect: Expect::Event(-2) },
    Case { node: "BtnGzip", label: "GZIP", kind: Kind::Gzip, expect: Expect::Event(0) },
    Case { node: "BtnGzipStd", label: "GZIP via CF", kind: Kind::GzipStd, expect: Expect::Event(-5) },
    Case { node: "BtnServerB", label: "SERVER B", kind: Kind::ServerB, expect: Expect::Sync(-2) },
];

/// Board lines, top to bottom (anchors in the GLB).
const LINES: [&str; 8] = ["LineA", "LineB", "LineC", "LineD", "LineE", "LineF", "LineG", "LineH"];
const LINE_TITLE: usize = 0;
const LINE_STATUS: usize = 1;
const LINE_RESULT: usize = 2;
const LINE_BODY_FIRST: usize = 3; // LineD..LineG carry the body excerpt
const BODY_LINES: usize = 4;
const LINE_COUNTERS: usize = 7;

/// Characters per board line (the board is 3.6 m; world text is ~3.6 cm a character).
const BODY_CHARS_PER_LINE: usize = 64;
/// Label text sits this far above a button's centre; board text this far above its anchor.
const LABEL_OFFSET_M: f32 = 0.12;
const LINE_OFFSET_M: f32 = 0.01;

const PROMPT_TEXT: &str = "Your name for the score board (sent to the test server)";
const REQ_PROMPT_NAME: i32 = 7001;

/// Responses up to this size are shown; larger ones are reported by length only.
const READ_BUF_BYTES: usize = 8192;
/// The score board name is kept to this many bytes of [A-Za-z0-9 ._-].
const MAX_NAME_BYTES: usize = 24;

// ---------------------------------------------------------------------------
// Module state (single-threaded world wasm; `static mut` by value only)
// ---------------------------------------------------------------------------

static mut BUTTONS: [i32; 11] = [0; 11];
static mut LINE_NODES: [i32; 8] = [0; 8];
static mut NEXT_REQUEST_ID: i32 = 1;
/// The kind of each in-flight request, keyed by request id modulo 64.
static mut IN_FLIGHT: [(i32, u8); 64] = [(0, 0); 64];
static mut SENT: i32 = 0;
static mut REFUSED: i32 = 0;
static mut ANSWERED: i32 = 0;
static mut SCORE_SEQ: i32 = 0;
static mut READ_BUF: [u8; READ_BUF_BYTES] = [0; READ_BUF_BYTES];
/// The host writes the prompt answer here LATER; it must outlive the call.
static mut PROMPT_ANSWER: [u8; 256] = [0; 256];
static mut NAME: [u8; MAX_NAME_BYTES] = [0; MAX_NAME_BYTES];
static mut NAME_LEN: usize = 0;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn k_init() {
    unsafe {
        for (i, name) in LINES.iter().enumerate() {
            LINE_NODES[i] = find(name);
        }
    }

    let mut found = 0;
    for (i, case) in CASES.iter().enumerate() {
        let node = find(case.node);
        unsafe { BUTTONS[i] = node; }
        if node != 0 {
            found += 1;
            show(node, case.label, LABEL_OFFSET_M);
            let ev = "OnInteract";
            unsafe {
                host::k_event_subscribe(ev.as_ptr() as i32, ev.len() as i32, node, on_button as usize as i32);
            }
        }
    }
    let ev = "OnNetResult";
    let net_sub = unsafe { host::k_event_subscribe_global(ev.as_ptr() as i32, ev.len() as i32, on_net_result as usize as i32) };
    let ev = "OnPromptResult";
    let prompt_sub = unsafe { host::k_event_subscribe_global(ev.as_ptr() as i32, ev.len() as i32, on_prompt_result as usize as i32) };

    line(LINE_TITLE, "net-check.micknerks : press a button, read the answer here");

    let mut t = TextBuf::new();
    t.push("init: buttons ");
    t.push_i32(found);
    t.push("/11 | OnNetResult ");
    t.push(if net_sub != 0 { "ok" } else { "REFUSED" });
    t.push(" | prompt ");
    t.push(if prompt_sub != 0 { "ok" } else { "REFUSED" });
    t.push(" | ");
    push_net_status(&mut t);
    line(LINE_STATUS, t.as_str());

    line(LINE_RESULT, "last: (nothing yet)");
    refresh_counters();
}

#[no_mangle]
pub extern "C" fn k_tick(_delta: f32) {}

#[no_mangle]
pub extern "C" fn k_shutdown() {}

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

/// A button was pressed: issue that button's one call.
#[no_mangle]
pub extern "C" fn on_button(_event_type: i32, node: i32, _p1: i32, _p2: i32) {
    let Some(i) = (0..CASES.len()).find(|&i| unsafe { BUTTONS[i] } == node && node != 0) else {
        return;
    };
    let case = &CASES[i];

    // The status line is refreshed on every press, so a switch flip, a Ghost
    // toggle or airplane mode shows up as `k_net_status` 0 before the result.
    let mut s = TextBuf::new();
    s.push("press ");
    s.push(case.label);
    s.push(" | ");
    push_net_status(&mut s);
    line(LINE_STATUS, s.as_str());

    match case.kind {
        Kind::Name => {
            let answer_ptr = core::ptr::addr_of_mut!(PROMPT_ANSWER) as *mut u8 as usize as i32;
            let rc = unsafe {
                host::k_ui_prompt(PROMPT_TEXT.as_ptr() as i32, PROMPT_TEXT.len() as i32, answer_ptr, 256, REQ_PROMPT_NAME)
            };
            let mut t = TextBuf::new();
            t.push("NAME -> prompt ");
            if rc == 0 {
                t.push("opened (check the footer names net-check-a)");
            } else {
                t.push("refused: ");
                t.push_code(rc);
            }
            line(LINE_RESULT, t.as_str());
            clear_body();
        }
        Kind::Score => {
            let seq = unsafe { SCORE_SEQ = SCORE_SEQ.wrapping_add(1); SCORE_SEQ };
            post_score(case, seq);
        }
        _ => {
            let url = url_for(case.kind);
            let mut u = TextBuf::new();
            u.push(url.0);
            u.push(url.1);
            fetch(case, METHOD_GET, u.as_str(), &[], 0);
        }
    }
}

/// `OnNetResult`: param1 = request id, param2 = HTTP status | 0 | -2 | -5.
#[no_mangle]
pub extern "C" fn on_net_result(_event_type: i32, _node: i32, request_id: i32, status: i32) {
    unsafe { ANSWERED = ANSWERED.wrapping_add(1); }
    let kind = take_in_flight(request_id);
    let case = kind.and_then(|k| CASES.iter().find(|c| c.kind as u8 == k));

    let mut t = TextBuf::new();
    match case {
        Some(c) => t.push(c.label),
        None => t.push("?"),
    }
    t.push(" #");
    t.push_i32(request_id);
    t.push(" -> ");
    push_status(&mut t, status);

    // The length, by the peek (out_cap 0 consumes nothing).
    let len = unsafe { host::k_net_read(request_id, 0, 0) };
    if status >= 100 {
        t.push(", ");
        if len >= 0 {
            t.push_i32(len);
            t.push(" B");
        } else {
            t.push("read ");
            t.push_code(len);
        }
    }
    if let Some(c) = case {
        push_verdict(&mut t, c.expect, Expect::Event(status));
    }
    line(LINE_RESULT, t.as_str());

    if status >= 100 && len > 0 && (len as usize) <= READ_BUF_BYTES {
        let buf_ptr = core::ptr::addr_of_mut!(READ_BUF) as *mut u8;
        let got = unsafe { host::k_net_read(request_id, buf_ptr as usize as i32, READ_BUF_BYTES as i32) };
        if got >= 0 {
            let body = unsafe { core::slice::from_raw_parts(buf_ptr, got as usize) };
            show_body(body);
        } else {
            let mut b = TextBuf::new();
            b.push("body read refused: ");
            b.push_code(got);
            show_body(b.as_str().as_bytes());
        }
    } else if status >= 100 && len > READ_BUF_BYTES as i32 {
        show_body(b"(body larger than this world shows)");
    } else {
        clear_body();
    }
    refresh_counters();
}

/// `OnPromptResult`: param1 = our request id, param2 = bytes written | -1 cancelled | -2 muted | -3 write failed.
#[no_mangle]
pub extern "C" fn on_prompt_result(_event_type: i32, _node: i32, request_id: i32, result: i32) {
    if request_id != REQ_PROMPT_NAME {
        return;
    }
    let mut t = TextBuf::new();
    if result <= 0 {
        t.push("NAME -> ");
        t.push(match result {
            0 => "empty answer, nothing sent",
            -1 => "cancelled",
            -2 => "muted after 3 cancels",
            -3 => "host write failed",
            _ => "unknown prompt result",
        });
        line(LINE_RESULT, t.as_str());
        return;
    }
    let n = (result as usize).min(256);
    let raw = unsafe { core::slice::from_raw_parts(core::ptr::addr_of!(PROMPT_ANSWER) as *const u8, n) };
    let len = sanitize_name(raw, unsafe { &mut *core::ptr::addr_of_mut!(NAME) });
    unsafe { NAME_LEN = len; }
    let seq = unsafe { SCORE_SEQ = SCORE_SEQ.wrapping_add(1); SCORE_SEQ };
    let name_case = CASES.iter().find(|c| c.kind == Kind::Name).unwrap_or(&CASES[3]);
    post_score(name_case, seq);
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

fn url_for(kind: Kind) -> (&'static str, &'static str) {
    match kind {
        Kind::Echo => (A, "/echo"),
        Kind::Scores => (A, "/scores"),
        Kind::Big => (A, "/big"),
        Kind::Slow => (A, "/slow"),
        Kind::RedirA => (A, "/same-redirect"),
        Kind::RedirB => (A, "/cross-redirect"),
        Kind::Gzip => (A, "/gzip"),
        Kind::GzipStd => (A, "/gzip-std"),
        Kind::ServerB => (B, "/echo"),
        Kind::Score | Kind::Name => (A, "/score"),
    }
}

/// POST {"name": .., "score": 100 + seq} to A/score.
fn post_score(case: &Case, seq: i32) {
    let mut body = TextBuf::new();
    body.push("{\"name\":\"");
    let name_len = unsafe { NAME_LEN };
    if name_len == 0 {
        body.push("quest");
    } else {
        let name = unsafe { core::slice::from_raw_parts(core::ptr::addr_of!(NAME) as *const u8, name_len) };
        body.push(core::str::from_utf8(name).unwrap_or("quest"));
    }
    body.push("\",\"score\":");
    body.push_i32(100 + seq);
    body.push("}");
    let mut u = TextBuf::new();
    u.push(A);
    u.push("/score");
    fetch(case, METHOD_POST, u.as_str(), body.as_str().as_bytes(), FLAG_JSON);
}

/// Issue one `k_net_fetch` and report a synchronous refusal on the board.
fn fetch(case: &Case, method: i32, url: &str, body: &[u8], flags: i32) {
    let id = unsafe {
        let id = NEXT_REQUEST_ID;
        NEXT_REQUEST_ID = if NEXT_REQUEST_ID >= 1_000_000 { 1 } else { NEXT_REQUEST_ID + 1 };
        id
    };
    let body_ptr = if body.is_empty() { 0 } else { body.as_ptr() as i32 };
    let rc = unsafe {
        host::k_net_fetch(method, url.as_ptr() as i32, url.len() as i32, body_ptr, body.len() as i32, flags, id)
    };
    if rc == 0 {
        unsafe { SENT = SENT.wrapping_add(1); }
        put_in_flight(id, case.kind as u8);
        let mut t = TextBuf::new();
        t.push(case.label);
        t.push(" #");
        t.push_i32(id);
        t.push(" -> queued, waiting for OnNetResult");
        if let Expect::Sync(code) = case.expect {
            t.push(" (expected ");
            t.push_i32(code);
            t.push(" at once: CHECK)");
        }
        line(LINE_RESULT, t.as_str());
    } else {
        unsafe { REFUSED = REFUSED.wrapping_add(1); }
        let mut t = TextBuf::new();
        t.push(case.label);
        t.push(" #");
        t.push_i32(id);
        t.push(" -> fetch refused: ");
        t.push_code(rc);
        push_verdict(&mut t, case.expect, Expect::Sync(rc));
        line(LINE_RESULT, t.as_str());
    }
    clear_body();
    refresh_counters();
}

fn put_in_flight(id: i32, kind: u8) {
    unsafe { IN_FLIGHT[(id as usize) % 64] = (id, kind + 1); }
}

/// Returns the request's kind (as `Kind as u8`) and forgets it.
fn take_in_flight(id: i32) -> Option<u8> {
    if id <= 0 {
        return None;
    }
    let slot = (id as usize) % 64;
    let (sid, k) = unsafe { IN_FLIGHT[slot] };
    if sid == id && k != 0 {
        unsafe { IN_FLIGHT[slot] = (0, 0); }
        Some(k - 1)
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

fn find(name: &str) -> i32 {
    unsafe { host::k_node_find(name.as_ptr() as i32, name.len() as i32) }
}

fn show(node: i32, text: &str, offset: f32) -> i32 {
    if node == 0 || text.is_empty() {
        return -1;
    }
    unsafe { host::k_ui_show_world_text(node, text.as_ptr() as i32, text.len() as i32, offset) }
}

fn line(i: usize, text: &str) {
    let node = unsafe { LINE_NODES[i] };
    // An empty line is shown as a single space: the host refuses zero-length text.
    show(node, if text.is_empty() { " " } else { text }, LINE_OFFSET_M);
}

fn clear_body() {
    for k in 0..BODY_LINES {
        line(LINE_BODY_FIRST + k, " ");
    }
}

/// Show up to four lines of the body, printable ASCII only (others become '.').
fn show_body(body: &[u8]) {
    for k in 0..BODY_LINES {
        let start = k * BODY_CHARS_PER_LINE;
        let mut t = TextBuf::new();
        if start < body.len() {
            let end = (start + BODY_CHARS_PER_LINE).min(body.len());
            for &b in &body[start..end] {
                t.push_byte(if (0x20..=0x7e).contains(&b) { b } else { b'.' });
            }
        }
        line(LINE_BODY_FIRST + k, t.as_str());
    }
}

fn refresh_counters() {
    let mut t = TextBuf::new();
    unsafe {
        t.push("queued ");
        t.push_i32(SENT);
        t.push(" | refused at once ");
        t.push_i32(REFUSED);
        t.push(" | answered ");
        t.push_i32(ANSWERED);
        t.push(" | next id ");
        t.push_i32(NEXT_REQUEST_ID);
    }
    line(LINE_COUNTERS, t.as_str());
}

fn push_net_status(t: &mut TextBuf) {
    let s = unsafe { host::k_net_status() };
    t.push("k_net_status ");
    t.push_i32(s);
    t.push(match s {
        1 => " available",
        0 => " NOT available",
        -2 => " capability undeclared",
        _ => " ?",
    });
}

/// An `OnNetResult` status in words.
fn push_status(t: &mut TextBuf, status: i32) {
    match status {
        0 => t.push("0 no answer"),
        -2 => t.push("-2 refused in flight"),
        -5 => t.push("-5 too large"),
        s if (100..=599).contains(&s) => {
            t.push("HTTP ");
            t.push_i32(s);
        }
        s => {
            t.push("status ");
            t.push_i32(s);
        }
    }
}

/// " (expect X) PASS" or " (expect X) CHECK".
fn push_verdict(t: &mut TextBuf, expect: Expect, got: Expect) {
    t.push(" (expect ");
    match expect {
        Expect::Sync(c) => {
            t.push("fetch ");
            t.push_i32(c);
        }
        Expect::Event(c) => t.push_i32(c),
    }
    t.push(if expect == got { ") PASS" } else { ") CHECK" });
}

/// Keep [A-Za-z0-9 ._-] only, at most `out.len()` bytes. Returns the kept length.
fn sanitize_name(raw: &[u8], out: &mut [u8]) -> usize {
    let mut n = 0;
    for &b in raw {
        if n >= out.len() {
            break;
        }
        if b.is_ascii_alphanumeric() || b == b' ' || b == b'.' || b == b'_' || b == b'-' {
            out[n] = b;
            n += 1;
        }
    }
    n
}

// ---------------------------------------------------------------------------
// A tiny fixed-size text builder (no allocator in a no_std world).
// ---------------------------------------------------------------------------

struct TextBuf {
    buf: [u8; 200],
    len: usize,
}

impl TextBuf {
    const fn new() -> Self {
        Self { buf: [0u8; 200], len: 0 }
    }

    fn push_byte(&mut self, b: u8) {
        if self.len < self.buf.len() {
            self.buf[self.len] = b;
            self.len += 1;
        }
    }

    fn push(&mut self, s: &str) {
        for &b in s.as_bytes() {
            self.push_byte(b);
        }
    }

    fn push_i32(&mut self, v: i32) {
        if v < 0 {
            self.push("-");
        }
        let mut rest = v.unsigned_abs();
        if rest == 0 {
            self.push("0");
            return;
        }
        let mut digits = [0u8; 10];
        let mut n = 0;
        while rest > 0 {
            digits[n] = b'0' + (rest % 10) as u8;
            rest /= 10;
            n += 1;
        }
        while n > 0 {
            n -= 1;
            self.push_byte(digits[n]);
        }
    }

    /// A host return code in words and numbers: "ERR_RATE_LIMITED (-6)".
    fn push_code(&mut self, rc: i32) {
        self.push(match rc {
            -1 => "ERR_INVALID_HANDLE",
            -2 => "ERR_PERMISSION_DENIED",
            -3 => "ERR_OUT_OF_BOUNDS",
            -4 => "ERR_ASSET_NOT_FOUND",
            -5 => "ERR_QUOTA_EXCEEDED",
            -6 => "ERR_RATE_LIMITED",
            -7 => "ERR_INVALID_ARGUMENT",
            -8 => "ERR_NOT_SUPPORTED",
            -11 => "ERR_NO_ACTIVATION",
            _ => "code",
        });
        self.push(" (");
        self.push_i32(rc);
        self.push(")");
    }

    fn as_str(&self) -> &str {
        core::str::from_utf8(&self.buf[..self.len]).unwrap_or("")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_names_never_end_in_a_digit() {
        for c in CASES.iter() {
            assert!(!c.node.ends_with(|ch: char| ch.is_ascii_digit()), "{}", c.node);
        }
        for l in LINES {
            assert!(!l.ends_with(|ch: char| ch.is_ascii_digit()), "{l}");
        }
    }

    #[test]
    fn every_url_is_under_the_granted_origin_or_is_b() {
        for c in CASES.iter() {
            let (origin, path) = url_for(c.kind);
            assert!(path.starts_with('/'));
            if c.kind == Kind::ServerB {
                assert_eq!(origin, B);
            } else {
                assert_eq!(origin, A);
            }
        }
    }

    #[test]
    fn the_longest_result_line_fits_the_host_limit() {
        let mut t = TextBuf::new();
        t.push("NAME (prompt) #1000000 -> fetch refused: ERR_PERMISSION_DENIED (-2)");
        push_verdict(&mut t, Expect::Sync(-2), Expect::Sync(-2));
        assert!(t.as_str().len() <= 256);
        assert!(PROMPT_TEXT.len() <= 256);
    }

    #[test]
    fn verdicts() {
        let mut t = TextBuf::new();
        push_verdict(&mut t, Expect::Event(-5), Expect::Event(-5));
        assert_eq!(t.as_str(), " (expect -5) PASS");
        let mut t = TextBuf::new();
        push_verdict(&mut t, Expect::Sync(-2), Expect::Sync(-6));
        assert_eq!(t.as_str(), " (expect fetch -2) CHECK");
    }

    #[test]
    fn sanitize_keeps_only_safe_name_bytes() {
        let mut out = [0u8; MAX_NAME_BYTES];
        let n = sanitize_name(b"Ke\"n}d\\rick <3>", &mut out);
        assert_eq!(&out[..n], b"Kendrick 3");
        let n = sanitize_name(&[b'a'; 100], &mut out);
        assert_eq!(n, MAX_NAME_BYTES);
    }

    #[test]
    fn in_flight_round_trip() {
        put_in_flight(65, Kind::Slow as u8);
        assert_eq!(take_in_flight(65), Some(Kind::Slow as u8));
        assert_eq!(take_in_flight(65), None);
        assert_eq!(take_in_flight(0), None);
    }
}
