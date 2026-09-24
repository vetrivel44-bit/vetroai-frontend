// Thin wrapper around Firebase Authentication so the rest of the app never has
// to import from "firebase/auth" directly.
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  onIdTokenChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  updateProfile,
  signOut,
} from "firebase/auth";
import { auth } from "../firebase.js";

// `auth` is null when the Firebase config is incomplete (see src/firebase.js).
// Every entry point below guards on it so a misconfigured build degrades to
// "sign-in unavailable" instead of throwing out of a click handler.
const requireAuth = () => {
  if (!auth) throw new Error("Firebase is not configured — see frontend/.env.example.");
  return auth;
};

const provider = new GoogleAuthProvider();
// Always show the chooser: without this Google silently reuses the last account,
// which makes "sign in as someone else" impossible on shared machines.
provider.setCustomParameters({ prompt: "select_account" });

/** Shape the app cares about, derived from a Firebase User. */
export const toUserInfo = (user) =>
  user && {
    uid: user.uid,
    name: user.displayName || user.email?.split("@")[0] || "",
    email: user.email || "",
    picture: user.photoURL || "",
    emailVerified: user.emailVerified,
  };

/**
 * Sign in with Google.
 *
 * Popup is the better experience (the app keeps its state), but embedded
 * webviews and hardened popup blockers reject it outright. In those cases fall
 * back to a full-page redirect, which `consumeRedirectResult` picks up on the
 * way back.
 *
 * The desktop (Electron) build always uses the redirect flow instead of even
 * trying the popup. Firebase's popup flow relies on sessionStorage being
 * shared between the opener window and the popup, which only happens for a
 * same-origin auxiliary browsing context — a separate Electron BrowserWindow
 * never gets that, popup or not, so it reliably fails with "missing initial
 * state" no matter how the popup window itself is opened/closed. A redirect
 * navigates the single existing window there and back, so there's no second
 * window and no cross-window storage to lose.
 */
// Android phones get the redirect too. There the popup opens in a
// full-screen tab, but Google still draws its small desktop-popup layout in
// it, so the account chooser is a tiny card in the middle of the screen. A
// redirect shows Google's normal full-size mobile sign-in page instead.
// (Not iOS: Safari's tracking protection can drop the redirect result when
// the app and the Firebase auth domain are different sites.)
const prefersRedirect = () =>
  typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent || "");

export async function signInWithGoogle() {
  requireAuth();
  if (typeof window !== "undefined" && (window.vetroDesktop || prefersRedirect())) {
    await signInWithRedirect(auth, provider);
    return null; // window navigates away; result arrives via consumeRedirectResult
  }
  try {
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (err) {
    const popupBlocked =
      err?.code === "auth/popup-blocked" ||
      err?.code === "auth/operation-not-supported-in-this-environment";
    if (popupBlocked) {
      await signInWithRedirect(auth, provider);
      return null; // page navigates away; result arrives via consumeRedirectResult
    }
    throw err;
  }
}

/**
 * Completes a redirect-based sign-in. Safe to call on every load — it resolves
 * to null when the load was not a redirect return.
 */
export async function consumeRedirectResult() {
  if (!auth) return null;
  try {
    const result = await getRedirectResult(auth);
    return result?.user || null;
  } catch {
    return null;
  }
}

/** Email + password sign-in. */
export async function signInWithEmail(email, password) {
  requireAuth();
  const { user } = await signInWithEmailAndPassword(auth, email, password);
  return user;
}

/**
 * Email + password registration. `name` becomes the Firebase displayName.
 * A verification link is emailed straight away: the account stays locked out
 * of the app (see needsEmailVerification) until it is opened, so nobody can
 * sign up with an address they don't own.
 */
export async function signUpWithEmail(email, password, name) {
  requireAuth();
  const { user } = await createUserWithEmailAndPassword(auth, email, password);
  if (name) {
    await updateProfile(user, { displayName: name });
    // updateProfile mutates the User in place but does not re-fire
    // onAuthStateChanged, so callers reading displayName right after signup
    // need this reload to see it.
    await user.reload();
  }
  // Not fatal: the verify screen offers "Resend email" if this one fails.
  await sendVerificationEmail(auth.currentUser || user).catch(() => {});
  return auth.currentUser || user;
}

/**
 * True for an email + password account whose address hasn't been confirmed.
 * Google sign-ins come verified by Google, so they never need this.
 */
export const needsEmailVerification = (user) =>
  Boolean(user) && !user.emailVerified
  && (user.providerData || []).some((p) => p?.providerId === "password");

/** Emails the "confirm your address" link; it brings the reader back here. */
export async function sendVerificationEmail(user = auth?.currentUser) {
  if (!user) throw new Error("Not signed in.");
  const url = typeof window !== "undefined" ? window.location.origin : undefined;
  await sendEmailVerification(user, url ? { url } : undefined);
}

/**
 * Re-reads the account after the reader says they clicked the link. Resolves
 * true once verified; it also refreshes the ID token so the new
 * `email_verified` claim reaches the backend and Firestore, and
 * onIdTokenChanged fires to finish signing in.
 */
export async function refreshEmailVerification() {
  const user = auth?.currentUser;
  if (!user) return false;
  await user.reload();
  const current = auth.currentUser;
  if (!current?.emailVerified) return false;
  await current.getIdToken(true);
  return true;
}

/** Emails a link to set a new password; it brings the reader back here. */
export const sendPasswordReset = (email) => sendPasswordResetEmail(
  requireAuth(),
  email,
  typeof window !== "undefined" ? { url: window.location.origin } : undefined,
);

export const signOutUser = () => (auth ? signOut(auth) : Promise.resolve());

/** Subscribe to sign-in/sign-out. Returns the unsubscribe function. */
export const watchAuthState = (cb) => (auth ? onAuthStateChanged(auth, cb) : () => {});

/**
 * Like watchAuthState, but also fires when the ID token is silently refreshed
 * (roughly hourly). Use this when a copy of the token is cached outside the
 * SDK, so the cached copy never goes stale.
 */
export const watchIdToken = (cb) => (auth ? onIdTokenChanged(auth, cb) : () => {});

/**
 * Current Firebase ID token, for calls to our own backend.
 * The SDK refreshes it automatically, so this is always a live token.
 */
export const getIdToken = async (forceRefresh = false) =>
  auth?.currentUser ? auth.currentUser.getIdToken(forceRefresh) : null;

/** Friendly text for the auth errors users can actually hit. */
export function describeAuthError(err) {
  switch (err?.code) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Sign-in cancelled.";
    case "auth/unauthorized-domain":
      return `This domain (${window.location.hostname}) isn't in the Firebase authorized domains list.`;
    case "auth/network-request-failed":
      return "Network error — check your connection and try again.";
    case "auth/account-exists-with-different-credential":
      return "An account already exists with this email using a different sign-in method.";
    case "auth/email-already-in-use":
      return "That email is already registered. Try signing in instead.";
    case "auth/invalid-email":
      return "That doesn't look like a valid email address.";
    case "auth/weak-password":
      return "Password is too weak — use at least 6 characters.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Incorrect email or password.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a moment and try again.";
    case "auth/operation-not-allowed":
      return "That sign-in method isn't enabled for this Firebase project.";
    default:
      return err?.message || "Google sign-in failed. Please try again.";
  }
}
