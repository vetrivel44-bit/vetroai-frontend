// Firebase app initialisation.
//
// The web config below is not a secret — Google documents these values as
// publicly shippable. What actually protects the project is Firestore security
// rules plus the Authentication → Authorized domains list, both of which live
// in `firestore.rules` and `firebase.json` in the repo root.
//
// Every value can still be overridden per environment through Vite env vars so
// staging/prod can point at different Firebase projects without a code change.
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const env = import.meta.env;

// Defaults are the `vetroai` project's own web app, so a plain `npm run build`
// works with no extra setup. Point a build at a different Firebase project by
// setting the matching VITE_FIREBASE_* variables.
export const firebaseConfig = {
  apiKey:            env.VITE_FIREBASE_API_KEY             || "AIzaSyB8McqXrjHkb6iE3NWHMvsj3wxDjvbl4AQ",
  authDomain:        env.VITE_FIREBASE_AUTH_DOMAIN         || "vetroai.firebaseapp.com",
  projectId:         env.VITE_FIREBASE_PROJECT_ID          || "vetroai",
  storageBucket:     env.VITE_FIREBASE_STORAGE_BUCKET      || "vetroai.firebasestorage.app",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "842647060488",
  appId:             env.VITE_FIREBASE_APP_ID              || "1:842647060488:web:0795de81d96ccb8e9bd1bd",
  // Only read by Analytics, which the app does not load. Kept so enabling
  // getAnalytics() later needs no config change.
  measurementId:     env.VITE_FIREBASE_MEASUREMENT_ID      || "G-H36JP62C16",
};

// Guards against an override that blanks these out: getAuth() throws
// `auth/invalid-api-key` on a missing key, and this module is imported at the
// top of the app, so that throw would white-screen the whole UI.
export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.appId);

if (!isFirebaseConfigured) {
  console.error(
    "[firebase] VITE_FIREBASE_API_KEY / VITE_FIREBASE_APP_ID are set but empty. " +
    "Unset them to use the bundled `vetroai` defaults, or set both to a valid web app config."
  );
}

// Initialise only when the config is complete. getAuth() throws
// `auth/invalid-api-key` on a missing key, and because this module is imported
// at the top of the app that throw would white-screen the whole UI rather than
// degrade to "sign-in unavailable". Callers must treat these as nullable and
// gate on `isFirebaseConfigured`.
//
// Vite HMR re-evaluates modules, and initializeApp() throws on a duplicate
// default app, so reuse the existing one when it is already there.
export const app = isFirebaseConfigured
  ? (getApps().length ? getApp() : initializeApp(firebaseConfig))
  : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;

export default app;
