// Weigh-In notifications that reach a phone even when the app is closed (Web Push).
//
//   GET  /api/push?key   the public key a phone needs to subscribe (made the first time it's asked, kept in the photo bucket)
//   POST /api/push       (needs the person's sign-in)
//        {action:"sub",   sub, friends:[uid...]}   save this phone for notifications, and who it may hear from
//        {action:"unsub", endpoint}                forget this phone
//        {action:"notify", kind:"post"|"recap", to:[uid...], name, species?, year?}
//                                                   tell friends that something new is up
//
// Nothing to set up beyond the photo bucket (PHOTOS) that photo.js already uses. Saved phones live under "push/" in it.
// Safety: a person only hears from uids they listed as friends, at most one alert per friend every 10 minutes,
// and the words of every alert are written here, never taken from the sender.

const PROJECT = "weigh-in-a3bbe";
const SITE = "https://weighin-app.pages.dev";
const JWKS = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_FRIENDS = 600, MAX_TO = 100, MAX_SUBS = 5, GAP_MS = 10 * 60e3;

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const b64 = (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
const b64u = (u8) => { let s = ""; for (const x of u8) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const text = (s) => new TextDecoder().decode(b64(s));
const enc = new TextEncoder();
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };

/* ---- who is asking (same check photo.js does) ---- */
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
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64(parts[2]), enc.encode(parts[0] + "." + parts[1]));
    return ok ? body.sub : "";
  } catch { return ""; }
}

/* ---- the site's own sending key (made once, kept in the bucket) ---- */
let vapidMem = null;
async function vapid(env) {
  if (vapidMem) return vapidMem;
  let o = await env.PHOTOS.get("push/vapid.json");
  if (!o) {
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const priv = await crypto.subtle.exportKey("jwk", kp.privateKey), pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
    await env.PHOTOS.put("push/vapid.json", JSON.stringify({ priv, pub: b64u(pub) }), { onlyIf: { etagDoesNotMatch: "*" } });
    o = await env.PHOTOS.get("push/vapid.json");   // if two phones asked at once, both end up using the one that was saved first
  }
  const j = await o.json();
  const key = await crypto.subtle.importKey("jwk", j.priv, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  return (vapidMem = { key, pub: j.pub });
}
async function vapidHeader(env, endpoint) {
  const v = await vapid(env), aud = new URL(endpoint).origin;
  const h = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const c = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SITE })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, v.key, enc.encode(h + "." + c)));
  return `vapid t=${h}.${c}.${b64u(sig)}, k=${v.pub}`;
}

/* ---- RFC 8291 message encryption (aes128gcm). `fixed` is only for the self-test. ---- */
async function encrypt(payload, p256dh, authSecret, fixed) {
  const ua = b64(p256dh), auth = b64(authSecret);
  let asPub, asPriv;
  if (fixed) { asPriv = fixed.priv; asPub = fixed.pub; }
  else { const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]); asPriv = kp.privateKey; asPub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)); }
  const uaKey = await crypto.subtle.importKey("raw", ua, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPriv, 256));
  const salt = fixed ? fixed.salt : crypto.getRandomValues(new Uint8Array(16));
  const hk = async (ikm, s, info, bits) => crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: s, info }, await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), bits);
  const ikm = new Uint8Array(await hk(secret, auth, cat(enc.encode("WebPush: info\0"), ua, asPub), 256));
  const cek = new Uint8Array(await hk(ikm, salt, enc.encode("Content-Encoding: aes128gcm\0"), 128));
  const nonce = new Uint8Array(await hk(ikm, salt, enc.encode("Content-Encoding: nonce\0"), 96));
  const data = cat(typeof payload === "string" ? enc.encode(payload) : payload, new Uint8Array([2]));   // 2 = this is the last (only) record
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]), data));
  return cat(salt, new Uint8Array([0, 0, 0x10, 0]), new Uint8Array([asPub.length]), asPub, ct);
}

