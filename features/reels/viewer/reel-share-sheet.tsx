"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { PostGiftButton } from "@/features/gift/post-gift-button";
import type { GiftRecipient } from "@/features/gift/gift-sheet";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/*
  The reel's Share sheet from design/frenz-reels.html (owner, 2026-10-28): Send gift, Repost, Chats, Copy link,
  Download, Story — and More, because the design's top-right corner is Search, so the options sheet (report, not
  interested, speed, edit…) is reached from here and from press-and-hold. Every option hands off to the reel's EXISTING
  action (the gift sheet, the repost sheet, the send sheet, the download, the more sheet); nothing new is decided here.
  Dark glass, slides up with CSS only, rendered only while open (the reel loads this file on the first tap).
*/

const TILE = "flex h-[54px] w-[54px] items-center justify-center rounded-[18px] border border-white/[0.16] bg-white/10 text-white";

function Option({ label, icon, onClick, pressed, tileClass }: { label: string; icon: ReactNode; onClick: () => void; pressed?: boolean; tileClass?: string }) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick} className="flex flex-col items-center gap-1.5 text-[12px] text-white/[0.72] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80">
      <span className={cn(TILE, tileClass)}>{icon}</span>
      {label}
    </button>
  );
}

const svg = (d: ReactNode, extra?: Record<string, unknown>) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...extra}>
    {d}
  </svg>
);

export function ReelShareSheet({
  open,
  onClose,
  postId,
  author,
  authorHandle,
  reposted,
  onRepost,
  onChats,
  onCopyLink,
  onDownload,
  onStory,
  onMore,
}: {
  open: boolean;
  onClose: () => void;
  postId: string;
  author: GiftRecipient;
  authorHandle: string;
  reposted: boolean;
  onRepost: () => void;
  onChats: () => void;
  onCopyLink: () => void;
  onDownload: () => void;
  onStory: () => void;
  onMore: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;
  const pick = (fn: () => void) => () => {
    haptic("selection");
    onClose();
    fn();
  };

  return createPortal(
    <div className="fixed inset-0 z-[120]" onClick={(e) => e.stopPropagation()}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/35 motion-safe:animate-in motion-safe:fade-in" />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Share"
        className="absolute inset-x-0 bottom-0 mx-auto max-w-[430px] rounded-t-[28px] border-t border-white/[0.16] bg-[rgba(22,22,30,0.86)] px-4 pb-[calc(20px+env(safe-area-inset-bottom))] pt-2.5 text-white backdrop-blur-[28px] backdrop-saturate-[1.7] motion-safe:animate-in motion-safe:slide-in-from-bottom motion-safe:duration-300"
      >
        <div className="mx-auto mb-3 h-[5px] w-10 rounded-full bg-white/[0.28]" />
        <h2 className="mb-3 text-center text-base font-bold">Share</h2>
        <div className="grid grid-cols-3 gap-x-2.5 gap-y-4">
          <PostGiftButton
            postId={postId}
            author={author}
            authorHandle={authorHandle}
            render={(openGift) => (
              <Option
                label="Send gift"
                tileClass="border-transparent bg-[linear-gradient(135deg,#3B5BFD_0%,#5B4BF3_50%,#8A3CEB_100%)]"
                icon={svg(<><rect x="4" y="9" width="16" height="11" rx="2" /><path d="M3 9h18M12 9v11M12 9c-1.5-3.5-6-3.5-5 0M12 9c1.5-3.5 6-3.5 5 0" /></>)}
                onClick={() => {
                  haptic("selection");
                  openGift();
                }}
              />
            )}
          />
          <Option
            label={reposted ? "Reposted" : "Repost"}
            pressed={reposted}
            tileClass={reposted ? "border-emerald-400/60 bg-emerald-400/[0.22] text-emerald-400" : undefined}
            icon={svg(<><path d="M17 2.5l3 3-3 3" /><path d="M4 11v-1.5a4 4 0 0 1 4-4h12" /><path d="M7 21.5l-3-3 3-3" /><path d="M20 13v1.5a4 4 0 0 1-4 4H4" /></>)}
            onClick={pick(onRepost)}
          />
          <Option label="Chats" icon={svg(<path d="M12 4a8 8 0 0 0-6.9 12.1L4 20l4-1.1A8 8 0 1 0 12 4z" />)} onClick={pick(onChats)} />
          <Option label="Copy link" icon={svg(<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />)} onClick={pick(onCopyLink)} />
          <Option label="Download" icon={svg(<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />, { strokeWidth: 2.2 })} onClick={pick(onDownload)} />
          <Option label="Story" icon={svg(<circle cx="12" cy="12" r="8.5" />, { strokeDasharray: "3 3" })} onClick={pick(onStory)} />
          <Option label="More" icon={svg(<><circle cx="5.5" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="18.5" cy="12" r="1.2" fill="currentColor" /></>)} onClick={pick(onMore)} />
        </div>
      </section>
    </div>,
    document.body,
  );
}
