import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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
    // Caching visited routes briefly makes revisits/back-nav instant (native feel),
    // while realtime + the SWR layer keep content fresh. Tune here, not per-page.
    staleTimes: { dynamic: 180, static: 300 },
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
