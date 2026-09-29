# Connectors (Gmail, Google Drive, Google Calendar)

Connectors let a chat use the user's own apps: search and read email, draft
and send replies, find and read Drive files, and check or add calendar events.
Users connect them from **Connectors** in the sidebar.

## How it works

1. **Connecting** reuses Firebase's Google sign-in. A Google popup asks for the
   extra permission and returns an access token that lasts about an hour. The
   token stays in that browser tab (`sessionStorage`) and is only ever sent to
   Google's APIs, never to VetroAI's server.
2. **In a chat**, the backend tells the model which tools the user's connected
   apps offer (`backend/src/config/connectors.js`). When the model needs one, it
   ends its reply with a ```` ```connector ```` block holding a JSON call.
3. **The browser runs the call** against Google with the user's token
   (`frontend/src/connectors/google.js`), shows it as a step in the reply
   ("Searched Gmail for …"), adds the result to the conversation as a hidden
   message, and asks the model to carry on. The same answer continues, and it
   can take up to 6 steps per question.
4. **Anything that changes the account** (sending or drafting email, adding an
   event) waits for the user to press **Allow** on a card showing exactly what
   will happen. Nothing is sent or created before that.
5. **When the hour is up**, the step shows **Reconnect and continue**: one
   click, and Google doesn't ask again for permission it already has.

What a chat reads (an email, a file) goes to the AI model along with the
question, like anything the user types. Emails and files are treated as data:
the model is told never to follow instructions written inside them.

## Setup in Google Cloud (one time)

The popup uses the Firebase project's Google sign-in, so no new keys or
environment variables are needed. Google just has to allow the extra
permissions. In the [Google Cloud console](https://console.cloud.google.com/),
select the Firebase project **`vetroai`**, then:

1. **Turn on the APIs.** Go to *APIs & Services → Library* and enable
   **Gmail API**, **Google Drive API** and **Google Calendar API**. Until you
   do, a step fails with "The … API isn't turned on in VetroAI's Google Cloud
   project yet".
2. **Add the permissions.** Go to *Google Auth Platform → Data access → Add or
   remove scopes*, add these four, and save:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.compose`
   - `https://www.googleapis.com/auth/drive.readonly`
   - `https://www.googleapis.com/auth/calendar.events`
3. **Choose who can connect.** Under *Google Auth Platform → Audience*:
   - **Testing** (quickest): add up to 100 Google accounts as *test users*.
     Only they can connect; Google shows them a "Google hasn't verified this
     app" screen, where they press *Continue*.
   - **In production** (everyone): Google has to verify the app first. Gmail
     and Drive permissions are "restricted", so verification includes a
     security assessment and takes a few weeks.

Sign-in itself keeps working throughout. Only connecting apps needs these steps.

## Code

| Path | Purpose |
| --- | --- |
| `frontend/src/connectors/catalog.js` | The apps, their Google permissions and tools |
| `frontend/src/connectors/googleAuth.js` | Google popup, token storage and expiry, disconnect |
| `frontend/src/connectors/google.js` | The tools: Gmail, Drive and Calendar API calls |
| `frontend/src/connectors/runtime.js` | Finding a call in a reply, result messages, step labels |
| `frontend/src/connectors/prompt.js` | Copy of the backend's tool instructions, for browser models |
| `frontend/src/components/screens/ConnectorsHub.jsx` | The Connectors screen |
| `frontend/src/components/chat/visuals/ConnectorStep.jsx` | A step in a reply, plus the approval and reconnect cards |
| `backend/src/config/connectors.js` | Tool instructions added to the model's system prompt |

`frontend/src/App.jsx` runs the steps (`runConnectorStep`) and continues the
reply once a result is in. Tests: `frontend/test/connectors.test.js` and
`backend/test/connectors.test.js`; the backend test also keeps the two copies
of the tool instructions identical.

## Limits

- Google access lasts about an hour per browser tab, then needs the one-click
  Reconnect.
- Connectors work in the web app, not the desktop app, whose windows can't run
  Google's popup.
- A user who signed in with email and password links their Google account to
  their VetroAI account when they connect, and can then sign in with either.
