// Frenz landing — the ONLY script on first view (app/route.ts → lib/landing-static/html.ts). No framework.
// Field, paste, platform detection, validation, install, scroll reveal. Everything else is imported on first use:
// result.js (fetch + result panel), sheets.js (dialogs), extras.js (analytics, ads, service worker — after load + idle).
// Idle cost: zero. No timers, no rAF loops, no scroll listeners; observers disconnect when done.
const V = new URL(import.meta.url).searchParams.get("v") || "0";
const mod = (n) => import(new URL(`./${n}.js?v=${V}`, import.meta.url).href);
const $ = (s) => document.querySelector(s);
const data = JSON.parse(($("#ld-data") || {}).textContent || "{}");
const P = data.p || [];
const field = $("#field"), input = $("#url"), helper = $("#helper"), result = $("#result"), dlBtn = $("#dlBtn");
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

export function setHelper(text, kind) {
  helper.textContent = text || "";
  helper.className = "helper" + (kind ? " " + kind : "");
}

// lib/source-url.ts: what the backend refuses outright (private / local hosts)
const PRIVATE = [/^localhost$/i, /^127\./, /^0\./, /^10\./, /^192\.168\./, /^169\.254\./, /^172\.(1[6-9]|2[0-9]|3[0-1])\./, /^\[?::1\]?$/, /^\[?fc00:/i, /^\[?fe80:/i, /\.local$/i];

/**
 * lib/platforms.ts detectPlatform + lib/source-url.ts checkSourceUrl: a named platform when the host (or a subdomain)
 * is one; any other public http(s) link is still tried (the backend's generic extractor, as the old downloader did);
 * only a private / local host or a non-web link is "not supported".
 */
export function detect(raw) {
  let v = (raw || "").trim();
  if (!v) return { empty: true };
  const m = v.match(/https?:\/\/\S+/i);
  if (m) v = m[0];
  else if (!/^https?:\/\//i.test(v)) v = "https://" + v;
  let url;
  try { url = new URL(v); } catch { return { invalid: true }; }
  if (!url.hostname.includes(".") || /\s/.test(v) || v.length > 2048) return { invalid: true };
  if (!/^https?:$/.test(url.protocol) || PRIVATE.some((re) => re.test(url.hostname))) return { unsupported: true };
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const p = P.find((x) => x.h.some((h) => host === h || host.endsWith("." + h)));
  return p ? { platform: p.n, page: p.u, url: url.href } : { platform: null, page: null, url: url.href };
}

function markPlatform(name) {
  document.querySelectorAll(".works .p").forEach((el) => (el.dataset.on = String(el.dataset.p === name)));
}

function onInput() {
  field.classList.toggle("has-value", !!input.value);
  field.classList.remove("error");
  result.classList.remove("show");
  const d = detect(input.value);
  markPlatform(d.platform);
  setHelper(d.platform ? d.platform + " link detected" : "", d.platform ? "ok" : "");
}
input.addEventListener("input", onInput);
$("#clearBtn").addEventListener("click", () => { input.value = ""; onInput(); input.focus(); });
$("#pasteBtn").addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text || !text.trim()) throw new Error("empty");
    input.value = text.trim();
    onInput();
    if (navigator.vibrate) navigator.vibrate(8);
  } catch {
    input.focus();
    setHelper("Long-press the field and choose Paste.");
  }
});

export function fail(msg) {
  field.classList.add("error");
  setHelper(msg, "err");
  if (!reduce) { field.classList.remove("shake"); void field.offsetWidth; field.classList.add("shake"); }
  if (navigator.vibrate) navigator.vibrate([12, 40, 12]);
}

let toastTimer;
export function toast(text, bad) {
  const t = $("#toast");
  $("#toastText").textContent = text;
  t.classList.toggle("bad", !!bad);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

const BTN_IDLE = dlBtn.innerHTML;
export function busy(on, label) {
  if (on) {
    dlBtn.setAttribute("aria-busy", "true");
    dlBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>' + (label || "Getting your file…") + "</span>";
  } else {
    dlBtn.removeAttribute("aria-busy");
    dlBtn.innerHTML = BTN_IDLE;
  }
}

let running = false;
async function go() {
  if (running) return; // a double tap never sends a second request
  const d = detect(input.value);
  if (d.empty) return fail("Paste a link first.");
  if (d.invalid) return fail("That doesn’t look like a link.");
  if (d.unsupported) return fail("This site isn’t supported yet.");
  running = true;
  busy(true);
  setHelper("");
  try {
    const r = await mod("result");
    await r.run(d, { origin: data.o, result, setHelper, fail, toast, busy, reduce });
  } catch {
    fail("Couldn’t load the downloader. Check your connection and try again.");
  } finally {
    busy(false);
    running = false;
  }
}
$("#dlForm").addEventListener("submit", (e) => { e.preventDefault(); go(); });

// Sheets: the dialog logic arrives on the first tap
for (const [btn, id] of [["#moreBtn", "platSheet"], ["#menuBtn", "menuSheet"], ["#newsBtn", "newsSheet"]]) {
  const b = $(btn);
  if (b) b.addEventListener("click", (e) => { const t = e.currentTarget; mod("sheets").then((m) => m.open(id, t)).catch(() => {}); });
}

// Install: the browser's prompt where there is one, else the "Get the app" section (with the iPhone hint)
let deferred = null;
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; });
document.querySelectorAll("[data-install]").forEach((b) => b.addEventListener("click", async () => {
  if (deferred) { deferred.prompt(); deferred = null; return; }
  $("#app").scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
}));

// Reveal: one observer, each section un-observed once shown
if ("IntersectionObserver" in window && !reduce) {
  const io = new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } }), { threshold: 0.12 });
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
} else document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));

// The AI card's caret blinks (a few times) only while the card is on screen and the tab is visible
const ai = $("#aiTool");
if (ai && "IntersectionObserver" in window && !reduce) {
  let seen = false;
  const set = () => ai.classList.toggle("run", seen && document.visibilityState === "visible");
  new IntersectionObserver((es) => { seen = es[0].isIntersecting; set(); }).observe(ai);
  document.addEventListener("visibilitychange", set);
}

// Android "Share to Frenz" (manifest share_target → /?url=…&text=…): start straight away
try {
  const sp = new URLSearchParams(location.search);
  const shared = sp.get("url") || (sp.get("text") || "").match(/https?:\/\/\S+/)?.[0];
  if (shared) { input.value = shared; onInput(); go(); }
} catch {}

// Everything not needed to paste and save — analytics, ads, the service worker — never in front of first paint or the
// first interaction: on the visitor's first tap / key / scroll, when the tab is hidden (so a quick visit is still
// counted), or 6 s after load at the latest — then at the next idle moment. Measured 2026-10-27: the Google tag alone
// is a ~600 ms task on a mid-range phone; loaded at the first idle moment it was the page's whole blocking time.
let extrasDone = false;
function extras() {
  if (extrasDone) return;
  extrasDone = true;
  const run = () => mod("extras").then((m) => m.start()).catch(() => {});
  if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 2000 }); else setTimeout(run, 50);
}
function later() {
  for (const ev of ["pointerdown", "keydown", "scroll", "touchstart"]) addEventListener(ev, extras, { once: true, passive: true });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") extras(); }, { once: true });
  setTimeout(extras, 6000);
}
if (document.readyState === "complete") later(); else addEventListener("load", later, { once: true });
