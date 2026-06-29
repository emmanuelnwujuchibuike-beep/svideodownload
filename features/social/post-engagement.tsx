"use client";

import { Bookmark, Check, Heart, MessageCircle, Share2 } from "lucide-react";
import { useState } from "react";

import { cn, formatCompactNumber } from "@/lib/utils";

/**
 * Interactive like / save / share / comment bar for a post page. Optimistic,
 * reverts on error. Anonymous users are routed to sign-in for like/save.
 */
export function PostEngagement({
  postId,
  loggedIn,
  initial,
}: {
  postId: string;
  loggedIn: boolean;
  initial: {
    liked: boolean;
    saved: boolean;
    likes: number;
    saves: number;
    shares: number;
    comments: number;
  };
}) {
  const [liked, setLiked] = useState(initial.liked);
  const [saved, setSaved] = useState(initial.saved);
  const [likes, setLikes] = useState(initial.likes);
  const [saves, setSaves] = useState(initial.saves);
  const [shares, setShares] = useState(initial.shares);
  const [copied, setCopied] = useState(false);

  const react = async (type: "like" | "save") => {
    if (!loggedIn) {
      window.location.href = "/login";
      return;
    }
    const isLike = type === "like";
    const wasActive = isLike ? liked : saved;
    const next = !wasActive;
    // optimistic
    if (isLike) {
      setLiked(next);
      setLikes((n) => n + (next ? 1 : -1));
    } else {
      setSaved(next);
      setSaves((n) => n + (next ? 1 : -1));
    }
    try {
      const res = await fetch(`/api/posts/${postId}/react`, {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      if (!res.ok) throw new Error();
    } catch {
      // revert
      if (isLike) {
        setLiked(wasActive);
        setLikes((n) => n + (next ? -1 : 1));
      } else {
        setSaved(wasActive);
        setSaves((n) => n + (next ? -1 : 1));
      }
    }
  };

  const share = async () => {
    const url = `${window.location.origin}/p/${postId}`;
    try {
      if (navigator.share) await navigator.share({ url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
      setShares((n) => n + 1);
      navigator.sendBeacon?.(
        `/api/posts/${postId}/event`,
        new Blob([JSON.stringify({ type: "share" })], { type: "application/json" }),
      );
    } catch {
      /* user cancelled share */
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Pill active={liked} onClick={() => react("like")} activeClass="border-red-500/40 bg-red-500/10 text-red-500">
        <Heart className={cn("h-4 w-4", liked && "fill-current")} /> {formatCompactNumber(likes)}
      </Pill>
      <Pill active={saved} onClick={() => react("save")} activeClass="border-primary/40 bg-primary/10 text-primary">
        <Bookmark className={cn("h-4 w-4", saved && "fill-current")} /> {formatCompactNumber(saves)}
      </Pill>
      <Pill onClick={share}>
        {copied ? <Check className="h-4 w-4 text-green-500" /> : <Share2 className="h-4 w-4" />} {formatCompactNumber(shares)}
      </Pill>
      <a
        href="#comments"
        className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground"
      >
        <MessageCircle className="h-4 w-4" /> {formatCompactNumber(initial.comments)}
      </a>
    </div>
  );
}

function Pill({
  active,
  activeClass,
  onClick,
  children,
}: {
  active?: boolean;
  activeClass?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold tabular-nums transition active:scale-95",
        active && activeClass ? activeClass : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
