import React, { useState } from 'react';
import { signInWithGoogle, describeAuthError } from '../../lib/firebaseAuth.js';

/**
 * Google sign-in button backed by Firebase Authentication.
 *
 * This replaces the old Google Identity Services script + custom-backend token
 * exchange. Firebase owns the OAuth flow now, so there is no client id to pass
 * and no GSI script to wait for — which also removes the region-blocked-script
 * failure mode the previous implementation had to work around.
 *
 * `onLogin` is called with the Firebase User on success. The app's auth state
 * is driven by onAuthStateChanged, so this callback is only for UI feedback.
 */
const GoogleLoginButton = ({ onLogin, onError, theme, disabled }) => {
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (busy || disabled) return;
    setBusy(true);
    try {
      const user = await signInWithGoogle();
      // A null user means we fell back to a redirect: the page is navigating
      // away and the result is picked up on the way back.
      if (user) onLogin?.(user);
    } catch (err) {
      onError?.(describeAuthError(err), err);
    } finally {
      setBusy(false);
    }
  };

  const dark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy || disabled}
      aria-label="Continue with Google"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        width: '100%',
        maxWidth: 320,
        minHeight: 44,
        margin: '0 auto',
        padding: '10px 20px',
        borderRadius: 9999,
        cursor: busy || disabled ? 'default' : 'pointer',
        opacity: busy || disabled ? 0.65 : 1,
        border: `1px solid ${dark ? '#3c4043' : '#dadce0'}`,
        background: dark ? '#131314' : '#fff',
        color: dark ? '#e3e3e3' : '#1f1f1f',
        fontSize: 15,
        fontWeight: 500,
        fontFamily: '"Roboto", system-ui, -apple-system, sans-serif',
        transition: 'background 120ms ease, box-shadow 120ms ease',
      }}
    >
      <GoogleMark />
      <span>{busy ? 'Signing in…' : 'Continue with Google'}</span>
    </button>
  );
};

// Inlined so the button renders identically offline and in regions where
// Google's static hosts are unreachable.
const GoogleMark = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
    <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
    <path fill="#FBBC05" d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
    <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
  </svg>
);

export default GoogleLoginButton;
