/**
 * killswitch.ts -- the stop on the PC.
 *
 * @kosmos-system  Agent bridge (Mission Control, DB-044)
 * @kosmos-owner   Platform
 *
 * A file named STOP in the bridge's home folder means: refuse every request
 * from the headset, stop every running job, deny every waiting approval and end
 * every sign-in. It is a FILE so that it works with the bridge running or not,
 * from any terminal (`npm run kill`), from a desktop shortcut, or by hand, and
 * it survives a restart: the bridge starts stopped until `npm run unkill`.
 *
 * A second file, LOCKED, is written when too many wrong passphrases arrive
 * (auth.ts). It has the same effect on sign-in only, and only the PC clears it.
 */

import fs from "node:fs";
import path from "node:path";
import { bridgeHome } from "./config.js";

export function stopFile(): string {
  return path.join(bridgeHome(), "STOP");
}

export function lockFile(): string {
  return path.join(bridgeHome(), "LOCKED");
}

export function isKilled(): boolean {
  return fs.existsSync(stopFile());
}

export function kill(reason: string): void {
  fs.mkdirSync(bridgeHome(), { recursive: true });
  fs.writeFileSync(stopFile(), `${new Date().toISOString()} ${reason}\n`);
}

export function unkill(): void {
  fs.rmSync(stopFile(), { force: true });
}

export function isHardLocked(): boolean {
  return fs.existsSync(lockFile());
}

export function hardLock(reason: string): void {
  fs.mkdirSync(bridgeHome(), { recursive: true });
  fs.writeFileSync(lockFile(), `${new Date().toISOString()} ${reason}\n`);
}

export function clearHardLock(): void {
  fs.rmSync(lockFile(), { force: true });
}
