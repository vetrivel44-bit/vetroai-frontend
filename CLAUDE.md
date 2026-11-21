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

## Replies are shown the way Claude shows them (owner's standing request)

- **When to use what** is decided by `CHOOSING_THE_FORMAT` in
  `backend/src/services/AIOrchestrator.js` (Groq gets
  `CHOOSING_THE_FORMAT_SHORT`, because its prompt has to fit a ~5.7k-token
  budget, checked by `backend/test/groqPrompt.test.js`). Prose by default;
  lists, tables, headings and code only when the content has that shape.
- **Code:** a short snippet stays inline as a code card. A substantial block
  (`opensAsArtifact` in `frontend/src/App.jsx`: 20+ lines, or a full HTML/SVG
  page) shows as an `ArtifactCard` and opens in the side panel by itself,
  but only one per reply and never on a phone (≤760px), where it waits
  for a tap.
- **Look:** reply tables and the artifact card are styled in
  `frontend/src/styles/replyProse.css` (loaded last). The reply box is
  near-solid with a blur, and its dock fades the chat out under it
  (`styles/composer.css`).

## Plugins

- **Catalog:** `frontend/src/plugins/catalog.js` is the single registry (id,
  name, category, icon, keywords, skills with instructions, `/commands`,
  connectors, `live` source). Ids are stable; the backend keeps the same list
  in `backend/src/config/plugins.js` (`KNOWN_PLUGIN_IDS`), and
  `backend/test/plugins.test.js` fails if the two differ.
- **Search:** `searchPlugins` / `searchCommands` (fuzzy, all fields, most
  words must hit), tested in `frontend/test/pluginSearch.test.js`.
- **Runtime:** a message's plugins (chips from the @ menu, `/command`, typed
  `@name`, or trigger words) are sent as `plugins` + `pluginContext` (skill
  instructions); the backend bounds them and adds them to the system prompt.
- **Live data:** `backend/src/services/pluginLiveService.js` fetches real
  data before the model answers; which source runs is decided on the server
  by plugin id. A missing key gives the exact "<Plugin> isn't connected yet —
  add <ENV_VAR>" notice; never let a model invent scores or prices. Keys are
  backend environment variables only: `HIGHLIGHTLY_API_KEY` (sports, main),
  `CRICAPI_KEY` / `API_SPORTS_KEY` (fallbacks), `NEWS_API_KEY`,
  `ALPHAVANTAGE_API_KEY`. Weather, currency and crypto need no key.
