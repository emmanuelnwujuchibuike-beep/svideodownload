"use client";

import { useEffect, useRef, useState } from "react";

import { takeTopupReturnReference, verifyCharacterReplaceTopup } from "@/lib/ai/character-replace/client";
import { createTopupReturnController, type TopupReturnView } from "@/lib/ai/wallet/topup-return";

/**
 * The return from a credit top-up checkout, for a page a top-up can come back to (Part 4) — a thin React wrapper around
 * createTopupReturnController (lib/ai/wallet/topup-return.ts, where the behaviour is tested).
 *
 * The provider's reference is taken out of the address bar ONCE (so a reload, a bookmark or a back-swipe never
 * re-verifies) and checked with the existing server route, which settles it idempotently. Nothing here credits anything
 * or trusts the URL's `status`. `recheck` asks about the SAME reference again — a status check, one at a time; it can
 * never start a second payment. An AI-plan return (`?ai_plan=`) is not a top-up and is left alone.
 */
export function useTopupReturn(onSettled?: () => void): { view: TopupReturnView | null; recheck: () => void; dismiss: () => void } {
  const [view, setView] = useState<TopupReturnView | null>(null);
  const alive = useRef(true);
  const settled = useRef(onSettled);
  settled.current = onSettled;
  const controller = useRef<ReturnType<typeof createTopupReturnController> | null>(null);
  controller.current ??= createTopupReturnController({
    hasPlanReturn: () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("ai_plan"),
    takeReference: takeTopupReturnReference,
    verify: verifyCharacterReplaceTopup,
    onView: (v) => {
      if (alive.current) setView(v);
    },
    onSettled: () => settled.current?.(),
  });

  useEffect(() => {
    alive.current = true;
    void controller.current?.start();
    return () => {
      alive.current = false;
    };
  }, []);

  return { view, recheck: () => void controller.current?.recheck(), dismiss: () => setView(null) };
}
