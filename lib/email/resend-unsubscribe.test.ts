import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Part 11 — the real Resend adapter with fetch mocked (no request leaves the test): an optional
 * email carries the footer link and the RFC 8058 one-click headers; a transactional one carries
 * neither; and nothing off this site is ever put in as an unsubscribe link.
 */

process.env.RESEND_API_KEY = "re_test_key_never_sent";
const calls: { url: string; body: Record<string, unknown> }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
  calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
  return new Response("{}", { status: 200 });
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

const { sendProductEmail } = await import("./resend");
const { SITE_URL } = await import("@/lib/site");

beforeEach(() => {
  calls.length = 0;
});

const base = { subject: "Amaka posted", heading: "Amaka posted", intro: "Open their tab." };
const link = `${SITE_URL}/api/email/unsubscribe?t=${"A".repeat(43)}`;

describe("the unsubscribe link and headers", () => {
  it("optional: footer link, plain-text line and the one-click headers", async () => {
    await sendProductEmail("a@example.com", { ...base, unsubscribeUrl: link });
    const b = calls[0]!.body;
    expect(b.headers).toEqual({ "List-Unsubscribe": `<${link}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    expect(String(b.html)).toContain(`href="${link}"`);
    expect(String(b.text)).toContain(`Unsubscribe from optional emails: ${link}`);
  });

  it("transactional: no link, no headers", async () => {
    await sendProductEmail("a@example.com", base);
    const b = calls[0]!.body;
    expect(b.headers).toBeUndefined();
    expect(String(b.html)).not.toContain("Unsubscribe");
  });

  it("an off-site or malformed URL is dropped, never rendered", async () => {
    for (const bad of ["https://evil.example/unsub", `${SITE_URL}/x" onclick="steal()`, "javascript:alert(1)"]) {
      calls.length = 0;
      await sendProductEmail("a@example.com", { ...base, unsubscribeUrl: bad });
      expect(calls[0]!.body.headers, bad).toBeUndefined();
      expect(String(calls[0]!.body.html), bad).not.toContain("Unsubscribe");
    }
  });
});
