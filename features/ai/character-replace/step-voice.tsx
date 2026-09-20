"use client";

import { AudioLines, Check, FileAudio, Mic2, ShieldCheck, Trash2, Type as TypeIcon, Upload } from "lucide-react";
import { useId, useState } from "react";

import type { CharacterReplaceLipSyncTier, CharacterReplacePublicConfig, CharacterReplacePublicVoice } from "@/lib/ai/character-replace/config";
import type { CharacterReplaceVoiceSource } from "@/lib/ai/character-replace/pricing";
import type { AssetSlot, CharacterReplaceProject } from "@/lib/ai/character-replace/types";
import { dialogueCharacters, formatSeconds, selectedDurationSeconds } from "@/lib/ai/character-replace/workspace";
import { AUDIO_ACCEPT, AUDIO_ERRORS, AUDIO_FIT_TOLERANCE_MS, AUDIO_FORMAT_LINE, estimateSpeechMs, type AudioErrorCode } from "@/lib/ai/voice/audio-validate";
import { VOICE_AGE_LABEL, VOICE_AGES, VOICE_GENDER_LABEL, VOICE_GENDERS, type VoiceAge, type VoiceGender } from "@/lib/ai/voice/elevenlabs-models";
import { cn, formatBytes } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Step 4 — Voice & Language (Part 6 §19–§20)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   Audio            Original audio · Replace voice
 *   Source           Upload audio · Generate from text
 *     upload         the file, its length against the video, "cut to fit"
 *                    when it is longer, and the rights confirmation (§6)
 *     text           Language · Voice · Dialogue (with a speaking-time
 *                    estimate against the video)
 *   Studio Lip Sync  a premium card with a toggle; the tier under it
 *
 * Every option is a row from the server's config: the languages are the
 * operator's catalogue intersected with what the configured voice provider
 * speaks (§7), the voices are the catalogue filtered by language, the tiers
 * are the operator's. No model name is ever printed (§19: never
 * "sync/lipsync-2-pro"). Nothing here computes a price; the cost preview
 * asks the server on every change.
 */
