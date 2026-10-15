//! mission-control -- the Mission Control wall (`world://mission-control.micknerks`, DB-044).
//!
//! @kosmos-system  Content (KosmosWorlds) -- Mission Control
//! @kosmos-owner   Content lane
//! @kosmos-level   host API level 4 (`k_net_*`, `OnNetResult`); level 3 for
//!                 `k_haptic_pulse`, `k_node_clone`, `k_node_destroy`, `k_log`
//!
//! This script is deliberately DUMB. The bridge on the CEO's PC decides what the
//! wall says; the world only applies the snapshot it is sent (agent-bridge
//! `src/wire.ts`, format AB1) and reports presses. So:
//!
//!   - it never builds a sentence the bridge did not send, except its own
//!     connection lines ("Connecting...", "Can't reach the bridge");
//!   - a press is sent as the NODE NAME plus the snapshot version on screen, and
//!     the bridge works out what that meant (a stale press is refused there);
//!   - typed text comes only from the system typing sheet (`k_ui_prompt`), opened
//!     inside the press that asked for it (the activation gate), and goes to the
//!     bridge as the press's text;
//!   - when the bridge's approval counter (`Z`) rises, both controllers buzz
//!     twice (`k_haptic_pulse`) and a soft chime plays, so a new approval is
//!     noticed from anywhere in the room. The headset itself has no motor.
//!
//! The view is a long poll: one request open at a time, answered when the wall
//! changes (or after 6.5 s with `S`, "same"), never more than about one a
//! second, which keeps inside the host's 1/s refill and leaves the burst of 10
//! for presses.
//!
//! Node names: `NODES_TEXT`, `NODES_BUTTON`, `NODES_SHOW` mirror ../nodes.json
//! (generated from the bridge's face layout; a test here pins them equal).

#![cfg_attr(target_arch = "wasm32", no_std, no_main)]

#[cfg(not(target_arch = "wasm32"))]
fn main() {}

#[cfg(all(target_arch = "wasm32", not(test)))]
#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

// ---------------------------------------------------------------------------
// Host imports (module "kosmos"). Signatures: the levels table, level 4.
// ---------------------------------------------------------------------------

#[cfg(target_arch = "wasm32")]
mod host {
    #[link(wasm_import_module = "kosmos")]
    extern "C" {
        pub fn k_node_find(name_ptr: i32, name_len: i32) -> i32;
        pub fn k_node_set_visible(node: i32, visible: i32) -> i32;
        pub fn k_node_clone(src: i32, parent: i32, name_ptr: i32, name_len: i32) -> i32;
        pub fn k_node_destroy(node: i32) -> i32;
        pub fn k_transform_get_position(node: i32, x_ptr: i32, y_ptr: i32, z_ptr: i32) -> i32;
        pub fn k_transform_set_position(node: i32, x: f32, y: f32, z: f32) -> i32;
        pub fn k_transform_set_scale(node: i32, x: f32, y: f32, z: f32) -> i32;
        pub fn k_ui_show_world_text(node: i32, text_ptr: i32, text_len: i32, offset_y: f32) -> i32;
        pub fn k_ui_hide_world_text(node: i32) -> i32;
        pub fn k_ui_prompt(prompt_ptr: i32, prompt_len: i32, out_ptr: i32, out_cap: i32, request_id: i32) -> i32;
        pub fn k_event_subscribe(name_ptr: i32, name_len: i32, node: i32, callback_fn_index: i32) -> i32;
        pub fn k_event_subscribe_global(name_ptr: i32, name_len: i32, callback_fn_index: i32) -> i32;
        pub fn k_haptic_pulse(hand: i32, intensity: f32, duration_ms: i32) -> i32;
        pub fn k_audio_play(node: i32, name_ptr: i32, name_len: i32) -> i32;
        pub fn k_log(level: i32, ptr: i32, len: i32) -> i32;
        pub fn k_net_fetch(method: i32, url_ptr: i32, url_len: i32, body_ptr: i32, body_len: i32, flags: i32, request_id: i32) -> i32;
        pub fn k_net_read(request_id: i32, out_ptr: i32, out_cap: i32) -> i32;
        pub fn k_net_status() -> i32;
    }
}

