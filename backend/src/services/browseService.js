// VetroAI Computer's web work, done for real.
//
// Computer used to give the answering model search-result snippets and
// nothing more, while its live browser showed every result being "read" —
// with a third-party screenshot that, for YouTube, was often a sign-in wall.
// The answer then leaned on the model's own memory. Now Computer searches,
// opens the top results and reads them (YouTube videos through
// youtubeReader), and reports each step as it happens, so the browser the
// user watches is the browsing that was done. Only what was actually read
// reaches the answering model; pages that were walled off or failed to load
// are listed as such, never as content.

const logger = require("../utils/logger");
const { searchForResearch } = require("../controllers/searchController");
const { readPage, detectWall, keyTerms, indexPassages, pickPassages } = require("./pageReader");
const { readYouTube, youtubeVideoId } = require("./youtubeReader");
const { describeClock } = require("./clockService");

const MAX_PAGES = 5;
const READ_CONCURRENCY = 4;
// Pages still loading after this are reported as too slow, so a slow site
// never costs the pages already read.
const DEADLINE_MS = 30000;
const PAGE_CHARS = 1800; // of each read page, in the answering model's context
const VIDEO_CHARS = 5000; // a video's details, description and captions
const EXCERPT_CHARS = 420; // shown in the live browser
const PROVIDER_TEXT_MIN = 400; // the search provider's copy of a page, to count as read

const domainOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };

/**
 * A Computer message without the notes Computer appends to it ("[USER-APPROVED
 * CURRENT LOCATION] …", "[ACTION RESULT] …"): they are for the answering
 * model, not for a search engine.
 */
function browseQuery(task) {
  const text = String(task || "");
  const cut = text.split(/\n\s*\[[A-Z][A-Z -]{3,}\]/)[0];
  return cut.replace(/\s+/g, " ").trim().slice(0, 300);
}

