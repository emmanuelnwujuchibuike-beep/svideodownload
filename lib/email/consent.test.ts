import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenzsave Part 11 — the global optional-email switch, enforced at send time, and the one-click
 * unsubscribe. The REAL consent module and the REAL emailMember, against an in-memory database;
 * Resend is a mock that records what would have been sent (nothing leaves the test).
 */

let db: FakeDb;
const sent: { to: string; opts: Record<string, unknown> }[] = [];
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/email/resend", () => ({
  hasResend: true,
  sendProductEmail: async (to: string, opts: Record<string, unknown>) => {
    sent.push({ to, opts });
    return true;
  },
}));
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key-for-hmac-derivation";

const consent = await import("./consent");
const { emailMember } = await import("./member-email");

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = U(1);
const B = U(2);
const mail = { subject: "Amaka posted", heading: "Amaka posted", intro: "Open their tab." };

beforeEach(() => {
  db = fakeDb({
    profiles: [
      { id: A, email: "a@example.com" },
      { id: B, email: "b@example.com" },
    ],
    notification_settings: [],
    email_unsubscribe_tokens: [],
  });
  db.unique.notification_settings = [["user_id"]];
  db.unique.email_unsubscribe_tokens = [["user_id"], ["token_hash"]];
  sent.length = 0;
});

const optOut = (id: string) => db.tables.notification_settings!.push({ user_id: id, optional_email: false });

describe("the switch, read at send time", () => {
  it("existing accounts (no row) are allowed — nobody had a global switch to have turned off", async () => {
    expect(await consent.optionalEmailAllowed(A)).toBe(true);
    expect(await emailMember(A, mail, "exclusive_announcement")).toBe("sent");
  });

  it("opted out: every OPTIONAL kind is skipped and nothing reaches the provider", async () => {
    optOut(A);
    for (const kind of Object.keys(consent.MEMBER_EMAIL_KINDS) as (keyof typeof consent.MEMBER_EMAIL_KINDS)[]) {
      if (consent.MEMBER_EMAIL_KINDS[kind] !== "optional") continue;
      expect(await emailMember(A, mail, kind), kind).toBe("skipped");
    }
    expect(sent).toHaveLength(0);
  });

  it("opted out: TRANSACTIONAL kinds still go, with no unsubscribe link", async () => {
    optOut(A);
    expect(await emailMember(A, mail, "withdrawal_update")).toBe("sent");
    expect(sent[0]!.opts.unsubscribeUrl).toBeUndefined();
  });

  it("opted back in: optional email flows again", async () => {
    optOut(A);
    expect(await emailMember(A, mail, "exclusive_private_post")).toBe("skipped");
    await consent.setOptionalEmail(A, true);
    expect(await emailMember(A, mail, "exclusive_private_post")).toBe("sent");
  });

  it("queued before the opt-out, sent after: the LATEST choice wins (no stale decision)", async () => {
    // a sender that read 'allowed' earlier, then the member opts out before the send
    expect(await consent.optionalEmailAllowed(A)).toBe(true);
    optOut(A);
    expect(await emailMember(A, mail, "subscription_renewal")).toBe("skipped");
    // and a retry of the same message later is still skipped
    expect(await emailMember(A, mail, "subscription_renewal")).toBe("skipped");
    expect(sent).toHaveLength(0);
  });

  it("a failed read of the switch sends nothing optional (fails closed), but a database before 0253 reads as allowed", async () => {
    db.failOn.notification_settings = "connection reset";
    expect(await consent.optionalEmailAllowed(A)).toBe(false);
    expect(await emailMember(A, mail, "creator_new_member")).toBe("skipped");
    expect(await emailMember(A, mail, "credits_received")).toBe("sent");
    db.failOn.notification_settings = 'column "optional_email" does not exist';
    expect(await consent.optionalEmailAllowed(A)).toBe(true);
  });

  it("many at once: one read, missing rows allowed, opted-out left out", async () => {
    optOut(B);
    expect([...(await consent.optionalEmailAllowedMany([A, B, A]))!].sort()).toEqual([A]);
  });

  it("teeth: a check that ignores the stored false would send", async () => {
    optOut(A);
    const naive = async () => true;
    expect(await naive()).not.toBe(await consent.optionalEmailAllowed(A));
  });
});

