// Marks the latest mobile assistant response with the model that actually handled it.
const MOBILE_BADGE_QUERY = window.matchMedia('(max-width: 768px)');

function currentDisplayedModel() {
  return document.querySelector('.chat-header')?.dataset?.activeModel
    || document.querySelector('.mode-pill-btn span')?.textContent?.trim()
    || 'Auto';
}

function latestAssistantMessage() {
  const messages = [...document.querySelectorAll('.msg.assistant')];
  return messages[messages.length - 1] || null;
}

function markLatestAssistant(label, force = false) {
  if (!MOBILE_BADGE_QUERY.matches || !label) return;
  const message = latestAssistantMessage();
  if (!message) return;
  if (!force && message.dataset.modelUsed) return;
  message.dataset.modelUsed = label;
}

window.addEventListener('vetroai:model-used', (event) => {
  const label = event?.detail?.label || event?.detail?.model || '';
  if (!label) return;
  // The empty assistant message is normally rendered before the research bridge
  // begins, but retry briefly so React scheduling can never hide the model badge.
  [0, 60, 180].forEach((delay) => window.setTimeout(() => markLatestAssistant(label, true), delay));
});

const responseObserver = new MutationObserver(() => {
  if (!MOBILE_BADGE_QUERY.matches) return;
  window.queueMicrotask(() => markLatestAssistant(currentDisplayedModel(), false));
});

function startModelBadgeObserver() {
  responseObserver.observe(document.body, { childList: true, subtree: true });
  markLatestAssistant(currentDisplayedModel(), false);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startModelBadgeObserver, { once: true });
} else {
  startModelBadgeObserver();
}
