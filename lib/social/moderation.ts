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
): Promise<{ ok: boolean }> {
  if (!hasSupabase) return { ok: false };
  const db = createAdminClient();

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

  return { ok: true };
}
