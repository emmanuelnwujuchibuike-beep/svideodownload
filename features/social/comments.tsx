"use client";

import { BadgeCheck, Heart, ImagePlus, Loader2, Send, Smile, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";

import { DiamondCrownBadge } from "@/components/badges/diamond-crown-badge";
import { RichText } from "@/components/social/rich-text";
import { StickerPicker } from "@/features/social/sticker-picker";
import { uploadPostMedia } from "@/lib/storage/client-upload";
import type { CommentNode } from "@/lib/social/engagement";
import { stickerGlyph, type Sticker } from "@/lib/social/stickers";
import { cn, formatCompactNumber } from "@/lib/utils";

type SortMode = "top" | "new";

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
  const [sort, setSort] = useState<SortMode>("top");
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

  const toggleLike = useCallback(
    async (id: string, liked: boolean) => {
      const next = !liked;
      setNodes((ns) => patchNode(ns, id, (n) => ({ ...n, viewerLiked: next, likesCount: Math.max(0, n.likesCount + (next ? 1 : -1)) })));
      try {
        const res = await fetch(`/api/comments/${id}/like`, { method: next ? "POST" : "DELETE" });
        if (!res.ok) throw new Error();
      } catch {
        setNodes((ns) => patchNode(ns, id, (n) => ({ ...n, viewerLiked: liked, likesCount: Math.max(0, n.likesCount + (next ? -1 : 1)) })));
      }
    },
    [],
  );

  const sorted = useMemo(() => {
    const arr = [...nodes];
    if (sort === "top") arr.sort((a, b) => b.likesCount - a.likesCount || +new Date(b.createdAt) - +new Date(a.createdAt));
    else arr.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    return arr;
  }, [nodes, sort]);

  return (
    <section id="comments" className={cn(!sheet && "mt-10 scroll-mt-24")}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className={cn("font-semibold tracking-[-0.02em]", sheet ? "text-base" : "text-lg")}>
          Comments {total > 0 ? <span className="text-muted-foreground">· {formatCompactNumber(total)}</span> : null}
        </h2>
        {nodes.length > 1 ? (
          <div className="flex items-center gap-1 rounded-full bg-secondary/60 p-0.5 text-xs font-semibold">
            <button type="button" onClick={() => setSort("top")} className={cn("rounded-full px-2.5 py-1 transition", sort === "top" ? "bg-background shadow-soft" : "text-muted-foreground")}>
              Top
            </button>
            <button type="button" onClick={() => setSort("new")} className={cn("rounded-full px-2.5 py-1 transition", sort === "new" ? "bg-background shadow-soft" : "text-muted-foreground")}>
              Newest
            </button>
          </div>
        ) : null}
      </div>

      {!loggedIn ? (
        <Link href="/login" className="mb-5 inline-block rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
          Sign in to comment
        </Link>
      ) : canComment ? (
        <Composer postId={postId} onPosted={refresh} />
      ) : (
        <p className="mb-5 rounded-xl border border-border/60 bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
          {disabledReason ?? "Comments are unavailable."}
        </p>
      )}

      {sorted.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No comments yet. Be the first ✨</p>
      ) : (
        <ul className="space-y-5">
          {sorted.map((c) => (
            <CommentItem key={c.id} node={c} postId={postId} canReply={loggedIn && canComment} onPosted={refresh} onLike={toggleLike} />
          ))}
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
      {showStickers ? (
        <div className="mb-2">
          <StickerPicker
            onPick={(s) => {
              setSticker(s);
              setShowStickers(false);
            }}
            onClose={() => setShowStickers(false)}
          />
        </div>
      ) : null}

      {/* Attachment previews */}
      {(sticker || image) && (
        <div className="mb-2 flex items-center gap-2">
          {sticker ? (
            <span className="relative inline-flex items-center justify-center rounded-2xl bg-secondary/60 p-2 text-3xl">
              {sticker.glyph}
              <button type="button" onClick={() => setSticker(null)} aria-label="Remove sticker" className="absolute -right-1.5 -top-1.5 rounded-full bg-foreground/80 p-0.5 text-background">
                <X className="h-3 w-3" />
              </button>
            </span>
          ) : null}
          {image ? (
            <span className="relative inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image} alt="attachment" className="h-16 w-16 rounded-xl object-cover" />
              <button type="button" onClick={() => setImage(null)} aria-label="Remove image" className="absolute -right-1.5 -top-1.5 rounded-full bg-foreground/80 p-0.5 text-background">
                <X className="h-3 w-3" />
              </button>
            </span>
          ) : null}
        </div>
      )}

      <div className="flex items-end gap-2 rounded-2xl bg-background p-2 ring-1 ring-inset ring-border focus-within:ring-2 focus-within:ring-primary">
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
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          }}
          rows={1}
          maxLength={1000}
          autoFocus={autoFocus}
          placeholder={parentId ? "Write a reply…" : "Add a comment…"}
          className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent py-1.5 text-sm outline-none"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          aria-label={parentId ? "Reply" : "Comment"}
          className="shrink-0 rounded-full bg-primary p-2 text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
        </button>
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

function CommentItem({
  node,
  postId,
  canReply,
  onPosted,
  onLike,
}: {
  node: CommentNode;
  postId: string;
  canReply: boolean;
  onPosted: () => void | Promise<void>;
  onLike: (id: string, liked: boolean) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const del = async () => {
    if (!confirm("Delete this comment?")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/comments/${node.id}`, { method: "DELETE" });
      if (res.ok) await onPosted();
    } finally {
      setDeleting(false);
    }
  };

  const a = node.author;
  const glyph = stickerGlyph(node.sticker);
  return (
    <li className="flex gap-3">
      {a ? (
        <Link href={`/u/${a.handle}`} className="shrink-0">
          {a.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-cyan-400 text-sm font-bold text-white">
              {a.displayName.charAt(0).toUpperCase()}
            </span>
          )}
        </Link>
      ) : (
        <span className="h-9 w-9 shrink-0 rounded-full bg-secondary" />
      )}
      <div className="min-w-0 flex-1">
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
        </div>

        {glyph ? <p className="mt-0.5 text-5xl leading-tight">{glyph}</p> : null}
        {node.body ? (
          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed">
            <RichText text={node.body} />
          </p>
        ) : null}
        {node.imageUrl ? (
          <a href={node.imageUrl} target="_blank" rel="noreferrer" className="mt-1.5 block w-fit">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={node.imageUrl} alt="attachment" className="max-h-64 max-w-full rounded-2xl border border-border/60 object-cover" />
          </a>
        ) : null}

        <div className="mt-1.5 flex items-center gap-4 text-xs">
          <button
            type="button"
            onClick={() => onLike(node.id, node.viewerLiked)}
            aria-pressed={node.viewerLiked}
            className={cn("inline-flex items-center gap-1 font-medium transition", node.viewerLiked ? "text-rose-500" : "text-muted-foreground hover:text-foreground")}
          >
            <Heart className={cn("h-3.5 w-3.5", node.viewerLiked && "fill-current")} />
            {node.likesCount > 0 ? formatCompactNumber(node.likesCount) : "Like"}
          </button>
          {canReply ? (
            <button type="button" onClick={() => setReplying((r) => !r)} className="font-medium text-muted-foreground hover:text-foreground">
              Reply
            </button>
          ) : null}
          {node.canDelete ? (
            <button
              type="button"
              onClick={del}
              disabled={deleting}
              className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-red-400 disabled:opacity-60"
            >
              <Trash2 className="h-3 w-3" /> Delete
            </button>
          ) : null}
        </div>

        {replying ? <Composer postId={postId} parentId={node.id} autoFocus onPosted={onPosted} onDone={() => setReplying(false)} /> : null}

        {node.replies.length > 0 ? (
          <ul className="mt-4 space-y-4 border-l border-border/60 pl-4">
            {node.replies.map((r) => (
              <CommentItem key={r.id} node={r} postId={postId} canReply={false} onPosted={onPosted} onLike={onLike} />
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}
