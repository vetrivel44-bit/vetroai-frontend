// Should a browser model's turn search the web first?
//
// Backend models are judged on the server by a small model that reads the
// message (searchIntentService); browser models ask the same judge through
// /api/search-intent, so every model decides the same way. A word list used to
// decide here, and "I am happy" was searched and answered with facts about a
// song. If the server can't answer in time, the local word list (`fallback`)
// decides.

const TIMEOUT_MS = 3000;

const turnText = (m) => (typeof m?.content === "string" ? m.content : "");

/**
 * Resolves to true when the message should be searched.
 * `history` is the conversation before it; `fallback()` decides when the
 * server can't. `fetchImpl` is for tests.
 */
export async function askSearchIntent(apiBase, { query, history = [], mode, timeZone } = {}, { fallback = () => false, fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  try {
    const res = await fetchImpl(`${apiBase}/search-intent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        mode,
        timeZone,
        history: (Array.isArray(history) ? history : [])
          .filter((m) => (m?.role === "user" || m?.role === "assistant") && turnText(m))
          .slice(-4)
          .map((m) => ({ role: m.role, content: turnText(m).slice(0, 600) })),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return fallback();
    const data = await res.json();
    const search = data?.data?.search ?? data?.search;
    return typeof search === "boolean" ? search : fallback();
  } catch {
    return fallback();
  }
}
