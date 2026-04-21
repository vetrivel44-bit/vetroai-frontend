import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import "./App.css";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const API = import.meta.env.VITE_API_URL || "https://ai-chatbot-backend-gvvz.onrender.com";
const SERPER_API_KEY = import.meta.env.VITE_SERPER_API_KEY || "";

const TODAY_STR = new Date().toLocaleDateString("en-IN", {
  weekday: "long", year: "numeric", month: "long", day: "numeric",
});
const swallowError = () => {};
const makeExportStamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const MAX_FILE_SIZE_MB = 25;

// ── FIX 1: Improved truncation detection ──────────────────────────────────────
const isLikelyTruncatedAnswer = (text = "") => {
  const t = String(text || "").trim();
  if (!t || t.length < 100) return false;

  // Unclosed code fences
  const fences = (t.match(/```/g) || []).length;
  if (fences % 2 !== 0) return true;

  // Unclosed parentheses/brackets (rough heuristic)
  const opens  = (t.match(/[([{]/g) || []).length;
  const closes = (t.match(/[)\]}]/g) || []).length;
  if (opens > closes + 4) return true;

  // SQL / code patterns mid-statement
  if (/(INSERT INTO|VALUES|CREATE TABLE|SELECT|FROM|WHERE|JOIN|UPDATE|DELETE)\s*[\w"'(]*\s*$/i.test(t)) return true;

  // Trailing operator / punctuation indicating more is coming
  if (/[([{,=:+\-*|&\\]\s*$/.test(t)) return true;

  // Last non-empty line looks like an incomplete sentence
  const lines    = t.split("\n").map(l => l.trim()).filter(Boolean);
  const lastLine = lines[lines.length - 1] || "";
  const words    = lastLine.split(/\s+/).filter(Boolean);
  if (
    words.length >= 4 &&
    lastLine.length > 20 &&
    !/[.!?:)\]}"'`*]$/.test(lastLine) &&
    !/^\d+\.\s/.test(lastLine)          // not a list item ending mid-way
  ) return true;

  // Mid-numbered-list cut: ends with "N." or "N)" pattern
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
          <h3 className="modal-title">🧮 Calculator</h3>
          <button className="modal-x" onClick={onClose}>✕</button>
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

// ─── FOCUS TIMER ─────────────────────────────────────────────────────────────
function FocusTimer({ onClose }) {
  const [mins, setMins] = useState(25);
  const [secs, setSecs] = useState(0);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState("focus");
  const [sessions, setSessions] = useState(0);
  const tick = useRef(null);

  const MODES_T = { focus: [25, "🎯 Focus"], short: [5, "☕ Short Break"], long: [15, "🌿 Long Break"] };

  const reset = (m) => { setMode(m); setRunning(false); clearInterval(tick.current); setMins(MODES_T[m][0]); setSecs(0); };

  useEffect(() => {
    if (running) {
      tick.current = setInterval(() => {
        setSecs(s => {
          if (s === 0) {
            setMins(m => {
              if (m === 0) {
                clearInterval(tick.current); setRunning(false);
                setSessions(prev => prev + 1);
                if (window.Notification?.permission === "granted") new Notification("VetroAI Timer ✅", { body: "Session complete! Take a break." });
                return 0;
              }
              return m - 1;
            });
            return 59;
          }
          return s - 1;
        });
      }, 1000);
    } else clearInterval(tick.current);
    return () => clearInterval(tick.current);
  }, [running]);

  useEffect(() => { if (window.Notification?.permission === "default") Notification.requestPermission(); }, []);

  const pct = ((MODES_T[mode][0] * 60 - (mins * 60 + secs)) / (MODES_T[mode][0] * 60)) * 100;
  const r = 54, circ = 2 * Math.PI * r;

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 340 }}>
        <div className="modal-topbar">
          <h3 className="modal-title">⏱️ Focus Timer</h3>
          <button className="modal-x" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ alignItems: "center", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            {Object.entries(MODES_T).map(([k, [, label]]) => (
              <button key={k} className={`btn-ghost${mode === k ? " active" : ""}`} style={{ fontSize: "0.72rem" }} onClick={() => reset(k)}>{label}</button>
            ))}
          </div>
          <svg width={140} height={140} viewBox="0 0 140 140">
            <circle cx={70} cy={70} r={r} fill="none" stroke="var(--border)" strokeWidth={8} />
            <circle cx={70} cy={70} r={r} fill="none" stroke="var(--accent)" strokeWidth={8}
              strokeDasharray={circ} strokeDashoffset={circ - (pct / 100) * circ}
              strokeLinecap="round" transform="rotate(-90 70 70)" style={{ transition: "stroke-dashoffset 1s linear" }} />
            <text x={70} y={67} textAnchor="middle" style={{ font: "bold 26px system-ui", fill: "var(--ink)" }}>
              {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
            </text>
            <text x={70} y={86} textAnchor="middle" style={{ font: "11px system-ui", fill: "var(--ink-3)" }}>
              {MODES_T[mode][1]}
            </text>
          </svg>
          {sessions > 0 && <p style={{ fontSize: "0.8rem", color: "var(--ink-3)" }}>✅ {sessions} session{sessions > 1 ? "s" : ""} completed today</p>}
          <div style={{ display: "flex", gap: 12 }}>
            <button className="btn-primary" onClick={() => setRunning(v => !v)}>{running ? "⏸ Pause" : "▶ Start"}</button>
            <button className="btn-ghost" onClick={() => reset(mode)}>↺ Reset</button>
          </div>
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
];
const needsWebSearch = (q) => CURRENT_TRIGGERS.some(rx => rx.test(q));

// ── FIX 2A: DuckDuckGo instant answers (CORS-friendly, free) ──────────────────
const fetchDDGInstant = async (query) => {
  try {
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
      { signal: AbortSignal.timeout(4000) }
    );
    const d = await res.json();
    if (d.AbstractText && d.AbstractText.length > 20)
      return `**Instant Answer (${d.AbstractSource || "DuckDuckGo"})**: ${d.AbstractText}\n${d.AbstractURL ? `Source: ${d.AbstractURL}` : ""}`;
    if (d.Answer && d.Answer.length > 5)
      return `**Quick Answer**: ${d.Answer}`;
    return null;
  } catch { return null; }
};

// ── FIX 2B: Fetch real page content via Jina AI reader (CORS-friendly) ───────
const fetchPageContent = async (url, maxChars = 3000) => {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: "text/plain", "X-Return-Format": "text" },
      signal: AbortSignal.timeout(6000),
    });
    const text = await res.text();
    // Strip excessive whitespace and return useful portion
    return text.replace(/\s{3,}/g, "\n\n").trim().slice(0, maxChars) || null;
  } catch { return null; }
};

// ── FIX 2C: Improved Serper-based search with page content ───────────────────
const fetchWebResults = async (query) => {
  const snippets = [];

  // 1. DDG instant answer for quick facts
  const ddgHit = await fetchDDGInstant(query);
  if (ddgHit) snippets.push(ddgHit);

  if (!SERPER_API_KEY) {
    if (!snippets.length) return null;
    snippets.unshift(`**Search Date**: ${TODAY_STR} | **Query**: "${query}"`);
    return snippets.join("\n\n---\n\n");
  }

  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, gl: "in", hl: "en", num: 8 }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();

    // Priority 1 — Answer box (most accurate)
    if (data.answerBox) {
      const ab  = data.answerBox;
      const ans = ab.answer || ab.snippet || (ab.snippetHighlighted || []).join(" ") || "";
      if (ans) snippets.unshift(`**DIRECT ANSWER**: ${ans}${ab.link ? `\nSource: ${ab.link}` : ""}`);
    }

    // Priority 2 — Knowledge graph
    if (data.knowledgeGraph) {
      const kg = data.knowledgeGraph;
      let t = `**${kg.title || ""}**${kg.type ? ` (${kg.type})` : ""}`;
      if (kg.description) t += `\n${kg.description}`;
      if (kg.attributes) t += "\n" + Object.entries(kg.attributes).slice(0, 5).map(([k, v]) => `• **${k}**: ${v}`).join("\n");
      snippets.push(t);
    }

    // Priority 3 — Sports results
    if (data.sportsResults?.games?.length) {
      const sr = data.sportsResults;
      snippets.push(
        `**${sr.title || "Live Scores"}**:\n` +
        sr.games.slice(0, 6).map(g =>
          `• ${g.homeTeam} **${g.homeScore ?? ""}** vs ${g.awayTeam} **${g.awayScore ?? ""}** ${g.status ? `— ${g.status}` : ""} ${g.date ? `(${g.date})` : ""}`
        ).join("\n")
      );
    }

    // Priority 4 — Top stories / news
    if (data.topStories?.length) {
      snippets.push(
        `**Latest News**:\n` +
        data.topStories.slice(0, 5).map(s =>
          `• **${s.title}** — ${s.source || ""} ${s.date ? `(${s.date})` : ""}\n  ${s.link || ""}`
        ).join("\n")
      );
    }

    // Priority 5 — Organic results with snippets
    if (data.organic?.length) {
      const orgText = data.organic.slice(0, 5).map((r, i) =>
        `[${i + 1}] **${r.title}**\n${r.snippet || "(no snippet)"}\n${r.link}`
      ).join("\n\n");
      snippets.push(`**Web Results for "${query}"**:\n\n${orgText}`);

      // Fetch actual page content from the #1 result for maximum accuracy
      const topResult = data.organic[0];
      if (topResult?.link && !topResult.link.includes("youtube.com") && !topResult.link.includes("twitter.com")) {
        const pageContent = await fetchPageContent(topResult.link);
        if (pageContent && pageContent.length > 200) {
          snippets.push(`**Full Content — "${topResult.title}"**:\n${pageContent}`);
        }
      }
    }

    // People also ask
    if (data.peopleAlsoAsk?.length) {
      snippets.push(
        `**Related Questions**:\n` +
        data.peopleAlsoAsk.slice(0, 3).map(p => `**Q: ${p.question}**\n${p.snippet || ""}`).join("\n\n")
      );
    }
  } catch (err) { console.error("Serper:", err.message); }

  if (!snippets.length) return null;
  snippets.unshift(`**Search Date**: ${TODAY_STR} | **Query**: "${query}"`);
  return snippets.join("\n\n---\n\n");
};

const buildDeepSearchQueries = (query) => [
  query.trim(),
  `${query.trim()} latest 2026`,
  `${query.trim()} statistics data analysis`,
  `${query.trim()} expert review site:reddit.com OR site:news.ycombinator.com`,
].filter(Boolean);

const fetchDeepSearchContext = async (query) => {
  const queries = buildDeepSearchQueries(query);
  const results = await Promise.allSettled(queries.map(q => fetchWebResults(q)));
  const chunks  = results.filter(r => r.status === "fulfilled" && r.value).map(r => r.value);
  if (!chunks.length) return null;
  return [
    `🔎 **DeepSearch for**: "${query}" — ${chunks.length}/${queries.length} search packs retrieved`,
    ...chunks.map((chunk, i) => `### Source Pack ${i + 1}\n${chunk}`),
  ].join("\n\n");
};

