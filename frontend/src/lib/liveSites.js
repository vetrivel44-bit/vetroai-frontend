// Everyday sites whose answers only exist on the live page — prices, ratings,
// stock and delivery on a shopping site, menus and ETAs on a food app. Like
// the travel sites in ComputerUI's LIVE_BROWSE_REQUEST, these need a real
// browser on the computer (the agent loop), not a web-search answer about the
// site. Matched only when the request is to act on the site, so a question
// like "who founded Flipkart?" still gets an ordinary answer.
const SITES = [
  "amazon", "flipkart", "myntra", "meesho", "ajio", "nykaa", "snapdeal", "tata ?cliq", "croma", "reliance ?digital",
  "jiomart", "bigbasket", "blinkit", "zepto", "instamart", "swiggy", "zomato", "dunzo", "bookmyshow",
].join("|");

export const LIVE_SITE_REQUEST = new RegExp(
  // "open flipkart.com …", "go to amazon.in and …"
  `\\b(?:${SITES})\\.(?:com|in|co\\.in)\\b`
  // "open Flipkart and …", "search Amazon for …", "compare earbuds on Myntra"
  + `|\\b(?:open|go to|visit|browse|search|check|find|compare|look up|order)\\b[\\s\\S]{0,60}\\b(?:${SITES})\\b`
  + `|\\b(?:on|in|from)\\s+(?:${SITES})\\b`,
  "i",
);

export const isLiveSiteRequest = (prompt = "") => LIVE_SITE_REQUEST.test(String(prompt));
