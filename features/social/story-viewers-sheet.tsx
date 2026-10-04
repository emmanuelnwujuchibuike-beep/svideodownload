"use client";

import { Camera, Eye, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { formatRelative } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHO SAW IT — the author's own list (2026-10-04, migration 0181)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner: "make users see who viewed and screenshotted their story."
 *
 * Opens only on the author's own story. The route refuses anybody else with a
 * 403 and RLS refuses them underneath that, so this component never has to
 * decide who may look — it only has to not offer the control to the wrong
 * person, which the viewer does by checking `isOwn`.
 *
 * ── 🔴 THE SCREENSHOT COLUMN IS HONEST ABOUT ITSELF ───────────────────────
 *
 * The reciprocity rule (see the route) means an author who turned the switch
 * off gets `screenshotAlerts: false` and every `screenshotted` flag comes back
 * false. This sheet then says SO, in a line at the bottom, rather than showing
 * an empty camera column that reads as "nobody screenshotted it". A quiet false
 * negative is the one failure mode that would make the feature untrustworthy.
 *
 * There is a second, larger honesty problem and it is stated in the same line:
 * **the web cannot detect a screenshot.** No browser exposes it, and this app
 * ships as a PWA and a TWA, both of which are web views. The plumbing here is
 * real and complete — the table, the switch, the rule, this list — but until
 * there is a native shell to report it from, the column stays empty because
 * nothing can legitimately fill it, not because nobody is screenshotting.
 */

interface Viewer {
  id: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  viewedAt: string;
  screenshotted: boolean;
}

export function StoryViewersSheet({ storyId, open, onClose }: { storyId: string; open: boolean; onClose: () => void }) {
  const [viewers, setViewers] = useState<Viewer[] | null>(null);
  const [alertsOn, setAlertsOn] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setViewers(null);
    setProblem(null);
    void (async () => {
      try {
        const res = await fetch(`/api/stories/${encodeURIComponent(storyId)}/views`, { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (!alive) return;
        if (!res.ok) {
          setProblem(json?.error ?? "Couldn't load viewers.");
          setViewers([]);
          return;
        }
        setAlertsOn(json.screenshotAlerts !== false);
        setViewers(json.viewers as Viewer[]);
      } catch {
        if (alive) {
          setProblem("Couldn't load viewers.");
          setViewers([]);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, storyId]);

  if (!open) return null;

  const shots = (viewers ?? []).filter((v) => v.screenshotted).length;

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Story viewers">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" />

      {/*
        The glass panel. One blurred surface, one hairline, no inner cards —
        the owner asked for premium and glassy "without heavy weight", and a
        list of avatars inside a list of glass cards is the heavy version.
      */}
      <div className="relative max-h-[72vh] w-full max-w-md overflow-hidden rounded-t-[1.75rem] border-t border-white/15 bg-neutral-900/80 pb-[env(safe-area-inset-bottom)] text-white shadow-2xl backdrop-blur-2xl">
        <div className="flex items-center gap-3 px-5 pb-3 pt-4">
          <span aria-hidden className="h-1 w-9 shrink-0 rounded-full bg-white/25" />
          <h2 className="min-w-0 flex-1 text-[15px] font-bold tracking-[-0.01em]">
            {viewers === null ? "Viewers" : `${viewers.length.toLocaleString()} ${viewers.length === 1 ? "viewer" : "viewers"}`}
          </h2>
          {shots > 0 ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11.5px] font-semibold ring-1 ring-inset ring-white/15">
              <Camera className="h-3.5 w-3.5" aria-hidden /> {shots}
            </span>
          ) : null}
          <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 rounded-full p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white">
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        <div className="max-h-[52vh] overflow-y-auto px-2 pb-2">
          {viewers === null ? (
            <p className="flex items-center justify-center gap-2 py-10 text-[13px] text-white/60">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
            </p>
          ) : viewers.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-white/55">{problem ?? "Nobody has seen this yet."}</p>
          ) : (
            <ul>
              {viewers.map((v) => (
                <li key={v.id} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 transition hover:bg-white/[0.06]">
                  {v.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a remote avatar; the optimizer adds a round trip for a 36px image
                    <img src={v.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-white/20" />
                  ) : (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-sm font-bold">
                      {(v.displayName ?? v.handle ?? "?").charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-[14px] font-semibold">{v.displayName ?? (v.handle ? `@${v.handle}` : "Someone")}</span>
                    <span className="block truncate text-[12px] text-white/50">{formatRelative(v.viewedAt)}</span>
                  </span>
                  {v.screenshotted ? (
                    <span
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-400/15 px-2 py-1 text-[11px] font-bold text-amber-300 ring-1 ring-inset ring-amber-300/25"
                      title="Took a screenshot"
                    >
                      <Camera className="h-3 w-3" aria-hidden /> Shot
                    </span>
                  ) : (
                    <Eye className="h-4 w-4 shrink-0 text-white/25" aria-hidden />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/*
          🔴 The footnote is not decoration — see the module docstring. It says
          which of the two reasons the screenshot column is empty, so an author
          never reads silence as "nobody did it".
        */}
        <p className={cn("border-t border-white/10 px-5 py-3 text-[11.5px] leading-snug text-white/45")}>
          {alertsOn
            ? "Screenshot alerts are on. They can only be reported from the installed app — a browser cannot detect a screenshot."
            : "Screenshot alerts are off, so you won't see who screenshots your stories — and others won't see when you screenshot theirs."}
        </p>
      </div>
    </div>
  );
}
