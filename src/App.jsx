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

// ─── SERPER GOOGLE SEARCH ─────────────────────────────────────────────────────
const SERPER_API_KEY = "19caba58c08177639d61cabf7e5430278044545f";

const TODAY_STR = new Date().toLocaleDateString("en-IN", {
  weekday: "long", year: "numeric", month: "long", day: "numeric",
});

// Detect queries that need live/current web data
const CURRENT_TRIGGERS = [
  /\b(today|tonight|now|current|currently|live|latest|recent|breaking|news)\b/i,
  /\b(2024|2025|this (year|month|week|day))\b/i,
  /\b(who (is|was|won|leads|runs)|what is the (score|price|rate|status))\b/i,
  /\b(stock|crypto|bitcoin|market|weather|election|war|match|game|ipl|cricket)\b/i,
  /\b(just (happened|announced|released|launched))\b/i,
  /\b(trending|viral|happening)\b/i,
];

const needsWebSearch = (query) =>
  CURRENT_TRIGGERS.some((rx) => rx.test(query));

/**
 * fetchWebResults — Google Search via Serper API.
 * Returns formatted markdown context string for the AI.
 */
const fetchWebResults = async (query) => {
  const snippets = [];

  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": SERPER_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, gl: "in", hl: "en", num: 8 }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) throw new Error(`Serper error: ${res.status}`);
    const data = await res.json();

    // Answer box — highest priority quick answer
    if (data.answerBox) {
      const ab = data.answerBox;
      const ans = ab.answer || ab.snippet || (ab.snippetHighlighted?.join(" ")) || "";
      if (ans) {
        snippets.push(
          `✅ **Google Answer**:\n${ans}${ab.title ? ` (${ab.title})` : ""}${ab.link ? `\n🔗 ${ab.link}` : ""}`
        );
      }
    }

    // Knowledge graph (e.g. cricket player stats, movie info)
    if (data.knowledgeGraph) {
      const kg = data.knowledgeGraph;
      let kgText = `📊 **${kg.title || ""}**${kg.type ? ` — ${kg.type}` : ""}`;
      if (kg.description) kgText += `\n${kg.description}`;
      if (kg.attributes && Object.keys(kg.attributes).length) {
        const attrs = Object.entries(kg.attributes)
          .slice(0, 6)
          .map(([k, v]) => `  • **${k}**: ${v}`)
          .join("\n");
        kgText += `\n${attrs}`;
      }
      snippets.push(kgText);
    }

    // Sports results (scores, tables — great for IPL, cricket, football)
    if (data.sportsResults) {
      const sr = data.sportsResults;
      let sportText = `🏆 **${sr.title || "Sports Update"}**\n`;
      if (sr.games?.length) {
        sportText += sr.games.slice(0, 5).map(g =>
          `  • ${g.homeTeam} **${g.homeScore ?? ""}** vs ${g.awayTeam} **${g.awayScore ?? ""}** ${g.status ? `— ${g.status}` : ""} ${g.date ? `(${g.date})` : ""}`
        ).join("\n");
      } else {
        sportText += "(See organic results below)";
      }
      snippets.push(sportText);
    }

    // Top news stories
    if (data.topStories?.length) {
      const stories = data.topStories.slice(0, 5).map(s =>
        `  • **${s.title}**\n    Source: ${s.source || "Unknown"} | ${s.date || ""}\n    🔗 ${s.link || ""}`
      ).join("\n");
      snippets.push(`📰 **Top News Stories**:\n${stories}`);
    }

    // Organic Google results
    if (data.organic?.length) {
      const organic = data.organic.slice(0, 6).map((r, i) => {
        let entry = `**${i + 1}. ${r.title}**\n${r.snippet || "No snippet"}`;
        if (r.link) entry += `\n🔗 ${r.link}`;
        if (r.attributes && Object.keys(r.attributes).length) {
          entry += "\n" + Object.entries(r.attributes).slice(0, 3).map(([k,v]) => `  ${k}: ${v}`).join(" | ");
        }
        return entry;
      }).join("\n\n");
      snippets.push(`🌐 **Google Search Results for "${query}"**:\n\n${organic}`);
    }

    // People Also Ask
    if (data.peopleAlsoAsk?.length) {
      const paa = data.peopleAlsoAsk.slice(0, 3).map(p =>
        `  **Q: ${p.question}**\n  ${p.snippet || p.answer || ""}`
      ).join("\n\n");
      snippets.push(`💡 **Related Questions**:\n\n${paa}`);
    }

  } catch (err) {
    console.error("Serper Google search failed:", err?.message);
    return null;
  }

  if (!snippets.length) return null;

  snippets.unshift(`📅 **Live search performed on**: ${TODAY_STR}`);
  return snippets.join("\n\n---\n\n");
};

