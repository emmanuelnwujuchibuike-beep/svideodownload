"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  BadgeCheck,
  Award,
  Copy,
  Flag,
  ImagePlus,
  Link2,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Pin,
  Send,
  Smile,
  SmilePlus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DiamondCrownBadge } from "@/components/badges/diamond-crown-badge";
import { RichText } from "@/components/social/rich-text";
import { StickerPicker } from "@/features/social/sticker-picker";
import { uploadPostMedia } from "@/lib/storage/client-upload";
import { COMMENT_MOODS, COMMENT_REACTIONS, commentMood } from "@/lib/social/comment-meta";
import type { CommentNode } from "@/lib/social/engagement";
import { stickerGlyph, type Sticker } from "@/lib/social/stickers";
import { cn, formatCompactNumber } from "@/lib/utils";

type SortMode = "smart" | "top" | "new";
const SORTS: { id: SortMode; label: string }[] = [
  { id: "smart", label: "Smart" },
  { id: "top", label: "Top" },
  { id: "new", label: "Newest" },
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
  const sheet = variant === "sheet";

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
    async (id: string, action: "pin" | "best", on: boolean) => {
      setNodes((ns) => patchNode(ns, id, (n) => ({ ...n, [action === "pin" ? "pinned" : "isBest"]: on })));
      try {
        const res = await fetch(`/api/comments/${id}/${action}`, { method: on ? "POST" : "DELETE" });
        if (!res.ok) throw new Error();
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
      sort === "smart"
        ? (a: CommentNode, b: CommentNode) => smartScore(b) - smartScore(a)
        : sort === "top"
          ? (a: CommentNode, b: CommentNode) => b.likesCount - a.likesCount || +new Date(b.createdAt) - +new Date(a.createdAt)
          : (a: CommentNode, b: CommentNode) => +new Date(b.createdAt) - +new Date(a.createdAt);
    // Pinned first, then best answer, then the chosen sort.
    arr.sort((a, b) => Number(b.pinned) - Number(a.pinned) || Number(b.isBest) - Number(a.isBest) || base(a, b));
    return arr;
  }, [nodes, sort]);

  return (
    <section id="comments" className={cn(!sheet && "mt-10 scroll-mt-24")}>
      <div className={cn("flex items-center justify-between gap-3", sheet ? "mb-3" : "mb-4")}>
        {sheet ? (
          <span />
        ) : (
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-[-0.02em]">
            <MessageCircle className="h-5 w-5 text-foreground" />
            Comments {total > 0 ? <span className="text-muted-foreground">· {formatCompactNumber(total)}</span> : null}
          </h2>
        )}
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

      {!loggedIn ? (
        <Link href="/login" className="mb-5 inline-block rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-violet-500/25">
          Sign in to join the conversation
        </Link>
      ) : canComment ? (
        <Composer postId={postId} onPosted={refresh} />
      ) : (
        <p className="mb-5 rounded-2xl border border-border/60 bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
          {disabledReason ?? "Comments are unavailable."}
        </p>
      )}

      {sorted.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border/60 bg-card/40 py-10 text-center">
          <span className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
            <MessageCircle className="h-5 w-5" />
          </span>
          <p className="text-sm text-muted-foreground">No comments yet — start the conversation ✨</p>
        </div>
      ) : (
        <ul className="space-y-4">
          <AnimatePresence initial={false}>
            {sorted.map((c) => (
              <CommentItem key={c.id} node={c} postId={postId} depth={0} canReply={loggedIn && canComment} loggedIn={loggedIn} onPosted={refresh} onReact={react} onModerate={moderate} />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}

function Composer({
  postId,
  parentId,
  onPosted,
  onDone,
  autoFocus,
}: {
  postId: string;
  parentId?: string;
  onPosted: () => void | Promise<void>;
  onDone?: () => void;
  autoFocus?: boolean;
}) {
  const [body, setBody] = useState("");
  const [sticker, setSticker] = useState<Sticker | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [mood, setMood] = useState<string | null>(null);
  const [showMoods, setShowMoods] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showStickers, setShowStickers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const canSend = (!!body.trim() || !!sticker || !!image) && !busy && !uploading;
  const remaining = MAX - body.length;
  const moodMeta = commentMood(mood);

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
        body: JSON.stringify({ body: body.trim(), sticker: sticker?.id ?? null, imageUrl: image ?? null, mood, parentId: parentId ?? null }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? "Couldn't post.");
        return;
      }
      setBody("");
      setSticker(null);
      setImage(null);
      setMood(null);
      setShowStickers(false);
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

      {/* Attachment previews */}
      {(sticker || image || moodMeta) && (
        <div className="mb-2 flex items-center gap-2">
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
        </div>
      )}

      <div className="group flex items-end gap-1 rounded-3xl border border-border/60 bg-card/70 p-2 shadow-soft backdrop-blur-xl transition focus-within:border-primary/50 focus-within:shadow-[0_0_0_3px_rgba(99,102,241,0.15),0_8px_30px_-12px_rgba(124,58,237,0.5)]">
        <button type="button" onClick={() => setShowStickers((s) => !s)} aria-label="Stickers" className={cn("shrink-0 rounded-full p-2 transition hover:bg-secondary", showStickers ? "text-primary" : "text-muted-foreground")}>
          <Smile className="h-5 w-5" />
        </button>
        <button type="button" onClick={() => fileRef.current?.click()} aria-label="Add a picture" disabled={uploading} className="shrink-0 rounded-full p-2 text-muted-foreground transition hover:bg-secondary disabled:opacity-60">
          {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
        </button>
        <button type="button" onClick={() => setShowMoods((s) => !s)} aria-label="Tag a mood" className={cn("shrink-0 rounded-full p-2 transition hover:bg-secondary", mood ? "text-primary" : "text-muted-foreground")}>
          <Sparkles className="h-5 w-5" />
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickImage(e.target.files?.[0])} />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, MAX))}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(); }}
          rows={1}
          autoFocus={autoFocus}
          placeholder={parentId ? "Write a reply…" : "Add to the conversation…"}
          className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent py-1.5 text-sm outline-none"
        />
        {remaining <= 120 ? <span className={cn("shrink-0 self-center pr-1 text-[11px] font-semibold tabular-nums", remaining <= 0 ? "text-rose-500" : "text-muted-foreground")}>{remaining}</span> : null}
        <motion.button type="button" onClick={submit} disabled={!canSend} whileTap={{ scale: 0.88 }} aria-label={parentId ? "Reply" : "Comment"} className="shrink-0 rounded-full bg-gradient-to-r from-blue-600 to-violet-600 p-2 text-white shadow-md shadow-violet-500/30 transition hover:opacity-95 disabled:opacity-40 disabled:shadow-none">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
        </motion.button>
      </div>
      <div className="mt-1.5 flex items-center gap-3 pl-1">
        {onDone ? <button type="button" onClick={onDone} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button> : null}
        {err ? <span className="text-xs text-red-400">{err}</span> : null}
      </div>
    </div>
  );
}

