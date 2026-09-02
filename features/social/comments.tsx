"use client";

import {
  AnimatePresence,
  motion } from "framer-motion";
import {
  BadgeCheck,
  Award,
  CornerUpLeft,
  Copy,
  Flag,
  ImagePlus,
  Link2,
  Loader2,
  MapPin,
  Mic,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Pin,
  Quote,
  Search,
  Send,
  Smile,
  SmilePlus,
  Sparkles,
  Trash2,
  Users,
  VolumeX,
  Wand2,
  X,
} from "lucide-react";
import { VerifiedTick } from "@/components/badges/identity-badges";
import dynamic from "next/dynamic";
import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DiamondCrownBadge } from "@/components/badges/diamond-crown-badge";
import { RichText } from "@/components/social/rich-text";
import { VideoComment, VoiceMessage } from "@/features/social/comment-media";
import { StickerPicker } from "@/features/social/sticker-picker";
import { useEntitlements } from "@/features/auth/use-entitlements";
import type { TypingHandle } from "@/features/social/comment-typing-indicator";
import { floatReaction } from "@/features/ui/reaction-float";
import { toast } from "@/features/ui/toast";
import { uploadPostMedia } from "@/lib/storage/client-upload";
import { COMMENT_MOODS, COMMENT_REACTIONS, commentMood, pinLabel } from "@/lib/social/comment-meta";
import type { CommentNode } from "@/lib/social/engagement";
import type { SearchPerson } from "@/lib/social/search";
import { stickerGlyph, type Sticker } from "@/lib/social/stickers";
import { supportsRecording } from "@/lib/media/comment-recording";
import { haptic } from "@/lib/motion/haptics";
import { createClient } from "@/lib/supabase/client";
import { cn, formatCompactNumber } from "@/lib/utils";

// Code-split: MediaRecorder/camera-mic UI most viewers never trigger, kept out
// of every comment section's initial bundle (mirrors CollectionPicker/
// PostEditSheet/etc. in feed-post-card.tsx). `loading` fallbacks mean even an
// un-preloaded first tap shows an immediate, on-brand placeholder instead of a
// dead gap while the chunk fetches — preloadRecorders() below (called once
// the composer is actually on screen) means that fallback is rarely seen.
const VoiceRecorder = dynamic(() => import("@/features/social/voice-recorder").then((m) => m.VoiceRecorder), {
  ssr: false,
  loading: () => (
    <div className="flex h-[52px] items-center gap-2 rounded-3xl border border-border/60 bg-card/70 px-4 shadow-soft backdrop-blur-xl">
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      <span className="text-sm text-muted-foreground">Getting the mic ready…</span>
    </div>
  ),
});
const ReportSheet = dynamic(() => import("@/features/social/report-sheet").then((m) => m.ReportSheet), { ssr: false });
// Post-owner-only, opened rarely — kept out of every viewer's initial bundle.
const PinLabelPicker = dynamic(() => import("@/features/social/pin-label-picker").then((m) => m.PinLabelPicker), { ssr: false });
// Most comments are never AI-assisted — same code-split reasoning.
const CommentAiAssist = dynamic(() => import("@/features/social/comment-ai-assist").then((m) => m.CommentAiAssist), { ssr: false });
const CommentThreadSummary = dynamic(() => import("@/features/social/comment-thread-summary").then((m) => m.CommentThreadSummary), { ssr: false });
// Shares its internals with messaging's ~370-line presence-channel module —
// see comment-typing-indicator.tsx's own header for why this one specifically
// needs to be split, not just "most viewers never trigger it" like the rest.
const CommentTypingIndicator = dynamic(() => import("@/features/social/comment-typing-indicator").then((m) => m.CommentTypingIndicator), { ssr: false });
function preloadRecorders() {
  void import("@/features/social/voice-recorder");
}

type SortMode = "smart" | "top" | "new" | "friends";
const SORTS: { id: SortMode; label: string }[] = [
  { id: "smart", label: "Smart" },
  { id: "top", label: "Top" },
  { id: "new", label: "Newest" },
  { id: "friends", label: "Friends" },
];
const MAX = 1000;

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function patchNode(nodes: CommentNode[], id: string, fn: (n: CommentNode) => CommentNode): CommentNode[] {
  return nodes.map((n) => {
    if (n.id === id) return fn(n);
    if (n.replies.length) return { ...n, replies: patchNode(n.replies, id, fn) };
    return n;
  });
}

/** Every node in the tree, any depth — the basis for in-thread search. A
 *  post's comments are already paginated (400-row cap in listComments), so
 *  this walk is cheap; this is deliberately NOT a global index across posts —
 *  see docs/FEATURE_15_PART_5_COMMENTS.md §7 on why "billions of comments"
 *  search isn't what this tranche builds. */
function flattenNodes(nodes: CommentNode[]): CommentNode[] {
  const out: CommentNode[] = [];
  for (const n of nodes) {
    out.push(n);
    if (n.replies.length) out.push(...flattenNodes(n.replies));
  }
  return out;
}

function smartScore(n: CommentNode): number {
  const hours = (Date.now() - new Date(n.createdAt).getTime()) / 3_600_000;
  const recency = Math.max(0, 24 - hours) / 24;
  return n.likesCount * 3 + n.replies.length * 2 + recency * 5;
}

/** Applies a reaction toggle to a node (optimistic). */
function applyReaction(n: CommentNode, emoji: string): CommentNode {
  const prev = n.viewerReaction;
  const reactions = n.reactions.map((r) => ({ ...r }));
  const bump = (e: string, d: number) => {
    const i = reactions.findIndex((r) => r.emoji === e);
    if (i >= 0) {
      reactions[i]!.count += d;
      if (reactions[i]!.count <= 0) reactions.splice(i, 1);
    } else if (d > 0) reactions.push({ emoji: e, count: 1 });
  };
  let viewerReaction: string | null = prev;
  let likes = n.likesCount;
  if (prev === emoji) {
    bump(emoji, -1);
    viewerReaction = null;
    likes = Math.max(0, likes - 1);
  } else {
    if (prev) bump(prev, -1);
    bump(emoji, 1);
    if (!prev) likes += 1;
    viewerReaction = emoji;
  }
  reactions.sort((a, b) => b.count - a.count);
  return { ...n, reactions, viewerReaction, likesCount: likes, viewerLiked: !!viewerReaction };
}

