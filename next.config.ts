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
function buildCsp(): string {
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
  };

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
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
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
          { key: "Content-Security-Policy-Report-Only", value: buildCsp() },
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
