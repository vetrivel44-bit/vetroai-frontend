# Deploying

Pushes to `main` deploy automatically via `.github/workflows/deploy.yml`.
Everything else runs tests only, via `.github/workflows/ci.yml`.

## What happens on a push to `main`

1. **Tests and build** — backend tests, frontend tests, then a production build.
   Nothing deploys unless all three pass.
2. **Frontend → Cloudflare Workers** — `wrangler deploy`, using the existing
   `wrangler.jsonc` (it already declares the build command and `frontend/dist`
   as the assets directory).
3. **Backend → Render** — calls Render's deploy hook, which tells Render to
   build and roll out from its own copy of the repo.

Steps 2 and 3 run in parallel and are independent: a Cloudflare failure does not
block Render, or the reverse.

## Required secrets

Add these under **Settings → Secrets and variables → Actions**. Until a secret
is present its deploy step is **skipped, not failed**, so the workflow stays
green while you set them up.

| Secret | Used for | Where to get it |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Frontend deploy | Cloudflare dashboard → My Profile → API Tokens → Create Token → *Edit Cloudflare Workers* template |
| `CLOUDFLARE_ACCOUNT_ID` | Frontend deploy | Cloudflare dashboard → Workers & Pages → Account ID in the right sidebar |
| `RENDER_DEPLOY_HOOK_URL` | Backend deploy | Render dashboard → your service → Settings → Deploy Hook → Copy |

## If Cloudflare or Render already auto-deploys from Git

Both platforms can watch the repo themselves. If you have that switched on,
leaving the matching secret unset here avoids deploying the same commit twice —
the step will simply skip.

## Running a deploy by hand

The **Deploy** workflow has `workflow_dispatch` enabled, so you can run it from
the Actions tab against any branch without pushing.

## Lint

`npm --prefix frontend run lint` currently reports roughly 80 findings, almost
all unused variables in dead code. CI runs it for visibility but does not fail
on it, so the backlog does not block deploys. Once it is cleared, drop the
`continue-on-error: true` from `.github/workflows/ci.yml`.

## Usage limits (Settings → Usage)

The backend counts every message per account (or per visitor IP when signed
out) in a 5-hour session window and a 7-day weekly window, with a separate
weekly cap for the most capable models. Limits and model weights live in
`backend/src/config/usageLimits.js`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `MONGO_URI` | unset | When set, usage is stored in MongoDB: it survives redeploys and every instance agrees. |
| `USAGE_STORE_FILE` | OS temp dir | Without MongoDB, usage is kept in memory and saved to this JSON file. It survives restarts, but not a fresh disk (a Render redeploy). A signed-in person's usage is also saved to their own Firestore space (`users/{uid}/prefs/usage`, written with their sign-in token), so it comes back after a redeploy. Visitors who aren't signed in start again. |
| `TRUST_PROXY_HOPS` | `1` | Proxies in front of the app (Render has one), so visitor IPs — for usage and rate limits — are the real client address. |

## Published websites (Computer → Publish)

A website built in VetroAI Computer can be published to a link such as
`https://<your site>/s/sneaker-store-k3x9q2`. The page is stored in Firestore
(`sites/{id}`): anyone with the link can open it, nobody can list them, and only
the signed-in owner can change or remove theirs. It runs in a sandboxed frame, so
it can't read VetroAI's storage or the visitor's account.

This needs the `sites` rules in `firestore.rules`, which are not deployed by CI.
Deploy them once (and after any change to `firestore.rules`):

```
npx firebase-tools login
npx firebase-tools deploy --only firestore:rules --project vetroai
```

Until then, Publish says publishing isn't switched on yet.

## Dispatch (Computer → Dispatch)

