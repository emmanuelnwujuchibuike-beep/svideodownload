"use client";

import {
  ArrowLeft,
  ChevronRight,
  Gift,
  ImagePlus,
  MousePointerClick,
  Sparkles,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { FrenzAIAllowanceBar } from "@/features/ai/frenz-ai-chrome";
import { FrenzAITierLabel } from "@/features/ai/frenz-ai-tier-label";
import {
  FLOW_TOOL_HINT,
  FrenzAIToolsGrid,
  type AiToolId,
} from "@/features/ai/frenz-ai-tools-grid";
import { LinkPendingStripe } from "@/features/navigation/link-pending-stripe";
import {
  getCharacterReplaceBalance,
  getCharacterReplaceConfig,
} from "@/lib/ai/character-replace/client";
import type { CharacterReplacePublicConfig } from "@/lib/ai/character-replace/config";
import { REPLACEMENT_MODES } from "@/lib/ai/character-replace/modes";
import type { CharacterReplaceFreeAccess } from "@/lib/ai/character-replace/types";
import { getAiEntitlement, type AiMemberEntitlement } from "@/lib/ai/client";
import {
  readAiEntitlementCache,
  writeAiEntitlementCache,
} from "@/lib/ai/entitlement-cache";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EXPLORE AI STUDIO — every AI feature, how it works, credits & usage
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-20: "remove the AI tools down to AI credits from the welcome
 * page; let it be the main Explore AI Studio page; remove the AI structure and
 * use the grid that has all AI features, including the ones that will be built
 * in the next session."
 *
 * So the welcome page is the front door (hero, the studio card, one button)
 * and THIS is the studio: the grid of every feature (features/ai/
 * frenz-ai-tools-grid.tsx — a feature built later is one more row there), the
 * three steps, and the credits & usage door. It replaces the "What do you want
 * to replace?" page: the four scopes are the first four cards, each opening
 * the workspace on that scope, so the workspace's Replace step and every older
 * link to the scope route land here and still work (`?job=` included).
 *
 * ── Never `force-static` under the Studio shell ─────────────────────────────
 * The scope page was `force-static` inside a layout that calls `getUser()`;
 * the layout's redirect was prerendered INTO the page, and every member who
 * tapped it in the Studio shell was sent to Creator Studio. This page renders
 * with the request (the marketing twin may stay static — its header is static).
 *
 * The four scopes are drawn on the first paint; only the on/off state comes
 * from the config read, which paints from this browser's last answer first
 * (sessionStorage) and is replaced by the network. Every create link is
 * prefetched on landing (owner: "start prefetching after landing").
 */
const CONFIG_CACHE_KEY = "frenzsave_cr_config_v2";

function readCachedConfig(): CharacterReplacePublicConfig | null {
  try {
    const raw = sessionStorage.getItem(CONFIG_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      at: number;
      config: CharacterReplacePublicConfig;
    };
    return Date.now() - parsed.at < 30 * 60_000 ? parsed.config : null;
  } catch {
    return null;
  }
}

function writeCachedConfig(config: CharacterReplacePublicConfig): void {
  try {
    sessionStorage.setItem(
      CONFIG_CACHE_KEY,
      JSON.stringify({ at: Date.now(), config }),
    );
  } catch {
    /* private mode, quota — the network answer still paints */
  }
}

const HOW = [
  {
    icon: MousePointerClick,
    title: "Choose a tool",
    detail: "Select the AI tool you need.",
  },
  {
    icon: ImagePlus,
    title: "Add your media",
    detail: "Upload your video, image, audio or text.",
  },
  {
    icon: Sparkles,
    title: "Create & preview",
    detail: "Generate your result and review it.",
  },
] as const;

export function FrenzAIExplore({
  createPath,
  aiHref,
  historyHref,
  usageHref,
}: {
  /** The create page, given the scope in `?mode=`. */
  createPath: string;
  aiHref: string;
  historyHref: string;
  usageHref: string;
}) {
  const router = useRouter();
  const characterReplaceHref = createPath.replace(/\/create$/, "");
  const [config, setConfig] = useState<CharacterReplacePublicConfig | null>(
    null,
  );
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [legacyJob, setLegacyJob] = useState(false);
  // Part 11 §6: the complimentary creations, from the balance read (the server's answer; never computed here)
  const [free, setFree] = useState<CharacterReplaceFreeAccess | null>(null);
  const [entitlement, setEntitlement] = useState<AiMemberEntitlement | null>(
    null,
  );
  // a flow tool (lip sync, voice, speech) is chosen AFTER the scope: tapping one says where, and brings the scopes into view
  const [hint, setHint] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // an older `?job=` link: the create page hosts the workspace, which reads the id from the URL
    const job = new URLSearchParams(window.location.search).get("job");
    if (job) {
      setLegacyJob(true);
      router.replace(`${createPath}?job=${encodeURIComponent(job)}`);
      return;
    }
    router.prefetch(createPath);
    for (const m of REPLACEMENT_MODES)
      router.prefetch(`${createPath}?mode=${m}`);
    const cached = readCachedConfig();
    if (cached) setConfig(cached);
    const cachedEntitlement = readAiEntitlementCache();
    if (cachedEntitlement)
      setEntitlement((current) => current ?? cachedEntitlement);
    let alive = true;
    void (async () => {
      const res = await getCharacterReplaceConfig();
      if (!alive) return;
      if (res.ok) {
        setConfig(res.config);
        writeCachedConfig(res.config);
        setUnavailable(
          res.available
            ? null
            : (res.unavailableReason ??
                "It has been switched off for the moment. Nothing on your account is affected — check back soon."),
        );
      }
      // after the config (which plants the device cookie) — the entitlement is decided against that cookie
      const wallet = await getCharacterReplaceBalance();
      if (!alive) return;
      if (wallet.ok && wallet.balance.freeAccess)
        setFree(wallet.balance.freeAccess);
    })();
    void getAiEntitlement().then((res) => {
      if (alive && res.ok) {
        const { ok: _ok, ...view } = res;
        const next = view as unknown as AiMemberEntitlement;
        setEntitlement(next);
        writeAiEntitlementCache(next);
      }
    });
    return () => {
      alive = false;
    };
  }, [createPath, router]);

  if (legacyJob)
    return (
      <div
        className="mt-6 h-40 animate-pulse rounded-[1.5rem] bg-secondary/60"
        aria-busy="true"
        aria-label="Opening your video"
      />
    );

  // a scope the operator switched off is drawn, not offered
  const disabled: Partial<Record<AiToolId, string>> = {};
  if (config)
    for (const m of config.modes)
      if (!m.enabled) disabled[m.id] = "Not available right now.";

  return (
    <div className="pb-24">
      <header className="mt-4">
        <p className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
          Frenz AI · Studio
        </p>
        <h1 className="mt-2 text-[2rem] font-bold leading-[1.06] tracking-[-0.04em] sm:text-[2.5rem]">
          Explore <span className="text-gradient">AI Studio</span>
        </h1>
        <p className="mt-2.5 max-w-lg text-[14.5px] leading-relaxed text-muted-foreground">
          Every tool in one place. Your photo and video stay on your device
          until you press Create Video, and nothing is charged before that.
        </p>
        {free?.enabled ? (
          <p
            className={cn(
              "mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12.5px] font-semibold",
              free.eligible
                ? "bg-primary/[0.08] text-primary"
                : "bg-secondary text-muted-foreground",
            )}
            role="status"
          >
            <Gift className="h-4 w-4" aria-hidden />
            {free.reason === "ELIGIBLE" &&
            free.remaining === free.granted &&
            free.granted > 0
              ? `Welcome — enjoy ${free.granted} complimentary creation${free.granted === 1 ? "" : "s"} to experience Frenz AI.`
              : free.message}
          </p>
        ) : null}
      </header>

      <div ref={gridRef} className="scroll-mt-24">
        {hint ? (
          <p
            role="status"
            className="mt-5 flex items-start gap-2 rounded-2xl bg-primary/[0.07] px-3.5 py-2.5 text-[12.5px] font-semibold leading-snug text-foreground"
          >
            <Sparkles
              className="mt-0.5 h-4 w-4 shrink-0 text-primary"
              aria-hidden
            />
            {hint}
          </p>
        ) : null}

        {unavailable ? (
          <div className="mt-6 rounded-[1.5rem] border border-border/70 bg-card px-5 py-6 text-center">
            <h2 className="text-[17px] font-bold tracking-[-0.01em]">
              Character Replace isn&apos;t available right now
            </h2>
            <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed text-muted-foreground">
              {unavailable}
            </p>
            <Link
              href={aiHref}
              className="btn-lux mt-5 bg-foreground text-background"
            >
              Back to Frenz AI
            </Link>
          </div>
        ) : (
          <FrenzAIToolsGrid
            characterReplaceHref={characterReplaceHref}
            historyHref={historyHref}
            disabled={disabled}
            onFlowTool={(id) => {
              setHint(FLOW_TOOL_HINT[id]);
              haptic("selection");
              gridRef.current?.scrollIntoView({
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
                  .matches
                  ? "auto"
                  : "smooth",
                block: "start",
              });
            }}
            className="mt-6"
          />
        )}
      </div>

      {/* ── HOW IT WORKS ─────────────────────────────────────────────────────── */}
      <section aria-labelledby="ai-how-title" className="mt-8">
        <h2
          id="ai-how-title"
          className="px-1 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground"
        >
          How it works
        </h2>
        <ol className="mt-2.5 grid grid-cols-3 gap-2 sm:gap-2.5">
          {HOW.map((step, i) => (
            <li
              key={step.title}
              className="rounded-[1.15rem] bg-card/90 px-3 py-3 ring-1 ring-inset ring-black/[0.05] dark:ring-white/10 sm:px-4 sm:py-4"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-[11px] font-bold text-background">
                  {i + 1}
                </span>
                <step.icon className="h-4 w-4 text-primary" aria-hidden />
              </div>
              <p className="mt-2.5 text-[12.5px] font-bold leading-tight tracking-[-0.01em] sm:text-[13.5px]">
                {step.title}
              </p>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground sm:text-[12px]">
                {step.detail}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── AI CREDITS & USAGE ───────────────────────────────────────────────── */}
      <section aria-labelledby="ai-credits-title" className="mt-8">
        <h2
          id="ai-credits-title"
          className="px-1 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground"
        >
          Your AI balance
        </h2>
        <Link
          href={usageHref}
          className={cn(
            "group mt-2.5 flex items-center gap-3 rounded-[1.25rem] bg-card/95 p-3.5 ring-1 ring-inset ring-black/[0.05] dark:ring-white/10 sm:p-4",
            "shadow-[0_12px_30px_-22px_rgba(15,23,42,0.35)] transition duration-200 motion-safe:hover:-translate-y-0.5 active:scale-[0.995]",
          )}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[0.8rem] bg-primary/[0.09] text-primary">
            <Wallet className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-bold leading-tight tracking-[-0.01em]">
              AI Credits &amp; Usage
            </span>
            <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground sm:text-[12px]">
              Each AI tool uses credits based on processing requirements. Check
              your balance before creating.
            </span>
          </span>
          <FrenzAITierLabel
            entitlement={entitlement}
            className="hidden shrink-0 sm:inline-flex"
          />
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground/70 transition group-hover:bg-secondary/80">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </span>
          <LinkPendingStripe />
        </Link>
        {/* kept (owner, 2026-09-09): the bar draws nothing for a balance-funded product, the chip only for a paid plan — never an empty box */}
        <FrenzAIAllowanceBar entitlement={entitlement} className="mt-2.5" />
        <FrenzAITierLabel
          entitlement={entitlement}
          variant="row"
          className="mt-2.5 sm:hidden"
        />
      </section>

      <div className="mt-6">
        <Link
          href={aiHref}
          className="btn-lux min-h-[44px] border border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Frenz AI
        </Link>
      </div>
    </div>
  );
}
