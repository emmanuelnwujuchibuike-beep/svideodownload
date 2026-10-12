import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

// the icon map pulls in one JSX glyph; this suite tests words and links, not icons
vi.mock("@/components/brand/wow-icon", () => ({ WowSolid: () => null, WowOutline: () => null }));

import type { NotificationItem } from "@/lib/social/notifications";

import { bannerFor } from "./banner";

const base: NotificationItem = {
  id: "n1",
  type: "like",
  read: false,
  createdAt: new Date().toISOString(),
  actor: { id: "a1", handle: "metrobooming", displayName: "Metrobooming", avatarUrl: "https://cdn/a.jpg" },
  postId: "p1",
  postTitle: null,
  thumbUrl: "https://cdn/t.jpg",
  postGone: false,
  commentText: null,
  conversationId: null,
  broadcast: null,
  content: null,
  href: "/p/p1",
  pinned: false,
  archived: false,
  priority: "medium",
  delivery: "pushed",
  deliveryReason: null,
} as unknown as NotificationItem;

// Notifications Part 1 brief (2026-10-12): Instagram-style incoming banner
describe("bannerFor — the incoming banner's words", () => {
  it("a person: real avatar, name on its own line, a sentence, the post thumbnail", () => {
    const b = bannerFor(base)!;
    expect(b.name).toBe("Metrobooming");
    expect(b.avatarUrl).toBe("https://cdn/a.jpg");
    expect(b.system).toBe(false);
    expect(b.thumb).toBe("https://cdn/t.jpg");
    expect(b.text.charAt(0)).toBe(b.text.charAt(0).toUpperCase());
  });
  it("a comment quotes what was said", () => {
    const b = bannerFor({ ...base, type: "comment", commentText: "This looks amazing!" } as NotificationItem)!;
    expect(b.text).toContain("“This looks amazing!”");
  });
  it("a friend request stays longer and offers View request", () => {
    const b = bannerFor({ ...base, type: "friend_request", postId: null, thumbUrl: null } as NotificationItem)!;
    expect(b.action).toBe("View request");
    expect(b.sticky).toBe(true);
  });
  it("held by Do Not Disturb, a focus mode or quiet hours → no banner", () => {
    expect(bannerFor({ ...base, delivery: "held" } as NotificationItem)).toBeNull();
  });
  it("a deleted post shows no thumbnail", () => {
    expect(bannerFor({ ...base, postGone: true } as NotificationItem)!.thumb).toBeNull();
  });
  it("a system notice wears the Frenz logo, never a stranger's face", () => {
    const b = bannerFor({ ...base, type: "withdrawal_update", actor: null, content: { title: "Withdrawal sent", body: "$20 is on its way." } } as unknown as NotificationItem)!;
    expect(b.system).toBe(true);
    expect(b.name).toBe("Withdrawal sent");
  });
});

describe("banner behaviour, read from the component", () => {
  const src = readFileSync("features/notifications/live-toast.tsx", "utf8");
  it("never the same notification twice, never the history, no animation library", () => {
    expect(src).toContain("if (seen.current.includes(b.key)) return;");
    expect(src).toContain('fetch("/api/notifications?limit=5"');
    expect(src).not.toContain("loadFlatNotifications");
    expect(src).not.toContain("framer-motion");
  });
  it("no banner for the conversation already on screen; reduced motion respected", () => {
    expect(src).toContain("if (window.location.pathname === `/messages/${row.conversation_id}`) return;");
    expect(src).toContain("motion-reduce:transition-opacity");
  });
});
