// Which asks need VetroAI to work the computer itself (the screen agent, in
// the desktop app) rather than answer in the chat.
//
// DESKTOP_CONTROL_REQUEST and LIVE_BROWSE_REQUEST are Computer's original,
// narrow checks; in a browser tab, where there is no desktop app, they decide
// when to say the app is needed. wantsScreenControl reads more: a task sent
// from the phone through Dispatch ("open youtube", "go to amazon.in",
// "open a new tab", "open my downloads folder", "play arijit songs on
// spotify") used to run as a chat answer that only described doing it.

import { isLiveSiteRequest } from "./liveSites.js";

// The app name has to directly follow the verb. A loose "verb within 50
// characters of a noun" window matched plenty of things this workspace does
// handle — "open the excel file I attached and summarize it" is file analysis,
// not app control.
export const DESKTOP_CONTROL_REQUEST = /\b(?:open|launch|start|run|close)\s+(?:the\s+|a\s+|an\s+|my\s+)?(?:ms ?word|microsoft word|word|excel|powerpoint|notepad|calculator|file explorer|finder|terminal|command prompt|control panel|settings|chrome|edge|firefox|spotify|whatsapp|outlook|paint|vs ?code)\b|\b(?:open|launch|start)\s+(?:an?\s+)?(?:app|application|program|software)\b|\b(?:click|double.?click|scroll|drag)\b[\s\S]{0,40}\b(?:on|in)\s+my\s+(?:desktop|computer|screen|pc|laptop)\b|\bcontrol my (?:mouse|keyboard|screen|computer|desktop|pc)\b/i;

// Asks for live, interactive-site data (bus/flight/train fares, hotel
// prices, real-time schedules) that no plain-chat model can answer — the
// numbers only exist behind a search form on the booking site itself.
export const LIVE_BROWSE_REQUEST = /\b(?:redbus|irctc|makemytrip|goibibo|ixigo|abhibus|ticketgoose|yatra|cleartrip|skyscanner|expedia|booking\.com|airbnb)\b|\b(?:bus|flight|train|hotel|cab|taxi)(?:es)?\b[\s\S]{0,60}\b(?:price|prices|fare|fares|schedule|schedules|ticket|tickets)\b[\s\S]{0,40}\b(?:today|tomorrow|from\s.+\bto\b)\b|\b(?:price|prices|fare|fares|schedule|schedules|ticket|tickets)\b[\s\S]{0,60}\b(?:bus|flight|train|hotel|cab|taxi)(?:es)?\b[\s\S]{0,40}\b(?:today|tomorrow|from\s.+\bto\b)\b/i;

// Apps and sites people ask a computer to open.
const APPS = [
  "ms ?word", "microsoft word", "word", "excel", "powerpoint", "outlook", "onenote", "(?:microsoft )?teams", "notepad", "wordpad", "paint",
  "calculator", "calendar", "camera", "photos", "clock", "alarms?", "mail", "(?:microsoft )?store", "settings", "control panel",
  "task manager", "file explorer", "explorer", "finder", "terminal", "command prompt", "cmd", "powershell",
  "(?:google )?chrome", "(?:microsoft )?edge", "firefox", "brave", "opera", "safari", "spotify", "vlc", "itunes", "apple music",
  "whatsapp", "telegram", "discord", "slack", "zoom", "skype", "signal", "steam", "obs", "figma", "photoshop", "illustrator",
  "premiere(?: pro)?", "canva", "vs ?code", "visual studio(?: code)?", "android studio", "intellij", "pycharm", "postman",
  "github desktop", "notion", "evernote", "youtube", "netflix", "prime video", "hotstar", "gmail", "google drive",
  "google docs", "google sheets", "google maps", "instagram", "facebook", "twitter", "linkedin", "chatgpt",
].join("|");

const ACT_ON_COMPUTER = [
  // "open telegram", "launch vlc", "close chrome", "switch to excel"
  String.raw`\b(?:open|launch|start|run|close|quit|exit|minimi[sz]e|maximi[sz]e|switch to|bring up|pull up|fire up)\s+(?:all\s+)?(?:the\s+|a\s+|an\s+|my\s+)?(?:new\s+)?(?:${APPS})(?:\s+app)?\b(?!\s+(?:file|files|document|documents|doc|docs|sheet|spreadsheet|attachment|pdf)\b)`,
  // "go to amazon.in", "open wikipedia.org", "visit https://…"
  String.raw`\b(?:open|go to|visit|load|browse to|navigate to)\s+(?:the\s+)?(?:website\s+|site\s+|page\s+)?(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.(?:com|in|org|net|io|co|ai|dev|app|edu|gov|me|tv|co\.in|org\.in)\b`,
  // "open a new tab", "close this tab", "open an incognito window"
  String.raw`\b(?:open|close|switch to|go to)\s+(?:a\s+|an\s+|the\s+|this\s+|my\s+)?(?:new\s+|next\s+|previous\s+|last\s+)?(?:browser\s+)?(?:tab|tabs|incognito window|private window|browser window)\b`,
  String.raw`\bnew (?:browser )?tab\b`,
  // "open my downloads folder", "show the desktop"
  String.raw`\b(?:open|show|go to)\s+(?:my\s+|the\s+)?(?:downloads|documents|desktop|pictures|music|videos|recycle bin|trash|c drive|d drive)(?:\s+folder)?\b`,
  // "type hello in notepad", "play arijit songs on spotify", "search cats in chrome"
  String.raw`\b(?:type|write|search|play|click|find|look up|book|order|send|post|check|save|download|install|pause|resume|skip)\b[\s\S]{0,60}\b(?:in|on|using|with)\s+(?:the\s+|my\s+)?(?:${APPS})\b`,
  // "… on my laptop", "do it on this computer"
  String.raw`\bon (?:my|this|the) (?:computer|pc|laptop|desktop|screen|system|mac|machine)\b`,
  // "turn up the volume", "mute the sound", "lower the brightness"
  String.raw`\b(?:turn|set|put)\s+(?:up|down|on|off)\s+(?:the\s+)?(?:volume|sound|brightness|wi-?fi|bluetooth)\b|\b(?:mute|unmute)\s+(?:the\s+)?(?:volume|sound|computer|pc|laptop)\b`,
];
export const ACT_ON_COMPUTER_REQUEST = new RegExp(ACT_ON_COMPUTER.join("|"), "i");

// About a file the user gave VetroAI ("open the excel file I attached"):
// that is read, not opened on the screen.
const ABOUT_GIVEN_FILE = /\b(?:attached|attachment|uploaded|i (?:sent|shared|gave) you)\b/i;

/** Does the ask need the screen agent (the mouse, keyboard and apps of this computer)? */
export function wantsScreenControl(prompt = "") {
  const text = String(prompt);
  if (ABOUT_GIVEN_FILE.test(text)) return false;
  return DESKTOP_CONTROL_REQUEST.test(text) || LIVE_BROWSE_REQUEST.test(text) || isLiveSiteRequest(text) || ACT_ON_COMPUTER_REQUEST.test(text);
}
