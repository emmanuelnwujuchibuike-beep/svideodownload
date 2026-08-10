import { describe, expect, it } from "vitest";

import { adsenseRecord, buildAdsTxt, GOOGLE_ADS_TXT_CERT, normalisePublisherId } from "./ads-txt";

/**
 * ads.txt must survive a bad second (owner, 2026-08-10).
 *
 * AdSense reported "Not found" for a saved setting while the live file returned
 * 200 text/plain on every manual check. The cause was that the route read
 * settings through a helper that swallows failures and returns defaults, then
 * treated the resulting empty string as "not configured" and answered 404 — an
 * authoritative verdict a crawler keeps for days, produced by a transient
 * database error nobody could see afterwards.
 *
 * The fix has two halves and this file pins both: the record is DERIVED from
 * the publisher id rather than depending on a pasted string, and the route
 * distinguishes "unconfigured" from "unreadable". These tests cover the first;
 * the second is asserted in the route itself.
 */

describe("publisher id normalisation", () => {
  it("accepts both forms AdSense shows", () => {
    // The script tag needs ca-pub-…, ads.txt needs pub-…. Pasting the wrong one
    // into the wrong box is the classic silent failure in this whole flow.
    expect(normalisePublisherId("pub-6455244673998965")).toBe("pub-6455244673998965");
    expect(normalisePublisherId("ca-pub-6455244673998965")).toBe("pub-6455244673998965");
    expect(normalisePublisherId("  CA-PUB-6455244673998965  ")).toBe("pub-6455244673998965");
  });

  it("rejects anything that is not a publisher id", () => {
    for (const bad of ["", "   ", "pub-", "pub-123", "ca-pub-abcdefghij", "6455244673998965", null, undefined]) {
      expect(normalisePublisherId(bad), `accepted ${JSON.stringify(bad)}`).toBeNull();
    }
  });
});

describe("the derived AdSense record", () => {
  it("is the exact line Google expects", () => {
    expect(adsenseRecord("ca-pub-6455244673998965")).toBe(
      `google.com, pub-6455244673998965, DIRECT, ${GOOGLE_ADS_TXT_CERT}`,
    );
  });

  it("uses Google's published certification id", () => {
    // A constant of theirs, identical for every AdSense publisher — which is
    // exactly why the record can be derived rather than pasted.
    expect(GOOGLE_ADS_TXT_CERT).toBe("f08c47fec0942fa0");
  });

  it("is null without a publisher id", () => {
    expect(adsenseRecord("")).toBeNull();
  });
});

describe("buildAdsTxt", () => {
  it("serves the AdSense record even when the text box is empty", () => {
    // The whole point: the file cannot be missing while AdSense is configured.
    expect(buildAdsTxt({ adsTxt: "", adsensePublisherId: "ca-pub-6455244673998965" })).toBe(
      `google.com, pub-6455244673998965, DIRECT, ${GOOGLE_ADS_TXT_CERT}`,
    );
  });

  it("keeps the operator's own file first and appends what is missing", () => {
    const manual = "# my networks\nadsterra.com, 12345, DIRECT";
    const out = buildAdsTxt({ adsTxt: manual, adsensePublisherId: "ca-pub-6455244673998965" });
    expect(out.startsWith(manual)).toBe(true);
    expect(out).toContain("google.com, pub-6455244673998965, DIRECT");
  });

  it("does not duplicate a publisher the operator already declared", () => {
    for (const existing of [
      "google.com, pub-6455244673998965, DIRECT, f08c47fec0942fa0",
      "GOOGLE.COM,   ca-pub-6455244673998965 , DIRECT, f08c47fec0942fa0",
      "google.com, pub-6455244673998965, DIRECT, f08c47fec0942fa0  # main account",
    ]) {
      const out = buildAdsTxt({ adsTxt: existing, adsensePublisherId: "ca-pub-6455244673998965" });
      expect(out, `duplicated for: ${existing}`).toBe(existing.trim());
    }
  });

  it("ignores a commented-out record when deciding what is declared", () => {
    // A line behind `#` authorises nobody, so the real record must still be added.
    const out = buildAdsTxt({
      adsTxt: "# google.com, pub-6455244673998965, DIRECT, f08c47fec0942fa0",
      adsensePublisherId: "ca-pub-6455244673998965",
    });
    expect(out.split("\n").filter((l) => !l.trim().startsWith("#"))).toContain(
      `google.com, pub-6455244673998965, DIRECT, ${GOOGLE_ADS_TXT_CERT}`,
    );
  });

  it("does not treat a DIFFERENT google publisher as ours", () => {
    const other = "google.com, pub-1111111111111111, DIRECT, f08c47fec0942fa0";
    const out = buildAdsTxt({ adsTxt: other, adsensePublisherId: "ca-pub-6455244673998965" });
    expect(out).toContain("pub-1111111111111111");
    expect(out).toContain("pub-6455244673998965");
  });

  it("returns empty only when genuinely nothing is configured", () => {
    // This is the ONE state that may legitimately 404. An empty ads.txt served
    // with 200 tells every network that no seller is authorised.
    expect(buildAdsTxt({ adsTxt: "", adsensePublisherId: "" })).toBe("");
    expect(buildAdsTxt({})).toBe("");
  });
});
