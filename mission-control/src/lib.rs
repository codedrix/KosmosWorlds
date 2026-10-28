//! lobby + Mission Control v2 -- the program of `world://lobby.micknerks` (DB-044 addendum).
//!
//! @kosmos-system  Content (KosmosWorlds) -- the Lobby, with Mission Control inside
//! @kosmos-owner   Content lane
//! @kosmos-level   host API level 4 (`k_net_*`, `OnNetResult`); level 3 for
//!                 `k_haptic_pulse`, `k_log`; level 2 for `k_ui_prompt`
//!
//! Two jobs:
//!
//! 1. **The Lobby's music**, ported exactly from the 1.1.1 program (797 bytes, no source
//!    on disk; read from its disassembly): `lobby_ypsilon_01.ogg` then `_02.ogg`,
//!    alternating, volume 0.4, a failed start retried up to three times a second apart,
//!    stopped at shutdown.
//!
//! 2. **Mission Control v2** (the contract: ../V2_CONTRACT.md). It is closed for every
//!    visitor and **makes no network call at all** until:
//!      - the owner presses the seal on the throne seat (`McSeal`): the Pairing Seal rises
//!        to eye height, the first call mints a pairing, the ring shows a short code, and
//!        the owner approves it AT THE PC. Nothing secret is typed in the headset. A small
//!        "Or type passphrase here" button (`BtnSealType`) keeps the typed passphrase as the
//!        headset way.
//!      - or a visitor presses the Watch post (`McWatchJoin`) and types a watch code the
//!        owner shared: a read-only copy of the owner's arc, turned to face the hall.
//!    Signed in, the owner sees a ledge of glass job cubes and the decision puck on the
//!    throne's left armrest. Pressing a cube unfolds a three-panel arc (jobs | that job's
//!    conversation | the browser spot); Fold folds it back into the cube.
//!    Everything is authored 200 m below the floor (`PARK_DROP_M`) and raised on open;
//!    Close (or leaving the Lobby) parks it again.
//!
//! The bridge decides every word and every colour (AB1 snapshots, agent-bridge
//! `src/wire.ts`); this program decides WHERE things are and WHEN its groups show:
//!
//!   - **Two-layer visibility.** A node shows when the snapshot wants it (`U`, `T` and `H`
//!     stored per node) AND its group (seal, ledge, puck, arc) is on for the current stage
//!     and mode. A tween keeps its group on for its duration.
//!   - **One text function** (`show`) and **one colour function** (`paint`). DB-045 (the
//!     visual pack) replaces the bodies of those two functions and nothing else.
//!   - **Animations** run every frame in `k_tick`, touching only the moving group's nodes.
//!
//! A new approval buzzes both controllers twice and chimes, for the signed-in owner only.
//! The bridge may only name the face's nodes (and colour the `hue` bases); the world's own
//! nodes (seal, Watch post, handles, frames, ledge, puck body) are never its to move.
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

    /// A node's authored position (read once per node).
    pub fn position_of(h: i32) -> Option<[f32; 3]> {
        let mut p = [0.0f32; 3];
        let rc = unsafe {
            k_transform_get_position(h, &mut p[0] as *mut f32 as i32, &mut p[1] as *mut f32 as i32, &mut p[2] as *mut f32 as i32)
        };
        if rc == 0 { Some(p) } else { None }
    }

    /// A node's authored rotation (pitch, yaw, roll; raw UE degrees).
    pub fn rotation_of(h: i32) -> Option<[f32; 3]> {
        let mut r = [0.0f32; 3];
        let rc = unsafe {
            k_transform_get_rotation(h, &mut r[0] as *mut f32 as i32, &mut r[1] as *mut f32 as i32, &mut r[2] as *mut f32 as i32)
        };
        if rc == 0 { Some(r) } else { None }
    }
}

/// Host-side stand-ins so `cargo test` links and the tests can see what the program did.
/// Every call is counted (`CALLS`), so a test can bound the host calls per tick. Handles are
/// handed out in `k_node_find` order (the program finds its nodes in index order), so node
/// `i` is handle `i + 1` after `reset_host()`.
#[cfg(not(target_arch = "wasm32"))]
#[allow(clippy::too_many_arguments, static_mut_refs)]
mod host {
    pub const MAX_H: usize = 256;
    pub static mut CALLS: u32 = 0;
    pub static mut FETCHES: i32 = 0;
    /// Fetches the host should refuse next (-6, "too fast"), and every attempt, refused or not.
    pub static mut REFUSE: i32 = 0;
    pub static mut ATTEMPTS: i32 = 0;
    pub static mut LAST_FETCH_ID: i32 = 0;
    /// Fetches the host took, by request id, for the small ids (view 1 .. desk 4).
    pub static mut BY_ID: [i32; 8] = [0; 8];
    pub static mut PROMPTS: i32 = 0;
    pub static mut AUDIO_PLAYS: i32 = 0;
    pub static mut CHIMES: i32 = 0;
    pub static mut HAPTICS: i32 = 0;
    pub static mut NEXT_FIND: i32 = 0;
    pub static mut POS: [[f32; 3]; MAX_H] = [[0.0; 3]; MAX_H];
    pub static mut SCALE: [f32; MAX_H] = [1.0; MAX_H];
    pub static mut YAW: [f32; MAX_H] = [0.0; MAX_H];
    pub static mut ROLL: [f32; MAX_H] = [0.0; MAX_H];
    pub static mut VIS: [i8; MAX_H] = [-1; MAX_H];
    pub static mut TEXT_ON: [bool; MAX_H] = [false; MAX_H];
    /// The host refuses every new label (its 32-label pool full) while this is set.
    pub static mut TEXT_FULL: bool = false;
    pub static mut TEXT_SHOWS: i32 = 0;

    pub fn reset_host() {
        unsafe {
            CALLS = 0;
            FETCHES = 0;
            REFUSE = 0;
            ATTEMPTS = 0;
            LAST_FETCH_ID = 0;
            BY_ID = [0; 8];
            PROMPTS = 0;
            CHIMES = 0;
            HAPTICS = 0;
            NEXT_FIND = 0;
            POS = [[0.0; 3]; MAX_H];
            SCALE = [1.0; MAX_H];
            YAW = [0.0; MAX_H];
            ROLL = [0.0; MAX_H];
            VIS = [-1; MAX_H];
            TEXT_ON = [false; MAX_H];
            TEXT_FULL = false;
            TEXT_SHOWS = 0;
        }
    }
    fn c() {
        unsafe { CALLS += 1 }
    }
    fn hi(n: i32) -> usize {
        (n.max(0) as usize).min(MAX_H - 1)
    }
    /// Authored (parked) positions: a distinct spot per handle, 200 m down.
    pub fn position_of(h: i32) -> Option<[f32; 3]> {
        c();
        Some([12.0 + h as f32 * 0.01, 3.0 - 200.0, h as f32 * -0.01])
    }
    pub fn rotation_of(_h: i32) -> Option<[f32; 3]> {
        c();
        Some([0.0, 180.0, 0.0])
    }
    pub unsafe fn k_node_find(_p: i32, _l: i32) -> i32 { c(); NEXT_FIND += 1; NEXT_FIND }
    pub unsafe fn k_node_set_visible(n: i32, v: i32) -> i32 { c(); VIS[hi(n)] = v as i8; 0 }
    pub unsafe fn k_transform_set_position(n: i32, x: f32, y: f32, z: f32) -> i32 { c(); POS[hi(n)] = [x, y, z]; 0 }
    pub unsafe fn k_transform_set_scale(n: i32, x: f32, _y: f32, _z: f32) -> i32 { c(); SCALE[hi(n)] = x; 0 }
    pub unsafe fn k_transform_set_rotation(n: i32, _p: f32, y: f32, r: f32) -> i32 { c(); YAW[hi(n)] = y; ROLL[hi(n)] = r; 0 }
    pub unsafe fn k_ui_show_world_text(n: i32, _p: i32, _l: i32, _o: f32) -> i32 {
        c();
        TEXT_SHOWS += 1;
        if TEXT_FULL {
            return -1;
        }
        TEXT_ON[hi(n)] = true;
        0
    }
    pub unsafe fn k_ui_hide_world_text(n: i32) -> i32 { c(); TEXT_ON[hi(n)] = false; 0 }
    pub unsafe fn k_ui_prompt(_p: i32, _l: i32, _o: i32, _c: i32, _r: i32) -> i32 { c(); PROMPTS += 1; 0 }
    pub unsafe fn k_event_subscribe(_p: i32, _l: i32, _n: i32, _c: i32) -> i32 { c(); 1 }
    pub unsafe fn k_event_subscribe_global(_p: i32, _l: i32, _c: i32) -> i32 { c(); 1 }
    pub unsafe fn k_haptic_pulse(_h: i32, _i: f32, _d: i32) -> i32 { c(); HAPTICS += 1; 0 }
    pub unsafe fn k_audio_play(_n: i32, _p: i32, _l: i32) -> i32 { c(); CHIMES += 1; 0 }
    pub unsafe fn k_audio_play_ex(_n: i32, _p: i32, _l: i32, _v: f32, _pi: f32, _lo: i32) -> i32 { c(); AUDIO_PLAYS += 1; 0 }
    pub unsafe fn k_audio_stop(_s: i32) -> i32 { c(); 0 }
    pub unsafe fn k_log(_lv: i32, _p: i32, _l: i32) -> i32 { c(); 0 }
    pub unsafe fn k_net_fetch(_m: i32, _u: i32, _ul: i32, _b: i32, _bl: i32, _f: i32, r: i32) -> i32 {
        c();
        ATTEMPTS += 1;
        if REFUSE > 0 {
            REFUSE -= 1;
            return -6;
        }
        FETCHES += 1;
        LAST_FETCH_ID = r;
        if (0..8).contains(&r) {
            BY_ID[r as usize] += 1;
        }
        0
    }
    pub unsafe fn k_net_read(_r: i32, _o: i32, _c: i32) -> i32 { c(); -7 }
    pub unsafe fn k_net_status() -> i32 { c(); 1 }
}

// ---------------------------------------------------------------------------
// The music (exact port of the Lobby 1.1.1 program)
// ---------------------------------------------------------------------------

mod music {
    use super::host;

