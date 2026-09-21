// Talks to the backend's /api/memories — the server-side, embedding-backed
// half of "Memory across chats". The local list (see lib/memory.js) stays the
// synchronous, always-available source of truth for the UI; this layer keeps
// it in sync with the backend so memory can also be retrieved there by
// semantic similarity (see memoryService.retrieveRelevant) rather than just
// being dumped wholesale into every prompt.
//
// Every call is best-effort: a network hiccup, an offline/local token, or an
// identity the backend can't resolve to a DB user (see authMiddleware) must
// never break the memory UI, so failures here just resolve to null/[].

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : null;
}

// "local_..." tokens are the frontend's own offline-mode stand-in — never
// worth a network round trip.
function isUsableToken(token) {
  return Boolean(token) && !token.startsWith("local_");
}

export async function fetchRemoteMemories(apiBase, token) {
  if (!isUsableToken(token)) return null;
  try {
    const res = await fetch(`${apiBase}/memories`, { headers: authHeaders(token) });
    if (!res.ok) return null;
    const body = await res.json();
    const list = Array.isArray(body?.data) ? body.data : [];
    return list.map((m) => ({
      remoteId: m.id,
      text: m.content,
      source: m.source || "manual",
      createdAt: m.createdAt ? Date.parse(m.createdAt) : Date.now(),
    }));
  } catch {
    return null;
  }
}

export async function addRemoteMemory(apiBase, token, text) {
  if (!isUsableToken(token)) return null;
  try {
    const res = await fetch(`${apiBase}/memories`, {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.data?.id || null;
  } catch {
    return null;
  }
}

export async function deleteRemoteMemory(apiBase, token, remoteId) {
  if (!isUsableToken(token) || !remoteId) return;
  try {
    await fetch(`${apiBase}/memories/${encodeURIComponent(remoteId)}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
  } catch { /* best effort */ }
}

export async function clearRemoteMemories(apiBase, token) {
  if (!isUsableToken(token)) return;
  try {
    await fetch(`${apiBase}/memories`, { method: "DELETE", headers: authHeaders(token) });
  } catch { /* best effort */ }
}
