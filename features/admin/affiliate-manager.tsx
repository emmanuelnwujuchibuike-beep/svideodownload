"use client";

import {
  ArrowDown,
  ArrowUp,
  Loader2,
  Pencil,
  Plus,
  Store,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PLACEMENTS, type AffiliateRecord, type Placement } from "@/lib/monetization/tools";
import { cn } from "@/lib/utils";

interface FormState {
  name: string;
  url: string;
  description: string;
  image_url: string;
  cta: string;
  category: string;
  placements: Placement[];
  priority: number;
  sort_order: number;
  weight: number;
  active: boolean;
  starts_at: string; // datetime-local
  ends_at: string;
}

const EMPTY: FormState = {
  name: "",
  url: "",
  description: "",
  image_url: "",
  cta: "Visit",
  category: "",
  placements: [],
  priority: 100,
  sort_order: 100,
  weight: 1,
  active: true,
  starts_at: "",
  ends_at: "",
};

const PLACEMENT_LABELS: Record<Placement, string> = {
  homepage: "Homepage",
  download_result: "Result page",
  blog: "Blog",
  footer: "Footer",
  sidebar: "Sidebar",
};

// datetime-local shows/edits LOCAL wall-clock time, so shift by the tz offset
// when converting to/from the stored UTC ISO string.
const toLocal = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromLocal = (local: string): string | null =>
  local ? new Date(local).toISOString() : null;

const recordToForm = (r: AffiliateRecord): FormState => ({
  name: r.name,
  url: r.url,
  description: r.description ?? "",
  image_url: r.image_url ?? "",
  cta: r.cta ?? "Visit",
  category: r.category ?? "",
  placements: (r.placements ?? []) as Placement[],
  priority: r.priority,
  sort_order: r.sort_order,
  weight: r.weight,
  active: r.active,
  starts_at: toLocal(r.starts_at),
  ends_at: toLocal(r.ends_at),
});

