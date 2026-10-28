"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/*
  The reels engagement tray from design/frenz-reels.html (owner, 2026-10-28: "use exactly what's in the design").
  Creator (+ follow) · like · comment · save · share · sound disc, in that order, bare filled glyphs with a soft drop
  shadow and a count under each. Gift and Repost live in the Share sheet (reel-share-sheet.tsx).

  Light on purpose ("everything must be light weight, fast and never over heat"): plain buttons and inline SVG, no
  framer-motion, no timers. The only motion is CSS — a one-off pump when a like or save turns on, and the sound disc's
  slow rotation, which stops whenever the reel isn't playing (and under Reduce Motion).
*/

const ICON_SHADOW = "[filter:drop-shadow(0_1px_1.5px_rgba(0,0,0,0.35))_drop-shadow(0_2px_6px_rgba(0,0,0,0.25))]";
const COUNT = "mt-px min-h-[15px] text-[12.5px] font-bold tabular-nums tracking-[-0.01em] text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.55),0_0_10px_rgba(0,0,0,0.25)]";

/** 12.5K, 1.2M — the design's counter. */
export function compactCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

export function RailAct({
  label,
  count,
  on,
  onClick,
  press,
  children,
}: {
  label: string;
  count?: number;
  on?: boolean;
  onClick: (e: React.MouseEvent) => void;
  press?: Record<string, unknown>;
  children: ReactNode;
}) {
  return (
    <div className="relative flex w-14 flex-col items-center">
      <button
        type="button"
        aria-label={count !== undefined ? `${label}, ${count}` : label}
        aria-pressed={on}
        onClick={(e) => {
          e.stopPropagation();
          onClick(e);
        }}
        {...press}
        className={cn(
          "flex h-11 w-12 items-center justify-center rounded-full transition-transform duration-150 active:scale-[0.86] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80",
          ICON_SHADOW,
          on && "motion-safe:animate-[reel-pump_0.45s_cubic-bezier(0.34,1.56,0.64,1)]",
        )}
      >
        {children}
      </button>
      {count !== undefined ? <span className={COUNT}>{count > 0 ? compactCount(count) : ""}</span> : null}
    </div>
  );
}

export const HeartGlyph = ({ on }: { on: boolean }) => (
  <svg width="36" height="36" viewBox="0 0 24 24" aria-hidden>
    <path d="M12 21s-8.6-5-8.6-11.4A4.9 4.9 0 0 1 12 6.6a4.9 4.9 0 0 1 8.6 3C20.6 16 12 21 12 21z" fill={on ? "#FF3B5C" : "#fff"} className="transition-[fill] duration-200" />
  </svg>
);

export const CommentGlyph = () => (
  <svg width="34" height="34" viewBox="0 0 24 24" aria-hidden>
    <path d="M12 3.3c5 0 9 3.5 9 7.9s-4 7.9-9 7.9c-1 0-2-.1-2.9-.4L4.6 21l1-3.9C4 15.6 3 13.5 3 11.2c0-4.4 4-7.9 9-7.9z" fill="#fff" />
    <circle cx="8.2" cy="11.3" r="1.35" fill="#1a1a22" />
    <circle cx="12" cy="11.3" r="1.35" fill="#1a1a22" />
    <circle cx="15.8" cy="11.3" r="1.35" fill="#1a1a22" />
  </svg>
);

export const SaveGlyph = ({ on }: { on: boolean }) => (
  <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden>
    <path d="M6.5 2.8h11A1.5 1.5 0 0 1 19 4.3V21l-7-4.6L5 21V4.3a1.5 1.5 0 0 1 1.5-1.5z" fill={on ? "#FFC233" : "#fff"} className="transition-[fill] duration-200" />
  </svg>
);

export const ShareGlyph = () => (
  <svg width="34" height="34" viewBox="0 0 24 24" aria-hidden>
    <path d="M13.5 3.6l8 7.4-8 7.4v-4.2c-5.3-.2-8.4 1.7-10.5 5.4.6-6.1 3.6-10.3 10.5-11.1z" fill="#fff" />
  </svg>
);

/** The creator's avatar on a white ring, with the red + that turns into a white ✓ (one spin) once followed. */
export function RailCreator({
  avatarUrl,
  name,
  profileHref,
  following,
  showFollow,
  onFollow,
  renderLink,
}: {
  avatarUrl: string | null;
  name: string;
  profileHref: string;
  following: boolean;
  showFollow: boolean;
  onFollow: () => void;
  /** the caller's own Link (keeps its prefetch and close rules) */
  renderLink: (props: { href: string; className: string; children: ReactNode; label: string }) => ReactNode;
}) {
  return (
    <div className="relative mb-2.5 h-[50px] w-[50px]">
      {renderLink({
        href: profileHref,
        label: `Open ${name}'s profile`,
        className: "block h-[50px] w-[50px] rounded-full bg-white p-[2px] shadow-[0_4px_14px_rgba(0,0,0,0.35)]",
        children: avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" width={46} height={46} decoding="async" className="h-full w-full rounded-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center rounded-full bg-neutral-900 text-base font-bold text-white">{name.replace(/^@/, "").charAt(0).toUpperCase()}</span>
        ),
      })}
      {showFollow ? (
        <button
          type="button"
          aria-label={following ? `Following ${name}` : `Follow ${name}`}
          aria-pressed={following}
          onClick={(e) => {
            e.stopPropagation();
            onFollow();
          }}
          className={cn(
            "absolute -bottom-2.5 left-1/2 -ml-[11px] flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-white shadow-[0_2px_6px_rgba(0,0,0,0.3)] transition-[transform,background-color] duration-[350ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]",
            following ? "rotate-[360deg] bg-white" : "bg-[#FF3B5C]",
          )}
        >
          <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden>
            <path d={following ? "M2.5 6.3l2.3 2.3L9.5 3.8" : "M6 1.5v9M1.5 6h9"} stroke={following ? "#111" : "#fff"} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

/** The sound disc: a record that turns while the reel plays. */
export function SoundDisc({ playing, thumbnailUrl }: { playing: boolean; thumbnailUrl: string | null }) {
  return (
    <span
      aria-hidden
      style={{ animationPlayState: playing ? "running" : "paused" }}
      className="mt-1.5 block h-[42px] w-[42px] rounded-full bg-[radial-gradient(circle,#2A2A33_0_40%,#121218_41%_100%)] p-2 shadow-[0_0_0_2px_rgba(255,255,255,0.18),0_4px_12px_rgba(0,0,0,0.35)] motion-safe:animate-[spin_6s_linear_infinite]"
    >
      {thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumbnailUrl} alt="" width={26} height={26} decoding="async" loading="lazy" className="h-full w-full rounded-full object-cover" />
      ) : (
        <span className="block h-full w-full rounded-full bg-[linear-gradient(135deg,#3B5BFD_0%,#5B4BF3_50%,#8A3CEB_100%)]" />
      )}
    </span>
  );
}
