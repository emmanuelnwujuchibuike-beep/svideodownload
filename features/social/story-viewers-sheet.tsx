"use client";

import { Camera } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import type { StoryItem } from "@/lib/social/stories";
import { cn } from "@/lib/utils";

import { faceGradient, useStoryViewers, type StoryViewerRow } from "./story-viewers-data";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  SEEN BY — the author's own list (2026-10-04, migration 0181)
 *  rebuilt to the Story Viewer design (design/Frenz-Story-Viewer-design.zip,
 *  StoryViewers.dc.html, 2026-10-26)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   your stories      the row of your own stories at the top — the one open is
 *                     ringed; tap another to see who saw THAT one
 *   the totals        Viewers · Reactions · Reshares — real counts from the
 *                     route (story_views, story_reactions 0288, reshares 0081).
 *                     A total the database cannot count yet shows "–", never a guess.
 *   search            filters the list on this phone (no request per keystroke)
 *   each viewer       face (a heart when they reacted), name, @handle, Message
 *
 * Opens only on the author's own story; the route refuses anybody else (403)
 * and RLS refuses them underneath that.
 *
 * ── 🔴 THE SCREENSHOT LINE IS HONEST ABOUT ITSELF (kept from 2026-10-04) ───
 * The web cannot detect a screenshot, and an author with the switch off gets no
 * screenshot flags (the reciprocity rule, see the route). The footnote says which
 * of the two it is, so an author never reads silence as "nobody did it".
 */

function Face({ v, size }: { v: Pick<StoryViewerRow, "id" | "avatarUrl" | "displayName" | "handle">; size: number }) {
  const initial = (v.displayName ?? v.handle ?? "?").charAt(0).toUpperCase();
  return v.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- a remote avatar; the optimizer adds a round trip for a 44px image
    <img src={v.avatarUrl} alt="" width={size} height={size} className="h-full w-full rounded-full object-cover" />
  ) : (
    <span className="flex h-full w-full items-center justify-center rounded-full font-heading text-[16px] font-bold text-white" style={{ background: faceGradient(v.id) }}>
      {initial}
    </span>
  );
}

const fmt = (n: number | null) => (n === null ? "–" : n.toLocaleString());

