// The parts of Computer's screen-control loop (ComputerUI runComputerAgent)
// that decide where a click goes, whether it did anything, and whether the
// task is really finished.
//
// The model used to give pixel positions on a downscaled screenshot, was never
// told when a click changed nothing, and any "done" (even running out of
// steps) was reported as a completed task. Now it points on a 0-1000 grid,
// the format vision models like Gemini are trained to point in; every action
// is checked against the next screenshot; repeating a click that does nothing
// stops the run; and "done" counts only when the model says it succeeded and
// says so again on a fresh screenshot.

/** Model coordinates run from 0 to GRID across the screenshot, in both directions. */
export const GRID = 1000;

/**
 * How the step prompt explains coordinates to the model. It wins over the
 * server's own prompt, which a server not yet updated may still say pixels in.
 */
export const GRID_INSTRUCTIONS = `Coordinates are on a 0-${GRID} grid over the screenshot, not pixels, whatever else you were told about them: x = 0 is its left edge and x = ${GRID} its right edge; y = 0 is its top and y = ${GRID} its bottom. Point at the centre of what you want to click.`;

/**
 * Added to the step prompt when the desktop app can open apps itself
 * (1.2.0 on): one sure step instead of Start, typing a name and Enter, which
 * went wrong when the search box opened on another tab or a letter was lost.
 */
export const OPEN_INSTRUCTIONS = `One more action is allowed here, whatever else you were told about the list of actions: {"action": "open", "app": "Google Chrome"} opens an installed app by its name, and {"action": "open", "url": "https://example.com"} opens a web address in the default browser. To open an app or a website, always use "open" first; do not press META and type its name unless "open" failed. After "open", the next screenshot shows the app; use "wait" if it is still loading.`;

/**
 * Has the model say, with each action, what the screen should show if it
 * worked. The next step holds it to that (checkLastAction), so a click that
 * missed or text typed into the wrong place is caught and put right, instead
 * of the run carrying on as if it had worked.
 */
export const EXPECT_INSTRUCTIONS = `Add "expect" to every action except "done": one short sentence saying what the next screenshot will show if the action worked (for example "the address bar shows youtube.com", "the Save dialog is open", "the message box contains Hello").`;

/** How typing works, for the step prompt. */
export const TYPE_INSTRUCTIONS = `Typing: "type" adds text where the cursor is, after any text already there. Add "clear": true to replace what the field holds instead; use it whenever a field might already have text in it, and always when typing something again. In a browser, CTRL+L selects the whole address bar, so typing after it replaces the address. In Calculator and other number fields, type * to multiply and / to divide, never × or ÷ or the letter x.`;

// A sum to work out, like "245 × 18 =" or "12.5 x 4": digits and operators only.
const SUM = /^[\d\s.,()+\-*/×÷xX=%^]+$/;

/**
 * A "type" action made safe to carry out. A sum's × and ÷ (and an x between
 * numbers) become * and /: those are the keys that multiply and divide, and
 * text with × in it was pasted, and Calculator threw the × away, so
 * 245 × 18 came out as 24518. Typing text again that one of the last few
 * actions typed replaces the field's text instead of adding to it: a retry
 * put "weather in chennai" in Chrome's address bar three times over.
 * `recent`: the last actions carried out, oldest first.
 */
export function prepareTypeAction(action, recent = []) {
  if (action?.action !== "type") return action;
  let text = String(action.text ?? "");
  if (SUM.test(text) && /\d/.test(text)) {
    text = text.replace(/×/g, "*").replace(/÷/g, "/").replace(/(\d)\s*[xX]\s*(?=\d)/g, "$1*");
  }
  const retyping = (recent || []).slice(-4).some((a) => a?.action === "type" && String(a.text ?? "").trim() === text.trim());
  const clear = action.clear === true || action.clear === "true" || retyping;
  return { ...action, text, ...(clear ? { clear: true } : {}) };
}

