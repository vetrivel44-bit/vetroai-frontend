import React, { useState } from "react";
import { Music2 } from "lucide-react";
import VoiceCoverPanel from "./VoiceCoverPanel";

const PROD_API = "https://ai-chatbot-backend-gvvz.onrender.com/api";
const configured = import.meta.env.VITE_API_BASE_URL?.trim();
const API = configured ? `${configured.replace(/\/+$/, "")}${/\/api$/i.test(configured) ? "" : "/api"}` : (import.meta.env.PROD ? PROD_API : "/api");

export default function VoiceCoverLauncher() {
  const [open, setOpen] = useState(false);
  return <>
    <button
      type="button"
      onClick={() => setOpen(true)}
      title="Voice Cover"
      aria-label="Open Voice Cover"
      style={{position:"fixed",right:20,bottom:20,zIndex:90,border:"1px solid rgba(15,118,110,.18)",borderRadius:999,padding:"11px 15px",background:"#1f6f66",color:"white",boxShadow:"0 10px 30px rgba(15,80,70,.22)",display:"flex",alignItems:"center",gap:8,fontWeight:700,cursor:"pointer"}}
    >
      <Music2 size={17}/> Voice Cover
    </button>
    {open && <div style={{position:"fixed",inset:0,zIndex:140,background:"var(--bg,#f7f7f5)"}}><VoiceCoverPanel apiBase={API} authToken={localStorage.getItem("token") || ""} onClose={() => setOpen(false)} /></div>}
  </>;
}