// ─── TRANSLATIONS ─────────────────────────────────────────────────────────────
const LANGS = {
  en: {
    flag: "🇬🇧", name: "English", t: {
      newChat: "New chat", search: "Search…", logout: "Sign out", send: "Send",
      placeholder: "Message VetroAI…", listening: "Listening…", share: "Share", stop: "Stop",
      welcome: "Good to see you.", welcomeSub: "Ask me anything — I'm here to help.",
      signIn: "Continue", register: "Create account", emailLbl: "Email", passLbl: "Password",
      newHere: "Don't have an account?", signUpFree: "Sign up", haveAcc: "Already have an account?", signInLink: "Sign in",
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
      presets: "Presets", searchInChat: "Search in conversation…", noResults: "No matches", matches: "match",
      shareTitle: "Share conversation", shareNote: "Anyone with this link can view the conversation.",
      pinnedSection: "Pinned", allChats: "Recent", exportChat: "Export",
      chars: "chars", tokens: "tokens", saveAndSend: "Save & send",
      webSearching: "Searching the web…",
      webSearched: "Web search used",
      scList: [
        { keys: ["Ctrl", "K"], desc: "New chat" }, { keys: ["Ctrl", "/"], desc: "Focus input" },
        { keys: ["Ctrl", "P"], desc: "Profile" }, { keys: ["Ctrl", "F"], desc: "Search messages" },
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
      signIn: "जारी रखें", register: "अकाउंट बनाएं", emailLbl: "ईमेल", passLbl: "पासवर्ड",
      newHere: "अकाउंट नहीं है?", signUpFree: "साइन अप करें", haveAcc: "अकाउंट है?", signInLink: "साइन इन",
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
      presets: "प्रीसेट", searchInChat: "बातचीत में खोजें…", noResults: "कोई परिणाम नहीं", matches: "मिला",
      shareTitle: "बातचीत शेयर करें", shareNote: "इस लिंक से बातचीत देखी जा सकती है।",
      pinnedSection: "पिन किए गए", allChats: "हाल ही में", exportChat: "एक्सपोर्ट",
      chars: "अक्षर", tokens: "टोकन", saveAndSend: "सहेजें और भेजें",
      webSearching: "वेब खोज हो रही है…", webSearched: "वेब खोज उपयोग हुई",
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
      signIn: "ಮುಂದುವರಿಯಿರಿ", register: "ಖಾತೆ ರಚಿಸಿ", emailLbl: "ಇಮೇಲ್", passLbl: "ಪಾಸ್‌ವರ್ಡ್",
      newHere: "ಖಾತೆ ಇಲ್ಲವೇ?", signUpFree: "ಸೈನ್ ಅಪ್", haveAcc: "ಖಾತೆ ಇದೆಯೇ?", signInLink: "ಸೈನ್ ಇನ್",
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
      presets: "ಪ್ರೀಸೆಟ್", searchInChat: "ಸಂಭಾಷಣೆಯಲ್ಲಿ ಹುಡುಕಿ…", noResults: "ಫಲಿತಾಂಶಗಳಿಲ್ಲ", matches: "ಹೊಂದಿಕೆ",
      shareTitle: "ಹಂಚಿಕೊಳ್ಳಿ", shareNote: "ಈ ಲಿಂಕ್‌ನಿಂದ ಸಂಭಾಷಣೆ ನೋಡಬಹುದು.",
      pinnedSection: "ಪಿನ್ ಮಾಡಲಾದವು", allChats: "ಇತ್ತೀಚಿನ", exportChat: "ಎಕ್ಸ್‌ಪೋರ್ಟ್",
      chars: "ಅಕ್ಷರ", tokens: "ಟೋಕನ್", saveAndSend: "ಉಳಿಸಿ ಮತ್ತು ಕಳುಹಿಸಿ",
      webSearching: "ವೆಬ್ ಹುಡುಕಾಟ…", webSearched: "ವೆಬ್ ಹುಡುಕಾಟ ಬಳಸಲಾಗಿದೆ",
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
      signIn: "Continuar", register: "Crear cuenta", emailLbl: "Correo", passLbl: "Contraseña",
      newHere: "¿Sin cuenta?", signUpFree: "Regístrate", haveAcc: "¿Ya tienes cuenta?", signInLink: "Inicia sesión",
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
      presets: "Presets", searchInChat: "Buscar en conversación…", noResults: "Sin resultados", matches: "coincidencia",
      shareTitle: "Compartir conversación", shareNote: "Cualquiera con este enlace puede ver la conversación.",
      pinnedSection: "Fijados", allChats: "Recientes", exportChat: "Exportar",
      chars: "caract.", tokens: "tokens", saveAndSend: "Guardar y enviar",
      webSearching: "Buscando en la web…", webSearched: "Búsqueda web usada",
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
  { id: "web_search",   name: "🌐 Web Search" },  // ← NEW
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

const SendIcon   = () => <Ic size={15} sw={2} fill="currentColor" d={<><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" fill="currentColor" stroke="none" /></>} />;
const MicIcon    = () => <Ic size={17} d={<><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></>} />;
const WaveIcon   = () => <svg width={17} height={17} viewBox="0 0 24 24" fill="currentColor"><rect x="11" y="3" width="2" height="18" rx="1" /><rect x="7" y="8" width="2" height="8" rx="1" /><rect x="15" y="8" width="2" height="8" rx="1" /><rect x="3" y="10" width="2" height="4" rx="1" /><rect x="19" y="10" width="2" height="4" rx="1" /></svg>;
const StopIcon   = () => <Ic size={15} d={<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />} />;
const CopyIcon   = () => <Ic size={14} d={<><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>} />;
const EditIcon   = () => <Ic size={14} d={<><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></>} />;
const SpeakIcon  = () => <Ic size={14} d={<><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" /></>} />;
const ReloadIcon = () => <Ic size={14} d={<><path d="M21.5 2v6h-6" /><path d="M2.5 22v-6h6" /><path d="M2 11.5a10 10 0 0 1 18.8-4.3" /><path d="M22 12.5a10 10 0 0 1-18.8 4.3" /></>} />;
const TrashIcon  = () => <Ic size={13} d={<><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>} />;
const XIcon      = () => <Ic size={18} d={<><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>} />;
const MenuIcon   = () => <Ic size={19} d={<><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /></>} />;
const PlusIcon   = () => <Ic size={14} d={<><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>} />;
const SearchIcon = () => <Ic size={14} d={<><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>} />;
const CheckIcon  = () => <Ic size={13} d="M20 6L9 17L4 12" />;
const PinIcon    = () => <Ic size={13} d={<><path d="M12 2l2 6h4l-3.3 2.4 1.3 6L12 13l-4 3.4 1.3-6L6 8h4z" /></>} />;
const BotIcon    = () => <Ic size={14} d={<><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /></>} />;
const UserIcon   = () => <Ic size={14} d={<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>} />;
const GlobeIcon  = () => <Ic size={14} d={<><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>} />;
const KbdIcon    = () => <Ic size={14} d={<><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" /></>} />;
const SunIcon    = () => <Ic size={15} d={<><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></>} />;
const MoonIcon   = () => <Ic size={15} d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />;
const ShareIcon  = () => <Ic size={14} d={<><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></>} />;
const DlIcon     = () => <Ic size={14} d={<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>} />;
const SmileIcon  = () => <Ic size={14} d={<><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></>} />;
const BoldIcon   = () => <Ic size={13} d={<><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" /><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" /></>} />;
const ItalicIcon = () => <Ic size={13} d={<><line x1="19" y1="4" x2="10" y2="4" /><line x1="14" y1="20" x2="5" y2="20" /><line x1="15" y1="4" x2="9" y2="20" /></>} />;
const CodeIc2    = () => <Ic size={13} d={<><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></>} />;
const ChevDown   = () => <Ic size={12} d="M6 9l6 6 6-6" />;

// Web search pulse icon
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
  try {
    return String(txt).split("\\[").join("$$").split("\\]").join("$$").split("\\(").join("$").split("\\)").join("$");
  } catch { return txt; }
};

// ─── PROFILE MODAL ────────────────────────────────────────────────────────────
function ProfileModal({ onClose, t, langCode, setLangCode, theme, setTheme }) {
  const PKEY = "vetroai_profile";
  const init = JSON.parse(localStorage.getItem(PKEY) || '{"name":"","avatar":"🧑"}');
  const [tab, setTab]       = useState("profile");
  const [name, setName]     = useState(init.name || "");
  const [avatar, setAvatar] = useState(init.avatar || "🧑");
  const [ok, setOk]         = useState(false);
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
            <div className="av-center"><div className="av-big">{avatar}</div></div>
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

// ─── SYSTEM PROMPT MODAL ──────────────────────────────────────────────────────
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

// ─── SHARE MODAL ──────────────────────────────────────────────────────────────
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
            <button className="btn-ghost wide" onClick={exportTxt}><DlIcon />Download .txt</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── REACTION PICKER ──────────────────────────────────────────────────────────
function ReactionPicker({ onPick, onClose }) {
  return (
    <div className="rxn-picker">
      {REACTIONS.map(r => <button key={r} className="rxn-opt" onClick={() => { onPick(r); onClose(); }}>{r}</button>)}
    </div>
  );
}

// ─── WEB SEARCH INDICATOR ─────────────────────────────────────────────────────
function WebSearchBadge({ searching, t }) {
  return (
    <div className={`web-search-badge${searching ? " searching" : ""}`}>
      {searching ? <><WebSpinIcon /> {t.webSearching}</> : <><GlobeIcon /> {t.webSearched}</>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
//  MAIN APP
// ════════════════════════════════════════════════════════════
export default function App() {
  const [theme,    setTheme]    = useState(() => localStorage.getItem("vetroai_theme") || "light");
  const [langCode, setLangCode] = useState(() => localStorage.getItem("vetroai_lang") || "en");
  const t = LANGS[langCode]?.t || LANGS.en.t;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("vetroai_theme", theme);
  }, [theme]);

  const [user,        setUser]        = useState(localStorage.getItem("token"));
  const [authMode,    setAuthMode]    = useState("login");
  const [email,       setEmail]       = useState("");
  const [password,    setPassword]    = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const [sessions,          setSessions]          = useState([]);
  const [currentSessionId,  setCurrentSessionId]  = useState(null);
  const [histSearch,        setHistSearch]        = useState("");
  const [pinnedIds,         setPinnedIds]         = useState(() => JSON.parse(localStorage.getItem("vetroai_pins") || "[]"));
  const [isSidebarOpen,     setIsSidebarOpen]     = useState(false);

  const [messages,      setMessages]      = useState([]);
  const [input,         setInput]         = useState("");
  const [editIdx,       setEditIdx]       = useState(null);
  const [editInput,     setEditInput]     = useState("");
  const [selectedMode,  setSelectedMode]  = useState(MODES[0].id);
  const [selFile,       setSelFile]       = useState(null);
  const [filePreview,   setFilePreview]   = useState(null);
  const [isLoading,     setIsLoading]     = useState(false);
  const [isTyping,      setIsTyping]      = useState(false);
  const [showScrollDn,  setShowScrollDn]  = useState(false);
  const [reactions,     setReactions]     = useState({});
  const [rxnFor,        setRxnFor]        = useState(null);
  const abortRef = useRef(null);

  // ── Web search state ──────────────────────────────────────
  const [isWebSearching,    setIsWebSearching]    = useState(false);
  const [webSearchedMsgIdx, setWebSearchedMsgIdx] = useState(null); // index of msg that used web search
  const [autoWebSearch,     setAutoWebSearch]     = useState(true);  // auto-detect for non-web_search modes

  const [chatSearchOpen,   setChatSearchOpen]   = useState(false);
  const [chatSearchQuery,  setChatSearchQuery]  = useState("");
  const [chatSearchCursor, setChatSearchCursor] = useState(0);
  const chatSearchResults = useMemo(() => {
    if (!chatSearchQuery.trim()) return [];
    const q = chatSearchQuery.toLowerCase();
    return messages.reduce((a, m, i) => { if (m.content?.toLowerCase().includes(q)) a.push(i); return a; }, []);
  }, [messages, chatSearchQuery]);

  const [showProfile,    setShowProfile]    = useState(false);
  const [showSysPrompt,  setShowSysPrompt]  = useState(false);
  const [showShare,      setShowShare]      = useState(false);
  const [systemPrompt,   setSystemPrompt]   = useState(() => localStorage.getItem("vetroai_sysprompt") || "");

  useEffect(() => { localStorage.setItem("vetroai_sysprompt", systemPrompt); }, [systemPrompt]);

  const [autoSpeak,    setAutoSpeak]    = useState(false);
  const [isListening,  setIsListening]  = useState(false);
  const [isVoiceOpen,  setIsVoiceOpen]  = useState(false);

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

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  useEffect(() => {
    document.body.style.overflow = (isSidebarOpen || showProfile || showSysPrompt || showShare) ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [isSidebarOpen, showProfile, showSysPrompt, showShare]);

  useEffect(() => { localStorage.setItem("vetroai_pins", JSON.stringify(pinnedIds)); }, [pinnedIds]);

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
        if (showProfile) { setShowProfile(false); return; }
        if (showSysPrompt) { setShowSysPrompt(false); return; }
        if (showShare) { setShowShare(false); return; }
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
  }, [showProfile, showSysPrompt, showShare, isSidebarOpen, isVoiceOpen, chatSearchOpen]);

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

  const loadSession = id => {
    const s = sessions.find(x => x.id === id);
    if (s) { setMessages(s.messages || []); setCurrentSessionId(id); stopSpeak(); setIsSidebarOpen(false); isScrolling.current = false; }
  };
  const newChat = useCallback(() => {
    setMessages([]); setCurrentSessionId(null); setInput(""); stopSpeak();
    setIsSidebarOpen(false); setReactions({}); setWebSearchedMsgIdx(null);
  }, []);
  const deleteSession = id => {
    const list = sessions.filter(s => s.id !== id); setSessions(list);
    try { localStorage.setItem("vetroai_sessions_" + user, JSON.stringify(list)); } catch { }
    if (currentSessionId === id) newChat();
    setPinnedIds(p => p.filter(x => x !== id));
  };
  const togglePin = (e, id) => { e.stopPropagation(); setPinnedIds(p => p.includes(id) ? p.filter(x => x !== id) : [id, ...p]); };

  const { pinnedSessions, groupedSessions } = useMemo(() => {
    const filtered = sessions.filter(s => s?.title?.toLowerCase().includes(histSearch.toLowerCase()));
    const pinned   = filtered.filter(s => pinnedIds.includes(s.id));
    const rest     = filtered.filter(s => !pinnedIds.includes(s.id));
    const groups   = {};
    rest.forEach(s => { const g = getDateGroup(s.id, t); if (!groups[g]) groups[g] = []; groups[g].push(s); });
    return { pinnedSessions: pinned, groupedSessions: groups };
  }, [sessions, histSearch, pinnedIds, t]);

  const dateOrder = [t.today, t.yesterday, t.older];

  const handleAuth = async () => {
    setAuthLoading(true);
    try {
      const res = await fetch(API + (authMode === "login" ? "/login" : "/signup"), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (data.token) { localStorage.setItem("token", data.token); setUser(data.token); }
      else alert(data.error || data.message);
    } catch { alert("Connection failed. Make sure the server is running."); }
    finally { setAuthLoading(false); }
  };
  const logout = () => { localStorage.removeItem("token"); setUser(null); setMessages([]); setCurrentSessionId(null); };

  const stopSpeak = () => window.speechSynthesis?.cancel();
  const speak = txt => {
    if (!window.speechSynthesis) return; stopSpeak();
    const c = (txt || "").replace(/[*#_`~]/g, "").replace(/\$\$.*?\$\$/gs, "[equation]").replace(/\$.*?\$/g, "[math]");
    if (!c.trim()) return;
    const u = new SpeechSynthesisUtterance(c);
    const vs = window.speechSynthesis.getVoices();
    u.voice = vs.find(v => v.name.includes("AriaNeural")) || vs.find(v => v.name === "Google US English") || vs.find(v => v.lang === "en-US") || vs[0];
    u.pitch = 0.95; u.rate = 1.05;
    u.onstart = () => { try { recogRef.current?.stop(); } catch { } setIsListening(false); };
    u.onend   = () => { if (voiceRef.current) { setInput(""); try { recogRef.current?.start(); setIsListening(true); } catch { } } };
    window.speechSynthesis.speak(u);
  };

  useEffect(() => {
    const lv = () => window.speechSynthesis.getVoices(); lv();
    if (window.speechSynthesis.onvoiceschanged !== undefined) window.speechSynthesis.onvoiceschanged = lv;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return;
    const sr = new SR(); sr.interimResults = true;
    sr.onresult = e => { if (window.speechSynthesis.speaking) return; let txt = ""; for (let i = e.resultIndex; i < e.results.length; i++) txt += e.results[i][0].transcript; setInput(txt); };
    sr.onend    = () => { setIsListening(false); if (voiceRef.current) { const cur = inputRef.current || ""; if (cur.trim() && !loadRef.current && !window.speechSynthesis.speaking) submitVoice(cur); else setTimeout(() => { if (voiceRef.current && !loadRef.current && !window.speechSynthesis.speaking) try { recogRef.current?.start(); setIsListening(true); } catch { } }, 800); } };
    sr.onerror  = e => { setIsListening(false); if (e.error === "not-allowed") { setIsVoiceOpen(false); alert("Microphone access denied."); } };
    recogRef.current = sr;
  }, []);

  const toggleMic  = e => { e?.preventDefault(); if (!recogRef.current) return; if (isListening) recogRef.current.stop(); else { setInput(""); recogRef.current.start(); setIsListening(true); } };
  const openVoice  = e => { e.preventDefault(); window.speechSynthesis.speak(new SpeechSynthesisUtterance("")); setAutoSpeak(true); setIsVoiceOpen(true); if (!isListening) { setInput(""); try { recogRef.current?.start(); setIsListening(true); } catch { } } };
  const closeVoice = () => { setIsVoiceOpen(false); if (isListening) recogRef.current?.stop(); setIsListening(false); stopSpeak(); };
  const handleOrb  = () => { if (isLoading) return; if (window.speechSynthesis.speaking) { stopSpeak(); setInput(""); try { recogRef.current?.start(); setIsListening(true); } catch { } } else if (isListening) recogRef.current?.stop(); else { setInput(""); try { recogRef.current?.start(); setIsListening(true); } catch { } } };

  const handleFileChange = e => { const f = e.target.files[0]; if (!f) return; setSelFile(f); if (f.type.startsWith("image/")) { const r = new FileReader(); r.onloadend = () => setFilePreview(r.result); r.readAsDataURL(f); } };
  const stopGeneration   = () => { abortRef.current?.abort(); setIsLoading(false); setIsTyping(false); setIsWebSearching(false); };

  // ─── ENHANCED triggerAI with web search ───────────────────────────────────
  const triggerAI = async (hist, fileData = null) => {
    const ctrl = new AbortController(); abortRef.current = ctrl;
    setIsLoading(true); setIsTyping(true); scrollToBottom(); stopSpeak();

    const userQuery = hist[hist.length - 1]?.content || "";
    const isWebMode = selectedMode === "web_search";
    const shouldSearch = isWebMode || (autoWebSearch && needsWebSearch(userQuery));

    let webContext = null;

    // ── Step 1: Web search (if needed) ──────────────────────
    if (shouldSearch) {
      setIsWebSearching(true);
      webContext = await fetchWebResults(userQuery);
      setIsWebSearching(false);
    }

    const fd = new FormData();
    fd.append("input", userQuery);
    fd.append("model", isWebMode ? "fast_chat" : selectedMode); // web_search uses fast_chat model

    // Build context with optional web results injected
    const ctx = hist.slice(-10).map(m => ({ role: m.role, content: m.content }));

    // ── Build system instruction ─────────────────────────────────────────
    const now        = new Date();
    const nowStr     = now.toLocaleDateString("en-IN", { weekday:"long", year:"numeric", month:"long", day:"numeric" });
    const nowISO     = now.toISOString().slice(0,10); // e.g. "2026-02-28"
    const nowMs      = now.getTime();

    // Helper the AI can't get wrong: compare a date string to today
    // We embed it as plain text instructions instead
    let sysContent = [
      `════════════════════════════════════════`,
      `SYSTEM: DATE & TEMPORAL REASONING RULES`,
      `════════════════════════════════════════`,
      `TODAY IS: ${nowStr} (${nowISO}).`,
      `You are answering ON this exact date. Use it for ALL temporal reasoning.`,
      ``,
      `STRICT DATE LOGIC — follow these precisely:`,
      `• If a search result says an event starts on a FUTURE date (after ${nowISO}), say "has NOT started yet, starts on [date]".`,
      `• If a search result says an event starts on a PAST date (before ${nowISO}), say "has started / is ongoing".`,
      `• If a search result says an event date is TODAY (${nowISO}), say "starts today".`,
      `• NEVER say an event "has already started" unless its start date is strictly before ${nowISO}.`,
      `• NEVER say an event "hasn't happened yet" unless its date is strictly after ${nowISO}.`,
      `• When in doubt about a date, quote the date from the search result exactly and let the user decide.`,
      `• Your training cutoff is October 2024. For anything after that, rely ONLY on the search results.`,
      systemPrompt || "",
    ].filter(Boolean).join("\n");

    if (isWebMode) {
      sysContent = "You are VetroAI in 🌐 Web Search Mode.\n" + sysContent;
    }

    // Inject live search results as highest-priority context
    if (shouldSearch && webContext) {
      sysContent +=
        `\n\n${"━".repeat(50)}` +
        `\n🌐 LIVE GOOGLE SEARCH RESULTS — treat as ground truth:` +
        `\n${"━".repeat(50)}` +
        `\n\n${webContext}` +
        `\n\n${"━".repeat(50)}` +
        `\n\nRULES FOR USING SEARCH RESULTS:` +
        `\n1. Extract exact dates from results, then compare to TODAY (${nowISO}) before saying started/not started.` +
        `\n2. Quote numbers, scores, and stats exactly as they appear — do not round or estimate.` +
        `\n3. Cite the source name or URL for key facts.` +
        `\n4. If results conflict, mention both versions and note the discrepancy.` +
        `\n5. If no result directly answers the question, say "The search results don't clearly show X".`;
    } else if (shouldSearch && !webContext) {
      sysContent +=
        `\n\n⚠️ Web search returned no results for this query.` +
        `\nYou MUST tell the user your data may be outdated (cutoff Oct 2024) and suggest they check Google, Cricbuzz, ESPN, NDTV, etc.`;
    }

    if (sysContent.trim()) ctx.unshift({ role: "system", content: sysContent });
    fd.append("messages", JSON.stringify(ctx));
    if (fileData) fd.append("file", fileData);

    // Track which assistant message index used web search
    const assistantMsgIdx = hist.length;

    try {
      const res = await fetch(API + "/chat", {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: fd,
        signal: ctrl.signal
      });
      if (res.status === 401) { logout(); return; }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let bot = "";
      const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      setIsTyping(false);
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "",
        timestamp: ts,
        usedWebSearch: shouldSearch && !!webContext,
      }]);

      if (shouldSearch && webContext) setWebSearchedMsgIdx(assistantMsgIdx);

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
    } catch (err) {
      setIsLoading(false); setIsTyping(false); setIsWebSearching(false);
      if (err.name !== "AbortError") alert("Error connecting to server.");
    } finally {
      setSelFile(null); setFilePreview(null);
    }
  };

  const submitVoice = txt => {
    try { recogRef.current?.stop(); } catch { } setIsListening(false);
    const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const hist = [...msgsRef.current, { role: "user", content: txt, file: null, timestamp: ts }];
    setMessages(hist); setInput(""); triggerAI(hist);
  };

  const sendMessage = (e, prefill) => {
    e?.preventDefault();
    const text = prefill || input;
    if (!text.trim() && !selFile) return;
    if (isListening) recogRef.current?.stop();
    const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const hist = [...messages, { role: "user", content: text, file: selFile ? { preview: filePreview } : null, timestamp: ts }];
    setMessages(hist); setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    triggerAI(hist, selFile);
  };

  const handleKeyDown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!isLoading) sendMessage(); } };
  const submitEdit    = idx => {
    if (!editInput.trim()) return; stopSpeak();
    const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const hist = [...messages.slice(0, idx), { role: "user", content: editInput, timestamp: ts }];
    setMessages(hist); setEditIdx(null); triggerAI(hist);
  };
  const handleRegen = idx => { if (idx === 0) return; const hist = messages.slice(0, idx); setMessages(hist); triggerAI(hist); };

  const addRxn    = (i, r) => setReactions(p => ({ ...p, [i]: [...(p[i] || []).filter(x => x !== r), r] }));
  const removeRxn = (i, r) => setReactions(p => ({ ...p, [i]: (p[i] || []).filter(x => x !== r) }));

  const insertFmt = (pre, suf = "") => {
    if (!textareaRef.current) return;
    const { selectionStart: s, selectionEnd: e, value: v } = textareaRef.current;
    const sel = v.slice(s, e);
    setInput(v.slice(0, s) + pre + (sel || "text") + suf + v.slice(e));
    setTimeout(() => { if (textareaRef.current) { textareaRef.current.focus(); textareaRef.current.setSelectionRange(s + pre.length, s + pre.length + (sel || "text").length); } }, 0);
  };

  const profileData = useMemo(() => JSON.parse(localStorage.getItem("vetroai_profile") || '{"name":"","avatar":"🧑"}'), [showProfile]);
  const charCount   = input.length;
  const tokenEst    = Math.ceil(charCount / 4);
  const isEmpty     = !input.trim() && !selFile;
  const isWebMode   = selectedMode === "web_search";

  // ─── AUTH ─────────────────────────────────────────────────────────────────
  if (!user) return (
    <div className="auth-page">
      <div className="auth-glow" />
      <div className="auth-box">
        <div className="auth-logo">
          <div className="auth-logo-mark">V</div>
          <div className="auth-logo-text">
            <span className="logo-name">VetroAI</span>
            <span className="logo-ver">v1.0</span>
          </div>
        </div>
        <p className="auth-tagline">{authMode === "login" ? "Welcome back." : "Create your account."}</p>
        <div className="auth-fields">
          <div className="auth-field">
            <label>{t.emailLbl}</label>
            <input type="email" placeholder="you@example.com" value={email}
              onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAuth()} />
          </div>
          <div className="auth-field">
            <label>{t.passLbl}</label>
            <input type="password" placeholder="••••••••" value={password}
              onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAuth()} />
          </div>
        </div>
        <button className={`auth-btn${authLoading ? " loading" : ""}`} onClick={handleAuth} disabled={authLoading}>
          {authLoading ? <span className="auth-spin" /> : (authMode === "login" ? t.signIn : t.register)}
        </button>
        <p className="auth-switch" onClick={() => setAuthMode(authMode === "login" ? "signup" : "login")}>
          {authMode === "login"
            ? <>{t.newHere} <span>{t.signUpFree}</span></>
            : <>{t.haveAcc} <span>{t.signInLink}</span></>}
        </p>
      </div>
    </div>
  );

  // ─── MAIN UI ──────────────────────────────────────────────────────────────
  return (
    <div className="shell">
      {showProfile   && <ProfileModal onClose={() => setShowProfile(false)} t={t} langCode={langCode} setLangCode={setLangCode} theme={theme} setTheme={setTheme} />}
      {showSysPrompt && <SysPromptModal onClose={() => setShowSysPrompt(false)} t={t} value={systemPrompt} setValue={setSystemPrompt} />}
      {showShare     && <ShareModal onClose={() => setShowShare(false)} t={t} messages={messages} />}

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
            <button className="icon-btn av-btn" onClick={() => setShowProfile(true)} title={t.profile}>
              {profileData.avatar}
            </button>
          </div>
        </div>

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
                  <button onClick={e => togglePin(e, s.id)} title={t.unpin}><PinIcon /></button>
                  <button onClick={e => { e.stopPropagation(); deleteSession(s.id); }} title={t.del} className="del-btn"><TrashIcon /></button>
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
                    <button onClick={e => togglePin(e, s.id)} title={t.pin}><PinIcon /></button>
                    <button onClick={e => { e.stopPropagation(); deleteSession(s.id); }} title={t.del} className="del-btn"><TrashIcon /></button>
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
          {/* Auto web search toggle */}
          <div className="mode-row" style={{ cursor: "pointer" }} onClick={() => setAutoWebSearch(v => !v)}>
            <GlobeIcon />
            <span style={{ flex: 1, fontSize: "0.82rem", color: "var(--ink)" }}>Auto Web Search</span>
            <div className={`toggle-pill${autoWebSearch ? " on" : ""}`}>
              <div className="toggle-thumb" />
            </div>
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
            <div className={`mode-pill${isWebMode ? " web-mode-pill" : ""}`}>
              {MODES.find(m => m.id === selectedMode)?.name}
              {isWebMode && <span className="web-live-dot" />}
            </div>
            {autoWebSearch && !isWebMode && (
              <div className="mode-pill" style={{ fontSize: "0.7rem", gap: 4, opacity: 0.7 }}>
                <GlobeIcon /> Auto
              </div>
            )}
          </div>
          <div className="ch-right">
            <button className="icon-btn" onClick={() => setChatSearchOpen(v => !v)} title="Search (Ctrl+F)"><SearchIcon /></button>
            <button className="icon-btn" onClick={() => setShowSysPrompt(true)} title={t.systemPrompt}><BotIcon /></button>
            <button className="icon-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <SunIcon /> : <MoonIcon />}</button>
            {messages.length > 0 && <button className="share-btn" onClick={() => setShowShare(true)}><ShareIcon /><span>{t.share}</span></button>}
          </div>
        </header>

        {/* Web searching banner */}
        {isWebSearching && (
          <div className="web-searching-bar">
            <WebSpinIcon />
            <span>{t.webSearching}</span>
            <div className="web-search-dots">
              <span /><span /><span />
            </div>
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
              <div className="welcome-avatar">V</div>
              <h2 className="welcome-title">{t.welcome}</h2>
              <p className="welcome-sub">{t.welcomeSub}</p>
              {systemPrompt && <div className="sys-badge"><BotIcon />{t.systemPromptBadge}</div>}
              {isWebMode && (
                <div className="sys-badge" style={{ background: "rgba(59,130,246,0.1)", borderColor: "rgba(59,130,246,0.25)", color: "#3b82f6" }}>
                  <GlobeIcon /> Web Search Mode — Live results enabled
                </div>
              )}
              <div className="suggestions">
                {(isWebMode
                  ? ["What's trending in tech today?", "Latest AI news", "Current stock market summary", "Recent sports results", "Today's top headlines", "Latest cricket score"]
                  : (t.suggestions || [])
                ).map((s, i) => (
                  <button key={i} className="sug" style={{ "--d": `${i * 0.06}s` }} onClick={() => sendMessage(null, s)}>{s}</button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, idx) => {
            const highlighted = chatSearchQuery && chatSearchResults.includes(idx);
            const msgRxns = reactions[idx] || [];
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
                      {/* Web search badge on assistant messages */}
                      {msg.role === "assistant" && msg.usedWebSearch && (
                        <div className="web-search-badge used">
                          <GlobeIcon /> {t.webSearched}
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
                          }
                        }}>
                        {formatMath(msg.content)}
                      </ReactMarkdown>
                    </div>
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
                        <div style={{ position: "relative" }}>
                          <button onClick={e => { e.stopPropagation(); setRxnFor(rxnFor === idx ? null : idx); }} title="React"><SmileIcon /></button>
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
          {isWebMode && (
            <div className="sys-strip" style={{ background: "rgba(59,130,246,0.08)", borderColor: "rgba(59,130,246,0.2)", color: "#3b82f6" }}>
              <GlobeIcon />
              <span>Web Search Mode — fetching live results for every query</span>
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
            <button type="button" className="attach-btn" onClick={() => fileInputRef.current.click()} title="Attach">📎</button>
            <textarea ref={textareaRef}
              placeholder={
                isListening && !isVoiceOpen ? t.listening :
                isWebMode ? "Search the web with AI…" :
                t.placeholder
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
                  : <button type="submit" className={`send-btn${isWebMode ? " web-send" : ""}`}><SendIcon /></button>
              }
            </div>
          </form>
          <p className="input-note">VetroAI can make mistakes. {isWebMode ? "Web Search mode uses live data — always verify." : "Please verify important information."}</p>
        </div>
      </main>
    </div>
  );
}