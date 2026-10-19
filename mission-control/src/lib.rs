//! lobby + Mission Control -- the program of `world://lobby.micknerks` (DB-044).
//!
//! @kosmos-system  Content (KosmosWorlds) -- the Lobby, with Mission Control inside
//! @kosmos-owner   Content lane
//! @kosmos-level   host API level 4 (`k_net_*`, `OnNetResult`); level 3 for
//!                 `k_haptic_pulse`, `k_node_clone`, `k_node_destroy`, `k_log`
//!
//! Two jobs:
//!
//! 1. **The Lobby's music**, ported exactly from the 1.1.1 program (797 bytes, no source
//!    on disk; read from its disassembly): `lobby_ypsilon_01.ogg` then `_02.ogg`,
//!    alternating, volume 0.4, a failed start retried up to three times a second apart,
//!    stopped at shutdown.
//!
//! 2. **Mission Control**, the CEO's Claude Code jobs on a wall (agent-bridge on the CEO's
//!    PC). It is closed for every visitor, and **makes no network call at all**, until:
//!      - the ritual: stand on the throne facing the hall, point at the unmarked spot on
//!        the front of the seat (`McSeal`), press A, type the bridge's passphrase on the
//!        system typing sheet. The first call is that sign-in. (A hidden door, not a lock:
//!        anyone who watches can repeat the gesture; the passphrase is the lock.)
//!      - or the Watch button by the throne (`McWatchJoin`) and a watch code the owner
//!        shared. A watcher gets a read-only copy of the owner's wall; this program never
//!        sends a watcher's presses.
//!    The panel is authored 200 m below the floor (`PARK_DROP_M`) and raised in front of
//!    the throne on open; Close (or leaving the Lobby) parks it again.
//!
//! The wall itself is dumb on purpose: the bridge decides every word and sends AB1
//! snapshots (agent-bridge `src/wire.ts`); this program applies them and reports presses
//! (the node name plus the snapshot version on screen). A new approval buzzes both
//! controllers twice and chimes, for the owner only. The bridge may only name the face's
//! nodes; the world's own nodes (seal, Watch button, handles, frames) are never its to move.
//!
//! Node names mirror ../nodes.json (generated from the bridge's face layout); a test pins it.

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
        pub fn k_transform_get_rotation(node: i32, pitch_ptr: i32, yaw_ptr: i32, roll_ptr: i32) -> i32;
        pub fn k_transform_set_rotation(node: i32, pitch: f32, yaw: f32, roll: f32) -> i32;
        pub fn k_ui_show_world_text(node: i32, text_ptr: i32, text_len: i32, offset_y: f32) -> i32;
        pub fn k_ui_hide_world_text(node: i32) -> i32;
        pub fn k_ui_prompt(prompt_ptr: i32, prompt_len: i32, out_ptr: i32, out_cap: i32, request_id: i32) -> i32;
        pub fn k_event_subscribe(name_ptr: i32, name_len: i32, node: i32, callback_fn_index: i32) -> i32;
        pub fn k_event_subscribe_global(name_ptr: i32, name_len: i32, callback_fn_index: i32) -> i32;
        pub fn k_haptic_pulse(hand: i32, intensity: f32, duration_ms: i32) -> i32;
        pub fn k_audio_play(node: i32, name_ptr: i32, name_len: i32) -> i32;
        pub fn k_audio_play_ex(node: i32, name_ptr: i32, name_len: i32, volume: f32, pitch: f32, looped: i32) -> i32;
        pub fn k_audio_stop(source: i32) -> i32;
        pub fn k_log(level: i32, ptr: i32, len: i32) -> i32;
        pub fn k_net_fetch(method: i32, url_ptr: i32, url_len: i32, body_ptr: i32, body_len: i32, flags: i32, request_id: i32) -> i32;
        pub fn k_net_read(request_id: i32, out_ptr: i32, out_cap: i32) -> i32;
        pub fn k_net_status() -> i32;
    }
}

/// Host-side stand-ins so `cargo test` links. Calls are counted, so the tests can prove a
/// closed Mission Control makes no network call.
#[cfg(not(target_arch = "wasm32"))]
#[allow(clippy::too_many_arguments)]
mod host {
    pub static mut FETCHES: i32 = 0;
    pub static mut PROMPTS: i32 = 0;
    pub static mut AUDIO_PLAYS: i32 = 0;
    // A stable non-zero handle per name (its length plus a salt) is enough for these tests.
    pub unsafe fn k_node_find(p: i32, l: i32) -> i32 { (p % 997).abs() * 64 + l }
    pub unsafe fn k_node_set_visible(_n: i32, _v: i32) -> i32 { 0 }
    pub unsafe fn k_node_clone(_s: i32, _p: i32, _n: i32, _l: i32) -> i32 { -1 }
    pub unsafe fn k_node_destroy(_n: i32) -> i32 { 0 }
    pub unsafe fn k_transform_get_position(_n: i32, _x: i32, _y: i32, _z: i32) -> i32 { -1 }
    pub unsafe fn k_transform_set_position(_n: i32, _x: f32, _y: f32, _z: f32) -> i32 { 0 }
    pub unsafe fn k_transform_set_scale(_n: i32, _x: f32, _y: f32, _z: f32) -> i32 { 0 }
    pub unsafe fn k_transform_get_rotation(_n: i32, _p: i32, _y: i32, _r: i32) -> i32 { -1 }
    pub unsafe fn k_transform_set_rotation(_n: i32, _p: f32, _y: f32, _r: f32) -> i32 { 0 }
    pub unsafe fn k_ui_show_world_text(_n: i32, _p: i32, _l: i32, _o: f32) -> i32 { 0 }
    pub unsafe fn k_ui_hide_world_text(_n: i32) -> i32 { 0 }
    pub unsafe fn k_ui_prompt(_p: i32, _l: i32, _o: i32, _c: i32, _r: i32) -> i32 { PROMPTS += 1; 0 }
    pub unsafe fn k_event_subscribe(_p: i32, _l: i32, _n: i32, _c: i32) -> i32 { 1 }
    pub unsafe fn k_event_subscribe_global(_p: i32, _l: i32, _c: i32) -> i32 { 1 }
    pub unsafe fn k_haptic_pulse(_h: i32, _i: f32, _d: i32) -> i32 { 0 }
    pub unsafe fn k_audio_play(_n: i32, _p: i32, _l: i32) -> i32 { 0 }
    pub unsafe fn k_audio_play_ex(_n: i32, _p: i32, _l: i32, _v: f32, _pi: f32, _lo: i32) -> i32 { AUDIO_PLAYS += 1; 0 }
    pub unsafe fn k_audio_stop(_s: i32) -> i32 { 0 }
    pub unsafe fn k_log(_lv: i32, _p: i32, _l: i32) -> i32 { 0 }
    pub unsafe fn k_net_fetch(_m: i32, _u: i32, _ul: i32, _b: i32, _bl: i32, _f: i32, _r: i32) -> i32 { FETCHES += 1; 0 }
    pub unsafe fn k_net_read(_r: i32, _o: i32, _c: i32) -> i32 { -7 }
    pub unsafe fn k_net_status() -> i32 { 1 }
}

