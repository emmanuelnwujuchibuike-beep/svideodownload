import { after } from "next/server";

import { writeAuditLog } from "@/lib/security/audit-log";
import { createAdminClient } from "@/lib/supabase/admin";
import { moderate, type TargetType } from "@/lib/social/moderation";

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface AppealItem {
  id: string;
  targetType: TargetType;
  targetId: string;
  message: string;
  status: "pending" | "upheld" | "overturned";
  adminNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** Own actioned content the viewer could appeal — a post/comment they own that's currently hidden/removed, or their own account if suspended. */
export interface AppealableItem {
  targetType: TargetType;
  targetId: string;
  title: string;
  status: string;
  hasPendingAppeal: boolean;
}

export async function listAppealableItems(viewerId: string): Promise<AppealableItem[]> {
  if (!hasSupabase) return [];
  const db = createAdminClient();
  const items: AppealableItem[] = [];

  const [{ data: posts }, { data: comments }, { data: profile }, { data: pending }] = await Promise.all([
    db.from("posts").select("id, title, status").eq("publisher_id", viewerId).in("status", ["removed", "under_review"]),
    db.from("post_comments").select("id, body, status").eq("author_id", viewerId).in("status", ["removed", "hidden"]),
    db.from("profiles").select("is_suspended").eq("id", viewerId).maybeSingle(),
    db.from("moderation_appeals").select("target_type, target_id").eq("user_id", viewerId).eq("status", "pending"),
  ]);

  const pendingKeys = new Set(((pending ?? []) as { target_type: TargetType; target_id: string }[]).map((p) => `${p.target_type}:${p.target_id}`));

  for (const p of (posts ?? []) as { id: string; title: string; status: string }[]) {
    items.push({ targetType: "post", targetId: p.id, title: p.title || "Untitled post", status: p.status, hasPendingAppeal: pendingKeys.has(`post:${p.id}`) });
  }
  for (const c of (comments ?? []) as { id: string; body: string; status: string }[]) {
    items.push({ targetType: "comment", targetId: c.id, title: `“${c.body.slice(0, 80)}”`, status: c.status, hasPendingAppeal: pendingKeys.has(`comment:${c.id}`) });
  }
  if (profile?.is_suspended) {
    items.push({ targetType: "user", targetId: viewerId, title: "Your account", status: "suspended", hasPendingAppeal: pendingKeys.has(`user:${viewerId}`) });
  }
  return items;
}

export async function listOwnAppeals(viewerId: string): Promise<AppealItem[]> {
  if (!hasSupabase) return [];
  const db = createAdminClient();
  // admin_note is deliberately NOT selected here — the admin queue's "note
  // (visible only to you)" must never reach the user it's about.
  const { data } = await db
    .from("moderation_appeals")
    .select("id, target_type, target_id, message, status, created_at, resolved_at")
    .eq("user_id", viewerId)
    .order("created_at", { ascending: false })
    .limit(50);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    targetType: r.target_type as TargetType,
    targetId: r.target_id as string,
    message: r.message as string,
    status: r.status as AppealItem["status"],
    adminNote: null,
    createdAt: r.created_at as string,
    resolvedAt: (r.resolved_at as string | null) ?? null,
  }));
}

/** Submit an appeal — verifies the target really is the caller's own actioned content first (never trust the client's word for it). */
export async function submitAppeal(
  userId: string,
  targetType: TargetType,
  targetId: string,
  message: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!hasSupabase) return { ok: false, reason: "unavailable" };
  const db = createAdminClient();

  let owns = false;
  let actionedStatus = false;
  if (targetType === "post") {
    const { data } = await db.from("posts").select("publisher_id, status").eq("id", targetId).maybeSingle();
    owns = data?.publisher_id === userId;
    actionedStatus = data?.status === "removed" || data?.status === "under_review";
  } else if (targetType === "comment") {
    const { data } = await db.from("post_comments").select("author_id, status").eq("id", targetId).maybeSingle();
    owns = data?.author_id === userId;
    actionedStatus = data?.status === "removed" || data?.status === "hidden";
  } else {
    owns = targetId === userId;
    const { data } = await db.from("profiles").select("is_suspended").eq("id", userId).maybeSingle();
    actionedStatus = !!data?.is_suspended;
  }
  if (!owns) return { ok: false, reason: "not_yours" };
  if (!actionedStatus) return { ok: false, reason: "not_actioned" };

  const { error } = await db.from("moderation_appeals").insert({ user_id: userId, target_type: targetType, target_id: targetId, message });
  if (error) return { ok: false, reason: error.code === "23505" ? "already_pending" : "unavailable" };

  after(() => writeAuditLog({ userId, eventType: "appeal_submitted", targetType, targetId }));
  return { ok: true };
}

