/**
 * adapters/claude.ts -- Claude Code through the Claude Agent SDK.
 *
 * @kosmos-system  Agent bridge (Mission Control, DB-043)
 * @kosmos-owner   Platform
 *
 * Each job is one Claude Code session in one of the CEO's project folders,
 * with the CEO's own login, settings, CLAUDE.md, memory, skills and MCP servers
 * (`settingSources` loads user, project and local settings: the CLI default).
 *
 * THE APPROVAL RULE. `permissionMode` is always 'default', set explicitly,
 * because an omitted mode follows `permissions.defaultMode` in the settings and
 * could be 'auto' or 'acceptEdits'. In 'default', Claude Code's own permission
 * rules decide first: what they allow runs, what they deny never runs, and
 * every case where Claude Code would show a prompt reaches `canUseTool`. Each
 * such call becomes exactly one approval on the wall (one-to-one), and the
 * answer goes back as that prompt's answer:
 *
 *   Approve  -> { behavior: 'allow' }       (this once; never "always allow")
 *   Deny     -> { behavior: 'deny', message: "The user denied this from the headset." }
 *   Ask why  -> { behavior: 'deny', message: "Before running it, explain in two
 *               sentences why you need it; then ask again." }
 *
 * A typed message is sent to Claude as a user prompt. Nothing typed in the
 * headset is ever run as a command by the bridge.
 *
 * The session id is recorded on the job, so the CEO can continue at the desk:
 * `claude --resume <id>` in the same project folder.
 */

import { query, type Query, type SDKMessage, type SDKUserMessage, type CanUseTool, type PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { JobSink, Decision } from "../jobs.js";
import type { AgentAdapter, StartOptions } from "./types.js";

/** Tools whose permission prompt can't be answered from a headset in v1. */
const HEADSET_REFUSES: Record<string, string> = {
  AskUserQuestion: "The user is in a VR headset and can't answer a multiple-choice question. Ask in plain words in your reply instead.",
  ExitPlanMode: "The user is in a VR headset. Write the plan in your reply and wait for them to say go.",
};

/**
 * The CEO's project settings allow many commands with no prompt (Bash(powershell:*) and
 * Bash(curl:*) among them, 2026-10-14), which at the desk he can watch. In the headset he
 * can't, and a file or page Claude reads could ask for one, so shell commands always ask.
 */
export const DEFAULT_ALWAYS_ASK = ["Bash", "PowerShell"];

const WHY_MESSAGE =
  "The user asked why, from the headset. Before running it, explain in two short sentences why you need this, then request it again.";
const DENY_MESSAGE = "The user denied this from the headset. Do not try it another way; say what you would need instead.";

/** A push-based async iterable for the session's streaming input. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private wake: (() => void) | null = null;
  private closed = false;

  push(text: string): void {
    if (this.closed) return;
    this.items.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null } as SDKUserMessage);
    this.wake?.();
  }

  close(): void {
    this.closed = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    while (true) {
      const next = this.items.shift();
      if (next) {
        yield next;
        continue;
      }
      if (this.closed) return;
      await new Promise<void>((r) => (this.wake = r));
      this.wake = null;
    }
  }
}

interface Live {
  q: Query;
  input: InputQueue;
  sink: JobSink;
  stopped: boolean;
  /** A preset job ends after its first turn; a conversation waits for the next message. */
  oneShot: boolean;
}

export interface ClaudeAdapterOptions {
  model?: string;
  executable?: string;
  /**
   * The headset policy: tool rules that must prompt in a headset job even when the CEO's
   * settings allow them (`permissions.ask` in managed settings; ask beats allow). Default
   * ["Bash", "PowerShell"]: every shell command is approved on the wall. [] = the CEO's own
   * rules exactly as at the desk (DB-043 Q3).
   */
  alwaysAsk?: string[];
  /** For tests: replace the SDK's query(). */
  queryFn?: typeof query;
}

export class ClaudeAdapter implements AgentAdapter {
  readonly name = "claude";
  private live = new Map<string, Live>();

  private readonly alwaysAsk: string[];

  constructor(private readonly opts: ClaudeAdapterOptions = {}) {
    this.alwaysAsk = opts.alwaysAsk ?? DEFAULT_ALWAYS_ASK;
  }