    const TRACKS: [&str; 2] = ["lobby_ypsilon_01.ogg", "lobby_ypsilon_02.ogg"];
    /// Track lengths in seconds (the 1.1.1 program's data section: 239.35 and 123.113492).
    const LENGTH_S: [f64; 2] = [239.35, 123.113492];
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
const PATH_PAIR: &str = "/v1/faces/mission-control/pair";

const METHOD_POST: i32 = 1;
const HOST_TEXT_MAX_BYTES: usize = 128;
const READ_BUF_BYTES: usize = 16 * 1024;
/// A poll (view, watch or pair) is never sent sooner than this after the last one (the host
/// refills one call a second).
const VIEW_MIN_GAP_S: f32 = 1.1;
/// After a failure (no answer, refused, rate limited), wait this long before the next poll.
const RETRY_GAP_S: f32 = 3.0;
const STATUS_POLL_S: f32 = 1.0;
/// The panel is authored this far below the Lobby floor (blender/build_panel.py PARK_DROP).
const PARK_DROP_M: f32 = 200.0;
/// The owner's right, as the owner on the throne sees it: wasm -z (the throne faces -x).
const RIGHT: [f32; 3] = [0.0, 0.0, -1.0];
/// Toward the owner: wasm +x (everything stands in front of the throne, at smaller x).
const TOWARD: [f32; 3] = [1.0, 0.0, 0.0];
/// A watcher stands in the hall, not on the throne, so a watcher's copy of the ARC is turned
/// 180 degrees about the centre panel's vertical axis and lowered to the hall floor.
/// v2 arc: the centre panel's surface is 1.70 m in front of the owner's eye, and the owner
/// stands at the seat's centre (STAND x 14.8), so the axis is x = 14.8 - 1.70 = 13.1 (z 0).
/// The lowering is the seat top (1.46) minus the hall floor (0.03): the watcher's eye then
/// meets the arc at the height the owner's does. Its right and "toward" flip too.
const WATCH_PIVOT_X: f32 = 13.1;
const WATCH_LOWER_M: f32 = 1.43;
const RIGHT_WATCH: [f32; 3] = [0.0, 0.0, 1.0];
const TOWARD_WATCH: [f32; 3] = [-1.0, 0.0, 0.0];
const MOVE_STEP_M: f32 = 0.15;
/// Limits of the viewer's adjustments to the arc: nearer, farther, up/down, sideways (metres).
/// The ask plate is 1.62 m out and the ledge's shelf ends 1.0 m out (contract 8.4: 0.90 m out,
/// 0.20 deep), so the arc comes 0.5 m nearer at most: the plate stops 12 cm behind the shelf.
const MOVE_NEAR: f32 = 0.5;
const MOVE_FAR: f32 = 1.0;
const MOVE_UPDOWN: f32 = 0.6;
const MOVE_SIDE: f32 = 1.2;
const CHIME: &str = "chime.wav";
/// The Closing stage retries the sign-out for at most this long, then drops the token.
const CLOSING_MAX_S: f32 = 5.0;
/// A cube press's pending unfold origin lasts this long without its own reply.
const PICK_TIMEOUT_S: f32 = 4.0;
/// The Pairing Seal's HUD rings turn slowly and steadily (contract 9.5): one turn a minute,
/// never an oscillation. One host call a frame, only while the ring shows and is not moving.
const SEAL_SPIN_DEG_S: f32 = 6.0;

/// Animation lengths (contract section 6), seconds.
const SEAL_RISE_S: f32 = 0.6;
const LOCK_HOLD_S: f32 = 0.6;
const SEAL_SHRINK_S: f32 = 0.35;
const GROW_S: f32 = 0.4;
const UNFOLD_S: f32 = 0.5;
const FOLD_S: f32 = 0.4;
/// The smallest scale a tween starts or ends at.
const SCALE_MIN: f32 = 0.02;

/// The typing sheets' questions (clarity pass, CLARITY_PASS.md A and B). SEAL_QUESTION equals the
/// bridge face's PASSPHRASE_QUESTION byte for byte (a host test pins both strings).
const SEAL_QUESTION: &str = "Mission Control passphrase (shows as you type)";
const WATCH_QUESTION: &str =
    "Group watch code (6 digits). The person on the throne gets it by pressing Share with group.";
/// The owner's press on the Watch post (clarity pass A): two lines, each within the status line
/// (W.status 1.2 m) at 8 cm.
const WATCH_POST_OWNER: &str = "This post is for a second headset.\nLet someone watch: press Share with group.";

pub const NODES_TEXT: [&str; 31] = [
    "TxTicker", "TxStatus", "TxProject", "TxRailA", "TxRailB", "TxRailC", "TxRailD", "TxDone", "TxHeader", "TxConvA", "TxConvB",
    "TxConvC", "TxConvD", "TxConvE", "TxConvF", "TxConvG", "TxConvH", "TxConvI", "TxConvJ", "TxPage", "TxAskA", "TxAskB",
    "TxWatch", "TxPageSpot", "TxCubeA", "TxCubeB", "TxCubeC", "TxCubeD", "TxPuck", "TxSeal", "TxSealHint",
];
pub const NODES_BUTTON: [&str; 31] = [
    "RailA", "RailB", "RailC", "RailD", "BtnTests", "BtnPrs", "BtnToday", "BtnNotes", "BtnNewTask", "BtnProject", "BtnFold",
    "BtnStop", "BtnApprove", "BtnDeny", "BtnWhy", "BtnKeep", "BtnSimple", "BtnSummary", "BtnReply", "BtnPageUp",
    "BtnPageDown", "BtnWatch", "BtnSignOut", "CubeA", "CubeB", "CubeC", "CubeD", "CubePlus", "BtnPuckApprove",
    "BtnPuckDeny", "BtnSealType",
];
pub const NODES_SHOW: [&str; 5] = ["AskPanel", "RailSelA", "RailSelB", "RailSelC", "RailSelD"];
pub const NODES_WORLD: [&str; 34] = [
    "McSeal", "McWatchJoin", "McClose", "McMoveCloser", "McMoveFarther", "McMoveLeft", "McMoveRight", "McMoveUp", "McMoveDown",
    "McCenterFrame", "McLeftFrame", "McRightFrame", "McPageDock", "McLedge", "Puck", "SealRing", "McSealCancel", "CubeACalm",
    "CubeANeed", "CubeAIdle", "CubeBCalm", "CubeBNeed", "CubeBIdle", "CubeCCalm", "CubeCNeed", "CubeCIdle", "CubeDCalm",
    "CubeDNeed", "CubeDIdle", "PuckCalm", "PuckNeed", "SealRingArmed", "SealRingLocked", "McFloorRing",
];
/// The `hue` bases and their states (nodes.json `hue`). Each state is a pre-built variant
/// node `<base><State>` in NODES_WORLD.
pub const HUE_BASES: [&str; 6] = ["CubeA", "CubeB", "CubeC", "CubeD", "Puck", "SealRing"];
pub const HUE_STATES: [&[&str]; 6] = [
    &["calm", "need", "idle"],
    &["calm", "need", "idle"],
    &["calm", "need", "idle"],
    &["calm", "need", "idle"],
    &["calm", "need"],
    &["armed", "locked"],
];
const N_HUE: usize = HUE_BASES.len();
const MAX_STATES: usize = 3;
/// "No colour": every variant hidden.
const OFF: u8 = u8::MAX;
const NONE: usize = usize::MAX;

const N_TEXT: usize = NODES_TEXT.len();
const N_BUTTON: usize = NODES_BUTTON.len();
const N_SHOW: usize = NODES_SHOW.len();
const N_FACE: usize = N_TEXT + N_BUTTON + N_SHOW;
const N_ALL: usize = N_FACE + NODES_WORLD.len();
/// `McFloorRing`'s node index: the last world-only node in nodes.json (a host test pins it).
/// The projected floor ring and grid (contract 9.6 and 9.10) is in the arc group, so it shows,
/// unfolds and folds with the arc, but it is pinned to the hall floor: `place` never applies the
/// handles to it (correctness review 4, MEDIUM-1), and `held_back` hides it for a watcher and
/// where the ask plate would stack over it (MEDIUM-2).
const FLOOR_I: usize = N_FACE + NODES_WORLD.len() - 1;

/// The groups the world shows and moves together (contract section 3).
const G_FIXTURE: u8 = 0;
const G_SEAL: u8 = 1;
const G_LEDGE: u8 = 2;
const G_PUCK: u8 = 3;
const G_ARC: u8 = 4;
const N_GROUPS: usize = 5;

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

/// A node's group, by its name alone (the bridge needn't know):
///   seal:  SealRing*, TxSeal, TxSealHint, BtnSealType, McSealCancel
///   ledge: McLedge, Cube*, TxCube*, McClose (Close sits on the ledge's left end, contract 8.7,
///          so leaving is one press away whether the arc is folded or open)
///   puck:  Puck*, BtnPuck*, TxPuck
///   arc:   every other panel node (the panels, the chrome bar, McPageDock)
/// The fixtures McSeal and McWatchJoin are visible to every visitor and never move.
fn group_by_name(n: &str) -> u8 {
    if n == "McSeal" || n == "McWatchJoin" {
        G_FIXTURE
    } else if n.starts_with("SealRing") || n.starts_with("TxSeal") || n == "BtnSealType" || n == "McSealCancel" {
        G_SEAL
    } else if n == "McLedge" || n == "McClose" || n.starts_with("Cube") || n.starts_with("TxCube") {
        G_LEDGE
    } else if n.starts_with("Puck") || n.starts_with("BtnPuck") || n == "TxPuck" {
        G_PUCK
    } else {
        G_ARC
    }
}

/// Nodes a press is sent to the bridge for: the face's buttons. (BtnSealType is a face
/// button the world handles itself: it opens the typing sheet for the fallback sign-in.)
fn is_face_button(i: usize) -> bool {
    (N_TEXT..N_TEXT + N_BUTTON).contains(&i)
}

/// World nodes that are pressed: the fixtures, Close, the move handles and Cancel.
fn is_world_control(i: usize) -> bool {
    let n = node_name(i);
    i >= N_FACE && (n == "McSeal" || n == "McWatchJoin" || n == "McClose" || n == "McSealCancel" || n.starts_with("McMove"))
}

// ---------------------------------------------------------------------------
// State (single-threaded world wasm; `static mut` by value only)
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Debug)]
enum Mode {
    Closed,
    Owner,
    Watcher,
    /// Parked and hidden, holding the token only to send the sign-out (close_panel).
    Closing,
}

/// The owner's stages: the seal up (pairing or typing), then the lock animation (the ring
/// holds `locked`, shrinks away, the ledge and puck grow in), then signed in.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Stage {
    Seal,
    Hold,
    Shrink,
    Grow,
    Signed,
}

/// One group's animation: every node of the group moves from `from` (a placed point) to its
/// own place and scales from SCALE_MIN to 1 as `k` runs 0 -> 1 (`dir` +1), or back (-1).
#[derive(Clone, Copy)]
struct Tween {
    active: bool,
    k: f32,
    dir: f32,
    dur: f32,
    from: [f32; 3],
}

const NO_TWEEN: Tween = Tween { active: false, k: 1.0, dir: 1.0, dur: 1.0, from: [0.0; 3] };

const REQ_VIEW: i32 = 1;
const REQ_SIGNIN: i32 = 2;
const REQ_PAIR_MINT: i32 = 3;
const REQ_PRESS_FIRST: i32 = 100;
const REQ_PROMPT_SEAL: i32 = 8001;
const REQ_PROMPT_WATCH: i32 = 8002;
const REQ_PROMPT_BASE: i32 = 9000;
const MAX_PROMPTS: usize = 4;

static mut MODE: Mode = Mode::Closed;
static mut STAGE: Stage = Stage::Seal;
static mut HANDLES: [i32; N_ALL] = [0; N_ALL];
static mut GROUP: [u8; N_ALL] = [G_ARC; N_ALL];
/// For a variant node: its hue base's slot; else OFF.
static mut VARIANT_OF: [u8; N_ALL] = [OFF; N_ALL];
/// Each hue base's node index and its variants' node indices (NONE past its states).
static mut HUE_BASE_IDX: [usize; N_HUE] = [NONE; N_HUE];
static mut HUE_VARIANT: [[usize; MAX_STATES]; N_HUE] = [[NONE; MAX_STATES]; N_HUE];
/// Each hue base's state: an index into HUE_STATES, or OFF.
static mut HUE_STATE: [u8; N_HUE] = [OFF; N_HUE];

