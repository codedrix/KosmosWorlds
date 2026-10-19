/**
 * sanitize.ts -- everything that leaves the PC passes through here.
 *
 * @kosmos-system  Agent bridge (Mission Control, DB-044)
 * @kosmos-owner   Platform
 *
 * Three jobs:
 *
 * 1. **Redact secrets.** Claude can read a key out of a file and repeat it. Any
 *    text bound for the headset (and so for the tunnel) is scrubbed of the
 *    common key shapes first. It is a net, not a guarantee; the real rule is
 *    that tool OUTPUT (file contents, command output, diffs) never leaves the PC
 *    at all (jobs.ts keeps only counts and paths).
 *
 * 2. **Defang text an attacker might have planted.** Agent output can carry
 *    words written by whoever wrote a file or web page Claude read. On the wall
 *    it may only ever be shown as Claude's words, in the conversation: never in
 *    a button, a header, the approval panel or the ticker (faces enforce that by
 *    construction). Here we also strip what could make it look like something
 *    else: control and bidirectional-override characters, zero-width
 *    characters, ANSI escapes, and the markers the bridge reserves for its own
 *    lines ("!!", ">>").
 *
 * 3. **Fit Kosmos world text.** World text is white, 8 cm Roboto, at most 128
 *    BYTES per label after the host's own sanitizer. We send plain ASCII, so a
 *    character is a byte and nothing the host does can grow a string past the
 *    limit. `estimateWidthM` approximates Roboto advances so lines can be wrapped
 *    by width, and so a face can place a centred label as if it were left-aligned.
 */

import { ROBOTO_ADVANCE_EM } from "./roboto-advance.js";

/** World text glyph height, metres (KWorldTextPool.cpp `WorldTextSizeCm` = 8). */
export const GLYPH_M = 0.08;
/** The host refuses world text over this many bytes (KWasm::MAX_WORLD_TEXT_BYTES). */
export const WORLD_TEXT_MAX_BYTES = 128;

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bsk-ant-[A-Za-z0-9_-]{8,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\blin_api_[A-Za-z0-9]{16,}/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, // JWTs
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  // Keyword then value. "(?<![A-Za-z0-9])" (not "\b") so DB_PASSWORD= counts; a quoted value
  // runs to its closing quote OR the end of the text, so a quote still streaming in is hidden.
  /(?<![A-Za-z0-9])(pass(?:word|wd|phrase)?|secret(?:[_-]?key)?|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|encryption[_-]?key)(["']?\s*[:=]\s*)("[^"]*(?:"|$)|'[^']*(?:'|$)|\S+)/gi,
  /\b[A-Fa-f0-9]{40,}\b/g, // long hex: keys, never a commit we need to show in full
  /\b[A-Za-z0-9+/]{48,}={0,2}(?![A-Za-z0-9+/=])/g, // long base64 blobs
];

export function redactSecrets(s: string): string {
  let out = s;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (_m, k1: string | undefined, sep: string | undefined) =>
      typeof k1 === "string" && typeof sep === "string" && /^[a-z_-]+$/i.test(k1) ? `${k1}${sep}[redacted]` : "[redacted]",
    );
  }
  return out;
}

const PUNCT_MAP: Record<string, string> = {
  "\u2018": "'", "\u2019": "'", "\u201a": "'", "\u201b": "'",
  "\u201c": '"', "\u201d": '"', "\u201e": '"', "\u2033": '"',
  "\u2013": "-", "\u2014": "-", "\u2212": "-", "\u2010": "-", "\u2011": "-",
  "\u2026": "...", "\u2022": "*", "\u00b7": "*", "\u2192": "->", "\u2190": "<-",
  "\u00a0": " ", "\u2009": " ", "\u202f": " ", "\u2002": " ", "\u2003": " ",
  "\u00d7": "x", "\u2713": "ok", "\u2714": "ok", "\u2717": "x", "\u2718": "x",
};

/**
 * Plain printable ASCII plus "\n", with nothing that can disguise text. Every
 * character outside that set either maps to an ASCII look-alike (quotes,
 * dashes) or becomes "?".
 */
