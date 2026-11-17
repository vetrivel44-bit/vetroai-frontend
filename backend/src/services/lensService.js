"use strict";

// Camera translate: a photo of a sign, menu, form, label, board or page →
// the text in it, translated into the person's language, and what it means
// for them (prices, warnings, what to fill in).
//
// Read by the models that can see images (Gemini, then Cohere's and Groq's
// vision models, whichever are configured), asked for plain JSON and checked
// here. A photo with no readable text is described instead.

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const LANGUAGES = {
  en: "English", ta: "Tamil", hi: "Hindi", te: "Telugu", kn: "Kannada", ml: "Malayalam", bn: "Bengali", mr: "Marathi",
  gu: "Gujarati", pa: "Punjabi", ur: "Urdu", or: "Odia", es: "Spanish", fr: "French", de: "German", it: "Italian",
  pt: "Portuguese", ar: "Arabic", ru: "Russian", zh: "Chinese (Simplified)", ja: "Japanese", ko: "Korean", id: "Indonesian",
  th: "Thai", vi: "Vietnamese", tr: "Turkish",
};

class LensError extends Error {
  constructor(statusCode, message, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

const languageName = (code) => LANGUAGES[String(code || "").toLowerCase()] || "English";

/** "data:image/jpeg;base64,…" → { mimeType, data }, checked. */
function imageFromDataUrl(dataUrl) {
  const match = /^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUrl || "").trim());
  if (!match) throw new LensError(400, "Send the photo as a JPEG, PNG or WebP image.", "IMAGE_REQUIRED");
  const mimeType = match[1].toLowerCase().replace("image/jpg", "image/jpeg");
  if (!IMAGE_TYPES.has(mimeType)) throw new LensError(415, "Send the photo as a JPEG, PNG or WebP image.", "IMAGE_FORMAT");
  const data = match[2].replace(/\s+/g, "");
  if (Math.floor(data.length * 0.75) > MAX_IMAGE_BYTES) throw new LensError(413, "That photo is too large. Try again a little further away.", "IMAGE_TOO_LARGE");
  return { mimeType, data };
}

/** What the vision model is sent. */
function lensMessages({ image, target }) {
  const into = languageName(target);
  const system = "You read the text in photos for VetroAI's camera translate. People point their phone at signs, menus, forms, labels, notices, boards, prescriptions and pages, often in a language they don't read.";
  const instruction = [
    `Read all the text in this photo, then translate it into ${into}.`,
    "Reply with only JSON, no markdown:",
    `{"language":"the language the text is written in (in English, e.g. Tamil)","text":"the text exactly as written, line by line, in reading order","translation":"the same lines translated into ${into}, line by line","explanation":"1-3 short sentences in ${into}: what this is, and anything the person should know or do (prices, dates, warnings, which form fields to fill in)"}`,
    `If the text is already in ${into}, keep it in "translation" and explain it. If there is no readable text, set "text" and "translation" to "" and describe what is in the photo in "explanation". Never invent text that isn't visible; mark unreadable parts with "…".`,
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: instruction, images: [image] },
  ];
}

const clean = (value, max) => String(value ?? "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);

/** { language, text, translation, explanation } from the model's reply, or null. */
function parseLens(raw) {
  const body = String(raw || "").replace(/```(?:json)?/gi, "");
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let data;
  try { data = JSON.parse(body.slice(start, end + 1)); } catch { return null; }
  const result = {
    language: clean(data.language, 60),
    text: clean(data.text, 6000),
    translation: clean(data.translation, 6000),
    explanation: clean(data.explanation, 1200),
  };
  return result.text || result.translation || result.explanation ? result : null;
}

/**
 * Read and translate a photo. `ask(providerName, messages)` resolves to that
 * vision model's reply; `providers` are the vision models to try, in order.
 */
async function readAndTranslate({ image: dataUrl, target = "en", providers = [], ask }) {
  const image = imageFromDataUrl(dataUrl);
  if (!providers.length) throw new LensError(503, "Camera translate isn't available right now.", "NO_VISION");
  const messages = lensMessages({ image, target });
  let lastError = null;
  for (const provider of providers) {
    try {
      const result = parseLens(await ask(provider, messages));
      if (result) return { ...result, target: String(target || "en").toLowerCase(), targetName: languageName(target) };
      lastError = new Error("unreadable reply");
    } catch (err) {
      lastError = err;
    }
  }
  throw new LensError(502, "Couldn't read that photo right now. Try again, a little closer and steadier.", "LENS_FAILED", lastError);
}

module.exports = { readAndTranslate, parseLens, lensMessages, imageFromDataUrl, languageName, LensError, LANGUAGES };
