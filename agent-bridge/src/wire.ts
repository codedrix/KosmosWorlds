/**
 * wire.ts -- the small text format worlds speak to the bridge.
 *
 * @kosmos-system  Agent bridge (Mission Control, DB-044)
 * @kosmos-owner   Platform
 *
 * A world script is no_std Rust with no allocator and no JSON parser, so the
 * bridge talks to worlds in lines it can read with a dozen lines of code. JSON
 * clients (tests, a future web view) may send JSON instead; both parse to the
 * same `WorldRequest`.
 *
 * REQUEST (world -> bridge), `text/plain` or `application/json`:
 *
 *   AB1
 *   tok <token>          the sign-in token, when there is one
 *   pair <id>            the pairing id from an `I` record, while waiting (32 lowercase hex)
 *   v <n>                the snapshot version the world is showing
 *   press <node>         a node the visitor pressed
 *   ---
 *   <free text>          what the visitor typed (prompt answers), raw
 *
 * SNAPSHOT (bridge -> world), `text/plain; charset=utf-8`, one record a line:
 *
 *   AB1                  magic
 *   V <n>                snapshot version (echo it back as `v`)
 *   M <mode>             lock | pair | cubes | arc
 *   K <token>            a new sign-in token: keep it in memory
 *   I <id>               a pairing id (32 lowercase hex): keep it in memory, echo it as `pair <id>`
 *   E <code>             an event: signed_out, refused, stale, pair_wait, paired, pair_expired,
 *                        pair_refused, passphrase_off, ...
 *   T <node> <text>      show world text on <node>; "\n" in <text> is a newline, "\\" a backslash
 *   X <node>             hide <node>'s world text
 *   U <node> <0|1>       hide or show <node> (k_node_set_visible)
 *   H <node> <state>     paint <node> in <state>: calm | need | idle | armed | locked | off
 *                        (the world shows the variant node <node><State>; off shows none)
 *   (v1, unused by Mission Control v2:)
 *   G <node> <0..1000>   a gauge: <node>'s X scale in thousandths
 *   O <node> <mm>        shift <node> sideways (along the panel's right) by <mm> millimetres
 *   C <node> <count>     show <count> copies of <node> in a row (k_node_clone)
 *   P <node> <question>  pressing <node> first opens the typing sheet with <question>
 *   Z <n>                approvals ever raised; when it rises, buzz and chime
 *   S                    nothing changed since the `v` you sent
 *
 * Every number is an integer, so the world never parses a float.
 */

export const MAGIC = "AB1";

export interface WorldRequest {
  tok?: string;
  v?: number;
  press?: string;
  /** A pairing id the world is waiting on (32 lowercase hex only). */
  pair?: string;
  text?: string;
  fields: Record<string, string>;
}

/** A pairing id: 16 random bytes, lowercase hex. */
export const PAIR_ID_RE = /^[0-9a-f]{32}$/;
/** A colour state the world knows (`H`). */
export type HueState = "calm" | "need" | "idle" | "armed" | "locked" | "off";
export type Mode = "lock" | "pair" | "cubes" | "arc";

const FIELD_RE = /^([a-z]{1,12}) (.{0,200})$/;

export function parseWorldRequest(body: string, contentType: string | undefined): WorldRequest {
  const req: WorldRequest = { fields: {} };
  const trimmed = body.trimStart();
  if ((contentType ?? "").includes("json") || trimmed.startsWith("{")) {
    let j: unknown;
    try {
      j = JSON.parse(body);
    } catch {
      return req;
    }
    if (!j || typeof j !== "object") return req;
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
      if (k === "text" && typeof v === "string") req.text = v;
      else if (/^[a-z]{1,12}$/.test(k) && (typeof v === "string" || typeof v === "number")) req.fields[k] = String(v).slice(0, 200);
    }
  } else {
    const lines = body.replace(/\r\n?/g, "\n").split("\n");
    let i = 0;
    if (lines[0]?.trim() === MAGIC) i = 1;
    for (; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (line === "---") {
        req.text = lines.slice(i + 1).join("\n");
        break;
      }
      const m = FIELD_RE.exec(line);
      if (m && m[1] !== undefined && m[2] !== undefined) req.fields[m[1]] = m[2];
    }
  }
  if (req.fields.tok) req.tok = req.fields.tok;
  if (req.fields.v !== undefined && /^\d{1,9}$/.test(req.fields.v)) req.v = Number(req.fields.v);
  if (req.fields.press && /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(req.fields.press)) req.press = req.fields.press;
  if (req.fields.pair && PAIR_ID_RE.test(req.fields.pair)) req.pair = req.fields.pair;
  return req;
}