export function CharacterReplaceVoiceStep({
  project,
  config,
  audioSlot,
  onMode,
  onSource,
  onPickAudio,
  onClearAudio,
  onTrimToFit,
  onVoiceConsent,
  onText,
  onLanguage,
  onVoice,
  onChangeVoice,
  onChangeVoiceId,
  onTier,
  onLipSyncOff,
}: {
  project: CharacterReplaceProject;
  config: CharacterReplacePublicConfig;
  audioSlot: AssetSlot;
  onMode: (mode: "original" | "new_voice") => void;
  onSource: (source: CharacterReplaceVoiceSource) => void;
  onPickAudio: (file: File) => void;
  onClearAudio: () => void;
  onTrimToFit: (value: boolean) => void;
  onVoiceConsent: (value: boolean) => void;
  onText: (text: string) => void;
  onLanguage: (code: string) => void;
  onVoice: (id: string) => void;
  /** 2026-09-20: re-voice an uploaded recording in a catalogue voice — on/off, and which. */
  onChangeVoice: (on: boolean) => void;
  onChangeVoiceId: (id: string) => void;
  onTier: (tier: CharacterReplaceLipSyncTier) => void;
  onLipSyncOff: () => void;
}) {
  const id = useId();
  const v = project.voice;
  const newVoice = v.mode === "new_voice";
  const offered = config.newVoiceEnabled && (config.audio.uploadEnabled || config.tts.enabled);
  const languages = config.languages.filter((l) => config.tts.languages.includes(l.code));
  const voices = config.voices.filter((x) => x.languages.length === 0 || (v.languageCode !== null && x.languages.includes(v.languageCode)));
  const videoSeconds = selectedDurationSeconds(project);
  const videoMs = videoSeconds !== null ? Math.round(videoSeconds * 1000) : null;
  const chars = dialogueCharacters(v.text);
  const speechMs = estimateSpeechMs(v.text);
  const audioError = audioSlot.status === "invalid" || audioSlot.status === "error" ? AUDIO_ERRORS[audioSlot.code as AudioErrorCode] : null;
  const audioLonger = v.audio?.durationMs !== null && v.audio?.durationMs !== undefined && videoMs !== null && v.audio.durationMs - videoMs > AUDIO_FIT_TOLERANCE_MS;
  const audioMuchShorter =
    v.audio?.durationMs !== null && v.audio?.durationMs !== undefined && videoMs !== null && config.audio.minimumCoverageFraction > 0 && v.audio.durationMs / videoMs < config.audio.minimumCoverageFraction;
  const lipOn = project.lipSync.tier !== null;
  const lipOffered = config.lipSyncEnabled && config.lipSync.length > 0 && (videoSeconds === null || videoSeconds <= config.lipSyncMaximumDurationSeconds + 0.05);

  return (
    <div className="space-y-6">
      {/* ── Audio ─────────────────────────────────────────────────────────── */}
      <section aria-labelledby={`${id}-mode`}>
        <h3 id={`${id}-mode`} className="text-[15px] font-bold tracking-[-0.01em]">
          Audio
        </h3>
        <div role="radiogroup" aria-labelledby={`${id}-mode`} className="mt-3 grid gap-2 sm:grid-cols-2">
          <ChoiceCard
            active={!newVoice}
            icon={<AudioLines className="h-5 w-5" aria-hidden />}
            title="Keep original audio"
            body="The sound stays exactly as it is in your video. Lip sync isn't needed."
            onClick={() => onMode("original")}
            badge="Recommended"
          />
          <ChoiceCard
            active={newVoice}
            icon={<Mic2 className="h-5 w-5" aria-hidden />}
            title="Replace voice"
            body="Use your own audio, or generate a voice from text. Add lip sync to match the mouth to the new voice."
            onClick={() => onMode("new_voice")}
            disabled={!offered}
            note={offered ? null : "Not available right now"}
          />
        </div>
      </section>

      {newVoice ? (
        <>
          {/* ── Source ────────────────────────────────────────────────────── */}
          <section aria-labelledby={`${id}-source`}>
            <h3 id={`${id}-source`} className="text-[15px] font-bold tracking-[-0.01em]">
              Source
            </h3>
            <div role="radiogroup" aria-labelledby={`${id}-source`} className="mt-3 grid gap-2 sm:grid-cols-2">
              <ChoiceCard
                active={v.source === "upload"}
                icon={<Upload className="h-5 w-5" aria-hidden />}
                title="Upload audio or a video"
                body="A recording, a voice-over, or a video from your gallery — only its sound is used."
                onClick={() => onSource("upload")}
                disabled={!config.audio.uploadEnabled}
                note={config.audio.uploadEnabled ? null : "Not available right now"}
              />
              <ChoiceCard
                active={v.source === "tts"}
                icon={<TypeIcon className="h-5 w-5" aria-hidden />}
                title="Generate from text"
                body="Type the dialogue and choose a language and a voice."
                onClick={() => onSource("tts")}
                disabled={!config.tts.enabled || languages.length === 0}
                note={config.tts.enabled && languages.length > 0 ? null : "Not available right now"}
              />
            </div>
          </section>

          {/* ── Upload ────────────────────────────────────────────────────── */}
          {v.source === "upload" ? (
            <section aria-labelledby={`${id}-audio`}>
              <h3 id={`${id}-audio`} className="text-[15px] font-bold tracking-[-0.01em]">
                Your voice
              </h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                An audio file, or a video from your gallery — only its sound is used. {AUDIO_FORMAT_LINE} · up to {config.audio.maximumDurationSeconds} seconds and{" "}
                {formatBytes(config.audio.maximumUploadBytes)}.
              </p>
              {!v.audio ? (
                <label
                  className={cn(
                    "mt-3 flex min-h-[112px] cursor-pointer flex-col items-center justify-center gap-2 rounded-[1.25rem] border border-dashed border-border bg-card px-4 py-5 text-center transition hover:border-foreground/40",
                    audioSlot.status === "validating" && "pointer-events-none opacity-70",
                  )}
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary text-foreground/80">
                    <FileAudio className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="text-[14px] font-bold">{audioSlot.status === "validating" ? "Reading your file…" : "Choose an audio file or a video"}</span>
                  <span className="text-[12px] text-muted-foreground">It stays on your device until you press Create.</span>
                  <input
                    type="file"
                    accept={AUDIO_ACCEPT}
                    className="sr-only"
                    disabled={audioSlot.status === "validating"}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onPickAudio(f);
                      e.target.value = "";
                    }}
                  />
                </label>
              ) : (
                <div className="mt-3 rounded-[1.25rem] border border-border/70 bg-card px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground/80">
                      <FileAudio className="h-5 w-5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-semibold" title={v.audio.name}>
                        {v.audio.name}
                      </p>
                      <p className="text-[12px] tabular-nums text-muted-foreground">
                        {v.audio.durationMs !== null ? formatSeconds(v.audio.durationMs / 1000) : "length unknown"} · {formatBytes(v.audio.size)}
                        {videoSeconds !== null ? ` · video ${formatSeconds(videoSeconds)}` : ""}
                      </p>
                    </div>
                    <button type="button" onClick={onClearAudio} aria-label="Remove audio" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground">
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                  {audioLonger ? (
                    /* §4: never cut without being told to */
                    <div className="mt-3 rounded-2xl border border-amber-500/35 bg-amber-500/[0.07] px-3.5 py-3">
                      <p className="text-[13px] font-bold">Your audio is longer than the selected video.</p>
                      <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
                        Keep more of the video, choose a shorter file, or let us cut the audio to the video&apos;s length.
                      </p>
                      <Tick id={`${id}-trimfit`} checked={v.trimAudioToFit} onChange={onTrimToFit} label={`Cut the audio to ${videoSeconds !== null ? formatSeconds(videoSeconds) : "the video's length"}`} />
                    </div>
                  ) : audioMuchShorter ? (
                    <p role="status" className="mt-3 rounded-2xl border border-amber-500/35 bg-amber-500/[0.07] px-3.5 py-3 text-[12.5px] leading-relaxed">
                      <strong>Your audio is much shorter than the selected video.</strong> Trim the video or use longer audio — the character would fall silent for most of it.
                    </p>
                  ) : v.audio.durationMs !== null && videoMs !== null && videoMs - v.audio.durationMs > AUDIO_FIT_TOLERANCE_MS ? (
                    <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">
                      The audio is shorter than the video; the character will stop speaking when it ends.
                    </p>
                  ) : null}
                </div>
              )}
              {audioError ? (
                <p role="alert" className="mt-2 text-[12.5px] font-semibold text-rose-500">
                  {audioError.title}. {audioError.body}
                </p>
              ) : null}

              {/* §6 — the rights confirmation, required for an uploaded voice */}
              <div className="mt-3 rounded-[1.25rem] border border-border/70 bg-card px-4 py-3.5">
                <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-muted-foreground">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" aria-hidden />
                  Create videos using your own voice or voices you have permission to use.
                </p>
                <Tick id={`${id}-voiceconsent`} checked={v.voiceConsent} onChange={onVoiceConsent} label="I confirm that I own this voice or have permission to use it." strong />
              </div>

              {/*
                ── Change the voice (2026-09-20) ────────────────────────────
                Owner: "when converting a video to audio a gender and voice
                set-up should be available in the run steps." The recording's
                words and timing stay; a catalogue voice of the gender and age
                the member picks speaks them. Priced per second — the switch
                marks the price stale and the summary re-quotes.
              */}
              {config.voiceChange.enabled ? (
                <section aria-labelledby={`${id}-change`} className="mt-3 rounded-[1.5rem] border border-border/70 bg-gradient-to-br from-card via-card to-violet-500/[0.06] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 id={`${id}-change`} className="text-[15px] font-bold tracking-[-0.01em]">
                        Change the voice
                      </h3>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                        Keep the words and timing of your recording, spoken by a different voice — pick a gender and an age, then a voice.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={v.changeVoice}
                      aria-label="Change the voice"
                      onClick={() => onChangeVoice(!v.changeVoice)}
                      className={cn(
                        "relative h-7 w-12 shrink-0 rounded-full transition",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                        v.changeVoice ? "bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500" : "bg-secondary",
                      )}
                    >
                      <span aria-hidden className={cn("absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-[left]", v.changeVoice ? "left-6" : "left-1")} />
                    </button>
                  </div>
                  {v.changeVoice ? (
                    <div className="mt-3">
                      <VoicePicker id={`${id}-changevoice`} voices={config.voiceChange.voices} value={v.changeVoiceId} onChange={onChangeVoiceId} />
                    </div>
                  ) : null}
                </section>
              ) : null}
            </section>
          ) : null}

          {/* ── Generate from text ────────────────────────────────────────── */}
          {v.source === "tts" ? (
            <>
              <section>
                <label htmlFor={`${id}-language`} className="text-[15px] font-bold tracking-[-0.01em]">
                  Language
                </label>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">The language the new voice speaks.</p>
                <div className="relative mt-3">
                  <select
                    id={`${id}-language`}
                    value={v.languageCode ?? ""}
                    onChange={(e) => onLanguage(e.target.value)}
                    className={cn(
                      "h-12 w-full appearance-none rounded-2xl border border-border/70 bg-card px-4 pr-10 text-[14px] font-semibold",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                  >
                    {languages.map((l) => (
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
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">Pick a gender and an age, then the voice that fits the character.</p>
                <div className="mt-3">
                  <VoicePicker id={`${id}-voice`} voices={voices} value={v.voiceId} onChange={onVoice} />
                </div>
              </section>

              <section>
                <label htmlFor={`${id}-text`} className="text-[15px] font-bold tracking-[-0.01em]">
                  Dialogue
                </label>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">Type or paste what the character says.</p>
                <textarea
                  id={`${id}-text`}
                  value={v.text}
                  onChange={(e) => onText(e.target.value)}
                  rows={4}
                  maxLength={Math.min(10_000, config.tts.maximumCharacters + 200)}
                  placeholder="Type or paste your dialogue"
                  className={cn(
                    "mt-3 w-full resize-y rounded-2xl border border-border/70 bg-card px-4 py-3 text-[14px] leading-relaxed",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                />
                <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[12px] tabular-nums text-muted-foreground">
                  <span className={cn(chars > config.tts.maximumCharacters && "font-semibold text-rose-500")}>
                    {chars.toLocaleString("en-US")} / {config.tts.maximumCharacters.toLocaleString("en-US")} characters
                  </span>
                  {chars > 0 && videoMs !== null ? (
                    <span className={cn(speechMs > videoMs + AUDIO_FIT_TOLERANCE_MS && "font-semibold text-amber-600 dark:text-amber-400")}>
                      About {formatSeconds(speechMs / 1000)} of speech for a {formatSeconds(videoMs / 1000)} video (estimate)
                    </span>
                  ) : null}
                </div>
                {chars > 0 && videoMs !== null && speechMs > videoMs + AUDIO_FIT_TOLERANCE_MS ? (
                  <div className="mt-2 rounded-2xl border border-amber-500/35 bg-amber-500/[0.07] px-3.5 py-3">
                    <p className="text-[13px] font-bold">This may be longer than the video.</p>
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
                      Shorten the dialogue or keep more of the video. If the generated voice runs over, it is cut to the video&apos;s length only if you allow it below — otherwise the job stops before anything is charged to the model, and your balance comes back.
                    </p>
                    <Tick id={`${id}-trimfit-tts`} checked={v.trimAudioToFit} onChange={onTrimToFit} label="Cut the voice to the video's length if it runs over" />
                  </div>
                ) : null}
              </section>
            </>
          ) : null}

          {/* ── Studio Lip Sync ───────────────────────────────────────────── */}
          <section aria-labelledby={`${id}-lip`} className="rounded-[1.5rem] border border-border/70 bg-gradient-to-br from-card via-card to-primary/[0.06] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 id={`${id}-lip`} className="flex items-center gap-2 text-[15px] font-bold tracking-[-0.01em]">
                  Lip sync
                  <span className="rounded-full border border-amber-400/30 bg-amber-400/[0.10] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-700 dark:text-amber-300">Premium</span>
                </h3>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                  Synchronise the character&apos;s mouth with the new voice. Off, the new voice simply replaces the sound.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={lipOn}
                aria-label="Lip sync"
                disabled={!lipOffered}
                onClick={() => (lipOn ? onLipSyncOff() : onTier(config.lipSync[0]!.id))}
                className={cn(
                  "relative h-7 w-12 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-45",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  lipOn ? "bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500" : "bg-secondary",
                )}
              >
                <span aria-hidden className={cn("absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-[left]", lipOn ? "left-6" : "left-1")} />
              </button>
            </div>
            {!lipOffered && config.lipSyncEnabled ? (
              <p className="mt-2 text-[12px] text-muted-foreground">Lip sync works on videos up to {config.lipSyncMaximumDurationSeconds} seconds. Trim the video to use it.</p>
            ) : null}
            {lipOn ? (
              <div role="radiogroup" aria-label="Lip sync quality" className="mt-3 grid gap-2 sm:grid-cols-2">
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
                      <span aria-hidden className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition", active ? "border-foreground bg-foreground text-background" : "border-border")}>
                        {active ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-[14px] font-bold">
                          {tier.label}
                          {tier.premium ? (
                            <span className="rounded-full border border-amber-400/30 bg-amber-400/[0.10] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-700 dark:text-amber-300">Premium</span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block text-[12.5px] leading-snug text-muted-foreground">{tier.blurb}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}

/**
 * The voice picker (2026-09-20): two rows of filter chips — gender, then age —
 * and the voices that match. A filter that would leave nothing is still
 * offered (a member can see why the list is empty and change it); the
 * chosen voice stays chosen even when a filter hides it, and the chips that
 * would reveal it are marked. Words only — never a provider's name.
 */
function VoicePicker({ id, voices, value, onChange }: { id: string; voices: readonly CharacterReplacePublicVoice[]; value: string | null; onChange: (id: string) => void }) {
  const chosen = voices.find((x) => x.id === value) ?? null;
  const [gender, setGender] = useState<VoiceGender | "any">("any");
  const [age, setAge] = useState<VoiceAge | "any">("any");
  const genders = VOICE_GENDERS.filter((g) => voices.some((x) => x.gender === g));
  const ages = VOICE_AGES.filter((a) => voices.some((x) => x.age === a && (gender === "any" || x.gender === gender)));
  const shown = voices.filter((x) => (gender === "any" || x.gender === gender) && (age === "any" || x.age === age));
  const chip = (active: boolean) =>
    cn(
      "h-9 rounded-full border px-3.5 text-[12.5px] font-semibold transition",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      active ? "border-foreground bg-foreground text-background" : "border-border/70 bg-card text-foreground/80 hover:border-foreground/30",
    );
  return (
    <div>
      <div role="group" aria-label="Gender" className="flex flex-wrap gap-1.5">
        <button type="button" aria-pressed={gender === "any"} onClick={() => setGender("any")} className={chip(gender === "any")}>
          Any gender
        </button>
        {genders.map((g) => (
          <button key={g} type="button" aria-pressed={gender === g} onClick={() => setGender(g)} className={chip(gender === g)}>
            {VOICE_GENDER_LABEL[g]}
          </button>
        ))}
      </div>
      {ages.length > 1 ? (
        <div role="group" aria-label="Age" className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" aria-pressed={age === "any"} onClick={() => setAge("any")} className={chip(age === "any")}>
            Any age
          </button>
          {ages.map((a) => (
            <button key={a} type="button" aria-pressed={age === a} onClick={() => setAge(a)} className={chip(age === a)}>
              {VOICE_AGE_LABEL[a]}
            </button>
          ))}
        </div>
      ) : null}
      {shown.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-muted-foreground">No voice matches those filters — pick another gender or age.</p>
      ) : (
        <div role="radiogroup" aria-labelledby={id} className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {shown.map((x) => {
            const active = x.id === value;
            return (
              <button
                key={x.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChange(x.id)}
                className={cn(
                  "min-h-[64px] rounded-2xl border px-3 py-3 text-left transition",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  active ? "border-foreground bg-foreground text-background" : "border-border/70 bg-card hover:border-foreground/30",
                )}
              >
                <span className="block text-[14px] font-bold">{x.label}</span>
                <span className={cn("mt-0.5 block text-[11.5px] leading-snug", active ? "text-background/70" : "text-muted-foreground")}>
                  {VOICE_GENDER_LABEL[x.gender]} · {VOICE_AGE_LABEL[x.age]}
                  {x.blurb ? ` · ${x.blurb}` : ""}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {chosen && !shown.some((x) => x.id === chosen.id) ? (
        <p className="mt-2 text-[12px] text-muted-foreground">
          <strong>{chosen.label}</strong> is still selected — it is {VOICE_GENDER_LABEL[chosen.gender].toLowerCase()}, {VOICE_AGE_LABEL[chosen.age].toLowerCase()}.
        </p>
      ) : null}
    </div>
  );
}

function ChoiceCard({
  active,
  icon,
  title,
  body,
  onClick,
  disabled = false,
  note = null,
  badge = null,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  body: string;
  onClick: () => void;
  disabled?: boolean;
  note?: string | null;
  /** Part 9 §8: the one card wearing "Recommended". */
  badge?: string | null;
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
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", active ? "bg-foreground text-background" : "bg-secondary text-foreground/80")}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 text-[14.5px] font-bold">
          {title}
          {badge ? <span className="rounded-full bg-gradient-to-r from-blue-600 to-fuchsia-500 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.08em] text-white">{badge}</span> : null}
        </span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-muted-foreground">{body}</span>
        {note ? <span className="mt-1.5 inline-block rounded-full bg-secondary px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{note}</span> : null}
      </span>
    </button>
  );
}

function Tick({ id, checked, onChange, label, strong = false }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; strong?: boolean }) {
  return (
    <label htmlFor={id} className="mt-3 flex cursor-pointer items-start gap-3">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border bg-background text-background transition",
          "peer-checked:border-foreground peer-checked:bg-foreground",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
        )}
      >
        <Check className={cn("h-3.5 w-3.5 transition-opacity", checked ? "opacity-100" : "opacity-0")} strokeWidth={3} />
      </span>
      <span className={cn("text-[13px] leading-snug", strong ? "font-medium" : "text-muted-foreground")}>{label}</span>
    </label>
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
