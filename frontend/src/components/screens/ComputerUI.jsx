import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  ArrowLeft, Bot, Check, CheckCircle2, ChevronDown, Circle, Clock3,
  File, FolderOpen, Globe2, Loader2, Mic, Monitor, MoreHorizontal,
  Paperclip, Pause, Play, Plus, RotateCcw, Search, Send, ShieldCheck,
  Square, Trash2, X, Zap
} from "lucide-react";

const PROD_API = "https://ai-chatbot-backend-gvvz.onrender.com/api";
const API = (import.meta.env.VITE_API_BASE_URL?.trim() || (import.meta.env.PROD ? PROD_API : "/api")).replace(/\/+$/, "");
const STORE_KEY = "vetroai_cowork_tasks_v2";
const RISKY_ACTION = /\b(send|email|message|post|publish|buy|purchase|pay|book|delete|remove|upload|submit|login|sign in|change password|share)\b/i;

const makeTask = (title = "New task") => ({
  id: crypto.randomUUID?.() || String(Date.now()),
  title,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  messages: [],
  steps: [],
  status: "ready",
  files: []
});

const starterTasks = [
  { icon: Search, title: "Research a topic", prompt: "Research the latest developments in AI agents. Compare the most important options and create a concise report with sources." },
  { icon: FolderOpen, title: "Work with files", prompt: "Review the files I attach, summarize the important information, and produce a clear action plan." },
  { icon: Globe2, title: "Plan from the web", prompt: "Plan a five-day trip with a practical itinerary, budget, and useful links." },
  { icon: Zap, title: "Complete a project", prompt: "Turn my goal into a detailed plan, work through it step by step, and give me finished deliverables for review." }
];

const buildPlan = (prompt, files) => {
  const steps = [
    { id: "understand", label: "Understand the goal and constraints", status: "pending" },
    ...(files.length ? [{ id: "files", label: `Read ${files.length} attached file${files.length > 1 ? "s" : ""}`, status: "pending" }] : []),
    { id: "research", label: "Gather the required context and sources", status: "pending" },
    { id: "work", label: "Complete the requested work", status: "pending" },
    { id: "review", label: "Review the result and prepare delivery", status: "pending" }
  ];
  if (/\b(code|app|website|debug|fix|build)\b/i.test(prompt)) {
    steps[2] = { id: "work", label: "Build, inspect, and validate the solution", status: "pending" };
  }
  return steps;
};

function StepIcon({ status }) {
  if (status === "done") return <CheckCircle2 size={16} className="text-emerald-600" />;
  if (status === "active") return <Loader2 size={16} className="animate-spin text-amber-600" />;
  if (status === "failed") return <X size={16} className="text-red-500" />;
  return <Circle size={16} className="text-stone-300" />;
}

