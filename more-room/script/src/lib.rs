//! More Room — the day around you (`world://more-room.micknerks`, VR, and
//! `world://more-room-mr.micknerks`, MR). One script for both.
//!
//! @kosmos-system  Content (KosmosWorlds) — More Room
//! @kosmos-owner   More Room v2, the Day Ring (CEO 2026-10-19: "Take ... the Day Ring forward")
//! @kosmos-level   host API level 4 (`k_net_*`), level 3 (`k_node_clone`, `k_node_destroy`, `k_log`)
//!
//! What a phone crams into one rectangle, given a place around you, live.
//! The rule of the room: **everything has a place, and nothing jumps in front
//! of you; it lands where it lives.**
//!
//! - **The Day Ring.** The day is a ring of time around you at eye height,
//!   2.4 m out. Now is always straight ahead, at the amber now bar; the next
//!   hours wait to your right and the morning fades to your left. The whole
//!   ring turns as time passes, a little every frame. Press an event for its prep.
//! - **Messages land, they don't pop.** A new message drops onto the low arc
//!   in front of you, face-down. A VIP's card has an amber rim and makes one
//!   tick. What doesn't fit waits in the inbox well behind the arc.
//! - **Four modes**, on the column of pucks to your left:
//!   - Morning: the brief on the stage, pinned tasks on the right;
//!   - Focus: the room closes in (16 dark facets slide in to 1.95 m) around one
//!     task and its timer; the next event is the only other thing you see;
//!   - Triage: the cards rise and fan out face-up at reading height. Press one
//!     to read it, then Done, Later, Reply ("Claude drafts reply"), Task (a
//!     Linear ticket) or Mute (to the quiet shelf behind you). A draft waits on
//!     the right for Approve or Deny: nothing is sent without that press;
//!   - Wrap-up: what got done, and what rolls to tomorrow.
//!
//! **The room opens on a built-in sample day** (sample_day.txt, baked from the
//! bridge face's sample-day.ts by tools/gen_sample.mjs), with a banner on every
//! mode, so it is full without a PC, a bridge or a sign-in; presses then act on
//! the sample locally and send nothing. "Owner sign in" switches to the bridge.
//!
//! The brain is the bridge on the owner's PC (the shared agent bridge,
//! agent-bridge/src/faces/more-room/day-core.ts). This world only draws what
//! the face says and sends the presses. It polls "what changed since N" every
//! `POLL_S` seconds.
//!
//! Host limits this file is built around (each checked by tests or by
//! ../../tools/mock-host.mjs):
//! - at most 32 world texts at once, each at most 128 bytes and 4 lines; the
//!   per-mode budget is in ../../DESIGN.md;
//! - at most 128 created objects and 16 creates a frame (`CREATES_PER_TICK`);
//! - requests at most 16 KiB, answers at most 256 KiB, text only;
//!   4 in flight, 1 a second with bursts of 10;
//! - no `player_read` (a network world may not have it), so nothing here
//!   knows where the visitor's head or hands are: everything sits at fixed
//!   spots around the spawn, which in MR is where the visitor stands;
//! - nothing is rotated at runtime (`k_transform_set_rotation` replaces a
//!   node's relative rotation in raw engine degrees): what moves is round
//!   about the vertical, and what is flat is built facing the spawn;
//! - `k_node_find` sees only meshes; clone names may not end in a digit.
//!
//! Text placement and state colours each have ONE home, `style.rs`, so the
//! visual pack (DB-045) can drop styled text and runtime colours in later.

#![cfg_attr(target_arch = "wasm32", no_std, no_main)]

pub mod layout;
pub mod model;
pub mod style;
pub mod text;

use layout as L;
use model::{Day, Pile, Prep, TaskState};
use style::{Place, Tone};
use text::{Buf, Lines, S};

#[cfg(all(target_arch = "wasm32", not(test)))]
#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

// ---------------------------------------------------------------------------
// Host imports (module "kosmos"). Signatures: host-api-levels.json at publisher
// main fced9cf (level 4).
// ---------------------------------------------------------------------------

#[cfg(target_arch = "wasm32")]
mod host {
    #[link(wasm_import_module = "kosmos")]
    extern "C" {
        pub fn k_node_find(name_ptr: i32, name_len: i32) -> i32;
        pub fn k_node_set_visible(node: i32, visible: i32) -> i32;
        /// level 3: a copy of a mesh node; -5 a cap reached, -6 the per-frame limit.
        pub fn k_node_clone(src: i32, parent: i32, name_ptr: i32, name_len: i32) -> i32;
        pub fn k_node_destroy(node: i32) -> i32;
        pub fn k_transform_set_position(node: i32, x: f32, y: f32, z: f32) -> i32;
        pub fn k_ui_show_world_text(node: i32, text_ptr: i32, text_len: i32, offset_y: f32) -> i32;
        pub fn k_ui_hide_world_text(node: i32) -> i32;
        pub fn k_ui_prompt(prompt_ptr: i32, prompt_len: i32, out_ptr: i32, out_cap: i32, request_id: i32) -> i32;
        pub fn k_event_subscribe(name_ptr: i32, name_len: i32, node: i32, callback_fn_index: i32) -> i32;
        pub fn k_event_subscribe_global(name_ptr: i32, name_len: i32, callback_fn_index: i32) -> i32;
        pub fn k_event_unsubscribe(subscription: i32) -> i32;
        pub fn k_audio_play(node: i32, name_ptr: i32, name_len: i32) -> i32;
        pub fn k_net_fetch(method: i32, url_ptr: i32, url_len: i32, body_ptr: i32, body_len: i32, flags: i32, request_id: i32) -> i32;
        pub fn k_net_read(request_id: i32, out_ptr: i32, out_cap: i32) -> i32;
        pub fn k_net_status() -> i32;
        /// level 3: the creator console; never leaves the device.
        pub fn k_log(level: i32, ptr: i32, len: i32) -> i32;
    }
}

/// Host-side stand-ins so `cargo test` links: no host, nothing found, network off.
#[cfg(not(target_arch = "wasm32"))]
#[allow(clippy::too_many_arguments)]
mod host {
    pub unsafe fn k_node_find(_p: i32, _l: i32) -> i32 { 0 }
    pub unsafe fn k_node_set_visible(_n: i32, _v: i32) -> i32 { 0 }
    pub unsafe fn k_node_clone(_s: i32, _p: i32, _n: i32, _l: i32) -> i32 { -1 }
    pub unsafe fn k_node_destroy(_n: i32) -> i32 { 0 }
    pub unsafe fn k_transform_set_position(_n: i32, _x: f32, _y: f32, _z: f32) -> i32 { 0 }
    pub unsafe fn k_ui_show_world_text(_n: i32, _p: i32, _l: i32, _o: f32) -> i32 { 0 }
    pub unsafe fn k_ui_hide_world_text(_n: i32) -> i32 { 0 }
    pub unsafe fn k_ui_prompt(_p: i32, _l: i32, _o: i32, _c: i32, _r: i32) -> i32 { -2 }
    pub unsafe fn k_event_subscribe(_p: i32, _l: i32, _n: i32, _c: i32) -> i32 { 0 }
    pub unsafe fn k_event_subscribe_global(_p: i32, _l: i32, _c: i32) -> i32 { 0 }
    pub unsafe fn k_event_unsubscribe(_s: i32) -> i32 { 0 }
    pub unsafe fn k_audio_play(_n: i32, _p: i32, _l: i32) -> i32 { 0 }
    pub unsafe fn k_net_fetch(_m: i32, _u: i32, _ul: i32, _b: i32, _bl: i32, _f: i32, _r: i32) -> i32 { -2 }
    pub unsafe fn k_net_read(_r: i32, _o: i32, _c: i32) -> i32 { -7 }
    pub unsafe fn k_net_status() -> i32 { 0 }
    pub unsafe fn k_log(_lv: i32, _p: i32, _l: i32) -> i32 { 0 }
}

// ---------------------------------------------------------------------------
// Contract constants
// ---------------------------------------------------------------------------

/// The one origin this world calls: the shared agent bridge's front door, the
/// relay Worker Mission Control runs (KosmosWorlds agent-bridge/API.md §1). It
/// answers the opt-in file itself, so the registry's weekly check passes while
/// the PC sleeps, and relays POST /v1/* to the PC. Mirrors manifest.json
/// `network.connect`.
pub const ORIGIN: &str = "https://kosmos-agent-bridge.micknerks.workers.dev";
/// More Room's face on that bridge (agent-bridge/src/faces/more-room/).
const PATH_SESSION: &str = "/v1/faces/more-room/signin";
const PATH_CHANGES: &str = "/v1/faces/more-room/changes";
const PATH_ACT: &str = "/v1/faces/more-room/act";
const PATH_PREP: &str = "/v1/faces/more-room/prep";

const METHOD_POST: i32 = 1;
/// `flags` bit 1: the body is JSON.
const FLAG_JSON: i32 = 1 << 1;

/// "What changed since N" every this many seconds (1 a second is the host's
/// sustained limit; this leaves room for presses).
pub const POLL_S: f32 = 4.0;
/// The host allows 4 requests in flight; the room keeps one in reserve.
const MAX_IN_FLIGHT: usize = 3;
/// The host allows 16 creates a frame; the room keeps a margin.
pub const CREATES_PER_TICK: i32 = 12;
/// The host allows 32 world texts.
pub const MAX_TEXTS: usize = 32;
/// The answer buffer. A whole day is about 3 KiB; 48 messages is about 9 KiB.
const READ_BUF_BYTES: usize = 32 * 1024;
/// A focus block.
const FOCUS_S: f32 = 25.0 * 60.0;
/// How long a card takes to slide to where it lives.
const SLIDE_S: f32 = 0.45;
/// How long a new card takes to fall onto its slot.
const FALL_S: f32 = 0.7;
/// How long a fan card or the reading card takes to rise.
const RISE_S: f32 = 0.45;
/// How quickly the ring and the cocoon follow their targets (per second).
const FOLLOW_PER_S: f32 = 4.0;
/// A ring label is shown again (and so faces you again) once its event has
/// moved this far round since it was shown (degrees).
const LABEL_REFACE_DEG: f32 = 6.0;
/// How long the VIP line stays up.
const VIP_LINE_S: f32 = 90.0;
/// How long an error stays on the status line.
const STATUS_HOLD_S: f32 = 10.0;

/// The built-in sample day (DAY/1 plus PREPL and REPLY records).
const SAMPLE: &[u8] = include_bytes!("sample_day.txt");
/// At most this many Day Ring labels at once (the rest keep their pills):
/// the 32-text budget, DESIGN.md. Triage shows fewer, focus none.
pub const CAL_LABELS: usize = 5;
pub const CAL_LABELS_TRIAGE: usize = 2;
/// The fan in triage.
pub const FAN: usize = 5;
/// The About panel, one page per press of Next. Each fits 4 lines of 30 characters.
pub const ABOUT_PAGES: [&str; 7] = [
    "More Room. How much of your life do you fit in a rectangle? Here each part of your day has a place.",
    "SAMPLE DAY. Nothing here is real yet. Every name, message and task is made up.",
    "The ring is your day: now is ahead, later to your right. Morning, Focus, Triage, Wrap-up are on the left.",
    "Done files it. Later snoozes. Mute goes to the shelf behind you. Task makes a ticket. Reply drafts it.",
    "Its owner will be able to link a bridge on their PC: mail, calendar, Linear. Kosmos stores none of the mail.",
    "Going live needs steps on the owner's PC. iPhone texts cannot be read; Android would need a small app.",
    "Coming: pin these cards to your real wall. That needs the room permission sheet first.",
];

const TICK_SOUND: &str = "tick.wav";
const PROMPT_TEXT: &str = "For the room's owner: the bridge passphrase. It goes only to the owner's bridge. Wrong guesses pause sign-in here for a day.";
const REQ_PROMPT: i32 = 9001;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Mode {
    Morning,
    Focus,
    Triage,
    Wrap,
}