// ---------------------------------------------------------------------------
// The music (exact port of the Lobby 1.1.1 program)
// ---------------------------------------------------------------------------

mod music {
    use super::host;

    const TRACKS: [&str; 2] = ["lobby_ypsilon_01.ogg", "lobby_ypsilon_02.ogg"];
    /// Track lengths in seconds (the 1.1.1 program's data section: 239.35 and 123.11).
    const LENGTH_S: [f64; 2] = [239.35, 123.11];
    const VOLUME: f32 = 0.4;
    const RETRY_EVERY_S: f64 = 1.0;
    const MAX_TRIES: u8 = 3;

    static mut PLAYING: bool = false;
    static mut OK: bool = false;
    static mut TRACK: usize = 0;
    static mut TRIES: u8 = 0;
    static mut ELAPSED: f64 = 0.0;
    static mut RETRY: f64 = 0.0;

    fn play() {
        unsafe {
            TRIES = TRIES.wrapping_add(1);
            let name = TRACKS[TRACK];
            let rc = host::k_audio_play_ex(0, name.as_ptr() as i32, name.len() as i32, VOLUME, 1.0, 0);
            ELAPSED = 0.0;
            RETRY = 0.0;
            OK = rc == 0;
        }
    }

    pub fn init() {
        unsafe {
            host::k_audio_stop(0);
            PLAYING = true;
            OK = false;
            TRACK = 0;
            TRIES = 0;
        }
        play();
    }

    pub fn tick(dt: f32) {
        if !(dt.is_finite() && dt > 0.0) || unsafe { !PLAYING } {
            return;
        }
        let dt = dt as f64;
        unsafe {
            if !OK {
                RETRY += dt;
                if RETRY < RETRY_EVERY_S || TRIES >= MAX_TRIES {
                    return;
                }
            } else {
                ELAPSED += dt;
                if ELAPSED < LENGTH_S[TRACK] {
                    return;
                }
                host::k_audio_stop(0);
                TRACK ^= 1;
                TRIES = 0;
            }
        }
        play();
    }

    pub fn shutdown() {
        unsafe {
            OK = false;
            PLAYING = false;
            host::k_audio_stop(0);
        }
    }
}

// ---------------------------------------------------------------------------
// Contract constants
// ---------------------------------------------------------------------------

/// The bridge's public origin (`bridge-origin.txt`; `set-bridge-host.mjs` writes it and the
/// manifest's `network.connect` together).
const ORIGIN: &str = include_str!("../bridge-origin.txt");
const PATH_VIEW: &str = "/v1/faces/mission-control/view";
const PATH_PRESS: &str = "/v1/faces/mission-control/press";
const PATH_SIGNIN: &str = "/v1/faces/mission-control/signin";
const PATH_WATCH: &str = "/v1/faces/mission-control/watch";

const METHOD_POST: i32 = 1;
const HOST_TEXT_MAX_BYTES: usize = 128;
const READ_BUF_BYTES: usize = 16 * 1024;
/// A poll is never sent sooner than this after the last one (the host refills 1 a second).
const VIEW_MIN_GAP_S: f32 = 1.1;
/// After a failure (no answer, refused, rate limited), wait this long before the next poll.
const RETRY_GAP_S: f32 = 3.0;
const STATUS_POLL_S: f32 = 1.0;
/// The panel is authored this far below the Lobby floor (blender/build_panel.py PARK_DROP).
const PARK_DROP_M: f32 = 200.0;
/// The panel's right, as the owner on the throne sees it: wasm -z (the throne faces -x).
const RIGHT: [f32; 3] = [0.0, 0.0, -1.0];
/// Toward the owner: wasm +x (the panel stands in front of the throne, at smaller x).
const TOWARD: [f32; 3] = [1.0, 0.0, 0.0];
/// A watcher stands in the hall, not on the throne, so a watcher's copy of the panel is
/// turned 180 degrees about the centre panel's vertical axis (wasm x = 11.9, z = 0; the
/// owner's layout puts the centre panel 2.9 m in front of the seat at x 14.8) and lowered
/// to the hall floor (seat top 1.46 m, floor 0.03 m). Its right and "toward" flip too.
const WATCH_PIVOT_X: f32 = 11.9;
const WATCH_LOWER_M: f32 = 1.43;
const RIGHT_WATCH: [f32; 3] = [0.0, 0.0, 1.0];
const TOWARD_WATCH: [f32; 3] = [-1.0, 0.0, 0.0];
const MOVE_STEP_M: f32 = 0.15;
/// Limits of the owner's adjustments: nearer, farther, up/down, sideways (metres).
const MOVE_NEAR: f32 = 1.2;
const MOVE_FAR: f32 = 1.0;
const MOVE_UPDOWN: f32 = 0.9;
const MOVE_SIDE: f32 = 1.5;
/// Copies of the done chip step this far along the panel's right.
const CHIP_STEP_M: f32 = 0.085;
const MAX_CHIPS: usize = 12;
const CHIME: &str = "chime.wav";

