"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Six-box verification-code input. Auto-focuses, auto-advances, backspace walks
 * left, full-code paste fills every box, and `onComplete` fires the moment the
 * sixth digit lands (auto-verify — no button needed). `shake` plays the error
 * animation and clears the boxes; iOS autofill works via one-time-code hints.
 */
export function OtpInput({
  length = 6,
  disabled,
  shake,
  onComplete,
}: {
  length?: number;
  disabled?: boolean;
  /** Bump this key to play the error shake + reset the boxes. */
  shake?: number;
  onComplete: (code: string) => void;
}) {
  const [values, setValues] = useState<string[]>(() => Array.from({ length }, () => ""));
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const lastShake = useRef(shake);

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  // Error → clear and refocus.
  useEffect(() => {
    if (shake !== undefined && shake !== lastShake.current) {
      lastShake.current = shake;
      setValues(Array.from({ length }, () => ""));
      refs.current[0]?.focus();
    }
  }, [shake, length]);

  const commit = (next: string[]) => {
    setValues(next);
    const code = next.join("");
    if (code.length === length && next.every((v) => v !== "")) onComplete(code);
  };

  const handleChange = (i: number, raw: string) => {
    const digits = raw.replace(/\D/g, "");
    if (!digits) return;
    const next = [...values];
    // A multi-digit entry (paste or iOS one-time-code autofill) spreads forward.
    for (let d = 0; d < digits.length && i + d < length; d++) next[i + d] = digits[d]!;
    commit(next);
    refs.current[Math.min(i + digits.length, length - 1)]?.focus();
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const next = [...values];
      if (next[i]) {
        next[i] = "";
        setValues(next);
      } else if (i > 0) {
        next[i - 1] = "";
        setValues(next);
        refs.current[i - 1]?.focus();
      }
    } else if (e.key === "ArrowLeft" && i > 0) {
      refs.current[i - 1]?.focus();
    } else if (e.key === "ArrowRight" && i < length - 1) {
      refs.current[i + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const digits = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!digits) return;
    const next = Array.from({ length }, (_, i) => digits[i] ?? "");
    commit(next);
    refs.current[Math.min(digits.length, length - 1)]?.focus();
  };

  return (
    <div
      className={cn("flex justify-center gap-2", shake !== undefined && shake > 0 && "animate-[otp-shake_0.4s_ease-in-out]")}
      // Re-mount the animation on every new shake key.
      key={shake}
      onPaste={handlePaste}
    >
      {values.map((v, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          pattern="\d*"
          maxLength={length} // allow autofill/paste to land in one box and spread
          value={v}
          disabled={disabled}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={(e) => e.target.select()}
          aria-label={`Digit ${i + 1} of ${length}`}
          className={cn(
            "h-14 w-11 rounded-2xl border bg-secondary/40 text-center text-xl font-bold tabular-nums outline-none transition-all",
            v ? "border-violet-500/50 bg-background shadow-[0_0_0_4px_rgba(139,92,246,0.10)]" : "border-border/60",
            "focus:border-violet-500/60 focus:bg-background focus:shadow-[0_0_0_4px_rgba(139,92,246,0.14)]",
            "disabled:opacity-50",
          )}
        />
      ))}
    </div>
  );
}
