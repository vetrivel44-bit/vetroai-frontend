// Real photos from the server (/api/photos, backend photoSearch.js): for a
// request to make a picture of a real person (they're shown real photos of
// them instead) and for a reply's ```photos block.
import { resolveApiBase } from "./apiBase.js";

const PRODUCTION_API_BASE = "https://ai-chatbot-backend-gvvz.onrender.com/api";
const API = resolveApiBase(import.meta.env?.VITE_API_BASE_URL, import.meta.env?.PROD, PRODUCTION_API_BASE);

/**
 * { person, name, images: [{ url, caption }] }. With `person`, the server
 * first checks the subject is a real person and finds photos only if so.
 */
export async function fetchPhotos(subject, { person = false, timeoutMs = 9000, fetchImpl = globalThis.fetch } = {}) {
  const params = new URLSearchParams({ q: String(subject || "").slice(0, 120) });
  if (person) params.set("person", "1");
  const res = await fetchImpl(`${API}/photos?${params}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Photos ${res.status}`);
  const body = await res.json();
  const data = body?.data ?? body ?? {};
  return { person: Boolean(data.person), name: String(data.name || subject), images: Array.isArray(data.images) ? data.images : [] };
}

/** A reply showing real photos, with the gallery the app draws (a visual_gallery block). */
export function photosReply(name, images, { realPerson = false } = {}) {
  const note = realPerson ? " For real people, VetroAI shows real photos instead of making AI pictures of them." : "";
  if (!images?.length) return `I couldn't find photos of **${name}** right now.${note} Try again in a moment.`;
  const gallery = JSON.stringify({ type: "visual_gallery", query: name, images });
  return `Here are real photos of **${name}**.${note}\n\n\`\`\`json\n${gallery}\n\`\`\``;
}