async function sendOne(env, sub, payload) {
  try {
    const body = await encrypt(JSON.stringify(payload), sub.keys.p256dh, sub.keys.auth);
    const r = await fetch(sub.endpoint, { method: "POST", headers: { "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "normal", Authorization: await vapidHeader(env, sub.endpoint) }, body });
    return r.status;
  } catch { return 0; }
}

const clean = (s, n) => String(s || "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
const okSub = (s) => s && typeof s.endpoint === "string" && /^https:\/\/[^\s]{8,600}$/.test(s.endpoint) && s.keys && typeof s.keys.p256dh === "string" && typeof s.keys.auth === "string" && s.keys.p256dh.length < 200 && s.keys.auth.length < 60;
const recKey = (uid) => "push/" + uid + ".json";
async function load(env, uid) { const o = await env.PHOTOS.get(recKey(uid)); if (!o) return null; try { return await o.json(); } catch { return null; } }

export async function onRequest({ request, env }) {
  if (!env.PHOTOS) return json({ error: "no-bucket" }, 503);
  const url = new URL(request.url), m = request.method;
  if (m === "GET") {
    if (!url.searchParams.has("key")) return json({ error: "bad-request" }, 400);
    try { return json({ key: (await vapid(env)).pub }); } catch { return json({ error: "no-key" }, 503); }
  }
  if (m !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
  const uid = await who(request);
  if (!uid) return json({ error: "auth" }, 401);
  const len = +request.headers.get("Content-Length");
  if (len > 60000) return json({ error: "too-big" }, 413);
  let b; try { b = await request.json(); } catch { return json({ error: "bad-json" }, 400); }
  const action = b && b.action;

  if (action === "sub") {
    if (!okSub(b.sub)) return json({ error: "bad-sub" }, 400);
    const friends = [...new Set((Array.isArray(b.friends) ? b.friends : []).filter((x) => typeof x === "string" && UID_RE.test(x)))].slice(0, MAX_FRIENDS);
    const rec = (await load(env, uid)) || { subs: [], friends: [], last: {} };
    rec.subs = [{ endpoint: b.sub.endpoint, keys: { p256dh: b.sub.keys.p256dh, auth: b.sub.keys.auth } }, ...rec.subs.filter((s) => s.endpoint !== b.sub.endpoint)].slice(0, MAX_SUBS);
    rec.friends = friends;
    await env.PHOTOS.put(recKey(uid), JSON.stringify(rec));
    return json({ ok: true, phones: rec.subs.length });
  }
  if (action === "unsub") {
    const rec = await load(env, uid);
    if (rec) { rec.subs = rec.subs.filter((s) => s.endpoint !== b.endpoint); if (rec.subs.length) await env.PHOTOS.put(recKey(uid), JSON.stringify(rec)); else await env.PHOTOS.delete(recKey(uid)); }
    return json({ ok: true });
  }
  if (action === "notify") {
    const kind = b.kind === "recap" ? "recap" : "post";
    const to = [...new Set((Array.isArray(b.to) ? b.to : []).filter((x) => typeof x === "string" && UID_RE.test(x) && x !== uid))].slice(0, MAX_TO);
    const name = clean(b.name, 24) || "A friend", sp = clean(b.species, 30), yr = Math.min(2100, Math.max(2000, parseInt(b.year, 10) || new Date().getFullYear()));
    const payload = kind === "recap"
      ? { t: `🎞️ @${name}'s ${yr} in fish is up`, b: "Watch their year on the water.", u: "/?go=feed", tag: "recap-" + uid }
      : { t: `🎣 @${name} just posted a catch`, b: sp ? `${sp}. Tap to see it.` : "Tap to see it.", u: "/?go=feed", tag: "post-" + uid };
    let sent = 0;
    const now = Date.now();
    await Promise.all(to.map(async (rid) => {
      const rec = await load(env, rid);
      if (!rec || !rec.subs?.length || !(rec.friends || []).includes(uid)) return;
      const last = rec.last || (rec.last = {}), k = kind + uid;
      if (now - (last[k] || 0) < GAP_MS) return;
      last[k] = now;
      for (const kk of Object.keys(last)) if (now - last[kk] > 86400e3) delete last[kk];
      const dead = [];
      for (const s of rec.subs) { const st = await sendOne(env, s, payload); if (st >= 200 && st < 300) sent++; else if (st === 404 || st === 410) dead.push(s.endpoint); }
      if (dead.length) rec.subs = rec.subs.filter((s) => !dead.includes(s.endpoint));
      if (rec.subs.length) await env.PHOTOS.put(recKey(rid), JSON.stringify(rec)); else await env.PHOTOS.delete(recKey(rid));
    }));
    return json({ ok: true, sent });
  }
  return json({ error: "bad-action" }, 400);
}
