import { SelfAdSlot } from "@/features/ads-platform/serve/self-ad-slot";
import { AiMembersGate } from "@/features/ai/design/ai-members-gate";
import { AiShowcase } from "@/features/ai/design/ai-showcase";
import { AiCreditsCard, AiCreditsPill } from "@/features/ai/design/ai-welcome-parts";
import { FrenzLogo } from "@/components/brand/frenz-logo";
import { BadgeCheck, ShieldCheck, Zap } from "lucide-react";
import { FrenzAIWelcomeLive } from "@/features/ai/frenz-ai-welcome-live";
import type { ShowcaseSlide } from "@/lib/ai/showcase/slides";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FRENZ AI WELCOME PAGE — the front door of the studio
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Redesign Phase 1 (2026-10-05, docs/FRENZ_AI_REDESIGN_BRIEFS.md Brief A, and
 * docs/FRENZ_AI_UI_EVOLUTION_BRIEF.md "WELCOME PAGE STRUCTURE"):
 *
 *   the showcase — photo cards, serif italic headline, 3 s autoplay (ai-showcase.tsx)
 *   ↓ credits strip — free creations · AI balance · View balance (ai-credit-strip.tsx)
 *   ↓ brand + hero — the crumb pill, Outfit display headline, Inter italic line
 *   ↓ the allowance, when there is one · trust row
 *   (order and plain-white ground: the owner's reference image, 2026-10-05)
 *   ⇣ docked: Create with AI (primary) · Your creations (secondary)
 *
 * The four capability cards are gone: the showcase now says what each tool
 * makes, with a picture, and a slide is a door to that tool — so the cards were
 * the same four sentences a second time. The studio card's frame, its shadow
 * and its nested tiles went with them (Brief A, VISUAL WEIGHT: "if an element
 * does not need a card, do not put it in a card").
 *
 * ── Server first ────────────────────────────────────────────────────────────
 * This file is a SERVER component. The hero and trust row are static markup;
 * the slides are data the page was rendered with (lib/ai/showcase/server.ts).
 * Only three things hydrate: the live island (entitlement → allowance, dock),
 * the carousel's timer, and the guest dialog.
 *
 * ── Who may see it (owner, 2026-10-05) ──────────────────────────────────────
 * A signed-out visitor may now see this page — "anonymous users should only see
 * the welcome page and description". Every link into a tool carries
 * `data-ai-members`, and AiMembersGate turns a guest's tap on one into the
 * sign-in dialog. The tools themselves stay guarded (middleware + API).
 *
 * No provider or model is named on this page (Part 9 §7).
 */
export function FrenzAIWelcome({
  base = "/studio/ai",
  slides,
}: {
  /** The door: "/ai" (public group) or "/studio/ai" (Studio shell). */
  base?: "/ai" | "/studio/ai";
  slides: ShowcaseSlide[];
}) {
  return (
    <>
      <FrenzAIWelcomeLive
        exploreHref={`${base}/character-replace`}
        historyHref={`${base}/history`}
        footer={
          /* Ad Platform Part 5: a paid AI-pages card (ai_banner) at the end of the hub — never inside a creation flow. Nothing without a live campaign. */
          <SelfAdSlot slot="ai_hub_card" placement="ai_banner" page="ai" className="mt-7" />
        }
        hero={
          /*
            Step 16 (design/AIStudio.dc.html, 2026-10-19): the admin's showcase as a full-bleed featured
            carousel — its videos autoplay muted while on screen — with the glass Frenz AI and credits
            pills over it. The page under it stays plain white (owner's hard rule).
          */
          <AiShowcase
            slides={slides}
            base={base}
            variant="hero"
            className="-mx-3 -mt-1 sm:-mx-4 lg:mx-0 lg:rounded-[28px]"
            overlay={
              <>
                <span className="flex h-11 items-center gap-2 rounded-full ai-glass ai-glass--media pl-1.5 pr-3.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-white/90">
                    <FrenzLogo size={20} alt="" className="h-5 w-5" />
                  </span>
                  <span className="font-heading text-[16px] font-bold text-white">Frenz AI</span>
                </span>
                <AiCreditsPill />
              </>
            }
          />
        }
      >
        {/* the white sheet rising over the hero's foot, as drawn */}
        <div className="relative -mx-3 -mt-7 rounded-t-[28px] bg-frenz-page px-4 pt-[18px] sm:-mx-4 lg:mx-0 lg:mt-4 lg:rounded-none lg:px-0">
          <AiCreditsCard base={base} />
          <div className="px-1 pt-6">
            <h1 className="m-0 font-heading text-[30px] font-extrabold leading-[1.08] tracking-[-1px] text-frenz-ink">
              {/* no gradient text — the highlighted word is flat violet, as on every Frenz page */}
              Create. Transform. <span className="text-frenz-violet">Perfect.</span>
            </h1>
            <p className="m-0 mt-2 text-[16px] leading-[1.45] text-frenz-ink/80">Professional AI tools for video, voice and audio creation.</p>
          </div>
          {/* the trust row, as the design's three chips */}
          <ul className="m-0 flex list-none flex-wrap gap-2 px-1 pt-[18px]" aria-label="Why Frenz AI">
            {[
              { icon: Zap, label: "Fast" },
              { icon: ShieldCheck, label: "Secure" },
              { icon: BadgeCheck, label: "Natural results" },
            ].map(({ icon: Icon, label }) => (
              <li key={label} className="flex h-[34px] items-center gap-1.5 rounded-full bg-frenz-fill px-3 text-[13px] font-bold text-frenz-ink/80">
                <Icon className="h-4 w-4 text-frenz-violet" aria-hidden />
                {label}
              </li>
            ))}
          </ul>
        </div>
      </FrenzAIWelcomeLive>
      <AiMembersGate />
    </>
  );
}
