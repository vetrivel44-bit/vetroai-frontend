const { config } = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");

// Sarvam AI (sarvam.ai): Indian models, strong in Hindi, Tamil and the other
// Indian languages as well as English. OpenAI-compatible chat completions.
const ENDPOINT = "https://api.sarvam.ai/v1/chat/completions";
const DEFAULT_MODEL = "sarvam-105b";
const MAX_TOKENS_CAP = 16384;

/**
 * "Sarvam 105B Chat" → sarvam-105b-conversations (105B tuned for quick
 * back-and-forth, 32K context), "Sarvam 105B" → sarvam-105b, else the
 * configured default. Sarvam retired sarvam-30b, so a "Sarvam 30B" still
 * selected in an open tab gets 105B too.
 */
function modelFor(label) {
  const text = String(label || "");
  if (!/sarvam/i.test(text)) return null;
  if (/\b105\s*b\b.*\b(chat|conversations?)\b/i.test(text)) return "sarvam-105b-conversations";
  if (/\b105\s*b\b/i.test(text)) return "sarvam-105b";
  return config.sarvamModel || DEFAULT_MODEL;
}

// Sarvam retires models and names the ones to use instead in the error:
// "Model 'sarvam-30b' has been deprecated. Please use one of the available
// models instead: sarvam-105b, sarvam-105b-conversations." Taken from there,
// a retirement costs one extra request instead of failing every chat — and
// of the orchestrator suspending Sarvam altogether as misconfigured.
const RETIRED = /deprecated|no longer (?:available|supported)|model[^.]*(?:not found|does not exist)|invalid model|unknown model/i;
function replacementFor(detail) {
  if (!RETIRED.test(detail)) return null;
  const list = /(?:instead|available models?)[^:]*:\s*([a-z0-9.,\s_-]+)/i.exec(detail)?.[1] || "";
  const names = list.split(/[,\s]+/).map((n) => n.replace(/\.+$/, "")).filter((n) => /^sarvam-[a-z0-9.-]+$/i.test(n));
  return names.find((n) => n === DEFAULT_MODEL) || names[0] || DEFAULT_MODEL;
}
// model → its replacement, once Sarvam has said it is retired.
const replaced = new Map();

// Chat models of this kind reject a conversation that has two turns of the
// same role in a row, or a system message anywhere but first. The history can
// carry both (a retried turn, a system note added mid-chat), so fold it into
// the shape the API accepts instead of failing the request.
function shapeMessages(messages) {
  const system = [];
  const turns = [];
  for (const m of messages || []) {
    const content = typeof m?.content === "string" ? m.content : "";
    if (!content.trim()) continue;
    if (m.role === "system") { system.push(content); continue; }
    const role = m.role === "assistant" ? "assistant" : "user";
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content += `\n\n${content}`;
    else turns.push({ role, content });
  }
  // The first non-system turn has to be the user's.
  if (turns[0]?.role === "assistant") turns.unshift({ role: "user", content: "(continuing our conversation)" });
  return [...(system.length ? [{ role: "system", content: system.join("\n\n") }] : []), ...turns];
}

