"use client";

import { Loader2, Megaphone, Pencil, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AD_FORMATS, AD_ZONES } from "@/lib/monetization/ad-schema";
import type { AdRecord } from "@/lib/monetization/ads";
import { cn } from "@/lib/utils";

type Zone = (typeof AD_ZONES)[number];
type Format = (typeof AD_FORMATS)[number];

interface FormState {
  zone: Zone;
  network: string;
  format: Format;
  script_code: string;
  image_url: string;
  target_url: string;
  headline: string;
  width: string;
  height: string;
  priority: number;
  weight: number;
  active: boolean;
}

const EMPTY: FormState = {
  zone: "homepage_top",
  network: "adsterra",
  format: "display",
  script_code: "",
  image_url: "",
  target_url: "",
  headline: "",
  width: "",
  height: "",
  priority: 100,
  weight: 1,
  active: true,
};

const recordToForm = (r: AdRecord): FormState => ({
  zone: r.zone as Zone,
  network: r.network,
  format: r.format as Format,
  script_code: r.script_code ?? "",
  image_url: r.image_url ?? "",
  target_url: r.target_url ?? "",
  headline: r.headline ?? "",
  width: r.width != null ? String(r.width) : "",
  height: r.height != null ? String(r.height) : "",
  priority: r.priority,
  weight: r.weight,
  active: r.active,
});

export function AdManager({ ads }: { ads: AdRecord[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const openNew = () => {
    setForm(EMPTY);
    setErr(null);
    setEditing("new");
  };
  const openEdit = (r: AdRecord) => {
    setForm(recordToForm(r));
    setErr(null);
    setEditing(r.id);
  };
  const close = () => {
    setEditing(null);
    setErr(null);
  };

  const payload = () => ({
    zone: form.zone,
    network: form.network.trim(),
    format: form.format,
    script_code: form.script_code.trim() || null,
    image_url: form.image_url.trim() || null,
    target_url: form.target_url.trim() || null,
    headline: form.headline.trim() || null,
    width: form.width ? Number(form.width) : null,
    height: form.height ? Number(form.height) : null,
    priority: form.priority,
    weight: form.weight,
    active: form.active,
  });

  const save = async () => {
    if (!form.network.trim()) {
      setErr("Network is required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const isNew = editing === "new";
      const res = await fetch(isNew ? "/api/admin/ads" : `/api/admin/ads/${editing}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
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
    if (!confirm("Delete this ad placement?")) return;
    await fetch(`/api/admin/ads/${id}`, { method: "DELETE" });
    router.refresh();
  };

  const toggleActive = async (r: AdRecord) => {
    await fetch(`/api/admin/ads/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !r.active }),
    });
    router.refresh();
  };

  return (
    <section className="mt-6 rounded-3xl border border-border bg-card p-6 shadow-card">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Megaphone className="h-5 w-5 text-primary" /> Ad placements
        </h2>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Paste your Adsterra / PropellerAds embed code per zone. Network names
        containing &quot;adsterra&quot; / &quot;propeller&quot; respect the global toggles above.
      </p>

      {editing ? (
        <AdForm
          form={form}
          setForm={setForm}
          onSave={save}
          onCancel={close}
          busy={busy}
          err={err}
          isNew={editing === "new"}
        />
      ) : null}

      {ads.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No ad placements yet. Add one and seed your network embed code.
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {ads.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{r.zone}</span>
                  <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                    {r.network}
                  </span>
                  <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    {r.format}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {r.headline || (r.script_code ? "script embed" : r.target_url || "—")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => toggleActive(r)}
                aria-pressed={r.active}
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold transition",
                  r.active ? "bg-green-500/15 text-green-500" : "bg-secondary text-muted-foreground",
                )}
              >
                {r.active ? "Live" : "Off"}
              </button>
              <button type="button" onClick={() => openEdit(r)} aria-label="Edit" className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground">
                <Pencil className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => remove(r.id)} aria-label="Delete" className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-red-400">
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AdForm({
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
  const isDisplayOrPop = form.format === "display" || form.format === "pop";

  return (
    <div className="mb-5 rounded-2xl border border-primary/30 bg-secondary/20 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold">{isNew ? "New ad placement" : "Edit ad"}</p>
        <button type="button" onClick={onCancel} aria-label="Close" className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={label}>Zone</label>
          <select className={input} value={form.zone} onChange={(e) => set("zone", e.target.value as Zone)}>
            {AD_ZONES.map((z) => (
              <option key={z} value={z}>{z}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Network</label>
          <input className={input} value={form.network} onChange={(e) => set("network", e.target.value)} placeholder="adsterra / propellerads / house" />
        </div>
        <div>
          <label className={label}>Format</label>
          <select className={input} value={form.format} onChange={(e) => set("format", e.target.value as Format)}>
            {AD_FORMATS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>

        {form.format !== "native" ? (
          <div className="sm:col-span-3">
            <label className={label}>Embed / script code</label>
            <textarea
              className="min-h-[90px] w-full rounded-xl bg-background p-3 font-mono text-xs outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
              value={form.script_code}
              onChange={(e) => set("script_code", e.target.value)}
              placeholder="<script ...>…</script>"
            />
          </div>
        ) : null}

        {form.format === "native" ? (
          <>
            <div className="sm:col-span-3">
              <label className={label}>Headline</label>
              <input className={input} value={form.headline} onChange={(e) => set("headline", e.target.value)} placeholder="Sponsored headline" />
            </div>
            <div className="sm:col-span-2">
              <label className={label}>Target URL</label>
              <input className={input} value={form.target_url} onChange={(e) => set("target_url", e.target.value)} placeholder="https://…" />
            </div>
            <div>
              <label className={label}>Image URL</label>
              <input className={input} value={form.image_url} onChange={(e) => set("image_url", e.target.value)} placeholder="https://…" />
            </div>
          </>
        ) : null}

        {isDisplayOrPop ? (
          <>
            <div>
              <label className={label}>Width (px)</label>
              <input type="number" className={input} value={form.width} onChange={(e) => set("width", e.target.value)} placeholder="300" />
            </div>
            <div>
              <label className={label}>Height (px)</label>
              <input type="number" className={input} value={form.height} onChange={(e) => set("height", e.target.value)} placeholder="250" />
            </div>
            <div />
          </>
        ) : null}

        <div>
          <label className={label}>Priority</label>
          <input type="number" className={input} value={form.priority} onChange={(e) => set("priority", Number(e.target.value) || 0)} />
        </div>
        <div>
          <label className={label}>Weight</label>
          <input type="number" className={input} value={form.weight} onChange={(e) => set("weight", Number(e.target.value) || 1)} />
        </div>
        <label className="flex items-center gap-2 self-end text-sm">
          <input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} className="h-4 w-4 rounded border-border" />
          Live
        </label>
      </div>

      {err ? <p className="mt-3 text-sm text-red-400">{err}</p> : null}

      <div className="mt-4 flex gap-2">
        <button type="button" onClick={onSave} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {isNew ? "Create" : "Save changes"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium transition hover:bg-secondary">
          Cancel
        </button>
      </div>
    </div>
  );
}
