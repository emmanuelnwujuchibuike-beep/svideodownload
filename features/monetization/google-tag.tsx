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
      <Script id="frenz-gtm" strategy="lazyOnload">
        {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});
var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';
j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${id}');`}
      </Script>
    );
  }

  if (!GA_LIKE.test(id)) return null;

  return (
    <>
      <Script
        id="frenz-gtag-src"
        /*
          🔴 `lazyOnload`, not `afterInteractive` (owner, 2026-08-10: TBT 620ms,
          main-thread work 4.2s).

          Measured at 552 KiB — the largest single third-party asset on the
          landing page. `afterInteractive` starts fetching and EXECUTING it as
          soon as hydration finishes, so it lands directly on top of the busiest
          moment on the main thread and shows up in Total Blocking Time.

          Nothing is lost by waiting. The standard gtag snippet below defines
          `window.dataLayer` and a `gtag()` that pushes to that array, and
          gtag.js drains the queue when it eventually loads — so page views and
          events fired before it arrives are still recorded, in order. That is
          how Google designed the snippet, and it is why the SRC is the only
          part deferred here while the init stays where it is.
        */
        strategy="lazyOnload"
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`}
      />
      <Script id="frenz-gtag-init" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag('js',new Date());gtag('config','${id}');`}
      </Script>
    </>
  );
}
