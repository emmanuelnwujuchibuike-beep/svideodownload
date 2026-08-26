import { describe, expect, it } from "vitest";

import { defaultHrefFor, hrefForNotification, safeInternalHref } from "./destinations";
import { NOTIFICATIONS } from "@/lib/platform/notifications-registry";

/**
 * "Every notification opens the page it is about" (owner, 2026-08-26) is only
 * true if it holds for EVERY declared type — including the ones added after
 * this file was written. These walk the registry rather than a hand-written
 * list, so a new type with no destination fails here instead of shipping as a
 * card nobody can tap.
 */
describe("every registered notification type has a destination", () => {
  it.each(NOTIFICATIONS.map((n) => [n.id, n.category] as const))(
    "%s (%s) resolves to a real in-app path",
    (id) => {
      const href = defaultHrefFor(id);
      expect(href, `${id} has no destination`).toBeTruthy();
      expect(href.startsWith("/"), `${id} resolved to ${href}, which is not an in-app path`).toBe(true);
    },
  );

  it("🔴 security notifications land somewhere the account can actually be changed", () => {
    // The owner's specific ask: "so when any security notification come it can
    // be clickable to open the exact page to see the full details to know if is
    // to make any security changes". /notifications is not that page.
    const security = NOTIFICATIONS.filter((n) => n.category === "security");
    expect(security.length).toBeGreaterThan(0);
    for (const n of security) {
      expect(defaultHrefFor(n.id), `${n.id} dead-ends`).toMatch(/^\/account\/(security|devices|password)$/);
    }
  });

  it("an unknown type still resolves rather than returning null", () => {
    expect(defaultHrefFor("something_added_later")).toBe("/notifications");
  });
});

describe("safeInternalHref", () => {
  it("keeps an in-app path", () => {
    expect(safeInternalHref("/account/devices")).toBe("/account/devices");
    expect(safeInternalHref("/p/abc?x=1")).toBe("/p/abc?x=1");
  });

  it("reduces a same-origin absolute url to its path", () => {
    // Every admin alert sends `${SITE_URL}/admin` — the push needs an absolute
    // url, the in-app link must not be one or Next does a full page load.
    expect(safeInternalHref("https://frenzsave.com/admin")).toBe("/admin");
    expect(safeInternalHref("https://frenzsave.com/admin?tab=downloads")).toBe("/admin?tab=downloads");
  });

  it("🔴 refuses anything off-origin — this value comes from a push payload", () => {
    expect(safeInternalHref("https://evil.example/steal")).toBeNull();
    // Protocol-relative: looks like a path, is not one.
    expect(safeInternalHref("//evil.example/steal")).toBeNull();
    expect(safeInternalHref("javascript:alert(1)")).toBeNull();
    expect(safeInternalHref("")).toBeNull();
    expect(safeInternalHref(null)).toBeNull();
    expect(safeInternalHref(42)).toBeNull();
  });
});

describe("hrefForNotification", () => {
  it("prefers the notification's own url", () => {
    expect(hrefForNotification("security_login", "/account/devices?id=7")).toBe("/account/devices?id=7");
  });

  it("falls back to the type's destination when the url is unusable", () => {
    expect(hrefForNotification("security_login", "https://evil.example")).toBe("/account/devices");
    expect(hrefForNotification("security_login", undefined)).toBe("/account/devices");
    expect(hrefForNotification("payment_successful", null)).toBe("/account/plan");
  });
});
