import test from "node:test";
import assert from "node:assert/strict";

import {
  appendDictated, browserRecognition, canRecord, DictationError, formatElapsed, micErrorMessage,
  pickRecordingType, recordingFileName, serverDictationAvailable, transcribeRecording,
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

test("a recording is uploaded as 'audio' and its words come back", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return reply(200, { success: true, data: { text: "  open my notes  " } }); };
  const text = await transcribeRecording("https://api.test/api", new Blob(["x"], { type: "audio/webm;codecs=opus" }), { fetchImpl });
  assert.equal(text, "open my notes");
  assert.equal(calls[0].url, "https://api.test/api/transcribe");
  assert.equal(calls[0].init.method, "POST");
  const file = calls[0].init.body.get("audio");
  assert.equal(file.name, "voice.webm");
  assert.equal(calls[0].init.body.get("language"), null, "the language is left to the server unless chosen");
});

test("silence comes back as empty text", async () => {
  const fetchImpl = async () => reply(200, { success: true, data: { text: "" } });
  assert.equal(await transcribeRecording("/api", new Blob(["x"]), { fetchImpl }), "");
});

test("server and network failures become messages, with codes the app can act on", async () => {
  const notSetUp = async () => reply(501, { success: false, message: "Voice typing isn't set up on this server yet.", data: { code: "ASR_NOT_CONFIGURED" } });
  await assert.rejects(transcribeRecording("/api", new Blob(["x"]), { fetchImpl: notSetUp }), (err) => err instanceof DictationError && err.code === "ASR_NOT_CONFIGURED" && err.status === 501);

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
  assert.equal(await serverDictationAvailable("/api", { fetchImpl: async () => reply(404, {}) }), null);
  assert.equal(await serverDictationAvailable("/api", { fetchImpl: async () => { throw new Error("offline"); } }), null);
});
