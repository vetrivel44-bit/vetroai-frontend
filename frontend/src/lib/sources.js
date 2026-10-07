// Small helpers for showing a web source: its site and its icon.

export const sourceDomain = (s) => {
  if (s?.domain) return s.domain;
  try { return new URL(s?.url).hostname.replace(/^www\./, ""); } catch { return s?.url || ""; }
};

// "seci.gov.in" -> "seci", "en.wikipedia.org" -> "wikipedia", "bbc.co.uk" -> "bbc".
export const siteName = (domain) => {
  const parts = String(domain || "").toLowerCase().split(".").filter(Boolean);
  if (parts.length <= 1) return parts[0] || "";
  const secondLevel = /^(co|com|gov|ac|org|net|edu|nic|res)$/;
  let i = parts.length - 2;
  if (i > 0 && secondLevel.test(parts[i]) && parts[parts.length - 1].length === 2) i -= 1;
  return parts[i];
};

// Google's service answers 404 (and the browser fires onError) when it has no
// icon at the requested size, so fall through a few sources before a letter.
export const faviconSources = (domain) => [
  `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`,
  `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`,
  `https://${domain}/favicon.ico`,
];
