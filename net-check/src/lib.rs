//! net-check — the network device-test world (`world://net-check.micknerks`).
//!
//! @kosmos-system  Content (KosmosWorlds) — network test worlds
//! @kosmos-owner   TW (KOS-983)
//! @kosmos-level   host API level 4 (`k_net_fetch`, `k_net_read`, `k_net_status`, `OnNetResult`)
//!
//! One numbered button per case in `NETWORK_BUILD_PLAN.md` §3. Each press makes
//! ONE call, and the board in front of the visitor answers four questions in
//! order, each on its own line:
//!
//! 1. **pressed:** which button (or, for the prompt, what the visitor typed);
//! 2. **fetch:** what `k_net_fetch` returned AT ONCE — `queued`, or a refusal in
//!    words and numbers (`REFUSED -2: network off or not allowed`);
//! 3. **answer:** what `OnNetResult` said later (HTTP status, `0` no answer,
//!    `-2` refused in flight, `-5` too large), or that none will come;
//! 4. **verdict:** `PASS` or `CHECK` against what that button expects.
//!
//! | # | Button       | Request                                 | Expected |
//! |---|--------------|-----------------------------------------|----------|
//! | 1 | `BtnEcho`    | GET  A/echo                             | 200, header audit with no cookie/auth/referer/origin |
//! | 2 | `BtnScore`   | POST A/score (JSON)                     | 200 |
//! | 3 | `BtnScores`  | GET  A/scores                           | 200, the entries just posted |
//! | 4 | `BtnName`    | `k_ui_prompt`, then POST A/score with the answer | the answer on the board; then 200 |
//! | 5 | `BtnBig`     | GET  A/big (300 KiB)                    | answer -5 too large |
//! | 6 | `BtnSlow`    | GET  A/slow (12 s)                      | answer 0 no answer, at about 10 s |
//! | 7 | `BtnRedirA`  | GET  A/same-redirect (302 → A/echo)     | 200 |
//! | 8 | `BtnRedirB`  | GET  A/cross-redirect (307 → B)         | answer -2 refused in flight; B records no world hit |
//! | 9 | `BtnGzip`    | GET  A/gzip (`Content-Encoding: x-gzip`)| answer 0 no answer (refused at the header) |
//! | 10| `BtnGzipStd` | GET  A/gzip-std (`gzip`; Cloudflare inflates it) | answer -5 too large |
//! | 11| `BtnServerB` | GET  B/echo (B is not in `network.connect`) | fetch REFUSED -2 at once; B records no world hit |
//!
//! ## 1.0.1 (after the CEO's first sitting, 2026-10-11)
//!
//! "I could not tell what pressing the boxes was triggering" and, after the
//! prompt, "nothing showed". Fixed here and in `net-test-tools/build_glb.mjs`:
//! - every button carries a numbered two-line label saying what it tests and
//!   what it should do; labels alternate between two heights so neighbours never
//!   overlap;
//! - the IMMEDIATE `k_net_fetch` return code has its own line, so a denial reads
//!   as a denial instead of as silence;
//! - the prompt's answer is shown on the board the moment it comes back;
//! - board lines are at most `MAX_LINE_CHARS` and float with nothing solid
//!   behind them (1.0.0's long lines were buried in their own backboard: world
//!   text turns to face the camera and is depth-tested);
//! - every line stays inside the host's 128-byte world-text limit
//!   (`KWasm::MAX_WORLD_TEXT_BYTES`), asserted in the tests;
//! - `k_tick` re-reads `k_net_status` once a second, so a switch flip, a Ghost
//!   toggle or airplane mode shows up without pressing anything.
//!
//! The host functions are declared here (`mod host`) rather than through the
//! SDK, because the SDK's `net` module (lane SDK-1) has not merged. Every
//! signature is the client's levels table at `a47d33b`.

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
        /// `(iiif)i` ui_basic, level 0 (real since 2). Text is 1..=128 bytes, up to 4 lines.
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
// Contract constants — node names mirror net-test-tools/build_glb.mjs; URLs
// mirror the deployed test Workers and manifest.json's `network.connect`.
// ---------------------------------------------------------------------------

