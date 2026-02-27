import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css"; 
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import "./App.css";



const MODES = [
  { id: "vtu_academic", name: "🎓 VTU Academic Mode" },
  { id: "debugger", name: "🐛 Smart Debugger" },
  { id: "astrology", name: "🔮 Astrologer Mode" },
  { id: "fast_chat", name: "⚡ Fast Chat" }
];

// --- SVGs ---
const CopyIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>;
const EditIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>;
const SpeakerIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>;
const StopIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="6" width="12" height="12"></rect></svg>;
const ShareIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>;
const MicIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>;
const SendIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>;
const MenuIcon = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>;
const ReloadIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>;
const TrashIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>;
const XIcon = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>;
const WaveIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="11" y="4" width="2" height="16" rx="1"></rect><rect x="7" y="9" width="2" height="6" rx="1"></rect><rect x="15" y="9" width="2" height="6" rx="1"></rect><rect x="3" y="11" width="2" height="2" rx="1"></rect><rect x="19" y="11" width="2" height="2" rx="1"></rect></svg>
);

// --- SAFE COMPONENTS ---
const CodeBlock = ({ match, codeString }) => {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(codeString); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <div className="code-block-wrapper">
      <div className="code-block-header"><span>{match ? match[1] : 'code'}</span><button onClick={copy}>{copied ? "Copied!" : <CopyIcon />}</button></div>
      <SyntaxHighlighter style={vscDarkPlus} language={match ? match[1] : 'text'} PreTag="div" customStyle={{ margin: 0, padding: '16px', background: 'transparent' }}>
        {codeString}
      </SyntaxHighlighter>
    </div>
  );
};

const formatMath = (text) => {
  if (!text) return "";
  try {
    let formatted = String(text);
    formatted = formatted.split('\\[').join('$$');
    formatted = formatted.split('\\]').join('$$');
    formatted = formatted.split('\\(').join('$');
    formatted = formatted.split('\\)').join('$');
    formatted = formatted.replace(/(P\([^)]+\)\s*=\s*[0-9.x*+\/ -]+)/g, (match) => `$$${match}$$`);
    return formatted;
  } catch (e) { return text; }
};

