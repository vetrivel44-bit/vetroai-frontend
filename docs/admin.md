# Admin page

`https://<your site>/admin` is VetroAI's control room. Only admin accounts can
open it. From there you can:

- **See every user**: search by email, check who's new and who's active, and see
  how many chats each person has saved.
- **Block and unblock** a user. A blocked user sees a "suspended" screen, the
  server refuses their requests and Firestore refuses their data. Unblocking
  restores everything, because nothing is deleted.
- **Warn** a user with a message they see as a banner.
- **See where any account is signed in**: browser, system, IP address, and when
  it was first and last used. This includes your own account, under *Overview →
  See where I'm signed in*.
- **Sign an account out everywhere** and **turn its sign-in off or on**. These
  need the service account (step 3).
- **Block IP addresses**. This also needs the service account.
- **Open a user's chats for a legal request**. You must enter who is asking, the
  order or notice number and what it covers, and tick a confirmation. The look
  is logged, and you can download the chats as JSON.
- **App controls**: an announcement banner for everyone, and maintenance mode,
  which closes VetroAI to everyone except admins.
- **Audit log**: every admin action, with who did it and why. Nobody can edit
  or delete it from the app.

## Setup (once)

### 1. Deploy the security rules

The admin page and blocking are enforced by `firestore.rules`, and CI does not
deploy them:

```
npx firebase-tools login
npx firebase-tools deploy --only firestore:rules --project vetroai
```

Run this again after any change to `firestore.rules`.

### 2. Make yourself an admin

1. Firebase console → **Authentication → Users**. Find your account and copy
   its **User UID**.
2. Firebase console → **Firestore Database → Start collection**. Collection ID:
   `admins`. Document ID: *your UID*. Add one field, for example
   `note` (string) = `owner`. Save.
3. Open `/admin` and sign in with that account.

Admins can only be added or removed here, in the console. Keep the list short,
and turn on 2-step verification for every admin's Google account.

### 3. Service account (recommended)

Turning sign-in off, signing out everywhere, and IP blocking act on Firebase
itself, so the server needs a service account:

1. Firebase console → **Project settings → Service accounts → Generate new
   private key**. A JSON file downloads.
2. Render → your backend service → **Environment** → add
   `FIREBASE_SERVICE_ACCOUNT` with the whole contents of that file as the value.
   Base64 of the file also works.
3. Save. Render redeploys, and *Overview → Server* shows the service account as
   set.

Treat that file like a password. Never commit it or paste it into chat.

### 4. Set real JWT secrets

In Render → Environment, set `JWT_SECRET` and `JWT_REFRESH_SECRET` to long
random values. While the public default is in place, the server refuses its own
login tokens. Signing in with Firebase, which is what the app uses, is not
affected.

## How blocking is enforced

| Layer | What it does |
| --- | --- |
| App (`ModerationGate.jsx`) | Shows the suspended screen live, the moment you block. |
| Server (`authMiddleware.js`) | Refuses the account's requests within a minute (it caches the lookup). |
| Firestore rules | Refuse the account's reads and writes of its own data, and publishing. |
| Firebase sign-in (optional) | *Turn sign-in off* stops the account signing in at all. |
| IP block (optional) | Stops the address entirely, signed in or not, so a blocked person can't simply keep using VetroAI signed out. |

If Firestore can't be reached, the server lets requests through rather than
locking everyone out. The Firestore rules still apply.

## Legal requests

Act only on a written order or notice from an authorised agency. Check that it
is genuine by calling the agency on its official number. Share only what it
asks for. The chat viewer records each request in the audit log. Chats that a
user deleted, or that were never saved to the cloud, can't be recovered. This
is practical guidance, not legal advice.
