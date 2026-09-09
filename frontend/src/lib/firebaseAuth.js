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
 */
export async function signInWithGoogle() {
  requireAuth();
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

/** Email + password registration. `name` becomes the Firebase displayName. */
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
  return auth.currentUser || user;
}

export const sendPasswordReset = (email) => sendPasswordResetEmail(requireAuth(), email);

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
