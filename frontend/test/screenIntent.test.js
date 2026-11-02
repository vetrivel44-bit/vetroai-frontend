import test from "node:test";
import assert from "node:assert/strict";

import { wantsScreenControl } from "../src/lib/screenIntent.js";

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
