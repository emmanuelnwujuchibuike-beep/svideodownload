"use client";

import { Activity, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { PlatformStatusChip } from "@/components/platform/platform-status-dot";
import { BRAND_ICONS } from "@/lib/platform-icons";
import { PLATFORMS } from "@/lib/platforms";
import {
  PLATFORM_STATUS_META,
  type PlatformStatus,
  type PlatformStatusMap,
} from "@/lib/platform-status";
import { cn } from "@/lib/utils";
import type { PlatformId } from "@/types";

/**
 * Admin → "Platform status". Declares which download sources are working, which
 * paints the green/amber/red light on every platform logo across the site.
 *
 * ── Why an operator declares this instead of the app detecting it ──────────
 * See the long note in lib/platform-status.ts. Short version: a download failing
 * could be one bad URL, a region block, a rate limit or the platform shipping a
 * new player, and nothing in this codebase can tell those apart. An operator
 * can, so an operator says.
 *
 * ── `generic` is excluded ─────────────────────────────────────────────────
 * It is the yt-dlp catch-all for every site with no dedicated extractor, not a
 * platform anybody recognises. "Other sites: partly working" would be true of
 * the internet on any given day and tells a visitor nothing.
 */
const EDITABLE = (Object.keys(PLATFORMS) as PlatformId[]).filter((id) => id !== "generic");

const OPTIONS: PlatformStatus[] = ["operational", "partial", "down"];

export function PlatformStatusEditor({ initial }: { initial: PlatformStatusMap }) {
  const router = useRouter();
  const [map, setMap] = useState<PlatformStatusMap>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const statusFor = (id: PlatformId): PlatformStatus => map[id]?.status ?? "operational";

  const set = (id: PlatformId, status: PlatformStatus) =>
    setMap((m) => ({ ...m, [id]: { ...m[id], status, updatedAt: new Date().toISOString() } }));

  const setNote = (id: PlatformId, note: string) =>
    setMap((m) => ({
      ...m,
      [id]: { status: m[id]?.status ?? "operational", updatedAt: new Date().toISOString(), note },
    }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      /*
        Only NON-operational platforms are sent. The map is a list of exceptions,
        so writing "operational" for all thirteen would store a row that says
        nothing and grow every time a platform is added. Omission IS operational
        — the same rule `statusOf` reads by.
      */
      const statuses: Record<string, { status: PlatformStatus; note?: string }> = {};
      for (const id of EDITABLE) {
        const s = statusFor(id);
        if (s === "operational") continue;
        const note = map[id]?.note?.trim();
        statuses[id] = { status: s, ...(note ? { note } : {}) };
      }
      const res = await fetch("/api/admin/platform-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statuses }),
      });
      const json = await res.json();
      setMsg(
        res.ok
          ? { ok: true, text: "Saved — live across the site within a minute." }
          : { ok: false, text: json.error ?? "Failed to save." },
      );
      if (res.ok) router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  const degraded = EDITABLE.filter((id) => statusFor(id) !== "operational");

  return (
    <section className="rounded-3xl border border-border bg-card p-6 shadow-card">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <Activity className="h-5 w-5 text-primary" /> Platform status
      </h2>
      <p className="mb-5 text-sm text-muted-foreground">
        Sets the small green / amber / red light on every platform logo across the
        site. Use it when a platform breaks so people stop retrying — and
        remember to set it back.
      </p>

      {/*
        A live count, because the real risk with this panel is not setting a
        status — it is FORGETTING one. A red badge left on a platform that
        recovered weeks ago is worse than no badge at all: it turns away
        downloads that would have worked.
      */}
      <p className="mb-5 text-xs text-muted-foreground">
        {degraded.length === 0 ? (
          <span className="text-emerald-600 dark:text-emerald-400">
            All platforms reported working — no badges are shown to visitors.
          </span>
        ) : (
          <span className="text-amber-600 dark:text-amber-400">
            {degraded.length} platform{degraded.length === 1 ? "" : "s"} flagged. Visitors see a
            badge on {degraded.length === 1 ? "it" : "them"} everywhere.
          </span>
        )}
      </p>

      <form onSubmit={save} className="space-y-3">
        {EDITABLE.map((id) => {
          const p = PLATFORMS[id];
          const Icon = BRAND_ICONS[id];
          const status = statusFor(id);
          const changed = map[id]?.updatedAt;
          return (
            <div key={id} className="rounded-2xl border border-border/60 bg-secondary/20 p-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-background ring-1 ring-inset ring-border/60">
                  {Icon ? <Icon className="h-5 w-5" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{p.name}</span>
                  {status !== "operational" && changed ? (
                    <span className="block text-[11px] text-muted-foreground">
                      Flagged {new Date(changed).toLocaleDateString()}
                    </span>
                  ) : null}
                </span>
                <PlatformStatusChip status={status} />
              </div>

              {/* A segmented control, not a dropdown: three options that a person
                  compares at a glance, and the colour is part of the choice. */}
              <div className="mt-2.5 grid grid-cols-3 gap-1.5">
                {OPTIONS.map((opt) => {
                  const meta = PLATFORM_STATUS_META[opt];
                  const active = status === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => set(id, opt)}
                      aria-pressed={active}
                      className={cn(
                        "flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-semibold transition",
                        active
                          ? "bg-background shadow-sm ring-1 ring-inset ring-border"
                          : "text-muted-foreground hover:bg-background/60",
                        active && meta.text,
                      )}
                    >
                      <span className={cn("h-2 w-2 rounded-full", meta.dot)} aria-hidden />
                      {meta.short}
                    </button>
                  );
                })}
              </div>

              {/* The note only exists for a flagged platform — there is nothing
                  worth saying about one that works. */}
              {status !== "operational" ? (
                <input
                  type="text"
                  value={map[id]?.note ?? ""}
                  onChange={(e) => setNote(id, e.target.value)}
                  maxLength={140}
                  placeholder="Optional note — e.g. “HD works, 4K failing”"
                  className="mt-2 w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-primary"
                />
              ) : null}
            </div>
          );
        })}

        <div className="pt-1">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save platform status
          </button>
          {msg ? (
            <span className={cn("ml-3 text-sm", msg.ok ? "text-green-500" : "text-red-400")}>{msg.text}</span>
          ) : null}
        </div>
      </form>
    </section>
  );
}
