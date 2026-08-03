"use client";

import { Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field, INPUT, SaveMessage, TEXTAREA } from "@/features/profile/platform-fields";
import { CREDENTIAL_KINDS, type Credential, type CredentialKind } from "@/lib/social/profile-platform";
import { cn } from "@/lib/utils";

type Draft = {
  id: string | null;
  kind: CredentialKind;
  title: string;
  organization: string;
  description: string;
  url: string;
  startedOn: string;
  endedOn: string;
  isCurrent: boolean;
};

const blank = (kind: CredentialKind): Draft => ({
  id: null,
  kind,
  title: "",
  organization: "",
  description: "",
  url: "",
  startedOn: "",
  endedOn: "",
  isCurrent: false,
});

/**
 * The professional showcase editor (Feature 18 · Part 14) — portfolio projects,
 * experience, education, certifications, awards and publications.
 *
 * All six live in one table with a `kind`, so they get one editor: the fields
 * are identical, only the words change. Dates are FREE TEXT, deliberately —
 * forcing a member to pick an exact day for a job they held "sometime in 2019"
 * makes them either invent one or leave the entry out.
 */
export function CredentialsEditor({ initial }: { initial: Credential[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    if (!draft || !draft.title.trim()) {
      setMsg({ ok: false, text: "A title is required." });
      return;
    }
    setBusy(true);
    setMsg(null);
    const payload = {
      kind: draft.kind,
      title: draft.title.trim(),
      organization: draft.organization.trim() || null,
      description: draft.description.trim() || null,
      url: draft.url.trim() || null,
      started_on: draft.startedOn.trim() || null,
      ended_on: draft.isCurrent ? null : draft.endedOn.trim() || null,
      is_current: draft.isCurrent,
    };
    try {
      const res = await fetch("/api/profile/credentials", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft.id ? { id: draft.id, ...payload } : payload),
      });
      const json = (await res.json()) as { error?: string; id?: string | null };
      if (!res.ok) {
        setMsg({ ok: false, text: json.error ?? "Couldn't save that." });
        return;
      }
      const saved: Credential = {
        id: draft.id ?? json.id ?? crypto.randomUUID(),
        kind: draft.kind,
        title: payload.title,
        organization: payload.organization,
        description: payload.description,
        url: payload.url,
        imageUrl: null,
        startedOn: payload.started_on,
        endedOn: payload.ended_on,
        isCurrent: payload.is_current,
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
      const res = await fetch(`/api/profile/credentials?id=${encodeURIComponent(id)}`, { method: "DELETE" });
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

  const edit = (c: Credential) =>
    setDraft({
      id: c.id,
      kind: c.kind,
      title: c.title,
      organization: c.organization ?? "",
      description: c.description ?? "",
      url: c.url ?? "",
      startedOn: c.startedOn ?? "",
      endedOn: c.endedOn ?? "",
      isCurrent: c.isCurrent,
    });

  return (
    <div className="space-y-5">
      {CREDENTIAL_KINDS.map((group) => {
        const rows = items.filter((i) => i.kind === group.kind);
        return (
          <section key={group.kind}>
            <div className="flex items-center justify-between gap-2 px-1.5">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{group.label}</p>
              <button
                type="button"
                onClick={() => setDraft(blank(group.kind))}
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
                  {rows.map((c) => (
                    <div key={c.id} className="flex items-start gap-3 px-3.5 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{c.title}</p>
                        {c.organization ? <p className="truncate text-xs text-muted-foreground">{c.organization}</p> : null}
                        {c.startedOn || c.endedOn || c.isCurrent ? (
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {[c.startedOn, c.isCurrent ? "Present" : c.endedOn].filter(Boolean).join(" — ")}
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => edit(c)}
                        aria-label={`Edit ${c.title}`}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(c.id)}
                        disabled={busy}
                        aria-label={`Remove ${c.title}`}
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
              {draft.id ? "Edit" : "Add"} {CREDENTIAL_KINDS.find((k) => k.kind === draft.kind)?.noun}
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
            <Field label="Title">
              <input
                className={INPUT}
                value={draft.title}
                maxLength={140}
                autoFocus
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder={draft.kind === "experience" ? "Senior Designer" : "Title"}
              />
            </Field>
            <Field label={draft.kind === "education" ? "School" : draft.kind === "certification" ? "Issuer" : "Organization"}>
              <input
                className={INPUT}
                value={draft.organization}
                maxLength={140}
                onChange={(e) => setDraft({ ...draft, organization: e.target.value })}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="From" hint="Any format — “2019”, “Mar 2019”.">
                <input className={INPUT} value={draft.startedOn} maxLength={40} onChange={(e) => setDraft({ ...draft, startedOn: e.target.value })} />
              </Field>
              <Field label="To">
                <input
                  className={INPUT}
                  value={draft.isCurrent ? "" : draft.endedOn}
                  disabled={draft.isCurrent}
                  maxLength={40}
                  onChange={(e) => setDraft({ ...draft, endedOn: e.target.value })}
                  placeholder={draft.isCurrent ? "Present" : ""}
                />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.isCurrent}
                onChange={(e) => setDraft({ ...draft, isCurrent: e.target.checked })}
                className="h-4 w-4 rounded border-border accent-[hsl(var(--primary))]"
              />
              Still here
            </label>
            <Field label="Description">
              <textarea
                className={TEXTAREA}
                value={draft.description}
                maxLength={1000}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </Field>
            <Field label="Link">
              <input
                className={INPUT}
                value={draft.url}
                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                inputMode="url"
                placeholder="https://…"
              />
            </Field>
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
