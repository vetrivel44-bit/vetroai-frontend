import React, { useState } from "react";
import { Check, Loader2, Lock, MessageSquarePlus, Unplug, X } from "lucide-react";
import { CONNECTORS } from "../../connectors/catalog";
import { canConnectGoogle, googleTokenFor, signedInWithGoogle } from "../../connectors/googleAuth";
import ConnectorLogo from "../connectors/ConnectorLogo";
import "./ConnectorsHub.css";

// Settings → Connectors: link Gmail, Google Drive and Google Calendar so
// chats can use them. Connecting opens Google's own window; VetroAI never
// sees the user's Google password.
export default function ConnectorsHub({ state, onConnect, onDisconnect, onToggle, onTry, onClose }) {
  const [busy, setBusy] = useState(null);
  const [errors, setErrors] = useState({});
  const available = canConnectGoogle();
  const viaEmail = available && !signedInWithGoogle();
  const notConnected = CONNECTORS.filter((c) => !state[c.id]?.connected).map((c) => c.id);

  const connect = async (ids, key) => {
    setBusy(key);
    setErrors((previous) => ({ ...previous, [key]: "" }));
    try {
      await onConnect(ids);
    } catch (err) {
      if (err?.code !== "cancelled") setErrors((previous) => ({ ...previous, [key]: err?.message || "Couldn't connect." }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="connectors-overlay" role="dialog" aria-modal="true" aria-label="Connectors">
      <div className="connectors-shell">
        <header className="connectors-header">
          <div>
            <div className="connectors-eyebrow">VetroAI connectors</div>
            <h2>Connectors</h2>
            <p>Let VetroAI use your apps in chats. It reads only what a question needs, and asks you before it sends or creates anything.</p>
          </div>
          <button type="button" className="connectors-close" onClick={onClose} aria-label="Close connectors"><X size={20} /></button>
        </header>

        <main className="connectors-body">
          {!available && (
            <div className="connectors-banner">
              <Lock size={16} />
              <span>{typeof window !== "undefined" && window.vetroDesktop
                ? "Connectors work in the web app. Open VetroAI in your browser to connect Gmail, Drive and Calendar."
                : "Sign in with a VetroAI account to connect your apps."}</span>
            </div>
          )}

          {available && notConnected.length > 1 && (
            <div className="connectors-quick">
              <div>
                <strong>Connect your Google apps</strong>
                <span>One Google window for {notConnected.length === 3 ? "Gmail, Drive and Calendar" : CONNECTORS.filter((c) => notConnected.includes(c.id)).map((c) => c.name).join(" and ")}.</span>
              </div>
              <button type="button" className="connectors-btn is-primary" disabled={Boolean(busy)} onClick={() => connect(notConnected, "all")}>
                {busy === "all" ? <Loader2 size={15} className="connectors-spin" /> : null} Connect all
              </button>
              {errors.all && <p className="connectors-error">{errors.all}</p>}
            </div>
          )}

          <div className="connectors-grid">
            {CONNECTORS.map((connector) => {
              const saved = state[connector.id] || {};
              const connected = Boolean(saved.connected);
              const live = connected && Boolean(googleTokenFor(connector.scopes));
              return (
                <article key={connector.id} className={`connectors-card${connected ? " is-connected" : ""}`}>
                  <div className="connectors-card-top">
                    <ConnectorLogo id={connector.id} size={34} />
                    <div className="connectors-card-title">
                      <strong>{connector.name}</strong>
                      <span>{connector.tagline}</span>
                    </div>
                  </div>
                  <p className="connectors-card-text">{connector.description}</p>
                  <ul className="connectors-perms">
                    {connector.permissions.map((permission) => <li key={permission}><Check size={13} /> {permission}</li>)}
                  </ul>

                  {connected && (
                    <div className="connectors-try">
                      {connector.examples.map((example) => (
                        <button type="button" key={example} onClick={() => onTry(example)}><MessageSquarePlus size={13} /> {example}</button>
                      ))}
                    </div>
                  )}

                  <footer className="connectors-card-footer">
                    {connected ? (
                      <>
                        <div className="connectors-account">
                          <span className="connectors-badge"><Check size={12} /> Connected</span>
                          <strong>{saved.account || "Your Google account"}</strong>
                          <small>{live ? "Ready" : "Reconnects the next time a chat needs it"}</small>
                        </div>
                        <label className="connectors-toggle" title="Let chats use this app">
                          <input type="checkbox" checked={saved.enabled !== false} onChange={() => onToggle(connector.id)} />
                          <span />
                          Use in chats
                        </label>
                        <button type="button" className="connectors-text-btn" onClick={() => onDisconnect(connector.id)}>
                          <Unplug size={14} /> Disconnect
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="connectors-btn is-primary"
                        disabled={!available || Boolean(busy)}
                        onClick={() => connect([connector.id], connector.id)}
                      >
                        {busy === connector.id ? <Loader2 size={15} className="connectors-spin" /> : null} Connect
                      </button>
                    )}
                  </footer>
                  {errors[connector.id] && <p className="connectors-error">{errors[connector.id]}</p>}
                </article>
              );
            })}
          </div>

          <section className="connectors-notes">
            <h3><Lock size={15} /> Privacy</h3>
            <p>Your Google access stays in this browser tab and goes only to Google. It lasts about an hour; after that, a chat that needs your apps shows a <strong>Reconnect</strong> button, one click with no new questions.</p>
            <p>What a chat reads to answer you, such as an email or a file, is sent to the AI model along with your question, just like anything you type.</p>
            {viaEmail && <p>You signed in with email and password, so connecting also links that Google account to your VetroAI account. You can then sign in with either.</p>}
            <p>Remove VetroAI's access at any time in your <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">Google Account permissions</a>.</p>
          </section>
        </main>
      </div>
    </div>
  );
}