/// Host-side stand-ins so `cargo test` links: no scene, no network.
#[cfg(not(target_arch = "wasm32"))]
#[allow(clippy::too_many_arguments)]
mod host {
    pub unsafe fn k_node_find(_p: i32, _l: i32) -> i32 { 0 }
    pub unsafe fn k_node_set_visible(_n: i32, _v: i32) -> i32 { 0 }
    pub unsafe fn k_node_clone(_s: i32, _p: i32, _n: i32, _l: i32) -> i32 { -1 }
    pub unsafe fn k_node_destroy(_n: i32) -> i32 { 0 }
    pub unsafe fn k_transform_get_position(_n: i32, _x: i32, _y: i32, _z: i32) -> i32 { -1 }
    pub unsafe fn k_transform_set_position(_n: i32, _x: f32, _y: f32, _z: f32) -> i32 { 0 }
    pub unsafe fn k_transform_set_scale(_n: i32, _x: f32, _y: f32, _z: f32) -> i32 { 0 }
    pub unsafe fn k_ui_show_world_text(_n: i32, _p: i32, _l: i32, _o: f32) -> i32 { 0 }
    pub unsafe fn k_ui_hide_world_text(_n: i32) -> i32 { 0 }
    pub unsafe fn k_ui_prompt(_p: i32, _l: i32, _o: i32, _c: i32, _r: i32) -> i32 { 0 }
    pub unsafe fn k_event_subscribe(_p: i32, _l: i32, _n: i32, _c: i32) -> i32 { 0 }
    pub unsafe fn k_event_subscribe_global(_p: i32, _l: i32, _c: i32) -> i32 { 0 }
    pub unsafe fn k_haptic_pulse(_h: i32, _i: f32, _d: i32) -> i32 { 0 }
    pub unsafe fn k_audio_play(_n: i32, _p: i32, _l: i32) -> i32 { 0 }
    pub unsafe fn k_log(_lv: i32, _p: i32, _l: i32) -> i32 { 0 }
    pub unsafe fn k_net_fetch(_m: i32, _u: i32, _ul: i32, _b: i32, _bl: i32, _f: i32, _r: i32) -> i32 { -2 }
    pub unsafe fn k_net_read(_r: i32, _o: i32, _c: i32) -> i32 { -7 }
    pub unsafe fn k_net_status() -> i32 { 0 }
}

// ---------------------------------------------------------------------------
// Contract constants
// ---------------------------------------------------------------------------

/// The bridge's public origin. `bridge-origin.txt` holds it so the CEO's tunnel
/// host is set in one place (it must also be the manifest's `network.connect`;
/// `tools/set-bridge-host.mjs` writes both).
const ORIGIN: &str = include_str!("../bridge-origin.txt");
const FACE_PATH_VIEW: &str = "/v1/faces/mission-control/view";
const FACE_PATH_PRESS: &str = "/v1/faces/mission-control/press";

const METHOD_POST: i32 = 1;
const HOST_TEXT_MAX_BYTES: usize = 128;
const READ_BUF_BYTES: usize = 16 * 1024;
/// A view is never sent sooner than this after the last one (the host refills 1 a second).
const VIEW_MIN_GAP_S: f32 = 1.1;
/// After a failure (no answer, refused, rate limited), wait this long before the next view.
const RETRY_GAP_S: f32 = 3.0;
const STATUS_POLL_S: f32 = 1.0;
/// Copies of the done chip step this far to the visitor's right (wasm +z), metres.
const CHIP_STEP_M: f32 = 0.085;
const MAX_CHIPS: usize = 12;
const CHIME: &str = "chime.wav";

pub const NODES_TEXT: [&str; 32] = [
    "TxTicker", "TxStatus", "TxLock", "TxProject", "TxCardA", "TxCardB", "TxCardC", "TxCardD", "TxNeedA", "TxNeedB", "TxNeedC",
    "TxDone", "TxRailA", "TxRailB", "TxRailC", "TxRailD", "TxHeader", "TxConvA", "TxConvB", "TxConvC", "TxConvD", "TxConvE",
    "TxConvF", "TxConvG", "TxConvH", "TxConvI", "TxConvJ", "TxConvK", "TxConvL", "TxPage", "TxAskA", "TxAskB",
];
pub const NODES_BUTTON: [&str; 30] = [
    "BtnSignIn", "BtnSignOut", "BtnTests", "BtnPrs", "BtnToday", "BtnNotes", "BtnNewTask", "BtnProject", "CardA", "CardB",
    "CardC", "CardD", "NeedA", "NeedB", "NeedC", "RailA", "RailB", "RailC", "RailD", "BtnStop", "BtnBack", "BtnApprove",
    "BtnDeny", "BtnWhy", "BtnKeep", "BtnSimple", "BtnSummary", "BtnReply", "BtnPageUp", "BtnPageDown",
];
pub const NODES_SHOW: [&str; 34] = [
    "LockPanel", "WallPanel", "ChatPanel", "AskPanel", "DoneShelf", "ChipDone", "PillRunA", "PillWaitA", "PillIdleA", "GlowA",
    "BarBgA", "BarA", "PillRunB", "PillWaitB", "PillIdleB", "GlowB", "BarBgB", "BarB", "PillRunC", "PillWaitC", "PillIdleC",
    "GlowC", "BarBgC", "BarC", "PillRunD", "PillWaitD", "PillIdleD", "GlowD", "BarBgD", "BarD", "RailSelA", "RailSelB",
    "RailSelC", "RailSelD",
];
const N_TEXT: usize = NODES_TEXT.len();
const N_BUTTON: usize = NODES_BUTTON.len();
const N_ALL: usize = N_TEXT + N_BUTTON + NODES_SHOW.len();

