/**
 * day-face.mjs -- the "day" face of the bridge, as a pure request handler.
 *
 * @kosmos-system  Content (KosmosWorlds) -- More Room
 * @kosmos-owner   More Room v1 (design session 2026-10-14)
 *
 * More Room (world://more-room.micknerks and world://more-room-mr.micknerks)
 * calls exactly one origin: the bridge on the CEO's PC that Mission Control
 * builds. This file is the part of that bridge More Room adds, mounted under
 * /day/v1/, written so the real bridge can import it and replace the sample
 * store with Claude's reads. It is also the mock: `createDayFace()` with no
 * store runs the invented sample day.
 *
 * Why the wire looks like this (each point is a headset fact, see
 * ../DESIGN.md section 6):
 *   - Every route is a POST with a JSON body, and the session token travels in
 *     that body. A world can send no Authorization header and no cookie, and a
 *     token in a URL ends up in logs.
 *   - Answers are plain text, one record per line, fields split by TAB
 *     ("DAY/1"). The world is no_std Rust, and a line format is a few dozen
 *     lines to read where JSON is a few hundred. Text and JSON are the only
 *     bodies a world may receive; there are no pictures or attachments.
 *   - Request bodies are at most 16 KiB and answers at most 256 KiB (the
 *     client's limits). A whole day is about 3 KiB, so /changes answers the
 *     whole day whenever anything changed and "SAME" otherwise. That is
 *     "what changed since N" in its simplest correct form: a missed poll can
 *     never leave the room out of step.
 *   - Every text field is printable ASCII and clipped here. World text is one
 *     white engine font with a 128-byte cap per text; the world clips again.
 *
 * Nothing is ever sent from here. "approve" on a draft is the CEO's press in
 * the room; the real bridge hands that approval to Mission Control's approval
 * path, which is what sends. The mock only marks the draft "sent (mock)".
 *
 * Integration points:
 *   - server.mjs (local mock server) and worker.mjs (a Worker, never deployed
 *     by this lane) both call handle().
 *   - ../tools/mock-host.mjs runs the built world.wasm against this file.
 */

import crypto from "node:crypto";
import { SAMPLE_DAY } from "./sample-day.mjs";

export const WIRE = "DAY/1";
export const PREFIX = "/day/v1";
export const LIMITS = Object.freeze({
  requestMaxBytes: 16 * 1024,
  responseMaxBytes: 256 * 1024,
  sessionTtlS: 12 * 3600,
  signInFailuresPer10Min: 5,
});

/** The worlds that may call this origin (the opt-in file). */
export const WORLDS = ["world://more-room.micknerks", "world://more-room-mr.micknerks"];

/** Field caps, in characters (all fields are ASCII by the time they are capped). */
export const CAP = Object.freeze({
  line: 30, // brief and prep lines: 4 lines x 30 + 3 newlines fits a 128-byte world text
  eventTitle: 14,
  from: 22,
  subject: 28,
  preview: 80,
  task: 24,
  draft: 300,
  weather: 12,
  headline: 56,
});

const ASCII_FOLD = new Map([
  ["‘", "'"], ["’", "'"], ["“", '"'], ["”", '"'],
  ["–", "-"], ["—", "-"], ["…", "..."], [" ", " "],
]);

/** Printable ASCII, no TAB or newline, clipped to `max` with "..." when cut. */
export function clean(s, max) {
  let out = "";
  for (const ch of String(s ?? "")) {
    const f = ASCII_FOLD.get(ch);
    if (f) out += f;
    else if (ch >= " " && ch <= "~") out += ch;
    else if (ch === "\t" || ch === "\n" || ch === "\r") out += " ";
  }
  out = out.replace(/\s+/g, " ").trim();
  if (out.length > max) out = out.slice(0, Math.max(0, max - 3)).trimEnd() + "...";
  return out;
}

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

/**
 * The day store. The real bridge implements the same shape from Claude's reads
 * (mail, calendar, Linear); see ../DESIGN.md section 5.
 */
export function createSampleStore(day = SAMPLE_DAY) {
  const d = clone(day);
  return {
    date: d.date,
    weather: d.weather,
    sunsetMin: d.sunsetMin,
    headline: d.headline,
    brief: d.brief,
    events: d.events,
    tasks: d.tasks,
    messages: d.messages.map((m) => ({ ...m, pile: "in", read: false })),
    arrivals: d.arrivals,
    drafts: [],
    cannedDrafts: d.drafts,
    defaultDraft: d.defaultDraft,
    wrapFirstTomorrow: d.wrapFirstTomorrow,
    nextTask: 1,
  };
}

