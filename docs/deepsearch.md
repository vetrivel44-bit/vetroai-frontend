# DeepSearch

DeepSearch (the "DeepSearch" and "Research" modes) researches a question the
way Claude's Research does, then writes a cited report.

## What the reader sees

- **Start screen:** picking DeepSearch replaces the greeting with what it
  does and example research questions (`DeepSearchIntro.jsx`).
- **Live research card** (`ResearchActivity.jsx`): a stage bar (Plan,
  Search, Read, Check, Write), the sites found so far and a running clock.
  It opens onto the research plan with sources per angle, each step with its
  queries and the pages it read, and every site consulted. It folds into
  "Research complete · 24 sources · 11 searches · 1m 12s" once the report
  starts.
- **Citations:** each [n] in the report is a chip with the source's icon,
  linking to it. Hovering or focusing it previews the title, site and date
  (`CitationChip.jsx`). This works in any answer that has sources.

## How a question is researched

The research runs in `backend/src/services/agenticSearchService.js`.

1. **Plan.** A research model splits the question into 2–5 angles (core
   facts, latest developments, numbers, comparisons, risks…), each with its
   own search queries. The question as asked is always searched too. Recent
   conversation is included, so follow-ups like "and in 2027?" make sense.
2. **Search.** Every angle's queries run in parallel.
3. **Read.** Pages are read in full, not just their search snippets. Tavily
   returns page text; other results are fetched by `pageReader.js`, which only
   goes to public hosts. The passages relevant to each angle are picked out
   by term matching, which costs no model tokens.
4. **Find gaps.** The research model reviews the evidence for each angle and
   names what's missing: a number no source states, sources that disagree, an
   aspect no angle covers. Up to two follow-up rounds.
5. **Cross-check.** It picks up to four claims the answer will rely on that
   only one source makes, or that sources dispute. Each one gets an
   independent search.
6. **Write.** Up to 24 sources are chosen across all the angles and numbered
   once, in the same order as the source cards. The writing model gets each
   source's best passages, the angles that came up short, and the claims to
   judge. It opens with the bottom line, cites every claim as [n], says where
   sources disagree, and ends with "Confidence and gaps".

Every phase has a limit: 3 rounds, 24 searches, 12 fetched pages, and
2½ minutes. If a step fails, the research carries on with what it has. If
the reader stops the answer or closes the tab, the research stops too, and
no report is written.

Pages are fetched only from public addresses. The check runs on the address
each connection actually uses, so a site can't pass the check and then point
its name at an internal address (DNS rebinding). IPv4 addresses written
inside IPv6 ones, like `[::ffff:127.0.0.1]`, are checked as the IPv4 address.

## Which models

- **Research model:** Groq `RESEARCH_MODEL` (default `llama-3.3-70b-versatile`).
  When that's rate-limited it falls back to `SEARCH_PLANNER_MODEL`, then to
  Mistral. With neither key set, DeepSearch searches the question as asked
  and still reads the pages.
- **Search:** Tavily (`TAVILY_API_KEY`), falling back to DuckDuckGo, Bing
  and Google News.
- **Writer:** the usual provider chain. Groq's free tier caps each request at
  about 12k tokens, so a Groq writer gets a compact version of the evidence:
  the same sources and numbers, one short passage each. Every other writer
  gets the full evidence.
- **Browser models** (GPT, Claude and others via Puter): the browser calls
  `POST /api/research`, which runs the same research and streams the same
  activity panel. The chosen model then writes the report with the same
  instructions.
- **Fallback:** if the backend can't produce a report at all, the
  browser asks Perplexity Sonar Pro through Puter instead
  (`frontend/public/research-puter-bridge.js`).

## Checking a deployment

`GET /health` on the backend lists, under `integrations`, the web search and
research model DeepSearch will use. It also shows whether ProKerala is
configured for astrology. Keys are never shown.
