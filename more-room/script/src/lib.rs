//! More Room — the day around you (`world://more-room.micknerks`, VR, and
//! `world://more-room-mr.micknerks`, MR). One script for both.
//!
//! @kosmos-system  Content (KosmosWorlds) — More Room
//! @kosmos-owner   More Room v1 (design session 2026-10-14)
//! @kosmos-level   host API level 4 (`k_net_*`), level 3 (`k_node_clone`, `k_node_destroy`, `k_log`)
//!
//! What a phone crams into one rectangle, given a place around you, live.
//! The rule of the room: **everything has a place, and nothing jumps in front
//! of you; it lands where it lives.** A new message lands face-down in its
//! slot on the desk, sliding out of the inbox tray; it never pops up in front
//! of the visitor. Only a VIP message makes a sound (one tick, from the tray).
//!
//! Four modes, one button each on the desk's front edge:
//! - **Morning:** the brief on the stage, the pinned tasks on the right, the
//!   message count under the brief, the day on the calendar strip.
//! - **Focus:** one task large with a 25-minute timer; veils dim the rest;
//!   messages still land, face-down and silent, and only a VIP ticks.
//! - **Triage:** press a card to turn it over; Done, Later, Reply ("Claude
//!   drafts reply"), Task ("Make a task", a Linear ticket) and Mute (to the
//!   quiet shelf behind you). A draft waits on the side table for Approve or
//!   Deny: nothing is sent without that press.
//! - **Wrap-up:** what got done, what rolls to tomorrow (press a task to roll
//!   it), and the first thing tomorrow.
//! Pressing an event on the calendar shows its prep on the stage.
//!
//! The brain is the bridge on the CEO's PC (Mission Control's): Claude reads
//! mail, calendar and Linear there. This world only draws what the bridge's
//! face says (agent-bridge/src/faces/more-room/day-core.ts, on the shared
//! agent bridge) and sends the presses.
//! It polls "what changed since N" every `POLL_S` seconds.
//!
//! Host limits this file is built around (each checked by tests or by
//! ../../tools/mock-host.mjs):
//! - at most 32 world texts at once, each at most 128 bytes and 4 lines
//!   (`texts`, `text::Lines`); the per-mode budget is in ../../DESIGN.md §4;
//! - at most 128 created objects and 16 creates a frame (`CREATES_PER_TICK`);
//! - requests at most 16 KiB, answers at most 256 KiB, text only;
//!   4 in flight, 1 a second with bursts of 10;
//! - no `player_read` (a network world may not have it), so nothing here
//!   knows where the visitor's head or hands are: everything sits at fixed
//!   spots around the spawn, which in MR is where the visitor stands.
//! - `k_node_find` sees only meshes; clone names may not end in a digit.

#![cfg_attr(target_arch = "wasm32", no_std, no_main)]

pub mod layout;
pub mod model;
pub mod text;

use layout as L;
use model::{Day, Pile, Prep, Src, TaskState};
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
/// How long the VIP line stays up.
const VIP_LINE_S: f32 = 90.0;
/// How long an error stays on the status line.
const STATUS_HOLD_S: f32 = 10.0;

const TICK_SOUND: &str = "tick.wav";
const PROMPT_TEXT: &str = "Your bridge passphrase. It goes only to your bridge, and the room keeps it for this visit only.";
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

#[derive(Clone, Copy, PartialEq)]
enum Look {
    Gmail,
    Slack,
    Github,
    Linear,
    Vip,
    Read,
}

/// One message's card in the room.
#[derive(Clone, Copy)]
struct Card {
    id: S<32>,
    node: i32,
    look: Look,
    /// Grid slot while in the inbox, else usize::MAX.
    slot: usize,
    pos: [f32; 3],
    from: [f32; 3],
    to: [f32; 3],
    t: f32,
    alive: bool,
    /// The OnInteract subscription, released when the card is destroyed.
    sub: i32,
}

const NO_SLOT: usize = usize::MAX;
const EMPTY_CARD: Card = Card { id: S::new(), node: 0, look: Look::Read, slot: NO_SLOT, pos: [0.0; 3], from: [0.0; 3], to: [0.0; 3], t: 1.0, alive: false, sub: 0 };

