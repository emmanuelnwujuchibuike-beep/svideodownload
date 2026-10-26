import "server-only";

import { purgeCdnUrls } from "@/lib/storage/cdn-purge";
import { deleteStoredUpload } from "@/lib/storage";
import { parseUploadUrl, storageBasesFromEnv, type StorageBases, type StoredUpload } from "@/lib/storage/owned-media";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  STORIES — ENDING WHAT "DISAPPEARS IN 24 HOURS" PROMISED (Part 1, 2026-10-26)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The audit proved it on production: 69 story rows, every one expired, none
 * ever removed, and files that expired 117 days earlier still answering 200.
 * The composer tells a member their story disappears in 24 hours. The ring did.
 * Nothing else ever did.
 *
 * ── What one run does ───────────────────────────────────────────────────────
 *
 *   1. the oldest expired stories, a page at a time (`expires_at` is set by the
 *      DATABASE since 0285, so a client cannot hold a story back from here);
 *   2. the files each may own: OUR upload (lib/storage/owned-media.ts), owned by
 *      the story's author or, for a reshare, by the source's author. Anything
 *      else — a foreign URL, a key with no owner — is never touched;
 *   3. ONE database call asks which of those files any other row still uses
 *      (`story_media_references`: every *_url column, so a feed post, an album,
 *      a chat attachment or another story keeps its file). Only unused files go;
 *   4. the viewer list, then the story row — but only for a story whose own files
 *      are all gone. A file that failed to delete keeps its row, so the next run
 *      retries it instead of losing the only record of which file it was;
 *   5. Cloudflare is asked to forget the deleted files, when a purge token is set.
 *
 * ── Idempotent and bounded ──────────────────────────────────────────────────
 *
 * A deleted file answers "already gone" next time, and a removed row is not
 * selected again. Pages repeat until nothing is left or the time budget is
 * spent; a backlog simply finishes on the next run. Run once a day by
 * .github/workflows/cron-story-cleanup.yml — no polling, nothing while idle.
 *
 * Logs carry counts only: never a media URL, a user id or a story id.
 */

const PAGE = 100;
/** Stops starting new pages after this, well inside the route's maxDuration. */
const BUDGET_MS = 45_000;
/** More stories than this kept for a retry in one run ends the run; tomorrow's starts fresh. */
const MAX_SKIPPED = 300;

export interface StoryCleanupResult {
  /** Expired story rows removed (their viewer lists with them). */
  storiesDeleted: number;
  /** Viewer records removed. */
  viewsDeleted: number;
  /** Files removed from storage. */
  filesDeleted: number;
  /** Files kept because another row still uses them. */
  filesInUse: number;
  /** Cloudflare purge: whether it is configured, and how many URLs it forgot. */
  cdn: { configured: boolean; purged: number; errors: number };
  /** Stories kept for a retry because a file of theirs could not be removed. */
  retried: number;
  /** Database or storage errors — logged, never fatal. */
  errors: number;
  /** True when the time budget ended the run with expired stories still waiting. */
  more: boolean;
  ms: number;
}

interface ExpiredRow {
  id: string;
  user_id: string;
  media_url: string | null;
  thumbnail_url: string | null;
  reshared_from_user_id?: string | null;
}

/** The files a story may own: our uploads by its author or its reshare source. Pure. */
export function ownedStoryFiles(row: ExpiredRow, bases: StorageBases): { url: string; upload: StoredUpload }[] {
  const owners = new Set([row.user_id, row.reshared_from_user_id].filter((v): v is string => !!v).map((v) => v.toLowerCase()));
  const out: { url: string; upload: StoredUpload }[] = [];
  for (const url of [row.media_url, row.thumbnail_url]) {
    if (!url || out.some((o) => o.url === url)) continue;
    const upload = parseUploadUrl(url, bases);
    if (upload && owners.has(upload.ownerId)) out.push({ url, upload });
  }
  return out;
}

