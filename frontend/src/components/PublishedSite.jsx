import React, { useEffect, useState } from "react";
import { loadSite, withStorageShim } from "../lib/sitePublish";

// A website someone published from VetroAI Computer, at /s/{id}. It runs in a
// sandboxed frame: scripts work, but it gets its own opaque origin, so it can't
// read VetroAI's storage, cookies or the visitor's account.
export default function PublishedSite({ id }) {
  const [state, setState] = useState({ status: "loading" });

  useEffect(() => {
    let live = true;
    loadSite(id)
      .then((site) => {
        if (!live) return;
        if (!site) return setState({ status: "missing" });
        document.title = site.title || "Website";
        setState({ status: "ready", site });
      })
      .catch((err) => live && setState({ status: "error", message: err?.message || String(err) }));
    return () => { live = false; };
  }, [id]);

  if (state.status === "ready") {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#fff" }}>
        <iframe
          title={state.site.title || "Website"}
          srcDoc={withStorageShim(state.site.html)}
          sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals"
          style={{ border: 0, width: "100%", height: "100%", display: "block" }}
        />
        <a href="/" target="_blank" rel="noopener noreferrer" style={{ position: "fixed", right: 12, bottom: 12, zIndex: 2, padding: "6px 11px", borderRadius: 999, background: "rgba(31,30,29,.86)", color: "#F2EFEA", font: "600 12px/1.2 system-ui, sans-serif", textDecoration: "none", boxShadow: "0 6px 18px rgba(0,0,0,.25)" }}>
          Made with VetroAI
        </a>
      </div>
    );
  }
  const message = state.status === "loading" ? "Opening the website…" : state.status === "missing" ? "This website doesn't exist, or its owner took it down." : `This website couldn't be opened. ${state.message}`;
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, textAlign: "center", background: "var(--bg, #1B1A19)", color: "var(--ink, #F2EFEA)", font: "15px/1.5 system-ui, sans-serif" }}>
      <div>
        <p style={{ margin: "0 0 14px" }}>{message}</p>
        {state.status !== "loading" && <a href="/" style={{ color: "#E08659", fontWeight: 600 }}>Go to VetroAI</a>}
      </div>
    </div>
  );
}
