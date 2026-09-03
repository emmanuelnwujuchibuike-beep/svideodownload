"use client";

import { PLATFORMS } from "@/lib/platforms";
import type { BrowserClient } from "@/lib/supabase/client-instance";
import { getClient } from "@/lib/supabase/client-lazy";
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

/*
  Packed into the `downloads.format` column: formatId | kind | qualityLabel |
  sizeBytes | status | failureReason.

  🔴 THE LAST TWO FIELDS ARE WHY A FAILED DOWNLOAD SURVIVES A RELOAD (owner,
  2026-08-23: "i dont see the failed cancelled in history to retry").

  `manager.ts` writes failed/cancelled records to local history correctly, but
  a signed-in visitor's history is REHYDRATED from this table — and this
  encoding carried only four fields, so the status was silently dropped on
  every round trip. `fetchRemote` then rebuilt each record with no `status`,
  which `types/index.ts` defines as meaning "completed". The failure was
  written, mirrored, and read back as a success: the badge appeared until the
  next load and then vanished for good.

  Extending the packed string rather than adding columns keeps this a
  client-only fix with no migration to apply — this project's documented
  recurring failure mode is migrations that never get run, and history is the
  wrong place to gamble on one. Old rows split into four parts and leave the
  new fields `undefined`, which is exactly the "absent = completed"
  back-compat contract the type already specifies, so nothing already stored
  changes meaning.
*/
const SEP = "~|~";

/**
 * Escape SQL-LIKE metacharacters so a prefix match stays a literal prefix.
 *
 * `formatId` is extractor-supplied and `qualityLabel` is free text, so either
 * could contain `%` or `_` — which LIKE would read as wildcards, letting one
 * record's delete match an unrelated row. Postgres's default escape character
 * is a backslash, so that has to be escaped first or it would escape the
 * escapes.
 */
function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** A synced record's id is `remote:<dbId>`; extract the db id (or null). */
export function remoteId(id: string): string | null {
  return id.startsWith("remote:") ? id.slice(7) : null;
}

async function userId(
  supabase: BrowserClient,
): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

function encodeFormat(r: {
  formatId: string;
  kind: MediaKind;
  qualityLabel: string;
  size?: number | null;
  status?: DownloadRecord["status"];
  failureReason?: string | null;
}) {
  return [
    r.formatId,
    r.kind,
    r.qualityLabel,
    r.size ?? "",
    // "completed" is written as empty, matching the absent-means-completed
    // contract — so a normal record's packed string is byte-identical to what
    // it was before these fields existed.
    r.status && r.status !== "completed" ? r.status : "",
    // The separator is the field delimiter, so it cannot appear inside a
    // value. A reason is free text from an error path and could contain
    // anything; stripping is safer than escaping for a field that is only
    // ever displayed.
    (r.failureReason ?? "").split(SEP).join(" ").slice(0, 200),
  ].join(SEP);
}

/**
 * The dedupe key for `pushAdd` — deliberately EXCLUDES status.
 *
 * A retry of a failed download must REPLACE the failed row rather than sit
 * beside it (matching `addDownload`'s own url+formatId+kind dedupe in
 * store.ts). Matching on the full packed string would compare the status too,
 * so a successful retry would never find the failed row it supersedes and the
 * list would accumulate one entry per attempt.
 */
function dedupeFormat(r: { formatId: string; kind: MediaKind; qualityLabel: string; size?: number | null }) {
  return [r.formatId, r.kind, r.qualityLabel, r.size ?? ""].join(SEP);
}

export async function fetchRemote(): Promise<DownloadRecord[]> {
  if (!hasSupabase) return [];
  const supabase = await getClient();
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
    const [formatId = "best", kind = "video", qualityLabel = "", sizeStr = "", statusStr = "", reason = ""] =
      String(r.format ?? "").split(SEP);
    const platform = r.platform as PlatformId;
    const size = sizeStr ? Number(sizeStr) || null : null;
    // Anything unrecognised (including the empty string every pre-2026-08-23
    // row has) means completed — never trust a stored string to be one of the
    // two failure states without checking.
    /*
      🔴 ANY non-empty status is real — do not allowlist two of them.

      Owner, 2026-09-03: "failed, canceled and abandoned all shows completed".
      "abandoned" was the proof: this compared against exactly "failed" and
      "cancelled", so every other real outcome fell through to "completed" and a
      download that never finished was reported as one that did.

      The encoder writes an EMPTY field for a completed download and the real
      word for anything else, so a non-empty value here is by construction a
      genuine non-completed outcome. Trusting it needs no list, and a status
      added later survives this round trip instead of silently becoming a
      success.
    */
    const status: DownloadRecord["status"] =
      (statusStr || "completed") as DownloadRecord["status"];
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
      size,
      status,
      failureReason: status === "failed" && reason ? reason : null,
      createdAt: new Date(r.created_at).getTime(),
      favorite: !!r.is_favorite,
    } satisfies DownloadRecord;
  });
}

/** Inserts a record; returns its `remote:<id>` on success. */
export async function pushAdd(rec: DownloadRecord): Promise<string | null> {
  if (!hasSupabase) return null;
  const supabase = await getClient();
  const uid = await userId(supabase);
  if (!uid) return null;

  /*
    Avoid duplicates: drop any existing row for the same url+format first.

    Matched on the format PREFIX (everything up to the status field) rather
    than the whole packed string, because the trailing status/reason fields
    now vary between attempts at the same download. An exact match would mean
    a successful retry never found the failed row it supersedes, leaving one
    history entry per attempt. Still scoped to source_url AND format, so the
    1080p and audio versions of the same video remain separate rows, exactly
    as before.
  */
  await supabase
    .from("downloads")
    .delete()
    .eq("user_id", uid)
    .eq("source_url", rec.url)
    .like("format", `${likeEscape(dedupeFormat(rec))}%`);

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
  const supabase = await getClient();
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
  const supabase = await getClient();
  const uid = await userId(supabase);
  if (!uid) return;
  await supabase.from("downloads").delete().eq("id", dbId).eq("user_id", uid);
}

export async function pushClear(): Promise<void> {
  if (!hasSupabase) return;
  const supabase = await getClient();
  const uid = await userId(supabase);
  if (!uid) return;
  await supabase.from("downloads").delete().eq("user_id", uid);
}
