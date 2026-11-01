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
