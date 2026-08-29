// Mobile-only model picker enhancement and active-model indicator.
// This keeps the React model-routing logic intact and enhances the rendered UI.

const MOBILE_MODEL_QUERY = window.matchMedia('(max-width: 768px)');

const MODEL_TASKS = {
  writing: new Set(['Auto', 'GPT-5.6 Sol', 'GPT-5.6 Terra', 'GPT-5.6 Luna', 'Claude Fable 5', 'Mistral', 'Agnes']),
  research: new Set(['GPT-5.6 Sol', 'Claude Fable 5', 'Grok 4.6', 'Sonar Pro Research', 'Gemini']),
  coding: new Set(['GPT-5.6 Sol', 'GPT-5.3 Codex', 'Claude Fable 5', 'Grok 4.6', 'Gemini']),
};

let lastActualModel = '';
let activeTask = 'all';
let searchTerm = '';

const modelNameFromOption = (option) => option?.querySelector('.ws-model-copy strong')?.textContent?.trim() || '';
const modelDetailFromOption = (option) => option?.querySelector('.ws-model-copy small')?.textContent?.trim() || '';

function findActiveOption(popup) {
  return popup?.querySelector('.ws-model-option.active') || popup?.querySelector('.ws-model-option');
}

function setChip(label) {
  const chip = document.querySelector('.mobile-active-model-chip');
  if (!chip || !label) return;
  chip.querySelector('.mobile-active-model-name').textContent = label;
  chip.title = `Active model: ${label}`;
}

function ensureActiveModelChip() {
  if (!MOBILE_MODEL_QUERY.matches) return;
  const headerLeft = document.querySelector('.chat-header .ch-left');
  if (!headerLeft) return;

  let chip = headerLeft.querySelector('.mobile-active-model-chip');
  if (!chip) {
    chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'mobile-active-model-chip';
    chip.innerHTML = '<span class="mobile-active-model-dot"></span><span class="mobile-active-model-name">Auto</span>';
    chip.addEventListener('click', () => {
      const selector = document.querySelector('.mode-pill-btn');
      selector?.click();
    });
    headerLeft.appendChild(chip);
  }

  if (lastActualModel) {
    setChip(lastActualModel);
    return;
  }

  const selected = document.querySelector('.mode-pill-btn span')?.textContent?.trim();
  if (selected) setChip(selected);
}

function updateSelectedSummary(popup) {
  const summary = popup?.querySelector('.mobile-model-selected-card');
  if (!summary) return;

  const active = findActiveOption(popup);
  if (!active) return;
  const name = modelNameFromOption(active) || 'Auto';
  const detail = modelDetailFromOption(active) || 'Smart routing';

  const iconHost = summary.querySelector('.mobile-selected-icon');
  const sourceIcon = active.querySelector('.ws-model-mark');
  if (iconHost && sourceIcon) {
    iconHost.replaceChildren(sourceIcon.cloneNode(true));
  }
  summary.querySelector('.mobile-selected-name').textContent = name;
  summary.querySelector('.mobile-selected-detail').textContent = detail;
  summary.dataset.model = name;
}

function applyModelFilters(popup) {
  if (!popup) return;
  const options = [...popup.querySelectorAll('.ws-model-option')];
  const q = searchTerm.trim().toLowerCase();

  options.forEach((option) => {
    const name = modelNameFromOption(option);
    const detail = modelDetailFromOption(option);
    const haystack = `${name} ${detail}`.toLowerCase();
    const searchMatch = !q || haystack.includes(q);
    const taskMatch = activeTask === 'all' || MODEL_TASKS[activeTask]?.has(name);
    option.classList.toggle('mobile-model-hidden', !(searchMatch && taskMatch));
  });

  const empty = popup.querySelector('.mobile-model-empty');
  const visibleCount = options.filter((option) => !option.classList.contains('mobile-model-hidden')).length;
  if (empty) empty.hidden = visibleCount > 0;
}

function makeFilters(popup) {
  const row = document.createElement('div');
  row.className = 'mobile-model-filter-wrap';
  row.innerHTML = `
    <span class="mobile-model-filter-label">GOOD FOR</span>
    <div class="mobile-model-filters" role="group" aria-label="Filter models by task">
      <button type="button" data-task="all" class="active">Any task</button>
      <button type="button" data-task="writing">Writing</button>
      <button type="button" data-task="research">Research</button>
      <button type="button" data-task="coding">Coding</button>
    </div>`;

  row.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => {
      activeTask = button.dataset.task || 'all';
      row.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
      applyModelFilters(popup);
    });
  });
  return row;
}

