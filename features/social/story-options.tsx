"use client";

import { Download, Eye, Flag, Loader2, MessageCircle, Repeat2, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { MediaActionSheet, SheetGroup, SheetRow } from "@/features/feed/media-action-sheet";
import { toast } from "@/features/ui/toast";
import type { StoryGroup } from "@/lib/social/stories";

const SendToChatSheet = dynamic(() => import("@/features/downloads/send-to-chat-sheet").then((m) => m.SendToChatSheet), { ssr: false });
const ReportSheet = dynamic(() => import("@/features/social/report-sheet").then((m) => m.ReportSheet), { ssr: false });

type Story = StoryGroup["stories"][number];

/**
 * The story's ••• options — the same shape as the History viewer's menu
 * (owner, 2026-10-08: "add story options like history options where user can
 * delete, send story to private chat, and all").
 *
 *   your own story   Send to chat · Save to device · Seen by · Delete story
 *   someone else's   Send to chat · Reshare to your story (only when the author
 *                    allows resharing) · Report
 *
 * Sending someone else's story follows the author's own reshare switch: a
 * story they did not open for resharing is not forwarded either.
 * Delete asks twice inside the sheet (the viewer has no confirm dialog).
 */
export function StoryOptions({
  open,
  onClose,
  story,
  group,
  isOwn,
  allowShare,
  onSeenBy,
  onReshare,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  story: Story;
  group: StoryGroup;
  isOwn: boolean;
  allowShare: boolean;
  onSeenBy: () => void;
  onReshare: () => void;
  onDeleted: (storyId: string) => void;
}) {
  const [sendOpen, setSendOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const close = () => {
    setConfirmDelete(false);
    onClose();
  };

  const title = story.caption?.trim() || `${group.displayName}'s story`;

  const saveToDevice = async () => {
    close();
    const { startDownload } = await import("@/features/downloads/manager");
    const id = startDownload({
      url: story.mediaUrl,
      directUrl: story.mediaUrl,
      formatId: "frenz-story",
      kind: story.mediaKind,
      title,
      thumbnail: story.mediaKind === "image" ? story.mediaUrl : (story.thumbnailUrl ?? null),
      platform: "generic",
      platformName: "Frenz Stories",
      qualityLabel: "Original",
    });
    if (!id) toast("Your library is full. Free some space to save this story.", "error");
  };

  const remove = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      const r = await fetch(`/api/stories/${encodeURIComponent(story.id)}`, { method: "DELETE" });
      if (!r.ok) throw new Error(String(r.status));
      toast("Story deleted", "success");
      close();
      onDeleted(story.id);
    } catch {
      toast("Couldn't delete the story. Try again.", "error");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <MediaActionSheet open={open} onClose={close} label="Story options">
        <SheetGroup>
          {isOwn || allowShare ? (
            <SheetRow
              icon={MessageCircle}
              label="Send to chat"
              onClick={() => {
                close();
                setSendOpen(true);
              }}
            />
          ) : null}
          {isOwn ? <SheetRow icon={Download} label="Save to device" onClick={() => void saveToDevice()} /> : null}
          {isOwn ? (
            <SheetRow
              icon={Eye}
              label="Seen by"
              onClick={() => {
                close();
                onSeenBy();
              }}
            />
          ) : allowShare ? (
            <SheetRow
              icon={Repeat2}
              label="Reshare to your story"
              onClick={() => {
                close();
                onReshare();
              }}
            />
          ) : null}
        </SheetGroup>
        <SheetGroup>
          {isOwn ? (
            <SheetRow icon={deleting ? Loader2 : Trash2} label={confirmDelete ? "Tap again to delete" : "Delete story"} onClick={() => void remove()} danger />
          ) : (
            <SheetRow
              icon={Flag}
              label={`Report ${group.displayName}`}
              onClick={() => {
                close();
                setReportOpen(true);
              }}
              danger
            />
          )}
        </SheetGroup>
      </MediaActionSheet>

      {sendOpen ? (
        <SendToChatSheet
          open={sendOpen}
          onClose={() => setSendOpen(false)}
          blob={null}
          // straight from the media CDN, only when a chat is picked
          resolveBlob={async () => fetch(story.mediaUrl).then((r) => (r.ok ? r.blob() : null)).catch(() => null)}
          kind={story.mediaKind}
          title={title}
          thumbnailUrl={story.mediaKind === "image" ? story.mediaUrl : (story.thumbnailUrl ?? null)}
        />
      ) : null}
      {reportOpen ? <ReportSheet targetType="user" targetId={group.userId} open={reportOpen} onClose={() => setReportOpen(false)} /> : null}
    </>
  );
}
