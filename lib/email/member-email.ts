import "server-only";

import { isOptional, optionalEmailAllowed, unsubscribeUrlFor, type MemberEmailKind } from "@/lib/email/consent";
import { hasResend, sendProductEmail } from "@/lib/email/resend";
import { SITE_URL } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Email a member about their own account (owner, 2026-10-07: "and let users
 * receive email") — credits received, a withdrawal-application decision. The
 * branded product email, with every member-supplied string ESCAPED: the email
 * shell inserts its fields into HTML as they are, and a sender's note or a
 * display name is not ours to trust.
 *
 * Never on a money path: callers fire it after the fact and a failure only logs.
 *
 * The outcome (Frenz Exclusive Part 10) is for callers that report honestly — the Exclusive fan-out
 * records a refused send as failed, not handed off. "sent" means Resend ACCEPTED it, not that it
 * reached an inbox; "skipped" = no usable address, email isn't configured here (no API key), or —
 * Part 11 — an OPTIONAL email to a member who turned optional email off.
 *
 * Part 11: `kind` is required, so every caller says what its email is (lib/email/consent.ts holds the
 * classification and why). For an optional kind the member's global switch is read HERE, right
 * before the send — so a message queued, retried or swept after they opted out is not sent — and
 * the email carries a one-click unsubscribe. Transactional kinds are unchanged.
 */
export type MemberEmailOutcome = "sent" | "skipped" | "failed";
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

export async function emailMember(
  userId: string,
  opts: { subject: string; heading: string; intro: string; body?: string; ctaLabel?: string; ctaPath?: string; person?: { name: string; handle: string | null; avatarUrl: string | null }; settingsPath?: string },
  kind: MemberEmailKind,
): Promise<MemberEmailOutcome> {
  try {
    const db = createAdminClient();
    const optional = isOptional(kind);
    // the latest choice, read at send time (a failed read sends nothing optional)
    if (optional && !(await optionalEmailAllowed(userId, db))) return "skipped";
    const { data } = await db.from("profiles").select("email").eq("id", userId).maybeSingle();
    const to = (data as { email?: string | null } | null)?.email;
    if (!to || !to.includes("@")) return "skipped";
    if (!hasResend) return "skipped";
    const unsubscribeUrl = optional ? ((await unsubscribeUrlFor(userId, db)) ?? undefined) : undefined;
    const accepted = await sendProductEmail(to, {
      subject: opts.subject,
      heading: esc(opts.heading),
      intro: esc(opts.intro),
      body: opts.body ? esc(opts.body) : undefined,
      ctaLabel: opts.ctaLabel ? esc(opts.ctaLabel) : undefined,
      ctaHref: opts.ctaPath ? `${SITE_URL}${opts.ctaPath}` : undefined,
      person: opts.person ? { name: esc(opts.person.name), handle: opts.person.handle ? esc(opts.person.handle) : null, avatarUrl: opts.person.avatarUrl } : undefined,
      unsubscribeUrl,
      settingsHref: opts.settingsPath && opts.settingsPath.startsWith("/") ? `${SITE_URL}${opts.settingsPath}` : undefined,
    });
    if (!accepted) console.error("[email/member] refused", { userId, kind });
    return accepted ? "sent" : "failed";
  } catch (e) {
    console.error("[email/member] failed", { userId, kind, error: String(e).slice(0, 160) });
    return "failed";
  }
}