const SEAL_QUESTION: &str = "Mission Control passphrase (it shows on screen as you type)";
const WATCH_QUESTION: &str = "Watch code: the 6 digits the owner shared with the group";

pub const NODES_TEXT: [&str; 33] = [
    "TxTicker", "TxStatus", "TxLock", "TxProject", "TxCardA", "TxCardB", "TxCardC", "TxCardD", "TxNeedA", "TxNeedB", "TxNeedC",
    "TxDone", "TxRailA", "TxRailB", "TxRailC", "TxRailD", "TxHeader", "TxConvA", "TxConvB", "TxConvC", "TxConvD", "TxConvE",
    "TxConvF", "TxConvG", "TxConvH", "TxConvI", "TxConvJ", "TxConvK", "TxConvL", "TxPage", "TxAskA", "TxAskB", "TxWatch",
];
pub const NODES_BUTTON: [&str; 31] = [
    "BtnSignIn", "BtnSignOut", "BtnTests", "BtnPrs", "BtnToday", "BtnNotes", "BtnNewTask", "BtnProject", "CardA", "CardB",
    "CardC", "CardD", "NeedA", "NeedB", "NeedC", "RailA", "RailB", "RailC", "RailD", "BtnStop", "BtnBack", "BtnApprove",
    "BtnDeny", "BtnWhy", "BtnKeep", "BtnSimple", "BtnSummary", "BtnReply", "BtnPageUp", "BtnPageDown", "BtnWatch",
];
pub const NODES_SHOW: [&str; 34] = [
    "LockPanel", "WallPanel", "ChatPanel", "AskPanel", "DoneShelf", "ChipDone", "PillRunA", "PillWaitA", "PillIdleA", "GlowA",
    "BarBgA", "BarA", "PillRunB", "PillWaitB", "PillIdleB", "GlowB", "BarBgB", "BarB", "PillRunC", "PillWaitC", "PillIdleC",
    "GlowC", "BarBgC", "BarC", "PillRunD", "PillWaitD", "PillIdleD", "GlowD", "BarBgD", "BarD", "RailSelA", "RailSelB",
    "RailSelC", "RailSelD",
];
pub const NODES_WORLD: [&str; 13] = [
    "McSeal", "McWatchJoin", "McClose", "McMoveCloser", "McMoveFarther", "McMoveLeft", "McMoveRight", "McMoveUp", "McMoveDown",
    "McCenterFrame", "McLeftFrame", "McRightFrame", "McPageDock",
];
/// World nodes shown whenever the panel is open (the snapshot sets the face's nodes).
const OPEN_SHOWS: [&str; 11] = [
    "McCenterFrame", "McLeftFrame", "McRightFrame", "McClose", "McMoveCloser", "McMoveFarther", "McMoveLeft", "McMoveRight",
    "McMoveUp", "McMoveDown", "McPageDock",
];
const N_TEXT: usize = NODES_TEXT.len();
const N_BUTTON: usize = NODES_BUTTON.len();
const N_SHOW: usize = NODES_SHOW.len();
const N_FACE: usize = N_TEXT + N_BUTTON + N_SHOW;
const N_ALL: usize = N_FACE + NODES_WORLD.len();

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
    } else if i < N_FACE {
        NODES_SHOW[i - N_TEXT - N_BUTTON]
    } else {
        NODES_WORLD[i - N_FACE]
    }
}

fn node_index(name: &[u8]) -> Option<usize> {
    (0..N_ALL).find(|&i| node_name(i).as_bytes() == name)
}

fn idx(name: &str) -> usize {
    node_index(name.as_bytes()).unwrap_or(0)
}

/// The two fixtures every visitor sees; everything else is the panel (parked when closed).
fn is_fixture(i: usize) -> bool {
    let n = node_name(i);
    n == "McSeal" || n == "McWatchJoin"
}

/// Nodes a press is sent for: the face's buttons (never the world's own controls).
fn is_face_button(i: usize) -> bool {
    (N_TEXT..N_TEXT + N_BUTTON).contains(&i)
}

/// World nodes that are pressed (not the frames or the page dock).
fn is_world_control(i: usize) -> bool {
    i >= N_FACE && !node_name(i).ends_with("Frame") && node_name(i) != "McPageDock"
}

// ---------------------------------------------------------------------------
// State (single-threaded world wasm; `static mut` by value only)
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Debug)]
enum Mode {
    Closed,
    Owner,
    Watcher,
}

const REQ_VIEW: i32 = 1;
const REQ_SIGNIN: i32 = 2;
const REQ_PRESS_FIRST: i32 = 100;
const REQ_PROMPT_SEAL: i32 = 8001;
const REQ_PROMPT_WATCH: i32 = 8002;
const REQ_PROMPT_BASE: i32 = 9000;
const MAX_PROMPTS: usize = 4;

static mut MODE: Mode = Mode::Closed;
static mut HANDLES: [i32; N_ALL] = [0; N_ALL];
/// FNV-1a of each label's text as last shown; 0 = not shown / unknown, 1 = known hidden.
static mut TEXT_HASH: [u32; N_TEXT] = [0; N_TEXT];
/// -1 unknown, 0 hidden, 1 shown.
static mut VISIBLE: [i8; N_ALL] = [-1; N_ALL];
static mut BASE_POS: [[f32; 3]; N_ALL] = [[0.0; 3]; N_ALL];
static mut BASE_KNOWN: [bool; N_ALL] = [false; N_ALL];
/// Each node's sideways shift along the panel's right (`O` records), metres.
static mut SHIFT: [f32; N_ALL] = [0.0; N_ALL];
/// The panel's offset from where it is authored: zero when parked.
static mut DELTA: [f32; 3] = [0.0; 3];
/// The owner's own adjustments (toward, up, right), metres.
static mut ADJUST: [f32; 3] = [0.0; 3];
static mut CHIPS: [i32; MAX_CHIPS] = [0; MAX_CHIPS];
/// Each node's authored rotation (pitch, yaw, roll; raw UE degrees), to turn a watcher's copy.
static mut BASE_ROT: [[f32; 3]; N_ALL] = [[0.0; 3]; N_ALL];
static mut BASE_ROT_KNOWN: [bool; N_ALL] = [false; N_ALL];
/// True while the panel nodes are turned for a watcher.
static mut TURNED: bool = false;

