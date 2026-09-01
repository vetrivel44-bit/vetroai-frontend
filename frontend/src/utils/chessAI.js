// Chess Arena — AI move engine.
// Most models talk to the existing /api/chat endpoint the same way the rest
// of VetroAI does (FormData + SSE). Mistral, Groq, Gemini, and OpenRouter
// instead go through a dedicated /api/chess/move endpoint with its own
// CHESS_*_API_KEY credentials on the backend — completely separate from the
// main chat's provider keys, so wiring chess up never changes chat behavior.
// Either way the request/response loop is self-contained here so the Chess
// Arena screen never touches the main chat session state.

const PRODUCTION_API_BASE = "https://ai-chatbot-backend-gvvz.onrender.com/api";
let baseApi = import.meta.env.PROD ? PRODUCTION_API_BASE : "/api";
const configuredApi = import.meta.env.VITE_API_BASE_URL?.trim();
if (configuredApi) baseApi = configuredApi.replace(/\/+$/, "");
if (baseApi.startsWith("http") && !/\/api$/i.test(baseApi)) baseApi += "/api";
export const CHESS_API = baseApi;

export const CHESS_MODELS = [
  { id: "agnes", name: "Agnes 2.0", tagline: "VetroAI's flagship — balanced & sharp", color: "#3b82f6", avatar: "A" },
  { id: "chatgpt", name: "ChatGPT", tagline: "Classic positional play", color: "#10a37f", avatar: "C" },
  { id: "fable", name: "Fable", tagline: "Creative, story-driven strategist", color: "#f472b6", avatar: "F" },
  { id: "gemini", name: "Gemini", tagline: "Fast calculator, loves tactics", color: "#8b5cf6", avatar: "G" },
  { id: "groq", name: "Groq", tagline: "Lightning-fast, aggressive style", color: "#10b981", avatar: "Q" },
  { id: "mistral", name: "Mistral", tagline: "Efficient European technician", color: "#f97316", avatar: "M" },
  { id: "sambanova", name: "SambaNova", tagline: "Bold, high-throughput challenger", color: "#ec4899", avatar: "S" },
  { id: "openrouter", name: "OpenRouter", tagline: "Multi-model gateway — versatile challenger", color: "#6366f1", avatar: "O" },
];

// These four run through the dedicated /api/chess/move endpoint (their own
// backend API keys); everything else still goes through the shared /api/chat.
const DEDICATED_CHESS_PROVIDERS = new Set(["mistral", "groq", "gemini", "openrouter"]);

export function getModel(id) {
  return CHESS_MODELS.find((m) => m.id === id) || CHESS_MODELS[0];
}

function processSSELine(line, state) {
  if (!line.startsWith("data:")) return;
  const raw = line.slice(5).trim();
  if (!raw || raw === "[DONE]") return;
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return;
  }
  const type = event.type || (event.content ? "content" : null);
  const data = event.data ?? event.content;
  if (type === "content" && data) state.text += data;
  else if (type === "clear") state.text = "";
  else if (type === "error" && data) state.error = data;
}

async function fetchAIText(provider, prompt, { temperature = 0.7, maxTokens = 150, signal } = {}) {
  const fd = new FormData();
  fd.append("input", prompt);
  fd.append("provider", provider);
  fd.append("mode", "normal");
  fd.append("temperature", String(temperature));
  fd.append("maxTokens", String(maxTokens));
  fd.append("webSearch", "false");
  fd.append("safeMode", "false");

  const res = await fetch(`${CHESS_API}/chat`, { method: "POST", body: fd, signal });
  if (!res.ok) throw new Error(`Chess AI request failed (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const state = { text: "", error: null };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) processSSELine(line.replace(/\r$/, ""), state);
  }
  buffer += decoder.decode();
  if (buffer.trim()) processSSELine(buffer.replace(/\r$/, ""), state);
  if (state.error) throw new Error(state.error);
  return state.text;
}

async function fetchDedicatedChessText(provider, prompt, { temperature = 0.75, maxTokens = 160, signal } = {}) {
  const res = await fetch(`${CHESS_API}/chess/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, prompt, temperature, maxTokens }),
    signal,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) throw new Error(body?.message || `Chess AI request failed (${res.status})`);
  return body.data?.text || "";
}

