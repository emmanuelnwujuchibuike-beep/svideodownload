import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => void jar.set(n, v),
    delete: (n: string) => void jar.delete(n),
  }),
}));

const { checkPasswordCode, clearPasswordCode, issuePasswordCode, maskEmail, passwordChangeNeedsCode, signInMethod } = await import("./password-code");

const token = (amr: unknown) => `h.${Buffer.from(JSON.stringify({ amr })).toString("base64url")}.s`;

describe("password change by emailed code (owner, 2026-10-23)", () => {
  beforeEach(() => {
    jar.clear();
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-secret";
  });

  it("the emailed code works once, for that user and that purpose only", async () => {
    const code = (await issuePasswordCode("u1", "member"))!;
    expect(code).toMatch(/^\d{6}$/);
    expect(await checkPasswordCode("u1", code, "member")).toBe(true);
    // teeth: a wrong code, another user, or the admin purpose all fail
    expect(await checkPasswordCode("u1", code === "000000" ? "000001" : "000000", "member")).toBe(false);
    expect(await checkPasswordCode("u2", code, "member")).toBe(false);
    expect(await checkPasswordCode("u1", code, "admin")).toBe(false);
    await clearPasswordCode("member");
    expect(await checkPasswordCode("u1", code, "member")).toBe(false);
  });

  it("fails closed with no secret", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.ADMIN_REAUTH_SECRET;
    expect(await issuePasswordCode("u1", "admin")).toBeNull();
    expect(await checkPasswordCode("u1", "123456", "admin")).toBe(false);
  });

  it("a session opened with a password needs the code; one opened with an email code does not", () => {
    expect(signInMethod(token([{ method: "otp", timestamp: 1 }, { method: "password", timestamp: 2 }]))).toBe("password");
    expect(signInMethod(token([{ method: "password", timestamp: 1 }, { method: "otp", timestamp: 2 }]))).toBe("otp");
    expect(passwordChangeNeedsCode("password")).toBe(true);
    expect(passwordChangeNeedsCode("otp")).toBe(false);
    // teeth: an unreadable token fails closed
    expect(passwordChangeNeedsCode(signInMethod("garbage"))).toBe(true);
    expect(passwordChangeNeedsCode(signInMethod(null))).toBe(true);
  });

  it("shows enough of the address to recognise it", () => {
    expect(maskEmail("emmanuel@gmail.com")).toBe("e•••l@gmail.com");
  });

  it("the member editor saves through the server route, never straight to Supabase", () => {
    const editor = readFileSync("features/account/password-editor.tsx", "utf8");
    expect(editor).toContain('fetch("/api/v1/app/security/password"');
    expect(editor).not.toContain("auth.updateUser(");
    expect(readFileSync("features/admin/reauth-prompt.tsx", "utf8")).toContain("/api/admin/auth/password-code/verify");
  });
});
