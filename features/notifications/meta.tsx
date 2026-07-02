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
  MessageCircle,
  Newspaper,
  PartyPopper,
  Quote,
  Repeat2,
  Reply,
  Share2,
  ShieldAlert,
  Tag,
  Trophy,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";

import type { NotificationCategory, NotificationType } from "@/lib/social/notifications";

type LucideIcon = typeof Bell;

const ICONS: Partial<Record<NotificationType, LucideIcon>> = {
  follow: UserPlus,
  like: Heart,
  love: Heart,
  comment: MessageCircle,
  reply: Reply,
  mention: AtSign,
  tag: Tag,
  quote: Quote,
  repost: Repeat2,
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
};

export function iconFor(type: NotificationType): LucideIcon {
  return ICONS[type] ?? Bell;
}

/** Brand-aligned icon-badge tint per category (Electric Blue → Purple family). */
export function tintFor(category: NotificationCategory): string {
  switch (category) {
    case "social":
      return "bg-gradient-to-br from-blue-500/20 to-violet-500/20 text-violet-500 dark:text-violet-300";
    case "downloads":
      return "bg-gradient-to-br from-indigo-500/20 to-blue-500/20 text-indigo-500 dark:text-indigo-300";
    case "community":
      return "bg-gradient-to-br from-fuchsia-500/20 to-violet-500/20 text-fuchsia-500 dark:text-fuchsia-300";
    case "news":
      return "bg-amber-500/15 text-amber-500";
    case "premium":
      return "bg-gradient-to-br from-amber-400/20 to-orange-500/20 text-amber-500";
    case "security":
      return "bg-rose-500/15 text-rose-500";
    default:
      return "bg-secondary text-muted-foreground";
  }
}

/** The action phrase for a notification type (used after the actor name(s)). */
export function verbFor(type: NotificationType): string {
  switch (type) {
    case "follow":
      return "started following you";
    case "like":
      return "liked your post";
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
    type !== "system"
  );
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