describe("the unsubscribe token", () => {
  it("is 43 opaque characters, stable per member, different per member, and carries no id or address", () => {
    const t = consent.unsubscribeTokenFor(A)!;
    expect(t).toMatch(consent.TOKEN_RE);
    expect(consent.unsubscribeTokenFor(A)).toBe(t);
    expect(consent.unsubscribeTokenFor(B)).not.toBe(t);
    expect(t).not.toContain(A.replace(/-/g, ""));
    expect(t.toLowerCase()).not.toContain("example");
  });

  it("an optional email carries the link, and only the token's HASH is stored", async () => {
    await emailMember(A, mail, "exclusive_announcement");
    const url = sent[0]!.opts.unsubscribeUrl as string;
    const token = new URL(url).searchParams.get("t")!;
    expect(url).toMatch(/\/api\/email\/unsubscribe\?t=[A-Za-z0-9_-]{43}$/);
    const rows = db.tables.email_unsubscribe_tokens!;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: A, token_hash: consent.hashToken(token) });
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("a valid token turns optional email off — and a second click is the same answer", async () => {
    const url = await consent.unsubscribeUrlFor(A);
    const token = new URL(url!).searchParams.get("t")!;
    expect(await consent.unsubscribeWithToken(token)).toEqual({ ok: true });
    expect(await consent.optionalEmailAllowed(A)).toBe(false);
    expect(await consent.unsubscribeWithToken(token)).toEqual({ ok: true });
    expect(db.tables.notification_settings!.filter((r) => r.user_id === A)).toHaveLength(1);
    // only A: B's email is untouched
    expect(await consent.optionalEmailAllowed(B)).toBe(true);
  });

  it("malformed and unknown tokens get the same answer, and change nothing", async () => {
    await consent.unsubscribeUrlFor(A);
    const unknown = consent.unsubscribeTokenFor(B)!; // well-formed, but B never got an email
    for (const t of ["", "short", `${"x".repeat(42)}!`, unknown, null, 42]) expect(await consent.unsubscribeWithToken(t)).toEqual({ ok: false, reason: "invalid" });
    expect(db.tables.notification_settings).toHaveLength(0);
  });

  it("the stored hash is what authorises: a rotated key's NEW token fails until stored, the old link keeps working", async () => {
    const old = new URL((await consent.unsubscribeUrlFor(A))!).searchParams.get("t")!;
    process.env.EMAIL_UNSUBSCRIBE_SECRET = "a-brand-new-secret-at-least-32-characters-long";
    const fresh = consent.unsubscribeTokenFor(A)!;
    expect(fresh).not.toBe(old);
    expect(await consent.unsubscribeWithToken(fresh)).toEqual({ ok: false, reason: "invalid" });
    expect(await consent.unsubscribeWithToken(old)).toEqual({ ok: true });
    delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
  });
});

describe("every email is classified (no optional email bypasses the switch)", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
    });
  const files = ["app", "lib", "features"].flatMap((d) => walk(join(process.cwd(), d)));

  it("every emailMember call names a kind that exists", () => {
    const kinds = new Set(Object.keys(consent.MEMBER_EMAIL_KINDS));
    const found: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (!src.includes("emailMember(") || f.endsWith(join("email", "member-email.ts"))) continue;
      const named = [...src.matchAll(/"([a-z_]+)"\)/g)].map((m) => m[1]!).filter((k) => kinds.has(k));
      const ternary = /"exclusive_announcement" : "exclusive_private_post"/.test(src);
      expect(named.length + (ternary ? 1 : 0), f).toBeGreaterThan(0);
      found.push(...named);
    }
    expect(found.length).toBeGreaterThanOrEqual(9);
  });

  it("only the four classified direct senders call sendProductEmail / receipts / codes themselves", () => {
    const direct = files.filter((f) => /sendProductEmail\(|sendTopupReceiptEmail\(|sendOtpEmail\(/.test(readFileSync(f, "utf8")) && !f.endsWith(join("email", "resend.ts")) && !f.endsWith(join("email", "member-email.ts")));
    const rel = direct.map((f) => f.slice(process.cwd().length + 1).replace(/\\/g, "/")).sort();
    // sign_in_code, topup_receipt, ad_campaign_notice (paid campaigns), support_reply — see consent.ts
    expect(rel).toEqual(["app/api/auth/otp/route.ts", "lib/ads-platform/ad-notify.ts", "lib/ai/topup-notify.ts", "lib/support/chat.ts"]);
    // and the ad file's only direct send is the PAID campaign notice; the waitlist goes through emailMember
    const ad = readFileSync(join(process.cwd(), "lib", "ads-platform", "ad-notify.ts"), "utf8");
    expect(ad.match(/sendProductEmail\(/g)).toHaveLength(1);
    expect(ad).toContain('"ad_slot_waitlist")');
  });

  it("nothing promotional is filed as transactional or security", () => {
    for (const [k, c] of Object.entries({ ...consent.MEMBER_EMAIL_KINDS, ...consent.DIRECT_EMAIL_KINDS })) {
      if (/announcement|private_post|new_subscriber|new_member|renewal|waitlist/.test(k)) expect(c, k).toBe("optional");
    }
  });
});
