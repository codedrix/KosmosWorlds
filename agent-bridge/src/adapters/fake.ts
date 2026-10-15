/**
 * adapters/fake.ts -- a scripted agent for tests and the demo.
 *
 * @kosmos-system  Agent bridge (Mission Control, DB-043)
 * @kosmos-owner   Platform
 *
 * `npm run demo` serves the real bridge with this adapter, so the world can be
 * walked end to end (sign in, start a job, watch a reply arrive in chunks,
 * approve, finish) without spending tokens or touching a project. Each job
 * reads some files, edits one, streams a reply in chunks about a second apart,
 * asks to run the tests (an approval: the buzz), reports the counts and stops.
 */

import type { JobSink } from "../jobs.js";
import type { AgentAdapter, StartOptions } from "./types.js";

interface Live {
  sink: JobSink;
  timers: NodeJS.Timeout[];
  turn: number;
  oneShot: boolean;
}

const REPLY =
  "I read the worker and its tests. The rate limiter keys on the client address, but behind the tunnel every request comes from the same loopback address, " +
  "so one busy client throttles everyone. I changed it to key on the session instead and added a test for two sessions at once. " +
  "Next I want to run the full test suite to make sure nothing else depended on the old key.";

export class FakeAdapter implements AgentAdapter {
  readonly name = "claude";
  private live = new Map<string, Live>();

  /** `stepMs`: the gap between scripted steps (1000 in the demo, ~1 in tests). */
  constructor(private readonly stepMs = 1000) {}

  async start(sink: JobSink, o: StartOptions): Promise<void> {
    const live: Live = { sink, timers: [], turn: 0, oneShot: o.oneShot ?? false };
    this.live.set(sink.jobId, live);
    sink.setSessionId(`fake-${sink.jobId}`);
    sink.setStatus("running");
    this.runTurn(live, o.prompt);
  }

  private at(live: Live, step: number, fn: () => void): void {
    live.timers.push(setTimeout(fn, step * this.stepMs));
  }

  private runTurn(live: Live, prompt: string): void {
    const { sink } = live;
    live.turn++;
    if (live.turn > 1) {
      this.at(live, 1, () => sink.agentText(`You said "${prompt.slice(0, 60)}". Done: nothing else to change.`, { newMessage: true }));
      this.at(live, 2, () => this.endTurn(live));
      return;
    }
    const cwd = sink.cwd;
    this.at(live, 1, () => sink.toolUse("t1", "Read", { file_path: `${cwd}/worker/src/index.ts` }));
    this.at(live, 1.3, () => sink.toolUse("t2", "Read", { file_path: `${cwd}/worker/src/limits.ts` }));
    this.at(live, 1.6, () => sink.toolUse("t3", "Read", { file_path: `${cwd}/worker/test/limits.test.ts` }));
    this.at(live, 2, () => sink.toolUse("t4", "TodoWrite", { todos: [{ status: "completed" }, { status: "in_progress" }, { status: "pending" }] }));
    this.at(live, 3, () =>
      sink.toolUse("t5", "Edit", { file_path: `${cwd}/worker/src/index.ts`, old_string: "a\nb\nc", new_string: "x\n".repeat(84).trimEnd() }),
    );
    // The reply arrives in chunks, about one a second (as the wall polls).
    const chunks = REPLY.match(/.{1,70}(\s|$)/g) ?? [REPLY];
    chunks.forEach((c, i) => this.at(live, 4 + i, () => sink.agentText(c, { newMessage: i === 0 })));
    const askAt = 4 + chunks.length + 1;
    this.at(live, askAt, async () => {
      sink.toolUse("t6", "Bash", { command: "npm test", description: "Run the test suite" });
      const d = await sink.requestApproval("Bash", { command: "npm test" });
      if (!this.live.has(sink.jobId)) return;
      if (d === "approve") {
        this.at(live, 1, () => sink.toolResult("t6", "# tests 14\n# pass 14\n# fail 0\n", false));
        this.at(live, 1.2, () => sink.toolUse("t7", "TodoWrite", { todos: [{ status: "completed" }, { status: "completed" }, { status: "completed" }] }));
        this.at(live, 2, () => sink.agentText("All 14 tests pass. The change is ready for review.", { newMessage: true }));
      } else if (d === "why") {
        this.at(live, 1, () => sink.agentText("The limiter is shared by every route, so a change to its key could break any of them. The suite covers all routes in about 20 seconds.", { newMessage: true }));
      } else {
        this.at(live, 1, () => sink.agentText("Understood, I won't run them. You can run `npm test` at the desk.", { newMessage: true }));
      }
      this.at(live, 3, () => this.endTurn(live));
    });
  }

  private endTurn(live: Live): void {
    if (!this.live.has(live.sink.jobId)) return;
    if (live.oneShot) {
      this.live.delete(live.sink.jobId);
      live.sink.setStatus("done", "Done: 1 file changed, 14 tests pass");
    } else {
      live.sink.setStatus("idle");
    }
  }

  isLive(jobId: string): boolean {
    return this.live.has(jobId);
  }

  async send(jobId: string, text: string): Promise<void> {
    const live = this.live.get(jobId);
    if (!live) throw new Error("job_not_running");
    this.runTurn(live, text);
  }

  async interrupt(jobId: string): Promise<void> {
    const live = this.live.get(jobId);
    if (!live) return;
    live.timers.forEach(clearTimeout);
    live.timers = [];
    live.sink.setStatus("idle");
  }

  async stop(jobId: string): Promise<void> {
    const live = this.live.get(jobId);
    if (!live) return;
    live.timers.forEach(clearTimeout);
    this.live.delete(jobId);
    live.sink.setStatus("stopped", "Stopped from the headset");
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.live.keys()].map((id) => this.stop(id)));
  }
}
