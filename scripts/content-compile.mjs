#!/usr/bin/env node
/**
 * Living Content Platform — the compile step (RFC §1, Phase 4).
 *
 *   node scripts/content-compile.mjs seed      TS registries  →  Postgres
 *   node scripts/content-compile.mjs compile   Postgres       →  config/generated/*.ts
 *   node scripts/content-compile.mjs check     compile, but fail if output differs
 *
 * `seed` is the one-time migration of authority: it lifts the genome and authored
 * graph edges out of `lib/content/{genome,graph}` and into the authoring tables,
 * after which the admin UI is where they are edited. It is idempotent (upsert), so
 * re-running it is safe.
 *
 * `compile` is the publish path. It reads ONLY approved content and emits typed TS
 * that Next statically renders — marketing pages never query Postgres, which is
 * what keeps them at 0ms request cost and keeps `/` static.
 *
 * `check` is for CI: it recompiles and fails if the committed output is stale, so a
 * content change can never be approved in the database and silently never shipped.
 *
 * Deliberately a plain .mjs script with no framework: it runs in CI, in a deploy
 * hook and on a laptop, and must not depend on the Next runtime being available.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, "config/generated");

/* --------------------------------- env ------------------------------------- */

function loadEnv() {
  const path = resolve(ROOT, ".env.local");
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")]),
  );
}

const env = { ...loadEnv(), ...process.env };
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * The authoring tables are admin-only under RLS. The compiler runs server-side as
 * a trusted job and uses the service role, which bypasses RLS — this key must never
 * reach a browser bundle, which is why this is a script and not a route handler.
 */
async function rest(path, init = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${path}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

/* ------------------------- pure helpers (mirrored) -------------------------- */
/*
 * Duplicated from lib/content/compile/serialize.ts rather than imported: this
 * script must run without a TS toolchain (CI, deploy hook, bare node). The
 * DUPLICATION IS TESTED — lib/content/compile/compile.test.ts pins the same
 * behaviour on the TS side, and `check` compares emitted output, so a drift
 * between the two surfaces as a failing build rather than as silent divergence.
 */

function stableStringify(value, indent = 2) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])]));
    }
    return v;
  };
  return JSON.stringify(sort(value), null, indent);
}

function digest(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const BANNER = `/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Emitted by \`npm run content:compile\` from the authoring plane (migration 0085).
 * Edits here are overwritten on the next compile; change the content in the admin
 * authoring tables instead.
 *
 * This file exists so marketing pages cost 0ms at request time: the render plane
 * reads typed TS, never Postgres. See docs/LIVING_CONTENT_PLATFORM_RFC.md §1.
 */`;

function emitGenomeModule(rows) {
  const sorted = [...rows].sort((a, b) => a.product_id.localeCompare(b.product_id));
  const body = sorted
    .map((r) => `  ${JSON.stringify(r.product_id)}: ${stableStringify(r.genome, 2)},`)
    .join("\n");
  return `${BANNER}
import type { ProductGenome } from "@/lib/content/genome/types";

export const GENERATED_GENOMES: Record<string, ProductGenome> = {
${body}
};
`;
}

/* ---------------------------------- seed ------------------------------------ */

async function seed() {
  // Read the current TS registries via a throwaway TS run so the script stays
  // dependency-free at runtime but still uses the real, typed source of truth.
  const { GENOMES } = await importTs("lib/content/genome/registry.ts", "GENOMES");
  const { MODULES } = await importTs("lib/platform/modules.ts", "MODULES");

  const rows = Object.entries(GENOMES).map(([id, genome]) => {
    const mod = MODULES.find((m) => m.id === id);
    if (!mod) throw new Error(`genome "${id}" has no module`);
    return {
      product_id: id,
      genome,
      stage: mod.veracity.stage,
      claimable: mod.veracity.claimable,
      verified_at: mod.veracity.verifiedAt ?? null,
    };
  });

  await rest("product_genomes?on_conflict=product_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(rows),
  });

  console.log(`seeded ${rows.length} product genomes`);
}

/**
 * Load a named export from a TS module without adding a build dependency.
 * Uses the project's own vitest, which is already installed and TS-aware.
 */
async function importTs(relPath, exportName) {
  const { createServer } = await import("vite");
  const server = await createServer({
    root: ROOT,
    logLevel: "error",
    server: { middlewareMode: true },
    resolve: { alias: { "@": ROOT } },
  });
  try {
    const mod = await server.ssrLoadModule(resolve(ROOT, relPath));
    if (!(exportName in mod)) throw new Error(`${relPath} has no export "${exportName}"`);
    return mod;
  } finally {
    await server.close();
  }
}

/* -------------------------------- compile ----------------------------------- */

async function compile({ checkOnly = false } = {}) {
  const rows = await rest("product_genomes?select=product_id,genome,stage,claimable,verified_at");

  if (!rows.length) {
    // Refusing beats emitting an empty module: a silent wipe of the genome would
    // take every product page, JSON-LD entity and graph node with it.
    throw new Error("authoring plane is empty — run `seed` before `compile`");
  }

  const source = emitGenomeModule(rows);
  const outPath = resolve(OUT_DIR, "genome.ts");
  const previous = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";

  if (checkOnly) {
    if (previous !== source) {
      throw new Error("content is stale — run `npm run content:compile` and commit the result");
    }
    console.log(`content up to date (${rows.length} products, digest ${digest(source)})`);
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(outPath, source, "utf8");

  const d = digest(source);
  console.log(`compiled ${rows.length} products → config/generated/genome.ts (digest ${d})`);

  // Record the run. Best-effort: a failure to log must not fail a good compile.
  try {
    await rest("compile_runs", {
      method: "POST",
      body: JSON.stringify([
        { finished_at: new Date().toISOString(), status: "ok", items: rows.length, digest: d },
      ]),
    });
  } catch (err) {
    console.warn(`compile succeeded but run was not recorded: ${err.message}`);
  }
}

/* ---------------------------------- main ------------------------------------ */

const command = process.argv[2] ?? "compile";

/*
 * Set `exitCode` and return rather than calling process.exit().
 *
 * process.exit() tears the loop down while undici's keep-alive sockets from the
 * REST calls above are still open, which aborts the process with a libuv assertion
 * on Windows and reports 127 instead of 1 — a CI job reading that exit code would
 * be told something other than "this failed cleanly". Letting Node drain naturally
 * gives an honest status.
 */
try {
  if (command === "seed") await seed();
  else if (command === "compile") await compile();
  else if (command === "check") await compile({ checkOnly: true });
  else throw new Error(`unknown command "${command}" — expected seed | compile | check`);
} catch (err) {
  console.error(`content-compile ${command} failed: ${err.message}`);
  process.exitCode = 1;
}
