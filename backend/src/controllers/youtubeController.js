const logger = require("../utils/logger");

// A browser tab can't click inside youtube.com — cross-origin rules forbid it,
// so "open YouTube and play X" used to land the user on a search page and stop.
// Resolving the first result here means the frontend can open the watch URL
// directly, which plays the song without anyone clicking anything.
//
// Deliberately scraping rather than using the Data API: this needs no API key
// and no per-project quota. The trade-off is that it depends on YouTube's page
// shape, so every caller must keep working when it returns nothing.
const SEARCH_URL = "https://www.youtube.com/results?search_query=";

// videoId appears in the page's embedded JSON well before any player markup.
// The title sits next to it, but isn't required — callers only need the id.
const VIDEO_ID = /"videoId":"([\w-]{11})"/;

// Anchored to the id that was actually matched. Searching for "the first
// title" independently can land on a later entry when the first one carries no
// title — the caller then announces one video by name while a different one
// plays, which is exactly the false claim the surrounding prompts forbid.
// videoId is [\w-]{11}, so it is safe to inline into the pattern.
function titleForVideo(html, videoId) {
  // (?!"videoId") on every step stops the window from running past this entry
  // into the next video's — anchoring to the id alone is not enough, because
  // an entry with no title of its own would still reach the following one's.
  const pattern = new RegExp(
    `"videoId":"${videoId}"(?:(?!"videoId")[\\s\\S]){0,600}?"title":\\{"runs":\\[\\{"text":"((?:[^"\\\\]|\\\\.)*)"`
  );
  return pattern.exec(html)?.[1] || "";
}

function decodeJsonString(raw) {
  if (!raw) return "";
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw;
  }
}

async function resolveFirstVideo(req, res) {
  const query = String(req.query.q || "").trim().slice(0, 180);
  if (!query) {
    return res.status(400).json({ success: false, message: "A search query is required." });
  }

  try {
    const response = await fetch(`${SEARCH_URL}${encodeURIComponent(query)}&hl=en`, {
      headers: {
        // Without a browser-ish UA YouTube serves a consent/blocked shell that
        // carries no video ids at all.
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) throw new Error(`YouTube responded ${response.status}`);

    const html = await response.text();
    const videoId = VIDEO_ID.exec(html)?.[1];
    if (!videoId) {
      // Not an error the caller should retry — YouTube served something this
      // doesn't recognise. The frontend falls back to the search page.
      logger.warn("youtube.resolve.noMatch", { query, bytes: html.length });
      return res.json({ success: false, message: "No video could be resolved for that search." });
    }

    const title = decodeJsonString(titleForVideo(html, videoId));
    logger.info("youtube.resolve.ok", { query, videoId });
    return res.json({
      success: true,
      data: {
        videoId,
        title: title || null,
        watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
      },
    });
  } catch (err) {
    logger.error("youtube.resolve.failed", { query, error: err.message });
    return res.json({ success: false, message: "YouTube could not be reached." });
  }
}

module.exports = { resolveFirstVideo };
