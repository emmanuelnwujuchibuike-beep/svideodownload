import type { MessageCircle } from "lucide-react";

import { hrefFor, iconFor, isActorType, tintFor, verbFor } from "@/features/notifications/meta";
import { categoryForType } from "@/lib/platform/notifications-registry";
import type { NotificationItem } from "@/lib/social/notifications";

/**
 * The incoming banner’s words for one notification row (Notifications Part 1, 2026-10-12) —
 * the same facts the Activity Center card shows. Plain .ts so it is tested without a JSX
 * transform; drawn by live-toast.tsx.
 */
export interface Banner {
  key: string;
  name: string;
  text: string;
  avatarUrl: string | null;
  /** a system notification wears the Frenz logo instead of a person */
  system: boolean;
  thumb: string | null;
  href: string;
  action: string | null;
  sticky: boolean;
  Icon: typeof MessageCircle;
  tint: string;
}


const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** One notification row → the banner's words, the same facts the Activity Center card shows. */
export function bannerFor(n: NotificationItem): Banner | null {
  if (n.delivery === "held") return null;
  const Icon = iconFor(n.type);
  const tint = tintFor(categoryForType(n.type), n.type);
  const base = { key: n.id, thumb: n.postGone ? null : n.thumbUrl, href: hrefFor(n), Icon, tint };
  if (n.broadcast) {
    return { ...base, name: n.broadcast.title, text: `${n.broadcast.sponsored ? "Ad · " : ""}${n.broadcast.body ?? ""}`.trim(), avatarUrl: null, system: true, action: null, sticky: false };
  }
  const person = isActorType(n.type) && !!n.actor;
  if (!person) {
    const title = n.content?.title ?? "Frenz";
    return { ...base, name: title, text: n.content?.body ?? sentence(verbFor(n.type)), avatarUrl: null, system: true, action: null, sticky: false };
  }
  const verb = sentence(verbFor(n.type));
  const text = n.commentText ? `${verb.replace(/\.$/, "")}: “${clip(n.commentText, 80)}”` : verb;
  const request = n.type === "friend_request";
  return { ...base, name: n.actor!.displayName, text, avatarUrl: n.actor!.avatarUrl ?? null, system: false, action: request ? "View request" : null, sticky: request };
}
