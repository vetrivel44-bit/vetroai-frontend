# VetroAI — notes for Claude

## Replies must never stop because of a timeout (owner's standing rule)

VetroAI runs on the web and has to finish every answer, however long, the way
ChatGPT and Claude do. The owner has asked that timeout problems never come
back. Any change to the chat path (backend `src/services/AIOrchestrator.js`,
`src/providers/*`, `src/services/councilService.js`, frontend `App.jsx`
streaming) must keep these rules:

1. **Only the wait for a reply to *start* is timed.** Never put
   `AbortSignal.timeout()` (or any total timer) on a *streamed* fetch: it also
   aborts the body and cuts the answer off mid-way. Use `startTimeout()` from
   `backend/src/utils/withTimeout.js` and call `started()` once headers arrive.
   Non-streamed requests (ChatGPT, Fable) get a long total limit (180s).
2. **A stream is only stopped for total silence**: the idle watchdog in
   `pipeStream` (120s default, 180s for AI Router). Don't lower it.
3. **A long answer is continued, never truncated.** When a reply reaches its
   token limit (`wasCutOff`), the same model continues it from where it
   stopped, in every mode, up to `MAX_CONTINUATIONS` (12) parts. Continuations
   don't use up the tries kept for errors.
4. **A half-written answer is never erased.** If a stream breaks after some
   text, the next try (same model, or the next one in Auto) is given the
   text so far and continues it (`resumeText` + `CONTINUE_PROMPT`).
5. **Keep the SSE heartbeat** (`: ping` every 12s in the controllers) so
   proxies and the browser don't drop a long, quiet request.
6. Current limits: reply start 90s (vision 150s, AI Router 180s, Sarvam 75s),
   retry budget for a picked model 10 min, council member 45s / council 75s.
   Raise them if needed; don't lower them without the owner asking.

Tests that guard this: `backend/test/sarvamAdapter.test.js` ("continued until
it's finished", "continued by the next model, not erased"),
`backend/test/council.test.js`, `backend/test/airouterAdapter.test.js`.
Run `cd backend && npm install && node --test`.
