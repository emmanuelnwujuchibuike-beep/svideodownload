"use client";

import { Lock } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { profilePath } from "@/lib/social/profile-url";
import { cn } from "@/lib/utils";

import { BlurredSlides, type BlurSlideView } from "./blurred-slides";

/*
  An exclusive post a creator sent in a chat (0305 — owner, 2026-10-28: "if they're not a subscriber it should autoplay
  but blurred; if they are a subscriber it should show not blurred — make sure it is gated").

  Gated per viewer, on the server, every time: the card asks /api/sub/posts/[id]/preview, which says whether THIS viewer
  has access and otherwise returns only the post's public face (the blurred clip / still, the cover). With access, the
  post itself is opened through GET /api/sub/posts/[id] — the same route the Exclusive gallery uses, which checks the
  subscription again and mints five-minute private links. The message carries only the post id, so a forwarded card,
  an old card, or a lapsed subscription all fall back to the blurred face.
*/

type Preview = { access: boolean; creator: { handle: string | null; name: string; avatarUrl: string | null }; coverUrl: string | null; blurUrl: string | null; blurVideoUrl: string | null; slides?: BlurSlideView[]; items: number; hasVideo: boolean; mature: boolean };
type Opened = { caption: string | null; media: { kind: "image" | "video"; url: string }[] };

export function SubPostChatCard({ postId, mine }: { postId: string; mine: boolean }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch(`/api/sub/posts/${postId}/preview`, { cache: "no-store", credentials: "same-origin" });
        if (!r.ok) return alive && setGone(true);
        const p = (await r.json()) as Preview;
        if (!alive) return;
        setPreview(p);
        if (!p.access) return;
        const o = await fetch(`/api/sub/posts/${postId}`, { cache: "no-store", credentials: "same-origin" });
        if (o.ok && alive) setOpened((await o.json()) as Opened);
      } catch {
        if (alive) setGone(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [postId]);

  if (gone) return <p className={cn("px-1 text-sm italic", mine ? "text-white/80" : "text-frenz-muted")}>This exclusive post isn&apos;t available.</p>;
  if (!preview) return <div aria-busy="true" aria-label="Loading the exclusive post" className="aspect-[4/5] w-56 max-w-full animate-pulse rounded-[18px] bg-frenz-fill" />;

  const first = opened?.media[0] ?? null;
  const profile = preview.creator.handle ? `${profilePath(preview.creator.handle)}?tab=sub` : null;
  return (
    <div className="w-56 max-w-full overflow-hidden rounded-[18px] bg-[#1A1430] text-white">
      <div className="relative aspect-[4/5] overflow-hidden">
        {first ? (
          first.kind === "video" ? (
            <video src={first.url} muted loop playsInline autoPlay controls={false} onContextMenu={(e) => e.preventDefault()} className="h-full w-full object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- a five-minute private link, for a subscriber only
            <img src={first.url} alt="" draggable={false} onContextMenu={(e) => e.preventDefault()} className="h-full w-full object-cover" />
          )
        ) : (
          <>
            {/* every item blurred, sliding sideways (0306, owner 2026-10-29) */}
            <BlurredSlides slides={preview.slides} cover={preview.coverUrl} fallbackStill={preview.blurUrl} fallbackClip={preview.blurVideoUrl} />
            {preview.access ? null : (
              <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/25 px-4 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-full border border-white/30 bg-black/30">
                  <Lock className="h-5 w-5" aria-hidden />
                </span>
                <span className="text-sm font-bold">Exclusive{preview.mature ? " · 18+" : ""}</span>
                <span className="text-xs text-white/80">
                  {preview.items} {preview.hasVideo ? "item" : "photo"}
                  {preview.items === 1 ? "" : "s"} for subscribers
                </span>
              </span>
            )}
          </>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <span className="min-w-0 truncate text-[13px] font-semibold">{preview.creator.name}</span>
        {preview.access ? (
          opened?.caption ? null : <span className="shrink-0 text-[11px] font-semibold text-white/70">Subscribed</span>
        ) : profile ? (
          <Link href={profile} prefetch={false} className="shrink-0 rounded-full bg-frenz-gradient-x px-3 py-1.5 text-xs font-bold text-white">
            Subscribe
          </Link>
        ) : null}
      </div>
      {opened?.caption ? <p className="line-clamp-3 px-3 pb-3 text-[13px] text-white/85">{opened.caption}</p> : null}
    </div>
  );
}
