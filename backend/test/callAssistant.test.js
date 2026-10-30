const test = require("node:test");
const assert = require("node:assert/strict");

// The service reads its keys at require() time, so the unconfigured cases must
// be exercised in a process where none are set.
delete process.env.GROQ_API_KEY;
delete process.env.GOOGLE_TTS_API_KEY;

const service = require("../src/services/callAssistantService");
const guard = require("../src/services/callGuard");

test("capabilities report what is unconfigured instead of pretending", () => {
  const caps = service.capabilities();
  assert.equal(caps.transcription.available, false);
  assert.match(caps.transcription.reason, /GROQ_API_KEY/);
  // Speech needs no key: Google's free voice covers it.
  assert.equal(caps.speech.available, true);
  assert.equal(caps.speech.provider, "google-free-tts");
  // Analysis is local and must work with no provider at all.
  assert.equal(caps.analysis.available, true);
});

test("unconfigured providers fail with 501 and a code, not a crash", async () => {
  await assert.rejects(
    () => service.transcribe({ buffer: Buffer.from("x"), filename: "call.webm" }),
    (err) => err.statusCode === 501 && err.code === "ASR_NOT_CONFIGURED"
  );
  await assert.rejects(
    () => service.translate({ texts: ["hello"], targetLanguage: "ta" }),
    (err) => err.statusCode === 501 && err.code === "MT_NOT_CONFIGURED"
  );

});

test("speech synthesis refuses text that still carries a code", async () => {
  const isolated = require("node:child_process");
  // Run in a child so the key is picked up at require() time without leaking
  // into the other tests in this file.
  const script = `
    process.env.GOOGLE_TTS_API_KEY = "test-key";
    const service = require("${require.resolve("../src/services/callAssistantService")}");
    globalThis.fetch = () => { throw new Error("network must not be reached"); };
    service.synthesize({ text: "your otp is 4 5 8 2 1 9" })
      .then(() => { console.log("REACHED_NETWORK"); })
      .catch((err) => { console.log(err.code || err.message); });
  `;
  const output = isolated.execFileSync(process.execPath, ["-e", script], { encoding: "utf8" }).trim();
  assert.equal(output, "SENSITIVE_TEXT_BLOCKED");
});

test("the guard's transmit gate is what stands between a code and a provider", () => {
  // Same contract the service depends on, asserted directly: redacted text
  // passes, anything carrying a value throws before any network call is made.
  assert.throws(() => guard.assertSafeToTransmit("card 4539578763621486"), (err) => err.code === "SENSITIVE_TEXT_BLOCKED");
  assert.doesNotThrow(() => guard.assertSafeToTransmit("card [REDACTED:CARD_NUMBER]"));
});

test("language names cover the launch languages the spec names", () => {
  for (const code of ["en", "hi", "ta", "es"]) {
    assert.equal(typeof service.LANGUAGE_NAMES[code], "string");
  }
});

test("speech without a Cloud key uses Google's free voice", async () => {
  const freeTts = require("../src/services/freeTtsService");
  const original = freeTts.synthesize;
  const previousKey = process.env.GOOGLE_TTS_API_KEY;
  delete process.env.GOOGLE_TTS_API_KEY;
  freeTts.synthesize = async (text, opts) => {
    assert.equal(text, "hello there");
    assert.equal(opts.languageCode, "en-US");
    return { buffer: Buffer.from("ID3-fake-mp3"), contentType: "audio/mpeg", provider: "google-free" };
  };
  try {
    const out = await service.synthesize({ text: "hello there" });
    assert.equal(out.mimeType, "audio/mpeg");
    assert.equal(Buffer.from(out.audioBase64, "base64").toString(), "ID3-fake-mp3");
  } finally {
    freeTts.synthesize = original;
    if (previousKey !== undefined) process.env.GOOGLE_TTS_API_KEY = previousKey;
  }
});
