"use client";

import { ArrowLeft, BadgeCheck, MoreHorizontal, Phone, Video } from "lucide-react";
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
  initialDisappearAfterSeconds?: number | null;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [memberCount, setMemberCount] = useState(initialMembers.length);
  const [members, setMembers] = useState(initialMembers);
  const otherOnline = usePresence().has(other?.id ?? "");
  const [optionsOpen, setOptionsOpen] = useState(false);

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
    <div className="relative flex items-center gap-3 border-b border-border/60 bg-card/70 px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur-xl lg:pt-3">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full bg-gradient-to-br from-blue-500/15 to-violet-500/15 blur-2xl"
      />
      <Link
        href="/messages"
        aria-label="Back to messages"
        className="glass relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground/80 transition hover:text-foreground lg:hidden"
      >
        <ArrowLeft className="h-[18px] w-[18px]" />
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
            <span className="block truncate text-sm font-bold">{title ?? "Group chat"}</span>
            <span className="block text-xs text-muted-foreground">{memberCount} members</span>
          </span>
        </div>
      ) : other ? (
        <Link href={`/u/${other.handle}`} className="relative flex min-w-0 flex-1 items-center gap-2.5">
          <span className="relative shrink-0">
            {other.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={other.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover ring-2 ring-violet-500/40" />
            ) : (
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-sm font-bold text-white ring-2 ring-violet-500/40">
                {other.displayName.charAt(0).toUpperCase()}
              </span>
            )}
            {/* The mockup's presence dot rides the avatar's corner */}
            {otherOnline ? <span aria-hidden className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-card" /> : null}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1 text-[15px] font-bold">
              <span className="truncate">{other.displayName}</span>
              {other.isVerified ? <BadgeCheck className="h-3.5 w-3.5 text-primary" /> : null}
            </span>
            <PresenceBadge userId={other.id} handle={other.handle} />
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
        <span className="relative ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            aria-label="Voice call"
            onClick={() => {
              haptic("light");
              toast("Voice calls are coming soon.", "info");
            }}
            className="glass flex h-9 w-9 items-center justify-center rounded-full text-foreground/80 transition hover:text-foreground"
          >
            <Phone className="h-[16px] w-[16px]" />
          </button>
          <button
            type="button"
            aria-label="Video call"
            onClick={() => {
              haptic("light");
              toast("Video calls are coming soon.", "info");
            }}
            className="glass flex h-9 w-9 items-center justify-center rounded-full text-foreground/80 transition hover:text-foreground"
          >
            <Video className="h-[17px] w-[17px]" />
          </button>
          <button
            type="button"
            aria-label="Conversation options"
            onClick={() => {
              haptic("light");
              setOptionsOpen(true);
            }}
            className="glass flex h-9 w-9 items-center justify-center rounded-full text-foreground/80 transition hover:text-foreground"
          >
            <MoreHorizontal className="h-[18px] w-[18px]" />
          </button>
          <ThreadOptionsSheet
            conversationId={conversationId}
            otherHandle={other.handle}
            initialTheme={initialTheme}
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