/// Clone names: no digits (the client strips a trailing `_<digit>`).
const CHIP_NAMES: [&str; MAX_CHIPS] = [
    "ChipCopyA", "ChipCopyB", "ChipCopyC", "ChipCopyD", "ChipCopyE", "ChipCopyF", "ChipCopyG", "ChipCopyH", "ChipCopyI", "ChipCopyJ",
    "ChipCopyK", "ChipCopyL",
];

fn node_name(i: usize) -> &'static str {
    if i < N_TEXT {
        NODES_TEXT[i]
    } else if i < N_TEXT + N_BUTTON {
        NODES_BUTTON[i - N_TEXT]
    } else {
        NODES_SHOW[i - N_TEXT - N_BUTTON]
    }
}

fn node_index(name: &[u8]) -> Option<usize> {
    (0..N_ALL).find(|&i| node_name(i).as_bytes() == name)
}

fn idx(name: &str) -> usize {
    node_index(name.as_bytes()).unwrap_or(0)
}

// ---------------------------------------------------------------------------
// State (single-threaded world wasm; `static mut` by value only)
// ---------------------------------------------------------------------------

const REQ_VIEW: i32 = 1;
const REQ_PRESS_FIRST: i32 = 100;
const REQ_PROMPT_BASE: i32 = 9000;
const MAX_PROMPTS: usize = 4;

static mut HANDLES: [i32; N_ALL] = [0; N_ALL];
/// FNV-1a of each label's text as last shown; 0 = not shown / unknown.
static mut TEXT_HASH: [u32; N_TEXT] = [0; N_TEXT];
/// -1 unknown, 0 hidden, 1 shown.
static mut VISIBLE: [i8; N_ALL] = [-1; N_ALL];
static mut BASE_POS: [[f32; 3]; N_ALL] = [[0.0; 3]; N_ALL];
static mut BASE_KNOWN: [bool; N_ALL] = [false; N_ALL];
static mut CHIPS: [i32; MAX_CHIPS] = [0; MAX_CHIPS];

static mut TOKEN: [u8; 96] = [0; 96];
static mut TOKEN_LEN: usize = 0;
static mut VERSION: u32 = 0;
static mut LAST_Z: i64 = -1;

static mut NOW_S: f32 = 0.0;
static mut VIEW_IN_FLIGHT: bool = false;
static mut NEXT_VIEW_AT: f32 = 0.0;
static mut NEXT_PRESS_ID: i32 = REQ_PRESS_FIRST;
static mut STATUS_ACC: f32 = 0.0;
static mut LAST_NET: i32 = i32::MIN;
static mut CONNECTED: bool = false;
static mut SECOND_BUZZ_AT: f32 = -1.0;

/// Prompt questions the bridge attached to nodes (`P` records): node index -> question.
static mut PROMPT_NODE: [usize; MAX_PROMPTS] = [usize::MAX; MAX_PROMPTS];
static mut PROMPT_Q: [[u8; 220]; MAX_PROMPTS] = [[0; 220]; MAX_PROMPTS];
static mut PROMPT_Q_LEN: [usize; MAX_PROMPTS] = [0; MAX_PROMPTS];
/// The node whose press opened the typing sheet; the host writes the answer here LATER.
static mut PROMPT_FOR: usize = usize::MAX;
static mut PROMPT_ANSWER: [u8; 256] = [0; 256];

static mut READ_BUF: [u8; READ_BUF_BYTES] = [0; READ_BUF_BYTES];
static mut REQ_BUF: [u8; 1024] = [0; 1024];
static mut URL_BUF: [u8; 256] = [0; 256];

