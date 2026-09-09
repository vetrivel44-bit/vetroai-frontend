# VetroAI Agentic Tool Loop

Before this, VetroAI decided what to fetch with regular expressions. A list of
keyword patterns in `AIOrchestrator` (`SEARCH_TRIGGERS`, `IMAGE_TRIGGERS`,
`ASTROLOGY_TRIGGERS`, `VISUALIZATION_TRIGGERS`) was matched against the user's
message *before any model ran*, and whatever matched was fetched and stapled
into the system prompt.

That has three ceilings:

- **No chaining.** "How did the team that won last night do in the previous
  match?" needs two lookups, where the second depends on the first. A regex
  fires once, on the raw text, and cannot use what the first lookup returned.
- **No refinement.** If the search came back with nothing useful, there was no
  second attempt with a better query.
- **Wrong on both sides.** "What is happening in the news" was searched;
  "explain the 2008 financial crisis" was also searched, because it contains a
  year. The keyword never knew which one needed live data.

The loop replaces the guess with a decision made by the model that can see the
whole conversation.

---

## Shape

```
user turn
   │
   ▼
┌─────────────────────────────────────────────┐
│ planner (tool-capable provider)             │
│   "do I need anything I don't have?"        │
└─────────────────────────────────────────────┘
   │ tool_calls?                    │ none
   ▼                                ▼
execute tools in parallel        stop
   │
   ▼
observations appended → back to the planner (up to TOOL_LOOP_MAX_STEPS)
   │
   ▼
┌─────────────────────────────────────────────┐
│ answering model (normal streaming path)     │
│   full VetroAI system prompt                │
│   + [TOOL RESULTS] block                    │
└─────────────────────────────────────────────┘
```

The loop **does not write the answer**. It gathers facts, and the reply is
still streamed through the existing provider path — so the thinking panel,
the visualization and gallery layers, plugin instructions, and the provider
fallback chain all behave exactly as they did before.

That split is deliberate. Letting the loop's final message be the answer would
have meant re-implementing all of the above inside the loop, and would have cost
streaming — the user would wait for the whole reply instead of watching it
arrive.

---

## Files

| File | Role |
| --- | --- |
| `backend/src/services/tools/registry.js` | Tool schemas + executors. One place to add a tool. |
| `backend/src/services/ToolLoop.js` | The plan → act → observe loop and its guardrails. |
| `backend/src/providers/openaiCompatible.js` | Shared non-streaming `/chat/completions` caller. |
| `backend/src/services/ProviderManager.js` | `supportsTools()` / `getToolCapableProvider()`. |
| `backend/src/services/AIOrchestrator.js` | Runs the loop, then streams the answer as before. |

---

## Tools

All six are **read-only**. Nothing mutates state, spends credits, or acts on the
user's behalf, so a hallucinated call costs one wasted round trip and nothing
worse. That is the property to preserve when adding more.

| Tool | Wraps |
| --- | --- |
| `web_search` | `searchWeb` (Tavily → DuckDuckGo) |
| `deep_research` | `performDeepSearch` (multi-query fan-out) |
| `image_search` | `searchImages` |
| `cricket_live_scores` | `cricketService.getLiveMatches` |
| `cricket_match_details` | `cricketService.getMatchDetails` |
| `astrology_chart` | `getAstrologyData` |

### Adding one

Add an entry to `TOOL_CATALOG` with a `schema` (OpenAI function format) and a
`run(args)` that returns a string. `executeTool` handles the rest: argument
parsing, validation errors, timeouts, truncation, and logging. Write the
`description` for the model, not for a developer — it is the only thing the
model reads when deciding whether the tool applies.

---

## Guardrails

Everything here exists because an unbounded loop is a way to burn a user's
latency budget and your API quota at the same time.

- **Step cap** — `TOOL_LOOP_MAX_STEPS` (default 3). A model that keeps asking
  for tools is cut off.
- **Wall-clock budget** — `TOOL_LOOP_BUDGET_MS` (default 25s), checked before
  each planner call.
- **Per-tool timeout** — declared per entry, cleared when the tool settles.
- **Calls per step** — at most 4.
- **Duplicate suppression** — an identical `tool:args` call within one request
  is served from cache instead of re-running.
- **Observation truncation** — 6000 chars per observation. They are re-sent on
  every subsequent step, so an unbounded one blows the context window by step 3.
- **Failures are observations, not exceptions.** A failed tool returns text the
  model reads and works around. It is shown in the `[TOOL RESULTS]` block marked
  `FAILED`, precisely so the model says the lookup did not work rather than
  quietly inventing the answer.

---

## When the loop does not run

It is skipped, and the old keyword path takes over unchanged, when:

- `TOOLS_ENABLED=false`.
- No configured provider can call tools. Only the OpenAI-compatible adapters
  (groq, mistral, sambanova, agnes, plugsky) can; gemini, the RapidAPI ChatGPT
  wrapper, and fable each speak their own shape.
- The turn is a greeting or an identity question ("who are you").
- The mode is `web_search`, `deep_search`, or `research` — those already have a
  fetch pipeline the user explicitly opted into, and running the loop as well
  would duplicate the lookups and let it veto a search that was asked for.
- The mode is `design`, which wants one HTML document and no detours.
- The user pinned Fable specifically.
- The planner call throws. The answer is still produced, without tool results.

Note that the planner and the answering model need not be the same provider. If
the user picked Gemini, the loop still runs on the best tool-capable provider
and hands the results to Gemini to write the reply — the lookups happen either
way.

---

## Configuration

```
TOOLS_ENABLED=true
TOOL_LOOP_MAX_STEPS=3
TOOL_LOOP_BUDGET_MS=25000
```

## Cost

The loop adds one model call for a turn that needs no tools (the planner
answering "SKIP"), and N+1 for a turn that uses N rounds. Planner calls are
capped at 800 output tokens and do not carry the full VetroAI system prompt,
so they are materially cheaper than an answer call. If that overhead is not
worth it on a given deployment, `TOOLS_ENABLED=false` restores the old path.

## What this is not

This makes VetroAI *agentic*, not intelligent beyond its providers. The ceiling
is still whichever upstream model serves the turn. The loop lets that model use
what it knows more effectively — it does not make it know more.

The next things that would move the needle, roughly in order of impact:

1. **Durable memory.** `SessionContextManager` is an in-process `Map`, wiped on
   restart and wrong across instances; user "memories" arrive from the client on
   each request. Nothing accumulates across sessions.
2. **A verifier pass.** Nothing currently checks whether the answer was right.
3. **Background tasks** that outlive the request and report back.
