import type { NotificationCategory, NotificationType } from "@/lib/platform/notifications-registry";

/**
 * The Activity Center's everyday tabs (premium notification brief, 2026-10-12):
 *
 *   Social    follows, friend requests, likes, comments, mentions, replies, members
 *   Content   new posts, reels, stories and AI videos from people you asked to hear from, and news
 *   Messages  chats
 *   Earnings  credits, referral rewards, deposits, withdrawals, payments, subscriptions, new paid members
 *
 * Everything else keeps the registry's own category (Downloads, Communities,
 * Security, System), so no notification is ever without a home. A view over the
 * registry, not a second registry: it reads only the type and its category.
 */
export type SmartCategory = "social" | "content" | "messages" | "earnings" | Exclude<NotificationCategory, "social" | "news" | "premium">;

export function smartCategoryOf(type: NotificationType, category: NotificationCategory): SmartCategory {
  if (type.startsWith("message")) return "messages";
  if (category === "news") return "content";
  // a new paying member is money in, so it belongs with earnings; a free join stays social
  if (category === "premium" || type === "membership_update") return "earnings";
  if (category === "social") return "social";
  return category;
}

export const SMART_CATEGORY_ORDER: SmartCategory[] = ["social", "content", "messages", "earnings", "downloads", "community", "security", "system"];

export const SMART_CATEGORY_LABEL: Record<SmartCategory, string> = {
  social: "Social",
  content: "Content",
  messages: "Messages",
  earnings: "Earnings",
  downloads: "Downloads",
  community: "Communities",
  security: "Security",
  system: "System",
};
