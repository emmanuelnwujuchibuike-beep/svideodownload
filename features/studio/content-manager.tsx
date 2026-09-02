"use client";

import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  Loader2,
  Lock,
  Pin,
  PinOff,
  Search,
  Send,
  Trash2,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { toast } from "@/features/ui/toast";
import type { ContentFilter, CreatorContentItem } from "@/lib/creator/content-types";
import { CATEGORIES } from "@/lib/social/categories";
import { cn, formatCompactNumber } from "@/lib/utils";

/**
 * Content management (Feature 15 · Part 9).
 *
 * ── Hashtags are edited as chips and STORED IN THE CAPTION ───────────────
 * There is no hashtag table in this product — `lib/social/hashtags.ts` parses
 * tags out of captions, and that caption is what search and trending read. So
 * the editor sends `tags` and the server rewrites the caption with `applyTags`.
 * The consequence is the point: an edit here changes real discovery, rather
 * than writing to a parallel field nothing consumes.
 *
 * ── Bulk actions are honest about partial success ───────────────────────
 * The response says how many rows actually changed. A bulk action that silently
 * affected fewer posts than were selected is the worst kind of quiet failure,
 * so a shortfall is surfaced as a warning rather than a success toast.
 */

const FILTERS: { id: ContentFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "published", label: "Published" },
  { id: "scheduled", label: "Scheduled" },
  { id: "archived", label: "Archived" },
  { id: "pinned", label: "Pinned" },
];

type Action =
  | { kind: "pin"; pinned: boolean }
  | { kind: "archive" }
  | { kind: "restore" }
  | { kind: "schedule"; at: string | null }
  | { kind: "publishNow" }
  | { kind: "visibility"; visibility: "public" | "followers" | "private" }
  | { kind: "edit"; title?: string; description?: string | null; category?: string | null; tags?: string[] };