export function toWallAscii(s: string): string {
  // NFKD then drop combining marks: "caf\u00e9" reads "cafe", not "caf?".
  let t = s.normalize("NFKD").replace(/\p{M}/gu, "");
  t = t.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, ""); // ANSI CSI
  t = t.replace(/\u001b\][^\u0007]*(\u0007|\u001b\\)/g, ""); // ANSI OSC
  t = t.replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u00ad]/g, ""); // zero-width, bidi
  t = t.replace(/\r\n?/g, "\n").replace(/\t/g, "  ");
  let out = "";
  for (const ch of t) {
    const mapped = PUNCT_MAP[ch];
    if (mapped !== undefined) out += mapped;
    else if (ch === "\n" || (ch >= " " && ch <= "~")) out += ch;
    else if (/\p{Cc}|\p{Cf}/u.test(ch)) continue;
    else out += "?";
  }
  return out;
}

/** The bridge's own markers. Agent text may never start a line with them. */
export function defangAgentText(s: string): string {
  return s
    .split("\n")
    .map((line) => line.replace(/!{2,}/g, "!").replace(/^\s*>{2,}/, ">"))
    .join("\n");
}

/** Redact, then make it plain ASCII. Use for any text that came from an agent, a tool or a file. */
export function cleanUntrusted(s: string): string {
  return defangAgentText(toWallAscii(redactSecrets(s)));
}

let textScale = 1;

/**
 * Multiply every width by this. 1 = the glyph size the client claims (8 cm em).
 * The device check measures the real rendering; the bridge's config carries any
 * correction (`textScale`), so wrap and alignment are tuned without a new world.
 */
export function setTextScale(k: number): void {
  textScale = Number.isFinite(k) && k > 0.5 && k < 2 ? k : 1;
}

/** Roboto Regular advances, measured from the font (roboto-advance.ts). */
function advanceEm(ch: string): number {
  const code = ch.charCodeAt(0);
  return ROBOTO_ADVANCE_EM[code - 32] ?? 0.5;
}

export function estimateWidthM(line: string): number {
  let em = 0;
  for (const ch of line) em += advanceEm(ch);
  return em * GLYPH_M * textScale;
}

/** Cut to at most `maxBytes` ASCII bytes, ending in "..." when cut. */
export function clipBytes(s: string, maxBytes: number): string {
  if (s.length <= maxBytes) return s;
  if (maxBytes <= 3) return s.slice(0, maxBytes);
  return s.slice(0, maxBytes - 3).trimEnd() + "...";
}

/** Cut one line to at most `maxM` metres wide, ending in "..." when cut. */
export function clipWidth(line: string, maxM: number): string {
  if (estimateWidthM(line) <= maxM) return line;
  let out = line;
  while (out.length > 0 && estimateWidthM(out + "...") > maxM) out = out.slice(0, -1);
  return out.trimEnd() + "...";
}

/**
 * Word-wrap to lines no wider than `maxM` metres. Blank lines in the input are
 * kept (one per run). A word wider than a line is split.
 */
export function wrapWidth(text: string, maxM: number, firstPrefix = "", nextPrefix = ""): string[] {
  const out: string[] = [];
  const paras = text.split("\n");
  let first = true;
  let lastBlank = false;
  for (const para of paras) {
    const words = para.split(/ +/).filter((w) => w.length > 0);
    if (words.length === 0) {
      if (!lastBlank && out.length > 0) out.push("");
      lastBlank = true;
      continue;
    }
    lastBlank = false;
    let line = first ? firstPrefix : nextPrefix;
    let lineHasWord = false;
    first = false;
    for (let w of words) {
      while (w.length > 0) {
        const candidate = lineHasWord ? `${line} ${w}` : `${line}${w}`;
        if (estimateWidthM(candidate) <= maxM) {
          line = candidate;
          lineHasWord = true;
          w = "";
        } else if (lineHasWord) {
          out.push(line);
          line = nextPrefix;
          lineHasWord = false;
        } else {
          // The word alone is too wide: split it.
          let cut = 1;
          while (cut < w.length && estimateWidthM(line + w.slice(0, cut + 1)) <= maxM) cut++;
          out.push(line + w.slice(0, cut));
          line = nextPrefix;
          w = w.slice(cut);
        }
      }
    }
    if (lineHasWord) out.push(line);
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out;
}
