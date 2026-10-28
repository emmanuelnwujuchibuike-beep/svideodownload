"use client";

import { Gift } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState, type ReactNode } from "react";

import { useEntitlements } from "@/features/auth/use-entitlements";
import { haptic } from "@/lib/motion/haptics";

import type { GiftRecipient } from "./gift-sheet";

/*
  Sticker gifting from a post (owner, 2026-10-28: "add the sticker gifting in the feed, reels and AI reels, and exclusive
  posts' comments so users can gift through there — the buttons must warm up and open instantly").

  The same sheet as chat and stories. Warm: the sheet's code and the sticker gallery (the shared cache) load as soon as
  the button is on screen, so a tap opens it filled. The gift lands in the 1:1 chat with the creator, found or created
  only when Send is pressed (app/api/posts/[id]/gift-conversation). Shown to signed-in members while Frenz Coin is on,
  never on their own post.
*/
const GiftSheet = dynamic(() => import("./gift-sheet").then((m) => m.GiftSheet), { ssr: false });

async function giftConversation(postId: string | undefined, to: string): Promise<string> {
  // a feed post asks through the post (its own checks); anything else names the person (app/api/gift/conversation)
  const r = postId
    ? await fetch(`/api/posts/${encodeURIComponent(postId)}/gift-conversation`, { method: "POST", credentials: "same-origin" })
    : await fetch("/api/gift/conversation", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to }) });
  const body = (await r.json().catch(() => null)) as { conversationId?: string; error?: string } | null;
  if (!r.ok || !body?.conversationId) throw new Error(body?.error || "Couldn't reach this chat. Try again.");
  return body.conversationId;
}

export function PostGiftButton({
  postId,
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
  /** the feed post the gift is for; omitted for content outside the posts table (exclusive posts) — then it goes to `author` */
  postId?: string;
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
          conversationId={() => giftConversation(postId, author.userId)}
          recipients={[author]}
          requireChoice={false}
          backHref={typeof window === "undefined" ? undefined : window.location.pathname + window.location.search}
          zIndex={130}
          onClose={() => {
            setOpen(false);
            onOpenChange?.(false);
          }}
          onSent={() => {}}
        />
      ) : null}
    </>
  );
}
