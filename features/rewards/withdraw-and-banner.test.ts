import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { normalizeRewardsConfig } from "@/lib/rewards/config";

/**
 * Owner, 2026-10-07 (follow-ups): the referral banner after downloads, the
 * withdrawal path greyed until met and decided by an admin, editable
 * requirements, the AI save that must not open the browser on iPhone, and the
 * AI history in the downloads viewer.
 */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const body = (src: string, name: string) => {
  const start = src.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf("$$;", start));
};

describe("the referral banner after a download", () => {
  const trigger = code("features/rewards/referral-banner-trigger.tsx");
  const banner = code("features/rewards/referral-banner.tsx");
  it("one listener for every kind of download, from the 3rd on, guests included (a per-browser count)", () => {
    expect(trigger).toContain("window.addEventListener(DOWNLOAD_COMPLETED_EVENT, onCompleted);");
    expect(trigger).toContain("const AFTER = 3;");
    expect(trigger).toContain("localStorage.setItem(COUNT_KEY, String(count));");
    expect(code("features/app-shell/deferred-shell.tsx")).toContain("<ReferralBannerTrigger />");
  });
  it("never on top of the download-complete ad — it waits for the ad to close", () => {
    expect(trigger).toContain(`document.querySelector('[role="dialog"][aria-label="Advertisement"]')`);
  });
  it("costs the page nothing until it shows: the banner is a dynamic import", () => {
    expect(trigger).toContain('dynamic(() => import("@/features/rewards/referral-banner")');
    expect(trigger).not.toMatch(/from "@\/features\/rewards\/referral-banner"/);
  });
  it("says the LIVE amount (never a hard-coded 2), can be skipped only after a short read, and a guest is sent to sign in", () => {
    expect(banner).toContain('fetch("/api/rewards/public")');
    // the code (comments stripped) never writes a number of credits — the owner's "2" lives in the admin rule
    const live = banner.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(live).not.toMatch(/earn \d+ credit/);
    expect(live).toContain("Earn credits with Frenzsave");
    expect(live).toContain("{referralSentence(rules, n)}");
    expect(live).toContain("withdraw them once your account has reached the qualifications");
    expect(banner).toContain("const SKIP_AFTER_S = 4;");
    expect(banner).toContain("disabled={!canSkip}");
    expect(banner).toContain("Sign in to get your link");
  });
});

describe("🔴 withdrawal qualification is applied for and granted by an admin (0191)", () => {
  const m91 = code("supabase/migrations/0191_reward_qualification_review.sql");
  const m89 = code("supabase/migrations/0189_reward_engine_performance.sql");
  it("grant_reward is 0189's, minus ONLY the automatic qualification", () => {
    const now = body(m91, "grant_reward");
    expect(now).not.toContain("update public.reward_profiles set qualified_at = now()");
    const before = body(m89, "grant_reward");
    const auto = before.slice(before.indexOf("  -- qualification, decided NOW"), before.indexOf("  v_class := case"));
    const note = now.slice(now.indexOf("  -- 0191: qualification is GRANTED"), now.indexOf("  v_class := case"));
    expect(now.replace(note, auto)).toBe(before);
  });
  it("members already qualified stay approved; the new function is closed to the browser", () => {
    expect(m91).toContain("update public.reward_profiles set qualification_status = 'approved' where qualified_at is not null");
    expect(m91).toContain("'public.rewards_admin_members(integer)'");
  });
  it("applying re-checks age and engagements on the server, and moves only none/rejected → applied", () => {
    const q = code("lib/rewards/qualification.ts");
    expect(q).toContain("if (ageDays < q.minAccountAgeDays || p.qualifying_engagements < q.minEngagements)");
    expect(q).toContain('.in("qualification_status", ["none", "rejected"])');
    // and an admin decides only an application that is waiting
    expect(q).toContain('.eq("qualification_status", "applied")');
  });
});

