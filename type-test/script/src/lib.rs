//! Type Test -- a throwaway check of world text input (`world://type-test.micknerks`).
//!
//! 1.1.0 (KOS-699, builder vp-w1, 2026-10-22) keeps everything below unchanged and adds
//! seven cards on the side walls and behind the visitor (`checks.rs`): the level-5 checks
//! kosmos-project #213 lists as not shown on 1.0.0. They import `k_ui_text_end` too.
//! 1.1.1 changes no behaviour: every plaque's text moves to its own invisible anchor
//! node (TEXT_NODES), so the pointing outline fits the button instead of wrapping the
//! invisible keel 1.1.0's plaques carried under them.
//!
//! @kosmos-system  Content (KosmosWorlds) -- Type Test (temporary)
//! @kosmos-owner   Type Test, CEO 2026-10-21: "go ahead and do the type test, MickNerks, and we can
//!                 test it. After we test it and it works, please destroy that world."
//! @kosmos-level   host API level 5 (`k_ui_text_begin`, `k_ui_text_read`, `k_ui_text_end`, the event `OnTextInput`);
//!                 level 2 (`k_api_version`); level 0 for the rest.
//!
//! What it does, in the order the CEO will see it:
//!
//! 1. Two buttons about 1.5 m ahead at chest height: "Press to type (plain)" on
//!    the left and "Press to type (password)" on the right.
//! 2. A press opens the system keyboard with `k_ui_text_begin`: flags 0 for the
//!    plain button, flags 1 (masked, the password keyboard) for the other.
//! 3. Each `OnTextInput` is read back with `k_ui_text_read` and shown on the
//!    result line above that button. The plain field shows the text itself; the
//!    password field shows ONLY its length ("Password received: N characters").
//! 4. The status plaque under each button shows the three steps: field open,
//!    text received, ended, with the return code of every call.
//! 5. A real Enter on a field opened by a PRESS opens the other field by itself
//!    (the Enter re-arm: no press). An Enter on a field the Enter opened does not
//!    chain again.
//! 6. After every Enter the world calls `k_world_navigate` once, to an address
//!    that does not exist, and shows the number it returned. The call is held
//!    until the last press is more than 6.5 s old, so the press's own 5 s window
//!    has closed and the number is about the Enter alone. The activation gate
//!    expects -11; the world shows only the number.
//!
//! THE PRIVACY RULE OF THIS FILE: nothing typed is logged (this module imports
//! no `k_log`), saved (no `state` capability and no `k_state_*` import) or sent
//! (no `network` capability and no `k_net_*` import). The plain text is shown
//! on its result line and nowhere else. The masked text is copied into
//! `MASK_BUF` only long enough to count its characters, then overwritten with
//! zeros in the same call; it is never shown, and nothing else reads it.
//!
//! Signatures: the client's committed `host-api-levels.json` and `KDomUI.cpp` /
//! `KDomWorld.cpp` / `KDomEvents.cpp` at `feat/device-p2-2026-10` `944abfa`
//! (Build 1013, versionCode 1013, `current_level` 5).
//!
//! @integration
//!   @kosmos-calls  k_ui_text_begin, k_ui_text_read, k_ui_text_end (KDomUI.cpp), k_world_navigate (KDomWorld.cpp)
//!   @kosmos-calls  k_node_find, k_event_subscribe, k_event_subscribe_global, k_ui_show_world_text, k_api_version
//!   @kosmos-nodes  ../tools/build_glb.mjs builds every node named in `NODES` below.

#![cfg_attr(target_arch = "wasm32", no_std, no_main)]

#[cfg(all(target_arch = "wasm32", not(test)))]
#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

// ---------------------------------------------------------------------------
// Host imports (module "kosmos"). Each line: name, WAMR signature, capability.
// ---------------------------------------------------------------------------