#[derive(Clone, Copy, PartialEq)]
enum Req {
    None,
    Session,
    Changes,
    Act,
    Prep,
}

/// One message's card in the room.
#[derive(Clone, Copy)]
struct Card {
    id: S<32>,
    node: i32,
    tone: Tone,
    /// Arc slot while in the inbox, else usize::MAX.
    slot: usize,
    pos: [f32; 3],
    from: [f32; 3],
    to: [f32; 3],
    t: f32,
    /// true: falling onto its place (a new card); false: sliding there.
    fall: bool,
    alive: bool,
    /// The OnInteract subscription, released when the card is destroyed.
    sub: i32,
}

const NO_SLOT: usize = usize::MAX;
const EMPTY_CARD: Card = Card { id: S::new(), node: 0, tone: Tone::CardRead, slot: NO_SLOT, pos: [0.0; 3], from: [0.0; 3], to: [0.0; 3], t: 1.0, fall: false, alive: false, sub: 0 };

/// One of the five face-up cards in triage's fan.
#[derive(Clone, Copy)]
struct FanCard {
    /// The message shown (its id), or empty.
    id: S<32>,
    pos: [f32; 3],
    from: [f32; 3],
    t: f32,
}

const EMPTY_FAN: FanCard = FanCard { id: S::new(), pos: [0.0; 3], from: [0.0; 3], t: 1.0 };

/// MR plates, in the order of `Nodes::plates` (mirrors PLATES in tools/build_glb.mjs).
const PLATES: [&str; 6] = ["PlateModes", "PlateActions", "PlateInbox", "PlateLater", "PlateDone", "PlateStageBtn"];
const BAND_FACETS: usize = 21;
const HOUR_TICKS: usize = 13;

#[derive(Clone, Copy)]
struct Nodes {
    mode: [i32; 4],
    sign_in: i32,
    about: i32,
    about_next: i32,
    done: i32,
    later: i32,
    reply: i32,
    task: i32,
    mute: i32,
    focus_go: i32,
    approve: i32,
    deny: i32,
    more: i32,
    prep_close: i32,
    tasks: [i32; 3],
    txt_tasks: i32,
    txt_open: i32,
    txt_draft: i32,
    txt_stage: i32,
    txt_focus: i32,
    txt_timer: i32,
    txt_status: i32,
    txt_next: i32,
    txt_window: i32,
    txt_quiet: i32,
    txt_banner: i32,
    inbox: i32,
    pile_later: i32,
    pile_done: i32,
    ticks: [i32; HOUR_TICKS],
    panes: [i32; 3],
    fan: [i32; FAN],
    fan_vip: [i32; FAN],
    cocoon: [i32; L::COCOON_FACETS],
    /// MR only (absent in VR): dark plates behind floating text, see PLATES.
    plates: [i32; PLATES.len()],
    band: [i32; BAND_FACETS],
    /// One template per `style::Tone`, in `style::TONES` order.
    tpl: [i32; style::TONES.len()],
    mr: bool,
}

pub struct App {
    n: Nodes,
    mode: Mode,
    signed_in: bool,
    token: S<64>,
    day: Day,
    prep: Prep,
    showing_prep: bool,
    have_day: bool,
    /// Requests in flight: (request id, kind).
    reqs: [(i32, Req); 8],
    next_req: i32,
    poll_s: f32,
    status_hold_s: f32,
    since_update_s: f32,
    status_refresh_s: f32,
    now_s: f32,
    cards: [Card; model::MAX_MSGS],
    events: [i32; model::MAX_EVENTS],
    event_subs: [i32; model::MAX_EVENTS],
    event_tone: [Tone; model::MAX_EVENTS],
    /// Where each event's ring label was when it was shown (NaN: no label).
    label_deg: [f32; model::MAX_EVENTS],
    n_event_nodes: usize,
    /// The ring's "now", in fractional minutes: it follows the day's clock smoothly.
    ring_now: f32,
    /// Where the ring was last placed, and whether it must be placed again anyway.
    ring_placed: f32,
    ring_force: bool,
    /// What the ring last showed, so visibility is only set when it changes.
    tick_vis: [bool; HOUR_TICKS],
    event_vis: [bool; model::MAX_EVENTS],
    cocoon_shown: bool,
    fan: [FanCard; FAN],
    /// The reading card's rise (0..1), and the message it shows.
    read_t: f32,
    read_shown: Option<usize>,
    /// The cocoon facets' distance from the spawn.
    cocoon_r: f32,
    clone_seq: u32,
    creates_this_tick: i32,
    dirty: bool,
    /// A first day that hit the per-frame create limit: its next pass is still "first"
    /// (cards appear in place, nothing falls or ticks).
    first_pending: bool,
    open: Option<usize>,
    /// The About panel's page, when it is open.
    about: Option<usize>,
    /// The sample's clock: one minute per minute in the room.
    sample_clock_s: f32,
    /// Numbers the sample's local drafts, so a redraft never shares an id.
    sample_seq: i32,
    draft_page: usize,
    focus_task: Option<usize>,
    focus_left_s: f32,
    focus_running: bool,
    vip_s: f32,
    /// Who the VIP line names, while it shows (it rides on the banner).
    vip_from: S<24>,
    /// Which card is up in front (the reading card or a draft), as its node.
    read_node: i32,
    texts: [i32; MAX_TEXTS],
    /// The offset each held text was SHOWN with: the client keeps it when only the words change.
    text_off: [f32; MAX_TEXTS],
    n_texts: usize,
    text_refused: i32,
    last_net: i32,
}

const NO_NODES: Nodes = Nodes {
    mode: [0; 4],
    sign_in: 0,
    about: 0,
    about_next: 0,
    done: 0,
    later: 0,
    reply: 0,
    task: 0,
    mute: 0,
    focus_go: 0,
    approve: 0,
    deny: 0,
    more: 0,
    prep_close: 0,
    tasks: [0; 3],
    txt_tasks: 0,
    txt_open: 0,
    txt_draft: 0,
    txt_stage: 0,
    txt_focus: 0,
    txt_timer: 0,
    txt_status: 0,
    txt_next: 0,
    txt_window: 0,
    txt_quiet: 0,
    txt_banner: 0,
    inbox: 0,
    pile_later: 0,
    pile_done: 0,
    ticks: [0; HOUR_TICKS],
    panes: [0; 3],
    fan: [0; FAN],
    fan_vip: [0; FAN],
    cocoon: [0; L::COCOON_FACETS],
    plates: [0; PLATES.len()],
    band: [0; BAND_FACETS],
    tpl: [0; style::TONES.len()],
    mr: false,
};

static mut APP: App = App {
    n: NO_NODES,
    mode: Mode::Morning,
    signed_in: false,
    token: S::new(),
    day: Day::new(),
    prep: Prep::new(),
    showing_prep: false,
    have_day: false,
    reqs: [(0, Req::None); 8],
    next_req: 1,
    poll_s: 0.0,
    status_hold_s: 0.0,
    since_update_s: 0.0,
    status_refresh_s: 0.0,
    now_s: 0.0,
    cards: [EMPTY_CARD; model::MAX_MSGS],
    events: [0; model::MAX_EVENTS],
    event_subs: [0; model::MAX_EVENTS],
    event_tone: [Tone::EventFuture; model::MAX_EVENTS],
    label_deg: [f32::NAN; model::MAX_EVENTS],
    n_event_nodes: 0,
    ring_now: -1.0,
    ring_placed: -1.0e9,
    ring_force: true,
    tick_vis: [true; HOUR_TICKS],
    event_vis: [true; model::MAX_EVENTS],
    cocoon_shown: false,
    fan: [EMPTY_FAN; FAN],
    read_t: 1.0,
    read_shown: None,
    cocoon_r: L::COCOON_FROM_R,
    clone_seq: 0,
    creates_this_tick: 0,
    dirty: false,
    first_pending: false,
    open: None,
    about: None,
    sample_clock_s: 0.0,
    sample_seq: 0,
    draft_page: 0,
    focus_task: None,
    focus_left_s: FOCUS_S,
    focus_running: false,
    vip_s: 0.0,
    vip_from: S::new(),
    read_node: 0,
    texts: [0; MAX_TEXTS],
    text_off: [0.0; MAX_TEXTS],
    n_texts: 0,
    text_refused: 0,
    last_net: -1,
};

static mut READ_BUF: [u8; READ_BUF_BYTES] = [0; READ_BUF_BYTES];
/// Where a live answer is read before it replaces the day (see Req::Changes).
static mut SCRATCH_DAY: Day = Day::new();
/// The host writes the passphrase here LATER; it is wiped as soon as it is sent.
static mut PROMPT_BUF: [u8; 256] = [0; 256];
static mut REQ_BODY: Buf<1024> = Buf::new();

#[allow(static_mut_refs)]
fn app() -> &'static mut App {
    // Single-threaded world wasm: one App, reached only from host callbacks.
    unsafe { &mut *core::ptr::addr_of_mut!(APP) }
}

// ---------------------------------------------------------------------------
// Small host wrappers
// ---------------------------------------------------------------------------

fn find(name: &str) -> i32 {
    unsafe { host::k_node_find(name.as_ptr() as i32, name.len() as i32) }
}

fn visible(node: i32, on: bool) {
    if node > 0 {
        unsafe { host::k_node_set_visible(node, on as i32) };
    }
}

fn place(node: i32, p: [f32; 3]) {
    if node > 0 {
        unsafe { host::k_transform_set_position(node, p[0], p[1], p[2]) };
    }
}

fn log(msg: &str) {
    unsafe { host::k_log(2, msg.as_ptr() as i32, msg.len() as i32) };
}

/// Subscribe a node's press; returns the subscription id (0 = failed).
fn subscribe_press(node: i32) -> i32 {
    if node <= 0 {
        return 0;
    }
    let ev = "OnInteract";
    unsafe { host::k_event_subscribe(ev.as_ptr() as i32, ev.len() as i32, node, on_press as usize as i32) }
}

fn unsubscribe(sub: i32) {
    if sub > 0 {
        unsafe { host::k_event_unsubscribe(sub) };
    }
}

/// Show or hide a node only when that changes (`was` remembers).
fn set_vis(node: i32, was: &mut bool, on: bool) {
    if *was != on {
        *was = on;
        visible(node, on);
    }
}

/// Ease in and out (0..1 -> 0..1).
fn smooth(t: f32) -> f32 {
    t * t * (3.0 - 2.0 * t)
}

fn lerp3(a: [f32; 3], b: [f32; 3], e: f32) -> [f32; 3] {
    [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e]
}

fn lines_in(s: &[u8]) -> usize {
    1 + s.iter().filter(|&&c| c == b'\n').count()
}

impl App {
    // --- world text, within the host's 32 -----------------------------------

    /// THE one place text is put in the room: `place` decides where it sits on
    /// its anchor (style::offset). The visual pack will style it here.
    fn say(&mut self, node: i32, s: &[u8], place: Place) {
        let off = style::offset(place, lines_in(s));
        self.text(node, s, off);
    }

    fn say_str(&mut self, node: i32, s: &str, place: Place) {
        self.say(node, s.as_bytes(), place);
    }

    fn text(&mut self, node: i32, s: &[u8], offset_y: f32) {
        if node <= 0 || s.is_empty() {
            self.untext(node);
            return;
        }
        // The client keeps a held text's first placement (and offset) when only its words
        // change (KWorldTextPool.cpp): a new offset needs the text hidden and shown again
        // (review v2, lens A, MED-2).
        if let Some(i) = self.texts[..self.n_texts].iter().position(|&x| x == node) {
            if (self.text_off[i] - offset_y).abs() > 1e-4 {
                self.untext(node);
            }
        }
        let held = self.texts[..self.n_texts].contains(&node);
        if !held && self.n_texts >= MAX_TEXTS {
            // Never ask the host for a 33rd text; the budget in DESIGN.md keeps this at 0.
            self.text_refused += 1;
            return;
        }
        let rc = unsafe { host::k_ui_show_world_text(node, s.as_ptr() as i32, s.len() as i32, offset_y) };
        if rc == 0 && !held {
            self.texts[self.n_texts] = node;
            self.text_off[self.n_texts] = offset_y;
            self.n_texts += 1;
        } else if rc != 0 {
            self.text_refused += 1;
        }
    }

