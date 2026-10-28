import { readFileSync } from "node:fs";
import path from "node:path";

import type { Config } from "tailwindcss";

import { reachableFiles } from "./lib/perf/css-entry";
import base from "./tailwind.config";

/**
 * The COLD-ENTRY stylesheet's Tailwind config (`app/entry.css`, loaded by the marketing route group only).
 * Identical to `tailwind.config.ts` except `content`: just the files the root layout and the marketing tree can
 * reach — see lib/perf/css-entry.ts for why and how.
 *
 * Passed as `raw` text rather than paths: route-group folders like `(marketing)` are glob syntax to Tailwind's
 * content scanner, so a path list could silently match nothing and ship a landing with no utilities at all.
 */
const root = path.resolve(__dirname);

const config: Config = {
  ...base,
  content: reachableFiles(root).map((file) => ({ raw: readFileSync(file, "utf8"), extension: path.extname(file).slice(1) })),
};

export default config;
