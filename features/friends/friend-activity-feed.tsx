import { Activity, Heart, ImageIcon, UserPlus, Video } from "lucide-react";
import Link from "next/link";

import { ModuleIconBadge } from "@/components/icons/module-icon-badge";
import { timeAgo } from "@/features/notifications/meta";
import type { FriendActivityEntry } from "@/lib/social/friend-activity";

const ICONS: Record<FriendActivityEntry["kind"], typeof Heart> = {
  post: ImageIcon,
  story: Activity,
  like: Heart,
  follow: UserPlus,
};

/**
 * Friend Activity, relocated here from Home (owner ask, 2026-07-11: "remove
 * friends activity entirely from homepage so users only use the friends
 * page friends activity to avoid clutter"). This is a plain Server
 * Component, not a client one — the Home version's inline on/off switch
 * (tied to Home Module preferences) doesn't apply on a page whose entire
 * purpose IS friends, so there's nothing to toggle here; it's always shown.
 */
export function FriendActivityFeed({ items }: { items: FriendActivityEntry[] }) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-foreground">
        <ModuleIconBadge icon={Activity} /> Friend Activity
      </h2>
      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
          No recent activity from your friends yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item, i) => (
            <FriendActivityRow key={`${item.kind}-${item.actor.id}-${item.postId ?? item.target?.id ?? i}`} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

function FriendActivityRow({ item }: { item: FriendActivityEntry }) {
  const Icon = item.kind === "post" && item.mediaKind === "video" ? Video : ICONS[item.kind];
  const href =
    item.kind === "story"
      ? `/u/${item.actor.handle}`
      : item.kind === "follow"
        ? `/u/${item.target?.handle}`
        : `/p/${item.postId}`;

  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card/60 px-3.5 py-2.5 transition hover:bg-card"
      >
        <Avatar url={item.actor.avatarUrl} name={item.actor.displayName} />
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <Icon className="h-3 w-3" />
        </span>
        <span className="min-w-0 flex-1 text-sm">
          <strong className="font-semibold">{item.actor.displayName}</strong>{" "}
          <span className="text-muted-foreground">{copyFor(item)}</span>
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(item.createdAt)}</span>
      </Link>
    </li>
  );
}

function copyFor(item: FriendActivityEntry): string {
  switch (item.kind) {
    case "post":
      return `posted${item.mediaKind === "video" ? " a video" : ""}${item.postTitle ? ` · ${item.postTitle}` : ""}`;
    case "story":
      return "added a story";
    case "like":
      return `liked your post${item.postTitle ? ` · ${item.postTitle}` : ""}`;
    case "follow":
      return `started following ${item.target?.displayName ?? "someone new"}`;
  }
}

function Avatar({ url, name }: { url: string | null; name: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-border" />;
  }
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-xs font-bold text-white">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
