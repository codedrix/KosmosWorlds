//! style.rs -- the ONE place a text's placement and a state's colour are chosen.
//!
//! @kosmos-system  Content (KosmosWorlds) -- More Room
//! @kosmos-owner   More Room v2, the Day Ring
//!
//! Today a world can print only white 8 cm text and cannot change a colour at
//! runtime, so placement is an offset and a colour is a pre-built variant
//! (a template of that colour, cloned). When the visual pack (DB-045) lands,
//! these two functions are where styled text (size, colour, weight, a plate)
//! and runtime colours drop in; nothing else in the script needs to change.

use crate::model::{Event, Msg, Pile, Src};

/// Where a text sits on its anchor.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Place {
    /// On a plaque (a thin card printed flat by the client), centred on it.
    Plaque,
    /// A short label above a puck.
    Puck,
    /// A label above an event pill on the Day Ring, on one of two rows.
    Ring(u8),
    /// Free-floating text, its bottom at the anchor.
    Float,
    /// A count above a pile or the inbox well.
    Pile,
}

/// The height of one line of world text (8 cm glyphs, spaced).
pub const LINE_H: f32 = 0.084;

/// The vertical offset for a text of `lines` lines at `place` (the host's
/// `offset_y`: from the anchor's rendered centre to the text's bottom).
pub fn offset(place: Place, lines: usize) -> f32 {
    let n = lines.max(1) as f32;
    match place {
        // Centre the block: its bottom half a block below the plaque's centre.
        Place::Plaque => -(0.08 + (n - 1.0) * LINE_H) / 2.0,
        Place::Puck => 0.035,
        Place::Ring(0) => 0.1,
        Place::Ring(_) => 0.31,
        Place::Float => 0.0,
        Place::Pile => 0.03,
    }
}

/// A state's colour. Each is a pre-built template today (see `Nodes::tpl` in lib.rs).
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Tone {
    EventPast,
    EventNow,
    EventFuture,
    CardGmail,
    CardSlack,
    CardGithub,
    CardLinear,
    CardVip,
    CardRead,
}

/// An event's colour at `now_min`: the morning dims, now glows amber, later glows blue.
pub fn event_tone(ev: &Event, now_min: i32) -> Tone {
    if ev.end <= now_min {
        Tone::EventPast
    } else if ev.start <= now_min {
        Tone::EventNow
    } else {
        Tone::EventFuture
    }
}

/// A card's colour: face-up once read (or done); an unread VIP has the amber rim;
/// otherwise its source's rim.
pub fn card_tone(m: &Msg) -> Tone {
    if m.read || m.pile == Pile::Done {
        Tone::CardRead
    } else if m.vip {
        Tone::CardVip
    } else {
        match m.src {
            Src::Gmail => Tone::CardGmail,
            Src::Slack => Tone::CardSlack,
            Src::Github => Tone::CardGithub,
            _ => Tone::CardLinear,
        }
    }
}

/// The template (variant) that wears a tone, by node name in world.glb.
pub fn template(t: Tone) -> &'static str {
    match t {
        Tone::EventPast => "TplEventPast",
        Tone::EventNow => "TplEventNow",
        Tone::EventFuture => "TplEvent",
        Tone::CardGmail => "TplMsgGmail",
        Tone::CardSlack => "TplMsgSlack",
        Tone::CardGithub => "TplMsgGithub",
        Tone::CardLinear => "TplMsgLinear",
        Tone::CardVip => "TplMsgVip",
        Tone::CardRead => "TplMsgRead",
    }
}

pub const TONES: [Tone; 9] = [
    Tone::EventPast,
    Tone::EventNow,
    Tone::EventFuture,
    Tone::CardGmail,
    Tone::CardSlack,
    Tone::CardGithub,
    Tone::CardLinear,
    Tone::CardVip,
    Tone::CardRead,
];

/// The index of a tone in `TONES` (and in `Nodes::tpl`).
pub fn tone_index(t: Tone) -> usize {
    TONES.iter().position(|&x| x == t).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plaque_text_is_centred() {
        assert!((offset(Place::Plaque, 1) + 0.04).abs() < 1e-6);
        assert!(offset(Place::Plaque, 4) < offset(Place::Plaque, 2));
    }

    #[test]
    fn every_tone_has_a_template() {
        for t in TONES {
            assert!(template(t).starts_with("Tpl"));
            assert_eq!(TONES[tone_index(t)], t);
        }
    }
}