#[cfg(target_arch = "wasm32")]
mod host {
    #[link(wasm_import_module = "kosmos")]
    extern "C" {
        /// "(ii)i", scene_read. A handle > 0, or an error.
        pub fn k_node_find(name_ptr: i32, name_len: i32) -> i32;
        /// "(iiii)i", events. A subscription id > 0, or an error.
        pub fn k_event_subscribe(name_ptr: i32, name_len: i32, node: i32, callback_fn_index: i32) -> i32;
        /// "(iii)i", events.
        pub fn k_event_subscribe_global(name_ptr: i32, name_len: i32, callback_fn_index: i32) -> i32;
        /// "(iiif)i", ui_basic. 1..128 bytes, offset in metres; 32 nodes at most.
        pub fn k_ui_show_world_text(node: i32, text_ptr: i32, text_len: i32, offset_y: f32) -> i32;
        /// "(iiiiii)i", ui_basic, level 5. flags bit 0 = masked; max_bytes 1..512 (1..128 masked).
        pub fn k_ui_text_begin(node: i32, flags: i32, max_bytes: i32, init_ptr: i32, init_len: i32, request_id: i32) -> i32;
        /// "(iii)i", ui_basic, level 5. Copies at most out_cap bytes; returns the full byte length.
        pub fn k_ui_text_read(request_id: i32, out_ptr: i32, out_cap: i32) -> i32;
        /// "(i)i", ui_basic, level 5. The world closes its own field; no event follows. -7: no open session with this id.
        pub fn k_ui_text_end(request_id: i32) -> i32;
        /// "(ii)i", world_navigate. Activation-gated: -11 without a local press in the last 5 s.
        pub fn k_world_navigate(url_ptr: i32, url_len: i32) -> i32;
        /// "()i", no capability, level 2.
        pub fn k_api_version() -> i32;
    }
}

/// Host-side stand-ins so `cargo test` links. They record nothing typed.
#[cfg(not(target_arch = "wasm32"))]
mod host {
    pub unsafe fn k_node_find(_p: i32, _l: i32) -> i32 { 0 }
    pub unsafe fn k_event_subscribe(_p: i32, _l: i32, _n: i32, _c: i32) -> i32 { 1 }
    pub unsafe fn k_event_subscribe_global(_p: i32, _l: i32, _c: i32) -> i32 { 1 }
    pub unsafe fn k_ui_show_world_text(_n: i32, _p: i32, _l: i32, _o: f32) -> i32 { 0 }
    /// What the stand-in k_ui_text_begin answers (tests set it).
    pub static mut STUB_BEGIN: i32 = 0;
    /// The stand-in applies the host's argument rules first (KWorldTextInput.h ValidateBeginArgs:
    /// -7 for a bad bit, layout or cap, start text in a masked field or over the cap; -8 multi-line),
    /// then answers STUB_BEGIN, so the tests see the refusals the cards expect.
    pub unsafe fn k_ui_text_begin(_n: i32, f: i32, m: i32, _ip: i32, il: i32, _r: i32) -> i32 {
        let masked = f & 1 != 0;
        if f & !(1 | 2 | (0xF << 4)) != 0 || ((f >> 4) & 0xF) > 3 {
            return -7;
        }
        if m < 1 || m > if masked { 128 } else { 512 } || (masked && il > 0) || il > m {
            return -7;
        }
        if f & 2 != 0 {
            return -8;
        }
        STUB_BEGIN
    }
    /// What the stand-in k_ui_text_read answers (tests set it).
    pub static mut STUB_READ: i32 = -7;
    /// The out_cap of the last read (the audit card must ask for 0).
    pub static mut STUB_LAST_READ_CAP: i32 = -1;
    pub unsafe fn k_ui_text_read(_r: i32, _o: i32, c: i32) -> i32 {
        STUB_LAST_READ_CAP = c;
        STUB_READ
    }
    pub static mut STUB_END: i32 = 0;
    pub unsafe fn k_ui_text_end(_r: i32) -> i32 { STUB_END }
    pub unsafe fn k_world_navigate(_p: i32, _l: i32) -> i32 { -11 }
    pub unsafe fn k_api_version() -> i32 { 5 }
}

// ---------------------------------------------------------------------------
// Contract constants
// ---------------------------------------------------------------------------

/// `k_ui_text_begin` flags bit 0: a masked field (forces the password keyboard).
pub const FLAG_MASKED: i32 = 1;
/// The plain field's cap, in bytes (the host allows 1..512).
pub const PLAIN_MAX_BYTES: i32 = 48;
/// The masked field's cap, in bytes (the host allows 1..128).
pub const MASKED_MAX_BYTES: i32 = 128;

/// OnTextInput `param2` codes (KWorldTextInput.h at 944abfa).
pub const CODE_CHANGED: i32 = 1;
pub const CODE_SUBMITTED: i32 = 2;
pub const CODE_CLOSED: i32 = -1;
pub const CODE_TAKEN: i32 = -2;

