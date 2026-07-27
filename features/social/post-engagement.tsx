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
      <Pill
        active={liked}
        onClick={() => react("like")}
        activeClass="border-transparent bg-gradient-to-br from-rose-500/15 to-red-500/10 text-rose-500 shadow-sm shadow-rose-500/20 ring-1 ring-inset ring-rose-500/30"
      >
        <Heart className={cn("h-[18px] w-[18px] transition-transform", liked && "scale-110 fill-current")} /> {formatCompactNumber(likes)}
      </Pill>
      <Pill
        active={saved}
        onClick={() => react("save")}
        activeClass="border-transparent bg-gradient-to-br from-blue-500/15 to-violet-500/10 text-primary shadow-sm shadow-primary/20 ring-1 ring-inset ring-primary/30"
      >
        <Bookmark className={cn("h-[18px] w-[18px] transition-transform", saved && "scale-110 fill-current")} /> {formatCompactNumber(saves)}
      </Pill>
      <Pill onClick={share}>
        {copied ? <Check className="h-[18px] w-[18px] text-emerald-500" /> : <Share2 className="h-[18px] w-[18px]" />} {formatCompactNumber(shares)}
      </Pill>
      <a
        href="#comments"
        className="inline-flex h-10 items-center gap-1.5 rounded-2xl border border-border/70 bg-card/70 px-4 text-sm font-semibold text-muted-foreground shadow-sm backdrop-blur transition-all duration-200 hover:-translate-y-px hover:text-foreground hover:shadow-md active:translate-y-0"
      >
        <MessageCircle className="h-[18px] w-[18px]" /> {formatCompactNumber(initial.comments)}
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
        "inline-flex h-10 items-center gap-1.5 rounded-2xl border px-4 text-sm font-semibold tabular-nums shadow-sm backdrop-blur transition-all duration-200 hover:-translate-y-px active:translate-y-0 active:scale-95",
        active && activeClass
          ? activeClass
          : "border-border/70 bg-card/70 text-muted-foreground hover:text-foreground hover:shadow-md",
      )}
    >
      {children}
    </button>
  );
}
