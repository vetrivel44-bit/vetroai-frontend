import test from "node:test";
import assert from "node:assert/strict";

import {
  appendDictated, browserRecognition, canRecord, DictationError, dictationHints, formatElapsed, micErrorMessage,
  pickRecordingType, recordingFileName, rememberLanguage, rememberedLanguages, serverDictationAvailable, transcribeRecording,
} from "../src/lib/dictation.js";

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("the recording format is one Whisper reads, best first", () => {
  const chrome = { isTypeSupported: (t) => t.startsWith("audio/webm") };
  const safari = { isTypeSupported: (t) => t === "audio/mp4" };
  const neither = { isTypeSupported: () => false };
  assert.equal(pickRecordingType(chrome), "audio/webm;codecs=opus");
  assert.equal(pickRecordingType(safari), "audio/mp4");
  assert.equal(pickRecordingType(neither), "");
  assert.equal(pickRecordingType(undefined), "");
});

test("the file name carries the format", () => {
  assert.equal(recordingFileName("audio/webm;codecs=opus"), "voice.webm");
  assert.equal(recordingFileName("audio/mp4"), "voice.mp4");
  assert.equal(recordingFileName("audio/ogg;codecs=opus"), "voice.ogg");
  assert.equal(recordingFileName(""), "voice.webm");
});

test("recording needs both getUserMedia and MediaRecorder", () => {
  const nav = { mediaDevices: { getUserMedia: () => {} } };
  assert.equal(canRecord(nav, function MediaRecorder() {}), true);
  assert.equal(canRecord(nav, undefined), false);
  assert.equal(canRecord({}, function MediaRecorder() {}), false);
  assert.equal(browserRecognition({ webkitSpeechRecognition: 1 }), 1);
  assert.equal(browserRecognition({}), null);
});

test("dictated words go after what was typed, with one space", () => {
  assert.equal(appendDictated("", "hello there"), "hello there");
  assert.equal(appendDictated("   ", "hello"), "hello");
  assert.equal(appendDictated("Hey,", " what's up "), "Hey, what's up");
  assert.equal(appendDictated("Hey,  ", "what's up"), "Hey, what's up");
  assert.equal(appendDictated("line one\n", "line two"), "line one\nline two");
  assert.equal(appendDictated("unchanged", "  "), "unchanged");
  // Chinese and Japanese run on without spaces; Tamil after English gets one.
  assert.equal(appendDictated("东京", "天气怎么样"), "东京天气怎么样");
  assert.equal(appendDictated("今日は", "いい天気"), "今日はいい天気");
  assert.equal(appendDictated("Hi", "வணக்கம்"), "Hi வணக்கம்");
});

test("every way the microphone fails gets a message that says what to do", () => {
  const blocked = micErrorMessage({ name: "NotAllowedError" });
  assert.match(blocked, /blocked/i);
  assert.match(blocked, /address bar/);
  assert.match(micErrorMessage({ name: "NotAllowedError" }, { desktop: true }), /privacy settings/);
  assert.match(micErrorMessage({ name: "NotFoundError" }), /No microphone/);
  assert.match(micErrorMessage({ name: "NotReadableError" }), /another app/);
  assert.match(micErrorMessage({ name: "not-allowed" }), /blocked/);
  assert.match(micErrorMessage({ name: "network" }), /internet/);
  assert.match(micErrorMessage(new Error("??")), /Try again/);
});

test("the timer reads m:ss", () => {
  assert.equal(formatElapsed(0), "0:00");
  assert.equal(formatElapsed(7400), "0:07");
  assert.equal(formatElapsed(92000), "1:32");
  assert.equal(formatElapsed(-5), "0:00");
});

test("a recording is uploaded as 'audio' and its words and language come back", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return reply(200, { success: true, data: { text: "  open my notes  ", language: "en" } }); };
  const result = await transcribeRecording("https://api.test/api", new Blob(["x"], { type: "audio/webm;codecs=opus" }), { fetchImpl });
  assert.deepEqual(result, { text: "open my notes", language: "en" });
  assert.equal(calls[0].url, "https://api.test/api/transcribe");
  assert.equal(calls[0].init.method, "POST");
  const file = calls[0].init.body.get("audio");
  assert.equal(file.name, "voice.webm");
  assert.equal(calls[0].init.body.get("language"), null, "the language is left to the server unless chosen");
  assert.equal(calls[0].init.body.get("hints"), null);

  await transcribeRecording("/api", new Blob(["x"]), { fetchImpl, hints: ["ta", "en"] });
  assert.equal(calls[1].init.body.get("hints"), "ta,en");
});

test("the languages this person uses go to the server, most likely first", () => {
  // The language they type in comes first: it's how they want words written.
  assert.deepEqual(dictationHints({ remembered: ["ta"], written: "hi", browser: ["en-IN", "en-US", "ta-IN"] }), ["hi", "ta", "en"]);
  assert.deepEqual(dictationHints({ remembered: ["ta"], written: "en", browser: ["en-US"] }), ["en", "ta"]);
  assert.deepEqual(dictationHints({ remembered: [], written: null, browser: ["en-US"] }), ["en"]);
  assert.deepEqual(dictationHints({ browser: ["*", "", "zh-Hant-TW", "yue-HK", "fil-PH", "pt-BR", "es"] }), ["zh", "yue", "fil", "pt"]);
  assert.deepEqual(dictationHints(), []);
});

test("the language each dictation came back in is remembered, newest first", () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.deepEqual(rememberedLanguages(storage), []);
  rememberLanguage("ta", storage);
  rememberLanguage("en", storage);
  rememberLanguage("ta", storage);
  rememberLanguage("hi-IN", storage);
  rememberLanguage("tamil??", storage);
  assert.deepEqual(rememberedLanguages(storage), ["hi", "ta", "en"]);
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.deepEqual(rememberedLanguages(broken), []);
  rememberLanguage("ta", broken);
});

