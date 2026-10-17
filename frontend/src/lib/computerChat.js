import { authHeaders } from "./usageClient";

// One request to VetroAI's chat endpoint whose whole answer is wanted at once
// (a plan as JSON, a table of summaries) rather than streamed into the page.

/** Reads a /chat server-sent-event stream to the end and returns the text. */
export async function readChatStream(response, onText, onEvent) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The server did not return a stream.");
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      let event;
      try { event = JSON.parse(raw); } catch { continue; }
      const type = event.type || (event.content ? "content" : "");
      const data = event.data ?? event.content;
      if (type === "content" && data) { text += data; onText?.(text); }
      else if (type === "clear") text = "";
      else if (type === "error" && data) throw new Error(String(data));
      else if (type && data != null) onEvent?.(type, data);
    }
  }
  return text;
}

export async function askModel(api, { input, systemPrompt = "", mode = "code_exec", provider = "gemini", maxTokens = 8192, signal, webSearch = false, fetchImpl = globalThis.fetch, onText, onEvent }) {
  const body = new FormData();
  body.append("provider", provider);
  body.append("mode", mode);
  body.append("route", "backend");
  body.append("input", input);
  body.append("messages", JSON.stringify([{ role: "user", content: input }]));
  body.append("maxTokens", String(maxTokens));
  body.append("webSearch", webSearch ? "true" : "false");
  body.append("safeMode", "true");
  if (systemPrompt) body.append("systemPrompt", systemPrompt);
  const response = await fetchImpl(`${api}/chat`, { method: "POST", body, headers: authHeaders(), signal });
  if (!response.ok) {
    let message = `Server error: ${response.status}`;
    try { const data = await response.json(); message = data.message || data.error || message; } catch { /* not JSON */ }
    throw new Error(message);
  }
  return readChatStream(response, onText, onEvent);
}
