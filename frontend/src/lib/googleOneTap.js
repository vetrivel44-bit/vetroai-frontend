// Google One Tap: the native "choose an account" sheet that slides up from the
// bottom of the screen (on Chrome it is drawn by the browser itself via FedCM),
// so signing in is one tap without leaving the app — the way Claude, ChatGPT
// and most apps do it. Google hands back an ID token, which Firebase turns
// into a normal signed-in user, so everything after sign-in is unchanged.
//
// It needs the Web client ID of the Firebase project's OAuth client
// (Firebase Console → Authentication → Sign-in method → Google → Web SDK
// configuration). Without one, One Tap stays off and the regular
// "Continue with Google" button is the only way in.
import { GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import { auth } from "../firebase.js";

export const GOOGLE_WEB_CLIENT_ID = (import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID || "").trim();

const GSI_SRC = "https://accounts.google.com/gsi/client";
let scriptPromise = null;

function loadGsi() {
  if (typeof window === "undefined") return Promise.reject(new Error("No window"));
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = GSI_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => (window.google?.accounts?.id ? resolve(window.google) : reject(new Error("Google sign-in unavailable")));
      script.onerror = () => { scriptPromise = null; reject(new Error("Google sign-in unavailable")); };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

export const oneTapAvailable = () => Boolean(GOOGLE_WEB_CLIENT_ID && auth) && typeof window !== "undefined" && !window.vetroDesktop;

/**
 * Shows the One Tap account sheet. `onSignedIn(user)` runs after Firebase
 * accepts the Google credential; `onError(err)` if it doesn't. Returns a
 * function that dismisses the sheet (call it when the screen goes away).
 * Silently does nothing if One Tap isn't configured or Google can't load.
 */
export function startOneTap({ onSignedIn, onError } = {}) {
  if (!oneTapAvailable()) return () => {};
  let active = true;
  loadGsi()
    .then((google) => {
      if (!active) return;
      google.accounts.id.initialize({
        client_id: GOOGLE_WEB_CLIENT_ID,
        callback: async ({ credential }) => {
          if (!credential) return;
          try {
            const { user } = await signInWithCredential(auth, GoogleAuthProvider.credential(credential));
            onSignedIn?.(user);
          } catch (err) {
            onError?.(err);
          }
        },
        auto_select: false,
        cancel_on_tap_outside: true,
        context: "signin",
        itp_support: true,
        use_fedcm_for_prompt: true,
      });
      google.accounts.id.prompt();
    })
    .catch(() => { /* One Tap is a convenience; the button still works. */ });
  return () => {
    active = false;
    try { window.google?.accounts?.id?.cancel(); } catch { /* already gone */ }
  };
}
