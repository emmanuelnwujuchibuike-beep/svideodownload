#!/usr/bin/env node
/**
 * Global Experience Platform — the translation pipeline.
 *
 *   node scripts/i18n.mjs status          coverage per locale
 *   node scripts/i18n.mjs export fr       write i18n/fr.todo.json for a translator
 *   node scripts/i18n.mjs import fr       i18n/fr.json → lib/i18n/messages/fr.ts
 *
 * ── What this unblocks ────────────────────────────────────────────────────────
 *
 * Before this, translating Frenz meant editing TypeScript. That is a real barrier
 * disguised as a small one: the people who translate well are rarely the people
 * who are comfortable opening a repo, and asking them to means either the work
 * does not happen or an engineer becomes a bottleneck on every string.
 *
 * So the exchange format is JSON. A translator receives a file of English strings
 * with their keys, fills in the values, sends it back, and `import` compiles it
 * to the typed catalogue the app actually reads. Exactly the shape the Living
 * Content Platform already uses — an authoring plane that COMPILES to static TS —
 * and for the same reason: the running app must never pay a lookup cost or a
 * network hop for a button label.
 *
 * ── What it deliberately does NOT do ──────────────────────────────────────────
 *
 * There is no machine-translation step, and adding one would be a mistake rather
 * than a shortcut. Migration 0086 already encodes this project's position:
 * `machine` is a translation STATUS that must be reviewed before it counts as
 * done. A catalogue auto-filled by a model would flip a locale to 100%, switch
 * the site into a language nobody has read, and be indistinguishable in the
 * coverage table from work a human actually did. The gate exists precisely so
 * that cannot happen quietly.
 *
 * Plain .mjs with no framework, matching content-compile.mjs: it runs on a
 * laptop, in CI and in a deploy hook, and must not need the Next runtime.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MESSAGES_DIR = resolve(ROOT, "lib/i18n/messages");
const EXCHANGE_DIR = resolve(ROOT, "i18n");

/* ------------------------------ read the source ------------------------------ */

/**
 * Parse `en.ts` without running it.
 *
 * The alternative is a build step or a TS loader in a plain node script, and the
 * catalogue is a flat object literal of string values — the one shape a regex
 * reads safely. If en.ts ever stops being flat, this throws loudly rather than
 * silently exporting a subset, which is the failure that would matter.
 */
function readEnglish() {
  const source = readFileSync(resolve(MESSAGES_DIR, "en.ts"), "utf8");
  const body = source.slice(source.indexOf("export const en = {"), source.indexOf("} as const;"));

  const entries = [...body.matchAll(/^\s*"([\w.]+)":\s*\n?\s*("(?:[^"\\]|\\.)*")\s*,/gm)].map(
    ([, key, raw]) => [key, JSON.parse(raw)],
  );

  if (entries.length === 0) {
    throw new Error("No keys parsed from en.ts — the catalogue's shape changed.");
  }
  return Object.fromEntries(entries);
}

function readCatalogue(locale) {
  const path = resolve(MESSAGES_DIR, `${locale}.ts`);
  if (!existsSync(path)) return {};
  const source = readFileSync(path, "utf8");
  const start = source.indexOf("= {");
  const end = source.lastIndexOf("};");
  if (start === -1 || end === -1) return {};
  const entries = [
    ...source
      .slice(start, end)
      .matchAll(/^\s*"([\w.]+)":\s*\n?\s*("(?:[^"\\]|\\.)*")\s*,/gm),
  ].map(([, key, raw]) => [key, JSON.parse(raw)]);
  return Object.fromEntries(entries);
}

/** Locales the app declares. Read from the registry so the two cannot disagree. */
function readLocales() {
  const source = readFileSync(resolve(ROOT, "lib/i18n/locales.ts"), "utf8");
  return [...source.matchAll(/\{\s*code:\s*"(\w+)",\s*name:\s*"([^"]+)"/g)].map(([, code, name]) => ({
    code,
    name,
  }));
}

/* ---------------------------------- commands --------------------------------- */

function status() {
  const en = readEnglish();
  const keys = Object.keys(en);

  console.log(`\n${keys.length} UI strings.\n`);
  for (const locale of readLocales()) {
    const catalogue = locale.code === "en" ? en : readCatalogue(locale.code);
    const done = keys.filter((k) => typeof catalogue[k] === "string" && catalogue[k].trim()).length;
    const pct = Math.round((done / keys.length) * 100);
    // 90% is where a locale becomes offerable — below it a page switches
    // language mid-sentence, which reads as broken rather than partial.
    const offered = pct >= 90 ? "offered" : "not offered";
    console.log(`  ${locale.code.padEnd(4)} ${String(pct).padStart(3)}%  ${done}/${keys.length}  ${offered}`);
  }
  console.log("");
}

