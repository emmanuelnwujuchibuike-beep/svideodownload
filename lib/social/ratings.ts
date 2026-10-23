import { createAdminClient } from "@/lib/supabase/admin";

/**
 * App ratings — the admin read side (migration 0111).
 *
 * Fail-closed and independent, like every other reader in this codebase: with
 * 0111 unapplied the panel shows an empty state rather than a broken page, and
 * says plainly that the migration is pending — which is the actual answer to
 * "why is this empty", and the one an operator can act on.
 */

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface RatingRow {
  id: string;
  rating: number;
  comment: string | null;
  downloads: number | null;
  surface: string | null;
  createdAt: string;
  /** Null for a guest — the downloader needs no account. */
  userId: string | null;
  handle: string | null;
  displayName: string | null;
  /** 0267 — who rated, for the admin: the device's abuse-protection id, its fingerprint, the network address and browser, and the device traits. */
  deviceId: string | null;
  fingerprint: string | null;
  ip: string | null;
  userAgent: string | null;
  device: Record<string, unknown> | null;
  /** An active ban made from this rating. */
  banned: boolean;
}

export interface RatingsSummary {
  rows: RatingRow[];
  total: number;
  average: number | null;
  /** Count per star, 1..5. */
  distribution: [number, number, number, number, number];
  /** True when the read failed outright — usually 0111 not applied. */
  unavailable: boolean;
}

const EMPTY: RatingsSummary = {
  rows: [],
  total: 0,
  average: null,
  distribution: [0, 0, 0, 0, 0],
  unavailable: true,
};

export async function getRatings(limit = 100): Promise<RatingsSummary> {
  if (!hasSupabase) return EMPTY;
  try {
    const db = createAdminClient();
    // 0267's columns first; before it is applied the same read without them, so the panel never goes blank
    const BASE = "id, user_id, rating, comment, downloads, surface, created_at";
    let res = await db.from("app_ratings").select(`${BASE}, device_id, fingerprint, ip, user_agent, device`).order("created_at", { ascending: false }).limit(limit);
    if (res.error) res = (await db.from("app_ratings").select(BASE).order("created_at", { ascending: false }).limit(limit)) as typeof res;
    const { data, error } = res;
    if (error) return EMPTY;

    const raw = (data ?? []) as {
      id: string;
      user_id: string | null;
      rating: number;
      comment: string | null;
      downloads: number | null;
      surface: string | null;
      created_at: string;
      device_id?: string | null;
      fingerprint?: string | null;
      ip?: string | null;
      user_agent?: string | null;
      device?: Record<string, unknown> | null;
    }[];

    // which of these ratings carry an active ban (0267; an unapplied migration simply means none)
    const bannedIds = new Set<string>();
    if (raw.length) {
      const { data: bans } = await db.from("app_bans").select("rating_id").in("rating_id", raw.map((r) => r.id)).is("lifted_at", null);
      for (const b of (bans ?? []) as { rating_id: string | null }[]) if (b.rating_id) bannedIds.add(b.rating_id);
    }

    // One lookup for every named rater, not one per row.
    const ids = [...new Set(raw.map((r) => r.user_id).filter((id): id is string => !!id))];
    const profiles = new Map<string, { handle: string | null; displayName: string | null }>();
    if (ids.length > 0) {
      try {
        const { data: rows } = await db.from("profiles").select("id, handle, display_name").in("id", ids);
        for (const p of (rows ?? []) as { id: string; handle: string | null; display_name: string | null }[]) {
          profiles.set(p.id, { handle: p.handle, displayName: p.display_name });
        }
      } catch {
        /* names are a nicety — the ratings still render without them */
      }
    }

    const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    let sum = 0;
    for (const r of raw) {
      const star = Math.min(5, Math.max(1, Math.round(r.rating))) as 1 | 2 | 3 | 4 | 5;
      distribution[star - 1] = (distribution[star - 1] ?? 0) + 1;
      sum += star;
    }

    return {
      rows: raw.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        downloads: r.downloads,
        surface: r.surface,
        createdAt: r.created_at,
        userId: r.user_id,
        handle: r.user_id ? (profiles.get(r.user_id)?.handle ?? null) : null,
        displayName: r.user_id ? (profiles.get(r.user_id)?.displayName ?? null) : null,
        deviceId: r.device_id ?? null,
        fingerprint: r.fingerprint ?? null,
        ip: r.ip ?? null,
        userAgent: r.user_agent ?? null,
        device: r.device ?? null,
        banned: bannedIds.has(r.id),
      })),
      total: raw.length,
      average: raw.length > 0 ? Math.round((sum / raw.length) * 10) / 10 : null,
      distribution,
      unavailable: false,
    };
  } catch {
    return EMPTY;
  }
}
