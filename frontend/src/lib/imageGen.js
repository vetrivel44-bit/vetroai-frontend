// VetroAI's only image generator: Gemini 3.1 Flash Lite Image on AI Router,
// called through the backend (/api/image). Used for generated images in the
// chat, the detailed version of a drawing (SketchBlock) and photo edits.
import { resolveApiBase } from "./apiBase";
import { authHeaders } from "./usageClient";

const PRODUCTION_API_BASE = "https://ai-chatbot-backend-gvvz.onrender.com/api";
const API = resolveApiBase(import.meta.env.VITE_API_BASE_URL, import.meta.env.PROD, PRODUCTION_API_BASE);

export const IMAGE_MODEL_NAME = "Gemini 3.1 Flash Lite Image";

async function callImageApi(path, body, signal) {
  let res;
  try {
    res = await fetch(`${API}/image/${path}`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    throw new Error(`${IMAGE_MODEL_NAME} could not be reached. Check your connection and try again.`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.error || `${IMAGE_MODEL_NAME} failed (${res.status}).`);
  if (!data?.image) throw new Error(`${IMAGE_MODEL_NAME} returned an empty image.`);
  return data.image; // a data URL, so it survives reloads and ReactMarkdown's sanitizer
}

export const generateImage = (prompt, { signal } = {}) => callImageApi("generate", { prompt }, signal);

/** images: data URLs of the pictures to edit. */
export const editImage = (prompt, images, { signal } = {}) => callImageApi("edit", { prompt, images }, signal);

// Drawings and diagrams are drawn in the chat, not made by the image model
// (lib/imageRequest.js, where the rest of image-request detection lives).
export { wantsDrawing } from "./imageRequest.js";
