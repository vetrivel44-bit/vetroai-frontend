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
