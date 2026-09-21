"use client";

import { ArrowLeft, ChevronRight, Clock3, Gift, PersonStanding, ScanFace, Shirt, Sparkles, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { FLOW_TOOL_HINT, FrenzAIToolsGrid } from "@/features/ai/frenz-ai-tools-grid";
import { getCharacterReplaceBalance, getCharacterReplaceConfig } from "@/lib/ai/character-replace/client";
import type { CharacterReplacePublicConfig } from "@/lib/ai/character-replace/config";
import type { CharacterReplaceFreeAccess } from "@/lib/ai/character-replace/types";
import { REPLACEMENT_MODE_COPY, REPLACEMENT_MODES, type ReplacementMode } from "@/lib/ai/character-replace/modes";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHAT DO YOU WANT TO REPLACE? — the tool's front door, on its own page
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-20: "Make this section a separate page alone and a separate
 * step, so all AI models stay on this page; it should open instant, the other
 * buttons should start prefetching after landing and always cache, back-swipe
 * should never reload it, and when it hasn't prefetched or cached it should
 * show a strip skeleton loader that shows the header."
 *
 * So this page is STATIC: the four scopes are drawn from the pure copy in
 * lib/ai/character-replace/modes.ts on the first paint — no server round
 * trip, no config wait — and only the price pills and the on/off state come
 * from the config read, which paints from this browser's last answer first
 * (sessionStorage) and is replaced by the network. Each card is a `<Link>` to
 * the create page with the scope in the query, prefetched on landing, so the
 * next page opens from the router cache with its own loading strip when the
 * data is not there yet. Back-swipe returns here from the cache, never a
 * reload. The member chooses an OUTCOME; no model name lives here.
 *
 * `?job=` (an older history link) still opens the workspace on this route.
 */
const CONFIG_CACHE_KEY = "frenzsave_cr_config_v2";

function readCachedConfig(): CharacterReplacePublicConfig | null {
  try {
    const raw = sessionStorage.getItem(CONFIG_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; config: CharacterReplacePublicConfig };
    return Date.now() - parsed.at < 30 * 60_000 ? parsed.config : null;
  } catch {
    return null;
  }
}

function writeCachedConfig(config: CharacterReplacePublicConfig): void {
  try {
    sessionStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({ at: Date.now(), config }));
  } catch {
    /* private mode, quota — the network answer still paints */
  }
}

const ICONS: Record<ReplacementMode, typeof ScanFace> = { face_only: ScanFace, skin_face: UserRound, upper_body: Shirt, full_character: PersonStanding };
const TINT: Record<ReplacementMode, string> = {
  face_only: "from-sky-500 to-cyan-400",
  skin_face: "from-violet-500 to-fuchsia-500",
  upper_body: "from-amber-500 to-orange-500",
  full_character: "from-blue-600 via-indigo-500 to-fuchsia-500",
};
const TAG: Partial<Record<ReplacementMode, string>> = { face_only: "Fastest", full_character: "Most complete" };

