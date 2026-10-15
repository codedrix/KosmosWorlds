//! Fixed-size strings and the line layout every world text goes through.
//!
//! @kosmos-system  Content (KosmosWorlds) -- More Room
//! @kosmos-owner   More Room v1
//!
//! World text on the headset is one white engine font, 8 cm tall, about
//! 3.6 cm a character, at most 4 lines and 128 bytes per text (the host
//! refuses longer text rather than cutting it). So every text here is built
//! by `wrap`, which keeps to a width in characters, a number of lines and the
//! 128-byte cap, and marks a cut with "...".

/// The host refuses world text over this many bytes (`KWasm::MAX_WORLD_TEXT_BYTES`).
pub const HOST_TEXT_MAX_BYTES: usize = 128;
/// The host keeps up to this many lines in one text.
pub const HOST_TEXT_MAX_LINES: usize = 4;

/// An inline string of at most N bytes (ASCII only; the bridge sends ASCII).
#[derive(Clone, Copy)]
pub struct S<const N: usize> {
    pub b: [u8; N],
    pub n: usize,
}

impl<const N: usize> S<N> {
    pub const fn new() -> Self {
        Self { b: [0u8; N], n: 0 }
    }
    pub fn set(&mut self, src: &[u8]) {
        let mut n = 0;
        for &c in src {
            if n == N {
                break;
            }
            // Printable ASCII only: world text and request JSON both stay plain.
            if (b' '..=b'~').contains(&c) {
                self.b[n] = c;
                n += 1;
            }
        }
        self.n = n;
    }
    pub fn bytes(&self) -> &[u8] {
        &self.b[..self.n]
    }
    pub fn as_str(&self) -> &str {
        // Safe: `set` admits printable ASCII only.
        core::str::from_utf8(self.bytes()).unwrap_or("")
    }
    pub fn eq(&self, other: &[u8]) -> bool {
        self.bytes() == other
    }
    pub fn is_empty(&self) -> bool {
        self.n == 0
    }
}

/// A growable buffer for one text or one request body.
pub struct Buf<const N: usize> {
    pub b: [u8; N],
    pub n: usize,
    pub overflow: bool,
}

impl<const N: usize> Buf<N> {
    pub const fn new() -> Self {
        Self { b: [0u8; N], n: 0, overflow: false }
    }
    pub fn byte(&mut self, c: u8) {
        if self.n < N {
            self.b[self.n] = c;
            self.n += 1;
        } else {
            self.overflow = true;
        }
    }
    pub fn push(&mut self, s: &str) {
        self.bytes(s.as_bytes());
    }
    pub fn bytes(&mut self, s: &[u8]) {
        for &c in s {
            self.byte(c);
        }
    }
    pub fn int(&mut self, v: i32) {
        if v < 0 {
            self.byte(b'-');
        }
        let mut rest = v.unsigned_abs();
        let mut d = [0u8; 10];
        let mut k = 0;
        loop {
            d[k] = b'0' + (rest % 10) as u8;
            k += 1;
            rest /= 10;
            if rest == 0 {
                break;
            }
        }
        while k > 0 {
            k -= 1;
            self.byte(d[k]);
        }
    }
    /// Two digits, zero-padded (for a clock).
    pub fn int2(&mut self, v: i32) {
        let v = v.clamp(0, 99);
        self.byte(b'0' + (v / 10) as u8);
        self.byte(b'0' + (v % 10) as u8);
    }
    /// A JSON string literal (quotes, backslash and control bytes escaped).
    pub fn json_str(&mut self, s: &[u8]) {
        self.byte(b'"');
        for &c in s {
            match c {
                b'"' => self.push("\\\""),
                b'\\' => self.push("\\\\"),
                0..=0x1f => self.push(" "),
                _ => self.byte(c),
            }
        }
        self.byte(b'"');
    }
    pub fn as_bytes(&self) -> &[u8] {
        &self.b[..self.n]
    }
    pub fn as_str(&self) -> &str {
        core::str::from_utf8(self.as_bytes()).unwrap_or("")
    }
    pub fn clear(&mut self) {
        // Wiped, not just reset: this buffer may have held the passphrase.
        for c in self.b.iter_mut() {
            *c = 0;
        }
        self.n = 0;
        self.overflow = false;
    }
}

/// A world text under construction: lines of at most `width` characters, at
/// most `max_lines` lines, never over the host's 128 bytes.
pub struct Lines {
    pub out: Buf<HOST_TEXT_MAX_BYTES>,
    width: usize,
    max_lines: usize,
    lines: usize,
    col: usize,
    pub cut: bool,
}

impl Lines {
    pub fn new(width: usize, max_lines: usize) -> Self {
        Self { out: Buf::new(), width: width.max(4), max_lines: max_lines.clamp(1, HOST_TEXT_MAX_LINES), lines: 1, col: 0, cut: false }
    }