static mut TOKEN: [u8; 96] = [0; 96];
static mut TOKEN_LEN: usize = 0;
static mut WATCH_CODE: [u8; 6] = [0; 6];
static mut VERSION: u32 = 0;
static mut LAST_Z: i64 = -1;

static mut NOW_S: f32 = 0.0;
static mut POLL_IN_FLIGHT: bool = false;
/// A watcher whose code the bridge refused (off, wrong, the owner left): stop polling until Close.
static mut WATCH_ENDED: bool = false;
static mut NEXT_POLL_AT: f32 = 0.0;
static mut NEXT_PRESS_ID: i32 = REQ_PRESS_FIRST;
static mut STATUS_ACC: f32 = 0.0;
static mut LAST_NET: i32 = i32::MIN;
static mut SECOND_BUZZ_AT: f32 = -1.0;

static mut PROMPT_NODE: [usize; MAX_PROMPTS] = [usize::MAX; MAX_PROMPTS];
static mut PROMPT_Q: [[u8; 220]; MAX_PROMPTS] = [[0; 220]; MAX_PROMPTS];
static mut PROMPT_Q_LEN: [usize; MAX_PROMPTS] = [0; MAX_PROMPTS];
/// The request id of the typing sheet that is open (0 = none). The host writes the answer LATER.
static mut PROMPT_OPEN: i32 = 0;
static mut PROMPT_ANSWER: [u8; 256] = [0; 256];

static mut READ_BUF: [u8; READ_BUF_BYTES] = [0; READ_BUF_BYTES];
static mut REQ_BUF: [u8; 1024] = [0; 1024];
static mut URL_BUF: [u8; 256] = [0; 256];

fn mode() -> Mode {
    unsafe { MODE }
}

fn origin() -> &'static str {
    ORIGIN.trim()
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn k_init() {
    music::init();
    let mut found = 0;
    for i in 0..N_ALL {
        let name = node_name(i);
        let h = unsafe { host::k_node_find(name.as_ptr() as i32, name.len() as i32) };
        unsafe { HANDLES[i] = h; }
        if h != 0 {
            found += 1;
        }
    }
    let ev = "OnInteract";
    for i in 0..N_ALL {
        let h = unsafe { HANDLES[i] };
        if h != 0 && (is_face_button(i) || is_world_control(i)) {
            unsafe { host::k_event_subscribe(ev.as_ptr() as i32, ev.len() as i32, h, on_press as usize as i32); }
        }
    }
    let ev = "OnNetResult";
    unsafe { host::k_event_subscribe_global(ev.as_ptr() as i32, ev.len() as i32, on_net_result as usize as i32); }
    let ev = "OnPromptResult";
    unsafe { host::k_event_subscribe_global(ev.as_ptr() as i32, ev.len() as i32, on_prompt_result as usize as i32); }

    // Every panel node: remember where it is authored (parked), and hide it.
    for i in 0..N_ALL {
        if !is_fixture(i) {
            base_of(i);
            base_rot_of(i);
            set_visible(i, false);
        }
    }
    let mut t = TextBuf::new();
    t.push("mission control: ");
    t.push_i32(found);
    t.push("/");
    t.push_i32(N_ALL as i32);
    t.push(" parts, closed");
    log(2, t.as_str());
}

#[no_mangle]
pub extern "C" fn k_tick(delta: f32) {
    music::tick(delta);
    let d = if delta.is_finite() && delta > 0.0 && delta < 1.0 { delta } else { 0.0 };
    unsafe { NOW_S += d; }
    if mode() == Mode::Closed {
        return; // closed: no polling, no network status, nothing
    }
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
    }
    let ready = unsafe { !POLL_IN_FLIGHT && NOW_S >= NEXT_POLL_AT && LAST_NET == 1 };
    if ready {
        match mode() {
            Mode::Owner if unsafe { TOKEN_LEN } > 0 => send_poll(PATH_VIEW),
            Mode::Watcher if unsafe { !WATCH_ENDED } => send_poll(PATH_WATCH),
            _ => {}
        }
    }
}

#[no_mangle]
pub extern "C" fn k_shutdown() {
    music::shutdown();
}

// ---------------------------------------------------------------------------
// Presses and typing
// ---------------------------------------------------------------------------

/// OnInteract: the seal, the Watch button, the panel's own controls, or a face button.
#[no_mangle]
pub extern "C" fn on_press(_event_type: i32, node: i32, _p1: i32, _p2: i32) {
    if node == 0 {
        return;
    }
    let Some(i) = (0..N_ALL).find(|&i| unsafe { HANDLES[i] } == node) else {
        return;
    };
    match node_name(i) {
        "McSeal" => {
            if mode() == Mode::Closed {
                open_sheet(SEAL_QUESTION, REQ_PROMPT_SEAL);
            }
        }
        "McWatchJoin" => match mode() {
            Mode::Closed => open_sheet(WATCH_QUESTION, REQ_PROMPT_WATCH),
            Mode::Watcher => close_panel(),
            Mode::Owner => local_status("You are the owner here: the watch code is for your group."),
        },
        "McClose" => close_panel(),
        "McMoveCloser" => nudge(0, MOVE_STEP_M),
        "McMoveFarther" => nudge(0, -MOVE_STEP_M),
        "McMoveUp" => nudge(1, MOVE_STEP_M),
        "McMoveDown" => nudge(1, -MOVE_STEP_M),
        "McMoveRight" => nudge(2, MOVE_STEP_M),
        "McMoveLeft" => nudge(2, -MOVE_STEP_M),
        _ if is_face_button(i) => match mode() {
            Mode::Owner => {
                if let Some(slot) = prompt_slot(i) {
                    let q = unsafe { &PROMPT_Q[slot][..PROMPT_Q_LEN[slot]] };
                    let q = core::str::from_utf8(q).unwrap_or("Type here");
                    open_sheet(q, REQ_PROMPT_BASE + i as i32);
                } else {
                    send_press(i, &[]);
                }
            }
            Mode::Watcher => local_status("You are watching: only the owner can press."),
            Mode::Closed => {}
        },
        _ => {}
    }
}

