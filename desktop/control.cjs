// The parts of screen control that need no Electron: the glow and the pill
// shown while VetroAI works, which keys the agent may press, how text is put
// in, how fast actions may follow each other. main.cjs uses them; the
// frontend's test suite checks them (frontend/test/desktopControl.test.js).

// While VetroAI drives the computer, the edges of the screen glow in its warm
// coral, breathing slowly, the way Claude and other agents show they are at
// work. The glow lets every click through and is left out of screenshots.
const GLOW_HTML = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden}
.g{position:fixed;inset:0;pointer-events:none;will-change:opacity;animation:breathe 3.2s ease-in-out infinite;
box-shadow:inset 0 0 0 2px rgba(217,119,87,.95),inset 0 0 12px 3px rgba(217,119,87,.7),inset 0 0 34px 8px rgba(240,140,90,.34),inset 0 0 80px 10px rgba(217,119,87,.10)}
@keyframes breathe{0%,100%{opacity:.72}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){.g{animation:none;opacity:.85}}
</style><div class="g"></div>`;

// A calm pill at the top: what VetroAI is doing now, and Stop. Stop sets the
// page title, which main.cjs listens for (a link to a made-up scheme isn't
// always reported as a navigation).
const PILL_SIZE = { width: 360, height: 44 };
const PILL_HTML = `<!doctype html><meta charset="utf-8"><title>VetroAI</title><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden;-webkit-user-select:none;user-select:none;font:500 13px "Segoe UI Variable Text","Segoe UI",-apple-system,system-ui,sans-serif}
.p{display:flex;align-items:center;gap:10px;height:36px;margin:4px;padding:0 4px 0 14px;border-radius:999px;background:rgba(28,25,23,.95);color:#f5f5f4;border:1px solid rgba(217,119,87,.45);box-shadow:0 0 0 3px rgba(217,119,87,.10),0 4px 16px rgba(0,0,0,.28)}
.d{flex:none;width:8px;height:8px;border-radius:50%;background:#d97757;box-shadow:0 0 8px 2px rgba(217,119,87,.75);animation:pulse 1.6s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:.55;transform:scale(.85)}50%{opacity:1;transform:scale(1)}}
.t{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:.01em}
a{flex:none;color:#f5f5f4;text-decoration:none;font-weight:600;font-size:12px;padding:6px 13px;border-radius:999px;background:rgba(255,255,255,.12);cursor:default}
a:hover{background:#dc2626}
@media (prefers-reduced-motion:reduce){.d{animation:none}}
</style><div class="p"><span class="d"></span><span class="t" id="t">VetroAI is working…</span><a href="vetro-stop://now" title="Stop (Ctrl+Shift+X)" onclick="document.title='vetro-stop';return false">Stop</a></div>`;
const STOP_TITLE = "vetro-stop";

/** The pill's text: what the agent is doing, short. */
function pillLabel(label) {
  const text = String(label || "").replace(/\s+/g, " ").trim();
  return text ? `VetroAI · ${text.slice(0, 80)}` : "VetroAI is working…";
}

// Keys the agent may press, by the names the model uses. Letters, digits and
// F1-F12 are added below. Anything else is refused with a reason the agent
// is told, instead of ending the run.
const NAMED_KEYS = {
  ENTER: "Enter", RETURN: "Enter", TAB: "Tab", ESCAPE: "Escape", ESC: "Escape", BACKSPACE: "Backspace",
  DELETE: "Delete", DEL: "Delete", SPACE: "Space", SPACEBAR: "Space", INSERT: "Insert",
  UP: "Up", DOWN: "Down", LEFT: "Left", RIGHT: "Right", ARROWUP: "Up", ARROWDOWN: "Down", ARROWLEFT: "Left", ARROWRIGHT: "Right",
  HOME: "Home", END: "End", PAGEUP: "PageUp", PAGEDOWN: "PageDown", PGUP: "PageUp", PGDN: "PageDown",
  MINUS: "Minus", EQUAL: "Equal", EQUALS: "Equal", COMMA: "Comma", PERIOD: "Period", DOT: "Period", SLASH: "Slash",
  BACKSLASH: "Backslash", SEMICOLON: "Semicolon", QUOTE: "Quote", GRAVE: "Grave", BACKTICK: "Grave",
  LEFTBRACKET: "LeftBracket", RIGHTBRACKET: "RightBracket",
  PLAYPAUSE: "AudioPlay", MUTE: "AudioMute", VOLUMEUP: "AudioVolUp", VOLUMEDOWN: "AudioVolDown",
};
const MODIFIERS = { CTRL: "LeftControl", CONTROL: "LeftControl", SHIFT: "LeftShift", ALT: "LeftAlt", OPTION: "LeftAlt" };
const META_NAMES = new Set(["META", "WIN", "WINDOWS", "CMD", "COMMAND", "SUPER", "START"]);
const SYMBOLS = { "-": "MINUS", "=": "EQUAL", ",": "COMMA", ".": "PERIOD", "/": "SLASH", "\\": "BACKSLASH", ";": "SEMICOLON", "'": "QUOTE", "`": "GRAVE", "[": "LEFTBRACKET", "]": "RIGHTBRACKET" };

function keyName(name) {
  const raw = String(name || "").trim();
  if (SYMBOLS[raw]) return SYMBOLS[raw];
  return raw.toUpperCase().replace(/[\s_-]+/g, "");
}

function metaKeyName(platform) {
  return platform === "darwin" ? "LeftCmd" : platform === "win32" ? "LeftWin" : "LeftSuper";
}

/** The Key enum member name for one key, or null. */
function keyMember(name, platform) {
  const n = keyName(name);
  if (!n) return null;
  if (META_NAMES.has(n)) return metaKeyName(platform);
  if (/^[A-Z]$/.test(n)) return n;
  if (/^[0-9]$/.test(n)) return `Num${n}`;
  if (/^F([1-9]|1[0-2])$/.test(n)) return n;
  return NAMED_KEYS[n] || null;
}

/**
 * The keys to press for `key` with `modifiers`, as Key enum values, or
 * { error } saying why not. "CTRL+L" in `key` alone is read as a combo too.
 * On a Mac, Ctrl with a letter is Cmd: shortcuts the model knows from Windows
 * (copy, paste, new tab, address bar) then do the same there.
 */
function resolveKeys(Key, key, modifiers = [], platform = process.platform) {
  const parts = String(key || "").split("+").map((p) => p.trim()).filter(Boolean);
  if (String(key || "").trim() === "+") parts.splice(0, parts.length, "EQUAL");
  const main = parts.pop();
  const mods = [...parts, ...(Array.isArray(modifiers) ? modifiers : [])].map(keyName);
  const member = keyMember(main, platform);
  if (!member || Key[member] === undefined) return { error: `"${main || key}" isn't a key VetroAI can press` };
  if (META_NAMES.has(keyName(main)) && mods.length) return { error: "the Start/Cmd key is pressed on its own, with no other keys" };
  const modMembers = [];
  for (const m of mods) {
    if (META_NAMES.has(m)) return { error: "the Start/Cmd key can't be held with other keys" };
    const held = MODIFIERS[m];
    if (!held) return { error: `"${m}" isn't a modifier VetroAI can hold (use CTRL, SHIFT or ALT)` };
    if (!modMembers.includes(held)) modMembers.push(held);
  }
  if (modMembers.includes("LeftAlt") && member === "F4") return { error: "Alt+F4 isn't allowed: close a window with its own close button" };
  if (platform === "darwin" && /^[A-Z]$/.test(member)) {
    const i = modMembers.indexOf("LeftControl");
    if (i >= 0) modMembers[i] = "LeftCmd";
  }
  return { key: Key[member], modifiers: modMembers.slice(0, 3).map((m) => Key[m]) };
}

/**
 * Text longer than this, or with anything beyond plain ASCII (Tamil, Hindi,
 * emoji, accents), is pasted instead of typed: typing goes a key at a time
 * (a long reply took most of a minute) and can't always produce those
 * characters. The clipboard is put back afterwards.
 */
const PASTE_OVER = 80;
const shouldPaste = (text) => String(text).length > PASTE_OVER || /[^\x20-\x7E\t\n\r]/.test(String(text));

/**
 * Scroll amount for the native call. The model gives roughly pixels; on Linux
 * each unit is a whole wheel click, so 300 would scroll hundreds of lines.
 */
function scrollAmount(amount, platform = process.platform) {
  const n = Math.max(-1200, Math.min(1200, Number(amount) || 0));
  if (platform !== "linux" || n === 0) return n;
  return Math.sign(n) * Math.max(1, Math.round(Math.abs(n) / 100));
}

/** Pixels per second for a glide of `distance` pixels that should take `durationMs`. */
function glideSpeed(distance, durationMs) {
  return Math.max(400, distance / (Math.max(60, Number(durationMs) || 250) / 1000));
}

/**
 * Spaces actions at least `gapMs` apart by waiting, not refusing: a click
 * right after a move that took no time (the cursor was already there) used
 * to fail the whole run with "Action rate limit exceeded".
 */
function createPacer(gapMs = 20, { now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let next = 0;
  return async function pace() {
    const wait = next - now();
    next = Math.max(now(), next) + gapMs;
    if (wait > 0) await sleep(wait);
  };
}

/**
 * Whether a window can be left out of screen captures. Windows only does it
 * from 10 version 2004 (build 19041); before that, "protected" windows show as
 * black in a capture, which would black out the agent's whole screenshot.
 */
function canExcludeFromCapture(platform = process.platform, release = "") {
  if (platform === "darwin") return true;
  if (platform !== "win32") return false;
  const build = Number(String(release).split(".")[2]);
  return Number.isFinite(build) && build >= 19041;
}

module.exports = {
  GLOW_HTML, PILL_HTML, PILL_SIZE, STOP_TITLE, pillLabel,
  resolveKeys, keyMember, PASTE_OVER, shouldPaste, scrollAmount, glideSpeed, createPacer, canExcludeFromCapture,
};
