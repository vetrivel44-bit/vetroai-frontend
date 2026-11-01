const test = require("node:test");
const assert = require("node:assert/strict");

const { readYouTube, youtubeVideoId, jsonAfter, pickCaptionTrack, captionText } = require("../src/services/youtubeReader");

const publicDns = async () => [{ address: "142.250.183.14" }];
const ID = "dQw4w9WgXcQ";

// Shaped like a real watch page: the player data sits in a script, the visible
// text is menus and footer links.
const watchPage = (player) => `<!DOCTYPE html><html><head><title>Never Gonna Give You Up - YouTube</title></head><body>
<script>var ytInitialPlayerResponse = ${JSON.stringify(player)};var meta = document.createElement('meta');</script>
<div id="footer">About Press Copyright Contact us Creators Advertise Developers Terms Privacy</div></body></html>`;

const PLAYER = {
  playabilityStatus: { status: "OK" },
  videoDetails: {
    videoId: ID,
    title: "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)",
    lengthSeconds: "213",
    author: "Rick Astley",
    viewCount: "1712345678",
    shortDescription: "The official video for “Never Gonna Give You Up” by Rick Astley. {remastered in \"4K\"} }\nNever: The Autobiography 📚 OUT NOW!",
    isLiveContent: false,
  },
  microformat: { playerMicroformatRenderer: { publishDate: "2009-10-24", uploadDate: "2009-10-24" } },
  captions: { playerCaptionsTracklistRenderer: { captionTracks: [
    { baseUrl: "https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=de", languageCode: "de" },
    { baseUrl: "https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en&kind=asr", languageCode: "en", kind: "asr" },
    { baseUrl: "https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en", languageCode: "en" },
  ] } },
};

const CAPTIONS = JSON.stringify({ events: [
  { segs: [{ utf8: "We're no strangers to love" }] },
  { segs: [{ utf8: " You know the rules" }, { utf8: " and so do I" }] },
  { segs: [{ utf8: " A full commitment's what I'm thinking of" }] },
  { segs: [{ utf8: " You wouldn't get this from any other guy" }] },
] });

const json = (body) => new Response(body, { status: 200, headers: { "content-type": "application/json" } });
const html = (body) => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

function fakeYouTube(routes) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, cookie: init.headers?.Cookie });
    for (const [pattern, respond] of routes) if (pattern.test(url)) return respond(url);
    return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
  };
  return { fetchImpl, seen };
}

test("video ids come from every kind of YouTube link, and nothing else", () => {
  for (const url of [
    `https://www.youtube.com/watch?v=${ID}&t=42`, `https://youtu.be/${ID}?si=x`, `https://m.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/shorts/${ID}`, `https://www.youtube.com/embed/${ID}`, `https://music.youtube.com/watch?v=${ID}`,
  ]) assert.equal(youtubeVideoId(url), ID, url);
  for (const url of ["https://www.youtube.com/@RickAstleyYT", "https://www.youtube.com/results?search_query=rick", "https://example.com/watch?v=dQw4w9WgXcQ", "not a url", `https://www.youtube.com/watch?v=short`]) {
    assert.equal(youtubeVideoId(url), null, url);
  }
});

test("the player data is found even when the description is full of braces and quotes", () => {
  const player = jsonAfter(watchPage(PLAYER), "ytInitialPlayerResponse = ");
  assert.equal(player.videoDetails.title, PLAYER.videoDetails.title);
  assert.equal(player.videoDetails.shortDescription, PLAYER.videoDetails.shortDescription);
  assert.equal(jsonAfter("<p>no player here</p>", "ytInitialPlayerResponse = "), null);
});

