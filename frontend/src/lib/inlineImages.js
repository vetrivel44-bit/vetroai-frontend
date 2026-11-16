// A link in a reply that points at a picture is shown as the picture.
//
// Asked to show photos, a model sometimes lists links to images ("[Taj
// Mahal](https://upload.wikimedia.org/…/Taj_Mahal.jpg)") or bare image URLs
// instead of letting the app's gallery show them, and the person saw a list
// of links. CitationLink and the reply's img renderer use this to show the
// picture itself (InlineImage), falling back to the plain link if it won't
// load.

const IMAGE_FILE = /\.(?:jpe?g|png|gif|webp|avif|bmp)(?:$|[?#])/i;
// Image hosts whose URLs don't always end in a file extension.
const IMAGE_HOSTS = /^(?:upload\.wikimedia\.org|images\.pexels\.com|images\.unsplash\.com|i\.imgur\.com|live\.staticflickr\.com|cdn\.pixabay\.com|pbs\.twimg\.com|encrypted-tbn\d\.gstatic\.com|lh\d\.googleusercontent\.com)$/i;

/** Does `href` point straight at a picture (not at a page about one)? */
export function isImageUrl(href) {
  let url;
  try { url = new URL(String(href || "")); } catch { return false; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  return IMAGE_FILE.test(url.pathname) || IMAGE_HOSTS.test(url.hostname);
}

/**
 * The picture's description from the link text: "[Taj Mahal at dawn](…)" →
 * "Taj Mahal at dawn"; a bare URL or "image 1" says nothing useful.
 */
export function imageAlt(text, href) {
  const label = String(text || "").trim();
  if (!label || label === href || /^https?:\/\//i.test(label) || /^(?:image|photo|picture|pic|link)\s*\d*$/i.test(label)) return "";
  return label;
}
