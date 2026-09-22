# Manual deploy checklist — PR #37

Everything in this branch, what it needs, and what to check after. Written for a
manual deploy, in the order the pieces depend on each other.

## 1. Backend first (Render) — required, not optional

The frontend on this branch calls a route the live backend does not have yet.
Deploy the backend **before** the frontend, or `/api/youtube/resolve` 404s and
YouTube quietly falls back to the old search-page behaviour.

Set these on the Render service (Environment → Environment Variables):

| Variable | Value | Notes |
|---|---|---|
| `COHERE_API_KEY` | your key | **Required** for the fallback to exist at all. Without it Cohere is simply "unconfigured" and the chain ends where it did before. |
| `COHERE_MODEL` | `command-r-plus-08-2024` | Optional, this is the default. |
| `COHERE_VISION_MODEL` | `command-a-vision-07-2025` | Optional, this is the default. Change it if your account exposes a different vision model. |

The key you pasted in chat is in `backend/.env` locally, which is gitignored and
was never committed. **Rotate it** in the Cohere dashboard — it has been in a
chat transcript.

Then deploy: push `main`, or hit the Render deploy hook, or click Manual Deploy.

Verify:

```bash
curl -s "https://ai-chatbot-backend-gvvz.onrender.com/api/youtube/resolve?q=test" | head -c 200
```

Expect `{"success":true,"data":{"videoId":...}}`. `success:false` means YouTube
refused the server (see Known risks).

## 2. Frontend (Cloudflare Pages)

No new variables. `VITE_API_BASE_URL` may be the bare origin or end in `/api` —
both now resolve correctly, which was the "Route not found: POST /chat" bug.

Deploy, then **hard-refresh** (Ctrl+Shift+R) — the old bundle is cached.

## 3. Desktop companion (optional, but the only way to test screen control)

Nothing about the web app depends on this. Screen control does.

```bash
git tag desktop-v1.0.0
git push origin desktop-v1.0.0
```

CI builds a Windows installer and a portable build and attaches them to a GitHub
Release. This workflow has never run — watch the first one in the Actions tab.
Windows will show a SmartScreen warning because the app isn't code-signed;
removing that needs a certificate (~$100–400/yr).

## Smoke test after deploying

| Check | Expected |
|---|---|
| Computer mode → "build me a portfolio website" | Builds and previews. Was 404 before. |
| Computer mode → "open ms word" | Explains it needs the desktop app, with a download link. |
| Computer mode → "open youtube and play a tamil song" | Confirm "Continue safely" → a tab opens on the **playing video**, not a search page. |
| Settings → Notifications / Data | Tabs present; export downloads JSON. |
| Chat with a Puter model out of credits | Falls through to the backend instead of erroring. |

## Known risks — read before deploying

- **The YouTube resolver scrapes YouTube.** No API key needed, but it depends on
  YouTube's page shape and could break without warning. Every failure path
  falls back to the search page, so it degrades rather than errors. It has never
  run against live YouTube — the dev container blocks it. **Verify with the curl
  above.** If YouTube rate-limits the server IP it will just keep returning
  `success:false`.
- **`command-a-vision-07-2025` is unverified on your account** for the same
  reason. If Cohere rejects the name, set `COHERE_VISION_MODEL` — no code change.
- **Screen control accuracy is unproven.** The coordinate pipeline is verified
  end to end (the marker lands at 0px offset), but whether Gemini picks *good*
  coordinates from a real screenshot has never been tested — that needs a real
  desktop.
- **The new Settings tabs are English-only**, including their bodies, while the
  rest of that modal translates. Not fixed rather than machine-translating
  user-facing copy.
- **Lint reports ~132 pre-existing errors**, nearly all unused vars in dead code.
  CI treats lint as advisory. This branch adds none (checked: zero `no-undef`).

## Rollback

Frontend: redeploy the previous deployment from the Cloudflare Pages dashboard.
Backend: redeploy the previous commit on Render. The new route is additive — it
is unreachable if the frontend rolls back, and nothing else depends on it.
