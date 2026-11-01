// Weigh-In: post catches, swipe the feed, run tournaments, keep a log, chat with friends.
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, sendPasswordResetEmail, GoogleAuthProvider, signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, getDoc, getDocs, addDoc, deleteDoc, updateDoc, onSnapshot,
  query, where, orderBy, limit, serverTimestamp, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $app = document.getElementById("app");

/* ======================= tiny helpers ======================= */
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
function getPref(k, d) { try { return localStorage.getItem("weighin-" + k) || d; } catch { return d; } }
function setPref(k, v) { try { localStorage.setItem("weighin-" + k, v); } catch { /* private mode */ } }

/* ======================= app state ======================= */
const S = {
  user: null, name: "", tab: "feed",
  posts: [], tournaments: [], log: [],
  reqIn: [], reqOut: [], friendships: [],
  openTournament: null, tourPosts: [], viewing: null, creatingTour: false,
  meView: "main", mine: [], spots: [], map: null, markers: null, likes: new Map(), mod: null,
};
const unsubs = [];
let tourUnsub = null, meUnsub = null;
function stopAll() { unsubs.splice(0).forEach((u) => u()); tourUnsub?.(); tourUnsub = null; meUnsub?.(); meUnsub = null; destroyMap(); stopOwner(); cardCache.clear(); S.mine = []; }

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
const PERMS = [["deletePosts", "Delete catches"], ["deleteComments", "Delete comments"], ["reports", "See and handle reports"], ["ban", "Ban and unban anglers"]];
const MODERN_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}";
const MODERN_OPTS = { maxZoom: 19, attribution: "Tiles &copy; Esri, HERE, Garmin, OpenStreetMap contributors" };
const US_STATES = [["AL","Alabama"],["AK","Alaska"],["AZ","Arizona"],["AR","Arkansas"],["CA","California"],["CO","Colorado"],["CT","Connecticut"],["DE","Delaware"],["DC","District of Columbia"],["FL","Florida"],["GA","Georgia"],["HI","Hawaii"],["ID","Idaho"],["IL","Illinois"],["IN","Indiana"],["IA","Iowa"],["KS","Kansas"],["KY","Kentucky"],["LA","Louisiana"],["ME","Maine"],["MD","Maryland"],["MA","Massachusetts"],["MI","Michigan"],["MN","Minnesota"],["MS","Mississippi"],["MO","Missouri"],["MT","Montana"],["NE","Nebraska"],["NV","Nevada"],["NH","New Hampshire"],["NJ","New Jersey"],["NM","New Mexico"],["NY","New York"],["NC","North Carolina"],["ND","North Dakota"],["OH","Ohio"],["OK","Oklahoma"],["OR","Oregon"],["PA","Pennsylvania"],["RI","Rhode Island"],["SC","South Carolina"],["SD","South Dakota"],["TN","Tennessee"],["TX","Texas"],["UT","Utah"],["VT","Vermont"],["VA","Virginia"],["WA","Washington"],["WV","West Virginia"],["WI","Wisconsin"],["WY","Wyoming"]];
const US_BOUNDS = [[17, -180], [72, -64]];   // the map stays on the USA (including Alaska and Hawaii)
const placeLabel = (x) => [x.city, x.state].filter(Boolean).join(", ");
const OWNER_UID = "whNN0b8nbhdQiK8osrBa48SEtm82"; // moderators can't delete or ban this account
const canOn = (perm, ownerUid) => !!(S.owner || (S.mod && S.mod[perm] && ownerUid !== OWNER_UID));
const can = (perm) => !!(S.owner || (S.mod && S.mod[perm]));
const isStaff = () => !!(S.owner || S.mod);
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
  S.banned = false; S.mod = null;
  if (!user) { renderAuth(); return; }
  $app.replaceChildren(el("div", { class: "boot" }, "Loading…"));
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) { S.name = snap.data().name; startApp(); return; }
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
  stopAll();
  const uid = S.user.uid;
  unsubs.push(onSnapshot(query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(40)), (s) => {
    S.posts = s.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    if (S.tab === "feed") renderFeedCards();
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
    S.likes = m; paintLikes(); if (S.tab === "me" && S.meView === "main") renderTab();
  }, () => {}));
  unsubs.push(onSnapshot(doc(db, "mods", uid), (d) => {
    const next = d.exists() ? (d.data().perms || {}) : null;
    if (JSON.stringify(next) === JSON.stringify(S.mod)) return;
    S.mod = next; cardCache.clear();
    if (S.tab === "feed") renderFeedCards(); else if (S.tab === "me") renderTab();
  }, () => {}));
  unsubs.push(onSnapshot(doc(db, "bans", uid), (d) => { if (d.exists() && !S.owner) showBanned(); }, () => {}));
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
  const tabs = [["feed", "Feed", ICON.feed], ["map", "Map", ICON.map], ["post", "Post", ICON.plus], ["bite", "Bite", ICON.sun], ["tours", "Tourneys", ICON.trophy], ["me", "Me", ICON.me]];
  $nav = el("nav", { class: "tabs", "aria-label": "Sections" }, el("div", { class: "in" }, tabs.map(([k, label, icon]) =>
    el("button", { class: "tab" + (k === "post" ? " post" : ""), type: "button", "data-tab": k, onclick: () => go(k) },
      k === "post" ? el("span", { class: "bob", html: icon }) : el("span", { html: icon }), label,
      k === "me" ? el("span", { class: "dot", hidden: true }) : null))));
  $app.replaceChildren($screen, $nav);
  go(S.tab);
}
function go(tab) {
  if (tab === "me") S.meView = "main";
  S.tab = tab;
  if (tab !== "tours") { S.openTournament = null; S.creatingTour = false; tourUnsub?.(); tourUnsub = null; }
  $nav.querySelectorAll(".tab").forEach((b) => b.dataset.tab === tab ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
  renderTab();
}
function updateDot() { $nav?.querySelector(".dot")?.toggleAttribute("hidden", S.reqIn.length === 0); }
function renderTab() {
  clearInterval(tick);
  if (S.tab !== "me" || S.meView !== "owner") stopOwner();
  if (S.tab !== "map") destroyMap();
  if (S.tab === "feed") return renderFeed();
  if (S.tab === "map") return renderMap();
  if (S.tab === "me") watchMine();
  $screen.className = "screen";
  const p = el("div", { class: "pad" });
  ({ post: viewPost, bite: viewBite, tours: viewTours, me: viewMe })[S.tab](p);
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
    setPref("wx", JSON.stringify(loc));
    box.replaceChildren(el("p", { class: "muted" }, "Loading weather for " + loc.name + "…"));
    try { drawWx(box, await fetchWeather(loc), loc, loadWx); }
    catch (e) { box.replaceChildren(wxPicker(loadWx, "Couldn't load the weather. Check your internet and try again."), el("p", { class: "muted small" }, String(e.message || e))); }
  };
  if (saved && typeof saved.lat === "number") loadWx(saved); else box.append(wxPicker(loadWx));
  p.append(lureChart());
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
  box.replaceChildren(
    el("div", { class: "row spread" }, el("strong", null, loc.name), el("button", { class: "link", type: "button", onclick: () => box.replaceChildren(wxPicker(onPick)) }, "Change")),
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
    el("div", { class: "hours", "aria-label": "Next 12 hours" }, next.map((x) => el("div", { class: "hr" },
      el("small", null, new Date(x.t).toLocaleTimeString([], { hour: "numeric" })), el("b", null, Math.round(x.temp) + "°"), el("small", null, (x.rain ?? 0) + "% rain")))),
    el("p", { class: "muted small" }, "Weather from Open-Meteo. Your location is only used to ask for the forecast and is not saved to your account."));
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
    el("button", { class: "scope-btn", type: "button", id: "scope-btn", "aria-label": "Choose whose catches to show", onclick: openScopeSheet }, scopeLabel() + " ▾")), $feed);
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
    el("div", { class: "shade" }),
    el("div", { class: "info" },
      el("button", { class: "who", type: "button", "aria-label": `See ${p.name}'s catches`, onclick: () => openAngler(p.uid, p.name) }, avatar(p.uid, p.name, 30), el("span", null, "@" + p.name + "  ·  " + catchLabel(p))),
      el("div", { class: "species" }, p.species),
      el("div", { class: "size" }, sizeText(p)),
      el("div", { class: "meta" }, [p.lure ? "Caught on " + p.lure : null, p.spot || null, placeLabel(p) || null, p.tournamentName ? "🏆 " + p.tournamentName : null].filter(Boolean).join("  ·  "))),
    el("div", { class: "side" },
      el("div", null, el("button", { type: "button", class: "like", "data-like": p.id, "aria-pressed": "false", "aria-label": "Like", html: ICON.heart, onclick: () => toggleLike(p) }), el("small", { "data-like-n": p.id }, "0")),
      el("div", { "data-spotbtn": p.id, hidden: true }, el("button", { type: "button", "aria-label": "See where this was caught on the map", html: ICON.map, onclick: () => seeOnMap(p) }), el("small", null, "Map")),
      el("div", null, el("button", { type: "button", "aria-label": "Comments", html: ICON.chat, onclick: () => openComments(p) }), el("small", null, "Comments")),
      mine || canOn("deletePosts", p.uid) ? el("div", null, el("button", { type: "button", "aria-label": "Delete this post", html: ICON.trash, onclick: () => deletePost(p) }), el("small", null, "Delete")) : null,
      !mine ? el("div", null, el("button", { type: "button", "aria-label": "Report this post", html: ICON.flag, onclick: () => reportPost(p) }), el("small", null, "Report")) : null,
      can("ban") && !mine && p.uid !== OWNER_UID ? el("div", null, el("button", { type: "button", "aria-label": "Ban this angler", html: ICON.ban, onclick: () => banUser(p.uid, p.name) }), el("small", null, "Ban")) : null));
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
async function deletePost(p) {
  if (!confirm("Delete this catch? This can't be undone.")) return;
  try {
    await deleteDoc(doc(db, "posts", p.id)); cardCache.delete(p.id);
    deleteDoc(doc(db, "spots", p.id)).catch(() => {}); // its map pin, if it had one
    toast("Catch deleted.");
  } catch (e) { toast(errText(e)); }
}

