(() => {
  const LEGACY_PROVIDER = "Groq";
  const DISPLAY_PROVIDER = "Grok 4.6";
  const GROK_MODEL = "x-ai/grok-4.6";
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
          .slice(-12)
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
    // Multi-AI still uses the lowercase internal id `groq`. The normal model
    // selector is transformed at build time to direct Puter Grok 4.6.
    const isLegacyGroq = provider.toLowerCase() === "groq";

    if (!isChatRequest || !isLegacyGroq) {
      return originalFetch(input, init);
    }

    try {
      if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (!window.puter?.ai?.chat) {
        throw new Error("Puter.js is unavailable. Refresh the page and try again.");
      }

      const messages = parseMessages(body);
      const result = await window.puter.ai.chat(messages, { model: GROK_MODEL });
      if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");

      const text = responseText(result).trim();
      if (!text) throw new Error("Grok 4.6 returned an empty response.");
      return sseResponse([{ type: "content", data: text }]);
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      console.error("[VetroAI] Puter Grok 4.6 failed", error);
      return sseResponse([
        { type: "error", data: `Grok 4.6 failed: ${error?.message || "Unknown error"}` },
      ]);
    }
  };

  // Backward-compatible UI rename for any cached bundle that still renders
  // the old label. New builds already contain Grok 4.6 via the Vite transform.
  const renameVisibleGroq = (root = document.body) => {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      if (node.nodeValue?.includes(LEGACY_PROVIDER)) {
        node.nodeValue = node.nodeValue.replace(/\bGroq\b/g, DISPLAY_PROVIDER);
      }
    }
  };

  const startLabelObserver = () => {
    renameVisibleGroq();
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.TEXT_NODE && node.nodeValue?.includes(LEGACY_PROVIDER)) {
            node.nodeValue = node.nodeValue.replace(/\bGroq\b/g, DISPLAY_PROVIDER);
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            renameVisibleGroq(node);
          }
        }
        if (mutation.type === "characterData" && mutation.target.nodeValue?.includes(LEGACY_PROVIDER)) {
          mutation.target.nodeValue = mutation.target.nodeValue.replace(/\bGroq\b/g, DISPLAY_PROVIDER);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startLabelObserver, { once: true });
  } else {
    startLabelObserver();
  }

  window.__VETROAI_GROK_MODEL__ = GROK_MODEL;
})();
