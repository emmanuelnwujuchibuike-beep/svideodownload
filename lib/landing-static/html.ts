import { faqJsonLd } from "@/components/landing/faq-data";
import { productJsonLd } from "@/lib/content/genome/queries";
import { jsonLd } from "@/lib/seo/json-ld";

import { landingFaq, landingPlatforms, WHATS_NEW, whatsNewDate } from "./content";
import { LANDING_CSS, minifyCss } from "./css";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE LANDING / DOWNLOAD PAGE AS ONE STATIC HTML DOCUMENT (design/frenz-landing.html, owner brief 2026-10-27)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "Performance is the top priority, above visual effects": the page that decides whether a first-time visitor on a
 * mid-range Android over 4G stays. So `/` is not a React page any more — app/route.ts serves this document, built at
 * deploy time (and refreshed daily), with:
 *   · the headline, the download box and the first screen IN the HTML (the H1 is the LCP element — nothing blocks it)
 *   · the whole stylesheet inlined (no stylesheet request), the system font (no font request at all)
 *   · ONE small deferred module (public/landing/core.js); the sheets, the result logic and every third party
 *     (analytics, ads) load later through dynamic import(), the third parties only after load + idle
 *   · no image above the fold; the tool artwork is CSS
 * Everything the old landing said that matters for people and search engines is kept: the FAQ (with its JSON-LD),
 * the product structured data, and a link to every platform's downloader page.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** JSON inside a <script>: no "</script>" or "<!--" can close or confuse it. */
const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

