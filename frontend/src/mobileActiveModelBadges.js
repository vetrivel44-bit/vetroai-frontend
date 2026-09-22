// Keeps every visible assistant response tied to the model selected when that
// response row first appears. This is deliberately DOM-level so it also covers
// streaming/pending rows without waiting for App.jsx to finish a response.

const VETRO_MARK_SRC = '/favicon.svg';
const VETRO_MARK_SVG = '<svg class="response-model-icon vetro-response-mark" role="img" viewBox="12 2 76 96" xmlns="http://www.w3.org/2000/svg">'
  + '<rect x="42" y="8" width="16" height="74" rx="8" fill="var(--ink)" transform="rotate(-24 50 82)"/>'
  + '<rect x="42" y="8" width="16" height="74" rx="8" fill="#146b80" transform="rotate(24 50 82)"/>'
  + '<circle cx="50" cy="79" r="6.5" fill="var(--bg)"/>'
  + '</svg>';

const MODEL_ICON_RULES = [
  [/^auto$|normal chat/i, '/favicon.svg'],
  [/^gpt-|openai|codex/i, '/model-icons/openai.svg'],
  [/claude/i, '/model-icons/claude.svg'],
  [/grok|xai/i, '/model-icons/grok.svg'],
  [/sonar|perplexity/i, '/model-icons/perplexity.svg'],
  [/gemini|google/i, '/model-icons/gemini.svg'],
  [/mistral/i, '/model-icons/mistral.svg'],
  [/sambanova/i, '/model-icons/sambanova.svg'],
  [/agnes|vetro/i, '/favicon.svg'],
];

function modelIconSrc(label = '') {
  return MODEL_ICON_RULES.find(([rx]) => rx.test(String(label)))?.[1] || '/favicon.svg';
}

function cleanModelLabel(value = '') {
  // The desktop pill can contain the effort badge too (e.g. "GPT-5.6 Sol Quick").
  return String(value).replace(/\s+(Quick|Balanced|Deep)\s*$/i, '').trim();
}

function currentDisplayedModel() {
  const headerModel = cleanModelLabel(document.querySelector('.chat-header')?.dataset?.activeModel || '');
  if (headerModel) return headerModel;

  const activeOption = document.querySelector('.ws-model-option.active .ws-model-copy strong')?.textContent?.trim();
  if (activeOption) return cleanModelLabel(activeOption);

  const picker = document.querySelector('.mode-pill-btn');
  const pickerModel = picker?.dataset?.model || picker?.querySelector('span')?.textContent || picker?.textContent || '';
  return cleanModelLabel(pickerModel) || 'Auto';
}

function assistantRows() {
  return [...document.querySelectorAll('.msg-row')];
}

function avatarForRow(row) {
  const messageLine = row?.parentElement;
  if (!messageLine) return null;

  // Current App.jsx: avatar wrapper is the sibling immediately before .msg-row.
  const previous = row.previousElementSibling;
  if (previous && previous !== row) return previous;

  return messageLine.querySelector('.provider-response-avatar, .msg-avatar, .avatar, .message-avatar, .assistant-avatar');
}

function renderProviderAvatar(avatarWrap, label) {
  if (!avatarWrap) return;
  const normalized = cleanModelLabel(label) || 'Auto';
  const iconSrc = modelIconSrc(normalized);
  const src = avatarWrap.dataset.iconFailed === iconSrc ? VETRO_MARK_SRC : iconSrc;

  avatarWrap.classList.add('provider-response-avatar');
  avatarWrap.dataset.responseModel = normalized;
  avatarWrap.title = `Response by ${normalized}`;
  avatarWrap.setAttribute('aria-label', `Response by ${normalized}`);

  let icon = avatarWrap.querySelector(':scope > .response-model-icon');

  // The VetroAI mark is drawn inline, like the sidebar logo, so its strokes
  // follow the theme and it sits on the page without the app icon's teal tile.
  if (src === VETRO_MARK_SRC) {
    if (!icon || icon.tagName.toLowerCase() !== 'svg') {
      const holder = document.createElement('div');
      holder.innerHTML = VETRO_MARK_SVG;
      icon = holder.firstElementChild;
      avatarWrap.replaceChildren(icon);
    }
    icon.setAttribute('aria-label', `${normalized} logo`);
    return;
  }

  if (!icon || icon.tagName.toLowerCase() !== 'img') {
    icon = document.createElement('img');
    icon.className = 'response-model-icon';
    icon.decoding = 'async';
    avatarWrap.replaceChildren(icon);
  }

  icon.alt = `${normalized} logo`;
  if (icon.getAttribute('src') !== src) icon.setAttribute('src', src);
  icon.onerror = () => {
    icon.onerror = null;
    avatarWrap.dataset.iconFailed = src;
    renderProviderAvatar(avatarWrap, normalized);
  };
}

function syncAssistantRow(row, fallbackLabel, force = false) {
  if (!row) return;
  let label = cleanModelLabel(fallbackLabel || currentDisplayedModel());
  if (!force && row.dataset.modelUsed) label = row.dataset.modelUsed;
  else row.dataset.modelUsed = label;
  renderProviderAvatar(avatarForRow(row), label);
}

function syncNewAssistantRows() {
  const selected = currentDisplayedModel();
  assistantRows().forEach((row) => syncAssistantRow(row, row.dataset.modelUsed || selected));
}

function markLatestAssistant(label, force = true) {
  const rows = assistantRows();
  const row = rows[rows.length - 1];
  if (row) syncAssistantRow(row, label || currentDisplayedModel(), force);
}

// Exact model-used events win over the selected-model fallback (important for Auto).
window.addEventListener('vetroai:model-used', (event) => {
  const label = event?.detail?.label || event?.detail?.model || '';
  if (!label) return;
  [0, 60, 180, 400, 900].forEach((delay) => {
    window.setTimeout(() => markLatestAssistant(label, true), delay);
  });
});

let syncQueued = false;
const responseObserver = new MutationObserver(() => {
  if (syncQueued) return;
  syncQueued = true;
  window.requestAnimationFrame(() => {
    syncQueued = false;
    syncNewAssistantRows();
  });
});

function startModelBadgeObserver() {
  responseObserver.observe(document.body, { childList: true, subtree: true });
  syncNewAssistantRows();

  // React streaming can recreate the hard-coded avatar without a useful model
  // event. A small safety sync makes the provider logo self-healing.
  window.setInterval(syncNewAssistantRows, 1000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startModelBadgeObserver, { once: true });
} else {
  startModelBadgeObserver();
}