export function Comments({
  postId,
  comments,
  loggedIn,
  canComment,
  disabledReason,
  count,
  variant = "page",
}: {
  postId: string;
  comments: CommentNode[];
  loggedIn: boolean;
  canComment: boolean;
  disabledReason: string | null;
  count: number;
  variant?: "page" | "sheet";
}) {
  const [nodes, setNodes] = useState<CommentNode[]>(comments);
  const [total, setTotal] = useState(count);
  const [sort, setSort] = useState<SortMode>("smart");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [summaryOpen, setSummaryOpen] = useState(false);
  const sheet = variant === "sheet";

  // In-thread search — keyword, @mention, #hashtag, or username, scoped to
  // THIS post's already-loaded comments (see flattenNodes's doc comment on
  // why that's the honest scope, not a global index).
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    return flattenNodes(nodes).filter(
      (n) =>
        n.body.toLowerCase().includes(q) ||
        n.author?.displayName.toLowerCase().includes(q) ||
        n.author?.handle.toLowerCase().includes(q),
    );
  }, [nodes, searchQuery]);

  // Quote Reply (Part 5 tranche 4) — set from ANY comment's ⋯ menu, at any
  // depth, but always composed at the top level (a quote references a
  // comment, not necessarily the one it's structurally replying to).
  const [quoting, setQuoting] = useState<CommentNode | null>(null);

  // Typing indicator (Part 5 tranche 3) — the plumbing gap tranche 2 flagged
  // (no viewer identity was available at any of the 5 comment mount points)
  // turned out not to need new props at all: `useEntitlements()` already
  // fetches + memoizes /api/me process-wide for the header/premium gating,
  // so this costs nothing extra over what's already happening on every page.
  // `handle` (not the raw user id) is the presence key — unique and stable
  // per viewer, and the ONLY identity this component already has access to
  // without a new endpoint or a prop threaded through 5 files.
  //
  // The actual presence-channel hook is code-split (comment-typing-indicator.tsx)
  // — it shares its internals with messaging's ~370-line use-typing.ts, which
  // a static import here would otherwise put on every route that renders
  // comments (home, /p/[id], reels, …), not just message threads.
  const { handle: viewerHandle, displayName: viewerDisplayName, ready: identityReady } = useEntitlements();
  const typingTopic = loggedIn && identityReady && viewerHandle ? postId : "";
  const [typingHandle, setTypingHandle] = useState<TypingHandle | null>(null);
  const notifyTyping = useCallback(() => typingHandle?.notifyTyping(), [typingHandle]);
  const clearTyping = useCallback(() => typingHandle?.clearTyping(), [typingHandle]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/posts/${postId}/comments`);
      if (res.ok) {
        const j = (await res.json()) as { comments: CommentNode[] };
        setNodes(j.comments ?? []);
        setTotal((j.comments ?? []).reduce((n, c) => n + 1 + c.replies.length, 0));
      }
    } catch {
      /* keep current */
    }
  }, [postId]);

  // Live comments (Part 5 tranche 2) — a postgres_changes event carries only
  // the raw row (no author profile join, no reaction tally, no sticker/mood
  // rendering info), so re-fetching through the same listComments() path a
  // manual refresh already uses is the correct move here, not hand-assembling
  // a CommentNode client-side from a partial payload. Debounced: a burst of
  // several events (a few reactions landing back to back) should cause one
  // refetch, not one per row.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 400);
    };
    const supabase = createClient();
    /*
      ═══════════════════════════════════════════════════════════════════════
       🔴 THE TOPIC MUST BE UNIQUE PER SUBSCRIPTION, NOT PER POST
      ═══════════════════════════════════════════════════════════════════════

      Owner, 2026-09-01: opening comments on a reel showed "something went
      wrong, try again". Reproduced on production while signed in; the thrown
      error was, verbatim:

          cannot add `postgres_changes` callbacks for
          realtime:comments:9aa701ab-… after `subscribe()`

      This topic used to be the fixed string `comments:${postId}`, and
      realtime-js DE-DUPLICATES BY TOPIC: asking for a topic it already holds
      hands back the existing channel rather than a new one. `removeChannel()`
      is asynchronous and was not awaited (it cannot be — a cleanup function is
      synchronous), so on any re-run of this effect the teardown was still in
      flight when the new run asked for the same topic, got the OLD channel back
      in its already-subscribed state, and called `.on()` on it. realtime-js
      throws there by design: callbacks cannot be added after `subscribe()`.

      That throw escaped the effect, the nearest boundary caught it, and both
      feed and reels fall through to the same `app/(app)/error.tsx` — which is
      why one bug produced identical wording in two unrelated features and got
      mis-attributed to a stale-chunk `ChunkLoadError` in an earlier pass.

      It reproduces whenever the effect runs twice for one post: React
      StrictMode's double-invoke, and — the case the owner hits — closing the
      comment sheet and opening it again on the same reel.

      A unique suffix makes the collision impossible rather than unlikely. The
      old channel is still removed below; it simply no longer matters whether
      that has finished, because nothing will ever ask for its topic again.
    */
    const channel = supabase
      .channel(`comments:${postId}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "post_comments", filter: `post_id=eq.${postId}` }, scheduleRefresh)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [postId, refresh]);

  const react = useCallback(
    async (id: string, emoji: string) => {
      let removed = false;
      setNodes((ns) =>
        patchNode(ns, id, (n) => {
          removed = n.viewerReaction === emoji;
          return applyReaction(n, emoji);
        }),
      );
      try {
        const res = await fetch(`/api/comments/${id}/like`, {
          method: removed ? "DELETE" : "POST",
          headers: { "Content-Type": "application/json" },
          body: removed ? undefined : JSON.stringify({ emoji }),
        });
        if (!res.ok) throw new Error();
      } catch {
        void refresh();
      }
    },
    [refresh],
  );

  const moderate = useCallback(
    async (id: string, action: "pin" | "best", on: boolean, label?: string | null) => {
      haptic("selection");
      setNodes((ns) =>
        patchNode(ns, id, (n) =>
          action === "pin"
            ? { ...n, pinned: on, pinLabel: on ? (label ?? null) : null, pinnedAt: on ? new Date().toISOString() : null }
            : { ...n, isBest: on },
        ),
      );
      try {
        const res = await fetch(`/api/comments/${id}/${action}`, {
          method: on ? "POST" : "DELETE",
          headers: on && action === "pin" ? { "Content-Type": "application/json" } : undefined,
          body: on && action === "pin" ? JSON.stringify({ label: label ?? undefined }) : undefined,
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as { error?: string } | null;
          toast(j?.error ?? "Couldn't update.", "error");
          throw new Error();
        }
        if (action === "best" && on) void refresh(); // clears any previous best
      } catch {
        void refresh();
      }
    },
    [refresh],
  );

  const sorted = useMemo(() => {
    const arr = [...nodes];
    const base =
      sort === "top"
        ? (a: CommentNode, b: CommentNode) => b.likesCount - a.likesCount || +new Date(b.createdAt) - +new Date(a.createdAt)
        : sort === "new"
          ? (a: CommentNode, b: CommentNode) => +new Date(b.createdAt) - +new Date(a.createdAt)
          // "smart" and "friends" both fall back to the same engagement/recency
          // ordering — "friends" just adds a relationship pass in front of it.
          : (a: CommentNode, b: CommentNode) => smartScore(b) - smartScore(a);
    // Pinned first (most-recently-pinned first among pins — MAX_PINNED allows
    // several at once), then best answer, then (Friends sort only) mutual
    // friends, then the chosen sort — "gently prioritized", never hiding anyone.
    arr.sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        (a.pinned && b.pinned ? +new Date(b.pinnedAt ?? 0) - +new Date(a.pinnedAt ?? 0) : 0) ||
        Number(b.isBest) - Number(a.isBest) ||
        (sort === "friends" ? Number(!!b.author?.isFriend) - Number(!!a.author?.isFriend) : 0) ||
        base(a, b),
    );
    return arr;
  }, [nodes, sort]);

  // overflow-x-hidden defensively — no part of this section (composer,
  // attachments, mention dropdown, threaded replies) should ever be able to
  // push the page into a horizontal scroll on a narrow phone, whatever
  // content ends up inside it.
  return (
    <section id="comments" className={cn("min-w-0 overflow-x-hidden", !sheet && "mt-10 scroll-mt-24")}>
      <div className={cn("flex items-center justify-between gap-3", sheet ? "mb-3" : "mb-4")}>
        {sheet ? (
          <span />
        ) : (
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-[-0.02em]">
            <MessageCircle className="h-5 w-5 text-foreground" />
            Comments {total > 0 ? <span className="text-muted-foreground">· {formatCompactNumber(total)}</span> : null}
          </h2>
        )}
        <div className="flex items-center gap-1.5">
        {nodes.length > 8 ? (
          <button
            type="button"
            onClick={() => setSummaryOpen((v) => !v)}
            aria-pressed={summaryOpen}
            aria-label="Summarize thread"
            className={cn("rounded-full p-1.5 transition", summaryOpen ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground")}
          >
            <Sparkles className="h-4 w-4" />
          </button>
        ) : null}
        {nodes.length > 3 ? (
          <button
            type="button"
            onClick={() => setSearchOpen((v) => !v)}
            aria-pressed={searchOpen}
            aria-label="Search comments"
            className={cn("rounded-full p-1.5 transition", searchOpen ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground")}
          >
            <Search className="h-4 w-4" />
          </button>
        ) : null}
        {nodes.length > 1 ? (
          <div className="flex items-center gap-0.5 rounded-full border border-border/60 bg-secondary/40 p-0.5 text-xs font-semibold backdrop-blur">
            {SORTS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSort(s.id)}
                aria-pressed={sort === s.id}
                className={cn("relative rounded-full px-2.5 py-1 transition", sort === s.id ? "text-white" : "text-muted-foreground hover:text-foreground")}
              >
                {sort === s.id ? (
                  <motion.span layoutId={`sortpill-${postId}-${variant}`} className="absolute inset-0 -z-0 rounded-full bg-gradient-to-r from-blue-600 to-violet-600 shadow-sm shadow-violet-500/30" transition={{ type: "spring", stiffness: 500, damping: 40 }} />
                ) : null}
                <span className="relative z-10 inline-flex items-center gap-1">
                  {s.id === "smart" ? <Sparkles className="h-3 w-3" /> : null}
                  {s.label}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        </div>
      </div>

      {/* Search bar — toggled by the header's Search icon. */}
      <AnimatePresence initial={false}>
        {searchOpen ? (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mb-3 flex items-center gap-2 rounded-2xl border border-border/60 bg-secondary/30 px-3.5 py-2.5">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search comments, @mentions, #hashtags…"
                aria-label="Search comments"
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              {searchQuery ? (
                <button type="button" onClick={() => setSearchQuery("")} aria-label="Clear search" className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* AI thread summary — reuses /api/comments/assist's "summarize" mode,
          user-triggered only (never runs for every viewer of a thread). */}
      {summaryOpen ? (
        <CommentThreadSummary
          text={flattenNodes(nodes)
            .slice(0, 60)
            .map((n) => `${n.author?.displayName ?? "Unknown"}: ${n.body || "(sticker/attachment)"}`)
            .join("\n")
            .slice(0, 8000)}
          onClose={() => setSummaryOpen(false)}
        />
      ) : null}

      {!loggedIn ? (
        <Link href="/login" className="mb-5 inline-block rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-violet-500/25">
          Sign in to join the conversation
        </Link>
      ) : canComment ? (
        <>
          <Composer
            postId={postId}
            onPosted={refresh}
            onNotifyTyping={notifyTyping}
            onClearTyping={clearTyping}
            quotedNode={quoting}
            onClearQuote={() => setQuoting(null)}
          />
          {/* Live typing indicator — only the top-level composer broadcasts;
              a per-reply-target "who's typing where" breakdown is a fancier
              UI the brief doesn't specifically ask for at that granularity. */}
          {typingTopic ? (
            <CommentTypingIndicator postId={typingTopic} handle={viewerHandle ?? ""} displayName={viewerDisplayName || viewerHandle || "Someone"} onReady={setTypingHandle} />
          ) : null}
        </>
      ) : (
        <p className="mb-5 rounded-2xl border border-border/60 bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
          {disabledReason ?? "Comments are unavailable."}
        </p>
      )}

      {searchResults !== null ? (
        searchResults.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No comments match &quot;{searchQuery.trim()}&quot;.</p>
        ) : (
          <ul className="space-y-2">
            {searchResults.map((n) => (
              <SearchResultRow key={n.id} node={n} query={searchQuery.trim()} onJump={() => { setSearchOpen(false); setSearchQuery(""); requestAnimationFrame(() => jumpToComment(n.id)); }} />
            ))}
          </ul>
        )
      ) : sorted.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border/60 bg-card/40 py-10 text-center">
          <span className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
            <MessageCircle className="h-5 w-5" />
          </span>
          <p className="text-sm text-muted-foreground">No comments yet — start the conversation</p>
        </div>
      ) : (
        <ul className="space-y-4">
          <AnimatePresence initial={false}>
            {sorted.map((c) => (
              <CommentItem key={c.id} node={c} postId={postId} depth={0} canReply={loggedIn && canComment} loggedIn={loggedIn} onPosted={refresh} onReact={react} onModerate={moderate} onQuote={setQuoting} />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}

/** A search-result preview — self-contained (author, snippet, timestamp) so
 *  it's useful even when "Jump to comment" can't reach a collapsed nested
 *  reply (best-effort: jumpToComment no-ops if the element isn't mounted). */
function SearchResultRow({ node, query, onJump }: { node: CommentNode; query: string; onJump: () => void }) {
  const a = node.author;
  const body = node.body || "";
  const q = query.toLowerCase();
  const idx = body.toLowerCase().indexOf(q);
  const snippet =
    idx < 0
      ? body.slice(0, 140)
      : `${idx > 40 ? "…" : ""}${body.slice(Math.max(0, idx - 40), idx)}${body.slice(idx, idx + q.length)}${body.slice(idx + q.length, idx + q.length + 60)}${idx + q.length + 60 < body.length ? "…" : ""}`;
  return (
    <li>
      <button type="button" onClick={onJump} className="flex w-full items-start gap-2.5 rounded-2xl border border-border/50 bg-card/60 px-3.5 py-2.5 text-left transition hover:border-border">
        {a?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={a.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
        ) : (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-xs font-bold text-white">{a?.displayName.charAt(0).toUpperCase() ?? "?"}</span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-sm">
            <span className="font-semibold">{a?.displayName ?? "Unknown"}</span>
            <span className="text-xs text-muted-foreground">· {timeAgo(node.createdAt)}</span>
          </span>
          <span className="mt-0.5 block truncate text-sm text-muted-foreground">{snippet || "(sticker/attachment)"}</span>
        </span>
      </button>
    </li>
  );
}

function Composer({
  postId,
  parentId,
  onPosted,
  onDone,
  autoFocus,
  onNotifyTyping,
  onClearTyping,
  quotedNode,
  onClearQuote,
}: {
  postId: string;
  parentId?: string;
  onPosted: () => void | Promise<void>;
  onDone?: () => void;
  autoFocus?: boolean;
  /** Only the top-level composer gets these (see the Comments render) — a
   *  reply composer simply omits them, no-op. */
  onNotifyTyping?: () => void;
  onClearTyping?: () => void;
  /** Quote Reply (Part 5 tranche 4) — only the top-level composer receives
   *  this (set from any comment's ⋯ menu, at any depth); a reply composer
   *  omits it. */
  quotedNode?: CommentNode | null;
  onClearQuote?: () => void;
}) {
  const [body, setBody] = useState("");
  const [sticker, setSticker] = useState<Sticker | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [mood, setMood] = useState<string | null>(null);
  const [showMoods, setShowMoods] = useState(false);
  const [showAssist, setShowAssist] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showStickers, setShowStickers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number; label: string | null } | null>(null);
  const [locating, setLocating] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Voice-note attachment. Progressive enhancement: the recording affordance
  // only appears once confirmed client-side (avoids an SSR/CSR hydration
  // mismatch — MediaRecorder support can't be known on the server). Live
  // video recording was removed from comments (owner 2026-07-11) — photo
  // attach (gallery/downloads/camera, all via the one native file picker
  // below) and voice notes are the only comment media inputs now; existing
  // video comments still render fine via `node.videoUrl` further down.
  const [canRecord, setCanRecord] = useState(false);
  useEffect(() => setCanRecord(supportsRecording()), []);
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [voice, setVoice] = useState<{ url: string; durationMs: number; waveform: number[] } | null>(null);

  // Warm both recorder chunks once the composer is actually on screen — by
  // the time anyone reaches for the mic/video button the code is already
  // sitting in the browser's module cache, so opening never shows the
  // `loading` fallback in practice. Deferred to idle time so it never
  // competes with the comments list's own first paint.
  useEffect(() => {
    if (!canRecord || typeof window === "undefined") return;
    const ric = window.requestIdleCallback ?? ((cb: IdleRequestCallback) => window.setTimeout(() => cb({} as IdleDeadline), 1200));
    const cic = window.cancelIdleCallback ?? window.clearTimeout;
    const id = ric(() => preloadRecorders());
    return () => cic(id);
  }, [canRecord]);

  // @mention autocomplete — a live in-progress "@partial" token right before
  // the caret triggers a debounced people search; picking a result inserts
  // the exact handle. Notifications are driven server-side by parsing the
  // final body text (see migration 0037), so this is purely a typing aid —
  // it doesn't need to tell the backend anything special.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionAnchor, setMentionAnchor] = useState<number | null>(null);
  const [mentionResults, setMentionResults] = useState<SearchPerson[]>([]);
  const [mentionActive, setMentionActive] = useState(0);
  const mentionReqId = useRef(0);

  // Local draft — the comments sheet unmounts its Composer on close, which
  // used to silently discard a half-typed reply. Keyed per post+target so
  // several in-progress replies on the same post never collide.
  const draftKey = `frenz:comment-draft:${postId}:${parentId ?? "root"}`;
  const draftLoaded = useRef(false);
  useEffect(() => {
    if (draftLoaded.current) return;
    draftLoaded.current = true;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw) as { body?: string; mood?: string | null };
        if (d.body) setBody(d.body);
        if (d.mood) setMood(d.mood);
      }
    } catch {
      /* no draft */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (!body.trim() && !mood) localStorage.removeItem(draftKey);
        else localStorage.setItem(draftKey, JSON.stringify({ body, mood }));
      } catch {
        /* storage unavailable/full — draft just won't persist */
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, mood]);
  const clearDraft = () => {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      /* ignore */
    }
  };

  // Debounced mention search.
  useEffect(() => {
    if (mentionQuery === null || mentionQuery.length === 0) {
      setMentionResults([]);
      return;
    }
    const reqId = ++mentionReqId.current;
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(mentionQuery)}&type=people`)
        .then((r) => (r.ok ? r.json() : { people: [] }))
        .then((j: { people?: SearchPerson[] }) => {
          if (reqId === mentionReqId.current) {
            setMentionResults((j.people ?? []).slice(0, 6));
            setMentionActive(0);
          }
        })
        .catch(() => {
          if (reqId === mentionReqId.current) setMentionResults([]);
        });
    }, 200);
    return () => clearTimeout(t);
  }, [mentionQuery]);

  const onBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value.slice(0, MAX);
    setBody(next);
    onNotifyTyping?.();
    const caret = e.target.selectionStart ?? next.length;
    const before = next.slice(0, caret);
    const m = /(?:^|\s)@([A-Za-z0-9_.]{0,30})$/.exec(before);
    if (m) {
      setMentionAnchor(caret - m[1]!.length - 1);
      setMentionQuery(m[1]!);
    } else {
      setMentionAnchor(null);
      setMentionQuery(null);
    }
  };

  const pickMention = (p: SearchPerson) => {
    if (mentionAnchor === null || mentionQuery === null) return;
    const before = body.slice(0, mentionAnchor);
    const after = body.slice(mentionAnchor + 1 + mentionQuery.length);
    // Only insert a separating space when `after` doesn't already start with
    // one (e.g. picking a mention with the caret back inside already-typed
    // text) — otherwise this doubles up the space.
    const sep = after.startsWith(" ") ? "" : " ";
    const next = `${before}@${p.handle}${sep}${after}`.slice(0, MAX);
    setBody(next);
    setMentionAnchor(null);
    setMentionQuery(null);
    setMentionResults([]);
    const pos = Math.min(next.length, before.length + 1 + p.handle.length + sep.length);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const canSend = (!!body.trim() || !!sticker || !!image || !!voice || !!location) && !busy && !uploading;
  const remaining = MAX - body.length;
  const moodMeta = commentMood(mood);

  // Location comment type (Part 5 tranche 4) — identical approach to
  // conversation-room.tsx's message location share: real browser
  // Geolocation, reverse-geocoded via OSM's free Nominatim API (no paid map
  // key), falling back to raw coordinates rather than blocking the share.
  const shareLocation = () => {
    if (!("geolocation" in navigator)) {
      setErr("Location isn't available on this device.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        let label: string | null = null;
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`, {
            headers: { Accept: "application/json" },
          });
          if (res.ok) {
            const data = await res.json();
            label = (data?.display_name as string | undefined)?.split(",").slice(0, 2).join(",").trim() || null;
          }
        } catch {
          /* falls back to null label */
        }
        setLocation({ lat, lng, label });
        setLocating(false);
      },
      (geoErr) => {
        setLocating(false);
        setErr(
          geoErr.code === geoErr.PERMISSION_DENIED
            ? "Location access is blocked — enable it in your browser settings."
            : "Couldn't determine your location right now.",
        );
      },
      { enableHighAccuracy: false, timeout: 10_000 },
    );
  };

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErr("Pick an image file.");
      return;
    }
    setErr(null);
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 4) || "jpg";
      const url = await uploadPostMedia({ data: file, kind: "image", ext, contentType: file.type });
      setImage(url);
    } catch {
      setErr("Couldn't upload that image.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const submit = async () => {
    if (!canSend) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/posts/${postId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: body.trim(),
          sticker: sticker?.id ?? null,
          imageUrl: image ?? null,
          mood,
          parentId: parentId ?? null,
          voiceUrl: voice?.url ?? null,
          voiceDurationMs: voice?.durationMs ?? null,
          voiceWaveform: voice?.waveform ?? null,
          quotedCommentId: quotedNode?.id ?? null,
          locationLat: location?.lat ?? null,
          locationLng: location?.lng ?? null,
          locationLabel: location?.label ?? null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? "Couldn't post.");
        return;
      }
      haptic("selection");
      onClearTyping?.();
      setBody("");
      setSticker(null);
      setImage(null);
      setMood(null);
      setVoice(null);
      setLocation(null);
      setShowStickers(false);
      clearDraft();
      onClearQuote?.();
      onDone?.();
      await onPosted();
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("mb-5", parentId && "mt-3")}>
      <AnimatePresence>
        {showStickers ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="mb-2">
            <StickerPicker onPick={(s) => { setSticker(s); setShowStickers(false); }} onClose={() => setShowStickers(false)} />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Mood chooser */}
      <AnimatePresence>
        {showMoods ? (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} className="mb-2 flex flex-wrap gap-1.5 rounded-2xl border border-border/60 bg-card/70 p-2 backdrop-blur-xl">
            {COMMENT_MOODS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => { setMood((cur) => (cur === m.id ? null : m.id)); setShowMoods(false); }}
                className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold transition", mood === m.id ? m.tint : "border-border/60 text-muted-foreground hover:text-foreground")}
              >
                {m.emoji} {m.label}
              </button>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Quote Reply preview (Part 5 tranche 4) — set from any comment's ⋯
          menu, at any depth; dismissible without discarding the draft body. */}
      {quotedNode ? (
        <div className="mb-2 flex items-start gap-2 rounded-2xl border border-border/60 bg-secondary/30 px-3 py-2">
          <Quote className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold">{quotedNode.author?.displayName ?? "Unknown"}</p>
            <p className="truncate text-xs text-muted-foreground">{quotedNode.body || "(sticker/attachment)"}</p>
          </div>
          <button type="button" onClick={onClearQuote} aria-label="Remove quote" className="shrink-0 text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {/* AI writing assist — Polish/Translate, opt-in only, never auto-runs. */}
      {showAssist ? (
        <CommentAiAssist
          text={body}
          onApply={(t) => setBody(t.slice(0, MAX))}
          onClose={() => setShowAssist(false)}
        />
      ) : null}

      {/* Attachment previews */}
      {(sticker || image || moodMeta || voice || location) && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {moodMeta ? (
            <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold", moodMeta.tint)}>
              {moodMeta.emoji} {moodMeta.label}
              <button type="button" onClick={() => setMood(null)} aria-label="Remove mood"><X className="h-3 w-3" /></button>
            </span>
          ) : null}
          {sticker ? (
            <span className="relative inline-flex items-center justify-center rounded-2xl bg-secondary/60 p-2 text-3xl ring-1 ring-inset ring-border/60">
              {sticker.glyph}
              <button type="button" onClick={() => setSticker(null)} aria-label="Remove sticker" className="absolute -right-1.5 -top-1.5 rounded-full bg-foreground/80 p-0.5 text-background"><X className="h-3 w-3" /></button>
            </span>
          ) : null}
          {image ? (
            <span className="relative inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image} alt="attachment" className="h-16 w-16 rounded-xl object-cover ring-1 ring-inset ring-border/60" />
              <button type="button" onClick={() => setImage(null)} aria-label="Remove image" className="absolute -right-1.5 -top-1.5 rounded-full bg-foreground/80 p-0.5 text-background"><X className="h-3 w-3" /></button>
            </span>
          ) : null}
          {voice ? (
            <span className="relative block w-full max-w-xs">
              <VoiceMessage url={voice.url} durationMs={voice.durationMs} waveform={voice.waveform} />
              <button type="button" onClick={() => setVoice(null)} aria-label="Remove voice note" className="absolute -right-1.5 -top-1.5 rounded-full bg-foreground/80 p-0.5 text-background"><X className="h-3 w-3" /></button>
            </span>
          ) : null}
          {location ? (
            <span className="relative inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-secondary/50 px-3 py-1.5 text-xs font-semibold">
              <MapPin className="h-3.5 w-3.5 text-rose-500" />
              {location.label ?? `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`}
              <button type="button" onClick={() => setLocation(null)} aria-label="Remove location" className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
            </span>
          ) : null}
        </div>
      )}

      {showVoiceRecorder ? (
        <VoiceRecorder
          onRecorded={(r) => { setVoice(r); setShowVoiceRecorder(false); }}
          onCancel={() => setShowVoiceRecorder(false)}
        />
      ) : (
      <div className="group flex items-center gap-1 rounded-3xl border border-border/60 bg-card/70 p-2 shadow-soft backdrop-blur-xl transition focus-within:border-primary/50 focus-within:shadow-[0_0_0_3px_rgba(99,102,241,0.15),0_8px_30px_-12px_rgba(124,58,237,0.5)]">
        {/*
          🔴 `items-center` above, not `items-end` (owner: "arrange this
          comment placeholder in to align in a straight line with the other
          icons"). Both the icon buttons and the textarea land on the same
          36px height in the common single-line state (`p-2` + `h-5 w-5` =
          36px; the textarea's own `min-h-[36px]`), so bottom-alignment and
          center-alignment SHOULD coincide exactly — but a textarea's
          internal line-height/font metrics position its placeholder text
          slightly differently than an icon centered in equal padding, which
          is what read as "not lining up". Centering on a shared axis is
          forgiving of that sub-pixel mismatch in a way bottom-alignment
          isn't; it also degrades reasonably once the textarea grows past
          one line, same as before.
        */}
        <button type="button" onClick={() => setShowStickers((s) => !s)} aria-label="Stickers" className={cn("shrink-0 rounded-full p-2 transition hover:bg-secondary", showStickers ? "text-primary" : "text-muted-foreground")}>
          <Smile className="h-5 w-5" />
        </button>
        <button type="button" onClick={() => fileRef.current?.click()} aria-label="Add a picture" disabled={uploading} className="shrink-0 rounded-full p-2 text-muted-foreground transition hover:bg-secondary disabled:opacity-60">
          {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
        </button>
        <button type="button" onClick={() => setShowMoods((s) => !s)} aria-label="Tag a mood" className={cn("shrink-0 rounded-full p-2 transition hover:bg-secondary", mood ? "text-primary" : "text-muted-foreground")}>
          <Sparkles className="h-5 w-5" />
        </button>
        {body.trim() ? (
          <button type="button" onClick={() => setShowAssist((s) => !s)} aria-label="AI writing assist" className={cn("shrink-0 rounded-full p-2 transition hover:bg-secondary", showAssist ? "text-primary" : "text-muted-foreground")}>
            <Wand2 className="h-5 w-5" />
          </button>
        ) : null}
        {!location ? (
          <button type="button" onClick={shareLocation} disabled={locating} aria-label="Share location" className="shrink-0 rounded-full p-2 text-muted-foreground transition hover:bg-secondary disabled:opacity-60">
            {locating ? <Loader2 className="h-5 w-5 animate-spin" /> : <MapPin className="h-5 w-5" />}
          </button>
        ) : null}
        {canRecord && !voice ? (
          <button type="button" onClick={() => setShowVoiceRecorder(true)} aria-label="Record a voice note" className="shrink-0 rounded-full p-2 text-muted-foreground transition hover:bg-secondary">
            <Mic className="h-5 w-5" />
          </button>
        ) : null}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickImage(e.target.files?.[0])} />
        <div className="relative min-w-0 flex-1">
          <textarea
            ref={textareaRef}
            value={body}
            onChange={onBodyChange}
            onKeyDown={(e) => {
              if (mentionQuery !== null && mentionResults.length > 0) {
                if (e.key === "ArrowDown") { e.preventDefault(); setMentionActive((i) => Math.min(mentionResults.length - 1, i + 1)); return; }
                if (e.key === "ArrowUp") { e.preventDefault(); setMentionActive((i) => Math.max(0, i - 1)); return; }
                if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickMention(mentionResults[mentionActive]!); return; }
                if (e.key === "Escape") { setMentionAnchor(null); setMentionQuery(null); return; }
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
            }}
            rows={1}
            autoFocus={autoFocus}
            placeholder={parentId ? "Reply…" : "Add a comment…"}
            className="max-h-32 min-h-[36px] w-full resize-none bg-transparent py-1.5 text-sm outline-none placeholder:text-[13px] sm:placeholder:text-sm"
          />
          {/* @mention autocomplete */}
          <AnimatePresence>
            {mentionQuery !== null && mentionResults.length > 0 ? (
              <motion.ul
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                // inset-x-0 (not a fixed w-64) — sized to this wrapper's own
                // available width, which by construction never overflows the
                // composer (the wrapper is flex-1/min-w-0). The old fixed
                // width, anchored left-0 after several icon buttons, could
                // extend well past a narrow phone's viewport.
                className="absolute inset-x-0 bottom-full z-30 mb-2 max-w-sm overflow-hidden rounded-2xl border border-border/60 bg-card/95 py-1 shadow-elevated backdrop-blur-xl"
              >
                {mentionResults.map((p, i) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); pickMention(p); }}
                      className={cn("flex w-full items-center gap-2.5 px-3 py-2 text-left transition", i === mentionActive ? "bg-secondary" : "hover:bg-secondary/60")}
                    >
                      {p.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.avatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-xs font-bold text-white">{p.displayName.charAt(0).toUpperCase()}</span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{p.displayName}</span>
                        <span className="block truncate text-xs text-muted-foreground">@{p.handle}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </motion.ul>
            ) : null}
          </AnimatePresence>
        </div>
        {remaining <= 120 ? <span className={cn("shrink-0 self-center pr-1 text-[11px] font-semibold tabular-nums", remaining <= 0 ? "text-rose-500" : "text-muted-foreground")}>{remaining}</span> : null}
        <motion.button type="button" onClick={submit} disabled={!canSend} whileTap={{ scale: 0.88 }} aria-label={parentId ? "Reply" : "Comment"} className="shrink-0 rounded-full bg-gradient-to-r from-blue-600 to-violet-600 p-2 text-white shadow-md shadow-violet-500/30 transition hover:opacity-95 disabled:opacity-40 disabled:shadow-none">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
        </motion.button>
      </div>
      )}
      <div className="mt-1.5 flex items-center gap-3 pl-1">
        {onDone ? <button type="button" onClick={() => { clearDraft(); onDone(); }} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button> : null}
        {err ? <span className="text-xs text-red-400">{err}</span> : null}
      </div>
    </div>
  );
}

function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    // overflowY only — the `overflow` shorthand also resets overflow-x, undoing
    // the `overflow-x: clip` on <body> that keeps the app sidebar sticky.
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflowY = prev;
    };
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label="Image" onClick={onClose} className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm">
      <button type="button" onClick={onClose} aria-label="Close" className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"><X className="h-5 w-5" /></button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" onClick={(e) => e.stopPropagation()} className="max-h-[90vh] max-w-full rounded-xl object-contain shadow-2xl" />
    </div>
  );
}