/// Layer one: what the snapshot wants. U for buttons and show nodes; a stored text for text
/// nodes. The world's own nodes are wanted whenever their group is on.
static mut WANT: [bool; N_ALL] = [false; N_ALL];
static mut TEXT_STORE: [[u8; HOST_TEXT_MAX_BYTES]; N_TEXT] = [[0; HOST_TEXT_MAX_BYTES]; N_TEXT];
static mut TEXT_LEN: [u8; N_TEXT] = [0; N_TEXT];
/// FNV-1a of each label's text as last shown; 0 = not shown / unknown, 1 = known hidden.
static mut TEXT_HASH: [u32; N_TEXT] = [0; N_TEXT];
/// -1 unknown, 0 hidden, 1 shown.
static mut VISIBLE: [i8; N_ALL] = [-1; N_ALL];
/// True when a node's scale is not 1 (a tween left it small).
static mut SCALED: [bool; N_ALL] = [false; N_ALL];
static mut BASE_POS: [[f32; 3]; N_ALL] = [[0.0; 3]; N_ALL];
static mut BASE_KNOWN: [bool; N_ALL] = [false; N_ALL];
/// Each node's sideways shift along the viewer's right (`O` records), metres.
static mut SHIFT: [f32; N_ALL] = [0.0; N_ALL];
/// The panel's offset from where it is authored: zero when parked.
static mut DELTA: [f32; 3] = [0.0; 3];
/// The viewer's own adjustments to the arc (toward, up, right), metres.
static mut ADJUST: [f32; 3] = [0.0; 3];
static mut BASE_ROT: [[f32; 3]; N_ALL] = [[0.0; 3]; N_ALL];
static mut BASE_ROT_KNOWN: [bool; N_ALL] = [false; N_ALL];
/// True while the arc is turned for a watcher.
static mut TURNED: bool = false;

static mut TWEENS: [Tween; N_GROUPS] = [NO_TWEEN; N_GROUPS];
static mut HOLD_UNTIL: f32 = 0.0;
/// The seal ring's turn so far (degrees, about its own facing axis: UE roll).
static mut SEAL_SPIN: f32 = 0.0;
static mut CLOSING_UNTIL: f32 = 0.0;
/// The arc as the snapshot wants it (`M arc`), and as the world shows it.
static mut M_ARC: bool = false;
static mut ARC_SHOWN: bool = false;
/// The cube the arc unfolded from (hidden while the arc is open), and the point it folds to.
static mut PICKED: usize = NONE;
static mut FOLD_TO: [f32; 3] = [0.0; 3];
/// A cube or rail press waiting for its own reply (request id and node). Only a reply that
/// takes the press (no `E stale`, `refused`, `signed_out` or `busy`) commits it: a refused or
/// lost press changes nothing (correctness review 2, LOW-2).
static mut PENDING_PRESS_ID: i32 = 0;
static mut PENDING_PRESS_NODE: usize = NONE;
/// The reply being applied (its request id), 0 for a poll.
static mut REPLY_ID: i32 = 0;
/// A taken cube press: the unfold's origin, or (arc open) the new picked cube.
static mut COMMIT_CUBE: usize = NONE;
/// A taken rail press: the arc moved to a job whose cube the face doesn't name.
static mut RAIL_SWITCH: bool = false;
/// A folded cube press's PENDING unfold origin (correctness review 3, HIGH-2): the bridge's
/// press handler wakes the view poll with the same `M arc`, so either reply may land first.
/// Whichever opens the arc unfolds from this cube; the press's own refusal (or no answer, a
/// timeout, Close) clears it, and a refusal that lands after the unfold un-picks the cube.
static mut PENDING_PICK: usize = NONE;
static mut PENDING_PICK_ID: i32 = 0;
static mut PENDING_PICK_AT: f32 = -100.0;
/// True once the pending pick has been used as an unfold origin.
static mut PICK_USED: bool = false;

static mut TOKEN: [u8; 96] = [0; 96];
static mut TOKEN_LEN: usize = 0;
/// The pending pairing's id (32 lowercase hex), echoed as `pair <id>` while waiting.
static mut PAIR_ID: [u8; 32] = [0; 32];
static mut PAIR_LEN: usize = 0;
static mut MINT_IN_FLIGHT: bool = false;
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
/// The last path a call went to (for the host tests and the log).
static mut LAST_PATH: &str = "";

static mut PROMPT_NODE: [usize; MAX_PROMPTS] = [NONE; MAX_PROMPTS];
static mut PROMPT_Q: [[u8; 220]; MAX_PROMPTS] = [[0; 220]; MAX_PROMPTS];
static mut PROMPT_Q_LEN: [usize; MAX_PROMPTS] = [0; MAX_PROMPTS];
/// The request id of the typing sheet that is open (0 = none). The host writes the answer LATER.
static mut PROMPT_OPEN: i32 = 0;
static mut PROMPT_ANSWER: [u8; 256] = [0; 256];

static mut READ_BUF: [u8; READ_BUF_BYTES] = [0; READ_BUF_BYTES];
static mut REQ_BUF: [u8; 1024] = [0; 1024];
static mut URL_BUF: [u8; 256] = [0; 256];

// ---------------------------------------------------------------------------
// The Kosmos Desk board (read-only; agent-bridge src/faces/desk)
// ---------------------------------------------------------------------------
//
// A separate panel to the owner's LEFT, 2.5 m out at 72 degrees, facing the eye: the cards
// waiting on the CEO in his Kosmos Desk, from the bridge's `desk` face. Its nodes are a table of
// their own (nodes.json `desk_text`, `desk_world`), so Mission Control's node indices, groups
// and contract are unchanged. It shows ONLY while the owner is signed in, after the seal's
// animation, with the arc folded and still (cubes mode); never during the seal, never for a
// watcher, never while the arc is open or moving. That keeps the world-text pool within its 32:
// cubes mode shows 5 of Mission Control's labels plus the board's 9; the arc shows up to 29 and
// the board none, and every board label is hidden in the same call that starts the unfold.
//
// The board asks `desk/board` every DESK_POLL_S with the token the sign-in already holds (no
// second session, no press, no typed text), and a reply may only set the board's own labels
// (`T`, `X`, `O`): any other record, and any other node, is ignored. No answer, or any status
// but 200, draws "Desk offline".

pub const DESK_TEXT: [&str; 9] = ["TxDeskHead", "TxDeskA", "TxDeskB", "TxDeskC", "TxDeskD", "TxDeskE", "TxDeskF", "TxDeskG", "TxDeskH"];
pub const DESK_WORLD: [&str; 1] = ["McDeskBoard"];
const N_DESK_TEXT: usize = DESK_TEXT.len();
const N_DESK: usize = N_DESK_TEXT + DESK_WORLD.len();
const PATH_DESK: &str = "/v1/faces/desk/board";
const REQ_DESK: i32 = 4;
/// The hub rewrites the Desk's file at least every 15 minutes; half a minute is fresh enough.
const DESK_POLL_S: f32 = 30.0;
const DESK_ASKING: &str = "KOSMOS DESK\nAsking the PC...";
const DESK_OFFLINE: &str = "KOSMOS DESK\nDesk offline";
/// The board's right as the owner sees it (world axes, like RIGHT): it faces the eye from 72
/// degrees to the left, so its right is the hall's right turned 72 degrees (make_desk_glb.mjs
/// builds the board at the same yaw; a host test pins the pair).
const DESK_RIGHT: [f32; 3] = [-0.951_056_5, 0.0, -0.309_017];
/// An `O` shift on the board, clamped to its half-width.
const DESK_SHIFT_MAX_M: f32 = 0.8;

static mut DESK_H: [i32; N_DESK] = [0; N_DESK];
static mut DESK_BASE: [[f32; 3]; N_DESK] = [[0.0; 3]; N_DESK];
static mut DESK_BASE_KNOWN: [bool; N_DESK] = [false; N_DESK];
/// Where each node was last put (None = never moved: still where it was authored, parked).
static mut DESK_AT: [Option<[f32; 3]>; N_DESK] = [None; N_DESK];
/// The board mesh: -1 unknown, 0 hidden, 1 shown.
static mut DESK_VIS: [i8; N_DESK] = [-1; N_DESK];
static mut DESK_STORE: [[u8; HOST_TEXT_MAX_BYTES]; N_DESK_TEXT] = [[0; HOST_TEXT_MAX_BYTES]; N_DESK_TEXT];
static mut DESK_LEN: [u8; N_DESK_TEXT] = [0; N_DESK_TEXT];
/// As TEXT_HASH: 0 unknown, 1 known hidden, else the FNV of the words shown.
static mut DESK_HASH: [u32; N_DESK_TEXT] = [0; N_DESK_TEXT];
static mut DESK_SHIFT: [f32; N_DESK_TEXT] = [0.0; N_DESK_TEXT];
static mut DESK_IN_FLIGHT: bool = false;
static mut DESK_NEXT_AT: f32 = 0.0;
/// After the host refuses a label (its pool full), the board waits this long before asking again,
/// instead of asking every frame.
const DESK_TEXT_RETRY_S: f32 = 1.0;
static mut DESK_TEXT_RETRY_AT: f32 = 0.0;

fn mode() -> Mode {
    unsafe { MODE }
}

fn stage() -> Stage {
    unsafe { STAGE }
}

fn signed_in() -> bool {
    mode() == Mode::Owner && unsafe { TOKEN_LEN } > 0
}

fn origin() -> &'static str {
    ORIGIN.trim()
}

fn group(i: usize) -> u8 {
    unsafe { GROUP[i] }
}

fn is_fixture(i: usize) -> bool {
    group(i) == G_FIXTURE
}

fn is_variant(i: usize) -> bool {
    (unsafe { VARIANT_OF[i] }) != OFF
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
        unsafe {
            HANDLES[i] = h;
            GROUP[i] = group_by_name(name);
            VARIANT_OF[i] = OFF;
            // The world's own nodes are wanted whenever their group is on; the face's wait for U/T.
            WANT[i] = i >= N_FACE;
            BASE_KNOWN[i] = false;
            BASE_ROT_KNOWN[i] = false;
            SCALED[i] = false;
        }
        if h != 0 {
            found += 1;
        }
    }
    init_hues();
    desk_init();
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

    // Every panel node: remember where it is authored (parked), and hide it. The seal's
    // fixture is read too: the ring rises from it.
    for i in 0..N_ALL {
        base_of(i);
        if !is_fixture(i) {
            base_rot_of(i);
            set_visible(i, false);
        }
    }
    let mut t = TextBuf::new();
    t.push("mission control v2: ");
    t.push_i32(found);
    t.push("/");
    t.push_i32(N_ALL as i32);
    t.push(" parts, closed");
    log(2, t.as_str());
}

