/**
 * faces/desk/core.ts -- reads the Kosmos Desk snapshot file and draws the board (no I/O but the read).
 *
 * @kosmos-system  Agent bridge (Kosmos Desk face, read-only)
 * @kosmos-owner   Platform
 *
 * The hub session that keeps the CEO's Kosmos Desk artifact current also writes a sanitized copy
 * of its "Needs you" cards to one local file (schema: `SCHEMA.md` beside this file). This module
 * reads that file and turns it into AB1 records for the board in the Lobby. It trusts nothing in
 * the file: every field is cut to length, made plain ASCII, scrubbed of key shapes and of links,
 * and a file that is missing, too big, malformed, from the future or older than `STALE_MS` draws
 * "Desk offline". Nothing here can approve, merge or write anything.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Snapshot } from "../../wire.js";
import { cleanUntrusted, clipBytes, clipWidth, estimateWidthM, toWallAscii, WORLD_TEXT_MAX_BYTES } from "../../sanitize.js";
import { DESK_CARD_NODES, DESK_HEAD_NODE, DESK_W, MAX_CARDS } from "./layout.js";

/** The file the hub writes, unless KOSMOS_DESK_FILE names another (outside %APPDATA% on purpose). */
export const DEFAULT_DESK_FILE = process.platform === "win32" ? "E:\\Kosmos_Desk\\desk.json" : path.join(os.homedir(), "Kosmos_Desk", "desk.json");
/** The hub rewrites the file every 5 minutes; three missed rewrites and the board says so. */
export const STALE_MS = 15 * 60 * 1000;
/** A file stamped this far ahead of the PC's clock is not believed. */
export const FUTURE_MS = 5 * 60 * 1000;
/** A larger file is refused unread (8 short cards are well under 2 KiB). */
export const MAX_FILE_BYTES = 16 * 1024;
export const TITLE_MAX = 40;
export const SESSION_MAX = 24;
/** Cards past this many in the file are not even looked at. */
const SCAN_MAX = 64;
const KEY_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** ISO 8601 with a zone: "2026-10-28T16:05:00Z" or "...+01:00". */
const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const HEAD_TITLE = "KOSMOS DESK";
export const OFFLINE = "Desk offline";

export interface DeskCard {
  key: string;
  title: string;
  session: string;
  /** "YYYY-MM-DD", or "" when the file's day was missing or not a date. */
  day: string;
}

export type OfflineWhy = "missing" | "unreadable" | "too_large" | "malformed" | "stale" | "future";

export type DeskRead =
  | { state: "ok"; updatedAt: number; cards: DeskCard[]; total: number }
  | { state: "offline"; why: OfflineWhy; ageMs?: number };

export function deskFile(): string {
  const f = process.env.KOSMOS_DESK_FILE;
  return f && f.trim().length > 0 ? f.trim() : DEFAULT_DESK_FILE;
}

/** Reads at most MAX_FILE_BYTES of the file. Never throws. */
export async function readDeskFile(file: string): Promise<{ ok: true; text: string } | { ok: false; why: OfflineWhy }> {
  let fh: fs.promises.FileHandle | undefined;
  try {
    fh = await fs.promises.open(file, "r");
    const st = await fh.stat();
    if (!st.isFile()) return { ok: false, why: "unreadable" };
    if (st.size > MAX_FILE_BYTES) return { ok: false, why: "too_large" };
    const buf = Buffer.alloc(MAX_FILE_BYTES + 1);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    if (bytesRead > MAX_FILE_BYTES) return { ok: false, why: "too_large" };
    return { ok: true, text: buf.subarray(0, bytesRead).toString("utf8") };
  } catch (e) {
    return { ok: false, why: (e as NodeJS.ErrnoException)?.code === "ENOENT" ? "missing" : "unreadable" };
  } finally {
    await fh?.close().catch(() => undefined);
  }
}

/** One text field: plain ASCII on one line, no links, no PR numbers, no key shapes, at most `max` characters. */
export function cleanField(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  // Plain ASCII first, so full-width and zero-width tricks ("＃243", "PR #​243") are
  // already "#243" when the patterns below look for them.
  let s = toWallAscii(v.slice(0, 400));
  s = s.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, " ").replace(/\bwww\.\S+/gi, " ");
  s = s.replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\/\S*/gi, " "); // github.com/x/pull/1
  // "PR 243", "issue #12", "#243"; not counts ("2 PRs 3 days old") or "C# 12".
  s = s.replace(/\b(?:PR|issue)\s*#?\s*\d+\b/gi, " ").replace(/#\d+\b/g, " ");
  s = s.replace(/\bKOS-\d+\b/gi, " ");
  // Redact on the ASCII text (a full-width key shape is a plain one by now), then clean again.
  s = cleanUntrusted(s);
  s = s.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim();
  if (s.length > max) s = s.slice(0, max - 3).trimEnd() + "...";
  return s;
}

