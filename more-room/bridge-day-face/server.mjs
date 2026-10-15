#!/usr/bin/env node
/**
 * server.mjs -- the mock bridge on http://127.0.0.1:8787, serving More Room's face
 * with the invented sample day.
 *
 * @kosmos-system  Content (KosmosWorlds) -- More Room
 * @kosmos-owner   More Room v1 (design session 2026-10-14)
 *
 * Usage:  node --experimental-strip-types more-room/bridge-day-face/server.mjs [--port 8787] [--dev]
 *   MORE_ROOM_PASSPHRASE  the passphrase (default "sample-day", the mock's test value)
 *
 * Local and plain http only (the headset calls https origins; the real front
 * door is Mission Control's relay Worker). Face calls need the header
 * X-World-Address: more-room.micknerks, as the headset sends. --dev enables
 * the face op "arrive", which lands the next sample message.
 */

import http from "node:http";
import { createMockBridge, LIMITS } from "./mock-bridge.mjs";

const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]) || 8787;
const bridge = createMockBridge({ passphrase: process.env.MORE_ROOM_PASSPHRASE ?? "sample-day", dev: args.includes("--dev") });

http
  .createServer((req, res) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size <= LIMITS.requestMaxBytes + 1) chunks.push(c);
    });
    req.on("end", () => {
      const path = new URL(req.url, "http://x").pathname;
      const out = bridge.handle(req.method, path, Buffer.concat(chunks), req.headers);
      const bytes = Buffer.from(out.body, "utf8");
      res.writeHead(out.status, { "content-type": out.contentType, "content-length": bytes.length, "cache-control": "no-store" });
      res.end(bytes);
      console.log(`${req.method} ${path} -> ${out.status} (${bytes.length} B)`); // never a body
    });
  })
  .listen(port, "127.0.0.1", () => console.log(`More Room mock bridge on http://127.0.0.1:${port}`));
