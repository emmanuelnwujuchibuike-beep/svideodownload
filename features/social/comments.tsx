"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  BadgeCheck,
  Copy,
  Flag,
  Heart,
  ImagePlus,
  Link2,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Send,
  Smile,
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

/** Recursively map a comment tree, replacing the node with `id`. */
function patchNode(nodes: CommentNode[], id: string, fn: (n: CommentNode) => CommentNode): CommentNode[] {
  return nodes.map((n) => {
    if (n.id === id) return fn(n);
    if (n.replies.length) return { ...n, replies: patchNode(n.replies, id, fn) };
    return n;
  });
}

/** Smart relevance: rewards likes + active replies, with a gentle recency lift. */
function smartScore(n: CommentNode): number {
  const hours = (Date.now() - new Date(n.createdAt).getTime()) / 3_600_000;
  const recency = Math.max(0, 24 - hours) / 24; // 0..1 for the last day
  return n.likesCount * 3 + n.replies.length * 2 + recency * 5;
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

  const toggleLike = useCallback(async (id: string, liked: boolean) => {
    const next = !liked;
    setNodes((ns) => patchNode(ns, id, (n) => ({ ...n, viewerLiked: next, likesCount: Math.max(0, n.likesCount + (next ? 1 : -1)) })));
    try {
      const res = await fetch(`/api/comments/${id}/like`, { method: next ? "POST" : "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setNodes((ns) => patchNode(ns, id, (n) => ({ ...n, viewerLiked: liked, likesCount: Math.max(0, n.likesCount + (next ? -1 : 1)) })));
    }
  }, []);

  const sorted = useMemo(() => {
    const arr = [...nodes];
    if (sort === "smart") arr.sort((a, b) => smartScore(b) - smartScore(a));
    else if (sort === "top") arr.sort((a, b) => b.likesCount - a.likesCount || +new Date(b.createdAt) - +new Date(a.createdAt));
    else arr.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    return arr;
  }, [nodes, sort]);

  return (
    <section id="comments" className={cn(!sheet && "mt-10 scroll-mt-24")}>
      <div className={cn("flex items-center justify-between gap-3", sheet ? "mb-3" : "mb-4")}>
        {sheet ? (
          <span />
        ) : (
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-[-0.02em]">
            <MessageCircle className="h-5 w-5 text-primary" />
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
                className={cn(
                  "relative rounded-full px-2.5 py-1 transition",
                  sort === s.id ? "text-white" : "text-muted-foreground hover:text-foreground",
                )}
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
          <span className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500/15 to-violet-500/15 text-primary">
            <MessageCircle className="h-5 w-5" />
          </span>
          <p className="text-sm text-muted-foreground">No comments yet — start the conversation ✨</p>
        </div>
      ) : (
        <ul className="space-y-4">
          <AnimatePresence initial={false}>
            {sorted.map((c) => (
              <CommentItem key={c.id} node={c} postId={postId} depth={0} canReply={loggedIn && canComment} loggedIn={loggedIn} onPosted={refresh} onLike={toggleLike} />
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
  const [uploading, setUploading] = useState(false);
  const [showStickers, setShowStickers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const canSend = (!!body.trim() || !!sticker || !!image) && !busy && !uploading;
  const remaining = MAX - body.length;

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
        body: JSON.stringify({ body: body.trim(), sticker: sticker?.id ?? null, imageUrl: image ?? null, parentId: parentId ?? null }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? "Couldn't post.");
        return;
      }
      setBody("");
      setSticker(null);
      setImage(null);
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
            <StickerPicker
              onPick={(s) => {
                setSticker(s);
                setShowStickers(false);
              }}
              onClose={() => setShowStickers(false)}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Attachment previews */}
      {(sticker || image) && (
        <div className="mb-2 flex items-center gap-2">
          {sticker ? (
            <span className="relative inline-flex items-center justify-center rounded-2xl bg-secondary/60 p-2 text-3xl ring-1 ring-inset ring-border/60">
              {sticker.glyph}
              <button type="button" onClick={() => setSticker(null)} aria-label="Remove sticker" className="absolute -right-1.5 -top-1.5 rounded-full bg-foreground/80 p-0.5 text-background">
                <X className="h-3 w-3" />
              </button>
            </span>
          ) : null}
          {image ? (
            <span className="relative inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image} alt="attachment" className="h-16 w-16 rounded-xl object-cover ring-1 ring-inset ring-border/60" />
              <button type="button" onClick={() => setImage(null)} aria-label="Remove image" className="absolute -right-1.5 -top-1.5 rounded-full bg-foreground/80 p-0.5 text-background">
                <X className="h-3 w-3" />
              </button>
            </span>
          ) : null}
        </div>
      )}

      {/* Glass composer with an electric focus glow */}
      <div className="group flex items-end gap-1.5 rounded-3xl border border-border/60 bg-card/70 p-2 shadow-soft backdrop-blur-xl transition focus-within:border-primary/50 focus-within:shadow-[0_0_0_3px_rgba(99,102,241,0.15),0_8px_30px_-12px_rgba(124,58,237,0.5)]">
        <button
          type="button"
          onClick={() => setShowStickers((s) => !s)}
          aria-label="Stickers"
          className={cn("shrink-0 rounded-full p-2 transition hover:bg-secondary", showStickers ? "text-primary" : "text-muted-foreground")}
        >
          <Smile className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label="Add a picture"
          disabled={uploading}
          className="shrink-0 rounded-full p-2 text-muted-foreground transition hover:bg-secondary disabled:opacity-60"
        >
          {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickImage(e.target.files?.[0])} />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, MAX))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          }}
          rows={1}
          autoFocus={autoFocus}
          placeholder={parentId ? "Write a reply…" : "Add to the conversation…"}
          className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent py-1.5 text-sm outline-none"
        />
        {remaining <= 120 ? (
          <span className={cn("shrink-0 self-center pr-1 text-[11px] font-semibold tabular-nums", remaining <= 0 ? "text-rose-500" : "text-muted-foreground")}>{remaining}</span>
        ) : null}
        <motion.button
          type="button"
          onClick={submit}
          disabled={!canSend}
          whileTap={{ scale: 0.88 }}
          aria-label={parentId ? "Reply" : "Comment"}
          className="shrink-0 rounded-full bg-gradient-to-r from-blue-600 to-violet-600 p-2 text-white shadow-md shadow-violet-500/30 transition hover:opacity-95 disabled:opacity-40 disabled:shadow-none"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
        </motion.button>
      </div>
      <div className="mt-1.5 flex items-center gap-3 pl-1">
        {onDone ? (
          <button type="button" onClick={onDone} className="text-xs text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        ) : null}
        {err ? <span className="text-xs text-red-400">{err}</span> : null}
      </div>
    </div>
  );
}

/** In-app image viewer — opens instantly, no redirect to the storage URL. */
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
      <button type="button" onClick={onClose} aria-label="Close" className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20">
        <X className="h-5 w-5" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" onClick={(e) => e.stopPropagation()} className="max-h-[90vh] max-w-full rounded-xl object-contain shadow-2xl" />
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
  onLike,
}: {
  node: CommentNode;
  postId: string;
  depth: number;
  canReply: boolean;
  loggedIn: boolean;
  onPosted: () => void | Promise<void>;
  onLike: (id: string, liked: boolean) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showReplies, setShowReplies] = useState(depth > 0);
  const [flash, setFlash] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);

  const flashNote = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash((f) => (f === msg ? null : f)), 1600);
  };

  const del = async () => {
    setMenuOpen(false);
    if (!confirm("Delete this comment?")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/comments/${node.id}`, { method: "DELETE" });
      if (res.ok) await onPosted();
    } finally {
      setDeleting(false);
    }
  };

  const like = () => {
    if (!node.viewerLiked) setBurst((b) => b + 1);
    onLike(node.id, node.viewerLiked);
  };

  const copyText = async () => {
    setMenuOpen(false);
    try {
      await navigator.clipboard.writeText(node.body || stickerGlyph(node.sticker) || "");
      flashNote("Copied");
    } catch {
      /* ignore */
    }
  };
  const copyLink = async () => {
    setMenuOpen(false);
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/p/${postId}#comments`);
      flashNote("Link copied");
    } catch {
      /* ignore */
    }
  };
  const report = async () => {
    setMenuOpen(false);
    try {
      await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: "comment", targetId: node.id, reason: "inappropriate" }),
      });
    } catch {
      /* best-effort */
    }
    flashNote("Reported — thank you");
  };

  const a = node.author;
  const glyph = stickerGlyph(node.sticker);
  const avatarSize = depth === 0 ? "h-10 w-10" : "h-8 w-8";

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.15 } }}
      transition={{ type: "spring", stiffness: 500, damping: 40 }}
      className="flex gap-3"
    >
      {a ? (
        <Link href={`/u/${a.handle}`} className="shrink-0">
          {a.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.avatarUrl} alt="" className={cn(avatarSize, "rounded-full object-cover ring-2 ring-border/50")} />
          ) : (
            <span className={cn(avatarSize, "flex items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-sm font-bold text-white")}>
              {a.displayName.charAt(0).toUpperCase()}
            </span>
          )}
        </Link>
      ) : (
        <span className={cn(avatarSize, "shrink-0 rounded-full bg-secondary")} />
      )}

      <div className="min-w-0 flex-1">
        {/* Glass comment bubble */}
        <div className="rounded-3xl rounded-tl-lg border border-border/50 bg-card/60 px-3.5 py-2.5 shadow-soft backdrop-blur-sm transition hover:border-border">
          <div className="flex items-center gap-1.5 text-sm">
            {a ? (
              <Link href={`/u/${a.handle}`} className="font-semibold hover:underline">
                {a.displayName}
              </Link>
            ) : (
              <span className="font-semibold text-muted-foreground">Unknown</span>
            )}
            {a?.isVerified ? <BadgeCheck className="h-3.5 w-3.5 text-primary" /> : null}
            {a ? <DiamondCrownBadge plan={a.plan} size="xs" /> : null}
            <span className="text-xs text-muted-foreground">· {timeAgo(node.createdAt)}</span>

            {/* Actions menu */}
            <div className="relative ml-auto">
              <button type="button" onClick={() => setMenuOpen((v) => !v)} aria-label="Comment actions" className="-mr-1 rounded-full p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground">
                <MoreHorizontal className="h-4 w-4" />
              </button>
              <AnimatePresence>
                {menuOpen ? (
                  <>
                    <button type="button" aria-label="Close" onClick={() => setMenuOpen(false)} className="fixed inset-0 z-40 cursor-default" />
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95, y: -4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="absolute right-0 z-50 mt-1 w-44 overflow-hidden rounded-2xl border border-border/60 bg-card/95 py-1 shadow-elevated backdrop-blur-xl"
                    >
                      <MenuRow icon={Copy} label="Copy text" onClick={copyText} />
                      <MenuRow icon={Link2} label="Copy link" onClick={copyLink} />
                      {loggedIn && !node.canDelete ? <MenuRow icon={Flag} label="Report" danger onClick={report} /> : null}
                      {node.canDelete ? <MenuRow icon={Trash2} label={deleting ? "Deleting…" : "Delete"} danger onClick={del} /> : null}
                    </motion.div>
                  </>
                ) : null}
              </AnimatePresence>
            </div>
          </div>

          {glyph ? <p className="mt-1 text-5xl leading-tight">{glyph}</p> : null}
          {node.body ? (
            <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed">
              <RichText text={node.body} />
            </p>
          ) : null}
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
        <div className="mt-1 flex items-center gap-4 pl-2 text-xs">
          <button
            type="button"
            onClick={like}
            aria-pressed={node.viewerLiked}
            className={cn("relative inline-flex items-center gap-1 font-semibold transition", node.viewerLiked ? "text-rose-500" : "text-muted-foreground hover:text-foreground")}
          >
            <motion.span key={`${node.viewerLiked}`} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 600, damping: 15 }}>
              <Heart className={cn("h-4 w-4", node.viewerLiked && "fill-current")} />
            </motion.span>
            {node.likesCount > 0 ? formatCompactNumber(node.likesCount) : "Like"}
            {/* Floating heart burst */}
            <AnimatePresence>
              {burst > 0 ? (
                <motion.span
                  key={burst}
                  initial={{ opacity: 0.9, y: 0, scale: 0.6 }}
                  animate={{ opacity: 0, y: -22, scale: 1.2 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.7, ease: "easeOut" }}
                  className="pointer-events-none absolute -top-1 left-1 text-rose-500"
                >
                  <Heart className="h-4 w-4 fill-current" />
                </motion.span>
              ) : null}
            </AnimatePresence>
          </button>
          {canReply ? (
            <button type="button" onClick={() => setReplying((r) => !r)} className="font-semibold text-muted-foreground transition hover:text-foreground">
              Reply
            </button>
          ) : null}
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
              <button
                type="button"
                onClick={() => setShowReplies((v) => !v)}
                className="mb-2 inline-flex items-center gap-1.5 pl-2 text-xs font-semibold text-primary transition hover:opacity-80"
              >
                <span className="h-px w-5 bg-gradient-to-r from-blue-500/60 to-violet-500/60" />
                {showReplies ? "Hide replies" : `View ${node.replies.length} ${node.replies.length === 1 ? "reply" : "replies"}`}
              </button>
            ) : null}
            <AnimatePresence initial={false}>
              {showReplies ? (
                <motion.ul
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-3 overflow-hidden border-l-2 border-border/50 pl-3"
                >
                  {node.replies.map((r) => (
                    <CommentItem key={r.id} node={r} postId={postId} depth={depth + 1} canReply={false} loggedIn={loggedIn} onPosted={onPosted} onLike={onLike} />
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
    <button
      type="button"
      onClick={onClick}
      className={cn("flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition hover:bg-secondary", danger ? "text-rose-500" : "text-foreground")}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}
