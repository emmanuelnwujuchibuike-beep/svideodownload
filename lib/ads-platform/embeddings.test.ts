import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 2026-10-09 (owner: "There is a live ad campaign but yet it shows no
 * campaign in view all campaign").
 *
 * ad_campaign_daily_stats references BOTH ad_campaigns and ad_creatives, so
 * PostgREST sees two paths between those tables and refuses an unnamed embed
 * with PGRST201 ("Could not embed … more than one relationship"). The query
 * then returns nothing — and the dashboard said "No campaigns yet" over a live
 * campaign. Verified against production: the bare embeds fail with 300, the
 * named ones answer 200.
 *
 * Any embed between these two tables must name the direct link.
 */
function files(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\./.test(n)) out.push(p);
  }
  return out;
}

describe("ad_campaigns <-> ad_creatives embeds name their link", () => {
  const sources = ["lib", "features", "app"].flatMap((d) => files(join(process.cwd(), d)));
  it("no bare ad_creatives( embed from ad_campaigns, no bare ad_campaigns( embed from ad_creatives", () => {
    const bad: string[] = [];
    for (const f of sources) {
      const s = readFileSync(f, "utf8");
      // a select string that embeds ad_creatives without a hint
      for (const m of s.matchAll(/from\("ad_campaigns"\)[\s\S]{0,40}?\.select\(\s*(?:"([^"]*)"|([A-Z_]+))/g)) {
        const sel = m[1] ?? "";
        if (/(^|[\s,])ad_creatives\(/.test(sel)) bad.push(`${f}: ${sel.slice(0, 80)}`);
      }
      for (const m of s.matchAll(/from\("ad_creatives"\)[\s\S]{0,40}?\.select\(\s*"([^"]*)"/g)) {
        if (/(^|[\s,])ad_campaigns\(/.test(m[1]!)) bad.push(`${f}: ${m[1]!.slice(0, 80)}`);
      }
      // the named select constants used by the dashboard and the applications list
      for (const m of s.matchAll(/=\s*\n?\s*"([^"]*ad_creatives[^"]*)"/g)) {
        if (/(^|[\s,])ad_creatives\(/.test(m[1]!)) bad.push(`${f}: ${m[1]!.slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
    // it reads every source file: generous, so a busy parallel run cannot time it out
  }, 120_000);

  it("teeth: the detector catches the exact shape that broke the dashboard", () => {
    const broken = `const C = "id, name, ad_placements(code), ad_creatives(id, status)";`;
    expect([...broken.matchAll(/=\s*\n?\s*"([^"]*ad_creatives[^"]*)"/g)].some((m) => /(^|[\s,])ad_creatives\(/.test(m[1]!))).toBe(true);
    const fixed = `const C = "id, ad_creatives!ad_creatives_campaign_id_fkey(id)";`;
    expect([...fixed.matchAll(/=\s*\n?\s*"([^"]*ad_creatives[^"]*)"/g)].some((m) => /(^|[\s,])ad_creatives\(/.test(m[1]!))).toBe(false);
  });
});
