"use client";

import { Gift, Megaphone, Rocket, Sparkles, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { type ComponentType, useEffect, useRef, useState } from "react";

import type { PublicAnnouncement } from "@/lib/announcement";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { cn } from "@/lib/utils";

/**
 * Premium site announcement bar — pinned just below the header on the home +
 * download pages (owner). Content is set by admins (see /admin → Announcement) and
 * fetched here after paint, so it never touches the landing's cold-entry budget and
 * never un-statics a page. Fixed at `--frenz-header-bottom`; publishes its height as
 * `--frenz-topbanner-h` so the layout reserves space and content clears it.
 *
 * Mounted in both the marketing and app layouts; `usePathname` gates it to the two
 * surfaces so it shows on `/` and `/downloads` only. Dismissal is keyed by the
 * announcement's content hash, so editing the copy re-shows it.
 */

const DISMISS_KEY = "frenz-ann-dismissed";

const VARIANTS: Record<
  PublicAnnouncement["variant"],
  { icon: ComponentType<{ className?: string }>; label: string; bar: string; chip: string }
> = {
  feature: {
    icon: Sparkles,
    label: "New",
    bar: "from-violet-600 via-indigo-600 to-blue-600",
    chip: "bg-white/20 text-white",
  },
  update: {
    icon: Rocket,
    label: "Update",
    bar: "from-emerald-600 via-teal-600 to-cyan-600",
    chip: "bg-white/20 text-white",
  },
  announcement: {
    icon: Megaphone,
    label: "News",
    bar: "from-blue-600 via-sky-600 to-indigo-600",
    chip: "bg-white/20 text-white",
  },
  promo: {
    icon: Gift,
    label: "Offer",
    bar: "from-amber-500 via-orange-500 to-rose-500",
    chip: "bg-white/25 text-white",
  },
};

export function AnnouncementBanner({ showOn = ["/", "/downloads"] }: { showOn?: string[] }) {
  const pathname = usePathname();
  const [ann, setAnn] = useState<PublicAnnouncement | null>(null);
  const [dismissed, setDismissed] = useState(true); // hidden until we know
  const barRef = useRef<HTMLDivElement | null>(null);
  const msgWrapRef = useRef<HTMLDivElement | null>(null);
  const msgTextRef = useRef<HTMLSpanElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);

  const onPath = showOn.includes(pathname);

  useEffect(() => {
    if (!onPath) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/announcement", { cache: "no-store" });
        if (!res.ok) return;
        const { announcement } = (await res.json()) as { announcement: PublicAnnouncement | null };
        if (!alive || !announcement) return;
        let isDismissed = false;
        try {
          isDismissed = localStorage.getItem(DISMISS_KEY) === announcement.id;
        } catch {
          /* storage blocked — show it */
        }
        setAnn(announcement);
        setDismissed(isDismissed);
      } catch {
        /* offline — no banner */
      }
    })();
    return () => {
      alive = false;
    };
  }, [onPath, pathname]);

  const visible = onPath && !!ann && !dismissed;

  // Publish height so the layout reserves space (0 when hidden → exact layout).
  useEffect(() => {
    const root = document.documentElement;
    if (!visible || !barRef.current) {
      root.style.setProperty("--frenz-topbanner-h", "0px");
      return;
    }
    const bar = barRef.current;
    const set = () => root.style.setProperty("--frenz-topbanner-h", `${bar.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(bar);
    return () => {
      ro.disconnect();
      root.style.setProperty("--frenz-topbanner-h", "0px");
    };
  }, [visible]);

  // Marquee only when the message is too long to fit — measure the single copy
  // against its container. Short messages stay static (no needless scrolling).
  useEffect(() => {
    if (!visible) return;
    const wrap = msgWrapRef.current;
    const text = msgTextRef.current;
    if (!wrap || !text) return;
    const check = () => setOverflowing(text.scrollWidth > wrap.clientWidth + 4);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [visible, ann?.message]);

  if (!visible || !ann) return null;

  const v = VARIANTS[ann.variant];
  const Icon = v.icon;
  // Slow, readable scroll speed scaled to the message length.
  const marqueeSeconds = Math.max(12, Math.round(ann.message.length * 0.22));

  const dismiss = () => {
    haptic("light");
    playSound("tap");
    try {
      localStorage.setItem(DISMISS_KEY, ann.id);
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  return (
    <div
      ref={barRef}
      style={{ top: "var(--frenz-header-bottom, calc(var(--frenz-safe-top, 0px) + 4rem))" }}
      className="fixed inset-x-0 z-40 animate-[slideDownIn_320ms_cubic-bezier(0.22,1,0.36,1)]"
      role="status"
    >
      <div className={cn("bg-gradient-to-r text-white shadow-lg", v.bar)}>
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2.5 px-3 py-2 sm:gap-3 sm:px-4">
          <span className={cn("hidden shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide sm:inline-flex", v.chip)}>
            <Icon className="h-3.5 w-3.5" /> {v.label}
          </span>
          <Icon className="h-4 w-4 shrink-0 sm:hidden" />
          <div ref={msgWrapRef} className="min-w-0 flex-1 overflow-hidden">
            <div
              className={cn("flex w-max whitespace-nowrap", overflowing && "gap-16")}
              style={overflowing ? { animation: `announcement-marquee ${marqueeSeconds}s linear infinite` } : undefined}
            >
              <span ref={msgTextRef} className="text-sm font-medium">{ann.message}</span>
              {overflowing ? <span aria-hidden className="text-sm font-medium">{ann.message}</span> : null}
            </div>
          </div>
          {ann.ctaLabel && ann.ctaHref ? (
            <a
              href={ann.ctaHref}
              onClick={() => {
                haptic("light");
                playSound("tap");
              }}
              className="shrink-0 rounded-full bg-white/95 px-3 py-1 text-xs font-bold text-neutral-900 shadow-sm transition hover:bg-white active:scale-[0.97]"
            >
              {ann.ctaLabel}
            </a>
          ) : null}
          {ann.dismissible ? (
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss announcement"
              className="shrink-0 rounded-lg p-1 text-white/80 transition hover:bg-white/15 hover:text-white active:scale-90"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
