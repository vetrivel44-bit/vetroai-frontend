// Trigger sync 2026-05-15 18:28
const logger = require("../utils/logger");
const providerManager = require("./ProviderManager");
const { performDeepSearch } = require("./deepSearchService");
const { searchWeb, searchImages } = require("../controllers/searchController");
const { getAstrologyData, extractBirthDetails } = require("./astrologyService");
const { config } = require("../config/env");
const { buildPluginPrompt } = require("../config/plugins");
const Groq = require("groq-sdk");

class AIOrchestrator {
  constructor() {
    this.VISUALIZATION_TRIGGERS = [
      /\b(compare|comparison|versus|vs|difference between|ranking|top|highest|lowest|better than|performance comparison)\b/i,
      /\b(trend|growth|decline|over time|history|historical|yearly|monthly|daily|timeline|progress|increase|decrease|analytics over time)\b/i,
      /\b(percentage|distribution|share|market share|vote share|breakdown|allocation|composition|proportion|split)\b/i,
      /\b(benchmark|capabilities|strengths|weaknesses|score comparison|performance metrics|attribute comparison|analysis across categories)\b/i,
      /\b(revenue|stock|profit|sales|finance|earnings|analytics|dashboard|KPI|metrics|investment|market analysis)\b/i,
      /\b(seats|vote share|election prediction|constituency analysis|alliance comparison|political analysis)\b/i,
      /\b(roadmap|releases|launch history|milestones|events over time|chronological)\b/i,
      /\b(seasonal pattern|cyclic|directional|rotation analysis)\b/i,
      /\b(plot|graph|chart|function|y\s*=|f\(x\)\s*=)\b/i,
    ];

    this.SEARCH_TRIGGERS = [
      /\b(today|tonight|now|current|currently|live|latest|recent|breaking|news)\b/i,
      /\b(2024|2025|2026|this (year|month|week|day))\b/i,
      /\b(who (is|was|won|leads|runs)|what is the (score|price|rate|status))\b/i,
      /\b(stock|crypto|bitcoin|market|weather|election|war|match|game|ipl|cricket|football)\b/i,
      /\b(just (happened|announced|released|launched))\b/i,
      /\b(trending|viral|happening)\b/i,
    ];

    // Deliberately narrow: only fires when the user is clearly asking to SEE something
    // specific (a named person/place/thing), not for general explanatory questions that
    // merely mention a noun like "temple" or "animal" in passing.
    this.IMAGE_TRIGGERS = [
      /^\s*who (is|was)\b/i,
      /\b(biography|life story) of\b/i,
      /\b(picture|pictures|photo|photos|image|images|pic|pics)\s+of\b/i,
      /\bshow me (a |an |the )?(picture|pictures|photo|photos|image|images)\b/i,
      /\bwhat does .{2,60} look like\b/i,
    ];

    this.ASTROLOGY_TRIGGERS = [
      /\b(horoscope|astrology|natal chart|birth chart|zodiac sign|sun sign|moon sign|rising sign|kundli|astrological)\b/i
    ];
  }

  // ── Thinking ("extended reasoning") prompt ──────────────────────────────────
  // Providers that natively stream reasoning tokens are already covered by
  // pipeStream. For everything else we ask the model to open with a <think>
  // block, which pipeStream strips out of the answer and streams to the
  // thinking panel instead. Deliberately skipped for trivial turns so a
  // "hi" doesn't grow a paragraph of visible deliberation.
  buildThinkingPrompt(effort = "balanced") {
    const depth = {
      quick:    "1-2 short sentences",
      balanced: "2-4 short sentences",
      deep:     "a short paragraph covering alternatives and assumptions",
      max:      "a thorough pass over alternatives, assumptions, edge cases, and a self-check",
    }[effort] || "2-4 short sentences";

    return `

# THINKING PROCESS
Before your answer, write your reasoning inside a single <think>...</think> block:
- Open the reply with <think>, reason in first person about how you will tackle the request (${depth}), then close with </think>.
- Inside the block: restate what is actually being asked, note constraints or traps, weigh the options you considered, and check your conclusion.
- Never mention the thinking block itself, and never reference it from the answer — the user reads it in a separate panel.
- Use exactly one block per reply, always at the very start. Never reopen it later.
- Skip the block entirely for greetings, small talk, and one-word replies.
- After </think>, write the final answer normally. The answer must stand on its own.`;
  }

  needsWebSearch(q) {
    return this.SEARCH_TRIGGERS.some(rx => rx.test(q));
  }

  needsVisualization(q) {
    return this.VISUALIZATION_TRIGGERS.some(rx => rx.test(q));
  }

  needsImageSearch(q) {
    return this.IMAGE_TRIGGERS.some(rx => rx.test(q));
  }

