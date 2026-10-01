const { config } = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");

const ENDPOINT = "https://api.sambanova.ai/v1/chat/completions";
const DEFAULT_MODEL = "Meta-Llama-3.3-70B-Instruct";
const DEFAULT_BACKUP_MODEL = "gpt-oss-120b";

// SambaNova's free tier sometimes queues a busy model for longer than the
// orchestrator's 30s attempt budget, so a "hi" never got an answer. The first
// model gets a short window to start streaming; if it stalls, is busy, or is
// rejected, the backup model gets the rest of the budget.
let firstModelTimeoutMs = 12000;
let backupModelTimeoutMs = 15000;

function isRetryableWithBackup(status, detail) {
  if (status === 429 || status === 503 || status === 504) return true;
  return [400, 404].includes(status) && /model/i.test(detail);
}

async function generateStream(messages, options = {}) {
  // Tolerates the usual paste mistakes in the env var: whitespace, quotes, "Bearer ".
  const apiKey = String(config.sambanovaApiKey || "").trim().replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "").trim();
  if (!apiKey) {
    throw new ApiError(500, "SambaNova API key not configured.");
  }

  const { temperature, maxTokens, model } = options;
  const send = (modelName, timeoutMs) => fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelName,
      messages,
      temperature: temperature ?? 0.7,
      max_tokens: maxTokens ?? 2048,
      stream: true,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const primary = model || config.sambanovaModel || DEFAULT_MODEL;
  const backup = config.sambanovaBackupModel || DEFAULT_BACKUP_MODEL;

  try {
    let res;
    let detail = "";
    try {
      res = await send(primary, backup && backup !== primary ? firstModelTimeoutMs : firstModelTimeoutMs + backupModelTimeoutMs);
      if (!res.ok) detail = await res.text();
    } catch (err) {
      if (!/abort|timeout/i.test(`${err.name} ${err.message}`) || !backup || backup === primary) throw err;
      logger.warn("sambanovaAdapter.slowModel", { model: primary, retryWith: backup });
      res = null;
    }

    if (backup && backup !== primary && (!res || (!res.ok && isRetryableWithBackup(res.status, detail)))) {
      if (res) logger.warn("sambanovaAdapter.switchingModel", { model: primary, status: res.status, retryWith: backup });
      res = await send(backup, backupModelTimeoutMs);
      detail = res.ok ? "" : await res.text();
    }

    if (!res.ok) {
      throw new Error(`SambaNova service error: ${res.status} ${detail.slice(0, 300)}`);
    }
    return res.body;
  } catch (err) {
    logger.error("sambanovaAdapter.generateStream", { error: err.message });
    throw err;
  }
}

module.exports = {
  generateStream,
  DEFAULT_MODEL,
  DEFAULT_BACKUP_MODEL,
  // Tests shorten the per-model timeouts.
  setTimeouts: (first, backup) => { firstModelTimeoutMs = first; backupModelTimeoutMs = backup; },
};
