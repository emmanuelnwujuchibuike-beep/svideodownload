"use client";

import { ChevronLeft, ChevronRight, Coins, Gift } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { aiToolCards, type AiToolCard, type AiToolId } from "@/features/ai/frenz-ai-tools-grid";
import { AiCreditsChip } from "@/features/ai/design/ai-welcome-parts";
import { TapOnceLink } from "@/features/ui/tap-once-link";
import { formatCredits } from "@/lib/ai/credits/units";
import { LinkPendingStripe } from "@/features/navigation/link-pending-stripe";
import {
  getCharacterReplaceBalance,
  getCharacterReplaceConfig,
} from "@/lib/ai/character-replace/client";
import type { CharacterReplacePublicConfig } from "@/lib/ai/character-replace/config";
import { REPLACEMENT_MODES } from "@/lib/ai/character-replace/modes";
import type { CharacterReplaceFreeAccess } from "@/lib/ai/character-replace/types";
import { getAiEntitlement, type AiMemberEntitlement } from "@/lib/ai/client";
import type { ShowcaseSlide } from "@/lib/ai/showcase/slides";
import {
  readAiEntitlementCache,
  writeAiEntitlementCache,
} from "@/lib/ai/entitlement-cache";
import { readAiFreeAccessCache, writeAiFreeAccessCache } from "@/lib/ai/free-access-cache";
import { haptic } from "@/lib/motion/haptics";
import { useAiCreditBalance } from "@/features/ai/design/ai-credit-strip";
import { AiShowcase } from "@/features/ai/design/ai-showcase";
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


/** The showcase carousel at the top of Explore — hidden 2026-10-07, kept for the self-ad slot (see the render below). */
const EXPLORE_SHOWCASE_VISIBLE = false;

