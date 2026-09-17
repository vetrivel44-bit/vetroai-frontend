// Which browser (Puter, user-pays) model should answer a turn the backend
// could not serve at all.
//
// The backend walks its own provider chain and only reports failure once every
// key it has is rate limited, out of quota or unreachable. Before this, that
// ended the turn with the provider's raw complaint in the chat bubble even
// though the browser models run on the user's own Puter credits and were
// perfectly able to answer — a backend outage looked like a dead product.
//
// Order of preference: a code-shaped question goes to Codex, everything else
// to Sol, with Terra behind them so a model that already failed this turn is
// never retried.
export const BROWSER_RETRY_CHAIN = ["GPT-5.6 Sol", "GPT-5.6 Terra"];
export const BROWSER_RETRY_CODE_MODEL = "GPT-5.3 Codex";

export function pickBrowserRetryProvider({
  attempted = [],
  preferCodex = false,
  hasFiles = false,
  puterAvailable = true,
} = {}) {
  // Attachments only reach a model through the backend, so a file turn has
  // nowhere left to go; without Puter loaded there is no browser model at all.
  if (hasFiles || !puterAvailable) return null;
  const tried = new Set(attempted);
  const chain = preferCodex
    ? [BROWSER_RETRY_CODE_MODEL, ...BROWSER_RETRY_CHAIN]
    : BROWSER_RETRY_CHAIN;
  return chain.find((name) => !tried.has(name)) || null;
}
