const test = require("node:test");
const assert = require("node:assert/strict");
const { nativeVoiceFor } = require("../src/services/ttsLanguage");

test("a reply in another language gets a native voice of the same gender", () => {
  assert.deepEqual(nativeVoiceFor("ta", "en-US-JennyNeural"), { edgeVoice: "ta-IN-PallaviNeural", languageCode: "ta-IN" });
  assert.deepEqual(nativeVoiceFor("ta", "en-US-GuyNeural"), { edgeVoice: "ta-IN-ValluvarNeural", languageCode: "ta-IN" });
  assert.equal(nativeVoiceFor("hi", "en-IN-PrabhatNeural").edgeVoice, "hi-IN-MadhurNeural");
  assert.equal(nativeVoiceFor("hi", "google-en-IN").edgeVoice, "hi-IN-SwaraNeural");
});

test("English, no language, or junk keeps the picked voice", () => {
  assert.equal(nativeVoiceFor("en", "en-US-JennyNeural"), null);
  assert.equal(nativeVoiceFor("", "en-US-JennyNeural"), null);
  assert.equal(nativeVoiceFor("<script>", "en-US-JennyNeural"), null);
});

test("a language with no neural voice uses Google's free voice for it", () => {
  assert.deepEqual(nativeVoiceFor("pa", "en-US-JennyNeural"), { edgeVoice: null, languageCode: "pa-IN" });
});