Send a task from your phone, and VetroAI does it on your computer. The phone
writes the request to Firestore (`users/{uid}/dispatch`); a computer with VetroAI
open in Computer and **Accept tasks** on (the desktop app, or any desktop
browser for tasks that don't need the mouse and keyboard) says it's online
(`users/{uid}/devices`), takes requests one at a time, runs each as a normal
Computer task, and writes its progress and result back. Tasks that may send,
buy, post or open something ask for an OK on the phone first, and mouse and
keyboard tasks run only while screen control is already allowed on the
computer — Dispatch never pops the "allow control?" dialog with nobody there.

Nothing goes through the backend, but it needs the `dispatch` and `devices`
rules in `firestore.rules` — deploy them as for Publish above. Until then,
Dispatch says it isn't switched on yet.

**Connecting a phone.** On the computer, open Computer → Dispatch and click
**Connect phone**: it turns on Accept tasks and shows a QR code. Scanning it
opens VetroAI on the phone straight in Dispatch, aimed at that computer (sign
in with the same account if asked). The computer shows "phone connected" when
it does, and lists the phone so it can be forgotten later.

**Rules deploy from CI.** The Deploy workflow's *Deploy Firestore rules* job
publishes `firestore.rules` on every push to `main` once the repository secret
`FIREBASE_SERVICE_ACCOUNT` holds a service account key (Firebase console →
Project settings → Service accounts → Generate new private key; the account
needs the *Firebase Rules Admin* role). Without the secret the job skips with a
notice and the manual command above still works.

## Scheduled tasks (Computer → Scheduled)

"Every morning at 8, send me today's top news", "Tell me when the iPhone 17 drops
below ₹70,000": each run searches the web, a model writes the update (or checks
the condition), and the result waits in the user's Scheduled inbox — and in their
email when email is set up. A watched condition stops once it comes true.

| Setting | Where | What it does |
| --- | --- | --- |
| `MONGO_URI` | Render | **Required** for scheduled tasks to survive restarts and a sleeping free instance. Without it they are kept in memory only, and the app says so. |
| `CRON_SECRET` | Render **and** GitHub repository secret | A long random string. `.github/workflows/scheduled-tasks.yml` calls `POST /api/schedules/run-due` with it every 10 minutes and runs what is due. The same workflow pings `/api/health` every 10 minutes even without this secret, so the free Render instance stays awake and a chat never waits for it to start. |
| `BACKEND_URL` | GitHub repository secret (optional) | The backend's address, if it isn't `https://ai-chatbot-backend-gvvz.onrender.com`. |
| `RESEND_API_KEY`, `MAIL_FROM` | Render (optional) | Email each result (resend.com; `MAIL_FROM` must be on a domain verified there, e.g. `VetroAI <tasks@yourdomain.com>`). |

A user can have 10 scheduled tasks running at once; the shortest interval is one hour.

## Sarvam AI (Sarvam 105B, Sarvam 105B Chat)

[Sarvam AI](https://www.sarvam.ai)'s models, strong in Hindi, Tamil and the other
Indian languages, appear in the model picker as **Sarvam 105B** (`sarvam-105b`)
and **Sarvam 105B Chat** (`sarvam-105b-conversations`, tuned for quick
back-and-forth with a 32K context). Both use the same key. (Sarvam retired
`sarvam-30b` in October 2026; if Sarvam retires a model, the adapter switches to
the replacement Sarvam names in its error.) They run on the backend
(`backend/src/providers/sarvamAdapter.js`), so the key never reaches the browser.

| Variable | Where | Value |
|---|---|---|
| `SARVAM_API_KEY` | Render | The API subscription key from the Sarvam dashboard. Without it, picking a Sarvam model is answered by the next available provider. |
| `SARVAM_MODEL` | Render (optional) | Model used when Sarvam is reached without a size chosen. Default `sarvam-105b`. |

## Groq models (chat, titles, images, courses)

Groq retires models often (qwen3-32b and llama-4-scout in July 2026,
llama-3.3-70b in August). When a configured model is gone, the backend asks
Groq which models the account has and switches on its own, so nothing breaks;
these settings only choose what is used first. Each Groq model has its own
per-minute token limit (about 8k on the current models), which is why side
jobs and courses use more than one.

| Variable | Default | Used for |
|---|---|---|
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Chat, when Groq is picked or reached as a fallback. If it is still set to `llama-3.3-70b-versatile` on Render, remove it or change it. |
| `GROQ_TITLE_MODEL` | `qwen/qwen3.8-27b` | Chat titles, with reasoning off, so they don't use the chat model's limit. |
| `GROQ_FOLLOWUP_MODEL` | `qwen/qwen3.8-27b` | Suggested follow-up questions, the same way. |
| `GROQ_VISION_MODEL` | `qwen/qwen3.8-27b` | Reading images when Cohere can't: the third vision provider after Gemini and Cohere. Only a model that reads images ever stands in for it. |
| `GROQ_COURSE_MODELS` | `openai/gpt-oss-120b,qwen/qwen3.8-27b` | Courses written on Groq: chapters alternate between these, one at a time on each, so two models write about twice as fast as one. |
| `GROQ_REQUEST_TOKEN_BUDGET` | `7800` | The most a single Groq request sends (prompt plus reply). Raise it for an account with higher limits. |

`qwen/qwen3.8-27b` is a Groq *preview* model and may be withdrawn at short
notice; titles, follow-ups and courses then move to another model, and images
go to the next vision provider.