fn init_hues() {
    let mut name = [0u8; 40];
    for k in 0..N_HUE {
        let base = HUE_BASES[k];
        unsafe {
            HUE_BASE_IDX[k] = node_index(base.as_bytes()).unwrap_or(NONE);
            HUE_STATE[k] = OFF;
        }
        for (j, st) in HUE_STATES[k].iter().enumerate() {
            // `<base><State>`: the state with its first letter upper-cased.
            let mut n = 0;
            for &b in base.as_bytes() {
                name[n] = b;
                n += 1;
            }
            for (q, &b) in st.as_bytes().iter().enumerate() {
                name[n] = if q == 0 { b.to_ascii_uppercase() } else { b };
                n += 1;
            }
            let v = node_index(&name[..n]).unwrap_or(NONE);
            unsafe {
                HUE_VARIANT[k][j] = v;
                if v != NONE {
                    VARIANT_OF[v] = k as u8;
                }
            }
        }
    }
}

#[no_mangle]
pub extern "C" fn k_tick(delta: f32) {
    music::tick(delta);
    let d = if delta.is_finite() && delta > 0.0 && delta < 1.0 { delta } else { 0.0 };
    unsafe { NOW_S += d; }
    if mode() == Mode::Closed {
        return; // closed: no polling, no network status, nothing
    }
    if mode() == Mode::Closing {
        // Only the sign-out, retried until the host takes it or time runs out.
        if unsafe { NOW_S >= CLOSING_UNTIL } {
            finish_close();
        } else {
            try_sign_out();
        }
        return;
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
    if mode() == Mode::Owner && stage() == Stage::Hold && unsafe { NOW_S >= HOLD_UNTIL } {
        // The ring has shown `locked`: it shrinks away into itself.
        unsafe { STAGE = Stage::Shrink; }
        let from = placed(idx("SealRing"));
        start_tween(G_SEAL, -1.0, SEAL_SHRINK_S, from);
        sync_all(); // the code and the hint hide at once
    }
    tick_tweens(d);
    spin_seal(d);
    let ready = unsafe { !POLL_IN_FLIGHT && NOW_S >= NEXT_POLL_AT && LAST_NET == 1 };
    if ready {
        match mode() {
            Mode::Owner if unsafe { TOKEN_LEN } > 0 => send_poll(PATH_VIEW),
            Mode::Owner if unsafe { PAIR_LEN } > 0 => send_poll(PATH_PAIR),
            Mode::Watcher if unsafe { !WATCH_ENDED } => send_poll(PATH_WATCH),
            _ => {}
        }
    }
    if desk_on() && unsafe { !DESK_IN_FLIGHT && NOW_S >= DESK_NEXT_AT && LAST_NET == 1 } {
        send_desk();
    }
    desk_sync();
}

#[no_mangle]
pub extern "C" fn k_shutdown() {
    music::shutdown();
}

// ---------------------------------------------------------------------------
// Presses and typing
// ---------------------------------------------------------------------------

/// OnInteract: the seal, the Watch post, the world's own controls, or a face button.
#[no_mangle]
pub extern "C" fn on_press(_event_type: i32, node: i32, _p1: i32, _p2: i32) {
    if node == 0 {
        return;
    }
    let Some(i) = (0..N_ALL).find(|&i| unsafe { HANDLES[i] } == node) else {
        return;
    };
    if mode() == Mode::Closing {
        return; // parked, signing out: nothing to press for these few seconds
    }
    // A face button whose group is still moving is not pressed (contract 8.10): its words are
    // held back until the tween ends, so the owner never approves what is not yet readable.
    if is_face_button(i) && unsafe { TWEENS[group(i) as usize].active } {
        return;
    }
    match node_name(i) {
        "McSeal" => match mode() {
            // Closed: the seal rises and the FIRST network call mints a pairing.
            Mode::Closed => {
                open_panel(Mode::Owner);
                to_seal_stage();
                mint_pairing();
            }
            // Up, not signed in, nothing pending (expired, refused, or no answer): mint again.
            Mode::Owner if unsafe { TOKEN_LEN == 0 && PAIR_LEN == 0 && !MINT_IN_FLIGHT } => mint_pairing(),
            // Signed in: the seal toggles. It closes (signs out, parks everything; contract 8.7).
            Mode::Owner if signed_in() => close_panel(),
            _ => {}
        },
        "McWatchJoin" => match mode() {
            Mode::Closed => open_sheet(WATCH_QUESTION, REQ_PROMPT_WATCH),
            Mode::Watcher => close_panel(),
            Mode::Owner => local_status(WATCH_POST_OWNER),
            Mode::Closing => {}
        },
        "McClose" | "McSealCancel" => close_panel(),
        "McMoveCloser" => nudge(0, MOVE_STEP_M),
        "McMoveFarther" => nudge(0, -MOVE_STEP_M),
        "McMoveUp" => nudge(1, MOVE_STEP_M),
        "McMoveDown" => nudge(1, -MOVE_STEP_M),
        "McMoveRight" => nudge(2, MOVE_STEP_M),
        "McMoveLeft" => nudge(2, -MOVE_STEP_M),
        "BtnSealType" => {
            // The fallback: the old typed passphrase, on the system typing sheet.
            if mode() == Mode::Owner && unsafe { TOKEN_LEN } == 0 {
                open_sheet(SEAL_QUESTION, REQ_PROMPT_SEAL);
            }
        }
        _ if is_face_button(i) => match mode() {
            Mode::Owner if signed_in() => {
                if let Some(slot) = prompt_slot(i) {
                    let q = unsafe { &PROMPT_Q[slot][..PROMPT_Q_LEN[slot]] };
                    let q = core::str::from_utf8(q).unwrap_or("Type here");
                    open_sheet(q, REQ_PROMPT_BASE + i as i32);
                } else {
                    send_press(i, &[]);
                }
            }
            Mode::Watcher => local_status("You are watching: only the owner can press."),
            _ => {}
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
            if mode() == Mode::Owner && unsafe { TOKEN_LEN } == 0 {
                local_status("Signing in...");
                send_signin(text);
            }
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
            if k != 6 || mode() != Mode::Closed {
                return; // not a code: nothing opens, nothing is sent
            }
            unsafe { WATCH_CODE = code; }
            open_panel(Mode::Watcher);
            local_status("Joining...");
        }
        _ => {
            let i = (request_id - REQ_PROMPT_BASE) as usize;
            if signed_in() && i < N_ALL && is_face_button(i) {
                send_press(i, text);
            }
        }
    }
}

fn prompt_slot(node: usize) -> Option<usize> {
    (0..MAX_PROMPTS).find(|&s| unsafe { PROMPT_NODE[s] } == node)
}

// ---------------------------------------------------------------------------
// Opening, closing, stages
// ---------------------------------------------------------------------------

fn open_panel(m: Mode) {
    unsafe {
        MODE = m;
        WATCH_ENDED = false;
        VERSION = 0;
        LAST_Z = -1;
        POLL_IN_FLIGHT = false;
        MINT_IN_FLIGHT = false;
        NEXT_POLL_AT = NOW_S;
        DELTA = [0.0, PARK_DROP_M, 0.0];
        ADJUST = [0.0; 3];
        M_ARC = false;
        ARC_SHOWN = false;
        PICKED = NONE;
        PENDING_PRESS_ID = 0;
        PENDING_PICK = NONE;
        PENDING_PICK_ID = 0;
        PICK_USED = false;
        COMMIT_CUBE = NONE;
        RAIL_SWITCH = false;
        TWEENS = [NO_TWEEN; N_GROUPS];
    }
    desk_reset();
    turn_for_watcher(m == Mode::Watcher);
    sync_all();
    refresh_network(true);
}

/// Closes: everything parks at once. Signed in, the world keeps the token ONLY to send the
/// sign-out, in a short Closing stage that retries on the following ticks until the host takes
/// the call, or CLOSING_MAX_S passes (security review 2, LOW-1); then it drops the token and is
/// Closed, which makes no call at all.
fn close_panel() {
    let sign_out = signed_in();
    unsafe {
        MODE = if sign_out { Mode::Closing } else { Mode::Closed };
        STAGE = Stage::Seal;
        if !sign_out {
            TOKEN_LEN = 0;
        }
        PAIR_LEN = 0;
        MINT_IN_FLIGHT = false;
        WATCH_CODE = [0; 6];
        PROMPT_NODE = [NONE; MAX_PROMPTS];
        DELTA = [0.0; 3];
        ADJUST = [0.0; 3];
        SHIFT = [0.0; N_ALL];
        TWEENS = [NO_TWEEN; N_GROUPS];
        M_ARC = false;
        ARC_SHOWN = false;
        PICKED = NONE;
        PENDING_PICK = NONE;
        PENDING_PICK_ID = 0;
        PICK_USED = false;
        HUE_STATE = [OFF; N_HUE];
        for i in 0..N_ALL {
            WANT[i] = i >= N_FACE;
        }
        TEXT_LEN = [0; N_TEXT];
    }
    sync_all(); // the board hides with everything else (desk_on is false from here)
    desk_reset();
    turn_for_watcher(false);
    // Park every node where it was authored, at its own size.
    for i in 0..N_ALL {
        put(i);
    }
    if sign_out {
        unsafe { CLOSING_UNTIL = NOW_S + CLOSING_MAX_S; }
        try_sign_out();
    }
}

/// Closing: one sign-out press with the held token; once the host takes it, Closed.
fn try_sign_out() {
    if mode() != Mode::Closing {
        return;
    }
    let len = build_request(Some(idx("BtnSignOut")), &[]);
    let id = unsafe {
        let id = NEXT_PRESS_ID;
        NEXT_PRESS_ID = if NEXT_PRESS_ID >= 7999 { REQ_PRESS_FIRST } else { NEXT_PRESS_ID + 1 };
        id
    };
    if fetch(PATH_PRESS, len, id) == 0 {
        finish_close();
    }
}

/// The end of Closing: the token is gone and nothing calls out again.
fn finish_close() {
    unsafe {
        TOKEN = [0; 96];
        TOKEN_LEN = 0;
        MODE = Mode::Closed;
    }
}

/// Back to the seal (closed -> owner, or the owner's sign-in ended): the ring rises from the
/// seal on the seat. Pairing state is cleared; the ledge, the puck and the arc are not shown.
fn to_seal_stage() {
    unsafe {
        STAGE = Stage::Seal;
        TOKEN_LEN = 0;
        PAIR_LEN = 0;
        M_ARC = false;
        ARC_SHOWN = false;
        PICKED = NONE;
        TWEENS = [NO_TWEEN; N_GROUPS];
    }
    reset_scales();
    let from = placed(idx("McSeal"));
    start_tween(G_SEAL, 1.0, SEAL_RISE_S, from);
    sync_all();
}

/// A token arrived while the seal was up: the lock animation (hold, shrink, grow).
fn begin_lock() {
    unsafe {
        STAGE = Stage::Hold;
        HOLD_UNTIL = NOW_S + LOCK_HOLD_S;
        PAIR_LEN = 0;
        MINT_IN_FLIGHT = false;
        TWEENS[G_SEAL as usize] = NO_TWEEN;
    }
    reset_scales();
    // The ring stands at its place, full size, while it shows locked.
    for i in 0..N_ALL {
        if group(i) == G_SEAL && presented(i) {
            put(i);
        }
    }
    if let Some(k) = hue_slot(b"SealRing") {
        paint_slot(k, state_index(k, b"locked"));
    }
}

/// Called whenever a tween ends.
fn tween_done(g: u8) {
    if mode() != Mode::Owner {
        return;
    }
    match (stage(), g) {
        (Stage::Shrink, G_SEAL) => {
            unsafe { STAGE = Stage::Grow; }
            start_tween(G_LEDGE, 1.0, GROW_S, placed(idx("McLedge")));
            start_tween(G_PUCK, 1.0, GROW_S, placed(idx("Puck")));
            sync_all();
        }
        (Stage::Grow, _) => {
            let busy = unsafe { TWEENS[G_LEDGE as usize].active || TWEENS[G_PUCK as usize].active };
            if !busy {
                unsafe { STAGE = Stage::Signed; }
                update_arc();
                desk_sync(); // after the seal: the board comes up with the ledge (unless the arc opens)
            }
        }
        (Stage::Signed, G_ARC) => {
            if unsafe { !ARC_SHOWN } {
                // Folded: the picked cube (and the labels) come back.
                unsafe { PICKED = NONE; }
                sync_all();
            }
            update_arc(); // a fold or unfold may have been asked for meanwhile
        }
        _ => {}
    }
}

/// Signed in: unfold or fold the arc to match `M`.
fn update_arc() {
    if mode() != Mode::Owner || stage() != Stage::Signed {
        return;
    }
    let (want, shown) = unsafe { (M_ARC, ARC_SHOWN) };
    if want && shown {
        retarget_fold();
        return;
    }
    if want == shown {
        return;
    }
    if want {
        // Unfold from the pressed cube (or CubePlus) whose press is pending or was taken, whichever
        // reply opened the arc, else from the ledge's centre (the M change came from elsewhere).
        let (pp, at) = unsafe { (PENDING_PICK, PENDING_PICK_AT) };
        let pending = pp != NONE && unsafe { NOW_S } - at <= PICK_TIMEOUT_S;
        let pick = if pending { pp } else { unsafe { COMMIT_CUBE } };
        if pending {
            unsafe { PICK_USED = true; }
        }
        let from = if pick != NONE { placed(pick) } else { placed(idx("McLedge")) };
        unsafe {
            ARC_SHOWN = true;
            PICKED = pick;
            FOLD_TO = from;
            COMMIT_CUBE = NONE;
            RAIL_SWITCH = false;
        }
        start_tween(G_ARC, 1.0, UNFOLD_S, from);
    } else {
        retarget_fold();
        unsafe {
            ARC_SHOWN = false;
            COMMIT_CUBE = NONE;
        }
        let from = unsafe { FOLD_TO };
        start_tween(G_ARC, -1.0, FOLD_S, from);
    }
    sync_all();
}

/// A cube press the bridge refused (or never answered) changes nothing: the pending origin goes,
/// and if the arc already unfolded from that cube (a poll's `M arc` landed first), the cube shows
/// again and the fold goes to the ledge's centre.
fn refuse_pick() {
    let (pp, used, picked) = unsafe { (PENDING_PICK, PICK_USED, PICKED) };
    unsafe {
        PENDING_PICK = NONE;
        PENDING_PICK_ID = 0;
        PICK_USED = false;
    }
    if used && pp != NONE && picked == pp {
        unsafe {
            PICKED = NONE;
            FOLD_TO = placed(idx("McLedge"));
        }
        sync_all();
    }
}

/// The arc folds back into the cube of the job on show (contract 8.10): a cube pressed while
/// the arc is open moves the arc to that job, so it becomes the picked cube; a picked cube the
/// face no longer shows (its job ended) gives the fold the ledge's centre instead.
fn retarget_fold() {
    let (pc, rail, picked) = unsafe { (COMMIT_CUBE, RAIL_SWITCH, PICKED) };
    unsafe {
        COMMIT_CUBE = NONE;
        RAIL_SWITCH = false;
    }
    if pc != NONE && pc != picked {
        unsafe {
            PICKED = pc;
            FOLD_TO = placed(pc);
        }
        sync_all();
    } else if rail && pc == NONE {
        // A rail moved the arc to another job: the face doesn't name that job's cube, so the
        // fold goes to the ledge's centre and the cube the arc came from shows again.
        unsafe {
            PICKED = NONE;
            FOLD_TO = placed(idx("McLedge"));
        }
        sync_all();
    } else if picked != NONE && unsafe { !WANT[picked] } {
        unsafe {
            PICKED = NONE;
            FOLD_TO = placed(idx("McLedge"));
        }
    }
}

/// Turn every arc node 180 degrees of yaw for a watcher's copy, or back.
fn turn_for_watcher(turn: bool) {
    if unsafe { TURNED } == turn {
        return;
    }
    for i in 0..N_ALL {
        let h = unsafe { HANDLES[i] };
        if h == 0 || group(i) != G_ARC {
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
/// The handles move the arc only: the ledge and the puck belong to the throne.
fn nudge(axis: usize, by: f32) {
    if mode() == Mode::Closed || mode() == Mode::Closing {
        return;
    }
    let (lo, hi) = match axis {
        0 => (-MOVE_FAR, MOVE_NEAR),
        1 => (-MOVE_UPDOWN, MOVE_UPDOWN),
        _ => (-MOVE_SIDE, MOVE_SIDE),
    };
    let mut next = unsafe { ADJUST };
    next[axis] = clamp(next[axis] + by, lo, hi);
    // The owner's arc never moves into the ledge or the puck (correctness review 2, LOW-5): a
    // step that would is refused. A watcher's copy stands in the hall, far from both.
    if mode() == Mode::Owner && !arc_clear(next) {
        local_status("That way the arc would run into the ledge or the puck.");
        return;
    }
    unsafe { ADJUST = next; }
    for i in 0..N_ALL {
        if group(i) == G_ARC && presented(i) && i != FLOOR_I {
            put(i);
        }
    }
    // The floor ring stays where it is; a move may only show or hide it.
    sync_node(FLOOR_I);
}

/// The floor decal's footprint on the hall floor (viewer frame, as blender/build_panel.py builds
/// `McFloorRing`): x from FLOOR_X0 to FLOOR_X1, y within +-FLOOR_HALF_W, at FLOOR_Z_VIEW. From the
/// eye it starts past every cube and need halo (their sightlines land short of FLOOR_X0) and ends
/// before the ask plate's (which lands at about 6.09 m with the handles at rest).
pub const FLOOR_X0: f32 = 4.65;
pub const FLOOR_X1: f32 = 6.05;
pub const FLOOR_HALF_W: f32 = 1.8;
pub const FLOOR_Z_VIEW: f32 = 0.035 - 1.46;
/// The owner's eye in the viewer frame.
pub const EYE_Z: f32 = 1.6;

/// True when, with the handle adjustment `a`, no sightline from the eye to the floor decal
/// passes through the ask plate (which always sits on the centre panel: plate glass + panel
/// glass + decal would be three translucent layers). Both faces of the plate's box are tested
/// (the near face reaches the floor sooner, the far face spreads wider). Nothing else in the
/// arc stacks over the decal: the chrome bar and the centre panel share a plane and don't
/// overlap, and the side panels' sightlines land beyond 8 m.
fn floor_clear(a: [f32; 3]) -> bool {
    let p = ARC_PARTS[1];
    let yc = p[1] - a[2];
    let (yl, yr) = (yc - p[4], yc + p[4]);
    let (zb, zt) = (p[2] - p[5] + a[1], p[2] + p[5] + a[1]);
    plane_clear(p[0] - p[3] - a[0], yl, yr, zb, zt) && plane_clear(p[0] + p[3] - a[0], yl, yr, zb, zt)
}

/// True when no sightline from the eye to the floor decal crosses the rectangle at depth `xp`
/// spanning y [yl, yr] and height [zb, zt] (viewer frame).
fn plane_clear(xp: f32, yl: f32, yr: f32, zb: f32, zt: f32) -> bool {
    if xp <= 0.0 {
        return false;
    }
    if zb >= EYE_Z {
        return true; // above the eye: its sightlines never reach the floor
    }
    let drop = EYE_Z - FLOOR_Z_VIEW;
    let x_lo = xp * drop / (EYE_Z - zb);
    let x_hi = if zt >= EYE_Z { f32::MAX } else { xp * drop / (EYE_Z - zt) };
    let xa = if x_lo > FLOOR_X0 { x_lo } else { FLOOR_X0 };
    let mut xb = if x_hi < FLOOR_X1 { x_hi } else { FLOOR_X1 };
    if xa >= xb {
        return true;
    }
    // A floor point (X, Y) is behind the rectangle when Y * xp / X lies in [yl, yr]. Meeting
    // the decal's +-FLOOR_HALF_W needs yl * X / xp <= FLOOR_HALF_W and yr * X / xp >=
    // -FLOOR_HALF_W; each holds for every X or only up to a bound, so the overlap, if any,
    // starts at the smallest X.
    if yl > 0.0 {
        let b = FLOOR_HALF_W * xp / yl;
        if b < xb {
            xb = b;
        }
    }
    if yr < 0.0 {
        let b = FLOOR_HALF_W * xp / -yr;
        if b < xb {
            xb = b;
        }
    }
    xa >= xb
}

/// The arc's solid parts in the viewer frame (origin at the owner's feet, +x ahead, +y the
/// owner's left, metres), as blender/build_panel.py builds them: centre (x, y, z), half extents
/// (depth along the part's own facing, width, height), yaw in degrees. The words and buttons
/// lie inside these depths.
const ARC_PARTS: [[f32; 7]; 5] = [
    [1.705, 0.0, 1.49, 0.05, 0.66, 0.70, 0.0],     // centre panel, z 0.79-2.19
    [1.606, 0.0, 1.0875, 0.025, 0.62, 0.2725, 0.0], // ask plate with its buttons, z 0.815-1.36
    [1.7075, 0.0, 0.675, 0.03, 0.78, 0.09, 0.0],   // chrome bar with its buttons, z 0.585-0.765 (clarity pass: 0.18 tall)
    [1.4562, 1.0580, 1.555, 0.05, 0.425, 0.605, 36.0], // left panel, 1.80 m at 36 degrees
    [1.4562, -1.0580, 1.555, 0.05, 0.425, 0.605, -36.0], // right panel
];
/// What the arc must keep out of (viewer-frame boxes, min xyz then max xyz), 2-3 cm to spare:
/// the ledge with its cubes and CLOSE, and the puck with its stem, plate and tabs.
const KEEP_OUT: [[f32; 6]; 2] = [
    [0.77, -0.93, 0.755, 1.03, 0.93, 0.94], // the cubes top out at 0.922, CLOSE at 0.89
    [-0.33, 0.79, 0.61, 0.63, 1.17, 1.235],
];

/// True when no arc part, shifted by the handle adjustment `a` (toward, up, right), overlaps a
/// keep-out box. Separating axes: z, then x, y and the part's two horizontal axes.
fn arc_clear(a: [f32; 3]) -> bool {
    for p in ARC_PARTS.iter() {
        let c = [p[0] - a[0], p[1] - a[2], p[2] + a[1]];
        let yaw = p[6] * core::f32::consts::PI / 180.0;
        let (sn, cs) = (sin_taylor(yaw), cos_taylor(yaw));
        let u = [cs, sn]; // the part's facing (depth)
        let v = [-sn, cs]; // the part's width
        for k in KEEP_OUT.iter() {
            let kc = [(k[0] + k[3]) / 2.0, (k[1] + k[4]) / 2.0, (k[2] + k[5]) / 2.0];
            let ke = [(k[3] - k[0]) / 2.0, (k[4] - k[1]) / 2.0, (k[5] - k[2]) / 2.0];
            if (c[2] - kc[2]).abs() >= p[5] + ke[2] {
                continue; // apart in height
            }
            let d = [c[0] - kc[0], c[1] - kc[1]];
            let mut apart = false;
            for n in [[1.0f32, 0.0], [0.0, 1.0], u, v] {
                let r1 = p[3] * (u[0] * n[0] + u[1] * n[1]).abs() + p[4] * (v[0] * n[0] + v[1] * n[1]).abs();
                let r2 = ke[0] * n[0].abs() + ke[1] * n[1].abs();
                if (d[0] * n[0] + d[1] * n[1]).abs() >= r1 + r2 {
                    apart = true;
                    break;
                }
            }
            if !apart {
                return false;
            }
        }
    }
    true
}

/// sin and cos without libm (no_std): Taylor series, plenty for |x| <= pi.
fn sin_taylor(x: f32) -> f32 {
    let x2 = x * x;
    x * (1.0 - x2 / 6.0 * (1.0 - x2 / 20.0 * (1.0 - x2 / 42.0 * (1.0 - x2 / 72.0))))
}
fn cos_taylor(x: f32) -> f32 {
    let x2 = x * x;
    1.0 - x2 / 2.0 * (1.0 - x2 / 12.0 * (1.0 - x2 / 30.0 * (1.0 - x2 / 56.0 * (1.0 - x2 / 90.0))))
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

// ---------------------------------------------------------------------------
// Where things go: place, tweens
// ---------------------------------------------------------------------------

/// Where an authored (parked) point of group `g` goes now, `s` metres along the viewer's right:
/// parked when closed; raised in front of the throne for the owner (the arc also takes the
/// handle adjustments); for a watcher, the arc turned to face the hall and lowered to its
/// floor, and every other group left parked.
/// `adjust`: apply the arc's handle adjustment (false for the floor ring, which never takes it).
fn place(g: u8, p: [f32; 3], s: f32, adjust: bool) -> [f32; 3] {
    match mode() {
        Mode::Closed | Mode::Closing => p,
        Mode::Watcher if g != G_ARC => p,
        m => {
            let (d, a) = unsafe { (DELTA, ADJUST) };
            let watcher = m == Mode::Watcher;
            let (right, toward) = if watcher { (RIGHT_WATCH, TOWARD_WATCH) } else { (RIGHT, TOWARD) };
            let mut q = [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
            if watcher {
                q = [2.0 * WATCH_PIVOT_X - q[0], q[1] - WATCH_LOWER_M, -q[2]];
            }
            let arc = g == G_ARC && adjust;
            for k in 0..3 {
                q[k] += right[k] * s;
                if arc {
                    q[k] += a[0] * toward[k] + a[2] * right[k] + if k == 1 { a[1] } else { 0.0 };
                }
            }
            q
        }
    }
}

/// A node's place now (its group's rules, its own shift), ignoring any tween.
fn placed(i: usize) -> [f32; 3] {
    let p = base_of(i).unwrap_or([0.0; 3]);
    if is_fixture(i) {
        return p;
    }
    place(group(i), p, unsafe { SHIFT[i] }, i != FLOOR_I)
}

fn ease(k: f32) -> f32 {
    let k = clamp(k, 0.0, 1.0);
    if k < 0.5 {
        4.0 * k * k * k
    } else {
        let u = -2.0 * k + 2.0;
        1.0 - u * u * u / 2.0
    }
}

/// Sets one node's transform to what it should be this frame: its place, or, while its
/// group's tween runs, between the tween's point and its place, scaled down. Text anchors
/// never scale (their words are hidden while their group moves).
fn put(i: usize) {
    let h = unsafe { HANDLES[i] };
    if h == 0 || is_fixture(i) {
        return;
    }
    if base_of(i).is_none() {
        return;
    }
    let target = placed(i);
    let tw = unsafe { TWEENS[group(i) as usize] };
    if tw.active && i >= N_TEXT {
        let e = ease(tw.k);
        let q = [tw.from[0] + (target[0] - tw.from[0]) * e, tw.from[1] + (target[1] - tw.from[1]) * e, tw.from[2] + (target[2] - tw.from[2]) * e];
        let s = SCALE_MIN + (1.0 - SCALE_MIN) * e;
        unsafe {
            host::k_transform_set_position(h, q[0], q[1], q[2]);
            host::k_transform_set_scale(h, s, s, s);
            SCALED[i] = true;
        }
    } else {
        unsafe {
            host::k_transform_set_position(h, target[0], target[1], target[2]);
            if SCALED[i] {
                host::k_transform_set_scale(h, 1.0, 1.0, 1.0);
                SCALED[i] = false;
            }
        }
    }
}

/// Starts (or turns around) group `g`'s tween. A tween already running keeps its progress,
/// so a fold asked for mid-unfold reverses from where it is.
fn start_tween(g: u8, dir: f32, dur: f32, from: [f32; 3]) {
    unsafe {
        let t = &mut TWEENS[g as usize];
        if !t.active {
            t.k = if dir > 0.0 { 0.0 } else { 1.0 };
        }
        t.active = true;
        t.dir = dir;
        t.dur = dur;
        t.from = from;
    }
    // Every shown node of the group starts from the tween's point this frame.
    for i in 0..N_ALL {
        if group(i) == g && unsafe { VISIBLE[i] } == 1 {
            put(i);
        }
    }
}

/// Every frame: advance each running tween and move ONLY its group's shown nodes.
fn tick_tweens(dt: f32) {
    for g in 1..N_GROUPS {
        let done = unsafe {
            let t = &mut TWEENS[g];
            if !t.active {
                continue;
            }
            t.k = clamp(t.k + t.dir * dt / t.dur, 0.0, 1.0);
            (t.dir > 0.0 && t.k >= 1.0) || (t.dir < 0.0 && t.k <= 0.0)
        };
        if !done {
            for i in 0..N_ALL {
                if group(i) == g as u8 && unsafe { VISIBLE[i] } == 1 {
                    put(i);
                }
            }
            continue;
        }
        let grew = unsafe { TWEENS[g].dir > 0.0 };
        unsafe { TWEENS[g].active = false; }
        if grew {
            // Everything at its place, full size; then the words show (sync).
            for i in 0..N_ALL {
                if group(i) == g as u8 && unsafe { VISIBLE[i] } == 1 {
                    put(i);
                }
            }
            sync_all();
        } else {
            // Folded or shrunk away: hide first, then give back the full size (no move: a
            // hidden node is placed when it shows again).
            sync_all();
            for i in 0..N_ALL {
                if group(i) == g as u8 && unsafe { SCALED[i] } {
                    let h = unsafe { HANDLES[i] };
                    unsafe {
                        host::k_transform_set_scale(h, 1.0, 1.0, 1.0);
                        SCALED[i] = false;
                    }
                }
            }
        }
        tween_done(g as u8);
    }
}

/// Turns the seal ring (the SealRing body: its segmented arcs and ticks) about the axis it faces
/// along, while it shows and its group is not tweening. The variants and the words stay still.
fn spin_seal(dt: f32) {
    if mode() != Mode::Owner || dt <= 0.0 {
        return;
    }
    let i = idx("SealRing");
    if unsafe { VISIBLE[i] } != 1 || unsafe { TWEENS[G_SEAL as usize].active } {
        return;
    }
    let Some(r) = base_rot_of(i) else { return };
    let spin = unsafe {
        SEAL_SPIN = (SEAL_SPIN + SEAL_SPIN_DEG_S * dt) % 360.0;
        SEAL_SPIN
    };
    unsafe { host::k_transform_set_rotation(HANDLES[i], r[0], r[1], r[2] + spin); }
}

/// Every node back to scale 1 (an animation was cut short).
fn reset_scales() {
    for i in 0..N_ALL {
        if unsafe { SCALED[i] } {
            let h = unsafe { HANDLES[i] };
            unsafe {
                host::k_transform_set_scale(h, 1.0, 1.0, 1.0);
                SCALED[i] = false;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Two-layer visibility
// ---------------------------------------------------------------------------

/// Layer two: is group `g` on for the current mode and stage (or kept on by its tween)?
fn group_on(g: u8) -> bool {
    if unsafe { TWEENS[g as usize].active } {
        return true;
    }
    match mode() {
        Mode::Closed | Mode::Closing => false,
        Mode::Watcher => g == G_ARC,
        Mode::Owner => match stage() {
            Stage::Seal | Stage::Hold => g == G_SEAL,
            Stage::Shrink => false,
            Stage::Grow => g == G_LEDGE || g == G_PUCK,
            Stage::Signed => g == G_LEDGE || g == G_PUCK || (g == G_ARC && unsafe { ARC_SHOWN }),
        },
    }
}

/// Things that stay hidden whatever the snapshot wants:
///   - words while their group moves (texts appear only when an animation ends);
///   - the picked cube while the arc is open or moving (it became the arc);
///   - the cube labels while the arc is open or moving: seen from the throne they would sit
///     over the centre panel's bottom rows (the left panel lists the jobs instead).
fn held_back(i: usize) -> bool {
    let g = group(i);
    // The floor ring: never in a watcher's mirrored copy (it would lie under the floor), and
    // hidden while the handles hold the arc where the ask plate and the centre panel would
    // stack over it from the eye (a third translucent layer; correctness review 4, MEDIUM-2).
    if i == FLOOR_I && (mode() == Mode::Watcher || !floor_clear(unsafe { ADJUST })) {
        return true;
    }
    if i < N_TEXT && unsafe { TWEENS[g as usize].active } {
        return true;
    }
    let arc_up = unsafe { ARC_SHOWN || TWEENS[G_ARC as usize].active };
    if arc_up && g == G_LEDGE {
        let n = node_name(i);
        if n.starts_with("TxCube") {
            return true;
        }
        let p = unsafe { PICKED };
        if p != NONE && i == p {
            return true;
        }
    }
    false
}

/// Is node `i` shown now (both layers)? Variants follow their base (see `paint`).
fn shown(i: usize) -> bool {
    if is_fixture(i) {
        return true;
    }
    let want = if i < N_TEXT { (unsafe { TEXT_LEN[i] }) > 0 } else { unsafe { WANT[i] } };
    want && group_on(group(i)) && !held_back(i)
}

/// A node that is on screen: a shown mesh, or a plaque whose words show.
fn presented(i: usize) -> bool {
    unsafe { VISIBLE[i] == 1 || (i < N_TEXT && TEXT_HASH[i] > 1) }
}

fn sync_node(i: usize) {
    if is_fixture(i) || is_variant(i) {
        return;
    }
    let on = shown(i);
    if i < N_TEXT {
        // A plaque is never shown itself (3 cm studs); its words are.
        if on {
            if unsafe { TEXT_HASH[i] } <= 1 {
                put(i);
            }
            let n = unsafe { TEXT_LEN[i] } as usize;
            let text = unsafe { core::str::from_utf8_unchecked(&TEXT_STORE[i][..n]) };
            show(i, text);
        } else {
            hide_text(i);
        }
    } else {
        if on && unsafe { VISIBLE[i] } != 1 {
            put(i);
        }
        set_visible(i, on);
    }
}

fn sync_all() {
    for i in 0..N_ALL {
        sync_node(i);
    }
    for k in 0..N_HUE {
        paint_slot(k, unsafe { HUE_STATE[k] });
    }
    // Last, so a fold that just ended has hidden the arc's labels before the board's show.
    desk_sync();
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

/// Writes an AB1 request into REQ_BUF; returns its length. The owner's carries the token, or
/// (no token yet) the pending pairing's id. A watcher's carries the watch code and never a
/// token, a pairing id, a press or typed text.
fn build_request(press: Option<usize>, text: &[u8]) -> usize {
    let buf = unsafe { &mut *core::ptr::addr_of_mut!(REQ_BUF) };
    let mut w = Writer { buf, n: 0 };
    w.push(b"AB1\n");
    // Closing sends one thing: the sign-out press, with the token it still holds.
    let owner = mode() == Mode::Owner || mode() == Mode::Closing;
    if mode() == Mode::Watcher {
        w.push(b"watch ");
        w.push(unsafe { &*core::ptr::addr_of!(WATCH_CODE) });
        w.push(b"\n");
    } else if owner {
        let tl = unsafe { TOKEN_LEN };
        let pl = unsafe { PAIR_LEN };
        if tl > 0 {
            w.push(b"tok ");
            let token = unsafe { &*core::ptr::addr_of!(TOKEN) };
            w.push(&token[..tl]);
            w.push(b"\n");
        } else if pl > 0 {
            w.push(b"pair ");
            let id = unsafe { &*core::ptr::addr_of!(PAIR_ID) };
            w.push(&id[..pl]);
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

fn fetch(path: &'static str, len: usize, id: i32) -> i32 {
    if mode() == Mode::Closed {
        return -2; // never a call while closed
    }
    unsafe { LAST_PATH = path; }
    let u = url(path);
    let body = core::ptr::addr_of!(REQ_BUF) as *const u8;
    unsafe { host::k_net_fetch(METHOD_POST, u.as_ptr() as i32, u.len() as i32, body as i32, len as i32, 0, id) }
}

/// The pairing's first call: no `pair` field, so the bridge mints one.
fn mint_pairing() {
    unsafe { PAIR_LEN = 0; }
    let len = build_request(None, &[]);
    let rc = fetch(PATH_PAIR, len, REQ_PAIR_MINT);
    if rc == 0 {
        unsafe {
            MINT_IN_FLIGHT = true;
            NEXT_POLL_AT = NOW_S + VIEW_MIN_GAP_S;
        }
        local_status("Asking the bridge for a code...");
    } else {
        local_status(if rc == -6 { "Too fast: press the seal again in a second." } else { "The headset refused the call: network off for this world?" });
    }
}

fn send_signin(passphrase: &[u8]) {
    let len = build_request(None, passphrase);
    let rc = fetch(PATH_SIGNIN, len, REQ_SIGNIN);
    if rc != 0 {
        local_status(if rc == -6 { "Too fast: try again in a second." } else { "The headset refused the call: network off for this world?" });
    }
}

fn send_poll(path: &'static str) {
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
    if !signed_in() {
        return; // a watcher, or nobody signed in: a press is never sent
    }
    let len = build_request(Some(i), text);
    let id = unsafe {
        let id = NEXT_PRESS_ID;
        NEXT_PRESS_ID = if NEXT_PRESS_ID >= 7999 { REQ_PRESS_FIRST } else { NEXT_PRESS_ID + 1 };
        id
    };
    let rc = fetch(PATH_PRESS, len, id);
    if rc == 0 {
        let n = node_name(i);
        if n.starts_with("Cube") || n.starts_with("Rail") {
            unsafe {
                PENDING_PRESS_ID = id;
                PENDING_PRESS_NODE = i;
            }
        }
        if n.starts_with("Cube") && unsafe { !ARC_SHOWN } {
            unsafe {
                PENDING_PICK = i;
                PENDING_PICK_ID = id;
                PENDING_PICK_AT = NOW_S;
                PICK_USED = false;
            }
        }
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
    if request_id == REQ_DESK {
        // The board's own answer: it never touches Mission Control's state or its status line.
        unsafe { DESK_IN_FLIGHT = false; }
        if !signed_in() {
            return;
        }
        let ptr = core::ptr::addr_of_mut!(READ_BUF) as *mut u8;
        let len = if status == 200 { unsafe { host::k_net_read(request_id, 0, 0) } } else { 0 };
        let got = if len > 0 && len as usize <= READ_BUF_BYTES {
            unsafe { host::k_net_read(request_id, ptr as usize as i32, READ_BUF_BYTES as i32) }
        } else {
            0
        };
        if got <= 0 {
            desk_offline();
        } else {
            apply_desk(unsafe { core::slice::from_raw_parts(ptr, got as usize) });
        }
        return;
    }
    if request_id == REQ_VIEW {
        unsafe { POLL_IN_FLIGHT = false; }
    }
    if request_id == REQ_PAIR_MINT {
        unsafe { MINT_IN_FLIGHT = false; }
    }
    if status != 200 && request_id == unsafe { PENDING_PRESS_ID } {
        unsafe { PENDING_PRESS_ID = 0; } // a press that got no answer changes nothing
    }
    if status != 200 && request_id == unsafe { PENDING_PICK_ID } {
        refuse_pick(); // nor does a cube press that got none
    }
    if mode() == Mode::Closed || mode() == Mode::Closing {
        return; // a late answer after Close changes nothing
    }
    if status != 200 {
        if request_id == REQ_VIEW {
            unsafe { NEXT_POLL_AT = NOW_S + RETRY_GAP_S; }
        }
        if request_id == REQ_PAIR_MINT {
            // Nothing is pending and nothing polls: say what to do (contract 8.10).
            local_status(match status {
                503 => "Stopped on the PC. Lift the kill switch, then press the seal again.",
                _ => "No code this time. Wait a few seconds and press the seal again.",
            });
            return;
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
    apply_reply(request_id, body);
}

/// Applies an answer to request `id`: a pending cube or rail press commits only through its own
/// reply, and only when that reply took it.
pub fn apply_reply(id: i32, body: &[u8]) {
    unsafe { REPLY_ID = id; }
    apply_snapshot(body);
    unsafe {
        if id != 0 && id == PENDING_PRESS_ID {
            PENDING_PRESS_ID = 0;
        }
        REPLY_ID = 0;
    }
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
    let mut lost_token = false;
    let mut got_token = false;
    let mut press_refused = false;
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
                if !watcher {
                    if name == b"lock" && unsafe { TOKEN_LEN } > 0 {
                        lost_token = true;
                    }
                    unsafe { M_ARC = name == b"arc"; }
                }
            }
            b'K' => {
                if !watcher && mode() == Mode::Owner {
                    let n = name.len().min(96);
                    if n > 0 {
                        unsafe {
                            TOKEN[..n].copy_from_slice(&name[..n]);
                            TOKEN_LEN = n;
                            LAST_Z = -1;
                            PAIR_LEN = 0;
                        }
                        lost_token = false;
                        got_token = true;
                    }
                }
            }
            b'I' => {
                // A pairing id: 32 lowercase hex, kept in memory only while there is no token.
                let ok = name.len() == 32 && name.iter().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(b));
                if ok && !watcher && mode() == Mode::Owner && unsafe { TOKEN_LEN } == 0 {
                    unsafe {
                        (*core::ptr::addr_of_mut!(PAIR_ID)).copy_from_slice(name);
                        PAIR_LEN = 32;
                    }
                }
            }
            b'E' => {
                if !watcher {
                    match name {
                        b"signed_out" if unsafe { TOKEN_LEN } > 0 => {
                            lost_token = true;
                            press_refused = true;
                        }
                        b"paired" | b"pair_expired" | b"pair_refused" => unsafe { PAIR_LEN = 0 },
                        b"stale" | b"refused" | b"busy" => press_refused = true,
                        _ => {}
                    }
                }
                if name == b"watch_refused" && watcher {
                    unsafe { WATCH_ENDED = true; }
                }
            }
            b'T' => {
                if let Some(i) = face_node(name) {
                    let mut t = TextBuf::new();
                    unescape_into(arg, &mut t);
                    store_text(i, t.as_str());
                }
            }
            b'X' => {
                if let Some(i) = face_node(name) {
                    store_text(i, "");
                }
            }
            b'U' => {
                if let Some(i) = face_node(name) {
                    if i >= N_TEXT {
                        unsafe { WANT[i] = arg == b"1"; }
                    }
                }
            }
            b'H' => {
                if let Some(k) = hue_slot(name) {
                    let st = if arg == b"off" { Some(OFF) } else { find_state(k, arg) };
                    if let Some(st) = st {
                        unsafe { HUE_STATE[k] = st; }
                    }
                }
            }
            b'O' => {
                if let Some(i) = face_node(name) {
                    unsafe { SHIFT[i] = clamp(parse_i32(arg) as f32 / 1000.0, -2.0, 2.0); }
                    if presented(i) {
                        put(i);
                    }
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
                if last >= 0 && z > last && !watcher && signed_in() {
                    buzz();
                }
                unsafe { LAST_Z = z; }
            }
            _ => {}
        }
    }
    if mode() == Mode::Owner {
        if lost_token {
            // Signed out, or the bridge no longer knows the token (expiry, a restart, the kill
            // switch): close fully, never a blank ring (contract 8.8). The seal starts again.
            unsafe { TOKEN_LEN = 0; }
            close_panel();
            return;
        } else if got_token && stage() == Stage::Seal {
            begin_lock();
        }
        let (reply, pick_id) = unsafe { (REPLY_ID, PENDING_PICK_ID) };
        if reply != 0 && reply == pick_id {
            if press_refused {
                refuse_pick();
            } else {
                unsafe {
                    PENDING_PICK = NONE;
                    PENDING_PICK_ID = 0;
                }
            }
        }
        let (reply, pending, node) = unsafe { (REPLY_ID, PENDING_PRESS_ID, PENDING_PRESS_NODE) };
        if reply != 0 && reply == pending && !press_refused && node != NONE {
            if node_name(node).starts_with("Cube") {
                unsafe { COMMIT_CUBE = node; }
            } else {
                unsafe { RAIL_SWITCH = true; }
            }
        }
    }
    sync_all();
    update_arc();
}

/// A node the bridge may name: the face's nodes only, never the world's own (seal, handles...).
fn face_node(name: &[u8]) -> Option<usize> {
    node_index(name).filter(|&i| i < N_FACE)
}

fn hue_slot(name: &[u8]) -> Option<usize> {
    (0..N_HUE).find(|&k| HUE_BASES[k].as_bytes() == name)
}

fn find_state(k: usize, st: &[u8]) -> Option<u8> {
    HUE_STATES[k].iter().position(|s| s.as_bytes() == st).map(|j| j as u8)
}

fn state_index(k: usize, st: &[u8]) -> u8 {
    find_state(k, st).unwrap_or(OFF)
}

fn store_text(i: usize, s: &str) {
    if i >= N_TEXT {
        return;
    }
    let mut end = s.len().min(HOST_TEXT_MAX_BYTES);
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    unsafe {
        TEXT_STORE[i][..end].copy_from_slice(&s.as_bytes()[..end]);
        TEXT_LEN[i] = end as u8;
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
    let slot = prompt_slot(node).or_else(|| (0..MAX_PROMPTS).find(|&s| unsafe { PROMPT_NODE[s] } == NONE));
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
// The two functions DB-045 (the visual pack) replaces: `show` places words, `paint` colours
// ---------------------------------------------------------------------------

/// World text on Mission Control's anchor `i` (through `words`).
fn show(i: usize, text: &str) {
    if i >= N_TEXT {
        return;
    }
    let h = unsafe { HANDLES[i] };
    unsafe { TEXT_HASH[i] = words(h, text, TEXT_HASH[i]); }
}

/// THE ONE text-placement function: world text on the anchor with handle `h` (deduplicated
/// against `last`, the FNV of what it shows; clipped to the host's 128 bytes). Returns the new
/// `last`. Mission Control's labels (`show`) and the Desk board's (`desk_sync`) both come here.
/// DB-045 replaces this body; nothing else places words.
fn words(h: i32, text: &str, last: u32) -> u32 {
    if h == 0 || mode() == Mode::Closed || mode() == Mode::Closing {
        return last;
    }
    let mut end = text.len().min(HOST_TEXT_MAX_BYTES);
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    let text = if end == 0 { " " } else { &text[..end] };
    let hash = fnv(text.as_bytes());
    if last == hash {
        return last;
    }
    let rc = unsafe { host::k_ui_show_world_text(h, text.as_ptr() as i32, text.len() as i32, 0.0) };
    if rc == 0 { hash } else { 0 }
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

/// THE ONE colour function: paints hue base `base` (a node name in nodes.json `hue`) in
/// `state` ("calm", "need", "idle", "armed", "locked" or "off"). Today a colour is a
/// pre-built variant node `<base><State>`: the matching variant shows (when its base shows)
/// and the others hide; "off" hides all. DB-045 replaces this body with a material call.
pub fn paint(base: &str, state: &str) {
    let Some(k) = hue_slot(base.as_bytes()) else { return };
    let st = if state == "off" { OFF } else { state_index(k, state.as_bytes()) };
    paint_slot(k, st);
}

fn paint_slot(k: usize, st: u8) {
    if k >= N_HUE {
        return;
    }
    unsafe { HUE_STATE[k] = st; }
    let base = unsafe { HUE_BASE_IDX[k] };
    // The colour shows only on a base that shows (two-layer). SealRing and Puck are the
    // world's own bodies; the cubes are the face's buttons.
    let base_on = base != NONE && shown(base);
    for j in 0..MAX_STATES {
        let v = unsafe { HUE_VARIANT[k][j] };
        if v == NONE {
            continue;
        }
        let on = base_on && st == j as u8;
        if on && unsafe { VISIBLE[v] } != 1 {
            put(v);
        }
        set_visible(v, on);
    }
}

// ---------------------------------------------------------------------------
// Scene helpers
// ---------------------------------------------------------------------------

/// The world's own line, shown at once and overwritten by the bridge's next record: the seal
/// hint while nobody is signed in, the status line after.
fn local_status(s: &str) {
    if mode() == Mode::Closed || mode() == Mode::Closing {
        return;
    }
    let i = if mode() == Mode::Owner && unsafe { TOKEN_LEN } == 0 { idx("TxSealHint") } else { idx("TxStatus") };
    store_text(i, s);
    sync_node(i);
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
    let p = host::position_of(h)?;
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
    let r = host::rotation_of(h)?;
    unsafe {
        BASE_ROT[i] = r;
        BASE_ROT_KNOWN[i] = true;
    }
    Some(r)
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
        unsafe { NEXT_POLL_AT = NEXT_POLL_AT.min(NOW_S + VIEW_MIN_GAP_S); }
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
// The Kosmos Desk board (see its state above)
// ---------------------------------------------------------------------------

/// Finds the board's nodes (after Mission Control's, so their handles keep their order), reads
/// where they are authored (parked) and hides the panel. The plaques are never shown themselves.
fn desk_init() {
    for j in 0..N_DESK {
        let name = desk_name(j);
        let h = unsafe { host::k_node_find(name.as_ptr() as i32, name.len() as i32) };
        unsafe {
            DESK_H[j] = h;
            DESK_BASE_KNOWN[j] = false;
            DESK_AT[j] = None;
            DESK_VIS[j] = -1;
        }
        if h != 0 {
            if let Some(p) = host::position_of(h) {
                unsafe {
                    DESK_BASE[j] = p;
                    DESK_BASE_KNOWN[j] = true;
                }
            }
            unsafe {
                host::k_node_set_visible(h, 0);
                DESK_VIS[j] = 0;
            }
        }
    }
    unsafe { DESK_HASH = [1; N_DESK_TEXT]; } // nothing shows yet: known hidden
    desk_reset();
}

fn desk_name(j: usize) -> &'static str {
    if j < N_DESK_TEXT { DESK_TEXT[j] } else { DESK_WORLD[j - N_DESK_TEXT] }
}

/// A board label the bridge may set: the board's text nodes only.
fn desk_text_node(name: &[u8]) -> Option<usize> {
    (0..N_DESK_TEXT).find(|&j| DESK_TEXT[j].as_bytes() == name)
}

/// Back to "Asking the PC...", no cards, no shifts, the next ask due at once.
fn desk_reset() {
    unsafe {
        DESK_LEN = [0; N_DESK_TEXT];
        DESK_SHIFT = [0.0; N_DESK_TEXT];
        DESK_IN_FLIGHT = false;
        DESK_NEXT_AT = NOW_S;
    }
    desk_store(0, DESK_ASKING);
}

/// The board shows: signed in, after the seal, cubes mode (the arc folded and not moving).
fn desk_on() -> bool {
    signed_in() && stage() == Stage::Signed && unsafe { !ARC_SHOWN && !TWEENS[G_ARC as usize].active && !TWEENS[G_LEDGE as usize].active }
}

fn desk_store(j: usize, s: &str) {
    if j >= N_DESK_TEXT {
        return;
    }
    let mut end = s.len().min(HOST_TEXT_MAX_BYTES);
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    unsafe {
        DESK_STORE[j][..end].copy_from_slice(&s.as_bytes()[..end]);
        DESK_LEN[j] = end as u8;
    }
}

/// No answer, or not a 200: the heading says so and no card stays up.
fn desk_offline() {
    for j in 1..N_DESK_TEXT {
        desk_store(j, "");
    }
    desk_store(0, DESK_OFFLINE);
    desk_sync();
}

/// Applies the `desk` face's answer. Only `T`, `X` and `O` on the board's own labels count:
/// a `K`, `M`, `E`, `U`, `H` or any node of Mission Control's is ignored, so the board can never
/// sign anyone in or out, open the arc, or write on another panel.
pub fn apply_desk(body: &[u8]) {
    let mut lines = body.split(|&b| b == b'\n');
    if lines.next() != Some(b"AB1".as_slice()) {
        desk_offline();
        return;
    }
    for line in lines {
        if line.len() < 3 || line[1] != b' ' {
            continue;
        }
        let (name, arg) = split_once(&line[2..]);
        let Some(j) = desk_text_node(name) else { continue };
        match line[0] {
            b'T' => {
                let mut t = TextBuf::new();
                unescape_into(arg, &mut t);
                desk_store(j, t.as_str());
            }
            b'X' => desk_store(j, ""),
            b'O' => unsafe { DESK_SHIFT[j] = clamp(parse_i32(arg) as f32 / 1000.0, -DESK_SHIFT_MAX_M, DESK_SHIFT_MAX_M) },
            _ => {}
        }
    }
    desk_sync();
}

/// Where board node `j` goes: raised (with the rest of the owner's panel, by DELTA) and shifted
/// along the board, or where it was authored.
fn desk_target(j: usize, raised: bool) -> [f32; 3] {
    let b = unsafe { DESK_BASE[j] };
    if !raised {
        return b;
    }
    let d = unsafe { DELTA };
    let s = if j < N_DESK_TEXT { unsafe { DESK_SHIFT[j] } } else { 0.0 };
    [b[0] + d[0] + DESK_RIGHT[0] * s, b[1] + d[1] + DESK_RIGHT[1] * s, b[2] + d[2] + DESK_RIGHT[2] * s]
}

/// Moves board node `j` only when its place changed (no host call otherwise).
fn desk_put(j: usize, raised: bool) {
    let h = unsafe { DESK_H[j] };
    if h == 0 || unsafe { !DESK_BASE_KNOWN[j] } {
        return;
    }
    let p = desk_target(j, raised);
    let at = unsafe { DESK_AT[j] };
    let same = match at {
        Some(a) => (0..3).all(|k| (a[k] - p[k]).abs() < 1e-4),
        None => !raised, // never moved: still parked where it was authored
    };
    if !same {
        unsafe {
            host::k_transform_set_position(h, p[0], p[1], p[2]);
            DESK_AT[j] = Some(p);
        }
    }
}

/// The board's two-state visibility, deduplicated so a frame with no change makes no host call.
/// Hidden, every board node is parked again (a hidden panel still stands where it was).
fn desk_sync() {
    let on = desk_on();
    for j in 0..N_DESK {
        let h = unsafe { DESK_H[j] };
        if h == 0 {
            continue;
        }
        if j < N_DESK_TEXT {
            let n = unsafe { DESK_LEN[j] } as usize;
            if on && n > 0 {
                desk_put(j, true);
                let text = unsafe { core::str::from_utf8(&DESK_STORE[j][..n]).unwrap_or(" ") };
                unsafe {
                    if DESK_HASH[j] != 0 || NOW_S >= DESK_TEXT_RETRY_AT {
                        DESK_HASH[j] = words(h, text, DESK_HASH[j]);
                        if DESK_HASH[j] == 0 {
                            DESK_TEXT_RETRY_AT = NOW_S + DESK_TEXT_RETRY_S;
                        }
                    }
                }
            } else {
                if unsafe { DESK_HASH[j] } != 1 {
                    unsafe {
                        host::k_ui_hide_world_text(h);
                        DESK_HASH[j] = 1;
                    }
                }
                desk_put(j, false);
            }
        } else {
            if on {
                desk_put(j, true);
            }
            let want: i8 = if on { 1 } else { 0 };
            if unsafe { DESK_VIS[j] } != want {
                unsafe {
                    host::k_node_set_visible(h, on as i32);
                    DESK_VIS[j] = want;
                }
            }
            if !on {
                desk_put(j, false);
            }
        }
    }
}

/// `AB1`, the token, nothing else: no version, no press, no typed text.
fn build_desk_request() -> usize {
    let buf = unsafe { &mut *core::ptr::addr_of_mut!(REQ_BUF) };
    let mut w = Writer { buf, n: 0 };
    w.push(b"AB1\n");
    let tl = unsafe { TOKEN_LEN };
    w.push(b"tok ");
    let token = unsafe { &*core::ptr::addr_of!(TOKEN) };
    w.push(&token[..tl]);
    w.push(b"\n");
    w.n
}

fn send_desk() {
    if !signed_in() {
        return; // the board is the owner's only: never a watcher's, never before the seal
    }
    let len = build_desk_request();
    let rc = fetch(PATH_DESK, len, REQ_DESK);
    unsafe {
        if rc == 0 {
            DESK_IN_FLIGHT = true;
            DESK_NEXT_AT = NOW_S + DESK_POLL_S;
        } else {
            DESK_NEXT_AT = NOW_S + RETRY_GAP_S;
        }
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
#[allow(static_mut_refs)]
mod tests;
