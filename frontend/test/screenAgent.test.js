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
