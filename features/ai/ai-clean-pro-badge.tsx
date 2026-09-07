import { cn } from "@/lib/utils";

/**
 * The Pro mark used across Frenz AI.
 *
 * ── Why gold and not another gradient ─────────────────────────────────────────
 * Premium is already spoken for in this design system: `--gold`, `.text-gradient-gold`
 * and `.ring-hairline-gold` exist precisely so paid moments read the same
 * everywhere. Frenz AI's own colour is the blue→purple brand sweep; if Pro used
 * that too, the badge would disappear into the surface it sits on and the page
 * would be one gradient with a word in it.
 *
 * ── Tasteful means small, not hidden ──────────────────────────────────────────
 * Owner: "Show a tasteful Pro badge throughout the experience… visible but not
 * aggressive." So it is a hairline pill at caption size — no glow, no animation,
 * no filled block — and it never gates the interface it labels. A free member
 * sees this badge and the whole tool behind it.
 *
 * `PRO` is styled uppercase rather than written uppercase, so a screen reader
 * says "pro feature" instead of spelling out three letters.
 */
export function AICleanProBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex select-none items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em]",
        "bg-gold/10 text-gold ring-1 ring-gold/30 dark:bg-gold/[0.12]",
        className,
      )}
    >
      <span aria-hidden>Pro</span>
      <span className="sr-only">Pro feature</span>
    </span>
  );
}
