import { describe, expect, it } from "vitest";

import {
  AI_POLICY_MESSAGE,
  AI_RIGHTS_NOTICE,
  policyBlockEvent,
  screenAiJob,
  screenAiText,
} from "@/lib/ai/acceptable-use";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE ACCEPTABLE-USE LAYER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "Do NOT rely solely on frontend validation. The
 * backend/API must enforce these restrictions" — and, in the same brief, "Do
 * NOT block normal legitimate editing… The goal is NOT to make Frenz AI
 * frustrating."
 *
 * 🔴 THE SECOND HALF IS THE HARDER TEST, AND IT COMES FIRST BELOW. A policy
 * layer that blocks a prohibited purpose is easy to write and easy to verify. A
 * policy layer that blocks it WITHOUT breaking the ordinary case is the actual
 * requirement, and the ordinary case for this product is somebody removing a
 * caption or a watermark from their own footage — which shares every topic word
 * with the thing being prevented.
 */

/* ── 🔴 THE FEATURE ITSELF MUST NEVER BE BLOCKED ─────────────────────────── */

describe("ordinary editing is never refused", () => {
  const ordinary = [
    // The product, named plainly. All of these are what people actually upload.
    "watermark.mp4",
    "remove watermark.mp4",
    "remove-watermark-from-my-video.mp4",
    "my video watermark removal.mov",
    "clean up captions.mp4",
    "remove text overlay.webm",
    "delete subtitles from my clip.mp4",
    "logo removal test.mp4",
    "remove logo from my own footage.mp4",
    "strip the text.mp4",
    "erase caption.mp4",
    "get rid of the subtitle bar.mp4",
    // Ordinary names with no intent in them at all.
    "IMG_4821.MOV",
    "VID20260909_120000.mp4",
    "Snapchat-1234567890.mp4",
    "final cut v3 FINAL final.mp4",
    "",
    // Words that appear in the rules, in innocent combinations.
    "credit card ad cut.mp4",
    "teen dance cover.mp4",
    "kids birthday party.mp4",
    "child of mine first steps.mp4",
    "my nude lipstick review.mp4",
    "stripping wallpaper timelapse.mp4",
    "repost of my own tiktok.mp4",
    "reupload my video in hd.mp4",
    "copyright free music video.mp4",
    "removing the green screen.mp4",
    "id card design mockup.mp4",
  ];

  for (const name of ordinary) {
    it(`allows ${JSON.stringify(name)}`, () => {
      expect(screenAiText(name)).toEqual({ allowed: true });
    });
  }

  /*
    🔴 The two real link platforms, with real-shaped paths. A URL carries a lot
    of incidental text and it must not trip a rule on its own.
  */
  it("allows an ordinary pasted link", () => {
    expect(
      screenAiJob({
        sourceKind: "url",
        sourceUrl: "https://www.tiktok.com/@creator/video/7123456789012345678",
        sourceName: null,
      }),
    ).toEqual({ allowed: true });
    expect(
      screenAiJob({
        sourceKind: "url",
        sourceUrl: "https://www.instagram.com/reel/CxYzAbCdEfG/",
        sourceName: null,
      }),
    ).toEqual({ allowed: true });
  });
});

/* ── What is actually refused ─────────────────────────────────────────────── */

describe("a stated prohibited purpose is refused", () => {
  const cases: [string, string][] = [
    ["remove watermark for repost.mp4", "attribution_repost"],
    ["remove-the-watermark-so-i-can-reupload-it.mp4", "attribution_repost"],
    ["strip credits and claim as mine.mp4", "attribution_repost"],
    ["delete attribution then steal.mp4", "attribution_repost"],
    ["repost without credit.mp4", "attribution_repost"],
    ["bypass drm.mp4", "drm_circumvention"],
    ["crack the copy protection.mp4", "drm_circumvention"],
    ["bypass content id.mp4", "platform_bypass"],
    ["get around the copyright filter.mp4", "platform_bypass"],
    ["remove the security hologram.mp4", "security_marking"],
    ["remove the health warning.mp4", "required_label"],
    ["hide the sponsored disclosure.mp4", "required_label"],
    ["leaked onlyfans.mp4", "stolen_content"],
    ["stolen footage.mp4", "stolen_content"],
    ["revenge porn.mp4", "nonconsensual_intimate"],
    ["upskirt.mp4", "nonconsensual_intimate"],
    ["nudify her photo.mp4", "sexual_explicit"],
    ["deepnude.mp4", "sexual_explicit"],
    ["deepfake porn.mp4", "sexual_explicit"],
    ["remove her clothes from this picture.mp4", "sexual_explicit"],
    ["forge a passport.mp4", "identity_fraud"],
    ["impersonate a police officer.mp4", "identity_fraud"],
  ];

  for (const [name, reason] of cases) {
    it(`refuses ${JSON.stringify(name)} as ${reason}`, () => {
      expect(screenAiText(name)).toEqual({ allowed: false, reason });
    });
  }

  /*
    🔴 CSAM, in both word orders and as a single term. This is the one rule
    where a false negative is not a support ticket, so it is deliberately
    broader than the others and tested from every direction.
  */
  it("refuses sexual content involving minors however it is phrased", () => {
    for (const text of [
      "child porn.mp4",
      "underage nude.mp4",
      "nude minor.mp4",
      "porn teen.mp4",
      "csam.mp4",
      "cp.mp4",
      "sexualised child.mp4",
    ]) {
      expect(screenAiText(text), text).toEqual({ allowed: false, reason: "sexual_minor" });
    }
  });
});

