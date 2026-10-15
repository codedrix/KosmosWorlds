/**
 * presets.ts -- the verbs the headset may use, and nothing else.
 *
 * @kosmos-system  Agent bridge (Mission Control, DB-043)
 * @kosmos-owner   Platform
 *
 * The headset never sends a command to run. It sends a VERB from this file (or a
 * free-text message, which goes to the agent as a prompt). Every preset is
 * read-only by instruction; whatever the agent then wants to run still goes
 * through Claude Code's own permission rules and, where those would ask, an
 * approval on the wall.
 */

export interface Preset {
  id: string;
  /** The button's words (also mesh text in the world; keep them in step). */
  label: string;
  /** Short title for the job card. */
  title: string;
  prompt: string;
}

const HEADSET_NOTE =
  "The user is watching from a VR headset, where your reply is read on a wall: keep it short, plain sentences, no tables, no code blocks over three lines.";

export const PRESETS: readonly Preset[] = [
  {
    id: "tests",
    label: "Run all tests",
    title: "Run all tests",
    prompt: `Run this project's full test suite. Then reply in under 120 words: how many passed and failed, and for each failure, the test name and the likely cause in one line. Do not change any files. ${HEADSET_NOTE}`,
  },
  {
    id: "prs",
    label: "Review open PRs",
    title: "Review open PRs",
    prompt: `List this repository's open pull requests with the GitHub CLI and review each one briefly. Reply in under 150 words: one or two lines per PR on what it does and anything that looks wrong. Do not merge, approve, comment on, push to or close anything. ${HEADSET_NOTE}`,
  },
  {
    id: "today",
    label: "Summarize today",
    title: "Summarize today",
    prompt: `Summarize what happened in this project today: commits since midnight, branches touched, open work and anything uncommitted. Reply in under 120 words. Change nothing. ${HEADSET_NOTE}`,
  },
  {
    id: "notes",
    label: "Draft release notes",
    title: "Draft release notes",
    prompt: `Draft release notes for the changes since the last tag (or the last 20 commits if there is no tag). Put them in your reply only: do not create files, tags or releases. Under 150 words, grouped as New, Fixed and Changed. ${HEADSET_NOTE}`,
  },
];

export interface QuickReply {
  id: string;
  label: string;
  text: string;
  /** Interrupt the current turn before sending (for "Stop and summarize"). */
  interruptFirst: boolean;
}

export const QUICK_REPLIES: readonly QuickReply[] = [
  { id: "keep", label: "Keep going", text: "Keep going.", interruptFirst: false },
  { id: "simple", label: "Explain that simply", text: "Explain that simply, in under 80 words, for someone reading it on a wall.", interruptFirst: false },
  {
    id: "summary",
    label: "Stop and summarize",
    text: "Stop what you are doing. Summarize where things stand in under 100 words: what is done, what is not, and what you would do next.",
    interruptFirst: true,
  },
];

/** A typed task gets the same headset note as the presets. */
export function newTaskPrompt(text: string): string {
  return `${text}\n\n(${HEADSET_NOTE})`;
}

/** The longest text the headset may send in one message (the prompt sheet holds 256 bytes). */
export const MAX_TYPED_CHARS = 1000;
