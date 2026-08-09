"use client";

import { History, Loader2, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ProfileVersion } from "@/lib/profile/versions";
import { cn } from "@/lib/utils";

/**
 * Profile version history (Part 20).
 *
 * ── Restore is confirmed, and says exactly what it will touch ────────────
 * A one-tap restore in a list is a mis-tap away from replacing a layout
 * somebody just spent an hour on. The confirmation exists to state the scope:
 * this moves furniture and never touches posts or photos, which is the thing
 * a member is actually afraid of when they see the word "restore".
 *
 * ── Restoring is itself undoable ─────────────────────────────────────────
 * History is not cleared by a restore — the restored layout becomes the next
 * version on the following save. An undo that cannot be undone is a trap, and
 * a member who restores the wrong one should be one tap from where they were.
 */
export function VersionHistory({ initial }: { initial: ProfileVersion[] }) {
  const router = useRouter();
  const [versions] = useState(initial);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const restore = async (id: string) => {
    setBusy(id);
    setMsg(null);
    try {
      const res = await fetch("/api/profile/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: id }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMsg({ ok: false, text: json.error ?? "Couldn't restore that version." });
        return;
      }
      setMsg({ ok: true, text: "Restored. Your next save becomes a new version." });
      setConfirming(null);
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mt-7">
      <h2 className="flex items-center gap-2 px-0.5 text-sm font-bold">
        <History className="h-4 w-4 text-muted-foreground" />
        Version history
      </h2>
      <p className="mt-0.5 px-0.5 text-xs leading-relaxed text-muted-foreground">
        Your last {versions.length === 0 ? "few" : versions.length} layout changes. Restoring moves your sections and
        theme back — it never touches your posts or photos.
      </p>

      {versions.length === 0 ? (
        <p className="mt-2 rounded-2xl border border-dashed border-border/70 px-4 py-6 text-center text-xs text-muted-foreground">
          Nothing here yet. Your next layout change is saved as a version you can come back to.
        </p>
      ) : (
        <ul className="mt-2 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
          {versions.map((v) => {
            const isConfirming = confirming === v.id;
            return (
              <li key={v.id} className="border-b border-border/60 last:border-0">
                <div className="flex items-center gap-3 px-3.5 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{v.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {new Date(v.createdAt).toLocaleString(undefined, {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </span>
                  {isConfirming ? null : (
                    <button
                      type="button"
                      onClick={() => {
                        setConfirming(v.id);
                        setMsg(null);
                      }}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-primary transition hover:bg-secondary"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Restore
                    </button>
                  )}
                </div>

                {isConfirming ? (
                  <div className="border-t border-border/60 bg-secondary/40 px-3.5 py-3">
                    <p className="text-xs leading-relaxed">
                      Put your sections, order and theme back to how they were here? Your posts, photos and everything
                      you&apos;ve written stay exactly as they are.
                    </p>
                    <div className="mt-2.5 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busy === v.id}
                        onClick={() => void restore(v.id)}
                        className="btn-lux btn-lux-primary !py-2 !text-xs"
                      >
                        {busy === v.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3.5 w-3.5" />
                        )}
                        Restore this layout
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        className="px-2 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {msg ? (
        <p className={cn("mt-2 px-0.5 text-xs font-medium", msg.ok ? "text-emerald-500" : "text-rose-500")}>
          {msg.text}
        </p>
      ) : null}
    </section>
  );
}