export function CharacterReplaceModePage({
  createPath,
  aiHref,
  historyHref,
}: {
  /** The create page, given the scope in `?mode=`. */
  createPath: string;
  aiHref: string;
  historyHref: string;
}) {
  const router = useRouter();
  const [config, setConfig] = useState<CharacterReplacePublicConfig | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [legacyJob, setLegacyJob] = useState(false);
  // Part 11 §6: the complimentary creations, from the balance read (the server's answer; never computed here)
  const [free, setFree] = useState<CharacterReplaceFreeAccess | null>(null);
  // owner, 2026-09-20: the AI Tools grid lives here too. A flow tool (lip sync, voice, speech) is chosen
  // AFTER the scope, so tapping one brings the scopes back into view with the sentence that says where it is.
  const [hint, setHint] = useState<string | null>(null);
  const scopesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // an older `?job=` link: the create page hosts the workspace, which reads the id from the URL
    const job = new URLSearchParams(window.location.search).get("job");
    if (job) {
      setLegacyJob(true);
      router.replace(`${createPath}?job=${encodeURIComponent(job)}`);
      return;
    }
    // prefetch the create page for every scope on landing (owner: "start prefetching after landing")
    router.prefetch(createPath);
    for (const m of REPLACEMENT_MODES) router.prefetch(`${createPath}?mode=${m}`);
    const cached = readCachedConfig();
    if (cached) setConfig(cached);
    let alive = true;
    void (async () => {
      const res = await getCharacterReplaceConfig();
      if (!alive) return;
      if (res.ok) {
        setConfig(res.config);
        writeCachedConfig(res.config);
        setUnavailable(res.available ? null : (res.unavailableReason ?? "It has been switched off for the moment. Nothing on your account is affected — check back soon."));
      }
      // after the config (which plants the device cookie) — the entitlement is decided against that cookie
      const wallet = await getCharacterReplaceBalance();
      if (!alive) return;
      if (wallet.ok && wallet.balance.freeAccess) setFree(wallet.balance.freeAccess);
    })();
    return () => {
      alive = false;
    };
  }, [createPath, router]);

  if (legacyJob) return <div className="mt-6 h-40 animate-pulse rounded-[1.5rem] bg-secondary/60" aria-busy="true" aria-label="Opening your video" />;

  return (
    <div className="pb-24">
      <header className="mt-4">
        <p className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
          Frenz AI · Character Replace
        </p>
        <h1 className="mt-2 text-[2rem] font-bold leading-[1.06] tracking-[-0.04em] sm:text-[2.5rem]">
          What do you want to <span className="text-gradient">replace?</span>
        </h1>
        <p className="mt-2.5 max-w-md text-[14.5px] leading-relaxed text-muted-foreground">
          Choose the scope. The video&apos;s movement, expressions, scene and camera always stay.
        </p>
        {free?.enabled ? (
          <p className={cn("mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12.5px] font-semibold", free.eligible ? "bg-primary/[0.08] text-primary" : "bg-secondary text-muted-foreground")} role="status">
            <Gift className="h-4 w-4" aria-hidden />
            {free.reason === "ELIGIBLE" && free.remaining === free.granted && free.granted > 0 ? `Welcome — enjoy ${free.granted} complimentary creation${free.granted === 1 ? "" : "s"} to experience Frenz AI.` : free.message}
          </p>
        ) : null}
      </header>

      {/* the hint and the scopes scroll together when a flow tool below is tapped */}
      <div ref={scopesRef} className="scroll-mt-24">
      {hint ? (
        <p role="status" className="mt-5 flex items-start gap-2 rounded-2xl bg-primary/[0.07] px-3.5 py-2.5 text-[12.5px] font-semibold leading-snug text-foreground">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          {hint}
        </p>
      ) : null}
      {unavailable ? (
        <div className="mt-6 rounded-[1.5rem] border border-border/70 bg-card px-5 py-6 text-center">
          <h2 className="text-[17px] font-bold tracking-[-0.01em]">Character Replace isn&apos;t available right now</h2>
          <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed text-muted-foreground">{unavailable}</p>
          <Link href={aiHref} className="btn-lux mt-5 bg-foreground text-background">
            Back to Frenz AI
          </Link>
        </div>
      ) : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2" aria-label="Replacement types">
          {REPLACEMENT_MODES.map((id) => {
            const copy = REPLACEMENT_MODE_COPY[id];
            const live = config?.modes.find((m) => m.id === id) ?? null;
            const enabled = live ? live.enabled : true;
            const Icon = ICONS[id];
            const tag = TAG[id];
            const inner = (
              <>
                <span className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-[0_10px_24px_-12px_rgba(79,70,229,0.55)]", TINT[id])}>
                  <Icon className="h-6 w-6" strokeWidth={2.2} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[16px] font-bold tracking-[-0.01em]">{copy.label}</span>
                    {tag && enabled ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-primary">{tag}</span> : null}
                  </span>
                  <span className="mt-1 block text-[13px] leading-snug text-muted-foreground">{copy.tagline}</span>
                  <span className="mt-2.5 flex items-center gap-2">
                    {!enabled ? (
                      <span className="rounded-full bg-secondary px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Not available right now</span>
                    ) : live?.priceLine ? (
                      <span className="rounded-full bg-secondary px-2.5 py-1 text-[11.5px] font-bold tabular-nums text-foreground/85">{live.priceLine}</span>
                    ) : (
                      <span className="h-6 w-28 animate-pulse rounded-full bg-secondary" aria-hidden />
                    )}
                    {enabled ? (
                      <span className="flex items-center gap-1 text-[11.5px] font-semibold text-muted-foreground">
                        <Clock3 className="h-3.5 w-3.5" aria-hidden />
                        {live ? `up to ${live.maximumDurationSeconds}s` : " "}
                      </span>
                    ) : null}
                  </span>
                </span>
                <ChevronRight className={cn("h-5 w-5 shrink-0 self-center text-muted-foreground/70", !enabled && "opacity-0")} aria-hidden />
              </>
            );
            const card = cn(
              "group relative flex w-full items-start gap-4 rounded-[1.4rem] border px-4 py-4 text-left transition",
              "border-border/70 bg-card shadow-[0_1px_0_rgba(15,23,42,0.03)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            );
            return (
              <li key={id}>
                {enabled ? (
                  <Link
                    href={`${createPath}?mode=${id}`}
                    onClick={() => haptic("selection")}
                    className={cn(card, "hover:border-foreground/30 hover:shadow-[0_14px_30px_-20px_rgba(15,23,42,0.55)] active:scale-[0.99] motion-safe:hover:-translate-y-0.5")}
                    aria-label={`${copy.label} — ${copy.tagline}`}
                  >
                    {inner}
                  </Link>
                ) : (
                  <div className={cn(card, "opacity-60")} aria-disabled>
                    {inner}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      </div>

      <p className="mt-5 text-center text-[12.5px] leading-relaxed text-muted-foreground">
        Your photo and video stay on your device until you press Create Video. Nothing is charged before that.
      </p>

      {/* the AI Tools beyond the scopes above — the scopes ARE this page, so they are not drawn twice */}
      {!unavailable ? (
        <FrenzAIToolsGrid
          characterReplaceHref={createPath.replace(/\/create$/, "")}
          historyHref={historyHref}
          include="beyond-scopes"
          onFlowTool={(id) => {
            setHint(FLOW_TOOL_HINT[id]);
            haptic("selection");
            scopesRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
          }}
          className="mt-8"
        />
      ) : null}

      <div className="mt-6 flex items-center justify-between">
        <Link href={aiHref} className="btn-lux min-h-[44px] border border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Frenz AI
        </Link>
        <Link href={historyHref} className="btn-lux min-h-[44px] border border-border/70 bg-card text-foreground hover:border-foreground/25">
          Your videos
        </Link>
      </div>
    </div>
  );
}
