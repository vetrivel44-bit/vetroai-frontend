const { config } = require("../config/env");
const logger = require("../utils/logger");
const { find: findTimezone } = require("geo-tz");

const TOKEN_URL = "https://api.prokerala.com/token";
const API_BASE = "https://api.prokerala.com/v2/astrology";
const GEOCODE_URL = "https://nominatim.openstreetmap.org/search";

// OAuth2 client-credentials token, cached in memory until shortly before it expires.
let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) {
    return cachedToken;
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.prokeralaClientId,
      client_secret: config.prokeralaClientSecret,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ProKerala token error ${res.status}: ${body}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  // Refresh a minute early so we never call an API with a token that expires mid-flight.
  cachedTokenExpiresAt = Date.now() + Math.max((data.expires_in || 3600) - 60, 30) * 1000;
  return cachedToken;
}

/**
 * Resolves a free-text city name to coordinates + IANA timezone.
 * ProKerala's astrology endpoints require coordinates, not a place name, and
 * ProKerala has no geocoding endpoint of its own, so we use Nominatim
 * (OpenStreetMap, free, no key) and derive the timezone offline from geo-tz.
 */
async function geocodeCity(city) {
  const url = `${GEOCODE_URL}?format=json&limit=1&q=${encodeURIComponent(city)}`;
  const res = await fetch(url, {
    headers: {
      // Nominatim's usage policy requires an identifying User-Agent.
      "User-Agent": "VetroAI/1.0 (astrology-feature)",
    },
  });

  if (!res.ok) {
    throw new Error(`Geocoding error ${res.status}`);
  }

  const results = await res.json();
  if (!results || !results.length) {
    throw new Error(`Could not find coordinates for city: ${city}`);
  }

  const lat = parseFloat(results[0].lat);
  const lon = parseFloat(results[0].lon);
  const [timezone] = findTimezone(lat, lon);

  return { lat, lon, timezone };
}

function toOffsetDatetime(details, timezone) {
  const { year, month, day, hour, minute } = details;
  // Compute the UTC offset for this specific date/time (handles DST correctly)
  // by comparing how Intl renders the same instant in UTC vs. the target zone.
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const tzParts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(utcGuess).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});

  const asIfUtc = Date.UTC(
    Number(tzParts.year), Number(tzParts.month) - 1, Number(tzParts.day),
    Number(tzParts.hour), Number(tzParts.minute), Number(tzParts.second)
  );
  const offsetMinutes = Math.round((asIfUtc - utcGuess.getTime()) / 60000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const offsetStr = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;

  const pad = (n) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00${offsetStr}`;
}

async function callProkerala(path, params) {
  const token = await getAccessToken();
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}${path}?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ProKerala API error ${res.status} on ${path}: ${body}`);
  }

  return res.json();
}

/**
 * Fetches Vedic astrological data (kundli, planet positions, current dasha
 * period) from ProKerala for the given birth details.
 * @param {Object} details { year, month, day, hour, minute, city }
 */
async function getAstrologyData(details) {
  if (!details || !details.year || !details.month || !details.day || !details.city) {
    return null;
  }

  try {
    const hour = details.hour ?? 12;
    const minute = details.minute ?? 0;
    const { lat, lon, timezone } = await geocodeCity(details.city);
    const datetime = toOffsetDatetime({ ...details, hour, minute }, timezone);

    const params = {
      ayanamsa: 1, // Lahiri
      coordinates: `${lat},${lon}`,
      datetime,
    };

    const [kundli, planetPosition, dashaPeriods] = await Promise.all([
      callProkerala("/kundli", params),
      callProkerala("/planet-position", params),
      callProkerala("/dasha-periods", params),
    ]);

    return {
      astrology_system: "Vedic (Sidereal, Lahiri Ayanamsa)",
      kundli,
      planetPosition,
      dashaPeriods,
    };
  } catch (err) {
    logger.warn("ProKerala astrology service error", { error: err.message });
    return null;
  }
}

/**
 * Uses a fast LLM to quickly extract birth details from recent chat messages.
 */
async function extractBirthDetails(messages, groqClient) {
  if (!groqClient) return null;

  try {
    const historyText = messages.slice(-4).map(m => `${m.role}: ${m.content}`).join("\n");

    const extractionPrompt = `Extract the user's birth details from the chat log.
Return ONLY a raw JSON object with keys: year (int), month (int), day (int), hour (int, 24h), minute (int), city (string).
If the information is completely missing, return {"missing": true}. Do NOT return markdown or explanation.

Chat Log:
${historyText}`;

    const completion = await groqClient.chat.completions.create({
      model: "llama-3.1-8b-instant",
      temperature: 0,
      max_tokens: 100,
      messages: [{ role: "user", content: extractionPrompt }]
    });

    const content = completion.choices[0].message.content.trim();
    const jsonStr = content.replace(/^```json\s*|```\s*$/gi, '');
    const data = JSON.parse(jsonStr);

    if (data.missing || !data.year || !data.city) return null;
    return data;
  } catch (e) {
    return null;
  }
}

module.exports = { getAstrologyData, extractBirthDetails };
