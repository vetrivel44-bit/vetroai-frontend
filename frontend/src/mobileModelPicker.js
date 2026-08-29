// Mobile-only model selector experience.
// The React WorkspacePopup remains the source of truth; this module renders a
// separate mobile screen and forwards choices to the real React controls.

const MOBILE_MODEL_QUERY = window.matchMedia('(max-width: 768px)');

const MODEL_TASKS = {
  writing: new Set(['Auto', 'GPT-5.6 Sol', 'GPT-5.6 Terra', 'GPT-5.6 Luna', 'Claude Fable 5', 'Mistral', 'Agnes']),
  research: new Set(['GPT-5.6 Sol', 'Claude Fable 5', 'Grok 4.6', 'Sonar Pro Research', 'Gemini']),
  coding: new Set(['GPT-5.6 Sol', 'GPT-5.3 Codex', 'Claude Fable 5', 'Grok 4.6', 'Gemini']),
};

// Single source of truth for provider/model branding on mobile. Never fall back
// to unrelated Lucide action icons (the old Mistral briefcase regression).
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
const modelIconSrc = (label = '') => MODEL_ICON_RULES.find(([rx]) => rx.test(label))?.[1] || '/logo.png';
const makeModelIcon = (label, extraClass = '') => {
  const img = document.createElement('img');
  img.src = modelIconSrc(label);
  img.alt = '';
  img.setAttribute('aria-hidden', 'true');
  img.className = `vetro-model-brand-icon ${extraClass}`.trim();
  return img;
};

let activeTask = 'all';
let searchTerm = '';
let lastActualModel = '';
let sourcePopup = null;
let modelScreen = null;

const modelNameFromOption = (option) => option?.querySelector('.ws-model-copy strong')?.textContent?.trim() || '';
const modelDetailFromOption = (option) => option?.querySelector('.ws-model-copy small')?.textContent?.trim() || '';
const activeModelOption = () => sourcePopup?.querySelector('.ws-model-option.active') || sourcePopup?.querySelector('.ws-model-option');

function setHeaderModel(label) {
  if (!label || !MOBILE_MODEL_QUERY.matches) return;
  const header = document.querySelector('.chat-header');
  if (!header) return;
  header.dataset.activeModel = label;
  header.title = `Active model: ${label}`;
  header.style.setProperty('--vetro-model-icon', `url("${modelIconSrc(label)}")`);

  // Replace any accidental action/default icon inside the visible model badge.
  const badge = header.querySelector('.mode-pill-btn, .mobile-active-model-chip');
  if (badge) {
    badge.dataset.model = label;
    const stale = badge.querySelector('.vetro-header-model-icon');
    if (stale) stale.remove();
    const icon = makeModelIcon(label, 'vetro-header-model-icon');
    badge.prepend(icon);
  }
}

function syncHeaderModel() {
  if (!MOBILE_MODEL_QUERY.matches) return;
  if (lastActualModel) {
    setHeaderModel(lastActualModel);
    return;
  }
  const selected = document.querySelector('.mode-pill-btn span')?.textContent?.trim();
  if (selected) setHeaderModel(selected);
}

function cloneModelIcon(option) {
  const name = modelNameFromOption(option) || 'Auto';
  return makeModelIcon(name, 'mobile-model-row-icon');
}

function syncSelectedModel() {
  if (!modelScreen || !sourcePopup) return;
  const active = activeModelOption();
  if (!active) return;

  const name = modelNameFromOption(active) || 'Auto';
  const detail = modelDetailFromOption(active) || 'Smart routing';
  const card = modelScreen.querySelector('.mobile-model-selected-card');
  if (card) {
    const icon = card.querySelector('.mobile-selected-icon');
    icon?.replaceChildren(cloneModelIcon(active));
    const nameNode = card.querySelector('.mobile-selected-name');
    const detailNode = card.querySelector('.mobile-selected-detail');
    if (nameNode) nameNode.textContent = name;
    if (detailNode) detailNode.textContent = detail;
  }

  modelScreen.querySelectorAll('.mobile-model-row').forEach((row) => {
    row.classList.toggle('active', row.dataset.model === name);
  });
  syncAdvancedChoices();
}

function applyFilters() {
  if (!modelScreen) return;
  const query = searchTerm.trim().toLowerCase();
  const rows = [...modelScreen.querySelectorAll('.mobile-model-row')];

  rows.forEach((row) => {
    const name = row.dataset.model || '';
    const text = row.textContent.toLowerCase();
    const searchMatch = !query || text.includes(query);
    const taskMatch = activeTask === 'all' || MODEL_TASKS[activeTask]?.has(name);
    row.hidden = !(searchMatch && taskMatch);
  });

  const empty = modelScreen.querySelector('.mobile-model-empty');
  if (empty) empty.hidden = rows.some((row) => !row.hidden);
}

