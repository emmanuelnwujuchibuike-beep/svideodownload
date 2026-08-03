"use client";

import { Eye, EyeOff, Heart, Image as ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";

export interface AdminWallpaper {
  id: string;
  name: string;
  category: string;
  thumbUrl: string;
  status: string;
  sortOrder: number;
  likes: number;
  saves: number;
  comments: number;
  views: number;
  /** Real, trigger-maintained counts (migration 0108). */
  realLikes: number;
  realSaves: number;
  realViews: number;
  /** Signed operator adjustments, kept apart from the real counts. */
  likesBoost: number;
  savesBoost: number;
  viewsBoost: number;
}

type BoostKey = "viewsBoost" | "likesBoost" | "savesBoost";

const CATEGORIES = ["Abstract", "Gradient", "Nature", "Dark", "Minimal", "Space", "Texture", "Anime", "Cars", "City"];

/**
 * Admin → Wallpapers. Upload images into the public library and curate what's
 * in it (owner: "make admin can upload images in wallpaper section from the
 * admin dashboard").
 *
 * Hide rather than delete is the default action offered: hiding keeps the row
 * and its real likes/saves/comments while taking it off the shelf, which is
 * almost always what an operator actually wants. Delete is there, marked, and
 * removes the stored object too.
 */
export function WallpaperManager({ wallpapers }: { wallpapers: AdminWallpaper[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState(CATEGORIES[0]!);
  // The name for the next upload. Owner: a wallpaper should carry a name a
  // person wrote, not the camera's filename.
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const upload = async (files: FileList) => {
    setBusy(true);
    setMsg(null);
    try {
      const form = new FormData();
      form.append("category", category);
      form.append("name", name);
      for (const f of Array.from(files)) form.append("files", f);
      const res = await fetch("/api/admin/wallpapers", { method: "POST", body: form });
      const json = (await res.json()) as { ok?: boolean; created?: number; failed?: string[]; error?: string };
      if (!res.ok || !json.ok) {
        setMsg({ ok: false, text: json.error ?? "Upload failed." });
        return;
      }
      setMsg({
        ok: (json.created ?? 0) > 0,
        text:
          `${json.created ?? 0} uploaded.` +
          (json.failed?.length ? ` ${json.failed.length} skipped: ${json.failed.join("; ")}` : ""),
      });
      setName("");
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    setRowBusy(id);
    try {
      const res = await fetch("/api/admin/wallpapers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      if (res.ok) router.refresh();
    } finally {
      setRowBusy(null);
    }
  };

  const remove = async (w: AdminWallpaper) => {
    if (!confirm(`Delete "${w.name}" permanently? Its likes and comments go with it. Hiding keeps them.`)) return;
    setRowBusy(w.id);
    try {
      const res = await fetch(`/api/admin/wallpapers?id=${encodeURIComponent(w.id)}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setRowBusy(null);
    }
  };

  return (
    <section className="mt-6 rounded-3xl border border-border bg-card p-5 shadow-card sm:p-6">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <ImageIcon className="h-5 w-5 text-primary" /> Wallpapers
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {wallpapers.length}
        </span>
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Images here fill the Wallpapers section on the download page and the full-screen gallery at /wallpapers. Until
        you upload any, a built-in placeholder set is shown instead.
      </p>

      {/* Upload */}
      <div className="rounded-2xl border border-dashed border-border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-10 rounded-xl bg-background px-3 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            multiple
            className="hidden"
            onChange={(e) => e.target.files?.length && void upload(e.target.files)}
          />
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 text-sm font-bold text-white transition disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {busy ? "Uploading…" : "Upload images"}
          </button>
        </div>
        {/* The name for this upload. Without it, a camera filename like
            IMG_8662 used to become the caption visitors read; now an unnamed
            upload falls back to a clean "Abstract 01" instead. */}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          placeholder="Name these wallpapers (optional) — e.g. Neon Canyon"
          className="mt-2 h-10 w-full rounded-xl bg-background px-3 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          JPEG, PNG, WebP or AVIF · up to 20 MB each · multiple at once. Uploading several with a name numbers them
          (&ldquo;Neon Canyon 1&rdquo;, &ldquo;Neon Canyon 2&rdquo;). You can rename any of them below.
        </p>
        {msg ? (
          <p className={cn("mt-2 text-xs font-medium", msg.ok ? "text-emerald-500" : "text-rose-500")}>{msg.text}</p>
        ) : null}
      </div>

      {/* Library */}
      {wallpapers.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Nothing uploaded yet.</p>
      ) : (
        <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {wallpapers.map((w) => (
            <li key={w.id} className={cn("overflow-hidden rounded-2xl border border-border/70", w.status !== "published" && "opacity-60")}>
              <div className="relative aspect-[3/4] bg-neutral-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={w.thumbUrl} alt={w.name} loading="lazy" className="h-full w-full object-cover" />
                {w.status !== "published" ? (
                  <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                    Hidden
                  </span>
                ) : null}
                {w.likes > 0 ? (
                  <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur-md">
                    <Heart className="h-2.5 w-2.5" /> {w.likes}
                  </span>
                ) : null}
              </div>
              <div className="space-y-1.5 p-2">
                <input
                  defaultValue={w.name}
                  onBlur={(e) => e.target.value.trim() !== w.name && void patch(w.id, { title: e.target.value })}
                  className="w-full rounded-lg bg-background px-2 py-1 text-xs font-semibold outline-none ring-1 ring-inset ring-transparent transition focus:ring-primary"
                />
                <select
                  defaultValue={w.category}
                  onChange={(e) => void patch(w.id, { category: e.target.value })}
                  className="w-full rounded-lg bg-background px-1.5 py-1 text-[11px] text-muted-foreground outline-none ring-1 ring-inset ring-transparent focus:ring-primary"
                >
                  {[...new Set([w.category, ...CATEGORIES])].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>

                {/* Engagement adjustments. Each row shows what visitors SEE and,
                    underneath, what was actually earned — so an operator can
                    always tell the two apart and set an adjustment back to zero. */}
                <div className="space-y-1 rounded-lg bg-secondary/40 p-1.5">
                  <BoostRow label="Views" field="viewsBoost" shown={w.views} real={w.realViews} boost={w.viewsBoost} id={w.id} onPatch={patch} busy={rowBusy === w.id} />
                  <BoostRow label="Likes" field="likesBoost" shown={w.likes} real={w.realLikes} boost={w.likesBoost} id={w.id} onPatch={patch} busy={rowBusy === w.id} />
                  <BoostRow label="Saves" field="savesBoost" shown={w.saves} real={w.realSaves} boost={w.savesBoost} id={w.id} onPatch={patch} busy={rowBusy === w.id} />
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={rowBusy === w.id}
                    onClick={() => void patch(w.id, { status: w.status === "published" ? "hidden" : "published" })}
                    className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-border py-1.5 text-[11px] font-semibold transition hover:bg-secondary disabled:opacity-50"
                  >
                    {rowBusy === w.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : w.status === "published" ? (
                      <EyeOff className="h-3 w-3" />
                    ) : (
                      <Eye className="h-3 w-3" />
                    )}
                    {w.status === "published" ? "Hide" : "Show"}
                  </button>
                  <button
                    type="button"
                    disabled={rowBusy === w.id}
                    onClick={() => void remove(w)}
                    aria-label={`Delete ${w.name}`}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-rose-500/40 text-rose-500 transition hover:bg-rose-500/10 disabled:opacity-50"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * One adjustable metric.
 *
 * The number on the left is what a VISITOR sees; the line under it is what was
 * actually earned plus the operator's adjustment, shown separately and always.
 * That separation is the whole point: an adjusted count stays distinguishable
 * from a real one, and "Reset" puts it back with a single tap.
 *
 * Steppers rather than a free-text box: the common operation is a nudge, and a
 * typed field invites a slipped digit that would be visible to every visitor.
 * The value is committed on each tap, so nothing is left unsaved.
 */
function BoostRow({
  label,
  field,
  shown,
  real,
  boost,
  id,
  onPatch,
  busy,
}: {
  label: string;
  field: BoostKey;
  shown: number;
  real: number;
  boost: number;
  id: string;
  onPatch: (id: string, body: Record<string, unknown>) => Promise<void>;
  busy: boolean;
}) {
  const step = (delta: number) => void onPatch(id, { [field]: boost + delta });

  return (
    <div className="flex items-center gap-1">
      <span className="w-10 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate text-[11px] font-bold tabular-nums">
        {shown.toLocaleString()}
        {boost !== 0 ? (
          <span className="ml-1 font-medium text-amber-500">
            ({real.toLocaleString()} real {boost > 0 ? "+" : "−"} {Math.abs(boost).toLocaleString()})
          </span>
        ) : null}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => step(-10)}
        aria-label={`Reduce ${label} by 10`}
        className="flex h-6 w-6 items-center justify-center rounded-md border border-border text-[11px] font-bold transition hover:bg-background disabled:opacity-40"
      >
        −
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => step(10)}
        aria-label={`Increase ${label} by 10`}
        className="flex h-6 w-6 items-center justify-center rounded-md border border-border text-[11px] font-bold transition hover:bg-background disabled:opacity-40"
      >
        +
      </button>
      {boost !== 0 ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void onPatch(id, { [field]: 0 })}
          aria-label={`Reset ${label} adjustment`}
          className="rounded-md border border-border px-1.5 text-[10px] font-semibold text-muted-foreground transition hover:bg-background disabled:opacity-40"
        >
          Reset
        </button>
      ) : null}
    </div>
  );
}
