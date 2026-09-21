const logger = require("../utils/logger");
const { config } = require("../config/env");

// Text embeddings via Cohere's embed endpoint — reuses COHERE_API_KEY, which
// is already required for the Cohere chat provider, so memory/RAG works
// out of the box on any deployment that has that key set and degrades to
// "no memory" (never a crash) when it doesn't.
const EMBED_URL = "https://api.cohere.com/v1/embed";
const EMBED_MODEL = "embed-english-v3.0";

function isAvailable() {
  return Boolean(config.cohereApiKey);
}

// inputType is "search_document" for text being stored, "search_query" for
// text being used to search — Cohere's embed-v3 models are tuned differently
// for each and mixing them up measurably hurts retrieval quality.
async function embed(texts, inputType = "search_document") {
  if (!isAvailable()) return null;
  const list = Array.isArray(texts) ? texts : [texts];
  if (!list.length) return [];

  try {
    const res = await fetch(EMBED_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.cohereApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBED_MODEL,
        texts: list.map((t) => String(t).slice(0, 2000)),
        input_type: inputType,
        embedding_types: ["float"],
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Cohere embed error: ${res.status} ${detail.slice(0, 200)}`);
    }

    const data = await res.json();
    const vectors = data?.embeddings?.float || data?.embeddings;
    if (!Array.isArray(vectors)) throw new Error("Cohere embed returned no vectors");
    return vectors;
  } catch (err) {
    logger.warn("embeddingService.embed.failed", { error: err.message });
    return null;
  }
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

module.exports = { isAvailable, embed, cosineSimilarity };