#[derive(Clone, Copy)]
struct Nodes {
    mode: [i32; 4],
    sign_in: i32,
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
    txt_open: i32,
    txt_draft: i32,
    txt_stage: i32,
    txt_low: i32,
    txt_status: i32,
    txt_vip: i32,
    txt_next: i32,
    txt_window: i32,
    txt_quiet: i32,
    inbox: i32,
    pile_later: i32,
    pile_done: i32,
    now_line: i32,
    panes: [i32; 3],
    veils: [i32; 4],
    /// MR only (absent in VR): dark plates behind text groups, see PLATES.
    plates: [i32; 9],
    tpl_msg: [i32; 6],
    tpl_event: i32,
    tpl_quiet: i32,
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
    /// Requests in flight: (request id, kind, a message index when it matters).
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
    n_event_nodes: usize,
    clone_seq: u32,
    creates_this_tick: i32,
    dirty: bool,
    open: Option<usize>,
    draft_page: usize,
    focus_task: Option<usize>,
    focus_left_s: f32,
    focus_running: bool,
    vip_s: f32,
    texts: [i32; MAX_TEXTS],
    n_texts: usize,
    text_refused: i32,
    last_net: i32,
}

const NO_NODES: Nodes = Nodes {
    mode: [0; 4],
    sign_in: 0,
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
    txt_open: 0,
    txt_draft: 0,
    txt_stage: 0,
    txt_low: 0,
    txt_status: 0,
    txt_vip: 0,
    txt_next: 0,
    txt_window: 0,
    txt_quiet: 0,
    inbox: 0,
    pile_later: 0,
    pile_done: 0,
    now_line: 0,
    panes: [0; 3],
    veils: [0; 4],
    plates: [0; 9],
    tpl_msg: [0; 6],
    tpl_event: 0,
    tpl_quiet: 0,
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
    n_event_nodes: 0,
    clone_seq: 0,
    creates_this_tick: 0,
    dirty: false,
    open: None,
    draft_page: 0,
    focus_task: None,
    focus_left_s: FOCUS_S,
    focus_running: false,
    vip_s: 0.0,
    texts: [0; MAX_TEXTS],
    n_texts: 0,
    text_refused: 0,
    last_net: -1,
};

static mut READ_BUF: [u8; READ_BUF_BYTES] = [0; READ_BUF_BYTES];
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

impl App {
    // --- world text, within the host's 32 -----------------------------------

    fn text(&mut self, node: i32, s: &[u8], offset_y: f32) {
        if node <= 0 || s.is_empty() {
            self.untext(node);
            return;
        }
        let held = self.texts[..self.n_texts].contains(&node);
        if !held && self.n_texts >= MAX_TEXTS {
            // Never ask the host for a 33rd text; the budget in DESIGN.md §4 keeps this at 0.
            self.text_refused += 1;
            return;
        }
        let rc = unsafe { host::k_ui_show_world_text(node, s.as_ptr() as i32, s.len() as i32, offset_y) };
        if rc == 0 && !held {
            self.texts[self.n_texts] = node;
            self.n_texts += 1;
        } else if rc != 0 {
            self.text_refused += 1;
        }
    }

    fn text_str(&mut self, node: i32, s: &str, offset_y: f32) {
        self.text(node, s.as_bytes(), offset_y);
    }

