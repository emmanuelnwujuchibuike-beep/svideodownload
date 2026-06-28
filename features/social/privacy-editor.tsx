"use client";

import { Loader2, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { PrivacySettings } from "@/lib/social/profile";
import { cn } from "@/lib/utils";

type Choice = { value: string; label: string };
const VIS: Choice[] = [
  { value: "public", label: "Everyone" },
  { value: "followers", label: "Followers" },
  { value: "private", label: "Only me" },
];
const POLICY: Choice[] = [
  { value: "everyone", label: "Everyone" },
  { value: "followers", label: "Followers" },
  { value: "off", label: "Off" },
];

export function PrivacyEditor({ settings }: { settings: PrivacySettings }) {
  const router = useRouter();
  const [state, setState] = useState<PrivacySettings>(settings);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const set = <K extends keyof PrivacySettings>(k: K, v: PrivacySettings[K]) =>
    setState((s) => ({ ...s, [k]: v }));

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/privacy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      const json = await res.json();
      setMsg(res.ok ? { ok: true, text: "Privacy saved." } : { ok: false, text: json.error ?? "Failed to save." });
      if (res.ok) router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="privacy" className="scroll-mt-24 border-b border-border/60 p-6 sm:p-8">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="h-5 w-5 text-primary" /> Privacy
      </h2>
      <p className="mb-4 text-xs text-muted-foreground">
        Privacy always overrides recommendations and discovery.
      </p>

      <div className="space-y-3">
        <Row label="Activity visibility" value={state.activity_visibility} choices={VIS} onChange={(v) => set("activity_visibility", v as PrivacySettings["activity_visibility"])} />
        <Row label="Who can see followers" value={state.followers_visibility} choices={VIS} onChange={(v) => set("followers_visibility", v as PrivacySettings["followers_visibility"])} />
        <Row label="Who can comment" value={state.comments_policy} choices={POLICY} onChange={(v) => set("comments_policy", v as PrivacySettings["comments_policy"])} />
        <Row label="Who can message you" value={state.messages_policy} choices={POLICY} onChange={(v) => set("messages_policy", v as PrivacySettings["messages_policy"])} />
        <Toggle label="Allow search engines to index my profile" on={state.allow_indexing} onToggle={() => set("allow_indexing", !state.allow_indexing)} />
        <Toggle label="Show me in recommendations" on={state.show_in_recommendations} onToggle={() => set("show_in_recommendations", !state.show_in_recommendations)} />
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save privacy
        </button>
        {msg ? (
          <span className={cn("text-sm", msg.ok ? "text-green-500" : "text-red-400")}>{msg.text}</span>
        ) : null}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string;
  choices: Choice[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-secondary/20 p-3">
      <span className="text-sm">{label}</span>
      <div className="inline-flex rounded-lg bg-background p-0.5 ring-1 ring-inset ring-border">
        {choices.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => onChange(c.value)}
            aria-pressed={value === c.value}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition",
              value === c.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      className="flex w-full items-center justify-between gap-2 rounded-xl border border-border/60 bg-secondary/20 p-3 text-left"
    >
      <span className="text-sm">{label}</span>
      <span
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
          on ? "bg-primary" : "bg-secondary ring-1 ring-inset ring-border",
        )}
      >
        <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform", on ? "translate-x-5" : "translate-x-0.5")} />
      </span>
    </button>
  );
}
