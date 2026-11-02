import test from "node:test";
import assert from "node:assert/strict";

import { GRID, THUMB, gridToPixels, changedPixels, UNCHANGED_AT_MOST, grayscale, isStuck, doneVerdict, finalMessage } from "../src/lib/screenAgent.js";

test("grid points become pixels of the image the model saw", () => {
  assert.deepEqual(gridToPixels({ action: "click", x: 500, y: 500 }, 1281, 721), { action: "click", x: 640, y: 360 });
  assert.deepEqual(gridToPixels({ action: "click", x: 0, y: GRID }, 1280, 720), { action: "click", x: 0, y: 719 });
  assert.deepEqual(gridToPixels({ action: "drag", fromX: 100, fromY: 200, toX: 900, toY: 800 }, 1001, 501), { action: "drag", fromX: 100, fromY: 100, toX: 900, toY: 400 });
  // Below zero is the edge, and actions without a point pass through.
  assert.deepEqual(gridToPixels({ action: "click", x: -20, y: 30 }, 1280, 720), { action: "click", x: 0, y: 22 });
  assert.deepEqual(gridToPixels({ action: "type", text: "hi" }, 1280, 720), { action: "type", text: "hi" });
});

test("a position past the grid is taken as pixels, as a model ignoring the grid meant it", () => {
  assert.deepEqual(gridToPixels({ action: "click", x: 1150, y: 300 }, 1280, 720), { action: "click", x: 1150, y: 300 });
  assert.deepEqual(gridToPixels({ action: "click", x: 1500, y: 900 }, 1280, 720), { action: "click", x: 1279, y: 719 });
});

test("screen change: only the same screen counts as unchanged; a ticked box or one typed letter is a change", () => {
  const { width, height } = THUMB;
  const blank = new Uint8Array(width * height).fill(240);
  const at = (img, x, y, v) => { img[y * width + x] = v; };
  assert.equal(changedPixels(blank, blank.slice()), 0);
  assert.ok(changedPixels(blank, blank.slice()) <= UNCHANGED_AT_MOST);
  // A faint shimmer below the tolerance is no change.
  const shimmer = blank.map((v, i) => (i % 7 ? v : v - 6));
  assert.ok(changedPixels(blank, shimmer) <= UNCHANGED_AT_MOST);
  // A check mark in a 16 px box on a 1920 px screen: a handful of pixels at a third of the size.
  const ticked = blank.slice();
  for (const [x, y] of [[300, 200], [301, 201], [302, 202], [303, 201], [304, 200], [305, 199], [306, 198]]) at(ticked, x, y, 40);
  assert.ok(changedPixels(blank, ticked) > UNCHANGED_AT_MOST);
  // One typed letter, about 3 x 5 pixels here.
  const letter = blank.slice();
  for (let y = 100; y < 105; y++) for (let x = 50; x < 53; x++) if ((x + y) % 2) at(letter, x, y, 60);
  assert.ok(changedPixels(blank, letter) > UNCHANGED_AT_MOST);
  // A new window.
  const dialog = blank.slice();
  for (let y = 100; y < 260; y++) for (let x = 200; x < 440; x++) at(dialog, x, y, 30);
  assert.ok(changedPixels(blank, dialog) > 30000);
  assert.equal(changedPixels(blank, new Uint8Array(10)), Infinity, "copies that can't be compared count as changed");
  assert.equal(changedPixels(null, blank), Infinity);
  assert.deepEqual([...grayscale(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]))], [255, 0]);
});

test("stuck: the same click three times with nothing changing; not when the screen moved or the target did", () => {
  const click = { action: "click", x: 510, y: 300 };
  const near = { action: "click", x: 518, y: 306 };
  assert.equal(isStuck([{ action: click, changed: false }, { action: near, changed: false }, { action: click, changed: false }]), true);
  assert.equal(isStuck([{ action: click, changed: false }, { action: click, changed: true }, { action: click, changed: false }]), false);
  assert.equal(isStuck([{ action: click, changed: false }, { action: { action: "click", x: 700, y: 300 }, changed: false }, { action: click, changed: false }]), false);
  assert.equal(isStuck([{ action: click, changed: false }, { action: click, changed: false }]), false);
  const typing = { action: "type", text: "notepad" };
  assert.equal(isStuck([{ action: typing, changed: false }, { action: typing, changed: false }, { action: typing, changed: false }]), true);
});

test("done means success only when the model doesn't say it failed", () => {
  assert.equal(doneVerdict({ action: "done", success: true, summary: "Notepad is open" }), "success");
  assert.equal(doneVerdict({ action: "done", success: false, summary: "A sign-in screen is in the way" }), "failure");
  assert.equal(doneVerdict({ action: "done", success: "false" }), "failure");
  assert.equal(doneVerdict({ action: "done", summary: "older reply" }), "success");
});

