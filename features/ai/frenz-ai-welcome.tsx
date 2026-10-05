import { AiMembersGate } from "@/features/ai/design/ai-members-gate";
import { AiShowcase } from "@/features/ai/design/ai-showcase";
import { AiHero } from "@/features/ai/design/ai-surface";
import { FrenzAITrustRow } from "@/features/ai/frenz-ai-chrome";
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
 *   brand (the crumb pill: logo · Frenz AI / AI Studio)
 *   ↓ hero — Outfit display headline, Inter italic support line
 *   ↓ the showcase — admin-editable slides, 3 s autoplay (ai-showcase.tsx)
 *   ↓ the allowance, when there is one
 *   ↓ trust row
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
          /* Secure · Fast · Natural Results — closes both reference images. */
          <FrenzAITrustRow className="mt-7 border-t border-border/60 pt-5" />
        }
      >
        <AiHero
          tool="AI Studio"
          title="Create. Transform."
          highlight="Perfect."
          subtitle="Professional AI tools for video, voice and audio creation."
          className="px-0"
        />
        <AiShowcase slides={slides} base={base} className="mt-6" />
      </FrenzAIWelcomeLive>
      <AiMembersGate />
    </>
  );
}
