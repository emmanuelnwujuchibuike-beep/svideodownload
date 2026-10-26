"use client";

import { Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";

import { toast } from "@/features/ui/toast";
import { haptic } from "@/lib/motion/haptics";
import type { StoryAudience, StoryGroup } from "@/lib/social/stories";
import { cn } from "@/lib/utils";

const SendToChatSheet = dynamic(() => import("@/features/downloads/send-to-chat-sheet").then((m) => m.SendToChatSheet), { ssr: false });
const ReportSheet = dynamic(() => import("@/features/social/report-sheet").then((m) => m.ReportSheet), { ssr: false });

type Story = StoryGroup["stories"][number];

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  STORY OPTIONS — the ••• sheet (owner, 2026-10-08), drawn to the Story Viewer
 *  design (design/Frenz-Story-Viewer-design.zip, StoryOptions.dc.html, 2026-10-26)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   your own story   Save video · Highlight · Copy link
 *                    Allow resharing (0081) · Allow replies (0288) · Who can see this
 *                    Delete story (asks twice — the viewer has no confirm dialog)
 *   someone else's   Send to chat · Reshare (only when the author allows resharing)
 *                    Report
 *
 * The switches are the design's "iOS-style toggles" (its README). Each writes the
 * real setting at once and rolls back if the server refuses (the viewer owns
 * them, so the reply box and the reshare button follow without a refetch).
 *
 *   Highlight     keeping a story past its 24 hours needs a place on the profile
 *                 and an exception in the story clean-up (Stories Part 1). Not
 *                 built — the tile says "coming soon" rather than pretend.
 *   Copy link     there is no public page for a story (they are private to their
 *                 audience), so it copies the story's own media link — yours, to
 *                 share as you choose; it stops working when the story ends.
 *   Who can see   a story reaches whoever your profile reaches (Stories Part 2),
 *                 so this shows that and opens your privacy settings.
 */

const AUDIENCE_LABEL: Record<StoryAudience, string> = {
  public: "Everyone",
  followers: "Your followers",
  private: "Only people you chat with",
};

export function StoryOptions({
  open,
  onClose,
  story,
  group,
  isOwn,
  allowShare,
  allowReplies = true,
  onToggleReshare,
  onToggleReplies,
  onSeenBy: _onSeenBy,
  onReshare,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  story: Story;
  group: StoryGroup;
  isOwn: boolean;
  allowShare: boolean;
  allowReplies?: boolean;
  onToggleReshare?: () => void;
  onToggleReplies?: () => void;
  /** kept for callers; "Seen by" lives on the viewer's own bottom bar in the design */
  onSeenBy?: () => void;
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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

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

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(story.mediaUrl);
      toast("Link copied", "success");
    } catch {
      toast("Couldn't copy the link.", "error");
    }
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

  const tiles: { label: string; icon: React.ReactNode; onClick: () => void }[] = isOwn
    ? [
        { label: story.mediaKind === "video" ? "Save video" : "Save photo", icon: <IconSave />, onClick: () => void saveToDevice() },
        { label: "Highlight", icon: <IconHighlight />, onClick: () => toast("Highlights are coming soon.", "info") },
        { label: "Copy link", icon: <IconLink />, onClick: () => void copyLink() },
      ]
    : allowShare
      ? [
          {
            label: "Send to chat",
            icon: <IconSend />,
            onClick: () => {
              close();
              setSendOpen(true);
            },
          },
          {
            label: "Reshare",
            icon: <IconReshare />,
            onClick: () => {
              close();
              onReshare();
            },
          },
        ]
      : [];

  return (
    <>
      {open ? (
        <div className="frenz-ui fixed inset-0 z-[110]" role="presentation">
          <button type="button" aria-label="Close" onClick={close} className="absolute inset-0 bg-[rgba(5,4,15,0.5)] animate-in fade-in duration-200" />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="story-options-title"
            className="absolute inset-x-0 bottom-0 mx-auto flex max-w-lg flex-col gap-3.5 rounded-t-[32px] border-t border-white/90 bg-[rgba(246,245,251,0.86)] px-4 pb-[calc(1.875rem+env(safe-area-inset-bottom))] pt-2 text-[#12111A] shadow-[0_-20px_50px_-20px_rgba(0,0,0,0.55)] backdrop-blur backdrop-saturate-[1.7] animate-in slide-in-from-bottom duration-300"
          >
            <span aria-hidden className="h-[5px] w-10 self-center rounded-full bg-[rgba(18,17,26,0.18)]" />
            <div className="flex items-center justify-between">
              <h2 id="story-options-title" className="m-0 font-heading text-[19px] font-bold tracking-[-0.4px]">
                Story options
              </h2>
              <button type="button" onClick={close} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full bg-[rgba(18,17,26,0.07)] text-[#4A4760] transition active:scale-95">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden>
                  <path d="M6 6l12 12" />
                  <path d="M18 6L6 18" />
                </svg>
              </button>
            </div>

            {tiles.length > 0 ? (
              <div className={cn("grid gap-2.5", tiles.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
                {tiles.map((t) => (
                  <button
                    key={t.label}
                    type="button"
                    onClick={() => {
                      haptic("light");
                      t.onClick();
                    }}
                    className="flex h-[84px] flex-col items-center justify-center gap-2 rounded-[20px] bg-white text-[13px] font-bold text-[#12111A] shadow-[0_1px_2px_rgba(30,20,80,0.06)] transition active:scale-[0.97]"
                  >
                    {t.icon}
                    {t.label}
                  </button>
                ))}
              </div>
            ) : null}

            {isOwn ? (
              <div className="overflow-hidden rounded-[20px] bg-white shadow-[0_1px_2px_rgba(30,20,80,0.06)]">
                <SwitchRow icon={<IconReshare size={17} />} label="Allow resharing" detail="People can add this to their story" on={allowShare} onToggle={onToggleReshare} />
                <SwitchRow icon={<IconReply />} label="Allow replies" detail="Everyone who can see it" on={allowReplies} onToggle={onToggleReplies} divider />
                <Link href="/account/privacy" prefetch={false} className="flex items-center gap-3 border-t border-[#F0EEF8] px-3.5 py-3 text-[#12111A]">
                  <RowIcon>
                    <IconPeople />
                  </RowIcon>
                  <span className="flex min-w-0 flex-1 flex-col gap-px">
                    <span className="text-[15px] font-bold">Who can see this</span>
                    <span className="truncate text-[12px] text-[#5A5770]">{AUDIENCE_LABEL[group.audience ?? "public"]}</span>
                  </span>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8A879C" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </Link>
              </div>
            ) : null}

            {isOwn ? (
              <button
                type="button"
                onClick={() => void remove()}
                disabled={deleting}
                className="flex h-[54px] items-center justify-center gap-2 rounded-[20px] bg-white text-[15px] font-extrabold text-[#B4233F] shadow-[0_1px_2px_rgba(30,20,80,0.06)] transition active:scale-[0.99] disabled:opacity-60"
              >
                {deleting ? <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden /> : <IconTrash />}
                {confirmDelete ? "Tap again to delete" : "Delete story"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  close();
                  setReportOpen(true);
                }}
                className="flex h-[54px] items-center justify-center gap-2 rounded-[20px] bg-white text-[15px] font-extrabold text-[#B4233F] shadow-[0_1px_2px_rgba(30,20,80,0.06)] transition active:scale-[0.99]"
              >
                <IconFlag />
                Report {group.displayName}
              </button>
            )}
          </section>
        </div>
      ) : null}

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

function RowIcon({ children }: { children: React.ReactNode }) {
  return (
    <span aria-hidden className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-[#EEEBFD] text-[#3D2BB8]">
      {children}
    </span>
  );
}

/** The design's switch row with an iOS-style toggle (its README) — moved by transform, never by `left`. */
function SwitchRow({ icon, label, detail, on, onToggle, divider }: { icon: React.ReactNode; label: string; detail: string; on: boolean; onToggle?: () => void; divider?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onToggle} className={cn("flex w-full items-center gap-3 px-3.5 py-3 text-left", divider && "border-t border-[#F0EEF8]")}>
      <RowIcon>{icon}</RowIcon>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="text-[15px] font-bold">{label}</span>
        <span className="truncate text-[12px] text-[#5A5770]">{detail}</span>
      </span>
      <span aria-hidden className={cn("relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200", on ? "bg-[#5B3FD8]" : "bg-[#E4E2EC]")}>
        <span className={cn("absolute left-0.5 top-0.5 h-[27px] w-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.16)] transition-transform duration-200", on ? "translate-x-5" : "translate-x-0")} />
      </span>
    </button>
  );
}

const S = { fill: "none", stroke: "#3D2BB8", strokeWidth: 2.1, strokeLinecap: "round", strokeLinejoin: "round" } as const;
function IconSave() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...S} aria-hidden>
      <path d="M12 4v12" />
      <path d="M6 11l6 6 6-6" />
      <path d="M5 20h14" />
    </svg>
  );
}
function IconHighlight() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...S} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16.5s-4-2.4-4-5.3A2.2 2.2 0 0 1 12 10a2.2 2.2 0 0 1 4 1.2c0 2.9-4 5.3-4 5.3z" />
    </svg>
  );
}
function IconLink() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...S} aria-hidden>
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </svg>
  );
}
function IconSend() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...S} aria-hidden>
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4z" />
    </svg>
  );
}
function IconReshare({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...S} stroke="currentColor" strokeWidth={2.2} aria-hidden className={size === 22 ? "text-[#3D2BB8]" : undefined}>
      <path d="M17 2l3 3-3 3" />
      <path d="M4 11V9a4 4 0 0 1 4-4h12" />
      <path d="M7 22l-3-3 3-3" />
      <path d="M20 13v2a4 4 0 0 1-4 4H4" />
    </svg>
  );
}
function IconReply() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" {...S} stroke="currentColor" strokeWidth={2.2} aria-hidden>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z" />
    </svg>
  );
}
function IconPeople() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" {...S} stroke="currentColor" strokeWidth={2.2} aria-hidden>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7" />
      <path d="M18 14a6 6 0 0 1 3.5 6" />
    </svg>
  );
}
function IconTrash() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M9 7V4h6v3" />
    </svg>
  );
}
function IconFlag() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 21V4" />
      <path d="M5 4h11l-2 4 2 4H5" />
    </svg>
  );
}
