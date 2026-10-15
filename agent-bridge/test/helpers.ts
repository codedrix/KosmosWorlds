/**
 * test/helpers.ts -- a temporary bridge home and a running bridge on a free port.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";

/** Point the bridge at a fresh temporary home. Call before importing anything that reads it. */
export function tempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-bridge-test-"));
  process.env.AGENT_BRIDGE_HOME = dir;
  return dir;
}

export const PASS = "correct horse battery staple";
export const WORLD = "lobby.micknerks";

export async function startBridge(stepMs = 5, longPollMs = 300, rate = { perSecond: 1000, burst: 1000 }) {
  const { Bridge } = await import("../src/bridge.js");
  const { FakeAdapter } = await import("../src/adapters/fake.js");
  const { createServer } = await import("../src/server.js");
  const { MissionControlFace } = await import("../src/faces/mission-control/index.js");
  const { hashPassphrase, defaultConfig } = await import("../src/config.js");

  const project = fs.mkdtempSync(path.join(os.tmpdir(), "agent-bridge-proj-"));
  const config = { ...defaultConfig(), port: 0, projects: [{ name: "kosmos-registry", path: project }], passphrase: hashPassphrase(PASS) };
  const adapter = new FakeAdapter(stepMs);
  const bridge = new Bridge(config, adapter);
  const face = new MissionControlFace();
  face.longPollMs = longPollMs;
  const faces = new Map([[face.name, face]]);
  const logs: string[] = [];
  const server = createServer(bridge, faces, { port: 0, log: (l) => logs.push(l), rate });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  // The Host check uses the configured port; the test server got a random one.
  const host = `127.0.0.1:${port}`;
  (server as unknown as { __host: string }).__host = host;

  const close = async () => {
    await bridge.shutdown();
    await new Promise<void>((r) => server.close(() => r()));
  };
  return { bridge, face, server, port, logs, close, project };
}

/** A raw HTTP call (fetch would drop a custom Host header). */
export function call(port: number, p: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const body = init.body ?? "";
    const req = http.request(
      { host: "127.0.0.1", port, path: p, method: init.method ?? "POST", agent: false, headers: { Host: `127.0.0.1:${port}`, "X-World-Address": WORLD, "Content-Length": Buffer.byteLength(body), ...(init.headers ?? {}) } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", (e: NodeJS.ErrnoException) => (e.code === "ECONNRESET" || e.code === "EPIPE" ? resolve({ status: 413, text: "" }) : reject(e)));
    req.end(body);
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Parse a wire snapshot into a small map for assertions. */
export function parseSnapshot(body: string) {
  const out = { v: -1, mode: "", token: "", events: [] as string[], text: new Map<string, string>(), hidden: new Set<string>(), visible: new Map<string, boolean>(), gauge: new Map<string, number>(), offset: new Map<string, number>(), copies: new Map<string, number>(), prompt: new Map<string, string>(), buzz: -1, same: false, raw: body };
  for (const line of body.split("\n")) {
    const [k, a, ...rest] = line.split(" ");
    const b = rest.join(" ");
    switch (k) {
      case "V": out.v = Number(a); break;
      case "M": out.mode = a ?? ""; break;
      case "K": out.token = a ?? ""; break;
      case "E": out.events.push(a ?? ""); break;
      case "T": out.text.set(a ?? "", b.replace(/\\n/g, "\n").replace(/\\\\/g, "\\")); out.hidden.delete(a ?? ""); break;
      case "X": out.hidden.add(a ?? ""); out.text.delete(a ?? ""); break;
      case "U": out.visible.set(a ?? "", b === "1"); break;
      case "G": out.gauge.set(a ?? "", Number(b)); break;
      case "O": out.offset.set(a ?? "", Number(b)); break;
      case "C": out.copies.set(a ?? "", Number(b)); break;
      case "P": out.prompt.set(a ?? "", b); break;
      case "Z": out.buzz = Number(a); break;
      case "S": out.same = true; break;
    }
  }
  return out;
}

export function worldBody(fields: Record<string, string | number>, text?: string): string {
  const lines = ["AB1", ...Object.entries(fields).map(([k, v]) => `${k} ${v}`)];
  if (text !== undefined) lines.push("---", text);
  return lines.join("\n");
}