    fn untext(&mut self, node: i32) {
        if node <= 0 {
            return;
        }
        if let Some(i) = self.texts[..self.n_texts].iter().position(|&x| x == node) {
            unsafe { host::k_ui_hide_world_text(node) };
            self.n_texts -= 1;
            self.texts[i] = self.texts[self.n_texts];
            self.text_off[i] = self.text_off[self.n_texts];
            self.texts[self.n_texts] = 0;
        }
    }

    fn held(&self, node: i32) -> bool {
        node > 0 && self.texts[..self.n_texts].contains(&node)
    }

    // --- clones --------------------------------------------------------------

    fn clone_of(&mut self, tpl: i32) -> i32 {
        if tpl <= 0 {
            return 0;
        }
        if self.creates_this_tick >= CREATES_PER_TICK {
            self.dirty = true;
            return 0;
        }
        // A unique name with no digits (the client strips trailing digits).
        let mut name: Buf<16> = Buf::new();
        name.push("MrC");
        let mut v = self.clone_seq;
        self.clone_seq += 1;
        for _ in 0..5 {
            name.byte(b'a' + (v % 26) as u8);
            v /= 26;
        }
        self.creates_this_tick += 1;
        let h = unsafe { host::k_node_clone(tpl, 0, name.b.as_ptr() as i32, name.n as i32) };
        if h > 0 {
            visible(h, true);
            h
        } else {
            if h == -6 {
                self.dirty = true;
            }
            0
        }
    }

    /// A clone of the template that wears `tone`.
    fn clone_tone(&mut self, tone: Tone) -> i32 {
        let tpl = self.n.tpl[style::tone_index(tone)];
        self.clone_of(tpl)
    }

    fn destroy(&mut self, node: i32, sub: i32) {
        unsubscribe(sub);
        if node > 0 {
            self.untext(node);
            unsafe { host::k_node_destroy(node) };
        }
    }

    // --- status --------------------------------------------------------------

    /// A status message, under the mode column (where Owner sign in is).
    fn status(&mut self, s: &str, hold: bool) {
        let n = self.n.txt_status;
        let mut l = Lines::new(26, 2);
        l.text(s);
        self.say(n, l.as_bytes(), Place::Float);
        if hold {
            self.status_hold_s = STATUS_HOLD_S;
        }
    }

    fn live_status(&mut self) {
        if self.status_hold_s > 0.0 {
            return;
        }
        let mut b: Buf<64> = Buf::new();
        if self.mode == Mode::Triage && self.open.is_none() && self.about.is_none() {
            b.push("Press a card in the fan to read it.");
        } else if !self.signed_in {
            b.push("Sample day. Only the owner can sign in.");
        } else if unsafe { host::k_net_status() } != 1 {
            b.push("Network is off for this world");
        } else {
            b.push("Live. Updated ");
            b.int(self.since_update_s as i32);
            b.push(" s ago");
        }
        let s = b.as_str();
        let mut l = Lines::new(26, 2);
        l.text(s);
        let node = self.n.txt_status;
        self.say(node, l.as_bytes(), Place::Float);
    }

