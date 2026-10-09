"use client";

import { ExternalLink, ShieldAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Portal } from "@/components/ui/portal";
import type { EligibleAd } from "@/lib/ads-platform/eligibility";
import { haptic } from "@/lib/motion/haptics";

import { trackAdEvent, type AdView } from "../ad-events-client";
import { destinationHost } from "./self-ad-creative";

/**
 * The ad's details, on the page the member is already on (owner, 2026-10-09).
 * Step 1 shows the creative, the sponsor, the headline, the text and where the
 * link goes. "Visit" never leaves at once: step 2 warns that it is an external
 * site not run by Frenzsave. Only "Continue" opens it (new tab, no referrer),
 * and that is the `outbound` count. CSS only: no animation library.
 */
export function AdDetailSheet({ ad, view, onClose }: { ad: EligibleAd; view: AdView | null; onClose: () => void }) {
  const [step, setStep] = useState<"detail" | "warn">("detail");
  const host = destinationHost(ad.url) || "the advertiser's site";
  const closeBtn = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflowY = prev;
    };
  }, [onClose]);

  const visit = () => {
    if (view) trackAdEvent(view, "outbound");
    haptic("medium");
    window.open(ad.url, "_blank", "noopener,noreferrer");
    onClose();
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-[140] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={`Ad from ${ad.sponsor}`}>
        <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/55 animate-in fade-in duration-200 motion-reduce:animate-none" />
        <div className="relative w-full max-w-md overflow-hidden rounded-t-[1.75rem] bg-background shadow-2xl animate-in slide-in-from-bottom-6 duration-300 motion-reduce:animate-none sm:rounded-[1.75rem]" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1rem)" }}>
          <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/90 px-2 py-0.5 text-[10.5px] font-extrabold uppercase tracking-wide text-amber-950">Sponsored</span>
            <button ref={closeBtn} type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-muted-foreground transition active:scale-90">
              <X className="h-4 w-4" />
            </button>
          </div>

          {step === "detail" ? (
            <div className="px-4">
              <div className="overflow-hidden rounded-2xl bg-muted ring-1 ring-inset ring-black/[0.06] dark:ring-white/10">
                {ad.mediaType === "video" ? (
                  <video src={ad.media} poster={ad.thumb ?? undefined} className="max-h-[42vh] w-full bg-black object-contain" muted playsInline autoPlay loop controls />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ad.media} alt="" className="max-h-[42vh] w-full object-contain" />
                )}
              </div>
              <p className="mt-3 text-[12px] font-semibold text-muted-foreground">{ad.sponsor}</p>
              {ad.headline ? <h2 className="mt-0.5 text-[17px] font-bold leading-snug tracking-[-0.01em]">{ad.headline}</h2> : null}
              {ad.body ? <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">{ad.body}</p> : null}
              <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate">{host}</span>
              </p>
              <button
                type="button"
                onClick={() => {
                  haptic("selection");
                  setStep("warn");
                }}
                className="mt-4 inline-flex min-h-[3rem] w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-violet-500 text-[15px] font-bold text-white transition active:scale-[0.98]"
              >
                Visit {host}
                <ExternalLink className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ) : (
            <div className="px-4">
              <span className="mx-auto mt-1 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-600">
                <ShieldAlert className="h-6 w-6" aria-hidden />
              </span>
              <h2 className="mt-3 text-center text-[17px] font-bold">You&apos;re leaving Frenzsave</h2>
              <p className="mt-1.5 text-center text-[13.5px] leading-relaxed text-muted-foreground">
                This link opens <span className="font-semibold text-foreground">{host}</span>, an external website. Frenzsave doesn&apos;t run it and isn&apos;t responsible for its content.
              </p>
              <button type="button" onClick={visit} className="mt-4 inline-flex min-h-[3rem] w-full items-center justify-center gap-2 rounded-full bg-foreground text-[15px] font-bold text-background transition active:scale-[0.98]">
                Continue to {host}
                <ExternalLink className="h-4 w-4" aria-hidden />
              </button>
              <button type="button" onClick={() => setStep("detail")} className="mt-2 inline-flex min-h-[2.75rem] w-full items-center justify-center rounded-full text-[14px] font-semibold text-muted-foreground">
                Stay on Frenzsave
              </button>
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
}
