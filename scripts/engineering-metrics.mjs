#!/usr/bin/env node
/**
 * Engineering metrics — prints DORA-style delivery metrics computed from git history.
 *
 *   node scripts/engineering-metrics.mjs [limit=200]
 *
 * Honest by construction: the numbers are proxies from commits (see
 * lib/platform/engineering-metrics.ts), each labelled. Node ≥ 23 runs the imported
 * .ts directly.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { computeReport } from "../lib/platform/engineering-metrics.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const limit = Number(process.argv[2]) || 200;

// %H|%ct|%s — hash | committer unix seconds | subject. Arg array, no shell = no injection.
const raw = execFileSync("git", ["log", "-n", String(limit), "--pretty=format:%H|%ct|%s"], {
  cwd: ROOT,
  encoding: "utf8",
});

const events = raw
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [sha, ct, ...rest] = line.split("|");
    return { sha, timestampMs: Number(ct) * 1000, subject: rest.join("|") };
  });

const r = computeReport(events);

console.log(`Engineering metrics — last ${r.changes} commits (~${r.windowDays} days)`);
console.log(`  Deployment frequency : ${r.deploymentsPerDay}/day   (proxy: commits to main; Vercel auto-deploys main)`);
console.log(`  Change failure rate  : ${r.changeFailureRatePct}%   (proxy: reverts + hotfix/rollback commits)`);
console.log(
  `  Mean time to recovery: ${r.mttrHours === null ? "n/a — no recoveries in window" : `${r.mttrHours}h`}   (proxy)`,
);
console.log(`  Lead time for changes: needs-signal   (deploy timestamps not in git; wire CI/deploy data to measure)`);