/* ======================= owner tools: reports, bans ======================= */
let ownerUns = [];
function stopOwner() { ownerUns.splice(0).forEach((u) => u()); }
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
  let bans = new Set(), users = [], reports = [], mods = new Map();
  const paintReports = () => reportsBox.replaceChildren(...(reports.length ? reports.map((r) => el("div", { class: "item", style: "cursor:default;align-items:flex-start" },
    el("div", { class: "row", style: "gap:12px;flex-wrap:nowrap;min-width:0" },
      r.thumb ? el("img", { src: r.thumb, alt: "", style: "width:64px;height:64px;object-fit:cover;border-radius:8px;flex:none" }) : null,
      el("div", { class: "stack", style: "gap:2px;min-width:0" }, el("span", { class: "t" }, `@${r.postName}: ${r.species}`), el("span", { class: "s" }, `Reported by @${r.byName} · ${ago(r.createdAt)}`),
        el("div", { class: "row", style: "gap:12px" },
          can("deletePosts") ? el("button", { class: "link danger small", type: "button", onclick: () => ownerDeletePost(r, reports) }, "Delete post") : null,
          can("ban") ? el("button", { class: "link danger small", type: "button", onclick: () => banUser(r.postUid, r.postName) }, "Ban") : null,
          el("button", { class: "link small", type: "button", onclick: () => deleteDoc(doc(db, "reports", r.id)).catch((e) => toast(errText(e))) }, "Dismiss")))))) : [el("p", { class: "empty" }, "No reports. All quiet.")]));
  const paintMembers = () => { const rows = users.filter((u) => u.id !== S.user.uid);
    membersBox.replaceChildren(...(rows.length ? rows.map((u) => el("div", { class: "item", style: "cursor:default;flex-wrap:wrap" },
      el("span", { class: "row", style: "gap:8px;flex-wrap:nowrap;min-width:0" }, avatar(u.id, u.name, 28), el("span", { class: "t" }, "@" + u.name),
        bans.has(u.id) ? el("span", { class: "pill final" }, "Banned") : null, mods.has(u.id) ? el("span", { class: "pill soon" }, "Mod") : null),
      el("span", { class: "row", style: "gap:8px" },
        S.owner ? el("button", { class: "btn ghost small", type: "button", onclick: () => openModEditor(u.id, u.name, mods.get(u.id)) }, mods.has(u.id) ? "Edit mod" : "Make mod") : null,
        can("ban") ? (bans.has(u.id) ? el("button", { class: "btn ghost small", type: "button", onclick: () => unbanUser(u.id, u.name) }, "Unban")
          : el("button", { class: "btn small", type: "button", onclick: () => banUser(u.id, u.name) }, "Ban")) : null))) : [el("p", { class: "empty" }, "No other anglers yet.")])); };
  if (can("reports")) ownerUns.push(onSnapshot(query(collection(db, "reports"), orderBy("createdAt", "desc"), limit(50)), (s) => { reports = s.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) })); paintReports(); }, () => reportsBox.replaceChildren(el("p", { class: "muted" }, "Couldn't load reports."))));
  if (can("ban")) ownerUns.push(onSnapshot(collection(db, "bans"), (s) => { bans = new Set(s.docs.map((d) => d.id)); paintMembers(); }, () => {}));
  if (S.owner) ownerUns.push(onSnapshot(collection(db, "mods"), (s) => { mods = new Map(s.docs.map((d) => [d.id, d.data().perms || {}])); paintMembers(); }, () => {}));
  if (can("ban") || S.owner) ownerUns.push(onSnapshot(query(collection(db, "users"), limit(300)), (s) => { users = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.name).localeCompare(String(b.name))); paintMembers(); }, () => {}));
  const mine = PERMS.filter(([k]) => can(k)).map(([, l]) => l);
  p.append(backBtn("‹ Profile"), el("h1", null, S.owner ? "Owner tools" : "Moderator tools"),
    el("p", { class: "muted small" }, S.owner
      ? "You can delete anyone's catch or comment with the Delete button, ban from the feed or the list below, and make moderators with the permissions you choose."
      : "You're a moderator. You can: " + (mine.join(", ") || "nothing yet") + ". Delete buttons show up right on catches and comments."),
    can("reports") ? el("section", { class: "stack" }, el("h2", null, "Reports"), reportsBox) : null,
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
  getDocs(query(collection(db, "posts"), where("uid", "==", uid), limit(20))).then((snap) => {
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
      fav ? el("p", { class: "muted small" }, `Most catches on: ${fav[0].charAt(0).toUpperCase() + fav[0].slice(1)} · ${pins} map pin${pins === 1 ? "" : "s"}`) : null,
      can("ban") && uid !== S.user.uid && uid !== OWNER_UID ? el("button", { class: "link danger small", type: "button", style: "align-self:flex-start", onclick: () => banUser(uid, name) }, `Ban @${name}`) : null,
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
      c.uid === S.user.uid || canOn("deleteComments", c.uid) ? el("button", { class: "link danger small", type: "button", style: "align-self:flex-start", onclick: () => deleteDoc(doc(db, "posts", p.id, "comments", c.id)).catch((e) => toast(errText(e))) }, "Delete") : null)));
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
    if (!navigator.geolocation) { toast("This phone can't share location."); return; }
    locBtn.disabled = true; locBtn.textContent = "Finding you…";
    navigator.geolocation.getCurrentPosition((pos) => { draftLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude }; draftSrc = "manual"; draftWhere = ""; setPref("lastloc", JSON.stringify(draftLoc)); locBtn.disabled = false; paintLoc(); },
      () => { locBtn.disabled = false; paintLoc(); toast("Couldn't get your location. Make sure location is allowed for this app."); },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
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
    tourHint.textContent = ph ? `Now: ${ph.name}${ph.where ? " at " + ph.where : ""}${ph.lure ? ". Lure rule: " + ph.lure + " only" : ""}.` : "This catch will count in this tournament.";
  };
  const f = el("form", { novalidate: true },
    el("div", { class: "field" }, el("span", null, "Photo"), preview, removeBtn,
      el("span", { class: "hint" }, "Fishing photos only. Anything else gets removed and the account can be banned.")),
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
      const ref = await addDoc(collection(db, "posts"), {
        uid: S.user.uid, name: S.name, species, lb, inches,
        lure, spot: spotText, city: cityText, state: stateCode,
        catchDate: dateStr, photo: draftPhoto || "", tournamentId: t ? t.id : "", tournamentName: t ? t.name : "",
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
      draftPhoto = ""; draftLoc = null; draftSrc = ""; draftWhere = "";
      toast(pinFailed ? `Posted your ${species}, but the map pin didn't save.` : pin ? `Posted your ${species} and put it on the map!` : `Posted your ${species}!`); go("feed");
    } catch (err) { toast(errText(err)); btn.disabled = false; btn.textContent = "Post catch"; }
  });
  p.append(el("h1", null, "Post a catch"), f);
}