/* ── The normalisation, which is what makes the rules hold ────────────────── */

describe("separators cannot defeat a rule", () => {
  /*
    🔴 Filenames are full of separators, so this is the ORDINARY form of these
    strings rather than an evasion. A rule that only matched spaces would be
    matched by almost nothing real.
  */
  it("reads hyphens, underscores and dots as spaces", () => {
    expect(screenAiText("remove_watermark_for_repost.mp4").allowed).toBe(false);
    expect(screenAiText("remove-watermark-for-repost.mp4").allowed).toBe(false);
    expect(screenAiText("remove.watermark.for.repost.mp4").allowed).toBe(false);
  });

  it("reads camelCase word boundaries", () => {
    expect(screenAiText("removeWatermarkForRepost.mp4").allowed).toBe(false);
  });

  it("decodes percent-escapes from a url", () => {
    expect(screenAiText("https://x.test/remove%20watermark%20for%20repost").allowed).toBe(false);
  });

  it("survives a malformed percent-escape rather than throwing", () => {
    expect(() => screenAiText("100%-done-remove-watermark-for-repost.mp4")).not.toThrow();
    expect(screenAiText("100%-done-remove-watermark-for-repost.mp4").allowed).toBe(false);
  });
});

describe("intent split across two fields is still seen", () => {
  /*
    A neutral filename under a link whose path carries the rest. Screening the
    fields separately would miss it; joining them before matching is the whole
    reason `screenAiJob` exists.
  */
  it("joins the filename and the url before matching", () => {
    expect(
      screenAiJob({
        sourceKind: "url",
        sourceName: "remove watermark",
        sourceUrl: "https://example.test/so-i-can-repost-it",
      }).allowed,
    ).toBe(false);
  });
});

/* ── What leaves the server ───────────────────────────────────────────────── */

describe("the refusal says nothing about the rule that fired", () => {
  /*
    🔴 ONE sentence for every reason. A per-reason message would be a readout of
    which rule matched — telling anybody probing the system exactly which word
    to change — and it would turn a refusal into an accusation.
  */
  it("is a single generic message", () => {
    expect(AI_POLICY_MESSAGE).toBe(
      "This request can't be processed. Please make sure you have the rights or permission to edit this media.",
    );
  });

  it("does not accuse, and names no rule", () => {
    const lower = AI_POLICY_MESSAGE.toLowerCase();
    for (const word of ["illegal", "violation", "prohibited", "banned", "abuse", "porn", "drm", "watermark"]) {
      expect(lower, word).not.toContain(word);
    }
  });
});

describe("policyBlockEvent keeps no personal information", () => {
  /*
    🔴 The text that triggered a block is the most sensitive string in the
    request and answers no operational question. What is kept is the reason, a
    timestamp, and a prefix of an already-pseudonymous key — enough to see one
    account hitting one rule repeatedly, not enough to re-identify anybody.
  */
  it("carries the reason and a truncated subject, and nothing else", () => {
    const event = policyBlockEvent("attribution_repost", "guest_01HXYZABCDEFGH");
    expect(Object.keys(event).sort()).toEqual(["at", "event", "reason", "subject"]);
    expect(event.subject).toBe("guest_01");
    expect(event.subject.length).toBeLessThanOrEqual(8);
  });

  it("never carries the text that was screened", () => {
    const event = policyBlockEvent("stolen_content", "user_abcdef123456");
    expect(JSON.stringify(event)).not.toContain("leaked");
  });
});

describe("the wire code and the copy cannot drift apart", () => {
  /*
    🔴 `lib/ai/errors.ts` writes this sentence out rather than importing it, so
    that module stays dependency-free. This test is what holds the two
    together — without it, editing one and not the other would ship a refusal
    whose API body and whose interface copy disagree, and nothing would fail.
  */
  it("POLICY_BLOCKED answers with exactly AI_POLICY_MESSAGE", async () => {
    const { AI_ERRORS } = await import("@/lib/ai/errors");
    expect(AI_ERRORS.POLICY_BLOCKED.message).toBe(AI_POLICY_MESSAGE);
  });

  /*
    422, not 403. A 403 says "you may not use this tool" — which is false, and
    is the accusation the brief rules out. The member's access and allowance are
    both intact; this request cannot be acted on as described.
  */
  it("answers 422 rather than forbidding the member", async () => {
    const { AI_ERRORS } = await import("@/lib/ai/errors");
    expect(AI_ERRORS.POLICY_BLOCKED.status).toBe(422);
  });
});

describe("the rights notice is stated once", () => {
  it("says all three things the brief asked for", () => {
    expect(AI_RIGHTS_NOTICE).toContain("own or have permission to edit");
    expect(AI_RIGHTS_NOTICE).toContain("infringe copyright");
    expect(AI_RIGHTS_NOTICE).toContain("rights-management information");
    expect(AI_RIGHTS_NOTICE).toContain("bypass platform restrictions");
  });
});