function validDay(v: unknown): string {
  if (typeof v !== "string") return "";
  const m = DAY_RE.exec(v);
  if (!m) return "";
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? v : "";
}

/** Parses the file's text. `now` is the PC's clock in ms. */
export function parseDesk(raw: string, now: number): DeskRead {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return { state: "offline", why: "malformed" };
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) return { state: "offline", why: "malformed" };
  const o = j as Record<string, unknown>;
  if (typeof o.updatedAt !== "string" || !STAMP_RE.test(o.updatedAt) || !Array.isArray(o.cards)) return { state: "offline", why: "malformed" };
  const updatedAt = Date.parse(o.updatedAt);
  if (!Number.isFinite(updatedAt)) return { state: "offline", why: "malformed" };
  if (updatedAt - now > FUTURE_MS) return { state: "offline", why: "future" };
  if (now - updatedAt > STALE_MS) return { state: "offline", why: "stale", ageMs: now - updatedAt };

  const cards: DeskCard[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const c of o.cards.slice(0, SCAN_MAX)) {
    if (!c || typeof c !== "object" || Array.isArray(c)) continue;
    const r = c as Record<string, unknown>;
    const key = typeof r.key === "string" && KEY_RE.test(r.key) ? r.key : "";
    const title = cleanField(r.title, TITLE_MAX);
    if (!key || !title || seen.has(key)) continue;
    seen.add(key);
    total++;
    if (cards.length < MAX_CARDS) cards.push({ key, title, session: cleanField(r.session, SESSION_MAX), day: validDay(r.day) });
  }
  return { state: "ok", updatedAt, cards, total };
}

/** "YYYY-MM-DD" of `now` on the PC's own calendar. */
function localDay(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "today", "yesterday", or "Oct 26". */
export function dayLabel(day: string, now: number): string {
  if (!day) return "";
  const diff = Math.round((Date.parse(`${localDay(now)}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
  if (diff === 0) return "today";
  if (diff === 1) return "yesterday";
  const m = DAY_RE.exec(day);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : "";
}

function ago(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return "just now";
  if (min < 90) return `${min} min ago`;
  return `${Math.round(min / 60)} h ago`;
}

/** One card's line: "<title> - <session>, <day>", the title cut (never the rest) to fit the board. */
export function cardLine(c: DeskCard, now: number): string {
  const meta = [c.session, dayLabel(c.day, now)].filter((s) => s.length > 0).join(", ");
  if (!meta) return clipWidth(c.title, DESK_W.line);
  const tail = ` - ${meta}`;
  const line = `${c.title}${tail}`;
  if (estimateWidthM(line) <= DESK_W.line) return line;
  const room = DESK_W.line - estimateWidthM(tail);
  return room > 0.3 ? `${clipWidth(c.title, room)}${tail}` : clipWidth(line, DESK_W.line);
}

function headLine(r: DeskRead, now: number): string {
  if (r.state === "offline") {
    if (r.why === "stale" && r.ageMs !== undefined) return `${OFFLINE}: no update for ${ago(r.ageMs).replace(" ago", "")}`;
    return OFFLINE;
  }
  if (r.total === 0) return "Nothing is waiting on you";
  const count = r.total > r.cards.length ? `${r.cards.length} of ${r.total}` : `${r.total}`;
  return `${count} waiting on you - ${ago(now - r.updatedAt)}`;
}

/**
 * The board's records: the heading, then each card left-aligned (an `O` shift, since world text
 * is centred on its anchor), then `X` for every empty row. Version 1 always: the world keeps no
 * version for the board and deduplicates its labels itself.
 */
export function renderBoard(r: DeskRead, now: number): Snapshot {
  const s = new Snapshot().version(1);
  const head = clipWidth(headLine(r, now), DESK_W.head);
  s.text(DESK_HEAD_NODE, clipBytes(`${HEAD_TITLE}\n${head}`, WORLD_TEXT_MAX_BYTES));
  const cards = r.state === "ok" ? r.cards : [];
  DESK_CARD_NODES.forEach((node, i) => {
    const c = cards[i];
    if (!c) {
      s.hide(node);
      return;
    }
    const line = clipBytes(cardLine(c, now), WORLD_TEXT_MAX_BYTES);
    s.offset(node, -DESK_W.line / 2 + estimateWidthM(line) / 2);
    s.text(node, line);
  });
  return s;
}