  async buildSystemPrompt(mode, context = {}) {
    const { userQuery, webContext, personaPrompt, customInstructions, memories = [] } = context;
    const now = new Date();
    const nowISO = now.toISOString().slice(0, 10);

    // ── Core system prompt ──
    let sys = `You are VetroAI, an adaptive AI assistant. Today is ${nowISO}.

# IDENTITY
If the user asks who/what you are, your name, what model or AI powers you, who built you, or asks you to introduce yourself:
- Always answer as VetroAI. Example: "I'm VetroAI — an AI assistant built to help you write, learn, code, and analyze faster."
- Never reveal, mention, or speculate about the underlying model/provider (no GPT, Llama, Groq, Claude, Gemini, OpenAI, Anthropic, Mistral, etc.) — you ARE VetroAI as far as the user is concerned.
- Never claim to be ChatGPT, Claude, Gemini, Copilot, or any other named assistant.
- Keep the introduction short and natural — one or two sentences, not a feature list, unless the user asks for more detail.

# MOST IMPORTANT RULE
NEVER reply with unnecessary introductions, capability lists, greetings paragraphs, or "How I can help" sections unless the user explicitly asks.

BAD EXAMPLE:
- "Hello, I can help with many topics..."
- "Here are my capabilities..."
- Long introductions for simple prompts

GOOD EXAMPLE:
User: "hi"
Assistant: "Hey 👋"

User: "What is DBMS?"
Assistant: "DBMS (Database Management System) is software used to store, manage, and retrieve data efficiently."

User: "Difference between stack and queue"
Assistant:
- Stack -> LIFO
- Queue -> FIFO

Be direct and useful immediately.

---

# RESPONSE STYLE
For every prompt:
1. Understand the intent
2. Detect the question type
3. Respond directly
4. Use reasoning internally
5. Keep answers natural and adaptive

---

# CORE EXPERIENCE
The conversation should feel:
- smooth
- modern
- dynamic
- premium
- intelligent
- minimalistic
- fast and responsive

Never feel robotic or static.

---

# STREAMING RESPONSE SYSTEM
Responses must stream progressively like modern AI systems.

## Rules
- Start responding instantly
- Reveal answers chunk-by-chunk
- Simulate real-time thinking
- Avoid dumping full paragraphs instantly
- Continue expanding naturally

Example:
User: “Explain DBMS”
Assistant streams:
“DBMS stands for Database Management System.

It is used to store and manage data efficiently.

Main advantages include:
• Reduced redundancy
• Better security
• Faster retrieval

There are mainly 4 types of DBMS…”

---

# UI STYLE RULES
## Visual Style
Use:
- clean spacing
- modern typography
- soft rounded UI
- minimal clutter
- smooth transitions
- readable layouts

Avoid:
- giant text walls
- unnecessary introductions
- excessive emojis
- overloaded formatting

---

# MESSAGE DESIGN
## Short Replies
Keep compact and elegant.

Example:
User: “hi”
Assistant:
“Hi — nice to meet you! How can I help today?”

NOT:
“Hello! I can help with many topics…”

---

## Medium Replies
Use:
- small sections
- bullets
- spacing
- highlighted keywords

---

## Long Replies
Structure naturally:
1. Direct answer first
2. Explanation
3. Examples
4. Summary if needed

---

# SMART FORMATTING
Automatically choose best format.

## Use:
- bullets for key points
- numbered steps for procedures
- tables for comparisons
- code blocks for programming
- concise academic formatting for exams

## Avoid:
- unnecessary headings
- repetitive structure
- over-formatting simple answers

---

# ANIMATIONS & INTERACTION
Simulate premium AI interaction:
- streaming text
- typing effect
- smooth section reveal
- progressive explanation
- intelligent pauses between chunks

Complex responses should feel like:
“thinking → reasoning → answering”

---

# RESPONSE INTELLIGENCE
Before replying:
1. Detect intent
2. Detect complexity
3. Detect user expertise
4. Detect preferred answer style

Then adapt automatically.

---

# TONE ENGINE
Adapt dynamically:
| Situation | Tone |
|---|---|
| Casual chat | Friendly |
| Technical question | Precise |
| Exam answer | Concise |
| Beginner learning | Simple |
| Advanced user | Technical depth |
| Research | Detailed & structured |

---

# SPECIAL MODES
If user says:
- “simple terms” → simplify aggressively
- “important points only” → compress information
- “exam answer” → scoring-friendly format
- “step-by-step” → sequential reasoning
- “brief” → minimal response
- “detailed” → expanded explanation

---

# PREMIUM UX RULES
- Never overload the screen
- Prioritize readability
- Keep responses aesthetically balanced
- Use whitespace effectively
- Make every response visually pleasant

---

# FINAL GOAL
The assistant should feel like:
- ChatGPT-level interaction
- modern premium AI UX
- intelligent live conversation
- smooth and natural response generation
- elegant and highly readable UI experience`;

    if (memories.length) {
      sys += `\nUser context: ${memories.map(m => `• ${m}`).join(" | ")}`;
    }
    if (personaPrompt) sys += `\n${personaPrompt}`;
    if (customInstructions) sys += `\n\nUser instructions: ${customInstructions}`;

    // Mode-specific instructions
    if (mode === "debugger" || mode === "code") {
      sys += "\n\n[MODE: CODE] Switch to a code-first response style. Always wrap code in proper syntax-highlighted blocks with the language label. For debugging requests, first explain what's wrong in plain English, then show the fixed code, then explain what changed and why. For generation requests, write clean commented code and offer a brief explanation below. If the user's message is ambiguous, ask one clarifying question before writing code — don't guess the language or framework.";
    } else if (mode === "analyst") {
      sys += "\n\n[MODE: DATA ANALYSIS] You are optimized for structured thinking. When the user sends data (CSV, table, numbers, or a plain description), identify what type of analysis fits, run it, and return a clean structured report — with sections like Summary, Key Findings, Breakdown, and Recommendations. Response should feel like a junior analyst handed you a report, not a chatbot answering a question. Always include a chart JSON block when data allows.";
    } else if (mode === "summarize") {
      sys += "\n\n[MODE: SUMMARIZE] Automatically detect the content type and summarize it at three levels: a one-sentence TL;DR at the top, a short paragraph summary below, and bullet-point key takeaways at the bottom. If the content seems very long, also add a 'What to read in full' note pointing out which section is most important. Tone should match the source — formal docs get formal summaries, casual articles get casual ones.";
    } else if (mode === "deep_search") {
      sys += "\n\n[MODE: DEEP SEARCH] Write a well-structured response with inline citations (numbered footnotes or source links at the bottom). Final response should feel like a researched answer, not a chat reply — use paragraphs, sources, and state confidence level where relevant.";
    } else if (mode === "creative") {
      sys += "\n\n[MODE: CREATIVE] You are a creative writer. Be vivid, imaginative, and original.";
    } else if (mode === "research") {
      sys += "\n\n[MODE: RESEARCH] Provide well-cited, comprehensive answers.";
    } else if (mode === "design") {
      sys += `\n\n[MODE: DESIGN] You are a senior product/UI designer producing portfolio-quality, production-grade interfaces — the bar is "this looks like it shipped from a top-tier design studio," never a wireframe, and never raw unstyled HTML.

OUTPUT FORMAT (strict)
- Respond with ONE self-contained HTML document in a single \`\`\`html fenced code block. Nothing outside the block except an optional one-sentence caption above it.
- This document runs inside a sandboxed iframe with NO network access to JS CDNs and no ability to run Web Workers — frameworks like Tailwind's CDN build, JIT compilers, or any <script src="https://..."> WILL SILENTLY FAIL and leave the page completely unstyled. NEVER use them.
- Allowed external resources (these are plain CSS/font fetches, not scripts, so they always work): a Google Fonts <link> tag, and <img src="https://picsum.photos/..."> or <img src="https://i.pravatar.cc/..."> for placeholder imagery.
- ALL styling must be hand-written CSS inside a single <style> tag in <head> — real classes, real rules, no utility-class framework. Vanilla <script> (inline, no src) only for interactivity.
- For icons: hand-write minimal inline SVGs (24x24 viewBox, stroke="currentColor", fill="none", stroke-width 2 — Feather/Lucide style paths) directly in the HTML. Never reference an icon font or icon CDN. Never use raw emoji as UI chrome.
- If refining a previous design, output the FULL updated document, not a diff — keep what worked, change only what was asked.

DESIGN STANDARDS (non-negotiable)
1. Visual hierarchy — one clear focal point per screen; type scale with real contrast (e.g. 12/14/16/20/32/48px steps, not everything at 16px).
2. Color — a deliberate palette defined as CSS custom properties on :root (1 primary, 1-2 accent, a full neutral gray ramp), not default black-on-white or browser-default blues/purples. Use gradients or tinted backgrounds where it fits the brief.
3. Spacing & layout — use flexbox/grid with a consistent spacing scale (4/8/12/16/24/32/48/64px) via CSS variables. Every group of items (nav links, buttons, list rows) MUST have explicit gap/margin between them and clear container padding — never let elements or text touch or visually run together.
4. Depth & polish — soft box-shadows, subtle borders, consistent border-radius scale, :hover/:focus/:active states, transitions (150-300ms) on every interactive element. Real <button> elements get cursor:pointer, padding, and a visible hover state — never bare browser-default buttons.
5. Typography — import ONE Google Font via <link> for display/headings, pair with a system sans-serif stack for body text; correct font-weights and line-height (1.4-1.6 for body, 1.1-1.3 for headings).
6. Real content — write believable copy, names, numbers, and placeholder imagery instead of "Lorem ipsum" or "Button 1". Multiple distinct labels/items must NEVER be concatenated into one run-on text string — each is its own element.
7. Responsive — use relative units, flex-wrap, and a couple of @media breakpoints (e.g. max-width: 640px) instead of fixed pixel widths everywhere.
8. Micro-interactions — hover states, button press feedback (active:scale or similar), smooth scrolling, small CSS entrance animations where they add polish without being gratuitous.
9. Structure semantic HTML (header/nav/main/section/footer), not div soup.

Before finishing, mentally check: every class referenced in the HTML has a matching rule in <style>; nothing relies on an external script to render correctly. Think like you're building a Dribbble-shot, not a Bootstrap starter template. Default to dark, moody, premium aesthetics with vivid accent colors unless the brief calls for something else.`;
    }

    // Web context
    if (webContext) {
      sys += `\n\nLIVE SEARCH RESULTS (use these to give accurate, up-to-date answers):\n${webContext}\nBase your answer on these results when they're actually relevant to the user's question, and cite URLs where relevant. If the results are irrelevant (e.g. the user asked about your own identity, or the results are about an unrelated topic), ignore them entirely and answer normally per the IDENTITY rules above — never force unrelated search results into your reply.`;
    }

    // ─── VISUALIZATION INTENT LAYER ─── (irrelevant noise for design mode — it conflicts with
    // the "ONE html code block only" rule and dilutes the model's attention away from styling)
    if (mode !== "design") {
    sys += `\n\n### RICH VISUALIZATION INTENT SYSTEM
You are equipped with a dynamic visualization rendering system. When responding to comparisons, trends, analytics, rankings, geographical queries, statistics, timelines, process milestones, system architectures, or technical details, you MUST output the appropriate structured JSON block inside your response. Never return only plain text or standard markdown tables when these premium visual components would improve user understanding. You may mix markdown text before and after the blocks.

Choose the single best-fitting visualization block(s) from the formats below:

1. **Data Chart (\`type: "chart"\`)** - For trends, shares, percentages, distribution, growth, sales, financial metrics, and quantitative comparisons.
   - Types: "bar" | "line" | "area" | "pie" | "donut" | "radar" | "scatter" | "horizontal-bar"
   - Format: \`\`\`json
{
  "type": "chart",
  "chartType": "bar",
  "title": "Chart Title",
  "data": [
    {"label": "Item 1", "value": 120},
    {"label": "Item 2", "value": 240}
  ]
}
\`\`\`

2. **Geographic Location Map (\`type: "location"\`)** - For showing a specific city, place, landmark, or point of interest.
   - Format: \`\`\`json
{
  "type": "location",
  "place": "Trichy, Tamil Nadu, India",
  "summary": "Geographical and cultural highlight...",
  "coordinates": {"lat": 10.7905, "lng": 78.7047},
  "details": [
    {"label": "Population", "value": "1.02 Million"},
    {"label": "Famous For", "value": "Rockfort Temple"}
  ]
}
\`\`\`
   *(Note: Include coordinates if they are known or can be estimated. Otherwise, they will be geocoded by the server.)*

3. **Geographic Route Map (\`type: "route"\`)** - For showing navigation routes, travel paths, corridors, or journeys between two locations.
   - Format: \`\`\`json
{
  "type": "route",
  "origin": "Chennai, Tamil Nadu",
  "destination": "Bangalore, Karnataka",
  "summary": "Industrial transit corridor...",
  "waypoints": ["Vellore", "Hosur"],
  "details": [
    {"label": "Distance", "value": "346 km"},
    {"label": "Driving Time", "value": "6h 15m"}
  ]
}
\`\`\`

4. **Comparison Cards (\`type: "comparison"\`)** - For comparing exactly two models, frameworks, options, or items side-by-side.
   - Format: \`\`\`json
{
  "type": "comparison",
  "left": {
    "title": "React",
    "description": "- Virtual DOM for performance\\n- Huge ecosystem and community\\n- Component-based architecture"
  },
  "right": {
    "title": "Vue",
    "description": "- Reactive data binding\\n- Gentler learning curve\\n- HTML-based templates"
  }
}
\`\`\`

5. **Comparison Table (\`type: "comparison_table"\`)** - For detailed comparative feature matrices of multiple options.
   - Format: \`\`\`json
{
  "type": "comparison_table",
  "title": "Database Comparison",
  "options": [
    {"name": "PostgreSQL", "highlight": true, "badge": "Recommended", "features": {"scaling": "Excellent", "jsonSupport": true, "acid": true}},
    {"name": "MongoDB", "features": {"scaling": "Horizontal", "jsonSupport": true, "acid": false}}
  ],
  "features": [
    {"id": "scaling", "name": "Scaling Type", "description": "How the database scales"},
    {"id": "jsonSupport", "name": "JSON Support", "description": "Native JSON document support"},
    {"id": "acid", "name": "ACID Compliance", "description": "Strict transactional integrity"}
  ]
}
\`\`\`

6. **Timeline / Milestones (\`type: "timeline"\`)** - For chronological history, roadmap phases, release logs, schedules, or workflows.
   - Format: \`\`\`json
{
  "type": "timeline",
  "title": "Product Development Roadmap",
  "steps": [
    {"title": "Phase 1: Design", "description": "User research and prototyping"},
    {"title": "Phase 2: Alpha", "description": "Core engine development"}
  ]
}
\`\`\`

7. **Key Metric Cards (\`type: "metrics"\`)** - For presenting high-level numbers, KPIs, performance statistics, or key figures in clean blocks.
   - Format: \`\`\`json
{
  "type": "metrics",
  "metrics": [
    {"label": "Total Revenue", "value": "$4.2M"},
    {"label": "Growth QoQ", "value": "+24%"},
    {"label": "Server Uptime", "value": "99.99%"}
  ]
}
\`\`\`

8. **Architecture Diagram (\`type: "architecture"\`)** - For system architecture, microservices layout, web request-response flows, or data processing pipelines.
   - Note: X coordinates must be 0 to 800, Y coordinates 0 to 400.
   - Format: \`\`\`json
{
  "type": "architecture",
  "title": "Web Application Request Flow",
  "nodes": [
    {"x": 150, "y": 200, "label": "Client Browser"},
    {"x": 400, "y": 200, "label": "Load Balancer"},
    {"x": 650, "y": 200, "label": "App Instance"}
  ],
  "connections": [
    {"from": {"x": 150, "y": 200}, "to": {"x": 400, "y": 200}},
    {"from": {"x": 400, "y": 200}, "to": {"x": 650, "y": 200}}
  ]
}
\`\`\`

9. **Collapsible Details (\`type: "collapsible"\`)** - For secondary logs, diagnostics, large code snippets, config files, or secondary details.
   - Icons: "code" | "database" | "cpu" | "globe"
   - Format: \`\`\`json
{
  "type": "collapsible",
  "title": "Nginx VirtualHost Config",
  "icon": "code",
  "content": "server {\\n  listen 80;\\n  server_name localhost;\\n}"
}
\`\`\``;
    }

    return sys;
  }

