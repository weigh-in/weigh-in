// Weigh-In: post catches, swipe the feed, run tournaments, keep a log, chat with friends.
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, getDoc, addDoc, deleteDoc, updateDoc, onSnapshot,
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
  meView: "main", mine: [], spots: [], map: null, markers: null,
};
const unsubs = [];
let tourUnsub = null, meUnsub = null;
function stopAll() { unsubs.splice(0).forEach((u) => u()); tourUnsub?.(); tourUnsub = null; meUnsub?.(); meUnsub = null; destroyMap(); S.mine = []; }

/* ======================= auth screens ======================= */
const NAME_RE = /^[A-Za-z0-9_]{2,20}$/;

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
    if (S.tab === "map" && S.map) drawSpots(false);
  }, () => {}));
  buildShell();
}
function refreshMe(view) { if (S.tab === "me" && (S.meView === view || S.meView === "main")) renderTab(); }

let $screen, $nav;
function buildShell() {
  $screen = el("div", { class: "screen" });
  const tabs = [["feed", "Feed", ICON.feed], ["map", "Map", ICON.map], ["post", "Post", ICON.plus], ["tours", "Tourneys", ICON.trophy], ["me", "Me", ICON.me]];
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
  if (S.tab !== "map") destroyMap();
  if (S.tab === "feed") return renderFeed();
  if (S.tab === "map") return renderMap();
  if (S.tab === "me") watchMine();
  $screen.className = "screen";
  const p = el("div", { class: "pad" });
  ({ post: viewPost, tours: viewTours, me: viewMe })[S.tab](p);
  $screen.replaceChildren(p);
  updateDot();
}

