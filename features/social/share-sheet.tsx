"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Link2, Mail, MessageSquareText, QrCode, Repeat2, Search, Send, Share2, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { GlassSheetShell } from "@/features/ui/glass-sheet-shell";
import { loadGroups, loadPeople, PeoplePickerGrid, type Group, type Person } from "@/features/social/people-picker";
import { toast } from "@/features/ui/toast";
import { haptic, hapticPattern } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * The Share sheet — the paper-plane experience (owner spec): send a post to
 * friends OR groups as DMs (multi-select + optional message), copy the link,
 * generate a QR code, hand off to the OS share sheet, or repost. Chrome is the
 * shared `GlassSheetShell` (Part 6: previously its own bespoke wrapper with no
 * drag/resize and thinner haptics than reshare-sheet.tsx — now the exact same
 * premium shell comments use, not a second near-identical implementation).
 */

export function ShareSheet({
  postId,
  title,
  open,
  onClose,
  onRepost,
  onQrCode,
}: {
  postId: string;
  title?: string;
  open: boolean;
  onClose: () => void;
  /** When provided, a Repost row appears (opens the existing repost flow). */
  onRepost?: () => void;
  /** When provided, a QR Code row appears (opens a QR sheet for this post's link). */
  onQrCode?: () => void;
}) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [sentCount, setSentCount] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Load recipients when the sheet first opens (cached for reopens).
  const loadDestinations = () => {
    if (!people) void loadPeople().then(setPeople);
    if (!groups) void loadGroups().then(setGroups);
  };

  // Fresh state per open.
  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setSelectedGroups(new Set());
    setNote("");
    setQuery("");
    setSentCount(null);
  }, [open]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleGroup = (id: string) => {
    haptic("light");
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalSelected = selected.size + selectedGroups.size;
  const postUrl = () => `${window.location.origin}/p/${postId}`;

  // Bumps posts.shares_count via the existing whitelisted counter RPC — every
  // OTHER "Share" entry point in the app already did this via its own bare
  // navigator.share() fork; the rich sheet itself never did (confirmed: no
  // event/counter call anywhere in its old copyLink/shareExternal/send), so
  // unifying every surface onto this ONE sheet would have silently zeroed
  // out share counting everywhere instead of fixing the fork. One bump per
  // successful ACTION, not per recipient. `kind` also ledgers a share_events
  // row (Part 6 tranche 3's Share Journey™ breakdown) for signed-in callers —
  // omitted for the DM/group send() path below, which already writes its own
  // properly-attributed row (with real recipient ids) server-side.
  const bumpShareCounter = (kind?: "copy_link" | "os_share" | "email" | "sms") => {
    fetch(`/api/posts/${postId}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "share", kind }),
    }).catch(() => {});
  };

  const send = async () => {
    if (totalSelected === 0 || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/posts/${postId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: [...selected], toGroups: [...selectedGroups], note: note.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast(json.error ?? "Couldn't send.", "error");
        return;
      }
      setSentCount(json.sent as number);
      // Throttled by the graded antispam check (lib/social/share/antispam.ts)
      // — still delivered (the recipients chose to receive it), but doesn't
      // count toward the public shares total. See the route's own comment.
      if (!json.throttled) bumpShareCounter();
      hapticPattern([10, 40, 10]);
      setTimeout(onClose, 950);
    } catch {
      toast("Network error — try again.", "error");
    } finally {
      setSending(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(postUrl());
      toast("Link copied successfully.", "success");
      bumpShareCounter("copy_link");
      onClose();
    } catch {
      toast("Couldn't copy the link.", "error");
    }
  };

  const shareExternal = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: title || "Frenz", url: postUrl() });
        bumpShareCounter("os_share");
        onClose();
      } else {
        await copyLink();
      }
    } catch {
      /* user closed the OS sheet */
    }
  };

  // Email / SMS — mailto:/sms: links need no new infra (the OS handles the
  // actual send, same as it already does for shareExternal above); bare
  // <a> navigation rather than window.location so a popup/tracking blocker
  // can't silently swallow it.
  const shareEmail = () => {
    bumpShareCounter("email");
    onClose();
    const a = document.createElement("a");
    a.href = `mailto:?subject=${encodeURIComponent(title || "Check this out on Frenz")}&body=${encodeURIComponent(postUrl())}`;
    a.click();
  };
  const shareSms = () => {
    bumpShareCounter("sms");
    onClose();
    const a = document.createElement("a");
    // `?body=` (not `&body=`) is the form that works across both iOS and
    // Android SMS handlers — the one genuinely cross-platform sms: shape.
    a.href = `sms:?body=${encodeURIComponent(`${title ? `${title} ` : ""}${postUrl()}`)}`;
    a.click();
  };

  return (
    <GlassSheetShell
      open={open}
      onClose={onClose}
      onOpen={loadDestinations}
      title="Share"
      defaultHeightVh={62}
      overlay={
        sentCount !== null ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex h-full flex-col items-center justify-center gap-3 bg-card"
          >
            <motion.span
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 380, damping: 20 }}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-brand text-white shadow-lg"
            >
              <Check className="h-8 w-8" strokeWidth={3} />
            </motion.span>
            <p className="text-sm font-semibold">
              Sent to {sentCount} {sentCount === 1 ? "destination" : "destinations"}
            </p>
          </motion.div>
        ) : null
      }
    >
      {/* Search */}
      <div className="pb-3">
        <div className="flex items-center gap-2 rounded-2xl bg-secondary px-3.5 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people and groups"
            aria-label="Search people and groups"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Groups — Part 6 fix: previously ShareSheet had no way to address a
          group conversation at all (only 1:1), unlike reshare's picker. Own
          small row rather than forcing group shapes through PeoplePickerGrid,
          which CreateGroupSheet also reuses for a person-only picker. */}
      {groups && groups.length > 0 ? (
        <div className="mb-2 flex gap-3 overflow-x-auto pb-2">
          {groups
            .filter((g) => !query.trim() || g.title.toLowerCase().includes(query.trim().toLowerCase()))
            .map((g) => {
              const on = selectedGroups.has(g.id);
              return (
                <button key={g.id} type="button" onClick={() => toggleGroup(g.id)} aria-pressed={on} className="flex shrink-0 flex-col items-center gap-1.5">
                  <span className={cn("relative rounded-full p-[2px] transition", on ? "bg-gradient-to-br from-blue-600 to-violet-600" : "bg-transparent")}>
                    {g.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={g.avatarUrl} alt="" className="h-14 w-14 rounded-full object-cover ring-2 ring-card" />
                    ) : (
                      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-white ring-2 ring-card">
                        <Users className="h-6 w-6" />
                      </span>
                    )}
                    {on ? (
                      <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-white ring-2 ring-card">
                        <Check className="h-3 w-3" strokeWidth={3.5} />
                      </span>
                    ) : null}
                  </span>
                  <span className="max-w-[4.5rem] truncate text-[11px] font-medium text-muted-foreground">{g.title}</span>
                </button>
              );
            })}
        </div>
      ) : null}

      {/* People */}
      <div className="max-h-56 overflow-y-auto pb-2">
        <PeoplePickerGrid
          people={people}
          query={query}
          selected={selected}
          onToggle={toggle}
          emptyHint="Add friends to send posts privately."
        />
      </div>

      {/* Note + Send (appears once something is selected) */}
      <AnimatePresence initial={false}>
        {totalSelected > 0 ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-border/60"
          >
            <div className="flex items-center gap-2 py-3">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 500))}
                placeholder="Write a message…"
                aria-label="Message"
                className="w-full rounded-2xl bg-secondary px-3.5 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
              />
              <button
                type="button"
                onClick={send}
                disabled={sending}
                className="bg-brand flex shrink-0 items-center gap-1.5 rounded-2xl px-4 py-2.5 text-sm font-semibold text-white shadow-md transition active:scale-95 disabled:opacity-60"
              >
                <Send className="h-4 w-4" /> Send{totalSelected > 1 ? ` · ${totalSelected}` : ""}
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Other ways to share */}
      <div className="grid grid-cols-3 gap-2 border-t border-border/60 py-4">
        <SheetAction icon={Link2} label="Copy link" onClick={copyLink} />
        <SheetAction icon={Share2} label="Share via…" onClick={shareExternal} />
        <SheetAction icon={Mail} label="Email" onClick={shareEmail} />
        <SheetAction icon={MessageSquareText} label="Text (SMS)" onClick={shareSms} />
        {onQrCode ? <SheetAction icon={QrCode} label="QR code" onClick={() => { onClose(); onQrCode(); }} /> : null}
        {onRepost ? (
          <SheetAction
            icon={Repeat2}
            label="Repost"
            onClick={() => {
              onClose();
              onRepost();
            }}
          />
        ) : null}
      </div>
    </GlassSheetShell>
  );
}

function SheetAction({
  icon: Icon,
  label,
  onClick,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-2xl border border-border/60 bg-secondary/40 px-2 py-3 text-xs font-semibold text-muted-foreground transition hover:bg-secondary hover:text-foreground active:scale-95",
        className,
      )}
    >
      <Icon className="h-5 w-5" />
      {label}
    </button>
  );
}