fn origin() -> &'static str {
    ORIGIN.trim()
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn k_init() {
    let mut found = 0;
    for i in 0..N_ALL {
        let name = node_name(i);
        let h = unsafe { host::k_node_find(name.as_ptr() as i32, name.len() as i32) };
        unsafe { HANDLES[i] = h; }
        if h != 0 {
            found += 1;
        }
    }
    for i in N_TEXT..N_TEXT + N_BUTTON {
        let h = unsafe { HANDLES[i] };
        if h != 0 {
            let ev = "OnInteract";
            unsafe { host::k_event_subscribe(ev.as_ptr() as i32, ev.len() as i32, h, on_press as usize as i32); }
        }
    }
    let ev = "OnNetResult";
    unsafe { host::k_event_subscribe_global(ev.as_ptr() as i32, ev.len() as i32, on_net_result as usize as i32); }
    let ev = "OnPromptResult";
    unsafe { host::k_event_subscribe_global(ev.as_ptr() as i32, ev.len() as i32, on_prompt_result as usize as i32); }

    // Until the bridge answers: only the lock panel, and the world's own words.
    for i in N_TEXT..N_ALL {
        set_visible(i, node_name(i) == "LockPanel");
    }
    show(idx("TxTicker"), "MISSION CONTROL");
    show(idx("TxLock"), "Connecting to the bridge\non the PC...");
    let mut t = TextBuf::new();
    t.push("ready: ");
    t.push_i32(found);
    t.push("/");
    t.push_i32(N_ALL as i32);
    t.push(" parts");
    show(idx("TxStatus"), t.as_str());
    log(2, t.as_str());
    refresh_network(true);
}

#[no_mangle]
pub extern "C" fn k_tick(delta: f32) {
    let d = if delta.is_finite() && delta > 0.0 && delta < 1.0 { delta } else { 0.0 };
    unsafe { NOW_S += d; }
    let due = unsafe {
        STATUS_ACC += d;
        if STATUS_ACC >= STATUS_POLL_S {
            STATUS_ACC = 0.0;
            true
        } else {
            false
        }
    };
    if due {
        refresh_network(false);
    }
    unsafe {
        if SECOND_BUZZ_AT >= 0.0 && NOW_S >= SECOND_BUZZ_AT {
            SECOND_BUZZ_AT = -1.0;
            host::k_haptic_pulse(2, 0.8, 140);
        }
        if !VIEW_IN_FLIGHT && NOW_S >= NEXT_VIEW_AT && LAST_NET == 1 {
            send_view();
        }
    }
}

#[no_mangle]
pub extern "C" fn k_shutdown() {}

// ---------------------------------------------------------------------------
// Presses and typing
// ---------------------------------------------------------------------------

/// OnInteract on a button: open the typing sheet if the bridge asked for one, else send the press.
#[no_mangle]
pub extern "C" fn on_press(_event_type: i32, node: i32, _p1: i32, _p2: i32) {
    let Some(i) = (N_TEXT..N_TEXT + N_BUTTON).find(|&i| unsafe { HANDLES[i] } == node && node != 0) else {
        return;
    };
    if let Some(slot) = prompt_slot(i) {
        // Inside the press: the activation gate is met.
        let q = unsafe { &PROMPT_Q[slot][..PROMPT_Q_LEN[slot]] };
        let answer_ptr = core::ptr::addr_of_mut!(PROMPT_ANSWER) as *mut u8 as usize as i32;
        let rc = unsafe { host::k_ui_prompt(q.as_ptr() as i32, q.len() as i32, answer_ptr, 256, REQ_PROMPT_BASE + i as i32) };
        if rc == 0 {
            unsafe { PROMPT_FOR = i; }
        } else {
            local_status(match rc {
                -6 => "The typing sheet is already open.",
                -11 => "Press again: the typing sheet needs a fresh press.",
                _ => "The typing sheet would not open.",
            });
        }
        return;
    }
    send_press(i, &[]);
}

/// OnPromptResult: param2 = bytes written | -1 cancelled | -2 muted | -3 write failed.
#[no_mangle]
pub extern "C" fn on_prompt_result(_event_type: i32, _node: i32, request_id: i32, result: i32) {
    let i = unsafe { PROMPT_FOR };
    if i == usize::MAX || request_id != REQ_PROMPT_BASE + i as i32 {
        return;
    }
    unsafe { PROMPT_FOR = usize::MAX; }
    if result <= 0 {
        local_status(match result {
            0 => "Nothing typed, so nothing was sent.",
            -1 => "Cancelled.",
            -2 => "Typing is off for this visit (three cancels). Leave and come back.",
            _ => "The typing sheet failed.",
        });
        return;
    }
    let n = (result as usize).min(256);
    let text = unsafe { core::slice::from_raw_parts(core::ptr::addr_of!(PROMPT_ANSWER) as *const u8, n) };
    send_press(i, text);
}

