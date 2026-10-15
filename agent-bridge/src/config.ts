/**
 * config.ts -- where the bridge keeps its settings and secrets on the PC.
 *
 * @kosmos-system  Agent bridge (Mission Control, DB-043)
 * @kosmos-owner   Platform
 *
 * Everything secret lives OUTSIDE the repository, in the bridge's home folder:
 *   %APPDATA%\kosmos-agent-bridge\   (Windows)
 *   ~/.kosmos-agent-bridge/          (elsewhere)
 * or wherever AGENT_BRIDGE_HOME points (the tests use a temporary folder).
 *
 * The passphrase is never stored: only an scrypt hash with its own salt.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ProjectEntry {
  /** Short name shown on the wall, e.g. "kosmos-project". */
  name: string;
  /** Absolute folder Claude Code runs in. Only these folders are ever used. */
  path: string;
}

export interface PassphraseHash {
  algo: "scrypt";
  n: number;
  r: number;
  p: number;
  salt: string; // base64
  hash: string; // base64
}

export interface BridgeConfig {
  /** Loopback port. The bridge never listens on any other interface. */
  port: number;
  /** World addresses listed in /.well-known/world-network.json, beyond each face's own. */
  worlds: string[];
  /** The only folders a job may run in. The first is the default. */
  projects: ProjectEntry[];
  /** At most this many jobs run at once (the wall has four cards). */
  maxJobs: number;
  /** Optional model id for Claude jobs; unset = Claude Code's own default from settings. */
  model?: string;
  /** Optional path to a Claude Code executable; unset = the SDK's bundled one. */
  claudeExecutable?: string;
  /** Correction to world-text widths found at the device check (1 = as the client claims). */
  textScale?: number;
  /**
   * When set, every /v1/ request must carry X-Relay-Key with this value: the relay Worker adds
   * it, so a request that reaches the tunnel any other way is refused. Same value as the
   * Worker's RELAY_SECRET; never commit it.
   */
  relaySecret?: string;
  passphrase?: PassphraseHash;
}

export const DEFAULT_PORT = 8787;

export function bridgeHome(): string {
  const env = process.env.AGENT_BRIDGE_HOME;
  if (env && env.trim()) return path.resolve(env);
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "kosmos-agent-bridge");
  }
  return path.join(os.homedir(), ".kosmos-agent-bridge");
}

export function configPath(): string {
  return path.join(bridgeHome(), "config.json");
}

export function defaultConfig(): BridgeConfig {
  return {
    port: DEFAULT_PORT,
    worlds: [],
    projects: [],
    maxJobs: 4,
  };
}

/** Reads config.json, filling defaults. A missing file is the default config. */
export function loadConfig(): BridgeConfig {
  const file = configPath();
  let raw: unknown = {};
  if (fs.existsSync(file)) {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  }
  return normalizeConfig(raw);
}

export function normalizeConfig(raw: unknown): BridgeConfig {
  const c = defaultConfig();
  if (!raw || typeof raw !== "object") return c;
  const r = raw as Record<string, unknown>;
  if (typeof r.port === "number" && Number.isInteger(r.port) && r.port > 0 && r.port < 65536) c.port = r.port;
  if (Array.isArray(r.worlds)) c.worlds = r.worlds.filter((w): w is string => typeof w === "string");
  if (Array.isArray(r.projects)) {
    c.projects = r.projects
      .filter((p): p is ProjectEntry => !!p && typeof p === "object" && typeof (p as ProjectEntry).name === "string" && typeof (p as ProjectEntry).path === "string")
      .map((p) => ({ name: p.name.slice(0, 32), path: path.resolve(p.path) }));
  }
  if (typeof r.maxJobs === "number" && r.maxJobs >= 1 && r.maxJobs <= 4) c.maxJobs = Math.floor(r.maxJobs);
  if (typeof r.model === "string" && r.model) c.model = r.model;
  if (typeof r.claudeExecutable === "string" && r.claudeExecutable) c.claudeExecutable = r.claudeExecutable;
  if (typeof r.textScale === "number") c.textScale = r.textScale;
  if (typeof r.relaySecret === "string" && r.relaySecret.length >= 24) c.relaySecret = r.relaySecret;
  if (r.passphrase && typeof r.passphrase === "object") c.passphrase = r.passphrase as PassphraseHash;
  return c;
}

export function saveConfig(c: BridgeConfig): void {
  fs.mkdirSync(bridgeHome(), { recursive: true });
  const tmp = configPath() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(c, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, configPath());
}

// ---------------------------------------------------------------------------
// The passphrase
// ---------------------------------------------------------------------------

/** At least this many characters: a headset keyboard is slow, so four words is the target. */
export const MIN_PASSPHRASE_CHARS = 16;

const SCRYPT = { n: 1 << 15, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };

/** Lowercase, trim and collapse spaces: what a headset keyboard or dictation types varies. */
export function normalizePassphrase(s: string): string {
  return s.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

export function hashPassphrase(pass: string): PassphraseHash {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(normalizePassphrase(pass), salt, SCRYPT.keylen, {
    N: SCRYPT.n, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem,
  });
  return { algo: "scrypt", n: SCRYPT.n, r: SCRYPT.r, p: SCRYPT.p, salt: salt.toString("base64"), hash: hash.toString("base64") };
}

export function verifyPassphrase(pass: string, h: PassphraseHash | undefined): boolean {
  if (!h || h.algo !== "scrypt") return false;
  const want = Buffer.from(h.hash, "base64");
  const got = crypto.scryptSync(normalizePassphrase(pass), Buffer.from(h.salt, "base64"), want.length, {
    N: h.n, r: h.r, p: h.p, maxmem: SCRYPT.maxmem,
  });
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