function safeLoadTasks() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function ComputerUI({ onClose }) {
  const [tasks, setTasks] = useState(safeLoadTasks);
  const [activeId, setActiveId] = useState(() => safeLoadTasks()[0]?.id || null);
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState([]);
  const [permission, setPermission] = useState("ask");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [pendingAction, setPendingAction] = useState(null);
  const [dictating, setDictating] = useState(false);
  const textareaRef = useRef(null);
  const fileRef = useRef(null);
  const endRef = useRef(null);
  const abortRef = useRef(null);
  const recognitionRef = useRef(null);

  const activeTask = useMemo(() => tasks.find(t => t.id === activeId) || null, [tasks, activeId]);
  const running = activeTask?.status === "running";
  const paused = activeTask?.status === "paused";

  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify(tasks.map(t => ({ ...t, files: [] }))));
  }, [tasks]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeTask?.messages, activeTask?.steps]);

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 170)}px`;
  }, [query]);

  const patchTask = (id, updater) => {
    setTasks(prev => prev.map(t => t.id === id
      ? { ...(typeof updater === "function" ? updater(t) : { ...t, ...updater }), updatedAt: Date.now() }
      : t));
  };

  const newTask = () => {
    const task = makeTask();
    setTasks(prev => [task, ...prev]);
    setActiveId(task.id);
    setQuery("");
    setFiles([]);
  };

  const removeTask = (id) => {
    if (running && id === activeId) abortRef.current?.abort();
    setTasks(prev => {
      const next = prev.filter(t => t.id !== id);
      if (id === activeId) setActiveId(next[0]?.id || null);
      return next;
    });
  };

  const readStream = async (response, taskId, assistantId) => {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("The server did not return a stream.");
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const rawLine of lines) {
        if (!rawLine.startsWith("data:")) continue;
        const raw = rawLine.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;
        try {
          const event = JSON.parse(raw);
          const type = event.type || (event.content ? "content" : "");
          const data = event.data ?? event.content;
          if (type === "content" && data) {
            content += data;
            patchTask(taskId, t => ({
              ...t,
              messages: t.messages.map(m => m.id === assistantId ? { ...m, content } : m)
            }));
          } else if (type === "status" && data) {
            patchTask(taskId, t => {
              const activeIndex = t.steps.findIndex(s => s.status === "active");
              if (activeIndex < 0) return t;
              return { ...t, steps: t.steps.map((s, i) => i === activeIndex ? { ...s, detail: String(data) } : s) };
            });
          } else if (type === "error" && data) {
            throw new Error(String(data));
          }
        } catch (error) {
          if (error instanceof SyntaxError) continue;
          throw error;
        }
      }
    }
    return content;
  };

  const execute = async (prompt) => {
    let task = activeTask;
    if (!task) {
      task = makeTask(prompt.slice(0, 54));
      setTasks(prev => [task, ...prev]);
      setActiveId(task.id);
    }
    const taskId = task.id;
    const assistantId = `a-${Date.now()}`;
    const userMessage = { id: `u-${Date.now()}`, role: "user", content: prompt };
    const contextMessages = [...task.messages, userMessage].map(({ role, content }) => ({ role, content }));
    const plan = buildPlan(prompt, files).map((s, i) => ({ ...s, status: i === 0 ? "active" : "pending" }));

    patchTask(taskId, t => ({
      ...t,
      title: t.messages.length ? t.title : prompt.slice(0, 54),
      status: "running",
      files: files.map(f => ({ name: f.name, size: f.size, type: f.type })),
      steps: plan,
      messages: [...t.messages, userMessage, { id: assistantId, role: "assistant", content: "" }]
    }));
    setQuery("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const body = new FormData();
      body.append("provider", "agnes");
      body.append("mode", "code_exec");
      body.append("input", prompt);
      body.append("messages", JSON.stringify(contextMessages));
      body.append("webSearch", "true");
      body.append("safeMode", "true");
      body.append("systemPrompt", [
        "You are VetroAI Computer, a careful Cowork-style task agent.",
        "Work through the user's multi-step task and produce finished, useful deliverables.",
        "State what you actually did; never pretend to click, send, purchase, log in, edit local files, or access connected apps unless a real tool result proves it.",
        "For actions unavailable in this browser workspace, provide the exact next action for the user.",
        "Prefer concise progress, source-aware research, and a final review checklist."
      ].join(" "));
      files.forEach(file => body.append("files", file));

      patchTask(taskId, t => ({ ...t, steps: t.steps.map((s, i) => i === 0 ? { ...s, status: "done" } : i === 1 ? { ...s, status: "active" } : s) }));
      const response = await fetch(`${API}/chat`, { method: "POST", body, signal: controller.signal });
      if (!response.ok) {
        let message = `Server error: ${response.status}`;
        try {
          const data = await response.json();
          message = data.message || data.error || message;
        } catch {}
        throw new Error(message);
      }

      await readStream(response, taskId, assistantId);
      patchTask(taskId, t => ({
        ...t,
        status: "completed",
        steps: t.steps.map(s => ({ ...s, status: "done" }))
      }));
      setFiles([]);
    } catch (error) {
      const stopped = error.name === "AbortError";
      patchTask(taskId, t => ({
        ...t,
        status: stopped ? "stopped" : "failed",
        steps: t.steps.map(s => s.status === "active" ? { ...s, status: stopped ? "pending" : "failed" } : s),
        messages: t.messages.map(m => m.id === assistantId && !m.content
          ? { ...m, content: stopped ? "Task stopped. You can edit the instruction and run it again." : `I couldn't complete this task: ${error.message}` }
          : m)
      }));
    } finally {
      abortRef.current = null;
    }
  };

  const submit = (event, suggestion = "") => {
    event?.preventDefault();
    const prompt = (suggestion || query).trim();
    if (!prompt || running) return;
    if (permission === "ask" && RISKY_ACTION.test(prompt)) {
      setPendingAction(prompt);
      return;
    }
    execute(prompt);
  };

  const stopTask = () => abortRef.current?.abort();

  const togglePause = () => {
    if (!activeTask) return;
    if (running) {
      abortRef.current?.abort();
      patchTask(activeTask.id, { status: "paused" });
    } else if (paused) {
      patchTask(activeTask.id, { status: "ready" });
      setQuery("Continue the previous task from where it stopped.");
    }
  };

  const toggleDictation = () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return alert("Speech recognition is not supported in this browser.");
    if (dictating) return recognitionRef.current?.stop();
    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onstart = () => setDictating(true);
    recognition.onend = () => setDictating(false);
    recognition.onerror = () => setDictating(false);
    recognition.onresult = e => setQuery(q => `${q}${q ? " " : ""}${e.results[0][0].transcript}`);
    recognitionRef.current = recognition;
    recognition.start();
  };

  const onFiles = event => {
    const selected = Array.from(event.target.files || []).slice(0, 10);
    setFiles(prev => [...prev, ...selected].slice(0, 10));
    event.target.value = "";
  };

  return (
    <div className="flex h-full min-h-0 w-full bg-[#f7f6f2] text-stone-900 overflow-hidden">
      <aside className={`${sidebarOpen ? "w-[260px]" : "w-0"} hidden md:flex flex-col overflow-hidden border-r border-stone-200 bg-[#efeee9] transition-all`}>
        <div className="p-3 flex items-center gap-2">
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-stone-200" title="Back to chat"><ArrowLeft size={18} /></button>
          <span className="font-semibold text-sm flex-1">Computer</span>
          <button onClick={newTask} className="p-2 rounded-lg hover:bg-stone-200" title="New task"><Plus size={18} /></button>
        </div>
        <div className="px-3 pb-2">
          <button onClick={newTask} className="w-full flex items-center gap-2 rounded-xl bg-stone-900 text-white px-3 py-2.5 text-sm font-medium">
            <Plus size={16} /> New task
          </button>
        </div>
        <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-stone-500 font-semibold">Your tasks</div>
        <div className="flex-1 overflow-y-auto px-2 space-y-1">
          {tasks.map(task => (
            <div key={task.id} className={`group flex items-center rounded-xl ${task.id === activeId ? "bg-white shadow-sm" : "hover:bg-stone-200/70"}`}>
              <button onClick={() => setActiveId(task.id)} className="flex-1 min-w-0 text-left px-3 py-2.5">
                <div className="truncate text-sm font-medium">{task.title}</div>
                <div className="flex items-center gap-1.5 text-[11px] text-stone-500 mt-1">
                  {task.status === "running" ? <Loader2 size={11} className="animate-spin" /> : <Clock3 size={11} />}
                  <span className="capitalize">{task.status}</span>
                </div>
              </button>
              <button onClick={() => removeTask(task.id)} className="opacity-0 group-hover:opacity-100 p-2 mr-1 text-stone-400 hover:text-red-600"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <div className="p-3 border-t border-stone-200 text-xs text-stone-500 flex items-center gap-2">
          <ShieldCheck size={15} /> Actions stay approval-gated
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col bg-[#fbfaf7]">
        <header className="h-14 flex items-center gap-3 px-4 border-b border-stone-200 bg-[#fbfaf7]/95">
          <button onClick={() => setSidebarOpen(v => !v)} className="hidden md:block p-2 rounded-lg hover:bg-stone-100"><Monitor size={18} /></button>
          <button onClick={onClose} className="md:hidden p-2 rounded-lg hover:bg-stone-100"><ArrowLeft size={18} /></button>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm truncate">{activeTask?.title || "VetroAI Computer"}</div>
            <div className="text-[11px] text-stone-500">Cowork-style task workspace</div>
          </div>
          {activeTask && (running || paused) && (
            <div className="flex items-center gap-1">
              <button onClick={togglePause} className="p-2 rounded-lg hover:bg-stone-100" title={running ? "Pause" : "Resume"}>{running ? <Pause size={17} /> : <Play size={17} />}</button>
              <button onClick={stopTask} disabled={!running} className="p-2 rounded-lg hover:bg-red-50 text-red-600 disabled:opacity-30" title="Stop"><Square size={16} /></button>
            </div>
          )}
          <div className="relative">
            <select value={permission} onChange={e => setPermission(e.target.value)} className="appearance-none bg-white border border-stone-200 rounded-xl pl-3 pr-8 py-2 text-xs font-medium outline-none">
              <option value="ask">Ask before actions</option>
              <option value="plan">Plan only</option>
            </select>
            <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-2.5 text-stone-500" />
          </div>
          <button className="p-2 rounded-lg hover:bg-stone-100"><MoreHorizontal size={18} /></button>
        </header>

        {!activeTask || activeTask.messages.length === 0 ? (
          <section className="flex-1 overflow-y-auto px-5 py-10">
            <div className="max-w-3xl mx-auto min-h-full flex flex-col justify-center">
              <div className="w-12 h-12 rounded-2xl bg-stone-900 text-white flex items-center justify-center shadow-lg mb-5"><Bot size={24} /></div>
              <h1 className="text-3xl md:text-4xl font-semibold tracking-tight mb-3">Hand off a task</h1>
              <p className="text-stone-600 max-w-xl leading-relaxed mb-8">Describe the outcome you want. VetroAI Computer will plan the work, use available web and file context, show progress, and return the result for review.</p>
              <div className="grid sm:grid-cols-2 gap-3 mb-8">
                {starterTasks.map(({ icon: Icon, title, prompt }) => (
                  <button key={title} onClick={e => submit(e, prompt)} className="text-left bg-white border border-stone-200 hover:border-stone-300 rounded-2xl p-4 transition shadow-sm">
                    <Icon size={18} className="text-amber-700 mb-3" />
                    <div className="font-semibold text-sm mb-1">{title}</div>
                    <div className="text-xs leading-relaxed text-stone-500">{prompt}</div>
                  </button>
                ))}
              </div>
              <Composer query={query} setQuery={setQuery} files={files} setFiles={setFiles} submit={submit} running={running} textareaRef={textareaRef} fileRef={fileRef} onFiles={onFiles} dictating={dictating} toggleDictation={toggleDictation} />
              <p className="text-[11px] text-stone-500 text-center mt-3">Browser workspace only. Direct control of your device requires a separately installed desktop agent or extension.</p>
            </div>
          </section>
        ) : (
          <>
            <section className="flex-1 overflow-y-auto px-4 md:px-7 py-6">
              <div className="max-w-4xl mx-auto grid lg:grid-cols-[1fr_280px] gap-5">
                <div className="space-y-7 min-w-0">
                  {activeTask.messages.map(message => (
                    <div key={message.id} className={message.role === "user" ? "flex justify-end" : "flex gap-3"}>
                      {message.role === "assistant" && <div className="w-8 h-8 rounded-xl bg-stone-900 text-white flex items-center justify-center flex-shrink-0"><Bot size={16} /></div>}
                      <div className={message.role === "user"
                        ? "max-w-[85%] rounded-2xl rounded-br-md bg-stone-900 text-white px-4 py-3 text-sm"
                        : "min-w-0 flex-1 prose prose-sm max-w-none text-stone-800 leading-7"}>
                        {message.role === "assistant"
                          ? (message.content ? <ReactMarkdown>{message.content}</ReactMarkdown> : <div className="flex items-center gap-2 text-sm text-stone-500"><Loader2 size={15} className="animate-spin" /> Working on your task…</div>)
                          : message.content}
                      </div>
                    </div>
                  ))}
                  <div ref={endRef} />
                </div>
                <aside className="lg:sticky lg:top-0 h-fit bg-white border border-stone-200 rounded-2xl p-4 shadow-sm">
                  <div className="flex items-center justify-between pb-3 border-b border-stone-100">
                    <span className="text-xs font-semibold uppercase tracking-wider text-stone-500">Task progress</span>
                    <span className={`text-[11px] rounded-full px-2 py-1 capitalize ${activeTask.status === "completed" ? "bg-emerald-50 text-emerald-700" : activeTask.status === "failed" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{activeTask.status}</span>
                  </div>
                  <div className="space-y-3 mt-4">
                    {activeTask.steps.map(step => (
                      <div key={step.id} className="flex gap-2.5 items-start">
                        <span className="mt-0.5"><StepIcon status={step.status} /></span>
                        <div className="min-w-0">
                          <div className={`text-xs leading-5 ${step.status === "active" ? "font-semibold text-stone-900" : "text-stone-600"}`}>{step.label}</div>
                          {step.detail && <div className="text-[10px] text-stone-400 truncate">{step.detail}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                  {activeTask.files?.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-stone-100">
                      <div className="text-[11px] font-semibold text-stone-500 mb-2">FILES</div>
                      {activeTask.files.map(file => <div key={file.name} className="flex items-center gap-2 text-xs text-stone-600 py-1"><File size={13} /> <span className="truncate">{file.name}</span></div>)}
                    </div>
                  )}
                  {activeTask.status === "completed" && <div className="mt-4 pt-4 border-t border-stone-100 flex items-center gap-2 text-xs text-emerald-700"><Check size={15} /> Ready for your review</div>}
                </aside>
              </div>
            </section>
            <div className="px-4 md:px-7 pb-4 bg-gradient-to-t from-[#fbfaf7] via-[#fbfaf7]">
              <div className="max-w-4xl mx-auto">
                <Composer query={query} setQuery={setQuery} files={files} setFiles={setFiles} submit={submit} running={running} textareaRef={textareaRef} fileRef={fileRef} onFiles={onFiles} dictating={dictating} toggleDictation={toggleDictation} />
              </div>
            </div>
          </>
        )}
      </main>

      {pendingAction && (
        <div className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mb-4"><ShieldCheck size={20} /></div>
            <h2 className="text-lg font-semibold mb-2">Review this task</h2>
            <p className="text-sm text-stone-600 leading-6 mb-3">This request may involve an external or irreversible action. VetroAI will prepare the work, but it will not claim the action was completed without a real connected tool and your approval.</p>
            <div className="bg-stone-50 border border-stone-200 rounded-xl p-3 text-sm text-stone-700 mb-5">{pendingAction}</div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setPendingAction(null)} className="px-4 py-2 rounded-xl text-sm hover:bg-stone-100">Cancel</button>
              <button onClick={() => { const prompt = pendingAction; setPendingAction(null); execute(prompt); }} className="px-4 py-2 rounded-xl text-sm bg-stone-900 text-white">Continue safely</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Composer({ query, setQuery, files, setFiles, submit, running, textareaRef, fileRef, onFiles, dictating, toggleDictation }) {
  return (
    <form onSubmit={submit} className="bg-white border border-stone-200 rounded-2xl shadow-[0_10px_35px_rgba(28,25,23,0.08)] p-3">
      {files.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {files.map((file, index) => (
            <div key={`${file.name}-${index}`} className="flex items-center gap-2 bg-stone-100 rounded-xl px-3 py-2 text-xs flex-shrink-0">
              <File size={13} /><span className="max-w-[150px] truncate">{file.name}</span>
              <button type="button" onClick={() => setFiles(prev => prev.filter((_, i) => i !== index))}><X size={13} /></button>
            </div>
          ))}
        </div>
      )}
      <textarea ref={textareaRef} value={query} onChange={e => setQuery(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(e); } }}
        placeholder="Describe a task for VetroAI Computer…" rows={2}
        className="w-full resize-none border-0 outline-none bg-transparent px-2 py-1 text-[15px] placeholder:text-stone-400" />
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-1">
          <input ref={fileRef} type="file" multiple className="hidden" onChange={onFiles} accept=".pdf,.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.py,.java,.cpp,.c,.html,.xml,.yaml,.yml,image/*" />
          <button type="button" onClick={() => fileRef.current?.click()} className="p-2 rounded-xl hover:bg-stone-100 text-stone-600" title="Attach files"><Paperclip size={18} /></button>
          <button type="button" className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl hover:bg-stone-100 text-xs text-stone-600"><Globe2 size={16} /> Web</button>
          <button type="button" onClick={toggleDictation} className={`p-2 rounded-xl hover:bg-stone-100 ${dictating ? "text-red-600 animate-pulse" : "text-stone-600"}`}><Mic size={17} /></button>
        </div>
        <button type="submit" disabled={!query.trim() || running} className="w-9 h-9 rounded-xl bg-stone-900 text-white flex items-center justify-center disabled:opacity-35">
          {running ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>
    </form>
  );
}