export function FrenzAIExplore({
  createPath,
  aiHref,
  historyHref,
  usageHref,
  slides,
}: {
  /** The create page, given the scope in `?mode=`. */
  createPath: string;
  aiHref: string;
  historyHref: string;
  usageHref: string;
  /** The showcase slides, read by the server page (lib/ai/showcase/server.ts). */
  slides: ShowcaseSlide[];
}) {
  const router = useRouter();
  const characterReplaceHref = createPath.replace(/\/create$/, "");
  // kept warm for the create page (sessionStorage), not drawn here since step 17
  const [_config, setConfig] = useState<CharacterReplacePublicConfig | null>(
    null,
  );
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [legacyJob, setLegacyJob] = useState(false);
  // Part 11 §6: the complimentary creations, from the balance read (the server's answer; never computed here)
  const [free, setFree] = useState<CharacterReplaceFreeAccess | null>(null);
  const [entitlement, setEntitlement] = useState<AiMemberEntitlement | null>(
    null,
  );
  // the chip row's current section (step 17)
  const [section, setSection] = useState<Section>("all");

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
    /*
      The complimentary line, from last known (owner, 2026-10-05: "this
      complimentary card reloads all the time on back swipe and every page
      entry"). The config and the entitlement above were already seeded this
      way for the identical report on 2026-09-13; this one element was left
      reading a live balance with nothing behind it, so it alone popped in.
    */
    const cachedFree = readAiFreeAccessCache();
    if (cachedFree) setFree((current) => current ?? cachedFree);
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
      if (wallet.ok && wallet.balance.freeAccess) {
        setFree(wallet.balance.freeAccess);
        // so the NEXT entry paints it immediately, including after a creation is spent
        writeAiFreeAccessCache(wallet.balance.freeAccess);
      }
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

  /*
    🔴 The Character Replace SCOPES are retired (Part 5, 2026-09-28): the direct Kling API has no endpoint
    that takes a video plus a character, so they are not offered anywhere on this page.
  */
  const tools = aiToolCards(characterReplaceHref, historyHref);
  const tool = (id: AiToolId) => tools.find((t) => t.id === id)!;
  const createVideo = [tool("text_to_video"), tool("image_to_video")];
  const audio = [tool("text_to_audio"), tool("voice_clone"), tool("audio_library")];
  const yours = [tool("history"), tool("voice_library")];
  const business = entitlement?.audience === "business";

  const jump = (id: Section) => {
    haptic("selection");
    setSection(id);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (id === "all") window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    else document.getElementById(`ai-studio-${id}`)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  return (
    /*
      Step 17 (design/AIExplore.dc.html, owner 2026-10-19): back link, a large "AI Studio" title with the
      balance, the privacy line, chips that jump to each section, the tools in their groups, the models
      behind them and one credits card at the foot. The old "How it works", the separate Business banner
      and the "← Frenz AI" button at the bottom are gone (owner). White page; the gradient only on the two
      Create video showcase cards and small identity tiles.
    */
    <div className="frenz-ui pb-10 text-frenz-ink">
      {/*
        HIDDEN, not removed (owner, 2026-10-07: "don't remove it entirely, just hide it — the self ad that
        will be implemented will use it"). Flip EXPLORE_SHOWCASE_VISIBLE to bring it back.
      */}
      {EXPLORE_SHOWCASE_VISIBLE ? <AiShowcase slides={slides} base={aiHref} className="mt-3" /> : null}

      <header className="px-1 pt-1">
        <Link href={aiHref} className="-ml-1 inline-flex min-h-[44px] items-center gap-0.5 text-[16px] font-bold text-frenz-blue no-underline">
          <ChevronLeft className="h-5 w-5" aria-hidden />
          Frenz AI
          <LinkPendingStripe />
        </Link>
        <div className="flex items-center justify-between gap-3">
          <h1 className="m-0 font-heading text-[34px] font-extrabold leading-tight tracking-[-1px]">AI Studio</h1>
          <AiCreditsChip />
        </div>
        <p className="m-0 mt-1.5 text-[14px] leading-snug text-frenz-muted">
          Your photos and videos stay on your device until you press Create. Nothing is charged before that.
        </p>
      </header>

      {/* the chips jump to each section (the design's filter row) */}
      <div className="sticky top-[calc(4rem+var(--frenz-safe-top))] z-10 -mx-3 mt-3 flex gap-2 overflow-x-auto bg-frenz-page px-4 py-2.5 [scrollbar-width:none] sm:-mx-4 [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Jump to">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={section === s.id}
            onClick={() => jump(s.id)}
            className={cn(
              "relative flex h-9 shrink-0 items-center whitespace-nowrap rounded-full px-4 text-sm transition-colors before:absolute before:-inset-y-1 before:inset-x-0 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-frenz-violet",
              section === s.id ? "bg-frenz-ink font-bold text-frenz-page" : "border border-frenz-line bg-frenz-card font-semibold text-frenz-ink/80",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {free?.enabled && free.eligible && free.remaining && free.remaining > 0 ? (
        <p className="m-0 mt-3 inline-flex items-center gap-2 rounded-full bg-frenz-violet/10 px-3 py-1.5 text-[12.5px] font-bold text-frenz-violet" role="status">
          <Gift className="h-4 w-4" aria-hidden />
          {free.reason === "ELIGIBLE" && free.remaining === free.granted && free.granted > 0
            ? `Welcome — enjoy ${free.granted} complimentary creation${free.granted === 1 ? "" : "s"} to experience Frenz AI.`
            : free.message}
        </p>
      ) : null}

      {unavailable ? (
        <div className="mt-6 rounded-[22px] border border-frenz-line bg-frenz-card px-5 py-6 text-center shadow-frenz-card">
          <h2 className="m-0 font-heading text-[17px] font-bold">Character Replace isn&apos;t available right now</h2>
          <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed text-frenz-muted">{unavailable}</p>
        </div>
      ) : null}

      {/* ── Create video ── */}
      <StudioSection id="video" title="Create video" sub="From a description or a photo">
        <div className="grid grid-cols-2 gap-3">
          {createVideo.map((t, i) => (
            <Link
              key={t.id}
              href={t.href}
              className={cn(
                "frenz-nav-glass frenz-nav-glass--static relative flex min-h-[176px] flex-col justify-between overflow-hidden rounded-[22px] p-3.5 text-frenz-ink no-underline transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-frenz-violet focus-visible:ring-offset-2",
                // floating clear glass, not a purple gradient (owner, 2026-10-31); the icon tile keeps the two colours apart
                i === 0 ? "[&_.studio-ico]:text-frenz-violet" : "[&_.studio-ico]:text-frenz-blue",
              )}
            >
              <span aria-hidden className="studio-ico frenz-icon-glass flex h-10 w-10 items-center justify-center rounded-xl">
                <t.icon className="h-5 w-5" />
              </span>
              <span>
                <span className="block font-heading text-[17px] font-bold">{t.name}</span>
                <span className="mt-0.5 block text-[12.5px] leading-snug text-frenz-muted">{t.blurb}</span>
              </span>
              <LinkPendingStripe />
            </Link>
          ))}
        </div>
      </StudioSection>

      {/* ── Transform video ── */}
      <StudioSection id="transform" title="Transform video" sub="One change to a video you already have">
        <ToolList tools={[tool("lip_sync_pro")]} />
      </StudioSection>

      {/* ── Create audio ── */}
      <StudioSection id="audio" title="Create audio" sub="Sound only — your video isn't touched">
        <ToolList tools={audio} />
      </StudioSection>

      {/* ── AI models — the ones this app really runs (lib/ai/kling) ── */}
      <StudioSection id="models" title="AI models" sub="The models behind your creations">
        <ul className="-mx-3 m-0 flex list-none gap-3 overflow-x-auto px-3 pb-1 [scrollbar-width:none] sm:-mx-4 sm:px-4 [&::-webkit-scrollbar]:hidden">
          {AI_MODELS.map((m) => (
            <li key={m.id} className="w-[148px] shrink-0">
              {/* floating clear glass, not a purple gradient (owner, 2026-10-31) */}
              <div className="frenz-nav-glass frenz-nav-glass--static flex h-[118px] flex-col justify-between rounded-[20px] p-3 text-frenz-ink">
                <span className="frenz-icon-glass text-frenz-violet self-start rounded-full px-2 py-0.5 text-[11px] font-bold">{m.tag}</span>
                <span>
                  <span className="block text-[12px] font-semibold text-frenz-muted">Kling</span>
                  <span className="block font-heading text-[19px] font-bold leading-tight">{m.version}</span>
                </span>
              </div>
              <p className="m-0 mt-1.5 px-0.5 text-[12px] leading-snug text-frenz-muted">{m.usedFor}</p>
            </li>
          ))}
        </ul>
      </StudioSection>

      {/* ── Yours ── */}
      <StudioSection id="yours" title="Yours" sub="Everything you've made">
        <ToolList tools={yours} />
      </StudioSection>

      {/* ── one credits card at the foot ── */}
      <StudioCredits usageHref={usageHref} business={business} free={free} />
    </div>
  );
}

type Section = "all" | "video" | "audio" | "yours" | "models";
const SECTIONS: { id: Section; label: string }[] = [
  { id: "all", label: "All" },
  { id: "video", label: "Video" },
  { id: "audio", label: "Audio" },
  { id: "yours", label: "Yours" },
  { id: "models", label: "Models" },
];

/**
 * The models this app actually runs, by the names and ids in lib/ai/kling (owner: "use the exact model
 * names and identifiers from our codebase"). The design also drew Kling 4.0, 2.6, O3 and O1 — not in our
 * config, so not shown (PROGRESS, step 17).
 */
const AI_MODELS = [
  { id: "kling-v3-omni", version: "3.0 Omni", tag: "Video", usedFor: "Text to Video · Image to Video" },
  { id: "kling-lip-sync", version: "Lip Sync", tag: "Video", usedFor: "Lip Sync Pro" },
] as const;

function StudioSection({ id, title, sub, children }: { id: string; title: string; sub: string; children: ReactNode }) {
  return (
    <section id={`ai-studio-${id}`} aria-labelledby={`ai-studio-${id}-title`} className="scroll-mt-32 pt-6">
      <h2 id={`ai-studio-${id}-title`} className="m-0 px-1 font-heading text-[20px] font-bold tracking-[-0.5px]">
        {title}
      </h2>
      <p className="m-0 mb-2.5 px-1 text-[13px] text-frenz-muted">{sub}</p>
      {children}
    </section>
  );
}

function ToolList({ tools }: { tools: AiToolCard[] }) {
  return (
    <ul className="m-0 list-none divide-y divide-frenz-line overflow-hidden rounded-[22px] border border-frenz-line bg-frenz-card p-0 shadow-frenz-card">
      {tools.map((t) => (
        <li key={t.id}>
          <Link href={t.href} className="relative flex min-h-[68px] items-center gap-3 px-3.5 py-3 text-frenz-ink no-underline transition-colors active:bg-frenz-fill">
            {/* a small glass icon tile (owner, 2026-10-31: no purple gradient behind icons — the global glass) */}
            <span aria-hidden className="frenz-icon-glass text-frenz-violet flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
              <t.icon className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-bold">{t.name}</span>
              <span className="mt-0.5 block text-[13px] leading-snug text-frenz-muted">{t.blurb}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-frenz-muted" aria-hidden />
            <LinkPendingStripe />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The design's one credits card: the balance, the Business tag (only for a Business member), Earn and Usage. */
function StudioCredits({ usageHref, business, free }: { usageHref: string; business: boolean; free: CharacterReplaceFreeAccess | null }) {
  const { who, balance } = useAiCreditBalance();
  if (who === "guest") return null;
  // the complimentary line only when it applies: offered on this account and something to say about it
  const note = free?.enabled && free.message ? free.message : null;
  return (
    <section aria-label="Your AI balance" className="mt-7 rounded-[22px] border border-frenz-line bg-frenz-card p-4 shadow-frenz-card">
      <div className="flex items-center gap-3">
        <span aria-hidden className="frenz-icon-glass text-frenz-violet flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
          <Coins className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="font-heading text-[18px] font-bold tabular-nums" title={balance ? formatCredits(balance.balanceCents) : undefined}>
              {balance ? formatCredits(balance.balanceCents) : "—"}
            </span>
            {business ? <span className="rounded-full bg-frenz-gradient-x px-2 py-0.5 text-[10.5px] font-extrabold tracking-[0.5px] text-white">BUSINESS</span> : null}
          </span>
          <span className="block text-[12.5px] text-frenz-muted">Each tool uses credits based on processing</span>
        </span>
      </div>
      <div className="mt-3.5 grid grid-cols-2 gap-2">
        <TapOnceLink href="/quests" warmOnIdle spinner={false} aria-label="Earn credits" className="flex h-11 items-center justify-center rounded-full bg-frenz-violet/10 text-[14px] font-bold text-frenz-violet no-underline data-[pending]:opacity-70">
          Earn credits
        </TapOnceLink>
        <TapOnceLink href={usageHref} spinner={false} className="flex h-11 items-center justify-center rounded-full border border-frenz-line text-[14px] font-bold text-frenz-ink no-underline data-[pending]:opacity-70">
          Usage &amp; history
        </TapOnceLink>
      </div>
      {note ? <p className="m-0 mt-3 text-center text-[12.5px] text-frenz-muted">{note}</p> : null}
    </section>
  );
}
