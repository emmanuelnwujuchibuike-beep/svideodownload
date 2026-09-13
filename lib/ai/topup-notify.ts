import "server-only";

import { formatCents } from "@/lib/ai/economy";
import { claimTopupFailureNotification, claimTopupSuccessNotification } from "@/lib/ai/topup-attempts";
import { sendTopupReceiptEmail } from "@/lib/email/resend";
import { aiCurrencySymbol, type AiCurrency } from "@/lib/landing/settings";
import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { SITE_URL } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A DEPOSIT IS ANNOUNCED ONCE — push, in-app, and an emailed invoice
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13: "they should receive a push notification and an email
 * notification of the successful or failed deposit, with an invoice."
 *
 * ── Once, whichever path got there first ───────────────────────────────────
 *
 * A successful deposit is credited by the Paystack webhook AND by the
 * verify-on-return, in either order, sometimes within the same second. Both
 * call `notifyTopupSuccess`; the conditional UPDATE inside
 * `claimTopupSuccessNotification` lets exactly one of them through. A failed
 * deposit is only ever seen by the verify-on-return (Paystack sends no
 * webhook for a declined one-off charge), and is claimed on the attempt row
 * the same way, so a member who reloads the return page is not told twice.
 *
 * ── Never on the money path ────────────────────────────────────────────────
 *
 * Every caller runs these inside `after()` — past the response, kept alive by
 * the platform, never awaited on the money path. A push that fails, an email
 * provider that is down, a profile with no address — none of that may turn a
 * credited deposit into a 500, or make Paystack redeliver a webhook that
 * already did its job. Everything here catches and logs.
 *
 * ── The invoice number ─────────────────────────────────────────────────────
 *
 * Derived from our own reference (`frenz_ai_topup_<uuid>`): the first eight
 * hex characters of the uuid, upper-cased, behind a fixed prefix. Stable —
 * the same deposit always prints the same number — unique for practical
 * purposes, and short enough to read out to support. Not a sequence, because
 * a sequence would need a table that two callers race to increment.
 */

const USAGE_URL = `${SITE_URL}/ai/usage`;
const AI_URL = `${SITE_URL}/ai`;

export function topupInvoiceNumber(reference: string): string {
  const tail = reference.split("_").pop() ?? reference;
  return `FRZ-AI-${tail.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

function money(cents: number, currency: string): string {
  return formatCents(cents, aiCurrencySymbol(currency as AiCurrency));
}

function when(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  return safe.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hour12: false,
  }) + " UTC";
}

async function memberEmail(userId: string): Promise<string | null> {
  const { data } = await createAdminClient().from("profiles").select("email").eq("id", userId).maybeSingle();
  const email = (data as { email?: string | null } | null)?.email;
  return typeof email === "string" && email.includes("@") ? email : null;
}

export async function notifyTopupSuccess(opts: {
  userId: string;
  reference: string;
  amountCents: number;
  currency: string;
  balanceAfterCents: number;
  channel?: string | null;
  paidAt?: string | null;
}): Promise<void> {
  try {
    if (!(await claimTopupSuccessNotification(opts.userId, opts.reference))) return;

    const amount = money(opts.amountCents, opts.currency);
    const balance = money(opts.balanceAfterCents, opts.currency);
    const invoiceNumber = topupInvoiceNumber(opts.reference);

    await sendSmartPush(
      opts.userId,
      {
        title: "Deposit received",
        body: `${amount} added. Your Frenz AI balance is now ${balance}.`,
        url: USAGE_URL,
        genericBody: "Your Frenz AI deposit went through.",
        tag: `ai-topup-${opts.reference}`,
      },
      "high",
      "premium",
      { type: "ai_deposit_successful" },
    );

    const to = await memberEmail(opts.userId);
    if (to) {
      await sendTopupReceiptEmail(to, {
        outcome: "success",
        invoiceNumber,
        reference: opts.reference,
        amount,
        currency: opts.currency,
        balanceAfter: balance,
        when: when(opts.paidAt),
        channel: opts.channel ?? null,
        ctaHref: USAGE_URL,
      });
    }
  } catch (e) {
    console.error("[ai/topup] success notification failed", { reference: opts.reference, error: String(e) });
  }
}

export async function notifyTopupFailed(opts: {
  userId: string;
  reference: string;
  amountCents: number;
  currency: string;
  /** Paystack's customer-facing line, e.g. "Insufficient Funds". */
  reason?: string | null;
  channel?: string | null;
}): Promise<void> {
  try {
    if (!(await claimTopupFailureNotification(opts.userId, opts.reference))) return;

    const amount = money(opts.amountCents, opts.currency);
    const reason = opts.reason?.trim() || null;

    await sendSmartPush(
      opts.userId,
      {
        title: "Deposit didn't go through",
        body: reason ? `${amount} wasn't added — ${reason}. Tap to try again.` : `${amount} wasn't added. Tap to try again.`,
        url: AI_URL,
        genericBody: "Your Frenz AI deposit didn't go through.",
        tag: `ai-topup-${opts.reference}`,
      },
      "high",
      "premium",
      { type: "ai_deposit_failed" },
    );

    const to = await memberEmail(opts.userId);
    if (to) {
      await sendTopupReceiptEmail(to, {
        outcome: "failed",
        invoiceNumber: topupInvoiceNumber(opts.reference),
        reference: opts.reference,
        amount,
        currency: opts.currency,
        when: when(null),
        channel: opts.channel ?? null,
        reason,
        ctaHref: AI_URL,
      });
    }
  } catch (e) {
    console.error("[ai/topup] failure notification failed", { reference: opts.reference, error: String(e) });
  }
}
