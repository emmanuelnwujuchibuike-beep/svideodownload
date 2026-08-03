import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import type {
  IdDocumentType,
  VerificationCategory,
  VerificationRequest,
  VerificationState,
  VerificationStatus,
} from "./verification-shared";

/**
 * Account Verification — the blue tick (migration 0104).
 *
 * Two ways to get it, and they are deliberately not the same shape:
 *
 *  1. APPLY. The member must first QUALIFY (see `checkEligibility`) — every
 *     criterion below is computed from data the platform already holds, so the
 *     checklist the member sees is the checklist the gate enforces; there is no
 *     hidden score. They then submit their legal name exactly as printed on a
 *     government ID, images of that ID, and a liveness selfie. An admin reviews it.
 *
 *  2. ADMIN ISSUE. An admin can grant the tick immediately, skipping all of the
 *     above (owner: "admin can issue directly to skip all the processes"). That
 *     still writes an approved request marked `issued_directly` with the admin's
 *     id and reason, so the tick is never a change nobody can account for.
 *
 * Every read here is defensive: until 0104 is applied the tables do not exist,
 * and this module must degrade to "no request" rather than 500 a settings page.
 */

export type {
  Eligibility,
  EligibilityCriterion,
  EligibilityInput,
  IdDocumentType,
  VerificationCategory,
  VerificationRequest,
  VerificationState,
  VerificationStatus,
} from "./verification-shared";
export {
  checkEligibility,
  ID_DOCUMENT_TYPES,
  MIN_ACCOUNT_AGE_DAYS,
  MIN_FOLLOWERS,
  REJECTION_CODES,
  VERIFICATION_CATEGORIES,
  verificationSummary,
} from "./verification-shared";

/* ─────────────────────────────── Reads ─────────────────────────────────── */

interface Row {
  id: string;
  user_id: string;
  status: string;
  category: string;
  legal_name: string | null;
  known_as: string | null;
  country: string | null;
  id_document_type: string | null;
  id_number_last4: string | null;
  id_front_path: string | null;
  id_back_path: string | null;
  selfie_path: string | null;
  links: unknown;
  statement: string | null;
  reviewer_id: string | null;
  reviewed_at: string | null;
  decision_reason: string | null;
  rejection_code: string | null;
  issued_directly: boolean | null;
  submitted_at: string | null;
  created_at: string;
}

const COLUMNS =
  "id, user_id, status, category, legal_name, known_as, country, id_document_type, id_number_last4, id_front_path, id_back_path, selfie_path, links, statement, reviewer_id, reviewed_at, decision_reason, rejection_code, issued_directly, submitted_at, created_at";

function toRequest(row: Row): VerificationRequest {
  return {
    id: row.id,
    userId: row.user_id,
    status: (row.status as VerificationStatus) ?? "draft",
    category: (row.category as VerificationCategory) ?? "creator",
    legalName: row.legal_name,
    knownAs: row.known_as,
    country: row.country,
    idDocumentType: (row.id_document_type as IdDocumentType | null) ?? null,
    idNumberLast4: row.id_number_last4,
    idFrontPath: row.id_front_path,
    idBackPath: row.id_back_path,
    selfiePath: row.selfie_path,
    links: Array.isArray(row.links) ? (row.links as string[]) : [],
    statement: row.statement,
    reviewerId: row.reviewer_id,
    reviewedAt: row.reviewed_at,
    decisionReason: row.decision_reason,
    rejectionCode: row.rejection_code,
    issuedDirectly: Boolean(row.issued_directly),
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
  };
}

/** The member's current tick + their latest request, if any. */
export async function getVerificationState(userId: string): Promise<VerificationState> {
  const admin = createAdminClient();
  let verified = false;
  try {
    const { data } = await admin.from("profiles").select("is_verified").eq("id", userId).maybeSingle();
    verified = Boolean(data?.is_verified);
  } catch {
    /* ignore */
  }

  try {
    const { data } = await admin
      .from("verification_requests")
      .select(COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return { verified, request: data ? toRequest(data as Row) : null };
  } catch {
    // Migration 0104 not applied yet — the settings row still renders, it just
    // has nothing to report.
    return { verified, request: null };
  }
}

/** The admin queue, waiting longest first. */
export async function listVerificationQueue(
  statuses: VerificationStatus[] = ["pending", "in_review"],
  limit = 100,
): Promise<(VerificationRequest & { handle: string | null; displayName: string | null; avatarUrl: string | null })[]> {
  const admin = createAdminClient();
  try {
    const { data } = await admin
      .from("verification_requests")
      .select(COLUMNS)
      .in("status", statuses)
      .order("submitted_at", { ascending: true, nullsFirst: false })
      .limit(limit);
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) return [];

    const { data: profiles } = await admin
      .from("profiles")
      .select("id, handle, display_name, avatar_url")
      .in("id", rows.map((r) => r.user_id));
    const byId = new Map(
      (profiles ?? []).map((p) => [
        p.id as string,
        { handle: p.handle as string | null, displayName: p.display_name as string | null, avatarUrl: p.avatar_url as string | null },
      ]),
    );

    return rows.map((r) => ({
      ...toRequest(r),
      handle: byId.get(r.user_id)?.handle ?? null,
      displayName: byId.get(r.user_id)?.displayName ?? null,
      avatarUrl: byId.get(r.user_id)?.avatarUrl ?? null,
    }));
  } catch {
    return [];
  }
}

