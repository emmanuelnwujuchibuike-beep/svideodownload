/**
 * CAN THE VAST CREATIVE ACTUALLY PLAY? — the question the endpoint cannot answer.
 *
 * `/api/ads/exoclick?zone=…` returning a creative only proves the ad RESOLVED.
 * The impression pixel fires from the video element's `playing` event, so a
 * creative that resolves and never decodes reports exactly zero — which is what
 * HilltopAds' dashboard shows.
 *
 * This runs on the real origin, in a real browser, and does what `overlay.ts`
 * does: fetch the ad, build the same <video>, and report which events fire and
 * which network requests the impression/media actually make.
 *
 *   node scripts/vast-playback-probe.mjs
 *   node scripts/vast-playback-probe.mjs download_complete
 */
import { chromium, devices } from "playwright";

const BASE = process.env.PROBE_BASE ?? "https://frenzsave.com";
const ZONE = process.argv[2] ?? "download_complete";

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 7"] });
const page = await ctx.newPage();

const net = [];
page.on("request", (r) => {
  const u = r.url();
  if (/vapid-size|silent-basis|irresponsible-smoke|adtrafficquality/.test(u)) {
    net.push(`REQ  ${r.resourceType().padEnd(6)} ${u.slice(0, 110)}`);
  }
});
page.on("response", (r) => {
  const u = r.url();
  if (/vapid-size|silent-basis|irresponsible-smoke/.test(u)) {
    net.push(`RES  ${String(r.status()).padEnd(6)} ${u.slice(0, 110)}`);
  }
});
page.on("requestfailed", (r) => {
  const u = r.url();
  if (/vapid-size|silent-basis|irresponsible-smoke/.test(u)) {
    net.push(`FAIL ${(r.failure()?.errorText ?? "?").padEnd(20)} ${u.slice(0, 110)}`);
  }
});
page.on("console", (m) => {
  const t = m.text();
  if (/Content Security Policy|media/i.test(t)) net.push(`CONSOLE ${m.type()}: ${t.slice(0, 200)}`);
});

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90_000 });

const result = await page.evaluate(async (zone) => {
  const log = [];
  const res = await fetch(`/api/ads/exoclick?zone=${zone}`, { credentials: "same-origin" });
  const body = await res.json();
  const ad = body.ad;
  if (!ad) return { log: ["NO AD RETURNED — " + JSON.stringify(body).slice(0, 200)] };
  log.push(`ad: ${ad.mediaType} ${ad.width}x${ad.height} dur=${ad.durationSeconds}`);
  log.push(`media: ${ad.mediaUrl.slice(0, 100)}`);
  log.push(`impressions: ${ad.impressions?.length ?? 0}  start trackers: ${ad.tracking?.start?.length ?? 0}`);
  log.push(`fallbacks: ${(ad.fallbacks ?? []).map((f) => f.type).join(", ") || "(none)"}`);

  /* Exactly what overlay.ts builds. */
  const video = document.createElement("video");
  video.src = ad.mediaUrl;
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.preload = "auto";
  video.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:99999";
  document.body.appendChild(video);

  const seen = [];
  for (const ev of ["loadstart", "loadedmetadata", "loadeddata", "canplay", "playing", "error", "stalled", "suspend", "waiting"]) {
    video.addEventListener(ev, () => seen.push(`${ev}@${Math.round(performance.now())}`));
  }

  let playRejection = null;
  try {
    await video.play();
  } catch (e) {
    playRejection = `${e.name}: ${e.message}`;
  }

  await new Promise((r) => setTimeout(r, 9000));

  log.push(`events: ${seen.join(" ") || "(NONE)"}`);
  log.push(`play() rejection: ${playRejection ?? "(none)"}`);
  log.push(`readyState=${video.readyState} networkState=${video.networkState} currentTime=${video.currentTime.toFixed(2)} paused=${video.paused}`);
  if (video.error) log.push(`video.error: code=${video.error.code} message=${video.error.message}`);
  return { log };
}, ZONE);

console.log("=== IN-PAGE ===");
console.log(result.log.join("\n"));
console.log("\n=== NETWORK (ad hosts only) ===");
console.log(net.join("\n") || "(nothing)");
await browser.close();
