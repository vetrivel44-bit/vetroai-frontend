import React, { useState, useRef, useEffect, useCallback, useMemo, useId } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
// KaTeX defaults to throwing/warning on plain-prose punctuation (en dashes, curly quotes)
// that ends up inside a $...$ span when remark-math's greedy single-dollar matching
// grabs surrounding text. `strict: false` renders those characters as-is instead of
// spamming the console — it doesn't change how real math expressions are rendered.
const KATEX_OPTIONS = { strict: false };
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import "./App.css";
import GoogleLoginButton from "./components/auth/GoogleLoginButton";
import { Paperclip, X, CornerDownRight, ArrowDown, Zap, Globe, Play, Calendar, Paintbrush, Brain, Calculator, Target, Coffee, Leaf, Bot, GraduationCap, Terminal, Star, Smile, Pause, RotateCcw, Check, Timer, User, Flame, Rocket, Palette, Moon, Sun, Compass, Anchor, Crown, Gem, Shield, Heart, Key, Lock, ThumbsUp, Frown, Search, FileText, PenLine, Code, Lightbulb, Download, MessageSquare, FolderClosed, LayoutGrid, SlidersHorizontal, FlaskConical, Ghost, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, MoreHorizontal, Pencil, Trash2, LogOut, Settings, HelpCircle, Plus, ExternalLink, Smartphone, Tablet, Monitor, Layers, Newspaper } from "lucide-react";
import StructuredResponseRenderer from "./components/structured/StructuredResponseRenderer";

const STRUCT_TYPE_RE = /"type"\s*:\s*"(location|route|chart|timeline|comparison_table|comparison|metrics|architecture|gallery|visual_gallery|collapsible|editor|results|onboarding|mcq)"/;
const hasStructuredContent = (text) => !!text && STRUCT_TYPE_RE.test(text);
import ThinkingIndicator from "./components/ThinkingIndicator";
import GlobalSearch from "./components/screens/GlobalSearch";
import UpgradeModal from "./components/screens/UpgradeModal";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
let baseApi = "/api";
if (!import.meta.env.DEV && import.meta.env.VITE_API_BASE_URL) {
  baseApi = import.meta.env.VITE_API_BASE_URL;
}
if (baseApi.startsWith("http") && !baseApi.endsWith("/api")) {
  baseApi = baseApi.replace(/\/+$/, "") + "/api";
}
const API = baseApi;
// Web search is handled entirely by the backend (Tavily)
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
const VITE_GROQ_KEY = import.meta.env.VITE_GROQ_API_KEY || "";



const swallowError = () => {};
const makeExportStamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const MAX_FILE_SIZE_MB = 25;

// Shared SSE reader for the chat stream — used by the main chat flow and by
// standalone panels (e.g. DesignCanvas) that talk to /api/chat independently.
const readSSEStream = async (reader, onChunk, onStatus, onError, isActive, reqId) => {
  const dec = new TextDecoder();
  let lineBuffer = "";
  let accumulated = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!isActive()) return accumulated;

      lineBuffer += dec.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === "[DONE]") continue;

        try {
          const { type, data } = JSON.parse(raw);
          if (type === "content" && data) {
             accumulated += data;
             onChunk(accumulated);
          } else if (type === "clear") {
             accumulated = "";
             onChunk("");
          } else if (type === "status" && data) {
             onStatus(data);
          } else if (type === "error" && data) {
             onError(data);
          }
        } catch (err) {
          console.error("SSE parse error:", err, raw);
        }
      }
    }
  } catch (err) {
    console.error("SSE read error:", err);
    throw err;
  }
  return accumulated;
};

// ─── DIRECT BROWSER AI (Pollinations.ai — Emergency fallback only) ──────────
// Only used if the backend server is completely unreachable (network down).



// ─── PDF TEXT EXTRACTION (client-side, bundled via pdfjs-dist, lazy-loaded) ───
let _pdfjsLib = null;
const loadPdfjs = async () => {
  if (_pdfjsLib) return _pdfjsLib;
  const [pdfjsLib, workerMod] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.js?url"),
  ]);
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerMod.default;
  _pdfjsLib = pdfjsLib;
  return pdfjsLib;
};

const extractPdfText = async (file) => {
  const pdfjsLib = await loadPdfjs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = "";
  for (let i = 1; i <= Math.min(pdf.numPages, 20); i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(" ") + "\n";
  }
  return text.trim().slice(0, 15000);
};

// ─── SOURCE CARDS EXTRACTION (Perplexity-style) ───────────────────────────────
const extractSourceUrls = (text) => {
  if (!text) return [];
  const urlRx = /https?:\/\/[^\s)\]>"]+/g;
  const found = [...new Set(text.match(urlRx) || [])];
  return found.slice(0, 8).map((url) => {
    try { const u = new URL(url); return { url, domain: u.hostname.replace("www.", "") }; }
    catch { return { url, domain: url.slice(0, 30) }; }
  });
};

// ─── VETROAI BRAND LOGO ────────────────────────────────────────────────────────
// Uses the actual logo.png (723×240, tightly cropped, transparent background).
// CSS filter boosts the pastel colors to premium Electric Blue / Indigo / Purple.
const VetroLogo = ({ width = 150, className = "" }) => (
  <img
    src="/logo.png"
    alt="VetroAi"
    className={`vetro-brand-logo ${className}`}
    style={{ width, height: 'auto', display: 'block', flexShrink: 0 }}
  />
);

// Icon-only: shows just the V portion (left ~40% of the 3:1 logo)
const VetroSpark = ({ size = 32, className = "" }) => (
  <div
    className={className}
    style={{ width: size, height: size, overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center' }}
  >
    <img
      src="/logo.png"
      alt="VetroAi"
      className="vetro-brand-logo"
      style={{ height: size, width: 'auto', maxWidth: 'none', display: 'block' }}
    />
  </div>
);

// White-on-dark version for the gradient circle avatar
const VetroSparkWhite = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 68 76" fill="none" xmlns="http://www.w3.org/2000/svg">
    <line x1="38" y1="6"  x2="5"  y2="24" stroke="white" strokeWidth="3.5" strokeLinecap="round"/>
    <line x1="38" y1="6"  x2="62" y2="18" stroke="white" strokeWidth="3.5" strokeLinecap="round"/>
    <line x1="5"  y1="24" x2="18" y2="48" stroke="white" strokeWidth="3.5" strokeLinecap="round"/>
    <line x1="18" y1="48" x2="36" y2="70" stroke="white" strokeWidth="3.5" strokeLinecap="round"/>
    <line x1="62" y1="18" x2="36" y2="70" stroke="white" strokeWidth="3.5" strokeLinecap="round"/>
    <line x1="18" y1="48" x2="38" y2="6"  stroke="white" strokeWidth="2"   strokeLinecap="round" opacity="0.7"/>
    <circle cx="38" cy="6"  r="6.5" fill="white"/>
    <circle cx="5"  cy="24" r="5"   fill="white"/>
    <circle cx="62" cy="18" r="4.5" fill="white"/>
    <circle cx="18" cy="48" r="4.5" fill="white"/>
    <circle cx="36" cy="70" r="5"   fill="white"/>
  </svg>
);

// Sunburst / asterisk mark used for brand + greeting accents
const SunburstIcon = ({ size = 24, color = "currentColor", className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} className={className} style={{ flexShrink: 0 }}>
    <rect x="10.8" y="1.5" width="2.4" height="21" rx="1.2" />
    <rect x="10.8" y="1.5" width="2.4" height="21" rx="1.2" transform="rotate(45 12 12)" />
    <rect x="10.8" y="1.5" width="2.4" height="21" rx="1.2" transform="rotate(90 12 12)" />
    <rect x="10.8" y="1.5" width="2.4" height="21" rx="1.2" transform="rotate(135 12 12)" />
  </svg>
);

// ─── CUSTOM AI PERSONAS ────────────────────────────────────────────────────────
const DEFAULT_PERSONAS = [
  { id: "default",  name: "VetroAI",          avatar: <VetroSpark size={28} color="#d97757" />, color: "#d97757", prompt: "" },
  { id: "teacher",  name: "Professor",         avatar: <GraduationCap size={24} />, color: "#3b82f6", prompt: "You are a patient, encouraging professor. Break down complex topics with examples. Always check for understanding." },
  { id: "coder",    name: "Senior Dev",        avatar: <Terminal size={24} />, color: "#10b981", prompt: "You are a senior software engineer with 15 years of experience. Write clean, efficient, production-ready code. Explain trade-offs." },
  { id: "coach",    name: "Life Coach",        avatar: <Star size={24} />, color: "#f59e0b", prompt: "You are an empathetic life coach. Help users set goals, overcome challenges, and think positively. Be supportive and actionable." },
  { id: "socrates", name: "Socratic Tutor",    avatar: <Brain size={24} />, color: "#ec4899", prompt: "You are a Socratic tutor. Never give direct answers — guide students to discover answers themselves through thoughtful questions." },
  { id: "creative", name: "Creative Director", avatar: <Paintbrush size={24} />, color: "#ef4444", prompt: "You are a creative director and writer. Think outside the box. Your responses are vivid, imaginative, and full of originality." },
];
const getCustomPersonas = () => { try { return JSON.parse(localStorage.getItem("vetroai_personas") || "[]"); } catch { return []; } };
const saveCustomPersonas = (p) => localStorage.setItem("vetroai_personas", JSON.stringify(p));

// ─── CONTEXT WINDOW ESTIMATOR ─────────────────────────────────────────────────
const estimateTokens = (messages) => {
  const chars = messages.reduce((a, m) => a + (m.content?.length || 0), 0);
  return Math.ceil(chars / 4);
};

// Strict truncation detection — only fire for definite structural breaks
const isLikelyTruncatedAnswer = (text = "") => {
  const t = String(text || "").trim();
  // Require a substantial response before checking
  if (!t || t.length < 300) return false;

  // Unclosed code fences — most reliable signal
  const fences = (t.match(/```/g) || []).length;
  if (fences % 2 !== 0) return true;

  // Trailing operator that clearly indicates code was cut mid-statement
  if (/[([{,=]\s*$/.test(t)) return true;

  // Mid-numbered-list cut: ends with just "N." or "N)" alone on a line
  const lines    = t.split("\n").map(l => l.trim()).filter(Boolean);
  const lastLine = lines[lines.length - 1] || "";
  if (/^\s*\d+[.)]\s*$/.test(lastLine)) return true;

  return false;
};

// ─── YOUTUBE HELPERS ──────────────────────────────────────────────────────────
const YOUTUBE_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:(?:youtube\.com\/watch\?v=)|(?:youtu\.be\/)|(?:youtube\.com\/embed\/)|(?:youtube\.com\/shorts\/))([a-zA-Z0-9_-]{11})/;
const extractVideoId = (text) => { const m = text.match(YOUTUBE_REGEX); return m ? m[1] : null; };

const fetchYouTubeInfo = async (videoId) => {
  try {
    const r = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
    const d = await r.json();
    return { title: d.title || "YouTube Video", author: d.author_name || "", thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`, videoId };
  } catch {
    return { title: "YouTube Video", author: "", thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`, videoId };
  }
};

const fetchYouTubeTranscript = async (videoId) => {
  const fromKome = async () => {
    const r = await fetch("https://api.kome.ai/api/tools/youtube-transcripts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video_id: videoId, format: true }),
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.transcript || null;
  };
  const fromAzure = async () => {
    const r = await fetch(`https://transcr-ibe6fxe9g8e9a2fy.centralindia-01.azurewebsites.net/transcript?id=${videoId}`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const d = await r.json();
    return Array.isArray(d) ? d.map(t => t.text).join(" ") : null;
  };
  const settled = await Promise.allSettled([fromKome(), fromAzure()]);
  const first = settled.find(s => s.status === "fulfilled" && s.value && String(s.value).trim().length > 20);
  return first?.value || null;
};

// ─── YOUTUBE EMBED ────────────────────────────────────────────────────────────
function YouTubeEmbed({ videoId, title, author }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="yt-embed">
      {expanded ? (
        <iframe width="100%" height="280"
          src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`}
          title={title} frameBorder="0" allowFullScreen
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          style={{ borderRadius: 10, display: "block" }} />
      ) : (
        <div className="yt-thumb" onClick={() => setExpanded(true)}>
          <img src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`} alt={title} />
          <div className="yt-play-btn">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="24" fill="rgba(255,0,0,0.9)" />
              <polygon points="19,14 38,24 19,34" fill="white" />
            </svg>
          </div>
        </div>
      )}
      <div className="yt-meta">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="red">
          <path d="M21.8 8s-.2-1.4-.8-2c-.8-.8-1.6-.8-2-.9C16.3 5 12 5 12 5s-4.3 0-7 .1c-.4.1-1.2.1-2 .9-.6.6-.8 2-.8 2S2 9.6 2 11.2v1.5c0 1.6.2 3.2.2 3.2s.2 1.4.8 2c.8.8 1.8.8 2.2.8C6.6 19 12 19 12 19s4.3 0 7-.1c.4-.1 1.2-.1 2-.9.6-.6.8-2 .8-2s.2-1.6.2-3.2v-1.5C22 9.6 21.8 8 21.8 8z" />
          <polygon points="10,8 10,16 16,12" fill="white" />
        </svg>
        <span className="yt-title-text">{title}</span>
        {author && <span className="yt-author">· {author}</span>}
      </div>
    </div>
  );
}

