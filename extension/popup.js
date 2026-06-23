/* SVideoDownload browser extension — popup logic. */

const DEFAULT_BASE = "https://svideodownload.com";
const SUPPORTED =
  /(tiktok|instagram|facebook|fb\.watch|twitter|x\.com|pinterest|pin\.it|reddit|vimeo|youtube|youtu\.be|threads|snapchat|linkedin)\./i;

const $ = (id) => document.getElementById(id);

function getConfig() {
  return new Promise((resolve) =>
    chrome.storage.sync.get(["apiBase", "apiKey"], (d) =>
      resolve({ base: (d.apiBase || DEFAULT_BASE).replace(/\/$/, ""), key: d.apiKey || "" }),
    ),
  );
}

function authHeaders(key) {
  return key ? { Authorization: `Bearer ${key}` } : {};
}

async function renderPlan(base, key) {
  try {
    const me = await fetch(`${base}/api/me`, { headers: authHeaders(key) }).then((r) => r.json());
    const badge = $("plan");
    badge.textContent = me.plan === "business" ? "Business" : me.plan === "pro" ? "Pro" : "Free";
    badge.classList.toggle("pro", me.plan !== "free");

    if (me.showAds && me.offer) {
      const el = $("offer");
      el.href = me.offer.url;
      el.innerHTML = `<b>${me.offer.name}</b> — ${me.offer.cta} →`;
      el.classList.remove("hidden");
    }
  } catch {
    $("plan").textContent = "Free";
  }
}

function downloadFile(base, url, formatId, kind, title) {
  const params = new URLSearchParams({ url, formatId, kind, title: title || "download" });
  chrome.downloads.download({ url: `${base}/api/download?${params.toString()}` });
}

function renderFormats(base, url, data) {
  const wrap = $("formats");
  wrap.innerHTML = "";
  const formats = data.formats || [];
  const videos = formats.filter((f) => f.kind === "video").slice(0, 4);
  const audio = formats.find((f) => f.kind === "audio");
  const images = formats.filter((f) => f.kind === "image");

  videos.forEach((f) => {
    const b = document.createElement("button");
    b.className = "btn primary";
    b.textContent = `Download ${f.label || "video"}`;
    b.onclick = () => downloadFile(base, url, f.formatId, "video", data.title);
    wrap.appendChild(b);
  });
  if (audio) {
    const b = document.createElement("button");
    b.className = "btn ghost";
    b.textContent = "Download MP3 (audio)";
    b.onclick = () => downloadFile(base, url, audio.formatId, "audio", data.title);
    wrap.appendChild(b);
  }
  images.forEach((f, i) => {
    const b = document.createElement("button");
    b.className = "btn ghost";
    b.textContent = images.length > 1 ? `Download photo ${i + 1}` : "Download photo";
    b.onclick = () => downloadFile(base, url, f.formatId, "image", data.title);
    wrap.appendChild(b);
  });
}

async function analyze(base, key, url) {
  const btn = $("fetchBtn");
  btn.disabled = true;
  btn.textContent = "Fetching…";
  $("error").classList.add("hidden");
  try {
    const res = await fetch(`${base}/api/metadata`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(key) },
      body: JSON.stringify({ url }),
    });
    const json = await res.json();
    if (!res.ok || json.ok === false) {
      throw new Error(json.error || "Couldn't fetch this link.");
    }
    const d = json.data;
    if (d.thumbnail) $("thumb").src = d.thumbnail;
    $("title").textContent = d.title || "Ready to download";
    renderFormats(base, url, d);
    $("preview").classList.remove("hidden");
    btn.classList.add("hidden");
  } catch (e) {
    $("error").textContent = e.message;
    $("error").classList.remove("hidden");
    btn.disabled = false;
    btn.textContent = "Try again";
  }
}

async function init() {
  const { base, key } = await getConfig();
  void renderPlan(base, key);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab && tab.url ? tab.url : "";

  if (!SUPPORTED.test(url)) {
    $("status").textContent = "Open a TikTok, Instagram, YouTube, X, Facebook, Pinterest, Reddit, Snapchat, Threads, Vimeo or LinkedIn page, then click the icon.";
    return;
  }

  $("status").textContent = "Media detected on this page.";
  const btn = $("fetchBtn");
  btn.classList.remove("hidden");
  btn.onclick = () => analyze(base, key, url);

  $("settings").onclick = (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  };
}

document.addEventListener("DOMContentLoaded", init);
