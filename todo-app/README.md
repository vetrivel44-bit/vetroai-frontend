# To-Do List (Puter.js)

A single-page to-do list built on [Puter.js](https://docs.puter.com). There is
no backend and no API key: each visitor signs in with their own free Puter
account, and their tasks are saved in that account's key-value store
(`puter.kv`). An "Ask Claude" box sends questions to
`anthropic/claude-opus-5-5` through `puter.ai.chat`, billed to the visitor's
Puter account.

Everything is in `index.html`, which loads Puter.js from its CDN.

## Run it locally

Puter's sign-in popup needs a real origin, so serve the folder rather than
opening the file directly:

```sh
npx serve todo-app
```

Then open the address it prints.

## Deploy

Upload `index.html` to any static host (Cloudflare Pages, Netlify, GitHub
Pages, or Puter's own hosting).

Keep it on a different origin from the VetroAI web app. Puter.js saves its
sign-in token in the site's `localStorage`. When `VITE_PUTER_AUTH_TOKEN` is
set, VetroAI signs every visitor into one shared Puter account. On the same
origin this page would pick up that token, and every visitor would read and
write the same list.

## Using Puter.js from npm instead

In a bundled app (Vite, webpack, etc.), install the package and import it in
place of the `<script>` tag. The calls are unchanged:

```js
// npm install @heyputer/puter.js
import { puter } from "@heyputer/puter.js";

const response = await puter.ai.chat("Explain quantum computing in simple terms", {
  model: "anthropic/claude-opus-5-5",
});
console.log(response.message.content);
```
