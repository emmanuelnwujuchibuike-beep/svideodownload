"use client";

import { ArrowLeft, BadgeCheck, MoreVertical, Phone, Video } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { usePresence } from "@/features/friends/use-presence";
import { GroupAvatarStack } from "@/features/social/group-avatar-stack";
import { PresenceBadge } from "@/features/social/presence-badge";
import { ThreadHeaderMenu } from "@/features/social/thread-header-menu";
import { ThreadOptionsSheet } from "@/features/social/thread-options-sheet";
import { toast } from "@/features/ui/toast";
import { haptic } from "@/lib/motion/haptics";
import type { ConversationMember, ConversationTheme, ConversationType, MemberRole, OtherUser } from "@/lib/social/messages";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * The thread header, lifted out of the server-rendered page so a group
 * rename/avatar-change/roster-change can update it LIVE — "Live Conversation
 * Updates" (Part 3 spec) means the header too, not just the message list.
 * Direct threads don't need this (their only live element, online/typing
 * status, is already handled by PresenceBadge) — this component only opens
 * its own realtime subscription for `type === "group"`.
 */
export function ThreadHeader({
  conversationId,
  viewerId,
  type,
  initialTitle,
  initialAvatarUrl,
  initialMembers,
  viewerRole,
  other,
  onlyAdminsCanSend = false,
  initialTheme = null,
  initialWallpaperUrl = null,
  initialDisappearAfterSeconds = null,
}: {
  conversationId: string;
  viewerId: string;
  type: ConversationType;
  initialTitle: string | null;
  initialAvatarUrl: string | null;
  initialMembers: ConversationMember[];
  viewerRole: MemberRole | null;
  other: OtherUser | null;
  onlyAdminsCanSend?: boolean;
  initialTheme?: ConversationTheme | null;
  initialWallpaperUrl?: string | null;
  initialDisappearAfterSeconds?: number | null;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [memberCount, setMemberCount] = useState(initialMembers.length);
  const [members, setMembers] = useState(initialMembers);
  const otherOnline = usePresence().has(other?.id ?? "");
  const [optionsOpen, setOptionsOpen] = useState(false);
  // Mirrors ConversationRoom's own `useLightDefault` — neither a color theme
  // nor a custom wallpaper is set, so the header should match the message
  // area's WhatsApp-style light default instead of the app's own dark mode,
  // or the two visibly seam at the header/body boundary (found via a real
  // screenshot, not assumed). Not live-reactive to a theme/wallpaper change
  // from ANOTHER member's edit the way ConversationRoom's liveTheme is —
  // this component doesn't track wallpaper_url over its own realtime
  // channel — but ThreadOptionsSheet's own patch() already calls
  // router.refresh() on the editing member's OWN client, which re-supplies
  // fresh initial props here; a stale header for everyone ELSE with the
  // thread already open is the same class of minor, self-correcting gap
  // already accepted elsewhere in this codebase.
  const forceLight = !initialTheme && !initialWallpaperUrl;

  useEffect(() => {
    if (type !== "group") return;
    const supabase = createClient();
    let cancelled = false;

    const refreshRoster = () => {
      void fetch(`/api/conversations/${conversationId}/members`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (cancelled || !d?.members) return;
          setMembers(d.members);
          setMemberCount(d.members.length);
        })
        .catch(() => {});
    };

    const channel = supabase
      .channel(`thread-header:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversations", filter: `id=eq.${conversationId}` },
        (payload) => {
          const row = payload.new as { title?: string | null; avatar_url?: string | null };
          if (row.title !== undefined) setTitle(row.title);
          if (row.avatar_url !== undefined) setAvatarUrl(row.avatar_url);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversation_members", filter: `conversation_id=eq.${conversationId}` },
        refreshRoster,
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [conversationId, type]);

  return (
    // Owner mockup: the header blends seamlessly into the thread background
    // (same dark surface, no dividing card/border) — was a distinct bordered
    // `bg-card` bar, a visibly different look from the reference image.
    // `forceLight` matches it to the message area's WhatsApp-style default
    // instead — a real screenshot showed a dark header sitting directly
    // above a forced-light message list otherwise, a visible seam.
    <div
      className={cn(
        "relative flex items-center gap-3 px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] lg:pt-3",
        forceLight ? "bg-white" : "bg-background",
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full bg-gradient-to-br from-blue-500/15 to-violet-500/15 blur-2xl"
      />
      {/* Owner mockup: a plain icon, no glass/circle chrome around it — was a
          bordered translucent chip, reported "old low class chat top menu". */}
      <Link
        href="/messages"
        aria-label="Back to messages"
        className={cn(
          "relative flex h-9 w-9 shrink-0 items-center justify-center transition lg:hidden",
          forceLight ? "text-neutral-900 hover:text-neutral-600" : "text-foreground hover:text-foreground/70",
        )}
      >
        <ArrowLeft className="h-5 w-5" />
      </Link>
      {type === "group" ? (
        <div className="relative flex min-w-0 flex-1 items-center gap-2.5">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover ring-2 ring-violet-500/25" />
          ) : (
            <GroupAvatarStack avatars={members.map((m) => ({ avatarUrl: m.avatarUrl, displayName: m.displayName }))} size="lg" />
          )}
          <span className="min-w-0">
            <span className={cn("block truncate text-sm font-bold", forceLight && "text-neutral-900")}>{title ?? "Group chat"}</span>
            <span className={cn("block text-xs text-muted-foreground", forceLight && "!text-neutral-500")}>{memberCount} members</span>
          </span>
        </div>
      ) : other ? (
        <Link href={`/u/${other.handle}`} className="relative flex min-w-0 flex-1 items-center gap-2.5">
          <span className="relative shrink-0">
            {other.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={other.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-sm font-bold text-white">
                {other.displayName.charAt(0).toUpperCase()}
              </span>
            )}
            {/* The mockup's presence dot rides the avatar's corner */}
            {otherOnline ? <span aria-hidden className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-card" /> : null}
          </span>
          <span className="min-w-0">
            <span className={cn("flex items-center gap-1 text-[15px] font-bold", forceLight && "text-neutral-900")}>
              <span className="truncate">{other.displayName}</span>
              {other.isVerified ? <BadgeCheck className="h-3.5 w-3.5 text-primary" /> : null}
            </span>
            <PresenceBadge userId={other.id} handle={other.handle} forceLight={forceLight} />
          </span>
        </Link>
      ) : (
        <span className="text-sm font-semibold text-muted-foreground">Unknown</span>
      )}

      {/* Voice/video call — the mockup's two header circles. Calls aren't
          built yet (no WebRTC signaling exists anywhere in this codebase);
          these are honest placeholders that say so rather than dead icons,
          and the buttons keep the mockup's layout ready for the real
          feature. Direct threads only, like the mockup. */}
      {type === "direct" && other ? (
        // Owner mockup: plain icons with no glass/circle chrome, matching the
        // back arrow above — was every icon in its own bordered translucent
        // chip, reported "old low class chat top menu, use exactly the image
        // style." Vertical-dots glyph (MoreVertical), not horizontal, to
        // match the reference image exactly.
        <span className="relative ml-auto flex shrink-0 items-center gap-3.5">
          <button
            type="button"
            aria-label="Voice call"
            onClick={() => {
              haptic("light");
              toast("Voice calls are coming soon.", "info");
            }}
            className={cn(
              "flex h-9 w-9 items-center justify-center transition",
              forceLight ? "text-neutral-900 hover:text-neutral-600" : "text-foreground hover:text-foreground/70",
            )}
          >
            <Phone className="h-[19px] w-[19px]" />
          </button>
          <button
            type="button"
            aria-label="Video call"
            onClick={() => {
              haptic("light");
              toast("Video calls are coming soon.", "info");
            }}
            className={cn(
              "flex h-9 w-9 items-center justify-center transition",
              forceLight ? "text-neutral-900 hover:text-neutral-600" : "text-foreground hover:text-foreground/70",
            )}
          >
            <Video className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Conversation options"
            onClick={() => {
              haptic("light");
              setOptionsOpen(true);
            }}
            className={cn(
              "flex h-9 w-9 items-center justify-center transition",
              forceLight ? "text-neutral-900 hover:text-neutral-600" : "text-foreground hover:text-foreground/70",
            )}
          >
            <MoreVertical className="h-5 w-5" />
          </button>
          <ThreadOptionsSheet
            conversationId={conversationId}
            otherHandle={other.handle}
            initialTheme={initialTheme}
            initialWallpaperUrl={initialWallpaperUrl}
            initialDisappearAfterSeconds={initialDisappearAfterSeconds}
            open={optionsOpen}
            onClose={() => setOptionsOpen(false)}
          />
        </span>
      ) : null}

      {type === "group" ? (
        <ThreadHeaderMenu
          conversationId={conversationId}
          viewerId={viewerId}
          viewerRole={viewerRole}
          initialTitle={title}
          initialOnlyAdminsCanSend={onlyAdminsCanSend}
        />
      ) : null}
    </div>
  );
}