    /// "Now" for the ring: the day's clock plus the time since it was read.
    fn clock_now(&self) -> f32 {
        let extra = if self.signed_in { (self.since_update_s / 60.0).min(2.0) } else { self.sample_clock_s / 60.0 };
        self.day.now_min as f32 + extra
    }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

fn find_letters<const N: usize>(prefix: &str) -> [i32; N] {
    let mut out = [0; N];
    for (k, slot) in out.iter_mut().enumerate() {
        let mut b: Buf<24> = Buf::new();
        b.push(prefix);
        b.byte(b'A' + k as u8);
        *slot = find(b.as_str());
    }
    out
}

#[no_mangle]
pub extern "C" fn k_init() {
    let a = app();
    let n = &mut a.n;
    n.mode = [find("BtnModeMorning"), find("BtnModeFocus"), find("BtnModeTriage"), find("BtnModeWrap")];
    n.sign_in = find("BtnSignIn");
    n.about = find("BtnAbout");
    n.about_next = find("BtnAboutNext");
    n.done = find("BtnDone");
    n.later = find("BtnLater");
    n.reply = find("BtnReply");
    n.task = find("BtnTask");
    n.mute = find("BtnMute");
    n.focus_go = find("BtnFocusGo");
    n.approve = find("BtnApprove");
    n.deny = find("BtnDeny");
    n.more = find("BtnMore");
    n.prep_close = find("BtnPrepClose");
    n.tasks = [find("TaskA"), find("TaskB"), find("TaskC")];
    n.txt_tasks = find("TxtTasks");
    n.txt_open = find("TxtOpen");
    n.txt_draft = find("TxtDraft");
    n.txt_stage = find("TxtStage");
    n.txt_focus = find("TxtFocus");
    n.txt_timer = find("TxtTimer");
    n.txt_status = find("TxtStatus");
    n.txt_next = find("TxtNext");
    n.txt_window = find("TxtWindow");
    n.txt_quiet = find("TxtQuiet");
    n.txt_banner = find("TxtBanner");
    n.inbox = find("InboxWell");
    n.pile_later = find("PileLater");
    n.pile_done = find("PileDone");
    n.ticks = find_letters::<HOUR_TICKS>("HourTick");
    n.panes = [find("PaneDay"), find("PaneDusk"), find("PaneNight")];
    n.fan = find_letters::<FAN>("Fan");
    n.fan_vip = find_letters::<FAN>("FanVip");
    n.cocoon = find_letters::<{ L::COCOON_FACETS }>("Cocoon");
    for (k, name) in PLATES.iter().enumerate() {
        n.plates[k] = find(name);
    }
    n.band = find_letters::<BAND_FACETS>("RingBand");
    for (k, &t) in style::TONES.iter().enumerate() {
        n.tpl[k] = find(style::template(t));
    }
    n.mr = find("VariantMr") > 0;

    let presses = [
        n.mode[0], n.mode[1], n.mode[2], n.mode[3], n.sign_in, n.done, n.later, n.reply, n.task, n.mute, n.focus_go, n.approve, n.deny, n.more,
        n.prep_close, n.tasks[0], n.tasks[1], n.tasks[2], n.about, n.about_next,
    ];
    for node in presses {
        subscribe_press(node);
    }
    for node in n.fan {
        subscribe_press(node);
    }
    // Templates stay hidden; clones are shown as they are made. So do the
    // things that rise or close in only when their mode calls for them.
    for t in n.tpl {
        visible(t, false);
    }
    for k in 0..FAN {
        visible(n.fan[k], false);
        visible(n.fan_vip[k], false);
    }
    for c in n.cocoon {
        visible(c, false);
    }
    for b in n.band {
        visible(b, false);
    }
    let ev = "OnNetResult";
    unsafe { host::k_event_subscribe_global(ev.as_ptr() as i32, ev.len() as i32, on_net_result as usize as i32) };
    let ev = "OnPromptResult";
    unsafe { host::k_event_subscribe_global(ev.as_ptr() as i32, ev.len() as i32, on_prompt_result as usize as i32) };
    log("[more-room] init");
    load_sample(true);
    render();
}

/// Fill the room with the built-in sample day (at load, and when the bridge signs the room out).
fn load_sample(first: bool) {
    let a = app();
    if model::read_day(SAMPLE, &mut a.day) {
        a.have_day = true;
        a.open = None;
        a.showing_prep = false;
        a.focus_task = None;
        reconcile(first);
    }
}

#[no_mangle]
pub extern "C" fn k_tick(delta: f32) {
    let a = app();
    let dt = if delta.is_finite() && delta > 0.0 { delta.min(0.25) } else { 0.0 };
    a.creates_this_tick = 0;
    a.now_s += dt;
    a.since_update_s += dt;
    if a.status_hold_s > 0.0 {
        a.status_hold_s -= dt;
        if a.status_hold_s <= 0.0 {
            a.live_status(); // the held message has been read; say how things are now
        }
    }

    // The sample's clock: a minute a minute. Events change colour as the day passes.
    if !a.signed_in {
        a.sample_clock_s += dt;
        if a.sample_clock_s >= 60.0 {
            a.sample_clock_s -= 60.0;
            a.day.now_min += 1;
            event_nodes();
        }
    }

    // Poll "what changed since N".
    if a.signed_in {
        a.poll_s += dt;
        if a.poll_s >= POLL_S && !a.in_flight(Req::Changes) {
            a.poll_s = 0.0;
            poll();
        }
    }

    // The Day Ring turns: its "now" follows the clock, and every pill and tick
    // moves with it, every frame.
    turn_ring(dt);

    // Cards fall or slide to where they live.
    for i in 0..a.cards.len() {
        let c = &mut a.cards[i];
        if !c.alive || c.node <= 0 || c.t >= 1.0 {
            continue;
        }
        if c.fall {
            // Falling: gathering speed, then a small settle.
            c.t = (c.t + dt / FALL_S).min(1.0);
            let e = if c.t < 0.85 { let u = c.t / 0.85; u * u } else { 1.0 - 0.03 * smooth((c.t - 0.85) / 0.15) * (1.0 - (c.t - 0.85) / 0.15) };
            c.pos = lerp3(c.from, c.to, e.min(1.0));
        } else {
            c.t = (c.t + dt / SLIDE_S).min(1.0);
            let e = smooth(c.t);
            let lift = 0.08 * 4.0 * e * (1.0 - e);
            c.pos = lerp3(c.from, c.to, e);
            c.pos[1] += lift;
        }
        place(c.node, c.pos);
    }

    // The fan's cards rise to reading height; the reading card rises in front.
    for k in 0..FAN {
        let f = &mut a.fan[k];
        if f.id.is_empty() || f.t >= 1.0 {
            continue;
        }
        f.t = (f.t + dt / RISE_S).min(1.0);
        let to = L::fan_at(k, L::FAN_Y);
        f.pos = lerp3(f.from, to, 1.0 - (1.0 - f.t) * (1.0 - f.t));
        place(a.n.fan[k], f.pos);
        place(a.n.fan_vip[k], [f.pos[0] * (L::FAN_R + 0.012) / L::FAN_R, f.pos[1], f.pos[2] * (L::FAN_R + 0.012) / L::FAN_R]);
    }
    if a.read_t < 1.0 {
        a.read_t = (a.read_t + dt / RISE_S).min(1.0);
        let e = 1.0 - (1.0 - a.read_t) * (1.0 - a.read_t);
        place(a.read_node, L::at(L::READ_R, 0.0, L::RISE_FROM_Y + (L::READ_Y - L::RISE_FROM_Y) * e));
    }

    // Focus: the cocoon's facets close in, or open out and hide.
    close_in(dt);

    // The focus timer.
    if a.mode == Mode::Focus && a.focus_running {
        let before_s = a.focus_left_s as i32;
        a.focus_left_s -= dt;
        if a.focus_left_s <= 0.0 {
            a.focus_left_s = 0.0;
            a.focus_running = false;
            tick_sound();
            render();
        } else if a.focus_left_s as i32 != before_s {
            show_timer();
        }
    }

    // The VIP line fades out after a while.
    if a.vip_s > 0.0 {
        a.vip_s -= dt;
        if a.vip_s <= 0.0 {
            banner();
            show_plates();
        }
    }

    // A reconcile that hit the per-frame create limit finishes next tick.
    if a.dirty {
        a.dirty = false;
        reconcile(false);
        render();
    }

    // Network availability can change without a press (a switch, airplane mode).
    a.status_refresh_s += dt;
    if a.status_refresh_s >= 5.0 {
        a.status_refresh_s = 0.0;
        let net = unsafe { host::k_net_status() };
        if net != a.last_net {
            a.last_net = net;
        }
        a.live_status();
    }
}

#[no_mangle]
pub extern "C" fn k_shutdown() {
    // Nothing is kept: the session token lives in memory for this visit only.
    let a = app();
    a.token = S::new();
    a.signed_in = false;
}

/// Turn the Day Ring to the clock: pills, hour ticks and their labels.
fn turn_ring(dt: f32) {
    let a = app();
    let mut target = a.clock_now();
    // A poll's whole-minute clock lands a hair behind the smooth one: never step back by
    // a little (a 0.25 Hz jitter otherwise), only by a real change (review v2, lens A, LOW-5).
    if target < a.ring_now && a.ring_now - target < 2.0 {
        target = a.ring_now;
    }
    if a.ring_now < 0.0 || (target - a.ring_now).abs() > 120.0 {
        a.ring_now = target; // the first day, or a jump: no long spin
    } else {
        a.ring_now += (target - a.ring_now) * (dt * FOLLOW_PER_S).min(1.0);
    }
    let now = a.ring_now;
    if !a.ring_force && (now - a.ring_placed).abs() < 0.002 {
        return; // nothing has moved since the last frame
    }
    a.ring_force = false;
    a.ring_placed = now;
    for (k, &node) in a.n.ticks.iter().enumerate() {
        let deg = L::ring_deg((L::RING_FIRST_MIN + k as i32 * 60) as f32, now);
        let shown = deg.abs() <= L::RING_SHOW_DEG;
        set_vis(node, &mut a.tick_vis[k], shown);
        if shown {
            place(node, L::ring_at(deg));
        }
    }
    let mut reface = false;
    for e in 0..a.n_event_nodes.min(a.day.n_events) {
        let deg = L::ring_deg(a.day.events[e].start as f32, now);
        let node = a.events[e];
        let shown = deg.abs() <= L::RING_SHOW_DEG && a.mode != Mode::Focus;
        set_vis(node, &mut a.event_vis[e], shown);
        if shown {
            place(node, L::ring_at(deg));
        }
        let ld = a.label_deg[e];
        if !ld.is_nan() && (deg - ld).abs() > LABEL_REFACE_DEG {
            reface = true;
        }
    }
    if reface {
        ring_labels(true);
        show_plates();
    }
}

/// Focus: move the cocoon's facets toward where the mode wants them.
fn close_in(dt: f32) {
    let a = app();
    let want_in = a.mode == Mode::Focus && a.about.is_none();
    let target = if want_in { L::COCOON_R } else { L::COCOON_FROM_R };
    if (a.cocoon_r - target).abs() < 0.002 {
        if !want_in && a.cocoon_shown {
            a.cocoon_shown = false;
            for c in a.n.cocoon {
                visible(c, false);
            }
        }
        return;
    }
    a.cocoon_r += (target - a.cocoon_r) * (dt * FOLLOW_PER_S * 1.5).min(1.0);
    if (a.cocoon_r - target).abs() < 0.002 {
        a.cocoon_r = target;
    }
    if !a.cocoon_shown {
        a.cocoon_shown = true;
        for c in a.n.cocoon {
            visible(c, true);
        }
    }
    for (k, &c) in a.n.cocoon.iter().enumerate() {
        place(c, L::cocoon_at(k, a.cocoon_r));
    }
}

// ---------------------------------------------------------------------------
// Presses
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn on_press(_event_type: i32, node: i32, _p1: i32, _p2: i32) {
    let a = app();
    if node <= 0 {
        return;
    }
    let n = a.n;
    if node == n.sign_in {
        sign_in();
        return;
    }
    if node == n.about {
        a.about = if a.about.is_some() { None } else { Some(0) };
        a.showing_prep = false;
        render();
        return;
    }
    if node == n.about_next {
        a.about = Some(a.about.map_or(0, |p| (p + 1) % ABOUT_PAGES.len()));
        render();
        return;
    }
    if let Some(m) = n.mode.iter().position(|&x| x == node) {
        a.mode = [Mode::Morning, Mode::Focus, Mode::Triage, Mode::Wrap][m];
        a.showing_prep = false;
        a.about = None;
        if a.mode != Mode::Triage {
            a.open = None;
        }
        render();
        return;
    }
    if node == n.focus_go {
        if a.focus_left_s <= 0.0 {
            a.focus_left_s = FOCUS_S;
        }
        a.focus_running = !a.focus_running;
        render();
        return;
    }
    if node == n.prep_close {
        a.showing_prep = false;
        render();
        return;
    }
    if let Some(t) = n.tasks.iter().position(|&x| x == node) {
        press_task(t);
        return;
    }
    if node == n.approve || node == n.deny {
        if let Some(d) = a.day.pending_draft() {
            let id = a.day.drafts[d].id;
            let signed_in = a.signed_in;
            act(if node == n.approve { "approve" } else { "deny" }, id.bytes());
            if signed_in {
                let msg = if node == n.approve { "Approved. The bridge sends it." } else { "Draft discarded." };
                a.status(msg, true);
            }
        }
        return;
    }
    if node == n.more {
        a.draft_page += 1;
        render();
        return;
    }
    let actions = [(n.done, "done"), (n.later, "later"), (n.reply, "draft"), (n.task, "task"), (n.mute, "quiet")];
    if let Some(&(_, op)) = actions.iter().find(|(x, _)| *x == node) {
        press_action(op);
        return;
    }
    // A card in the fan?
    if let Some(k) = n.fan.iter().position(|&x| x == node) {
        let id = a.fan[k].id;
        if let Some(m) = a.day.msg_index(id.bytes()) {
            open_msg(m);
        }
        return;
    }
    // A card on the arc?
    if let Some(i) = (0..a.cards.len()).find(|&i| a.cards[i].alive && a.cards[i].node == node) {
        press_card(i);
        return;
    }
    // An event pill?
    if let Some(e) = (0..a.n_event_nodes).find(|&e| a.events[e] == node) {
        if e < a.day.n_events && a.mode != Mode::Focus {
            if a.signed_in {
                let id = a.day.events[e].id;
                prep(id.bytes());
            } else {
                // The sample carries its prep with it.
                let ev = a.day.events[e];
                a.prep.event = ev.id;
                a.prep.n = ev.n_prep;
                a.prep.lines = ev.prep;
                a.showing_prep = ev.n_prep > 0;
                a.about = None;
                if a.mode == Mode::Triage {
                    a.mode = Mode::Morning; // prep shows on the stage
                }
                render();
            }
        }
    }
}

fn press_card(card: usize) {
    let a = app();
    if a.mode == Mode::Focus {
        return; // focus means focus: the arc is hidden and does not answer
    }
    let id = a.cards[card].id;
    let Some(m) = a.day.msg_index(id.bytes()) else { return };
    open_msg(m);
}

/// Read a message: triage, with it on the reading card.
fn open_msg(m: usize) {
    let a = app();
    if m >= a.day.n_msgs || a.day.msgs[m].pile != Pile::In {
        return;
    }
    a.mode = Mode::Triage;
    a.showing_prep = false;
    a.about = None;
    a.open = Some(m);
    if !a.day.msgs[m].read {
        let id = a.day.msgs[m].id;
        a.day.msgs[m].read = true; // turned over now; the bridge confirms on the next poll
        act("turn", id.bytes());
        reconcile(false);
    }
    render();
}

fn press_action(op: &'static str) {
    let a = app();
    let Some(m) = a.open else {
        a.status("Press a card to read it first.", true);
        return;
    };
    if m >= a.day.n_msgs {
        return;
    }
    let id = a.day.msgs[m].id;
    act(op, id.bytes());
    // Show the move at once; the next poll is the truth.
    match op {
        "done" => a.day.msgs[m].pile = Pile::Done,
        "later" => a.day.msgs[m].pile = Pile::Later,
        "quiet" => a.day.msgs[m].pile = Pile::Quiet,
        _ => {}
    }
    match op {
        "done" | "later" | "quiet" => {
            a.open = None;
            reconcile(false);
        }
        // Signed in, the bridge answers later; in the sample, local_act already said what happened.
        "draft" if a.signed_in => a.status("Claude is drafting a reply...", true),
        "task" if a.signed_in => a.status("Making a task...", true),
        _ => {}
    }
    render();
}

fn press_task(t: usize) {
    let a = app();
    let Some(i) = shown_task(t) else { return };
    match a.mode {
        Mode::Wrap => {
            let id = a.day.tasks[i].id;
            act("roll", id.bytes());
            a.day.tasks[i].state = TaskState::Rolled;
            a.status("Rolled to tomorrow.", true);
        }
        _ => {
            a.focus_task = Some(i);
            a.focus_left_s = FOCUS_S;
            a.focus_running = false;
            a.mode = Mode::Focus;
            a.showing_prep = false;
        }
    }
    render();
}

/// The model index of the task shown on tile `t` in the current mode.
fn shown_task(t: usize) -> Option<usize> {
    let a = app();
    let mut k = 0;
    for i in 0..a.day.n_tasks {
        let task = &a.day.tasks[i];
        let wanted = match a.mode {
            Mode::Wrap => task.state == TaskState::Open || task.state == TaskState::Doing,
            _ => task.pin && (task.state == TaskState::Open || task.state == TaskState::Doing),
        };
        if wanted {
            if k == t {
                return Some(i);
            }
            k += 1;
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

impl App {
    fn in_flight(&self, kind: Req) -> bool {
        self.reqs.iter().any(|&(id, k)| id != 0 && k == kind)
    }
    fn count_in_flight(&self) -> usize {
        self.reqs.iter().filter(|&&(id, _)| id != 0).count()
    }
    fn take(&mut self, id: i32) -> Req {
        for r in self.reqs.iter_mut() {
            if r.0 == id {
                let k = r.1;
                *r = (0, Req::None);
                return k;
            }
        }
        Req::None
    }
}

/// POST `body` (JSON) to `path` on the bridge. Returns false when refused at once.
fn post(path: &str, kind: Req) -> bool {
    let a = app();
    if a.count_in_flight() >= MAX_IN_FLIGHT {
        // Never keep a body we did not send: it may hold the passphrase (review lens A, LOW-2).
        body_start();
        a.status("Busy. Press again in a moment.", true);
        return false;
    }
    let mut url: Buf<128> = Buf::new();
    url.push(ORIGIN);
    url.push(path);
    let id = a.next_req;
    a.next_req = if a.next_req >= 1_000_000 { 1 } else { a.next_req + 1 };
    #[allow(static_mut_refs)]
    let body = unsafe { &mut *core::ptr::addr_of_mut!(REQ_BODY) };
    let rc = unsafe {
        host::k_net_fetch(METHOD_POST, url.b.as_ptr() as i32, url.n as i32, body.b.as_ptr() as i32, body.n as i32, FLAG_JSON, id)
    };
    // The host copied the body; the buffer may have held the passphrase.
    body.clear();
    if rc == 0 {
        if let Some(slot) = a.reqs.iter_mut().find(|r| r.0 == 0) {
            *slot = (id, kind);
        }
        true
    } else {
        let why = match rc {
            -2 => "Network is off for this world.",
            -6 => "Slow down: too many requests.",
            -8 => "Network is switched off.",
            _ => "The request was refused.",
        };
        a.status(why, true);
        false
    }
}

fn body_start() -> &'static mut Buf<1024> {
    #[allow(static_mut_refs)]
    let body = unsafe { &mut *core::ptr::addr_of_mut!(REQ_BODY) };
    body.clear();
    body
}

fn body_token(body: &mut Buf<1024>) {
    let a = app();
    body.push("{\"tok\":");
    body.json_str(a.token.bytes());
}

fn sign_in() {
    let answer_ptr = core::ptr::addr_of_mut!(PROMPT_BUF) as *mut u8 as usize as i32;
    let rc = unsafe { host::k_ui_prompt(PROMPT_TEXT.as_ptr() as i32, PROMPT_TEXT.len() as i32, answer_ptr, 256, REQ_PROMPT) };
    if rc != 0 {
        app().status("The sign-in sheet did not open. Press again.", true);
    }
}

fn poll() {
    let a = app();
    let body = body_start();
    body_token(body);
    body.push(",\"since\":");
    body.int(if a.have_day { a.day.rev } else { 0 });
    body.push("}");
    post(PATH_CHANGES, Req::Changes);
}

fn act(op: &str, id: &[u8]) {
    if !app().signed_in {
        local_act(op, id);
        return;
    }
    let body = body_start();
    body_token(body);
    body.push(",\"op\":");
    body.json_str(op.as_bytes());
    body.push(",\"id\":");
    body.json_str(id);
    body.push("}");
    if post(PATH_ACT, Req::Act) {
        // Hear the result soon.
        app().poll_s = POLL_S - 0.6;
    }
}

/// The sample's presses, done in the room itself: nothing is sent anywhere.
fn local_act(op: &str, id: &[u8]) {
    let a = app();
    match op {
        "draft" => {
            let Some(m) = a.day.msg_index(id) else { return };
            let Some(r) = a.day.reply_for(id) else { return };
            if a.day.n_drafts == model::MAX_DRAFTS {
                // Keep the newest: drop the oldest.
                for k in 1..model::MAX_DRAFTS {
                    a.day.drafts[k - 1] = a.day.drafts[k];
                }
                a.day.n_drafts -= 1;
            }
            let d = &mut a.day.drafts[a.day.n_drafts];
            let mut did: Buf<40> = Buf::new();
            a.sample_seq += 1;
            did.push("s");
            did.int(a.sample_seq);
            did.push("-");
            did.bytes(id);
            d.id.set(did.as_bytes());
            d.msg.set(id);
            d.state = model::DraftState::Pending;
            d.to = {
                let mut t: S<24> = S::new();
                t.set(a.day.msgs[m].from.bytes());
                t
            };
            d.text = a.day.replies[r].1;
            a.day.n_drafts += 1;
            a.draft_page = 0;
            a.status("Draft ready: Approve or Deny", true);
        }
        "approve" | "deny" => {
            let Some(d) = (0..a.day.n_drafts).find(|&k| a.day.drafts[k].id.eq(id) && a.day.drafts[k].state == model::DraftState::Pending) else { return };
            if op == "approve" {
                a.day.drafts[d].state = model::DraftState::Sent;
                let msg = a.day.drafts[d].msg;
                if let Some(m) = a.day.msg_index(msg.bytes()) {
                    a.day.msgs[m].pile = Pile::Done;
                    a.day.msgs[m].read = true;
                }
                a.status("Sent (sample: nothing left the room)", true);
            } else {
                a.day.drafts[d].state = model::DraftState::Denied;
                a.status("Draft discarded.", true);
            }
            a.open = None;
        }
        "task" => {
            let Some(m) = a.day.msg_index(id) else { return };
            if a.day.n_tasks < model::MAX_TASKS {
                let n = a.day.n_tasks;
                let mut key: Buf<40> = Buf::new();
                key.push("KOS-SAMPLE-");
                key.int(n as i32 + 1);
                let t = &mut a.day.tasks[n];
                t.id.set(key.as_bytes());
                t.pin = false;
                t.state = TaskState::Open;
                let mut title: Buf<64> = Buf::new();
                title.bytes(key.as_bytes());
                title.push(" ");
                title.bytes(a.day.msgs[m].subject.bytes());
                t.title.set(title.as_bytes());
                a.day.n_tasks += 1;
                let mut note: Buf<64> = Buf::new();
                note.bytes(key.as_bytes());
                note.push(" made (sample)");
                a.status(note.as_str(), true);
            } else {
                a.status("The task list is full.", true);
            }
        }
        // turn, done, later, quiet and roll already changed the day where they were pressed.
        _ => {}
    }
    reconcile(false);
    render();
}

fn prep(event: &[u8]) {
    let body = body_start();
    body_token(body);
    body.push(",\"event\":");
    body.json_str(event);
    body.push("}");
    post(PATH_PREP, Req::Prep);
}

#[no_mangle]
pub extern "C" fn on_prompt_result(_event_type: i32, _node: i32, request_id: i32, result: i32) {
    if request_id != REQ_PROMPT {
        return;
    }
    let a = app();
    #[allow(static_mut_refs)]
    let answer = unsafe { &mut *core::ptr::addr_of_mut!(PROMPT_BUF) };
    if result > 0 {
        let len = (result as usize).min(answer.len());
        let body = body_start();
        body.push("{\"pass\":");
        body.json_str(&answer[..len]);
        body.push("}");
        for c in answer.iter_mut() {
            *c = 0;
        }
        if post(PATH_SESSION, Req::Session) {
            a.status("Signing in...", true);
        }
    } else {
        for c in answer.iter_mut() {
            *c = 0;
        }
        let why = if result == -1 { "Sign-in cancelled." } else { "Sign-in sheet closed." };
        a.status(why, true);
    }
}

#[no_mangle]
pub extern "C" fn on_net_result(_event_type: i32, _node: i32, request_id: i32, status: i32) {
    let a = app();
    let kind = a.take(request_id);
    if kind == Req::None {
        return;
    }
    let mut len = 0usize;
    if status >= 100 {
        let peek = unsafe { host::k_net_read(request_id, 0, 0) };
        if peek > 0 && (peek as usize) <= READ_BUF_BYTES {
            let buf_ptr = core::ptr::addr_of_mut!(READ_BUF) as *mut u8;
            let got = unsafe { host::k_net_read(request_id, buf_ptr as usize as i32, READ_BUF_BYTES as i32) };
            if got > 0 {
                len = (got as usize).min(READ_BUF_BYTES);
            }
        }
    }
    #[allow(static_mut_refs)]
    let body: &[u8] = unsafe { core::slice::from_raw_parts(core::ptr::addr_of!(READ_BUF) as *const u8, len) };

    if status == 401 && kind != Req::Session {
        a.signed_in = false;
        a.token = S::new();
        a.have_day = false;
        load_sample(true);
        a.status("Signed out by the bridge. Sign in again.", true);
        render();
        return;
    }
    if (status == 503 || status == 403) && kind != Req::Session {
        a.status(if status == 503 { "The bridge is stopped on the PC." } else { "The bridge does not list this world." }, true);
        return;
    }
    if status < 100 {
        let why = match status {
            0 => "The bridge did not answer. Is the PC awake?",
            -2 => "Network is off for this world.",
            -5 => "The bridge answered too much.",
            _ => "The bridge did not answer.",
        };
        a.status(why, true);
        return;
    }
    match kind {
        Req::Session => {
            if status == 200 {
                if let Some((tok, _ttl)) = model::read_pair(body, b"TOKEN") {
                    a.token.set(tok);
                    a.signed_in = true;
                    a.have_day = false; // the bridge's first answer replaces the sample in place
                    a.status("Signed in.", true);
                    a.poll_s = 0.0;
                    poll();
                    render();
                    return;
                }
            }
            // "NO <reason> <retry seconds>" from the bridge's one session (auth.ts).
            let reason = model::read_pair(body, b"NO").map(|(r, _)| r).unwrap_or(b"");
            let why = match (status, reason) {
                (401, b"not_set") => "No passphrase is set on the PC yet.",
                (401, _) => "Wrong passphrase.",
                (429, b"too_fast") => "One try every 2 seconds. Press again.",
                (429, b"room_locked") => "Too many wrong tries. Wait a day or restart bridge.",
                (429, b"hard_locked") => "Sign-in is locked. Unlock it on the PC.",
                (429, _) => "Too many tries. Wait 15 minutes.",
                (503, _) => "The bridge is stopped on the PC.",
                _ => "The bridge refused the sign-in.",
            };
            a.status(why, true);
        }
        Req::Changes => {
            // Read into a scratch day and take it only when it is complete: a cut
            // answer must never leave the room on a half-cleared day (review lens A, MED-1).
            #[allow(static_mut_refs)]
            let scratch = unsafe { &mut *core::ptr::addr_of_mut!(SCRATCH_DAY) };
            // Start from the room's own clock, so an answer without a NOW line
            // never brings back an older day's (review round 3, lens A, LOW-3).
            scratch.now_min = a.day.now_min;
            scratch.sunset_min = a.day.sunset_min;
            let read = status == 200 && model::read_day(body, scratch);
            if read && scratch.same {
                a.day.now_min = scratch.now_min;
                a.day.sunset_min = scratch.sunset_min;
                a.day.rev = scratch.rev;
                a.day.same = true;
                // Nothing changed but the clock: pills may still turn amber or dim.
                event_nodes();
            } else if read {
                // LOW-3: what is open or in focus follows its id, not its index, into the new day.
                let open_id = a.open.filter(|&m| m < a.day.n_msgs).map(|m| a.day.msgs[m].id);
                let focus_id = a.focus_task.filter(|&t| t < a.day.n_tasks).map(|t| a.day.tasks[t].id);
                core::mem::swap(&mut a.day, scratch);
                a.open = open_id.and_then(|id| a.day.msg_index(id.bytes()));
                a.focus_task = focus_id.and_then(|id| (0..a.day.n_tasks).find(|&t| a.day.tasks[t].id.eq(id.bytes())));
            }
            if read {
                a.since_update_s = 0.0;
                if !a.day.same {
                    let first = !a.have_day;
                    a.have_day = true;
                    reconcile(first);
                }
                render();
            } else {
                a.status("The bridge sent something this room cannot read.", true);
            }
        }
        Req::Act => {
            if status == 200 {
                if let Some((_rev, note)) = model::read_pair(body, b"OK") {
                    if !note.is_empty() {
                        let mut s: S<48> = S::new();
                        s.set(note);
                        let txt = s;
                        a.status(txt.as_str(), true);
                    }
                }
            } else {
                a.status("That did not work. The room will catch up.", true);
            }
            a.poll_s = POLL_S - 0.3;
        }
        Req::Prep => {
            if status == 200 && model::read_prep(body, &mut a.prep) && a.mode != Mode::Focus {
                a.showing_prep = true;
                if a.mode == Mode::Triage {
                    a.mode = Mode::Morning; // prep shows on the stage, which triage's fan covers
                }
                render();
            } else {
                a.status("No prep for that one.", true);
            }
        }
        Req::None => {}
    }
}


// ---------------------------------------------------------------------------
// Reconcile: make the room match the day
// ---------------------------------------------------------------------------

fn tick_sound() {
    let a = app();
    let node = a.n.inbox;
    unsafe { host::k_audio_play(node, TICK_SOUND.as_ptr() as i32, TICK_SOUND.len() as i32) };
}

/// The message ids this room last drew, to tell a new message from a moved one.
static mut KNOWN: [S<32>; model::MAX_MSGS] = [S::new(); model::MAX_MSGS];
static mut N_KNOWN: usize = 0;

fn known_contains(id: &[u8]) -> bool {
    #[allow(static_mut_refs)]
    unsafe {
        let known = &*core::ptr::addr_of!(KNOWN);
        known[..N_KNOWN].iter().any(|k| k.eq(id))
    }
}

fn remember_known() {
    let a = app();
    #[allow(static_mut_refs)]
    unsafe {
        let known = &mut *core::ptr::addr_of_mut!(KNOWN);
        for m in 0..a.day.n_msgs {
            known[m] = a.day.msgs[m].id;
        }
        N_KNOWN = a.day.n_msgs;
    }
}

/// Bring every card, event pill and shelf item in line with `app().day`.
/// `first`: the first day since sign-in (cards appear in place, nothing ticks).
fn reconcile(first: bool) {
    let a = app();
    let first = first || a.first_pending;

    // 1. Cards whose message is gone.
    for c in 0..a.cards.len() {
        if a.cards[c].alive && a.day.msg_index(a.cards[c].id.bytes()).is_none() {
            let (node, sub) = (a.cards[c].node, a.cards[c].sub);
            a.destroy(node, sub);
            a.cards[c] = EMPTY_CARD;
        }
    }

    // 2. Where every message lives now: first the place, then the cards.
    // A slot is held only by a card whose message is still in the inbox, so a slot
    // freed by Done, Later or Mute is filled in this same pass.
    let mut used = [false; L::GRID_SLOTS];
    for c in a.cards.iter() {
        if c.alive && c.slot != NO_SLOT && c.slot < L::GRID_SLOTS {
            let still_in = a.day.msg_index(c.id.bytes()).is_some_and(|m| a.day.msgs[m].pile == Pile::In);
            if still_in {
                used[c.slot] = true;
            }
        }
    }
    let n_msgs = a.day.n_msgs;
    let mut targets: [Option<[f32; 3]>; model::MAX_MSGS] = [None; model::MAX_MSGS];
    let mut slots = [NO_SLOT; model::MAX_MSGS];
    let mut cards_of = [usize::MAX; model::MAX_MSGS];
    // Inbox messages still looking for a place, in order of importance.
    let mut waiting = [0usize; model::MAX_MSGS];
    let mut n_waiting = 0;
    let (mut later_k, mut done_k, mut quiet_k) = (0usize, 0usize, 0usize);
    for m in 0..n_msgs {
        let msg = a.day.msgs[m];
        let card_i = (0..a.cards.len()).find(|&c| a.cards[c].alive && a.cards[c].id.eq(msg.id.bytes()));
        cards_of[m] = card_i.unwrap_or(usize::MAX);
        targets[m] = match msg.pile {
            Pile::In => {
                // A card on the arc keeps its slot: nothing shuffles under your hand.
                match card_i.map(|c| a.cards[c].slot).filter(|&s| s != NO_SLOT && s < L::GRID_SLOTS) {
                    Some(s) => {
                        slots[m] = s;
                        Some(L::grid_slot(s))
                    }
                    None => {
                        waiting[n_waiting] = m;
                        n_waiting += 1;
                        None
                    }
                }
            }
            Pile::Later => {
                let k = later_k;
                later_k += 1;
                (k < L::PILE_SHOWN).then(|| L::pile_at(L::PILE_LATER_DEG, k))
            }
            Pile::Done => {
                let k = done_k;
                done_k += 1;
                (k < L::PILE_SHOWN).then(|| L::pile_at(L::PILE_DONE_DEG, k))
            }
            Pile::Quiet => {
                let k = quiet_k;
                quiet_k += 1;
                (k < L::SHELF_SLOTS.len()).then(|| [L::SHELF_X, L::SHELF_Y, L::SHELF_SLOTS[k]])
            }
        };
    }
    // Order what waits: unread VIPs first, then the newest (messages arrive at the end).
    let important = |m: usize| {
        let x = &a.day.msgs[m];
        x.vip && !x.read
    };
    let mut order = [0usize; model::MAX_MSGS];
    let mut n_order = 0;
    for pass in 0..2 {
        for k in (0..n_waiting).rev() {
            let m = waiting[k];
            if important(m) == (pass == 0) {
                order[n_order] = m;
                n_order += 1;
            }
        }
    }
    // Free arc slots go in that order; the next few wait in the inbox well, the most
    // important on top; the rest are counted ("+N more"), not drawn.
    let mut in_well = 0usize;
    for &m in &order[..n_order] {
        if let Some(s) = used.iter().position(|&u| !u) {
            used[s] = true;
            slots[m] = s;
            targets[m] = Some(L::grid_slot(s));
        } else if in_well < L::TRAY_SHOWN {
            let level = (L::TRAY_SHOWN - 1 - in_well) as f32;
            targets[m] = Some([L::WELL[0], L::WELL[1] + 0.006 + level * L::PILE_STEP_Y, L::WELL[2]]);
            in_well += 1;
        }
    }

    let mut vip_landed: Option<usize> = None;
    for m in 0..n_msgs {
        let msg = a.day.msgs[m];
        let card_i = if cards_of[m] == usize::MAX { None } else { Some(cards_of[m]) };
        let slot = slots[m];
        // New = not in the last day this room drew. A VIP ticks even when the arc is full.
        if !first && msg.pile == Pile::In && msg.vip && !known_contains(msg.id.bytes()) {
            vip_landed = Some(m);
        }
        match (card_i, targets[m]) {
            (Some(c), None) => {
                // Counted, not drawn (a full pile, a full well).
                let (node, sub) = (a.cards[c].node, a.cards[c].sub);
                a.destroy(node, sub);
                a.cards[c] = EMPTY_CARD;
            }
            (None, None) => {}
            (None, Some(to)) => {
                let tone = style::card_tone(&msg);
                let node = a.clone_tone(tone);
                if node <= 0 {
                    continue; // next tick (dirty) or a cap
                }
                let Some(free) = a.cards.iter().position(|c| !c.alive) else {
                    a.destroy(node, 0);
                    continue;
                };
                let sub = subscribe_press(node);
                // A card that arrives while you are in the room falls onto its place
                // from above, face-down. Nothing moves toward you.
                let from = if first { to } else { [to[0], to[1] + L::DROP_H, to[2]] };
                a.cards[free] = Card { id: msg.id, node, tone, slot, pos: from, from, to, t: if first { 1.0 } else { 0.0 }, fall: !first, alive: true, sub };
                place(node, from);
            }
            (Some(c), Some(to)) => {
                let tone = style::card_tone(&msg);
                if a.cards[c].tone != tone {
                    // Turned over (or became VIP): a new face, in the same place.
                    let (old, old_sub) = (a.cards[c].node, a.cards[c].sub);
                    let node = a.clone_tone(tone);
                    if node > 0 {
                        a.destroy(old, old_sub);
                        a.cards[c].sub = subscribe_press(node);
                        a.cards[c].node = node;
                        a.cards[c].tone = tone;
                        place(node, a.cards[c].pos);
                    }
                }
                a.cards[c].slot = slot;
                let card = &mut a.cards[c];
                if card.to != to {
                    card.from = card.pos;
                    card.to = to;
                    card.t = 0.0;
                    card.fall = false;
                }
            }
        }
    }
    remember_known();

    // 3. The Day Ring's pills.
    event_nodes();
    a.first_pending = first && a.dirty;

    if let Some(m) = vip_landed {
        tick_sound();
        // The VIP line rides on the banner, the room's one notice band.
        a.vip_from = a.day.msgs[m].from;
        a.vip_s = VIP_LINE_S;
        banner();
        show_plates();
    }
}

/// One pill per event, in its tone (past, now, later); a pill whose tone
/// changes is swapped for one of the new tone, in the same place.
fn event_nodes() {
    let a = app();
    let now = a.day.now_min;
    while a.n_event_nodes > a.day.n_events {
        a.n_event_nodes -= 1;
        let k = a.n_event_nodes;
        let (node, sub) = (a.events[k], a.event_subs[k]);
        a.destroy(node, sub);
        a.events[k] = 0;
        a.event_subs[k] = 0;
        a.label_deg[k] = f32::NAN;
    }
    for e in 0..a.day.n_events {
        let tone = style::event_tone(&a.day.events[e], now);
        let have = e < a.n_event_nodes;
        if have && a.event_tone[e] == tone {
            continue;
        }
        let node = a.clone_tone(tone);
        if node <= 0 {
            break; // the next tick (dirty) finishes
        }
        if have {
            let (old, sub) = (a.events[e], a.event_subs[e]);
            a.destroy(old, sub);
        } else {
            a.n_event_nodes = e + 1;
        }
        a.events[e] = node;
        a.event_subs[e] = subscribe_press(node);
        a.event_tone[e] = tone;
        a.event_vis[e] = true; // a clone is shown as it is made
        a.label_deg[e] = f32::NAN; // its label went with the old pill
        let deg = L::ring_deg(a.day.events[e].start as f32, if a.ring_now < 0.0 { a.clock_now() } else { a.ring_now });
        place(node, L::ring_at(deg));
    }
    a.ring_force = true;
    // A swapped pill took its label with it: label again (review v2, lens A, MED-1).
    ring_labels(false);
    show_plates();
}

// ---------------------------------------------------------------------------
// Render: what the room shows in the current mode
// ---------------------------------------------------------------------------

/// The Day Ring's labels: a few around now (the one just past, then the next),
/// on two alternating rows. `reface`: show again any label whose event has
/// moved round since, so it faces you again.
fn ring_labels(reface: bool) {
    let a = app();
    let budget = if a.about.is_some() || a.mode == Mode::Focus {
        0
    } else if a.mode == Mode::Triage {
        CAL_LABELS_TRIAGE
    } else {
        CAL_LABELS
    };
    let n_ev = a.day.n_events.min(a.n_event_nodes);
    let now = a.day.now_min;
    let next = (0..n_ev).find(|&e| a.day.events[e].end > now).unwrap_or(n_ev.saturating_sub(1));
    let first = if budget >= 3 { next.saturating_sub(1) } else { next };
    let first = first.min(n_ev.saturating_sub(budget));
    for e in 0..a.n_event_nodes {
        let node = a.events[e];
        let now = if a.ring_now < 0.0 { a.clock_now() } else { a.ring_now };
        let deg = if e < a.day.n_events { L::ring_deg(a.day.events[e].start as f32, now) } else { 0.0 };
        let wanted = e < n_ev && e >= first && e < first + budget && deg.abs() <= L::RING_SHOW_DEG;
        if !wanted {
            a.untext(node);
            a.label_deg[e] = f32::NAN;
            continue;
        }
        let drifted = !a.label_deg[e].is_nan() && (deg - a.label_deg[e]).abs() > LABEL_REFACE_DEG;
        let keep_place = a.held(node) && !(reface && drifted);
        if !keep_place {
            a.untext(node); // shown again, so the client faces it toward you anew
        }
        let ev = a.day.events[e];
        let mut b: Buf<128> = Buf::new();
        text::clock(&mut b, ev.start);
        let mut l = Lines::new(14, 2);
        l.text(b.as_str());
        l.newline();
        l.words(ev.title.bytes());
        // Held: only the words change (a renamed event), in place. Not held: placed and faced now.
        a.say(node, l.as_bytes(), Place::Ring((e % 2) as u8));
        if !keep_place {
            a.label_deg[e] = deg;
        }
    }
}

fn show_timer() {
    let a = app();
    let s = a.focus_left_s.max(0.0) as i32;
    let mut b: Buf<128> = Buf::new();
    b.int(s / 60);
    b.byte(b':');
    b.int2(s % 60);
    b.push(if a.focus_running { "  focus" } else if s == 0 { "  time - take a break" } else { "  paused" });
    let node = a.n.txt_timer;
    a.say(node, b.as_bytes(), Place::Plaque(1));
}

fn counts() -> (i32, i32, i32, i32, i32) {
    let d = &app().day;
    let (mut inbox, mut vip, mut later, mut done, mut quiet) = (0, 0, 0, 0, 0);
    for m in &d.msgs[..d.n_msgs] {
        match m.pile {
            Pile::In => {
                inbox += 1;
                if m.vip && !m.read {
                    vip += 1;
                }
            }
            Pile::Later => later += 1,
            Pile::Done => done += 1,
            Pile::Quiet => quiet += 1,
        }
    }
    (inbox, vip, later, done, quiet)
}

/// Tasks by state: (to do, doing, done).
fn task_counts() -> (i32, i32, i32) {
    let d = &app().day;
    let (mut todo, mut doing, mut done) = (0, 0, 0);
    for t in &d.tasks[..d.n_tasks] {
        match t.state {
            TaskState::Open => todo += 1,
            TaskState::Doing => doing += 1,
            TaskState::Done => done += 1,
            TaskState::Rolled => {}
        }
    }
    (todo, doing, done)
}

/// The messages triage fans out: the inbox's unread VIPs first, then the cards
/// on the arc in order, then what waits in the well; never the one being read.
fn fan_wanted() -> [usize; FAN] {
    let a = app();
    let mut out = [usize::MAX; FAN];
    let mut k = 0;
    let open = a.open;
    let take = |m: usize, out: &mut [usize; FAN], k: &mut usize| {
        if *k < FAN && Some(m) != open && !out[..*k].contains(&m) {
            out[*k] = m;
            *k += 1;
        }
    };
    for m in 0..a.day.n_msgs {
        let x = &a.day.msgs[m];
        if x.pile == Pile::In && x.vip && !x.read {
            take(m, &mut out, &mut k);
        }
    }
    for s in 0..L::GRID_SLOTS {
        if let Some(c) = a.cards.iter().find(|c| c.alive && c.slot == s) {
            if let Some(m) = a.day.msg_index(c.id.bytes()) {
                if a.day.msgs[m].pile == Pile::In {
                    take(m, &mut out, &mut k);
                }
            }
        }
    }
    for m in 0..a.day.n_msgs {
        if a.day.msgs[m].pile == Pile::In {
            take(m, &mut out, &mut k);
        }
    }
    out
}

/// Where a message's card is now (for a fan card to rise from).
fn card_pos(m: usize) -> [f32; 3] {
    let a = app();
    let id = a.day.msgs[m].id;
    match a.cards.iter().find(|c| c.alive && c.id.eq(id.bytes())) {
        Some(c) => [c.pos[0], L::RISE_FROM_Y, c.pos[2]],
        None => [L::WELL[0], L::RISE_FROM_Y, L::WELL[2]],
    }
}

/// Triage's fan: each of the five face-up cards shows the message it should,
/// rising from that message's card when it changes.
fn fan_sync(on: bool) {
    let a = app();
    let wanted = if on { fan_wanted() } else { [usize::MAX; FAN] };
    for k in 0..FAN {
        let (node, vip_node) = (a.n.fan[k], a.n.fan_vip[k]);
        let m = wanted[k];
        if m == usize::MAX {
            if !a.fan[k].id.is_empty() {
                a.fan[k] = EMPTY_FAN;
                a.untext(node);
                visible(node, false);
                visible(vip_node, false);
            }
            continue;
        }
        let msg = a.day.msgs[m];
        if !a.fan[k].id.eq(msg.id.bytes()) {
            let from = card_pos(m);
            a.fan[k] = FanCard { id: msg.id, pos: from, from, t: 0.0 };
            place(node, from);
            place(vip_node, from);
            visible(node, true);
            a.untext(node);
        }
        visible(vip_node, style::fan_frame(&msg));
        let mut l = Lines::new(15, 2);
        l.words(msg.from.bytes());
        l.newline();
        l.words(msg.subject.bytes());
        a.say(node, l.as_bytes(), Place::Plaque(2));
    }
}

/// Is message `m`'s card up in the fan (so its disc on the arc is hidden)?
fn fanned(id: &[u8]) -> bool {
    app().fan.iter().any(|f| !f.id.is_empty() && f.id.eq(id))
}

/// The banner, the room's one low notice band: the sample's line, and for
/// 90 seconds after a VIP lands, who it is from.
fn banner() {
    let a = app();
    let node = a.n.txt_banner;
    let mut l = Lines::new(40, 2);
    let mut any = false;
    if !a.day.note.is_empty() {
        let note = a.day.note;
        l.words(note.bytes());
        any = true;
    }
    if a.vip_s > 0.0 && !a.vip_from.is_empty() {
        if any {
            l.newline();
        }
        l.text("VIP:");
        let from = a.vip_from;
        l.words(from.bytes());
        any = true;
    }
    if any {
        a.say(node, l.as_bytes(), Place::Plaque(2));
    } else {
        a.untext(node);
    }
}

pub fn render() {
    let a = app();
    let n = a.n;
    let mode = a.mode;
    let about_open = a.about.is_some();
    let focus = mode == Mode::Focus && !about_open;
    let triage = mode == Mode::Triage && !about_open;
    a.ring_force = true; // the ring re-checks what it shows

    // --- Triage: the fan, and the card being read.
    let open = if triage { a.open.filter(|&m| m < a.day.n_msgs && a.day.msgs[m].pile == Pile::In) } else { None };
    if mode == Mode::Triage && open.is_none() {
        a.open = None;
    }
    fan_sync(triage);
    // The card up in front: a waiting draft takes the reading card's place.
    let draft = if triage { a.day.pending_draft() } else { None };
    let front = if draft.is_some() { n.txt_draft } else if open.is_some() { n.txt_open } else { 0 };
    if front != a.read_node || open != a.read_shown {
        a.read_shown = open;
        a.read_node = front;
        if front > 0 {
            a.read_t = 0.0;
            place(front, L::at(L::READ_R, 0.0, L::RISE_FROM_Y));
        }
    }
    visible(n.txt_open, front == n.txt_open && front > 0);
    visible(n.txt_draft, front == n.txt_draft && front > 0);

    // The banner sits under the now bar; in triage it moves up, clear of the fan.
    place(n.txt_banner, L::at(L::BANNER_R, 0.0, if triage { L::BANNER_TRIAGE_Y } else { L::BANNER_Y }));

    // --- Buttons and groups.
    visible(n.sign_in, !a.signed_in);
    visible(n.about, true);
    visible(n.about_next, about_open);
    for b in n.mode {
        visible(b, true);
    }
    for b in [n.done, n.later, n.reply, n.task, n.mute] {
        visible(b, open.is_some() && draft.is_none());
    }
    visible(n.focus_go, focus);
    for b in [n.approve, n.deny, n.more] {
        visible(b, draft.is_some());
    }
    let staging = about_open || (!focus && !triage) || a.showing_prep;
    visible(n.txt_stage, staging);
    visible(n.prep_close, !about_open && a.showing_prep);
    visible(n.txt_focus, focus);
    visible(n.txt_timer, focus);
    let tasks_on = !about_open && (mode == Mode::Morning || mode == Mode::Wrap);
    visible(n.txt_tasks, tasks_on);
    for (k, &t) in n.tasks.iter().enumerate() {
        visible(t, tasks_on && shown_task(k).is_some());
    }
    // The arc's cards: hidden in focus (the room has closed in) and while up in the fan.
    // In triage the well's waiting cards are put away too: the fan shows what matters,
    // and the stack sat right behind the Reply puck (review v2).
    for c in a.cards.iter() {
        if c.alive {
            let in_well = c.slot == NO_SLOT && c.to[0] == L::WELL[0] && c.to[2] == L::WELL[2];
            visible(c.node, !focus && !fanned(c.id.bytes()) && !(triage && in_well));
        }
    }
    // The window pane follows the clock against sunset.
    let pane = style::pane(a.day.now_min, a.day.sunset_min);
    for (k, &p) in n.panes.iter().enumerate() {
        visible(p, k == pane);
    }

    // --- Texts. Always: the mode column with About and Sign in, the banner, the status.
    let si = n.sign_in;
    if a.signed_in {
        a.untext(si);
    } else {
        a.say_str(si, "Owner sign in", Place::Puck);
    }
    let ab = n.about;
    a.say_str(ab, if about_open { "Close about" } else { "About" }, Place::Puck);
    banner();
    let names = ["Morning", "Focus", "Triage", "Wrap-up"];
    let modes = [Mode::Morning, Mode::Focus, Mode::Triage, Mode::Wrap];
    for k in 0..4 {
        let mut b: Buf<16> = Buf::new();
        if modes[k] == mode {
            b.push("[");
            b.push(names[k]);
            b.push("]");
        } else {
            b.push(names[k]);
        }
        let node = a.n.mode[k];
        a.say(node, b.as_bytes(), Place::Puck);
    }

    ring_labels(false);

    let (inbox, vip, later, done, quiet) = counts();
    let all = [
        n.done, n.later, n.reply, n.task, n.mute, n.focus_go, n.approve, n.deny, n.more, n.prep_close, n.tasks[0], n.tasks[1], n.tasks[2], n.txt_tasks,
        n.txt_open, n.txt_draft, n.txt_focus, n.txt_timer, n.txt_next, n.txt_window, n.txt_quiet, n.inbox, n.pile_later, n.pile_done,
    ];
    if let Some(p) = a.about {
        // About: one short page on the stage, and nothing else around it.
        for node in all {
            a.untext(node);
        }
        let mut l = Lines::new(30, 4);
        l.text(ABOUT_PAGES[p % ABOUT_PAGES.len()]);
        let st = n.txt_stage;
        a.say(st, l.as_bytes(), Place::Plaque(4));
        let mut b: Buf<16> = Buf::new();
        b.push("Next ");
        b.int((p % ABOUT_PAGES.len()) as i32 + 1);
        b.push("/");
        b.int(ABOUT_PAGES.len() as i32);
        let nx = n.about_next;
        a.say(nx, b.as_bytes(), Place::Puck);
        a.live_status();
        show_plates();
        return;
    }
    let nx = n.about_next;
    a.untext(nx);

    // The inbox well's count: what is in, how many VIPs, how many are not drawn.
    {
        let node = a.n.inbox;
        if focus || open.is_some() {
            a.untext(node);
        } else {
            let mut b: Buf<64> = Buf::new();
            b.push("Inbox ");
            b.int(inbox);
            if vip > 0 {
                b.push(", ");
                b.int(vip);
                b.push(" VIP");
            }
            let hidden = (inbox as usize).saturating_sub(L::GRID_SLOTS + L::TRAY_SHOWN);
            if hidden > 0 {
                b.push("\n+");
                b.int(hidden as i32);
                b.push(" more");
            }
            a.say(node, b.as_bytes(), Place::Pile);
        }
        // The piles' counts, in triage, when there is something on them.
        let mut b: Buf<32> = Buf::new();
        b.push("Later ");
        b.int(later);
        let node = a.n.pile_later;
        if triage && later > 0 {
            a.say(node, b.as_bytes(), Place::Pile);
        } else {
            a.untext(node);
        }
        let mut b: Buf<32> = Buf::new();
        b.push("Done ");
        b.int(done);
        let node = a.n.pile_done;
        if triage && done > 0 {
            a.say(node, b.as_bytes(), Place::Pile);
        } else {
            a.untext(node);
        }
    }

    // The quiet shelf behind you (not in focus: the room has closed in).
    {
        let node = a.n.txt_quiet;
        if focus {
            a.untext(node);
        } else {
            let mut l = Lines::new(22, 2);
            let mut b: Buf<32> = Buf::new();
            b.push("Quiet shelf: ");
            b.int(quiet);
            l.text(b.as_str());
            let mut names_shown = 0;
            for m in &a.day.msgs[..a.day.n_msgs] {
                if m.pile == Pile::Quiet && names_shown < 2 {
                    if names_shown == 0 {
                        l.newline();
                    } else {
                        l.text(",");
                    }
                    l.words(m.from.bytes());
                    names_shown += 1;
                }
            }
            a.say(node, l.as_bytes(), Place::Plaque(2));
        }
    }

    // The window: weather, sunset, one headline (not in focus).
    {
        let node = a.n.txt_window;
        if focus {
            a.untext(node);
        } else {
            let mut l = Lines::new(22, 3);
            let mut b: Buf<128> = Buf::new();
            b.bytes(a.day.weather.bytes());
            b.push("  sunset ");
            text::clock(&mut b, a.day.sunset_min);
            l.text(b.as_str());
            l.newline();
            l.words(a.day.headline.bytes());
            a.say(node, l.as_bytes(), Place::Plaque(3));
        }
    }

    // In focus, the next event is the only other thing you see.
    {
        let node = a.n.txt_next;
        if focus {
            let next = (0..a.day.n_events).find(|&e| a.day.events[e].start >= a.day.now_min);
            match next {
                Some(e) => {
                    let ev = a.day.events[e];
                    let mut b: Buf<128> = Buf::new();
                    b.push("Next: ");
                    text::clock(&mut b, ev.start);
                    b.push(" ");
                    b.bytes(ev.title.bytes());
                    a.say(node, b.as_bytes(), Place::Float);
                }
                None => a.say_str(node, "Nothing else today", Place::Float),
            }
        } else {
            a.untext(node);
        }
    }

    // The stage: the brief, prep or the wrap-up.
    let stage = a.n.txt_stage;
    if a.showing_prep {
        let mut l = Lines::new(30, 4);
        for k in 0..a.prep.n {
            if k > 0 {
                l.newline();
            }
            l.words(a.prep.lines[k].bytes());
        }
        a.say(stage, l.as_bytes(), Place::Plaque(4));
        let pc = a.n.prep_close;
        a.say_str(pc, "Close", Place::Puck);
    } else {
        let pc = a.n.prep_close;
        a.untext(pc);
        match mode {
            Mode::Morning => {
                let mut l = Lines::new(30, 4);
                if a.day.n_brief == 0 {
                    l.text("No brief yet.");
                }
                for k in 0..a.day.n_brief {
                    if k > 0 {
                        l.newline();
                    }
                    l.words(a.day.brief[k].bytes());
                }
                a.say(stage, l.as_bytes(), Place::Plaque(4));
            }
            Mode::Wrap => {
                let mut tasks_done = 0;
                for t in &a.day.tasks[..a.day.n_tasks] {
                    if t.state == TaskState::Done {
                        tasks_done += 1;
                    }
                }
                let mut l = Lines::new(30, 4);
                let mut b: Buf<64> = Buf::new();
                b.push("Done: ");
                b.int(tasks_done);
                b.push(" tasks, ");
                b.int(done);
                b.push(" messages");
                l.text(b.as_str());
                let mut shown = 0;
                for t in &a.day.tasks[..a.day.n_tasks] {
                    if t.state == TaskState::Done && shown < 2 {
                        l.newline();
                        l.text("- ");
                        l.words(t.title.bytes());
                        shown += 1;
                    }
                }
                l.newline();
                l.text("First tomorrow:");
                l.words(a.day.first_tomorrow.bytes());
                a.say(stage, l.as_bytes(), Place::Plaque(4));
            }
            Mode::Focus | Mode::Triage => a.untext(stage),
        }
    }

    // Focus: the task, its timer, and start or pause.
    {
        let fnode = a.n.txt_focus;
        let gnode = a.n.focus_go;
        if focus {
            let mut l = Lines::new(24, 3);
            l.text("Focus on:");
            l.newline();
            let task = a.focus_task.filter(|&i| i < a.day.n_tasks).or_else(shown_first_open);
            match task {
                Some(i) => l.words(a.day.tasks[i].title.bytes()),
                None => l.text("press a pinned task in Morning"),
            }
            a.say(fnode, l.as_bytes(), Place::Plaque(3));
            show_timer();
            let label = if a.focus_running { "Pause" } else if a.focus_left_s <= 0.0 { "Again" } else { "Start" };
            a.say_str(gnode, label, Place::Puck);
        } else {
            let tnode = a.n.txt_timer;
            a.untext(fnode);
            a.untext(tnode);
            a.untext(gnode);
        }
    }

    // Task tiles (Morning: pinned; Wrap: what rolls), under a line of counts.
    {
        let hnode = a.n.txt_tasks;
        if tasks_on {
            let mut b: Buf<64> = Buf::new();
            if mode == Mode::Wrap {
                b.push("Roll to tomorrow: press one");
            } else {
                let (todo, doing, tdone) = task_counts();
                b.int(todo);
                b.push(" to do, ");
                b.int(doing);
                b.push(" doing, ");
                b.int(tdone);
                b.push(" done");
            }
            a.say(hnode, b.as_bytes(), Place::Plaque(1));
        } else {
            a.untext(hnode);
        }
        for k in 0..3 {
            let node = a.n.tasks[k];
            let task = if tasks_on { shown_task(k) } else { None };
            match task {
                Some(i) => {
                    let mut l = Lines::new(18, 2);
                    l.words(a.day.tasks[i].title.bytes());
                    a.say(node, l.as_bytes(), Place::Plaque(2));
                }
                None => a.untext(node),
            }
        }
    }

    // Triage: the card being read, its actions, and a waiting draft.
    {
        let node = a.n.txt_open;
        match open {
            Some(m) => {
                let msg = a.day.msgs[m];
                let mut l = Lines::new(24, 4);
                l.words(msg.from.bytes());
                if msg.vip {
                    l.text("(VIP)");
                }
                l.newline();
                l.words(msg.subject.bytes());
                l.newline();
                l.words(msg.preview.bytes());
                a.say(node, l.as_bytes(), Place::Plaque(4));
            }
            None => a.untext(node),
        }
        let labels = [(a.n.done, "Done"), (a.n.later, "Later"), (a.n.reply, "Reply"), (a.n.task, "Task"), (a.n.mute, "Mute")];
        for (node, label) in labels {
            if open.is_some() && draft.is_none() {
                a.say_str(node, label, Place::Puck);
            } else {
                a.untext(node);
            }
        }
        let tdraft = a.n.txt_draft;
        match draft {
            Some(d) => {
                let dr = a.day.drafts[d];
                // Pages of 3 lines x 26 characters under a "Draft to ..." line.
                let pages = draft_pages(dr.text.bytes());
                let page = a.draft_page % pages.max(1);
                let mut l = Lines::new(DRAFT_W, 4);
                l.text("Draft to");
                l.words(dr.to.bytes());
                l.newline();
                draft_page_into(dr.text.bytes(), page, &mut l);
                a.say(tdraft, l.as_bytes(), Place::Plaque(4));
                let (ap, dn, mo) = (a.n.approve, a.n.deny, a.n.more);
                a.say_str(ap, "Approve", Place::Puck);
                a.say_str(dn, "Deny", Place::Puck);
                if pages > 1 {
                    let mut b: Buf<16> = Buf::new();
                    b.push("More ");
                    b.int(page as i32 + 1);
                    b.push("/");
                    b.int(pages as i32);
                    a.say(mo, b.as_bytes(), Place::Puck);
                } else {
                    a.untext(mo);
                }
            }
            None => {
                a.untext(tdraft);
                let (ap, dn, mo) = (a.n.approve, a.n.deny, a.n.more);
                a.untext(ap);
                a.untext(dn);
                a.untext(mo);
            }
        }
    }

    a.live_status();
    show_plates();
}

/// MR only: show each dark plate only while a text it frames is showing,
/// and the ring's band while any ring label shows.
/// (World text is always white; a light real wall behind it is unreadable.)
fn show_plates() {
    let a = app();
    let n = a.n;
    if !n.mr {
        return;
    }
    let held = |node: i32| a.held(node);
    let wanted = [
        n.mode.iter().any(|&m| held(m)) || held(n.about) || held(n.sign_in) || held(n.txt_status),
        held(n.done) || held(n.approve),
        held(n.inbox),
        held(n.pile_later),
        held(n.pile_done),
        held(n.prep_close) || held(n.about_next),
    ];
    for k in 0..PLATES.len() {
        visible(n.plates[k], wanted[k]);
    }
    let ring = (0..a.n_event_nodes).any(|e| held(a.events[e]));
    for b in n.band {
        visible(b, ring);
    }
}

fn shown_first_open() -> Option<usize> {
    let d = &app().day;
    (0..d.n_tasks)
        .find(|&i| d.tasks[i].pin && d.tasks[i].state == TaskState::Doing)
        .or_else(|| (0..d.n_tasks).find(|&i| d.tasks[i].pin && d.tasks[i].state == TaskState::Open))
}

const DRAFT_W: usize = 24;
const DRAFT_LINES: usize = 3;

/// How many 3-line pages a draft takes at 26 characters a line.
pub fn draft_pages(text: &[u8]) -> usize {
    let lines = count_wrapped(text, DRAFT_W);
    lines.div_ceil(DRAFT_LINES).max(1)
}

fn count_wrapped(text: &[u8], w: usize) -> usize {
    let mut lines = 1;
    let mut col = 0;
    for word in text.split(|&c| c == b' ').filter(|x| !x.is_empty()) {
        let mut len = word.len();
        loop {
            let sep = if col > 0 { 1 } else { 0 };
            if col + sep + len <= w {
                col += sep + len;
                break;
            } else if col == 0 {
                len -= w.min(len);
                lines += 1;
                if len == 0 {
                    col = 0;
                    lines -= 1;
                    break;
                }
            } else {
                lines += 1;
                col = 0;
            }
        }
    }
    lines
}

/// Write page `page` (3 lines) of the wrapped draft into `out`, breaking
/// lines exactly where `count_wrapped` does.
pub fn draft_page_into(text: &[u8], page: usize, out: &mut Lines) {
    let first = page * DRAFT_LINES;
    let mut line = 0;
    let mut col = 0;
    let mut wrote = false;
    for word in text.split(|&c| c == b' ').filter(|x| !x.is_empty()) {
        if col > 0 && col + 1 + word.len() > DRAFT_W {
            line += 1;
            col = 0;
            if line >= first + DRAFT_LINES {
                break;
            }
            if wrote {
                out.newline();
            }
        }
        if line >= first {
            out.words(word);
            wrote = true;
        }
        col += if col > 0 { 1 } else { 0 } + word.len();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn about_pages_fit_without_a_cut() {
        for (k, p) in ABOUT_PAGES.iter().enumerate() {
            let mut l = Lines::new(30, 4);
            l.text(p);
            assert!(!l.cut, "About page {} is cut: {}", k + 1, core::str::from_utf8(l.as_bytes()).unwrap());
        }
    }

    #[test]
    fn draft_pages_count() {
        let short = b"Wednesday morning works. 9:30 at the usual place?";
        assert_eq!(draft_pages(short), 1);
        let long = b"Keep the conduit wording as drafted. The shorter version drops the card-data sentence we need. Thanks! And one more sentence to push it onto a second page for sure.";
        assert!(draft_pages(long) >= 2);
    }

    #[test]
    fn draft_page_fits_a_world_text() {
        let long = b"Keep the conduit wording as drafted. The shorter version drops the card-data sentence we need. Thanks! And one more sentence to push it onto a second page for sure.";
        for p in 0..draft_pages(long) {
            let mut l = Lines::new(DRAFT_W, 4);
            l.text("Draft to Counsel (sample)");
            l.newline();
            draft_page_into(long, p, &mut l);
            let s = core::str::from_utf8(l.as_bytes()).unwrap();
            assert!(l.as_bytes().len() <= text::HOST_TEXT_MAX_BYTES, "{s}");
            assert!(s.lines().count() <= 4, "page {p}: {s}");
            assert!(!s.trim().is_empty());
        }
    }

    #[test]
    fn the_ring_maps_the_working_day() {
        // At 10:00, 13:00 is three hours to the right; 7:00 three hours to the left.
        assert!((L::ring_deg(13.0 * 60.0, 600.0) - 45.0).abs() < 1e-4);
        assert!((L::ring_deg(7.0 * 60.0, 600.0) + 45.0).abs() < 1e-4);
        // The working day fits inside what the ring shows around any hour in it.
        assert!(L::ring_deg(19.0 * 60.0, 13.0 * 60.0) <= L::RING_SHOW_DEG);
    }

    #[test]
    fn arc_slots_are_low_and_in_front() {
        for i in 0..L::GRID_SLOTS {
            let p = L::grid_slot(i);
            let r = (p[0] * p[0] + p[2] * p[2]).sqrt();
            assert!((r - L::ARC_R).abs() < 1e-4 && p[0] > 0.5 && p[1] < 0.9, "slot {i} {p:?}");
        }
    }

    #[test]
    fn the_fan_and_cocoon_stay_inside_their_rings() {
        for k in 0..FAN {
            let p = L::fan_at(k, L::FAN_Y);
            assert!(((p[0] * p[0] + p[2] * p[2]).sqrt() - L::FAN_R).abs() < 1e-4);
        }
        // The mode column (1.45 m) and the focus card (1.45 m) sit inside the cocoon.
        assert!(L::COCOON_R > 1.45 + 0.4);
    }
}