const A: &str = "https://kosmos-net-test-a.micknerks.workers.dev";
const B: &str = "https://kosmos-net-test-b.micknerks.workers.dev";

const METHOD_GET: i32 = 0;
const METHOD_POST: i32 = 1;
/// `flags` bit 1: the body is JSON (`application/json`).
const FLAG_JSON: i32 = 1 << 1;

/// The host refuses world text over this many bytes (`KWasm::MAX_WORLD_TEXT_BYTES`).
const HOST_TEXT_MAX_BYTES: usize = 128;
/// A board line is at most this many characters: about 2.0 m of 8 cm text,
/// which the 1.4 m clearance behind the column keeps clear of the back wall.
const MAX_LINE_CHARS: usize = 56;

/// What a case expects back. `Refused(code)`: `k_net_fetch` itself returns `code`.
/// `Answer(status)`: the call queues and `OnNetResult` carries `status`.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Expect {
    Refused(i32),
    Answer(i32),
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
    /// The board's name for it, e.g. "1 ECHO A".
    short: &'static str,
    /// The two-line label above the button (the host keeps up to 4 lines).
    label: &'static str,
    kind: Kind,
    expect: Expect,
}

/// In arc order, left to right. 11 labels + 10 board lines = 21 of the 32 world texts.
const CASES: [Case; 11] = [
    Case { node: "BtnEcho", short: "1 ECHO A", label: "1 ECHO A\nexpect 200", kind: Kind::Echo, expect: Expect::Answer(200) },
    Case { node: "BtnScore", short: "2 POST SCORE", label: "2 POST SCORE\nexpect 200", kind: Kind::Score, expect: Expect::Answer(200) },
    Case { node: "BtnScores", short: "3 READ SCORES", label: "3 READ SCORES\nexpect 200", kind: Kind::Scores, expect: Expect::Answer(200) },
    Case { node: "BtnName", short: "4 TYPE NAME", label: "4 TYPE NAME\nprompt, then post", kind: Kind::Name, expect: Expect::Answer(200) },
    Case { node: "BtnBig", short: "5 BIG 300 KB", label: "5 BIG 300 KB\nmust fail: -5", kind: Kind::Big, expect: Expect::Answer(-5) },
    Case { node: "BtnSlow", short: "6 SLOW 12 s", label: "6 SLOW 12 s\nmust fail: 0", kind: Kind::Slow, expect: Expect::Answer(0) },
    Case { node: "BtnRedirA", short: "7 REDIRECT A>A", label: "7 REDIRECT A>A\nexpect 200", kind: Kind::RedirA, expect: Expect::Answer(200) },
    Case { node: "BtnRedirB", short: "8 REDIRECT A>B", label: "8 REDIRECT A>B\nmust fail: -2", kind: Kind::RedirB, expect: Expect::Answer(-2) },
    Case { node: "BtnGzip", short: "9 GZIP", label: "9 GZIP\nmust fail: 0", kind: Kind::Gzip, expect: Expect::Answer(0) },
    Case { node: "BtnGzipStd", short: "10 GZIP via CF", label: "10 GZIP via CF\nmust fail: -5", kind: Kind::GzipStd, expect: Expect::Answer(-5) },
    Case { node: "BtnServerB", short: "11 SERVER B", label: "11 SERVER B\nmust fail: -2", kind: Kind::ServerB, expect: Expect::Refused(-2) },
];

/// Label heights above a button's centre, alternating so same-height labels are
/// two buttons (0.74 m) apart. Text is bottom-aligned and grows upward.
const LABEL_OFFSET_LOW_M: f32 = 0.10;
const LABEL_OFFSET_HIGH_M: f32 = 0.36;
const LINE_OFFSET_M: f32 = 0.0;

/// Board lines, top to bottom (anchors in the GLB).
const LINES: [&str; 10] = ["LineA", "LineB", "LineC", "LineD", "LineE", "LineF", "LineG", "LineH", "LineI", "LineJ"];
const L_TITLE: usize = 0;
const L_NETWORK: usize = 1;
const L_PRESSED: usize = 2;
const L_FETCH: usize = 3;
const L_ANSWER: usize = 4;
const L_VERDICT: usize = 5;
const L_BODY: usize = 6; // LineG..LineI carry the body excerpt
const BODY_LINES: usize = 3;
const L_FOOTER: usize = 9;