  async start(sink: JobSink, o: StartOptions): Promise<void> {
    const input = new InputQueue();
    input.push(o.prompt);

    const canUseTool: CanUseTool = async (toolName, toolInput, ctx): Promise<PermissionResult> => {
      const refuse = HEADSET_REFUSES[toolName];
      if (refuse) return { behavior: "deny", message: refuse };
      const decision: Decision = await sink.requestApproval(toolName, toolInput, ctx.title ?? undefined);
      if (ctx.signal.aborted) return { behavior: "deny", message: DENY_MESSAGE };
      if (decision === "approve") return { behavior: "allow", updatedInput: toolInput };
      if (decision === "why") return { behavior: "deny", message: WHY_MESSAGE };
      return { behavior: "deny", message: DENY_MESSAGE };
    };

    const q = (this.opts.queryFn ?? query)({
      prompt: input,
      options: {
        cwd: sink.cwd,
        permissionMode: "default",
        settingSources: ["user", "project", "local"],
        canUseTool,
        includePartialMessages: true,
        ...(this.alwaysAsk.length > 0 ? { managedSettings: { permissions: { ask: this.alwaysAsk } } } : {}),
        ...(o.resume ? { resume: o.resume } : {}),
        ...(this.opts.model ? { model: this.opts.model } : {}),
        ...(this.opts.executable ? { pathToClaudeCodeExecutable: this.opts.executable } : {}),
      },
    });
    const live: Live = { q, input, sink, stopped: false, oneShot: o.oneShot ?? false };
    this.live.set(sink.jobId, live);
    sink.setStatus("running");
    void this.pump(live);
  }

  private async pump(live: Live): Promise<void> {
    const { sink } = live;
    let streamedThisMessage = false;
    try {
      for await (const m of live.q as AsyncIterable<SDKMessage>) {
        streamedThisMessage = this.handle(live, m, streamedThisMessage);
      }
      if (!live.stopped) sink.setStatus("done");
    } catch (err) {
      if (live.stopped) return;
      sink.notice(`The agent stopped with an error: ${String((err as Error)?.message ?? err).slice(0, 160)}`);
      sink.setStatus("failed", "Stopped with an error");
    } finally {
      this.live.delete(sink.jobId);
    }
  }

  /** Returns whether text for the current assistant message already arrived as stream deltas. */
  private handle(live: Live, m: SDKMessage, streamed: boolean): boolean {
    const { sink } = live;
    const any = m as Record<string, unknown> & { type: string; subtype?: string };
    switch (any.type) {
      case "system":
        if (any.subtype === "init" && typeof any.session_id === "string") sink.setSessionId(any.session_id);
        return streamed;
      case "stream_event": {
        const ev = any.event as { type?: string; delta?: { type?: string; text?: string }; content_block?: { type?: string } } | undefined;
        if (ev?.type === "message_start") {
          return false;
        }
        if (ev?.type === "content_block_start" && ev.content_block?.type === "text") {
          sink.agentText("", { newMessage: true });
          return true;
        }
        if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
          sink.agentText(ev.delta.text);
          return true;
        }
        return streamed;
      }
      case "assistant": {
        if ((any.parent_tool_use_id ?? null) !== null) return streamed; // a helper agent's inner turn
        const content = ((any.message as { content?: unknown[] })?.content ?? []) as Array<Record<string, unknown>>;
        for (const block of content) {
          if (block.type === "text" && typeof block.text === "string" && !streamed) {
            sink.agentText(block.text, { newMessage: true });
          } else if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
            sink.toolUse(block.id, block.name, (block.input as Record<string, unknown>) ?? {});
          }
        }
        return false;
      }
      case "user": {
        const content = (any.message as { content?: unknown })?.content;
        if (Array.isArray(content)) {
          for (const block of content as Array<Record<string, unknown>>) {
            if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
              sink.toolResult(block.tool_use_id, flattenToolResult(block.content), block.is_error === true);
            }
          }
        }
        return streamed;
      }
      case "result":
        // The end of one turn. A preset job is finished; a conversation waits for the CEO.
        if (any.subtype !== "success") sink.notice("The turn ended early.");
        if (live.oneShot) live.input.close();
        else sink.setStatus("idle");
        return false;
      default:
        return streamed;
    }
  }

  isLive(jobId: string): boolean {
    return this.live.has(jobId);
  }

  async send(jobId: string, text: string): Promise<void> {
    const live = this.live.get(jobId);
    if (!live) throw new Error("job_not_running");
    live.input.push(text);
  }

  async interrupt(jobId: string): Promise<void> {
    await this.live.get(jobId)?.q.interrupt();
  }

  async stop(jobId: string): Promise<void> {
    const live = this.live.get(jobId);
    if (!live) return;
    live.stopped = true;
    live.input.close();
    try {
      await live.q.interrupt();
    } catch {
      /* already idle */
    }
    try {
      live.q.close();
    } catch {
      /* already closed */
    }
    live.sink.setStatus("stopped", "Stopped from the headset");
    this.live.delete(jobId);
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.live.keys()].map((id) => this.stop(id)));
  }
}

function flattenToolResult(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((b) => (b && typeof b === "object" && typeof (b as { text?: unknown }).text === "string" ? (b as { text: string }).text : "")).join("\n");
  return "";
}
