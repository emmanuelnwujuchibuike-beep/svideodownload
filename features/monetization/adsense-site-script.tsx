import { getMonetizationSettings } from "@/lib/monetization/settings";

/**
 * The site-level AdSense loader, rendered into `<head>` on every page.
 *
 * ── The two AdSense snippets, and why this one had nowhere to go ──────────────
 *
 * AdSense issues two things that look similar and are not:
 *
 *  1. An AD UNIT — publisher id **and** a slot id, rendered where you place it.
 *     That is `format: "adsense"` on an ad placement.
 *  2. This — publisher id, **no slot**, belongs in `<head>` on every page,
 *     renders nothing by itself. It is what verifies site ownership and what
 *     Auto ads runs from.
 *
 * The ad-placement form only accepted the first shape, so a publisher pasting
 * the verification snippet had no field to put it in. This is that field's
 * output.
 *
 * ── It must be server-rendered ────────────────────────────────────────────────
 *
 * Google's verification crawler reads the HTML the server returns. A script
 * appended by client JavaScript is invisible to it, so the site would stay
 * unverifiable no matter how correct the id was — the failure looks like
 * "we can't find the code on your site" while a browser shows it present.
 *
 * ── Deliberately not deferred to idle ─────────────────────────────────────────
 *
 * `ad-scripts.tsx` waits for `requestIdleCallback` to keep third-party script
 * out of the LCP window, and that is right for units that render into the page.
 * This tag is `async` and fetches a script Google serves from its own CDN; more
 * importantly it cannot be deferred without breaking verification, which is the
 * entire reason it exists. `async` means it never blocks the parser.
 *
 * ── CSP ───────────────────────────────────────────────────────────────────────
 *
 * No change needed: `script-src` already includes `https:`. The standing rule is
 * that ads must never be CSP-blocked.
 */
/**
 * Verification meta tags for every network, parsed from `name|content` lines.
 *
 * Rendered as real `<meta>` elements from structured values, never as markup —
 * an admin field that reached `<head>` unescaped would be a stored-XSS
 * primitive, and no single admin session should be able to put a script on
 * every page of the site.
 */
export async function VerificationTags() {
  const settings = await getMonetizationSettings();
  const tags = (settings.verificationTags ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, ...rest] = line.split("|");
      return { name: (name ?? "").trim(), content: rest.join("|").trim() };
    })
    /*
      Both halves required, and the NAME is restricted to the characters a meta
      name can legitimately contain. A blank content would emit a meta tag that
      asserts nothing, and an unconstrained name is the part an injection would
      have to travel through.
    */
    .filter((t) => t.name && t.content && /^[a-zA-Z0-9_.:-]+$/.test(t.name))
    .slice(0, 20);

  if (tags.length === 0) return null;

  return (
    <>
      {tags.map((t) => (
        <meta key={`${t.name}:${t.content}`} name={t.name} content={t.content} />
      ))}
    </>
  );
}

export async function AdSenseSiteScript() {
  const settings = await getMonetizationSettings();
  const client = settings.adsensePublisherId?.trim();

  /*
    Shape-checked, not merely non-empty. A publisher id pasted without its
    `ca-pub-` prefix (easy — AdSense shows it both ways, and ads.txt uses the
    bare `pub-` form) produces a script URL that 404s. The symptom is silence.
  */
  if (!client || !/^ca-pub-\d{10,20}$/.test(client.toLowerCase())) return null;
  const id = client.toLowerCase();

  return (
    <>
      {/*
        The meta tag AND the script, from the one publisher id.

        AdSense offers three verification methods — code snippet, ads.txt, meta
        tag — and an operator should not have to work out which one this site
        supports. Emitting the meta tag costs one line and satisfies that method
        outright, so whichever of the three is selected in the AdSense console,
        verification passes. The `ads.txt` method is covered by /ads.txt.
      */}
      <meta name="google-adsense-account" content={id} />
      {/*
        🔴 The loader is an inline BOOTSTRAP, not a bare `<script async src>`
        (owner decision, 2026-08-10: "delay Auto ads until after LCP, landing
        only").

        ── What this is buying ──────────────────────────────────────────────────
        Measured on the live landing page: of 314 KiB of unused JavaScript,
        230 KiB is third-party, and 154 KiB of that is this chain —
        adsbygoogle.js (30.5 KiB) pulling show_ads_impl_fy2021.js (123.6 KiB)
        for Auto ads. As an `async` tag in <head> it starts competing for the
        connection and the main thread during the LCP window, on the one page
        with a hard cold-entry budget. TTI on that page is 9.1s.

        ── Why the decision has to be made HERE, in the browser ─────────────────
        This component renders from the ROOT layout, which is shared by every
        route and cannot know which one it is on. The obvious server-side
        answers are both closed: `headers()` would un-static `/`, which is the
        single most expensive thing that can happen to this page (it is the only
        prerendered route that was ever served uncached — see the note in
        app/(marketing)/page.tsx), and a layout-level split would not isolate the
        landing anyway, since ~150 marketing pages share its layout.

        An inline script in <head> has the one piece of information the server
        does not: `location.pathname`, available at parse time, before any
        stylesheet or image request has been made. So the branch costs nothing
        and happens as early as a server-rendered tag would have.

        ── Every other route is UNCHANGED ───────────────────────────────────────
        `load()` runs immediately on any path that is not the landing, appending
        exactly the same async script this used to emit directly. The only
        difference for those pages is that the tag is created microseconds later
        by a parser-blocking inline script that is ~400 bytes.

        ── On the landing, "after LCP" means after `load` THEN idle ─────────────
        Not a fixed timer. `load` guarantees the LCP image and the rest of the
        page's own resources have finished; the idle callback then waits for the
        main thread to actually be free, so the ad chain cannot land on top of
        hydration. The 1500ms setTimeout is the fallback for Safari, which only
        shipped `requestIdleCallback` in 17 — without it, older iOS would never
        load ads at all, which is a revenue bug disguised as a performance win.
        The 3000ms `timeout` option is the other side of that: on a page that
        never goes idle, ads must still eventually load.

        ── Verification is not affected ─────────────────────────────────────────
        AdSense accepts three methods and this site emits all three
        independently: the `<meta name="google-adsense-account">` above (a
        complete method on its own, unchanged), `/ads.txt` (see app/ads.txt),
        and the code snippet. Only the third one's SHAPE changes here, and only
        on `/` — every other page still ships a literal script tag. If AdSense
        ever reports a verification problem, the meta tag is the method to point
        it at, and reverting this block restores the previous behaviour exactly.

        The guard flag makes `load()` idempotent so a bfcache restore or a
        second call can never inject two copies.
      */}
      <script
        dangerouslySetInnerHTML={{
          __html:
            `(function(){var s=${JSON.stringify(
              `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(id)}`,
            )};` +
            `function l(){if(window.__frenzAdsLoaded)return;window.__frenzAdsLoaded=1;` +
            `var e=document.createElement("script");e.async=true;e.crossOrigin="anonymous";e.src=s;` +
            `(document.head||document.documentElement).appendChild(e)}` +
            `try{if(location.pathname!=="/"){l()}else{` +
            `var i=function(){(window.requestIdleCallback||function(f){setTimeout(f,1500)})(l,{timeout:3000})};` +
            `if(document.readyState==="complete"){i()}else{addEventListener("load",i,{once:true})}` +
            `}}catch(err){l()}})();`,
        }}
      />
    </>
  );
}