export async function runStoryCleanup(now: Date = new Date()): Promise<StoryCleanupResult> {
  const startedAt = Date.now();
  const admin = createAdminClient();
  const bases = storageBasesFromEnv();
  const result: StoryCleanupResult = {
    storiesDeleted: 0,
    viewsDeleted: 0,
    filesDeleted: 0,
    filesInUse: 0,
    cdn: { configured: false, purged: 0, errors: 0 },
    retried: 0,
    errors: 0,
    more: false,
    ms: 0,
  };
  /** Rows kept for a retry this run — never selected twice in one run. */
  const skip = new Set<string>();
  const purge: string[] = [];

  for (;;) {
    // the time budget, and a cap on the kept-for-retry list (it travels in the query string)
    if (Date.now() - startedAt > BUDGET_MS || skip.size > MAX_SKIPPED) {
      result.more = true;
      break;
    }
    let query = admin
      .from("stories")
      .select("id, user_id, media_url, thumbnail_url, reshared_from_user_id")
      .lte("expires_at", now.toISOString())
      .order("expires_at", { ascending: true })
      .limit(PAGE);
    if (skip.size > 0) query = query.not("id", "in", `(${[...skip].join(",")})`);
    const { data, error } = await query;
    if (error) {
      console.error("[stories/cleanup] expired query failed", { code: error.code });
      result.errors += 1;
      break;
    }
    const rows = (data ?? []) as ExpiredRow[];
    if (rows.length === 0) break;
    /** A short page is the last one — nothing older is waiting behind it. */
    const lastPage = rows.length < PAGE;

    const filesByRow = new Map(rows.map((r) => [r.id, ownedStoryFiles(r, bases)]));
    const urls = [...new Set([...filesByRow.values()].flat().map((f) => f.url))];

    // 3 · which files does anything else still use?
    let inUse = new Set<string>();
    if (urls.length > 0) {
      const refs = await admin.rpc("story_media_references", { p_urls: urls, p_exclude: rows.map((r) => r.id) });
      if (refs.error) {
        /*
          Fail SAFE, and keep the page whole: no file is deleted AND no row is
          removed, because a removed row is the only record of which file it
          used. The next run tries these again.
        */
        console.error("[stories/cleanup] reference check failed — this page is kept for the next run", { code: refs.error.code });
        result.errors += 1;
        for (const r of rows) skip.add(r.id);
        result.retried += rows.length;
        if (lastPage) break;
        continue;
      }
      inUse = new Set(((refs.data ?? []) as unknown[]).map((v) => (typeof v === "string" ? v : String((v as Record<string, unknown>)?.story_media_references ?? ""))));
    }

    // 4a · delete each unused file once; remember which failed
    const failed = new Set<string>();
    for (const url of urls) {
      if (inUse.has(url)) {
        result.filesInUse += 1;
        continue;
      }
      const upload = [...filesByRow.values()].flat().find((f) => f.url === url)!.upload;
      if (await deleteStoredUpload(upload)) {
        result.filesDeleted += 1;
        if (upload.backend === "r2") purge.push(url);
      } else {
        failed.add(url);
        result.errors += 1;
      }
    }

    // 4b · a story whose file could not be removed keeps its row for the next run
    const done: string[] = [];
    for (const row of rows) {
      if ((filesByRow.get(row.id) ?? []).some((f) => failed.has(f.url))) {
        skip.add(row.id);
        result.retried += 1;
      } else done.push(row.id);
    }

    if (done.length > 0) {
      const views = await admin.from("story_views").delete().in("story_id", done).select("story_id");
      if (views.error) {
        console.error("[stories/cleanup] viewer-list delete failed", { code: views.error.code });
        result.errors += 1;
        for (const id of done) skip.add(id);
        if (lastPage) break;
        continue;
      }
      result.viewsDeleted += views.data?.length ?? 0;
      // the expiry guard again: a row is only ever removed once it has ended
      const gone = await admin.from("stories").delete().in("id", done).lte("expires_at", now.toISOString()).select("id");
      if (gone.error) {
        console.error("[stories/cleanup] story delete failed", { code: gone.error.code });
        result.errors += 1;
        for (const id of done) skip.add(id);
        if (lastPage) break;
        continue;
      }
      result.storiesDeleted += gone.data?.length ?? 0;
    }
    if (lastPage) break;
  }

  // 5 · forget the CDN copies of what was deleted (optional — reported either way)
  result.cdn = await purgeCdnUrls(purge);
  result.ms = Date.now() - startedAt;
  console.info("[stories/cleanup] swept", result);
  return result;
}
