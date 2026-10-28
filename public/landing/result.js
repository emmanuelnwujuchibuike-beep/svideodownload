// Frenz landing — the download flow, imported on the first Download tap (core.js). The real API:
//   info   POST {worker}/api/metadata  (CORS "simple": text/plain, no preflight), falling back to the same-origin
//          POST /api/metadata — exactly what features/downloads/worker-direct.ts does in the app
//   save   GET /api/download?url&formatId&kind&title&t — the browser-navigable route, so the phone's own download
//          manager saves the file (the only reliable way on iPhone Safari); every server check still runs there
// One request at a time, a 30 s timeout, one automatic retry on a network failure / timeout / 5xx, a clear message
// otherwise. A top-quality file that the admin puts behind the reward ad, and multi-item "save all", are handed to
// the full downloader on the platform's own page (?url=…), which runs that gate — never skipped from here.
const TIMEOUT = 30000;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const DL = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg>';

class Retryable extends Error {}

async function once(url, origin) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    let res = null;
    if (origin) {
      try {
        res = await fetch(origin + "/api/metadata", { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify({ url }), signal: ctl.signal, mode: "cors", credentials: "omit" });
        if (res.status === 403 && !res.headers.get("access-control-allow-origin")) res = null; // an old worker: use the same-origin door
      } catch (e) {
        if (ctl.signal.aborted) throw new Retryable("timeout");
        res = null; // CORS / network on the direct door → the same-origin one
      }
    }
    if (!res) res = await fetch("/api/metadata", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }), signal: ctl.signal });
    const json = await res.json().catch(() => null);
    if (res.status >= 500 && res.status !== 501) throw new Retryable((json && json.error) || "The service is busy.");
    if (!res.ok || !json || json.ok === false) return { error: (json && json.error) || "Couldn’t read that link." };
    return { data: json.data };
  } catch (e) {
    if (e instanceof Retryable) throw e;
    throw new Retryable(ctl.signal.aborted ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }
}

async function info(url, origin) {
  try {
    return await once(url, origin);
  } catch {
    try {
      return await once(url, origin); // one automatic retry
    } catch (e) {
      return { error: e.message === "timeout" ? "That took too long. Check your connection and try again." : "Couldn’t reach the downloader. Check your connection and try again." };
    }
  }
}

const dur = (s) => (s > 0 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "");
const size = (b) => (b > 0 ? (b > 1e9 ? (b / 1e9).toFixed(1) + " GB" : b > 1e6 ? Math.round(b / 1e6) + " MB" : Math.max(1, Math.round(b / 1e3)) + " KB") : "");

/** The options shown: separate items (a story's snaps, an album's photos) or one list of qualities, best first. */
function options(md) {
  const fs = md.formats || [];
  const items = fs.filter((f) => f.isSeparateItem);
  const images = fs.filter((f) => f.kind === "image");
  if (items.length > 1 || (images.length > 1 && fs.every((f) => f.kind === "image"))) {
    return { items: true, list: (items.length > 1 ? items : images).map((f, i) => ({ f, rank: i, label: f.label || `Item ${i + 1}`, meta: (f.ext || "").toUpperCase() })) };
  }
  const rankByKind = {};
  const seen = new Set();
  const list = [];
  for (const f of fs) {
    const key = f.kind + "|" + f.label;
    if (seen.has(key)) continue;
    seen.add(key);
    const rank = (rankByKind[f.kind] = (rankByKind[f.kind] ?? -1) + 1);
    const lbl = f.kind === "audio" ? "Audio only" : f.label || (f.resolution ? f.resolution : "Original");
    list.push({ f, rank, label: lbl, meta: [(f.ext || "").toUpperCase(), size(f.filesize)].filter(Boolean).join(" · ") });
  }
  return { items: false, list: list.slice(0, 6) };
}

// ── the reward-ad rule for a top-quality file (lib/monetization/reward-policy.ts, mirrored) ─────────────────────
let gateCfg = null;
async function gateConfig() {
  if (gateCfg) return gateCfg;
  const signedIn = /(^|;\s*)sb-[^=]*-auth-token/.test(document.cookie);
  const [cfg, me] = await Promise.all([
    fetch("/api/ads/config").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    signedIn ? fetch("/api/me", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).catch(() => null) : Promise.resolve(null),
  ]);
  // a paying member never sees an ad; a read failure for a signed-in member fails toward NO ad (never charge them one)
  const showAds = signedIn ? !!(me && me.showAds === true) : true;
  gateCfg = { showAds, network: cfg.hdDownloadNetwork || "none", top: Number(cfg.rewardTopTierCount) || 2, videoSec: Number(cfg.rewardVideoTopTierSeconds) || 30, imgSec: Number(cfg.rewardImageAudioTopTierSeconds) || 5 };
  return gateCfg;
}
// Decided SYNCHRONOUSLY on the tap: the config is read when the result appears, because a download (and iOS) only
// honours a save started inside the tap itself — awaiting a fetch first loses the gesture and the file silently.
function needsAdWith(g, o) {
  if (!g.showAds || g.network === "none") return false;
  const top = g.top > 0 && o.rank < g.top;
  if (o.f.kind === "image" || o.f.kind === "audio") return top && g.imgSec > 0;
  if (o.f.filesize > 100 * 1024 * 1024) return true;
  return top && g.videoSec > 0;
}