async function request(body, { timeoutMs }) {
  if (!config.sarvamApiKey) {
    throw new ApiError(500, "Sarvam API key not configured on the backend.");
  }
  const init = (model, signal) => ({
    method: "POST",
    headers: {
      // Sarvam's own header; Bearer is accepted too, for OpenAI-style clients.
      "api-subscription-key": config.sarvamApiKey,
      Authorization: `Bearer ${config.sarvamApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...body, model }),
    signal,
  });
  const send = async (model) => {
    if (!body.stream) return fetch(ENDPOINT, init(model, AbortSignal.timeout(timeoutMs)));
    // A streamed reply is only timed until Sarvam starts answering. Timing the
    // whole stream cut long answers (a detailed sketch) off mid-way; a stream
    // that goes quiet is caught by the orchestrator's idle watchdog instead.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error(`Sarvam connect timeout after ${timeoutMs}ms`)), timeoutMs);
    try {
      return await fetch(ENDPOINT, init(model, ctrl.signal));
    } finally {
      clearTimeout(timer);
    }
  };

  let model = replaced.get(body.model) || body.model;
  let res = await send(model);
  let detail = res.ok ? "" : await res.text();
  const replacement = !res.ok && [400, 404].includes(res.status) ? replacementFor(detail) : null;
  if (replacement && replacement !== model) {
    logger.warn("sarvamAdapter.modelRetired", { model, replacement });
    replaced.set(body.model, replacement);
    model = replacement;
    res = await send(model);
    detail = res.ok ? "" : await res.text();
  }
  if (!res.ok) {
    throw new ApiError(res.status, `Sarvam service error: ${res.status} ${detail.slice(0, 300)}`);
  }
  return res;
}

// sarvam-105b reasons before every answer, at "medium" when nothing is said —
// so a plain "hi" sat behind seconds of silent reasoning. The user's effort
// setting picks the depth (as airouterAdapter does for gpt-oss), the default
// ("balanced") kept light, and null switches reasoning off.
const REASONING_EFFORT = { quick: null, balanced: "low", deep: "medium", max: "high" };

/**
 * The reasoning_effort to send. Off for a drawing (it reasoned for minutes and
 * could spend max_tokens before drawing at all, even at "low") and for a light
 * turn — a greeting or a few words — which has nothing to reason about.
 */
function reasoningEffortFor({ drawing, light, effort } = {}) {
  if (drawing || light) return null;
  return Object.prototype.hasOwnProperty.call(REASONING_EFFORT, effort) ? REASONING_EFFORT[effort] : REASONING_EFFORT.balanced;
}

// sarvam-105b can think for well over 30s before its first byte, longer as
// the system prompt grows: the general 30s start budget timed out the first
// tries ("Trying Sarvam 105B again…") before it answered on a later one. Once
// it starts, the orchestrator's idle watchdog guards the rest of the stream.
const START_TIMEOUT_MS = 75000;

async function generateStream(messages, options = {}) {
  const { temperature, maxTokens, sarvamModel } = options;
  try {
    const res = await request({
      model: sarvamModel || config.sarvamModel || DEFAULT_MODEL,
      messages: shapeMessages(messages),
      temperature: temperature ?? 0.7,
      max_tokens: Math.min(maxTokens ?? 4096, MAX_TOKENS_CAP),
      stream: true,
      reasoning_effort: reasoningEffortFor(options),
    }, { timeoutMs: START_TIMEOUT_MS });
    return res.body;
  } catch (err) {
    logger.error("sarvamAdapter.generateStream", { error: err.message });
    throw err;
  }
}

// Non-streaming completion for short side tasks (chat titles, follow-ups).
async function complete(messages, { temperature = 0.4, maxTokens = 120 } = {}) {
  const res = await request({
    model: config.sarvamModel || DEFAULT_MODEL,
    messages: shapeMessages(messages),
    temperature,
    max_tokens: maxTokens,
    stream: false,
  }, { timeoutMs: 15000 });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

module.exports = {
  generateStream,
  // sarvam-105b reasons in its own channel (reasoning_content, shown in the
  // thinking panel). Also asking it for a <think> block in the answer made it
  // write its thinking out a second time, and when it did so without both
  // tags the thinking showed up as part of the reply.
  reasonsNatively: () => true,
  // Live search results go with the question, not deep in the system prompt:
  // there Sarvam answered from its own out-of-date training (AIOrchestrator).
  searchResultsWithQuestion: () => true,
  // How long the orchestrator waits for the stream to start (see above).
  startTimeoutMs: () => START_TIMEOUT_MS,
  complete,
  modelFor,
  shapeMessages,
  reasoningEffortFor,
  DEFAULT_MODEL,
  // Tests start from a clean slate.
  resetReplacements: () => replaced.clear(),
};
