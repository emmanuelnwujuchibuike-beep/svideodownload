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
      <script
        async
        crossOrigin="anonymous"
        src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(id)}`}
      />
    </>
  );
}
