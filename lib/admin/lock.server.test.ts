import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The admin dashboard lock (0301) on the app side. The database half is supabase/tests/0301_admin_lock.pglite.mjs
 * (75 checks, 6 mutants). Here: getAdminUser / requireAdminApi hold a signed-in admin until this browser is unlocked
 * (and fail closed on any error), no plaintext secret ever reaches the database, the cookie is HttpOnly + Strict, and
 * every admin page is behind requireAdminPage.
 */

type Rpc = (name: string, args: Record<string, unknown>) => { data: unknown; error: unknown };
let rpcImpl: Rpc;
const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
let authUser: { id: string; email: string } | null;
let role: string | null;
const jar = new Map<string, { value: string; opts?: Record<string, unknown> }>();

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { value: jar.get(n)!.value } : undefined),
    set: (n: string, value: string, opts?: Record<string, unknown>) => void jar.set(n, { value, opts }),
    delete: (n: string) => void jar.delete(n),
  }),
}));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return rpcImpl(name, args);
    },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: authUser }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: role ? { role, is_admin: role === "admin" } : null }) }) }) }),
  }),
}));

const SESSION = "11111111-1111-4111-8111-111111111111";
const TOKEN = "A".repeat(43);
const PEPPER = "p".repeat(40);

beforeEach(() => {
  rpcCalls.length = 0;
  jar.clear();
  authUser = { id: "admin-1", email: "a@t.test" };
  role = "admin";
  process.env.ADMIN_LOCK_PEPPER = PEPPER;
  rpcImpl = () => ({ data: null, error: null });
});

const gate = await import("@/lib/admin/require-admin");
const lock = await import("@/lib/admin/lock");

describe("the gate", () => {
  it("an unlocked browser is an administrator", async () => {
    jar.set("frenz_admin_lock", { value: `${SESSION}.${TOKEN}` });
    rpcImpl = (name) => ({ data: name === "admin_lock_session_stage" ? "unlocked" : null, error: null });
    expect((await gate.getAdminUser())?.id).toBe("admin-1");
  });

  it("a signed-in admin at the PIN step is not an administrator yet, and the API answers 423", async () => {
    jar.set("frenz_admin_lock", { value: `${SESSION}.${TOKEN}` });
    rpcImpl = () => ({ data: "password", error: null });
    expect(await gate.getAdminUser()).toBeNull();
    const api = await gate.requireAdminApi();
    expect(api.ok).toBe(false);
    if (!api.ok) expect(api.response.status).toBe(423);
  });

  it("no cookie, or a database error, is locked (fail closed)", async () => {
    expect(await gate.getAdminUser()).toBeNull();
    jar.set("frenz_admin_lock", { value: `${SESSION}.${TOKEN}` });
    rpcImpl = () => ({ data: null, error: { message: "function admin_lock_session_stage does not exist" } });
    expect(await gate.getAdminUser()).toBeNull();
  });

  it("no pepper: nothing unlocks, whatever the database says", async () => {
    delete process.env.ADMIN_LOCK_PEPPER;
    const coin = process.env.FRENZ_COIN_PIN_PEPPER;
    delete process.env.FRENZ_COIN_PIN_PEPPER;
    jar.set("frenz_admin_lock", { value: `${SESSION}.${TOKEN}` });
    rpcImpl = () => ({ data: "unlocked", error: null });
    expect(await gate.getAdminUser()).toBeNull();
    if (coin) process.env.FRENZ_COIN_PIN_PEPPER = coin;
  });

  it("a non-admin gets 404 and the lock is never consulted", async () => {
    role = "member";
    const api = await gate.requireAdminApi();
    expect(api.ok).toBe(false);
    if (!api.ok) expect(api.response.status).toBe(404);
    expect(rpcCalls).toHaveLength(0);
  });

  it("a locked admin's page goes to the lock screen with the destination kept", async () => {
    rpcImpl = () => ({ data: null, error: null });
    await expect(gate.requireAdminPage("/admin")).rejects.toThrow("REDIRECT:/admin/unlock?next=%2Fadmin");
  });
});

