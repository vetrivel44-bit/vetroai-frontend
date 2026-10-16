/* VetroAI mobile artifact fixes.
 * (Reply avatars are drawn by src/mobileActiveModelBadges.js: the model that
 * answered, else the VetroAI mark.)
 * Kept as a small DOM safety layer so touch/PWA browsers behave correctly even
 * when React click events are swallowed by an overlapping mobile workspace.
 */
(() => {
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
  }, true);

  // Escape / Android keyboard-back capable browsers.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.querySelector('.artifacts-panel:not([aria-hidden="true"])')) closeArtifact();
  });

})();