fn prompt_slot(node: usize) -> Option<usize> {
    (0..MAX_PROMPTS).find(|&s| unsafe { PROMPT_NODE[s] } == node)
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

fn url(path: &str) -> &'static str {
    let buf = unsafe { &mut *core::ptr::addr_of_mut!(URL_BUF) };
    let mut n = 0;
    for &b in origin().as_bytes().iter().chain(path.as_bytes()) {
        if n < buf.len() {
            buf[n] = b;
            n += 1;
        }
    }
    unsafe { core::str::from_utf8_unchecked(&buf[..n]) }
}

/// Writes the AB1 request into REQ_BUF; returns its length.
fn build_request(press: Option<usize>, text: &[u8]) -> usize {
    let buf = unsafe { &mut *core::ptr::addr_of_mut!(REQ_BUF) };
    let mut w = Writer { buf, n: 0 };
    w.push(b"AB1\n");
    let tl = unsafe { TOKEN_LEN };
    if tl > 0 {
        w.push(b"tok ");
        w.push(unsafe { &TOKEN[..tl] });
        w.push(b"\n");
    }
    w.push(b"v ");
    w.push_u32(unsafe { VERSION });
    w.push(b"\n");
    if let Some(i) = press {
        w.push(b"press ");
        w.push(node_name(i).as_bytes());
        w.push(b"\n");
    }
    if !text.is_empty() {
        w.push(b"---\n");
        w.push(text);
    }
    w.n
}

fn send_view() {
    let len = build_request(None, &[]);
    let u = url(FACE_PATH_VIEW);
    let body = core::ptr::addr_of!(REQ_BUF) as *const u8;
    let rc = unsafe { host::k_net_fetch(METHOD_POST, u.as_ptr() as i32, u.len() as i32, body as i32, len as i32, 0, REQ_VIEW) };
    if rc == 0 {
        unsafe {
            VIEW_IN_FLIGHT = true;
            NEXT_VIEW_AT = NOW_S + VIEW_MIN_GAP_S;
        }
    } else {
        unsafe { NEXT_VIEW_AT = NOW_S + RETRY_GAP_S; }
        if rc == -6 {
            log(1, "view rate limited");
        } else {
            disconnected("Can't reach the bridge (the headset refused the call).");
        }
    }
}

fn send_press(i: usize, text: &[u8]) {
    let len = build_request(Some(i), text);
    let u = url(FACE_PATH_PRESS);
    let id = unsafe {
        let id = NEXT_PRESS_ID;
        NEXT_PRESS_ID = if NEXT_PRESS_ID >= 8999 { REQ_PRESS_FIRST } else { NEXT_PRESS_ID + 1 };
        id
    };
    let body = core::ptr::addr_of!(REQ_BUF) as *const u8;
    let rc = unsafe { host::k_net_fetch(METHOD_POST, u.as_ptr() as i32, u.len() as i32, body as i32, len as i32, 0, id) };
    if rc == 0 {
        local_status("Sending...");
    } else if rc == -6 {
        local_status("Too fast: wait a second and press again.");
    } else {
        local_status("The headset refused the call: network off for this world?");
    }
}

/// OnNetResult: param1 = request id, param2 = HTTP status | 0 no answer | -2 refused | -5 too large.
#[no_mangle]
pub extern "C" fn on_net_result(_event_type: i32, _node: i32, request_id: i32, status: i32) {
    if request_id == REQ_VIEW {
        unsafe { VIEW_IN_FLIGHT = false; }
    }
    if status != 200 {
        if request_id == REQ_VIEW {
            unsafe { NEXT_VIEW_AT = NOW_S + RETRY_GAP_S; }
        }
        disconnected(match status {
            0 => "Can't reach the bridge on the PC. Is it running?",
            -2 => "The headset stopped the call (network off for this world).",
            -5 => "The bridge answered with too much.",
            503 => "Stopped on the PC (the kill switch is on).",
            429 => "The bridge says slow down.",
            _ => "The bridge refused the call.",
        });
        return;
    }
    let len = unsafe { host::k_net_read(request_id, 0, 0) };
    if len <= 0 || len as usize > READ_BUF_BYTES {
        return;
    }
    let ptr = core::ptr::addr_of_mut!(READ_BUF) as *mut u8;
    let got = unsafe { host::k_net_read(request_id, ptr as usize as i32, READ_BUF_BYTES as i32) };
    if got <= 0 {
        return;
    }
    unsafe { CONNECTED = true; }
    let body = unsafe { core::slice::from_raw_parts(ptr, got as usize) };
    apply_snapshot(body);
}

fn disconnected(why: &str) {
    unsafe { CONNECTED = false; }
    local_status(why);
}

// ---------------------------------------------------------------------------
// Applying a snapshot (agent-bridge src/wire.ts)
// ---------------------------------------------------------------------------

