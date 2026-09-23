// "Local (Ollama)" model: the browser talks straight to Ollama running on the
// visitor's own computer, so chats and images never leave that machine and
// cost nothing. Uses Ollama's OpenAI-compatible streaming endpoint.

export const LOCAL_OLLAMA_PROVIDER = "Local (Ollama)";
const DEFAULT_URL = "http://localhost:11434";
const URL_KEY = "vetroai_ollama_url";
const MODEL_KEY = "vetroai_ollama_model";
const PREFERRED_MODELS = ["llama3.2-vision", "moondream"];
const VISION_HINTS = ["vision", "llava", "bakllava", "moondream", "mllama", "minicpm-v", "qwen2.5vl", "qwen2-vl",
  "qwen2.5-vl", "qwen3-vl", "gemma3", "llama4", "granite3.2-vision", "mistral-small3.1", "clip"];
// Vision models work at about this size; smaller uploads answer much faster.
const MODEL_IMAGE_SIDE = 1120;

const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } },
};

export function ollamaUrl() {
  return (storage.get(URL_KEY) || DEFAULT_URL).replace(/\/+$/, "");
}

export function isVisionModel(model) {
  const details = model?.details || {};
  const text = [model?.name, details.family, ...(details.families || [])].join(" ").toLowerCase();
  return VISION_HINTS.some((hint) => text.includes(hint));
}

const baseName = (name) => String(name || "").split(":")[0];

// Which installed model to use: the visitor's last choice if still installed,
// then llama3.2-vision, then moondream, then any vision model, then anything.
export function pickModel(models, { needsVision = false, exclude = [] } = {}) {
  if (!models.length) return null;
  const saved = storage.get(MODEL_KEY);
  const usable = (needsVision ? models.filter((m) => m.vision) : models).filter((m) => !exclude.includes(m.name));
  if (!usable.length) return null;
  const savedMatch = usable.find((m) => m.name === saved);
  if (savedMatch) return savedMatch.name;
  for (const wanted of PREFERRED_MODELS) {
    const match = usable.find((m) => baseName(m.name) === wanted);
    if (match) return match.name;
  }
  return (usable.find((m) => m.vision) || usable[0]).name;
}

export function rememberModel(name) {
  storage.set(MODEL_KEY, name);
}

// { online: true, models: [{ name, vision }] } or { online: false }.
// A browser can't tell "not running" from "running but refusing this site"
// (both are network errors), so the setup help covers both.
export async function ollamaStatus({ timeoutMs = 2500 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${ollamaUrl()}/api/tags`, { signal: controller.signal });
    if (!response.ok) return { online: false };
    const data = await response.json();
    const seen = new Set();
    const models = [];
    // One entry per model even when it has several tags (x and x:latest).
    for (const m of (data.models || []).slice().sort((a, b) => a.name.length - b.name.length)) {
      const key = m.digest || m.name;
      if (seen.has(key)) continue;
      seen.add(key);
      models.push({ name: m.name, vision: isVisionModel(m) });
    }
    return { online: true, models };
  } catch {
    return { online: false };
  } finally {
    clearTimeout(timer);
  }
}

// Scales an image (a File, or a saved data: URL preview) down and re-encodes
// it as JPEG for the model.
export async function imageForModel(source) {
  const isFile = typeof source !== "string";
  const bitmapUrl = isFile ? URL.createObjectURL(source) : source;
  const file = isFile ? source : {};
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`Could not read ${file.name || "the image"}.`));
      el.src = bitmapUrl;
    });
    const scale = Math.min(1, MODEL_IMAGE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; // transparent areas → white, as a person would see them
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.9);
  } finally {
    if (isFile) URL.revokeObjectURL(bitmapUrl);
  }
}

// The newest image the user shared in this chat, and how many of their turns
// ago (0 = this turn). Saved messages keep image previews as data: URLs, so
// follow-up questions (even after a reload) still see the picture.
export function latestSharedImage(history) {
  let turnsAgo = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    if (message?.role !== "user") continue;
    const image = (message.files || []).find((f) => typeof f?.preview === "string" && f.preview.startsWith("data:image/"));
    if (image) return { preview: image.preview, turnsAgo };
    turnsAgo++;
  }
  return null;
}

// Chat history → OpenAI-style messages. Only one image is sent (Llama 3.2
// Vision accepts one per request), attached to the user turn it was shared
// with: `imageTurnsAgo` counts user turns back from this one (0 = shared now).
// If that turn has scrolled out of the context window, the image rides on the
// oldest user turn still in it. The system prompt is left out whenever an
// image is included, as Meta recommends.
export function buildMessages({ history, question, imageDataUrl, imageTurnsAgo = 0, systemPrompt }) {
  const turns = history
    .filter((m) => m?.content && (m.role === "user" || m.role === "assistant"))
    .slice(-20)
    .map(({ role, content }) => ({ role, content: String(content) }));
  turns.push({ role: "user", content: question || "Describe this image in detail." });
  if (imageDataUrl) {
    const userTurns = turns.map((m, i) => (m.role === "user" ? i : -1)).filter((i) => i >= 0);
    const target = userTurns[Math.max(0, userTurns.length - 1 - imageTurnsAgo)];
    turns[target] = {
      role: "user",
      content: [
        { type: "text", text: turns[target].content },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ],
    };
  } else if (systemPrompt?.trim()) {
    turns.unshift({ role: "system", content: systemPrompt.trim() });
  }
  return turns;
}

function errorFromResponse(model, status, text) {
  let message = text;
  try {
    const body = JSON.parse(text);
    message = body?.error?.message || body?.error || text;
  } catch { /* plain text */ }
  message = String(message || `HTTP ${status}`).trim();
  if (/unknown model architecture|does not support|not supported/i.test(message)) {
    const unsupported = new Error(`Your version of Ollama can't run "${model}". Install another vision model, for example: ollama pull moondream`);
    unsupported.code = "MODEL_UNSUPPORTED";
    return unsupported;
  }
  if (status === 404 || /not found/i.test(message)) {
    return new Error(`The model "${model}" isn't installed. Install it with: ollama pull ${baseName(model)}`);
  }
  return new Error(`Ollama error (${status}): ${message.split("\n")[0]}`);
}

