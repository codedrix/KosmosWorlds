//! The day, as the bridge last described it, and the DAY/1 reader.
//!
//! @kosmos-system  Content (KosmosWorlds) -- More Room
//! @kosmos-owner   More Room v1
//!
//! The wire is defined in agent-bridge/src/faces/more-room/day-core.ts: one record per
//! line, fields split by TAB. Unknown records are skipped, so the bridge can
//! add records without breaking an older room. Everything is fixed-size:
//! a world has no allocator here, and a day that is larger than these tables
//! is shown as far as it fits.

use crate::text::S;

pub const MAX_EVENTS: usize = 8;
pub const MAX_TASKS: usize = 16;
pub const MAX_MSGS: usize = 48;
pub const MAX_DRAFTS: usize = 4;
pub const MAX_BRIEF: usize = 4;
pub const MAX_PREP: usize = 4;

pub type Id = S<32>;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Src {
    Gmail,
    Slack,
    Github,
    Linear,
    Other,
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Pile {
    In,
    Later,
    Done,
    Quiet,
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum TaskState {
    Open,
    Done,
    Rolled,
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum DraftState {
    Pending,
    Sent,
    Denied,
}

#[derive(Clone, Copy)]
pub struct Event {
    pub id: Id,
    pub start: i32,
    pub end: i32,
    pub title: S<16>,
    pub has_prep: bool,
}

#[derive(Clone, Copy)]
pub struct Task {
    pub id: Id,
    pub pin: bool,
    pub state: TaskState,
    pub title: S<28>,
}

#[derive(Clone, Copy)]
pub struct Msg {
    pub id: Id,
    pub src: Src,
    pub vip: bool,
    pub pile: Pile,
    pub read: bool,
    pub from: S<24>,
    pub subject: S<30>,
    pub preview: S<84>,
}

#[derive(Clone, Copy)]
pub struct Draft {
    pub id: Id,
    pub msg: Id,
    pub state: DraftState,
    pub to: S<24>,
    pub text: S<304>,
}

pub struct Day {
    pub rev: i32,
    pub same: bool,
    pub now_min: i32,
    pub sunset_min: i32,
    pub date: S<16>,
    pub brief: [S<32>; MAX_BRIEF],
    pub n_brief: usize,
    pub events: [Event; MAX_EVENTS],
    pub n_events: usize,
    pub tasks: [Task; MAX_TASKS],
    pub n_tasks: usize,
    pub msgs: [Msg; MAX_MSGS],
    pub n_msgs: usize,
    pub drafts: [Draft; MAX_DRAFTS],
    pub n_drafts: usize,
    pub weather: S<16>,
    pub headline: S<60>,
    pub first_tomorrow: S<36>,
    /// Records this reader did not know (a newer bridge).
    pub unknown: i32,
    /// The answer was a complete DAY/1 document (it ended with END).
    pub complete: bool,
}

const EMPTY_EVENT: Event = Event { id: S::new(), start: 0, end: 0, title: S::new(), has_prep: false };
const EMPTY_TASK: Task = Task { id: S::new(), pin: false, state: TaskState::Open, title: S::new() };
const EMPTY_MSG: Msg = Msg { id: S::new(), src: Src::Other, vip: false, pile: Pile::In, read: false, from: S::new(), subject: S::new(), preview: S::new() };
const EMPTY_DRAFT: Draft = Draft { id: S::new(), msg: S::new(), state: DraftState::Pending, to: S::new(), text: S::new() };

impl Day {
    pub const fn new() -> Self {
        Self {
            rev: 0,
            same: false,
            now_min: 9 * 60,
            sunset_min: 19 * 60,
            date: S::new(),
            brief: [S::new(); MAX_BRIEF],
            n_brief: 0,
            events: [EMPTY_EVENT; MAX_EVENTS],
            n_events: 0,
            tasks: [EMPTY_TASK; MAX_TASKS],
            n_tasks: 0,
            msgs: [EMPTY_MSG; MAX_MSGS],
            n_msgs: 0,
            drafts: [EMPTY_DRAFT; MAX_DRAFTS],
            n_drafts: 0,
            weather: S::new(),
            headline: S::new(),
            first_tomorrow: S::new(),
            unknown: 0,
            complete: false,
        }
    }

    pub fn clear(&mut self) {
        let keep_now = (self.now_min, self.sunset_min);
        *self = Day::new();
        self.now_min = keep_now.0;
        self.sunset_min = keep_now.1;
    }

    pub fn msg_index(&self, id: &[u8]) -> Option<usize> {
        (0..self.n_msgs).find(|&i| self.msgs[i].id.eq(id))
    }

    pub fn pending_draft(&self) -> Option<usize> {
        (0..self.n_drafts).rev().find(|&i| self.drafts[i].state == DraftState::Pending)
    }
}

/// Split a line into TAB fields (at most 10).
fn fields(line: &[u8]) -> ([&[u8]; 10], usize) {
    let mut out: [&[u8]; 10] = [&[]; 10];
    let mut n = 0;
    let mut start = 0;
    for i in 0..=line.len() {
        if i == line.len() || line[i] == b'\t' {
            if n < 10 {
                out[n] = &line[start..i];
                n += 1;
            }
            start = i + 1;
        }
    }
    (out, n)
}

pub fn int(s: &[u8]) -> i32 {
    let mut v: i32 = 0;
    let mut neg = false;
    for (k, &c) in s.iter().enumerate() {
        if k == 0 && c == b'-' {
            neg = true;
        } else if c.is_ascii_digit() {
            v = v.saturating_mul(10).saturating_add((c - b'0') as i32);
        } else {
            break;
        }
    }
    if neg {
        -v
    } else {
        v
    }
}

fn lines(body: &[u8]) -> impl Iterator<Item = &[u8]> {
    body.split(|&c| c == b'\n').map(|l| if l.last() == Some(&b'\r') { &l[..l.len() - 1] } else { l })
}

/// Read a /changes answer into `day`. Returns false when it is not DAY/1.
/// A "SAME" answer updates only the clock and leaves the rest untouched.
pub fn read_day(body: &[u8], day: &mut Day) -> bool {
    let mut it = lines(body);
    let Some(head) = it.next() else { return false };
    let (h, hn) = fields(head);
    if hn < 3 || h[0] != b"DAY/1" || h[1] != b"rev" {
        return false;
    }
    let rev = int(h[2]);
    // Peek for SAME before clearing anything.
    let same = lines(body).any(|l| l == b"SAME");
    if same {
        for l in lines(body) {
            let (f, n) = fields(l);
            if n >= 3 && f[0] == b"NOW" {
                day.now_min = int(f[1]);
                day.sunset_min = int(f[2]);
            }
        }
        day.same = true;
        day.rev = rev;
        return true;
    }
    day.clear();
    day.rev = rev;
    for l in it {
        let (f, n) = fields(l);
        if n == 0 || f[0].is_empty() {
            continue;
        }
        match f[0] {
            b"NOW" if n >= 3 => {
                day.now_min = int(f[1]);
                day.sunset_min = int(f[2]);
            }
            b"DATE" if n >= 2 => day.date.set(f[1]),
            b"BRIEF" if n >= 2 => {
                if day.n_brief < MAX_BRIEF {
                    day.brief[day.n_brief].set(f[1]);
                    day.n_brief += 1;
                }
            }
            b"EV" if n >= 6 => {
                if day.n_events < MAX_EVENTS {
                    let e = &mut day.events[day.n_events];
                    e.id.set(f[1]);
                    e.start = int(f[2]);
                    e.end = int(f[3]);
                    e.title.set(f[4]);
                    e.has_prep = f[5] == b"1";
                    day.n_events += 1;
                }
            }
            b"TASK" if n >= 5 => {
                if day.n_tasks < MAX_TASKS {
                    let t = &mut day.tasks[day.n_tasks];
                    t.id.set(f[1]);
                    t.pin = f[2] == b"1";
                    t.state = match f[3] {
                        b"done" => TaskState::Done,
                        b"rolled" => TaskState::Rolled,
                        _ => TaskState::Open,
                    };
                    t.title.set(f[4]);
                    day.n_tasks += 1;
                }
            }
            b"MSG" if n >= 9 => {
                if day.n_msgs < MAX_MSGS {
                    let m = &mut day.msgs[day.n_msgs];
                    m.id.set(f[1]);
                    m.src = match f[2] {
                        b"gmail" => Src::Gmail,
                        b"slack" => Src::Slack,
                        b"github" => Src::Github,
                        b"linear" => Src::Linear,
                        _ => Src::Other,
                    };
                    m.vip = f[3] == b"1";
                    m.pile = match f[4] {
                        b"later" => Pile::Later,
                        b"done" => Pile::Done,
                        b"quiet" => Pile::Quiet,
                        _ => Pile::In,
                    };
                    m.read = f[5] == b"1";
                    m.from.set(f[6]);
                    m.subject.set(f[7]);
                    m.preview.set(f[8]);
                    day.n_msgs += 1;
                }
            }
            b"DRAFT" if n >= 6 => {
                if day.n_drafts < MAX_DRAFTS {
                    let d = &mut day.drafts[day.n_drafts];
                    d.id.set(f[1]);
                    d.msg.set(f[2]);
                    d.state = match f[3] {
                        b"sent" => DraftState::Sent,
                        b"denied" => DraftState::Denied,
                        _ => DraftState::Pending,
                    };
                    d.to.set(f[4]);
                    d.text.set(f[5]);
                    day.n_drafts += 1;
                }
            }
            b"WIN" if n >= 3 => {
                day.weather.set(f[1]);
                day.headline.set(f[2]);
            }
            b"WRAP" if n >= 3 && f[1] == b"first" => day.first_tomorrow.set(f[2]),
            b"END" => {
                day.complete = true;
                break;
            }
            _ => day.unknown += 1,
        }
    }
    day.same = false;
    day.complete
}

/// The prep sheet for one event.
pub struct Prep {
    pub event: Id,
    pub lines: [S<32>; MAX_PREP],
    pub n: usize,
}

impl Prep {
    pub const fn new() -> Self {
        Self { event: S::new(), lines: [S::new(); MAX_PREP], n: 0 }
    }
}

pub fn read_prep(body: &[u8], prep: &mut Prep) -> bool {
    let mut it = lines(body);
    let Some(head) = it.next() else { return false };
    let (h, hn) = fields(head);
    if hn < 2 || h[0] != b"PREP" {
        return false;
    }
    prep.event.set(h[1]);
    prep.n = 0;
    for l in it {
        let (f, n) = fields(l);
        if n >= 2 && f[0] == b"P" && prep.n < MAX_PREP {
            prep.lines[prep.n].set(f[1]);
            prep.n += 1;
        }
        if n >= 1 && f[0] == b"END" {
            return true;
        }
    }
    false
}

/// "TOKEN\t<hex>\t<ttl>" or "OK\t<rev>\t<note>": the second and third fields.
pub fn read_pair<'a>(body: &'a [u8], tag: &[u8]) -> Option<(&'a [u8], &'a [u8])> {
    let first = lines(body).next()?;
    let (f, n) = fields(first);
    if n >= 2 && f[0] == tag {
        Some((f[1], if n >= 3 { f[2] } else { &[] }))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SNAP: &[u8] = b"DAY/1\trev\t7\nNOW\t600\t1138\nDATE\tWed 14 Oct\nBRIEF\t3 things need you today:\nEV\tev-a\t540\t570\tStandup\t1\nTASK\tt-a\t1\topen\tApprove counsel reply\nMSG\tm-a\tgmail\t1\tin\t0\tCounsel (sample)\tTerms: one question\tCan we keep it?\nDRAFT\td-m-a-1\tm-a\tpending\tCounsel (sample)\tKeep it as drafted.\nWIN\t68F clear\tSample headline\nWRAP\tfirst\tSend the tester invites\nFUTURE\tx\nEND\n";

    #[test]
    fn reads_a_whole_day() {
        let mut d = Day::new();
        assert!(read_day(SNAP, &mut d));
        assert_eq!(d.rev, 7);
        assert_eq!(d.now_min, 600);
        assert_eq!(d.n_events, 1);
        assert_eq!(d.events[0].start, 540);
        assert!(d.events[0].has_prep);
        assert_eq!(d.n_msgs, 1);
        assert!(d.msgs[0].vip);
        assert_eq!(d.msgs[0].pile, Pile::In);
        assert_eq!(d.pending_draft(), Some(0));
        assert_eq!(d.first_tomorrow.as_str(), "Send the tester invites");
        assert_eq!(d.unknown, 1, "an unknown record is skipped, not fatal");
    }

    #[test]
    fn same_keeps_the_day() {
        let mut d = Day::new();
        read_day(SNAP, &mut d);
        assert!(read_day(b"DAY/1\trev\t7\nNOW\t610\t1138\nSAME\nEND\n", &mut d));
        assert!(d.same);
        assert_eq!(d.n_msgs, 1);
        assert_eq!(d.now_min, 610);
    }

    #[test]
    fn refuses_other_documents() {
        let mut d = Day::new();
        assert!(!read_day(b"<html>", &mut d));
        assert!(!read_day(b"", &mut d));
    }

    #[test]
    fn a_cut_answer_is_not_complete() {
        let mut d = Day::new();
        assert!(!read_day(b"DAY/1\trev\t3\nMSG\tm-a\tgmail\t0\tin\t0\tA\tB\tC\n", &mut d));
    }

    #[test]
    fn reads_prep_and_pairs() {
        let mut p = Prep::new();
        assert!(read_prep(b"PREP\tev-a\nP\tStandup 9:00\nP\tWith: two\nEND\n", &mut p));
        assert_eq!(p.n, 2);
        assert_eq!(read_pair(b"TOKEN\tabc\t43200\n", b"TOKEN").unwrap().0, b"abc");
        assert_eq!(read_pair(b"OK\t9\tKOS-MOCK-1 created\n", b"OK").unwrap().1, b"KOS-MOCK-1 created");
        assert!(read_pair(b"NO\tx\n", b"OK").is_none());
    }
}
