import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import StructuredResponseRenderer from "../structured/StructuredResponseRenderer";
import { splitVisualBlocks, visualsToMarkdown } from "../../lib/structuredSegments";
import "./ComputerUI.css";
import { resolveApiBase } from "../../lib/apiBase";
import {
  ArrowLeft, Bot, CalendarClock, Check, CheckCircle2, ChevronDown, Circle, Clock3,
  Download, File, FolderOpen, Globe2, HardDrive, Loader2, LockKeyhole, MapPin, Mic, Monitor, MoreHorizontal,
  Paperclip, Pause, Play, Plus, RotateCcw, Search, Send, ShieldCheck,
  Square, Trash2, X, Zap
} from "lucide-react";

const PROD_API = "https://ai-chatbot-backend-gvvz.onrender.com/api";
// Replies can mix prose with visual JSON blocks (timeline, chart, metrics…).
// Draw each block with the chat's visual renderer, in place, instead of
// showing the raw JSON.
function TaskReply({ content }) {
  const segments = useMemo(() => splitVisualBlocks(content), [content]);
  return segments.map((segment, i) => segment.kind === "visual"
    ? <div key={i} className="cowork-visual not-prose"><StructuredResponseRenderer response={segment.raw} /></div>
    : <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>{segment.text}</ReactMarkdown>);
}

const API = resolveApiBase(import.meta.env.VITE_API_BASE_URL, import.meta.env.PROD, PROD_API);
const STORE_KEY = "vetroai_cowork_tasks_v2";
// Mouse/keyboard/app control needs the local companion — a page served from
// any web host is sandboxed away from those OS APIs no matter where it runs.
// CI publishes a ready-to-run installer per desktop-v* tag, so this points at
// a download rather than asking anyone to build it.
const COMPANION_DOWNLOAD_URL = "https://github.com/vetrivel44-bit/vetroai-frontend/releases/latest";
const RISKY_ACTION = /\b(send|email|message|post|publish|buy|purchase|pay|book|delete|remove|upload|submit|login|sign in|change password|share|play|open)\b/i;
const NEARBY_REQUEST = /\b(near me|nearby|nearest|closest|around me|current location|near my location)\b/i;
const YOUTUBE_REQUEST = /(?:\b(?:open|go to)\s+youtube\b[\s\S]*?\bplay\s+(.+)|\bplay\s+(.+?)\s+(?:on|in)\s+youtube\b|\byoutube\s+(?:play|search)\s+(.+))/i;
const WORD_REQUEST = /\b(?:word document|word doc|microsoft word)\b|\.docx?\b/i;
const SHEET_REQUEST = /\b(?:spreadsheet|excel|csv|google sheets?)\b|\.xlsx?\b/i;
const WEBSITE_REQUEST = /\b(?:build|make|create|design|generate)\b[\s\S]{0,40}\b(?:website|web ?site|landing page|portfolio site|web page)\b/i;
// Asks that need a real mouse and keyboard. In a normal browser tab there is
// no way to do these — the page is sandboxed away from the OS — so they get an
// explanation and the download link instead of being quietly routed to the
// generic task path, which answers about the work rather than doing it.
// The app name has to directly follow the verb. A loose "verb within 50
// characters of a noun" window matched plenty of things this workspace does
// handle — "open the excel file I attached and summarize it" is file analysis,
// not app control.
const DESKTOP_CONTROL_REQUEST = /\b(?:open|launch|start|run|close)\s+(?:the\s+|a\s+|an\s+|my\s+)?(?:ms ?word|microsoft word|word|excel|powerpoint|notepad|calculator|file explorer|finder|terminal|command prompt|control panel|settings|chrome|edge|firefox|spotify|whatsapp|outlook|paint|vs ?code)\b|\b(?:open|launch|start)\s+(?:an?\s+)?(?:app|application|program|software)\b|\b(?:click|double.?click|scroll|drag)\b[\s\S]{0,40}\b(?:on|in)\s+my\s+(?:desktop|computer|screen|pc|laptop)\b|\bcontrol my (?:mouse|keyboard|screen|computer|desktop|pc)\b/i;
// Asks for live, interactive-site data (bus/flight/train fares, hotel
// prices, real-time schedules) that no plain-chat model can answer — the
// numbers only exist behind a search form on the booking site itself. These
// need the same real mouse/keyboard as app control, so they route through
// the identical "needs desktop" / agent-loop path rather than falling
// through to a chat answer that can only say it has no live browsing.
const LIVE_BROWSE_REQUEST = /\b(?:redbus|irctc|makemytrip|goibibo|ixigo|abhibus|ticketgoose|yatra|cleartrip|skyscanner|expedia|booking\.com|airbnb)\b|\b(?:bus|flight|train|hotel|cab|taxi)(?:es)?\b[\s\S]{0,60}\b(?:price|prices|fare|fares|schedule|schedules|ticket|tickets)\b[\s\S]{0,40}\b(?:today|tomorrow|from\s.+\bto\b)\b|\b(?:price|prices|fare|fares|schedule|schedules|ticket|tickets)\b[\s\S]{0,60}\b(?:bus|flight|train|hotel|cab|taxi)(?:es)?\b[\s\S]{0,40}\b(?:today|tomorrow|from\s.+\bto\b)\b/i;
// Content the browser workspace can genuinely work with, even when the
// sentence starts with "open" — these must not be diverted to the desktop app.
const FILE_CONTENT_REQUEST = /\b(?:file|files|document|documents|doc|docs|spreadsheet|sheet|attachment|attached|upload(?:ed)?|pdf)\b/i;
const HTML_BLOCK = /```html\s*([\s\S]*?)```/i;
// A single "open an app, download something, click through an installer"
// task easily runs 30-60+ small steps. This is a runaway backstop, not a
// realistic budget — the stop button and Ctrl+Shift+X both work at any step.
const MAX_AGENT_STEPS = 80;
// Every step is a full network round trip, so a full-resolution 4K screenshot
// (several MB) directly costs latency — downscale before sending. The model's
// coordinates then come back in this smaller space and get multiplied back up
// to real screenshot-pixel space before any click actually happens.
const AGENT_SCREEN_MAX_WIDTH = 1280;
// Only the last few steps are actually useful context for "what's the next
// move" — including all 80 possible steps in every prompt would make the
// request (and therefore each round trip) slower as a run goes on.
const AGENT_LOG_WINDOW = 10;

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read the screenshot."));
    img.src = src;
  });
}