function createModelRow(option) {
  const name = modelNameFromOption(option);
  const detail = modelDetailFromOption(option);
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'mobile-model-row';
  row.dataset.model = name;

  row.appendChild(cloneModelIcon(option));
  const copy = document.createElement('span');
  copy.className = 'mobile-model-row-copy';
  const strong = document.createElement('strong');
  strong.textContent = name;
  const small = document.createElement('small');
  small.textContent = detail;
  copy.append(strong, small);
  row.appendChild(copy);

  const check = document.createElement('span');
  check.className = 'mobile-model-row-check';
  check.textContent = '✓';
  row.appendChild(check);

  row.addEventListener('click', () => {
    lastActualModel = '';
    const liveOption = [...sourcePopup.querySelectorAll('.ws-model-option')]
      .find((candidate) => modelNameFromOption(candidate) === name);
    liveOption?.click();
    window.setTimeout(() => {
      syncSelectedModel();
      setHeaderModel(name);
    }, 50);
  });
  return row;
}

function createFilterBar() {
  const wrap = document.createElement('div');
  wrap.className = 'mobile-model-filter-wrap';
  wrap.innerHTML = '<span class="mobile-model-filter-label">GOOD FOR</span>';

  const filters = document.createElement('div');
  filters.className = 'mobile-model-filters';
  [['all', 'Any task'], ['writing', 'Writing'], ['research', 'Research'], ['coding', 'Coding']].forEach(([task, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.task = task;
    button.textContent = label;
    button.classList.toggle('active', task === activeTask);
    button.addEventListener('click', () => {
      activeTask = task;
      filters.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
      applyFilters();
    });
    filters.appendChild(button);
  });
  wrap.appendChild(filters);
  return wrap;
}

function buildAdvancedGroup(title, sourceSelector, rowClass) {
  const section = document.createElement('section');
  section.className = 'mobile-model-advanced-section';
  const heading = document.createElement('div');
  heading.className = 'mobile-model-kicker';
  heading.textContent = title;
  section.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = `mobile-model-advanced-grid ${rowClass}`;
  [...sourcePopup.querySelectorAll(sourceSelector)].forEach((sourceButton, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.sourceIndex = String(index);
    button.textContent = sourceButton.querySelector('strong')?.textContent?.trim() || sourceButton.querySelector('.ws-mode-name')?.textContent?.trim() || sourceButton.textContent?.trim() || `Option ${index + 1}`;
    button.classList.toggle('active', sourceButton.classList.contains('active'));
    button.addEventListener('click', () => {
      const liveButtons = [...sourcePopup.querySelectorAll(sourceSelector)];
      liveButtons[index]?.click();
      window.setTimeout(syncAdvancedChoices, 40);
    });
    grid.appendChild(button);
  });
  section.appendChild(grid);
  return section;
}

function syncAdvancedChoices() {
  if (!modelScreen || !sourcePopup) return;
  const mappings = [
    ['.ws-effort-option', '.mobile-effort-grid button'],
    ['.ws-mode-card', '.mobile-mode-grid button'],
  ];
  mappings.forEach(([sourceSelector, portalSelector]) => {
    const sourceButtons = [...sourcePopup.querySelectorAll(sourceSelector)];
    const portalButtons = [...modelScreen.querySelectorAll(portalSelector)];
    portalButtons.forEach((button, index) => {
      button.classList.toggle('active', sourceButtons[index]?.classList.contains('active'));
    });
  });
}

function closeModelScreen({ closeSource = false } = {}) {
  if (closeSource && sourcePopup?.isConnected) sourcePopup.querySelector('.ws-popup-close')?.click();
  modelScreen?.remove();
  modelScreen = null;
  document.documentElement.classList.remove('mobile-model-screen-open');
  if (sourcePopup?.isConnected) sourcePopup.classList.remove('mobile-model-source-hidden');
  if (!sourcePopup?.isConnected) sourcePopup = null;
}

function openModelScreen(popup) {
  if (!MOBILE_MODEL_QUERY.matches || !popup || modelScreen) return;
  sourcePopup = popup;
  sourcePopup.classList.add('mobile-model-source-hidden');
  document.documentElement.classList.add('mobile-model-screen-open');

  const screen = document.createElement('div');
  screen.className = 'mobile-model-screen';
  screen.innerHTML = `
    <div class="mobile-model-screen-header">
      <div class="mobile-model-screen-heading">
        <strong>Choose your chat model</strong>
        <span>One model per chat</span>
      </div>
      <button type="button" class="mobile-model-screen-close" aria-label="Close model selector">×</button>
    </div>
    <div class="mobile-model-screen-scroll">
      <label class="mobile-model-search">
        <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>
        <input type="search" autocomplete="off" spellcheck="false" placeholder="Search VetroAI models…" aria-label="Search models" />
      </label>
      <div class="mobile-filter-slot"></div>
      <section class="mobile-model-selected">
        <div class="mobile-model-kicker">SELECTED MODEL</div>
        <div class="mobile-model-selected-card">
          <div class="mobile-selected-icon"></div>
          <div class="mobile-selected-copy"><strong class="mobile-selected-name">Auto</strong><small class="mobile-selected-detail">Smart routing</small></div>
          <span class="mobile-selected-check">✓</span>
        </div>
      </section>
      <section class="mobile-model-library">
        <div class="mobile-model-kicker">AVAILABLE MODELS</div>
        <div class="mobile-model-list"></div>
        <div class="mobile-model-empty" hidden>No models match this search.</div>
      </section>
      <details class="mobile-model-advanced">
        <summary>Response settings <span>Effort & mode</span></summary>
        <div class="mobile-model-advanced-body"></div>
      </details>
    </div>
    <div class="mobile-model-picker-footer">
      <button type="button" class="mobile-default-model-btn">☆ Default model</button>
      <button type="button" class="mobile-use-model-btn">Use this model <span>→</span></button>
    </div>`;

  modelScreen = screen;
  document.body.appendChild(screen);

  const input = screen.querySelector('.mobile-model-search input');
  input.value = searchTerm;
  input.addEventListener('input', () => {
    searchTerm = input.value;
    applyFilters();
  });

  screen.querySelector('.mobile-filter-slot').replaceWith(createFilterBar());

  const list = screen.querySelector('.mobile-model-list');
  [...sourcePopup.querySelectorAll('.ws-model-option')].forEach((option) => list.appendChild(createModelRow(option)));

  const advancedBody = screen.querySelector('.mobile-model-advanced-body');
  if (sourcePopup.querySelector('.ws-effort-option')) advancedBody.appendChild(buildAdvancedGroup('EFFORT', '.ws-effort-option', 'mobile-effort-grid'));
  if (sourcePopup.querySelector('.ws-mode-card')) advancedBody.appendChild(buildAdvancedGroup('MODE', '.ws-mode-card', 'mobile-mode-grid'));

  screen.querySelector('.mobile-model-screen-close').addEventListener('click', () => closeModelScreen({ closeSource: true }));
  screen.querySelector('.mobile-default-model-btn').addEventListener('click', () => {
    const auto = [...sourcePopup.querySelectorAll('.ws-model-option')].find((option) => modelNameFromOption(option) === 'Auto');
    lastActualModel = '';
    auto?.click();
    window.setTimeout(() => {
      syncSelectedModel();
      setHeaderModel('Auto');
    }, 50);
  });
  screen.querySelector('.mobile-use-model-btn').addEventListener('click', () => {
    const active = activeModelOption();
    const name = modelNameFromOption(active);
    if (name) setHeaderModel(name);
    closeModelScreen({ closeSource: true });
  });

  syncSelectedModel();
  applyFilters();
}

window.addEventListener('vetroai:model-used', (event) => {
  const label = event?.detail?.label || event?.detail?.model || '';
  if (!label) return;
  lastActualModel = label;
  setHeaderModel(label);
});

document.addEventListener('click', (event) => {
  if (event.target.closest('.new-btn')) {
    lastActualModel = '';
    window.setTimeout(syncHeaderModel, 30);
  }
});

const observer = new MutationObserver(() => {
  if (!MOBILE_MODEL_QUERY.matches) {
    if (modelScreen) closeModelScreen();
    return;
  }

  syncHeaderModel();
  const popup = document.querySelector('.workspace-popup');
  if (popup && !modelScreen) openModelScreen(popup);
  if (modelScreen && (!sourcePopup || !sourcePopup.isConnected)) closeModelScreen();
});

function startObserver() {
  observer.observe(document.body, { childList: true, subtree: true });
  syncHeaderModel();
  const popup = document.querySelector('.workspace-popup');
  if (popup) openModelScreen(popup);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startObserver, { once: true });
} else {
  startObserver();
}

MOBILE_MODEL_QUERY.addEventListener?.('change', () => {
  if (!MOBILE_MODEL_QUERY.matches) {
    closeModelScreen();
  } else {
    syncHeaderModel();
    const popup = document.querySelector('.workspace-popup');
    if (popup) openModelScreen(popup);
  }
});
