import "server-only";

import { alertEmailHtml, sendAdminEmail } from "@/lib/notify";
import { sendPushToUser } from "@/lib/push/web-push";
import { resolveAdminUserIds } from "@/lib/support/chat";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Tell the admins about every payment, the moment it succeeds (owner,
 * 2026-10-10: "make admin receive push notification of any funding and where it
 * was from, either AI funding, subscribers or advertisers, with details on
 * email and push").
 *
 * The trigger on ai_topup_attempts (0218) queues one admin_funding_alerts row
 * per successful payment, from whatever path settled it. This flush claims each
 * unsent row (sent_at stamped BEFORE sending, so two flushes never both send)
 * and announces it by push to every admin device and by email. It runs after
 * webhooks settle and from the 10-minute reconcile job, so nothing waits long
 * and nothing is missed. Before 0218 runs, the table is missing and this is a
 * no-op.
 */

/** Where a payment came from, in the owner's words. */
export function fundingSource(purpose: string): string {
  if (purpose === "ad_campaign") return "Advertiser payment";
  if (purpose === "ai_subscription") return "AI subscription";
  return "AI credit funding";
}

/** Money in a currency's minor unit, as text — the code, never a guessed symbol. */
export function formatMinor(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  return `${currency.toUpperCase()} ${major.toLocaleString("en-US", { minimumFractionDigits: major % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

interface AlertRow {
  reference: string;
  user_id: string | null;
  purpose: string;
  amount_cents: number;
  currency: string;
  provider: string | null;
  item_id: string | null;
  created_at: string;
}

export async function flushFundingAlerts(limit = 20): Promise<{ sent: number }> {
  const db = createAdminClient();
  const { data, error } = await db.from("admin_funding_alerts").select("*").is("sent_at", null).order("created_at", { ascending: true }).limit(limit);
  if (error || !data?.length) return { sent: 0 };
  const admins = await resolveAdminUserIds().catch(() => [] as string[]);
  let sent = 0;
  for (const row of data as AlertRow[]) {
    // claim first: a concurrent flush that loses this race sends nothing
    const { data: claimed } = await db.from("admin_funding_alerts").update({ sent_at: new Date().toISOString() }).eq("reference", row.reference).is("sent_at", null).select("reference");
    if (!claimed?.length) continue;
    const { data: payer } = row.user_id ? await db.from("profiles").select("handle, display_name, email").eq("id", row.user_id).maybeSingle() : { data: null };
    const p = payer as { handle?: string | null; display_name?: string | null; email?: string | null } | null;
    const who = p?.display_name || (p?.handle ? `@${p.handle}` : "A member");
    const source = fundingSource(row.purpose);
    const amount = formatMinor(row.amount_cents, row.currency);
    const detail = [source, row.provider ? `via ${row.provider}` : null].filter(Boolean).join(" ");

    await Promise.allSettled(
      admins.map((id) =>
        sendPushToUser(id, {
          title: `${amount} received — ${source}`,
          body: `${who}${p?.handle ? ` (@${p.handle})` : ""} · ${detail}`,
          url: "/admin#revenue",
          tag: `funding:${row.reference}`,
        }),
      ),
    );
    await sendAdminEmail(
      `${amount} received — ${source}`,
      alertEmailHtml({
        heading: `${amount} received`,
        intro: `${source}. A payment just succeeded.`,
        rows: [
          { label: "Source", value: source },
          { label: "Amount", value: amount },
          { label: "From", value: [who, p?.handle ? `@${p.handle}` : null, p?.email].filter(Boolean).join(" · ") },
          { label: "Provider", value: row.provider ?? "—" },
          ...(row.item_id ? [{ label: row.purpose === "ad_campaign" ? "Campaign" : "Item", value: row.item_id }] : []),
          { label: "Reference", value: row.reference },
          { label: "Time (UTC)", value: new Date(row.created_at).toISOString().replace("T", " ").slice(0, 16) },
        ],
        footnote: "Sent once per successful payment. Totals are on the admin Revenue panel.",
      }),
    ).catch(() => false);
    sent += 1;
  }
  return { sent };
}

/**
 * Flush soon, without holding the caller: after the response when inside a
 * request (next/server `after`), straight away otherwise (a cron, a script).
 * A failed flush is harmless — the 10-minute reconcile job sends what is left.
 */
export function flushFundingAlertsSoon(): void {
  const run = () => flushFundingAlerts().catch(() => ({ sent: 0 }));
  void import("next/server")
    .then(({ after }) => {
      try {
        after(run);
      } catch {
        void run();
      }
    })
    .catch(() => void run());
}
