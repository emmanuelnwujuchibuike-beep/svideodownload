import type { Metadata } from "next";
import nextDynamic from "next/dynamic";
import { notFound } from "next/navigation";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { SoundHero } from "@/features/social/sound-hero";
import { jsonLd } from "@/lib/seo/json-ld";
import { PLATFORMS } from "@/lib/platforms";
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
    robots: { index: true, follow: true },
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

  const related = await listPostsForSound(sound.id, 24);

  const attribution =
    sound.sourceType === "downloaded" && sound.sourcePlatform
      ? `From ${PLATFORMS[sound.sourcePlatform as keyof typeof PLATFORMS]?.name ?? sound.sourcePlatform}`
      : null;

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
      <main className="container max-w-2xl pb-24 pt-[calc(var(--frenz-safe-top)+1.25rem)] lg:pt-24">
        <SoundHero
          soundId={sound.id}
          title={sound.title}
          artistLabel={sound.artistLabel}
          coverArtUrl={sound.coverArtUrl}
          audioUrl={sound.audioUrl}
          waveformPeaks={sound.waveformPeaks}
          durationSec={sound.durationSec}
          usageCount={sound.usageCount}
          playsCount={sound.playsCount}
          attribution={attribution}
        />

        {/* "Use this sound" — the same reel composer every other creation
            entry point uses, pre-seeded via the query param (see
            reel-composer.tsx). Signing in first if needed, same as any other
            create action. */}
        <a
          href={`/create/reel?sound=${sound.id}`}
          className="mt-4 flex w-full items-center justify-center rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-violet-600/30 transition hover:opacity-95 active:scale-[0.99]"
        >
          Use this sound
        </a>

        {related.length > 0 ? (
          <section className="mt-10">
            <h2 className="mb-3 text-lg font-semibold tracking-[-0.02em]">Reels using this sound</h2>
            <PostGrid posts={related} />
          </section>
        ) : (
          <p className="mt-10 text-center text-sm text-muted-foreground">No reels use this sound yet.</p>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
