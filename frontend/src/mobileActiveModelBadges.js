// Keeps every visible assistant response tied to the model selected when that
// response row first appears. Works with the current App.jsx feed structure on
// both desktop and mobile (the old implementation targeted legacy .msg.assistant
// markup, so it never found the actual avatar).

const MODEL_ICON_RULES = [
  [/^auto$|normal chat/i, '/logo.png'],
  [/^gpt-|openai|codex/i, '/model-icons/openai.svg'],
  [/claude/i, '/model-icons/claude.svg'],
  [/grok|xai/i, '/model-icons/grok.svg'],
  [/sonar|perplexity/i, '/model-icons/perplexity.svg'],
  [/gemini|google/i, '/model-icons/gemini.svg'],
  [/mistral/i, '/model-icons/mistral.svg'],
  [/sambanova/i, '/model-icons/sambanova.svg'],
  [/agnes|vetro/i, '/logo.png'],
];

function modelIconSrc(label = '') {
  return MODEL_ICON_RULES.find(([rx]) => rx.test(String(label)))?.[1] || '/logo.png';
}

function currentDisplayedModel() {
  const headerModel = document.querySelector('.chat-header')?.dataset?.activeModel?.trim();
  if (headerModel) return headerModel;

  const pickerModel = document.querySelector('.mode-pill-btn span')?.textContent?.trim();
  if (pickerModel) return pickerModel;

  const activeOption = document.querySelector('.ws-model-option.active .ws-model-copy strong')?.textContent?.trim();
  return activeOption || 'Auto';
}

function assistantRows() {
  // Current App.jsx renders each assistant body as .msg-row. Its avatar wrapper
  // is the immediately preceding sibling inside the same flex message row.
  return [...document.querySelectorAll('.msg-row')];
}

function avatarForRow(row) {
  const messageLine = row?.parentElement;
  if (!messageLine) return null;
  const candidate = row.previousElementSibling;
  if (candidate && candidate !== row) return candidate;
  return messageLine.querySelector('.msg-avatar, .avatar, .message-avatar, .assistant-avatar');
}

function syncAssistantRow(row, label, force = false) {
  if (!row || !label) return;
  if (!force && row.dataset.modelUsed) label = row.dataset.modelUsed;
  else row.dataset.modelUsed = label;

  const avatarWrap = avatarForRow(row);
  if (!avatarWrap) return;

  avatarWrap.classList.add('provider-response-avatar');
  avatarWrap.dataset.responseModel = label;
  avatarWrap.title = `Response by ${label}`;
  avatarWrap.setAttribute('aria-label', `Response by ${label}`);

  // Replace the hard-coded VetroSparkWhite avatar rendered by App.jsx.
  let icon = avatarWrap.querySelector('.response-model-icon');
  if (!icon) {
    icon = document.createElement('img');
    icon.className = 'response-model-icon';
    icon.alt = `${label} logo`;
    icon.decoding = 'async';
    avatarWrap.replaceChildren(icon);
  }

  const src = modelIconSrc(label);
  if (icon.getAttribute('src') !== src) icon.src = src;
  icon.onerror = () => {
    if (!icon.src.endsWith('/logo.png')) icon.src = '/logo.png';
  };
}

function syncNewAssistantRows() {
  const label = currentDisplayedModel();
  assistantRows().forEach((row) => syncAssistantRow(row, row.dataset.modelUsed || label));
}

function markLatestAssistant(label, force = true) {
  const rows = assistantRows();
  const row = rows[rows.length - 1];
  if (row) syncAssistantRow(row, label || currentDisplayedModel(), force);
}

// If another integration reports the exact model actually used, prefer it for
// the newest response (important for Auto/routing and Puter models).
window.addEventListener('vetroai:model-used', (event) => {
  const label = event?.detail?.label || event?.detail?.model || '';
  if (!label) return;
  [0, 60, 180, 400].forEach((delay) => {
    window.setTimeout(() => markLatestAssistant(label, true), delay);
  });
});

const responseObserver = new MutationObserver(() => {
  window.queueMicrotask(syncNewAssistantRows);
});

function startModelBadgeObserver() {
  responseObserver.observe(document.body, { childList: true, subtree: true });
  syncNewAssistantRows();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startModelBadgeObserver, { once: true });
} else {
  startModelBadgeObserver();
}