function enhanceModelPicker(popup) {
  if (!MOBILE_MODEL_QUERY.matches || !popup || popup.dataset.mobilePickerEnhanced === 'true') return;
  popup.dataset.mobilePickerEnhanced = 'true';
  popup.classList.add('mobile-model-picker-enhanced');

  const header = popup.querySelector('.ws-popup-header');
  const title = header?.querySelector('strong');
  const subtitle = header?.querySelector('span');
  if (title) title.textContent = 'Choose your chat model';
  if (subtitle) subtitle.textContent = 'One model per chat';

  const scroll = popup.querySelector('.ws-popup-scroll');
  const modelSection = scroll?.querySelector('.ws-picker-section');
  if (!scroll || !modelSection) return;

  const search = document.createElement('label');
  search.className = 'mobile-model-search';
  search.innerHTML = `
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>
    <input type="search" autocomplete="off" spellcheck="false" placeholder="Search VetroAI models…" aria-label="Search models" />`;
  const input = search.querySelector('input');
  input.value = searchTerm;
  input.addEventListener('input', () => {
    searchTerm = input.value;
    applyModelFilters(popup);
  });

  const filters = makeFilters(popup);

  const selectedBlock = document.createElement('section');
  selectedBlock.className = 'mobile-model-selected';
  selectedBlock.innerHTML = `
    <div class="mobile-model-kicker">SELECTED MODEL</div>
    <div class="mobile-model-selected-card">
      <div class="mobile-selected-icon"></div>
      <div class="mobile-selected-copy"><strong class="mobile-selected-name">Auto</strong><small class="mobile-selected-detail">Smart routing</small></div>
      <span class="mobile-selected-check">✓</span>
    </div>`;

  scroll.insertBefore(search, modelSection);
  scroll.insertBefore(filters, modelSection);
  scroll.insertBefore(selectedBlock, modelSection);

  const sectionTitle = modelSection.querySelector('.ws-section-title span');
  const sectionMeta = modelSection.querySelector('.ws-section-title em');
  if (sectionTitle) sectionTitle.textContent = 'AVAILABLE MODELS';
  if (sectionMeta) sectionMeta.textContent = '';

  const empty = document.createElement('div');
  empty.className = 'mobile-model-empty';
  empty.hidden = true;
  empty.textContent = 'No models match this search.';
  modelSection.appendChild(empty);

  popup.querySelectorAll('.ws-model-option').forEach((option) => {
    option.addEventListener('click', () => {
      lastActualModel = '';
      window.setTimeout(() => {
        updateSelectedSummary(popup);
        const active = findActiveOption(popup);
        const name = modelNameFromOption(active);
        if (name) setChip(name);
      }, 30);
    });
  });

  const footer = document.createElement('div');
  footer.className = 'mobile-model-picker-footer';
  footer.innerHTML = `
    <button type="button" class="mobile-default-model-btn">☆ Default model</button>
    <button type="button" class="mobile-use-model-btn">Use this model <span>→</span></button>`;

  footer.querySelector('.mobile-default-model-btn').addEventListener('click', () => {
    const auto = [...popup.querySelectorAll('.ws-model-option')].find((option) => modelNameFromOption(option) === 'Auto');
    auto?.click();
    window.setTimeout(() => {
      updateSelectedSummary(popup);
      setChip('Auto');
    }, 30);
  });
  footer.querySelector('.mobile-use-model-btn').addEventListener('click', () => {
    const active = findActiveOption(popup);
    const name = modelNameFromOption(active);
    if (name) setChip(name);
    popup.querySelector('.ws-popup-close')?.click();
  });
  popup.appendChild(footer);

  updateSelectedSummary(popup);
  applyModelFilters(popup);
}

window.addEventListener('vetroai:model-used', (event) => {
  const label = event?.detail?.label || event?.detail?.model || '';
  if (!label) return;
  lastActualModel = label;
  ensureActiveModelChip();
  setChip(label);
});

// A new explicit model choice should replace any temporary auto-routing label.
document.addEventListener('click', (event) => {
  if (event.target.closest('.ws-model-option')) lastActualModel = '';
  if (event.target.closest('.new-btn')) lastActualModel = '';
});

const observer = new MutationObserver(() => {
  if (!MOBILE_MODEL_QUERY.matches) return;
  ensureActiveModelChip();
  document.querySelectorAll('.workspace-popup').forEach(enhanceModelPicker);
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
    ensureActiveModelChip();
  }, { once: true });
} else {
  observer.observe(document.body, { childList: true, subtree: true });
  ensureActiveModelChip();
}

MOBILE_MODEL_QUERY.addEventListener?.('change', () => {
  if (MOBILE_MODEL_QUERY.matches) {
    ensureActiveModelChip();
    document.querySelectorAll('.workspace-popup').forEach(enhanceModelPicker);
  }
});
