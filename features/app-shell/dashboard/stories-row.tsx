"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";

import { openUpload } from "@/features/create/upload-store";
import type { StoryGroup } from "@/lib/social/stories";
import { cn } from "@/lib/utils";

export function StoriesRow() {
  const [groups, setGroups] = useState<StoryGroup[]>([]);
  const [active, setActive] = useState<StoryGroup | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/stories")
      .then((r) => (r.ok ? r.json() : { groups: [] }))
      .then((d: { groups: StoryGroup[] }) => alive && setGroups(d.groups ?? []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="-mx-1 flex gap-4 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {/* Create story */}
      <button type="button" onClick={openUpload} className="flex w-16 shrink-0 flex-col items-center gap-1.5">
        <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-secondary ring-2 ring-border">
          <span className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-white ring-2 ring-background">
            <Plus className="h-3.5 w-3.5" />
          </span>
        </span>
        <span className="text-[11px] font-medium text-muted-foreground">Create Story</span>
      </button>

      {groups.map((g) => (
        <button key={g.handle} type="button" onClick={() => setActive(g)} className="flex w-16 shrink-0 flex-col items-center gap-1.5">
          <span className="rounded-full bg-gradient-to-br from-fuchsia-500 via-violet-500 to-blue-500 p-0.5">
            <span className="block rounded-full bg-background p-0.5">
              {g.avatarUrl ? (
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
      ))}

      {active ? <StoryViewer group={active} onClose={() => setActive(null)} /> : null}
    </div>
  );
}

function StoryViewer({ group, onClose }: { group: StoryGroup; onClose: () => void }) {
  const [i, setI] = useState(0);
  const story = group.stories[i];

  useEffect(() => {
    if (group.stories[i]?.mediaKind === "video") return; // videos advance on end
    const t = setTimeout(() => {
      if (i < group.stories.length - 1) setI(i + 1);
      else onClose();
    }, 5000);
    return () => clearTimeout(t);
  }, [i, group.stories, onClose]);

  if (!story) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/95" role="dialog" aria-modal="true">
      <button type="button" onClick={onClose} aria-label="Close" className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-2 text-white backdrop-blur"><X className="h-5 w-5" /></button>

      {/* progress segments */}
      <div className="absolute inset-x-3 top-3 z-10 flex gap-1">
        {group.stories.map((_, idx) => (
          <span key={idx} className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
            <span className={cn("block h-full rounded-full bg-white", idx < i ? "w-full" : idx === i ? "w-full" : "w-0")} />
          </span>
        ))}
      </div>

      {/* author */}
      <div className="absolute left-4 top-7 z-10 flex items-center gap-2 text-white">
        {group.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={group.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover ring-1 ring-white/30" />
        ) : null}
        <span className="text-sm font-semibold">{group.displayName}</span>
      </div>

      {/* nav zones */}
      <button type="button" aria-label="Previous" onClick={() => setI((n) => Math.max(0, n - 1))} className="absolute inset-y-0 left-0 z-[5] w-1/3" />
      <button type="button" aria-label="Next" onClick={() => (i < group.stories.length - 1 ? setI(i + 1) : onClose())} className="absolute inset-y-0 right-0 z-[5] w-1/3" />

      <div className="max-h-[90vh] w-full max-w-md px-2">
        {story.mediaKind === "video" ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video src={story.mediaUrl} autoPlay controls onEnded={() => (i < group.stories.length - 1 ? setI(i + 1) : onClose())} className="max-h-[90vh] w-full rounded-2xl object-contain" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={story.mediaUrl} alt="" className="max-h-[90vh] w-full rounded-2xl object-contain" />
        )}
        {story.caption ? <p className="mt-3 text-center text-sm text-white/90">{story.caption}</p> : null}
      </div>
    </div>
  );
}
