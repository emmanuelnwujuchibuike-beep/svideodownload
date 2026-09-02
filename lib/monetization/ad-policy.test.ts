import { describe, expect, it } from "vitest";

import { adPolicyFor, allowsGoogleAds, allowsGoogleAdsInZone } from "@/lib/monetization/ad-policy";

describe("adPolicyFor — pages that must NEVER carry Google ads", () => {
  /*
    The list that matters. Every one of these carried the AdSense loader before
    this table existed, because the loader lived in the ROOT layout and Auto ads
    place themselves.
  */
  it.each([
    "/login",
    "/login/mfa-challenge",
    "/signup",
    "/welcome",
    "/admin",
    "/admin/content",
    "/admin/login",
    "/account",
    "/account/analytics",
    "/account/security",
    "/account/identity/name",
    "/studio",
    "/studio/content",
    "/studio/content/abc-123",
    "/messages",
    "/messages/42",
    "/create/reel",
    "/downloads",
    "/saved",
    "/library",
    "/history",
    "/friends/circles",
    "/notifications",
    "/search",
  ])("%s is NO_AD_CONTENT", (path) => {
    expect(adPolicyFor(path)).toBe("NO_AD_CONTENT");
    expect(allowsGoogleAds(path)).toBe(false);
  });
});

describe("adPolicyFor — publisher content", () => {
  it.each([
    "/",
    "/about",
    "/contact",
    "/privacy",
    "/terms",
    "/dmca",
    "/trust",
    "/trust/security",
    "/help",
    "/help/how-to-save-a-reel",
    "/blog",
    "/blog/some-article",
    "/learn",
    "/learn/lesson-one",
    "/academy",
    "/academy/creator",
    "/glossary",
    "/topics",
    "/topics/tiktok",
    "/features",
  ])("%s is AD_SAFE_CONTENT", (path) => {
    expect(adPolicyFor(path)).toBe("AD_SAFE_CONTENT");
    expect(allowsGoogleAds(path)).toBe(true);
  });

  it("treats a platform downloader page as content", () => {
    expect(adPolicyFor("/tiktok-downloader")).toBe("AD_SAFE_CONTENT");
    expect(adPolicyFor("/instagram-downloader")).toBe("AD_SAFE_CONTENT");
  });

  it("treats a dated downloader article as content", () => {
    expect(adPolicyFor("/tiktok-downloader/2026/09/how-to-save-a-reel")).toBe("AD_SAFE_CONTENT");
  });
});

describe("adPolicyFor — user-generated pages are LIMITED", () => {
  it.each(["/feed", "/explore", "/reels", "/home", "/u/ada", "/p/abc123", "/sounds", "/sound/x1", "/wallpapers", "/profile", "/pricing"])(
    "%s is LIMITED_AD_CONTENT",
    (path) => {
      expect(adPolicyFor(path)).toBe("LIMITED_AD_CONTENT");
      // Limited still means Google's inventory does not run.
      expect(allowsGoogleAds(path)).toBe(false);
    },
  );
});

describe("the matcher itself", () => {
  it("🔴 fails CLOSED on an unknown path", () => {
    // A route added tomorrow gets no ads until somebody decides it should.
    // The failure mode of the other default is a policy violation.
    expect(adPolicyFor("/some/deep/unknown/thing")).toBe("NO_AD_CONTENT");
    expect(adPolicyFor("/UPPERCASE_Thing")).toBe("NO_AD_CONTENT");
  });

  it("does not let a prefix swallow a longer word", () => {
    // `/downloads` must not capture a future article, and `/p/` must not
    // capture `/pricing`.
    expect(adPolicyFor("/downloads-explained")).toBe("AD_SAFE_CONTENT");
    expect(adPolicyFor("/pricing")).toBe("LIMITED_AD_CONTENT");
  });

  it("ignores the query string and a trailing slash", () => {
    expect(adPolicyFor("/account/security?tab=2")).toBe("NO_AD_CONTENT");
    expect(adPolicyFor("/blog/")).toBe("AD_SAFE_CONTENT");
    expect(adPolicyFor("/admin/")).toBe("NO_AD_CONTENT");
  });

  it("is case-insensitive on the private prefixes", () => {
    expect(adPolicyFor("/Admin")).toBe("NO_AD_CONTENT");
    expect(adPolicyFor("/ACCOUNT/security")).toBe("NO_AD_CONTENT");
  });

  it("handles an empty or malformed path without throwing", () => {
    expect(adPolicyFor("")).toBe("AD_SAFE_CONTENT"); // normalises to "/"
    expect(() => adPolicyFor("///")).not.toThrow();
  });

  it("🔴 never returns AD_SAFE for anything under a private prefix", () => {
    // The property that actually matters, stated as a property.
    const privateRoots = ["/admin", "/account", "/studio", "/messages", "/login", "/create", "/downloads"];
    for (const root of privateRoots) {
      for (const suffix of ["", "/", "/deep", "/deep/deeper?x=1"]) {
        expect(allowsGoogleAds(`${root}${suffix}`), `${root}${suffix}`).toBe(false);
      }
    }
  });
});

describe("🔴 action-adjacent zones never carry Google's inventory", () => {
  /*
    Owner, 2026-09-02: "tak the download result ad slot up where users can see
    when the download is preparing." That is a good placement for a house or
    network banner — the visitor is waiting, not acting — and the wrong one for
    AdSense, which must never sit where it could be taken for the Download
    button.

    Attached to the ZONE rather than the page: position is a property of the
    placement, not of the URL, so moving the slot around the card later cannot
    quietly re-open it.
  */
  it.each(["download_result_page", "under_download", "result_top"])(
    "%s refuses Google even on a publisher-content page",
    (zone) => {
      // `/` is AD_SAFE_CONTENT — the page is fine, the position is not.
      expect(allowsGoogleAds("/")).toBe(true);
      expect(allowsGoogleAdsInZone("/", zone)).toBe(false);
    },
  );

  it("still allows Google in an ordinary zone on a content page", () => {
    expect(allowsGoogleAdsInZone("/", "landing_section_break")).toBe(true);
    expect(allowsGoogleAdsInZone("/blog/post", "history")).toBe(true);
  });

  it("still refuses every zone on a private page", () => {
    expect(allowsGoogleAdsInZone("/account/security", "landing_section_break")).toBe(false);
    expect(allowsGoogleAdsInZone("/studio", "history")).toBe(false);
  });
});
