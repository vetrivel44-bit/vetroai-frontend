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

// "Give the best restaurant near me" → "restaurant": the kind of place, for
// the search and for the map's title.
export function nearbySubject(query) {
  const cleaned = String(query || "")
    .replace(/\b(near me|nearby|nearest|closest|around me|around here|near here|current location|near my location|close to me|in my area)\b/gi, " ")
    .replace(/^\s*(please\s+)?(can you\s+|could you\s+)?(give|show|find|suggest|list|recommend|search( for)?|tell me|what are|what's|where is|where are|i want|i need|looking for|any)\b\s*(me\s+)?/i, "")
    .replace(/\b(the|a|an|some|best|good|top|great|nice|cheap|famous|popular)\b/gi, " ")
    .replace(/[?.!,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "places";
}

// "restaurant" → "Restaurants"
export function nearbyTitle(subject) {
  const s = String(subject || "places").trim();
  const plural = /s$/i.test(s) || /\b(food|parking)$/i.test(s) ? s : /y$/i.test(s) && !/[aeiou]y$/i.test(s) ? `${s.slice(0, -1)}ies` : `${s}s`;
  return plural.charAt(0).toUpperCase() + plural.slice(1);
}
