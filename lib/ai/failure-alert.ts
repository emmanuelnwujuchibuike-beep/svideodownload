import { hasResend, sendProductEmail } from "@/lib/email/resend";
import { SITE_URL } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAdminUserIds } from "@/lib/support/chat";

import type { AiJobRow } from "./jobs";

/**
 * 🔴 EVERY FAILED AI JOB EMAILS THE ADMINS, WITH THE REASON AND THE MEMBER (owner, 2026-10-23: "Make admin to
 * receive email of failed Ai Jobs with reason on failure and user who made it").
 *
 * Called from `transitionJob` (job-store.ts) — the one door every `→ failed` goes through — only when the
 * compare-and-set actually moved the row, so a retried webhook or a second sweep never sends twice. The
 * `admin_alerts` key (0003, unique) is the second lock, the same one the download-failure alert uses.
 * Never throws and never holds the caller long (bounded by a timeout): a failed email must not fail the job's
 * own bookkeeping, and the refund that follows a failure must not wait on a mail provider.
 */

const TIMEOUT_MS = 5_000;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Who gets it: profiles.role = admin plus ADMIN_EMAILS, deduped, lower-cased. */
async function adminEmails(): Promise<string[]> {
  const db = createAdminClient();
  const out = new Set((process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
  const ids = await resolveAdminUserIds();
  if (ids.length > 0) {
    const { data } = await db.from("profiles").select("email").in("id", ids);
    for (const r of data ?? []) if (typeof r.email === "string" && r.email) out.add(r.email.toLowerCase());
  }
  return [...out];
}

/** The member, as an admin would look them up: "Display (@handle) <email>", or the guest id. */
async function whoRanIt(job: Pick<AiJobRow, "user_id" | "guest_id">): Promise<string> {
  if (!job.user_id) return job.guest_id ? `Guest ${job.guest_id}` : "Unknown";
  const { data } = await createAdminClient().from("profiles").select("display_name, handle, email").eq("id", job.user_id).maybeSingle();
  const name = (data?.display_name as string | null) || null;
  const handle = data?.handle ? `@${data.handle as string}` : null;
  const email = (data?.email as string | null) || null;
  return [name, handle && name ? `(${handle})` : handle, email ? `<${email}>` : null].filter(Boolean).join(" ") + ` · id ${job.user_id}`;
}

/** The email's text lines, exported for the test. */
export function failureLines(job: Pick<AiJobRow, "id" | "feature" | "model" | "error_code" | "charged_cents" | "funding_source" | "created_at">, reason: string | null, who: string): string[] {
  return [
    `Feature: ${job.feature}${job.model ? ` · ${job.model}` : ""}`,
    `Reason: ${job.error_code ?? "UNKNOWN"}${reason ? ` — ${reason}` : ""}`,
    `Member: ${who}`,
    `Charged: ${job.charged_cents != null ? `${job.charged_cents} (${job.funding_source ?? "unknown source"})` : "nothing"}`,
    `Job: ${job.id}`,
    `Started: ${job.created_at}`,
  ];
}

async function send(job: AiJobRow, reason: string | null): Promise<void> {
  if (!hasResend) return;
  const db = createAdminClient();
  const { error } = await db.from("admin_alerts").insert({ key: `ai_job_failed:${job.id}`, kind: "ai_job_failed", subject: `AI job failed: ${job.feature}` });
  if (error) return; // already sent (or the table refused): never twice
  const [to, who] = await Promise.all([adminEmails(), whoRanIt(job)]);
  if (to.length === 0) return;
  const lines = failureLines(job, reason?.slice(0, 600) ?? null, who);
  await Promise.all(
    to.map((addr) =>
      sendProductEmail(addr, {
        subject: `AI job failed: ${job.feature} (${job.error_code ?? "UNKNOWN"})`,
        heading: "An AI job failed",
        intro: esc(`${job.feature} failed: ${reason?.slice(0, 200) || job.error_code || "no reason recorded"}`),
        body: esc(lines.join("\n")),
        ctaLabel: "Open the admin dashboard",
        ctaHref: `${SITE_URL}/admin`,
      }).catch(() => false),
    ),
  );
}

/** Fire the alert for a job that has just moved to `failed`. Never throws; waits at most TIMEOUT_MS. */
export async function notifyAdminsOfFailedAiJob(job: AiJobRow, reason: string | null): Promise<void> {
  try {
    await Promise.race([send(job, reason), new Promise<void>((r) => setTimeout(r, TIMEOUT_MS))]);
  } catch (e) {
    console.error("[ai/failure-alert] could not alert", { jobId: job.id, message: e instanceof Error ? e.message : String(e) });
  }
}
