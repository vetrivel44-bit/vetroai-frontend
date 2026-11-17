// Camera translate: point the phone at a sign, menu, form or label, take a
// photo, and read it in your own language with what it means
// (CameraTranslate.jsx; the server's vision model reads it, POST /api/lens).

/** The languages it translates into: [code, name in that language, English name]. */
export const LENS_LANGUAGES = [
  ["en", "English", "English"],
  ["ta", "தமிழ்", "Tamil"],
  ["hi", "हिन्दी", "Hindi"],
  ["te", "తెలుగు", "Telugu"],
  ["kn", "ಕನ್ನಡ", "Kannada"],
  ["ml", "മലയാളം", "Malayalam"],
  ["bn", "বাংলা", "Bengali"],
  ["mr", "मराठी", "Marathi"],
  ["gu", "ગુજરાતી", "Gujarati"],
  ["pa", "ਪੰਜਾਬੀ", "Punjabi"],
  ["ur", "اردو", "Urdu"],
  ["or", "ଓଡ଼ିଆ", "Odia"],
  ["es", "Español", "Spanish"],
  ["fr", "Français", "French"],
  ["de", "Deutsch", "German"],
  ["it", "Italiano", "Italian"],
  ["pt", "Português", "Portuguese"],
  ["ar", "العربية", "Arabic"],
  ["ru", "Русский", "Russian"],
  ["zh", "中文", "Chinese"],
  ["ja", "日本語", "Japanese"],
  ["ko", "한국어", "Korean"],
  ["id", "Bahasa Indonesia", "Indonesian"],
  ["th", "ไทย", "Thai"],
  ["vi", "Tiếng Việt", "Vietnamese"],
  ["tr", "Türkçe", "Turkish"],
];
const CODES = new Set(LENS_LANGUAGES.map(([code]) => code));
const TARGET_KEY = "vetro_lens_target";

/**
 * The language to translate into: the one picked last time, else the first
 * of the browser's languages this supports, else English.
 */
export function defaultTarget({ saved = "", languages = [] } = {}) {
  if (CODES.has(saved)) return saved;
  for (const tag of languages || []) {
    const code = String(tag || "").toLowerCase().split(/[-_]/)[0];
    if (CODES.has(code)) return code;
  }
  return "en";
}

export function savedTarget(storage = globalThis.localStorage) {
  try { return storage?.getItem(TARGET_KEY) || ""; } catch { return ""; }
}

export function saveTarget(code, storage = globalThis.localStorage) {
  if (!CODES.has(code)) return;
  try { storage?.setItem(TARGET_KEY, code); } catch { /* private mode */ }
}

/**
 * The size to send a photo at: the long side at most `max` pixels (text
 * stays sharp; the upload stays small), never upscaled.
 */
export function fitSize(width, height, max = 1600) {
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

/** A video frame or an image as a JPEG data URL, at fitSize. */
export function snapshot(source, { max = 1600, quality = 0.85, documentImpl = globalThis.document } = {}) {
  const width = source.videoWidth || source.naturalWidth || source.width;
  const height = source.videoHeight || source.naturalHeight || source.height;
  const size = fitSize(width, height, max);
  const canvas = documentImpl.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.getContext("2d").drawImage(source, 0, 0, size.width, size.height);
  return canvas.toDataURL("image/jpeg", quality);
}

/** A picked file as a JPEG data URL, at fitSize. */
export function fileToSnapshot(file, options = {}) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      try { resolve(snapshot(image, options)); } catch (err) { reject(err); } finally { URL.revokeObjectURL(url); }
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file isn't a photo the app can read.")); };
    image.src = url;
  });
}

/**
 * Sends a photo to be read and translated. Resolves to { language, text,
 * translation, explanation, target, targetName }.
 */
export async function readPhoto(apiBase, image, target, { fetchImpl = globalThis.fetch, signal } = {}) {
  let res;
  try {
    res = await fetchImpl(`${apiBase}/lens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image, target }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new Error("Couldn't reach VetroAI. Check your connection and try again.");
  }
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw new Error(body?.message || "Couldn't read that photo. Try again.");
  return body?.data ?? body;
}

/** What "Ask VetroAI" sends to the chat about a photo it read. */
export function askAboutPhoto(result) {
  const language = String(result.language || "").trim();
  const lines = [`I took a photo of some ${language ? `${language} ` : ""}text.`];
  if (result.text) lines.push(`It says:\n${result.text}`);
  if (result.translation && result.translation !== result.text) lines.push(`Translation (${result.targetName || "English"}):\n${result.translation}`);
  if (!result.text && result.explanation) lines.push(`There was no text in it. It shows: ${result.explanation}`);
  lines.push(result.text ? "Explain what it means for me in more detail, and anything I should do." : "Tell me more about what's in it.");
  return lines.join("\n\n");
}
