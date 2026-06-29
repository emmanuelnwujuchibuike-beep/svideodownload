"use client";

import { CheckCircle2, Globe, Loader2, Lock, Share2, Users, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useUser } from "@/features/auth/use-user";
import { CATEGORIES, categoryLabel } from "@/lib/social/categories";
import { cn } from "@/lib/utils";
import type { MediaKind, VideoMetadata } from "@/types";

type Visibility = "public" | "followers" | "private";

const VIS: { value: Visibility; label: string; icon: typeof Globe }[] = [
  { value: "public", label: "Public", icon: Globe },
  { value: "followers", label: "Followers", icon: Users },
  { value: "private", label: "Private", icon: Lock },
];

function deriveKind(meta: VideoMetadata): MediaKind {
  const kinds = new Set(meta.formats.map((f) => f.kind));
  if (kinds.has("video")) return "video";
  if (kinds.has("image")) return "image";
  return "audio";
}

/**
 * "Publish to profile" — turns the current download into a public page on the
 * user's profile (directory model: metadata only, no file stored). Signed-in
 * users only; opens a small composer for title/description/category/visibility.
 */
export function PublishButton({ metadata }: { metadata: VideoMetadata }) {
  const { user, enabled } = useUser();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState((metadata.title || "").slice(0, 300));
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [doneId, setDoneId] = useState<string | null>(null);

  if (enabled && !user) {
    return (
      <Link
        href="/login?next=/account"
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-semibold text-foreground shadow-soft transition hover:bg-secondary"
      >
        <Share2 className="h-4 w-4" /> Sign in to publish
      </Link>
    );
  }
  if (!enabled) return null;

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl: metadata.webpageUrl || metadata.sourceUrl,
          platform: metadata.platform,
          sourceAuthor: metadata.creator ?? null,
          mediaKind: deriveKind(metadata),
          // Truncate to the server cap so any source length always publishes.
          title: title.trim().slice(0, 300),
          description: description.trim().slice(0, 5000) || null,
          category: category || null,
          thumbnailUrl: metadata.thumbnail ?? null,
          durationSec: metadata.durationSeconds ?? null,
          visibility,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? "Couldn't publish.");
        return;
      }
      setDoneId(json.id as string);
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
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-semibold text-foreground shadow-soft transition hover:bg-secondary active:scale-[0.98]"
      >
        <Share2 className="h-4 w-4" /> Publish to profile
      </button>

      {open ? (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="w-full max-w-md overflow-hidden rounded-t-3xl border border-border bg-card shadow-luxury sm:rounded-3xl">
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
              <h3 className="font-semibold">Publish to your profile</h3>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            {doneId ? (
              <div className="p-8 text-center">
                <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
                <p className="mt-3 font-semibold">Published!</p>
                <div className="mt-5 flex justify-center gap-2">
                  <Link href={`/p/${doneId}`} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
                    View page
                  </Link>
                  <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-border px-4 py-2 text-sm font-medium">
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 p-5">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Title</label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={300}
                    className="h-10 w-full rounded-xl bg-background px-3 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Description (optional)</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={5000}
                    className="min-h-[64px] w-full rounded-xl bg-background p-3 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="h-10 w-full rounded-xl bg-background px-3 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Choose…</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{categoryLabel(c)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Visibility</label>
                  <div className="grid grid-cols-3 gap-2">
                    {VIS.map((v) => (
                      <button
                        key={v.value}
                        type="button"
                        onClick={() => setVisibility(v.value)}
                        aria-pressed={visibility === v.value}
                        className={cn(
                          "flex items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-medium transition",
                          visibility === v.value ? "border-primary bg-primary/10 text-primary" : "border-border/70 text-muted-foreground",
                        )}
                      >
                        <v.icon className="h-3.5 w-3.5" /> {v.label}
                      </button>
                    ))}
                  </div>
                </div>

                {err ? <p className="text-sm text-red-400">{err}</p> : null}

                <button
                  type="button"
                  onClick={submit}
                  disabled={busy || !title.trim()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />} Publish
                </button>
                <p className="text-center text-[11px] text-muted-foreground">
                  We publish a page with the title, link &amp; preview — not the file itself.
                </p>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
