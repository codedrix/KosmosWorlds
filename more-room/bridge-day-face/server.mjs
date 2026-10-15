#!/usr/bin/env node
/**
 * server.mjs -- the local mock bridge: the sample day on http://127.0.0.1:8787.
 *
 * @kosmos-system  Content (KosmosWorlds) -- More Room
 * @kosmos-owner   More Room v1 (design session 2026-10-14)
 *
 * Usage:  node more-room/bridge-day-face/server.mjs [--port 8787] [--dev]
 *   MORE_ROOM_PASSPHRASE  the passphrase (default "sample-day", the mock's test value)
 *
 * Local only and plain http: the headset calls https origins only, so this
 * serves the mock host (../tools/mock-host.mjs) and a browser. --dev enables
 * POST /day/v1/_mock/arrive, which lands the next sample message.
 */

import http from "node:http";
import { createDayFace, LIMITS } from "./day-face.mjs";

const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]) || 8787;
const face = createDayFace({ passphrase: process.env.MORE_ROOM_PASSPHRASE ?? "sample-day", dev: args.includes("--dev") });

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
      const out = face.handle(req.method, path, Buffer.concat(chunks));
      const bytes = Buffer.from(out.body, "utf8");
      if (bytes.length > LIMITS.responseMaxBytes) throw new Error("answer over 256 KiB");
      res.writeHead(out.status, { "content-type": out.contentType, "content-length": bytes.length, "cache-control": "no-store" });
      res.end(bytes);
      console.log(`${req.method} ${path} -> ${out.status} (${bytes.length} B)`);
    });
  })
  .listen(port, "127.0.0.1", () => console.log(`More Room mock bridge on http://127.0.0.1:${port}`));