/// The address the post-Enter `k_world_navigate` call names. It is well formed
/// and does not exist, so even a wrong 0 travels nowhere real.
pub const DUMMY_URL: &str = "world://type-test-nowhere.micknerks";
/// The navigate call waits until the last press is this old (the window is 5 s).
pub const PRESS_SETTLE_S: f32 = 6.5;
/// The first row's navigate result means something only if the Enter came this long after
/// the last press: the call is at last press + 6.5 s, so it is then within 4.5 s of the Enter
/// (inside the Enter's own window, had the Enter stamped one). 2.0 rather than 1.5 keeps a
/// margin for world time, which can run slower than real time.
pub const NAV_CONCLUSIVE_S: f32 = 2.0;
/// How long the world keeps trying to open the next field after an Enter (the re-arm lasts 5 s).
/// Kept well inside the host's 5 s re-arm, because this clock is clamped and can run slow.
pub const CHAIN_TRY_S: f32 = 3.0;
/// A press newer than this (and newer than the field's opening) may be what opened
/// the next field instead of the Enter: the host tries an unused press first.
pub const PRESS_WINDOW_S: f32 = 5.5;
/// How often it tries again (a refused begin spends nothing; at most one begin a second is accepted).
pub const CHAIN_RETRY_S: f32 = 0.3;
/// How often a world text that the host refused is shown again.
const TEXT_RETRY_S: f32 = 1.0;

/// The plain field's text, as it is shown on its result line, is wrapped at
/// this many characters a line, under one heading line (four lines in all).
pub const WRAP_CHARS: usize = 22;
pub const WRAP_LINES: usize = 3;

/// Every node this script finds. ../tools/build_glb.mjs builds exactly these.
pub const NODES: [&str; 8] = [
    "BtnPlain", "BtnPassword", "TxtTitle", "TxtNav", "TxtPlainResult", "TxtPlainStatus", "TxtPassResult", "TxtPassStatus",
];
/// Every other mesh. A laser press on ANY mesh opens the 5 s activation window
/// (KWasmRuntime.cpp DispatchNodeEventForComponentCore stamps before it looks
/// for a subscriber), so the world listens to all of them, and to the A and B
/// buttons, only to know when the last press was: the navigate check waits for it.
pub const OTHER_NODES: [&str; 11] = [
    "TxtTitle", "TxtNav", "TxtPlainResult", "TxtPlainStatus", "TxtPassResult", "TxtPassStatus",
    "Floor", "WallFront", "WallBack", "WallLeft", "WallRight",
];
/// 1.1.1: each plaque's text goes on its own invisible anchor node, "<plaque>Text",
/// so the node a laser presses is just the plaque and the pointing outline fits it
/// (../tools/build_glb.mjs plaque()). The same order as NODES.
pub const TEXT_NODES: [&str; 8] = [
    "BtnPlainText", "BtnPasswordText", "TxtTitleText", "TxtNavText", "TxtPlainResultText", "TxtPlainStatusText", "TxtPassResultText", "TxtPassStatusText",
];
pub const LABEL_PLAIN: &str = "Press to type (plain)";
pub const LABEL_PASSWORD: &str = "Press to type (password)";

// ---------------------------------------------------------------------------
// A fixed-size text buffer (no allocator)
// ---------------------------------------------------------------------------

/// At most N bytes of UTF-8; a push that does not fit stops at a character boundary.
#[derive(Clone, Copy)]
pub struct Buf<const N: usize> {
    b: [u8; N],
    len: usize,
}

impl<const N: usize> Buf<N> {
    pub const fn new() -> Self {
        Buf { b: [0; N], len: 0 }
    }
    pub fn clear(&mut self) {
        self.len = 0;
    }
    pub fn as_bytes(&self) -> &[u8] {
        &self.b[..self.len]
    }
    pub fn as_str(&self) -> &str {
        // Only whole characters are ever pushed.
        core::str::from_utf8(self.as_bytes()).unwrap_or("")
    }
    pub fn push(&mut self, s: &str) -> &mut Self {
        for c in s.chars() {
            let mut tmp = [0u8; 4];
            let e = c.encode_utf8(&mut tmp).as_bytes();
            if self.len + e.len() > N {
                break;
            }
            self.b[self.len..self.len + e.len()].copy_from_slice(e);
            self.len += e.len();
        }
        self
    }
    pub fn push_i32(&mut self, v: i32) -> &mut Self {
        let mut digits = [0u8; 11];
        let mut n = 0;
        let neg = v < 0;
        let mut u = (v as i64).unsigned_abs();
        loop {
            digits[n] = b'0' + (u % 10) as u8;
            n += 1;
            u /= 10;
            if u == 0 {
                break;
            }
        }
        if neg {
            self.push("-");
        }
        while n > 0 {
            n -= 1;
            let d = [digits[n]];
            self.push(core::str::from_utf8(&d).unwrap_or("?"));
        }
        self
    }
}