/**
 * The exchange format separates the SOURCE from the TRANSLATION, deliberately.
 *
 * The first version of this script exported `{ "nav.home": "Home" }` — the
 * English as the starting value — and the import accepted any non-empty string.
 * Importing an untouched export therefore reported the locale 100% complete and
 * flipped it to "offered", in English. That is precisely the fabricated-coverage
 * failure this whole design exists to prevent, and it took a round trip to catch
 * because every individual step looked correct.
 *
 * With `en` and `translation` as separate fields the ambiguity is gone: an empty
 * `translation` is untranslated, and a translator who deliberately keeps the
 * English (a brand name, an abbreviation) has said so by typing it.
 */
function exportLocale(locale) {
  const en = readEnglish();
  const existing = readCatalogue(locale);

  const todo = {};
  for (const [key, english] of Object.entries(en)) {
    const current = existing[key];
    todo[key] = {
      en: english,
      translation: typeof current === "string" ? current : "",
    };
  }

  const outstanding = Object.values(todo).filter((entry) => !entry.translation).length;

  mkdirSync(EXCHANGE_DIR, { recursive: true });
  const path = resolve(EXCHANGE_DIR, `${locale}.todo.json`);
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        _README: [
          `Fill in each "translation" field in ${locale}. Leave "en" and the keys alone.`,
          "An empty translation stays untranslated — that is fine, partial is expected.",
          "Placeholders like {year} must survive: move them wherever the sentence needs",
          "them, but do not rename or drop them (the import refuses if you do).",
          `Save as i18n/${locale}.json, then run: npm run i18n:import -- ${locale}`,
        ],
        ...todo,
      },
      null,
      2,
    )}\n`,
  );

  console.log(`${outstanding} untranslated of ${Object.keys(en).length} → ${path}`);
}

/**
 * Placeholders are the one thing a translator can silently break.
 *
 * A dropped `{year}` produces a copyright line with no year — correct-looking,
 * wrong, and invisible until someone reads the footer in that language. So the
 * import refuses rather than warns: a refusal is fixed in minutes, a warning
 * scrolls past.
 */
function placeholders(value) {
  return [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

function importLocale(locale) {
  const en = readEnglish();
  const path = resolve(EXCHANGE_DIR, `${locale}.json`);
  if (!existsSync(path)) {
    console.error(`No ${path}. Run: npm run i18n:export -- ${locale}`);
    process.exit(1);
  }

  const incoming = JSON.parse(readFileSync(path, "utf8"));
  delete incoming._README;

  const merged = { ...readCatalogue(locale) };
  const problems = [];

  for (const [key, entry] of Object.entries(incoming)) {
    if (!(key in en)) {
      problems.push(`unknown key "${key}" — it is not in the English catalogue`);
      continue;
    }

    /*
      Only the `translation` field is read. A file in the old flat shape
      (`"key": "value"`) is rejected rather than guessed at — guessing is how an
      untouched export became a 100%-complete English locale.
    */
    if (typeof entry !== "object" || entry === null || !("translation" in entry)) {
      problems.push(`"${key}" is not in the {en, translation} shape — re-run export`);
      continue;
    }

    const value = entry.translation;
    if (typeof value !== "string" || !value.trim()) continue;

    const expected = placeholders(en[key]);
    const got = placeholders(value);
    if (expected.join(",") !== got.join(",")) {
      problems.push(
        `"${key}" expects placeholders [${expected.join(", ")}] but has [${got.join(", ")}]`,
      );
      continue;
    }
    merged[key] = value;
  }

  if (problems.length > 0) {
    console.error(`\nRefusing to import ${locale}:\n  ${problems.join("\n  ")}\n`);
    process.exit(1);
  }

  const ordered = Object.keys(en).filter((k) => merged[k]);
  const body = ordered.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(merged[k])},`).join("\n");

  const file = `import type { Messages } from "./en";

/**
 * ${locale} — GENERATED by scripts/i18n.mjs from i18n/${locale}.json.
 *
 * Do not edit by hand: the next import overwrites it. Translate the exchange
 * file and re-run \`npm run i18n:import -- ${locale}\`.
 *
 * Partial by design. Coverage is measured from what is here, and the locale is
 * only offered to visitors once it passes 90% — see lib/i18n/locales.ts.
 */
export const ${locale}: Partial<Messages> = {
${body}
};
`;

  writeFileSync(resolve(MESSAGES_DIR, `${locale}.ts`), file);
  console.log(
    `${ordered.length}/${Object.keys(en).length} string(s) → lib/i18n/messages/${locale}.ts`,
  );
  console.log(`Wire it up in messages/index.ts if it is not already there, then: npm test`);
}

/* ----------------------------------- main ------------------------------------ */

const [command, locale] = process.argv.slice(2);
const known = new Set(readLocales().map((l) => l.code));

if (command === "status") {
  status();
} else if (command === "export" || command === "import") {
  if (!locale || !known.has(locale)) {
    console.error(`Usage: node scripts/i18n.mjs ${command} <${[...known].join("|")}>`);
    process.exit(1);
  }
  if (locale === "en") {
    console.error("English is the source. Edit lib/i18n/messages/en.ts directly.");
    process.exit(1);
  }
  if (command === "export") exportLocale(locale);
  else importLocale(locale);
} else {
  console.error("Usage: node scripts/i18n.mjs status | export <locale> | import <locale>");
  process.exit(1);
}