// --- MAIN APP ---
export default function App() {
  const [user, setUser] = useState(localStorage.getItem("token"));
  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  
  const [editingIndex, setEditingIndex] = useState(null);
  const [editInput, setEditInput] = useState("");

  const [selectedMode, setSelectedMode] = useState(MODES[0].id);
  const [selectedFile, setSelectedFile] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isVoiceModeOpen, setIsVoiceModeOpen] = useState(false);

  const messagesEndRef = useRef(null); 
  const recognitionRef = useRef(null);
  const fileInputRef = useRef(null);
  const chatFeedRef = useRef(null);
  const textareaRef = useRef(null); // Reference for auto-expanding textbox
  
  const isUserScrolling = useRef(false);
  const [showScrollDown, setShowScrollDown] = useState(false);

  const inputRef = useRef(input);
  const isVoiceModeOpenRef = useRef(isVoiceModeOpen);
  const messagesRef = useRef(messages);
  const isLoadingRef = useRef(isLoading);

  useEffect(() => { inputRef.current = input; }, [input]);
  useEffect(() => { isVoiceModeOpenRef.current = isVoiceModeOpen; }, [isVoiceModeOpen]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);

  // 🛑 GHOST VOICE KILLER
  useEffect(() => {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }, []);

  // 📏 AUTO-EXPAND TEXTBOX LOGIC
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  const handleScroll = () => {
    if (!chatFeedRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = chatFeedRef.current;
    const isUp = scrollHeight - scrollTop - clientHeight > 100;
    isUserScrolling.current = isUp;
    setShowScrollDown(isUp);
  };

  const scrollToBottom = () => {
    if (chatFeedRef.current) {
      chatFeedRef.current.scrollTop = chatFeedRef.current.scrollHeight;
      isUserScrolling.current = false;
      setShowScrollDown(false);
    }
  };

  useEffect(() => {
    if (chatFeedRef.current && !isUserScrolling.current) {
      chatFeedRef.current.scrollTop = chatFeedRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (user) {
      try {
        const saved = localStorage.getItem("vetroai_sessions_" + user);
        if (saved) setSessions(JSON.parse(saved) || []);
      } catch (err) { setSessions([]); }
    }
  }, [user]);

  useEffect(() => {
    if (messages.length > 0 && user) {
      try {
        let currentId = currentSessionId;
        let newSessions = [...sessions];
        let safeTitle = messages[0]?.content ? messages[0].content.substring(0, 30) + "..." : "New Chat";

        if (!currentId) {
          currentId = Date.now().toString();
          setCurrentSessionId(currentId);
          newSessions.unshift({ id: currentId, title: safeTitle, messages: messages });
        } else {
          const index = newSessions.findIndex(s => s.id === currentId);
          if (index !== -1) newSessions[index].messages = messages;
        }
        setSessions(newSessions);
        localStorage.setItem("vetroai_sessions_" + user, JSON.stringify(newSessions));
      } catch (err) {}
    }
  }, [messages]);

  const loadSession = (id) => {
    const session = sessions.find(s => s.id === id);
    if (session) { 
      setMessages(session.messages || []); 
      setCurrentSessionId(id); 
      stopSpeak(); 
      setIsSidebarOpen(false); 
      isUserScrolling.current = false; 
      setShowScrollDown(false);
    }
  };

  const createNewChat = () => { setMessages([]); setCurrentSessionId(null); setInput(""); stopSpeak(); setIsSidebarOpen(false); };

  const deleteSession = (id) => {
    const newSessions = sessions.filter(s => s.id !== id);
    setSessions(newSessions);
    try { localStorage.setItem("vetroai_sessions_" + user, JSON.stringify(newSessions)); } catch(e){}
    if (currentSessionId === id) createNewChat();
  };

  const filteredSessions = (sessions || []).filter(s => s?.title?.toLowerCase().includes((searchQuery || "").toLowerCase()));

  const handleAuth = async () => {
    const endpoint = authMode === "login" ? "/login" : "/signup";
    try {
      const res = await fetch(API + endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const data = await res.json();
      if (data.token) { localStorage.setItem("token", data.token); setUser(data.token); } 
      else alert(data.error || data.message);
    } catch(err) { alert("Server connection failed."); }
  };
  
  const logout = () => { localStorage.removeItem("token"); setUser(null); setMessages([]); setCurrentSessionId(null); };

  // --- 🗣️ VOICE ENGINE ---
  const stopSpeak = () => {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  };

  const speak = (text) => {
    if (!window.speechSynthesis) return;
    stopSpeak(); 
    
    let cleanText = (text || "").replace(/[*#_`~]/g, "");
    cleanText = cleanText.replace(/\$\$.*?\$\$/g, " [equation] ");
    cleanText = cleanText.replace(/\$.*?\$/g, " [math] ");
    if (!cleanText.trim()) return;

    const utter = new SpeechSynthesisUtterance(cleanText);
    const voices = window.speechSynthesis.getVoices();
    
    utter.voice = voices.find(v => v.name.includes("AriaNeural")) || 
                  voices.find(v => v.name === "Google US English") || 
                  voices.find(v => v.name.includes("Premium")) || 
                  voices.find(v => v.lang === "en-US") || voices[0];
    utter.pitch = 0.95; utter.rate = 1.05;
    
    utter.onstart = () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch(e){}
      }
      setIsListening(false);
    };

    utter.onend = () => {
      if (isVoiceModeOpenRef.current) {
        setInput(""); 
        if (recognitionRef.current) {
          try { recognitionRef.current.start(); setIsListening(true); } catch(e){}
        }
      }
    };
    
    window.speechSynthesis.speak(utter);
  };

  // --- 🎙️ SPEECH RECOGNITION ---
  useEffect(() => {
    const loadVoices = () => window.speechSynthesis.getVoices();
    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) window.speechSynthesis.onvoiceschanged = loadVoices;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const sr = new SR();
    sr.interimResults = true;
    
    sr.onresult = (e) => {
      if (window.speechSynthesis.speaking) return; 

      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) text += e.results[i][0].transcript;
      setInput(text);
    };

    sr.onend = () => {
      setIsListening(false);
      
      if (isVoiceModeOpenRef.current) {
        const currentInput = inputRef.current || "";
        
        if (currentInput.trim() !== "" && !isLoadingRef.current && !window.speechSynthesis.speaking) {
          submitFromVoiceMode(currentInput);
        } else {
          setTimeout(() => {
            if (isVoiceModeOpenRef.current && recognitionRef.current && !isLoadingRef.current && !window.speechSynthesis.speaking) {
              try { recognitionRef.current.start(); setIsListening(true); } catch(e){}
            }
          }, 800); 
        }
      }
    };

    sr.onerror = (e) => {
      setIsListening(false);
      if (e.error === 'not-allowed') {
        setIsVoiceModeOpen(false);
        alert("Microphone access denied.");
      }
    };
    
    recognitionRef.current = sr;
  }, []);

  const toggleMic = (e) => {
    if(e) e.preventDefault();
    if (!recognitionRef.current) return;
    if (isListening) recognitionRef.current.stop();
    else { setInput(""); recognitionRef.current.start(); setIsListening(true); }
  };

  const openVoiceMode = (e) => {
    e.preventDefault();
    const unlock = new SpeechSynthesisUtterance(""); 
    window.speechSynthesis.speak(unlock); 
    setAutoSpeak(true);
    setIsVoiceModeOpen(true);
    if (!isListening && recognitionRef.current) {
      setInput("");
      try { recognitionRef.current.start(); setIsListening(true); } catch(e){}
    }
  };

  const closeVoiceMode = () => {
    setIsVoiceModeOpen(false);
    if (isListening && recognitionRef.current) recognitionRef.current.stop();
    setIsListening(false);
    stopSpeak();
  };

  const handleOrbClick = () => {
    if (isLoading) return; 
    
    if (window.speechSynthesis.speaking) {
      stopSpeak();
      setInput("");
      try { recognitionRef.current?.start(); setIsListening(true); } catch(e) {}
    } else if (isListening) {
      recognitionRef.current?.stop(); 
    } else {
      setInput("");
      try { recognitionRef.current?.start(); setIsListening(true); } catch(e) {}
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setSelectedFile(file);
    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onloadend = () => setFilePreview(reader.result);
      reader.readAsDataURL(file);
    }
  };

  const triggerAI = async (newHistory, fileData = null) => {
    setIsLoading(true);
    scrollToBottom();
    stopSpeak(); 

    const formData = new FormData();
    const lastUserMsg = newHistory[newHistory.length - 1];
    formData.append("input", lastUserMsg?.content || "");
    formData.append("model", selectedMode);
    const contextHistory = newHistory.slice(-10).map(m => ({ role: m.role, content: m.content }));
    formData.append("messages", JSON.stringify(contextHistory));
    if (fileData) formData.append("file", fileData);

    try {
      const res = await fetch(API + "/chat", { method: "POST", headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }, body: formData });
      if (res.status === 401) { logout(); return; }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let botResponse = "";
      const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      setMessages(prev => [...prev, { role: "assistant", content: "", timestamp }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6);
            if (dataStr === "[DONE]") continue;
            try {
              const parsed = JSON.parse(dataStr);
              botResponse += parsed.content;

              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1].content = botResponse;
                return updated;
              });

              if (chatFeedRef.current && !isUserScrolling.current) {
                chatFeedRef.current.scrollTop = chatFeedRef.current.scrollHeight;
              }
            } catch(e){}
          }
        }
      }
      
      setIsLoading(false); 
      if (isVoiceModeOpenRef.current || autoSpeak) speak(botResponse);

    } catch { 
      setIsLoading(false);
      alert("Error connecting to server."); 
    } finally { 
      setSelectedFile(null); setFilePreview(null); 
    }
  };

  const submitFromVoiceMode = (text) => {
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch(e){} }
    setIsListening(false);
    
    const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const userMsg = { role: "user", content: text, file: null, timestamp };
    const newHistory = [...messagesRef.current, userMsg];
    setMessages(newHistory);
    setInput("");
    triggerAI(newHistory, null);
  };

  const sendMessage = async (e) => {
    if(e) e.preventDefault();
    if (!(input || "").trim() && !selectedFile) return;
    if (isListening) recognitionRef.current?.stop();

    const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const userMsg = { role: "user", content: input, file: selectedFile ? { preview: filePreview } : null, timestamp };

    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInput("");
    // Reset textarea height back to normal after sending
    if(textareaRef.current) textareaRef.current.style.height = "auto";
    triggerAI(newHistory, selectedFile);
  };

  // ⌨️ HANDLE ENTER KEY (Enter = Send, Shift+Enter = New Line)
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isLoading) sendMessage(e);
    }
  };

  const submitEdit = (index) => {
    if (!(editInput || "").trim()) return;
    stopSpeak();
    const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const newHistory = [...messages.slice(0, index), { role: "user", content: editInput, timestamp }];
    setMessages(newHistory);
    setEditingIndex(null);
    triggerAI(newHistory, null);
  };

  const handleRegenerate = (index) => {
    if(index === 0) return; 
    const newHistory = messages.slice(0, index);
    setMessages(newHistory);
    triggerAI(newHistory, null);
  };

  const shareConversation = () => {
    if (messages.length === 0) return;
    const text = messages.map(m => `**${m.role === 'user' ? 'You' : 'VetroAI'}**:\n${m.content}`).join('\n\n---\n\n');
    navigator.clipboard.writeText(text);
    alert("Conversation copied to clipboard!");
  };

  if (!user) {
    return (
      <div className="auth-wrapper neural-cosmos">
        <div className="auth-card">
          <h1 className="text-logo">VetroAI</h1>
          <p className="auth-sub">{authMode === "login" ? "Enter your credentials." : "Create a new neural profile."}</p>
          <input className="auth-input" type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
          <input className="auth-input" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
          <button className="auth-btn" onClick={handleAuth}>{authMode === "login" ? "Login" : "Signup"}</button>
          <p className="auth-toggle" onClick={() => setAuthMode(authMode === "login" ? "signup" : "login")}>
            {authMode === "login" ? <>New here? <span>Sign up</span></> : <>Have an account? <span>Log in</span></>}
          </p>
        </div>
      </div>
    );
  }

  const isInputEmpty = !(input || "").trim() && !selectedFile;

  return (
    <div className="app-container neural-cosmos">
      
      {/* 🗣️ ADVANCED VOICE MODE MODAL */}
      {isVoiceModeOpen && (
        <div className="voice-modal-overlay">
          <button className="close-voice-btn" onClick={closeVoiceMode}><XIcon /></button>
          
          <div 
            className={`voice-orb ${isListening ? 'listening' : (isLoading ? 'thinking' : 'speaking')}`}
            onClick={handleOrbClick}
          ></div>
          
          <h2 className="voice-status">
            {isListening ? "Listening..." : (isLoading ? "Thinking..." : "VetroAI is speaking...")}
          </h2>
          <p className="voice-hint">
            {isListening ? "Tap orb to stop" : (isLoading ? "Please wait" : "Tap orb to interrupt")}
          </p>
          <p className="voice-transcript">{input || "..."}</p>
        </div>
      )}

      {isSidebarOpen && <div className="sidebar-overlay" onClick={() => setIsSidebarOpen(false)}></div>}
      
      <aside className={`sidebar ${isSidebarOpen ? "open" : ""}`}>
        <h2 className="text-logo">VetroAI <span className="beta-tag">v1.0</span></h2>
        <button className="new-chat-btn" onClick={createNewChat}>+ New Chat</button>
        <div className="search-bar"><input type="text" placeholder="Search history..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} /></div>
        
        <div className="history-list">
          {filteredSessions.map(s => (
            <div key={s.id} className={`history-item-wrapper ${s.id === currentSessionId ? 'active' : ''}`} onClick={() => loadSession(s.id)}>
              <span className="history-title">{s.title}</span>
              <button className="delete-history-btn" onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }} title="Delete Chat"><TrashIcon /></button>
            </div>
          ))}
        </div>
        
        <div className="sidebar-footer">
          <select value={selectedMode} onChange={(e) => setSelectedMode(e.target.value)}>{MODES.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
          <button className="logout-btn" onClick={logout}>🚪 Logout</button>
        </div>
      </aside>

      <main className="chat-area">
        <header className="chat-header">
          <button className="mobile-menu-btn" onClick={() => setIsSidebarOpen(true)}><MenuIcon /></button>
          {messages.length > 0 && <button className="share-btn" onClick={shareConversation}><ShareIcon /> Share</button>}
        </header>

        <div className="messages-feed" ref={chatFeedRef} onScroll={handleScroll}>
          {messages.length === 0 && <div className="welcome-screen"><h1 className="text-logo">How can I help you today?</h1></div>}
          
          {(messages || []).map((msg, idx) => (
            <div key={idx} className={`message ${msg.role}`}>
              <div className="bubble-wrapper">
                
                {msg.role === "user" && editingIndex === idx ? (
                  <div className="edit-container">
                    <textarea className="edit-textarea" value={editInput} onChange={(e) => setEditInput(e.target.value)} autoFocus />
                    <div className="edit-actions">
                      <button className="btn-cancel" onClick={() => setEditingIndex(null)}>Cancel</button>
                      <button className="btn-save" onClick={() => submitEdit(idx)}>Save & Submit</button>
                    </div>
                  </div>
                ) : (
                  <div className="bubble">
                    {msg.file?.preview && <img src={msg.file.preview} alt="preview" className="img-preview-bubble" />}
                    
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]} 
                      components={{
                        code({ inline, className, children }) {
                          const match = /language-(\w+)/.exec(className || "");
                          const codeString = String(children).replace(/\n$/, "");
                          return !inline && match ? <CodeBlock match={match} codeString={codeString} /> : <code className="inline-code">{children}</code>;
                        }
                      }}
                    >
                      {formatMath(msg.content)}
                    </ReactMarkdown>
                  </div>
                )}

                {editingIndex !== idx && (
                  <div className="message-actions">
                    <span className="timestamp">{msg.timestamp}</span>
                    
                    {msg.role === "assistant" && !isLoading && (
                      <div className="action-icons">
                        <button onClick={() => speak(msg.content)} title="Read Aloud"><SpeakerIcon /></button>
                        <button onClick={() => navigator.clipboard.writeText(msg.content)} title="Copy Response"><CopyIcon /></button>
                        <button onClick={() => handleRegenerate(idx)} title="Regenerate"><ReloadIcon /></button>
                      </div>
                    )}

                    {msg.role === "user" && !isLoading && (
                      <div className="action-icons">
                        <button onClick={() => { setEditingIndex(idx); setEditInput(msg.content); }} title="Edit Prompt"><EditIcon /></button>
                        <button onClick={() => navigator.clipboard.writeText(msg.content)} title="Copy Prompt"><CopyIcon /></button>
                      </div>
                    )}
                  </div>
                )}

              </div>
            </div>
          ))}
          <div ref={messagesEndRef} style={{ height: "20px" }}></div>
        </div>

        {showScrollDown && (
          <button className="scroll-bottom-btn" onClick={scrollToBottom}>↓</button>
        )}

        <div className="input-wrapper">
          <form className="input-box">
            <input type="file" ref={fileInputRef} style={{ display: "none" }} onChange={handleFileChange} />
            <button type="button" className="icon-btn" onClick={() => fileInputRef.current.click()}>📎</button>
            
            {/* ✨ THE NEW MULTI-LINE AUTO-EXPANDING TEXTAREA ✨ */}
            <textarea 
              ref={textareaRef}
              className="chat-textarea"
              placeholder={isListening && !isVoiceModeOpen ? "Listening..." : "Ask VetroAI..."} 
              value={input} 
              onChange={(e) => setInput(e.target.value)} 
              onKeyDown={handleKeyDown}
              disabled={isLoading} 
              rows={1}
            />
            
            <div className="input-actions-right">
              {isInputEmpty ? (
                <>
                  <button type="button" className={`mic-outline-btn ${isListening && !isVoiceModeOpen ? 'active' : ''}`} onClick={toggleMic} title="Dictation">
                    <MicIcon />
                  </button>
                  <button type="button" className="wave-btn" onClick={openVoiceMode} title="Voice Conversation Mode">
                    <WaveIcon />
                  </button>
                </>
              ) : (
                <button type="button" className="send-btn" onClick={sendMessage} disabled={isLoading} id="hidden-send-btn">
                  <SendIcon />
                </button>
              )}
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}