/** Counts for the admin panel header. */
export async function verificationCounts(): Promise<{ pending: number; approved: number; rejected: number }> {
  const admin = createAdminClient();
  const one = async (status: VerificationStatus[]) => {
    try {
      const { count } = await admin
        .from("verification_requests")
        .select("id", { head: true, count: "exact" })
        .in("status", status);
      return count ?? 0;
    } catch {
      return 0;
    }
  };
  const [pending, approved, rejected] = await Promise.all([
    one(["pending", "in_review"]),
    one(["approved"]),
    one(["rejected"]),
  ]);
  return { pending, approved, rejected };
}

/**
 * Short-lived signed URLs for a request's images. The bucket is private, so this
 * is the ONLY way a reviewer sees them, and the link dies in 5 minutes rather
 * than living forever in a browser history or a screenshot.
 */
export async function signedDocumentUrls(
  request: Pick<VerificationRequest, "idFrontPath" | "idBackPath" | "selfiePath">,
): Promise<{ front: string | null; back: string | null; selfie: string | null }> {
  const admin = createAdminClient();
  const sign = async (path: string | null) => {
    if (!path) return null;
    try {
      const { data } = await admin.storage.from("verification-docs").createSignedUrl(path, 300);
      return data?.signedUrl ?? null;
    } catch {
      return null;
    }
  };
  const [front, back, selfie] = await Promise.all([
    sign(request.idFrontPath),
    sign(request.idBackPath),
    sign(request.selfiePath),
  ]);
  return { front, back, selfie };
}

/* ─────────────────────────────── Writes ────────────────────────────────── */

export async function recordVerificationEvent(
  requestId: string,
  actorId: string | null,
  actorRole: "user" | "admin" | "system",
  action: string,
  detail?: string,
): Promise<void> {
  try {
    await createAdminClient().from("verification_events").insert({
      request_id: requestId,
      actor_id: actorId,
      actor_role: actorRole,
      action,
      detail: detail ?? null,
    });
  } catch {
    /* the audit trail must never break the action it describes */
  }
}

/** Set (or clear) the tick on the profile itself. */
async function setProfileVerified(userId: string, verified: boolean): Promise<void> {
  await createAdminClient().from("profiles").update({ is_verified: verified }).eq("id", userId);
}

export async function approveVerification(
  requestId: string,
  reviewerId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  try {
    const { data, error } = await admin
      .from("verification_requests")
      .update({
        status: "approved",
        reviewer_id: reviewerId,
        reviewed_at: new Date().toISOString(),
        decision_reason: reason || null,
        rejection_code: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .select("user_id")
      .maybeSingle();
    if (error || !data) return { ok: false, error: error?.message ?? "Request not found." };

    await setProfileVerified(data.user_id as string, true);
    await recordVerificationEvent(requestId, reviewerId, "admin", "approved", reason);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to approve." };
  }
}

export async function rejectVerification(
  requestId: string,
  reviewerId: string,
  code: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  try {
    const { error } = await admin
      .from("verification_requests")
      .update({
        status: "rejected",
        reviewer_id: reviewerId,
        reviewed_at: new Date().toISOString(),
        rejection_code: code,
        decision_reason: reason || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId);
    if (error) return { ok: false, error: error.message };
    await recordVerificationEvent(requestId, reviewerId, "admin", "rejected", `${code}${reason ? ` — ${reason}` : ""}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to reject." };
  }
}

/**
 * Grant the tick immediately, with no application (owner: "admin can issue
 * directly to skip all the processes"). Still recorded as an approved request
 * flagged `issued_directly`, so the audit trail can always answer "who verified
 * this account, when, and why".
 */
export async function issueVerificationDirectly(
  userId: string,
  reviewerId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  try {
    // Close any open application first — the partial unique index allows only
    // one live request, and the member shouldn't be left with a pending form
    // after they've already been verified.
    await admin
      .from("verification_requests")
      .update({ status: "withdrawn", updated_at: now })
      .eq("user_id", userId)
      .in("status", ["draft", "pending", "in_review"]);

    const { data, error } = await admin
      .from("verification_requests")
      .insert({
        user_id: userId,
        status: "approved",
        category: "other",
        reviewer_id: reviewerId,
        reviewed_at: now,
        decision_reason: reason || "Issued directly by an administrator.",
        issued_directly: true,
        submitted_at: now,
      })
      .select("id")
      .maybeSingle();
    if (error) return { ok: false, error: error.message };

    await setProfileVerified(userId, true);
    if (data?.id) await recordVerificationEvent(data.id as string, reviewerId, "admin", "issued_directly", reason);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to issue." };
  }
}

/** Take the tick back (mistake, or the account changed hands). */
export async function revokeVerification(
  userId: string,
  reviewerId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  try {
    await setProfileVerified(userId, false);
    const { data } = await admin
      .from("verification_requests")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.id) {
      await admin
        .from("verification_requests")
        .update({ status: "rejected", rejection_code: "revoked", decision_reason: reason, updated_at: new Date().toISOString() })
        .eq("id", data.id as string);
      await recordVerificationEvent(data.id as string, reviewerId, "admin", "revoked", reason);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to revoke." };
  }
}
