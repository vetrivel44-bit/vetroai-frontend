import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ShieldCheck, FlaskConical } from "lucide-react";
import CallAssistant from "./CallAssistant";

const PROD_API = "https://ai-chatbot-backend-gvvz.onrender.com/api";
const configured = import.meta.env.VITE_API_BASE_URL?.trim();
const API = configured
  ? `${configured.replace(/\/+$/, "")}${/\/api$/i.test(configured) ? "" : "/api"}`
  : (import.meta.env.PROD ? PROD_API : "/api");

// The sidebar is rendered by App.jsx and has no extension point, so the entry
// is portalled in next to Voice Cover the same way Voice Cover does it.
function findSidebarMount() {
  const sidebar = document.querySelector(".claude-sidebar");
  if (!sidebar) return null;
  const anchor = sidebar.querySelector("[data-voice-cover-sidebar-mount]")
    || [...sidebar.querySelectorAll("button")].find((button) => button.textContent?.trim().startsWith("Design"))?.parentElement;
  if (!anchor) return null;

  let mount = sidebar.querySelector("[data-call-assistant-sidebar-mount]");
  if (!mount) {
    mount = document.createElement("div");
    mount.setAttribute("data-call-assistant-sidebar-mount", "true");
    anchor.insertAdjacentElement("afterend", mount);
  }
  return mount;
}

export default function CallAssistantLauncher() {
  const [open, setOpen] = useState(false);
  const [mount, setMount] = useState(null);

  useEffect(() => {
    const attach = () => {
      const next = findSidebarMount();
      if (next) setMount(next);
    };
    attach();
    const observer = new MutationObserver(attach);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const sidebarButton = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      title="Call Assistant"
      aria-label="Open Call Assistant"
      className="claude-sb-item flex items-center justify-between gap-3 w-full px-3 py-2 text-[13.5px] rounded-lg transition-colors"
    >
      <span className="flex items-center gap-3"><ShieldCheck size={17} /> Call Assistant</span>
      <FlaskConical size={13} style={{ color: "var(--ink-4)" }} />
    </button>
  );

  return <>
    {mount && createPortal(sidebarButton, mount)}
    {open && (
      <div style={{ position: "fixed", inset: 0, zIndex: 141, background: "var(--bg,#f7f7f5)" }}>
        <CallAssistant apiBase={API} onClose={() => setOpen(false)} />
      </div>
    )}
  </>;
}
