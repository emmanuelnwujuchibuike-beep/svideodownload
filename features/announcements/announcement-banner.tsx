"use client";

import { Gift, Megaphone, Rocket, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { type ComponentType, useEffect, useRef, useState } from "react";

import { announcementHiddenOn } from "@/features/announcements/hidden-paths";
import type { PublicAnnouncement } from "@/lib/announcement";
import { formatAnnouncement } from "@/lib/announcement-format";
import { haptic } from "@/lib/motion/haptics";
import { cdnBucket } from "@/lib/net/cdn-bucket";
import { playSound } from "@/lib/notifications/sound-fx";
import { cn } from "@/lib/utils";

/**
 * Premium site announcement bar — pinned just below the header, shown GLOBALLY to
 * every visitor (incl. anonymous) on every page (owner: "it must be global on all
 * users' browsers"). Content is set by admins (see /admin → Announcement) and
 * fetched here after paint, so it never touches the landing's cold-entry budget and
 * never un-statics a page. Fixed at `--frenz-header-bottom`; publishes its height as
 * `--frenz-announce-h` so the layout reserves space (the top-of-page ad, if any,
 * stacks BELOW it). Dismissal is keyed by the announcement's content hash, so
 * editing the copy re-shows it. An optional `showOn` allowlist can scope it.
 */

const DISMISS_KEY = "frenz-ann-dismissed";

const VARIANTS: Record<
  PublicAnnouncement["variant"],
  { icon: ComponentType<{ className?: string }>; label: string; bar: string }
> = {
  feature: {
    icon: Rocket,
    label: "New",
    bar: "from-violet-600 via-indigo-600 to-blue-600",
  },
  update: {
    icon: Rocket,
    label: "Update",
    bar: "from-emerald-500 via-teal-600 to-cyan-600",
  },
  announcement: {
    icon: Megaphone,
    label: "News",
    bar: "from-blue-600 via-sky-600 to-indigo-600",
  },
  promo: {
    icon: Gift,
    label: "Offer",
    bar: "from-amber-500 via-orange-500 to-rose-500",
  },
};

/*
  ONE request per document, not one per navigation (2026-10-05). The effect
  below re-runs on every `pathname` change — it must, to re-apply `showOn` —
  and it used to re-fetch `no-store` each time, so a member moving through
  five pages paid five invocations for one unchanged global answer. The
  promise is memoised for the document and the URL carries the CDN bucket.
*/
let announcementPromise: Promise<PublicAnnouncement | null> | null = null;
function loadAnnouncement(): Promise<PublicAnnouncement | null> {
  announcementPromise ??= fetch(`/api/announcement?b=${cdnBucket()}`)
    .then((r) => (r.ok ? r.json() : { announcement: null }))
    .then((d: { announcement?: PublicAnnouncement | null }) => d.announcement ?? null)
    .catch(() => {
      announcementPromise = null; // offline — let a later navigation try again
      return null;
    });
  return announcementPromise;
}

export function AnnouncementBanner({ showOn }: { showOn?: string[] }) {
  const pathname = usePathname();
  const [ann, setAnn] = useState<PublicAnnouncement | null>(null);
  const [dismissed, setDismissed] = useState(true); // hidden until we know
  const barRef = useRef<HTMLDivElement | null>(null);
  const msgWrapRef = useRef<HTMLDivElement | null>(null);
  const msgTextRef = useRef<HTMLSpanElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);

  // GLOBAL by default (owner: it must reach every visitor, incl. anonymous, on every
  // page). A `showOn` allowlist is optional; when omitted the bar shows everywhere.
  const onPath = !announcementHiddenOn(pathname) && (showOn ? showOn.includes(pathname) : true);

  useEffect(() => {
    if (!onPath) return;
    let alive = true;
    (async () => {
      try {
        const announcement = await loadAnnouncement();
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
      root.style.setProperty("--frenz-announce-h", "0px");
      return;
    }
    const bar = barRef.current;
    const set = () => root.style.setProperty("--frenz-announce-h", `${bar.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(bar);
    return () => {
      ro.disconnect();
      root.style.setProperty("--frenz-announce-h", "0px");
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
  // The built-in house style (lib/announcement-format.ts): tidy punctuation and
  // spacing, and a short first sentence promoted to a headline.
  const copy = formatAnnouncement(ann.message);
  const message = (
    <>
      {copy.headline ? (
        <>
          <span className="font-brand text-[14px] font-bold tracking-[-0.01em] text-white sm:text-[15px]">{copy.headline}</span>
          <span aria-hidden className="mx-2 inline-block h-1 w-1 translate-y-[-2px] rounded-full bg-white/50" />
        </>
      ) : null}
      <span className={cn(copy.headline ? "font-medium text-white/85" : "font-semibold text-white")}>{copy.body}</span>
    </>
  );

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
      className={cn(
        "fixed inset-x-0 z-40 overflow-hidden bg-gradient-to-r text-white animate-[slideDownIn_420ms_cubic-bezier(0.16,1,0.3,1)]",
        v.bar,
      )}
      role="status"
    >
      {/* Embedded strip, edge to edge on top of the body (owner 2026-10-18) — no
          floating card, no rounded corners, no side gutter. The content stays
          centred in a readable column on wide screens. */}
      {/* top sheen for depth */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/15 to-transparent" />
      <div className="relative mx-auto flex max-w-2xl items-center gap-3 px-4 py-2.5">

        {/* icon on a frosted tile */}
        <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-inset ring-white/25 shadow-sm shadow-black/10">
          <Icon className="h-4 w-4" />
        </span>

        <div className="relative min-w-0 flex-1">
          <span className="mb-1 inline-flex items-center rounded-full bg-white/15 px-2 py-px font-brand text-[9.5px] font-bold uppercase leading-4 tracking-[0.18em] text-white/90 ring-1 ring-inset ring-white/20">
            {v.label}
          </span>
          <div ref={msgWrapRef} className="overflow-hidden">
            <div
              className={cn("flex w-max whitespace-nowrap", overflowing && "gap-16")}
              style={overflowing ? { animation: `announcement-marquee ${marqueeSeconds}s linear infinite` } : undefined}
            >
              <span ref={msgTextRef} className="text-[13px] leading-snug tracking-[-0.005em] antialiased sm:text-sm">
                {message}
              </span>
              {overflowing ? (
                <span aria-hidden className="text-[13px] leading-snug tracking-[-0.005em] antialiased sm:text-sm">
                  {message}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {ann.ctaLabel && ann.ctaHref ? (
          <a
            href={ann.ctaHref}
            onClick={() => {
              haptic("light");
              playSound("tap");
            }}
            className="relative shrink-0 rounded-full bg-white px-3.5 py-1.5 text-xs font-bold text-neutral-900 shadow-md shadow-black/10 transition hover:bg-white/90 active:scale-[0.96]"
          >
            {ann.ctaLabel}
          </a>
        ) : null}
        {ann.dismissible ? (
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss announcement"
            className="relative shrink-0 rounded-full p-1.5 text-white/70 transition hover:bg-white/15 hover:text-white active:scale-90"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
