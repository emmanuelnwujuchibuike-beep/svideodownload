"use client";

import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";

import type { FriendItem, FriendProfile } from "@/lib/social/friends";
import { cn } from "@/lib/utils";

/**
 * Friend Orbit — the Friends Hub signature piece (Frenzsave exclusive #1):
 * favorite friends float around the viewer's avatar; the most recently
 * chatted-with sit on the inner ring, quieter friendships drift outward.
 * Tap any orb to open the chat. Purely presentational — closeness comes from
 * real DM recency, not a black box. Hidden until the user has favorites.
 */
export function FriendOrbit({ viewer, favorites }: { viewer: FriendProfile; favorites: FriendItem[] }) {
  const reduced = useReducedMotion();
  if (favorites.length === 0) return null;

  // Closest = most recent chat. Inner ring holds up to 3, outer up to 5.
  const ranked = [...favorites]
    .sort((a, b) => (b.lastChatAt ?? "").localeCompare(a.lastChatAt ?? ""))
    .slice(0, 8);
  const inner = ranked.slice(0, Math.min(3, ranked.length));
  const outer = ranked.slice(inner.length);

  const place = (list: FriendItem[], radius: number, startDeg: number) =>
    list.map((f, i) => {
      const angle = ((startDeg + (360 / list.length) * i) * Math.PI) / 180;
      return { f, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    });

  const orbs = [...place(inner, 72, -90), ...place(outer, 118, -54)];

  return (
    <section aria-label="Favorite friends orbit" className="relative mx-auto mb-6 h-[280px] w-full max-w-md">
      {/* Ambient glow + orbit guide rings */}
      <div aria-hidden className="absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-blue-500/15 to-violet-500/15 blur-3xl" />
      <div aria-hidden className="absolute left-1/2 top-1/2 h-[144px] w-[144px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-border/50" />
      <div aria-hidden className="absolute left-1/2 top-1/2 h-[236px] w-[236px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-border/30" />

      {/* Viewer at the center */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <span className="block rounded-full bg-gradient-to-br from-blue-500 via-violet-500 to-fuchsia-500 p-[3px] shadow-lg shadow-violet-500/30">
          <OrbAvatar user={viewer} size={64} ring={false} />
        </span>
      </div>

      {orbs.map(({ f, x, y }, i) => (
        <motion.div
          key={f.user.id}
          className="absolute left-1/2 top-1/2"
          initial={{ x, y, opacity: 0, scale: 0.6 }}
          animate={
            reduced
              ? { x, y, opacity: 1, scale: 1 }
              : { x, y: [y, y - 5, y], opacity: 1, scale: 1 }
          }
          transition={{
            opacity: { delay: 0.05 * i, duration: 0.3 },
            scale: { delay: 0.05 * i, type: "spring", stiffness: 300, damping: 20 },
            y: reduced ? undefined : { duration: 3.6 + (i % 3), repeat: Infinity, ease: "easeInOut", delay: i * 0.4 },
          }}
          style={{ translateX: "-50%", translateY: "-50%" }}
        >
          <Link
            href={`/messages/new/${f.user.id}`}
            title={`Chat with ${f.user.displayName}`}
            aria-label={`Chat with ${f.user.displayName}`}
            className="group relative block"
          >
            <OrbAvatar user={f.user} size={i < inner.length ? 48 : 40} ring />
            {f.unread > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-background">
                {f.unread > 9 ? "9+" : f.unread}
              </span>
            ) : null}
            <span className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-card/95 px-1.5 py-0.5 text-[10px] font-medium opacity-0 shadow-sm transition group-hover:opacity-100">
              {f.user.displayName.split(" ")[0]}
            </span>
          </Link>
        </motion.div>
      ))}
    </section>
  );
}

function OrbAvatar({ user, size, ring }: { user: FriendProfile; size: number; ring: boolean }) {
  const cls = cn(
    "block rounded-full object-cover",
    ring && "ring-2 ring-violet-500/40 transition group-hover:ring-violet-400",
  );
  return user.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={user.avatarUrl} alt="" width={size} height={size} className={cls} style={{ width: size, height: size }} />
  ) : (
    <span
      className={cn(cls, "flex items-center justify-center bg-gradient-to-br from-blue-600 to-violet-600 font-bold text-white")}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {user.displayName.charAt(0).toUpperCase()}
    </span>
  );
}