/** Admin resolves an appeal — "overturned" reverses the original action (restore/unsuspend); "upheld" just closes it. */
export async function resolveAppeal(
  appealId: string,
  adminId: string,
  resolution: "upheld" | "overturned",
  adminNote: string | null,
): Promise<{ ok: boolean }> {
  if (!hasSupabase) return { ok: false };
  const db = createAdminClient();

  // Claim the appeal atomically — scoped by status="pending" so two admins
  // (or a duplicate/retried request) resolving the same appeal at once can't
  // both proceed; only the request that actually flips pending->resolved
  // gets a row back.
  const { data: appeal } = await db
    .from("moderation_appeals")
    .update({ status: resolution, admin_note: adminNote, resolved_by: adminId, resolved_at: new Date().toISOString() })
    .eq("id", appealId)
    .eq("status", "pending")
    .select("user_id, target_type, target_id")
    .maybeSingle();
  if (!appeal) return { ok: false };

  if (resolution === "overturned") {
    const action = appeal.target_type === "user" ? "unsuspend" : "restore";
    await moderate(appeal.target_type as TargetType, appeal.target_id as string, action, adminId);
    // moderate()'s own report-resolution only touches reports still "open",
    // since it's written for the fresh-report case — the reports that led to
    // THIS appeal are already "actioned". Flip them back so the reporter's
    // Trust Center reflects the reversal instead of permanently showing
    // "Action taken" for a decision that was overturned.
    await db
      .from("reports")
      .update({ status: "dismissed" })
      .eq("target_type", appeal.target_type)
      .eq("target_id", appeal.target_id)
      .eq("status", "actioned");
  }

  await writeAuditLog({
    userId: appeal.user_id as string,
    actorUserId: adminId,
    eventType: "appeal_resolved",
    targetType: appeal.target_type as TargetType,
    targetId: appeal.target_id as string,
    metadata: { resolution },
  });

  // notifications has no generic metadata column (see 0059's own comment) —
  // post_id is the one existing hook that fits a post appeal; comment/user
  // appeals just link to the appeals page itself (hrefFor below), same as
  // any other system-type notification with nothing more specific to point at.
  await db.from("notifications").insert({
    user_id: appeal.user_id,
    type: "moderation_appeal_resolved",
    post_id: appeal.target_type === "post" ? appeal.target_id : null,
  });

  return { ok: true };
}

export interface PendingAppeal extends AppealItem {
  userHandle: string | null;
}

export async function listPendingAppeals(): Promise<PendingAppeal[]> {
  if (!hasSupabase) return [];
  const db = createAdminClient();
  const { data } = await db
    .from("moderation_appeals")
    .select("id, user_id, target_type, target_id, message, status, admin_note, created_at, resolved_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(100);
  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return [];

  const userIds = [...new Set(rows.map((r) => r.user_id as string))];
  const { data: profiles } = await db.from("profiles").select("id, handle").in("id", userIds);
  const handleById = new Map(((profiles ?? []) as { id: string; handle: string | null }[]).map((p) => [p.id, p.handle]));

  return rows.map((r) => ({
    id: r.id as string,
    targetType: r.target_type as TargetType,
    targetId: r.target_id as string,
    message: r.message as string,
    status: r.status as AppealItem["status"],
    adminNote: (r.admin_note as string | null) ?? null,
    createdAt: r.created_at as string,
    resolvedAt: (r.resolved_at as string | null) ?? null,
    userHandle: handleById.get(r.user_id as string) ?? null,
  }));
}
