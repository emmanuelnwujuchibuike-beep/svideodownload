"use client";

import { AudioLines, Check, Mic2 } from "lucide-react";
import { useId } from "react";

import type { CharacterReplaceLipSyncTier, CharacterReplacePublicConfig } from "@/lib/ai/character-replace/config";
import type { CharacterReplaceProject } from "@/lib/ai/character-replace/types";
import { cn } from "@/lib/utils";

/**
 * Step 4 — voice & language.
 *
 * Two choices, as cards: keep the original audio, or generate a new voice.
 * The second reveals language, voice and lip-sync quality — every option a
 * row from the server's config (§9: "structure this as dynamic
 * configuration"), so the languages offered are the operator's list and not
 * a claim about what a provider speaks. Studio is the premium tier and wears
 * a small "Premium" chip in the product's gold — a fact about the TIER, so
 * it is not the viewer's plan seal (which says who the viewer is).
 *
 * Nothing here is connected to a model (§20). The step records a choice.
 */
export function CharacterReplaceVoiceStep({
  project,
  config,
  onMode,
  onLanguage,
  onVoice,
  onTier,
}: {
  project: CharacterReplaceProject;
  config: CharacterReplacePublicConfig;
  onMode: (mode: "original" | "new_voice") => void;
  onLanguage: (code: string) => void;
  onVoice: (id: string) => void;
  onTier: (tier: CharacterReplaceLipSyncTier) => void;
}) {
  const id = useId();
  const newVoice = project.voice.mode === "new_voice";
  const voices = config.voices.filter(
    (v) => v.languages.length === 0 || (project.voice.languageCode !== null && v.languages.includes(project.voice.languageCode)),
  );

  return (
    <div className="space-y-6">
      <section aria-labelledby={`${id}-mode`}>
        <h3 id={`${id}-mode`} className="text-[15px] font-bold tracking-[-0.01em]">
          Audio
        </h3>
        <div role="radiogroup" aria-labelledby={`${id}-mode`} className="mt-3 grid gap-2 sm:grid-cols-2">
          <ModeCard
            active={!newVoice}
            icon={<AudioLines className="h-5 w-5" aria-hidden />}
            title="Original audio"
            body="Keep the sound exactly as it is in your video."
            onClick={() => onMode("original")}
          />
          <ModeCard
            active={newVoice}
            icon={<Mic2 className="h-5 w-5" aria-hidden />}
            title="New voice"
            body="Generate a new voice in the language you choose, with matching lip movement."
            onClick={() => onMode("new_voice")}
            disabled={!config.lipSyncEnabled}
            note={config.lipSyncEnabled ? null : "Not available right now"}
          />
        </div>
      </section>

      {newVoice ? (
        <>
          <section>
            <label htmlFor={`${id}-language`} className="text-[15px] font-bold tracking-[-0.01em]">
              Language
            </label>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">The language the new voice speaks.</p>
            <div className="relative mt-3">
              <select
                id={`${id}-language`}
                value={project.voice.languageCode ?? ""}
                onChange={(e) => onLanguage(e.target.value)}
                className={cn(
                  "h-12 w-full appearance-none rounded-2xl border border-border/70 bg-card px-4 pr-10 text-[14px] font-semibold",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                {config.languages.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                    {l.native !== l.label ? ` — ${l.native}` : ""}
                  </option>
                ))}
              </select>
              <Chevron />
            </div>
          </section>

          <section aria-labelledby={`${id}-voice`}>
            <h3 id={`${id}-voice`} className="text-[15px] font-bold tracking-[-0.01em]">
              Voice
            </h3>
            <div role="radiogroup" aria-labelledby={`${id}-voice`} className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {voices.map((v) => {
                const active = v.id === project.voice.voiceId;
                return (
                  <button
                    key={v.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => onVoice(v.id)}
                    className={cn(
                      "min-h-[64px] rounded-2xl border px-3 py-3 text-left transition",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                      active ? "border-foreground bg-foreground text-background" : "border-border/70 bg-card hover:border-foreground/30",
                    )}
                  >
                    <span className="block text-[14px] font-bold">{v.label}</span>
                    <span className={cn("mt-0.5 block text-[11.5px] leading-snug", active ? "text-background/70" : "text-muted-foreground")}>
                      {v.blurb}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section aria-labelledby={`${id}-lip`}>
            <h3 id={`${id}-lip`} className="text-[15px] font-bold tracking-[-0.01em]">
              Lip sync quality
            </h3>
            <div role="radiogroup" aria-labelledby={`${id}-lip`} className="mt-3 grid gap-2 sm:grid-cols-2">
              {config.lipSync.map((tier) => {
                const active = tier.id === project.lipSync.tier;
                return (
                  <button
                    key={tier.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => onTier(tier.id)}
                    className={cn(
                      "flex items-start gap-3 rounded-2xl border px-4 py-3.5 text-left transition",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                      active ? "border-foreground bg-card shadow-[0_10px_24px_-18px_rgba(15,23,42,0.55)]" : "border-border/70 bg-card hover:border-foreground/30",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition",
                        active ? "border-foreground bg-foreground text-background" : "border-border",
                      )}
                    >
                      {active ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-[14px] font-bold">
                        {tier.label}
                        {tier.premium ? (
                          <span className="rounded-full border border-amber-400/30 bg-amber-400/[0.10] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-700 dark:text-amber-300">
                            Premium
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-[12.5px] leading-snug text-muted-foreground">{tier.blurb}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function ModeCard({
  active,
  icon,
  title,
  body,
  onClick,
  disabled = false,
  note = null,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  body: string;
  onClick: () => void;
  disabled?: boolean;
  note?: string | null;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex items-start gap-3 rounded-2xl border px-4 py-4 text-left transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-55",
        active ? "border-foreground bg-card shadow-[0_10px_24px_-18px_rgba(15,23,42,0.55)]" : "border-border/70 bg-card hover:border-foreground/30",
      )}
    >
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", active ? "bg-foreground text-background" : "bg-secondary text-foreground/80")}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] font-bold">{title}</span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-muted-foreground">{body}</span>
        {note ? <span className="mt-1.5 inline-block rounded-full bg-secondary px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{note}</span> : null}
      </span>
    </button>
  );
}

function Chevron() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 8l4 4 4-4" />
    </svg>
  );
}
