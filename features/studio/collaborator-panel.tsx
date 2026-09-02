"use client";

import { Loader2, UserPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { toast } from "@/features/ui/toast";
import type { Collaborator } from "@/lib/creator/collab-types";
import { cn } from "@/lib/utils";

/**
 * Collaboration (Feature 15 · Part 9).
 *
 * ── There is no revenue split here, and that is deliberate ──────────────
 * `post_collaborators` has no percentage column because this platform has no
 * payout rails at all — `lib/platform/commerce-platform.ts` has listed the
 * Creator Payout Service as `planned` since it was written. A split stored
 * against a collaborator would settle nothing, pay nobody, and read to both
 * people as a promise the product cannot keep. When rails exist it is one
 * migration; inventing it now would be a lie with a schema behind it.
 *
 * Permissions are server-side: an invite is `pending` until the invitee
 * accepts, and only an accepted collaborator may open the post's analytics
 * (`canViewPostInsights`). Nothing here is enforced by hiding a button.
 */

export function CollaboratorPanel({ postId, initial }: { postId: string; initial: Collaborator[] }) {
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);

  const invite = async () => {
    const clean = handle.trim().replace(/^@/, "");
    if (!clean) return;
    setBusy(true);
    try {
      const res = await fetch("/api/studio/collab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, handle: clean }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast(json.error ?? "Couldn't send that invite.", "error");
        return;
      }
      toast(`Invited @${clean}. They'll see it in their invites.`, "success");
      setHandle("");
      router.refresh();
    } catch {
      toast("Network error. No invite was sent.", "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (userId: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/studio/collab?postId=${postId}&userId=${userId}`, { method: "DELETE" });
      if (!res.ok) {
        toast("Couldn't remove them.", "error");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-3xl border border-border bg-card p-5 shadow-card sm:p-6">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <UserPlus className="h-4 w-4 text-primary" aria-hidden />
        Collaborators
      </h2>
      <p className="mb-4 mt-1 text-xs leading-relaxed text-muted-foreground">
        An accepted collaborator is credited on the post and can open its analytics. Revenue sharing is not
        available — this platform has no payout rails yet, so there is nothing to split.
      </p>

      {initial.length > 0 ? (
        <ul className="mb-4 space-y-2">
          {initial.map((c) => (
            <li key={c.userId} className="flex items-center gap-3 rounded-2xl bg-secondary/40 p-2.5">
              {c.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.avatarUrl} alt="" loading="lazy" className="h-8 w-8 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold uppercase">
                  {c.handle.slice(0, 2)}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold">{c.displayName ?? `@${c.handle}`}</span>
                <span
                  className={cn(
                    "text-[11px] capitalize",
                    c.status === "accepted"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : c.status === "declined"
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-muted-foreground",
                  )}
                >
                  {c.status}
                </span>
              </span>
              <button
                type="button"
                onClick={() => remove(c.userId)}
                disabled={busy}
                aria-label={`Remove @${c.handle}`}
                className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-50"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void invite();
        }}
        className="flex items-center gap-2"
      >
        <label htmlFor="collab-handle" className="sr-only">
          Invite by handle
        </label>
        <input
          id="collab-handle"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="@handle"
          maxLength={40}
          className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
        />
        <button
          type="submit"
          disabled={busy || !handle.trim()}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
          Invite
        </button>
      </form>
    </section>
  );
}
