#!/usr/bin/env node
/**
 * Design-token codegen — writes the CSS custom properties in app/globals.css from
 * the single source of truth (lib/platform/design-tokens.ts), between the
 * `design-tokens:start/end` markers. Everything else in globals.css is untouched.
 *
 *   node scripts/design-tokens.mjs generate   registry → globals.css (write)
 *   node scripts/design-tokens.mjs check       fail if globals.css is out of sync
 *
 * Node ≥ 23 strips the types from the imported .ts at runtime — no build step.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderTokenCss, TOKEN_MARKERS } from "../lib/platform/design-tokens.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSS_PATH = path.join(ROOT, "app/globals.css");

/** Replace the text between the markers with freshly-rendered token CSS. */
function build(css) {
  const startIdx = css.indexOf(TOKEN_MARKERS.start);
  const endIdx = css.indexOf(TOKEN_MARKERS.end);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(
      `design-token markers not found in app/globals.css. They must be present:\n  ${TOKEN_MARKERS.start}\n  ${TOKEN_MARKERS.end}`,
    );
  }
  const before = css.slice(0, startIdx + TOKEN_MARKERS.start.length);
  const after = css.slice(endIdx); // starts at the end marker text; its indent is in `before`
  return `${before}\n${renderTokenCss()}\n  ${after}`;
}

const mode = process.argv[2] ?? "generate";
const css = readFileSync(CSS_PATH, "utf8");
const next = build(css);

if (mode === "check") {
  if (css !== next) {
    console.error(
      "✗ app/globals.css design tokens are out of sync with lib/platform/design-tokens.ts.\n  Run: npm run tokens:generate",
    );
    process.exit(1);
  }
  console.log("✓ design tokens in sync");
} else {
  if (css !== next) {
    writeFileSync(CSS_PATH, next);
    console.log("✓ wrote design tokens into app/globals.css");
  } else {
    console.log("✓ design tokens already in sync");
  }
}