// Streams the answer; calls onText(fullTextSoFar) as pieces arrive.
export async function streamChat({ model, messages, signal, onText, maxTokens }) {
  let response;
  try {
    response = await fetch(`${ollamaUrl()}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: true, ...(maxTokens ? { max_tokens: maxTokens } : {}) }),
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    const offline = new Error("Can't reach Ollama on this computer.");
    offline.code = "OLLAMA_UNREACHABLE";
    throw offline;
  }
  if (!response.ok) throw errorFromResponse(model, response.status, await response.text().catch(() => ""));

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return text;
      let chunk;
      try { chunk = JSON.parse(data); } catch { continue; }
      if (chunk.error) throw new Error(`Ollama error: ${chunk.error.message || chunk.error}`);
      const piece = chunk.choices?.[0]?.delta?.content;
      if (!piece) continue;
      text = text ? text + piece : piece.replace(/^\s+/, ""); // models often open with a blank line
      if (text) onText(text);
    }
  }
  return text;
}

// Setup steps shown in the chat when Ollama can't be reached. `origin` is this
// site's address, which Ollama must be told to accept.
export function setupHelp(origin) {
  return [
    "### Connect VetroAI to Ollama on this computer",
    "",
    `**Local (Ollama)** runs the AI on your own computer: it's free, private, and your images never leave your device. It couldn't reach Ollama at \`${ollamaUrl()}\`.`,
    "",
    "**1. Install Ollama** from [ollama.com/download](https://ollama.com/download) (Windows, macOS or Linux).",
    "",
    "**2. Download a vision model** in a terminal:",
    "```bash",
    "ollama pull llama3.2-vision      # about 8 GB, best quality",
    "ollama pull moondream            # about 1.7 GB, for smaller computers",
    "```",
    "",
    `**3. Allow this site to use it.** Ollama only accepts requests from websites you allow. Set \`OLLAMA_ORIGINS\` to \`${origin}\`, then quit and reopen Ollama:`,
    "",
    "- **Windows** (Command Prompt), then quit Ollama from the tray and start it again:",
    "```bat",
    `setx OLLAMA_ORIGINS "${origin}"`,
    "```",
    "- **macOS**, then quit Ollama from the menu bar and open it again:",
    "```bash",
    `launchctl setenv OLLAMA_ORIGINS "${origin}"`,
    "```",
    "- **Linux** (systemd): run `sudo systemctl edit ollama`, add the lines below, then `sudo systemctl restart ollama`:",
    "```ini",
    "[Service]",
    `Environment="OLLAMA_ORIGINS=${origin}"`,
    "```",
    "",
    "**4. Send your message again.** If your browser asks to let this site access devices on your local network, choose **Allow**. Chrome, Edge and Firefox work; Safari blocks websites from reaching Ollama.",
    "",
    "Without Ollama, pick any other model from the menu. They run on VetroAI's servers.",
  ].join("\n");
}
