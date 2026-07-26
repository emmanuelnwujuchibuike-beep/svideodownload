"use client";
import { Home, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { ImageUpload } from "@/components/social/image-upload";
import { FEED_GRID_SLOTS, type LandingSettings } from "@/lib/landing/settings";
import { cn } from "@/lib/utils";

/**
 * Admin editor for the public landing page's two decorative image slots:
 *
 *  1. the still poster shown in the hero phone's reels tile (the mockup no longer
 *     plays a reel — that moved to /reels in full screen), and
 *  2. the four images in the 2×2 "feed grid" showcase section, which shows ONLY
 *     these admin-uploaded images and nothing until they are set.
 *
 * Both persist to `settings.landing` via /api/admin/landing and appear on `/` at
 * the next ISR regeneration. Empty is a valid state everywhere: the poster falls
 * back to a branded gradient and the grid section hides, so a fresh site is never
 * broken — it just hasn't been dressed yet.
 *
 * Uploads reuse the existing `ImageUpload` widget (Supabase Storage, public URL),
 * so nothing new touches storage.
 */
export function LandingEditor({ settings }: { settings: LandingSettings }) {
  const router = useRouter();
  const [reelsPosterUrl, setReelsPosterUrl] = useState(settings.reelsPosterUrl);
  // A fixed 4-length array of nullable slots so each grid cell has a stable
  // position in the UI; compacted to the non-empty URLs on save.
  const [grid, setGrid] = useState<(string | null)[]>(() => {
    const slots: (string | null)[] = Array.from({ length: FEED_GRID_SLOTS }, () => null);
    settings.feedGridImages.slice(0, FEED_GRID_SLOTS).forEach((url, i) => {
      slots[i] = url;
    });
    return slots;
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const setSlot = (i: number, url: string | null) =>
    setGrid((g) => g.map((v, idx) => (idx === i ? url : v)));

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
          feedGridImages: grid.filter((v): v is string => !!v),
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

  const filledGrid = grid.filter(Boolean).length;

  return (
    <section className="rounded-3xl border border-border bg-card p-6 shadow-card">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <Home className="h-5 w-5 text-primary" /> Landing page images
      </h2>
      <p className="mb-6 text-sm text-muted-foreground">
        The two image slots the landing redesign added. Everything else on{" "}
        <code className="font-mono">/</code> is baked in for speed — these are the
        only pieces you drive from here.
      </p>

      <form onSubmit={save} className="space-y-8">
        {/* Reels-tile poster */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Hero reels poster</p>
              <p className="text-xs text-muted-foreground">
                The still shown in the phone mockup&rsquo;s reels tile. Tapping it
                opens <code className="font-mono">/reels</code> in full screen.
                Portrait (9:16) looks best. Leave empty for a branded gradient.
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
            <ImageUpload kind="banner" value={reelsPosterUrl || null} onChange={setReelsPosterUrl} />
          </div>
        </div>

        {/* 2×2 feed grid */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">
                Feed grid — {filledGrid}/{FEED_GRID_SLOTS} images
              </p>
              <p className="text-xs text-muted-foreground">
                The 2×2 showcase grid on the landing page. Only these images show
                there — real posts never do. The section is hidden until you add at
                least one.
              </p>
            </div>
          </div>
          <div className="grid max-w-md grid-cols-2 gap-3">
            {grid.map((url, i) => (
              <div key={i} className="relative">
                <ImageUpload kind="banner" value={url} onChange={(u) => setSlot(i, u)} />
                {url ? (
                  <button
                    type="button"
                    onClick={() => setSlot(i, null)}
                    aria-label={`Remove image ${i + 1}`}
                    className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <span className="pointer-events-none absolute left-2 top-2 rounded-md bg-black/40 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    Slot {i + 1}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

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
