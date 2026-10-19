import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import StructuredResponseRenderer from "../structured/StructuredResponseRenderer";
import { splitVisualBlocks, visualsToMarkdown } from "../../lib/structuredSegments";
import "./ComputerUI.css";
import { resolveApiBase } from "../../lib/apiBase";
import { resolveSiteImages } from "../../lib/siteImages";
import { partialHtml, buildStage, buildSteps, analyzeSite } from "../../lib/siteBuild";
import {
  AI_PLAN_INSTRUCTIONS, SUMMARY_COLUMNS, SUMMARY_INSTRUCTIONS, applyPlan, exifDate, formatStamp, groupDuplicates, hashFile, isImage,
  manifest, parseAiPlan, parseSummaryRows, planDuplicates, planOrganizeByType, planRenameByDate, scanFolder, undoPlan, validatePlan, writeFile,
} from "../../lib/folderOps";
import { READABLE_DOC, extractFileText } from "../../lib/fileText";
import { askModel } from "../../lib/computerChat";
import { xlsxBlob } from "../../lib/documentExport";
import { FolderActions, FolderPlanCard, FolderReportCard } from "./FolderTools";
import ResearchRun from "./ResearchRun";
import LiveBrowser from "./LiveBrowser";
import ModeSwitch from "../ModeSwitch";
import { settleInterruptedTasks } from "../../lib/computerTasks";
import { publishSite } from "../../lib/sitePublish";
import ScheduledPanel from "./ScheduledPanel";
import DispatchPanel from "./DispatchPanel";
import { claimDispatch, dispatchReady, getDeviceId, heartbeat, updateDispatch, watchDispatches } from "../../lib/dispatch";
import { FINISHED, HEARTBEAT_MS, deviceLabel, nextQueued, orphanedRuns, toDispatchUpdate } from "../../lib/dispatchCore";
import { watchAuthState } from "../../lib/firebaseAuth";
import { SCHEDULE_REQUEST, schedulesApi } from "../../lib/schedules";
import { authHeaders, startComputerRun } from "../../lib/usageClient";
import { SHEET_INSTRUCTIONS, deckInput, isResearchFileRequest, sheetInput, sheetMarkdown, slidesCode, topicTitle, wantedFiles } from "../../lib/researchDeliverables";
import { settleResearch } from "../../lib/research";
import { FOLDER_ACTIONS } from "../../lib/folderActions";
import {
  ArrowLeft, Bot, CalendarClock, History, SquarePen, Check, CheckCircle2, ChevronDown, Circle, Clock3, Copy as CopyIcon, ExternalLink, MousePointerClick, Share2,
  Download, File, FolderOpen, Globe2, HardDrive, Image as ImageIcon, LayoutTemplate, Loader2, LockKeyhole, MapPin,
  Maximize2, Mic, Minimize2, Monitor, MoreHorizontal, Paperclip, Pause, Play, Plus, RotateCcw, Search, Send, ShieldCheck,
  Smartphone, Sparkles, Square, Trash2, X, Zap
} from "lucide-react";

const PROD_API = "https://ai-chatbot-backend-gvvz.onrender.com/api";
// Replies can mix prose with visual JSON blocks (timeline, chart, metrics…).
// Draw each block with the chat's visual renderer, in place, instead of
// showing the raw JSON.
function TaskReply({ content }) {
  const segments = useMemo(() => splitVisualBlocks(content), [content]);
  return segments.map((segment, i) => segment.kind === "visual"
    ? <div key={i} className="cowork-visual not-prose"><StructuredResponseRenderer response={segment.raw} /></div>
    : <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} components={{ pre: CodeBlock }}>{segment.text}</ReactMarkdown>);
}

const textOf = (node) => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf(node.props?.children);
};

