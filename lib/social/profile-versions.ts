import {
  diffSnapshots,
  isWorthVersioning,
  MAX_VERSIONS,
  readSnapshot,
  versionLabel,
  type ProfileSnapshot,
  type ProfileVersion,
} from "@/lib/profile/versions";
import { getProfileAppearance } from "@/lib/social/profile-appearance";
import { getProfileIdentity, getProfileModules } from "@/lib/social/profile-platform";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Profile version history — the data layer (migration 0114).
 *
 * Fail-closed and independent, like every profile reader here. Before 0114 is
 * applied, `listVersions` returns nothing and `captureVersion` quietly does
 * nothing — history is simply absent rather than every profile save failing
 * because a side effect could not be recorded.
 *
 * That direction matters more than usual: capturing a version is a courtesy
 * that happens AFTER the member's real change has been written. It must never
 * be able to fail their save.
 */

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/** The member's layout choices, right now, assembled from the live tables. */
export async function currentSnapshot(userId: string): Promise<ProfileSnapshot | null> {
  try {
    const [identity, modules, appearance] = await Promise.all([
      getProfileIdentity(userId),
      getProfileModules(userId),
      getProfileAppearance(userId),
    ]);
    return {
      type: identity.type,
      landing: identity.landingModule ?? null,
      modules: modules.map((m) => ({
        key: m.moduleKey,
        enabled: m.enabled,
        position: m.position,
        audience: String(m.audience),
      })),
      theme: appearance.theme,
      surface: appearance.surface,
      radius: appearance.radius,
      fontScale: appearance.fontScale,
    };
  } catch {
    return null;
  }
}

export async function listVersions(userId: string): Promise<ProfileVersion[]> {
  if (!hasSupabase) return [];
  try {
    const { data, error } = await createAdminClient()
      .from("profile_versions")
      .select("id, label, snapshot, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(MAX_VERSIONS);
    if (error) return [];
    return ((data ?? []) as Record<string, unknown>[])
      .map((r) => {
        const snapshot = readSnapshot(r.snapshot);
        if (!snapshot) return null;
        return {
          id: String(r.id),
          label: String(r.label ?? "Saved version"),
          createdAt: String(r.created_at),
          snapshot,
        } satisfies ProfileVersion;
      })
      .filter((v): v is ProfileVersion => v !== null);
  } catch {
    return [];
  }
}

/**
 * Record a version, if this save actually changed anything.
 *
 * Fire-and-forget by design — the caller has already written the member's
 * change, and a failure to journal it must not surface as a failed save. It
 * also compares against the NEWEST stored version rather than blindly
 * inserting, so repeatedly pressing Save does not fill the list with
 * "No visible change".
 */
export async function captureVersion(userId: string): Promise<void> {
  if (!hasSupabase) return;
  try {
    const next = await currentSnapshot(userId);
    if (!next) return;

    const [newest] = await listVersions(userId);
    if (!isWorthVersioning(newest?.snapshot ?? null, next)) return;

    const label = versionLabel(diffSnapshots(newest?.snapshot ?? null, next));
    await createAdminClient()
      .from("profile_versions")
      .insert({ user_id: userId, label: label.slice(0, 120), snapshot: next });
  } catch {
    /* history is a courtesy; never let it break a save */
  }
}

export type RestoreResult = { ok: true } | { ok: false; error: string };

/**
 * Restore one version's LAYOUT.
 *
 * The three writes are independent rather than a transaction — the same
 * reasoning as applying a Layout Preset. Type, modules and appearance live in
 * different tables whose migrations may not all be applied, and a partial
 * restore leaves a coherent profile (the engine falls back for whatever is
 * missing) where an all-or-nothing restore would refuse to move anything
 * because one table is behind.
 *
 * Content is untouched, and cannot be touched: the snapshot does not contain
 * any.
 */
export async function restoreVersion(userId: string, versionId: string): Promise<RestoreResult> {
  if (!hasSupabase) return { ok: false, error: "Version history isn't available yet." };

  let snapshot: ProfileSnapshot | null = null;
  try {
    const { data, error } = await createAdminClient()
      .from("profile_versions")
      .select("snapshot")
      .eq("id", versionId)
      // Scoped to the owner in the query itself: the admin client bypasses
      // RLS, so "you can only guess a uuid" is not an authorisation check.
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return { ok: false, error: "That version is no longer available." };
    snapshot = readSnapshot((data as { snapshot: unknown }).snapshot);
  } catch {
    return { ok: false, error: "Couldn't read that version." };
  }
  if (!snapshot) return { ok: false, error: "That version can't be read." };

  const db = createAdminClient();
  const failed: string[] = [];

  try {
    const { error } = await db
      .from("profiles")
      .update({ profile_type: snapshot.type, landing_module: snapshot.landing })
      .eq("id", userId);
    if (error) failed.push("type");
  } catch {
    failed.push("type");
  }

  if (snapshot.modules.length > 0) {
    try {
      const rows = snapshot.modules.map((m, index) => ({
        user_id: userId,
        module_key: m.key,
        enabled: m.enabled,
        // Position comes from the snapshot's ORDER, so restored positions are
        // always dense even if the stored numbers had gaps.
        position: index,
        audience: m.audience,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await db.from("profile_modules").upsert(rows, { onConflict: "user_id,module_key" });
      if (error) failed.push("sections");
    } catch {
      failed.push("sections");
    }
  }

  try {
    const { error } = await db.from("profile_appearance").upsert(
      {
        user_id: userId,
        theme: snapshot.theme,
        surface: snapshot.surface,
        radius: snapshot.radius,
        font_scale: snapshot.fontScale,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) failed.push("theme");
  } catch {
    failed.push("theme");
  }

  if (failed.length === 3) return { ok: false, error: "Couldn't restore that version." };
  return { ok: true };
}
