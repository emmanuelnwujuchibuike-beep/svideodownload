import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// owner, 2026-10-24: "users should be able to pay for verification not being eligible … remove every eligibility"
const files = ["app/api/verification/route.ts", "app/(app)/account/verification/page.tsx", "features/account/verification-flow.tsx", "lib/social/verification-shared.ts"];

describe("verification has no eligibility gate", () => {
  for (const f of files) {
    it(`${f}: no checklist, no "Not eligible" refusal`, () => {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/checkEligibility|EligibilityStep|Not (yet )?eligible|MIN_FOLLOWERS|MIN_ACCOUNT_AGE_DAYS/);
    });
  }
  // design/frenz-verification.html (owner, 2026-10-28): intro, who you are, selfie, review, payment — and NO ID step
  it("the flow is the design's, without the ID document step", () => {
    const flow = readFileSync("features/account/verification-flow.tsx", "utf8");
    expect(flow).toContain('const STEPS = ["Identity", "Selfie", "Review", "Payment"] as const;');
    expect(flow).toContain("useState<Step>(0)");
    expect(flow).not.toMatch(/Photo of your ID|idFrontPath|id_front_path|DocumentUpload/);
    const api = readFileSync("app/api/verification/route.ts", "utf8");
    expect(api).not.toMatch(/idFrontPath|Upload the front of your document/);
  });
});
