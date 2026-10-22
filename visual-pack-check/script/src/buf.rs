//! A fixed-size UTF-8 text buffer (no allocator), and small text helpers.
//!
//! @kosmos-system  Content (KosmosWorlds) -- Visual Pack Check
//! @kosmos-owner   KOS-699 (builder vp-w1). Pattern: type-test/script/src/lib.rs `Buf`.

/// At most N bytes of UTF-8; a push that does not fit stops at a character boundary.
#[derive(Clone, Copy)]
pub struct Buf<const N: usize> {
    b: [u8; N],
    len: usize,
    /// Set when a push did not fit (the tests fail on any text that was cut).
    pub cut: bool,
}

impl<const N: usize> Buf<N> {
    pub const fn new() -> Self {
        Buf { b: [0; N], len: 0, cut: false }
    }
    pub fn clear(&mut self) {
        self.len = 0;
        self.cut = false;
    }
    pub fn len(&self) -> usize {
        self.len
    }
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
    pub fn as_bytes(&self) -> &[u8] {
        &self.b[..self.len]
    }
    pub fn as_str(&self) -> &str {
        core::str::from_utf8(self.as_bytes()).unwrap_or("")
    }
    pub fn push(&mut self, s: &str) -> &mut Self {
        for c in s.chars() {
            let mut tmp = [0u8; 4];
            let e = c.encode_utf8(&mut tmp).as_bytes();
            if self.len + e.len() > N {
                self.cut = true;
                break;
            }
            self.b[self.len..self.len + e.len()].copy_from_slice(e);
            self.len += e.len();
        }
        self
    }
    pub fn push_bytes(&mut self, s: &[u8]) -> &mut Self {
        let n = s.len().min(N - self.len);
        if n < s.len() {
            self.cut = true;
        }
        self.b[self.len..self.len + n].copy_from_slice(&s[..n]);
        self.len += n;
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
            self.push_bytes(&[digits[n]]);
        }
        self
    }
    /// One decimal place (values up to about 2e8).
    pub fn push_f1(&mut self, v: f32) -> &mut Self {
        let neg = v < 0.0;
        let t = ((if neg { -v } else { v }) * 10.0 + 0.5) as i32;
        if neg && t != 0 {
            self.push("-");
        }
        self.push_i32(t / 10).push(".").push_i32(t % 10)
    }
}

/// FNV-1a over bytes, folded with extra words (a text's style).
pub fn fnv(bytes: &[u8], extra: &[i32]) -> u32 {
    let mut h: u32 = 0x811c9dc5;
    for &b in bytes {
        h ^= b as u32;
        h = h.wrapping_mul(0x01000193);
    }
    for &w in extra {
        for b in w.to_le_bytes() {
            h ^= b as u32;
            h = h.wrapping_mul(0x01000193);
        }
    }
    h
}