// Code in a task reply. A generated website is hundreds of lines of HTML/CSS
// that used to be dumped into the thread as plain text; long blocks now start
// collapsed behind a compact card (language, line count, copy), since the
// live preview and the download button are what the reader actually wants.
function CodeBlock({ children }) {
  const code = textOf(children).replace(/\n+$/, "");
  const langClass = Array.isArray(children) ? children[0]?.props?.className : children?.props?.className;
  const lang = /language-([\w+-]+)/.exec(langClass || "")?.[1] || "code";
  const lines = code ? code.split("\n").length : 0;
  // Decided from the current length until the reader toggles it: a block
  // that is still streaming starts short, and fixing the choice then left
  // every long website expanded.
  const [choice, setChoice] = useState(null);
  const open = choice ?? lines <= 24;
  const setOpen = (fn) => setChoice(fn(open));
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  };
  return (
    <div className="cowork-code not-prose">
      <div className="cowork-code-head">
        <span className="cowork-code-lang">{lang.toUpperCase()}</span>
        <span className="cowork-code-lines">{lines} line{lines === 1 ? "" : "s"}</span>
        <button type="button" onClick={copy}>{copied ? <><Check size={13} /> Copied</> : "Copy"}</button>
        <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}>
          {open ? "Hide code" : "Show code"} <ChevronDown size={13} style={{ transform: open ? "rotate(180deg)" : "none" }} />
        </button>
      </div>
      {open && <pre className="cowork-code-body"><code>{code}</code></pre>}
    </div>
  );
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
const WEBSITE_REQUEST = /\b(?:build|make|create|design|generate|code)\b[\s\S]{0,40}\b(?:website|web ?site|site|landing page|web ?page|home ?page|web ?app|online (?:store|shop)|e-?commerce|storefront)\b/i;
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
// With a folder open: requests to reorganise its files, or to summarise its documents.
const FOLDER_REORGANIZE_REQUEST = /\b(rename|organi[sz]e|sort|tidy|clean ?up|arrange|group|categori[sz]e|move|put)\b[\s\S]{0,80}\b(files?|folders?|photos?|pictures?|images?|documents?|pdfs?|downloads?|videos?|songs?|music|invoices?|receipts?|everything|them|it)\b|\bduplicates?\b/i;
const FOLDER_SUMMARY_REQUEST = /\b(summari[sz]e|summary|summaries|spreadsheet|table|extract|list)\b[\s\S]{0,60}\b(documents?|docs|pdfs?|files?|invoices?|receipts?|bills?|letters?|statements?|resumes?|cvs?)\b/i;
const SUMMARY_MAX_DOCS = 25;
const SUMMARY_DOC_CHARS = 2500;
// A long reply the model stopped mid-code is continued at most this often.
const MAX_CONTINUATIONS = 2;
const CONTINUE_PROMPT = "Your previous message was cut off in the middle of the code. Continue EXACTLY from the last character you wrote — no greeting, no explanation, do not repeat anything already written, and do not open a new code block; just write the rest, then close the code block with ``` and finish.";
const isCutOffInCode = (text) => ((String(text || "").match(/```/g) || []).length % 2) === 1;
// Some models restart their continuation with a fresh ```html fence even
// when told not to; inside an open block that would split the document.
const stripRepeatedFence = (text) => String(text || "").replace(/^\s*```[\w-]*\s*\n/, "");
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

// The site as it should be shown and downloaded: photos asked for by subject
// point at real, matching pictures (lib/siteImages.js).
function siteHtml(markdown) {
  const html = extractHtmlDocument(markdown);
  return html ? resolveSiteImages(html, API) : null;
}

const formatElapsed = (ms) => {
  const total = Math.max(0, Math.round(ms / 1000));
  return total < 60 ? `${total}s` : `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
};

// A ticking "0m 42s" while a task runs; frozen at the final time once `until` is set.
function Elapsed({ since, until }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);
  return <>{formatElapsed((until || now) - since)}</>;
}

// Preview-only instrumentation so the agent can actually "see" what it just
// built: without this, computer mode hands back an HTML string and never
// knows whether the page even renders — any script error, missing element,
// or broken layout is invisible to it. This script forwards runtime errors
// out of the sandboxed iframe via postMessage so the UI can show them and
// feed them back to the model for a fix pass.
const PREVIEW_ERROR_CAPTURE = `<script>(function(){
  // The preview frame is sandboxed without same-origin access, where merely
  // reading localStorage/sessionStorage throws — so a shop's cart or a saved
  // theme crashed the page. Give it working in-memory storage instead.
  function memoryStorage(){ var d = {}; return {
    getItem: function(k){ k = String(k); return Object.prototype.hasOwnProperty.call(d, k) ? d[k] : null; },
    setItem: function(k, v){ d[String(k)] = String(v); },
    removeItem: function(k){ delete d[String(k)]; },
    clear: function(){ d = {}; },
    key: function(i){ return Object.keys(d)[i] || null; },
    get length(){ return Object.keys(d).length; }
  }; }
  ["localStorage", "sessionStorage"].forEach(function(name){
    try { window[name].getItem("x"); } catch (e) {
      try { Object.defineProperty(window, name, { value: memoryStorage(), configurable: true }); } catch (e2) {}
    }
  });
  function report(message){ try { window.parent.postMessage({ source: "vetroai-preview", type: "error", message: String(message) }, "*"); } catch (e) {} }
  window.addEventListener("error", function(e){ report((e.message || "Script error") + (e.filename ? " (" + e.filename.split("/").pop() + ":" + e.lineno + ")" : "")); });
  window.addEventListener("unhandledrejection", function(e){ report("Unhandled promise rejection: " + (e.reason && e.reason.message ? e.reason.message : e.reason)); });
  var origError = console.error;
  console.error = function(){ report(Array.prototype.slice.call(arguments).map(String).join(" ")); origError.apply(console, arguments); };
  // "Click to edit": while the parent turns it on, hovering outlines an
  // element and a click picks it (instead of following links or buttons).
  var editing = false, hovered = null;
  var style = document.createElement("style");
  style.textContent = ".__vetro-hover{outline:2px solid #D97757 !important;outline-offset:2px !important;cursor:crosshair !important;}";
  function setHover(el){ if (hovered) hovered.classList.remove("__vetro-hover"); hovered = el; if (el) el.classList.add("__vetro-hover"); }
  window.addEventListener("message", function(e){
    if (!e.data || e.data.source !== "vetroai-parent" || e.data.type !== "edit-mode") return;
    editing = !!e.data.on;
    if (editing && !style.parentNode) (document.head || document.documentElement).appendChild(style);
    if (!editing) setHover(null);
  });
  document.addEventListener("mouseover", function(e){ if (editing && e.target !== document.body && e.target !== document.documentElement) setHover(e.target); }, true);
  document.addEventListener("click", function(e){
    if (!editing) return;
    e.preventDefault(); e.stopPropagation();
    var el = e.target;
    setHover(null);
    var clone = el.cloneNode(true);
    try { window.parent.postMessage({ source: "vetroai-preview", type: "pick", tag: el.tagName.toLowerCase(), text: (el.innerText || el.getAttribute("alt") || "").trim().slice(0, 160), html: clone.outerHTML.slice(0, 1800) }, "*"); } catch (err) {}
  }, true);
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

const DISPATCH_ACCEPT_KEY = "vetroai_dispatch_accept";

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
  { icon: Search, title: "Research → slide deck + spreadsheet", prompt: "Research the best electric scooters in India under ₹1.5 lakh and make a slide deck and a comparison spreadsheet." },
  { icon: FolderOpen, title: "Work with files", prompt: "Review the files I attach, summarize the important information, and produce a clear action plan." },
  { icon: CalendarClock, title: "Runs while you're away", prompt: "Every morning at 8, send me today's top news in India and the cricket scores" },
  { icon: LayoutTemplate, title: "Build a website", prompt: "Build a modern online store for a sneaker brand: product grid with prices and ratings, a working cart, customer reviews, and a newsletter signup. It must look great on phones." }
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
    steps[steps.length - 2] = { id: "work", label: "Build, inspect, and validate the solution", status: "pending" };
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
    return Array.isArray(parsed) ? settleInterruptedTasks(parsed) : [];
  } catch {
    return [];
  }
}

export default function ComputerUI({ onClose, onUpgrade }) {
  const [tasks, setTasks] = useState(safeLoadTasks);
  const [activeId, setActiveId] = useState(() => safeLoadTasks()[0]?.id || null);
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState([]);
  const [permission, setPermission] = useState("ask");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Phones: the task list opens as a drawer over the page.
  const [drawer, setDrawer] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [dictating, setDictating] = useState(false);
  const [locationNotice, setLocationNotice] = useState("");
  const [workspace, setWorkspace] = useState(null);
  const [workspaceFiles, setWorkspaceFiles] = useState([]);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [showCapabilities, setShowCapabilities] = useState(false);
  // "tasks" (the thread) or "scheduled" (Computer → Scheduled).
  const [view, setView] = useState("tasks");
  const [scheduleDraft, setScheduleDraft] = useState("");
  const [scheduledUnread, setScheduledUnread] = useState(0);
  // This week's Computer runs ({ used, limit, plan }) and the Pro offer when they run out.
  const [allowance, setAllowance] = useState(null);
  const [proGate, setProGate] = useState(null);
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
  const [starting, setStarting] = useState(false);
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

  useEffect(() => {
    if (view === "scheduled") return undefined;
    const api = schedulesApi(API);
    const check = () => api.list().then(d => setScheduledUnread(d.unread || 0)).catch(() => {});
    check();
    const id = setInterval(check, 120000);
    return () => clearInterval(id);
  }, [view]);

  useEffect(() => {
    fetch(`${API}/usage`, { headers: authHeaders() })
      .then(r => r.json())
      .then(b => { if (b?.data?.computer) setAllowance({ ...b.data.computer, plan: b.data.plan }); })
      .catch(() => {});
  }, []);

  /** Takes one run from this week's allowance, or offers Pro and says no. */
  const allowRun = async () => {
    // Shown on the send button straight away, while the free-task count is checked.
    setStarting(true);
    const result = await startComputerRun(API).finally(() => setStarting(false));
    if (result.computer) setAllowance({ ...result.computer, plan: result.plan });
    if (!result.allowed) {
      setProGate({ message: result.message, plan: result.plan, resetsAt: result.resetsAt });
      return false;
    }
    return true;
  };

  const patchTask = (id, updater) => {
    setTasks(prev => prev.map(t => t.id === id
      ? { ...(typeof updater === "function" ? updater(t) : { ...t, ...updater }), updatedAt: Date.now() }
      : t));
  };

  const newTask = () => {
    setView("tasks");
    setDrawer(false);
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

  // `prefix` is the text already shown for this reply: a continuation of a
  // cut-off answer streams onto the end of it. `stepsFor`, when given, works
  // out the task's progress steps from the text so far.
  const readStream = async (response, taskId, assistantId, prefix = "", stepsFor = null) => {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("The server did not return a stream.");
    const decoder = new TextDecoder();
    let buffer = "";
    let content = prefix;
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
              ...(stepsFor ? { steps: stepsFor(content, t.steps) } : {}),
              messages: t.messages.map(m => m.id === assistantId ? { ...m, content } : m)
            }));
          } else if (type === "clear") {
            // Backend is retrying with a fallback provider after the previous
            // one failed or stalled — drop whatever partial text it streamed.
            content = prefix;
            patchTask(taskId, t => ({
              ...t,
              messages: t.messages.map(m => m.id === assistantId ? { ...m, content: prefix } : m)
            }));
          } else if (type === "sources" && Array.isArray(data)) {
            patchTask(taskId, t => ({
              ...t,
              messages: t.messages.map(m => m.id === assistantId ? { ...m, sources: data } : m)
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

  // `opts.task` / `opts.files` let a Dispatch request run in a task of its own,
  // without the composer's attachments; `opts.preApproved` means its run was
  // already taken from the allowance.
  const execute = async (prompt, display = "", opts = {}) => {
    // A fix or an edit of something already built continues that run.
    if (!display && !opts.preApproved && !(await allowRun())) return;
    const runFiles = opts.files ?? files;
    let task = opts.task || activeTask;
    if (!task) {
      task = makeTask(prompt.slice(0, 54));
      setTasks(prev => [task, ...prev]);
      setActiveId(task.id);
    }
    const taskId = task.id;
    const assistantId = `a-${Date.now()}`;
    const userMessage = { id: `u-${Date.now()}`, role: "user", content: prompt, ...(display ? { display } : {}) };
    const contextMessages = [...task.messages, userMessage].map(({ role, content }) => ({ role, content }));
    // Once a task has produced a website, keep routing follow-ups (e.g. "fix
    // these errors") through Design mode even if the fix prompt itself
    // doesn't say "build a website" — otherwise a fix request silently
    // drops back to a plain code-chat reply instead of a full HTML redo.
    const hasWebsiteContext = task.messages.some(m => m.exports?.includes("website"));
    const isWebsiteRequest = WEBSITE_REQUEST.test(prompt) || hasWebsiteContext;
    // A website build reports what is really being written (styling, each
    // section, scripts); other tasks move to "working" once the answer starts.
    const plan = isWebsiteRequest
      ? buildSteps("")
      : buildPlan(prompt, runFiles).map((s, i) => ({ ...s, status: i === 0 ? "active" : "pending" }));
    const workIndex = plan.findIndex(s => s.id === "work");
    const stepsFor = isWebsiteRequest
      ? (content) => buildSteps(content)
      : (_content, steps) => steps.map((s, i) => ({ ...s, status: i < workIndex ? "done" : i === workIndex ? "active" : s.status === "done" ? "done" : "pending", detail: i === workIndex ? s.detail : undefined }));
    const startedAt = Date.now();

    patchTask(taskId, t => ({
      ...t,
      title: t.messages.length ? t.title : (display || prompt).slice(0, 54),
      status: "running",
      files: runFiles.map(f => ({ name: f.name, size: f.size, type: f.type })),
      steps: plan,
      messages: [...t.messages, userMessage, { id: assistantId, role: "assistant", content: "", startedAt, website: isWebsiteRequest }]
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
      // A whole single-file website runs well past the backend's default
      // 2,048-token reply, which cut it off mid-code (no closing fence, so no
      // preview). Ask for room up front.
      const maxTokens = isWebsiteRequest ? "16384" : "8192";
      const sendChat = async (input, messages, first) => {
        const body = new FormData();
        body.append("provider", "gemini");
        // A full-site build gets routed through Design mode's battle-tested
        // single-file HTML system prompt instead of the generic task prompt below.
        body.append("mode", isWebsiteRequest ? "design" : "code_exec");
        body.append("input", input);
        body.append("messages", JSON.stringify(messages));
        body.append("maxTokens", maxTokens);
        body.append("webSearch", first ? "true" : "false");
        // Continuations go to the backend like the first half did, not to
        // the in-browser Gemini bridge (public/gemini-puter-bridge.js).
        if (!first) body.append("route", "backend");
        body.append("safeMode", "true");
        body.append("systemPrompt", [
          "You are VetroAI Computer, a careful Cowork-style task agent.",
          "Work through the user's multi-step task and produce finished, useful deliverables.",
          "State what you actually did; never pretend to click, send, purchase, log in, edit local files, or access connected apps unless a real tool result proves it.",
          "For actions unavailable in this browser workspace, provide the exact next action for the user.",
          "Prefer concise progress, source-aware research, and a final review checklist."
        ].join(" "));
        if (first) runFiles.forEach(file => body.append("files", file));
        const response = await fetch(`${API}/chat`, { method: "POST", body, signal: controller.signal });
        if (!response.ok) {
          let message = `Server error: ${response.status}`;
          try {
            const data = await response.json();
            message = data.message || data.error || message;
          } catch {}
          throw new Error(message);
        }
        return response;
      };

      patchTask(taskId, t => ({ ...t, steps: t.steps.map((s, i) => i === 0 ? { ...s, status: "done" } : i === 1 ? { ...s, status: "active" } : s) }));
      let reply = await readStream(await sendChat(taskPrompt, contextMessages, true), taskId, assistantId, "", stepsFor);

      // Still cut off inside a code block (odd number of fences): ask the
      // model to carry on from the exact point it stopped, and append that
      // to the same reply, so the website comes out whole.
      for (let pass = 0; pass < MAX_CONTINUATIONS && isCutOffInCode(reply); pass++) {
        patchTask(taskId, t => ({ ...t, steps: t.steps.map(s => s.status === "active" ? { ...s, detail: "Continuing the long response…" } : s) }));
        let more;
        try {
          more = await readStream(
            await sendChat(CONTINUE_PROMPT, [...contextMessages, { role: "assistant", content: reply }, { role: "user", content: CONTINUE_PROMPT }], false),
            taskId, assistantId, reply, stepsFor
          );
        } catch (error) {
          if (error.name === "AbortError") throw error;
          // Keep what was already written rather than failing the task.
          patchTask(taskId, t => ({ ...t, messages: t.messages.map(m => m.id === assistantId ? { ...m, content: reply } : m) }));
          break;
        }
        const added = stripRepeatedFence(more.slice(reply.length));
        if (!added.trim()) break;
        reply = reply + added;
        patchTask(taskId, t => ({ ...t, messages: t.messages.map(m => m.id === assistantId ? { ...m, content: reply } : m) }));
      }
      patchTask(taskId, t => ({
        ...t,
        status: "completed",
        steps: t.steps.map(s => ({ ...s, status: "done" })),
        messages: t.messages.map(message => message.id === assistantId ? {
          ...message,
          finishedAt: Date.now(),
          exports: [
            ...(WORD_REQUEST.test(prompt) ? ["word"] : []),
            ...(SHEET_REQUEST.test(prompt) ? ["spreadsheet"] : []),
            ...(isWebsiteRequest ? ["website"] : [])
          ]
        } : message)
      }));
      if (!opts.files) setFiles([]);
    } catch (error) {
      const stopped = error.name === "AbortError";
      patchTask(taskId, t => ({
        ...t,
        status: stopped ? "stopped" : "failed",
        steps: t.steps.map(s => s.status === "active" ? { ...s, status: stopped ? "pending" : "failed" } : s),
        messages: t.messages.map(m => m.id !== assistantId ? m
          : !m.content
            ? { ...m, finishedAt: Date.now(), content: stopped ? "Task stopped. You can edit the instruction and run it again." : `I couldn't complete this task: ${error.message}` }
            : { ...m, finishedAt: Date.now() })
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
    execute(prompt, `Fix the ${errors.length} error${errors.length === 1 ? "" : "s"} in the preview`);
  };

  // "Click to edit": the user clicked part of the preview and said what to change.
  const requestWebsiteEdit = (html, pick, instruction) => {
    if (running || !instruction.trim()) return;
    const prompt = [
      `Change this part of the website: ${instruction.trim()}`,
      "",
      `The part I clicked (a <${pick.tag}>${pick.text ? ` showing "${pick.text}"` : ""}), as it is now:`,
      "```html",
      pick.html,
      "```",
      "",
      "Make this change (and only what it needs to stay consistent), keep everything else exactly as it is, and output the full updated HTML document in a single ```html code block.",
      "",
      "Current HTML:",
      "```html",
      html,
      "```",
    ].join("\n");
    execute(prompt, `${instruction.trim()} — on the ${pick.text ? `“${pick.text.slice(0, 40)}${pick.text.length > 40 ? "…" : ""}”` : pick.tag} I clicked`);
  };

  // One live link per task: publishing a newer version updates the same site.
  const publishWebsite = async (taskId, messageId, html) => {
    const task = tasks.find(t => t.id === taskId);
    patchMessage(taskId, messageId, m => ({ ...m, published: { ...m.published, status: "publishing", error: "" } }));
    try {
      const { id, url } = await publishSite({ html, title: task?.title || "Website", id: task?.siteId });
      patchTask(taskId, t => ({
        ...t,
        siteId: id,
        messages: t.messages.map(m => m.id === messageId ? { ...m, published: { status: "done", id, url, at: Date.now() } } : m),
      }));
    } catch (error) {
      patchMessage(taskId, messageId, m => ({ ...m, published: { ...m.published, status: "failed", error: error.message } }));
    }
  };

  // Drives the real mouse/keyboard through the VetroAI desktop companion:
  // screenshot -> ask the model for exactly one next action -> perform it -> repeat.
  // The companion's own permission dialog (desktop/main.cjs) is the actual consent
  // gate — approving it there is what lets any of computer:* IPC calls succeed at
  // all, and Ctrl+Shift+X always stops it immediately regardless of this loop.
  const runComputerAgent = async (goal, opts = {}) => {
    if (!opts.preApproved && !(await allowRun())) return;
    const desktop = window.vetroDesktop;
    let task = opts.task || activeTask;
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
    if (!prompt || running || starting) return;
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
    if (workspace?.handle && !files.length) {
      if (FOLDER_SUMMARY_REQUEST.test(prompt)) { startFolderTask(prompt, "summarize"); return; }
      if (FOLDER_REORGANIZE_REQUEST.test(prompt)) { startFolderTask(prompt, "ai"); return; }
    }
    if (!files.length && SCHEDULE_REQUEST.test(prompt)) {
      setView("scheduled");
      setScheduleDraft(prompt);
      setQuery("");
      return;
    }
    if (!files.length && !WEBSITE_REQUEST.test(prompt) && isResearchFileRequest(prompt)) {
      startResearchTask(prompt);
      return;
    }
    if (permission === "ask" && RISKY_ACTION.test(prompt)) {
      setPendingAction(prompt);
      return;
    }
    execute(prompt);
  };

  const stopTask = () => abortRef.current?.abort();

  // --- Dispatch: tasks sent from your phone run here (Computer → Dispatch) ---
  // With "Accept tasks" on, this computer says it is online, takes queued
  // requests one at a time, runs each as an ordinary task in this list, and
  // writes its progress and result back for the phone to see.
  const [uid, setUid] = useState(null);
  useEffect(() => watchAuthState(user => setUid(user?.uid || null)), []);
  const deviceId = useMemo(getDeviceId, []);
  const isComputer = hasDesktop || !/Android|iPhone|iPad|Mobile/i.test(typeof navigator === "undefined" ? "" : navigator.userAgent);
  const [accepting, setAccepting] = useState(() => {
    try { return localStorage.getItem(DISPATCH_ACCEPT_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(DISPATCH_ACCEPT_KEY, accepting ? "1" : "0"); } catch { /* storage unavailable */ }
  }, [accepting]);
  const hosting = accepting && isComputer && Boolean(uid) && dispatchReady();
  const [remote, setRemote] = useState(null);
  const [dispatchPending, setDispatchPending] = useState(0);
  // { id, taskId } of the request running here. A ref, so a second snapshot
  // arriving mid-start can't start a second run.
  const hostRun = useRef(null);
  const mirrored = useRef("");
  const orphansSettled = useRef(false);
  const releaseHostRun = () => { hostRun.current = null; mirrored.current = ""; };
  const anyRunning = tasks.some(t => t.status === "running");

  useEffect(() => {
    if (!hosting) return undefined;
    const device = { id: deviceId, name: deviceLabel(window.vetroDesktop?.platform || navigator.platform, hasDesktop), desktopApp: hasDesktop, accepting: true };
    const beat = () => heartbeat(uid, { ...device, busy: Boolean(hostRun.current) }).catch(() => {});
    beat();
    const id = setInterval(beat, HEARTBEAT_MS);
    return () => { clearInterval(id); heartbeat(uid, { ...device, accepting: false, busy: false }).catch(() => {}); };
  }, [hosting, uid, deviceId, hasDesktop]);

  useEffect(() => {
    orphansSettled.current = false;
    if (!hosting) { setRemote(null); return undefined; }
    return watchDispatches(uid, setRemote, () => setRemote(null));
  }, [hosting, uid]);

  const startDispatch = async (d) => {
    const fail = (error) => { releaseHostRun(); return updateDispatch(uid, d.id, { status: "failed", error }).catch(() => {}); };
    const claimed = await claimDispatch(uid, d.id, deviceId).catch(() => null);
    if (!claimed) { releaseHostRun(); return; }
    const prompt = claimed.text;
    // The same "Ask before actions" gate as typing it here, except the person
    // who has to say yes is holding the phone, not sitting at this computer.
    if (permission === "ask" && RISKY_ACTION.test(prompt) && !claimed.approved) {
      releaseHostRun();
      await updateDispatch(uid, d.id, { status: "awaiting_approval", approvalReason: "This may open, send, post, buy, delete or change something for you." }).catch(() => {});
      return;
    }
    const wantsScreen = DESKTOP_CONTROL_REQUEST.test(prompt) || LIVE_BROWSE_REQUEST.test(prompt) || YOUTUBE_REQUEST.test(prompt);
    // Never pops the "allow control?" dialog: nobody may be here to answer it,
    // and the run would sit waiting on it. Control has to be on already.
    const control = hasDesktop && wantsScreen ? await window.vetroDesktop.getStatus().catch(() => null) : null;
    if (DESKTOP_CONTROL_REQUEST.test(prompt) || YOUTUBE_REQUEST.test(prompt)) {
      if (!hasDesktop) return fail("This needs mouse and keyboard control, which only the VetroAI desktop app can do — not a browser tab. Turn on Accept tasks in the desktop app, then send it again.");
      if (!control?.enabled) return fail("Screen control is off on your computer, so VetroAI didn't touch the mouse or keyboard. In the desktop app, allow screen control in Computer, then send this again.");
    }
    if (!(await allowRun())) return fail("This week's Computer tasks are used up, so your computer didn't run this. VetroAI Pro has many more.");
    const task = { ...makeTask(prompt.slice(0, 54)), dispatchId: d.id };
    setTasks(prev => [task, ...prev]);
    setActiveId(task.id);
    hostRun.current = { id: d.id, taskId: task.id };
    await updateDispatch(uid, d.id, { status: "running", taskId: task.id, progress: "Starting…" }).catch(() => {});
    if (control?.enabled && !YOUTUBE_REQUEST.test(prompt)) await runComputerAgent(prompt, { task, preApproved: true });
    else await execute(prompt, "", { task, files: [], preApproved: true });
  };

  useEffect(() => {
    if (!hosting || !remote) return;
    if (!orphansSettled.current) {
      orphansSettled.current = true;
      for (const d of orphanedRuns(remote, deviceId, hostRun.current?.id)) {
        updateDispatch(uid, d.id, { status: "failed", error: "Stopped — VetroAI was closed on your computer while this was running. Send it again to retry." }).catch(() => {});
      }
    }
    if (hostRun.current) {
      // Cancel pressed on the phone.
      const mine = remote.find(x => x.id === hostRun.current.id);
      if (mine?.cancelRequested && hostRun.current.taskId) abortRef.current?.abort();
      return;
    }
    if (anyRunning || starting) return;
    const next = nextQueued(remote, deviceId);
    if (!next) return;
    hostRun.current = { id: next.id, taskId: null };
    startDispatch(next).catch((err) => {
      releaseHostRun();
      updateDispatch(uid, next.id, { status: "failed", error: err.message }).catch(() => {});
    });
  }, [hosting, remote, anyRunning, starting]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mirrors the running request's task back to the phone as it changes.
  useEffect(() => {
    const run = hostRun.current;
    if (!run?.taskId || !uid) return;
    const task = tasks.find(t => t.id === run.taskId);
    if (!task) {
      updateDispatch(uid, run.id, { status: "cancelled", error: "Removed on your computer." }).catch(() => {});
      releaseHostRun();
      return;
    }
    const update = toDispatchUpdate(task);
    if (!update) return;
    const key = JSON.stringify(update);
    if (key === mirrored.current) return;
    mirrored.current = key;
    updateDispatch(uid, run.id, update).catch(() => {});
    if (FINISHED.has(update.status)) releaseHostRun();
  }, [tasks, uid]);

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

  // ── Folder tools ──────────────────────────────────────────────────────────
  // Plans are made from a fresh read of the folder, shown as a card of
  // changes with tick boxes, and applied only when the user says so.
  const patchMessage = (taskId, messageId, fn) => patchTask(taskId, t => ({
    ...t,
    messages: t.messages.map(m => m.id === messageId ? fn(m) : m),
  }));
  const patchFolder = (taskId, messageId, update) => patchMessage(taskId, messageId, m => ({ ...m, folder: { ...m.folder, ...(typeof update === "function" ? update(m.folder) : update) } }));

  const refreshWorkspace = async () => {
    if (!workspace?.handle) return;
    try { setWorkspaceFiles(await scanDirectory(workspace.handle)); } catch { /* keep the old list */ }
  };

  const startFolderTask = async (prompt, kind) => {
    if (!workspace?.handle || running) return;
    if (!(await allowRun())) return;
    let task = activeTask;
    if (!task) {
      task = makeTask(prompt.slice(0, 54));
      setTasks(prev => [task, ...prev]);
      setActiveId(task.id);
    }
    const taskId = task.id;
    const messageId = `a-${Date.now()}`;
    const root = workspace.handle;
    const folderName = workspace.name;
    const summarize = kind === "summarize";
    const steps = summarize
      ? [{ id: "read", label: "Read the documents", status: "active" }, { id: "work", label: "Summarise each one", status: "pending" }, { id: "save", label: "Save the spreadsheet in your folder", status: "pending" }]
      : [{ id: "read", label: "Read the folder", status: "active" }, { id: "work", label: "Plan the changes", status: "pending" }, { id: "review", label: "Wait for your approval", status: "pending" }];
    const setStep = (index) => patchTask(taskId, t => ({ ...t, steps: t.steps.map((s, i) => ({ ...s, status: i < index ? "done" : i === index ? "active" : "pending" })) }));
    patchTask(taskId, t => ({
      ...t,
      title: t.messages.length ? t.title : prompt.slice(0, 54),
      status: "running",
      steps,
      messages: [...t.messages, { id: `u-${Date.now()}`, role: "user", content: prompt },
        summarize
          ? { id: messageId, role: "assistant", content: "", startedAt: Date.now(), report: { status: "working", folderName, progress: { label: "Reading the folder…" } } }
          : { id: messageId, role: "assistant", content: "", startedAt: Date.now(), folder: { status: "planning", folderName, progress: { label: "Reading the folder…" } } }],
    }));
    setQuery("");
    const controller = new AbortController();
    abortRef.current = controller;
    const progress = (label, n = 0, total = 0) => summarize
      ? patchMessage(taskId, messageId, m => ({ ...m, report: { ...m.report, progress: { label, n, total } } }))
      : patchFolder(taskId, messageId, { progress: { label, n, total } });

    try {
      const entries = await scanFolder(root, { signal: controller.signal });
      if (!entries.length) throw new Error("This folder has no files to work on.");

      if (summarize) {
        const docs = entries.filter(e => READABLE_DOC.test(e.name) && e.size < 40 * 1024 * 1024).slice(0, SUMMARY_MAX_DOCS);
        if (!docs.length) throw new Error("There are no PDFs, Word, PowerPoint, Excel or text files in this folder to summarise.");
        const texts = [];
        for (let i = 0; i < docs.length; i++) {
          if (controller.signal.aborted) throw Object.assign(new Error("stopped"), { name: "AbortError" });
          progress(`Reading ${docs[i].name}`, i, docs.length);
          let text = "";
          try { text = await extractFileText(await docs[i].handle.getFile(), SUMMARY_DOC_CHARS); } catch { /* unreadable: summarised from its name */ }
          texts.push({ path: docs[i].path, text });
        }
        setStep(1);
        progress(`Summarising ${docs.length} document${docs.length === 1 ? "" : "s"}…`);
        const input = texts.map(({ path, text }, i) => `### Document ${i + 1}: ${path}\n${text.trim() || "(no readable text — a scan or an image; describe it from its file name only)"}`).join("\n\n");
        const reply = await askModel(API, { input, systemPrompt: SUMMARY_INSTRUCTIONS, maxTokens: 8192, signal: controller.signal });
        const rows = [SUMMARY_COLUMNS, ...parseSummaryRows(reply, texts.map(t => t.path))];
        setStep(2);
        const file = `VetroAI summary ${formatStamp(new Date()).slice(0, 10)}.xlsx`;
        let savedToFolder = false;
        try {
          await writeFile(root, file, await xlsxBlob(rows, "Documents"));
          savedToFolder = true;
          refreshWorkspace();
        } catch { /* offered as a download instead */ }
        patchTask(taskId, t => ({
          ...t,
          status: "completed",
          steps: t.steps.map(s => ({ ...s, status: "done" })),
          messages: t.messages.map(m => m.id === messageId ? { ...m, finishedAt: Date.now(), report: { status: "done", folderName, file, rows, savedToFolder } } : m),
        }));
        return;
      }

      let ops = [];
      let title = "";
      let summary = "";
      if (kind === "organize") {
        ops = planOrganizeByType(entries);
        title = "Sort files into folders by kind";
      } else if (kind === "photos") {
        const photos = entries.filter(e => isImage(e.name));
        if (!photos.length) throw new Error("There are no photos in this folder.");
        let exifCount = 0;
        for (let i = 0; i < photos.length; i++) {
          if (controller.signal.aborted) throw Object.assign(new Error("stopped"), { name: "AbortError" });
          if (i % 10 === 0) progress("Reading when each photo was taken", i, photos.length);
          const e = photos[i];
          let date = null;
          if (/\.jpe?g$/i.test(e.name)) {
            try { date = exifDate(await (await e.handle.getFile()).slice(0, 262144).arrayBuffer()); } catch { /* no EXIF */ }
          }
          if (date) exifCount++;
          e.date = date || new Date(e.lastModified);
          e.dateSource = date ? "exif" : "modified";
        }
        ops = planRenameByDate(photos);
        title = "Rename photos to the date they were taken";
        summary = exifCount === photos.length ? "" : `${photos.length - exifCount} photo${photos.length - exifCount === 1 ? " has" : "s have"} no camera date, so the date the file was last changed is used for ${photos.length - exifCount === 1 ? "it" : "them"}.`;
      } else if (kind === "duplicates") {
        const bySize = new Map();
        for (const e of entries) if (e.size > 0) bySize.set(e.size, [...(bySize.get(e.size) || []), e]);
        const candidates = [...bySize.values()].filter(g => g.length > 1).flat();
        for (let i = 0; i < candidates.length; i++) {
          if (controller.signal.aborted) throw Object.assign(new Error("stopped"), { name: "AbortError" });
          progress("Comparing file contents", i, candidates.length);
          try { candidates[i].hash = await hashFile(await candidates[i].handle.getFile()); } catch { /* unreadable */ }
        }
        const groups = groupDuplicates(candidates);
        ops = planDuplicates(groups);
        title = groups.length ? `${groups.length} set${groups.length === 1 ? "" : "s"} of identical files` : "No duplicates found";
        summary = groups.length ? "The first copy of each stays where it is; the extra copies move to a Duplicates folder so you can check them and delete them yourself." : "";
      } else {
        setStep(1);
        progress("Planning the changes…");
        const input = `Folder: ${folderName}\nFiles (path | size | modified):\n${manifest(entries)}\n\nWhat the user wants: ${prompt}`;
        const reply = await askModel(API, { input, systemPrompt: AI_PLAN_INSTRUCTIONS, maxTokens: 12000, signal: controller.signal });
        const parsed = parseAiPlan(reply);
        ops = parsed.ops;
        summary = parsed.summary;
        title = prompt.length > 70 ? `${prompt.slice(0, 67)}…` : prompt;
      }
      const checked = validatePlan(ops, entries);
      patchTask(taskId, t => ({
        ...t,
        status: "review",
        steps: t.steps.map((s, i) => ({ ...s, status: i < 2 ? "done" : "active" })),
        messages: t.messages.map(m => m.id === messageId ? {
          ...m,
          finishedAt: Date.now(),
          folder: { ...m.folder, status: "ready", title, summary, ops: checked.ops, selected: checked.ops.map(() => true), skipped: checked.skipped.length, progress: null },
        } : m),
      }));
    } catch (error) {
      const stopped = error.name === "AbortError";
      const text = stopped ? "Stopped." : error.message;
      patchTask(taskId, t => ({
        ...t,
        status: stopped ? "stopped" : "failed",
        steps: t.steps.map(s => s.status === "active" ? { ...s, status: stopped ? "pending" : "failed" } : s),
        messages: t.messages.map(m => m.id !== messageId ? m : summarize
          ? { ...m, finishedAt: Date.now(), report: { ...m.report, status: "failed", error: text } }
          : { ...m, finishedAt: Date.now(), folder: { ...m.folder, status: "failed", error: text } }),
      }));
    } finally {
      abortRef.current = null;
    }
  };

  // ── Research → finished files ─────────────────────────────────────────────
  // A full DeepSearch (its log streamed live), then the report turned into
  // the files that were asked for: a deck, a spreadsheet, Word and PDF.
  const startResearchTask = async (prompt) => {
    if (running) return;
    if (!(await allowRun())) return;
    let task = activeTask;
    if (!task) {
      task = makeTask(prompt.slice(0, 54));
      setTasks(prev => [task, ...prev]);
      setActiveId(task.id);
    }
    const taskId = task.id;
    const messageId = `a-${Date.now()}`;
    const want = wantedFiles(prompt);
    const title = topicTitle(prompt);
    const patchRun = (update) => patchMessage(taskId, messageId, m => ({ ...m, run: { ...m.run, ...(typeof update === "function" ? update(m.run) : update) } }));
    const steps = [
      { id: "research", label: "Research the web", status: "active" },
      { id: "write", label: "Write the report", status: "pending" },
      ...(want.slides ? [{ id: "slides", label: "Design the slide deck", status: "pending" }] : []),
      ...(want.sheet ? [{ id: "sheet", label: "Build the spreadsheet", status: "pending" }] : []),
      { id: "files", label: "Prepare Word and PDF", status: "pending" },
    ];
    const setStep = (id, status) => patchTask(taskId, t => ({ ...t, steps: t.steps.map(s => s.id === id ? { ...s, status } : s) }));
    patchTask(taskId, t => ({
      ...t,
      title: t.messages.length ? t.title : title,
      status: "running",
      steps,
      messages: [...t.messages, { id: `u-${Date.now()}`, role: "user", content: prompt },
        { id: messageId, role: "assistant", content: "", startedAt: Date.now(), run: { status: "researching", title, want } }],
    }));
    setQuery("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      let research = null;
      const report = await askModel(API, {
        input: prompt,
        mode: "deep_search",
        provider: "auto",
        webSearch: true,
        maxTokens: 12000,
        signal: controller.signal,
        onEvent: (type, data) => {
          if (type === "research" && data) {
            research = data;
            patchRun({ research: data });
            if (data.phase === "writing") { setStep("research", "done"); setStep("write", "active"); }
          } else if (type === "sources" && Array.isArray(data)) {
            patchRun({ sources: data });
          }
        },
      });
      if (!report.trim()) throw new Error("The research didn't produce a report. Try again in a moment.");
      setStep("research", "done");
      setStep("write", "done");
      patchRun({ report, research: settleResearch(research, "done"), status: "making" });

      // The files, side by side.
      const jobs = [];
      if (want.slides) {
        setStep("slides", "active");
        patchRun({ slides: { status: "working" } });
        jobs.push(askModel(API, { input: deckInput(prompt, report), mode: "normal", provider: "auto", maxTokens: 12000, signal: controller.signal })
          .then(text => {
            const code = slidesCode(text);
            if (!code) throw new Error("No slides came back.");
            patchRun({ slides: { status: "done", code } });
            setStep("slides", "done");
          })
          .catch(err => {
            if (err.name === "AbortError") throw err;
            patchRun({ slides: { status: "failed", error: err.message } });
            setStep("slides", "failed");
          }));
      }
      if (want.sheet) {
        setStep("sheet", "active");
        patchRun({ sheet: { status: "working" } });
        jobs.push(askModel(API, { input: sheetInput(prompt, report), systemPrompt: SHEET_INSTRUCTIONS, maxTokens: 8192, signal: controller.signal })
          .then(text => {
            const markdown = sheetMarkdown(text);
            if (!markdown) throw new Error("No table came back.");
            patchRun({ sheet: { status: "done", markdown } });
            setStep("sheet", "done");
          })
          .catch(err => {
            if (err.name === "AbortError") throw err;
            patchRun({ sheet: { status: "failed", error: err.message } });
            setStep("sheet", "failed");
          }));
      }
      await Promise.all(jobs);
      setStep("files", "done");
      patchRun({ status: "done" });
      patchTask(taskId, t => ({ ...t, status: "completed", messages: t.messages.map(m => m.id === messageId ? { ...m, finishedAt: Date.now() } : m) }));
    } catch (error) {
      const stopped = error.name === "AbortError";
      patchMessage(taskId, messageId, m => ({ ...m, finishedAt: Date.now(), run: { ...m.run, status: m.run?.report ? "done" : "failed", research: settleResearch(m.run?.research, "failed"), error: stopped ? "Stopped." : error.message } }));
      patchTask(taskId, t => ({ ...t, status: stopped ? "stopped" : "failed", steps: t.steps.map(s => s.status === "active" ? { ...s, status: stopped ? "pending" : "failed" } : s) }));
    } finally {
      abortRef.current = null;
    }
  };

  const runFolderAction = (id) => {
    const action = FOLDER_ACTIONS.find(a => a.id === id);
    if (action) startFolderTask(action.prompt, id);
  };

  const findFolderMessage = (taskId, messageId) => tasks.find(t => t.id === taskId)?.messages.find(m => m.id === messageId);

  const applyFolderPlan = async (taskId, messageId) => {
    const message = findFolderMessage(taskId, messageId);
    const f = message?.folder;
    if (!f || !workspace?.handle || workspace.name !== f.folderName) return;
    const ops = f.ops.filter((_, i) => f.selected[i]);
    patchTask(taskId, { status: "running" });
    patchFolder(taskId, messageId, { status: "applying", progress: { n: 0, total: ops.length } });
    const result = await applyPlan(workspace.handle, ops, { onProgress: (n, total) => patchFolder(taskId, messageId, { progress: { n, total } }) });
    patchFolder(taskId, messageId, { status: "applied", result, progress: null });
    patchTask(taskId, t => ({ ...t, status: "completed", steps: t.steps.map(s => ({ ...s, status: "done" })) }));
    refreshWorkspace();
  };

  const undoFolderPlan = async (taskId, messageId) => {
    const f = findFolderMessage(taskId, messageId)?.folder;
    if (!f?.result || !workspace?.handle || workspace.name !== f.folderName) return;
    patchFolder(taskId, messageId, { status: "undoing", progress: { n: 0, total: f.result.done.length } });
    await undoPlan(workspace.handle, f.result.done, f.result.createdDirs, { onProgress: (n, total) => patchFolder(taskId, messageId, { progress: { n, total } }) });
    patchFolder(taskId, messageId, { status: "undone", progress: null });
    refreshWorkspace();
  };

  const downloadReport = async (message) => {
    const r = message.report;
    if (!r?.rows) return;
    const url = URL.createObjectURL(await xlsxBlob(r.rows, "Documents"));
    const a = document.createElement("a");
    a.href = url;
    a.download = r.file;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
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
      {drawer && <div className="cw-drawer-scrim" onClick={() => setDrawer(false)} aria-hidden="true" />}
      <aside className={`cowork-tasks-sidebar ${sidebarOpen ? "is-open" : "is-closed"}${drawer ? " is-drawer" : ""}`}>
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
        <div className="px-3 pb-1">
          <button onClick={() => { setView("scheduled"); setDrawer(false); }} className={`cw-sched-nav${view === "scheduled" ? " is-on" : ""}`}>
            <CalendarClock size={16} /> <span>Scheduled</span>
            {scheduledUnread > 0 && <em>{scheduledUnread}</em>}
          </button>
          <button onClick={() => { setView("dispatch"); setDrawer(false); }} className={`cw-sched-nav${view === "dispatch" ? " is-on" : ""}`}>
            <Smartphone size={16} /> <span>Dispatch</span>
            {hosting ? <i className="cw-dsp-live" title="Accepting tasks on this computer" /> : dispatchPending > 0 && <em>{dispatchPending}</em>}
          </button>
        </div>
        <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-stone-500 font-semibold">Your tasks</div>
        <div className="flex-1 overflow-y-auto px-2 space-y-1">
          {tasks.map(task => (
            <div key={task.id} className={`group flex items-center rounded-xl ${task.id === activeId ? "bg-white shadow-sm" : "hover:bg-stone-200/70"}`}>
              <button onClick={() => { setActiveId(task.id); setView("tasks"); setDrawer(false); }} className="flex-1 min-w-0 text-left px-3 py-2.5">
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

          <button onClick={() => setDrawer(true)} className="cw-mobile-only p-2 rounded-lg hover:bg-stone-100" aria-label="Your tasks" title="Your tasks">
            <History size={18} />{scheduledUnread > 0 && <span className="cw-dot-badge" />}
          </button>
          <ModeSwitch mode="computer" onChat={onClose} className="cw-mode-switch" />
          <div className="flex-1 min-w-0 cw-header-title">
            <div className="font-semibold text-sm truncate">{view === "scheduled" ? "Scheduled tasks" : view === "dispatch" ? "Dispatch" : activeTask?.title || "VetroAI Computer"}</div>
            <div className="cw-header-status">
              {view === "scheduled" ? "Runs on its own, even when the app is closed"
                : view === "dispatch" ? (hosting ? <><span className="cw-pulse-dot" /> This computer is accepting tasks</> : "Send tasks from your phone to your computer")
                : running
                ? <><span className="cw-pulse-dot" /> Working{activeTask.messages[activeTask.messages.length - 1]?.startedAt ? <> · <Elapsed since={activeTask.messages[activeTask.messages.length - 1].startedAt} /></> : null}</>
                : activeTask?.status === "completed" ? <><CheckCircle2 size={12} /> Done — ready for your review</>
                : activeTask?.status === "failed" ? "Needs attention"
                : "Plans, builds and checks the work for you"}
            </div>
          </div>
          {(activeTask?.messages.length > 0 || view !== "tasks") && (
            <button onClick={newTask} className="cw-new-chat" aria-label="New chat" title="New chat">
              <SquarePen size={17} /><span>New chat</span>
            </button>
          )}
          {activeTask && (running || paused) && (
            <div className="flex items-center gap-1">
              <button onClick={togglePause} className="p-2 rounded-lg hover:bg-stone-100" title={running ? "Pause" : "Resume"}>{running ? <Pause size={17} /> : <Play size={17} />}</button>
              <button onClick={stopTask} disabled={!running} className="p-2 rounded-lg hover:bg-red-50 text-red-600 disabled:opacity-30" title="Stop"><Square size={16} /></button>
            </div>
          )}
          {allowance?.plan === "free" && allowance.limit > 0 && (
            <button type="button" className={`cw-allowance${allowance.used >= allowance.limit ? " is-out" : ""}`} onClick={() => onUpgrade?.()} title="Free accounts get a few Computer tasks a week. Pro has many more.">
              <Zap size={13} /><span className="cw-allowance-long">{Math.max(0, allowance.limit - allowance.used)} of {allowance.limit} free tasks left</span><span className="cw-allowance-short">{Math.max(0, allowance.limit - allowance.used)}/{allowance.limit}</span>
            </button>
          )}
          <div className="relative cw-permission">
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

        {view === "scheduled" ? (
          <ScheduledPanel api={API} draft={scheduleDraft} onDraftUsed={() => setScheduleDraft("")} onUnread={setScheduledUnread} />
        ) : view === "dispatch" ? (
          <DispatchPanel uid={uid} deviceId={deviceId} accepting={accepting} onAcceptingChange={setAccepting} isComputer={isComputer} onBusy={setDispatchPending} />
        ) : !activeTask || activeTask.messages.length === 0 ? (
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
              {workspace && <FolderActions folderName={workspace.name} onAction={runFolderAction} disabled={running} />}
              <div className="cowork-starter-grid">
                {starterTasks.map(({ icon: Icon, title, prompt }) => (
                  <button key={title} onClick={e => submit(e, prompt)} className="cowork-starter-card">
                    <Icon size={18} className="text-amber-700 mb-3" />
                    <div className="font-semibold text-sm mb-1">{title}</div>
                    <div className="text-xs leading-relaxed text-stone-500">{prompt}</div>
                  </button>
                ))}
              </div>
              <Composer query={query} setQuery={setQuery} files={files} setFiles={setFiles} submit={submit} running={running || starting} textareaRef={textareaRef} fileRef={fileRef} onFiles={onFiles} dictating={dictating} toggleDictation={toggleDictation} hasDesktop={hasDesktop} screenControl={screenControl} setScreenControl={setScreenControl} narrate={narrate} setNarrate={setNarrate} />
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
                      {message.role === "assistant" && <div className="cw-avatar"><Sparkles size={15} /></div>}
                      <div className={message.role === "user"
                        ? "max-w-[85%] rounded-2xl rounded-br-md bg-stone-900 text-white px-4 py-3 text-sm"
                        : "min-w-0 flex-1 prose prose-sm max-w-none text-stone-800 leading-7"}>
                        {message.role === "assistant" && message.folder
                          ? <FolderPlanCard
                              message={message}
                              workspaceName={workspace?.name}
                              onToggle={(i) => patchFolder(activeTask.id, message.id, f => ({ selected: f.selected.map((v, j) => j === i ? !v : v) }))}
                              onToggleAll={(on) => patchFolder(activeTask.id, message.id, f => ({ selected: f.selected.map(() => on) }))}
                              onApply={() => applyFolderPlan(activeTask.id, message.id)}
                              onUndo={() => undoFolderPlan(activeTask.id, message.id)}
                              onReconnect={openWorkspace}
                            />
                          : message.role === "assistant" && message.report
                          ? <FolderReportCard message={message} onDownload={() => downloadReport(message)} />
                          : message.role === "assistant" && message.run
                          ? <ResearchRun message={message} live={running && message.id === activeTask.messages[activeTask.messages.length - 1]?.id} renderReport={(md) => <TaskReply content={md} />} />
                          : message.role === "assistant"
                          ? <AssistantTurn
                              message={message}
                              task={activeTask}
                              live={running && message.id === activeTask.messages[activeTask.messages.length - 1]?.id}
                              latest={message.id === activeTask.messages[activeTask.messages.length - 1]?.id}
                              disabled={running}
                              onFix={requestWebsiteFix}
                              onEdit={requestWebsiteEdit}
                              onPublish={(html) => publishWebsite(activeTask.id, message.id, html)}
                            />
                          : message.display || message.content}
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
                  {workspace && <FolderActions folderName={workspace.name} onAction={runFolderAction} disabled={running} compact />}
                </aside>
              </div>
            </section>
            <div className="cowork-bottom-composer">
              <div className="max-w-4xl mx-auto">
                <Composer query={query} setQuery={setQuery} files={files} setFiles={setFiles} submit={submit} running={running || starting} textareaRef={textareaRef} fileRef={fileRef} onFiles={onFiles} dictating={dictating} toggleDictation={toggleDictation} hasDesktop={hasDesktop} screenControl={screenControl} setScreenControl={setScreenControl} narrate={narrate} setNarrate={setNarrate} />
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

      {proGate && (
        <div className="fixed inset-0 z-[210] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && setProGate(null)}>
          <div className="cw-pro-modal" role="dialog" aria-label="VetroAI Pro">
            <div className="cw-pro-badge"><Sparkles size={18} /></div>
            <h2>{proGate.plan === "free" ? "You've used this week's free Computer tasks" : "This week's Computer tasks are used up"}</h2>
            <p>{proGate.message}</p>
            {proGate.plan === "free" && (
              <ul className="cw-pro-list">
                <li><Check size={15} /> 100 Computer tasks a week — folder tools, research → files, websites</li>
                <li><Check size={15} /> 10 scheduled tasks running while you're away</li>
                <li><Check size={15} /> 10× higher chat limits and the most capable models</li>
              </ul>
            )}
            <div className="cw-pro-actions">
              <button type="button" className="is-ghost" onClick={() => setProGate(null)}>Maybe later</button>
              {proGate.plan === "free" && <button type="button" className="is-primary" onClick={() => { setProGate(null); onUpgrade?.(); }}><Sparkles size={15} /> Upgrade to Pro</button>}
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

// The reply while a task runs and once it is done: a live working card, a
// website being built in front of you, or the finished answer with its
// preview and downloads.
function PublishBar({ published, hasSite, disabled, onPublish }) {
  const [copied, setCopied] = useState(false);
  if (published?.status === "done") {
    const copy = async () => {
      try { await navigator.clipboard.writeText(published.url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
    };
    const share = () => navigator.share?.({ title: "My website", url: published.url }).catch(() => {});
    return (
      <div className="cw-published">
        <span className="cw-published-dot" />
        <span className="cw-published-text"><strong>Live</strong><a href={published.url} target="_blank" rel="noopener noreferrer">{published.url.replace(/^https?:\/\//, "")}</a></span>
        <button type="button" onClick={copy}><CopyIcon size={14} /> {copied ? "Copied" : "Copy link"}</button>
        {typeof navigator !== "undefined" && navigator.share && <button type="button" onClick={share}><Share2 size={14} /> Share</button>}
        <a className="cw-published-open" href={published.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Open</a>
      </div>
    );
  }
  return (
    <>
      <button type="button" className="is-primary" onClick={onPublish} disabled={disabled || published?.status === "publishing"}>
        {published?.status === "publishing" ? <Loader2 size={15} className="animate-spin" /> : <Globe2 size={15} />}
        {published?.status === "publishing" ? "Publishing…" : hasSite ? "Update the live site" : "Publish — get a link"}
      </button>
      {published?.status === "failed" && <span className="cw-publish-error">{published.error}</span>}
    </>
  );
}

function AssistantTurn(props) {
  const { message, task, live } = props;
  // The pages it searched and read on the web, played back in a small browser.
  if (!message.sources?.length || message.website) return <AssistantTurnBody {...props} />;
  return (
    <>
      <LiveBrowser sources={message.sources} query={task.title} live={live && !message.content} />
      <AssistantTurnBody {...props} />
    </>
  );
}

function AssistantTurnBody({ message, task, live, latest, disabled, onFix, onEdit, onPublish }) {
  const activeIndex = task.steps.findIndex(s => s.status === "active");
  if (!message.content) {
    if (!live) return null;
    return <WorkingCard step={task.steps[activeIndex]} index={activeIndex} count={task.steps.length} startedAt={message.startedAt} />;
  }
  if (message.website && live) {
    const caption = message.content.split(/```html/i)[0];
    return (
      <>
        {caption.trim() && <TaskReply content={caption} />}
        <LiveBuild content={message.content} startedAt={message.startedAt} />
      </>
    );
  }
  const html = message.exports?.includes("website") ? siteHtml(message.content) : null;
  return (
    <>
      <TaskReply content={message.content} />
      {live && (
        <div className="cw-still-working"><span className="cw-pulse-dot" /> {task.steps[activeIndex]?.label || "Working"}…{message.startedAt ? <> · <Elapsed since={message.startedAt} /></> : null}</div>
      )}
      {html && <SiteReport html={html} startedAt={message.startedAt} finishedAt={message.finishedAt} />}
      {message.exports?.length > 0 && (
        <div className="cowork-export-actions">
          {message.exports.includes("word") && <button type="button" onClick={() => downloadWordDocument(task.title, visualsToMarkdown(message.content))}><Download size={15} /> Download Word document</button>}
          {message.exports.includes("spreadsheet") && <button type="button" onClick={() => downloadSpreadsheet(task.title, visualsToMarkdown(message.content))}><Download size={15} /> Download spreadsheet</button>}
          {html && (
            <>
              <button type="button" onClick={() => downloadBlob(html, "text/html;charset=utf-8", safeFilename(task.title, "vetroai-site") + ".html")}><Download size={15} /> Download website (.html)</button>
              <PublishBar published={message.published} hasSite={!!task.siteId} disabled={disabled} onPublish={() => onPublish(html)} />
            </>
          )}
        </div>
      )}
      {html && latest && (
        <WebsitePreview
          key={message.id}
          html={html}
          title={task.title}
          disabled={disabled}
          onFix={(errors) => onFix(extractHtmlDocument(message.content), errors)}
          onEdit={(pick, instruction) => onEdit(extractHtmlDocument(message.content), pick, instruction)}
        />
      )}
    </>
  );
}

// Shown before the first words of a reply arrive: what step it is on, the
// latest thing the backend reported, and how long it has been going.
function WorkingCard({ step, index, count, startedAt }) {
  return (
    <div className="cw-working" role="status" aria-live="polite">
      <div className="cw-working-orb"><Sparkles size={16} /></div>
      <div className="cw-working-body">
        <div className="cw-working-title">{step?.label || "Getting started"}</div>
        <div className="cw-working-detail">{step?.detail || "Planning the work"}</div>
        <div className="cw-working-bar"><span /></div>
      </div>
      <div className="cw-working-meta">
        {index >= 0 && count > 0 && <span>Step {index + 1} of {count}</span>}
        {startedAt ? <span><Elapsed since={startedAt} /></span> : null}
      </div>
    </div>
  );
}

const STAGE_LABEL = {
  brief: "Reading your brief",
  design: "Choosing the layout, colors and fonts",
  style: "Styling the page",
  sections: "Building the page",
  script: "Wiring up the interactions",
  review: "Finishing up",
};

// The website taking shape while it is written: the HTML so far is drawn in
// a script-free frame every moment and scrolled to the newest part, with the
// sections it has built listed underneath.
function LiveBuild({ content, startedAt }) {
  const { stage, detail, lines, sections } = buildStage(content);
  const frameRef = useRef(null);
  const latestRef = useRef("");
  useEffect(() => { latestRef.current = partialHtml(content) || ""; }, [content]);
  const showPage = stage === "sections" || stage === "script" || stage === "review";

  useEffect(() => {
    const draw = () => {
      const frame = frameRef.current;
      const doc = frame?.contentDocument;
      if (!doc) return;
      const html = resolveSiteImages(latestRef.current, API);
      if (frame.dataset.drawn === String(html.length)) return;
      frame.dataset.drawn = String(html.length);
      // The frame is sandboxed without allow-scripts, so nothing in the
      // half-written page runs; allow-same-origin only lets this write it.
      doc.open();
      doc.write(html);
      doc.close();
      const scroller = doc.scrollingElement || doc.documentElement;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    };
    draw();
    const id = setInterval(draw, 1400);
    return () => clearInterval(id);
  }, []);

  const stepIds = ["design", "style", "sections", "script", "review"];
  const current = stepIds.indexOf(stage);
  return (
    <div className="cw-build" aria-live="polite">
      <div className="cw-browser-bar">
        <span className="cw-dots"><i /><i /><i /></span>
        <span className="cw-build-status"><Loader2 size={13} className="animate-spin" /> {STAGE_LABEL[stage]}{detail ? <em> · {detail}</em> : null}</span>
        <span className="cw-build-meta">{lines > 0 && <>{lines} lines · </>}{startedAt ? <Elapsed since={startedAt} /> : null}</span>
      </div>
      <div className="cw-build-stage">
        <iframe ref={frameRef} title="Website being built" sandbox="allow-same-origin" className={`cw-build-frame${showPage ? " is-visible" : ""}`} />
        {!showPage && (
          <div className="cw-build-skeleton" aria-hidden="true">
            <div className="cw-sk cw-sk-nav" />
            <div className="cw-sk cw-sk-hero" />
            <div className="cw-sk-row"><div className="cw-sk" /><div className="cw-sk" /><div className="cw-sk" /></div>
            <div className="cw-build-caption"><Sparkles size={15} /> {stage === "style" ? `Designing the look${detail ? ` — ${detail}` : ""}` : "Planning the design"}</div>
          </div>
        )}
      </div>
      <div className="cw-build-steps">
        {["Design", "Style", "Sections", "Interactions", "Final check"].map((label, i) => (
          <span key={label} className={i < current ? "is-done" : i === current ? "is-active" : ""}>
            {i < current ? <Check size={12} /> : i === current ? <Loader2 size={12} className="animate-spin" /> : <Circle size={10} />} {label}
          </span>
        ))}
      </div>
      {sections.length > 0 && (
        <div className="cw-build-sections">
          {sections.map((section, i) => (
            <span key={section.name} className={i === sections.length - 1 && stage === "sections" ? "is-active" : ""}>
              {i === sections.length - 1 && stage === "sections" ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} {section.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// What the finished page contains, read from the HTML itself.
function SiteReport({ html, startedAt, finishedAt }) {
  const info = useMemo(() => analyzeSite(html), [html]);
  const items = [
    { ok: info.sections.length > 0, icon: LayoutTemplate, text: `${info.sections.length} section${info.sections.length === 1 ? "" : "s"}` },
    { ok: info.images > 0, icon: ImageIcon, text: info.images ? `${info.images} photo${info.images === 1 ? "" : "s"} matched to the content` : "No photos" },
    { ok: info.responsive, icon: Smartphone, text: info.responsive ? "Phone-ready layout" : "No phone layout found" },
    { ok: info.mobileMenu, icon: Monitor, text: info.mobileMenu ? "Mobile menu" : "No mobile menu" },
    { ok: info.interactive, icon: Zap, text: info.interactive ? "Interactive" : "Static page" },
  ];
  return (
    <div className="cw-report">
      <div className="cw-report-head">
        <span className="cw-report-badge"><CheckCircle2 size={16} /></span>
        <div>
          <strong>Website ready</strong>
          <small>{startedAt && finishedAt ? <>Built in {formatElapsed(finishedAt - startedAt)} · </> : null}{info.lines} lines of code</small>
        </div>
      </div>
      <div className="cw-report-items">
        {items.map((item) => (
          <span key={item.text} className={item.ok ? "is-ok" : "is-warn"}><item.icon size={13} /> {item.text}</span>
        ))}
      </div>
      {info.sections.length > 0 && (
        <div className="cw-report-sections">{info.sections.map(s => <span key={s.name}>{s.name}</span>)}</div>
      )}
    </div>
  );
}

const DESKTOP_WIDTH = 1280;

// Renders the generated site in a sandboxed iframe and listens for the
// runtime errors PREVIEW_ERROR_CAPTURE forwards out of it — this is the
// "see" half of "see why and fix": without an actual render, computer mode
// has no way of knowing a script threw or a layout broke, only that text
// resembling HTML was produced.
//
// Desktop view draws the page at a real desktop width and scales it to fit,
// so the whole layout is visible even on a phone; Phone view shows it at
// phone width; Full screen gives it the whole display.
const PART_NAMES = { a: "link", button: "button", img: "image", picture: "image", svg: "icon", h1: "heading", h2: "heading", h3: "heading", h4: "heading", h5: "heading", h6: "heading", p: "text", span: "text", li: "list item", ul: "list", ol: "list", nav: "menu", header: "header", footer: "footer", form: "form", input: "field", textarea: "field", select: "field", table: "table", section: "section", div: "section", main: "section", article: "section", label: "label" };
const partName = (tag) => PART_NAMES[tag] || "part";

function WebsitePreview({ html, title, disabled, onFix, onEdit }) {
  const [errors, setErrors] = useState([]);
  const [editing, setEditing] = useState(false);
  const [pick, setPick] = useState(null);
  const [instruction, setInstruction] = useState("");
  const boxRef = useRef(null);
  // Tells every preview frame (inline and full screen) whether clicks pick parts.
  const sendEditMode = (on) => boxRef.current?.querySelectorAll("iframe").forEach(f => f.contentWindow?.postMessage({ source: "vetroai-parent", type: "edit-mode", on }, "*"));
  useEffect(() => { sendEditMode(editing); }, [editing]);
  useEffect(() => {
    const onMessage = (event) => {
      if (event.data?.source !== "vetroai-preview" || event.data?.type !== "pick") return;
      setPick({ tag: String(event.data.tag || "element"), text: String(event.data.text || ""), html: String(event.data.html || "") });
      setInstruction("");
      // One part at a time: picking stops until this change is sent or cancelled.
      setEditing(false);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  const submitEdit = (e) => {
    e.preventDefault();
    if (!pick || !instruction.trim()) return;
    onEdit?.(pick, instruction);
    setPick(null);
    setEditing(false);
  };
  const [device, setDevice] = useState(() => (typeof window !== "undefined" && window.innerWidth < 640 ? "phone" : "desktop"));
  const [full, setFull] = useState(false);
  const srcDoc = useMemo(() => withPreviewErrorCapture(html), [html]);

  useEffect(() => {
    setErrors([]);
    const onMessage = (event) => {
      if (event.data?.source !== "vetroai-preview" || event.data?.type !== "error") return;
      setErrors(prev => (prev.includes(event.data.message) ? prev : [...prev, event.data.message].slice(-8)));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [html]);

  useEffect(() => {
    if (!full) return undefined;
    const onKey = (event) => { if (event.key === "Escape") setFull(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  const toolbar = (
    <div className="cw-preview-tools">
      <div className="cw-segment" role="group" aria-label="Preview size">
        <button type="button" className={device === "desktop" ? "is-on" : ""} onClick={() => setDevice("desktop")} aria-pressed={device === "desktop"} title="Desktop view"><Monitor size={14} /><span>Desktop</span></button>
        <button type="button" className={device === "phone" ? "is-on" : ""} onClick={() => setDevice("phone")} aria-pressed={device === "phone"} title="Phone view"><Smartphone size={14} /><span>Phone</span></button>
      </div>
      {onEdit && (
        <button type="button" className={`cw-edit-toggle${editing ? " is-on" : ""}`} onClick={() => { setEditing(v => !v); setPick(null); }} disabled={disabled} aria-pressed={editing} title="Click any part of the page, then say what to change">
          <MousePointerClick size={14} /><span>{editing ? "Click a part…" : "Click to edit"}</span>
        </button>
      )}
      <button type="button" className="cw-icon-btn" onClick={() => setFull(v => !v)} title={full ? "Exit full screen" : "Full screen"} aria-label={full ? "Exit full screen" : "Full screen"}>
        {full ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
      </button>
    </div>
  );

  const editPanel = pick && (
    <form className="cw-edit-panel" onSubmit={submitEdit}>
      <div className="cw-edit-target"><MousePointerClick size={14} /> Editing the <strong>{partName(pick.tag)}</strong>{pick.text ? <> “{pick.text.slice(0, 60)}{pick.text.length > 60 ? "…" : ""}”</> : null}</div>
      <div className="cw-edit-row">
        <input autoFocus value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="What should change? e.g. make it green and bigger, say ‘Shop the sale’" />
        <button type="submit" disabled={!instruction.trim() || disabled}><Send size={14} /> Change it</button>
        <button type="button" className="is-ghost" onClick={() => setPick(null)} aria-label="Cancel"><X size={14} /></button>
      </div>
    </form>
  );

  return (
    <div className="cowork-website-preview" ref={boxRef}>
      <div className="cowork-website-preview-header">
        <span className="cw-dots"><i /><i /><i /></span>
        <span className="cw-preview-title"><Globe2 size={13} /> {title || "Live preview"}</span>
        {errors.length > 0 && <span className="cowork-website-preview-badge">{errors.length} error{errors.length > 1 ? "s" : ""}</span>}
        {toolbar}
      </div>
      {editPanel}
      {full ? (
        <div className="cw-preview-placeholder"><Maximize2 size={16} /> Showing in full screen</div>
      ) : (
        <PreviewFrame srcDoc={srcDoc} device={device} height="inline" onLoad={() => sendEditMode(editing)} />
      )}
      {full && (
        <div className="cw-fullscreen" role="dialog" aria-label="Website preview">
          <div className="cw-fullscreen-bar">
            <span className="cw-preview-title"><Globe2 size={14} /> {title || "Live preview"}</span>
            {toolbar}
          </div>
          {editPanel}
          <PreviewFrame srcDoc={srcDoc} device={device} height="fill" onLoad={() => sendEditMode(editing)} />
        </div>
      )}
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

function PreviewFrame({ srcDoc, device, height, onLoad }) {
  const boxRef = useRef(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => setBox({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Narrower than a desktop: draw at desktop width and scale down to fit.
  const scale = device === "desktop" && box.width && box.width < DESKTOP_WIDTH ? box.width / DESKTOP_WIDTH : 1;
  const frameStyle = device === "phone"
    ? { width: Math.min(390, box.width || 390), height: "100%" }
    : scale < 1
      ? { width: DESKTOP_WIDTH, height: box.height ? box.height / scale : "100%", transform: `scale(${scale})`, transformOrigin: "0 0" }
      : { width: "100%", height: "100%" };

  return (
    <div ref={boxRef} className={`cw-frame-box is-${height} is-${device}`}>
      <iframe
        title="Website preview"
        sandbox="allow-scripts allow-forms allow-popups allow-modals"
        srcDoc={srcDoc}
        onLoad={onLoad}
        className="cowork-website-preview-frame"
        style={frameStyle}
      />
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
    [CalendarClock, "Scheduled tasks", "Ready", "Daily updates and watches that run while you're away"],
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
