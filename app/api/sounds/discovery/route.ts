import { NextResponse } from "next/server";

import { listNewSounds, listTrendingSounds, SOUND_GENRES, SOUND_MOODS, type SoundGenre, type SoundMood } from "@/lib/social/sounds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isMood(v: string | null): v is SoundMood {
  return !!v && (SOUND_MOODS as readonly string[]).includes(v);
}
function isGenre(v: string | null): v is SoundGenre {
  return !!v && (SOUND_GENRES as readonly string[]).includes(v);
}

/**
 * GET /api/sounds/discovery?mood=&genre= — trending (+ new, unfiltered only).
 * Split out of the /sounds page itself so the page's shell (header, filter
 * chips) can render instantly and this — the part that actually needs a DB
 * round-trip — loads after, behind a skeleton (see sound-discovery-client.tsx).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mood = isMood(url.searchParams.get("mood")) ? (url.searchParams.get("mood") as SoundMood) : null;
  const genre = isGenre(url.searchParams.get("genre")) ? (url.searchParams.get("genre") as SoundGenre) : null;
  const filtered = !!(mood || genre);

  const [trending, fresh] = await Promise.all([
    listTrendingSounds({ mood, genre, limit: filtered ? 60 : 20 }),
    filtered ? Promise.resolve([]) : listNewSounds(20),
  ]);

  return NextResponse.json({ trending, fresh }, { headers: { "Cache-Control": "private, max-age=15" } });
}
