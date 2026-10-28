// Frenz landing — everything that is not needed to paste and save, imported by core.js after `load` at the first
// idle moment (the standing rule: no third party in front of first paint). The same rules as the app's React units:
//   analytics  features/monetization/google-tag.tsx — gtag init + loader (the page_view is queued at once)
//   Monetag    features/monetization/monetag-tags.tsx — the standard tags when Monetag allows "/" (all pages, or the
//              "home" surface); In-Page Push under its daily cap
//   HilltopAds features/monetization/hilltop-video-slider.tsx — the slider, with the pop-under guard installed FIRST
//   SW         features/notifications/register-sw.tsx — /sw.js (repeat visits open from cache; it never caches API
//              answers or media)
// Ads never for a paying member (showAds from /api/me), and only after this point. Every step fails quietly.
const data = JSON.parse(document.getElementById("ld-data")?.textContent || "{}");

function script(src, attrs = {}, where = document.head) {
  const s = document.createElement("script");
  s.async = true;
  s.src = src;
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  where.appendChild(s);
  return s;
}

function analytics() {
  const id = data.g;
  if (!id) return;
  if (/^GTM-[A-Z0-9]{6,10}$/i.test(id)) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
    script(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`);
    return;
  }
  if (!/^(?:G-[A-Z0-9]{6,12}|AW-[0-9]{9,12})$/i.test(id)) return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  window.gtag("config", id);
  script(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`);
}

async function showAds() {
  if (!/(^|;\s*)sb-[^=]*-auth-token/.test(document.cookie)) return true;
  const me = await fetch("/api/me", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return !!(me && me.showAds === true);
}

// window.open only inside a short window our own code opens (lib/monetization/popunder-guard.ts) — never for a
// network's pop-under on a stray tap
let guarded = false;
function popunderGuard() {
  if (guarded) return;
  guarded = true;
  window.open = function () { return null; };
}

function inPagePushAllowed(limit) {
  const cap = typeof limit === "number" ? (limit === 0 ? Infinity : limit) : 5; // lib/monetization/inpage-push-cap.ts DEFAULT_IN_PAGE_PUSH_DAILY_LIMIT
  const key = "frenz:ipp:" + new Date().toISOString().slice(0, 10);
  try {
    const n = Number(localStorage.getItem(key) || 0);
    if (n >= cap) return false;
    localStorage.setItem(key, String(n + 1));
    return true;
  } catch {
    return false;
  }
}

async function monetag() {
  const cfg = await fetch("/api/monetag").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!cfg || !Array.isArray(cfg.tags) || !cfg.tags.length) return;
  if (!(cfg.allPages || (cfg.surfaces || []).includes("home"))) return;
  for (const t of cfg.tags) {
    if (!t || typeof t.src !== "string" || !/^https:\/\//.test(t.src)) continue;
    if (t.type === "in_page_push" && !inPagePushAllowed(cfg.inPagePushDailyLimit)) continue;
    const attrs = { "data-monetag": String(t.type || "") };
    if (t.zone) attrs["data-zone"] = String(t.zone);
    if (t.cfAsync) attrs["data-cfasync"] = "false";
    script(t.src, attrs);
  }
}

async function hilltop() {
  const cfg = await fetch("/api/ads/config").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const tag = cfg && cfg.hilltopVideoSlider;
  if (!tag || typeof tag.src !== "string" || !/^https:\/\//.test(tag.src)) return;
  popunderGuard();
  const s = document.createElement("script");
  s.src = tag.src;
  s.async = true;
  if (tag.referrerPolicy) s.referrerPolicy = tag.referrerPolicy;
  s.settings = {};
  document.body.appendChild(s);
}

function serviceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {});
}

let started = false;
export async function start() {
  if (started) return;
  started = true;
  serviceWorker();
  analytics();
  if (!(await showAds())) return;
  await Promise.allSettled([monetag(), hilltop()]);
}
