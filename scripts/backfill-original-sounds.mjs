/**
 * Backfill an implicit "Original audio" sound for existing posts that
 * qualify but predate the auto-attach added to publishPost() (2026-08-18).
 *
 * 🔴 `platform = 'frenz'` ALONE IS NOT ENOUGH — caught by this script's own
 * first dry run, which returned ~100 posts, many titled things like "TikTok
 * video" / "Tiktok _@Kprez" with #fyp-style captions: obviously reposted
 * content, not original footage. Reason: `/api/reels/route.ts` (the "quick-
 * publish my download as a Reel" endpoint) hardcodes `platform: "frenz"` for
 * EVERY post it creates, regardless of true origin — it never even collects
 * a real source platform. `publishPost()` (used by `/api/posts`, the OTHER
 * publish path) does NOT have this problem — it passes through whatever
 * real platform name the caller sends (tiktok/instagram/etc. for a genuine
 * download-then-publish, "frenz" only for Creation Studio's own uploads) —
 * which is why the auto-attach added there is safe on its own. This script
 * queries raw `posts` rows though, which mixes rows from BOTH endpoints, so
 * it needs its OWN extra check: `source_url`'s hostname must be Frenz's own
 * media host. A genuine Creation Studio upload's `sourceUrl` is the just-
 * uploaded file's OWN Frenz-hosted URL; a "publish my download" post's
 * `sourceUrl` is the ORIGINAL third-party URL (download-player.tsx sends
 * `sourceUrl: rec.url`, the source it was downloaded FROM) even when
 * `platform` says "frenz". Hostname, not the `platform` column, is the
 * reliable signal.
 *
 * Usage:
 *   node scripts/backfill-original-sounds.mjs --dry
 *   node scripts/backfill-original-sounds.mjs
 */
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

const DRY = process.argv.includes("--dry");

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const OWN_MEDIA_HOST = new URL(process.env.R2_PUBLIC_BASE_URL).host;

function isOwnHost(url) {
  try {
    return new URL(url).host === OWN_MEDIA_HOST;
  } catch {
    return false;
  }
}

async function main() {
  const { data: rows, error } = await db
    .from("posts")
    .select("id, publisher_id, title, thumbnail_url, media_url, source_url, media_kind, duration_sec")
    .eq("platform", "frenz")
    .in("media_kind", ["video", "audio"])
    .is("sound_id", null)
    .eq("status", "published");

  if (error) {
    // Most likely cause: migration 0125 (sounds table / posts.sound_id) isn't
    // applied in this environment yet — fail loudly rather than silently, so
    // it isn't mistaken for "nothing to backfill".
    console.error("Query failed — is migration 0125 applied?", error.message);
    process.exit(1);
  }

  // The extra filter this script's own doc comment explains — `platform`
  // alone let ~100 obviously-reposted TikTok posts through on the first run.
  const posts = rows.filter((p) => isOwnHost(p.source_url));
  console.log(`${rows.length} platform=frenz row(s), ${posts.length} genuinely first-party after the host check.`);

  // Separate lookup, not an embedded join — avoids depending on PostgREST's
  // FK relationship cache recognizing posts->profiles under this exact name.
  const publisherIds = [...new Set(posts.map((p) => p.publisher_id))];
  const handleByPublisher = new Map();
  if (publisherIds.length) {
    const { data: profs } = await db.from("profiles").select("id, handle").in("id", publisherIds);
    for (const row of profs ?? []) handleByPublisher.set(row.id, row.handle);
  }

  let created = 0;
  for (const p of posts) {
    const audioUrl = p.media_url ?? p.source_url;
    if (!audioUrl) continue;
    const handle = handleByPublisher.get(p.publisher_id);
    console.log(`${DRY ? "[dry] " : ""}${p.id} (${p.title?.slice(0, 40) ?? ""})`);
    if (DRY) continue;

    const { data: sound, error: soundErr } = await db
      .from("sounds")
      .insert({
        created_by: p.publisher_id,
        source_type: "original",
        title: "Original audio",
        artist_label: handle ? `@${handle}` : "Original audio",
        cover_art_url: p.thumbnail_url ?? null,
        audio_url: audioUrl,
        waveform_peaks: [],
        duration_sec: Math.max(0, Math.round(p.duration_sec ?? 0)),
      })
      .select("id")
      .single();
    if (soundErr || !sound) {
      console.error(`  sound insert failed: ${soundErr?.message}`);
      continue;
    }
    const { error: attachErr } = await db.from("posts").update({ sound_id: sound.id }).eq("id", p.id);
    if (attachErr) {
      console.error(`  attach failed: ${attachErr.message}`);
      continue;
    }
    created++;
  }
  console.log(`${DRY ? "Would create" : "Created"} ${DRY ? posts.length : created} sound(s).`);
}

main();