const PROMPT_TEXT: &str = "Your name for the score board (sent to the test server)";
const REQ_PROMPT_NAME: i32 = 7001;

/// Responses up to this size are shown; larger ones are reported by length only.
const READ_BUF_BYTES: usize = 8192;
/// The score board name is kept to this many bytes of [A-Za-z0-9 ._-].
const MAX_NAME_BYTES: usize = 24;
/// `k_tick` re-reads `k_net_status` this often.
const STATUS_POLL_S: f32 = 1.0;

// ---------------------------------------------------------------------------
// Module state (single-threaded world wasm; `static mut` by value only)
// ---------------------------------------------------------------------------

static mut BUTTONS: [i32; 11] = [0; 11];
static mut LINE_NODES: [i32; 10] = [0; 10];
static mut NEXT_REQUEST_ID: i32 = 1;
/// The case index (+1) of each in-flight request, keyed by request id modulo 64.
static mut IN_FLIGHT: [(i32, u8); 64] = [(0, 0); 64];
static mut QUEUED: i32 = 0;
static mut REFUSED: i32 = 0;
static mut ANSWERED: i32 = 0;
static mut SCORE_SEQ: i32 = 0;
static mut LAST_NET_STATUS: i32 = i32::MIN;
static mut POLL_ACCUM_S: f32 = 0.0;
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
            show(node, case.label, label_offset(i));
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

    line(L_TITLE, "NETWORK CHECK 1.0.1 - press a numbered button");
    refresh_network_line(true);

    let mut t = TextBuf::new();
    t.push("ready: ");
    t.push_i32(found);
    t.push("/11 buttons | results ");
    t.push(if net_sub != 0 { "ok" } else { "FAILED" });
    t.push(" | prompt ");
    t.push(if prompt_sub != 0 { "ok" } else { "FAILED" });
    line(L_PRESSED, t.as_str());
    line(L_FETCH, "fetch: -");
    line(L_ANSWER, "answer: -");
    line(L_VERDICT, "verdict: -");
    clear_body();
    refresh_footer();
}

#[no_mangle]
pub extern "C" fn k_tick(delta: f32) {
    // Re-read k_net_status once a second, and redraw only when it changes.
    let due = unsafe {
        POLL_ACCUM_S += if delta.is_finite() && delta > 0.0 { delta } else { 0.0 };
        if POLL_ACCUM_S >= STATUS_POLL_S {
            POLL_ACCUM_S = 0.0;
            true
        } else {
            false
        }
    };
    if due {
        refresh_network_line(false);
    }
}

#[no_mangle]
pub extern "C" fn k_shutdown() {}

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

/// A button was pressed: issue that button's one call.
#[no_mangle]
pub extern "C" fn on_button(_event_type: i32, node: i32, _p1: i32, _p2: i32) {
    if node == 0 {
        return;
    }
    let Some(i) = (0..CASES.len()).find(|&i| unsafe { BUTTONS[i] } == node) else {
        return;
    };
    let case = &CASES[i];
    refresh_network_line(true);

    let mut t = TextBuf::new();
    t.push("pressed: ");
    t.push(case.short);
    line(L_PRESSED, t.as_str());
    clear_body();

    match case.kind {
        Kind::Name => {
            let answer_ptr = core::ptr::addr_of_mut!(PROMPT_ANSWER) as *mut u8 as usize as i32;
            let rc = unsafe {
                host::k_ui_prompt(PROMPT_TEXT.as_ptr() as i32, PROMPT_TEXT.len() as i32, answer_ptr, 256, REQ_PROMPT_NAME)
            };
            let mut f = TextBuf::new();
            if rc == 0 {
                f.push("prompt: opened - type a name and press OK");
            } else {
                f.push("prompt: REFUSED ");
                f.push_i32(rc);
                f.push(" ");
                f.push(code_meaning(rc));
            }
            line(L_FETCH, f.as_str());
            line(L_ANSWER, "answer: waiting for the prompt");
            line(L_VERDICT, "verdict: -");
        }
        Kind::Score => {
            let seq = unsafe { SCORE_SEQ = SCORE_SEQ.wrapping_add(1); SCORE_SEQ };
            post_score(i, seq);
        }
        _ => {
            let (origin, path) = url_for(case.kind);
            let mut u = TextBuf::new();
            u.push(origin);
            u.push(path);
            fetch(i, METHOD_GET, u.as_str(), &[], 0);
        }
    }
}

