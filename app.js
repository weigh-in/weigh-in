// Weigh-In: post catches, swipe the feed, run tournaments, keep a log, chat with friends.
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, sendPasswordResetEmail, GoogleAuthProvider, signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, getDoc, getDocs, addDoc, deleteDoc, updateDoc, onSnapshot,
  query, where, orderBy, limit, serverTimestamp, arrayUnion, documentId
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $app = document.getElementById("app");

/* ======================= tiny helpers ======================= */
// The browser turns a null child into the word "null". Skip empty children instead.
for (const m of ["append", "prepend", "replaceChildren"]) { const orig = Element.prototype[m]; Element.prototype[m] = function (...k) { return orig.apply(this, k.flat().filter((c) => c != null && c !== false)); }; }
function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v; // only ever used with our own icon SVGs
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) {
    if (c == null || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}
let toastTimer;
function toast(msg) {
  document.querySelector(".toast")?.remove();
  const t = el("div", { class: "toast", role: "status" }, msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 2800);
}
const pad2 = (n) => String(n).padStart(2, "0");
const localDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const fmtDayY = (s) => { const d = new Date(s + "T12:00:00"); return d.toLocaleDateString(undefined, d.getFullYear() === new Date().getFullYear() ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" }); };
// "2h ago", or "caught Oct 12" when the angler picked an earlier date
function catchLabel(p) {
  if (!p.catchDate) return ago(p.createdAt);
  const made = p.createdAt?.toMillis ? localDate(new Date(p.createdAt.toMillis())) : localDate(new Date());
  return p.catchDate === made ? ago(p.createdAt) : "caught " + fmtDayY(p.catchDate);
}
const catchMs = (p) => (p.catchDate ? new Date(p.catchDate + "T12:00:00").getTime() : (p.createdAt?.toMillis?.() ?? Date.now()));
const fmtDay = (s) => new Date(s + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
function ago(ts) {
  if (!ts) return "just now";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  if (s < 604800) return Math.floor(s / 86400) + "d ago";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
const fmtLb = (lb) => (lb ? `${Math.round(lb * 100) / 100} lb` : "");
const fmtIn = (i) => (i ? `${Math.round(i * 100) / 100} in` : "");
function sizeText(p) { return [fmtLb(p.lb), fmtIn(p.inches)].filter(Boolean).join(" · ") || "Size not entered"; }
function errText(e) {
  const c = e?.code || "";
  if (c.includes("permission-denied")) return "That isn't allowed. Check that you're signed in.";
  if (c.includes("unavailable")) return "You're offline. Try again when you have signal.";
  if (c.includes("email-already-in-use")) return "That email already has an account. Sign in instead.";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found")) return "Email or password is wrong.";
  if (c.includes("weak-password")) return "Use a password with at least 6 characters.";
  if (c.includes("invalid-email")) return "That email doesn't look right.";
  if (c.includes("too-many-requests")) return "Too many tries. Wait a minute and try again.";
  return "Something went wrong. Try again.";
}

const ICON = {
  swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg>',
  feed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12c3-5 9-6 14-3l5-3-1 6 1 6-5-3c-5 3-11 2-14-3z"/><circle cx="7" cy="11" r="1" fill="currentColor"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/></svg>',
  log: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h11l3 3v15H5z"/><path d="M9 9h6M9 13h6M9 17h4"/></svg>',
  friends: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14a5 5 0 0 1 6 5"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
  map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  me: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="3.5"/><path d="M9 2.5v1.5M2.5 9H4M4.4 4.4l1 1M13.6 4.4l-1 1"/><path d="M8 20h10a3.5 3.5 0 0 0 .5-7 5 5 0 0 0-9.4 1A3 3 0 0 0 8 20z"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
  ban: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5S3 15 3 8.8A4.8 4.8 0 0 1 12 6.6a4.8 4.8 0 0 1 9 2.2C21 15 12 20.5 12 20.5z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
};

/* ======================= Firebase ======================= */
if (!firebaseConfig.apiKey || firebaseConfig.apiKey.includes("PASTE")) {
  $app.replaceChildren(el("div", { class: "auth" }, el("div", { class: "box" },
    el("h1", null, "Almost there"),
    el("p", null, "Weigh-In isn't connected to your Firebase project yet. Open firebase-config.js and paste in your config (step 4 in the README)."))));
  throw new Error("Firebase config missing");
}
const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);

/* ======================= avatars + photo helpers ======================= */
const userCache = new Map();
function getUser(uid) {
  let v = userCache.get(uid);
  if (!v) { v = getDoc(doc(db, "users", uid)).then((s) => (s.exists() ? s.data() : {})).catch(() => ({})); userCache.set(uid, v); }
  return v;
}
function hue(str) { let h = 0; for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; }
function avatar(uid, name, size = 32) {
  const n = el("span", { class: "av", style: `--s:${size}px;background:hsl(${hue(name || uid)} 45% 36%)`, "aria-hidden": "true" }, (name || "?")[0].toUpperCase());
  getUser(uid).then((u) => { if (u?.photo) n.replaceChildren(el("img", { src: u.photo, alt: "" })); });
  return n;
}
function loadImage(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
async function squarePhoto(file, size = 256) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const side = Math.min(img.width, img.height);
    const c = document.createElement("canvas"); c.width = c.height = size;
    c.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
    return c.toDataURL("image/jpeg", 0.82);
  } finally { URL.revokeObjectURL(url); }
}
async function thumbFrom(dataUrl, max = 160) {
  try {
    const i = await loadImage(dataUrl);
    const sc = Math.min(1, max / Math.max(i.width, i.height));
    const c = document.createElement("canvas"); c.width = Math.round(i.width * sc); c.height = Math.round(i.height * sc);
    c.getContext("2d").drawImage(i, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.6);
  } catch { return ""; }
}
/* ---------- color themes ---------- */
const THEMES = [["auto", "Auto", "Follows your phone"], ["light", "Light", "Green and orange"], ["night", "Night", "Dark green"], ["black", "Black", "Black, red and blue"]];
const THEME_BAR = { light: "#1F5C4D", night: "#0E1B18", black: "#000000" };
const THEME_CSS = `
html[data-wtheme="light"]{--water:#E7EEEA;--surface:#FBFCF9;--line:#C9D6CF;--ink:#16302A;--muted:#5A6F67;--lake:#1F5C4D;--lake-soft:#D3E5DD;--deep:#0F2E26;--bobber:#D2452A;--bobber-ink:#FFFFFF;--gold:#B8871B;--shadow:0 1px 2px rgba(16,48,42,.06),0 6px 18px rgba(16,48,42,.07);--shadow-s:0 1px 2px rgba(16,48,42,.08);color-scheme:light}
html[data-wtheme="night"]{--water:#0E1B18;--surface:#162723;--line:#2A403A;--ink:#E4EEE9;--muted:#93A8A0;--lake:#6FC1A6;--lake-soft:#1F3A33;--deep:#0F2E26;--bobber:#F06A4B;--bobber-ink:#1A0D09;--gold:#E2B44A;--shadow:0 1px 2px rgba(0,0,0,.3),0 6px 18px rgba(0,0,0,.28);--shadow-s:0 1px 2px rgba(0,0,0,.35);color-scheme:dark}
html[data-wtheme="black"]{--water:#000000;--surface:#0E0E12;--line:#2B2B34;--ink:#F4F4F6;--muted:#9C9CAA;--lake:#4A7BE8;--lake-soft:#0F1B3D;--deep:#0A1230;--bobber:#E11D2E;--bobber-ink:#FFFFFF;--gold:#7FA2F5;--shadow:0 1px 2px rgba(0,0,0,.6),0 6px 18px rgba(0,0,0,.5);--shadow-s:0 1px 2px rgba(0,0,0,.6);color-scheme:dark}
html[data-wtheme="black"] .btn{box-shadow:0 2px 0 rgba(0,0,0,.5),0 6px 14px rgba(225,29,46,.3)}
html[data-wtheme="black"] .btn.ghost{box-shadow:none}
html[data-wtheme="black"] .field input,html[data-wtheme="black"] .field select,html[data-wtheme="black"] .field textarea{box-shadow:none}
html[data-wtheme="black"] .btn.ghost:active{background:var(--lake-soft)}
html[data-wtheme="black"] .tab.post .bob{box-shadow:0 0 0 1.5px var(--ink),0 8px 18px rgba(225,29,46,.4)}
html[data-wtheme="black"] nav.tabs{box-shadow:0 -6px 20px rgba(0,0,0,.6)}
html[data-wtheme="black"] .pb-pop{background:rgba(0,0,0,.8)}
html[data-wtheme="black"] .auth{background:#000;color:#F4F4F6}
html[data-wtheme="black"] .auth .field input{background:#0E0E12;border-color:#2B2B34;color:#F4F4F6}
html[data-wtheme="black"] .auth .hint,html[data-wtheme="black"] .or,html[data-wtheme="black"] .timer .label,html[data-wtheme="black"] .timer .hint{color:#9C9CAA}
html[data-wtheme="black"] .or::before,html[data-wtheme="black"] .or::after{background:#2B2B34}
html[data-wtheme="black"] .auth .link{color:#4A7BE8}
html[data-wtheme="black"] .auth .btn.ghost{color:#4A7BE8;border-color:#4A7BE8}
html[data-wtheme="black"] .timer{background:#0A1230;color:#F4F4F6}
html[data-wtheme="black"] .fc-card.hero{background:linear-gradient(135deg,#1E3A8A,#0A1230);color:#fff}
html[data-wtheme="black"] .update-bar{background:#1E3A8A}
html[data-wtheme="black"] .adv-hot{background:rgba(225,29,46,.18)}
html[data-wtheme="black"] .adv-feature{border-color:#4A7BE8;background:rgba(74,123,232,.1)}
html[data-wtheme="black"] .sch-bar i{background:#4A7BE8}
html[data-wtheme="black"] .sch-day.open{border-color:#4A7BE8}
html[data-wtheme="black"] .sch-rankup{background:#E11D2E}
html[data-wtheme="black"] .sch-opt.right{border-color:#4A7BE8;background:rgba(74,123,232,.18)}
html[data-wtheme="black"] .sch-opt.wrong{border-color:#E11D2E;background:rgba(225,29,46,.15)}
html[data-wtheme="black"] .sch-why.ok{background:rgba(74,123,232,.15);border-left-color:#4A7BE8}
html[data-wtheme="black"] .sch-why.bad{background:rgba(225,29,46,.12);border-left-color:#E11D2E}
html[data-wtheme="black"] .sch-opt.right .sch-let{background:#4A7BE8}
html[data-wtheme="black"] .sch-opt.wrong .sch-let{background:#E11D2E}
html[data-wtheme="black"] .pop .link{color:#4A7BE8}
html[data-wtheme="black"] .feed-empty,html[data-wtheme="black"] .feed-empty *{color:#F4F4F6}
`;
function applyTheme() {
  let t = "auto"; try { t = localStorage.getItem("weighin-theme") || "auto"; } catch { /* ok */ }
  if (!THEMES.some((x) => x[0] === t)) t = "auto";
  if (!document.getElementById("theme-css")) { const st = document.createElement("style"); st.id = "theme-css"; st.textContent = THEME_CSS; document.head.append(st); }
  if (t === "auto") document.documentElement.removeAttribute("data-wtheme"); else document.documentElement.setAttribute("data-wtheme", t);
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute("content", THEME_BAR[t] || (matchMedia("(prefers-color-scheme: dark)").matches ? "#0E1B18" : "#1F5C4D"));
}
applyTheme();
function getPref(k, d) { try { return localStorage.getItem("weighin-" + k) || d; } catch { return d; } }
function setPref(k, v) { try { localStorage.setItem("weighin-" + k, v); } catch { /* private mode */ } }

/* ======================= app state ======================= */
const S = {
  user: null, name: "", tab: "feed",
  posts: [], tournaments: [], log: [],
  reqIn: [], reqOut: [], friendships: [], unread: new Set(), chatOpen: null, recaps: [], offIn: [], offOut: [], tradeAll: [], tradeMine: [], tourReqs: [], joinIn: [], joinOut: [],
  openTournament: null, tourPosts: [], viewing: null, creatingTour: false,
  meView: "main", mine: [], spots: [], map: null, markers: null, likes: new Map(), mod: null,
};
const unsubs = [];
let tourUnsub = null, meUnsub = null;
function stopAll() { unsubs.splice(0).forEach((u) => u()); stopTrade(); tourUnsub?.(); tourUnsub = null; meUnsub?.(); meUnsub = null; destroyMap(); stopOwner(); cardCache.clear(); S.mine = []; }

/* ======================= auth screens ======================= */
const NAME_RE = /^[A-Za-z0-9_]{2,20}$/;

/* ---------- house rules: keep slurs out of names, posts, comments and chat ---------- */
const OWNER_EMAIL = "teokosuge8@gmail.com"; // the person who runs the app (must sign in with a verified Google account)
const BLOCK_PATTERNS = [/n+i+g{2,}[ea]+/, /f+a+g{2,}o+t/, /t+r+a+n+n+y+/, /w+e+t+b+a+c+k/];  // always bad, even inside other words
const BLOCK_WORDS = new Set(["kike", "kikes", "spic", "spics", "chink", "chinks", "gook", "gooks", "coon", "coons", "beaner", "beaners", "dyke", "dykes", "paki", "retard", "retards", "retarded", "fag", "fags"]);
function badText(text) {
  const base = String(text || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const leet = base.replace(/[013457@$!|]/g, (c) => ({ "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i", "|": "i" }[c]));
  const squashed = leet.replace(/[^a-z]/g, "");
  if (BLOCK_PATTERNS.some((re) => re.test(squashed))) return true;
  return leet.split(/[^a-z]+/).some((w) => BLOCK_WORDS.has(w));
}
const NO_SLURS = "That includes language that isn't allowed here. Please change it.";
const PERMS = [["deletePosts", "Delete catches"], ["deleteComments", "Delete comments"], ["reports", "See and handle reports"], ["ban", "Ban and unban anglers"], ["warn", "Warn anglers"]];
const MODERN_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}";
const MODERN_OPTS = { maxZoom: 19, attribution: "Tiles &copy; Esri, HERE, Garmin, OpenStreetMap contributors" };
const US_STATES = [["AL","Alabama"],["AK","Alaska"],["AZ","Arizona"],["AR","Arkansas"],["CA","California"],["CO","Colorado"],["CT","Connecticut"],["DE","Delaware"],["DC","District of Columbia"],["FL","Florida"],["GA","Georgia"],["HI","Hawaii"],["ID","Idaho"],["IL","Illinois"],["IN","Indiana"],["IA","Iowa"],["KS","Kansas"],["KY","Kentucky"],["LA","Louisiana"],["ME","Maine"],["MD","Maryland"],["MA","Massachusetts"],["MI","Michigan"],["MN","Minnesota"],["MS","Mississippi"],["MO","Missouri"],["MT","Montana"],["NE","Nebraska"],["NV","Nevada"],["NH","New Hampshire"],["NJ","New Jersey"],["NM","New Mexico"],["NY","New York"],["NC","North Carolina"],["ND","North Dakota"],["OH","Ohio"],["OK","Oklahoma"],["OR","Oregon"],["PA","Pennsylvania"],["RI","Rhode Island"],["SC","South Carolina"],["SD","South Dakota"],["TN","Tennessee"],["TX","Texas"],["UT","Utah"],["VT","Vermont"],["VA","Virginia"],["WA","Washington"],["WV","West Virginia"],["WI","Wisconsin"],["WY","Wyoming"]];
const US_BOUNDS = [[17, -180], [72, -64]];   // the map stays on the USA (including Alaska and Hawaii)
const placeLabel = (x) => [x.city, x.state].filter(Boolean).join(", ");
const OWNER_UID = "whNN0b8nbhdQiK8osrBa48SEtm82"; // moderators can't delete or ban this account
const canOn = (perm, ownerUid) => !!(S.owner || (S.mod && S.mod[perm] && ownerUid !== OWNER_UID));
const can = (perm) => !!(S.owner || (S.mod && S.mod[perm]));
const canPubTour = () => !!(S.owner || S.tourAcc);
const isStaff = () => !!(S.owner || S.mod);
const editOn = () => isStaff() && !!S.editMode;   // owner buttons only show while Edit mode is on
const isBad = (...parts) => parts.some((x) => badText(x));

function renderAuth(mode = "signin") {
  const isNew = mode === "signup";
  const msg = el("p", { class: "hint", role: "alert" });
  const f = el("form", { novalidate: true },
    isNew ? el("label", { class: "field" }, el("span", null, "Angler name"),
      el("input", { name: "name", id: "a-name", autocomplete: "nickname", maxlength: 20, placeholder: "BassBoss22", required: true }),
      el("span", { class: "hint" }, "2 to 20 letters, numbers or _. This is what friends see and search for.")) : null,
    el("label", { class: "field" }, el("span", null, "Email"),
      el("input", { name: "email", id: "a-email", type: "email", autocomplete: "email", required: true })),
    el("label", { class: "field" }, el("span", null, "Password"),
      el("input", { name: "pw", id: "a-pw", type: "password", autocomplete: isNew ? "new-password" : "current-password", minlength: 6, required: true })),
    el("label", { class: "row", style: "gap:8px;flex-wrap:nowrap;cursor:pointer;align-self:flex-start;font-size:.95rem" },
      el("input", { type: "checkbox", id: "a-showpw", style: "width:20px;height:20px", onchange: (e) => { document.querySelector("#a-pw").type = e.target.checked ? "text" : "password"; } }), "Show password"),
    msg,
    el("button", { class: "btn wide", type: "submit" }, isNew ? "Create account" : "Sign in"));
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const email = String(fd.get("email") || "").trim(), pw = String(fd.get("pw") || "");
    msg.textContent = "";
    try {
      if (isNew) {
        const name = String(fd.get("name") || "").trim();
        if (!NAME_RE.test(name)) { msg.textContent = "Angler name must be 2 to 20 letters, numbers or _."; return; }
        if (badText(name)) { msg.textContent = "That name isn't allowed. Pick another one."; return; }
        pendingName = name;
        await createUserWithEmailAndPassword(auth, email, pw);
      } else {
        await signInWithEmailAndPassword(auth, email, pw);
      }
    } catch (err) { msg.textContent = errText(err); }
  });
  $app.replaceChildren(el("div", { class: "auth" }, el("div", { class: "box" },
    el("h1", null, "Weigh-In"),
    el("p", null, "Post your catches, run tournaments with friends, and see who's got the biggest fish."),
    f,
    el("div", { class: "or" }, "or"),
    el("button", { class: "btn ghost wide", type: "button", onclick: async () => {
      msg.textContent = "";
      try { await signInWithPopup(auth, new GoogleAuthProvider()); }
      catch (err) { if (!/popup-closed|cancelled-popup/.test(err?.code || "")) msg.textContent = "Google sign-in didn't work here. Use your email and password instead."; }
    } }, "Continue with Google"),
    el("button", { class: "link", type: "button", style: "align-self:flex-start", onclick: openPrivacy }, "How Weigh-In uses your info"),
    isInstalled() ? null : el("button", { class: "link", type: "button", style: "align-self:flex-start", id: "a-install", onclick: installApp }, "Install the app"),
    el("div", { class: "row spread" },
      el("button", { class: "link", type: "button", onclick: () => renderAuth(isNew ? "signin" : "signup") },
        isNew ? "I already have an account" : "Create an account"),
      !isNew ? el("button", { class: "link", type: "button", onclick: async () => {
        const email = f.querySelector("#a-email").value.trim();
        if (!email) { msg.textContent = "Type your email above first."; return; }
        try { await sendPasswordResetEmail(auth, email); msg.textContent = "Check your email for a reset link."; }
        catch (err) { msg.textContent = errText(err); }
      } }, "Forgot password") : null))));
}

function renderPickName(note) {
  const msg = el("p", { class: "hint", role: "alert" }, note || "");
  const f = el("form", { novalidate: true },
    el("label", { class: "field" }, el("span", null, "Angler name"),
      el("input", { name: "name", id: "p-name", maxlength: 20, placeholder: "BassBoss22", required: true })),
    msg, el("button", { class: "btn wide", type: "submit" }, "Save name"));
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = String(new FormData(f).get("name") || "").trim();
    if (!NAME_RE.test(name)) { msg.textContent = "Use 2 to 20 letters, numbers or _."; return; }
    if (badText(name)) { msg.textContent = "That name isn't allowed. Pick another one."; return; }
    const ok = await claimName(name);
    if (ok) startApp(); else msg.textContent = `"${name}" is taken. Try another.`;
  });
  $app.replaceChildren(el("div", { class: "auth" }, el("div", { class: "box" },
    el("h1", null, "Pick your name"), f,
    el("button", { class: "link", type: "button", onclick: () => signOut(auth) }, "Sign out"))));
}

let pendingName = "";
async function claimName(name) {
  const uid = S.user.uid;
  try {
    await setDoc(doc(db, "usernames", name.toLowerCase()), { uid, name });
  } catch (e) {
    // The name already belongs to someone. If it's us (retry), that's fine.
    try { const d = await getDoc(doc(db, "usernames", name.toLowerCase())); if (d.exists() && d.data().uid === uid) { /* ours */ } else return false; }
    catch { return false; }
  }
  await setDoc(doc(db, "users", uid), { name, createdAt: serverTimestamp() });
  S.name = name;
  return true;
}

onAuthStateChanged(auth, async (user) => {
  stopAll();
  S.user = user;
  S.owner = !!(user && user.emailVerified && String(user.email || "").toLowerCase() === OWNER_EMAIL);
  S.banned = false; S.mod = null; S.editMode = false; S.tourAcc = false;
  if (!user) { renderAuth(); return; }
  $app.replaceChildren(el("div", { class: "boot" }, "Loading…"));
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) { S.name = snap.data().name; S.nameAt = snap.data().nameAt?.toMillis?.() || 0; startApp(); return; }
    if (pendingName) {
      const ok = await claimName(pendingName); pendingName = "";
      if (ok) { startApp(); return; }
      renderPickName("That angler name was just taken. Pick another one.");
      return;
    }
    renderPickName();
  } catch (e) {
    $app.replaceChildren(el("div", { class: "auth" }, el("div", { class: "box" },
      el("h1", null, "Can't connect"), el("p", null, "Check that Firestore is turned on and the security rules are published (README steps 2 and 3)."),
      el("button", { class: "btn", type: "button", onclick: () => location.reload() }, "Try again"))));
  }
});

/* ======================= main app ======================= */
function startApp() {
  stopAll(); S.postsSeen = false; S.cash = ""; getUser(S.user.uid).then((u) => { S.cash = cashTag(u?.cash); if (S.tab === "me") renderTab(); }); S.trade = null; S.tradeAll = []; S.tradeMine = []; S.offIn = []; S.offOut = []; S.tradeErr = false;
  const uid = S.user.uid;
  fcCloudSync();
  watchMine();
  unsubs.push(onSnapshot(query(collection(db, "recaps"), orderBy("createdAt", "desc"), limit(30)), (sn) => {
    S.recaps = sn.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    const b = document.querySelector("#rc-btn"); if (b) b.hidden = !S.recaps.length;
    if (document.querySelector("#rc-list")) paintRecaps();
  }, () => {}));
  unsubs.push(onSnapshot(query(collection(db, "warnings"), where("to", "==", uid)), (sn) => showWarnings(sn.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))), () => {}));
  unsubs.push(() => { msgUns.forEach((u) => u()); msgUns.clear(); S.unread.clear(); S.chatOpen = null; });
  setTimeout(() => { if (S.user && S.user.uid === uid && wrapSeason() && !getPref("wrapped" + wrapYear(), "")) openWrapped(wrapYear(), true); }, 6000);
  unsubs.push(onSnapshot(query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(40)), (s) => {
    S.posts = s.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    if (S.postsSeen) s.docChanges().forEach((ch) => { if (ch.type !== "added") return; const p = { id: ch.doc.id, ...ch.doc.data({ serverTimestamps: "estimate" }) }; if (p.pb && p.uid !== uid) pbAlert(p); });
    if (S.postsSeen) s.docChanges().forEach((ch) => { if (ch.type === "added") checkBeaten([{ id: ch.doc.id, ...ch.doc.data({ serverTimestamps: "estimate" }) }]); });
    else setTimeout(() => { const since = +getPref("pbseenAt", "0"); if (since) checkBeaten(S.posts.filter((x) => (x.createdAt?.toMillis?.() || 0) > since)); setPref("pbseenAt", String(Date.now())); }, 3500);
    S.postsSeen = true;
    if (S.tab === "feed") renderFeedCards();
  }, () => {}));
  unsubs.push(onSnapshot(query(collection(db, "tradeOffers"), where("tuid", "==", uid)), (s) => {
    S.offIn = s.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) })); updateDot(); S.tradePaint?.();
  }, () => {}));
  unsubs.push(onSnapshot(query(collection(db, "tradeOffers"), where("uid", "==", uid)), (s) => {
    S.offOut = s.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) })); updateDot(); S.tradePaint?.();
  }, () => {}));
  unsubs.push(onSnapshot(S.owner ? collection(db, "tourRequests") : query(collection(db, "tourRequests"), where("uid", "==", uid)), (s) => {
    S.tourReqs = s.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    if (S.tab === "tours" && !S.creatingTour && !S.openTournament) renderTab();
  }, () => {}));
  unsubs.push(onSnapshot(query(collection(db, "tourJoins"), where("org", "==", uid)), (s) => {
    S.joinIn = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (S.tab === "tours" && !S.creatingTour) renderTab();
  }, () => {}));
  unsubs.push(onSnapshot(query(collection(db, "tourJoins"), where("uid", "==", uid)), (s) => {
    S.joinOut = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (S.tab === "tours" && !S.creatingTour) renderTab();
  }, () => {}));
  unsubs.push(onSnapshot(collection(db, "tournaments"), (s) => {
    S.tournaments = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (S.tab === "tours") renderTab();
  }, () => {}));
  unsubs.push(onSnapshot(query(collection(db, "users", uid, "log"), orderBy("date", "desc")), (s) => {
    S.log = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    refreshMe("log");
  }, () => {}));
  unsubs.push(onSnapshot(query(collection(db, "requests"), where("to", "==", uid)), (s) => {
    S.reqIn = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    updateDot(); refreshMe("friends");
  }, () => {}));
  unsubs.push(onSnapshot(query(collection(db, "requests"), where("from", "==", uid)), (s) => {
    S.reqOut = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    refreshMe("friends");
  }, () => {}));
  unsubs.push(onSnapshot(query(collection(db, "friendships"), where("members", "array-contains", uid)), (s) => {
    S.friendships = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    syncMsgWatch();
    refreshMe("friends");
  }, () => {}));
  unsubs.push(onSnapshot(query(collection(db, "spots"), orderBy("createdAt", "desc"), limit(300)), (s) => {
    S.spots = s.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    if (S.tab === "map" && S.map) { S.paintMapBar?.(); drawSpots(false); }
    if (S.tab === "feed") paintSpotBtns();
  }, () => {}));
  unsubs.push(onSnapshot(query(collection(db, "likes"), orderBy("createdAt", "desc"), limit(1000)), (s) => {
    const m = new Map();
    for (const d of s.docs) { const x = d.data({ serverTimestamps: "estimate" }); if (!m.has(x.postId)) m.set(x.postId, new Set()); m.get(x.postId).add(x.uid); }
    S.likes = m; paintLikes(); if (S.tab === "me" && (S.meView === "main" || S.meView === "profile")) renderTab();
  }, () => {}));
  unsubs.push(onSnapshot(doc(db, "mods", uid), (d) => {
    const next = d.exists() ? (d.data().perms || {}) : null;
    if (JSON.stringify(next) === JSON.stringify(S.mod)) return;
    S.mod = next; cardCache.clear();
    if (S.tab === "feed") renderFeedCards(); else if (S.tab === "me") renderTab();
  }, () => {}));
  unsubs.push(onSnapshot(doc(db, "bans", uid), (d) => { if (d.exists() && !S.owner) showBanned(); }, () => {}));
  unsubs.push(onSnapshot(doc(db, "tourAccess", uid), (d) => {
    if (d.exists() === S.tourAcc) return;
    S.tourAcc = d.exists(); if (S.tab === "tours" && !S.creatingTour && !S.openTournament) renderTab();
  }, () => {}));
  buildShell();
}
function showBanned() {
  S.banned = true; stopAll();
  $app.replaceChildren(el("div", { class: "auth" }, el("div", { class: "box" },
    el("h1", null, "Account removed"),
    el("p", null, "The person who runs Weigh-In removed this account for breaking the rules (fishing photos only, no slurs or hate, be kind). You can't post, comment, or chat anymore."),
    el("button", { class: "btn", type: "button", onclick: () => signOut(auth) }, "Sign out"))));
}
function refreshMe(view) { if (S.tab === "me" && (S.meView === view || S.meView === "main")) renderTab(); }

let $screen, $nav;
function buildShell() {
  $screen = el("div", { class: "screen" });
  const tabs = [["feed", "Feed", ICON.feed], ["trade", "Trade", ICON.swap], ["map", "Map", ICON.map], ["post", "Post", ICON.plus], ["bite", "Bite", ICON.sun], ["tours", "Tourneys", ICON.trophy], ["me", "Me", ICON.me]];
  $nav = el("nav", { class: "tabs", "aria-label": "Sections" }, el("div", { class: "in" }, tabs.map(([k, label, icon]) =>
    el("button", { class: "tab" + (k === "post" ? " post" : ""), type: "button", "data-tab": k, onclick: () => go(k) },
      k === "post" ? el("span", { class: "bob", html: icon }) : el("span", { html: icon }), label,
      k === "me" || k === "trade" ? el("span", { class: "dot", hidden: true }) : null))));
  $app.replaceChildren($screen, $nav);
  go(S.tab);
}
function go(tab) {
  if (tab === "me") S.meView = "main";
  if (tab === "trade" && S.tab !== "trade" && S.trade) S.trade.open = null;
  S.tab = tab;
  if (tab !== "tours") { S.openTournament = null; S.creatingTour = false; tourUnsub?.(); tourUnsub = null; }
  $nav.querySelectorAll(".tab").forEach((b) => b.dataset.tab === tab ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
  renderTab();
}
function updateDot() {
  $nav?.querySelector(".tab[data-tab=me] .dot")?.toggleAttribute("hidden", S.reqIn.length === 0 && !unseenUpdate() && !S.unread.size);
  $nav?.querySelector(".tab[data-tab=trade] .dot")?.toggleAttribute("hidden", !tradeUnseen());
}
function renderTab() {
  clearInterval(tick);
  if (S.tab !== "me" || S.meView !== "owner") stopOwner();
  if (S.tab !== "map") destroyMap();
  if (S.tab !== "trade") stopTrade();
  if (S.tab === "feed") return renderFeed();
  if (S.tab === "map") return renderMap();
  if (S.tab === "me") watchMine();
  $screen.className = "screen";
  const p = el("div", { class: "pad" });
  ({ post: viewPost, bite: viewBite, tours: viewTours, me: viewMe, trade: viewTrade })[S.tab](p);
  $screen.replaceChildren(p);
  updateDot();
}

/* ======================= BITE: weather + what's biting ======================= */
const WX_CODES = [[0, "Clear"], [2, "Partly cloudy"], [3, "Overcast"], [48, "Fog"], [57, "Drizzle"], [67, "Rain"], [77, "Snow"], [82, "Showers"], [86, "Snow showers"], [99, "Thunderstorms"]];
const wxName = (c) => (WX_CODES.find(([max]) => c <= max) || [0, "Unknown"])[1];
const wxCache = {};
async function fetchWeather(loc) {
  const key = loc.lat + "," + loc.lng;
  if (wxCache[key] && Date.now() - wxCache[key].at < 600000) return wxCache[key].data;
  const url = "https://api.open-meteo.com/v1/forecast?latitude=" + loc.lat + "&longitude=" + loc.lng +
    "&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,pressure_msl,cloud_cover" +
    "&hourly=temperature_2m,pressure_msl,precipitation_probability,weather_code,wind_speed_10m" +
    "&daily=sunrise,sunset&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&past_hours=6&forecast_hours=12&forecast_days=2";
  const r = await fetch(url);
  if (!r.ok) throw new Error("Weather service said " + r.status);
  const data = await r.json();
  wxCache[key] = { at: Date.now(), data };
  return data;
}
const compass = (d) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(d / 45) % 8];
function biteScore(w) {
  const c = w.current, h = w.hourly;
  const i = Math.max(0, h.time.findIndex((t) => t.slice(0, 13) === c.time.slice(0, 13)));
  const dP = i >= 6 ? c.pressure_msl - h.pressure_msl[i - 6] : 0; // hPa over the last ~6 hours
  let s = 50; const why = [];
  if (dP <= -1 && dP > -4) { s += 20; why.push("Pressure is slowly falling. Fish often feed before weather moves in."); }
  else if (dP <= -4) { s += 0; why.push("Pressure is dropping fast, so a front is close."); }
  else if (Math.abs(dP) < 1) { s += 10; why.push("Pressure is steady."); }
  else if (dP >= 4) { s -= 10; why.push("Pressure is climbing fast, which can slow the bite."); }
  else { s += 3; why.push("Pressure is slowly rising."); }
  const wind = c.wind_speed_10m;
  if (wind < 12) { s += 15; why.push("Light wind."); } else if (wind > 20) { s -= 20; why.push("Strong wind makes casting and boating harder."); } else why.push("Moderate wind.");
  if (c.weather_code >= 95) { s -= 30; why.push("Thunderstorms. Stay off the water."); }
  else if (c.weather_code >= 61 && c.weather_code <= 82) { s -= 8; why.push("Wet weather."); }
  else if (c.cloud_cover > 50) { s += 8; why.push("Cloud cover can make fish less shy."); }
  const now = new Date(c.time).getTime();
  const near = [...(w.daily.sunrise || []), ...(w.daily.sunset || [])].some((t) => Math.abs(new Date(t).getTime() - now) < 90 * 60000);
  if (near) { s += 15; why.push("Close to sunrise or sunset, a classic feeding time."); }
  s = Math.max(5, Math.min(98, s));
  return { s, label: s >= 80 ? "Great" : s >= 62 ? "Good" : s >= 42 ? "Fair" : "Slow", why, dP };
}
const timeOf = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
function windRating(mph) { return mph < 8 ? ["good", "Good"] : mph <= 15 ? ["ok", "Okay"] : ["bad", "Tough"]; }
function pressureRating(dP) {
  if (dP <= -1 && dP > -4) return ["good", "Good"];
  if (Math.abs(dP) < 1) return ["good", "Good"];
  if (dP <= -4) return ["ok", "Front coming"];
  if (dP >= 4) return ["bad", "Slow"];
  return ["ok", "Okay"];
}
function condTile(name, big, sub, [cls, word]) {
  return el("div", { class: "cond" },
    el("span", { class: "cond-n" }, name),
    el("b", { class: "cond-v" }, big),
    el("span", { class: "cond-s" }, sub),
    el("span", { class: "tag " + cls }, word));
}
/* Rules of thumb only. Fish don't follow a schedule. */
const FISH_TIPS = [
  { n: "Largemouth bass", when: ["dawn", "dusk"], tip: "Bites best at first and last light, and on cloudy days. In hot weather they sit in shade and cover at midday. A slow pressure drop before a front often turns them on." },
  { n: "Catfish", when: ["dusk", "night"], tip: "Mostly feed at night and in the evening. Warm water and a little rise after rain help. Fish deep holes by day, shallows after dark." },
  { n: "Crappie", when: ["dawn", "dusk"], tip: "Early morning and evening, near brush, docks and fallen trees. Calm, steady weather is best." },
  { n: "Walleye", when: ["dawn", "dusk", "night"], tip: "Low light is their time: dawn, dusk and after dark. Cloud and a light chop make them bolder in daytime." },
  { n: "Trout", when: ["dawn", "dusk"], tip: "Morning and evening, in cool water. Overcast days and a light drizzle can keep them biting through the day." },
  { n: "Bluegill and panfish", when: ["day"], tip: "Mid-morning to mid-afternoon on warm, calm, sunny days, close to shore and weeds." },
  { n: "Northern pike", when: ["dawn", "day", "dusk"], tip: "Cool, cloudy days are best. They often hit hard just before a front, and feed on and off all day." },
];
const WINDOW_NAMES = { dawn: "Sunrise", day: "Midday", dusk: "Sunset", night: "After dark" };
function dayWindows(w) {
  const H = 3600000, out = [];
  const rise = w.daily.sunrise || [], set = w.daily.sunset || [];
  rise.forEach((t) => { const x = new Date(t).getTime(); out.push({ k: "dawn", a: x - H, b: x + 1.5 * H }); out.push({ k: "day", a: x + 4 * H, b: x + 8 * H }); });
  set.forEach((t) => { const x = new Date(t).getTime(); out.push({ k: "dusk", a: x - 1.5 * H, b: x + H }); out.push({ k: "night", a: x + H, b: x + 4 * H }); });
  return out.sort((p, q) => p.a - q.a);
}
function bestTimes(w) {
  const now = new Date(w.current.time).getTime();
  const wins = dayWindows(w).filter((x) => x.b > now);
  const range = (x) => timeOf(new Date(Math.max(x.a, now))) + " to " + timeOf(new Date(x.b));
  const dayName = (x) => { const d = new Date(x.a), n = new Date(now); return d.getDate() === n.getDate() ? "Today" : "Tomorrow"; };
  const sel = el("select", { "aria-label": "Fish type for best times" }, FISH_TIPS.map((f, i) => el("option", { value: String(i) }, f.n)));
  const out = el("div", { class: "stack", style: "gap:8px" });
  const draw = () => {
    const f = FISH_TIPS[+sel.value || 0];
    const mine = wins.filter((x) => f.when.includes(x.k)).slice(0, 4);
    out.replaceChildren(
      el("ul", { class: "times" }, mine.length
        ? mine.map((x) => el("li", null, el("b", null, `${dayName(x)} ${WINDOW_NAMES[x.k].toLowerCase()}`), el("span", null, range(x))))
        : [el("li", null, el("span", null, "No good windows left in this forecast. Check again later."))]),
      el("p", { class: "small" }, f.tip));
  };
  sel.addEventListener("change", draw);
  draw();
  return el("div", { class: "bite" },
    el("b", null, "Best times to fish"),
    sel, out,
    el("p", { class: "muted small" }, "Rules of thumb, not guarantees. Times come from sunrise and sunset where you picked."));
}
function viewBite(p) {
  p.append(el("h1", null, "Bite"));
  const box = el("div", { class: "stack" });
  p.append(box);
  const saved = (() => { try { return JSON.parse(getPref("wx", "null")); } catch { return null; } })();
  const loadWx = async (loc) => {
    setPref("wx", JSON.stringify(loc)); if (S.biteChart) S.biteChart.hidden = false;
    box.replaceChildren(el("p", { class: "muted" }, "Loading weather for " + loc.name + "…"));
    try { drawWx(box, await fetchWeather(loc), loc, loadWx); }
    catch (e) { box.replaceChildren(wxPicker(loadWx, "Couldn't load the weather. Check your internet and try again."), el("p", { class: "muted small" }, String(e.message || e))); }
  };
  if (saved && typeof saved.lat === "number") loadWx(saved); else box.append(wxPicker(loadWx));
  S.biteChart = lureChart(); p.append(S.biteChart);
}
/* Real river gauges from the US Geological Survey (free, no key). */
const RIV_STATES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming" };
const rivCache = {};
async function rivStateList(st) {
  if (rivCache[st]) return rivCache[st];
  const r = await fetch(`https://waterservices.usgs.gov/nwis/site/?format=rdb&stateCd=${st.toLowerCase()}&siteType=ST&siteStatus=active&hasDataTypeCd=iv&parameterCd=00060,00065&siteOutput=basic`);
  if (!r.ok) throw new Error("The river service said no (" + r.status + ").");
  const rows = (await r.text()).split("\n").filter((l) => l && !l.startsWith("#")).slice(2).map((l) => l.split("\t")).filter((c) => c[1] && c[2]).map((c) => ({ code: c[1], name: c[2], lat: +c[4], lng: +c[5] }));
  return (rivCache[st] = rows);
}
const rivPretty = (n) => n.replace(/\b(\w)(\w*)/g, (m, a, b) => a + b.toLowerCase()).replace(/\bNr\b/g, "near").replace(/\bAt\b/g, "at").replace(/\bBlw\b/g, "below").replace(/\bAbv\b/g, "above").replace(/\bR\b/g, "River").replace(/\bCk\b/g, "Creek").replace(/,\s*([A-Za-z]{2})$/, (m, c) => ", " + c.toUpperCase());
async function rivReadings(qs, names) {
  const r = await fetch(`https://waterservices.usgs.gov/nwis/iv/?format=json&${qs}&parameterCd=00060,00065&siteType=ST&siteStatus=active&period=PT6H`);
  if (!r.ok) throw new Error("The river service said no (" + r.status + ").");
  const j = await r.json(), by = new Map();
  for (const ts of j.value?.timeSeries || []) {
    const code = ts.sourceInfo.siteCode[0].value, g = ts.sourceInfo.geoLocation?.geographicLocation;
    if (!g) continue;
    const vals = (ts.values?.[0]?.value || []).filter((v) => v.value !== "" && +v.value > -999990);
    if (!vals.length) continue;
    if (!by.has(code)) by.set(code, { code, name: names?.get(code) || rivPretty(ts.sourceInfo.siteName), lat: g.latitude, lng: g.longitude });
    const o = by.get(code), key = ts.variable.variableCode[0].value === "00060" ? "flow" : "stage";
    o[key] = { now: +vals[vals.length - 1].value, then: +vals[0].value }; o.time = vals[vals.length - 1].dateTime;
  }
  return [...by.values()];
}
function rivTrend(o) {
  const m = o.flow || o.stage; if (!m) return null; const base = Math.max(Math.abs(m.then), o.flow ? 1 : 0.5), pct = (m.now - m.then) / base;
  return pct > 0.15 ? ["⬆️ Rising fast", "Water is climbing and getting muddy. Fish the slack water, eddies and edges, and be careful near the bank."]
    : pct > 0.03 ? ["↗️ Rising", "A little more water often gets fish feeding. Try the edges and the mouths of creeks."]
    : pct < -0.15 ? ["⬇️ Dropping fast", "Water is falling quickly. Fish can be spooky. Try deeper holes."]
    : pct < -0.03 ? ["↘️ Falling", "Water is clearing up. A good time to fish."]
    : ["➡️ Steady", "Steady water. Fish act normally."];
}
const rivBase = (n) => n.replace(/,\s*[A-Za-z]{2}$/, "").split(/\s+(?:near|nr|at|below|blw|bl|above|abv|ab|in|on|downstream|upstream|dwnstrm|upstrm|@)\s+/i)[0].trim();
const rivPlace = (n) => (n.replace(/,\s*[A-Za-z]{2}$/, "").match(/\s(?:near|nr|at|below|blw|above|abv)\s+(.+)$/i) || [])[1] || "";
const RIV_SIZES = [
  [50, "tiny creek", 90, "Small creeks are best fished by wading with light line and tiny lures. Look for pools below little riffles and shade under the banks."],
  [300, "creek", 150, "Fish the deeper pools, the bends and the shade under the banks. Walk slowly so you don't spook the fish."],
  [3000, "small river", 230, "Try the eddies, the edges of the current and the spots behind rocks and logs, where fish rest out of the flow."],
  [30000, "river", 340, "Fish the slack water behind points and bends. Bridges and boat ramps are good starting spots. Be careful of strong current."],
  [1e12, "big river", 480, "Big rivers are powerful and can rise fast. Fish the eddies, the mouths of creeks and the slow water along the banks, and wear a life jacket."]];
function rivSize(o) { const f = o.flow ? o.flow.now : 800; return RIV_SIZES.find((x) => f < x[0]) || RIV_SIZES[4]; }
function rivScene(o) {
  const sz = rivSize(o), w = sz[2], L = 300 - w / 2, R = 300 + w / 2, t = rivTrend(o), tag = t ? t[0] : "";
  const muddy = /fast/.test(tag) && /Rising/.test(tag), water = muddy ? "#8D7350" : "#3A8CC4", light = muddy ? "#B39B76" : "#8EC5E8";
  const ripples = Array.from({ length: Math.min(8, 2 + Math.round(w / 70)) }, (_, k) => { const y = 150 + k * 9, x = L + 14 + ((k * 53) % Math.max(20, w - 60)); return `<path d="M${x} ${y} q10 -5 20 0 t20 0" fill="none" stroke="${light}" stroke-width="2" opacity=".8"/>`; }).join("");
  const trees = [[28, 128], [70, 118], [118, 130], [490, 126], [535, 116], [575, 130]].map(([x, y]) => `<path d="M${x} ${y} l-14 34 h28 z M${x} ${y - 16} l-11 30 h22 z" fill="#3E6B4E"/>`).join("");
  const arrow = /Rising/.test(tag) ? "▲" : /Dropping|Falling/.test(tag) ? "▼" : "●";
  return `<svg viewBox="0 0 600 220" role="img" aria-label="Picture of a ${sz[1]}" style="width:100%;height:auto;display:block;border-radius:14px">
<defs><linearGradient id="sk${o.code}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9CCBEA"/><stop offset="1" stop-color="#E6F3FB"/></linearGradient></defs>
<rect width="600" height="220" fill="url(#sk${o.code})"/><circle cx="500" cy="42" r="20" fill="#FFF3C4"/>
<path d="M0 120 Q90 70 190 110 T380 100 T600 112 V220 H0Z" fill="#7A9BB8"/><path d="M0 140 Q120 100 250 134 T600 130 V220 H0Z" fill="#5F8466"/>
${trees}<path d="M0 220 V150 H${L} Q${L + 10} 190 ${L - 20} 220Z" fill="#6E8B5C"/><path d="M600 220 V150 H${R} Q${R - 10} 190 ${R + 20} 220Z" fill="#6E8B5C"/>
<path d="M${L - 20} 220 Q${L + 10} 190 ${L} 150 H${R} Q${R - 10} 190 ${R + 20} 220Z" fill="${water}"/>${ripples}
<g transform="translate(${300 - 22} 182)" opacity=".85"><path d="M0 14 q22 -22 44 0 q-22 14 -44 0z M44 14 l12 -9 v18z" fill="#E8EEF2"/><circle cx="9" cy="11" r="2" fill="#26384A"/></g>
<rect x="14" y="14" rx="10" width="${12 + sz[1].length * 9 + 24}" height="28" fill="rgba(10,20,30,.62)"/><text x="26" y="33" font-size="15" font-family="system-ui,sans-serif" fill="#fff" font-weight="700">${arrow} ${sz[1]}</text></svg>`;
}
function rivDesc(o) {
  const sz = rivSize(o), place = rivPlace(o.name), rv = rivBase(o.name);
  const now = o.flow ? ` carrying about ${Math.round(o.flow.now).toLocaleString()} cubic feet of water every second` : "";
  const lvl = o.stage ? ` The water is ${o.stage.now.toFixed(1)} feet on the gauge.` : "";
  return `This gauge is on the ${rv}${place ? " at " + place : ""}. It reads like a ${sz[1]}${now}.${lvl} ${sz[3]}`;
}
function rivCard(o, loc) {
  const t = rivTrend(o), mi = loc ? km(loc, { lat: o.lat, lng: o.lng }) / 1.609 : null;
  const pic = el("div", { class: "riv-pic", "data-pic": o.code }); pic.innerHTML = rivScene(o);
  return el("div", { class: "card-lite stack", style: "gap:6px;padding:14px;border:2px solid var(--line, #c9d6de);border-radius:14px", "data-gauge": o.code },
    pic,
    el("div", { class: "row spread", style: "gap:8px;flex-wrap:nowrap" }, el("b", { style: "overflow-wrap:anywhere" }, o.name), mi == null ? null : el("span", { class: "muted small", style: "white-space:nowrap" }, mi.toFixed(mi < 10 ? 1 : 0) + " mi")),
    el("p", { class: "riv-desc", style: "margin:0" }, rivDesc(o)),
    el("div", { class: "cond-grid" },
      o.stage ? condTile("Water level", o.stage.now.toFixed(2) + " ft", "gauge height", "") : null,
      o.flow ? condTile("Flow", Math.round(o.flow.now).toLocaleString() + " cfs", "cubic ft per second", "") : null),
    t ? el("p", { style: "margin:0" }, el("b", null, t[0] + ". "), t[1]) : null,
    el("a", { href: "https://waterdata.usgs.gov/monitoring-location/" + o.code + "/", target: "_blank", rel: "noopener", class: "link small" }, "See the full gauge on USGS ›"));
}
async function loadGauges(box, loc) {
  const guess = Object.entries(RIV_STATES).find(([c, n]) => loc && (loc.name.includes(n) || new RegExp(",\\s*" + c + "$").test(loc.name)))?.[0];
  const q = el("input", { type: "search", id: "riv-q", placeholder: "Search a river, like Meramec", "aria-label": "River name", maxlength: 40, value: getPref("rivq", ""), style: "width:100%" });
  const st = el("select", { id: "riv-st", "aria-label": "State" }, el("option", { value: "" }, "State…"), ...Object.entries(RIV_STATES).map(([c, n]) => el("option", { value: c }, n)));
  st.value = getPref("rivst", "") || guess || "";
  const res = el("div", { class: "stack", id: "riv-res" }, el("p", { class: "muted" }, "Type a river or creek name and pick its state. Try Mississippi, Current, Guadalupe or Meramec."));
  const note = "Real gauges from the US Geological Survey, updated about every 15 minutes. Rising and falling is over the last 6 hours.";
  const show = (rows, head) => res.replaceChildren(el("p", { class: "muted small", style: "margin:0" }, head), ...rows.map((o) => rivCard(o, loc)), el("p", { class: "muted small" }, "Data from the US Geological Survey. Pictures are drawings made by the app. Gauges are in the US only."));
  const noGauge = (why, canAll) => {
    const pic = el("div", { class: "riv-pic", "data-pic": "none" }); pic.innerHTML = rivScene({ code: "none" });
    res.replaceChildren(el("div", { class: "card-lite stack", id: "riv-none", style: "gap:8px;padding:14px;border:2px solid var(--line, #c9d6de);border-radius:14px" }, pic,
      el("b", null, q.value.trim() ? `"${q.value.trim()}"` : "No gauge"),
      el("p", { style: "margin:0" }, why),
      el("p", { style: "margin:0" }, "Not every river or creek has a gauge. You can still plan a trip: " + RIV_SIZES[2][3] + " Early morning and evening are usually the best times, and a rising river after rain can turn the fish on or make the water too muddy to fish."),
      el("div", { class: "row", style: "gap:8px" },
        el("button", { class: "btn small", type: "button", id: "riv-bite", onclick: () => document.querySelector("#bite-seg-fore")?.click() }, "⛅ Weather and bite"),
        canAll ? el("button", { class: "btn small ghost", type: "button", id: "riv-all", onclick: () => search(true) }, "🔎 Search all states") : null,
        loc ? el("button", { class: "btn small ghost", type: "button", onclick: near }, "📍 Gauges near me") : null)));
  };
  const search = async (everywhere) => {
    const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    if (everywhere === true) {
      if (!words.length) return;
      res.replaceChildren(el("p", { class: "muted", id: "riv-prog" }, "Searching every state…"));
      try {
        const codes = Object.keys(RIV_STATES); let done = 0; const hit = [];
        const work = async () => { while (codes.length) { const c = codes.shift(); try { const all = await rivStateList(c); hit.push(...all.filter((x) => words.every((w) => x.name.toLowerCase().includes(w)))); } catch { /* skip a state that fails */ } done++; const p = document.getElementById("riv-prog"); if (p) p.textContent = `Searching every state… ${done} of ${Object.keys(RIV_STATES).length}`; } };
        await Promise.all([work(), work(), work(), work(), work(), work()]);
        const seenC = new Set(); for (let i = hit.length - 1; i >= 0; i--) { if (seenC.has(hit[i].code)) hit.splice(i, 1); else seenC.add(hit[i].code); }
        hit.sort((a, b) => (+b.name.toLowerCase().startsWith(words[0]) - +a.name.toLowerCase().startsWith(words[0])) || a.name.localeCompare(b.name));
        const top = hit.slice(0, 12);
        if (!top.length) { noGauge(`No gauges found for that name in any state.`, false); return; }
        const rows = await rivReadings("sites=" + top.map((x) => x.code).join(","), new Map(top.map((x) => [x.code, x.name])));
        if (!rows.length) { noGauge("Found gauges with that name, but none are sending readings right now.", false); return; }
        rows.sort((a, b) => a.name.localeCompare(b.name)); show(rows, note + " Searched every state.");
      } catch (e) { res.replaceChildren(el("p", { class: "muted" }, "Couldn't load river gauges. Check your internet and try again."), el("p", { class: "muted small" }, String(e.message || e))); }
      return;
    }
    if (!st.value) { res.replaceChildren(el("p", { class: "muted" }, "Pick a state first.")); return; }
    if (!words.length) { res.replaceChildren(el("p", { class: "muted" }, "Type part of a river or creek name.")); return; }
    setPref("rivq", q.value.trim()); setPref("rivst", st.value);
    res.replaceChildren(el("p", { class: "muted" }, `Searching ${RIV_STATES[st.value]}…`));
    try {
      const all = await rivStateList(st.value);
      const hit = all.filter((x) => words.every((w) => x.name.toLowerCase().includes(w))).sort((a, b) => (+b.name.toLowerCase().startsWith(words[0]) - +a.name.toLowerCase().startsWith(words[0])) || a.name.localeCompare(b.name)).slice(0, 12);
      if (!hit.length) { noGauge(`No gauges found in ${RIV_STATES[st.value]}. Try a shorter name, like Meramec instead of Meramec River, or search every state.`, true); return; }
      const names = new Map(hit.map((x) => [x.code, x.name]));
      const rows = await rivReadings("sites=" + hit.map((x) => x.code).join(","), names);
      rows.sort((a, b) => a.name.localeCompare(b.name));
      if (!rows.length) { noGauge("Found the river, but its gauges aren't sending readings right now.", true); return; }
      show(rows, note + (hit.length === 12 ? " Showing the first 12." : ""));
    } catch (e) { res.replaceChildren(el("p", { class: "muted" }, "Couldn't load river gauges. Check your internet and try again."), el("p", { class: "muted small" }, String(e.message || e))); }
  };
  const near = async () => {
    if (!loc) return;
    res.replaceChildren(el("p", { class: "muted" }, "Looking for river gauges near " + loc.name + "…"));
    try {
      const d = 0.4, bb = [loc.lng - d, loc.lat - d, loc.lng + d, loc.lat + d].map((x) => x.toFixed(4)).join(",");
      const rows = (await rivReadings("bBox=" + bb)).map((o) => ({ ...o, mi: km(loc, { lat: o.lat, lng: o.lng }) })).sort((a, b) => a.mi - b.mi).slice(0, 10);
      if (!rows.length) { noGauge("No river gauges within about 25 miles of " + loc.name + ". Try searching for a river by name.", true); return; }
      show(rows, "Gauges near " + loc.name + ". " + note);
    } catch (e) { res.replaceChildren(el("p", { class: "muted" }, "Couldn't load river gauges. Check your internet and try again."), el("p", { class: "muted small" }, String(e.message || e))); }
  };
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); search(); } });
  box.replaceChildren(
    q, st,
    el("div", { class: "row", style: "gap:8px" }, el("button", { class: "btn small", type: "button", id: "riv-go", onclick: () => search() }, "Search"),
      loc ? el("button", { class: "btn ghost small", type: "button", id: "riv-near", onclick: near }, "📍 Near me") : null),
    res);
  if (q.value.trim() && st.value) search();
}
function wxPicker(onPick, note) {
  const q = el("input", { type: "search", placeholder: "Search a town or lake, like Austin", "aria-label": "Search for a place", maxlength: 60 });
  const res = el("div", { class: "list" });
  const search = async () => {
    const name = q.value.trim(); if (name.length < 2) return;
    res.replaceChildren(el("p", { class: "muted" }, "Searching…"));
    try {
      const r = await fetch("https://geocoding-api.open-meteo.com/v1/search?count=5&language=en&name=" + encodeURIComponent(name));
      const j = await r.json(); const rows = j.results || [];
      if (!rows.length) { res.replaceChildren(el("p", { class: "muted" }, "Nothing found. Try a bigger town nearby.")); return; }
      res.replaceChildren(...rows.map((x) => el("button", { class: "item", type: "button",
        onclick: () => onPick({ lat: Math.round(x.latitude * 100) / 100, lng: Math.round(x.longitude * 100) / 100, name: [x.name, x.admin1].filter(Boolean).join(", ") }) },
        el("div", { class: "stack", style: "gap:2px" }, el("span", { class: "t" }, x.name), el("span", { class: "s" }, [x.admin1, x.country].filter(Boolean).join(", "))))));
    } catch { res.replaceChildren(el("p", { class: "muted" }, "Search didn't work. Try again.")); }
  };
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); search(); } });
  return el("div", { class: "stack" },
    el("p", { class: "muted" }, note || "Pick where you're fishing to see the weather and a rough bite forecast."),
    el("button", { class: "btn", type: "button", onclick: () => {
      if (!navigator.geolocation) { toast("This browser can't share your location."); return; }
      navigator.geolocation.getCurrentPosition(
        (pos) => onPick({ lat: Math.round(pos.coords.latitude * 100) / 100, lng: Math.round(pos.coords.longitude * 100) / 100, name: "Your location" }),
        () => toast("Couldn't get your location. Search for a town instead."), { timeout: 10000 });
    } }, "Use my location"),
    el("div", { class: "row" }, q, el("button", { class: "btn small ghost", type: "button", onclick: search }, "Search")), res);
}
function drawWx(box, w, loc, onPick) {
  const c = w.current, h = w.hourly, b = biteScore(w);
  const i = Math.max(0, h.time.findIndex((t) => t.slice(0, 13) === c.time.slice(0, 13)));
  const inHg = (c.pressure_msl * 0.02953).toFixed(2);
  const trend = b.dP <= -1 ? "falling" : b.dP >= 1 ? "rising" : "steady";
  const next = h.time.slice(i + 1, i + 13).map((t, k) => ({ t, temp: h.temperature_2m[i + 1 + k], rain: h.precipitation_probability[i + 1 + k], code: h.weather_code[i + 1 + k] }));
  const [_place, _now, _stats, _bite, _best, _adv, _hours, _foot] = [
    el("div", { class: "row spread bite-place" }, el("strong", null, "📍 " + loc.name), el("button", { class: "link", type: "button", onclick: () => { if (S.biteChart) S.biteChart.hidden = false; box.replaceChildren(wxPicker(onPick)); } }, "Change")),
    el("div", { class: "wx-now" },
      el("div", { class: "wx-temp" }, Math.round(c.temperature_2m) + "°"),
      el("div", { class: "stack", style: "gap:2px" }, el("b", null, wxName(c.weather_code)), el("span", { class: "muted" }, `Wind ${Math.round(c.wind_speed_10m)} mph ${compass(c.wind_direction_10m)}`))),
    el("div", { class: "stats wx" },
      el("div", null, el("b", null, timeOf(w.daily.sunrise[0])), el("span", null, "Sunrise")),
      el("div", null, el("b", null, timeOf(w.daily.sunset[0])), el("span", null, "Sunset"))),
    el("div", { class: "bite" },
      el("div", { class: "row spread" }, el("b", null, "Bite forecast"), el("span", { class: "bite-label" }, b.label)),
      el("div", { class: "meter", role: "img", "aria-label": "Bite score " + b.s + " out of 100" }, el("i", { style: "width:" + b.s + "%" })),
      el("div", { class: "cond-grid" },
        condTile("Wind", Math.round(c.wind_speed_10m) + " mph", compass(c.wind_direction_10m), windRating(c.wind_speed_10m)),
        condTile("Pressure", inHg + " inHg", trend, pressureRating(b.dP))),
      el("ul", { class: "why" }, b.why.map((x) => el("li", null, x))),
      el("p", { class: "muted small" }, "A rough guide from pressure, wind, clouds, and time of day. Fish don't read forecasts, so use your own judgment.")),
    bestTimes(w),
    advisorCard(w, loc),
    el("div", { class: "hours", "aria-label": "Next 12 hours" }, next.map((x) => el("div", { class: "hr" },
      el("small", null, new Date(x.t).toLocaleTimeString([], { hour: "numeric" })), el("b", null, Math.round(x.temp) + "°"), el("small", null, (x.rain ?? 0) + "% rain")))),
    el("p", { class: "muted small" }, "Weather from Open-Meteo. Your location is only used to ask for the forecast and is not saved to your account.")];
  const tabs = [["fore", "Forecast"], ["adv", "Advisor"], ["riv", "Rivers"], ["chart", "What's biting"]];
  const riv = el("div", { class: "stack", id: "bite-p-riv" }); let rivDone = false;
  const fore = el("div", { class: "stack", id: "bite-p-fore" }, _now, _stats, _bite, _best, _hours, _foot);
  const adv = el("div", { class: "stack", id: "bite-p-adv" }, _adv);
  const seg = el("div", { class: "seg", id: "bite-seg", role: "tablist" });
  const show = (k) => {
    setPref("biteTab", k); fore.hidden = k !== "fore"; adv.hidden = k !== "adv"; riv.hidden = k !== "riv"; if (k === "riv" && !rivDone) { rivDone = true; loadGauges(riv, loc); } if (S.biteChart) S.biteChart.hidden = k !== "chart";
    [...seg.children].forEach((x) => x.setAttribute("aria-selected", String(x.dataset.k === k)));
  };
  tabs.forEach(([k, n]) => seg.append(el("button", { type: "button", role: "tab", id: "bite-seg-" + k, "data-k": k, onclick: () => show(k) }, n)));
  box.replaceChildren(_place, seg, fore, adv, riv);
  const want = getPref("biteTab", "fore"); show(tabs.some((t) => t[0] === want) ? want : "fore");
}

/* ======================= FISHING ADVISOR: lure + where + when ======================= */
/* Real-life rules of thumb, mixed with what people near you actually caught fish on. */
const ADV_LURES = {
  topwater: { n: "Topwater popper or frog", t: [68, 92], light: "low", wind: 0, clar: [1, 0.8, 0.5], d: "the surface", how: "Cast next to cover, let the rings fade, then twitch it." },
  spinnerbait: { n: "Spinnerbait", t: [55, 80], light: "any", wind: 1, clar: [0.6, 1, 1], d: "shallow to mid depth", how: "Slow-roll it past cover, or burn it over weeds." },
  chatterbait: { n: "Bladed jig (ChatterBait)", t: [55, 82], light: "any", wind: 1, clar: [0.7, 1, 0.9], d: "shallow to mid depth", how: "Steady retrieve, and rip it free when it touches weeds." },
  crankShallow: { n: "Shallow crankbait", t: [55, 78], light: "any", wind: 1, clar: [1, 1, 0.6], d: "2 to 8 ft", how: "Bump it off wood and rocks, and pause when it hits something." },
  crankDeep: { n: "Deep-diving crankbait", t: [50, 85], light: "bright", wind: 1, clar: [1, 0.9, 0.6], d: "10 to 20 ft", how: "Cast far, crank down fast, then keep it ticking the bottom." },
  jig: { n: "Jig with a trailer", t: [38, 75], light: "bright", wind: 1, clar: [1, 1, 0.9], d: "on the bottom, any depth", how: "Drag it and hop it slowly along the bottom." },
  worm: { n: "Soft plastic worm (Texas rig)", t: [55, 90], light: "bright", wind: 1, clar: [1, 1, 0.8], d: "on the bottom, any depth", how: "Cast to cover, let it sink, and twitch it every few seconds." },
  dropshot: { n: "Drop shot", t: [40, 72], light: "bright", wind: 1, clar: [1, 0.7, 0.3], d: "mid to deep", how: "Keep the line tight and shake the bait without moving the weight." },
  jerkbait: { n: "Suspending jerkbait", t: [38, 62], light: "any", wind: 1, clar: [1, 0.7, 0.2], d: "2 to 8 ft", how: "Jerk, jerk, then a long pause. Cold fish hit it on the pause." },
  swimbait: { n: "Swimbait", t: [50, 82], light: "any", wind: 1, clar: [1, 0.9, 0.6], d: "mid depth", how: "Steady, slow retrieve just above weeds or rocks." },
  spoon: { n: "Spoon", t: [34, 62], light: "any", wind: 1, clar: [1, 1, 0.8], d: "mid to deep", how: "Let it flutter down, then jig it up and let it fall again." },
  spinner: { n: "Inline spinner", t: [40, 75], light: "any", wind: 1, clar: [1, 1, 0.8], d: "shallow to mid depth", how: "Cast across the current and reel just fast enough to keep the blade turning." },
  minnow: { n: "Live minnow", t: [34, 78], light: "any", wind: 1, clar: [1, 1, 1], d: "any depth", how: "Hook it behind the dorsal fin and drift it near the bottom or under a bobber." },
  crawler: { n: "Nightcrawler", t: [50, 92], light: "any", wind: 1, clar: [1, 1, 1], d: "bottom or under a bobber", how: "Thread it on a small hook and let it sit or drift naturally." },
  cutbait: { n: "Cut bait or stink bait", t: [58, 95], light: "low", wind: 1, clar: [0.8, 1, 1], d: "bottom, deeper holes", how: "Cast to a hole or bend, put the rod in a holder and wait." },
  tinyjig: { n: "Small jig under a bobber", t: [45, 85], light: "any", wind: 0, clar: [1, 1, 0.7], d: "2 to 10 ft", how: "Set the bobber so the jig hangs near brush, and twitch it now and then." },
  dough: { n: "Corn or dough bait", t: [55, 92], light: "any", wind: 1, clar: [0.8, 1, 1], d: "bottom, shallow flats", how: "Chum the spot first, then fish a small hook on the bottom." },
  bigbait: { n: "Big bucktail or glide bait", t: [48, 80], light: "any", wind: 1, clar: [1, 1, 0.8], d: "mid depth", how: "Cast past weeds and finish with a big figure 8 at the boat or bank." }
};
const ADV_LURE_WORDS = [["topwater|popper|frog|buzz|walking|prop", "topwater"], ["spinnerbait|spinner bait", "spinnerbait"], ["chatter|bladed", "chatterbait"], ["deep crank|deep dive|diving", "crankDeep"],
  ["crank|squarebill|square bill|lipless|rattletrap", "crankShallow"], ["jig|football", "jig"], ["drop shot|dropshot", "dropshot"], ["worm|senko|plastic|craw|creature|tube|lizard", "worm"], ["jerk", "jerkbait"],
  ["swimbait|swim bait|glide|paddle", "swimbait"], ["spoon|kastmaster|dardevle", "spoon"], ["spinner|mepps|rooster", "spinner"], ["minnow|shiner", "minnow"], ["crawler|worms?\\b|nightcrawler", "crawler"],
  ["cut|stink|liver|chicken|shrimp|hot dog", "cutbait"], ["bobber|float", "tinyjig"], ["corn|dough|boilie|bread", "dough"], ["bucktail|musky|big bait|bigbait", "bigbait"]];
const advLureCat = (t) => { const s = String(t || "").toLowerCase(); for (const [re, k] of ADV_LURE_WORDS) if (new RegExp(re).test(s)) return k; return ""; };
const ADV_FISH = [
  { n: "Largemouth bass", keys: ["largemouth", "black bass"], when: ["dawn", "dusk"], lures: { topwater: 0.8, spinnerbait: 0.9, chatterbait: 0.9, crankShallow: 0.8, crankDeep: 0.6, jig: 1, worm: 1, dropshot: 0.6, jerkbait: 0.6, swimbait: 0.7 },
    where: "docks, fallen trees, weed edges, lily pads and points" },
  { n: "Smallmouth bass", keys: ["smallmouth"], when: ["dawn", "dusk", "day"], lures: { crankShallow: 0.7, crankDeep: 0.7, jig: 1, dropshot: 0.9, jerkbait: 0.8, spinnerbait: 0.6, topwater: 0.6, worm: 0.7, swimbait: 0.6, minnow: 0.5 },
    where: "rocky points, gravel flats, ledges and boulders" },
  { n: "Catfish", keys: ["catfish", "channel cat", "blue cat", "flathead"], when: ["dusk", "night"], lures: { cutbait: 1, crawler: 0.9, minnow: 0.5 },
    where: "deep holes, river bends, below dams, and shallow flats after dark" },
  { n: "Crappie", keys: ["crappie"], when: ["dawn", "dusk"], lures: { tinyjig: 1, minnow: 1, spinner: 0.7 }, where: "brush piles, docks, bridge pilings and sunken trees" },
  { n: "Walleye", keys: ["walleye"], when: ["dawn", "dusk", "night"], lures: { jig: 1, minnow: 1, crankDeep: 0.8, crawler: 0.7, spinner: 0.6, jerkbait: 0.6 }, where: "rocky points, humps, drop-offs and wind-blown shorelines" },
  { n: "Trout", keys: ["trout", "char"], when: ["dawn", "dusk"], lures: { spinner: 1, spoon: 0.8, crawler: 0.7, minnow: 0.5, jerkbait: 0.5, tinyjig: 0.4 }, where: "riffles, pool tails, undercut banks, and creek mouths in lakes" },
  { n: "Bluegill and panfish", keys: ["bluegill", "sunfish", "panfish", "perch", "bream", "pumpkinseed"], when: ["day"], lures: { crawler: 1, tinyjig: 0.9, spinner: 0.7 }, where: "weed lines, docks and shallow flats" },
  { n: "Northern pike", keys: ["pike", "pickerel"], when: ["dawn", "day", "dusk"], lures: { spoon: 1, spinnerbait: 0.8, jerkbait: 0.8, swimbait: 0.7, topwater: 0.5, minnow: 0.6, bigbait: 0.7 }, where: "weed edges, shallow bays and creek mouths" },
  { n: "Musky", keys: ["musky", "muskie", "muskellunge"], when: ["dawn", "dusk"], lures: { bigbait: 1, spinnerbait: 0.7, topwater: 0.6, jerkbait: 0.6 }, where: "weed edges, points, rock humps and creek mouths" },
  { n: "Carp", keys: ["carp"], when: ["dawn", "dusk", "day"], lures: { dough: 1, crawler: 0.8 }, where: "muddy flats, weedy bays and near inflows" }];
const ADV_CLAR = ["Clear", "Stained", "Muddy"];

/* Estimate the water temperature from the last week of air temperatures. */
const advWater = {};
async function advWaterTemp(loc, w) {
  const key = loc.lat + "," + loc.lng;
  if (advWater[key] != null) return advWater[key];
  let est = Math.round(w.current.temperature_2m);
  try {
    const r = await fetch("https://api.open-meteo.com/v1/forecast?latitude=" + loc.lat + "&longitude=" + loc.lng + "&daily=temperature_2m_mean&temperature_unit=fahrenheit&timezone=auto&past_days=7&forecast_days=1");
    const j = await r.json(), a = (j.daily && j.daily.temperature_2m_mean || []).filter((x) => typeof x === "number");
    if (a.length >= 3) est = Math.round(a.reduce((x, y) => x + y, 0) / a.length);
  } catch { /* use the air temperature */ }
  est = Math.max(34, Math.min(88, est)); advWater[key] = est; return est;
}
const advHrIdx = (w, ms) => { const h = w.hourly; let best = -1, bd = 90 * 60000; h.time.forEach((t, i) => { const d = Math.abs(new Date(t).getTime() - ms); if (d < bd) { bd = d; best = i; } }); return best; };
const advCloud = (code, cur) => code >= 45 ? 90 : code >= 3 ? 85 : code === 2 ? 50 : code === 1 ? 25 : (cur ?? 10);
/* What the weather will be like at a moment (now, or a window the person picks). */
function advAt(w, ms, kind) {
  const c = w.current, i = advHrIdx(w, ms), now = Math.abs(ms - new Date(c.time).getTime()) < 45 * 60000;
  const code = now || i < 0 ? c.weather_code : w.hourly.weather_code[i];
  const wind = now || i < 0 ? c.wind_speed_10m : w.hourly.wind_speed_10m[i], air = now || i < 0 ? c.temperature_2m : w.hourly.temperature_2m[i];
  const cloud = advCloud(code, now ? c.cloud_cover : null), rain = code >= 51 && code <= 82, storm = code >= 95;
  const sun = [...(w.daily.sunrise || []), ...(w.daily.sunset || [])].map((t) => new Date(t).getTime());
  const nearSun = sun.some((x) => Math.abs(x - ms) < 90 * 60000);
  const rise = (w.daily.sunrise || []).map((t) => new Date(t).getTime()), set = (w.daily.sunset || []).map((t) => new Date(t).getTime());
  const dark = !(rise.some((r) => set.some((s) => ms > r && ms < s && s - r < 20 * 3600000)));
  const low = kind === "dawn" || kind === "dusk" || kind === "night" || dark || nearSun || cloud > 60 || rain;
  return { wind, air, cloud, rain, storm, low: !!low, dark, code };
}
function advCatches(loc, fish) {
  const out = [], now = Date.now();
  for (const x of S.spots) {
    if (typeof x.lat !== "number" || typeof x.lng !== "number") continue;
    const sp = String(x.species || "").toLowerCase(); if (!fish.keys.some((k) => sp.includes(k))) continue;
    const dKm = km(loc, x); if (dKm > 80) continue;
    const ms = x.createdAt?.toMillis?.() ?? now; if (now - ms > 150 * 86400000) continue;
    out.push({ ...x, dKm, ms, cat: advLureCat(x.lure) });
  }
  return out;
}
/* "Was that a good suggestion?" answers, kept on this phone. A thumbs up makes that lure or time rank higher next time. */
const advFbAll = () => { try { return JSON.parse(getPref("advfb", "{}")) || {}; } catch { return {}; } };
const advFbGet = (key) => +advFbAll()[key] || 0;
const advFbSet = (key, v) => { const a = advFbAll(); if (v) a[key] = v; else delete a[key]; setPref("advfb", JSON.stringify(a)); };
/* What you see with your own eyes. Each answer nudges the advice. */
const ADV_LEVEL = [["high", "Above average"], ["avg", "Average"], ["low", "Below average"], ["vlow", "Very low"]];
const ADV_COLOR = [["clear", "Clear", 0], ["green", "Green", 1], ["tea", "Tea or stained", 1], ["muddy", "Muddy brown", 2], ["milky", "Chalky or milky", 2]];
const ADV_FEEL = [["hot", "Hot", 86], ["warm", "Warm", 76], ["room", "Room temp", 70], ["cool", "Cool", 62], ["cold", "Cold", 50], ["freezing", "Freezing", 38]];
const ADV_WIND = [["calm", "Calm", 1], ["light", "Light", 6], ["breezy", "Breezy", 12], ["windy", "Windy", 19], ["gusty", "Very windy", 27]];
const ADV_ACT = [["breach", "Fish jumping or breaching"], ["rise", "Fish rising, rings on top"], ["boil", "Boils or swirls"], ["bait", "Baitfish skipping"], ["birds", "Birds diving"], ["bugs", "Bugs on the surface"], ["dead", "Nothing moving"]];
const ADV_SURFACE = ["breach", "rise", "boil"], ADV_BAITERS = ["swimbait", "spoon", "jerkbait", "spinnerbait", "chatterbait", "crankShallow", "bigbait", "minnow", "spinner"], ADV_BOTTOM = ["jig", "worm", "dropshot", "cutbait", "crawler", "dough"], ADV_BUGGY = ["tinyjig", "spinner", "crawler", "dough"];
function advObsFx(k, o) {      // returns [multiplier, reason] pairs for one lure
  const out = [], acts = o.acts || [];
  const surf = acts.some((a) => ADV_SURFACE.includes(a));
  if (surf) { if (k === "topwater") out.push([1.8, "fish are hitting the surface right now"]); else if (ADV_BOTTOM.includes(k)) out.push([0.9, ""]); else if (ADV_BAITERS.includes(k)) out.push([1.08, ""]); }
  if (acts.includes("bait") && ADV_BAITERS.includes(k)) out.push([k === "swimbait" || k === "minnow" ? 1.25 : 1.15, "baitfish are around, so match them"]);
  if (acts.includes("birds")) { if (["swimbait", "spoon", "jerkbait", "bigbait"].includes(k)) out.push([1.25, "diving birds mean fish are chasing bait"]); else out.push([0.95, ""]); }
  if (acts.includes("bugs") && ADV_BUGGY.includes(k)) out.push([1.25, "bugs are on the water, so fish are eating small stuff"]);
  if (acts.includes("dead")) { if (k === "topwater") out.push([0.7, "nothing is moving on top"]); else if (["dropshot", "jig", "worm"].includes(k)) out.push([1.15, "slow finesse works when nothing is moving"]); }
  if (o.level === "vlow") { if (["dropshot", "worm", "jig"].includes(k)) out.push([1.15, "very low water makes fish spooky, so go light and slow"]); else if (k === "crankDeep" || k === "bigbait") out.push([0.85, "very low water, so deep or big lures snag"]); }
  else if (o.level === "low" && ["dropshot", "worm", "jig"].includes(k)) out.push([1.08, "below average water, fish pull off the bank"]);
  else if (o.level === "high" && ["spinnerbait", "chatterbait", "jig", "cutbait"].includes(k)) out.push([1.12, "high water, fish tuck into cover"]);
  return out;
}
function advRankLures(fish, at, waterT, clar, local, obs) {
  const rows = [];
  for (const [k, fit] of Object.entries(fish.lures)) {
    const L = ADV_LURES[k], why = [];
    let sc = fit * 100;
    const dt = waterT < L.t[0] ? L.t[0] - waterT : waterT > L.t[1] ? waterT - L.t[1] : 0;
    const tf = dt === 0 ? 1 : Math.max(0.15, 1 - 0.04 * dt); sc *= tf;
    why.push(dt === 0 ? `${waterT}° water is right in its range` : tf < 0.6 ? `${waterT}° water is a bit ${waterT < L.t[0] ? "cold" : "warm"} for it` : `${waterT}° water is close to its range`);
    const lf = L.light === "any" ? 1 : L.light === "low" ? (at.low ? 1 : 0.55) : (at.low ? 0.85 : 1); sc *= lf;
    if (L.light === "low" && at.low) why.push("low light suits it"); if (L.light === "bright" && !at.low) why.push("bright light suits it");
    const cf = L.clar[clar]; sc *= cf; if (cf >= 1) why.push(`works well in ${ADV_CLAR[clar].toLowerCase()} water`); else if (cf < 0.6) why.push(`not ideal in ${ADV_CLAR[clar].toLowerCase()} water`);
    if (at.wind > 12) { if (!L.wind) { sc *= 0.5; why.push("wind will make it hard to fish"); } else if (k === "spinnerbait" || k === "chatterbait") { sc *= 1.1; why.push("the wind gives it cover"); } }
    if (obs) for (const [m, w] of advObsFx(k, obs)) { sc *= m; if (w) why.unshift(w); }
    const fv = advFbGet(fish.n + "|" + k); if (fv) { sc *= fv > 0 ? 1.3 : 0.65; why.unshift(fv > 0 ? "you said it was a good suggestion before" : "you said it wasn't a good suggestion before"); }
    const ev = local.filter((x) => x.cat === k), n = ev.length;
    if (n) { sc *= 1 + Math.min(5, n) * 0.15; why.push(`${n} catch${n > 1 ? "es" : ""} near you in the last 5 months used one`); }
    rows.push({ k, L, sc, why, n });
  }
  // lures that fish near you really took but that the rules did not list for this fish
  const known = new Set(Object.keys(fish.lures));
  for (const k of new Set(local.map((x) => x.cat).filter(Boolean))) { const n = local.filter((x) => x.cat === k).length; if (!known.has(k) && n >= 2) rows.push({ k, L: ADV_LURES[k], sc: 40 + n * 5, why: [`${n} catches near you used one`], n }); }
  return rows.sort((a, b) => b.sc - a.sc);
}
/* Mixes up the good lures so you don't get the same three every time. Better lures come up more often. */
function advMix(rows, seed) {
  if (rows.length <= 1) return rows.slice();
  const top = rows[0].sc, pool = rows.filter((r, i) => i < 5 || r.sc >= top * 0.4).slice(0, 9);
  let a = seed >>> 0;
  const rnd = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = [];
  while (pool.length) {
    const w = pool.reduce((s, r) => s + Math.pow(r.sc, 3), 0); let x = rnd() * w, i = 0;
    for (; i < pool.length - 1; i++) { x -= Math.pow(pool[i].sc, 3); if (x <= 0) break; }
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}
function advWindows(w, fish, waterT, local) {
  const now = new Date(w.current.time).getTime(), c = w.current, wins = dayWindows(w).filter((x) => x.b > now && x.a < now + 40 * 3600000);
  const b0 = biteScore(w), res = wins.map((x) => {
    const mid = Math.max(x.a, now) + (x.b - Math.max(x.a, now)) / 2, at = advAt(w, mid, x.k), why = [];
    let s = 45;
    if (fish.when.includes(x.k)) { s += 25; why.push(`${fish.n.toLowerCase()} feed best at ${WINDOW_NAMES[x.k].toLowerCase()}`); }
    if (waterT >= 80 && x.k !== "day") { s += 10; why.push("hot water, so cooler hours are better"); }
    if (waterT >= 85 && x.k === "day") { s -= 15; why.push("midday heat slows fish down"); }
    if (waterT <= 48 && x.k === "day") { s += 12; why.push("cold water, so the warmest hours are best"); }
    if (waterT <= 48 && (x.k === "night" || x.k === "dawn")) s -= 8;
    if (at.storm) { s -= 40; why.push("thunderstorms forecast. Stay off the water"); } else if (at.rain) { s -= 8; why.push("rain in the forecast"); }
    if (at.wind > 20) { s -= 10; why.push("strong wind"); } else if (at.wind < 10) s += 5;
    if (at.cloud > 60 && x.k === "day") { s += 8; why.push("cloud cover helps the midday bite"); }
    if (b0.dP <= -1 && b0.dP > -4) { s += 6; why.push("pressure is slowly falling"); }
    const mins = (ms) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); }, a = mins(x.a), b = mins(x.b);
    const fw = advFbGet(fish.n + "|win:" + x.k); if (fw) { s += fw > 0 ? 8 : -10; why.push(fw > 0 ? "you liked this time before" : "you didn't like this time before"); }
    const hits = local.filter((p) => { const m = mins(p.ms); return a <= b ? m >= a && m <= b : m >= a || m <= b; }).length;
    if (hits) { s += Math.min(24, hits * 6); why.push(`${hits} catch${hits > 1 ? "es" : ""} near you ${hits > 1 ? "were" : "was"} posted at this time of day`); }
    s = Math.max(5, Math.min(99, Math.round(s)));
    return { ...x, s, why, mid };
  });
  return res.sort((p, q) => q.s - p.s).slice(0, 3).sort((p, q) => p.a - q.a);
}
function advWhere(fish, at, waterT, kindRiver, w, obs) {
  const out = [], base = waterT < 48 ? "Fish are slow and deep. Try 10 to 25 ft near drop-offs, channel edges and deep docks, and fish slowly."
    : waterT < 60 ? "Fish move between depths. Try 5 to 15 ft on points, humps and creek mouths, and the sunny north-facing banks in the afternoon."
    : waterT < 76 ? "Fish are active and roam. Try 2 to 12 ft along weeds, docks and fallen trees."
    : "It's hot. Fish early or late in the shallows, then move to shade and deeper structure (10 to 20 ft) when the sun is high.";
  out.push(base);
  out.push(`${fish.n} like ${fish.where}.`);
  if (kindRiver) out.push("In a river, fish the seams where fast water meets slow, eddies behind rocks, and the tail of a pool. Cast upstream and let the bait drift down.");
  if (at.wind >= 8) out.push(`Wind ${Math.round(at.wind)} mph: fish the bank or point the wind is blowing into. Baitfish get pushed there and the fish follow.`);
  else out.push("Calm water: stay back from the edge, use light line and make long casts.");
  out.push(at.low ? "Low light: fish come up shallow and into open water, so cover more of the lake." : "Bright sun: fish hold in shade and cover. Target docks, trees, weeds and the dark side of structure.");
  if (obs) {
    const acts = obs.acts || [];
    if (obs.level === "vlow") out.push("Very low water: fish crowd into the deepest holes and any shade. Walk softly, use light line and make long casts.");
    else if (obs.level === "low") out.push("Below average water: fish slide off the bank to the first drop-off. Fish a little deeper than usual.");
    else if (obs.level === "high") out.push("High water: fish hide behind cover and out of the current. Try flooded bushes, slack water and eddies.");
    if (obs.color === "muddy" || obs.color === "milky") out.push("Dirty water: fish by feel and sound. Use bright or noisy lures and cast close to shallow cover.");
    else if (obs.color === "clear") out.push("Clear water: fish can see you. Use natural colors and thin line, and stay back from the edge.");
    else if (obs.color === "green") out.push("Green water has algae in it. Fish stay shallow where the algae is thick, and bright or chartreuse lures stand out.");
    if (acts.some((a) => ADV_SURFACE.includes(a))) out.push("Fish are showing on top. Cast to the rings or splash right away, because the fish moves on fast.");
    if (acts.includes("birds")) out.push("Diving birds are over feeding fish. Get within casting range without running over them.");
    if (acts.includes("bait")) out.push("Baitfish are skipping, so something is chasing them. Fish the edge of that water.");
    if (acts.includes("bugs")) out.push("Bugs on the surface mean fish are eating small food. Go smaller and slower.");
    if (acts.includes("dead")) out.push("Nothing is moving. Slow down, go smaller, and try a different depth every few casts.");
  }
  return out;
}
function advisorCard(w, loc) {
  const st = getPref("advset", ""); let saved = {}; try { saved = JSON.parse(st) || {}; } catch { saved = {}; }
  const P = { fish: Math.min(ADV_FISH.length - 1, +saved.fish || 0), clar: [0, 1, 2].includes(saved.clar) ? saved.clar : 1, river: !!saved.river, plan: 0, temp: null, obsOpen: false, seed: (Math.random() * 2147483647) | 0, feat: "", recent: [] };
  // what you see on the water. Kept for 4 hours, because conditions change.
  P.obs = (() => { try { const o = JSON.parse(getPref("advobs", "null")); if (o && Date.now() - o.ts < 4 * 3600000) return { level: o.level || "", color: o.color || "", feel: o.feel || "", wind: o.wind || "", acts: Array.isArray(o.acts) ? o.acts : [] }; } catch { /* none */ } return { level: "", color: "", feel: "", wind: "", acts: [] }; })();
  if (P.obs.feel) P.temp = (ADV_FEEL.find((f) => f[0] === P.obs.feel) || [])[2] ?? null;
  const saveObs = () => setPref("advobs", JSON.stringify({ ts: Date.now(), ...P.obs }));
  const wrap = el("div", { class: "bite adv", id: "advisor" }), body = el("div", { class: "stack", style: "gap:10px" });
  const save = () => setPref("advset", JSON.stringify({ fish: P.fish, clar: P.clar, river: P.river }));
  const fishSel = el("select", { "aria-label": "What fish are you after", id: "adv-fish", onchange: (e) => { P.fish = +e.target.value; P.plan = 0; P.feat = ""; P.recent = []; save(); draw(); } }, ADV_FISH.map((f, i) => el("option", { value: String(i), selected: i === P.fish ? "" : null }, f.n)));
  const tempIn = el("input", { type: "number", id: "adv-temp", inputmode: "numeric", min: 32, max: 95, "aria-label": "Water temperature in degrees", style: "width:80px", onchange: (e) => { const v = +e.target.value; if (v >= 32 && v <= 95) { P.temp = v; P.obs.feel = ""; saveObs(); draw(); } } });
  const draw = () => {
    const O = P.obs, colorRow = ADV_COLOR.find((c) => c[0] === O.color), clarNow = colorRow ? colorRow[2] : P.clar;
    const fish = ADV_FISH[P.fish], waterT = P.temp ?? P.est, local = advCatches(loc, fish), wins = advWindows(w, fish, waterT, local);
    const plans = [{ label: "Right now", ms: new Date(w.current.time).getTime(), kind: "" }, ...wins.map((x) => ({ label: `${new Date(x.a).getDate() === new Date(w.current.time).getDate() ? "Today" : "Tomorrow"} ${WINDOW_NAMES[x.k].toLowerCase()}`, ms: x.mid, kind: x.k, win: x }))];
    if (P.plan >= plans.length) P.plan = 0;
    const plan = plans[P.plan], at = advAt(w, plan.ms, plan.kind);
    const windRow = ADV_WIND.find((x) => x[0] === O.wind); if (windRow && P.plan === 0) at.wind = windRow[2];      // what you feel beats the forecast, for right now
    const all = advRankLures(fish, at, waterT, clarNow, local, P.plan === 0 ? O : { ...O, acts: [] }), mixed = advMix(all, P.seed);
    const featured = P.feat ? all.find((r) => r.k === P.feat) : null, lures = mixed.filter((r) => !featured || r.k !== featured.k).slice(0, 3);
    const suggest = () => {      // press for one new idea. It won't repeat the last few.
      P.seed = (Math.random() * 2147483647) | 0; const order = advMix(all, P.seed), fresh = order.filter((r) => !P.recent.includes(r.k)), pick = (fresh[0] || order[0]);
      if (!pick) return; P.feat = pick.k; P.recent = [pick.k, ...P.recent].slice(0, Math.max(1, Math.min(4, order.length - 1))); draw();
    };
    const near = local.slice().sort((a, b) => a.dKm - b.dKm).slice(0, 3);
    const range = (x) => timeOf(new Date(Math.max(x.a, new Date(w.current.time).getTime()))) + " to " + timeOf(new Date(x.b));
    tempIn.value = String(waterT);
    const pick = (group, list, multi) => el("div", { class: "chips", role: "group", "aria-label": group }, list.map(([v, label]) => {
      const on = multi ? O.acts.includes(v) : O[group] === v;
      return el("button", { class: "chip", type: "button", "data-obs": group + ":" + v, "aria-pressed": String(on), onclick: () => {
        if (multi) { O.acts = O.acts.includes(v) ? O.acts.filter((a) => a !== v) : [...O.acts.filter((a) => !(v === "dead" || a === "dead")), v]; }
        else { O[group] = O[group] === v ? "" : v; if (group === "feel") P.temp = O.feel ? ADV_FEEL.find((f) => f[0] === O.feel)[2] : null; }
        saveObs(); draw(); } }, label);
    }));
    const vote = (key) => {
      const row = el("div", { class: "adv-vote" }), note = el("span", { class: "muted small" });
      const paint = () => { const cur = advFbGet(key); row.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.val === cur))); note.textContent = cur > 0 ? "Thanks! I'll suggest this more." : cur < 0 ? "Thanks! I'll suggest this less." : ""; };
      row.append(el("span", { class: "muted small" }, "Good suggestion?"),
        ...[[1, "👍 Yes"], [-1, "👎 No"]].map(([v, t]) => el("button", { class: "chip small", type: "button", "data-vote": key, "data-val": v, "aria-pressed": "false", onclick: () => { advFbSet(key, advFbGet(key) === v ? 0 : v); paint(); } }, t)), note);
      paint(); return row;
    };
    const any = O.level || O.color || O.feel || O.wind || O.acts.length;
    const feeding = P.plan === 0 && O.acts.some((a) => a !== "dead" && a !== "bugs");
    body.replaceChildren(
      el("details", { class: "adv-obs", id: "adv-obs", open: P.obsOpen || any ? "" : null, ontoggle: (e) => { P.obsOpen = e.target.open; } },
        el("summary", null, any ? "What you see right now (filled in)" : "What you see right now"),
        el("div", { class: "stack", style: "gap:8px;margin-top:8px" },
          el("span", { class: "muted small" }, "Tell the advisor what you see at the water. It changes the lure, where and when advice."),
          el("b", null, "Water level"), pick("level", ADV_LEVEL),
          el("b", null, "Water color"), pick("color", ADV_COLOR),
          el("b", null, "How the water feels on your skin"), pick("feel", ADV_FEEL),
          el("b", null, "Wind"), pick("wind", ADV_WIND),
          el("b", null, "What's moving on the water"), pick("acts", ADV_ACT, true),
          any ? el("button", { class: "link small", type: "button", id: "adv-obs-clear", style: "align-self:flex-start", onclick: () => { P.obs = { level: "", color: "", feel: "", wind: "", acts: [] }; P.temp = null; saveObs(); draw(); } }, "Clear what I see") : null)),
      feeding ? el("p", { class: "adv-hot", id: "adv-hot" }, "🔥 Fish are feeding right now. Go with what's in front of you and cast fast.") : null,
      el("div", { class: "row", style: "gap:8px;align-items:center;flex-wrap:wrap" }, el("span", { class: "muted small" }, "Water temp °F"), tempIn, el("span", { class: "muted small" }, P.temp == null ? "estimated from this week's weather" : O.feel ? `from how it feels (${ADV_FEEL.find((f) => f[0] === O.feel)[1].toLowerCase()})` : "your number")),
      colorRow ? null : el("div", { class: "chips", role: "group", "aria-label": "Water clarity" }, ADV_CLAR.map((n, i) => el("button", { class: "chip", type: "button", "data-clar": i, "aria-pressed": String(P.clar === i), onclick: () => { P.clar = i; save(); draw(); } }, n))),
      el("div", { class: "chips", role: "group", "aria-label": "Type of water" }, [[false, "Lake or pond"], [true, "River or creek"]].map(([v, n]) => el("button", { class: "chip", type: "button", "data-river": v ? 1 : 0, "aria-pressed": String(P.river === v), onclick: () => { P.river = v; save(); draw(); } }, n))),
      el("b", null, "When"),
      el("div", { class: "stack", style: "gap:6px", id: "adv-when" }, wins.length ? wins.map((x) => el("div", { class: "adv-win" }, el("div", { class: "row spread" }, el("b", null, `${new Date(x.a).getDate() === new Date(w.current.time).getDate() ? "Today" : "Tomorrow"} ${WINDOW_NAMES[x.k].toLowerCase()}`), el("span", { class: "tag " + (x.s >= 75 ? "good" : x.s >= 55 ? "ok" : "bad") }, x.s + "/100")),
        el("span", { class: "s" }, range(x)), x.why.length ? el("span", { class: "muted small" }, x.why.slice(0, 3).join(". ") + ".") : null, vote(fish.n + "|win:" + x.k))) : [el("p", { class: "muted small" }, "No good windows left in this forecast. Check again later.")]),
      el("b", null, "Plan for"),
      el("div", { class: "chips", role: "group", "aria-label": "Pick a time to plan for" }, plans.map((p, i) => el("button", { class: "chip", type: "button", "data-plan": i, "aria-pressed": String(P.plan === i), onclick: () => { P.plan = i; P.feat = ""; draw(); } }, p.label))),
      el("div", { class: "row spread" }, el("b", null, "Lure"), el("button", { class: "btn small", type: "button", id: "adv-suggest", onclick: suggest }, "💡 Suggest a lure")),
      featured ? el("div", { class: "adv-lure adv-feature", id: "adv-feature" }, el("div", { class: "row spread" }, el("b", null, `Try this: ${featured.L.n}`), featured.n ? el("span", { class: "pill live" }, `${featured.n} nearby`) : null),
        el("span", { class: "s" }, `Fish it ${featured.L.d}. ${featured.L.how}`), el("span", { class: "muted small" }, "Why: " + featured.why.slice(0, 3).join("; ") + "."), vote(fish.n + "|" + featured.k)) : null,
      featured ? el("span", { class: "muted small" }, "More ideas") : null,
      el("div", { class: "stack", style: "gap:6px", id: "adv-lures" }, lures.map((r, i) => el("div", { class: "adv-lure" }, el("div", { class: "row spread" }, el("b", null, `${i + 1}. ${r.L.n}`), r.n ? el("span", { class: "pill live" }, `${r.n} nearby`) : null),
        el("span", { class: "s" }, `Fish it ${r.L.d}. ${r.L.how}`), el("span", { class: "muted small" }, "Why: " + r.why.slice(0, 3).join("; ") + "."), vote(fish.n + "|" + r.k)))),
      el("b", null, "Where"),
      el("ul", { class: "why", id: "adv-where" }, advWhere(fish, at, waterT, P.river, w, P.plan === 0 ? O : { ...O, acts: [] }).map((x) => el("li", null, x))),
      near.length ? el("div", { class: "stack", style: "gap:6px", id: "adv-near" }, el("b", null, "Catches near you"),
        near.map((x) => el("div", { class: "row spread adv-near", style: "gap:8px" }, el("span", { class: "s" }, `${(x.dKm / 1.609).toFixed(1)} mi away · ${x.species}${x.lb ? " " + x.lb + " lb" : ""}${x.lure ? " on " + x.lure : ""} · ${ago(x.createdAt)}`),
          el("button", { class: "btn small ghost", type: "button", onclick: () => { S.mapFilter = { species: "", lure: "", mine: false }; S.focusSpot = x.id; go("map"); } }, "Map")))) :
        el("p", { class: "muted small" }, "No catches of this fish posted near you yet, so this is from the weather and fish habits only. Post your catches with the lure and the place to make it smarter."),
      el("p", { class: "muted small" }, `Rules of thumb plus ${local.length} catch${local.length === 1 ? "" : "es"} posted in Weigh-In within 50 miles. Fish don't follow rules, so change lures if nothing bites in 20 minutes.`));
  };
  wrap.append(el("div", { class: "row spread" }, el("b", null, "Fishing advisor"), el("span", { class: "muted small" }, "lure · where · when")), el("div", { class: "row", style: "gap:8px;align-items:center" }, el("span", { class: "muted small" }, "I'm fishing for"), fishSel), body);
  P.est = Math.round(w.current.temperature_2m); draw();
  advWaterTemp(loc, w).then((t) => { P.est = t; if (P.temp == null) draw(); });
  return wrap;
}

function lureChart() {
  const wrap = el("div", { class: "stack", style: "margin-top:8px" });
  const dayMs = 86400000;
  const draw = () => {
    const f = S.biteFilter || (S.biteFilter = { days: 30, species: "" });
    const since = f.days ? Date.now() - f.days * dayMs : 0;
    const inWin = S.posts.filter((x) => catchMs(x) >= since && x.lure && String(x.lure).trim());
    const species = [...new Set(inWin.map((x) => String(x.species).trim()))].sort();
    if (f.species && !species.includes(f.species)) f.species = "";
    const rows = inWin.filter((x) => !f.species || String(x.species).trim() === f.species);
    const groups = new Map();
    for (const x of rows) {
      const k = String(x.lure).trim().toLowerCase().replace(/\s+/g, " ");
      const g = groups.get(k) || { name: (t => t.charAt(0).toUpperCase() + t.slice(1))(String(x.lure).trim().replace(/\s+/g, " ")), n: 0, lb: 0, nlb: 0 };
      g.n++; if (typeof x.lb === "number" && x.lb > 0) { g.lb += x.lb; g.nlb++; }
      groups.set(k, g);
    }
    const top = [...groups.values()].sort((a, b) => b.n - a.n).slice(0, 8);
    const max = top[0]?.n || 1;
    const periods = [[7, "7 days"], [30, "30 days"], [0, "All time"]];
    wrap.replaceChildren(...[
      el("h2", null, "What's biting"),
      el("div", { class: "chips" }, periods.map(([d, label]) => el("button", { class: "chip", type: "button", "aria-pressed": String(f.days === d), onclick: () => { f.days = d; draw(); } }, label))),
      species.length > 1 ? el("select", { "aria-label": "Fish type", onchange: (e) => { f.species = e.target.value; draw(); } },
        el("option", { value: "" }, "All fish"), species.map((s) => el("option", { value: s, selected: s === f.species ? "" : null }, s))) : null,
      top.length ? el("div", { class: "bars", role: "list" }, top.map((g) => el("div", { class: "bar-row", role: "listitem" },
        el("div", { class: "bar-name" }, g.name, g.nlb ? el("small", null, " · avg " + (g.lb / g.nlb).toFixed(1) + " lb") : null),
        el("div", { class: "bar-track" }, el("i", { style: "width:" + Math.max(6, Math.round(g.n / max * 85)) + "%" }), el("b", null, String(g.n)))))) :
        el("p", { class: "empty" }, "No catches with a lure listed in this time. Add the lure when you post a catch and it shows up here."),
      el("p", { class: "muted small" }, `Counts catches posted in Weigh-In (${rows.length} in this view), so it shows what your community is catching on, not every fish out there. Only the newest 40 catches are loaded.`)].filter(Boolean));
  };
  draw();
  return wrap;
}

/* ======================= FEED (swipe up/down) ======================= */
let $feed;
function renderFeed() {
  $screen.className = "screen feed-wrap";
  $feed = el("div", { class: "feed", "aria-label": "Catch feed. Swipe up for the next catch." });
  $screen.replaceChildren(el("div", { class: "feed-top" }, el("span", { class: "brand" }, "Weigh-In"),
    el("div", { class: "row", style: "gap:8px;flex-wrap:nowrap" },
      el("button", { class: "scope-btn", type: "button", id: "rc-btn", "aria-label": "Year in fish slideshows", hidden: S.recaps.length ? null : "", onclick: openRecaps }, "🎞️"),
      el("button", { class: "scope-btn", type: "button", id: "lb-btn", "aria-label": "Biggest catches leaderboard", onclick: () => openLeaderboard() }, "🏆"),
      el("button", { class: "scope-btn", type: "button", id: "scope-btn", "aria-label": "Choose whose catches to show", onclick: openScopeSheet }, scopeLabel() + " ▾"))), $feed);
  renderFeedCards();
}
/* Feed area: everyone, near me (opt-in location, kept only on this device), or one state */
const FEED_MILES = 50;
function scopeLabel() {
  const sc = getPref("feedScope", "all");
  if (sc === "near" && myFeedLoc()) return "Near me";
  if (sc === "state") { const st = getPref("feedState", ""); const n = (US_STATES.find((x) => x[0] === st) || [])[1]; if (n) return n; }
  return "Everyone";
}
function myFeedLoc() { try { const l = JSON.parse(getPref("feedLoc", "null")); return l && typeof l.lat === "number" ? l : null; } catch { return null; } }
function feedPosts() {
  const sc = getPref("feedScope", "all");
  if (sc === "state") { const st = getPref("feedState", ""); if (st) return S.posts.filter((x) => x.state === st); }
  if (sc === "near") {
    const me = myFeedLoc();
    if (me) {
      const ids = new Set(S.spots.filter((x) => typeof x.lat === "number" && typeof x.lng === "number" && km(me, x) <= FEED_MILES * 1.609).map((x) => x.id));
      return S.posts.filter((x) => ids.has(x.id));
    }
  }
  return S.posts;
}
/* What's new. Newest first. Add a new entry on top each time the app changes. */
/* Bump APP_VERSION every time you change the app, and add a matching entry on top of UPDATES (with v: the same number).
   Phones check app.js every few minutes and offer the new version on their own. */
const APP_VERSION = 54;
try { if ((parseInt(localStorage.getItem("weighin-appv"), 10) || 0) < APP_VERSION) localStorage.setItem("weighin-appv", String(APP_VERSION)); } catch { /* private mode */ }
const UPDATES = [
  { id: "2026-11-12h", v: 54, date: "Nov 12", title: "Rivers with no gauge", items: [
    "If a river or creek has no gauge, you now get a picture, fishing tips and buttons for the weather and bite forecast, rivers near you, or searching every state.",
    "New Search all states button when a name isn't found in your state."] },
  { id: "2026-11-12g", v: 53, date: "Nov 12", title: "River pictures, no Wikipedia", items: [
    "Each river gauge now has its own picture and a short description, made right in the app from the gauge numbers. Wikipedia is not used.",
    "The picture shows how big the river is and if the water is rising or falling."] },
  { id: "2026-11-12e", v: 51, date: "Nov 12", title: "New questions every time", items: [
    "Fishing school makes up new questions every time, with new numbers: ounces and pounds, size and bag limits, sunrise times, tournament totals, and where fish live.",
    "New Fishing math topic in Regular quiz.",
    "Lessons, finals and regular quizzes all mix in made up questions with the written ones."] },
  { id: "2026-11-12d", v: 50, date: "Nov 12", title: "Harder school and game restart fix", items: [
    "Fishing school ranks need 5 times more XP now. Your XP stays the same, but the ranks take a lot longer to reach.",
    "You need more right answers to pass a lesson, a final and a regular quiz.",
    "Fixed: when you restart your game progress, it no longer comes back from another phone or computer that still had the old progress. They get restarted too."] },
  { id: "2026-11-12c", v: 49, date: "Nov 12", title: "Search rivers", items: [
    "In Bite, the Rivers tab now has a search box. Type a river or creek name, pick a state and see its gauges.",
    "The old near-me list is still there as a Near me button."] },
  { id: "2026-11-12b", v: 48, date: "Nov 12", title: "Show password", items: [
    "When you sign in or make an account, tap Show password to see what you typed."] },
  { id: "2026-11-12a", v: 47, date: "Nov 12", title: "Color themes", items: [
    "New Appearance setting (Me, then Settings). Pick Auto, Light, Night or Black.",
    "Black is a black screen with red buttons and blue accents. You can switch back any time.",
    "The owner can give people access to start public tournaments in Owner tools."] },
  { id: "2026-11-11e", v: 46, date: "Nov 11", title: "Warnings", items: [
    "The owner and moderators can now send a warning to an angler. It shows up as a pop-up they have to read and tap I understand.",
    "Moderators need the new Warn anglers permission. The owner turns it on in Make mod."] },
  { id: "2026-11-11d", v: 45, date: "Nov 11", title: "Post your year in fish", items: [
    "At the end of your Year in fish slideshow, tap Post to feed to share it. Everyone can watch it.",
    "The new 🎞️ button at the top of the feed shows everyone's year slideshows. Tap one to watch.",
    "You can take yours down any time."] },
  { id: "2026-11-11c", v: 44, date: "Nov 11", title: "Photo slideshow and Your years", items: [
    "Your year in fish is all photos now. Your catches fill the whole screen.",
    "At the bottom of Me, Your years keeps every past year so you can watch them again."] },
  { id: "2026-11-11b", v: 43, date: "Nov 11", title: "Message alerts and Your year in fish", items: [
    "When a friend messages you, a banner pops up in the app. Tap it to open the chat.",
    "A red dot shows on the Me tab, and a New tag shows next to the friend, until you read the message.",
    "In December you get Your year in fish, a slideshow of your catches: how many, your biggest, your top fish, your best month and your photos.",
    "You can watch it again any time from the Me tab until mid January."] },
  { id: "2026-11-11a", v: 42, date: "Nov 11", title: "River gauges, leaderboards, tournament fish", items: [
    "Bite tab has a new Rivers tab. It shows real river gauges near the place you picked: water level, flow, and whether the river is rising or falling.",
    "Feed has a new 🏆 button. Pick any fish and see who has the biggest one. You can switch between weight and length.",
    "If somebody posts a bigger fish than your biggest of that kind, you get an alert.",
    "Tournaments can now count all fish, only one type of fish, or a few types. Only the right fish count on the leaderboard."] },
  { id: "2026-11-10d", v: 41, date: "Nov 10", title: "Game restart and motion bar", items: [
    "New ↻ button at the top of the fishing game restarts it (Free fishing).",
    "New Restart my game progress button in the fishing game menu. It erases your fish, coins, gear and level and starts from zero. It asks twice first.",
    "In Motion mode the power bar at the bottom is gone. How hard you flick is how far you cast."] },
  { id: "2026-11-10c", v: 40, date: "Nov 10", title: "Me tab cleanup", items: [
    "Tap your picture in Me to open your profile. My catches, Change name, Cash App and Change picture are in there now.",
    "The Fishing game button looks like the Fishing school one now.",
    "Owner and Moderator tools moved into Settings, at the bottom of Me."] },
  { id: "2026-11-10b", v: 39, date: "Nov 10", title: "Edit mode", items: [
    "New Edit mode switch at the top of Owner tools. Off by default, and it turns itself off every time the app closes.",
    "When it's off, the feed has no Delete (on other people's catches), Ban or Rename buttons. Report stays for everyone.",
    "When it's on, those buttons show on the feed, plus a Rename button to change the name of any catch.",
    "Fishing game: new 📱 Motion mode button at the top. Turn it on, then flick your phone forward to cast and tilt it left or right to aim. Flick it toward you when the ! shows to hook the fish. Tapping still works. On iPhone it asks to allow motion."] },
  { id: "2026-11-10a", v: 38, date: "Nov 10", title: "Game saves, aim your cast, names", items: [
    "Your fishing game progress now saves to your account. If you get a new phone or re-add the app, sign in and your fish, coins, gear and level come back.",
    "Aim your cast: drag your finger left or right on the water to pick where it lands. Tap to cast like before.",
    "New HOLD TO REEL button at the bottom while you fight a fish. Holding anywhere still works too.",
    "Cast way past the green into the red and you snag the weeds and the line breaks.",
    "You can change your name in Me. Rude names are blocked. You can change it once every 30 days.",
    "Owner tools: rename any angler (like user11233) and edit the name of any catch.",
    "Needs the new Firebase rules."] },
  { id: "2026-11-09q", v: 37, date: "Nov 9", title: "Private tournaments", items: [
    "New Private button in Tourneys. Anyone can make an invite-only tournament, no waiting for the owner.",
    "Everyone can see a private tournament in the list with a lock on it. Tap it and press Ask to join. The person who made it says yes or no.",
    "If you made a private tournament, join requests show up at the top of Tourneys with Approve and Decline.",
    "Public tournaments still come from the owner only.",
    "Needs the new Firebase rules for private tournaments."] },
  { id: "2026-11-09p", v: 36, date: "Nov 9", title: "Fish eat the lure, rough water, new line bar", items: [
    "When a fish bites it rushes the lure and eats it. The lure disappears and the water swirls where it was. The bobber gets pulled under.",
    "The water moves a lot more while you fight a fish: bigger waves, rings around the fish, a wake behind it and splashes.",
    "The line bar looks like real line now. At the bottom it is a loose untied knot, in the middle it is a straight normal line, and in the red it splits into 4 frayed, damaged strands."] },
  { id: "2026-11-09o", v: 35, date: "Nov 9", title: "Lures look underwater", items: [
    "Lures under the water now have a blue water tint so they look like they are really down there."] },
  { id: "2026-11-09n", v: 34, date: "Nov 9", title: "Lures sink in the water", items: [
    "Spinner, crankbait and minnow jig now sink down under the water after you cast. The line goes down to them.",
    "Fish swim up to the lure down in the water when they bite."] },
  { id: "2026-11-09m", v: 33, date: "Nov 9", title: "New bobber and lures in the game", items: [
    "The bobber only shows when you fish with the worm. It looks like a real push-button bobber now: white top, red bottom, red lip and a red button.",
    "Spinner, crankbait and minnow jig now show the actual lure in the water, with no bobber.",
    "New bobber app icon."] },
  { id: "2026-11-09l", v: 32, date: "Nov 9", title: "Fishing game runs smoother", items: [
    "The fishing game is much faster on older and cheaper phones. The scenery is drawn once instead of every frame.",
    "The game checks how your phone is doing. If it stutters, it lowers the detail by itself until it runs smooth.",
    "Text in the game has an outline so it stays easy to read."] },
  { id: "2026-11-09k", v: 31, date: "Nov 9", title: "Harder school, share button, better game", items: [
    "Fishing school quizzes are harder. Lessons are 6 questions and you need 5 right. Final quizzes need 8 out of 10.",
    "Every quiz is a new mix of questions, and you see ones you haven't seen first. There are about 150 questions now.",
    "Once you take a quiz, you can take it again tomorrow. This goes for lessons, final quizzes and regular quizzes.",
    "4 new lessons and a new Expert school: rigs and setups, fishing by season, boats and kayaks, and pro habits.",
    "School looks better: lettered answers, question numbers, a Hard tag and brighter cards.",
    "The fishing game is more real: reflections on the water, wavelets, moving light, the lure flies out and splashes down, the line sags and tightens, and the rod has a grip and guides.",
    "New Share button in Me to send the app to friends.",
    "Feed is the first tab on the far left."] },
  { id: "2026-11-09j", v: 30, date: "Nov 9", title: "Tournament requests and Cash App", items: [
    "Only the owner can start public tournaments now. Everyone else taps Request one, and the owner can approve or decline it.",
    "Feed is the first tab on the left again, with Post still in the middle.",
    "You can add your Cash App $cashtag in Me. People see a Pay on Cash App button on your profile and on your tournament's entry fee.",
    "Weigh-In can't connect to Cash App itself and never sees your money or login.",
    "Needs the new Firebase rules for tournament requests."] },
  { id: "2026-11-09i", v: 29, date: "Nov 9", title: "Trade tab, entry fees and prizes", items: [
    "New Trade tab on the left, with Post still in the middle. List a lure, rod, reel, line or other gear, and trade with other anglers.",
    "Make an offer with one or more items, add more items later, and the owner can accept, decline or ask for more. When it's accepted you open each other's profile to set up the swap.",
    "Tournaments can now have an entry fee, a prize, both, or neither. Weigh-In doesn't handle money. The organizer collects the fee and ticks people off as paid.",
    "Needs the new Firebase rules to work. Trading and paid tick-offs won't save until they're published."] },
  { id: "2026-11-09h", v: 28, date: "Nov 9", title: "Polish and easier updates", items: [
    "The Bite tab is sorted into three parts: Forecast, Advisor and What's biting.",
    "The video play button is centered, and a video pauses when you scroll away from it.",
    "A fresh look across the app: softer cards, buttons and a nicer tab bar.",
    "Fixed: the word null was showing up in the Advisor.",
    "One tap on Update now installs the newest version, even if you are several versions behind.",
    "When you close the app, it gets ready to open on the newest version next time."] },
  { id: "2026-11-09g", v: 27, date: "Nov 9", title: "Release notes and beta", items: [
    "What's new is now called Release notes.",
    "Version numbers now start with Beta, like Beta v27, because the app is still being built."] },
  { id: "2026-11-09f", v: 26, date: "Nov 9", title: "Personal best celebration", items: [
    "Catch your biggest fish of that kind and the app throws a celebration with confetti.",
    "Everyone gets a banner on the feed when a friend hits a personal best, and the catch gets a gold Personal best badge.",
    "The play button on videos got a new look."] },
  { id: "2026-11-09e", v: 25, date: "Nov 9", title: "Videos fill the screen", items: [
    "Fixed: videos in the feed now fill the whole screen like a photo, with no black bars."] },
  { id: "2026-11-09d", v: 24, date: "Nov 9", title: "Videos in posts", items: [
    "You can add a video of up to 30 seconds to a catch. Tap Record a video, or Choose a video, when you post.",
    "Videos show a Play video button on the feed. Tap it to watch.",
    "The free app has no file storage, so clips are squeezed small. If a video is too big, record a shorter one inside the app."] },
  { id: "2026-11-09c", v: 23, date: "Nov 9", title: "Knot pictures and videos", items: [
    "New Knot book in Fishing school: step by step pictures for the improved clinch, Palomar and uni knots.",
    "Every lesson now has a Watch a video button that opens a YouTube search for that topic."] },
  { id: "2026-11-09b", v: 22, date: "Nov 9", title: "Little details lessons", items: [
    "Fishing school has 6 new lessons: More knots, Reading the water, Signs on the surface (jumping fish, birds), Sky, wind and moon, Bait details, and Fish facts.",
    "New 6 day course called Little details. You can also find each lesson in the Lesson library or pick it in a regular quiz."] },
  { id: "2026-11-09", v: 21, date: "Nov 9", title: "Fishing school", items: [
    "New in Profile: Fishing school. Learn to fish with short daily lessons, like Duolingo.",
    "Pick a course: Permits and rules (1 day), Weekend start (2 days), Beginner in 5 days, or the Full week (7 days). Each day opens one lesson, and a final quiz comes after.",
    "Don't want to wait? Tap Do it now to open the next day early.",
    "Or take a regular quiz on any topic. A higher score gives more points and a higher fishing rank, from Minnow all the way up to Lake legend.",
    "New Beginner guide with your first 10 minutes, a rules checklist and a list of fishing words.",
    "See who has the most points in Top anglers."] },
  { id: "2026-11-08d", v: 20, date: "Nov 8", title: "Updates really install now", items: [
    "Fixed: some phones kept showing an old copy of the app even after an update, so new buttons never appeared. The app now loads the right version every time.",
    "Open the link with the version number on the end, like ?v=20, to force the newest copy.",
    "From now on the green Update now bar installs the new version for real."] },
  { id: "2026-11-08c", v: 19, date: "Nov 8", title: "Different lures every time", items: [
    "The Fishing advisor now mixes up its lure ideas, so you don't get the same three every time. Better lures still come up more often.",
    "New 💡 Suggest a lure button. Each press gives you one new lure to try, with how to fish it and why. It won't repeat the last few.",
    "Your Good suggestion? thumbs still count for the lure it shows."] },
  { id: "2026-11-08b", v: 18, date: "Nov 8", title: "Rate the advisor's suggestions", items: [
    "New: every lure and every time in the Fishing advisor now asks Good suggestion? with a thumbs up or thumbs down.",
    "A thumbs up makes that lure or time show up higher next time for that fish. A thumbs down pushes it lower. Tap again to take your answer back.",
    "Your answers stay on your phone."] },
  { id: "2026-11-08", v: 17, date: "Nov 8", title: "Tell the advisor what you see", items: [
    "New in the Fishing advisor: What you see right now. Set the water level (above average, average, below average, very low) and the water color (clear, green, tea, muddy, chalky).",
    "Say how the water feels on your skin (hot, warm, room temp, cool, cold, freezing). It sets the water temperature for you.",
    "Say how windy it is, and what's moving on the water, like fish jumping, boils, baitfish skipping, birds diving or bugs.",
    "The lure ideas, where to fish and the feeding alert change to match what you see. It remembers for 4 hours, then forgets because conditions change."] },
  { id: "2026-11-06c", v: 16, date: "Nov 6", title: "Gate keep search fixed", items: [
    "Fixed: Rocky bank never found anything because of a mistake in how the app asked the map server. It now finds rocky banks that are right next to a lake, river or creek.",
    "Fixed: Bridge only counts bridges that actually go over water.",
    "Fixed: the app asked the map server too many things at once, and it got blocked. It now asks one question at a time.",
    "Searches can take up to a minute because the map server is free and busy. You now see a timer, and if the server is busy it counts down and tries again by itself.",
    "Adding another clue only looks up the new clue, so narrowing down is faster."] },
  { id: "2026-11-06b", v: 15, date: "Nov 6", title: "Updates install themselves, plus fixes", items: [
    "The app now checks for new versions by itself. When one is ready you get a bar at the top that says Update now, and it also updates when you come back to the app.",
    "Every update in this list now shows its version number. Yours is shown in Settings.",
    "Fixed: the Use my location button works better and tells you what went wrong, like when location is turned off.",
    "Fixed: the Gate keep finder remembers what you typed, shows a drop-down of angler names, and has a Search button at the bottom.",
    "Fixed: Gate keep results now list details for each spot (public or private, free, fishing allowed, ground).",
    "New: tap Rule out on a spot and say why. Ruled out spots move to a list you can put them back from.",
    "Fixed: if the main map server is busy, it asks 3 others and then a simpler backup, so you get results instead of an error."] },
  { id: "2026-11-06", v: 10, date: "Nov 6", title: "Gate keep finder", items: [
    "New in Profile: Gate keep finder. Type the angler name of who you're looking for, then say how many minutes you will drive.",
    "Tap clues like Rocky bank, Pier, Boat ramp, Dam, Bridge or Lake and the list of real lakes and spots gets smaller until you find it.",
    "It uses real map data only. It never uses anyone's catches or pins from Weigh-In."] },
  { id: "2026-11-04", date: "Nov 4", title: "Fishing advisor for real-life fishing", items: [
    "New in the Bite tab: pick the fish you want and it ranks the 3 best lures, where to fish and the best times.",
    "It mixes the weather, water temperature, clarity, wind and light with what people near you actually caught fish on.",
    "Choose a time to plan for, and the lure and where advice changes to match it."] },
  { id: "2026-11-01d", date: "Nov 1", title: "Fishing game: more levels, higher prices, nicer look", items: [
    "Everything in the tackle shop costs 3x more, and lures cost more too.",
    "Every item has new top tiers that need a high level, up to a luxury charter yacht.",
    "Levels now have titles, from Beginner up to Fishing god, and every new level pays coins.",
    "5 new places at levels 13 to 25, 3 new fish, and 14 new achievements.",
    "Places are now picture cards, and the game changes with your real time of day: dawn, day, sunset and night with stars and a moon."] },
  { id: "2026-11-01c", date: "Nov 1", title: "Better trees", items: [
    "Every tree in the game now has a trunk, a shadow and fuller leaves, and the pines are shaded."] },
  { id: "2026-11-01b", date: "Nov 1", title: "Fishing game: tournaments, leaderboard and new places", items: [
    "Daily tournaments: every place has a cup each day. 3 casts, the same fish for everyone, heaviest total wins. Prizes come the next day.",
    "Leaderboard: top anglers, biggest fish, most fish and cup wins. Switch between everyone and just your friends.",
    "6 new places: Mill creek, Big reservoir, Northwoods lake, Mangrove flats, Great Lake and Deep blue canyon.",
    "4 new fish: Lake trout, White sturgeon, Sailfish and Blue marlin.",
    "Better backgrounds: light shafts, glitter, weeds, bubbles, a hazy horizon and little sailboats.",
    "The game menu now has tabs, and there are 6 new achievements."] },
  { id: "2026-11-01a", date: "Nov 1", title: "Realistic gear and achievements", items: [
    "You need a fishing licence first, then tackle, then serious gear like a fish finder and a boat.",
    "Gear unlocks through achievements and how much you have fished."] },
  { id: "2026-10-31", date: "Oct 31", title: "Fishing game, forecast and feed", items: [
    "Lake Duel fishing game with friend duels and salt water.",
    "The Bite tab shows wind, pressure and the best times to fish.",
    "Your area feed, and a more modern map."] }];
const unseenUpdate = () => getPref("seenNew", "") !== UPDATES[0].id;
function openWhatsNew(after) {
  setPref("seenNew", UPDATES[0].id);
  const close = () => { bg.remove(); after && after(); };
  const bg = el("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg) close(); } },
    el("div", { class: "sheet", role: "dialog", "aria-label": "Release notes", style: "height:auto;max-height:90%" },
      el("div", { class: "sheet-h" }, el("h2", null, "Release notes"), el("button", { class: "link", type: "button", id: "wn-close", onclick: close }, "Close")),
      el("p", { class: "hint", id: "wn-ver", style: "margin:0 16px" }, `You have beta version ${APP_VERSION}`),
      el("div", { class: "msgs about", style: "overflow:auto" }, UPDATES.map((u, i) => el("div", { class: "stack", style: "gap:6px", "data-update": u.id },
        el("div", { class: "row spread" }, el("b", null, (u.v ? `Beta v${u.v} · ` : "") + u.title), el("span", { class: i === 0 ? "pill live" : "muted small" }, i === 0 ? "Latest" : u.date)),
        el("ul", { style: "margin:0;padding-left:20px;display:flex;flex-direction:column;gap:4px" }, u.items.map((t) => el("li", null, t))))))));
  document.body.append(bg);
}
function openScopeSheet() {
  const close = () => bg.remove();
  const pick = (scope) => { setPref("feedScope", scope); close(); if (S.tab === "feed") renderFeed(); };
  const msg = el("p", { class: "muted small", "aria-live": "polite" });
  const stSel = el("select", { "aria-label": "State", onchange: (e) => { if (!e.target.value) return; setPref("feedState", e.target.value); pick("state"); } },
    el("option", { value: "" }, "Pick a state"), US_STATES.map(([c, n]) => el("option", { value: c }, n)));
  stSel.value = getPref("feedState", "");
  const sc = getPref("feedScope", "all");
  const bg = el("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg) close(); } },
    el("div", { class: "sheet", role: "dialog", "aria-label": "Feed area", style: "height:auto;max-height:90%" },
      el("div", { class: "sheet-h" }, el("h2", null, "Show catches from"), el("button", { class: "link", type: "button", onclick: close }, "Close")),
      el("div", { class: "msgs about" },
        el("button", { class: "chip wide", type: "button", id: "sc-all", "aria-pressed": String(sc === "all"), onclick: () => pick("all") }, "Everyone"),
        el("button", { class: "chip wide", type: "button", id: "sc-near", "aria-pressed": String(sc === "near"), onclick: () => {
          if (!navigator.geolocation) { msg.textContent = "This browser can't share your location. Pick a state instead."; return; }
          msg.textContent = "Asking for your location…";
          navigator.geolocation.getCurrentPosition(
            (pos) => { setPref("feedLoc", JSON.stringify({ lat: Math.round(pos.coords.latitude * 10) / 10, lng: Math.round(pos.coords.longitude * 10) / 10 })); pick("near"); },
            () => { msg.textContent = "Couldn't get your location. You can pick a state instead."; }, { timeout: 10000 });
        } }, "Near me (within " + FEED_MILES + " miles)"),
        stSel, msg,
        el("p", { class: "muted small" }, "Near me uses your location only when you tap it. It is rounded, kept on this device, and never saved to your account. It shows catches that were posted with a map pin. A state shows catches posted with that state."))));
  document.body.append(bg);
}
const cardCache = new Map();
function renderFeedCards() {
  if (!$feed || S.tab !== "feed") return;
  const list = feedPosts();
  const sb = document.getElementById("scope-btn"); if (sb) sb.textContent = scopeLabel() + " ▾";
  if (!list.length) {
    const filtered = S.posts.length > 0;
    $feed.replaceChildren(el("div", { class: "feed-empty" }, el("div", { class: "stack" },
      el("h2", null, filtered ? "No catches here yet" : "No catches yet"),
      el("p", null, filtered ? "Nobody has posted in this area. Be the first, or look at everyone's catches." : "Be the first. Tap the red Post button."),
      filtered ? el("button", { class: "btn", type: "button", id: "scope-all", onclick: () => { setPref("feedScope", "all"); renderFeed(); } }, "Show everyone") : null)));
    return;
  }
  // Keep the card you're looking at in view when new posts arrive.
  const cards = [...$feed.querySelectorAll(".card")];
  const h = $feed.clientHeight || 1;
  const currentId = cards[Math.round($feed.scrollTop / h)]?.dataset.id;
  const nodes = list.map((p) => { let n = cardCache.get(p.id); if (!n) { n = makeCard(p); cardCache.set(p.id, n); } return n; });
  $feed.replaceChildren(...nodes);
  const idx = currentId ? list.findIndex((p) => p.id === currentId) : 0;
  if (idx > 0) $feed.scrollTop = idx * $feed.clientHeight;
  paintLikes(); paintSpotBtns();
}
function makeCard(p) {
  const mine = p.uid === S.user.uid;
  return el("article", { class: "card", "data-id": p.id },
    p.photo ? el("img", { src: p.photo, alt: `${p.species} caught by ${p.name}`, loading: "lazy" }) : el("div", { class: "nophoto" }, "No photo"),
    p.vid ? vidCardLayer(p) : null,
    el("div", { class: "shade" }),
    el("div", { class: "info" },
      el("button", { class: "who", type: "button", "aria-label": `See ${p.name}'s catches`, onclick: () => openAngler(p.uid, p.name) }, avatar(p.uid, p.name, 30), el("span", null, "@" + p.name + "  ·  " + catchLabel(p))),
      p.pb ? el("div", { class: "pb-badge" }, "🏆 Personal best") : null,
      el("div", { class: "species" }, p.species),
      el("div", { class: "size" }, sizeText(p)),
      el("div", { class: "meta" }, [p.lure ? "Caught on " + p.lure : null, p.spot || null, placeLabel(p) || null, p.tournamentName ? "🏆 " + p.tournamentName : null].filter(Boolean).join("  ·  "))),
    el("div", { class: "side" },
      el("div", null, el("button", { type: "button", class: "like", "data-like": p.id, "aria-pressed": "false", "aria-label": "Like", html: ICON.heart, onclick: () => toggleLike(p) }), el("small", { "data-like-n": p.id }, "0")),
      el("div", { "data-spotbtn": p.id, hidden: true }, el("button", { type: "button", "aria-label": "See where this was caught on the map", html: ICON.map, onclick: () => seeOnMap(p) }), el("small", null, "Map")),
      el("div", null, el("button", { type: "button", "aria-label": "Comments", html: ICON.chat, onclick: () => openComments(p) }), el("small", null, "Comments")),
      mine || (editOn() && canOn("deletePosts", p.uid)) ? el("div", null, el("button", { type: "button", "aria-label": "Delete this post", html: ICON.trash, onclick: () => deletePost(p) }), el("small", null, "Delete")) : null,
      !mine ? el("div", null, el("button", { type: "button", "aria-label": "Report this post", html: ICON.flag, onclick: () => reportPost(p) }), el("small", null, "Report")) : null,
      editOn() && S.owner ? el("div", null, el("button", { type: "button", "aria-label": "Rename this catch", "data-rename-post": p.id, html: ICON.edit || "✏️", onclick: () => openPostEdit(p.id, p.species) }), el("small", null, "Rename")) : null,
      editOn() && can("warn") && !mine && p.uid !== OWNER_UID ? el("div", null, el("button", { type: "button", "aria-label": "Warn this angler", style: "font-size:20px", onclick: () => warnUser(p.uid, p.name) }, "⚠️"), el("small", null, "Warn")) : null,
      editOn() && can("ban") && !mine && p.uid !== OWNER_UID ? el("div", null, el("button", { type: "button", "aria-label": "Ban this angler", html: ICON.ban, onclick: () => banUser(p.uid, p.name) }), el("small", null, "Ban")) : null));
}
function paintLikes() {
  const me = S.user?.uid;
  document.querySelectorAll("[data-like]").forEach((b) => {
    const set = S.likes.get(b.dataset.like), on = !!(set && set.has(me));
    b.setAttribute("aria-pressed", String(on)); b.setAttribute("aria-label", on ? "Unlike" : "Like");
    const n = document.querySelector(`[data-like-n="${CSS.escape(b.dataset.like)}"]`); if (n) n.textContent = String(set ? set.size : 0);
  });
}
function paintSpotBtns() { document.querySelectorAll("[data-spotbtn]").forEach((d) => { d.hidden = !S.spots.some((x) => x.id === d.dataset.spotbtn); }); }
function seeOnMap(p) { S.mapFilter = { species: "", lure: "", mine: false }; S.focusSpot = p.id; go("map"); }
async function toggleLike(p) {
  const id = p.id + "_" + S.user.uid, set = S.likes.get(p.id) || new Set(), on = set.has(S.user.uid);
  const next = new Set(set); on ? next.delete(S.user.uid) : next.add(S.user.uid); S.likes.set(p.id, next); paintLikes(); // show it right away
  try { on ? await deleteDoc(doc(db, "likes", id)) : await setDoc(doc(db, "likes", id), { postId: p.id, uid: S.user.uid, createdAt: serverTimestamp() }); }
  catch (e) { S.likes.set(p.id, set); paintLikes(); toast(errText(e)); }
}
/* ======================= VIDEOS (up to 30 seconds) ======================= */
// The free plan has no file storage, so a clip is squeezed small and saved in pieces inside the database.
const VID_MAX_SEC = 30, VID_BITS = 450000, VID_MAX_BYTES = 2800000, VID_CHUNK = 600000;
let draftVid = null;   // { blob, mime, dur, poster }
const vidUrls = new Map();
const vidMime = () => { for (const m of ["video/mp4;codecs=avc1", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]) { try { if (window.MediaRecorder?.isTypeSupported(m)) return m; } catch { /* ignore */ } } return ""; };
const vidTime = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
function vidPoster(v) {
  try { const w = v.videoWidth || 640, h = v.videoHeight || 480, k = Math.min(1, 720 / Math.max(w, h)); const c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext("2d").drawImage(v, 0, 0, c.width, c.height); return c.toDataURL("image/jpeg", 0.7); } catch { return ""; }
}
function vidRecord(stream, onTick) {   // records a stream at a low bitrate; resolves with { blob, mime, dur }
  return new Promise((resolve, reject) => {
    const mime = vidMime(); let rec;
    try { rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: VID_BITS, audioBitsPerSecond: 48000 }); } catch (e) { reject(e); return; }
    const parts = []; const t0 = Date.now(); let timer;
    rec.ondataavailable = (e) => { if (e.data?.size) parts.push(e.data); };
    rec.onstop = () => { clearInterval(timer); resolve({ blob: new Blob(parts, { type: rec.mimeType || mime || "video/webm" }), mime: rec.mimeType || mime || "video/webm", dur: Math.min(VID_MAX_SEC, (Date.now() - t0) / 1000) }); };
    rec.onerror = (e) => { clearInterval(timer); reject(e.error || new Error("record")); };
    rec.start(500);
    timer = setInterval(() => { const sec = (Date.now() - t0) / 1000; onTick?.(sec); if (sec >= VID_MAX_SEC && rec.state !== "inactive") rec.stop(); }, 200);
    vidRecord.stop = () => { if (rec.state !== "inactive") rec.stop(); };
  });
}
function vidField(onChange) {
  const box = el("div", { class: "field", id: "vid-box" });
  const paint = () => {
    if (draftVid) {
      const v = el("video", { src: URL.createObjectURL(draftVid.blob), controls: "", playsinline: "", muted: "", class: "vid-prev", id: "vid-prev" });
      box.replaceChildren(el("span", null, "Video"), v, el("span", { class: "hint" }, `${vidTime(draftVid.dur)} · ${(draftVid.blob.size / 1e6).toFixed(1)} MB`),
        el("button", { class: "link", type: "button", id: "vid-remove", style: "align-self:flex-start", onclick: () => { draftVid = null; onChange(); paint(); } }, "Remove video"));
      return;
    }
    const file = el("input", { type: "file", accept: "video/*", id: "vid-file", hidden: "", onchange: async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) await fromFile(f); } });
    box.replaceChildren(el("span", null, "Video (optional, up to 30 seconds)"),
      el("div", { class: "row", style: "gap:8px;flex-wrap:wrap" },
        el("button", { class: "btn small", type: "button", id: "vid-rec", onclick: openRecorder }, "🎥 Record a video"),
        el("button", { class: "btn small ghost", type: "button", id: "vid-pick", onclick: () => file.click() }, "Choose a video"), file),
      el("span", { class: "hint" }, "Clips are squeezed small so the free app can hold them. Fishing videos only."));
  };
  async function fromFile(f) {
    toast("Getting your video ready…");
    const url = URL.createObjectURL(f), v = document.createElement("video"); v.muted = true; v.playsInline = true; v.src = url;
    try {
      await new Promise((ok, no) => { v.onloadedmetadata = ok; v.onerror = no; });
      if (v.duration > VID_MAX_SEC + 1) { toast(`That video is ${Math.round(v.duration)} seconds. The limit is 30.`); return; }
      if (f.size <= VID_MAX_BYTES) { await new Promise((ok) => { v.onseeked = ok; v.currentTime = Math.min(0.5, v.duration / 2); }); draftVid = { blob: f, mime: f.type || "video/mp4", dur: v.duration, poster: vidPoster(v) }; onChange(); paint(); return; }
      const cap = v.captureStream || v.mozCaptureStream;
      if (!cap || !window.MediaRecorder) { toast("That video is too big for the free app. Tap Record a video to film one inside the app."); return; }
      toast("Squeezing your video. This takes about as long as the video.");
      await v.play(); const poster = vidPoster(v);
      v.onended = () => vidRecord.stop?.();
      const out = await vidRecord(cap.call(v), () => { if (v.ended) vidRecord.stop?.(); });
      if (out.blob.size > VID_MAX_BYTES) { toast("Still too big. Try a shorter video."); return; }
      draftVid = { ...out, dur: v.duration || out.dur, poster }; onChange(); paint();
    } catch { toast("Couldn't read that video. Try Record a video instead."); }
    finally { URL.revokeObjectURL(url); }
  }
  function openRecorder() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast("This phone can't record in the app. Try Choose a video."); return; }
    let stream = null, closed = false;
    const live = el("video", { class: "vid-prev", id: "vid-live", muted: "", playsinline: "", autoplay: "" });
    const clock = el("b", { id: "vid-clock" }, "0:00 / 0:30");
    const go = el("button", { class: "btn", type: "button", id: "vid-go" }, "● Start");
    const cancel = el("button", { class: "link", type: "button", id: "vid-cancel" }, "Cancel");
    const shut = () => { closed = true; stream?.getTracks().forEach((t) => t.stop()); box.replaceChildren(); paint(); };
    cancel.onclick = () => { vidRecord.stop?.(); shut(); };
    box.replaceChildren(el("span", null, "Record a video"), live, el("div", { class: "row", style: "gap:10px;align-items:center" }, go, clock, cancel));
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } }, audio: true }).then((s) => {
      if (closed) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s; live.srcObject = s; live.muted = true; live.play().catch(() => {});
      let running = false;
      go.onclick = async () => {
        if (running) { vidRecord.stop?.(); return; }
        running = true; go.textContent = "■ Stop"; go.classList.add("danger");
        try {
          const out = await vidRecord(s, (sec) => { clock.textContent = `${vidTime(sec)} / 0:30`; });
          const poster = vidPoster(live);
          s.getTracks().forEach((t) => t.stop());
          if (out.blob.size > VID_MAX_BYTES) { toast("That clip came out too big. Try a shorter one."); closed = true; box.replaceChildren(); paint(); return; }
          draftVid = { ...out, poster }; closed = true; onChange(); paint();
        } catch { toast("Couldn't record. Check that the camera is allowed."); shut(); }
      };
    }).catch(() => { toast("Allow the camera and microphone to record, or tap Choose a video."); shut(); });
  }
  paint();
  return box;
}
async function vidSave(pid, uid, d) {   // stores the clip in pieces: vids/{pid}_{n}
  const url = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(d.blob); });
  const b64 = String(url).slice(String(url).lastIndexOf(",") + 1), n = Math.ceil(b64.length / VID_CHUNK);
  for (let i = 0; i < n; i++) await setDoc(doc(db, "vids", `${pid}_${i}`), { pid, uid, i, d: b64.slice(i * VID_CHUNK, (i + 1) * VID_CHUNK) });
  return n;
}
async function vidLoad(p) {
  if (vidUrls.has(p.id)) return vidUrls.get(p.id);
  const snap = await getDocs(query(collection(db, "vids"), where("pid", "==", p.id)));
  const parts = snap.docs.map((d) => d.data()).sort((a, b) => a.i - b.i);
  if (!parts.length || parts.length < (p.vid?.n || 1)) throw new Error("missing");
  const bin = atob(parts.map((x) => x.d).join("")), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([u8], { type: p.vid?.mime || "video/mp4" })); vidUrls.set(p.id, url); return url;
}
function vidCardLayer(p) {
  const tri = '<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="#fff"/></svg>';
  const ring = el("span", { class: "vid-ring" }); ring.innerHTML = tri;
  const dur = el("span", { class: "vid-dur" }, vidTime(p.vid.dur || 0));
  const btn = el("button", { class: "vid-play", type: "button", "aria-label": `Play video, ${vidTime(p.vid.dur || 0)}`, onclick: async (e) => {
    e.stopPropagation(); btn.disabled = true; ring.classList.add("spin"); ring.textContent = ""; dur.textContent = "Loading…";
    try { const url = await vidLoad(p); const v = el("video", { class: "vid-feed", src: url, playsinline: "", autoplay: "", loop: "", onclick: () => { v.paused ? v.play() : v.pause(); } }); btn.replaceWith(v); v.play().catch(() => {}); vidWatch(v); }
    catch { btn.disabled = false; ring.classList.remove("spin"); ring.innerHTML = tri; dur.textContent = "Try again"; toast("Couldn't load the video. Try again."); }
  } }, ring, dur);
  return btn;
}
/* ---- personal best celebration ---- */
function celebrate(title, sub) {
  document.querySelector(".pb-pop")?.remove();
  const pop = el("div", { class: "pb-pop", id: "pb-pop", role: "dialog", "aria-label": "Personal best" });
  const colors = ["#f5c542", "#e8742a", "#1b8fd1", "#3cc47c", "#ff5d73", "#ffffff"];
  for (let i = 0; i < 46; i++) pop.append(el("i", { class: "pb-bit", style: `left:${Math.random() * 100}%;background:${colors[i % colors.length]};animation-delay:${(Math.random() * 0.8).toFixed(2)}s;animation-duration:${(2.2 + Math.random() * 1.6).toFixed(2)}s;transform:rotate(${Math.round(Math.random() * 360)}deg)` }));
  pop.append(el("div", { class: "pb-card" }, el("div", { class: "pb-trophy" }, "🏆"), el("h2", null, "NEW PERSONAL BEST!"), el("b", null, title), el("span", null, sub),
    el("button", { class: "btn", type: "button", id: "pb-ok", onclick: () => pop.remove() }, "Nice!")));
  document.body.append(pop); setTimeout(() => pop.remove(), 6000);
}
const sk = (x) => String(x || "").trim().toLowerCase().replace(/\s+/g, " ");
const spVariants = (n) => { const t = String(n).trim().replace(/\s+/g, " "), l = t.toLowerCase(); return [...new Set([t, l, l.replace(/\b\w/g, (c) => c.toUpperCase()), l.charAt(0).toUpperCase() + l.slice(1), l.toUpperCase()])]; };
function myBestFor(species) {
  const k = sk(species); let lb = 0, inch = 0;
  for (const x of S.mine) if (sk(x.species) === k) { lb = Math.max(lb, +x.lb || 0); inch = Math.max(inch, +x.inches || 0); }
  return { lb, inch };
}
function checkBeaten(list) {
  if (!S.user || !S.mine.length) return;
  const hits = [];
  for (const p of list) {
    if (!p || p.uid === S.user.uid || !p.species) continue;
    const b = myBestFor(p.species); if (!b.lb && !b.inch) continue;
    if ((b.lb && +p.lb > b.lb) || (!b.lb && b.inch && +p.inches > b.inch)) hits.push({ p, b });
  }
  if (!hits.length) return;
  const top = hits.sort((x, y) => (+y.p.lb || 0) - (+x.p.lb || 0))[0], { p, b } = top;
  document.querySelector(".pb-alert")?.remove();
  const a = el("button", { class: "pb-alert", type: "button", id: "beat-alert", onclick: () => { a.remove(); openLeaderboard(p.species); } },
    el("span", null, "😬"), el("span", { class: "stack", style: "gap:0;text-align:left" }, el("b", null, `@${p.name} beat your biggest ${p.species}!`),
      el("span", null, `${sizeText(p)} passed your ${b.lb ? b.lb + " lb" : b.inch + " in"}.${hits.length > 1 ? ` ${hits.length - 1} more of your records got beaten too.` : ""} Tap to see.`)));
  document.body.append(a); setTimeout(() => a.remove(), 10000);
}

/* ---------- message alerts ---------- */
const msgUns = new Map();
function msgRead() { try { return JSON.parse(getPref("msgread", "{}")) || {}; } catch { return {}; } }
function markRead(fsId) {
  const r = msgRead(); r[fsId] = Date.now(); setPref("msgread", JSON.stringify(r));
  const had = S.unread.delete(fsId); updateDot(); if (had) refreshMe("friends");
}
function msgBanner(fs, m) {
  document.querySelector("#msg-alert")?.remove();
  const fr = friendOf(fs);
  const a = el("button", { class: "pb-alert", type: "button", id: "msg-alert", onclick: () => { a.remove(); openChat(fs); } },
    el("span", null, "💬"), el("span", { class: "stack", style: "gap:0;text-align:left;min-width:0" }, el("b", null, `@${fr.name} sent you a message`),
      el("span", { style: "overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, String(m.text || "").slice(0, 80))));
  document.body.append(a); try { navigator.vibrate?.(60); } catch { /* ok */ }
  setTimeout(() => a.remove(), 8000);
}
function syncMsgWatch() {
  if (!S.user) return;
  const ids = new Set(S.friendships.map((f) => f.id));
  for (const [id, u] of msgUns) if (!ids.has(id)) { u(); msgUns.delete(id); S.unread.delete(id); }
  for (const fs of S.friendships) {
    if (msgUns.has(fs.id)) continue;
    let first = true;
    msgUns.set(fs.id, onSnapshot(query(collection(db, "friendships", fs.id, "messages"), orderBy("createdAt", "desc"), limit(1)), (snap) => {
      const m = snap.docs[0]?.data({ serverTimestamps: "estimate" });
      const rd = msgRead();
      if (rd[fs.id] === undefined) { rd[fs.id] = Date.now(); setPref("msgread", JSON.stringify(rd)); }
      const t = m?.createdAt?.toMillis?.() ?? Date.now();
      const isNew = !!m && m.uid !== S.user.uid && t > rd[fs.id];
      if (S.chatOpen === fs.id) { if (isNew) markRead(fs.id); first = false; return; }
      if (isNew) { const was = S.unread.has(fs.id); S.unread.add(fs.id); if (!first && !was) msgBanner(fs, m); } else S.unread.delete(fs.id);
      first = false; updateDot(); refreshMe("friends");
    }, () => {}));
  }
}

/* ---------- Your year in fish ---------- */
const wrapSeason = () => { const d = new Date(); return d.getMonth() === 11 || (d.getMonth() === 0 && d.getDate() <= 15); };
const wrapYear = () => { const d = new Date(); return d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear(); };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
async function openWrapped(yr, auto) {
  if (!S.user || document.querySelector(".wrap-ov")) return;
  let all = S.mine;
  try { const q = await getDocs(query(collection(db, "posts"), where("uid", "==", S.user.uid), limit(500))); all = q.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) })); } catch { /* use what we have */ }
  const ps = all.filter((p) => new Date(catchMs(p)).getFullYear() === yr).sort((a, b) => catchMs(a) - catchMs(b));
  if (!ps.length) { if (!auto) toast(`No catches logged in ${yr} yet.`); return; }
  setPref("wrapped" + yr, "1");
  const count = (f) => { const m = new Map(); for (const p of ps) { const k = f(p); if (k) m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const spec = count((p) => sk(p.species)), mons = count((p) => MONTHS[new Date(catchMs(p)).getMonth()]);
  const nice = (k) => String(ps.find((x) => sk(x.species) === k)?.species || k).trim();
  const likeN = (p) => S.likes.get(p.id)?.size || 0;
  const byLb = [...ps].sort((a, b) => (+b.lb || 0) - (+a.lb || 0))[0];
  const liked = [...ps].sort((a, b) => likeN(b) - likeN(a))[0];
  const withPhoto = ps.filter((p) => p.photo);
  const chosen = [];
  for (const p of [byLb, liked, ...[...withPhoto].sort((a, b) => (+b.lb || 0) - (+a.lb || 0))]) if (p?.photo && !chosen.includes(p) && chosen.length < 8) chosen.push(p);
  chosen.sort((a, b) => catchMs(a) - catchMs(b));
  const d = {
    uid: S.user.uid, name: S.name, year: yr, n: ps.length, kinds: spec.length, topSp: nice(spec[0][0]), topN: spec[0][1],
    bigLb: +byLb?.lb || 0, bigSp: byLb?.species || "", bigIn: +byLb?.inches || 0, bigIdx: chosen.indexOf(byLb),
    likedN: liked ? likeN(liked) : 0, likedSp: liked?.species || "", likedIdx: liked ? chosen.indexOf(liked) : -1,
    likes: ps.reduce((n, p) => n + likeN(p), 0), month: mons[0]?.[0] || "", monthN: mons[0]?.[1] || 0,
    photos: chosen.map((p) => ({ p: p.photo, s: String(p.species || "Fish").slice(0, 40), z: sizeText(p) === "Size not entered" ? "" : sizeText(p), d: fmtDayY(p.catchDate || new Date(catchMs(p)).toISOString().slice(0, 10)) })),
  };
  playWrap(d, true);
}
function playWrap(d, own) {
  document.querySelector(".wrap-ov")?.remove();
  const yr = d.year, photos = d.photos || [];
  const H = (t, sz = 28, extra = "") => el("div", { style: `font-size:${sz}px;font-weight:800;line-height:1.1;text-wrap:balance;${extra}` }, t);
  const S2 = (t) => el("div", { style: "font-size:17px;opacity:.9;max-width:320px" }, t);
  const pool = photos.map((x) => x.p);
  let pi = 0; const nextPhoto = () => (pool.length ? pool[pi++ % pool.length] : "");
  const slides = [];
  const bk = getPref("theme", "auto") === "black";
  const tint = (g) => (bk ? g.replace("#e8742a,#7a2a0a", "#e11d2e,#4a0710").replace("#1f9d6a,#0a3b2a", "#2a5fd0,#0a1a4a").replace("#d6336c,#5a0f2b", "#c4182a,#3a050b").replace("#7b3fc4,#2a0f55", "#1e3a8a,#0a1230").replace("#1b8fd1,#08304f", "#2a5fd0,#0a1230") : g);
  const add = (bg, ...kids) => slides.push({ bg: tint(bg), kids, photo: nextPhoto() });
  const addP = (bg, photo, ...kids) => slides.push({ bg: tint(bg), kids, photo: photo || nextPhoto() });
  add("linear-gradient(160deg,#0b5fa5,#0a2a4a)", H("🎣", 72), H(`${own ? "Your" : "@" + d.name + "'s"} ${yr} in fish`, 38), S2(own ? `@${d.name}, here's your year on the water.` : "A year on the water."));
  add("linear-gradient(160deg,#e8742a,#7a2a0a)", S2(own ? "You logged" : "Logged"), H(String(d.n), 96), S2(d.n === 1 ? "catch this year" : "catches this year"));
  add("linear-gradient(160deg,#1f9d6a,#0a3b2a)", S2(own ? "You caught" : "Caught"), H(String(d.kinds), 80), S2(d.kinds === 1 ? "kind of fish" : "different kinds of fish"),
    el("div", { style: "font-size:20px;font-weight:700;margin-top:6px" }, `Most often: ${d.topSp} (${d.topN})`));
  if (d.bigLb) addP("linear-gradient(160deg,#7b3fc4,#2a0f55)", photos[d.bigIdx]?.p, S2(own ? "Your biggest fish" : "Biggest fish"), H(fmtLb(d.bigLb), 56), S2(`${d.bigSp || "Fish"}${d.bigIn ? " · " + fmtIn(d.bigIn) : ""}`));
  if (d.likedN > 0) addP("linear-gradient(160deg,#d6336c,#5a0f2b)", photos[d.likedIdx]?.p, S2(own ? "Your most liked catch" : "Most liked catch"), H(`❤️ ${d.likedN}`, 48), S2(`${d.likedSp || "Fish"} · ${d.likes} ${d.likes === 1 ? "like" : "likes"} in all`));
  if (d.month) add("linear-gradient(160deg,#1b8fd1,#08304f)", S2(own ? "Your best month" : "Best month"), H(d.month, 44), S2(`${d.monthN} ${d.monthN === 1 ? "catch" : "catches"}`));
  for (const x of photos) addP("linear-gradient(160deg,#222,#000)", x.p, H(x.s || "Fish", 30), S2([x.z, x.d].filter(Boolean).join(" · ")));
  const shareText = `${own ? "My" : "@" + d.name + "'s"} ${yr} in fish on Weigh-In: ${d.n} catches, ${d.kinds} kinds of fish${d.bigLb ? ", biggest " + fmtLb(d.bigLb) + " " + (d.bigSp || "") : ""}. 🎣`;
  const rid = d.uid + "_" + yr;
  const mine = () => S.recaps.some((r) => r.id === rid);
  const postBtn = el("button", { class: "btn", type: "button", id: "wrap-post", style: "margin-top:10px" });
  const paintPost = () => { postBtn.textContent = mine() ? "✓ Posted. Tap to take down" : "📣 Post to feed"; };
  paintPost();
  postBtn.onclick = async (e) => {
    e.stopPropagation(); postBtn.disabled = true;
    try {
      if (mine()) { await deleteDoc(doc(db, "recaps", rid)); S.recaps = S.recaps.filter((r) => r.id !== rid); toast("Taken down."); }
      else {
        const th = [];
        for (const x of photos) th.push({ p: (await thumbFrom(x.p, 420)) || "", s: x.s, z: x.z, d: x.d });
        const { uid, name, year, n, kinds, topSp, topN, bigLb, bigSp, bigIn, bigIdx, likedN, likedSp, likedIdx, likes, month, monthN } = d;
        await setDoc(doc(db, "recaps", rid), { uid, name, year, n, kinds, topSp, topN, bigLb, bigSp, bigIn, bigIdx, likedN, likedSp, likedIdx, likes, month, monthN, photos: th.filter((x) => x.p), createdAt: serverTimestamp() });
        S.recaps = [{ id: rid, uid, name, year, n }, ...S.recaps.filter((r) => r.id !== rid)];
        toast("Posted! Everyone can watch it from the 🎞️ button on the feed.");
      }
    } catch (err) { toast(errText(err)); }
    postBtn.disabled = false; paintPost();
  };
  const staffBtn = !own && isStaff() ? el("button", { class: "btn ghost", type: "button", id: "wrap-remove", style: "margin-top:6px", onclick: async (e) => { e.stopPropagation(); if (!confirm("Remove this slideshow from the feed?")) return; try { await deleteDoc(doc(db, "recaps", rid)); toast("Removed."); close(); } catch (err) { toast(errText(err)); } } }, "Remove from feed") : null;
  add("linear-gradient(160deg,#0b5fa5,#0a2a4a)", H("🏆", 64), H(`That's ${own ? "your" : "@" + d.name + "'s"} ${yr}!`, 34), S2(`See you on the water in ${yr + 1}.`),
    own ? postBtn : null,
    el("button", { class: "btn" + (own ? " ghost" : ""), type: "button", id: "wrap-share", style: "margin-top:6px", onclick: async (e) => { e.stopPropagation(); try { if (navigator.share) await navigator.share({ text: shareText }); else { await navigator.clipboard.writeText(shareText); toast("Copied. Paste it anywhere."); } } catch { /* cancelled */ } } }, "Share"),
    staffBtn,
    el("button", { class: "btn ghost", type: "button", id: "wrap-done", style: "margin-top:6px", onclick: (e) => { e.stopPropagation(); close(); } }, "Done"));
  let i = 0, timer = 0;
  const bars = el("div", { style: "display:flex;gap:4px;width:100%" }, slides.map(() => el("i", { style: "flex:1;height:3px;border-radius:2px;background:rgba(255,255,255,.3)" })));
  const body = el("div", { style: "flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;padding:10px 0;min-height:0" });
  const closeBtn = el("button", { type: "button", id: "wrap-x", "aria-label": "Close", style: "background:none;border:0;color:#fff;font-size:26px;line-height:1;padding:4px 8px;cursor:pointer", onclick: (e) => { e.stopPropagation(); close(); } }, "✕");
  const ov = el("div", { class: "wrap-ov", role: "dialog", "aria-label": `${yr} in fish`, style: "position:fixed;inset:0;z-index:9999;color:#fff;display:flex;flex-direction:column;padding:calc(12px + env(safe-area-inset-top,0px)) 16px calc(16px + env(safe-area-inset-bottom,0px));gap:8px;font-family:inherit;user-select:none;transition:background .3s" },
    bars, el("div", { style: "display:flex;justify-content:flex-end" }, closeBtn), body);
  const close = () => { clearTimeout(timer); ov.remove(); };
  const show = (n) => {
    clearTimeout(timer); i = Math.max(0, Math.min(slides.length - 1, n));
    const sl = slides[i];
    ov.style.background = sl.photo ? `linear-gradient(rgba(0,0,0,.35),rgba(0,0,0,.15) 40%,rgba(0,0,0,.75)), url("${sl.photo}") center/cover no-repeat, ${sl.bg}` : sl.bg;
    body.style.justifyContent = sl.photo ? "flex-end" : "center"; body.style.paddingBottom = sl.photo ? "28px" : "10px";
    body.style.textShadow = sl.photo ? "0 2px 12px rgba(0,0,0,.7)" : "none";
    body.replaceChildren(...sl.kids.filter(Boolean));
    [...bars.children].forEach((b, k) => { b.style.background = k <= i ? "#fff" : "rgba(255,255,255,.3)"; });
    if (i < slides.length - 1) timer = setTimeout(() => show(i + 1), 5200);
  };
  ov.addEventListener("click", (e) => { if (e.target.closest("button")) return; e.clientX < innerWidth / 3 ? show(i - 1) : show(i + 1); });
  document.body.append(ov); show(0);
}
function paintRecaps() {
  const box = document.querySelector("#rc-list"); if (!box) return;
  box.replaceChildren(...(S.recaps.length ? S.recaps.map((r) => el("button", { class: "item", type: "button", "data-rc": r.id, onclick: () => playWrap(r, r.uid === S.user.uid) },
    el("span", { class: "row", style: "gap:10px;flex-wrap:nowrap" }, avatar(r.uid, r.name, 34), el("span", { class: "t" }, "@" + r.name)),
    el("span", { class: "label" }, `${r.year} · ${r.n} ${r.n === 1 ? "catch" : "catches"} ›`))) : [el("p", { class: "empty" }, "Nobody has posted a year slideshow yet. Finish yours and tap Post to feed.")]));
}
function openRecaps() {
  const bg = el("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg) bg.remove(); } },
    el("div", { class: "sheet", role: "dialog", "aria-label": "Year in fish slideshows" },
      el("div", { class: "sheet-h" }, el("h2", null, "🎞️ Year in fish"), el("button", { class: "link", type: "button", onclick: () => bg.remove() }, "Close")),
      el("div", { class: "list", id: "rc-list" })));
  document.body.append(bg); paintRecaps();
}
document.addEventListener("visibilitychange", () => { if (document.hidden && S.user) setPref("pbseenAt", String(Date.now())); });
function openLeaderboard(startSpecies) {
  const opts = [...document.querySelectorAll("#species option")].map((o) => o.value || o.textContent).filter(Boolean);
  const mineLast = [...S.mine].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))[0];
  let sp = startSpecies || mineLast?.species || "Largemouth Bass", metric = "lb";
  const sel = el("select", { id: "lb-sp", "aria-label": "Pick a fish" }, ...opts.map((o) => el("option", { value: o }, o)), el("option", { value: "__other" }, "Other fish…"));
  const other = el("input", { id: "lb-other", placeholder: "Type a fish, like Striped Bass", maxlength: 40, hidden: "" });
  const seg = el("div", { class: "seg", role: "tablist" });
  const list = el("div", { class: "list", id: "lb-list" });
  const close = () => bg.remove();
  let token = 0;
  const load = async () => {
    const my = ++token; list.replaceChildren(el("p", { class: "muted" }, "Loading…"));
    try {
      const snap = await getDocs(query(collection(db, "posts"), where("species", "in", spVariants(sp)), limit(150)));
      if (my !== token) return;
      const best = new Map();
      for (const d of snap.docs) {
        const x = { id: d.id, ...d.data() }, v = +x[metric === "lb" ? "lb" : "inches"] || 0; if (!v) continue;
        const cur = best.get(x.uid); if (!cur || v > cur.v) best.set(x.uid, { ...x, v });
      }
      const rows = [...best.values()].sort((a, b) => b.v - a.v).slice(0, 25);
      if (!rows.length) { list.replaceChildren(el("p", { class: "muted" }, `Nobody has posted a ${sp} ${metric === "lb" ? "with a weight" : "with a length"} yet. Be the first!`)); return; }
      list.replaceChildren(...rows.map((r, i) => el("div", { class: "item", style: "cursor:default;gap:10px" + (r.uid === S.user.uid ? ";outline:2px solid var(--accent, #1f7a5c);border-radius:12px" : ""), "data-rank": String(i + 1) },
        el("span", { style: "width:28px;text-align:center;font-weight:800" }, ["🥇", "🥈", "🥉"][i] || String(i + 1)),
        avatar(r.uid, r.name, 36),
        el("div", { class: "stack", style: "gap:0;min-width:0;flex:1" }, el("span", { class: "t", style: "overflow-wrap:anywhere" }, "@" + r.name + (r.uid === S.user.uid ? " (you)" : "")),
          el("span", { class: "s" }, [r.lb ? r.lb + " lb" : "", r.inches ? r.inches + " in" : ""].filter(Boolean).join(" · ") + (r.catchDate ? " · " + r.catchDate : ""))),
        el("b", null, metric === "lb" ? r.v + " lb" : r.v + " in"))));
    } catch (err) { list.replaceChildren(el("p", { class: "muted" }, "Couldn't load that. " + errText(err))); }
  };
  const setSp = (v) => { sp = v; load(); };
  sel.addEventListener("change", () => { if (sel.value === "__other") { other.hidden = false; other.focus(); } else { other.hidden = true; setSp(sel.value); } });
  other.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); if (other.value.trim().length >= 3) setSp(other.value.trim()); } });
  other.addEventListener("change", () => { if (other.value.trim().length >= 3) setSp(other.value.trim()); });
  [["lb", "Weight"], ["in", "Length"]].forEach(([k, n]) => seg.append(el("button", { type: "button", role: "tab", id: "lb-m-" + k, "aria-selected": String(k === metric), onclick: () => { metric = k; [...seg.children].forEach((b) => b.setAttribute("aria-selected", String(b.id === "lb-m-" + k))); load(); } }, n)));
  const inList = opts.some((o) => sk(o) === sk(sp)); if (inList) sel.value = opts.find((o) => sk(o) === sk(sp)); else { sel.value = "__other"; other.hidden = false; other.value = sp; }
  const bg = el("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg) close(); } },
    el("div", { class: "sheet", role: "dialog", "aria-label": "Biggest catches", style: "max-height:88vh;overflow:auto" },
      el("div", { class: "sheet-h" }, el("h2", null, "🏆 Biggest catches"), el("button", { class: "link", type: "button", onclick: close }, "Close")),
      el("div", { class: "stack", style: "padding:16px" }, sel, other, seg, list,
        el("p", { class: "muted small", style: "margin:0" }, "Each angler's biggest catch of that fish. If someone beats your biggest, you get an alert."))));
  document.body.append(bg); load();
}
function pbAlert(p) {
  document.querySelector(".pb-alert")?.remove();
  const a = el("button", { class: "pb-alert", type: "button", id: "pb-alert", onclick: () => { a.remove(); const c = document.querySelector(`.card[data-id="${p.id}"]`); c?.scrollIntoView({ block: "start" }); } },
    el("span", null, "🏆"), el("span", { class: "stack", style: "gap:0;text-align:left" }, el("b", null, `@${p.name} just hit a personal best!`), el("span", null, `${p.species} · ${sizeText(p)}. Tap to see.`)));
  document.body.append(a); setTimeout(() => a.remove(), 8000);
}
const vidObs = ("IntersectionObserver" in window) ? new IntersectionObserver((es) => es.forEach((e) => { if (e.intersectionRatio < 0.5) e.target.pause?.(); }), { threshold: [0, 0.5, 1] }) : null;
function vidWatch(v) { vidObs?.observe(v); }
document.addEventListener("visibilitychange", () => { if (document.hidden) document.querySelectorAll("video.vid-feed").forEach((v) => v.pause()); });
async function vidDelete(pid, n) { for (let i = 0; i < (n || 12); i++) await deleteDoc(doc(db, "vids", `${pid}_${i}`)).catch(() => {}); }
async function deletePost(p) {
  if (!confirm("Delete this catch? This can't be undone.")) return;
  try {
    await deleteDoc(doc(db, "posts", p.id)); cardCache.delete(p.id);
    if (p.vid) vidDelete(p.id, p.vid.n);
    deleteDoc(doc(db, "spots", p.id)).catch(() => {}); // its map pin, if it had one
    toast("Catch deleted.");
  } catch (e) { toast(errText(e)); }
}

/* ======================= owner tools: reports, bans ======================= */
let ownerUns = [];
function stopOwner() { ownerUns.splice(0).forEach((u) => u()); }
const WARN_REASONS = ["Please post fishing photos only.", "Please keep comments and chat kind. No rude or hateful words.", "That post broke the rules. Please don't do it again.", "Next time you may be banned."];
function warnUser(uid, name) {
  if (!can("warn") || !uid || uid === S.user.uid || uid === OWNER_UID) return;
  const ta = el("textarea", { id: "warn-text", maxlength: 300, rows: 4, placeholder: "What should they know?", style: "width:100%;resize:vertical" });
  const close = () => bg.remove();
  const bg = el("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg) close(); } },
    el("div", { class: "sheet", role: "dialog", "aria-label": "Warn " + name },
      el("div", { class: "sheet-h" }, el("h2", null, "⚠️ Warn @" + name), el("button", { class: "link", type: "button", onclick: close }, "Cancel")),
    el("div", { class: "stack", style: "padding:0 16px 16px;gap:12px" },
      el("p", { class: "hint" }, "They will see this as a pop-up the next time they open Weigh-In."),
      el("div", { class: "chips" }, WARN_REASONS.map((r, i) => el("button", { class: "chip", type: "button", "data-reason": String(i), onclick: () => { ta.value = r; } }, r.replace(/\.$/, "")))),
      ta,
      el("button", { class: "btn wide", type: "button", id: "warn-send", onclick: async (e) => {
        const text = ta.value.trim(); if (!text) { toast("Write what the warning says."); return; }
        e.target.disabled = true;
        try { await addDoc(collection(db, "warnings"), { to: uid, toName: String(name).slice(0, 30), by: S.user.uid, byName: S.name, text, ack: false, createdAt: serverTimestamp() }); toast(`Warning sent to @${name}.`); close(); }
        catch (err) { toast(errText(err)); e.target.disabled = false; }
      } }, "Send warning"))));
  document.body.append(bg);
}
let warnQ = [];
function showWarnings(list) {
  warnQ = list.filter((w) => !w.ack).sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
  if (!warnQ.length || document.querySelector("#warn-pop")) return;
  const w = warnQ[0];
  const bg = el("div", { class: "sheet-bg", id: "warn-pop", style: "z-index:10000" },
    el("div", { class: "sheet", role: "alertdialog", "aria-label": "Warning" },
      el("div", { class: "sheet-h" }, el("h2", null, "⚠️ Warning")),
    el("div", { class: "stack", style: "padding:0 16px 16px;gap:12px" },
      el("p", null, "The Weigh-In team sent you a warning:"),
      el("p", { style: "font-weight:700;overflow-wrap:anywhere" }, w.text),
      el("p", { class: "hint" }, "Fishing photos only, no slurs or hate, be kind. Breaking the rules again can get an account banned."),
      el("button", { class: "btn wide", type: "button", id: "warn-ok", onclick: async () => {
        try { await updateDoc(doc(db, "warnings", w.id), { ack: true }); } catch (err) { toast(errText(err)); return; }
        bg.remove();
      } }, "I understand"))));
  document.body.append(bg);
}
async function toggleTourAccess(uid, name, has) {
  if (!S.owner) return;
  try {
    if (has) { await deleteDoc(doc(db, "tourAccess", uid)); toast(`@${name} can't start public tournaments anymore.`); }
    else { await setDoc(doc(db, "tourAccess", uid), { name: String(name).slice(0, 30), by: S.user.uid, createdAt: serverTimestamp() }); toast(`@${name} can now start public tournaments.`); }
  } catch (e) { toast(errText(e)); }
}
async function banUser(uid, name) {
  if (!can("ban")) return;
  if (uid === S.user.uid) { toast("You can't ban yourself."); return; }
  if (!confirm(`Ban @${name}? They won't be able to post, comment, or chat. You can undo it in Owner tools.`)) return;
  try { await setDoc(doc(db, "bans", uid), { name, by: S.user.uid, createdAt: serverTimestamp() }); toast(`@${name} is banned.`); }
  catch (e) { toast(errText(e)); }
}
function unbanUser(uid, name) { return deleteDoc(doc(db, "bans", uid)).then(() => toast(`@${name} is unbanned.`)).catch((e) => toast(errText(e))); }
async function reportPost(p) {
  if (!confirm("Report this catch to the owner? Use this for photos that aren't fishing, slurs, or anything rude.")) return;
  try {
    await setDoc(doc(db, "reports", p.id + "_" + S.user.uid), { postId: p.id, postUid: p.uid, postName: p.name, species: p.species,
      thumb: p.photo ? await thumbFrom(p.photo) : "", by: S.user.uid, byName: S.name, createdAt: serverTimestamp() });
    toast("Thanks. The owner will take a look.");
  } catch (e) { toast(/permission|insufficient/i.test(String(e?.message)) ? "You already reported this one." : errText(e)); }
}
async function ownerDeletePost(r, all = []) {
  if (!can("deletePosts")) return;
  if (!confirm(`Delete @${r.postName}'s ${r.species} post for everyone?`)) return;
  try { await deleteDoc(doc(db, "posts", r.postId)); cardCache.delete(r.postId); deleteDoc(doc(db, "spots", r.postId)).catch(() => {}); all.filter((x) => x.postId === r.postId).forEach((x) => deleteDoc(doc(db, "reports", x.id)).catch(() => {})); toast("Post deleted."); }
  catch (e) { toast(errText(e)); }
}
function openModEditor(uid, name, current) {
  const boxes = PERMS.map(([k, label]) => ({ k, label, input: el("input", { type: "checkbox", id: "perm-" + k, checked: current?.[k] ? "" : null }) }));
  const close = () => bg.remove();
  const save = async () => {
    const perms = {}; boxes.forEach((x) => { perms[x.k] = x.input.checked; });
    if (!Object.values(perms).some(Boolean)) { toast("Pick at least one thing, or tap Remove moderator."); return; }
    try { await setDoc(doc(db, "mods", uid), { name, perms, by: S.user.uid, createdAt: serverTimestamp() }); toast(`@${name} is now a moderator.`); close(); }
    catch (e) { toast(errText(e)); }
  };
  const bg = el("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg) close(); } },
    el("div", { class: "sheet", role: "dialog", "aria-label": "Moderator permissions", style: "height:auto;max-height:90%" },
      el("div", { class: "sheet-h" }, el("h2", { style: "overflow-wrap:anywhere" }, `Moderator: @${name}`), el("button", { class: "link", type: "button", onclick: close }, "Close")),
      el("div", { class: "msgs about" },
        el("p", { class: "muted small" }, "Choose what this person can do. They can never ban you or other moderators, and only you can change this list."),
        ...boxes.map((x) => el("label", { class: "row", style: "gap:12px;flex-wrap:nowrap" }, x.input, el("span", null, x.label))),
        el("button", { class: "btn wide", type: "button", onclick: save }, current ? "Save changes" : "Make moderator"),
        current ? el("button", { class: "link danger", type: "button", style: "align-self:flex-start", onclick: async () => {
          if (!confirm(`Remove @${name} as a moderator?`)) return;
          try { await deleteDoc(doc(db, "mods", uid)); toast(`@${name} is no longer a moderator.`); close(); } catch (e) { toast(errText(e)); }
        } }, "Remove moderator") : null)));
  document.body.append(bg);
}
function viewOwner(p) {
  stopOwner();
  const reportsBox = el("div", { class: "list" }, el("p", { class: "muted" }, "Loading…"));
  const membersBox = el("div", { class: "list" }, el("p", { class: "muted" }, "Loading…"));
  let bans = new Set(), users = [], reports = [], mods = new Map(), tacc = new Set();
  const paintReports = () => reportsBox.replaceChildren(...(reports.length ? reports.map((r) => el("div", { class: "item", style: "cursor:default;align-items:flex-start" },
    el("div", { class: "row", style: "gap:12px;flex-wrap:nowrap;min-width:0" },
      r.thumb ? el("img", { src: r.thumb, alt: "", style: "width:64px;height:64px;object-fit:cover;border-radius:8px;flex:none" }) : null,
      el("div", { class: "stack", style: "gap:2px;min-width:0" }, el("span", { class: "t" }, `@${r.postName}: ${r.species}`), el("span", { class: "s" }, `Reported by @${r.byName} · ${ago(r.createdAt)}`),
        el("div", { class: "row", style: "gap:12px" },
          can("deletePosts") ? el("button", { class: "link danger small", type: "button", onclick: () => ownerDeletePost(r, reports) }, "Delete post") : null,
          S.owner ? el("button", { class: "link small", type: "button", onclick: () => openPostEdit(r.postId, r.species) }, "Edit name") : null,
          can("warn") ? el("button", { class: "link small", type: "button", onclick: () => warnUser(r.postUid, r.postName) }, "Warn") : null,
          can("ban") ? el("button", { class: "link danger small", type: "button", onclick: () => banUser(r.postUid, r.postName) }, "Ban") : null,
          el("button", { class: "link small", type: "button", onclick: () => deleteDoc(doc(db, "reports", r.id)).catch((e) => toast(errText(e))) }, "Dismiss")))))) : [el("p", { class: "empty" }, "No reports. All quiet.")]));
  const paintMembers = () => { const rows = users.filter((u) => u.id !== S.user.uid);
    membersBox.replaceChildren(...(rows.length ? rows.map((u) => el("div", { class: "item", style: "cursor:default;flex-wrap:wrap" },
      el("span", { class: "row", style: "gap:8px;flex-wrap:nowrap;min-width:0" }, avatar(u.id, u.name, 28), el("span", { class: "t" }, "@" + u.name),
        bans.has(u.id) ? el("span", { class: "pill final" }, "Banned") : null, mods.has(u.id) ? el("span", { class: "pill soon" }, "Mod") : null, tacc.has(u.id) ? el("span", { class: "pill live" }, "Tourneys") : null),
      el("span", { class: "row", style: "gap:8px" },
        S.owner ? el("button", { class: "btn ghost small", type: "button", "data-rename": u.id, onclick: () => openOwnerRename(u.id, u.name) }, "Rename") : null,
        S.owner && u.id !== OWNER_UID ? el("button", { class: "btn ghost small", type: "button", "data-tacc": u.id, onclick: () => toggleTourAccess(u.id, u.name, tacc.has(u.id)) }, tacc.has(u.id) ? "Take away tourneys" : "Allow tourneys") : null,
        S.owner ? el("button", { class: "btn ghost small", type: "button", onclick: () => openModEditor(u.id, u.name, mods.get(u.id)) }, mods.has(u.id) ? "Edit mod" : "Make mod") : null,
        can("warn") && u.id !== OWNER_UID && u.id !== S.user.uid ? el("button", { class: "btn ghost small", type: "button", "data-warn": u.id, onclick: () => warnUser(u.id, u.name) }, "Warn") : null,
        can("ban") ? (bans.has(u.id) ? el("button", { class: "btn ghost small", type: "button", onclick: () => unbanUser(u.id, u.name) }, "Unban")
          : el("button", { class: "btn small", type: "button", onclick: () => banUser(u.id, u.name) }, "Ban")) : null))) : [el("p", { class: "empty" }, "No other anglers yet.")])); };
  if (can("reports")) ownerUns.push(onSnapshot(query(collection(db, "reports"), orderBy("createdAt", "desc"), limit(50)), (s) => { reports = s.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) })); paintReports(); }, () => reportsBox.replaceChildren(el("p", { class: "muted" }, "Couldn't load reports."))));
  if (can("ban")) ownerUns.push(onSnapshot(collection(db, "bans"), (s) => { bans = new Set(s.docs.map((d) => d.id)); paintMembers(); }, () => {}));
  if (S.owner) ownerUns.push(onSnapshot(collection(db, "tourAccess"), (s) => { tacc = new Set(s.docs.map((d) => d.id)); paintMembers(); }, () => {}));
  if (S.owner) ownerUns.push(onSnapshot(collection(db, "mods"), (s) => { mods = new Map(s.docs.map((d) => [d.id, d.data().perms || {}])); paintMembers(); }, () => {}));
  if (can("ban") || S.owner) ownerUns.push(onSnapshot(query(collection(db, "users"), limit(300)), (s) => { users = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.name).localeCompare(String(b.name))); paintMembers(); }, () => {}));
  const mine = PERMS.filter(([k]) => can(k)).map(([, l]) => l);
  const editBox = el("input", { type: "checkbox", id: "edit-mode", checked: S.editMode ? "" : null, style: "width:22px;height:22px;flex:none", onchange: (e) => { S.editMode = e.target.checked; cardCache.clear(); try { renderFeedCards(); } catch { /* feed not built yet */ } toast(S.editMode ? "Edit mode on. Buttons show on the feed." : "Edit mode off."); } });
  p.append(backBtn("‹ Profile"), el("h1", null, S.owner ? "Owner tools" : "Moderator tools"),
    el("label", { class: "row", style: "gap:12px;flex-wrap:nowrap;padding:12px 14px;border:2px solid var(--line, #c9d6de);border-radius:12px" }, editBox,
      el("span", { class: "stack", style: "gap:2px" }, el("b", null, "✏️ Edit mode"), el("span", { class: "hint" }, "Turn on to see Delete, Ban and Rename on the feed. It turns itself off when you close the app."))),
    el("p", { class: "muted small" }, S.owner
      ? "You can delete anyone's catch or comment with the Delete button, ban from the feed or the list below, and make moderators with the permissions you choose."
      : "You're a moderator. You can: " + (mine.join(", ") || "nothing yet") + ". Delete buttons show up right on catches and comments."),
    can("reports") ? el("section", { class: "stack" }, el("h2", null, "Reports"), reportsBox) : null,
    S.owner ? el("section", { class: "stack", id: "own-edit" }, el("h2", null, "Edit catch names"),
      el("p", { class: "muted small", style: "margin:0" }, "Change the name of any recent catch."),
      el("div", { class: "list" }, S.posts.slice(0, 40).map((x) => el("div", { class: "item", style: "cursor:default" },
        el("div", { class: "stack", style: "gap:0;min-width:0" }, el("span", { class: "t" }, x.species), el("span", { class: "s" }, "@" + x.name)),
        el("button", { class: "btn ghost small", type: "button", "data-edit": x.id, onclick: () => openPostEdit(x.id, x.species) }, "Edit"))))) : null,
    can("ban") || S.owner ? el("section", { class: "stack" }, el("h2", null, S.owner ? "Anglers and moderators" : "Anglers"), membersBox) : null);
}

/* ======================= someone's profile + their catches ======================= */
function openAngler(uid, name) {
  const body = el("div", { class: "msgs" }, el("p", { class: "muted" }, "Loading…"));
  const close = () => bg.remove();
  const bg = el("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg) close(); } },
    el("div", { class: "sheet", role: "dialog", "aria-label": `@${name}'s catches` },
      el("div", { class: "sheet-h" }, el("span", { class: "row", style: "gap:10px;flex-wrap:nowrap;min-width:0" }, avatar(uid, name, 40), el("h2", { style: "overflow-wrap:anywhere" }, "@" + name)),
        el("button", { class: "link", type: "button", onclick: close }, "Close")),
      body));
  document.body.append(bg);
  Promise.all([getDocs(query(collection(db, "posts"), where("uid", "==", uid), limit(20))), getUser(uid)]).then(([snap, u0]) => {
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) })).sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    const biggest = Math.max(0, ...rows.map((x) => x.lb || 0));
    const likes = rows.reduce((n, x) => n + (S.likes.get(x.id)?.size || 0), 0);
    const pins = S.spots.filter((x) => x.uid === uid).length;
    const lureCount = new Map();
    rows.forEach((x) => { const t = String(x.lure || "").trim(); if (t) lureCount.set(t.toLowerCase(), (lureCount.get(t.toLowerCase()) || 0) + 1); });
    const fav = [...lureCount.entries()].sort((a, b) => b[1] - a[1])[0];
    body.replaceChildren(...[
      el("div", { class: "stats" },
        el("div", null, el("b", null, String(rows.length)), el("span", null, "Catches")),
        el("div", null, el("b", null, biggest ? fmtLb(biggest) : "–"), el("span", null, "Biggest")),
        el("div", null, el("b", null, String(likes)), el("span", null, "Likes"))),
      cashTag(u0?.cash) ? cashButton(cashTag(u0.cash), `💵 ${cashTag(u0.cash)} on Cash App`) : null,
      fav ? el("p", { class: "muted small" }, `Most catches on: ${fav[0].charAt(0).toUpperCase() + fav[0].slice(1)} · ${pins} map pin${pins === 1 ? "" : "s"}`) : null,
      editOn() && can("warn") && uid !== S.user.uid && uid !== OWNER_UID ? el("button", { class: "link small", type: "button", id: "prof-warn", style: "align-self:flex-start", onclick: () => warnUser(uid, name) }, `⚠️ Warn @${name}`) : null,
      editOn() && can("ban") && uid !== S.user.uid && uid !== OWNER_UID ? el("button", { class: "link danger small", type: "button", style: "align-self:flex-start", onclick: () => banUser(uid, name) }, `Ban @${name}`) : null,
      ...(rows.length ? rows.map((c) => el("div", { class: "comment", style: "flex-direction:row;gap:12px;align-items:center" },
        c.photo ? el("img", { src: c.photo, alt: `${c.species} photo`, style: "width:72px;height:72px;object-fit:cover;border-radius:10px;flex:none" }) : null,
        el("div", { class: "stack", style: "gap:2px;min-width:0" }, el("b", null, `${c.species}, ${sizeText(c)}`),
          el("span", { class: "hint" }, `${c.lure ? "on " + c.lure + " · " : ""}${catchLabel(c)}${c.spot ? " · " + c.spot : ""}`),
          el("span", { class: "hint" }, `♥ ${S.likes.get(c.id)?.size || 0}`)))) : [el("p", { class: "empty" }, "No catches yet.")])].filter(Boolean));
  }).catch(() => body.replaceChildren(el("p", { class: "muted" }, "Couldn't load their catches.")));
}

/* ======================= comments sheet ======================= */
function openComments(p) {
  const list = el("div", { class: "msgs" }, el("p", { class: "muted" }, "Loading…"));
  const input = el("input", { id: "c-text", maxlength: 300, placeholder: "Add a comment", autocomplete: "off" });
  const close = () => { un(); bg.remove(); };
  const form = el("form", { class: "composer" }, input, el("button", { class: "btn small", type: "submit" }, "Send"));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim(); if (!text) return;
    if (badText(text)) { toast(NO_SLURS); return; }
    input.value = "";
    try { await addDoc(collection(db, "posts", p.id, "comments"), { uid: S.user.uid, name: S.name, text, createdAt: serverTimestamp() }); }
    catch (err) { toast(errText(err)); input.value = text; }
  });
  const bg = el("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg) close(); } },
    el("div", { class: "sheet", role: "dialog", "aria-label": "Comments" },
      el("div", { class: "sheet-h" }, el("h2", null, `Comments on @${p.name}'s ${p.species}`), el("button", { class: "link", type: "button", onclick: close }, "Close")),
      list, form));
  document.body.append(bg);
  const un = onSnapshot(query(collection(db, "posts", p.id, "comments"), orderBy("createdAt")), (s) => {
    const rows = s.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    if (!rows.length) { list.replaceChildren(el("p", { class: "muted" }, "No comments yet. Say something nice!")); return; }
    list.replaceChildren(...rows.map((c) => el("div", { class: "comment" },
      el("div", { class: "row spread" }, el("span", { class: "row", style: "gap:8px;flex-wrap:nowrap" }, avatar(c.uid, c.name, 24), el("b", null, "@" + c.name)), el("span", { class: "hint" }, ago(c.createdAt))),
      el("span", null, c.text),
      c.uid === S.user.uid || (editOn() && canOn("deleteComments", c.uid)) ? el("button", { class: "link danger small", type: "button", style: "align-self:flex-start", onclick: () => deleteDoc(doc(db, "posts", p.id, "comments", c.id)).catch((e) => toast(errText(e))) }, "Delete") : null)));
    list.scrollTop = list.scrollHeight;
  }, () => list.replaceChildren(el("p", { class: "muted" }, "Couldn't load comments.")));
}

/* ======================= POST a catch ======================= */
async function shrinkPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    let max = 1000, q = 0.75, out = "";
    for (let tries = 0; tries < 6; tries++) {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      out = c.toDataURL("image/jpeg", q);
      if (out.length < 600000) return out;
      max = Math.round(max * 0.8); q = Math.max(0.5, q - 0.08);
    }
    return out.length < 880000 ? out : "";
  } finally { URL.revokeObjectURL(url); }
}
function tourRange(t) {
  if (t.startAt && t.endAt) return { s: t.startAt, e: t.endAt };
  return { s: new Date(t.start + "T00:00:00").getTime(), e: new Date(t.end + "T23:59:59").getTime() };
}
function tourStatus(t) { const { s, e } = tourRange(t), now = Date.now(); return now < s ? "soon" : now > e ? "final" : "live"; }
const phasesOf = (t) => (Array.isArray(t.phases) ? t.phases : []);
function phaseWindows(t) {
  let at = tourRange(t).s;
  return phasesOf(t).map((ph, i) => { const w = { i, s: at, e: at + (ph.mins || 0) * 60000, ph }; at = w.e; return w; });
}
function phaseAt(t, ms = Date.now()) { const w = phaseWindows(t).find((x) => ms >= x.s && ms < x.e); return w ? w.i : -1; }
const lureOk = (rule, lure) => { const r = String(rule || "").trim().toLowerCase(), l = String(lure || "").trim().toLowerCase(); return !r || (!!l && (l.includes(r) || r.includes(l))); };
const fmtWhen = (ms) => new Date(ms).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
function fmtDur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${pad2(m)}m ${pad2(x)}s` : `${m}m ${pad2(x)}s`;
}
const dtLocal = (ms) => { const d = new Date(ms); return `${localDate(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
// Does this catch count? Timed tournaments only count catches inside the time window that follow the phase's lure rule.
function catchCounts(t, p) {
  if (!t.startAt) return true;
  const ms = p.createdAt?.toMillis?.() || 0, { s, e } = tourRange(t);
  if (ms && (ms < s || ms > e)) return false;
  const ph = phasesOf(t)[p.phase];
  return !(ph?.lure && !lureOk(ph.lure, p.lure));
}
let tick = null;
let draftPhoto = "", draftLoc = null, draftSrc = "", draftWhere = "";   // draftSrc: "auto" (found from the typed name) or "manual" (GPS or picked)
function viewPost(p) {
  const myLive = S.tournaments.filter((t) => tourStatus(t) === "live" && (t.members || []).includes(S.user.uid));
  const preview = el("div", { class: "photo-pick" });
  const removeBtn = el("button", { class: "link", type: "button", style: "align-self:flex-start", onclick: () => { draftPhoto = ""; paintPhoto(); } }, "Remove photo");
  const fileInput = el("input", { type: "file", accept: "image/*", id: "f-photo", "aria-label": "Catch photo", onchange: async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    toast("Getting your photo ready…");
    try { draftPhoto = await shrinkPhoto(file); if (!draftPhoto) toast("That photo is too big. Try another."); }
    catch { toast("Couldn't read that photo. Try another."); }
    e.target.value = "";
    paintPhoto();
  } });
  function paintPhoto() {
    preview.replaceChildren(draftPhoto ? el("img", { src: draftPhoto, alt: "Your catch photo" }) : el("span", { class: "muted" }, "Tap to take or choose a photo"), fileInput);
    removeBtn.hidden = !draftPhoto;
  }
  paintPhoto();
  if (draftSrc === "auto") { draftLoc = null; draftSrc = ""; draftWhere = ""; }   // the typed name starts empty on a fresh form
  const stateSel = el("select", { id: "f-state", name: "state", "aria-label": "State", onchange: (e) => { setPref("state", e.target.value); onSpotInput(); } },
    el("option", { value: "" }, "State"), US_STATES.map(([c, n]) => el("option", { value: c }, n)));
  stateSel.value = getPref("state", "");
  const locNote = el("span", { class: "hint" });
  const precSel = el("select", { id: "f-prec", name: "prec", "aria-label": "How exact the map pin is", onchange: () => setPref("prec", precSel.value) },
    el("option", { value: "approx" }, "Approximate area (about 1 km)"), el("option", { value: "exact" }, "Exact spot"));
  precSel.value = getPref("prec", "approx");
  const pickBtn = el("button", { class: "btn ghost small", type: "button", id: "f-pick", onclick: () => {
    const spotInput = document.getElementById("f-spot");
    openMapPicker(placeQuery(), draftLoc, (loc, name) => {
      draftLoc = loc; draftSrc = "manual"; draftWhere = ""; setPref("lastloc", JSON.stringify(loc));
      if (name && spotInput && !spotInput.value.trim()) spotInput.value = name.slice(0, 40);
      paintLoc();
    });
  } }, "🗺 Find or pick on map");
  const locBtn = el("button", { class: "btn ghost small", type: "button", id: "f-loc", onclick: () => {
    locBtn.disabled = true; locBtn.textContent = "Finding you…";
    wherePhone().then((o) => { draftLoc = o; draftSrc = "manual"; draftWhere = ""; setPref("lastloc", JSON.stringify(draftLoc)); locBtn.disabled = false; paintLoc(); })
      .catch((e) => { locBtn.disabled = false; paintLoc(); toast(e.message); });
  } }, "📍 Use my location");
  const locRemove = el("button", { class: "link", type: "button", style: "align-self:flex-start", onclick: () => { draftLoc = null; draftSrc = ""; draftWhere = ""; paintLoc(); } }, "Remove location");
  function paintLoc() {
    locBtn.hidden = !!draftLoc; locBtn.textContent = "📍 Use my location"; pickBtn.textContent = draftLoc ? "🗺 Change spot on map" : "🗺 Find or pick on map";
    locRemove.hidden = !draftLoc; precSel.hidden = !draftLoc;
    locNote.textContent = draftLoc
      ? (draftSrc === "auto" ? `Pinned on the map near ${draftWhere}. Wrong place? Tap "Change spot on map".` : "Pin added. Everyone using Weigh-In will see it on the map.")
      : "Type the spot's name and I'll put it on the map for you. Skip the name for your home or a secret spot.";
  }
  paintLoc();
  // As they type a place name, find it and pin it automatically (unless they picked a spot themselves).
  let spotTimer = 0, spotSeq = 0;
  const placeQuery = () => {
    const v = (id) => (document.getElementById(id)?.value || "").trim();
    const stName = US_STATES.find(([c]) => c === v("f-state"))?.[1] || "";
    const spot = v("f-spot"), city = v("f-city");
    if (spot.length < 3 && city.length < 2) return "";
    return [spot, city, stName].filter(Boolean).join(", ");
  };
  function onSpotInput() {
    clearTimeout(spotTimer);
    const text = placeQuery(), seq = ++spotSeq;
    if (draftSrc === "manual") return;
    if (!text) { if (draftSrc === "auto") { draftLoc = null; draftSrc = ""; draftWhere = ""; paintLoc(); } return; }
    spotTimer = setTimeout(async () => {
      const hit = (await findPlaces(text, 1))[0];
      if (seq !== spotSeq || draftSrc === "manual") return;   // they kept typing or picked a spot themselves
      if (hit) { draftLoc = { lat: hit.lat, lng: hit.lng }; draftSrc = "auto"; draftWhere = hit.full; }
      else if (draftSrc === "auto") { draftLoc = null; draftSrc = ""; draftWhere = ""; }
      paintLoc();
    }, 900);
  }
  const tourHint = el("span", { class: "hint", id: "f-tour-hint" }, myLive.length ? "Only tournaments you've joined that are happening now show up here." : "Join a tournament in Tourneys to count this catch.");
  const paintTourHint = (tid) => {
    const t = myLive.find((x) => x.id === tid);
    if (!t) { tourHint.textContent = myLive.length ? "Only tournaments you've joined that are happening now show up here." : "Join a tournament in Tourneys to count this catch."; return; }
    const ph = phasesOf(t)[phaseAt(t)];
    tourHint.textContent = (ph ? `Now: ${ph.name}${ph.where ? " at " + ph.where : ""}${ph.lure ? ". Lure rule: " + ph.lure + " only" : ""}.` : "This catch will count in this tournament.") + (tourSpecies(t).length ? ` Only ${tourSpeciesText(t)} counts.` : "");
  };
  const f = el("form", { novalidate: true },
    el("div", { class: "field" }, el("span", null, "Photo"), preview, removeBtn,
      el("span", { class: "hint" }, "Fishing photos only. Anything else gets removed and the account can be banned.")),
    vidField(() => { if (draftVid && !draftPhoto) { draftPhoto = draftVid.poster || ""; paintPhoto(); } }),
    el("label", { class: "field" }, el("span", null, "Fish type"),
      el("input", { id: "f-species", name: "species", list: "species", maxlength: 40, placeholder: "Largemouth Bass", autocomplete: "off", required: true })),
    el("div", { class: "two" },
      el("label", { class: "field" }, el("span", null, "Weight (lb)"), el("input", { id: "f-lb", name: "lb", type: "number", inputmode: "decimal", min: 0, max: 500, step: 0.01, placeholder: "4.5" })),
      el("label", { class: "field" }, el("span", null, "Length (in)"), el("input", { id: "f-in", name: "inches", type: "number", inputmode: "decimal", min: 0, max: 200, step: 0.25, placeholder: "18.5" }))),
    el("label", { class: "field" }, el("span", null, "Date caught"),
      el("input", { id: "f-date", name: "date", type: "date", value: localDate(new Date()), max: localDate(new Date()), min: localDate(new Date(Date.now() - 5 * 365 * 86400000)), required: true,
        onchange: (e) => { const old = e.target.value !== localDate(new Date()); const sel = document.getElementById("f-tour"); if (sel) { if (old) sel.value = ""; sel.disabled = old; } } }),
      el("span", { class: "hint" }, "Pick an earlier day if you're posting an older catch. Older catches can't count in a tournament.")),
    el("div", { class: "ruler", "aria-hidden": "true" }),
    el("label", { class: "field" }, el("span", null, "Lure or bait"),
      el("input", { id: "f-lure", name: "lure", list: "lures", maxlength: 40, placeholder: "Crankbait", autocomplete: "off" })),
    el("div", { class: "field" }, el("span", null, "Where you caught it"),
      el("div", { class: "two" },
        stateSel,
        el("input", { id: "f-city", name: "city", maxlength: 40, placeholder: "City", autocomplete: "off", "aria-label": "City", oninput: onSpotInput })),
      el("input", { id: "f-spot", name: "spot", maxlength: 40, placeholder: "Lake or spot name, like Lake Creve Coeur", autocomplete: "off", oninput: onSpotInput }),
      el("div", { class: "row" }, locBtn, pickBtn), precSel, locRemove, locNote),
    el("label", { class: "field" }, el("span", null, "Tournament"),
      el("select", { id: "f-tour", name: "tour", onchange: (e) => paintTourHint(e.target.value) }, el("option", { value: "" }, "No tournament"),
        myLive.map((t) => el("option", { value: t.id }, t.name))),
      tourHint),
    el("button", { class: "btn wide", type: "submit" }, "Post catch"));
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const species = String(fd.get("species") || "").trim();
    const lb = parseFloat(fd.get("lb")) || 0, inches = parseFloat(fd.get("inches")) || 0;
    if (!species) { toast("Enter what kind of fish it is."); return; }
    if (!draftPhoto) { toast("Add a photo of your fish. Fishing photos only."); return; }
    if (isBad(species, fd.get("lure"), fd.get("spot"), fd.get("city"))) { toast(NO_SLURS); return; }
    if (!lb && !inches) { toast("Add a weight or a length."); return; }
    const dateStr = String(fd.get("date") || localDate(new Date()));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || dateStr > localDate(new Date())) { toast("Pick a date that isn't in the future."); return; }
    const tid = dateStr === localDate(new Date()) ? String(fd.get("tour") || "") : "";
    const t = S.tournaments.find((x) => x.id === tid);
    const phaseIdx = t ? phaseAt(t) : -1, rule = t ? phasesOf(t)[phaseIdx] : null;
    if (rule?.lure && !lureOk(rule.lure, fd.get("lure"))) {
      if (!confirm(`This phase is "${rule.lure}" only. Your lure doesn't match, so this catch won't count in the tournament. Post it anyway?`)) return;
    }
    let tOk = !!t;
    if (t && !tourSpeciesOk(t, species)) {
      if (!confirm(`This tournament only counts ${tourSpeciesText(t)}. Your fish doesn't match, so it won't count in the tournament. Post it anyway?`)) return;
      tOk = false;
    }
    const btn = f.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Posting…";
    let pin = draftLoc, autoPinned = "";
    const spotText = String(fd.get("spot") || "").trim(), cityText = String(fd.get("city") || "").trim(), stateCode = String(fd.get("state") || "");
    const pq = placeQuery();
    if (!pin && pq) {   // they typed a place but didn't pin it yet: find it now
      btn.textContent = "Finding that spot…";
      const hit = (await findPlaces(pq, 1))[0];
      if (hit) { pin = { lat: hit.lat, lng: hit.lng }; autoPinned = hit.full; }
      btn.textContent = "Posting…";
    }
    try {
      const lure = String(fd.get("lure") || "").trim();
      let pb = "";
      try {   // is this their biggest of this fish so far?
        const mine = (await getDocs(query(collection(db, "posts"), where("uid", "==", S.user.uid)))).docs.map((d) => d.data()).filter((x) => String(x.species || "").toLowerCase() === species.toLowerCase());
        if (mine.length) {
          if (lb > 0 && lb > Math.max(0, ...mine.map((x) => +x.lb || 0))) pb = "weight";
          else if (!(lb > 0) && inches > 0 && inches > Math.max(0, ...mine.map((x) => +x.inches || 0))) pb = "length";
        }
      } catch { /* no celebration if we can't tell */ }
      const ref = doc(collection(db, "posts")); let vinfo = null;
      if (draftVid) {
        btn.textContent = "Saving video…";
        try { const n = await vidSave(ref.id, S.user.uid, draftVid); vinfo = { n, mime: draftVid.mime.split(";")[0], dur: Math.round(draftVid.dur * 10) / 10 }; }
        catch (err) { vidDelete(ref.id, 8); toast("Couldn't save the video: " + errText(err)); btn.disabled = false; btn.textContent = "Post catch"; return; }
        btn.textContent = "Posting…";
      }
      await setDoc(ref, {
        uid: S.user.uid, name: S.name, species, lb, inches, ...(vinfo ? { vid: vinfo } : {}), ...(pb ? { pb: true, pbKind: pb } : {}),
        lure, spot: spotText, city: cityText, state: stateCode,
        catchDate: dateStr, photo: draftPhoto || "", tournamentId: tOk ? t.id : "", tournamentName: tOk ? t.name : "",
        phase: phaseIdx, createdAt: serverTimestamp(),
      });
      let pinFailed = false;
      if (pin) {
        const exact = fd.get("prec") === "exact";
        const r = (n) => (exact ? Math.round(n * 1e5) / 1e5 : Math.round(n * 100) / 100); // 2 decimals is roughly 1 km
        try {
          await setDoc(doc(db, "spots", ref.id), { uid: S.user.uid, name: S.name, species, lb, inches, lure, lat: r(pin.lat), lng: r(pin.lng),
            precise: exact, catchDate: dateStr, spot: spotText, city: cityText, state: stateCode, thumb: draftPhoto ? await thumbFrom(draftPhoto) : "", createdAt: serverTimestamp() });
        } catch { pinFailed = true; }
      }
      draftPhoto = ""; draftVid = null; draftLoc = null; draftSrc = ""; draftWhere = "";
      if (pb) celebrate(species, sizeText({ lb, inches })); else toast(pinFailed ? `Posted your ${species}, but the map pin didn't save.` : pin ? `Posted your ${species} and put it on the map!` : `Posted your ${species}!`);
      go("feed");
    } catch (err) { toast(errText(err)); btn.disabled = false; btn.textContent = "Post catch"; }
  });
  p.append(el("h1", null, "Post a catch"), f);
}

/* ======================= CASH APP ======================= */
// Cash App has no way for another app to link to your account. Weigh-In only keeps your public $cashtag so people can tap a pay link.
const cashTag = (v) => { const t = String(v || "").trim().replace(/^\$/, ""); return /^(?=.*[A-Za-z])[A-Za-z0-9_]{1,20}$/.test(t) ? "$" + t : ""; };
const cashLink = (tag, amt) => "https://cash.app/" + tag + (amt ? "/" + amt : "");
function cashButton(tag, label, amt) { return el("a", { class: "btn small cash-btn", href: cashLink(tag, amt), target: "_blank", rel: "noopener" }, label || `💵 Pay ${tag} on Cash App`); }
/* ---------- names: change yours, owner can change anyone's ---------- */
async function renameUser(uid, oldName, newName) {
  const nl = newName.toLowerCase(), ol = String(oldName || "").toLowerCase();
  if (nl !== ol) {
    try { await setDoc(doc(db, "usernames", nl), { uid, name: newName }); }
    catch { toast(`"${newName}" is taken. Try another.`); return false; }
  }
  try { await updateDoc(doc(db, "users", uid), { name: newName, nameAt: serverTimestamp() }); }
  catch (err) { if (nl !== ol) deleteDoc(doc(db, "usernames", nl)).catch(() => {}); toast(errText(err)); return false; }
  if (nl !== ol && ol) deleteDoc(doc(db, "usernames", ol)).catch(() => {});
  try { const snap = await getDocs(query(collection(db, "posts"), where("uid", "==", uid), limit(150))); await Promise.all(snap.docs.map((d) => updateDoc(doc(db, "posts", d.id), { name: newName }).catch(() => {}))); } catch { /* the name still changed */ }
  updateDoc(doc(db, "fcboard", uid), { name: newName }).catch(() => {});
  userCache.delete(uid); cardCache.clear();
  if (uid === S.user.uid) { S.name = newName; S.nameAt = Date.now(); fcLastPub = ""; fcPublish(); }
  return true;
}
const NAME_DAYS = 30;
function openNameSheet(onDone) {
  const wait = !S.owner && S.nameAt ? S.nameAt + NAME_DAYS * 864e5 - Date.now() : 0;
  const inp = el("input", { id: "nm-in", maxlength: 20, value: S.name, autocapitalize: "off", autocorrect: "off", spellcheck: "false", "aria-label": "New angler name" });
  const close = () => bg.remove();
  const bg = el("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg) close(); } },
    el("div", { class: "sheet", role: "dialog", "aria-label": "Change name", style: "height:auto" },
      el("div", { class: "sheet-h" }, el("h2", null, "✏️ Change name"), el("button", { class: "link", type: "button", onclick: close }, "Close")),
      el("div", { class: "stack", style: "padding:16px" },
        el("p", { class: "muted", style: "margin:0" }, `Heads up: you can only change your name once every ${NAME_DAYS} days. Your old name becomes free for anyone to take, and your catches will show the new name. Rude or racist names are blocked.`),
        wait > 0 ? el("p", { id: "nm-wait", style: "margin:0;font-weight:700" }, `You can change it again in ${Math.ceil(wait / 864e5)} day${Math.ceil(wait / 864e5) === 1 ? "" : "s"}.`) : inp,
        wait > 0 ? null : el("p", { class: "hint", style: "margin:0" }, "2 to 20 letters, numbers or _"),
        wait > 0 ? null : el("button", { class: "btn wide", type: "button", id: "nm-save", onclick: async (e) => {
          const v = inp.value.trim();
          if (!NAME_RE.test(v)) { toast("Use 2 to 20 letters, numbers or _."); return; }
          if (badText(v)) { toast("That name isn't allowed. Pick another one."); return; }
          if (v === S.name) { toast("That's already your name."); return; }
          if (!confirm(`Change your name to @${v}? You can't change it again for ${NAME_DAYS} days.`)) return;
          e.target.disabled = true;
          const ok = await renameUser(S.user.uid, S.name, v);
          e.target.disabled = false;
          if (ok) { toast(`You're @${v} now.`); close(); onDone?.(); }
        } }, "Change my name"))));
  document.body.append(bg); if (!(wait > 0)) inp.focus();
}
function openOwnerRename(uid, oldName) {
  const rand = () => "user" + String(Math.floor(10000 + Math.random() * 90000));
  const inp = el("input", { id: "orn-in", maxlength: 20, value: rand(), autocapitalize: "off", autocorrect: "off", "aria-label": "New name" });
  const close = () => bg.remove();
  const bg = el("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg) close(); } },
    el("div", { class: "sheet", role: "dialog", "aria-label": "Rename angler", style: "height:auto" },
      el("div", { class: "sheet-h" }, el("h2", { style: "overflow-wrap:anywhere" }, `Rename @${oldName}`), el("button", { class: "link", type: "button", onclick: close }, "Close")),
      el("div", { class: "stack", style: "padding:16px" },
        el("p", { class: "muted", style: "margin:0" }, "Their name changes everywhere, including their catches. Their old name becomes free. They can pick their own name again after 30 days."),
        inp,
        el("div", { class: "row" },
          el("button", { class: "btn ghost small", type: "button", onclick: () => { inp.value = rand(); } }, "🎲 New random"),
          el("button", { class: "btn", type: "button", id: "orn-save", onclick: async (e) => {
            const v = inp.value.trim(); if (!NAME_RE.test(v)) { toast("Use 2 to 20 letters, numbers or _."); return; }
            e.target.disabled = true; const ok = await renameUser(uid, oldName, v); e.target.disabled = false;
            if (ok) { toast(`@${oldName} is now @${v}.`); close(); }
          } }, "Rename")))));
  document.body.append(bg); inp.select();
}
function openPostEdit(postId, cur) {
  const inp = el("input", { id: "pe-in", maxlength: 40, value: cur || "", "aria-label": "Catch name" });
  const close = () => bg.remove();
  const bg = el("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg) close(); } },
    el("div", { class: "sheet", role: "dialog", "aria-label": "Edit catch name", style: "height:auto" },
      el("div", { class: "sheet-h" }, el("h2", null, "Edit catch name"), el("button", { class: "link", type: "button", onclick: close }, "Close")),
      el("div", { class: "stack", style: "padding:16px" }, inp,
        el("button", { class: "btn wide", type: "button", id: "pe-save", onclick: async () => {
          const v = inp.value.trim(); if (!v) { toast("Type a name."); return; }
          try { await updateDoc(doc(db, "posts", postId), { species: v }); updateDoc(doc(db, "spots", postId), { species: v }).catch(() => {}); cardCache.delete(postId); toast("Catch name changed."); close(); } catch (err) { toast(errText(err)); }
        } }, "Save"))));
  document.body.append(bg); inp.focus();
}
function openCashSheet(onDone) {
  const cur = cashTag(S.cash);
  const inp = el("input", { id: "cash-in", maxlength: 21, placeholder: "$yourcashtag", value: cur, autocapitalize: "off", autocorrect: "off", "aria-label": "Your Cash App cashtag" });
  const close = () => bg.remove();
  const save = async (val) => {
    try { await setDoc(doc(db, "users", S.user.uid), { cash: val }, { merge: true }); userCache.delete(S.user.uid); S.cash = val; toast(val ? "Cash App saved." : "Cash App removed."); close(); onDone?.(); } catch (err) { toast(errText(err)); }
  };
  const bg = el("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg) close(); } },
    el("div", { class: "sheet", role: "dialog", "aria-label": "Cash App", style: "height:auto" },
      el("div", { class: "sheet-h" }, el("h2", null, "💵 Cash App"), el("button", { class: "link", type: "button", onclick: close }, "Close")),
      el("div", { class: "stack", style: "padding:16px" },
        el("p", { class: "muted", style: "margin:0" }, "Add your $cashtag so friends can pay you, like for a tournament entry fee. Anyone in Weigh-In can see it, so only add one you're happy to share."),
        inp,
        el("p", { class: "hint", style: "margin:0" }, "Weigh-In can't connect to your Cash App account and never sees your money, your PIN or your login. It only shows your $cashtag and a pay link that opens in Cash App."),
        el("div", { class: "row" }, el("button", { class: "btn", type: "button", id: "cash-save", onclick: () => { const v = cashTag(inp.value); if (!v) { toast("That doesn't look like a cashtag. Use letters and numbers, like $fisherman."); return; } save(v); } }, "Save"),
          cur ? el("button", { class: "link danger", type: "button", id: "cash-remove", onclick: () => save("") }, "Remove") : null))));
  document.body.append(bg); inp.focus();
}
/* ======================= TRADE ======================= */
// Swap fishing gear with other anglers. The app never handles money or shipping.
const TRADE_KINDS = [["lure", "Lures"], ["rod", "Rods"], ["reel", "Reels"], ["line", "Line"], ["tackle", "Hooks and tackle"], ["other", "Other gear"]];
const TRADE_ICON = { lure: "🪝", rod: "🎣", reel: "⚙️", line: "🧵", tackle: "🧰", other: "📦" };
const TRADE_CONDS = ["New", "Like new", "Used", "Worn"];
const tkName = (k) => (TRADE_KINDS.find((x) => x[0] === k) || ["", "Gear"])[1];
const NOT_GEAR = /\b(guns?|firearms?|ammo|ammunition|pistols?|rifles?|drugs?|weed|vapes?|alcohol|beer)\b/i;
let tradeUns = [];
function stopTrade() { tradeUns.splice(0).forEach((u) => u()); S.tradePaint = null; }
const tradeSeenKey = (o) => o.status + "|" + (o.counter || "");
function tradeSeenMap() { try { return JSON.parse(getPref("tradeSeen", "{}")) || {}; } catch { return {}; } }
function tradeUnseen() {
  const seen = tradeSeenMap();
  return S.offIn.some((o) => o.status === "pending" && seen["in" + o.id] !== "pending") || S.offOut.some((o) => (o.status === "accepted" || o.status === "declined" || o.counter) && seen["out" + o.id] !== tradeSeenKey(o));
}
function tradeMarkSeen() {
  const seen = {}; S.offIn.forEach((o) => { if (o.status === "pending") seen["in" + o.id] = "pending"; }); S.offOut.forEach((o) => { seen["out" + o.id] = tradeSeenKey(o); });
  setPref("tradeSeen", JSON.stringify(seen)); updateDot();
}
function viewTrade(p) {
  stopTrade();
  const T = S.trade || (S.trade = { seg: "browse", open: null, kind: "" });
  const box = el("div", { class: "stack", id: "trade-box" }); p.append(box);
  let loaded = false;
  const find = (id) => (S.tradeMine || []).find((x) => x.id === id) || (S.tradeAll || []).find((x) => x.id === id);
  const paint = () => {
    if (!box.isConnected && S.tab !== "trade") return;
    if (T.open === "new") return box.replaceChildren(tradeForm(T, paint));
    if (T.open) return box.replaceChildren(tradeDetail(T, paint, find));
    box.replaceChildren(tradeHome(T, paint, loaded));
  };
  S.tradePaint = paint;
  tradeUns.push(onSnapshot(query(collection(db, "trades"), orderBy("createdAt", "desc"), limit(40)), (s) => {
    S.tradeAll = s.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) })); loaded = true; paint();
  }, () => { loaded = true; S.tradeErr = true; paint(); }));
  tradeUns.push(onSnapshot(query(collection(db, "trades"), where("uid", "==", S.user.uid)), (s) => {
    S.tradeMine = s.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) })); paint();
  }, () => {}));
  paint();
}
function tradeCard(t, onOpen) {
  const offers = S.offIn.filter((o) => o.tid === t.id && o.status === "pending").length, mine = t.uid === S.user.uid;
  return el("button", { class: "trade-card", type: "button", "data-trade": t.id, onclick: () => onOpen(t.id) },
    t.photo ? el("img", { src: t.photo, alt: "", loading: "lazy" }) : el("span", { class: "trade-ph" }, TRADE_ICON[t.kind] || "📦"),
    el("span", { class: "stack", style: "gap:2px;min-width:0;flex:1;text-align:left" },
      el("b", { class: "trade-t" }, t.title),
      el("span", { class: "hint" }, [tkName(t.kind), t.cond].filter(Boolean).join(" · ")),
      t.wants ? el("span", { class: "muted small" }, "Wants: " + t.wants) : null,
      el("span", { class: "hint" }, mine ? "Yours · " + ago(t.createdAt) : `@${t.name} · ${ago(t.createdAt)}`)),
    t.status === "traded" ? el("span", { class: "pill final" }, "Traded") : t.status === "closed" ? el("span", { class: "pill final" }, "Closed")
      : mine && offers ? el("span", { class: "pill live" }, `${offers} offer${offers > 1 ? "s" : ""}`) : null);
}
function tradeHome(T, paint, loaded) {
  const me = S.user.uid, open = (id) => { T.open = id; paint(); };
  const inPend = S.offIn.filter((o) => o.status === "pending").length;
  const seg = el("div", { class: "seg", id: "trade-seg", role: "tablist" }, [["browse", "Browse"], ["mine", "My gear"], ["offers", "Offers" + (inPend ? ` (${inPend})` : "")]].map(([k, n]) =>
    el("button", { type: "button", role: "tab", id: "trade-seg-" + k, "aria-selected": String(T.seg === k), onclick: () => { T.seg = k; if (k === "offers") tradeMarkSeen(); paint(); } }, n)));
  const out = [el("div", { class: "row spread" }, el("h1", null, "Trade"), el("button", { class: "btn small", type: "button", id: "trade-new", onclick: () => open("new") }, "＋ List gear")), seg];
  if (T.seg === "browse") {
    out.push(el("div", { class: "chips", id: "trade-kinds" }, [["", "All"], ...TRADE_KINDS].map(([k, n]) => el("button", { class: "chip", type: "button", "data-kind": k, "aria-pressed": String(T.kind === k), onclick: () => { T.kind = k; paint(); } }, n))));
    const rows = (S.tradeAll || []).filter((t) => t.status === "open" && t.uid !== me && (!T.kind || t.kind === T.kind));
    if (S.tradeErr && !(S.tradeAll || []).length) out.push(el("p", { class: "empty" }, "Trading isn't switched on yet. Try again after the owner updates the app rules."));
    else if (!loaded) out.push(el("p", { class: "muted" }, "Loading…"));
    else if (!rows.length) out.push(el("p", { class: "empty" }, "Nothing here yet. Tap List gear to put up a lure, rod, reel or line you want to trade."));
    else out.push(el("div", { class: "stack", id: "trade-list" }, rows.map((t) => tradeCard(t, open))));
  } else if (T.seg === "mine") {
    const rows = [...(S.tradeMine || [])].sort((a, b) => (b.createdAt?.seconds || 9e9) - (a.createdAt?.seconds || 9e9));
    out.push(rows.length ? el("div", { class: "stack", id: "trade-mine" }, rows.map((t) => tradeCard(t, open))) : el("p", { class: "empty" }, "You haven't listed anything. Tap List gear."));
  } else {
    const byNew = (a, b) => (b.updatedAt?.seconds || 9e9) - (a.updatedAt?.seconds || 9e9), offCard = (o, sent) => el("button", { class: "trade-card", type: "button", "data-offer": o.id, onclick: () => open(o.tid) },
      el("span", { class: "trade-ph" }, sent ? "📤" : "📥"),
      el("span", { class: "stack", style: "gap:2px;min-width:0;flex:1;text-align:left" }, el("b", { class: "trade-t" }, sent ? `For ${o.ttitle}` : `@${o.name} offers for ${o.ttitle}`),
        el("span", { class: "hint" }, (o.items || []).map((i) => i.t).join(", ")), o.counter ? el("span", { class: "muted small" }, "💬 " + o.counter) : null),
      el("span", { class: "pill " + (o.status === "pending" ? "soon" : o.status === "accepted" ? "live" : "final") }, { pending: "Waiting", accepted: "Accepted", declined: "Declined", withdrawn: "Withdrawn" }[o.status] || o.status));
    out.push(el("h2", null, "Offers on my gear"), S.offIn.length ? el("div", { class: "stack", id: "trade-in" }, [...S.offIn].sort(byNew).map((o) => offCard(o, false))) : el("p", { class: "empty" }, "No offers yet."),
      el("h2", null, "Offers I made"), S.offOut.length ? el("div", { class: "stack", id: "trade-out" }, [...S.offOut].sort(byNew).map((o) => offCard(o, true))) : el("p", { class: "empty" }, "You haven't made any offers. Open something in Browse and tap Make an offer."));
  }
  out.push(el("p", { class: "hint" }, "Fishing gear only. Weigh-In never handles money or shipping. Meet in a public place and check what you're getting. Report anything that looks wrong."));
  return el("div", { class: "stack" }, out);
}
function tradeForm(T, paint) {
  let photo = "";
  const prev = el("div", { class: "photo-pick", style: "min-height:110px" });
  const fileIn = el("input", { type: "file", accept: "image/*", id: "tr-photo", "aria-label": "Photo of the gear", onchange: async (e) => {
    const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
    toast("Getting your photo ready…");
    try { const big = await shrinkPhoto(f); photo = big ? await thumbFrom(big, 480) : ""; if (photo.length > 150000) photo = await thumbFrom(photo, 320); } catch { toast("Couldn't read that photo."); }
    drawPrev();
  } });
  const drawPrev = () => prev.replaceChildren(photo ? el("img", { src: photo, alt: "Your gear" }) : el("span", { class: "muted" }, "Tap to add a photo (optional)"), fileIn);
  drawPrev();
  const f = el("form", { novalidate: true, class: "stack" },
    el("label", { class: "field" }, el("span", null, "What is it?"), el("input", { id: "tr-title", name: "title", maxlength: 60, placeholder: "Shimano Stradic 2500 reel", required: true })),
    el("div", { class: "two" },
      el("label", { class: "field" }, el("span", null, "Type"), el("select", { id: "tr-kind", name: "kind" }, TRADE_KINDS.map(([k, n]) => el("option", { value: k }, n)))),
      el("label", { class: "field" }, el("span", null, "Condition"), el("select", { id: "tr-cond", name: "cond" }, TRADE_CONDS.map((c) => el("option", { value: c, selected: c === "Used" ? "" : null }, c))))),
    el("label", { class: "field" }, el("span", null, "Details (optional)"), el("textarea", { id: "tr-desc", name: "desc", maxlength: 400, placeholder: "Size, brand, how much it's been used…" })),
    el("label", { class: "field" }, el("span", null, "What would you like in trade? (optional)"), el("input", { id: "tr-wants", name: "wants", maxlength: 120, placeholder: "A baitcasting reel or a box of crankbaits" })),
    el("div", { class: "field" }, el("span", null, "Photo"), prev),
    el("p", { class: "hint" }, "Fishing gear only. No weapons or anything illegal. Weigh-In doesn't take payments, so this is for swaps."),
    el("button", { class: "btn wide", type: "submit", id: "tr-post" }, "Post listing"));
  f.addEventListener("submit", async (e) => {
    e.preventDefault(); const fd = new FormData(f);
    const title = String(fd.get("title") || "").trim(), desc = String(fd.get("desc") || "").trim(), wants = String(fd.get("wants") || "").trim();
    if (!title) { toast("Say what you're trading."); return; }
    if (isBad(title, desc, wants)) { toast(NO_SLURS); return; }
    if (NOT_GEAR.test([title, desc, wants].join(" "))) { toast("Fishing gear only, please."); return; }
    const btn = f.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Posting…";
    try {
      await addDoc(collection(db, "trades"), { uid: S.user.uid, name: S.name, title, kind: String(fd.get("kind")), cond: String(fd.get("cond")), desc, wants, photo, status: "open", createdAt: serverTimestamp() });
      T.open = null; T.seg = "mine"; toast("Your gear is listed."); paint();
    } catch (err) { toast(errText(err)); btn.disabled = false; btn.textContent = "Post listing"; }
  });
  return el("div", { class: "stack" }, el("button", { class: "link", type: "button", style: "align-self:flex-start", id: "tr-back", onclick: () => { T.open = null; paint(); } }, "‹ Back"), el("h1", null, "List gear"), f);
}
function tradeItemsInput(items, max, onChange) {   // rows of "item" + "note" the person can add to
  const wrap = el("div", { class: "stack", id: "tr-items" });
  const draw = () => {
    wrap.replaceChildren(...items.map((it, i) => el("div", { class: "trade-item" },
      el("input", { class: "tr-it", maxlength: 50, placeholder: i === 0 ? "Item you'll give, like Penn spinning reel" : "Another item", value: it.t, "aria-label": "Item " + (i + 1), oninput: (e) => { it.t = e.target.value; onChange?.(); } }),
      el("input", { class: "tr-note", maxlength: 60, placeholder: "Condition or note (optional)", value: it.n || "", "aria-label": "Note " + (i + 1), oninput: (e) => { it.n = e.target.value; } }),
      items.length > 1 ? el("button", { class: "link danger small", type: "button", onclick: () => { items.splice(i, 1); draw(); } }, "Remove") : null)),
      items.length < max ? el("button", { class: "btn ghost small", type: "button", id: "tr-more", style: "align-self:flex-start", onclick: () => { items.push({ t: "", n: "" }); draw(); } }, "＋ Add another item") : null);
  };
  draw(); return wrap;
}
const cleanItems = (items) => items.map((i) => ({ t: String(i.t || "").trim(), n: String(i.n || "").trim() })).filter((i) => i.t);
function tradeDetail(T, paint, find) {
  const t = find(T.open), me = S.user.uid;
  const back = el("button", { class: "link", type: "button", id: "tr-back", style: "align-self:flex-start", onclick: () => { T.open = null; paint(); } }, "‹ Back");
  if (!t) {
    getDoc(doc(db, "trades", T.open)).then((d) => { if (d.exists()) { (S.tradeAll || (S.tradeAll = [])).push({ id: d.id, ...d.data() }); paint(); } else { T.open = null; toast("That listing is gone."); paint(); } }).catch(() => { T.open = null; paint(); });
    return el("div", { class: "stack" }, back, el("p", { class: "muted" }, "Loading…"));
  }
  const mine = t.uid === me, offersHere = S.offIn.filter((o) => o.tid === t.id), myOffer = S.offOut.find((o) => o.tid === t.id);
  const head = el("div", { class: "stack" }, back,
    t.photo ? el("img", { class: "trade-big", src: t.photo, alt: t.title }) : null,
    el("div", { class: "row" }, el("span", { class: "pill soon" }, tkName(t.kind)), t.cond ? el("span", { class: "pill final" }, t.cond) : null,
      t.status !== "open" ? el("span", { class: "pill final" }, t.status === "traded" ? "Traded" : "Closed") : null),
    el("h1", null, t.title),
    el("button", { class: "who-link", type: "button", onclick: () => openAngler(t.uid, t.name) }, avatar(t.uid, t.name, 28), el("span", null, mine ? "Your listing" : "@" + t.name)),
    t.desc ? el("p", { style: "margin:0;white-space:pre-wrap" }, t.desc) : null,
    t.wants ? el("p", { class: "muted", style: "margin:0" }, "Wants: " + t.wants) : null);
  const parts = [head];
  if (mine) {
    parts.push(el("h2", null, `Offers (${offersHere.length})`));
    if (!offersHere.length) parts.push(el("p", { class: "empty" }, "No offers yet."));
    [...offersHere].sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1)).forEach((o) => {
      const ask = el("input", { class: "tr-counter", maxlength: 200, placeholder: "Ask for more, like: add a spool of line", "aria-label": "Ask for more" });
      const upd = async (data, ok) => { try { await updateDoc(doc(db, "tradeOffers", o.id), { ...data, updatedAt: serverTimestamp() }); if (ok) toast(ok); } catch (err) { toast(errText(err)); } };
      parts.push(el("div", { class: "trade-offer", "data-offer": o.id },
        el("div", { class: "row spread" }, el("span", { class: "row", style: "gap:8px;flex-wrap:nowrap" }, avatar(o.uid, o.name, 28), el("b", null, "@" + o.name)),
          el("span", { class: "pill " + (o.status === "pending" ? "soon" : o.status === "accepted" ? "live" : "final") }, { pending: "Waiting", accepted: "Accepted", declined: "Declined", withdrawn: "Withdrawn" }[o.status] || o.status)),
        el("ul", { class: "why", style: "margin:4px 0" }, (o.items || []).map((i) => el("li", null, i.t + (i.n ? ` (${i.n})` : "")))),
        o.message ? el("p", { class: "muted", style: "margin:0" }, "“" + o.message + "”") : null,
        o.counter ? el("p", { class: "hint", style: "margin:0" }, "You asked: " + o.counter) : null,
        o.status === "pending" && t.status === "open" ? el("div", { class: "stack", style: "gap:8px" },
          el("div", { class: "row" },
            el("button", { class: "btn small", type: "button", "data-act": "accept", onclick: async () => {
              if (!confirm(`Accept @${o.name}'s offer? Your listing will be marked as traded.`)) return;
              try { await updateDoc(doc(db, "tradeOffers", o.id), { status: "accepted", updatedAt: serverTimestamp() }); await updateDoc(doc(db, "trades", t.id), { status: "traded", tradedWith: o.name }); toast("Deal! Open their profile to set up the swap."); } catch (err) { toast(errText(err)); }
            } }, "Accept"),
            el("button", { class: "btn ghost small", type: "button", "data-act": "decline", onclick: () => upd({ status: "declined" }, "Offer declined.") }, "Decline")),
          el("div", { class: "row", style: "gap:6px;flex-wrap:nowrap" }, ask, el("button", { class: "btn ghost small", type: "button", "data-act": "ask", onclick: () => { const v = ask.value.trim(); if (!v) { toast("Type what you'd like added."); return; } if (isBad(v)) { toast(NO_SLURS); return; } upd({ counter: v }, "Sent. They can add to their offer."); } }, "Ask for more")))
          : null,
        o.status === "accepted" ? el("button", { class: "btn small", type: "button", onclick: () => openAngler(o.uid, o.name) }, `Open @${o.name} to set up the swap`) : null));
    });
    parts.push(el("div", { class: "row" },
      t.status === "open" ? el("button", { class: "btn ghost small", type: "button", id: "tr-close", onclick: async () => { try { await updateDoc(doc(db, "trades", t.id), { status: "closed" }); toast("Listing closed."); } catch (err) { toast(errText(err)); } } }, "Close listing") : null,
      t.status === "closed" ? el("button", { class: "btn ghost small", type: "button", onclick: async () => { try { await updateDoc(doc(db, "trades", t.id), { status: "open" }); toast("Listing is open again."); } catch (err) { toast(errText(err)); } } }, "Open again") : null,
      el("button", { class: "link danger small", type: "button", id: "tr-del", onclick: async () => {
        if (!confirm("Delete this listing and its offers? This can't be undone.")) return;
        try { await Promise.all(offersHere.map((o) => deleteDoc(doc(db, "tradeOffers", o.id)).catch(() => {}))); await deleteDoc(doc(db, "trades", t.id)); T.open = null; toast("Listing deleted."); paint(); } catch (err) { toast(errText(err)); }
      } }, "Delete")));
    return el("div", { class: "stack" }, parts);
  }
  // someone else's listing
  const idOffer = `${t.id}_${me}`;
  const form = (restart) => {
    const items = [{ t: "", n: "" }], msg = el("textarea", { id: "tr-msg", maxlength: 300, placeholder: "Say something (optional)", "aria-label": "Message" });
    return el("div", { class: "stack trade-offer", id: "tr-offerform" }, el("h2", null, "Make an offer"), el("span", { class: "hint" }, "List what you'd trade. You can add more items later if they ask."),
      tradeItemsInput(items, 6), msg,
      el("button", { class: "btn wide", type: "button", id: "tr-send", onclick: async (e) => {
        const its = cleanItems(items); if (!its.length) { toast("Add at least one item to offer."); return; }
        const m = msg.value.trim(); if (isBad(m, ...its.flatMap((i) => [i.t, i.n]))) { toast(NO_SLURS); return; }
        if (NOT_GEAR.test([m, ...its.map((i) => i.t)].join(" "))) { toast("Fishing gear only, please."); return; }
        e.target.disabled = true;
        try {
          if (restart) await deleteDoc(doc(db, "tradeOffers", idOffer));
          await setDoc(doc(db, "tradeOffers", idOffer), { tid: t.id, tuid: t.uid, tname: t.name, ttitle: t.title, uid: me, name: S.name, items: its, message: m, status: "pending", createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
          toast("Offer sent."); 
        } catch (err) { toast(errText(err)); e.target.disabled = false; }
      } }, "Send offer"));
  };
  if (t.status !== "open" && !myOffer) parts.push(el("p", { class: "empty" }, "This one isn't available anymore."));
  else if (!myOffer) parts.push(form(false));
  else {
    const o = myOffer;
    parts.push(el("div", { class: "stack trade-offer", id: "tr-myoffer" },
      el("div", { class: "row spread" }, el("h2", null, "Your offer"), el("span", { class: "pill " + (o.status === "pending" ? "soon" : o.status === "accepted" ? "live" : "final") }, { pending: "Waiting", accepted: "Accepted", declined: "Declined", withdrawn: "Withdrawn" }[o.status] || o.status)),
      el("ul", { class: "why", style: "margin:4px 0" }, (o.items || []).map((i) => el("li", null, i.t + (i.n ? ` (${i.n})` : "")))),
      o.message ? el("p", { class: "muted", style: "margin:0" }, "“" + o.message + "”") : null,
      o.counter ? el("p", { class: "trade-counter", id: "tr-counter" }, `💬 @${t.name} asks: ${o.counter}`) : null,
      o.status === "accepted" ? el("button", { class: "btn small", type: "button", onclick: () => openAngler(t.uid, t.name) }, `🎉 Accepted! Open @${t.name} to set up the swap`) : null,
      o.status === "pending" ? (() => {
        const more = [{ t: "", n: "" }];
        return el("div", { class: "stack" }, el("b", null, "Add to your offer"), tradeItemsInput(more, Math.max(1, 6 - (o.items || []).length)),
          el("div", { class: "row" },
            el("button", { class: "btn small", type: "button", id: "tr-add", onclick: async () => {
              const its = cleanItems(more); if (!its.length) { toast("Type the item you want to add."); return; }
              if (isBad(...its.flatMap((i) => [i.t, i.n]))) { toast(NO_SLURS); return; }
              if ((o.items || []).length + its.length > 6) { toast("An offer can have up to 6 items."); return; }
              try { await updateDoc(doc(db, "tradeOffers", o.id), { items: [...(o.items || []), ...its], updatedAt: serverTimestamp() }); toast("Added to your offer."); } catch (err) { toast(errText(err)); }
            } }, "Add to offer"),
            el("button", { class: "link danger small", type: "button", id: "tr-withdraw", onclick: async () => { try { await updateDoc(doc(db, "tradeOffers", o.id), { status: "withdrawn", updatedAt: serverTimestamp() }); toast("Offer withdrawn."); } catch (err) { toast(errText(err)); } } }, "Withdraw")));
      })() : null,
      (o.status === "declined" || o.status === "withdrawn") && t.status === "open" ? el("div", { class: "stack" }, el("p", { class: "muted", style: "margin:0" }, o.status === "declined" ? "They said no this time." : "You withdrew this offer."), form(true)) : null));
  }
  return el("div", { class: "stack" }, parts.filter(Boolean));
}

/* ======================= TOURNAMENTS ======================= */
const SCORING = {
  heaviest: { name: "Heaviest fish", desc: "Biggest single fish by weight", unit: "lb" },
  bag: { name: "Bag weight", desc: "Your 5 heaviest fish added up", unit: "lb" },
  longest: { name: "Longest fish", desc: "Biggest single fish by length", unit: "in" },
  most: { name: "Most fish", desc: "Whoever catches the most fish", unit: "fish" },
};
const fmtFee = (n) => "$" + (Math.round(n * 100) % 100 ? Number(n).toFixed(2) : Math.round(n));
const tourSpecies = (t) => Array.isArray(t?.species) ? t.species.filter(Boolean) : [];
function tourSpeciesOk(t, species) {
  const list = tourSpecies(t); if (!list.length) return true;
  const k = sk(species); return list.some((n) => { const q = sk(n); return k === q || (q.length >= 3 && k.includes(q)); });
}
const tourSpeciesText = (t) => { const l = tourSpecies(t); return l.length === 1 ? l[0] : l.join(", "); };
const speciesPill = (t) => tourSpecies(t).length ? el("span", { class: "pill final", style: "align-self:flex-start", "data-species": "1" }, "🐟 " + tourSpeciesText(t) + (tourSpecies(t).length === 1 ? " only" : "")) : null;
function tourMoneyLine(t) {
  const fee = +t.fee || 0, prize = t.prize || "";
  if (!fee && !prize) return null;
  return el("span", { class: "tour-money-line" }, fee ? el("span", { class: "pill live" }, fmtFee(fee) + " entry") : el("span", { class: "pill soon" }, "Free entry"), prize ? el("span", { class: "pill final" }, "🎁 " + prize) : null);
}
function tourMoneyCard(t, joined) {
  const fee = +t.fee || 0, prize = t.prize || "";
  if (!fee && !prize) return null;
  const mineT = t.createdBy === S.user.uid, paid = t.paid || [t.createdBy], members = t.members || [];
  const payBox = el("div", { id: "tour-cash" }); if (fee) getUser(t.createdBy).then((u) => { const tag = cashTag(u?.cash); if (tag) payBox.replaceChildren(cashButton(tag, `💵 Pay ${fmtFee(fee)} on Cash App (${tag})`, fee)); });
  const setPaid = async (uid, on) => {
    const next = on ? [...new Set([...paid, uid])] : paid.filter((x) => x !== uid);
    try { await updateDoc(doc(db, "tournaments", t.id), { paid: next }); } catch (err) { toast(errText(err)); }
  };
  return el("section", { class: "stack tour-money", id: "tour-money" }, el("h2", null, "Entry and prize"),
    el("div", { class: "row", style: "gap:8px" }, fee ? el("span", { class: "pill live" }, fmtFee(fee) + " entry") : el("span", { class: "pill soon" }, "Free entry"), prize ? el("span", { class: "pill final" }, "🎁 " + prize) : null),
    fee && t.payHow ? el("p", { style: "margin:0" }, `Pay @${t.createdByName || "the organizer"}: ${t.payHow}`) : null,
    el("p", { class: "hint", style: "margin:0" }, fee ? "Weigh-In doesn't handle money. Pay the organizer yourself, and they tick you off as paid. The organizer also gives out the prize." : "The organizer gives out the prize."),
    fee && !mineT && t.createdBy ? payBox : null,
    fee && joined && !mineT ? el("p", { id: "tour-paid-me", class: paid.includes(S.user.uid) ? "pb-ok" : "hint", style: "margin:0;font-weight:700" }, paid.includes(S.user.uid) ? "✅ The organizer marked you as paid." : "Not marked as paid yet.") : null,
    fee && mineT ? el("div", { class: "stack", id: "tour-paid-list" }, el("b", null, "Who has paid"), members.filter((u) => u !== t.createdBy).length
      ? members.filter((u) => u !== t.createdBy).map((u) => { const row = el("label", { class: "row", style: "gap:10px;flex-wrap:nowrap" }, el("input", { type: "checkbox", "data-paid": u, checked: paid.includes(u) ? "" : null, onchange: (e) => setPaid(u, e.target.checked) }), el("span", null, "…")); getUser(u).then((x) => { row.lastChild.textContent = "@" + (x?.name || "angler"); }); return row; })
      : el("p", { class: "hint", style: "margin:0" }, "Nobody has joined yet.")) : null);
}
function tourSched(spec) { return spec.startAt ? fmtWhen(spec.startAt) : fmtDay(spec.start); }
function tourRequestsPanel() {
  const rs = [...S.tourReqs].sort((a, b) => (b.createdAt?.seconds || 9e9) - (a.createdAt?.seconds || 9e9));
  if (S.owner) {
    const pend = rs.filter((r) => r.status === "pending");
    if (!pend.length) return null;
    return el("section", { class: "stack tour-money", id: "tour-reqs" }, el("h2", null, `Requests (${pend.length})`), ...pend.map((r) => {
      const sp = r.spec || {};
      return el("div", { class: "trade-offer", "data-req": r.id },
        el("b", null, sp.name || r.tname), el("span", { class: "hint" }, `From @${r.name} · ${tourSched(sp)} · ${SCORING[sp.scoring]?.name || ""}`), tourMoneyLine(sp),
        el("div", { class: "row" },
          el("button", { class: "btn small", type: "button", "data-act": "approve", onclick: () => approveTour(r) }, "Approve"),
          el("button", { class: "btn ghost small", type: "button", "data-act": "deny", onclick: async () => { try { await updateDoc(doc(db, "tourRequests", r.id), { status: "declined" }); toast("Request declined."); } catch (err) { toast(errText(err)); } } }, "Decline")));
    }));
  }
  if (!rs.length) return null;
  return el("section", { class: "stack tour-money", id: "tour-reqs" }, el("h2", null, "Your requests"), ...rs.map((r) => el("div", { class: "row spread", "data-req": r.id },
    el("span", { class: "stack", style: "gap:0;min-width:0" }, el("b", null, r.tname || r.spec?.name), el("span", { class: "hint" }, r.status === "approved" ? "Approved. It's in the list below and you run it." : r.status === "declined" ? "The owner said not this time." : "Waiting for the owner.")),
    el("span", { class: "row", style: "gap:8px;flex-wrap:nowrap" }, el("span", { class: "pill " + (r.status === "approved" ? "live" : r.status === "declined" ? "final" : "soon") }, { pending: "Waiting", approved: "Approved", declined: "Declined" }[r.status] || r.status),
      r.status !== "pending" ? el("button", { class: "link small", type: "button", "aria-label": "Remove", onclick: () => deleteDoc(doc(db, "tourRequests", r.id)).catch(() => {}) }, "✕") : null))));
}
function tourJoinPanel() {
  const pend = S.joinIn.filter((r) => r.status === "pending");
  if (!pend.length) return null;
  return el("section", { class: "stack tour-money", id: "tour-joins" }, el("h2", null, `Join requests (${pend.length})`), ...pend.map((r) =>
    el("div", { class: "trade-offer", "data-join": r.id },
      el("b", null, "@" + r.name), el("span", { class: "hint" }, "wants to join " + (r.tname || "your tournament")),
      el("div", { class: "row" },
        el("button", { class: "btn small", type: "button", "data-act": "join-yes", onclick: async () => {
          const t = S.tournaments.find((x) => x.id === r.tid);
          try {
            if (t && !(t.members || []).includes(r.uid)) await updateDoc(doc(db, "tournaments", r.tid), { members: arrayUnion(r.uid) });
            await updateDoc(doc(db, "tourJoins", r.id), { status: "approved" }); toast(`@${r.name} is in.`);
          } catch (err) { toast(errText(err)); }
        } }, "Approve"),
        el("button", { class: "btn ghost small", type: "button", "data-act": "join-no", onclick: async () => {
          try { await updateDoc(doc(db, "tourJoins", r.id), { status: "declined" }); toast("Declined."); } catch (err) { toast(errText(err)); }
        } }, "Decline")))));
}
async function approveTour(r) {
  const sp = { ...r.spec }; if (!sp.startAt) { toast("That request is missing its dates."); return; }
  const dur = sp.endAt - sp.startAt, now = Math.floor(Date.now() / 60000) * 60000;
  if (sp.startAt < now) { sp.startAt = now; sp.endAt = now + dur; sp.start = localDate(new Date(sp.startAt)); sp.end = localDate(new Date(sp.endAt)); }   // its start time already passed, so it starts now
  try {
    await addDoc(collection(db, "tournaments"), { ...sp, createdBy: r.uid, createdByName: r.name, members: [r.uid], paid: [r.uid], createdAt: serverTimestamp() });
    await updateDoc(doc(db, "tourRequests", r.id), { status: "approved" });
    toast(`Approved. @${r.name} runs it now.`);
  } catch (err) { toast(errText(err)); }
}
function viewTours(p) {
  if (S.creatingTour) return viewCreateTour(p);
  if (S.openTournament) return viewTour(p);
  const order = { live: 0, soon: 1, final: 2 };
  const ts = [...S.tournaments].sort((a, b) => order[tourStatus(a)] - order[tourStatus(b)] || String(b.start).localeCompare(String(a.start)));
  p.append(el("div", { class: "row spread" }, el("h1", null, "Tourneys"),
    el("div", { class: "row", style: "gap:8px;flex-wrap:nowrap" },
      el("button", { class: "btn ghost small", type: "button", id: "t-new-priv", onclick: () => { S.creatingTour = "private"; renderTab(); } }, "🔒 Private"),
      el("button", { class: "btn small", type: "button", id: "t-new", onclick: () => { S.creatingTour = "public"; renderTab(); } }, canPubTour() ? "New" : "Request one"))));
  const joinPanel = tourJoinPanel(); if (joinPanel) p.append(joinPanel);
  const reqPanel = tourRequestsPanel(); if (reqPanel) p.append(reqPanel);
  if (!ts.length) { p.append(el("p", { class: "empty" }, canPubTour() ? "No tournaments yet. Tap New to start one." : "No tournaments yet. Tap Request one to ask the owner to start one.")); return; }
  p.append(el("div", { class: "list" }, ts.map((t) => {
    const st = tourStatus(t), n = (t.members || []).length;
    return el("button", { class: "item", type: "button", onclick: () => openTour(t.id) },
      el("div", { class: "stack", style: "gap:2px;min-width:0" }, el("span", { class: "t" }, t.name), t.private ? el("span", { class: "pill soon", style: "align-self:flex-start" }, "🔒 Invite only") : null, speciesPill(t), tourMoneyLine(t),
        el("span", { class: "s" }, `${SCORING[t.scoring]?.name || ""} · ${t.startAt ? fmtWhen(t.startAt) : fmtDay(t.start) + (t.end !== t.start ? " – " + fmtDay(t.end) : "")}${phasesOf(t).length ? " · " + phasesOf(t).length + " phases" : ""} · ${n} angler${n === 1 ? "" : "s"}`)),
      el("span", { class: "pill " + st }, { live: "Live", soon: "Upcoming", final: "Final" }[st]));
  })));
}
function viewCreateTour(p) {
  const priv = S.creatingTour === "private";
  const start0 = Math.floor(Date.now() / 60000) * 60000; // starts right now unless you change it
  const phaseRows = [];
  const phasesBox = el("div", { class: "stack" });
  const summary = el("span", { class: "hint" });
  const splitBox = el("input", { type: "checkbox", id: "t-split" });
  const endField = el("label", { class: "field" }, el("span", null, "Ends"), el("input", { id: "t-end", type: "datetime-local", value: dtLocal(start0 + 3 * 3600000) }));
  const phaseWrap = el("div", { class: "stack", hidden: true });
  const startInput = el("input", { id: "t-start", type: "datetime-local", value: dtLocal(start0) });
  const feeBox = el("input", { type: "checkbox", id: "t-feeon" });
  const feeIn = el("input", { id: "t-fee", type: "number", inputmode: "decimal", min: 1, max: 500, step: "0.01", placeholder: "5", "aria-label": "Entry fee in dollars" });
  const payIn = el("input", { id: "t-pay", maxlength: 60, placeholder: "Cash App $name, Venmo @name, or cash at the ramp", value: cashTag(S.cash) ? "Cash App " + cashTag(S.cash) : "", "aria-label": "How to pay" });
  const prizeIn = el("input", { id: "t-prize", maxlength: 60, placeholder: "Like $100 cash, or a new rod", "aria-label": "Prize" });
  const feeWrap = el("div", { class: "stack", hidden: true }, el("label", { class: "field" }, el("span", { class: "hint" }, "Entry fee ($)"), feeIn), el("label", { class: "field" }, el("span", { class: "hint" }, "How do people pay you?"), payIn));
  feeBox.addEventListener("change", () => { feeWrap.hidden = !feeBox.checked; });
  function paintSummary() {
    const mins = phaseRows.reduce((a, r) => a + (parseInt(r.mins.value) || 0), 0);
    const st = new Date(startInput.value).getTime();
    summary.textContent = mins && st ? `Total ${Math.floor(mins / 60)}h ${mins % 60}m. Ends ${fmtWhen(st + mins * 60000)}.` : "Enter the minutes for each phase.";
  }
  function addPhase(pre = {}) {
    const r = {
      name: el("input", { maxlength: 30, placeholder: "Phase " + (phaseRows.length + 1), value: pre.name || "", "aria-label": "Phase name" }),
      where: el("input", { maxlength: 40, placeholder: "Lake or spot (optional)", value: pre.where || "", "aria-label": "Lake or spot" }),
      lure: el("input", { maxlength: 30, placeholder: "Lure rule, like Crankbait (optional)", value: pre.lure || "", "aria-label": "Lure rule" }),
      mins: el("input", { type: "number", inputmode: "numeric", min: 5, max: 1440, placeholder: "Minutes", value: pre.mins || "", "aria-label": "Minutes", oninput: paintSummary }),
    };
    r.card = el("div", { class: "phase-card" },
      el("div", { class: "row spread" }, el("b", null, "Phase"), el("button", { class: "link danger small", type: "button", onclick: () => {
        if (phaseRows.length <= 1) { toast("Keep at least one phase, or turn phases off."); return; }
        phaseRows.splice(phaseRows.indexOf(r), 1); r.card.remove(); paintSummary();
      } }, "Remove")),
      r.name, r.where, r.lure, r.mins);
    phaseRows.push(r); phasesBox.append(r.card); paintSummary();
  }
  addPhase({ mins: 60 }); addPhase({ mins: 60 });
  phaseWrap.append(phasesBox, el("button", { class: "btn ghost small", type: "button", style: "align-self:flex-start", onclick: () => { if (phaseRows.length >= 8) { toast("That's the max of 8 phases."); return; } addPhase({ mins: 60 }); } }, "+ Add phase"), summary);
  splitBox.addEventListener("change", () => { phaseWrap.hidden = !splitBox.checked; endField.hidden = splitBox.checked; paintSummary(); });
  startInput.addEventListener("input", paintSummary);
  const spMode = el("select", { id: "t-spmode", "aria-label": "Which fish count" }, el("option", { value: "all" }, "Any fish"), el("option", { value: "one" }, "Only one type of fish"), el("option", { value: "many" }, "A few types of fish"));
  const spIn = el("input", { id: "t-species", maxlength: 150, placeholder: "Largemouth Bass", autocomplete: "off", hidden: "" });
  const spHint = el("span", { class: "hint", id: "t-sphint" }, "Every fish counts on the leaderboard.");
  spMode.addEventListener("change", () => {
    const m = spMode.value; spIn.hidden = m === "all";
    if (m === "one") { spIn.setAttribute("list", "species"); spIn.placeholder = "Largemouth Bass"; spHint.textContent = "Only this fish counts. Other fish posted into the tournament are left out."; }
    else if (m === "many") { spIn.removeAttribute("list"); spIn.placeholder = "Largemouth Bass, Crappie, Bluegill"; spHint.textContent = "Separate the fish with commas (up to 6). Typing just Bass counts every kind of bass."; }
    else spHint.textContent = "Every fish counts on the leaderboard.";
  });
  const f = el("form", { novalidate: true },
    el("label", { class: "field" }, el("span", null, "Name"), el("input", { id: "t-name", name: "name", maxlength: 40, placeholder: "Saturday Bass Bash", required: true })),
    el("label", { class: "field" }, el("span", null, "How is the leaderboard scored?"),
      el("select", { id: "t-scoring", name: "scoring" }, Object.entries(SCORING).map(([k, s]) => el("option", { value: k }, `${s.name}: ${s.desc}`))),
      el("span", { class: "hint" }, "First fish, biggest fish and most fish awards are always shown too.")),
    el("div", { class: "field", id: "t-fish" }, el("span", null, "Which fish count?"), spMode, spIn, spHint),
    el("label", { class: "field" }, el("span", null, "Starts"), startInput),
    endField,
    el("label", { class: "row", style: "gap:10px;flex-wrap:nowrap" }, splitBox, el("span", null, "Split into phases (a different lake or lure for each part)")),
    phaseWrap,
    el("div", { class: "field", id: "t-money" }, el("span", null, "Entry fee and prize"),
      el("label", { class: "row", style: "gap:10px;flex-wrap:nowrap" }, feeBox, el("span", null, "Charge an entry fee")),
      feeWrap,
      el("label", { class: "field" }, el("span", { class: "hint" }, "Prize (optional)"), prizeIn),
      el("span", { class: "hint" }, "Weigh-In never takes or sends money. You collect any fee yourself (cash, Venmo and so on), tick people off as paid on the tournament page, and give out the prize yourself. Rules for contests with fees and cash prizes are different in each place, so check yours.")),
    el("button", { class: "btn wide", type: "submit" }, priv || canPubTour() ? "Create tournament" : "Send request to the owner"));
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const name = String(fd.get("name") || "").trim();
    if (badText(name)) { toast(NO_SLURS); return; }
    const startAt = new Date(startInput.value).getTime();
    if (!name) { toast("Give the tournament a name."); return; }
    if (!startAt) { toast("Pick a start date and time."); return; }
    let endAt, phases = [];
    if (splitBox.checked) {
      phases = phaseRows.map((r, i) => ({ name: r.name.value.trim() || "Phase " + (i + 1), where: r.where.value.trim(), lure: r.lure.value.trim(), mins: parseInt(r.mins.value) || 0 }));
      if (phases.some((x) => isBad(x.name, x.where, x.lure))) { toast(NO_SLURS); return; }
      if (phases.some((x) => x.mins < 5 || x.mins > 1440)) { toast("Each phase needs 5 to 1440 minutes."); return; }
      endAt = startAt + phases.reduce((a, x) => a + x.mins, 0) * 60000;
    } else {
      endAt = new Date(f.querySelector("#t-end").value).getTime();
      if (!endAt || endAt <= startAt) { toast("The end has to be after the start."); return; }
    }
    let spNames = [];
    if (spMode.value !== "all") {
      const seen = new Set();
      for (const part of spIn.value.split(",")) { const n = part.trim().replace(/\s+/g, " "); if (n && !seen.has(sk(n))) { seen.add(sk(n)); spNames.push(n.slice(0, 40)); } }
      if (spMode.value === "one") spNames = spNames.slice(0, 1);
      spNames = spNames.slice(0, 6);
      if (!spNames.length) { toast("Type which fish count in this tournament."); return; }
      if (isBad(...spNames)) { toast(NO_SLURS); return; }
    }
    try {
      const fee = feeBox.checked ? Math.round(Number(feeIn.value) * 100) / 100 : 0, prize = prizeIn.value.trim(), payHow = payIn.value.trim();
      if (feeBox.checked && !(fee >= 1 && fee <= 500)) { toast("Entry fee has to be between $1 and $500."); return; }
      if (feeBox.checked && !payHow) { toast("Tell people how to pay you."); return; }
      if (isBad(prize, payHow)) { toast(NO_SLURS); return; }
      const data = { name, fee, prize, payHow: fee ? payHow : "", paid: [S.user.uid], scoring: fd.get("scoring"), start: localDate(new Date(startAt)), end: localDate(new Date(endAt)), startAt, endAt,
        createdBy: S.user.uid, createdByName: S.name, members: [S.user.uid], createdAt: serverTimestamp() };
      if (phases.length) data.phases = phases;
      if (spNames.length) data.species = spNames;
      if (priv) data.private = true;
      if (!canPubTour() && !priv) {   // only the owner makes public tournaments, so everyone else asks first
        const { createdBy, createdByName, members, createdAt, paid, ...spec } = data;
        await addDoc(collection(db, "tourRequests"), { uid: S.user.uid, name: S.name, tname: name, spec, status: "pending", createdAt: serverTimestamp() });
        S.creatingTour = false; toast("Request sent. The owner will take a look."); renderTab(); return;
      }
      const ref = await addDoc(collection(db, "tournaments"), data);
      S.creatingTour = false; toast(priv ? "Private tournament created. People ask to join and you say yes." : "Tournament created. You're in!"); openTour(ref.id);
    } catch (err) { toast(errText(err)); }
  });
  p.append(el("button", { class: "link", type: "button", style: "align-self:flex-start", onclick: () => { S.creatingTour = false; renderTab(); } }, "‹ Back"),
    el("h1", null, priv ? "New private tournament" : canPubTour() ? "New tournament" : "Request a tournament"),
    priv ? el("p", { class: "muted", style: "margin:0" }, "Invite only. Everyone can see it in the list, but people have to ask to join and you say yes or no. You run it.") : canPubTour() ? null : el("p", { class: "muted", style: "margin:0" }, "Public tournaments are set up by the owner. Fill this in and send it. If the owner says yes, it goes live and you run it."), f);
}
let phaseFilter = null;
function openTour(id) {
  S.openTournament = id; S.viewing = null; S.tourPosts = []; phaseFilter = null;
  tourUnsub?.();
  tourUnsub = onSnapshot(query(collection(db, "posts"), where("tournamentId", "==", id)), (s) => {
    const tt = S.tournaments.find((x) => x.id === id);
    S.tourPosts = s.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) })).filter((x) => !tt || tourSpeciesOk(tt, x.species));
    if (S.tab === "tours" && S.openTournament === id) renderTab();
  }, () => {});
  renderTab();
}
function standings(t, posts) {
  if (tourSpecies(t).length) posts = posts.filter((x) => tourSpeciesOk(t, x.species));
  const by = new Map();
  for (const p of posts) {
    if (!by.has(p.uid)) by.set(p.uid, { uid: p.uid, name: p.name, fish: [] });
    by.get(p.uid).fish.push(p);
  }
  const rows = [...by.values()].map((r) => {
    let score = 0;
    if (t.scoring === "heaviest") score = Math.max(0, ...r.fish.map((f) => f.lb || 0));
    else if (t.scoring === "longest") score = Math.max(0, ...r.fish.map((f) => f.inches || 0));
    else if (t.scoring === "bag") score = r.fish.map((f) => f.lb || 0).sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0);
    else score = r.fish.length;
    return { ...r, score: Math.round(score * 100) / 100 };
  });
  return rows.sort((a, b) => b.score - a.score || b.fish.length - a.fish.length);
}
function awardsFor(posts) {
  if (!posts.length) return null;
  const ms = (p) => p.createdAt?.toMillis?.() || 0;
  const first = [...posts].sort((a, b) => ms(a) - ms(b))[0];
  const big = [...posts].sort((a, b) => (b.lb || 0) - (a.lb || 0) || (b.inches || 0) - (a.inches || 0))[0];
  const counts = new Map();
  posts.forEach((p) => { const c = counts.get(p.uid) || { name: p.name, n: 0 }; c.n++; counts.set(p.uid, c); });
  const most = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  return { first, big, most };
}
function viewTour(p) {
  const t = S.tournaments.find((x) => x.id === S.openTournament);
  if (!t) { p.append(el("button", { class: "link", type: "button", style: "align-self:flex-start", onclick: () => { S.openTournament = null; tourUnsub?.(); tourUnsub = null; renderTab(); } }, "‹ All tourneys"), el("p", { class: "muted" }, "Loading tournament…")); return; }
  const st = tourStatus(t), joined = (t.members || []).includes(S.user.uid), sc = SCORING[t.scoring] || SCORING.heaviest;
  const phases = phaseWindows(t), timed = !!t.startAt, range = tourRange(t);
  p.append(el("button", { class: "link", type: "button", style: "align-self:flex-start", onclick: () => { S.openTournament = null; tourUnsub?.(); tourUnsub = null; renderTab(); } }, "‹ All tourneys"),
    el("div", { class: "stack", style: "gap:6px" },
      el("div", { class: "row" }, el("span", { class: "pill " + st }, { live: "Live", soon: "Upcoming", final: "Final" }[st]),
        el("span", { class: "label" }, timed ? `${fmtWhen(range.s)} to ${fmtWhen(range.e)}` : `${fmtDay(t.start)}${t.end !== t.start ? " – " + fmtDay(t.end) : ""}`)),
      el("h1", null, t.name),
      t.private ? el("span", { class: "pill soon", style: "align-self:flex-start" }, "🔒 Invite only") : null,
      speciesPill(t),
      el("p", { class: "muted", style: "margin:0" }, `${sc.desc}. Started by @${t.createdByName || "someone"}. Only catches posted to this tournament count.`)));

  if (t.private && !joined) {
    const jid = t.id + "_" + S.user.uid, jr = S.joinOut.find((x) => x.id === jid);
    const ask = async () => {
      try {
        if (jr) await deleteDoc(doc(db, "tourJoins", jid));
        await setDoc(doc(db, "tourJoins", jid), { tid: t.id, tname: t.name, uid: S.user.uid, name: S.name, org: t.createdBy, status: "pending", createdAt: serverTimestamp() });
        toast("Request sent. The organizer will take a look.");
      } catch (err) { toast(errText(err)); }
    };
    p.append(el("section", { class: "stack tour-money", id: "tour-locked" }, el("h2", null, "This one is invite only"),
      el("p", { class: "muted", style: "margin:0" }, `Ask @${t.createdByName || "the organizer"} if you can join. They'll say yes or no.`),
      !jr ? el("button", { class: "btn wide", type: "button", id: "t-ask", onclick: ask }, "Ask to join")
        : jr.status === "pending" ? el("p", { class: "pb-ok", style: "margin:0;font-weight:700" }, "⏳ Waiting for the organizer.")
        : jr.status === "declined" ? el("div", { class: "stack" }, el("p", { class: "hint", style: "margin:0" }, "They said not this time."), el("button", { class: "btn ghost small", type: "button", style: "align-self:flex-start", onclick: ask }, "Ask again"))
        : el("p", { class: "hint", style: "margin:0" }, "Approved. One moment…")));
    if (t.createdBy === S.user.uid || S.owner) { /* organizer and owner fall through */ } else return;
  }
  p.append(tourMoneyCard(t, joined));
  if (timed) {
    const lab = el("span", { class: "label" }), big = el("b", { class: "big" }), sub = el("span", { class: "hint" });
    p.append(el("div", { class: "timer", role: "timer" }, lab, big, sub));
    let lastKey = "";
    const upd = () => {
      const now = Date.now(), status = tourStatus(t), idx = phaseAt(t, now), key = status + idx;
      if (lastKey && key !== lastKey) { renderTab(); return; }
      lastKey = key;
      if (status === "soon") { lab.textContent = "Starts in"; big.textContent = fmtDur(range.s - now); sub.textContent = ""; }
      else if (status === "final") { lab.textContent = "Finished"; big.textContent = "Time's up"; sub.textContent = ""; }
      else if (idx >= 0) { lab.textContent = `Phase ${idx + 1} of ${phases.length}: ${phases[idx].ph.name}`; big.textContent = fmtDur(phases[idx].e - now) + " left"; sub.textContent = "Tournament ends in " + fmtDur(range.e - now); }
      else { lab.textContent = "Time left"; big.textContent = fmtDur(range.e - now); sub.textContent = ""; }
    };
    upd(); tick = setInterval(upd, 1000);
  }
  if (phases.length) {
    const nowIdx = phaseAt(t);
    p.append(el("section", { class: "stack" }, el("h2", null, "Phases"), el("div", { class: "list" }, phases.map((w) =>
      el("div", { class: "item", style: "cursor:default" },
        el("div", { class: "stack", style: "gap:2px;min-width:0" }, el("span", { class: "t" }, `${w.i + 1}. ${w.ph.name}`),
          el("span", { class: "s" }, [w.ph.where || null, w.ph.lure ? w.ph.lure + " only" : "Any lure", `${w.ph.mins} min`].filter(Boolean).join(" · "))),
        el("span", { class: "pill " + (w.i === nowIdx ? "live" : Date.now() > w.e ? "final" : "soon") }, w.i === nowIdx ? "Now" : Date.now() > w.e ? "Done" : "Next"))))));
  }
  if (!joined && st !== "final" && !t.private) p.append(el("button", { class: "btn wide", type: "button", id: "t-join", onclick: async () => {
    if ((+t.fee || 0) > 0 && !confirm(`This tournament has a ${fmtFee(+t.fee)} entry fee. Weigh-In doesn't take payments. You pay @${t.createdByName || "the organizer"} yourself${t.payHow ? " (" + t.payHow + ")" : ""}. Join?`)) return;
    try { await updateDoc(doc(db, "tournaments", t.id), { members: arrayUnion(S.user.uid) }); toast(`You joined ${t.name}!`); }
    catch (err) { toast(errText(err)); }
  } }, "Join this tournament"));
  else if (joined && st === "live") p.append(el("button", { class: "btn wide", type: "button", onclick: () => go("post") }, "Post a catch for this tournament"));

  const members = t.members || [];
  const counted = S.tourPosts.filter((x) => members.includes(x.uid) && catchCounts(t, x));
  const scoped = phaseFilter == null ? counted : counted.filter((x) => x.phase === phaseFilter);
  if (phases.length) p.append(el("div", { class: "chips", role: "group", "aria-label": "Show results for" },
    [["Overall", null], ...phases.map((w) => [w.ph.name, w.i])].map(([label, v]) =>
      el("button", { class: "chip", type: "button", "aria-pressed": String(phaseFilter === v), onclick: () => { phaseFilter = v; renderTab(); } }, label))));

  const aw = awardsFor(scoped);
  p.append(el("section", { class: "awards", "aria-label": "Awards" },
    el("div", null, el("span", { class: "label" }, "First fish"), el("b", null, aw ? "@" + aw.first.name : "–"), el("span", { class: "hint" }, aw ? `${aw.first.species} · ${ago(aw.first.createdAt)}` : "No fish yet")),
    el("div", null, el("span", { class: "label" }, "Biggest fish"), el("b", null, aw ? "@" + aw.big.name : "–"), el("span", { class: "hint" }, aw ? `${aw.big.species}, ${sizeText(aw.big)}` : "No fish yet")),
    el("div", null, el("span", { class: "label" }, "Most fish"), el("b", null, aw ? "@" + aw.most.name : "–"), el("span", { class: "hint" }, aw ? `${aw.most.n} fish` : "No fish yet"))));

  const rows = standings(t, scoped);
  const board = el("section", { class: "board", "aria-label": "Leaderboard" },
    el("div", { class: "board-h" }, el("h2", null, st === "final" ? "Final standings" : "Leaderboard"), el("span", { class: "label" }, sc.name + (phaseFilter != null ? " · " + phases[phaseFilter]?.ph.name : ""))));
  if (!rows.length) board.append(el("p", { class: "empty", style: "padding:14px 16px" }, members.length + " joined. No fish posted yet."));
  else board.append(el("ol", { class: "lb" }, rows.map((r, i) =>
    el("li", { class: r.uid === S.user.uid ? "me" : null, tabindex: 0, onclick: () => { S.viewing = r.uid; renderTab(); } },
      el("span", { class: "place " + (i < 3 ? "p" + (i + 1) : "") }, String(i + 1)),
      el("div", { style: "min-width:0" }, el("div", { class: "row", style: "gap:8px;flex-wrap:nowrap;font-weight:700;overflow-wrap:anywhere" }, avatar(r.uid, r.name, 24), el("span", null, "@" + r.name + (r.uid === S.user.uid ? " (you)" : ""))),
        el("div", { class: "hint" }, `${r.fish.length} fish · tap to see them`)),
      el("span", { class: "score" }, `${r.score} ${sc.unit}`)))));
  p.append(board);

  const shown = S.viewing ? S.tourPosts.filter((x) => x.uid === S.viewing) : S.tourPosts;
  const who = S.viewing ? rows.find((r) => r.uid === S.viewing)?.name || S.tourPosts.find((x) => x.uid === S.viewing)?.name : null;
  p.append(el("div", { class: "row spread" }, el("h2", null, who ? `@${who}'s catches` : "All catches"),
    who ? el("button", { class: "link", type: "button", onclick: () => { S.viewing = null; renderTab(); } }, "Show everyone") : null));
  const sorted = [...shown].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  if (!sorted.length) p.append(el("p", { class: "empty" }, "No catches yet."));
  else p.append(el("div", { class: "list" }, sorted.map((c) => el("div", { class: "item", style: "cursor:default" },
    el("div", { class: "stack", style: "gap:2px;min-width:0" }, el("span", { class: "t" }, `${c.species}, ${sizeText(c)}`),
      el("span", { class: "s" }, `@${c.name} · ${c.lure ? "on " + c.lure + " · " : ""}${phasesOf(t)[c.phase] ? phasesOf(t)[c.phase].name + " · " : ""}${ago(c.createdAt)}${members.includes(c.uid) && !catchCounts(t, c) ? " · doesn't count" : ""}`)),
    c.photo ? el("img", { src: c.photo, alt: "", style: "width:56px;height:56px;object-fit:cover;border-radius:8px;flex:none" }) : null))));
  if (t.createdBy === S.user.uid) p.append(el("button", { class: "link danger", type: "button", style: "align-self:flex-start", onclick: async () => {
    if (!confirm("Delete this tournament? Catches stay on the feed.")) return;
    try { await deleteDoc(doc(db, "tournaments", t.id)); S.openTournament = null; toast("Tournament deleted."); renderTab(); } catch (err) { toast(errText(err)); }
  } }, "Delete tournament"));
}

/* ======================= FISHING LOG (private) ======================= */
function viewLog(p) {
  const f = el("form", { novalidate: true },
    el("div", { class: "two" },
      el("label", { class: "field" }, el("span", null, "Date"), el("input", { id: "l-date", type: "date", name: "date", value: localDate(new Date()) })),
      el("label", { class: "field" }, el("span", null, "Fish caught"), el("input", { id: "l-count", type: "number", inputmode: "numeric", name: "count", min: 0, max: 999, placeholder: "0" }))),
    el("label", { class: "field" }, el("span", null, "Where"), el("input", { id: "l-place", name: "place", maxlength: 60, placeholder: "Lake Creve Coeur, north cove" })),
    el("label", { class: "field" }, el("span", null, "Weather and water"), el("input", { id: "l-weather", name: "weather", maxlength: 80, placeholder: "Sunny, 72°, light wind, clear water" })),
    el("label", { class: "field" }, el("span", null, "Notes"), el("textarea", { id: "l-notes", name: "notes", maxlength: 1000, placeholder: "What worked, what didn't, what to try next time" })),
    el("button", { class: "btn wide", type: "submit" }, "Save trip"));
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const entry = { date: String(fd.get("date") || localDate(new Date())), count: parseInt(fd.get("count")) || 0,
      place: String(fd.get("place") || "").trim(), weather: String(fd.get("weather") || "").trim(), notes: String(fd.get("notes") || "").trim(), createdAt: serverTimestamp() };
    if (!entry.place && !entry.notes) { toast("Add where you fished or some notes."); return; }
    try { await addDoc(collection(db, "users", S.user.uid, "log"), entry); toast("Trip saved."); f.reset(); f.querySelector("#l-date").value = localDate(new Date()); }
    catch (err) { toast(errText(err)); }
  });
  p.append(el("h1", null, "Fishing log"), el("p", { class: "muted", style: "margin:0" }, "Only you can see your log."), f, el("h2", null, "Past trips"));
  if (!S.log.length) { p.append(el("p", { class: "empty" }, "No trips yet. Your first one goes above.")); return; }
  p.append(el("div", { class: "list" }, S.log.map((l) => el("details", { class: "item", style: "display:block;cursor:default" },
    el("summary", { style: "cursor:pointer;list-style:none" },
      el("div", { class: "row spread" }, el("span", { class: "t" }, l.place || "Trip"), el("span", { class: "label" }, fmtDay(l.date))),
      el("div", { class: "s" }, [l.count ? `${l.count} fish` : null, l.weather || null].filter(Boolean).join(" · "))),
    l.notes ? el("p", { style: "margin:8px 0 4px;white-space:pre-wrap" }, l.notes) : null,
    el("button", { class: "link danger small", type: "button", onclick: async () => {
      if (!confirm("Delete this trip from your log?")) return;
      try { await deleteDoc(doc(db, "users", S.user.uid, "log", l.id)); } catch (err) { toast(errText(err)); }
    } }, "Delete")))));
}

/* ======================= FRIENDS + CHAT ======================= */
const pairId = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
const friendOf = (fs) => { const other = fs.members.find((m) => m !== S.user.uid); return { uid: other, name: fs.names?.[other] || "friend" }; };

async function acceptRequest(r) {
  const me = S.user.uid, them = r.from;
  const members = [me, them].sort();
  try {
    await setDoc(doc(db, "friendships", pairId(me, them)), { members, names: { [me]: S.name, [them]: r.fromName }, createdAt: serverTimestamp() });
    await deleteDoc(doc(db, "requests", r.id));
    const mine = S.reqOut.find((x) => x.to === them);
    if (mine) await deleteDoc(doc(db, "requests", mine.id));
    toast(`You and @${r.fromName} are friends!`);
  } catch (err) { toast(errText(err)); }
}
function viewFriends(p) {
  const f = el("form", { class: "row", novalidate: true, style: "flex-wrap:nowrap" },
    el("input", { id: "fr-name", name: "name", maxlength: 20, placeholder: "Friend's angler name", autocomplete: "off", style: "flex:1;min-width:0;border:2px solid var(--line);border-radius:10px;padding:12px;background:var(--surface)" }),
    el("button", { class: "btn", type: "submit" }, "Add"));
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = f.querySelector("#fr-name").value.trim();
    if (!name) return;
    if (name.toLowerCase() === S.name.toLowerCase()) { toast("That's you!"); return; }
    try {
      const u = await getDoc(doc(db, "usernames", name.toLowerCase()));
      if (!u.exists()) { toast(`No angler named "${name}". Check the spelling.`); return; }
      const { uid, name: realName } = u.data();
      if (S.friendships.some((x) => x.members.includes(uid))) { toast(`You and @${realName} are already friends.`); return; }
      const theirs = S.reqIn.find((r) => r.from === uid);
      if (theirs) { await acceptRequest(theirs); f.reset(); return; }
      await setDoc(doc(db, "requests", `${S.user.uid}_${uid}`), { from: S.user.uid, to: uid, fromName: S.name, toName: realName, createdAt: serverTimestamp() });
      f.reset(); toast(`Friend request sent to @${realName}.`);
    } catch (err) { toast(errText(err)); }
  });
  p.append(
    el("div", { class: "row spread" }, el("h1", null, "Friends"), el("span", { class: "label" }, "@" + S.name)),
    el("div", { class: "stack" }, el("h2", null, "Add a friend"), f, el("span", { class: "hint" }, "Ask your friend for their exact angler name.")));
  if (S.reqIn.length) p.append(el("div", { class: "stack" }, el("h2", null, "Friend requests"),
    el("div", { class: "list" }, S.reqIn.map((r) => el("div", { class: "item", style: "cursor:default" },
      el("span", { class: "row", style: "gap:10px;flex-wrap:nowrap" }, avatar(r.from, r.fromName, 34), el("span", { class: "t" }, "@" + r.fromName)),
      el("div", { class: "row" },
        el("button", { class: "btn small", type: "button", onclick: () => acceptRequest(r) }, "Accept"),
        el("button", { class: "link", type: "button", onclick: () => deleteDoc(doc(db, "requests", r.id)).catch((e) => toast(errText(e))) }, "Decline")))))));
  p.append(el("div", { class: "stack" }, el("h2", null, "Your friends"),
    S.friendships.length ? el("div", { class: "list" }, S.friendships.map((fs) => {
      const fr = friendOf(fs);
      return el("button", { class: "item", type: "button", onclick: () => openChat(fs) },
        el("span", { class: "row", style: "gap:10px;flex-wrap:nowrap" }, avatar(fr.uid, fr.name, 34), el("span", { class: "t" }, "@" + fr.name), S.unread.has(fs.id) ? el("span", { class: "pill live", "data-unread": "1" }, "New") : null), el("span", { class: "label" }, "Chat ›"));
    })) : el("p", { class: "empty" }, "No friends yet. Add someone above.")));
  if (S.reqOut.length) p.append(el("div", { class: "stack" }, el("h2", null, "Waiting for them to accept"),
    el("div", { class: "list" }, S.reqOut.map((r) => el("div", { class: "item", style: "cursor:default" },
      el("span", { class: "t" }, "@" + r.toName),
      el("button", { class: "link", type: "button", onclick: () => deleteDoc(doc(db, "requests", r.id)).catch((e) => toast(errText(e))) }, "Cancel"))))));
}
function linkify(text) {
  return String(text).split(/(https:\/\/[^\s]+)/g).map((part, i) => i % 2
    ? el("a", { href: part, target: "_blank", rel: "noopener noreferrer" }, part) : part);
}
function openMeetSheet(send, friendName) {
  const input = el("input", { id: "meet-link", type: "url", placeholder: "https://meet.google.com/abc-defg-hij", autocomplete: "off", "aria-label": "Google Meet link" });
  const close = () => bg.remove();
  const go = async () => {
    const link = input.value.trim();
    if (!/^https:\/\/meet\.google\.com\/[A-Za-z0-9\-_\/?=&]+$/.test(link)) { toast("That doesn't look like a Google Meet link. It starts with https://meet.google.com/"); return; }
    try { await send("📹 Google Meet: " + link); toast("Sent to " + friendName + ". Join your meeting."); close(); } catch (e) { toast(errText(e)); }
  };
  const bg = el("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg) close(); } },
    el("div", { class: "sheet", role: "dialog", "aria-label": "Google Meet call", style: "height:auto;max-height:90%" },
      el("div", { class: "sheet-h" }, el("h2", null, "Google Meet call"), el("button", { class: "link", type: "button", onclick: close }, "Close")),
      el("div", { class: "msgs about" },
        el("ol", { style: "margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px" },
          el("li", null, "Tap the button below. Google Meet opens in a new tab and starts a meeting. You may need to sign in to Google."),
          el("li", null, "Copy the meeting link it gives you."),
          el("li", null, "Come back here, paste the link, and tap Send.")),
        el("button", { class: "btn wide", type: "button", id: "meet-open", onclick: () => window.open("https://meet.google.com/new", "_blank", "noopener,noreferrer") }, "1. Open Google Meet"),
        el("label", { class: "field" }, el("span", null, "2. Paste the meeting link"), input),
        el("button", { class: "btn ghost wide", type: "button", id: "meet-send", onclick: go }, `3. Send link to ${friendName}`))));
  document.body.append(bg);
}
function openChat(fs) {
  const fr = friendOf(fs);
  const list = el("div", { class: "msgs" }, el("p", { class: "muted" }, "Loading…"));
  const input = el("input", { id: "m-text", maxlength: 500, placeholder: `Message @${fr.name}`, autocomplete: "off" });
  const form = el("form", { class: "composer" }, input, el("button", { class: "btn small", type: "submit" }, "Send"));
  const close = () => { un(); bg.remove(); S.chatOpen = null; markRead(fs.id); };
  S.chatOpen = fs.id; markRead(fs.id);
  const send = (text) => addDoc(collection(db, "friendships", fs.id, "messages"), { uid: S.user.uid, text, createdAt: serverTimestamp() });
  const callRow = el("div", { class: "callrow" },
    el("button", { class: "btn ghost small", type: "button", id: "m-call", onclick: () => openMeetSheet(send, fr.name) }, "📹 Google Meet call"),
    el("button", { class: "link small", type: "button", id: "m-jitsi", onclick: () => {
      const bytes = crypto.getRandomValues(new Uint8Array(12));
      const room = "WeighIn" + [...bytes].map((x) => x.toString(36).padStart(2, "0")).join("");
      const url = "https://meet.jit.si/" + room;
      window.open(url, "_blank", "noopener,noreferrer");
      send("📹 Video call: " + url).catch((err) => toast(errText(err)));
    } }, "No Google account? Quick link"));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim(); if (!text) return;
    if (badText(text)) { toast(NO_SLURS); return; }
    input.value = "";
    try { await addDoc(collection(db, "friendships", fs.id, "messages"), { uid: S.user.uid, text, createdAt: serverTimestamp() }); }
    catch (err) { toast(errText(err)); input.value = text; }
  });
  const bg = el("div", { class: "sheet-bg" }, el("div", { class: "sheet full", role: "dialog", "aria-label": `Chat with ${fr.name}` },
    el("div", { class: "sheet-h top" }, el("button", { class: "link", type: "button", onclick: close }, "‹ Back"), el("h2", null, "@" + fr.name), el("span")),
    list, callRow, form));
  document.body.append(bg);
  const un = onSnapshot(query(collection(db, "friendships", fs.id, "messages"), orderBy("createdAt", "desc"), limit(150)), (s) => {
    const rows = s.docs.map((d) => d.data({ serverTimestamps: "estimate" })).reverse();
    if (!rows.length) { list.replaceChildren(el("p", { class: "muted" }, `Say hi to @${fr.name}!`)); return; }
    list.replaceChildren(...rows.map((m) => el("div", { class: "msg" + (m.uid === S.user.uid ? " mine" : "") }, linkify(m.text))));
    list.scrollTop = list.scrollHeight;
  }, () => list.replaceChildren(el("p", { class: "muted" }, "Couldn't load messages.")));
}


/* ======================= MAP ======================= */
/* ======================= place search + map picker ======================= */
async function findPlaces(q, n = 6) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=us&limit=" + n + "&q=" + encodeURIComponent(q), { signal: ctl.signal, headers: { Accept: "application/json" } });
    if (!r.ok) return [];
    return (await r.json()).map((x) => ({ lat: +x.lat, lng: +x.lon, name: String(x.name || x.display_name || "").split(",")[0], full: String(x.display_name || "").split(",").slice(0, 3).join(",").trim() }))
      .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng));
  } catch { return []; } finally { clearTimeout(t); }
}
function openMapPicker(startQuery, startLoc, onDone) {
  let map = null, marker = null, pick = null, pickName = "";
  const mapBox = el("div", { class: "map", id: "pick-map", style: "min-height:240px" });
  const q = el("input", { type: "search", id: "pick-q", placeholder: "Search a lake, park, boat ramp, or town", value: startQuery || "", "aria-label": "Search for a place" });
  const results = el("div", { class: "list" });
  const status = el("p", { class: "hint", id: "pick-status" }, "Search above, or tap the map where you caught it.");
  const done = el("button", { class: "btn wide", type: "button", id: "pick-done", disabled: true, onclick: () => { if (pick) { onDone({ ...pick }, pickName); close(); } } }, "Use this spot");
  const close = () => { try { map?.remove(); } catch { /* gone */ } bg.remove(); };
  function setPick(lat, lng, name) {
    pick = { lat, lng }; if (name) pickName = name;
    const L = window.L; if (!map || !L) return;
    if (marker) marker.setLatLng([lat, lng]); else marker = L.marker([lat, lng]).addTo(map);
    done.disabled = false; status.textContent = "Pin set. Tap the map to move it, then tap Use this spot.";
  }
  async function search() {
    const text = q.value.trim(); if (text.length < 2) return;
    results.replaceChildren(el("p", { class: "muted" }, "Searching…"));
    const hits = await findPlaces(text, 6);
    if (!hits.length) { results.replaceChildren(el("p", { class: "muted" }, "Nothing found. Try a bigger town nearby, or tap the map.")); return; }
    results.replaceChildren(...hits.map((h) => el("button", { class: "item", type: "button", onclick: () => {
      results.replaceChildren(); map?.setView([h.lat, h.lng], 14); setPick(h.lat, h.lng, h.name);
    } }, el("div", { class: "stack", style: "gap:2px;min-width:0" }, el("span", { class: "t" }, h.name || h.full), el("span", { class: "s" }, h.full)))));
  }
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); search(); } });
  const bg = el("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg) close(); } },
    el("div", { class: "sheet full", role: "dialog", "aria-label": "Pick where you caught it" },
      el("div", { class: "sheet-h top" }, el("h2", null, "Where did you catch it?"), el("button", { class: "link", type: "button", onclick: close }, "Close")),
      el("div", { class: "pick-bar" }, el("div", { class: "row", style: "flex-wrap:nowrap" }, q, el("button", { class: "btn small", type: "button", id: "pick-go", onclick: search }, "Search")),
        el("button", { class: "link small", type: "button", style: "align-self:flex-start", onclick: () => {
          if (!navigator.geolocation) { toast("This phone can't share location."); return; }
          navigator.geolocation.getCurrentPosition((pos) => { map?.setView([pos.coords.latitude, pos.coords.longitude], 14); setPick(pos.coords.latitude, pos.coords.longitude, ""); },
            () => toast("Couldn't get your location."), { timeout: 10000 });
        } }, "📍 Jump to my location"), results),
      mapBox, el("div", { class: "pick-foot" }, status, done)));
  document.body.append(bg);
  loadLeaflet().then((L) => {
    let c = startLoc || (() => { try { return JSON.parse(getPref("lastloc", "null")); } catch { return null; } })();
    map = L.map(mapBox, { maxBounds: US_BOUNDS, maxBoundsViscosity: 0.9, minZoom: 3 }).setView(c ? [c.lat, c.lng] : [39.5, -98.35], c ? 13 : 4);
    L.tileLayer(MODERN_TILES, MODERN_OPTS).addTo(map);
    map.on("click", (e) => setPick(e.latlng.lat, e.latlng.lng, ""));
    if (startLoc) setPick(startLoc.lat, startLoc.lng, "");
    setTimeout(() => map?.invalidateSize(), 80);
    if (startQuery && !startLoc) search();
  }).catch(() => { status.textContent = "Couldn't load the map. Check your connection."; });
}

let leafletP, mapToken = 0;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  leafletP ||= new Promise((res, rej) => {
    document.head.append(el("link", { rel: "stylesheet", href: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", integrity: "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=", crossorigin: "" }));
    document.head.append(el("script", { src: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", integrity: "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=", crossorigin: "",
      onload: () => res(window.L), onerror: () => { leafletP = null; rej(new Error("leaflet")); } }));
  }).then((L) => new Promise((res) => {
    // Pin clustering is a nice extra. If it doesn't load, the map still works.
    if (L.markerClusterGroup) { res(L); return; }
    document.head.append(el("link", { rel: "stylesheet", href: "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css", integrity: "sha256-YU3qCpj/P06tdPBJGPax0bm6Q1wltfwjsho5TR4+TYc=", crossorigin: "" }));
    document.head.append(el("link", { rel: "stylesheet", href: "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css", integrity: "sha256-YSWCMtmNZNwqex4CEw1nQhvFub2lmU7vcCKP+XVwwXA=", crossorigin: "" }));
    document.head.append(el("script", { src: "https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js", integrity: "sha256-Hk4dIpcqOSb0hZjgyvFOP+cEmDXUKKNE/tT542ZbNQg=", crossorigin: "", onload: () => res(window.L), onerror: () => res(window.L) }));
  }));
  return leafletP;
}
function destroyMap() { mapToken++; if (S.map) { S.map.remove(); S.map = null; S.markers = null; S.me = null; } }
const lureKey = (x) => String(x.lure || "").trim().toLowerCase().replace(/\s+/g, " ");
const nameCase = (t) => t.charAt(0).toUpperCase() + t.slice(1);
function renderMap() {
  $screen.className = "screen feed-wrap";
  const f = S.mapFilter || (S.mapFilter = { species: "", lure: "", mine: false });
  const bar = el("div", { class: "map-filters" });
  const box = el("div", { class: "map", id: "map" });
  const note = el("div", { class: "map-note", id: "map-note" }, "Loading map…");
  const fab = el("button", { class: "map-fab", type: "button", id: "map-locate", "aria-label": "Show where I am", onclick: () => {
    wherePhone().then((o) => {
      const L = window.L; if (!L || !S.map) return;
      const ll = [o.lat, o.lng];
      S.map.setView(ll, 13);
      if (S.me) S.me.setLatLng(ll); else S.me = L.circleMarker(ll, { radius: 8, color: "#fff", weight: 3, fillColor: getPref("theme", "auto") === "black" ? "#4A7BE8" : "#1F5C4D", fillOpacity: 1 }).addTo(S.map);
    }).catch((e) => toast(e.message));
  } }, "📍");
  function paintBar() {
    const valid = S.spots.filter((x) => typeof x.lat === "number");
    const species = [...new Set(valid.map((x) => String(x.species).trim()))].sort();
    const lures = new Map(); valid.forEach((x) => { const k = lureKey(x); if (k) lures.set(k, nameCase(k)); });
    if (f.species && !species.includes(f.species)) f.species = "";
    if (f.lure && !lures.has(f.lure)) f.lure = "";
    const sel = (id, label, value, opts, onchange) => el("select", { id, "aria-label": label, onchange: (e) => onchange(e.target.value) },
      el("option", { value: "" }, label), opts.map(([v, t]) => el("option", { value: v, selected: v === value ? "" : null }, t)));
    bar.replaceChildren(...[
      sel("mf-species", "All fish", f.species, species.map((x) => [x, x]), (v) => { f.species = v; drawSpots(true); }),
      sel("mf-lure", "All lures", f.lure, [...lures].sort((a, b) => a[1].localeCompare(b[1])), (v) => { f.lure = v; drawSpots(true); }),
      el("button", { class: "chip", type: "button", id: "mf-mine", "aria-pressed": String(f.mine), onclick: () => { f.mine = !f.mine; paintBar(); drawSpots(true); } }, "Mine")].filter(Boolean));
  }
  S.paintMapBar = paintBar;
  paintBar();
  $screen.replaceChildren(bar, box, fab, note);
  const token = ++mapToken;
  loadLeaflet().then((L) => {
    if (S.tab !== "map" || token !== mapToken) return;
    S.map = L.map(box, { maxBounds: US_BOUNDS, maxBoundsViscosity: 0.9, minZoom: 3 }).setView([39.5, -98.35], 4);
    const streets = L.tileLayer(MODERN_TILES, MODERN_OPTS);
    const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Tiles &copy; Esri" });
    streets.addTo(S.map);
    L.control.layers({ "Map": streets, "Satellite": sat }, null, { position: "topright" }).addTo(S.map);
    S.markers = (L.markerClusterGroup ? L.markerClusterGroup({ maxClusterRadius: 40, showCoverageOnHover: false }) : L.layerGroup()).addTo(S.map);
    drawSpots(true);
    const fs = S.focusSpot; S.focusSpot = null;           // came here from "see on the map" on a post
    const target = fs && S.spots.find((x) => x.id === fs);
    if (target) { S.map.setView([target.lat, target.lng], 14); showSpotCard(target); }
    setTimeout(() => S.map?.invalidateSize(), 60);
  }).catch(() => { note.textContent = "Couldn't load the map. Check your connection and try again."; });
}
const km = (a, b) => { const r = (x) => x * Math.PI / 180, dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
function mapSummary(shown) {
  if (!S.spots.length) return "No catches with a location yet. When you post a catch, add where you caught it and it shows up here.";
  if (!shown.length) return "No catches match those filters.";
  const lures = new Map(); shown.forEach((x) => { const k = lureKey(x); if (k) lures.set(k, (lures.get(k) || 0) + 1); });
  const top = [...lures.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${nameCase(k)} (${n})`);
  const anglers = new Set(shown.map((x) => x.uid)).size;
  return `${shown.length} catch${shown.length === 1 ? "" : "es"} by ${anglers} angler${anglers === 1 ? "" : "s"}` + (top.length ? ` · Popular lures: ${top.join(", ")}` : "") + ". Tap a pin to see the catch.";
}
// Tapping a pin shows that catch in the bar at the bottom of the map.
function showSpotCard(sp) {
  const note = document.getElementById("map-note"); if (!note) return;
  S.map?.panTo?.([sp.lat, sp.lng]);
  const post = S.posts.find((x) => x.id === sp.id);
  const near = S.spots.filter((x) => typeof x.lat === "number" && typeof x.lng === "number" && km(sp, x) <= 2);
  const anglers = new Map(); near.forEach((x) => anglers.set(x.uid, x.name));
  const lures = new Map();
  near.forEach((x) => { const k = lureKey(x); if (!k) return; const g = lures.get(k) || { name: nameCase(k), n: 0 }; g.n++; lures.set(k, g); });
  const top = [...lures.values()].sort((a, b) => b.n - a.n).slice(0, 4);
  const likeN = S.likes.get(sp.id)?.size || 0;
  const photo = post?.photo || sp.thumb;
  note.className = "map-note open";
  const fab = document.getElementById("map-locate"); if (fab) fab.hidden = true;
  note.replaceChildren(...[
    el("button", { class: "map-card-x", type: "button", "aria-label": "Close", onclick: () => drawSpots(false) }, "✕"),
    el("div", { class: "map-card" },
      photo ? el("img", { src: photo, alt: `${sp.species} caught by ${sp.name}` }) : null,
      el("div", { class: "stack", style: "gap:2px;min-width:0" },
        el("b", { class: "map-card-t" }, sp.species), el("span", null, sizeText(sp)),
        el("button", { class: "link small", type: "button", style: "align-self:flex-start", onclick: () => openAngler(sp.uid, sp.name) }, "@" + sp.name),
        el("span", { class: "hint" }, sp.catchDate ? "Caught " + fmtDayY(sp.catchDate) : ago(sp.createdAt)),
        [sp.spot, placeLabel(sp)].filter(Boolean).length ? el("span", { class: "hint" }, "📍 " + [sp.spot, placeLabel(sp)].filter(Boolean).join(", ")) : null,
        sp.lure ? el("span", { class: "hint" }, "On " + sp.lure) : null,
        el("span", { class: "hint" }, `♥ ${likeN}${sp.precise ? "" : " · approximate area"}`),
        post ? el("button", { class: "link small", type: "button", style: "align-self:flex-start", onclick: () => openComments(post) }, "Comments") : null)),
    el("div", { class: "pop-near" },
      el("b", null, "Around here"),
      el("span", null, `${near.length} catch${near.length === 1 ? "" : "es"} by ${anglers.size} angler${anglers.size === 1 ? "" : "s"} within about 1 mile`),
      el("div", { class: "pop-people" }, [...anglers].slice(0, 6).map(([uid, name]) => el("button", { class: "link small", type: "button", onclick: () => openAngler(uid, name) }, "@" + name))),
      top.length ? el("span", null, "Popular lures: " + top.map((g) => `${g.name} (${g.n})`).join(", ")) : null)].filter(Boolean));
}
function drawSpots(fit) {
  const L = window.L, note = document.getElementById("map-note"), f = S.mapFilter || {};
  if (!L || !S.map || !S.markers) return;
  S.markers.clearLayers();
  const shown = S.spots.filter((x) => typeof x.lat === "number" && typeof x.lng === "number"
    && (!f.species || String(x.species).trim() === f.species) && (!f.lure || lureKey(x) === f.lure) && (!f.mine || x.uid === S.user.uid));
  const pts = [];
  for (const sp of shown) {
    pts.push([sp.lat, sp.lng]);
    L.marker([sp.lat, sp.lng], { title: `${sp.species} by @${sp.name}`, icon: L.divIcon({ className: "bob-pin", html: "<span></span>", iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -12] }) })
      .on("click", () => showSpotCard(sp)).addTo(S.markers);
  }
  if (note) { note.className = "map-note"; note.textContent = mapSummary(shown); }
  const fab = document.getElementById("map-locate"); if (fab) fab.hidden = false;
  if (fit && pts.length) S.map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 12 });
}

const sfMinutes = (km_) => { const road = km_ * 1.3, speed = road < 8 ? 35 : road < 40 ? 55 : 80; return Math.round(road / speed * 60 + 2); };   // rough drive time
/* Gets the phone's location. Tries a fast guess first, then GPS, and says clearly what went wrong. */
function wherePhone() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("This phone can't share location. Type a town instead.")); return; }
    const fail = (e) => reject(new Error(e && e.code === 1
      ? "Location is turned off for Weigh-In. On iPhone: Settings, Privacy, Location Services, Safari Websites, While Using. Or just type a town."
      : "Couldn't find you. Move near a window or outside and try again, or type a town."));
    const ok = (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    navigator.geolocation.getCurrentPosition(ok, (e) => {
      if (e && e.code === 1) return fail(e);
      navigator.geolocation.getCurrentPosition(ok, fail, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });   // second try with GPS
    }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
  });
}
/* ======================= GATE KEEP FINDER (public map data only) =======================
   Looks up real places from OpenStreetMap (rocky banks, piers, boat ramps, dams, lakes...) near you, inside
   the drive time you choose. Each clue you pick must be true for a place, so every extra clue narrows the list. */
// Each clue: q builds the map-server query (results saved into set s), is() tells if a map item counts as that clue.
const WF_KINDS = {
  rocky: { q: (a, s) => `(nwr["natural"~"^(bare_rock|cliff|scree|shingle)$"]${a};nwr["man_made"~"^(riprap|breakwater|groyne)$"]${a};)->.rk;node(w.rk)->.rkn;(way["natural"="water"](around.rkn:150);rel["natural"="water"](around.rkn:150);way["waterway"~"^(river|stream|canal|riverbank)$"](around.rkn:150);)->.rw;(way.rw;way(r.rw);)->.rww;node(w.rww)->.rwn;node.rkn(around.rwn:150)->.cn;way.rk(bn.cn)->${s};`,
    is: (t) => /^(bare_rock|cliff|scree|shingle)$/.test(t.natural || "") || /^(riprap|breakwater|groyne)$/.test(t.man_made || "") },
  pier: { q: (a, s) => `nwr["man_made"="pier"]${a}->${s};`, is: (t) => t.man_made === "pier" },
  ramp: { q: (a, s) => `nwr["leisure"="slipway"]${a}->${s};`, is: (t) => t.leisure === "slipway" },
  dam: { q: (a, s) => `(nwr["waterway"~"^(dam|weir)$"]${a};nwr["man_made"="dam"]${a};)->${s};`, is: (t) => /^(dam|weir)$/.test(t.waterway || "") || t.man_made === "dam" },
  marked: { q: (a, s) => `nwr["leisure"="fishing"]${a}->${s};`, is: (t) => t.leisure === "fishing" },
  lake: { q: (a, s) => `nwr["natural"="water"]["water"~"^(lake|pond|reservoir)$"]["name"]${a}->${s};`, is: (t) => t.natural === "water" && /^(lake|pond|reservoir)$/.test(t.water || "") },
  bridge: { q: (a, s) => `way["bridge"]["bridge"!="no"]${a}->.br;node(w.br)->.brn;way["waterway"~"^(river|stream|canal)$"](around.brn:15)->.ww;node(w.ww)->.wwn;node.brn(around.wwn:15)->.bcn;way.br(bn.bcn)->${s};`, is: (t) => !!t.bridge && t.bridge !== "no" },
  beach: { q: (a, s) => `nwr["natural"="beach"]${a}->${s};`, is: (t) => t.natural === "beach" },
  weeds: { q: (a, s) => `nwr["natural"="wetland"]${a}->${s};`, is: (t) => t.natural === "wetland" },
  river: { q: (a, s) => `way["waterway"~"^(river|stream)$"]["name"]${a}->${s};`, is: (t) => /^(river|stream)$/.test(t.waterway || "") },
};
const wfKinds = { rocky: "Rocky bank", pier: "Pier or dock", ramp: "Boat ramp", dam: "Dam", marked: "Marked fishing spot", lake: "Lake or pond", river: "River or creek", bridge: "Bridge", beach: "Sandy beach", weeds: "Weeds or marsh" };
const wfCache = new Map();
function wfRadiusKm(mins) { let k = 0.5; while (k < 40 && sfMinutes(k) <= mins) k += 0.5; return Math.max(0.5, k - 0.5); }
let st_backup = false;   // true when the last search used the simpler backup map source
let wfWhy = "";          // what went wrong last time, shown so it can be fixed
// The free map servers are slow (often 20-40 seconds) and block you if you ask too many things at once,
// so this sends ONE combined question at a time and waits up to a minute.
const WF_HOSTS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const wfSleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function wfWaitSecs() {      // the main server says how long until it will take another question
  try { const t = await (await fetch("https://overpass-api.de/api/status", { cache: "no-store" })).text(); const m = /in (\d+) seconds/.exec(t); return m ? +m[1] : (/slots available now/.test(t) ? 0 : 10); } catch { return 10; }
}
async function wfAsk(ql, onStep) {
  const body = "data=" + encodeURIComponent(`[out:json][timeout:90];${ql}`);
  for (const host of WF_HOSTS) {
    const name = new URL(host).hostname, main = host === WF_HOSTS[0];
    for (let tryN = 0; tryN < (main ? 3 : 1); tryN++) {
      if (!main) onStep && onStep("Trying another map server…");
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), main ? 100000 : 45000);
      try {
        const r = await fetch(host, { method: "POST", body, signal: ctl.signal, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
        if (r.status === 429 || r.status === 502 || r.status === 503 || r.status === 504) {
          wfWhy = `${name} said ${r.status} (busy)`;
          if (!main) break;
          const w = Math.min(45, Math.max(5, (await wfWaitSecs()) + 2) * (tryN + 1));
          for (let k = w; k > 0; k--) { onStep && onStep(`The map server is busy. Trying again in ${k}s…`); await wfSleep(1000); }
          onStep && onStep("Asking again…");
          continue;
        }
        if (!r.ok) { wfWhy = `${name} said ${r.status}`; break; }
        const j = await r.json();
        if (j.remark && /runtime error|timed out|out of memory/i.test(j.remark) && !(j.elements || []).length) { wfWhy = `${name}: ${String(j.remark).slice(0, 70)}`; break; }
        return (j.elements || []).map((e) => ({ lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon, name: e.tags?.name || "", id: e.type + "/" + e.id, tags: e.tags || {} }))
          .filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lng));
      } catch (e) { wfWhy = `${name}: ${e?.name === "AbortError" ? "took too long" : "blocked or offline"}`; break; } finally { clearTimeout(t); }
    }
  }
  return null;
}
const WF_NOM = { rocky: "rocky shore", pier: "pier", ramp: "boat ramp", dam: "dam", marked: "fishing", lake: "lake", river: "creek", bridge: "bridge", beach: "beach", weeds: "marsh" };
async function wfNominatim(kind, origin, rKm) {   // backup when the main map server is down: less detail, but it works
  const dLat = rKm / 111, dLng = rKm / (111 * Math.max(0.2, Math.cos(origin.lat * Math.PI / 180)));
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=40&bounded=1&extratags=1&viewbox=${origin.lng - dLng},${origin.lat + dLat},${origin.lng + dLng},${origin.lat - dLat}&q=${encodeURIComponent(WF_NOM[kind])}`, { signal: ctl.signal, headers: { Accept: "application/json" } });
    if (!r.ok) { wfWhy += ` · backup said ${r.status}`; return null; }
    return (await r.json()).map((x) => ({ lat: +x.lat, lng: +x.lon, name: x.name || "", id: x.osm_type + "/" + x.osm_id, kindHint: kind, tags: { ...(x.extratags || {}), [x.category]: x.type } })).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng));
  } catch { wfWhy += " · backup also failed"; return null; } finally { clearTimeout(t); }
}
const WF_WORDS = { bare_rock: "bare rock", cliff: "cliff", scree: "loose rock", shingle: "pebbles", riprap: "riprap (stacked rocks)", breakwater: "breakwater", groyne: "rock wall into the water", pier: "pier", slipway: "boat ramp", marina: "marina", fishing: "marked for fishing",
  dam: "dam", weir: "weir", lake: "lake", pond: "pond", reservoir: "reservoir", river: "river", stream: "creek", canal: "canal", beach: "sandy beach", wetland: "marsh or wetland", water: "water" };
function wfDetails(r) {      // plain-words facts from the map tags, so you can tell the spots apart
  const t = r.tags || {}, out = [];
  const what = [...new Set([t.natural, t.man_made, t.leisure, t.waterway, t.water].map((v) => WF_WORDS[v]).filter(Boolean))];
  if (what.length) out.push("Looks like: " + what.join(", "));
  if (t.access === "private" || t.access === "no") out.push("⚠ Marked private. Don't fish here");
  else if (t.access === "permissive" || t.access === "yes" || t.access === "public") out.push("Open to the public");
  else if (t.access === "customers" || t.access === "permit") out.push("May need a permit or to be a customer");
  if (t.fee === "yes") out.push("Costs money to use"); else if (t.fee === "no") out.push("Free");
  if (t.fishing === "yes") out.push("Fishing is allowed"); else if (t.fishing === "no") out.push("⚠ Fishing is marked as not allowed");
  if (t.boat === "yes" || t.motorboat === "yes") out.push("Boats allowed");
  if (t.operator) out.push("Run by " + t.operator);
  if (t.surface) out.push("Ground: " + String(t.surface).replace(/_/g, " "));
  if (t.wheelchair === "yes") out.push("Wheelchair friendly");
  if (t.opening_hours) out.push("Hours: " + String(t.opening_hours).slice(0, 40));
  if (t.description) out.push(String(t.description).slice(0, 90));
  return out;
}
async function wfSearch(st, onStep) {
  st_backup = false; wfWhy = "";
  const rKm = wfRadiusKm(st.mins), kinds = [...st.kinds].sort();
  const where = `${st.origin.lat.toFixed(3)}|${st.origin.lng.toFixed(3)}|${rKm}`;
  const need = kinds.filter((k) => !wfCache.has(k + "|" + where));
  if (need.length) {    // one question for all the new clues; clues you already searched come from memory
    const a = `(around:${Math.round(rKm * 1000)},${st.origin.lat},${st.origin.lng})`;
    const ql = need.map((k, i) => WF_KINDS[k].q(a, ".s" + i)).join("") + need.map((k, i) => `.s${i} out center tags 400;`).join("");
    const items = await wfAsk(ql, onStep);
    if (items) need.forEach((k) => wfCache.set(k + "|" + where, items.filter((x) => WF_KINDS[k].is(x.tags))));
    else {      // every map server failed: use the simpler backup, one clue at a time
      onStep && onStep("Using the backup map…");
      for (const k of need) { const r = await wfNominatim(k, st.origin, rKm); if (!r) return null; wfCache.set(k + "|" + where + "|backup", r); await wfSleep(1100); }
      st_backup = true;
    }
  }
  const lists = kinds.map((k) => wfCache.get(k + "|" + where) || wfCache.get(k + "|" + where + "|backup") || []);
  let base = lists[0].map((x) => ({ ...x, kinds: [kinds[0]] }));
  for (let i = 1; i < kinds.length; i++) {         // every extra clue must be true within about 400 m
    base = base.map((b) => ({ ...b, kinds: [...b.kinds, kinds[i]], near: lists[i].find((o) => km(b, o) <= 0.4) })).filter((b) => b.near);
    base.forEach((b) => { if (!b.name && b.near.name) b.name = b.near.name; });
  }
  const seen = [], out = [];
  for (const b of base.sort((a, c) => km(st.origin, a) - km(st.origin, c))) {   // drop duplicates closer than 300 m
    if (seen.some((s) => km(s, b) < 0.3)) continue; seen.push(b);
    const mins = sfMinutes(km(st.origin, b)); if (mins > st.mins) continue;
    if (st.text && !b.name.toLowerCase().includes(st.text.toLowerCase())) continue;
    out.push({ ...b, mins });
  }
  return out;
}
async function viewWater(p) {
  const saved = (() => { try { return JSON.parse(getPref("wx", "null")); } catch { return null; } })();
  const st = S.wf || (S.wf = (() => {   // remembers what you were doing, even after you close the app
    const base = { origin: saved && Number.isFinite(saved.lat) ? { lat: saved.lat, lng: saved.lng } : null, label: saved?.name || "", mins: 10, kinds: new Set(), text: "", person: null, q: "", nameDraft: "", ruled: {} };
    try { const m = JSON.parse(getPref("gk-state", "null")); if (m) return { ...base, ...m, kinds: new Set(m.kinds || []) }; } catch { /* start fresh */ }
    return base;
  })());
  const keep = () => setPref("gk-state", JSON.stringify({ origin: st.origin, label: st.label, mins: st.mins, kinds: [...st.kinds], text: st.text, person: st.person, q: st.q, nameDraft: st.nameDraft, ruled: st.ruled }));
  const out = el("div", { class: "stack", id: "wf-out" }), hits = el("div", { class: "list", id: "wf-hits" }), loc = el("p", { class: "hint", id: "wf-loc" });
  let token = 0;
  function run() {   // a clue changed: save it and wait for the Search button
    keep();
    loc.textContent = st.origin ? `Starting from ${st.label || "your spot"}.` : "Pick where you are starting from, or use your location.";
    out.replaceChildren(!st.origin ? el("p", { class: "muted" }, "Pick where you are starting from first.") : !st.kinds.size ? el("p", { class: "muted", id: "wf-pick" }, "Tap what you want, like Rocky bank. Add more to narrow it down, then tap Search.") : el("p", { class: "muted", id: "wf-ready" }, "Ready. Tap Search at the bottom."));
  }
  async function doSearch() {
    keep();
    loc.textContent = st.origin ? `Starting from ${st.label || "your spot"}.` : "Pick where you are starting from, or use your location.";
    if (!st.origin) { toast("Pick where you are starting from first."); return; }
    if (!st.kinds.size) { toast("Tap at least one clue first, like Rocky bank."); return; }
    const my = ++token, t0 = Date.now();
    const msg = el("b", null, "Searching the map…"), sub = el("span", { class: "hint", id: "wf-wait" }, "The free map server can take up to a minute. Keep the app open."), step = el("span", { class: "hint" });
    out.replaceChildren(el("div", { class: "sf-left", id: "wf-busy" }, msg, sub, step));
    const tick = setInterval(() => { if (my !== token) return clearInterval(tick); msg.textContent = `Searching the map… ${Math.round((Date.now() - t0) / 1000)}s`; }, 1000);
    const btn = document.getElementById("wf-search"); if (btn) { btn.disabled = true; btn.textContent = "Searching…"; }
    let rows;
    try { rows = await wfSearch(st, (t) => { step.textContent = t; }); } finally { clearInterval(tick); if (btn) { btn.disabled = false; btn.textContent = "🔍 Search"; } }
    if (my !== token) return;
    if (!rows) { out.replaceChildren(el("p", { class: "empty", id: "wf-err" }, "Couldn't reach the map data. Check your connection and try again."), wfWhy ? el("p", { class: "hint" }, "Problem: " + wfWhy) : null, el("button", { class: "btn small", type: "button", onclick: doSearch }, "Try again")); return; }
    last = rows; paintResults();
  }
  let last = [];
  const WHY = ["Private land", "Too crowded", "No parking", "Not rocky enough", "Too far", "Already checked", "Unsafe", "Other"];
  function paintResults() {
    const ruled = st.ruled || (st.ruled = {});
    const rows = last.filter((r) => !ruled[r.id]), gone = last.filter((r) => ruled[r.id]);
    const shown = rows.slice(0, 15);
    const card = (r) => {
      const actions = el("div", { class: "row", style: "gap:8px" },
        el("a", { class: "btn small ghost", href: `https://www.google.com/maps/search/?api=1&query=${r.lat.toFixed(5)},${r.lng.toFixed(5)}`, target: "_blank", rel: "noopener" }, "Directions"),
        el("a", { class: "btn small ghost", href: `https://www.openstreetmap.org/${r.id}`, target: "_blank", rel: "noopener" }, "Details"),
        el("button", { class: "btn small ghost", type: "button", "data-x": r.id, onclick: () => {
          actions.replaceChildren(el("span", { class: "hint", style: "width:100%" }, "Why rule it out?"), ...WHY.map((w) => el("button", { class: "chip", type: "button", "data-why": w, onclick: () => { ruled[r.id] = { why: w, name: r.name || r.kinds.map((k) => wfKinds[k]).join(" + ") }; keep(); paintResults(); } }, w)),
            el("button", { class: "link small", type: "button", onclick: paintResults }, "Cancel"));
          actions.style.flexWrap = "wrap";
        } }, "✕ Rule out"));
      const facts = wfDetails(r);
      return el("div", { class: "sf-card", "data-wf": r.id },
        el("b", { style: "overflow-wrap:anywhere" }, r.name || r.kinds.map((k) => wfKinds[k]).join(" + ")),
        el("div", { class: "chips" }, el("span", { class: "pill" }, `~${r.mins} min drive`), r.kinds.map((k) => el("span", { class: "pill live" }, wfKinds[k]))),
        facts.length ? el("ul", { class: "sf-facts" }, facts.map((f) => el("li", null, f))) : el("span", { class: "hint" }, "No more details on the map for this one."),
        actions);
    };
    out.replaceChildren(el("div", { class: "sf-left", id: "wf-left" }, el("b", null, rows.length === 1 ? "1 spot left" : `${rows.length} spots left`),
        el("span", { class: "hint" }, rows.length > 1 ? "Add more clues or rule spots out to narrow it down." : rows.length === 1 ? "That's the one." : "Nothing matches. Take off a clue or add more minutes."),
        st_backup ? el("span", { class: "hint", id: "wf-backup" }, "The main map server is busy, so these have fewer details.") : null,
        el("button", { class: "link small", type: "button", id: "wf-reset", style: "align-self:flex-start", onclick: () => { Object.assign(st, { mins: 10, kinds: new Set(), text: "", ruled: {} }); renderTab(); } }, "Clear clues")),
      ...shown.map(card),
      rows.length > shown.length ? el("p", { class: "hint" }, `Showing the closest ${shown.length}. Add a clue to see the rest.`) : null,
      gone.length ? el("div", { class: "stack", id: "wf-ruled", style: "gap:6px" }, el("b", null, `Ruled out (${gone.length})`),
        gone.map((r) => el("div", { class: "row spread", style: "gap:8px" }, el("span", { class: "hint", style: "min-width:0;overflow-wrap:anywhere" }, `${ruled[r.id].name} · ${ruled[r.id].why}`),
          el("button", { class: "link small", type: "button", "data-back": r.id, onclick: () => { delete ruled[r.id]; keep(); paintResults(); } }, "Put back")))) : null,
      el("p", { class: "hint" }, "From OpenStreetMap, so some places may be missing or be private land. Check the rules and where you're allowed to fish."));
  }
  async function search() {
    const text = q.value.trim(); if (text.length < 2) return;
    hits.replaceChildren(el("p", { class: "muted" }, "Searching…"));
    const found = await findPlaces(text, 4);
    if (!found.length) { hits.replaceChildren(el("p", { class: "muted" }, "Nothing found. Try a bigger town nearby.")); return; }
    hits.replaceChildren(...found.map((h) => el("button", { class: "item", type: "button", onclick: () => { st.origin = { lat: h.lat, lng: h.lng }; st.label = h.full || h.name; hits.replaceChildren(); run(); } },
      el("div", { class: "stack", style: "gap:2px;min-width:0" }, el("span", { class: "t" }, h.name || h.full), el("span", { class: "s" }, h.full)))));
  }
  const q = el("input", { type: "search", id: "wf-q", placeholder: "Search a town, like Crestwood", "aria-label": "Where are you starting from", value: st.q, oninput: () => { st.q = q.value; keep(); } });
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); search(); } });
  const gps = () => {
    toast("Finding you…");
    wherePhone().then((o) => { st.origin = o; st.label = "your location"; run(); }).catch((e) => toast(e.message));
  };
  const chips = el("div", { class: "chips", id: "wf-kinds" });
  const paint = () => chips.replaceChildren(...Object.entries(wfKinds).map(([k, v]) => el("button", { class: "chip", type: "button", "data-kind": k, "aria-pressed": String(st.kinds.has(k)),
    onclick: () => { st.kinds.has(k) ? st.kinds.delete(k) : st.kinds.add(k); paint(); run(); } }, v)));
  paint();
  const mins = el("select", { id: "wf-mins", "aria-label": "How far will you drive", onchange: () => { st.mins = +mins.value; run(); } },
    [5, 10, 15, 20, 30, 45].map((m) => el("option", { value: m, selected: m === st.mins ? "" : null }, `Within ${m} min`)));
  const name = el("input", { type: "search", id: "wf-text", placeholder: "Name has… (optional)", "aria-label": "Name contains", value: st.text, oninput: () => { st.text = name.value.trim(); keep(); clearTimeout(name._t); name._t = setTimeout(run, 400); } });
  // Whose spot is it? Only a label to keep your notes together. Nothing about that person comes from the app.
  const who = el("div", { class: "stack", id: "gk-who", style: "gap:8px" });
  const paintWho = () => {
    if (st.person) {
      const key = "gk-" + st.person.uid, notes = el("textarea", { id: "gk-notes", rows: 3, maxlength: 600, placeholder: "What do you know about the spot? Write clues here.",
        oninput: () => setPref(key, notes.value) }); notes.value = getPref(key, "");
      who.replaceChildren(el("div", { class: "row spread" }, el("b", null, `Looking for @${st.person.name}'s spot`),
        el("button", { class: "link small", type: "button", id: "gk-clear", onclick: () => { st.person = null; keep(); paintWho(); } }, "Change")), notes,
        el("span", { class: "hint" }, "Your notes stay on this phone. Weigh-In doesn't use anyone's catches or pins here. It only narrows real lakes and places from your clues."));
      return;
    }
    const nm = el("input", { type: "search", id: "gk-name", maxlength: 20, autocomplete: "off", placeholder: "Whose spot? Type their angler name", "aria-label": "Angler name", value: st.nameDraft });
    const menu = el("div", { class: "list sf-menu", id: "gk-menu", hidden: true });
    let tm = 0, seq = 0;
    const suggest = () => {
      st.nameDraft = nm.value; keep(); clearTimeout(tm);
      const pre = nm.value.trim().toLowerCase();
      if (!pre) { menu.hidden = true; return; }
      tm = setTimeout(async () => {
        const my = ++seq;
        try {
          const r = await getDocs(query(collection(db, "usernames"), where(documentId(), ">=", pre), where(documentId(), "<", pre + "\uf8ff"), limit(8)));
          if (my !== seq) return;
          const rows = r.docs.map((d) => d.data()).filter((d) => d.uid !== OWNER_UID && d.uid !== S.user.uid);   // the owner never shows up
          menu.hidden = !rows.length;
          menu.replaceChildren(...rows.map((d) => el("button", { class: "item", type: "button", "data-pick": d.name, onclick: () => { nm.value = d.name; menu.hidden = true; set(); } }, el("span", { class: "t" }, "@" + d.name))));
        } catch { menu.hidden = true; }
      }, 200);
    };
    nm.addEventListener("input", suggest);
    const set = async () => {
      const name = nm.value.trim(); if (!name) return;
      try {
        const u = await getDoc(doc(db, "usernames", name.toLowerCase()));
        const d = u.exists() ? u.data() : null;
        if (!d || d.uid === OWNER_UID || d.uid === S.user.uid) { toast(`No angler named "${name}". Check the spelling.`); return; }   // the owner looks the same as someone who doesn't exist
        st.person = { uid: d.uid, name: d.name || name }; st.nameDraft = ""; keep(); paintWho();
      } catch (e) { toast(errText(e)); }
    };
    nm.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); set(); } });
    who.replaceChildren(el("div", { class: "row", style: "gap:8px;flex-wrap:nowrap" }, nm, el("button", { class: "btn small", type: "button", id: "gk-set", onclick: set }, "Start")), menu);
    if (st.nameDraft) suggest();
  };
  paintWho();
  p.append(el("h1", null, "Gate keep finder"),
    el("p", { class: "muted" }, "Type who you're looking for, say what you know, and narrow down the lakes and spots around an area. Pick how far you will drive, then tap clues. Every clue narrows the list."),
    who,
    el("section", { class: "stack" },
      el("div", { class: "row", style: "gap:8px;flex-wrap:nowrap" }, q, el("button", { class: "btn small", type: "button", id: "wf-go", onclick: search }, "Search")),
      el("button", { class: "btn ghost small", type: "button", id: "wf-gps", style: "align-self:flex-start", onclick: gps }, "📍 Use my location"), loc, hits,
      mins, chips, name),
    out,
    el("button", { class: "btn wide", type: "button", id: "wf-search", onclick: doSearch }, "🔍 Search"));
  run();
}

/* ======================= FISHING SCHOOL: lessons, quizzes, ranks =======================
   Lessons are general, beginner-level fishing knowledge. Fishing laws differ by state and country, so the rules lesson
   teaches how to find and follow YOUR local rules. It is not legal advice. */
const Q = (q, right, wrong, why) => ({ q, right, wrong, why });
const SCH_LESSONS = {
  gear: { n: "Your gear", icon: "🎣", sum: "Rod, reel, line, hooks and the small stuff.", cards: [
    ["The basic setup", "You need a rod, a reel, line, a hook, and something on the hook (bait or a lure). That's it. Start simple. A spinning rod and reel about 6 to 7 feet long with medium power catches almost anything in a pond or lake."],
    ["Spinning or baitcasting?", "A spinning reel hangs under the rod. It's the easiest to learn and the best place to start. A baitcasting reel sits on top and is great later, but beginners get tangles called backlash. Start with spinning."],
    ["Fishing line", "Monofilament is cheap, stretchy and forgiving. Good first line. Braid is thin and very strong with no stretch. Fluorocarbon is hard for fish to see. The number on the spool, like 8 lb test, is about how many pounds of pull the line can take before it breaks. 6 to 10 lb is a good start."],
    ["Hooks", "Hook sizes can be confusing. With plain numbers, a bigger number means a smaller hook: #12 is tiny and #1 is bigger. After that comes 1/0, 2/0 and so on, and there a bigger number means a bigger hook. Small hooks (#6 to #10) for panfish, bigger ones for bass and catfish. Pinching the barb flat makes a hook easier to remove."],
    ["Small stuff that helps", "Bring pliers, line clippers, a measuring tape, a small net, a few bobbers and weights, and a bag for trash. Polarized sunglasses cut the glare so you can see into the water, and they protect your eyes. Also bring water, sunscreen and a hat."]],
    q: [Q("Which reel is the easiest for a beginner?", "A spinning reel", ["A baitcasting reel", "A fly reel", "A trolling reel"], "Spinning reels hang under the rod and rarely tangle, so they're the best place to start."),
      Q("What does \"10 lb test\" mean on fishing line?", "The line can take about 10 pounds of pull before it breaks", ["The line is 10 pounds heavy", "The line is 10 feet long", "It only catches fish up to 10 inches"], "Test is the strength of the line."),
      Q("Which line is cheap, a little stretchy and forgiving?", "Monofilament", ["Braid", "Steel wire", "Fluorocarbon only"], "Mono is the classic beginner line."),
      Q("Which hook is bigger?", "A #1 hook", ["A #12 hook", "They are the same size", "It depends on the color"], "With plain numbers, a smaller number is a bigger hook."),
      Q("Polarized sunglasses help because they...", "Cut glare so you can see into the water and protect your eyes", ["Make fish bite more", "Make the line stronger", "Keep bugs away"], "They also protect your eyes from hooks.")] },
  knots: { n: "Knots and rigs", icon: "🪢", sum: "Tie your line on so it doesn't break, and set up simple rigs.", cards: [
    ["Why knots matter", "Your knot is the weakest point of your line. A bad knot loses fish. Always wet the knot with water before you tighten it. Dry line gets hot from friction and weakens. Pull it tight slowly, then trim the tail."],
    ["Improved clinch knot", "A classic for hooks and lures. Thread the line through the eye, wrap the tail around the line 5 to 7 times, pass the tail through the small loop next to the eye, then back through the big loop. Wet it, pull tight, trim."],
    ["Palomar knot", "Strong and easy. Double about 6 inches of line into a loop. Pass the loop through the eye, tie a loose overhand knot, then slip the hook or lure through the loop. Wet it and pull tight. It works on mono, braid and fluorocarbon."],
    ["Three easy rigs", "Bobber rig: a bobber on the line above the hook holds the bait at the depth you want and shows you bites. Split shot rig: tiny weights pinched on the line above a hook for bait. Texas rig: a bullet weight on the line, then a hook buried in a plastic worm so the point doesn't snag weeds."],
    ["Check your line", "After a snag or a big fish, run your fingers down the last few feet of line. If it feels rough or nicked, cut it off and tie on again. Twisted line? Add a small swivel or let the lure drift behind a boat to untwist it."]],
    q: [Q("What should you do before tightening a knot?", "Wet it with water", ["Heat it with a lighter", "Pull it as hard as you can fast", "Add glue"], "Wetting stops friction heat from weakening the line."),
      Q("Which is a strong, easy knot beginners learn?", "The Palomar knot", ["A square knot", "A shoelace bow", "A granny knot"], "The Palomar is simple and very strong."),
      Q("Where does the bobber go on a bobber rig?", "On the line above the hook", ["On the hook", "At the end of the rod", "Under the weight"], "It holds the bait at a depth and shows the bite."),
      Q("Why is a Texas rig good around weeds and wood?", "The hook point hides in the plastic, so it snags less", ["It floats on the surface", "It makes a loud splash", "It uses no hook"], "That is called weedless."),
      Q("The last few feet of your line feel rough. You should...", "Cut it off and tie on again", ["Keep fishing", "Add more weight", "Dry it in the sun"], "Nicked line breaks on the next fish.")] },
  where: { n: "Where the fish are", icon: "📍", sum: "Find food, cover and comfortable water.", cards: [
    ["Food, cover, comfort", "Fish need three things: food to eat, cover to hide in, and comfortable water (the right temperature and enough oxygen). Find those and you find fish. Open featureless water is usually empty."],
    ["Structure and edges", "Fish hang around things: docks, fallen trees, weed lines, rocks, drop-offs and points. Even better are edges, where two things meet, like weeds next to open water or shallow water next to deep water."],
    ["Fishing from shore", "You don't need a boat. Try points that stick out, creek mouths where water flows in, dams, bridges, fishing piers, and the bank around docks. Walk and cast a lot. Move on if nothing bites in 20 minutes."],
    ["Rivers and creeks", "Fish face upstream and wait for food to drift to them. They rest in slow water next to fast water. Look for eddies behind rocks, deep holes, bends and the end of a pool. Cast upstream and let the bait drift down naturally."],
    ["Read the water", "Rings or splashes on top mean fish are feeding. Birds diving mean fish are pushing baitfish up. Tiny fish jumping or flicking mean something is chasing them. Muddy water makes fish stay close to cover. Clear water makes them spooky."]],
    q: [Q("Fish need food, cover and what else?", "Comfortable water (temperature and oxygen)", ["Loud noise", "Sunburn", "Cold concrete"], "If the water isn't comfortable they leave."),
      Q("Which is a good place to try first from shore?", "Where a creek flows into the lake", ["The middle of a bare sandy flat", "A parking lot", "Far from any cover"], "Moving water brings food and fish."),
      Q("In a river, which way do fish usually face?", "Upstream", ["Downstream", "At the bank", "Straight up"], "They wait for food to drift to them."),
      Q("Birds diving at the water usually mean...", "Fish are pushing baitfish to the top", ["The water is too cold", "There are no fish", "It will rain"], "Follow the birds."),
      Q("What is an \"edge\"?", "Where two types of areas meet, like weeds and open water", ["The end of your line", "The side of a boat", "A kind of hook"], "Fish like to hunt along edges.")] },
  weather: { n: "Weather, seasons and timing", icon: "🌤️", sum: "When fish bite, and when to stay home.", cards: [
    ["Water temperature runs everything", "Fish are cold-blooded, so water temperature sets how active they are. Most freshwater fish feed best in water that is not too cold and not too hot. In cold water they slow down. In very hot water they get lazy and go deep or into shade."],
    ["Time of day", "Dawn and dusk are low light, so fish feel safe and feed in the shallows. Midday sun pushes fish into shade or deeper water. Cloudy days can make the bite last all day."],
    ["Wind", "A light breeze ruffles the surface, so fish are less spooked, and wind pushes food against the bank where fish wait. Strong wind makes casting and boating hard and dangerous."],
    ["Fronts and pressure", "When a storm is coming and the pressure falls slowly, fish often feed hard. After a sudden cold front the bite often slows. Then use smaller baits and fish slowly."],
    ["Seasons", "Spring: fish move shallow to spawn. Be gentle and release them. Summer: fish early and late, then deeper and shaded. Fall: fish feed heavily before winter, so moving baits work. Winter: fish are slow and deep, so use small baits and fish slowly."],
    ["Storm safety", "If you hear thunder, leave the water and the shore. Don't stand under a tree. Wait 30 minutes after the last thunder before you go back. A fishing rod is a lightning rod."]],
    q: [Q("Why are dawn and dusk often the best times?", "Low light makes fish feel safe to feed", ["The water is warmest then", "Fish are asleep", "There are no boats"], "Low light means safe hunting."),
      Q("After a sudden cold front, fish often...", "Slow down, so use small baits fished slowly", ["Bite faster than ever", "Leave the lake", "Only eat at midday"], "Slow down to match them."),
      Q("You hear thunder. What should you do?", "Leave the water and shore and wait 30 minutes after the last thunder", ["Keep fishing but stay low", "Stand under a tree", "Use a shorter rod"], "Lightning can strike from miles away."),
      Q("Why does water temperature matter so much?", "Fish are cold-blooded, so it sets how active they are", ["It changes the color of the fish", "It makes line stretch", "It changes the moon"], "Temperature controls their metabolism."),
      Q("In fall, fish usually...", "Feed heavily to get ready for winter", ["Stop eating", "Only eat plants", "Hide in mud"], "Moving baits work well.")] },
  lures: { n: "Lures and bait", icon: "🪱", sum: "What to put on the hook and how to work it.", cards: [
    ["Live and natural bait", "Worms, minnows, crickets and corn are simple and work for many fish, especially panfish, trout and catfish. A worm under a bobber is a classic first setup. Check the rules: some waters ban certain live bait, like live fish."],
    ["Lures", "Hard baits: crankbaits dive and wobble, topwater lures splash on the surface, jerkbaits look like a hurt minnow. Soft plastics: worms, creature baits and swimbaits. Metal: spoons, spinners and jigs. You don't need them all. Pick a few and learn them."],
    ["Colors", "In dirty water use bright or loud lures so fish can find them. In clear water use natural colors like green, brown and silver, that match the baitfish. Don't overthink color. Where you put the lure matters more."],
    ["How you move it", "Try a steady retrieve, then stop-and-go, then twitches. Fish tell you what they want by biting. Go slower in cold water and faster in warm water. If nothing bites in 20 minutes, change something: the lure, the depth or the spot."],
    ["Feel the bite", "When you feel a tap or see the line jump, reel down and sweep the rod up firmly to set the hook. With circle hooks don't jerk. Just reel steadily and let the fish hook itself. Keep the line tight and the rod tip up while you fight the fish."]],
    q: [Q("Where does a topwater lure work?", "On the surface", ["On the bottom", "Only under ice", "Only in rivers"], "It splashes and fish hit it from below."),
      Q("In muddy water you should usually try...", "Bright or noisy lures", ["Clear lures only", "No lure at all", "Very small, dull lures"], "Fish find them by sight and sound."),
      Q("You are using a circle hook. How do you set it?", "Reel steadily without a big jerk", ["Swing the rod over your head", "Let the fish run for a minute", "Loosen the drag"], "Circle hooks set themselves."),
      Q("In cold water, how should you move your bait?", "Slowly", ["As fast as you can", "Not at all, ever", "Only with big splashes"], "Cold fish are slow."),
      Q("You feel a bite. What do you do first?", "Keep the line tight and set the hook with a firm sweep", ["Drop the rod", "Let the line go slack", "Pull the line by hand"], "A tight line keeps the hook in.")] },
  rules: { n: "Licenses, permits and rules", icon: "📋", sum: "What you need to fish legally, and where to check.", cards: [
    ["Fishing license", "In most places, adults need a fishing license to fish public waters. The age is different in each state and country. Kids are often free. Some places have free fishing days. You can buy a license from your state wildlife agency, online, or at licensed shops. Carry it, or a digital copy, when you fish."],
    ["Extra permits and stamps", "Some waters and fish need more than the basic license. Examples are a trout stamp, a salmon or steelhead card, a saltwater registry, a park or reservoir day pass, or a special lake permit. Always read the rules for the water you're going to."],
    ["Size and bag limits", "A size limit is the shortest (or sometimes longest) fish you may keep. A slot limit means fish in a certain size range must go back. A bag or creel limit is the most fish you can keep in a day. A possession limit is how many you can have at once. Seasons say when you may fish for a species. Measure on a ruler with the fish flat, mouth closed, and tail pinched. Your state may use a different method, so check."],
    ["Bait and gear rules", "Some waters ban live fish as bait, limit you to a number of rods or hooks, require barbless hooks, or ban lead. Never dump your bait bucket into the water and never move fish, plants or water from one lake to another. That spreads invasive species. Clean, drain and dry your boat and gear."],
    ["Where you can fish", "Public land and water are open, but private land needs the owner's permission. Obey posted signs and closed areas. Some shorelines, refuges and dams have special rules or hours."],
    ["Where to check the rules", "Your state wildlife agency (often called Fish and Game, Wildlife, or the DNR) posts the current rules in a booklet and on a website or app. Rules change every year. If you're not sure, ask a game warden or conservation officer. This app teaches the basics. It is not legal advice, so always check your own local rules."]],
    q: [Q("Where do you find the official, current rules for your lake?", "Your state wildlife agency's website, app or rule booklet", ["A random video online", "Your friend's memory", "The lure package"], "Rules change every year and differ by place."),
      Q("What is a bag (creel) limit?", "The most fish you can keep in a day", ["The size of your net", "The weight of your tackle box", "The number of rods you own"], "It protects fish populations."),
      Q("A fish is under the minimum size limit. What do you do?", "Release it gently right away", ["Keep it and hide it", "Keep it if it's dead already", "Trade it"], "Under-size fish must be released."),
      Q("Is a basic fishing license always enough?", "No. Some waters and fish need extra permits or stamps", ["Yes, always", "Only for saltwater", "Only for kids"], "Check the rules for the exact water."),
      Q("What should you do with leftover live bait?", "Throw it in the trash", ["Dump it in the lake", "Release it in the creek", "Take it to a different lake"], "Dumped bait can spread invasive species."),
      Q("\"Clean, Drain, Dry\" is about...", "Stopping the spread of invasive species", ["Washing your hands", "Drying your clothes", "Cleaning fish"], "Plants and animals hitch rides on boats and gear."),
      Q("To fish on private land you need...", "The owner's permission", ["Nothing, if there's water", "A bigger hook", "A tournament entry"], "Always ask first."),
      Q("What is a slot limit?", "Fish in a certain size range must be released", ["You can only fish in the slot between two docks", "A limit on how many rods you use", "The time you may fish"], "For example, fish from 14 to 18 inches go back."),
      Q("Which is true about license age?", "It is different in each state or country, so check yours", ["It is the same everywhere", "Nobody ever needs one", "Only people over 60 need one"], "Always check locally.")] },
  care: { n: "Safety, ethics and fish care", icon: "🦺", sum: "Stay safe, treat fish well, leave it clean.", cards: [
    ["Water safety", "Wear a life jacket in a boat. Many places require it for kids. Tell someone where you're going and when you'll be back. Watch the weather. Wet rocks and mud are slippery, so wear shoes with grip. Don't wade in fast or deep water alone."],
    ["Hook safety", "Look behind you before you cast. Wear a hat and sunglasses. Bring pliers and clippers. If a hook is stuck in a person past the barb, don't yank it. Cut the line and get medical help."],
    ["Handle fish gently", "Wet your hands before you touch a fish, so you don't remove its protective slime. Support it with two hands and keep it low over the water. Keep fingers out of the gills and eyes. Take the photo fast. If a hook is deep, cut the line near the hook and let the fish go. Don't rip it out."],
    ["Release or keep", "Only keep fish you'll eat, within the limits. To release a tired fish, hold it upright in the water facing the current and move it gently forward until it swims off on its own. Fish that are bleeding or can't swim may do better if you keep them, if the rules allow."],
    ["Take care of the water", "Pick up your trash and any old fishing line. Line can trap birds and turtles. Use a line recycling bin if there is one. Don't leave hooks or bait containers. Share the bank and keep noise down. Leave the place cleaner than you found it."]],
    q: [Q("Why wet your hands before touching a fish?", "To avoid wiping off its protective slime", ["To make it slippery so it escapes", "So you can see it better", "To warm the fish"], "Dry hands damage the slime coat."),
      Q("A fish swallowed the hook deep. What should you do?", "Cut the line close to the hook and release it", ["Pull the hook out hard", "Keep pulling until it comes out", "Throw the fish back with the line attached"], "Ripping out a deep hook usually kills the fish."),
      Q("What should you wear in a small boat?", "A life jacket", ["Heavy boots", "A raincoat only", "Nothing special"], "Life jackets save lives."),
      Q("What should you do with old fishing line?", "Put it in the trash or a line recycling bin", ["Leave it on the bank", "Throw it in the water", "Hang it in a tree"], "Loose line traps birds and turtles."),
      Q("How do you revive a tired fish?", "Hold it upright in the water facing the current and move it gently forward", ["Shake it", "Squeeze its belly", "Lay it on dry grass"], "It needs water flowing over its gills.")] },
  knots2: { n: "More knots", icon: "🧵", sum: "Three more knots that solve real problems.", cards: [
    ["Palomar knot", "Very strong and easy. Double the line, pass the loop through the hook eye, tie a loose overhand knot, pass the loop over the whole hook, then wet and pull tight. Great for braid."],
    ["Uni knot", "A flexible knot that works for hooks, lures and joining line to line. Wrap the tail around the line 4 to 6 times through a loop, wet it and slide it snug."],
    ["Loop knot for lures", "A loop knot lets a lure wiggle freely, so it looks more alive in the water. Use it for crankbaits and jigs."],
    ["Check your knot", "After a snag or a big fish, check the last foot of line. If it feels rough or curly, cut it off and retie. Retie often. A fresh knot is cheap and a lost fish isn't."]],
    q: [Q("Which knot is very strong and works well with braid?", "Palomar knot", ["Shoelace knot", "Granny knot", "Square knot"], "The Palomar is simple and strong, and braid holds it well."),
      Q("Why use a loop knot on a lure?", "It lets the lure move freely and look alive", ["It makes the line thicker", "It stops fish from biting", "It makes the line float"], "A tight knot stiffens the lure's action."),
      Q("What should you do if the end of your line feels rough?", "Cut it off and retie", ["Keep fishing", "Add more weight", "Tie a second knot on top"], "Damaged line breaks at the worst time."),
      Q("The uni knot can be used for...", "Hooks, lures and joining two lines", ["Only hooks", "Only bobbers", "Nothing but braid"], "It is a very flexible knot."),
      Q("Before tightening a knot you should...", "Wet it", ["Dry it in the sun", "Pull as hard as you can", "Leave a long tail"], "Wet line stays cool and keeps its strength.")] },
  water: { n: "Reading the water", icon: "🌊", sum: "Find where the fish are hiding.", cards: [
    ["Fish like cover", "Fish hide near things: logs, rocks, docks, weeds and fallen trees. Cover gives them shade and a place to ambush food. Cast near it, not on the open middle."],
    ["Edges and drop-offs", "Where shallow water drops to deep water, fish move up and down. Weed lines, rocky points and creek channels are all edges. Fish often line up along them."],
    ["Current and seams", "In a river, fish rest where the current is slow and wait for food to float by. Look behind rocks, along banks and where fast water meets slow water. That line is called a seam."],
    ["Water color and clarity", "Clear water means fish see well, so use natural colors and light line. Muddy water means bright or noisy lures and slow retrieves. After heavy rain, fish near calm edges."]],
    q: [Q("Where do fish often hide?", "Near logs, rocks, docks and weeds", ["In the middle of open water only", "On the dry bank", "Only in the shade of clouds"], "Cover gives shade and a place to ambush food."),
      Q("What is a seam in a river?", "The line where fast and slow water meet", ["A type of knot", "A kind of lure", "A fish disease"], "Fish rest on the slow side and watch the fast side for food."),
      Q("In muddy water, what lure works best?", "Bright or noisy lures", ["Clear see-through lures", "No lure at all", "The smallest one you have"], "Fish find lures by feel and sound when they can't see."),
      Q("Which spot is an edge?", "Where shallow water drops to deep water", ["The middle of a flat shallow area", "The parking lot", "The center of a deep hole"], "Fish use edges to move between depths."),
      Q("In clear water you should use...", "Natural colors and light line", ["Thick bright line", "Very loud lures only", "Big heavy weights"], "Fish can see a lot in clear water.")] },
  signs: { n: "Signs on the surface", icon: "💦", sum: "What jumping, swirls and birds are telling you.", cards: [
    ["Fish jumping", "Fish that jump or splash on the surface are often feeding on bugs or small fish. Look at the size of the splash. Small rings usually mean small fish. Big swirls mean bigger fish."],
    ["Birds", "Diving birds like gulls, terns and herons often point to schools of baitfish. If birds are working one spot, fish are probably under them."],
    ["Bugs and baitfish", "A cloud of bugs over the water or tiny fish skipping on the surface means food is there. Match what you see. If fish are eating small minnows, use a small lure that looks the same."],
    ["Slicks and bubbles", "A smooth patch on rough water, called a slick, can show where fish are feeding. Lines of foam or bubbles also gather food. Cast along them."]],
    q: [Q("Fish splashing on the surface are often...", "Feeding on bugs or small fish", ["Sleeping", "Leaving the lake", "Sick"], "Surface action means food is up there."),
      Q("What do diving birds often show you?", "A school of baitfish", ["The deepest spot", "A hidden log", "That fish aren't there"], "Birds follow baitfish, and bigger fish follow them too."),
      Q("If fish eat tiny minnows, you should use...", "A small lure that looks like a minnow", ["A giant lure", "A bright red bobber", "No bait"], "Match what the fish are eating."),
      Q("A smooth slick on rough water can show...", "Where fish are feeding", ["A rock to avoid", "That it's about to rain", "A hidden boat ramp"], "Oils and food make the surface smooth."),
      Q("Big swirls on the surface usually mean...", "A bigger fish", ["A tiny fish", "A frog", "A leaf"], "Size of the splash hints at size of the fish.")] },
  sky: { n: "Sky, wind and moon", icon: "🌙", sum: "What the outside world says about the bite.", cards: [
    ["Wind", "A little wind helps. It pushes food toward the bank and hides you from the fish. Fish the windy side of a lake. Too much wind makes casting hard and can be unsafe in a boat."],
    ["Clouds and sun", "Bright sun pushes fish to shade and deeper water. Cloudy days keep them active and shallow. The best times are usually early morning and evening."],
    ["Air pressure", "Fish often feed best when pressure is steady or slowly falling before a storm. Right after a cold front, fishing can slow down. Go slow and use small baits."],
    ["Moon", "Some anglers say fish feed best around the new and full moon. It's not guaranteed, but many use it as one more clue. Night fishing is great in summer heat."]],
    q: [Q("Why fish the windy side of a lake?", "Wind pushes food toward that bank", ["Fish hate the calm side", "It keeps fish from seeing you at all", "It makes fish bigger"], "Wind moves bugs and baitfish."),
      Q("On a bright sunny day, fish often...", "Hide in shade or go deeper", ["Swim in the open on top", "Stop breathing", "All go to shore"], "Bright light makes fish cautious."),
      Q("After a cold front, fishing often...", "Slows down", ["Gets perfect", "Stops forever", "Turns on right away"], "Use small baits and fish slow."),
      Q("When are the best times to fish for many species?", "Early morning and evening", ["Noon", "Midnight only", "Never at sunrise"], "Low light is when many fish feed."),
      Q("Is the moon a sure thing for bites?", "No, it's just one clue", ["Yes, always", "Yes, only on Fridays", "It has no effect on anything at all, ever"], "Use it with weather and water clues.")] },
  bait: { n: "Bait details", icon: "🪝", sum: "Small bait tricks that make a big difference.", cards: [
    ["Worms", "Hook a worm once through the middle, or thread it on the hook so it wiggles. Fresh, lively worms catch the most fish. Keep them cool and in damp dirt."],
    ["Minnows", "Hook a live minnow lightly under the dorsal fin or through the lips so it stays alive. Check local rules on moving live bait from one lake to another. Never dump leftover bait in the water."],
    ["Dough, corn and cut bait", "Dough bait and corn work for carp and panfish. Cut bait, small chunks of fresh fish, is great for catfish. Smelly baits attract fish from far away."],
    ["Match the size", "Use bait that fits the mouth of the fish you want. Small bait for small fish. Big bait for big fish. If you only get nibbles, go smaller."]],
    q: [Q("How do you keep worms fresh?", "Cool, in damp dirt", ["In a hot car", "In direct sun", "In dry paper"], "Heat kills worms."),
      Q("Why hook a minnow lightly?", "So it stays alive and swims", ["So it falls off", "So it floats", "So it hides"], "A lively minnow attracts fish."),
      Q("You have live bait left at the end of the day. What now?", "Throw it in the trash, never in the water", ["Dump it in the lake", "Give it to a fish", "Bury it in the bank"], "Dumped bait can spread invasive species."),
      Q("Which bait is good for catfish?", "Cut bait", ["Dry bread only", "Plastic spoons", "Tiny flies"], "Smelly fresh chunks attract catfish."),
      Q("If you only get nibbles, you should...", "Try a smaller bait or hook", ["Use a bigger hook", "Go home", "Throw harder"], "Small mouths need small bait.")] },
  species: { n: "Fish facts", icon: "🐟", sum: "What common fish eat and where they live.", cards: [
    ["Bluegill and sunfish", "Small, round and very common. They love worms, bugs and tiny jigs near docks and weeds. Great first fish for kids."],
    ["Largemouth bass", "A top predator that hides in weeds, wood and docks. Eats minnows, frogs and worms. Fishes best at dawn and dusk with plastic worms, spinnerbaits and topwater lures."],
    ["Trout", "Prefer cold, clear water. In streams they face the current and eat bugs and small fish. Use small spinners, flies or worms. Handle gently."],
    ["Catfish", "Feed mostly at night and by smell. Use cut bait, chicken liver or worms on the bottom. They have sharp spines on their fins, so hold them carefully."]],
    q: [Q("What do bluegill love to eat?", "Worms and small bugs", ["Large frogs", "Golf balls", "Leaves"], "They are small and eat small food."),
      Q("Where does a largemouth bass like to hide?", "In weeds, wood and docks", ["In the open sand middle", "On the bank", "On top of a rock in the sun"], "Cover helps it ambush food."),
      Q("What water do trout prefer?", "Cold and clear", ["Warm and muddy", "Stagnant swamp", "Hot spring"], "Trout need cool, oxygen-rich water."),
      Q("When do catfish feed the most?", "At night, by smell", ["Only at noon", "Only in winter", "Never"], "Smelly bait works best."),
      Q("What should you watch out for on a catfish?", "Sharp spines on the fins", ["Wings", "Teeth like a shark", "Electric shock"], "Hold them behind the head carefully.")] }
};
/* ---- harder questions, plus four more lessons. Every quiz draws a fresh mix and avoids questions you just saw. ---- */
const H = (q, right, wrong, why) => ({ q, right, wrong, why, hard: true });
const SCH_HARD = {
  gear: [
    H("Your line keeps snapping on big fish even though your knots are good. What is the most likely cause?", "The drag is set too tight", ["The bobber is too small", "The hook is too sharp", "The reel is too clean"], "The drag should slip before the line reaches its breaking strength."),
    H("A line marked 6 lb test is rated to break at about...", "6 pounds of pull", ["60 pounds of pull", "6 ounces of pull", "Twice the weight of the fish"], "Test strength is the pull it can take before it breaks. Knots and wear lower it."),
    H("Which outfit is the best all-round choice for bluegill, small bass and trout?", "A 6 to 7 foot light spinning rod with 6 to 8 lb line", ["A 9 foot heavy surf rod with 50 lb line", "A 3 foot ice rod with 2 lb line", "A heavy rod with 30 lb braid"], "Light gear feels the bites and casts small baits."),
    H("What does a swivel do?", "Stops line twist from spinning lures", ["Makes the hook sharper", "Makes the line float", "Adds scent to the bait"], "Spinners and some lures twist line. A swivel lets them turn freely.")
  ],
  knots: [
    H("Why does a knot make your line weaker?", "The line is bent and pinched, so it breaks at the knot first", ["Knots add weight to the line", "Knots dry out the line forever", "Only braided line is weakened"], "A good knot keeps most of the line's strength. A bad one loses a lot."),
    H("Your knot slides apart when you pull. What is the most likely mistake?", "It was not wetted or had too few wraps", ["The line was brand new", "The hook was too sharp", "The bobber was too big"], "Dry line gets hot from friction and weakens. Too few wraps slip."),
    H("Which is the right order for the improved clinch knot?", "Thread the eye, wrap 5 to 7 times, small loop, big loop, wet and tighten", ["Wrap, thread the eye, big loop, tighten dry", "Big loop, wrap, small loop, trim", "Tighten dry, wrap, thread the eye, wet"], "The order matters. Wetting comes before the final tightening."),
    H("You lose lures to a snag. What is a smart habit?", "Retie after snags, because the knot may be damaged", ["Keep fishing since the knot looks fine", "Add a second hook", "Use a heavier bobber"], "Snags weaken the last foot of line. A fresh knot is cheap.")
  ],
  where: [
    H("A windy point of land has a drop-off next to it. Why can it be a great spot?", "Wind pushes food there and fish ambush from the deeper edge", ["Fish dislike wind so they hide there", "The point is always warm", "It is the quietest part of the lake"], "Food, cover and depth change in one place."),
    H("A shallow clear pond at noon in summer. Where should you cast?", "Near shade, docks or weed edges", ["Into the sunny open middle", "Onto the bank", "Straight down at your feet in the sun"], "Fish avoid bright, open shallow water."),
    H("What is the best sign that a pond holds fish?", "Fish jumping, birds working and other people catching", ["Trash on the shore", "Very still hot water", "A closed gate"], "Real activity beats guessing."),
    H("Why is it smart to ask local anglers or the bait shop?", "They know what is biting, where, and the local rules", ["They will hand you free fish", "They know the lake bottom is flat", "They can legally fish for you"], "Local knowledge saves hours.")
  ],
  weather: [
    H("A cold front just passed with bright sky. What is the best plan?", "Fish slow with small baits near cover or deeper water", ["Fish fast with big lures in open sun", "Give up, fish never bite", "Use your heaviest line"], "Fish are cautious after a front."),
    H("Why are dawn and dusk good in summer?", "Cooler water and low light make fish feel safe to hunt shallow", ["Fish are asleep so they bite easy", "The water is clearer", "Wind is always stronger"], "Low light is when many predators feed."),
    H("The river is high and muddy after heavy rain. What is the smartest choice?", "Fish calm edges out of the current with bright or smelly bait, and stay off flooded banks", ["Wade into the middle with light line", "Cast into the fastest water", "Use clear tiny lures"], "Fish rest out of the fast flow. Flood banks are dangerous."),
    H("You hear thunder. What should you do?", "Leave the water and go to a car or building", ["Keep fishing but hold the rod low", "Stand under a tall tree", "Get in the water to stay low"], "Lightning is deadly. Rods and water make it worse.")
  ],
  lures: [
    H("Which lure flashes and spins to look like small baitfish?", "An inline spinner", ["A plastic worm on a bottom rig", "A bobber", "A jig with no hook"], "The blade throws flash and vibration."),
    H("Fish follow your lure but won't bite. What should you try?", "Change the speed, color or size", ["Reel faster and louder every time", "Use heavier line", "Cast the same spot 50 times"], "Small changes often turn followers into bites."),
    H("When does a topwater lure shine?", "When fish feed on the surface in low light", ["When the water is freezing", "When fish are 30 feet deep", "In a storm"], "Topwater is for surface action, often at dawn and dusk."),
    H("Why use a jig head with a soft plastic?", "It sinks, bounces along the bottom and looks like food", ["It floats on top", "It makes noise like a boat", "It cannot snag"], "The weight and the soft tail make it versatile.")
  ],
  rules: [
    H("You catch a fish one inch under the minimum size. What do you do?", "Release it right away, carefully", ["Keep it, it is close enough", "Keep it and say nothing", "Ask a friend to hold it"], "The rule is the rule, and it protects young fish."),
    H("You have your daily limit and then catch a legal fish. What now?", "Release it", ["Keep it and hide it", "Keep it if it is bigger", "Give it to a friend as yours"], "Over the limit is against the rules."),
    H("A sign says private property, no fishing. What do you do?", "Stay out and ask the owner for permission first", ["Fish quietly anyway", "Climb the fence if nobody is looking", "Fish from the edge for a minute"], "Respect private land."),
    H("Why do some waters need extra stamps or permits?", "The fees help pay for stocking and protecting fish", ["To make fishing harder", "To limit the number of rods", "Only for tourists"], "License money funds conservation.")
  ],
  care: [
    H("A legal fish is bleeding a lot from the gills. If the rules allow, what is the better choice?", "Keep it if you plan to eat it", ["Release it right away", "Put it on dry grass", "Wrap it in a dry towel for 10 minutes"], "Badly hurt fish rarely survive."),
    H("Why is a rubber net kinder to fish than a knotted one?", "It protects the slime and scales", ["It holds more fish", "It floats", "It never gets wet"], "Knotted nets scrape slime off."),
    H("Summer water is very warm. How do you release a fish?", "Keep it in the water as much as you can and let it go fast", ["Take a long photo first", "Lay it in the sun to dry", "Hold it by the gills"], "Warm water holds less oxygen, so fish tire more."),
    H("You find old fishing line on the bank. What should you do?", "Pick it up and throw it away or recycle it", ["Leave it, it will rot", "Tie it to a tree", "Throw it into the water"], "Line traps birds and turtles for years.")
  ],
  knots2: [
    H("Why do some knots need extra wraps with braid?", "Braid is slick and slips", ["Braid is too thick", "Braid is too sticky", "Braid melts"], "Slick line needs more grip."),
    H("Which knot lets a jerkbait swing freely?", "A loop knot", ["A tight clinch knot", "Two overhand knots", "A square knot"], "A loop keeps the action alive."),
    H("Your Palomar fails. What is a common mistake?", "The loop did not fully pass over the hook, or it was dry", ["The line was too clean", "The hook was too small", "The bobber was red"], "Both steps matter."),
    H("Joining thin braid to a mono leader, which is a good choice?", "A uni knot, tied as a double uni", ["A single overhand knot", "A granny knot", "A bowline"], "The double uni is strong and common.")
  ],
  water: [
    H("A creek bends and a fallen tree lies on the deep outside of the bend. Where are fish?", "Near the tree on the deep side", ["On the shallow inside of the bend", "In the fastest middle", "On the dry bank"], "Deep water plus cover is a fish home."),
    H("It is midday in summer. Which spot is most likely to hold bass?", "Shaded weed edges next to deeper water", ["A bare sunny shallow flat", "The middle of the parking lot", "The top of a sand bar in full sun"], "Shade and depth keep them comfortable."),
    H("Which way do river fish usually face?", "Upstream, into the current", ["Downstream", "Toward the bank", "Straight down"], "They wait for food to float to them."),
    H("Why cast past a log and bring the lure by it?", "The lure goes through the hiding spot without landing on the fish", ["Logs eat lures", "It makes the lure float", "It scares fish toward you"], "A splash on top can spook them.")
  ],
  signs: [
    H("Many tiny fish skip across the surface with swirls below. What is happening?", "Bigger fish are chasing baitfish up", ["It is raining", "The fish are sleeping", "A boat is passing"], "Predators push bait to the top."),
    H("Birds are diving over open water. What is the best approach?", "Cast a lure that matches the baitfish, just beside the action", ["Drive the boat through the middle", "Wait until the birds leave", "Use the heaviest weight"], "Match the food and stay out of the school."),
    H("Why not cast right into the middle of a feeding school?", "It can spook them, so cast past and bring it through", ["Fish dislike lures", "The school disappears at once", "It tangles the line"], "Land on the edge, then retrieve through."),
    H("A bug hatch is on and fish are rising. What works best?", "A small fly or lure that looks like the bug", ["A huge crankbait", "A bare hook", "A heavy sinker on the bottom"], "Match the hatch.")
  ],
  sky: [
    H("The barometer is slowly falling before a storm. What do fish often do?", "Feed more actively", ["Stop eating for a week", "Leave the lake", "Always sleep"], "Many anglers see good bites before weather."),
    H("It is midday with a clear sky. What is a good plan?", "Fish deeper or in shade, and slow down", ["Fish fast in the open sun", "Use the brightest line", "Cast far into the open middle"], "Bright light pushes fish down."),
    H("Strong gusty wind is blowing and a small boat is on the lake. What is the right choice?", "Stay off the water until it calms", ["Go farther out where it is calmer", "Stand up to keep balance", "Take off the life jacket"], "Wind makes small boats unsafe."),
    H("Water temperature drops fast in autumn. How do fish react?", "They slow down and feed less, so use smaller baits slowly", ["They feed all day without stopping", "They move to the bank", "They no longer sleep"], "Cold slows their metabolism.")
  ],
  bait: [
    H("Live minnows keep dying on your hook. What should you change?", "Hook them lightly and keep the bucket cool", ["Hook them deeper", "Keep them in the sun", "Add salt to the bucket"], "A healthy minnow is the best bait."),
    H("Why is it risky to move live bait from one lake to another?", "It can spread invasive species and disease", ["Bait is expensive", "It can attract birds", "It melts in new water"], "Never dump bait."),
    H("A fish keeps stealing your bait without being hooked. What is a good fix?", "Use a smaller hook or bait and set the hook sooner", ["Use a bigger bait", "Wait longer", "Cast farther away"], "Small mouths nibble big baits."),
    H("Why keep dough bait balls small?", "Fish with small mouths can take them easily", ["They float better", "They look nicer", "They smell less"], "Match the mouth.")
  ],
  species: [
    H("Which fish has whiskers and feeds mostly by smell near the bottom at night?", "Catfish", ["Trout", "Bluegill", "Pike"], "Whiskers are taste organs."),
    H("How do you fish a trout stream?", "Cast upstream so the bait drifts down naturally", ["Cast downstream and reel fast", "Cast onto the bank", "Stand in the middle and splash"], "Trout face upstream and wait."),
    H("Why are bluegill a good first fish?", "They bite often on small baits near cover", ["They are very rare", "They need no bait", "They only bite at night"], "Easy fish build confidence."),
    H("Bass guard nests in spring. What is a good habit?", "Handle and release them gently, and do not keep spawning fish", ["Grab the biggest one", "Net the whole nest", "Keep every fish"], "Protecting spawning fish protects the lake.")
  ]
};
Object.entries(SCH_HARD).forEach(([id, qs]) => { SCH_LESSONS[id].q.push(...qs); });

Object.assign(SCH_LESSONS, {
  rigs: { n: "Rigs and setups", icon: "🧰", sum: "How to rig the line so the bait looks natural.", cards: [
    ["Slip bobber rig", "A slip bobber lets you fish deep water. A small bead and a stopper knot on the line set the depth. The bobber slides up the line when you cast and stops at the knot when the bait sinks. Use it for crappie, walleye and bluegill over drop-offs."],
    ["Texas rig", "A bullet weight slides on the line, then a worm hook is buried in a soft plastic so it doesn't snag. It crawls through weeds and wood. Great for bass in cover. Set the hook hard because the plastic is soft."],
    ["Drop shot rig", "The weight is at the bottom of the line and the hook is tied above it on a short tag. The bait hangs just off the bottom, right in a fish's face. It works when fish are picky or the water is clear and cold."],
    ["Carolina rig", "A sliding weight, a bead, a swivel and a leader of 2 to 3 feet. The weight drags on the bottom while the bait floats up behind. It covers lots of water. Use it on flats and points."]],
    q: [Q("What does a slip bobber help you do?", "Fish at a set depth in deep water", ["Cast farther with no weight", "Fish on top only", "Avoid using hooks"], "The stopper knot sets the depth."),
      Q("Why bury the hook in a Texas rig?", "So it doesn't snag in weeds and wood", ["To make it heavier", "To hide it from you", "To make the worm float"], "The point rests inside the plastic."),
      Q("Where is the weight on a drop shot rig?", "At the bottom, below the hook", ["Above the bobber", "At the rod tip", "Nowhere"], "The bait hangs above the weight."),
      Q("What is a Carolina rig good for?", "Covering lots of bottom on flats and points", ["Fishing straight up and down", "Surface fishing", "Night fishing only"], "It drags along the bottom."),
      Q("Why use a swivel on a Carolina rig?", "To keep the weight separate from the leader and reduce twist", ["To add color", "To make it float", "To sharpen the hook"], "The swivel stops the weight from sliding onto the leader.")],
    hq: [H("You fish a slip bobber but the bait is always off the bottom. What do you change?", "Move the stopper knot farther up the line", ["Use a smaller bobber", "Add a second hook", "Shorten the leader"], "A deeper setting needs more line between bobber and hook."),
      H("Clear, cold water and picky fish. Which rig is a good first try?", "Drop shot rig", ["Heavy Carolina rig", "Large topwater", "Bare treble hook"], "It keeps the bait steady at eye level."),
      H("Your Texas rig keeps snagging. What is a common cause?", "The hook point is out of the plastic", ["The weight is too small", "The worm is too fresh", "The line is too thin"], "A weedless rig hides the point."),
      H("Why a long leader on a Carolina rig?", "The bait floats up and moves naturally behind the weight", ["It makes the line stronger", "It prevents bites", "It avoids all snags"], "Bait trails the weight.")] },
  seasons: { n: "Fishing by season", icon: "🍂", sum: "Where fish go and what they eat all year.", cards: [
    ["Spring", "As water warms, fish move shallow to feed and spawn. Look for sunny banks and coves where water is warmest. Fish are protective of nests, so release spawning fish gently. Small jigs and live bait work well."],
    ["Summer", "Hot water pushes fish to shade, deep water and moving water. Fish early and late, and at night. Look for weed edges, docks and deeper holes. Drink water and watch for storms."],
    ["Fall", "Water cools and baitfish move into creeks and coves. Predators follow and feed hard to build up fat. Fish moving baits like spinners and crankbaits. This is often the best bite of the year."],
    ["Winter", "Fish slow down and hold in deeper, steadier water. Use small baits and fish them very slowly. If you fish on ice, check local ice reports. No ice is ever completely safe. Go with a buddy and carry ice picks."]],
    q: [Q("Where do fish go in spring?", "Shallow, warm areas", ["Always the deepest hole", "Out of the lake", "Under bridges only"], "Sun warms shallow water first."),
      Q("When should you fish hot summer days?", "Early, late or at night", ["At noon only", "Never", "Only in the rain"], "Heat pushes fish down and away."),
      Q("Why is fall often great fishing?", "Fish feed hard before winter", ["Fish sleep all day", "Water is warmest", "Bugs are everywhere"], "They fatten up."),
      Q("What bait size suits cold winter water?", "Small baits fished slowly", ["Huge baits fished fast", "Bare hooks", "Only topwater"], "Fish are slow and not hungry."),
      Q("What should you carry on ice?", "Ice picks and a buddy", ["Nothing special", "A heavy bag", "Only snacks"], "Safety first.")],
    hq: [H("Baitfish are moving into creeks in autumn. Where do you fish?", "The creek mouths and coves, where predators follow bait", ["The middle of a deep basin", "The dam wall only", "The parking area"], "Predators follow food."),
      H("A warm sunny afternoon in early spring. Where do fish gather?", "On the sunny shallow banks that warm first", ["On the shaded north bank in deep water", "Under the fastest current", "At the very bottom of the deepest hole"], "Warmth draws baitfish and bass."),
      H("It is midsummer, noon and still. What is a good plan?", "Go deeper or into shade, or wait until evening", ["Cast shallow in the full sun", "Use the heaviest line", "Fish only with topwater at noon"], "Cooler, shaded water holds fish."),
      H("Why handle fish gently in spring?", "Many are spawning and need to finish nesting", ["They are heavier", "They are slippery only then", "They bite more"], "Releasing spawners protects the next generation.")] },
  boat: { n: "Boats, kayaks and wading", icon: "🛶", sum: "Get on the water safely.", cards: [
    ["Life jacket first", "Wear a life jacket that fits, every time, even if you swim well. Cold water can take your breath and strength in seconds. Many places require them in a small boat."],
    ["Fishing from a kayak", "Sit-on-top kayaks are stable and easy to get back on. Tie the rod to the boat with a leash, bring a whistle and tell someone your plan. Stay close to shore until you are comfortable. Never stand until you are experienced."],
    ["Wading", "Wear shoes with grip and use a wading belt. Test each step with your foot. Stay out of fast or deep water. Move slowly, and don't wade alone in cold water."],
    ["Clean, drain, dry", "Before you leave a lake, check your boat and gear for plants and mud and remove them. Drain the water and let it dry. This stops invasive species from spreading to the next lake."]],
    q: [Q("When should you wear a life jacket?", "Every time you are on the water in a boat", ["Only if you can't swim", "Only in winter", "Never in a kayak"], "Accidents happen fast."),
      Q("Why leash your rod to a kayak?", "So you don't lose it if you tip", ["To catch more fish", "To keep it dry", "To make it float"], "Rods sink."),
      Q("What helps when wading?", "A wading belt and shoes with grip", ["Flip flops", "Heavy boots with no tread", "Bare feet"], "Slips are the common danger."),
      Q("What does Clean, Drain, Dry protect against?", "Spreading invasive species", ["Sunburn", "Hooks", "Tangled line"], "Plants and mud carry hitchhikers."),
      Q("Who should know your plans?", "Someone on shore", ["Nobody", "Only fish", "Only the boat"], "If something goes wrong they can help.")],
    hq: [H("Your kayak tips in cold water. What is the best first move?", "Stay calm, hold the boat, and get to shore or back on", ["Swim away from the boat", "Take off your life jacket", "Dive for the rod"], "The kayak floats and helps you."),
      H("You wade in a river and the current is getting stronger. What do you do?", "Go back to the bank before it gets deeper", ["Walk faster across", "Take your belt off", "Lean upstream and keep going"], "Strong current knocks people over."),
      H("You pulled weeds off your boat at the ramp. What now?", "Put them in the trash, not the water", ["Throw them in the lake", "Hang them on the dock", "Wash them into the next lake"], "Plant bits can start new colonies."),
      H("Why is it safer to sit than stand in a small boat or kayak?", "A lower center keeps you from tipping", ["It feels cooler", "It's quieter", "It saves energy"], "Standing makes boats unstable.")] },
  pro: { n: "Pro habits", icon: "📓", sum: "How good anglers get better.", cards: [
    ["Keep a log", "Write down date, weather, water, what you used and what you caught. After a few trips you will see patterns, like which lure works at which time. Your Fishing log in Weigh-In is made for this."],
    ["Change one thing at a time", "If you aren't getting bites, change only one thing, like the color, then the speed, then the depth. If you change everything at once you won't know what worked."],
    ["Watch and listen", "Look at the water, the birds, other anglers, even the bugs. Pay attention to the bite times and what the fish do. The best anglers notice small things."],
    ["Protect the fish", "Release big breeders, keep only what you will eat, and leave the water clean. Healthy lakes are good for everyone. Teach someone new."]],
    q: [Q("Why keep a fishing log?", "To find patterns over time", ["To impress fish", "To save line", "To avoid licenses"], "Patterns show what works."),
      Q("If you aren't getting bites, you should...", "Change one thing at a time", ["Change everything at once", "Go home", "Stand still"], "That way you know which change worked."),
      Q("Which is a good habit?", "Watching birds, bugs and the water", ["Ignoring the surface", "Fishing blind", "Making noise"], "Clues are everywhere."),
      Q("Which fish should you consider releasing?", "Big breeders", ["All fish", "No fish ever", "Only tiny fish"], "Large fish produce the most young."),
      Q("What helps new anglers most?", "A friend who teaches them", ["A silent partner", "A broken rod", "A rule book only"], "Share what you learn.")],
    hq: [H("You change lure, color, speed and depth all at once and catch a fish. What did you learn?", "Nothing clear, because too many things changed", ["The new color is magic", "The speed was wrong", "Depth does not matter"], "Change one thing at a time."),
      H("After 10 trips your log shows most bites at dawn near weed edges. What is your best plan?", "Fish weed edges at dawn", ["Fish the open middle at noon", "Fish only at night", "Stop logging"], "Use your own data."),
      H("A giant bass is your biggest ever and you will not eat it. What is the best choice?", "Take a quick photo and release it carefully", ["Keep it for the wall", "Keep it on the grass for an hour", "Sell it"], "Big breeders make more fish."),
      H("Fish are not biting and the water is clear. What is a smart single change?", "Switch to a smaller, more natural lure", ["Use brighter, louder lures", "Use thicker line", "Cast into the sun"], "Clear water calls for natural looks.")] }
});
Object.values(SCH_LESSONS).forEach((L) => { if (L.hq) { L.q.push(...L.hq); delete L.hq; } });
const SCH_COURSES = [
  { id: "rules1", n: "Permits and rules", days: ["rules"], icon: "📋", d: "1 day. What you need to fish legally." },
  { id: "start2", n: "Weekend start", days: ["gear", "rules"], icon: "🌅", d: "2 days. Get gear and rules sorted so you can go fishing." },
  { id: "begin5", n: "Beginner in 5 days", days: ["gear", "knots", "where", "lures", "rules"], icon: "🎓", d: "5 days. Everything you need for your first trips." },
  { id: "details6", n: "Little details", days: ["knots2", "water", "signs", "sky", "bait", "species"], icon: "🔍", d: "6 days. Knots, reading water, jumping fish, weather, bait and fish facts." },
  { id: "week7", n: "Full week", days: ["gear", "knots", "where", "weather", "lures", "rules", "care"], icon: "🏆", d: "7 days. The full beginner school." },
  { id: "expert4", n: "Expert school", days: ["rigs", "seasons", "boat", "pro"], icon: "🎖️", d: "4 days. Rigs, seasons, boats and pro habits. Harder questions." }
];
const SCH_RANKS = [[0, "Minnow", "🐟"], [300, "Bluegill", "🐠"], [750, "Perch", "🐡"], [1500, "Crappie", "🎣"], [2500, "Bass", "🏅"], [4000, "Walleye", "🥈"], [6000, "Pike", "🥇"], [9000, "Musky", "🏆"], [13000, "Master angler", "👑"], [18000, "Lake legend", "🌟"]];
function schRank(xp) {
  let i = 0; SCH_RANKS.forEach((r, k) => { if (xp >= r[0]) i = k; });
  const cur = SCH_RANKS[i], nxt = SCH_RANKS[i + 1];
  return { i, title: cur[1], icon: cur[2], from: cur[0], next: nxt ? nxt[0] : null, nextTitle: nxt ? nxt[1] : "", pct: nxt ? Math.round((xp - cur[0]) / (nxt[0] - cur[0]) * 100) : 100 };
}
const SCH_GUIDE = [
  ["What you need to start", ["A spinning rod and reel, about 6 to 7 feet, with 8 lb monofilament", "A few hooks (size 6 to 10), split shot weights and two bobbers", "Bait: worms are the easiest. Or a small jig or spinner", "Pliers, line clippers and a way to measure fish", "Your fishing license, if you need one", "Water, sunscreen, a hat and a bag for trash"]],
  ["Your first 10 minutes", ["Tie a hook on with the Palomar or improved clinch knot", "Pinch a split shot on the line 12 inches above the hook", "Add a bobber about 3 feet above the hook", "Put a piece of worm on the hook", "Open the bail, hold the line with your finger, swing the rod back and forward and let go to cast", "Close the bail by turning the handle. Watch the bobber. When it goes under, reel and lift the rod"]],
  ["Good first places", ["A small pond or lake with a public dock or pier", "A creek flowing into a lake, from the bank", "A park pond that is stocked with fish", "Any place with other people fishing, so you can ask", "Search your state wildlife agency for stocked ponds and free fishing days"]],
  ["The rules checklist", ["Do I need a license? (check your state)", "Does this water need an extra permit or stamp?", "What are the size and bag limits for the fish I might catch?", "Is the water open to the public, or is it private?", "Are there bait or gear rules, like no live fish?", "Clean, drain and dry gear that touched other waters"]],
  ["Fishing words", ["Bite: when a fish takes your bait", "Hookset: the firm lift that sinks the hook in", "Drag: the part of the reel that lets a big fish pull out line", "Retrieve: how you reel the lure back", "Structure: docks, wood, rocks or weeds that hold fish", "Tackle: all your fishing gear", "Leader: a short strong line between your main line and the hook", "Bag or creel limit: how many fish you may keep a day", "Slot limit: fish of a size range that must be released", "Catch and release: letting a fish go after you catch it"]],
  ["Be a good angler", ["Follow every rule, even when nobody is looking", "Handle fish with wet hands and let them go quickly", "Never leave line, hooks or trash behind", "Ask before you fish on private land", "Help a new angler. Everyone started somewhere"]]
];

/* ---- progress, saved on this phone, and your XP score is shared so friends can see your rank ---- */
const schDayNum = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 864e5);
let SCH = null, schTimer = 0;
function sch() {
  const uid = S.user?.uid || "";
  if (SCH && SCH.__uid === uid) return SCH;
  let s = {}; try { s = JSON.parse(getPref("sch-" + uid, "{}")) || {}; } catch { s = {}; }
  s.xp = +s.xp || 0; s.lessons ||= {}; s.courses ||= {}; s.free ||= { day: 0, xp: 0 }; s.streak ||= { last: 0, n: 0 }; s.seen ||= {}; s.freeLast ||= {}; s.__uid = uid;
  SCH = s; return s;
}
function schSave() {
  const s = sch(); setPref("sch-" + s.__uid, JSON.stringify(s));
  clearTimeout(schTimer);
  schTimer = setTimeout(() => { if (!S.user) return; setDoc(doc(db, "users", S.user.uid), { lx: s.xp }, { merge: true }).then(() => userCache.delete(S.user.uid)).catch(() => {}); }, 1500);
}
function schTouch() {      // keeps your day streak
  const s = sch(), d = schDayNum();
  if (s.streak.last === d) return;
  s.streak = { last: d, n: s.streak.last === d - 1 ? s.streak.n + 1 : 1 };
}
function schAward(n) { const s = sch(), before = schRank(s.xp).i; schTouch(); s.xp += Math.max(0, Math.round(n)); schSave(); const after = schRank(s.xp); return after.i > before ? after : null; }
const schShuffle = (a) => { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
const schPrep = (q) => { const o = schShuffle([q.right, ...q.wrong]); return { q: q.q, opts: o, c: o.indexOf(q.right), why: q.why, hard: !!q.hard }; };
/* Draws n questions. Ones you haven't seen come first, and harder ones are favored, so every quiz is a new mix. */
/* ---------- made-up questions: new numbers every time ---------- */
const rI = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const rPick = (a) => a[Math.floor(Math.random() * a.length)];
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
function genOpts(right, cands, fmt) {
  const out = [];
  for (const c of cands) { const v = fmt(c); if (v !== right && !out.includes(v)) out.push(v); if (out.length === 3) break; }
  return out;
}
const SCH_HAB = [
  { n: "Smallmouth bass", t: "over rocks and gravel in clear, cooler water" },
  { n: "Crappie", t: "around brush piles and sunken trees" },
  { n: "Channel catfish", t: "in deep holes and river bends" },
  { n: "Rainbow trout", t: "in cold, clear, moving water" },
  { n: "Common carp", t: "over muddy flats where they root for food" },
  { n: "Northern pike", t: "in weedy shallows" }];
const SCH_GENS = {
  oz() {
    const a = rI(1, 9), b = rI(1, 15), r = 16 * a + b, fm = (v) => v + " oz";
    return Q(`A fish weighs ${a} lb ${b} oz. How many ounces is that?`, fm(r), genOpts(fm(r), [10 * a + b, 16 * a, r + 4, r - 3, r + 16, a + b + 16], fm), `There are 16 ounces in a pound. ${a} × 16 = ${16 * a}, plus ${b} = ${r}.`);
  },
  sum() {
    const w = [0, 0, 0].map(() => rI(10, 99) / 10), t = w[0] + w[1] + w[2], fm = (v) => f1(v) + " lb";
    return Q(`You catch three fish that weigh ${w.map(f1).join(" lb, ")} lb. What is the total weight?`, fm(t), genOpts(fm(t), [t + 0.5, t - 0.5, t + 1, t - 1, t + 2], fm), `Add them up: ${w.map(f1).join(" + ")} = ${f1(t)} lb.`);
  },
  limit() {
    const L = rI(3, 10), k = rI(0, L - 1), r = L - k, fm = (v) => v + (v === 1 ? " fish" : " fish");
    return Q(`The daily limit is ${L} fish. You have kept ${k} already. How many more can you keep today?`, fm(r), genOpts(fm(r), [r + 1, r - 1, L, k, L + k, r + 2].filter((v) => v >= 0), fm), `${L} minus ${k} is ${r}. Always check your local rules for the real limit.`);
  },
  minsize() {
    const m = rI(12, 22), A = m - 0.5, B = m, C = m + rI(1, 3) + 0.5, right = "B and C";
    return Q(`The minimum length for keeping a fish is ${m} inches. Fish A is ${f1(A)} in, fish B is ${f1(B)} in and fish C is ${f1(C)} in. Which can you keep?`, right, ["Only C", "A and B", "All three"], "A minimum length means the fish must be at least that long. Check your local rules, because sizes and limits change by water.");
  },
  sunrise() {
    const h = rI(5, 7), m = rI(0, 5) * 10, x = rPick([30, 45, 60, 90]), t = h * 60 + m - x;
    const fm = (v) => `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")} AM`;
    return Q(`Sunrise is at ${h}:${String(m).padStart(2, "0")} AM. You want to be fishing ${x} minutes before sunrise. What time do you start?`, fm(t), genOpts(fm(t), [t + 15, t - 15, t + 30, t - 30, t + x, t - 60].filter((v) => v > 0), fm), `${h}:${String(m).padStart(2, "0")} minus ${x} minutes is ${fm(t)}. Dawn is a great time to fish.`);
  },
  top3() {
    const w = [0, 0, 0, 0, 0].map(() => rI(15, 89) / 10).sort((a, b) => b - a), t = w[0] + w[1] + w[2], fm = (v) => f1(v) + " lb";
    return Q(`In a tournament only your 3 biggest fish count. You caught fish of ${[...w].sort(() => Math.random() - 0.5).map(f1).join(", ")} lb. What is your score?`, fm(t), genOpts(fm(t), [w[0] + w[1] + w[2] + w[3], w[2] + w[3] + w[4], w[0] + w[1], t + 0.5, t - 0.5, w.reduce((a, b) => a + b, 0)], fm), `Take the three biggest (${f1(w[0])}, ${f1(w[1])}, ${f1(w[2])}) and add them: ${f1(t)} lb.`);
  },
  habitat() {
    const f = rPick(SCH_HAB), o = SCH_HAB.filter((x) => x !== f).sort(() => Math.random() - 0.5).slice(0, 3);
    return Math.random() < 0.5
      ? Q(`Where would you most likely find ${f.n}?`, f.t, o.map((x) => x.t), `${f.n} like to be ${f.t}.`)
      : Q(`Which fish do you usually find ${f.t}?`, f.n, o.map((x) => x.n), `${f.n} like to be ${f.t}.`);
  }
};
const SCH_MATH = ["oz", "sum", "limit", "minsize", "sunrise", "top3"];
const SCH_GEN = { gear: ["oz", "sum"], care: ["oz", "limit"], weather: ["sunrise"], sky: ["sunrise"], rules: ["limit", "minsize"], species: ["habitat"], where: ["habitat"], water: ["habitat"], pro: ["top3"], seasons: ["sunrise"], boat: ["sum"], rigs: ["sum"], lures: ["habitat"], bait: ["habitat"] };
const SCH_GEN_ALL = [...SCH_MATH, "habitat"];
function schDraw(pool, n, key, gens) {
  const s = sch(), seen = new Set(s.seen[key] || []);
  const g = gens && gens.length ? [...new Set(gens)] : null, nd = !pool.length ? n : g ? Math.max(1, Math.round(n / 3)) : 0;
  const dyn = [], dq = new Set();
  for (let t = 0; g && dyn.length < nd && t < nd * 10; t++) { const q = SCH_GENS[rPick(g)](); if (!dq.has(q.q)) { dq.add(q.q); dyn.push(q); } }
  n -= dyn.length;
  const pick = pool.map((q) => ({ q, k: Math.random() + (seen.has(q.q) ? 0 : 2) + (q.hard ? 0.8 : 0) })).sort((a, b) => b.k - a.k).slice(0, Math.min(n, pool.length)).map((x) => x.q);
  let ns = [...seen, ...pick.map((q) => q.q)]; if (pool.every((q) => ns.includes(q.q))) ns = pick.map((q) => q.q);      // once you've seen them all, start the cycle again
  s.seen[key] = ns.slice(-80); schSave();
  return schShuffle([...pick, ...dyn]).map(schPrep);
}
const SCH_LQ = 6;                                              // questions in a lesson quiz
const schWait = (rec) => !!rec && rec.last === schDayNum();    // you took this quiz today, so it opens again tomorrow
const schLockMsg = () => toast("You already took this one today. It opens again tomorrow with new questions.");
const schAllQs = (lids) => lids.flatMap((id) => SCH_LESSONS[id].q);
function schCourseState(c) {      // what is open in a course today
  const st = sch().courses[c.id]; if (!st) return null;
  const day = schDayNum() - st.start;
  const items = c.days.map((lid, i) => {
    const done = st.done.includes(lid), open = i === 0 || st.done.includes(c.days[i - 1]);
    const unlocked = open && (day >= i || st.skip.includes(i));
    return { lid, i, done, open, unlocked };
  });
  const allDone = items.every((x) => x.done), finUnlocked = allDone && (day >= c.days.length || st.skip.includes("final"));
  return { st, day, items, allDone, finUnlocked };
}
function schNext() {      // the next thing you can do in any course you started
  for (const c of SCH_COURSES) { const cs = schCourseState(c); if (!cs || cs.st.fin) continue;
    const it = cs.items.find((x) => !x.done && x.unlocked); if (it) return { c, text: `${c.n}: day ${it.i + 1} is ready`, kind: "lesson" };
    if (cs.finUnlocked) return { c, text: `${c.n}: final quiz is ready`, kind: "final" }; }
  return null;
}
function viewSchool(p) {
  const V = S.sch || (S.sch = { v: "home" });
  const go2 = (v, extra) => { Object.assign(V, { v }, extra || {}); renderTab(); };
  p.append(el("button", { class: "link", type: "button", id: "sch-back", style: "align-self:flex-start", onclick: () => { if (V.v === "home") { S.meView = "main"; renderTab(); } else go2(V.back || "home", { back: null }); } }, V.v === "home" ? "‹ Profile" : "‹ Fishing school"));
  const fn = { home: schHome, guide: schGuide, knots: schKnotBook, course: schCourse, play: schPlay, quizpick: schQuizPick, board: schBoard }[V.v] || schHome;
  fn(p, V, go2);
}
function schRankCard() {
  const s = sch(), r = schRank(s.xp), streakOn = s.streak.last >= schDayNum() - 1 ? s.streak.n : 0;
  return el("div", { class: "sch-rank", id: "sch-rank" },
    el("div", { class: "row spread", style: "align-items:center" },
      el("div", { class: "row", style: "gap:10px;align-items:center" }, el("span", { class: "sch-badge" }, r.icon), el("div", { class: "stack", style: "gap:0" }, el("b", { style: "font-size:20px" }, r.title), el("span", { class: "hint" }, "Your fishing rank"))),
      el("div", { class: "stack", style: "gap:0;text-align:right" }, el("b", { id: "sch-xp" }, `${s.xp} XP`), el("span", { class: "hint" }, streakOn ? `🔥 ${streakOn} day streak` : "Start a streak today"))),
    el("div", { class: "sch-bar", role: "progressbar", "aria-valuenow": String(r.pct), "aria-valuemin": "0", "aria-valuemax": "100" }, el("i", { style: `width:${Math.max(3, r.pct)}%` })),
    el("span", { class: "hint" }, r.next ? `${r.next - s.xp} XP to ${r.nextTitle}` : "Top rank. You're a legend."));
}
function schHome(p, V, go2) {
  const s = sch(), nxt = schNext();
  getUser(S.user.uid).then((u) => { if (+u.lx > s.xp) { s.xp = +u.lx; schSave(); if (S.tab === "me" && S.meView === "school" && V.v === "home") renderTab(); } });   // new phone: pick up your score
  p.append(el("h1", null, "Fishing school"), schRankCard());
  if (nxt) p.append(el("button", { class: "btn wide", type: "button", id: "sch-continue", onclick: () => go2("course", { cid: nxt.c.id }) }, "▶ " + nxt.text));
  p.append(el("h2", null, "Courses"),
    el("div", { class: "stack", id: "sch-courses" }, SCH_COURSES.map((c) => {
      const cs = schCourseState(c);
      const status = !cs ? "Not started" : cs.st.fin ? "✅ Finished" : `${cs.st.done.length} of ${c.days.length} days done`;
      return el("button", { class: "sch-course", type: "button", "data-course": c.id, onclick: () => go2("course", { cid: c.id }) },
        el("span", { class: "sch-ico" }, c.icon), el("span", { class: "stack", style: "gap:2px;text-align:left;min-width:0" }, el("b", null, c.n), el("span", { class: "hint" }, c.d), el("span", { class: "pill" + (cs ? " live" : "") }, status)));
    })),
    el("h2", null, "Quiz yourself"),
    el("div", { class: "row", style: "gap:8px" },
      el("button", { class: "btn", type: "button", id: "sch-quick", onclick: () => go2("quizpick") }, "🎯 Regular quiz"),
      el("button", { class: "btn ghost", type: "button", id: "sch-guide", onclick: () => go2("guide") }, "📖 Beginner guide")),
    el("button", { class: "btn ghost wide", type: "button", id: "sch-knots", onclick: () => go2("knots") }, "🪢 Knot book (step by step pictures)"),
    el("details", { class: "sch-lib" }, el("summary", null, "Lesson library"),
      el("div", { class: "stack", style: "gap:6px;margin-top:8px" }, Object.entries(SCH_LESSONS).map(([id, L]) => el("button", { class: "item", type: "button", "data-lesson": id,
        onclick: () => { if (schWait(s.lessons[id])) return schLockMsg(); go2("play", { kind: "lesson", lid: id, cid: "", qs: schDraw(L.q, SCH_LQ, "l:" + id, SCH_GEN[id]), back: "home" }); } }, el("span", { class: "t" }, `${L.icon} ${L.n}`), el("span", { class: "label" }, schWait(s.lessons[id]) ? "Tomorrow" : s.lessons[id]?.done ? `Best ${s.lessons[id].best}/${SCH_LQ}` : "›"))))),
    el("button", { class: "btn ghost wide", type: "button", id: "sch-board", onclick: () => go2("board") }, "🏅 Top anglers"),
    el("p", { class: "hint" }, "This is beginner knowledge. Fishing rules are different in every state and country, so always check your local wildlife agency. It isn't legal advice."));
}
/* ---- Knot book: simple step drawings + video links ---- */
const SCH_VID = { gear: "how to choose fishing rod and reel for beginners", knots: "how to tie fishing knots for beginners", where: "how to find fish in a lake for beginners", weather: "best weather and time to go fishing", lures: "fishing lures and bait for beginners", rules: "fishing license and rules explained", care: "how to safely catch and release fish", knots2: "palomar knot uni knot loop knot fishing", water: "how to read the water fishing", signs: "reading fish activity on the water surface", sky: "how weather wind and moon affect fishing", bait: "how to hook live bait worms minnows", species: "bluegill bass trout catfish fish facts", rigs: "slip bobber texas rig drop shot carolina rig explained", seasons: "how to fish each season spring summer fall winter", boat: "kayak fishing safety for beginners life jacket", pro: "how to keep a fishing log and find patterns" };
const schVidUrl = (q) => "https://www.youtube.com/results?search_query=" + encodeURIComponent(q);
const KB = {
  eye: '<circle cx="60" cy="20" r="8" fill="none" stroke="#7a8a96" stroke-width="3"/>',
  line: (d) => `<path d="${d}" fill="none" stroke="#1b8fd1" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  tail: (d) => `<path d="${d}" fill="none" stroke="#e8742a" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  txt: () => "",
  coils: (n, y0) => { let d = `M48 ${y0}`; for (let i = 0; i < n; i++) d += ` L72 ${y0 + i * 6 + 3} L48 ${y0 + i * 6 + 6}`; return d; }
};
const svg = (inner) => `<svg viewBox="0 0 120 120" width="120" height="120" role="img" aria-hidden="true">${inner}</svg>`;
const SCH_KNOTS = [
  { id: "clinch", n: "Improved clinch knot", use: "Hooks, swivels and lures. The best first knot.", vid: "improved clinch knot fishing how to tie", steps: [
    ["Thread the line", "Push the end of the line through the hook eye and pull about 6 inches through.", () => svg(KB.eye + KB.line("M58 118 V24") + KB.tail("M58 24 Q60 8 64 24 V70") + KB.txt(60, 112, "line goes through the eye"))],
    ["Wrap the tail", "Wrap the tail around the standing line 5 to 7 times.", () => svg(KB.eye + KB.line("M58 118 V24") + KB.tail("M64 24 V40 L" + KB.coils(6, 40).slice(1)) + KB.txt(60, 112, "wrap 5 to 7 times"))],
    ["Small loop", "Pass the tail through the small loop right next to the hook eye.", () => svg(KB.eye + KB.line("M58 118 V24") + KB.tail("M48 52 L72 55 L48 58 L72 61 L48 64 L72 67 L48 70") + '<circle cx="76" cy="36" r="6" fill="none" stroke="#1b8fd1" stroke-width="2" stroke-dasharray="3 2"/>' + KB.tail("M60 48 Q80 48 76 36") + KB.txt(60, 112, "tail through the small loop"))],
    ["Big loop", "Now pass the tail back through the big loop that formed above it.", () => svg(KB.eye + KB.line("M58 118 V24") + KB.tail("M48 52 L72 55 L48 58 L72 61 L48 64 L72 67 L48 70") + '<path d="M74 40 C112 20 112 76 74 66" fill="none" stroke="#1b8fd1" stroke-width="2" stroke-dasharray="3 2"/>' + KB.tail("M60 48 C88 38 96 62 70 68") + KB.txt(60, 112, "tail through the big loop"))],
    ["Wet and pull tight", "Wet the knot, pull the standing line slowly until snug, then trim the tail short.", () => svg(KB.eye + KB.line("M58 118 V28") + '<rect x="52" y="34" width="14" height="26" rx="4" fill="#e8742a" opacity=".85"/>' + KB.tail("M66 36 l6 -6") + '<path d="M96 40 q-6 10 0 14 q6 -4 0 -14z" fill="#1b8fd1"/>' + KB.txt(60, 112, "wet, tighten, trim"))]] },
  { id: "palomar", n: "Palomar knot", use: "Very strong. Great with braid.", vid: "palomar knot fishing how to tie", steps: [
    ["Double the line", "Fold about 6 inches of line into a loop and push the loop through the hook eye.", () => svg(KB.eye + KB.line("M54 118 V22") + KB.tail("M66 118 V22") + '<path d="M54 22 Q60 6 66 22" fill="none" stroke="#1b8fd1" stroke-width="3.2"/>' + KB.txt(60, 112, "two lines through the eye"))],
    ["Tie a loose overhand knot", "Let the hook hang. Tie a simple overhand knot in the doubled line. Do not tighten it.", () => svg(KB.eye + KB.line("M54 118 V70 C54 40 80 40 74 56 C70 70 56 60 60 46 L60 28") + KB.tail("M66 118 V80 C70 60 74 50 66 44 L60 30") + KB.txt(60, 112, "loose overhand knot"))],
    ["Loop over the hook", "Pull the loop wide and pass it all the way over the hook.", () => svg('<path d="M60 14 Q96 10 92 54 Q84 100 60 84 Q36 100 28 54 Q24 10 60 14z" fill="none" stroke="#1b8fd1" stroke-width="3"/>' + KB.eye.replace('cy="20"', 'cy="52"') + KB.line("M54 118 V70") + KB.tail("M66 118 V70") + KB.txt(60, 112, "loop goes over the hook"))],
    ["Wet and pull", "Wet it and pull both ends of the line slowly so the knot slides down snug against the eye.", () => svg(KB.eye + KB.line("M58 118 V30") + '<circle cx="58" cy="38" r="8" fill="#e8742a" opacity=".85"/>' + '<path d="M96 40 q-6 10 0 14 q6 -4 0 -14z" fill="#1b8fd1"/>' + KB.txt(60, 112, "slide down to the eye"))],
    ["Trim the tail", "Trim the short tail close to the knot. Check the knot looks tidy.", () => svg(KB.eye + KB.line("M58 118 V30") + '<circle cx="58" cy="38" r="8" fill="#e8742a" opacity=".85"/>' + '<path d="M70 30 l22 -12 M70 18 l22 12" stroke="#7a8a96" stroke-width="2.5"/>' + KB.txt(60, 112, "trim the tail"))]] },
  { id: "uni", n: "Uni knot", use: "Hooks, lures, and joining two lines.", vid: "uni knot fishing how to tie", steps: [
    ["Thread the line", "Push the line through the hook eye and pull 6 inches through. Fold the tail back along the line.", () => svg(KB.eye + KB.line("M54 118 V24") + KB.tail("M54 24 Q60 6 66 24 V80") + KB.txt(60, 112, "tail parallel to the line"))],
    ["Make a loop", "Make a loop by laying the tail back over the line to form a circle next to the eye.", () => svg(KB.eye + KB.line("M54 118 V30") + KB.tail("M66 30 V50 C90 40 90 90 62 82 L54 82") + KB.txt(60, 112, "make a loop"))],
    ["Wrap through the loop", "Wrap the tail around both lines and through the loop 4 to 6 times.", () => svg(KB.eye + KB.line("M58 118 V24") + KB.tail("M46 50 L70 54 L46 58 L70 62 L46 66 L70 70 L46 74") + KB.txt(60, 112, "wrap 4 to 6 times"))],
    ["Wet and pull", "Wet it. Pull the tail slowly to tighten the coils.", () => svg(KB.eye + KB.line("M58 118 V24") + KB.tail("M48 50 L68 54 L48 58 L68 62 L48 66") + '<path d="M96 40 q-6 10 0 14 q6 -4 0 -14z" fill="#1b8fd1"/>' + KB.txt(60, 112, "wet and tighten"))],
    ["Slide to the eye and trim", "Pull the standing line so the knot slides down to the hook eye. Trim the tail.", () => svg(KB.eye + KB.line("M58 118 V30") + '<rect x="52" y="34" width="14" height="20" rx="4" fill="#e8742a" opacity=".85"/>' + KB.txt(60, 112, "snug to the eye, trim"))]] }
];
function schKnotBook(p) {
  p.append(el("h1", null, "Knot book"), el("p", { class: "muted" }, "Step by step pictures. These are simple drawings: blue is the line you hold, orange is the tail. Watch a video too, so you can see the real thing."));
  SCH_KNOTS.forEach((k, i) => {
    const d = el("details", { class: "sch-lib", id: "knot-" + k.id, open: i === 0 ? "" : null }, el("summary", null, "🪢 " + k.n),
      el("p", { class: "hint", style: "margin:8px 0" }, k.use),
      el("div", { class: "stack", style: "gap:10px" }, k.steps.map(([h, t, img], si) => {
        const pic = el("div", { class: "kn-pic" }); pic.innerHTML = img();
        return el("div", { class: "kn-step", "data-step": si + 1 }, pic, el("div", { class: "stack", style: "gap:2px;min-width:0" }, el("b", null, `${si + 1}. ${h}`), el("span", null, t)));
      })),
      el("a", { class: "btn small", href: schVidUrl(k.vid), target: "_blank", rel: "noopener", style: "margin-top:10px;align-self:flex-start" }, "▶ Watch a video"));
    p.append(d);
  });
  p.append(el("p", { class: "hint" }, "The video button opens a YouTube search for that knot, so you can pick the video you like."));
}
function schGuide(p) {
  p.append(el("h1", null, "Beginner guide"), el("p", { class: "muted" }, "Everything you need for your first day on the water."),
    SCH_GUIDE.map(([h, items], i) => el("details", { class: "sch-lib", id: "guide-" + i, open: i === 0 ? "" : null }, el("summary", null, h),
      el("ul", { class: "why", style: "margin-top:8px" }, items.map((t) => el("li", null, t))))),
    el("p", { class: "hint" }, "Ready to learn more? Start the Beginner in 5 days course."));
}
function schCourse(p, V, go2) {
  const c = SCH_COURSES.find((x) => x.id === V.cid) || SCH_COURSES[0], cs = schCourseState(c);
  p.append(el("h1", null, `${c.icon} ${c.n}`), el("p", { class: "muted" }, c.d + " One lesson a day, then a final quiz."));
  if (!cs) { p.append(el("button", { class: "btn wide", type: "button", id: "sch-start", onclick: () => { sch().courses[c.id] = { start: schDayNum(), done: [], skip: [], fbest: 0, fin: false }; schSave(); renderTab(); } }, "Start this course today"),
    el("div", { class: "stack" }, c.days.map((lid, i) => el("div", { class: "item", style: "cursor:default" }, el("span", { class: "t" }, `Day ${i + 1}: ${SCH_LESSONS[lid].icon} ${SCH_LESSONS[lid].n}`), el("span", { class: "s" }, SCH_LESSONS[lid].sum)))));
    return; }
  const { st, items, allDone, finUnlocked } = cs, st0 = sch();
  p.append(el("div", { class: "stack", id: "sch-days" }, items.map((x) => {
    const L = SCH_LESSONS[x.lid], wait = schWait(st0.lessons[x.lid]), play = () => { if (wait) return schLockMsg(); go2("play", { kind: "lesson", lid: x.lid, cid: c.id, qs: schDraw(L.q, SCH_LQ, "l:" + x.lid, SCH_GEN[x.lid]), back: "course" }); };
    return el("div", { class: "sch-day" + (x.done ? " done" : x.unlocked ? " open" : ""), "data-day": x.i + 1 },
      el("span", { class: "sch-dot" }, x.done ? "✅" : x.unlocked ? "▶" : "🔒"),
      el("div", { class: "stack", style: "gap:2px;flex:1;min-width:0" }, el("b", null, `Day ${x.i + 1}: ${L.n}`), el("span", { class: "hint" }, L.sum),
        !x.open ? el("span", { class: "hint" }, "Finish the day before first.") : !x.unlocked ? el("span", { class: "hint" }, "Opens tomorrow.") : null),
      x.unlocked ? el("button", { class: "btn small" + (x.done || wait ? " ghost" : ""), type: "button", "data-play": x.i + 1, disabled: wait ? "" : null, onclick: play }, wait ? "Tomorrow" : x.done ? "Again" : "Start")
        : x.open ? el("button", { class: "btn small ghost", type: "button", "data-skip": x.i + 1, onclick: () => { st.skip.push(x.i); schSave(); renderTab(); } }, "Do it now") : null);
  })));
  const ids = c.days, finQs = () => schDraw(schAllQs(ids), 10, "f:" + c.id, ids.flatMap((l) => SCH_GEN[l] || [])), finWait = st.flast === schDayNum();
  p.append(el("div", { class: "sch-day" + (st.fin ? " done" : finUnlocked ? " open" : ""), id: "sch-final" },
    el("span", { class: "sch-dot" }, st.fin ? "🏆" : finUnlocked ? "▶" : "🔒"),
    el("div", { class: "stack", style: "gap:2px;flex:1" }, el("b", null, "Final quiz"), el("span", { class: "hint" }, st.fbest ? `Best ${st.fbest}/10. Get 8 or more to finish the course.` : "10 hard questions from every lesson. Get 8 or more to finish the course."),
      !allDone ? el("span", { class: "hint" }, "Finish all the days first.") : !finUnlocked ? el("span", { class: "hint" }, "Opens the day after your last lesson.") : null),
    finUnlocked ? el("button", { class: "btn small" + (finWait ? " ghost" : ""), type: "button", id: "sch-final-go", disabled: finWait ? "" : null, onclick: () => go2("play", { kind: "final", cid: c.id, qs: finQs(), back: "course" }) }, finWait ? "Tomorrow" : st.fin ? "Again" : "Start")
      : allDone ? el("button", { class: "btn small ghost", type: "button", id: "sch-final-skip", onclick: () => { st.skip.push("final"); schSave(); renderTab(); } }, "Take it now") : null));
  p.append(el("button", { class: "link danger small", type: "button", style: "align-self:flex-start", onclick: () => { if (confirm("Start this course over? Your XP stays.")) { delete sch().courses[c.id]; schSave(); renderTab(); } } }, "Start over"));
}
function schQuizPick(p, V, go2) {
  const q = V.pick || (V.pick = { topic: "all", n: 10 });
  const paint = () => { const box = document.getElementById("sch-pick"); if (!box) return renderTab(); renderTab(); };
  p.append(el("h1", null, "Regular quiz"), el("p", { class: "muted" }, "Pick a topic and how many questions. Your best scores earn rank points, up to 100 XP a day."),
    el("b", null, "Topic"), el("div", { class: "chips", id: "sch-topics" }, [["all", "Everything"], ["math", "🧮 Fishing math"], ...Object.entries(SCH_LESSONS).map(([id, L]) => [id, L.n])].map(([id, n]) => el("button", { class: "chip", type: "button", "data-topic": id, "aria-pressed": String(q.topic === id), onclick: () => { q.topic = id; paint(); } }, n))),
    el("b", null, "Questions"), el("div", { class: "chips", id: "sch-count" }, [5, 10, 15].map((n) => el("button", { class: "chip", type: "button", "data-n": n, "aria-pressed": String(q.n === n), onclick: () => { q.n = n; paint(); } }, String(n)))),
    el("button", { class: "btn wide", type: "button", id: "sch-quiz-go", onclick: () => { if (sch().freeLast[q.topic] === schDayNum()) return schLockMsg(); const pool = q.topic === "all" ? schAllQs(Object.keys(SCH_LESSONS)) : q.topic === "math" ? [] : SCH_LESSONS[q.topic].q, gens = q.topic === "all" ? SCH_GEN_ALL : q.topic === "math" ? SCH_MATH : SCH_GEN[q.topic]; go2("play", { kind: "free", cid: "", topic: q.topic, qs: schDraw(pool, q.n, "q:" + q.topic, gens), back: "quizpick" }); } }, "Start quiz"),
    el("p", { class: "hint" }, "Each quiz is a new mix of questions. Once you take a quiz, you can take it again tomorrow."));
}
function schPlay(p, V, go2) {
  const L = V.kind === "lesson" ? SCH_LESSONS[V.lid] : null, qs = V.qs;
  const steps = [...(L ? L.cards.map((c) => ({ t: "card", c })) : []), ...qs.map((q) => ({ t: "q", q }))];
  const box = el("div", { class: "stack sch-play", id: "sch-play" }); p.append(box);
  let i = 0, right = 0;
  const title = V.kind === "lesson" ? `${L.icon} ${L.n}` : V.kind === "final" ? "Final quiz" : "Regular quiz";
  const bar = () => el("div", { class: "sch-bar" }, el("i", { style: `width:${Math.round(i / steps.length * 100)}%` }));
  const draw = () => {
    if (i >= steps.length) return finish();
    const st = steps[i];
    if (st.t === "card") {
      box.replaceChildren(el("b", { class: "hint" }, title), bar(), el("div", { class: "sch-card", id: "sch-cardbox" }, el("h2", null, st.c[0]), el("p", null, st.c[1])),
        SCH_VID[V.lid] ? el("a", { class: "sch-vid", id: "sch-vid", href: schVidUrl(SCH_VID[V.lid]), target: "_blank", rel: "noopener" }, "▶ Watch a video about this") : null,
        el("button", { class: "btn wide", type: "button", id: "sch-next", onclick: () => { i++; draw(); } }, i === L.cards.length - 1 ? "Start the quiz" : "Next"));
      return;
    }
    const q = st.q; let answered = false;
    const note = el("div", { class: "sch-why", id: "sch-why", hidden: true }), next = el("button", { class: "btn wide", type: "button", id: "sch-next", hidden: true, onclick: () => { i++; draw(); } }, i === steps.length - 1 ? "See my score" : "Next");
    const opts = q.opts.map((o, k) => el("button", { class: "sch-opt", type: "button", "data-opt": k, onclick: () => {
      if (answered) return; answered = true;
      const ok = k === q.c; if (ok) right++;
      opts.forEach((b, j) => { b.disabled = true; if (j === q.c) b.classList.add("right"); else if (j === k) b.classList.add("wrong"); });
      note.hidden = false; note.replaceChildren(el("b", null, ok ? "Correct! " : "Not quite. "), q.why); note.className = "sch-why " + (ok ? "ok" : "bad"); next.hidden = false; next.focus?.();
    } }, el("b", { class: "sch-let" }, "ABCD"[k]), el("span", null, o)));
    const qn = steps.slice(0, i + 1).filter((x) => x.t === "q").length;
    box.replaceChildren(el("div", { class: "row spread", style: "align-items:center" }, el("b", { class: "hint" }, title), el("span", { class: "sch-qn", id: "sch-qn" }, `Question ${qn} of ${qs.length}`, q.hard ? el("span", { class: "sch-hard" }, "Hard") : null)), bar(), el("h2", { id: "sch-q" }, q.q), el("div", { class: "stack", style: "gap:8px" }, opts), note, next);
  };
  const finish = () => {
    const s = sch(), total = qs.length, pass = right / total >= (V.kind === "final" ? 0.9 : V.kind === "lesson" ? 0.85 : 0.75), today0 = schDayNum();
    let gain = 0, extra = "", rankUp = null;
    if (V.kind === "lesson") {
      const rec = s.lessons[V.lid] || (s.lessons[V.lid] = { done: false, best: 0 });
      rec.last = today0; if (pass && !rec.done) { rec.done = true; gain += 30; }
      gain += 8 * Math.max(0, right - rec.best); rec.best = Math.max(rec.best, right);
      if (V.cid && pass) { const st = s.courses[V.cid]; if (st && !st.done.includes(V.lid)) st.done.push(V.lid); }
      extra = pass ? "Lesson complete!" : `You need ${Math.ceil(total * 0.85)} out of ${total} to finish the lesson. Read the cards again and try tomorrow.`;
    } else if (V.kind === "final") {
      const st = s.courses[V.cid]; st.flast = today0; gain += 10 * Math.max(0, right - st.fbest); st.fbest = Math.max(st.fbest, right);
      if (pass && !st.fin) { st.fin = true; gain += 50; extra = "Course finished! 🏆"; } else extra = pass ? "You passed again." : "You need 9 out of 10 to finish. Review the lessons and try again tomorrow.";
    } else {
      const today = schDayNum(); s.freeLast[V.topic || "all"] = today; if (s.free.day !== today) s.free = { day: today, xp: 0 };
      gain = Math.min(5 * right, Math.max(0, 100 - s.free.xp)); s.free.xp += gain;
      extra = gain < 5 * right ? "You hit today's 100 XP limit for regular quizzes. Come back tomorrow." : "";
    }
    rankUp = schAward(gain);
    const r = schRank(s.xp), pct = Math.round(right / total * 100);
    box.replaceChildren(el("div", { class: "sch-result", id: "sch-result" }, el("div", { class: "sch-big" }, `${right} / ${total}`), el("b", null, pct === 100 ? "Perfect! 🎉" : pass ? "Nice work!" : "Keep practicing"),
      extra ? el("span", null, extra) : null, el("b", { id: "sch-gain" }, `+${gain} XP`),
      rankUp ? el("div", { class: "sch-rankup", id: "sch-rankup" }, `New rank: ${rankUp.icon} ${rankUp.title}!`) : el("span", { class: "hint" }, `${r.icon} ${r.title} · ${s.xp} XP`)),
      el("button", { class: "btn wide", type: "button", id: "sch-done", onclick: () => go2(V.back || "home", { back: null }) }, V.cid ? "Back to the course" : "Done"),
      el("p", { class: "hint", id: "sch-tomorrow" }, "You can take this quiz again tomorrow. It will have new questions."));
  };
  draw();
}
function schBoard(p) {
  const list = el("div", { class: "list", id: "sch-list" }, el("p", { class: "muted" }, "Loading…"));
  p.append(el("h1", null, "Top anglers"), el("p", { class: "muted" }, "Ranked by fishing school points."), list);
  getDocs(query(collection(db, "users"), orderBy("lx", "desc"), limit(20))).then((s) => {
    const rows = s.docs.map((d) => ({ uid: d.id, ...d.data() })).filter((u) => u.lx > 0 && u.uid !== OWNER_UID);
    if (!rows.length) { list.replaceChildren(el("p", { class: "empty" }, "Nobody has points yet. Be the first.")); return; }
    list.replaceChildren(...rows.map((u, i) => { const r = schRank(u.lx); return el("div", { class: "item" + (u.uid === S.user.uid ? " me" : ""), style: "cursor:default" },
      el("span", { class: "row", style: "gap:10px;min-width:0;flex-wrap:nowrap" }, el("span", { class: "rank-n" }, String(i + 1)), avatar(u.uid, u.name || "?", 32), el("span", { class: "stack", style: "gap:0;min-width:0" }, el("span", { class: "t", style: "overflow-wrap:anywhere" }, "@" + (u.name || "angler")), el("span", { class: "s" }, `${r.icon} ${r.title}`))),
      el("b", null, `${u.lx} XP`)); }));
  }).catch(() => list.replaceChildren(el("p", { class: "empty" }, "Couldn't load the list. Try again later.")));
}

/* ======================= AUTO UPDATE ======================= */
let updatePending = 0;
async function latestVersion() {
  const r = await fetch("app.js?cb=" + Date.now(), { cache: "no-store" }); if (!r.ok) return 0;
  const m = /const APP_VERSION = (\d+)/.exec(await r.text()); return m ? +m[1] : 0;
}
async function checkUpdate() {
  try {
    const v = await latestVersion();
    if (v > APP_VERSION && v !== updatePending) { updatePending = v; if (document.visibilityState === "hidden") rememberUpdate(); else showUpdateBar(); }
  } catch { /* offline: try again later */ }
}
function rememberUpdate() { try { if (updatePending) localStorage.setItem("weighin-appv", String(updatePending)); } catch { /* private mode */ } }   // the next time the app opens, it loads the new version
function showUpdateBar() {
  if (document.getElementById("update-bar")) return;
  document.body.append(el("div", { class: "update-bar", id: "update-bar", role: "status" }, el("span", null, `A new beta version (v${updatePending}) is ready.`),
    el("button", { class: "btn small", type: "button", id: "update-now", onclick: applyUpdate }, "Update now")));
}
async function applyUpdate() {
  const b = document.getElementById("update-now"); if (b) { b.disabled = true; b.textContent = "Updating…"; }
  try {
    const newest = await latestVersion();                       // jump straight to the newest, even if you are several versions behind
    if (newest > updatePending) updatePending = newest;
    for (let k = 0; k < 3; k++) {                               // make sure the new files are really there before reloading
      const rs = await Promise.all([`app.js?v=${updatePending}`, `style.css?v=${updatePending}`].map((u) => fetch(u, { cache: "reload" })));
      const m = /const APP_VERSION = (\d+)/.exec(await rs[0].text());
      if (m && +m[1] >= updatePending) { if (+m[1] > updatePending) updatePending = +m[1]; break; }
      await new Promise((ok) => setTimeout(ok, 1500));
    }
  } catch { /* reload anyway */ }
  rememberUpdate();
  try { await Promise.all(["index.html", "./"].map((u) => fetch(u, { cache: "reload" }).catch(() => {}))); } catch { /* reload anyway */ }
  location.reload();
}
setTimeout(checkUpdate, 4000);
setInterval(checkUpdate, 5 * 60 * 1000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") { if (updatePending) rememberUpdate(); else checkUpdate(); return; }   // closing the app: the next open is the new version
  if (updatePending) { const a = document.activeElement; if (!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) && S.tab !== "post") applyUpdate(); }   // coming back: update unless you're typing or posting
  else checkUpdate();
});
addEventListener("pagehide", () => { if (updatePending) rememberUpdate(); });

/* ======================= ME (profile, log, friends, settings) ======================= */
function watchMine() {
  if (meUnsub) return;
  meUnsub = onSnapshot(query(collection(db, "posts"), where("uid", "==", S.user.uid), limit(60)), (s) => {
    S.mine = s.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    if (S.tab === "me" && (S.meView === "main" || S.meView === "profile")) renderTab();
  }, () => {});
}
async function setMyPhoto(file) {
  if (!file) return;
  toast("Updating your picture…");
  try {
    const photo = await squarePhoto(file);
    await updateDoc(doc(db, "users", S.user.uid), { photo });
    userCache.delete(S.user.uid); cardCache.clear();
    toast("Profile picture updated."); renderTab();
  } catch (e) { toast(e?.code ? errText(e) : "Couldn't read that photo. Try another."); }
}
async function clearMyPhoto() {
  try { await updateDoc(doc(db, "users", S.user.uid), { photo: "" }); userCache.delete(S.user.uid); cardCache.clear(); toast("Profile picture removed."); renderTab(); }
  catch (e) { toast(errText(e)); }
}
const photoInput = (id, label) => el("input", { type: "file", accept: "image/*", id, "aria-label": label, onchange: (e) => { const f = e.target.files?.[0]; e.target.value = ""; setMyPhoto(f); } });
const backBtn = (text) => el("button", { class: "link", type: "button", style: "align-self:flex-start", onclick: () => { S.meView = "main"; renderTab(); } }, text);

/* Share the app: the phone's own share sheet when there is one, otherwise the link is copied. */
async function shareApp() {
  const url = location.origin + location.pathname.replace(/index\.html$/, ""), data = { title: "Weigh-In", text: "Come fish with me on Weigh-In. It's a free fishing app: post catches, learn, trade gear and join tournaments.", url };
  try { if (navigator.share) { await navigator.share(data); return; } } catch (e) { if (e && e.name === "AbortError") return; }
  try { await navigator.clipboard.writeText(url); toast("Link copied. Paste it in a text or chat."); }
  catch { const t = el("input", { type: "text", value: url, readonly: "", style: "position:fixed;left:-999px" }); document.body.append(t); t.select(); try { document.execCommand("copy"); toast("Link copied. Paste it in a text or chat."); } catch { toast("Share this link: " + url); } t.remove(); }
}
function viewMe(p) {
  if (S.meView === "log") { p.append(backBtn("‹ Profile")); return viewLog(p); }
  if (S.meView === "friends") { p.append(backBtn("‹ Profile")); return viewFriends(p); }
  if (S.meView === "water") { p.append(backBtn("‹ Profile")); return viewWater(p); }
  if (S.meView === "school") return viewSchool(p);
  if (S.meView === "settings") return viewSettings(p);
  if (S.meView === "owner" && isStaff()) return viewOwner(p);
  if (S.meView === "profile") return viewProfile(p);
  const mine = [...S.mine].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  const biggest = Math.max(0, ...mine.map((x) => x.lb || 0));
  const pins = S.spots.filter((s) => s.uid === S.user.uid).length;
  const open = (v) => () => { S.meView = v; renderTab(); };
  p.append(
    el("button", { class: "profile-head", type: "button", id: "me-profile", "aria-label": "Open your profile", style: "background:none;border:0;padding:0;text-align:left;font:inherit;color:inherit;cursor:pointer;width:100%", onclick: open("profile") },
      el("div", { class: "av-edit" }, avatar(S.user.uid, S.name, 96)),
      el("div", { class: "stack", style: "gap:2px;min-width:0" }, el("h1", { style: "overflow-wrap:anywhere" }, "@" + S.name),
        el("span", { class: "hint" }, "Tap your picture for your profile"))),
    el("div", { class: "stats four" },
      el("div", null, el("b", null, String(mine.length)), el("span", null, "Catches")),
      el("div", null, el("b", null, String(mine.reduce((n, x) => n + (S.likes.get(x.id)?.size || 0), 0))), el("span", null, "Likes")),
      el("div", null, el("b", null, biggest ? fmtLb(biggest) : "–"), el("span", null, "Biggest")),
      el("div", null, el("b", null, String(pins)), el("span", null, "Map pins"))),
    (() => { const r = schRank(sch().xp), nx = schNext(); return el("button", { class: "sch-me", type: "button", id: "me-school", onclick: () => { S.sch = { v: "home" }; S.meView = "school"; renderTab(); } },
      el("span", { class: "sch-badge" }, r.icon), el("span", { class: "stack", style: "gap:2px;text-align:left;flex:1;min-width:0" }, el("b", null, "🎓 Fishing school"), el("span", { class: "hint" }, `${r.title} · ${sch().xp} XP${nx ? " · " + nx.text : ""}`)), el("span", { class: "label" }, "›")); })(),
    el("button", { class: "sch-me", type: "button", id: "me-game", onclick: openFishGame },
      el("span", { class: "sch-badge" }, "🎣"), el("span", { class: "stack", style: "gap:2px;text-align:left;flex:1;min-width:0" }, el("b", null, "Fishing game"), el("span", { class: "hint" }, `Level ${fcLevel()} · 🪙 ${fcCoins()} · cast, hook and reel`)), el("span", { class: "label" }, "›")),
    wrapSeason() ? el("button", { class: "sch-me", type: "button", id: "me-wrap", onclick: () => openWrapped(wrapYear()) },
      el("span", { class: "sch-badge" }, "🎞️"), el("span", { class: "stack", style: "gap:2px;text-align:left;flex:1;min-width:0" }, el("b", null, "Your year in fish"), el("span", { class: "hint" }, `${wrapYear()} recap · tap to watch`)), el("span", { class: "label" }, "›")) : null,
    el("button", { class: "btn wide share-btn", type: "button", id: "me-share", onclick: shareApp }, "📤 Share Weigh-In with friends"),
    el("div", { class: "list" },
      el("button", { class: "item", type: "button", id: "me-new", onclick: () => openWhatsNew(renderTab) },
        el("span", { class: "row", style: "gap:10px" }, el("span", { class: "t" }, "🔔 Release notes"), unseenUpdate() ? el("span", { class: "pill live" }, "New") : null), el("span", { class: "label" }, "›")),
      el("button", { class: "item", type: "button", onclick: open("friends") },
        el("span", { class: "row", style: "gap:10px" }, el("span", { class: "t" }, "Friends and chat"), S.reqIn.length + S.unread.size ? el("span", { class: "pill live" }, `${S.reqIn.length + S.unread.size} new`) : null), el("span", { class: "label" }, "›")),
      el("button", { class: "item", type: "button", id: "me-water", onclick: open("water") }, el("span", { class: "t" }, "🔍 Gate keep finder"), el("span", { class: "label" }, "›")),
      el("button", { class: "item", type: "button", onclick: open("log") }, el("span", { class: "t" }, "My fishing log"), el("span", { class: "label" }, "›")),
      el("button", { class: "item", type: "button", onclick: open("settings") }, el("span", { class: "t" }, "Settings"), el("span", { class: "label" }, "›"))),
    yearsSection()
  );
}
function yearsSection() {
  const cur = new Date().getFullYear(), by = new Map();
  for (const x of S.mine) { const y = new Date(catchMs(x)).getFullYear(); by.set(y, (by.get(y) || 0) + 1); }
  const ys = [...by.keys()].filter((y) => y < cur || (y === wrapYear() && wrapSeason())).sort((a, b) => b - a);
  if (!ys.length) return null;
  return el("div", { class: "stack", id: "me-years" }, el("h2", null, "Your years"),
    el("div", { class: "list" }, ys.map((y) => el("button", { class: "item", type: "button", "data-year": String(y), onclick: () => openWrapped(y) },
      el("span", { class: "t" }, `🎞️ ${y}`), el("span", { class: "label" }, `${by.get(y)} ${by.get(y) === 1 ? "catch" : "catches"} ›`)))));
}

function viewProfile(p) {
  const mine = [...S.mine].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  const biggest = Math.max(0, ...mine.map((x) => x.lb || 0));
  const pins = S.spots.filter((s) => s.uid === S.user.uid).length;
  p.append(backBtn("‹ Me"),
    el("div", { class: "profile-head" },
      el("div", { class: "av-edit" }, avatar(S.user.uid, S.name, 96), photoInput("me-photo", "Change profile picture")),
      el("div", { class: "stack", style: "gap:2px;min-width:0" }, el("h1", { style: "overflow-wrap:anywhere" }, "@" + S.name),
        el("span", { class: "hint" }, "Tap your picture to change it"))),
    el("div", { class: "stats four" },
      el("div", null, el("b", null, String(mine.length)), el("span", null, "Catches")),
      el("div", null, el("b", null, String(mine.reduce((n, x) => n + (S.likes.get(x.id)?.size || 0), 0))), el("span", null, "Likes")),
      el("div", null, el("b", null, biggest ? fmtLb(biggest) : "–"), el("span", null, "Biggest")),
      el("div", null, el("b", null, String(pins)), el("span", null, "Map pins"))),
    el("div", { class: "list" },
      el("button", { class: "item", type: "button", id: "me-name", onclick: () => openNameSheet(renderTab) }, el("span", { class: "t" }, "✏️ Change name"), el("span", { class: "label" }, "@" + S.name)),
      el("button", { class: "item", type: "button", id: "me-cash", onclick: () => openCashSheet(renderTab) }, el("span", { class: "t" }, "💵 Cash App"), el("span", { class: "label" }, cashTag(S.cash) || "Add"))),
    el("h2", null, "My catches"));
  if (!mine.length) { p.append(el("p", { class: "empty" }, "You haven't posted a catch yet. Tap the red Post button.")); return; }
  p.append(el("div", { class: "list" }, mine.map((c) => el("div", { class: "item", style: "cursor:default" },
    el("div", { class: "row", style: "gap:12px;flex-wrap:nowrap;min-width:0" },
      c.photo ? el("img", { src: c.photo, alt: "", style: "width:56px;height:56px;object-fit:cover;border-radius:8px;flex:none" }) : null,
      el("div", { class: "stack", style: "gap:2px;min-width:0" }, el("span", { class: "t" }, `${c.species}, ${sizeText(c)}`),
        el("span", { class: "s" }, `${c.lure ? "on " + c.lure + " · " : ""}${catchLabel(c)} · ♥ ${S.likes.get(c.id)?.size || 0}`))),
    el("button", { class: "link danger small", type: "button", onclick: () => deletePost(c) }, "Delete")))));
}

function viewSettings(p) {
  const prec = el("select", { id: "s-prec", onchange: () => setPref("prec", prec.value) },
    el("option", { value: "approx" }, "Approximate area (about 1 km)"), el("option", { value: "exact" }, "Exact spot"));
  prec.value = getPref("prec", "approx");
  p.append(backBtn("‹ Me"), el("h1", null, "Settings"),
    isStaff() ? el("section", { class: "stack" }, el("h2", null, S.owner ? "Owner" : "Moderator"),
      el("button", { class: "item", type: "button", id: "me-owner", onclick: () => { S.meView = "owner"; renderTab(); } }, el("span", { class: "t" }, S.owner ? "Owner tools" : "Moderator tools"), el("span", { class: "label" }, S.editMode ? "Edit mode ON" : "›"))) : null,
    el("section", { class: "stack", id: "s-theme" }, el("h2", null, "Appearance"),
      el("div", { class: "list" }, THEMES.map(([k, name, sub]) => el("button", { class: "item", type: "button", "data-theme": k, onclick: () => { setPref("theme", k); applyTheme(); renderTab(); } },
        el("span", { class: "stack", style: "gap:0;text-align:left" }, el("span", { class: "t" }, name), el("span", { class: "hint" }, sub)),
        el("span", { class: "label" }, (getPref("theme", "auto") === k ? "✓ On" : "")))))),
    el("section", { class: "stack" }, el("h2", null, "Install the app"),
      isInstalled() ? el("p", { class: "muted" }, "You're using the installed app.")
        : el("button", { class: "btn wide", type: "button", id: "s-install", onclick: installApp }, "Install Weigh-In on this device"),
      isInstalled() ? null : el("span", { class: "hint" }, "Puts a Weigh-In icon on your home screen or desktop so it opens like a normal app.")),
    el("section", { class: "stack" }, el("h2", null, "Profile picture"),
      el("div", { class: "row", style: "gap:14px" }, avatar(S.user.uid, S.name, 64),
        el("label", { class: "btn ghost small", style: "position:relative;overflow:hidden" }, "Change picture", photoInput("set-photo", "Change profile picture")),
        el("button", { class: "link", type: "button", onclick: clearMyPhoto }, "Remove"))),
    el("section", { class: "stack" }, el("h2", null, "Account"),
      el("div", { class: "kv" }, el("span", null, "Angler name"), el("b", null, "@" + S.name)),
      el("div", { class: "kv" }, el("span", null, "Email"), el("b", null, auth.currentUser?.email || "")),
      el("span", { class: "hint" }, "Change your name in your profile (tap your picture in Me)."),
      el("button", { class: "btn ghost small", type: "button", style: "align-self:flex-start", onclick: async () => {
        try { await sendPasswordResetEmail(auth, auth.currentUser.email); toast("Check your email for a reset link."); } catch (e) { toast(errText(e)); }
      } }, "Email me a password reset link")),
    el("section", { class: "stack" }, el("h2", null, "Map pins"),
      el("label", { class: "field" }, el("span", null, "How exact should my pins be?"), prec,
        el("span", { class: "hint" }, "A pin only goes on the map when you tap “Add my location” on a post. Deleting a post removes its pin.")),
      el("span", { class: "hint" }, "Everyone using Weigh-In can see map pins. Skip the location for your home or a secret spot.")),
    el("section", { class: "stack" },
      el("button", { class: "btn ghost wide", type: "button", id: "s-about", onclick: openPrivacy }, "About and privacy"),
      el("button", { class: "btn wide", type: "button", onclick: () => { if (confirm("Sign out of Weigh-In?")) signOut(auth); } }, "Sign out")),
    el("p", { class: "hint", id: "s-ver" }, `Weigh-In beta version ${APP_VERSION}`),
    el("p", { class: "hint" }, "Weigh-In is free. Don't post personal info like your address or school."));
}


/* ======================= install the app ======================= */
let installEvt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; });
window.addEventListener("appinstalled", () => { installEvt = null; toast("Installed! Look for Weigh-In on your home screen."); });
const isInstalled = () => { try { return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; } catch { return false; } };
async function installApp() {
  if (installEvt) {
    const e = installEvt; installEvt = null;
    try { e.prompt(); await e.userChoice; } catch { /* closed */ }
    return;
  }
  openInstallHelp();
}
function openInstallHelp() {
  const ua = navigator.userAgent || "";
  const ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const android = /android/i.test(ua);
  const steps = ios
    ? ["Open this page in Safari. It won't work from inside another app.", "Tap the Share button, the square with an arrow pointing up.", "Scroll down and tap Add to Home Screen.", "Tap Add. Weigh-In now has an icon like any other app."]
    : android
      ? ["Open this page in Chrome.", "Tap the ⋮ menu at the top right.", "Tap Install app (or Add to Home screen).", "Tap Install."]
      : ["Use Chrome or Edge.", "Click the install icon at the right end of the address bar. It looks like a small screen with a down arrow.", "If you don't see it, open the ⋮ menu and choose Install Weigh-In (or Cast, save, and share, then Install page as app)."];
  const close = () => bg.remove();
  const bg = el("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg) close(); } },
    el("div", { class: "sheet", role: "dialog", "aria-label": "Install the app", style: "height:auto;max-height:90%" },
      el("div", { class: "sheet-h" }, el("h2", null, "Install Weigh-In"), el("button", { class: "link", type: "button", onclick: close }, "Close")),
      el("div", { class: "msgs about" },
        el("p", { class: "muted" }, "Your browser doesn't let a button do this automatically, so here are the steps:"),
        el("ol", { style: "margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px" }, steps.map((x) => el("li", null, x))))));
  document.body.append(bg);
}


/* ======================= LAKE DUEL (cast, hook, reel) ======================= */
const FC_LOCS = [
  { id: "pond", n: "Pond", lvl: 1, hard: 0, stars: 1, sky: ["#ffe2b0", "#d6ecf2"], water: ["#4aa6b9", "#1d6577"], fish: ["Bluegill", "Largemouth bass", "Channel catfish"] },
  { id: "creek", n: "Mill creek", lvl: 2, lic: 1, hard: 0.08, stars: 2, like: "river", sky: ["#ffe0b8", "#dbeee8"], water: ["#5aa89a", "#1d5a50"], fish: ["Rainbow trout", "Smallmouth bass", "Bluegill", "Common carp"] },
  { id: "lake", n: "Lake", lvl: 3, lic: 1, hard: 0.05, stars: 2, sky: ["#bcd0ff", "#e3f0f5"], water: ["#3a7fb0", "#123e5f"], fish: ["Crappie", "Largemouth bass", "Walleye", "Northern pike", "Muskellunge"] },
  { id: "reservoir", n: "Big reservoir", lvl: 4, lic: 1, hard: 0.1, stars: 2, like: "lake", sky: ["#c9d7f2", "#eaf1f4"], water: ["#4a86a8", "#173d57"], fish: ["Crappie", "Walleye", "Largemouth bass", "Channel catfish", "Common carp"] },
  { id: "river", n: "River", lvl: 5, lic: 1, hard: 0.15, stars: 3, sky: ["#ffcfae", "#f1e6d6"], water: ["#4b9a8a", "#17463f"], fish: ["Rainbow trout", "Smallmouth bass", "Channel catfish", "Common carp", "Muskellunge"] },
  { id: "muskie", n: "Northwoods lake", lvl: 6, lic: 1, hard: 0.18, stars: 3, like: "lake", sky: ["#b9c6e8", "#dfe6ea"], water: ["#2f6f86", "#0d3040"], fish: ["Northern pike", "Muskellunge", "Walleye", "Smallmouth bass", "Lake trout"] },
  { id: "bay", n: "Salt bay", lvl: 7, lic: 2, hard: 0.2, stars: 4, salt: true, sky: ["#9fd8ff", "#f6efe0"], water: ["#35b5c4", "#0f5c75"], fish: ["Redfish", "Flounder", "Spotted seatrout", "Snook"] },
  { id: "flats", n: "Mangrove flats", lvl: 8, lic: 2, hard: 0.24, stars: 4, salt: true, like: "bay", sky: ["#a7dcff", "#f4ecd8"], water: ["#4fc0b4", "#176a69"], fish: ["Snook", "Redfish", "Tarpon", "Spotted seatrout", "Flounder"] },
  { id: "great", n: "Great Lake", lvl: 8, lic: 1, hard: 0.22, stars: 4, big: true, like: "lake", sky: ["#a9c1f0", "#e2ecf5"], water: ["#2c6aa6", "#0b2c52"], fish: ["Lake trout", "Walleye", "Northern pike", "Rainbow trout", "White sturgeon"] },
  { id: "ocean", n: "Open ocean", lvl: 9, lic: 2, hard: 0.28, stars: 5, salt: true, sky: ["#8ec5f5", "#dcefff"], water: ["#1f78b4", "#082b52"], fish: ["Mahi-mahi", "King mackerel", "Tarpon", "Yellowfin tuna"] },
  { id: "canyon", n: "Deep blue canyon", lvl: 11, lic: 2, hard: 0.34, stars: 5, salt: true, like: "ocean", sky: ["#7fb6ee", "#cfe6ff"], water: ["#134f9a", "#041c3d"], fish: ["Yellowfin tuna", "Mahi-mahi", "Sailfish", "Blue marlin", "King mackerel"] },
  { id: "glacier", n: "Glacier lake", lvl: 13, lic: 1, hard: 0.3, stars: 5, like: "lake", sky: ["#c8e2ff", "#f0f8ff"], water: ["#3aa0c8", "#0e4668"], fish: ["Arctic char", "Lake trout", "Northern pike", "White sturgeon", "Muskellunge"] },
  { id: "delta", n: "Delta river", lvl: 15, lic: 1, hard: 0.33, stars: 5, like: "river", sky: ["#ffc9a0", "#f6ead2"], water: ["#6a9a6a", "#26452e"], fish: ["Channel catfish", "Common carp", "White sturgeon", "Muskellunge", "Smallmouth bass"] },
  { id: "reef", n: "Coral reef", lvl: 17, lic: 2, hard: 0.36, stars: 5, salt: true, like: "bay", sky: ["#8fd8ff", "#fdf3da"], water: ["#2ed0c8", "#0b6a86"], fish: ["Giant trevally", "Snook", "Redfish", "Mahi-mahi", "Wahoo", "Sailfish"] },
  { id: "gulf", n: "Gulf stream", lvl: 20, lic: 2, hard: 0.4, stars: 5, salt: true, like: "ocean", sky: ["#6fa8e8", "#c7e0fb"], water: ["#0f5fa8", "#031a3a"], fish: ["Wahoo", "Blue marlin", "Sailfish", "Yellowfin tuna", "Giant trevally", "Mahi-mahi"] },
  { id: "lagoon", n: "Legend's lagoon", lvl: 25, lic: 2, hard: 0.45, stars: 5, salt: true, like: "bay", sky: ["#ffb98a", "#ffe8c4"], water: ["#1fb0b8", "#06384f"], fish: ["Tarpon", "Blue marlin", "Sailfish", "Yellowfin tuna", "Giant trevally"] }];
const FC_LURES = [["spinner", "Spinner"], ["worm", "Worm"], ["crank", "Crankbait"], ["jig", "Minnow jig"]];
/* Gear you buy, roughly in the order a real angler would: licence first, then
   basic tackle, then proper gear, then the expensive kit once you've put in the hours. */
const FC_GEAR = [
  { id: "license", g: "Licences and permits", n: "Fishing licence", icon: "📜", base: "No licence",
    names: ["Resident freshwater licence", "Saltwater endorsement", "Lifetime licence"], costs: [60, 450, 3500],
    eff: (l) => ["You may only fish the practice pond.", "Lets you fish the lake and the river", "Adds the salt bay and the open ocean", "Never expires, and buyers pay 15% more"][l] },
  { id: "tackle", g: "Starter tackle", n: "Tackle box", icon: "🧰", base: "Loose gear in a bag",
    names: ["Plastic tray", "Two-tray box", "Tackle backpack"], costs: [80, 280, 850], req: { catches: 1 },
    eff: (l) => l ? `The right lure for the day: better chance at bigger fish (+${l})` : "You fish whatever you happen to have." },
  { id: "hook", g: "Starter tackle", n: "Hooks", icon: "🪝", base: "Blunt hooks",
    names: ["Bronze hooks", "Sharpened hooks", "Circle hooks"], costs: [70, 240, 700],
    eff: (l) => l ? `You get ${Math.round(l * 30)}% longer to set the hook` : "You have to be quick." },
  { id: "line", g: "Starter tackle", n: "Fishing line", icon: "🧵", base: "Old 6 lb line",
    names: ["8 lb mono", "12 lb mono", "20 lb braid", "40 lb braid", "80 lb big-game braid"], costs: [120, 350, 900, 2200, 5500],
    eff: (l) => l ? `Takes ${Math.round(l * 9)}% more pull before it snaps` : "Snaps easily. Big fish will break it." },
  { id: "bait", g: "Starter tackle", n: "Bait and scent", icon: "🪱", base: "Bare lure",
    names: ["Nightcrawlers", "Live minnows", "Pro scent"], costs: [90, 300, 900], req: { catches: 3 },
    eff: (l) => l ? `Fish bite about ${Math.round(l * 18)}% sooner` : "Fish take their time." },
  { id: "gloves", g: "Proper gear", n: "Grip gloves", icon: "🧤", base: "Bare hands",
    names: ["Cloth gloves", "Rubber grip gloves", "Pro angler gloves"], costs: [150, 500, 1500], req: { catches: 5 },
    eff: (l) => l ? `Line builds ${Math.round(l * 7)}% slower while you reel` : "Your hands slip on the handle." },
  { id: "net", g: "Proper gear", n: "Landing net", icon: "🥅", base: "No net",
    names: ["Small net", "Rubber net", "Big-game net"], costs: [300, 950, 2800], req: { catches: 10 },
    eff: (l) => l ? `${l * 20}% chance to save a fish that gets off` : "Lost fish are gone for good." },
  { id: "rod", g: "Proper gear", n: "Rod", icon: "🎣", base: "Starter rod",
    names: ["Fiberglass rod", "Graphite spinning rod", "Baitcasting rod", "Tournament carbon rod"], costs: [200, 650, 1800, 4500], req: { catches: 10 },
    eff: (l) => l ? `Reels ${Math.round(l * 18)}% faster, line builds ${Math.round(l * 13)}% slower` : "A plain rod. Does the job." },
  { id: "reel", g: "Proper gear", n: "Reel", icon: "🌀", base: "Plastic reel",
    names: ["Spinning reel", "Sealed bearing reel", "High-speed baitcaster"], costs: [300, 950, 2600], req: { catches: 15 },
    eff: (l) => l ? `Brings fish in ${Math.round(l * 12)}% faster` : "Slow and creaky." },
  { id: "cooler", g: "Proper gear", n: "Cooler", icon: "🧊", base: "Small bag",
    names: ["Cool bag", "Big cooler", "Ice chest", "Live well"], costs: [250, 800, 2200, 5500], req: { catches: 12 },
    eff: (l) => `Holds ${40 + l * 30} fish` },
  { id: "log", g: "Proper gear", n: "Logbook", icon: "📓", base: "No logbook",
    names: ["Pocket logbook", "Leather logbook", "Captain's logbook"], costs: [300, 1000, 2800], req: { catches: 20 },
    eff: (l) => l ? `You learn from your notes: ${l * 20}% more XP` : "No notes, no extra XP." },
  { id: "drag", g: "Experienced angler", n: "Drag system", icon: "🛞", base: "No drag",
    names: ["Basic drag", "Smooth drag", "Carbon fibre drag"], costs: [350, 1100, 3200], req: { catches: 25 },
    eff: (l) => l ? `Fish gain ${Math.round(l * 15)}% less ground when they run` : "Runs cost you a lot of line." },
  { id: "glasses", g: "Experienced angler", n: "Polarized glasses", icon: "🕶️", base: "No glasses",
    names: ["Basic polarized", "Pro lenses"], costs: [400, 1200], req: { catches: 25 },
    eff: (l) => ["You can't see into the water.", "You can tell how big the shadow is", "You can also guess its weight"][l] },
  { id: "waders", g: "Experienced angler", n: "Waders", icon: "🥾", base: "Fishing from the bank",
    names: ["Hip waders", "Chest waders"], costs: [600, 1800], req: { catches: 30 },
    eff: (l) => l ? `Wade out to better water: ${l * 7}% better chance at rare fish` : "You can only reach the edges." },
  { id: "scale", g: "Experienced angler", n: "Certified scale", icon: "📏", base: "You guess the weight",
    names: ["Digital scale", "Tournament scale"], costs: [500, 1800], req: { trophies: 1 },
    eff: (l) => l ? `Buyers trust your weights: ${l * 15}% more coins` : "Buyers knock the price down." },
  { id: "charm", g: "Experienced angler", n: "Lucky charm", icon: "🍀", base: "No charm",
    names: ["Rabbit's foot", "Old fishing medal", "Grandpa's lucky lure"], costs: [600, 1800, 5000], req: { catches: 50 },
    eff: (l) => l ? `Better chance at bigger fish (+${l})` : "No luck on your side." },
  { id: "finder", g: "Serious kit", n: "Fish finder", icon: "📡", base: "No finder",
    names: ["Portable sonar", "Colour sonar", "Live sonar"], costs: [1500, 4000, 9000], req: { catches: 50, lvl: 6 },
    eff: (l) => ["You can't tell what is down there.", "Shows how big the shadow is", "Shows a weight guess too", "Names the fish before you hook it"][l] },
  { id: "boat", g: "Serious kit", n: "Boat", icon: "🚤", base: "Fishing from shore",
    names: ["Kayak", "Jon boat with motor", "Bass boat", "Offshore boat"], costs: [2500, 6000, 14000, 30000], req: { catches: 100, lvl: 8 },
    eff: (l) => l ? `Reach open water: ${l * 8}% better chance at rare fish` : "You can only reach the edges." },
  { id: "gps", g: "Serious kit", n: "GPS and charts", icon: "🗺️", base: "No charts",
    names: ["Handheld GPS", "Chartplotter"], costs: [2000, 6000], req: { gear: ["boat", 1] },
    eff: (l) => l ? `You remember the good spots: fish bite ${l * 12}% sooner` : "You hunt for spots the hard way." }];
/* Everything costs 3x what it used to, and every item now has high tiers that need a level too. */
FC_GEAR.forEach((it) => { it.costs = it.costs.map((c) => Math.round(c * 3 / 10) * 10); it.tl = it.costs.map(() => 0); });
const FC_EXT = {
  rod: [["Pro tournament rod", 14000, 10], ["Master-built rod", 36000, 18]], reel: [["Pro baitcaster", 12000, 9], ["Big-game reel", 30000, 16]],
  line: [["120 lb dyneema", 18000, 12], ["Deep-sea 200 lb line", 42000, 20]], drag: [["Pro drag", 14000, 11]], gloves: [["Titanium-grip gloves", 9000, 8]],
  hook: [["Chemically sharpened hooks", 6000, 7]], bait: [["Secret-recipe bait", 8000, 9]], tackle: [["Pro tackle bag", 9000, 8]],
  charm: [["Champion's lucky coin", 16000, 14]], net: [["Pro landing net", 12000, 10]], cooler: [["Walk-in freezer", 16000, 9], ["Fish hold", 32000, 16]],
  log: [["Master's journal", 12000, 10]], waders: [["Neoprene pro waders", 9000, 9]], scale: [["Master scale", 9000, 11]],
  boat: [["Sport fisher", 180000, 14], ["Luxury charter yacht", 420000, 22]], gps: [["Satellite navigation", 30000, 12]] };
for (const id in FC_EXT) { const it = FC_GEAR.find((x) => x.id === id); for (const [n, c, l] of FC_EXT[id]) { it.names.push(n); it.costs.push(c); it.tl.push(l); } }
const FC_GROUPS = ["Licences and permits", "Starter tackle", "Proper gear", "Experienced angler", "Serious kit"];

/* Things you only get by playing. Each one pays out once. */
const FC_ACH = [
  { id: "first", n: "Wet a line", d: "Land your first fish", coins: 50, p: (S) => [S.catches, 1] },
  { id: "c10", n: "Weekend angler", d: "Land 10 fish", coins: 120, p: (S) => [S.catches, 10] },
  { id: "c25", n: "Getting the hang of it", d: "Land 25 fish", coins: 300, p: (S) => [S.catches, 25] },
  { id: "c50", n: "Serious angler", d: "Land 50 fish", coins: 700, p: (S) => [S.catches, 50] },
  { id: "c100", n: "Veteran", d: "Land 100 fish", coins: 1800, p: (S) => [S.catches, 100] },
  { id: "c250", n: "Lifer", d: "Land 250 fish", coins: 5000, p: (S) => [S.catches, 250] },
  { id: "sp5", n: "Mixed bag", d: "Catch 5 different kinds of fish", coins: 200, p: (S) => [S.species, 5] },
  { id: "sp10", n: "Collector", d: "Catch 10 different kinds of fish", coins: 600, p: (S) => [S.species, 10] },
  { id: "spAll", n: "Master angler", d: "Catch every kind of fish", coins: 4000, p: (S) => [S.species, Object.keys(FC_FISH).length] },
  { id: "t1", n: "Trophy hunter", d: "Land your first trophy fish", coins: 250, p: (S) => [S.trophies, 1] },
  { id: "t10", n: "Wall of fame", d: "Land 10 trophy fish", coins: 1200, p: (S) => [S.trophies, 10] },
  { id: "big20", n: "Heavyweight", d: "Land a fish over 20 lb", coins: 400, p: (S) => [Math.min(S.biggest, 20), 20] },
  { id: "big50", n: "Monster", d: "Land a fish over 50 lb", coins: 1500, p: (S) => [Math.min(S.biggest, 50), 50] },
  { id: "sold1k", n: "Market day", d: "Earn 1,000 coins selling fish", coins: 300, p: (S) => [S.earned, 1000] },
  { id: "sold10k", n: "Fishmonger", d: "Earn 10,000 coins selling fish", coins: 2000, p: (S) => [S.earned, 10000] },
  { id: "cast100", n: "Hours on the water", d: "Make 100 casts", coins: 250, p: (S) => [S.casts, 100] },
  { id: "cast500", n: "Dawn till dusk", d: "Make 500 casts", coins: 1500, p: (S) => [S.casts, 500] },
  { id: "duel1", n: "Competitor", d: "Win a duel", coins: 200, p: (S) => [S.duelWins, 1] },
  { id: "duel10", n: "Tournament angler", d: "Win 10 duels", coins: 1500, p: (S) => [S.duelWins, 10] },
  { id: "fresh", n: "Explorer", d: "Fish the pond, the lake and the river", coins: 500, p: (S) => [["pond", "lake", "river"].filter((x) => S.places.includes(x)).length, 3] },
  { id: "c500", n: "Legend of the lake", d: "Land 500 fish", coins: 12000, p: (S) => [S.catches, 500] },
  { id: "c1000", n: "Fishing machine", d: "Land 1000 fish", coins: 40000, p: (S) => [S.catches, 1000] },
  { id: "sp20", n: "Field guide", d: "Catch 20 different kinds of fish", coins: 3000, p: (S) => [S.species, 20] },
  { id: "t25", n: "Trophy room", d: "Land 25 trophy fish", coins: 4000, p: (S) => [S.trophies, 25] },
  { id: "t50", n: "Hall of fame", d: "Land 50 trophy fish", coins: 12000, p: (S) => [S.trophies, 50] },
  { id: "big100", n: "Leviathan", d: "Land a fish over 100 lb", coins: 4000, p: (S) => [Math.min(S.biggest, 100), 100] },
  { id: "big250", n: "Sea monster", d: "Land a fish over 250 lb", coins: 15000, p: (S) => [Math.min(S.biggest, 250), 250] },
  { id: "sold50k", n: "Tycoon", d: "Earn 50,000 coins selling fish", coins: 6000, p: (S) => [S.earned, 50000] },
  { id: "sold250k", n: "Fishing empire", d: "Earn 250,000 coins selling fish", coins: 25000, p: (S) => [S.earned, 250000] },
  { id: "lv10", n: "Double digits", d: "Reach level 10", coins: 1500, p: (S) => [S.level, 10] },
  { id: "lv20", n: "Captain's hat", d: "Reach level 20", coins: 6000, p: (S) => [S.level, 20] },
  { id: "lv30", n: "Living legend", d: "Reach level 30", coins: 20000, p: (S) => [S.level, 30] },
  { id: "tour30", n: "Circuit veteran", d: "Enter 30 daily tournaments", coins: 4000, p: (S) => [S.tEnt, 30] },
  { id: "tw10", n: "Cup dynasty", d: "Win 10 daily tournaments", coins: 8000, p: (S) => [S.tWins, 10] },
  { id: "places6", n: "Well travelled", d: "Fish at 6 different places", coins: 600, p: (S) => [S.places.length, 6] },
  { id: "placesAll", n: "Seen it all", d: "Fish at every place", coins: 2500, p: (S) => [S.places.length, FC_LOCS.length] },
  { id: "tour1", n: "Tournament rookie", d: "Enter a daily tournament", coins: 150, p: (S) => [S.tEnt, 1] },
  { id: "tour10", n: "On the circuit", d: "Enter 10 daily tournaments", coins: 800, p: (S) => [S.tEnt, 10] },
  { id: "pod1", n: "On the podium", d: "Finish top 3 in a daily tournament", coins: 600, p: (S) => [S.tPodium, 1] },
  { id: "tw1", n: "Cup champion", d: "Win a daily tournament", coins: 1500, p: (S) => [S.tWins, 1] },
  { id: "salt", n: "Salty", d: "Fish in salt water", coins: 800, p: (S) => [["bay", "ocean"].filter((x) => S.places.includes(x)).length ? 1 : 0, 1] }];

const fcStatsRaw = () => { try { return JSON.parse(getPref("fcstats", "{}")) || {}; } catch { return {}; } };
function fcStat(k, add) { const st = fcStatsRaw(); st[k] = (+st[k] || 0) + add; setPref("fcstats", JSON.stringify(st)); }
function fcMarkPlace(id) { const st = fcStatsRaw(), p = Array.isArray(st.places) ? st.places : []; if (!p.includes(id)) { p.push(id); st.places = p; setPref("fcstats", JSON.stringify(st)); } }
function fcStats() {
  const d = fcDex(), st = fcStatsRaw(), vals = Object.values(d);
  return { catches: vals.reduce((a, x) => a + (x.n || 0), 0), species: Object.keys(d).length,
    biggest: vals.length ? Math.max(...vals.map((x) => x.best || 0)) : 0,
    trophies: +st.trophies || 0, earned: +st.earned || 0, casts: +st.casts || 0, duelWins: +st.duelWins || 0, tEnt: +st.tEnt || 0, tPodium: +st.tPodium || 0, tWins: +st.tWins || 0,
    places: Array.isArray(st.places) ? st.places : [], level: fcLevel() };
}
const fcAchDone = () => { try { return JSON.parse(getPref("fcach", "[]")) || []; } catch { return []; } };
const fcHasAch = (id) => fcAchDone().includes(id);
/* Pays out anything newly finished. Returns the ones it just paid. */
function fcCheckAch() {
  const S = fcStats(), done = fcAchDone(), fresh = [];
  for (const a of FC_ACH) { if (done.includes(a.id)) continue; const [have, need] = a.p(S); if (have >= need) { done.push(a.id); fresh.push(a); } }
  if (fresh.length) { setPref("fcach", JSON.stringify(done)); setPref("fccoins", String(fcCoins() + fresh.reduce((x, a) => x + a.coins, 0))); }
  return fresh;
}
/* null when you can buy it, otherwise what you still have to do. */
function fcLocked(it, S) {
  const r = it.req; if (!r) return null;
  if (r.catches && S.catches < r.catches) return `Catch ${r.catches} fish first (${S.catches}/${r.catches})`;
  if (r.trophies && S.trophies < r.trophies) return `Land a trophy fish first`;
  if (r.lvl && S.level < r.lvl) return `Reach level ${r.lvl} (you're ${S.level})`;
  if (r.gear) { const [g, l] = r.gear, o = FC_GEAR.find((x) => x.id === g); if (fcUp(g) < l) return `Get a ${o.n.toLowerCase()} first`; }
  return null;
}
const FC_LURE_COST = [360, 1200, 5000], FC_LURE_TAG = ["", " Pro", " Master", " Legend"];
const FC_FISH = {
  "Bluegill": { min: 0.3, max: 1.6, r: 15, asp: 0.74, top: "#5b7f5a", belly: "#e8a24a", fin: "#4a6a8a", pat: "bars", patc: "rgba(20,40,60,.28)", ear: true, price: 30, w: { spinner: 1, worm: 3, crank: 0.4, jig: 2 } },
  "Largemouth bass": { min: 1, max: 9, r: 22, asp: 0.5, top: "#58742f", belly: "#e6e7c8", fin: "#6a8a3a", pat: "stripe", patc: "#2b3a17", price: 22, w: { spinner: 2, worm: 2, crank: 3, jig: 1 } },
  "Channel catfish": { min: 1, max: 14, r: 26, asp: 0.42, top: "#6d7478", belly: "#d9d6c9", fin: "#59605f", pat: "spots", patc: "rgba(30,35,35,.4)", whisk: true, price: 14, w: { spinner: 0.5, worm: 3, crank: 0.5, jig: 1 } },
  "Crappie": { min: 0.4, max: 2.5, r: 17, asp: 0.7, top: "#9aa98a", belly: "#f0efe0", fin: "#8b9b7c", pat: "spots", patc: "#3b4533", price: 28, w: { spinner: 1, worm: 1, crank: 0.5, jig: 3 } },
  "Walleye": { min: 1.5, max: 10, r: 24, asp: 0.44, top: "#a08d3a", belly: "#efe9c8", fin: "#8d7b2f", pat: "saddles", patc: "#4d4420", bigEye: true, price: 30, w: { spinner: 1, worm: 1, crank: 3, jig: 2 } },
  "Northern pike": { min: 2, max: 20, r: 30, asp: 0.3, top: "#5d7a3a", belly: "#e7e6c4", fin: "#7a8f45", pat: "bean", patc: "#cdd59a", jaw: true, price: 20, w: { spinner: 2, worm: 0.5, crank: 3, jig: 1 } },
  "Rainbow trout": { min: 0.5, max: 8, r: 21, asp: 0.44, top: "#8fa3a0", belly: "#f1ece4", fin: "#9fb0ad", pat: "speckle", patc: "#2f3a38", price: 26, w: { spinner: 3, worm: 1.5, crank: 1, jig: 2 } },
  "Smallmouth bass": { min: 0.8, max: 6, r: 21, asp: 0.5, top: "#8c7440", belly: "#e9e1c2", fin: "#7a6535", pat: "bars", patc: "rgba(60,40,15,.45)", price: 24, w: { spinner: 2, worm: 2, crank: 2, jig: 2 } },
  "Common carp": { min: 2, max: 25, r: 29, asp: 0.58, top: "#b08a3a", belly: "#e8d7a0", fin: "#a37a30", pat: "scales", patc: "rgba(255,255,255,.28)", whisk: true, price: 10, w: { spinner: 0.4, worm: 3, crank: 0.3, jig: 0.6 } },
  "Muskellunge": { min: 5, max: 55, r: 36, asp: 0.27, top: "#5f7a3a", belly: "#e2e0b8", fin: "#7a8b45", pat: "bars", patc: "rgba(40,50,20,.4)", jaw: true, price: 22, pow: 0.1, rare: 0.35, w: { spinner: 2, worm: 0.3, crank: 3, jig: 1 } },
  "Redfish": { min: 2, max: 30, r: 26, asp: 0.45, top: "#b5653a", belly: "#f1e0cf", fin: "#a8532f", pat: "spots", patc: "rgba(40,20,10,.55)", price: 14, w: { spinner: 2, worm: 2, crank: 1.5, jig: 3 } },
  "Flounder": { min: 1, max: 12, r: 24, asp: 0.8, top: "#8a7a5a", belly: "#efe8d8", fin: "#7a6a4a", pat: "spots", patc: "rgba(50,40,20,.45)", price: 20, w: { spinner: 0.5, worm: 1.5, crank: 0.5, jig: 3 } },
  "Spotted seatrout": { min: 1, max: 8, r: 21, asp: 0.4, top: "#8fa0a8", belly: "#f0ede6", fin: "#9fb0b5", pat: "speckle", patc: "#2f3a38", nostripe: true, price: 24, w: { spinner: 2, worm: 1, crank: 2, jig: 3 } },
  "Snook": { min: 2, max: 25, r: 27, asp: 0.34, top: "#a79b5a", belly: "#efe9cf", fin: "#9a8f50", pat: "stripe", patc: "#2b2b2b", jaw: true, price: 22, w: { spinner: 1.5, worm: 0.5, crank: 3, jig: 2 } },
  "Mahi-mahi": { min: 5, max: 50, r: 30, asp: 0.5, top: "#2ea8c0", belly: "#f2d54a", fin: "#3aa8c8", pat: "spots", patc: "rgba(30,90,140,.5)", price: 12, pow: 0.05, w: { spinner: 3, worm: 0.3, crank: 2, jig: 1 } },
  "King mackerel": { min: 5, max: 60, r: 31, asp: 0.28, top: "#5d7f95", belly: "#e6edf0", fin: "#6b8795", pat: "speckle", patc: "rgba(20,40,60,.45)", nostripe: true, jaw: true, price: 9, pow: 0.05, w: { spinner: 3, worm: 0.2, crank: 2, jig: 1 } },
  "Tarpon": { min: 20, max: 130, r: 38, asp: 0.52, top: "#7a8f9a", belly: "#e9eef0", fin: "#8a9aa3", pat: "scales", patc: "rgba(255,255,255,.3)", price: 5, pow: 0.1, rare: 0.7, w: { spinner: 1, worm: 0.3, crank: 2, jig: 3 } },
  "Lake trout": { min: 3, max: 40, r: 28, asp: 0.38, top: "#6e7f72", belly: "#e9ece3", fin: "#7c8c80", pat: "speckle", patc: "rgba(235,240,225,.55)", jaw: true, price: 18, pow: 0.04, w: { spinner: 3, worm: 0.5, crank: 2, jig: 2 } },
  "White sturgeon": { min: 10, max: 150, r: 40, asp: 0.28, top: "#6b6f68", belly: "#d8d4c6", fin: "#5f635c", pat: "scales", patc: "rgba(255,255,255,.18)", whisk: true, price: 6, pow: 0.12, rare: 0.5, w: { spinner: 0.3, worm: 3, crank: 0.3, jig: 1 } },
  "Sailfish": { min: 30, max: 120, r: 38, asp: 0.34, top: "#27537a", belly: "#dfe9ee", fin: "#2d6aa0", pat: "bars", patc: "rgba(150,190,230,.4)", jaw: true, price: 6, pow: 0.12, rare: 0.55, w: { spinner: 2, worm: 0.2, crank: 3, jig: 1 } },
  "Blue marlin": { min: 80, max: 400, r: 42, asp: 0.34, top: "#1b3f7a", belly: "#cfd9e6", fin: "#2a56a0", pat: "bars", patc: "rgba(130,170,230,.35)", jaw: true, price: 3, pow: 0.15, rare: 0.35, w: { spinner: 1, worm: 0.1, crank: 3, jig: 1 } },
  "Arctic char": { min: 2, max: 25, r: 23, asp: 0.42, top: "#4f6b78", belly: "#f08a4b", fin: "#e07a3f", pat: "speckle", patc: "rgba(255,230,200,.6)", price: 24, pow: 0.04, w: { spinner: 3, worm: 1, crank: 1.5, jig: 2 } },
  "Wahoo": { min: 10, max: 100, r: 36, asp: 0.26, top: "#2a6f9a", belly: "#dfe9ee", fin: "#3a7fae", pat: "bars", patc: "rgba(150,200,240,.4)", jaw: true, price: 8, pow: 0.1, rare: 0.6, w: { spinner: 3, worm: 0.1, crank: 3, jig: 1 } },
  "Giant trevally": { min: 8, max: 90, r: 33, asp: 0.5, top: "#6e8794", belly: "#e8edef", fin: "#7d97a5", pat: "scales", patc: "rgba(255,255,255,.25)", price: 8, pow: 0.12, rare: 0.55, w: { spinner: 2, worm: 0.2, crank: 2, jig: 3 } },
  "Yellowfin tuna": { min: 20, max: 140, r: 38, asp: 0.5, top: "#1f3d5a", belly: "#cfd8dc", fin: "#e8c93a", pat: "none", patc: "rgba(0,0,0,0)", price: 6, pow: 0.12, rare: 0.6, w: { spinner: 2, worm: 0.2, crank: 3, jig: 1 } }
};
const fcXp = () => +getPref("fcxp", "0") || 0;
const fcLevel = () => 1 + Math.floor(Math.sqrt(fcXp() / 40));
const fcCoins = () => +getPref("fccoins", "0") || 0;
const fcGear = () => { let g = {}; try { g = JSON.parse(getPref("fcgear", "{}")) || {}; } catch { g = {}; }
  if (g.rod == null) g.rod = +getPref("fcrod", "0") || 0;   // carry over the old rod
  return g; };
const fcUp = (id) => { const it = FC_GEAR.find((x) => x.id === id); return Math.min(it ? it.costs.length : 0, fcGear()[id] || 0); };
const fcBuy = (id) => { const it = FC_GEAR.find((x) => x.id === id), g = fcGear(), l = fcUp(id);
  if (!it || l >= it.costs.length || fcCoins() < it.costs[l] || (it.tl[l] || 0) > fcLevel()) return false;
  setPref("fccoins", String(fcCoins() - it.costs[l])); g[id] = l + 1; setPref("fcgear", JSON.stringify(g)); return true; };
const fcGearName = (it) => { const l = fcUp(it.id); return l ? it.names[l - 1] : it.base; };
const fcRod = () => fcUp("rod");
const fcBagMax = () => 40 + 30 * fcUp("cooler");
const fcLureLv = () => { try { return JSON.parse(getPref("fclv", "{}")) || {}; } catch { return {}; } };
const fcDex = () => { try { return JSON.parse(getPref("fcdex", "{}")) || {}; } catch { return {}; } };
const lbText = (w) => w.toFixed(2) + " lb";
const fcTier = (n, w) => { const f = FC_FISH[n], q = (w - f.min) / (f.max - f.min); return q < 0.12 ? ["Tiny", 1, q] : q < 0.35 ? ["Small", 1, q] : q < 0.6 ? ["Nice size", 1.1, q] : q < 0.85 ? ["Big one", 1.3, q] : ["Trophy", 1.8, q]; };
const fcValue = (n, w) => Math.max(1, Math.round(w * FC_FISH[n].price * fcTier(n, w)[1] * (1 + 0.15 * fcUp("scale") + (fcUp("license") >= 3 ? 0.15 : 0))));
const fcXpFor = (w) => Math.round((Math.round(Math.pow(w, 0.8) * 8) + 5) * (1 + 0.2 * fcUp("log")));
const FC_TITLES = [[1, "Beginner"], [3, "Bank fisher"], [5, "Angler"], [8, "Skilled angler"], [11, "Expert angler"], [14, "Veteran"], [17, "Master angler"], [20, "Captain"], [24, "Grand master"], [28, "Legend"], [33, "Fishing god"]];
const fcTitle = (lv) => { let t = FC_TITLES[0][1]; for (const [l, n] of FC_TITLES) if (lv >= l) t = n; return t; };
/* Every new level pays coins. People who were already playing are not paid for the past. */
function fcCheckLevel() {
  const lv = fcLevel(), paid = +getPref("fclvpaid", "0") || 0;
  if (!paid) { setPref("fclvpaid", String(lv)); return []; }
  if (lv <= paid) return [];
  let c = 0; for (let l = paid + 1; l <= lv; l++) c += 40 * l;
  setPref("fclvpaid", String(lv)); setPref("fccoins", String(fcCoins() + c));
  return [`🎉 Level ${lv}: ${fcTitle(lv)}! +🪙 ${c}`];
}
/*FCSTEP*/
const FC_PH_T = { rest: [0.9, 1.5], pull: [1.2, 2.2], run: [1.6, 2.8], thrash: [0.8, 1.2], jump: [1.0, 1.0] };
function fcPickPhase(F) {
  const s = F.s, opts = [["rest", F.ph === "rest" ? 0 : 1.6], ["pull", 2.4], ["run", F.ph === "run" ? 0 : 1 + 2.2 * s], ["thrash", F.ph === "thrash" ? 0 : 0.8 + s], ["jump", s > 0.5 && F.ph !== "jump" ? 1.1 * s : 0]];
  let r = Math.random() * opts.reduce((a, o) => a + o[1], 0);
  for (const [n, w] of opts) { if ((r -= w) <= 0) return n; }
  return "pull";
}
function fcSetPhase(F, n, hooks) {
  const [a, b] = FC_PH_T[n]; F.ph = n; F.phT = a + Math.random() * (b - a); F.phA = 0;
  if (n === "run") F.runDir = Math.random() < 0.5 ? -1 : 1;
  hooks && hooks.phase && hooks.phase(n);
}
function fcNewFight(s) { const F = { t: 0.35, d: 100, s, ph: "rest", phT: 1.2, phA: 0, time: 0, slack: 0, shake: 0.14, runDir: 1 }; return F; }
/* returns "win", "snap", "slack" or null */
function fcStep(F, down, dt, G, hooks) {
  G = typeof G === "number" ? { rod: G } : (G || {});
  const rodLv = G.rod || 0, line = G.line || 0, reel = G.reel || 0, gloves = G.gloves || 0, drag = G.drag || 0;
  const snapAt = 1 + 0.09 * line;                       // better line takes more pull
  const s = F.s, gm = (1 - 0.13 * rodLv) * (1 - 0.07 * gloves), rm = (1 + 0.18 * rodLv) * (1 + 0.12 * reel) * (F.time > 20 ? 1 + (F.time - 20) * 0.05 : 1);
  const dragM = 1 - 0.15 * drag;
  F.time += dt; F.phT -= dt; F.phA += dt;
  if (F.phT <= 0) fcSetPhase(F, fcPickPhase(F), hooks);
  const ph = F.ph;
  const gain = { rest: 0.32, pull: 0.45 + 0.15 * s, run: 0.45 + 0.5 * s, thrash: 0.5 + 0.2 * s, jump: 0.45 }[ph];
  const fall = { run: 0.34, thrash: 0.5 }[ph] ?? 0.6;
  // the fish keeps loading the line even when you let go, so letting go only helps so much
  F.t += { run: 0.17, thrash: 0.1, pull: 0.04, jump: 0.06, rest: 0 }[ph] * s * dt;
  if (ph === "thrash" && (F.shake -= dt) <= 0) { F.shake = 0.14; F.t += (Math.random() - 0.4) * 0.16 * (0.5 + s); }
  if (ph === "jump" && F.phA > 0.15 && F.phA < 0.85 && down) F.t += 0.9 * dt;
  if (down) F.t += gain * gm * dt; else F.t -= fall * dt;
  F.t = Math.max(0, F.t);
  const green = F.t >= 0.3 * snapAt && F.t <= 0.72 * snapAt;
  if (down) F.d -= (green ? 30 : F.t > 0.72 ? 10 : 5) * dt * (1.1 - 0.5 * s) * rm * (ph === "rest" ? 1.35 : ph === "run" ? 0.4 : 1);
  if (ph === "run") F.d += (down ? 6 : 13) * (0.4 + 0.6 * s) * dt * dragM;
  if (ph === "pull") F.d += (down ? 2.5 : 6) * s * dt * dragM;
  if (ph === "thrash") F.d += 3 * s * dt * dragM;
  F.d = Math.min(100, F.d);
  F.slack = F.t < 0.1 ? F.slack + dt : Math.max(0, F.slack - dt);
  F.tn = F.t / snapAt;                                  // 0 to 1, for the gauge
  if (F.t >= snapAt) return "snap";
  if (F.slack > 2.2) return "slack";
  if (F.d <= 0) return "win";
  return null;
}
/*ENDFCSTEP*/


const fcBag = () => { try { const b = JSON.parse(getPref("fcbag", "[]")); return Array.isArray(b) ? b : []; } catch { return []; } };
const fcSaveBag = (b) => setPref("fcbag", JSON.stringify(b));
function fcAddToBag(n, w) {
  const b = fcBag(); if (b.length >= fcBagMax()) return false;
  b.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), n, w, k: 0 }); fcSaveBag(b); return true;
}
const fcPaid = () => { try { return JSON.parse(getPref("fcpaid", "[]")) || []; } catch { return []; } };
const duelTotal = (a) => (Array.isArray(a) ? a : []).reduce((x, y) => x + (+y || 0), 0);

/* ===== leaderboard and daily tournaments (shared through Firestore) ===== */
const fcDay = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");   // the UTC day, the same for everyone
const fcHash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) % 1000000000; };
const fcEvent = (loc, day) => { const d = day || fcDay(), id = loc + "-" + d; return { id, loc, day: d, seed: fcHash(id) }; };
const fcLeft = () => { const n = new Date(), end = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1), m = Math.max(0, Math.floor((end - n.getTime()) / 60000)); return Math.floor(m / 60) + "h " + (m % 60) + "m"; };
const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] || "th"));
const fcEnts = () => { try { const a = JSON.parse(getPref("fcents", "[]")); return Array.isArray(a) ? a : []; } catch { return []; } };
const fcSaveEnts = (a) => setPref("fcents", JSON.stringify(a.slice(-80)));
function fcSetEnt(id, patch) { const a = fcEnts(), e = a.find((x) => x.id === id); if (e) { Object.assign(e, patch); fcSaveEnts(a); } return e; }

function fcMine() {
  const s = fcStats(), d = fcDex(); let bn = "", bw = 0;
  for (const k in d) if ((d[k].best || 0) > bw) { bw = d[k].best; bn = k; }
  return { name: S.name || "angler", xp: fcXp(), lv: fcLevel(), big: +bw.toFixed(2), bigN: bn, catches: s.catches, trophies: s.trophies, wins: s.duelWins, tw: s.tWins };
}
/* ---------- cloud save: the game progress follows your account ---------- */
const FC_SAVE_KEYS = ["fcach", "fcbag", "fccoins", "fcdex", "fcents", "fcgear", "fcloc", "fclure", "fclv", "fclvpaid", "fcpaid", "fcrod", "fcxp", "fcstats"];
let fcCloudLast = "", fcCloudAt = 0, fcCloudReady = false, fcCloudTimer = 0;
function fcSnapshot() { const d = {}; for (const k of FC_SAVE_KEYS) { const v = getPref(k, ""); if (v) d[k] = v; } return d; }
async function fcCloudPush(force) {
  if (!S.user || !fcCloudReady) return;
  const json = JSON.stringify(fcSnapshot());
  if (json === fcCloudLast || json === "{}") return;
  if (!force && Date.now() - fcCloudAt < 8000) return;
  fcCloudAt = Date.now(); const prev = fcCloudLast; fcCloudLast = json;
  try { await setDoc(doc(db, "fcsave", S.user.uid), { d: json, casts: +fcStatsRaw().casts || 0, reset: getPref("fcreset", ""), upd: serverTimestamp() }); } catch { fcCloudLast = prev; }
}
async function fcCloudSync() {
  if (!S.user) return;
  const uid = S.user.uid; fcCloudReady = false; fcCloudLast = "";
  let c = null;
  try { const snap = await getDoc(doc(db, "fcsave", uid)); if (snap.exists()) c = snap.data(); } catch { return; }   // offline: try again next time
  const owner = getPref("fcowner", ""), foreign = !!owner && owner !== uid;   // the progress on this phone belongs to someone else
  if (c?.reset && c.reset !== getPref("fcreset", "")) {   // restarted on another device: restart here too
    FC_SAVE_KEYS.forEach((k) => setPref(k, "")); setPref("fcreset", c.reset); toast("Your fishing game was restarted on another device.");
  }
  const localCasts = +fcStatsRaw().casts || 0;
  if (foreign) FC_SAVE_KEYS.forEach((k) => setPref(k, ""));
  if (c && (foreign || (+c.casts || 0) > localCasts)) {
    try { const d = JSON.parse(c.d); FC_SAVE_KEYS.forEach((k) => { if (k in d) setPref(k, d[k]); }); fcCloudLast = c.d; toast("Your fishing game progress was restored."); } catch { /* bad save, keep local */ }
  }
  setPref("fcowner", uid); fcCloudReady = true;
  fcCloudPush(true);
  if (!fcCloudTimer) { fcCloudTimer = setInterval(() => fcCloudPush(), 15000); document.addEventListener("visibilitychange", () => { if (document.hidden) fcCloudPush(true); }); }
}
async function resetFcProgress(after) {
  if (!S.user) return;
  if (!confirm("Start the fishing game over?\n\nThis erases your fish, coins, gear, level and records in the game. It can't be undone.")) return;
  if (!confirm("Are you really sure? Everything in the fishing game goes back to zero.")) return;
  const rid = String(Date.now());   // a restart marker in the cloud save, so your other phones and computers restart too instead of pushing their old progress back
  try { await setDoc(doc(db, "fcsave", S.user.uid), { d: "{}", casts: 0, reset: rid, upd: serverTimestamp() }); } catch { toast("Couldn't reach the server. Try again when you're online."); return; }
  setPref("fcreset", rid);
  deleteDoc(doc(db, "fcboard", S.user.uid)).catch(() => {});
  FC_SAVE_KEYS.forEach((k) => setPref(k, ""));
  fcCloudLast = ""; fcLastPub = "";
  toast("Fishing game restarted from zero."); after?.();
}
let fcLastPub = "";
async function fcPublish() {
  if (!S.user) return;
  fcCloudPush();
  const data = fcMine(), key = JSON.stringify(data);
  if (key === fcLastPub) return;
  fcLastPub = key;
  try { await setDoc(doc(db, "fcboard", S.user.uid), { ...data, upd: serverTimestamp() }); } catch { fcLastPub = ""; }
}
async function fcSendEntry(e) {
  try { await setDoc(doc(db, "fcscores", e.id + "_" + S.user.uid), { event: e.id, uid: S.user.uid, name: S.name || "angler", score: e.score, c: e.c, at: serverTimestamp() }); return true; }
  catch (err) { return !!err && err.code === "permission-denied"; }   // denied means it is already there, so stop retrying
}
function fcSubmitEntry(id, mine) {
  const e0 = fcEnts().find((x) => x.id === id); if (!e0 || e0.score != null) return;
  const c = [0, 1, 2].map((i) => +(+mine[i] || 0).toFixed(2)), score = +c.reduce((x, y) => x + y, 0).toFixed(2);
  const e = fcSetEnt(id, { c, score });
  fcSendEntry(e).then((ok) => { if (ok) fcSetEnt(id, { sent: 1 }); });
}
/* An entry that never finished counts as what you had caught (nothing). Anything unsent is sent again. */
async function fcFlush() {
  for (const e of fcEnts()) {
    let x = e;
    if (x.score == null) x = fcSetEnt(x.id, { c: [0, 0, 0], score: 0 });
    if (!x.sent && (await fcSendEntry(x))) fcSetEnt(x.id, { sent: 1 });
  }
}
async function fcStandings(id) {
  const s = await getDocs(query(collection(db, "fcscores"), where("event", "==", id), limit(100)));
  return s.docs.map((d) => d.data()).sort((a, b) => b.score - a.score);
}
/* Pays prizes for cups that ended on an earlier day. Returns the messages. */
async function fcClaim() {
  const notes = [], day = fcDay();
  for (const e of fcEnts()) {
    if (e.claimed || e.score == null || !e.sent || e.day >= day) continue;
    let rows; try { rows = await fcStandings(e.id); } catch { continue; }
    const rank = rows.filter((r) => r.score > e.score && r.uid !== S.user.uid).length + 1, n = Math.max(rows.length, rank);
    const L = FC_LOCS.find((l) => l.id === e.loc) || FC_LOCS[0], k = 0.6 + 0.4 * L.stars + 0.08 * L.lvl;
    let coins = 40, xp = 15;
    if (n >= 3) { coins = rank === 1 ? 500 : rank === 2 ? 300 : rank === 3 ? 200 : rank <= 10 ? 100 : 40; xp = rank === 1 ? 120 : rank === 2 ? 80 : rank === 3 ? 50 : 20; }
    coins = Math.round(coins * k);
    fcSetEnt(e.id, { claimed: 1, res: { rank, n, coins } });
    if (n >= 3 && rank <= 3) fcStat("tPodium", 1);
    if (n >= 3 && rank === 1) fcStat("tWins", 1);
    setPref("fccoins", String(fcCoins() + coins)); setPref("fcxp", String(fcXp() + xp));
    notes.push(`${L.n} Cup: you came ${ord(rank)} of ${n}. +🪙 ${coins} and +${xp} XP.`);
  }
  return notes;
}

function openFishGame() {
  let loc = getPref("fcloc", "pond"), lure = getPref("fclure", "spinner");
  if (!FC_LOCS.some((l) => l.id === loc && l.lvl <= fcLevel() && (l.lic || 0) <= fcUp("license"))) loc = "pond";
  let duels = [], unsub = null, note = "", tab = "play", evCache = {}, openEv = "", rk = "xp", scope = "all", rankState = { key: "" };
  const box = el("div", { class: "fc-menu-in" });
  const bg = el("div", { class: "game-bg fc-menu", role: "dialog", "aria-label": "Fishing game menu" }, box);
  document.body.append(bg);
  const close = () => { unsub && unsub(); bg.remove(); };
  try {
    unsub = onSnapshot(query(collection(db, "duels"), where("players", "array-contains", S.user.uid)), (s) => { duels = s.docs.map((d) => ({ id: d.id, ...d.data() })); draw(); }, () => { /* offline or blocked: duels just stay empty */ });
  } catch { /* ignore */ }
  const friends = () => S.friendships.map((f) => { const uid = f.members.find((m) => m !== S.user.uid); return { uid, name: (f.names && f.names[uid]) || "friend" }; });
  const sellValue = (e) => fcValue(e.n, e.w);
  const sell = (ids) => { const bag = fcBag(), keep = [], gone = bag.filter((e) => ids.includes(e.id)); bag.forEach((e) => { if (!ids.includes(e.id)) keep.push(e); }); const total = gone.reduce((a, e) => a + sellValue(e), 0); fcSaveBag(keep); setPref("fccoins", String(fcCoins() + total)); fcStat("earned", total); note = gone.length ? `Sold ${gone.length} fish for 🪙 ${total}.` : ""; draw(); };
  const challenge = async (fr) => {
    if (duels.some((d) => d.players.includes(fr.uid) && !(d.sa?.length && d.sb?.length))) { note = `You already have a duel going with @${fr.name}.`; draw(); return; }
    try {
      await addDoc(collection(db, "duels"), { players: [S.user.uid, fr.uid], a: S.user.uid, b: fr.uid, aName: S.name, bName: fr.name, loc, lure, seed: Math.floor(Math.random() * 1e9), sa: [], sb: [], createdAt: serverTimestamp() });
      note = `Challenge sent to @${fr.name}. You can play your 3 casts now.`; draw();
    } catch (e) { note = "Couldn't send the challenge. Check your internet and try again."; draw(); }
  };
  const duelRow = (d) => {
    const me = d.a === S.user.uid, opp = me ? d.bName : d.aName, mine = me ? d.sa : d.sb, theirs = me ? d.sb : d.sa, L = FC_LOCS.find((l) => l.id === d.loc) || FC_LOCS[0];
    const done = mine?.length === 3 && theirs?.length === 3;
    let status, action;
    if (!mine?.length) { status = `Your turn · ${L.n}`; action = el("button", { class: "btn small", type: "button", "data-duel": d.id, onclick: () => playClash("friend", d.loc, lure, draw, d) }, "Play"); }
    else if (!theirs?.length) { status = `You caught ${duelTotal(mine).toFixed(1)} lb · waiting for @${opp}`; action = el("button", { class: "link small", type: "button", onclick: () => deleteDoc(doc(db, "duels", d.id)) }, "Cancel"); }
    else {
      const a = duelTotal(mine), b = duelTotal(theirs), out = a > b ? "You won" : a < b ? "They won" : "Draw";
      status = `${out} · you ${a.toFixed(1)} lb, @${opp} ${b.toFixed(1)} lb`; action = el("button", { class: "link small", type: "button", onclick: () => deleteDoc(doc(db, "duels", d.id)) }, "Remove");
      if (done && !fcPaid().includes(d.id)) { const paid = fcPaid(); paid.push(d.id); setPref("fcpaid", JSON.stringify(paid.slice(-60))); const c = a > b ? 100 : a === b ? 40 : 20, x = a > b ? 60 : a === b ? 30 : 15; if (a > b) fcStat("duelWins", 1); setPref("fccoins", String(fcCoins() + c)); setPref("fcxp", String(fcXp() + x)); note = `Duel with @${opp} finished: ${out.toLowerCase()}. +🪙 ${c} and +${x} XP.`; setTimeout(draw, 0); }
    }
    return el("div", { class: "item", style: "cursor:default;gap:10px" }, el("div", { class: "stack", style: "gap:2px;min-width:0" }, el("span", { class: "t" }, "Duel with @" + opp), el("span", { class: "s" }, status)), action);
  };
  /* ---------- tournaments and leaderboard tabs ---------- */
  const lockWhy = (l) => l.lvl > fcLevel() ? `Reach level ${l.lvl}` : (l.lic || 0) > fcUp("license") ? (l.lic === 2 ? "Get the saltwater endorsement" : "Get a fishing licence") : "";
  const loadStand = async (id) => { try { evCache[id] = { rows: await fcStandings(id), at: Date.now() }; } catch { evCache[id] = { rows: null, at: Date.now() }; } draw(); };
  const rankIn = (rows, uid) => { const m = rows.find((r) => r.uid === uid); return m ? rows.filter((r) => r.score > m.score).length + 1 : 0; };
  const enter = async (l) => {
    const ev = fcEvent(l.id, fcDay());
    if (fcEnts().some((e) => e.id === ev.id)) return;
    try { const s = await getDoc(doc(db, "fcscores", ev.id + "_" + S.user.uid)); if (s.exists()) { note = `You already fished the ${l.n} Cup today.`; draw(); return; } } catch { /* offline: let them play */ }
    const a = fcEnts(); a.push({ id: ev.id, loc: l.id, day: ev.day, score: null, c: [], sent: 0, claimed: 0 }); fcSaveEnts(a); fcStat("tEnt", 1);
    playClash("event", l.id, lure, () => { delete evCache[ev.id]; note = ""; draw(); fcPublish(); }, ev);
  };
  const evTab = () => {
    const day = fcDay(), ents = fcEnts();
    const cards = FC_LOCS.map((l) => {
      const ev = fcEvent(l.id, day), en = ents.find((e) => e.id === ev.id), why = lockWhy(l), C = evCache[ev.id], rows = C && C.rows;
      let line, act;
      if (en) {
        const r = rows ? rankIn(rows, S.user.uid) : 0;
        line = en.score == null ? "In progress" : `Your score: ${en.score.toFixed(2)} lb` + (r ? ` · #${r} of ${rows.length}` : "") + (en.sent ? "" : " · not sent yet");
        act = el("button", { class: "btn small ghost", type: "button", "data-stand": ev.id, onclick: () => { openEv = openEv === ev.id ? "" : ev.id; if (openEv && !evCache[ev.id]) loadStand(ev.id); else draw(); } }, openEv === ev.id ? "Hide standings" : "Standings");
      } else if (why) { line = ""; act = null; }
      else { line = "3 casts. Everyone fishes the same water today."; act = el("button", { class: "btn small", type: "button", "data-enter": ev.id, onclick: () => enter(l) }, "Enter the cup"); }
      return el("div", { class: "gear" + (why && !en ? " locked" : ""), "data-ev": ev.id },
        el("div", { class: "row spread" }, el("b", null, l.n + " Cup"), el("span", { class: "muted small", "aria-label": l.stars + " stars of difficulty" }, "★".repeat(l.stars))),
        line ? el("span", { class: "gear-eff" }, line) : null,
        why && !en ? el("span", { class: "lockline" }, "🔒 " + why) : null, act);
    });
    let panel = null;
    if (openEv) {
      const C = evCache[openEv], rows = C && C.rows, loc = FC_LOCS.find((l) => l.id === openEv.split("-")[0]);
      panel = el("div", { class: "stack", style: "gap:6px", id: "fc-stand" }, el("h3", { class: "gear-grp" }, (loc ? loc.n : "") + " Cup standings"),
        !C ? el("p", { class: "muted small" }, "Loading...") : !rows ? el("p", { class: "muted small" }, "Couldn't load the standings. Check your internet.")
          : !rows.length ? el("p", { class: "muted small" }, "No scores yet.")
          : el("div", { class: "list" }, rows.slice(0, 20).map((r, i) => el("div", { class: "item" + (r.uid === S.user.uid ? " me" : ""), style: "cursor:default;gap:10px" },
              el("b", { class: "rank-n" }, ["🥇", "🥈", "🥉"][rankIn(rows, r.uid) - 1] || "#" + rankIn(rows, r.uid)), el("span", { class: "t", style: "flex:1;min-width:0" }, "@" + r.name), el("span", { class: "s" }, r.score.toFixed(2) + " lb")))));
    }
    const past = ents.filter((e) => e.res).slice(-6).reverse();
    return [
      el("h2", null, "Daily tournaments"),
      el("p", { class: "muted small" }, `Every place has a cup each day. You get 3 casts, the same fish for everyone, and the heaviest total wins. New cups start in ${fcLeft()}. Prizes come the next day, and you need at least 3 anglers for the podium. If you leave early, only what you've caught counts.`),
      el("div", { class: "gear-grid" }, cards), panel,
      past.length ? el("div", { class: "stack", style: "gap:6px" }, el("h3", { class: "gear-grp" }, "Past results"),
        el("div", { class: "list" }, past.map((e) => { const L = FC_LOCS.find((l) => l.id === e.loc) || FC_LOCS[0];
          return el("div", { class: "item", style: "cursor:default" }, el("div", { class: "stack", style: "gap:2px" }, el("span", { class: "t" }, `${L.n} Cup`), el("span", { class: "s" }, `${e.day.slice(4, 6)}/${e.day.slice(6)} · ${ord(e.res.rank)} of ${e.res.n}`)), el("span", { class: "s" }, "+🪙 " + e.res.coins)); }))) : null];
  };
  const BOARDS = [["xp", "Top anglers", (r) => `Level ${r.lv} · ${r.xp} XP`], ["big", "Biggest fish", (r) => `${(+r.big).toFixed(2)} lb ${r.bigN || ""}`], ["catches", "Most fish", (r) => `${r.catches} fish`], ["tw", "Cup wins", (r) => `${r.tw || 0} won`]];
  const loadBoard = async () => {
    const key = rk + "|" + scope; rankState = { key, rows: null }; draw();
    let rows = [];
    try {
      await fcPublish();
      if (scope === "all") rows = (await getDocs(query(collection(db, "fcboard"), orderBy(rk, "desc"), limit(25)))).docs.map((d) => ({ uid: d.id, ...d.data() }));
      else {
        const ids = [S.user.uid, ...friends().map((f) => f.uid)];
        rows = (await Promise.all(ids.map((u) => getDoc(doc(db, "fcboard", u)).then((s) => (s.exists() ? { uid: u, ...s.data() } : null)).catch(() => null)))).filter(Boolean).sort((a, b) => (b[rk] || 0) - (a[rk] || 0));
      }
      if (rankState.key === key) rankState = { key, rows: rows.filter((r) => (r[rk] || 0) > 0), at: Date.now() };
    } catch { if (rankState.key === key) rankState = { key, rows: null, err: true }; }
    if (rankState.key === key) draw();
  };
  const rankTab = () => {
    const B = BOARDS.find((b) => b[0] === rk), rows = rankState.key === rk + "|" + scope ? rankState.rows : null, me = fcMine();
    return [
      el("h2", null, "Leaderboard"),
      el("div", { class: "chips" }, BOARDS.map(([id, n]) => el("button", { class: "chip", type: "button", "data-board": id, "aria-pressed": String(rk === id), onclick: () => { rk = id; loadBoard(); } }, n))),
      el("div", { class: "chips" }, [["all", "Everyone"], ["friends", "Friends"]].map(([id, n]) => el("button", { class: "chip", type: "button", "data-scope": id, "aria-pressed": String(scope === id), onclick: () => { scope = id; loadBoard(); } }, n))),
      rankState.err && rankState.key === rk + "|" + scope ? el("p", { class: "muted small" }, "Couldn't load the leaderboard. Check your internet and try again.")
        : !rows ? el("p", { class: "muted small" }, "Loading...")
        : !rows.length ? el("p", { class: "muted small" }, scope === "friends" ? "None of your friends have played yet." : "Nobody is on this board yet. Play a bit and you will be first.")
        : el("div", { class: "list", id: "fc-board" }, rows.map((r, i) => el("div", { class: "item" + (r.uid === S.user.uid ? " me" : ""), style: "cursor:default;gap:10px", "data-rank": i + 1 },
            el("b", { class: "rank-n" }, ["🥇", "🥈", "🥉"][i] || "#" + (i + 1)), el("div", { class: "stack", style: "gap:1px;flex:1;min-width:0" }, el("span", { class: "t" }, "@" + r.name), el("span", { class: "s" }, `${fcTitle(r.lv || 1)} · ${r.catches || 0} fish`)), el("span", { class: "s" }, B[2](r))))),
      el("p", { class: "muted small" }, `You: level ${me.lv} · ${me.catches} fish landed · biggest ${me.big ? me.big.toFixed(2) + " lb " + me.bigN : "none yet"}. Your scores are shared with other players when you open the game.`)];
  };
  const setTab = (t) => {
    tab = t;
    if (t === "rank" && (rankState.key !== rk + "|" + scope || Date.now() - (rankState.at || 0) > 30000)) loadBoard();
    else if (t === "events") { fcEnts().filter((e) => e.day === fcDay() && e.score != null && !evCache[e.id]).forEach((e) => loadStand(e.id)); draw(); }
    else draw();
  };
  const draw = () => {
    const lvNotes = fcCheckLevel(); if (lvNotes.length) note = [note, ...lvNotes].filter(Boolean).join("  ·  ");
    const fresh = fcCheckAch();
    if (fresh.length) note = [note, fresh.map((a) => `🏅 ${a.n} — ${a.d}. +🪙 ${a.coins}`).join("  ·  ")].filter(Boolean).join("  ·  ");
    const ST = fcStats();
    const lv = fcLevel(), xp = fcXp(), lo = 40 * (lv - 1) ** 2, hi = 40 * lv ** 2, dex = fcDex(), coins = fcCoins(), lvs = fcLureLv();
    const names = Object.keys(FC_FISH), bag = fcBag().sort((a, b) => (b.k - a.k) || (sellValue(b) - sellValue(a))), fr = friends();
    const sellable = bag.filter((e) => !e.k);
    const L0 = FC_LOCS.find((l) => l.id === loc);
    box.replaceChildren(...[
      el("div", { class: "row spread" }, el("h1", null, "Lake Duel"), el("button", { class: "link", type: "button", onclick: close }, "Close")),
      el("div", { class: "fc-card hero" }, el("div", { class: "row spread" }, el("b", null, "Level " + lv + " · " + fcTitle(lv)), el("b", { id: "fc-coins" }, "🪙 " + coins)),
        el("div", { class: "meter" }, el("i", { style: "width:" + Math.round((xp - lo) / (hi - lo) * 100) + "%" })),
        el("span", { class: "muted small" }, xp + " / " + hi + " XP to level " + (lv + 1)),
        el("span", { class: "muted small" }, `${ST.catches} fish landed · ${ST.casts} casts · ${ST.trophies} trophies · 🪙 ${ST.earned} earned selling`)),
      note ? el("p", { class: "fc-note", role: "status" }, note) : null,
      el("div", { class: "chips fc-tabs", role: "group", "aria-label": "Game sections" }, [["play", "Fish"], ["events", "Tournaments"], ["rank", "Leaderboard"], ["shop", "Bag and shop"], ["me", "Progress"]].map(([id, n]) => el("button", { class: "chip", type: "button", "data-tab": id, "aria-pressed": String(tab === id), onclick: () => setTab(id) }, n))),
      tab === "play" && [
      (() => { const owned = FC_GEAR.filter((it) => fcUp(it.id)); return owned.length ? el("p", { class: "muted small" }, "Your gear: " + owned.map((it) => it.icon + " " + fcGearName(it)).join(" · ")) : null; })(),
      el("h2", null, "Where"),
      el("div", { class: "loc-grid" }, FC_LOCS.map((l) => { const needLic = (l.lic || 0) > fcUp("license"), shut = needLic || l.lvl > lv;
        return el("button", { class: "loc-card", type: "button", "data-loc": l.id, disabled: shut ? "" : null, "aria-pressed": String(loc === l.id),
          style: `background:linear-gradient(180deg,${l.sky[0]} 0%,${l.sky[1]} 32%,${l.water[0]} 34%,${l.water[1]} 100%)`,
          onclick: () => { loc = l.id; setPref("fcloc", loc); note = ""; draw(); } },
          el("b", null, l.n), el("span", { class: "loc-s" }, "★".repeat(l.stars) + (l.salt ? " · salt" : "")),
          shut ? el("span", { class: "loc-lock" }, l.lvl > lv ? "🔒 Lv " + l.lvl : l.lic === 2 ? "🔒 Saltwater permit" : "🔒 Licence") : null); })),
      el("p", { class: "muted small" }, `${L0.salt ? "Salt water. " : "Fresh water. "}Fight: ${"★".repeat(L0.stars)}${"☆".repeat(5 - L0.stars)}. Fish here: ${L0.fish.map((n) => (dex[n] ? n : "???")).join(", ")}.`),
      el("h2", null, "Lure"),
      el("div", { class: "chips" }, FC_LURES.map(([id, n]) => el("button", { class: "chip", type: "button", "aria-pressed": String(lure === id), onclick: () => { lure = id; setPref("fclure", id); draw(); } }, n + FC_LURE_TAG[lvs[id] || 0]))),
      el("button", { class: "btn wide", type: "button", id: "fc-duel", onclick: () => playClash("duel", loc, lure, draw) }, "Duel a rival (3 casts)"),
      el("button", { class: "btn ghost wide", type: "button", id: "fc-free", onclick: () => playClash("free", loc, lure, draw) }, "Free fishing"),
      el("button", { class: "btn ghost wide", type: "button", id: "fc-rush", onclick: openReelRush }, "Quick game: Reel Rush"),
      el("h2", null, "Play with friends"),
      duels.length ? el("div", { class: "list", id: "fc-duels" }, duels.map(duelRow)) : null,
      fr.length ? el("div", { class: "list" }, fr.map((f) => el("div", { class: "item", style: "cursor:default" }, el("span", { class: "t" }, "@" + f.name),
        el("button", { class: "btn small ghost", type: "button", "data-challenge": f.uid, onclick: () => challenge(f) }, "Challenge")))) :
        el("p", { class: "muted small" }, "Add friends in Me, then Friends and chat. Then you can challenge them here. You each fish 3 casts in the same place when it suits you, and the biggest total wins."),
      fr.length ? el("p", { class: "muted small" }, `A challenge uses your picked place (${L0.n}) and lure.`) : null,
      el("h2", null, "Start over"),
      el("p", { class: "muted small" }, "Erases your fish, coins, gear, level and records in the fishing game and starts from zero. Your Fishing school and your posted catches stay."),
      el("button", { class: "btn ghost wide", type: "button", id: "fc-reset", style: "color:#c62828;border-color:#c62828", onclick: () => resetFcProgress(draw) }, "Restart my game progress"),
      ],
      tab === "shop" && [
      el("h2", { id: "fc-bag-h" }, `My bag (${bag.length}/${fcBagMax()})`),
      bag.length ? el("div", { class: "row spread" }, el("span", { class: "muted small" }, `Worth 🪙 ${sellable.reduce((a, e) => a + sellValue(e), 0)} (not counting ★ fish)`),
        el("button", { class: "btn small", type: "button", id: "fc-sellall", disabled: sellable.length ? null : "", onclick: () => sell(sellable.map((e) => e.id)) }, "Sell all")) : el("p", { class: "muted small" }, "Empty. Fish you catch go in your bag. You only get coins when you sell them."),
      bag.length ? el("div", { class: "list" }, bag.map((e) => el("div", { class: "item", style: "cursor:default;gap:8px", "data-fish": e.id },
        el("button", { class: "link", type: "button", "aria-label": e.k ? "Remove from collection" : "Keep in collection", "aria-pressed": String(!!e.k), onclick: () => { const b = fcBag(); const x = b.find((y) => y.id === e.id); if (x) x.k = x.k ? 0 : 1; fcSaveBag(b); draw(); } }, e.k ? "★" : "☆"),
        el("div", { class: "stack", style: "gap:2px;min-width:0;flex:1" }, el("span", { class: "t" }, e.n), el("span", { class: "s" }, `${lbText(e.w)} · ${fcTier(e.n, e.w)[0]}${e.k ? " · in your collection" : ""}`)),
        el("button", { class: "btn small ghost", type: "button", "data-sell": e.id, onclick: () => sell([e.id]) }, "Sell 🪙 " + sellValue(e))))) : null,
      el("p", { class: "muted small" }, "Tap the star to keep a fish in your collection. Kept fish are never sold by Sell all."),
      el("h2", null, "Tackle shop"),
      el("p", { class: "muted small" }, "Buy your licence first, then build up your kit. The bigger gear only comes within reach once you have put the hours in."),
      FC_GROUPS.map((grp) => {
        const items = FC_GEAR.filter((it) => it.g === grp);
        if (!items.length) return null;
        return el("div", { class: "stack", style: "gap:8px" }, el("h3", { class: "gear-grp" }, grp),
          el("div", { class: "gear-grid" }, items.map((it) => {
            const l = fcUp(it.id), maxed = l >= it.costs.length, cost = maxed ? 0 : it.costs[l], tlv = maxed ? 0 : (it.tl[l] || 0), lock = l ? (tlv > lv ? `Reach level ${tlv} for the next upgrade (you're ${lv})` : null) : fcLocked(it, ST);
            return el("div", { class: "gear" + (maxed ? " maxed" : "") + (lock ? " locked" : ""), "data-gear": it.id },
              el("div", { class: "row", style: "gap:8px;align-items:center" }, el("span", { class: "gear-i", "aria-hidden": "true" }, it.icon),
                el("div", { class: "stack", style: "gap:1px;min-width:0" }, el("b", null, it.n), el("span", { class: "muted small" }, fcGearName(it)))),
              el("div", { class: "pips", role: "img", "aria-label": `Level ${l} of ${it.costs.length}` }, it.costs.map((_, i) => el("i", { class: i < l ? "on" : "" }))),
              el("span", { class: "gear-eff" }, it.eff(l)),
              lock ? el("span", { class: "lockline" }, "🔒 " + lock)
                : maxed ? el("span", { class: "pill live" }, "Fully upgraded")
                : el("button", { class: "btn small", type: "button", "data-buygear": it.id, disabled: coins < cost ? "" : null,
                    onclick: () => { if (fcBuy(it.id)) { note = `Bought ${it.names[l]}.`; draw(); } } }, `${it.names[l]} 🪙 ${cost}`));
          })));
      }),
      el("h2", null, "Lures"),
      el("div", { class: "list" }, FC_LURES.map(([id, n]) => { const l = lvs[id] || 0, cost = FC_LURE_COST[l];
        return el("div", { class: "item", style: "cursor:default" }, el("div", { class: "stack", style: "gap:2px" }, el("span", { class: "t" }, n + FC_LURE_TAG[l]), el("span", { class: "s" }, l ? "Attracts bigger fish" : "Basic")),
          cost ? el("button", { class: "btn small", type: "button", "data-buy": id, disabled: coins < cost ? "" : null, onclick: () => { if (fcCoins() >= cost) { setPref("fccoins", String(fcCoins() - cost)); lvs[id] = l + 1; setPref("fclv", JSON.stringify(lvs)); draw(); } } }, "Upgrade 🪙 " + cost) : el("span", { class: "pill live" }, "Maxed")); })),
      ],
      tab === "me" && [
      (() => { const done = fcAchDone(), rows = FC_ACH.map((a) => { const [have, need] = a.p(ST); return { a, have, need, got: done.includes(a.id) }; })
          .sort((x, y) => (x.got - y.got) || (y.have / y.need - x.have / x.need));
        return el("div", { class: "stack", style: "gap:8px" },
          el("h2", null, `Achievements (${done.length}/${FC_ACH.length})`),
          el("p", { class: "muted small" }, "Each one pays out once, and some unlock new gear in the shop."),
          el("div", { class: "list" }, rows.map(({ a, have, need, got }) => el("div", { class: "item ach" + (got ? " got" : ""), style: "cursor:default", "data-ach": a.id },
            el("span", { class: "ach-i", "aria-hidden": "true" }, got ? "🏅" : "🔒"),
            el("div", { class: "stack", style: "gap:3px;min-width:0;flex:1" },
              el("span", { class: "t" }, a.n), el("span", { class: "s" }, a.d),
              got ? null : el("div", { class: "meter thin" }, el("i", { style: "width:" + Math.round(Math.min(1, have / need) * 100) + "%" }))),
            el("span", { class: "s" }, got ? "Done" : `${Math.floor(Math.min(have, need) * 100) / 100}/${need}`)))));
      })(),
      el("h2", null, `My fish (${Object.keys(dex).length}/${names.length})`),
      el("div", { class: "list" }, names.map((n) => el("div", { class: "item", style: "cursor:default" },
        el("span", { class: "t" }, dex[n] ? n : "???"), el("span", { class: "s" }, dex[n] ? `best ${lbText(dex[n].best)} · caught ${dex[n].n}` : "not caught yet")))),
      el("p", { class: "muted small" }, "How to play: tap to cast. Wait for a dark shape to show at the bobber and the ! to appear, then tap fast to hook it. You can't tell what it is until you land it. Hold to reel. When the fish runs or jumps, let go so the line doesn't snap. Big fish take longer to bite and fight harder. Sell your fish in your bag to earn coins, then spend them in the tackle shop.")], tab === "events" && evTab(), tab === "rank" && rankTab()].flat(9).filter(Boolean));
  };
  draw();
  fcPublish();
  fcFlush().then(fcClaim).then((notes) => { if (notes.length) { note = [note, ...notes].filter(Boolean).join("  ·  "); draw(); fcPublish(); } }).catch(() => { /* offline */ });
}

function playClash(mode, locId, lureIdIn, onExit, duel) {
  const lureId = mode === "friend" && duel.lure ? duel.lure : lureIdIn;
  const L = FC_LOCS.find((l) => l.id === locId) || FC_LOCS[0], K = L.like || L.id, HR = window.__hr ?? new Date().getHours(), TOD = HR >= 21 || HR < 5 ? "night" : HR >= 17 ? "dusk" : HR < 8 ? "dawn" : "day";
  const G = fcGear(), lureLv = fcLureLv()[lureId] || 0;
  const upHook = fcUp("hook"), upNet = fcUp("net");
  const upBait = fcUp("bait") + 0.7 * fcUp("gps");                 // scent and knowing the spots both speed up bites
  const upCharm = fcUp("charm") + 0.7 * fcUp("tackle");            // the right lure works like luck
  const upBoat = fcUp("boat") + 0.9 * fcUp("waders");              // both get you to better water
  const upFinder = Math.max(fcUp("finder"), fcUp("glasses"));      // glasses do what cheap sonar does
  const BITE_WINDOW = 0.95 * (1 + 0.3 * upHook);
  fcMarkPlace(L.id);
  const canvas = el("canvas", { class: "game-canvas", role: "img", "aria-label": "Fishing game. Tap to cast and hook. Hold to reel. Let go when the fish runs." });
  let ctx = canvas.getContext("2d", { alpha: false });
  const sndBtn = el("button", { class: "game-x game-snd", type: "button", "aria-label": "Sound on or off", onclick: () => { soundOn = !soundOn; setPref("fcsound", soundOn ? "1" : "0"); sndBtn.textContent = soundOn ? "🔊" : "🔇"; if (!soundOn) whine(false); } });
  const motBtn = el("button", { class: "game-x game-snd", type: "button", id: "fc-motion", "aria-label": "Motion mode on or off", style: "right:114px;font-size:1.05rem", onclick: async () => {
    if (!motionOn) {
      try {   // iPhones ask first. Other phones just say yes.
        for (const C of [window.DeviceMotionEvent, window.DeviceOrientationEvent]) if (C && typeof C.requestPermission === "function" && (await C.requestPermission()) !== "granted") { toast("Motion was blocked. Allow it in your phone's settings."); return; }
      } catch { toast("Couldn't turn on motion on this phone."); return; }
      motionOn = true; setPref("fcmotion", "1"); attachMotion(); toast("Motion mode on. Flick your phone forward to cast. Tilt to aim.");
      setTimeout(() => { if (motionOn && !motionSeen) toast("No motion detected. This phone or browser may not allow motion sensors. Tapping still works."); }, 2500);
    } else { motionOn = false; setPref("fcmotion", "0"); detachMotion(); toast("Motion mode off."); }
    motBtn.textContent = motionOn ? "📱" : "📴";
  } }, getPref("fcmotion", "0") === "1" ? "📱" : "📴");
  const restartBtn = el("button", { class: "game-x game-snd", type: "button", id: "fc-restart", "aria-label": "Restart the game", style: "right:auto;left:10px;top:calc(58px + env(safe-area-inset-top));width:40px;height:40px;font-size:1.15rem", onclick: () => {
    if (mode !== "free") { toast("Restart is only in Free fishing. Tap ✕ and start again."); return; }
    whine(false); fish = null; F = null; target = null; snag = false; landed = true; down = false; flickPow = null; powerT = 0; setSt("cast"); toast("Game restarted.");
  } }, "↻");
  const bg = el("div", { class: "game-bg", role: "dialog", "aria-label": "Fishing" }, canvas, sndBtn, motBtn, restartBtn,
    el("button", { class: "game-x", type: "button", "aria-label": "Leave the game", onclick: () => end() }, "✕"));
  document.body.append(bg);
  let W = 0, H = 0, raf = 0, dpr = 1, last = 0, deco = null;
  // Quality: 0 = full, 1 = lighter, 2 = lightest. Weak phones start lighter, and any phone that stutters steps down by itself.
  const lowEnd = (navigator.hardwareConcurrency || 8) <= 6 || (navigator.deviceMemory || 8) <= 4;
  let Q = Math.max(+getPref("fcq", "0") || 0, lowEnd ? 1 : 0), ema = 16, nfr = 0, outl = false, LAY = null;
  /* ---------- sound (made with the browser, no files) ---------- */
  /* ---------- motion mode: flick the phone forward to cast, tilt it to aim ---------- */
  let motionOn = getPref("fcmotion", "0") === "1", motionSeen = false, lastFlick = 0, motionAttached = false;
  const onMotion = (e) => {
    motionSeen = true; const r = e.rotationRate; if (!r) return;
    const now = performance.now();
    const b = r.beta || 0;   // negative = top of the phone flicked away from you, positive = flicked toward you
    if (now - lastFlick > 900 && ((st === "cast" && (b < -230 || b > 330)) || (st === "bite" && (b > 200 || b < -330)))) {
      lastFlick = now; if (st === "cast") flickPow = 0.4 + 0.52 * Math.min(1, (Math.abs(b) - 230) / 400);   // harder flick, longer cast
      act();
    }
  };
  const onTilt = (e) => {
    motionSeen = true; if (st !== "cast" || aimDrag || e.gamma == null) return;
    const g = Math.max(-35, Math.min(35, e.gamma)); aimX += (0.5 + g / 35 * 0.38 - aimX) * 0.25;
  };
  const attachMotion = () => { if (motionAttached) return; motionAttached = true; addEventListener("devicemotion", onMotion); addEventListener("deviceorientation", onTilt); };
  const detachMotion = () => { motionAttached = false; removeEventListener("devicemotion", onMotion); removeEventListener("deviceorientation", onTilt); };
  if (motionOn) attachMotion();
  let soundOn = getPref("fcsound", "1") === "1", actx = null, noise = null, whineNode = null, clickAcc = 0;
  sndBtn.textContent = soundOn ? "🔊" : "🔇";
  const audio = () => {
    if (!soundOn) return null;
    try {
      if (!actx) { actx = new (window.AudioContext || window.webkitAudioContext)(); const n = Math.floor(actx.sampleRate * 0.4); noise = actx.createBuffer(1, n, actx.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; }
      if (actx.state === "suspended") actx.resume();
      return actx;
    } catch { return null; }
  };
  const tick = (freq, vol, dur = 0.03, q = 3) => {
    const a = audio(); if (!a) return;
    const s = a.createBufferSource(); s.buffer = noise; const f = a.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
    const g = a.createGain(); g.gain.setValueAtTime(vol, a.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    s.connect(f); f.connect(g); g.connect(a.destination); s.start(a.currentTime, Math.random() * 0.2); s.stop(a.currentTime + dur + 0.02);
  };
  const whine = (on, pitch = 900) => {
    if (!on) { if (whineNode) { try { whineNode.g.gain.setTargetAtTime(0.0001, actx.currentTime, 0.05); whineNode.o.stop(actx.currentTime + 0.3); } catch { /* already stopped */ } whineNode = null; } return; }
    const a = audio(); if (!a) return;
    if (!whineNode) { const o = a.createOscillator(), f = a.createBiquadFilter(), g = a.createGain(); o.type = "sawtooth"; f.type = "bandpass"; f.frequency.value = 1400; f.Q.value = 2; g.gain.value = 0.0001; o.connect(f); f.connect(g); g.connect(a.destination); o.start(); g.gain.setTargetAtTime(0.025, a.currentTime, 0.05); whineNode = { o, g }; }
    whineNode.o.frequency.setTargetAtTime(pitch, a.currentTime, 0.05);
  };
  const resize = () => { dpr = Math.min(Q === 0 ? 2 : Q === 1 ? 1.25 : 1, devicePixelRatio || 1); W = bg.clientWidth; H = bg.clientHeight; canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + "px"; canvas.style.height = H + "px"; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); deco = buildDeco(); LAY = null; };
  const end = () => { evSubmit(); cancelAnimationFrame(raf); whine(false); removeEventListener("resize", resize); removeEventListener("keydown", onKey); removeEventListener("keyup", onKeyUp); detachMotion(); try { actx && actx.close(); } catch { /* ignore */ } bg.remove(); onExit && onExit(); };

  /* ---------- scenery ---------- */
  const rng = (seed) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const wy = () => H * 0.25;
  function buildDeco() {
    const r = rng(L.id.length * 977 + (L.id.charCodeAt(0) || 1)), w = W, y0 = wy(), D = { clouds: [], hills: [], trees: [], reeds: [], pads: [], rocks: [], shadows: [], birds: [], sparkles: [] };
    for (let i = 0; i < 4; i++) D.clouds.push({ x: r() * w, y: 20 + r() * y0 * 0.45, s: 0.7 + r() * 0.9, v: 4 + r() * 8 });
    D.hills = [[0.8, "rgba(165,185,210,.35)", 0.35], [0.55, "rgba(120,150,170,.45)", 0.5], [0.35, "rgba(70,105,90,.6)", 0.8]].map(([amp, col, f]) => ({ col, pts: Array.from({ length: 12 }, (_, i) => [i * w / 11, y0 - 8 - r() * y0 * amp * f]) }));
    const n = Math.round(w / 22);
    for (let i = 0; i < n; i++) D.trees.push({ x: i * 22 + r() * 16, h: 22 + r() * 36, k: r(), pine: L.id !== "pond" ? r() < 0.8 : r() < 0.2 });
    if (L.salt) { D.trees = K === "bay" ? Array.from({ length: 6 }, (_, i) => ({ x: (i + 0.5) * w / 6 + (r() - 0.5) * 30, h: 50 + r() * 40, palm: true, k: r() })) : []; if (K === "ocean") D.hills = []; }
    for (let i = 0; i < 16; i++) D.reeds.push({ x: (i < 8 ? r() * w * 0.28 : w * 0.72 + r() * w * 0.28), h: 26 + r() * 40, ph: r() * 6, cat: r() < 0.5 });
    if (K === "pond") for (let i = 0; i < 9; i++) D.pads.push({ x: r() * w, y: y0 + 60 + r() * (H * 0.45), s: 14 + r() * 14 });
    if (K === "river") for (let i = 0; i < 8; i++) D.rocks.push({ x: r() * w, y: y0 + 50 + r() * (H * 0.55), s: 10 + r() * 22 });
    for (let i = 0; i < 4; i++) D.shadows.push({ x: r() * w, y: y0 + 80 + r() * H * 0.5, s: 14 + r() * 16, v: (r() < 0.5 ? -1 : 1) * (10 + r() * 14) });
    for (let i = 0; i < 2; i++) D.birds.push({ x: r() * w, y: 30 + r() * y0 * 0.4, v: 25 + r() * 20, ph: r() * 6 });
    for (let i = 0; i < 26; i++) D.sparkles.push({ x: r() * w, y: y0 + 10 + r() * (H - y0) * 0.85, ph: r() * 6 });
    D.weeds = Array.from({ length: 22 }, () => ({ x: r() * w, h: 30 + r() * 60, ph: r() * 6, k: r() }));
    D.bubbles = Array.from({ length: 14 }, () => ({ x: r() * w, y: r() * H, v: 12 + r() * 22, s: 1 + r() * 2.5 }));
    D.streaks = Array.from({ length: 10 }, () => ({ x: r() * w, y: y0 + 30 + r() * (H - y0) * 0.8, l: 30 + r() * 70, v: 20 + r() * 30 }));
    D.pebbles = Array.from({ length: 18 }, () => ({ x: r() * w, y: H * 0.915 + r() * H * 0.07, s: 1.5 + r() * 3.5, c: r() }));
    D.boat = { x: w * (0.15 + r() * 0.4), s: 0.8 + r() * 0.5 };
    D.far = Array.from({ length: 18 }, (_, i) => ({ x: i * w / 17 + r() * 8, h: 8 + r() * 16 }));
    return D;
  }
  resize(); addEventListener("resize", resize);

  /* ---------- game state ---------- */
  const CASTS = 3, rivalName = ["Lakeside Lou", "Big Mike", "Sunny", "Cody", "Captain Pete"][Math.floor(Math.random() * 5)];
  let flickPow = null, snag = false, aimX = 0.5, aimDrag = false, aimX0 = 0, agit = 0, ringT = 0, eatFx = false, castAt = -9999, landed = true, achNew = [], target = null, inBag = true, netSave = false, st = "cast", ci = 0, mine = [], rival = [], down = false, powerT = 0, power = 0, great = false, timer = 0, biteAt = 0, msg = "", fish = null, weight = 0, F = null, rec = false, resText = "", earned = { xp: 0, coins: 0 }, btn = null, shakeT = 0, drops = [], rip = [], lastTier = null;
  const setSt = (s) => { st = s; bg.dataset.state = s; };
  setSt("cast");
  const pickFish = (rand = Math.random) => {
    const ws = L.fish.map((n) => FC_FISH[n].w[lureId] * (FC_FISH[n].rare != null ? FC_FISH[n].rare * (1 + 0.08 * upBoat) : 1)); let r = rand() * ws.reduce((a, b) => a + b, 0), i = 0;
    for (; i < ws.length - 1; i++) { if ((r -= ws[i]) <= 0) break; }
    return L.fish[i];
  };
  const rollWeight = (n, good, lv, rand = Math.random) => { const f = FC_FISH[n]; return Math.round((f.min + (f.max - f.min) * Math.pow(rand(), Math.max(0.6, (good ? 1.7 : 2.6) - 0.3 * (lv || 0) - 0.22 * upCharm))) * 100) / 100; };
  const seeded = (i) => rng((duel ? duel.seed : 1) * 31 + i * 7919);
  if (mode === "duel") for (let i = 0; i < CASTS; i++) rival.push(Math.random() < 0.15 ? 0 : rollWeight(pickFish(), Math.random() < 0.4, 0));

  const bobber = () => ({ x: W * aimX, y: H * (0.62 - 0.3 * power) });
  const SNAG = 0.93;
  const shore = () => ({ x: W / 2, y: H * 0.86 });
  const tipPos = () => ({ x: W / 2 + 30 + (F ? -F.t * 14 : 0), y: H * 0.8 + (F ? F.t * 16 : 0) });

  function doCast() {
    audio(); power = flickPow != null ? flickPow : motionOn ? 0.75 : powerT; flickPow = null; great = power > 0.6 && power < 0.9; snag = false;
    if (power > SNAG) {   // way past the green: the lure flies into the weeds and the line breaks
      snag = true; target = null; fcStat("casts", 1); castAt = performance.now(); landed = false; timer = 1.2; setSt("wait"); tick(700, 0.2, 0.25, 1); rip.push({ ...bobber(), a: 1 }); return;
    }
    // the fish is chosen now but you can't see what it is. Bigger fish take longer to bite.
    const sr = mode === "friend" || mode === "event" ? seeded(ci) : Math.random, n = pickFish(sr), w = rollWeight(n, great, lureLv, sr), q = fcTier(n, w)[2];
    target = { n, w, q: Math.max(0, Math.min(1, q)) };
    fcStat("casts", 1); castAt = performance.now(); landed = false;
    timer = (2.6 + Math.random() * 3.4 + target.q * 6 * (1 - 0.1 * lureLv)) * Math.max(0.2, 1 - 0.18 * upBait); setSt("wait"); tick(700, 0.2, 0.25, 1); rip.push({ ...bobber(), a: 1 }); }
  function hook() {
    fish = target.n; weight = target.w; const f = FC_FISH[fish];
    F = fcNewFight(Math.min(1.25, 0.3 + 0.7 * Math.pow(target.q, 0.85) + L.hard + (f.pow || 0))); F.jumpY = 0; F.off = 0; F.dir = 1; bg.dataset.phase = F.ph; setSt("fight"); tick(900, 0.25, 0.08);
  }
  const hooks = { phase: (n) => { bg.dataset.phase = n; if (n === "jump") { splash(0.9); tick(450, 0.3, 0.3, 1); } if (n === "run") clickAcc = 0; } };
  function splash(k) { const b = fightPos(); for (let i = 0; i < 14 * k; i++) drops.push({ x: b.x, y: b.y, vx: (Math.random() - 0.5) * 160, vy: -80 - Math.random() * 140, a: 1 }); rip.push({ x: b.x, y: b.y, a: 1 }); }
  function finish(win) {
    resText = ""; rec = false; achNew = []; earned = { xp: 0, coins: 0 }; whine(false); setTimeout(() => fcCloudPush(true), 400);
    if (!win) netSave = false;
    if (win) {
      mine[ci] = weight; const dex = fcDex(), d = dex[fish] || { best: 0, n: 0 };
      rec = weight > d.best; d.best = Math.max(d.best, weight); d.n++; dex[fish] = d; setPref("fcdex", JSON.stringify(dex));
      earned = { xp: fcXpFor(weight), coins: 0, value: fcValue(fish, weight) }; lastTier = fcTier(fish, weight);
      if (lastTier[0] === "Trophy") fcStat("trophies", 1);
      achNew = fcCheckAch();
      inBag = fcAddToBag(fish, weight);
      setPref("fcxp", String(fcXp() + earned.xp)); tick(1200, 0.25, 0.15, 5); setTimeout(() => tick(1700, 0.25, 0.2, 5), 120);
    } else { mine[ci] = 0; fish = fish && win ? fish : null; }
    setSt("result");
  }
  function lose(text) {
    if (upNet && target && Math.random() < 0.2 * upNet) { msg = ""; fish = target.n; weight = target.w; netSave = true; tick(1000, 0.25, 0.2, 4); finish(true); return; }
    msg = text; fish = null; netSave = false; finish(false);
  }
  let evDone = false;
  function evSubmit() { if (mode !== "event" || evDone) return; evDone = true; fcSubmitEntry(duel.id, mine); }
  function advance() {
    if (mode === "event" && ci >= CASTS - 1) { evSubmit(); resText = "sent"; earned = { xp: 0, coins: 0 }; setSt("over"); return; }
    if (mode === "friend" && ci >= CASTS - 1) {
      const key = duel.a === S.user.uid ? "sa" : "sb";
      updateDoc(doc(db, "duels", duel.id), { [key]: [0, 1, 2].map((i) => +(mine[i] || 0).toFixed(2)) }).catch(() => toast("Couldn't send your score. Check your internet."));
      resText = "sent"; earned = { xp: 0, coins: 0 }; setSt("over"); return;
    }
    if (mode === "duel" && ci >= CASTS - 1) {
      const a = mine.reduce((x, y) => x + y, 0), b = rival.reduce((x, y) => x + y, 0), out = a > b ? "win" : a < b ? "lose" : "draw";
      const bonus = { win: [60, 100], draw: [30, 40], lose: [15, 20] }[out];
      if (out === "win") fcStat("duelWins", 1);
      setPref("fcxp", String(fcXp() + bonus[0])); setPref("fccoins", String(fcCoins() + bonus[1])); earned = { xp: bonus[0], coins: bonus[1] };
      resText = out; setSt("over"); return;
    }
    ci++; fish = null; F = null; target = null; snag = false; setSt("cast"); powerT = 0;
  }
  const act = () => {
    if (st === "cast") doCast();
    else if (st === "wait") { if (snag) { snag = false; lose("Snagged! The line broke."); } else lose("Too early! The fish got spooked."); }
    else if (st === "bite") hook();
  };
  const press = () => { if (st === "result") advance(); else if (st === "over") end(); };
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture?.(e.pointerId); const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (st === "result" || st === "over") { if (btn && x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) press(); return; }
    if (st === "cast") { aimDrag = false; aimX0 = x; down = true; return; }   // a tap casts when you let go. Dragging aims.
    down = true; act();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!down || st !== "cast") return;
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left;
    if (!aimDrag && Math.abs(x - aimX0) > 10) aimDrag = true;
    if (aimDrag) aimX = Math.max(0.12, Math.min(0.88, x / W));
  });
  canvas.addEventListener("pointerup", () => { if (down && st === "cast" && !aimDrag) { down = false; act(); } down = false; aimDrag = false; });
  canvas.addEventListener("pointercancel", () => { down = false; });
  const onKey = (e) => { if (e.key === "Escape") { end(); return; } if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (e.repeat) return; if (st === "result" || st === "over") press(); else { down = true; act(); } } };
  const onKeyUp = (e) => { if (e.key === " " || e.key === "Enter") down = false; };
  addEventListener("keydown", onKey); addEventListener("keyup", onKeyUp);

  /* ---------- drawing ---------- */
  const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const text = (s, x, y, size, color, align, font) => { ctx.font = `bold ${size}px ${font || "system-ui,sans-serif"}`; ctx.textAlign = align || "center"; if (outl) { ctx.lineJoin = "round"; ctx.lineWidth = 3.5; ctx.strokeStyle = "rgba(0,20,30,.5)"; ctx.strokeText(s, x, y); } ctx.fillStyle = color || "#fff"; ctx.fillText(s, x, y); };
  function drawReal(name, x, y, r, dir, rot, open, shadow) {
    const f = FC_FISH[name], h = r * f.asp, SH = shadow ? "rgba(4,24,34,.68)" : null;
    ctx.save(); ctx.translate(x, y); ctx.scale(dir, 1); ctx.rotate(rot || 0);
    // tail
    ctx.fillStyle = SH || f.fin; ctx.beginPath(); ctx.moveTo(-r * 0.7, 0); ctx.quadraticCurveTo(-r * 1.05, -h * 0.25, -r * 1.4, -h * 0.85); ctx.quadraticCurveTo(-r * 1.22, 0, -r * 1.4, h * 0.85); ctx.quadraticCurveTo(-r * 1.05, h * 0.25, -r * 0.7, 0); ctx.fill();
    if (!SH) { ctx.strokeStyle = "rgba(0,0,0,.18)"; ctx.lineWidth = 1; for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(-r * 0.8, 0); ctx.lineTo(-r * 1.3, i * h * 0.3); ctx.stroke(); } }
    // dorsal + belly fins
    ctx.fillStyle = SH || f.fin; ctx.beginPath(); ctx.moveTo(-r * 0.35, -h * 0.75); ctx.quadraticCurveTo(-r * 0.05, -h * 1.55, r * 0.4, -h * 0.85); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-r * 0.3, h * 0.75); ctx.quadraticCurveTo(-r * 0.4, h * 1.3, -r * 0.05, h * 0.85); ctx.closePath(); ctx.fill();
    // body
    const g = ctx.createLinearGradient(0, -h, 0, h); g.addColorStop(0, f.top); g.addColorStop(0.5, f.top); g.addColorStop(0.72, f.belly); g.addColorStop(1, f.belly);
    ctx.fillStyle = SH || g; ctx.beginPath(); ctx.moveTo(r, h * 0.05); ctx.bezierCurveTo(r * 0.8, -h * 0.95, -r * 0.2, -h * 1.15, -r * 0.75, -h * 0.28); ctx.lineTo(-r * 0.75, h * 0.28); ctx.bezierCurveTo(-r * 0.2, h * 1.1, r * 0.75, h * 0.95, r, h * 0.05); ctx.closePath(); ctx.fill();
    if (SH) { ctx.restore(); return; }
    ctx.save(); ctx.clip(); ctx.fillStyle = f.patc; ctx.strokeStyle = f.patc; ctx.lineWidth = 1;
    if (f.pat === "bars") for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.ellipse(-r * 0.55 + i * r * 0.27, -h * 0.15, r * 0.05, h * 0.85, 0.1, 0, 7); ctx.fill(); }
    else if (f.pat === "stripe") for (let i = 0; i < 8; i++) { ctx.beginPath(); ctx.ellipse(-r * 0.6 + i * r * 0.2, -h * 0.05 + (i % 2) * h * 0.03, r * 0.13, h * 0.17, 0, 0, 7); ctx.fill(); }
    else if (f.pat === "spots") for (let i = 0; i < 22; i++) { ctx.beginPath(); ctx.arc(-r * 0.7 + rnd(i) * r * 1.5, -h * 0.85 + rnd(i + 50) * h * 1.2, r * 0.035 + rnd(i + 9) * r * 0.02, 0, 7); ctx.fill(); }
    else if (f.pat === "saddles") for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.ellipse(-r * 0.5 + i * r * 0.27, -h * 0.8, r * 0.09, h * 0.55, 0, 0, 7); ctx.fill(); }
    else if (f.pat === "bean") for (let i = 0; i < 18; i++) { ctx.beginPath(); ctx.ellipse(-r * 0.65 + (i % 9) * r * 0.16, (i < 9 ? -h * 0.45 : h * 0.1), r * 0.05, h * 0.07, 0, 0, 7); ctx.fill(); }
    else if (f.pat === "speckle") { for (let i = 0; i < 40; i++) { ctx.beginPath(); ctx.arc(-r * 0.7 + rnd(i) * r * 1.6, -h * 0.9 + rnd(i + 77) * h * 1.1, r * 0.02, 0, 7); ctx.fill(); } if (!f.nostripe) { ctx.globalAlpha = 0.85; ctx.fillStyle = "#e0728f"; ctx.beginPath(); ctx.ellipse(-r * 0.05, h * 0.02, r * 0.8, h * 0.13, 0, 0, 7); ctx.fill(); ctx.globalAlpha = 1; } }
    else if (f.pat === "scales") for (let row = -3; row <= 3; row++) for (let c = 0; c < 9; c++) { ctx.beginPath(); ctx.arc(-r * 0.7 + c * r * 0.17 + (row % 2) * r * 0.08, row * h * 0.26, r * 0.09, 0.2, Math.PI - 0.2); ctx.stroke(); }
    ctx.fillStyle = "rgba(255,255,255,.16)"; ctx.beginPath(); ctx.ellipse(r * 0.05, -h * 0.55, r * 0.62, h * 0.18, 0, 0, 7); ctx.fill();
    ctx.restore();
    // gill, pectoral fin, mouth, eye
    ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(r * 0.42, h * 0.02, h * 0.55, -1.2, 1.2); ctx.stroke();
    ctx.fillStyle = f.fin; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.ellipse(r * 0.28, h * 0.25, r * 0.16, h * 0.14, -0.5, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    if (f.ear) { ctx.fillStyle = f.fin; ctx.beginPath(); ctx.ellipse(r * 0.42, -h * 0.05, r * 0.07, h * 0.1, 0, 0, 7); ctx.fill(); }
    ctx.strokeStyle = "rgba(0,0,0,.5)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(r * 0.98, h * 0.12); ctx.lineTo(r * (f.jaw ? 0.6 : 0.8), h * (open ? 0.3 : 0.2)); ctx.stroke();
    if (f.whisk) { ctx.strokeStyle = "#444"; ctx.lineWidth = 1.5; for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(r * 0.95, h * 0.1); ctx.quadraticCurveTo(r * 1.15, h * (0.3 + 0.2 * s), r * 1.0, h * (0.6 + 0.3 * s)); ctx.stroke(); } }
    const er = f.bigEye ? h * 0.2 : h * 0.15; ctx.fillStyle = f.bigEye ? "#e8e3b0" : "#f4f1e8"; ctx.beginPath(); ctx.arc(r * 0.68, -h * 0.2, er, 0, 7); ctx.fill();
    ctx.fillStyle = "#111"; ctx.beginPath(); ctx.arc(r * 0.7, -h * 0.2, er * 0.6, 0, 7); ctx.fill(); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(r * 0.72, -h * 0.25, er * 0.2, 0, 7); ctx.fill();
    ctx.restore();
  }
  const fishR = (n, w) => { const f = FC_FISH[n], q = (w - f.min) / (f.max - f.min); return f.r * (0.7 + 0.9 * Math.sqrt(Math.max(0, q))) * (H > W ? 1 : 0.85); };
  function fightPos() {
    const b = bobber(), sh = shore();
    if (!F) return b;
    const k = 1 - F.d / 100, base = { x: b.x + (sh.x - b.x) * k, y: b.y + (sh.y - 44 - b.y) * k };
    const amp = { rest: 10, pull: 26, run: 70 + 60 * F.s, thrash: 22, jump: 20 }[F.ph] * (0.4 + k * 0.3 + 0.4);
    F.off += ((Math.sin(F.time * (F.ph === "run" ? 2.2 : 3)) * amp * (F.ph === "run" ? F.runDir : 1)) - F.off) * 0.08;
    return { x: base.x + F.off, y: base.y - (F.ph === "jump" && F.phA < 1 ? Math.sin(F.phA * Math.PI) * (50 + 40 * F.s) : 0) };
  }
  /* the bobber (a push-button bobber, like the real ones) only shows when you fish the worm. Other lures show up in the water. */
  function drawBobber(x, y, k) {
    const r = 11 * k, g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.6, 1, x, y - r * 0.2, r * 1.2);
    ctx.fillStyle = "rgba(190,40,32,.5)"; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI); ctx.fill();                 // red half under the water
    ctx.fillStyle = "#c81f17"; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - 3.6 * k, y - r - 7 * k, 7.2 * k, 9 * k, 2 * k) : ctx.rect(x - 3.6 * k, y - r - 7 * k, 7.2 * k, 9 * k); ctx.fill();      // red push button
    ctx.fillStyle = "rgba(255,255,255,.45)"; ctx.fillRect(x - 2.2 * k, y - r - 5.5 * k, 1.6 * k, 5 * k);
    g.addColorStop(0, "#ffffff"); g.addColorStop(0.7, "#eef1f2"); g.addColorStop(1, "#b9c3c7"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, Math.PI, 0); ctx.closePath(); ctx.fill();   // white dome
    ctx.fillStyle = "#d3251b"; ctx.beginPath(); ctx.ellipse(x, y, r + 2.4 * k, 3.1 * k, 0, 0, 7); ctx.fill();         // red lip where the two halves meet
    ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.beginPath(); ctx.ellipse(x, y - 0.8 * k, r + 1.2 * k, 1 * k, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.75)"; ctx.beginPath(); ctx.ellipse(x - r * 0.42, y - r * 0.62, r * 0.28, r * 0.15, -0.6, 0, 7); ctx.fill();
  }
  // a lure under the water: drawn on its own, then tinted blue so it looks like it is really down there
  let lureTmp = null;
  function drawLureWet(id, x, y, k, now) {
    if (!lureTmp || lureTmp.d !== dpr) { const c = document.createElement("canvas"); c.width = Math.round(80 * dpr); c.height = Math.round(80 * dpr); const cx = c.getContext("2d"); lureTmp = { c, cx, d: dpr }; }
    const { c, cx } = lureTmp, main = ctx;
    cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.clearRect(0, 0, 80, 80); ctx = cx; drawLure(id, 40, 30, k, now); ctx = main;
    cx.globalCompositeOperation = "source-atop"; cx.fillStyle = "rgba(25,105,150,.4)"; cx.fillRect(0, 0, 80, 80);
    cx.fillStyle = "rgba(120,200,225,.1)"; cx.fillRect(0, 0, 80, 80); cx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 0.9 + Math.sin(now / 240) * 0.06; ctx.drawImage(c, 0, 0, c.width, c.height, x - 40, y - 30, 80, 80); ctx.globalAlpha = 1;
  }
  function drawLure(id, x, y, k, now) {
    ctx.save(); ctx.translate(x, y); ctx.scale(k, k); ctx.globalAlpha = 0.92;
    if (id === "spinner") { const w = 5 + Math.abs(Math.sin(now / 70)) * 5;
      ctx.fillStyle = "#c8d0d4"; ctx.beginPath(); ctx.ellipse(0, 6, 3, 8, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "#e9c46a"; ctx.beginPath(); ctx.ellipse(w * 0.2, -2, w, 6, Math.sin(now / 90) * 0.5, 0, 7); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.beginPath(); ctx.ellipse(w * 0.2 - 2, -4, w * 0.4, 2, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = "#aab4b8"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 15, 3, 0, 4.7); ctx.stroke(); }
    else if (id === "crank") { ctx.fillStyle = "#e8a23a"; ctx.beginPath(); ctx.ellipse(0, 4, 13, 7, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "#c4502a"; ctx.beginPath(); ctx.ellipse(2, 7, 11, 3, 0, 0, Math.PI); ctx.fill();
      ctx.fillStyle = "#6d4a2a"; ctx.beginPath(); ctx.moveTo(-12, 2); ctx.lineTo(-20, -4); ctx.lineTo(-14, 6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(7, 2, 2.4, 0, 7); ctx.fill(); ctx.fillStyle = "#111"; ctx.beginPath(); ctx.arc(7.4, 2, 1.1, 0, 7); ctx.fill(); }
    else { ctx.fillStyle = "#d94a2a"; ctx.beginPath(); ctx.arc(0, 2, 6.5, 0, 7); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.beginPath(); ctx.arc(-2, 0, 2, 0, 7); ctx.fill();
      ctx.strokeStyle = "#f4f1e6"; ctx.lineWidth = 2; ctx.lineCap = "round"; for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * 1.8, 8); ctx.quadraticCurveTo(i * 3 + Math.sin(now / 160 + i) * 3, 14, i * 3.4, 21); ctx.stroke(); } }
    ctx.restore();
  }
  /* ---------- the parts that never move are painted once and kept, so low-end phones only redraw what moves ---------- */
  const mkLayer = () => { const c = document.createElement("canvas"); c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); const x = c.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0); return { c, x }; };
  function buildLayers() {
    const y0 = wy(), D = deco, t = 0, main = ctx, la = mkLayer(), lb = mkLayer(), lc = mkLayer(), ld = mkLayer(), lr = mkLayer();
    ctx = la.x;
    const SKY = TOD === "night" ? ["#060b22", "#2a4270"] : TOD === "dusk" ? ["#ff8f5a", "#ffd6a0"] : TOD === "dawn" ? ["#f4a9c0", "#ffe4c6"] : L.sky;
    let g = ctx.createLinearGradient(0, 0, 0, y0); g.addColorStop(0, SKY[0]); g.addColorStop(1, SKY[1]); ctx.fillStyle = g; ctx.fillRect(0, 0, W, y0);
    if (TOD === "night") {
      for (let i = 0; i < 40; i++) { const sx = rnd(i * 3) * W, sy = rnd(i * 3 + 1) * y0 * 0.85; ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.5 * Math.abs(Math.sin(t * 1.2 + i))})`; ctx.fillRect(sx, sy, 1.6, 1.6); }
      const mg = ctx.createRadialGradient(W * 0.8, y0 * 0.35, 6, W * 0.8, y0 * 0.35, 60); mg.addColorStop(0, "rgba(240,244,255,.5)"); mg.addColorStop(1, "rgba(240,244,255,0)"); ctx.fillStyle = mg; ctx.fillRect(W * 0.8 - 70, y0 * 0.35 - 70, 140, 140);
      ctx.fillStyle = "#f3f5ff"; ctx.beginPath(); ctx.arc(W * 0.8, y0 * 0.35, 15, 0, 7); ctx.fill(); ctx.fillStyle = "rgba(150,160,190,.4)"; ctx.beginPath(); ctx.arc(W * 0.8 - 4, y0 * 0.35 - 3, 4, 0, 7); ctx.arc(W * 0.8 + 5, y0 * 0.35 + 5, 3, 0, 7); ctx.fill();
    } else {
      const sy = TOD === "dusk" ? y0 * 0.82 : TOD === "dawn" ? y0 * 0.7 : y0 * 0.35, warm = TOD === "dusk" || TOD === "dawn";
      const sg = ctx.createRadialGradient(W * 0.8, sy, 4, W * 0.8, sy, warm ? 95 : 70); sg.addColorStop(0, warm ? "rgba(255,226,170,1)" : "rgba(255,246,200,1)"); sg.addColorStop(0.25, warm ? "rgba(255,170,100,.8)" : "rgba(255,236,170,.8)"); sg.addColorStop(1, "rgba(255,200,120,0)"); ctx.fillStyle = sg; ctx.fillRect(W * 0.8 - 100, sy - 100, 200, 200);
    }
    ctx = lb.x;
    for (const hl of D.hills) { ctx.fillStyle = hl.col; ctx.beginPath(); ctx.moveTo(0, y0); hl.pts.forEach(([x, y], i) => { if (i === 0) ctx.lineTo(x, y); else { const [px, py] = hl.pts[i - 1]; ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2); } }); ctx.lineTo(W, y0); ctx.closePath(); ctx.fill(); }
    if (!L.salt) { ctx.fillStyle = "rgba(50,88,72,.55)"; for (const f of D.far) { ctx.beginPath(); ctx.moveTo(f.x - 7, y0); ctx.lineTo(f.x, y0 - f.h); ctx.lineTo(f.x + 7, y0); ctx.fill(); } }
    for (const tr of D.trees) { const base = y0 + 2;
      if (tr.palm) { const tx = tr.x + (tr.k - 0.5) * 30, ty = base - tr.h; ctx.strokeStyle = "#6b4f2c"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(tr.x, base); ctx.quadraticCurveTo(tr.x + (tr.k - 0.5) * 14, base - tr.h * 0.5, tx, ty); ctx.stroke(); ctx.strokeStyle = "#2f8a46"; ctx.lineWidth = 3; for (let i = 0; i < 7; i++) { const ang = -Math.PI / 2 + (i - 3) * 0.55; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo(tx + Math.cos(ang) * 22, ty + Math.sin(ang) * 22 - 6, tx + Math.cos(ang) * 38, ty + Math.sin(ang) * 38 + 10 + Math.sin(t * 1.5 + i) * 2); ctx.stroke(); } continue; }
      const pal = K === "river" ? ["#2f5a3a", "#427a52", "#24472e"] : K === "lake" ? ["#244b36", "#33694c", "#1b3a2a"] : ["#3d7a42", "#5fa75c", "#2f6334"], dark = tr.k > 0.5 ? pal[0] : pal[2];
      ctx.fillStyle = "rgba(10,30,20,.25)"; ctx.beginPath(); ctx.ellipse(tr.x, base + 1, 9 + tr.k * 5, 2.5, 0, 0, 7); ctx.fill();
      if (tr.pine) {
        ctx.fillStyle = "#4a3523"; ctx.fillRect(tr.x - 2, base - tr.h * 0.32, 4, tr.h * 0.32 + 1); ctx.fillStyle = "#35261a"; ctx.fillRect(tr.x, base - tr.h * 0.32, 2, tr.h * 0.32 + 1);
        for (let k = 0; k < 3; k++) { const yb = base - tr.h * (0.25 + k * 0.28), yt = base - tr.h * (0.65 + k * 0.28), hw = 11 - k * 2;
          ctx.fillStyle = dark; ctx.beginPath(); ctx.moveTo(tr.x - hw, yb); ctx.lineTo(tr.x, yt); ctx.lineTo(tr.x + hw, yb); ctx.closePath(); ctx.fill();
          ctx.fillStyle = pal[1]; ctx.beginPath(); ctx.moveTo(tr.x - hw * 0.1, yb); ctx.lineTo(tr.x, yt); ctx.lineTo(tr.x - hw, yb); ctx.closePath(); ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1; } }
      else {
        const rr = 10 + tr.k * 8, cy = base - tr.h * 0.45 - rr * 0.8;
        ctx.fillStyle = "#4a3523"; ctx.beginPath(); ctx.moveTo(tr.x - 3, base + 1); ctx.lineTo(tr.x - 1.5, cy); ctx.lineTo(tr.x + 1.5, cy); ctx.lineTo(tr.x + 3, base + 1); ctx.fill(); ctx.fillStyle = "#35261a"; ctx.fillRect(tr.x + 0.5, cy, 2, base - cy);
        ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(tr.x, cy, rr, 0, 7); ctx.arc(tr.x - rr * 0.7, cy + rr * 0.3, rr * 0.7, 0, 7); ctx.arc(tr.x + rr * 0.7, cy + rr * 0.3, rr * 0.7, 0, 7); ctx.fill();
        ctx.fillStyle = pal[1]; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.arc(tr.x - rr * 0.3, cy - rr * 0.3, rr * 0.6, 0, 7); ctx.fill(); ctx.globalAlpha = 1; } }
    ctx = lc.x;
    g = ctx.createLinearGradient(0, y0, 0, H); g.addColorStop(0, L.water[0]); g.addColorStop(1, L.water[1]); ctx.fillStyle = g; ctx.fillRect(0, y0, W, H - y0);
    ctx.fillStyle = "rgba(255,255,255,.1)"; ctx.fillRect(0, y0, W, 18);
    const hz = ctx.createLinearGradient(0, y0 - 26, 0, y0 + 40); hz.addColorStop(0, "rgba(255,255,255,0)"); hz.addColorStop(0.45, "rgba(255,255,255,.3)"); hz.addColorStop(1, "rgba(255,255,255,0)"); ctx.fillStyle = hz; ctx.fillRect(0, y0 - 26, W, 66);
    ctx = ld.x;
    const vg = ctx.createRadialGradient(W / 2, H * 0.5, H * 0.25, W / 2, H * 0.5, H * 0.8); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, K === "ocean" ? "rgba(0,10,30,.45)" : "rgba(0,15,25,.3)"); ctx.fillStyle = vg; ctx.fillRect(0, y0, W, H - y0);
    // bank
    const by = H * 0.9; g = ctx.createLinearGradient(0, by, 0, H); g.addColorStop(0, L.salt ? "#e5d3a1" : "#7a6440"); g.addColorStop(1, L.salt ? "#c3ac75" : "#5a4a2e"); ctx.fillStyle = g; ctx.fillRect(0, by, W, H - by);
    ctx.fillStyle = L.salt ? "#cdb97f" : "#4d7a35"; ctx.beginPath(); ctx.moveTo(0, by + 4); for (let x = 0; x <= W; x += 10) ctx.lineTo(x, by - 2 + Math.sin(x * 0.2) * 3); ctx.lineTo(W, by + 8); ctx.lineTo(0, by + 8); ctx.fill();
    ctx.fillStyle = L.salt ? "#8c8272" : "#6b4a2a"; ctx.fillRect(0, by - 10, W * 0.2, 7); for (let i = 0; i < 5; i++) ctx.fillRect(i * W * 0.045, by - 2, 5, 22); ctx.fillStyle = "rgba(0,0,0,.2)"; ctx.fillRect(0, by - 3, W * 0.2, 2);
    ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 2; ctx.beginPath(); for (let x = 0; x <= W; x += 12) ctx.lineTo(x, by - 3 + Math.sin(x * 0.1 + t * 2) * 1.5); ctx.stroke();
    ctx.fillStyle = "rgba(0,0,0,.28)"; for (let i = 0; i < 6; i++) ctx.fillRect(W * 0.02 + i * W * 0.032, by - 10, 1.5, 7);
    for (const pb of D.pebbles) { const c = pb.c; ctx.fillStyle = L.salt ? `rgba(${(150 + c * 60) | 0},${(135 + c * 50) | 0},${(105 + c * 40) | 0},.85)` : `rgba(${(100 + c * 70) | 0},${(95 + c * 60) | 0},${(85 + c * 40) | 0},.85)`; ctx.beginPath(); ctx.ellipse(pb.x, pb.y, pb.s * 1.4, pb.s, 0, 0, 7); ctx.fill(); }
    // the mirror image of the shore and sky, flipped and faded once. Fast phones bend it with tiny waves.
    const rx = lr.x; rx.setTransform(dpr, 0, 0, -dpr, 0, y0 * dpr);
    rx.drawImage(la.c, 0, 0, la.c.width, y0 * dpr, 0, 0, W, y0); rx.drawImage(lb.c, 0, 0, lb.c.width, y0 * dpr, 0, 0, W, y0);
    rx.setTransform(dpr, 0, 0, dpr, 0, 0); rx.globalCompositeOperation = "destination-in";
    const fg = rx.createLinearGradient(0, 0, 0, y0 * 0.95); fg.addColorStop(0, "rgba(0,0,0,1)"); fg.addColorStop(1, "rgba(0,0,0,0)"); rx.fillStyle = fg; rx.fillRect(0, 0, W, y0 * 0.95);
    ctx = main; LAY = { a: la.c, b: lb.c, c: lc.c, d: ld.c, r: lr.c };
  }
  const blit = (c) => ctx.drawImage(c, 0, 0, c.width, c.height, 0, 0, W, H);
  function scene(now) {
    if (!LAY) buildLayers();
    const y0 = wy(), D = deco, t = now / 1000, by = H * 0.9;
    blit(LAY.a);
    ctx.globalAlpha = TOD === "night" ? 0.3 : 1; for (const [col, oy] of [["rgba(175,194,220,.55)", 5], ["rgba(255,255,255,.9)", 0]]) { ctx.fillStyle = col; for (const c of D.clouds) { const cx = ((c.x + t * c.v) % (W + 160)) - 80; for (const [dx, dy, rr] of [[0, 0, 16], [16, -6, 20], [34, 0, 15], [14, 6, 14]]) { ctx.beginPath(); ctx.arc(cx + dx * c.s, c.y + dy * c.s + oy * c.s, rr * c.s, 0, 7); ctx.fill(); } } }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#2a2a2a"; ctx.lineWidth = 1.6; for (const b of D.birds) { const bx = ((b.x + t * b.v) % (W + 60)) - 30, fl = Math.sin(t * 7 + b.ph) * 4; ctx.beginPath(); ctx.moveTo(bx - 8, b.y - fl); ctx.quadraticCurveTo(bx - 3, b.y - 4, bx, b.y); ctx.quadraticCurveTo(bx + 3, b.y - 4, bx + 8, b.y - fl); ctx.stroke(); }
    blit(LAY.b);
    if (L.salt || L.big) { const bx = (D.boat.x + t * 3) % (W + 80) - 40, sc = D.boat.s, b0 = y0 - 1 + Math.sin(t * 1.2); ctx.fillStyle = "#f4f1e8"; ctx.beginPath(); ctx.moveTo(bx, b0 - 22 * sc); ctx.lineTo(bx + 12 * sc, b0 - 3 * sc); ctx.lineTo(bx, b0 - 3 * sc); ctx.fill(); ctx.fillStyle = "#e3ddc9"; ctx.beginPath(); ctx.moveTo(bx - 2 * sc, b0 - 18 * sc); ctx.lineTo(bx - 10 * sc, b0 - 3 * sc); ctx.lineTo(bx - 2 * sc, b0 - 3 * sc); ctx.fill(); ctx.fillStyle = "#3b4a5a"; ctx.fillRect(bx - 12 * sc, b0 - 3 * sc, 26 * sc, 4 * sc); }
    blit(LAY.c);
    // mirror image of the shore and sky on the water. Fast phones bend it with tiny waves.
    { const al = TOD === "night" ? 0.16 : 0.26, rh = y0 * 0.95; ctx.globalAlpha = al;
      if (Q < 1) { const calm = (K === "ocean" || L.big ? 2.2 : K === "river" ? 1.6 : 1) * (1 + agit * 2); for (let r = 0; r < rh; r += 6) ctx.drawImage(LAY.r, 0, r * dpr, W * dpr, 6 * dpr, Math.sin(t * 1.6 + r / 5) * (1 + r / y0 * 4) * calm, y0 + r, W, 6); }
      else ctx.drawImage(LAY.r, 0, 0, W * dpr, rh * dpr, 0, y0, W, rh);
      ctx.globalAlpha = 1; }
    if (Q < 1 && (TOD === "dawn" || TOD === "dusk")) for (let i = 0; i < 3; i++) { const mx = ((i * W * 0.45 + t * (6 + i * 3)) % (W * 1.5)) - W * 0.25, mg = ctx.createRadialGradient(mx, y0 + 6, 4, mx, y0 + 6, W * 0.4); mg.addColorStop(0, "rgba(255,255,255,.22)"); mg.addColorStop(1, "rgba(255,255,255,0)"); ctx.fillStyle = mg; ctx.fillRect(mx - W * 0.4, y0 - 24, W * 0.8, 60); }
    // light shafts from the sky and the sun's glitter on the water
    if (Q < 1) for (let i = 0; i < 5; i++) { const x = W * (i + 0.3) / 5 + Math.sin(t * 0.25 + i * 1.7) * 24, wd = 26 + 14 * Math.sin(i * 2.3 + t * 0.4), a = (K === "ocean" || L.big ? 0.14 : 0.09) * (0.6 + 0.4 * Math.sin(t * 0.7 + i));
      const rg = ctx.createLinearGradient(0, y0, 0, H * 0.85); rg.addColorStop(0, `rgba(255,255,255,${a})`); rg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = rg; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x + wd, y0); ctx.lineTo(x + wd * 2.4 - 70, H * 0.85); ctx.lineTo(x - wd * 1.4 - 70, H * 0.85); ctx.closePath(); ctx.fill(); }
    if (Q < 2) for (let i = 0; i < 16; i++) { const ww = 30 - i * 1.4 + Math.sin(t * 3 + i * 1.3) * 8; if (ww > 2) { ctx.fillStyle = `rgba(255,248,210,${0.5 - i * 0.025})`; ctx.fillRect(W * 0.8 - ww / 2 + Math.sin(t * 1.5 + i) * 6, y0 + 4 + i * 11, ww, 2); } }
    for (const s of D.shadows) { const sx = ((s.x + t * s.v) % (W + 80) + W + 80) % (W + 80) - 40; ctx.fillStyle = "rgba(0,20,30,.18)"; ctx.beginPath(); ctx.ellipse(sx, s.y, s.s * 1.5, s.s * 0.55, 0, 0, 7); ctx.fill(); ctx.beginPath(); ctx.moveTo(sx - s.s * 1.4 * Math.sign(s.v), s.y); ctx.lineTo(sx - s.s * 2.2 * Math.sign(s.v), s.y - s.s * 0.5); ctx.lineTo(sx - s.s * 2.2 * Math.sign(s.v), s.y + s.s * 0.5); ctx.fill(); }
    ctx.strokeStyle = "rgba(255,255,255,.2)"; ctx.lineWidth = 2;
    for (let i = 0; i < (Q >= 2 ? 3 : 6); i++) { const y = y0 + 30 + i * (H - y0) / 6.5; ctx.beginPath(); for (let x = 0; x <= W; x += 14) ctx.lineTo(x, y + Math.sin(x / 30 + now / 500 + i) * (K === "ocean" || L.big ? 6 : 3) * (1 + agit * 2.4) + Math.sin(x / 13 - now / 170 + i) * agit * 3.2); ctx.stroke(); }
    // small bright wavelets: bigger and wider the closer they are to you, drifting with the wind
    for (let i = 0; i < (Q >= 2 ? 10 : Q ? 24 : 46); i++) { const dpt = Math.pow(rnd(i * 5 + 2), 1.5), wy2 = y0 + 8 + dpt * (H * 0.88 - y0), wx = ((rnd(i * 5 + 1) * W + t * (6 + 10 * rnd(i + 9)) * (0.4 + dpt) * (1 + agit * 2.2)) % (W + 40)) - 20, len = 5 + dpt * 26 + rnd(i + 4) * 6, al = (0.12 + 0.2 * Math.abs(Math.sin(t * 1.3 + i))) * (0.4 + dpt) * (1 + agit * 0.9);
      ctx.strokeStyle = `rgba(255,255,255,${al})`; ctx.lineWidth = 1 + dpt * 1.5; ctx.beginPath(); ctx.moveTo(wx, wy2); ctx.quadraticCurveTo(wx + len / 2, wy2 - 1.5 - dpt * 2, wx + len, wy2); ctx.stroke(); }
    // caustics: moving net of light on the bottom of shallow water
    if (Q < 1 && !(K === "ocean" || L.big)) { ctx.strokeStyle = "rgba(255,255,230,.07)"; ctx.lineWidth = 1.5; for (let i = 0; i < 9; i++) { const cy2 = H * 0.62 + i * (H * 0.3 / 9); ctx.beginPath(); for (let x = 0; x <= W; x += 12) ctx.lineTo(x, cy2 + Math.sin(x / 22 + t * 1.2 + i * 1.9) * 5 + Math.cos(x / 41 - t * 0.8 + i) * 4); ctx.stroke(); } }
    if (K === "river") for (const sk of D.streaks) { const sx = ((sk.x + t * sk.v) % (W + 140)) - 70; ctx.strokeStyle = "rgba(255,255,255,.22)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx, sk.y); ctx.lineTo(sx + sk.l, sk.y + 1); ctx.stroke(); }
    for (const p of D.pads) { ctx.fillStyle = "#3e8a45"; ctx.beginPath(); ctx.ellipse(p.x, p.y, p.s, p.s * 0.45, 0, 0.3, Math.PI * 2 - 0.1); ctx.lineTo(p.x, p.y); ctx.fill(); if (p.s > 22) { ctx.fillStyle = "#f6b6cc"; ctx.beginPath(); ctx.arc(p.x + 3, p.y - 3, 4, 0, 7); ctx.fill(); } }
    for (const rk of D.rocks) { ctx.fillStyle = "#59666b"; ctx.beginPath(); ctx.ellipse(rk.x, rk.y, rk.s, rk.s * 0.55, 0, Math.PI, 0); ctx.fill(); ctx.fillStyle = "rgba(255,255,255,.4)"; ctx.fillRect(rk.x - rk.s, rk.y - 1, rk.s * 2, 2); }
    if (Q < 2) for (const s of D.sparkles) { const a = Math.max(0, Math.sin(t * 2 + s.ph)); if (a > 0.6) { ctx.fillStyle = `rgba(255,255,255,${(a - 0.6) * 1.6})`; ctx.fillRect(s.x - 4, s.y, 8, 1.5); } }
    ctx.lineCap = "round";
    for (const [wi, wd] of D.weeds.entries()) { if (Q >= 2 && wi % 2) continue; const bx = wd.x, b0 = H * 0.9; ctx.strokeStyle = L.salt ? (wd.k < 0.5 ? "rgba(214,98,84,.32)" : "rgba(30,110,70,.32)") : "rgba(20,70,40,.34)"; ctx.lineWidth = 3 + wd.k * 3; ctx.beginPath(); ctx.moveTo(bx, b0); ctx.bezierCurveTo(bx + Math.sin(t * 1.1 + wd.ph) * 10, b0 - wd.h * 0.35, bx - Math.sin(t * 1.3 + wd.ph) * 10, b0 - wd.h * 0.7, bx + Math.sin(t * 1.2 + wd.ph) * 14, b0 - wd.h); ctx.stroke(); }
    if (Q < 2) for (const [bi, bb] of D.bubbles.entries()) { if (Q && bi % 2) continue; const yy = (((bb.y - t * bb.v) % (H - y0)) + (H - y0)) % (H - y0) + y0; ctx.fillStyle = "rgba(255,255,255,.28)"; ctx.beginPath(); ctx.arc(bb.x + Math.sin(t + bb.y) * 4, yy, bb.s, 0, 7); ctx.fill(); }
    blit(LAY.d);
    if (!L.salt) { ctx.strokeStyle = "#3d6a2b"; ctx.lineWidth = 1.5; for (let x = 4; x < W; x += (Q ? 18 : 9)) { const hh = 6 + ((x * 7) % 9); ctx.beginPath(); ctx.moveTo(x, by + 2); ctx.lineTo(x + Math.sin(t * 2 + x) * 2, by - hh); ctx.stroke(); } }
    for (const r of D.reeds) { const sway = Math.sin(t * 1.4 + r.ph) * 4, rx = r.x, ry = by + 2; ctx.strokeStyle = L.salt ? "#9aa24f" : "#3f6a2c"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(rx, ry); ctx.quadraticCurveTo(rx + sway * 0.5, ry - r.h * 0.5, rx + sway, ry - r.h); ctx.stroke(); if (r.cat && !L.salt) { ctx.fillStyle = "#6a4528"; ctx.beginPath(); ctx.ellipse(rx + sway, ry - r.h - 5, 3, 8, 0, 0, 7); ctx.fill(); } }
    if (TOD !== "day") { ctx.fillStyle = TOD === "night" ? "rgba(6,12,44,.34)" : TOD === "dusk" ? "rgba(255,110,40,.15)" : "rgba(255,170,190,.1)"; ctx.fillRect(0, 0, W, H); }
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (Q >= 2 && last && now - last < 28) return;                      // lightest mode draws about 30 times a second
    const raw = now - (last || now), dt = Math.min(0.05, raw / 1000); last = now; update(dt);
    { const ph0 = F && st === "fight" ? F.ph : "", tg = st === "fight" ? (ph0 === "run" || ph0 === "thrash" || ph0 === "jump" ? 1 : 0.6) : st === "bite" ? 0.35 : 0; agit += (tg - agit) * Math.min(1, dt * 3); }      // the water gets rougher while a fish is on
    if (raw > 0 && ++nfr > 40) { ema += (Math.min(raw, 120) - ema) * 0.08;
      if (nfr % 30 === 0 && ema > 23 && Q < 2) { Q++; setPref("fcq", String(Q)); ema = 17; nfr = 0; resize(); } }      // stuttering, so go lighter
    ctx.save(); if (shakeT > 0) ctx.translate((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
    scene(now);
    const b = bobber(), tip = tipPos();
    // ripples + drops
    for (const r of rip) { r.a -= dt * 0.9; } for (let i = rip.length - 1; i >= 0; i--) if (rip[i].a <= 0) rip.splice(i, 1);
    ctx.lineWidth = 1.5; for (const r of rip) { ctx.strokeStyle = `rgba(255,255,255,${r.a * 0.6})`; ctx.beginPath(); ctx.ellipse(r.x, r.y + 4, (1 - r.a) * 50 + 6, (1 - r.a) * 18 + 2, 0, 0, 7); ctx.stroke(); }
    const flying = (st === "wait" || st === "bite") && now - castAt < 650;
    if (flying) {      // the lure flies out in an arc, then lands with a splash
      const k = (now - castAt) / 650, px = tip.x + (b.x - tip.x) * k, py = tip.y + (b.y - tip.y) * k - Math.sin(k * Math.PI) * H * 0.22;
      ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.quadraticCurveTo((tip.x + px) / 2, (tip.y + py) / 2 + 12 * (1 - k), px, py); ctx.stroke();
      if (lureId === "worm") drawBobber(px, py, 0.75); else drawLure(lureId, px, py, 0.7, now); landed = false;
    } else if ((st === "wait" || st === "bite") && !landed) { landed = true; for (let i = 0; i < 10; i++) drops.push({ x: b.x, y: b.y, vx: (Math.random() - 0.5) * 90, vy: -60 - Math.random() * 90, a: 1 }); rip.push({ x: b.x, y: b.y, a: 1 }); rip.push({ x: b.x, y: b.y, a: 0.7 }); tick(500, 0.2, 0.18, 1); }
    if (st !== "bite") eatFx = false;
    if ((st === "wait" || st === "bite") && !flying) {
      const eaten = st === "bite" && biteAt >= 0.3, since = st === "bite" ? Math.max(0, biteAt - 0.3) : 0, rush = st === "bite" ? Math.min(1, biteAt / 0.3) : 0;
      const dip = st === "bite" ? 7 + Math.sin(now / 40) * 3 : Math.sin(now / 500) * 2 + Math.sin(now / 170 + 1) * 0.8;
      const sink = Math.min(1, Math.max(0, (now - castAt - 650) / 1100)), dep = lureId === "worm" ? 0 : Math.max(64, H * 0.1) * (1 - (1 - sink) * (1 - sink));      // lures sink down into the water after they land
      const lx = b.x + (eaten ? 0 : Math.sin(now / 700) * 4), baitY = b.y + (dep || 24);
      if (!eaten) { ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.quadraticCurveTo((tip.x + b.x) / 2, Math.max(tip.y, b.y) + 26 + Math.sin(now / 900) * 3, b.x, b.y + dip); ctx.stroke();
        ctx.fillStyle = "rgba(0,0,0,.18)"; ctx.beginPath(); ctx.ellipse(b.x + 3, b.y + dip + 9, 10, 3, 0, 0, 7); ctx.fill(); }
      if (!eaten) {
        if (lureId === "worm") drawBobber(b.x, b.y + dip, 1);
        else { const ly = b.y + dip + dep;
          ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(b.x, b.y + dip); ctx.quadraticCurveTo(b.x + 8, b.y + dip + dep * 0.5, lx, ly - 8); ctx.stroke();      // the line goes down through the water
          drawLureWet(lureId, lx, ly, 1, now);
          const hz = ctx.createRadialGradient(lx, ly, 4, lx, ly, 38); hz.addColorStop(0, "rgba(60,150,180,.18)"); hz.addColorStop(1, "rgba(40,120,150,0)"); ctx.fillStyle = hz; ctx.beginPath(); ctx.arc(lx, ly, 38, 0, 7); ctx.fill(); }
        ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(b.x, b.y + 10, 16 + Math.sin(now / 400) * 3, 5, 0, 0, 7); ctx.stroke();
      }
      if (st === "bite" && target) {
        const fr = fishR(target.n, target.w) * 0.75, side = (target.n.length % 2) ? 1 : -1;
        let fx, fy, dir, wob = 0;
        if (!eaten) { const e = 1 - Math.pow(1 - rush, 2); fx = lx + side * (1 - e) * 120; fy = baitY + Math.sin(now / 90) * 3; dir = -side; wob = Math.sin(now / 45) * 0.12; }      // it rushes at the lure
        else { const a = since * 9 + (side > 0 ? 0 : 3.14), rr = 20 * Math.min(1, since * 6) + 6; fx = lx + Math.cos(a) * rr; fy = baitY + Math.sin(a) * rr * 0.4; dir = -Math.sin(a) >= 0 ? 1 : -1; wob = Math.sin(now / 40) * 0.3; }      // it turns in the water with the lure in its mouth
        if (eaten && !eatFx) { eatFx = true; for (let i = 0; i < 12; i++) drops.push({ x: b.x, y: b.y, vx: (Math.random() - 0.5) * 140, vy: -80 - Math.random() * 120, a: 1 }); rip.push({ x: b.x, y: b.y, a: 1 }); rip.push({ x: b.x, y: b.y, a: 0.75 }); rip.push({ x: b.x, y: b.y, a: 0.5 }); tick(260, 0.25, 0.2, 1); }
        if (eaten) {       // the lure is gone: a swirl in the water, and the bobber is pulled under
          const sc = Math.min(1, since * 4); ctx.lineCap = "round";
          for (let arm = 0; arm < 3; arm++) { ctx.strokeStyle = `rgba(255,255,255,${0.42 * (1 - since * 0.5)})`; ctx.lineWidth = 2; ctx.beginPath(); for (let th = 0; th < 4.4; th += 0.3) { const rr = (3 + th * 8) * sc * (1 + since * 0.9), an = th + arm * 2.09 + now / 130; const x = lx + Math.cos(an) * rr, y = baitY + Math.sin(an) * rr * 0.42; th === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.stroke(); }
          ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.ellipse(b.x, b.y + 6, 14 + since * 70, 5 + since * 20, 0, 0, 7); ctx.stroke();
          if (lureId === "worm" && since < 0.28) { ctx.globalAlpha = 1 - since / 0.28; drawBobber(b.x, b.y + dip + since * 90, 1); ctx.globalAlpha = 1; }
          ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.quadraticCurveTo((tip.x + b.x) / 2, Math.max(tip.y, b.y) + 12, b.x, b.y + 4); ctx.lineTo(fx, fy); ctx.stroke();      // the line is tight to the fish
        }
        drawReal(target.n, fx, fy, fr, dir, wob, false, true);
        const fh = ctx.createRadialGradient(fx, fy, fr * 0.3, fx, fy, fr * 1.6); fh.addColorStop(0, "rgba(60,150,180,0)"); fh.addColorStop(1, "rgba(40,120,150,.22)"); ctx.fillStyle = fh; ctx.beginPath(); ctx.arc(fx, fy, fr * 1.6, 0, 7); ctx.fill();
        text("!", b.x, b.y - 34, 54, "#ffd36b");
        if (upFinder) { const t3 = fcTier(target.n, target.w)[0];
          text(upFinder >= 3 ? target.n : upFinder >= 2 ? `${t3} · about ${target.w.toFixed(1)} lb` : t3, b.x, b.y + 56, 17, "#aefcff"); }
      }
    }
    let fp = null;
    if (st === "fight") {
      fp = fightPos(); const ph = F.ph, tn = F.tn ?? F.t, col = tn > 0.72 ? "#ff6b5e" : tn < 0.3 ? "#cfd8dc" : "#fff";
      const sag = (1 - Math.min(1, tn * 1.4)) * 46;      // slack line hangs, tight line goes straight
      ctx.strokeStyle = col; ctx.lineWidth = 1.2 + tn * 2.3; ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.quadraticCurveTo((tip.x + fp.x) / 2, (tip.y + fp.y) / 2 + sag, fp.x, fp.y); ctx.stroke();
      if (tn > 0.72) { ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 1; for (let i = 0; i < 4; i++) { const k = 0.2 + i * 0.2; ctx.beginPath(); ctx.arc(tip.x + (fp.x - tip.x) * k + Math.sin(now / 30 + i) * 2, tip.y + (fp.y - tip.y) * k, 1.5, 0, 7); ctx.stroke(); } }
      const r = fishR(fish, weight), dir = fp.x < tip.x ? 1 : -1, airborne = ph === "jump" && F.phA < 1;
      const wob = Math.sin(F.time * (ph === "thrash" ? 28 : ph === "run" ? 16 : 7)) * (ph === "thrash" ? 0.35 : ph === "run" ? 0.18 : 0.1) + (airborne ? -0.5 + F.phA * 1.0 : 0);
      if (!airborne) { ctx.fillStyle = "rgba(0,0,0,.18)"; ctx.beginPath(); ctx.ellipse(fp.x, fp.y + r * 0.5, r * 1.1, r * 0.3, 0, 0, 7); ctx.fill(); }
      drawReal(fish, fp.x, fp.y, r, dir, wob, ph === "thrash" || airborne, true);
      if (!airborne) { const hg = ctx.createRadialGradient(fp.x, fp.y, r * 0.2, fp.x, fp.y, r * 1.5); hg.addColorStop(0, "rgba(120,170,190,.0)"); hg.addColorStop(1, "rgba(120,170,190,.22)"); ctx.fillStyle = hg; ctx.beginPath(); ctx.ellipse(fp.x, fp.y, r * 1.5, r * 0.8, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.18)"; ctx.lineWidth = 1; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(fp.x - r * 1.2, fp.y + i * r * 0.3); for (let x = -r * 1.2; x <= r * 1.2; x += 8) ctx.lineTo(fp.x + x, fp.y + i * r * 0.3 + Math.sin(x / 9 + now / 160) * 1.5); ctx.stroke(); } }
      ringT -= dt; if (!airborne && ringT <= 0) { ringT = ((ph === "run" || ph === "thrash") ? 0.16 : 0.38) * (Q >= 2 ? 2 : 1); rip.push({ x: fp.x, y: fp.y, a: 1 }); }
      if (ph === "thrash" && !airborne && Math.random() < dt * 14) drops.push({ x: fp.x, y: fp.y, vx: (Math.random() - 0.5) * 160, vy: -90 - Math.random() * 120, a: 1 });
      if (!airborne && (ph === "run" || ph === "pull" || ph === "thrash")) { const wk = 46 + 44 * agit; ctx.strokeStyle = "rgba(255,255,255,.3)"; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(fp.x - dir * r * 1.1, fp.y + 2); ctx.lineTo(fp.x - dir * (r * 1.1 + wk), fp.y - 13 - Math.sin(now / 90) * 2); ctx.moveTo(fp.x - dir * r * 1.1, fp.y + 2); ctx.lineTo(fp.x - dir * (r * 1.1 + wk), fp.y + 17 + Math.sin(now / 110) * 2); ctx.stroke(); }
      if (ph === "run" || ph === "thrash") { ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 2; for (let i = 0; i < 2; i++) { ctx.beginPath(); ctx.ellipse(fp.x, fp.y + 4, 30 + ((now / 8 + i * 60) % 120), 10 + ((now / 20 + i * 20) % 36), 0, 0, 7); ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1; } }
    }
    for (const d of drops) { d.x += d.vx * dt; d.y += d.vy * dt; d.vy += 420 * dt; d.a -= dt * 1.4; ctx.fillStyle = `rgba(255,255,255,${Math.max(0, d.a)})`; ctx.beginPath(); ctx.arc(d.x, d.y, 2.2, 0, 7); ctx.fill(); } for (let i = drops.length - 1; i >= 0; i--) if (drops[i].a <= 0) drops.splice(i, 1);
    // rod (bends when the line is tight)
    const bend = F ? (F.tn ?? F.t) * 26 : 4;
    ctx.strokeStyle = "#2f2217"; ctx.lineCap = "round"; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(W / 2 + 74, H + 12); ctx.quadraticCurveTo(W / 2 + 56 - bend * 0.3, H * 0.9, tip.x, tip.y); ctx.stroke();
    ctx.strokeStyle = "#7d6a55"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(W / 2 + 74, H + 12); ctx.quadraticCurveTo(W / 2 + 56 - bend * 0.3, H * 0.9, tip.x, tip.y); ctx.stroke();
    { const P0 = [W / 2 + 74, H + 12], P1 = [W / 2 + 56 - bend * 0.3, H * 0.9], at = (k) => [(1 - k) * (1 - k) * P0[0] + 2 * k * (1 - k) * P1[0] + k * k * tip.x, (1 - k) * (1 - k) * P0[1] + 2 * k * (1 - k) * P1[1] + k * k * tip.y];
      ctx.strokeStyle = "#b08a5a"; ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(P0[0], P0[1]); const g1 = at(0.13); ctx.lineTo(g1[0], g1[1]); ctx.stroke();      // cork grip
      ctx.strokeStyle = "#8a6a3e"; ctx.lineWidth = 1; for (let k = 0.02; k < 0.13; k += 0.025) { const a = at(k); ctx.beginPath(); ctx.moveTo(a[0] - 6, a[1]); ctx.lineTo(a[0] + 6, a[1]); ctx.stroke(); }
      ctx.strokeStyle = "#c9ccd1"; ctx.lineWidth = 1.6; for (const k of [0.3, 0.5, 0.68, 0.84, 0.95]) { const a = at(k); ctx.beginPath(); ctx.arc(a[0] + 3, a[1] - 1, 3.2 - k * 1.6, 0, 7); ctx.stroke(); }      // line guides
      ctx.fillStyle = "#e5352b"; ctx.beginPath(); ctx.arc(tip.x, tip.y, 2.4, 0, 7); ctx.fill(); }
    ctx.fillStyle = "#222"; ctx.beginPath(); ctx.arc(W / 2 + 66, H * 0.93, 11, 0, 7); ctx.fill(); ctx.strokeStyle = "#aaa"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(W / 2 + 66, H * 0.93, 7, (now / 100) * (F && down ? 1 : 0), (now / 100) * (F && down ? 1 : 0) + 4); ctx.stroke();
    ctx.restore();
    outl = Q > 0; hud(now, fp); outl = false;
    if (st === "result" || st === "over") card(now);
  }
  function hud(now) {
    ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = Q ? 0 : 4;
    if (mode === "duel") {
      const a = mine.reduce((x, y) => x + y, 0), r = rival.slice(0, st === "over" ? CASTS : ci + (st === "result" ? 1 : 0)).reduce((x, y) => x + y, 0);
      text(`Cast ${Math.min(ci + 1, CASTS)} of ${CASTS}`, W / 2, 30, 18);
      text("You " + a.toFixed(1) + " lb", 16, 74, 16, "#fff", "left"); text(rivalName + " " + r.toFixed(1) + " lb", W - 16, 74, 16, "#fff", "right");
    } else if (mode === "friend") {
      const me = duel.a === S.user.uid;
      text(`Duel with @${me ? duel.bName : duel.aName}`, W / 2 - 20, 30, 16); text(`Cast ${Math.min(ci + 1, CASTS)} of ${CASTS}`, W / 2 - 20, 52, 14); text("You " + mine.reduce((x, y) => x + y, 0).toFixed(1) + " lb", 16, 74, 16, "#fff", "left");
    } else if (mode === "event") {
      text(`${L.n} Cup`, W / 2 - 20, 30, 17); text(`Cast ${Math.min(ci + 1, CASTS)} of ${CASTS}`, W / 2 - 20, 52, 14); text("Score " + mine.reduce((x, y) => x + y, 0).toFixed(1) + " lb", 16, 74, 16, "#fff", "left");
    } else text(L.n, W / 2 - 20, 30, 18);
    text("🪙 " + fcCoins(), 16, 30, 16, "#ffd36b", "left"); text("Bag " + fcBag().length + "/" + fcBagMax(), W - 16, 100, 13, fcBag().length >= fcBagMax() - 3 ? "#ffb74d" : "#fff", "right");
    ctx.shadowBlur = 0;
    if (st === "cast") {
      text(motionOn ? "Flick your phone forward to cast." : "Tap to cast. Stop the bar in the green.", W / 2, H * 0.2, 18); text(motionOn ? "Tilt left or right to aim. Tapping works too." : "Drag left or right to pick your spot.", W / 2, H * 0.2 + 24, 14, "#d6eefc");
      { const bb = bobber(), pr = 10 + 4 * Math.sin(now / 220); ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(bb.x, bb.y, pr, 0, 6.2832); ctx.moveTo(bb.x - pr - 6, bb.y); ctx.lineTo(bb.x - pr + 4, bb.y); ctx.moveTo(bb.x + pr - 4, bb.y); ctx.lineTo(bb.x + pr + 6, bb.y); ctx.stroke(); }
      const bx = W * 0.15, bw = W * 0.7, by = H * 0.945;
      if (!motionOn) {   // motion mode has no bar: how hard you flick is how far you cast
      ctx.fillStyle = "rgba(0,0,0,.5)"; ctx.fillRect(bx, by, bw, 14); ctx.fillStyle = "#4caf50"; ctx.fillRect(bx + bw * 0.6, by, bw * 0.3, 14); ctx.fillStyle = "#e53935"; ctx.fillRect(bx + bw * SNAG, by, bw * (1 - SNAG), 14); ctx.fillStyle = "#fff"; ctx.fillRect(bx + bw * power - 3, by - 5, 6, 24); text("SNAG", bx + bw * 0.965, by - 10, 11, "#ff8a80"); }
    }
    if (st === "wait") text(snag ? "Snagged in the weeds..." : "Wait for a bite...", W / 2, H * 0.2, 20, snag ? "#ff8a80" : "#fff");
    if (st === "bite") { text(motionOn ? "FLICK BACK NOW!" : "TAP NOW!", W / 2, H * 0.2, 30, "#ffd36b"); if (motionOn) text("or tap", W / 2, H * 0.2 + 24, 14, "#fff3c4"); }
    if (st === "fight") {
      { const rw = 190, rh = 58, rx = W / 2 - rw / 2, ry = H - rh - 22; ctx.fillStyle = down ? "rgba(214,69,40,.95)" : "rgba(0,0,0,.45)"; ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.lineWidth = 3;
        ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(rx, ry, rw, rh, 29); else ctx.rect(rx, ry, rw, rh); ctx.fill(); ctx.stroke(); text(down ? "REELING..." : "HOLD TO REEL", W / 2, ry + 36, 18); }
      const gx = W - 54, gy = H * 0.3, gh = H * 0.42, gw = 36;
      lineGauge(gx, gy, gw, gh, now, F.tn ?? F.t);
      const ty = gy + gh * (1 - Math.min(1, F.tn ?? F.t)); ctx.fillStyle = "#fff"; ctx.fillRect(gx - 6, ty - 3, gw + 12, 6); text("LINE", gx + gw / 2, gy - 8, 13);
      ctx.fillStyle = "rgba(0,0,0,.4)"; ctx.fillRect(16, gy, 14, gh); ctx.fillStyle = "#ffd36b"; const dh = gh * (1 - F.d / 100); ctx.fillRect(16, gy + gh - dh, 14, dh);
      const msgs = { rest: ["It's tiring! Reel it in!", "#fff"], pull: ["Reel steadily", "#fff"], run: ["FISH RUNNING! Let go!", "#ffb74d"], thrash: ["It's thrashing! Careful!", "#ffb74d"], jump: ["It jumped! Let go!", "#ff8a80"] }[F.ph];
      ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = Q ? 0 : 5; text(msgs[0], W / 2, H * 0.2, 22, msgs[1]); ctx.shadowBlur = 0;
    }
  }
  /* The line gauge is drawn as real line: a loose untied knot at the bottom (too slack), a straight clean line in the middle (just right), and line that frays into 4 damaged strands at the top (about to snap). */
  function lineGauge(gx, gy, gw, gh, now, tn) {
    const cx = gx + gw / 2, yR = gy + gh * 0.28, yG = gy + gh * 0.70, kh = gy + gh - yG, hr = yR - gy, jit = tn > 0.72 ? 1.7 : 0.6;
    ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.fillStyle = "rgba(0,0,0,.42)"; rrect(gx, gy, gw, gh, 9); ctx.fill(); rrect(gx, gy, gw, gh, 9); ctx.clip();
    ctx.fillStyle = "rgba(217,66,58,.3)"; ctx.fillRect(gx, gy, gw, hr); ctx.fillStyle = "rgba(76,175,80,.26)"; ctx.fillRect(gx, yR, gw, yG - yR);
    ctx.fillStyle = "rgba(255,255,255,.2)"; ctx.fillRect(gx, yR - 1, gw, 2); ctx.fillRect(gx, yG - 1, gw, 2);
    // middle: normal, tight line
    ctx.strokeStyle = "rgba(0,0,0,.4)"; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(cx, yR - 2); ctx.lineTo(cx, yG + 2); ctx.stroke();
    ctx.strokeStyle = "#eef3f4"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, yR - 2); ctx.lineTo(cx, yG + 2); ctx.stroke();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx - 0.9, yR); ctx.lineTo(cx - 0.9, yG); ctx.stroke();
    // bottom: an undone knot, loops hanging loose
    ctx.save(); ctx.translate(cx + Math.sin(now / 520) * 1.2, yG); ctx.scale(gw / 38, kh / 96);
    const knot = () => { ctx.beginPath(); ctx.moveTo(0, -2); ctx.bezierCurveTo(0, 10, -13, 14, -12, 28); ctx.bezierCurveTo(-11, 42, 12, 40, 11, 27); ctx.bezierCurveTo(10, 14, -11, 22, -10, 40); ctx.bezierCurveTo(-9, 56, 9, 52, 9, 64); ctx.bezierCurveTo(9, 74, -4, 74, -6, 84); ctx.lineTo(-3, 92); };
    ctx.strokeStyle = "rgba(0,0,0,.4)"; ctx.lineWidth = 5.4; knot(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(9, 64); ctx.bezierCurveTo(15, 70, 14, 80, 8, 90); ctx.stroke();
    ctx.strokeStyle = "#eef3f4"; ctx.lineWidth = 3; knot(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(9, 64); ctx.bezierCurveTo(15, 70, 14, 80, 8, 90); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 1; knot(); ctx.stroke();
    ctx.restore();
    // top: the line splits into 4 strands that end ragged and damaged
    ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(cx, yR + 2); ctx.lineTo(cx, yR - 7); ctx.stroke();
    ctx.strokeStyle = "#f6e9e6"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, yR + 2); ctx.lineTo(cx, yR - 7); ctx.stroke();
    const xo = [-0.36, -0.12, 0.13, 0.37], ln = [0.8, 0.96, 0.6, 0.88];
    for (let i = 0; i < 4; i++) {
      const wb = Math.sin(now / (55 + i * 13) + i * 2) * jit, ex = cx + xo[i] * gw + wb, ey = yR - hr * ln[i], mx = cx + xo[i] * gw * 0.35 + wb * 0.6, my = yR - 7 - (yR - 7 - ey) * 0.5;
      ctx.strokeStyle = "rgba(0,0,0,.3)"; ctx.lineWidth = 2.8; ctx.beginPath(); ctx.moveTo(cx, yR - 7); ctx.quadraticCurveTo(mx, my, ex, ey); ctx.stroke();
      ctx.strokeStyle = i % 2 ? "#ffd9d3" : "#f3e1dc"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx, yR - 7); ctx.quadraticCurveTo(mx, my, ex, ey); ctx.stroke();
      if (i === 1 || i === 3) { ctx.strokeStyle = "#ffd9d3"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx + (i === 1 ? -5 : 5), my - 3); ctx.lineTo(mx + (i === 1 ? 1 : -1), my - 7); ctx.stroke(); }      // a kink where the strand is worn
      ctx.strokeStyle = "rgba(255,225,215,.8)"; ctx.lineWidth = 0.9; for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex + (k - 1) * 3.2 + wb * 0.5, ey - 4 - (k % 2) * 3); ctx.stroke(); }      // frayed fibers
      ctx.fillStyle = "#7a463c"; ctx.beginPath(); ctx.arc(ex, ey, 1.5, 0, 7); ctx.fill();      // burnt, damaged tip
    }
    ctx.restore();
  }
  function rrect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function button(label, y) { const w = Math.min(280, W * 0.7), h = 52, x = (W - w) / 2; btn = { x, y, w, h }; ctx.fillStyle = "#d4442a"; rrect(x, y, w, h, 26); ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = 2; ctx.stroke(); text(label, W / 2, y + 34, 21, "#fff"); }
  function card(now) {
    ctx.fillStyle = "rgba(4,22,30,.7)"; ctx.fillRect(0, 0, W, H);
    const cw = Math.min(W - 28, 420), ch = Math.min(H - 60, 560), cx = (W - cw) / 2, cy = (H - ch) / 2;
    ctx.fillStyle = "#f6f2e7"; rrect(cx, cy, cw, ch, 22); ctx.fill(); ctx.strokeStyle = "#1f5c4d"; ctx.lineWidth = 4; ctx.stroke();
    if (st === "result" && fish) {
      const [tier, , q] = lastTier, big = q > 0.85;
      text(big ? "TROPHY CATCH!" : "You caught one!", W / 2, cy + 46, 26, big ? "#c47a00" : "#1f5c4d", "center", "Georgia,serif");
      const g = ctx.createRadialGradient(W / 2, cy + 150, 10, W / 2, cy + 150, 130); g.addColorStop(0, "rgba(120,190,210,.55)"); g.addColorStop(1, "rgba(120,190,210,0)"); ctx.fillStyle = g; ctx.fillRect(cx, cy + 50, cw, 200);
      drawReal(fish, W / 2 + 6, cy + 150 + Math.sin(now / 500) * 3, Math.min(cw * 0.27, 48 + 56 * Math.sqrt(q)), 1, -0.05, true);
      text(fish, W / 2, cy + 252, 26, "#16352d", "center", "Georgia,serif"); text(lbText(weight), W / 2, cy + 292, 34, "#b45309");
      ctx.fillStyle = q > 0.6 ? "#2e7d32" : "#607d8b"; rrect(W / 2 - 62, cy + 304, 124, 26, 13); ctx.fill(); text(tier, W / 2, cy + 323, 15, "#fff");
      let ry = cy + 360;
      if (netSave) { text("The net saved it!", W / 2, ry - 26, 17, "#2e7d32"); }
      text(inBag ? "Added to your bag" : "Your bag is full, so you let it go", W / 2, ry, 18, inBag ? "#2e6a5a" : "#b23a2a"); ry += 28; text(inBag ? `Worth 🪙 ${earned.value} when you sell it` : "Sell some fish in the menu first", W / 2, ry, 16, "#8a5a00"); ry += 26; text(`+${earned.xp} XP`, W / 2, ry, 16, "#2e6a5a"); if (rec) { ry += 24; text("New personal best!", W / 2, ry, 16, "#2e7d32"); }
      for (const a of achNew.slice(0, 2)) { ry += 24; text(`🏅 ${a.n}  +🪙 ${a.coins}`, W / 2, ry, 16, "#8a5a00"); }
      button("Continue", cy + ch - 76);
    } else if (st === "result") {
      text("It got away", W / 2, cy + 90, 32, "#7a2418", "center", "Georgia,serif"); text(msg, W / 2, cy + 140, 17, "#333");
      text("Tip: tap when the bobber dips and the ! shows up.", W / 2, cy + 190, 14, "#666");
      button("Continue", cy + ch - 76);
    } else {
      if (mode === "event") {
        const a = mine.reduce((x, y) => x + y, 0);
        text("Entry sent!", W / 2, cy + 80, 34, "#1f5c4d", "center", "Georgia,serif"); text(`${L.n} Cup: ${a.toFixed(2)} lb`, W / 2, cy + 140, 22, "#16352d");
        text("Everyone fishes the same water.", W / 2, cy + 190, 16, "#444"); text("See the standings in Tournaments.", W / 2, cy + 216, 16, "#444"); text("Prizes arrive after the cup ends.", W / 2, cy + 242, 16, "#444");
        button("Back to menu", cy + ch - 76); return;
      }
      if (mode === "friend") {
        const a = mine.reduce((x, y) => x + y, 0), opp = duel.a === S.user.uid ? duel.bName : duel.aName;
        text("Score sent!", W / 2, cy + 80, 34, "#1f5c4d", "center", "Georgia,serif"); text(`You caught ${a.toFixed(2)} lb`, W / 2, cy + 140, 22, "#16352d");
        text(`@${opp} will see the result when they play.`, W / 2, cy + 190, 16, "#444"); text("Check Play with friends in the menu.", W / 2, cy + 216, 16, "#444");
        button("Back to menu", cy + ch - 76); return;
      }
      const a = mine.reduce((x, y) => x + y, 0), r = rival.reduce((x, y) => x + y, 0);
      text(resText === "win" ? "You win!" : resText === "lose" ? "Rival wins" : "It's a draw", W / 2, cy + 80, 36, resText === "win" ? "#c47a00" : "#1f5c4d", "center", "Georgia,serif");
      text(`You  ${a.toFixed(2)} lb`, W / 2, cy + 140, 22, "#16352d"); text(`${rivalName}  ${r.toFixed(2)} lb`, W / 2, cy + 175, 22, "#16352d");
      text(`🪙 +${earned.coins} coins   +${earned.xp} XP`, W / 2, cy + 235, 19, "#8a5a00");
      button("Back to menu", cy + ch - 76);
    }
  }
  function update(dt) {
    shakeT = Math.max(0, shakeT - dt);
    if (st === "cast") { powerT += dt * 0.9; if (powerT > 2) powerT = 0; power = powerT <= 1 ? powerT : 2 - powerT; }
    if (st === "wait") { timer -= dt; if (timer <= 0) {
      if (snag) { snag = false; lose("Snagged! The line broke."); shakeT = 0.35; tick(3000, 0.3, 0.08); }
      else { biteAt = 0; setSt("bite"); tick(1500, 0.12, 0.05); } } }
    if (st === "bite") { biteAt += dt; if (biteAt > BITE_WINDOW) lose("Too slow. It got away."); }
    if (st === "fight") {
      const out = fcStep(F, down, dt, G, hooks); bg.dataset.tension = F.t.toFixed(2);
      // reel sounds: fast screaming drag while the fish runs, slow clicks while you crank
      if (F.ph === "run") { whine(true, 800 + 700 * F.s + (F.d < 50 ? 150 : 0)); clickAcc += dt * (26 + 26 * F.s) * (Q ? 0.5 : 1); while (clickAcc >= 1) { clickAcc -= 1; tick(2000 + Math.random() * 1400, 0.14, 0.02, 4); } }
      else { whine(false); if (down) { clickAcc += dt * 9 * (Q ? 0.6 : 1); while (clickAcc >= 1) { clickAcc -= 1; tick(1300 + Math.random() * 300, 0.07, 0.02, 4); } } }
      if (F.ph === "thrash" && Math.random() < dt * 6) shakeT = 0.12;
      if (out === "snap") { lose("The line snapped!"); shakeT = 0.3; tick(3000, 0.3, 0.08); }
      else if (out === "slack") lose("It shook the hook!");
      else if (out === "win") { splash(1); finish(true); }
    }
  }
  raf = requestAnimationFrame(frame);
}

/* ======================= REEL RUSH (quick game) ======================= */
function openReelRush() {
  const best0 = +getPref("gamebest", "0") || 0;
  const canvas = el("canvas", { class: "game-canvas", role: "img", "aria-label": "Fishing game. Drag your finger or mouse, or use the arrow keys, to move the hook into fish." });
  const ctx = canvas.getContext("2d");
  const hud = el("div", { class: "game-hud", "aria-live": "off" });
  const close = () => { cancelAnimationFrame(raf); removeEventListener("keydown", onKey); removeEventListener("resize", resize); bg.remove(); };
  const bg = el("div", { class: "game-bg", role: "dialog", "aria-label": "Fishing game" },
    canvas, hud, el("button", { class: "game-x", type: "button", "aria-label": "Close the game", onclick: close }, "✕"));
  document.body.append(bg);
  let W = 0, H = 0, raf = 0, dpr = 1;
  const resize = () => { dpr = Math.min(2, devicePixelRatio || 1); W = bg.clientWidth; H = bg.clientHeight; canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + "px"; canvas.style.height = H + "px"; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
  resize(); addEventListener("resize", resize);
  const TYPES = [
    { n: "Minnow", pts: 2, r: 13, sp: 150, c: "#9fd3e6", w: 5 },
    { n: "Bass", pts: 5, r: 19, sp: 110, c: "#5f8f3a", w: 4 },
    { n: "Catfish", pts: 8, r: 25, sp: 70, c: "#7a6a58", w: 2 },
    { n: "Golden carp", pts: 20, r: 20, sp: 190, c: "#f0b429", w: 1 },
    { n: "Old boot", pts: -5, r: 17, sp: 90, c: "#6b4a2b", w: 2, boot: true }];
  const hook = { x: 0, y: 0, tx: 0, ty: 0 };
  let st = "ready", fish = [], pops = [], score = 0, left = 45, last = 0, combo = 0, comboT = 0, spawnT = 0, shake = 0, t0 = 0;
  const waterY = () => Math.max(110, H * 0.2);
  const place = (x, y) => { hook.tx = Math.max(16, Math.min(W - 16, x)); hook.ty = Math.max(waterY() + 20, Math.min(H - 16, y)); };
  hook.x = hook.tx = W / 2; hook.y = hook.ty = H * 0.5;
  const rel = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener("pointermove", (e) => { const [x, y] = rel(e); place(x, y); });
  canvas.addEventListener("pointerdown", (e) => { canvas.setPointerCapture?.(e.pointerId); const [x, y] = rel(e); place(x, y); if (st !== "play") start(); });
  const onKey = (e) => {
    if (e.key === "Escape") { close(); return; }
    const d = 40, k = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
    if (k) { e.preventDefault(); place(hook.tx + k[0], hook.ty + k[1]); }
    else if ((e.key === "Enter" || e.key === " ") && st !== "play") { e.preventDefault(); start(); }
  };
  addEventListener("keydown", onKey);
  function start() { st = "play"; fish = []; pops = []; score = 0; left = 45; combo = 0; comboT = 0; spawnT = 0; last = performance.now(); t0 = last; hud.replaceChildren(); }
  function spawn() {
    const total = TYPES.reduce((a, t) => a + t.w, 0); let r = Math.random() * total, t = TYPES[0];
    for (const x of TYPES) { if ((r -= x.w) <= 0) { t = x; break; } }
    const dir = Math.random() < 0.5 ? 1 : -1, wy = waterY();
    fish.push({ t, dir, x: dir > 0 ? -40 : W + 40, y: wy + 40 + Math.random() * (H - wy - 70), v: t.sp * (0.8 + Math.random() * 0.5) * (1 + (45 - left) / 90), ph: Math.random() * 6 });
  }
  function drawFish(f) {
    const { t, dir } = f, r = t.r;
    ctx.save(); ctx.translate(f.x, f.y + Math.sin(performance.now() / 250 + f.ph) * 3); ctx.scale(dir, 1);
    if (t.boot) {
      ctx.fillStyle = t.c; ctx.fillRect(-r * 0.4, -r, r * 0.8, r * 1.5); ctx.beginPath(); ctx.ellipse(r * 0.2, r * 0.5, r * 1, r * 0.5, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "#3d2a17"; ctx.fillRect(-r * 0.4, -r, r * 0.8, r * 0.3);
    } else {
      ctx.fillStyle = t.c; ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.62, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-r * 0.8, 0); ctx.lineTo(-r * 1.5, -r * 0.5); ctx.lineTo(-r * 1.5, r * 0.5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.beginPath(); ctx.ellipse(0, r * 0.2, r * 0.7, r * 0.22, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(r * 0.55, -r * 0.12, r * 0.2, 0, 7); ctx.fill();
      ctx.fillStyle = "#111"; ctx.beginPath(); ctx.arc(r * 0.6, -r * 0.12, r * 0.09, 0, 7); ctx.fill();
    }
    ctx.restore();
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    hook.x += (hook.tx - hook.x) * Math.min(1, dt * 14); hook.y += (hook.ty - hook.y) * Math.min(1, dt * 14);
    const wy = waterY();
    if (st === "play") {
      left -= dt; spawnT -= dt; comboT -= dt; if (comboT <= 0) combo = 0;
      if (spawnT <= 0) { spawn(); spawnT = 0.45 + Math.random() * 0.5; }
      for (const f of fish) f.x += f.dir * f.v * dt;
      for (const f of [...fish]) {
        if (Math.hypot(f.x - hook.x, f.y - hook.y) < f.t.r + 9) {
          fish.splice(fish.indexOf(f), 1);
          if (f.t.pts > 0) { combo = comboT > 0 ? Math.min(4, combo + 1) : 1; comboT = 1.6; const g = f.t.pts * combo; score += g; pops.push({ x: f.x, y: f.y, s: "+" + g + (combo > 1 ? " x" + combo : ""), a: 1, c: "#fff" }); }
          else { score = Math.max(0, score + f.t.pts); combo = 0; shake = 0.3; pops.push({ x: f.x, y: f.y, s: String(f.t.pts), a: 1, c: "#ff8a80" }); }
        }
      }
      fish = fish.filter((f) => f.x > -80 && f.x < W + 80);
      if (left <= 0) { left = 0; st = "over"; const best = Math.max(best0, +getPref("gamebest", "0") || 0); if (score > best) setPref("gamebest", String(score)); }
    }
    shake = Math.max(0, shake - dt);
    ctx.save(); if (shake > 0) ctx.translate((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
    const sky = ctx.createLinearGradient(0, 0, 0, wy); sky.addColorStop(0, "#ffd9a0"); sky.addColorStop(1, "#cfe8ef");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, wy);
    const wg = ctx.createLinearGradient(0, wy, 0, H); wg.addColorStop(0, "#3a9bb5"); wg.addColorStop(1, "#0e3f4f");
    ctx.fillStyle = wg; ctx.fillRect(0, wy, W, H - wy);
    ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 2; ctx.beginPath();
    for (let x = 0; x <= W; x += 12) ctx.lineTo(x, wy + Math.sin(x / 22 + now / 400) * 2.5); ctx.stroke();
    // boat + line
    const bx = hook.x; ctx.fillStyle = "#7a4a22"; ctx.beginPath(); ctx.moveTo(bx - 46, wy - 16); ctx.lineTo(bx + 46, wy - 16); ctx.lineTo(bx + 32, wy + 2); ctx.lineTo(bx - 32, wy + 2); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#f4f1ea"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(bx + 10, wy - 16); ctx.lineTo(bx + 10, wy - 46); ctx.lineTo(bx, wy - 16); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.beginPath(); ctx.moveTo(bx + 10, wy - 46); ctx.lineTo(hook.x, hook.y - 8); ctx.stroke();
    fish.forEach(drawFish);
    ctx.strokeStyle = "#e8e8e8"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(hook.x, hook.y, 8, 0.2, Math.PI * 1.3, false); ctx.stroke();
    pops = pops.filter((p) => (p.a -= dt * 1.2) > 0);
    ctx.font = "bold 20px system-ui,sans-serif"; ctx.textAlign = "center";
    for (const p of pops) { ctx.globalAlpha = p.a; ctx.fillStyle = p.c; ctx.fillText(p.s, p.x, p.y - (1 - p.a) * 40); } ctx.globalAlpha = 1;
    ctx.restore();
    // HUD
    ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.font = "bold 22px system-ui,sans-serif";
    ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 4;
    ctx.fillText("Score " + score, 16, 38); ctx.textAlign = "right"; ctx.fillText(Math.ceil(left) + "s", W - 64, 38);
    ctx.textAlign = "center"; ctx.font = "16px system-ui,sans-serif"; ctx.fillText("Best " + Math.max(best0, +getPref("gamebest", "0") || 0), W / 2, 38);
    if (st !== "play") {
      ctx.shadowBlur = 0; ctx.fillStyle = "rgba(6,30,40,.72)"; ctx.fillRect(0, H * 0.28, W, H * 0.4);
      ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = "bold 34px Georgia,serif";
      ctx.fillText(st === "ready" ? "Reel Rush" : "Time's up!", W / 2, H * 0.28 + 56);
      ctx.font = "18px system-ui,sans-serif";
      if (st === "ready") { ctx.fillText("Drag to move your hook into fish.", W / 2, H * 0.28 + 96); ctx.fillText("Catch fast for combos. Dodge the old boots!", W / 2, H * 0.28 + 124); }
      else { ctx.fillText("You scored " + score + (score >= (+getPref("gamebest", "0") || 0) && score > 0 ? " · new best!" : ""), W / 2, H * 0.28 + 96); }
      ctx.font = "bold 20px system-ui,sans-serif"; ctx.fillStyle = "#ffd36b"; ctx.fillText(st === "ready" ? "Tap to start" : "Tap to play again", W / 2, H * 0.28 + 172);
    }
    ctx.shadowBlur = 0;
  }
  raf = requestAnimationFrame(frame);
}

/* ======================= ABOUT + PRIVACY ======================= */
function openPrivacy() {
  const close = () => bg.remove();
  const item = (title, text) => el("div", { class: "stack", style: "gap:2px" }, el("b", null, title), el("span", null, text));
  const bg = el("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg) close(); } },
    el("div", { class: "sheet", role: "dialog", "aria-label": "About and privacy" },
      el("div", { class: "sheet-h" }, el("h2", null, "About and privacy"), el("button", { class: "link", type: "button", onclick: close }, "Close")),
      el("div", { class: "msgs about" },
        item("Who made this", "Weigh-In is a free hobby app for friends who fish. One person runs it and it has no company or ads behind it. It was built with the help of AI, and the code is public so anyone can read it at github.com/weigh-in/weigh-in."),
        item("Your password", "The app never sees your password. Google's Firebase service handles sign-in. If you choose Continue with Google, the app only gets your name and email, and never a password."),
        item("Your email", "Only used to sign you in and to send a password reset. Other anglers can't see it. The person who runs the app can see the emails that signed up."),
        item("What other people can see", "Your angler name, profile picture, catches, photos, comments, and any map pin you add. Anyone who makes an account can see these."),
        item("What stays private", "Chats are only seen by you and your friend. Your fishing log is only seen by you."),
        item("Map pins", "A pin is only added when you tap Add my location on a post. The default is an approximate area of about 1 km. Deleting the post removes the pin."),
        item("Weather", "The Bite tab asks a free weather service (Open-Meteo) for a forecast using the town you pick or your location if you allow it. That location is not saved to your account."),
        item("What the app doesn't do", "No ads, no tracking, no selling your info, no payments."),
        item("House rules", "Fishing photos only. No slurs, hate, or bullying. The person who runs the app, and moderators they choose, can delete posts or comments and can ban accounts. Tap the flag on a catch to report it."),
        item("Staying safe", "Don't post your address, school, or a spot you want to keep secret. Skip the location on catches near your home."),
        item("Deleting things", "You can delete any of your catches or comments yourself. To remove your whole account, ask the person who runs the app.")))); 
  document.body.append(bg);
}
