/**
 * sample-day.ts -- the sample day More Room shows until the real one is connected.
 *
 * @kosmos-system  Content (KosmosWorlds) -- More Room
 * @kosmos-owner   More Room v1 (design session 2026-10-14; CEO: "show sample for
 *                 now and make it a very elaborate setup and info")
 *
 * One founder's Wednesday while building a browser for 3D worlds. Every
 * person, company, message and task here is INVENTED. No real account is read,
 * no real person is named, and no message imitates a real company's mail:
 * senders are made-up people, team channels, or generic bots marked "(sample)".
 *
 * This file is the single source of the sample. The bridge face serves it, and
 * more-room/tools/gen_sample.mjs bakes the same day into the world itself
 * (script/src/sample_day.txt), so the published room opens full without a PC.
 *
 * Times are minutes after local midnight; the sample's clock starts at 10:05.
 */

import type { DayData } from "./day-core.js";

const h = (hh: number, mm = 0) => hh * 60 + mm;

export const SAMPLE_DAY: DayData = {
  date: "Wed 14 Oct",
  note: "SAMPLE DAY: nothing here is real yet",
  weather: "68F clear",
  sunsetMin: h(18, 58),
  headline: "Sample news: city opens a new riverside trail",

  brief: [
    "3 things need you today:",
    "1 Answer counsel on terms",
    "2 Menu review at 2:00",
    "3 Pick the first 10 testers",
  ],

  events: [
    { id: "ev-a", start: h(8, 30), end: h(9), title: "Gym", prep: ["Gym 8:30-9:00", "Nothing to prepare"] },
    { id: "ev-b", start: h(9), end: h(9, 30), title: "Standup", prep: ["Standup 9:00-9:30", "With: Priya, Tomas, Lena", "Agenda: release 4.2, design lane", "Related: SAMPLE-12, SAMPLE-14"] },
    { id: "ev-c", start: h(10, 30), end: h(11, 30), title: "Counsel call", prep: ["Counsel call 10:30-11:30", "With: Dana Whitfield (counsel)", "Agenda: terms v2, section 4", "Related: 2 threads, 1 draft"] },
    { id: "ev-d", start: h(11, 45), end: h(12, 15), title: "Investor call", prep: ["Investor update 11:45", "With: Sam Okoro", "Agenda: alpha numbers, hiring", "Related: deck v4, 1 mail"] },
    { id: "ev-e", start: h(12, 30), end: h(13, 15), title: "Lunch", prep: ["Lunch with Marisol", "At the taco place on 6th", "Nothing to prepare"] },
    { id: "ev-f", start: h(14), end: h(15), title: "Menu review", prep: ["Menu review 2:00-3:00", "With: Lena (design)", "Agenda: the onboarding flow", "Related: SAMPLE-31, 2 mails"] },
    { id: "ev-g", start: h(15, 15), end: h(15, 45), title: "World jam", prep: ["Creator world jam", "With: 6 sample creators", "Agenda: what blocks publish", "Related: #creators thread"] },
    { id: "ev-h", start: h(16, 30), end: h(17), title: "Tester list", prep: ["Tester list 4:30-5:00", "Agenda: pick the first 10", "Related: the waitlist export", "Decide: headset mix"] },
    { id: "ev-i", start: h(17, 15), end: h(17, 45), title: "1:1 Tomas", prep: ["1:1 with Tomas", "Agenda: cook pipeline, load", "Related: SAMPLE-20"] },
    { id: "ev-j", start: h(18, 30), end: h(19), title: "Walk", prep: ["Walk before sunset", "Sunset 6:58", "Nothing to prepare"] },
  ],

  tasks: [
    { id: "t-a", pin: true, state: "doing", title: "Answer counsel on terms" },
    { id: "t-b", pin: true, state: "open", title: "Menu review notes" },
    { id: "t-c", pin: true, state: "open", title: "Pick first 10 testers" },
    { id: "t-d", pin: false, state: "doing", title: "Investor update deck v4" },
    { id: "t-e", pin: false, state: "doing", title: "Release 4.2 smoke test" },
    { id: "t-f", pin: false, state: "open", title: "Reply to creator jam" },
    { id: "t-g", pin: false, state: "open", title: "Privacy page wording" },
    { id: "t-h", pin: false, state: "open", title: "Book flight to the meetup" },
    { id: "t-i", pin: false, state: "open", title: "Review PR 214" },
    { id: "t-j", pin: false, state: "open", title: "Thumbnail for the garden page" },
    { id: "t-k", pin: false, state: "done", title: "Cook ledger row" },
    { id: "t-l", pin: false, state: "done", title: "Sign the office lease" },
    { id: "t-m", pin: false, state: "done", title: "Waitlist export" },
    { id: "t-n", pin: false, state: "done", title: "Fix the login flicker" },
    { id: "t-o", pin: false, state: "done", title: "Order a spare test laptop" },
    { id: "t-p", pin: false, state: "open", title: "Plan Friday demo" },
  ],

  // src: gmail | slack | github | linear. Every sender is invented.
  messages: [
    { id: "m-a", src: "gmail", vip: true, from: "Dana Whitfield", subject: "Terms: one question", preview: "Can we keep section 4 as drafted, or do you want the shorter version?" },
    { id: "m-b", src: "gmail", vip: true, from: "Sam Okoro", subject: "Before our call", preview: "Could you send the alpha numbers ahead of 11:45? Just the three we discussed." },
    { id: "m-c", src: "gmail", vip: false, from: "Marisol Vega", subject: "Lunch still on?", preview: "Taco place on 6th at 12:30? I'll grab a table outside." },
    { id: "m-d", src: "slack", vip: false, from: "#builds (sample)", subject: "Release 4.2 is green", preview: "Release 4.2 passed its smoke test on both test laptops." },
    { id: "m-e", src: "github", vip: false, from: "Repo bot (sample)", subject: "PR 214 checks passed", preview: "All checks passed on the registry PR 214. Ready for review." },
    { id: "m-f", src: "linear", vip: false, from: "Tracker (sample)", subject: "SAMPLE-31 moved", preview: "SAMPLE-31 Onboarding flow moved to In Review by Lena." },
    { id: "m-g", src: "gmail", vip: false, from: "Theo Lindqvist", subject: "Creator jam follow-up", preview: "Three creators asked how to add sound. Is there a doc yet?" },
    { id: "m-h", src: "slack", vip: false, from: "Lena (design)", subject: "Mockup v3 is up", preview: "The onboarding mockup v3 is in the review folder." },
    { id: "m-i", src: "gmail", vip: false, from: "Office Hub (sample)", subject: "Your desk is booked", preview: "Desk 4 is yours for Thursday and Friday this week." },
    { id: "m-j", src: "github", vip: false, from: "Repo bot (sample)", subject: "Issue 88 commented", preview: "Priya commented: the cache cap needs a device check." },
    { id: "m-k", src: "gmail", vip: false, from: "Newsletter (sample)", subject: "This week in headsets", preview: "Ten stories about headsets you might have missed." },
    { id: "m-l", src: "slack", vip: false, from: "Tomas", subject: "Load test numbers", preview: "Load times look good on the big test world." },
    { id: "m-m", src: "gmail", vip: false, from: "Avery Chen", subject: "Podcast invite", preview: "Would you join our show next month to talk about 3D worlds?" },
    { id: "m-n", src: "linear", vip: false, from: "Tracker (sample)", subject: "SAMPLE-20 assigned", preview: "SAMPLE-20 Cook pipeline timing was assigned to you." },
    { id: "m-o", src: "gmail", vip: false, from: "Jordan Pike", subject: "Invoice 1043", preview: "The invoice for September is attached (attachments are not shown here)." },
    { id: "m-p", src: "slack", vip: false, from: "#creators (sample)", subject: "Sound question", preview: "How do I add a looping sound to my world?" },
    { id: "m-q", src: "github", vip: false, from: "Repo bot (sample)", subject: "Release 0.9.2 tagged", preview: "The publisher release 0.9.2 was tagged." },
    { id: "m-r", src: "gmail", vip: false, from: "Rina Osei", subject: "Tester signup", preview: "I have two headsets and would love to test. Here is my handle." },
    { id: "m-s", src: "gmail", vip: false, from: "Kai Mercer", subject: "Tester signup", preview: "Teacher here; my class builds worlds. Can we join the alpha?" },
    { id: "m-t", src: "slack", vip: false, from: "Priya", subject: "Image sizes", preview: "I think 1200 px is right for the gallery. Want a check on a phone first?" },
    { id: "m-u", src: "linear", vip: false, from: "Tracker (sample)", subject: "SAMPLE-14 done", preview: "SAMPLE-14 Travel flash fix moved to Done." },
    { id: "m-v", src: "gmail", vip: false, from: "Building Mgmt (sample)", subject: "Fire drill Friday", preview: "A short fire drill on Friday at 10:00." },
    { id: "m-w", src: "gmail", vip: false, from: "Noor Haddad", subject: "Meetup venue", preview: "The meetup venue holds 80 people. Should I confirm?" },
    { id: "m-x", src: "github", vip: false, from: "Repo bot (sample)", subject: "Dependabot PR 219", preview: "A dependency update PR was opened on the portal." },
    { id: "m-y", src: "slack", vip: false, from: "#random (sample)", subject: "Lunch poll", preview: "Tacos or noodles on Friday? Vote in the thread." },
    { id: "m-z", src: "gmail", vip: false, from: "Travel desk (sample)", subject: "Flight options", preview: "Three flight options for the meetup are ready to pick." },
    { id: "m-aa", src: "gmail", vip: false, from: "Hana Brooks", subject: "Coffee next week?", preview: "Back in town on the 21st, free Tuesday or Wednesday morning." },
    { id: "m-ab", src: "linear", vip: false, from: "Tracker (sample)", subject: "SAMPLE-12 comment", preview: "Lena: the menu lane needs one more icon pass." },
    { id: "m-ac", src: "slack", vip: false, from: "Tomas", subject: "Release 4.3 queued", preview: "Release 4.3 is queued for tonight with the design changes." },
    { id: "m-ad", src: "gmail", vip: false, from: "Newsletter (sample)", subject: "Indie dev digest", preview: "Five tools for small teams this week." },
  ],

  arrivals: [
    { id: "m-ae", src: "slack", vip: false, from: "Lena (design)", subject: "Icons pass done", preview: "The icon pass for the menu is done. One question on the bell." },
    { id: "m-af", src: "gmail", vip: true, from: "Dana Whitfield", subject: "Re: Terms", preview: "Following up: we need your answer before the 10:30 call." },
  ],

  wrapFirstTomorrow: "Send the tester invites at 9",

  // Drafts the sample's "Claude" writes. The real bridge asks Claude.
  drafts: {
    "m-a": "Let's keep section 4 as drafted. The shorter version drops a sentence we want. Thanks!",
    "m-b": "Sure, I will send the three numbers before 11:45. Talk then.",
    "m-c": "Yes, 12:30 at the taco place on 6th. See you there!",
    "m-g": "Not yet. I will write a short sound doc this week and share it in the creators channel.",
    "m-m": "Thanks Avery, I would like that. Next month works; send me two dates?",
    "m-r": "Thanks Rina! You are on the list for the first wave. Invites go out tomorrow at 9.",
    "m-s": "Love this, Kai. A class is a great first group. I will add you to the second wave.",
    "m-w": "Yes, please confirm the venue for 80. Thank you, Noor!",
    "m-aa": "Wednesday morning works. 9:30 at the usual place?",
  },
  defaultDraft: "Thanks, got it. I will get back to you today.",
};
