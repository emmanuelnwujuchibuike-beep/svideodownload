"use client";

import { Mic } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The dictation mic inside the prompt box (step 18, design/TextToVideo.dc.html, owner 2026-10-19).
 *
 * The browser's own speech recognition (Web Speech API) — no library, no upload of ours, nothing loaded
 * until the mic is tapped. Where the browser has none, the button isn't drawn. What is said is added to the
 * end of the prompt, within its limit; tapping again stops listening.
 */

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function AiDictationButton({ value, onChange, max, disabled }: { value: string; onChange: (v: string) => void; max: number; disabled?: boolean }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  // the latest prompt, so a result appends to what is there NOW, not what was there when listening began
  const current = useRef(value);
  current.current = value;

  useEffect(() => setSupported(!!recognitionCtor()), []);
  useEffect(() => () => rec.current?.stop(), []);

  if (!supported) return null;

  const toggle = () => {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = navigator.language || "en-US";
    r.interimResults = false;
    r.continuous = true;
    r.onresult = (e) => {
      let said = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res?.isFinal) said += res[0].transcript;
      }
      said = said.trim();
      if (!said) return;
      const base = current.current;
      onChange(`${base}${base && !/\s$/.test(base) ? " " : ""}${said}`.slice(0, max));
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      aria-pressed={listening}
      aria-label={listening ? "Stop dictation" : "Dictate your prompt"}
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-frenz-violet disabled:opacity-50",
        listening ? "bg-frenz-gradient-x text-white" : "bg-frenz-fill text-frenz-ink",
      )}
    >
      <Mic className={cn("h-[18px] w-[18px]", listening && "motion-safe:animate-pulse")} aria-hidden />
    </button>
  );
}
