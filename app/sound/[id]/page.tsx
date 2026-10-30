import type { Metadata } from "next";
import nextDynamic from "next/dynamic";
import { notFound } from "next/navigation";

import { SiteHeader } from "@/components/layout/site-header";
import { SoundHero } from "@/features/social/sound-hero";
import { SoundTopBar } from "@/features/social/sound-top-bar";
import { jsonLd } from "@/lib/seo/json-ld";
import { PLATFORMS } from "@/lib/platforms";
import { isCreatorVerified } from "@/lib/social/sound-library";
import { getSound, listPostsForSound } from "@/lib/social/sounds";
import { SITE_URL } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";

// "Reels using this sound" is below the fold on every visit — code-split like
// every other related-content grid (see app/p/[id]/page.tsx's PostGrid).
const PostGrid = nextDynamic(() => import("@/components/social/post-grid").then((m) => m.PostGrid));

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function viewerId(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!UUID.test(id)) return { title: "Not found", robots: { index: false, follow: false } };
  const sound = await getSound(id, null);
  if (!sound || !sound.isPublic) return { title: "Not found", robots: { index: false, follow: false } };
  return {
    title: `${sound.title} · ${sound.artistLabel}`,
    description: `Use "${sound.title}" by ${sound.artistLabel} in your own Reel on FrenzSave.`,
    alternates: { canonical: `/sound/${sound.id}` },
    // app-only since 2026-10-29 (lib/auth/app-only-paths.ts): never indexed
    robots: { index: false, follow: false },
    openGraph: {
      type: "music.song",
      title: sound.title,
      description: sound.artistLabel,
      images: sound.coverArtUrl ? [{ url: sound.coverArtUrl }] : undefined,
    },
  };
}

export default async function SoundPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const me = await viewerId();
  const sound = await getSound(id, me);
  if (!sound) notFound();
  // A private sound (still processing, or a creator who unpublished it) is
  // visible only to its own creator — everyone else gets the same 404 a
  // missing id would produce, never a "this is private" tell.
  if (!sound.isPublic && sound.createdBy !== me) notFound();

  const [related, verified] = await Promise.all([listPostsForSound(sound.id, 24), isCreatorVerified(sound.createdBy).catch(() => false)]);

  const attribution =
    sound.sourceType === "downloaded" && sound.sourcePlatform
      ? `From ${PLATFORMS[sound.sourcePlatform as keyof typeof PLATFORMS]?.name ?? sound.sourcePlatform}`
      : null;
  // the card's eyebrow: a downloaded sound is always credited (Feature 15 Part 7); a reel's own audio says so
  const label = attribution ?? (sound.sourceType === "original" ? "Original audio" : "Sound");

  const ld = {
    "@context": "https://schema.org",
    "@type": "MusicRecording",
    name: sound.title,
    byArtist: { "@type": "MusicGroup", name: sound.artistLabel },
    duration: sound.durationSec ? `PT${Math.max(1, Math.round(sound.durationSec))}S` : undefined,
    ...(sound.coverArtUrl ? { image: sound.coverArtUrl } : {}),
    url: `${SITE_URL}/sound/${sound.id}`,
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <SiteHeader social />
      {/* design/frenz-sounds.html (owner, 2026-10-30): the library's dark card for one sound, its section label for the
          reels, and NO site footer — this is an app screen, the bottom nav owns navigation */}
      <main className="mx-auto max-w-[480px] pb-[calc(var(--frenz-nav-clearance)+2rem)] pt-[var(--frenz-safe-top)] text-frenz-ink lg:pb-16 lg:pt-16">
        <SoundTopBar />
        <div className="px-5">
          <SoundHero
            soundId={sound.id}
            label={label}
            title={sound.title}
            artistLabel={sound.artistLabel}
            verified={verified}
            coverArtUrl={sound.coverArtUrl}
            audioUrl={sound.audioUrl}
            waveformPeaks={sound.waveformPeaks}
            durationSec={sound.durationSec}
            usageCount={sound.usageCount}
            playsCount={sound.playsCount}
          />
        </div>

        <div className="flex items-center gap-2.5 px-5 pb-3.5 pt-[34px]">
          <span className="h-2 w-2 rounded-full bg-frenz-blue" aria-hidden />
          <h2 className="text-[13px] font-bold uppercase tracking-[0.16em] text-frenz-muted">Reels using this sound</h2>
        </div>
        <div className="px-5">
          {related.length > 0 ? <PostGrid posts={related} /> : <p className="py-8 text-center text-sm text-frenz-muted">No reels use this sound yet. Be the first.</p>}
        </div>
      </main>
    </>
  );
}
