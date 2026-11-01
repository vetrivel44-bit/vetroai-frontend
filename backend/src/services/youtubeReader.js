// Reads a YouTube video for VetroAI Computer and DeepSearch: what the video
// is (title, channel, date, length, views), what its uploader wrote about it
// (the description) and, when YouTube allows it, what is said in it (the
// captions).
//
// A watch page fetched as HTML has none of that as text: it sits in the
// page's player data (ytInitialPlayerResponse), and the visible text is menus
// and footer links. From a server, YouTube also often answers "Sign in to
// confirm you're not a bot" instead of the video. Both used to be read as if
// they were the video. Now the player data is read; when YouTube walls the
// page off, its public oEmbed endpoint still gives the title and channel,
// reported as a partial read; and when even that fails, the video is reported
// as blocked, never as read.

const { openPage, readLimited, detectWall, htmlToText, pageTitle } = require("./pageReader");

const MAX_WATCH_PAGE_BYTES = 4 * 1024 * 1024; // watch pages run to 1-2 MB of script
const MAX_DESCRIPTION_CHARS = 3000;
const MAX_TRANSCRIPT_CHARS = 8000;

// A desktop browser's headers, and consent already given: without them
// YouTube serves a consent page or a shell with no player data.
const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Cookie: "SOCS=CAI; CONSENT=YES+1",
};

/** The 11-character id of a YouTube video URL (watch, youtu.be, shorts, embed, live), or null. */
function youtubeVideoId(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  let id = null;
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else id = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})(?:[/?#]|$)/)?.[1] || null;
  }
  return /^[\w-]{11}$/.test(id || "") ? id : null;
}

/**
 * The JSON object that follows `marker` in `html` ("ytInitialPlayerResponse = "),
 * parsed, or null. One forward scan that skips over strings, so braces inside a
 * video description don't end the object early.
 */