/** One entry per page, in rank order. */
function dedupe(results) {
  const seen = new Set();
  return (results || []).filter((r) => {
    if (!r?.url || !/^https?:\/\//i.test(r.url)) return false;
    const key = youtubeVideoId(r.url) || r.url.replace(/[#?].*$/, "").replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function inPool(items, limit, run) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await run(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Opens one search result. The search provider often hands over the page's
 * text already; that counts as read only when it is real content (not a
 * sign-in or bot-check page it was shown) and long enough. Otherwise the page
 * is opened here. YouTube videos are read from their player data.
 */
async function openResult(result, { read, watch }) {
  if (youtubeVideoId(result.url)) {
    const video = await watch(result.url);
    if (video) return video;
  }
  const provided = typeof result.text === "string" ? result.text.trim() : "";
  if (provided) {
    const wall = detectWall({ url: result.url, title: result.title, text: provided });
    if (wall) return { status: "blocked", url: result.url, title: result.title || "", reason: wall };
    if (provided.length >= PROVIDER_TEXT_MIN) return { status: "read", url: result.url, title: result.title || "", text: provided };
  }
  return read(result.url);
}

/** The passages of a page that bear on the task, within `chars`. */
function relevantText(text, terms, chars) {
  const picked = pickPassages(indexPassages(text), terms, { max: 4, maxChars: chars }).passages;
  return (picked.length ? picked.join("\n…\n") : text.slice(0, chars)).trim();
}

/** What the live browser shows of a page: the part of it that was read for the task. */
function excerptOf(page, terms) {
  if (page.video) return page.text.slice(0, EXCERPT_CHARS);
  const text = relevantText(page.text, terms, EXCERPT_CHARS * 2);
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS).trim()}…` : text;
}

/**
 * Searches for `task`, opens and reads the top results, and builds the
 * context the answer is written from.
 *
 * @param {string} task the Computer task (or question)
 * @param {object} [options]
 * @param {(entry: object) => void} [options.onEvent] each step, as it happens:
 *   { id, kind: "search", query, status: "searching" | "done", found }
 *   { id, kind: "visit", url, domain, title, status: "loading" | "read" | "partial" | "blocked" | "failed", reason, excerpt, video }
 *   An entry is sent again, with the same id, when its status changes.
 * @param {object} [options.clock] the user's clock (clockService)
 * @param {AbortSignal} [options.signal]
 * @param {Function} [options.searchFn] query -> results (tests)
 * @param {Function} [options.readFn] url -> readPage result (tests)
 * @param {Function} [options.youtubeFn] url -> readYouTube result (tests)
 * @returns {Promise<{ context: string, results: object[], pages: object[] }>}
 *   `results`: the pages that were read, in citation order ([1] first).
 */
async function browseWeb(task, options = {}) {
  const { clock, signal, onEvent, maxPages = MAX_PAGES, deadlineMs = DEADLINE_MS } = options;
  const deadline = Date.now() + deadlineMs;
  const search = options.searchFn || searchForResearch;
  const read = options.readFn || ((url) => readPage(url, { signal }));
  const watch = options.youtubeFn || ((url) => readYouTube(url, { signal }));
  const emit = (entry) => { try { onEvent?.(entry); } catch (err) { logger.warn("browse.event.failed", { error: err.message }); } };

  const query = browseQuery(task);
  emit({ id: "search-0", kind: "search", query, status: "searching" });
  let results = [];
  try {
    results = dedupe(await search(query));
  } catch (err) {
    logger.warn("browse.search.failed", { error: err.message });
  }
  emit({ id: "search-0", kind: "search", query, status: "done", found: results.length });

  const terms = keyTerms(query);
  const picks = signal?.aborted ? [] : results.slice(0, maxPages);
  const pages = await inPool(picks, READ_CONCURRENCY, async (result, i) => {
    const id = `page-${i}`;
    const domain = domainOf(result.url);
    emit({ id, kind: "visit", url: result.url, domain, title: result.title || domain, status: "loading" });
    let page;
    let timer;
    try {
      const tooSlow = new Promise((resolve) => {
        timer = setTimeout(() => resolve({ status: "failed", url: result.url, reason: "the page took too long to load" }), Math.max(0, deadline - Date.now()));
      });
      page = await Promise.race([openResult(result, { read, watch }), tooSlow]);
    } catch (err) {
      page = { status: "failed", url: result.url, reason: "the page could not be opened" };
      logger.warn("browse.read.failed", { url: result.url, error: err.message });
    } finally {
      clearTimeout(timer);
    }
    const usable = page.status === "read" || page.status === "partial";
    const shown = {
      id,
      kind: "visit",
      url: page.url || result.url,
      domain: domainOf(page.url || result.url) || domain,
      title: page.title || result.title || domain,
      status: page.status,
      reason: page.reason || null,
      excerpt: usable ? excerptOf(page, terms) : null,
      video: page.video || null,
    };
    emit(shown);
    return { ...page, ...shown, text: usable ? page.text : "", published: result.published || null };
  });

  // [n] is the order the pages were opened in, among those that could be read.
  const usable = pages.filter((p) => p.status === "read" || p.status === "partial");
  const unreadable = pages.filter((p) => p.status === "blocked" || p.status === "failed");
  const blocks = usable.map((p, i) => {
    const body = p.video ? p.text.slice(0, VIDEO_CHARS) : relevantText(p.text, terms, PAGE_CHARS);
    const note = p.status === "partial" ? `\n(Only partly read: ${p.reason}.)` : "";
    return `[${i + 1}] ${p.title} — ${p.url}${p.published ? ` (published ${p.published})` : ""}${note}\n${body}`;
  });
  const date = describeClock(clock || {}).date;
  const context = [
    `VETROAI'S BROWSER FOR THIS TASK (${date})`,
    `Searched for "${query}": ${results.length} ${results.length === 1 ? "result" : "results"}; the top ${picks.length} opened.`,
    usable.length
      ? `PAGES READ — the answer comes from these; cite them as [n]:\n\n${blocks.join("\n\n")}`
      : "PAGES READ: none. No page could be read for this task.",
    unreadable.length
      ? `OPENED BUT NOT READABLE — no content came from these; never cite or describe them:\n${unreadable.map((p) => `- ${p.domain}: ${p.reason} (${p.url})`).join("\n")}`
      : "",
  ].filter(Boolean).join("\n\n");

  logger.info("browse.done", { found: results.length, opened: picks.length, read: usable.length, unreadable: unreadable.length });
  return {
    context,
    results: usable.map((p) => ({ url: p.url, title: p.title, published: p.published })),
    pages: pages.map(({ id, url, domain, title, status, reason }) => ({ id, url, domain, title, status, reason })),
  };
}

// For the answering model, after the browser's context: answer from what was read.
const BROWSE_RULES = `\n\n[COMPUTER BROWSING — ANSWER FROM WHAT WAS READ]
The user watched VetroAI's browser search and open the pages listed under VETROAI'S BROWSER FOR THIS TASK (given with the task), so your answer must match what was actually read:
- Take facts from the PAGES READ and put the page's number after each one, like [2].
- If those pages don't cover part of the task, say so plainly ("the pages I opened didn't say …"). Only then add what you know yourself, marked as general knowledge, not as something you found.
- Pages listed as OPENED BUT NOT READABLE gave no content: say that the site blocked the visit or didn't load, and never describe what is on them.
- A YouTube video is known only from its title, channel, description and captions above. If there are no captions, say you couldn't access what is said in the video, and don't summarise it from memory.
- If no page could be read, say that first, and don't present an answer from memory as if it had been researched.`;

module.exports = { browseWeb, browseQuery, BROWSE_RULES };
