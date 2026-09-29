// The connector tools, run in the browser against Google's APIs with the
// user's own access token (see googleAuth.js). Nothing here goes through
// VetroAI's server. Every tool returns { data, summary, items }:
//   data     what the model reads: compact JSON, long text trimmed
//   summary  a few words for the step in the chat ("5 emails")
//   items    rows the step expands to: { title, detail, link }
//
// `ctx` carries the token and the environment, so tests can stub it:
//   { token, fetch, signal?, readPdf?(blob), timeZone?, now?(), account? }

export class ConnectorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ConnectorError";
    this.code = code;
  }
}

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const DRIVE = "https://www.googleapis.com/drive/v3";
const CALENDAR = "https://www.googleapis.com/calendar/v3/calendars/primary";
const SERVICE = { gmail: "Gmail", drive: "Google Drive", calendar: "Google Calendar" };

const MAX_EMAIL_TEXT = 8000;
const MAX_FILE_TEXT = 12000;
const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024;

// ── helpers ────────────────────────────────────────────────────────────────

const str = (value) => (typeof value === "string" ? value.trim() : "");

const clip = (value, max) => {
  const s = String(value ?? "").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

const intArg = (value, fallback, min, max) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

function required(args, key, hint) {
  const value = str(args[key]);
  if (!value) throw new ConnectorError("bad_args", `Missing "${key}"${hint ? ` (${hint})` : ""}.`);
  return value;
}

const decodeEntity = (code) => {
  try { return String.fromCodePoint(code); } catch { return ""; }
};

export function decodeEntities(text) {
  return String(text || "")
    .replace(/&#(\d+);/g, (_, n) => decodeEntity(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => decodeEntity(Number.parseInt(n, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&(#39|apos);/gi, "'")
    .replace(/&amp;/gi, "&");
}

export function htmlToText(html) {
  return decodeEntities(String(html || "")
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function decodeBase64Url(data) {
  const b64 = String(data || "").replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder("utf-8").decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(String(text));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export const base64Url = (text) => utf8ToBase64(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function googleError(status, body, service) {
  const err = body?.error || {};
  const message = String(err.message || body?.error_description || `HTTP ${status}`);
  const reasons = [
    ...(err.errors || []).map((e) => e.reason),
    ...(err.details || []).map((d) => d.reason),
    err.status,
  ].filter(Boolean).join(" ");
  const text = `${reasons} ${message}`;
  if (status === 401) return new ConnectorError("reauth", `Your Google access for ${service} has expired. Reconnect to continue.`);
  if (status === 403 && /accessNotConfigured|SERVICE_DISABLED|has not been used in project|API has not been used|is disabled/i.test(text)) {
    return new ConnectorError("api_disabled", `The ${service} API isn't turned on in VetroAI's Google Cloud project yet, so VetroAI can't use ${service}.`);
  }
  if (status === 403 && /ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes|\binsufficientPermissions\b/i.test(text)) {
    return new ConnectorError("scope", `VetroAI doesn't have permission to use ${service}. Reconnect and allow access.`);
  }
  if (status === 429 || /rateLimitExceeded|userRateLimitExceeded|RESOURCE_EXHAUSTED/i.test(text)) {
    return new ConnectorError("rate_limited", `${service} is busy right now. Try again in a minute.`);
  }
  if (status === 403) return new ConnectorError("forbidden", `${service} refused: ${message}`);
  if (status === 404) return new ConnectorError("not_found", "Not found. It may have been deleted, or the id is wrong.");
  if (status === 400) return new ConnectorError("bad_args", `${service} rejected the request: ${message}`);
  return new ConnectorError("failed", `${service} error: ${message}`);
}

async function request(ctx, service, url, { method = "GET", body, as = "json" } = {}) {
  let res;
  try {
    res = await ctx.fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctx.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw new ConnectorError("network", `Couldn't reach ${SERVICE[service]}. Check your connection and try again.`);
  }
  if (!res.ok) {
    let payload = null;
    try { payload = await res.json(); } catch { /* not JSON */ }
    throw googleError(res.status, payload, SERVICE[service]);
  }
  if (as === "text") return res.text();
  if (as === "blob") return res.blob();
  if (res.status === 204) return null;
  return res.json();
}

const shortDate = (value) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value || "") : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

const senderName = (from) => (String(from || "").match(/^\s*"?([^"<]+?)"?\s*</)?.[1] || String(from || "")).trim();

// ── Gmail ──────────────────────────────────────────────────────────────────

const header = (message, name) =>
  (message?.payload?.headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

const gmailLink = (ctx, threadId) =>
  `https://mail.google.com/mail/${ctx.account ? `?authuser=${encodeURIComponent(ctx.account)}` : "u/0/"}#all/${threadId}`;

function walkParts(part, out) {
  if (!part) return;
  const mime = part.mimeType || "";
  if (part.filename) {
    out.attachments.push(part.filename);
    return;
  }
  if (mime === "text/plain" && part.body?.data) out.plain.push(decodeBase64Url(part.body.data));
  else if (mime === "text/html" && part.body?.data) out.html.push(decodeBase64Url(part.body.data));
  (part.parts || []).forEach((child) => walkParts(child, out));
}

// The readable text of an email: its plain-text part, or its HTML part as text.
export function emailText(payload) {
  const out = { plain: [], html: [], attachments: [] };
  walkParts(payload, out);
  const text = out.plain.join("\n\n").trim() || htmlToText(out.html.join("\n"));
  return { text, attachments: out.attachments };
}

async function gmailSearch(ctx, args) {
  const query = str(args.query);
  const max = intArg(args.max, 8, 1, 20);
  const list = await request(ctx, "gmail", `${GMAIL}/messages?maxResults=${max}${query ? `&q=${encodeURIComponent(query)}` : ""}`);
  const metadata = "format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date";
  const messages = await Promise.all((list?.messages || []).map((m) => request(ctx, "gmail", `${GMAIL}/messages/${m.id}?${metadata}`)));
  const emails = messages.map((m) => ({
    id: m.id,
    from: header(m, "From"),
    to: clip(header(m, "To"), 200),
    subject: header(m, "Subject") || "(no subject)",
    date: header(m, "Date"),
    snippet: clip(decodeEntities(m.snippet), 240),
    unread: (m.labelIds || []).includes("UNREAD"),
    link: gmailLink(ctx, m.threadId),
  }));
  return {
    data: { query, count: emails.length, emails },
    summary: emails.length ? `${emails.length} email${emails.length === 1 ? "" : "s"}` : "No emails found",
    items: emails.map((e) => ({ title: e.subject, detail: `${senderName(e.from)} · ${shortDate(e.date)}`, link: e.link })),
  };
}

async function gmailRead(ctx, args) {
  const id = required(args, "id", "an email id from gmail_search");
  const m = await request(ctx, "gmail", `${GMAIL}/messages/${encodeURIComponent(id)}?format=full`);
  const { text, attachments } = emailText(m.payload);
  const subject = header(m, "Subject") || "(no subject)";
  const link = gmailLink(ctx, m.threadId);
  return {
    data: {
      id: m.id,
      from: header(m, "From"),
      to: header(m, "To"),
      cc: header(m, "Cc") || undefined,
      subject,
      date: header(m, "Date"),
      body: clip(text, MAX_EMAIL_TEXT),
      truncated: text.length > MAX_EMAIL_TEXT || undefined,
      attachments: attachments.length ? attachments : undefined,
      link,
    },
    summary: subject,
    items: [{ title: subject, detail: `${senderName(header(m, "From"))} · ${shortDate(header(m, "Date"))}`, link }],
  };
}

function recipients(value, key, needed) {
  const list = (Array.isArray(value) ? value : String(value ?? "").split(/[,;]/))
    .map((entry) => String(typeof entry === "object" && entry ? entry.email || "" : entry).replace(/[\r\n]+/g, " ").trim())
    .filter(Boolean);
  if (needed && !list.length) throw new ConnectorError("bad_args", `Missing "${key}" (an email address).`);
  const bad = list.find((address) => !/[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+/.test(address));
  if (bad) throw new ConnectorError("bad_args", `"${bad}" isn't an email address.`);
  return list;
}

// An RFC 2822 message for Gmail's API: plain text, UTF-8, base64 body. Header
// values lose their line breaks so a subject can't smuggle in extra headers.
export function buildMime({ to, cc = [], subject, body, inReplyTo, references }) {
  const clean = (value) => String(value || "").replace(/[\r\n]+/g, " ").trim();
  const subjectLine = /^[\x20-\x7e]*$/.test(clean(subject)) ? clean(subject) : `=?UTF-8?B?${utf8ToBase64(clean(subject))}?=`;
  const lines = [`To: ${to.map(clean).join(", ")}`];
  if (cc.length) lines.push(`Cc: ${cc.map(clean).join(", ")}`);
  lines.push(`Subject: ${subjectLine}`);
  if (inReplyTo) lines.push(`In-Reply-To: ${clean(inReplyTo)}`);
  if (references) lines.push(`References: ${clean(references)}`);
  lines.push(
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    utf8ToBase64(String(body || "").replace(/\r?\n/g, "\r\n")).replace(/.{76}/g, "$&\r\n"),
  );
  return lines.join("\r\n");
}

async function prepareEmail(ctx, args) {
  const to = recipients(args.to, "to", true);
  const cc = recipients(args.cc, "cc", false);
  const body = typeof args.body === "string" ? args.body : "";
  if (!body.trim()) throw new ConnectorError("bad_args", 'Missing "body" (the text of the email).');
  let subject = str(args.subject);
  const reply = {};
  const replyId = str(args.reply_to_id);
  if (replyId) {
    const original = await request(ctx, "gmail", `${GMAIL}/messages/${encodeURIComponent(replyId)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=Subject&metadataHeaders=References`);
    reply.threadId = original.threadId;
    reply.inReplyTo = header(original, "Message-ID");
    reply.references = [header(original, "References"), reply.inReplyTo].filter(Boolean).join(" ");
    subject = subject || header(original, "Subject");
    if (subject && !/^re:/i.test(subject)) subject = `Re: ${subject}`;
  }
  if (!subject) throw new ConnectorError("bad_args", 'Missing "subject".');
  return { to, cc, subject, body, ...reply };
}

async function gmailCompose(ctx, args, send) {
  const mail = await prepareEmail(ctx, args);
  const message = { raw: base64Url(buildMime(mail)), ...(mail.threadId ? { threadId: mail.threadId } : {}) };
  const who = mail.to.join(", ");
  if (send) {
    const sent = await request(ctx, "gmail", `${GMAIL}/messages/send`, { method: "POST", body: message });
    const link = gmailLink(ctx, sent.threadId);
    return {
      data: { sent: true, id: sent.id, to: mail.to, cc: mail.cc.length ? mail.cc : undefined, subject: mail.subject, link },
      summary: `Sent to ${who}`,
      items: [{ title: mail.subject, detail: `To ${who}`, link }],
    };
  }
  const draft = await request(ctx, "gmail", `${GMAIL}/drafts`, { method: "POST", body: { message } });
  const base = `https://mail.google.com/mail/${ctx.account ? `?authuser=${encodeURIComponent(ctx.account)}` : "u/0/"}`;
  const link = `${base}#drafts${draft?.message?.id ? `?compose=${draft.message.id}` : ""}`;
  return {
    data: { drafted: true, draftId: draft?.id, to: mail.to, cc: mail.cc.length ? mail.cc : undefined, subject: mail.subject, link },
    summary: `Draft for ${who}`,
    items: [{ title: mail.subject, detail: `Draft to ${who}`, link }],
  };
}

// ── Google Drive ───────────────────────────────────────────────────────────

const DRIVE_TYPES = {
  doc: "application/vnd.google-apps.document",
  sheet: "application/vnd.google-apps.spreadsheet",
  slides: "application/vnd.google-apps.presentation",
  pdf: "application/pdf",
  folder: "application/vnd.google-apps.folder",
};
const TYPE_ALIASES = { docs: "doc", document: "doc", sheets: "sheet", spreadsheet: "sheet", slide: "slides", presentation: "slides", folders: "folder" };
const FILE_FIELDS = "id,name,mimeType,modifiedTime,size,webViewLink,owners(displayName)";

const quote = (value) => `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

export function driveQuery({ query, type } = {}) {
  const parts = ["trashed = false"];
  const words = str(query);
  if (words) parts.push(`(name contains ${quote(words)} or fullText contains ${quote(words)})`);
  const kind = str(type).toLowerCase();
  const mime = DRIVE_TYPES[TYPE_ALIASES[kind] || kind];
  if (mime) parts.push(`mimeType = ${quote(mime)}`);
  return parts.join(" and ");
}

export function friendlyType(mime) {
  const known = {
    [DRIVE_TYPES.doc]: "Google Doc",
    [DRIVE_TYPES.sheet]: "Google Sheet",
    [DRIVE_TYPES.slides]: "Google Slides",
    [DRIVE_TYPES.pdf]: "PDF",
    [DRIVE_TYPES.folder]: "Folder",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint",
  };
  if (known[mime]) return known[mime];
  const [group, sub = ""] = String(mime || "file").split("/");
  if (group === "image") return `${sub.toUpperCase()} image`;
  if (group === "video") return "Video";
  if (group === "audio") return "Audio";
  if (group === "text") return sub === "plain" ? "Text file" : `${sub.toUpperCase()} file`;
  return "File";
}

const isTextMime = (mime) => /^text\//.test(mime) || /^application\/(json|xml|javascript|x-yaml|yaml|csv)$/.test(mime);

const toFile = (f) => ({
  id: f.id,
  name: f.name,
  type: friendlyType(f.mimeType),
  modified: f.modifiedTime,
  owner: f.owners?.[0]?.displayName,
  link: f.webViewLink,
});

const fileItem = (f) => ({ title: f.name, detail: `${f.type}${f.modified ? ` · ${shortDate(f.modified)}` : ""}`, link: f.link });

async function driveSearch(ctx, args) {
  const query = str(args.query);
  const params = new URLSearchParams({
    q: driveQuery({ query, type: args.type }),
    pageSize: String(intArg(args.max, 10, 1, 25)),
    fields: `files(${FILE_FIELDS})`,
  });
  // Drive refuses a sort order on full-text searches; those come back by relevance.
  if (!query) params.set("orderBy", "modifiedTime desc");
  const res = await request(ctx, "drive", `${DRIVE}/files?${params}`);
  const files = (res?.files || []).map(toFile);
  return {
    data: { query, count: files.length, files },
    summary: files.length ? `${files.length} file${files.length === 1 ? "" : "s"}` : "No files found",
    items: files.map(fileItem),
  };
}

async function driveRead(ctx, args) {
  const id = required(args, "id", "a file id from drive_search");
  const f = await request(ctx, "drive", `${DRIVE}/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(FILE_FIELDS)}`);
  const file = toFile(f);
  const base = { id: file.id, name: file.name, type: file.type, link: file.link };

  if (f.mimeType === DRIVE_TYPES.folder) {
    const params = new URLSearchParams({
      q: `${quote(f.id)} in parents and trashed = false`,
      pageSize: "50",
      fields: `files(${FILE_FIELDS})`,
      orderBy: "folder,name",
    });
    const res = await request(ctx, "drive", `${DRIVE}/files?${params}`);
    const files = (res?.files || []).map(toFile);
    return { data: { ...base, count: files.length, files }, summary: `${files.length} item${files.length === 1 ? "" : "s"} in ${f.name}`, items: files.map(fileItem) };
  }

  const exportAs = { [DRIVE_TYPES.doc]: "text/plain", [DRIVE_TYPES.sheet]: "text/csv", [DRIVE_TYPES.slides]: "text/plain" }[f.mimeType];
  const tooBig = Number(f.size) > MAX_DOWNLOAD_BYTES;
  let text;
  if (exportAs) {
    text = await request(ctx, "drive", `${DRIVE}/files/${encodeURIComponent(f.id)}/export?mimeType=${encodeURIComponent(exportAs)}`, { as: "text" });
  } else if (f.mimeType === DRIVE_TYPES.pdf && ctx.readPdf && !tooBig) {
    const blob = await request(ctx, "drive", `${DRIVE}/files/${encodeURIComponent(f.id)}?alt=media`, { as: "blob" });
    text = await ctx.readPdf(blob);
  } else if (isTextMime(f.mimeType) && !tooBig) {
    text = await request(ctx, "drive", `${DRIVE}/files/${encodeURIComponent(f.id)}?alt=media`, { as: "text" });
  } else {
    return {
      data: { ...base, readable: false, note: tooBig ? "This file is too large to read here. Share its link instead." : "VetroAI can't read this type of file as text. Share its link instead." },
      summary: `Can't read ${file.type}`,
      items: [fileItem(file)],
    };
  }
  const content = String(text || "").trim();
  return {
    data: { ...base, text: clip(content, MAX_FILE_TEXT) || "(empty)", truncated: content.length > MAX_FILE_TEXT || undefined },
    summary: f.name,
    items: [fileItem(file)],
  };
}

// ── Google Calendar ────────────────────────────────────────────────────────

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function when(value, key, fallback) {
  const s = str(typeof value === "number" ? String(value) : value);
  if (!s) {
    if (fallback) return fallback;
    throw new ConnectorError("bad_args", `Missing "${key}".`);
  }
  const d = new Date(DATE_ONLY.test(s) ? `${s}T00:00:00` : s);
  if (Number.isNaN(d.getTime())) {
    throw new ConnectorError("bad_args", `"${key}" must be an ISO 8601 time like 2026-10-02T15:00:00+05:30, or a date like 2026-10-02.`);
  }
  return d;
}

const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// The calendar day after `d`, by date rather than 24 hours, so a daylight
// saving change can't land it on the same day.
const nextDay = (d) => {
  const next = new Date(d);
  next.setDate(next.getDate() + 1);
  return next;
};

const toEvent = (e) => ({
  id: e.id,
  title: e.summary || "(no title)",
  start: e.start?.dateTime || e.start?.date,
  end: e.end?.dateTime || e.end?.date,
  allDay: Boolean(e.start?.date) || undefined,
  location: clip(e.location, 200) || undefined,
  description: clip(htmlToText(e.description), 400) || undefined,
  attendees: e.attendees?.length ? e.attendees.slice(0, 10).map((a) => a.email) : undefined,
  meet: e.hangoutLink || undefined,
  link: e.htmlLink,
});

const eventWhen = (e) => (e.allDay ? new Date(`${e.start}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : shortDate(e.start));

async function calendarEvents(ctx, args) {
  const now = ctx.now ? ctx.now() : new Date();
  const from = when(args.from, "from", now);
  const to = when(args.to, "to", new Date(from.getTime() + 7 * DAY_MS));
  if (to <= from) throw new ConnectorError("bad_args", '"to" must be after "from".');
  const params = new URLSearchParams({
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(intArg(args.max, 15, 1, 50)),
  });
  if (ctx.timeZone) params.set("timeZone", ctx.timeZone);
  if (str(args.query)) params.set("q", str(args.query));
  const res = await request(ctx, "calendar", `${CALENDAR}/events?${params}`);
  const events = (res?.items || []).map(toEvent);
  return {
    data: { from: from.toISOString(), to: to.toISOString(), timeZone: res?.timeZone, count: events.length, events },
    summary: events.length ? `${events.length} event${events.length === 1 ? "" : "s"}` : "No events",
    items: events.map((e) => ({ title: e.title, detail: eventWhen(e), link: e.link })),
  };
}

// The event Google Calendar is asked to create. An all-day event takes dates,
// with `end` as its last day; a timed one takes exact times, one hour long
// unless an end is given.
export function eventBody(args, timeZone) {
  const title = required(args, "title");
  const startRaw = required(args, "start", "an ISO 8601 time");
  const start = when(startRaw, "start");
  const body = { summary: title };
  if (str(args.description)) body.description = str(args.description);
  if (str(args.location)) body.location = str(args.location);
  if (DATE_ONLY.test(startRaw)) {
    const endRaw = str(args.end);
    const lastDay = DATE_ONLY.test(endRaw) && endRaw >= startRaw ? when(endRaw, "end") : start;
    // Google's end date is exclusive: a one-day event on the 2nd ends on the 3rd.
    body.start = { date: startRaw };
    body.end = { date: localDate(nextDay(lastDay)) };
  } else {
    const end = str(args.end) ? when(args.end, "end") : new Date(start.getTime() + 60 * 60 * 1000);
    if (end <= start) throw new ConnectorError("bad_args", '"end" must be after "start".');
    body.start = { dateTime: start.toISOString(), ...(timeZone ? { timeZone } : {}) };
    body.end = { dateTime: end.toISOString(), ...(timeZone ? { timeZone } : {}) };
  }
  const attendees = recipients(args.attendees, "attendees", false);
  if (attendees.length) body.attendees = attendees.map((email) => ({ email }));
  return body;
}

async function calendarCreateEvent(ctx, args) {
  const body = eventBody(args, ctx.timeZone);
  const invites = body.attendees?.length ? "all" : "none";
  const e = await request(ctx, "calendar", `${CALENDAR}/events?sendUpdates=${invites}`, { method: "POST", body });
  const event = toEvent(e);
  return {
    data: { created: true, ...event },
    summary: event.title,
    items: [{ title: event.title, detail: eventWhen(event), link: event.link }],
  };
}

// ── entry point ────────────────────────────────────────────────────────────

const RUNNERS = {
  gmail_search: gmailSearch,
  gmail_read: gmailRead,
  gmail_draft: (ctx, args) => gmailCompose(ctx, args, false),
  gmail_send: (ctx, args) => gmailCompose(ctx, args, true),
  drive_search: driveSearch,
  drive_read: driveRead,
  calendar_events: calendarEvents,
  calendar_create_event: calendarCreateEvent,
};

export async function runGoogleTool(tool, args, ctx) {
  const run = RUNNERS[tool];
  if (!run) throw new ConnectorError("unknown_tool", `There is no tool called "${tool}". The tools are: ${Object.keys(RUNNERS).join(", ")}.`);
  return run(ctx, args && typeof args === "object" ? args : {});
}