pub fn apply_snapshot(body: &[u8]) {
    let mut lines = body.split(|&b| b == b'\n');
    if lines.next() != Some(b"AB1".as_slice()) {
        return;
    }
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let kind = line[0];
        let rest = if line.len() > 2 { &line[2..] } else { &[][..] };
        let (name, arg) = split_once(rest);
        match kind {
            b'V' => unsafe { VERSION = parse_u32(name) },
            b'M' => {
                if name == b"lock" {
                    unsafe { TOKEN_LEN = 0; }
                    set_chips(0);
                }
            }
            b'K' => {
                let n = name.len().min(96);
                unsafe {
                    TOKEN[..n].copy_from_slice(&name[..n]);
                    TOKEN_LEN = n;
                    LAST_Z = -1;
                }
            }
            b'E' => {
                if name == b"signed_out" {
                    unsafe { TOKEN_LEN = 0; }
                }
            }
            b'T' => {
                if let Some(i) = node_index(name) {
                    let mut t = TextBuf::new();
                    unescape_into(arg, &mut t);
                    show(i, t.as_str());
                }
            }
            b'X' => {
                if let Some(i) = node_index(name) {
                    hide_text(i);
                }
            }
            b'U' => {
                if let Some(i) = node_index(name) {
                    set_visible(i, arg == b"1");
                }
            }
            b'G' => {
                if let Some(i) = node_index(name) {
                    let f = (parse_u32(arg).min(1000) as f32 / 1000.0).max(0.02);
                    // Raw UE relative scale: the bar runs along UE Y, origin at its left end.
                    unsafe { host::k_transform_set_scale(HANDLES[i], 1.0, f, 1.0); }
                }
            }
            b'O' => {
                if let Some(i) = node_index(name) {
                    shift(i, parse_i32(arg) as f32 / 1000.0);
                }
            }
            b'C' => {
                if name == b"ChipDone" {
                    set_chips(parse_u32(arg) as usize);
                }
            }
            b'P' => {
                if let Some(i) = node_index(name) {
                    set_prompt(i, arg);
                }
            }
            b'Z' => {
                let z = parse_u32(name) as i64;
                let last = unsafe { LAST_Z };
                if last >= 0 && z > last {
                    buzz();
                }
                unsafe { LAST_Z = z; }
            }
            _ => {}
        }
    }
}

fn split_once(s: &[u8]) -> (&[u8], &[u8]) {
    match s.iter().position(|&b| b == b' ') {
        Some(p) => (&s[..p], &s[p + 1..]),
        None => (s, &[][..]),
    }
}

fn parse_u32(s: &[u8]) -> u32 {
    let mut v: u32 = 0;
    for &b in s {
        if !b.is_ascii_digit() {
            break;
        }
        v = v.saturating_mul(10).saturating_add((b - b'0') as u32);
    }
    v
}

fn parse_i32(s: &[u8]) -> i32 {
    if let Some((&b'-', rest)) = s.split_first() {
        -(parse_u32(rest).min(i32::MAX as u32) as i32)
    } else {
        parse_u32(s).min(i32::MAX as u32) as i32
    }
}

fn unescape_into(s: &[u8], t: &mut TextBuf) {
    let mut i = 0;
    while i < s.len() {
        if s[i] == b'\\' && i + 1 < s.len() {
            t.push_byte(if s[i + 1] == b'n' { b'\n' } else { s[i + 1] });
            i += 2;
        } else {
            t.push_byte(s[i]);
            i += 1;
        }
    }
}

fn set_prompt(node: usize, q: &[u8]) {
    let slot = prompt_slot(node).or_else(|| (0..MAX_PROMPTS).find(|&s| unsafe { PROMPT_NODE[s] } == usize::MAX));
    let Some(s) = slot else { return };
    let mut t = TextBuf::new();
    unescape_into(q, &mut t);
    let b = t.as_str().as_bytes();
    let n = b.len().min(220);
    unsafe {
        PROMPT_NODE[s] = node;
        PROMPT_Q[s][..n].copy_from_slice(&b[..n]);
        PROMPT_Q_LEN[s] = n;
    }
}

fn buzz() {
    unsafe {
        host::k_haptic_pulse(2, 0.8, 140);
        SECOND_BUZZ_AT = NOW_S + 0.25;
        host::k_audio_play(0, CHIME.as_ptr() as i32, CHIME.len() as i32);
    }
}

// ---------------------------------------------------------------------------
// Scene helpers
// ---------------------------------------------------------------------------