/// Opens the system typing sheet, inside the press that asked for it (the activation gate).
fn open_sheet(question: &str, request_id: i32) {
    let answer_ptr = core::ptr::addr_of_mut!(PROMPT_ANSWER) as *mut u8 as usize as i32;
    let rc = unsafe { host::k_ui_prompt(question.as_ptr() as i32, question.len() as i32, answer_ptr, 256, request_id) };
    if rc == 0 {
        unsafe { PROMPT_OPEN = request_id; }
    } else if mode() != Mode::Closed {
        local_status(match rc {
            -6 => "The typing sheet is already open.",
            -11 => "Press again: the typing sheet needs a fresh press.",
            _ => "The typing sheet would not open.",
        });
    }
}

/// OnPromptResult: param2 = bytes written | -1 cancelled | -2 muted | -3 write failed.
#[no_mangle]
pub extern "C" fn on_prompt_result(_event_type: i32, _node: i32, request_id: i32, result: i32) {
    let open = unsafe { PROMPT_OPEN };
    if open == 0 || request_id != open {
        return;
    }
    unsafe { PROMPT_OPEN = 0; }
    if result <= 0 {
        if mode() != Mode::Closed {
            local_status(match result {
                0 => "Nothing typed, so nothing was sent.",
                -1 => "Cancelled.",
                -2 => "Typing is off for this visit (three cancels). Leave and come back.",
                _ => "The typing sheet failed.",
            });
        }
        return;
    }
    let n = (result as usize).min(256);
    let text = unsafe { core::slice::from_raw_parts(core::ptr::addr_of!(PROMPT_ANSWER) as *const u8, n) };
    match request_id {
        REQ_PROMPT_SEAL => {
            // The ritual's answer: open the panel and make the FIRST network call, the sign-in.
            open_panel(Mode::Owner, "Signing in...");
            send_signin(text);
        }
        REQ_PROMPT_WATCH => {
            let mut code = [0u8; 6];
            let mut k = 0;
            for &b in text {
                if b.is_ascii_digit() && k < 6 {
                    code[k] = b;
                    k += 1;
                }
            }
            if k != 6 {
                return; // not a code: nothing opens, nothing is sent
            }
            unsafe { WATCH_CODE = code; }
            open_panel(Mode::Watcher, "Joining...");
        }
        _ => {
            let i = (request_id - REQ_PROMPT_BASE) as usize;
            if mode() == Mode::Owner && i < N_ALL && is_face_button(i) {
                send_press(i, text);
            }
        }
    }
}

fn prompt_slot(node: usize) -> Option<usize> {
    (0..MAX_PROMPTS).find(|&s| unsafe { PROMPT_NODE[s] } == node)
}

// ---------------------------------------------------------------------------
// Opening, closing and moving the panel
// ---------------------------------------------------------------------------

fn open_panel(m: Mode, first_line: &str) {
    unsafe {
        MODE = m;
        WATCH_ENDED = false;
        VERSION = 0;
        LAST_Z = -1;
        POLL_IN_FLIGHT = false;
        NEXT_POLL_AT = NOW_S;
        DELTA = [0.0, PARK_DROP_M, 0.0];
        ADJUST = [0.0; 3];
    }
    turn_for_watcher(m == Mode::Watcher);
    apply_positions();
    for name in OPEN_SHOWS {
        set_visible(idx(name), true);
    }
    set_visible(idx("LockPanel"), true);
    show(idx("TxTicker"), "MISSION CONTROL");
    show(idx("TxLock"), first_line);
    refresh_network(true);
}

fn close_panel() {
    if mode() == Mode::Owner && unsafe { TOKEN_LEN } > 0 {
        // Sign out on the way out (best effort): the bridge also ends idle sign-ins itself.
        send_press(idx("BtnSignOut"), &[]);
    }
    for i in 0..N_ALL {
        if is_fixture(i) {
            continue;
        }
        if i < N_TEXT {
            hide_text(i);
        }
        set_visible(i, false);
    }
    unsafe {
        MODE = Mode::Closed;
        TOKEN_LEN = 0;
        WATCH_CODE = [0; 6];
        PROMPT_NODE = [usize::MAX; MAX_PROMPTS];
        DELTA = [0.0; 3];
        ADJUST = [0.0; 3];
        SHIFT = [0.0; N_ALL];
        TEXT_HASH = [0; N_TEXT];
    }
    set_chips(0);
    turn_for_watcher(false);
    apply_positions();
}

/// Turn every panel node 180 degrees of yaw for a watcher's copy, or back.
fn turn_for_watcher(turn: bool) {
    if unsafe { TURNED } == turn {
        return;
    }
    for i in 0..N_ALL {
        if is_fixture(i) {
            continue;
        }
        let h = unsafe { HANDLES[i] };
        if h == 0 {
            continue;
        }
        if let Some(r) = base_rot_of(i) {
            let yaw = if turn { r[1] + 180.0 } else { r[1] };
            unsafe { host::k_transform_set_rotation(h, r[0], yaw, r[2]); }
        }
    }
    unsafe { TURNED = turn; }
}

