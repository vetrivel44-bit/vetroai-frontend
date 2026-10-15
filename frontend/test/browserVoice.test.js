import test from "node:test";
import assert from "node:assert/strict";

import { pickBrowserVoice, describeTtsVoice } from "../src/utils/browserVoice.js";

const CHROME = [
  { name: "Google US English", lang: "en-US" },
  { name: "Google UK English Female", lang: "en-GB" },
  { name: "Google UK English Male", lang: "en-GB" },
  { name: "Microsoft David - English (United States)", lang: "en-US" },
  { name: "Microsoft Zira - English (United States)", lang: "en-US" },
  { name: "Google Deutsch", lang: "de-DE" },
];

test("reads accent and gender from the TTS voice id", () => {
  assert.deepEqual(describeTtsVoice("en-GB-SoniaNeural"), { lang: "en-GB", name: "Sonia", gender: "female" });
  assert.deepEqual(describeTtsVoice("en-US-GuyNeural"), { lang: "en-US", name: "Guy", gender: "male" });
});

test("matches accent and gender among Chrome's voices", () => {
  assert.equal(pickBrowserVoice(CHROME, "en-GB-SoniaNeural").name, "Google UK English Female");
  assert.equal(pickBrowserVoice(CHROME, "en-GB-RyanNeural").name, "Google UK English Male");
  assert.equal(pickBrowserVoice(CHROME, "en-US-GuyNeural").name, "Microsoft David - English (United States)");
  assert.equal(pickBrowserVoice(CHROME, "en-US-JennyNeural").name, "Microsoft Zira - English (United States)");
});

test("prefers the very same voice when the browser has it (Edge)", () => {
  const edge = [
    ...CHROME,
    { name: "Microsoft Sonia Online (Natural) - English (United Kingdom)", lang: "en-GB" },
    { name: "Microsoft Libby Online (Natural) - English (United Kingdom)", lang: "en-GB" },
  ];
  assert.equal(pickBrowserVoice(edge, "en-GB-SoniaNeural").name, "Microsoft Sonia Online (Natural) - English (United Kingdom)");
});

test("no usable voice: leaves the browser default", () => {
  assert.equal(pickBrowserVoice([], "en-US-JennyNeural"), null);
  assert.equal(pickBrowserVoice([{ name: "Google Deutsch", lang: "de-DE" }], "en-US-JennyNeural"), null);
});
