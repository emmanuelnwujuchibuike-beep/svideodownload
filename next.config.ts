import type { NextConfig } from "next";

// A per-deploy build stamp, baked into BOTH the client bundle and the server at
// build time. The client compares its own stamp against /api/app-version and
// reloads itself when they differ — this is what keeps an installed PWA (whose
// resumed page can outlive many deploys without ever re-navigating) current
// without the user deleting and re-adding it to their home screen.
const appBuild = (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 12) || `dev-${Date.now()}`;

/**
 * Content-Security-Policy — REPORT-ONLY (docs/SECURITY.md "known follow-up").
 * Deliberately not enforcing yet: the ad system (features/monetization/inject.ts)
 * executes admin-configured third-party script markup (Adsterra/PropellerAds)
 * whose exact origins aren't knowable at build time, and the downloader itself
 * embeds thumbnails from whatever CDN yt-dlp resolves (images.remotePatterns
 * already allows any https host for the same reason) — enforcing blindly could
 * silently break ads or thumbnails. Report-only can never block a request; it
 * only surfaces violations (via report-uri, logged at /api/csp-report) so real
 * production origins can be observed before anything is tightened to `enforce`.
 * img/media/connect stay intentionally broad (https:) for that reason; the
 * directives that are cheap to lock down now (object-src, base-uri, frame-src,
 * frame-ancestors, form-action) already are.
 */
