import { writeAuditLog } from "@/lib/security/audit-log";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Moderation queue + actions over the `reports` table. Open reports are grouped
 * by target so the admin acts once per reported item. All actions run via the
 * service role (admin-gated in the API route).
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export type TargetType = "post" | "comment" | "user";

export interface ReportedTarget {
  targetType: TargetType;
  targetId: string;
  count: number;
  reasons: string[];
  title: string;
  sublabel: string | null;
  handle: string | null; // creator/author/user handle for a profile link
  currentStatus: string | null;
  /** Part 11c — Claude's best-effort read on the reported content, null until scored (or for "user" targets, never scored). */
  aiAssessment: { category: string; severity: number; rationale: string } | null;
}

interface ReportRow {
  target_type: TargetType;
  target_id: string;
  reason: string;
  created_at: string;
}

/** Open reports grouped by target, newest first, enriched with target details. */
export async function listReportedTargets(limit = 100): Promise<ReportedTarget[]> {
  if (!hasSupabase) return [];
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("reports")
      .select("target_type, target_id, reason, created_at")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(1000);
    const rows = (data as ReportRow[]) ?? [];
    if (rows.length === 0) return [];

    // Group by (type,id).
    const groups = new Map<string, ReportedTarget>();
    for (const r of rows) {
      const key = `${r.target_type}:${r.target_id}`;
      const g = groups.get(key);
      if (g) {
        g.count += 1;
        if (!g.reasons.includes(r.reason) && g.reasons.length < 5) g.reasons.push(r.reason);
      } else {
        groups.set(key, {
          targetType: r.target_type,
          targetId: r.target_id,
          count: 1,
          reasons: [r.reason],
          title: r.target_id,
          sublabel: null,
          handle: null,
          currentStatus: null,
          aiAssessment: null,
        });
      }
    }
    const targets = [...groups.values()].slice(0, limit);

    const idsByType = (t: TargetType) => targets.filter((g) => g.targetType === t).map((g) => g.targetId);
    const postIds = idsByType("post");
    const commentIds = idsByType("comment");
    const userIds = idsByType("user");

    const [posts, comments, users] = await Promise.all([
      postIds.length
        ? db.from("posts").select("id, title, status, publisher_id").in("id", postIds)
        : Promise.resolve({ data: [] }),
      commentIds.length
        ? db.from("post_comments").select("id, body, status, author_id").in("id", commentIds)
        : Promise.resolve({ data: [] }),
      userIds.length
        ? db.from("profiles").select("id, handle, display_name, is_suspended").in("id", userIds)
        : Promise.resolve({ data: [] }),
    ]);

    // Resolve handles for post publishers / comment authors.
    const peopleIds = [
      ...((posts.data ?? []) as { publisher_id: string }[]).map((p) => p.publisher_id),
      ...((comments.data ?? []) as { author_id: string }[]).map((c) => c.author_id),
    ];
    const { data: people } = peopleIds.length
      ? await db.from("profiles").select("id, handle").in("id", peopleIds)
      : { data: [] };
    const handleById = new Map(((people ?? []) as { id: string; handle: string | null }[]).map((p) => [p.id, p.handle]));

    const postById = new Map(((posts.data ?? []) as Record<string, unknown>[]).map((p) => [p.id as string, p]));
    const commentById = new Map(((comments.data ?? []) as Record<string, unknown>[]).map((c) => [c.id as string, c]));
    const userById = new Map(((users.data ?? []) as Record<string, unknown>[]).map((u) => [u.id as string, u]));

    for (const g of targets) {
      if (g.targetType === "post") {
        const p = postById.get(g.targetId);
        if (p) {
          g.title = (p.title as string) || "Untitled post";
          g.currentStatus = p.status as string;
          g.handle = handleById.get(p.publisher_id as string) ?? null;
          g.sublabel = g.handle ? `@${g.handle}` : null;
        } else g.title = "Deleted post";
      } else if (g.targetType === "comment") {
        const c = commentById.get(g.targetId);
        if (c) {
          g.title = `“${(c.body as string).slice(0, 80)}”`;
          g.currentStatus = c.status as string;
          g.handle = handleById.get(c.author_id as string) ?? null;
          g.sublabel = g.handle ? `@${g.handle}` : null;
        } else g.title = "Deleted comment";
      } else {
        const u = userById.get(g.targetId);
        if (u) {
          g.title = (u.display_name as string) || (u.handle ? `@${u.handle as string}` : "User");
          g.handle = (u.handle as string) ?? null;
          g.currentStatus = (u.is_suspended as boolean) ? "suspended" : "active";
          g.sublabel = g.handle ? `@${g.handle}` : null;
        } else g.title = "Deleted user";
      }
    }

    // Part 11c — attach each target's AI risk assessment, if one exists.
    const { data: assessmentRows } = await db
      .from("moderation_ai_assessments")
      .select("target_type, target_id, category, severity, rationale")
      .in(
        "target_id",
        targets.map((t) => t.targetId),
      );
    const assessmentByKey = new Map(
      ((assessmentRows ?? []) as { target_type: TargetType; target_id: string; category: string; severity: number; rationale: string }[]).map((a) => [
        `${a.target_type}:${a.target_id}`,
        { category: a.category, severity: a.severity, rationale: a.rationale },
      ]),
    );
    for (const g of targets) {
      g.aiAssessment = assessmentByKey.get(`${g.targetType}:${g.targetId}`) ?? null;
    }

    return targets;
  } catch {
    return [];
  }
}

