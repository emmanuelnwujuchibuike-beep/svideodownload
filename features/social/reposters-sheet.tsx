"use client";

import { AnimatePresence, motion } from "framer-motion";
import { BadgeCheck, Check, Loader2, Repeat2, UserPlus, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { toggleFollow, useFollowState } from "@/lib/social/follow-store";
import { springs } from "@/lib/motion/springs";
import { cn } from "@/lib/utils";

interface Reposter {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  isVerified: boolean;
  caption: string | null;
  repostedAt: string;
  isFollowing: boolean;
  isSelf: boolean;
}

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Who reposted this — the bottom sheet behind the overlapping-avatar cluster.
 * People the viewer follows lead (the server orders them), each row shows the
 * reposter's recommendation caption when they wrote one, with quick Follow and
 * a profile link. Fetches lazily on first open.
 */
export function RepostersSheet({ postId, open, onClose }: { postId: string; open: boolean; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Reposter[]>([]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch(`/api/posts/${postId}/reposters`)
      .then((r) => (r.ok ? r.json() : { reposters: [] }))
      .then((d) => setRows((d.reposters ?? []) as Reposter[]))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [open, postId]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[95] flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Reposted by">
          <motion.button
            type="button"
            aria-label="Close"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
          />
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={springs.sheet}
            className="relative m-2 w-full max-w-md overflow-hidden rounded-3xl border border-border/60 bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-2xl backdrop-blur-2xl"
          >
            <div className="mx-auto mb-2 mt-2.5 h-1 w-9 rounded-full bg-border" />
            <div className="flex items-center justify-between px-5 pb-2">
              <h3 className="flex items-center gap-1.5 text-sm font-bold">
                <Repeat2 className="h-4 w-4 text-emerald-500" /> Reposted by
              </h3>
              <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[56vh] overflow-y-auto px-2.5 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {loading ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : rows.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">No reposts yet.</p>
              ) : (
                rows.map((r) => <ReposterRowItem key={r.id} r={r} onNavigate={onClose} />)
              )}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function ReposterRowItem({ r, onNavigate }: { r: Reposter; onNavigate: () => void }) {
  const following = useFollowState(r.id, r.isFollowing);
  const [busy, setBusy] = useState(false);

  const follow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await toggleFollow(r.id, !following);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl px-3 py-2.5 transition hover:bg-secondary/60">
      <div className="flex items-center gap-3">
        <Link href={`/u/${r.handle}`} onClick={onNavigate} className="shrink-0">
          {r.avatarUrl ? (
            <Image src={r.avatarUrl} alt="" width={40} height={40} className="h-10 w-10 rounded-full object-cover ring-1 ring-border" />
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-sm font-bold text-white">
              {r.displayName.charAt(0).toUpperCase()}
            </span>
          )}
        </Link>
        <Link href={`/u/${r.handle}`} onClick={onNavigate} className="min-w-0 flex-1">
          <span className="flex items-center gap-1 text-sm font-semibold leading-tight">
            <span className="truncate">{r.displayName}</span>
            {r.isVerified ? <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            @{r.handle} · {timeAgo(r.repostedAt)}
          </span>
        </Link>
        {!r.isSelf ? (
          <button
            type="button"
            onClick={follow}
            disabled={busy}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60",
              following ? "bg-secondary text-foreground" : "bg-gradient-to-r from-blue-600 to-violet-600 text-white hover:opacity-95",
            )}
          >
            {following ? <Check className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
            {following ? "Following" : "Follow"}
          </button>
        ) : null}
      </div>
      {r.caption ? (
        <p className="ml-[52px] mt-1 border-l-2 border-emerald-500/40 pl-2.5 text-[13px] leading-relaxed text-foreground/90">{r.caption}</p>
      ) : null}
    </div>
  );
}
