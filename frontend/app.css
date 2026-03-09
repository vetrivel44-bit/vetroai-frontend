import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import "./App.css";

const API = "https://ai-chatbot-backend-gvvz.onrender.com";
const GOOGLE_CLIENT_ID = "400551503818-2hsl83cdavo9usj0t7si0jmnjapful4i.apps.googleusercontent.com";
const SERPER_API_KEY = "19caba58c08177639d61cabf7e5430278044545f";

const TODAY_STR = new Date().toLocaleDateString("en-IN", {
  weekday: "long", year: "numeric", month: "long", day: "numeric",
});

// ─── YOUTUBE HELPERS ──────────────────────────────────────────────────────────
const YOUTUBE_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:(?:youtube\.com\/watch\?v=)|(?:youtu\.be\/)|(?:youtube\.com\/embed\/)|(?:youtube\.com\/shorts\/))([a-zA-Z0-9_-]{11})/;

const extractVideoId = (text) => {
  const m = text.match(YOUTUBE_REGEX);
  return m ? m[1] : null;
};

const fetchYouTubeInfo = async (videoId) => {
  try {
    const r = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
    const d = await r.json();
    return {
      title: d.title || "YouTube Video",
      author: d.author_name || "",
      thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      videoId,
    };
  } catch { return { title: "YouTube Video", author: "", thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`, videoId }; }
};

const fetchYouTubeTranscript = async (videoId) => {
  // Try primary endpoint
  try {
    const r = await fetch("https://api.kome.ai/api/tools/youtube-transcripts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video_id: videoId, format: true }),
      signal: AbortSignal.timeout(10000),
    });
    if (r.ok) {
      const d = await r.json();
      if (d.transcript) return d.transcript;
    }
  } catch { /* try next */ }

  // Try secondary endpoint
  try {
    const r2 = await fetch(`https://transcr-ibe6fxe9g8e9a2fy.centralindia-01.azurewebsites.net/transcript?id=${videoId}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (r2.ok) {
      const d2 = await r2.json();
      if (Array.isArray(d2)) return d2.map(t => t.text).join(" ");
    }
  } catch { /* try next */ }

  // Fallback: use Serper to search for video content
  try {
    const r3 = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: `youtube.com/watch?v=${videoId} transcript summary`, num: 5 }),
      signal: AbortSignal.timeout(8000),
    });
    const d3 = await r3.json();
    const snippets = d3.organic?.map(r => `${r.title}: ${r.snippet}`).join("\n") || "";
    return snippets || null;
  } catch { return null; }
};