/// One of the handle buttons: axis 0 toward/away, 1 up/down, 2 right/left (the viewer's).
fn nudge(axis: usize, by: f32) {
    if mode() == Mode::Closed {
        return;
    }
    let (lo, hi) = match axis {
        0 => (-MOVE_FAR, MOVE_NEAR),
        1 => (-MOVE_UPDOWN, MOVE_UPDOWN),
        _ => (-MOVE_SIDE, MOVE_SIDE),
    };
    unsafe {
        ADJUST[axis] = clamp(ADJUST[axis] + by, lo, hi);
    }
    apply_positions();
}

fn clamp(v: f32, lo: f32, hi: f32) -> f32 {
    if v < lo {
        lo
    } else if v > hi {
        hi
    } else {
        v
    }
}

/// Where an authored (parked) point goes now, `s` metres along the viewer's right:
/// parked when closed; raised in front of the throne for the owner; turned to face the
/// hall and lowered to its floor for a watcher. The viewer's handle adjustments apply to both.
fn place(p: [f32; 3], s: f32) -> [f32; 3] {
    if mode() == Mode::Closed {
        return p;
    }
    let (d, a) = unsafe { (DELTA, ADJUST) };
    let watcher = mode() == Mode::Watcher;
    let (right, toward) = if watcher { (RIGHT_WATCH, TOWARD_WATCH) } else { (RIGHT, TOWARD) };
    let mut q = [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
    if watcher {
        q = [2.0 * WATCH_PIVOT_X - q[0], q[1] - WATCH_LOWER_M, -q[2]];
    }
    for k in 0..3 {
        q[k] += a[0] * toward[k] + a[2] * right[k] + right[k] * s + if k == 1 { a[1] } else { 0.0 };
    }
    q
}

/// One node at its place now, with its own shift along the viewer's right.
fn position_one(i: usize) {
    let h = unsafe { HANDLES[i] };
    if h == 0 || is_fixture(i) {
        return;
    }
    if let Some(p) = base_of(i) {
        let q = place(p, unsafe { SHIFT[i] });
        unsafe { host::k_transform_set_position(h, q[0], q[1], q[2]); }
    }
}

/// Every panel node (and every done-chip copy) where it belongs now.
fn apply_positions() {
    for i in 0..N_ALL {
        position_one(i);
    }
    if let Some(p) = base_of(idx("ChipDone")) {
        for k in 0..MAX_CHIPS {
            let h = unsafe { CHIPS[k] };
            if h > 0 {
                let q = place(p, CHIP_STEP_M * (k as f32 + 1.0));
                unsafe { host::k_transform_set_position(h, q[0], q[1], q[2]); }
            }
        }
    }
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

/// Writes an AB1 request into REQ_BUF; returns its length. A watcher's carries the watch
/// code and never a token, a press or typed text.
fn build_request(press: Option<usize>, text: &[u8]) -> usize {
    let buf = unsafe { &mut *core::ptr::addr_of_mut!(REQ_BUF) };
    let mut w = Writer { buf, n: 0 };
    w.push(b"AB1\n");
    let owner = mode() == Mode::Owner;
    if mode() == Mode::Watcher {
        w.push(b"watch ");
        w.push(unsafe { &*core::ptr::addr_of!(WATCH_CODE) });
        w.push(b"\n");
    } else {
        let tl = unsafe { TOKEN_LEN };
        if tl > 0 {
            w.push(b"tok ");
            let token = unsafe { &*core::ptr::addr_of!(TOKEN) };
            w.push(&token[..tl]);
            w.push(b"\n");
        }
    }
    w.push(b"v ");
    w.push_u32(unsafe { VERSION });
    w.push(b"\n");
    if let (Some(i), true) = (press, owner) {
        w.push(b"press ");
        w.push(node_name(i).as_bytes());
        w.push(b"\n");
    }
    if !text.is_empty() && owner {
        w.push(b"---\n");
        w.push(text);
    }
    w.n
}

fn fetch(path: &str, len: usize, id: i32) -> i32 {
    if mode() == Mode::Closed {
        return -2; // never a call while closed
    }
    let u = url(path);
    let body = core::ptr::addr_of!(REQ_BUF) as *const u8;
    unsafe { host::k_net_fetch(METHOD_POST, u.as_ptr() as i32, u.len() as i32, body as i32, len as i32, 0, id) }
}

fn send_signin(passphrase: &[u8]) {
    unsafe { TOKEN_LEN = 0; }
    let len = build_request(None, passphrase);
    let rc = fetch(PATH_SIGNIN, len, REQ_SIGNIN);
    if rc != 0 {
        local_status(if rc == -6 { "Too fast: try again in a second." } else { "The headset refused the call: network off for this world?" });
    }
}

fn send_poll(path: &str) {
    let len = build_request(None, &[]);
    let rc = fetch(path, len, REQ_VIEW);
    if rc == 0 {
        unsafe {
            POLL_IN_FLIGHT = true;
            NEXT_POLL_AT = NOW_S + VIEW_MIN_GAP_S;
        }
    } else {
        unsafe { NEXT_POLL_AT = NOW_S + RETRY_GAP_S; }
        if rc != -6 {
            local_status("Can't reach the bridge (the headset refused the call).");
        }
    }
}

fn send_press(i: usize, text: &[u8]) {
    if mode() != Mode::Owner {
        return;
    }
    let len = build_request(Some(i), text);
    let id = unsafe {
        let id = NEXT_PRESS_ID;
        NEXT_PRESS_ID = if NEXT_PRESS_ID >= 7999 { REQ_PRESS_FIRST } else { NEXT_PRESS_ID + 1 };
        id
    };
    let rc = fetch(PATH_PRESS, len, id);
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
        unsafe { POLL_IN_FLIGHT = false; }
    }
    if mode() == Mode::Closed {
        return; // a late answer after Close changes nothing
    }
    if status != 200 {
        if request_id == REQ_VIEW {
            unsafe { NEXT_POLL_AT = NOW_S + RETRY_GAP_S; }
        }
        local_status(match status {
            0 => "Can't reach the bridge on the PC. Is it running?",
            -2 => "The headset stopped the call (network off for this world).",
            -5 => "The bridge answered with too much.",
            502 => "The bridge's PC is off or asleep.",
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
    let body = unsafe { core::slice::from_raw_parts(ptr, got as usize) };
    apply_snapshot(body);
}

// ---------------------------------------------------------------------------
// Applying a snapshot (agent-bridge src/wire.ts)
// ---------------------------------------------------------------------------

pub fn apply_snapshot(body: &[u8]) {
    let mut lines = body.split(|&b| b == b'\n');
    if lines.next() != Some(b"AB1".as_slice()) {
        return;
    }
    let watcher = mode() == Mode::Watcher;
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
                if name == b"lock" && !watcher {
                    unsafe { TOKEN_LEN = 0; }
                    set_chips(0);
                }
            }
            b'K' => {
                if !watcher {
                    let n = name.len().min(96);
                    unsafe {
                        TOKEN[..n].copy_from_slice(&name[..n]);
                        TOKEN_LEN = n;
                        LAST_Z = -1;
                    }
                }
            }
            b'E' => {
                if name == b"signed_out" && !watcher {
                    unsafe { TOKEN_LEN = 0; }
                }
                if name == b"watch_refused" && watcher {
                    unsafe { WATCH_ENDED = true; }
                }
            }
            b'T' => {
                if let Some(i) = face_node(name) {
                    let mut t = TextBuf::new();
                    unescape_into(arg, &mut t);
                    show(i, t.as_str());
                }
            }
            b'X' => {
                if let Some(i) = face_node(name) {
                    hide_text(i);
                }
            }
            b'U' => {
                if let Some(i) = face_node(name) {
                    set_visible(i, arg == b"1");
                }
            }
            b'G' => {
                if let Some(i) = face_node(name) {
                    let f = (parse_u32(arg).min(1000) as f32 / 1000.0).max(0.02);
                    // Raw UE relative scale: the bar runs along its own Y, origin at its left end.
                    unsafe { host::k_transform_set_scale(HANDLES[i], 1.0, f, 1.0); }
                }
            }
            b'O' => {
                if let Some(i) = face_node(name) {
                    unsafe { SHIFT[i] = parse_i32(arg) as f32 / 1000.0; }
                    position_one(i);
                }
            }
            b'C' => {
                if name == b"ChipDone" {
                    set_chips(parse_u32(arg) as usize);
                }
            }
            b'P' => {
                if let Some(i) = face_node(name) {
                    set_prompt(i, arg);
                }
            }
            b'Z' => {
                let z = parse_u32(name) as i64;
                let last = unsafe { LAST_Z };
                if last >= 0 && z > last && !watcher {
                    buzz();
                }
                unsafe { LAST_Z = z; }
            }
            _ => {}
        }
    }
}

/// A node the bridge may name: the face's nodes only, never the world's own (seal, handles...).
fn face_node(name: &[u8]) -> Option<usize> {
    node_index(name).filter(|&i| i < N_FACE)
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
    if i >= N_TEXT || mode() == Mode::Closed {
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
    unsafe { TEXT_HASH[i] = 1; }
}

/// The world's own line, shown at once and overwritten by the bridge's next status.
fn local_status(s: &str) {
    if mode() == Mode::Closed {
        return;
    }
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

/// A node's authored rotation (read once).
fn base_rot_of(i: usize) -> Option<[f32; 3]> {
    if unsafe { BASE_ROT_KNOWN[i] } {
        return Some(unsafe { BASE_ROT[i] });
    }
    let h = unsafe { HANDLES[i] };
    if h == 0 {
        return None;
    }
    let mut r = [0.0f32; 3];
    let rc = unsafe {
        host::k_transform_get_rotation(h, &mut r[0] as *mut f32 as i32, &mut r[1] as *mut f32 as i32, &mut r[2] as *mut f32 as i32)
    };
    if rc != 0 {
        return None;
    }
    unsafe {
        BASE_ROT[i] = r;
        BASE_ROT_KNOWN[i] = true;
    }
    Some(r)
}

fn set_chips(count: usize) {
    let src_i = idx("ChipDone");
    let src = unsafe { HANDLES[src_i] };
    let want = if mode() == Mode::Closed { 0 } else { count.saturating_sub(1).min(MAX_CHIPS) };
    for k in 0..MAX_CHIPS {
        let have = unsafe { CHIPS[k] };
        if k < want && have == 0 && src != 0 {
            let name = CHIP_NAMES[k];
            let h = unsafe { host::k_node_clone(src, 0, name.as_ptr() as i32, name.len() as i32) };
            if h > 0 {
                unsafe { CHIPS[k] = h; }
            }
        } else if k >= want && have != 0 {
            unsafe {
                host::k_node_destroy(have);
                CHIPS[k] = 0;
            }
        }
    }
    apply_positions();
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
        local_status(match s {
            0 => "Network is off for this world right now.",
            -2 => "This world did not declare network (a build error).",
            _ => "Network state unknown.",
        });
    } else {
        unsafe { NEXT_POLL_AT = NOW_S; }
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
    if h <= 1 {
        h + 2
    } else {
        h
    }
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
        let mut digits = [0u8; 10];
        let n = {
            let mut w = Writer { buf: &mut digits, n: 0 };
            w.push_u32(v.unsigned_abs());
            w.n
        };
        for &b in &digits[..n] {
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

    fn reset() {
        unsafe {
            MODE = Mode::Closed;
            TOKEN_LEN = 0;
            WATCH_ENDED = false;
            host::FETCHES = 0;
            host::PROMPTS = 0;
            PROMPT_OPEN = 0;
            VISIBLE = [-1; N_ALL];
        }
    }

    fn handle(name: &str) -> i32 {
        unsafe { HANDLES[idx(name)] }
    }

    #[test]
    fn node_names_match_nodes_json() {
        let src = include_str!("../nodes.json");
        let v = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(json_array(src, "text"), v(&NODES_TEXT));
        assert_eq!(json_array(src, "buttons"), v(&NODES_BUTTON));
        assert_eq!(json_array(src, "show"), v(&NODES_SHOW));
        assert_eq!(json_array(src, "world"), v(&NODES_WORLD));
        for n in NODES_TEXT.iter().chain(&NODES_BUTTON).chain(&NODES_SHOW).chain(&NODES_WORLD).chain(&CHIP_NAMES) {
            assert!(!n.ends_with(|c: char| c.is_ascii_digit()), "{n}");
        }
    }

    #[test]
    fn closed_means_no_network_call_ever() {
        reset();
        k_init();
        for _ in 0..200 {
            k_tick(0.05);
        }
        on_press(0, handle("BtnTests"), 0, 0);
        on_net_result(0, 0, REQ_VIEW, 200);
        assert_eq!(unsafe { host::FETCHES }, 0, "closed: zero calls");
        // The Watch button opens a typing sheet, and still nothing is sent...
        on_press(0, handle("McWatchJoin"), 0, 0);
        assert_eq!(unsafe { host::PROMPTS }, 1);
        // ...and an answer that isn't six digits opens nothing.
        unsafe { PROMPT_ANSWER[..3].copy_from_slice(b"abc"); }
        on_prompt_result(0, 0, REQ_PROMPT_WATCH, 3);
        assert_eq!(mode(), Mode::Closed);
        assert_eq!(unsafe { host::FETCHES }, 0);
    }

    #[test]
    fn the_ritual_signs_in_first_and_close_parks_everything() {
        reset();
        k_init();
        on_press(0, handle("McSeal"), 0, 0);
        assert_eq!(unsafe { PROMPT_OPEN }, REQ_PROMPT_SEAL);
        let pass = b"correct horse battery staple";
        unsafe { PROMPT_ANSWER[..pass.len()].copy_from_slice(pass); }
        on_prompt_result(0, 0, REQ_PROMPT_SEAL, pass.len() as i32);
        assert_eq!(mode(), Mode::Owner);
        assert_eq!(unsafe { host::FETCHES }, 1, "the first call is the sign-in");
        assert_eq!(unsafe { DELTA }, [0.0, PARK_DROP_M, 0.0], "the panel is raised");
        apply_snapshot(b"AB1\nV 3\nM wall\nK tok123\nT TxTicker 1 working\nZ 0\n");
        unsafe { assert_eq!(&TOKEN[..TOKEN_LEN], b"tok123"); }
        on_press(0, handle("McMoveCloser"), 0, 0);
        assert!((unsafe { ADJUST[0] } - MOVE_STEP_M).abs() < 1e-6);
        on_press(0, handle("McClose"), 0, 0);
        assert_eq!(mode(), Mode::Closed);
        assert_eq!(unsafe { DELTA }, [0.0; 3], "parked again");
        assert_eq!(unsafe { TOKEN_LEN }, 0, "the token is gone");
    }

    #[test]
    fn a_watcher_sends_the_code_never_a_token_or_a_press_and_never_buzzes() {
        reset();
        k_init();
        on_press(0, handle("McWatchJoin"), 0, 0);
        unsafe { PROMPT_ANSWER[..7].copy_from_slice(b"296 951"); }
        on_prompt_result(0, 0, REQ_PROMPT_WATCH, 7);
        assert_eq!(mode(), Mode::Watcher);
        let n = build_request(Some(idx("BtnApprove")), b"typed");
        let body = unsafe { core::str::from_utf8(&REQ_BUF[..n]).unwrap().to_string() };
        assert_eq!(body, "AB1\nwatch 296951\nv 0\n");
        let before = unsafe { host::FETCHES };
        on_press(0, handle("BtnApprove"), 0, 0);
        assert_eq!(unsafe { host::FETCHES }, before, "a watcher's press is never sent");
        apply_snapshot(b"AB1\nV 4\nM chat\nK nope\nZ 5\n");
        apply_snapshot(b"AB1\nV 5\nM chat\nZ 6\n");
        assert_eq!(unsafe { TOKEN_LEN }, 0, "a watcher never keeps a token");
        assert_eq!(unsafe { SECOND_BUZZ_AT }, -1.0, "no buzz for a watcher");
        assert!(unsafe { TURNED }, "a watcher's copy is turned to face the hall");
        // The bridge refuses the code (off, wrong, the owner left): the watcher stops polling.
        apply_snapshot(b"AB1\nV 6\nE watch_refused\n");
        assert!(unsafe { WATCH_ENDED }, "a refused watch stops polling until Close");
        // The centre panel sits on the turning axis: a point there stays put sideways,
        // drops to the floor, and the viewer's right flips.
        let q = place([WATCH_PIVOT_X, 3.0 - PARK_DROP_M, 0.0], 0.5);
        assert!((q[0] - WATCH_PIVOT_X).abs() < 1e-4 && (q[1] - (3.0 - WATCH_LOWER_M)).abs() < 1e-4 && (q[2] - 0.5).abs() < 1e-4, "{q:?}");
        close_panel();
        assert!(unsafe { !TURNED }, "closing turns it back");
        open_panel(Mode::Watcher, "Joining...");
        assert!(unsafe { !WATCH_ENDED }, "a new watch polls again");
        close_panel();
    }

    #[test]
    fn the_bridge_can_not_touch_the_worlds_own_nodes() {
        reset();
        k_init();
        open_panel(Mode::Owner, "x");
        let seal_before = unsafe { VISIBLE[idx("McSeal")] };
        apply_snapshot(b"AB1\nU McSeal 0\nU McWatchJoin 0\nO McClose 500\nT McClose hi\n");
        assert_eq!(unsafe { VISIBLE[idx("McSeal")] }, seal_before, "the seal is not the bridge's to hide");
        assert_eq!(unsafe { SHIFT[idx("McClose")] }, 0.0);
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
    }
}