fn show(i: usize, text: &str) {
    if i >= N_TEXT {
        return;
    }
    let h = unsafe { HANDLES[i] };
    if h == 0 {
        return;
    }
    let mut end = text.len().min(HOST_TEXT_MAX_BYTES);
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    let text = if end == 0 { " " } else { &text[..end] };
    let hash = fnv(text.as_bytes());
    if unsafe { TEXT_HASH[i] } == hash {
        return;
    }
    let rc = unsafe { host::k_ui_show_world_text(h, text.as_ptr() as i32, text.len() as i32, 0.0) };
    unsafe { TEXT_HASH[i] = if rc == 0 { hash } else { 0 }; }
}

fn hide_text(i: usize) {
    if i >= N_TEXT || unsafe { TEXT_HASH[i] } == 1 {
        return;
    }
    let h = unsafe { HANDLES[i] };
    if h != 0 {
        unsafe { host::k_ui_hide_world_text(h); }
    }
    // 1 = "known hidden" (fnv never returns 1 for the strings we show; a clash only costs one redraw).
    unsafe { TEXT_HASH[i] = 1; }
}

/// The world's own line, shown at once and overwritten by the bridge's next status.
fn local_status(s: &str) {
    let i = idx("TxStatus");
    show(i, s);
    unsafe { TEXT_HASH[i] = 0; }
}

fn set_visible(i: usize, on: bool) {
    let want: i8 = if on { 1 } else { 0 };
    if unsafe { VISIBLE[i] } == want {
        return;
    }
    let h = unsafe { HANDLES[i] };
    if h != 0 {
        unsafe { host::k_node_set_visible(h, on as i32); }
    }
    unsafe { VISIBLE[i] = want; }
}

fn base_of(i: usize) -> Option<[f32; 3]> {
    if unsafe { BASE_KNOWN[i] } {
        return Some(unsafe { BASE_POS[i] });
    }
    let h = unsafe { HANDLES[i] };
    if h == 0 {
        return None;
    }
    let mut p = [0.0f32; 3];
    let rc = unsafe {
        host::k_transform_get_position(h, &mut p[0] as *mut f32 as i32, &mut p[1] as *mut f32 as i32, &mut p[2] as *mut f32 as i32)
    };
    if rc != 0 {
        return None;
    }
    unsafe {
        BASE_POS[i] = p;
        BASE_KNOWN[i] = true;
    }
    Some(p)
}

/// Move a node sideways from where it was authored, along the panel's right (wasm +z).
fn shift(i: usize, dz: f32) {
    if let Some(p) = base_of(i) {
        unsafe { host::k_transform_set_position(HANDLES[i], p[0], p[1], p[2] + dz); }
    }
}

fn set_chips(count: usize) {
    let src_i = idx("ChipDone");
    let src = unsafe { HANDLES[src_i] };
    let want = count.saturating_sub(1).min(MAX_CHIPS);
    for k in 0..MAX_CHIPS {
        let have = unsafe { CHIPS[k] };
        if k < want && have == 0 && src != 0 {
            let name = CHIP_NAMES[k];
            let h = unsafe { host::k_node_clone(src, 0, name.as_ptr() as i32, name.len() as i32) };
            if h > 0 {
                if let Some(p) = base_of(src_i) {
                    unsafe { host::k_transform_set_position(h, p[0], p[1], p[2] + CHIP_STEP_M * (k as f32 + 1.0)); }
                }
                unsafe { CHIPS[k] = h; }
            }
        } else if k >= want && have != 0 {
            unsafe {
                host::k_node_destroy(have);
                CHIPS[k] = 0;
            }
        }
    }
}

fn refresh_network(force: bool) {
    let s = unsafe { host::k_net_status() };
    let changed = unsafe {
        let c = s != LAST_NET;
        LAST_NET = s;
        c
    };
    if !(changed || force) {
        return;
    }
    if s != 1 {
        unsafe { CONNECTED = false; }
        local_status(match s {
            0 => "Network is off for this world right now.",
            -2 => "This world did not declare network (a build error).",
            _ => "Network state unknown.",
        });
    } else {
        unsafe { NEXT_VIEW_AT = NOW_S; }
    }
}

fn log(level: i32, s: &str) {
    unsafe { host::k_log(level, s.as_ptr() as i32, s.len() as i32); }
}

fn fnv(b: &[u8]) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for &x in b {
        h ^= x as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    if h <= 1 { h + 2 } else { h }
}

// ---------------------------------------------------------------------------
// Fixed-size text (no allocator in a no_std world)
// ---------------------------------------------------------------------------

struct Writer<'a> {
    buf: &'a mut [u8],
    n: usize,
}