/* ======================= FEED (swipe up/down) ======================= */
let $feed;
function renderFeed() {
  $screen.className = "screen feed-wrap";
  $feed = el("div", { class: "feed", "aria-label": "Catch feed. Swipe up for the next catch." });
  $screen.replaceChildren(el("div", { class: "feed-top" }, el("span", { class: "brand" }, "Weigh-In")), $feed);
  renderFeedCards();
}
const cardCache = new Map();
function renderFeedCards() {
  if (!$feed || S.tab !== "feed") return;
  if (!S.posts.length) {
    $feed.replaceChildren(el("div", { class: "feed-empty" }, el("div", { class: "stack" },
      el("h2", null, "No catches yet"), el("p", null, "Be the first. Tap the red Post button."))));
    return;
  }
  // Keep the card you're looking at in view when new posts arrive.
  const cards = [...$feed.querySelectorAll(".card")];
  const h = $feed.clientHeight || 1;
  const currentId = cards[Math.round($feed.scrollTop / h)]?.dataset.id;
  const nodes = S.posts.map((p) => { let n = cardCache.get(p.id); if (!n) { n = makeCard(p); cardCache.set(p.id, n); } return n; });
  $feed.replaceChildren(...nodes);
  const idx = currentId ? S.posts.findIndex((p) => p.id === currentId) : 0;
  if (idx > 0) $feed.scrollTop = idx * $feed.clientHeight;
}
function makeCard(p) {
  const mine = p.uid === S.user.uid;
  return el("article", { class: "card", "data-id": p.id },
    p.photo ? el("img", { src: p.photo, alt: `${p.species} caught by ${p.name}`, loading: "lazy" }) : el("div", { class: "nophoto" }, "No photo"),
    el("div", { class: "shade" }),
    el("div", { class: "info" },
      el("div", { class: "who" }, avatar(p.uid, p.name, 30), el("span", null, "@" + p.name + "  ·  " + ago(p.createdAt))),
      el("div", { class: "species" }, p.species),
      el("div", { class: "size" }, sizeText(p)),
      el("div", { class: "meta" }, [p.lure ? "Caught on " + p.lure : null, p.spot || null, p.tournamentName ? "🏆 " + p.tournamentName : null].filter(Boolean).join("  ·  "))),
    el("div", { class: "side" },
      el("div", null, el("button", { type: "button", "aria-label": "Comments", html: ICON.chat, onclick: () => openComments(p) }), el("small", null, "Comments")),
      mine ? el("div", null, el("button", { type: "button", "aria-label": "Delete this post", html: ICON.trash, onclick: () => deletePost(p) }), el("small", null, "Delete")) : null));
}
async function deletePost(p) {
  if (!confirm("Delete this catch? This can't be undone.")) return;
  try {
    await deleteDoc(doc(db, "posts", p.id)); cardCache.delete(p.id);
    deleteDoc(doc(db, "spots", p.id)).catch(() => {}); // its map pin, if it had one
    toast("Catch deleted.");
  } catch (e) { toast(errText(e)); }
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
      c.uid === S.user.uid ? el("button", { class: "link danger small", type: "button", style: "align-self:flex-start", onclick: () => deleteDoc(doc(db, "posts", p.id, "comments", c.id)).catch((e) => toast(errText(e))) }, "Delete") : null)));
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
function tourStatus(t) {
  const today = localDate(new Date());
  if (today < t.start) return "soon";
  if (today > t.end) return "final";
  return "live";
}
let draftPhoto = "", draftLoc = null;
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
  const locNote = el("span", { class: "hint" });
  const precSel = el("select", { id: "f-prec", name: "prec", "aria-label": "How exact the map pin is", onchange: () => setPref("prec", precSel.value) },
    el("option", { value: "approx" }, "Approximate area (about 1 km)"), el("option", { value: "exact" }, "Exact spot"));
  precSel.value = getPref("prec", "approx");
  const locBtn = el("button", { class: "btn ghost small", type: "button", id: "f-loc", onclick: () => {
    if (!navigator.geolocation) { toast("This phone can't share location."); return; }
    locBtn.disabled = true; locBtn.textContent = "Finding you…";
    navigator.geolocation.getCurrentPosition((pos) => { draftLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude }; locBtn.disabled = false; paintLoc(); },
      () => { locBtn.disabled = false; paintLoc(); toast("Couldn't get your location. Make sure location is allowed for this app."); },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  } }, "📍 Add my location");
  const locRemove = el("button", { class: "link", type: "button", style: "align-self:flex-start", onclick: () => { draftLoc = null; paintLoc(); } }, "Remove location");
  function paintLoc() {
    locBtn.hidden = !!draftLoc; locBtn.textContent = "📍 Add my location"; locRemove.hidden = !draftLoc; precSel.hidden = !draftLoc;
    locNote.textContent = draftLoc
      ? "Location added. Everyone using Weigh-In will see this pin on the map."
      : "Optional. Everyone using Weigh-In can see map pins, so skip it for your home or a secret spot.";
  }
  paintLoc();
  const f = el("form", { novalidate: true },
    el("div", { class: "field" }, el("span", null, "Photo"), preview, removeBtn),
    el("label", { class: "field" }, el("span", null, "Fish type"),
      el("input", { id: "f-species", name: "species", list: "species", maxlength: 40, placeholder: "Largemouth Bass", autocomplete: "off", required: true })),
    el("div", { class: "two" },
      el("label", { class: "field" }, el("span", null, "Weight (lb)"), el("input", { id: "f-lb", name: "lb", type: "number", inputmode: "decimal", min: 0, max: 500, step: 0.01, placeholder: "4.5" })),
      el("label", { class: "field" }, el("span", null, "Length (in)"), el("input", { id: "f-in", name: "inches", type: "number", inputmode: "decimal", min: 0, max: 200, step: 0.25, placeholder: "18.5" }))),
    el("div", { class: "ruler", "aria-hidden": "true" }),
    el("label", { class: "field" }, el("span", null, "Lure or bait"),
      el("input", { id: "f-lure", name: "lure", list: "lures", maxlength: 40, placeholder: "Crankbait", autocomplete: "off" })),
    el("label", { class: "field" }, el("span", null, "Spot (optional)"),
      el("input", { id: "f-spot", name: "spot", maxlength: 40, placeholder: "North cove" })),
    el("div", { class: "field" }, el("span", null, "Where you caught it"), locBtn, precSel, locRemove, locNote),
    el("label", { class: "field" }, el("span", null, "Tournament"),
      el("select", { id: "f-tour", name: "tour" }, el("option", { value: "" }, "No tournament"),
        myLive.map((t) => el("option", { value: t.id }, t.name))),
      el("span", { class: "hint" }, myLive.length ? "Only tournaments you've joined that are happening now show up here." : "Join a tournament in Tourneys to count this catch.")),
    el("button", { class: "btn wide", type: "submit" }, "Post catch"));
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const species = String(fd.get("species") || "").trim();
    const lb = parseFloat(fd.get("lb")) || 0, inches = parseFloat(fd.get("inches")) || 0;
    if (!species) { toast("Enter what kind of fish it is."); return; }
    if (!lb && !inches) { toast("Add a weight or a length."); return; }
    const tid = String(fd.get("tour") || "");
    const t = S.tournaments.find((x) => x.id === tid);
    const btn = f.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Posting…";
    try {
      const lure = String(fd.get("lure") || "").trim();
      const ref = await addDoc(collection(db, "posts"), {
        uid: S.user.uid, name: S.name, species, lb, inches,
        lure, spot: String(fd.get("spot") || "").trim(),
        photo: draftPhoto || "", tournamentId: t ? t.id : "", tournamentName: t ? t.name : "",
        createdAt: serverTimestamp(),
      });
      let pinFailed = false;
      if (draftLoc) {
        const exact = fd.get("prec") === "exact";
        const r = (n) => (exact ? Math.round(n * 1e5) / 1e5 : Math.round(n * 100) / 100); // 2 decimals is roughly 1 km
        try {
          await setDoc(doc(db, "spots", ref.id), { uid: S.user.uid, name: S.name, species, lb, inches, lure, lat: r(draftLoc.lat), lng: r(draftLoc.lng),
            precise: exact, thumb: draftPhoto ? await thumbFrom(draftPhoto) : "", createdAt: serverTimestamp() });
        } catch { pinFailed = true; }
      }
      draftPhoto = ""; draftLoc = null;
      toast(pinFailed ? `Posted your ${species}, but the map pin didn't save.` : `Posted your ${species}!`); go("feed");
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
        el("span", { class: "s" }, `${SCORING[t.scoring]?.name || ""} · ${fmtDay(t.start)}${t.end !== t.start ? " – " + fmtDay(t.end) : ""} · ${n} angler${n === 1 ? "" : "s"}`)),
      el("span", { class: "pill " + st }, { live: "Live", soon: "Upcoming", final: "Final" }[st]));
  })));
}
function viewCreateTour(p) {
  const today = new Date();
  const f = el("form", { novalidate: true },
    el("label", { class: "field" }, el("span", null, "Name"), el("input", { id: "t-name", name: "name", maxlength: 40, placeholder: "Saturday Bass Bash", required: true })),
    el("label", { class: "field" }, el("span", null, "How is it scored?"),
      el("select", { id: "t-scoring", name: "scoring" }, Object.entries(SCORING).map(([k, s]) => el("option", { value: k }, `${s.name}: ${s.desc}`)))),
    el("div", { class: "two" },
      el("label", { class: "field" }, el("span", null, "Starts"), el("input", { id: "t-start", type: "date", name: "start", value: localDate(today) })),
      el("label", { class: "field" }, el("span", null, "Ends"), el("input", { id: "t-end", type: "date", name: "end", value: localDate(new Date(Date.now() + 2 * 864e5)) }))),
    el("button", { class: "btn wide", type: "submit" }, "Create tournament"));
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const name = String(fd.get("name") || "").trim(), start = fd.get("start"), end = fd.get("end");
    if (!name) { toast("Give the tournament a name."); return; }
    if (!start || !end || end < start) { toast("The end date has to be on or after the start date."); return; }
    try {
      const ref = await addDoc(collection(db, "tournaments"), { name, scoring: fd.get("scoring"), start, end, createdBy: S.user.uid, createdByName: S.name, members: [S.user.uid], createdAt: serverTimestamp() });
      S.creatingTour = false; toast("Tournament created. You're in!"); openTour(ref.id);
    } catch (err) { toast(errText(err)); }
  });
  p.append(el("button", { class: "link", type: "button", style: "align-self:flex-start", onclick: () => { S.creatingTour = false; renderTab(); } }, "‹ Back"),
    el("h1", null, "New tournament"), f);
}
function openTour(id) {
  S.openTournament = id; S.viewing = null; S.tourPosts = [];
  tourUnsub?.();
  tourUnsub = onSnapshot(query(collection(db, "posts"), where("tournamentId", "==", id)), (s) => {
    S.tourPosts = s.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    if (S.tab === "tours" && S.openTournament === id) renderTab();
  }, () => {});
  renderTab();
}
function standings(t) {
  const by = new Map();
  for (const p of S.tourPosts) {
    if (!(t.members || []).includes(p.uid)) continue;
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
function viewTour(p) {
  const t = S.tournaments.find((x) => x.id === S.openTournament);
  if (!t) { S.openTournament = null; return viewTours(p); }
  const st = tourStatus(t), joined = (t.members || []).includes(S.user.uid), sc = SCORING[t.scoring] || SCORING.heaviest;
  p.append(el("button", { class: "link", type: "button", style: "align-self:flex-start", onclick: () => { S.openTournament = null; tourUnsub?.(); tourUnsub = null; renderTab(); } }, "‹ All tourneys"),
    el("div", { class: "stack", style: "gap:6px" },
      el("div", { class: "row" }, el("span", { class: "pill " + st }, { live: "Live", soon: "Upcoming", final: "Final" }[st]),
        el("span", { class: "label" }, `${fmtDay(t.start)}${t.end !== t.start ? " – " + fmtDay(t.end) : ""}`)),
      el("h1", null, t.name),
      el("p", { class: "muted", style: "margin:0" }, `${sc.desc}. Started by @${t.createdByName || "someone"}. Only catches posted to this tournament count.`)));
  if (!joined && st !== "final") p.append(el("button", { class: "btn wide", type: "button", onclick: async () => {
    try { await updateDoc(doc(db, "tournaments", t.id), { members: arrayUnion(S.user.uid) }); toast(`You joined ${t.name}!`); }
    catch (err) { toast(errText(err)); }
  } }, "Join this tournament"));
  else if (joined && st === "live") p.append(el("button", { class: "btn wide", type: "button", onclick: () => go("post") }, "Post a catch for this tournament"));

  const rows = standings(t);
  const board = el("section", { class: "board", "aria-label": "Leaderboard" },
    el("div", { class: "board-h" }, el("h2", null, st === "final" ? "Final standings" : "Leaderboard"), el("span", { class: "label" }, sc.name)));
  if (!rows.length) board.append(el("p", { class: "empty", style: "padding:14px 16px" }, (t.members || []).length + " joined. No fish posted yet."));
  else board.append(el("ol", { class: "lb" }, rows.map((r, i) =>
    el("li", { class: r.uid === S.user.uid ? "me" : null, tabindex: 0, onclick: () => { S.viewing = r.uid; renderTab(); } },
      el("span", { class: "place " + (i < 3 ? "p" + (i + 1) : "") }, String(i + 1)),
      el("div", { style: "min-width:0" }, el("div", { class: "row", style: "gap:8px;flex-wrap:nowrap;font-weight:700;overflow-wrap:anywhere" }, avatar(r.uid, r.name, 24), el("span", null, "@" + r.name + (r.uid === S.user.uid ? " (you)" : ""))),
        el("div", { class: "hint" }, `${r.fish.length} fish · tap to see them`)),
      el("span", { class: "score" }, `${r.score} ${sc.unit}`)))));
  p.append(board);

  const shown = S.viewing ? S.tourPosts.filter((x) => x.uid === S.viewing) : S.tourPosts;
  const who = S.viewing ? rows.find((r) => r.uid === S.viewing)?.name : null;
  p.append(el("div", { class: "row spread" }, el("h2", null, who ? `@${who}'s catches` : "All catches"),
    who ? el("button", { class: "link", type: "button", onclick: () => { S.viewing = null; renderTab(); } }, "Show everyone") : null));
  const sorted = [...shown].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  if (!sorted.length) p.append(el("p", { class: "empty" }, "No catches yet."));
  else p.append(el("div", { class: "list" }, sorted.map((c) => el("div", { class: "item", style: "cursor:default" },
    el("div", { class: "stack", style: "gap:2px;min-width:0" }, el("span", { class: "t" }, `${c.species}, ${sizeText(c)}`),
      el("span", { class: "s" }, `@${c.name} · ${c.lure ? "on " + c.lure + " · " : ""}${ago(c.createdAt)}`)),
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
function openChat(fs) {
  const fr = friendOf(fs);
  const list = el("div", { class: "msgs" }, el("p", { class: "muted" }, "Loading…"));
  const input = el("input", { id: "m-text", maxlength: 500, placeholder: `Message @${fr.name}`, autocomplete: "off" });
  const form = el("form", { class: "composer" }, input, el("button", { class: "btn small", type: "submit" }, "Send"));
  const close = () => { un(); bg.remove(); };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim(); if (!text) return;
    input.value = "";
    try { await addDoc(collection(db, "friendships", fs.id, "messages"), { uid: S.user.uid, text, createdAt: serverTimestamp() }); }
    catch (err) { toast(errText(err)); input.value = text; }
  });
  const bg = el("div", { class: "sheet-bg" }, el("div", { class: "sheet full", role: "dialog", "aria-label": `Chat with ${fr.name}` },
    el("div", { class: "sheet-h top" }, el("button", { class: "link", type: "button", onclick: close }, "‹ Back"), el("h2", null, "@" + fr.name), el("span")),
    list, form));
  document.body.append(bg);
  const un = onSnapshot(query(collection(db, "friendships", fs.id, "messages"), orderBy("createdAt", "desc"), limit(150)), (s) => {
    const rows = s.docs.map((d) => d.data({ serverTimestamps: "estimate" })).reverse();
    if (!rows.length) { list.replaceChildren(el("p", { class: "muted" }, `Say hi to @${fr.name}!`)); return; }
    list.replaceChildren(...rows.map((m) => el("div", { class: "msg" + (m.uid === S.user.uid ? " mine" : "") }, m.text)));
    list.scrollTop = list.scrollHeight;
  }, () => list.replaceChildren(el("p", { class: "muted" }, "Couldn't load messages.")));
}


/* ======================= MAP ======================= */
let leafletP, mapToken = 0;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  leafletP ||= new Promise((res, rej) => {
    document.head.append(el("link", { rel: "stylesheet", href: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", integrity: "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=", crossorigin: "" }));
    document.head.append(el("script", { src: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", integrity: "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=", crossorigin: "",
      onload: () => res(window.L), onerror: () => { leafletP = null; rej(new Error("leaflet")); } }));
  });
  return leafletP;
}
function destroyMap() { mapToken++; if (S.map) { S.map.remove(); S.map = null; S.markers = null; } }
function renderMap() {
  $screen.className = "screen feed-wrap";
  const box = el("div", { class: "map", id: "map" });
  const note = el("div", { class: "map-note", id: "map-note" }, "Loading map…");
  $screen.replaceChildren(el("div", { class: "map-top" }, "Catch map"), box, note);
  const token = ++mapToken;
  loadLeaflet().then((L) => {
    if (S.tab !== "map" || token !== mapToken) return;
    S.map = L.map(box).setView([39.5, -98.35], 4);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(S.map);
    S.markers = L.layerGroup().addTo(S.map);
    drawSpots(true);
    setTimeout(() => S.map?.invalidateSize(), 60);
  }).catch(() => { note.textContent = "Couldn't load the map. Check your connection and try again."; });
}
function spotPopup(s) {
  return el("div", { class: "pop" },
    s.thumb ? el("img", { src: s.thumb, alt: `${s.species} caught by ${s.name}` }) : null,
    el("b", null, s.species), el("span", null, sizeText(s)),
    el("span", { class: "hint" }, `@${s.name} · ${ago(s.createdAt)}`),
    s.lure ? el("span", { class: "hint" }, "Caught on " + s.lure) : null,
    s.precise ? null : el("span", { class: "hint" }, "Approximate area"));
}
function drawSpots(fit) {
  const L = window.L, note = document.getElementById("map-note");
  if (!L || !S.map || !S.markers) return;
  S.markers.clearLayers();
  const pts = [];
  for (const s of S.spots) {
    if (typeof s.lat !== "number" || typeof s.lng !== "number") continue;
    pts.push([s.lat, s.lng]);
    L.marker([s.lat, s.lng], { title: `${s.species} by @${s.name}`, icon: L.divIcon({ className: "bob-pin", html: "<span></span>", iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -12] }) })
      .bindPopup(spotPopup(s)).addTo(S.markers);
  }
  if (note) {
    note.hidden = pts.length > 0;
    note.textContent = "No catches with a location yet. When you post a catch, tap “Add my location” to put it on the map.";
  }
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
  const mine = [...S.mine].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  const biggest = Math.max(0, ...mine.map((x) => x.lb || 0));
  const pins = S.spots.filter((s) => s.uid === S.user.uid).length;
  const open = (v) => () => { S.meView = v; renderTab(); };
  p.append(
    el("div", { class: "profile-head" },
      el("div", { class: "av-edit" }, avatar(S.user.uid, S.name, 96), photoInput("me-photo", "Change profile picture")),
      el("div", { class: "stack", style: "gap:2px;min-width:0" }, el("h1", { style: "overflow-wrap:anywhere" }, "@" + S.name),
        el("span", { class: "hint" }, "Tap your picture to change it"))),
    el("div", { class: "stats" },
      el("div", null, el("b", null, String(mine.length)), el("span", null, "Catches")),
      el("div", null, el("b", null, biggest ? fmtLb(biggest) : "–"), el("span", null, "Biggest")),
      el("div", null, el("b", null, String(pins)), el("span", null, "Map pins"))),
    el("div", { class: "list" },
      el("button", { class: "item", type: "button", onclick: open("friends") },
        el("span", { class: "row", style: "gap:10px" }, el("span", { class: "t" }, "Friends and chat"), S.reqIn.length ? el("span", { class: "pill live" }, `${S.reqIn.length} new`) : null), el("span", { class: "label" }, "›")),
      el("button", { class: "item", type: "button", onclick: open("log") }, el("span", { class: "t" }, "My fishing log"), el("span", { class: "label" }, "›")),
      el("button", { class: "item", type: "button", onclick: open("settings") }, el("span", { class: "t" }, "Settings"), el("span", { class: "label" }, "›"))),
    el("h2", null, "My catches"));
  if (!mine.length) { p.append(el("p", { class: "empty" }, "You haven't posted a catch yet. Tap the red Post button.")); return; }
  p.append(el("div", { class: "list" }, mine.map((c) => el("div", { class: "item", style: "cursor:default" },
    el("div", { class: "row", style: "gap:12px;flex-wrap:nowrap;min-width:0" },
      c.photo ? el("img", { src: c.photo, alt: "", style: "width:56px;height:56px;object-fit:cover;border-radius:8px;flex:none" }) : null,
      el("div", { class: "stack", style: "gap:2px;min-width:0" }, el("span", { class: "t" }, `${c.species}, ${sizeText(c)}`),
        el("span", { class: "s" }, `${c.lure ? "on " + c.lure + " · " : ""}${ago(c.createdAt)}`))),
    el("button", { class: "link danger small", type: "button", onclick: () => deletePost(c) }, "Delete")))));
}

function viewSettings(p) {
  const prec = el("select", { id: "s-prec", onchange: () => setPref("prec", prec.value) },
    el("option", { value: "approx" }, "Approximate area (about 1 km)"), el("option", { value: "exact" }, "Exact spot"));
  prec.value = getPref("prec", "approx");
  p.append(backBtn("‹ Profile"), el("h1", null, "Settings"),
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
      el("button", { class: "btn wide", type: "button", onclick: () => { if (confirm("Sign out of Weigh-In?")) signOut(auth); } }, "Sign out")),
    el("p", { class: "hint" }, "Weigh-In is free. Don't post personal info like your address or school."));
}
