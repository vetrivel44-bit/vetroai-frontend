// Generated websites ask for photos by subject:
//   <img src="https://vetroai-image.invalid/?q=white+leather+sneakers&w=800&h=800">
// (see the design prompt in the backend's AIOrchestrator). This points those at
// the backend's /api/site-image, which redirects to a photo of that subject.
//
// Older replies, and models that ignore the prompt, use random-photo hosts
// (picsum.photos and friends) that put kittens on a shoe shop. Those are
// rewritten too, using the <img>'s alt text — or the page title for CSS
// backgrounds — as the subject.

const PLACEHOLDER_HOST = /https?:\/\/vetroai-image\.invalid\/?\??/gi;
const RANDOM_HOSTS = /https?:\/\/(?:picsum\.photos|source\.unsplash\.com|i\.pravatar\.cc|placehold\.co|via\.placeholder\.com|placekitten\.com|loremflickr\.com|dummyimage\.com)\/[^"'\s)]*/i;

const decode = (text) => String(text || "")
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

// Width and height from the common random-photo URL shapes:
// picsum.photos/800/600, /seed/x/800/600, placehold.co/800x600, pravatar.cc/200.
function sizeFrom(url) {
  const pair = url.match(/\/(\d{2,4})[/x](\d{2,4})(?:[/?.]|$)/);
  if (pair) return { w: pair[1], h: pair[2] };
  const single = url.match(/\/(\d{2,4})(?:[/?]|$)/);
  if (single) return { w: single[1], h: single[1] };
  return { w: 1200, h: 800 };
}

function siteImageUrl(apiBase, subject, size, index) {
  const params = new URLSearchParams({ q: String(subject || "").slice(0, 80), w: String(size.w), h: String(size.h) });
  if (index) params.set("i", String(index));
  return `${apiBase}/site-image?${params}`;
}

/**
 * Returns `html` with every photo pointing at a picture that matches the site.
 * `apiBase` is the backend's /api base URL.
 */
export function resolveSiteImages(html, apiBase) {
  const doc = String(html || "");
  if (!doc || !apiBase) return doc;
  const base = String(apiBase).replace(/\/+$/, "");

  let out = doc.replace(PLACEHOLDER_HOST, `${base}/site-image?`);

  if (!RANDOM_HOSTS.test(out)) return out;
  const title = decode((out.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || "").trim();
  let count = 0;

  // <img> tags: the alt text says what the picture is meant to show.
  out = out.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = tag.match(/\bsrc\s*=\s*(["'])([^"']*)\1/i);
    if (!src || !RANDOM_HOSTS.test(src[2])) return tag;
    const alt = decode((tag.match(/\balt\s*=\s*(["'])([^"']*)\1/i) || [])[2] || "").trim();
    const url = siteImageUrl(base, alt || title || "product photo", sizeFrom(src[2]), ++count);
    return tag.replace(src[0], `src=${src[1]}${url}${src[1]}`);
  });

  // Whatever is left (CSS backgrounds, srcset): the page title is the best guess.
  const global = new RegExp(RANDOM_HOSTS.source, "gi");
  out = out.replace(global, (url) => siteImageUrl(base, title || "abstract background", sizeFrom(url), ++count));
  return out;
}
