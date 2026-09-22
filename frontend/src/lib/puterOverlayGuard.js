// Puter's SDK (js.puter.com) pops its own "Low Balance" / paywall dialog
// straight into the page — outside React, outside our styling — the moment
// a browser-model call runs out of credits. When that dialog's own "Close"
// doesn't fully clean up after itself, its backdrop can be left behind,
// blacking out the whole app with nothing left clickable.
//
// This watches document.body for that dialog appearing (by its own
// giveaway text/markup — we don't touch anything else, including our own
// full-screen overlays like the mobile model picker), and if the dialog
// card disappears while sibling nodes it arrived with are still stuck in
// the DOM, removes them and restores page scroll.
const MARKER_RE = /puter-chat-completion|low balance|out of (credits|funds)/i;

const looksLikePuterDialog = (node) => {
  if (!(node instanceof Element)) return false;
  if (node.querySelector('iframe[src*="puter.com"]')) return true;
  const text = node.textContent || "";
  return text.length < 4000 && MARKER_RE.test(text);
};

export function installPuterOverlayGuard() {
  if (typeof document === "undefined") return;

  let trackedGroup = null;
  let pollId = null;

  const stopTracking = () => {
    if (pollId) { clearInterval(pollId); pollId = null; }
    trackedGroup = null;
  };

  const sweep = () => {
    if (!trackedGroup) return;
    const stillHasDialog = trackedGroup.some(
      (node) => document.body.contains(node) && looksLikePuterDialog(node)
    );
    if (stillHasDialog) return;
    // The dialog itself is gone but some of the nodes it arrived with are
    // still in the DOM — that's the stuck black backdrop. Remove them and
    // undo whatever the SDK left on <body>/<html>.
    let removedAny = false;
    trackedGroup.forEach((node) => {
      if (document.body.contains(node)) {
        node.remove();
        removedAny = true;
      }
    });
    if (removedAny) {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    }
    stopTracking();
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.target !== document.body) continue;
      const added = Array.from(mutation.addedNodes).filter((n) => n instanceof Element);
      if (added.length === 0) continue;
      const dialogNode = added.find(looksLikePuterDialog);
      if (dialogNode && !trackedGroup) {
        // Track every element node added to body in this same mutation
        // batch — the dialog card and whatever backdrop arrived with it.
        trackedGroup = added;
        pollId = setInterval(sweep, 400);
        // A well-behaved close needs no cleanup here — stop watching after
        // a while so a normal close doesn't leave a timer running forever.
        setTimeout(() => { if (trackedGroup === added) stopTracking(); }, 30000);
      }
    }
  });

  observer.observe(document.body, { childList: true });
}
