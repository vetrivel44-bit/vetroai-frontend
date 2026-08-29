/* VetroAI mobile artifact + model-avatar fixes.
 * Kept as a small DOM safety layer so touch/PWA browsers behave correctly even
 * when React click events are swallowed by an overlapping mobile workspace.
 */
(() => {
  const MODEL_RULES = [
    [/claude/i, { key: 'claude', label: 'Claude', mark: '✣' }],
    [/gpt|openai|codex/i, { key: 'openai', label: 'OpenAI', mark: '◎' }],
    [/gemini/i, { key: 'gemini', label: 'Gemini', mark: '✦' }],
    [/groq/i, { key: 'groq', label: 'Groq', mark: 'G' }],
    [/mistral/i, { key: 'mistral', label: 'Mistral', mark: 'M' }],
    [/sambanova/i, { key: 'sambanova', label: 'SambaNova', mark: 'S' }],
    [/agnes/i, { key: 'agnes', label: 'Agnes', mark: 'A' }],
    [/auto/i, { key: 'auto', label: 'VetroAI Auto', mark: 'V' }],
  ];

  const modelFromText = (text = '') => {
    for (const [rx, meta] of MODEL_RULES) if (rx.test(text)) return meta;
    return { key: 'vetro', label: 'VetroAI', mark: 'V' };
  };

  const currentModel = () => {
    const candidates = [...document.querySelectorAll('button')];
    const picker = candidates.find((el) => /GPT-|Claude|Gemini|Groq|Mistral|SambaNova|Agnes|Auto/i.test(el.textContent || ''));
    return modelFromText(picker?.textContent || 'Auto');
  };

  const avatarSvg = (meta) => {
    if (meta.key === 'claude') return '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 4v24M8.5 7.5l15 17M23.5 7.5l-15 17M5 16h22M7.5 10.5l17 11M24.5 10.5l-17 11"/></svg>';
    if (meta.key === 'openai') return '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 5a6 6 0 0 1 5.2 3 6 6 0 0 1 4.6 8.7 6 6 0 0 1-5.2 8.2A6 6 0 0 1 11 24a6 6 0 0 1-4.8-8.7A6 6 0 0 1 11.4 7 6 6 0 0 1 16 5Z"/><path d="m11 10 10 6-10 6V10Zm10 0-10 6 10 6V10Z"/></svg>';
    if (meta.key === 'gemini') return '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3c1.2 8 5 11.8 13 13-8 1.2-11.8 5-13 13-1.2-8-5-11.8-13-13C11 14.8 14.8 11 16 3Z"/></svg>';
    return `<span>${meta.mark}</span>`;
  };

  const isVetroGeometryAvatar = (el) => {
    if (!(el instanceof HTMLElement)) return false;
    if (el.dataset.modelAvatar === 'true') return true;
    const svg = el.querySelector(':scope > svg');
    if (!svg) return false;
    const style = getComputedStyle(el);
    return el.offsetWidth >= 28 && el.offsetWidth <= 44 && el.offsetHeight >= 28 && el.offsetHeight <= 44 && style.borderRadius !== '0px';
  };

  const refreshAvatars = () => {
    const meta = currentModel();
    document.querySelectorAll('svg[viewBox="0 0 68 76"]').forEach((svg) => {
      const host = svg.parentElement;
      if (!host || !isVetroGeometryAvatar(host)) return;
      host.dataset.modelAvatar = 'true';
      host.dataset.model = meta.key;
      host.setAttribute('title', meta.label);
      host.setAttribute('aria-label', `${meta.label} response`);
      host.innerHTML = avatarSvg(meta);
    });
  };

  const closeArtifact = () => {
    const panel = document.querySelector('.artifacts-panel');
    if (!panel) return;
    panel.style.setProperty('display', 'none', 'important');
    panel.setAttribute('aria-hidden', 'true');
    document.querySelector('.vetro-app-shell')?.classList.remove('artifact-workspace-open');
    document.documentElement.classList.remove('artifact-mobile-open');
  };

  const reopenArtifact = () => {
    requestAnimationFrame(() => {
      const panel = document.querySelector('.artifacts-panel');
      if (!panel) return;
      panel.style.removeProperty('display');
      panel.removeAttribute('aria-hidden');
      document.querySelector('.vetro-app-shell')?.classList.add('artifact-workspace-open');
    });
  };

  // pointerup is reliable on Android/PWA even in cases where click gets swallowed.
  document.addEventListener('pointerup', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const close = target?.closest('.artifact-icon-btn[title="Close artifact"]');
    if (close) {
      event.preventDefault();
      event.stopPropagation();
      closeArtifact();
      return;
    }
    if (target?.closest('.artifact-gallery-card, .code-copy-btn[title="Open as artifact"]')) reopenArtifact();
    if (target?.closest('button')) setTimeout(refreshAvatars, 0);
  }, true);

  // Escape / Android keyboard-back capable browsers.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.querySelector('.artifacts-panel:not([aria-hidden="true"])')) closeArtifact();
  });

  const observer = new MutationObserver(() => refreshAvatars());
  const start = () => {
    observer.observe(document.body, { childList: true, subtree: true });
    refreshAvatars();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
