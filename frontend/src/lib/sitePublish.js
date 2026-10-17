// Publishing a website VetroAI Computer built: the page is saved in
// Firestore (sites/{id}, public to read, only its owner can change it) and
// opened at /s/{id}, where it runs in a sandboxed frame with no access to
// the VetroAI app, its storage or the visitor's account.

export const MAX_SITE_BYTES = 900_000;

/** "Sneaker Store" → "sneaker-store-k3x9q2" */
export function siteIdFor(title, random = Math.random) {
  const slug = String(title || "site").toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 28).replace(/-+$/, "") || "site";
  const tail = Array.from({ length: 6 }, () => "abcdefghjkmnpqrstuvwxyz23456789"[Math.floor(random() * 31)]).join("");
  return `${slug}-${tail}`;
}

export const siteIdFromPath = (pathname) => /^\/s\/([a-z0-9-]{3,48})\/?$/i.exec(String(pathname || ""))?.[1] || null;

export const siteUrl = (id, origin = globalThis.location?.origin || "") => `${origin}/s/${id}`;

// A sandboxed page without same-origin access throws on localStorage; give
// it storage that works for the visit, so carts and settings don't crash.
export const STORAGE_SHIM = `<script>(function(){function m(){var d={};return{getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[String(k)]=String(v)},removeItem:function(k){delete d[String(k)]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}["localStorage","sessionStorage"].forEach(function(n){try{window[n].getItem("x")}catch(e){try{Object.defineProperty(window,n,{value:m(),configurable:true})}catch(e2){}}})})();</script>`;

export function withStorageShim(html) {
  const doc = String(html || "");
  if (/<head[^>]*>/i.test(doc)) return doc.replace(/<head[^>]*>/i, (tag) => `${tag}${STORAGE_SHIM}`);
  return `${STORAGE_SHIM}${doc}`;
}

const sizeOf = (s) => new Blob([s]).size;

/** Saves (or updates, with `id`) a site. Needs a signed-in user. Returns { id, url }. */
export async function publishSite({ html, title, id }) {
  const { auth, db } = await import("../firebase");
  const user = auth?.currentUser;
  if (!db || !user) throw Object.assign(new Error("Sign in to VetroAI to publish a website."), { code: "signin" });
  if (sizeOf(html) > MAX_SITE_BYTES) throw new Error("This website is too large to publish (over 900 KB). Ask VetroAI to make it lighter, e.g. with fewer inline images.");
  const { doc, setDoc, serverTimestamp } = await import("firebase/firestore");
  const siteId = id || siteIdFor(title);
  try {
    await setDoc(doc(db, "sites", siteId), {
      owner: user.uid,
      title: String(title || "Website").slice(0, 120),
      html,
      updatedAt: serverTimestamp(),
      ...(id ? {} : { createdAt: serverTimestamp() }),
    }, { merge: true });
  } catch (err) {
    if (err?.code === "permission-denied") throw new Error("Publishing isn't switched on for this VetroAI project yet — the site owner needs to deploy the latest Firestore rules.");
    throw err;
  }
  return { id: siteId, url: siteUrl(siteId) };
}

/** A published site, or null. */
export async function loadSite(id) {
  const { db } = await import("../firebase");
  if (!db) throw new Error("This VetroAI build can't open published sites.");
  const { doc, getDoc } = await import("firebase/firestore");
  const snap = await getDoc(doc(db, "sites", id));
  return snap.exists() ? snap.data() : null;
}