export function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
}

/** Builds a snapshot body. Record order is the order the world applies them. */
export class Snapshot {
  private lines: string[] = [];
  private ver = 0;

  /** The version line; written first whatever order it is set in. */
  version(n: number): this {
    this.ver = n;
    return this;
  }
  get versionNumber(): number {
    return this.ver;
  }
  mode(m: Mode): this {
    this.lines.push(`M ${m}`);
    return this;
  }
  token(t: string): this {
    this.lines.push(`K ${t}`);
    return this;
  }
  /** The pairing id the world echoes back while it waits. Refuses anything but 32 lowercase hex. */
  pairId(id: string): this {
    if (!PAIR_ID_RE.test(id)) throw new Error("not a pairing id");
    this.lines.push(`I ${id}`);
    return this;
  }
  /** Paint <node> in <state>. A face calls this from ONE function, the only place a state is chosen. */
  hue(node: string, state: HueState): this {
    this.lines.push(`H ${node} ${state}`);
    return this;
  }
  event(code: string): this {
    this.lines.push(`E ${code}`);
    return this;
  }
  text(node: string, s: string): this {
    this.lines.push(s.length === 0 ? `X ${node}` : `T ${node} ${escapeText(s)}`);
    return this;
  }
  hide(node: string): this {
    this.lines.push(`X ${node}`);
    return this;
  }
  visible(node: string, on: boolean): this {
    this.lines.push(`U ${node} ${on ? 1 : 0}`);
    return this;
  }
  gauge(node: string, fraction: number): this {
    const v = Math.max(0, Math.min(1000, Math.round(fraction * 1000)));
    this.lines.push(`G ${node} ${v}`);
    return this;
  }
  offset(node: string, metres: number): this {
    this.lines.push(`O ${node} ${Math.round(metres * 1000)}`);
    return this;
  }
  copies(node: string, count: number): this {
    this.lines.push(`C ${node} ${Math.max(0, Math.floor(count))}`);
    return this;
  }
  prompt(node: string, question: string): this {
    this.lines.push(`P ${node} ${escapeText(question.slice(0, 200))}`);
    return this;
  }
  buzz(n: number): this {
    this.lines.push(`Z ${n}`);
    return this;
  }
  /** Remove every typing-sheet record (a watcher's copy of the wall must never open one). */
  dropPrompts(): this {
    this.lines = this.lines.filter((l) => !l.startsWith("P "));
    return this;
  }
  /** Remove every earlier record for <node>, so an override is the only one that leaves the PC. */
  forget(node: string): this {
    this.lines = this.lines.filter((l) => {
      const parts = l.split(" ");
      return parts.length < 2 || parts[1] !== node || parts[0] === "Z";
    });
    return this;
  }
  /** Append another snapshot's records (not its version) after these. */
  extend(other: Snapshot): this {
    this.lines.push(...other.lines);
    return this;
  }
  /** How many `T` records (labels shown) this snapshot carries. */
  get shownTexts(): number {
    return this.lines.filter((l) => l.startsWith("T ")).length;
  }
  same(): this {
    this.lines.push("S");
    return this;
  }
  toString(): string {
    return [MAGIC, `V ${this.ver}`, ...this.lines].join("\n") + "\n";
  }
  /** The records without the version: two renders compare equal when this is equal. */
  contentKey(): string {
    return this.lines.join("\n");
  }
}