export type ModAction =
  | "remove" // remove post/comment
  | "restore" // restore post/comment to live
  | "suspend" // suspend user
  | "unsuspend"
  | "dismiss"; // close reports, no action

/** Apply a moderation action to a target and resolve its open reports. */
export async function moderate(
  targetType: TargetType,
  targetId: string,
  action: ModAction,
  /** Part 11c — the admin performing this action, for the audit log. */
  adminId?: string,
): Promise<{ ok: boolean }> {
  if (!hasSupabase) return { ok: false };
  const db = createAdminClient();

  // Resolve the content owner BEFORE acting — this is who the audit log
  // entry is about (`user_id`), distinct from `adminId` (`actor_user_id`).
  let ownerId: string | null = null;
  if (targetType === "post") {
    const { data } = await db.from("posts").select("publisher_id").eq("id", targetId).maybeSingle();
    ownerId = (data?.publisher_id as string | undefined) ?? null;
  } else if (targetType === "comment") {
    const { data } = await db.from("post_comments").select("author_id").eq("id", targetId).maybeSingle();
    ownerId = (data?.author_id as string | undefined) ?? null;
  } else {
    ownerId = targetId;
  }

  // 1) Apply the content/account action. NOTE: "dismiss" also un-hides content
  // that was AUTO-hidden by the report trigger (under_review/hidden) — scoped by
  // status so it never un-removes content an admin explicitly removed.
  if (targetType === "post") {
    if (action === "remove") await db.from("posts").update({ status: "removed" }).eq("id", targetId);
    else if (action === "restore") await db.from("posts").update({ status: "published" }).eq("id", targetId);
    else if (action === "dismiss")
      await db.from("posts").update({ status: "published" }).eq("id", targetId).eq("status", "under_review");
  } else if (targetType === "comment") {
    if (action === "remove") await db.from("post_comments").update({ status: "removed" }).eq("id", targetId);
    else if (action === "restore") await db.from("post_comments").update({ status: "visible" }).eq("id", targetId);
    else if (action === "dismiss")
      await db.from("post_comments").update({ status: "visible" }).eq("id", targetId).eq("status", "hidden");
  } else if (targetType === "user") {
    if (action === "suspend") await db.from("profiles").update({ is_suspended: true }).eq("id", targetId);
    else if (action === "unsuspend") await db.from("profiles").update({ is_suspended: false }).eq("id", targetId);
  }

  // 2) Resolve the open reports for this target.
  const resolved = action === "dismiss" || action === "restore" || action === "unsuspend" ? "dismissed" : "actioned";
  await db
    .from("reports")
    .update({ status: resolved })
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .eq("status", "open");

  // 3) Append-only accountability trail — every moderation action, who did
  // it, and to what, readable by the affected user's own Privacy Dashboard
  // (security_audit_log's RLS already lets `user_id` read their own rows).
  if (ownerId && adminId) {
    await writeAuditLog({
      userId: ownerId,
      actorUserId: adminId,
      eventType: "moderation_action",
      targetType,
      targetId,
      metadata: { action },
    });
  }

  return { ok: true };
}

export interface OwnReport {
  targetType: TargetType;
  targetId: string;
  reason: string;
  status: "open" | "actioned" | "dismissed";
  createdAt: string;
}

/**
 * Reports the viewer has FILED (not against them) — Friendship Trust
 * Center's "what happened to what I reported." `reports` has no
 * reporter-self-read RLS policy (only self-insert + admin-read), so this
 * goes through the service role, scoped correctly in code, same pattern as
 * `listOwnAppeals`.
 */
export async function listOwnReports(reporterId: string): Promise<OwnReport[]> {
  if (!hasSupabase) return [];
  const db = createAdminClient();
  const { data } = await db
    .from("reports")
    .select("target_type, target_id, reason, status, created_at")
    .eq("reporter_id", reporterId)
    .order("created_at", { ascending: false })
    .limit(50);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    targetType: r.target_type as TargetType,
    targetId: r.target_id as string,
    reason: r.reason as string,
    status: r.status as OwnReport["status"],
    createdAt: r.created_at as string,
  }));
}
