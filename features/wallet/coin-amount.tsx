import { cn } from "@/lib/utils";

import { coinParts, fc } from "./money";

/**
 * A Frenz Coin amount set as a CURRENCY (owner, 2026-10-25: "FC … in a currency write-up and font"): the "FC" code
 * leads, the way a currency symbol does, in the same Sora face as the figure — smaller, raised to the cap line and
 * tightly tracked so it reads as one mark — then the whole number and a quieter fraction, with tabular numerals so
 * amounts line up. Screen readers hear the plain "FC 24,850.00" (lib: money.ts `fc`). Server-safe, no client code.
 */
export function CoinAmount({ cents, signed = false, className, codeClassName, fractionClassName }: { cents: number; signed?: boolean; className?: string; codeClassName?: string; fractionClassName?: string }) {
  const p = coinParts(Math.abs(cents));
  const sign = signed ? (cents > 0 ? "+" : cents < 0 ? "−" : "") : cents < 0 ? "−" : "";
  const spoken = `${sign}${fc(Math.abs(cents))}`;
  return (
    <span className={cn("inline-flex items-baseline whitespace-nowrap font-heading [font-variant-numeric:tabular-nums]", className)} aria-label={spoken} role="text">
      <span aria-hidden>{sign}</span>
      <span aria-hidden className={cn("mr-[0.12em] self-start text-[max(0.5em,10px)] font-extrabold leading-[1.45] tracking-[-0.02em] opacity-80", codeClassName)}>
        FC
      </span>
      <span aria-hidden>{p.whole}</span>
      <span aria-hidden className={cn("opacity-55", fractionClassName)}>
        {p.fraction}
      </span>
    </span>
  );
}