/**
 * The step prompt's check of the last action: what the model expected, and
 * whether the screen changed at all. Empty when there is nothing to check.
 */
export function checkLastAction(last) {
  if (!last) return "";
  const expected = String(last.expect || "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!expected && last.changed !== false) return "";
  return [
    "CHECK YOUR LAST ACTION FIRST, before choosing the next one.",
    expected ? `You expected: "${expected}". Look for exactly that in this screenshot.` : "",
    last.changed === false ? "The screen is the same as before that action, so it had no effect." : "",
    "If the screenshot does not show what you expected, the action did not work: do not carry on as if it had. Put it right first: to fix text in a field, use \"type\" with \"clear\": true, which replaces what the field holds (typing again without it adds to the text that is already there), wait if the app is still loading, press ESCAPE to close something that opened by mistake, or do it another way. Say in \"reasoning\" what you saw.",
  ].filter(Boolean).join(" ");
}

const POINT_KEYS = [["x", "y"], ["fromX", "fromY"], ["toX", "toY"]];

/**
 * The action with its grid coordinates turned into pixels of the image the
 * model saw (`width` x `height`). A value past the grid can only be a pixel
 * position (a model ignoring the grid): it is then taken as one.
 */
export function gridToPixels(action, width, height) {
  const out = { ...action };
  const pixels = POINT_KEYS.some(([kx, ky]) => Number(action[kx]) > GRID || Number(action[ky]) > GRID);
  for (const [kx, ky] of POINT_KEYS) {
    if (typeof action[kx] !== "number" || typeof action[ky] !== "number") continue;
    if (pixels) {
      out[kx] = Math.max(0, Math.min(width - 1, Math.round(action[kx])));
      out[ky] = Math.max(0, Math.min(height - 1, Math.round(action[ky])));
    } else {
      out[kx] = Math.round((Math.max(0, Math.min(GRID, action[kx])) / GRID) * (width - 1));
      out[ky] = Math.round((Math.max(0, Math.min(GRID, action[ky])) / GRID) * (height - 1));
    }
  }
  return out;
}

/**
 * Size of the grayscale copy of each screenshot that the next one is compared
 * with. Large enough that a ticked check box or one typed letter still shows.
 */
export const THUMB = { width: 640, height: 360 };

/**
 * How many pixels of two same-size grayscale copies (arrays of 0-255) differ
 * by more than `tolerance`. Copies that can't be compared count as all changed.
 */
export function changedPixels(a, b, tolerance = 10) {
  if (!a || !b || a.length !== b.length || !a.length) return Infinity;
  let changed = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > tolerance) changed++;
  return changed;
}

/**
 * At most this many changed pixels and the screen counts as unchanged. The
 * same screen gives 0; a ticked check box, a focus ring or one typed letter
 * give more. Set this low on purpose: when the model is told that nothing
 * changed, that has to be true, or it would give up on a click that worked.
 */
export const UNCHANGED_AT_MOST = 4;

/** Grayscale copy of RGBA pixel data, for changedPixels. */
export function grayscale(rgba) {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
  return out;
}

/** What makes two actions "the same thing again" (coordinates within a small radius). */
function sameAction(a, b) {
  if (!a || !b || a.action !== b.action) return false;
  const near = (k) => Math.abs((Number(a[k]) || 0) - (Number(b[k]) || 0)) <= 15;
  return near("x") && near("y") && String(a.text ?? "") === String(b.text ?? "") && String(a.key ?? "") === String(b.key ?? "");
}

/**
 * Whether the run is stuck: the last `times` actions were the same action at
 * (about) the same place, and none of them changed the screen.
 * `history`: [{ action (in grid coordinates), changed: boolean | null }].
 */
export function isStuck(history, times = 3) {
  if (!history || history.length < times) return false;
  const last = history.slice(-times);
  return last.every((h) => h.changed === false && sameAction(h.action, last[0].action));
}

/**
 * What a "done" reply means: "success" when the model says the goal is
 * reached (or, from an older reply, doesn't say either way), "failure" when it
 * says it couldn't or shouldn't go on.
 */