export function AffiliateManager({ affiliates }: { affiliates: AffiliateRecord[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const openNew = () => {
    setForm({ ...EMPTY, sort_order: (affiliates.at(-1)?.sort_order ?? 90) + 10 });
    setErr(null);
    setEditing("new");
  };
  const openEdit = (r: AffiliateRecord) => {
    setForm(recordToForm(r));
    setErr(null);
    setEditing(r.id);
  };
  const close = () => {
    setEditing(null);
    setErr(null);
  };

  const payload = () => ({
    name: form.name.trim(),
    url: form.url.trim(),
    description: form.description.trim() || null,
    image_url: form.image_url.trim() || null,
    cta: form.cta.trim() || "Visit",
    category: form.category.trim() || null,
    placements: form.placements,
    priority: form.priority,
    sort_order: form.sort_order,
    weight: form.weight,
    active: form.active,
    starts_at: fromLocal(form.starts_at),
    ends_at: fromLocal(form.ends_at),
  });

  const save = async () => {
    if (!form.name.trim() || !form.url.trim()) {
      setErr("Name and URL are required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const isNew = editing === "new";
      const res = await fetch(
        isNew ? "/api/admin/affiliates" : `/api/admin/affiliates/${editing}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload()),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? "Failed to save.");
        return;
      }
      close();
      router.refresh();
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this affiliate/tool? This can't be undone.")) return;
    await fetch(`/api/admin/affiliates/${id}`, { method: "DELETE" });
    router.refresh();
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    await fetch(`/api/admin/affiliates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  };

  const move = async (index: number, dir: -1 | 1) => {
    const a = affiliates[index];
    const b = affiliates[index + dir];
    if (!a || !b) return;
    // Put `a` just past `b` in the move direction. Robust even when rows share
    // the same sort_order (a plain swap would be a no-op there).
    await patch(a.id, { sort_order: b.sort_order + dir });
    router.refresh();
  };

  return (
    <section className="mt-6 rounded-3xl border border-border bg-card p-6 shadow-card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Store className="h-5 w-5 text-primary" /> Affiliates &amp; recommended tools
        </h2>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>

      {editing ? (
        <AffiliateForm
          form={form}
          setForm={setForm}
          onSave={save}
          onCancel={close}
          busy={busy}
          err={err}
          isNew={editing === "new"}
        />
      ) : null}

      {affiliates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No affiliates yet. Add hosting, VPN, AI and other tools to monetize.
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {affiliates.map((r, i) => (
            <li key={r.id} className="flex items-center gap-3 py-3">
              <div className="flex shrink-0 flex-col">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label="Move up"
                  className="text-muted-foreground transition hover:text-foreground disabled:opacity-30"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === affiliates.length - 1}
                  aria-label="Move down"
                  className="text-muted-foreground transition hover:text-foreground disabled:opacity-30"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>

              {r.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.image_url} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
              ) : (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-sm font-bold text-muted-foreground">
                  {r.name.charAt(0).toUpperCase()}
                </span>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold">{r.name}</span>
                  {r.category ? (
                    <span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-medium uppercase text-muted-foreground">
                      {r.category}
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {(r.placements ?? []).length === 0 ? (
                    <span className="text-[11px] text-muted-foreground/70">result-engine only</span>
                  ) : (
                    (r.placements as Placement[]).map((p) => (
                      <span key={p} className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        {PLACEMENT_LABELS[p] ?? p}
                      </span>
                    ))
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => patch(r.id, { active: !r.active }).then(() => router.refresh())}
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold transition",
                  r.active
                    ? "bg-green-500/15 text-green-500"
                    : "bg-secondary text-muted-foreground",
                )}
              >
                {r.active ? "Live" : "Off"}
              </button>

              <button
                type="button"
                onClick={() => openEdit(r)}
                aria-label="Edit"
                className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => remove(r.id)}
                aria-label="Delete"
                className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-red-400"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AffiliateForm({
  form,
  setForm,
  onSave,
  onCancel,
  busy,
  err,
  isNew,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
  err: string | null;
  isNew: boolean;
}) {
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm({ ...form, [k]: v });
  const input =
    "h-10 w-full rounded-xl bg-background px-3 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary";
  const label = "mb-1 block text-xs font-medium text-muted-foreground";

  const togglePlacement = (p: Placement) =>
    set(
      "placements",
      form.placements.includes(p)
        ? form.placements.filter((x) => x !== p)
        : [...form.placements, p],
    );

  return (
    <div className="mb-5 rounded-2xl border border-primary/30 bg-secondary/20 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold">{isNew ? "New affiliate / tool" : "Edit"}</p>
        <button type="button" onClick={onCancel} aria-label="Close" className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={label}>Name *</label>
          <input className={input} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Bluehost" />
        </div>
        <div className="sm:col-span-2">
          <label className={label}>Affiliate URL *</label>
          <input className={input} value={form.url} onChange={(e) => set("url", e.target.value)} placeholder="https://partner.example.com/?ref=you" />
        </div>
        <div className="sm:col-span-2">
          <label className={label}>Description</label>
          <input className={input} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Short one-line pitch" />
        </div>
        <div>
          <label className={label}>Logo / icon URL</label>
          <input className={input} value={form.image_url} onChange={(e) => set("image_url", e.target.value)} placeholder="https://…/logo.png" />
        </div>
        <div>
          <label className={label}>Category</label>
          <input className={input} value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="Hosting / VPN / AI / Domains…" />
        </div>
        <div>
          <label className={label}>CTA label</label>
          <input className={input} value={form.cta} onChange={(e) => set("cta", e.target.value)} placeholder="Visit" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className={label}>Priority</label>
            <input type="number" className={input} value={form.priority} onChange={(e) => set("priority", Number(e.target.value) || 0)} />
          </div>
          <div>
            <label className={label}>Order</label>
            <input type="number" className={input} value={form.sort_order} onChange={(e) => set("sort_order", Number(e.target.value) || 0)} />
          </div>
          <div>
            <label className={label}>Weight</label>
            <input type="number" className={input} value={form.weight} onChange={(e) => set("weight", Number(e.target.value) || 1)} />
          </div>
        </div>
        <div>
          <label className={label}>Starts (optional)</label>
          <input type="datetime-local" className={input} value={form.starts_at} onChange={(e) => set("starts_at", e.target.value)} />
        </div>
        <div>
          <label className={label}>Ends (optional)</label>
          <input type="datetime-local" className={input} value={form.ends_at} onChange={(e) => set("ends_at", e.target.value)} />
        </div>

        <div className="sm:col-span-2">
          <label className={label}>Show in placements</label>
          <div className="flex flex-wrap gap-2">
            {PLACEMENTS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => togglePlacement(p)}
                className={cn(
                  "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
                  form.placements.includes(p)
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border/70 text-muted-foreground hover:border-foreground/20",
                )}
              >
                {PLACEMENT_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} className="h-4 w-4 rounded border-border" />
          Enabled (live)
        </label>
      </div>

      {err ? <p className="mt-3 text-sm text-red-400">{err}</p> : null}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {isNew ? "Create" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium transition hover:bg-secondary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