// ─── CALCULATOR WIDGET ────────────────────────────────────────────────────────
function CalcWidget({ onClose }) {
  const [expr, setExpr] = useState("");
  const [result, setResult] = useState("");
  const [hist, setHist] = useState([]);

  const calc = () => {
    if (!expr.trim()) return;
    try {
      const cleaned = expr.replace(/×/g, "*").replace(/÷/g, "/").replace(/\^/g, "**").replace(/π/g, "Math.PI").replace(/√(\d+)/g, "Math.sqrt($1)");
      const res = Function(`"use strict"; return (${cleaned})`)();
      const rounded = parseFloat(res.toFixed(10));
      setResult(String(rounded));
      setHist(h => [`${expr} = ${rounded}`, ...h.slice(0, 9)]);
    } catch { setResult("Error"); }
  };

  const btn = (v) => {
    if (v === "C") { setExpr(""); setResult(""); return; }
    if (v === "⌫") { setExpr(e => e.slice(0, -1)); return; }
    if (v === "=") { calc(); return; }
    if (v === "√") { setExpr(e => e + "√("); return; }
    if (v === "x²") { setExpr(e => e + "^2"); return; }
    if (v === "π") { setExpr(e => e + "π"); return; }
    setExpr(e => e + v);
  };

  const rows = [
    ["C", "⌫", "π", "÷"], ["7", "8", "9", "×"], ["4", "5", "6", "-"],
    ["1", "2", "3", "+"], ["√", "0", ".", "="], ["(", ")", "x²", "^"],
  ];

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 320 }}>
        <div className="modal-topbar">
          <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: 8 }}><Calculator size={18} /> Calculator</h3>
          <button className="modal-x" onClick={onClose} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}><X size={14} /></button>
        </div>
        <div className="modal-body">
          <div className="calc-display">
            <div className="calc-expr">{expr || "0"}</div>
            <div className="calc-result">{result}</div>
          </div>
          <div className="calc-btns">
            {rows.map((row, ri) => (
              <div key={ri} className="calc-row">
                {row.map(v => (
                  <button key={v}
                    className={`calc-btn${v === "=" ? " eq" : ["C", "⌫"].includes(v) ? " fn" : ["÷", "×", "-", "+", "^", "√", "x²", "π"].includes(v) ? " op" : ""}`}
                    onClick={() => btn(v)}>{v}</button>
                ))}
              </div>
            ))}
          </div>
          {hist.length > 0 && (
            <div className="calc-hist">
              <div className="calc-hist-label">History</div>
              {hist.map((h, i) => <div key={i} className="calc-hist-item" onClick={() => { const parts = h.split(" = "); if (parts[1]) setResult(parts[1]); }}>{h}</div>)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// ─── WEB SEARCH ──────────────────────────────────────────────────────────────
const CURRENT_TRIGGERS = [
  /\b(today|tonight|now|current|currently|live|latest|recent|breaking|news)\b/i,
  /\b(2024|2025|2026|this (year|month|week|day))\b/i,
  /\b(who (is|was|won|leads|runs)|what is the (score|price|rate|status))\b/i,
  /\b(stock|crypto|bitcoin|market|weather|election|war|match|game|ipl|cricket|football)\b/i,
  /\b(just (happened|announced|released|launched))\b/i,
  /\b(trending|viral|happening)\b/i,
  /\b(compare|comparison|versus|vs|ranking|top|highest|lowest|trend|growth|decline|over time|history|historical|percentage|distribution|breakdown)\b/i,
];
const needsWebSearch = (q) => CURRENT_TRIGGERS.some(rx => rx.test(q));




// ─── IMAGE GENERATION ─────────────────────────────────────────────────────────
const IMAGE_DETECT = /\b(generate|create|make|draw|paint|design|render|show me|give me)\b.{0,80}\b(image|picture|photo|artwork|illustration|portrait|sketch|logo|wallpaper|icon|poster|banner|thumbnail|graphic|meme|avatar|cover)\b/i;
const detectImagePrompt = (text) => {
  if (!IMAGE_DETECT.test(text)) return null;
  return text.replace(/^.*(generate|create|make|draw|paint|design|render|show me|give me)\s+(an?\s+|the\s+)?(image|picture|photo|artwork|illustration|portrait|sketch|logo|wallpaper|icon|poster|banner|thumbnail|graphic|meme|avatar|cover)\s+(of\s+|for\s+|about\s+|showing\s+)?/i, "").trim() || text;
};
const generateImageViaAgnes = async (prompt) => {
  const res = await fetch(`${API}/generate-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw new Error(`Image generation failed (${res.status})`);
  const json = await res.json();
  return json?.data?.url;
};


// ─── MEDIA GENERATION LOADING CARD ────────────────────────────────────────────
const MediaGenCard = ({ type, text }) => (
  <div className="media-gen-card">
    <div className="media-gen-preview">
      <div className="media-gen-shimmer" />
      <div className="media-gen-icon">
        {type === "video" ? (
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        ) : (
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
        )}
      </div>
    </div>
    <div className="media-gen-info">
      <div className="media-gen-status">
        <div className="media-gen-spinner" />
        <span>{text || (type === "video" ? "Generating video..." : "Generating image...")}</span>
      </div>
      <div className="media-gen-hint">
        {type === "video" ? "This may take a few minutes" : "Almost there..."}
      </div>
    </div>
  </div>
);

// ─── VIDEO GENERATION ─────────────────────────────────────────────────────────
const VIDEO_DETECT = /\b(generate|create|make|render|produce|give me)\b.{0,80}\b(video|animation|clip|movie|film|motion|reel|cinematic)\b/i;
const detectVideoPrompt = (text) => {
  if (!VIDEO_DETECT.test(text)) return null;
  return text.replace(/^.*(generate|create|make|render|produce|give me)\s+(an?\s+|the\s+)?(video|animation|clip|movie|film|motion|reel|cinematic)\s+(of\s+|about\s+|showing\s+|for\s+)?/i, "").trim() || text;
};

const generateVideoViaAgnes = async (prompt) => {
  const res = await fetch(`${API}/generate-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw new Error(`Video generation failed (${res.status})`);
  const json = await res.json();
  return json?.data?.videoId;
};

const pollVideoStatus = async (videoId, onProgress) => {
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const res = await fetch(`${API}/video-status/${encodeURIComponent(videoId)}`);
    if (!res.ok) throw new Error(`Status check failed (${res.status})`);
    const json = await res.json();
    const { status, progress, videoUrl } = json?.data || {};
    if (onProgress) onProgress(progress || 0);
    if (status === "completed" && videoUrl) return videoUrl;
    if (status === "failed") throw new Error("Video generation failed");
  }
  throw new Error("Video generation timed out");
};

// ─── TRANSLATIONS ─────────────────────────────────────────────────────────────
const LANGS = {
  en: { flag: "EN", name: "English", t: {
    newChat: "New chat", search: "Search…", logout: "Sign out", send: "Send",
    placeholder: "Message VetroAI…", listening: "Listening…", share: "Share", stop: "Stop",
    welcome: "Good to see you.", welcomeSub: "Ask me anything — I'm here to help.",
    profile: "Profile", displayName: "Display name", nameHolder: "Your name", changeAvatar: "Avatar",
    save: "Save", saved: "Saved!", cancel: "Cancel", lang: "Language",
    shortcuts: "Shortcuts", shortcutsTitle: "Keyboard shortcuts",
    copy: "Copy", copied: "Copied!", readAloud: "Read aloud", edit: "Edit", regen: "Retry", del: "Delete",
    pin: "Pin", unpin: "Unpin", voiceListen: "Listening…", voiceThink: "Thinking…", voiceSpeak: "Speaking…",
    tapStop: "Tap to stop", tapWait: "Please wait…", tapInterrupt: "Tap to interrupt",
    today: "Today", yesterday: "Yesterday", older: "Earlier",
    systemPrompt: "Instructions", systemPromptLabel: "Custom instructions", systemPromptHolder: "You are a helpful assistant…",
    systemPromptBadge: "Custom instructions active", clearPrompt: "Clear",
    presets: "Presets", searchInChat: "Search in conversation…", noResults: "No matches",
    shareTitle: "Share conversation", shareNote: "Anyone with this link can view the conversation.",
    pinnedSection: "Pinned", allChats: "Recent", exportChat: "Export",
    chars: "chars", tokens: "tokens", saveAndSend: "Save & send",
    webSearching: "Searching the web…", webSearched: "Web search used",
    bookmarks: "Bookmarks", noBookmarks: "No bookmarks yet",
    memories: "Memory", clearMemory: "Clear memory",
    followUp: "Follow up…", generatingImage: "Generating image…",
    ytAnalyzing: "Fetching YouTube transcript…", ytNotes: "YouTube notes generated",
    scList: [
      { keys: ["Ctrl", "K"], desc: "New chat" }, { keys: ["Ctrl", "/"], desc: "Focus input" },
      { keys: ["Ctrl", "P"], desc: "Profile" }, { keys: ["Ctrl", "F"], desc: "Search" },
      { keys: ["Esc"], desc: "Close" }, { keys: ["Enter"], desc: "Send" }, { keys: ["Shift", "↵"], desc: "New line" },
    ],
    suggestions: ["Explain a concept simply", "Help me write something", "Debug my code", "Plan my week", "Summarize a topic", "Give me ideas"],
  }},
  hi: { flag: "HI", name: "हिंदी", t: {
    newChat: "नई चैट", search: "खोजें…", logout: "साइन आउट", send: "भेजें",
    placeholder: "VetroAI को संदेश…", listening: "सुन रहा हूँ…", share: "शेयर", stop: "रोकें",
    welcome: "नमस्ते!", welcomeSub: "मैं आपकी कैसे मदद कर सकता हूँ?",
    profile: "प्रोफ़ाइल", displayName: "नाम", nameHolder: "आपका नाम", changeAvatar: "अवतार",
    save: "सहेजें", saved: "सहेज लिया!", cancel: "रद्द करें", lang: "भाषा",
    shortcuts: "शॉर्टकट", shortcutsTitle: "कीबोर्ड शॉर्टकट",
    copy: "कॉपी", copied: "कॉपी!", readAloud: "पढ़ें", edit: "संपादित", regen: "फिर से", del: "हटाएं",
    pin: "पिन", unpin: "अनपिन", voiceListen: "सुन रहा हूँ…", voiceThink: "सोच रहा हूँ…", voiceSpeak: "बोल रहा हूँ…",
    tapStop: "रोकने के लिए टैप करें", tapWait: "कृपया प्रतीक्षा करें…", tapInterrupt: "टैप करें",
    today: "आज", yesterday: "कल", older: "पहले",
    systemPrompt: "निर्देश", systemPromptLabel: "कस्टम निर्देश", systemPromptHolder: "आप एक सहायक हैं…",
    systemPromptBadge: "कस्टम निर्देश सक्रिय", clearPrompt: "हटाएं",
    presets: "प्रीसेट", searchInChat: "बातचीत में खोजें…", noResults: "कोई परिणाम नहीं",
    shareTitle: "बातचीत शेयर करें", shareNote: "इस लिंक से बातचीत देखी जा सकती है।",
    pinnedSection: "पिन किए गए", allChats: "हाल ही में", exportChat: "एक्सपोर्ट",
    chars: "अक्षर", tokens: "टोकन", saveAndSend: "सहेजें और भेजें",
    webSearching: "वेब खोज हो रही है…", webSearched: "वेब खोज उपयोग हुई",
    bookmarks: "बुकमार्क", noBookmarks: "कोई बुकमार्क नहीं",
    memories: "मेमोरी", clearMemory: "मेमोरी साफ करें",
    followUp: "आगे पूछें…", generatingImage: "छवि बन रही है…",
    ytAnalyzing: "YouTube ट्रांसक्रिप्ट लाया जा रहा है…", ytNotes: "YouTube नोट्स तैयार",
    scList: [
      { keys: ["Ctrl", "K"], desc: "नई चैट" }, { keys: ["Ctrl", "/"], desc: "इनपुट" },
      { keys: ["Ctrl", "P"], desc: "प्रोफ़ाइल" }, { keys: ["Ctrl", "F"], desc: "खोज" },
      { keys: ["Esc"], desc: "बंद" }, { keys: ["Enter"], desc: "भेजें" }, { keys: ["Shift", "↵"], desc: "नई लाइन" },
    ],
    suggestions: ["कुछ सरल समझाएं", "कुछ लिखने में मदद करें", "कोड डीबग करें", "सप्ताह की योजना", "विषय सारांश", "विचार दें"],
  }},
  kn: { flag: "KN", name: "ಕನ್ನಡ", t: {
    newChat: "ಹೊಸ ಚಾಟ್", search: "ಹುಡುಕಿ…", logout: "ಸೈನ್ ಔಟ್", send: "ಕಳುಹಿಸಿ",
    placeholder: "VetroAI ಗೆ ಸಂದೇಶ…", listening: "ಕೇಳುತ್ತಿದ್ದೇನೆ…", share: "ಹಂಚಿ", stop: "ನಿಲ್ಲಿಸಿ",
    welcome: "ಸ್ವಾಗತ!", welcomeSub: "ನಾನು ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?",
    profile: "ಪ್ರೊಫೈಲ್", displayName: "ಹೆಸರು", nameHolder: "ನಿಮ್ಮ ಹೆಸರು", changeAvatar: "ಅವತಾರ್",
    save: "ಉಳಿಸಿ", saved: "ಉಳಿಸಲಾಗಿದೆ!", cancel: "ರದ್ದು", lang: "ಭಾಷೆ",
    shortcuts: "ಶಾರ್ಟ್‌ಕಟ್", shortcutsTitle: "ಕೀಬೋರ್ಡ್ ಶಾರ್ಟ್‌ಕಟ್",
    copy: "ಕಾಪಿ", copied: "ಕಾಪಿ!", readAloud: "ಓದಿ", edit: "ಸಂಪಾದಿಸಿ", regen: "ಮತ್ತೆ", del: "ಅಳಿಸಿ",
    pin: "ಪಿನ್", unpin: "ಅನ್‌ಪಿನ್", voiceListen: "ಕೇಳುತ್ತಿದ್ದೇನೆ…", voiceThink: "ಯೋಚಿಸುತ್ತಿದ್ದೇನೆ…", voiceSpeak: "ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ…",
    tapStop: "ನಿಲ್ಲಿಸಲು ಟ್ಯಾಪ್", tapWait: "ದಯವಿಟ್ಟು ಕಾಯಿರಿ…", tapInterrupt: "ಟ್ಯಾಪ್ ಮಾಡಿ",
    today: "ಇಂದು", yesterday: "ನಿನ್ನೆ", older: "ಮೊದಲು",
    systemPrompt: "ಸೂಚನೆಗಳು", systemPromptLabel: "ಕಸ್ಟಮ್ ಸೂಚನೆಗಳು", systemPromptHolder: "ನೀವು ಸಹಾಯಕ…",
    systemPromptBadge: "ಕಸ್ಟಮ್ ಸೂಚನೆಗಳು ಸಕ್ರಿಯ", clearPrompt: "ತೆಗೆದುಹಾಕಿ",
    presets: "ಪ್ರೀಸೆಟ್", searchInChat: "ಸಂಭಾಷಣೆಯಲ್ಲಿ ಹುಡುಕಿ…", noResults: "ಫಲಿತಾಂಶಗಳಿಲ್ಲ",
    shareTitle: "ಹಂಚಿಕೊಳ್ಳಿ", shareNote: "ಈ ಲಿಂಕ್‌ನಿಂದ ಸಂಭಾಷಣೆ ನೋಡಬಹುದು.",
    pinnedSection: "ಪಿನ್ ಮಾಡಲಾದವು", allChats: "ಇತ್ತೀಚಿನ", exportChat: "ಎಕ್ಸ್‌ಪೋರ್ಟ್",
    chars: "ಅಕ್ಷರ", tokens: "ಟೋಕನ್", saveAndSend: "ಉಳಿಸಿ ಮತ್ತು ಕಳುಹಿಸಿ",
    webSearching: "ವೆಬ್ ಹುಡುಕಾಟ…", webSearched: "ವೆಬ್ ಹುಡುಕಾಟ ಬಳಸಲಾಗಿದೆ",
    bookmarks: "ಬುಕ್‌ಮಾರ್ಕ್", noBookmarks: "ಬುಕ್‌ಮಾರ್ಕ್‌ಗಳಿಲ್ಲ",
    memories: "ಮೆಮೊರಿ", clearMemory: "ಮೆಮೊರಿ ತೆರವು",
    followUp: "ಮುಂದೆ ಕೇಳಿ…", generatingImage: "ಚಿತ್ರ ರಚಿಸಲಾಗುತ್ತಿದೆ…",
    ytAnalyzing: "YouTube ಟ್ರಾನ್ಸ್‌ಕ್ರಿಪ್ಟ್ ತರಲಾಗುತ್ತಿದೆ…", ytNotes: "YouTube ಟಿಪ್ಪಣಿಗಳು ಸಿದ್ಧ",
    scList: [
      { keys: ["Ctrl", "K"], desc: "ಹೊಸ ಚಾಟ್" }, { keys: ["Ctrl", "/"], desc: "ಇನ್ಪುಟ್" },
      { keys: ["Ctrl", "P"], desc: "ಪ್ರೊಫೈಲ್" }, { keys: ["Ctrl", "F"], desc: "ಹುಡುಕಿ" },
      { keys: ["Esc"], desc: "ಮುಚ್ಚಿ" }, { keys: ["Enter"], desc: "ಕಳುಹಿಸಿ" }, { keys: ["Shift", "↵"], desc: "ಹೊಸ ಸಾಲು" },
    ],
    suggestions: ["ಸರಳವಾಗಿ ವಿವರಿಸಿ", "ಬರೆಯಲು ಸಹಾಯ", "ಕೋಡ್ ಡೀಬಗ್", "ವಾರದ ಯೋಜನೆ", "ಸಾರಾಂಶ", "ಆಲೋಚನೆಗಳು"],
  }},
  es: { flag: "ES", name: "Español", t: {
    newChat: "Nuevo chat", search: "Buscar…", logout: "Cerrar sesión", send: "Enviar",
    placeholder: "Mensaje a VetroAI…", listening: "Escuchando…", share: "Compartir", stop: "Detener",
    welcome: "Hola de nuevo.", welcomeSub: "¿En qué puedo ayudarte hoy?",
    profile: "Perfil", displayName: "Nombre", nameHolder: "Tu nombre", changeAvatar: "Avatar",
    save: "Guardar", saved: "¡Guardado!", cancel: "Cancelar", lang: "Idioma",
    shortcuts: "Atajos", shortcutsTitle: "Atajos de teclado",
    copy: "Copiar", copied: "¡Copiado!", readAloud: "Leer", edit: "Editar", regen: "Reintentar", del: "Eliminar",
    pin: "Fijar", unpin: "Desfijar", voiceListen: "Escuchando…", voiceThink: "Pensando…", voiceSpeak: "Hablando…",
    tapStop: "Toca para detener", tapWait: "Por favor espera…", tapInterrupt: "Toca para interrumpir",
    today: "Hoy", yesterday: "Ayer", older: "Antes",
    systemPrompt: "Instrucciones", systemPromptLabel: "Instrucciones personalizadas", systemPromptHolder: "Eres un asistente…",
    systemPromptBadge: "Instrucciones activas", clearPrompt: "Borrar",
    presets: "Presets", searchInChat: "Buscar en conversación…", noResults: "Sin resultados",
    shareTitle: "Compartir conversación", shareNote: "Cualquiera con este enlace puede ver la conversación.",
    pinnedSection: "Fijados", allChats: "Recientes", exportChat: "Exportar",
    chars: "caract.", tokens: "tokens", saveAndSend: "Guardar y enviar",
    webSearching: "Buscando en la web…", webSearched: "Búsqueda web usada",
    bookmarks: "Marcadores", noBookmarks: "Sin marcadores",
    memories: "Memoria", clearMemory: "Borrar memoria",
    followUp: "Preguntar más…", generatingImage: "Generando imagen…",
    ytAnalyzing: "Obteniendo transcripción…", ytNotes: "Notas de YouTube listas",
    scList: [
      { keys: ["Ctrl", "K"], desc: "Nuevo chat" }, { keys: ["Ctrl", "/"], desc: "Entrada" },
      { keys: ["Ctrl", "P"], desc: "Perfil" }, { keys: ["Ctrl", "F"], desc: "Buscar" },
      { keys: ["Esc"], desc: "Cerrar" }, { keys: ["Enter"], desc: "Enviar" }, { keys: ["Shift", "↵"], desc: "Nueva línea" },
    ],
    suggestions: ["Explica algo simple", "Ayúdame a escribir", "Depura mi código", "Planifica mi semana", "Resume este tema", "Dame ideas"],
  }},
};

const PROVIDERS = ["Agnes", "Groq", "Gemini", "Mistral", "SambaNova"];

const MODES_LIST = [
  { id: "normal", name: "Normal Chat", icon: "Bot", desc: "General conversation and assistant" },
  { id: "deep_search", name: "DeepSearch", icon: "Brain", desc: "Multi-query research with citations" },
  { id: "analyst", name: "Data Analysis", icon: "Calculator", desc: "Deep data analysis and structured reports" },
  { id: "multi_ai", name: "Multi-AI", icon: "Zap", desc: "5 AI models + Web Search — best answer wins" },
  { id: "debugger", name: "Code", icon: "Terminal", desc: "Expert code analysis and debugging" },
  { id: "summarize", name: "Summarize", icon: "FileText", desc: "Docs and long text synthesis" },
];

const ModelIcon = ({ id, size = 16 }) => {
  switch(id) {
    case "fast_chat":
    case "multi_ai":     return <Zap size={size} />;
    case "vtu_academic": return <GraduationCap size={size} />;
    case "debugger":     return <Terminal size={size} />;
    case "creative":     return <Paintbrush size={size} />;
    case "analyst":      return <Calculator size={size} />;
    case "summarize":    return <FileText size={size} />;
    case "research":
    case "web_search":
    case "translator":   return <Globe size={size} />;
    case "deep_search":  return <Brain size={size} />;
    case "youtube":      return <Play size={size} />;
    case "interviewer":  return <Target size={size} />;
    case "astrology":    return <Star size={size} />;
    case "normal":
    case "vision":
    case "persona":      return <Bot size={size} />;
    default:             return <Bot size={size} />;
  }
};

// Keep MODES alias for any legacy references
const MODES = MODES_LIST.map(m => ({ id: m.id, name: m.name }));


const AVATARS = ["User", "Bot", "Zap", "Brain", "Globe", "Star", "Flame", "Rocket", "Palette", "Moon", "Sun", "Target", "Compass", "Anchor", "Crown", "Gem", "Shield", "Heart", "Key", "Lock"];

const AvatarIcon = ({ name, size = 16 }) => {
  const Icon = {
    User, Bot, Zap, Brain, Globe, Star, Flame, Rocket, Palette, Moon, Sun, Target, Compass, Anchor, Crown, Gem, Shield, Heart, Key, Lock
  }[name] || User;
  return <Icon size={size} />;
};

const SYSTEM_PRESETS = [
  "You are a Socratic tutor. Guide with questions only.",
  "You are a senior software engineer. Be concise and precise.",
  "You are a creative writing coach. Be vivid and encouraging.",
  "You are a debate partner. Challenge every claim rigorously.",
  "You are an expert on Indian culture, history, and traditions.",
  "You are a startup advisor. Focus on actionable insights.",
  "You are a medical information assistant. Always recommend consulting a doctor.",
  "You are a math tutor. Show step-by-step working for all problems.",
];
const REACTIONS = ["ThumbsUp", "Heart", "Smile", "Frown", "Flame", "Brain"];

const ReactionIcon = ({ name, size = 14 }) => {
  const Icon = {
    ThumbsUp, Heart, Smile, Frown, Flame, Brain
  }[name] || ThumbsUp;
  return <Icon size={size} />;
};

function getDateGroup(id, t) {
  const ts = parseInt(id, 10);
  if (isNaN(ts)) return t.older;
  const d = (Date.now() - ts) / 86400000;
  if (d < 1) return t.today;
  if (d < 2) return t.yesterday;
  return t.older;
}

// ─── ICONS ────────────────────────────────────────────────────────────────────
const Ic = ({ d, size = 16, fill = "none", sw = 1.75 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    {typeof d === "string" ? <path d={d} /> : d}
  </svg>
);
const SendIcon     = () => <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="11" fill="var(--ink)" stroke="none" /><path d="M12 16V8M8 12l4-4 4 4" stroke="var(--bg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const MicIcon      = () => <Ic size={17} d={<><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></>} />;
const WaveIcon     = () => <svg width={17} height={17} viewBox="0 0 24 24" fill="currentColor"><rect x="11" y="3" width="2" height="18" rx="1" /><rect x="7" y="8" width="2" height="8" rx="1" /><rect x="15" y="8" width="2" height="8" rx="1" /><rect x="3" y="10" width="2" height="4" rx="1" /><rect x="19" y="10" width="2" height="4" rx="1" /></svg>;
const StopIcon     = () => <Ic size={15} d={<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />} />;
const CopyIcon     = () => <Ic size={14} d={<><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>} />;
const EditIcon     = () => <Ic size={14} d={<><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></>} />;
const SpeakIcon    = () => <Ic size={14} d={<><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" /></>} />;
const ReloadIcon   = () => <Ic size={14} d={<><path d="M21.5 2v6h-6" /><path d="M2.5 22v-6h6" /><path d="M2 11.5a10 10 0 0 1 18.8-4.3" /><path d="M22 12.5a10 10 0 0 1-18.8 4.3" /></>} />;
const TrashIcon    = () => <Ic size={13} d={<><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>} />;
const XIcon        = () => <Ic size={18} d={<><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>} />;
const MenuIcon     = () => <Ic size={19} d={<><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /></>} />;
const PlusIcon     = () => <Ic size={14} d={<><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>} />;
const SearchIcon   = () => <Ic size={14} d={<><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>} />;
const CheckIcon    = () => <Ic size={13} d="M20 6L9 17L4 12" />;
const PinIcon      = () => <Ic size={13} d={<><path d="M12 2l2 6h4l-3.3 2.4 1.3 6L12 13l-4 3.4 1.3-6L6 8h4z" /></>} />;
const BotIcon      = () => <Ic size={14} d={<><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /></>} />;
const UserIcon     = () => <Ic size={14} d={<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>} />;
const GlobeIcon    = () => <Ic size={14} d={<><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>} />;
const KbdIcon      = () => <Ic size={14} d={<><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" /></>} />;
const SunIcon      = () => <Ic size={15} d={<><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></>} />;
const MoonIcon     = () => <Ic size={15} d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />;
const ShareIcon    = () => <Ic size={14} d={<><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></>} />;
const DlIcon       = () => <Ic size={14} d={<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>} />;
const SmileIcon    = () => <Ic size={14} d={<><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></>} />;
const BoldIcon     = () => <Ic size={13} d={<><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" /><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" /></>} />;
const ItalicIcon   = () => <Ic size={13} d={<><line x1="19" y1="4" x2="10" y2="4" /><line x1="14" y1="20" x2="5" y2="20" /><line x1="15" y1="4" x2="9" y2="20" /></>} />;
const CodeIc2      = () => <Ic size={13} d={<><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></>} />;
const ChevDown     = () => <Ic size={12} d="M6 9l6 6 6-6" />;
const BookmarkIcon = () => <Ic size={14} d={<><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></>} />;
const BrainIcon    = () => <Ic size={14} d={<><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-1.07-4.56A3 3 0 0 1 3 12a3 3 0 0 1 2.22-2.9 2.5 2.5 0 0 1 .28-3.6A2.5 2.5 0 0 1 9.5 2z" /><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 1.07-4.56A3 3 0 0 0 21 12a3 3 0 0 0-2.22-2.9 2.5 2.5 0 0 0-.28-3.6A2.5 2.5 0 0 0 14.5 2z" /></>} />;
const ImageIcon    = () => <Ic size={14} d={<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></>} />;
const SparkleIcon  = () => <Ic size={14} d={<><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" /><path d="M5 3l.6 1.8L7.4 5.4 5.6 6l-.6 1.8-.6-1.8L2.6 5.4l1.8-.6z" /><path d="M19 15l.6 1.8 1.8.6-1.8.6-.6 1.8-.6-1.8-1.8-.6 1.8-.6z" /></>} />;
const CalcIcon     = () => <Ic size={14} d={<><rect x="4" y="2" width="16" height="20" rx="2" /><line x1="8" y1="6" x2="16" y2="6" /><line x1="8" y1="10" x2="8" y2="10" /><line x1="12" y1="10" x2="12" y2="10" /><line x1="16" y1="10" x2="16" y2="10" /><line x1="8" y1="14" x2="8" y2="14" /><line x1="12" y1="14" x2="12" y2="14" /><line x1="16" y1="14" x2="16" y2="14" /><line x1="8" y1="18" x2="12" y2="18" /></>} />;
const TimerIcon    = () => <Ic size={14} d={<><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2" /><path d="M9 3h6" /><path d="M12 3v2" /></>} />;
const YTIcon       = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.8 8s-.2-1.4-.8-2c-.8-.8-1.6-.8-2-.9C16.3 5 12 5 12 5s-4.3 0-7 .1c-.4.1-1.2.1-2 .9-.6.6-.8 2-.8 2S2 9.6 2 11.2v1.5c0 1.6.2 3.2.2 3.2s.2 1.4.8 2c.8.8 1.8.8 2.2.8C6.6 19 12 19 12 19s4.3 0 7-.1c.4-.1 1.2-.1 2-.9.6-.6.8-2 .8-2s.2-1.6.2-3.2v-1.5C22 9.6 21.8 8 21.8 8z" />
    <polygon points="10,8 10,16 16,12" />
  </svg>
);
const WebSpinIcon  = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 1s linear infinite" }}>
    <circle cx="12" cy="12" r="10" opacity={0.25} /><path d="M12 2a10 10 0 0 1 10 10" />
  </svg>
);
const ThumbsUpIcon = () => <Ic size={14} d={<><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z" /><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" /></>} />;
const ThumbsDnIcon = () => <Ic size={14} d={<><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z" /><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" /></>} />;

// ─── CODE BLOCK ───────────────────────────────────────────────────────────────
// ─── WRITING BLOCK DETECTION ──────────────────────────────────────────────────
function isWritingBlock(text) {
  if (!text || text.length < 200) return false;
  return (
    /^(subject:|dear\s|to whom|re:\s)/im.test(text) ||
    /\n(sincerely,?|regards,?|yours truly,?|best regards,?|thank you,?)\s*\n?$/im.test(text)
  );
}
function getWritingTitle(text) {
  const subj = text.match(/\*?\*?subject:\*?\*?\s*(.+)/i);
  if (subj) return subj[1].replace(/[*_]/g, '').trim();
  const re = text.match(/re:\s*(.+)/i);
  if (re) return re[1].replace(/[*_]/g, '').trim();
  const line = text.split('\n').find(l => l.trim().length > 3 && !/^(from:|to:|date:|cc:|dear)/i.test(l.trim()));
  return (line || 'Document').replace(/[*_#]/g, '').trim().slice(0, 60);
}

function WritingBlockCard({ content }) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing]   = useState(false);
  const [draft, setDraft]       = useState(content);
  const [copied, setCopied]     = useState(false);
  const title = getWritingTitle(content);
  const doCopy = () => { navigator.clipboard.writeText(draft); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const doDownload = () => {
    const blob = new Blob([draft], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = title.slice(0, 40).replace(/\s+/g, '_').replace(/[^\w_]/g, '') + '.txt';
    a.click();
  };
  const doShare = () => navigator.share ? navigator.share({ title, text: draft }).catch(() => {}) : navigator.clipboard.writeText(draft);
  return (
    <div className="writing-block">
      <div className="writing-block-header">
        <div className="writing-block-title"><FileText size={14} /><span>{title}</span></div>
        <div className="writing-block-acts">
          {!editing && <button className="wb-btn" onClick={() => setEditing(true)} title="Edit" aria-label="Edit"><EditIcon /></button>}
          <button className="wb-btn" onClick={doCopy} title="Copy" aria-label="Copy">{copied ? <CheckIcon /> : <CopyIcon />}</button>
          <button className="wb-btn" onClick={doDownload} title="Download" aria-label="Download"><DlIcon /></button>
          <button className="wb-btn" onClick={doShare} title="Share" aria-label="Share"><ShareIcon /></button>
          <button className="wb-btn" onClick={() => setExpanded(v => !v)} title={expanded ? 'Collapse' : 'Expand'} aria-label={expanded ? 'Collapse' : 'Expand'}>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>
      {expanded && (editing ? (
        <div>
          <textarea
            className="writing-edit-textarea"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); setEditing(false); } if (e.key === 'Escape') { setDraft(content); setEditing(false); } }}
            autoFocus
          />
          <div className="writing-edit-footer">
            <button className="ai-edit-btn-save" onClick={() => setEditing(false)}>Save</button>
            <button className="ai-edit-btn-cancel" onClick={() => { setDraft(content); setEditing(false); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="writing-block-content claude-prose">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, KATEX_OPTIONS]]}>{draft}</ReactMarkdown>
        </div>
      ))}
    </div>
  );
}

// ─── CODE BLOCK ───────────────────────────────────────────────────────────────
function CodeBlock({ match, codeString, copyLabel, onSaveArtifact }) {
  const [cp, setCp] = useState(false);
  const lang = match ? match[1] : 'text';
  const copy = () => { navigator.clipboard.writeText(codeString); setCp(true); setTimeout(() => setCp(false), 2000); };
  const download = () => {
    const extMap = { javascript:'js', typescript:'ts', python:'py', java:'java', 'c++':'cpp', html:'html', css:'css', sql:'sql' };
    const ext = extMap[lang] ?? lang ?? 'txt';
    const blob = new Blob([codeString], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `code.${ext}`; a.click();
  };
  return (
    <div className="code-wrap">
      <div className="code-header">
        <span className="code-lang">{lang}</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {onSaveArtifact && (
            <button className="code-copy-btn" onClick={onSaveArtifact} title="Open as artifact" aria-label="Open as artifact">
              <LayoutGrid size={12} />&nbsp;Artifact
            </button>
          )}
          <button className="code-copy-btn" onClick={download} title="Download file" aria-label="Download"><DlIcon />&nbsp;Download</button>
          <button className="code-copy-btn" onClick={copy} aria-label="Copy code">
            {cp ? <><CheckIcon /> Copied</> : <><CopyIcon /> {copyLabel || "Copy"}</>}
          </button>
        </div>
      </div>
      <SyntaxHighlighter style={vscDarkPlus} language={lang} PreTag="div"
        customStyle={{ margin: 0, padding: "16px 20px", background: "transparent", fontSize: "0.82rem" }}>
        {codeString}
      </SyntaxHighlighter>
    </div>
  );
}

const formatMath = txt => {
  if (!txt) return "";
  try { return String(txt).split("\\[").join("$$").split("\\]").join("$$").split("\\(").join("$").split("\\)").join("$"); }
  catch { return txt; }
};

function TypingIndicator({ text = "" }) {
  return (
    <div className="typing-wrap">
      <div className="typing"><span /><span /><span /></div>
      {text && <span className="typing-label">{text}</span>}
    </div>
  );
}

function FollowUpChips({ suggestions, loading, onSelect }) {
  if (loading) return (
    <div className="followup-row">{[1, 2, 3].map(i => <div key={i} className="followup-chip skeleton" />)}</div>
  );
  if (!suggestions?.length) return null;
  return (
    <div className="followup-row">
      {suggestions.map((s, i) => (
        <button key={i} className="followup-chip" onClick={() => onSelect(s)} style={{ "--d": `${i * 0.08}s` }}>
          <SparkleIcon /> {s}
        </button>
      ))}
    </div>
  );
}

function Toast({ toasts }) {
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type || "info"}`}>{t.message}</div>
      ))}
    </div>
  );
}

function ProfileModal({ onClose, t, langCode, setLangCode, theme, setTheme, userInfo, onProfileSaved }) {
  const PKEY = "vetroai_profile";
  const init = JSON.parse(localStorage.getItem(PKEY) || '{"name":"","avatar":"User"}');
  const [tab, setTab]     = useState("profile");
  const [name, setName]   = useState(userInfo?.name || init.name || "");
  const [avatar, setAvatar] = useState(init.avatar || "User");
  const [ok, setOk]       = useState(false);
  const save = () => {
    const data = { name, avatar };
    localStorage.setItem(PKEY, JSON.stringify(data));
    onProfileSaved?.(data);
    setOk(true);
    setTimeout(() => setOk(false), 2000);
  };

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-topbar">
          <div className="modal-tabs">
            <button className={`mtab${tab === "profile" ? " active" : ""}`} onClick={() => setTab("profile")}><UserIcon />{t.profile}</button>
            <button className={`mtab${tab === "language" ? " active" : ""}`} onClick={() => setTab("language")}><GlobeIcon />{t.lang}</button>
            <button className={`mtab${tab === "shortcuts" ? " active" : ""}`} onClick={() => setTab("shortcuts")}><KbdIcon />{t.shortcuts}</button>
          </div>
          <button className="modal-x" onClick={onClose}><XIcon /></button>
        </div>
        {tab === "profile" && (
          <div className="modal-body">
            <div className="av-center">
              <div className="av-big"><AvatarIcon name={avatar} size={40} /></div>
              {userInfo?.email && <span style={{ fontSize: "0.78rem", color: "var(--ink-3)" }}>{userInfo.email}</span>}
            </div>
            <div className="field-group">
              <label className="field-label">{t.changeAvatar}</label>
              <div className="av-grid">
                {AVATARS.map(a => (
                  <button key={a} className={`av-opt${avatar === a ? " sel" : ""}`} onClick={() => setAvatar(a)}>
                    <AvatarIcon name={a} size={20} />{avatar === a && <span className="av-check"><CheckIcon /></span>}
                  </button>
                ))}
              </div>
            </div>
            <div className="field-group">
              <label className="field-label">{t.displayName}</label>
              <input className="field-input" placeholder={t.nameHolder} value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && save()} />
            </div>
            <div className="field-group">
              <label className="field-label">Appearance</label>
              <button className="theme-row-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
                {theme === "dark" ? <SunIcon /> : <MoonIcon />} Switch to {theme === "dark" ? "light" : "dark"} mode
              </button>
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={onClose}>{t.cancel}</button>
              <button className={`btn-primary${ok ? " ok" : ""}`} onClick={save}>{ok ? <><CheckIcon />{t.saved}</> : t.save}</button>
            </div>
          </div>
        )}
        {tab === "language" && (
          <div className="modal-body">
            <div className="lang-grid">
              {Object.entries(LANGS).map(([code, lang]) => (
                <button key={code} className={`lang-opt${langCode === code ? " sel" : ""}`}
                  onClick={() => { setLangCode(code); localStorage.setItem("vetroai_lang", code); }}>
                  <span className="lang-flag">{lang.flag}</span>
                  <span className="lang-name">{lang.name}</span>
                  {langCode === code && <CheckIcon />}
                </button>
              ))}
            </div>
          </div>
        )}
        {tab === "shortcuts" && (
          <div className="modal-body">
            {t.scList.map((sc, i) => (
              <div key={i} className="sc-row">
                <div className="sc-keys">
                  {sc.keys.map((k, j) => (
                    <React.Fragment key={j}>
                      <kbd className="kbd">{k}</kbd>
                      {j < sc.keys.length - 1 && <span className="sc-plus">+</span>}
                    </React.Fragment>
                  ))}
                </div>
                <span className="sc-desc">{sc.desc}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SysPromptModal({ onClose, t, value, setValue }) {
  const [draft, setDraft] = useState(value);
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-topbar">
          <h3 className="modal-title"><BotIcon />{t.systemPrompt}</h3>
          <button className="modal-x" onClick={onClose}><XIcon /></button>
        </div>
        <div className="modal-body">
          <div className="field-group">
            <label className="field-label">{t.presets}</label>
            <div className="preset-list">
              {SYSTEM_PRESETS.map((p, i) => (
                <button key={i} className={`preset-item${draft === p ? " sel" : ""}`} onClick={() => setDraft(p)}>{p}</button>
              ))}
            </div>
          </div>
          <div className="field-group">
            <label className="field-label">{t.systemPromptLabel}</label>
            <textarea className="field-textarea" placeholder={t.systemPromptHolder} value={draft} onChange={e => setDraft(e.target.value)} />
          </div>
          <div className="modal-footer">
            <button className="btn-ghost" onClick={() => { setValue(""); onClose(); }}>{t.clearPrompt}</button>
            <button className="btn-primary" onClick={() => { setValue(draft); onClose(); }}>{t.save}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ShareModal({ onClose, t, messages }) {
  const [selectedOption, setSelectedOption] = useState("public");
  const [step, setStep] = useState(1);
  const [cp, setCp] = useState(false);

  const url = useMemo(() => {
    const d = btoa(encodeURIComponent(JSON.stringify(messages.slice(-10).map(m => ({ r: m.role, c: m.content?.slice(0, 200) })))));
    return `${window.location.origin}${window.location.pathname}?share=${d.slice(0, 400)}`;
  }, [messages]);

  const copy = () => {
    navigator.clipboard.writeText(url);
    setCp(true);
    setTimeout(() => setCp(false), 2500);
  };

  const handleActionClick = () => {
    if (selectedOption === "private") {
      onClose();
    } else {
      setStep(2);
    }
  };

  const exportFn = (type) => {
    let content, mime, ext;
    if (type === "txt") { content = messages.map(m => `[${m.role.toUpperCase()}]\n${m.content}`).join("\n\n---\n\n"); mime = "text/plain"; ext = "txt"; }
    else if (type === "md") { content = messages.map(m => `## ${m.role === "user" ? "👤 You" : "🤖 VetroAI"}\n\n${m.content}`).join("\n\n---\n\n"); mime = "text/markdown"; ext = "md"; }
    else if (type === "json") { content = JSON.stringify(messages, null, 2); mime = "application/json"; ext = "json"; }
    else {
      const rows = messages.map(m => `<div class="msg ${m.role}"><strong>${m.role === "user" ? "You" : "VetroAI"}:</strong><p>${m.content.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p></div>`).join("");
      content = `<!DOCTYPE html><html><head><title>VetroAI Chat</title><style>body{font-family:system-ui;max-width:700px;margin:auto;padding:40px;background:#faf9f7}.msg{padding:16px;margin:12px 0;border-radius:12px}.user{background:#f0ede8;text-align:right}.assistant{background:#fff;border:1px solid #eee}strong{font-size:.8rem;opacity:.5;display:block;margin-bottom:4px}</style></head><body><h2>VetroAI Chat Export</h2>${rows}</body></html>`;
      mime = "text/html"; ext = "html";
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type: mime }));
    a.download = `vetroai-chat-${makeExportStamp()}.${ext}`;
    a.click();
  };

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="claude-modal share-modal">
        <button className="claude-modal-x" onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>

        {step === 1 ? (
          <>
            <h2 className="claude-modal-title">Share chat</h2>
            <p className="claude-modal-subtitle">Only messages up to this point will be shared.</p>

            <div className="claude-share-options-card">
              <div
                className={`claude-share-option-row${selectedOption === "private" ? " active" : ""}`}
                onClick={() => setSelectedOption("private")}
              >
                <span className="option-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                </span>
                <div className="option-text">
                  <div className="option-title">Keep private</div>
                  <div className="option-desc">Only you have access</div>
                </div>
                {selectedOption === "private" && (
                  <span className="option-check">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  </span>
                )}
              </div>

              <div
                className={`claude-share-option-row${selectedOption === "public" ? " active" : ""}`}
                onClick={() => setSelectedOption("public")}
              >
                <span className="option-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
                </span>
                <div className="option-text">
                  <div className="option-title">Create public link</div>
                  <div className="option-desc">Anyone with the link can view</div>
                </div>
                {selectedOption === "public" && (
                  <span className="option-check">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  </span>
                )}
              </div>
            </div>

            <p className="claude-modal-policy-note">
              Don't share personal information or third-party content without permission, and see our <a href="#" onClick={(e) => e.preventDefault()}>Usage Policy</a>.
            </p>

            <div className="claude-modal-footer">
              <button className="claude-btn-dark" onClick={handleActionClick}>
                {selectedOption === "private" ? "Close" : "Create share link"}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="claude-modal-title">Public link created</h2>
            <p className="claude-modal-subtitle">You can now copy the link and share it with others.</p>

            <div className="claude-share-result-row">
              <input className="claude-modal-input" readOnly value={url} onClick={(e) => e.target.select()} />
              <button className="claude-btn-dark" onClick={copy}>{cp ? "Copied!" : "Copy link"}</button>
            </div>

            <div className="claude-modal-exports-section">
              <div className="exports-label">Or export chat data:</div>
              <div className="exports-grid">
                {["txt", "md", "html", "json"].map(type => (
                  <button key={type} className="claude-pill" style={{ flex: 1, justifyContent: "center" }} onClick={() => exportFn(type)}>
                    {type.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className="claude-modal-footer" style={{ marginTop: 24 }}>
              <button className="claude-pill" onClick={() => setStep(1)}>
                Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BookmarksPanel({ bookmarks, onSelect, onRemove, onClose, t }) {
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-topbar">
          <h3 className="modal-title"><BookmarkIcon />{t.bookmarks} ({bookmarks.length})</h3>
          <button className="modal-x" onClick={onClose}><XIcon /></button>
        </div>
        <div className="modal-body">
          {bookmarks.length === 0
            ? <div className="hist-empty"><span><BookmarkIcon /></span><p>{t.noBookmarks}</p></div>
            : bookmarks.map(bm => (
              <div key={bm.id} className="bookmark-item">
                <div className="bookmark-role">{bm.role === "user" ? "You" : "VetroAI"}</div>
                <div className="bookmark-text" onClick={() => { onSelect(bm); onClose(); }}>
                  {bm.content.slice(0, 140)}{bm.content.length > 140 ? "…" : ""}
                </div>
                <div className="bookmark-meta">
                  <span>{bm.timestamp}</span>
                  <button onClick={() => onRemove(bm.id)}><TrashIcon /></button>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}


function ReactionPicker({ onPick, onClose }) {
  return (
    <div className="rxn-picker">
      {REACTIONS.map(r => <button key={r} className="rxn-opt" onClick={() => { onPick(r); onClose(); }}><ReactionIcon name={r} /></button>)}
    </div>
  );
}

function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 340 }} onClick={e => e.stopPropagation()}>
        <div className="modal-topbar">
          <h3 className="modal-title">Confirm</h3>
          <button className="modal-x" onClick={onCancel}><XIcon /></button>
        </div>
        <div className="modal-body">
          <p style={{ color: "var(--ink-2)", fontSize: "0.9rem" }}>{message}</p>
          <div className="modal-footer">
            <button className="btn-ghost" onClick={onCancel}>Cancel</button>
            <button className="btn-primary" style={{ background: "var(--danger)" }} onClick={onConfirm}>Delete</button>
          </div>
        </div>
      </div>
    </div>
  );
}


// ─── SCRATCHPAD ──────────────────────────────────────────────────────────────
function ScratchpadWidget({ onClose }) {
  const [text, setText] = useState(() => localStorage.getItem("vetroai_scratchpad") || "");
  const [preview, setPreview] = useState(false);
  useEffect(() => { localStorage.setItem("vetroai_scratchpad", text); }, [text]);
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-topbar">
          <h3 className="modal-title">📝 Scratchpad</h3>
          <div style={{ display: "flex", gap: 4 }}>
            <button className={`btn-ghost sm${preview ? "" : " active"}`} style={{ fontSize: "0.74rem", padding: "4px 10px" }} onClick={() => setPreview(false)}>Edit</button>
            <button className={`btn-ghost sm${preview ? " active" : ""}`} style={{ fontSize: "0.74rem", padding: "4px 10px" }} onClick={() => setPreview(true)}>Preview</button>
            <button className="modal-x" onClick={onClose}><XIcon /></button>
          </div>
        </div>
        <div className="modal-body">
          {preview ? (
            <div className="bubble bg-slate-800 md:bg-[var(--bg-hover)] text-slate-200 md:text-[var(--ink)]" style={{ padding: 16, borderRadius: 12, minHeight: 200 }}>
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, KATEX_OPTIONS]]}>{text || "*Nothing here yet…*"}</ReactMarkdown>
            </div>
          ) : (
            <textarea className="field-textarea" value={text} onChange={e => setText(e.target.value)}
              placeholder="Jot down notes, ideas, code snippets…&#10;Supports **markdown** formatting."
              style={{ minHeight: 240, fontFamily: "var(--mono)", fontSize: "0.85rem" }} />
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.72rem", color: "var(--ink-4)" }}>{text.length} chars · Auto-saved</span>
            <button className="btn-ghost sm" onClick={() => { setText(""); }} style={{ fontSize: "0.74rem" }}>Clear</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── CODE PLAYGROUND (Full-Screen Multi-Language Compiler) ───────────────────
// Supported languages map directly to compiler runtimes hosted on Wandbox compiler endpoint
const PLAYGROUND_LANGS = [
  { id: "python",     label: "Python",      runtime: "python",     version: "3.12.7",  sample: 'print("Hello, World!")\n\n# Try some Python\nfor i in range(5):\n    print(f"Count: {i}")' },
  { id: "javascript", label: "JavaScript",  runtime: "javascript", version: "20.17.0", sample: 'console.log("Hello, World!")\n\n// Array operations\nconst nums = [1, 2, 3, 4, 5];\nnums.forEach(n => console.log(`Square of ${n}: ${n*n}`));' },
  { id: "typescript", label: "TypeScript",  runtime: "typescript", version: "5.6.2",   sample: 'const greet = (name: string): string => `Hello, ${name}!`;\nconsole.log(greet("World"));\n\ninterface User { name: string; age: number; }\nconst user: User = { name: "VetroAI", age: 1 };\nconsole.log(user);' },
  { id: "c",          label: "C",           runtime: "c",          version: "13.2.0",  sample: '#include <stdio.h>\n\nint main() {\n    printf("Hello, World!\\n");\n    for (int i = 0; i < 5; i++) {\n        printf("Count: %d\\n", i);\n    }\n    return 0;\n}' },
  { id: "cpp",        label: "C++",         runtime: "cpp",        version: "13.2.0",  sample: '#include <iostream>\n#include <vector>\nusing namespace std;\n\nint main() {\n    cout << "Hello, World!" << endl;\n    vector<int> v = {1, 2, 3, 4, 5};\n    for (int x : v) cout << "Value: " << x << endl;\n    return 0;\n}' },
  { id: "java",       label: "Java",        runtime: "java",       version: "21",      sample: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n        for (int i = 0; i < 5; i++) {\n            System.out.println("Count: " + i);\n        }\n    }\n}' },
  { id: "go",         label: "Go",          runtime: "go",         version: "1.23.2",  sample: 'package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello, World!")\n    for i := 0; i < 5; i++ {\n        fmt.Printf("Count: %d\\n", i)\n    }\n}' },
  { id: "rust",       label: "Rust",        runtime: "rust",       version: "1.82.0",  sample: 'fn main() {\n    println!("Hello, World!");\n    for i in 0..5 {\n        println!("Count: {}", i);\n    }\n}' },
  { id: "ruby",       label: "Ruby",        runtime: "ruby",       version: "3.3.11",  sample: 'puts "Hello, World!"\n\n5.times do |i|\n  puts "Count: #{i}"\nend' },
  { id: "php",        label: "PHP",         runtime: "php",        version: "8.3.12",  sample: '<?php\necho "Hello, World!\\n";\nfor ($i = 0; $i < 5; $i++) {\n    echo "Count: $i\\n";\n}' },
  { id: "swift",      label: "Swift",       runtime: "swift",      version: "6.0.1",   sample: 'print("Hello, World!")\nfor i in 0..<5 {\n    print("Count: \\(i)")\n}' },
  { id: "csharp",     label: "C#",          runtime: "csharp",     version: "8.0.402", sample: 'using System;\n\npublic class Program {\n    public static void Main() {\n        Console.WriteLine("Hello, World!");\n        for (int i = 0; i < 5; i++) {\n            Console.WriteLine($"Count: {i}");\n        }\n    }\n}' },
  { id: "bash",       label: "Bash",        runtime: "bash",       version: "latest",  sample: '#!/bin/bash\necho "Hello, World!"\nfor i in {0..4}; do\n    echo "Count: $i"\ndone' },
  { id: "r",          label: "R",           runtime: "r",          version: "4.4.1",   sample: 'cat("Hello, World!\\n")\nfor (i in 0:4) {\n  cat(sprintf("Count: %d\\n", i))\n}' },
];

const LANG_COLORS = {
  python: "#3572A5", javascript: "#F7DF1E", typescript: "#3178C6",
  c: "#555555", cpp: "#f34b7d", java: "#b07219", go: "#00ADD8",
  rust: "#dea584", ruby: "#701516", php: "#4F5D95", swift: "#F05138",
  csharp: "#178600", bash: "#89e051", r: "#198CE7",
};

function CodePlayground({ onClose }) {
  const savedLang = () => { try { return localStorage.getItem("vetroai_pg_lang") || "python"; } catch { return "python"; } };
  const savedCode = (lang) => { try { return localStorage.getItem(`vetroai_pg_code_${lang}`) || ""; } catch { return ""; } };

  const [langId, setLangId]     = useState(savedLang);
  const [code, setCode]         = useState(() => savedCode(savedLang()) || PLAYGROUND_LANGS.find(l => l.id === savedLang())?.sample || "");
  const [output, setOutput]     = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [runTime, setRunTime]   = useState(null);
  const [exitCode, setExitCode] = useState(null);
  const [tab, setTab]           = useState("editor"); // "editor" | "output"
  const [fontSize, setFontSize] = useState(14);
  const [theme, setTheme]       = useState("dark"); // "dark" | "light"
  const [stdin, setStdin]       = useState("");
  const [rightTab, setRightTab] = useState("output"); // "output" | "stdin"
  const textRef = useRef(null);

  const currentLang = PLAYGROUND_LANGS.find(l => l.id === langId) || PLAYGROUND_LANGS[0];

  // Save code per language
  useEffect(() => {
    try { localStorage.setItem(`vetroai_pg_code_${langId}`, code); } catch {}
  }, [code, langId]);
  useEffect(() => {
    try { localStorage.setItem("vetroai_pg_lang", langId); } catch {}
  }, [langId]);

  const switchLang = (id) => {
    setLangId(id);
    const stored = savedCode(id);
    setCode(stored || PLAYGROUND_LANGS.find(l => l.id === id)?.sample || "");
    setOutput("");
    setExitCode(null);
    setRunTime(null);
  };

  const runCode = async () => {
    if (!code.trim() || isRunning) return;
    setIsRunning(true);
    setOutput("");
    setExitCode(null);
    setRunTime(null);
    setTab("output");
    setRightTab("output"); // Auto-switch to output tab to see compiler results
    const t0 = performance.now();
    try {
      const res = await fetch(`${API}/code/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: currentLang.id,
          code: code,
          stdin: stdin || ""
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        try { const j = await res.json(); errMsg = j.error || errMsg; } catch {}
        throw new Error(errMsg);
      }

      const data = await res.json();
      const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
      const compileOut = data.compile?.output?.trimEnd() || "";
      const runOut     = data.run?.output?.trimEnd()     || "";
      const combined   = [compileOut, runOut].filter(Boolean).join("\n");
      setOutput(combined || "(no output)");
      setExitCode(data.run?.code ?? 0);
      setRunTime(elapsed);
    } catch (err) {
      const msg = err.name === "TimeoutError"
        ? "Execution timed out (30s). Try a shorter program."
        : err.message || "Unknown error";
      setOutput(`⚠️ ${msg}`);
      setExitCode(1);
    } finally {
      setIsRunning(false);
    }
  };

  const clearOutput = () => { setOutput(""); setExitCode(null); setRunTime(null); };
  const copyCode   = () => navigator.clipboard.writeText(code);
  const resetCode  = () => { setCode(currentLang.sample); setOutput(""); setExitCode(null); };

  // Tab key in textarea
  const handleKeyDown = (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const start = e.target.selectionStart;
      const end   = e.target.selectionEnd;
      const spaces = "  ";
      setCode(c => c.slice(0, start) + spaces + c.slice(end));
      setTimeout(() => {
        if (textRef.current) {
          textRef.current.selectionStart = textRef.current.selectionEnd = start + spaces.length;
        }
      }, 0);
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      runCode();
    }
  };

  const accentColor = LANG_COLORS[langId] || "#7c3aed";
  const isDark = theme === "dark";

  return (
    <div className="pg-fullscreen" data-theme={theme}>
      {/* Top Bar */}
      <div className="pg-topbar">
        <div className="pg-topbar-left">
          <div className="pg-logo">
            <span style={{ fontSize: 18 }}>⚡</span>
            <span>Code Playground</span>
          </div>
          {/* Language Selector */}
          <div className="pg-lang-scroll">
            {PLAYGROUND_LANGS.map(l => (
              <button
                key={l.id}
                className={`pg-lang-tab${langId === l.id ? " active" : ""}`}
                style={{ "--lc": LANG_COLORS[l.id] || "#7c3aed" }}
                onClick={() => switchLang(l.id)}
              >
                <span className="pg-lang-dot" />
                {l.label}
              </button>
            ))}
          </div>
        </div>
        <div className="pg-topbar-right">
          <button className="pg-icon-btn" title="Decrease font" onClick={() => setFontSize(f => Math.max(10, f - 1))}>A-</button>
          <button className="pg-icon-btn" title="Increase font" onClick={() => setFontSize(f => Math.min(22, f + 1))}>A+</button>
          <button className="pg-icon-btn" title="Toggle theme" onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}>{isDark ? "☀️" : "🌙"}</button>
          <button className="pg-icon-btn" title="Reset code" onClick={resetCode}>↺</button>
          <button className="pg-icon-btn" title="Copy code" onClick={copyCode}>⎘</button>
          <button
            className={`pg-run-btn${isRunning ? " running" : ""}`}
            onClick={runCode}
            disabled={isRunning}
            title="Run (Ctrl+Enter)"
          >
            {isRunning ? <><span className="pg-spinner" />Running…</> : <>▶ Run</>}
          </button>
          <button className="pg-close-btn" onClick={onClose} title="Close">✕</button>
        </div>
      </div>

      {/* Body */}
      <div className="pg-body">
        {/* Editor Panel */}
        <div className="pg-editor-panel">
          <div className="pg-panel-header">
            <span className="pg-lang-badge" style={{ background: accentColor + "22", color: accentColor, borderColor: accentColor + "44" }}>
              <span className="pg-lang-dot" style={{ background: accentColor }} />
              {currentLang.label} · {currentLang.version}
            </span>
            <span className="pg-hint">Ctrl+Enter to run · Tab to indent</span>
          </div>
          <div className="pg-editor-wrap">
            <div className="pg-line-nums" aria-hidden="true">
              {code.split("\n").map((_, i) => (
                <div key={i} className="pg-line-num">{i + 1}</div>
              ))}
            </div>
            <textarea
              ref={textRef}
              className="pg-code-editor"
              value={code}
              onChange={e => setCode(e.target.value)}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              style={{ fontSize }}
              placeholder={`Write your ${currentLang.label} code here…`}
            />
          </div>
        </div>

        {/* Output Panel */}
        <div className="pg-output-panel">
          <div className="pg-panel-header" style={{ padding: "6px 12px" }}>
            <div className="pg-tab-row">
              <button
                className={`pg-panel-tab ${rightTab === "output" ? "active" : ""}`}
                onClick={() => setRightTab("output")}
              >
                Output
              </button>
              <button
                className={`pg-panel-tab ${rightTab === "stdin" ? "active" : ""}`}
                onClick={() => setRightTab("stdin")}
              >
                Input (Stdin) {stdin.trim() && <span className="pg-stdin-dot" />}
              </button>
            </div>
            <div className="pg-panel-header-right">
              {exitCode !== null && rightTab === "output" && (
                <span className={`pg-exit-badge ${exitCode === 0 ? "ok" : "err"}`}>
                  {exitCode === 0 ? "✓ Success" : `✗ Exit ${exitCode}`}
                </span>
              )}
              {runTime && rightTab === "output" && <span className="pg-time-badge">⏱ {runTime}s</span>}
              {output && rightTab === "output" && <button className="pg-icon-btn" onClick={clearOutput} title="Clear output">✕ Clear</button>}
            </div>
          </div>
          <div className="pg-output-body">
            {rightTab === "stdin" ? (
              <div className="pg-stdin-wrap">
                <textarea
                  className="pg-stdin-editor"
                  value={stdin}
                  onChange={e => setStdin(e.target.value)}
                  placeholder={`Provide standard input values for your program here.\nFor example, if your Python code prompts:\n  name = input()\n  age = input()\nthen type the values on separate lines:\n  John\n  25`}
                  spellCheck={false}
                />
              </div>
            ) : isRunning ? (
              <div className="pg-running-msg">
                <div className="pg-run-anim">
                  <span /><span /><span />
                </div>
                <p>Compiling and running your {currentLang.label} code…</p>
                <small>Powered by Wandbox</small>
              </div>
            ) : output ? (
              <pre className={`pg-output-pre ${exitCode !== 0 ? "error" : ""}`}>{output}</pre>
            ) : (
              <div className="pg-output-empty">
                <span style={{ fontSize: 32 }}>▶</span>
                <p>Click <strong>Run</strong> or press <kbd>Ctrl+Enter</kbd> to execute your code</p>
                <small>For interactive programs, click the <strong>Input (Stdin)</strong> tab and enter values before running.</small>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── STATS PANEL ─────────────────────────────────────────────────────────────
function StatsPanel({ onClose, sessions }) {
  const totalMsgs = sessions.reduce((a, s) => a + (s.messages?.length || 0), 0);
  const userMsgs = sessions.reduce((a, s) => a + (s.messages?.filter(m => m.role === "user").length || 0), 0);
  const botMsgs = totalMsgs - userMsgs;
  const stats = [
    { icon: "💬", label: "Total Messages", value: totalMsgs },
    { icon: "👤", label: "You Sent", value: userMsgs },
    { icon: "🤖", label: "AI Replies", value: botMsgs },
    { icon: "📂", label: "Conversations", value: sessions.length },
  ];
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-topbar">
          <h3 className="modal-title">📊 Your Stats</h3>
          <button className="modal-x" onClick={onClose}><XIcon /></button>
        </div>
        <div className="modal-body">
          <div className="stats-grid">
            {stats.map(s => (
              <div key={s.label} className="stat-card">
                <span className="stat-icon">{s.icon}</span>
                <span className="stat-value">{s.value.toLocaleString()}</span>
                <span className="stat-label">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ICONS (new) ─────────────────────────────────────────────────────────────
const CalendarIcon = () => <Ic size={14} d={<><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>} />;
const NoteIcon = () => <Ic size={14} d={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></>} />;
const PlayIcon = () => <Ic size={14} d={<><polygon points="5 3 19 12 5 21 5 3" /></>} />;
const ChartIcon = () => <Ic size={14} d={<><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></>} />;



// ─── ARTIFACTS / CANVAS PANEL (Claude-style) ──────────────────────────────────
const ARTIFACT_EXT = { javascript: "js", js: "js", typescript: "ts", python: "py", html: "html", css: "css", json: "json", markdown: "md", jsx: "jsx", tsx: "tsx", sql: "sql" };

function ArtifactsPanel({ artifact, onClose }) {
  const { code, language, title } = artifact;
  const [tab, setTab] = useState(language === "html" ? "preview" : "code");
  const [copied, setCopied] = useState(false);
  // Only HTML/SVG have visual output an iframe can render. Plain JS (e.g. Node/Express
  // backend code) has no DOM to preview — feeding it to srcDoc just shows it as flowed,
  // unstyled text since the browser parses it as an HTML document body.
  const previewable = language === "html" || language === "svg";
  const copy = () => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const download = () => {
    const ext = ARTIFACT_EXT[language] || "txt";
    const blob = new Blob([code], { type: "text/plain" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${(title || "artifact").replace(/[^\w.-]+/g, "_")}.${ext}`; a.click();
  };
  const openInNewTab = () => {
    const w = window.open("", "_blank");
    if (w) { w.document.write(code); w.document.close(); }
  };
  return (
    <div className="artifacts-panel">
      <div className="artifacts-header">
        <div className="artifacts-tabs">
          <span className="artifact-title" title={title}>{title || "Artifact"}</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="atab" onClick={onClose}>✕</button>
        </div>
      </div>
      <div className="artifacts-subbar">
        <div className="artifacts-tabs">
          <button className={`atab${tab === "code" ? " active" : ""}`} onClick={() => setTab("code")}>📄 Code</button>
          {previewable && (
            <button className={`atab${tab === "preview" ? " active" : ""}`} onClick={() => setTab("preview")}>▶ Preview</button>
          )}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {tab === "preview" && (
            <button className="atab" onClick={openInNewTab} title="Open in new tab"><ExternalLink size={13} /></button>
          )}
          <button className="atab" onClick={download} title="Download"><Download size={13} /></button>
          <button className="atab" onClick={copy} style={{ color: copied ? "var(--success)" : undefined }}>{copied ? "✓ Copied" : "Copy"}</button>
        </div>
      </div>
      {tab === "code" && (
        <SyntaxHighlighter style={vscDarkPlus} language={language || "text"} customStyle={{ margin: 0, borderRadius: 0, flex: 1, fontSize: "0.83rem", minHeight: 400 }}>
          {code}
        </SyntaxHighlighter>
      )}
      {tab === "preview" && (
        <iframe title="artifact-preview" srcDoc={code} sandbox="allow-scripts allow-same-origin" style={{ flex: 1, border: "none", background: "#fff", borderRadius: "0 0 12px 12px", minHeight: 400 }} />
      )}
    </div>
  );
}

// ─── ARTIFACTS GALLERY ──────────────────────────────────────────────────────────
function ArtifactsGallery({ artifacts, onOpen, onClose }) {
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal artifacts-gallery-modal" style={{ width: 680, maxWidth: "92%", maxHeight: "85vh" }}>
        <div className="modal-topbar">
          <h3 className="modal-title"><LayoutGrid size={17} /> Artifacts</h3>
          <button className="modal-x" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body" style={{ gap: 14 }}>
          {artifacts.length === 0 ? (
            <p style={{ textAlign: "center", color: "var(--ink-4)", fontSize: "0.85rem", padding: "30px 0" }}>
              Code, documents, and designs the AI generates for you will show up here — ready to reopen, copy, or download.
            </p>
          ) : (
            <div className="artifact-gallery-grid">
              {artifacts.slice().reverse().map(a => (
                <button key={a.id} className="artifact-gallery-card" onClick={() => onOpen(a)}>
                  <div className="artifact-gallery-card-icon"><FileText size={16} /></div>
                  <span className="artifact-gallery-card-title">{a.title}</span>
                  <span className="artifact-gallery-card-meta">{a.language} · {new Date(a.createdAt).toLocaleDateString()}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── DESIGN CANVAS ───────────────────────────────────────────────────────────────
const SMOOTH_SCROLLBAR_CSS = `
<style>
  html { scroll-behavior: smooth; }
  * { scrollbar-width: thin; scrollbar-color: rgba(0,0,0,0.22) transparent; }
  *::-webkit-scrollbar { width: 8px; height: 8px; }
  *::-webkit-scrollbar-track { background: transparent; }
  *::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.22); border-radius: 999px; border: 2px solid transparent; background-clip: content-box; }
  *::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.38); }
</style>`;

function injectSmoothScrollbar(html) {
  if (!html) return html;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${SMOOTH_SCROLLBAR_CSS}</head>`);
  return SMOOTH_SCROLLBAR_CSS + html;
}

function parseDesignResponse(text) {
  // Closed fence, with or without a language tag: ```html ... ``` or ``` ... ```
  let m = text.match(/```(?:html)?\s*\n?([\s\S]*?)```/i);
  if (m && /<(!doctype|html|head|body|div|style)\b/i.test(m[1])) {
    return { caption: text.slice(0, m.index).trim(), html: injectSmoothScrollbar(m[1].trim()) };
  }

  // Unclosed fence — streaming mid-response, or the model never emitted a closing ```
  m = text.match(/```(?:html)?\s*\n?([\s\S]*)/i);
  if (m && /<(!doctype|html|head|body)\b/i.test(m[1])) {
    return { caption: text.slice(0, m.index).trim(), html: injectSmoothScrollbar(m[1].trim()) };
  }

  // No fences at all — model returned raw HTML directly
  const rawStart = text.search(/<(!doctype html|html)\b/i);
  if (rawStart !== -1) {
    return { caption: text.slice(0, rawStart).trim(), html: injectSmoothScrollbar(text.slice(rawStart).trim()) };
  }

  return { caption: text.trim(), html: "" };
}

function DesignCanvas({ onClose }) {
  const [messages, setMessages] = useState(() => { try { return JSON.parse(localStorage.getItem("vetroai_design_history") || "[]"); } catch { return []; } });
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [tab, setTab] = useState("preview");
  const [viewport, setViewport] = useState("desktop");
  const [copied, setCopied] = useState(false);
  const abortRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem("vetroai_design_history", JSON.stringify(messages.slice(-20))); } catch {}
  }, [messages]);

  const lastDesign = useMemo(() => {
    const lastAssistant = [...messages].reverse().find(m => m.role === "assistant" && m.content);
    return lastAssistant ? parseDesignResponse(lastAssistant.content) : { caption: "", html: "" };
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || isLoading) return;
    const hist = [...messages, { role: "user", content: text }, { role: "assistant", content: "" }];
    setMessages(hist);
    setInput("");
    setIsLoading(true);
    setTab("preview");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const isActive = () => abortRef.current === ctrl;
    try {
      const fd = new FormData();
      fd.append("input", text);
      fd.append("messages", JSON.stringify(hist.slice(0, -1).slice(-8)));
      fd.append("mode", "design");
      fd.append("temperature", "0.7");
      fd.append("maxTokens", "6000");
      fd.append("reqId", `design_${Date.now()}`);
      fd.append("webSearch", "false");
      const res = await fetch(API + "/chat", { method: "POST", body: fd, signal: ctrl.signal });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      await readSSEStream(
        res.body.getReader(),
        (acc) => { if (isActive()) setMessages(prev => { const u = [...prev]; u[u.length - 1] = { role: "assistant", content: acc }; return u; }); },
        () => {},
        (errMsg) => { if (isActive()) setMessages(prev => { const u = [...prev]; u[u.length - 1] = { role: "assistant", content: `⚠️ ${errMsg}` }; return u; }); },
        isActive,
        `design_${Date.now()}`
      );
    } catch (err) {
      if (err.name !== "AbortError" && isActive()) {
        setMessages(prev => { const u = [...prev]; u[u.length - 1] = { role: "assistant", content: `⚠️ ${err.message || "Something went wrong."}` }; return u; });
      }
    } finally {
      if (isActive()) setIsLoading(false);
    }
  };

  const copy = () => { navigator.clipboard.writeText(lastDesign.html); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const download = () => {
    const blob = new Blob([lastDesign.html], { type: "text/html" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "design.html"; a.click();
  };
  const openInNewTab = () => { const w = window.open("", "_blank"); if (w) { w.document.write(lastDesign.html); w.document.close(); } };
  const clearChat = () => {
    if (messages.length && !window.confirm("Clear this design conversation?")) return;
    setMessages([]);
    try { localStorage.removeItem("vetroai_design_history"); } catch {}
  };

  return (
    <div className="design-canvas-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="design-canvas" onClick={e => e.stopPropagation()}>
        <div className="design-canvas-header">
          <h3 className="modal-title"><Palette size={16} /> Design <FlaskConical size={12} style={{ color: "var(--ink-4)" }} /></h3>
          {lastDesign.html && (
            <div className="design-viewport-toggle">
              <button className={viewport === "mobile" ? "active" : ""} onClick={() => setViewport("mobile")} title="Mobile"><Smartphone size={14} /></button>
              <button className={viewport === "tablet" ? "active" : ""} onClick={() => setViewport("tablet")} title="Tablet"><Tablet size={14} /></button>
              <button className={viewport === "desktop" ? "active" : ""} onClick={() => setViewport("desktop")} title="Desktop"><Monitor size={14} /></button>
            </div>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            {lastDesign.html && (
              <>
                <button className="atab" onClick={() => setTab(tab === "code" ? "preview" : "code")}>{tab === "code" ? "▶ Preview" : "📄 Code"}</button>
                <button className="atab" onClick={openInNewTab} title="Open in new tab"><ExternalLink size={13} /></button>
                <button className="atab" onClick={download} title="Download"><Download size={13} /></button>
                <button className="atab" onClick={copy} style={{ color: copied ? "var(--success)" : undefined }}>{copied ? "✓ Copied" : "Copy"}</button>
              </>
            )}
            {messages.length > 0 && (
              <button className="atab" onClick={clearChat} title="Clear chat"><Trash2 size={13} /></button>
            )}
            <button className="modal-x" onClick={onClose}><X size={18} /></button>
          </div>
        </div>
        <div className="design-canvas-body">
          <div className="design-canvas-stage">
            {!lastDesign.html ? (
              <div className="design-canvas-empty">
                <Palette size={28} />
                <p>{isLoading ? "Designing…" : "Describe a UI below and I'll design it live."}</p>
              </div>
            ) : tab === "code" ? (
              <SyntaxHighlighter style={vscDarkPlus} language="html" customStyle={{ margin: 0, flex: 1, fontSize: "0.82rem", height: "100%" }}>
                {lastDesign.html}
              </SyntaxHighlighter>
            ) : (
              <div className={`design-frame-wrap viewport-${viewport}`}>
                <iframe title="design-preview" srcDoc={lastDesign.html} sandbox="allow-scripts allow-same-origin allow-popups" className="design-frame" />
              </div>
            )}
          </div>
          <div className="design-canvas-chat">
            <div className="design-canvas-chat-msgs">
              {messages.length === 0 && <p style={{ color: "var(--ink-4)", fontSize: "0.8rem" }}>e.g. "A pricing page with 3 tiers" or "Make the buttons rounded and purple"</p>}
              {messages.map((m, i) => (
                <div key={i} className={`design-msg design-msg-${m.role}`}>
                  {m.role === "user" ? m.content : (m.content ? (parseDesignResponse(m.content).caption || "Updated the design ↑") : (isLoading && i === messages.length - 1 ? "Designing…" : ""))}
                </div>
              ))}
            </div>
            <form className="design-input-row" onSubmit={e => { e.preventDefault(); send(); }}>
              <input value={input} onChange={e => setInput(e.target.value)} placeholder="Describe the UI you want…" disabled={isLoading} />
              <button type="submit" disabled={isLoading || !input.trim()}>Send</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SOURCE CARDS (Perplexity-style) ──────────────────────────────────────────
function SourceCards({ sources }) {
  if (!sources?.length) return null;
  return (
    <div className="source-cards">
      <div className="source-cards-label">🔗 Sources</div>
      <div className="source-cards-row">
        {sources.map((s, i) => (
          <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="source-card">
            <span className="source-num">{i + 1}</span>
            <span className="source-domain">{s.domain}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

// ─── PERSONA SWITCHER (Quick-pick AI personality) ─────────────────────────────
function PersonaSwitcher({ currentPersonaId, onSelect, onClose, onCreateNew }) {
  const [tab, setTab] = useState("preset");
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("🤖");
  const [prompt, setPrompt] = useState("");
  const custom = getCustomPersonas();

  const save = () => {
    if (!name.trim() || !prompt.trim()) return;
    const id = `custom_${Date.now()}`;
    const all = [...custom, { id, name: name.trim(), avatar, prompt: prompt.trim(), color: "#7c3aed" }];
    saveCustomPersonas(all);
    onSelect({ id, name: name.trim(), avatar, prompt: prompt.trim(), color: "#7c3aed" });
    onClose();
  };

  const allPersonas = [...DEFAULT_PERSONAS, ...custom];

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-topbar">
          <h3 className="modal-title">🎭 AI Persona</h3>
          <button className="modal-x" onClick={onClose}><XIcon /></button>
        </div>
        <div className="modal-body" style={{ gap: 0 }}>
          <div style={{ display: "flex", gap: 8, padding: "0 0 16px" }}>
            <button className={`booking-dur-btn${tab === "preset" ? " active" : ""}`} onClick={() => setTab("preset")}>Presets</button>
            <button className={`booking-dur-btn${tab === "create" ? " active" : ""}`} onClick={() => setTab("create")}>+ Create New</button>
          </div>
          {tab === "preset" && (
            <div className="persona-grid">
              {allPersonas.map(p => (
                <div key={p.id} className={`persona-card${currentPersonaId === p.id ? " active" : ""}`} style={{ "--pc": p.color }} onClick={() => { onSelect(p); onClose(); }}>
                  <span className="persona-avatar">{p.avatar}</span>
                  <span className="persona-name">{p.name}</span>
                  {currentPersonaId === p.id && <span className="persona-check"><CheckIcon /></span>}
                </div>
              ))}
            </div>
          )}
          {tab === "create" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="field-group">
                <label className="field-label">Name</label>
                <input className="field-input" placeholder="My Custom AI…" value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div className="field-group">
                <label className="field-label">Avatar</label>
                <div className="av-grid" style={{ gridTemplateColumns: "repeat(8, 1fr)" }}>
                  {["🤖","🦊","🐼","🦁","🌟","🔥","💎","🚀","🌈","🎨","🦋","🐉","🌙","⚡","🧠","🎯"].map(a => (
                    <button key={a} className={`av-opt${avatar === a ? " sel" : ""}`} onClick={() => setAvatar(a)}>{a}</button>
                  ))}
                </div>
              </div>
              <div className="field-group">
                <label className="field-label">System Prompt</label>
                <textarea className="field-textarea" placeholder="You are a helpful AI that…" value={prompt} onChange={e => setPrompt(e.target.value)} style={{ minHeight: 80 }} />
              </div>
              <div className="modal-footer">
                <button className="btn-ghost" onClick={onClose}>Cancel</button>
                <button className="btn-primary" onClick={save} disabled={!name.trim() || !prompt.trim()}>Save Persona</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── CONTEXT WINDOW BAR ────────────────────────────────────────────────────────
function ContextWindowBar({ messages, maxCtx = 32000 }) {
  const used = estimateTokens(messages);
  const pct  = Math.min((used / maxCtx) * 100, 100);
  const color = pct > 85 ? "#ef4444" : pct > 60 ? "#f59e0b" : "var(--accent)";
  return (
    <div className="ctx-bar" title={`~${used.toLocaleString()} / ${maxCtx.toLocaleString()} tokens used`}>
      <div className="ctx-bar-fill" style={{ width: `${pct}%`, background: color }} />
      <span className="ctx-bar-label">{used.toLocaleString()} tokens</span>
    </div>
  );
}

// ─── CONVERSATION SUMMARY (Gemini-style one-click TL;DR) ─────────────────────
function SummaryPanel({ messages, onClose, addToast }) {
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const userMsgs = messages.filter(m => m.role === "user").map(m => m.content).join("\n").slice(0, 3000);
    const ctrl = new AbortController();

    setLoading(true);
    fetch(API + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: "Create a concise TL;DR summary of this conversation. Use bullet points. Max 150 words.",
        messages: JSON.stringify([{ role: "user", content: userMsgs }]),
        provider: "groq"
      }),
      signal: ctrl.signal
    })
    .then(async res => {
      if (!res.ok) throw new Error("Summary failed");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6);
            if (dataStr.trim() === "[DONE]") break;
            try {
              const data = JSON.parse(dataStr);
              if (data.content) {
                acc += data.content;
                setSummary(acc);
              }
            } catch {}
          }
        }
      }
    })
    .catch(() => setSummary("Unable to generate summary."))
    .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, [messages]);

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-topbar">
          <h3 className="modal-title">📋 Conversation Summary</h3>
          <button className="modal-x" onClick={onClose}><XIcon /></button>
        </div>
        <div className="modal-body">
          {loading && <TypingIndicator text="Summarizing…" />}
          <div className="bubble bg-slate-800 md:bg-[var(--bg-hover)] text-slate-200 md:text-[var(--ink)]" style={{ padding: 16, borderRadius: 12 }}>
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, KATEX_OPTIONS]]}>{summary || "…"}</ReactMarkdown>
          </div>
          <div className="modal-footer">
            <button className="btn-ghost" onClick={() => { navigator.clipboard.writeText(summary); addToast("Summary copied!", "success", 2000); }}>
              <CopyIcon /> Copy
            </button>
            <button className="btn-primary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const SPACE_ICONS = [
  { id: "Globe", icon: Globe },
  { id: "Terminal", icon: Terminal },
  { id: "Brain", icon: Brain },
  { id: "Rocket", icon: Rocket },
  { id: "Heart", icon: Heart },
  { id: "Shield", icon: Shield },
  { id: "Compass", icon: Compass }
];
const SPACE_COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#64748b"];

// ─── SPACE MODAL ────────────────────────────────────────────────────────────
function SpaceModal({ space, onSave, onClose, onDelete }) {
  const [name, setName] = useState(space ? space.name : "");
  const [mode, setMode] = useState(space ? space.mode : MODES_LIST[0].id);
  const [prompt, setPrompt] = useState(space ? space.systemPrompt : "");
  const [files, setFiles] = useState(space ? space.files || [] : []);
  const [color, setColor] = useState(space ? space.color || SPACE_COLORS[0] : SPACE_COLORS[0]);
  const [icon, setIcon] = useState(space ? space.icon || SPACE_ICONS[0].id : SPACE_ICONS[0].id);

  const handleFileUpload = (e) => {
    const newFiles = Array.from(e.target.files);
    newFiles.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setFiles(prev => [...prev, { name: file.name, type: file.type, content: ev.target.result }]);
      };
      reader.readAsText(file); // Assume text files for simplicity
    });
  };

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 500, maxWidth: "90%" }}>
        <div className="modal-topbar">
          <h3 className="modal-title">{space ? "Edit Space" : "New Space"}</h3>
          <button className="modal-x" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body" style={{ padding: 20, gap: 16, flexShrink: 1, minHeight: 0 }}>
          <div style={{ display: "flex", gap: 16 }}>
            <div style={{ flex: 1 }}>
              <label className="provider-label">Name</label>
              <input className="sys-prompt-textarea" style={{ minHeight: "auto", height: 40 }} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Coding Space" />
            </div>
            <div style={{ flex: 1 }}>
              <label className="provider-label">Default Mode</label>
              <select className="sys-prompt-textarea" style={{ minHeight: "auto", height: 40 }} value={mode} onChange={e => setMode(e.target.value)}>
                {MODES_LIST.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="provider-label">Icon & Color</label>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
              {SPACE_ICONS.map(I => (
                <button key={I.id} onClick={() => setIcon(I.id)} style={{ background: icon === I.id ? "rgba(255,255,255,0.15)" : "transparent", border: "none", color: "var(--ink)", padding: 6, borderRadius: 6, cursor: "pointer" }}>
                  <I.icon size={20} />
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              {SPACE_COLORS.map(c => (
                <button key={c} onClick={() => setColor(c)} style={{ width: 24, height: 24, borderRadius: "50%", background: c, border: color === c ? "2px solid white" : "none", cursor: "pointer", padding: 0 }} />
              ))}
            </div>
          </div>
          <div>
            <label className="provider-label">System Prompt / Instructions</label>
            <textarea className="sys-prompt-textarea" style={{ height: 120 }} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="You are a Python expert..." />
          </div>
          <div>
            <label className="provider-label">Knowledge Files ({files.length})</label>
            <input type="file" multiple onChange={handleFileUpload} style={{ marginBottom: 8, fontSize: "0.85rem", color: "var(--ink-2)" }} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {files.map((f, i) => (
                <div key={i} className="mode-pill" style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px" }}>
                  <FileText size={12} /> {f.name}
                  <button onClick={() => setFiles(prev => prev.filter((_, idx) => idx !== i))} style={{ background: "none", border: "none", color: "var(--ink-4)", cursor: "pointer", display: "flex", alignItems: "center" }}><X size={12} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="modal-footer" style={{ display: "flex", justifyContent: "space-between", flexShrink: 0, padding: "12px 20px" }}>
          {space ? <button className="btn-ghost" onClick={() => onDelete(space.id)} style={{ color: "#ef4444" }}>Delete Space</button> : <div></div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={() => {
              if (!name.trim()) return;
              onSave({ id: space ? space.id : Date.now().toString(), name, mode, systemPrompt: prompt, files, color, icon });
            }}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SPACES PANEL (Claude-style "Projects") ─────────────────────────────────────
function SpacesPanel({ spaces, currentSpaceId, onOpenSpace, onNewSpace, onEditSpace, onDeleteSpace, onClose }) {
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal spaces-modal" style={{ width: 640, maxWidth: "92%", maxHeight: "85vh" }}>
        <div className="modal-topbar">
          <h3 className="modal-title"><FolderClosed size={17} /> Projects</h3>
          <button className="modal-x" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body" style={{ gap: 14 }}>
          <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--ink-3)" }}>
            Projects keep chats, instructions, and knowledge files together for a specific task.
          </p>
          <div className="spaces-grid">
            <button className="space-card space-card-new" onClick={onNewSpace}>
              <Plus size={22} />
              <span>New project</span>
            </button>
            {spaces.map(sp => {
              const Icon = (SPACE_ICONS.find(i => i.id === sp.icon) || SPACE_ICONS[0]).icon;
              const isActive = sp.id === currentSpaceId;
              return (
                <div key={sp.id} className={`space-card${isActive ? " space-card-active" : ""}`} onClick={() => onOpenSpace(sp.id)}>
                  <div className="space-card-icon" style={{ background: `${sp.color || SPACE_COLORS[0]}22`, color: sp.color || SPACE_COLORS[0] }}>
                    <Icon size={18} />
                  </div>
                  <div className="space-card-body">
                    <span className="space-card-name">{sp.name}</span>
                    <span className="space-card-meta">{sp.files?.length ? `${sp.files.length} file${sp.files.length === 1 ? "" : "s"}` : "No knowledge files"}</span>
                  </div>
                  <div className="space-card-actions">
                    <button onClick={(e) => { e.stopPropagation(); onEditSpace(sp); }} title="Edit project" aria-label="Edit project"><Pencil size={13} /></button>
                    <button onClick={(e) => { e.stopPropagation(); onDeleteSpace(sp.id); }} title="Delete project" aria-label="Delete project" style={{ color: "#ef4444" }}><Trash2 size={13} /></button>
                  </div>
                  {isActive && <span className="space-card-badge">Active</span>}
                </div>
              );
            })}
          </div>
          {spaces.length === 0 && (
            <p style={{ textAlign: "center", color: "var(--ink-4)", fontSize: "0.82rem", padding: "8px 0" }}>No projects yet — create one to keep related chats and files together.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── WORKSPACE POPUP ────────────────────────────────────────────────────────────

function WorkspacePopup({ currentMode, currentProvider, onSelectMode, onSelectProvider, onClose, variant }) {
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(onClose, 100);
  };

  const modeColors = {
    normal: "rgba(255, 255, 255, 0.12)",
    deep_search: "rgba(59, 130, 246, 0.12)",
    analyst: "rgba(249, 115, 22, 0.12)",
    multi_ai: "rgba(16, 185, 129, 0.12)",
    debugger: "rgba(168, 85, 247, 0.12)",
    summarize: "rgba(245, 158, 11, 0.12)"
  };

  return (
    <>
      <div className="overlay" style={{ background: "transparent" }} onClick={handleClose}></div>
      <div className={`workspace-popup${variant ? ` ${variant}` : ""}${isClosing ? " closing" : ""}`}>
        <div className="ws-popup-header">
          <span className="ws-popup-label">Workspace</span>
          <div className="ws-provider-tabs">
            {PROVIDERS.map(p => (
              <button
                key={p}
                className={`ws-provider-tab${currentProvider === p ? " active" : ""}`}
                onClick={(e) => { e.stopPropagation(); onSelectProvider(p); }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <div className="ws-popup-grid">
          {MODES_LIST.map(m => (
            <div
              key={m.id}
              className={`ws-mode-card${currentMode === m.id ? " active" : ""}`}
              onClick={(e) => { 
                e.stopPropagation(); 
                onSelectMode(m.id); 
                handleClose(); 
              }}
            >
              <div className="ws-mode-icon" style={{ background: modeColors[m.id] || modeColors.normal }}>
                <ModelIcon id={m.id} size={16} />
              </div>
              <div className="ws-mode-name">{m.name}</div>
              <div className="ws-mode-desc">{m.desc}</div>
              {currentMode === m.id && <div className="ws-mode-active-badge">Active</div>}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// Helper to format real-time SSE stream status updates
const getStatusLabel = (status, mode) => {
  if (!status || status === "preparing" || status === "streaming" || status === "idle") {
    switch(mode) {
      case "deep_search": return "Searching sources…";
      case "debugger": return "Reading your code…";
      case "summarize": return "Condensing…";
      case "analyst": return "Crunching data…";
      case "multi_ai": return "Consulting experts…";
      default: return "Thinking…";
    }
  }
  return status;
};

// ─── NEWS PANEL ──────────────────────────────────────────────────────────────
const NEWS_API_KEY = "pub_7dd8730c7cc543fa9480cc8f82096134";
const NEWS_CATEGORIES = ["top", "business", "technology", "sports", "entertainment", "health", "science", "politics"];

function NewsPanel({ onClose }) {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("top");
  const [searchQuery, setSearchQuery] = useState("");

  const fetchNews = useCallback(async (cat, query) => {
    setLoading(true);
    setError("");
    try {
      let url = `https://newsdata.io/api/1/latest?apikey=${NEWS_API_KEY}&language=en`;
      if (query) {
        url += `&q=${encodeURIComponent(query)}`;
      } else if (cat && cat !== "top") {
        url += `&category=${cat}`;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      setArticles(data.results || []);
    } catch (e) {
      setError("Failed to load news. Please try again.");
      console.error("News fetch error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchNews(category, ""); }, [category, fetchNews]);

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) fetchNews("top", searchQuery.trim());
  };

  const timeAgo = (dateStr) => {
    if (!dateStr) return "";
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  };

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()} style={{ zIndex: 1000 }}>
      <div className="news-panel" onClick={e => e.stopPropagation()}>
        <div className="news-panel-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Newspaper size={20} />
            <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>News</h2>
          </div>
          <button className="modal-x" onClick={onClose}><X size={16} /></button>
        </div>

        <form className="news-search-bar" onSubmit={handleSearch}>
          <Search size={15} style={{ color: "var(--ink-4)", flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Search news…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="news-search-input"
          />
          {searchQuery && (
            <button type="button" onClick={() => { setSearchQuery(""); fetchNews(category, ""); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-4)", display: "flex", padding: 2 }}>
              <X size={14} />
            </button>
          )}
        </form>

        <div className="news-categories">
          {NEWS_CATEGORIES.map(cat => (
            <button
              key={cat}
              className={`news-cat-btn${category === cat ? " active" : ""}`}
              onClick={() => { setCategory(cat); setSearchQuery(""); }}
            >
              {cat.charAt(0).toUpperCase() + cat.slice(1)}
            </button>
          ))}
        </div>

        <div className="news-feed">
          {loading ? (
            <div className="news-loading">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="news-card-skeleton">
                  <div className="news-skel-img" />
                  <div className="news-skel-lines">
                    <div className="news-skel-line w80" />
                    <div className="news-skel-line w60" />
                    <div className="news-skel-line w40" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="news-error">
              <p>{error}</p>
              <button className="btn-primary" onClick={() => fetchNews(category, searchQuery)}>Retry</button>
            </div>
          ) : articles.length === 0 ? (
            <div className="news-empty">
              <Newspaper size={40} style={{ opacity: 0.3 }} />
              <p>No articles found</p>
            </div>
          ) : (
            <div className="news-grid">
              {articles.map((article, i) => (
                <a
                  key={article.article_id || i}
                  href={article.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="news-card"
                >
                  {article.image_url && (
                    <div className="news-card-img">
                      <img
                        src={article.image_url}
                        alt=""
                        loading="lazy"
                        onError={e => { e.target.parentElement.style.display = "none"; }}
                      />
                    </div>
                  )}
                  <div className="news-card-body">
                    <div className="news-card-meta">
                      {article.source_icon && (
                        <img src={article.source_icon} alt="" className="news-source-icon" onError={e => { e.target.style.display = "none"; }} />
                      )}
                      <span className="news-source">{article.source_name || article.source_id || "News"}</span>
                      <span className="news-dot">·</span>
                      <span className="news-time">{timeAgo(article.pubDate)}</span>
                    </div>
                    <h3 className="news-card-title">{article.title}</h3>
                    {article.description && (
                      <p className="news-card-desc">{article.description.slice(0, 120)}{article.description.length > 120 ? "…" : ""}</p>
                    )}
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── LIVE SPORTS SCORES ──────────────────────────────────────────────
const SPORTS_API_KEY = "090ff94108353371ff5cdcd918e9e321";
const SPORTS_API_BASE = "https://v3.football.api-sports.io";

const SPORTS_QUERY_RE = /\b(live\s*scor|score|match|football|soccer|premier\s*league|la\s*liga|serie\s*a|bundesliga|champions\s*league|ipl|cricket|nba|basketball|tennis|fifa|epl|ucl|world\s*cup|europa|league|fixture|playing|vs\b|versus)\b/i;
const CRICKET_QUERY_RE = /\b(cricket|ipl|odi|t20|test\s*match|bcci|bpl|psl|big\s*bash|ashes|cwc|wtc|rcb|csk|mi\b|kkr|srh|dc\b|pbks|gt\b|lsg|rr\b|innings|wicket|batsman|bowler|batting|bowling)\b/i;

function isSportsQuery(text) {
  return SPORTS_QUERY_RE.test(text);
}
function isCricketQuery(text) {
  return CRICKET_QUERY_RE.test(text);
}

async function fetchLiveFootball() {
  try {
    const res = await fetch(`${SPORTS_API_BASE}/fixtures?live=all`, {
      headers: { "x-apisports-key": SPORTS_API_KEY }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.response || []).slice(0, 8).map(m => ({ ...m, _sport: "football" }));
  } catch { return []; }
}

async function fetchTodayFootball() {
  try {
    const today = new Date().toISOString().split("T")[0];
    const res = await fetch(`${SPORTS_API_BASE}/fixtures?date=${today}`, {
      headers: { "x-apisports-key": SPORTS_API_KEY }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.response || []).slice(0, 12).map(m => ({ ...m, _sport: "football" }));
  } catch { return []; }
}

async function fetchLiveCricket(apiBase) {
  try {
    const res = await fetch(`${apiBase}/cricket/live`);
    if (!res.ok) return [];
    const data = await res.json();
    const matches = data.data?.matches || [];
    return matches.map(m => ({ ...m, _sport: "cricket" }));
  } catch { return []; }
}

async function fetchAllLiveScores(apiBase, query) {
  const wantsCricket = isCricketQuery(query);
  const wantsFootball = !wantsCricket || isSportsQuery(query);

  const promises = [];
  if (wantsCricket) promises.push(fetchLiveCricket(apiBase));
  if (wantsFootball) promises.push(fetchLiveFootball().then(live => live.length > 0 ? live : fetchTodayFootball()));

  const results = await Promise.all(promises);
  return results.flat();
}

function CricketCard({ match }) {
  const t1 = match.team1 || {};
  const t2 = match.team2 || {};
  const statusText = match.status || "";
  const isLive = statusText.toLowerCase().includes("live") || statusText.includes("need") || statusText.includes("require") || (t1.overs && !statusText.toLowerCase().includes("won") && !statusText.toLowerCase().includes("drawn"));
  return (
    <div className={`ls-card ${isLive ? "ls-card-live" : ""}`}>
      <div className="ls-card-header">
        <div className="ls-league-row">
          <span className="ls-sport-icon">🏏</span>
          <span className="ls-league-name">{match.series || match.title || "Cricket"}</span>
          {match.format && <span className="ls-format-tag">{match.format}</span>}
          {isLive && <span className="ls-live-badge">LIVE</span>}
        </div>
        {match.venue && <div className="ls-venue">{match.venue}</div>}
      </div>
      <div className="ls-divider" />
      <div className="ls-cricket-body">
        <div className="ls-cricket-team">
          <div className="ls-cricket-team-name">{t1.name || t1.shortName || "Team 1"}</div>
          <div className="ls-cricket-score">
            {t1.scoreRaw || (t1.score != null ? `${t1.score}${t1.wickets != null ? "/" + t1.wickets : ""}` : "—")}
            {t1.overs && <span className="ls-cricket-overs">({t1.overs})</span>}
          </div>
        </div>
        <div className="ls-cricket-team">
          <div className="ls-cricket-team-name">{t2.name || t2.shortName || "Team 2"}</div>
          <div className="ls-cricket-score">
            {t2.scoreRaw || (t2.score != null ? `${t2.score}${t2.wickets != null ? "/" + t2.wickets : ""}` : "—")}
            {t2.overs && <span className="ls-cricket-overs">({t2.overs})</span>}
          </div>
        </div>
      </div>
      {statusText && <div className="ls-result">{statusText}</div>}
    </div>
  );
}

function FootballCard({ match }) {
  const home = match.teams?.home;
  const away = match.teams?.away;
  const goals = match.goals || {};
  const league = match.league;
  const venue = match.fixture?.venue;

  const getStatus = () => {
    const s = match.fixture?.status?.short;
    const long = match.fixture?.status?.long;
    const elapsed = match.fixture?.status?.elapsed;
    const isLive = ["1H", "2H", "ET", "P", "BT", "LIVE"].includes(s);
    if (isLive) return { label: elapsed ? `${elapsed}'` : "LIVE", sub: long || "In Play", cls: "ls-live", live: true };
    if (s === "HT") return { label: "HT", sub: "Half Time", cls: "ls-ht", live: true };
    if (s === "FT") return { label: "FT", sub: "Full Time", cls: "ls-ft", live: false };
    if (s === "AET") return { label: "AET", sub: "After Extra Time", cls: "ls-ft", live: false };
    if (s === "PEN") return { label: "PEN", sub: "Penalties", cls: "ls-ft", live: false };
    if (s === "NS") {
      const t = new Date(match.fixture?.date);
      return { label: t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), sub: "Kick Off", cls: "ls-ns", live: false };
    }
    return { label: s || "—", sub: long || "", cls: "ls-other", live: false };
  };

  const status = getStatus();
  const result = (() => {
    const s = match.fixture?.status?.short;
    if (!["FT","AET","PEN"].includes(s)) return null;
    if (home?.winner) return `${home.name} won`;
    if (away?.winner) return `${away.name} won`;
    return "Match drawn";
  })();

  return (
    <div className={`ls-card ${status.live ? "ls-card-live" : ""}`}>
      <div className="ls-card-header">
        <div className="ls-league-row">
          {league?.logo && <img src={league.logo} alt="" className="ls-league-logo" />}
          <span className="ls-league-name">{league?.name || "League"}</span>
          {status.live && <span className="ls-live-badge">LIVE</span>}
        </div>
        {venue?.name && <div className="ls-venue">{venue.name}{venue.city ? ` · ${venue.city}` : ""}</div>}
      </div>
      <div className="ls-divider" />
      <div className="ls-match-row">
        <div className="ls-team-side">
          <div className="ls-team-crest">
            {home?.logo ? <img src={home.logo} alt="" /> : <span>H</span>}
          </div>
          <div className={`ls-team-label ${home?.winner ? "ls-bold" : ""}`}>{home?.name || "TBD"}</div>
        </div>
        <div className="ls-score-block">
          <div className="ls-score-big">
            <span className={home?.winner ? "ls-bold" : ""}>{goals.home ?? "–"}</span>
          </div>
          <div className="ls-status-center">
            <span className={`ls-status-badge ${status.cls}`}>{status.label}</span>
            <span className="ls-status-sub">{status.sub}</span>
          </div>
          <div className="ls-score-big">
            <span className={away?.winner ? "ls-bold" : ""}>{goals.away ?? "–"}</span>
          </div>
        </div>
        <div className="ls-team-side ls-team-right">
          <div className="ls-team-crest">
            {away?.logo ? <img src={away.logo} alt="" /> : <span>A</span>}
          </div>
          <div className={`ls-team-label ${away?.winner ? "ls-bold" : ""}`}>{away?.name || "TBD"}</div>
        </div>
      </div>
      {result && <div className="ls-result">{result}</div>}
    </div>
  );
}

function LiveScoreWidget({ scores }) {
  const [expanded, setExpanded] = useState(false);
  if (!scores || scores.length === 0) return null;
  const visible = expanded ? scores : scores.slice(0, 4);

  return (
    <div className="ls-widget">
      {visible.map((match, idx) =>
        match._sport === "cricket"
          ? <CricketCard key={`c-${idx}`} match={match} />
          : <FootballCard key={`f-${idx}`} match={match} />
      )}
      {scores.length > 4 && (
        <button className="ls-show-more" onClick={() => setExpanded(e => !e)}>
          {expanded ? "Show less" : `View all ${scores.length} matches`}
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  MAIN APP
// ══════════════════════════════════════════════════════════════════════
function getRelativeTime(id) {
  const ts = parseInt(id, 10);
  if (isNaN(ts)) return "";
  const diff = Date.now() - ts;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days/7)} weeks ago`;
  return `${Math.floor(days/30)} months ago`;
}

export default function App() {
  const [theme, setTheme]         = useState(() => localStorage.getItem("vetroai_theme") || "dark");
  const [langCode, setLangCode]   = useState(() => localStorage.getItem("vetroai_lang") || "en");
  const t = LANGS[langCode]?.t || LANGS.en.t;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("vetroai_theme", theme);
  }, [theme]);

  // ── Auth ─────────────────────────────────────────────────────────────────────
  const [user, setUser]           = useState(localStorage.getItem("token"));
  const [userInfo, setUserInfo]   = useState(() => { try { return JSON.parse(localStorage.getItem("vetroai_userinfo") || "null"); } catch { return null; } });
  // Stable per-account storage namespace. `user` is the raw auth token, which rotates on
  // every login/refresh — keying localStorage off it silently orphaned all saved sessions,
  // spaces, and artifacts behind the old token each time a user re-logged in. Email is stable.
  const userKey = userInfo?.email || user;
  const [authMode, setAuthMode]   = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName]   = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [showPass, setShowPass]   = useState(false);

  // Google login
  const handleGoogleLogin = useCallback((credentialResponse) => {
    try {
      const payload = JSON.parse(atob(credentialResponse.credential.split(".")[1]));
      const token = credentialResponse.credential;
      const info = { name: payload.name, email: payload.email, picture: payload.picture };
      localStorage.setItem("token", token);
      localStorage.setItem("vetroai_userinfo", JSON.stringify(info));
      setUser(token);
      setUserInfo(info);
      addToast(`Welcome, ${payload.name}! 🎉`, "success", 3000);
    } catch { addToast("Google login failed. Please try again.", "error"); }
  }, []);

  // Load Google GSI script (silently skip if blocked/unavailable in region).
  // Initialization itself is owned by <GoogleLoginButton> below — it polls for
  // window.google once this script lands and calls accounts.id.initialize/renderButton
  // with the modern FedCM flag, which One Tap's prompt()-only flow (the old approach
  // here) silently fails without in current Chrome.
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    const existing = document.getElementById("google-gsi");
    if (existing) {
      if (window.google?.accounts?.id) window.dispatchEvent(new Event("google-ready"));
      return;
    }
    const script = document.createElement("script");
    script.id = "google-gsi";
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => window.dispatchEvent(new Event("google-ready"));
    script.onerror = () => {
      // Google GSI blocked (e.g. 451 geo-restriction) — skip silently
      console.warn("Google Sign-In script unavailable in this region.");
    };
    document.head.appendChild(script);
  }, []);

  // ── Toast ─────────────────────────────────────────────────────────────────────
  const [toasts, setToasts] = useState([]);
  const addToast = useCallback((message, type = "info", duration = 3000) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
  }, []);

  // ── Session ───────────────────────────────────────────────────────────────────
  const [sessions, setSessions]             = useState([]);
  const [recentsSearch, setRecentsSearch]   = useState("");

  const filteredSessions = React.useMemo(() => {
    if (!recentsSearch) return sessions;
    return sessions.filter(s => s.title?.toLowerCase().includes(recentsSearch.toLowerCase()));
  }, [sessions, recentsSearch]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [histSearch, setHistSearch]         = useState("");
  const [pinnedIds, setPinnedIds]           = useState(() => JSON.parse(localStorage.getItem("vetroai_pins") || "[]"));
  const [isSidebarOpen, setIsSidebarOpen]   = useState(false);
  const [confirmDelete, setConfirmDelete]   = useState(null);
  // ── Spaces / Projects ─────────────────────────────────────────────────────────
  const [spaces, setSpaces] = useState([]);
  const [currentSpaceId, setCurrentSpaceId] = useState(null);
  const [editingSpace, setEditingSpace] = useState(null);
  // ── Chat ──────────────────────────────────────────────────────────────────────
  const [messages, setMessages]             = useState([]);
  const [isIncognito, setIsIncognito]       = useState(false);
  const [input, setInput]                   = useState("");
  const [editIdx, setEditIdx]               = useState(null);
  const [editInput, setEditInput]           = useState("");
  const [copiedAiIdx, setCopiedAiIdx]       = useState(null);
  const [copiedUserIdx, setCopiedUserIdx]   = useState(null);
  const [selectedMode, setSelectedMode]     = useState(MODES[0].id);
  const [selectedProvider, setSelectedProvider] = useState("Agnes");
  const isYtMode     = selectedMode === "youtube";
  const isWebMode    = selectedMode === "research" || selectedMode === "web_search";
  const isDeepSearch = selectedMode === "deep_search";
  const [selFile, setSelFile]               = useState(null);
  const [filePreview, setFilePreview]       = useState(null);
  const [isLoading, setIsLoading]           = useState(false);
  const [isTyping, setIsTyping]             = useState(false);
  const [temperature, setTemperature]       = useState(0.7);
  const [maxTokens, setMaxTokens]           = useState(4096);
  const [safeMode, setSafeMode]             = useState(true);
  const [lockModelPerChat, setLockModelPerChat] = useState(false);
  const [showScrollDn, setShowScrollDn]     = useState(false);
  const [reactions, setReactions]           = useState({});
  const [msgFeedback, setMsgFeedback]       = useState({});
  const [rxnFor, setRxnFor]                 = useState(null);
  const [streamingContent, setStreamingContent] = useState("");
  // FIX 1: track auto-continuation status
  const [isContinuing, setIsContinuing]     = useState(false);
  const [streamStatus, setStreamStatus]     = useState("idle"); // idle, preparing, streaming, retrying, recovering, failed
  const [debugLogs, setDebugLogs]           = useState([]);
  const [showDebug, setShowDebug]           = useState(false);

  const addDebugLog = (event, data = {}) => {
    const entry = { ts: new Date().toLocaleTimeString(), event, ...data };
    console.log(`[DEBUG] ${event}`, data);
    setDebugLogs(prev => [entry, ...prev].slice(0, 50));
  };
  const abortRef     = useRef(null);
  const requestIdRef = useRef(0);
  const transcriptCacheRef = useRef(new Map());

  // ── Web search ────────────────────────────────────────────────────────────────
  const [isWebSearching, setIsWebSearching] = useState(false);
  const [autoWebSearch, setAutoWebSearch]   = useState(true);
  const currentMode = MODES_LIST.find(m => m.id === selectedMode) || MODES_LIST[0];

  // ── Backend Health ────────────────────────────────────────────────────────────
  const [backendStatus, setBackendStatus] = useState("checking");
  const [providerStatus, setProviderStatus] = useState({});

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.shiftKey && e.key === "D") {
        setShowDebug(prev => !prev);
        addToast("Debug Panel " + (!showDebug ? "Enabled" : "Disabled"), "info");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showDebug]);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch(API + "/health");
        if (res.ok) {
          const json = await res.json();
          setBackendStatus(json.data?.backend || "online");
          setProviderStatus(json.data?.providers || {});
        } else {
          setBackendStatus("offline");
        }
      } catch {
        setBackendStatus("offline");
      }
    };
    checkHealth();
    const id = setInterval(checkHealth, 30000); // Check every 30s
    return () => clearInterval(id);
  }, []);

  const claudeStylePills = [
    { label: "Write", icon: PenLine, srcIdx: 1 },
    { label: "Learn", icon: GraduationCap, srcIdx: 0 },
    { label: "Code", icon: Code, srcIdx: 2 },
    { label: "Life stuff", icon: Coffee, srcIdx: 3 },
    { label: "VetroAI's choice", icon: Lightbulb, srcIdx: 4 },
  ];

  const suggestionOptions = isYtMode
    ? [
        "Paste a YouTube URL below for instant notes",
        "Summarize any lecture video",
        "Extract key points from tutorials",
        "Study notes from educational videos",
      ]
    : isDeepSearch
      ? [
        "Deep compare AI agent frameworks with citations",
        "Analyze market outlook from multiple sources",
        "Research best laptop for coding under budget",
        "Summarize latest tech policy changes with links",
      ]
      : isWebMode
        ? [
          "What's trending in tech today?",
          "Latest IPL scores",
          "Current stock market",
          "Recent AI news",
        ]
        : (t.suggestions || []);

  // ── YouTube ───────────────────────────────────────────────────────────────────
  const [isYtFetching, setIsYtFetching]     = useState(false);
  const [ytVideoData, setYtVideoData]       = useState({});

  // ── Follow-up ─────────────────────────────────────────────────────────────────
  const [followUps, setFollowUps]           = useState([]);
  const [followUpsLoading, setFollowUpsLoading] = useState(false);

  // ── Bookmarks & Memory ────────────────────────────────────────────────────────
  const [bookmarks, setBookmarks]           = useState(() => { try { return JSON.parse(localStorage.getItem("vetroai_bookmarks") || "[]"); } catch { return []; } });
  const [showBookmarks, setShowBookmarks]   = useState(false);
  const [memories, setMemories]             = useState([]);

  // Lightweight per-user memory backed by localStorage
  const getMemories = (email) => {
    try {
      const key = `vetroai_memories_${email}`;
      return JSON.parse(localStorage.getItem(key) || "[]");
    } catch { return []; }
  };

  // ── Modals ────────────────────────────────────────────────────────────────────
  const [showProfile, setShowProfile]       = useState(false);
  const [showSysPrompt, setShowSysPrompt]   = useState(false);
  const [showShare, setShowShare]           = useState(false);
  const [showNews, setShowNews]             = useState(false);
  const [showCalc, setShowCalc]             = useState(false);
  const [showScratchpad, setShowScratchpad] = useState(false);
  const [showPlayground, setShowPlayground] = useState(false);
  const [showStats, setShowStats]           = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [systemPrompt, setSystemPrompt]     = useState(() => localStorage.getItem("vetroai_sysprompt") || "");

  // ── NEW FEATURES ──────────────────────────────────────────────────────────────────────
  // Artifacts/Canvas panel
  const [artifactCode, setArtifactCode]     = useState(null);
  const [artifactLang, setArtifactLang]     = useState("text");
  // Projects (Spaces) panel + modal
  const [showSpaces, setShowSpaces]         = useState(false);
  const [showSpaceModal, setShowSpaceModal] = useState(false);
  // Artifacts gallery + active side-panel artifact
  const [artifacts, setArtifacts]           = useState([]);
  const [activeArtifact, setActiveArtifact] = useState(null);
  const [showArtifactsGallery, setShowArtifactsGallery] = useState(false);
  // Design canvas
  const [showDesign, setShowDesign]         = useState(false);
  // Persona
  const [activePersona, setActivePersona]   = useState(DEFAULT_PERSONAS[0]);
  const [showPersona, setShowPersona]       = useState(false);
  // Summary
  const [showSummary, setShowSummary]       = useState(false);
  // Source cards per message idx
  const [msgSources, setMsgSources]         = useState({});
  // PDF loading
  const [isPdfLoading, setIsPdfLoading]     = useState(false);
  // Backend available flag
  const [backendAvailable, setBackendAvailable] = useState(true);

  const checkBackendHealth = useCallback(async () => {
    try {
      const res = await fetch(API + "/health", { method: "GET", cache: "no-store" });
      if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
      setBackendAvailable(true);
      return true;
    } catch (err) {
      setBackendAvailable(false);
      return false;
    }
  }, []);

  useEffect(() => { checkBackendHealth(); }, [checkBackendHealth]);

  // ── Search ────────────────────────────────────────────────────────────────────
  const [chatSearchOpen, setChatSearchOpen]     = useState(false);
  const [chatSearchQuery, setChatSearchQuery]   = useState("");
  const [chatSearchCursor, setChatSearchCursor] = useState(0);

  // ── Voice ─────────────────────────────────────────────────────────────────────
  const [autoSpeak, setAutoSpeak]   = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isVoiceOpen, setIsVoiceOpen] = useState(false);
  const [isDictating, setIsDictating] = useState(false);

  // ── Refs ──────────────────────────────────────────────────────────────────────
  const feedRef        = useRef(null);
  const textareaRef    = useRef(null);
  const searchInputRef = useRef(null);
  const recogRef       = useRef(null);
  const fileInputRef   = useRef(null);
  const isScrolling    = useRef(false);
  const inputRef       = useRef(input);
  const voiceRef       = useRef(isVoiceOpen);
  const msgsRef        = useRef(messages);
  const loadRef        = useRef(isLoading);
  const submitVoiceRef = useRef(null);
  // FIX 1: ref for selectedMode inside async callbacks
  const selectedModeRef  = useRef(selectedMode);
  const systemPromptRef  = useRef(systemPrompt);
  const autoWebSearchRef = useRef(autoWebSearch);

  useEffect(() => { inputRef.current = input; }, [input]);
  useEffect(() => { voiceRef.current = isVoiceOpen; }, [isVoiceOpen]);
  useEffect(() => { msgsRef.current = messages; }, [messages]);
  useEffect(() => { loadRef.current = isLoading; }, [isLoading]);
  useEffect(() => { selectedModeRef.current = selectedMode; }, [selectedMode]);
  useEffect(() => { systemPromptRef.current = systemPrompt; }, [systemPrompt]);
  useEffect(() => { autoWebSearchRef.current = autoWebSearch; }, [autoWebSearch]);
  useEffect(() => { window.speechSynthesis?.cancel(); }, []);
  useEffect(() => { localStorage.setItem("vetroai_sysprompt", systemPrompt); }, [systemPrompt]);
  useEffect(() => { localStorage.setItem("vetroai_pins", JSON.stringify(pinnedIds)); }, [pinnedIds]);
  useEffect(() => { localStorage.setItem("vetroai_bookmarks", JSON.stringify(bookmarks)); }, [bookmarks]);
  useEffect(() => { if (userInfo?.email) setMemories(getMemories(userInfo.email)); }, [userInfo]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  useEffect(() => {
    const anyModal = isSidebarOpen || showProfile || showSysPrompt || showShare || showBookmarks || showCalc || showScratchpad || showPlayground || showStats || !!confirmDelete;
    document.body.style.overflow = anyModal ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [isSidebarOpen, showProfile, showSysPrompt, showShare, showBookmarks, showCalc, showScratchpad, showPlayground, showStats, confirmDelete]);

  // ── Auth submit ───────────────────────────────────────────────────────────────
  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError(""); setAuthLoading(true);
    const applyAuthPayload = (payload) => {
      const accessToken = payload?.accessToken;
      if (!accessToken) {
        setAuthError("Invalid auth response from server.");
        setAuthLoading(false);
        return false;
      }
      localStorage.setItem("token", accessToken);
      if (payload.refreshToken) localStorage.setItem("refreshToken", payload.refreshToken);
      const info = {
        name: payload.user?.name || authName || "",
        email: payload.user?.email || authEmail,
      };
      localStorage.setItem("vetroai_userinfo", JSON.stringify(info));
      setUser(accessToken);
      setUserInfo(info);
      return true;
    };
    const readApiError = (data) => {
      let msg = data?.message || data?.error || "Something went wrong";
      if (Array.isArray(data?.data) && data.data.length) {
        const joined = data.data.map((d) => d?.message || d).filter(Boolean).join(" · ");
        if (joined) msg = joined;
      }
      return msg;
    };
    if (authMode === "signup") {
      const name = authName?.trim() || "";
      if (name.length < 2) {
        setAuthError("Name must be at least 2 characters.");
        setAuthLoading(false);
        return;
      }
      const p = authPassword;
      if (p.length < 8) {
        setAuthError("Password must be at least 8 characters.");
        setAuthLoading(false);
        return;
      }
      if (!/[A-Z]/.test(p)) {
        setAuthError("Password must include at least one uppercase letter.");
        setAuthLoading(false);
        return;
      }
      if (!/[0-9]/.test(p)) {
        setAuthError("Password must include at least one number.");
        setAuthLoading(false);
        return;
      }
    }
    try {
      const endpoint = authMode === "login" ? "/auth/login" : "/auth/signup";
      const body = authMode === "login"
        ? { email: authEmail, password: authPassword }
        : { email: authEmail, password: authPassword, name: authName.trim() };

      // Try the API with a 10s timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      let res, data;
      try {
        res  = await fetch(API + endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        data = await res.json();
      } catch (netErr) {
        clearTimeout(timeoutId);
        // Backend unreachable — use local demo session so user can still access the app
        const localToken = `local_${Date.now()}_${btoa(authEmail)}`;
        const info = { name: authName.trim() || authEmail.split("@")[0], email: authEmail, isLocal: true };
        localStorage.setItem("token", localToken);
        localStorage.setItem("vetroai_userinfo", JSON.stringify(info));
        setUser(localToken);
        setUserInfo(info);
        addToast("Server offline — running in offline mode. Chat features still work!", "info", 5000);
        setAuthLoading(false);
        return;
      }

      if (!res.ok || data.success === false) {
        setAuthError(readApiError(data));
        setAuthLoading(false);
        return;
      }
      const payload = data?.data || {};
      if (authMode === "signup") {
        if (payload.accessToken) {
          applyAuthPayload(payload);
          setAuthLoading(false);
          return;
        }
        setAuthMode("login");
        setAuthError("Account created! Please sign in.");
        setAuthLoading(false);
        return;
      }
      applyAuthPayload(payload);
    } catch {
      setAuthError("Something went wrong. Please try again.");
    }
    setAuthLoading(false);
  };

  const logout = () => {
    localStorage.removeItem("token"); localStorage.removeItem("refreshToken"); localStorage.removeItem("vetroai_userinfo");
    setUser(null); setUserInfo(null); setMessages([]); setCurrentSessionId(null);
    setAuthEmail(""); setAuthPassword(""); setAuthName(""); setAuthError("");
    addToast("Signed out successfully", "info");
  };

  // ── Session management ────────────────────────────────────────────────────────
  useEffect(() => {
    if (user) {
      try { const s = localStorage.getItem("vetroai_sessions_" + userKey); if (s) setSessions(JSON.parse(s) || []); } catch { setSessions([]); }
      try { const sp = localStorage.getItem("vetroai_spaces_" + userKey); if (sp) setSpaces(JSON.parse(sp) || []); } catch { setSpaces([]); }
      try { const cSpace = localStorage.getItem("vetroai_current_space_" + userKey); if (cSpace) setCurrentSpaceId(cSpace); } catch { setCurrentSpaceId(null); }
      try { const ar = localStorage.getItem("vetroai_artifacts_" + userKey); if (ar) setArtifacts(JSON.parse(ar) || []); } catch { setArtifacts([]); }
    }
  }, [user]);

  // ── Billing status (plan + credit balance) ───────────────────────────────────
  const refreshBillingStatus = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!token || token.startsWith("local_")) return;
    try {
      const res = await fetch(API + "/billing/me", { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) {
        // Token is expired/invalid server-side — stop retrying with it.
        localStorage.removeItem("token"); localStorage.removeItem("refreshToken");
        return;
      }
      const data = await res.json();
      if (!res.ok || data.success === false) return;
      const { plan, credits, subscriptionStatus, planRenewsAt } = data.data;
      setUserInfo((prev) => {
        const next = { ...(prev || {}), plan, credits, subscriptionStatus, planRenewsAt };
        localStorage.setItem("vetroai_userinfo", JSON.stringify(next));
        return next;
      });
    } catch { /* offline or unreachable — keep last known plan */ }
  }, []);

  useEffect(() => { if (user) refreshBillingStatus(); }, [user, refreshBillingStatus]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billing = params.get("billing");
    if (!billing) return;
    if (billing === "success") {
      addToast("Payment received — your plan is being activated.", "success", 4000);
      refreshBillingStatus();
    } else if (billing === "cancel") {
      addToast("Checkout cancelled — no charge was made.", "info", 3000);
    }
    params.delete("billing"); params.delete("plan");
    const cleanUrl = window.location.pathname + (params.toString() ? `?${params}` : "");
    window.history.replaceState({}, "", cleanUrl);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (messages.length === 0 || !user || isIncognito) return;
    try {
      const content = messages[0]?.content || "Chat";
      const words = content.split(/\s+/);
      const title = words.slice(0, 4).join(" ") + (words.length > 4 ? "…" : "");
      if (!currentSessionId) {
        const id = Date.now().toString();
        setCurrentSessionId(id);
        setSessions((prev) => {
          const list = [{ id, title, messages, spaceId: currentSpaceId }, ...prev];
          try { localStorage.setItem("vetroai_sessions_" + userKey, JSON.stringify(list)); } catch (err) { swallowError(err); }
          return list;
        });
        return;
      }
      setSessions((prev) => {
        const list = [...prev];
        const i = list.findIndex((s) => s.id === currentSessionId);
        if (i !== -1) list[i] = { ...list[i], messages };
        else list.unshift({ id: currentSessionId, title, messages, spaceId: currentSpaceId });
        try { localStorage.setItem("vetroai_sessions_" + userKey, JSON.stringify(list)); } catch (err) { swallowError(err); }
        return list;
      });
    } catch (err) { swallowError(err); }
  }, [messages, currentSessionId, user]);

  const updateSessionTitle = useCallback(async (userMsg, botMsg) => {
    if (!userMsg || !currentSessionId || isIncognito) return;
    try {
      const payload = botMsg ? `User: ${userMsg}\nAI: ${botMsg}` : userMsg;
      const res  = await fetch(API + "/generate-title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstMessage: payload }),
      });
      const data = await res.json();
      if (data.title) {
        setSessions(prev => {
          const list = prev.map(s => s.id === currentSessionId ? { ...s, title: data.title } : s);
          localStorage.setItem("vetroai_sessions_" + userKey, JSON.stringify(list));
          return list;
        });
      }
    } catch (err) { swallowError(err); }
  }, [currentSessionId, user]);

  const loadSession = id => {
    const s = sessions.find(x => x.id === id);
    if (s) { setMessages(s.messages || []); setCurrentSessionId(id); stopSpeak(); setIsSidebarOpen(false); isScrolling.current = false; setFollowUps([]); }
  };

  const newChat = useCallback((spaceIdOverride) => {
    requestIdRef.current += 1;
    abortRef.current?.abort();
    setMessages([]); setCurrentSessionId(null); setInput(""); setIsIncognito(false); stopSpeak();
    setIsSidebarOpen(false); setReactions({}); setFollowUps([]); setMsgFeedback({});
    setIsLoading(false); setIsTyping(false); setIsWebSearching(false); setIsYtFetching(false);
    setStreamingContent(""); setIsContinuing(false);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    const activeSpaceId = spaceIdOverride !== undefined && typeof spaceIdOverride === 'string' ? spaceIdOverride : (spaceIdOverride === null ? null : currentSpaceId);
    if (activeSpaceId) {
      const sp = spaces.find(s => s.id === activeSpaceId);
      if (sp) {
        setSelectedMode(sp.mode);
        setSystemPrompt(sp.systemPrompt);
      }
    }
  }, [currentSpaceId, spaces]);

  const handleSwitchSpace = (spaceId) => {
    setCurrentSpaceId(spaceId);
    if (spaceId) localStorage.setItem("vetroai_current_space_" + userKey, spaceId);
    else localStorage.removeItem("vetroai_current_space_" + userKey);
    newChat(spaceId);
  };

  const saveSpace = (spaceData) => {
    setSpaces(prev => {
      const exists = prev.some(s => s.id === spaceData.id);
      const list = exists ? prev.map(s => s.id === spaceData.id ? spaceData : s) : [...prev, spaceData];
      try { localStorage.setItem("vetroai_spaces_" + userKey, JSON.stringify(list)); } catch (err) { swallowError(err); }
      return list;
    });
    setShowSpaceModal(false); setEditingSpace(null);
    handleSwitchSpace(spaceData.id);
    setShowSpaces(false);
    addToast(`Project "${spaceData.name}" saved`, "success", 2000);
  };

  const deleteSpaceById = (id) => {
    setSpaces(prev => {
      const list = prev.filter(s => s.id !== id);
      try { localStorage.setItem("vetroai_spaces_" + userKey, JSON.stringify(list)); } catch (err) { swallowError(err); }
      return list;
    });
    if (currentSpaceId === id) handleSwitchSpace(null);
    setShowSpaceModal(false); setEditingSpace(null);
    addToast("Project deleted", "info", 1500);
  };

  const saveArtifact = useCallback((code, language, title) => {
    const artifact = { id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, code, language: language || "text", title: title || "Untitled artifact", createdAt: Date.now() };
    setArtifacts(prev => {
      const list = [...prev, artifact].slice(-50);
      try { localStorage.setItem("vetroai_artifacts_" + userKey, JSON.stringify(list)); } catch (err) { swallowError(err); }
      return list;
    });
    setActiveArtifact(artifact);
  }, [user, userKey]);

  const deleteSession = (id) => { setConfirmDelete({ id, message: "Delete this conversation? This cannot be undone." }); };

  const renameSession = (id, newTitle) => {
    setSessions(prev => {
      const list = prev.map(s => s.id === id ? { ...s, title: newTitle } : s);
      try { localStorage.setItem("vetroai_sessions_" + userKey, JSON.stringify(list)); } catch (err) { swallowError(err); }
      return list;
    });
  };

  const confirmDeleteSession = () => {
    if (!confirmDelete) return;
    const { id } = confirmDelete;
    const list = sessions.filter(s => s.id !== id); setSessions(list);
    try { localStorage.setItem("vetroai_sessions_" + userKey, JSON.stringify(list)); } catch (err) { swallowError(err); }
    if (currentSessionId === id) newChat();
    setPinnedIds(p => p.filter(x => x !== id));
    setConfirmDelete(null);
    addToast("Conversation deleted", "info");
  };

  const togglePin = (e, id) => {
    e.stopPropagation();
    setPinnedIds(p => {
      const pinned = p.includes(id) ? p.filter(x => x !== id) : [id, ...p];
      addToast(p.includes(id) ? "Unpinned" : "📌 Pinned", "info", 1500);
      return pinned;
    });
  };

  // ── Bookmarks ─────────────────────────────────────────────────────────────────
  const toggleBookmark = (msg) => {
    setBookmarks(prev => {
      const id = `${msg.timestamp}_${msg.content?.slice(0, 20)}`;
      const exists = prev.find(b => b.id === id);
      if (exists) { addToast("Bookmark removed", "info", 1500); return prev.filter(b => b.id !== id); }
      addToast("🔖 Bookmarked!", "success", 1500);
      return [...prev, { id, ...msg }];
    });
  };
  const isBookmarked  = (msg) => { const id = `${msg.timestamp}_${msg.content?.slice(0, 20)}`; return bookmarks.some(b => b.id === id); };
  const removeBookmark = (id) => setBookmarks(prev => prev.filter(b => b.id !== id));


  // ── Follow-up generation ──────────────────────────────────────────────────────
  const generateFollowUps = useCallback(async (lastBotMsg, userQuery) => {
    if (!lastBotMsg || lastBotMsg.length < 50) return;
    setFollowUpsLoading(true);
    try {
      const res  = await fetch(API + "/follow-ups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lastMessage: lastBotMsg.slice(0, 600), userQuery: userQuery?.slice(0, 150) || "" }),
      });
      const data = await res.json();
      setFollowUps(data.suggestions || []);
    } catch { setFollowUps([]); }
    setFollowUpsLoading(false);
  }, []);

  // ── Computed data ─────────────────────────────────────────────────────────────
  const { pinnedSessions, groupedSessions } = useMemo(() => {
    const spaceMatch = s => currentSpaceId ? s.spaceId === currentSpaceId : (!s.spaceId || s.spaceId === "null");
    const filtered = sessions.filter(s => spaceMatch(s) && s?.title?.toLowerCase().includes(histSearch.toLowerCase()));
    const pinned   = filtered.filter(s => pinnedIds.includes(s.id));
    const rest     = filtered.filter(s => !pinnedIds.includes(s.id));
    const groups   = {};
    rest.forEach(s => { const g = getDateGroup(s.id, t); if (!groups[g]) groups[g] = []; groups[g].push(s); });
    return { pinnedSessions: pinned, groupedSessions: groups };
  }, [sessions, histSearch, pinnedIds, t]);

  const dateOrder = [t.today, t.yesterday, t.older];

  const chatSearchResults = useMemo(() => {
    if (!chatSearchQuery.trim()) return [];
    const q = chatSearchQuery.toLowerCase();
    return messages.reduce((a, m, i) => { if (m.content?.toLowerCase().includes(q)) a.push(i); return a; }, []);
  }, [messages, chatSearchQuery]);

  useEffect(() => {
    if (!chatSearchResults.length) return;
    document.querySelector(`.msg-${chatSearchResults[chatSearchCursor % chatSearchResults.length]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [chatSearchCursor, chatSearchResults]);

  useEffect(() => { if (chatSearchOpen) setTimeout(() => searchInputRef.current?.focus(), 80); }, [chatSearchOpen]);

  useEffect(() => {
    if (rxnFor === null) return;
    const h = () => setRxnFor(null);
    setTimeout(() => window.addEventListener("click", h), 10);
    return () => window.removeEventListener("click", h);
  }, [rxnFor]);

  // ── Voice helpers ─────────────────────────────────────────────────────────────
  const stopSpeak = () => window.speechSynthesis?.cancel();
  const closeVoice = useCallback(() => {
    setIsVoiceOpen(false);
    if (isListening) recogRef.current?.stop();
    setIsListening(false);
    stopSpeak();
  }, [isListening]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  useEffect(() => {
    const h = e => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") {
        if (confirmDelete)  { setConfirmDelete(null); return; }
        if (showCalc)       { setShowCalc(false); return; }
        if (showProfile)    { setShowProfile(false); return; }
        if (showSysPrompt)  { setShowSysPrompt(false); return; }
        if (showShare)      { setShowShare(false); return; }
        if (showBookmarks)  { setShowBookmarks(false); return; }
        if (isSidebarOpen)  { setIsSidebarOpen(false); return; }
        if (isVoiceOpen)    { closeVoice(); return; }
        if (chatSearchOpen) { setChatSearchOpen(false); setChatSearchQuery(""); return; }
      }
      if (!ctrl) return;
      if (e.key === "k" || e.key === "K") { e.preventDefault(); newChat(); }
      if (e.key === "/")                   { e.preventDefault(); textareaRef.current?.focus(); }
      if (e.key === "p" || e.key === "P") { e.preventDefault(); setShowProfile(v => !v); }
      if (e.key === "f" || e.key === "F") { e.preventDefault(); setChatSearchOpen(v => !v); }
      if (e.key === "b" || e.key === "B") { e.preventDefault(); setShowBookmarks(v => !v); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [chatSearchOpen, closeVoice, confirmDelete, isSidebarOpen, isVoiceOpen, newChat, showBookmarks, showCalc, showProfile, showShare, showSysPrompt]);

  // ── Scroll ────────────────────────────────────────────────────────────────────
  const handleScroll = () => {
    if (!feedRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = feedRef.current;
    const far = scrollHeight - scrollTop - clientHeight > 120;
    isScrolling.current = far; setShowScrollDn(far);
  };
  const scrollToBottom = useCallback(() => {
    if (feedRef.current) { feedRef.current.scrollTop = feedRef.current.scrollHeight; isScrolling.current = false; setShowScrollDn(false); }
  }, []);
  useEffect(() => { if (!isScrolling.current) scrollToBottom(); }, [messages, scrollToBottom, streamingContent]);

  // ── Voice ─────────────────────────────────────────────────────────────────────
  const speak = txt => {
    if (!window.speechSynthesis) return; stopSpeak();
    const c = (txt || "").replace(/[*#_`~]/g, "").replace(/\$\$.*?\$\$/gs, "[equation]").replace(/\$.*?\$/g, "[math]");
    if (!c.trim()) return;
    const u   = new SpeechSynthesisUtterance(c);
    const vs  = window.speechSynthesis.getVoices();

    const hasHindi = /[\u0900-\u097F]/.test(c);
    const hasSpanish = /[áéíóúñÁÉÍÓÚÑ]/.test(c);
    const targetLang = hasHindi ? "hi" : hasSpanish ? "es" : "en";

    const premiumFemales = ["Aria", "Samantha", "Zira", "Karen", "Victoria", "Tessa", "Google UK English Female", "Google US English", "Amalia", "Monica", "Lekha"];

    let best = vs.find(v => v.lang.startsWith(targetLang) && premiumFemales.some(n => v.name.includes(n)))
            || vs.find(v => v.lang.startsWith(targetLang) && (v.name.toLowerCase().includes("female") || v.name.includes("Natural") || v.name.includes("Online")))
            || vs.find(v => v.lang.startsWith(targetLang))
            || vs.find(v => premiumFemales.some(n => v.name.includes(n)))
            || vs[0];

    u.voice = best;
    u.lang = best?.lang || (hasHindi ? 'hi-IN' : hasSpanish ? 'es-ES' : 'en-US');
    u.pitch = 1.08;
    u.rate = 1.02;

    u.onstart = () => { try { recogRef.current?.stop(); } catch (err) { swallowError(err); } setIsListening(false); };
    u.onend   = () => { if (voiceRef.current) { setInput(""); try { recogRef.current?.start(); setIsListening(true); } catch (err) { swallowError(err); } } };
    window.speechSynthesis.speak(u);
  };

  useEffect(() => {
    const lv = () => window.speechSynthesis?.getVoices();
    lv();
    if (window.speechSynthesis?.onvoiceschanged !== undefined) window.speechSynthesis.onvoiceschanged = lv;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const sr = new SR();
    sr.interimResults = true;
    sr.continuous = true;
    sr.lang = navigator.language || 'en-US';

    sr.onresult = e => {
      if (window.speechSynthesis?.speaking) return;
      let txt = "";
      for (let i = e.resultIndex; i < e.results.length; i++) txt += e.results[i][0].transcript;
      setInput(txt);
    };
    sr.onend = () => {
      if (voiceRef.current && !loadRef.current && !window.speechSynthesis?.speaking) {
        const cur = inputRef.current || "";
        if (cur.trim()) {
          submitVoiceRef.current?.(cur);
        } else {
          setTimeout(() => {
            if (voiceRef.current && !loadRef.current && !window.speechSynthesis?.speaking) {
              try { sr.start(); setIsListening(true); } catch (err) { swallowError(err); }
            }
          }, 400);
        }
      } else {
        setIsListening(false);
      }
    };
    sr.onerror = e => {
      if (e.error === "not-allowed") { setIsListening(false); setIsVoiceOpen(false); addToast("⚠️ Microphone access denied", "error"); }
      if (e.error === "no-speech" || e.error === "network") {
         if (voiceRef.current && !window.speechSynthesis?.speaking) {
             try { sr.start(); setIsListening(true); } catch (err) { swallowError(err); }
         }
      }
    };
    recogRef.current = sr;
  }, [addToast]);

  const toggleMic = e => { e?.preventDefault(); if (!recogRef.current) return; if (isListening) recogRef.current.stop(); else { setInput(""); recogRef.current.start(); setIsListening(true); } };
  const openVoice = e => { e.preventDefault(); window.speechSynthesis?.speak(new SpeechSynthesisUtterance("")); setAutoSpeak(true); setIsVoiceOpen(true); if (!isListening) { setInput(""); try { recogRef.current?.start(); setIsListening(true); } catch (err) { swallowError(err); } } };

  const handleOrb = () => {
    if (isLoading) return;
    if (window.speechSynthesis?.speaking) { stopSpeak(); setInput(""); try { recogRef.current?.start(); setIsListening(true); } catch (err) { swallowError(err); } }
    else if (isListening) { recogRef.current?.stop(); }
    else { setInput(""); try { recogRef.current?.start(); setIsListening(true); } catch (err) { swallowError(err); } }
  };

  const handleFileChange = async e => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) { addToast(`⚠️ File too large (max ${MAX_FILE_SIZE_MB}MB)`, "error"); return; }
    // PDF handling — extract text client-side
    if (f.type === "application/pdf" || f.name.endsWith(".pdf")) {
      setIsPdfLoading(true);
      addToast("📄 Parsing PDF…", "info", 2000);
      try {
        const text = await extractPdfText(f);
        // Create a synthetic text file with PDF content
        const textBlob = new Blob([`[PDF: ${f.name}]\n\n${text}`], { type: "text/plain" });
        const textFile = new File([textBlob], f.name.replace(".pdf", ".txt"), { type: "text/plain" });
        setSelFile(textFile);
        setFilePreview(null);
        addToast(`📄 PDF ready (${text.length} chars from ${f.name})`, "success", 3000);
      } catch (err) {
        addToast("⚠️ Could not parse PDF. Try a text file.", "error");
      } finally {
        setIsPdfLoading(false);
      }
      return;
    }
    setSelFile(f);
    if (f.type.startsWith("image/")) { const r = new FileReader(); r.onloadend = () => setFilePreview(r.result); r.readAsDataURL(f); }
    else { setFilePreview(null); addToast(`📎 ${f.name} attached`, "success", 2000); }
  };

  const stopGeneration = () => {
    requestIdRef.current += 1;
    abortRef.current?.abort();
    setIsLoading(false); setIsTyping(false); setIsWebSearching(false); setIsYtFetching(false);
    setStreamingContent(""); setIsContinuing(false); setStreamStatus("idle");
    setMessages(prev => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.role === "assistant" && !last.content) {
        return prev.slice(0, -1);
      }
      return prev;
    });
  };

  const insertFmt = (pre, suf = "") => {
    if (!textareaRef.current) return;
    const { selectionStart: s, selectionEnd: e, value: v } = textareaRef.current;
    const sel = v.slice(s, e);
    setInput(v.slice(0, s) + pre + (sel || "text") + suf + v.slice(e));
    setTimeout(() => { if (textareaRef.current) { textareaRef.current.focus(); textareaRef.current.setSelectionRange(s + pre.length, s + pre.length + (sel || "text").length); } }, 0);
  };

  const MULTI_AI_MODELS = [
    { name: "Agnes 2.0",  id: "agnes",     color: "#3b82f6" },
    { name: "Mistral",    id: "mistral",   color: "#f97316" },
    { name: "Groq",       id: "groq",      color: "#10b981" },
    { name: "Gemini",     id: "gemini",    color: "#8b5cf6" },
    { name: "SambaNova",  id: "sambanova", color: "#ec4899" },
    { name: "Web Search", id: "_web",      color: "#06b6d4", isWeb: true },
  ];

  const handleMultiAI = async (hist, baseFd, userQuery, isFirstMsg, ctrl, isActive, reqId) => {
    const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const emptyMultiMsg = {
      role: "assistant",
      isMultiAi: true,
      timestamp: ts,
      phase: "querying",
      models: MULTI_AI_MODELS.map(m => ({ ...m, content: "", status: "waiting", startTime: null, endTime: null })),
      consensus: null
    };

    setMessages([...hist, emptyMultiMsg]);
    setIsTyping(false);
    setIsWebSearching(false);
    setStreamStatus("streaming");

    const updateMultiMsg = (updater) => {
      if (!isActive()) return;
      setMessages(prev => {
        const u = [...prev];
        const last = { ...u[u.length - 1] };
        if (last.isMultiAi) {
          updater(last);
          u[u.length - 1] = last;
        }
        return u;
      });
    };

    const updateModel = (idx, content, status, extra) => {
      updateMultiMsg(last => {
        last.models = [...last.models];
        last.models[idx] = { ...last.models[idx] };
        if (content !== undefined) last.models[idx].content = content;
        if (status !== undefined) last.models[idx].status = status;
        if (extra) Object.assign(last.models[idx], extra);
      });
    };

    const runModel = async (provider, idx) => {
      const fd = new FormData();
      for (let [k, v] of baseFd.entries()) fd.append(k, v);
      fd.set("provider", provider);
      fd.set("mode", "normal");
      fd.set("webSearch", "false");
      const t0 = Date.now();
      updateModel(idx, "", "streaming", { startTime: t0 });
      try {
        const res = await fetch(API + "/chat", { method: "POST", body: fd, signal: ctrl.signal });
        if (!res.ok) throw new Error("Failed");
        const reader = res.body.getReader();
        const bot = await readSSEStream(
          reader,
          (acc) => { updateModel(idx, acc); if (!isScrolling.current) scrollToBottom(); },
          () => {}, () => {}, isActive, reqId
        );
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        updateModel(idx, bot, "done", { endTime: Date.now(), elapsed });
        return { provider, content: bot, elapsed };
      } catch (err) {
        if (err.name === "AbortError") return { provider, content: "", elapsed: "0" };
        updateModel(idx, "", "error", { endTime: Date.now() });
        return { provider, content: "", error: true };
      }
    };

    const runWebSearch = async (idx) => {
      const fd = new FormData();
      for (let [k, v] of baseFd.entries()) fd.append(k, v);
      fd.set("provider", "agnes");
      fd.set("mode", "normal");
      fd.set("webSearch", "true");
      const t0 = Date.now();
      updateModel(idx, "", "streaming", { startTime: t0 });
      try {
        const res = await fetch(API + "/chat", { method: "POST", body: fd, signal: ctrl.signal });
        if (!res.ok) throw new Error("Failed");
        const reader = res.body.getReader();
        const bot = await readSSEStream(
          reader,
          (acc) => { updateModel(idx, acc); if (!isScrolling.current) scrollToBottom(); },
          () => {}, () => {}, isActive, reqId
        );
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        updateModel(idx, bot, "done", { endTime: Date.now(), elapsed });
        return { provider: "web_search", content: bot, elapsed };
      } catch (err) {
        if (err.name === "AbortError") return { provider: "web_search", content: "", elapsed: "0" };
        updateModel(idx, "", "error", { endTime: Date.now() });
        return { provider: "web_search", content: "", error: true };
      }
    };

    // Phase 1: Query all 5 AI models + web search in parallel
    const results = await Promise.all(
      MULTI_AI_MODELS.map((m, i) => m.isWeb ? runWebSearch(i) : runModel(m.id, i))
    );

    if (!isActive()) return;

    // Phase 2: Synthesize best answer from all sources
    updateMultiMsg(last => { last.phase = "synthesizing"; last.consensus = "generating"; });

    const validResults = results.filter(r => r.content && !r.error);
    const responseSummary = validResults.map((r) =>
      `[${r.provider.toUpperCase()} — ${r.elapsed}s]\n${r.content.slice(0, 4000)}`
    ).join("\n\n---\n\n");

    const consensusFd = new FormData();
    consensusFd.append("input", `You are the chief synthesizer in VetroAI's multi-AI council. ${validResults.length} sources (5 AI models + live web search) have independently answered the user's question. Your job is to produce the SINGLE DEFINITIVE answer.

INSTRUCTIONS:
1. Read ALL source responses carefully. Extract the strongest, most accurate, and most detailed points from each.
2. If sources contradict each other, pick the most well-reasoned and well-sourced version.
3. If the web search provides real-time data (dates, prices, scores, stats), incorporate it as factual ground truth.
4. Structure your answer with clear headings, bullet points, and sections where appropriate.
5. Be THOROUGH and COMPREHENSIVE — this is the premium multi-AI experience. Write a detailed, well-structured answer that covers all important aspects. Aim for depth, not brevity.
6. Include relevant examples, numbers, and specifics. Don't be vague.
7. If sources provide URLs or citations, include the most relevant ones.
8. Do NOT mention the individual AI models or say "according to Model X". Write as one authoritative voice.

USER QUESTION: "${userQuery}"

SOURCE RESPONSES:
${responseSummary}

Write the definitive, comprehensive answer with proper markdown formatting (headers, bold, lists, etc.).`);
    consensusFd.append("messages", JSON.stringify([{ role: "user", content: "Synthesize the best answer." }]));
    consensusFd.append("mode", "normal");
    consensusFd.append("provider", "agnes");
    consensusFd.append("temperature", "0.3");
    consensusFd.append("maxTokens", "8000");

    try {
      const cRes = await fetch(API + "/chat", { method: "POST", body: consensusFd, signal: ctrl.signal });
      const cReader = cRes.body.getReader();
      const consensusText = await readSSEStream(
        cReader,
        (acc) => {
          if (!isActive()) return;
          updateMultiMsg(last => { last.consensus = acc; });
          if (!isScrolling.current) scrollToBottom();
        },
        () => {}, () => {}, isActive, reqId
      );

      updateMultiMsg(last => { last.phase = "complete"; });

      if (isActive() && isFirstMsg) {
        updateSessionTitle(userQuery, consensusText);
      }
    } catch (err) {
      if (!isActive()) return;
      updateMultiMsg(last => { last.consensus = "Failed to generate synthesis."; last.phase = "complete"; });
    }

    setIsLoading(false);
    setStreamStatus("idle");
  };

  const triggerAI = async (hist, fileData = null, ytContext = null) => {
    const reqId = Date.now().toString();
    abortRef.current?.abort();
    const ctrl      = new AbortController(); abortRef.current = ctrl;
    const requestId = ++requestIdRef.current;
    const isActive  = () => requestIdRef.current === requestId && !ctrl.signal.aborted;

    setIsLoading(true); setIsTyping(true); setStreamStatus("preparing"); scrollToBottom(); stopSpeak();
    setFollowUps([]); setIsContinuing(false);

    // Show web searching indicator if web search will be triggered
    const willWebSearch = autoWebSearchRef.current || isWebMode || isDeepSearch || selectedMode === "research";
    if (willWebSearch) setIsWebSearching(true);

    const userQuery = hist[hist.length - 1]?.content || "";
    const isFirstMsg = hist.filter(m => m.role === "user").length === 1;

    const fd = new FormData();
    fd.append("input", userQuery);
    fd.append("messages", JSON.stringify(hist.slice(-12)));
    fd.append("mode", selectedMode);
    fd.append("provider", selectedProvider);
    fd.append("temperature", String(temperature));
    fd.append("maxTokens", String(maxTokens));
    fd.append("reqId", reqId);
    fd.append("memories", JSON.stringify(memories));

    let finalSystemPrompt = systemPromptRef.current || "";
    if (currentSpaceId) {
      const space = spaces.find(s => s.id === currentSpaceId);
      if (space) {
        if (space.systemPrompt) {
          finalSystemPrompt = `[SPACE INSTRUCTIONS]\n${space.systemPrompt}\n\n` + finalSystemPrompt;
        }
        if (space.files && space.files.length > 0) {
          const filesContext = space.files.map(f => `--- FILE: ${f.name} ---\n${f.content}\n`).join("\n");
          finalSystemPrompt += `\n\n[SPACE KNOWLEDGE FILES]\n${filesContext}`;
        }
      }
    }
    if (finalSystemPrompt.trim()) {
      fd.append("systemPrompt", finalSystemPrompt.trim());
    }

    const sportsDetected = isSportsQuery(userQuery);
    const shouldWebSearch = autoWebSearchRef.current || isWebMode || isDeepSearch || selectedMode === "research" || sportsDetected;
    fd.append("webSearch", String(shouldWebSearch));

    if (ytContext) {
      fd.append("ytContext", JSON.stringify(ytContext));
    }

    if (fileData) fd.append("file", fileData);

    if (selectedMode === "multi_ai") {
      await handleMultiAI(hist, fd, userQuery, isFirstMsg, ctrl, isActive, reqId);
      return;
    }
    const sportsPromise = sportsDetected ? fetchAllLiveScores(API, userQuery) : Promise.resolve(null);

    const ts     = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const emptyAssistantMsg = {
      role: "assistant",
      content: "",
      timestamp: ts,
      provider: selectedProvider,
      ytInfo: ytContext ? { title: ytContext.title, author: ytContext.author, videoId: ytContext.videoId } : null,
      liveScores: null,
    };
    setMessages([...hist, emptyAssistantMsg]);

    try {
      addDebugLog("Fetch.start", { reqId, provider: selectedProvider, mode: selectedMode });

      const res = await fetch(API + "/chat", {
        method: "POST",
        body: fd,
        signal: ctrl.signal
      });

      if (!isActive()) return;

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `Server error: ${res.status}`);
      }

      const reader = res.body.getReader();

      setIsTyping(false);
      setIsWebSearching(false); // Clear web searching indicator once streaming starts
      setStreamStatus("streaming");
      const bot = await readSSEStream(
        reader,
        (acc) => {
          if (!isActive()) return;
          setMessages(prev => {
            const u = [...prev]; u[u.length - 1] = { ...u[u.length - 1], content: acc }; return u;
          });
          setStreamingContent(acc);
          if (!isScrolling.current) scrollToBottom();
        },
        (statusMsg) => {
          if (!isActive()) return;
          setStreamStatus(statusMsg);
          addDebugLog("SSE.status", { status: statusMsg });
        },
        (errorMsg) => {
          addToast(errorMsg, "error");
        },
        isActive,
        reqId
      );

      setIsLoading(false);
      setStreamStatus("idle");
      setStreamingContent("");

      if (!isActive()) return;

      const sportsData = await sportsPromise;
      if (sportsData && sportsData.length > 0) {
        setMessages(prev => {
          const u = [...prev];
          u[u.length - 1] = { ...u[u.length - 1], liveScores: sportsData };
          return u;
        });
      }

      if (!bot || !bot.trim()) {
        setMessages(prev => {
          if (prev.length === 0) return prev;
          const u = [...prev];
          u[u.length - 1] = {
            ...u[u.length - 1],
            content: "The AI model failed to respond. This can happen if the provider is temporarily unavailable or if there is a timeout. Please try again or switch AI models."
          };
          return u;
        });
      } else {
        if (voiceRef.current || autoSpeak) speak(bot);
        if (isFirstMsg) updateSessionTitle(userQuery, bot);
        generateFollowUps(bot, userQuery);
      }

    } catch (err) {
      if (err.name === "AbortError") {
        setMessages(prev => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          if (last.role === "assistant" && !last.content) {
            return prev.slice(0, -1);
          }
          return prev;
        });
        return;
      }
      addDebugLog("Chat.catch", { reqId, error: err.message });
      setIsLoading(false); setStreamStatus("failed");
      addToast(err.message || "Connection issue", "error");

      const ts2 = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setMessages(prev => {
        const u = [...prev];
        const lastIdx = u.map(m => m.role).lastIndexOf("assistant");
        if (lastIdx !== -1 && !u[lastIdx].content) {
          u[lastIdx] = {
            role: "assistant",
            content: `I encountered an issue: "${err.message}". Please try again.`,
            timestamp: ts2
          };
        } else {
          u.push({
            role: "assistant",
            content: `I encountered an issue: "${err.message}". Please try again.`,
            timestamp: ts2
          });
        }
        return u;
      });
    } finally {
      setSelFile(null); setFilePreview(null);
    }
  };

  const submitVoice = useCallback(txt => {
    try { recogRef.current?.stop(); } catch (err) { swallowError(err); }
    setIsListening(false);
    const ts   = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const hist = [...msgsRef.current, { role: "user", content: txt, timestamp: ts }];
    setMessages(hist); setInput(""); triggerAI(hist);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { submitVoiceRef.current = submitVoice; }, [submitVoice]);

  const sendMessage = async (e, prefill) => {
    e?.preventDefault();
    const text = (prefill || input).trim();
    if (!text && !selFile) return;
    if (isListening) recogRef.current?.stop();

    // Auto-detect Code mode suggestion
    if (selectedMode === "normal" && (text.includes("```") || /function\s+\w+\s*\(|const\s+\w+\s*=|class\s+\w+/.test(text))) {
      addToast("Tip: Code detected. Switch to Code mode for optimized coding answers.", "info", 4000);
    }
    // Image generation intercept
    const imgPrompt = detectImagePrompt(text);
    if (imgPrompt && !selFile) {
      const ts      = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const userMsg = { role: "user", content: text, timestamp: ts };
      const pendingBotMsg = {
        role: "assistant", content: "Generating your image...", timestamp: ts, isImageGen: true, isPending: true,
      };
      setMessages(prev => [...prev, userMsg, pendingBotMsg]);
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      if (messages.length === 0) updateSessionTitle(text);

      try {
        const imgUrl = await generateImageViaAgnes(imgPrompt);
        setMessages(prev => {
          const u = [...prev];
          const idx = u.lastIndexOf(pendingBotMsg);
          if (idx !== -1) {
            u[idx] = {
              role: "assistant",
              content: `Here's your generated image of **"${imgPrompt}"**:\n\n![${imgPrompt}](${imgUrl})\n\n*Powered by Agnes AI*`,
              timestamp: ts, isImageGen: true,
            };
          }
          return u;
        });
      } catch (err) {
        setMessages(prev => {
          const u = [...prev];
          const idx = u.lastIndexOf(pendingBotMsg);
          if (idx !== -1) {
            u[idx] = { role: "assistant", content: `Image generation failed: ${err.message}`, timestamp: ts };
          }
          return u;
        });
      }
      return;
    }

    // Video generation intercept
    const vidPrompt = detectVideoPrompt(text);
    if (vidPrompt && !selFile) {
      const ts      = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const userMsg = { role: "user", content: text, timestamp: ts };
      const pendingBotMsg = {
        role: "assistant", content: "🎬 Generating your video... This may take a few minutes.", timestamp: ts, isVideoGen: true, isPending: true,
      };
      setMessages(prev => [...prev, userMsg, pendingBotMsg]);
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      if (messages.length === 0) updateSessionTitle(text);

      try {
        const videoTaskId = await generateVideoViaAgnes(vidPrompt);
        setMessages(prev => {
          const u = [...prev];
          const idx = u.lastIndexOf(pendingBotMsg);
          if (idx !== -1) u[idx] = { ...u[idx], content: "🎬 Video queued — generating... (0%)" };
          return u;
        });
        const videoUrl = await pollVideoStatus(videoTaskId, (progress) => {
          setMessages(prev => {
            const u = [...prev];
            const lastPending = u.findLastIndex(m => m.isVideoGen && m.isPending);
            if (lastPending !== -1) u[lastPending] = { ...u[lastPending], content: `🎬 Generating video... (${progress}%)` };
            return u;
          });
        });
        setMessages(prev => {
          const u = [...prev];
          const lastPending = u.findLastIndex(m => m.isVideoGen && m.isPending);
          if (lastPending !== -1) {
            u[lastPending] = {
              role: "assistant",
              content: `Here's your generated video of **"${vidPrompt}"**:\n\n<video controls width="100%" src="${videoUrl}"></video>\n\n[Download Video](${videoUrl})\n\n*Powered by Agnes AI*`,
              timestamp: ts, isVideoGen: true,
            };
          }
          return u;
        });
      } catch (err) {
        setMessages(prev => {
          const u = [...prev];
          const lastPending = u.findLastIndex(m => m.isVideoGen && m.isPending);
          if (lastPending !== -1) {
            u[lastPending] = { role: "assistant", content: `Video generation failed: ${err.message}`, timestamp: ts };
          }
          return u;
        });
      }
      return;
    }

    // YouTube URL intercept
    const videoId  = extractVideoId(text);
    const isYtMode = selectedMode === "youtube";
    if (videoId) {
      const ts      = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const userMsg = { role: "user", content: text, timestamp: ts, ytVideoId: videoId };
      const hist      = [...messages, userMsg];
      const info    = await fetchYouTubeInfo(videoId);
      setYtVideoData(prev => ({ ...prev, [videoId]: info }));
      setMessages(hist);
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      const wantsNotes = isYtMode || /\b(notes|summarize|summary|analyze|explain|key points|study)\b/i.test(text);
      setIsYtFetching(true);
      let transcript = transcriptCacheRef.current.get(videoId);
      if (!transcript) {
        transcript = await fetchYouTubeTranscript(videoId);
        if (transcript) transcriptCacheRef.current.set(videoId, transcript);
      }
      setIsYtFetching(false);
      const ytContext = { videoId, title: info?.title || "YouTube Video", author: info?.author || "", transcript: transcript ? transcript.slice(0, 8000) : null, wantsNotes };
      if (hist.length === 1) updateSessionTitle(text);
      triggerAI(hist, null, ytContext);
      return;
    }

    const ts   = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    // Diagnostic Command: /test-visual
    if (text === "/test-visual") {
      const testContent = `# Diagnostic Analysis: Infrastructure & Logistics\n\nThis is a premium diagnostic summary of the VetroAI visualization engine.\n\n> [!IMPORTANT]\n> The execution pipeline is active. All components below are rendered dynamically from structured JSON blocks.\n\n## Market Performance Comparison\n\n\`\`\`json\n{\n  "type": "chart",\n  "chartType": "bar",\n  "library": "recharts",\n  "title": "Cloud Infrastructure Revenue (Q4 2023)",\n  "data": [\n    {"label": "AWS", "value": 24.2},\n    {"label": "Azure", "value": 18.5},\n    {"label": "Google Cloud", "value": 9.1}\n  ]\n}\n\`\`\`\n\n## Global Logistics Route\n\n\`\`\`json\n{\n  "type": "route",\n  "origin": "Chennai, Tamil Nadu",\n  "destination": "Bangalore, Karnataka",\n  "summary": "Critical industrial corridor connecting the automobile hub to the tech capital.",\n  "waypoints": ["Vellore", "Hosur"],\n  "details": [\n    {"label": "Distance", "value": "346 km"},\n    {"label": "Est. Time", "value": "6h 15m"}\n  ]\n}\n\`\`\`\n\n## Key Metrics\n\n## Performance Analytics\n\n- **Uptime**: 99.99%\n- **Latency**: 45ms\n- **Throughput**: 1.2GB/s\n\n## Implementation Roadmap\n\n1. **Design System**\nInitial UI/UX tokens and architecture.\n2. **Component Build**\nDeveloping modular structured blocks.\n3. **Orchestration**\nConnecting the AI intent to the rendering layer.\n`;
      setMessages(prev => [...prev,
        { role: "user", content: text, timestamp: ts },
        { role: "assistant", content: testContent, timestamp: ts }
      ]);
      setInput("");
      return;
    }

    const hist = [...messages, { role: "user", content: text, file: selFile ? { preview: filePreview, name: selFile?.name } : null, timestamp: ts }];
    setMessages(hist); setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    // Web search is handled by the backend (Tavily) — no frontend search needed

    triggerAI(hist, selFile);
  };

  const handleKeyDown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!isLoading) sendMessage(); } };

  const submitEdit = idx => {
    if (!editInput.trim()) return; stopSpeak();
    const ts   = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const hist = [...messages.slice(0, idx), { role: "user", content: editInput, timestamp: ts }];
    setMessages(hist); setEditIdx(null); triggerAI(hist);
  };

  // ── AI message copy / share ──────────────────────────────────────────────────
  const copyAiMsg   = (i, content) => {
    navigator.clipboard.writeText(content);
    setCopiedAiIdx(i);
    setTimeout(() => setCopiedAiIdx(null), 2000);
  };
  const shareAiMsg  = (content) => {
    if (navigator.share) {
      navigator.share({ title: 'VetroAi', text: content }).catch(() => {});
    } else {
      navigator.clipboard.writeText(content);
      addToast("Copied to clipboard", "info", 2000);
    }
  };
  const copyUserMsg = (i, content) => {
    navigator.clipboard.writeText(content);
    setCopiedUserIdx(i);
    setTimeout(() => setCopiedUserIdx(null), 2000);
  };

  const handleRegen = idx => {
    if (idx === 0) return;
    const hist = messages.slice(0, idx);
    setMessages(hist); triggerAI(hist);
    addToast("🔄 Regenerating response…", "info", 2000);
  };

  const handleFeedback = (idx, type) => {
    setMsgFeedback(prev => ({ ...prev, [idx]: type }));
    addToast(type === "up" ? "👍 Thanks for the feedback!" : "👎 Thanks! We'll improve.", "success", 2000);
  };

  // Manual "continue" — kept as fallback for edge cases
  const requestContinuation = (idx) => {
    const upto = messages.slice(0, idx + 1);
    const prompt = "Your previous answer was cut off. Continue exactly from where you stopped. Return only the remaining part with no repetition, and ensure all SQL/code blocks are complete.";
    const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const hist = [...upto, { role: "user", content: prompt, timestamp: ts }];
    setMessages(hist);
    triggerAI(hist);
  };

  const addRxn    = (i, r) => setReactions(p => ({ ...p, [i]: [...(p[i] || []).filter(x => x !== r), r] }));
  const removeRxn = (i, r) => setReactions(p => ({ ...p, [i]: (p[i] || []).filter(x => x !== r) }));

  const [profileData, setProfileData] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("vetroai_profile") || 'null');
      if (stored && typeof stored === 'object') return stored;
      return { name: "", avatar: "🧑" };
    }
    catch { return { name: "", avatar: "🧑" }; }
  });
  const charCount   = input.length;
  const tokenEst    = Math.ceil(charCount / 4);
  const isEmpty     = !input.trim() && !selFile;
  const avatarEl    = <span>{profileData?.avatar || "🧑"}</span>;

  // ── AUTH PAGE ──────────────────────────────────────────────────────────────────


  const getDynamicGreeting = () => {
    const hrs = new Date().getHours();
    if (hrs >= 21 || hrs < 5) return "Hello, night owl";
    if (hrs >= 5 && hrs < 12) return "Good morning";
    if (hrs >= 12 && hrs < 17) return "Good afternoon";
    return "Good evening";
  };

    const toggleDictation = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      addToast("Speech recognition is not supported in this browser.", "error");
      return;
    }

    if (isDictating) {
      setIsDictating(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => setIsDictating(true);
    recognition.onend = () => setIsDictating(false);
    recognition.onerror = (e) => {
      console.error(e);
      setIsDictating(false);
    };
    recognition.onresult = (e) => {
      let finalTranscript = "";
      for (let i = e.resultIndex; i < e.results.length; ++i) {
        if (e.results[i].isFinal) {
          finalTranscript += e.results[i][0].transcript;
        }
      }
      if (finalTranscript) {
        setInput(prev => prev + (prev ? " " : "") + finalTranscript);
      }
    };
    try {
      recognition.start();
    } catch (e) {
      console.error(e);
      setIsDictating(false);
    }
  };

  const renderInputBox = () => {
    return (
      <>
        {lockModelPerChat && messages.length > 0 && (
          <div className="claude-banner">
            <span>This chat is locked to <strong>{currentMode.name}</strong>.</span>
            <button type="button" className="claude-banner-link" onClick={() => setMessages([])}>Start a new chat</button>
          </div>
        )}
        <form className="claude-input-box bg-slate-800 md:bg-[rgba(255,255,255,0.03)] border border-slate-700 md:border-[var(--border-str)]" onSubmit={sendMessage}>
        <input type="file" ref={fileInputRef} style={{ display: "none" }} onChange={handleFileChange} accept=".txt,.md,.csv,.json,.pdf,.png,.jpg,.jpeg,.gif,.webp" />
        {filePreview && (
          <div className="file-prev">
            <img src={filePreview} alt="" />
            <button type="button" onClick={() => { setSelFile(null); setFilePreview(null); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
        )}
        {selFile && !filePreview && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg-hover)", border: "1px solid var(--border-med)", borderRadius: 10, padding: "6px 12px", width: "fit-content", marginBottom: 10, fontSize: "0.8rem", color: "var(--ink-2)" }}>
            📄 {selFile.name}
            <button type="button" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-4)" }} onClick={() => setSelFile(null)}>✕</button>
          </div>
        )}

        <textarea
          ref={textareaRef}
          className="placeholder-slate-400 md:placeholder-[var(--ink-4)] text-slate-200 md:text-[var(--ink)]"
          rows="1"
          placeholder={
            isDictating ? t.listening || "Listening..." :
            isYtMode     ? "Paste a YouTube URL here (e.g. https://youtube.com/watch?v=...)…" :
            isDeepSearch ? "DeepSearch: ask a research question (I will query multiple angles)..." :
            isWebMode    ? "Search the web with AI — I fetch real page content…" :
                           "How can I help you today?"
          }
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px';
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage(e);
            }
          }}
          disabled={isLoading}
        />

        <div className="claude-input-footer">
          <div className="claude-footer-left">
            <button type="button" className="claude-attach-btn" onClick={() => fileInputRef.current?.click()} title="Upload file">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </div>

          <div className="claude-footer-right">
            {/* Model selector */}
            <div className="block" style={{ position: "relative" }}>
              {showModelPicker && <WorkspacePopup
                currentMode={selectedMode}
                currentProvider={selectedProvider}
                onSelectMode={(next) => {
                  if (lockModelPerChat && messages.length > 0) {
                    addToast("Model is locked for this chat. Start a new chat to switch.", "info", 2200);
                    return;
                  }
                  setSelectedMode(next);
                }}
                onSelectProvider={setSelectedProvider}
                onClose={() => setShowModelPicker(false)}
              />}
              <button type="button" className="mode-pill mode-pill-btn" onClick={() => setShowModelPicker(p => !p)} title="Model selector">
                <span>{currentMode.name}</span>
                <svg style={{ transform: showModelPicker ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </button>
            </div>

            {/* Mic Icon - Dictation placeholder */}
            <button type="button" className={`claude-action-btn ${isDictating ? "active" : ""}`} onClick={toggleDictation} title="Dictate">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={isDictating ? "var(--accent)" : "currentColor"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
            </button>

            {/* Voice Mode / Audio Activity Icon */}
            {isVoiceOpen ? (
              <button type="button" className="claude-action-btn active voice" onClick={closeVoice} title="Close voice mode">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            ) : (
              <button type="button" className="claude-action-btn voice" onClick={() => setIsVoiceOpen(true)} title="Start Voice Mode">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14v-4m4 6V8m4 8V6m4 8V8m4 6v-4" /></svg>
              </button>
            )}

            {/* Send / Stop Button */}
            {isLoading ? (
              <button type="button" className="claude-send-btn active bg-amber-500 md:bg-[var(--ink)] text-slate-900 md:text-[var(--bg)]" onClick={stopGeneration} title="Stop generating">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="6" width="12" height="12"></rect></svg>
              </button>
            ) : (
              <button
                type="submit"
                className={`claude-send-btn ${(!input.trim() && !selFile) ? "claude-send-btn-empty bg-slate-700 md:bg-transparent text-slate-500 md:text-[var(--ink-4)]" : "active bg-amber-500 md:bg-[var(--ink)] text-slate-900 md:text-[var(--bg)]"}`}
                disabled={!input.trim() && !selFile}
                title="Send message"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>
              </button>
            )}
          </div>
        </div>
      </form>
      </>
    );
  };

  // ── Perplexity-style layout helpers ──────────────────────────────────────────

  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [isAgenticMode, setIsAgenticMode] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);
  const [activeNav, setActiveNav] = useState('chats');
  const [recentsSortOpen, setRecentsSortOpen] = useState(false);
  const [recentsSortMode, setRecentsSortMode] = useState('recent');
  const [openRecentMenuId, setOpenRecentMenuId] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const messagesEndRef = useRef(null);

  const displaySessions = React.useMemo(() => {
    const mock = [
      { id: 'm1', title: 'explain all the features of th...' },
      { id: 'm2', title: 'how to reverse a linked list' },
      { id: 'm3', title: 'what is the capital of france' },
    ];
    if (sessions && sessions.length > 0) {
      const sorted = [...sessions].sort((a, b) => {
        const ta = parseInt(a.id, 10) || 0, tb = parseInt(b.id, 10) || 0;
        return recentsSortMode === 'oldest' ? ta - tb : tb - ta;
      });
      return sorted.map(s => ({ id: s.id, title: s.title || 'Untitled' })).slice(0, 10);
    }
    return mock;
  }, [sessions, recentsSortMode]);

  const goToChatsHome = () => {
    setShowBookmarks(false); setShowPlayground(false); setShowSysPrompt(false);
    setActiveNav('chats');
    newChat();
  };

  useEffect(() => {
    const handler = (e) => {
      if (e.target.closest('.claude-popover, [data-popover-trigger]')) return;
      setRecentsSortOpen(false);
      setOpenRecentMenuId(null);
      setShowAccountMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const renderHomeSearchBox = () => (
    <div className="w-full max-w-[800px] mx-auto px-4">
      <div className="bg-white border border-solid border-gray-200/80 rounded-[24px] flex flex-col transition-all duration-300"
           style={{
             backgroundColor: "#ffffff",
             border: "1px solid #e5e7eb",
             borderRadius: "24px",
             padding: "20px 20px 14px 20px",
             boxShadow: "0 10px 40px rgba(20, 184, 166, 0.04), 0 2px 12px rgba(0, 0, 0, 0.01)"
           }}>
        {selFile && (
          <div className="flex items-center gap-2 mb-2">
            <div className="bg-purple-50 text-purple-700 text-xs px-3 py-1.5 rounded-full flex items-center gap-2 font-medium border border-purple-100">
              <span className="truncate max-w-[150px]">{selFile.name}</span>
              <button type="button" className="hover:text-purple-900 font-bold" onClick={() => { setSelFile(null); setFilePreview(null); }}>×</button>
            </div>
          </div>
        )}
        <textarea
          ref={textareaRef}
          rows="1"
          placeholder="Ask anything..."
          value={input}
          onChange={(e) => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'; }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(e); } }}
          className="w-full bg-transparent border-none outline-none resize-none text-[16px] md:text-lg text-gray-800 placeholder-gray-400 py-1"
          style={{ minHeight: '40px' }}
        />
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button type="button" onClick={() => fileInputRef.current?.click()} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors flex-shrink-0" title="Attach file">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            </button>
            <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*,.pdf,.txt,.md,.csv,.json,.xml,.html,.js,.jsx,.ts,.tsx,.py,.java,.cpp,.c,.rb,.go,.rs,.php,.sql,.yaml,.yml" />
            <button type="button" className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-solid border-gray-200 bg-gray-50 hover:bg-gray-100 text-xs font-semibold text-gray-600 transition-colors flex-shrink-0">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              Search <span className="text-gray-400 text-[9px]">&#9660;</span>
            </button>
            <button type="button" onClick={() => setIsAgenticMode(v => !v)} className={"flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-solid text-xs font-semibold transition-all flex-shrink-0 " + (isAgenticMode ? "bg-purple-50 border-purple-200 text-purple-700 shadow-sm" : "bg-gray-50 border-gray-200 hover:bg-gray-100 text-gray-600")}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="12" rx="2" ry="2"/><line x1="8" y1="20" x2="16" y2="20"/><line x1="12" y1="16" x2="12" y2="20"/></svg>
              Computer
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-solid border-gray-200 bg-gray-50 hover:bg-gray-100 text-xs font-semibold text-gray-600 transition-colors flex-shrink-0">
              Model <span className="text-gray-400 text-[9px]">&#9660;</span>
            </button>
            <button type="button" onClick={toggleDictation} className={"p-2 rounded-full transition-colors flex-shrink-0 " + (isDictating ? "bg-red-100 text-red-500 animate-pulse" : "text-gray-400 hover:text-gray-600 hover:bg-gray-100")}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>
            </button>
            <button type="submit" onClick={(e) => { e.preventDefault(); sendMessage(e); }} disabled={!input.trim() && !selFile} className="w-9 h-9 bg-[#1a1a1a] hover:bg-black text-white rounded-full disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center justify-center flex-shrink-0 shadow-sm">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <rect x="4" y="14" width="3" height="6" rx="1.5" fill="currentColor" opacity="0.6"/>
                <rect x="10.5" y="8" width="3" height="12" rx="1.5" fill="currentColor"/>
                <rect x="17" y="4" width="3" height="16" rx="1.5" fill="currentColor" opacity="0.8"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (!user) return (
    <div className="auth-page-v3">
      {/* Hero side */}
      <div className="auth-hero-side">
        <div className="auth-hero-orb orb1" />
        <div className="auth-hero-orb orb2" />
        <div className="auth-hero-orb orb3" />
        <div className="auth-hero-content">
          <div className="auth-hero-logo">
            <VetroLogo width={160} />
            <div className="logo-ver" style={{ marginTop: 6 }}>v2.3 · Powered by Mistral</div>
          </div>
          <h1 className="auth-hero-headline">Your AI study<br />companion.</h1>
          <p className="auth-hero-sub">Smart answers, live web search, YouTube notes, image generation, code playground and more — all in one place.</p>
          <div className="auth-hero-features">
            {[[<Zap size={16} />,"Instant answers"],[<Globe size={16} />,"Live web search"],[<Play size={16} />,"YouTube notes"],[<Terminal size={16} />,"Code Playground"],[<Paintbrush size={16} />,"AI image gen"],[<Brain size={16} />,"Memory across chats"]].map(([ic,lb]) => (
              <div key={lb} className="auth-hero-feat"><span>{ic}</span>{lb}</div>
            ))}
          </div>
        </div>
      </div>

      {/* Form side */}
      <div className="auth-form-side">
        <div className="auth-form-card">
          <div className="auth-form-header">
            <h2 className="auth-form-title">{authMode === "login" ? "Welcome back 👋" : "Join VetroAI 🚀"}</h2>
            <p className="auth-form-sub">{authMode === "login" ? "Sign in to continue your conversations." : "Create a free account in seconds."}</p>
          </div>

          {/* Google Sign In */}
          {GOOGLE_CLIENT_ID ? (
            <>
              <GoogleLoginButton clientId={GOOGLE_CLIENT_ID} onLogin={handleGoogleLogin} theme={theme} />
              <div className="auth-divider-row"><span /><em>or</em><span /></div>
            </>
          ) : null}

          <form onSubmit={handleAuthSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {authMode === "signup" && (
              <input className="auth-input" type="text" placeholder="Full name" value={authName} onChange={e => setAuthName(e.target.value)} required autoFocus />
            )}
            <input className="auth-input" type="email" placeholder="Email address" value={authEmail} onChange={e => setAuthEmail(e.target.value)} required autoFocus={authMode === "login"} />
            <div style={{ position: "relative" }}>
              <input className="auth-input" type={showPass ? "text" : "password"} placeholder={authMode === "signup" ? "Password (8+ chars)" : "Password"} value={authPassword} onChange={e => setAuthPassword(e.target.value)} required minLength={authMode === "signup" ? 8 : 1} style={{ paddingRight: 44 }} />
              <button type="button" onClick={() => setShowPass(v => !v)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--ink-4)", fontSize: "0.75rem" }}>{showPass ? "Hide" : "Show"}</button>
            </div>
            {authError && (
              <div style={{ fontSize: "0.82rem", color: authError.includes("created") ? "#10b981" : "#e76f51", textAlign: "center", padding: "8px 12px", background: authError.includes("created") ? "rgba(16,185,129,0.08)" : "rgba(231,111,81,0.08)", borderRadius: 10, border: `1px solid ${authError.includes("created") ? "rgba(16,185,129,0.2)" : "rgba(231,111,81,0.2)"}` }}>{authError}</div>
            )}
            <button className="auth-submit-btn" type="submit" disabled={authLoading}>
              {authLoading ? <><div className="auth-spin" />Please wait…</> : authMode === "login" ? "Sign in →" : "Create account →"}
            </button>
          </form>

          <p className="auth-switch-text">
            {authMode === "login" ? "Don't have an account? " : "Already have an account? "}
            <button onClick={() => { setAuthMode(authMode === "login" ? "signup" : "login"); setAuthError(""); }} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontWeight: 600, fontSize: "inherit" }}>
              {authMode === "login" ? "Sign up free" : "Sign in"}
            </button>
          </p>
          <p style={{ fontSize: "0.68rem", color: "var(--ink-5)", textAlign: "center", marginTop: 4 }}>By continuing you agree to use VetroAI responsibly.</p>
        </div>
      </div>
    </div>
  );

  // ── MAIN UI ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen w-screen overflow-hidden font-sans" style={{ background: 'var(--bg)', color: 'var(--ink)' }}>
      <Toast toasts={toasts} />
      {showGlobalSearch && <GlobalSearch onClose={() => setShowGlobalSearch(false)} />}
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} currentPlan={userInfo?.plan || "free"} />}
{showProfile && <ProfileModal onClose={() => setShowProfile(false)} t={t} langCode={langCode} setLangCode={setLangCode} theme={theme} setTheme={setTheme} userInfo={userInfo} onProfileSaved={setProfileData} />}
      {showBookmarks && <BookmarksPanel bookmarks={bookmarks} onSelect={() => setShowBookmarks(false)} onRemove={(id) => setBookmarks(prev => prev.filter(b => b.id !== id))} onClose={() => setShowBookmarks(false)} t={t} />}
      {showPlayground && <CodePlayground onClose={() => setShowPlayground(false)} />}
      {showSysPrompt && <SysPromptModal onClose={() => setShowSysPrompt(false)} t={t} value={systemPrompt} setValue={setSystemPrompt} />}
      {confirmDelete && <ConfirmDialog message={confirmDelete.message} onConfirm={confirmDeleteSession} onCancel={() => setConfirmDelete(null)} />}
      {showSpaces && (
        <SpacesPanel
          spaces={spaces}
          currentSpaceId={currentSpaceId}
          onOpenSpace={(id) => { handleSwitchSpace(id); setShowSpaces(false); }}
          onNewSpace={() => { setEditingSpace(null); setShowSpaceModal(true); }}
          onEditSpace={(sp) => { setEditingSpace(sp); setShowSpaceModal(true); }}
          onDeleteSpace={deleteSpaceById}
          onClose={() => setShowSpaces(false)}
        />
      )}
      {showSpaceModal && (
        <SpaceModal
          space={editingSpace}
          onSave={saveSpace}
          onDelete={deleteSpaceById}
          onClose={() => { setShowSpaceModal(false); setEditingSpace(null); }}
        />
      )}
      {showArtifactsGallery && (
        <ArtifactsGallery
          artifacts={artifacts}
          onOpen={(a) => { setActiveArtifact(a); setShowArtifactsGallery(false); }}
          onClose={() => setShowArtifactsGallery(false)}
        />
      )}
      {activeArtifact && <ArtifactsPanel artifact={activeArtifact} onClose={() => setActiveArtifact(null)} />}
      {showDesign && <DesignCanvas onClose={() => setShowDesign(false)} />}

      {/* LEFT SIDEBAR */}
      {sidebarMobileOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setSidebarMobileOpen(false)} />
      )}
      <nav className={`claude-sidebar flex-shrink-0 h-full z-50 transition-all duration-200 overflow-hidden fixed md:relative inset-y-0 left-0 ${sidebarMobileOpen ? "flex w-[240px]" : "hidden"} md:flex ${sidebarCollapsed ? "md:w-0" : "md:w-[240px]"}`} style={{ backgroundColor: "var(--bg-sidebar)", borderRight: "1px solid rgba(28,25,23,0.04)" }}>
      <div className="flex flex-col h-full" style={{ width: 240, minWidth: 240, padding: "0 8px" }} onClick={(e) => { if (e.target.closest('button') && !e.target.closest('[data-popover-trigger]') && !e.target.closest('.claude-popover')) setSidebarMobileOpen(false); }}>
        {/* Logo + icons row */}
        <div className="px-2 pt-3 pb-2 flex items-center justify-between gap-2">
          <div className="flex items-center cursor-pointer min-w-0 vetro-brand-link" onClick={goToChatsHome}>
            <VetroLogo width={130} />
          </div>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button onClick={() => setShowGlobalSearch(true)} title="Search chats" className="claude-sb-icon-btn flex items-center justify-center rounded-md" style={{ width: 30, height: 30, color: 'var(--ink-3)' }}>
              <Search size={15} />
            </button>
            <button onClick={() => { setSidebarCollapsed(true); setSidebarMobileOpen(false); }} title="Close sidebar" className="claude-sb-icon-btn flex items-center justify-center rounded-md" style={{ width: 30, height: 30, color: 'var(--ink-3)' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
            </button>
          </div>
        </div>

        {/* New chat */}
        <div className="px-1 pb-1">
          <button onClick={goToChatsHome} className="claude-sb-item flex items-center gap-3 w-full px-3 py-2 text-[13.5px] font-semibold rounded-lg transition-colors">
            <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 24, height: 24, background: "var(--bg-active)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </span>
            New chat
          </button>
        </div>

        {/* Main nav */}
        <div className="px-1 flex flex-col gap-0.5">
          <button onClick={() => { setActiveNav('chats'); setShowBookmarks(false); setShowPlayground(false); setShowSysPrompt(false); setShowSpaces(false); setShowArtifactsGallery(false); setShowDesign(false); }} className={`claude-sb-item flex items-center gap-3 w-full px-3 py-2 text-[13.5px] rounded-lg transition-colors ${activeNav === 'chats' && !currentSessionId ? 'active' : ''}`}>
            <MessageSquare size={17} /> Chats
          </button>
          <button onClick={() => { setActiveNav('projects'); setShowSpaces(true); }} className={`claude-sb-item flex items-center gap-3 w-full px-3 py-2 text-[13.5px] rounded-lg transition-colors ${activeNav === 'projects' ? 'active' : ''}`}>
            <FolderClosed size={17} /> Projects
          </button>
          <button onClick={() => { setActiveNav('artifacts'); setShowArtifactsGallery(true); }} className={`claude-sb-item flex items-center gap-3 w-full px-3 py-2 text-[13.5px] rounded-lg transition-colors ${activeNav === 'artifacts' ? 'active' : ''}`}>
            <LayoutGrid size={17} /> Artifacts
          </button>
          <button onClick={() => { setActiveNav('customize'); setShowSysPrompt(true); }} className={`claude-sb-item flex items-center gap-3 w-full px-3 py-2 text-[13.5px] rounded-lg transition-colors ${activeNav === 'customize' ? 'active' : ''}`}>
            <SlidersHorizontal size={17} /> Customize
          </button>
        </div>

        {/* Products section */}
        <div className="px-1 flex flex-col gap-0.5" style={{ marginTop: 12 }}>
          <p className="claude-sb-group-label text-[11.5px] font-medium px-3 py-1" style={{ color: 'var(--ink-4)' }}>Products</p>
          <button onClick={() => { setActiveNav('code'); setShowPlayground(true); }} className={`claude-sb-item flex items-center gap-3 w-full px-3 py-2 text-[13.5px] rounded-lg transition-colors ${activeNav === 'code' ? 'active' : ''}`}>
            <Code size={17} /> Code
          </button>
          <button onClick={() => { setActiveNav('design'); setShowDesign(true); }} className={`claude-sb-item flex items-center justify-between gap-3 w-full px-3 py-2 text-[13.5px] rounded-lg transition-colors ${activeNav === 'design' ? 'active' : ''}`}>
            <span className="flex items-center gap-3"><Palette size={17} /> Design</span>
            <FlaskConical size={13} style={{ color: "var(--ink-4)" }} />
          </button>
        </div>

        {/* Recents section */}
        <div className="claude-sb-recents-scroll flex-1 overflow-y-auto px-1 flex flex-col" style={{ marginTop: 12, gap: 2 }}>
          {displaySessions.length > 0 && (
            <div className="flex items-center justify-between px-3 py-1 mb-0.5 relative">
              <p className="claude-sb-group-label text-[11.5px] font-medium" style={{ color: 'var(--ink-4)' }}>Recents</p>
              <button onClick={() => setRecentsSortOpen(o => !o)} title="Sort recents" data-popover-trigger className="claude-sb-icon-btn flex items-center justify-center rounded-md" style={{ width: 22, height: 22, color: "var(--ink-4)" }}>
                <SlidersHorizontal size={14} />
              </button>
              {recentsSortOpen && (
                <div className="claude-popover" style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 30 }}>
                  <button onClick={() => { setRecentsSortMode('recent'); setRecentsSortOpen(false); }} className={`claude-popover-item ${recentsSortMode === 'recent' ? 'active' : ''}`}>Most recent</button>
                  <button onClick={() => { setRecentsSortMode('oldest'); setRecentsSortOpen(false); }} className={`claude-popover-item ${recentsSortMode === 'oldest' ? 'active' : ''}`}>Oldest</button>
                </div>
              )}
            </div>
          )}
          {displaySessions.map((session) => {
            const isMock = String(session.id).startsWith('m');
            const isActive = activeNav === 'chats' && currentSessionId === session.id;
            const isRenaming = renamingId === session.id;
            return (
              <div key={session.id} className="claude-sb-recent-row group relative">
                {isRenaming ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { renameSession(session.id, renameValue.trim() || session.title); setRenamingId(null); }
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    onBlur={() => setRenamingId(null)}
                    className="claude-sb-recent-input text-left px-3 py-2 text-[13px] rounded-md w-full"
                  />
                ) : (
                  <button onClick={() => { loadSession(session.id); setActiveNav('chats'); }} className={`claude-sb-recent text-left px-3 py-[9px] text-[13px] rounded-md truncate transition-colors w-full ${!isMock ? "pr-8" : ""} ${isActive ? 'active' : ''}`}>
                    {session.title}
                  </button>
                )}
                {!isMock && !isRenaming && (
                  <button onClick={(e) => { e.stopPropagation(); setOpenRecentMenuId(openRecentMenuId === session.id ? null : session.id); }} title="More" data-popover-trigger className="claude-sb-recent-more opacity-0 group-hover:opacity-100 flex items-center justify-center rounded-md">
                    <MoreHorizontal size={14} />
                  </button>
                )}
                {openRecentMenuId === session.id && (
                  <div className="claude-popover" style={{ position: "absolute", top: "calc(100% + 2px)", right: 4, zIndex: 30 }}>
                    <button onClick={() => { setRenamingId(session.id); setRenameValue(session.title); setOpenRecentMenuId(null); }} className="claude-popover-item">
                      <Pencil size={13} /> Rename
                    </button>
                    <button onClick={() => { deleteSession(session.id); setOpenRecentMenuId(null); }} className="claude-popover-item danger">
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="claude-sb-footer p-3 flex flex-col gap-0.5 relative">
          {userInfo?.plan !== "pro" && (
            <button onClick={() => setShowUpgrade(true)} className="claude-sb-item flex items-center gap-3 w-full px-3 py-2 text-sm font-semibold rounded-lg transition-colors">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z"/></svg> Upgrade plan
            </button>
          )}
          <div onClick={() => setShowAccountMenu(o => !o)} data-popover-trigger className="claude-sb-item flex items-center gap-2 w-full px-3 py-2 text-sm font-semibold rounded-lg transition-colors mt-1 cursor-pointer">
            <div className="w-9 h-9 flex items-center justify-center text-xs flex-shrink-0" style={{ background: "var(--ink)", color: "var(--bg)", borderRadius: 8 }}>{(userInfo?.name || "U")[0].toUpperCase()}</div>
            <span className="flex flex-col items-start flex-1 min-w-0 leading-tight">
              <span className="truncate w-full text-left">{userInfo?.name || "User"}</span>
              <span className="truncate w-full text-left text-[11px] font-normal" style={{ color: "var(--ink-4)" }}>
                {userInfo?.plan === "team" ? "Team plan" : userInfo?.plan === "pro" ? "Pro plan" : "Free plan"}
                {typeof userInfo?.credits === "number" && (
                  <span className={`sb-credit-pill${userInfo.credits <= 5 ? " low" : ""}`}>{userInfo.credits} credits</span>
                )}
              </span>
            </span>
            <button onClick={(e) => { e.stopPropagation(); addToast("Coming soon", "info", 1500); }} title="Get the app" className="claude-footer-icon-btn" style={{ color: "var(--ink-4)" }}>
              <Download size={15} />
            </button>
            {showAccountMenu ? <ChevronUp size={16} style={{ color: "var(--ink-4)" }} className="flex-shrink-0" /> : <ChevronDown size={16} style={{ color: "var(--ink-4)" }} className="flex-shrink-0" />}
          </div>
          {showAccountMenu && (
            <div className="claude-popover" style={{ position: "absolute", bottom: "calc(100% - 4px)", left: 8, right: 8, zIndex: 30 }}>
              <button onClick={() => { setShowProfile(true); setShowAccountMenu(false); }} className="claude-popover-item"><Settings size={14} /> Settings</button>
              <button onClick={() => { addToast("Coming soon", "info", 1500); setShowAccountMenu(false); }} className="claude-popover-item"><HelpCircle size={14} /> Help</button>
              <button onClick={() => { logout(); setShowAccountMenu(false); }} className="claude-popover-item danger"><LogOut size={14} /> Log out</button>
            </div>
          )}
        </div>
      </div>
      </nav>

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col relative h-full w-full overflow-hidden" style={{ backgroundColor: "var(--bg)" }}>
        
        {/* Top Header */}
        <header className="chat-header">
          <div className="ch-left" style={{ position: "relative" }}>
            <button type="button" onClick={() => setSidebarMobileOpen(true)} title="Open menu" className="claude-sb-item claude-sb-icon-btn flex md:hidden items-center justify-center rounded-md" style={{ marginRight: 4, width: 30, height: 30 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
            {sidebarCollapsed && (
              <button type="button" onClick={() => setSidebarCollapsed(false)} title="Open sidebar" className="claude-sb-item claude-sb-icon-btn hidden md:flex items-center justify-center rounded-md" style={{ marginRight: 4 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
              </button>
            )}
            {currentSpaceId && (() => {
              const sp = spaces.find(s => s.id === currentSpaceId);
              if (!sp) return null;
              const Icon = (SPACE_ICONS.find(i => i.id === sp.icon) || SPACE_ICONS[0]).icon;
              return (
                <div className="active-space-pill" style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 20, background: `${sp.color || SPACE_COLORS[0]}1a`, color: sp.color || SPACE_COLORS[0], fontSize: 12.5, fontWeight: 600 }}>
                  <Icon size={13} />
                  <span>{sp.name}</span>
                  <button onClick={() => handleSwitchSpace(null)} title="Exit project" style={{ background: "none", border: "none", color: "inherit", display: "flex", alignItems: "center", cursor: "pointer", opacity: 0.7, padding: 0 }}>
                    <X size={12} />
                  </button>
                </div>
              );
            })()}
          </div>
          <div className="ch-right">
            <button type="button" className="claude-sb-item claude-sb-icon-btn flex items-center justify-center rounded-md" onClick={() => setShowNews(true)} title="News" style={{ color: "var(--ink-4)" }}>
              <Newspaper size={18} />
            </button>
            <button type="button" className="claude-sb-item claude-sb-icon-btn flex items-center justify-center rounded-md" onClick={() => { setMessages([]); setCurrentSessionId(null); setIsIncognito(true); addToast("Incognito mode — this chat won't be saved.", "info", 2500); }} title="Incognito chat" style={{ color: isIncognito ? '#A77BF5' : "var(--ink-4)" }}>
              <Ghost size={18} />
            </button>
            {messages.length > 0 && (
              <button type="button" className="share-btn" onClick={() => setShowShare(true)} title="Share chat">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                <span>Share</span>
              </button>
            )}
          </div>
        </header>
        {showShare && <ShareModal onClose={() => setShowShare(false)} t={t} messages={messages} />}
        {showNews && <NewsPanel onClose={() => setShowNews(false)} />}

        {/* Incognito banner */}
        {isIncognito && (
          <div style={{ background: 'linear-gradient(90deg, #2a1a4a, #1a1a3a)', borderBottom: '1px solid rgba(167,123,245,0.25)', padding: '6px 20px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <Ghost size={14} style={{ color: '#A77BF5' }} />
            <span style={{ fontSize: 12, color: '#C4A8F8', fontFamily: "'Inter', sans-serif" }}>Incognito — this conversation won't be saved to history</span>
            <button onClick={() => { setIsIncognito(false); addToast("Incognito off", "info", 1500); }} style={{ marginLeft: 'auto', fontSize: 11, color: '#8B6DBF', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 4 }}>Turn off</button>
          </div>
        )}

        {/* Content Area */}
        <div className={`flex-1 flex flex-col w-full relative ${messages.length === 0 ? 'items-center overflow-y-auto px-4' : 'overflow-hidden'}`}
          style={isIncognito && messages.length > 0 ? { background: 'linear-gradient(180deg, rgba(30,18,60,0.06) 0%, transparent 120px)' } : {}}>
             {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center w-full max-w-3xl mx-auto py-10" style={{ marginTop: "auto", marginBottom: "auto" }}>
                  <div className="mb-8 text-center animate-fade-in w-full mt-10 md:mt-16">
                    <h2 className="text-[40px] md:text-[44px] font-normal" style={{ fontFamily: "var(--font-serif)", color: "var(--ink)" }}>{getDynamicGreeting()}</h2>
                  </div>
                  <div className="w-full">
                    {renderInputBox()}
                  </div>
                  {suggestionOptions.length > 0 && (
                    <div className="claude-suggestion-pills-row">
                      <div className="claude-suggestion-pills" style={{ justifyContent: "center", padding: 0 }}>
                        {!(isYtMode || isDeepSearch || isWebMode) && suggestionOptions.length >= 5
                          ? claudeStylePills.map(({ label, icon: Icon, srcIdx }) => (
                              <button key={label} type="button" className="claude-pill" onClick={() => sendMessage(null, suggestionOptions[srcIdx])}>
                                <Icon size={16} />
                                <span>{label}</span>
                              </button>
                            ))
                          : suggestionOptions.slice(0, 5).map((s, idx) => {
                              const Icon = [GraduationCap, Paintbrush, Terminal, Coffee, Compass][idx % 5];
                              return (
                                <button key={idx} type="button" className="claude-pill" onClick={() => sendMessage(null, s)}>
                                  <Icon size={16} />
                                  <span className="truncate" style={{ maxWidth: 220 }}>{s}</span>
                                </button>
                              );
                            })}
                      </div>
                    </div>
                  )}
                </div>
             ) : (
               <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
                 <div className="claude-feed-scroll" style={{ flex: 1, overflowY: 'auto', paddingBottom: 130 }} ref={feedRef} onScroll={handleScroll}>
                   <div style={{ maxWidth: 720, margin: '0 auto', paddingTop: 32 }} className="px-4 sm:px-6">
                   {messages.map((m, i) => (
                     <div key={i} className={`flex w-full mb-6 ${m.role === 'user' ? 'justify-end' : 'justify-start gap-3'}`}>

                       {/* ── AI avatar ── */}
                       {m.role !== 'user' && (
                         <div className="flex-shrink-0 mt-1">
                           <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg, #4F7CFF 0%, #8B5CF6 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                             <VetroSparkWhite size={22} />
                           </div>
                         </div>
                       )}

                       {/* ── USER MESSAGE ── */}
                       {m.role === 'user' ? (
                         <div className="flex flex-col items-end gap-1 group/user">
                           {editIdx === i ? (
                             <div className="user-edit-wrap">
                               <textarea
                                 className="user-edit-textarea"
                                 value={editInput}
                                 onChange={e => setEditInput(e.target.value)}
                                 onKeyDown={e => {
                                   if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); submitEdit(i); }
                                   if (e.key === 'Escape') setEditIdx(null);
                                 }}
                                 autoFocus
                                 aria-label="Edit your message"
                               />
                               <div className="user-edit-actions">
                                 <button className="ai-edit-btn-cancel" onClick={() => setEditIdx(null)}>Cancel</button>
                                 <button className="ai-edit-btn-save" onClick={() => submitEdit(i)}>Save &amp; Send</button>
                               </div>
                             </div>
                           ) : (
                             <>
                               <div className="chat-user-bubble">{m.content}</div>
                               <div className="user-msg-acts">
                                 <button className="msg-action-btn" onClick={() => { setEditIdx(i); setEditInput(m.content); }} title="Edit message" aria-label="Edit message">
                                   <EditIcon /><span>Edit</span>
                                 </button>
                                 <button className="msg-action-btn" onClick={() => copyUserMsg(i, m.content)} title="Copy message" aria-label="Copy message">
                                   <CopyIcon /><span>{copiedUserIdx === i ? 'Copied!' : 'Copy'}</span>
                                 </button>
                               </div>
                             </>
                           )}
                         </div>

                       /* ── NORMAL AI MESSAGE ── */
                       ) : (
                         <div className="flex-1 min-w-0 msg-row">
                           {m.liveScores && m.liveScores.length > 0 && (
                             <LiveScoreWidget scores={m.liveScores} title="Live Scores" />
                           )}
                           <div className="claude-prose" style={{ color: "var(--ink)", fontFamily: "'Inter', system-ui, sans-serif", fontSize: '15px', lineHeight: '1.7' }}>
                             {m.isPending && m.isImageGen
                               ? <MediaGenCard type="image" text={m.content} />
                               : m.isPending && m.isVideoGen
                               ? <MediaGenCard type="video" text={m.content} />
                               : m.isMultiAi
                               ? (() => {
                                  const doneCount = m.models.filter(md => md.status === 'done').length;
                                  const totalCount = m.models.length;
                                  const allDone = doneCount === totalCount;
                                  const isSynthesizing = m.phase === 'synthesizing';
                                  const isComplete = m.phase === 'complete';
                                  return (
                                  <div className="mai-container">
                                    {/* Phase indicator */}
                                    <div className="mai-phase-bar">
                                      <div className="mai-phase-track">
                                        <div className="mai-phase-fill" style={{ width: isComplete ? '100%' : isSynthesizing ? '75%' : `${(doneCount / totalCount) * 60}%` }} />
                                      </div>
                                      <span className="mai-phase-label">
                                        {isComplete ? <><Check size={12} /> Complete — 5 AI models + Web consulted</>
                                          : isSynthesizing ? <><Brain size={12} className="animate-pulse" /> Synthesizing best answer from all sources…</>
                                          : <><Zap size={12} /> Querying 5 AI + Web… ({doneCount}/{totalCount})</>}
                                      </span>
                                    </div>

                                    {/* Model status chips — compact row */}
                                    <div className="mai-model-row">
                                      {m.models.map((mod, midx) => (
                                        <div key={midx} className={`mai-chip ${mod.status}`} style={{ '--mc': mod.color }}>
                                          <span className="mai-chip-dot" />
                                          <span className="mai-chip-name">{mod.name}</span>
                                          {mod.status === 'done' && mod.elapsed && <span className="mai-chip-time">{mod.elapsed}s</span>}
                                          {mod.status === 'streaming' && <span className="mai-chip-time">…</span>}
                                          {mod.status === 'error' && <span className="mai-chip-time">failed</span>}
                                        </div>
                                      ))}
                                    </div>

                                    {/* Best Answer — the hero section */}
                                    {m.consensus && (
                                      <div className="mai-best-answer">
                                        <div className="mai-best-glow" />
                                        <div className="mai-best-header">
                                          <div className="mai-best-badge">
                                            <div className="mai-best-icon"><VetroSparkWhite size={16} /></div>
                                            <span>Best Answer</span>
                                            <span className="mai-best-tag">5 AI + Web</span>
                                          </div>
                                        </div>
                                        <div className="mai-best-body claude-prose">
                                          {m.consensus === 'generating'
                                            ? <div className="mai-synth-loading">
                                                <div className="mai-synth-dots"><span /><span /><span /></div>
                                                <span>Analyzing all 5 AI + Web responses to build the definitive answer…</span>
                                              </div>
                                            : (() => {
                                                const cText = m.consensus;
                                                return hasStructuredContent(cText)
                                                  ? <StructuredResponseRenderer response={cText} />
                                                  : <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, KATEX_OPTIONS]]}>{cText}</ReactMarkdown>;
                                              })()
                                          }
                                        </div>
                                      </div>
                                    )}

                                    {/* Expandable individual model responses */}
                                    {allDone && m.models.some(md => md.content) && (
                                      <details className="mai-sources">
                                        <summary className="mai-sources-toggle">
                                          <ChevronRight size={14} className="mai-sources-chevron" />
                                          View individual model responses
                                          <span className="mai-sources-count">{m.models.filter(md => md.content).length}</span>
                                        </summary>
                                        <div className="mai-sources-grid">
                                          {m.models.filter(md => md.content).map((mod, midx) => {
                                            const contentToRender = mod.content;
                                            const hasStruct = hasStructuredContent(contentToRender);
                                            return (
                                              <div key={midx} className="mai-source-card" style={{ '--mc': mod.color }}>
                                                <div className="mai-source-header">
                                                  <div className="mai-source-provider">
                                                    <span className="mai-source-dot" />
                                                    <span>{mod.name}</span>
                                                  </div>
                                                  {mod.elapsed && <span className="mai-source-time">{mod.elapsed}s</span>}
                                                </div>
                                                <div className="mai-source-body claude-prose">
                                                  {hasStruct
                                                    ? <StructuredResponseRenderer response={contentToRender} />
                                                    : <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, KATEX_OPTIONS]]} components={{
                                                        code({ inline, className, children }) {
                                                          const codeString = String(children).replace(/\n$/, "");
                                                          const langMatch = /language-(\w+)/.exec(className || "");
                                                          if (inline || !langMatch) return <code className={className}>{children}</code>;
                                                          return <CodeBlock match={langMatch} codeString={codeString} />;
                                                        }
                                                      }}>{contentToRender}</ReactMarkdown>
                                                  }
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </details>
                                    )}
                                  </div>
                                  );
                               })()
                               : !m.content && isLoading
                               ? <div style={{ paddingTop: 4, color: "var(--ink-3)" }}>
                                   <div className="flex gap-2 items-center">
                                     <div className="flex gap-1 items-center">
                                       <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: 'var(--ink-3)' }} />
                                       <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: 'var(--ink-3)', animationDelay: '0.15s' }} />
                                       <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: 'var(--ink-3)', animationDelay: '0.3s' }} />
                                     </div>
                                     <span style={{ fontSize: 13 }}>{getStatusLabel(streamStatus, selectedMode)}</span>
                                   </div>
                                 </div>
                               : hasStructuredContent(m.content)
                                 ? <StructuredResponseRenderer response={m.content} />
                                 : isWritingBlock(m.content)
                                   ? <WritingBlockCard content={m.content} />
                                   : <ReactMarkdown
                                       remarkPlugins={[remarkGfm, remarkMath]}
                                       rehypePlugins={[[rehypeKatex, KATEX_OPTIONS]]}
                                       components={{
                                         code({ inline, className, children }) {
                                           const codeString = String(children).replace(/\n$/, "");
                                           const langMatch = /language-(\w+)/.exec(className || "");
                                           if (inline || !langMatch) return <code className={className}>{children}</code>;
                                           const isArtifactWorthy = codeString.split("\n").length >= 4;
                                           return (
                                             <CodeBlock
                                               match={langMatch}
                                               codeString={codeString}
                                               onSaveArtifact={isArtifactWorthy ? () => saveArtifact(codeString, langMatch[1], `${langMatch[1]} snippet`) : null}
                                             />
                                           );
                                         },
                                       }}
                                     >{m.content}</ReactMarkdown>
                             }
                           </div>
                           {m.content && !isLoading && (
                             <div className="msg-action-row">
                               <button className="msg-action-btn" onClick={() => copyAiMsg(i, m.content)} title="Copy response" aria-label="Copy response">
                                 <CopyIcon /><span>{copiedAiIdx === i ? 'Copied!' : 'Copy'}</span>
                               </button>
                               <button className="msg-action-btn" onClick={() => handleRegen(i)} title="Regenerate response" aria-label="Regenerate" disabled={isLoading}>
                                 <ReloadIcon /><span>Retry</span>
                               </button>
                               <button className="msg-action-btn" onClick={() => shareAiMsg(m.content)} title="Share response" aria-label="Share">
                                 <ShareIcon /><span>Share</span>
                               </button>
                               <button className={`msg-action-btn${msgFeedback[i] === 'up' ? ' feedback-up' : ''}`} onClick={() => handleFeedback(i, 'up')} title="Like" aria-label="Like response">
                                 <ThumbsUpIcon />
                               </button>
                               <button className={`msg-action-btn${msgFeedback[i] === 'down' ? ' feedback-down' : ''}`} onClick={() => handleFeedback(i, 'down')} title="Dislike" aria-label="Dislike response">
                                 <ThumbsDnIcon />
                               </button>
                             </div>
                           )}
                         </div>
                       )}
                     </div>
                   ))}
                   {isLoading && !(messages.length > 0 && messages[messages.length - 1].role === 'assistant') && (
                     <div className="flex w-full mb-6 justify-start gap-3">
                       <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg, #4F7CFF 0%, #8B5CF6 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                         <VetroSparkWhite size={22} />
                       </div>
                       <div style={{ paddingTop: 6, color: "var(--ink-3)" }}>
                         <div className="flex gap-2 items-center">
                           <div className="flex gap-1 items-center">
                             <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: 'var(--ink-3)' }}></span>
                             <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: 'var(--ink-3)', animationDelay: '0.15s' }}></span>
                             <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: 'var(--ink-3)', animationDelay: '0.3s' }}></span>
                           </div>
                           <span style={{ fontSize: 13 }}>{getStatusLabel(streamStatus, selectedMode)}</span>
                         </div>
                       </div>
                     </div>
                   )}

                   <div ref={messagesEndRef} />
                   </div>
                 </div>
                 <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingTop: 40, paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))', background: 'linear-gradient(to top, var(--bg) 55%, transparent)', pointerEvents: 'none' }} className="px-4 sm:px-6">
                   <div style={{ maxWidth: 720, margin: '0 auto', pointerEvents: 'auto' }}>
                    {renderInputBox()}
                  </div>
                 </div>
               </div>
             )}
        </div>
      </main>
    </div>
  );
}



