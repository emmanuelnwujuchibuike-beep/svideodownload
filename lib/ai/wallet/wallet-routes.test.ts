import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AI_FEATURES, PRIMARY_AI_FEATURE, aiFeature } from "../jobs";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  🔴 A RETIRED TOOL MAY NOT TAKE THE WALLET DOWN WITH IT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The bug this exists to stop, which shipped and was found on a phone
 * (2026-10-04): the balance page read "Couldn't load your balance right now"
 * for every member, and the allowance card beside it was blank.
 *
 * Neither had anything to do with money. Both routes opened with
 *
 *     const feature = aiFeature("ai_character_replace");
 *     if (!feature) return FEATURE_UNAVAILABLE;
 *
 * — a gate that was free for a year and then, the day Part 5 removed that
 * registry row, refused every request. The wallet and the AI plan allowance are
 * SHARED by every paid tool (`WALLET_FUNDED_FEATURES` names four) and were never
 * Character Replace's; only the gate said otherwise.
 *
 * So: a shared account route may not name a specific tool at all. It asks for
 * `primaryAiFeature()`, which the registry guarantees exists — and which a test
 * in `jobs.test.ts` keeps registered.
 *
 * ── Scope ─────────────────────────────────────────────────────────────────
 * ONLY the account surfaces below. A tool's OWN routes (`…/quote`, `…/jobs`,
 * `…/start`) SHOULD refuse when their feature is unregistered — that refusal is
 * how a retired tool stays retired, and this test must not undo it.
 */
const SHARED_ACCOUNT_ROUTES = [
  // the one wallet, read by the balance page and the recharge sheet
  "app/api/ai/character-replace/balance/route.ts",
  // the AI plan's credits and the plan catalogue
  "app/api/ai/credits/route.ts",
  // the dashboard's combined read — already correct; kept so it stays correct
  "app/api/ai/balance/route.ts",
] as const;

/**
 * Every `aiFeature("…")` literal in a file's CODE.
 *
 * Comments are stripped first, and deliberately: the fix for this bug explains
 * itself in a comment that quotes the old call verbatim, and a guard that
 * cannot tell prose from a call would have to be answered by deleting the
 * explanation.
 */
function featureLiterals(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  return [...code.matchAll(/aiFeature\(\s*"([a-z_]+)"\s*\)/g)].map((m) => m[1]!);
}

describe("shared Frenz AI account routes", () => {
  it("name no tool-specific feature at all", () => {
    for (const path of SHARED_ACCOUNT_ROUTES) {
      expect({ path, features: featureLiterals(src(path)) }).toEqual({ path, features: [] });
    }
  });

  it("resolve their subject through the registry anchor", () => {
    for (const path of SHARED_ACCOUNT_ROUTES) {
      expect(`${path} :: ${/primaryAiFeature\(\)/.test(src(path))}`).toBe(`${path} :: true`);
    }
  });

  /*
    🔴 TEETH. Without this, the two assertions above pass on a file that was
    deleted, renamed or emptied — and on the exact source that shipped the bug.
  */
  it("fails on the source that actually shipped the bug", () => {
    const shipped = `
      export async function GET(request: Request) {
        const feature = aiFeature("ai_character_replace");
        if (!feature) return NextResponse.json(aiErrorBody("FEATURE_UNAVAILABLE"));
        const { subject } = await resolveAiSubject(request, feature.id);
      }
    `;
    expect(featureLiterals(shipped)).toEqual(["ai_character_replace"]);
    // and the id it named is genuinely gone from the registry — that is WHY it refused
    expect(aiFeature("ai_character_replace")).toBeNull();
  });

  it("is reading real files, not an empty list", () => {
    expect(SHARED_ACCOUNT_ROUTES.length).toBeGreaterThan(0);
    for (const path of SHARED_ACCOUNT_ROUTES) expect(src(path).length).toBeGreaterThan(500);
  });

  it("keeps the anchor the routes lean on registered", () => {
    expect(AI_FEATURES.some((f) => f.id === PRIMARY_AI_FEATURE)).toBe(true);
  });
});
