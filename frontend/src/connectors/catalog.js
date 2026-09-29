// Apps VetroAI can use for the user in a chat, the Google permissions each one
// asks for, and the tools it gives the model. A tool marked `write` changes the
// user's account, so the chat shows the exact action and waits for approval.

export const GOOGLE_SCOPES = {
  gmailRead: "https://www.googleapis.com/auth/gmail.readonly",
  gmailCompose: "https://www.googleapis.com/auth/gmail.compose",
  driveRead: "https://www.googleapis.com/auth/drive.readonly",
  calendarEvents: "https://www.googleapis.com/auth/calendar.events",
};

export const CONNECTORS = [
  {
    id: "gmail",
    name: "Gmail",
    provider: "google",
    tagline: "Search, read and draft emails",
    description: "Ask about your inbox, summarise threads, find attachments, and draft or send replies.",
    permissions: ["Search and read your email", "Draft and send email, only after you approve each one"],
    scopes: [GOOGLE_SCOPES.gmailRead, GOOGLE_SCOPES.gmailCompose],
    examples: ["Summarise my unread emails from today", "Draft a reply to the last email from my manager"],
  },
  {
    id: "drive",
    name: "Google Drive",
    provider: "google",
    tagline: "Find and read your files",
    description: "Search your Docs, Sheets, Slides and PDFs and answer questions about what's in them.",
    permissions: ["Search and read your files (read-only)"],
    scopes: [GOOGLE_SCOPES.driveRead],
    examples: ["Find my physics notes and quiz me on them", "What does the budget sheet say about October?"],
  },
  {
    id: "calendar",
    name: "Google Calendar",
    provider: "google",
    tagline: "Check and add events",
    description: "See what's coming up, find free time, and add events to your calendar.",
    permissions: ["See your events", "Add events, only after you approve each one"],
    scopes: [GOOGLE_SCOPES.calendarEvents],
    examples: ["What's on my calendar this week?", "Add a study session tomorrow at 5 pm"],
  },
];

export const CONNECTORS_BY_ID = Object.fromEntries(CONNECTORS.map((c) => [c.id, c]));

export const TOOLS = {
  gmail_search: { connector: "gmail", scopes: [GOOGLE_SCOPES.gmailRead] },
  gmail_read: { connector: "gmail", scopes: [GOOGLE_SCOPES.gmailRead] },
  gmail_draft: { connector: "gmail", scopes: [GOOGLE_SCOPES.gmailCompose, GOOGLE_SCOPES.gmailRead], write: true },
  gmail_send: { connector: "gmail", scopes: [GOOGLE_SCOPES.gmailCompose, GOOGLE_SCOPES.gmailRead], write: true },
  drive_search: { connector: "drive", scopes: [GOOGLE_SCOPES.driveRead] },
  drive_read: { connector: "drive", scopes: [GOOGLE_SCOPES.driveRead] },
  calendar_events: { connector: "calendar", scopes: [GOOGLE_SCOPES.calendarEvents] },
  calendar_create_event: { connector: "calendar", scopes: [GOOGLE_SCOPES.calendarEvents], write: true },
};

// Every Google permission the given connectors need, for one sign-in popup.
export function scopesFor(connectorIds) {
  return [...new Set(connectorIds.flatMap((id) => CONNECTORS_BY_ID[id]?.scopes || []))];
}

// Saved per user: { gmail: { connected, enabled, account, connectedAt } }.
// `enabled` is the "use in chats" switch; a connected app can be paused.
export function activeConnectorIds(state) {
  return CONNECTORS.filter((c) => state?.[c.id]?.connected && state[c.id].enabled !== false).map((c) => c.id);
}

export function connectedIds(state) {
  return CONNECTORS.filter((c) => state?.[c.id]?.connected).map((c) => c.id);
}