export function ContentManager({
  items,
  counts,
  filter,
  search,
  truncated,
}: {
  items: CreatorContentItem[];
  counts: Record<ContentFilter, number>;
  filter: ContentFilter;
  search: string;
  truncated: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(search);
  const [editing, setEditing] = useState<CreatorContentItem | null>(null);

  const allSelected = items.length > 0 && selected.size === items.length;

  const run = async (ids: string[], action: Action) => {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/studio/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast(json.error ?? "Couldn't save that.", "error");
        return;
      }
      if (json.warning) toast(`${json.changed} of ${ids.length} updated — ${json.warning}`, "info");
      setSelected(new Set());
      setEditing(null);
      router.refresh();
    } catch {
      toast("Network error. Nothing was changed.", "error");
    } finally {
      setBusy(false);
    }
  };

  const go = (next: Partial<{ filter: ContentFilter; q: string }>) => {
    const sp = new URLSearchParams();
    const f = next.filter ?? filter;
    const q = next.q ?? query;
    if (f !== "all") sp.set("filter", f);
    if (q.trim()) sp.set("q", q.trim());
    router.push(`/studio/content${sp.toString() ? `?${sp}` : ""}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => go({ filter: f.id })}
            aria-current={filter === f.id ? "true" : undefined}
            className={cn(
              "rounded-xl px-3 py-1.5 text-xs font-semibold transition",
              filter === f.id
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
            <span className="ml-1.5 tabular-nums opacity-70">{counts[f.id]}</span>
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          go({ q: query });
        }}
        className="flex items-center gap-2"
      >
        <label htmlFor="content-search" className="sr-only">
          Search your posts
        </label>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            id="content-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search captions"
            className="w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <button type="submit" className="rounded-xl bg-secondary px-3.5 py-2.5 text-xs font-semibold transition hover:bg-secondary/70">
          Search
        </button>
      </form>

      {selected.size > 0 ? (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-primary/30 bg-card/95 p-2.5 shadow-card backdrop-blur">
          <span className="px-1 text-xs font-semibold tabular-nums">{selected.size} selected</span>
          <BulkButton icon={Pin} label="Pin" onClick={() => run([...selected], { kind: "pin", pinned: true })} busy={busy} />
          <BulkButton icon={PinOff} label="Unpin" onClick={() => run([...selected], { kind: "pin", pinned: false })} busy={busy} />
          <BulkButton icon={Archive} label="Archive" onClick={() => run([...selected], { kind: "archive" })} busy={busy} />
          <BulkButton icon={ArchiveRestore} label="Restore" onClick={() => run([...selected], { kind: "restore" })} busy={busy} />
          <BulkButton icon={Lock} label="Private" onClick={() => run([...selected], { kind: "visibility", visibility: "private" })} busy={busy} />
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto rounded-lg p-1.5 text-muted-foreground transition hover:bg-secondary"
            aria-label="Clear selection"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}

      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border/70 px-4 py-10 text-center text-sm text-muted-foreground">
          {search ? "Nothing matches that search." : "Nothing here yet."}
        </p>
      ) : (
        <>
          <label className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(e) => setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())}
              className="h-4 w-4 rounded border-border"
            />
            Select all on this page
          </label>

          <ul className="space-y-2.5">
            {items.map((item) => (
              <ContentRow
                key={item.id}
                item={item}
                selected={selected.has(item.id)}
                busy={busy}
                onToggle={() =>
                  setSelected((s) => {
                    const next = new Set(s);
                    if (next.has(item.id)) next.delete(item.id);
                    else next.add(item.id);
                    return next;
                  })
                }
                onAction={(a) => run([item.id], a)}
                onEdit={() => setEditing(item)}
              />
            ))}
          </ul>
        </>
      )}

      {truncated ? (
        <p className="rounded-2xl border border-dashed border-amber-500/40 px-4 py-3 text-center text-[11px] text-muted-foreground">
          Showing the first 200. Narrow it with a filter or a search — this page does not silently cut a
          number off, so what you see is what it counted.
        </p>
      ) : null}

      {editing ? <EditSheet item={editing} busy={busy} onClose={() => setEditing(null)} onSave={(a) => run([editing.id], a)} /> : null}
    </div>
  );
}

function BulkButton({
  icon: Icon,
  label,
  onClick,
  busy,
}: {
  icon: typeof Pin;
  label: string;
  onClick: () => void;
  busy: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-lg bg-secondary px-2.5 py-1.5 text-[11px] font-semibold transition hover:bg-secondary/70 disabled:opacity-50"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </button>
  );
}

function ContentRow({
  item,
  selected,
  busy,
  onToggle,
  onAction,
  onEdit,
}: {
  item: CreatorContentItem;
  selected: boolean;
  busy: boolean;
  onToggle: () => void;
  onAction: (a: Action) => void;
  onEdit: () => void;
}) {
  const scheduled = item.status === "scheduled";
  const archived = item.status === "archived";

  return (
    <li
      className={cn(
        "rounded-2xl border p-3 transition",
        selected ? "border-primary/40 bg-primary/[0.03]" : "border-border/70 bg-card",
      )}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${item.title}`}
          className="mt-1 h-4 w-4 shrink-0 rounded border-border"
        />
        {item.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.thumbnailUrl} alt="" loading="lazy" className="h-14 w-20 shrink-0 rounded-xl object-cover" />
        ) : (
          <span className="h-14 w-20 shrink-0 rounded-xl bg-secondary" />
        )}

        <div className="min-w-0 flex-1">
          <Link href={`/studio/content/${item.id}`} prefetch={false} className="block truncate text-sm font-semibold hover:underline">
            {item.title}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="tabular-nums">{formatCompactNumber(item.views)} views</span>
            <span className="tabular-nums">{formatCompactNumber(item.likes + item.comments + item.shares + item.saves)} engagements</span>
            {item.completionRate > 0 ? <span>{Math.round(item.completionRate * 100)}% watched</span> : null}
            {item.pinnedAt ? <Badge tone="amber">Pinned</Badge> : null}
            {scheduled ? (
              <Badge tone="blue">
                {item.scheduledAt
                  ? `Scheduled ${new Date(item.scheduledAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
                  : "Draft"}
              </Badge>
            ) : null}
            {archived ? <Badge tone="slate">Archived</Badge> : null}
            {item.visibility !== "public" ? <Badge tone="slate">{item.visibility}</Badge> : null}
          </div>
          {item.tags.length > 0 ? (
            <p className="mt-1.5 truncate text-[11px] text-primary/80">{item.tags.map((t) => `#${t}`).join(" ")}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-border/50 pt-2.5">
        <RowAction label="Edit" onClick={onEdit} busy={busy} />
        {item.pinnedAt ? (
          <RowAction icon={PinOff} label="Unpin" onClick={() => onAction({ kind: "pin", pinned: false })} busy={busy} />
        ) : (
          <RowAction icon={Pin} label="Pin" onClick={() => onAction({ kind: "pin", pinned: true })} busy={busy} />
        )}
        {scheduled ? (
          <RowAction icon={Send} label="Publish now" onClick={() => onAction({ kind: "publishNow" })} busy={busy} />
        ) : null}
        {archived ? (
          <RowAction icon={ArchiveRestore} label="Restore" onClick={() => onAction({ kind: "restore" })} busy={busy} />
        ) : (
          <RowAction icon={Archive} label="Archive" onClick={() => onAction({ kind: "archive" })} busy={busy} />
        )}
        <Link
          href={`/studio/content/${item.id}`}
          prefetch={false}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        >
          <Users className="h-3.5 w-3.5" aria-hidden />
          Insights
        </Link>
      </div>
    </li>
  );
}

function RowAction({
  icon: Icon,
  label,
  onClick,
  busy,
}: {
  icon?: typeof Pin;
  label: string;
  onClick: () => void;
  busy: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-50"
    >
      {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null}
      {label}
    </button>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "amber" | "blue" | "slate" }) {
  const tones = {
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    slate: "bg-secondary text-muted-foreground",
  }[tone];
  return <span className={cn("rounded-full px-1.5 py-0.5 font-semibold capitalize", tones)}>{children}</span>;
}

/** The edit sheet. Caption, description, category, hashtags, visibility and
 *  schedule — everything about a post that is genuinely editable. */
function EditSheet({
  item,
  busy,
  onClose,
  onSave,
}: {
  item: CreatorContentItem;
  busy: boolean;
  onClose: () => void;
  onSave: (a: Action) => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? "");
  const [category, setCategory] = useState(item.category ?? "");
  const [tagText, setTagText] = useState(item.tags.join(" "));
  const [when, setWhen] = useState(item.scheduledAt ? toLocalInput(item.scheduledAt) : "");

  const tags = useMemo(
    () => tagText.split(/[\s,]+/).map((t) => t.replace(/^#/, "").trim()).filter(Boolean),
    [tagText],
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${item.title}`}
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-border bg-card p-5 shadow-2xl sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Edit post</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 transition hover:bg-secondary">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="space-y-4">
          <Field label="Caption">
            <textarea
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              rows={2}
              maxLength={300}
              className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
            />
          </Field>

          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={5000}
              className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
            />
          </Field>

          <Field
            label="Hashtags"
            hint="Stored inside the caption, which is what search and trending actually read — so editing these changes real reach."
          >
            <input
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
              placeholder="summer travel"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
            />
            {tags.length > 0 ? (
              <p className="mt-1.5 text-[11px] text-primary/80">{tags.map((t) => `#${t}`).join(" ")}</p>
            ) : null}
          </Field>

          <Field label="Category">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
            >
              <option value="">None</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c[0]!.toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>
          </Field>

          <button
            type="button"
            disabled={busy}
            onClick={() =>
              onSave({
                kind: "edit",
                title,
                description: description.trim() ? description : null,
                category: category || null,
                tags,
              })
            }
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
            Save changes
          </button>

          <div className="border-t border-border/60 pt-4">
            <Field
              label="Visibility"
              hint="Followers-only and private posts leave every feed immediately."
            >
              <div className="flex gap-1.5">
                {(["public", "followers", "private"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    disabled={busy}
                    onClick={() => onSave({ kind: "visibility", visibility: v })}
                    className={cn(
                      "flex-1 rounded-xl px-3 py-2 text-xs font-semibold capitalize transition disabled:opacity-50",
                      item.visibility === v
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          <div className="border-t border-border/60 pt-4">
            <Field
              label="Schedule"
              hint="Published within a few minutes of this time — the sweep runs on site traffic, not to the second."
            >
              <div className="flex items-center gap-2">
                <input
                  type="datetime-local"
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                  className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
                />
                <button
                  type="button"
                  disabled={busy || !when}
                  onClick={() => onSave({ kind: "schedule", at: new Date(when).toISOString() })}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-secondary px-3 py-2 text-xs font-semibold transition hover:bg-secondary/70 disabled:opacity-50"
                >
                  <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                  Set
                </button>
              </div>
            </Field>
          </div>

          <div className="border-t border-border/60 pt-4">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (confirm(`Delete "${item.title}"? This cannot be undone — archive it instead if you might want it back.`)) {
                  void fetch(`/api/posts/${item.id}`, { method: "DELETE" }).then(() => window.location.reload());
                }
              }}
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-rose-600 transition hover:bg-rose-500/10 disabled:opacity-50 dark:text-rose-400"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Delete permanently
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold">{label}</p>
      {hint ? <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">{hint}</p> : null}
      {children}
    </div>
  );
}

/** ISO → the `datetime-local` shape, in the viewer's own timezone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
