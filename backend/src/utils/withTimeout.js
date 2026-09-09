// Races a promise against a deadline, and — unlike a bare
// `Promise.race([work, new Promise(r => setTimeout(...))])` — clears the timer
// once the race settles.
//
// Losing a race does not cancel the loser. An uncleared guard keeps the Node
// event loop alive for the rest of its window after the work has already
// finished: an 8s search guard on a search that returned in 200ms holds the
// process for another 7.8s. On a serverless deploy that delays the function
// freeze on every request, and in tests it looks like a mysterious hang.
async function withTimeout(promise, ms, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { withTimeout };
