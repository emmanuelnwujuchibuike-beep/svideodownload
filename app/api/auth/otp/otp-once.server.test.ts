import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Owner, 2026-10-19: "see why login otp emails send twice". A double submit must send ONE email and mint ONE
 * code (a second code would invalidate the first one the member is typing). Through the real route.
 */
const sent: string[] = [];
let generated = 0;
vi.mock("server-only", () => ({}));
vi.mock("@/lib/email/resend", () => ({ hasResend: true, sendOtpEmail: async (to: string) => (sent.push(to), true) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ auth: { admin: { generateLink: async () => ({ data: { properties: { email_otp: `12345${++generated}` } }, error: null }) } } }),
}));

beforeEach(() => {
  sent.length = 0;
  generated = 0;
  vi.resetModules();
});

const post = async (email: string) => {
  const { POST } = await import("./route");
  return POST(new Request("http://t/api/auth/otp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) }));
};

describe("sign-in codes", () => {
  it("two requests for the same email in a row send one email and mint one code", async () => {
    const [a, b] = await Promise.all([post("ada@example.com"), post("ada@example.com")]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(sent).toEqual(["ada@example.com"]);
    expect(generated).toBe(1);
  });

  it("another email is not held back", async () => {
    await post("ada@example.com");
    await post("bo@example.com");
    expect(sent).toEqual(["ada@example.com", "bo@example.com"]);
  });
});
