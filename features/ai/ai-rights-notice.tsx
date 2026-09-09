import { ShieldCheck } from "lucide-react";

import { AI_RIGHTS_NOTICE } from "@/lib/ai/acceptable-use";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE RIGHTS NOTICE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "add a concise rights notice near the upload/processing
 * action… Make this visually subtle and premium — not a large warning banner."
 *
 * ── 🔴 A NOTE, NOT A WARNING ────────────────────────────────────────────────
 *
 * The temptation with a compliance line is to make it look like compliance —
 * amber, a triangle, a border, the visual language of something having gone
 * wrong. That reads as an accusation aimed at somebody who has not done
 * anything yet, and it is the first thing a visitor sees on a tool they are
 * deciding whether to trust.
 *
 * So this is muted text at the size of a caption, one shield glyph, no border,
 * no fill, no colour of its own. It sits under the action the way a format line
 * or a file-size hint does, because that is what it is: something true about
 * using the tool, stated once, where the decision is made.
 *
 * ── 🔴 A SERVER COMPONENT, DELIBERATELY ─────────────────────────────────────
 *
 * No `"use client"`. It has no state, no handler and no effect, so making it a
 * client component would add a component to the hydration count for a
 * paragraph of static text — against a landing page that already hydrates more
 * than it should and holds a hard page-weight budget. It renders inside client
 * parents perfectly well as long as it is passed as markup rather than
 * imported into one, and where a client parent does import it the cost is the
 * markup only.
 *
 * ── The words are not local ─────────────────────────────────────────────────
 *
 * `AI_RIGHTS_NOTICE` lives beside the policy layer that enforces the same
 * thing. It appears on the picker, the link field and the terms page, and a
 * commitment worded three ways is three different commitments.
 */
export function AIRightsNotice({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "mx-auto flex max-w-sm items-start justify-center gap-1.5 text-center",
        "text-[11px] leading-relaxed text-muted-foreground/75",
        className,
      )}
    >
      <ShieldCheck className="mt-[1px] h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
      <span>{AI_RIGHTS_NOTICE}</span>
    </p>
  );
}
