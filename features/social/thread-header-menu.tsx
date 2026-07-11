"use client";

import { MoreHorizontal } from "lucide-react";
import { useState } from "react";

import { GroupMembersSheet } from "@/features/social/group-members-sheet";
import type { MemberRole } from "@/lib/social/messages";

/** The "…" button on a group thread header — opens the Group info sheet. */
export function ThreadHeaderMenu({
  conversationId,
  viewerId,
  viewerRole,
  initialTitle,
}: {
  conversationId: string;
  viewerId: string;
  viewerRole: MemberRole | null;
  initialTitle: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Group info"
        className="relative ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground"
      >
        <MoreHorizontal className="h-5 w-5" />
      </button>
      <GroupMembersSheet
        conversationId={conversationId}
        open={open}
        onClose={() => setOpen(false)}
        viewerId={viewerId}
        viewerRole={viewerRole}
        initialTitle={initialTitle}
      />
    </>
  );
}
