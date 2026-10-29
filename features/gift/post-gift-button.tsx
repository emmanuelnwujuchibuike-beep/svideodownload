"use client";

import { Gift } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState, type ReactNode } from "react";

import { useEntitlements } from "@/features/auth/use-entitlements";
import { haptic } from "@/lib/motion/haptics";
import { postCommentsChanged } from "@/lib/social/comments-cache";

import type { GiftRecipient } from "./gift-sheet";

/*
  Sticker gifting from a post (owner, 2026-10-28: "add the sticker gifting in the feed, reels and AI reels, and exclusive
  posts' comments so users can gift through there — the buttons must warm up and open instantly").

  The same sheet as chat and stories. Warm: the sheet's code and the sticker gallery (the shared cache) load as soon as
  the button is on screen, so a tap opens it filled. A gift on a feed post or an exclusive post lands ON that post, in
  its comments (0304 — owner, 2026-10-28: "gift sent from comment shows in comment, not chat"), so the creator's message
  setting no longer stops a post from being gifted. Only a gift with no post (a person) still goes through their chat.
  Shown to signed-in members while Frenz Coin is on, never on their own post.
*/
const GiftSheet = dynamic(() => import("./gift-sheet").then((m) => m.GiftSheet), { ssr: false });

async function giftConversation(to: string): Promise<string> {
  // no post: the chat with the person (app/api/gift/conversation)
  const r = await fetch("/api/gift/conversation", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to }) });
  const body = (await r.json().catch(() => null)) as { conversationId?: string; error?: string } | null;
  if (!r.ok || !body?.conversationId) throw new Error(body?.error || "Couldn't reach this chat. Try again.");
  return body.conversationId;
}

export function PostGiftButton({
  postId,
  subPostId,
  onSent,
  author,
  viewerId,
  authorHandle,
  className,
  children,
  render,
  onOpenChange,
}: {
  /** the creator's handle — hides the button on the viewer's own post when only handles are at hand */
  authorHandle?: string | null;
  /** a surface with its own button (the reel rail): it gets the open action and draws the control itself */
  render?: (open: () => void) => ReactNode;
  /** the feed post the gift is for — the gift shows in its comments */
  postId?: string;
  /** an exclusive post (sub_posts) the gift is for — the gift shows in its comments */
  subPostId?: string;
  /** after a gift is sent (a comment list can show it at once) */
  onSent?: () => void;
  author: GiftRecipient;
  /** the signed-in viewer, when the surface already knows it (else the entitlements decide) */
  viewerId?: string | null;
  className?: string;
  /** the surface's own look for the button (an icon rail, an action row, a composer); a gift glyph by default */
  children?: ReactNode;
  /** a surface that pauses (a reel) can hold still while the sheet is up */
  onOpenChange?: (open: boolean) => void;
}) {
  const { handle, frenzCoin, ready } = useEntitlements();
  const [open, setOpen] = useState(false);
  const visible = ready && frenzCoin && !!handle && viewerId !== author.userId && (!authorHandle || authorHandle !== handle);

  // warm the sheet and its stickers while the button is on screen — the tap then opens it at once
  useEffect(() => {
    if (!visible) return;
    void import("./gift-sheet").then((m) => m.warmGiftSheet()).catch(() => {});
  }, [visible]);

  if (!visible) return null;
  const openSheet = () => {
    haptic("light");
    setOpen(true);
    onOpenChange?.(true);
  };
  return (
    <>
      {render ? render(openSheet) : <button
        type="button"
        aria-label={`Send ${author.name} a sticker gift`}
        onPointerDown={() => void import("./gift-sheet")}
        onClick={(e) => {
          e.stopPropagation();
          openSheet();
        }}
        className={className}
      >
        {children ?? <Gift className="h-5 w-5" strokeWidth={2.1} aria-hidden />}
      </button>}
      {open ? (
        <GiftSheet
          place={postId ? { kind: "post", id: postId } : subPostId ? { kind: "sub_post", id: subPostId } : null}
          conversationId={postId || subPostId ? null : () => giftConversation(author.userId)}
          recipients={[author]}
          requireChoice={false}
          backHref={typeof window === "undefined" ? undefined : window.location.pathname + window.location.search}
          zIndex={130}
          onClose={() => {
            setOpen(false);
            onOpenChange?.(false);
          }}
          onSent={() => {
            // the gift is now a comment on the post: the cached list is stale, and an open one re-reads
            if (postId) postCommentsChanged(postId);
            onSent?.();
          }}
        />
      ) : null}
    </>
  );
}
