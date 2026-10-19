import { test } from "node:test";
import assert from "node:assert/strict";
import { ClaudeAdapter } from "../src/adapters/claude.js";
import { JobStore } from "../src/jobs.js";

/** A stand-in for the SDK's query(): records the options, replays scripted messages. */
function fakeQuery(script: (opts: Record<string, unknown>) => AsyncGenerator<Record<string, unknown>>) {
  const seen: Record<string, unknown>[] = [];
  const fn = ((params: { prompt: unknown; options: Record<string, unknown> }) => {
    seen.push(params.options);
    const gen = script(params.options);
    return Object.assign(gen, { interrupt: async () => undefined, close: () => undefined });
  }) as never;
  return { fn, seen };
}

test("Claude runs with the CEO's settings, 'default' permissions, and every prompt becomes one approval", async () => {
  const answers: unknown[] = [];
  let endSession: () => void = () => undefined;
  const { fn, seen } = fakeQuery(async function* (opts) {
    yield { type: "system", subtype: "init", session_id: "sess-123" };
    yield { type: "stream_event", event: { type: "content_block_start", content_block: { type: "text" } } };
    yield { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Running " } } };
    yield { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "the tests." } } };
    yield { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "Running the tests." }, { type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test" } }] } };
    const canUseTool = opts.canUseTool as (n: string, i: Record<string, unknown>, c: { signal: AbortSignal }) => Promise<unknown>;
    answers.push(await canUseTool("Bash", { command: "npm test" }, { signal: new AbortController().signal }));
    answers.push(await canUseTool("Bash", { command: "npm run lint" }, { signal: new AbortController().signal }));
    answers.push(await canUseTool("Bash", { command: "git push" }, { signal: new AbortController().signal }));
    answers.push(await canUseTool("AskUserQuestion", { questions: [] }, { signal: new AbortController().signal }));
    yield { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "# pass 9\n# fail 0" }] } };
    yield { type: "result", subtype: "success" };
    // A live session stays open after its turn, waiting for the next message.
    await new Promise<void>((r) => (endSession = r));
  });
  const store = new JobStore();
  const job = store.createJob({ agent: "claude", project: "p", cwd: "C:/p", title: "t" });
  const adapter = new ClaudeAdapter({ queryFn: fn });

  // Answer each approval as it appears: approve, ask why, deny.
  const decisions = ["approve", "why", "deny"] as const;
  let i = 0;
  const timer = setInterval(() => {
    const a = store.pendingFor(job.id);
    if (a && i < decisions.length) store.decide(a.id, decisions[i++] as "approve");
  }, 2);
  await adapter.start(store.sink(job.id), { prompt: "go" });
  for (let k = 0; k < 200 && job.status !== "idle"; k++) await new Promise((r) => setTimeout(r, 5));
  clearInterval(timer);
  endSession();

  const opts = seen[0] as Record<string, unknown>;
  assert.equal(opts.permissionMode, "default");
  assert.deepEqual(opts.settingSources, ["user", "project", "local"]);
  // The headset policy: shell commands always ask, whatever the CEO's allow rules say.
  assert.deepEqual(opts.managedSettings, { permissions: { ask: ["Bash", "PowerShell", "Edit(**/.claude/**)", "Edit(**/.mcp.json)", "Edit(**/.git/**)"] } });
  assert.equal(opts.cwd, "C:/p");
  assert.equal(job.sessionId, "sess-123");
  assert.equal(job.status, "idle", "a conversation waits for the CEO after its turn");
  assert.equal(store.approvalsEver, 3, "three permission prompts, three approvals; AskUserQuestion is answered in words");
  assert.deepEqual((answers[0] as { behavior: string }).behavior, "allow");
  assert.equal((answers[1] as { behavior: string }).behavior, "deny");
  assert.match((answers[1] as { message: string }).message, /explain/i);
  assert.equal((answers[2] as { behavior: string }).behavior, "deny");
  assert.match((answers[3] as { message: string }).message, /headset/);
  const agentEvents = job.events.filter((e) => e.kind === "agent");
  assert.equal(agentEvents.length, 1, "streamed text is not repeated by the final message");
  assert.equal(agentEvents[0]?.text, "Running the tests.");
  assert.ok(job.events.some((e) => e.text === "Ran tests: 9 passed"));
});

test("alwaysAsk [] runs a job under the CEO's own rules exactly as at the desk", async () => {
  const { fn, seen } = fakeQuery(async function* () {
    yield { type: "result", subtype: "success" };
  });
  const store = new JobStore();
  const job = store.createJob({ agent: "claude", project: "p", cwd: "C:/p", title: "t" });
  await new ClaudeAdapter({ queryFn: fn, alwaysAsk: [] }).start(store.sink(job.id), { prompt: "go" });
  assert.equal((seen[0] as Record<string, unknown>).managedSettings, undefined);
});

test("a preset ends after its first turn", async () => {
  const { fn } = fakeQuery(async function* () {
    yield { type: "system", subtype: "init", session_id: "s2" };
    yield { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "All green." }] } };
    yield { type: "result", subtype: "success" };
  });
  const store = new JobStore();
  const job = store.createJob({ agent: "claude", project: "p", cwd: "C:/p", title: "t" });
  // The fake generator finishes by itself; a real session ends when its input closes.
  await new ClaudeAdapter({ queryFn: fn }).start(store.sink(job.id), { prompt: "go", oneShot: true });
  for (let k = 0; k < 100 && job.status !== "done"; k++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(job.status, "done");
  assert.equal(job.progress, 1);
});
