import path from "node:path";

import type { Config } from "tailwindcss";

import { writeLandingContent } from "./lib/perf/css-entry";
import base from "./tailwind.config";

/**
 * The LANDING's own stylesheet (`app/landing.css` — the landing `/` and the downloader pages only; 2026-10-31).
 * Identical to `tailwind.config.ts` except `content`: just what those pages import STATICALLY, i.e. what can be on
 * screen at first paint (lib/perf/css-entry.ts LANDING_CSS_ROOTS). Their lazy parts are styled by the entry sheet,
 * loaded after the paint. Read through one tracked file, like tailwind.entry.config.ts, so the build cache never
 * reuses a stale sheet.
 */
const root = path.resolve(__dirname);

const config: Config = {
  ...base,
  content: [writeLandingContent(root).replace(/\\/g, "/")],
};

export default config;
