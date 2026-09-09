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

export const firebaseConfig = {
  apiKey:            env.VITE_FIREBASE_API_KEY,
  authDomain:        env.VITE_FIREBASE_AUTH_DOMAIN     || "vetroai.firebaseapp.com",
  projectId:         env.VITE_FIREBASE_PROJECT_ID      || "vetroai",
  storageBucket:     env.VITE_FIREBASE_STORAGE_BUCKET  || "vetroai.firebasestorage.app",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             env.VITE_FIREBASE_APP_ID,
};

// apiKey and appId have no sane default — they are per-app values handed out
// when the web app is registered. Without them initializeApp() fails with an
// opaque error deep inside the SDK, so surface the real cause once, here.
export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.appId);

if (!isFirebaseConfigured) {
  console.error(
    "[firebase] Missing VITE_FIREBASE_API_KEY / VITE_FIREBASE_APP_ID. " +
    "Copy frontend/.env.example to frontend/.env.local and fill in the values from " +
    "`npx -y firebase-tools@latest apps:sdkconfig WEB --project vetroai`."
  );
}

// Vite HMR re-evaluates modules, and initializeApp() throws on a duplicate
// default app, so reuse the existing one when it is already there.
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export default app;
