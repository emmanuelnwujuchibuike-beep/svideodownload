import "server-only";

import { buildAiOperations, type AiOperations, type OpsJobRow } from "@/lib/ai/admin-ops-view";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The Frenz AI operations read (Part 8 §7, §35–§39). ONE bounded query, run
 * only when an admin opens the Frenz AI section — no timer, no polling, nothing
 * while nobody looks. `metadata` is never selected whole (it holds members'
 * prompts); only the four paths the panel shows.
 */
const WINDOW_DAYS = 7;
const CAP = 500;

const COLUMNS = [
  "id",
  "user_id",
  "feature",
  "status",
  "error_code",
  "error_message",
  "funding_source",
  "provider",
  "charged_cents",
  "created_at",
  "started_at",
  "completed_at",
  "notified_at",
  "replicate_prediction_id",
  "finalize_error",
  "billing:metadata->billing->>type",
  "units:metadata->quote->>providerUnits",
  "category:metadata->>failure_category",
  "notify_pending:metadata->>notify_pending",
].join(",");

export async function loadAiOperations(): Promise<AiOperations> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  try {
    const { data, error } = await createAdminClient().from("ai_jobs").select(COLUMNS).gte("created_at", since).order("created_at", { ascending: false }).limit(CAP);
    if (error) {
      console.error("[ai/ops] read failed", { code: error.code, message: error.message });
      return buildAiOperations([], { windowDays: WINDOW_DAYS, cap: CAP, unreadable: true });
    }
    return buildAiOperations((data ?? []) as unknown as OpsJobRow[], { windowDays: WINDOW_DAYS, cap: CAP });
  } catch (e) {
    console.error("[ai/ops] read failed", { error: String(e).slice(0, 200) });
    return buildAiOperations([], { windowDays: WINDOW_DAYS, cap: CAP, unreadable: true });
  }
}