describe("the lock module", () => {
  const begun = { ok: true, attempt_id: "att-1", params: { algorithm: "scrypt", N: 1024, r: 8, p: 1, keylen: 32, pepper: "v1" }, password_salt: "00".repeat(16), pin_salt: "11".repeat(16), prev_password_salt: null };

  it("the password step sends only derived keys and token hashes, and sets an HttpOnly, Strict cookie", async () => {
    // a dummy phrase built at run time (a literal assigned to `password` trips secret scanners — GitGuardian, 2026-10-28)
    const typed = ["correct", "horse", "battery", "staple"].join(" ");
    rpcImpl = (name) => ({ data: name === "admin_lock_begin" ? begun : { ok: true, session_id: SESSION }, error: null });
    expect((await lock.checkDashboardPassword("admin-1", typed)).ok).toBe(true);
    expect(JSON.stringify(rpcCalls)).not.toContain(typed);
    const c = jar.get("frenz_admin_lock");
    expect(c?.value.startsWith(`${SESSION}.`)).toBe(true);
    expect(c?.opts).toMatchObject({ httpOnly: true, sameSite: "strict" });
    // the token in the cookie is never sent: only its HMAC
    expect(JSON.stringify(rpcCalls)).not.toContain(c!.value.split(".")[1]!);
  });

  it("a wrong password sets no cookie", async () => {
    rpcImpl = (name) => ({ data: name === "admin_lock_begin" ? begun : { ok: false }, error: null });
    expect((await lock.checkDashboardPassword("admin-1", "wrong wrong wrong")).ok).toBe(false);
    expect(jar.has("frenz_admin_lock")).toBe(false);
  });

  it("the password key and the PIN key differ for the same secret (labelled derivations)", async () => {
    rpcImpl = (name) => ({ data: name === "admin_lock_begin" ? { ...begun, password_salt: "22".repeat(16), pin_salt: "22".repeat(16) } : { ok: true, session_id: SESSION }, error: null });
    await lock.checkDashboardPassword("admin-1", "135792");
    const pwKey = rpcCalls.find((c) => c.name === "admin_lock_check_password")!.args.p_key;
    rpcCalls.length = 0;
    await lock.checkDashboardPin("admin-1", "135792");
    const pinKey = rpcCalls.find((c) => c.name === "admin_lock_check_pin")!.args.p_key;
    expect(pwKey).toBeTruthy();
    expect(pinKey).toBeTruthy();
    expect(pwKey).not.toBe(pinKey);
  });

  it("funding without this browser's lock cookie never reaches the database", async () => {
    const r = await lock.fundCoinWallet("admin-1", { pin: "135792", accountNumber: "1234567890", amountCents: 500, reason: "Launch bonus", reference: "adm_0123456789abcdef" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("locked");
    expect(rpcCalls).toHaveLength(0);
  });

  it("the dashboard password follows the admin password policy", () => {
    expect(lock.passwordProblem("short")).not.toBeNull();
    expect(lock.passwordProblem("passwordpassword")).not.toBeNull();
    expect(lock.passwordProblem("correct horse battery staple")).toBeNull();
  });
});

/** Every admin page under app/admin is behind requireAdminPage, except the sign-in pages and the lock's own. */
const OPEN = /^app\/admin\/(login|forgot-password|reset-password|unlock)(\/|$)/;
function pagesMissingGate(files: { path: string; src: string }[]): string[] {
  return files.filter((f) => !OPEN.test(f.path) && !f.src.includes("requireAdminPage(")).map((f) => f.path);
}

describe("every admin page is locked", () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : n === "page.tsx" ? [p] : []; });
  it("app/admin pages call requireAdminPage", () => {
    const files = walk("app/admin").map((p) => ({ path: p.replace(/\\/g, "/"), src: readFileSync(p, "utf8") }));
    expect(files.length).toBeGreaterThan(3);
    expect(pagesMissingGate(files)).toEqual([]);
  });
  it("teeth: a page that only checks the role is caught", () => {
    expect(pagesMissingGate([{ path: "app/admin/new-tool/page.tsx", src: "if (!isAdmin(profile?.role, user.email)) redirect('/')" }])).toEqual(["app/admin/new-tool/page.tsx"]);
  });
});
