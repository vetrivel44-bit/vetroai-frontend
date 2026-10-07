// DeepSearch's fallback. DeepSearch runs on VetroAI's own research (the
// backend plans the angles, searches them, reads the pages, fills gaps and
// cross-checks claims, streaming its progress). If that request fails before
// any of the report arrives (server unreachable, every model down), the same
// question goes to Perplexity Sonar Pro through Puter instead, on the same
// stream, so the user still gets a researched answer.
(() => {
  const RESEARCH_MODEL = "perplexity/sonar-pro";
  const RESEARCH_LABEL = "Sonar Pro Research";
  const RESEARCH_MODES = new Set([
    "research",
    "deep_research",
    "deep-research",
    "deep_search",
    "deep-search",
    "analyst",
  ]);
  const previousFetch = window.fetch.bind(window);

  const announceResearchModel = (form) => {
    const mode = String(form?.get?.("mode") || "research").toLowerCase().trim();
    window.dispatchEvent(new CustomEvent("vetroai:model-used", {
      detail: {
        label: RESEARCH_LABEL,
        model: RESEARCH_MODEL,
        provider: "Perplexity",
        mode,
        source: "research",
      },
    }));
  };

  const getText = (response) => {
    if (typeof response === "string") return response;
    const content = response?.message?.content ?? response?.text ?? response?.content ?? response?.response;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.map((part) => {
        if (typeof part === "string") return part;
        return part?.text || part?.content || part?.value || "";
      }).join("");
    }
    return "";
  };

  const getCitationUrls = (response) => {
    const candidates = [
      response?.citations,
      response?.message?.citations,
      response?.sources,
      response?.message?.sources,
    ].find(Array.isArray) || [];

    return [...new Set(candidates.map((item) => {
      if (typeof item === "string") return item;
      return item?.url || item?.href || item?.link || "";
    }).filter((url) => /^https?:\/\//i.test(url)))].slice(0, 12);
  };

  const parseHistory = (form) => {
    try {
      const raw = form.get("messages");
      const parsed = raw ? JSON.parse(String(raw)) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((message) => message && ["user", "assistant", "system"].includes(message.role) && message.content)
        .slice(-10)
        .map((message) => ({ role: message.role, content: String(message.content).slice(0, 5000) }));
    } catch {
      return [];
    }
  };

  const buildResearchPrompt = (form) => {
    const question = String(form.get("input") || "").trim();
    const userSystemPrompt = String(form.get("systemPrompt") || "").trim();
    const history = parseHistory(form);

    const conversation = history.length
      ? history.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n")
      : "No previous conversation context.";

    return `You are VetroAI Research, powered by Perplexity Sonar Pro. Perform rigorous web-grounded research for the user's request.

RESEARCH METHOD
1. First understand the exact question, scope, geography, time period, constraints, and decision the user is trying to make.
2. Search broadly, then prioritize primary sources, official publications, regulators, company filings, academic papers, respected research organizations, and recent high-quality reporting.
3. For important factual claims, compare multiple independent sources where practical. If reputable sources disagree, explain the disagreement rather than hiding it.
4. Prefer the newest reliable information for changing topics. State concrete dates for time-sensitive facts.
5. Separate verified facts from estimates, assumptions, forecasts, opinions, and your own inference.
6. Do not invent facts, statistics, quotes, studies, citations, authors, publication dates, or URLs. If evidence is weak or unavailable, say so explicitly.
7. Preserve important numbers, units, currencies, percentages, dates, and definitions accurately.
8. Answer the user's actual decision or question; do not dump unrelated research.

RESPONSE QUALITY
- Start with a concise direct answer or executive summary.
- Then organize the evidence under descriptive headings appropriate to the topic.
- Use tables when they materially improve comparison, not just for decoration.
- Include key evidence/data, major opportunities or arguments, major risks/counterarguments, and uncertainties when relevant.
- For investment/market/company research, distinguish historical facts from forward-looking scenarios and avoid presenting forecasts as certainties.
- End with a clear synthesis: what the evidence supports, what remains uncertain, and what the user should pay attention to next.
- Include inline citations/links whenever the model has reliable source links.
- Finish with a **Sources** section containing the most useful sources and their complete clickable URLs. Only list sources actually used.
- Be comprehensive but avoid repetitive filler. Use clear markdown.

USER'S OPTIONAL CUSTOM INSTRUCTIONS
${userSystemPrompt || "None."}

RECENT CONVERSATION CONTEXT
${conversation}

CURRENT RESEARCH REQUEST
${question || "Continue the research from the conversation context."}`;
  };

  const encoder = new TextEncoder();
  const frame = (event) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
  const SSE_HEADERS = {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
  };

  // A Sonar Pro citation as a source card, numbered as Sonar numbers it.
  const sourceCard = (url) => {
    let domain = url;
    try { domain = new URL(url).hostname.replace(/^www\./, ""); } catch { /* keep the raw URL */ }
    return { title: domain, url, domain, published: null };
  };

  // Researches the question with Sonar Pro and writes the answer to the stream.
  const finishWithSonar = async (controller, form, signal, notice) => {
    const send = (event) => controller.enqueue(frame(event));
    try {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (notice) {
        // The backend's research card and source cards belong to an answer
        // that never came; Sonar Pro's answer brings its own sources.
        send({ type: "clear", data: "" });
        send({ type: "research_reset", data: null });
        send({ type: "sources", data: [] });
        send({ type: "status", data: notice });
      }
      await window.whenPuter?.();
      if (!window.puter?.ai?.chat) {
        throw new Error("Puter.js is unavailable. Refresh the page and try Research again.");
      }

      announceResearchModel(form);
      send({ type: "status", data: "Researching with Sonar Pro…" });
      const result = await window.puter.ai.chat(buildResearchPrompt(form), { model: RESEARCH_MODEL });
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

      let text = getText(result).trim();
      if (!text) throw new Error("Sonar Pro returned an empty research response.");

      const citations = getCitationUrls(result);
      if (citations.length && !/\n#{1,6}\s*Sources\b/i.test(text) && !/\n\*\*Sources\*\*/i.test(text)) {
        text += `\n\n## Sources\n${citations.map((url, index) => `${index + 1}. ${url}`).join("\n")}`;
      }

      if (citations.length) send({ type: "sources", data: citations.map(sourceCard) });
      send({ type: "content", data: text });
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    } catch (error) {
      if (error?.name === "AbortError") {
        controller.error(error);
        return;
      }
      console.error("[VetroAI] Sonar Pro research failed", error);
      send({ type: "error", data: `Research failed: ${error?.message || "Unknown Sonar Pro error"}` });
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    }
  };

  const sonarResponse = (form, signal, notice) => new Response(new ReadableStream({
    start: (controller) => finishWithSonar(controller, form, signal, notice),
  }), { status: 200, headers: SSE_HEADERS });

  // An error event that only means "no answer": anything with a code (no
  // image model, out of credits…) is for the app to handle, not a reason to
  // ask another model.
  const isPlainFailure = (event) => event?.type === "error" && !event.code;

  // Passes the backend's research stream through untouched. If it ends
  // without any of the report, Sonar Pro continues on the same stream.
  const researchWithFallback = async (input, init) => {
    const form = init.body;
    const signal = init.signal;
    let response;
    try {
      response = await previousFetch(input, init);
    } catch (error) {
      if (error?.name === "AbortError" || signal?.aborted) throw error;
      return sonarResponse(form, signal, "VetroAI's research server can't be reached — researching with Sonar Pro instead…");
    }
    if (!response.ok || !response.body) {
      return sonarResponse(form, signal, `VetroAI's research server answered ${response.status} — researching with Sonar Pro instead…`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    return new Response(new ReadableStream({
      async start(controller) {
        let buffer = "";
        let answered = false;
        let heldError = null;
        // An error the app handles itself ends the turn; no fallback after it.
        let handedToApp = false;
        const handleFrame = (raw) => {
          const data = raw.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
          let event = null;
          if (data && data !== "[DONE]") {
            try { event = JSON.parse(data); } catch { /* not JSON; pass it on */ }
          }
          if (event?.type === "content" && event.data) answered = true;
          if (event?.type === "clear") answered = false;
          if (event?.type === "error" && event.code) handedToApp = true;
          // Held back: Sonar Pro may still answer.
          if (!answered && isPlainFailure(event)) {
            heldError = event;
            return;
          }
          controller.enqueue(encoder.encode(`${raw}\n\n`));
        };

        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            for (let cut = buffer.indexOf("\n\n"); cut !== -1; cut = buffer.indexOf("\n\n")) {
              handleFrame(buffer.slice(0, cut));
              buffer = buffer.slice(cut + 2);
            }
          }
          buffer += decoder.decode();
          if (buffer.trim()) handleFrame(buffer.trim());
        } catch (error) {
          if (error?.name === "AbortError" || signal?.aborted) {
            controller.error(error?.name === "AbortError" ? error : new DOMException("Aborted", "AbortError"));
            return;
          }
          if (answered) {
            controller.enqueue(frame({ type: "error", data: "The connection dropped before the report finished." }));
            controller.close();
            return;
          }
          heldError = heldError || { type: "error", data: error?.message || "Connection lost" };
        }

        if (!answered && !handedToApp) {
          await finishWithSonar(controller, form, signal, heldError
            ? "VetroAI's research couldn't finish the report — researching with Sonar Pro instead…"
            : "VetroAI's research came back empty — researching with Sonar Pro instead…");
          return;
        }
        controller.close();
      },
      cancel(reason) {
        reader.cancel(reason).catch(() => {});
      },
    }), { status: response.status, headers: response.headers });
  };

  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url || "";
    const body = init?.body;
    const isChatRequest = /\/api\/chat(?:\?|$)/i.test(url);

    if (!(isChatRequest && body instanceof FormData)) {
      return previousFetch(input, init);
    }

    const mode = String(body.get("mode") || "").toLowerCase().trim();
    const explicitResearch = String(body.get("research") || "false").toLowerCase() === "true";
    if (!(RESEARCH_MODES.has(mode) || explicitResearch)) return previousFetch(input, init);
    return researchWithFallback(input, init);
  };

  window.__VETROAI_RESEARCH_MODEL__ = RESEARCH_MODEL;
  window.__VETROAI_RESEARCH_MODES__ = [...RESEARCH_MODES];
})();
