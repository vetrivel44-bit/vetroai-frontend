// The working-process timeline shown above an assistant answer.
//
// The backend streams `step` SSE events for each thing it actually does —
// analysing the request, a web search and the pages it read, the provider it
// called, one that failed and why. Each event carries a stable `id`, so a row
// is updated in place as it moves from running to done or failed rather than
// appended twice. These helpers own that merge so the reducer is testable
// without a live stream.

/**
 * Applies one incoming step event to the list, keeping first-seen order.
 * Returns the same array reference when the event carries nothing usable, so
 * callers can skip a re-render.
 */
export const mergeStep = (steps, step) => {
  if (!step || !step.id) return steps;
  const at = steps.findIndex((s) => s.id === step.id);
  if (at === -1) return [...steps, step];
  return steps.map((s, i) => (i === at ? { ...s, ...step } : s));
};

/**
 * Closes any row still marked running once the stream is over. A stream that
 * is aborted or dies mid-flight would otherwise leave a row spinning forever.
 */
export const settleSteps = (steps) => {
  if (!steps.some((s) => s.state === "running")) return steps;
  return steps.map((s) => (s.state === "running" ? { ...s, state: "done" } : s));
};
