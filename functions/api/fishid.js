// Weigh-In fish ID. Send a photo, get a best guess at the kind of fish.
//
//   POST /api/fishid   { image: "data:image/jpeg;base64,..." }   (needs the person's sign-in)  -> { species, confidence, alt }
//
// It uses Cloudflare's AI (Workers AI). To turn it on: Cloudflare Pages > weighin-app > Settings > Bindings > Add > Workers AI,
// and name the variable AI. Until then this answers 503 and the app says the feature isn't turned on yet.
// It is only a guess: the app always tells the person to check it themselves.

const PROJECT = "weigh-in-a3bbe";
const MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const MAX_CHARS = 700000;      // the app sends a small photo; this stops anything huge
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const JWKS = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const b64 = (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
const text = (s) => new TextDecoder().decode(b64(s));

let keyList = null, keyAt = 0; const keyCache = new Map();
async function keyFor(kid) {
  const now = Date.now();
  if (!keyList || now - keyAt > 3600e3 || (!keyList[kid] && now - keyAt > 60e3)) {
    const r = await fetch(JWKS);
    if (r.ok) { const j = await r.json(); keyList = {}; for (const k of j.keys || []) keyList[k.kid] = k; keyAt = now; keyCache.clear(); }
  }
  const jwk = keyList && keyList[kid]; if (!jwk) return null;
  if (!keyCache.has(kid)) keyCache.set(kid, crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
  return keyCache.get(kid);
}
async function who(request) {
  try {
    const h = request.headers.get("Authorization") || ""; if (!h.startsWith("Bearer ")) return "";
    const parts = h.slice(7).trim().split("."); if (parts.length !== 3) return "";
    const head = JSON.parse(text(parts[0])), body = JSON.parse(text(parts[1]));
    if (head.alg !== "RS256" || !head.kid) return "";
    const now = Math.floor(Date.now() / 1000);
    if (body.aud !== PROJECT || body.iss !== "https://securetoken.google.com/" + PROJECT) return "";
    if (!(body.exp > now) || body.iat > now + 300) return "";
    if (typeof body.sub !== "string" || !UID_RE.test(body.sub)) return "";
    const key = await keyFor(head.kid); if (!key) return "";
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
    return ok ? body.sub : "";
  } catch { return ""; }
}

const PROMPT = 'This is a photo of a fish an angler caught. Which species is it most likely? Answer with ONLY this JSON and nothing else: {"species":"common name","confidence":"high or medium or low","alt":["another possible common name"]}. If the picture does not show a fish, answer {"species":"","confidence":"low","alt":[]}.';
const pull = (r) => (r && (r.response ?? r.result?.response ?? r.result ?? "")) + "";

async function ask(env, image) {
  const run = () => env.AI.run(MODEL, { messages: [{ role: "user", content: PROMPT }], image });
  try { return await run(); }
  catch (e) {
    // The first use asks to accept Meta's license once. Accept it, then try again.
    if (/agree|licen[cs]e|terms/i.test(String(e && e.message))) { await env.AI.run(MODEL, { prompt: "agree" }); return await run(); }
    throw e;
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.AI) return json({ error: "off" }, 503);
  const uid = await who(request);
  if (!uid) return json({ error: "sign in" }, 401);
  let body; try { body = await request.json(); } catch { return json({ error: "bad" }, 400); }
  const image = body && body.image;
  if (typeof image !== "string" || !/^data:image\/(jpeg|webp|png);base64,/.test(image) || image.length > MAX_CHARS) return json({ error: "bad image" }, 400);
  try {
    const out = pull(await ask(env, image));
    const m = out.match(/\{[\s\S]*\}/);
    let j = null; try { j = m ? JSON.parse(m[0]) : null; } catch { j = null; }
    if (!j) return json({ species: "", confidence: "low", alt: [] });
    const clean = (s) => String(s || "").replace(/[^A-Za-z '()\-]/g, "").trim().slice(0, 40);
    return json({ species: clean(j.species), confidence: ["high", "medium", "low"].includes(j.confidence) ? j.confidence : "low", alt: (Array.isArray(j.alt) ? j.alt : []).map(clean).filter(Boolean).slice(0, 2) });
  } catch (e) { return json({ error: "ai failed" }, 502); }
}
export const onRequest = () => json({ error: "use POST" }, 405);