test("a video is read: details, the uploader's description and what is said in it", async () => {
  const { fetchImpl, seen } = fakeYouTube([
    [/\/watch\?v=/, () => html(watchPage(PLAYER))],
    [/\/api\/timedtext\?.*lang=en(?!&kind)/, () => json(CAPTIONS)],
  ]);
  const result = await readYouTube(`https://youtu.be/${ID}`, { fetchImpl, lookup: publicDns });
  assert.equal(result.status, "read");
  assert.equal(result.url, `https://www.youtube.com/watch?v=${ID}`);
  assert.equal(result.title, PLAYER.videoDetails.title);
  assert.deepEqual(result.video, {
    id: ID, title: PLAYER.videoDetails.title, channel: "Rick Astley", published: "2009-10-24",
    lengthSeconds: 213, views: 1712345678, hasDescription: true, hasTranscript: true,
  });
  assert.match(result.text, /^YouTube video: Rick Astley - Never Gonna Give You Up/);
  assert.match(result.text, /Channel: Rick Astley\nPublished: 2009-10-24 · Length: 3:33 · Views: 1,712,345,678/);
  assert.match(result.text, /Description \(written by the uploader\):\nThe official video for “Never Gonna Give You Up”/);
  assert.match(result.text, /What is said in the video \(YouTube's captions\):\nWe're no strangers to love You know the rules and so do I/);
  assert.ok(!/About Press Copyright/.test(result.text), "menus and footer are not the video");
  assert.ok(seen.every((r) => r.cookie?.includes("CONSENT=YES")), "consent is given up front");
  assert.ok(seen.some((r) => /fmt=json3/.test(r.url)), "captions asked for as json3");
});

test("YouTube's 'confirm you're not a bot' wall gives only title and channel, said plainly", async () => {
  const walled = {
    playabilityStatus: { status: "LOGIN_REQUIRED", reason: "Sign in to confirm you’re not a bot" },
  };
  const { fetchImpl } = fakeYouTube([
    [/\/watch\?v=/, () => html(watchPage(walled).replace("About Press", "Sign in to confirm you’re not a bot. About Press"))],
    [/\/oembed\?/, () => json(JSON.stringify({ title: "Never Gonna Give You Up", author_name: "Rick Astley", type: "video" }))],
  ]);
  const result = await readYouTube(`https://www.youtube.com/watch?v=${ID}`, { fetchImpl, lookup: publicDns });
  assert.equal(result.status, "partial");
  assert.equal(result.title, "Never Gonna Give You Up");
  assert.equal(result.video.channel, "Rick Astley");
  assert.equal(result.video.hasDescription, false);
  assert.equal(result.video.hasTranscript, false);
  assert.match(result.reason, /not a bot.*only the title and channel could be read/);
  assert.equal(result.text, "YouTube video: Never Gonna Give You Up\nChannel: Rick Astley");
});

test("a consent redirect with no oEmbed either is blocked, with the reason", async () => {
  const { fetchImpl } = fakeYouTube([
    [/\/watch\?v=/, () => new Response(null, { status: 302, headers: { location: "https://consent.youtube.com/m?continue=x" } })],
  ]);
  const result = await readYouTube(`https://www.youtube.com/watch?v=${ID}`, { fetchImpl, lookup: publicDns });
  assert.deepEqual(result, { status: "blocked", url: `https://www.youtube.com/watch?v=${ID}`, reason: "it showed a cookie-consent page instead of the content" });
});

test("YouTube out of reach is a failure, and a link that isn't a video is left to the page reader", async () => {
  const down = await readYouTube(`https://www.youtube.com/watch?v=${ID}`, { fetchImpl: async () => { throw new Error("ECONNRESET"); }, lookup: publicDns });
  assert.deepEqual(down, { status: "failed", url: `https://www.youtube.com/watch?v=${ID}`, reason: "YouTube could not be reached" });
  assert.equal(await readYouTube("https://www.youtube.com/@RickAstleyYT", { lookup: publicDns }), null);
});

test("captions: people-written English first; json3 and XML both read", () => {
  assert.equal(pickCaptionTrack(PLAYER.captions.playerCaptionsTracklistRenderer.captionTracks).baseUrl, "https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en");
  assert.equal(pickCaptionTrack([{ baseUrl: "x", languageCode: "en", kind: "asr" }, { baseUrl: "y", languageCode: "fr" }]).baseUrl, "x");
  assert.equal(pickCaptionTrack([]), null);
  assert.equal(captionText(CAPTIONS).slice(0, 26), "We're no strangers to love");
  assert.equal(captionText('<?xml version="1.0"?><transcript><text start="0" dur="2">Hello &amp; welcome</text><text start="2" dur="2">to the show</text></transcript>'), "Hello & welcome to the show");
  assert.equal(captionText(""), "");
});
