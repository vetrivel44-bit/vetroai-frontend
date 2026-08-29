(() => {
  const RESEARCH_MODEL = "perplexity/sonar-pro";
  const RESEARCH_MODES = new Set([
    "research",
    "deep_research",
    "deep-research",
    "deep_search",
    "deep-search",
    "analyst",
  ]);
  const previousFetch = window.fetch.bind(window);

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

  const encodeEvent = (event) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);

  const researchResponse = (form, signal) => {
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event) => controller.enqueue(encodeEvent(event));
        try {
          if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
          if (!window.puter?.ai?.chat) {
            throw new Error("Puter.js is unavailable. Refresh the page and try Research again.");
          }

          send({ type: "status", data: "Planning research with Sonar Pro…" });
          await Promise.resolve();

          const prompt = buildResearchPrompt(form);
          send({ type: "status", data: "Searching and comparing reliable sources…" });
          const result = await window.puter.ai.chat(prompt, { model: RESEARCH_MODEL });

          if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

          let text = getText(result).trim();
          if (!text) throw new Error("Sonar Pro returned an empty research response.");

          const citations = getCitationUrls(result);
          if (citations.length && !/\n#{1,6}\s*Sources\b/i.test(text) && !/\n\*\*Sources\*\*/i.test(text)) {
            text += `\n\n## Sources\n${citations.map((url, index) => `${index + 1}. ${url}`).join("\n")}`;
          }

          send({ type: "status", data: "Synthesizing findings and checking uncertainties…" });
          send({ type: "content", data: text });
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
        } catch (error) {
          if (error?.name === "AbortError") {
            controller.error(error);
            return;
          }
          console.error("[VetroAI] Sonar Pro research failed", error);
          send({
            type: "error",
            data: `Research failed: ${error?.message || "Unknown Sonar Pro error"}`,
          });
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
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
    const useSonar = RESEARCH_MODES.has(mode) || explicitResearch;

    if (!useSonar) return previousFetch(input, init);
    return researchResponse(body, init?.signal);
  };

  window.__VETROAI_RESEARCH_MODEL__ = RESEARCH_MODEL;
  window.__VETROAI_RESEARCH_MODES__ = [...RESEARCH_MODES];
})();
