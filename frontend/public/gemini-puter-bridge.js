(() => {
  const GEMINI_MODEL = "gemini-3.1-pro-preview";
  const originalFetch = window.fetch.bind(window);

  const responseText = (response) => {
    if (typeof response === "string") return response;
    const content = response?.message?.content ?? response?.text ?? response?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.map((part) => part?.text || part?.content || "").join("");
    }
    return "";
  };

  const parseMessages = (form) => {
    let messages = [];
    try {
      const raw = form.get("messages");
      const parsed = raw ? JSON.parse(String(raw)) : [];
      if (Array.isArray(parsed)) {
        messages = parsed
          .filter((message) => message?.content && ["user", "assistant", "system"].includes(message.role))
          .slice(-20)
          .map(({ role, content }) => ({ role, content: String(content) }));
      }
    } catch {
      messages = [];
    }

    const systemPrompt = String(form.get("systemPrompt") || "").trim();
    if (systemPrompt && !messages.some((message) => message.role === "system")) {
      messages.unshift({ role: "system", content: systemPrompt });
    }

    const input = String(form.get("input") || "").trim();
    const last = messages[messages.length - 1];
    if (input && !(last?.role === "user" && last?.content === input)) {
      messages.push({ role: "user", content: input });
    }

    return messages.length ? messages : [{ role: "user", content: input || "Hello" }];
  };

  const sseResponse = (events, status = 200) => {
    const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
    return new Response(body, {
      status,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  };

  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url || "";
    const body = init?.body;
    const isChatRequest = /\/api\/chat(?:\?|$)/i.test(url);
    const provider = body instanceof FormData ? String(body.get("provider") || "") : "";
    const isGemini = provider.toLowerCase() === "gemini";

    if (!isChatRequest || !isGemini) {
      return originalFetch(input, init);
    }

    try {
      if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (!window.puter?.ai?.chat) {
        throw new Error("Puter.js is unavailable. Refresh the page and try again.");
      }

      const messages = parseMessages(body);
      const result = await window.puter.ai.chat(messages, { model: GEMINI_MODEL });
      if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");

      const text = responseText(result).trim();
      if (!text) throw new Error("Gemini 3.1 Pro Preview returned an empty response.");
      return sseResponse([{ type: "content", data: text }]);
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      console.error("[VetroAI] Puter Gemini 3.1 Pro Preview failed", error);
      return sseResponse([
        { type: "error", data: `Gemini 3.1 Pro Preview failed: ${error?.message || "Unknown error"}` },
      ]);
    }
  };

  window.__VETROAI_GEMINI_MODEL__ = GEMINI_MODEL;
})();
