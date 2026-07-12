import {
  AtSign,
  Bell,
  Bookmark,
  CheckCircle2,
  CreditCard,
  Crown,
  Download,
  Eye,
  Heart,
  Megaphone,
  MessageCircle,
  Newspaper,
  PartyPopper,
  Quote,
  Repeat2,
  Reply,
  Share2,
  ShieldAlert,
  SmilePlus,
  Tag,
  Trophy,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";

import { WowSolid } from "@/components/brand/wow-icon";

import type { NotificationCategory, NotificationType } from "@/lib/social/notifications";

type LucideIcon = typeof Bell;

const ICONS: Partial<Record<NotificationType, LucideIcon>> = {
  follow: UserPlus,
  friend_request: UserPlus,
  friend_accepted: PartyPopper,
  friend_reminder: MessageCircle,
  message: MessageCircle,
  message_reaction: SmilePlus,
  message_mention: AtSign,
  // Wow is Frenz's signature interaction — its notifications carry the mark.
  like: WowSolid,
  love: Heart,
  comment: MessageCircle,
  reply: Reply,
  mention: AtSign,
  tag: Tag,
  quote: Quote,
  repost: Repeat2,
  repost_engagement: Repeat2,
  comment_reaction: SmilePlus,
  share: Share2,
  save: Bookmark,
  profile_view: Eye,
  invite: Users,
  milestone: Trophy,
  download_complete: CheckCircle2,
  download_failed: XCircle,
  download_ready: Download,
  processing_finished: CheckCircle2,
  community_invite: Users,
  community_accepted: Users,
  community_announcement: Users,
  community_event: PartyPopper,
  news_breaking: Newspaper,
  news_trending: Newspaper,
  news_following: Newspaper,
  news_recommended: Newspaper,
  subscription_activated: Crown,
  payment_successful: CreditCard,
  renewal_reminder: CreditCard,
  premium_expiring: Crown,
  security_login: ShieldAlert,
  security_new_device: ShieldAlert,
  security_password: ShieldAlert,
  security_2fa: ShieldAlert,
  security_suspicious: ShieldAlert,
  security_recovery: ShieldAlert,
  admin_broadcast: Megaphone,
  post_under_review: ShieldAlert,
};

export function iconFor(type: NotificationType): LucideIcon {
  return ICONS[type] ?? Bell;
}

/**
 * Icon-badge tint per category. Monochrome by default (black-line look) — color
 * is reserved for the two categories where it carries real meaning: Premium
 * (gold) and Security (urgent red).
 */
export function tintFor(category: NotificationCategory, type?: NotificationType): string {
  // Milestones are celebratory — the one "social" type worth breaking the
  // monochrome-by-default rule for (Part 8 achievement notifications).
  if (type === "milestone") return "bg-amber-500/15 text-amber-500";
  // Also worth breaking it for — a post under review needs to read as
  // urgent/actionable, not blend into ordinary system chatter.
  if (type === "post_under_review") return "bg-rose-500/15 text-rose-500";
  switch (category) {
    case "premium":
      return "bg-amber-500/15 text-amber-500";
    case "security":
      return "bg-rose-500/15 text-rose-500";
    default:
      return "bg-secondary text-foreground";
  }
}

/** The action phrase for a notification type (used after the actor name(s)). */
export function verbFor(type: NotificationType): string {
  switch (type) {
    case "follow":
      return "started following you";
    case "friend_request":
      return "sent you a friend request";
    case "friend_accepted":
      return "accepted your friend request 🎉";
    case "friend_reminder":
      return "is ready to chat — say hi 👋";
    case "message":
      return "sent you a message";
    case "message_reaction":
      return "reacted to your message";
    case "message_mention":
      return "mentioned you in a chat";
    case "like":
      return "Wow'd your post";
    case "love":
      return "loved your post";
    case "comment":
      return "commented on your post";
    case "reply":
      return "replied to you";
    case "mention":
      return "mentioned you";
    case "tag":
      return "tagged you";
    case "quote":
      return "quoted your post";
    case "repost":
      return "reposted your post";
    case "repost_engagement":
      return "engaged with the post you reposted";
    case "comment_reaction":
      return "reacted to your comment";
    case "share":
      return "shared your post";
    case "save":
      return "saved your post";
    case "profile_view":
      return "viewed your profile";
    case "invite":
      return "invited you";
    case "milestone":
      return "reached a milestone 🎉";
    case "download_complete":
      return "Download complete";
    case "download_failed":
      return "Download failed";
    case "download_ready":
      return "Your download is ready";
    case "processing_finished":
      return "Processing finished";
    case "community_invite":
      return "invited you to a community";
    case "community_accepted":
      return "accepted your request";
    case "community_announcement":
      return "posted an announcement";
    case "community_event":
      return "created an event";
    case "news_breaking":
      return "Breaking news";
    case "news_trending":
      return "Trending now";
    case "news_following":
      return "News you follow";
    case "news_recommended":
      return "Recommended for you";
    case "subscription_activated":
      return "Your subscription is active";
    case "payment_successful":
      return "Payment successful";
    case "renewal_reminder":
      return "Renewal reminder";
    case "premium_expiring":
      return "Your Premium is expiring soon";
    case "security_login":
      return "New login to your account";
    case "security_new_device":
      return "New device signed in";
    case "security_password":
      return "Your password was changed";
    case "security_2fa":
      return "Two-factor authentication enabled";
    case "security_suspicious":
      return "Suspicious activity detected";
    case "security_recovery":
      return "Recovery email changed";
    case "admin_broadcast":
      return "Frenz announcement";
    case "post_under_review":
      return "Your post was hidden pending review";
    default:
      return "sent you a notification";
  }
}

/** Actor-driven social types show avatars + names; the rest are system messages. */
export function isActorType(type: NotificationType): boolean {
  return (
    !type.startsWith("download") &&
    !type.startsWith("security") &&
    !type.startsWith("news") &&
    type !== "subscription_activated" &&
    type !== "payment_successful" &&
    type !== "renewal_reminder" &&
    type !== "premium_expiring" &&
    type !== "processing_finished" &&
    type !== "milestone" &&
    type !== "system" &&
    type !== "admin_broadcast" &&
    type !== "post_under_review"
  );
}

/** Deep link for a notification — shared by the bell, live toast and cards. */
export function hrefFor(n: {
  type: NotificationType;
  actor: { handle: string } | null;
  postId: string | null;
  conversationId?: string | null;
}): string {
  if (n.type === "friend_request") return "/friends";
  if ((n.type === "friend_accepted" || n.type === "friend_reminder" || n.type === "follow") && n.actor) {
    return `/u/${n.actor.handle}`;
  }
  if ((n.type === "message" || n.type === "message_reaction" || n.type === "message_mention") && n.conversationId) return `/messages/${n.conversationId}`;
  if (n.postId) return `/p/${n.postId}`;
  return "/notifications";
}

/** Relative "2m", "3h", "5d" style timestamp. */
export function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
