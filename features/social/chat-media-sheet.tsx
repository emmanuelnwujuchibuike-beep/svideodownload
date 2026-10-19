"use client";

import { FileText, Link2, Music, Play, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { haptic } from "@/lib/motion/haptics";
import type { LinkItem, MediaItem, MediaPage, MediaTab } from "@/lib/social/conversation-media";
import { cn } from "@/lib/utils";

/**
 * "Media, links & files" for one chat (design/ChatMenu.dc.html; owner 2026-10-19: build the backend
 * it needs). Three tabs over GET /api/conversations/[id]/media — photos and videos in a grid, links
 * and files as rows — newest first, a page at a time. Every item opens its message in the chat
 * (`?highlight=`, as search results do), so nothing here is a second viewer to keep in step.
 *
 * Loaded only when its row is tapped (its own chunk). Each tab is read once per open and kept while
 * the sheet is open, so switching back and forth costs nothing.
 */

const TABS: { id: MediaTab; label: string }[] = [
  { id: "media", label: "Media" },
  { id: "links", label: "Links" },
  { id: "files", label: "Files" },
];

const EMPTY: Record<MediaTab, string> = {
  media: "Photos and videos you share here show up here.",
  links: "Links you share here show up here.",
  files: "Documents and audio you share here show up here.",
};

type TabState = { items: (MediaItem | LinkItem)[]; nextBefore: string | null; loading: boolean; error: boolean };

function formatSize(bytes: number | null): string | null {
  if (!bytes) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChatMediaSheet({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const [tab, setTab] = useState<MediaTab>("media");
  const [tabs, setTabs] = useState<Partial<Record<MediaTab, TabState>>>({});
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const load = useCallback(
    async (which: MediaTab, before: string | null) => {
      setTabs((t) => ({ ...t, [which]: { items: t[which]?.items ?? [], nextBefore: t[which]?.nextBefore ?? null, loading: true, error: false } }));
      try {
        const res = await fetch(`/api/conversations/${conversationId}/media?tab=${which}${before ? `&before=${encodeURIComponent(before)}` : ""}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const page = (await res.json()) as MediaPage;
        setTabs((t) => ({ ...t, [which]: { items: [...(before ? (t[which]?.items ?? []) : []), ...page.items], nextBefore: page.nextBefore, loading: false, error: false } }));
      } catch {
        setTabs((t) => ({ ...t, [which]: { items: t[which]?.items ?? [], nextBefore: t[which]?.nextBefore ?? null, loading: false, error: true } }));
      }
    },
    [conversationId],
  );

  useEffect(() => {
    if (!tabs[tab]) void load(tab, null);
  }, [tab, tabs, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!mounted) return null;
  const state = tabs[tab];
  const href = (messageId: string) => `/messages/${conversationId}?highlight=${messageId}`;

  return createPortal(
    <div className="frenz-ui fixed inset-0 z-[120] flex flex-col bg-frenz-page text-frenz-ink" role="dialog" aria-modal="true" aria-label="Media, links and files">
      <div className="flex items-center gap-2 px-4 pb-2" style={{ paddingTop: "max(0.75rem, var(--frenz-safe-top))" }}>
        <h2 className="m-0 flex-1 font-heading text-[22px] font-bold tracking-[-0.5px]">Media, links &amp; files</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-frenz-fill text-frenz-muted">
            <X className="h-[18px] w-[18px]" aria-hidden />
          </span>
        </button>
      </div>
      <div role="tablist" aria-label="What to show" className="mx-4 mb-3 grid grid-cols-3 gap-0.5 rounded-xl bg-frenz-fill p-[3px]">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              haptic("selection");
              setTab(t.id);
            }}
            className={cn("min-h-[38px] rounded-[9px] text-[14px] transition-colors", tab === t.id ? "bg-frenz-card font-bold text-frenz-ink shadow-[0_1px_3px_rgba(18,17,26,0.12)]" : "font-semibold text-frenz-muted")}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain pb-[max(1rem,env(safe-area-inset-bottom))]">
        {!state || (state.loading && state.items.length === 0) ? (
          <div className={tab === "media" ? "grid grid-cols-3 gap-0.5" : "space-y-2 px-4"} aria-hidden>
            {Array.from({ length: tab === "media" ? 9 : 4 }).map((_, i) => (
              <div key={i} className={cn("bg-frenz-fill", tab === "media" ? "aspect-square" : "h-16 rounded-2xl")} />
            ))}
          </div>
        ) : state.error && state.items.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="m-0 text-sm font-bold">Couldn&apos;t load this right now.</p>
            <button type="button" onClick={() => void load(tab, null)} className="mt-3 min-h-11 rounded-full bg-frenz-fill px-5 text-sm font-bold">
              Try again
            </button>
          </div>
        ) : state.items.length === 0 ? (
          <p className="m-0 px-8 py-16 text-center text-sm text-frenz-muted">{EMPTY[tab]}</p>
        ) : tab === "media" ? (
          <ul className="m-0 grid list-none grid-cols-3 gap-0.5 p-0">
            {(state.items as MediaItem[]).map((m) => (
              <li key={m.id}>
                <Link href={href(m.messageId)} onClick={onClose} aria-label={m.kind === "video" ? "Video" : "Photo"} className="relative block aspect-square overflow-hidden bg-frenz-fill">
                  {m.kind === "image" || m.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- chat media, already sized by its thumbnail
                    <img src={m.thumbnailUrl ?? m.url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                  ) : (
                    <video src={`${m.url}#t=0.1`} preload="metadata" muted playsInline className="h-full w-full object-cover" />
                  )}
                  {m.kind === "video" ? (
                    <span aria-hidden className="absolute bottom-1.5 left-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/45 text-white">
                      <Play className="h-3.5 w-3.5 fill-current" />
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="m-0 mx-4 list-none divide-y divide-frenz-line overflow-hidden rounded-[20px] border border-frenz-line bg-frenz-card p-0">
            {tab === "links"
              ? (state.items as LinkItem[]).map((l) => (
                  <li key={l.id} className="flex items-center gap-3 px-3.5 py-2.5">
                    <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-frenz-violet/10 text-frenz-violet">
                      <Link2 className="h-5 w-5" />
                    </span>
                    <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 flex-1 no-underline">
                      <span className="block truncate text-[15px] font-bold text-frenz-ink">{l.host}</span>
                      <span className="block truncate text-[12.5px] text-frenz-muted">{l.url}</span>
                    </a>
                    <Link href={href(l.messageId)} onClick={onClose} className="shrink-0 rounded-full bg-frenz-fill px-3 py-1.5 text-[12.5px] font-bold text-frenz-ink">
                      In chat
                    </Link>
                  </li>
                ))
              : (state.items as MediaItem[]).map((f) => (
                  <li key={f.id}>
                    <Link href={href(f.messageId)} onClick={onClose} className="flex min-h-[60px] items-center gap-3 px-3.5 py-2.5 text-frenz-ink no-underline">
                      <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-frenz-violet/10 text-frenz-violet">
                        {f.kind === "audio" ? <Music className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-bold">{f.filename ?? (f.kind === "audio" ? "Voice message" : "Document")}</span>
                        <span className="block truncate text-[12.5px] text-frenz-muted">
                          {[formatSize(f.sizeBytes), new Date(f.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
          </ul>
        )}
        {state && state.nextBefore && state.items.length > 0 ? (
          <div className="flex justify-center py-4">
            <button type="button" disabled={state.loading} onClick={() => void load(tab, state.nextBefore)} className="min-h-11 rounded-full border border-frenz-line bg-frenz-card px-5 text-[13.5px] font-bold shadow-frenz-card disabled:opacity-60">
              {state.loading ? "Loading…" : "Load more"}
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
