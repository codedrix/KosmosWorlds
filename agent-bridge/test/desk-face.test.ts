/**
 * test/desk-face.test.ts -- the Kosmos Desk board's face: the file, the sanitizer, the board, the server.
 *
 * @kosmos-system  Agent bridge (Kosmos Desk face, read-only)
 * @kosmos-owner   Platform
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { tempHome, call, PASS, parseSnapshot } from "./helpers.js";
import type { FaceContext } from "../src/faces/types.js";

tempHome();
const { Bridge } = await import("../src/bridge.js");
const { FakeAdapter } = await import("../src/adapters/fake.js");
const { createServer } = await import("../src/server.js");
const { MissionControlFace } = await import("../src/faces/mission-control/index.js");
const { hashPassphrase, defaultConfig } = await import("../src/config.js");
const { loadFaces } = await import("../src/faces/registry.js");
const { createDeskFace } = await import("../src/faces/desk/index.js");
const core = await import("../src/faces/desk/core.js");
const { DESK_CARD_NODES, DESK_HEAD_NODE, DESK_TEXT_NODES, DESK_W } = await import("../src/faces/desk/layout.js");
const { estimateWidthM } = await import("../src/sanitize.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kosmos-desk-"));
const FILE = path.join(dir, "desk.json");
// A local noon, so "today" is the same calendar day whatever the test machine's zone.
const NOW = new Date(2026, 9, 28, 12, 0, 0).getTime();
const iso = (ms: number) => new Date(ms).toISOString();

const card = (key: string, title: string, session = "hub", day = "2026-10-28") => ({ key, title, session, day });
function write(v: unknown): void {
  fs.writeFileSync(FILE, typeof v === "string" ? v : JSON.stringify(v));
}

const calls = { signIn: 0, signOut: 0, mint: 0, pairSignIn: 0 };
function ctx(authed = true, killed = false): FaceContext {
  return {
    bridge: {} as FaceContext["bridge"],
    authed,
    killed,
    signIn: () => {
      calls.signIn++;
      return { ok: false, reason: "wrong" };
    },
    signOut: () => {
      calls.signOut++;
    },
    pair: {
      mint: () => {
        calls.mint++;
        return { ok: false, reason: "off" };
      },
      state: () => ({ state: "expired" }),
      signIn: () => {
        calls.pairSignIn++;
        return { ok: false };
      },
    },
    waitForChange: async () => undefined,
  };
}

let clock = NOW;
const face = createDeskFace({ file: () => FILE, now: () => clock });
async function board(c = ctx(), op = "board", fields: Record<string, string> = {}) {
  const r = await face.handle(op, { fields }, c);
  return { ...r, s: parseSnapshot(r.body) };
}
function head(s: ReturnType<typeof parseSnapshot>): string[] {
  // parseSnapshot has already turned the wire's "\n" escapes back into newlines.
  return (s.text.get(DESK_HEAD_NODE) ?? "").split("\n");
}
function shownCards(s: ReturnType<typeof parseSnapshot>): string[] {
  return DESK_CARD_NODES.filter((n) => s.text.has(n)).map((n) => s.text.get(n) ?? "");
}

test("a missing file draws Desk offline and no card, never an error", async () => {
  fs.rmSync(FILE, { force: true });
  const r = await board();
  assert.equal(r.status, 200);
  assert.deepEqual(head(r.s), ["KOSMOS DESK", "Desk offline"]);
  assert.deepEqual(shownCards(r.s), []);
  for (const n of DESK_CARD_NODES) assert.ok(r.s.hidden.has(n), `${n} hidden`);
});

test("a stale file (older than 15 minutes) is offline and says for how long", async () => {
  write({ updatedAt: iso(NOW - 40 * 60_000), cards: [card("a", "Merge the portal fix")] });
  const r = await board();
  assert.deepEqual(head(r.s), ["KOSMOS DESK", "Desk offline: no update for 40 min"]);
  assert.deepEqual(shownCards(r.s), []);
  write({ updatedAt: iso(NOW - 14 * 60_000), cards: [card("a", "Merge the portal fix")] });
  assert.deepEqual(head((await board()).s), ["KOSMOS DESK", "1 waiting on you - 14 min ago"]);
});

test("a file from the future, malformed JSON, the wrong shape or over 16 KiB is offline", async () => {
  for (const bad of [
    { updatedAt: iso(NOW + 10 * 60_000), cards: [card("a", "From the future")] },
    "{ not json",
    "[]",
    "null",
    { updatedAt: "yesterday", cards: [] },
    { updatedAt: "2026-10-28T11:59:00", cards: [] }, // no zone
    { updatedAt: iso(NOW), cards: "a card" },
    { cards: [card("a", "No stamp")] },
    { updatedAt: iso(NOW), cards: Array.from({ length: 400 }, (_, i) => card(`k${i}`, "x".repeat(40))) },
  ]) {
    write(bad);
    const r = await board();
    assert.equal(r.status, 200);
    assert.deepEqual(head(r.s), ["KOSMOS DESK", "Desk offline"], JSON.stringify(bad).slice(0, 60));
    assert.deepEqual(shownCards(r.s), []);
  }
  assert.ok(fs.statSync(FILE).size > core.MAX_FILE_BYTES, "the last one really was over the cap");
  fs.mkdirSync(FILE + ".d", { recursive: true });
  const asDir = createDeskFace({ file: () => FILE + ".d", now: () => NOW });
  assert.deepEqual(head(parseSnapshot((await asDir.handle("board", { fields: {} }, ctx())).body)), ["KOSMOS DESK", "Desk offline"]);
});

test("oversize, hostile and empty titles are cut, cleaned or dropped before the headset sees them", async () => {
  const fakeKey = ["sk", "ant", "api03", "x".repeat(24)].join("-");
  write({
    updatedAt: iso(NOW),
    cards: [
      card("long", "A title far longer than forty characters that keeps going on and on"),
      card("links", "Read https://evil.example/x?y=1 and www.evil.example now"),
      card("pr", "Merge PR #251 and #12 today"),
      card("ctl", "Line\none\u0007\u001b[31m red‮ evil​"),
      card("key", `token=${fakeKey}`),
      card("blank", "   "),
      { key: "no title", title: "", session: "hub", day: "2026-10-28" },
      { key: "bad key!", title: "Bad key", session: "hub", day: "2026-10-28" },
      card("long", "A repeated key is dropped"),
      card("sess", "Long session", "a long session name that runs past the cap", "2026-02-30"),
    ],
  });
  const r = await board();
  const lines = shownCards(r.s);
  assert.equal(lines.length, 6, lines.join(" | "));
  const titles = lines.map((l) => l.split(" - ")[0] ?? "");
  assert.equal(titles[0], "A title far longer than forty charact...");
  assert.ok((titles[0] ?? "").length <= core.TITLE_MAX);
  assert.ok(!/https?:|www\.|evil\.example/.test(lines[1] ?? ""), lines[1]);
  assert.ok(!/#\d/.test(lines[2] ?? ""), lines[2]);
  assert.equal(titles[3], "Line one red evil");
  assert.ok(!(lines[4] ?? "").includes(fakeKey) && (lines[4] ?? "").includes("[redacted]"), lines[4]);
  // A session cut to 24 characters, and a day that isn't a date dropped.
  assert.equal(lines[5], "Long session - a long session name t...");
  for (const l of r.body.split("\n")) {
    assert.ok(Buffer.byteLength(l) <= 128 + 20, "every record fits the host's 128-byte label");
    assert.ok(/^[\x20-\x7e]*$/.test(l), `plain ASCII: ${l}`);
  }
  for (const n of DESK_CARD_NODES) {
    const t = r.s.text.get(n);
    if (t !== undefined) assert.ok(estimateWidthM(t) <= DESK_W.line + 1e-9, `${n} fits the board: ${t}`);
  }
  assert.deepEqual(head(r.s), ["KOSMOS DESK", "6 waiting on you - just now"]);
});

test("disguised links, numbers and keys are caught after the text is made plain ASCII", () => {
  const wide = (s: string) => [...s].map((c) => (c >= "!" && c <= "~" ? String.fromCharCode(c.charCodeAt(0) + 0xfee0) : c)).join("");
  const fakeAws = ["AK", "IA", "Q".repeat(16)].join("");
  const cases: Array<[string, RegExp]> = [
    ["Merge PR #​243 now", /#|243/],
    [`Merge ${wide("#243")} now`, /#|243/],
    [`Open ${wide("https://evil.x/a")} now`, /evil|https|:\/\//],
    ["Merge PR 243 and KOS-1015", /243|1015/],
    ["See github.com/codedrix/x/pull/243 today", /github|243|\//],
    [`Key ${wide(fakeAws)}`, new RegExp(fakeAws)],
  ];
  for (const [input, bad] of cases) {
    const out = core.cleanField(input, 200);
    assert.ok(!bad.test(out), `${JSON.stringify(input)} -> ${JSON.stringify(out)}`);
    assert.ok(/^[\x20-\x7e]*$/.test(out), `plain ASCII: ${out}`);
  }
  // Ordinary words with numbers stay: only PR, issue and ticket numbers go.
  assert.equal(core.cleanField("Publish Lobby 1.5.0 (unlisted)", 40), "Publish Lobby 1.5.0 (unlisted)");
});

test("more than 8 cards: the first 8 show and the heading counts the rest", async () => {
  write({ updatedAt: iso(NOW - 3 * 60_000), cards: Array.from({ length: 11 }, (_, i) => card(`c${i}`, `Decision number ${String.fromCharCode(65 + i)}`)) });
  const r = await board();
  const lines = shownCards(r.s);
  assert.equal(lines.length, 8);
  assert.deepEqual(lines.map((l) => l.split(" - ")[0]), "ABCDEFGH".split("").map((c) => `Decision number ${c}`));
  assert.deepEqual(head(r.s), ["KOSMOS DESK", "8 of 11 waiting on you - 3 min ago"]);
  assert.equal(r.s.texts, 9, "never more than the board's 9 labels");
  for (const n of r.body.split("\n").filter((l) => /^[TXUO] /.test(l)).map((l) => l.split(" ")[1])) {
    assert.ok((DESK_TEXT_NODES as readonly string[]).includes(n ?? ""), `only the board's own nodes: ${n}`);
  }
});

test("each card is left-aligned on the board and says its session and day", async () => {
  write({ updatedAt: iso(NOW), cards: [card("a", "Merge the portal legal links fix"), card("b", "Sign the fax", "admin", "2026-10-27"), card("c", "Old one", "client", "2026-10-20"), { key: "d", title: "No meta" }] });
  const r = await board();
  assert.deepEqual(shownCards(r.s), ["Merge the portal legal links fix - hub, today", "Sign the fax - admin, yesterday", "Old one - client, Oct 20", "No meta"]);
  for (const n of DESK_CARD_NODES.slice(0, 4)) {
    const t = r.s.text.get(n) ?? "";
    const left = (r.s.offset.get(n) ?? 0) / 1000 - estimateWidthM(t) / 2;
    assert.ok(Math.abs(left - -DESK_W.line / 2) < 0.002, `${n} starts at the board's left margin (${left})`);
  }
  for (const n of DESK_CARD_NODES.slice(4)) assert.ok(r.s.hidden.has(n));
  assert.ok(!r.s.offset.has(DESK_HEAD_NODE), "the heading stays centred");
});

test("an empty list is not offline", async () => {
  write({ updatedAt: iso(NOW), cards: [] });
  assert.deepEqual(head((await board()).s), ["KOSMOS DESK", "Nothing is waiting on you"]);
});

test("the example file in the schema's folder is a valid board", async () => {
  const example = path.resolve(here, "..", "..", "src", "faces", "desk", "desk.example.json");
  const raw = fs.readFileSync(example, "utf8");
  const stamp = Date.parse((JSON.parse(raw) as { updatedAt: string }).updatedAt);
  const read = core.parseDesk(raw, stamp + 60_000);
  assert.equal(read.state, "ok");
  if (read.state === "ok") {
    assert.equal(read.total, 4);
    for (const c of read.cards) assert.ok(c.title.length <= core.TITLE_MAX && c.session.length <= core.SESSION_MAX && c.day !== "");
  }
});

test("read-only: no sign-in, no write op, nothing kept, and nothing without the token", async () => {
  write({ updatedAt: iso(NOW), cards: [card("a", "Merge the portal fix")] });
  const before = fs.readFileSync(FILE, "utf8");
  const anon = await board(ctx(false));
  assert.equal(anon.status, 401);
  assert.ok(!anon.body.includes("Merge"), "no card leaves without the token");
  const stopped = await board(ctx(true, true));
  assert.equal(stopped.status, 503);
  assert.ok(!stopped.body.includes("Merge"));
  for (const op of ["approve", "merge", "press", "write", "signin", "pair"]) assert.equal((await board(ctx(), op)).status, 404, op);
  // A press or typed text in a board request changes nothing.
  const pressed = await board(ctx(), "board", { press: "TxDeskA", text: "approve" });
  assert.equal(pressed.status, 200);
  assert.equal(fs.readFileSync(FILE, "utf8"), before, "the file is never written");
  face.reset();
  assert.deepEqual(calls, { signIn: 0, signOut: 0, mint: 0, pairSignIn: 0 }, "the face never signs in, out, or pairs");
});

// ---------------------------------------------------------------------------
// On the real server, beside Mission Control: one session, the CEO's, never kicked out.
// ---------------------------------------------------------------------------

const project = fs.mkdtempSync(path.join(os.tmpdir(), "agent-bridge-proj-"));
const config = { ...defaultConfig(), port: 0, projects: [{ name: "kosmos-registry", path: project }], passphrase: hashPassphrase(PASS) };
const bridge = new Bridge(config, new FakeAdapter(5));
const mc = new MissionControlFace();
const desk = createDeskFace({ file: () => FILE, now: () => clock });
const faces = new Map([
  [mc.name, mc],
  [desk.name, desk],
]);
const server = createServer(bridge, faces, { port: 0, log: () => undefined, rate: { perSecond: 1000, burst: 1000 } });
await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
const port = (server.address() as AddressInfo).port;
after(async () => {
  await bridge.shutdown();
  await new Promise<void>((r) => server.close(() => r()));
});

test("the registry finds the desk face by its folder, serving the Lobby only", async () => {
  const found = await loadFaces(path.resolve(here, "..", "src", "faces"));
  assert.ok(found.has("desk") && found.has("mission-control"));
  assert.deepEqual([...(found.get("desk")?.worlds ?? [])], ["world://lobby.micknerks"]);
});

test("through the server: the board rides the CEO's own token and never ends his session", async () => {
  write({ updatedAt: iso(NOW), cards: [card("a", "Merge the portal fix")] });
  clock = NOW;
  const s = await call(port, "/v1/session", { body: JSON.stringify({ passphrase: PASS }), headers: { "Content-Type": "application/json" } });
  assert.equal(s.status, 200);
  const tok = (JSON.parse(s.text) as { token: string }).token;
  const lobby = { "X-World-Address": "lobby.micknerks", "Content-Type": "text/plain" };
  for (let i = 0; i < 5; i++) {
    const r = await call(port, "/v1/faces/desk/board", { body: `AB1\ntok ${tok}\n`, headers: lobby });
    assert.equal(r.status, 200);
    assert.deepEqual(shownCards(parseSnapshot(r.text)), ["Merge the portal fix - hub, today"]);
  }
  // Without the token (a watcher, a stranger) there is nothing, and the CEO stays signed in.
  const anon = await call(port, "/v1/faces/desk/board", { body: "AB1\nwatch 123456\n", headers: lobby });
  assert.equal(anon.status, 401);
  assert.ok(!anon.text.includes("Merge"));
  assert.ok(bridge.auth.check(tok), "the CEO's session is still the live one");
  const view = await call(port, "/v1/faces/mission-control/view", { body: `AB1\ntok ${tok}\nv 0\n`, headers: lobby });
  assert.equal(parseSnapshot(view.text).mode, "cubes", "Mission Control still sees him signed in");
  // Another world can't read the board.
  const other = await call(port, "/v1/faces/desk/board", { body: `AB1\ntok ${tok}\n`, headers: { "X-World-Address": "more-room.micknerks" } });
  assert.equal(other.status, 403);
});
