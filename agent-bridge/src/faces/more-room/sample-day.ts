/**
 * sample-day.ts -- the mock "sample day" More Room is built against.
 *
 * @kosmos-system  Content (KosmosWorlds) -- More Room
 * @kosmos-owner   More Room v1 (design session 2026-10-14)
 *
 * Every person, company and message here is invented. No real account is read.
 * The real day comes from the Mission Control bridge, where Claude reads the
 * CEO's mail, calendar and Linear through connectors he configures himself
 * (Class C). Until then this file is the whole day.
 *
 * Times are minutes after local midnight. `arrivals` are messages the mock
 * delivers later (day-core.ts, the dev-only op `arrive`), so the harness can watch a card
 * land face-down in focus mode, and a VIP one tick.
 */

import type { DayData } from "./day-core.js";

/** The day More Room shows until the bridge reads the real one (typed loosely on purpose: it is data). */
export const SAMPLE_DAY: DayData = {
  date: "Wed 14 Oct",
  // The window.
  weather: "68F clear",
  sunsetMin: 18 * 60 + 58,
  headline: "Sample headline: city council passes transit plan",

  brief: [
    "3 things need you today:",
    "1 Approve the counsel reply",
    "2 Review the menu build at 2",
    "3 Pick the first tester list",
  ],

  events: [
    { id: "ev-a", start: 9 * 60, end: 9 * 60 + 30, title: "Standup", prep: [
      "Standup 9:00-9:30",
      "With: build lead, design lead",
      "Agenda: cook status, menu lane",
      "Related: KOS-SAMPLE-12 (In Review)",
    ] },
    { id: "ev-b", start: 10 * 60 + 30, end: 11 * 60 + 30, title: "Counsel call", prep: [
      "Counsel call 10:30-11:30",
      "With: outside counsel (sample)",
      "Agenda: PCI scope, terms update",
      "Related mail: 2 threads, 1 draft",
    ] },
    { id: "ev-c", start: 12 * 60 + 30, end: 13 * 60 + 15, title: "Lunch", prep: [
      "Lunch 12:30-1:15",
      "Nothing to prepare",
    ] },
    { id: "ev-d", start: 14 * 60, end: 15 * 60, title: "Menu review", prep: [
      "Menu review 2:00-3:00",
      "With: design lead",
      "Agenda: Settings groups, History",
      "Related: KOS-SAMPLE-31, 2 mails",
    ] },
    { id: "ev-e", start: 16 * 60 + 30, end: 17 * 60, title: "Tester list", prep: [
      "Tester list 4:30-5:00",
      "Agenda: pick 10 first testers",
      "Related: waitlist export (sample)",
    ] },
  ],

  tasks: [
    { id: "t-a", pin: true, state: "open", title: "Approve counsel reply" },
    { id: "t-b", pin: true, state: "open", title: "Menu build review notes" },
    { id: "t-c", pin: true, state: "open", title: "First tester list" },
    { id: "t-d", pin: false, state: "done", title: "Cook ledger row" },
  ],

  // src: gmail | slack | github | linear
  messages: [
    { id: "m-a", src: "gmail", vip: true, from: "Counsel (sample)", subject: "Terms: one question", preview: "Can we keep the conduit wording as drafted, or do you want the shorter version?" },
    { id: "m-b", src: "github", vip: false, from: "GitHub", subject: "PR #212 checks passed", preview: "All checks have passed on kosmos-registry #212 (sample)." },
    { id: "m-c", src: "gmail", vip: false, from: "Alex Rivera (sample)", subject: "Coffee next week?", preview: "Back in Austin on the 21st, free Tuesday or Wednesday morning." },
    { id: "m-d", src: "slack", vip: false, from: "#builds (sample)", subject: "Cook 1010 is green", preview: "Build 1010 passed its smoke test on both headsets." },
    { id: "m-e", src: "linear", vip: false, from: "Linear", subject: "KOS-SAMPLE-31 moved", preview: "KOS-SAMPLE-31 moved to In Review by the design lane." },
    { id: "m-f", src: "gmail", vip: false, from: "Newsletter (sample)", subject: "This week in XR", preview: "Ten headset stories you might have missed." },
    { id: "m-g", src: "gmail", vip: false, from: "Sam Okafor (sample)", subject: "Invoice 1043", preview: "Attached is the invoice for September (attachments are not shown in More Room)." },
  ],

  arrivals: [
    { id: "m-h", src: "slack", vip: false, from: "#design (sample)", subject: "New mockup posted", preview: "Settings > History mockup v3 is up for review." },
    { id: "m-i", src: "gmail", vip: true, from: "Counsel (sample)", subject: "Re: Terms: one question", preview: "Following up: we need your answer before the 10:30 call." },
  ],

  wrapFirstTomorrow: "Send the tester invites at 9",

  // Canned drafts the mock "Claude" writes. The real bridge asks Claude.
  drafts: {
    "m-a": "Keep the conduit wording as drafted. The shorter version drops the card-data sentence we need. Thanks!",
    "m-c": "Wednesday morning works. 9:30 at the usual place?",
  },
  defaultDraft: "Thanks, got it. I will get back to you today.",
};
