import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  MIN_ADMIN_PASSWORD_LENGTH,
  validateAdminPassword,
} from "./password-policy";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ADMIN AUTHENTICATION — the properties that must not silently regress
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Security properties mostly span a page, a middleware, a route handler and a
 * migration, so there is no single unit to call — the same reasoning already
 * used by `lib/downloads/multi-link-config.test.ts` and `lib/api/batch-quota
 * .test.ts`. Source-level assertions are what stop a well-meaning refactor
 * quietly removing a control that nothing else would notice.
 */

describe("password policy", () => {
  it("requires the owner's 12-character floor", () => {
    expect(MIN_ADMIN_PASSWORD_LENGTH).toBe(12);
    expect(validateAdminPassword("Short1!").ok).toBe(false);
    expect(validateAdminPassword("a".repeat(11)).ok).toBe(false);
  });

  it("accepts a long passphrase with no symbols or digits", () => {
    // The whole point of dropping composition rules: this is strong and would
    // be REFUSED by a naive "must contain a number and a symbol" validator.
    expect(validateAdminPassword("correct horse battery staple").ok).toBe(true);
  });

  it("rejects common passwords even when they clear the length rule", () => {
    for (const weak of ["passwordpassword", "P@ssw0rd1234", "administrator1", "frenzsave2026"]) {
      expect(validateAdminPassword(weak).ok, weak).toBe(false);
    }
  });

  it("rejects a long string of one repeated character", () => {
    expect(validateAdminPassword("aaaaaaaaaaaaaaaa").ok).toBe(false);
  });

  it("rejects past bcrypt's 72-BYTE truncation point", () => {
    // Counted in bytes, not characters — silently ignoring the tail would mean
    // a user believes a 100-character passphrase is being checked in full.
    expect(validateAdminPassword("a1B".repeat(40)).ok).toBe(false);
    expect(validateAdminPassword("🔐".repeat(19)).ok).toBe(false); // 76 bytes
  });

  it("🔴 never echoes the password back in the rejection reason", () => {
    const secret = "hunter2hunter2hunter2";
    const verdict = validateAdminPassword(secret);
    expect(JSON.stringify(verdict)).not.toContain(secret);
  });
});

