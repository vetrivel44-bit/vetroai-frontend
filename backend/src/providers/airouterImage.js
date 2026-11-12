const { config } = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");

// VetroAI's only image generator: Gemini 3.1 Flash Lite Image (Nano Banana 2
// Lite) on AI Router. AIROUTER_IMAGE_MODEL overrides the id.
const IMAGE_MODEL = "google/gemini-3.1-flash-lite-image";
const TIMEOUT_MS = 120000;

const imageModel = () => config.airouterImageModel || IMAGE_MODEL;
const baseUrl = () => (config.airouterBaseUrl || "https://api.airouter.in/v1").replace(/\/+$/, "");

function apiKey() {
  const key = String(config.airouterApiKey || "").trim().replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "").trim();
  if (!key) throw new ApiError(500, "AI Router API key not configured.");
  return key;
}

async function post(path, body) {
  const key = apiKey();
  const res = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "x-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ApiError(res.status, `AI Router image error: ${res.status} ${detail.slice(0, 300)}`);
  }
  return res.json();
}

const asDataUrl = (b64, mime = "image/png") => (String(b64).startsWith("data:") ? b64 : `data:${mime};base64,${b64}`);

/** The first image in an /images/generations or /chat/completions reply, as a data URL. */
function extractImage(data) {
  const fromData = data?.data?.find?.((d) => d?.b64_json || d?.url);
  if (fromData) return fromData.b64_json ? asDataUrl(fromData.b64_json) : fromData.url;
  const message = data?.choices?.[0]?.message || {};
  const fromImages = message.images?.find?.((i) => i?.image_url?.url || i?.url || i?.b64_json);
  if (fromImages) return fromImages.image_url?.url || fromImages.url || asDataUrl(fromImages.b64_json);
  if (Array.isArray(message.content)) {
    const part = message.content.find((p) => p?.image_url?.url || p?.inline_data?.data);
    if (part) return part.image_url?.url || asDataUrl(part.inline_data.data, part.inline_data.mime_type);
  }
  return null;
}

// Gemini image models also answer on /chat/completions with images in
// message.images[]; that path is the only one that takes input images (edits).
async function viaChat(prompt, inputImages = []) {
  const content = inputImages.length
    ? [{ type: "text", text: prompt }, ...inputImages.map((url) => ({ type: "image_url", image_url: { url } }))]
    : prompt;
  return post("/chat/completions", {
    model: imageModel(),
    messages: [{ role: "user", content }],
    modalities: ["image", "text"],
    stream: false,
  });
}

/** Generates an image from a prompt. Returns a data URL. */
async function generateImage(prompt) {
  const text = String(prompt || "").trim();
  if (!text) throw new ApiError(400, "Describe the image to generate.");
  let image = null;
  try {
    image = extractImage(await post("/images/generations", { model: imageModel(), prompt: text, n: 1 }));
  } catch (err) {
    logger.warn("airouterImage.generationsFailed", { model: imageModel(), error: err.message });
  }
  if (!image) image = extractImage(await viaChat(text));
  if (!image) throw new ApiError(502, "Gemini 3.1 Flash Lite Image returned no image.");
  return image;
}

/** Edits the given images (data URLs) as the prompt asks. Returns a data URL. */
async function editImage(prompt, inputImages) {
  const images = (inputImages || []).filter((u) => typeof u === "string" && u.startsWith("data:image/"));
  if (!images.length) throw new ApiError(400, "Attach an image to edit.");
  const image = extractImage(await viaChat(String(prompt || "Edit this image"), images));
  if (!image) throw new ApiError(502, "Gemini 3.1 Flash Lite Image returned no image.");
  return image;
}

module.exports = { generateImage, editImage, extractImage, IMAGE_MODEL, imageModel };
