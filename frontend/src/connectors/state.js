// Which apps a user connected, kept on this device per account:
// { gmail: { connected: true, enabled: true, account: "me@gmail.com", connectedAt } }
// The Google access token itself is not stored here (see googleAuth.js).

const storageKey = (userKey) => `vetroai_connectors_${userKey}`;

export function loadConnectorState(userKey) {
  if (!userKey) return {};
  try {
    const state = JSON.parse(localStorage.getItem(storageKey(userKey)) || "{}");
    return state && typeof state === "object" && !Array.isArray(state) ? state : {};
  } catch {
    return {};
  }
}

export function saveConnectorState(userKey, state) {
  if (!userKey) return;
  try { localStorage.setItem(storageKey(userKey), JSON.stringify(state)); } catch { /* storage full or blocked */ }
}