describe("server-side authorization is the boundary, not the middleware", () => {
  const requireAdmin = read("lib/admin/require-admin.ts");

  it("verifies the session with getUser(), never getSession()", () => {
    /*
      `getSession()` decodes the cookie WITHOUT calling the auth server, so a
      forged or revoked token satisfies it. Using it here would mean a revoked
      admin session kept working until its JWT expired.
    */
    const code = strip(requireAdmin);
    expect(code).toMatch(/auth\.getUser\(\)/);
    expect(code).not.toMatch(/auth\.getSession\(\)/);
  });

  it("re-reads the role from the DATABASE rather than trusting the JWT", () => {
    expect(strip(requireAdmin)).toMatch(/from\("profiles"\)[\s\S]{0,120}select\("role"\)/);
  });

  it("is server-only, so a client component importing it fails the build", () => {
    expect(requireAdmin).toMatch(/^import "server-only";/m);
  });

  it("answers an unauthorized API caller with 404, not 403", () => {
    // 403 confirms the endpoint exists — a free map of the admin surface.
    expect(strip(requireAdmin)).toMatch(/status: 404/);
  });

  it("every /api/admin route is guarded server-side", () => {
    /*
      🔴 THE LOAD-BEARING TEST. Requirement 12: protecting the dashboard page
      does not protect the API. This walks the real directory, so a route added
      later is covered without anyone remembering to list it here.

      `auth/*` is exempt by necessity — the login, forgot-password and
      reset-password endpoints exist precisely for callers with no admin
      session. Each carries its own protection (throttling, generic responses,
      recovery-session checks) and each is asserted separately below.
    */
    const dir = join(process.cwd(), "app/api/admin");
    const routes = walk(dir).filter((f) => f.endsWith("route.ts"));
    expect(routes.length).toBeGreaterThan(30);

    const unguarded = routes.filter((f) => {
      const rel = f.replace(process.cwd(), "").replace(/\\/g, "/");
      if (rel.includes("/api/admin/auth/")) return false;
      const src = strip(readFileSync(f, "utf8"));
      // `requireSensitiveAdmin` is the STRICTER gate (admin + recent password),
      // so a route using it is guarded by more than this test demands.
      return !/getAdminUser|requireAdminApi|requireAdminAction|requireSensitiveAdmin/.test(src);
    });

    expect(
      unguarded.map((f) => f.replace(process.cwd(), "")),
      "admin API routes with no server-side admin check",
    ).toEqual([]);
  });

  it("🔴 the two WORKER_SECRET routes fail CLOSED, not open", () => {
    /*
      Both `debug` and `proxy` used to read:

          if (secret && header !== secret) return 403

      An unset OR EMPTY `WORKER_SECRET` short-circuits that `&&` and the guard
      vanishes — and `debug` can issue proxied requests carrying this app's
      saved sign-in cookies. "Present but empty" is a state this deployment has
      actually been in (`CRON_SECRET=""`).

      The fixed shape trims the secret, requires it to be non-empty, and falls
      back to a real admin check instead of to nothing.
    */
    for (const p of ["app/api/admin/debug/route.ts", "app/api/admin/proxy/route.ts"]) {
      const src = strip(read(p));
      expect(src, p).toMatch(/WORKER_SECRET\?\.trim\(\)/);
      expect(src, p).toMatch(/!!secret &&/);
      expect(src, p).toMatch(/requireAdminApi\(\)/);
      // The old fail-open shape must not come back.
      expect(src, p).not.toMatch(/if \(secret && request\.headers/);
    }
  });
});

describe("the login endpoint", () => {
  const login = read("app/api/admin/auth/login/route.ts");

  it("signs in on the SERVER so attempts can be counted", () => {
    // A browser→Supabase call never reaches this origin, so no throttle written
    // around it could ever run.
    expect(strip(login)).toMatch(/signInWithPassword/);
    expect(strip(login)).toMatch(/checkLoginAllowed/);
    expect(strip(login)).toMatch(/noteLoginFailure/);
  });

  it("checks the throttle BEFORE contacting the auth server", () => {
    const code = strip(login);
    expect(code.indexOf("checkLoginAllowed")).toBeLessThan(code.indexOf("signInWithPassword"));
  });

  it("🔴 returns one identical message for every failure mode", () => {
    /*
      Wrong password, unknown email, and "correct password but not an admin"
      must be indistinguishable — otherwise the form is an oracle for both
      account enumeration and admin discovery.
    */
    const code = strip(login);
    const failures = code.match(/GENERIC_FAILURE/g) ?? [];
    expect(failures.length).toBeGreaterThanOrEqual(4);
    expect(code).not.toMatch(/error\.message/);
    expect(code).not.toMatch(/user not found|no account|wrong password/i);
  });

  it("signs out a non-admin who authenticated successfully", () => {
    // Correct credentials for an ordinary member must not leave a usable
    // session minted by the ADMIN form.
    const code = strip(login);
    expect(code).toMatch(/isAdmin\(/);
    expect(code).toMatch(/auth\.signOut\(\)/);
  });

  it("never logs the password or the email", () => {
    expect(login).not.toMatch(/console\.(log|error|warn|info)/);
  });
});

describe("brute-force protection", () => {
  const throttle = read("lib/admin/login-throttle.ts");

  it("🔴 counts in Postgres, not the fail-open Redis limiter", () => {
    /*
      `lib/rate-limit.ts` degrades to a per-instance in-memory limiter when
      Upstash is absent and honours RATE_LIMIT_ENABLED=false. Correct for
      downloads, catastrophic for a password form.
    */
    const code = strip(throttle);
    expect(code).toMatch(/admin_login_attempts/);
    expect(code).not.toMatch(/from "@\/lib\/rate-limit"/);
  });

  it("fails CLOSED when the ledger cannot be read", () => {
    expect(strip(throttle)).toMatch(/allowed: false/);
  });

  it("locks by BOTH email and IP", () => {
    // Email-only lets an attacker lock a known admin out; IP-only is defeated
    // by a proxy pool.
    const code = strip(throttle);
    expect(code).toMatch(/"email"/);
    expect(code).toMatch(/"ip"/);
  });
});

describe("password reset", () => {
  const forgot = read("app/api/admin/auth/forgot-password/route.ts");
  const reset = read("app/api/admin/auth/reset-password/route.ts");

  it("uses Supabase's own recovery, not a home-made token", () => {
    expect(strip(forgot)).toMatch(/resetPasswordForEmail/);
    // No bespoke token table, no crypto.randomBytes reset secret.
    expect(strip(forgot)).not.toMatch(/randomUUID|randomBytes|reset_tokens/);
  });

  it("🔴 answers identically whether or not the account exists", () => {
    const code = strip(forgot);
    expect(code).toMatch(/If an account exists for this email/);
    // Exactly one response object is constructed, and every path returns it.
    expect((code.match(/NextResponse\.json/g) ?? []).length).toBe(1);
  });

  it("re-validates the password policy SERVER-side", () => {
    expect(strip(reset)).toMatch(/validateAdminPassword/);
  });

  it("takes no user id or token from the request body", () => {
    // The recovery SESSION is what authorises the change; anything from the
    // body would be caller-controlled.
    const code = strip(reset);
    expect(code).toMatch(/auth\.getUser\(\)/);
    expect(code).not.toMatch(/body\.(userId|email|token)/);
  });

  it("🔴 revokes other sessions after a successful change", () => {
    // Otherwise a previously-stolen session survives the very password change
    // performed to evict it.
    expect(strip(reset)).toMatch(/signOut\(\{ scope: "others" \}\)/);
  });

  it("does not forward Supabase's error text to the client", () => {
    expect(strip(reset)).not.toMatch(/error\.message/);
  });
});

describe("logout", () => {
  it("revokes globally, not just this device", () => {
    expect(strip(read("app/api/admin/auth/logout/route.ts"))).toMatch(
      /signOut\(\{ scope: "global" \}\)/,
    );
  });

  it("is POST-only, so an <img> tag cannot trigger it", () => {
    const src = read("app/api/admin/auth/logout/route.ts");
    expect(src).toMatch(/export async function POST/);
    expect(src).not.toMatch(/export async function GET/);
  });
});

describe("re-authentication for sensitive actions", () => {
  const reauth = read("lib/admin/reauth.ts");

  it("stores no credential — only a signed id and expiry", () => {
    /*
      The assertion is about what goes INTO the marker, not whether the file
      says the word "password" — it now carries a user-facing "Confirm your
      password to continue." string, which is correct and must not fail this.

      So: the signed payload is exactly `<userId>.<expiry>`, and the module
      neither accepts nor writes a password anywhere.
    */
    const code = strip(reauth);
    expect(code).toMatch(/createHmac/);
    expect(code).toMatch(/const payload = `\$\{userId\}\.\$\{expiry\}`/);
    // `markReauthenticated` takes ONE argument, and it is the user id.
    expect(code).toMatch(/markReauthenticated\(userId: string\)/);
    // No password is ever read from a parameter, a cookie or an env var here.
    expect(code).not.toMatch(/password[A-Za-z]*\s*[:=]/i);
  });

  it("uses a constant-time comparison", () => {
    // `===` on an HMAC leaks how many leading bytes matched.
    expect(strip(reauth)).toMatch(/timingSafeEqual/);
  });

  it("is HttpOnly and never readable by script", () => {
    expect(strip(reauth)).toMatch(/httpOnly: true/);
  });

  it("fails closed with no secret configured", () => {
    expect(strip(reauth)).toMatch(/if \(!key\) return false/);
  });
});

describe("the middleware allows the auth pages and nothing else", () => {
  const mw = read("middleware.ts");

  it("allowlists the three public admin paths EXACTLY, not by prefix", () => {
    const code = strip(mw);
    expect(code).toMatch(/ADMIN_PUBLIC_PATHS = new Set/);
    expect(code).toMatch(/ADMIN_PUBLIC_PATHS\.has\(path\)/);
    // A startsWith test would also exempt anything appended to those paths.
    expect(code).not.toMatch(/path\.startsWith\("\/admin\/login"\)/);
  });

  it("sends unauthenticated /admin visitors to the ADMIN login", () => {
    expect(strip(mw)).toMatch(/"\/admin\/login"/);
  });
});

describe("database hardening (migration 0136)", () => {
  const sql = read("supabase/migrations/0136_admin_auth_hardening.sql");

  it("🔴 blocks a user from promoting themselves to admin", () => {
    /*
      The hole this closes: `profiles`' only UPDATE policy is
      `using (auth.uid() = id)` with no column restriction, so any signed-in
      user could `update profiles set role='admin' where id = <self>` straight
      from the browser — and every admin gate trusts that column.
    */
    expect(sql).toMatch(/profiles_protect_role/);
    expect(sql).toMatch(/before update on public\.profiles/);
    expect(sql).toMatch(/new\.role := old\.role/);
    // Server-side callers (service role) have no auth.uid() and stay able to grant.
    expect(sql).toMatch(/auth\.uid\(\) is null/);
  });

  it("keeps billing from demoting an administrator", () => {
    expect(sql).toMatch(/profiles_keep_admin/);
    expect(read("lib/paystack/sync.ts")).toMatch(/\.neq\("role", "admin"\)/);
  });

  it("gives the login ledger no client-reachable policy", () => {
    expect(sql).toMatch(/create table if not exists public\.admin_login_attempts/);
    expect(sql).toMatch(/alter table public\.admin_login_attempts enable row level security/);
    expect(sql).not.toMatch(/create policy[^;]*admin_login_attempts/);
  });
});

describe("no credential ever reaches browser storage", () => {
  it("the admin auth UI touches no storage API", () => {
    for (const p of [
      "features/admin/admin-login-form.tsx",
      "features/admin/admin-password-forms.tsx",
    ]) {
      /* Comments stripped — these files DOCUMENT that they avoid browser
         storage, and a bare `not.toMatch` finds the explanation. Fourth time
         this exact trap has bitten in this repo. */
      const src = strip(read(p));
      expect(src, p).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    }
  });

  it("no admin secret is exposed through a NEXT_PUBLIC_ var", () => {
    for (const p of [
      "lib/admin/require-admin.ts",
      "lib/admin/reauth.ts",
      "lib/admin/login-throttle.ts",
      "app/api/admin/auth/login/route.ts",
    ]) {
      expect(read(p), p).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(SERVICE|SECRET|ADMIN)/);
    }
  });
});

describe("sensitive actions have a working PROMPT, not just a guarded route", () => {
  /*
    🔴 Owner, 2026-08-26, with a screenshot of the stat adjuster: "it show
    confirm password to continue and i didnt see any password slot or anything".

    The ROUTE was correctly protected — a direct API call was refused — but the
    UI had no `useSensitiveAction()`, so the server's REAUTH_REQUIRED message
    was printed as plain red text with no way to act on it. A protected endpoint
    whose UI cannot satisfy it is a dead button, which is worse than either an
    unprotected endpoint or an honest error.

    This walks the ROUTES that demand re-auth and checks that every admin UI
    posting to one can actually raise the prompt — so a fourth sensitive
    endpoint added later cannot repeat it.
  */
  const sensitiveRoutes = walk(join(process.cwd(), "app/api/admin"))
    .filter((f) => f.endsWith("route.ts"))
    .filter((f) => /requireSensitiveAdmin/.test(readFileSync(f, "utf8")))
    .map((f) => {
      const m = f.replace(/\\/g, "/").match(/app\/api\/admin\/([^/]+)\//);
      return m ? m[1]! : "";
    })
    .filter(Boolean);

  it("finds the sensitive routes", () => {
    expect(sensitiveRoutes.length).toBeGreaterThanOrEqual(3);
  });

  it("🔴 every UI posting to one can raise the password prompt", () => {
    const broken: string[] = [];

    for (const file of walk(join(process.cwd(), "features/admin")).filter((f) =>
      f.endsWith(".tsx"),
    )) {
      const src = readFileSync(file, "utf8");

      // Does this component POST to a route that demands re-authentication?
      const posts = sensitiveRoutes.some((r) =>
        new RegExp('fetch\\("/api/admin/' + r + '", \\{ method: "POST"').test(src),
      );
      if (!posts) continue;

      const hasHook = /useSensitiveAction\(\)/.test(src);
      const rendersPrompt = /\{reauthPrompt\}/.test(src);
      // A bare `fetch` to one of these routes bypasses the handshake entirely.
      const bypasses = sensitiveRoutes.some((r) =>
        new RegExp('await fetch\\("/api/admin/' + r + '", \\{ method: "POST"').test(src),
      );

      if (!hasHook || !rendersPrompt || bypasses) broken.push(file.replace(process.cwd(), ""));
    }

    expect(broken, "posts to a re-auth-protected route but cannot prompt").toEqual([]);
  });
});

/** Strip comments — these assertions are about CODE, and several of the
 *  negative ones would otherwise match the prose explaining what was removed.
 *  Same trap already recorded three times in multi-link-config.test.ts. */
function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
