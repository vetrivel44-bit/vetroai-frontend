// Keeps each mobile assistant response visually tied to the model that actually
// handled it. This replaces the static Vetro avatar inside assistant messages
// with the correct provider/model logo and stores the model label on the message.
const MOBILE_BADGE_QUERY = window.matchMedia('(max-width: 768px)');

const MODEL_ICON_RULES = [
  [/^auto$/i, '/logo.png'],
  [/^gpt-|openai|codex/i, '/model-icons/openai.svg'],
  [/claude/i, '/model-icons/claude.svg'],
  [/grok|xai/i, '/model-icons/grok.svg'],
  [/sonar|perplexity/i, '/model-icons/perplexity.svg'],
  [/gemini|google/i, '/model-icons/gemini.svg'],
  [/mistral/i, '/model-icons/mistral.svg'],
  [/sambanova/i, '/model-icons/sambanova.svg'],
];

function modelIconSrc(label = '') {
  return MODEL_ICON_RULES.find(([rx]) => rx.test(label))?.[1] || '/logo.png';
}

function currentDisplayedModel() {
  return document.querySelector('.chat-header')?.dataset?.activeModel
    || document.querySelector('.mode-pill-btn span')?.textContent?.trim()
    || 'Auto';
}

function latestAssistantMessage() {
  const messages = [...document.querySelectorAll('.msg.assistant')];
  return messages[messages.length - 1] || null;
}

function syncAssistantAvatar(message, label) {
  if (!message || !label) return;
  const avatar = message.querySelector('.msg-avatar, .avatar, .message-avatar, .assistant-avatar');
  if (!avatar) return;

  avatar.dataset.responseModel = label;
  avatar.setAttribute('title', `Response by ${label}`);
  avatar.setAttribute('aria-label', `Response by ${label}`);

  let icon = avatar.querySelector('.response-model-icon');
  if (!icon) {
    icon = document.createElement('img');
    icon.className = 'response-model-icon';
    icon.alt = '';
    icon.setAttribute('aria-hidden', 'true');
    avatar.replaceChildren(icon);
  }
  const src = modelIconSrc(label);
  if (icon.getAttribute('src') !== src) icon.src = src;
}

function markLatestAssistant(label, force = false) {
  if (!MOBILE_BADGE_QUERY.matches || !label) return;
  const message = latestAssistantMessage();
  if (!message) return;
  if (!force && message.dataset.modelUsed) {
    syncAssistantAvatar(message, message.dataset.modelUsed);
    return;
  }
  message.dataset.modelUsed = label;
  syncAssistantAvatar(message, label);
}

function syncAllMarkedMessages() {
  if (!MOBILE_BADGE_QUERY.matches) return;
  document.querySelectorAll('.msg.assistant[data-model-used]').forEach((message) => {
    syncAssistantAvatar(message, message.dataset.modelUsed);
  });
}

window.addEventListener('vetroai:model-used', (event) => {
  const label = event?.detail?.label || event?.detail?.model || '';
  if (!label) return;
  // React may mount the assistant row just after the provider event. Retry so
  // the exact response row gets the provider logo even during fast streaming.
  [0, 60, 180, 400].forEach((delay) => window.setTimeout(() => markLatestAssistant(label, true), delay));
});

const responseObserver = new MutationObserver(() => {
  if (!MOBILE_BADGE_QUERY.matches) return;
  window.queueMicrotask(() => {
    markLatestAssistant(currentDisplayedModel(), false);
    syncAllMarkedMessages();
  });
});

function startModelBadgeObserver() {
  responseObserver.observe(document.body, { childList: true, subtree: true });
  markLatestAssistant(currentDisplayedModel(), false);
  syncAllMarkedMessages();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startModelBadgeObserver, { once: true });
} else {
  startModelBadgeObserver();
}
