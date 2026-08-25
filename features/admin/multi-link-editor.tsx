"use client";

import { Layers, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Switch } from "@/components/ui/switch";
import { MAX_BATCH_ITEMS, type MultiLinkSettings } from "@/lib/downloads/multi-link-config";
import { cn } from "@/lib/utils";

/**
 * Admin → Multi-Link Batch Downloader (§34).
 *
 * Follows `MomentumEditor`'s shape exactly — one settings key, a save button,
 * `router.refresh()` on success — rather than introducing a second admin
 * pattern for one panel ("Do not create a separate admin system if one already
 * exists").
 *
 * ── Imports the CONFIG module, not the server one ─────────────────────────
 * `@/lib/downloads/multi-link-config` is the pure half; `@/lib/downloads/
 * multi-link` reaches `server-only` through Supabase and would break the build
 * from a `"use client"` file — silently as far as `tsc` is concerned. This is
 * why the split exists.
 */
export function MultiLinkEditor({ settings }: { settings: MultiLinkSettings }) {
  const router = useRouter();
  const [state, setState] = useState<MultiLinkSettings>(settings);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const set = <K extends keyof MultiLinkSettings>(k: K, v: MultiLinkSettings[K]) =>
    setState((s) => ({ ...s, [k]: v }));

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/multi-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      const json = await res.json();
      setMsg(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: json.error ?? "Failed." });
      if (res.ok) router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  const input =
    "h-10 w-full rounded-xl bg-background px-3 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary";
  const label = "mb-1 block text-xs font-medium text-muted-foreground";
  const num = (v: string, min: number, max: number) =>
    Math.max(min, Math.min(max, Math.floor(Number(v) || min)));

  return (
    <section className="mt-6 rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <Layers className="h-5 w-5 text-primary" /> Multi-Link Batch Downloader
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        The &ldquo;＋ Multiple Links&rdquo; panel under the paste box. Every limit here is enforced
        server-side at <code className="rounded bg-secondary px-1 text-xs">/api/downloads/batch/*</code> —
        the client only draws them.
      </p>

      <div className="space-y-3">
        <Row
          title="Feature visibility"
          hint="Off hides the ＋ Multiple Links control everywhere and refuses batch requests."
        >
          <Switch checked={state.enabled} onChange={() => set("enabled", !state.enabled)} label="Feature visibility" />
        </Row>
        <Row
          title="Reward ad required"
          hint="A free batch runs only after a rewarded ad has been watched in full."
        >
          <Switch checked={state.rewardRequired} onChange={() => set("rewardRequired", !state.rewardRequired)} label="Reward ad required" />
        </Row>
        <Row title="Pro skips the reward ad" hint="Off means paying members watch it too.">
          <Switch checked={state.proSkipsReward} onChange={() => set("proSkipsReward", !state.proSkipsReward)} label="Pro skips the reward ad" />
        </Row>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className={label} htmlFor="ml-free-sources">
            Free sources / batch
          </label>
          <input
            id="ml-free-sources"
            type="number"
            min={1}
            max={20}
            className={input}
            value={state.freeSourceLimit}
            onChange={(e) => set("freeSourceLimit", num(e.target.value, 1, 20))}
          />
        </div>
        <div>
          <label className={label} htmlFor="ml-pro-sources">
            Pro sources / batch
          </label>
          <input
            id="ml-pro-sources"
            type="number"
            min={1}
            max={20}
            className={input}
            value={state.proSourceLimit}
            onChange={(e) => set("proSourceLimit", num(e.target.value, 1, 20))}
          />
        </div>
        <div>
          <label className={label} htmlFor="ml-free-batches">
            Free batches / day
          </label>
          <input
            id="ml-free-batches"
            type="number"
            min={0}
            max={100}
            className={input}
            value={state.freeDailyBatches}
            onChange={(e) => set("freeDailyBatches", num(e.target.value, 0, 100))}
          />
        </div>
        <div>
          <label className={label} htmlFor="ml-fetch-concurrency">
            Fetch concurrency
          </label>
          <input
            id="ml-fetch-concurrency"
            type="number"
            min={1}
            max={6}
            className={input}
            value={state.fetchConcurrency}
            onChange={(e) => set("fetchConcurrency", num(e.target.value, 1, 6))}
          />
        </div>
      </div>

      <div className="mt-3">
        <label className={label} htmlFor="ml-upsell">
          Pro upsell message
        </label>
        <input
          id="ml-upsell"
          type="text"
          maxLength={200}
          className={input}
          value={state.upsellMessage}
          onChange={(e) => set("upsellMessage", e.target.value)}
        />
      </div>

      {/*
        Stated, not silently absent. Download concurrency is NOT an admin field
        because there is no separate batch queue to tune: batch items go into
        `features/downloads/manager.ts`, whose MAX_CONCURRENT already governs
        every download on the site. An admin control here would be a second
        number that changes nothing — the dead affordance this dashboard keeps
        having to delete. Same for the item cap, which is fixed by what the
        reward-session API accepts.
      */}
      <p className="mt-3 text-xs text-muted-foreground">
        Items per batch is capped at {MAX_BATCH_ITEMS} by the reward-session API. Download concurrency is
        the shared download manager&apos;s, not a batch-specific setting.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save settings
        </button>
        {msg ? (
          <span className={cn("text-sm", msg.ok ? "text-green-500" : "text-red-400")}>{msg.text}</span>
        ) : null}
      </div>
    </section>
  );
}

function Row({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/70 bg-background/50 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  );
}
