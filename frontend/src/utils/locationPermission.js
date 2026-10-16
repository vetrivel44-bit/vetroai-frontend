// Whether VetroAI may read the precise location without asking first — the
// "Always allow" choice in the location sheet, undone in Settings → Data.
const KEY = "vetroai_location_access";

export function locationAlwaysAllowed() {
  try { return localStorage.getItem(KEY) === "always"; } catch { return false; }
}

export function setLocationAlwaysAllowed(allowed) {
  try {
    if (allowed) localStorage.setItem(KEY, "always");
    else localStorage.removeItem(KEY);
  } catch { /* storage unavailable: it will simply ask again */ }
}

// Ways people say "near where I am", including Indian English ("near by")
// and Hinglish ("mere paas").
const NEAR_PHRASES = "near me|near to me|near by|nearby|close to me|close by|closeby|around me|around here|near here|in my area|near my (?:location|home|house|place|area|office|hostel|college|pg)|my current location|current location|my location|within walking distance|walking distance|(?:mere|hamare) (?:paas|pass)|aas ?paas";
const NEAR_RE = new RegExp(`\\b(?:${NEAR_PHRASES})\\b`, "i");
// "nearest"/"closest" alone also count — unless the question is technical
// ("nearest neighbour", "closest pair of points", "round to the nearest").
const NEAREST_RE = /\b(nearest|closest)\b/i;
const TECHNICAL_RE = /\b(neighbou?rs?|pair|points?|algorithms?|integers?|numbers?|values?|decimal|whole|round(ed|ing)?|vectors?|matrix|distance between|function|array|code|leetcode|python|java)\b/i;

// "nearby" in a story or about space ("a nearby planet") isn't a request for
// places around the user; any other near-phrase in the message still is.
const NEAR_EXCEPT_NEARBY_RE = new RegExp(`\\b(?:${NEAR_PHRASES.split("|").filter((p) => p !== "nearby").join("|")})\\b`, "i");
const NOT_PLACES_RE = /\b(planets?|stars?|galax(y|ies)|universe|story|stories|poem|essay|novel|fiction)\b/i;

/** Whether a message asks for places around the user. */
export function isNearbyRequest(query) {
  const q = String(query || "");
  if (NEAR_RE.test(q)) return NEAR_EXCEPT_NEARBY_RE.test(q) || !NOT_PLACES_RE.test(q);
  return NEAREST_RE.test(q) && !TECHNICAL_RE.test(q);
}

// "Give the best restaurant near me" → "restaurant": the kind of place, for
// the search and for the map's title.
export function nearbySubject(query) {
  const cleaned = String(query || "")
    // "where can I eat" / "somewhere to stay" name the kind of place by a verb.
    .replace(/\b(?:where (?:can|do|should) (?:i|we) eat|(?:somewhere|some ?place|places?|where) to eat|food options)\b/gi, " restaurants ")
    .replace(/\b(?:where (?:can|do|should) (?:i|we) stay|(?:somewhere|some ?place|places?|where) to stay)\b/gi, " hotels ")
    .replace(new RegExp(`\\b(?:${NEAR_PHRASES}|nearest|closest)\\b`, "gi"), " ")
    .replace(/^\s*(please\s+)?(can you\s+|could you\s+)?(give|show|find|suggest|list|recommend|search( for)?|tell me|what are|what's|where is|where are|where can i (?:find|get)|i want|i need|looking for|any)\b\s*(me\s+)?/i, "")
    .replace(/\b(the|a|an|some|best|good|top|great|nice|cheap|famous|popular|please)\b/gi, " ")
    .replace(/[?.!,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "places";
}

// "restaurant" → "Restaurants"
export function nearbyTitle(subject) {
  // Initialisms stay capitalised: "atm" → "ATMs", "pg" → "PGs".
  const s = String(subject || "places").trim().replace(/\b(atm|pg|rto|ev|bmtc|ksrtc)\b/gi, (w) => w.toUpperCase()).replace(/\bbus$/i, "bus stop");
  const plural = /s$/i.test(s) || /(food|ing)$/i.test(s) ? s : /y$/i.test(s) && !/[aeiou]y$/i.test(s) ? `${s.slice(0, -1)}ies` : `${s}s`;
  return (plural.charAt(0).toUpperCase() + plural.slice(1)).replace(/\b([A-Z]{2,})S$/, "$1s");
}