// Returns the blob actually sent to the model plus the scale factor needed to
// convert coordinates it reports (in the downscaled image) back to real
// screenshot-pixel space.
async function prepareScreenshotForModel(dataUrl) {
  const img = await loadImageElement(dataUrl);
  const naturalWidth = img.naturalWidth || img.width;
  const naturalHeight = img.naturalHeight || img.height;
  if (!naturalWidth || naturalWidth <= AGENT_SCREEN_MAX_WIDTH) {
    const blob = await (await fetch(dataUrl)).blob();
    return { blob, scale: 1, width: naturalWidth, height: naturalHeight };
  }
  const scale = naturalWidth / AGENT_SCREEN_MAX_WIDTH;
  const width = AGENT_SCREEN_MAX_WIDTH;
  const height = Math.round(naturalHeight / scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(img, 0, 0, width, height);
  const resized = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (resized) return { blob: resized, scale, width, height };
  // Canvas encoding failed for some reason — fall back to the original,
  // uncompressed screenshot rather than losing the step.
  const blob = await (await fetch(dataUrl)).blob();
  return { blob, scale: 1, width: naturalWidth, height: naturalHeight };
}

function extractHtmlDocument(markdown) {
  const match = HTML_BLOCK.exec(String(markdown || ""));
  return match ? match[1].trim() : null;
}

// Preview-only instrumentation so the agent can actually "see" what it just
// built: without this, computer mode hands back an HTML string and never
// knows whether the page even renders — any script error, missing element,
// or broken layout is invisible to it. This script forwards runtime errors
// out of the sandboxed iframe via postMessage so the UI can show them and
// feed them back to the model for a fix pass.
const PREVIEW_ERROR_CAPTURE = `<script>(function(){
  function report(message){ try { window.parent.postMessage({ source: "vetroai-preview", type: "error", message: String(message) }, "*"); } catch (e) {} }
  window.addEventListener("error", function(e){ report((e.message || "Script error") + (e.filename ? " (" + e.filename.split("/").pop() + ":" + e.lineno + ")" : "")); });
  window.addEventListener("unhandledrejection", function(e){ report("Unhandled promise rejection: " + (e.reason && e.reason.message ? e.reason.message : e.reason)); });
  var origError = console.error;
  console.error = function(){ report(Array.prototype.slice.call(arguments).map(String).join(" ")); origError.apply(console, arguments); };
})();</script>`;

function withPreviewErrorCapture(html) {
  const doc = String(html || "");
  if (/<head[^>]*>/i.test(doc)) return doc.replace(/<head[^>]*>/i, (tag) => `${tag}${PREVIEW_ERROR_CAPTURE}`);
  if (/<html[^>]*>/i.test(doc)) return doc.replace(/<html[^>]*>/i, (tag) => `${tag}${PREVIEW_ERROR_CAPTURE}`);
  return `${PREVIEW_ERROR_CAPTURE}${doc}`;
}

// One JSON action object per screen-control step — see AIOrchestrator's
// "computer_use" system prompt for the exact schema this must match.
function parseAgentAction(text) {
  const match = String(text || "").match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const action = JSON.parse(match[0]);
    return action && typeof action.action === "string" ? action : null;
  } catch {
    return null;
  }
}

function describeAgentAction(action) {
  switch (action.action) {
    case "click": return `Click ${action.button || "left"} at (${Math.round(action.x)}, ${Math.round(action.y)})`;
    case "move": return `Move to (${Math.round(action.x)}, ${Math.round(action.y)})`;
    case "type": return `Type "${String(action.text || "").slice(0, 40)}"`;
    case "key": return `Press ${action.key}${action.modifiers?.length ? ` + ${action.modifiers.join("+")}` : ""}`;
    case "scroll": return `Scroll ${action.amount > 0 ? "down" : "up"}`;
    case "drag": return `Drag from (${Math.round(action.fromX)}, ${Math.round(action.fromY)}) to (${Math.round(action.toX)}, ${Math.round(action.toY)})`;
    case "copy": return "Copy to clipboard";
    case "paste": return action.text ? `Paste "${String(action.text).slice(0, 40)}"` : "Paste from clipboard";
    case "done": return action.summary || "Done";
    default: return `Unrecognized action: ${action.action}`;
  }
}

async function performDesktopAction(desktop, action) {
  switch (action.action) {
    case "move": return desktop.moveMouse(Number(action.x), Number(action.y), action.duration);
    case "click":
      await desktop.moveMouse(Number(action.x), Number(action.y), 150);
      return desktop.click(action.button || "left", Boolean(action.double));
    case "type": return desktop.typeText(String(action.text || "").slice(0, 2000));
    case "key": return desktop.pressKey(action.key, action.modifiers || []);
    case "scroll": return desktop.scroll(Number(action.amount) || 0);
    case "drag": return desktop.drag(Number(action.fromX), Number(action.fromY), Number(action.toX), Number(action.toY), action.duration);
    case "copy": {
      await desktop.pressKey("C", ["CTRL"]);
      await new Promise(resolve => setTimeout(resolve, 120));
      return desktop.readClipboard();
    }
    case "paste": {
      if (action.text) await desktop.writeClipboard(String(action.text));
      return desktop.pressKey("V", ["CTRL"]);
    }
    default: return null;
  }
}

