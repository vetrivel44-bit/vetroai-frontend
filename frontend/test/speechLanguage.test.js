import { test } from "node:test";
import assert from "node:assert/strict";
import { detectSpeechLanguage } from "../src/lib/speechLanguage.js";

test("replies in Indian and other scripts get their language", () => {
  assert.equal(detectSpeechLanguage("வணக்கம்! நான் உங்களுக்கு எப்படி உதவ முடியும்?"), "ta");
  assert.equal(detectSpeechLanguage("नमस्ते! मैं आपकी कैसे मदद कर सकता हूँ?"), "hi");
  assert.equal(detectSpeechLanguage("मी तुम्हाला मदत करू शकतो आणि हे सोपे आहे."), "mr");
  assert.equal(detectSpeechLanguage("ನಮಸ್ಕಾರ, ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?"), "kn");
  assert.equal(detectSpeechLanguage("నమస్కారం, నేను మీకు ఎలా సహాయం చేయగలను?"), "te");
  assert.equal(detectSpeechLanguage("നമസ്കാരം, ഞാൻ നിങ്ങളെ എങ്ങനെ സഹായിക്കാം?"), "ml");
  assert.equal(detectSpeechLanguage("مرحبا، كيف يمكنني مساعدتك اليوم؟"), "ar");
  assert.equal(detectSpeechLanguage("آپ کیسے ہیں؟ میں ٹھیک ہوں۔"), "ur");
  assert.equal(detectSpeechLanguage("你好，我今天能帮你什么？"), "zh");
  assert.equal(detectSpeechLanguage("こんにちは、今日は何をお手伝いできますか？"), "ja");
  assert.equal(detectSpeechLanguage("Привет, чем я могу помочь?"), "ru");
});

test("Tamil with a few English words is still Tamil", () => {
  assert.equal(detectSpeechLanguage("React என்பது ஒரு JavaScript library. இது UI உருவாக்க பயன்படுகிறது."), "ta");
});

test("Latin-script languages by their common words", () => {
  assert.equal(detectSpeechLanguage("Hola, ¿cómo estás? Esta es una respuesta para ti y es muy buena."), "es");
  assert.equal(detectSpeechLanguage("Bonjour, je suis très content de vous aider avec ce projet."), "fr");
  assert.equal(detectSpeechLanguage("Ich bin nicht sicher, aber das ist eine gute Frage für dich."), "de");
});

test("English and unclear text keep the picked voice", () => {
  assert.equal(detectSpeechLanguage("The capital of France is Paris, and it is a lovely city."), null);
  assert.equal(detectSpeechLanguage("OK"), null);
  assert.equal(detectSpeechLanguage("```js\nconst a = 1;\n```"), null);
  assert.equal(detectSpeechLanguage(""), null);
});
