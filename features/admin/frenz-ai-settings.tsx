"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { FRENZ_AI_MAX_FREE_CREDITS, type LandingSettings } from "@/lib/landing/settings";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — the three operator switches
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-08: "make it configurable in admin dashboard where i can turn
 * off frenz ai from unsigned in users when adsense already approved", "make the
 * free users usage credit to be 2 now… and it should be setable in admin
 * dashboard", and "set in admin dashboard so i can turn off anonymous ai usage
 * to show upgrade to pro and i can remove it later".
 *
 * All three were built into the settings store and the API days ago, and NONE
 * of them had a control. They could only be changed by an API call or a direct
 * database write, which is not what "configurable in admin dashboard" means.
 * This is that panel.
 *
 * ── 🔴 ITS OWN FORM, NOT FIELDS ON THE IMAGES ONE ───────────────────────────
 *
 * `LandingEditor` POSTs only the two image fields it owns. That was fine when
 * every other field defaulted; it is fine again now that the route does partial
 * updates. But keeping these three in a separate form means a save HERE sends
 * only these three, and a save THERE sends only those two — so neither panel
 * can ever clobber a field it does not display.
 *
 * That is the same reasoning that gave reward-network routing its own settings
 * key rather than a field on the big monetization object.
 */
export function FrenzAISettings({ settings }: { settings: LandingSettings }) {
  const router = useRouter();
  const [publicEnabled, setPublicEnabled] = useState(settings.frenzAiPublicEnabled);
  const [freeEnabled, setFreeEnabled] = useState(settings.frenzAiFreeEnabled);
  const [credits, setCredits] = useState(String(settings.frenzAiFreeDailyCredits));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/landing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 🔴 Only these three. The route merges, so the image fields this panel
        // knows nothing about are left exactly as they are.
        body: JSON.stringify({
          frenzAiPublicEnabled: publicEnabled,
          frenzAiFreeEnabled: freeEnabled,
          frenzAiFreeDailyCredits: Number(credits) || 0,
        }),
      });
      const json = await res.json();
      setMsg(
        res.ok
          ? { ok: true, text: "Saved. Applies to the next job anybody starts." }
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
    <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <Sparkles className="h-5 w-5 text-primary" /> Frenz AI access
      </h2>
      <p className="mb-6 text-sm text-muted-foreground">
        Who may use AI Clean, and how much they get. Every job costs real provider
        credit, so these are the levers that bound that spend.
      </p>

      <form onSubmit={save} className="space-y-6">
        <Toggle
          label="Visible to signed-out visitors"
          hint="Off hides Frenz AI from anyone not signed in — including the AdSense crawler. Leave on until AdSense has approved the site, which is the reason it is public."
          checked={publicEnabled}
          onChange={setPublicEnabled}
        />

        <Toggle
          label="Free members can use AI Clean"
          hint={
            'Off shows "AI Clean is a Pro feature right now" instead of a counter. Deliberately not the same as setting credits to zero — zero would say "you have used your 0 free cleans today", which is nonsense. Paid plans are unaffected either way.'
          }
          checked={freeEnabled}
          onChange={setFreeEnabled}
        />

        <div>
          <label htmlFor="frenz-ai-credits" className="block text-sm font-semibold">
            Free cleans per day
          </label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            For guests and free members. Paid plans have their own limits and are
            deliberately not settable here — those are abuse ceilings, and an
            operator raising one by mistake is how a stolen session becomes an
            unbounded bill.
          </p>
          <input
            id="frenz-ai-credits"
            type="number"
            inputMode="numeric"
            min={0}
            max={FRENZ_AI_MAX_FREE_CREDITS}
            value={credits}
            onChange={(e) => setCredits(e.target.value)}
            disabled={!freeEnabled}
            className={cn(
              "mt-2 w-28 rounded-xl border border-border bg-background px-3 py-2 text-sm tabular-nums",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              !freeEnabled && "opacity-50",
            )}
          />
          <span className="ml-2 text-xs text-muted-foreground">
            0&ndash;{FRENZ_AI_MAX_FREE_CREDITS}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={busy} className="btn-lux btn-lux-primary">
            {busy ? "Saving…" : "Save"}
          </button>
          {msg ? (
            <p className={cn("text-sm", msg.ok ? "text-emerald-600" : "text-rose-500")}>
              {msg.text}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}

/** A labelled switch. A real checkbox, so it is keyboard- and reader-native. */
function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}
