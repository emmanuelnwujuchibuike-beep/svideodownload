// Bundles features/monetization/landing-ads.ts (the app's own ad-spot modules) into public/landing/ads.js for the static
// landing page, which runs no framework. Run after changing any module it imports:
//   node scripts/build-landing-ads.mjs
// lib/perf/landing-ads.test.ts fails when the committed bundle is older than its sources.
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  root,
  configFile: false,
  logLevel: "warn",
  resolve: { alias: { "@": root } },
  publicDir: false,
  build: {
    outDir: path.join(root, "public", "landing"),
    emptyOutDir: false,
    minify: true,
    target: "es2019",
    copyPublicDir: false,
    lib: { entry: path.join(root, "features", "monetization", "landing-ads.ts"), formats: ["es"], fileName: () => "ads.js" },
  },
});
console.log("public/landing/ads.js written");
