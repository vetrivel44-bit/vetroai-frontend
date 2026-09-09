# Firebase backend

VetroAI uses Firebase for two things:

- **Firebase Authentication** — Google Sign-in and email/password.
- **Cloud Firestore** — per-user chat sessions, projects (spaces) and artifacts.

Firebase project: **`vetroai`** (set in `.firebaserc`).

## Layout

| Path | Purpose |
| --- | --- |
| `frontend/src/firebase.js` | App initialisation; reads `VITE_FIREBASE_*` env vars |
| `frontend/src/lib/firebaseAuth.js` | Sign-in/out, auth state, ID tokens, error messages |
| `frontend/src/lib/firestoreStore.js` | Firestore reads/writes, debouncing, diffing |
| `frontend/src/lib/userStore.js` | Single write path: localStorage + Firestore |
| `frontend/src/components/auth/GoogleLoginButton.jsx` | Google sign-in button |
| `firestore.rules` | Security rules |
| `firebase.json` | Auth providers, authorized domains, Firestore config, emulators |

## Configuration

The web config values are **not secrets** — Google ships them in every client
bundle by design. What actually protects the project is `firestore.rules` plus
the Authentication *Authorized domains* list.

The `vetroai` web app config is therefore baked into `src/firebase.js` as the
default, so a plain `npm run build` works with no extra setup and deploys need
no environment wiring.

To point a build at a **different** Firebase project, set all of these (they
override the defaults individually, so provide the full set):

```dotenv
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
```

Fetch another project's values with:

```bash
npx -y firebase-tools@latest apps:sdkconfig WEB --project <project-id>
```

Vite inlines these at build time, so they must be present in the build
environment, not just at runtime.

## Data model

Everything is scoped under the signed-in user's uid, so a single rule —
*you may only touch your own subtree* — covers all of it:

```
users/{uid}                    profile { uid, email, name, picture, createdAt, lastLoginAt }
users/{uid}/sessions/{id}      one chat conversation
users/{uid}/spaces/{id}        one project / space
users/{uid}/artifacts/{id}     one saved artifact
users/{uid}/prefs/app          { current_space }
```

### How writes work

The app holds sessions/spaces/artifacts as arrays in React state and re-persists
the whole array on every change — including on every streamed chunk. Mirroring
that straight to Firestore would mean thousands of writes per conversation, so
`firestoreStore.js`:

1. writes to **localStorage synchronously** (instant reloads; works offline and
   signed out),
2. **debounces** the Firestore write by 1.5s, and
3. **diffs** against the last synced state, writing only documents whose content
   changed and deleting ids that disappeared,
4. **flushes** pending writes on sign-out and when the page is hidden.

On sign-in, `hydrateFromFirestore` merges the server copy with whatever is
cached on the device — remote wins on conflict, and anything local-only is
pushed up. That means data created before this device had a Firebase account,
or while it was offline, migrates rather than being dropped.

## Deploying config

```bash
# Auth providers + authorized domains (from firebase.json)
npx -y firebase-tools@latest deploy --only auth --project vetroai

# Security rules
npx -y firebase-tools@latest deploy --only firestore:rules --project vetroai
```

`deploy --only auth` is what auto-generates the Google Sign-in OAuth client, so
run it after changing the `auth` block.

## Authorized domains

