"use client";

import { PLATFORMS } from "@/lib/platforms";
import { createClient } from "@/lib/supabase/client";
import type { DownloadRecord, MediaKind, PlatformId } from "@/types";

/**
 * Optional Supabase sync for download history. When the visitor is signed in,
 * their history is mirrored to the `downloads` table (owner-scoped RLS) so it
 * follows them across devices. Everything is best-effort and a no-op when
 * Supabase isn't configured or the user is logged out — local history still works.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const SEP = "~|~"; // formatId | kind | qualityLabel

/** A synced record's id is `remote:<dbId>`; extract the db id (or null). */
export function remoteId(id: string): string | null {
  return id.startsWith("remote:") ? id.slice(7) : null;
}

async function userId(
  supabase: ReturnType<typeof createClient>,
): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

function encodeFormat(r: { formatId: string; kind: MediaKind; qualityLabel: string }) {
  return [r.formatId, r.kind, r.qualityLabel].join(SEP);
}

export async function fetchRemote(): Promise<DownloadRecord[]> {
  if (!hasSupabase) return [];
  const supabase = createClient();
  const uid = await userId(supabase);
  if (!uid) return [];

  const { data, error } = await supabase
    .from("downloads")
    .select("id, source_url, platform, title, thumbnail, format, is_favorite, created_at")
    .eq("user_id", uid)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error || !data) return [];

  return data.map((r) => {
    const [formatId = "best", kind = "video", qualityLabel = ""] = String(
      r.format ?? "",
    ).split(SEP);
    const platform = r.platform as PlatformId;
    return {
      id: `remote:${r.id}`,
      url: r.source_url,
      platform,
      platformName: PLATFORMS[platform]?.name ?? r.platform,
      title: r.title ?? "",
      thumbnail: r.thumbnail ?? null,
      formatId,
      kind: kind as MediaKind,
      qualityLabel,
      createdAt: new Date(r.created_at).getTime(),
      favorite: !!r.is_favorite,
    } satisfies DownloadRecord;
  });
}

/** Inserts a record; returns its `remote:<id>` on success. */
export async function pushAdd(rec: DownloadRecord): Promise<string | null> {
  if (!hasSupabase) return null;
  const supabase = createClient();
  const uid = await userId(supabase);
  if (!uid) return null;

  // Avoid duplicates: drop any existing row with the same url+format first.
  await supabase
    .from("downloads")
    .delete()
    .eq("user_id", uid)
    .eq("source_url", rec.url)
    .eq("format", encodeFormat(rec));

  const { data, error } = await supabase
    .from("downloads")
    .insert({
      user_id: uid,
      source_url: rec.url,
      platform: rec.platform,
      title: rec.title,
      thumbnail: rec.thumbnail,
      format: encodeFormat(rec),
      is_favorite: rec.favorite,
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return `remote:${data.id}`;
}

export async function pushFavorite(dbId: string, favorite: boolean): Promise<void> {
  if (!hasSupabase) return;
  const supabase = createClient();
  const uid = await userId(supabase);
  if (!uid) return;
  await supabase
    .from("downloads")
    .update({ is_favorite: favorite })
    .eq("id", dbId)
    .eq("user_id", uid);
}

export async function pushRemove(dbId: string): Promise<void> {
  if (!hasSupabase) return;
  const supabase = createClient();
  const uid = await userId(supabase);
  if (!uid) return;
  await supabase.from("downloads").delete().eq("id", dbId).eq("user_id", uid);
}

export async function pushClear(): Promise<void> {
  if (!hasSupabase) return;
  const supabase = createClient();
  const uid = await userId(supabase);
  if (!uid) return;
  await supabase.from("downloads").delete().eq("user_id", uid);
}