/// Characters in a UTF-8 byte string (bytes that are not continuation bytes).
pub fn count_chars(bytes: &[u8]) -> usize {
    bytes.iter().filter(|&&b| (b & 0xC0) != 0x80).count()
}

/// Overwrite a buffer with zeros so the compiler cannot skip it.
fn wipe(buf: &mut [u8]) {
    for b in buf.iter_mut() {
        // SAFETY: `b` is a valid, exclusive reference into the buffer.
        unsafe { core::ptr::write_volatile(b, 0) };
    }
}

/// Wrap `s` into at most `max_lines` lines of at most `per_line` characters,
/// each preceded by a newline, ending with "..." if it did not all fit.
pub fn push_wrapped<const N: usize>(out: &mut Buf<N>, s: &str, per_line: usize, max_lines: usize) {
    let total = s.chars().count();
    let mut it = s.chars();
    let mut shown = 0;
    for _ in 0..max_lines {
        if shown >= total {
            break;
        }
        out.push("\n");
        for _ in 0..per_line {
            match it.next() {
                Some(c) => {
                    let mut tmp = [0u8; 4];
                    out.push(c.encode_utf8(&mut tmp));
                    shown += 1;
                }
                None => break,
            }
        }
    }
    if shown < total {
        out.push("...");
    }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Open {
    No,
    /// Opened, and by what.
    Yes { via: Via },
    /// The world is trying to open it after an Enter; the last begin answered this.
    Retrying(i32),
    /// The begin answered this, and nothing opened.
    Refused(i32),
    /// This field's session is still open, and a second begin on it answered this.
    Again { via: Via, code: i32 },
}

/// What opened a field.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Via {
    /// A press on its button.
    Press,
    /// The Enter re-arm, with no press the world heard since the last field opened.
    Enter,
    /// Opened after an Enter, but a press was heard in the last few seconds too, and
    /// the host tries an unused press before the re-arm: either could have opened it.
    EnterOrPress,
}

