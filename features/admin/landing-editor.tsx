"use client";
import { Home, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { ImageUpload } from "@/components/social/image-upload";
import { LANDING_IMAGE_ASPECT, type LandingSettings } from "@/lib/landing/settings";
import { cn } from "@/lib/utils";

/**
 * Admin editor for the public landing page's decorative image slots:
 *
 *  1. the still poster shown in the hero phone's reels tile (the mockup no longer
 *     plays a reel — that moved to /reels in full screen), and
 *  2. the Wallpaper CTA tile's background.
 *
 * The 2×2 "feed grid" slot was removed 2026-08-23 along with the landing section
 * it fed — see the note further down.
 *
 * Both persist to `settings.landing` via /api/admin/landing and appear on `/` at
 * the next ISR regeneration. Empty is a valid state: the poster falls back to a
 * branded gradient, so a fresh site is never broken — it just hasn't been
 * dressed yet.
 *
 * Uploads reuse the existing `ImageUpload` widget (Supabase Storage, public URL),
 * so nothing new touches storage.
 */
export function LandingEditor({ settings }: { settings: LandingSettings }) {
  const router = useRouter();
  const [reelsPosterUrl, setReelsPosterUrl] = useState(settings.reelsPosterUrl);
  const [wallpaperCtaImageUrl, setWallpaperCtaImageUrl] = useState(settings.wallpaperCtaImageUrl);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/landing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reelsPosterUrl,
          wallpaperCtaImageUrl,
        }),
      });
      const json = await res.json();
      setMsg(
        res.ok
          ? { ok: true, text: "Saved — live on the landing page within a minute." }
          : { ok: false, text: json.error ?? "Failed to save." },
      );
      if (res.ok) router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };


  return (
    <section className="rounded-3xl border border-border bg-card px-3 py-6 sm:px-6 shadow-card">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <Home className="h-5 w-5 text-primary" /> Landing page images
      </h2>
      <p className="mb-6 text-sm text-muted-foreground">
        The two image slots the landing redesign added. Everything else on{" "}
        <code className="font-mono">/</code> is baked in for speed — these are the
        only pieces you drive from here.
      </p>
      {/*
        🔴 Says the one thing an operator needs to know and could not previously
        rely on. Each picker below now crops to the exact shape of the box its
        image lands in (see LANDING_IMAGE_ASPECT), so the crop frame is a real
        preview rather than an approximation.
      */}
      <p className="mb-6 rounded-xl bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
        Each slot crops to the shape it is shown in, so whatever you frame in{" "}
        <strong className="font-semibold text-foreground">Position your photo</strong> is
        exactly what appears on the page — nothing is cut off afterwards.
        Images uploaded before this change were cropped to 16:9 and will be
        trimmed to fit; re-upload them to reframe.
      </p>

      <form onSubmit={save} className="space-y-8">
        {/* Reels-tile poster */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Hero reels poster</p>
              <p className="text-xs text-muted-foreground">
                The still shown in the phone mockup&rsquo;s screen. Crops to the
                shape of that window (portrait, about 7:10) — upload any photo and
                frame it. Leave empty for a branded gradient.
              </p>
            </div>
            {reelsPosterUrl ? (
              <button
                type="button"
                onClick={() => setReelsPosterUrl("")}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground transition hover:text-foreground"
              >
                <X className="h-3 w-3" /> Clear
              </button>
            ) : null}
          </div>
          <div className="max-w-xs">
            <ImageUpload
              kind="banner"
              value={reelsPosterUrl || null}
              onChange={setReelsPosterUrl}
              aspect={LANDING_IMAGE_ASPECT.reelsPoster}
              // The window renders ~262 CSS px wide, so 512 on the long edge is
              // already soft on a 3x screen before the optimizer sees it.
              outputLongEdge={1200}
            />
          </div>
        </div>

        {/*
          Wallpaper Gallery button background (owner, 2026-08-09: "the wallpaper
          button image upload is supposed to be in the landing page section").

          It shipped first inside the Wallpapers manager, as a pick-from-library
          control. The owner is right that it belongs here: this is a
          landing-page image slot and it sits beside the other two, so an
          operator changes what the front page looks like in ONE place instead
          of hunting through a library manager for a landing setting.
        */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Wallpaper Gallery button</p>
              <p className="text-xs text-muted-foreground">
                The photo behind the &ldquo;Wallpaper Gallery&rdquo; button on the landing
                page and the download page. Crops close to square, which is the
                shape of the landing tile; the wide button on the download page
                shows a band from the middle of it. A dark overlay sits on the bottom
                third so the title stays readable over any image. Leave empty for
                the brand gradient.
              </p>
            </div>
            {wallpaperCtaImageUrl ? (
              <button
                type="button"
                onClick={() => setWallpaperCtaImageUrl("")}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground transition hover:text-foreground"
              >
                <X className="h-3 w-3" /> Clear
              </button>
            ) : null}
          </div>
          <div className="max-w-xs">
            <ImageUpload
              kind="banner"
              value={wallpaperCtaImageUrl || null}
              onChange={setWallpaperCtaImageUrl}
              aspect={LANDING_IMAGE_ASPECT.wallpaperCta}
              // The landing's measured LCP element. It renders ~185 CSS px wide
              // on a phone and up to 300 in the desktop column.
              outputLongEdge={1200}
            />
          </div>
        </div>

        {/*
          🔴 The 2x2 feed-grid slot is REMOVED (owner, 2026-08-23), together with
          the landing section it fed.

          The "Premium Experience" panel that rendered these four images is gone
          from the landing page — a cold-start audit measured it as the LCP
          element — and image browsing now lives on /wallpapers. An upload
          control whose output renders nowhere is a dead affordance: an operator
          would keep curating four images no visitor could ever see.
        */}

        <div>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save landing images
          </button>
          {msg ? (
            <span className={cn("ml-3 text-sm", msg.ok ? "text-green-500" : "text-red-400")}>
              {msg.text}
            </span>
          ) : null}
        </div>
      </form>
    </section>
  );
}