// Speaks each step as the agent takes it, so a run reads as something
// actually doing the work instead of a silent, unwatchable black box.
// Cancels any utterance still in flight rather than queuing — narration for
// the step 4 steps ago finishing mid-run-6 would be confusing, not helpful.
function narrateAction(text) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.05;
  window.speechSynthesis.speak(utterance);
}
function safeFilename(value, fallback) { return String(value || fallback).replace(/[^a-z0-9-_ ]/gi, "").trim().replace(/\s+/g, "-").slice(0, 54) || fallback; }
function downloadBlob(content, type, filename) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadWordDocument(title, markdown) {
  const escaped = String(markdown || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>").replace(/^## (.+)$/gm, "<h2>$1</h2>").replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
  const html = "<!doctype html><html><head><title>" + title + "</title><style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.5;margin:42px;color:#222}h1{font-size:22pt}h2{font-size:16pt;margin-top:24px}h3{font-size:13pt;margin-top:18px}</style></head><body>" + escaped + "</body></html>";
  downloadBlob(html, "application/msword", safeFilename(title, "VetroAI-document") + ".doc");
}
function markdownTableToCsv(markdown) {
  const rows = String(markdown || "").split("\n").filter(line => /^\s*\|.*\|\s*$/.test(line))
    .map(line => line.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim()));
  const data = rows.filter(row => !row.every(cell => /^:?-{3,}:?$/.test(cell)));
  return data.length ? data : [["VetroAI result"], [String(markdown || "").replace(/[#*_]/g, "")]];
}
function downloadSpreadsheet(title, markdown) {
  const csv = markdownTableToCsv(markdown).map(row => row.map(cell => JSON.stringify(String(cell))).join(",")).join("\r\n");
  downloadBlob("\ufeff" + csv, "text/csv;charset=utf-8", safeFilename(title, "VetroAI-spreadsheet") + ".csv");
}
async function requestCurrentLocation() {
  if (!window.isSecureContext || !navigator.geolocation) return { location: null, reason: "unsupported" };
  return new Promise(resolve => navigator.geolocation.getCurrentPosition(
    ({ coords }) => resolve({ location: { lat: Number(coords.latitude), lng: Number(coords.longitude), accuracy: Number(coords.accuracy) || null }, reason: null }),
    error => resolve({ location: null, reason: error?.code === 1 ? "denied" : error?.code === 3 ? "timeout" : "unavailable" }),
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 }
  ));
}
const READABLE_FILE = /\.(txt|md|csv|json|js|jsx|ts|tsx|py|java|cpp|c|html|css|xml|ya?ml)$/i;
const MAX_WORKSPACE_FILES = 200;

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
  const [locationNotice, setLocationNotice] = useState("");
  const [workspace, setWorkspace] = useState(null);
  const [workspaceFiles, setWorkspaceFiles] = useState([]);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [showCapabilities, setShowCapabilities] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [screenControl, setScreenControl] = useState(false);
  const [narrate, setNarrate] = useState(() => {
    try { return localStorage.getItem("vetroai_computer_narrate") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("vetroai_computer_narrate", narrate ? "1" : "0"); } catch { /* storage unavailable */ }
  }, [narrate]);
  // Live view of what the screen-control agent is doing right now — deliberately
  // kept out of `tasks` state (which gets persisted to localStorage) so a run of
  // screenshots never gets written to disk or blows the storage quota.
  const [agentView, setAgentView] = useState(null);
  const hasDesktop = typeof window !== "undefined" && Boolean(window.vetroDesktop);
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
          } else if (type === "clear") {
            // Backend is retrying with a fallback provider after the previous
            // one failed or stalled — drop whatever partial text it streamed.
            content = "";
            patchTask(taskId, t => ({
              ...t,
              messages: t.messages.map(m => m.id === assistantId ? { ...m, content: "" } : m)
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
      let taskPrompt = prompt;
      if (NEARBY_REQUEST.test(prompt)) {
        setLocationNotice("Requesting your precise location…");
        const result = await requestCurrentLocation();
        if (result.location) {
          const accuracy = Math.round(result.location.accuracy || 0);
          setLocationNotice("Location allowed" + (accuracy ? " (accuracy about " + accuracy + " m)." : "."));
          taskPrompt += "\n\n[USER-APPROVED CURRENT LOCATION] Latitude: " + result.location.lat + ", Longitude: " + result.location.lng + ". Use these coordinates only for this nearby request.";
        } else {
          const instruction = result.reason === "denied"
            ? "Location is blocked. Click the lock/site-controls icon beside the address bar, set Location to Allow, then retry."
            : "Location is unavailable. Check Windows Location Services or provide your city, locality, or PIN code.";
          setLocationNotice(instruction);
          taskPrompt += "\n\n[LOCATION UNAVAILABLE] " + instruction + " Do not guess the user's location.";
        }
      }
      const youtubeMatch = prompt.match(YOUTUBE_REQUEST);
      if (youtubeMatch) {
        const musicQuery = (youtubeMatch[1] || youtubeMatch[2] || youtubeMatch[3] || prompt)
          .replace(/^(?:a|the)\s+/i, "")
          .trim();
        const desktop = window.vetroDesktop;
        if (desktop?.playYouTube) {
          let status = await desktop.getStatus();
          if (!status?.enabled) status = await desktop.requestControl();
          if (status?.enabled) {
            const result = await desktop.playYouTube(musicQuery);
            taskPrompt += "\n\n[ACTION RESULT] The VetroAI desktop companion opened YouTube and " +
              (result.clicked ? "clicked the first video for: " : "opened search results for: ") +
              musicQuery + ". Report this result accurately.";
          } else {
            taskPrompt += "\n\n[ACTION RESULT] Desktop control was not approved, so VetroAI did not click YouTube. Ask the user to approve computer control.";
          }
        } else {
          // No companion, so nothing can click a search result — a web page is
          // not allowed to click inside youtube.com. Resolve the first result
          // on the backend instead and open the video itself, which plays with
          // no click at all. Falls back to the search page if that fails, so a
          // YouTube layout change degrades instead of breaking the feature.
          // Opened before the lookup, and blank: window.open only succeeds
          // inside the click's user activation, and awaiting a round trip to
          // the backend first outlives it. A blocked popup used to fall
          // through to navigating this whole app away mid-task.
          const tab = window.open("about:blank", "_blank");
          // Same protection "noopener" would give, but keeps the handle so the
          // tab can be pointed at the video once it's resolved.
          if (tab) tab.opener = null;

          let resolved = null;
          try {
            const lookup = await fetch(`${API}/youtube/resolve?q=${encodeURIComponent(musicQuery)}`, { signal: controller.signal });
            if (lookup.ok) {
              const payload = await lookup.json();
              if (payload?.success && payload.data?.watchUrl) resolved = payload.data;
            }
          } catch (error) {
            if (error.name === "AbortError") { tab?.close(); throw error; }
          }

          const youtubeUrl = resolved
            ? `${resolved.watchUrl}&autoplay=1`
            : "https://www.youtube.com/results?search_query=" + encodeURIComponent(musicQuery);
          if (tab) {
            tab.location.replace(youtubeUrl);
            taskPrompt += resolved
              ? `\n\n[ACTION RESULT] The video "${resolved.title || musicQuery}" was opened and is playing for: ${musicQuery}. Report that it is playing now — the user does not need to click anything.`
              : "\n\n[ACTION RESULT] The first video could not be resolved, so YouTube search results were opened for: " + musicQuery +
                ". The browser cannot click a result for the user — a web page is not allowed to click inside youtube.com. Do not claim the video was clicked or that it is playing." +
                " Tell the user plainly that they need to click the video themselves here, and that VetroAI's desktop app (" + COMPANION_DOWNLOAD_URL + ") can click it automatically instead.";
          } else {
            patchTask(taskId, t => ({
              ...t,
              status: "completed",
              steps: t.steps.map(step => ({ ...step, status: "done" })),
              messages: t.messages.map(message => message.id === assistantId
                ? { ...message, content: "Opening YouTube search for **" + musicQuery + "** in this tab…" }
                : message)
            }));
            window.location.assign(youtubeUrl);
            return;
          }
        }
      }
      // Once a task has produced a website, keep routing follow-ups (e.g. "fix
      // these errors") through Design mode even if the fix prompt itself
      // doesn't say "build a website" — otherwise a fix request silently
      // drops back to a plain code-chat reply instead of a full HTML redo.
      const hasWebsiteContext = task.messages.some(m => m.exports?.includes("website"));
      const isWebsiteRequest = WEBSITE_REQUEST.test(prompt) || hasWebsiteContext;
      const body = new FormData();
      body.append("provider", "gemini");
      // A full-site build gets routed through Design mode's battle-tested
      // single-file HTML system prompt instead of the generic task prompt below.
      body.append("mode", isWebsiteRequest ? "design" : "code_exec");
      body.append("input", taskPrompt);
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
        steps: t.steps.map(s => ({ ...s, status: "done" })),
        messages: t.messages.map(message => message.id === assistantId ? {
          ...message,
          exports: [
            ...(WORD_REQUEST.test(prompt) ? ["word"] : []),
            ...(SHEET_REQUEST.test(prompt) ? ["spreadsheet"] : []),
            ...(isWebsiteRequest ? ["website"] : [])
          ]
        } : message)
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

  // Feeds browser-observed errors from the live preview back to the model so
  // it can actually see and fix what it built, instead of the task ending the
  // moment the HTML is generated regardless of whether it works.
  const requestWebsiteFix = (html, errors) => {
    if (running || !errors.length) return;
    const errorList = errors.map((message, i) => `${i + 1}. ${message}`).join("\n");
    const prompt = [
      "The website you generated has runtime errors, caught live in the browser preview. Fix them and output the full corrected HTML document again in a single ```html code block — no diff, no explanation-only reply.",
      "",
      "Browser console errors:",
      errorList,
      "",
      "Current HTML:",
      "```html",
      html,
      "```"
    ].join("\n");
    execute(prompt);
  };

  // Drives the real mouse/keyboard through the VetroAI desktop companion:
  // screenshot -> ask the model for exactly one next action -> perform it -> repeat.
  // The companion's own permission dialog (desktop/main.cjs) is the actual consent
  // gate — approving it there is what lets any of computer:* IPC calls succeed at
  // all, and Ctrl+Shift+X always stops it immediately regardless of this loop.
  const runComputerAgent = async (goal) => {
    const desktop = window.vetroDesktop;
    let task = activeTask;
    if (!task) {
      task = makeTask(goal.slice(0, 54));
      setTasks(prev => [task, ...prev]);
      setActiveId(task.id);
    }
    const taskId = task.id;
    const assistantId = `a-${Date.now()}`;
    const userMessage = { id: `u-${Date.now()}`, role: "user", content: goal };
    const plan = [
      { id: "control", label: "Request screen control permission", status: "active" },
      { id: "agent", label: "Drive the screen toward the goal", status: "pending" },
      // Not "Ready for your review" — a completed task already renders a
      // banner with exactly that wording, so the two read as a duplicate.
      { id: "review", label: "Stop and report what it did", status: "pending" }
    ];

    patchTask(taskId, t => ({
      ...t,
      title: t.messages.length ? t.title : goal.slice(0, 54),
      status: "running",
      steps: plan,
      messages: [...t.messages, userMessage, { id: assistantId, role: "assistant", content: "" }]
    }));
    setQuery("");

    const controller = new AbortController();
    abortRef.current = controller;

    const fail = (message) => {
      patchTask(taskId, t => ({
        ...t,
        status: "failed",
        steps: t.steps.map(s => s.status === "active" ? { ...s, status: "failed" } : s),
        messages: t.messages.map(m => m.id === assistantId ? { ...m, content: message } : m)
      }));
    };

    let status = await desktop.getStatus();
    if (!status?.enabled) status = await desktop.requestControl();
    if (!status?.enabled) {
      fail("Screen control wasn't approved, so VetroAI didn't touch your mouse or keyboard. Open the desktop companion and allow control when prompted, then try again.");
      abortRef.current = null;
      return;
    }
    patchTask(taskId, t => ({ ...t, steps: t.steps.map((s, i) => i === 0 ? { ...s, status: "done" } : i === 1 ? { ...s, status: "active" } : s) }));

    const log = [];
    // Chat bubble stays readable on a long run — the live agentView panel below
    // is where you actually watch it work, this is just a scroll-back log.
    const renderLog = () => {
      const tail = log.length > 25 ? log.slice(log.length - 25) : log;
      const skipped = log.length - tail.length;
      const lines = tail.map((line, i) => `${skipped + i + 1}. ${line}`);
      return (skipped ? `_(${skipped} earlier step${skipped > 1 ? "s" : ""} not shown)_\n` : "") + lines.join("\n");
    };

    try {
      for (let step = 0; step < MAX_AGENT_STEPS; step++) {
        if (controller.signal.aborted) throw new DOMException("Stopped", "AbortError");

        const shotDataUrl = await desktop.screenshot();
        setAgentView({ taskId, screenshot: shotDataUrl, action: null, step: step + 1 });
        const { blob: shotBlob, scale: shotScale, width: shotWidth, height: shotHeight } = await prepareScreenshotForModel(shotDataUrl);

        const recentLog = log.length > AGENT_LOG_WINDOW ? log.slice(log.length - AGENT_LOG_WINDOW) : log;
        const skippedCount = log.length - recentLog.length;
        const stepPrompt = [
          `Goal: ${goal}`,
          `The attached screenshot is exactly ${shotWidth}x${shotHeight} pixels — give x,y within that size.`,
          recentLog.length
            ? `${skippedCount ? `(${skippedCount} earlier step${skippedCount > 1 ? "s" : ""} omitted)\n` : ""}Most recent actions:\n${recentLog.map((line, i) => `${skippedCount + i + 1}. ${line}`).join("\n")}`
            : "No actions taken yet — this is the first step.",
          "Reply with exactly one JSON action for the next step, per your instructions."
        ].join("\n\n");

        const body = new FormData();
        // NOT "gemini" — public/gemini-puter-bridge.js globally intercepts any
        // /api/chat request with provider=gemini and reroutes it through
        // client-side Puter.js, which never sees the `files` field at all. That
        // would silently blind the agent — it'd "decide" actions without ever
        // actually seeing the screenshot. AIOrchestrator already forces the
        // real backend Gemini adapter for mode=computer_use regardless of what
        // provider is requested (see isComputerUse in processRequest), so leave
        // this as "auto" and let the backend choose.
        body.append("provider", "auto");
        body.append("mode", "computer_use");
        body.append("input", stepPrompt);
        body.append("messages", JSON.stringify([{ role: "user", content: stepPrompt }]));
        body.append("safeMode", "true");
        body.append("files", shotBlob, "screen.jpg");

        const response = await fetch(`${API}/chat`, { method: "POST", body, signal: controller.signal });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.message || `Server error: ${response.status}`);
        }
        const raw = await readStream(response, taskId, assistantId);
        const action = parseAgentAction(raw);
        if (!action) throw new Error("VetroAI didn't return a usable action, so it stopped rather than guess.");
        // The model saw a downscaled image — scale its coordinates back up to
        // real screenshot-pixel space before anything touches the real cursor.
        if (shotScale !== 1) {
          if (typeof action.x === "number") action.x *= shotScale;
          if (typeof action.y === "number") action.y *= shotScale;
          if (typeof action.fromX === "number") action.fromX *= shotScale;
          if (typeof action.fromY === "number") action.fromY *= shotScale;
          if (typeof action.toX === "number") action.toX *= shotScale;
          if (typeof action.toY === "number") action.toY *= shotScale;
        }

        const description = describeAgentAction(action);
        log.push(description);
        if (narrate) narrateAction(description);
        // Real screenshot-pixel-space target for the cursor marker overlay —
        // undefined for actions with no coordinates (type/key/scroll/done),
        // which just clears any marker left over from the previous step.
        const target = typeof action.x === "number" && typeof action.y === "number"
          ? { x: action.x, y: action.y, naturalWidth: shotWidth * shotScale, naturalHeight: shotHeight * shotScale }
          : null;
        setAgentView(prev => (prev ? { ...prev, action: description, target } : prev));
        // Kept on the task (not just `log`) so the step list survives a
        // completed/failed run and can still be rewound afterward — the
        // screenshot is the *before* frame, taken at the top of this loop.
        const historyEntry = { index: step + 1, description, screenshot: shotDataUrl };
        patchTask(taskId, t => ({
          ...t,
          steps: t.steps.map(s => s.id === "agent" ? { ...s, detail: description } : s),
          messages: t.messages.map(m => m.id === assistantId ? { ...m, content: renderLog() } : m),
          actionHistory: [...(t.actionHistory || []), historyEntry]
        }));

        if (action.action === "done") break;
        const result = await performDesktopAction(desktop, action);
        // Lets the model see what it actually copied on the next step, instead
        // of guessing blindly at what a Ctrl+C grabbed.
        if (action.action === "copy" && result?.text) {
          log.push(`Clipboard now contains: "${result.text.slice(0, 200)}"`);
        }
        await new Promise(resolve => setTimeout(resolve, 400));
      }

      patchTask(taskId, t => ({
        ...t,
        status: "completed",
        steps: t.steps.map(s => ({ ...s, status: "done" })),
        messages: t.messages.map(m => m.id === assistantId ? { ...m, content: renderLog() || "No action was needed." } : m)
      }));
    } catch (error) {
      const stopped = error.name === "AbortError";
      patchTask(taskId, t => ({
        ...t,
        status: stopped ? "stopped" : "failed",
        steps: t.steps.map(s => s.status === "active" ? { ...s, status: stopped ? "pending" : "failed" } : s),
        messages: t.messages.map(m => m.id === assistantId
          ? { ...m, content: `${renderLog()}${log.length ? "\n\n" : ""}${stopped ? "Stopped." : `Stopped driving the screen: ${error.message}`}` }
          : m)
      }));
    } finally {
      abortRef.current = null;
      // Leave the last frame on screen for a moment so you can see how it
      // ended, then clear it — an old screenshot lingering after the run is
      // over reads as "still working" when it isn't.
      setTimeout(() => setAgentView(prev => (prev ? { ...prev, done: true } : prev)), 0);
      setTimeout(() => setAgentView(null), 4000);
    }
  };

  // Says plainly that an ask needs the companion app, instead of handing it to
  // the generic task path — which would describe the steps as if it had done
  // them, or open a page and leave the user wondering why nothing was clicked.
  const explainDesktopRequired = (prompt) => {
    let task = activeTask;
    if (!task) {
      task = makeTask(prompt.slice(0, 54));
      setTasks(prev => [task, ...prev]);
      setActiveId(task.id);
    }
    patchTask(task.id, t => ({
      ...t,
      title: t.messages.length ? t.title : prompt.slice(0, 54),
      status: "failed",
      steps: [{ id: "desktop", label: "Needs the desktop app for mouse and keyboard control", status: "failed" }],
      messages: [
        ...t.messages,
        { id: `u-${Date.now()}`, role: "user", content: prompt },
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: [
            "I can't do this from a browser tab. Moving your mouse, typing, and opening apps needs VetroAI's desktop app — a web page is blocked from touching your operating system, and no website can get around that.",
            "",
            `**[Download the desktop app](${COMPANION_DOWNLOAD_URL})** — one file, no setup, no admin rights. Open VetroAI there, turn on **Screen control** in the composer, and send this same request again.`,
            "",
            "Everything else here — building websites, research, documents, file analysis — works fine in this tab.",
          ].join("\n"),
        },
      ],
    }));
    setQuery("");
  };

  const submit = (event, suggestion = "") => {
    event?.preventDefault();
    const prompt = (suggestion || query).trim();
    if (!prompt || running) return;
    if (screenControl && hasDesktop) {
      runComputerAgent(prompt);
      return;
    }
    // YouTube is excluded deliberately: that path opens the video itself, so
    // diverting it to the desktop app would disable a feature that works here.
    // Attachments and file/document wording are excluded for the same reason.
    const needsDesktop = !hasDesktop
      && (DESKTOP_CONTROL_REQUEST.test(prompt) || LIVE_BROWSE_REQUEST.test(prompt))
      && !YOUTUBE_REQUEST.test(prompt)
      && !FILE_CONTENT_REQUEST.test(prompt)
      && !files.length;
    if (needsDesktop) {
      explainDesktopRequired(prompt);
      return;
    }
    if (permission === "ask" && RISKY_ACTION.test(prompt)) {
      setPendingAction(prompt);
      return;
    }
    execute(prompt);
  };

  const stopTask = () => abortRef.current?.abort();

  // Rewinds the agent's *context*, not the real desktop — a click already
  // happened on the actual screen and nothing here can un-happen it. What
  // this buys back is the conversation: prune the steps after a wrong turn
  // out of the action log the model sees, so its next move is planned fresh
  // off a real screenshot instead of "correcting" a chain of bad guesses.
  const rewindTo = (taskId, index) => {
    abortRef.current?.abort();
    patchTask(taskId, t => ({
      ...t,
      status: "ready",
      actionHistory: (t.actionHistory || []).slice(0, index),
    }));
    setActiveId(taskId);
    setQuery(`Continue the task from step ${index}. The screen may have changed since — take a fresh look before your next move rather than assuming it's still where step ${index} left it.`);
    textareaRef.current?.focus();
  };

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

  const scanDirectory = async (directory, prefix = "", output = []) => {
    for await (const [name, handle] of directory.entries()) {
      if (output.length >= MAX_WORKSPACE_FILES) break;
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === "directory") {
        await scanDirectory(handle, path, output);
      } else {
        const file = await handle.getFile();
        output.push({ name, path, size: file.size, type: file.type, handle });
      }
    }
    return output;
  };

  const openWorkspace = async () => {
    if (!window.showDirectoryPicker) {
      alert("Folder access requires Chrome or Edge on HTTPS. You can still attach individual files.");
      return;
    }
    try {
      setWorkspaceBusy(true);
      const handle = await window.showDirectoryPicker({ mode: "readwrite", id: "vetroai-computer-workspace" });
      const permission = await handle.requestPermission({ mode: "readwrite" });
      if (permission !== "granted") return;
      const entries = await scanDirectory(handle);
      setWorkspace({ name: handle.name, handle });
      setWorkspaceFiles(entries);
    } catch (error) {
      if (error.name !== "AbortError") alert(`Could not open folder: ${error.message}`);
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const attachWorkspaceFile = async entry => {
    try {
      const file = await entry.handle.getFile();
      setFiles(prev => [...prev.filter(item => item.name !== file.name), file].slice(0, 10));
    } catch (error) {
      alert(`Could not read ${entry.path}: ${error.message}`);
    }
  };

  const deleteWorkspaceFile = async () => {
    if (!deleteTarget || !workspace?.handle) return;
    try {
      const segments = deleteTarget.path.split("/");
      const name = segments.pop();
      let parent = workspace.handle;
      for (const segment of segments) parent = await parent.getDirectoryHandle(segment);
      await parent.removeEntry(name);
      setWorkspaceFiles(prev => prev.filter(entry => entry.path !== deleteTarget.path));
      setDeleteTarget(null);
    } catch (error) {
      alert(`Could not delete ${deleteTarget.path}: ${error.message}`);
    }
  };

  return (
    <div className="cowork-shell">
      <aside className={`cowork-tasks-sidebar ${sidebarOpen ? "is-open" : "is-closed"}`}>
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

      <main className="cowork-main">
        <header className="cowork-header">
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
          <button onClick={() => setShowCapabilities(true)} className="p-2 rounded-lg hover:bg-stone-100" title="Capabilities"><MoreHorizontal size={18} /></button>
        </header>

        {locationNotice && (
          <div className="cowork-location-notice">
            <MapPin size={16} /><span>{locationNotice}</span>
            <button type="button" onClick={() => setLocationNotice("")} aria-label="Dismiss location message"><X size={14} /></button>
          </div>
        )}

        {!activeTask || activeTask.messages.length === 0 ? (
          <section className="cowork-home-scroll">
            <div className="cowork-home">
              <div className="cowork-hero-icon"><Bot size={24} /></div>
              <h1 className="cowork-title">Hand off a task</h1>
              <p className="cowork-subtitle">Describe the outcome you want. VetroAI Computer will plan the work, use available web and file context, show progress, and return the result for review.</p>
              <div className="cowork-workspace-bar">
                <button type="button" onClick={openWorkspace} disabled={workspaceBusy} className="cowork-workspace-button">
                  {workspaceBusy ? <Loader2 size={16} className="animate-spin" /> : <FolderOpen size={16} />}
                  {workspace ? workspace.name : "Open a local folder"}
                </button>
                <span>Read/write access is requested by your browser and stays limited to the folder you choose.</span>
              </div>
              <div className="cowork-starter-grid">
                {starterTasks.map(({ icon: Icon, title, prompt }) => (
                  <button key={title} onClick={e => submit(e, prompt)} className="cowork-starter-card">
                    <Icon size={18} className="text-amber-700 mb-3" />
                    <div className="font-semibold text-sm mb-1">{title}</div>
                    <div className="text-xs leading-relaxed text-stone-500">{prompt}</div>
                  </button>
                ))}
              </div>
              <Composer query={query} setQuery={setQuery} files={files} setFiles={setFiles} submit={submit} running={running} textareaRef={textareaRef} fileRef={fileRef} onFiles={onFiles} dictating={dictating} toggleDictation={toggleDictation} hasDesktop={hasDesktop} screenControl={screenControl} setScreenControl={setScreenControl} narrate={narrate} setNarrate={setNarrate} />
              <p className="cowork-footnote">
                {hasDesktop
                  ? "Screen control is available on this device — turn it on in the composer to let VetroAI use your mouse and keyboard."
                  : <>Browser workspace only. <a href={COMPANION_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" className="underline font-medium">Download the desktop app</a> for mouse, keyboard, and app control — one file, no setup.</>}
              </p>
            </div>
          </section>
        ) : (
          <>
            <section className="cowork-thread-scroll">
              <div className="cowork-thread-grid">
                <div className="space-y-7 min-w-0">
                  {activeTask.messages.map(message => (
                    <div key={message.id} className={message.role === "user" ? "flex justify-end" : "flex gap-3"}>
                      {message.role === "assistant" && <div className="w-8 h-8 rounded-xl bg-stone-900 text-white flex items-center justify-center flex-shrink-0"><Bot size={16} /></div>}
                      <div className={message.role === "user"
                        ? "max-w-[85%] rounded-2xl rounded-br-md bg-stone-900 text-white px-4 py-3 text-sm"
                        : "min-w-0 flex-1 prose prose-sm max-w-none text-stone-800 leading-7"}>
                        {message.role === "assistant"
                          ? (message.content ? (
                            <>
                              <TaskReply content={message.content} />
                              {message.exports?.length > 0 && (
                                <div className="cowork-export-actions">
                                  {message.exports.includes("word") && <button type="button" onClick={() => downloadWordDocument(activeTask.title, visualsToMarkdown(message.content))}><Download size={15} /> Download Word document</button>}
                                  {message.exports.includes("spreadsheet") && <button type="button" onClick={() => downloadSpreadsheet(activeTask.title, visualsToMarkdown(message.content))}><Download size={15} /> Download spreadsheet</button>}
                                  {message.exports.includes("website") && extractHtmlDocument(message.content) && (
                                    <>
                                      <button type="button" onClick={() => downloadBlob(extractHtmlDocument(message.content), "text/html;charset=utf-8", safeFilename(activeTask.title, "vetroai-site") + ".html")}><Download size={15} /> Download website (.html)</button>
                                      <button type="button" onClick={() => window.open("https://dash.cloudflare.com/?to=/:account/pages/new/upload", "_blank", "noopener,noreferrer")}><Globe2 size={15} /> Open Cloudflare Pages to deploy</button>
                                    </>
                                  )}
                                </div>
                              )}
                              {message.exports?.includes("website") && extractHtmlDocument(message.content) && message.id === activeTask.messages[activeTask.messages.length - 1]?.id && (
                                <WebsitePreview
                                  key={message.id}
                                  html={extractHtmlDocument(message.content)}
                                  disabled={running}
                                  onFix={(errors) => requestWebsiteFix(extractHtmlDocument(message.content), errors)}
                                />
                              )}
                            </>
                          ) : <div className="flex items-center gap-2 text-sm text-stone-500"><Loader2 size={15} className="animate-spin" /> Working on your task…</div>)
                          : message.content}
                      </div>
                    </div>
                  ))}
                  <div ref={endRef} />
                </div>
                <aside className="lg:sticky lg:top-0 h-fit bg-white border border-stone-200 rounded-2xl p-4 shadow-sm">
                  {agentView && agentView.taskId === activeTask.id && (
                    <div className="mb-4 pb-4 border-b border-stone-100">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
                          {agentView.done ? "Screen — last frame" : "Watching your screen"}
                        </span>
                        <span className="text-[10px] text-stone-400">Step {agentView.step}</span>
                      </div>
                      <div className="relative rounded-xl overflow-hidden border border-stone-200 bg-stone-100">
                        <img data-testid="agent-screenshot" src={agentView.screenshot} alt={`Screen at step ${agentView.step}`} className="w-full h-auto block" />
                        {!agentView.done && (
                          <span className="absolute top-2 right-2 flex items-center gap-1 bg-red-600 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full">
                            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> LIVE
                          </span>
                        )}
                        {/* Where the real cursor is about to move/click, as a percentage of the
                            screenshot so it stays aligned regardless of how this panel is scaled.
                            No translate: the arrow's tip is at the SVG's own origin, so the
                            element's top-left corner is the click point. */}
                        {!agentView.done && agentView.target && (
                          <div
                            data-testid="agent-cursor"
                            className="absolute pointer-events-none"
                            style={{
                              left: `${(agentView.target.x / agentView.target.naturalWidth) * 100}%`,
                              top: `${(agentView.target.y / agentView.target.naturalHeight) * 100}%`,
                            }}
                          >
                            {/* Thin ring pulsing out from the tip, so it reads as "clicking
                                here" without a coloured blob covering what's underneath. */}
                            <span className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full ring-1 ring-sky-400/80 animate-ping" />
                            <svg width="22" height="22" viewBox="0 0 22 22" className="relative block" style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,.45))" }}>
                              <path d="M1 1 L1 15.2 L4.9 11.6 L7.4 17.2 L10 16 L7.6 10.6 L12.8 10.3 Z"
                                fill="#fff" stroke="#111" strokeWidth="1.2" strokeLinejoin="round" />
                            </svg>
                          </div>
                        )}
                      </div>
                      <div className="mt-2 text-xs text-stone-600 flex items-start gap-1.5">
                        {agentView.action
                          ? <><Monitor size={13} className="mt-0.5 flex-shrink-0" /><span>{agentView.action}</span></>
                          : <><Loader2 size={13} className="mt-0.5 flex-shrink-0 animate-spin" /><span>Deciding the next move…</span></>}
                      </div>
                    </div>
                  )}
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
                  {activeTask.actionHistory?.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-stone-100">
                      <div className="text-[11px] font-semibold text-stone-500 mb-2 flex items-center justify-between">
                        <span>STEP HISTORY</span>
                        <span className="text-stone-400 normal-case font-normal">{activeTask.actionHistory.length} step{activeTask.actionHistory.length > 1 ? "s" : ""}</span>
                      </div>
                      <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                        {activeTask.actionHistory.map(entry => (
                          <div key={entry.index} className="group flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-stone-50">
                            <img src={entry.screenshot} alt="" className="w-9 h-6 object-cover rounded border border-stone-200 flex-shrink-0" />
                            <div className="min-w-0 flex-1 text-[11px] text-stone-600 truncate">{entry.index}. {entry.description}</div>
                            <button
                              type="button"
                              title={`Rewind to before step ${entry.index}`}
                              onClick={() => rewindTo(activeTask.id, entry.index - 1)}
                              className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-1 rounded-md hover:bg-stone-200 text-stone-500"
                            >
                              <RotateCcw size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {activeTask.files?.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-stone-100">
                      <div className="text-[11px] font-semibold text-stone-500 mb-2">FILES</div>
                      {activeTask.files.map(file => <div key={file.name} className="flex items-center gap-2 text-xs text-stone-600 py-1"><File size={13} /> <span className="truncate">{file.name}</span></div>)}
                    </div>
                  )}
                  {activeTask.status === "completed" && <div className="mt-4 pt-4 border-t border-stone-100 flex items-center gap-2 text-xs text-emerald-700"><Check size={15} /> Ready for your review</div>}
                  <WorkspaceFiles entries={workspaceFiles} workspace={workspace} busy={workspaceBusy} openWorkspace={openWorkspace} attachFile={attachWorkspaceFile} requestDelete={setDeleteTarget} />
                </aside>
              </div>
            </section>
            <div className="cowork-bottom-composer">
              <div className="max-w-4xl mx-auto">
                <Composer query={query} setQuery={setQuery} files={files} setFiles={setFiles} submit={submit} running={running} textareaRef={textareaRef} fileRef={fileRef} onFiles={onFiles} dictating={dictating} toggleDictation={toggleDictation} hasDesktop={hasDesktop} screenControl={screenControl} setScreenControl={setScreenControl} narrate={narrate} setNarrate={setNarrate} />
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

      {showCapabilities && <CapabilitiesModal close={() => setShowCapabilities(false)} workspaceReady={Boolean(workspace)} />}
      {deleteTarget && (
        <div className="fixed inset-0 z-[210] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <div className="w-10 h-10 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mb-4"><Trash2 size={20} /></div>
            <h2 className="text-lg font-semibold mb-2">Permanently delete this file?</h2>
            <p className="text-sm text-stone-600 leading-6 mb-5">{deleteTarget.path}<br />This cannot be undone. VetroAI never deletes workspace files without this manual confirmation.</p>
            <div className="flex justify-end gap-2"><button onClick={() => setDeleteTarget(null)} className="px-4 py-2 rounded-xl text-sm hover:bg-stone-100">Cancel</button><button onClick={deleteWorkspaceFile} className="px-4 py-2 rounded-xl text-sm bg-stone-900 text-white">Delete permanently</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// Renders the generated site in a sandboxed iframe and listens for the
// runtime errors PREVIEW_ERROR_CAPTURE forwards out of it — this is the
// "see" half of "see why and fix": without an actual render, computer mode
// has no way of knowing a script threw or a layout broke, only that text
// resembling HTML was produced.
function WebsitePreview({ html, disabled, onFix }) {
  const [errors, setErrors] = useState([]);

  useEffect(() => {
    setErrors([]);
    const onMessage = (event) => {
      if (event.data?.source !== "vetroai-preview" || event.data?.type !== "error") return;
      setErrors(prev => (prev.includes(event.data.message) ? prev : [...prev, event.data.message].slice(-8)));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [html]);

  return (
    <div className="cowork-website-preview">
      <div className="cowork-website-preview-header">
        <span><Globe2 size={13} /> Live preview</span>
        {errors.length > 0 && <span className="cowork-website-preview-badge">{errors.length} error{errors.length > 1 ? "s" : ""} detected</span>}
      </div>
      <iframe
        title="Website preview"
        sandbox="allow-scripts allow-forms allow-popups allow-modals"
        srcDoc={withPreviewErrorCapture(html)}
        className="cowork-website-preview-frame"
      />
      {errors.length > 0 && (
        <div className="cowork-website-preview-errors">
          <div className="cowork-website-preview-errors-title">VetroAI can see these errors in the preview:</div>
          <ul>{errors.map((message, i) => <li key={i}>{message}</li>)}</ul>
          <button type="button" onClick={() => onFix(errors)} disabled={disabled}>
            <RotateCcw size={13} /> Ask VetroAI to fix these
          </button>
        </div>
      )}
    </div>
  );
}

function WorkspaceFiles({ entries, workspace, busy, openWorkspace, attachFile, requestDelete }) {
  return <div className="cowork-workspace-panel">
    <div className="cowork-workspace-heading"><span><HardDrive size={14} /> Workspace</span><button onClick={openWorkspace}>{workspace ? "Change" : "Open"}</button></div>
    {!workspace ? <p>No local folder connected.</p> : <>
      <strong>{workspace.name}</strong><p>{entries.length}{entries.length >= MAX_WORKSPACE_FILES ? "+" : ""} files available</p>
      <div className="cowork-file-list">{entries.slice(0, 12).map(entry => <div key={entry.path} className="cowork-file-row"><button onClick={() => attachFile(entry)} title="Attach to task" disabled={!READABLE_FILE.test(entry.name) && entry.size > 15 * 1024 * 1024}><File size={13} /><span>{entry.path}</span></button><button onClick={() => requestDelete(entry)} title="Delete file"><Trash2 size={13} /></button></div>)}</div>
    </>}
    {busy && <p>Reading folder…</p>}
  </div>;
}

function CapabilitiesModal({ close, workspaceReady }) {
  const rows = [
    [FolderOpen, "Local folder access", workspaceReady ? "Ready" : "Connect folder", "Browser permission required"],
    [File, "Documents and file analysis", "Ready", "Attach or select workspace files"],
    [Globe2, "Web research", "Ready", "Runs through the chat backend"],
    [LockKeyhole, "Delete protection", "Ready", "Manual confirmation required"],
    [Monitor, "Mouse, keyboard, and app control", "Desktop required", "Download the desktop app — one file, no setup", COMPANION_DOWNLOAD_URL],
    [CalendarClock, "Background and scheduled jobs", "Cloud service required", "Needs a durable job runner"],
    [Zap, "Connectors and parallel sub-agents", "Backend required", "Needs authenticated tool adapters"]
  ];
  return <div className="fixed inset-0 z-[205] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"><div className="cowork-capabilities-modal"><div className="cowork-capabilities-header"><div><h2>Computer capabilities</h2><p>Only connected, verifiable tools are marked ready.</p></div><button onClick={close}><X size={18} /></button></div><div className="cowork-capability-list">{rows.map(([Icon, name, status, detail, href]) => <div key={name}><Icon size={18} /><span><strong>{name}</strong><small>{href ? <a href={href} target="_blank" rel="noopener noreferrer" className="underline">{detail}</a> : detail}</small></span><em className={status === "Ready" ? "is-ready" : ""}>{status}</em></div>)}</div></div></div>;
}

function Composer({ query, setQuery, files, setFiles, submit, running, textareaRef, fileRef, onFiles, dictating, toggleDictation, hasDesktop, screenControl, setScreenControl, narrate, setNarrate }) {
  return (
    <form onSubmit={submit} className="cowork-composer">
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
      {hasDesktop && screenControl && (
        <div className="cowork-location-notice" style={{ marginBottom: 8 }}>
          <Monitor size={16} /><span>Screen control is on — VetroAI will move your mouse, click, and type on your real desktop after you approve the permission prompt.</span>
        </div>
      )}
      <textarea ref={textareaRef} value={query} onChange={e => setQuery(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(e); } }}
        placeholder={screenControl ? "Describe what you want VetroAI to do on your screen…" : "Describe a task for VetroAI Computer…"} rows={2}
        className="w-full resize-none border-0 outline-none bg-transparent px-2 py-1 text-[15px] placeholder:text-stone-400" />
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-1">
          <input ref={fileRef} type="file" multiple className="hidden" onChange={onFiles} accept=".pdf,.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.py,.java,.cpp,.c,.html,.xml,.yaml,.yml,image/*" />
          <button type="button" onClick={() => fileRef.current?.click()} className="p-2 rounded-xl hover:bg-stone-100 text-stone-600" title="Attach files"><Paperclip size={18} /></button>
          <button type="button" className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl hover:bg-stone-100 text-xs text-stone-600"><Globe2 size={16} /> Web</button>
          {hasDesktop && (
            <button type="button" onClick={() => setScreenControl(v => !v)}
              className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs ${screenControl ? "bg-stone-900 text-white" : "hover:bg-stone-100 text-stone-600"}`}
              title="Let VetroAI move your mouse and type, with your approval">
              <Monitor size={16} /> Screen control
            </button>
          )}
          {hasDesktop && screenControl && (
            <button type="button" onClick={() => setNarrate(v => !v)}
              className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs ${narrate ? "bg-stone-900 text-white" : "hover:bg-stone-100 text-stone-600"}`}
              title="Speak each action out loud as the agent takes it">
              <Zap size={16} /> Narrate
            </button>
          )}
          <button type="button" onClick={toggleDictation} className={`p-2 rounded-xl hover:bg-stone-100 ${dictating ? "text-red-600 animate-pulse" : "text-stone-600"}`}><Mic size={17} /></button>
        </div>
        <button type="submit" disabled={!query.trim() || running} className="w-9 h-9 rounded-xl bg-stone-900 text-white flex items-center justify-center disabled:opacity-35">
          {running ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>
    </form>
  );
}
