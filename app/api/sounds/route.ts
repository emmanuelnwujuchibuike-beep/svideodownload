import { NextResponse } from "next/server";
import { z } from "zod";

import { PLATFORMS } from "@/lib/platforms";
import { createSound, SOUND_GENRES, SOUND_MOODS } from "@/lib/social/sounds";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  title: z.string().trim().min(1).max(120),
  artistLabel: z.string().trim().min(1).max(80),
  audioUrl: z.string().url().max(2048),
  waveformPeaks: z.array(z.number()).max(200),
  durationSec: z.number().min(0).max(3600),
  moodTag: z.enum(SOUND_MOODS).nullable().optional(),
  genreTag: z.enum(SOUND_GENRES).nullable().optional(),
  coverArtUrl: z.string().url().max(2048).nullable().optional(),
  /**
   * Present only for a sound published from a Downloader-fetched clip
   * (Feature 15 Part 7, owner-approved: shareable but clearly attributed).
   * Both required together — `createSound` and the DB check constraint both
   * reject a "downloaded" sound missing either.
   */
  sourcePlatform: z.string().max(40).nullable().optional(),
  sourceUrl: z.string().url().max(2048).nullable().optional(),
});

/**
 * POST /api/sounds — publish a new sound. The audio itself is already
 * uploaded by the caller (via presignUpload/uploadWithPlan, same pipeline
 * every other media upload uses) before this is called; this just records
 * the row. Two callers: the Reel composer's own-audio path is NOT here (it
 * has no picker yet — see docs/FEATURE_15_PART_7_MUSIC.md tranches), and
 * History/Library's "Publish as sound" action on a downloaded audio item.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid sound." }, { status: 400 });
  const { sourcePlatform, sourceUrl } = parsed.data;

  // A real, known platform — never an arbitrary string dressed up as an
  // attribution (mirrors detectPlatform()'s own whitelist).
  if (sourcePlatform && !(sourcePlatform in PLATFORMS)) {
    return NextResponse.json({ error: "Unrecognized platform." }, { status: 400 });
  }
  const sourceType = sourcePlatform && sourceUrl ? "downloaded" : "original";

  const sound = await createSound({
    createdBy: user.id,
    sourceType,
    sourcePlatform: sourceType === "downloaded" ? sourcePlatform : null,
    sourceUrl: sourceType === "downloaded" ? sourceUrl : null,
    title: parsed.data.title,
    artistLabel: parsed.data.artistLabel,
    coverArtUrl: parsed.data.coverArtUrl ?? null,
    audioUrl: parsed.data.audioUrl,
    waveformPeaks: parsed.data.waveformPeaks,
    durationSec: parsed.data.durationSec,
    moodTag: parsed.data.moodTag ?? null,
    genreTag: parsed.data.genreTag ?? null,
  });
  if (!sound) return NextResponse.json({ error: "Couldn't publish this sound." }, { status: 500 });

  return NextResponse.json({ ok: true, soundId: sound.id });
}