/// `OnNetResult`: param1 = request id, param2 = HTTP status | 0 | -2 | -5.
#[no_mangle]
pub extern "C" fn on_net_result(_event_type: i32, _node: i32, request_id: i32, status: i32) {
    unsafe { ANSWERED = ANSWERED.wrapping_add(1); }
    let case_index = take_in_flight(request_id);

    // The length, by the peek (out_cap 0 consumes nothing).
    let len = unsafe { host::k_net_read(request_id, 0, 0) };

    let mut a = TextBuf::new();
    a.push("answer to ");
    match case_index {
        Some(i) => a.push(CASES[i].short),
        None => {
            a.push("request ");
            a.push_i32(request_id);
        }
    }
    a.push(": ");
    push_status(&mut a, status);
    if status >= 100 && len >= 0 {
        a.push(", ");
        a.push_i32(len);
        a.push(" bytes");
    }
    line(L_ANSWER, a.as_str());

    if let Some(i) = case_index {
        verdict(i, Expect::Answer(status));
    }

    if status >= 100 && len > 0 && (len as usize) <= READ_BUF_BYTES {
        let buf_ptr = core::ptr::addr_of_mut!(READ_BUF) as *mut u8;
        let got = unsafe { host::k_net_read(request_id, buf_ptr as usize as i32, READ_BUF_BYTES as i32) };
        if got >= 0 {
            let body = unsafe { core::slice::from_raw_parts(buf_ptr, got as usize) };
            show_body(body);
        } else {
            let mut b = TextBuf::new();
            b.push("(body read refused ");
            b.push_i32(got);
            b.push(")");
            show_body(b.as_str().as_bytes());
        }
    } else if status >= 100 && len > READ_BUF_BYTES as i32 {
        show_body(b"(body larger than this board shows)");
    } else {
        clear_body();
    }
    refresh_footer();
}

