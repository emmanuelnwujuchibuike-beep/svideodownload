import Script from "next/script";

import { getMonetizationSettings } from "@/lib/monetization/settings";

/**
 * The Google tag — GA4, Google Ads, or Tag Manager (owner, 2026-08-09).
 *
 * ── The ID is configured; the SNIPPET is ours ────────────────────────────
 * Google's install page hands you a block of `<script>` to paste. Accepting
 * that verbatim would put an admin-editable script on every page of the site —
 * a stored-XSS primitive with a friendly name, and one careless or compromised
 * admin session away from being the whole site's problem.
 *
 * So the admin stores an ID, it is validated against Google's three real
 * formats at both write and render, and the snippet is built from a template
 * here. Same discipline as `VerificationTags`, which takes name/content pairs
 * rather than raw `<meta>` markup, and as the Monetag snippet parser.
 *
 * ── Which snippet ───────────────────────────────────────────────────────
 * `GTM-` containers load Tag Manager; `G-` and `AW-` load gtag.js. They are
 * genuinely different products with different loaders, and installing the
 * wrong one for an id silently tracks nothing — so the prefix picks it rather
 * than the operator having to know.
 *
 * ── Loading strategy ────────────────────────────────────────────────────
 * `afterInteractive`, not `beforeInteractive`. Analytics must never sit in
 * front of the first paint on a site whose hardest constraint is a two-second
 * cold load — and unlike a verification tag, nothing breaks if it starts a
 * moment later. It still fires long before anyone can navigate away.
 */

const GA_LIKE = /^(?:G-[A-Z0-9]{6,12}|AW-[0-9]{9,12})$/i;
const GTM = /^GTM-[A-Z0-9]{6,10}$/i;

export async function GoogleTag() {
  const settings = await getMonetizationSettings();
  const id = (settings.googleTagId ?? "").trim();
  if (!id) return null;

  /*
    Re-validated at render, not merely at write. A settings row can be edited
    by hand or written by an older build, and this value ends up inside a
    script URL and a JS string literal — the one place where "it was checked
    when it was saved" is not good enough.
  */
  /* `lazyOnload` for the same reason as the gtag branch below: this loader
     pulls gtm.js, which is the same weight class, and the dataLayer it seeds
     queues anything fired before it arrives. */
  if (GTM.test(id)) {
    return (
      // the same timing as the gtag branch below (2026-10-19): after hydration at the first idle moment, not after load
      <Script id="frenz-gtm" strategy="afterInteractive">
        {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});
var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';
j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${id}');`}
      </Script>
    );
  }

  if (!GA_LIKE.test(id)) return null;

  /*
    🔴 THE TAG WAS ARRIVING TOO LATE TO COUNT PEOPLE (owner, 2026-10-19: "my google analytics have been giving an
    inaccurate and unbalance stat lately … dig deep until you see the cause").

    Measured on the live site (throttled phone: slow 4G, 4x CPU, GA hits blocked so nothing was recorded): the
    first page_view left the browser 9–26 s after the visit began — /: 26.4 / 21.2 / 15.9 s, /wallpapers:
    9.3–12.0 s, /feed: 17.6–19.7 s. gtag.js was `lazyOnload`, which waits for the window LOAD event — and on
    pages carrying ads, videos and wallpapers that event comes late. A visitor who left, or switched apps,
    before then was never counted at all. That drops exactly the short visits, unevenly per page (heaviest
    pages lose most): fewer users than real, engagement and session length inflated, pages out of balance.

    Now: the init (dataLayer, js, config — which queues the page_view) runs after hydration as before, and the
    gtag.js loader is injected at the first idle moment after hydration, at most 2 s later — not after the load
    event — or immediately when the page is hidden, so a quick visit is still counted. Still never in front of
    first paint (the 2-second cold-load rule); the 552 KiB file now downloads during idle time instead of
    after every ad and image.
  */
  const src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  return (
    <Script id="frenz-gtag-init" strategy="afterInteractive">
      {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag('js',new Date());gtag('config','${id}');
(function(){var done=false;function load(){if(done)return;done=true;var s=document.createElement('script');s.async=true;s.src='${src}';document.head.appendChild(s);}
if(window.requestIdleCallback){requestIdleCallback(load,{timeout:2000});}else{setTimeout(load,1500);}
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')load();});
addEventListener('pagehide',load);})();`}
    </Script>
  );
}
