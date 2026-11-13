import test from "node:test";
import assert from "node:assert/strict";

import { askScreenIntent, decideScreenTask, wantsScreenControl } from "../src/lib/screenIntent.js";

// Sent from the phone through Dispatch, these ran as chat answers that only
// described opening the app or the site.
test("asks to work the computer go to the screen agent", () => {
  for (const q of [
    "open chrome and search for weather in chennai", "open youtube", "open telegram", "launch vlc", "go to amazon.in and find earbuds under 2000",
    "open wikipedia.org", "open a new tab", "open new tab and search cricket score", "open my downloads folder", "play arijit singh songs on spotify",
    "type hello world in notepad", "search for cats in chrome", "close all chrome tabs", "turn up the volume", "mute the sound",
    "check my gmail on this laptop", "open calculator", "switch to excel", "book a bus ticket from chennai to bangalore tomorrow on redbus",
    "open whatsapp and send hi to mom",
  ]) assert.equal(wantsScreenControl(q), true, q);
});

test("questions, writing and file work stay in the chat", () => {
  for (const q of [
    "what is the capital of france", "summarize the news today", "write a poem about rain", "who founded telegram", "explain how chrome works",
    "best phones under 30000", "make a slide deck about AI", "research electric scooters and make a spreadsheet", "translate this to tamil",
    "what is excel used for", "how do i open a bank account", "open the excel file I attached and summarize it",
  ]) assert.equal(wantsScreenControl(q), false, q);
});

// Unusual phrasing ("pull up spotify and put on some lofi", "chrome la
// weather paaru") used to get a chat answer that only described doing it.
function fakeJudge(answer, { ok = true } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (answer instanceof Error) throw answer;
    return { ok, json: async () => ({ success: true, data: { screen: answer, by: "model" } }) };
  };
  return { calls, fetchImpl };
}

test("the patterns answer at once; the server's judge reads everything else", async () => {
  const judge = fakeJudge(true);
  assert.deepEqual(await decideScreenTask("/api", "open telegram", judge), { screen: true, by: "rules" });
  assert.equal(judge.calls.length, 0, "no round trip for a task the patterns know");
  for (const task of ["chrome la weather paaru", "youtube kholo aur arijit ke gaane chalao", "put on some lofi music for me", "turn on dark mode"]) {
    assert.equal(wantsScreenControl(task), false, `the patterns miss "${task}"`);
    assert.deepEqual(await decideScreenTask("/api", task, judge), { screen: true, by: "model" }, task);
  }
  assert.deepEqual(judge.calls[0], { url: "/api/screen-intent", body: { text: "chrome la weather paaru" } });
  const no = fakeJudge(false);
  assert.deepEqual(await decideScreenTask("/api", "write an email to my boss asking for leave", no), { screen: false, by: "model" });
});

test("when the judge can't answer, the patterns' answer stands", async () => {
  assert.deepEqual(await decideScreenTask("/api", "chrome la weather paaru", fakeJudge(new TypeError("offline"))), { screen: false, by: "rules" });
  assert.deepEqual(await decideScreenTask("/api", "chrome la weather paaru", fakeJudge(null)), { screen: false, by: "rules" });
  assert.equal(await askScreenIntent("/api", "chrome la weather paaru", fakeJudge(true, { ok: false })), null);
  const attached = fakeJudge(true);
  assert.deepEqual(await decideScreenTask("/api", "summarise the pdf I attached", attached), { screen: false, by: "rules" });
  assert.equal(attached.calls.length, 0, "a file the user gave is read, never opened on the screen");
});
