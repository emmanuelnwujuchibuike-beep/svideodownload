"use client";

import { useEntitlements } from "@/features/auth/use-entitlements";

import { DiamondCrownBadge } from "./diamond-crown-badge";

/**
 * The signed-in viewer's own Diamond Crown badge (client-side; resolves the plan
 * via cached `/api/me`). Renders nothing for free users or until ready.
 */
export function MyDiamondCrownBadge({
  size = "sm",
  showLabel = false,
  className,
}: {
  size?: "xs" | "sm" | "md";
  showLabel?: boolean;
  className?: string;
}) {
  const { plan, ready } = useEntitlements();
  if (!ready) return null;
  return <DiamondCrownBadge plan={plan} size={size} showLabel={showLabel} className={className} />;
}