impl Writer<'_> {
    fn push(&mut self, s: &[u8]) {
        for &b in s {
            if self.n < self.buf.len() {
                self.buf[self.n] = b;
                self.n += 1;
            }
        }
    }
    fn push_u32(&mut self, v: u32) {
        let mut d = [0u8; 10];
        let mut n = 0;
        let mut r = v;
        loop {
            d[n] = b'0' + (r % 10) as u8;
            n += 1;
            r /= 10;
            if r == 0 {
                break;
            }
        }
        while n > 0 {
            n -= 1;
            self.push(&[d[n]]);
        }
    }
}

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
        let mut w = Writer { buf: &mut [0u8; 10], n: 0 };
        w.push_u32(v.unsigned_abs());
        let n = w.n;
        let digits = &w.buf[..n];
        let mut tmp = [0u8; 10];
        tmp[..n].copy_from_slice(digits);
        for &b in &tmp[..n] {
            self.push_byte(b);
        }
    }
    fn as_str(&self) -> &str {
        core::str::from_utf8(&self.buf[..self.len]).unwrap_or("")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn json_array(src: &str, key: &str) -> Vec<String> {
        let start = src.find(&format!("\"{key}\"")).expect(key);
        let open = start + src[start..].find('[').unwrap();
        let close = open + src[open..].find(']').unwrap();
        src[open + 1..close].split(',').map(|s| s.trim().trim_matches('"').to_string()).filter(|s| !s.is_empty()).collect()
    }

    #[test]
    fn node_names_match_nodes_json() {
        let src = include_str!("../nodes.json");
        assert_eq!(json_array(src, "text"), NODES_TEXT.iter().map(|s| s.to_string()).collect::<Vec<_>>());
        assert_eq!(json_array(src, "buttons"), NODES_BUTTON.iter().map(|s| s.to_string()).collect::<Vec<_>>());
        assert_eq!(json_array(src, "show"), NODES_SHOW.iter().map(|s| s.to_string()).collect::<Vec<_>>());
        for n in NODES_TEXT.iter().chain(NODES_BUTTON.iter()).chain(NODES_SHOW.iter()).chain(CHIP_NAMES.iter()) {
            assert!(!n.ends_with(|c: char| c.is_ascii_digit()), "{n}");
        }
    }

    #[test]
    fn origin_is_https_with_no_path() {
        let o = origin();
        assert!(o.starts_with("https://"), "{o}");
        assert!(!o[8..].contains('/'), "{o}");
        assert!(o.len() + FACE_PATH_PRESS.len() <= 256);
    }

    #[test]
    fn requests_follow_the_wire_format() {
        unsafe {
            TOKEN[..5].copy_from_slice(b"abcde");
            TOKEN_LEN = 5;
            VERSION = 42;
        }
        let n = build_request(Some(idx("BtnReply")), b"Keep going");
        let body = unsafe { core::str::from_utf8(&REQ_BUF[..n]).unwrap().to_string() };
        assert_eq!(body, "AB1\ntok abcde\nv 42\npress BtnReply\n---\nKeep going");
        assert!(n <= 1024);
        unsafe { TOKEN_LEN = 0; }
    }

    #[test]
    fn a_snapshot_sets_version_token_prompts_and_buzz_state() {
        let snap = b"AB1\nV 7\nM wall\nK tok123\nT TxTicker 3 working\\n|ok\nU CardA 1\nG BarA 620\nO TxConvA -894\nC ChipDone 0\nP BtnNewTask New task: what?\nZ 4\n";
        apply_snapshot(snap);
        unsafe {
            assert_eq!(VERSION, 7);
            assert_eq!(&TOKEN[..TOKEN_LEN], b"tok123");
            assert_eq!(LAST_Z, 4);
        }
        let s = prompt_slot(idx("BtnNewTask")).expect("prompt stored");
        unsafe { assert_eq!(&PROMPT_Q[s][..PROMPT_Q_LEN[s]], b"New task: what?"); }
        apply_snapshot(b"AB1\nV 8\nM lock\nE signed_out\n");
        unsafe { assert_eq!(TOKEN_LEN, 0); }
        // Garbage is ignored, never a crash.
        apply_snapshot(b"not a snapshot");
        apply_snapshot(b"AB1\nT\nU\nG BarA\nO TxConvA -\nZ\nQ whatever\n");
    }

    #[test]
    fn numbers_parse() {
        assert_eq!(parse_i32(b"-894"), -894);
        assert_eq!(parse_i32(b"12"), 12);
        assert_eq!(parse_u32(b"99999999999"), u32::MAX);
        let mut t = TextBuf::new();
        unescape_into(b"a\\nb\\\\c", &mut t);
        assert_eq!(t.as_str(), "a\nb\\c");
    }
}
