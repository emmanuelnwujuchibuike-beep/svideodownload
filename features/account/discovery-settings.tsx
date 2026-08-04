"use client";

import { Loader2, Lock } from "lucide-react";
import { useCallback, useState } from "react";

import { SEARCH_FIELDS, type DiscoverySettings, type SearchFieldKey } from "@/lib/discovery/fields";
import { cn } from "@/lib/utils";

/**
 * Who can find you, and by what (Part 18).
 *
 * ── The sensitive fields are visibly marked ──────────────────────────────
 * City and country carry a "Location" note and start OFF. A settings screen
 * that lists them in the same flat list as "Headline" invites a member to
 * switch everything on without noticing they just made themselves
 * enumerable by proximity. They are grouped and labelled so the decision is a
 * decision.
 *
 * Saves per control, immediately. A privacy screen must never show a state it
 * has not persisted — every toggle reverts visibly if the write fails.
 */
export function DiscoverySettingsPanel({ initial }: { initial: DiscoverySettings }) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(
    async (patch: Record<string, unknown>, key: string, next: DiscoverySettings) => {
      const previous = value;
      setValue(next);
      setBusy(key);
      setError(null);
      try {
        const res = await fetch("/api/discovery/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(json.error ?? "Couldn't save that.");
        }
      } catch (e) {
        setValue(previous);
        setError(e instanceof Error ? e.message : "Couldn't save that.");
      } finally {
        setBusy(null);
      }
    },
    [value],
  );

  const toggleField = (key: SearchFieldKey) => {
    const on = value.fields.includes(key);
    const fields = on ? value.fields.filter((f) => f !== key) : [...value.fields, key];
    void save({ fields }, key, { ...value, fields });
  };

  const optional = SEARCH_FIELDS.filter((f) => !f.required);
  const ordinary = optional.filter((f) => !f.sensitive);
  const sensitive = optional.filter((f) => f.sensitive);

  return (
    <div className="space-y-5">
      <Row
        title="Let people find me"
        blurb="When this is off, only someone who already knows your exact @username can find you."
        checked={value.discoverable}
        busy={busy === "discoverable"}
        onChange={() =>
          void save({ discoverable: !value.discoverable }, "discoverable", {
            ...value,
            discoverable: !value.discoverable,
          })
        }
      />

      <section>
        <h2 className="px-0.5 text-sm font-bold">What you can be found by</h2>
        <p className="mt-0.5 px-0.5 text-xs text-muted-foreground">
          Your username and name always work — that&apos;s how people reach a profile they already know.
        </p>
        <div className="mt-2 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
          {SEARCH_FIELDS.filter((f) => f.required).map((f) => (
            <div key={f.key} className="flex items-center gap-3 border-b border-border/60 px-3.5 py-2.5 last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{f.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{f.blurb}</span>
              </span>
              <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Always on" />
            </div>
          ))}
          {ordinary.map((f) => (
            <FieldRow
              key={f.key}
              label={f.label}
              blurb={f.blurb}
              checked={value.fields.includes(f.key)}
              disabled={!value.discoverable}
              busy={busy === f.key}
              onChange={() => toggleField(f.key)}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="px-0.5 text-sm font-bold">Location</h2>
        <p className="mt-0.5 px-0.5 text-xs leading-relaxed text-muted-foreground">
          Off by default. Being findable by name is what a profile is for; being findable by where you are is a
          different thing, so it only happens if you ask for it.
        </p>
        <div className="mt-2 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
          {sensitive.map((f) => (
            <FieldRow
              key={f.key}
              label={f.label}
              blurb={f.blurb}
              checked={value.fields.includes(f.key)}
              disabled={!value.discoverable}
              busy={busy === f.key}
              onChange={() => toggleField(f.key)}
            />
          ))}
        </div>
      </section>

      <Row
        title="List me in the public directory"
        blurb="Appear in the browsable directory for your category. Off by default."
        checked={value.directoryListed}
        busy={busy === "directory"}
        disabled={!value.discoverable}
        onChange={() =>
          void save({ directoryListed: !value.directoryListed }, "directory", {
            ...value,
            directoryListed: !value.directoryListed,
          })
        }
      />

      {error ? <p className="text-xs font-medium text-rose-500">{error}</p> : null}
    </div>
  );
}

function Row({
  title,
  blurb,
  checked,
  busy,
  disabled,
  onChange,
}: {
  title: string;
  blurb: string;
  checked: boolean;
  busy: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border/70 bg-card px-3.5 py-3 shadow-sm">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{blurb}</span>
      </span>
      <Switch checked={checked} busy={busy} disabled={disabled} onChange={onChange} label={title} />
    </div>
  );
}

function FieldRow({
  label,
  blurb,
  checked,
  busy,
  disabled,
  onChange,
}: {
  label: string;
  blurb: string;
  checked: boolean;
  busy: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b border-border/60 px-3.5 py-2.5 last:border-0",
        disabled && "opacity-50",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{blurb}</span>
      </span>
      <Switch checked={checked} busy={busy} disabled={disabled} onChange={onChange} label={label} />
    </div>
  );
}

function Switch({
  checked,
  busy,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  busy: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={busy || disabled}
      onClick={onChange}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-60",
        checked ? "bg-primary" : "bg-secondary ring-1 ring-inset ring-border",
      )}
    >
      {busy ? (
        <Loader2 className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 animate-spin text-white" />
      ) : (
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
            checked ? "left-[22px]" : "left-0.5",
          )}
        />
      )}
    </button>
  );
}
