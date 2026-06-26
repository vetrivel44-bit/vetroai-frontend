import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { 
  Plus, 
  Search, 
  Monitor, 
  ChevronDown, 
  Mic, 
  Sparkles, 
  Send, 
  ArrowLeft, 
  Loader2, 
  Link2, 
  Globe, 
  Rocket, 
  Compass, 
  Mail, 
  Layout, 
  CheckCircle2, 
  Circle,
  HelpCircle,
  Cpu,
  RefreshCw,
  Plane,
  Calendar,
  FileText
} from 'lucide-react';

export default function ComputerUI({ onClose }) {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [chatStarted, setChatStarted] = useState(false);
  const [isDictating, setIsDictating] = useState(false);
  const [agentSteps, setAgentSteps] = useState([]);
  
  const textareaRef = useRef(null);
  const endRef = useRef(null);
  const recognitionRef = useRef(null);

  // Suggestions pool
  const originalSuggestions = [
    { emoji: <Link2 size={16} className="text-blue-500" />, label: 'Connect your apps', prompt: 'Help me connect my external apps like Gmail, Slack, and Notion' },
    { emoji: <Mail size={16} className="text-gray-500" />, label: 'Triage my email inbox', prompt: 'Act as an email triage assistant to summarize and prioritize my inbox' },
    { emoji: <Search size={16} className="text-gray-500" />, label: 'Run deep research', prompt: 'Run deep research on recent developer tooling trends' },
    { emoji: <Calendar size={16} className="text-gray-500" />, label: 'Build a Chief of Staff', prompt: 'Build a Chief of Staff to manage my schedule' },
    { emoji: <Plane size={16} className="text-gray-500" />, label: 'Plan a trip', prompt: 'Plan a 5-day trip to Tokyo' },
    { emoji: <FileText size={16} className="text-gray-500" />, label: 'Send a daily news digest', prompt: 'Send a daily news digest summarizing tech news' }
  ];
  const [suggestions, setSuggestions] = useState(originalSuggestions);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [query]);

  // Scroll to bottom
  useEffect(() => {
    if (endRef.current) {
      endRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, agentSteps]);

  // Dictation functionality
  const toggleDictation = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }
    
    if (isDictating) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsDictating(false);
      return;
    }

    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = false;
    rec.onstart = () => setIsDictating(true);
    rec.onend = () => setIsDictating(false);
    rec.onerror = () => setIsDictating(false);
    rec.onresult = (e) => {
      const text = e.results[0][0].transcript;
      setQuery(prev => prev + (prev ? ' ' : '') + text);
    };
    recognitionRef.current = rec;
    rec.start();
  };

  // Shuffle suggestions
  const shuffleSuggestions = () => {
    const shuffled = [...suggestions].sort(() => Math.random() - 0.5);
    setSuggestions(shuffled);
  };

  // Run the agent stream
  const handleSubmit = async (e, customPrompt = '') => {
    if (e) e.preventDefault();
    const finalPrompt = (customPrompt || query).trim();
    if (!finalPrompt || loading) return;

    setQuery('');
    setChatStarted(true);
    setLoading(true);
    setError('');

    // Append user query to messages
    const userMsg = { role: 'user', content: finalPrompt, id: Date.now().toString() };
    const botMsg = { role: 'assistant', content: '', id: (Date.now() + 1).toString() };
    const updatedMessages = [...messages, userMsg];
    setMessages([...updatedMessages, botMsg]);

    // Setup mock agent execution steps to visualize the agent doing computer actions
    setAgentSteps([
      { id: '1', label: 'Initializing VetroAI Computer agent environment...', status: 'running' },
      { id: '2', label: 'Analyzing search workspace parameters...', status: 'pending' },
      { id: '3', label: 'Connecting backend runtime and shell...', status: 'pending' },
      { id: '4', label: 'Executing tasks and compiling context...', status: 'pending' }
    ]);

    // Simulate console step updates
    const timers = [];
    timers.push(setTimeout(() => {
      setAgentSteps(prev => prev.map(s => s.id === '1' ? { ...s, status: 'success' } : s.id === '2' ? { ...s, status: 'running' } : s));
    }, 1200));

    timers.push(setTimeout(() => {
      setAgentSteps(prev => prev.map(s => s.id === '2' ? { ...s, status: 'success' } : s.id === '3' ? { ...s, status: 'running' } : s));
    }, 2800));

    timers.push(setTimeout(() => {
      setAgentSteps(prev => prev.map(s => s.id === '3' ? { ...s, status: 'success' } : s.id === '4' ? { ...s, status: 'running' } : s));
    }, 4200));

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'agnes',
          mode: 'code_exec',
          input: finalPrompt,
          messages: updatedMessages.map(m => ({ role: m.role, content: m.content })),
          webSearch: true
        })
      });

      if (!res.ok) {
        throw new Error('Failed to reach VetroAI computer backend.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let textContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const raw = line.slice(6).trim();
            if (raw === '[DONE]' || !raw) continue;

            try {
              const parsed = JSON.parse(raw);
              if (parsed.type === 'content' && parsed.data) {
                textContent += parsed.data;
                // Update the bot message with real-time text stream
                setMessages(prev => prev.map(m => m.id === botMsg.id ? { ...m, content: textContent } : m));
              } else if (parsed.type === 'status' && parsed.data) {
                // Keep console status logs updated
                setAgentSteps(prev => {
                  const last = prev[prev.length - 1];
                  if (last && last.status === 'running') {
                    return [...prev.slice(0, -1), { ...last, label: parsed.data }];
                  }
                  return prev;
                });
              }
            } catch (err) {
              // Ignore partial JSON parse errors
            }
          }
        }
      }

      // Finish all steps successfully
      setAgentSteps(prev => prev.map(s => ({ ...s, status: 'success' })));

    } catch (err) {
      setError(err.message || 'An error occurred during operation.');
      setAgentSteps(prev => prev.map(s => s.status === 'running' || s.status === 'pending' ? { ...s, status: 'failed' } : s));
    } finally {
      setLoading(false);
      timers.forEach(clearTimeout);
    }
  };



  return (
    <div className="flex-1 flex flex-col h-full text-gray-900 overflow-y-auto px-4 md:px-8 py-6 w-full relative" style={{ backgroundColor: "#fcfcf9" }}>
      
      {/* Result chat thread */}
      {chatStarted ? (
        <div className="w-full max-w-4xl mx-auto flex-1 flex flex-col pb-32">
          {/* Thread Header */}
          <div className="flex items-center justify-between pb-4 border-b border-gray-100 mb-6 flex-shrink-0">
            <button 
              onClick={() => { setChatStarted(false); setMessages([]); setAgentSteps([]); setError(''); }}
              className="flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft size={16} /> VetroAI Computer
            </button>
            <div className="flex items-center gap-2 text-xs font-semibold text-teal-600 bg-teal-50 border border-teal-100 rounded-full px-3 py-1">
              <span className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-pulse"></span>
              Agent Mode Active
            </div>
          </div>

          {/* Conversation Feed */}
          <div className="flex-1 flex flex-col gap-8">
            {messages.map((m) => (
              <div key={m.id} className="flex flex-col gap-3">
                {m.role === 'user' ? (
                  <div className="flex items-start gap-3 justify-end w-full">
                    <div className="max-w-[80%] bg-[#f4f4f4] text-black px-4 py-3 rounded-2xl text-[15px] font-medium leading-normal shadow-sm">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-4 justify-start w-full">
                    <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center flex-shrink-0 border border-purple-100 shadow-sm">
                      <Cpu size={16} />
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col gap-4">
                      {/* Console Steps Panel (only show for the latest bot reply if loading or has steps) */}
                      {agentSteps.length > 0 && m.id === messages[messages.length - 1]?.id && (
                        <div className="border border-solid border-gray-200/80 rounded-2xl bg-white p-4 shadow-sm max-w-[650px]">
                          <div className="flex items-center justify-between mb-3 border-b border-gray-50 pb-2">
                            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
                              <Loader2 size={12} className={loading ? "animate-spin text-teal-500" : "text-gray-400"} />
                              VetroAI execution steps
                            </span>
                            <span className="text-xs font-medium text-gray-400">Computer agent</span>
                          </div>
                          <div className="flex flex-col gap-2.5">
                            {agentSteps.map(step => (
                              <div key={step.id} className="flex items-center gap-2.5 text-[13px] text-gray-600">
                                {step.status === 'success' && <CheckCircle2 size={16} className="text-teal-500 flex-shrink-0" />}
                                {step.status === 'running' && <Loader2 size={16} className="text-teal-500 animate-spin flex-shrink-0" />}
                                {step.status === 'pending' && <Circle size={16} className="text-gray-300 flex-shrink-0" />}
                                {step.status === 'failed' && <span className="w-4 h-4 rounded-full bg-red-100 text-red-500 flex items-center justify-center font-bold text-[10px] flex-shrink-0">×</span>}
                                <span className={step.status === 'running' ? "font-semibold text-gray-800" : step.status === 'pending' ? "text-gray-400" : ""}>{step.label}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Text content markdown */}
                      <div className="prose prose-sm text-gray-800 text-[15px] leading-[1.7] max-w-none">
                        {m.content ? (
                          <ReactMarkdown>{m.content}</ReactMarkdown>
                        ) : (
                          loading && <div className="text-gray-400 flex items-center gap-2 text-sm italic font-medium"><Loader2 size={14} className="animate-spin text-purple-500" /> VetroAI is compiling response...</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {error && <div className="p-4 bg-red-50 border border-red-100 rounded-2xl text-red-700 text-sm font-medium">{error}</div>}
            <div ref={endRef} />
          </div>

          {/* Follow-up search card */}
          <div className="absolute bottom-6 left-0 right-0 px-4 md:px-8 bg-gradient-to-t from-[#fbfbfb] via-[#fbfbfb] to-transparent pt-8 flex justify-center w-full">
            <form onSubmit={handleSubmit} className="w-full max-w-[800px]">
              <div className="bg-white border border-solid border-gray-200/90 rounded-[24px] p-3 shadow-[0_8px_30px_rgb(0,0,0,0.03)] focus-within:border-teal-400 focus-within:shadow-[0_8px_30px_rgba(20,184,166,0.08)] transition-all flex flex-col">
                <div className="flex items-center gap-2">
                  <textarea
                    ref={textareaRef}
                    rows="1"
                    placeholder="Ask follow-up to VetroAI Computer..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); } }}
                    className="w-full bg-transparent border-none outline-none resize-none text-[15px] text-gray-800 placeholder-gray-400 py-1.5 px-2"
                    style={{ minHeight: '36px' }}
                  />
                  <button 
                    type="submit" 
                    disabled={!query.trim() || loading}
                    className="w-8 h-8 rounded-full bg-stone-900 text-white flex items-center justify-center hover:bg-black transition-colors disabled:opacity-40 flex-shrink-0"
                  >
                    <Send size={12} />
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : (
        /* Landing page style of Computer mode */
        <div className="flex-1 flex flex-col items-center justify-center w-full max-w-3xl mx-auto py-10 md:py-16">
          
          {/* Logo element */}
          <div className="flex items-center justify-center mb-8 mt-16 md:mt-24 select-none animate-fade-in">
            <h1 className="text-[2.5rem] tracking-tight text-gray-900 flex items-center leading-none" style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif', letterSpacing: '-1px' }}>
              vetroai
            </h1>
          </div>

          {/* Search bar container */}
          <form onSubmit={handleSubmit} className="w-full mb-10">
            <div className="bg-white border border-solid border-gray-200 rounded-[16px] p-4 flex flex-col relative transition-all duration-300"
                 style={{
                   backgroundColor: "#ffffff",
                   border: "1px solid #e5e7eb",
                   boxShadow: "0 2px 6px rgba(0, 0, 0, 0.05)"
                 }}>
              <textarea
                ref={textareaRef}
                rows="1"
                placeholder="explain all the features of this"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); } }}
                className="w-full bg-transparent border-none outline-none resize-none text-[16px] text-gray-800 placeholder-gray-500 py-1"
                style={{ minHeight: '44px' }}
              />

              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <button type="button" className="p-1 text-gray-400 hover:text-gray-600 rounded-full transition-colors flex-shrink-0" title="Attach file">
                    <Plus size={20} />
                  </button>
                  <button type="button" className="flex items-center gap-1.5 px-3 py-1.5 rounded-[12px] bg-white hover:bg-gray-50 text-[13px] font-medium text-gray-600 transition-colors flex-shrink-0" style={{ border: "1px solid #e5e7eb" }}>
                    <Search size={14} className="mr-0.5" /> Search <ChevronDown size={14} className="text-gray-400 ml-0.5" />
                  </button>
                  <button type="button" className="flex items-center gap-1.5 px-3 py-1.5 rounded-[12px] bg-white hover:bg-gray-50 text-[13px] font-medium text-gray-600 transition-colors flex-shrink-0" style={{ border: "1px solid #e5e7eb" }}>
                    <Monitor size={14} className="mr-0.5" /> Computer
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <button type="button" className="flex items-center gap-1 text-[13px] font-medium text-gray-500 hover:text-gray-700 transition-colors flex-shrink-0">
                    Model <ChevronDown size={14} className="ml-0.5" />
                  </button>
                  <button 
                    type="button" 
                    onClick={toggleDictation}
                    className={"p-1 rounded-full transition-colors flex-shrink-0 " + (isDictating ? "text-red-500 animate-pulse" : "text-gray-400 hover:text-gray-600")}
                  >
                    <Mic size={18} />
                  </button>
                  <button 
                    type="submit" 
                    disabled={!query.trim()}
                    className="w-8 h-8 rounded-full text-white flex items-center justify-center transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                    style={{ backgroundColor: "#222222" }}
                  >
                    <ArrowLeft size={16} className="rotate-[180deg]" />
                  </button>
                </div>
              </div>
            </div>
          </form>

          {/* Suggestions Cards section */}
          <div className="w-full">
            <div className="flex items-center justify-between w-full mb-3 text-gray-500 select-none">
              <span className="text-[14px] font-medium">Try out VetroAI Computer</span>
              <button 
                type="button" 
                onClick={shuffleSuggestions}
                className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600 transition-colors"
                title="Shuffle suggestions"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16 3 21 3 21 8"/>
                  <line x1="4" y1="20" x2="21" y2="3"/>
                  <polyline points="21 16 21 21 16 21"/>
                  <line x1="15" y1="15" x2="21" y2="21"/>
                  <line x1="4" y1="4" x2="9" y2="9"/>
                </svg>
              </button>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 w-full">
              {suggestions.map((item) => (
                <button
                  type="button"
                  key={item.label}
                  onClick={(e) => handleSubmit(e, item.prompt)}
                  className="flex items-center gap-2.5 w-full transition-all duration-300 text-left cursor-pointer group hover:bg-gray-50"
                  style={{
                    backgroundColor: "#ffffff",
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    padding: "12px 14px",
                    outline: "none"
                  }}
                >
                  <div className="flex items-center justify-center flex-shrink-0">
                    {item.emoji}
                  </div>
                  <span className="text-[13px] font-medium text-gray-700 truncate">
                    {item.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