const ICON = {
  download: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg>',
  x12: '<svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8"/></svg>',
  chevron: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" style="color:var(--muted)" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  arrow: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};
const LOGO_PATH = "M8 4h18l-2.6 5.8H14.6v4.6h7.6L19.6 20H14.6v7.6L8 30z";

function closeBtn() {
  return `<button class="icon-btn" data-close aria-label="Close">${ICON.x12}</button>`;
}

export interface LandingOptions {
  siteUrl: string;
  /** cache-busting version of public/landing/*.js (a content hash) */
  jsVersion: string;
  /** the download worker's origin, for the direct metadata call (and the preconnect) */
  downloadOrigin: string;
  /** false = always use the same-origin /api/metadata */
  direct: boolean;
  /** the admin's Google tag id (monetization settings) — loaded by extras.js after load + idle, never before */
  googleTagId: string | null;
}

export function renderLanding(o: LandingOptions): string {
  const all = landingPlatforms();
  // recognised: every supported platform; listed: only the promoted ones (no YouTube — see content.ts)
  const platforms = all.filter((p) => p.shown);
  const first = platforms.slice(0, 4);
  const more = platforms.length - first.length;
  const site = o.siteUrl.replace(/\/$/, "");
  const title = "Frenz — Save, discover, create and earn";
  const description = "Save videos and images from the platforms you already use, discover what people share, and create with AI — all in one app.";
  const ld = [
    { "@context": "https://schema.org", "@type": "WebSite", name: "Frenz", alternateName: "FrenzSave", url: site },
    { "@context": "https://schema.org", "@graph": productJsonLd(site) },
    faqJsonLd,
  ];
  const data = { o: o.direct ? o.downloadOrigin : "", g: o.googleTagId || "", p: all.map((p) => ({ n: p.name, h: p.hosts, u: p.page })) };
  let originHost = "";
  try {
    originHost = new URL(o.downloadOrigin).origin;
  } catch {
    originHost = "";
  }

  return `<!doctype html>
<html lang="en" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#FFFFFF" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#16181F" media="(prefers-color-scheme: dark)">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(site)}/">
<meta property="og:type" content="website"><meta property="og:url" content="${esc(site)}/"><meta property="og:site_name" content="Frenz">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(site)}/og-landing.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${esc(site)}/og-landing.jpg">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Frenz">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon-192.png" type="image/png"><link rel="apple-touch-icon" href="/apple-icon-167.png">
${o.direct && originHost ? `<link rel="preconnect" href="${esc(originHost)}" crossorigin>` : ""}
<style>${minifyCss(LANDING_CSS)}</style>
<script>(function(d){var c=d.documentElement;c.className="js";try{var n=navigator.connection;if(n&&n.saveData)c.className+=" save-data"}catch(e){}})(document)</script>
<script type="module" src="/landing/core.js?v=${esc(o.jsVersion)}"></script>
<script type="application/ld+json">${jsonLd(ld)}</script>
</head>
<body>
<header class="header">
  <div class="wrap">
    <a href="#top" class="logo" aria-label="Frenz home"><svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3B5BFD"/><stop offset=".55" stop-color="#7C3AED"/><stop offset="1" stop-color="#E0369B"/></linearGradient></defs><path d="${LOGO_PATH}" fill="url(#lg)"/></svg><b>Frenz</b></a>
    <nav class="nav-links" aria-label="Primary"><a href="#download">Download</a><a href="#tools">Tools</a><a href="#creators">Creators</a><a href="#app">Get the app</a></nav>
    <button class="btn-install" data-install type="button">Install</button>
    <button class="icon-btn" id="newsBtn" type="button" aria-label="What's new" aria-haspopup="dialog" aria-expanded="false"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10v4a1 1 0 0 0 1 1h2l6 4V5L7 9H5a1 1 0 0 0-1 1zM17 9a4 4 0 0 1 0 6"/></svg><span class="dot" aria-hidden="true"></span></button>
    <button class="icon-btn" id="menuBtn" type="button" aria-label="Menu" aria-haspopup="dialog" aria-expanded="false"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M8 12h12M12 17h8"/></svg></button>
  </div>
</header>

<main id="top" class="wrap">
  <div class="hero">
    <div>
      <span class="eyebrow"><i aria-hidden="true"></i>One app for saving, sharing and creating</span>
      <h1><span>Save.</span> <span class="grad">Discover.</span> <span>Create and earn.</span></h1>
      <p class="lede">Save from the platforms you already use, discover what people share, and create with AI — all in <strong>one super app</strong>.</p>
    </div>
    <div id="download">
      <form class="dl" id="dlForm" novalidate>
        <label for="url" class="sr">Video or image link</label>
        <div class="field" id="field">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/></svg>
          <input id="url" name="url" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste a video or image link" aria-describedby="helper">
          <button type="button" class="btn-clear" id="clearBtn" aria-label="Clear link"><span>${ICON.x12}</span></button>
          <button type="button" class="btn-paste" id="pasteBtn">Paste</button>
        </div>
        <div class="helper" id="helper" aria-live="polite"></div>
        <button type="submit" class="btn-dl" id="dlBtn">${ICON.download}<span>Download</span></button>
        <div class="result" id="result" aria-live="polite"></div>
        <div class="works" id="works"><span>Works with</span>${first.map((p, i) => `${i ? '<span class="sep" aria-hidden="true">·</span>' : ""}<span class="p" data-p="${esc(p.name)}">${esc(p.name)}</span>`).join("")}${more > 0 ? `<button type="button" id="moreBtn" aria-haspopup="dialog">+${more} more</button>` : ""}</div>
      </form>
      <a href="/pricing" class="row-card" aria-label="Batch download, up to 3 links at once, Pro feature">
        <span class="tile-ic"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="2"/><path d="M16.75 14v6M13.75 17h6"/></svg></span>
        <span style="flex:1;min-width:0"><span class="t">Batch download</span><span class="s">Up to 3 links at once</span></span>
        <span class="pro">PRO</span>${ICON.chevron}
      </a>
    </div>
  </div>

  <section class="reveal below" aria-labelledby="how">
    <div class="sec-head"><h2 id="how">How it works</h2></div>
    <div class="steps">
      <div class="step"><b>Copy the link</b><span>Use Share › Copy link in any app.</span></div>
      <div class="step"><b>Paste it here</b><span>Tap Paste — we detect the platform.</span></div>
      <div class="step"><b>Pick &amp; save</b><span>Choose quality. It lands in History.</span></div>
    </div>
  </section>

  <section id="tools" class="reveal below" aria-labelledby="toolsH">
    <div class="sec-head"><h2 id="toolsH">Tools</h2><a href="/features">See all</a></div>
    <div class="bento">
      <a href="/ai" class="tool wide" id="aiTool">
        <div class="art art-ai" aria-hidden="true"></div>
        <div class="prompt" aria-hidden="true"><span>a neon market at dusk, rain<span class="caret"></span></span><span class="go"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span></div>
        <div class="cap"><b>Frenz AI <span class="tag">NEW</span></b><span>Create images and short videos from a few words.</span></div>
      </a>
      <a href="/wallpapers" class="tool"><div class="art art-wp" aria-hidden="true"><span class="fan a"></span><span class="fan b"></span><span class="fan c"></span></div><div class="cap"><b>Wallpapers</b><span>HD wallpapers for your screen.</span></div></a>
      <a href="/quests" class="tool"><div class="art art-earn" aria-hidden="true"><div class="coins"><i style="top:56px"></i><i style="top:44px"></i><i style="top:32px"></i><i style="top:20px"></i></div></div><div class="cap"><b>Earn</b><span>Gifts and coins from your fans.</span></div></a>
      <a href="/exclusive" class="tool"><div class="art art-ex" aria-hidden="true"><div class="blurimg"></div><div class="lock"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg></div></div><div class="cap"><b>Exclusive</b><span>Posts your fans subscribe to see.</span></div></a>
      <a href="/explore" class="tool"><div class="art art-xp" aria-hidden="true"><div class="mosaic"><i style="background:linear-gradient(160deg,#F472B6,#7C3AED)"></i><i style="background:linear-gradient(160deg,#34D399,#0E7490)"></i><i style="background:linear-gradient(160deg,#FBBF24,#EA580C)"></i><i style="background:linear-gradient(160deg,#60A5FA,#1D4ED8)"></i><i style="background:linear-gradient(160deg,#E879F9,#BE185D)"></i><i style="background:linear-gradient(160deg,#A3E635,#15803D)"></i></div></div><div class="cap"><b>Explore</b><span>See what people are sharing.</span></div></a>
    </div>
  </section>

  <section id="creators" class="reveal below" aria-labelledby="crH">
    <div class="creator">
      <div>
        <h3 id="crH">Made something people love? Get paid for it.</h3>
        <p>Turn your posts into income with sticker gifts and exclusive posts, and track all of it in Creator analytics.</p>
        <a href="/account/creator-lounge" class="btn-ghost" style="margin-top:18px">Open Creator Lounge ${ICON.arrow}</a>
      </div>
      <div class="perks">
        <div class="perk"><span class="tile-ic" style="color:#B45309"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="9" width="16" height="11" rx="2"/><path d="M3 9h18M12 9v11M12 9c-1.5-3.5-6-3.5-5 0M12 9c1.5-3.5 6-3.5 5 0"/></svg></span><span><b>Sticker gifts</b><span>Fans send stickers paid with Gift Coins.</span></span></div>
        <div class="perk"><span class="tile-ic" style="color:#7C3AED"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg></span><span><b>Exclusive posts</b><span>Set a price and let fans subscribe.</span></span></div>
        <div class="perk"><span class="tile-ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 20V10M10 20V4M15 20v-7M20 20v-4"/></svg></span><span><b>Creator analytics</b><span>Engagement, earnings and gifts in one place.</span></span></div>
      </div>
    </div>
  </section>

  <section id="app" class="reveal below" aria-labelledby="appH">
    <div class="app-band">
      <div>
        <h3 id="appH">Frenz works best as an app</h3>
        <p>Faster saving, your History on every device, and notifications when friends share.</p>
        <div class="hint" style="margin-top:12px" id="iosHint"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4M8 7.5l4-4 4 4M5 12v6.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V12"/></svg>On iPhone: tap Share, then “Add to Home Screen”.</div>
      </div>
      <button class="btn-install" data-install type="button">Install Frenz</button>
    </div>
  </section>

  <section id="faq" class="faq below" aria-labelledby="faqH">
    <div class="sec-head"><h2 id="faqH">Questions</h2></div>
    ${landingFaq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("")}
  </section>

  <section id="platforms" class="below" aria-labelledby="platH2">
    <div class="sec-head"><h2 id="platH2">Downloaders</h2></div>
    <nav class="tools-links" aria-label="Downloaders by platform">${platforms.filter((p) => p.page).map((p) => `<a href="${esc(p.page!)}">${esc(p.name)} downloader</a>`).join("")}</nav>
  </section>
</main>

<footer>
  <div class="wrap">
    <a href="#top" class="logo" aria-label="Frenz home" style="display:inline-flex"><svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true"><path d="${LOGO_PATH}" fill="url(#lg)"/></svg><b style="font-size:17px">Frenz</b></a>
    <nav class="links" aria-label="Footer"><a href="/about">About</a><a href="/help">Help</a><a href="/contact">Contact</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/dmca">DMCA</a></nav>
    <small>Only save content you have the right to use. © ${new Date().getUTCFullYear()} Frenz.</small>
  </div>
</footer>

<nav class="tabbar" aria-label="App">
  <div class="tabs">
    <a href="/" aria-current="page"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M4 10.5L12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/></svg>Home</a>
    <a href="/friends"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/></svg>Friends</a>
    <a href="/history"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5M4 4v4.5h4.5M12 8v4.5l3 1.8"/></svg>History</a>
    <a href="/messages"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 4a8 8 0 0 0-6.9 12.1L4 20l4-1.1A8 8 0 1 0 12 4z"/></svg>Chats</a>
  </div>
  <a href="/profile" class="me" aria-label="Your profile"><span><svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20.5c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5z"/></svg></span></a>
</nav>

<dialog id="platSheet" aria-labelledby="platH">
  <div class="sheet"><div class="grab" aria-hidden="true"></div>
    <div class="sheet-head"><h2 id="platH">Supported platforms</h2>${closeBtn()}</div>
    <div class="plat-grid">${platforms.map((p) => (p.page ? `<a class="plat" href="${esc(p.page)}"><i aria-hidden="true">${esc(p.name[0]!)}</i>${esc(p.name)}</a>` : `<div class="plat"><i aria-hidden="true">${esc(p.name[0]!)}</i>${esc(p.name)}</div>`)).join("")}</div>
  </div>
</dialog>
<dialog id="menuSheet" aria-labelledby="menuH">
  <div class="sheet"><div class="grab" aria-hidden="true"></div>
    <div class="sheet-head"><h2 id="menuH">Menu</h2>${closeBtn()}</div>
    <nav class="menu-list" aria-label="Menu">
      <a href="#download" data-close>${ICON.download}Download</a>
      <a href="#tools" data-close><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/></svg>Tools</a>
      <a href="#creators" data-close><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 20V10M10 20V4M15 20v-7M20 20v-4"/></svg>For creators</a>
      <a href="#app" data-close><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M10.5 18.5h3"/></svg>Get the app</a>
      <a href="/help"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2-2.4 3.5M12 17h.01"/></svg>Help</a>
      <a href="/login"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20.5c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5z"/></svg>Sign in</a>
    </nav>
  </div>
</dialog>
<dialog id="newsSheet" aria-labelledby="newsH">
  <div class="sheet"><div class="grab" aria-hidden="true"></div>
    <div class="sheet-head"><h2 id="newsH">What's new</h2>${closeBtn()}</div>
    <div class="news">${WHATS_NEW.map((n) => `<article><time datetime="${n.date}">${esc(whatsNewDate(n.date))}</time><h3>${esc(n.title)}</h3><p>${esc(n.text)}</p></article>`).join("")}</div>
  </div>
</dialog>
<div class="toast" id="toast" role="status" aria-live="polite"><span class="ok" aria-hidden="true"><svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.3l2.6 2.6L11 4.5"/></svg></span><span id="toastText"></span></div>
<script type="application/json" id="ld-data">${scriptJson(data)}</script>
</body>
</html>`;
}
