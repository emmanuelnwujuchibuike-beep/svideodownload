import path from "node:path";

import type { Config } from "tailwindcss";

import { writeEntryContent } from "./lib/perf/css-entry";
import base from "./tailwind.config";

/**
 * The COLD-ENTRY stylesheet's Tailwind config (`app/entry.css`, loaded by the marketing route group only).
 * Identical to `tailwind.config.ts` except `content`: just the files the root layout and the marketing tree can
 * reach — see lib/perf/css-entry.ts for why and how.
 *
 * Read through ONE generated file by path (not raw text): Tailwind records it as a build input, so the build cache
 * recompiles whenever anything the landing reaches changes (2026-10-28 — the raw-text version went stale on Vercel).
 */
const root = path.resolve(__dirname);

const config: Config = {
  ...base,
  /*
    ONE real file holding every source the landing can reach (lib/perf/css-entry.ts writeEntryContent) — by path, so
    Tailwind records it as a build input and a changed landing can never reuse a stale cached sheet (2026-10-28).
    Forward slashes and no route-group folder in the path: nothing here is glob syntax.
  */
  content: [writeEntryContent(root).replace(/\\/g, "/")],
};

export default config;
