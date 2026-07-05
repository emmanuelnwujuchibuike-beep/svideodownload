"use client";

import { Loader2, Plus, Send, Smile, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useQuery } from "@/features/data";
import { openUpload } from "@/features/create/upload-store";
import { useEntitlements } from "@/features/auth/use-entitlements";
import type { StoryGroup } from "@/lib/social/stories";

const QUICK_EMOJI = ["❤️", "😂", "😮", "😍", "🔥", "👏", "🙌"];
const STICKERS = ["🎉", "💯", "😭", "🥰", "😎", "🤯", "👀", "🫶", "💀", "🤝", "✨", "🙏"];

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

export function StoryViewer({ groups, startGroup, onClose }: { groups: StoryGroup[]; startGroup: number; onClose: () => void }) {
  const [gi, setGi] = useState(startGroup);
  const [si, setSi] = useState(0);
  const [pct, setPct] = useState(0);
  const [replying, setReplying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { handle } = useEntitlements();

  const group = groups[gi]!;
  const story = group?.stories[si];
  const isOwn = !!handle && group.handle === handle;

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
  // Paused while the viewer is composing a reply.
  useEffect(() => {
    if (!story || story.mediaKind === "video" || replying) return;
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
  }, [gi, si, story, next, replying]);

  // Pause the story video while replying.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (replying) v.pause();
    else void v.play().catch(() => {});
  }, [replying, gi, si]);

  // Escape + scroll lock.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    // overflowY only — the `overflow` shorthand also resets overflow-x, undoing
    // the `overflow-x: clip` on <body> that keeps the app sidebar sticky.
    document.body.style.overflowY = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflowY = "";
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

      {/* tap zones: left third = back, the rest = forward (full-screen coverage) */}
      <button type="button" aria-label="Previous" onClick={prev} className="absolute inset-y-0 left-0 z-10 w-1/3" />
      <button type="button" aria-label="Next" onClick={next} className="absolute inset-y-0 left-1/3 right-0 z-10" />

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

      {/* Reply bar — text, emojis & stickers (delivered as a DM) */}
      {isOwn ? null : (
        <StoryReplyBar toUserId={group.userId} name={group.displayName.split(" ")[0] || group.displayName} onFocusChange={setReplying} />
      )}
    </div>
  );
}

function StoryReplyBar({ toUserId, name, onFocusChange }: { toUserId: string; name: string; onFocusChange: (v: boolean) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [stickers, setStickers] = useState(false);

  const send = async (payload: string) => {
    const t = payload.trim();
    if (!t || busy) return;
    setBusy(true);
    setText("");
    setStickers(false);
    try {
      const r = await fetch("/api/stories/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toUserId, text: t }),
      });
      if (r.ok) {
        setSent(true);
        setTimeout(() => setSent(false), 1600);
      }
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/70 to-transparent px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-5">
      {sent ? (
        <p className="mb-2 text-center text-xs font-semibold text-emerald-300">Sent to {name} ✓</p>
      ) : (
        <div className="mb-2 flex justify-center gap-2">
          {QUICK_EMOJI.map((e) => (
            <button key={e} type="button" onClick={() => send(e)} className="text-2xl transition active:scale-125" aria-label={`React ${e}`}>
              {e}
            </button>
          ))}
        </div>
      )}

      {stickers ? (
        <div className="mx-auto mb-2 grid max-w-md grid-cols-6 gap-1 rounded-2xl bg-white/10 p-2 backdrop-blur">
          {STICKERS.map((s) => (
            <button key={s} type="button" onClick={() => send(s)} className="rounded-xl py-1.5 text-2xl transition hover:bg-white/10 active:scale-110" aria-label={`Sticker ${s}`}>
              {s}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mx-auto flex max-w-md items-center gap-2">
        <button
          type="button"
          onClick={() => setStickers((v) => !v)}
          aria-label="Stickers"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
        >
          <Smile className="h-5 w-5" />
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => onFocusChange(true)}
          onBlur={() => onFocusChange(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void send(text);
          }}
          maxLength={500}
          placeholder={`Reply to ${name}…`}
          className="h-10 min-w-0 flex-1 rounded-full border border-white/20 bg-white/10 px-4 text-sm text-white outline-none backdrop-blur placeholder:text-white/50 focus:border-white/40"
        />
        <button
          type="button"
          onClick={() => send(text)}
          disabled={busy || !text.trim()}
          aria-label="Send reply"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-white transition disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