// ─── YOUTUBE EMBED COMPONENT ──────────────────────────────────────────────────
function YouTubeEmbed({ videoId, title, author }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="yt-embed">
      {expanded ? (
        <iframe
          width="100%" height="280"
          src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`}
          title={title} frameBorder="0" allowFullScreen
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          style={{ borderRadius: 10, display: "block" }}
        />
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
        <svg width="14" height="14" viewBox="0 0 24 24" fill="red"><path d="M21.8 8s-.2-1.4-.8-2c-.8-.8-1.6-.8-2-.9C16.3 5 12 5 12 5s-4.3 0-7 .1c-.4.1-1.2.1-2 .9-.6.6-.8 2-.8 2S2 9.6 2 11.2v1.5c0 1.6.2 3.2.2 3.2s.2 1.4.8 2c.8.8 1.8.8 2.2.8C6.6 19 12 19 12 19s4.3 0 7-.1c.4-.1 1.2-.1 2-.9.6-.6.8-2 .8-2s.2-1.6.2-3.2v-1.5C22 9.6 21.8 8 21.8 8z"/><polygon points="10,8 10,16 16,12" fill="white"/></svg>
        <span className="yt-title-text">{title}</span>
        {author && <span className="yt-author">· {author}</span>}
      </div>
    </div>
  );
}

// ─── CALCULATOR WIDGET ────────────────────────────────────────────────────────
function CalcWidget({ onClose }) {
  const [expr, setExpr]   = useState("");
  const [result, setResult] = useState("");
  const [hist, setHist]   = useState([]);

  const calc = (e) => {
    e.preventDefault();
    if (!expr.trim()) return;
    try {
      // Safe eval using Function
      const cleaned = expr.replace(/×/g, "*").replace(/÷/g, "/").replace(/\^/g, "**");
      // eslint-disable-next-line no-new-func
      const res = Function(`"use strict"; return (${cleaned})`)();
      const entry = `${expr} = ${res}`;
      setResult(String(res));
      setHist(h => [entry, ...h.slice(0, 9)]);
    } catch {
      setResult("Error");
    }
  };

  const btn = (v) => {
    if (v === "C") { setExpr(""); setResult(""); return; }
    if (v === "⌫") { setExpr(e => e.slice(0, -1)); return; }
    if (v === "=") { calc({ preventDefault: () => {} }); return; }
    setExpr(e => e + v);
  };

  const rows = [
    ["C", "⌫", "^", "÷"],
    ["7", "8", "9", "×"],
    ["4", "5", "6", "-"],
    ["1", "2", "3", "+"],
    ["0", ".", "(", ")"],
    ["="],
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
                  <button key={v} className={`calc-btn${v === "=" ? " eq" : ["C","⌫"].includes(v) ? " fn" : ["÷","×","-","+","^"].includes(v) ? " op" : ""}`}
                    onClick={() => btn(v)}>{v}</button>
                ))}
              </div>
            ))}
          </div>
          {hist.length > 0 && (
            <div className="calc-hist">
              <div className="calc-hist-label">History</div>
              {hist.map((h, i) => <div key={i} className="calc-hist-item">{h}</div>)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── FOCUS MODE TIMER ─────────────────────────────────────────────────────────
function FocusTimer({ onClose }) {
  const [mins, setMins]     = useState(25);
  const [secs, setSecs]     = useState(0);
  const [running, setRunning] = useState(false);
  const [mode, setMode]     = useState("focus"); // focus | short | long
  const tick = useRef(null);

  const MODES_T = { focus: [25, "🎯 Focus"], short: [5, "☕ Short Break"], long: [15, "🌿 Long Break"] };

  const reset = (m) => {
    setMode(m); setRunning(false); clearInterval(tick.current);
    setMins(MODES_T[m][0]); setSecs(0);
  };

  useEffect(() => {
    if (running) {
      tick.current = setInterval(() => {
        setSecs(s => {
          if (s === 0) {
            setMins(m => {
              if (m === 0) { clearInterval(tick.current); setRunning(false); if (window.Notification?.permission === "granted") new Notification("VetroAI Timer ✅", { body: "Session complete!" }); return 0; }
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
          <div style={{ display: "flex", gap: 8 }}>
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
          <div style={{ display: "flex", gap: 12 }}>
            <button className="btn-primary" onClick={() => setRunning(v => !v)}>
              {running ? "⏸ Pause" : "▶ Start"}
            </button>
            <button className="btn-ghost" onClick={() => reset(mode)}>↺ Reset</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── WEB SEARCH ───────────────────────────────────────────────────────────────
const CURRENT_TRIGGERS = [
  /\b(today|tonight|now|current|currently|live|latest|recent|breaking|news)\b/i,
  /\b(2024|2025|2026|this (year|month|week|day))\b/i,
  /\b(who (is|was|won|leads|runs)|what is the (score|price|rate|status))\b/i,
  /\b(stock|crypto|bitcoin|market|weather|election|war|match|game|ipl|cricket|football)\b/i,
  /\b(just (happened|announced|released|launched))\b/i,
  /\b(trending|viral|happening)\b/i,
];
const needsWebSearch = (q) => CURRENT_TRIGGERS.some(rx => rx.test(q));

const fetchWebResults = async (query) => {
  const snippets = [];
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, gl: "in", hl: "en", num: 8 }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();

    if (data.answerBox) {
      const ab = data.answerBox;
      const ans = ab.answer || ab.snippet || ab.snippetHighlighted?.join(" ") || "";
      if (ans) snippets.push(`✅ **Google Answer**:\n${ans}${ab.link ? `\n🔗 ${ab.link}` : ""}`);
    }
    if (data.knowledgeGraph) {
      const kg = data.knowledgeGraph;
      let t = `📊 **${kg.title || ""}**${kg.type ? ` — ${kg.type}` : ""}`;
      if (kg.description) t += `\n${kg.description}`;
      if (kg.attributes) t += "\n" + Object.entries(kg.attributes).slice(0, 5).map(([k, v]) => `• **${k}**: ${v}`).join("\n");
      snippets.push(t);
    }
    if (data.sportsResults) {
      const sr = data.sportsResults;
      let t = `🏆 **${sr.title || "Sports"}**\n`;
      t += sr.games?.length
        ? sr.games.slice(0, 5).map(g => `• ${g.homeTeam} **${g.homeScore ?? ""}** vs ${g.awayTeam} **${g.awayScore ?? ""}** ${g.status ? `— ${g.status}` : ""} ${g.date ? `(${g.date})` : ""}`).join("\n")
        : "(see results below)";
      snippets.push(t);
    }
    if (data.topStories?.length) {
      snippets.push(`📰 **Top Stories**:\n` + data.topStories.slice(0, 5).map(s => `• **${s.title}** — ${s.source || ""} (${s.date || ""})\n  🔗 ${s.link || ""}`).join("\n"));
    }
    if (data.organic?.length) {
      snippets.push(`🌐 **Results for "${query}"**:\n\n` + data.organic.slice(0, 6).map((r, i) => `**${i + 1}. ${r.title}**\n${r.snippet || ""}\n🔗 ${r.link || ""}`).join("\n\n"));
    }
    if (data.peopleAlsoAsk?.length) {
      snippets.push(`💡 **Related**:\n\n` + data.peopleAlsoAsk.slice(0, 3).map(p => `**Q: ${p.question}**\n${p.snippet || ""}`).join("\n\n"));
    }
  } catch (err) {
    console.error("Serper:", err.message);
    return null;
  }
  if (!snippets.length) return null;
  snippets.unshift(`📅 **Search on**: ${TODAY_STR}`);
  return snippets.join("\n\n---\n\n");
};

// ─── IMAGE GENERATION ─────────────────────────────────────────────────────────
const IMAGE_DETECT = /\b(generate|create|make|draw|paint|design|render|show me)\b.{0,40}\b(image|picture|photo|artwork|illustration|portrait|sketch|logo|wallpaper|icon)\b/i;
const detectImagePrompt = (text) => {
  if (!IMAGE_DETECT.test(text)) return null;
  return text.replace(/^.*(generate|create|make|draw|paint|design|render|show me)\s+(an?\s+|the\s+)?(image|picture|photo|artwork|illustration|portrait|sketch|logo|wallpaper|icon)\s+(of\s+)?/i, "").trim() || text;
};
const getImageUrl = (prompt) =>
  `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=768&height=512&nologo=true&seed=${Math.floor(Math.random() * 99999)}`;

// ─── MEMORY SYSTEM ────────────────────────────────────────────────────────────
const MEMORY_PATTERNS = [
  { rx: /remember (?:that )?(.{4,80})/i, prefix: "User note:" },
  { rx: /my name is ([A-Za-z ]{2,30})/i, prefix: "User's name:" },
  { rx: /i(?:'m| am) (?:a |an )?([A-Za-z ]{3,40})/i, prefix: "User is:" },
  { rx: /i (?:work|study|live) (?:at|in|as) ([A-Za-z ,]{3,50})/i, prefix: "User works/studies/lives:" },
  { rx: /i(?:'m| am) from ([A-Za-z ,]{3,40})/i, prefix: "User is from:" },
  { rx: /my (?:favourite|favorite|fav) (.{3,50})/i, prefix: "User favourite:" },
];
const extractMemory = (text) => {
  for (const { rx, prefix } of MEMORY_PATTERNS) {
    const m = text.match(rx);
    if (m) return `${prefix} ${m[1].trim()}`;
  }
  return null;
};
const getMemories = (email) => { try { return JSON.parse(localStorage.getItem(`vetroai_memories_${email}`) || "[]"); } catch { return []; } };
const saveMemories = (email, mems) => { localStorage.setItem(`vetroai_memories_${email}`, JSON.stringify(mems.slice(-30))); };
const addMemory = (email, fact) => { const mems = getMemories(email); if (!mems.includes(fact)) saveMemories(email, [...mems, fact]); };

// ─── TRANSLATIONS ─────────────────────────────────────────────────────────────
const LANGS = {
  en: {
    flag: "🇬🇧", name: "English", t: {
      newChat: "New chat", search: "Search…", logout: "Sign out", send: "Send",
      placeholder: "Message VetroAI…", listening: "Listening…", share: "Share", stop: "Stop",
      welcome: "Good to see you.", welcomeSub: "Ask me anything — I'm here to help.",
      profile: "Profile", displayName: "Display name", nameHolder: "Your name", changeAvatar: "Avatar",
      save: "Save", saved: "Saved!", cancel: "Cancel", lang: "Language",
      shortcuts: "Shortcuts", shortcutsTitle: "Keyboard shortcuts",
      copy: "Copy", copied: "Copied!", readAloud: "Read aloud", edit: "Edit", regen: "Retry", del: "Delete",
      pin: "Pin", unpin: "Unpin",
      voiceListen: "Listening…", voiceThink: "Thinking…", voiceSpeak: "Speaking…",
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
      suggestions: ["Explain a concept simply", "Help me write something", "Debug my code", "Plan my week", "Summarize a topic", "Give me ideas"]
    }
  },
  hi: {
    flag: "🇮🇳", name: "हिंदी", t: {
      newChat: "नई चैट", search: "खोजें…", logout: "साइन आउट", send: "भेजें",
      placeholder: "VetroAI को संदेश…", listening: "सुन रहा हूँ…", share: "शेयर", stop: "रोकें",
      welcome: "नमस्ते!", welcomeSub: "मैं आपकी कैसे मदद कर सकता हूँ?",
      profile: "प्रोफ़ाइल", displayName: "नाम", nameHolder: "आपका नाम", changeAvatar: "अवतार",
      save: "सहेजें", saved: "सहेज लिया!", cancel: "रद्द करें", lang: "भाषा",
      shortcuts: "शॉर्टकट", shortcutsTitle: "कीबोर्ड शॉर्टकट",
      copy: "कॉपी", copied: "कॉपी!", readAloud: "पढ़ें", edit: "संपादित", regen: "फिर से", del: "हटाएं",
      pin: "पिन", unpin: "अनपिन",
      voiceListen: "सुन रहा हूँ…", voiceThink: "सोच रहा हूँ…", voiceSpeak: "बोल रहा हूँ…",
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
      suggestions: ["कुछ सरल समझाएं", "कुछ लिखने में मदद करें", "कोड डीबग करें", "सप्ताह की योजना", "विषय सारांश", "विचार दें"]
    }
  },
  kn: {
    flag: "🇮🇳", name: "ಕನ್ನಡ", t: {
      newChat: "ಹೊಸ ಚಾಟ್", search: "ಹುಡುಕಿ…", logout: "ಸೈನ್ ಔಟ್", send: "ಕಳುಹಿಸಿ",
      placeholder: "VetroAI ಗೆ ಸಂದೇಶ…", listening: "ಕೇಳುತ್ತಿದ್ದೇನೆ…", share: "ಹಂಚಿ", stop: "ನಿಲ್ಲಿಸಿ",
      welcome: "ಸ್ವಾಗತ!", welcomeSub: "ನಾನು ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?",
      profile: "ಪ್ರೊಫೈಲ್", displayName: "ಹೆಸರು", nameHolder: "ನಿಮ್ಮ ಹೆಸರು", changeAvatar: "ಅವತಾರ್",
      save: "ಉಳಿಸಿ", saved: "ಉಳಿಸಲಾಗಿದೆ!", cancel: "ರದ್ದು", lang: "ಭಾಷೆ",
      shortcuts: "ಶಾರ್ಟ್‌ಕಟ್", shortcutsTitle: "ಕೀಬೋರ್ಡ್ ಶಾರ್ಟ್‌ಕಟ್",
      copy: "ಕಾಪಿ", copied: "ಕಾಪಿ!", readAloud: "ಓದಿ", edit: "ಸಂಪಾದಿಸಿ", regen: "ಮತ್ತೆ", del: "ಅಳಿಸಿ",
      pin: "ಪಿನ್", unpin: "ಅನ್‌ಪಿನ್",
      voiceListen: "ಕೇಳುತ್ತಿದ್ದೇನೆ…", voiceThink: "ಯೋಚಿಸುತ್ತಿದ್ದೇನೆ…", voiceSpeak: "ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ…",
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
      suggestions: ["ಸರಳವಾಗಿ ವಿವರಿಸಿ", "ಬರೆಯಲು ಸಹಾಯ", "ಕೋಡ್ ಡೀಬಗ್", "ವಾರದ ಯೋಜನೆ", "ಸಾರಾಂಶ", "ಆಲೋಚನೆಗಳು"]
    }
  },
  es: {
    flag: "🇪🇸", name: "Español", t: {
      newChat: "Nuevo chat", search: "Buscar…", logout: "Cerrar sesión", send: "Enviar",
      placeholder: "Mensaje a VetroAI…", listening: "Escuchando…", share: "Compartir", stop: "Detener",
      welcome: "Hola de nuevo.", welcomeSub: "¿En qué puedo ayudarte hoy?",
      profile: "Perfil", displayName: "Nombre", nameHolder: "Tu nombre", changeAvatar: "Avatar",
      save: "Guardar", saved: "¡Guardado!", cancel: "Cancelar", lang: "Idioma",
      shortcuts: "Atajos", shortcutsTitle: "Atajos de teclado",
      copy: "Copiar", copied: "¡Copiado!", readAloud: "Leer", edit: "Editar", regen: "Reintentar", del: "Eliminar",
      pin: "Fijar", unpin: "Desfijar",
      voiceListen: "Escuchando…", voiceThink: "Pensando…", voiceSpeak: "Hablando…",
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
      ytAnalyzing: "Obteniendo transcripción de YouTube…", ytNotes: "Notas de YouTube listas",
      scList: [
        { keys: ["Ctrl", "K"], desc: "Nuevo chat" }, { keys: ["Ctrl", "/"], desc: "Entrada" },
        { keys: ["Ctrl", "P"], desc: "Perfil" }, { keys: ["Ctrl", "F"], desc: "Buscar" },
        { keys: ["Esc"], desc: "Cerrar" }, { keys: ["Enter"], desc: "Enviar" }, { keys: ["Shift", "↵"], desc: "Nueva línea" },
      ],
      suggestions: ["Explica algo simple", "Ayúdame a escribir", "Depura mi código", "Planifica mi semana", "Resume este tema", "Dame ideas"]
    }
  },
};

const MODES = [
  { id: "vtu_academic", name: "🎓 Academic" },
  { id: "debugger",     name: "🐛 Debugger" },
  { id: "astrology",    name: "🔮 Astrologer" },
  { id: "fast_chat",    name: "⚡ Fast Chat" },
  { id: "creative",     name: "✨ Creative" },
  { id: "analyst",      name: "📊 Analyst" },
  { id: "web_search",   name: "🌐 Web Search" },
  { id: "youtube",      name: "▶️ YouTube" },
];

const AVATARS = ["🧑", "🤖", "🦊", "🐼", "🐸", "🦁", "🐯", "🦅", "🌟", "🔥", "💎", "🚀", "🌈", "🎨", "🦋", "🐉", "🌙", "⚡", "🧠", "🎯", "🦄", "🌊", "🪐", "🎭", "🏔️"];
const SYSTEM_PRESETS = [
  "You are a Socratic tutor. Guide with questions only.",
  "You are a senior software engineer. Be concise and precise.",
  "You are a creative writing coach. Be vivid and encouraging.",
  "You are a debate partner. Challenge every claim rigorously.",
  "You are an expert on Indian culture, history, and traditions.",
  "You are a startup advisor. Focus on actionable insights.",
];
const REACTIONS = ["👍", "❤️", "😂", "😮", "🔥", "🧠"];

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

const SendIcon    = () => <Ic size={15} sw={2} fill="currentColor" d={<><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" fill="currentColor" stroke="none" /></>} />;
const MicIcon     = () => <Ic size={17} d={<><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></>} />;
const WaveIcon    = () => <svg width={17} height={17} viewBox="0 0 24 24" fill="currentColor"><rect x="11" y="3" width="2" height="18" rx="1" /><rect x="7" y="8" width="2" height="8" rx="1" /><rect x="15" y="8" width="2" height="8" rx="1" /><rect x="3" y="10" width="2" height="4" rx="1" /><rect x="19" y="10" width="2" height="4" rx="1" /></svg>;
const StopIcon    = () => <Ic size={15} d={<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />} />;
const CopyIcon    = () => <Ic size={14} d={<><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>} />;
const EditIcon    = () => <Ic size={14} d={<><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></>} />;
const SpeakIcon   = () => <Ic size={14} d={<><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" /></>} />;
const ReloadIcon  = () => <Ic size={14} d={<><path d="M21.5 2v6h-6" /><path d="M2.5 22v-6h6" /><path d="M2 11.5a10 10 0 0 1 18.8-4.3" /><path d="M22 12.5a10 10 0 0 1-18.8 4.3" /></>} />;
const TrashIcon   = () => <Ic size={13} d={<><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>} />;
const XIcon       = () => <Ic size={18} d={<><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>} />;
const MenuIcon    = () => <Ic size={19} d={<><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /></>} />;
const PlusIcon    = () => <Ic size={14} d={<><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>} />;
const SearchIcon  = () => <Ic size={14} d={<><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>} />;
const CheckIcon   = () => <Ic size={13} d="M20 6L9 17L4 12" />;
const PinIcon     = () => <Ic size={13} d={<><path d="M12 2l2 6h4l-3.3 2.4 1.3 6L12 13l-4 3.4 1.3-6L6 8h4z" /></>} />;
const BotIcon     = () => <Ic size={14} d={<><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /></>} />;
const UserIcon    = () => <Ic size={14} d={<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>} />;
const GlobeIcon   = () => <Ic size={14} d={<><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>} />;
const KbdIcon     = () => <Ic size={14} d={<><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" /></>} />;
const SunIcon     = () => <Ic size={15} d={<><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></>} />;
const MoonIcon    = () => <Ic size={15} d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />;
const ShareIcon   = () => <Ic size={14} d={<><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></>} />;
const DlIcon      = () => <Ic size={14} d={<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>} />;
const SmileIcon   = () => <Ic size={14} d={<><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></>} />;
const BoldIcon    = () => <Ic size={13} d={<><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" /><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" /></>} />;
const ItalicIcon  = () => <Ic size={13} d={<><line x1="19" y1="4" x2="10" y2="4" /><line x1="14" y1="20" x2="5" y2="20" /><line x1="15" y1="4" x2="9" y2="20" /></>} />;
const CodeIc2     = () => <Ic size={13} d={<><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></>} />;
const ChevDown    = () => <Ic size={12} d="M6 9l6 6 6-6" />;
const BookmarkIcon = () => <Ic size={14} d={<><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></>} />;
const BrainIcon   = () => <Ic size={14} d={<><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-1.07-4.56A3 3 0 0 1 3 12a3 3 0 0 1 2.22-2.9 2.5 2.5 0 0 1 .28-3.6A2.5 2.5 0 0 1 9.5 2z" /><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 1.07-4.56A3 3 0 0 0 21 12a3 3 0 0 0-2.22-2.9 2.5 2.5 0 0 0-.28-3.6A2.5 2.5 0 0 0 14.5 2z" /></>} />;
const ImageIcon   = () => <Ic size={14} d={<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></>} />;
const SparkleIcon = () => <Ic size={14} d={<><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" /><path d="M5 3l.6 1.8L7.4 5.4 5.6 6l-.6 1.8-.6-1.8L2.6 5.4l1.8-.6z" /><path d="M19 15l.6 1.8 1.8.6-1.8.6-.6 1.8-.6-1.8-1.8-.6 1.8-.6z" /></>} />;
const CalcIcon    = () => <Ic size={14} d={<><rect x="4" y="2" width="16" height="20" rx="2" /><line x1="8" y1="6" x2="16" y2="6" /><line x1="8" y1="10" x2="8" y2="10" /><line x1="12" y1="10" x2="12" y2="10" /><line x1="16" y1="10" x2="16" y2="10" /><line x1="8" y1="14" x2="8" y2="14" /><line x1="12" y1="14" x2="12" y2="14" /><line x1="16" y1="14" x2="16" y2="14" /><line x1="8" y1="18" x2="12" y2="18" /></>} />;
const TimerIcon   = () => <Ic size={14} d={<><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2" /><path d="M9 3h6" /><path d="M12 3v2" /></>} />;
const YTIcon      = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.8 8s-.2-1.4-.8-2c-.8-.8-1.6-.8-2-.9C16.3 5 12 5 12 5s-4.3 0-7 .1c-.4.1-1.2.1-2 .9-.6.6-.8 2-.8 2S2 9.6 2 11.2v1.5c0 1.6.2 3.2.2 3.2s.2 1.4.8 2c.8.8 1.8.8 2.2.8C6.6 19 12 19 12 19s4.3 0 7-.1c.4-.1 1.2-.1 2-.9.6-.6.8-2 .8-2s.2-1.6.2-3.2v-1.5C22 9.6 21.8 8 21.8 8z" />
    <polygon points="10,8 10,16 16,12" />
  </svg>
);

const WebSpinIcon = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
    style={{ animation: "spin 1s linear infinite" }}>
    <circle cx="12" cy="12" r="10" opacity={0.25} />
    <path d="M12 2a10 10 0 0 1 10 10" />
  </svg>
);

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

// ─── FOLLOW-UP CHIPS ─────────────────────────────────────────────────────────
function FollowUpChips({ suggestions, loading, onSelect }) {
  if (loading) return (
    <div className="followup-row">
      {[1, 2, 3].map(i => <div key={i} className="followup-chip skeleton" />)}
    </div>
  );
  if (!suggestions?.length) return null;
  return (
    <div className="followup-row">
      {suggestions.map((s, i) => (
        <button key={i} className="followup-chip" onClick={() => onSelect(s)}
          style={{ "--d": `${i * 0.08}s` }}>
          <SparkleIcon /> {s}
        </button>
      ))}
    </div>
  );
}

// ─── PROFILE MODAL ────────────────────────────────────────────────────────────
function ProfileModal({ onClose, t, langCode, setLangCode, theme, setTheme, userInfo }) {
  const PKEY = "vetroai_profile";
  const init = JSON.parse(localStorage.getItem(PKEY) || '{"name":"","avatar":"🧑"}');
  const [tab, setTab] = useState("profile");
  const [name, setName] = useState(userInfo?.name || init.name || "");
  const [avatar, setAvatar] = useState(init.avatar || "🧑");
  const [ok, setOk] = useState(false);
  const save = () => { localStorage.setItem(PKEY, JSON.stringify({ name, avatar })); setOk(true); setTimeout(() => setOk(false), 2000); };

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
              {userInfo?.picture
                ? <img src={userInfo.picture} alt="avatar" className="google-avatar-large" referrerPolicy="no-referrer" />
                : <div className="av-big">{avatar}</div>}
              {userInfo?.email && <span style={{ fontSize: "0.78rem", color: "var(--ink-3)" }}>{userInfo.email}</span>}
            </div>
            {!userInfo?.picture && (
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
            )}
            <div className="field-group">
              <label className="field-label">{t.displayName}</label>
              <input className="field-input" placeholder={t.nameHolder} value={name}
                onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && save()} />
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

// ─── SYS PROMPT MODAL ────────────────────────────────────────────────────────
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

// ─── SHARE MODAL ─────────────────────────────────────────────────────────────
function ShareModal({ onClose, t, messages }) {
  const [cp, setCp] = useState(false);
  const url = useMemo(() => {
    const d = btoa(encodeURIComponent(JSON.stringify(messages.map(m => ({ r: m.role, c: m.content })))));
    return `${window.location.origin}${window.location.pathname}?share=${d.slice(0, 200)}`;
  }, [messages]);
  const copy = () => { navigator.clipboard.writeText(url); setCp(true); setTimeout(() => setCp(false), 2500); };
  const exportTxt = () => {
    const txt = messages.map(m => `[${m.role.toUpperCase()}]\n${m.content}`).join("\n\n---\n\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([txt], { type: "text/plain" }));
    a.download = "vetroai-chat.txt"; a.click();
  };
  const exportMd = () => {
    const md = messages.map(m => `## ${m.role === "user" ? "👤 You" : "🤖 VetroAI"}\n\n${m.content}`).join("\n\n---\n\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    a.download = "vetroai-chat.md"; a.click();
  };
  const exportHtml = () => {
    const rows = messages.map(m => `<div class="msg ${m.role}"><strong>${m.role === "user" ? "You" : "VetroAI"}:</strong><p>${m.content.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p></div>`).join("");
    const html = `<!DOCTYPE html><html><head><title>VetroAI Chat</title><style>body{font-family:system-ui;max-width:700px;margin:auto;padding:40px;background:#faf9f7}.msg{padding:16px;margin:12px 0;border-radius:12px}.user{background:#f0ede8;text-align:right}.assistant{background:#fff;border:1px solid #eee}strong{font-size:.8rem;opacity:.5;display:block;margin-bottom:4px}</style></head><body><h2>VetroAI Chat Export</h2>${rows}</body></html>`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    a.download = "vetroai-chat.html"; a.click();
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
              <button className="btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={exportTxt}><DlIcon />TXT</button>
              <button className="btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={exportMd}><DlIcon />MD</button>
              <button className="btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={exportHtml}><DlIcon />HTML</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── BOOKMARKS PANEL ─────────────────────────────────────────────────────────
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
            : bookmarks.map((bm) => (
              <div key={bm.id} className="bookmark-item">
                <div className="bookmark-role">{bm.role === "user" ? "You" : "VetroAI"}</div>
                <div className="bookmark-text" onClick={() => { onSelect(bm); onClose(); }}>
                  {bm.content.slice(0, 140)}{bm.content.length > 140 ? "…" : ""}
                </div>
                <div className="bookmark-meta">
                  <span>{bm.timestamp}</span>
                  <button onClick={() => onRemove(bm.id)} title="Remove"><TrashIcon /></button>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

// ─── MEMORY PANEL ────────────────────────────────────────────────────────────
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

// ─── REACTION PICKER ─────────────────────────────────────────────────────────
function ReactionPicker({ onPick, onClose }) {
  return (
    <div className="rxn-picker">
      {REACTIONS.map(r => <button key={r} className="rxn-opt" onClick={() => { onPick(r); onClose(); }}>{r}</button>)}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════════════════════
export default function App() {
  const [theme, setTheme]       = useState(() => localStorage.getItem("vetroai_theme") || "light");
  const [langCode, setLangCode] = useState(() => localStorage.getItem("vetroai_lang") || "en");
  const t = LANGS[langCode]?.t || LANGS.en.t;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("vetroai_theme", theme);
  }, [theme]);

  // ── Auth state ───────────────────────────────────────────────
  const [user, setUser]           = useState(localStorage.getItem("token"));
  const [userInfo, setUserInfo]   = useState(() => {
    try { return JSON.parse(localStorage.getItem("vetroai_userinfo") || "null"); } catch { return null; }
  });
  const [gsiLoading, setGsiLoading] = useState(true);

  // ── Session state ────────────────────────────────────────────
  const [sessions, setSessions]               = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [histSearch, setHistSearch]           = useState("");
  const [pinnedIds, setPinnedIds]             = useState(() => JSON.parse(localStorage.getItem("vetroai_pins") || "[]"));
  const [isSidebarOpen, setIsSidebarOpen]     = useState(false);

  // ── Chat state ───────────────────────────────────────────────
  const [messages, setMessages]       = useState([]);
  const [input, setInput]             = useState("");
  const [editIdx, setEditIdx]         = useState(null);
  const [editInput, setEditInput]     = useState("");
  const [selectedMode, setSelectedMode] = useState(MODES[0].id);
  const [selFile, setSelFile]         = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [isLoading, setIsLoading]     = useState(false);
  const [isTyping, setIsTyping]       = useState(false);
  const [showScrollDn, setShowScrollDn] = useState(false);
  const [reactions, setReactions]     = useState({});
  const [rxnFor, setRxnFor]           = useState(null);
  const abortRef = useRef(null);

  // ── Web search state ─────────────────────────────────────────
  const [isWebSearching, setIsWebSearching] = useState(false);
  const [autoWebSearch, setAutoWebSearch]   = useState(true);

  // ── YouTube state ────────────────────────────────────────────
  const [isYtFetching, setIsYtFetching] = useState(false);
  const [ytVideoData, setYtVideoData]   = useState({}); // {videoId: {title, author, thumbnail}}

  // ── Follow-up suggestions ─────────────────────────────────────
  const [followUps, setFollowUps]               = useState([]);
  const [followUpsLoading, setFollowUpsLoading] = useState(false);
  const [followUpsForIdx, setFollowUpsForIdx]   = useState(null);

  // ── Bookmarks & Memory ───────────────────────────────────────
  const [bookmarks, setBookmarks]   = useState(() => {
    try { return JSON.parse(localStorage.getItem("vetroai_bookmarks") || "[]"); } catch { return []; }
  });
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [memories, setMemories]           = useState([]);
  const [showMemory, setShowMemory]       = useState(false);

  // ── Modals ───────────────────────────────────────────────────
  const [showProfile, setShowProfile]     = useState(false);
  const [showSysPrompt, setShowSysPrompt] = useState(false);
  const [showShare, setShowShare]         = useState(false);
  const [showCalc, setShowCalc]           = useState(false);
  const [showTimer, setShowTimer]         = useState(false);
  const [systemPrompt, setSystemPrompt]   = useState(() => localStorage.getItem("vetroai_sysprompt") || "");

  // ── Search ───────────────────────────────────────────────────
  const [chatSearchOpen, setChatSearchOpen]     = useState(false);
  const [chatSearchQuery, setChatSearchQuery]   = useState("");
  const [chatSearchCursor, setChatSearchCursor] = useState(0);

  // ── Voice ────────────────────────────────────────────────────
  const [autoSpeak, setAutoSpeak]     = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isVoiceOpen, setIsVoiceOpen] = useState(false);

  // ── Refs ──────────────────────────────────────────────────────
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

  useEffect(() => { inputRef.current = input; }, [input]);
  useEffect(() => { voiceRef.current = isVoiceOpen; }, [isVoiceOpen]);
  useEffect(() => { msgsRef.current = messages; }, [messages]);
  useEffect(() => { loadRef.current = isLoading; }, [isLoading]);
  useEffect(() => { window.speechSynthesis?.cancel(); }, []);
  useEffect(() => { localStorage.setItem("vetroai_sysprompt", systemPrompt); }, [systemPrompt]);
  useEffect(() => { localStorage.setItem("vetroai_pins", JSON.stringify(pinnedIds)); }, [pinnedIds]);
  useEffect(() => { localStorage.setItem("vetroai_bookmarks", JSON.stringify(bookmarks)); }, [bookmarks]);

  useEffect(() => {
    if (userInfo?.email) setMemories(getMemories(userInfo.email));
  }, [userInfo]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  useEffect(() => {
    document.body.style.overflow = (isSidebarOpen || showProfile || showSysPrompt || showShare || showBookmarks || showMemory || showCalc || showTimer) ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [isSidebarOpen, showProfile, showSysPrompt, showShare, showBookmarks, showMemory, showCalc, showTimer]);

  // ── Google Sign-In ────────────────────────────────────────────
  useEffect(() => {
    if (user) { setGsiLoading(false); return; }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      setGsiLoading(false);
      if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID === "YOUR_GOOGLE_CLIENT_ID_HERE") return;
      window.google?.accounts?.id?.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleCredential,
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      window.google?.accounts?.id?.renderButton(
        document.getElementById("google-btn"),
        { theme: theme === "dark" ? "filled_black" : "outline", size: "large", width: 300, text: "signin_with" }
      );
    };
    script.onerror = () => setGsiLoading(false);
    document.head.appendChild(script);
  }, [user, theme]);

  const handleGoogleCredential = async ({ credential }) => {
    try {
      const res = await fetch(API + "/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential }),
      });
      const data = await res.json();
      if (data.token) {
        localStorage.setItem("token", data.token);
        const info = { name: data.name, picture: data.picture, email: data.email };
        localStorage.setItem("vetroai_userinfo", JSON.stringify(info));
        setUser(data.token); setUserInfo(info);
      } else alert(data.error || "Sign-in failed");
    } catch { alert("Connection failed. Please try again."); }
  };

  const logout = () => {
    localStorage.removeItem("token"); localStorage.removeItem("vetroai_userinfo");
    if (window.google && userInfo?.email) { try { window.google.accounts.id.revoke(userInfo.email); } catch { } }
    setUser(null); setUserInfo(null); setMessages([]); setCurrentSessionId(null);
    setTimeout(() => {
      window.google?.accounts?.id?.renderButton(
        document.getElementById("google-btn"),
        { theme: theme === "dark" ? "filled_black" : "outline", size: "large", width: 300, text: "signin_with" }
      );
    }, 200);
  };

  // ── Session management ───────────────────────────────────────
  useEffect(() => {
    if (user) {
      try { const s = localStorage.getItem("vetroai_sessions_" + user); if (s) setSessions(JSON.parse(s) || []); } catch { setSessions([]); }
    }
  }, [user]);

  useEffect(() => {
    if (messages.length > 0 && user) {
      try {
        let id = currentSessionId; let list = [...sessions];
        const title = (messages[0]?.content || "Chat").substring(0, 36) + "…";
        if (!id) { id = Date.now().toString(); setCurrentSessionId(id); list.unshift({ id, title, messages }); }
        else { const i = list.findIndex(s => s.id === id); if (i !== -1) list[i].messages = messages; }
        setSessions(list); localStorage.setItem("vetroai_sessions_" + user, JSON.stringify(list));
      } catch { }
    }
  }, [messages]);

  const updateSessionTitle = useCallback(async (firstMsg) => {
    if (!firstMsg || !currentSessionId) return;
    try {
      const res = await fetch(API + "/generate-title", {
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
    } catch { }
  }, [currentSessionId, user]);

  const loadSession = id => {
    const s = sessions.find(x => x.id === id);
    if (s) { setMessages(s.messages || []); setCurrentSessionId(id); stopSpeak(); setIsSidebarOpen(false); isScrolling.current = false; setFollowUps([]); }
  };

  const newChat = useCallback(() => {
    setMessages([]); setCurrentSessionId(null); setInput(""); stopSpeak();
    setIsSidebarOpen(false); setReactions({}); setFollowUps([]); setFollowUpsForIdx(null);
  }, []);

  const deleteSession = id => {
    const list = sessions.filter(s => s.id !== id); setSessions(list);
    try { localStorage.setItem("vetroai_sessions_" + user, JSON.stringify(list)); } catch { }
    if (currentSessionId === id) newChat();
    setPinnedIds(p => p.filter(x => x !== id));
  };
  const togglePin = (e, id) => { e.stopPropagation(); setPinnedIds(p => p.includes(id) ? p.filter(x => x !== id) : [id, ...p]); };

  // ── Bookmarks ─────────────────────────────────────────────────
  const toggleBookmark = (msg) => {
    setBookmarks(prev => {
      const id = `${msg.timestamp}_${msg.content.slice(0, 20)}`;
      const exists = prev.find(b => b.id === id);
      if (exists) return prev.filter(b => b.id !== id);
      return [...prev, { id, ...msg }];
    });
  };
  const isBookmarked = (msg) => {
    const id = `${msg.timestamp}_${msg.content.slice(0, 20)}`;
    return bookmarks.some(b => b.id === id);
  };
  const removeBookmark = (id) => setBookmarks(prev => prev.filter(b => b.id !== id));

  // ── Memory management ─────────────────────────────────────────
  const handleAddMemory = (fact) => {
    if (!userInfo?.email) return;
    addMemory(userInfo.email, fact);
    setMemories(getMemories(userInfo.email));
  };
  const removeMemoryItem = (idx) => {
    if (!userInfo?.email) return;
    const m = memories.filter((_, i) => i !== idx);
    saveMemories(userInfo.email, m);
    setMemories(m);
  };
  const clearAllMemory = () => {
    if (!userInfo?.email) return;
    saveMemories(userInfo.email, []);
    setMemories([]);
  };

  // ── Follow-up generation ──────────────────────────────────────
  const generateFollowUps = useCallback(async (lastBotMsg, userQuery) => {
    if (!lastBotMsg || lastBotMsg.length < 50) return;
    setFollowUpsLoading(true);
    try {
      const res = await fetch(API + "/follow-ups", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify({ lastMessage: lastBotMsg.slice(0, 600), userQuery: userQuery?.slice(0, 150) || "" }),
      });
      const data = await res.json();
      setFollowUps(data.suggestions || []);
    } catch { setFollowUps([]); }
    setFollowUpsLoading(false);
  }, []);

  // ── Computed data ─────────────────────────────────────────────
  const { pinnedSessions, groupedSessions } = useMemo(() => {
    const filtered = sessions.filter(s => s?.title?.toLowerCase().includes(histSearch.toLowerCase()));
    const pinned = filtered.filter(s => pinnedIds.includes(s.id));
    const rest = filtered.filter(s => !pinnedIds.includes(s.id));
    const groups = {};
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

  useEffect(() => {
    const h = e => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") {
        if (showCalc) { setShowCalc(false); return; }
        if (showTimer) { setShowTimer(false); return; }
        if (showProfile) { setShowProfile(false); return; }
        if (showSysPrompt) { setShowSysPrompt(false); return; }
        if (showShare) { setShowShare(false); return; }
        if (showBookmarks) { setShowBookmarks(false); return; }
        if (showMemory) { setShowMemory(false); return; }
        if (isSidebarOpen) { setIsSidebarOpen(false); return; }
        if (isVoiceOpen) { closeVoice(); return; }
        if (chatSearchOpen) { setChatSearchOpen(false); setChatSearchQuery(""); return; }
      }
      if (!ctrl) return;
      if (e.key === "k" || e.key === "K") { e.preventDefault(); newChat(); }
      if (e.key === "/") { e.preventDefault(); textareaRef.current?.focus(); }
      if (e.key === "p" || e.key === "P") { e.preventDefault(); setShowProfile(v => !v); }
      if (e.key === "f" || e.key === "F") { e.preventDefault(); setChatSearchOpen(v => !v); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [showCalc, showTimer, showProfile, showSysPrompt, showShare, showBookmarks, showMemory, isSidebarOpen, isVoiceOpen, chatSearchOpen]);

  // ── Scroll ────────────────────────────────────────────────────
  const handleScroll = () => {
    if (!feedRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = feedRef.current;
    const far = scrollHeight - scrollTop - clientHeight > 120;
    isScrolling.current = far; setShowScrollDn(far);
  };
  const scrollToBottom = useCallback(() => {
    if (feedRef.current) { feedRef.current.scrollTop = feedRef.current.scrollHeight; isScrolling.current = false; setShowScrollDn(false); }
  }, []);
  useEffect(() => { if (!isScrolling.current) scrollToBottom(); }, [messages]);

  // ── Voice ─────────────────────────────────────────────────────
  const stopSpeak = () => window.speechSynthesis?.cancel();
  const speak = txt => {
    if (!window.speechSynthesis) return; stopSpeak();
    const c = (txt || "").replace(/[*#_`~]/g, "").replace(/\$\$.*?\$\$/gs, "[equation]").replace(/\$.*?\$/g, "[math]");
    if (!c.trim()) return;
    const u = new SpeechSynthesisUtterance(c);
    const vs = window.speechSynthesis.getVoices();
    u.voice = vs.find(v => v.name.includes("AriaNeural")) || vs.find(v => v.lang === "en-US") || vs[0];
    u.pitch = 0.95; u.rate = 1.05;
    u.onstart = () => { try { recogRef.current?.stop(); } catch { } setIsListening(false); };
    u.onend = () => { if (voiceRef.current) { setInput(""); try { recogRef.current?.start(); setIsListening(true); } catch { } } };
    window.speechSynthesis.speak(u);
  };

  useEffect(() => {
    const lv = () => window.speechSynthesis.getVoices(); lv();
    if (window.speechSynthesis?.onvoiceschanged !== undefined) window.speechSynthesis.onvoiceschanged = lv;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return;
    const sr = new SR(); sr.interimResults = true;
    sr.onresult = e => { if (window.speechSynthesis.speaking) return; let txt = ""; for (let i = e.resultIndex; i < e.results.length; i++) txt += e.results[i][0].transcript; setInput(txt); };
    sr.onend = () => { setIsListening(false); if (voiceRef.current) { const cur = inputRef.current || ""; if (cur.trim() && !loadRef.current && !window.speechSynthesis.speaking) submitVoice(cur); else setTimeout(() => { if (voiceRef.current && !loadRef.current && !window.speechSynthesis.speaking) try { recogRef.current?.start(); setIsListening(true); } catch { } }, 800); } };
    sr.onerror = e => { setIsListening(false); if (e.error === "not-allowed") { setIsVoiceOpen(false); alert("Microphone access denied."); } };
    recogRef.current = sr;
  }, []);

  const toggleMic  = e => { e?.preventDefault(); if (!recogRef.current) return; if (isListening) recogRef.current.stop(); else { setInput(""); recogRef.current.start(); setIsListening(true); } };
  const openVoice  = e => { e.preventDefault(); window.speechSynthesis.speak(new SpeechSynthesisUtterance("")); setAutoSpeak(true); setIsVoiceOpen(true); if (!isListening) { setInput(""); try { recogRef.current?.start(); setIsListening(true); } catch { } } };
  const closeVoice = () => { setIsVoiceOpen(false); if (isListening) recogRef.current?.stop(); setIsListening(false); stopSpeak(); };
  const handleOrb  = () => { if (isLoading) return; if (window.speechSynthesis.speaking) { stopSpeak(); setInput(""); try { recogRef.current?.start(); setIsListening(true); } catch { } } else if (isListening) recogRef.current?.stop(); else { setInput(""); try { recogRef.current?.start(); setIsListening(true); } catch { } } };

  const handleFileChange = e => { const f = e.target.files[0]; if (!f) return; setSelFile(f); if (f.type.startsWith("image/")) { const r = new FileReader(); r.onloadend = () => setFilePreview(r.result); r.readAsDataURL(f); } };
  const stopGeneration   = () => { abortRef.current?.abort(); setIsLoading(false); setIsTyping(false); setIsWebSearching(false); setIsYtFetching(false); };

  const insertFmt = (pre, suf = "") => {
    if (!textareaRef.current) return;
    const { selectionStart: s, selectionEnd: e, value: v } = textareaRef.current;
    const sel = v.slice(s, e);
    setInput(v.slice(0, s) + pre + (sel || "text") + suf + v.slice(e));
    setTimeout(() => { if (textareaRef.current) { textareaRef.current.focus(); textareaRef.current.setSelectionRange(s + pre.length, s + pre.length + (sel || "text").length); } }, 0);
  };

  // ─────────────────────────────────────────────────────────────
  //  MAIN AI CALL
  // ─────────────────────────────────────────────────────────────
  const triggerAI = async (hist, fileData = null, ytContext = null) => {
    const ctrl = new AbortController(); abortRef.current = ctrl;
    setIsLoading(true); setIsTyping(true); scrollToBottom(); stopSpeak();
    setFollowUps([]); setFollowUpsForIdx(null);

    const userQuery = hist[hist.length - 1]?.content || "";
    const isYtMode  = selectedMode === "youtube";
    const isWebMode = selectedMode === "web_search";
    const shouldSearch = isWebMode || (autoWebSearch && needsWebSearch(userQuery));
    const isFirstMsg   = hist.filter(m => m.role === "user").length === 1;

    let webContext = null;
    if (shouldSearch && !ytContext) {
      setIsWebSearching(true);
      webContext = await fetchWebResults(userQuery);
      setIsWebSearching(false);
    }

    const memFact = extractMemory(userQuery);
    if (memFact) handleAddMemory(memFact);

    const fd = new FormData();
    fd.append("input", userQuery);
    fd.append("model", (isYtMode || isWebMode) ? "fast_chat" : selectedMode);

    const ctx = hist.slice(-12).map(m => ({ role: m.role, content: m.content }));

    const now    = new Date();
    const nowStr = now.toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const nowISO = now.toISOString().slice(0, 10);
    const currentMemories = userInfo?.email ? getMemories(userInfo.email) : [];

    let sysContent = [
      `TODAY IS: ${nowStr} (${nowISO}). Current year: ${now.getFullYear()}.`,
      `NEVER say an event "hasn't happened yet" if it's plausible given today's date. Compare dates precisely.`,
      currentMemories.length ? `USER CONTEXT (remembered facts):\n${currentMemories.map(m => `• ${m}`).join("\n")}` : "",
      systemPrompt || "",
    ].filter(Boolean).join("\n\n");

    if (isWebMode) sysContent = "You are VetroAI in 🌐 Web Search Mode.\n" + sysContent;

    // ── YouTube transcript context ──────────────────────────────
    if (ytContext) {
      sysContent += `\n\n${"━".repeat(50)}\n▶️ YOUTUBE VIDEO TRANSCRIPT:\nTitle: ${ytContext.title}\nChannel: ${ytContext.author}\n\n${ytContext.transcript || "(Transcript unavailable — use your knowledge)"}\n${"━".repeat(50)}\n\nINSTRUCTIONS:\nGenerate COMPREHENSIVE, DETAILED NOTES from this YouTube video. Structure them as:\n\n## 📋 Video Overview\n## 🔑 Key Points (numbered list)\n## 📚 Detailed Notes (section by section)\n## 💡 Important Concepts\n## 🎯 Key Takeaways\n## ❓ Possible Exam/Quiz Questions\n\nBe thorough. Use markdown formatting. Include all important details.`;
    } else if (shouldSearch && webContext) {
      sysContent += `\n\n${"━".repeat(50)}\n🌐 LIVE GOOGLE SEARCH RESULTS — treat as ground truth:\n${"━".repeat(50)}\n\n${webContext}\n\n${"━".repeat(50)}\n\nRULES:\n1. Compare dates from results to TODAY (${nowISO}) before saying started/not started.\n2. Quote stats exactly as they appear. Cite sources.\n3. If results conflict, note both versions.`;
    } else if (shouldSearch && !webContext) {
      sysContent += `\n\n⚠️ Web search returned no results. Tell the user your data may be outdated (cutoff Oct 2024) and suggest checking Google/Cricbuzz/ESPN/NDTV.`;
    }

    if (sysContent.trim()) ctx.unshift({ role: "system", content: sysContent });
    fd.append("messages", JSON.stringify(ctx));
    if (fileData) fd.append("file", fileData);

    const assistantMsgIdx = hist.length;

    try {
      const res = await fetch(API + "/chat", {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: fd,
        signal: ctrl.signal,
      });
      if (res.status === 401) { logout(); return; }

      const reader = res.body.getReader();
      const dec    = new TextDecoder();
      let bot = "";
      const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      setIsTyping(false);
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "",
        timestamp: ts,
        usedWebSearch: shouldSearch && !!webContext,
        usedYoutube:   !!ytContext,
        ytInfo:        ytContext ? { title: ytContext.title, author: ytContext.author, videoId: ytContext.videoId } : null,
      }]);

      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        for (const line of dec.decode(value).split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6); if (raw === "[DONE]") continue;
          try {
            bot += JSON.parse(raw).content;
            setMessages(prev => { const u = [...prev]; u[u.length - 1].content = bot; return u; });
            if (!isScrolling.current) scrollToBottom();
          } catch { }
        }
      }

      setIsLoading(false);
      if (voiceRef.current || autoSpeak) speak(bot);
      if (isFirstMsg) updateSessionTitle(userQuery);
      setFollowUpsForIdx(assistantMsgIdx);
      generateFollowUps(bot, userQuery);

    } catch (err) {
      setIsLoading(false); setIsTyping(false); setIsWebSearching(false); setIsYtFetching(false);
      if (err.name !== "AbortError") alert("Error connecting to server.");
    } finally {
      setSelFile(null); setFilePreview(null);
    }
  };

  const submitVoice = txt => {
    try { recogRef.current?.stop(); } catch { } setIsListening(false);
    const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const hist = [...msgsRef.current, { role: "user", content: txt, timestamp: ts }];
    setMessages(hist); setInput(""); triggerAI(hist);
  };

  const sendMessage = async (e, prefill) => {
    e?.preventDefault();
    const text = (prefill || input).trim();
    if (!text && !selFile) return;
    if (isListening) recogRef.current?.stop();

    // ── Image generation intercept ──────────────────────────────
    const imgPrompt = detectImagePrompt(text);
    if (imgPrompt && !selFile) {
      const ts  = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const imgUrl = getImageUrl(imgPrompt);
      const userMsg = { role: "user", content: text, timestamp: ts };
      const botMsg = {
        role: "assistant",
        content: `Here's your generated image of **"${imgPrompt}"**:\n\n![${imgPrompt}](${imgUrl})\n\n*Powered by Pollinations.ai — [Generate another variation](${getImageUrl(imgPrompt)})*`,
        timestamp: ts,
        isImageGen: true,
      };
      setMessages(prev => [...prev, userMsg, botMsg]);
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      if (messages.length === 0) updateSessionTitle(text);
      return;
    }

    // ── YouTube URL intercept ────────────────────────────────────
    const videoId = extractVideoId(text);
    const isYtMode = selectedMode === "youtube";
    if (videoId) {
      const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const userMsg = { role: "user", content: text, timestamp: ts, ytVideoId: videoId };

      // Fetch video info for embed
      const info = await fetchYouTubeInfo(videoId);
      setYtVideoData(prev => ({ ...prev, [videoId]: info }));

      setMessages(prev => [...prev, userMsg]);
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";

      // Determine prompt: if text is just the URL or says "notes"/"summarize"/"analyze"
      const wantsNotes = isYtMode || /\b(notes|summarize|summary|analyze|explain|key points|study)\b/i.test(text);

      setIsYtFetching(true);
      const transcript = await fetchYouTubeTranscript(videoId);
      setIsYtFetching(false);

      const hist = [...messages, userMsg];
      const ytContext = {
        videoId,
        title: info?.title || "YouTube Video",
        author: info?.author || "",
        transcript: transcript ? transcript.slice(0, 8000) : null,
        wantsNotes,
      };

      if (messages.length === 0) updateSessionTitle(text);
      triggerAI(hist, null, ytContext);
      return;
    }

    const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const hist = [...messages, { role: "user", content: text, file: selFile ? { preview: filePreview } : null, timestamp: ts }];
    setMessages(hist); setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    triggerAI(hist, selFile);
  };

  const handleKeyDown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!isLoading) sendMessage(); } };
  const submitEdit = idx => {
    if (!editInput.trim()) return; stopSpeak();
    const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const hist = [...messages.slice(0, idx), { role: "user", content: editInput, timestamp: ts }];
    setMessages(hist); setEditIdx(null); triggerAI(hist);
  };
  const handleRegen = idx => { if (idx === 0) return; const hist = messages.slice(0, idx); setMessages(hist); triggerAI(hist); };

  const addRxn    = (i, r) => setReactions(p => ({ ...p, [i]: [...(p[i] || []).filter(x => x !== r), r] }));
  const removeRxn = (i, r) => setReactions(p => ({ ...p, [i]: (p[i] || []).filter(x => x !== r) }));

  const profileData = useMemo(() => JSON.parse(localStorage.getItem("vetroai_profile") || '{"name":"","avatar":"🧑"}'), [showProfile]);
  const isWebMode   = selectedMode === "web_search";
  const isYtMode    = selectedMode === "youtube";
  const charCount   = input.length;
  const tokenEst    = Math.ceil(charCount / 4);
  const isEmpty     = !input.trim() && !selFile;

  const AvatarEl = () => userInfo?.picture
    ? <img src={userInfo.picture} alt="" className="google-avatar-sm" referrerPolicy="no-referrer" />
    : <span>{profileData.avatar}</span>;

  // ── AUTH PAGE ──────────────────────────────────────────────────
  if (!user) return (
    <div className="auth-page">
      <div className="auth-glow" />
      <div className="auth-box">
        <div className="auth-logo">
          <div className="auth-logo-mark">V</div>
          <div className="auth-logo-text">
            <span className="logo-name">VetroAI</span>
            <span className="logo-ver">v2.1</span>
          </div>
        </div>
        <div className="auth-hero">
          <h2 className="auth-headline">Welcome back.</h2>
          <p className="auth-sub">Your intelligent AI assistant — powered by Mistral & live web search.</p>
        </div>
        <div className="auth-features">
          <div className="auth-feat"><span>▶️</span><span>YouTube notes & analysis</span></div>
          <div className="auth-feat"><span>🌐</span><span>Live Google search</span></div>
          <div className="auth-feat"><span>🎨</span><span>AI image generation</span></div>
          <div className="auth-feat"><span>🧠</span><span>Memory across chats</span></div>
          <div className="auth-feat"><span>🧮</span><span>Built-in calculator</span></div>
          <div className="auth-feat"><span>⏱️</span><span>Focus timer (Pomodoro)</span></div>
        </div>
        <div className="auth-divider"><span>Sign in to continue</span></div>
        {GOOGLE_CLIENT_ID === "YOUR_GOOGLE_CLIENT_ID_HERE"
          ? <div className="auth-setup-notice">
            <p>⚙️ <strong>Setup needed:</strong> Replace <code>GOOGLE_CLIENT_ID</code> in App.jsx with your Google OAuth Client ID.</p>
            <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="auth-setup-link">Get one at Google Cloud Console →</a>
          </div>
          : null}
        <div id="google-btn" className="google-btn-container" />
        {gsiLoading && <div className="auth-loading"><span className="auth-spin" /></div>}
        <p className="auth-terms">By signing in, you agree to use VetroAI responsibly.</p>
      </div>
    </div>
  );

  // ── MAIN UI ───────────────────────────────────────────────────
  return (
    <div className="shell">
      {showProfile   && <ProfileModal onClose={() => setShowProfile(false)} t={t} langCode={langCode} setLangCode={setLangCode} theme={theme} setTheme={setTheme} userInfo={userInfo} />}
      {showSysPrompt && <SysPromptModal onClose={() => setShowSysPrompt(false)} t={t} value={systemPrompt} setValue={setSystemPrompt} />}
      {showShare     && messages.length > 0 && <ShareModal onClose={() => setShowShare(false)} t={t} messages={messages} />}
      {showBookmarks && <BookmarksPanel bookmarks={bookmarks} onSelect={msg => setInput(msg.content)} onRemove={removeBookmark} onClose={() => setShowBookmarks(false)} t={t} />}
      {showMemory    && <MemoryPanel memories={memories} onClear={clearAllMemory} onRemove={removeMemoryItem} onClose={() => setShowMemory(false)} t={t} />}
      {showCalc      && <CalcWidget onClose={() => setShowCalc(false)} />}
      {showTimer     && <FocusTimer onClose={() => setShowTimer(false)} />}

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
            <button className="icon-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <SunIcon /> : <MoonIcon />}</button>
            <button className="icon-btn av-btn" onClick={() => setShowProfile(true)} title={t.profile}><AvatarEl /></button>
          </div>
        </div>

        {userInfo && (
          <div className="sb-user">
            {userInfo.picture
              ? <img src={userInfo.picture} alt="" className="google-avatar-sm" referrerPolicy="no-referrer" />
              : <div className="sb-user-initials">{(userInfo.name || "?")[0]}</div>}
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
        </div>

        <nav className="history">
          {pinnedSessions.length > 0 && <>
            <div className="hist-label">📌 {t.pinnedSection}</div>
            {pinnedSessions.map(s => (
              <div key={s.id} className={`hist-item${s.id === currentSessionId ? " active" : ""}`} onClick={() => loadSession(s.id)}>
                <span className="hist-title">{s.title}</span>
                <div className="hist-actions">
                  <button onClick={e => togglePin(e, s.id)}><PinIcon /></button>
                  <button onClick={e => { e.stopPropagation(); deleteSession(s.id); }} className="del-btn"><TrashIcon /></button>
                </div>
              </div>
            ))}
          </>}

          {dateOrder.map(group => groupedSessions[group]?.length > 0 && (
            <React.Fragment key={group}>
              <div className="hist-label">{group}</div>
              {groupedSessions[group].map(s => (
                <div key={s.id} className={`hist-item${s.id === currentSessionId ? " active" : ""}`} onClick={() => loadSession(s.id)}>
                  <span className="hist-title">{s.title}</span>
                  <div className="hist-actions">
                    <button onClick={e => togglePin(e, s.id)}><PinIcon /></button>
                    <button onClick={e => { e.stopPropagation(); deleteSession(s.id); }} className="del-btn"><TrashIcon /></button>
                  </div>
                </div>
              ))}
            </React.Fragment>
          ))}

          {sessions.length === 0 && (
            <div className="hist-empty"><span>💬</span><p>No conversations yet</p></div>
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

      {/* CHAT */}
      <main className="chat">
        <header className="chat-header">
          <div className="ch-left">
            <button className="icon-btn mobile-only" onClick={() => setIsSidebarOpen(true)}><MenuIcon /></button>
            <div className={`mode-pill${isWebMode ? " web-mode-pill" : isYtMode ? " yt-mode-pill" : ""}`}>
              {MODES.find(m => m.id === selectedMode)?.name}
              {isWebMode && <span className="web-live-dot" />}
              {isYtMode && <span className="web-live-dot" style={{ background: "#ff0000" }} />}
            </div>
            {autoWebSearch && !isWebMode && !isYtMode && (
              <div className="mode-pill" style={{ fontSize: "0.7rem", gap: 4, opacity: 0.7 }}>
                <GlobeIcon /> Auto
              </div>
            )}
          </div>
          <div className="ch-right">
            <button className="icon-btn" onClick={() => setShowCalc(true)} title="Calculator"><CalcIcon /></button>
            <button className="icon-btn" onClick={() => setShowTimer(true)} title="Focus Timer"><TimerIcon /></button>
            <button className="icon-btn" onClick={() => setChatSearchOpen(v => !v)}><SearchIcon /></button>
            <button className="icon-btn" onClick={() => setShowSysPrompt(true)}><BotIcon /></button>
            <button className="icon-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <SunIcon /> : <MoonIcon />}</button>
            {messages.length > 0 && <button className="share-btn" onClick={() => setShowShare(true)}><ShareIcon /><span>{t.share}</span></button>}
          </div>
        </header>

        {(isWebSearching || isYtFetching) && (
          <div className="web-searching-bar" style={isYtFetching ? { background: "rgba(255,0,0,0.06)", borderColor: "rgba(255,0,0,0.15)" } : {}}>
            <WebSpinIcon />
            <span>{isYtFetching ? t.ytAnalyzing : "Searching the web…"}</span>
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

        <div className="feed" ref={feedRef} onScroll={handleScroll}>
          {messages.length === 0 && (
            <div className="welcome">
              <div className="welcome-avatar">
                {userInfo?.picture
                  ? <img src={userInfo.picture} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} referrerPolicy="no-referrer" />
                  : "V"}
              </div>
              <h2 className="welcome-title">
                {userInfo?.name ? `Hi, ${userInfo.name.split(" ")[0]}! 👋` : t.welcome}
              </h2>
              <p className="welcome-sub">{t.welcomeSub}</p>
              {systemPrompt && <div className="sys-badge"><BotIcon />{t.systemPromptBadge}</div>}
              {isWebMode && (
                <div className="sys-badge" style={{ background: "rgba(59,130,246,0.1)", borderColor: "rgba(59,130,246,0.25)", color: "#3b82f6" }}>
                  <GlobeIcon /> Web Search Mode — Live results enabled
                </div>
              )}
              {isYtMode && (
                <div className="sys-badge" style={{ background: "rgba(255,0,0,0.07)", borderColor: "rgba(255,0,0,0.2)", color: "#ff0000" }}>
                  <YTIcon /> YouTube Mode — Paste any YouTube URL for instant notes
                </div>
              )}
              <div className="welcome-cards">
                <div className="welcome-card" onClick={() => { setSelectedMode("youtube"); setInput(""); }}>
                  <span className="wcard-icon">▶️</span>
                  <span className="wcard-label">YouTube Notes</span>
                  <span className="wcard-sub">Paste any YouTube URL</span>
                </div>
                <div className="welcome-card" onClick={() => setInput("Generate an image of ")}>
                  <span className="wcard-icon">🎨</span>
                  <span className="wcard-label">Image Generation</span>
                  <span className="wcard-sub">Create AI images free</span>
                </div>
                <div className="welcome-card" onClick={() => { setAutoWebSearch(true); setInput("Latest news today"); }}>
                  <span className="wcard-icon">🌐</span>
                  <span className="wcard-label">Live Web Search</span>
                  <span className="wcard-sub">Real-time Google results</span>
                </div>
                <div className="welcome-card" onClick={() => setSelectedMode("debugger")}>
                  <span className="wcard-icon">🐛</span>
                  <span className="wcard-label">Code Debugger</span>
                  <span className="wcard-sub">Fix bugs instantly</span>
                </div>
                <div className="welcome-card" onClick={() => setShowCalc(true)}>
                  <span className="wcard-icon">🧮</span>
                  <span className="wcard-label">Calculator</span>
                  <span className="wcard-sub">Math with history</span>
                </div>
                <div className="welcome-card" onClick={() => setShowTimer(true)}>
                  <span className="wcard-icon">⏱️</span>
                  <span className="wcard-label">Focus Timer</span>
                  <span className="wcard-sub">Pomodoro technique</span>
                </div>
              </div>
              <div className="suggestions">
                {(isYtMode
                  ? ["Paste a YouTube URL below for instant notes", "youtube.com/watch?v=... → detailed notes", "Summarize any lecture video", "Extract key points from tutorials", "Study notes from educational videos"]
                  : isWebMode
                    ? ["What's trending in tech today?", "Latest IPL scores", "Current stock market", "Recent AI news", "Today's top headlines"]
                    : (t.suggestions || [])
                ).slice(0, 6).map((s, i) => (
                  <button key={i} className="sug" style={{ "--d": `${i * 0.06}s` }} onClick={() => sendMessage(null, s)}>{s}</button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, idx) => {
            const highlighted = chatSearchQuery && chatSearchResults.includes(idx);
            const msgRxns = reactions[idx] || [];
            const isLastAssistant = msg.role === "assistant" && idx === messages.length - 1 && !isLoading;
            const showFollowUps = isLastAssistant && (followUps.length > 0 || followUpsLoading);
            const vidId = msg.ytVideoId;
            const vidInfo = vidId ? (ytVideoData[vidId] || {}) : null;

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

                      {/* YouTube embed in user message */}
                      {vidId && vidInfo && (
                        <YouTubeEmbed videoId={vidId} title={vidInfo.title || "YouTube Video"} author={vidInfo.author || ""} />
                      )}

                      {msg.role === "assistant" && msg.usedWebSearch && (
                        <div className="web-search-badge used"><GlobeIcon /> {t.webSearched}</div>
                      )}
                      {msg.role === "assistant" && msg.usedYoutube && (
                        <div className="web-search-badge" style={{ color: "#ff0000", background: "rgba(255,0,0,0.06)", borderColor: "rgba(255,0,0,0.18)" }}>
                          <YTIcon /> {msg.ytInfo?.title ? `Notes from: ${msg.ytInfo.title}` : t.ytNotes}
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
                            const str = String(children).replace(/\n$/, "");
                            return !inline && match
                              ? <CodeBlock match={match} codeString={str} copyLabel={t.copy} />
                              : <code className="icode">{children}</code>;
                          },
                          img({ src, alt }) {
                            return <img src={src} alt={alt || ""} className="gen-image" loading="lazy" />;
                          },
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
                        {msg.role === "assistant" && !isLoading && <>
                          <button onClick={() => speak(msg.content)} title={t.readAloud}><SpeakIcon /></button>
                          <button onClick={() => navigator.clipboard.writeText(msg.content)} title={t.copy}><CopyIcon /></button>
                          <button onClick={() => handleRegen(idx)} title={t.regen}><ReloadIcon /></button>
                        </>}
                        {msg.role === "user" && !isLoading && <>
                          <button onClick={() => { setEditIdx(idx); setEditInput(msg.content); }} title={t.edit}><EditIcon /></button>
                          <button onClick={() => navigator.clipboard.writeText(msg.content)} title={t.copy}><CopyIcon /></button>
                        </>}
                        <button onClick={() => toggleBookmark(msg)} title={t.bookmarks}
                          style={{ color: isBookmarked(msg) ? "#e76f51" : undefined }}>
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
                {msg.role === "user" && (
                  <div className="msg-av user-av">
                    {userInfo?.picture
                      ? <img src={userInfo.picture} alt="" className="google-avatar-xs" referrerPolicy="no-referrer" />
                      : profileData.avatar}
                  </div>
                )}
              </div>
            );
          })}

          {isTyping && (
            <div className="msg assistant">
              <div className="msg-av bot-av">V</div>
              <div className="msg-body"><div className="typing"><span /><span /><span /></div></div>
            </div>
          )}
          <div style={{ height: 20 }} />
        </div>

        {showScrollDn && <button className="scroll-btn" onClick={scrollToBottom}>↓</button>}

        {/* INPUT */}
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
              <GlobeIcon /><span>Web Search Mode — fetching live results</span>
            </div>
          )}
          {memories.length > 0 && (
            <div className="sys-strip" style={{ background: "rgba(16,185,129,0.07)", borderColor: "rgba(16,185,129,0.2)", color: "#10b981", cursor: "pointer" }}
              onClick={() => setShowMemory(true)}>
              <BrainIcon /><span>{memories.length} memor{memories.length === 1 ? "y" : "ies"} active — VetroAI remembers facts about you</span>
            </div>
          )}
          {input.length > 0 && (
            <div className="fmt-bar">
              <button onClick={() => insertFmt("**", "**")} title="Bold"><BoldIcon /></button>
              <button onClick={() => insertFmt("_", "_")} title="Italic"><ItalicIcon /></button>
              <button onClick={() => insertFmt("`", "`")} title="Code"><CodeIc2 /></button>
              <div className="fmt-sep" />
              <span className="counter">{charCount} {t.chars} · {tokenEst} {t.tokens}</span>
            </div>
          )}
          <form className="input-box" onSubmit={sendMessage}>
            <input type="file" ref={fileInputRef} style={{ display: "none" }} onChange={handleFileChange} />
            {filePreview && (
              <div className="file-prev">
                <img src={filePreview} alt="" />
                <button type="button" onClick={() => { setSelFile(null); setFilePreview(null); }}>✕</button>
              </div>
            )}
            <button type="button" className="attach-btn" onClick={() => fileInputRef.current.click()}>📎</button>
            <textarea ref={textareaRef}
              placeholder={
                isListening && !isVoiceOpen ? t.listening :
                  isYtMode ? "Paste a YouTube URL here (e.g. https://youtube.com/watch?v=...)…" :
                    isWebMode ? "Search the web with AI…" :
                      'Message VetroAI… (try "generate an image of…")'
              }
              value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown} disabled={isLoading} rows={1} />
            <div className="input-actions">
              {isLoading
                ? <button type="button" className="stop-btn" onClick={stopGeneration}><StopIcon /></button>
                : isEmpty
                  ? <>
                    <button type="button" className={`mic-btn${isListening && !isVoiceOpen ? " active" : ""}`} onClick={toggleMic}><MicIcon /></button>
                    <button type="button" className="wave-btn" onClick={openVoice}><WaveIcon /></button>
                  </>
                  : <button type="submit" className={`send-btn${isWebMode ? " web-send" : isYtMode ? " yt-send" : ""}`}><SendIcon /></button>}
            </div>
          </form>
          <p className="input-note">
            VetroAI can make mistakes.&nbsp;
            {isYtMode ? "YouTube mode uses video transcripts — accuracy depends on transcript availability." :
              isWebMode ? "Web mode uses live data — verify important info." :
                "Please verify important information."}
          </p>
        </div>
      </main>
    </div>
  );
}
