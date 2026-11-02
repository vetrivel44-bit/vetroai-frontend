import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const control = require("../../desktop/control.cjs");

// A stand-in for nut-js's Key enum: each name maps to a number (Escape is 0).
const names = ["Escape", "Enter", "Tab", "Backspace", "Delete", "Space", "Insert", "Up", "Down", "Left", "Right", "Home", "End", "PageUp", "PageDown",
  "LeftControl", "LeftShift", "LeftAlt", "LeftWin", "LeftCmd", "LeftSuper", "Minus", "Equal", "Comma", "Period", "Slash", "Backslash", "Semicolon",
  "Quote", "Grave", "LeftBracket", "RightBracket", "AudioPlay", "AudioMute", "AudioVolUp", "AudioVolDown",
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""), ...Array.from({ length: 10 }, (_, i) => `Num${i}`), ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`)];
const Key = Object.fromEntries(names.map((n, i) => [n, i]));

// Opening a tab, the address bar, switching windows: the shortcuts that open
// apps, tabs and searches used to be refused ("Key is not allowed"), and one
// refusal ended the whole run.
test("letters, digits, F-keys and browser shortcuts can be pressed", () => {
  assert.deepEqual(control.resolveKeys(Key, "L", ["CTRL"], "win32"), { key: Key.L, modifiers: [Key.LeftControl] });
  assert.deepEqual(control.resolveKeys(Key, "t", ["ctrl"], "win32"), { key: Key.T, modifiers: [Key.LeftControl] });
  assert.deepEqual(control.resolveKeys(Key, "TAB", ["ALT"], "win32"), { key: Key.Tab, modifiers: [Key.LeftAlt] });
  assert.deepEqual(control.resolveKeys(Key, "F5", [], "win32"), { key: Key.F5, modifiers: [] });
  assert.deepEqual(control.resolveKeys(Key, "1", ["CTRL"], "win32"), { key: Key.Num1, modifiers: [Key.LeftControl] });
  assert.deepEqual(control.resolveKeys(Key, "ctrl+shift+t", [], "win32"), { key: Key.T, modifiers: [Key.LeftControl, Key.LeftShift] });
  assert.deepEqual(control.resolveKeys(Key, "Escape", [], "win32"), { key: 0, modifiers: [] }, "Escape is 0, not missing");
  assert.deepEqual(control.resolveKeys(Key, "ArrowDown", [], "linux"), { key: Key.Down, modifiers: [] });
});

test("META is this OS's Start/Cmd/Super key, pressed alone; Ctrl+letter is Cmd on a Mac", () => {
  assert.equal(control.resolveKeys(Key, "META", [], "win32").key, Key.LeftWin);
  assert.equal(control.resolveKeys(Key, "WIN", [], "darwin").key, Key.LeftCmd);
  assert.equal(control.resolveKeys(Key, "META", [], "linux").key, Key.LeftSuper);
  assert.match(control.resolveKeys(Key, "META", ["CTRL"], "win32").error, /on its own/);
  assert.deepEqual(control.resolveKeys(Key, "V", ["CTRL"], "darwin"), { key: Key.V, modifiers: [Key.LeftCmd] });
  assert.deepEqual(control.resolveKeys(Key, "TAB", ["CTRL"], "darwin"), { key: Key.Tab, modifiers: [Key.LeftControl] }, "Ctrl+Tab stays Ctrl");
});

test("what can't be pressed is refused with a reason the agent can act on", () => {
  assert.match(control.resolveKeys(Key, "F4", ["ALT"], "win32").error, /Alt\+F4 isn't allowed/);
  assert.match(control.resolveKeys(Key, "HYPER", [], "win32").error, /isn't a key/);
  assert.match(control.resolveKeys(Key, "A", ["FN"], "win32").error, /isn't a modifier/);
});

test("long or non-ASCII text is pasted, short plain text is typed", () => {
  assert.equal(control.shouldPaste("weather in chennai"), false);
  assert.equal(control.shouldPaste("line one\nline two"), false);
  assert.equal(control.shouldPaste("x".repeat(control.PASTE_OVER + 1)), true);
  assert.equal(control.shouldPaste("வணக்கம்"), true);
  assert.equal(control.shouldPaste("नमस्ते"), true);
  assert.equal(control.shouldPaste("café"), true);
  assert.equal(control.shouldPaste("ok 👍"), true);
});

test("scrolling is in pixels, but whole wheel clicks on Linux", () => {
  assert.equal(control.scrollAmount(300, "win32"), 300);
  assert.equal(control.scrollAmount(-5000, "win32"), -1200);
  assert.equal(control.scrollAmount(300, "linux"), 3);
  assert.equal(control.scrollAmount(-40, "linux"), -1);
  assert.equal(control.scrollAmount(0, "linux"), 0);
});

test("a glide takes about the time asked, not a fixed 1000 px a second", () => {
  assert.equal(control.glideSpeed(3000, 250), 12000);
  assert.equal(control.glideSpeed(50, 250), 400, "a short hop still moves briskly");
});

// A click right after a move that took no time used to fail the run with
// "Action rate limit exceeded"; actions now wait their turn.
test("actions closer than the gap wait instead of failing", async () => {
  let clock = 1000;
  const slept = [];
  const pace = control.createPacer(20, { now: () => clock, sleep: async (ms) => { slept.push(ms); clock += ms; } });
  await pace();
  await pace();
  clock += 5;
  await pace();
  clock += 100;
  await pace();
  assert.deepEqual(slept, [20, 15]);
});

test("windows are left out of captures only where the OS can do it", () => {
  assert.equal(control.canExcludeFromCapture("win32", "10.0.19045"), true);
  assert.equal(control.canExcludeFromCapture("win32", "10.0.22631"), true);
  assert.equal(control.canExcludeFromCapture("win32", "10.0.18363"), false, "older Windows would capture a black screen");
  assert.equal(control.canExcludeFromCapture("darwin", "23.1.0"), true);
  assert.equal(control.canExcludeFromCapture("linux", "6.8.0"), false);
});

test("the glow breathes in VetroAI's coral at the screen's edges, and the pill can stop the run", () => {
  assert.match(control.GLOW_HTML, /inset 0 0 0 2px rgba\(217,119,87/);
  assert.match(control.GLOW_HTML, /@keyframes breathe/);
  assert.match(control.GLOW_HTML, /prefers-reduced-motion/);
  assert.match(control.PILL_HTML, /document\.title='vetro-stop'/);
  assert.equal(control.STOP_TITLE, "vetro-stop");
  assert.equal(control.pillLabel("Open the Start menu"), "VetroAI · Open the Start menu");
  assert.equal(control.pillLabel(""), "VetroAI is working…");
});
