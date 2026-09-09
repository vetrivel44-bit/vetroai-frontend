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

The web config values are **not secrets** — Google documents them as publicly
shippable. What actually protects the project is `firestore.rules` plus the
Authentication *Authorized domains* list.

Fetch the values and write them into `frontend/.env.local`:

```bash
npx -y firebase-tools@latest apps:sdkconfig WEB --project vetroai
```

```dotenv
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
```

`authDomain`, `projectId` and `storageBucket` fall back to the `vetroai`
defaults baked into `src/firebase.js`, so only the three above are required.

For production builds, set the same variables in the build environment
(Cloudflare Pages / Wrangler), since Vite inlines them at build time.

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
list in `firebase.json`. Add production hostnames there, **without** protocol or
port (`app.example.com`, not `https://app.example.com:443`), then redeploy auth.

## Local emulators

```bash
npx -y firebase-tools@latest emulators:start --project vetroai
```

Auth on `:9099`, Firestore on `:8080`. To point the app at them, connect in
`src/firebase.js` behind a `localhost` check (see `connectAuthEmulator` /
`connectFirestoreEmulator`).

## Note on the Express backend

`frontend` now treats Firebase as the source of auth truth. The token cached in
`localStorage.token` is a **Firebase ID token**, not the previous backend JWT.

The Express backend under `backend/` still issues and verifies its own JWTs, so
its authenticated routes (for example `/billing/me`) will reject the Firebase
token until it verifies Firebase ID tokens instead — via `firebase-admin`'s
`verifyIdToken`. The client tolerates this: a 401 from the billing endpoint is
ignored rather than treated as a signed-out session.