function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
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
                  onClick={() => { onReact(node.id, e); setPicker(false); }}
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

function CommentItem({
  node,
  postId,
  depth,
  canReply,
  loggedIn,
  onPosted,
  onReact,
  onModerate,
}: {
  node: CommentNode;
  postId: string;
  depth: number;
  canReply: boolean;
  loggedIn: boolean;
  onPosted: () => void | Promise<void>;
  onReact: (id: string, emoji: string) => void;
  onModerate: (id: string, action: "pin" | "best", on: boolean) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showReplies, setShowReplies] = useState(depth > 0);
  const [flash, setFlash] = useState<string | null>(null);

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
  const copyText = async () => {
    setMenuOpen(false);
    try { await navigator.clipboard.writeText(node.body || stickerGlyph(node.sticker) || ""); flashNote("Copied"); } catch { /* ignore */ }
  };
  const copyLink = async () => {
    setMenuOpen(false);
    try { await navigator.clipboard.writeText(`${window.location.origin}/p/${postId}#comments`); flashNote("Link copied"); } catch { /* ignore */ }
  };
  const report = async () => {
    setMenuOpen(false);
    try { await fetch("/api/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetType: "comment", targetId: node.id, reason: "inappropriate" }) }); } catch { /* ignore */ }
    flashNote("Reported — thank you");
  };

  const a = node.author;
  const glyph = stickerGlyph(node.sticker);
  const mood = commentMood(node.mood);
  const avatarSize = depth === 0 ? "h-10 w-10" : "h-8 w-8";

  return (
    <motion.li initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.2 }} className="flex gap-3">
      {a ? (
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
            {node.pinned ? <span className="inline-flex items-center gap-1 text-[11px] font-bold text-violet-500"><Pin className="h-3 w-3 fill-current" /> Pinned</span> : null}
            {node.isBest ? <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm"><Award className="h-3 w-3" /> Best answer</span> : null}
          </div>
        )}

        {/* Glass bubble — highlighted for best answer */}
        <div className={cn("rounded-3xl rounded-tl-lg border px-3.5 py-2.5 shadow-soft backdrop-blur-sm transition", node.isBest ? "border-emerald-500/40 bg-emerald-500/[0.06] ring-1 ring-emerald-500/20" : "border-border/50 bg-card/60 hover:border-border")}>
          <div className="flex items-center gap-1.5 text-sm">
            {a ? <Link href={`/u/${a.handle}`} className="font-semibold hover:underline">{a.displayName}</Link> : <span className="font-semibold text-muted-foreground">Unknown</span>}
            {a?.isVerified ? <BadgeCheck className="h-3.5 w-3.5 text-primary" /> : null}
            {a ? <DiamondCrownBadge plan={a.plan} size="xs" /> : null}
            {mood ? <span className={cn("inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0 text-[10px] font-bold", mood.tint)}>{mood.emoji} {mood.label}</span> : null}
            <span className="text-xs text-muted-foreground">· {timeAgo(node.createdAt)}</span>

            <div className="relative ml-auto">
              <button type="button" onClick={() => setMenuOpen((v) => !v)} aria-label="Comment actions" className="-mr-1 rounded-full p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"><MoreHorizontal className="h-4 w-4" /></button>
              <AnimatePresence>
                {menuOpen ? (
                  <>
                    <button type="button" aria-label="Close" onClick={() => setMenuOpen(false)} className="fixed inset-0 z-40 cursor-default" />
                    <motion.div initial={{ opacity: 0, scale: 0.95, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.12 }} className="absolute right-0 z-50 mt-1 w-48 overflow-hidden rounded-2xl border border-border/60 bg-card/95 py-1 shadow-elevated backdrop-blur-xl">
                      {node.canModerate ? (
                        <>
                          <MenuRow icon={Pin} label={node.pinned ? "Unpin" : "Pin comment"} onClick={() => { setMenuOpen(false); onModerate(node.id, "pin", !node.pinned); }} />
                          <MenuRow icon={Award} label={node.isBest ? "Remove best answer" : "Mark best answer"} onClick={() => { setMenuOpen(false); onModerate(node.id, "best", !node.isBest); }} />
                        </>
                      ) : null}
                      <MenuRow icon={Copy} label="Copy text" onClick={copyText} />
                      <MenuRow icon={Link2} label="Copy link" onClick={copyLink} />
                      {loggedIn && !node.canDelete ? <MenuRow icon={Flag} label="Report" danger onClick={report} /> : null}
                      {node.canDelete ? <MenuRow icon={Trash2} label="Delete" danger onClick={del} /> : null}
                    </motion.div>
                  </>
                ) : null}
              </AnimatePresence>
            </div>
          </div>

          {glyph ? <p className="mt-1 text-5xl leading-tight">{glyph}</p> : null}
          {node.body ? <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed"><RichText text={node.body} /></p> : null}
          {node.imageUrl ? (
            <>
              <button type="button" onClick={() => setZoom(true)} className="mt-2 block w-fit" aria-label="Open image">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={node.imageUrl} alt="attachment" loading="lazy" className="max-h-64 max-w-full cursor-zoom-in rounded-2xl border border-border/60 object-cover transition hover:opacity-95" />
              </button>
              {zoom ? <ImageLightbox src={node.imageUrl} onClose={() => setZoom(false)} /> : null}
            </>
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

        {/* Threaded replies — collapsible */}
        {node.replies.length > 0 ? (
          <div className="mt-2">
            {depth === 0 ? (
              <button type="button" onClick={() => setShowReplies((v) => !v)} className="mb-2 inline-flex items-center gap-1.5 pl-1 text-xs font-semibold text-primary transition hover:opacity-80">
                <span className="h-px w-5 bg-gradient-to-r from-blue-500/60 to-violet-500/60" />
                {showReplies ? "Hide replies" : `View ${node.replies.length} ${node.replies.length === 1 ? "reply" : "replies"}`}
              </button>
            ) : null}
            <AnimatePresence initial={false}>
              {showReplies ? (
                <motion.ul initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="space-y-3 overflow-hidden border-l-2 border-border/50 pl-3">
                  {node.replies.map((r) => (
                    <CommentItem key={r.id} node={r} postId={postId} depth={depth + 1} canReply={false} loggedIn={loggedIn} onPosted={onPosted} onReact={onReact} onModerate={onModerate} />
                  ))}
                </motion.ul>
              ) : null}
            </AnimatePresence>
          </div>
        ) : null}
      </div>
    </motion.li>
  );
}

function MenuRow({ icon: Icon, label, onClick, danger }: { icon: typeof Copy; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition hover:bg-secondary", danger ? "text-rose-500" : "text-foreground")}>
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}
