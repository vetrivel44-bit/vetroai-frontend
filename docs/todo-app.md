# To-Do (Puter.js)

A to-do list at `/todo/` on the VetroAI site, linked from the sidebar under
Products. It's a standalone page in `frontend/public/todo/`, outside the React
app, built on [Puter.js](https://docs.puter.com). It needs no backend or API
key.

- **Saving.** Each visitor signs in with their own free Puter account. Tasks
  live in that account's key-value store (`puter.kv`), one key per task
  (`todo:<id>`).
- **Break into steps.** Claude (`anthropic/claude-opus-5-5`, via
  `puter.ai.chat`) splits a task into small steps, which appear under it with a
  progress count. Deleting a task deletes its steps.
- **Ask Claude.** A question box that streams Claude's answer. Markdown is
  escaped before it's shown.

Claude calls are billed to the visitor's Puter account, not VetroAI's.

## Why the page manages its own sign-in

Puter.js keeps one sign-in token per website in `localStorage`. When
`VITE_PUTER_AUTH_TOKEN` is set, VetroAI's chat stores a shared app-wide token
there, and every visitor uses that one account. If the to-do page used that
token, every visitor would read and write the same list.

So the page only trusts the token from its own "Sign in with Puter" step. It
keeps a copy under `vetroai.todo.puterToken`, and on load it switches Puter
back to that copy with `puter.setAuthToken()` if something else has replaced
it. `puter.auth.signIn()` always opens Puter's popup and returns the visitor's
own account, so a shared token already on the site is never picked up.

## Files

- `frontend/public/todo/index.html`: the page.
- `frontend/public/todo/todo-core.js`: logic with no page or Puter access
  (ordering, step parsing, safe Markdown), tested in
  `frontend/test/todoCore.test.js`.

## Using Puter.js from npm

The page loads Puter.js from its CDN because it has no build step. In a
bundled app the same calls work after an import:

```js
// npm install @heyputer/puter.js
import { puter } from "@heyputer/puter.js";

const response = await puter.ai.chat("Explain quantum computing in simple terms", {
  model: "anthropic/claude-opus-5-5",
});
console.log(response.message.content);
```
