import { Component } from "react";

/**
 * Catches render-time errors so a single throw cannot blank the whole page.
 *
 * Without this, any error thrown while rendering unmounts the entire React
 * tree and leaves `#root` empty — the user sees a black screen with no hint
 * that anything went wrong, and the only trace is a console message they will
 * never open DevTools to read.
 *
 * The fallback also offers to clear this origin's stored data: a corrupt entry
 * in localStorage (a half-written session, a schema that changed under an old
 * cached value) throws on every load, so reloading alone can never escape it.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary] render failed:", error, info?.componentStack);
  }

  handleReset = () => {
    // Storage access throws in some privacy modes; clearing is best-effort and
    // must not stop the reload.
    try { localStorage.clear(); } catch { /* ignore */ }
    try { sessionStorage.clear(); } catch { /* ignore */ }
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: 24,
          background: "#0b0b0d",
          color: "#f4f4f5",
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 40, lineHeight: 1 }}>⚠️</div>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>VetroAI failed to start</h1>
        <p style={{ opacity: 0.7, fontSize: 14, margin: 0, maxWidth: 420 }}>
          Something went wrong while loading the app. Reloading usually fixes it. If it
          keeps happening, clearing this site's saved data will reset it.
        </p>
        <pre
          style={{
            maxWidth: "min(560px, 90vw)",
            maxHeight: 160,
            overflow: "auto",
            textAlign: "left",
            fontSize: 12,
            lineHeight: 1.5,
            padding: 12,
            borderRadius: 10,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.1)",
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {String(error?.message || error)}
        </pre>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: "10px 18px", borderRadius: 999, border: "none", cursor: "pointer",
              background: "#f4f4f5", color: "#0b0b0d", fontWeight: 600, fontSize: 14,
            }}
          >
            Reload
          </button>
          <button
            type="button"
            onClick={this.handleReset}
            style={{
              padding: "10px 18px", borderRadius: 999, cursor: "pointer",
              border: "1px solid rgba(255,255,255,0.25)", background: "transparent",
              color: "#f4f4f5", fontWeight: 600, fontSize: 14,
            }}
          >
            Clear data &amp; reload
          </button>
        </div>
      </div>
    );
  }
}