function jsonAfter(html, marker) {
  const at = html.indexOf(marker);
  if (at === -1) return null;
  const start = html.indexOf("{", at + marker.length);
  if (start === -1 || start - (at + marker.length) > 16) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === "\"") inString = false;
    } else if (c === "\"") inString = true;
    else if (c === "{") depth += 1;
    else if (c === "}" && --depth === 0) {
      try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

/** What a player response says about the video. */
function videoFromPlayer(player) {
  const d = player?.videoDetails || {};
  const mf = player?.microformat?.playerMicroformatRenderer || {};
  return {
    title: d.title || mf.title?.simpleText || "",
    channel: d.author || mf.ownerChannelName || "",
    published: mf.publishDate || mf.uploadDate || null,
    lengthSeconds: Number(d.lengthSeconds || mf.lengthSeconds) || null,
    views: Number(d.viewCount || mf.viewCount) || null,
    description: d.shortDescription || mf.description?.simpleText || "",
    live: Boolean(d.isLiveContent),
    playability: { status: player?.playabilityStatus?.status || "", reason: player?.playabilityStatus?.reason || "" },
    captionTracks: player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [],
  };
}

/** English captions written by people first, then English auto-captions, then any. */
function pickCaptionTrack(tracks) {
  const list = (tracks || []).filter((t) => t?.baseUrl);
  const english = (t) => /^en\b/i.test(t.languageCode || "");
  return list.find((t) => english(t) && t.kind !== "asr") || list.find(english) || list[0] || null;
}

/** Caption text from YouTube's json3 format (or its older XML), as one string. */
function captionText(body) {
  const raw = String(body || "").trim();
  if (!raw) return "";
  if (raw.startsWith("{")) {
    try {
      const events = JSON.parse(raw).events || [];
      return events.map((e) => (e.segs || []).map((s) => s.utf8 || "").join("")).join(" ")
        .replace(/\s+/g, " ").trim();
    } catch { return ""; }
  }
  return htmlToText(raw.replace(/<\/text>/g, "</text>\n")).replace(/\s+/g, " ").trim();
}

const clock = (seconds) => {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};

/** The video as text for the answering model: details first, then description and captions. */
function videoText(video, transcript) {
  const facts = [
    video.published && `Published: ${video.published}`,
    video.lengthSeconds && `Length: ${clock(video.lengthSeconds)}`,
    video.views && `Views: ${video.views.toLocaleString("en-US")}`,
    video.live && "Live stream",
  ].filter(Boolean).join(" · ");
  const lines = [`YouTube video: ${video.title}`, video.channel && `Channel: ${video.channel}`, facts].filter(Boolean);
  if (video.description) lines.push("", "Description (written by the uploader):", video.description.slice(0, MAX_DESCRIPTION_CHARS));
  if (transcript) lines.push("", `What is said in the video (YouTube's ${transcript.auto ? "automatic " : ""}captions):`, transcript.text.slice(0, MAX_TRANSCRIPT_CHARS));
  return lines.join("\n").trim();
}

async function getText(url, { maxBytes = 512 * 1024, ...options }) {
  const opened = await openPage(url, { ...options, headers: BROWSER_HEADERS });
  if (!opened.response) return { opened, text: "" };
  if (!opened.response.ok) {
    opened.response.body?.cancel?.().catch(() => {});
    return { opened, text: "" };
  }
  return { opened, text: await readLimited(opened.response, maxBytes) };
}

/**
 * Reads the YouTube video at `url`. Resolves to null when `url` isn't a video
 * (read it as an ordinary page), otherwise to one of:
 *   { status: "read", url, title, text, video }       details and description, captions when available
 *   { status: "partial", url, title, text, reason, video }  only title and channel: YouTube walled off the page
 *   { status: "blocked" | "failed", url, reason }
 * Never throws.
 */
async function readYouTube(url, { fetchImpl, lookup, timeoutMs = 9000, signal, captions = true } = {}) {
  const id = youtubeVideoId(url);
  if (!id) return null;
  const watchUrl = `https://www.youtube.com/watch?v=${id}`;
  const net = { fetchImpl, lookup, timeoutMs, signal };
  let video = null;
  let wall = null;
  let failure = null;

  try {
    const { opened, text: html } = await getText(`${watchUrl}&hl=en`, { ...net, maxBytes: MAX_WATCH_PAGE_BYTES });
    if (opened.wall) wall = opened.wall;
    else if (opened.stopped) failure = "the research was stopped";
    else if (!opened.response) failure = "YouTube redirected too many times";
    else if (!opened.response.ok) {
      const code = opened.response.status;
      if (code === 403 || code === 429) wall = `YouTube refused automated visits (HTTP ${code})`;
      else failure = `YouTube answered with an error (HTTP ${code})`;
    } else {
      const player = jsonAfter(html, "ytInitialPlayerResponse = ");
      const found = player && videoFromPlayer(player);
      if (found?.title) video = found;
      if (!video || (found.playability.status === "LOGIN_REQUIRED" && !found.description)) {
        wall = detectWall({ url: opened.url, title: pageTitle(html), text: [found?.playability.reason, htmlToText(html).slice(0, 2500)].filter(Boolean).join("\n") })
          || (found?.playability.reason ? `YouTube: ${found.playability.reason}` : "YouTube's page didn't include the video's details");
        if (video && !video.description) video = null;
      }
    }
  } catch {
    failure = "YouTube could not be reached";
  }

  // The page was walled off: the public oEmbed endpoint still names the video.
  let partial = false;
  if (!video) {
    try {
      const { text } = await getText(`https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`, net);
      const o = text ? JSON.parse(text) : null;
      if (o?.title) {
        video = { title: String(o.title), channel: String(o.author_name || ""), captionTracks: [] };
        partial = true;
      }
    } catch { /* nothing more to try */ }
  }
  if (!video) {
    return wall ? { status: "blocked", url: watchUrl, reason: wall } : { status: "failed", url: watchUrl, reason: failure || "YouTube didn't return the video" };
  }

  let transcript = null;
  const track = captions && pickCaptionTrack(video.captionTracks);
  if (track) {
    try {
      const captionUrl = new URL(track.baseUrl, "https://www.youtube.com");
      captionUrl.searchParams.set("fmt", "json3");
      const { text } = await getText(captionUrl.href, { ...net, timeoutMs: Math.min(timeoutMs, 6000) });
      const said = captionText(text);
      if (said.length >= 80) transcript = { text: said, auto: track.kind === "asr", language: track.languageCode || "" };
    } catch { /* captions are a bonus */ }
  }

  const details = {
    id,
    title: video.title,
    channel: video.channel || "",
    published: video.published || null,
    lengthSeconds: video.lengthSeconds || null,
    views: video.views || null,
    hasDescription: Boolean(video.description),
    hasTranscript: Boolean(transcript),
  };
  if (partial) {
    return {
      status: "partial",
      url: watchUrl,
      title: video.title,
      text: videoText(video, null),
      reason: `${wall || failure || "YouTube didn't show the video page"}, so only the title and channel could be read`,
      video: details,
    };
  }
  return { status: "read", url: watchUrl, title: video.title, text: videoText(video, transcript), video: details };
}

module.exports = { readYouTube, youtubeVideoId, jsonAfter, videoFromPlayer, pickCaptionTrack, captionText };
