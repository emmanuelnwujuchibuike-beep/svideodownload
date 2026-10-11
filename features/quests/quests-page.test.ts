import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/*
  The Earn credits redesign (owner brief 2026-10-11) — the honesty and cost rules
  it must keep, read from the real files.
*/
const PAGE = readFileSync("features/quests/quests-page.tsx", "utf8");
const API = readFileSync("app/api/quests/route.ts", "utf8");
const SQL = readFileSync("supabase/migrations/0194_quests.sql", "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("Earn credits — honest", () => {
  it("has no Claim step: quests are credited by SQL, so a claim button would be invented", () => {
    expect(SQL).toMatch(/function public\.quest_record/);
    expect(code(PAGE)).not.toMatch(/[Cc]laim/);
  });

  it("a completed quest shows no amount — the weekly cap can pay less than the list price", () => {
    // the cap really does clip a completed quest's credits (0194)
    expect(SQL).toMatch(/v_credits := least\(v_credits, greatest\(0, v_cap - v_earned\)/);
    expect(PAGE).toMatch(/\{q\.completed \? null : \(/);
    expect(code(PAGE)).not.toMatch(/credits added/);
  });

  it("a failed balance read is said, never shown as 0 (teeth: the API distinguishes the two)", () => {
    expect(API).toMatch(/if \(r\.error\) return null;/);
    expect(PAGE).toMatch(/wallet === null \?/);
    expect(PAGE).toMatch(/Balance unavailable right now/);
  });

  it("the reset time is the server's period end shown in the viewer's own clock, not a hard-coded city", () => {
    expect(code(PAGE)).not.toMatch(/Lagos/);
    expect(PAGE).toMatch(/toLocaleTimeString\(undefined/);
  });
});

describe("Earn credits — cheap", () => {
  it("the balance rides on the one /api/quests wave: no second fetch, no realtime, no polling", () => {
    expect(API).toMatch(/Promise\.all\(\[\s*getLandingSettings\(\),\s*db\.rpc\("quest_status"[\s\S]*?ai_product_balances/);
    const fetches = code(PAGE).match(/fetch\(/g) ?? [];
    expect(fetches).toHaveLength(1);
    expect(code(PAGE)).not.toMatch(/useWallet|\.channel\(|postgres_changes/);
  });

  it("the only timers are the minute countdown and the one-off highlight — and the page itself never ticks", () => {
    const intervals = code(PAGE).match(/setInterval\(/g) ?? [];
    expect(intervals).toHaveLength(1);
    expect(PAGE).toMatch(/function Countdown[\s\S]*?setInterval\(\(\) => setNow\(Date\.now\(\)\), 60_000\)/);
    expect(code(PAGE)).not.toMatch(/export function QuestsPage[\s\S]*?setInterval[\s\S]*?function BalanceCard/);
  });

  it("every animation has a reduced-motion off switch", () => {
    for (const cls of ["earn-pop", "earn-glow"]) expect(PAGE).toMatch(new RegExp(`prefers-reduced-motion: reduce\\)\\{[^}]*\\.${cls}`));
  });
});
