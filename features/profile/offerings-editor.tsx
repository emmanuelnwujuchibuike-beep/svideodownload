"use client";

import { Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field, INPUT, SaveMessage, TEXTAREA } from "@/features/profile/platform-fields";
import { formatPrice, type Offering, type OfferingKind } from "@/lib/social/profile-platform";
import { cn } from "@/lib/utils";

type Draft = {
  id: string | null;
  kind: OfferingKind;
  name: string;
  description: string;
  price: string;
  currency: string;
  url: string;
  imageUrl: string;
  available: boolean;
};

const GROUPS: { kind: OfferingKind; label: string; noun: string }[] = [
  { kind: "product", label: "Products", noun: "product" },
  { kind: "service", label: "Services", noun: "service" },
];

const blank = (kind: OfferingKind, currency: string): Draft => ({
  id: null,
  kind,
  name: "",
  description: "",
  price: "",
  currency,
  url: "",
  imageUrl: "",
  available: true,
});

/**
 * The business catalogue editor (Feature 18 · Part 14).
 *
 * Price is entered in major units and stored in minor units by the API — one
 * conversion, in one place, on the server. An EMPTY price is kept as "contact
 * for pricing" rather than coerced to zero: a service quoted on enquiry is a
 * real answer, and rendering it as free would misrepresent the business.
 */
export function OfferingsEditor({ initial, defaultCurrency = "NGN" }: { initial: Offering[]; defaultCurrency?: string }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    if (!draft || !draft.name.trim()) {
      setMsg({ ok: false, text: "A name is required." });
      return;
    }
    setBusy(true);
    setMsg(null);
    const payload = {
      kind: draft.kind,
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      price_minor: draft.price.trim() === "" ? null : draft.price.trim(),
      currency: draft.currency.trim() || defaultCurrency,
      url: draft.url.trim() || null,
      image_url: draft.imageUrl.trim() || null,
      available: draft.available,
    };
    try {
      const res = await fetch("/api/profile/offerings", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft.id ? { id: draft.id, ...payload } : payload),
      });
      const json = (await res.json()) as { error?: string; id?: string | null };
      if (!res.ok) {
        setMsg({ ok: false, text: json.error ?? "Couldn't save that." });
        return;
      }
      const priceMinor = payload.price_minor === null ? null : Math.round(Number(String(payload.price_minor).replace(/[\s,]/g, "")) * 100);
      const saved: Offering = {
        id: draft.id ?? json.id ?? crypto.randomUUID(),
        kind: draft.kind,
        name: payload.name,
        description: payload.description,
        priceMinor: Number.isFinite(priceMinor as number) ? (priceMinor as number) : null,
        currency: payload.currency.toUpperCase(),
        url: payload.url,
        imageUrl: payload.image_url,
        available: payload.available,
        position: items.length,
      };
      setItems((list) => (draft.id ? list.map((i) => (i.id === draft.id ? saved : i)) : [...list, saved]));
      setDraft(null);
      setMsg({ ok: true, text: "Saved." });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/profile/offerings?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        setMsg({ ok: false, text: json.error ?? "Couldn't remove that." });
        return;
      }
      setItems((list) => list.filter((i) => i.id !== id));
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  const edit = (o: Offering) =>
    setDraft({
      id: o.id,
      kind: o.kind,
      name: o.name,
      description: o.description ?? "",
      price: o.priceMinor === null ? "" : String(o.priceMinor / 100),
      currency: o.currency,
      url: o.url ?? "",
      imageUrl: o.imageUrl ?? "",
      available: o.available,
    });

  return (
    <div className="space-y-5">
      {GROUPS.map((group) => {
        const rows = items.filter((i) => i.kind === group.kind);
        return (
          <section key={group.kind}>
            <div className="flex items-center justify-between gap-2 px-1.5">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{group.label}</p>
              <button
                type="button"
                onClick={() => setDraft(blank(group.kind, defaultCurrency))}
                className="inline-flex items-center gap-1 rounded-full bg-secondary/60 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition hover:text-foreground"
              >
                <Plus className="h-3 w-3" /> Add {group.noun}
              </button>
            </div>

            {rows.length === 0 ? (
              <p className="mt-2 rounded-2xl border border-dashed border-border/70 px-3.5 py-3 text-xs text-muted-foreground">
                Nothing here yet. This section stays hidden from visitors until you add a {group.noun}.
              </p>
            ) : (
              <div className="mt-2 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
                <div className="divide-y divide-border/60">
                  {rows.map((o) => (
                    <div key={o.id} className="flex items-start gap-3 px-3.5 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{o.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatPrice(o.priceMinor, o.currency) ?? "Contact for pricing"}
                          {o.available ? "" : " · Unavailable"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => edit(o)}
                        aria-label={`Edit ${o.name}`}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(o.id)}
                        disabled={busy}
                        aria-label={`Remove ${o.name}`}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        );
      })}

      {draft ? (
        <div className="rounded-2xl border border-primary/40 bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-bold">
              {draft.id ? "Edit" : "Add"} {draft.kind}
            </p>
            <button
              type="button"
              onClick={() => setDraft(null)}
              aria-label="Cancel"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-3">
            <Field label="Name">
              <input className={INPUT} value={draft.name} maxLength={140} autoFocus onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label="Description">
              <textarea className={TEXTAREA} value={draft.description} maxLength={1000} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
              <Field label="Price" hint="Leave empty for “contact for pricing”.">
                <input
                  className={INPUT}
                  value={draft.price}
                  inputMode="decimal"
                  onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                  placeholder="12500"
                />
              </Field>
              <Field label="Currency">
                <input
                  className={cn(INPUT, "uppercase")}
                  value={draft.currency}
                  maxLength={3}
                  onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() })}
                />
              </Field>
            </div>
            <Field label="Link" hint="Where someone buys or books this.">
              <input className={INPUT} value={draft.url} inputMode="url" onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://…" />
            </Field>
            <Field label="Image link">
              <input className={INPUT} value={draft.imageUrl} inputMode="url" onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })} placeholder="https://…" />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.available}
                onChange={(e) => setDraft({ ...draft, available: e.target.checked })}
                className="h-4 w-4 rounded border-border accent-[hsl(var(--primary))]"
              />
              Available now
            </label>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button type="button" onClick={() => void save()} disabled={busy} className="btn-lux btn-lux-primary">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
            </button>
            <button type="button" onClick={() => setDraft(null)} className="btn-lux btn-lux-secondary">
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className={cn(draft && "hidden")}>
        <SaveMessage msg={msg} />
      </div>
    </div>
  );
}