export function doneVerdict(action) {
  return action?.success === false || action?.success === "false" ? "failure" : "success";
}

/** The line the step prompt adds after the model has said it's finished, to have it check. */
export const CONFIRM_PROMPT = "You said the goal is reached. This is a fresh screenshot taken after a short pause. Reply done with success true only if this screenshot itself shows the goal achieved, and say what on the screen shows it. If it doesn't, carry on with the next action, or reply done with success false and say what is in the way.";

/**
 * The run's reply, outcome first (it is what the phone shows for a Dispatch
 * task), then the steps it took.
 * outcome: "done" | "failed" | "stopped".
 */
export function finalMessage({ outcome, summary = "", steps = [] }) {
  const head = outcome === "done" ? `**Done:** ${summary || "the goal is reached."}`
    : outcome === "stopped" ? `**Stopped.** ${summary}`.trim()
    : `**Couldn't finish:** ${summary || "the task wasn't completed."}`;
  if (!steps.length) return head;
  const shown = steps.slice(-25);
  const skipped = steps.length - shown.length;
  return `${head}\n\n**Steps**\n${skipped ? `_(${skipped} earlier step${skipped > 1 ? "s" : ""} not shown)_\n` : ""}${shown.map((s, i) => `${skipped + i + 1}. ${s}`).join("\n")}`;
}

/** A short line for each action, in the model's own (grid) coordinates. */
export function describeAgentAction(action) {
  const at = (x, y) => `(${Math.round(x)}, ${Math.round(y)})`;
  switch (action.action) {
    case "click": return `${action.double ? "Double-click" : "Click"} ${action.button || "left"} at ${at(action.x, action.y)}`;
    case "move": return `Move to ${at(action.x, action.y)}`;
    case "type": return `${action.clear ? "Replace the text with" : "Type"} "${String(action.text || "").slice(0, 40)}"`;
    case "key": return `Press ${[...(action.modifiers || []), action.key].join("+")}`;
    case "scroll": return `Scroll ${Number(action.amount) > 0 ? "down" : "up"}${typeof action.x === "number" && typeof action.y === "number" ? ` at ${at(action.x, action.y)}` : ""}`;
    case "drag": return `Drag from ${at(action.fromX, action.fromY)} to ${at(action.toX, action.toY)}`;
    case "copy": return "Copy to clipboard";
    case "paste": return action.text ? `Paste "${String(action.text).slice(0, 40)}"` : "Paste from clipboard";
    case "open": return `Open ${String(action.url || action.app || "").slice(0, 80)}`;
    case "wait": return `Wait ${waitSeconds(action)}s for the screen to settle`;
    case "done": return action.summary || "Done";
    default: return `Unrecognized action: ${action.action}`;
  }
}

/** How long a "wait" action waits: 0.5 to 10 seconds, 2 by default. */
export function waitSeconds(action) {
  const s = Number(action?.seconds);
  return Number.isFinite(s) ? Math.max(0.5, Math.min(10, Math.round(s * 10) / 10)) : 2;
}

/**
 * A "key" action as the desktop app takes it. Only CTRL/SHIFT/ALT are held,
 * and META (Start) is pressed alone: "META + CTRL+SHIFT" or "ENTER + META"
 * fire stray shortcuts instead of opening the Start menu.
 */
export function normalizeKeyAction(action) {
  if (action?.action !== "key") return action;
  const [key, ...inKey] = String(action.key || "").split("+").map((p) => p.trim()).filter(Boolean).reverse();
  const name = String(key || action.key || "").toUpperCase();
  const mods = [...inKey.reverse(), ...(Array.isArray(action.modifiers) ? action.modifiers : [])]
    .map((m) => String(m).toUpperCase()).map((m) => (m === "CONTROL" ? "CTRL" : m))
    .filter((m, i, all) => ["CTRL", "SHIFT", "ALT"].includes(m) && all.indexOf(m) === i);
  return { ...action, key: name, modifiers: ["META", "WIN", "CMD", "SUPER", "START"].includes(name) ? [] : mods };
}

