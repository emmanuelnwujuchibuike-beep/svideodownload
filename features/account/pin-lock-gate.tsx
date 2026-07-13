"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Delete, Lock } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";

/** Paths this quick-lock gate protects — messages + the new security
 *  settings page (the two surfaces named in the owner's spec). */
const GATED_PREFIXES = ["/messages", "/account/security"];

const LAST_ACTIVE_KEY = "frenz:pin-last-active";
const UNLOCKED_KEY = "frenz:pin-unlocked-until-lock"; // cleared on real idle, not on nav

function isGatedPath(pathname: string): boolean {
  return GATED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * App-level quick-lock overlay (Part 11a). Mounted once in the app shell
 * (see app/(app)/layout.tsx), portaled to document.body per the standing
 * "every overlay must portal itself" convention (a past bug: an unportaled
 * overlay got clipped/mispositioned by an ancestor's backdrop-blur —
 * see [[fullscreen-video]]). Only ever activates on a gated path AND for
 * accounts that actually set a PIN — zero behavior change otherwise.
 */
export function PinLockGate() {
  const pathname = usePathname();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [hasPin, setHasPin] = useState(false);
  const [pinLength, setPinLength] = useState(4);
  const [autoLockMs, setAutoLockMs] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);
  const [digits, setDigits] = useState("");
  const [error, setError] = useState(false);
  // Distinct from a wrong PIN: a timeout/network failure shouldn't tell the
  // owner their correct PIN was "incorrect" — see submit()'s timeout comment.
  const [connError, setConnError] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const checkedIdleOnce = useRef(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    // Time-boxed (docs/STARTUP_AUDIT.md pattern): this gate is mounted for
    // EVERY signed-in page load, but only ever does anything for the accounts
    // that set a PIN (Part 11a) — in practice, almost never a test account,
    // so a stalled connection here went unnoticed by the same audit that
    // time-boxed every other startup call. Left un-timeboxed, a hung request
    // just means hasPin never flips true, which fails safe (no gate shown) —
    // but that's still a silent hang worth bounding like everything else.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    fetch("/api/v1/app/security/pin/status", { signal: controller.signal })
      .then((r) => r.json())
      .then((json) => {
        if (json.ok && json.data.hasPin) {
          setHasPin(true);
          setAutoLockMs(json.data.autoLockMinutes * 60_000);
          setPinLength(json.data.pinLength ?? 4);
        }
      })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, []);

  // Idle tracking — a real elapsed-time check, not a per-nav reset, so
  // switching pages inside the app never itself triggers a lock.
  useEffect(() => {
    if (!hasPin || autoLockMs === null) return;

    const markActive = () => {
      try {
        sessionStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
      } catch {
        /* storage blocked — gate just never fires this session */
      }
    };

    if (!checkedIdleOnce.current) {
      checkedIdleOnce.current = true;
      try {
        const last = Number(sessionStorage.getItem(LAST_ACTIVE_KEY) || 0);
        if (last && Date.now() - last > autoLockMs) {
          sessionStorage.removeItem(UNLOCKED_KEY);
        }
      } catch {
        /* ignore */
      }
    }
    markActive();

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      try {
        const last = Number(sessionStorage.getItem(LAST_ACTIVE_KEY) || 0);
        if (last && Date.now() - last > autoLockMs) sessionStorage.removeItem(UNLOCKED_KEY);
      } catch {
        /* ignore */
      }
      markActive();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", markActive);
    const interval = setInterval(markActive, 30_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", markActive);
      clearInterval(interval);
    };
  }, [hasPin, autoLockMs]);

  // Decide whether to lock, whenever the route or PIN status changes.
  useEffect(() => {
    if (!hasPin || !isGatedPath(pathname)) {
      setLocked(false);
      return;
    }
    try {
      setLocked(sessionStorage.getItem(UNLOCKED_KEY) !== "1");
    } catch {
      setLocked(false);
    }
  }, [hasPin, pathname]);

  // bfcache restore (iOS Safari edge-swipe "back", most other browsers'
  // back/forward too) resumes this component's React state EXACTLY as it was
  // frozen — no effect re-runs, no re-render, since it's the same JS heap
  // thawed rather than a fresh mount. Every other piece of cross-request
  // state in this app has a `pageshow`(persisted) handler for this reason
  // (features/data/cache.ts's ensureGlobalRevalidation, conversation-room.tsx's
  // bespoke one — see docs/STARTUP_AUDIT.md) but this gate, added afterward
  // in Part 11a, never got one. Concretely: if the admin was frozen mid
  // `submit()` (verifying=true, an in-flight fetch whose underlying
  // connection dies with the frozen page and whose promise then never
  // resolves) the keypad comes back from bfcache with every digit button
  // permanently `disabled` and no way to retry — a real "stuck" gate,
  // admin-only because they're the only account that ever enrolls a PIN,
  // mobile-only because iOS Safari's gesture-back is what actually exercises
  // bfcache restore for this SPA (desktop back/forward stays a live
  // client-side popstate nav here, never a freeze/thaw). Re-derive `locked`
  // fresh and drop any stale in-flight/error state on restore.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      setVerifying(false);
      setError(false);
      setConnError(false);
      setDigits("");
      if (!hasPin || !isGatedPath(pathname)) {
        setLocked(false);
        return;
      }
      try {
        setLocked(sessionStorage.getItem(UNLOCKED_KEY) !== "1");
      } catch {
        setLocked(false);
      }
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [hasPin, pathname]);

  const submit = async (pin: string) => {
    setVerifying(true);
    setError(false);
    setConnError(false);
    // Time-boxed (docs/STARTUP_AUDIT.md pattern): without this, a stalled
    // connection to Supabase left `verifying` true forever — a disabled,
    // unresponsive keypad with no error and no way to retry, which is
    // exactly the "messages page stuck loading" symptom, except it only ever
    // fires for an account that actually set a PIN (Part 11a). Every other
    // auth-critical-path fetch in the app already races a timeout; this one,
    // added a day after that audit, was missed.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch("/api/v1/app/security/pin/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin }),
        signal: controller.signal,
      });
      const json = await res.json();
      if (json.ok && json.data.ok) {
        try {
          sessionStorage.setItem(UNLOCKED_KEY, "1");
        } catch {
          /* ignore */
        }
        setLocked(false);
        setDigits("");
        // The verify route also issued a server-side pin-unlock step-up
        // cookie — refresh so the current page's Server Component (which may
        // have rendered a locked placeholder instead of real content, see
        // lib/security/pin-gate.ts) re-renders now that it's present.
        router.refresh();
      } else {
        setError(true);
        setDigits("");
      }
    } catch {
      // Covers both a real network failure and our own abort() timeout —
      // either way this is "couldn't verify", not "wrong PIN".
      setConnError(true);
      setDigits("");
    } finally {
      clearTimeout(timer);
      setVerifying(false);
    }
  };

  const tap = (d: string) => {
    if (verifying) return;
    // Every other tappable control in the app fires the shared haptic + soft
    // "tap" tone (mobile-nav.tsx, conversation-room.tsx, etc.) — this keypad
    // was built without it, so an account with a PIN set (in practice, only
    // the real owner/admin account — no test account ever enrolls one) got
    // silent taps on the one screen they hit constantly, reading as "haptics
    // don't work on this account" when every other button elsewhere is fine.
    haptic("light");
    playSound("tap");
    const next = (digits + d).slice(0, pinLength);
    setDigits(next);
    setError(false);
    setConnError(false);
    // Auto-submit at the ACCOUNT'S configured PIN length (4-8, set on
    // pin-settings-editor.tsx) — auto-submitting at a hardcoded 4 burned a
    // failed attempt on every legitimate unlock for any longer PIN, since a
    // valid 6-digit PIN's first 4 digits are never themselves a valid code.
    if (next.length >= pinLength) void submit(next);
  };

  if (!mounted || !locked) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-background/98 px-6 backdrop-blur-xl"
        role="dialog"
        aria-modal="true"
        aria-label="Enter your PIN to continue"
      >
        <Lock className="h-8 w-8 text-muted-foreground" />
        <h1 className="mt-4 text-lg font-semibold">Enter your PIN</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {connError
            ? "Couldn't verify — check your connection and try again."
            : error
              ? "Incorrect PIN — try again."
              : "Unlock to continue."}
        </p>

        <div className="mt-6 flex gap-3">
          {Array.from({ length: pinLength }).map((_, i) => (
            <span
              key={i}
              className={`h-3 w-3 rounded-full transition ${i < digits.length ? "bg-primary" : "bg-secondary"} ${error || connError ? "bg-red-400" : ""}`}
            />
          ))}
        </div>

        <div className="mt-8 grid grid-cols-3 gap-3">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map((d, i) =>
            d === "" ? (
              <span key={i} />
            ) : d === "del" ? (
              <button
                key={i}
                type="button"
                onClick={() => {
                  haptic("light");
                  playSound("tap");
                  setDigits((v) => v.slice(0, -1));
                }}
                aria-label="Delete digit"
                className="flex h-16 w-16 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary/60"
              >
                <Delete className="h-5 w-5" />
              </button>
            ) : (
              <button
                key={i}
                type="button"
                onClick={() => tap(d)}
                disabled={verifying}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary/40 text-xl font-semibold transition hover:bg-secondary/70 disabled:opacity-50"
              >
                {d}
              </button>
            ),
          )}
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
