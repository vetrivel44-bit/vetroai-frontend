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

module.exports = { withTimeout };