describe("the withdrawal section is always there, greyed until each step is met", () => {
  const page = code("features/rewards/rewards-page.tsx");
  it("locked until approved and above the minimum", () => {
    expect(page).toContain("const canWithdraw = approved && !q.restricted && !!w && wallet.withdrawableCredits >= w.minCredits;");
    expect(page).toContain("<fieldset disabled={!enabled}");
    expect(page).toContain("disabled={busy || !q.canApply || q.restricted}");
  });
  it("sends the payout keys the server validates", () => {
    expect(page).toContain('["accountName", "Account name"]');
    expect(code("lib/rewards/withdrawals.ts")).toContain("accountName: s(r.accountName, 120)");
  });
  it("shows the withdrawal rate as its own rate", () => {
    expect(page).toContain("Withdrawal rate: {w.creditsPerUsd} credits = $1 (separate from the top-up rate)");
  });
});

describe("the requirements are the operator's to change, add or rewrite", () => {
  it("extra requirement lines are cleaned, capped, and kept", () => {
    const c = normalizeRewardsConfig({ qualification: { minAccountAgeDays: 0, minEngagements: 5, extraRequirements: ["  Verified\u0000 email  ", "", 7, "x".repeat(300), "a", "b", "c", "d", "e", "f", "g"] } });
    expect(c.qualification.minAccountAgeDays).toBe(0);
    expect(c.qualification.extraRequirements[0]).toBe("Verified email");
    expect(c.qualification.extraRequirements[1]).toHaveLength(120);
    expect(c.qualification.extraRequirements).toHaveLength(8);
    expect(normalizeRewardsConfig({}).qualification.extraRequirements).toEqual([]);
  });
});

describe("Frenz AI saves never open the browser on iPhone", () => {
  it("the result card saves through the downloader's manager, not a cross-origin <a download>", () => {
    const r = code("features/ai/video/ai-video-result.tsx");
    expect(r).not.toMatch(/<a\s+href=\{src\}\s+download/);
    expect(r).toContain("startAiResultDownloadById({ id: job.id, feature })");
  });
});

describe("AI history opens in the downloads viewer", () => {
  it("a finished AI video becomes a viewer record streamed from our own route", () => {
    expect(code("features/ai/frenz-ai-history.tsx")).toContain("openPlayer(aiJobRecord(job));");
    const d = code("features/ai/ai-result-download.ts");
    expect(d).toContain("directUrl: href,");
    // the address must be a real redirect to the file (download=1&redirect=1), never the JSON answer
    expect(d.slice(d.indexOf("export function aiJobRecord"))).toContain("const href = aiResultDownloadHref(job.id);");
    expect(d).toContain("aiJobId: job.id,");
    expect(code("features/downloads/download-player.tsx")).toContain("fetch(rec.directUrl || downloadUrl(");
  });
  it("teeth: an AI video is never published as a plain post from the viewer", () => {
    const p = code("features/downloads/download-player.tsx");
    expect(p).toContain(') : rec.formatId === "frenz-ai" ? null : (');
    expect(p).toContain("/api/ai/jobs/${encodeURIComponent(rec.aiJobId)}/publish");
  });
});

describe("the banner's referral sentence comes from the live amounts (owner 2026-10-07: sign-up 2, top-up 10, subscribe 10)", () => {
  it("says each paying event with its own amount", async () => {
    const { referralSentence } = await import("@/lib/rewards/referral-copy");
    expect(referralSentence({ referral: { signup: 2, topup: 10, subscribe: 10 } }, 10)).toBe(
      "Share your Frenzsave link. Earn 2 credits when someone you invite signs up, and 10 credits every time they top up or subscribe.",
    );
    expect(referralSentence({ referral: { signup: 2, topup: 0, subscribe: 0 } }, 2)).toBe("Share your Frenzsave link. Earn 2 credits when someone you invite signs up.");
  });
});