/**
 * Build the handler.
 * @param opts.store        a store (default: the sample day)
 * @param opts.passphrase   the bridge passphrase (the mock's comes from MORE_ROOM_PASSPHRASE)
 * @param opts.nowMin       () => minutes after local midnight (default: the wall clock)
 * @param opts.nowMs        () => epoch ms (default: Date.now), for TTLs and rate limits
 * @param opts.dev          true enables /day/v1/_mock/* (never in a deployed bridge)
 */
export function createDayFace(opts = {}) {
  const store = opts.store ?? createSampleStore();
  const passphrase = opts.passphrase ?? "sample-day";
  const nowMs = opts.nowMs ?? (() => Date.now());
  const nowMin =
    opts.nowMin ??
    (() => {
      const t = new Date(nowMs());
      return t.getHours() * 60 + t.getMinutes();
    });
  const sessions = new Map(); // token -> expiry ms
  const failures = []; // ms of failed sign-ins
  let rev = 1;
  const log = []; // every act, for the harness and for Mission Control's audit

  const bump = () => ++rev;

  function snapshot() {
    const L = [];
    const rec = (...f) => L.push(f.join("\t"));
    rec(WIRE, "rev", rev);
    rec("NOW", nowMin(), store.sunsetMin);
    rec("DATE", clean(store.date, 16));
    for (const b of store.brief.slice(0, 4)) rec("BRIEF", clean(b, CAP.line));
    for (const e of store.events.slice(0, 8)) rec("EV", e.id, e.start, e.end, clean(e.title, CAP.eventTitle), e.prep ? 1 : 0);
    for (const t of store.tasks.slice(0, 16)) rec("TASK", t.id, t.pin ? 1 : 0, t.state, clean(t.title, CAP.task));
    for (const m of store.messages.slice(0, 48)) {
      rec("MSG", m.id, m.src, m.vip ? 1 : 0, m.pile, m.read ? 1 : 0, clean(m.from, CAP.from), clean(m.subject, CAP.subject), clean(m.preview, CAP.preview));
    }
    for (const dr of store.drafts.slice(-4)) rec("DRAFT", dr.id, dr.msg, dr.state, clean(dr.to, CAP.from), clean(dr.text, CAP.draft));
    rec("WIN", clean(store.weather, CAP.weather), clean(store.headline, CAP.headline));
    rec("WRAP", "first", clean(store.wrapFirstTomorrow, CAP.task + 8));
    rec("END");
    return L.join("\n") + "\n";
  }

  function authed(body) {
    const exp = sessions.get(String(body?.token ?? ""));
    if (!exp) return false;
    if (exp < nowMs()) {
      sessions.delete(body.token);
      return false;
    }
    return true;
  }

  const text = (status, s) => ({ status, contentType: "text/plain; charset=utf-8", body: s });

  function act(body) {
    const op = String(body.op ?? "");
    const id = String(body.id ?? "");
    const msg = store.messages.find((m) => m.id === id);
    const task = store.tasks.find((t) => t.id === id);
    const draft = store.drafts.find((d) => d.id === id);
    let note = "";
    switch (op) {
      case "turn": // turned over: read, still on the desk
        if (!msg) return text(404, "NO\tno such message\n");
        msg.read = true;
        break;
      case "done": // archived
        if (!msg) return text(404, "NO\tno such message\n");
        msg.pile = "done";
        msg.read = true;
        break;
      case "later": // snoozed to tomorrow morning
        if (!msg) return text(404, "NO\tno such message\n");
        msg.pile = "later";
        break;
      case "quiet": // muted: goes to the shelf behind you
        if (!msg) return text(404, "NO\tno such message\n");
        msg.pile = "quiet";
        break;
      case "draft": { // "Claude drafts reply": a draft that waits for Approve or Deny
        if (!msg) return text(404, "NO\tno such message\n");
        const dr = {
          id: `d-${msg.id}-${store.drafts.length + 1}`,
          msg: msg.id,
          state: "pending",
          to: msg.from,
          text: store.cannedDrafts[msg.id] ?? store.defaultDraft,
        };
        store.drafts.push(dr);
        note = "Draft ready: Approve or Deny";
        break;
      }
      case "approve":
        if (!draft || draft.state !== "pending") return text(409, "NO\tnothing to approve\n");
        // The real bridge hands this to Mission Control's approval path, which sends.
        draft.state = "sent";
        { const m = store.messages.find((x) => x.id === draft.msg); if (m) { m.pile = "done"; m.read = true; } }
        note = "Sent (mock: nothing left)";
        break;
      case "deny":
        if (!draft || draft.state !== "pending") return text(409, "NO\tnothing to deny\n");
        draft.state = "denied";
        note = "discarded";
        break;
      case "task": { // "Make a task": a Linear ticket from this message
        if (!msg) return text(404, "NO\tno such message\n");
        const key = `KOS-MOCK-${store.nextTask++}`;
        store.tasks.push({ id: `t-${key}`, pin: false, state: "open", title: clean(`${key} ${msg.subject}`, CAP.task) });
        note = `${key} created (mock)`;
        break;
      }
      case "complete":
        if (!task) return text(404, "NO\tno such task\n");
        task.state = "done";
        break;
      case "roll":
        if (!task) return text(404, "NO\tno such task\n");
        task.state = "rolled";
        break;
      case "pin":
        if (!task) return text(404, "NO\tno such task\n");
        task.pin = !task.pin;
        break;
      default:
        return text(400, "NO\tunknown op\n");
    }
    const r = bump();
    log.push({ op, id, rev: r, note });
    return text(200, `OK\t${r}\t${clean(note, 40)}\n`);
  }

  /**
   * Handle one request.
   * @param method  "GET" | "POST" | ...
   * @param path    the URL path (no query)
   * @param raw     the request body bytes (Buffer or Uint8Array), or null
   * @returns {status, contentType, body}
   */
  function handle(method, path, raw) {
    if (method === "GET" && path === "/.well-known/world-network.json") {
      return { status: 200, contentType: "application/json", body: JSON.stringify({ world_network: 1, worlds: WORLDS }) };
    }
    if (method === "GET" && path === "/privacy") {
      return text(200, "More Room bridge (mock). It stores nothing about visitors. It serves an invented sample day to one world.\n");
    }
    if (!path.startsWith(PREFIX + "/")) return text(404, "NO\tnot here\n");
    if (method !== "POST") return text(405, "NO\tPOST only\n");
    const len = raw ? raw.length : 0;
    if (len > LIMITS.requestMaxBytes) return text(413, "NO\ttoo large\n");
    let body;
    try {
      body = JSON.parse(Buffer.from(raw ?? []).toString("utf8") || "{}");
    } catch {
      return text(400, "NO\tnot JSON\n");
    }
    const route = path.slice(PREFIX.length);

    if (route === "/session") {
      const t = nowMs();
      while (failures.length && failures[0] < t - 600_000) failures.shift();
      if (failures.length >= LIMITS.signInFailuresPer10Min) return text(429, "NO\ttoo many tries, wait 10 minutes\n");
      const given = Buffer.from(String(body.passphrase ?? ""), "utf8");
      const want = Buffer.from(passphrase, "utf8");
      const ok = given.length === want.length && crypto.timingSafeEqual(given, want);
      if (!ok) {
        failures.push(t);
        return text(403, "NO\twrong passphrase\n");
      }
      const token = crypto.randomBytes(16).toString("hex");
      sessions.set(token, t + LIMITS.sessionTtlS * 1000);
      return text(200, `TOKEN\t${token}\t${LIMITS.sessionTtlS}\n`);
    }

    // Dev only (the mock and its harness, never a deployed bridge): land the next sample message.
    if (opts.dev && route === "/_mock/arrive") {
      const next = store.arrivals.shift();
      if (!next) return text(200, "OK\t0\tnone left\n");
      store.messages.push({ ...next, pile: "in", read: false });
      return text(200, `OK\t${bump()}\t${next.id}\n`);
    }

    if (!authed(body)) return text(401, "AUTH\tsign in again\n");

    if (route === "/changes") {
      const since = Number(body.since ?? 0);
      if (since === rev) return text(200, `${WIRE}\trev\t${rev}\nNOW\t${nowMin()}\t${store.sunsetMin}\nSAME\nEND\n`);
      return text(200, snapshot());
    }
    if (route === "/act") return act(body);
    if (route === "/prep") {
      const ev = store.events.find((e) => e.id === String(body.event ?? ""));
      if (!ev) return text(404, "NO\tno such event\n");
      const lines = (ev.prep ?? ["Nothing gathered for this one"]).slice(0, 4).map((l) => `P\t${clean(l, CAP.line)}`);
      return text(200, `PREP\t${ev.id}\n${lines.join("\n")}\nEND\n`);
    }
    if (route === "/session/end") {
      sessions.delete(String(body.token));
      return text(200, "OK\t0\tsigned out\n");
    }
    return text(404, "NO\tnot here\n");
  }

  return { handle, snapshot, store, log, rev: () => rev };
}
