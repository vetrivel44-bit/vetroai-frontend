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

## Scheduled tasks (Computer → Scheduled)

"Every morning at 8, send me today's top news", "Tell me when the iPhone 17 drops
below ₹70,000": each run searches the web, a model writes the update (or checks
the condition), and the result waits in the user's Scheduled inbox — and in their
email when email is set up. A watched condition stops once it comes true.

| Setting | Where | What it does |
| --- | --- | --- |
| `MONGO_URI` | Render | **Required** for scheduled tasks to survive restarts and a sleeping free instance. Without it they are kept in memory only, and the app says so. |
| `CRON_SECRET` | Render **and** GitHub repository secret | A long random string. `.github/workflows/scheduled-tasks.yml` calls `POST /api/schedules/run-due` with it every 15 minutes, which wakes the backend and runs what is due. |
| `BACKEND_URL` | GitHub repository secret (optional) | The backend's address, if it isn't `https://ai-chatbot-backend-gvvz.onrender.com`. |
| `RESEND_API_KEY`, `MAIL_FROM` | Render (optional) | Email each result (resend.com; `MAIL_FROM` must be on a domain verified there, e.g. `VetroAI <tasks@yourdomain.com>`). |

A user can have 10 scheduled tasks running at once; the shortest interval is one hour.
