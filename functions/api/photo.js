// Weigh-In photo service. Catch photos live in a Cloudflare R2 bucket instead of inside the catch.
//
//   POST   /api/photo          save a photo (needs the person's sign-in)  -> { url }
//   GET    /api/photo?id=...   show a photo (anyone with the link; the link can't be guessed)
//   DELETE /api/photo?id=...   remove one of your photos (the app owner can remove any)
//   DELETE /api/photo?all=1    remove every photo you ever saved (used by "Delete my account")
//
// The bucket is attached to this site under the name PHOTOS (Cloudflare Pages > Settings > Bindings).
// If it is not attached yet, every call answers 503 and the app quietly keeps photos the old way.

const PROJECT = "weigh-in-a3bbe";
const OWNER_UID = "whNN0b8nbhdQiK8osrBa48SEtm82";
const MAX_BYTES = 400000;      // the app makes ~55 KB photos; this stops anything huge
const MAX_PER_USER = 600;      // photos one person can keep
const JWKS = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const ID_RE = /^([A-Za-z0-9_-]{1,128})\/([a-f0-9]{24})\.(webp|jpg)$/;
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const b64 = (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
const text = (s) => new TextDecoder().decode(b64(s));

// Google's public keys, kept for an hour so we don't fetch them on every photo.
let keyList = null, keyAt = 0;
const keyCache = new Map();
async function keyFor(kid) {
  const now = Date.now();
  if (!keyList || now - keyAt > 3600e3 || (!keyList[kid] && now - keyAt > 60e3)) {
    const r = await fetch(JWKS);
    if (r.ok) { const j = await r.json(); keyList = {}; for (const k of j.keys || []) keyList[k.kid] = k; keyAt = now; keyCache.clear(); }
  }
  const jwk = keyList && keyList[kid];
  if (!jwk) return null;
  if (!keyCache.has(kid)) keyCache.set(kid, crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
  return keyCache.get(kid);
}

// Checks the Firebase sign-in token the app sends and returns the person's uid, or "" if it's not real.
async function who(request) {
  try {
    const h = request.headers.get("Authorization") || "";
    if (!h.startsWith("Bearer ")) return "";
    const parts = h.slice(7).trim().split(".");
    if (parts.length !== 3) return "";
    const head = JSON.parse(text(parts[0])), body = JSON.parse(text(parts[1]));
    if (head.alg !== "RS256" || !head.kid) return "";
    const now = Math.floor(Date.now() / 1000);
    if (body.aud !== PROJECT || body.iss !== "https://securetoken.google.com/" + PROJECT) return "";
    if (!(body.exp > now) || body.iat > now + 300) return "";
    if (typeof body.sub !== "string" || !UID_RE.test(body.sub)) return "";
    const key = await keyFor(head.kid);
    if (!key) return "";
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
    return ok ? body.sub : "";
  } catch { return ""; }
}

// What kind of picture is this really? Only WebP and JPEG are accepted.
function kind(b) {
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  return "";
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url), m = request.method;
  if (!env.PHOTOS) return json({ error: "no-bucket" }, 503);

  if (m === "GET" || m === "HEAD") {
    const id = url.searchParams.get("id") || "";
    if (!ID_RE.test(id)) return json({ error: "bad-id" }, 400);
    const obj = m === "HEAD" ? await env.PHOTOS.head("p/" + id) : await env.PHOTOS.get("p/" + id);
    if (!obj) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
    const h = {
      "Content-Type": obj.httpMetadata?.contentType || "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",   // a photo never changes, so phones keep it
      "ETag": obj.httpEtag,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    };
    if (request.headers.get("If-None-Match") === obj.httpEtag) return new Response(null, { status: 304, headers: h });
    return new Response(m === "HEAD" ? null : obj.body, { headers: h });
  }

  if (m === "POST") {
    const uid = await who(request);
    if (!uid) return json({ error: "auth" }, 401);
    const len = +request.headers.get("Content-Length");
    if (!len) return json({ error: "length" }, 411);
    if (len > MAX_BYTES) return json({ error: "too-big" }, 413);
    const buf = new Uint8Array(await request.arrayBuffer());
    if (buf.length > MAX_BYTES) return json({ error: "too-big" }, 413);
    const ext = kind(buf);
    if (!ext) return json({ error: "not-a-photo" }, 415);
    const have = await env.PHOTOS.list({ prefix: `p/${uid}/`, limit: MAX_PER_USER });
    if (have.objects.length >= MAX_PER_USER) return json({ error: "limit" }, 429);
    const name = Array.from(crypto.getRandomValues(new Uint8Array(12)), (x) => x.toString(16).padStart(2, "0")).join("") + "." + ext;
    await env.PHOTOS.put(`p/${uid}/${name}`, buf, { httpMetadata: { contentType: ext === "webp" ? "image/webp" : "image/jpeg" }, customMetadata: { uid } });
    return json({ url: `/api/photo?id=${uid}/${name}` });
  }

  if (m === "DELETE") {
    const uid = await who(request);
    if (!uid) return json({ error: "auth" }, 401);
    if (url.searchParams.get("all") === "1") {
      let n = 0, cursor;
      for (let i = 0; i < 20; i++) {
        const l = await env.PHOTOS.list({ prefix: `p/${uid}/`, limit: 1000, cursor });
        const ks = l.objects.map((o) => o.key);
        if (ks.length) { await env.PHOTOS.delete(ks); n += ks.length; }
        if (!l.truncated) break;
        cursor = l.cursor;
      }
      return json({ deleted: n });
    }
    const id = url.searchParams.get("id") || "";
    const mm = ID_RE.exec(id);
    if (!mm) return json({ error: "bad-id" }, 400);
    if (mm[1] !== uid && uid !== OWNER_UID) return json({ error: "not-yours" }, 403);
    await env.PHOTOS.delete("p/" + id);
    return json({ ok: true });
  }

  return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST, DELETE" } });
}