export function StoryViewersSheet({
  storyId,
  open,
  onClose,
  stories,
  currentIndex = 0,
  onPick,
}: {
  storyId: string;
  open: boolean;
  onClose: () => void;
  /** your own stories, for the row at the top (absent: the row is not shown) */
  stories?: readonly StoryItem[];
  currentIndex?: number;
  /** tap another of your stories: the viewer moves to it, and this sheet shows ITS viewers */
  onPick?: (index: number) => void;
}) {
  // fresh when the sheet opens (≤ 5 s old), so the list matches the moment it was asked for
  const state = useStoryViewers(open ? storyId : null, 5_000);
  const [q, setQ] = useState("");

  const data = state.status === "ready" ? state.data : null;
  const shown = useMemo(() => {
    const list = data?.viewers ?? [];
    const needle = q.trim().toLowerCase().replace(/^@/, "");
    if (!needle) return list;
    return list.filter((v) => (v.displayName ?? "").toLowerCase().includes(needle) || (v.handle ?? "").toLowerCase().includes(needle));
  }, [data, q]);

  if (!open) return null;

  return (
    <div className="frenz-ui fixed inset-0 z-[120] flex flex-col bg-black" role="dialog" aria-modal="true" aria-labelledby="story-seen-by-title">
      {/* your stories — the open one ringed in the brand gradient, the rest dimmed */}
      <div className="relative flex h-[236px] shrink-0 items-start pt-[calc(1rem+var(--frenz-safe-top,0px))]">
        <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0" />
        {stories && stories.length > 0 ? (
          <div className="relative mx-auto flex max-w-full gap-3 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {stories.map((s, i) => {
              const cover = s.mediaKind === "image" ? s.mediaUrl : s.thumbnailUrl;
              const current = i === currentIndex;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onPick?.(i)}
                  aria-label={`Story ${i + 1}${current ? ", current" : ""}`}
                  aria-current={current || undefined}
                  className={cn(
                    "flex shrink-0 overflow-hidden transition active:scale-95",
                    current ? "h-[186px] w-[104px] rounded-[18px] bg-[linear-gradient(135deg,#3D5AFE,#7B3FE4_55%,#C23FD1)] p-[3px]" : "mt-4 h-[154px] w-[86px] rounded-[14px] opacity-55",
                  )}
                >
                  <span className={cn("flex flex-1 overflow-hidden bg-[#0B0920]", current ? "rounded-[15px] border-2 border-black" : "")}>
                    {cover ? (
                      // eslint-disable-next-line @next/next/no-img-element -- your own story's cover, already in the cache from the viewer
                      <img src={cover} alt="" className="h-full w-full object-cover" />
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <section className="relative -mt-1.5 flex min-h-0 flex-1 flex-col rounded-t-[30px] bg-white text-[#12111A]">
        <span aria-hidden className="mt-2 h-[5px] w-10 self-center rounded-full bg-[#DCD9E6]" />
        <div className="flex items-center justify-between pl-5 pr-4 pt-3">
          <h2 id="story-seen-by-title" className="m-0 font-heading text-[20px] font-bold tracking-[-0.5px]">
            Seen by
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F1F0F6] text-[#4A4760] transition active:scale-95">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12" />
              <path d="M18 6L6 18" />
            </svg>
          </button>
        </div>

        <dl className="mx-4 mb-0 mt-3.5 grid grid-cols-3 rounded-[20px] bg-[#F7F6FB] py-3">
          {(
            [
              ["Viewers", data ? fmt(data.totals.viewers) : "–"],
              ["Reactions", data ? fmt(data.totals.reactions) : "–"],
              ["Reshares", data ? fmt(data.totals.reshares) : "–"],
            ] as const
          ).map(([label, value], i) => (
            <div key={label} className={cn("flex flex-col items-center gap-0.5", i > 0 && "border-l border-[#E8E5F3]")}>
              <dd className="m-0 font-heading text-[19px] font-bold tabular-nums">{value}</dd>
              <dt className="text-[12px] font-semibold text-[#5A5770]">{label}</dt>
            </div>
          ))}
        </dl>

        <label className="mx-4 mt-3 flex h-11 shrink-0 items-center gap-2 rounded-[14px] bg-[#F1F0F6] px-3.5">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#6E6A85" strokeWidth="2.3" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <span className="sr-only">Search viewers</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search viewers"
            data-large-text
            className="min-w-0 flex-1 border-none bg-transparent !text-[15px] text-[#12111A] outline-none placeholder:text-[#6E6A85]"
          />
        </label>

        <div className="mt-1.5 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {state.status === "loading" ? (
            <ul aria-busy="true" aria-label="Loading viewers">
              {[0, 1, 2, 3].map((i) => (
                <li key={i} className={cn("flex h-[62px] items-center gap-3", i > 0 && "border-t border-[#F0EEF8]")}>
                  <span className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-[#F1F0F6]" />
                  <span className="flex flex-1 flex-col gap-1.5">
                    <span className="h-3 w-32 animate-pulse rounded bg-[#F1F0F6]" />
                    <span className="h-2.5 w-20 animate-pulse rounded bg-[#F1F0F6]" />
                  </span>
                </li>
              ))}
            </ul>
          ) : state.status === "error" ? (
            <p className="py-10 text-center text-[14px] text-[#5A5770]">{state.message}</p>
          ) : shown.length === 0 ? (
            <p className="py-10 text-center text-[14px] text-[#5A5770]">{q.trim() ? "No viewer matches that." : "Nobody has seen this yet."}</p>
          ) : (
            <ul>
              {shown.map((v, i) => (
                <li key={v.id} className={cn("flex h-[62px] items-center gap-3", i > 0 && "border-t border-[#F0EEF8]")}>
                  <span className="relative h-11 w-11 shrink-0">
                    <Face v={v} size={44} />
                    {v.reacted ? (
                      <span role="img" aria-label="Reacted" className="absolute -bottom-[3px] -right-[3px] flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-[linear-gradient(135deg,#7B3FE4,#C23FD1)]">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="#FFFFFF" aria-hidden>
                          <path d="M12 20.5s-8-4.7-8-10.6A4.4 4.4 0 0 1 12 7.3a4.4 4.4 0 0 1 8 2.6c0 5.9-8 10.6-8 10.6z" />
                        </svg>
                      </span>
                    ) : null}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-px">
                    <span className="truncate text-[15px] font-bold">{v.displayName ?? (v.handle ? `@${v.handle}` : "Someone")}</span>
                    <span className="flex min-w-0 items-center gap-1 text-[13px] text-[#6E6A85]">
                      <span className="truncate">{v.handle ? `@${v.handle}` : ""}</span>
                      {v.screenshotted ? (
                        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-100 px-1.5 text-[11px] font-bold text-amber-700" title="Took a screenshot">
                          <Camera className="h-3 w-3" aria-hidden /> Shot
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <Link
                    href={`/messages/new/${v.id}`}
                    prefetch={false}
                    className="flex h-9 shrink-0 items-center rounded-full border border-[#E6E2F5] bg-white px-3.5 text-[13px] font-bold text-[#12111A] transition active:scale-95"
                  >
                    Message
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {data ? (
            <p className="mt-3 text-[11.5px] leading-snug text-[#8A879C]">
              {data.screenshotAlerts
                ? "Screenshot alerts are on. They can only be reported from the installed app — a browser cannot detect a screenshot."
                : "Screenshot alerts are off, so you won't see who screenshots your stories — and others won't see when you screenshot theirs."}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
