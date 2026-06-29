"use client";

import { BadgeCheck, Loader2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { DiamondCrownBadge } from "@/components/badges/diamond-crown-badge";
import type { CommentNode } from "@/lib/social/engagement";
import { cn } from "@/lib/utils";

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

export function Comments({
  postId,
  comments,
  loggedIn,
  canComment,
  disabledReason,
  count,
}: {
  postId: string;
  comments: CommentNode[];
  loggedIn: boolean;
  canComment: boolean;
  disabledReason: string | null;
  count: number;
}) {
  return (
    <section id="comments" className="mt-10 scroll-mt-24">
      <h2 className="mb-4 text-lg font-semibold tracking-[-0.02em]">
        Comments {count > 0 ? <span className="text-muted-foreground">· {count}</span> : null}
      </h2>

      {!loggedIn ? (
        <Link href="/login" className="mb-5 inline-block rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
          Sign in to comment
        </Link>
      ) : canComment ? (
        <Composer postId={postId} />
      ) : (
        <p className="mb-5 rounded-xl border border-border/60 bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
          {disabledReason ?? "Comments are unavailable."}
        </p>
      )}

      {comments.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No comments yet. Be the first.</p>
      ) : (
        <ul className="space-y-5">
          {comments.map((c) => (
            <CommentItem key={c.id} node={c} postId={postId} canReply={loggedIn && canComment} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Composer({
  postId,
  parentId,
  onDone,
  autoFocus,
}: {
  postId: string;
  parentId?: string;
  onDone?: () => void;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/posts/${postId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: body.trim(), parentId: parentId ?? null }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? "Couldn't post.");
        return;
      }
      setBody("");
      onDone?.();
      router.refresh();
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("mb-5", parentId && "mt-3")}>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={1000}
        autoFocus={autoFocus}
        placeholder={parentId ? "Write a reply…" : "Add a comment…"}
        className="min-h-[60px] w-full rounded-xl bg-background p-3 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy || !body.trim()}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {parentId ? "Reply" : "Comment"}
        </button>
        {onDone ? (
          <button type="button" onClick={onDone} className="rounded-xl px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        ) : null}
        {err ? <span className="text-sm text-red-400">{err}</span> : null}
      </div>
    </div>
  );
}

function CommentItem({ node, postId, canReply }: { node: CommentNode; postId: string; canReply: boolean }) {
  const router = useRouter();
  const [replying, setReplying] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const del = async () => {
    if (!confirm("Delete this comment?")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/comments/${node.id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setDeleting(false);
    }
  };

  const a = node.author;
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
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed">{node.body}</p>
        <div className="mt-1 flex items-center gap-3 text-xs">
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

        {replying ? (
          <Composer postId={postId} parentId={node.id} autoFocus onDone={() => setReplying(false)} />
        ) : null}

        {node.replies.length > 0 ? (
          <ul className="mt-4 space-y-4 border-l border-border/60 pl-4">
            {node.replies.map((r) => (
              <CommentItem key={r.id} node={r} postId={postId} canReply={false} />
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}