/* ======================= TOURNAMENTS ======================= */
const SCORING = {
  heaviest: { name: "Heaviest fish", desc: "Biggest single fish by weight", unit: "lb" },
  bag: { name: "Bag weight", desc: "Your 5 heaviest fish added up", unit: "lb" },
  longest: { name: "Longest fish", desc: "Biggest single fish by length", unit: "in" },
  most: { name: "Most fish", desc: "Whoever catches the most fish", unit: "fish" },
};
function viewTours(p) {
  if (S.creatingTour) return viewCreateTour(p);
  if (S.openTournament) return viewTour(p);
  const order = { live: 0, soon: 1, final: 2 };
  const ts = [...S.tournaments].sort((a, b) => order[tourStatus(a)] - order[tourStatus(b)] || String(b.start).localeCompare(String(a.start)));
  p.append(el("div", { class: "row spread" }, el("h1", null, "Tourneys"),
    el("button", { class: "btn small", type: "button", onclick: () => { S.creatingTour = true; renderTab(); } }, "New")));
  if (!ts.length) { p.append(el("p", { class: "empty" }, "No tournaments yet. Tap New to start one and invite your friends.")); return; }
  p.append(el("div", { class: "list" }, ts.map((t) => {
    const st = tourStatus(t), n = (t.members || []).length;
    return el("button", { class: "item", type: "button", onclick: () => openTour(t.id) },
      el("div", { class: "stack", style: "gap:2px;min-width:0" }, el("span", { class: "t" }, t.name),
        el("span", { class: "s" }, `${SCORING[t.scoring]?.name || ""} · ${t.startAt ? fmtWhen(t.startAt) : fmtDay(t.start) + (t.end !== t.start ? " – " + fmtDay(t.end) : "")}${phasesOf(t).length ? " · " + phasesOf(t).length + " phases" : ""} · ${n} angler${n === 1 ? "" : "s"}`)),
      el("span", { class: "pill " + st }, { live: "Live", soon: "Upcoming", final: "Final" }[st]));
  })));
}
function viewCreateTour(p) {
  const start0 = Math.floor(Date.now() / 60000) * 60000; // starts right now unless you change it
  const phaseRows = [];
  const phasesBox = el("div", { class: "stack" });
  const summary = el("span", { class: "hint" });
  const splitBox = el("input", { type: "checkbox", id: "t-split" });
  const endField = el("label", { class: "field" }, el("span", null, "Ends"), el("input", { id: "t-end", type: "datetime-local", value: dtLocal(start0 + 3 * 3600000) }));
  const phaseWrap = el("div", { class: "stack", hidden: true });
  const startInput = el("input", { id: "t-start", type: "datetime-local", value: dtLocal(start0) });
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
  const f = el("form", { novalidate: true },
    el("label", { class: "field" }, el("span", null, "Name"), el("input", { id: "t-name", name: "name", maxlength: 40, placeholder: "Saturday Bass Bash", required: true })),
    el("label", { class: "field" }, el("span", null, "How is the leaderboard scored?"),
      el("select", { id: "t-scoring", name: "scoring" }, Object.entries(SCORING).map(([k, s]) => el("option", { value: k }, `${s.name}: ${s.desc}`))),
      el("span", { class: "hint" }, "First fish, biggest fish and most fish awards are always shown too.")),
    el("label", { class: "field" }, el("span", null, "Starts"), startInput),
    endField,
    el("label", { class: "row", style: "gap:10px;flex-wrap:nowrap" }, splitBox, el("span", null, "Split into phases (a different lake or lure for each part)")),
    phaseWrap,
    el("button", { class: "btn wide", type: "submit" }, "Create tournament"));
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
    try {
      const data = { name, scoring: fd.get("scoring"), start: localDate(new Date(startAt)), end: localDate(new Date(endAt)), startAt, endAt,
        createdBy: S.user.uid, createdByName: S.name, members: [S.user.uid], createdAt: serverTimestamp() };
      if (phases.length) data.phases = phases;
      const ref = await addDoc(collection(db, "tournaments"), data);
      S.creatingTour = false; toast("Tournament created. You're in!"); openTour(ref.id);
    } catch (err) { toast(errText(err)); }
  });
  p.append(el("button", { class: "link", type: "button", style: "align-self:flex-start", onclick: () => { S.creatingTour = false; renderTab(); } }, "‹ Back"),
    el("h1", null, "New tournament"), f);
}
let phaseFilter = null;
function openTour(id) {
  S.openTournament = id; S.viewing = null; S.tourPosts = []; phaseFilter = null;
  tourUnsub?.();
  tourUnsub = onSnapshot(query(collection(db, "posts"), where("tournamentId", "==", id)), (s) => {
    S.tourPosts = s.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    if (S.tab === "tours" && S.openTournament === id) renderTab();
  }, () => {});
  renderTab();
}
function standings(t, posts) {
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
      el("p", { class: "muted", style: "margin:0" }, `${sc.desc}. Started by @${t.createdByName || "someone"}. Only catches posted to this tournament count.`)));

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
  if (!joined && st !== "final") p.append(el("button", { class: "btn wide", type: "button", onclick: async () => {
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
        el("span", { class: "row", style: "gap:10px;flex-wrap:nowrap" }, avatar(fr.uid, fr.name, 34), el("span", { class: "t" }, "@" + fr.name)), el("span", { class: "label" }, "Chat ›"));
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
  const close = () => { un(); bg.remove(); };
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
    if (!navigator.geolocation) { toast("This phone can't share location."); return; }
    navigator.geolocation.getCurrentPosition((pos) => {
      const L = window.L; if (!L || !S.map) return;
      const ll = [pos.coords.latitude, pos.coords.longitude];
      S.map.setView(ll, 13);
      if (S.me) S.me.setLatLng(ll); else S.me = L.circleMarker(ll, { radius: 8, color: "#fff", weight: 3, fillColor: "#1F5C4D", fillOpacity: 1 }).addTo(S.map);
    }, () => toast("Couldn't get your location. Make sure location is allowed for this app."), { timeout: 10000, maximumAge: 60000 });
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

/* ======================= ME (profile, log, friends, settings) ======================= */
function watchMine() {
  if (meUnsub) return;
  meUnsub = onSnapshot(query(collection(db, "posts"), where("uid", "==", S.user.uid), limit(60)), (s) => {
    S.mine = s.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    if (S.tab === "me" && S.meView === "main") renderTab();
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

function viewMe(p) {
  if (S.meView === "log") { p.append(backBtn("‹ Profile")); return viewLog(p); }
  if (S.meView === "friends") { p.append(backBtn("‹ Profile")); return viewFriends(p); }
  if (S.meView === "settings") return viewSettings(p);
  if (S.meView === "owner" && isStaff()) return viewOwner(p);
  const mine = [...S.mine].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  const biggest = Math.max(0, ...mine.map((x) => x.lb || 0));
  const pins = S.spots.filter((s) => s.uid === S.user.uid).length;
  const open = (v) => () => { S.meView = v; renderTab(); };
  p.append(
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
      el("button", { class: "item", type: "button", onclick: open("friends") },
        el("span", { class: "row", style: "gap:10px" }, el("span", { class: "t" }, "Friends and chat"), S.reqIn.length ? el("span", { class: "pill live" }, `${S.reqIn.length} new`) : null), el("span", { class: "label" }, "›")),
      el("button", { class: "item", type: "button", onclick: open("log") }, el("span", { class: "t" }, "My fishing log"), el("span", { class: "label" }, "›")),
      el("button", { class: "item", type: "button", id: "me-game", onclick: openFishGame }, el("span", { class: "t" }, "Fishing game"), el("span", { class: "label" }, "🎣")),
      isStaff() ? el("button", { class: "item", type: "button", onclick: open("owner") }, el("span", { class: "t" }, S.owner ? "Owner tools" : "Moderator tools"), el("span", { class: "label" }, "›")) : null,
      el("button", { class: "item", type: "button", onclick: open("settings") }, el("span", { class: "t" }, "Settings"), el("span", { class: "label" }, "›"))),
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
  p.append(backBtn("‹ Profile"), el("h1", null, "Settings"),
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
      el("span", { class: "hint" }, "Your angler name can't be changed."),
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
  { id: "pond", n: "Pond", lvl: 1, sky: ["#ffe2b0", "#d6ecf2"], water: ["#4aa6b9", "#1d6577"], fish: ["Bluegill", "Largemouth bass", "Channel catfish"] },
  { id: "lake", n: "Lake", lvl: 3, sky: ["#bcd0ff", "#e3f0f5"], water: ["#3a7fb0", "#123e5f"], fish: ["Crappie", "Largemouth bass", "Walleye", "Northern pike"] },
  { id: "river", n: "River", lvl: 5, sky: ["#ffcfae", "#f1e6d6"], water: ["#4b9a8a", "#17463f"], fish: ["Rainbow trout", "Smallmouth bass", "Channel catfish", "Common carp"] }];
const FC_LURES = [["spinner", "Spinner"], ["worm", "Worm"], ["crank", "Crankbait"], ["jig", "Minnow jig"]];
const FC_RODS = [{ n: "Starter rod", cost: 0, note: "" }, { n: "Fiberglass rod", cost: 150, note: "Reels a bit faster, line holds better" },
  { n: "Graphite rod", cost: 500, note: "Faster reel, much safer line" }, { n: "Pro carbon rod", cost: 1500, note: "Best reel speed and line control" }];
const FC_LURE_COST = [120, 400], FC_LURE_TAG = ["", " Pro", " Master"];
const FC_FISH = {
  "Bluegill": { min: 0.3, max: 1.6, r: 15, asp: 0.74, top: "#5b7f5a", belly: "#e8a24a", fin: "#4a6a8a", pat: "bars", patc: "rgba(20,40,60,.28)", ear: true, price: 30, w: { spinner: 1, worm: 3, crank: 0.4, jig: 2 } },
  "Largemouth bass": { min: 1, max: 9, r: 22, asp: 0.5, top: "#58742f", belly: "#e6e7c8", fin: "#6a8a3a", pat: "stripe", patc: "#2b3a17", price: 22, w: { spinner: 2, worm: 2, crank: 3, jig: 1 } },
  "Channel catfish": { min: 1, max: 14, r: 26, asp: 0.42, top: "#6d7478", belly: "#d9d6c9", fin: "#59605f", pat: "spots", patc: "rgba(30,35,35,.4)", whisk: true, price: 14, w: { spinner: 0.5, worm: 3, crank: 0.5, jig: 1 } },
  "Crappie": { min: 0.4, max: 2.5, r: 17, asp: 0.7, top: "#9aa98a", belly: "#f0efe0", fin: "#8b9b7c", pat: "spots", patc: "#3b4533", price: 28, w: { spinner: 1, worm: 1, crank: 0.5, jig: 3 } },
  "Walleye": { min: 1.5, max: 10, r: 24, asp: 0.44, top: "#a08d3a", belly: "#efe9c8", fin: "#8d7b2f", pat: "saddles", patc: "#4d4420", bigEye: true, price: 30, w: { spinner: 1, worm: 1, crank: 3, jig: 2 } },
  "Northern pike": { min: 2, max: 20, r: 30, asp: 0.3, top: "#5d7a3a", belly: "#e7e6c4", fin: "#7a8f45", pat: "bean", patc: "#cdd59a", jaw: true, price: 20, w: { spinner: 2, worm: 0.5, crank: 3, jig: 1 } },
  "Rainbow trout": { min: 0.5, max: 8, r: 21, asp: 0.44, top: "#8fa3a0", belly: "#f1ece4", fin: "#9fb0ad", pat: "speckle", patc: "#2f3a38", price: 26, w: { spinner: 3, worm: 1.5, crank: 1, jig: 2 } },
  "Smallmouth bass": { min: 0.8, max: 6, r: 21, asp: 0.5, top: "#8c7440", belly: "#e9e1c2", fin: "#7a6535", pat: "bars", patc: "rgba(60,40,15,.45)", price: 24, w: { spinner: 2, worm: 2, crank: 2, jig: 2 } },
  "Common carp": { min: 2, max: 25, r: 29, asp: 0.58, top: "#b08a3a", belly: "#e8d7a0", fin: "#a37a30", pat: "scales", patc: "rgba(255,255,255,.28)", whisk: true, price: 10, w: { spinner: 0.4, worm: 3, crank: 0.3, jig: 0.6 } }};
const fcXp = () => +getPref("fcxp", "0") || 0;
const fcLevel = () => 1 + Math.floor(Math.sqrt(fcXp() / 40));
const fcCoins = () => +getPref("fccoins", "0") || 0;
const fcRod = () => Math.min(FC_RODS.length - 1, +getPref("fcrod", "0") || 0);
const fcLureLv = () => { try { return JSON.parse(getPref("fclv", "{}")) || {}; } catch { return {}; } };
const fcDex = () => { try { return JSON.parse(getPref("fcdex", "{}")) || {}; } catch { return {}; } };
const lbText = (w) => w.toFixed(2) + " lb";
const fcTier = (n, w) => { const f = FC_FISH[n], q = (w - f.min) / (f.max - f.min); return q < 0.12 ? ["Tiny", 1, q] : q < 0.35 ? ["Small", 1, q] : q < 0.6 ? ["Nice size", 1.1, q] : q < 0.85 ? ["Big one", 1.3, q] : ["Trophy", 1.8, q]; };
const fcValue = (n, w) => Math.max(1, Math.round(w * FC_FISH[n].price * fcTier(n, w)[1]));
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
function fcStep(F, down, dt, rodLv, hooks) {
  const s = F.s, gm = 1 - 0.1 * rodLv, rm = (1 + 0.15 * rodLv) * (F.time > 20 ? 1 + (F.time - 20) * 0.05 : 1);
  F.time += dt; F.phT -= dt; F.phA += dt;
  if (F.phT <= 0) fcSetPhase(F, fcPickPhase(F), hooks);
  const ph = F.ph;
  const gain = { rest: 0.32, pull: 0.45 + 0.15 * s, run: 0.45 + 0.5 * s, thrash: 0.5 + 0.2 * s, jump: 0.45 }[ph];
  const fall = { run: 0.3, thrash: 0.45 }[ph] ?? 0.55;
  if (ph === "thrash" && (F.shake -= dt) <= 0) { F.shake = 0.14; F.t += (Math.random() - 0.4) * 0.16 * (0.5 + s); }
  if (ph === "jump" && F.phA > 0.15 && F.phA < 0.85 && down) F.t += 0.9 * dt;
  if (down) F.t += gain * gm * dt; else F.t -= fall * dt;
  F.t = Math.max(0, F.t);
  const green = F.t >= 0.3 && F.t <= 0.72;
  if (down) F.d -= (green ? 30 : F.t > 0.72 ? 10 : 5) * dt * (1.1 - 0.5 * s) * rm * (ph === "rest" ? 1.35 : ph === "run" ? 0.4 : 1);
  if (ph === "run") F.d += (down ? 4 : 9) * (0.4 + 0.6 * s) * dt;
  if (ph === "pull") F.d += (down ? 1.5 : 4) * s * dt;
  F.d = Math.min(100, F.d);
  F.slack = F.t < 0.1 ? F.slack + dt : Math.max(0, F.slack - dt);
  if (F.t >= 1) return "snap";
  if (F.slack > 2.2) return "slack";
  if (F.d <= 0) return "win";
  return null;
}
/*ENDFCSTEP*/

function openFishGame() {
  let loc = getPref("fcloc", "pond"), lure = getPref("fclure", "spinner");
  if (!FC_LOCS.some((l) => l.id === loc && l.lvl <= fcLevel())) loc = "pond";
  const box = el("div", { class: "fc-menu-in" });
  const bg = el("div", { class: "game-bg fc-menu", role: "dialog", "aria-label": "Fishing game menu" }, box);
  document.body.append(bg);
  const close = () => bg.remove();
  const draw = () => {
    const lv = fcLevel(), xp = fcXp(), lo = 40 * (lv - 1) ** 2, hi = 40 * lv ** 2, dex = fcDex(), coins = fcCoins(), rod = fcRod(), lvs = fcLureLv();
    const names = Object.keys(FC_FISH);
    const buyRod = () => { const r = FC_RODS[rod + 1]; if (r && fcCoins() >= r.cost) { setPref("fccoins", String(fcCoins() - r.cost)); setPref("fcrod", String(rod + 1)); draw(); } };
    box.replaceChildren(
      el("div", { class: "row spread" }, el("h1", null, "Lake Duel"), el("button", { class: "link", type: "button", onclick: close }, "Close")),
      el("div", { class: "fc-card" }, el("div", { class: "row spread" }, el("b", null, "Level " + lv), el("b", { id: "fc-coins" }, "🪙 " + coins)),
        el("div", { class: "meter" }, el("i", { style: "width:" + Math.round((xp - lo) / (hi - lo) * 100) + "%" })),
        el("span", { class: "muted small" }, xp + " / " + hi + " XP to level " + (lv + 1))),
      el("h2", null, "Where"),
      el("div", { class: "chips" }, FC_LOCS.map((l) => el("button", { class: "chip", type: "button", disabled: l.lvl > lv ? "" : null, "aria-pressed": String(loc === l.id),
        onclick: () => { loc = l.id; setPref("fcloc", loc); draw(); } }, l.n + (l.lvl > lv ? " 🔒 Lv " + l.lvl : "")))),
      el("h2", null, "Lure"),
      el("div", { class: "chips" }, FC_LURES.map(([id, n]) => el("button", { class: "chip", type: "button", "aria-pressed": String(lure === id), onclick: () => { lure = id; setPref("fclure", id); draw(); } }, n + FC_LURE_TAG[lvs[id] || 0]))),
      el("p", { class: "muted small" }, "Different lures attract different fish. Here you can catch: " + FC_LOCS.find((l) => l.id === loc).fish.join(", ") + "."),
      el("button", { class: "btn wide", type: "button", id: "fc-duel", onclick: () => playClash("duel", loc, lure, draw) }, "Duel a rival (3 casts)"),
      el("button", { class: "btn ghost wide", type: "button", id: "fc-free", onclick: () => playClash("free", loc, lure, draw) }, "Free fishing"),
      el("button", { class: "btn ghost wide", type: "button", id: "fc-rush", onclick: openReelRush }, "Quick game: Reel Rush"),
      el("h2", null, "Tackle shop"),
      el("div", { class: "fc-card" },
        el("div", { class: "row spread" }, el("div", { class: "stack", style: "gap:2px" }, el("b", null, FC_RODS[rod].n), el("span", { class: "muted small" }, rod ? FC_RODS[rod].note : "Your first rod.")),
          FC_RODS[rod + 1] ? el("button", { class: "btn small", type: "button", id: "fc-buyrod", disabled: coins < FC_RODS[rod + 1].cost ? "" : null, onclick: buyRod }, `${FC_RODS[rod + 1].n} 🪙 ${FC_RODS[rod + 1].cost}`) : el("span", { class: "pill live" }, "Best rod"))),
      el("div", { class: "list" }, FC_LURES.map(([id, n]) => { const l = lvs[id] || 0, cost = FC_LURE_COST[l];
        return el("div", { class: "item", style: "cursor:default" }, el("div", { class: "stack", style: "gap:2px" }, el("span", { class: "t" }, n + FC_LURE_TAG[l]), el("span", { class: "s" }, l ? "Attracts bigger fish" : "Basic")),
          cost ? el("button", { class: "btn small", type: "button", "data-buy": id, disabled: coins < cost ? "" : null, onclick: () => { if (fcCoins() >= cost) { setPref("fccoins", String(fcCoins() - cost)); lvs[id] = l + 1; setPref("fclv", JSON.stringify(lvs)); draw(); } } }, "Upgrade 🪙 " + cost) : el("span", { class: "pill live" }, "Maxed")); })),
      el("h2", null, `My fish (${Object.keys(dex).length}/${names.length})`),
      el("div", { class: "list" }, names.map((n) => el("div", { class: "item", style: "cursor:default" },
        el("span", { class: "t" }, dex[n] ? n : "???"), el("span", { class: "s" }, dex[n] ? `best ${lbText(dex[n].best)} · caught ${dex[n].n}` : "not caught yet")))),
      el("p", { class: "muted small" }, "How to play: tap to cast. Wait for the bobber to dip, then tap fast to hook the fish. Hold to reel. When the fish runs or jumps, let go so the line doesn't snap. Sell value comes from the fish's size, so bigger fish pay more coins."));
  };
  draw();
}

function playClash(mode, locId, lureId, onExit) {
  const L = FC_LOCS.find((l) => l.id === locId) || FC_LOCS[0];
  const rodLv = fcRod(), lureLv = fcLureLv()[lureId] || 0;
  const canvas = el("canvas", { class: "game-canvas", role: "img", "aria-label": "Fishing game. Tap to cast and hook. Hold to reel. Let go when the fish runs." });
  const ctx = canvas.getContext("2d");
  const sndBtn = el("button", { class: "game-x game-snd", type: "button", "aria-label": "Sound on or off", onclick: () => { soundOn = !soundOn; setPref("fcsound", soundOn ? "1" : "0"); sndBtn.textContent = soundOn ? "🔊" : "🔇"; if (!soundOn) whine(false); } });
  const bg = el("div", { class: "game-bg", role: "dialog", "aria-label": "Fishing" }, canvas, sndBtn,
    el("button", { class: "game-x", type: "button", "aria-label": "Leave the game", onclick: () => end() }, "✕"));
  document.body.append(bg);
  let W = 0, H = 0, raf = 0, dpr = 1, last = 0, deco = null;
  /* ---------- sound (made with the browser, no files) ---------- */
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
  const resize = () => { dpr = Math.min(2, devicePixelRatio || 1); W = bg.clientWidth; H = bg.clientHeight; canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + "px"; canvas.style.height = H + "px"; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); deco = buildDeco(); };
  const end = () => { cancelAnimationFrame(raf); whine(false); removeEventListener("resize", resize); removeEventListener("keydown", onKey); removeEventListener("keyup", onKeyUp); try { actx && actx.close(); } catch { /* ignore */ } bg.remove(); onExit && onExit(); };

  /* ---------- scenery ---------- */
  const rng = (seed) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const wy = () => H * 0.25;
  function buildDeco() {
    const r = rng(L.id.length * 977 + (L.id.charCodeAt(0) || 1)), w = W, y0 = wy(), D = { clouds: [], hills: [], trees: [], reeds: [], pads: [], rocks: [], shadows: [], birds: [], sparkles: [] };
    for (let i = 0; i < 4; i++) D.clouds.push({ x: r() * w, y: 20 + r() * y0 * 0.45, s: 0.7 + r() * 0.9, v: 4 + r() * 8 });
    D.hills = [[0.55, "rgba(120,150,170,.45)", 0.5], [0.35, "rgba(70,105,90,.6)", 0.8]].map(([amp, col, f]) => ({ col, pts: Array.from({ length: 12 }, (_, i) => [i * w / 11, y0 - 8 - r() * y0 * amp * f]) }));
    const n = Math.round(w / 22);
    for (let i = 0; i < n; i++) D.trees.push({ x: i * 22 + r() * 16, h: 22 + r() * 36, k: r(), pine: L.id !== "pond" ? r() < 0.8 : r() < 0.2 });
    for (let i = 0; i < 16; i++) D.reeds.push({ x: (i < 8 ? r() * w * 0.28 : w * 0.72 + r() * w * 0.28), h: 26 + r() * 40, ph: r() * 6, cat: r() < 0.5 });
    if (L.id === "pond") for (let i = 0; i < 9; i++) D.pads.push({ x: r() * w, y: y0 + 60 + r() * (H * 0.45), s: 14 + r() * 14 });
    if (L.id === "river") for (let i = 0; i < 8; i++) D.rocks.push({ x: r() * w, y: y0 + 50 + r() * (H * 0.55), s: 10 + r() * 22 });
    for (let i = 0; i < 4; i++) D.shadows.push({ x: r() * w, y: y0 + 80 + r() * H * 0.5, s: 14 + r() * 16, v: (r() < 0.5 ? -1 : 1) * (10 + r() * 14) });
    for (let i = 0; i < 2; i++) D.birds.push({ x: r() * w, y: 30 + r() * y0 * 0.4, v: 25 + r() * 20, ph: r() * 6 });
    for (let i = 0; i < 26; i++) D.sparkles.push({ x: r() * w, y: y0 + 10 + r() * (H - y0) * 0.85, ph: r() * 6 });
    return D;
  }
  resize(); addEventListener("resize", resize);

  /* ---------- game state ---------- */
  const CASTS = 3, rivalName = ["Lakeside Lou", "Big Mike", "Sunny", "Cody", "Captain Pete"][Math.floor(Math.random() * 5)];
  let st = "cast", ci = 0, mine = [], rival = [], down = false, powerT = 0, power = 0, great = false, timer = 0, biteAt = 0, msg = "", fish = null, weight = 0, F = null, rec = false, resText = "", earned = { xp: 0, coins: 0 }, btn = null, shakeT = 0, drops = [], rip = [], lastTier = null;
  const setSt = (s) => { st = s; bg.dataset.state = s; };
  setSt("cast");
  const pickFish = () => {
    const ws = L.fish.map((n) => FC_FISH[n].w[lureId] * (n === L.fish[0] ? 1 : 1)); let r = Math.random() * ws.reduce((a, b) => a + b, 0), i = 0;
    for (; i < ws.length - 1; i++) { if ((r -= ws[i]) <= 0) break; }
    return L.fish[i];
  };
  const rollWeight = (n, good, lv) => { const f = FC_FISH[n]; return Math.round((f.min + (f.max - f.min) * Math.pow(Math.random(), (good ? 1.7 : 2.6) - 0.3 * (lv || 0))) * 100) / 100; };
  if (mode === "duel") for (let i = 0; i < CASTS; i++) rival.push(Math.random() < 0.15 ? 0 : rollWeight(pickFish(), Math.random() < 0.4, 0));

  const bobber = () => ({ x: W / 2 + Math.sin(ci * 2.1) * W * 0.12, y: H * (0.62 - 0.3 * power) });
  const shore = () => ({ x: W / 2, y: H * 0.86 });
  const tipPos = () => ({ x: W / 2 + 30 + (F ? -F.t * 14 : 0), y: H * 0.8 + (F ? F.t * 16 : 0) });

  function doCast() { audio(); power = powerT; great = power > 0.6 && power < 0.9; timer = 1.6 + Math.random() * 2.6; setSt("wait"); tick(700, 0.2, 0.25, 1); rip.push({ ...bobber(), a: 1 }); }
  function hook() {
    fish = pickFish(); weight = rollWeight(fish, great, lureLv); const f = FC_FISH[fish];
    F = fcNewFight(0.3 + 0.7 * (weight - f.min) / (f.max - f.min)); F.jumpY = 0; F.off = 0; F.dir = 1; bg.dataset.phase = F.ph; setSt("fight"); tick(900, 0.25, 0.08);
  }
  const hooks = { phase: (n) => { bg.dataset.phase = n; if (n === "jump") { splash(0.9); tick(450, 0.3, 0.3, 1); } if (n === "run") clickAcc = 0; } };
  function splash(k) { const b = fightPos(); for (let i = 0; i < 14 * k; i++) drops.push({ x: b.x, y: b.y, vx: (Math.random() - 0.5) * 160, vy: -80 - Math.random() * 140, a: 1 }); rip.push({ x: b.x, y: b.y, a: 1 }); }
  function finish(win) {
    resText = ""; rec = false; earned = { xp: 0, coins: 0 }; whine(false);
    if (win) {
      mine[ci] = weight; const dex = fcDex(), d = dex[fish] || { best: 0, n: 0 };
      rec = weight > d.best; d.best = Math.max(d.best, weight); d.n++; dex[fish] = d; setPref("fcdex", JSON.stringify(dex));
      earned = { xp: Math.round(weight * 8) + 5, coins: fcValue(fish, weight) }; lastTier = fcTier(fish, weight);
      setPref("fcxp", String(fcXp() + earned.xp)); setPref("fccoins", String(fcCoins() + earned.coins)); tick(1200, 0.25, 0.15, 5); setTimeout(() => tick(1700, 0.25, 0.2, 5), 120);
    } else { mine[ci] = 0; fish = fish && win ? fish : null; }
    setSt("result");
  }
  function lose(text) { msg = text; fish = null; finish(false); }
  function advance() {
    if (mode === "duel" && ci >= CASTS - 1) {
      const a = mine.reduce((x, y) => x + y, 0), b = rival.reduce((x, y) => x + y, 0), out = a > b ? "win" : a < b ? "lose" : "draw";
      const bonus = { win: [60, 100], draw: [30, 40], lose: [15, 20] }[out];
      setPref("fcxp", String(fcXp() + bonus[0])); setPref("fccoins", String(fcCoins() + bonus[1])); earned = { xp: bonus[0], coins: bonus[1] };
      resText = out; setSt("over"); return;
    }
    ci++; fish = null; F = null; setSt("cast"); powerT = 0;
  }
  const act = () => {
    if (st === "cast") doCast();
    else if (st === "wait") { lose("Too early! The fish got spooked."); }
    else if (st === "bite") hook();
  };
  const press = () => { if (st === "result") advance(); else if (st === "over") end(); };
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture?.(e.pointerId); const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (st === "result" || st === "over") { if (btn && x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) press(); return; }
    down = true; act();
  });
  canvas.addEventListener("pointerup", () => { down = false; });
  canvas.addEventListener("pointercancel", () => { down = false; });
  const onKey = (e) => { if (e.key === "Escape") { end(); return; } if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (e.repeat) return; if (st === "result" || st === "over") press(); else { down = true; act(); } } };
  const onKeyUp = (e) => { if (e.key === " " || e.key === "Enter") down = false; };
  addEventListener("keydown", onKey); addEventListener("keyup", onKeyUp);

  /* ---------- drawing ---------- */
  const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const text = (s, x, y, size, color, align, font) => { ctx.font = `bold ${size}px ${font || "system-ui,sans-serif"}`; ctx.textAlign = align || "center"; ctx.fillStyle = color || "#fff"; ctx.fillText(s, x, y); };
  function drawReal(name, x, y, r, dir, rot, open) {
    const f = FC_FISH[name], h = r * f.asp;
    ctx.save(); ctx.translate(x, y); ctx.scale(dir, 1); ctx.rotate(rot || 0);
    // tail
    ctx.fillStyle = f.fin; ctx.beginPath(); ctx.moveTo(-r * 0.7, 0); ctx.quadraticCurveTo(-r * 1.05, -h * 0.25, -r * 1.4, -h * 0.85); ctx.quadraticCurveTo(-r * 1.22, 0, -r * 1.4, h * 0.85); ctx.quadraticCurveTo(-r * 1.05, h * 0.25, -r * 0.7, 0); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.18)"; ctx.lineWidth = 1; for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(-r * 0.8, 0); ctx.lineTo(-r * 1.3, i * h * 0.3); ctx.stroke(); }
    // dorsal + belly fins
    ctx.fillStyle = f.fin; ctx.beginPath(); ctx.moveTo(-r * 0.35, -h * 0.75); ctx.quadraticCurveTo(-r * 0.05, -h * 1.55, r * 0.4, -h * 0.85); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-r * 0.3, h * 0.75); ctx.quadraticCurveTo(-r * 0.4, h * 1.3, -r * 0.05, h * 0.85); ctx.closePath(); ctx.fill();
    // body
    const g = ctx.createLinearGradient(0, -h, 0, h); g.addColorStop(0, f.top); g.addColorStop(0.5, f.top); g.addColorStop(0.72, f.belly); g.addColorStop(1, f.belly);
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(r, h * 0.05); ctx.bezierCurveTo(r * 0.8, -h * 0.95, -r * 0.2, -h * 1.15, -r * 0.75, -h * 0.28); ctx.lineTo(-r * 0.75, h * 0.28); ctx.bezierCurveTo(-r * 0.2, h * 1.1, r * 0.75, h * 0.95, r, h * 0.05); ctx.closePath(); ctx.fill();
    ctx.save(); ctx.clip(); ctx.fillStyle = f.patc; ctx.strokeStyle = f.patc; ctx.lineWidth = 1;
    if (f.pat === "bars") for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.ellipse(-r * 0.55 + i * r * 0.27, -h * 0.15, r * 0.05, h * 0.85, 0.1, 0, 7); ctx.fill(); }
    else if (f.pat === "stripe") for (let i = 0; i < 8; i++) { ctx.beginPath(); ctx.ellipse(-r * 0.6 + i * r * 0.2, -h * 0.05 + (i % 2) * h * 0.03, r * 0.13, h * 0.17, 0, 0, 7); ctx.fill(); }
    else if (f.pat === "spots") for (let i = 0; i < 22; i++) { ctx.beginPath(); ctx.arc(-r * 0.7 + rnd(i) * r * 1.5, -h * 0.85 + rnd(i + 50) * h * 1.2, r * 0.035 + rnd(i + 9) * r * 0.02, 0, 7); ctx.fill(); }
    else if (f.pat === "saddles") for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.ellipse(-r * 0.5 + i * r * 0.27, -h * 0.8, r * 0.09, h * 0.55, 0, 0, 7); ctx.fill(); }
    else if (f.pat === "bean") for (let i = 0; i < 18; i++) { ctx.beginPath(); ctx.ellipse(-r * 0.65 + (i % 9) * r * 0.16, (i < 9 ? -h * 0.45 : h * 0.1), r * 0.05, h * 0.07, 0, 0, 7); ctx.fill(); }
    else if (f.pat === "speckle") { for (let i = 0; i < 40; i++) { ctx.beginPath(); ctx.arc(-r * 0.7 + rnd(i) * r * 1.6, -h * 0.9 + rnd(i + 77) * h * 1.1, r * 0.02, 0, 7); ctx.fill(); } ctx.globalAlpha = 0.85; ctx.fillStyle = "#e0728f"; ctx.beginPath(); ctx.ellipse(-r * 0.05, h * 0.02, r * 0.8, h * 0.13, 0, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
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
  function scene(now) {
    const y0 = wy(), D = deco, t = now / 1000;
    let g = ctx.createLinearGradient(0, 0, 0, y0); g.addColorStop(0, L.sky[0]); g.addColorStop(1, L.sky[1]); ctx.fillStyle = g; ctx.fillRect(0, 0, W, y0);
    const sg = ctx.createRadialGradient(W * 0.8, y0 * 0.35, 4, W * 0.8, y0 * 0.35, 70); sg.addColorStop(0, "rgba(255,246,200,1)"); sg.addColorStop(0.25, "rgba(255,236,170,.8)"); sg.addColorStop(1, "rgba(255,236,170,0)"); ctx.fillStyle = sg; ctx.fillRect(W * 0.8 - 80, y0 * 0.35 - 80, 160, 160);
    ctx.fillStyle = "rgba(255,255,255,.8)"; for (const c of D.clouds) { const cx = ((c.x + t * c.v) % (W + 160)) - 80; for (const [dx, dy, rr] of [[0, 0, 16], [16, -6, 20], [34, 0, 15], [14, 6, 14]]) { ctx.beginPath(); ctx.arc(cx + dx * c.s, c.y + dy * c.s, rr * c.s, 0, 7); ctx.fill(); } }
    for (const hl of D.hills) { ctx.fillStyle = hl.col; ctx.beginPath(); ctx.moveTo(0, y0); hl.pts.forEach(([x, y], i) => { if (i === 0) ctx.lineTo(x, y); else { const [px, py] = hl.pts[i - 1]; ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2); } }); ctx.lineTo(W, y0); ctx.closePath(); ctx.fill(); }
    ctx.strokeStyle = "#2a2a2a"; ctx.lineWidth = 1.6; for (const b of D.birds) { const bx = ((b.x + t * b.v) % (W + 60)) - 30, fl = Math.sin(t * 7 + b.ph) * 4; ctx.beginPath(); ctx.moveTo(bx - 8, b.y - fl); ctx.quadraticCurveTo(bx - 3, b.y - 4, bx, b.y); ctx.quadraticCurveTo(bx + 3, b.y - 4, bx + 8, b.y - fl); ctx.stroke(); }
    for (const tr of D.trees) { const base = y0 + 2; ctx.fillStyle = L.id === "river" ? "#2f5a3a" : L.id === "lake" ? "#244b36" : "#3d7a42";
      if (tr.pine) { for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(tr.x - 11 + k * 2, base - tr.h * (0.25 + k * 0.28)); ctx.lineTo(tr.x, base - tr.h * (0.65 + k * 0.28)); ctx.lineTo(tr.x + 11 - k * 2, base - tr.h * (0.25 + k * 0.28)); ctx.closePath(); ctx.fill(); } }
      else { ctx.beginPath(); ctx.arc(tr.x, base - tr.h * 0.7, 10 + tr.k * 8, 0, 7); ctx.fill(); ctx.fillStyle = "#4a3523"; ctx.fillRect(tr.x - 1.5, base - tr.h * 0.5, 3, tr.h * 0.5); } }
    g = ctx.createLinearGradient(0, y0, 0, H); g.addColorStop(0, L.water[0]); g.addColorStop(1, L.water[1]); ctx.fillStyle = g; ctx.fillRect(0, y0, W, H - y0);
    ctx.fillStyle = "rgba(255,255,255,.1)"; ctx.fillRect(0, y0, W, 18);
    for (const s of D.shadows) { const sx = ((s.x + t * s.v) % (W + 80) + W + 80) % (W + 80) - 40; ctx.fillStyle = "rgba(0,20,30,.18)"; ctx.beginPath(); ctx.ellipse(sx, s.y, s.s * 1.5, s.s * 0.55, 0, 0, 7); ctx.fill(); ctx.beginPath(); ctx.moveTo(sx - s.s * 1.4 * Math.sign(s.v), s.y); ctx.lineTo(sx - s.s * 2.2 * Math.sign(s.v), s.y - s.s * 0.5); ctx.lineTo(sx - s.s * 2.2 * Math.sign(s.v), s.y + s.s * 0.5); ctx.fill(); }
    ctx.strokeStyle = "rgba(255,255,255,.2)"; ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) { const y = y0 + 30 + i * (H - y0) / 6.5; ctx.beginPath(); for (let x = 0; x <= W; x += 14) ctx.lineTo(x, y + Math.sin(x / 30 + now / 500 + i) * 3); ctx.stroke(); }
    for (const p of D.pads) { ctx.fillStyle = "#3e8a45"; ctx.beginPath(); ctx.ellipse(p.x, p.y, p.s, p.s * 0.45, 0, 0.3, Math.PI * 2 - 0.1); ctx.lineTo(p.x, p.y); ctx.fill(); if (p.s > 22) { ctx.fillStyle = "#f6b6cc"; ctx.beginPath(); ctx.arc(p.x + 3, p.y - 3, 4, 0, 7); ctx.fill(); } }
    for (const rk of D.rocks) { ctx.fillStyle = "#59666b"; ctx.beginPath(); ctx.ellipse(rk.x, rk.y, rk.s, rk.s * 0.55, 0, Math.PI, 0); ctx.fill(); ctx.fillStyle = "rgba(255,255,255,.4)"; ctx.fillRect(rk.x - rk.s, rk.y - 1, rk.s * 2, 2); }
    for (const s of D.sparkles) { const a = Math.max(0, Math.sin(t * 2 + s.ph)); if (a > 0.6) { ctx.fillStyle = `rgba(255,255,255,${(a - 0.6) * 1.6})`; ctx.fillRect(s.x - 4, s.y, 8, 1.5); } }
    // bank
    const by = H * 0.9; g = ctx.createLinearGradient(0, by, 0, H); g.addColorStop(0, "#7a6440"); g.addColorStop(1, "#5a4a2e"); ctx.fillStyle = g; ctx.fillRect(0, by, W, H - by);
    ctx.fillStyle = "#4d7a35"; ctx.beginPath(); ctx.moveTo(0, by + 4); for (let x = 0; x <= W; x += 10) ctx.lineTo(x, by - 2 + Math.sin(x * 0.2) * 3); ctx.lineTo(W, by + 8); ctx.lineTo(0, by + 8); ctx.fill();
    ctx.fillStyle = "#6b4a2a"; ctx.fillRect(0, by - 10, W * 0.2, 7); for (let i = 0; i < 5; i++) ctx.fillRect(i * W * 0.045, by - 2, 5, 22); ctx.fillStyle = "rgba(0,0,0,.2)"; ctx.fillRect(0, by - 3, W * 0.2, 2);
    for (const r of D.reeds) { const sway = Math.sin(t * 1.4 + r.ph) * 4, rx = r.x, ry = by + 2; ctx.strokeStyle = "#3f6a2c"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(rx, ry); ctx.quadraticCurveTo(rx + sway * 0.5, ry - r.h * 0.5, rx + sway, ry - r.h); ctx.stroke(); if (r.cat) { ctx.fillStyle = "#6a4528"; ctx.beginPath(); ctx.ellipse(rx + sway, ry - r.h - 5, 3, 8, 0, 0, 7); ctx.fill(); } }
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now; update(dt);
    ctx.save(); if (shakeT > 0) ctx.translate((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
    scene(now);
    const b = bobber(), tip = tipPos();
    // ripples + drops
    for (const r of rip) { r.a -= dt * 0.9; } for (let i = rip.length - 1; i >= 0; i--) if (rip[i].a <= 0) rip.splice(i, 1);
    ctx.lineWidth = 1.5; for (const r of rip) { ctx.strokeStyle = `rgba(255,255,255,${r.a * 0.6})`; ctx.beginPath(); ctx.ellipse(r.x, r.y + 4, (1 - r.a) * 50 + 6, (1 - r.a) * 18 + 2, 0, 0, 7); ctx.stroke(); }
    if (st === "wait" || st === "bite") {
      const dip = st === "bite" ? 7 + Math.sin(now / 40) * 3 : Math.sin(now / 500) * 2;
      ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.quadraticCurveTo((tip.x + b.x) / 2, (tip.y + b.y) / 2 + 30, b.x, b.y + dip); ctx.stroke();
      ctx.fillStyle = "#e5352b"; ctx.beginPath(); ctx.arc(b.x, b.y + dip, 9, Math.PI, 0); ctx.fill(); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(b.x, b.y + dip, 9, 0, Math.PI); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(b.x, b.y + 10, 16 + Math.sin(now / 400) * 3, 5, 0, 0, 7); ctx.stroke();
      if (st === "bite") { ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.beginPath(); ctx.ellipse(b.x, b.y + 4, 18 + (biteAt * 40), 7 + biteAt * 14, 0, 0, 7); ctx.stroke(); text("!", b.x, b.y - 34, 54, "#ffd36b"); }
    }
    let fp = null;
    if (st === "fight") {
      fp = fightPos(); const ph = F.ph, col = F.t > 0.72 ? "#ff6b5e" : F.t < 0.3 ? "#cfd8dc" : "#fff";
      ctx.strokeStyle = col; ctx.lineWidth = 1.5 + F.t * 2.5; ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(fp.x, fp.y); ctx.stroke();
      const r = fishR(fish, weight), dir = fp.x < tip.x ? 1 : -1, airborne = ph === "jump" && F.phA < 1;
      const wob = Math.sin(F.time * (ph === "thrash" ? 28 : ph === "run" ? 16 : 7)) * (ph === "thrash" ? 0.35 : ph === "run" ? 0.18 : 0.1) + (airborne ? -0.5 + F.phA * 1.0 : 0);
      if (!airborne) { ctx.fillStyle = "rgba(0,0,0,.18)"; ctx.beginPath(); ctx.ellipse(fp.x, fp.y + r * 0.5, r * 1.1, r * 0.3, 0, 0, 7); ctx.fill(); }
      drawReal(fish, fp.x, fp.y, r, dir, wob, ph === "thrash" || airborne);
      if (ph === "run" || ph === "thrash") { ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 2; for (let i = 0; i < 2; i++) { ctx.beginPath(); ctx.ellipse(fp.x, fp.y + 4, 30 + ((now / 8 + i * 60) % 120), 10 + ((now / 20 + i * 20) % 36), 0, 0, 7); ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1; } }
    }
    for (const d of drops) { d.x += d.vx * dt; d.y += d.vy * dt; d.vy += 420 * dt; d.a -= dt * 1.4; ctx.fillStyle = `rgba(255,255,255,${Math.max(0, d.a)})`; ctx.beginPath(); ctx.arc(d.x, d.y, 2.2, 0, 7); ctx.fill(); } for (let i = drops.length - 1; i >= 0; i--) if (drops[i].a <= 0) drops.splice(i, 1);
    // rod (bends when the line is tight)
    const bend = F ? F.t * 26 : 4;
    ctx.strokeStyle = "#2f2217"; ctx.lineCap = "round"; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(W / 2 + 74, H + 12); ctx.quadraticCurveTo(W / 2 + 56 - bend * 0.3, H * 0.9, tip.x, tip.y); ctx.stroke();
    ctx.strokeStyle = "#7d6a55"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(W / 2 + 74, H + 12); ctx.quadraticCurveTo(W / 2 + 56 - bend * 0.3, H * 0.9, tip.x, tip.y); ctx.stroke();
    ctx.fillStyle = "#222"; ctx.beginPath(); ctx.arc(W / 2 + 66, H * 0.93, 11, 0, 7); ctx.fill(); ctx.strokeStyle = "#aaa"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(W / 2 + 66, H * 0.93, 7, (now / 100) * (F && down ? 1 : 0), (now / 100) * (F && down ? 1 : 0) + 4); ctx.stroke();
    ctx.restore();
    hud(now, fp);
    if (st === "result" || st === "over") card(now);
  }
  function hud(now) {
    ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 4;
    if (mode === "duel") {
      const a = mine.reduce((x, y) => x + y, 0), r = rival.slice(0, st === "over" ? CASTS : ci + (st === "result" ? 1 : 0)).reduce((x, y) => x + y, 0);
      text(`Cast ${Math.min(ci + 1, CASTS)} of ${CASTS}`, W / 2, 30, 18);
      text("You " + a.toFixed(1) + " lb", 16, 74, 16, "#fff", "left"); text(rivalName + " " + r.toFixed(1) + " lb", W - 16, 74, 16, "#fff", "right");
    } else text("Free fishing · " + L.n, W / 2, 30, 18);
    text("🪙 " + fcCoins(), 16, 30, 16, "#ffd36b", "left");
    ctx.shadowBlur = 0;
    if (st === "cast") {
      text("Tap to cast. Stop the bar in the green.", W / 2, H * 0.2, 18);
      const bx = W * 0.15, bw = W * 0.7, by = H * 0.945;
      ctx.fillStyle = "rgba(0,0,0,.5)"; ctx.fillRect(bx, by, bw, 14); ctx.fillStyle = "#4caf50"; ctx.fillRect(bx + bw * 0.6, by, bw * 0.3, 14); ctx.fillStyle = "#fff"; ctx.fillRect(bx + bw * power - 3, by - 5, 6, 24);
    }
    if (st === "wait") text("Wait for a bite...", W / 2, H * 0.2, 20);
    if (st === "bite") text("TAP NOW!", W / 2, H * 0.2, 30, "#ffd36b");
    if (st === "fight") {
      const gx = W - 44, gy = H * 0.3, gh = H * 0.42;
      ctx.fillStyle = "rgba(0,0,0,.4)"; ctx.fillRect(gx, gy, 26, gh); ctx.fillStyle = "#4caf50"; ctx.fillRect(gx, gy + gh * 0.28, 26, gh * 0.42); ctx.fillStyle = "#d9423a"; ctx.fillRect(gx, gy, 26, gh * 0.28);
      const ty = gy + gh * (1 - Math.min(1, F.t)); ctx.fillStyle = "#fff"; ctx.fillRect(gx - 6, ty - 3, 38, 6); text("LINE", gx + 13, gy - 8, 13);
      ctx.fillStyle = "rgba(0,0,0,.4)"; ctx.fillRect(16, gy, 14, gh); ctx.fillStyle = "#ffd36b"; const dh = gh * (1 - F.d / 100); ctx.fillRect(16, gy + gh - dh, 14, dh);
      const msgs = { rest: ["It's tiring! Reel it in!", "#fff"], pull: ["Reel steadily", "#fff"], run: ["FISH RUNNING! Let go!", "#ffb74d"], thrash: ["It's thrashing! Careful!", "#ffb74d"], jump: ["It jumped! Let go!", "#ff8a80"] }[F.ph];
      ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = 5; text(msgs[0], W / 2, H * 0.2, 22, msgs[1]); ctx.shadowBlur = 0;
    }
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
      let ry = cy + 360; text(`🪙 +${earned.coins} coins`, W / 2, ry, 20, "#8a5a00"); ry += 28; text(`+${earned.xp} XP`, W / 2, ry, 17, "#2e6a5a"); if (rec) { ry += 26; text("New personal best!", W / 2, ry, 17, "#2e7d32"); }
      button("Continue", cy + ch - 76);
    } else if (st === "result") {
      text("It got away", W / 2, cy + 90, 32, "#7a2418", "center", "Georgia,serif"); text(msg, W / 2, cy + 140, 17, "#333");
      text("Tip: tap when the bobber dips and the ! shows up.", W / 2, cy + 190, 14, "#666");
      button("Continue", cy + ch - 76);
    } else {
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
    if (st === "wait") { timer -= dt; if (timer <= 0) { biteAt = 0; setSt("bite"); tick(1500, 0.12, 0.05); } }
    if (st === "bite") { biteAt += dt; if (biteAt > 0.95) lose("Too slow. It got away."); }
    if (st === "fight") {
      const out = fcStep(F, down, dt, rodLv, hooks); bg.dataset.tension = F.t.toFixed(2);
      // reel sounds: fast screaming drag while the fish runs, slow clicks while you crank
      if (F.ph === "run") { whine(true, 800 + 700 * F.s + (F.d < 50 ? 150 : 0)); clickAcc += dt * (26 + 26 * F.s); while (clickAcc >= 1) { clickAcc -= 1; tick(2000 + Math.random() * 1400, 0.14, 0.02, 4); } }
      else { whine(false); if (down) { clickAcc += dt * 9; while (clickAcc >= 1) { clickAcc -= 1; tick(1300 + Math.random() * 300, 0.07, 0.02, 4); } } }
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
