// MapTiler is the app's map provider: every map VetroAI shows (location
// answers in LocationMap, ```json map blocks in chat) uses this key and SDK.
// MapTiler browser keys are public by design — restrict this one to the app's
// domains in the MapTiler dashboard (Account → Keys → Allowed origins).
export const MAPTILER_API_KEY = "X8pVgGsWFhZJyTYpijy1";

let sdkPromise = null;

// The SDK (MapLibre underneath) is large, so chat maps load it on first use.
export function loadMapTiler() {
  if (!sdkPromise) {
    sdkPromise = Promise.all([import("@maptiler/sdk"), import("@maptiler/sdk/dist/maptiler-sdk.css")]).then(([sdk]) => {
      sdk.config.apiKey = MAPTILER_API_KEY;
      return sdk;
    }).catch((err) => {
      sdkPromise = null; // let the next map try again (e.g. a chunk that went stale after a deploy)
      throw err;
    });
  }
  return sdkPromise;
}

// Streets for light mode, its dark variant for dark mode.
export function streetStyle(sdk, theme) {
  const streets = sdk.MapStyle.STREETS_V4 || sdk.MapStyle.STREETS;
  return theme === "dark" ? (streets?.DARK || streets) : streets;
}