/// `OnPromptResult`: param1 = our request id, param2 = bytes written | -1 cancelled | -2 muted | -3 write failed.
#[no_mangle]
pub extern "C" fn on_prompt_result(_event_type: i32, _node: i32, request_id: i32, result: i32) {
    if request_id != REQ_PROMPT_NAME {
        return;
    }
    if result <= 0 {
        let mut t = TextBuf::new();
        t.push("prompt answer: ");
        t.push(prompt_result_meaning(result));
        line(L_PRESSED, t.as_str());
        line(L_FETCH, "fetch: none (nothing to send)");
        line(L_ANSWER, "answer: -");
        line(L_VERDICT, "verdict: -");
        return;
    }
    let n = (result as usize).min(256);
    let raw = unsafe { core::slice::from_raw_parts(core::ptr::addr_of!(PROMPT_ANSWER) as *const u8, n) };
    let len = sanitize_name(raw, unsafe { &mut *core::ptr::addr_of_mut!(NAME) });
    unsafe { NAME_LEN = len; }

    // Show the answer FIRST, before any network call, so it appears even when
    // the network refuses everything.
    let mut t = TextBuf::new();
    t.push("prompt answer: \"");
    push_name(&mut t);
    t.push("\" (");
    t.push_i32(result);
    t.push(" B)");
    line(L_PRESSED, t.as_str());
    refresh_footer();

    let seq = unsafe { SCORE_SEQ = SCORE_SEQ.wrapping_add(1); SCORE_SEQ };
    let name_case = CASES.iter().position(|c| c.kind == Kind::Name).unwrap_or(3);
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
fn post_score(case_index: usize, seq: i32) {
    let mut body = TextBuf::new();
    body.push("{\"name\":\"");
    push_name(&mut body);
    body.push("\",\"score\":");
    body.push_i32(100 + seq);
    body.push("}");
    let mut u = TextBuf::new();
    u.push(A);
    u.push("/score");
    fetch(case_index, METHOD_POST, u.as_str(), body.as_str().as_bytes(), FLAG_JSON);
}

/// Issue one `k_net_fetch` and put its IMMEDIATE return code on the board.
fn fetch(case_index: usize, method: i32, url: &str, body: &[u8], flags: i32) {
    let case = &CASES[case_index];
    let id = unsafe {
        let id = NEXT_REQUEST_ID;
        NEXT_REQUEST_ID = if NEXT_REQUEST_ID >= 999_999 { 1 } else { NEXT_REQUEST_ID + 1 };
        id
    };
    let body_ptr = if body.is_empty() { 0 } else { body.as_ptr() as i32 };
    let rc = unsafe {
        host::k_net_fetch(method, url.as_ptr() as i32, url.len() as i32, body_ptr, body.len() as i32, flags, id)
    };

    let mut f = TextBuf::new();
    f.push("fetch: ");
    if rc == 0 {
        unsafe { QUEUED = QUEUED.wrapping_add(1); }
        put_in_flight(id, case_index);
        f.push("0 queued as request ");
        f.push_i32(id);
        line(L_FETCH, f.as_str());
        line(L_ANSWER, "answer: waiting...");
        match case.expect {
            // A queued call where a refusal was expected is already wrong.
            Expect::Refused(_) => verdict(case_index, Expect::Answer(i32::MIN)),
            Expect::Answer(_) => line(L_VERDICT, "verdict: waiting for the answer"),
        }
    } else {
        unsafe { REFUSED = REFUSED.wrapping_add(1); }
        f.push("REFUSED ");
        f.push_i32(rc);
        f.push(" ");
        f.push(code_meaning(rc));
        line(L_FETCH, f.as_str());
        line(L_ANSWER, "answer: none - refused before sending");
        verdict(case_index, Expect::Refused(rc));
    }
    refresh_footer();
}

fn put_in_flight(id: i32, case_index: usize) {
    unsafe { IN_FLIGHT[(id as usize) % 64] = (id, case_index as u8 + 1); }
}

/// Returns the request's case index and forgets it.
fn take_in_flight(id: i32) -> Option<usize> {
    if id <= 0 {
        return None;
    }
    let slot = (id as usize) % 64;
    let (sid, k) = unsafe { IN_FLIGHT[slot] };
    if sid == id && k != 0 {
        unsafe { IN_FLIGHT[slot] = (0, 0); }
        Some(k as usize - 1)
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

fn label_offset(i: usize) -> f32 {
    if i % 2 == 0 { LABEL_OFFSET_LOW_M } else { LABEL_OFFSET_HIGH_M }
}

fn find(name: &str) -> i32 {
    unsafe { host::k_node_find(name.as_ptr() as i32, name.len() as i32) }
}

fn show(node: i32, text: &str, offset: f32) -> i32 {
    if node == 0 || text.is_empty() {
        return -1;
    }
    // The host REFUSES (never truncates) text over its byte limit, which would
    // leave the old line standing and look like "nothing happened". Clip here
    // instead, on a character boundary. Every fixed line already fits (tests).
    let mut end = text.len().min(HOST_TEXT_MAX_BYTES);
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    let text = &text[..end];
    unsafe { host::k_ui_show_world_text(node, text.as_ptr() as i32, text.len() as i32, offset) }
}

fn line(i: usize, text: &str) {
    let node = unsafe { LINE_NODES[i] };
    // An empty line is shown as a single space: the host refuses zero-length text.
    show(node, if text.is_empty() { " " } else { text }, LINE_OFFSET_M);
}

fn clear_body() {
    for k in 0..BODY_LINES {
        line(L_BODY + k, " ");
    }
}

/// Show up to three lines of the body, printable ASCII only (others become '.').
fn show_body(body: &[u8]) {
    for k in 0..BODY_LINES {
        let start = k * MAX_LINE_CHARS;
        let mut t = TextBuf::new();
        if start < body.len() {
            let end = (start + MAX_LINE_CHARS).min(body.len());
            for &b in &body[start..end] {
                t.push_byte(if (0x20..=0x7e).contains(&b) { b } else { b'.' });
            }
        }
        line(L_BODY + k, t.as_str());
    }
}

/// "verdict for 1: PASS (expected 200)" / "verdict for 1: CHECK (expected 200)".
fn verdict(case_index: usize, got: Expect) {
    let case = &CASES[case_index];
    let mut v = TextBuf::new();
    v.push("verdict for ");
    v.push(case_number(case.short));
    v.push(": ");
    push_verdict(&mut v, case.expect, got);
    line(L_VERDICT, v.as_str());
}

/// The leading number of a short name ("10 GZIP via CF" -> "10").
fn case_number(short: &str) -> &str {
    short.split(' ').next().unwrap_or(short)
}

/// "PASS (expected 200)", "CHECK (expected 200)", "PASS (expected refusal -2)".
fn push_verdict(t: &mut TextBuf, expect: Expect, got: Expect) {
    t.push(if expect == got { "PASS" } else { "CHECK" });
    t.push(" (expected ");
    match expect {
        Expect::Refused(c) => {
            t.push("refusal ");
            t.push_i32(c);
        }
        Expect::Answer(c) => {
            t.push("answer ");
            t.push_i32(c);
        }
    }
    t.push(")");
}

fn refresh_footer() {
    let mut t = TextBuf::new();
    unsafe {
        t.push("name \"");
        push_name(&mut t);
        t.push("\" | queued ");
        t.push_i32(QUEUED);
        t.push(" | refused ");
        t.push_i32(REFUSED);
        t.push(" | answered ");
        t.push_i32(ANSWERED);
    }
    line(L_FOOTER, t.as_str());
}

/// Redraw the network line; `force` redraws even when the value is unchanged.
fn refresh_network_line(force: bool) {
    let s = unsafe { host::k_net_status() };
    let changed = unsafe {
        let changed = s != LAST_NET_STATUS;
        LAST_NET_STATUS = s;
        changed
    };
    if !(changed || force) {
        return;
    }
    let mut t = TextBuf::new();
    t.push("network: ");
    t.push(match s {
        1 => "AVAILABLE",
        0 => "NOT AVAILABLE",
        -2 => "capability undeclared",
        _ => "unknown",
    });
    t.push(" (k_net_status ");
    t.push_i32(s);
    t.push(")");
    line(L_NETWORK, t.as_str());
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

/// What an immediate `k_net_fetch` / `k_ui_prompt` refusal means, in words.
fn code_meaning(rc: i32) -> &'static str {
    match rc {
        -2 => "network off or not allowed",
        -3 => "out of bounds",
        -5 => "request body too big",
        -6 => "rate limited, slow down",
        -7 => "invalid request",
        -8 => "switched off remotely",
        -11 => "no recent press",
        _ => "unknown code",
    }
}

fn prompt_result_meaning(result: i32) -> &'static str {
    match result {
        0 => "empty, nothing sent",
        -1 => "cancelled",
        -2 => "muted after 3 cancels",
        -3 => "host write failed",
        _ => "unknown result",
    }
}

/// The stored score-board name, or "quest" before the prompt is answered.
fn push_name(t: &mut TextBuf) {
    let n = unsafe { NAME_LEN };
    if n == 0 {
        t.push("quest");
    } else {
        let name = unsafe { core::slice::from_raw_parts(core::ptr::addr_of!(NAME) as *const u8, n) };
        t.push(core::str::from_utf8(name).unwrap_or("quest"));
    }
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

    fn as_str(&self) -> &str {
        core::str::from_utf8(&self.buf[..self.len]).unwrap_or("")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fits_board(s: &str) {
        assert!(s.len() <= HOST_TEXT_MAX_BYTES, "over the host's 128 bytes: {s:?}");
        assert!(s.chars().count() <= MAX_LINE_CHARS, "over {MAX_LINE_CHARS} chars: {s:?} ({})", s.len());
    }

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
            assert_eq!(origin, if c.kind == Kind::ServerB { B } else { A });
        }
    }

    #[test]
    fn labels_are_numbered_two_lines_and_fit() {
        for (i, c) in CASES.iter().enumerate() {
            assert!(c.label.starts_with(&format!("{} ", i + 1)), "{}", c.label);
            assert!(c.short.starts_with(&format!("{} ", i + 1)), "{}", c.short);
            assert_eq!(c.label.matches('\n').count(), 1, "{}", c.label);
            for part in c.label.split('\n') {
                // Same-height labels are 0.74 m apart: about 20 characters of 8 cm text.
                assert!(part.chars().count() <= 18, "{part:?}");
            }
            assert!(c.label.len() <= HOST_TEXT_MAX_BYTES);
        }
    }

    #[test]
    fn the_worst_case_board_lines_fit() {
        // The longest form of every dynamic line, built the way the world builds it.
        let mut longest_short = "";
        for c in CASES.iter() {
            if c.short.len() > longest_short.len() {
                longest_short = c.short;
            }
        }
        let mut t = TextBuf::new();
        t.push("answer to ");
        t.push(longest_short);
        t.push(": -2 refused in flight");
        fits_board(t.as_str());

        let mut t = TextBuf::new();
        t.push("answer to ");
        t.push(longest_short);
        t.push(": HTTP 200, 262144 bytes");
        fits_board(t.as_str());

        for rc in [-2, -3, -5, -6, -7, -8, -11, -99] {
            let mut t = TextBuf::new();
            t.push("fetch: REFUSED ");
            t.push_i32(rc);
            t.push(" ");
            t.push(code_meaning(rc));
            fits_board(t.as_str());
            let mut t = TextBuf::new();
            t.push("prompt: REFUSED ");
            t.push_i32(rc);
            t.push(" ");
            t.push(code_meaning(rc));
            fits_board(t.as_str());
        }

        let mut t = TextBuf::new();
        t.push("fetch: 0 queued as request 999999");
        fits_board(t.as_str());

        let mut t = TextBuf::new();
        t.push("verdict for 10: ");
        push_verdict(&mut t, Expect::Refused(-2), Expect::Answer(i32::MIN));
        fits_board(t.as_str());

        let name = "a".repeat(MAX_NAME_BYTES);
        let mut t = TextBuf::new();
        t.push("prompt answer: \"");
        t.push(&name);
        t.push("\" (256 B)");
        fits_board(t.as_str());

        let mut t = TextBuf::new();
        t.push("name \"");
        t.push(&name);
        t.push("\" | queued 99999 | refused 99999 | answered 99999");
        assert!(t.as_str().len() <= HOST_TEXT_MAX_BYTES);

        for r in [0, -1, -2, -3, -9] {
            let mut t = TextBuf::new();
            t.push("prompt answer: ");
            t.push(prompt_result_meaning(r));
            fits_board(t.as_str());
        }

        for s in [
            "NETWORK CHECK 1.0.1 - press a numbered button",
            "network: capability undeclared (k_net_status -2)",
            "ready: 11/11 buttons | results FAILED | prompt FAILED",
            "prompt: opened - type a name and press OK",
            "answer: none - refused before sending",
            "verdict: waiting for the answer",
            "(body larger than this board shows)",
        ] {
            fits_board(s);
        }
        assert!(PROMPT_TEXT.len() <= 256);
    }

    #[test]
    fn verdicts() {
        let mut t = TextBuf::new();
        push_verdict(&mut t, Expect::Answer(-5), Expect::Answer(-5));
        assert_eq!(t.as_str(), "PASS (expected answer -5)");
        let mut t = TextBuf::new();
        push_verdict(&mut t, Expect::Refused(-2), Expect::Refused(-2));
        assert_eq!(t.as_str(), "PASS (expected refusal -2)");
        let mut t = TextBuf::new();
        push_verdict(&mut t, Expect::Answer(200), Expect::Refused(-2));
        assert_eq!(t.as_str(), "CHECK (expected answer 200)");
        assert_eq!(case_number("10 GZIP via CF"), "10");
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
        put_in_flight(65, 5);
        assert_eq!(take_in_flight(65), Some(5));
        assert_eq!(take_in_flight(65), None);
        assert_eq!(take_in_flight(0), None);
    }
}
