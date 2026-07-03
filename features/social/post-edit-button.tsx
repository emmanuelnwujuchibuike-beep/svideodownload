"use client";

import { Loader2, Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { CATEGORIES, categoryLabel } from "@/lib/social/categories";
import { cn } from "@/lib/utils";

type Visibility = "public" | "followers" | "private";

/**
 * Owner-only "Edit post" — a premium modal to update the caption, description,
 * category (tag) and audience. Hashtags (#) and @mentions typed into the caption
 * or description are automatically linked wherever the post is shown.
 */
export function PostEditButton({
  postId,
  initialTitle,
  initialDescription,
  initialCategory,
  initialVisibility,
}: {
  postId: string;
  initialTitle: string;
  initialDescription: string | null;
  initialCategory: string | null;
  initialVisibility: Visibility;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [category, setCategory] = useState<string>(initialCategory ?? "");
  const [visibility, setVisibility] = useState<Visibility>(initialVisibility);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (busy) return;
    const t = title.trim();
    if (!t) {
      setErr("Caption can't be empty.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: t,
          description: description.trim() || null,
          category: category || null,
          visibility,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? "Couldn't save.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Edit post"
        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-semibold transition hover:bg-secondary"
      >
        <Pencil className="h-4 w-4" /> Edit
      </button>

      {open ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Edit post">
          <div className="relative w-full max-w-lg overflow-hidden rounded-t-3xl border border-border bg-card shadow-luxury sm:rounded-3xl">
            <div aria-hidden className="pointer-events-none absolute -right-14 -top-16 h-44 w-44 rounded-full bg-gradient-to-br from-blue-600/20 to-violet-600/20 blur-3xl" />
            <div className="relative flex items-center justify-between px-5 py-4">
              <h3 className="text-base font-bold tracking-tight">Edit post</h3>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="relative space-y-4 px-5 pb-6">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Caption</span>
                <textarea
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={300}
                  rows={2}
                  placeholder="Write a caption… use #hashtags and @mentions"
                  className="w-full resize-none rounded-2xl bg-background px-4 py-3 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={5000}
                  rows={3}
                  placeholder="Add more details (optional)"
                  className="w-full resize-none rounded-2xl bg-background px-4 py-3 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
                />
              </label>

              <div>
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tag</span>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCategory((cur) => (cur === c ? "" : c))}
                      className={cn(
                        "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                        category === c
                          ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-sm shadow-violet-500/25"
                          : "border border-border/70 bg-card/60 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      #{categoryLabel(c)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Audience</span>
                <div className="grid grid-cols-3 gap-2">
                  {(["public", "followers", "private"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setVisibility(v)}
                      className={cn(
                        "rounded-xl border px-2 py-2 text-xs font-semibold capitalize transition",
                        visibility === v ? "border-primary bg-primary/10 text-foreground" : "border-border/70 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {err ? <p className="text-sm text-rose-400">{err}</p> : null}

              <button
                type="button"
                onClick={save}
                disabled={busy}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 text-sm font-bold text-white shadow-md shadow-violet-500/25 transition hover:opacity-95 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {busy ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
