/**
 * watch.ts -- watch codes: let the owner's group watch the wall, read-only.
 *
 * @kosmos-system  Agent bridge (Mission Control, DB-044)
 * @kosmos-owner   Platform
 *
 * Off by default. The owner turns "Let my group watch" on from the panel; the
 * bridge makes a six-digit code, the panel shows it, the owner shares it (group
 * chat, or aloud), and a group member types it at the Watch button in the Lobby.
 * A watcher sees what the owner sees, plus the last thing the owner pressed.
 *
 * A watch code can never approve, type, start or stop anything: the face's watch
 * op renders a snapshot and maps no presses. It dies when:
 *   - the owner turns watching off, signs out, or the bridge is stopped;
 *   - the owner's own wall has not asked for an update for 20 s (the owner left
 *     the Lobby: the headset closes a world's network at travel, so leaving
 *     can't announce itself);
 *   - 2 hours pass.
 * Guessing: at most 10 wrong codes a minute across everyone, then a minute's
 * wait. A million codes, live only while the owner is on the wall.
 */

import crypto from "node:crypto";

export const OWNER_GONE_MS = 20_000;
export const CODE_MAX_MS = 2 * 60 * 60 * 1000;
export const WRONG_PER_MINUTE = 10;

export type WatchCheck = "ok" | "wrong" | "off" | "owner_gone" | "too_many";

export class WatchGate {
  private code: string | null = null;
  private openedAt = 0;
  private ownerSeenAt = 0;
  private wrong: number[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  open(): string {
    this.code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
    this.openedAt = this.now();
    this.ownerSeenAt = this.now();
    return this.code;
  }

  close(): void {
    this.code = null;
  }

  get current(): string | null {
    if (this.code && this.now() - this.openedAt > CODE_MAX_MS) this.code = null;
    return this.code;
  }

  /** The owner's wall just asked for an update. */
  ownerSeen(): void {
    this.ownerSeenAt = this.now();
  }

  check(code: string | undefined): WatchCheck {
    const t = this.now();
    this.wrong = this.wrong.filter((x) => t - x < 60_000);
    if (this.wrong.length >= WRONG_PER_MINUTE) return "too_many";
    const live = this.current;
    if (!live) {
      this.wrong.push(t);
      return "off";
    }
    const a = Buffer.from(String(code ?? "").replace(/\D/g, "").slice(0, 6));
    const b = Buffer.from(live);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      this.wrong.push(t);
      return "wrong";
    }
    if (t - this.ownerSeenAt > OWNER_GONE_MS) return "owner_gone";
    return "ok";
  }
}
