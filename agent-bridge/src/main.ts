#!/usr/bin/env node
/**
 * main.ts -- the agent bridge's command line.
 *
 * @kosmos-system  Agent bridge (Mission Control, DB-044)
 * @kosmos-owner   Platform
 *
 *   agent-bridge init                       write a config with the Kosmos project folders that exist
 *   agent-bridge set-passphrase             set the passphrase typed in the world (asked twice, hidden)
 *   agent-bridge add-project <name> <path>  allow another folder
 *   agent-bridge serve [--adapter fake] [--port N] [--public-host HOST]
 *   agent-bridge kill [reason]              the stop: refuse everything, stop every job
 *   agent-bridge unkill                     lift the stop (restart `serve` afterwards to be sure)
 *   agent-bridge unlock                     clear the lock left by too many wrong passphrases
 *   agent-bridge status                     what is set, without printing any secret
 *   agent-bridge make-relay-secret          the shared secret for the relay Worker (DB-044 option A)
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Bridge } from "./bridge.js";
import { MIN_PASSPHRASE_CHARS, bridgeHome, configPath, hashPassphrase, loadConfig, normalizePassphrase, saveConfig } from "./config.js";
import { clearHardLock, isHardLocked, isKilled, kill, stopFile, unkill } from "./killswitch.js";
import { loadFaces } from "./faces/registry.js";
import { createServer } from "./server.js";
import { setTextScale } from "./sanitize.js";
import { ClaudeAdapter } from "./adapters/claude.js";
import { FakeAdapter } from "./adapters/fake.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let muted = false;
    out._writeToOutput = (s: string) => {
      if (!muted) out.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

const KNOWN_PROJECTS: Array<[string, string]> = [
  ["kosmos-project", path.join(os.homedir(), "Documents", "Kosmos Project")],
  ["kosmos-registry", path.join(os.homedir(), "kosmos-registry")],
  ["kosmos-worldpublisher", path.join(os.homedir(), "kosmos-worldpublisher")],
  ["kosmos-portal", path.join(os.homedir(), "kosmos-portal")],
  ["kosmos-web", path.join(os.homedir(), "kosmos-web")],
  ["KosmosWorlds", path.join(os.homedir(), "KosmosWorlds")],
  ["kosmos-creator-sdk", path.join(os.homedir(), "kosmos-creator-sdk")],
];

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "help";
  const config = loadConfig();

  switch (cmd) {
    case "init": {
      if (config.projects.length === 0) config.projects = KNOWN_PROJECTS.filter(([, p]) => fs.existsSync(p)).map(([name, p]) => ({ name, path: p }));
      saveConfig(config);
      console.log(`Wrote ${configPath()}`);
      for (const p of config.projects) console.log(`  project ${p.name}: ${p.path}`);
      console.log(config.passphrase ? "A passphrase is set." : "Next: npm run set-passphrase");
      return;
    }
    case "set-passphrase": {
      const a = await askHidden(`New passphrase (at least ${MIN_PASSPHRASE_CHARS} characters; four plain words is ideal): `);
      if (normalizePassphrase(a).length < MIN_PASSPHRASE_CHARS) {
        console.error(`Too short: at least ${MIN_PASSPHRASE_CHARS} characters.`);
        process.exitCode = 1;
        return;
      }
      const b = await askHidden("Type it again: ");
      if (normalizePassphrase(a) !== normalizePassphrase(b)) {
        console.error("They don't match. Nothing changed.");
        process.exitCode = 1;
        return;
      }
      config.passphrase = hashPassphrase(a);
      saveConfig(config);
      console.log("Passphrase set (only a hash is stored). Capitals and extra spaces are ignored when you type it.");
      return;
    }
    case "add-project": {
      const name = process.argv[3];
      const p = process.argv[4];
      if (!name || !p || !fs.existsSync(p)) {
        console.error("Usage: agent-bridge add-project <name> <existing folder>");
        process.exitCode = 1;
        return;
      }
      config.projects = config.projects.filter((x) => x.name !== name).concat({ name, path: path.resolve(p) });
      saveConfig(config);
      console.log(`Allowed ${name}: ${path.resolve(p)}`);
      return;
    }
    case "make-relay-secret": {
      // The shared secret between the relay Worker and this bridge (DB-044 option A).
      // It is never printed: it goes to the bridge's config file and, through stdin, straight to
      // `wrangler secret put` (sign in with `npx wrangler login` first; deploy the Worker once first).
      const secret = crypto.randomBytes(32).toString("base64url");
      const relayDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "relay-worker");
      const put = spawnSync("npx", ["wrangler", "secret", "put", "RELAY_SECRET"], {
        cwd: relayDir,
        input: secret,
        shell: true,
        stdio: ["pipe", "inherit", "inherit"],
        env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --dns-result-order=ipv4first`.trim() },
      });
      if (put.status !== 0) {
        console.error("wrangler did not take the secret, so the bridge's config is unchanged. Run `npx wrangler login`, deploy the Worker, and try again.");
        process.exitCode = 1;
        return;
      }
      config.relaySecret = secret;
      saveConfig(config);
      console.log("Done: the relay Worker and this bridge now share a new key (never shown). Restart the bridge.");
      return;
    }
    case "kill":
      kill(process.argv.slice(3).join(" ") || "npm run kill");
      console.log(`STOPPED. ${stopFile()} exists: the bridge refuses every request and stops every job. Lift it with: npm run unkill`);
      return;
    case "unkill":
      unkill();
      console.log("The stop is lifted. Restart `npm start` to be sure nothing old is running.");
      return;
    case "unlock":
      clearHardLock();
      console.log("Sign-in is unlocked.");
      return;
    case "status":
      console.log(`home:        ${bridgeHome()}`);
      console.log(`passphrase:  ${config.passphrase ? "set" : "NOT SET"}`);
      console.log(`stopped:     ${isKilled() ? "YES (npm run unkill)" : "no"}`);
      console.log(`locked:      ${isHardLocked() ? "YES (npm run unlock)" : "no"}`);
      console.log(`port:        127.0.0.1:${config.port}`);
      console.log(`relay key:   ${config.relaySecret ? "set (only the relay Worker can call)" : "not set (direct tunnel)"}`);
      for (const p of config.projects) console.log(`project:     ${p.name}  ${p.path}${fs.existsSync(p.path) ? "" : "  (MISSING)"}`);
      return;
    case "serve": {
      const port = Number(arg("--port") ?? config.port);
      config.port = port;
      const adapterName = arg("--adapter") ?? "claude";
      const adapter = adapterName === "fake" ? new FakeAdapter(1000) : new ClaudeAdapter({ model: config.model, executable: config.claudeExecutable, alwaysAsk: config.alwaysAsk });
      if (adapterName === "fake" && config.projects.length === 0) config.projects = [{ name: "demo-project", path: os.tmpdir() }];
      if (!config.passphrase) console.warn("WARNING: no passphrase is set, so nobody can sign in. Run: npm run set-passphrase");
      if (config.projects.length === 0) console.warn("WARNING: no project folders are allowed. Run: npm run init");
      setTextScale(config.textScale ?? 1);
      const bridge = new Bridge(config, adapter);
      const faces = await loadFaces();
      const publicHost = arg("--public-host") ?? process.env.AGENT_BRIDGE_PUBLIC_HOST;
      if (publicHost && !config.relaySecret && !process.argv.includes("--direct-tunnel")) {
        // A public host with no relay key means the tunnel URL alone reaches the bridge, with only
        // the passphrase in the way. Refuse unless that is chosen on purpose (DB-044 option C).
        console.error(`REFUSED: a public host (${publicHost}) is set but no relay key is configured in ${configPath()}.`);
        console.error("Run `npm run make-relay-secret` (after the relay Worker is deployed), or add --direct-tunnel to accept a tunnel without the relay.");
        process.exitCode = 1;
        return;
      }
      const server = createServer(bridge, faces, { port, publicHost });
      // Watch the stop file even when no request arrives, so `npm run kill` stops jobs at once.
      const watch = setInterval(() => {
        if (isKilled()) void bridge.enforceKill();
      }, 1000);
      server.listen(port, "127.0.0.1", () => {
        console.log(`agent-bridge (${adapter.name}${adapterName === "fake" ? ", FAKE demo adapter" : ""}) on http://127.0.0.1:${port}`);
        console.log(`faces: ${[...faces.keys()].join(", ")}`);
        if (isKilled()) console.log("STOPPED: the STOP file exists. npm run unkill to lift it.");
      });
      const shutdown = async () => {
        clearInterval(watch);
        server.close();
        await bridge.shutdown();
        process.exit(0);
      };
      process.on("SIGINT", () => void shutdown());
      process.on("SIGTERM", () => void shutdown());
      return;
    }
    default:
      console.log("agent-bridge init | set-passphrase | add-project <name> <path> | serve [--adapter fake] | kill | unkill | unlock | status");
  }
}

void main();
