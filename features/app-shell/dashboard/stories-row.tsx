"use client";

import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useQuery } from "@/features/data";
import { openUpload } from "@/features/create/upload-store";
import type { StoryGroup } from "@/lib/social/stories";

const IMAGE_MS = 5000;

export function StoriesRow({
  initialGroups,
  viewerAvatarUrl,
  viewerName,
}: {
  initialGroups?: StoryGroup[];
  viewerAvatarUrl?: string | null;
  viewerName?: string;
}) {
  // Seeded from the server + cached-first: paints instantly, refreshed in background.
  const { data } = useQuery<StoryGroup[]>(
    "stories",
    async () => {
      const r = await fetch("/api/stories");
      if (!r.ok) return [];
      const d = (await r.json()) as { groups: StoryGroup[] };
      return d.groups ?? [];
    },
    { initialData: initialGroups },
  );
  const groups = data ?? [];
  const [start, setStart] = useState<number | null>(null);
  const initial = (viewerName ?? "").charAt(0).toUpperCase() || "+";

  return (
    <div className="-mx-1 flex gap-4 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {/* Create story — shows your own avatar with an add badge */}
      <button type="button" onClick={() => openUpload("story")} className="flex w-16 shrink-0 flex-col items-center gap-1.5">
        <span className="relative rounded-full bg-gradient-to-br from-fuchsia-500 via-violet-500 to-blue-500 p-0.5">
          <span className="block rounded-full bg-background p-0.5">
            {viewerAvatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={viewerAvatarUrl} alt="" className="h-[3.4rem] w-[3.4rem] rounded-full object-cover" />
            ) : (
              <span className="flex h-[3.4rem] w-[3.4rem] items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-lg font-bold text-white">
                {initial}
              </span>
            )}
          </span>
          <span className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-white ring-2 ring-background">
            <Plus className="h-3.5 w-3.5" />
          </span>
        </span>
        <span className="text-[11px] font-medium text-muted-foreground">Your Story</span>
      </button>

      {groups.map((g, i) => {
        // Show the story's own cover (most recent first) in the circle so it
        // teases the content — not the author's profile picture.
        const cover = g.stories[0];
        return (
          <button key={g.handle} type="button" onClick={() => setStart(i)} className="flex w-16 shrink-0 flex-col items-center gap-1.5">
            <span className="rounded-full bg-gradient-to-br from-fuchsia-500 via-violet-500 to-blue-500 p-0.5">
              <span className="block overflow-hidden rounded-full bg-background p-0.5">
                {cover?.mediaKind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cover.mediaUrl} alt="" className="h-[3.4rem] w-[3.4rem] rounded-full object-cover" />
                ) : cover?.mediaKind === "video" ? (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video src={`${cover.mediaUrl}#t=0.3`} muted playsInline preload="metadata" className="h-[3.4rem] w-[3.4rem] rounded-full object-cover" />
                ) : g.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={g.avatarUrl} alt="" className="h-[3.4rem] w-[3.4rem] rounded-full object-cover" />
                ) : (
                  <span className="flex h-[3.4rem] w-[3.4rem] items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-lg font-bold text-white">
                    {g.displayName.charAt(0).toUpperCase()}
                  </span>
                )}
              </span>
            </span>
            <span className="w-16 truncate text-center text-[11px] font-medium text-foreground">{g.displayName.split(" ")[0]}</span>
          </button>
        );
      })}

      {start !== null ? <StoryViewer groups={groups} startGroup={start} onClose={() => setStart(null)} /> : null}
    </div>
  );
}

function StoryViewer({ groups, startGroup, onClose }: { groups: StoryGroup[]; startGroup: number; onClose: () => void }) {
  const [gi, setGi] = useState(startGroup);
  const [si, setSi] = useState(0);
  const [pct, setPct] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const group = groups[gi]!;
  const story = group?.stories[si];

  const next = useCallback(() => {
    setPct(0);
    if (si < group.stories.length - 1) setSi(si + 1);
    else if (gi < groups.length - 1) {
      setGi(gi + 1);
      setSi(0);
    } else onClose();
  }, [si, gi, group, groups.length, onClose]);

  const prev = useCallback(() => {
    setPct(0);
    if (si > 0) setSi(si - 1);
    else if (gi > 0) {
      const pg = groups[gi - 1]!;
      setGi(gi - 1);
      setSi(Math.max(0, pg.stories.length - 1));
    } else setSi(0);
  }, [si, gi, groups]);

  // Auto-advance: images on a timer, videos when they end (progress via timeupdate).
  useEffect(() => {
    if (!story || story.mediaKind === "video") return;
    setPct(0);
    const startedAt = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(100, ((now - startedAt) / IMAGE_MS) * 100);
      setPct(p);
      if (p >= 100) next();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [gi, si, story, next]);

  // Escape + scroll lock.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [next, prev, onClose]);

  if (!story) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/95" role="dialog" aria-modal="true">
      <button type="button" onClick={onClose} aria-label="Close" className="absolute right-4 top-5 z-20 rounded-full bg-white/10 p-2 text-white backdrop-blur"><X className="h-5 w-5" /></button>

      {/* progress segments (current user's stories) */}
      <div className="absolute inset-x-3 top-3 z-20 flex gap-1">
        {group.stories.map((_, idx) => (
          <span key={idx} className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
            <span className="block h-full rounded-full bg-white" style={{ width: `${idx < si ? 100 : idx === si ? pct : 0}%` }} />
          </span>
        ))}
      </div>

      {/* author */}
      <div className="absolute left-4 top-7 z-20 flex items-center gap-2 text-white">
        {group.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={group.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover ring-1 ring-white/30" />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-sm font-bold">{group.displayName.charAt(0)}</span>
        )}
        <span className="text-sm font-semibold">{group.displayName}</span>
      </div>

      {/* tap zones: left = back, right = forward */}
      <button type="button" aria-label="Previous" onClick={prev} className="absolute inset-y-0 left-0 z-10 w-1/3" />
      <button type="button" aria-label="Next" onClick={next} className="absolute inset-y-0 right-0 z-10 w-1/3" />

      <div className="max-h-[92vh] w-full max-w-md px-2">
        {story.mediaKind === "video" ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            ref={videoRef}
            key={`${gi}-${si}`}
            src={story.mediaUrl}
            autoPlay
            playsInline
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              if (v.duration) setPct((v.currentTime / v.duration) * 100);
            }}
            onEnded={next}
            className="max-h-[92vh] w-full rounded-2xl object-contain"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={`${gi}-${si}`} src={story.mediaUrl} alt="" className="max-h-[92vh] w-full rounded-2xl object-contain" />
        )}
        {story.caption ? <p className="pointer-events-none mt-3 text-center text-sm text-white/90">{story.caption}</p> : null}
      </div>
    </div>
  );
}