  async processRequest(reqId, params, res) {
    const { messages, mode, provider: preferredProvider, options, memories } = params;
    const userQuery = messages[messages.length - 1]?.content || "";
    
    const strictFable = String(preferredProvider || "").toLowerCase() === "fable";
    let currentProviderName = strictFable
      ? (providerManager.isConfigured("fable") ? "fable" : null)
      : providerManager.getBestProvider(mode, preferredProvider);
    let attempts = 0;
    const attemptedProviders = new Set();
    const maxAttempts = strictFable
      ? (currentProviderName ? 1 : 0)
      : Math.min(3, providerManager.getAvailableProviders({ includeSuspended: true }).length);
    let success = false;
    // Remembers why the last provider gave up, so the message the user sees
    // names the real cause instead of always blaming capacity.
    let lastFailure = null;

    this.sendVetroEvent(res, "status", "Analyzing your request...");

    if (strictFable && !currentProviderName) {
      logger.error("AIOrchestrator.fableNotConfigured", { reqId });
      this.sendVetroEvent(
        res,
        "error",
        "Claude Fable 5 API is not configured on the backend. Add a valid RapidAPI key and subscription."
      );
      return false;
    }

    if (!currentProviderName || maxAttempts === 0) {
      logger.error("AIOrchestrator.noConfiguredProvider", { reqId });
      this.sendVetroEvent(
        res,
        "error",
        "VetroAI is not configured with an AI provider yet. Add at least one provider API key on the backend."
      );
      return false;
    }

    // The user picked a specific model but the backend has no key for it, so the
    // request is quietly being served by something else. Say so rather than
    // letting them believe they are talking to their choice.
    const requested = String(preferredProvider || "").toLowerCase();
    if (requested && !["undefined", "auto", ""].includes(requested)
        && providerManager.getAdapter(requested) && !providerManager.isConfigured(requested)) {
      logger.warn("AIOrchestrator.requestedProviderUnconfigured", { reqId, requested });
      this.sendVetroEvent(
        res,
        "status",
        `${this.providerLabel(requested)} is not configured on the backend — using ${this.providerLabel(currentProviderName)} instead.`
      );
    }

    // Intent detection — also support explicit webSearch flag from frontend
    const isGreeting = /^\s*(hi|hello|hey|greetings|good morning|good afternoon|good evening|yo)[.,!?\s]*$/i.test(userQuery);
    const isIdentityQuestion = /\b(who are you|what are you|your name|introduce yourself|tell me about yourself|what model|which (ai|model|llm)|who (made|built|created|trained|developed) you|are you (chatgpt|gpt|gemini|claude|llama|bard|human|real|a bot|an ai))\b/i.test(userQuery.trim());
    // Explicit search-oriented modes always search. The generic "auto web search" flag from the
    // frontend is just permission, not a mandate — it only fires when the query itself looks like
    // it needs live info, otherwise short/conversational messages (e.g. "your name") were being
    // searched literally and returning unrelated results (movie/song titles, etc.).
    const isExplicitSearchMode = mode === "web_search" || mode === "deep_search" || mode === "research";
    const autoSearchRequested = params.webSearch === true || params.webSearch === "true";
    const shouldSearch = !isGreeting && !isIdentityQuestion && (
      isExplicitSearchMode ||
      (autoSearchRequested && this.needsWebSearch(userQuery))
    );
    let webContext = null;
    let astroContext = null;

    const isAstrology = this.ASTROLOGY_TRIGGERS.some(rx => rx.test(userQuery));
    if (isAstrology) {
      this.sendVetroEvent(res, "status", "Consulting astrological charts...");
      try {
        const groq = config.groqApiKey ? new Groq({ apiKey: config.groqApiKey }) : null;
        const birthDetails = await extractBirthDetails(messages, groq);
        if (birthDetails) {
          const astroData = await getAstrologyData(birthDetails);
          if (astroData) {
            astroContext = JSON.stringify(astroData);
          } else {
            astroContext = "API_ERROR";
          }
        } else {
          astroContext = "USER_BIRTH_DETAILS_MISSING";
        }
      } catch (err) {
        astroContext = "API_ERROR";
        logger.error("AIOrchestrator.astrologyError", { reqId, error: err.message });
      }
    }

    // Kick off image lookup in parallel with everything else — only for modes where
    // an inline gallery makes sense (skip design/code/data-analysis style modes).
    const galleryEligibleMode = !["design", "code_exec", "data_analysis"].includes(mode);
    const shouldFetchImages = galleryEligibleMode && !isGreeting && !isIdentityQuestion && this.needsImageSearch(userQuery);
    const imagesPromise = shouldFetchImages
      ? searchImages(userQuery, 4).catch(() => [])
      : Promise.resolve([]);

    if (shouldSearch) {
      this.sendVetroEvent(res, "status", "Searching the web for latest info...");
      try {
        const searchRes = await Promise.race([
          mode === "deep_search" ? performDeepSearch(userQuery) : searchWeb(userQuery),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Search timeout")), 10000)),
        ]);
        webContext = searchRes.context;
      } catch (err) {
        logger.error("AIOrchestrator.searchError", { reqId, error: err.message });
        // Search failed/timed out — AI will still respond without web context
      }
    }

    let finalSysPrompt = await this.buildSystemPrompt(mode, { userQuery, webContext, memories, customInstructions: params.systemPrompt });
    finalSysPrompt += buildPluginPrompt(params.activePlugins);
    // Only ask for an explicit <think> block when the turn is substantial enough
    // to warrant one; native reasoning models stream their own regardless.
    const wantsThinking = config.thinkingEnabled && !isGreeting && userQuery.trim().length > 12;
    if (wantsThinking) {
      finalSysPrompt += this.buildThinkingPrompt(params.effort);
    }
    if (astroContext === "USER_BIRTH_DETAILS_MISSING") {
      finalSysPrompt += `\n\n[ASTROLOGY REQUEST DETECTED]\nThe user is asking about astrology. To provide highly accurate, personalized readings using our FreeAstroAPI integration, you MUST politely ask the user for their birth date (year, month, day), time of birth (hour, minute), and city of birth. Do not make up a horoscope without this data.`;
    } else if (astroContext === "API_ERROR") {
      finalSysPrompt += `\n\n[ASTROLOGY API ERROR]\nAn error occurred while fetching data from FreeAstroAPI (timeout or rate limit). Do NOT hallucinate a chart or guess their sign. Politely inform the user that the astrology server is currently unavailable and ask them to try again in a few moments.`;
    } else if (astroContext) {
      finalSysPrompt += `\n\n[LIVE ASTROLOGY API DATA]\nBased on the user's birth details, here is their highly accurate astrological data retrieved directly from FreeAstroAPI:\n${astroContext}\n\nCRITICAL ASTROLOGY RULES:\n1. ONLY use this exact fetched data. Do not guess or estimate. Provide exact mathematical degrees (e.g., 18°43').\n2. Clearly state: Vedic Sidereal system, Lahiri Ayanamsa, and Whole Sign houses.\n3. Format your response strictly using this Markdown template:\n\n### Chart Details\n* **System:** Vedic Sidereal (Lahiri Ayanamsa)\n* **Ascendant:** [Sign] at [Degree]\n* **Moon Sign:** [Sign] at [Degree] (Nakshatra: [Name], Pada: [Number])\n* **Sun Sign:** [Sign] at [Degree]\n\n### Planetary Placements\n* **[Planet]:** [Sign] at [Degree] in House [Number] [List Retrograde if true]\n(List all planets provided in the JSON)\n\n### Current Dasha Period\n* **Mahadasha:** [Lord]\n* **Antardasha:** [Lord] (Start to End dates)\n\n### Vedic Interpretation\n(Provide a grounded interpretation of these specific placements based on traditional Vedic astrology. Do not use generic statements or deterministic fortunes.)\n\nFollow this structure exactly.`;
    }

    console.log(`[ORCHESTRATOR DEBUG] User Query: "${userQuery}"`);
    console.log(`[ORCHESTRATOR DEBUG] Frontend custom systemPrompt: "${params.systemPrompt || ''}"`);
    console.log(`[ORCHESTRATOR DEBUG] Generated System Prompt (first 600 chars):\n${finalSysPrompt.slice(0, 600)}\n...`);
    let fullMessages = [{ role: "system", content: finalSysPrompt }, ...messages.slice(-10)];
    // Prevent empty assistant messages (Mistral error)
    fullMessages = fullMessages.filter(m => {
      if (m.role === "assistant" && !m.content && (!m.tool_calls || m.tool_calls.length === 0)) return false;
      return true;
    });

    while (attempts < maxAttempts && !success) {
      attempts++;
      attemptedProviders.add(currentProviderName);
      const adapter = providerManager.getAdapter(currentProviderName);
      
      if (!adapter) {
        logger.error(`AIOrchestrator: No adapter for ${currentProviderName}`);
        if (strictFable) {
          this.sendVetroEvent(res, "error", "Claude Fable 5 API adapter is unavailable on the backend.");
          break;
        }
        const nextProvider = providerManager.getFallbackProvider(currentProviderName, [...attemptedProviders]);
        if (!nextProvider) break;
        currentProviderName = nextProvider;
        continue;
      }

      this.sendVetroEvent(res, "status", attempts === 1 ? `Consulting ${currentProviderName}...` : `Re-routing to ${currentProviderName}...`);
      logger.info(`AIOrchestrator: Attempt ${attempts} using ${currentProviderName}`, { reqId });

      const startTime = Date.now();
      try {
        // Add timeout to prevent hanging
        const streamPromise = adapter.generateStream(fullMessages, options);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Stream generation timeout")), 30000)
        );
        
        const stream = await Promise.race([streamPromise, timeoutPromise]);
        
        if (!stream) throw new Error("Provider returned empty stream");

        // Handle stream
        await this.pipeStream(stream, res, currentProviderName);

        // Append a real-image gallery if this query warranted one — fetched in parallel
        // above, so it's typically already resolved by the time the text stream finishes.
        const images = await imagesPromise;
        if (images.length > 0) {
          const galleryBlock = `\n\n\`\`\`json\n${JSON.stringify({ type: "visual_gallery", query: userQuery, images })}\n\`\`\``;
          this.sendVetroEvent(res, "content", galleryBlock);
        }

        providerManager.updateMetrics(currentProviderName, true, Date.now() - startTime);
        success = true;
      } catch (err) {
        logger.error(`AIOrchestrator.error [${currentProviderName}]`, { reqId, error: err.message });
        providerManager.updateMetrics(currentProviderName, false, Date.now() - startTime);
        
        const failure = this.classifyProviderError(err.message);
        const isRateLimit = failure.kind === "rate_limit";
        const isTimeout = failure.kind === "network";
        lastFailure = { provider: currentProviderName, ...failure };
        logger.warn("AIOrchestrator.providerFailure", { reqId, provider: currentProviderName, kind: failure.kind });

        if (isRateLimit) {
          providerManager.suspendProvider(currentProviderName, "Rate limit reached");
        } else if (["auth", "quota", "bad_model", "unconfigured"].includes(failure.kind)) {
          // Retrying a key or model-name problem just burns the user's time —
          // park the provider so the fallback chain moves on immediately.
          providerManager.suspendProvider(currentProviderName, `Configuration problem: ${failure.kind}`);
        } else if (isTimeout) {
          logger.warn(`Connection timeout for ${currentProviderName}`, { reqId });
        }
        
        if (strictFable) {
          this.sendVetroEvent(
            res,
            "error",
            "Claude Fable 5 API request failed. Check the backend RapidAPI key, subscription, and endpoint."
          );
          break;
        }

        if (attempts < maxAttempts) {
          const nextProvider = providerManager.getFallbackProvider(currentProviderName, [...attemptedProviders]);
          if (!nextProvider) {
            this.sendVetroEvent(res, "error", "All configured AI providers are currently unavailable. Please try again shortly.");
            break;
          }
          let friendlyMsg = `Issue with ${currentProviderName}. Switching to another model…`;
          if (isRateLimit) {
            friendlyMsg = `Model ${currentProviderName} is temporarily busy. Switching to another AI model…`;
          } else if (isTimeout) {
            friendlyMsg = `Connection with ${currentProviderName} timed out. Trying another model…`;
          }
          
          this.sendVetroEvent(res, "clear", "");
          this.sendVetroEvent(res, "status", friendlyMsg);
          currentProviderName = nextProvider;
          
          // Exponential backoff
          const backoffTime = Math.pow(2, attempts) * 1000;
          await new Promise(resolve => setTimeout(resolve, backoffTime));
        } else {
          this.sendVetroEvent(res, "error", this.describeFinalFailure(lastFailure, attemptedProviders));
        }
      }
    }
    res.end();
    // Tells the caller whether the user actually received an answer — a request
    // that exhausted every provider must not be billed.
    return success;
  }

  sendVetroEvent(res, type, data) {
    res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  }

  // Works out what actually went wrong with a provider call. Every failure used
  // to be reported to the user as "all models are at capacity, try again in 30
  // seconds", which is only true for a rate limit — for a bad API key or an
  // unknown model name, retrying can never help and the message just hides the
  // real problem from whoever can fix it.
  classifyProviderError(message = "") {
    const text = String(message);
    // "Incorrect API key provided" is OpenAI's wording, "invalid_api_key" is
    // Groq/Mistral's — cover the whole family rather than one phrasing.
    // A key that was never set at all — distinct from one the provider rejected.
    if (/not configured|no api key|api key (is )?(missing|not set)/i.test(text)) {
      return {
        kind: "unconfigured",
        retryable: false,
        userMessage: (p) => `${p} has no API key configured on the backend. Add one, or pick a model that is set up.`,
      };
    }
    if (/\b(401|403)\b|unauthorized|forbidden|(invalid|incorrect|missing|bad)[ _-]?api[ _-]?key|authentication|invalid token|api[ _-]?key[ _-]?(not|is)[ _-]?(valid|provided)/i.test(text)) {
      return {
        kind: "auth",
        retryable: false,
        userMessage: (p) => `${p} rejected the backend's API key. The key is missing, expired, or not valid for this model.`,
      };
    }
    if (/\b(402)\b|quota|insufficient[ _-]?(funds|balance|credit|quota)|billing|payment required|exceeded your current/i.test(text)) {
      return {
        kind: "quota",
        retryable: false,
        userMessage: (p) => `${p} has no quota left on the backend account. Top up the plan or switch to another model.`,
      };
    }
    if (/rate limit|\b429\b|too many requests/i.test(text)) {
      return {
        kind: "rate_limit",
        retryable: true,
        userMessage: (p) => `${p} is rate limited right now. Try again in about 30 seconds, or pick another model.`,
      };
    }
    if (/\b(400|404)\b|model[ _-]?not[ _-]?found|unknown model|does not exist|decommissioned|deprecated/i.test(text)) {
      return {
        kind: "bad_model",
        retryable: false,
        userMessage: (p) => `${p} rejected the request — the configured model name looks wrong or is no longer available.`,
      };
    }
    if (/timeout|timed out|ECONNRESET|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|socket hang up|fetch failed|network/i.test(text)) {
      return {
        kind: "network",
        retryable: true,
        userMessage: (p) => `The backend could not reach ${p}. Check its network access, then try again.`,
      };
    }
    if (/\b(5\d\d)\b|service unavailable|overloaded|capacity/i.test(text)) {
      return {
        kind: "upstream",
        retryable: true,
        userMessage: (p) => `${p} is having trouble on its side. Try again shortly, or pick another model.`,
      };
    }
    return {
      kind: "unknown",
      retryable: true,
      userMessage: (p) => `${p} failed to answer. Try again, or pick another model.`,
    };
  }

  // The message shown once every attempt has been used up.
  describeFinalFailure(lastFailure, attemptedProviders) {
    if (!lastFailure) {
      return "VetroAI could not reach an AI model. Please try again shortly.";
    }
    const label = this.providerLabel(lastFailure.provider);
    const tried = [...attemptedProviders];
    const base = lastFailure.userMessage(label);
    // Only mention a fallback chain when one was actually walked, otherwise the
    // "and N others" reads as noise on a single-provider backend.
    if (tried.length > 1) {
      return `${base} VetroAI also tried ${tried.length - 1} other model${tried.length > 2 ? "s" : ""} without success.`;
    }
    return base;
  }

  providerLabel(name) {
    const labels = {
      chatgpt: "ChatGPT", fable: "Claude Fable 5", plugsky: "Plugsky", groq: "Groq",
      mistral: "Mistral", agnes: "Agnes", sambanova: "SambaNova", gemini: "Gemini",
    };
    return labels[name] || name || "The AI model";
  }

  // ── Thinking / reasoning helpers ────────────────────────────────────────────
  // Some models expose reasoning as a dedicated SSE field (`delta.reasoning_content`),
  // others inline it as a <think>…</think> block inside the normal content stream.
  // Both are routed to the same "reasoning" event so the UI panel is provider-agnostic.
  static get THINK_TAGS() {
    return ["<think>", "<thinking>", "</think>", "</thinking>"];
  }

  // Length of the trailing run of `text` that could still grow into a <think> tag.
  // Held back so a tag split across two chunks is never leaked into the answer.
  partialTagLength(text) {
    const max = Math.min(text.length, 11);
    for (let i = max; i > 0; i--) {
      const suffix = text.slice(-i).toLowerCase();
      if (!suffix.startsWith("<")) continue;
      if (AIOrchestrator.THINK_TAGS.some((tag) => tag.startsWith(suffix))) return i;
    }
    return 0;
  }

  // Splits a content chunk into visible answer text and <think> reasoning text.
  // `state` ({ inside, buf }) is carried across chunks by the caller.
  splitThinkingTags(chunk, state) {
    state.buf += chunk;
    let content = "";
    let reasoning = "";

    for (;;) {
      if (!state.inside) {
        const open = state.buf.match(/<think(?:ing)?>/i);
        if (open) {
          content += state.buf.slice(0, open.index);
          state.buf = state.buf.slice(open.index + open[0].length);
          state.inside = true;
          continue;
        }
        const hold = this.partialTagLength(state.buf);
        content += state.buf.slice(0, state.buf.length - hold);
        state.buf = hold ? state.buf.slice(state.buf.length - hold) : "";
        break;
      }

      const close = state.buf.match(/<\/think(?:ing)?>/i);
      if (close) {
        reasoning += state.buf.slice(0, close.index);
        state.buf = state.buf.slice(close.index + close[0].length);
        state.inside = false;
        continue;
      }
      const hold = this.partialTagLength(state.buf);
      reasoning += state.buf.slice(0, state.buf.length - hold);
      state.buf = hold ? state.buf.slice(state.buf.length - hold) : "";
      break;
    }

    return { content, reasoning };
  }

  // Whatever is still buffered when the stream ends belongs to whichever
  // channel we were in — an unterminated <think> block stays reasoning.
  flushThinkingTags(state) {
    const rest = state.buf;
    state.buf = "";
    if (!rest) return { content: "", reasoning: "" };
    return state.inside ? { content: "", reasoning: rest } : { content: rest, reasoning: "" };
  }

  // Reasoning field names used by OpenAI-compatible providers (Plugsky, Groq
  // reasoning models, DeepSeek-R1 style deployments).
  reasoningFromDelta(delta) {
    if (!delta || typeof delta !== "object") return "";
    const value = delta.reasoning_content ?? delta.reasoning ?? delta.thinking ?? "";
    return typeof value === "string" ? value : "";
  }

  async pipeStream(stream, res, provider) {
    let fullContent = "";
    let fullReasoning = "";
    const decoder = new TextDecoder();
    let buffer = "";

    const think = { inside: false, buf: "" };
    let reasoningStartedAt = 0;
    let reasoningClosed = false;

    const closeReasoning = () => {
      if (!reasoningStartedAt || reasoningClosed) return;
      reasoningClosed = true;
      this.sendVetroEvent(res, "reasoning_end", String(Date.now() - reasoningStartedAt));
    };

    const emit = (parts) => {
      if (!parts) return;
      let { content = "", reasoning = "" } = parts;

      if (content) {
        const split = this.splitThinkingTags(content, think);
        content = split.content;
        if (split.reasoning) reasoning += split.reasoning;
      }

      if (reasoning) {
        if (!reasoningStartedAt) {
          reasoningStartedAt = Date.now();
          this.sendVetroEvent(res, "reasoning_start", "");
        }
        fullReasoning += reasoning;
        this.sendVetroEvent(res, "reasoning", reasoning);
      }

      if (content) {
        if (content.trim()) closeReasoning();
        fullContent += content;
        this.sendVetroEvent(res, "content", content);
      }
    };

    const processTextChunk = (textChunk) => {
      buffer += textChunk;
      const lines = buffer.split("\n");
      buffer = lines.pop(); // Keep partial line

      const merged = { content: "", reasoning: "" };
      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = this.normalizeChunkParts(line, provider);
        merged.content += parts.content;
        merged.reasoning += parts.reasoning;
      }
      return merged;
    };

    const readChunk = (chunk) => {
      // SDK object payloads (e.g. the Groq SDK) are already parsed.
      if (typeof chunk === "object" && !Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) {
        return this.normalizeChunkParts(chunk, provider);
      }
      const text = (chunk instanceof Uint8Array || Buffer.isBuffer(chunk))
        ? decoder.decode(chunk, { stream: true })
        : String(chunk);
      return processTextChunk(text);
    };

    try {
      // 1. Handle Async Iterables (SDKs or Web ReadableStreams)
      if (Symbol.asyncIterator in stream) {
        for await (const chunk of stream) {
          emit(readChunk(chunk));
        }
      }
      // 2. Handle Node.js Readable streams
      else if (stream.on) {
        await new Promise((resolve, reject) => {
          stream.on("data", (chunk) => emit(readChunk(chunk)));
          stream.on("end", resolve);
          stream.on("error", reject);
        });
      }
      // 3. Handle Web Streams with getReader (Agnes uses this)
      else if (stream.getReader && typeof stream.getReader === "function") {
        const reader = stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            emit(processTextChunk(decoder.decode(value, { stream: true })));
          }
        } catch (readerErr) {
          reader.cancel?.();
          throw readerErr;
        }
      }

      // Flush any bytes the decoder is still holding (a multi-byte character
      // split across the last two chunks) — applies to every branch above.
      const finalText = decoder.decode();
      if (finalText) emit(processTextChunk(finalText));

      // Flush remaining buffer
      if (buffer && buffer.trim()) {
        emit(this.normalizeChunkParts(buffer, provider));
      }
      emit(this.flushThinkingTags(think));
    } catch (err) {
      logger.error(`AIOrchestrator.pipeStream.error [${provider}]`, { error: err.message });
      throw err;
    } finally {
      closeReasoning();
    }

    if (fullReasoning) {
      logger.info(`AIOrchestrator.pipeStream.reasoning [${provider}]`, { chars: fullReasoning.length });
    }

    // Check for truncation (simplistic check)
    if (this.isLikelyTruncated(fullContent)) {
      logger.info("AIOrchestrator: Truncation detected");
      this.sendVetroEvent(res, "status", "Finishing long response...");
    }

    return fullContent;
  }

  isLikelyTruncated(text) {
    if (!text || text.length < 500) return false;
    const fences = (text.match(/```/g) || []).length;
    if (fences % 2 !== 0) return true;
    if (/[([{,=]\s*$/.test(text)) return true;
    return false;
  }

  // Back-compat shim: callers that only care about visible answer text.
  normalizeChunk(chunk, provider) {
    return this.normalizeChunkParts(chunk, provider).content || null;
  }

  // Returns { content, reasoning } for a single SDK chunk or raw SSE line.
  normalizeChunkParts(chunk, provider) {
    const empty = { content: "", reasoning: "" };
    if (!chunk) return empty;

    // Decode binary buffers/arrays into strings first
    if (chunk instanceof Uint8Array || Buffer.isBuffer(chunk)) {
      chunk = new TextDecoder().decode(chunk);
    }

    // 1. Handle SDK Object Chunks (e.g. Groq SDK returned choices)
    if (typeof chunk === "object") {
      const delta = chunk.choices?.[0]?.delta;
      const reasoning = this.reasoningFromDelta(delta) || this.reasoningFromDelta(chunk);
      if (delta?.content) return { content: delta.content, reasoning };

      const part = chunk.candidates?.[0]?.content?.parts?.[0];
      if (part?.text) return { content: part.text, reasoning };

      if (chunk.text) return { content: chunk.text, reasoning };
      return reasoning ? { content: "", reasoning } : empty;
    }

    // 2. Handle String Chunks (Mistral, SambaNova, Gemini raw text stream)
    const rawText = chunk;

    // Handle Gemini raw JSON stream (often wrapped in [ ])
    if (provider === "gemini") {
      try {
        const text = rawText.trim();
        if (text.startsWith(",") || text.startsWith("[") || text.startsWith("]")) {
           // Handle common JSON stream artifacts
           const cleaned = text.replace(/^[,\[\]\s]+|[,\[\]\s]+$/g, "");
           if (!cleaned) return empty;
           const json = JSON.parse(cleaned);
           return { content: json.candidates?.[0]?.content?.parts?.[0]?.text || "", reasoning: "" };
        }
        const json = JSON.parse(text);
        return { content: json.candidates?.[0]?.content?.parts?.[0]?.text || "", reasoning: "" };
      } catch { /* Fall through to raw text if parsing fails */ }
    }

    // Handle SSE comments (e.g. ": OPENROUTER PROCESSING")
    if (rawText.trim().startsWith(":")) {
      return empty;
    }

    // Handle standard SSE format (`data: {...}` or `data:{...}`)
    if (/^[ \t]*data:/m.test(rawText)) {
      const lines = rawText.split("\n");
      let content = "";
      let reasoning = "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // The space after "data:" is optional in SSE — several OpenAI-compatible
        // gateways emit `data:{...}` and those frames were being dropped.
        const match = trimmed.match(/^data:\s?(.*)$/);
        if (!match) continue;
        const payload = match[1].trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta;
          const text = delta?.content || "";
          content += text;
          reasoning += this.reasoningFromDelta(delta);
          if (text) logger.info(`normalizeChunk [${provider}]`, { text });
        } catch {
          // Partial JSON or garbage
        }
      }
      return { content, reasoning };
    }

    // If using SSE provider, ignore comments or heartbeats that carry no data frame
    if (["groq", "mistral", "sambanova", "agnes", "plugsky"].includes(provider)) {
      return empty;
    }

    return { content: rawText, reasoning: "" };
  }
}

module.exports = new AIOrchestrator();