export function buildCsp(mode: "enforce" | "report"): string {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseHost = supabase ? new URL(supabase).host : null;
  const r2 = process.env.R2_PUBLIC_BASE_URL;
  const streamCode = process.env.NEXT_PUBLIC_CF_STREAM_CUSTOMER_CODE;

  const connect = ["'self'", "https:", "wss:"];
  const frame = ["'self'", "https://iframe.cloudflarestream.com"];
  if (supabaseHost) connect.push(`wss://${supabaseHost}`);
  if (r2) connect.push(r2);
  if (streamCode) frame.push(`https://customer-${streamCode}.cloudflarestream.com`);

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "frame-ancestors": ["'self'"],
    // Inline boot/theme scripts + JSON-LD use dangerouslySetInnerHTML, not nonces yet.
    "script-src": ["'self'", "'unsafe-inline'"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "https:", "data:", "blob:"],
    "media-src": ["'self'", "https:", "blob:"],
    "connect-src": connect,
    "frame-src": frame,
    "form-action": ["'self'"],
    // ── Ad-revenue-critical. Every directive here exists because it OTHERWISE
    //    FALLS BACK to `default-src 'self'` and silently breaks ad formats.
    //    (Owner, 2026-07-16: "make sure the ads revenue and anything related
    //    from ads is not blocked — cross check twice." Doing exactly that
    //    turned up two real breakages in the first enforcing policy.)
    //
    // font-src: NOT previously specified → fell back to `default-src 'self'`,
    // which blocks any webfont an injected social-bar/native ad pulls from a
    // CDN. (The app's OWN fonts are safe either way — next/font/google
    // self-hosts them under /_next — so nothing local ever surfaced this.)
    "font-src": ["'self'", "https:", "data:"],
    // worker-src: falls back to child-src → default-src, which would block
    // `blob:` workers. Nothing ships one TODAY (no `new Worker` in the repo),
    // but the batch-ZIP work is planned to, and a future silent break here
    // would be near-impossible to trace back to this file.
    "worker-src": ["'self'", "blob:"],
    // child-src: legacy fallback some engines still consult for nested
    // browsing contexts. Mirrors frame-src so an old engine can't be the one
    // thing that blocks an ad frame.
    "child-src": ["'self'", "https:", "blob:"],
  };

  if (mode === "enforce") {
    // ── Why this policy is ENFORCED but script-src stays permissive ──
    //
    // Until 2026-07-16 this app shipped CSP as report-only ONLY, which blocks
    // nothing — it just logs. That left the session cookie (JS-readable by
    // design; see lib/supabase/cookie-options.ts) with no CSP backstop at all,
    // and XSS is the one thing that makes a JS-readable cookie worse than an
    // httpOnly one. So an enforcing policy now ships alongside.
    //
    // `script-src` must tolerate third-party script this repo cannot enumerate:
    // features/monetization/inject.ts executes admin-configured ad markup
    // (Adsterra/PropellerAds) whose origins aren't knowable at build time, and
    // those scripts commonly eval(). Enforcing the strict list verbatim would
    // silently kill ad revenue — the exact reason the whole policy was parked
    // in report-only. Widening script-src here is an HONEST trade: it admits
    // script-src currently buys ~nothing, in exchange for actually enforcing
    // the directives that DO defend credentials today.
    //
    // What enforcement genuinely buys, even so:
    //   form-action 'self'   — injected <form> can't POST a password/OTP to an
    //                          attacker's origin. Directly on-point for
    //                          credential theft, and NOT covered by anything else.
    //   base-uri 'self'      — blocks <base href="//evil"> hijacking every
    //                          relative script/form URL on the page at once.
    //   object-src 'none'    — kills plugin/embed injection outright.
    //   frame-ancestors      — clickjacking (defence-in-depth with X-Frame-Options).
    //   default-src 'self'   — unexpected fetch/worker destinations.
    //
    // Locking script-src properly needs a nonce + 'strict-dynamic' (the ad
    // loader becomes a nonced script and its children inherit trust). That's a
    // real project with real revenue risk, so it is NOT bundled into this pass —
    // the strict list ships as report-only below to gather the evidence first.
    directives["script-src"] = ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https:"];

    // ── THE ad-revenue bug in the first enforcing policy (caught 2026-07-16
    //    by the owner asking to cross-check twice; it would have shipped) ──
    //
    // `frame-src` was left at `'self' https://iframe.cloudflarestream.com` —
    // the value written for the video player, back when this policy could not
    // block anything because it was report-only. Enforced, it breaks ads:
    //
    //   features/monetization/ad-slot.tsx renders every "display" network
    //   banner inside an isolated `<iframe srcdoc>`. A srcdoc frame INHERITS
    //   its parent's CSP — so this exact policy applies INSIDE the ad frame.
    //   Ad networks then nest a further iframe to render the creative, and
    //   that nested frame's origin (adsterra/propellerads/their CDNs) is not
    //   in the allowlist → blocked → the banner renders empty and earns
    //   nothing, with no error the owner would ever see.
    //
    // Widened to `https:` so any network's frame loads. Cloudflare Stream stays
    // covered by the same `https:`. `blob:` is kept for locally-generated
    // preview frames. `frame-ancestors 'self'` is UNCHANGED and unaffected —
    // that governs who may frame US (clickjacking), not who we may frame, so
    // this costs nothing on that axis.
    directives["frame-src"] = ["'self'", "https:", "blob:"];

    // Third ad breakage found on the same cross-check: `style-src` had no
    // `https:`, so an ad injecting `<link rel="stylesheet" href="https://…">`
    // (Adsterra's Social Bar does exactly this) would have had its stylesheet
    // blocked — the format then renders unstyled or not at all. Costs little
    // to allow: a stylesheet is not an XSS execution vector the way script is,
    // and `'unsafe-inline'` is already present regardless.
    directives["style-src"] = ["'self'", "'unsafe-inline'", "https:"];
  }

  const policy = Object.entries(directives)
    .map(([key, values]) => `${key} ${values.join(" ")}`)
    .join("; ");
  return `${policy}; report-uri /api/csp-report`;
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: { NEXT_PUBLIC_APP_BUILD: appBuild },
  // Emit a self-contained server bundle for the Docker runtime image.
  output: "standalone",
  // Keep barrel-heavy libraries from pulling their entire surface into a route
  // bundle: importing one icon should ship one icon. Central to the platform's
  // "more modules must not bloat existing routes" guarantee (docs/ARCHITECTURE.md).
  // Restore scroll position on back/forward for a native-feeling history stack.
  experimental: {
    optimizePackageImports: ["lucide-react", "react-icons", "framer-motion"],
    // Client Router Cache: Next 15 defaults dynamic pages to staleTime 0, so every
    // in-app navigation refetches from the server and flashes a loading skeleton.
    // Owner spec: Home (and every other visited route) should load ONCE per
    // session and be instant on every subsequent navigation back to it, no
    // matter how long the visitor was away — 6 hours safely covers any realistic
    // single session. Staying fresh over that long a window is NOT this cache's
    // job — that's what SmartFeed's own realtime subscription + quiet
    // mount/visibility-triggered revalidation (features/feed/smart-feed.tsx)
    // exists for, so navigation can stay unconditionally instant while content
    // still catches up invisibly. Tune here, not per-page.
    staleTimes: { dynamic: 21600, static: 300 },
    scrollRestoration: true,
  },
  images: {
    // yt-dlp returns thumbnails from arbitrary CDNs; allow https remotes.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
    // Serve modern formats (AVIF → WebP) so thumbnails/avatars are a fraction of
    // the JPEG/PNG weight, and cache the optimized variants for ~31 days.
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 2_678_400,
  },
  async headers() {
    return [
      {
        // The service worker itself must never be HTTP-cached, or clients keep
        // running an old worker (and old assets) after a deploy — the "my laptop
        // still shows the old UI" bug. Always revalidate it.
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // `()` is an EMPTY allowlist — it blocks the feature for EVERY
          // origin, including this site's own top-level document, not just
          // third-party iframes. Real bug found 2026-07-14 (owner report:
          // "the location says permission error when i try to use it"): this
          // categorically blocked navigator.geolocation.getCurrentPosition()
          // site-wide, no matter what the user's actual OS/browser
          // permission was — there was no way to "fix" it on their end. The
          // same blanket block also silently broke every getUserMedia() call
          // in the app: voice-message recording (voice-recorder.tsx) and
          // comment voice/video replies (lib/media/comment-recording.ts).
          // `(self)` allows THIS origin to request the permission — the
          // browser's own permission prompt (and the user's choice) is
          // untouched either way; this only controls whether the feature can
          // be requested here AT ALL.
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(self), geolocation=(self)",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // Blocks a same-origin popup/tab from getting a `window.opener` handle
          // back to this page (reverse-tabnabbing) while still allowing OAuth
          // popups to open — Supabase's Google sign-in is a full-page redirect
          // anyway, not a popup, so this has no functional effect on that flow.
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          // BOTH headers ship, and they are not redundant — they do different jobs:
          //  • enforce  — actually blocks. Permissive script-src so the ad system
          //               keeps working; everything else is real protection TODAY
          //               (form-action is the one that stops an injected form
          //               POSTing credentials off-origin).
          //  • report   — the STRICTER target (script-src without https:/eval).
          //               Blocks nothing; every violation it logs to
          //               /api/csp-report is a concrete origin we'd have to
          //               allow before script-src can be locked down for real.
          //               This is how we get the evidence the earlier
          //               "enforcing blindly could break ads" note asked for,
          //               without gambling revenue to get it.
          { key: "Content-Security-Policy", value: buildCsp("enforce") },
          { key: "Content-Security-Policy-Report-Only", value: buildCsp("report") },
        ],
      },
    ];
  },
};

/**
 * Optional bundle analyzer. Run `npm run analyze` to render per-route bundle
 * treemaps and catch regressions in First-Load JS as modules are added. Lazily
 * required so a normal build never fails when `@next/bundle-analyzer` isn't
 * installed — it only loads when ANALYZE=true.
 */
function withOptionalAnalyzer(config: NextConfig): NextConfig {
  if (process.env.ANALYZE !== "true") return config;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const withBundleAnalyzer = require("@next/bundle-analyzer")({ enabled: true });
    return withBundleAnalyzer(config);
  } catch {
    console.warn("[next.config] ANALYZE=true but @next/bundle-analyzer is not installed. Run: npm i -D @next/bundle-analyzer");
    return config;
  }
}

export default withOptionalAnalyzer(nextConfig);