/**
 * Carries out one action on the desktop app (`desktop` = window.vetroDesktop).
 * Coordinates are already real screenshot pixels. "wait" only waits.
 */
export async function performDesktopAction(desktop, action, { sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  switch (action.action) {
    case "move": return desktop.moveMouse(Number(action.x), Number(action.y), action.duration);
    case "click":
      // From 1.2.0 the app moves and clicks as one action, so a mouse moved
      // by hand in between can't send the click somewhere else.
      if (desktop.version && desktop.version >= "1.2.0") return desktop.click(action.button || "left", Boolean(action.double), Number(action.x), Number(action.y));
      await desktop.moveMouse(Number(action.x), Number(action.y), 150);
      return desktop.click(action.button || "left", Boolean(action.double));
    case "type":
      // Select what the field holds first, so the text replaces it.
      if (action.clear) {
        await desktop.pressKey("A", ["CTRL"]);
        await sleep(80);
      }
      return desktop.typeText(String(action.text || "").slice(0, 2000));
    case "key": return desktop.pressKey(action.key, action.modifiers || []);
    case "scroll": {
      const amount = Number(action.amount) || 0;
      const at = typeof action.x === "number" && typeof action.y === "number";
      // An older desktop app scrolls wherever the cursor is: point it first.
      if (at && desktop.version && desktop.version < "1.1.0") await desktop.moveMouse(action.x, action.y, 120);
      return at ? desktop.scroll(amount, action.x, action.y) : desktop.scroll(amount);
    }
    case "drag": return desktop.drag(Number(action.fromX), Number(action.fromY), Number(action.toX), Number(action.toY), action.duration);
    case "copy": {
      if (desktop.copy) return desktop.copy();
      await desktop.pressKey("C", ["CTRL"]);
      await sleep(150);
      return desktop.readClipboard();
    }
    case "paste": {
      if (desktop.paste) return desktop.paste(action.text ? String(action.text) : "");
      if (action.text) await desktop.writeClipboard(String(action.text));
      return desktop.pressKey("V", ["CTRL"]);
    }
    case "open": {
      if (!desktop.openApp) throw new Error("this computer's VetroAI can't open apps directly: press META, type the app's name, then press ENTER");
      const result = await desktop.openApp(String(action.app || ""), String(action.url || ""));
      // The window takes a moment to appear; the next screenshot should show it.
      await sleep(1800);
      return result;
    }
    case "wait": return sleep(waitSeconds(action) * 1000);
    default: throw new Error(`"${action.action}" isn't an action VetroAI can take`);
  }
}

/** Added to an action's line in the log when the person moved the mouse during it. */
export const USER_MOVED_NOTE = " — the person at the computer moved the mouse meanwhile and may have changed what is on screen: go by this screenshot, not by what you expected";

/** The desktop app refused because control was turned off (Stop, Ctrl+Shift+X). */
export const isControlStopped = (error) => /computer control is disabled/i.test(String(error?.message || error || ""));

/** The useful part of an error from the desktop app ("Error invoking remote method 'computer:key': Error: …"). */
export const actionErrorText = (error) => String(error?.message || error || "it failed").replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, "").replace(/\.$/, "");

/** Actions in a row that may fail (the model is told why) before the run stops. */
export const MAX_ACTION_ERRORS = 3;

/** A step request worth trying again: busy, rate limited, or the network blinked. */
export const retryableStatus = (status) => status === 408 || status === 429 || status === 502 || status === 503 || status === 504;
export const STEP_RETRY_DELAYS_MS = [1500, 3000, 6000];

/** What the pill on the screen says for an action: the model's own reason, or the action. */
export function stepLabel(action, description) {
  const reason = String(action?.reasoning || "").replace(/\s+/g, " ").trim();
  return (reason || description || "").slice(0, 80);
}