Google sign-in fails with `auth/unauthorized-domain` from any origin not on the
list. The list lives in two places and **both must be updated** — `firebase.json`
here (config as code, applied by `deploy --only auth`) and
[Authentication → Settings → Authorized domains](https://console.firebase.google.com/project/vetroai/authentication/settings)
in the console. Hostname only, no scheme or port.

This app is served from more than one place, so the list covers all of them:

| Origin | Source |
| --- | --- |
| `localhost` | local dev |
| `vetroai.firebaseapp.com`, `vetroai.web.app` | Firebase Hosting (unused, auto-added) |
| `vetroai.netlify.app` | Netlify project `vetroai` |
| `vetroai-frontend.vel21873.workers.dev` | Cloudflare Workers |
| `vetroai-frontend.pages.dev` | Cloudflare Pages project `vetroai-frontend` |

Netlify and Cloudflare Pages build straight from the repo via their Git
integrations, separately from `.github/workflows/deploy.yml`, which is why they
are easy to miss.

**Preview deployments will not have working Google sign-in.** Netlify and
Cloudflare mint a fresh hostname per commit and per branch
(`deploy-preview-23--vetroai.netlify.app`,
`claude-confident-curie-tllvk4-vetroai-frontend.vel21873.workers.dev`, …), and
Firebase authorized domains do not support wildcards. Either add a specific
preview host while testing it, or test sign-in on localhost and production only.

## Local emulators

```bash
npx -y firebase-tools@latest emulators:start --project vetroai
```

Auth on `:9099`, Firestore on `:8080`. To point the app at them, connect in
`src/firebase.js` behind a `localhost` check (see `connectAuthEmulator` /
`connectFirestoreEmulator`).

## App Check

Off by default. It attests that traffic comes from your real app, closing the
gap that your API key is public and anyone can call your project's endpoints
with it.

To enable: Firebase Console → App Check → register the web app with
**reCAPTCHA v3** → set `VITE_FIREBASE_APPCHECK_SITE_KEY` and rebuild.
`src/firebase.js` initialises it automatically when the key is present.

Two things that will bite otherwise:

- **Deploy with the key before enabling enforcement.** Turning enforcement on
  while any live client lacks a valid App Check token locks that client out.
  Ship it, watch the App Check metrics until requests show as verified, then
  enforce.
- **Local development needs a debug token.** reCAPTCHA cannot attest
  `localhost`. In dev builds the SDK is asked for a debug token and prints it to
  the browser console; register it under App Check → Manage debug tokens.

## The Express backend

`backend/` verifies Firebase ID tokens, so the frontend's Firebase session
authenticates against it directly. `src/middleware/authMiddleware.js` routes a
bearer token to one of four verifiers, by shape:

| Token | Verified by |
| --- | --- |
| `local_*` | Offline fallback, synthetic user |
| Google GIS ID token | `google-auth-library`, against `googleClientId` |
| **Firebase ID token** | `src/utils/firebaseToken.js` |
| Backend JWT | `src/utils/token.js` |

`verifyFirebaseIdToken` deliberately does **not** use `firebase-admin`. The
Admin SDK needs a service-account credential provisioned as a deployment secret
and pulls in a large dependency tree, to do what is a standard RS256
verification against a published key set. Google documents this manual path
("verify ID tokens using a third-party JWT library"), and it needs only the
project id, which is public and travels in the token as `aud`.

It verifies the signature against Google's rotating x509 certificates (cached
per the `Cache-Control` the certificate endpoint returns, refetched on a key-id
miss) and checks the algorithm is RS256, the audience is the project, the issuer
is `https://securetoken.google.com/<projectId>`, the token is unexpired, and
`sub` is present. `sub` is the Firebase uid.

The one capability given up is revocation checking: a token stays valid until it
expires, at most an hour, even if the session is revoked server-side. That
matches how the pre-existing Google-token path behaved.

Configure with `FIREBASE_PROJECT_ID` (defaults to `vetroai`).

A signed-in user is matched to a local `User` record by email when one exists,
so billing and cloud sessions resolve to the same account regardless of which
token type authenticated the request; otherwise the Firebase uid is the identity
of record.

## Verification

Both the rules and the token verifier were tested against the live project
rather than reviewed by eye.

**Security rules** — two throwaway accounts, 12 assertions: a user can read and
write its own profile, sessions and prefs; cannot read, write or delete another
user's; unauthenticated access is refused; and the integrity constraints hold
(a document whose `id` disagrees with its path, a `uid` rewritten to another
user's, and a `messages` field that is not a list are all rejected).

That run found a real bug: `prefs` used a blanket `allow write` gated on
`withinSizeLimit()`, and on a delete there is no `request.resource`, so the size
check evaluated against null and denied. The owner could not delete their own
prefs document. Now split into `create, update` and `delete`.

**Token verifier** — 10 assertions against a real Firebase ID token: it
verifies and yields the right uid and audience, while a tampered payload, a
replaced signature, an `alg: none` downgrade, and an unknown key id are all
rejected.

`backend/test/authMiddleware.test.js` carries the offline half of that as
permanent regression tests.
