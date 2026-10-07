"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";

/*
  The celebration sheet is shared with the AI plans and fetched only when
  there is something to celebrate — a member who did not just subscribe
  downloads nothing for it.
*/
const PlanCelebration = dynamic(() => import("@/features/ai/credits/plan-celebration").then((m) => m.PlanCelebration), { ssr: false });

/**
 * The Frenzsave plan's welcome (owner, 2026-10-07: "the plan welcome survey
 * show on all plans and not just AI plans"). Mounted on /account, which is
 * where a Pro / Business checkout returns (`?upgraded=1`) and where the welcome
 * push lands (`?plan_welcome=1`). The plan is the SERVER's — read from the
 * paid subscription row by the page — so a URL alone celebrates nothing:
 * if the webhook has not activated the plan yet, nothing shows, and the
 * welcome push brings the member back once it has.
 */
export function SitePlanWelcome({ plan, benefits }: { plan: "free" | "pro" | "business"; benefits: readonly string[] }) {
  const [show, setShow] = useState(false);
  const close = useCallback(() => setShow(false), []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("upgraded") && !params.has("plan_welcome")) return;
    params.delete("upgraded");
    params.delete("plan_welcome");
    const rest = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
    if (plan === "pro" || plan === "business") setShow(true);
  }, [plan]);
  if (!show || plan === "free") return null;
  return (
    <PlanCelebration
      plan={plan}
      family="site"
      planLabel={plan === "business" ? "Frenzsave Business" : "Frenzsave Pro"}
      subtitle="Your plan is active — here's what's now yours."
      benefits={benefits}
      onClose={close}
    />
  );
}
