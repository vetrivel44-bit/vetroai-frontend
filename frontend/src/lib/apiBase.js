// Resolves the backend base URL from VITE_API_BASE_URL.
//
// Every backend route is mounted under /api, but the deployed environment sets
// VITE_API_BASE_URL to the bare origin (no /api). Each caller used to re-derive
// this inline, and one of them forgot the suffix — which 404'd every request it
// made in production while the rest of the app worked fine. Keep it in one
// tested place instead.
export function resolveApiBase(configured, isProd, prodDefault) {
  const trimmed = configured?.trim();
  const base = trimmed ? trimmed.replace(/\/+$/, "") : (isProd ? prodDefault : "/api");
  // A relative "/api" in dev is proxied by Vite and must be left alone; only an
  // absolute origin needs the suffix added.
  if (base.startsWith("http") && !/\/api$/i.test(base)) return `${base}/api`;
  return base;
}
