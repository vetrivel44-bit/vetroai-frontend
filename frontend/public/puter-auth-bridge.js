// Authenticates window.puter with a pre-issued token so visitors are not
// prompted to log into their own Puter account — usage runs under this app's
// account instead. Must load after js.puter.com and before any bridge script
// that calls window.puter.ai.*
(() => {
  const token = window.__VETROAI_PUTER_AUTH_TOKEN__;
  if (!token || token.startsWith("%VITE_")) return; // unset, or Vite had nothing to substitute

  const apply = (puter) => {
    if (!puter) return;
    try {
      if (typeof puter.setAuthToken === "function") {
        puter.setAuthToken(token);
      } else {
        console.warn("[VetroAI] Puter.js loaded without setAuthToken support; visitors will need to log in manually.");
      }
    } catch (error) {
      console.error("[VetroAI] Failed to apply Puter auth token", error);
    }
  };
  // Chained onto the load promise, so it runs before any caller awaiting it.
  window.whenPuter = ((ready) => () => ready)(window.whenPuter().then((puter) => { apply(puter); return puter; }));
})();
