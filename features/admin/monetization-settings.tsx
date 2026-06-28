"use client";

import { Loader2, ToggleRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { MonetizationSettings } from "@/lib/monetization/settings";
import { cn } from "@/lib/utils";

const ROWS: { key: keyof MonetizationSettings; label: string; hint: string }[] = [
  { key: "adsterra", label: "Adsterra", hint: "Banners + global social-bar / pop scripts" },
  { key: "propellerads", label: "PropellerAds", hint: "PropellerAds network units" },
  { key: "affiliates", label: "Affiliate offers", hint: "Affiliate CTA on the download-result page" },
  { key: "recommendedTools", label: "Recommended tools", hint: "Curated tool sections (home/footer/sidebar)" },
  { key: "popunder", label: "Pop-under", hint: "Allow pop-under units" },
  { key: "interstitial", label: "Interstitial", hint: "Allow full-page interstitial units" },
];

export function MonetizationSettings({ settings }: { settings: MonetizationSettings }) {
  const router = useRouter();
  const [state, setState] = useState<MonetizationSettings>(settings);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const toggle = (key: keyof MonetizationSettings) =>
    setState((s) => ({ ...s, [key]: !s[key] }));

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/monetization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      const json = await res.json();
      setMsg(
        res.ok
          ? { ok: true, text: "Saved — applies within a minute." }
          : { ok: false, text: json.error ?? "Failed to save." },
      );
      if (res.ok) router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6 rounded-3xl border border-border bg-card p-6 shadow-card">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <ToggleRight className="h-5 w-5 text-primary" /> Monetization controls
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Master switches for each revenue subsystem. Turning one off hides it
        everywhere immediately (cached up to ~60s).
      </p>

      <div className="grid gap-2.5 sm:grid-cols-2">
        {ROWS.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => toggle(r.key)}
            className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-secondary/20 p-3.5 text-left transition hover:border-foreground/20"
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{r.label}</span>
              <span className="block truncate text-xs text-muted-foreground">{r.hint}</span>
            </span>
            <Switch on={state[r.key]} />
          </button>
        ))}
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save controls
        </button>
        {msg ? (
          <span className={cn("text-sm", msg.ok ? "text-green-500" : "text-red-400")}>{msg.text}</span>
        ) : null}
      </div>
    </section>
  );
}

function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
        on ? "bg-primary" : "bg-secondary ring-1 ring-inset ring-border",
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
          on ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </span>
  );
}