    fn room_for(&self, k: usize) -> bool {
        self.out.n + k <= HOST_TEXT_MAX_BYTES
    }

    /// Start a new line (unless the current one is empty and first).
    pub fn newline(&mut self) {
        if self.cut {
            return;
        }
        if self.lines >= self.max_lines || !self.room_for(1) {
            self.cut = true;
            return;
        }
        self.out.byte(b'\n');
        self.lines += 1;
        self.col = 0;
    }

    fn mark_cut(&mut self) {
        if self.cut {
            return;
        }
        self.cut = true;
        // Make room for "..." on the last line.
        while self.out.n > 0 && (self.col + 3 > self.width || !self.room_for(3)) {
            if self.out.b[self.out.n - 1] == b'\n' {
                break;
            }
            self.out.n -= 1;
            self.col = self.col.saturating_sub(1);
        }
        self.out.push("...");
    }

    /// Append words, wrapping at the width. Long words are broken.
    pub fn words(&mut self, s: &[u8]) {
        let mut i = 0;
        while i < s.len() && !self.cut {
            while i < s.len() && s[i] == b' ' {
                i += 1;
            }
            let start = i;
            while i < s.len() && s[i] != b' ' {
                i += 1;
            }
            let mut word = &s[start..i];
            while !word.is_empty() && !self.cut {
                let sep = if self.col > 0 { 1 } else { 0 };
                if self.col + sep + word.len() <= self.width {
                    if !self.room_for(sep + word.len()) {
                        self.mark_cut();
                        return;
                    }
                    if sep == 1 {
                        self.out.byte(b' ');
                    }
                    self.out.bytes(word);
                    self.col += sep + word.len();
                    word = &[];
                } else if self.col == 0 {
                    // A word longer than a line: break it.
                    let take = self.width;
                    if !self.room_for(take) {
                        self.mark_cut();
                        return;
                    }
                    self.out.bytes(&word[..take]);
                    self.col = take;
                    word = &word[take..];
                    if !word.is_empty() {
                        self.newline_or_cut();
                    }
                } else {
                    self.newline_or_cut();
                }
            }
        }
    }

    fn newline_or_cut(&mut self) {
        if self.lines >= self.max_lines || !self.room_for(1) {
            self.mark_cut();
        } else {
            self.newline();
        }
    }

    pub fn text(&mut self, s: &str) {
        self.words(s.as_bytes());
    }

    pub fn as_bytes(&self) -> &[u8] {
        self.out.as_bytes()
    }
}

/// "9:00", "10:30", "2:15" from minutes after midnight (12-hour, no suffix:
/// a working-day strip from 7 to 7 reads without one).
pub fn clock(buf: &mut Buf<HOST_TEXT_MAX_BYTES>, min: i32) {
    let m = min.rem_euclid(24 * 60);
    let mut h = m / 60;
    if h > 12 {
        h -= 12;
    }
    if h == 0 {
        h = 12;
    }
    buf.int(h);
    buf.byte(b':');
    buf.int2(m % 60);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn show(l: &Lines) -> &str {
        core::str::from_utf8(l.as_bytes()).unwrap()
    }

    #[test]
    fn wraps_at_width_and_lines() {
        let mut l = Lines::new(10, 2);
        l.text("one two three four five six seven");
        let s = show(&l);
        assert!(s.lines().count() <= 2, "{s}");
        assert!(s.lines().all(|x| x.len() <= 10), "{s}");
        assert!(s.ends_with("..."), "{s}");
    }

    #[test]
    fn never_over_128_bytes() {
        let mut l = Lines::new(60, 4);
        for _ in 0..20 {
            l.text("abcdefghij klmnopqrst uvwxyz");
            l.newline();
        }
        assert!(l.as_bytes().len() <= HOST_TEXT_MAX_BYTES);
        assert!(show(&l).lines().count() <= 4);
    }

    #[test]
    fn breaks_long_words() {
        let mut l = Lines::new(8, 4);
        l.text("supercalifragilistic");
        assert!(show(&l).lines().all(|x| x.len() <= 8));
    }

    #[test]
    fn clock_reads_like_a_wall_clock() {
        let mut b = Buf::new();
        clock(&mut b, 9 * 60);
        b.push(" ");
        clock(&mut b, 14 * 60 + 5);
        b.push(" ");
        clock(&mut b, 12 * 60 + 30);
        assert_eq!(b.as_str(), "9:00 2:05 12:30");
    }

    #[test]
    fn json_escapes() {
        let mut b: Buf<64> = Buf::new();
        b.json_str(b"a\"b\\c\n");
        assert_eq!(b.as_str(), "\"a\\\"b\\\\c \"");
    }
}