impl Via {
    fn label(self) -> &'static str {
        match self {
            Via::Press => "press",
            Via::Enter => "Enter",
            Via::EnterOrPress => "Enter or press",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Ended {
    No,
    Enter,
    Closed,
    Taken,
    Other(i32),
}

#[derive(Clone, Copy)]
pub struct Field {
    /// The button: presses, and the node the field is opened on.
    pub node: i32,
    /// The button's text anchor (TEXT_NODES), which carries its label.
    pub label: i32,
    pub masked: bool,
    pub open: Open,
    /// None until the first "text changed" (code 1); then the last read's answer.
    pub text_read: Option<i32>,
    /// True once any read in this session answered >= 0 (so an empty Enter reads "(empty)").
    pub read_once: bool,
    pub ended: Ended,
    /// The plain field only: the text as last read (never used for the masked field).
    pub plain: Buf<64>,
    /// The masked field only: its length in characters as last read, never its text.
    pub masked_chars: Option<usize>,
    pub result_dirty: bool,
    pub status_dirty: bool,
}

impl Field {
    const fn new(masked: bool) -> Self {
        Field {
            node: 0,
            label: 0,
            masked,
            open: Open::No,
            text_read: None,
            read_once: false,
            ended: Ended::No,
            plain: Buf::new(),
            masked_chars: None,
            result_dirty: true,
            status_dirty: true,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Nav {
    NotYet,
    /// An Enter happened at this time; the call waits for the press window to close.
    Pending { enter_s: f32 },
    /// The answer, and whether it says anything: the Enter came at least
    /// NAV_CONCLUSIVE_S after the last press, so the call was inside the Enter's
    /// own 5 s and outside every press's.
    Returned(i32, bool),
}

pub struct App {
    pub now_s: f32,
    /// The last press on a button, in world seconds (negative: none yet).
    pub last_press_s: f32,
    pub fields: [Field; 2],
    /// The plaques' text anchors (TEXT_NODES), never the plaques themselves.
    pub txt_title: i32,
    pub txt_nav: i32,
    pub txt_result: [i32; 2],
    pub txt_status: [i32; 2],
    pub api_level: i32,
    pub init_error: i32,
    pub next_request: i32,
    /// The open session: (field index, request id, opened by an Enter).
    pub session: Option<(usize, i32, Via)>,
    /// When the last session opened (world seconds).
    pub last_open_s: f32,
    /// After an Enter on a press-opened field: (field to open, give up at, next try at).
    pub chain: Option<(usize, f32, f32)>,
    pub nav: Nav,
    pub nav_calls: i32,
    pub nav_countdown: i32,
    pub title_dirty: bool,
    pub nav_dirty: bool,
    pub labels_dirty: bool,
    pub next_text_try_s: f32,
    /// The 1.1.0 cards (checks.rs).
    pub checks: checks::Checks,
}

impl App {
    pub const fn new() -> Self {
        App {
            now_s: 0.0,
            last_press_s: -1.0,
            fields: [Field::new(false), Field::new(true)],
            txt_title: 0,
            txt_nav: 0,
            txt_result: [0; 2],
            txt_status: [0; 2],
            api_level: 0,
            init_error: 0,
            next_request: 1,
            session: None,
            chain: None,
            last_open_s: -1.0,
            nav: Nav::NotYet,
            nav_calls: 0,
            nav_countdown: -1,
            title_dirty: true,
            nav_dirty: true,
            labels_dirty: true,
            next_text_try_s: 0.0,
            checks: checks::Checks::new(),
        }
    }
}

static mut APP: App = App::new();
/// Where `k_ui_text_read` copies the plain field's text.
static mut PLAIN_BUF: [u8; 64] = [0; 64];
/// Where `k_ui_text_read` copies the masked field's text, only to count it; wiped at once.
static mut MASK_BUF: [u8; 128] = [0; 128];

#[allow(static_mut_refs)]
fn app() -> &'static mut App {
    // Single-threaded world wasm: one App, reached only from host callbacks.
    unsafe { &mut *core::ptr::addr_of_mut!(APP) }
}

// ---------------------------------------------------------------------------
// Host wrappers
// ---------------------------------------------------------------------------

fn find(name: &str) -> i32 {
    unsafe { host::k_node_find(name.as_ptr() as i32, name.len() as i32) }
}

fn show(node: i32, text: &str) -> i32 {
    if node <= 0 {
        return -1;
    }
    unsafe { host::k_ui_show_world_text(node, text.as_ptr() as i32, text.len() as i32, 0.0) }
}

// ---------------------------------------------------------------------------
// The text of each line (pure, tested)
// ---------------------------------------------------------------------------

pub fn title_text(api_level: i32, init_error: i32) -> Buf<128> {
    let mut b = Buf::new();
    b.push("Type test: host API level 5\nThis headset reports level ").push_i32(api_level);
    if init_error != 0 {
        b.push("\nsetup error ").push_i32(init_error);
    } else {
        b.push("\nEnter on a pressed field opens the other");
    }
    b
}

pub fn result_text(f: &Field) -> Buf<128> {
    let mut b = Buf::new();
    if f.masked {
        b.push("Password received:\n");
        match f.masked_chars {
            None => {
                b.push("(nothing yet)");
            }
            Some(1) => {
                b.push("1 character");
            }
            Some(n) => {
                b.push_i32(n as i32).push(" characters");
            }
        }
    } else {
        b.push("You typed:");
        if !f.read_once {
            b.push("\n(nothing yet)");
        } else if f.plain.as_bytes().is_empty() {
            b.push("\n(empty)");
        } else {
            push_wrapped(&mut b, f.plain.as_str(), WRAP_CHARS, WRAP_LINES);
        }
    }
    b
}

pub fn status_text(f: &Field) -> Buf<128> {
    let mut b = Buf::new();
    match f.open {
        Open::No => b.push("open: no"),
        Open::Yes { via } => b.push("open: yes (").push(via.label()).push("), begin 0"),
        Open::Retrying(c) => b.push("open: retrying, begin ").push_i32(c),
        Open::Refused(c) => b.push("open: NO, begin ").push_i32(c),
        Open::Again { via, code } => b.push("open: yes (").push(via.label()).push("), again ").push_i32(code),
    };
    match f.text_read {
        None => b.push("\ntext: no"),
        // The masked field: its length in characters only, the same number its result line shows.
        Some(n) if n >= 0 && f.masked => match f.masked_chars {
            Some(c) => b.push("\ntext: yes, ").push_i32(c as i32).push(" characters"),
            None => b.push("\ntext: yes"),
        },
        Some(n) if n >= 0 => b.push("\ntext: yes, read ").push_i32(n),
        Some(n) => b.push("\ntext: read error ").push_i32(n),
    };
    match f.ended {
        Ended::No => b.push("\nended: no"),
        Ended::Enter => b.push("\nended: Enter"),
        Ended::Closed => b.push("\nended: keyboard closed"),
        Ended::Taken => b.push("\nended: taken by Kosmos"),
        Ended::Other(c) => b.push("\nended: code ").push_i32(c),
    };
    b
}

pub fn nav_text(nav: Nav, countdown: i32) -> Buf<128> {
    let mut b = Buf::new();
    b.push("After Enter, k_world_navigate\n");
    match nav {
        Nav::NotYet => b.push("not called yet"),
        Nav::Pending { .. } => b.push("calls in ").push_i32(countdown.max(0)).push(" s"),
        Nav::Returned(c, true) => b.push("returned ").push_i32(c).push(", conclusive"),
        Nav::Returned(c, false) => b.push("returned ").push_i32(c).push(", inconclusive"),
    };
    b
}

// ---------------------------------------------------------------------------
// Opening a field
// ---------------------------------------------------------------------------

/// Begin a session on field `k`. Returns the begin's answer.
fn begin(a: &mut App, k: usize, via: Via) -> i32 {
    let req = a.next_request;
    a.next_request += 1;
    let (node, masked) = (a.fields[k].node, a.fields[k].masked);
    // Is this field's own session open right now (and what opened it)?
    let open_here = match a.session {
        Some((sk, _, v)) if sk == k => Some(v),
        _ => None,
    };
    let (flags, max) = if masked { (FLAG_MASKED, MASKED_MAX_BYTES) } else { (0, PLAIN_MAX_BYTES) };
    let r = unsafe { host::k_ui_text_begin(node, flags, max, 0, 0, req) };
    if r == 0 {
        a.session = Some((k, req, via));
        a.last_open_s = a.now_s;
    }
    let f = &mut a.fields[k];
    if r == 0 {
        f.open = Open::Yes { via };
        f.text_read = None;
        f.read_once = false;
        f.ended = Ended::No;
        f.plain.clear();
        f.masked_chars = None;
        f.result_dirty = true;
    } else {
        f.open = match (open_here, via) {
            // A second press on the field whose keyboard is up: it stays open; say what the begin answered.
            (Some(was), _) => Open::Again { via: was, code: r },
            (None, Via::Press) => Open::Refused(r),
            (None, _) => Open::Retrying(r),
        };
    }
    f.status_dirty = true;
    r
}

/// How to label a field the world opens after an Enter: Enter, unless a press was
/// heard after the last field opened and recently enough that the host may have
/// used that press instead (it tries an unused press before the Enter re-arm).
fn after_enter_via(a: &App) -> Via {
    if a.last_press_s > a.last_open_s && a.now_s - a.last_press_s <= PRESS_WINDOW_S {
        Via::EnterOrPress
    } else {
        Via::Enter
    }
}

fn field_of_node(a: &App, node: i32) -> Option<usize> {
    (0..2).find(|&k| a.fields[k].node > 0 && a.fields[k].node == node)
}

/// Read field `k`'s current text for request `req` (in the OnTextInput handler).
fn read_into(a: &mut App, k: usize, req: i32) -> i32 {
    let f = &mut a.fields[k];
    if f.masked {
        let ptr = core::ptr::addr_of_mut!(MASK_BUF) as *mut u8;
        let n = unsafe { host::k_ui_text_read(req, ptr as usize as i32, MASKED_MAX_BYTES) };
        // SAFETY: MASK_BUF is a 128-byte static, touched only here, single-threaded.
        let buf = unsafe { core::slice::from_raw_parts_mut(ptr, MASKED_MAX_BYTES as usize) };
        if n >= 0 {
            let got = (n as usize).min(buf.len());
            f.masked_chars = Some(count_chars(&buf[..got]));
            f.read_once = true;
        }
        wipe(buf);
        n
    } else {
        let ptr = core::ptr::addr_of_mut!(PLAIN_BUF) as *mut u8;
        let n = unsafe { host::k_ui_text_read(req, ptr as usize as i32, 64) };
        if n >= 0 {
            // SAFETY: PLAIN_BUF is a 64-byte static, touched only here, single-threaded.
            let buf = unsafe { core::slice::from_raw_parts(ptr, 64) };
            let got = (n as usize).min(64);
            f.read_once = true;
            f.plain.clear();
            match core::str::from_utf8(&buf[..got]) {
                Ok(s) => f.plain.push(s),
                Err(_) => f.plain.push("(not UTF-8)"),
            };
        }
        n
    }
}

// ---------------------------------------------------------------------------
// The module's exports
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn k_init() {
    let a = app();
    a.fields[0].node = find("BtnPlain");
    a.fields[1].node = find("BtnPassword");
    // Text goes on each plaque's anchor; presses stay on the plaques (OTHER_NODES).
    a.fields[0].label = find("BtnPlainText");
    a.fields[1].label = find("BtnPasswordText");
    a.txt_title = find("TxtTitleText");
    a.txt_nav = find("TxtNavText");
    a.txt_result = [find("TxtPlainResultText"), find("TxtPassResultText")];
    a.txt_status = [find("TxtPlainStatusText"), find("TxtPassStatusText")];
    a.api_level = unsafe { host::k_api_version() };

    let ev = "OnInteract";
    for k in 0..2 {
        let node = a.fields[k].node;
        if node <= 0 {
            a.init_error = if node == 0 { -1 } else { node };
            continue;
        }
        let s = unsafe { host::k_event_subscribe(ev.as_ptr() as i32, ev.len() as i32, node, on_press as usize as i32) };
        if s <= 0 {
            a.init_error = if s == 0 { -1 } else { s };
        }
    }
    for name in OTHER_NODES {
        let node = find(name);
        if node > 0 {
            let s = unsafe { host::k_event_subscribe(ev.as_ptr() as i32, ev.len() as i32, node, on_any_press as usize as i32) };
            if s <= 0 {
                a.init_error = if s == 0 { -1 } else { s };
            }
        }
    }
    // OnGrab and OnRelease also open the activation window (KWasmRuntime.cpp
    // IsActivationEvent). They do not fire on the reference client today
    // (RESOLVE_SPEC 10.5); if they ever do, the navigate check still hears them.
    for ev in ["OnGrab", "OnRelease"] {
        for name in ["BtnPlain", "BtnPassword"].iter().chain(OTHER_NODES.iter()) {
            let node = find(name);
            if node > 0 {
                unsafe { host::k_event_subscribe(ev.as_ptr() as i32, ev.len() as i32, node, on_any_press as usize as i32) };
            }
        }
    }
    for ev in ["OnButtonA", "OnButtonB"] {
        let s = unsafe { host::k_event_subscribe_global(ev.as_ptr() as i32, ev.len() as i32, on_any_press as usize as i32) };
        if s <= 0 {
            a.init_error = if s == 0 { -1 } else { s };
        }
    }
    let ev = "OnTextInput";
    let s = unsafe { host::k_event_subscribe_global(ev.as_ptr() as i32, ev.len() as i32, on_text_input as usize as i32) };
    if s <= 0 {
        a.init_error = if s == 0 { -1 } else { s };
    }
    checks::init(a);
}

/// OnInteract on any other mesh, or OnButtonA / OnButtonB: only noted, so the
/// navigate check can wait until the press window it opened has closed.
#[no_mangle]
pub extern "C" fn on_any_press(_event_type: i32, _node: i32, _p1: i32, _p2: i32) {
    let a = app();
    a.last_press_s = a.now_s;
}

#[no_mangle]
pub extern "C" fn k_tick(delta: f32) {
    let a = app();
    let dt = if delta.is_finite() && delta > 0.0 { delta.min(0.25) } else { 0.0 };
    // Clamping can only make world time run SLOWER than the platform clock, so a
    // wait measured here is never shorter in real time than it reads.
    a.now_s += dt;

    // The Enter re-arm: keep trying to open the next field until it opens or the re-arm is over.
    if let Some((k, give_up_s, next_try_s)) = a.chain {
        if a.session.is_some() {
            a.chain = None;
        } else if a.now_s >= give_up_s {
            a.chain = None;
            if let Open::Retrying(c) = a.fields[k].open {
                a.fields[k].open = Open::Refused(c);
                a.fields[k].status_dirty = true;
            }
        } else if a.now_s >= next_try_s {
            let v = after_enter_via(a);
            let r = begin(a, k, v);
            a.chain = if r == 0 { None } else { Some((k, give_up_s, a.now_s + CHAIN_RETRY_S)) };
        }
    }

    // The post-Enter navigate check, once the last press is PRESS_SETTLE_S old.
    if let Nav::Pending { enter_s } = a.nav {
        let due = if a.last_press_s >= 0.0 { enter_s.max(a.last_press_s + PRESS_SETTLE_S) } else { enter_s };
        if a.now_s >= due {
            let r = unsafe { host::k_world_navigate(DUMMY_URL.as_ptr() as i32, DUMMY_URL.len() as i32) };
            // Conclusive only when the Enter came NAV_CONCLUSIVE_S or more after the last press
            // (the call is then within 4.5 s of the Enter); otherwise -11 is what any Enter gets.
            let conclusive = a.last_press_s < 0.0 || enter_s - a.last_press_s >= NAV_CONCLUSIVE_S;
            a.nav = Nav::Returned(r, conclusive);
            a.nav_calls += 1;
            a.nav_dirty = true;
        } else {
            let left = (due - a.now_s) as i32 + 1;
            if left != a.nav_countdown {
                a.nav_countdown = left;
                a.nav_dirty = true;
            }
        }
    }

    checks::tick(a);
    render(a);
}

#[no_mangle]
pub extern "C" fn k_shutdown() {
    let a = app();
    a.session = None;
    a.chain = None;
    for f in a.fields.iter_mut() {
        f.plain.clear();
        f.masked_chars = None;
    }
    unsafe {
        wipe(&mut *core::ptr::addr_of_mut!(PLAIN_BUF));
        wipe(&mut *core::ptr::addr_of_mut!(MASK_BUF));
    }
    checks::shutdown();
}

/// OnInteract on either button: `node` is the button that was pressed.
#[no_mangle]
pub extern "C" fn on_press(_event_type: i32, node: i32, _p1: i32, _p2: i32) {
    let a = app();
    let Some(k) = field_of_node(a, node) else { return };
    a.last_press_s = a.now_s;
    a.chain = None; // a press supersedes a pending Enter re-arm
    begin(a, k, Via::Press);
}

/// OnTextInput (global): `request_id` names the session, `code` says what happened.
#[no_mangle]
pub extern "C" fn on_text_input(_event_type: i32, _node: i32, request_id: i32, code: i32) {
    let a = app();
    // A card's field (checks.rs) first: request ids come from one counter, so they never collide.
    if checks::on_text_input(a, request_id, code) {
        return;
    }
    let Some((k, req, via)) = a.session else { return };
    if req != request_id {
        return; // a stale session's news
    }
    let n = read_into(a, k, req);
    let f = &mut a.fields[k];
    if code == CODE_CHANGED {
        f.text_read = Some(n);
    } else if f.text_read.is_some() || n < 0 {
        f.text_read = Some(n);
    }
    f.result_dirty = true;
    f.status_dirty = true;

    if code == CODE_CHANGED {
        return;
    }
    f.ended = match code {
        CODE_SUBMITTED => Ended::Enter,
        CODE_CLOSED => Ended::Closed,
        CODE_TAKEN => Ended::Taken,
        c => Ended::Other(c),
    };
    a.session = None;

    if code == CODE_SUBMITTED {
        a.nav = Nav::Pending { enter_s: a.now_s };
        a.nav_countdown = -1;
        a.nav_dirty = true;
        if via == Via::Press {
            // The Enter re-arm opens the OTHER field, with no press. Try now; k_tick retries.
            let other = 1 - k;
            let give_up = a.now_s + CHAIN_TRY_S;
            let v = after_enter_via(a);
            let r = begin(a, other, v);
            a.chain = if r == 0 { None } else { Some((other, give_up, a.now_s + CHAIN_RETRY_S)) };
        }
    }
}

/// Show every line whose text changed; a line the host refused is tried again after TEXT_RETRY_S.
fn render(a: &mut App) {
    if a.now_s < a.next_text_try_s {
        return;
    }
    let mut failed = false;
    if a.labels_dirty {
        let ok = show(a.fields[0].label, LABEL_PLAIN) == 0;
        let ok2 = show(a.fields[1].label, LABEL_PASSWORD) == 0;
        a.labels_dirty = !(ok && ok2);
        failed |= a.labels_dirty;
    }
    if a.title_dirty {
        let t = title_text(a.api_level, a.init_error);
        a.title_dirty = show(a.txt_title, t.as_str()) != 0;
        failed |= a.title_dirty;
    }
    if a.nav_dirty {
        let t = nav_text(a.nav, a.nav_countdown);
        a.nav_dirty = show(a.txt_nav, t.as_str()) != 0;
        failed |= a.nav_dirty;
    }
    for k in 0..2 {
        if a.fields[k].result_dirty {
            let t = result_text(&a.fields[k]);
            a.fields[k].result_dirty = show(a.txt_result[k], t.as_str()) != 0;
            failed |= a.fields[k].result_dirty;
        }
        if a.fields[k].status_dirty {
            let t = status_text(&a.fields[k]);
            a.fields[k].status_dirty = show(a.txt_status[k], t.as_str()) != 0;
            failed |= a.fields[k].status_dirty;
        }
    }
    failed |= checks::render(a);
    if failed {
        a.next_text_try_s = a.now_s + TEXT_RETRY_S;
    }
}

pub mod checks;

#[cfg(test)]
mod tests;
