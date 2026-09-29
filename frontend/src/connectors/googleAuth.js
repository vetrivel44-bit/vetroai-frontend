// Google access for connectors. VetroAI signs people in with Firebase, which
// already talks to Google, so connecting Gmail, Drive or Calendar reuses it: a
// Google popup asks for the extra permission and hands back an access token
// that lasts about an hour. The token stays in this browser tab
// (sessionStorage) and is only ever sent to Google's own APIs. When it runs
// out, the chat offers "Reconnect": one click, and Google doesn't ask again
// for permission it already has.

import { GoogleAuthProvider, linkWithPopup, reauthenticateWithPopup } from "firebase/auth";
import { auth } from "../firebase.js";

const TOKEN_KEY = "vetroai_google_connector_token";
// Treat a token as expired a minute early, so a tool call can't start on a
// token that runs out halfway through.
const EARLY_EXPIRY_MS = 60 * 1000;

export class GoogleConnectError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GoogleConnectError";
    this.code = code;
  }
}

function saveToken(record) {
  try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify(record)); } catch { /* storage blocked */ }
}

export function forgetGoogleToken() {
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ }
}

// The saved token, if it belongs to whoever is signed in now.
export function readGoogleToken() {
  try {
    const record = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || "null");
    if (!record?.token || !auth?.currentUser || record.uid !== auth.currentUser.uid) return null;
    return record;
  } catch {
    return null;
  }
}

// A token that is still valid and covers `scopes`, or null.
export function googleTokenFor(scopes = []) {
  const record = readGoogleToken();
  if (!record || record.expiresAt - EARLY_EXPIRY_MS < Date.now()) return null;
  return scopes.every((scope) => record.scopes.includes(scope)) ? record : null;
}

// Connecting needs a Firebase account (not offline mode) and a real browser:
// the desktop app's windows can't run Google's popup.
export const canConnectGoogle = () => Boolean(auth?.currentUser) && !(typeof window !== "undefined" && window.vetroDesktop);

// How the user signed in: a Google account, or email and password (in which
// case connecting links that Google account to their VetroAI account).
export const signedInWithGoogle = () => Boolean(auth?.currentUser?.providerData?.some((p) => p.providerId === "google.com"));

async function tokenInfo(token) {
  try {
    const res = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(token)}`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function describeError(err, email) {
  switch (err?.code) {
    case "auth/popup-blocked":
      return new GoogleConnectError("popup_blocked", "Your browser blocked the Google window. Allow pop-ups for VetroAI, then try again.");
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
    case "auth/user-cancelled":
      return new GoogleConnectError("cancelled", "Connection cancelled.");
    case "auth/user-mismatch":
      return new GoogleConnectError("wrong_account", `Choose the Google account you sign in to VetroAI with${email ? ` (${email})` : ""}.`);
    case "auth/credential-already-in-use":
    case "auth/email-already-in-use":
    case "auth/account-exists-with-different-credential":
      return new GoogleConnectError("account_in_use", "That Google account belongs to a different VetroAI account. Sign in with it instead, or choose another Google account.");
    case "auth/operation-not-allowed":
      return new GoogleConnectError("not_enabled", "Google sign-in isn't turned on for VetroAI yet.");
    case "auth/unauthorized-domain":
      return new GoogleConnectError("bad_domain", "This site isn't allowed to use Google sign-in yet (Firebase authorized domains).");
    case "auth/network-request-failed":
      return new GoogleConnectError("network", "Couldn't reach Google. Check your connection and try again.");
    default:
      return new GoogleConnectError("failed", err?.message || "Couldn't connect to Google.");
  }
}

// Opens Google's popup asking for `scopes` (plus anything granted before) and
// saves the access token it returns. Must run from a click: browsers block
// popups that aren't.
export async function connectGoogle(scopes) {
  const user = auth?.currentUser;
  if (!user) throw new GoogleConnectError("signed_out", "Sign in to VetroAI first, then connect your apps.");
  const google = user.providerData.find((p) => p.providerId === "google.com");
  const provider = new GoogleAuthProvider();
  scopes.forEach((scope) => provider.addScope(scope));
  provider.setCustomParameters({
    include_granted_scopes: "true",
    login_hint: readGoogleToken()?.email || google?.email || user.email || "",
  });

  let result;
  try {
    result = google ? await reauthenticateWithPopup(user, provider) : await linkWithPopup(user, provider);
  } catch (err) {
    throw describeError(err, google?.email || user.email);
  }

  const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
  if (!token) throw new GoogleConnectError("no_token", "Google didn't hand back access. Please try again.");
  const info = await tokenInfo(token);
  const record = {
    uid: user.uid,
    token,
    // What the user actually allowed: Google lets them untick permissions.
    scopes: info?.scope ? info.scope.split(/\s+/) : scopes,
    expiresAt: info?.exp ? Number(info.exp) * 1000 : Date.now() + 55 * 60 * 1000,
    email: info?.email || result.user?.providerData?.find((p) => p.providerId === "google.com")?.email || user.email || "",
  };
  saveToken(record);
  return record;
}

// Ends VetroAI's Google access: forgets the token and asks Google to revoke it.
export async function revokeGoogle() {
  const record = readGoogleToken();
  forgetGoogleToken();
  if (!record?.token) return;
  try {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `token=${encodeURIComponent(record.token)}`,
    });
  } catch { /* already gone, or offline: the token expires within the hour anyway */ }
}