// ─── IMAGE GENERATION ─────────────────────────────────────────────────────────
const IMAGE_DETECT = /\b(generate|create|make|draw|paint|design|render|show me)\b.{0,40}\b(image|picture|photo|artwork|illustration|portrait|sketch|logo|wallpaper|icon)\b/i;
const detectImagePrompt = (text) => {
  if (!IMAGE_DETECT.test(text)) return null;
  return text.replace(/^.*(generate|create|make|draw|paint|design|render|show me)\s+(an?\s+|the\s+)?(image|picture|photo|artwork|illustration|portrait|sketch|logo|wallpaper|icon)\s+(of\s+)?/i, "").trim() || text;
};
const getImageUrl = (prompt) => `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=768&height=512&nologo=true&seed=${Math.floor(Math.random() * 99999)}`;

// ─── MEMORY SYSTEM ────────────────────────────────────────────────────────────
const MEMORY_PATTERNS = [
  { rx: /remember (?:that )?(.{4,80})/i, prefix: "User note:" },
  { rx: /my name is ([A-Za-z ]{2,30})/i, prefix: "User's name:" },
  { rx: /i(?:'m| am) (?:a |an )?([A-Za-z ]{3,40})/i, prefix: "User is:" },
  { rx: /i (?:work|study|live) (?:at|in|as) ([A-Za-z ,]{3,50})/i, prefix: "User works/studies/lives:" },
  { rx: /i(?:'m| am) from ([A-Za-z ,]{3,40})/i, prefix: "User is from:" },
  { rx: /my (?:favourite|favorite|fav) (.{3,50})/i, prefix: "User favourite:" },
];
const extractMemory  = (text) => { for (const { rx, prefix } of MEMORY_PATTERNS) { const m = text.match(rx); if (m) return `${prefix} ${m[1].trim()}`; } return null; };
const getMemories    = (email) => { try { return JSON.parse(localStorage.getItem(`vetroai_memories_${email}`) || "[]"); } catch { return []; } };
const saveMemories   = (email, mems) => { localStorage.setItem(`vetroai_memories_${email}`, JSON.stringify(mems.slice(-30))); };
const addMemory      = (email, fact) => { const mems = getMemories(email); if (!mems.includes(fact)) saveMemories(email, [...mems, fact]); };

// ─── TRANSLATIONS ─────────────────────────────────────────────────────────────
const LANGS = {
  en: { flag: "🇬🇧", name: "English", t: {
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
  hi: { flag: "🇮🇳", name: "हिंदी", t: {
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
  kn: { flag: "🇮🇳", name: "ಕನ್ನಡ", t: {
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
  es: { flag: "🇪🇸", name: "Español", t: {
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

const MODES = [
  { id: "vtu_academic", name: "🎓 Academic" },
  { id: "debugger",     name: "🐛 Debugger" },
  { id: "astrology",    name: "🔮 Astrologer" },
  { id: "fast_chat",    name: "⚡ Fast Chat" },
  { id: "creative",     name: "✨ Creative" },
  { id: "analyst",      name: "📊 Analyst" },
  { id: "web_search",   name: "🌐 Web Search" },
  { id: "deep_search",  name: "🧠 DeepSearch" },
  { id: "youtube",      name: "▶️ YouTube" },
  { id: "translator",   name: "🌍 Translator" },
  { id: "interviewer",  name: "💼 Interviewer" },
];

const AVATARS = ["🧑","🤖","🦊","🐼","🐸","🦁","🐯","🦅","🌟","🔥","💎","🚀","🌈","🎨","🦋","🐉","🌙","⚡","🧠","🎯","🦄","🌊","🪐","🎭","🏔️"];
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
const REACTIONS = ["👍","❤️","😂","😮","🔥","🧠"];

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
const SendIcon     = () => <Ic size={15} sw={2} fill="currentColor" d={<><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" fill="currentColor" stroke="none" /></>} />;
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
function CodeBlock({ match, codeString, copyLabel }) {
  const [cp, setCp] = useState(false);
  const copy = () => { navigator.clipboard.writeText(codeString); setCp(true); setTimeout(() => setCp(false), 2000); };
  return (
    <div className="code-wrap">
      <div className="code-header">
        <span className="code-lang">{match ? match[1] : "text"}</span>
        <button className="code-copy-btn" onClick={copy}>
          {cp ? <><CheckIcon /> Copied</> : <><CopyIcon /> {copyLabel || "Copy"}</>}
        </button>
      </div>
      <SyntaxHighlighter style={vscDarkPlus} language={match ? match[1] : "text"} PreTag="div"
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
  const init = JSON.parse(localStorage.getItem(PKEY) || '{"name":"","avatar":"🧑"}');
  const [tab, setTab]     = useState("profile");
  const [name, setName]   = useState(userInfo?.name || init.name || "");
  const [avatar, setAvatar] = useState(init.avatar || "🧑");
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
              <div className="av-big">{avatar}</div>
              {userInfo?.email && <span style={{ fontSize: "0.78rem", color: "var(--ink-3)" }}>{userInfo.email}</span>}
            </div>
            <div className="field-group">
              <label className="field-label">{t.changeAvatar}</label>
              <div className="av-grid">
                {AVATARS.map(a => (
                  <button key={a} className={`av-opt${avatar === a ? " sel" : ""}`} onClick={() => setAvatar(a)}>
                    {a}{avatar === a && <span className="av-check"><CheckIcon /></span>}
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
  const [cp, setCp] = useState(false);
  const url = useMemo(() => {
    const d = btoa(encodeURIComponent(JSON.stringify(messages.slice(-10).map(m => ({ r: m.role, c: m.content?.slice(0, 200) })))));
    return `${window.location.origin}${window.location.pathname}?share=${d.slice(0, 400)}`;
  }, [messages]);
  const copy = () => { navigator.clipboard.writeText(url); setCp(true); setTimeout(() => setCp(false), 2500); };
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
      <div className="modal">
        <div className="modal-topbar">
          <h3 className="modal-title"><ShareIcon />{t.shareTitle}</h3>
          <button className="modal-x" onClick={onClose}><XIcon /></button>
        </div>
        <div className="modal-body">
          <div className="field-group">
            <label className="field-label">Share link</label>
            <div className="share-row">
              <input className="field-input" readOnly value={url} />
              <button className="btn-primary" onClick={copy}>{cp ? <><CheckIcon />Copied</> : t.copy}</button>
            </div>
            <p className="share-note">{t.shareNote}</p>
          </div>
          <div className="field-group">
            <label className="field-label">{t.exportChat}</label>
            <div style={{ display: "flex", gap: 8 }}>
              {["txt", "md", "html", "json"].map(type => (
                <button key={type} className="btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={() => exportFn(type)}>
                  <DlIcon />{type.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
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
            ? <div className="hist-empty"><span>🔖</span><p>{t.noBookmarks}</p></div>
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

function MemoryPanel({ memories, onClear, onRemove, onClose, t }) {
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-topbar">
          <h3 className="modal-title"><BrainIcon />{t.memories} ({memories.length})</h3>
          <button className="modal-x" onClick={onClose}><XIcon /></button>
        </div>
        <div className="modal-body">
          {memories.length === 0
            ? <div className="hist-empty"><span>🧠</span><p>No memories yet. Say "Remember that…" or "My name is…"</p></div>
            : <>{memories.map((m, i) => (
              <div key={i} className="memory-item">
                <span>{m}</span>
                <button onClick={() => onRemove(i)}><TrashIcon /></button>
              </div>
            ))}
            <div className="modal-footer">
              <button className="btn-ghost" onClick={onClear}>{t.clearMemory}</button>
            </div></>}
        </div>
      </div>
    </div>
  );
}

function ReactionPicker({ onPick, onClose }) {
  return (
    <div className="rxn-picker">
      {REACTIONS.map(r => <button key={r} className="rxn-opt" onClick={() => { onPick(r); onClose(); }}>{r}</button>)}
    </div>
  );
}

function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 340 }} onClick={e => e.stopPropagation()}>
        <div className="modal-topbar">
          <h3 className="modal-title">⚠️ Confirm</h3>
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

// ─── BOOKING SYSTEM ──────────────────────────────────────────────────────────
const BOOKING_SERVICES = [
  { id: "tutoring", icon: "🎓", name: "Tutoring", desc: "1-on-1 academic help", price: "₹299/hr", color: "#3b82f6" },
  { id: "code_review", icon: "🐛", name: "Code Review", desc: "Expert code analysis", price: "₹499/hr", color: "#10b981" },
  { id: "career", icon: "💼", name: "Career Counseling", desc: "Career path guidance", price: "₹399/hr", color: "#8b5cf6" },
  { id: "project", icon: "🚀", name: "Project Help", desc: "Build projects together", price: "₹599/hr", color: "#f59e0b" },
  { id: "study", icon: "📚", name: "Study Session", desc: "Group study planning", price: "₹199/hr", color: "#ec4899" },
  { id: "interview", icon: "🎯", name: "Mock Interview", desc: "Practice interviews", price: "₹449/hr", color: "#ef4444" },
];

const getBookings = () => { try { return JSON.parse(localStorage.getItem("vetroai_bookings") || "[]"); } catch { return []; } };
const saveBookings = (b) => localStorage.setItem("vetroai_bookings", JSON.stringify(b));

const BOOKING_DETECT = /\b(book|schedule|reserve|appointment|session|slot)\b.{0,40}\b(tutor|code|review|career|project|study|interview|help|session|class)\b/i;
const detectBookingIntent = (text) => BOOKING_DETECT.test(text);

function BookingWidget({ onClose, onBooked }) {
  const [step, setStep] = useState(0);
  const [service, setService] = useState(null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState("60");
  const [priority, setPriority] = useState("normal");
  const [notes, setNotes] = useState("");
  const [confirmed, setConfirmed] = useState(null);

  const minDate = new Date().toISOString().split("T")[0];

  const handleBook = () => {
    const booking = {
      id: `BK-${Date.now().toString(36).toUpperCase()}`,
      service, date, time, duration: parseInt(duration),
      priority, notes, status: "upcoming",
      createdAt: new Date().toISOString(),
    };
    const all = getBookings();
    all.unshift(booking);
    saveBookings(all);
    setConfirmed(booking);
    onBooked?.(booking);
  };

  if (confirmed) return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-body" style={{ alignItems: "center", textAlign: "center", padding: 36 }}>
          <div className="booking-success-icon">✅</div>
          <h3 style={{ fontSize: "1.3rem", fontWeight: 700, color: "var(--ink)", margin: "12px 0 6px" }}>Booking Confirmed!</h3>
          <p style={{ color: "var(--ink-3)", fontSize: "0.88rem", marginBottom: 16 }}>Your session has been scheduled successfully.</p>
          <div className="booking-confirm-card">
            <div className="booking-confirm-row"><span>ID</span><strong>{confirmed.id}</strong></div>
            <div className="booking-confirm-row"><span>Service</span><strong>{confirmed.service.icon} {confirmed.service.name}</strong></div>
            <div className="booking-confirm-row"><span>Date</span><strong>{new Date(confirmed.date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</strong></div>
            <div className="booking-confirm-row"><span>Time</span><strong>{confirmed.time}</strong></div>
            <div className="booking-confirm-row"><span>Duration</span><strong>{confirmed.duration} min</strong></div>
            {confirmed.priority === "urgent" && <div className="booking-confirm-row"><span>Priority</span><strong style={{ color: "#ef4444" }}>🔴 Urgent</strong></div>}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button className="btn-ghost" onClick={() => { const ics = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:VetroAI - ${confirmed.service.name}\nDTSTART:${confirmed.date.replace(/-/g,"")}T${confirmed.time.replace(":","")}00\nDURATION:PT${confirmed.duration}M\nDESCRIPTION:${confirmed.notes || "VetroAI Session"}\nEND:VEVENT\nEND:VCALENDAR`; const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([ics],{type:"text/calendar"})); a.download=`vetroai-${confirmed.id}.ics`; a.click(); }}>📅 Add to Calendar</button>
            <button className="btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-topbar">
          <h3 className="modal-title">📅 Book a Session</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div className="booking-steps">
              {[0, 1, 2].map(s => <div key={s} className={`booking-step-dot${step >= s ? " active" : ""}`} />)}
            </div>
            <button className="modal-x" onClick={onClose}><XIcon /></button>
          </div>
        </div>
        <div className="modal-body">
          {step === 0 && (
            <div className="field-group">
              <label className="field-label">Choose Service</label>
              <div className="booking-services-grid">
                {BOOKING_SERVICES.map(s => (
                  <div key={s.id} className={`booking-service-card${service?.id === s.id ? " selected" : ""}`} style={{ "--svc-color": s.color }} onClick={() => setService(s)}>
                    <span className="booking-svc-icon">{s.icon}</span>
                    <span className="booking-svc-name">{s.name}</span>
                    <span className="booking-svc-desc">{s.desc}</span>
                    <span className="booking-svc-price">{s.price}</span>
                    {service?.id === s.id && <span className="booking-svc-check"><CheckIcon /></span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {step === 1 && (
            <>
              <div className="field-group">
                <label className="field-label">Date</label>
                <input className="field-input" type="date" min={minDate} value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <div className="field-group">
                <label className="field-label">Time</label>
                <input className="field-input" type="time" value={time} onChange={e => setTime(e.target.value)} />
              </div>
              <div className="field-group">
                <label className="field-label">Duration</label>
                <div style={{ display: "flex", gap: 8 }}>
                  {["30", "60", "90", "120"].map(d => (
                    <button key={d} className={`booking-dur-btn${duration === d ? " active" : ""}`} onClick={() => setDuration(d)}>{d} min</button>
                  ))}
                </div>
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <div className="field-group">
                <label className="field-label">Priority</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className={`booking-dur-btn${priority === "normal" ? " active" : ""}`} onClick={() => setPriority("normal")}>🟢 Normal</button>
                  <button className={`booking-dur-btn${priority === "urgent" ? " active" : ""}`} onClick={() => setPriority("urgent")} style={priority === "urgent" ? { borderColor: "#ef4444", background: "rgba(239,68,68,0.08)", color: "#ef4444" } : {}}>🔴 Urgent</button>
                </div>
              </div>
              <div className="field-group">
                <label className="field-label">Notes (optional)</label>
                <textarea className="field-textarea" placeholder="Any specific topics or requirements…" value={notes} onChange={e => setNotes(e.target.value)} style={{ minHeight: 60 }} />
              </div>
              <div className="booking-summary">
                <div className="booking-confirm-row"><span>Service</span><strong>{service?.icon} {service?.name}</strong></div>
                <div className="booking-confirm-row"><span>When</span><strong>{date && new Date(date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })} at {time}</strong></div>
                <div className="booking-confirm-row"><span>Duration</span><strong>{duration} min</strong></div>
                <div className="booking-confirm-row"><span>Price</span><strong>{service?.price}</strong></div>
              </div>
            </>
          )}
          <div className="modal-footer">
            {step > 0 && <button className="btn-ghost" onClick={() => setStep(s => s - 1)}>← Back</button>}
            {step < 2 ? (
              <button className="btn-primary" disabled={step === 0 ? !service : !date || !time} onClick={() => setStep(s => s + 1)}>Next →</button>
            ) : (
              <button className="btn-primary" onClick={handleBook} style={{ background: "var(--accent)" }}>✓ Confirm Booking</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function BookingHistory({ onClose }) {
  const [bookings, setBookings] = useState(getBookings);
  const [filter, setFilter] = useState("all");
  const cancel = (id) => {
    const updated = bookings.map(b => b.id === id ? { ...b, status: "cancelled" } : b);
    setBookings(updated); saveBookings(updated);
  };
  const filtered = filter === "all" ? bookings : bookings.filter(b => b.status === filter);
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-topbar">
          <h3 className="modal-title">📋 My Bookings ({bookings.length})</h3>
          <button className="modal-x" onClick={onClose}><XIcon /></button>
        </div>
        <div className="modal-body">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["all", "upcoming", "completed", "cancelled"].map(f => (
              <button key={f} className={`booking-dur-btn${filter === f ? " active" : ""}`} onClick={() => setFilter(f)} style={{ fontSize: "0.76rem", textTransform: "capitalize" }}>{f}</button>
            ))}
          </div>
          {filtered.length === 0 ? (
            <div className="hist-empty"><span>📅</span><p>No {filter !== "all" ? filter : ""} bookings yet</p></div>
          ) : filtered.map(b => (
            <div key={b.id} className="booking-hist-card">
              <div className="booking-hist-top">
                <span className="booking-hist-icon">{b.service?.icon || "📅"}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: "0.88rem", color: "var(--ink)" }}>{b.service?.name || "Session"}</div>
                  <div style={{ fontSize: "0.76rem", color: "var(--ink-3)" }}>{b.id} · {b.duration}min</div>
                </div>
                <span className={`booking-status ${b.status}`}>{b.status}</span>
              </div>
              <div style={{ display: "flex", gap: 12, fontSize: "0.8rem", color: "var(--ink-2)", padding: "6px 0" }}>
                <span>📅 {b.date && new Date(b.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                <span>⏰ {b.time}</span>
                {b.priority === "urgent" && <span style={{ color: "#ef4444" }}>🔴 Urgent</span>}
              </div>
              {b.status === "upcoming" && (
                <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                  <button className="btn-ghost sm" onClick={() => cancel(b.id)} style={{ fontSize: "0.74rem", padding: "4px 10px" }}>Cancel</button>
                </div>
              )}
            </div>
          ))}
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
            <div className="bubble" style={{ background: "var(--bg-hover)", padding: 16, borderRadius: 12, minHeight: 200 }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{text || "*Nothing here yet…*"}</ReactMarkdown>
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

// ─── CODE PLAYGROUND ─────────────────────────────────────────────────────────
function CodePlayground({ onClose }) {
  const [html, setHtml] = useState(localStorage.getItem("vetroai_playground_html") || '<h1 style="color:#E76F51">Hello VetroAI!</h1>\n<p>Edit me and see live preview ↓</p>');
  const [output, setOutput] = useState("");
  useEffect(() => { localStorage.setItem("vetroai_playground_html", html); }, [html]);
  const run = () => setOutput(html);
  useEffect(() => { run(); }, []);
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 640 }}>
        <div className="modal-topbar">
          <h3 className="modal-title">🧪 Code Playground</h3>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn-primary sm" onClick={run} style={{ fontSize: "0.76rem" }}>▶ Run</button>
            <button className="modal-x" onClick={onClose}><XIcon /></button>
          </div>
        </div>
        <div className="modal-body" style={{ gap: 10 }}>
          <textarea className="field-textarea" value={html} onChange={e => setHtml(e.target.value)}
            style={{ minHeight: 140, fontFamily: "var(--mono)", fontSize: "0.82rem" }}
            placeholder="Write HTML/CSS/JS here…" />
          <div className="field-label">Preview</div>
          <div style={{ background: "#fff", borderRadius: 10, border: "1px solid var(--border)", overflow: "hidden", minHeight: 140 }}>
            <iframe title="preview" srcDoc={output} sandbox="allow-scripts" style={{ width: "100%", height: 200, border: "none", display: "block" }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── STATS PANEL ─────────────────────────────────────────────────────────────
function StatsPanel({ onClose, sessions, bookings }) {
  const totalMsgs = sessions.reduce((a, s) => a + (s.messages?.length || 0), 0);
  const userMsgs = sessions.reduce((a, s) => a + (s.messages?.filter(m => m.role === "user").length || 0), 0);
  const botMsgs = totalMsgs - userMsgs;
  const totalBookings = bookings.length;
  const stats = [
    { icon: "💬", label: "Total Messages", value: totalMsgs },
    { icon: "👤", label: "You Sent", value: userMsgs },
    { icon: "🤖", label: "AI Replies", value: botMsgs },
    { icon: "📂", label: "Conversations", value: sessions.length },
    { icon: "📅", label: "Total Bookings", value: totalBookings },
    { icon: "⭐", label: "Active Bookings", value: bookings.filter(b => b.status === "upcoming").length },
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

// ══════════════════════════════════════════════════════════════════════
//  MAIN APP
// ══════════════════════════════════════════════════════════════════════
export default function App() {
  const [theme, setTheme]         = useState(() => localStorage.getItem("vetroai_theme") || "light");
  const [langCode, setLangCode]   = useState(() => localStorage.getItem("vetroai_lang") || "en");
  const t = LANGS[langCode]?.t || LANGS.en.t;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("vetroai_theme", theme);
  }, [theme]);

  // ── Auth ─────────────────────────────────────────────────────────────────────
  const [user, setUser]           = useState(localStorage.getItem("token"));
  const [userInfo, setUserInfo]   = useState(() => { try { return JSON.parse(localStorage.getItem("vetroai_userinfo") || "null"); } catch { return null; } });
  const [authMode, setAuthMode]   = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName]   = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [showPass, setShowPass]   = useState(false);

  // ── Toast ─────────────────────────────────────────────────────────────────────
  const [toasts, setToasts] = useState([]);
  const addToast = useCallback((message, type = "info", duration = 3000) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
  }, []);

  // ── Session ───────────────────────────────────────────────────────────────────
  const [sessions, setSessions]             = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [histSearch, setHistSearch]         = useState("");
  const [pinnedIds, setPinnedIds]           = useState(() => JSON.parse(localStorage.getItem("vetroai_pins") || "[]"));
  const [isSidebarOpen, setIsSidebarOpen]   = useState(false);
  const [confirmDelete, setConfirmDelete]   = useState(null);

  // ── Chat ──────────────────────────────────────────────────────────────────────
  const [messages, setMessages]             = useState([]);
  const [input, setInput]                   = useState("");
  const [editIdx, setEditIdx]               = useState(null);
  const [editInput, setEditInput]           = useState("");
  const [selectedMode, setSelectedMode]     = useState(MODES[0].id);
  const isYtMode     = selectedMode === "youtube";
  const isWebMode    = selectedMode === "web_search";
  const isDeepSearch = selectedMode === "deep_search";
  const [selFile, setSelFile]               = useState(null);
  const [filePreview, setFilePreview]       = useState(null);
  const [isLoading, setIsLoading]           = useState(false);
  const [isTyping, setIsTyping]             = useState(false);
  const [showScrollDn, setShowScrollDn]     = useState(false);
  const [reactions, setReactions]           = useState({});
  const [msgFeedback, setMsgFeedback]       = useState({});
  const [rxnFor, setRxnFor]                 = useState(null);
  const [streamingContent, setStreamingContent] = useState("");
  // FIX 1: track auto-continuation status
  const [isContinuing, setIsContinuing]     = useState(false);
  const abortRef     = useRef(null);
  const requestIdRef = useRef(0);
  const transcriptCacheRef = useRef(new Map());

  // ── Web search ────────────────────────────────────────────────────────────────
  const [isWebSearching, setIsWebSearching] = useState(false);
  const [autoWebSearch, setAutoWebSearch]   = useState(true);
  const currentMode = MODES.find(m => m.id === selectedMode) || MODES[0];

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
        : (currentMode.suggestions || []);

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
  const [showMemory, setShowMemory]         = useState(false);

  // ── Modals ────────────────────────────────────────────────────────────────────
  const [showProfile, setShowProfile]       = useState(false);
  const [showSysPrompt, setShowSysPrompt]   = useState(false);
  const [showShare, setShowShare]           = useState(false);
  const [showCalc, setShowCalc]             = useState(false);
  const [showTimer, setShowTimer]           = useState(false);
  const [showBooking, setShowBooking]       = useState(false);
  const [showBookingHistory, setShowBookingHistory] = useState(false);
  const [showScratchpad, setShowScratchpad] = useState(false);
  const [showPlayground, setShowPlayground] = useState(false);
  const [showStats, setShowStats]           = useState(false);
  const [systemPrompt, setSystemPrompt]     = useState(() => localStorage.getItem("vetroai_sysprompt") || "");

  // ── Search ────────────────────────────────────────────────────────────────────
  const [chatSearchOpen, setChatSearchOpen]     = useState(false);
  const [chatSearchQuery, setChatSearchQuery]   = useState("");
  const [chatSearchCursor, setChatSearchCursor] = useState(0);

  // ── Voice ─────────────────────────────────────────────────────────────────────
  const [autoSpeak, setAutoSpeak]   = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isVoiceOpen, setIsVoiceOpen] = useState(false);

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
    const anyModal = isSidebarOpen || showProfile || showSysPrompt || showShare || showBookmarks || showMemory || showCalc || showTimer || showBooking || showBookingHistory || showScratchpad || showPlayground || showStats || !!confirmDelete;
    document.body.style.overflow = anyModal ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [isSidebarOpen, showProfile, showSysPrompt, showShare, showBookmarks, showMemory, showCalc, showTimer, showBooking, showBookingHistory, showScratchpad, showPlayground, showStats, confirmDelete]);

  // ── Auth submit ───────────────────────────────────────────────────────────────
  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError(""); setAuthLoading(true);
    const applyAuthPayload = (payload) => {
      const accessToken = payload?.accessToken;
      if (!accessToken) {
        setAuthError("⚠️ Invalid auth response from server.");
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
      const endpoint = authMode === "login" ? "/api/auth/login" : "/api/auth/signup";
      const body = authMode === "login"
        ? { email: authEmail, password: authPassword }
        : { email: authEmail, password: authPassword, name: authName.trim() };
      const res  = await fetch(API + endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
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
        setAuthError("✅ Account created! Please sign in.");
        setAuthLoading(false);
        return;
      }
      applyAuthPayload(payload);
    } catch {
      setAuthError("⚠️ Connection failed. Please try again.");
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
      try { const s = localStorage.getItem("vetroai_sessions_" + user); if (s) setSessions(JSON.parse(s) || []); } catch { setSessions([]); }
    }
  }, [user]);

  useEffect(() => {
    if (messages.length === 0 || !user) return;
    try {
      const title = `${(messages[0]?.content || "Chat").slice(0, 36)}…`;
      if (!currentSessionId) {
        const id = Date.now().toString();
        setCurrentSessionId(id);
        setSessions((prev) => {
          const list = [{ id, title, messages }, ...prev];
          try { localStorage.setItem("vetroai_sessions_" + user, JSON.stringify(list)); } catch (err) { swallowError(err); }
          return list;
        });
        return;
      }
      setSessions((prev) => {
        const list = [...prev];
        const i = list.findIndex((s) => s.id === currentSessionId);
        if (i !== -1) list[i] = { ...list[i], messages };
        else list.unshift({ id: currentSessionId, title, messages });
        try { localStorage.setItem("vetroai_sessions_" + user, JSON.stringify(list)); } catch (err) { swallowError(err); }
        return list;
      });
    } catch (err) { swallowError(err); }
  }, [messages, currentSessionId, user]);

  const updateSessionTitle = useCallback(async (firstMsg) => {
    if (!firstMsg || !currentSessionId) return;
    try {
      const res  = await fetch(API + "/generate-title", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify({ firstMessage: firstMsg }),
      });
      const data = await res.json();
      if (data.title) {
        setSessions(prev => {
          const list = prev.map(s => s.id === currentSessionId ? { ...s, title: data.title } : s);
          localStorage.setItem("vetroai_sessions_" + user, JSON.stringify(list));
          return list;
        });
      }
    } catch (err) { swallowError(err); }
  }, [currentSessionId, user]);

  const loadSession = id => {
    const s = sessions.find(x => x.id === id);
    if (s) { setMessages(s.messages || []); setCurrentSessionId(id); stopSpeak(); setIsSidebarOpen(false); isScrolling.current = false; setFollowUps([]); }
  };

  const newChat = useCallback(() => {
    requestIdRef.current += 1;
    abortRef.current?.abort();
    setMessages([]); setCurrentSessionId(null); setInput(""); stopSpeak();
    setIsSidebarOpen(false); setReactions({}); setFollowUps([]); setMsgFeedback({});
    setIsLoading(false); setIsTyping(false); setIsWebSearching(false); setIsYtFetching(false);
    setStreamingContent(""); setIsContinuing(false);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, []);

  const deleteSession = (id) => { setConfirmDelete({ id, message: "Delete this conversation? This cannot be undone." }); };

  const confirmDeleteSession = () => {
    if (!confirmDelete) return;
    const { id } = confirmDelete;
    const list = sessions.filter(s => s.id !== id); setSessions(list);
    try { localStorage.setItem("vetroai_sessions_" + user, JSON.stringify(list)); } catch (err) { swallowError(err); }
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

  // ── Memory ────────────────────────────────────────────────────────────────────
  const handleAddMemory = (fact) => {
    if (!userInfo?.email) return;
    addMemory(userInfo.email, fact);
    setMemories(getMemories(userInfo.email));
    addToast(`🧠 Remembered: ${fact.slice(0, 40)}`, "success", 2500);
  };
  const removeMemoryItem = (idx) => {
    if (!userInfo?.email) return;
    const m = memories.filter((_, i) => i !== idx); saveMemories(userInfo.email, m); setMemories(m);
  };
  const clearAllMemory = () => { if (!userInfo?.email) return; saveMemories(userInfo.email, []); setMemories([]); addToast("Memory cleared", "info"); };

  // ── Follow-up generation ──────────────────────────────────────────────────────
  const generateFollowUps = useCallback(async (lastBotMsg, userQuery) => {
    if (!lastBotMsg || lastBotMsg.length < 50) return;
    setFollowUpsLoading(true);
    try {
      const res  = await fetch(API + "/follow-ups", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify({ lastMessage: lastBotMsg.slice(0, 600), userQuery: userQuery?.slice(0, 150) || "" }),
      });
      const data = await res.json();
      setFollowUps(data.suggestions || []);
    } catch { setFollowUps([]); }
    setFollowUpsLoading(false);
  }, []);

  // ── Computed data ─────────────────────────────────────────────────────────────
  const { pinnedSessions, groupedSessions } = useMemo(() => {
    const filtered = sessions.filter(s => s?.title?.toLowerCase().includes(histSearch.toLowerCase()));
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
        if (showTimer)      { setShowTimer(false); return; }
        if (showProfile)    { setShowProfile(false); return; }
        if (showSysPrompt)  { setShowSysPrompt(false); return; }
        if (showShare)      { setShowShare(false); return; }
        if (showBookmarks)  { setShowBookmarks(false); return; }
        if (showMemory)     { setShowMemory(false); return; }
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
  }, [chatSearchOpen, closeVoice, confirmDelete, isSidebarOpen, isVoiceOpen, newChat, showBookmarks, showCalc, showMemory, showProfile, showShare, showSysPrompt, showTimer]);

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
    u.voice   = vs.find(v => v.name.includes("AriaNeural")) || vs.find(v => v.lang === "en-US") || vs[0];
    u.pitch   = 0.95; u.rate = 1.05;
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
    const sr = new SR(); sr.interimResults = true;
    sr.onresult = e => {
      if (window.speechSynthesis?.speaking) return;
      let txt = "";
      for (let i = e.resultIndex; i < e.results.length; i++) txt += e.results[i][0].transcript;
      setInput(txt);
    };
    sr.onend = () => {
      setIsListening(false);
      if (voiceRef.current) {
        const cur = inputRef.current || "";
        if (cur.trim() && !loadRef.current && !window.speechSynthesis?.speaking) {
          submitVoiceRef.current?.(cur);
        } else {
          setTimeout(() => {
            if (voiceRef.current && !loadRef.current && !window.speechSynthesis?.speaking) {
              try { recogRef.current?.start(); setIsListening(true); } catch (err) { swallowError(err); }
            }
          }, 800);
        }
      }
    };
    sr.onerror = e => {
      setIsListening(false);
      if (e.error === "not-allowed") { setIsVoiceOpen(false); addToast("⚠️ Microphone access denied", "error"); }
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

  const handleFileChange = e => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) { addToast(`⚠️ File too large (max ${MAX_FILE_SIZE_MB}MB)`, "error"); return; }
    setSelFile(f);
    if (f.type.startsWith("image/")) { const r = new FileReader(); r.onloadend = () => setFilePreview(r.result); r.readAsDataURL(f); }
    else { setFilePreview(null); addToast(`📎 ${f.name} attached`, "success", 2000); }
  };

  const stopGeneration = () => {
    requestIdRef.current += 1;
    abortRef.current?.abort();
    setIsLoading(false); setIsTyping(false); setIsWebSearching(false); setIsYtFetching(false);
    setStreamingContent(""); setIsContinuing(false);
  };

  const insertFmt = (pre, suf = "") => {
    if (!textareaRef.current) return;
    const { selectionStart: s, selectionEnd: e, value: v } = textareaRef.current;
    const sel = v.slice(s, e);
    setInput(v.slice(0, s) + pre + (sel || "text") + suf + v.slice(e));
    setTimeout(() => { if (textareaRef.current) { textareaRef.current.focus(); textareaRef.current.setSelectionRange(s + pre.length, s + pre.length + (sel || "text").length); } }, 0);
  };

  // ── FIX 1: Stream helper — shared SSE reader ──────────────────────────────────
  const readSSEStream = async (reader, onChunk, isActive) => {
    const dec = new TextDecoder();
    let lineBuffer = "";
    let accumulated = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!isActive()) return accumulated;

      lineBuffer += dec.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer  = lines.pop(); // keep incomplete last line

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === "[DONE]") continue;
        try {
          const content = JSON.parse(raw).content;
          if (content) { accumulated += content; onChunk(accumulated); }
        } catch { /* skip malformed chunk */ }
      }
    }

    // Flush remaining buffer
    if (lineBuffer.startsWith("data: ")) {
      const raw = lineBuffer.slice(6).trim();
      if (raw && raw !== "[DONE]") {
        try {
          const content = JSON.parse(raw).content;
          if (content) { accumulated += content; onChunk(accumulated); }
        } catch (err) { swallowError(err); }
      }
    }

    return accumulated;
  };

  // ── FIX 1: Auto-continuation — appends seamlessly to the last message ─────────
  const fetchContinuation = useCallback(async (existingContent, origHist, depth, requestId) => {
    if (depth >= 3) return; // max 3 auto-continuations

    const isActive = () => requestIdRef.current === requestId && !abortRef.current?.signal.aborted;
    if (!isActive()) return;

    setIsContinuing(true);
    setIsLoading(true);

    const contPrompt = "Continue EXACTLY from where you stopped. Output ONLY the continuation — no intro, no repetition, start mid-sentence if needed. Make sure to complete all code blocks and sentences.";
    const contHist   = [
      ...origHist,
      { role: "assistant", content: existingContent },
      { role: "user",      content: contPrompt },
    ];

    const fd = new FormData();
    fd.append("input",    contPrompt);
    fd.append("model",    selectedModeRef.current);

    const ctx = contHist.slice(-12).map(m => ({ role: m.role, content: m.content }));
    const nowISO = new Date().toISOString().slice(0, 10);
    ctx.unshift({
      role: "system",
      content: `Today: ${nowISO}. You are continuing a PREVIOUS response that was cut off. Output ONLY the continuation text starting from where you stopped. CRITICAL: Close any open code fences (\`\`\`) and complete all sentences and lists before ending.`,
    });
    fd.append("messages", JSON.stringify(ctx));

    try {
      const res = await fetch(API + "/chat", {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: fd,
        signal: abortRef.current?.signal,
      });
      if (!isActive() || !res.ok) { setIsLoading(false); setIsContinuing(false); return; }

      const reader = res.body.getReader();
      let fullContent = existingContent;

      await readSSEStream(reader, (accContinuation) => {
        if (!isActive()) return;
        fullContent = existingContent + accContinuation;
        setMessages(prev => {
          const u = [...prev];
          u[u.length - 1] = { ...u[u.length - 1], content: fullContent };
          return u;
        });
        setStreamingContent(fullContent);
        if (!isScrolling.current) scrollToBottom();
      }, isActive);

      setStreamingContent("");
      if (!isActive()) return;
      setIsLoading(false);
      setIsContinuing(false);

      // Recurse if still truncated (and continuation added meaningful content)
      const continuation = fullContent.slice(existingContent.length);
      if (continuation.length > 80 && isLikelyTruncatedAnswer(fullContent)) {
        await fetchContinuation(fullContent, origHist, depth + 1, requestId);
      } else {
        // Final message is clean — trigger follow-ups
        generateFollowUps(fullContent, origHist[origHist.length - 1]?.content || "");
      }
    } catch (err) {
      setIsLoading(false); setIsContinuing(false);
      if (err.name !== "AbortError") swallowError(err);
    }
  }, [scrollToBottom, generateFollowUps]);

  // ── MAIN AI CALL ──────────────────────────────────────────────────────────────
  const triggerAI = async (hist, fileData = null, ytContext = null) => {
    abortRef.current?.abort();
    const ctrl      = new AbortController(); abortRef.current = ctrl;
    const requestId = ++requestIdRef.current;
    const isActive  = () => requestIdRef.current === requestId && !ctrl.signal.aborted;

    setIsLoading(true); setIsTyping(true); scrollToBottom(); stopSpeak();
    setFollowUps([]); setIsContinuing(false);

    const userQuery    = hist[hist.length - 1]?.content || "";
    const curMode      = selectedModeRef.current;
    const isYtMode     = curMode === "youtube";
    const isWebMode    = curMode === "web_search";
    const isDeepSearch = curMode === "deep_search";
    const shouldSearch = isWebMode || isDeepSearch || (autoWebSearchRef.current && needsWebSearch(userQuery));
    const isFirstMsg   = hist.filter(m => m.role === "user").length === 1;

    let webContext = null;
    if (shouldSearch && !ytContext) {
      setIsWebSearching(true);
      webContext = await Promise.race([
        (isDeepSearch ? fetchDeepSearchContext(userQuery) : fetchWebResults(userQuery)),
        new Promise(resolve => setTimeout(() => resolve(null), isDeepSearch ? 9000 : 6000)),
      ]);
      if (!isActive()) return;
      setIsWebSearching(false);
    }

    const memFact = extractMemory(userQuery);
    if (memFact) handleAddMemory(memFact);

    const fd = new FormData();
    fd.append("input", userQuery);
    fd.append("model", (isYtMode || isWebMode || isDeepSearch) ? "fast_chat" : curMode);

    const ctx             = hist.slice(-10).map(m => ({ role: m.role, content: m.content?.slice(0, 4000) }));
    const now             = new Date();
    const nowStr          = now.toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const nowISO          = now.toISOString().slice(0, 10);
    const currentMemories = userInfo?.email ? getMemories(userInfo.email) : [];

    // ── FIX 2D: Improved system prompt ──────────────────────────────────────────
    let sysContent = [
      `TODAY IS: ${nowStr} (${nowISO}). Current year: ${now.getFullYear()}.`,
      `NEVER say an event "hasn't happened yet" if it's plausible given today's date.`,
      currentMemories.length ? `USER CONTEXT:\n${currentMemories.map(m => `• ${m}`).join("\n")}` : "",
      systemPromptRef.current || "",
    ].filter(Boolean).join("\n\n");

    // Mode-specific instructions
    if (curMode === "translator")  sysContent = "You are a professional translator. Detect the language and translate accurately. Provide both literal and natural translations.\n\n" + sysContent;
    if (curMode === "interviewer") sysContent = "You are a professional technical interviewer. Ask challenging questions, evaluate answers, provide feedback. Cover DSA, system design, and behavioral questions.\n\n" + sysContent;

    // FIX 2D: Search-specific instructions — much more directive
    if (shouldSearch && webContext) {
      sysContent += `\n\n${"═".repeat(55)}\n🌐 LIVE SEARCH RESULTS (treat as ground truth — use these as your PRIMARY source):\n${"═".repeat(55)}\n\n${webContext}\n\n${"═".repeat(55)}\n\nCRITICAL SEARCH RULES:\n1. Base your answer DIRECTLY on the search results above — they reflect today's reality.\n2. If a DIRECT ANSWER field is present, use it as your primary answer verbatim.\n3. Quote exact numbers, scores, prices, and dates from the results.\n4. NEVER say "I don't have real-time data" — you DO have it via the results above.\n5. Always cite source URLs (e.g. "Source: <url>") for factual claims.\n6. If results conflict, state both versions and their sources.\n7. Compare dates in results against TODAY (${nowISO}) to identify what is current.`;
    } else if (shouldSearch && !webContext) {
      sysContent += `\n\n⚠️ NOTICE: Web search returned no results for this query. Clearly tell the user your data may be outdated (training cutoff Oct 2024) and suggest they verify from a live source.`;
    }

    if (isDeepSearch) {
      sysContent += "\n\nDeepSearch mode: Synthesize across ALL source packs. Show clear sections, compare conflicting claims, cite a link per major claim. Never cut off code blocks or SQL mid-statement.";
    }

    if (ytContext) {
      sysContent += `\n\n${"━".repeat(50)}\n▶️ YOUTUBE VIDEO:\nTitle: ${ytContext.title}\nChannel: ${ytContext.author}\n\n${ytContext.transcript || "(Transcript unavailable)"}\n${"━".repeat(50)}\n\nGenerate COMPREHENSIVE notes:\n\n## 📋 Video Overview\n## 🔑 Key Points\n## 📚 Detailed Notes\n## 💡 Important Concepts\n## 🎯 Key Takeaways\n## ❓ Possible Quiz Questions\n\nBe thorough, use markdown, include all important details.`;
    }

    // FIX 1: Stronger anti-truncation rule
    sysContent += "\n\n⚡ OUTPUT COMPLETENESS RULE: You MUST finish your entire response in one go. Never end mid-sentence, mid-code-block, mid-SQL statement, or mid-list. Every opened ``` MUST be closed with ```. If your answer is very long, prioritize completing it fully over covering every subtopic.";

    if (sysContent.trim()) ctx.unshift({ role: "system", content: sysContent });
    fd.append("messages", JSON.stringify(ctx));
    if (fileData) fd.append("file", fileData);

    try {
      const res = await fetch(API + "/chat", {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: fd,
        signal: ctrl.signal,
      });
      if (!isActive()) return;
      if (res.status === 401) { logout(); return; }
      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      const reader = res.body.getReader();
      const ts     = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      setIsTyping(false);
      if (!isActive()) return;
      setMessages(prev => [...prev, {
        role: "assistant", content: "", timestamp: ts,
        usedWebSearch: shouldSearch && !!webContext,
        usedYoutube: !!ytContext,
        ytInfo: ytContext ? { title: ytContext.title, author: ytContext.author, videoId: ytContext.videoId } : null,
      }]);

      // Use the shared SSE reader
      const bot = await readSSEStream(reader, (acc) => {
        if (!isActive()) return;
        setMessages(prev => {
          const u = [...prev]; u[u.length - 1] = { ...u[u.length - 1], content: acc }; return u;
        });
        setStreamingContent(acc);
        if (!isScrolling.current) scrollToBottom();
      }, isActive);

      setStreamingContent("");
      if (!isActive()) return;

      // ── FIX 1: Auto-continuation if response was truncated ─────────────────────
      if (bot.length > 150 && isLikelyTruncatedAnswer(bot)) {
        // Don't set isLoading(false) yet — fetchContinuation will manage it
        await fetchContinuation(bot, hist, 0, requestId);
      } else {
        setIsLoading(false);
        if (voiceRef.current || autoSpeak) speak(bot);
        if (isFirstMsg) updateSessionTitle(userQuery);
        generateFollowUps(bot, userQuery);
      }

    } catch (err) {
      setIsLoading(false); setIsTyping(false); setIsWebSearching(false); setIsYtFetching(false);
      setStreamingContent(""); setIsContinuing(false);
      if (err.name !== "AbortError") {
        addToast("⚠️ Error connecting to server. Please try again.", "error");
        setMessages(prev => [...prev, {
          role: "assistant",
          content: "⚠️ I couldn't connect to the server. Please check your connection and try again.",
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        }]);
      }
    } finally { setSelFile(null); setFilePreview(null); }
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

    // Booking intent intercept
    if (detectBookingIntent(text) && !selFile) {
      setShowBooking(true);
      const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setMessages(prev => [...prev, { role: "user", content: text, timestamp: ts }, { role: "assistant", content: "I'd love to help you book a session! 📅 I've opened the booking panel for you — select your preferred service, date, and time.", timestamp: ts }]);
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      return;
    }

    // Image generation intercept
    const imgPrompt = detectImagePrompt(text);
    if (imgPrompt && !selFile) {
      const ts     = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const imgUrl = getImageUrl(imgPrompt);
      const userMsg = { role: "user", content: text, timestamp: ts };
      const botMsg  = {
        role: "assistant",
        content: `Here's your generated image of **"${imgPrompt}"**:\n\n![${imgPrompt}](${imgUrl})\n\n*Powered by Pollinations.ai — [Generate another variation](${getImageUrl(imgPrompt)})*`,
        timestamp: ts, isImageGen: true,
      };
      setMessages(prev => [...prev, userMsg, botMsg]);
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      if (messages.length === 0) updateSessionTitle(text);
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
    const hist = [...messages, { role: "user", content: text, file: selFile ? { preview: filePreview, name: selFile?.name } : null, timestamp: ts }];
    setMessages(hist); setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    triggerAI(hist, selFile);
  };

  const handleKeyDown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!isLoading) sendMessage(); } };

  const submitEdit = idx => {
    if (!editInput.trim()) return; stopSpeak();
    const ts   = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const hist = [...messages.slice(0, idx), { role: "user", content: editInput, timestamp: ts }];
    setMessages(hist); setEditIdx(null); triggerAI(hist);
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
    try { return JSON.parse(localStorage.getItem("vetroai_profile") || '{"name":"","avatar":"🧑"}'); }
    catch { return { name: "", avatar: "🧑" }; }
  });
  const charCount   = input.length;
  const tokenEst    = Math.ceil(charCount / 4);
  const isEmpty     = !input.trim() && !selFile;
  const avatarEl    = <span>{profileData.avatar}</span>;

  // ── AUTH PAGE ──────────────────────────────────────────────────────────────────
  if (!user) return (
    <div className="auth-page">
      <div className="auth-glow" />
      <div className="auth-box">
        <div className="auth-logo">
          <div className="auth-logo-mark">V</div>
          <div className="auth-logo-text">
            <span className="logo-name">VetroAI</span>
            <span className="logo-ver">v2.2</span>
          </div>
        </div>
        <div className="auth-hero">
          <h2 className="auth-headline">{authMode === "login" ? "Welcome back." : "Create account."}</h2>
          <p className="auth-sub">Your intelligent AI assistant — powered by Mistral & live web search.</p>
        </div>
        <form className="auth-form" onSubmit={handleAuthSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {authMode === "signup" && (
            <input className="field-input" type="text" placeholder="Your name" value={authName} onChange={e => setAuthName(e.target.value)} required autoFocus />
          )}
          <input className="field-input" type="email" placeholder="Email address" value={authEmail} onChange={e => setAuthEmail(e.target.value)} required autoFocus={authMode === "login"} />
          <div style={{ position: "relative" }}>
            <input className="field-input" type={showPass ? "text" : "password"} placeholder={authMode === "signup" ? "Password: 8+ chars, 1 uppercase, 1 number" : "Password"} value={authPassword} onChange={e => setAuthPassword(e.target.value)} required minLength={authMode === "signup" ? 8 : 1} style={{ paddingRight: 44 }} />
            <button type="button" onClick={() => setShowPass(v => !v)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--ink-4)", fontSize: "0.85rem" }}>
              {showPass ? "🙈" : "👁️"}
            </button>
          </div>
          {authError && (
            <p style={{ fontSize: "0.82rem", color: authError.includes("✅") ? "#10b981" : "#e76f51", textAlign: "center", margin: "4px 0", padding: "8px", background: authError.includes("✅") ? "rgba(16,185,129,0.08)" : "rgba(231,111,81,0.08)", borderRadius: 8 }}>{authError}</p>
          )}
          <button className="btn-primary" type="submit" disabled={authLoading} style={{ width: "100%", justifyContent: "center", padding: "12px", marginTop: 4 }}>
            {authLoading ? <><div style={{ width: 16, height: 16, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />Please wait…</> : authMode === "login" ? "Sign in →" : "Create account →"}
          </button>
        </form>
        <p style={{ textAlign: "center", fontSize: "0.83rem", color: "var(--ink-3)", marginTop: 12 }}>
          {authMode === "login" ? "Don't have an account? " : "Already have an account? "}
          <button onClick={() => { setAuthMode(authMode === "login" ? "signup" : "login"); setAuthError(""); }} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontWeight: 600, fontSize: "inherit" }}>
            {authMode === "login" ? "Sign up free" : "Sign in"}
          </button>
        </p>
        <div className="auth-features" style={{ marginTop: 24 }}>
          {[["▶️","YouTube notes"],["🌐","Live web search"],["🎨","AI image generation"],["🧠","Memory across chats"],["🧮","Calculator"],["⏱️","Focus timer"]].map(([icon, label]) => (
            <div key={label} className="auth-feat"><span>{icon}</span><span>{label}</span></div>
          ))}
        </div>
        <p className="auth-terms">By signing in, you agree to use VetroAI responsibly.</p>
      </div>
    </div>
  );

  // ── MAIN UI ────────────────────────────────────────────────────────────────────
  return (
    <div className="shell">
      <Toast toasts={toasts} />

      {showProfile   && <ProfileModal onClose={() => setShowProfile(false)} t={t} langCode={langCode} setLangCode={setLangCode} theme={theme} setTheme={setTheme} userInfo={userInfo} onProfileSaved={setProfileData} />}
      {showSysPrompt && <SysPromptModal onClose={() => setShowSysPrompt(false)} t={t} value={systemPrompt} setValue={setSystemPrompt} />}
      {showShare     && messages.length > 0 && <ShareModal onClose={() => setShowShare(false)} t={t} messages={messages} />}
      {showBookmarks && <BookmarksPanel bookmarks={bookmarks} onSelect={msg => setInput(msg.content)} onRemove={removeBookmark} onClose={() => setShowBookmarks(false)} t={t} />}
      {showMemory    && <MemoryPanel memories={memories} onClear={clearAllMemory} onRemove={removeMemoryItem} onClose={() => setShowMemory(false)} t={t} />}
      {showCalc      && <CalcWidget onClose={() => setShowCalc(false)} />}
      {showTimer     && <FocusTimer onClose={() => setShowTimer(false)} />}
      {showBooking   && <BookingWidget onClose={() => setShowBooking(false)} onBooked={(b) => addToast(`✅ Booked: ${b.service.name} — ${b.id}`, "success", 4000)} />}
      {showBookingHistory && <BookingHistory onClose={() => setShowBookingHistory(false)} />}
      {showScratchpad && <ScratchpadWidget onClose={() => setShowScratchpad(false)} />}
      {showPlayground && <CodePlayground onClose={() => setShowPlayground(false)} />}
      {showStats     && <StatsPanel onClose={() => setShowStats(false)} sessions={sessions} bookings={getBookings()} />}
      {confirmDelete && <ConfirmDialog message={confirmDelete.message} onConfirm={confirmDeleteSession} onCancel={() => setConfirmDelete(null)} />}

      {/* VOICE */}
      {isVoiceOpen && (
        <div className="voice-page">
          <button className="voice-close" onClick={closeVoice}><XIcon /></button>
          <div className="voice-rings">
            <div className={`vring r1${isListening ? " on" : ""}`} />
            <div className={`vring r2${isListening ? " on" : ""}`} />
            <div className={`vring r3${isListening ? " on" : ""}`} />
          </div>
          <div className={`vorb${isListening ? " listening" : isLoading ? " loading" : " speaking"}`} onClick={handleOrb}>
            {isLoading ? "⏳" : isListening ? <MicIcon /> : <WaveIcon />}
          </div>
          <p className="voice-label">{isListening ? t.voiceListen : isLoading ? t.voiceThink : t.voiceSpeak}</p>
          <p className="voice-hint">{isListening ? t.tapStop : isLoading ? t.tapWait : t.tapInterrupt}</p>
          <p className="voice-transcript">{input || "…"}</p>
        </div>
      )}

      {isSidebarOpen && <div className="sb-overlay" onClick={() => setIsSidebarOpen(false)} />}

      {/* SIDEBAR */}
      <aside className={`sidebar${isSidebarOpen ? " open" : ""}`}>
        <div className="sb-head">
          <div className="sb-logo">
            <div className="sb-mark">V</div>
            <span className="sb-name">VetroAI</span>
          </div>
          <div className="sb-head-actions">
            <button className="icon-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title="Toggle theme">
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            </button>
            <button className="icon-btn av-btn" onClick={() => setShowProfile(true)} title={t.profile}>{avatarEl}</button>
          </div>
        </div>

        {userInfo && (
          <div className="sb-user">
            <div className="sb-user-initials">{(userInfo.name || "?")[0].toUpperCase()}</div>
            <div className="sb-user-info">
              <span className="sb-user-name">{userInfo.name || "User"}</span>
              <span className="sb-user-email">{userInfo.email || ""}</span>
            </div>
          </div>
        )}

        <button className="new-btn" onClick={newChat}><PlusIcon />{t.newChat}</button>

        <div className="sb-search">
          <SearchIcon />
          <input placeholder={t.search} value={histSearch} onChange={e => setHistSearch(e.target.value)} />
          {histSearch && <button style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-4)", padding: 0 }} onClick={() => setHistSearch("")}>✕</button>}
        </div>

        <nav className="history">
          {pinnedSessions.length > 0 && (
            <>
              <div className="hist-label">📌 {t.pinnedSection}</div>
              {pinnedSessions.map(s => (
                <div key={s.id} className={`hist-item${s.id === currentSessionId ? " active" : ""}`} onClick={() => loadSession(s.id)}>
                  <span className="hist-title">{s.title}</span>
                  <div className="hist-actions">
                    <button onClick={e => togglePin(e, s.id)} title={t.unpin}><PinIcon /></button>
                    <button onClick={e => { e.stopPropagation(); deleteSession(s.id); }} className="del-btn" title={t.del}><TrashIcon /></button>
                  </div>
                </div>
              ))}
            </>
          )}
          {dateOrder.map(group => groupedSessions[group]?.length > 0 && (
            <React.Fragment key={group}>
              <div className="hist-label">{group}</div>
              {groupedSessions[group].map(s => (
                <div key={s.id} className={`hist-item${s.id === currentSessionId ? " active" : ""}`} onClick={() => loadSession(s.id)}>
                  <span className="hist-title">{s.title}</span>
                  <div className="hist-actions">
                    <button onClick={e => togglePin(e, s.id)} title={t.pin}><PinIcon /></button>
                    <button onClick={e => { e.stopPropagation(); deleteSession(s.id); }} className="del-btn" title={t.del}><TrashIcon /></button>
                  </div>
                </div>
              ))}
            </React.Fragment>
          ))}
          {sessions.length === 0 && (
            <div className="hist-empty"><span>💬</span><p>No conversations yet</p></div>
          )}
          {sessions.length > 0 && histSearch && Object.values(groupedSessions).every(g => !g?.length) && pinnedSessions.length === 0 && (
            <div className="hist-empty"><span>🔍</span><p>No matching chats</p></div>
          )}
        </nav>

        <div className="sb-foot">
          <div className="sb-quick-row">
            <button className="sb-quick-btn" onClick={() => setShowBookmarks(true)} title={t.bookmarks}>
              <BookmarkIcon /><span>{t.bookmarks}</span>
              {bookmarks.length > 0 && <span className="sb-badge">{bookmarks.length}</span>}
            </button>
            <button className="sb-quick-btn" onClick={() => setShowMemory(true)} title={t.memories}>
              <BrainIcon /><span>{t.memories}</span>
              {memories.length > 0 && <span className="sb-badge">{memories.length}</span>}
            </button>
            <button className="sb-quick-btn" onClick={() => setShowCalc(true)} title="Calculator">
              <CalcIcon /><span>Calc</span>
            </button>
            <button className="sb-quick-btn" onClick={() => setShowTimer(true)} title="Focus Timer">
              <TimerIcon /><span>Timer</span>
            </button>
          </div>
          <div className="sb-quick-row">
            <button className="sb-quick-btn" onClick={() => setShowBooking(true)} title="Book Session" style={{ color: "var(--accent)" }}>
              <CalendarIcon /><span>Book</span>
            </button>
            <button className="sb-quick-btn" onClick={() => setShowBookingHistory(true)} title="My Bookings">
              <CalendarIcon /><span>History</span>
            </button>
            <button className="sb-quick-btn" onClick={() => setShowScratchpad(true)} title="Scratchpad">
              <NoteIcon /><span>Notes</span>
            </button>
            <button className="sb-quick-btn" onClick={() => setShowStats(true)} title="Stats">
              <ChartIcon /><span>Stats</span>
            </button>
          </div>

          <div className="mode-row" style={{ cursor: "pointer" }} onClick={() => setAutoWebSearch(v => !v)}>
            <GlobeIcon />
            <span style={{ flex: 1, fontSize: "0.82rem", color: "var(--ink)" }}>Auto Web Search</span>
            <div className={`toggle-pill${autoWebSearch ? " on" : ""}`}><div className="toggle-thumb" /></div>
          </div>

          <div className="mode-row">
            <BotIcon />
            <select value={selectedMode} onChange={e => setSelectedMode(e.target.value)}>
              {MODES.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <ChevDown />
          </div>
          <button className="signout-btn" onClick={logout}>{t.logout}</button>
        </div>
      </aside>

      {/* CHAT AREA */}
      <main className="chat">
        <header className="chat-header">
          <div className="ch-left">
            <button className="icon-btn mobile-only" onClick={() => setIsSidebarOpen(true)}><MenuIcon /></button>
            <div className={`mode-pill${isWebMode || isDeepSearch ? " web-mode-pill" : isYtMode ? " yt-mode-pill" : ""}`}>
              {MODES.find(m => m.id === selectedMode)?.name}
              {(isWebMode || isDeepSearch) && <span className="web-live-dot" />}
              {isYtMode && <span className="web-live-dot" style={{ background: "#ff0000" }} />}
            </div>
            {autoWebSearch && !isWebMode && !isDeepSearch && !isYtMode && (
              <div className="mode-pill" style={{ fontSize: "0.7rem", gap: 4, opacity: 0.7 }}>
                <GlobeIcon /> Auto
              </div>
            )}
            {/* FIX 1: Show "Expanding answer…" indicator during auto-continuation */}
            {isContinuing && (
              <div className="mode-pill" style={{ fontSize: "0.7rem", gap: 4, color: "var(--accent)", background: "rgba(var(--accent-rgb),0.1)" }}>
                <WebSpinIcon /> Expanding answer…
              </div>
            )}
          </div>
          <div className="ch-right">
            <button className="icon-btn" onClick={() => setShowCalc(true)} title="Calculator"><CalcIcon /></button>
            <button className="icon-btn" onClick={() => setShowTimer(true)} title="Focus Timer"><TimerIcon /></button>
            <button className="icon-btn" onClick={() => setChatSearchOpen(v => !v)} title="Search (Ctrl+F)"><SearchIcon /></button>
            <button className="icon-btn" onClick={() => setShowSysPrompt(true)} title="Instructions"><BotIcon /></button>
            <button className="icon-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title="Toggle theme">
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            </button>
            {messages.length > 0 && (
              <button className="share-btn" onClick={() => setShowShare(true)}><ShareIcon /><span>{t.share}</span></button>
            )}
          </div>
        </header>

        {(isWebSearching || isYtFetching) && (
          <div className="web-searching-bar" style={isYtFetching ? { background: "rgba(255,0,0,0.06)", borderColor: "rgba(255,0,0,0.15)" } : {}}>
            <WebSpinIcon />
            <span>{isYtFetching ? t.ytAnalyzing : "Searching web + fetching page content…"}</span>
            <div className="web-search-dots"><span /><span /><span /></div>
          </div>
        )}

        {chatSearchOpen && (
          <div className="chat-search">
            <SearchIcon />
            <input ref={searchInputRef} placeholder={t.searchInChat} value={chatSearchQuery}
              onChange={e => { setChatSearchQuery(e.target.value); setChatSearchCursor(0); }}
              onKeyDown={e => {
                if (e.key === "Enter" || e.key === "ArrowDown") setChatSearchCursor(c => (c + 1) % Math.max(chatSearchResults.length, 1));
                if (e.key === "ArrowUp") setChatSearchCursor(c => (c - 1 + chatSearchResults.length) % Math.max(chatSearchResults.length, 1));
              }} />
            {chatSearchQuery && <span className="search-count">
              {chatSearchResults.length > 0 ? `${(chatSearchCursor % chatSearchResults.length) + 1}/${chatSearchResults.length}` : t.noResults}
            </span>}
            <button onClick={() => { setChatSearchOpen(false); setChatSearchQuery(""); }}><XIcon /></button>
          </div>
        )}

        {/* MESSAGE FEED */}
        <div className="feed" ref={feedRef} onScroll={handleScroll}>
          {messages.length === 0 && (
            <div className="welcome">
              <div className="welcome-avatar">V</div>
              <h2 className="welcome-title">
                {userInfo?.name ? `Hi, ${userInfo.name.split(" ")[0]}! 👋` : t.welcome}
              </h2>
              <p className="welcome-sub">{t.welcomeSub}</p>
              {systemPrompt && <div className="sys-badge"><BotIcon />{t.systemPromptBadge}</div>}
              {isWebMode && (
                <div className="sys-badge" style={{ background: "rgba(59,130,246,0.1)", borderColor: "rgba(59,130,246,0.25)", color: "#3b82f6" }}>
                  <GlobeIcon /> Web Search Mode — Live results + page content fetching
                </div>
              )}
              {isDeepSearch && (
                <div className="sys-badge" style={{ background: "rgba(37,99,235,0.11)", borderColor: "rgba(37,99,235,0.30)", color: "#1d4ed8" }}>
                  <GlobeIcon /> DeepSearch Mode — multi-query research with richer synthesis
                </div>
              )}
              {isYtMode && (
                <div className="sys-badge" style={{ background: "rgba(255,0,0,0.07)", borderColor: "rgba(255,0,0,0.2)", color: "#ff0000" }}>
                  <YTIcon /> YouTube Mode — Paste any YouTube URL for instant notes
                </div>
              )}
              <div className="welcome-cards">
                {[
                  { icon: "📅", label: "Book a Session", sub: "Schedule tutoring & more", action: () => setShowBooking(true) },
                  { icon: "▶️", label: "YouTube Notes", sub: "Paste any YouTube URL", action: () => setSelectedMode("youtube") },
                  { icon: "🎨", label: "Image Generation", sub: "Create AI images free", action: () => setInput("Generate an image of ") },
                  { icon: "🌐", label: "Live Web Search", sub: "Real-time Google results", action: () => { setAutoWebSearch(true); setInput("Latest news today"); } },
                  { icon: "🧠", label: "DeepSearch", sub: "Multi-query deep research", action: () => { setSelectedMode("deep_search"); setInput("Analyze latest AI model trends with sources"); } },
                  { icon: "🐛", label: "Code Debugger", sub: "Fix bugs instantly", action: () => setSelectedMode("debugger") },
                  { icon: "🧪", label: "Code Playground", sub: "Run code live", action: () => setShowPlayground(true) },
                  { icon: "📝", label: "Scratchpad", sub: "Quick notes & ideas", action: () => setShowScratchpad(true) },
                  { icon: "📊", label: "Your Stats", sub: "Chat analytics", action: () => setShowStats(true) },
                ].map(({ icon, label, sub, action }) => (
                  <div key={label} className="welcome-card" onClick={action}>
                    <span className="wcard-icon">{icon}</span>
                    <span className="wcard-label">{label}</span>
                    <span className="wcard-sub">{sub}</span>
                  </div>
                ))}
              </div>
              <div className="suggestions">
                {suggestionOptions.slice(0, 6).map((s, i) => (
                  <button key={i} className="sug" style={{ "--d": `${i * 0.06}s` }} onClick={() => sendMessage(null, s)}>{s}</button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, idx) => {
            const highlighted     = chatSearchQuery && chatSearchResults.includes(idx);
            const msgRxns         = reactions[idx] || [];
            const isLastAssistant = msg.role === "assistant" && idx === messages.length - 1 && !isLoading;
            const showFollowUps   = isLastAssistant && (followUps.length > 0 || followUpsLoading);
            const vidId           = msg.ytVideoId;
            const vidInfo         = vidId ? (ytVideoData[vidId] || {}) : null;
            const feedback        = msgFeedback[idx];

            return (
              <div key={idx} className={`msg ${msg.role} msg-${idx}${highlighted ? " hl" : ""}`}>
                {msg.role === "assistant" && <div className="msg-av bot-av">V</div>}
                <div className="msg-body">
                  {msg.role === "user" && editIdx === idx ? (
                    <div className="edit-box">
                      <textarea autoFocus value={editInput} onChange={e => setEditInput(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitEdit(idx); } }} />
                      <div className="edit-actions">
                        <button className="btn-ghost sm" onClick={() => setEditIdx(null)}>{t.cancel}</button>
                        <button className="btn-primary sm" onClick={() => submitEdit(idx)}>{t.saveAndSend}</button>
                      </div>
                    </div>
                  ) : (
                    <div className="bubble">
                      {msg.file?.preview && <img src={msg.file.preview} alt="" className="att-img" />}
                      {msg.file?.name && !msg.file.preview && (
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px", fontSize: "0.8rem", marginBottom: 10, color: "var(--ink-2)" }}>
                          📎 {msg.file.name}
                        </div>
                      )}
                      {vidId && vidInfo && (
                        <YouTubeEmbed videoId={vidId} title={vidInfo.title || "YouTube Video"} author={vidInfo.author || ""} />
                      )}
                      {msg.role === "assistant" && msg.usedWebSearch && (
                        <div className="web-search-badge used"><GlobeIcon /> {t.webSearched}</div>
                      )}
                      {msg.role === "assistant" && msg.usedYoutube && (
                        <div className="web-search-badge" style={{ color: "#ff0000", background: "rgba(255,0,0,0.06)", borderColor: "rgba(255,0,0,0.18)" }}>
                          <YTIcon /> {msg.ytInfo?.title ? `Notes: ${msg.ytInfo.title.slice(0, 40)}` : t.ytNotes}
                        </div>
                      )}
                      {msg.role === "assistant" && msg.isImageGen && (
                        <div className="web-search-badge" style={{ color: "#8b5cf6", background: "rgba(139,92,246,0.08)", borderColor: "rgba(139,92,246,0.2)" }}>
                          <ImageIcon /> AI Generated Image
                        </div>
                      )}
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
                        components={{
                          code({ inline, className, children }) {
                            const match = /language-(\w+)/.exec(className || "");
                            const str   = String(children).replace(/\n$/, "");
                            return !inline && match
                              ? <CodeBlock match={match} codeString={str} copyLabel={t.copy} />
                              : <code className="icode">{children}</code>;
                          },
                          img({ src, alt }) { return <img src={src} alt={alt || ""} className="gen-image" loading="lazy" />; },
                          a({ href, children }) { return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>; },
                        }}>
                        {formatMath(msg.content)}
                      </ReactMarkdown>
                    </div>
                  )}

                  {showFollowUps && (
                    <FollowUpChips suggestions={followUps} loading={followUpsLoading} onSelect={s => sendMessage(null, s)} />
                  )}

                  {msgRxns.length > 0 && (
                    <div className="rxn-bar">
                      {msgRxns.map(r => <button key={r} className="rxn-badge" onClick={() => removeRxn(idx, r)}>{r}</button>)}
                    </div>
                  )}

                  {editIdx !== idx && (
                    <div className="msg-actions">
                      <span className="ts">{msg.timestamp}</span>
                      <div className="act-btns">
                        {msg.role === "assistant" && !isLoading && (
                          <>
                            <button onClick={() => speak(msg.content)} title={t.readAloud}><SpeakIcon /></button>
                            <button onClick={() => { navigator.clipboard.writeText(msg.content); addToast("Copied!", "success", 1500); }} title={t.copy}><CopyIcon /></button>
                            <button onClick={() => handleRegen(idx)} title={t.regen}><ReloadIcon /></button>
                            {/* FIX 1: Keep manual continue as fallback */}
                            {isLikelyTruncatedAnswer(msg.content) && (
                              <button onClick={() => requestContinuation(idx)} title="Manually continue answer" style={{ color: "var(--accent)" }}>⤵️</button>
                            )}
                            <button onClick={() => handleFeedback(idx, "up")} title="Good response" style={{ color: feedback === "up" ? "#10b981" : undefined }}><ThumbsUpIcon /></button>
                            <button onClick={() => handleFeedback(idx, "down")} title="Bad response" style={{ color: feedback === "down" ? "#e05454" : undefined }}><ThumbsDnIcon /></button>
                          </>
                        )}
                        {msg.role === "user" && !isLoading && (
                          <>
                            <button onClick={() => { setEditIdx(idx); setEditInput(msg.content); }} title={t.edit}><EditIcon /></button>
                            <button onClick={() => { navigator.clipboard.writeText(msg.content); addToast("Copied!", "success", 1500); }} title={t.copy}><CopyIcon /></button>
                          </>
                        )}
                        <button onClick={() => toggleBookmark(msg)} title={t.bookmarks} style={{ color: isBookmarked(msg) ? "#e76f51" : undefined }}>
                          <BookmarkIcon />
                        </button>
                        <div style={{ position: "relative" }}>
                          <button onClick={e => { e.stopPropagation(); setRxnFor(rxnFor === idx ? null : idx); }}><SmileIcon /></button>
                          {rxnFor === idx && <ReactionPicker onPick={r => addRxn(idx, r)} onClose={() => setRxnFor(null)} />}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                {msg.role === "user" && <div className="msg-av user-av">{profileData.avatar}</div>}
              </div>
            );
          })}

          {isTyping && (
            <div className="msg assistant">
              <div className="msg-av bot-av">V</div>
              <div className="msg-body">
                <TypingIndicator text={isWebSearching ? "Searching + fetching content…" : isYtFetching ? "Analyzing video…" : ""} />
              </div>
            </div>
          )}
          <div style={{ height: 20 }} />
        </div>

        {showScrollDn && (
          <button className="scroll-btn" onClick={scrollToBottom} title="Scroll to bottom">↓</button>
        )}

        {/* INPUT AREA */}
        <div className="input-area">
          {systemPrompt && (
            <div className="sys-strip">
              <BotIcon /><span>{t.systemPromptBadge}: {systemPrompt.slice(0, 55)}{systemPrompt.length > 55 ? "…" : ""}</span>
              <button onClick={() => setSystemPrompt("")}>✕</button>
            </div>
          )}
          {isYtMode && (
            <div className="sys-strip" style={{ background: "rgba(255,0,0,0.06)", borderColor: "rgba(255,0,0,0.18)", color: "#cc0000" }}>
              <YTIcon /><span>YouTube Mode — Paste a YouTube URL to get detailed notes & analysis</span>
            </div>
          )}
          {isWebMode && (
            <div className="sys-strip" style={{ background: "rgba(59,130,246,0.08)", borderColor: "rgba(59,130,246,0.2)", color: "#3b82f6" }}>
              <GlobeIcon /><span>Web Search Mode — fetching live results + page content for accuracy</span>
            </div>
          )}
          {memories.length > 0 && (
            <div className="sys-strip" style={{ background: "rgba(16,185,129,0.07)", borderColor: "rgba(16,185,129,0.2)", color: "#10b981", cursor: "pointer" }} onClick={() => setShowMemory(true)}>
              <BrainIcon /><span>{memories.length} memor{memories.length === 1 ? "y" : "ies"} active — VetroAI remembers facts about you</span>
            </div>
          )}
          {input.length > 0 && (
            <div className="fmt-bar">
              <button onClick={() => insertFmt("**", "**")} title="Bold"><BoldIcon /></button>
              <button onClick={() => insertFmt("_", "_")} title="Italic"><ItalicIcon /></button>
              <button onClick={() => insertFmt("`", "`")} title="Inline code"><CodeIc2 /></button>
              <button onClick={() => insertFmt("\n```\n", "\n```")} title="Code block" style={{ fontSize: "0.72rem", padding: "5px 8px" }}>Block</button>
              <div className="fmt-sep" />
              <span className="counter">{charCount} {t.chars} · ~{tokenEst} {t.tokens}</span>
            </div>
          )}
          <form className="input-box" onSubmit={sendMessage}>
            <input type="file" ref={fileInputRef} style={{ display: "none" }} onChange={handleFileChange} accept="image/*,application/pdf,.txt,.csv,.js,.py,.jsx,.ts,.tsx,.json,.md" />
            {filePreview && (
              <div className="file-prev">
                <img src={filePreview} alt="" />
                <button type="button" onClick={() => { setSelFile(null); setFilePreview(null); }}>✕</button>
              </div>
            )}
            {selFile && !filePreview && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", background: "var(--bg-hover)", borderRadius: 8, fontSize: "0.78rem", color: "var(--ink-2)", flexShrink: 0, marginBottom: 4 }}>
                📎 {selFile.name}
                <button type="button" onClick={() => { setSelFile(null); setFilePreview(null); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-4)", padding: 0, fontSize: "0.75rem" }}>✕</button>
              </div>
            )}
            <button type="button" className="attach-btn" onClick={() => fileInputRef.current.click()} title="Attach file">📎</button>
            <textarea ref={textareaRef}
              placeholder={
                isListening && !isVoiceOpen ? t.listening :
                isYtMode     ? "Paste a YouTube URL here (e.g. https://youtube.com/watch?v=...)…" :
                isDeepSearch ? "DeepSearch: ask a research question (I will query multiple angles)..." :
                isWebMode    ? "Search the web with AI — I fetch real page content…" :
                               'Message VetroAI… (try "generate an image of…")'
              }
              value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown} disabled={isLoading} rows={1} />
            <div className="input-actions">
              {isLoading
                ? <button type="button" className="stop-btn" onClick={stopGeneration} title="Stop generating"><StopIcon /></button>
                : isEmpty
                  ? <>
                    <button type="button" className={`mic-btn${isListening && !isVoiceOpen ? " active" : ""}`} onClick={toggleMic} title="Toggle mic"><MicIcon /></button>
                    <button type="button" className="wave-btn" onClick={openVoice} title="Voice mode"><WaveIcon /></button>
                  </>
                  : <button type="submit" className={`send-btn${isWebMode || isDeepSearch ? " web-send" : isYtMode ? " yt-send" : ""}`} title={t.send}><SendIcon /></button>}
            </div>
          </form>
          <p className="input-note">
            VetroAI can make mistakes.&nbsp;
            {isYtMode     ? "YouTube mode uses video transcripts — accuracy depends on transcript availability." :
             isDeepSearch ? "DeepSearch combines multiple web queries; cross-check cited sources for critical decisions." :
             isWebMode    ? "Web mode fetches live data and page content — verify important info." :
                            "Please verify important information."}
          </p>
        </div>
      </main>
    </div>
  );
}