# Working process panel

A "Thinking…" spinner tells the user that something is happening, but not
*what*. When VetroAI searches the web, falls back from a rate-limited provider,
or answers a question about an image it never found, none of that reaches the
person waiting — so a slow or wrong answer looks arbitrary.

The working process panel shows the turn as it happens: each thing the backend
actually did, in order, with the model's chain of thought as one entry among
them rather than the only one.

```
✦ Worked for 9s · 6 steps
  ◎ Analyzed your request       0.1s   Answering with Groq, plus live web search.
  ⊕ Read 5 web sources          1.3s   → the pages, as links
  ⊞ Found 4 related images      0.9s
  ✕ Groq failed                 0.5s   Groq is rate limited right now.
  ⚇ Mistral answered            7.1s
  ⌾ Thought it through          4.2s   → the reasoning text
```

## Where the pieces live

| Path | Purpose |
| --- | --- |
| `backend/src/services/AIOrchestrator.js` | `sendStep()` and the call sites that report each stage |
| `frontend/src/utils/processSteps.js` | Merges incoming step events into the timeline |
| `frontend/src/components/ProcessPanel.jsx` | The panel itself |
| `frontend/src/components/ProcessPanel.css` | Its styling |

## The `step` event

Steps travel on the existing `/api/chat` SSE stream alongside `content`,
`reasoning` and `status`:

```json
{ "type": "step", "data": {
  "id": "search",
  "label": "Read 5 web sources",
  "state": "done",
  "ts": 1788973096831,
  "ms": 1280,
  "detail": "These pages were passed to the model as context.",
  "items": [{ "label": "ISRO mission updates", "url": "https://…" }]
} }
```

| Field | Meaning |
| --- | --- |
| `id` | Stable key. Re-sending the same id **updates that row in place** — that is how a row moves from running to done. Provider attempts are numbered (`model-1`, `model-2`) so a fallback shows both rows. |
| `label` | The one line the row shows. Written for the user, not the log. |
| `state` | `running`, `done`, `failed` or `skipped`. |
| `ts` | Backend clock; the panel derives the "Worked for Ns" span from the first and last. |
| `ms` | Optional duration for that step. |
| `detail` | Optional sentence the row expands into. |
| `items` | Optional `{ label, url }` list, capped at 8 — used for the sources a search actually read. |

Fields other than `id`, `label`, `state` and `ts` are omitted when empty rather
than sent blank.

## Adding a step

Report a stage where the user would otherwise be guessing — a lookup, a
fallback, a decision that changes the answer. Open it before the work and close
it after, on both paths:

```js
const startedAt = Date.now();
this.sendStep(res, "prices", "Checking live prices", "running");
try {
  …
  this.sendStep(res, "prices", "Checked 3 exchanges", "done", { ms: Date.now() - startedAt, items });
} catch (err) {
  this.sendStep(res, "prices", "Price lookup failed", "failed", {
    ms: Date.now() - startedAt,
    detail: `${err.message} — answering from the model's own knowledge instead.`,
  });
}
```

Two rules keep the panel honest:

- **Every opened step is closed.** `sendStep` refuses to write once the response
  has ended, and the frontend settles anything still running when the stream
  finishes, so a dead stream cannot leave a row spinning — but neither is a
  substitute for reporting the real outcome.
- **A failed step says what it cost the answer.** "Web search failed" on its own
  invites the reader to distrust the whole reply; naming the fallback tells them
  exactly how much to discount it.

A backend that emits no steps at all still works: the panel falls back to the
plain chain-of-thought view it replaced.