test("the reply leads with the outcome, then the steps", () => {
  assert.equal(finalMessage({ outcome: "done", summary: "Notepad is open with the note typed in.", steps: ["Press META", 'Type "notepad"'] }),
    '**Done:** Notepad is open with the note typed in.\n\n**Steps**\n1. Press META\n2. Type "notepad"');
  assert.match(finalMessage({ outcome: "failed", summary: "it kept clicking the same spot and nothing happened." }), /^\*\*Couldn't finish:\*\* it kept clicking/);
  assert.equal(finalMessage({ outcome: "stopped" }), "**Stopped.**");
  const many = Array.from({ length: 30 }, (_, i) => `Step ${i + 1}`);
  const text = finalMessage({ outcome: "failed", summary: "x", steps: many });
  assert.match(text, /_\(5 earlier steps not shown\)_\n6\. Step 6/);
  assert.match(text, /30\. Step 30$/);
});

// ── Actions on the desktop app ────────────────────────────────────────────
import {
  describeAgentAction, normalizeKeyAction, performDesktopAction, waitSeconds, isControlStopped, actionErrorText, retryableStatus, stepLabel,
} from "../src/lib/screenAgent.js";

function fakeDesktop(extra = {}) {
  const calls = [];
  const record = (name) => async (...args) => { calls.push([name, ...args]); return name === "readClipboard" || name === "copy" ? { ok: true, text: "copied" } : { ok: true }; };
  const desktop = { version: "1.1.0", calls };
  for (const name of ["moveMouse", "click", "typeText", "pressKey", "scroll", "drag", "readClipboard", "writeClipboard", "copy", "paste"]) desktop[name] = record(name);
  return Object.assign(desktop, extra);
}

test("a key action keeps only CTRL/SHIFT/ALT, reads \"ctrl+l\" as a combo, and presses META alone", () => {
  assert.deepEqual(normalizeKeyAction({ action: "key", key: "ctrl+l" }), { action: "key", key: "L", modifiers: ["CTRL"] });
  assert.deepEqual(normalizeKeyAction({ action: "key", key: "t", modifiers: ["control", "shift", "ctrl"] }), { action: "key", key: "T", modifiers: ["CTRL", "SHIFT"] });
  assert.deepEqual(normalizeKeyAction({ action: "key", key: "META", modifiers: ["CTRL", "SHIFT"] }), { action: "key", key: "META", modifiers: [] });
  assert.deepEqual(normalizeKeyAction({ action: "key", key: "ENTER", modifiers: ["META"] }).modifiers, []);
  assert.deepEqual(normalizeKeyAction({ action: "click", x: 1 }), { action: "click", x: 1 });
});

test("scroll goes where it is pointed; wait only waits; copy and paste use the app's own calls", async () => {
  const desktop = fakeDesktop();
  const slept = [];
  const sleep = async (ms) => { slept.push(ms); };
  await performDesktopAction(desktop, { action: "scroll", amount: 300, x: 640, y: 400 }, { sleep });
  await performDesktopAction(desktop, { action: "scroll", amount: -200 }, { sleep });
  await performDesktopAction(desktop, { action: "wait", seconds: 3 }, { sleep });
  const copied = await performDesktopAction(desktop, { action: "copy" }, { sleep });
  await performDesktopAction(desktop, { action: "paste", text: "வணக்கம்" }, { sleep });
  await performDesktopAction(desktop, { action: "click", x: 10, y: 20, double: true }, { sleep });
  assert.deepEqual(desktop.calls, [
    ["scroll", 300, 640, 400], ["scroll", -200], ["copy"], ["paste", "வணக்கம்"], ["moveMouse", 10, 20, 150], ["click", "left", true],
  ]);
  assert.deepEqual(slept, [3000]);
  assert.equal(copied.text, "copied");
});

test("an older desktop app still copies, pastes and scrolls at a point", async () => {
  const desktop = fakeDesktop({ version: "1.0.0", copy: undefined, paste: undefined });
  await performDesktopAction(desktop, { action: "scroll", amount: 300, x: 5, y: 6 }, { sleep: async () => {} });
  await performDesktopAction(desktop, { action: "copy" }, { sleep: async () => {} });
  await performDesktopAction(desktop, { action: "paste", text: "hi" }, { sleep: async () => {} });
  assert.deepEqual(desktop.calls, [
    ["moveMouse", 5, 6, 120], ["scroll", 300, 5, 6], ["pressKey", "C", ["CTRL"]], ["readClipboard"], ["writeClipboard", "hi"], ["pressKey", "V", ["CTRL"]],
  ]);
});

test("an action it doesn't know is refused, so the model is told instead of nothing happening", async () => {
  await assert.rejects(performDesktopAction(fakeDesktop(), { action: "fly" }), /"fly" isn't an action/);
});

test("waits are 0.5 to 10 seconds, 2 by default", () => {
  assert.equal(waitSeconds({ seconds: 3 }), 3);
  assert.equal(waitSeconds({ seconds: 60 }), 10);
  assert.equal(waitSeconds({ seconds: 0 }), 0.5);
  assert.equal(waitSeconds({}), 2);
  assert.equal(describeAgentAction({ action: "wait", seconds: 4 }), "Wait 4s for the screen to settle");
  assert.equal(describeAgentAction({ action: "key", key: "L", modifiers: ["CTRL"] }), "Press CTRL+L");
  assert.equal(describeAgentAction({ action: "scroll", amount: 300, x: 500, y: 600 }), "Scroll down at (500, 600)");
  assert.equal(describeAgentAction({ action: "click", x: 1, y: 2, double: true }), "Double-click left at (1, 2)");
});

// Stop on the pill or Ctrl+Shift+X made every next call fail with "Computer
// control is disabled", and the run was reported as failed with that text.
test("a stop from the desktop app is recognised; its errors read plainly", () => {
  assert.equal(isControlStopped(new Error("Error invoking remote method 'computer:screenshot': Error: Computer control is disabled.")), true);
  assert.equal(isControlStopped(new Error("Key not pressed")), false);
  assert.equal(actionErrorText(new Error("Error invoking remote method 'computer:key': Error: Key not pressed: Alt+F4 isn't allowed.")), "Key not pressed: Alt+F4 isn't allowed");
  assert.equal(retryableStatus(429), true);
  assert.equal(retryableStatus(503), true);
  assert.equal(retryableStatus(400), false);
  assert.equal(stepLabel({ reasoning: "Open the Start menu to find Notepad" }, "Press META"), "Open the Start menu to find Notepad");
  assert.equal(stepLabel({}, "Press META"), "Press META");
});
