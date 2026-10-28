import { BatchIcon, ChevronRightIcon } from "@/features/frenz-ui/icons";
import type { BillingPlan } from "@/lib/monetization/types";
import { cn } from "@/lib/utils";

/**
 * The redesigned Home's Batch download card (design/Main.dc.html): a white card on the white page,
 * the icon on a flat violet tint, the PRO badge in the brand gradient (a small badge — allowed), and
 * a chevron that turns when the panel opens inline below. Same toggle, same limits as above.
 */
export function FrenzBatchRow({
  open,
  onToggle,
  sourceLimit,
  proLimit,
  plan,
}: {
  open: boolean;
  onToggle: () => void;
  sourceLimit: number;
  proLimit: number;
  /**
   * The visitor's own plan (owner, 2026-10-28: "it should show depending on the user's plan — anonymous users get the
   * Free badge, Pro gets Pro, Business gets just the Business badge"). null until it is known: no badge rather than a
   * wrong one for a moment.
   */
  plan: BillingPlan | null;
}) {
  const badge = plan === "business" ? { label: "BUSINESS", cls: "bg-frenz-ink text-frenz-page" } : plan === "pro" ? { label: "PRO", cls: "bg-frenz-gradient-x text-white" } : plan === "free" ? { label: "FREE", cls: "bg-frenz-fill text-frenz-muted" } : null;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="multi-link-panel"
      className="flex w-full items-center gap-3 rounded-[20px] border border-frenz-line bg-frenz-card px-3.5 py-3 text-left text-frenz-ink shadow-frenz-card transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-frenz-violet"
    >
      <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-frenz-violet/10 text-frenz-violet">
        <BatchIcon size={20} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-bold">Batch download</span>
        <span className="text-[13px] text-frenz-muted">Up to {sourceLimit} links at once</span>
      </span>
      {badge ? (
        <span title={plan === "free" && proLimit > sourceLimit ? `Pro plan: up to ${proLimit} links` : undefined} className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-extrabold tracking-[0.5px]", badge.cls)}>
          {badge.label}
          <span className="sr-only"> plan</span>
        </span>
      ) : null}
      <ChevronRightIcon size={16} strokeWidth={2.4} className={cn("shrink-0 text-frenz-muted transition-transform duration-200 motion-reduce:transition-none", open && "rotate-90")} />
    </button>
  );
}
