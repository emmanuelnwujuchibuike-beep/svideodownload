"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Crown, LogOut, MoreHorizontal, Shield, UserMinus, UserPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { loadPeople, PeoplePickerGrid, type Person } from "@/features/social/people-picker";
import { toast } from "@/features/ui/toast";
import { GROUP_TITLE_MAX, MAX_GROUP_MEMBERS } from "@/lib/social/message-meta";
import type { ConversationMember, MemberRole } from "@/lib/social/messages";
import { cn } from "@/lib/utils";

/** Group info sheet: roster, rename (owner/admin), add members, leave, per-member role changes. */
export function GroupMembersSheet({
  conversationId,
  open,
  onClose,
  viewerId,
  viewerRole,
  initialTitle,
}: {
  conversationId: string;
  open: boolean;
  onClose: () => void;
  viewerId: string;
  viewerRole: MemberRole | null;
  initialTitle: string | null;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const router = useRouter();
  const [members, setMembers] = useState<ConversationMember[] | null>(null);
  const [title, setTitle] = useState(initialTitle ?? "");
  const [savingTitle, setSavingTitle] = useState(false);
  const [openRowMenu, setOpenRowMenu] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const canManage = viewerRole === "owner" || viewerRole === "admin";
  const isOwner = viewerRole === "owner";

  useEffect(() => {
    if (!open) return;
    setTitle(initialTitle ?? "");
    setAdding(false);
    setSelected(new Set());
    void fetch(`/api/conversations/${conversationId}/members`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMembers(d?.members ?? []))
      .catch(() => setMembers([]));
  }, [open, conversationId, initialTitle]);

  useEffect(() => {
    if (!adding || people) return;
    let cancelled = false;
    void loadPeople().then((p) => {
      if (!cancelled) setPeople(p);
    });
    return () => {
      cancelled = true;
    };
  }, [adding, people]);

  const existingIds = new Set((members ?? []).map((m) => m.id));
  const invitable = (people ?? []).filter((p) => !existingIds.has(p.id));

  const saveTitle = async () => {
    const clean = title.trim();
    if (!clean || savingTitle) return;
    setSavingTitle(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: clean }),
      });
      if (!res.ok) toast("Couldn't rename the group.", "error");
      else router.refresh();
    } finally {
      setSavingTitle(false);
    }
  };

  const addSelected = async () => {
    if (selected.size === 0) return;
    const res = await fetch(`/api/conversations/${conversationId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIds: [...selected] }),
    });
    if (!res.ok) {
      const j = await res.json();
      toast(j.error ?? "Couldn't add everyone selected.", "error");
      return;
    }
    setAdding(false);
    setSelected(new Set());
    const fresh = await fetch(`/api/conversations/${conversationId}/members`).then((r) => (r.ok ? r.json() : null));
    if (fresh) setMembers(fresh.members);
  };

  const removeMember = async (id: string) => {
    setOpenRowMenu(null);
    const res = await fetch(`/api/conversations/${conversationId}/members/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json();
      toast(j.error ?? "Couldn't remove.", "error");
      return;
    }
    setMembers((m) => (m ? m.filter((x) => x.id !== id) : m));
  };

  const changeRole = async (id: string, role: "admin" | "member" | "owner") => {
    setOpenRowMenu(null);
    const res = await fetch(`/api/conversations/${conversationId}/members/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const j = await res.json();
      toast(j.error ?? "Couldn't update role.", "error");
      return;
    }
    const fresh = await fetch(`/api/conversations/${conversationId}/members`).then((r) => (r.ok ? r.json() : null));
    if (fresh) setMembers(fresh.members);
    if (role === "owner") router.refresh();
  };

  const leave = async () => {
    const res = await fetch(`/api/conversations/${conversationId}/members/${viewerId}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json();
      toast(j.error ?? "Couldn't leave.", "error");
      return;
    }
    onClose();
    router.push("/messages");
    router.refresh();
  };

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[110]" role="dialog" aria-modal="true" aria-label="Group info">
          <motion.button
            type="button"
            aria-label="Close"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 420, damping: 42 }}
            className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[86dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-border/60 bg-card shadow-2xl sm:bottom-6 sm:rounded-3xl"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="flex items-center justify-between px-5 pb-2 pt-4">
              <h2 className="text-base font-bold tracking-tight">Group info</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground transition hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {canManage ? (
              <div className="flex items-center gap-2 px-5 pb-3">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value.slice(0, GROUP_TITLE_MAX))}
                  aria-label="Group name"
                  className="w-full rounded-2xl bg-secondary px-3.5 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
                />
                {title.trim() !== (initialTitle ?? "") ? (
                  <button
                    type="button"
                    onClick={saveTitle}
                    disabled={savingTitle || !title.trim()}
                    aria-label="Save name"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-white disabled:opacity-50"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="px-5 pb-3 text-sm font-semibold">{initialTitle ?? "Group"}</p>
            )}

            <div className="flex-1 overflow-y-auto px-5 pb-3">
              {canManage ? (
                adding ? (
                  <div className="mb-3 rounded-2xl border border-border/60 p-3">
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search people"
                      aria-label="Search people"
                      className="mb-2 w-full rounded-xl bg-secondary px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
                    />
                    <PeoplePickerGrid
                      people={invitable}
                      query={query}
                      selected={selected}
                      onToggle={(id) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(id)) next.delete(id);
                          else next.add(id);
                          return next;
                        })
                      }
                      max={MAX_GROUP_MEMBERS}
                      emptyHint="Everyone you know is already here."
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setAdding(false)}
                        className="flex-1 rounded-xl border border-border/60 py-2 text-sm font-semibold text-muted-foreground"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={addSelected}
                        disabled={selected.size === 0}
                        className="flex-1 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        Add{selected.size > 0 ? ` · ${selected.size}` : ""}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAdding(true)}
                    className="mb-3 flex w-full items-center gap-2 rounded-2xl border border-dashed border-border/60 px-3.5 py-2.5 text-sm font-semibold text-primary transition hover:bg-secondary/50"
                  >
                    <UserPlus className="h-4 w-4" /> Add people
                  </button>
                )
              ) : null}

              {members === null ? (
                <div className="space-y-2" aria-hidden>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-12 rounded-2xl bg-secondary shimmer" />
                  ))}
                </div>
              ) : (
                <ul className="space-y-1">
                  {members.map((m) => (
                    <li key={m.id} className="relative flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-secondary/40">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-sm font-bold text-white">
                        {m.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={m.avatarUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          m.displayName.charAt(0).toUpperCase()
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {m.displayName}
                          {m.id === viewerId ? " (you)" : ""}
                        </span>
                        {m.role !== "member" ? (
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            {m.role === "owner" ? <Crown className="h-3 w-3" /> : <Shield className="h-3 w-3" />}
                            {m.role === "owner" ? "Owner" : "Admin"}
                          </span>
                        ) : null}
                      </span>
                      {canManage && m.id !== viewerId && m.role !== "owner" ? (
                        <div className="relative shrink-0">
                          <button
                            type="button"
                            onClick={() => setOpenRowMenu(openRowMenu === m.id ? null : m.id)}
                            aria-label={`Manage ${m.displayName}`}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                          {openRowMenu === m.id ? (
                            <>
                              <button
                                type="button"
                                aria-label="Close menu"
                                onClick={() => setOpenRowMenu(null)}
                                className="fixed inset-0 z-40 cursor-default"
                              />
                              <div className="absolute right-0 top-9 z-50 w-44 overflow-hidden rounded-2xl border border-border/70 bg-card py-1 shadow-elevated">
                                {m.role === "admin" ? (
                                  <RowMenuItem label="Remove as admin" onClick={() => changeRole(m.id, "member")} />
                                ) : (
                                  <RowMenuItem label="Make admin" onClick={() => changeRole(m.id, "admin")} />
                                )}
                                {isOwner ? <RowMenuItem label="Make owner" onClick={() => changeRole(m.id, "owner")} /> : null}
                                <RowMenuItem label="Remove from group" tone="danger" onClick={() => removeMember(m.id)} />
                              </div>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="border-t border-border/60 px-5 py-4">
              <button
                type="button"
                onClick={leave}
                disabled={viewerRole === "owner" && (members?.length ?? 0) > 1}
                className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-rose-500/30 py-2.5 text-sm font-semibold text-rose-500 transition hover:bg-rose-500/10 disabled:opacity-50 disabled:hover:bg-transparent"
              >
                <LogOut className="h-4 w-4" /> Leave group
              </button>
              {viewerRole === "owner" && (members?.length ?? 0) > 1 ? (
                <p className="mt-1.5 text-center text-[11px] text-muted-foreground">Make someone else owner first.</p>
              ) : null}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function RowMenuItem({ label, onClick, tone }: { label: string; onClick: () => void; tone?: "danger" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm transition hover:bg-secondary",
        tone === "danger" ? "text-rose-500" : "text-foreground",
      )}
    >
      {tone === "danger" ? <UserMinus className="h-3.5 w-3.5" /> : null}
      {label}
    </button>
  );
}