function normalizeMoveToken(s) {
  return String(s || "")
    .trim()
    .replace(/[+#!?]+$/g, "")
    .replace(/^0-0-0$/i, "O-O-O")
    .replace(/^0-0$/i, "O-O")
    .toLowerCase();
}

export function parseMoveFromText(text, legalMoves) {
  if (!text || !legalMoves?.length) return null;
  const legalNorm = legalMoves.map((mv) => ({ mv, norm: normalizeMoveToken(mv) }));

  const moveLine = text.match(/MOVE:\s*([^\n\r]+)/i);
  if (moveLine) {
    const candNorm = normalizeMoveToken(moveLine[1]);
    const exact = legalNorm.find((x) => x.norm === candNorm);
    if (exact) return exact.mv;
  }

  const cleanedText = text.replace(/[+#!?]+/g, " ").toLowerCase();
  const sorted = [...legalNorm].sort((a, b) => b.mv.length - a.mv.length);
  for (const { mv, norm } of sorted) {
    const escaped = norm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i");
    if (re.test(cleanedText)) return mv;
  }
  return null;
}

export function extractCommentary(text) {
  if (!text) return "";
  const whyLine = text.match(/WHY:\s*([^\n\r]+)/i);
  if (whyLine) return whyLine[1].trim().slice(0, 220);
  const stripped = text.replace(/MOVE:\s*[^\n\r]+/i, "").trim();
  return stripped.slice(0, 220);
}

function buildPrompt({ colorName, fen, historyText, legalMoves, personaTagline }) {
  return `You are a confident, decisive chess engine playing as ${colorName} in a live game on VetroAI's Chess Arena. Your table-talk style: ${personaTagline}.

Board position (FEN): ${fen}
Moves so far: ${historyText || "None — you move first."}
Legal moves available to you (choose exactly one): ${legalMoves.join(", ")}

Reply in EXACTLY this two-line format and nothing else:
MOVE: <one move copied exactly from the legal moves list>
WHY: <one short punchy sentence about your move, max 18 words, in your own voice>`;
}

// Requests a move from an AI model for the given chess.js instance.
// Never throws for game-flow reasons — always resolves to a legal move,
// falling back to a random legal move if the model output can't be parsed.
export async function requestAIMove({ providerId, chess, color, signal }) {
  const model = getModel(providerId);
  const legalMoves = chess.moves();
  if (!legalMoves.length) return null;

  const colorName = color === "w" ? "White" : "Black";
  const historyText = chess.history().join(" ");
  const prompt = buildPrompt({
    colorName,
    fen: chess.fen(),
    historyText,
    legalMoves,
    personaTagline: model.tagline,
  });

  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), 25000);
  const onExternalAbort = () => timeoutCtrl.abort();
  signal?.addEventListener("abort", onExternalAbort);

  let text = "";
  try {
    text = DEDICATED_CHESS_PROVIDERS.has(providerId)
      ? await fetchDedicatedChessText(providerId, prompt, { temperature: 0.75, maxTokens: 160, signal: timeoutCtrl.signal })
      : await fetchAIText(providerId, prompt, { temperature: 0.75, maxTokens: 160, signal: timeoutCtrl.signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    text = "";
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
  }

  if (signal?.aborted) {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    throw abortErr;
  }

  let move = parseMoveFromText(text, legalMoves);
  let fellBack = false;
  if (!move) {
    move = legalMoves[Math.floor(Math.random() * legalMoves.length)];
    fellBack = true;
  }
  const commentary = fellBack
    ? "Played instinctively — no clear read from the model this time."
    : extractCommentary(text) || "Committed to the move.";

  return { move, commentary, providerId, raw: text };
}
