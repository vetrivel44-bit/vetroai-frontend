// Real textbook diagrams for a drawing of a thing ("draw the human heart",
// "labelled diagram of a plant cell"): the chat's pencil sketch is the
// model's freehand guess and the image model invented parts and garbled the
// labels, so the card also looks up an accurate labelled diagram on
// Wikimedia Commons — drawn by people, free to reuse with credit. The search
// runs from the user's own browser (Commons allows it with origin=*).

const API = "https://commons.wikimedia.org/w/api.php";

const STOP = new Set(["the", "a", "an", "of", "and", "in", "on", "with", "its", "their", "for", "to", "show", "showing", "draw", "drawing", "neat", "labelled", "labeled", "label", "diagram", "sketch", "hand", "drawn", "picture", "simple", "well", "parts", "structure", "detailed", "illustration", "view", "figure"]);

// The words of the subject worth searching for: "Neat labelled diagram of
// the human heart" → ["human", "heart"].
export function subjectWords(subject) {
  return String(subject || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w && !STOP.has(w) && (w.length > 2 || /^(ear|eye|dna|rna|ph)$/.test(w)))
    .slice(0, 5);
}

export function searchUrl(subject) {
  const q = `${subjectWords(subject).join(" ")} diagram`;
  const params = new URLSearchParams({
    action: "query", format: "json", origin: "*",
    generator: "search", gsrnamespace: "6", gsrlimit: "30", gsrsearch: q,
    prop: "imageinfo", iiprop: "url|mime|size|extmetadata",
    iiextmetadatafilter: "LicenseShortName|Artist|ImageDescription", iiurlwidth: "900",
  });
  return `${API}?${params}`;
}

const stem = (w) => w.replace(/(ies)$/, "y").replace(/(?<!s)s$/, "");
const plain = (html) => String(html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

// Commons marks a file's label language at the end of its name:
// "Heart diagram-en.svg", "Plant cell structure (fr).png".
const LANG_TAG = /(?:[-_.]|\s\()(en|ar|fa|ru|de|es|fr|it|pt|pt-br|zh|zh-hans|zh-hant|ja|ko|uk|pl|nl|ca|cs|hu|tr|he|el|sv|fi|ro|bg|sr|hr|sl|sk|lt|lv|et|id|ms|vi|th|hi|bn|ta|te|ml|kn|mr|gu|ur|ast|eu|gl|eo|la|af|sq|hy|az|be|bs|cy|da|ga|is|ka|kk|mk|mn|nb|nn|no|si|sw|tl|uz)\)?$/i;
const GOOD = /\b(diagram|labell?ed|scheme|schematic|structure|anatomy|parts|section|cross[- ]?section|cutaway|illustration|layers|cycle)\b/i;
const BAD = /\b(map|logo|icon|flag|stamp|coin|seal|poster|cartoon|meme|ecg|ekg|x-?ray|radiograph|mri|ct scan|photo|photograph|micrograph|microscopy|histology|statue|painting|sculpture|cake|toy|tattoo|emoji|chart|graph|plot|table)\b/i;
const BLANK = /\b(blank|unlabell?ed|no labels|without labels|empty)\b/i;
const IMAGE_MIME = /^image\/(svg\+xml|png|jpeg|webp|gif)$/;

/**
 * The search's pages, best first: diagrams whose names carry the subject,
 * labelled in English, drawn (SVG, PNG) rather than photographed. Only
 * confident matches are kept — showing nothing beats a wrong diagram.
 */
export function rankDiagrams(subject, pages) {
  const words = subjectWords(subject).map(stem);
  if (!words.length) return [];
  const out = [];
  for (const page of pages || []) {
    const info = page?.imageinfo?.[0];
    if (!info || !IMAGE_MIME.test(info.mime || "")) continue;
    if ((info.width || 0) < 260 || (info.height || 0) < 200) continue;
    const name = String(page.title || "").replace(/^File:/i, "").replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " ");
    const title = name.toLowerCase();
    const meta = info.extmetadata || {};
    const desc = plain(meta.ImageDescription?.value).toLowerCase();
    const titleWords = title.split(/[^a-z0-9]+/).map(stem);
    const descWords = desc.split(/[^a-z0-9]+/).map(stem);
    const inTitle = words.filter((w) => titleWords.includes(w)).length;
    const inEither = words.filter((w) => titleWords.includes(w) || descWords.includes(w)).length;
    // Every word somewhere, and most of them in the file's name.
    if (inEither < words.length || inTitle < Math.ceil(words.length / 2)) continue;
    let score = (4 * inTitle) / words.length;
    if (GOOD.test(title)) score += 3;
    const lang = name.match(LANG_TAG)?.[1]?.toLowerCase();
    if (lang === "en") score += 3;
    else if (lang) score -= 10; // labelled in another language
    if (/svg/.test(info.mime)) score += 2;
    else if (/png|gif/.test(info.mime)) score += 1;
    else score -= 2; // a JPEG is usually a photo
    if (BAD.test(title)) score -= 6;
    if (BLANK.test(title)) score -= 3;
    const ratio = info.width / info.height;
    if (ratio > 3.5 || ratio < 0.28) score -= 2;
    if (score < 5) continue;
    out.push({
      title: name,
      image: info.thumburl || info.url,
      full: info.url,
      page: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(String(page.title || "").replace(/ /g, "_"))}`,
      width: info.thumbwidth || info.width,
      height: info.thumbheight || info.height,
      license: plain(meta.LicenseShortName?.value) || "see source",
      author: plain(meta.Artist?.value).slice(0, 80),
      score,
    });
  }
  return out.sort((a, b) => b.score - a.score || a.title.length - b.title.length).slice(0, 4);
}

const found = new Map(); // subject → promise of results, for this visit

/** Up to four labelled diagrams of the subject, best first (may be none). */
export function findReferenceDiagrams(subject, fetcher = globalThis.fetch) {
  const key = subjectWords(subject).join(" ");
  if (!key) return Promise.resolve([]);
  if (!found.has(key)) {
    let stored = null;
    try { stored = JSON.parse(sessionStorage.getItem(`vetro-ref:${key}`) || "null"); } catch { stored = null; }
    const job = stored ? Promise.resolve(stored) : fetcher(searchUrl(subject))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`search failed (${r.status})`))))
      .then((data) => {
        const ranked = rankDiagrams(subject, Object.values(data?.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0)));
        try { sessionStorage.setItem(`vetro-ref:${key}`, JSON.stringify(ranked)); } catch { /* storage full or blocked */ }
        return ranked;
      });
    found.set(key, job);
    job.catch(() => found.delete(key));
  }
  return found.get(key);
}
