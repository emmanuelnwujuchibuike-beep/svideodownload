"use client";

import { MoreHorizontal, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { PendingButton } from "@/features/frenz-ui/pending";
import { HighlightCover } from "@/features/social/highlight-picker";
import { toast } from "@/features/ui/toast";
import { haptic } from "@/lib/motion/haptics";
import { HIGHLIGHT_TITLE_MAX, type Highlight, type HighlightWithItems } from "@/lib/social/story-highlights-shared";
import { cn } from "@/lib/utils";

/**
 * A highlight, full screen (Stories Part 5, 2026-10-27). The story viewer's controls, kept: a bar per story, a photo for
 * 5 s and a video to its end, tap the left third to go back and the rest to go on, hold to pause, Escape or × to close.
 * No views, replies or reshares are recorded here: a highlight is the owner's keepsake on their profile, and those
 * belong to the live story.
 *
 * The owner's ••• : remove this story, make it the cover, rename the highlight, delete the highlight (asks twice — the
 * app has no confirm dialog). Each change is the server's and the screen follows its answer.
 *
 * Sound (owner, 2026-10-27, the same rule as the story viewer): the video it leaves is paused and emptied, and the app
 * going to the background pauses it, so nothing keeps playing after the viewer has gone.
 */

const IMAGE_MS = 5000;
const HOLD_MS = 220;

export function HighlightViewer({
  highlightId,
  summary,
  isOwner,
  onClose,
  onChanged,
}: {
  highlightId: string;
  /** What the circle already knows — painted at once while the stories load. */
  summary: Highlight;
  isOwner: boolean;
  onClose: () => void;
  /** Something changed on the server: the new summary, or null when the highlight is gone. */
  onChanged: (next: Highlight | null) => void;
}) {
  const [data, setData] = useState<HighlightWithItems | null>(null);
  const [failed, setFailed] = useState(false);
  const [i, setI] = useState(0);
  const [pct, setPct] = useState(0);
  const [held, setHeld] = useState(false);
  const [menu, setMenu] = useState(false);
  const [mounted, setMounted] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasHold = useRef(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let live = true;
    fetch(`/api/stories/highlights/${encodeURIComponent(highlightId)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ highlight: HighlightWithItems }>) : Promise.reject(new Error(String(r.status)))))
      .then((j) => live && setData(j.highlight))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [highlightId]);

  const items = data?.items ?? [];
  const item = items[i];
  const paused = held || menu;

  const next = useCallback(() => {
    setPct(0);
    setI((n) => {
      if (n + 1 < items.length) return n + 1;
      onClose();
      return n;
    });
  }, [items.length, onClose]);
  const prev = useCallback(() => {
    setPct(0);
    setI((n) => Math.max(0, n - 1));
  }, []);

  // a photo's 5 s, paused (not reset) while held or while the menu is open
  useEffect(() => {
    if (!item || item.mediaKind === "video" || paused) return;
    let raf = 0;
    let last = performance.now();
    let elapsed = (pct / 100) * IMAGE_MS;
    const tick = (now: number) => {
      elapsed += now - last;
      last = now;
      const p = Math.min(100, (elapsed / IMAGE_MS) * 100);
      setPct(Math.floor(p / 2) * 2);
      if (p >= 100) next();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pct is read once at (re)start, so a pause resumes where it stopped
  }, [item, paused, next]);

  // the video follows the pause
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (paused) v.pause();
    else void v.play().catch(() => {});
  }, [paused, i]);

  // no sound after the viewer: the video left behind is paused and emptied; the background pauses it
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    return () => {
      if (v.isConnected) return;
      v.pause();
      v.removeAttribute("src");
      v.load();
    };
  }, [i]);
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") videoRef.current?.pause();
    };
    const onHide = () => videoRef.current?.pause();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onHide);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (menu) return;
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, next, prev, onClose]);

  // the page behind stays still while the viewer is open
  useEffect(() => {
    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prevOverflow;
    };
  }, []);

  const startHold = () => {
    wasHold.current = false;
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => {
      wasHold.current = true;
      setHeld(true);
    }, HOLD_MS);
  };
  const endHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    setHeld(false);
  };
  const zoneTap = (go: () => void) => {
    if (wasHold.current) {
      wasHold.current = false;
      return;
    }
    go();
  };

  /** After an owner change: the new state from the server, else close. */
  const refresh = async (gone: boolean) => {
    if (gone) {
      onChanged(null);
      onClose();
      return;
    }
    const r = await fetch(`/api/stories/highlights/${encodeURIComponent(highlightId)}`).catch(() => null);
    const j = r?.ok ? ((await r.json()) as { highlight: HighlightWithItems }) : null;
    if (!j) {
      onChanged(null);
      onClose();
      return;
    }
    setData(j.highlight);
    setI((n) => Math.min(n, j.highlight.items.length - 1));
    setPct(0);
    const { items: _items, ...rest } = j.highlight;
    onChanged(rest);
  };

  if (!mounted) return null;
  const title = data?.title ?? summary.title;
  const when = item ? timeLabel(item.createdAt) : "";

  return createPortal(
    <div className="frenz-ui fixed inset-0 z-[105] bg-black text-white" role="dialog" aria-modal="true" aria-label={`Highlight: ${title}`} data-media-protected>
      <section className="absolute inset-x-0 bottom-0 overflow-hidden bg-[#0B0920]" style={{ top: "var(--frenz-safe-top, 0px)" }}>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          {item ? (
            item.mediaKind === "video" ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video
                ref={videoRef}
                key={item.id}
                src={item.mediaUrl}
                poster={item.thumbnailUrl ?? undefined}
                autoPlay
                playsInline
                onTimeUpdate={(e) => {
                  const v = e.currentTarget;
                  if (v.duration) setPct((v.currentTime / v.duration) * 100);
                }}
                onEnded={next}
                className="h-full w-full object-contain"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- our own media CDN; full-screen, contained
              <img key={item.id} src={item.mediaUrl} alt="" className="h-full w-full object-contain" />
            )
          ) : failed ? (
            <p className="px-8 text-center text-[15px] font-semibold text-white/85">This highlight couldn&apos;t be opened. It may have been removed.</p>
          ) : (
            <span role="status" aria-label="Loading" className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/30 border-t-white motion-reduce:animate-none" />
          )}
        </div>

        <div aria-hidden className={cn("pointer-events-none absolute inset-x-0 top-0 z-[1] h-[150px] bg-[linear-gradient(180deg,rgba(8,6,20,0.6)_0%,rgba(8,6,20,0)_100%)] transition-opacity duration-150", held && "opacity-0")} />

        {/* tap zones: left third back, the rest on; press and hold pauses */}
        {items.length > 0 ? (
          <>
            <button type="button" aria-label="Previous" onPointerDown={startHold} onPointerUp={endHold} onPointerLeave={endHold} onPointerCancel={endHold} onClick={() => zoneTap(prev)} className="absolute bottom-0 left-0 top-0 z-[2] w-1/3" />
            <button type="button" aria-label="Next" onPointerDown={startHold} onPointerUp={endHold} onPointerLeave={endHold} onPointerCancel={endHold} onClick={() => zoneTap(next)} className="absolute bottom-0 right-0 top-0 z-[2] w-2/3" />
          </>
        ) : null}

        <header className={cn("absolute inset-x-0 top-0 z-[3] px-3 pt-2.5 transition-opacity duration-150", held && "pointer-events-none opacity-0")}>
          <div className="flex gap-1" aria-hidden>
            {(items.length ? items : [null]).map((_, n) => (
              <span key={n} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
                <span className="block h-full rounded-full bg-white transition-[width] duration-100 ease-linear" style={{ width: n < i ? "100%" : n === i ? `${pct}%` : "0%" }} />
              </span>
            ))}
          </div>
          <div className="mt-2.5 flex items-center gap-2.5">
            <HighlightCover url={data?.coverUrl ?? summary.coverUrl} size={36} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[15px] font-bold">{title}</span>
              {when ? <span className="text-[12px] font-semibold text-white/70">{when}</span> : null}
            </span>
            {isOwner && item ? (
              <button type="button" onClick={() => setMenu(true)} aria-label="Highlight options" className="flex h-11 w-11 items-center justify-center rounded-full bg-black/30 transition active:scale-95">
                <MoreHorizontal className="h-5 w-5" aria-hidden />
              </button>
            ) : null}
            <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-full bg-black/30 transition active:scale-95">
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </header>

        {item?.caption ? (
          <p className={cn("absolute inset-x-0 bottom-0 z-[3] px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-10 text-[15px] font-semibold leading-snug [text-shadow:0_1px_8px_rgba(0,0,0,0.6)] bg-[linear-gradient(0deg,rgba(8,6,20,0.55)_0%,rgba(8,6,20,0)_100%)]", held && "opacity-0")}>
            {item.caption}
          </p>
        ) : null}
      </section>

      {menu && item && data ? <OwnerMenu highlight={data} itemId={item.id} onClose={() => setMenu(false)} onDone={(gone) => void refresh(gone)} /> : null}
    </div>,
    document.body,
  );
}

function OwnerMenu({ highlight, itemId, onClose, onDone }: { highlight: HighlightWithItems; itemId: string; onClose: () => void; onDone: (gone: boolean) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(highlight.title);
  const [armed, setArmed] = useState(false);

  const call = async (key: string, url: string, init: RequestInit, ok: string, gone: (j: Record<string, unknown>) => boolean) => {
    if (busy) return;
    setBusy(key);
    haptic("light");
    try {
      const r = await fetch(url, init);
      const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : "Couldn't change that highlight.");
      toast(ok, "success");
      onClose();
      onDone(gone(j));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't change that highlight.", "error");
    } finally {
      setBusy(null);
    }
  };
  const base = `/api/stories/highlights/${encodeURIComponent(highlight.id)}`;
  const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const row = "flex h-[54px] w-full items-center justify-center rounded-[18px] bg-white text-[15px] font-bold text-[#12111A] shadow-[0_1px_2px_rgba(30,20,80,0.06)]";

  return (
    <div className="fixed inset-0 z-[110] text-[#12111A]" role="presentation">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-[rgba(5,4,15,0.5)]" />
      <section role="dialog" aria-modal="true" aria-label="Highlight options" className="absolute inset-x-0 bottom-0 mx-auto flex max-w-lg flex-col gap-2.5 rounded-t-[32px] bg-[rgba(246,245,251,0.96)] px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-4 backdrop-blur animate-in slide-in-from-bottom duration-300 motion-reduce:animate-none">
        {renaming ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const t = title.replace(/\s+/g, " ").trim();
              if (t) void call("rename", base, json("PATCH", { title: t }), "Renamed", () => false);
            }}
            className="flex items-center gap-2 rounded-[18px] bg-white p-2"
          >
            <label htmlFor="highlight-rename" className="sr-only">
              Highlight name
            </label>
            <input
              id="highlight-rename"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={HIGHLIGHT_TITLE_MAX}
              className="h-11 min-w-0 flex-1 rounded-[14px] bg-[#F1F0F6] px-3.5 text-base outline-none focus:ring-2 focus:ring-[#5B3FD8]/35"
            />
            <PendingButton type="submit" pending={busy === "rename"} disabled={!title.trim()} spinnerSize={16} className="h-11 shrink-0 rounded-[14px] bg-[linear-gradient(90deg,#3D5AFE,#7B3FE4)] px-4 text-[14px] font-extrabold text-white disabled:opacity-50">
              Save
            </PendingButton>
          </form>
        ) : (
          <button type="button" onClick={() => setRenaming(true)} className={row}>
            Rename highlight
          </button>
        )}
        <PendingButton pending={busy === "cover"} className={row} onClick={() => void call("cover", base, json("PATCH", { coverItemId: itemId }), "Cover updated", () => false)}>
          Make this the cover
        </PendingButton>
        <PendingButton
          pending={busy === "remove"}
          className={row}
          onClick={() => void call("remove", `${base}/items?item=${encodeURIComponent(itemId)}`, { method: "DELETE" }, "Removed from the highlight", (j) => j.highlightDeleted === true)}
        >
          Remove from highlight
        </PendingButton>
        <PendingButton
          pending={busy === "delete"}
          className={cn(row, "text-[#B4233F]")}
          onClick={() => {
            if (!armed) {
              setArmed(true);
              return;
            }
            void call("delete", base, { method: "DELETE" }, "Highlight deleted", () => true);
          }}
        >
          {armed ? "Tap again to delete the highlight" : "Delete highlight"}
        </PendingButton>
        <button type="button" onClick={onClose} className="h-12 text-[15px] font-bold text-[#5A5770]">
          Cancel
        </button>
      </section>
    </div>
  );
}

/** "3 Oct", or "3 Oct 2025" from another year — when the story was first posted. */
function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}
