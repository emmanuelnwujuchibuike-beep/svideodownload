import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Emit a self-contained server bundle for the Docker runtime image.
  output: "standalone",
  // Keep barrel-heavy libraries from pulling their entire surface into a route
  // bundle: importing one icon should ship one icon. Central to the platform's
  // "more modules must not bloat existing routes" guarantee (docs/ARCHITECTURE.md).
  experimental: {
    optimizePackageImports: ["lucide-react", "react-icons", "framer-motion"],
  },
  images: {
    // yt-dlp returns thumbnails from arbitrary CDNs; allow https remotes.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  async headers() {
    return [
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
