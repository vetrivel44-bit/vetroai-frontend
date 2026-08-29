import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Music2, FlaskConical } from "lucide-react";
import VoiceCoverPanel from "./VoiceCoverPanel";

const PROD_API = "https://ai-chatbot-backend-gvvz.onrender.com/api";
const configured = import.meta.env.VITE_API_BASE_URL?.trim();
const API = configured ? `${configured.replace(/\/+$/, "")}${/\/api$/i.test(configured) ? "" : "/api"}` : (import.meta.env.PROD ? PROD_API : "/api");

function findProductsMount() {
  const sidebar = document.querySelector(".claude-sidebar");
  if (!sidebar) return null;
  const designButton = [...sidebar.querySelectorAll("button")].find((button) => button.textContent?.trim().startsWith("Design"));
  if (!designButton?.parentElement) return null;

  let mount = designButton.parentElement.querySelector("[data-voice-cover-sidebar-mount]");
  if (!mount) {
    mount = document.createElement("div");
    mount.setAttribute("data-voice-cover-sidebar-mount", "true");
    designButton.insertAdjacentElement("afterend", mount);
  }
  return mount;
}

export default function VoiceCoverLauncher() {
  const [open, setOpen] = useState(false);
  const [mount, setMount] = useState(null);

  useEffect(() => {
    const attach = () => {
      const next = findProductsMount();
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
      title="Voice Cover"
      aria-label="Open Voice Cover"
      className="claude-sb-item flex items-center justify-between gap-3 w-full px-3 py-2 text-[13.5px] rounded-lg transition-colors"
    >
      <span className="flex items-center gap-3"><Music2 size={17} /> Voice Cover</span>
      <FlaskConical size={13} style={{ color: "var(--ink-4)" }} />
    </button>
  );

  return <>
    {mount && createPortal(sidebarButton, mount)}
    {open && (
      <div style={{ position: "fixed", inset: 0, zIndex: 140, background: "var(--bg,#f7f7f5)" }}>
        <VoiceCoverPanel
          apiBase={API}
          authToken={localStorage.getItem("token") || ""}
          onClose={() => setOpen(false)}
        />
      </div>
    )}
  </>;
}