    fn untext(&mut self, node: i32) {
        if node <= 0 {
            return;
        }
        if let Some(i) = self.texts[..self.n_texts].iter().position(|&x| x == node) {
            unsafe { host::k_ui_hide_world_text(node) };
            self.n_texts -= 1;
            self.texts[i] = self.texts[self.n_texts];
            self.texts[self.n_texts] = 0;
        }
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

    fn destroy(&mut self, node: i32, sub: i32) {
        unsubscribe(sub);
        if node > 0 {
            self.untext(node);
            unsafe { host::k_node_destroy(node) };
        }
    }

    // --- status --------------------------------------------------------------

    /// A status message. Signed out, it goes on the stage beside the Sign in
    /// button, where you are looking; signed in, on the status line under the window.
    fn status(&mut self, s: &str, hold: bool) {
        let n = if self.signed_in { self.n.txt_status } else { self.n.txt_stage };
        let mut l = Lines::new(if self.signed_in { 26 } else { 30 }, 2);
        l.text(s);
        self.text(n, l.as_bytes(), 0.0);
        if hold {
            self.status_hold_s = STATUS_HOLD_S;
        }
    }

    fn live_status(&mut self) {
        if self.status_hold_s > 0.0 || !self.signed_in {
            return;
        }
        let mut b: Buf<64> = Buf::new();
        if unsafe { host::k_net_status() } != 1 {
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
        self.text(node, l.as_bytes(), 0.0);
    }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn k_init() {
    let a = app();
    let n = &mut a.n;
    n.mode = [find("BtnModeMorning"), find("BtnModeFocus"), find("BtnModeTriage"), find("BtnModeWrap")];
    n.sign_in = find("BtnSignIn");
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
    n.txt_open = find("TxtOpen");
    n.txt_draft = find("TxtDraft");
    n.txt_stage = find("TxtStage");
    n.txt_low = find("TxtStageLow");
    n.txt_status = find("TxtStatus");
    n.txt_vip = find("TxtVip");
    n.txt_next = find("TxtNext");
    n.txt_window = find("TxtWindow");
    n.txt_quiet = find("TxtQuiet");
    n.inbox = find("InboxTray");
    n.pile_later = find("PileLater");
    n.pile_done = find("PileDone");
    n.now_line = find("NowLine");
    n.panes = [find("PaneDay"), find("PaneDusk"), find("PaneNight")];
    n.veils = [find("VeilCal"), find("VeilWindow"), find("VeilTasks"), find("VeilDesk")];
    for (k, name) in PLATES.iter().enumerate() {
        n.plates[k] = find(name);
    }
    n.tpl_msg = [find("TplMsgGmail"), find("TplMsgSlack"), find("TplMsgGithub"), find("TplMsgLinear"), find("TplMsgVip"), find("TplMsgRead")];
    n.tpl_event = find("TplEvent");
    n.tpl_quiet = find("TplQuiet");
    n.mr = find("VariantMr") > 0;

    let presses = [
        n.mode[0], n.mode[1], n.mode[2], n.mode[3], n.sign_in, n.done, n.later, n.reply, n.task, n.mute, n.focus_go, n.approve, n.deny, n.more,
        n.prep_close, n.tasks[0], n.tasks[1], n.tasks[2],
    ];
    for node in presses {
        subscribe_press(node);
    }
    // Templates stay hidden; clones are shown as they are made.
    let tpls = [n.tpl_msg[0], n.tpl_msg[1], n.tpl_msg[2], n.tpl_msg[3], n.tpl_msg[4], n.tpl_msg[5], n.tpl_event, n.tpl_quiet];
    for t in tpls {
        visible(t, false);
    }
    let ev = "OnNetResult";
    unsafe { host::k_event_subscribe_global(ev.as_ptr() as i32, ev.len() as i32, on_net_result as usize as i32) };
    let ev = "OnPromptResult";
    unsafe { host::k_event_subscribe_global(ev.as_ptr() as i32, ev.len() as i32, on_prompt_result as usize as i32) };
    log("[more-room] init");
    render();
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
    }

    // Poll "what changed since N".
    if a.signed_in {
        a.poll_s += dt;
        if a.poll_s >= POLL_S && !a.in_flight(Req::Changes) {
            a.poll_s = 0.0;
            poll();
        }
    }

    // Slide cards to where they live.
    for i in 0..a.cards.len() {
        let c = &mut a.cards[i];
        if !c.alive || c.node <= 0 || c.t >= 1.0 {
            continue;
        }
        c.t = (c.t + dt / SLIDE_S).min(1.0);
        let e = c.t * c.t * (3.0 - 2.0 * c.t);
        let lift = 0.06 * 4.0 * e * (1.0 - e);
        c.pos = [c.from[0] + (c.to[0] - c.from[0]) * e, c.from[1] + (c.to[1] - c.from[1]) * e + lift, c.from[2] + (c.to[2] - c.from[2]) * e];
        place(c.node, c.pos);
    }

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
            let n = a.n.txt_vip;
            a.untext(n);
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
    if !a.signed_in {
        return;
    }
    if let Some(m) = n.mode.iter().position(|&x| x == node) {
        a.mode = [Mode::Morning, Mode::Focus, Mode::Triage, Mode::Wrap][m];
        a.showing_prep = false;
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
            act(if node == n.approve { "approve" } else { "deny" }, id.bytes());
            let msg = if node == n.approve { "Approved. The bridge sends it." } else { "Draft discarded." };
            a.status(msg, true);
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
    // A card?
    if let Some(i) = (0..a.cards.len()).find(|&i| a.cards[i].alive && a.cards[i].node == node) {
        press_card(i);
        return;
    }
    // An event tile?
    if let Some(e) = (0..a.n_event_nodes).find(|&e| a.events[e] == node) {
        if e < a.day.n_events && a.mode != Mode::Focus {
            let id = a.day.events[e].id;
            prep(id.bytes());
        }
    }
}

fn press_card(card: usize) {
    let a = app();
    if a.mode == Mode::Focus {
        return; // focus means focus: the desk is dimmed and does not answer
    }
    let id = a.cards[card].id;
    let Some(m) = a.day.msg_index(id.bytes()) else { return };
    if a.day.msgs[m].pile != Pile::In {
        return;
    }
    a.mode = Mode::Triage;
    a.showing_prep = false;
    a.open = Some(m);
    if !a.day.msgs[m].read {
        a.day.msgs[m].read = true; // turned over now; the bridge confirms on the next poll
        act("turn", id.bytes());
        reconcile(false);
    }
    render();
}

fn press_action(op: &'static str) {
    let a = app();
    let Some(m) = a.open else {
        a.status("Turn a card over first.", true);
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
        "draft" => a.status("Claude is drafting a reply...", true),
        "task" => a.status("Making a task...", true),
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
            Mode::Wrap => task.state == TaskState::Open,
            _ => task.pin && task.state == TaskState::Open,
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
                len = got as usize;
            }
        }
    }
    #[allow(static_mut_refs)]
    let body: &[u8] = unsafe { core::slice::from_raw_parts(core::ptr::addr_of!(READ_BUF) as *const u8, len) };

    if status == 401 && kind != Req::Session {
        a.signed_in = false;
        a.token = S::new();
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
                (429, b"hard_locked") => "Sign-in is locked. Unlock it on the PC.",
                (429, _) => "Too many tries. Wait 15 minutes.",
                (503, _) => "The bridge is stopped on the PC.",
                _ => "The bridge refused the sign-in.",
            };
            a.status(why, true);
        }
        Req::Changes => {
            if status == 200 && model::read_day(body, &mut a.day) {
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

fn look_for(m: &model::Msg) -> Look {
    if m.read || m.pile == Pile::Done {
        Look::Read
    } else if m.vip {
        Look::Vip
    } else {
        match m.src {
            Src::Gmail => Look::Gmail,
            Src::Slack => Look::Slack,
            Src::Github => Look::Github,
            _ => Look::Linear,
        }
    }
}

fn tpl_for(look: Look) -> i32 {
    let t = &app().n.tpl_msg;
    match look {
        Look::Gmail => t[0],
        Look::Slack => t[1],
        Look::Github => t[2],
        Look::Linear => t[3],
        Look::Vip => t[4],
        Look::Read => t[5],
    }
}

fn tick_sound() {
    let a = app();
    let node = a.n.inbox;
    unsafe { host::k_audio_play(node, TICK_SOUND.as_ptr() as i32, TICK_SOUND.len() as i32) };
}

/// Bring every card, event tile and shelf item in line with `app().day`.
/// `first`: the first day since sign-in (cards appear in place, nothing ticks).
fn reconcile(first: bool) {
    let a = app();

    // 1. Cards whose message is gone.
    for c in 0..a.cards.len() {
        if a.cards[c].alive && a.day.msg_index(a.cards[c].id.bytes()).is_none() {
            let (node, sub) = (a.cards[c].node, a.cards[c].sub);
            a.destroy(node, sub);
            a.cards[c] = EMPTY_CARD;
        }
    }

    // 2. Where every message lives now.
    let mut used = [false; L::GRID_SLOTS];
    for c in a.cards.iter() {
        if c.alive && c.slot != NO_SLOT && c.slot < L::GRID_SLOTS {
            used[c.slot] = true;
        }
    }
    let (mut later_k, mut done_k, mut quiet_k) = (0usize, 0usize, 0usize);
    let mut vip_landed: Option<usize> = None;
    for m in 0..a.day.n_msgs {
        let msg = a.day.msgs[m];
        let card_i = (0..a.cards.len()).find(|&c| a.cards[c].alive && a.cards[c].id.eq(msg.id.bytes()));
        let is_new = card_i.is_none();

        // Target position, or None when this message is counted but not drawn.
        let mut slot = NO_SLOT;
        let target: Option<[f32; 3]> = match msg.pile {
            Pile::In => {
                let keep = card_i.map(|c| a.cards[c].slot).filter(|&s| s != NO_SLOT && s < L::GRID_SLOTS);
                slot = match keep {
                    Some(s) => s,
                    None => match used.iter().position(|&u| !u) {
                        Some(s) => {
                            used[s] = true;
                            s
                        }
                        None => NO_SLOT,
                    },
                };
                if slot == NO_SLOT { None } else { Some(L::grid_slot(slot)) }
            }
            Pile::Later => {
                let k = later_k;
                later_k += 1;
                if k < L::PILE_SHOWN {
                    Some([L::PILE_LATER[0], L::PILE_LATER[1] + k as f32 * L::PILE_STEP_Y, L::PILE_LATER[2]])
                } else {
                    None
                }
            }
            Pile::Done => {
                let k = done_k;
                done_k += 1;
                if k < L::PILE_SHOWN {
                    Some([L::PILE_DONE[0], L::PILE_DONE[1] + k as f32 * L::PILE_STEP_Y, L::PILE_DONE[2]])
                } else {
                    None
                }
            }
            Pile::Quiet => {
                let k = quiet_k;
                quiet_k += 1;
                if k < L::SHELF_SLOTS.len() {
                    Some([L::SHELF_X, L::SHELF_Y, L::SHELF_SLOTS[k]])
                } else {
                    None
                }
            }
        };

        match (card_i, target) {
            (Some(c), None) => {
                // Counted, not drawn (a full pile, a full desk).
                let (node, sub) = (a.cards[c].node, a.cards[c].sub);
                a.destroy(node, sub);
                a.cards[c] = EMPTY_CARD;
            }
            (None, None) => {}
            (None, Some(to)) => {
                let look = look_for(&msg);
                let node = a.clone_of(tpl_for(look));
                if node <= 0 {
                    continue; // next tick (dirty) or a cap
                }
                let Some(free) = a.cards.iter().position(|c| !c.alive) else {
                    a.destroy(node, 0);
                    continue;
                };
                let sub = subscribe_press(node);
                // A card that arrives while you are in the room lands where it lives:
                // out of the inbox tray, into its slot. Nothing moves toward you.
                let from = if first { to } else { L::INBOX };
                a.cards[free] = Card { id: msg.id, node, look, slot, pos: from, from, to, t: if first { 1.0 } else { 0.0 }, alive: true, sub };
                place(node, from);
                if !first && is_new && msg.pile == Pile::In && msg.vip {
                    vip_landed = Some(m);
                }
            }
            (Some(c), Some(to)) => {
                let look = look_for(&msg);
                if a.cards[c].look != look {
                    // Turned over (or became VIP): a new face, in the same place.
                    let (old, old_sub) = (a.cards[c].node, a.cards[c].sub);
                    let node = a.clone_of(tpl_for(look));
                    if node > 0 {
                        a.destroy(old, old_sub);
                        a.cards[c].sub = subscribe_press(node);
                        a.cards[c].node = node;
                        a.cards[c].look = look;
                        place(node, a.cards[c].pos);
                    }
                }
                a.cards[c].slot = slot;
                let card = &mut a.cards[c];
                if card.to != to {
                    card.from = card.pos;
                    card.to = to;
                    card.t = 0.0;
                }
            }
        }
    }

    // 3. The calendar.
    while a.n_event_nodes < a.day.n_events {
        let tpl = a.n.tpl_event;
        let node = a.clone_of(tpl);
        if node <= 0 {
            break;
        }
        a.event_subs[a.n_event_nodes] = subscribe_press(node);
        a.events[a.n_event_nodes] = node;
        a.n_event_nodes += 1;
    }
    while a.n_event_nodes > a.day.n_events {
        a.n_event_nodes -= 1;
        let (node, sub) = (a.events[a.n_event_nodes], a.event_subs[a.n_event_nodes]);
        a.destroy(node, sub);
        a.events[a.n_event_nodes] = 0;
        a.event_subs[a.n_event_nodes] = 0;
    }
    for e in 0..a.n_event_nodes {
        let ev = a.day.events[e];
        place(a.events[e], [L::CAL_X, L::CAL_Y, L::cal_z(ev.start) + L::EVENT_HALF_W]);
    }

    if let Some(m) = vip_landed {
        tick_sound();
        let mut l = Lines::new(24, 2);
        l.text("VIP:");
        l.words(a.day.msgs[m].from.bytes());
        let node = a.n.txt_vip;
        a.text(node, l.as_bytes(), 0.0);
        a.vip_s = VIP_LINE_S;
    }
}

// ---------------------------------------------------------------------------
// Render: what the room shows in the current mode
// ---------------------------------------------------------------------------

fn show_timer() {
    let a = app();
    let s = a.focus_left_s.max(0.0) as i32;
    let mut b: Buf<128> = Buf::new();
    b.int(s / 60);
    b.byte(b':');
    b.int2(s % 60);
    b.push(if a.focus_running { "  focus" } else if s == 0 { "  time - take a break" } else { "  paused" });
    let node = a.n.txt_low;
    a.text(node, b.as_bytes(), 0.0);
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

pub fn render() {
    let a = app();
    let n = a.n;
    let mode = a.mode;
    let on = a.signed_in;

    // --- Buttons and groups.
    visible(n.sign_in, !on);
    for b in n.mode {
        visible(b, on);
    }
    let triage_open = on && mode == Mode::Triage && a.open.is_some();
    for b in [n.done, n.later, n.reply, n.task, n.mute] {
        visible(b, triage_open);
    }
    visible(n.focus_go, on && mode == Mode::Focus);
    let draft = if on && mode == Mode::Triage { a.day.pending_draft() } else { None };
    for b in [n.approve, n.deny, n.more] {
        visible(b, draft.is_some());
    }
    visible(n.prep_close, on && a.showing_prep);
    for v in n.veils {
        visible(v, on && mode == Mode::Focus);
    }
    for (k, &t) in n.tasks.iter().enumerate() {
        let shown = on && mode != Mode::Focus && mode != Mode::Triage && shown_task(k).is_some();
        visible(t, shown);
    }
    visible(n.now_line, on);
    for c in a.cards.iter() {
        if c.alive {
            visible(c.node, on);
        }
    }
    for e in 0..a.n_event_nodes {
        visible(a.events[e], on);
    }
    // The window pane follows the bridge's clock against sunset.
    let pane = if a.day.now_min < a.day.sunset_min - 45 {
        0
    } else if a.day.now_min < a.day.sunset_min + 30 {
        1
    } else {
        2
    };
    for (k, &p) in n.panes.iter().enumerate() {
        visible(p, k == if on { pane } else { 2 });
    }
    place(n.now_line, [L::NOW_LINE_X, L::NOW_LINE_Y, L::cal_z(a.day.now_min)]);

    // --- Texts. Signed out: the sign-in label and the status only.
    let all = [
        n.mode[0], n.mode[1], n.mode[2], n.mode[3], n.done, n.later, n.reply, n.task, n.mute, n.focus_go, n.approve, n.deny, n.more, n.prep_close,
        n.tasks[0], n.tasks[1], n.tasks[2], n.txt_open, n.txt_draft, n.txt_stage, n.txt_low, n.txt_next, n.txt_window, n.txt_quiet, n.inbox,
        n.pile_later, n.pile_done,
    ];
    if !on {
        // The stage keeps a held message (a refusal you need to read); status() writes it.
        for node in all {
            if node != n.txt_stage || a.status_hold_s <= 0.0 {
                a.untext(node);
            }
        }
        for e in 0..a.n_event_nodes {
            let node = a.events[e];
            a.untext(node);
        }
        let st = n.txt_status;
        a.untext(st);
        let si = n.sign_in;
        a.text_str(si, "Sign in", 0.07);
        if a.status_hold_s <= 0.0 {
            a.status("More Room. Sign in to your bridge.", false);
        }
        show_plates();
        return;
    }
    let si = n.sign_in;
    a.untext(si);

    // Mode bar: the current mode is marked.
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
        a.text(node, b.as_bytes(), 0.035);
    }

    let (inbox, vip, later, done, quiet) = counts();

    // Inbox tray and piles.
    {
        let mut b: Buf<64> = Buf::new();
        b.push("Inbox ");
        b.int(inbox);
        if vip > 0 {
            b.push("\n");
            b.int(vip);
            b.push(" VIP");
        }
        let hidden = (inbox as usize).saturating_sub(L::GRID_SLOTS);
        if hidden > 0 {
            b.push("\n+");
            b.int(hidden as i32);
            b.push(" more");
        }
        let node = a.n.inbox;
        if mode == Mode::Focus {
            a.untext(node);
        } else {
            a.text(node, b.as_bytes(), 0.1);
        }
        let mut b: Buf<32> = Buf::new();
        b.push("Later ");
        b.int(later);
        let node = a.n.pile_later;
        if mode == Mode::Triage {
            a.text(node, b.as_bytes(), 0.12);
        } else {
            a.untext(node);
        }
        let mut b: Buf<32> = Buf::new();
        b.push("Done ");
        b.int(done);
        let node = a.n.pile_done;
        if mode == Mode::Triage {
            a.text(node, b.as_bytes(), 0.12);
        } else {
            a.untext(node);
        }
    }

    // The quiet shelf behind you.
    {
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
        let node = a.n.txt_quiet;
        a.text(node, l.as_bytes(), 0.0);
    }

    // The window: weather, sunset, one headline. Dimmed (no text) in focus.
    {
        let node = a.n.txt_window;
        if mode == Mode::Focus {
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
            a.text(node, l.as_bytes(), 0.0);
        }
    }

    // The calendar: every event labelled, at alternating heights, except in focus.
    for e in 0..a.n_event_nodes {
        let node = a.events[e];
        if mode == Mode::Focus || e >= a.day.n_events {
            a.untext(node);
            continue;
        }
        let ev = a.day.events[e];
        let mut b: Buf<128> = Buf::new();
        text::clock(&mut b, ev.start);
        let mut l = Lines::new(14, 2);
        l.text(b.as_str());
        l.newline();
        l.words(ev.title.bytes());
        let off = if e % 2 == 0 { 0.07 } else { 0.29 };
        a.text(node, l.as_bytes(), off);
    }
    // In focus only the next event shows, above the strip.
    {
        let node = a.n.txt_next;
        if mode == Mode::Focus {
            let next = (0..a.day.n_events).find(|&e| a.day.events[e].start >= a.day.now_min);
            match next {
                Some(e) => {
                    let ev = a.day.events[e];
                    let mut b: Buf<128> = Buf::new();
                    b.push("Next: ");
                    text::clock(&mut b, ev.start);
                    b.push(" ");
                    b.bytes(ev.title.bytes());
                    a.text(node, b.as_bytes(), 0.0);
                }
                None => a.text_str(node, "Nothing else today", 0.0),
            }
        } else {
            a.untext(node);
        }
    }

    // The stage and the line under it.
    let stage = a.n.txt_stage;
    let low = a.n.txt_low;
    if a.showing_prep {
        let mut l = Lines::new(30, 4);
        for k in 0..a.prep.n {
            if k > 0 {
                l.newline();
            }
            l.words(a.prep.lines[k].bytes());
        }
        a.text(stage, l.as_bytes(), 0.0);
        let pc = a.n.prep_close;
        a.text_str(pc, "Close", 0.06);
        a.untext(low);
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
                a.text(stage, l.as_bytes(), 0.0);
                let mut b: Buf<64> = Buf::new();
                b.int(inbox);
                b.push(" messages");
                if vip > 0 {
                    b.push(", ");
                    b.int(vip);
                    b.push(" from VIPs");
                }
                a.text(low, b.as_bytes(), 0.0);
            }
            Mode::Focus => {
                let mut l = Lines::new(24, 3);
                l.text("Focus on:");
                l.newline();
                let task = a.focus_task.filter(|&i| i < a.day.n_tasks).or_else(|| shown_first_open());
                match task {
                    Some(i) => l.words(a.day.tasks[i].title.bytes()),
                    None => l.text("press a pinned task in Morning"),
                }
                a.text(stage, l.as_bytes(), 0.0);
                show_timer();
            }
            Mode::Triage => {
                if a.open.is_none() && a.day.pending_draft().is_none() {
                    a.text_str(stage, "Press a card to turn it over", 0.0);
                } else {
                    a.untext(stage);
                }
                a.untext(low);
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
                l.text("Press a task to roll it");
                a.text(stage, l.as_bytes(), 0.0);
                let mut l2 = Lines::new(32, 2);
                l2.text("First tomorrow:");
                l2.newline();
                l2.words(a.day.first_tomorrow.bytes());
                a.text(low, l2.as_bytes(), 0.0);
            }
        }
    }

    // Focus start/pause.
    {
        let node = a.n.focus_go;
        if mode == Mode::Focus {
            let label = if a.focus_running { "Pause" } else if a.focus_left_s <= 0.0 { "Again" } else { "Start" };
            a.text_str(node, label, 0.06);
        } else {
            a.untext(node);
        }
    }

    // Task tiles (Morning: pinned; Wrap: what rolls).
    for k in 0..3 {
        let node = a.n.tasks[k];
        let task = if mode == Mode::Morning || mode == Mode::Wrap { shown_task(k) } else { None };
        match task {
            Some(i) => {
                let mut l = Lines::new(18, 2);
                if mode == Mode::Wrap {
                    l.text("Roll:");
                }
                l.words(a.day.tasks[i].title.bytes());
                a.text(node, l.as_bytes(), 0.04);
            }
            None => a.untext(node),
        }
    }

    // Triage: the opened card, its actions, and a waiting draft.
    {
        let open = if mode == Mode::Triage { a.open.filter(|&m| m < a.day.n_msgs && a.day.msgs[m].pile == Pile::In) } else { None };
        if mode == Mode::Triage && open.is_none() {
            a.open = None;
        }
        let node = a.n.txt_open;
        match open {
            Some(m) => {
                let msg = a.day.msgs[m];
                let mut l = Lines::new(30, 4);
                l.words(msg.from.bytes());
                if msg.vip {
                    l.text("(VIP)");
                }
                l.newline();
                l.words(msg.subject.bytes());
                l.newline();
                l.words(msg.preview.bytes());
                a.text(node, l.as_bytes(), 0.0);
            }
            None => a.untext(node),
        }
        let labels = [(a.n.done, "Done"), (a.n.later, "Later"), (a.n.reply, "Reply"), (a.n.task, "Task"), (a.n.mute, "Mute")];
        for (node, label) in labels {
            if open.is_some() {
                a.text_str(node, label, 0.04);
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
                let mut l = Lines::new(26, 4);
                l.text("Draft to");
                l.words(dr.to.bytes());
                l.newline();
                draft_page_into(dr.text.bytes(), page, &mut l);
                a.text(tdraft, l.as_bytes(), 0.0);
                let (ap, dn, mo) = (a.n.approve, a.n.deny, a.n.more);
                a.text_str(ap, "Approve", 0.05);
                a.text_str(dn, "Deny", 0.05);
                if pages > 1 {
                    let mut b: Buf<16> = Buf::new();
                    b.push("More ");
                    b.int(page as i32 + 1);
                    b.push("/");
                    b.int(pages as i32);
                    a.text(mo, b.as_bytes(), 0.05);
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

/// MR plates, in the order of `Nodes::plates` (mirrors PLATES in tools/build_glb.mjs).
const PLATES: [&str; 9] = ["PlateStage", "PlateCal", "PlateOpen", "PlateDraft", "PlateTasks", "PlateModes", "PlateWindow", "PlateVip", "PlateQuiet"];

/// MR only: show each dark plate only while a text it frames is showing.
/// (World text is always white; a light real wall behind it is unreadable.)
fn show_plates() {
    let a = app();
    let n = a.n;
    if !n.mr {
        return;
    }
    let held = |node: i32| node > 0 && a.texts[..a.n_texts].contains(&node);
    let events = (0..a.n_event_nodes).any(|e| held(a.events[e]));
    let wanted = [
        held(n.txt_stage) || held(n.txt_low),
        events || held(n.txt_next),
        held(n.txt_open) || held(n.done),
        held(n.txt_draft),
        n.tasks.iter().any(|&t| held(t)),
        n.mode.iter().any(|&m| held(m)),
        held(n.txt_window) || held(n.txt_status),
        held(n.txt_vip),
        held(n.txt_quiet),
    ];
    for k in 0..PLATES.len() {
        visible(n.plates[k], wanted[k]);
    }
}

fn shown_first_open() -> Option<usize> {
    let d = &app().day;
    (0..d.n_tasks).find(|&i| d.tasks[i].pin && d.tasks[i].state == TaskState::Open)
}

const DRAFT_W: usize = 26;
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
            let mut l = Lines::new(26, 4);
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
    fn calendar_maps_the_working_day() {
        assert!((L::cal_z(7 * 60) - -2.1).abs() < 1e-5);
        assert!((L::cal_z(19 * 60) - 2.1).abs() < 1e-4);
        assert!((L::cal_z(13 * 60) - 0.0).abs() < 1e-4);
        assert_eq!(L::cal_z(3 * 60), L::cal_z(7 * 60), "before 7 clamps to the start");
    }

    #[test]
    fn grid_slots_are_on_the_desk() {
        for i in 0..L::GRID_SLOTS {
            let p = L::grid_slot(i);
            assert!(p[0] > 0.42 && p[0] < 1.12 && p[2].abs() < 0.95, "slot {i} {p:?}");
        }
    }
}
