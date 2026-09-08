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
  assert.equal(caps.speech.available, false);
  assert.match(caps.speech.reason, /GOOGLE_TTS_API_KEY/);
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
  await assert.rejects(
    () => service.synthesize({ text: "hello" }),
    (err) => err.statusCode === 501 && err.code === "TTS_NOT_CONFIGURED"
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