/** Who-reacted glass card. */
function ReactionInsights({ commentId, onClose }: { commentId: string; onClose: () => void }) {
  const [reactors, setReactors] = useState<{ emoji: string; handle: string; displayName: string; avatarUrl: string | null }[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/comments/${commentId}/reactions`)
      .then((r) => (r.ok ? r.json() : { reactors: [] }))
      .then((j) => alive && setReactors(j.reactors ?? []))
      .catch(() => alive && setReactors([]));
    return () => { alive = false; };
  }, [commentId]);

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center sm:items-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="relative m-3 max-h-[70vh] w-full max-w-sm overflow-y-auto rounded-3xl border border-border/60 bg-card/95 p-4 shadow-elevated backdrop-blur-xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold">Reactions</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1 text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button>
        </div>
        {reactors === null ? (
          <div className="flex justify-center py-6 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : reactors.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No reactions yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {reactors.map((r, i) => (
              <li key={i} className="flex items-center gap-3">
                <Link href={`/u/${r.handle}`} onClick={onClose} className="shrink-0">
                  {r.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-sm font-bold text-white">{r.displayName.charAt(0).toUpperCase()}</span>
                  )}
                </Link>
                <Link href={`/u/${r.handle}`} onClick={onClose} className="min-w-0 flex-1 truncate text-sm font-semibold hover:underline">{r.displayName}</Link>
                <span className="text-lg">{r.emoji}</span>
              </li>
            ))}
          </ul>
        )}
      </motion.div>
    </div>
  );
}

function ReactionBar({ node, loggedIn, onReact }: { node: CommentNode; loggedIn: boolean; onReact: (id: string, emoji: string) => void }) {
  const [picker, setPicker] = useState(false);
  const [insights, setInsights] = useState(false);
  const top = node.reactions.slice(0, 3);

  return (
    <div className="relative flex items-center gap-2">
      {/* React trigger */}
      <button
        type="button"
        onClick={() => (loggedIn ? setPicker((v) => !v) : undefined)}
        aria-label="React"
        className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-semibold transition", node.viewerReaction ? "text-rose-500" : "text-muted-foreground hover:text-foreground")}
      >
        {node.viewerReaction ? <span className="text-base leading-none">{node.viewerReaction}</span> : <SmilePlus className="h-4 w-4" />}
        {!node.viewerReaction ? "React" : null}
      </button>

      {/* Reaction summary → insights */}
      {node.likesCount > 0 ? (
        <button type="button" onClick={() => setInsights(true)} className="inline-flex items-center gap-1 rounded-full bg-secondary/50 px-2 py-0.5 text-xs font-semibold text-foreground transition hover:bg-secondary" aria-label="See who reacted">
          <span className="flex -space-x-1">{top.map((r) => <span key={r.emoji} className="text-sm leading-none">{r.emoji}</span>)}</span>
          {formatCompactNumber(node.likesCount)}
        </button>
      ) : null}

      {/* Quick-reaction picker */}
      <AnimatePresence>
        {picker ? (
          <>
            <button type="button" aria-label="Close" onClick={() => setPicker(false)} className="fixed inset-0 z-40 cursor-default" />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.12 }}
              className="absolute bottom-7 left-0 z-50 flex items-center gap-0.5 rounded-full border border-border/60 bg-card/95 px-1.5 py-1 shadow-elevated backdrop-blur-xl"
            >
              {COMMENT_REACTIONS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={(ev) => { if (node.viewerReaction !== e) floatReaction(ev.clientX, ev.clientY, e); onReact(node.id, e); setPicker(false); }}
                  className={cn("rounded-full p-1 text-xl transition hover:scale-125 hover:bg-secondary", node.viewerReaction === e && "bg-secondary")}
                >
                  {e}
                </button>
              ))}
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>

      {insights ? <ReactionInsights commentId={node.id} onClose={() => setInsights(false)} /> : null}
    </div>
  );
}

/** Beyond this depth, replies keep nesting logically but stop adding visual
 *  indent — an unbounded "Unlimited Replies" thread otherwise runs its
 *  content off the left edge of a phone by depth 6-7. */
const MAX_VISUAL_DEPTH = 4;

function jumpToComment(id: string) {
  const el = document.getElementById(`comment-${id}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("ring-2", "ring-primary/50");
  setTimeout(() => el.classList.remove("ring-2", "ring-primary/50"), 1200);
}

function CommentItemImpl({
  node,
  postId,
  depth,
  parent,
  chained,
  canReply,
  loggedIn,
  onPosted,
  onReact,
  onModerate,
  onQuote,
}: {
  node: CommentNode;
  postId: string;
  depth: number;
  /** The comment this one directly replies to — powers "Jump to parent"
   *  (Nested Conversations §: "Jump to Parent"). Undefined at depth 0. */
  parent?: CommentNode;
  /** Conversation Flow™: this reply immediately follows another reply from
   *  the SAME author in the SAME thread — chain them (no repeated avatar/
   *  name, tighter spacing) rather than fabricating an "AI-clustered"
   *  grouping. Real, honest signal: consecutive same-author follow-ups. */
  chained?: boolean;
  canReply: boolean;
  loggedIn: boolean;
  onPosted: () => void | Promise<void>;
  onReact: (id: string, emoji: string) => void;
  onModerate: (id: string, action: "pin" | "best", on: boolean, label?: string | null) => void;
  /** Quote Reply — lifts to the top-level composer regardless of depth. */
  onQuote: (node: CommentNode) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pinPickerOpen, setPinPickerOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReady, setReportReady] = useState(false);
  const [showReplies, setShowReplies] = useState(depth > 0);
  const [flash, setFlash] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(node.body);
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);

  const flashNote = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash((f) => (f === msg ? null : f)), 1600);
  };

  const del = async () => {
    setMenuOpen(false);
    if (!confirm("Delete this comment?")) return;
    try {
      const res = await fetch(`/api/comments/${node.id}`, { method: "DELETE" });
      if (res.ok) await onPosted();
    } catch {
      /* ignore */
    }
  };
  const startEdit = () => {
    setMenuOpen(false);
    setEditBody(node.body);
    setEditErr(null);
    setEditing(true);
  };
  const saveEdit = async () => {
    const body = editBody.trim();
    if (!body || body === node.body) {
      setEditing(false);
      return;
    }
    setEditBusy(true);
    setEditErr(null);
    try {
      const res = await fetch(`/api/comments/${node.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setEditErr(j?.error ?? "Couldn't save.");
        return;
      }
      setEditing(false);
      await onPosted();
    } catch {
      setEditErr("Network error.");
    } finally {
      setEditBusy(false);
    }
  };
  const copyText = async () => {
    setMenuOpen(false);
    try { await navigator.clipboard.writeText(node.body || stickerGlyph(node.sticker) || ""); flashNote("Copied"); } catch { /* ignore */ }
  };
  const copyLink = async () => {
    setMenuOpen(false);
    try { await navigator.clipboard.writeText(`${window.location.origin}/p/${postId}#comments`); flashNote("Link copied"); } catch { /* ignore */ }
  };
  const openReport = () => {
    setMenuOpen(false);
    setReportReady(true);
    setReportOpen(true);
  };
  const muteAuthor = async () => {
    setMenuOpen(false);
    try {
      const res = await fetch(`/api/comments/${node.id}/mute-author`, { method: "POST" });
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        toast(j?.error ?? "Couldn't mute.", "error");
        return;
      }
      toast("Muted — they can't comment on your posts anymore. Manage this in Privacy settings.", "success");
    } catch {
      toast("Network error.", "error");
    }
  };

  const a = node.author;
  const glyph = stickerGlyph(node.sticker);
  const mood = commentMood(node.mood);
  const pinnedLabelMeta = pinLabel(node.pinLabel);
  const avatarSize = depth === 0 ? "h-10 w-10" : "h-8 w-8";

  return (
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ duration: 0.2 }}
      className={cn("flex gap-3", chained && "-mt-2")}
    >
      {/* Conversation Flow™ — a chained follow-up skips the repeated avatar
          (an empty spacer keeps the bubble aligned under the previous one). */}
      {chained ? (
        <span className={cn(avatarSize, "shrink-0")} />
      ) : a ? (
        <Link href={`/u/${a.handle}`} className="shrink-0">
          {a.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.avatarUrl} alt="" className={cn(avatarSize, "rounded-full object-cover ring-2 ring-border/50")} />
          ) : (
            <span className={cn(avatarSize, "flex items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-sm font-bold text-white")}>{a.displayName.charAt(0).toUpperCase()}</span>
          )}
        </Link>
      ) : (
        <span className={cn(avatarSize, "shrink-0 rounded-full bg-secondary")} />
      )}

      <div className="min-w-0 flex-1">
        {/* Badges above the bubble */}
        {(node.pinned || node.isBest) && (
          <div className="mb-1 flex items-center gap-2 pl-1">
            {node.pinned ? (
              <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold", pinnedLabelMeta?.tint ?? "text-violet-500 border-violet-500/30 bg-violet-500/10")}>
                {pinnedLabelMeta ? pinnedLabelMeta.emoji : <Pin className="h-3 w-3 fill-current" />} {pinnedLabelMeta?.label ?? "Pinned"}
              </span>
            ) : null}
            {node.isBest ? <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm"><Award className="h-3 w-3" /> Best answer</span> : null}
          </div>
        )}

        {/* Jump to parent — only meaningful once a thread nests past depth 1,
            since a depth-1 reply's parent is always the visible top-level
            comment right above it. */}
        {depth > 1 && parent ? (
          <button
            type="button"
            onClick={() => jumpToComment(parent.id)}
            className="mb-1 inline-flex items-center gap-1 pl-1 text-[11px] font-semibold text-muted-foreground transition hover:text-primary"
          >
            <CornerUpLeft className="h-3 w-3" /> Replying to {parent.author?.displayName ?? "Unknown"}
          </button>
        ) : null}

        {/* Glass bubble — highlighted for best answer; a faint accent for a
            friend's comment (Friend Highlights™ — subtle, never a loud badge,
            per the brief's "without overwhelming the interface"). */}
        <div
          id={`comment-${node.id}`}
          className={cn(
            "rounded-3xl rounded-tl-lg border px-3.5 py-2.5 shadow-soft backdrop-blur-sm transition",
            node.isBest
              ? "border-emerald-500/40 bg-emerald-500/[0.06] ring-1 ring-emerald-500/20"
              : a?.isFriend
                ? "border-blue-500/25 bg-blue-500/[0.04] hover:border-blue-500/40"
                : "border-border/50 bg-card/60 hover:border-border",
          )}
        >
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            {/* Conversation Flow™ — a chained follow-up skips the repeated
                name/verified/plan/friend badges; only the newer signals
                (mood, timestamp, edited, menu) still change reply to reply. */}
            {!chained ? (
              <>
                {a ? <Link href={`/u/${a.handle}`} className="max-w-[55vw] truncate font-semibold hover:underline">{a.displayName}</Link> : <span className="font-semibold text-muted-foreground">Unknown</span>}
                {a?.isVerified ? <VerifiedTick className="h-3.5 w-3.5" /> : null}
                {a ? <DiamondCrownBadge plan={a.plan} size="xs" /> : null}
                {a?.isFriend ? <Users className="h-3 w-3 shrink-0 text-blue-500" aria-label="Friend" /> : null}
              </>
            ) : null}
            {mood ? <span className={cn("inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0 text-[10px] font-bold", mood.tint)}>{mood.emoji} {mood.label}</span> : null}
            <span className="text-xs text-muted-foreground">
              · {timeAgo(node.createdAt)}
              {node.editedAt ? " · Edited" : ""}
            </span>

            <div className="relative ml-auto">
              <button type="button" onClick={() => setMenuOpen((v) => !v)} aria-label="Comment actions" className="-mr-1 rounded-full p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"><MoreHorizontal className="h-4 w-4" /></button>
              <AnimatePresence>
                {menuOpen ? (
                  <>
                    <button type="button" aria-label="Close" onClick={() => setMenuOpen(false)} className="fixed inset-0 z-40 cursor-default" />
                    <motion.div initial={{ opacity: 0, scale: 0.95, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.12 }} className="absolute right-0 z-50 mt-1 w-48 overflow-hidden rounded-2xl border border-border/60 bg-card/95 py-1 shadow-elevated backdrop-blur-xl">
                      {node.canModerate ? (
                        <>
                          <MenuRow
                            icon={Pin}
                            label={node.pinned ? "Unpin" : "Pin comment"}
                            onClick={() => {
                              if (node.pinned) {
                                setMenuOpen(false);
                                onModerate(node.id, "pin", false);
                              } else {
                                setMenuOpen(false);
                                setPinPickerOpen(true);
                              }
                            }}
                          />
                          <MenuRow icon={Award} label={node.isBest ? "Remove best answer" : "Mark best answer"} onClick={() => { setMenuOpen(false); onModerate(node.id, "best", !node.isBest); }} />
                          {!node.canEdit ? <MenuRow icon={VolumeX} label="Mute this person" onClick={muteAuthor} /> : null}
                        </>
                      ) : null}
                      {node.canEdit ? <MenuRow icon={Pencil} label="Edit" onClick={startEdit} /> : null}
                      {loggedIn ? <MenuRow icon={Quote} label="Quote" onClick={() => { setMenuOpen(false); onQuote(node); }} /> : null}
                      <MenuRow icon={Copy} label="Copy text" onClick={copyText} />
                      <MenuRow icon={Link2} label="Copy link" onClick={copyLink} />
                      {loggedIn && !node.canDelete ? <MenuRow icon={Flag} label="Report" danger onClick={openReport} /> : null}
                      {node.canDelete ? <MenuRow icon={Trash2} label="Delete" danger onClick={del} /> : null}
                    </motion.div>
                  </>
                ) : null}
              </AnimatePresence>

              {/* Pin category flyout — the brief's Important/Announcement/FAQ/
                  Update/Winner/Guideline categories, capped at MAX_PINNED so a
                  thread's top can't become entirely pins. Code-split (see the
                  dynamic import above): post-owner-only, rarely opened. */}
              {pinPickerOpen ? (
                <>
                  <button type="button" aria-label="Close" onClick={() => setPinPickerOpen(false)} className="fixed inset-0 z-40 cursor-default" />
                  <PinLabelPicker onPick={(label) => { setPinPickerOpen(false); onModerate(node.id, "pin", true, label); }} />
                </>
              ) : null}
            </div>
          </div>

          {editing ? (
            <div className="mt-1.5">
              <textarea
                value={editBody}
                onChange={(e) => setEditBody(e.target.value.slice(0, MAX))}
                autoFocus
                rows={1}
                className="max-h-32 min-h-[36px] w-full resize-none rounded-2xl border border-border/60 bg-secondary/30 px-3 py-2 text-sm outline-none focus:border-primary/50"
              />
              <div className="mt-1 flex items-center gap-3">
                <button type="button" disabled={editBusy || !editBody.trim()} onClick={saveEdit} className="rounded-full bg-gradient-to-r from-blue-600 to-violet-600 px-3 py-1 text-xs font-semibold text-white transition disabled:opacity-40">
                  {editBusy ? "Saving…" : "Save"}
                </button>
                <button type="button" onClick={() => setEditing(false)} className="text-xs font-semibold text-muted-foreground hover:text-foreground">Cancel</button>
                {editErr ? <span className="text-xs text-red-400">{editErr}</span> : null}
              </div>
            </div>
          ) : (
            <>
              {node.quotedComment ? (
                <button
                  type="button"
                  onClick={() => jumpToComment(node.quotedComment!.id)}
                  className="mt-1 flex w-full items-start gap-1.5 rounded-xl border border-border/50 bg-secondary/30 px-2.5 py-1.5 text-left transition hover:border-border"
                >
                  <Quote className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold">{node.quotedComment.author?.displayName ?? "Unknown"}</span>
                    <span className="block truncate text-xs text-muted-foreground">{node.quotedComment.bodySnippet || "(sticker/attachment)"}</span>
                  </span>
                </button>
              ) : null}
              {glyph ? <p className="mt-1 text-5xl leading-tight">{glyph}</p> : null}
              {node.body ? <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed"><RichText text={node.body} /></p> : null}
            </>
          )}
          {node.imageUrl ? (
            <>
              <button type="button" onClick={() => setZoom(true)} className="mt-2 block w-fit" aria-label="Open image">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={node.imageUrl} alt="attachment" loading="lazy" className="max-h-64 max-w-full cursor-zoom-in rounded-2xl border border-border/60 object-cover transition hover:opacity-95" />
              </button>
              {zoom ? <ImageLightbox src={node.imageUrl} onClose={() => setZoom(false)} /> : null}
            </>
          ) : null}
          {node.voiceUrl ? <VoiceMessage url={node.voiceUrl} durationMs={node.voiceDurationMs} waveform={node.voiceWaveform} /> : null}
          {node.videoUrl ? <VideoComment url={node.videoUrl} thumbnailUrl={node.videoThumbnailUrl} durationMs={node.videoDurationMs} /> : null}
          {node.location ? (
            <a
              href={`https://www.openstreetmap.org/?mlat=${node.location.lat}&mlon=${node.location.lng}#map=16/${node.location.lat}/${node.location.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-secondary/40 px-2.5 py-1.5 text-xs font-semibold text-foreground transition hover:bg-secondary"
            >
              <MapPin className="h-3.5 w-3.5 text-rose-500" />
              {node.location.label ?? `${node.location.lat.toFixed(4)}, ${node.location.lng.toFixed(4)}`}
            </a>
          ) : null}
        </div>

        {/* Reaction bar */}
        <div className="mt-1 flex items-center gap-3 pl-1 text-xs">
          <ReactionBar node={node} loggedIn={loggedIn} onReact={onReact} />
          {canReply ? <button type="button" onClick={() => setReplying((r) => !r)} className="font-semibold text-muted-foreground transition hover:text-foreground">Reply</button> : null}
          {flash ? <span className="font-semibold text-primary">{flash}</span> : null}
        </div>

        <AnimatePresence>
          {replying ? (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <Composer postId={postId} parentId={node.id} autoFocus onPosted={onPosted} onDone={() => setReplying(false)} />
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* Threaded replies — collapsible at EVERY depth (not just top-level),
            since threads now nest arbitrarily deep instead of flattening at
            depth 1. Visual indent stops growing past MAX_VISUAL_DEPTH so a
            genuinely long thread never runs its content off a phone's left
            edge — it keeps nesting logically, just not visually. */}
        {node.replies.length > 0 ? (
          <div className="mt-2">
            <button type="button" onClick={() => setShowReplies((v) => !v)} className="mb-2 inline-flex items-center gap-1.5 pl-1 text-xs font-semibold text-primary transition hover:opacity-80">
              <span className="h-px w-5 bg-gradient-to-r from-blue-500/60 to-violet-500/60" />
              {showReplies ? "Hide replies" : `View ${node.replies.length} ${node.replies.length === 1 ? "reply" : "replies"}`}
            </button>
            <AnimatePresence initial={false}>
              {showReplies ? (
                <motion.ul
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className={cn("space-y-3 overflow-hidden", depth < MAX_VISUAL_DEPTH ? "border-l-2 border-border/50 pl-3" : "pl-0")}
                >
                  {node.replies.map((r, i) => (
                    <CommentItem
                      key={r.id}
                      node={r}
                      postId={postId}
                      depth={depth + 1}
                      parent={node}
                      chained={i > 0 && !!r.author && r.author.id === node.replies[i - 1]!.author?.id}
                      canReply={canReply}
                      loggedIn={loggedIn}
                      onPosted={onPosted}
                      onReact={onReact}
                      onModerate={onModerate}
                      onQuote={onQuote}
                    />
                  ))}
                </motion.ul>
              ) : null}
            </AnimatePresence>
          </div>
        ) : null}
      </div>

      {reportReady ? <ReportSheet targetType="comment" targetId={node.id} open={reportOpen} onClose={() => setReportOpen(false)} /> : null}
    </motion.li>
  );
}

// A long thread re-renders every visible row on any single reaction/pin/best
// toggle without this — onReact/onModerate/onPosted are already stable
// (useCallback above), so this memo actually holds.
const CommentItem = memo(CommentItemImpl);

function MenuRow({ icon: Icon, label, onClick, danger }: { icon: typeof Copy; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition hover:bg-secondary", danger ? "text-rose-500" : "text-foreground")}>
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}
