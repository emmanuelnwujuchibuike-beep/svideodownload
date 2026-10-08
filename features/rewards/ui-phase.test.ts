import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Owner brief 2026-10-07 (UI/UX phase): AI Reels, the AI result's share and
 * reward feedback, the two credit classes, referrals, one share helper, and
 * the member's choice of payment provider. Pinned where a regression would
 * promise something the server did not grant, or open a second system.
 */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("AI Reels is a tab of the existing Reels deck, not a second product", () => {
  it("the tab exists and asks the same endpoint with the AI filter", () => {
    expect(code("features/reels/viewer/reel-tabs.tsx")).toContain('{ id: "ai", label: "AI Reels" }');
    const feed = code("features/reels/reels-feed.tsx");
    expect(feed).toContain('available={["for_you", "following", "ai"]}');
    expect(feed).toContain('...(sort === "ai" ? { content: "ai" } : {}),');
    expect(code("app/api/reels/route.ts")).toContain('contentType: sp.get("content") === "ai" ? "ai_video" : undefined');
  });
  it("the AI tab is NOT pre-fetched on mount (only Following is warmed) — no request until it is opened", () => {
    const feed = code("features/reels/reels-feed.tsx");
    expect(feed).not.toContain('fetchPage("ai", 0)');
  });
  it("an empty AI Reels tab has its own premium empty state with one CTA", () => {
    const feed = code("features/reels/reels-feed.tsx");
    expect(feed).toContain("AI Reels are just getting started.");
    expect(feed).toContain("Create AI Video");
  });
  it("only an AI post carries the marker, and the reel says 'AI Generated' only for it", () => {
    const hf = code("lib/social/home-feed.ts");
    expect(hf).toContain('return v === "ai_video" || v === "ai_audio" ? { contentType: v } : {};');
    const rv = code("features/feed/reel-viewer.tsx");
    const at = rv.indexOf("AI Generated");
    expect(at).toBeGreaterThan(-1);
    expect(rv.slice(Math.max(0, at - 600), at)).toContain('item.contentType === "ai_video" ? (');
  });
});

describe("🔴 a reward is shown only after the server granted it", () => {
  it("the result card's numbers come from granted reward rows, never the rule", () => {
    const r = code("app/api/ai/jobs/[id]/rewards/route.ts");
    expect(r).toContain('.from("reward_events")');
    expect(r).toContain("generation: generation ? { credits: generation.amount } : null");
    // the share offer: rule on, long enough by the SERVER's measured duration, not yet rewarded
    expect(r).toContain("duration >= minSeconds - 0.05");
    expect(r).toContain("shareOffer: eligible && !share ?");
  });
  it("the card shows +N after publishing only from the publish response's granted reward", () => {
    const c = code("features/ai/video/ai-result-share.tsx");
    expect(c).toContain("json.reward ? `Shared to AI Reels · +${json.reward.credits} AI Credits` : \"Shared to AI Reels\"");
    expect(c).toContain("{status.shareOffer ? (");
    expect(c).not.toMatch(/\+3 AI Credits|\+5 AI Credits/);
  });
});

describe("two credit classes, said plainly", () => {
  const page = code("features/rewards/rewards-page.tsx");
  it("Non-withdrawable and Withdrawable are separate figures (renamed 2026-10-08 to match transfers)", () => {
    expect(page).toContain('label="Non-withdrawable" value={wallet.usableCredits}');
    expect(page).toContain('label="Withdrawable" value={wallet.withdrawableCredits}');
  });
  it("before qualifying: the brief's sentence, and that earlier rewards never become withdrawable", () => {
    expect(page).toContain("Your referral rewards can be used for AI features. Withdrawable rewards unlock after you meet the withdrawal requirements.");
    expect(page).toContain("they don&apos;t become withdrawable later");
  });
  it("withdrawing is offered only to an approved, unrestricted member with enough withdrawable credits", () => {
    expect(page).toContain("const canWithdraw = approved && !q.restricted && !!w && wallet.withdrawableCredits >= w.minCredits;");
  });
});

describe("one share link for every surface", () => {
  it("the share sheet uses the member's attribution link only for their OWN post", () => {
    const s = code("features/social/share-sheet.tsx");
    expect(s).toContain("if (!open || !isOwner) return;");
    expect(s).toContain("const postUrl = () => ownLink ?? `${window.location.origin}/p/${postId}`;");
    expect(code("lib/referrals/share-client.ts")).toContain('fetch("/api/share-links"');
  });
});

describe("Paystack or Bachs — the member picks only among what the route allows", () => {
  it("no picker unless there are two providers", () => {
    expect(code("features/ai/wallet/payment-provider-picker.tsx")).toContain("if (providers.length < 2) return null;");
  });
  it("both checkouts pass the pick as a PREFERENCE, honoured only when the admin allows a choice", () => {
    expect(code("lib/ai/character-replace/topup-server.ts")).toContain("preferred: plans.wallet.memberChoice ? opts.provider : undefined");
    expect(code("app/api/ai/subscriptions/checkout/route.ts")).toContain("preferred: plans.wallet.memberChoice ? parsed.data.provider : undefined");
  });
});