function remember(md, o) {
  // the device's History (features/history/store.ts reads the same key and shape)
  try {
    const KEY = "svd:history:v1";
    const items = JSON.parse(localStorage.getItem(KEY) || "[]").filter((r) => !(r.url === md.sourceUrl && r.formatId === o.f.formatId && r.kind === o.f.kind));
    items.unshift({ id: crypto.randomUUID(), url: md.sourceUrl, platform: md.platform, platformName: md.platformName, title: md.title, thumbnail: md.thumbnail || null, formatId: o.f.formatId, kind: o.f.kind, qualityLabel: o.label, durationSeconds: md.durationSeconds || null, createdAt: Date.now(), favorite: false });
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, 200)));
    return true;
  } catch {
    return false;
  }
}

function save(md, o) {
  const q = new URLSearchParams({ url: md.sourceUrl, formatId: o.f.formatId, kind: o.f.kind, title: (md.title || "frenz").slice(0, 120), t: crypto.randomUUID() });
  const a = document.createElement("a");
  a.href = "/api/download?" + q.toString();
  a.rel = "noopener";
  a.setAttribute("download", "");
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function run(d, ctx) {
  const r = await info(d.url, ctx.origin);
  if (r.error) {
    ctx.fail(r.error);
    return;
  }
  const md = r.data;
  const opts = options(md);
  if (!opts.list.length) {
    ctx.fail("No downloadable media found at that link.");
    return;
  }
  const meta = [md.platformName || d.platform, dur(md.durationSeconds), opts.items ? `${opts.list.length} items` : ""].filter(Boolean).join(" · ");
  const full = d.page ? `${d.page}?url=${encodeURIComponent(md.sourceUrl || d.url)}` : null;
  ctx.result.innerHTML =
    '<div class="media"><div class="thumb" aria-hidden="true">' +
    (md.thumbnail ? `<img src="${esc(md.thumbnail)}" alt="" referrerpolicy="no-referrer" decoding="async">` : '<svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M8 5.5v13l11-6.5z"/></svg>') +
    `</div><div><h3>${esc(md.title || "Ready to save")}</h3><p>${esc(meta)}</p></div></div>` +
    `<fieldset class="qualities"><legend class="sr">${opts.items ? "Choose an item" : "Choose quality"}</legend>` +
    opts.list.map((o, i) => `<label class="q"><input type="radio" name="q" value="${i}"${i === 0 ? " checked" : ""}><span class="radio"></span><b>${esc(o.label)}</b><span class="meta">${esc(o.meta)}</span></label>`).join("") +
    "</fieldset>" +
    `<button type="button" class="btn-save" id="saveBtn">${DL}<span>Save to device</span></button>` +
    (opts.items && full ? `<a class="more-link" href="${esc(full)}">Save all ${opts.list.length} at once</a>` : "");
  ctx.result.classList.add("show");
  ctx.result.scrollIntoView({ behavior: ctx.reduce ? "auto" : "smooth", block: "nearest" });

  const btn = ctx.result.querySelector("#saveBtn");
  let gate = null;
  const gateReady = gateConfig().then((g) => (gate = g)).catch(() => (gate = { showAds: false, network: "none" }));
  let saving = false;
  btn.addEventListener("click", async () => {
    if (saving) return;
    const picked = ctx.result.querySelector('input[name="q"]:checked');
    const o = opts.list[Number(picked ? picked.value : 0)];
    if (!o) return;
    saving = true;
    btn.setAttribute("aria-busy", "true");
    const idle = btn.innerHTML;
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Starting…</span>';
    try {
      // almost always already read (it starts when the result appears); only a very fast tap waits for it
      const g = gate || (await gateReady);
      if (needsAdWith(g, o)) {
        // the top-quality gate lives in the full downloader: hand the link over, it continues there. A site with no
        // downloader page of its own can't be handed over — that quality is never saved from here around the gate.
        if (full) {
          location.assign(full);
          return;
        }
        ctx.toast("Choose a lower quality — this one is available in the full downloader.", true);
        return;
      }
      save(md, o);
      ctx.toast(remember(md, o) ? "Saved to History" : "Download started");
    } catch {
      ctx.toast("Couldn’t start the download. Try again.", true);
    } finally {
      saving = false;
      btn.removeAttribute("aria-busy");
      btn.innerHTML = idle;
    }
  });
}
