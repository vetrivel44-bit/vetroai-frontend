// Resolves or rejects like `promise`, or rejects with `message` after `ms`.
// Unlike a bare Promise.race against setTimeout, the timer is cleared once
// the promise settles, so a finished request leaves nothing running.
function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// For a streamed reply: a signal that gives up only if the reply hasn't
// started within `ms`. Call started() once the response headers arrive and
// the stream may then run as long as it needs (the orchestrator's idle
// watchdog still catches one that goes silent). AbortSignal.timeout() on a
// streaming fetch also aborts the body, which cut long answers off mid-way.
function startTimeout(ms, message = `No reply within ${ms / 1000}s`) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(message)), ms);
  return { signal: controller.signal, started: () => clearTimeout(timer) };
}

module.exports = { withTimeout, startTimeout };
