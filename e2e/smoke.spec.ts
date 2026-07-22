import { expect, test } from "@playwright/test";

/**
 * Critical-journey smoke tests. Each is resilient to a missing database so it can
 * run in CI without secrets — see playwright.config.ts. If one of these fails, a
 * core surface is broken in a way no unit test can see (a real browser, a real
 * request), which is exactly the gap E2E fills.
 */

test.describe("critical journeys — smoke", () => {
  // `domcontentloaded`, not the default `load`: a smoke test proves the page's own
  // HTML renders, and must not hang on third-party subresources (ads/analytics) or,
  // in dev, on data fetches that time out when the database is unreachable.
  test("landing page renders with the brand and a download entry point", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle(/frenz|download/i);
    // The whole product's front door is "download a video" — that word must be here.
    await expect(page.locator("body")).toContainText(/download/i);
  });

  test("login page renders a sign-in surface", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toContainText(/sign in|log in|continue|email/i);
  });

  test("downloads workspace renders", async ({ page }) => {
    await page.goto("/downloads", { waitUntil: "domcontentloaded" });
    // A URL input or the word "download" — the tool's primary affordance.
    await expect(page.locator("body")).toContainText(/download|paste|url|link/i);
  });

  test("health endpoint responds", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBeTruthy();
  });

  test("public flags endpoint returns the flags envelope", async ({ request }) => {
    const res = await request.get("/api/flags");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty("flags");
  });
});
