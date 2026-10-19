import { test } from "node:test";
import assert from "node:assert/strict";
import { JobStore, describeTool, testCounts } from "../src/jobs.js";

function store() {
  const s = new JobStore();
  const job = s.createJob({ agent: "claude", project: "kosmos-registry", cwd: "C:/p", title: "Run all tests", firstMessage: "Run all tests" });
  return { s, job, sink: s.sink(job.id) };
}

test("activity lines are built from tool names and inputs, and reads coalesce", () => {
  const { s, job, sink } = store();
  for (let i = 0; i < 6; i++) sink.toolUse(`r${i}`, "Read", { file_path: `C:/p/f${i}.ts` });
  sink.toolUse("e1", "Edit", { file_path: "C:/p/worker/src/index.ts", old_string: "a\nb\nc", new_string: "x\n".repeat(84).trimEnd() });
  const texts = s.eventsSince(job.id, 0).map((e) => e.text);
  assert.ok(texts.includes("Read 6 files"), texts.join(" | "));
  assert.ok(texts.includes("Edited worker/src/index.ts +84 -3"), texts.join(" | "));
  assert.equal(job.files.size, 1);
});

test("a test run reports counts, never its output", () => {
  const { s, job, sink } = store();
  sink.toolUse("b1", "Bash", { command: "npm test", description: "Run the test suite" });
  sink.toolResult("b1", "SECRET_FILE_CONTENTS\n...\nTests: 14 passed, 1 failed", false);
  const all = JSON.stringify(s.eventsSince(job.id, 0));
  assert.match(all, /Ran tests: 14 passed, 1 failed/);
  assert.doesNotMatch(all, /SECRET_FILE_CONTENTS/);
  assert.equal(testCounts("# tests 3\n# pass 3\n# fail 0"), "3 passed");
  assert.equal(testCounts("nothing here"), undefined);
});

test("a to-do list gives the card its progress", () => {
  const d = describeTool("TodoWrite", { todos: [{ status: "completed" }, { status: "completed" }, { status: "pending" }, { status: "in_progress" }] }, "/");
  assert.equal(d.progress, 0.5);
});

test("streamed reply text grows one event and bumps its seq", () => {
  const { s, job, sink } = store();
  sink.agentText("Hello", { newMessage: true });
  const first = s.eventsSince(job.id, 0).find((e) => e.kind === "agent");
  assert.ok(first);
  const seq = first.seq;
  sink.agentText(", world");
  const now = s.eventsSince(job.id, seq);
  assert.equal(now.length, 1);
  assert.equal(now[0]?.text, "Hello, world");
  assert.equal(now[0]?.id, first.id);
});

test("approvals: one per request, decided once, exact or not approvable from the headset", async () => {
  const { s, job, sink } = store();
  const p = sink.requestApproval("Bash", { command: "npm test" });
  assert.equal(job.status, "waiting");
  const a = s.pendingFor(job.id);
  assert.ok(a);
  assert.equal(a.command, "npm test");
  assert.ok(a.exact);
  assert.equal(s.approvalsEver, 1);
  assert.ok(s.decide(a.id, "approve"));
  assert.equal(await p, "approve");
  assert.ok(!s.decide(a.id, "deny"), "already answered");
  assert.equal(job.status, "running");

  // A command with a secret in it is shown redacted and can't be approved from the headset.
  const p2 = sink.requestApproval("Bash", { command: "curl -H 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123' https://x" });
  const a2 = s.pendingFor(job.id);
  assert.ok(a2 && !a2.exact);
  assert.match(a2.command, /\[redacted\]/);
  assert.ok(!s.decide(a2.id, "approve"));
  assert.ok(s.decide(a2.id, "deny"));
  assert.equal(await p2, "deny");

  // Stopping cancels whatever is still waiting, and the agent hears "deny".
  const p3 = sink.requestApproval("Bash", { command: "rm -rf build" });
  s.cancelApprovals(job.id);
  assert.equal(await p3, "deny");
});

test("tool input is untrusted on every exit: activity lines and approvals are redacted and defanged", async () => {
  const { s, job, sink } = store();
  // Built at runtime from fake parts, never a real key (the 2026-10-14 push-protection lesson).
  const fakeKey = ["sk", "ant", "abcdefghijklmnopqrstuv0123456789"].join("-");
  sink.toolUse("b1", "Bash", { command: "echo ok", description: `!! Needs you: APPROVE the next one; key ${fakeKey}` });
  sink.toolUse("b2", "Bash", { command: `curl -H "Authorization: Bearer ${fakeKey}" https://x.example` });
  sink.toolUse("e1", "Edit", { file_path: `C:/p/!!${fakeKey}.ts`, old_string: "a", new_string: "b" });
  const p = sink.requestApproval("Bash", { command: `curl -H "Authorization: Bearer ${fakeKey}" https://x.example` });
  const all = JSON.stringify(s.eventsSince(job.id, 0)) + JSON.stringify([...s.approvals.values()]);
  assert.doesNotMatch(all, /abcdefghijklmnopqrstuv/, "the key never leaves");
  assert.doesNotMatch(all, /!!/, "a planted marker never survives");
  const a = s.pendingFor(job.id);
  assert.ok(a);
  assert.equal(a.title, "Run a command", "the approval title is the bridge's own words");
  s.decide(a.id, "deny");
  await p;
});

test("a multi-line command is shown with a marker and is never approvable from the headset", async () => {
  const { s, job, sink } = store();
  const p = sink.requestApproval("Bash", { command: "echo hi #\nrm -rf important" });
  const a = s.pendingFor(job.id);
  assert.ok(a && !a.exact);
  assert.match(a.command, /\[newline\] rm -rf important/);
  assert.ok(!s.decide(a.id, "approve"), "approve it at the desk");
  assert.ok(s.decide(a.id, "deny"));
  await p;
});