test("silence comes back as empty text", async () => {
  const fetchImpl = async () => reply(200, { success: true, data: { text: "" } });
  assert.deepEqual(await transcribeRecording("/api", new Blob(["x"]), { fetchImpl }), { text: "", language: null });
});

test("server and network failures become messages, with codes the app can act on", async () => {
  const notSetUp = async () => reply(501, { success: false, message: "Voice typing isn't set up on this server yet.", data: { code: "ASR_NOT_CONFIGURED" } });
  await assert.rejects(transcribeRecording("/api", new Blob(["x"]), { fetchImpl: notSetUp }), (err) => err instanceof DictationError && err.code === "ASR_NOT_CONFIGURED" && err.status === 501);

  const missing = async () => reply(404, { success: false, message: "Route not found" });
  await assert.rejects(transcribeRecording("/api", new Blob(["x"]), { fetchImpl: missing }), (err) => err.code === "ASR_NOT_CONFIGURED", "an older backend: use the browser's recognition");

  const busy = async () => reply(429, null);
  await assert.rejects(transcribeRecording("/api", new Blob(["x"]), { fetchImpl: busy }), (err) => err.code === "ASR_BUSY" && /busy/.test(err.message));

  const offline = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(transcribeRecording("/api", new Blob(["x"]), { fetchImpl: offline }), (err) => err.code === "network" && /connection/.test(err.message));

  const controller = new AbortController();
  const hang = (_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  const pending = transcribeRecording("/api", new Blob(["x"]), { fetchImpl: hang, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (err) => err.code === "cancelled");
});

test("the app asks once whether the server can type out recordings", async () => {
  assert.equal(await serverDictationAvailable("/api", { fetchImpl: async () => reply(200, { data: { available: true } }) }), true);
  assert.equal(await serverDictationAvailable("/api", { fetchImpl: async () => reply(200, { data: { available: false } }) }), false);
  // A backend that hasn't been updated yet has no /api/transcribe at all.
  assert.equal(await serverDictationAvailable("/api", { fetchImpl: async () => reply(404, { message: "Route not found" }) }), false);
  assert.equal(await serverDictationAvailable("/api", { fetchImpl: async () => reply(502, {}) }), null);
  assert.equal(await serverDictationAvailable("/api", { fetchImpl: async () => { throw new Error("offline"); } }), null);
});

test("Android's repeated recognition results are typed once", async () => {
  const { joinRecognitionResults } = await import("../src/lib/dictation.js");
  const result = (transcript, isFinal) => Object.assign([{ transcript }], { isFinal });
  // Android: each final repeats everything before it.
  assert.deepEqual(joinRecognitionResults([result("hello", true), result("hello how are you", true), result("hello how are you doing", false)]), { final: "hello how are you", interim: "doing" });
  assert.deepEqual(joinRecognitionResults([result("book a table", true), result("book a table", true)]), { final: "book a table", interim: "" });
  // Desktop Chrome: each final is new words.
  assert.deepEqual(joinRecognitionResults([result("hello", true), result(" how are you", true), result("fine", false)]), { final: "hello how are you", interim: "fine" });
  assert.deepEqual(joinRecognitionResults([]), { final: "", interim: "" });
});

test("the browser's recognizer gets a full locale, Indian English in India", async () => {
  const { recognitionLocale } = await import("../src/lib/dictation.js");
  assert.equal(recognitionLocale("en", { languages: ["en-US"], timeZone: "Asia/Kolkata" }), "en-IN");
  assert.equal(recognitionLocale("en", { languages: ["en-US"], timeZone: "Asia/Calcutta" }), "en-IN");
  assert.equal(recognitionLocale("en", { languages: ["en-GB", "en"], timeZone: "Europe/London" }), "en-GB");
  assert.equal(recognitionLocale("ta", { languages: ["en-US"], timeZone: "" }), "ta-IN");
  assert.equal(recognitionLocale("en-US", { languages: [], timeZone: "" }), "en-US");
  assert.equal(recognitionLocale("", { languages: [], timeZone: "" }), "en-US");
});

test("the language picked for the microphone is kept, and Auto clears it", async () => {
  const { savedSpeechLanguage, saveSpeechLanguage, SPEECH_LANGUAGES } = await import("../src/lib/dictation.js");
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  assert.equal(savedSpeechLanguage(storage), "");
  assert.equal(saveSpeechLanguage("ta", storage), "ta");
  assert.equal(savedSpeechLanguage(storage), "ta");
  assert.equal(saveSpeechLanguage("klingon", storage), "");
  assert.equal(savedSpeechLanguage(storage), "");
  assert.equal(SPEECH_LANGUAGES[0].code, "", "Auto first");
  assert.ok(SPEECH_LANGUAGES.some((l) => l.code === "en") && SPEECH_LANGUAGES.some((l) => l.code === "ta"));
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
  assert.equal(savedSpeechLanguage(broken), "");
  assert.equal(saveSpeechLanguage("hi", broken), "hi");
});

test("typing in the Latin alphabet counts as English for the microphone", async () => {
  const { typedLanguage } = await import("../src/lib/speechLanguage.js");
  assert.equal(typedLanguage("what's the weather in chennai today"), "en");
  assert.equal(typedLanguage("enna panra da machan"), "en", "romanised Tamil is written in English letters");
  assert.equal(typedLanguage("இன்னைக்கு வானிலை எப்படி இருக்கு"), "ta");
  assert.equal(typedLanguage("ok"), null);
  assert.equal(typedLanguage(""), null);
});
