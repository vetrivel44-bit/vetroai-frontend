import { useEffect, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";

// The app's theme lives on <html data-theme>; watch it so open code blocks
// recolor when the user flips the theme.
const readTheme = () => (typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
function useDocTheme() {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(readTheme()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

// Prism (and so SyntaxHighlighter) only tokenizes languages it has a grammar
// for. An unrecognized tag — a niche/DSL name a model invented for a code
// fence (e.g. "umple" for what is really Java), or no tag at all — doesn't
// error, it just skips tokenizing entirely and renders every line in one flat
// color, which reads as broken/unstyled next to properly highlighted blocks.
// Alias the near-misses we've actually seen, and fall back to "clike" (a
// generic curly-brace grammar) for everything else so code still gets some
// real highlighting instead of none.
const HIGHLIGHT_LANGUAGE_ALIASES = { umple: "java", ump: "java" };
const SUPPORTED_HIGHLIGHT_LANGUAGES = new Set(SyntaxHighlighter.supportedLanguages || []);

export function resolveHighlightLanguage(lang) {
  const key = String(lang || "").trim().toLowerCase();
  if (SUPPORTED_HIGHLIGHT_LANGUAGES.has(key)) return key;
  if (HIGHLIGHT_LANGUAGE_ALIASES[key]) return HIGHLIGHT_LANGUAGE_ALIASES[key];
  return "clike";
}

/**
 * The one place react-syntax-highlighter is imported.
 *
 * It ships every Prism grammar — around 220 kB gzipped, more than a fifth of
 * what the app used to download before it could paint — and none of it is
 * needed until an answer actually contains a fenced code block. Keeping the
 * import in this module, which every call site reaches through `React.lazy`,
 * means that weight is fetched on the first code block instead of on the first
 * page view. `resolveHighlightLanguage` lives here too because it reads
 * `SyntaxHighlighter.supportedLanguages`, and asking for that from the outside
 * would pull the whole library back into the eager bundle.
 *
 * `raw` renders the highlighter on its own, for callers that supply their own
 * chrome; otherwise the language is resolved and sane defaults are applied.
 * `followTheme` swaps in a light palette in light mode, for callers whose
 * chrome follows the theme too (callers with fixed dark chrome leave it off).
 */
export default function CodeHighlighter({ language, children, raw = false, followTheme = false, ...rest }) {
  const theme = useDocTheme();
  return (
    <SyntaxHighlighter
      style={followTheme && theme === "light" ? oneLight : vscDarkPlus}
      language={raw ? language : resolveHighlightLanguage(language)}
      PreTag="div"
      {...rest}
    >
      {children}
    </SyntaxHighlighter>
  );
}
