import "server-only";

import { sendProductEmail } from "@/lib/email/resend";
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
 */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

export async function emailMember(userId: string, opts: { subject: string; heading: string; intro: string; body?: string; ctaLabel?: string; ctaPath?: string }): Promise<void> {
  try {
    const { data } = await createAdminClient().from("profiles").select("email").eq("id", userId).maybeSingle();
    const to = (data as { email?: string | null } | null)?.email;
    if (!to || !to.includes("@")) return;
    await sendProductEmail(to, {
      subject: opts.subject,
      heading: esc(opts.heading),
      intro: esc(opts.intro),
      body: opts.body ? esc(opts.body) : undefined,
      ctaLabel: opts.ctaLabel ? esc(opts.ctaLabel) : undefined,
      ctaHref: opts.ctaPath ? `${SITE_URL}${opts.ctaPath}` : undefined,
    });
  } catch (e) {
    console.error("[email/member] failed", { userId, subject: opts.subject, error: String(e).slice(0, 160) });
  }
}
