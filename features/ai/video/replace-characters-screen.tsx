"use client";

import { ArrowRight, Camera, ChevronLeft, Grid2x2, ImageIcon, Loader2, Pause, Play, Plus, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { maxImagesPerTarget, PERSON_REPLACE } from "@/lib/ai/kling/features/person-replace";
import { describePeople, PERSON_DESCRIPTION_MAX_CHARS, sanitizePersonDescription, type DetectedPerson } from "@/lib/ai/kling/features/person-replace-prompt";
import { formatCredits } from "@/lib/ai/credits/units";
import { ReferenceUploadError, uploadReference } from "@/lib/ai/video/reference-upload";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  REPLACE CHARACTERS — who in the video should change, and into whom
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * design/ReplaceCharacters.dc.html (owner, 2026-10-22: "build the multi character replace screen from the
 * file in design"). Opened from Text to Video's "Edit this video": the reference video's people are found
 * by the worker (POST /api/ai/video/people), drawn as numbered boxes on the frame they were found on, and
 * listed below. The member taps a person, gives them a photo (Photos, Camera, or one of the Text to Video
 * reference images), confirms permission, and saves. Text to Video then generates a Character Replace job
 * (feature `full_character`) instead of a plain edit — this screen creates nothing and charges nothing.
 *
 * ── 🔴 THE LIMITS ARE THE SERVER'S ───────────────────────────────────────────
 *
 * Up to PERSON_REPLACE.maxTargets people, maxImagesPerTarget() photos each, and a short description
 * required for a person standing too close to another to be told apart by position
 * (lib/ai/kling/features/person-replace.ts — the same module the quote and the job validate with). The
 * price in the bar is the server's quote for exactly these choices; nothing here does arithmetic on money.
 *
 * ── Honest about targeting ───────────────────────────────────────────────────
 *
 * Kling has no field that selects a person: the tap becomes words in the instruction (where they stand,
 * plus the member's description). So the copy says "tap a person", never that the engine is given a box.
 */

export interface ReplacePhoto {
  url: string;
  path: string;
}

export interface ReplaceTarget {
  personId: string;
  description: string;
  photos: ReplacePhoto[];
}

/** What a saved screen hands back to Text to Video. */
export interface ReplaceDraft {
  /** The reference video this was found on — a different video invalidates the draft. */
  videoPath: string;
  /** The worker's signed inspection: the facts and the people. The quote and the job trust this, not the browser. */
  inspection: string;
  people: DetectedPerson[];
  frame: { url: string | null; positionMs: number };
  facts: { durationMs: number; width: number; height: number; hasAudio: boolean };
  countsVary: boolean;
  targets: ReplaceTarget[];
}

interface PeopleAnswer {
  token: string;
  people: DetectedPerson[];
  frame: { url: string | null; positionMs: number };
  facts: { durationMs: number; width: number; height: number; hasAudio: boolean };
  countsVary: boolean;
}

const PHOTO_TYPES = "image/jpeg,image/png";
const QUOTE_DEBOUNCE_MS = 400;

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** The person's head and shoulders, cropped from the frame they were found on — the row's "who is this". */
function faceCrop(frameUrl: string | null, person: DetectedPerson, facts: { width: number; height: number }, size: number): CSSProperties {
  if (!frameUrl || !(facts.width > 0 && facts.height > 0)) return {};
  const W = facts.width;
  const H = facts.height;
  const boxW = person.box.w * W;
  const boxH = person.box.h * H;
  // a square around the top of the box: the face sits in the upper part of a standing person
  const side = Math.max(16, Math.min(boxW, boxH * 0.45));
  const cx = (person.box.x + person.box.w / 2) * W;
  const top = person.box.y * H;
  const scale = size / side;
  return {
    backgroundImage: `url("${frameUrl}")`,
    backgroundSize: `${W * scale}px ${H * scale}px`,
    backgroundPosition: `${-(cx - side / 2) * scale}px ${-top * scale}px`,
    backgroundRepeat: "no-repeat",
  };
}

export function ReplaceCharactersScreen({
  videoUrl,
  videoPath,
  initial,
  referencePhotos,
  resolution,
  audio,
  onSave,
  onClose,
}: {
  videoUrl: string;
  videoPath: string;
  /** The last saved draft for this video, if any — reopening continues it. */
  initial: ReplaceDraft | null;
  /** Text to Video's own reference images, offered under "From references". */
  referencePhotos: ReplacePhoto[];
  resolution: "720p" | "1080p" | "4k";
  /** An edit keeps the video's sound or has none (Kling's base-video rule). */
  audio: "original" | "off";
  /** `null` clears the replacements. */
  onSave: (draft: ReplaceDraft | null) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const [answer, setAnswer] = useState<PeopleAnswer | null>(() =>
    initial && initial.videoPath === videoPath ? { token: initial.inspection, people: initial.people, frame: initial.frame, facts: initial.facts, countsVary: initial.countsVary } : null,
  );
  const [finding, setFinding] = useState(false);
  const [findProblem, setFindProblem] = useState<string | null>(null);
  const [targets, setTargets] = useState<ReplaceTarget[]>(() => (initial && initial.videoPath === videoPath ? initial.targets : []));
  const [activeId, setActiveId] = useState<string | null>(() => (initial && initial.videoPath === videoPath ? (initial.targets[0]?.personId ?? null) : null));
  // 🔴 never pre-ticked: the member states it, every time the screen is opened
  const [consent, setConsent] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [showReferences, setShowReferences] = useState(false);

  const photosInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  /* ── who is in the video — asked once per opening, the worker's heaviest job ── */
  const find = useCallback(async () => {
    setFinding(true);
    setFindProblem(null);
    try {
      const res = await fetch("/api/ai/video/people", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: videoPath }) });
      const json = (await res.json().catch(() => null)) as (PeopleAnswer & { error?: string }) | null;
      if (!res.ok || !json?.token) {
        setFindProblem(json?.error ?? "We couldn't check this video just now. Try again in a moment.");
        return;
      }
      setAnswer({ token: json.token, people: json.people ?? [], frame: json.frame, facts: json.facts, countsVary: !!json.countsVary });
    } catch {
      setFindProblem("We couldn't reach the service. Check your connection and try again.");
    } finally {
      setFinding(false);
    }
  }, [videoPath]);

  useEffect(() => {
    if (!answer) void find();
    // once, on opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── the screen is a page of its own: no scrolling the page under it, Escape is Back ── */
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // focus enters the screen, so a keyboard or screen reader starts on it rather than on the page beneath
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const people = useMemo(() => answer?.people ?? [], [answer]);
  const descriptors = useMemo(() => describePeople(people), [people]);
  // ids are p1…pN left to right, so the badge number is the order the member reads the frame in
  const numberOf = useCallback((id: string) => descriptors.get(id)?.order ?? 0, [descriptors]);
  const targetOf = (id: string) => targets.find((t) => t.personId === id) ?? null;
  const active = activeId ? targetOf(activeId) : null;
  const perTarget = maxImagesPerTarget(Math.max(1, targets.length));

  const chooseReplace = (id: string) => {
    setProblem(null);
    if (!targetOf(id)) {
      if (targets.length >= PERSON_REPLACE.maxTargets) {
        setProblem(`You can replace up to ${PERSON_REPLACE.maxTargets} people in one video. Keep someone as they are first.`);
        return;
      }
      setTargets((ts) => [...ts, { personId: id, description: "", photos: [] }]);
    }
    setActiveId(id);
    setShowReferences(false);
  };

  const keepOriginal = (id: string) => {
    setTargets((ts) => ts.filter((t) => t.personId !== id));
    if (activeId === id) setActiveId(null);
    setProblem(null);
  };

  const updateTarget = (id: string, change: (t: ReplaceTarget) => ReplaceTarget) => setTargets((ts) => ts.map((t) => (t.personId === id ? change(t) : t)));

  const addPhotos = (id: string, photos: ReplacePhoto[]) => {
    const t = targetOf(id);
    if (!t) return;
    const taken = new Set(targets.flatMap((x) => x.photos.map((p) => p.path)));
    const fresh = photos.filter((p) => !taken.has(p.path));
    if (fresh.length < photos.length) setProblem("That photo is already used. Each person needs their own photos.");
    const room = perTarget - t.photos.length;
    if (room <= 0) {
      setProblem(`Person ${numberOf(id)} can have up to ${perTarget} photo${perTarget === 1 ? "" : "s"}.`);
      return;
    }
    updateTarget(id, (x) => ({ ...x, photos: [...x.photos, ...fresh.slice(0, room)] }));
  };

  const uploadPhotos = async (files: FileList | null, input: HTMLInputElement | null) => {
    if (!files?.length || !activeId) return;
    const id = activeId;
    setProblem(null);
    setUploading(true);
    const added: ReplacePhoto[] = [];
    try {
      for (const file of Array.from(files).slice(0, perTarget)) {
        const up = await uploadReference(file, "image");
        added.push({ url: up.url, path: up.path });
      }
    } catch (e) {
      setProblem(e instanceof ReferenceUploadError ? e.message : "That photo couldn't be added.");
    } finally {
      // what uploaded is kept, even when a later one failed
      if (added.length) addPhotos(id, added);
      setUploading(false);
      if (input) input.value = "";
    }
  };

  /* ── what the server would be asked, and the price it gives back ── */
  const wire = useMemo(() => {
    if (!answer || targets.length === 0 || targets.some((t) => t.photos.length === 0)) return null;
    return {
      inspection: answer.token,
      targets: targets.map((t) => ({ personId: t.personId, ...(sanitizePersonDescription(t.description) ? { description: t.description.trim() } : {}), referencePaths: t.photos.map((p) => p.path) })),
      // a QUOTE prices the choices; the permission box gates saving, and the job re-checks it
      consent: true as const,
      options: { resolution, audio },
    };
  }, [answer, targets, resolution, audio]);

  const [credits, setCredits] = useState<number | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteProblem, setQuoteProblem] = useState<string | null>(null);
  // the words never change the price (use-video-generation.ts withoutPrompt) — re-quote on the priced parts only
  const pricedKey = useMemo(() => (wire ? JSON.stringify({ ...wire, targets: wire.targets.map(({ description: _d, ...t }) => t), hasWords: wire.targets.map((t) => !!t.description) }) : ""), [wire]);
  const wireRef = useRef(wire);
  wireRef.current = wire;
  useEffect(() => {
    const body = wireRef.current;
    if (!body) {
      setCredits(null);
      setQuoteProblem(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setQuoting(true);
      try {
        const res = await fetch("/api/ai/video/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feature: "full_character", input: body }), signal: controller.signal });
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || json?.ok === false) {
          setCredits(null);
          setQuoteProblem(json?.capability?.reason ?? json?.reason ?? json?.error ?? "This can't be priced right now.");
          return;
        }
        setQuoteProblem(null);
        setCredits(typeof json?.quote?.credits === "number" ? json.quote.credits : null);
      } catch {
        if (!cancelled && !controller.signal.aborted) setQuoteProblem("This can't be priced right now.");
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [pricedKey]);

  /* ── saving ── */
  const save = () => {
    setProblem(null);
    if (!answer) return onClose();
    if (targets.length === 0) {
      onSave(null);
      return;
    }
    const missing = targets.find((t) => t.photos.length === 0);
    if (missing) {
      setActiveId(missing.personId);
      setProblem(`Person ${numberOf(missing.personId)} needs a photo of who should take their place.`);
      return;
    }
    const unclear = targets.find((t) => descriptors.get(t.personId)?.ambiguous && !sanitizePersonDescription(t.description));
    if (unclear) {
      setActiveId(unclear.personId);
      setProblem(`Person ${numberOf(unclear.personId)} is standing very close to someone else. Describe them so the right person is replaced.`);
      return;
    }
    if (!consent) {
      setProblem("Confirm you have permission from everyone in the video and in the photos.");
      return;
    }
    onSave({ videoPath, inspection: answer.token, people: answer.people, frame: answer.frame, facts: answer.facts, countsVary: answer.countsVary, targets });
  };

  const unusedReferences = referencePhotos.filter((r) => !targets.some((t) => t.photos.some((p) => p.path === r.path)));
  const replacedCount = targets.filter((t) => t.photos.length > 0).length;

  return (
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className="frenz-ui fixed outline-none inset-0 z-[70] overflow-y-auto overscroll-contain bg-white text-frenz-ink">
      <div className="mx-auto max-w-xl pb-[calc(8rem+env(safe-area-inset-bottom))] pt-[var(--frenz-safe-top,0px)]">
        <header className="grid grid-cols-[1fr_auto_1fr] items-center pl-2 pr-3 pt-3">
          <button type="button" onClick={onClose} className="inline-flex min-h-[44px] items-center gap-0.5 justify-self-start px-2 text-[16px] font-semibold text-frenz-blue">
            <ChevronLeft className="h-5 w-5" aria-hidden />
            Back
          </button>
          <h1 id={titleId} className="m-0 font-heading text-[17px] font-bold">
            Replace characters
          </h1>
          <button type="button" onClick={save} className="min-h-[44px] justify-self-end px-2 text-[16px] font-bold text-frenz-blue">
            Done
          </button>
        </header>

        <VideoPreview videoUrl={videoUrl} answer={answer} finding={finding} targets={targets} numberOf={numberOf} onPick={chooseReplace} />

        {findProblem ? (
          <div className="mx-4 mt-4 rounded-[18px] bg-rose-50 p-4" role="alert">
            <p className="m-0 text-[14px] font-semibold text-rose-900">{findProblem}</p>
            <button type="button" onClick={() => void find()} className="mt-3 min-h-[40px] rounded-full bg-white px-4 text-[13px] font-bold text-rose-900 ring-1 ring-inset ring-rose-200">
              Try again
            </button>
          </div>
        ) : null}

        {answer ? (
          <>
            <div className="flex items-baseline justify-between px-5 pb-1 pt-5">
              <h2 className="m-0 font-heading text-[19px] font-bold tracking-[-0.4px]">Who should change?</h2>
              <span className="text-[13px] font-bold text-frenz-violet">
                {targets.length} of {people.length}
              </span>
            </div>
            <p className="m-0 px-5 pb-3 text-[13px] leading-snug text-frenz-muted">
              {people.length === 0
                ? "No one could be found in this video. Try a clip where everyone is clearly visible."
                : `Tap a person, then pick a photo of who should take their place. Anyone you skip stays as they are.${people.length > 1 ? ` You can replace up to ${PERSON_REPLACE.maxTargets}.` : ""}`}
            </p>
            {answer.countsVary ? (
              <p className="m-0 px-5 pb-3 text-[12px] leading-snug text-frenz-muted">People come and go in this clip — who is where is read from the moment shown above.</p>
            ) : null}

            {people.length > 0 ? (
              <ul className="m-0 mx-4 list-none overflow-hidden rounded-[22px] border border-frenz-line p-0">
                {[...people]
                  .sort((a, b) => numberOf(a.id) - numberOf(b.id))
                  .map((p, i) => {
                    const t = targetOf(p.id);
                    const n = numberOf(p.id);
                    const replaced = !!t && t.photos.length > 0;
                    return (
                      <li key={p.id} className={cn("flex items-center gap-2.5 p-3", i > 0 && "border-t border-frenz-line", activeId === p.id && "bg-frenz-violet/[0.04]")}>
                        <span className="relative h-[52px] w-[52px] shrink-0 rounded-full bg-frenz-ink/80" style={faceCrop(answer.frame.url, p, answer.facts, 52)}>
                          <Badge n={n} on={!!t} className="-left-1 -top-1" />
                        </span>
                        <ArrowRight className={cn("h-[18px] w-[18px] shrink-0", t ? "text-frenz-violet" : "text-frenz-muted/50")} aria-hidden />
                        {t ? (
                          <>
                            {replaced ? (
                              <span className="flex h-[52px] w-[52px] shrink-0 rounded-full bg-frenz-gradient-x p-[2.5px]">
                                {/* eslint-disable-next-line @next/next/no-img-element -- a signed storage URL, shown once */}
                                <img src={t.photos[0]!.url} alt="" className="h-full w-full rounded-full border-2 border-white object-cover" />
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => chooseReplace(p.id)}
                                aria-label={`Choose a photo for person ${n}`}
                                className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-dashed border-frenz-violet/40 bg-frenz-violet/[0.03] text-frenz-violet"
                              >
                                <Plus className="h-[18px] w-[18px]" aria-hidden />
                              </button>
                            )}
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="text-[15px] font-bold">Person {n}</span>
                              <span className={cn("truncate text-[12px] font-bold", replaced ? "text-frenz-violet" : "text-rose-600")}>
                                {replaced ? `Replaced · ${t.photos.length === 1 ? "1 photo" : `${t.photos.length} photos`}` : "Needs a photo"}
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() => chooseReplace(p.id)}
                              aria-label={`Change replacement for person ${n}`}
                              className="min-h-[34px] rounded-full bg-frenz-ink/[0.05] px-3 text-[13px] font-bold"
                            >
                              Change
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => chooseReplace(p.id)}
                              aria-label={`Choose a photo for person ${n}`}
                              className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-dashed border-frenz-violet/40 bg-frenz-violet/[0.03] text-frenz-violet"
                            >
                              <Plus className="h-[18px] w-[18px]" aria-hidden />
                            </button>
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="text-[15px] font-bold">Person {n}</span>
                              <span className="text-[12px] text-frenz-muted">Keeps original</span>
                            </span>
                            <button type="button" onClick={() => chooseReplace(p.id)} className="min-h-[34px] rounded-full bg-frenz-violet/10 px-3 text-[13px] font-bold text-frenz-violet">
                              Replace
                            </button>
                          </>
                        )}
                      </li>
                    );
                  })}
              </ul>
            ) : null}

            {active ? (
              <section aria-label={`Replacement for person ${numberOf(active.personId)}`}>
                <div className="flex items-baseline justify-between px-5 pb-2 pt-[22px]">
                  <h2 className="m-0 font-heading text-[17px] font-bold">Replacement for Person {numberOf(active.personId)}</h2>
                  <button type="button" onClick={() => keepOriginal(active.personId)} className="min-h-[36px] text-[13px] font-bold text-frenz-muted">
                    Keep original
                  </button>
                </div>

                {active.photos.length ? (
                  <ul className="m-0 flex list-none flex-wrap gap-2 px-4 pb-3 pt-0">
                    {active.photos.map((ph, k) => (
                      <li key={ph.path} className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element -- a signed storage URL, shown once */}
                        <img src={ph.url} alt={`Photo ${k + 1} for person ${numberOf(active.personId)}`} className="h-16 w-16 rounded-[14px] object-cover ring-1 ring-inset ring-frenz-line" />
                        <button
                          type="button"
                          onClick={() => updateTarget(active.personId, (t) => ({ ...t, photos: t.photos.filter((x) => x.path !== ph.path) }))}
                          aria-label={`Remove photo ${k + 1}`}
                          className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-frenz-ink text-white ring-2 ring-white"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="flex gap-2.5 px-4">
                  <SourceButton icon={<ImageIcon className="h-5 w-5 text-frenz-violet" aria-hidden />} label="Photos" disabled={uploading || active.photos.length >= perTarget} onClick={() => photosInput.current?.click()} />
                  <SourceButton icon={<Camera className="h-5 w-5 text-frenz-violet" aria-hidden />} label="Camera" disabled={uploading || active.photos.length >= perTarget} onClick={() => cameraInput.current?.click()} />
                  <SourceButton
                    icon={<Grid2x2 className="h-5 w-5 text-frenz-violet" aria-hidden />}
                    label="From references"
                    disabled={uploading || unusedReferences.length === 0 || active.photos.length >= perTarget}
                    onClick={() => setShowReferences((v) => !v)}
                    pressed={showReferences}
                  />
                </div>
                <input ref={photosInput} type="file" accept={PHOTO_TYPES} multiple hidden onChange={(e) => void uploadPhotos(e.target.files, e.target)} />
                <input ref={cameraInput} type="file" accept={PHOTO_TYPES} capture="user" hidden onChange={(e) => void uploadPhotos(e.target.files, e.target)} />

                {uploading ? (
                  <p className="m-0 flex items-center gap-2 px-5 pt-3 text-[12px] font-semibold text-frenz-muted" role="status">
                    <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
                    Adding photo…
                  </p>
                ) : null}

                {showReferences && unusedReferences.length ? (
                  <ul className="m-0 flex list-none flex-wrap gap-2 px-4 pt-3" aria-label="Your reference images">
                    {unusedReferences.map((r, k) => (
                      <li key={r.path}>
                        <button
                          type="button"
                          onClick={() => {
                            addPhotos(active.personId, [r]);
                            setShowReferences(false);
                          }}
                          aria-label={`Use reference image ${k + 1}`}
                          className="block rounded-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-frenz-violet"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- a signed storage URL, shown once */}
                          <img src={r.url} alt="" className="h-16 w-16 rounded-[14px] object-cover ring-1 ring-inset ring-frenz-line" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <p className="m-0 px-5 pt-2.5 text-[12px] leading-snug text-frenz-muted">
                  Best results: one clear, front-facing photo of a single face.{perTarget > 1 ? ` Up to ${perTarget} photos of the same person.` : ""}
                </p>

                <DescribeField
                  n={numberOf(active.personId)}
                  value={active.description}
                  required={!!descriptors.get(active.personId)?.ambiguous}
                  onChange={(v) => updateTarget(active.personId, (t) => ({ ...t, description: v }))}
                />
              </section>
            ) : null}

            <label className="mx-4 mt-5 flex items-start gap-3 rounded-[18px] bg-frenz-ink/[0.03] p-3.5">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="m-0 h-[22px] w-[22px] shrink-0 accent-frenz-violet" />
              <span className="text-[13px] leading-[1.45] text-frenz-ink/80">
                <strong className="text-frenz-ink">I have permission</strong> from every person whose face I&apos;m adding, and from the people in the reference video.{" "}
                <a href="/terms#frenz-ai-tools" target="_blank" rel="noopener" className="font-bold text-frenz-blue no-underline">
                  Our rules
                </a>
              </span>
            </label>
          </>
        ) : null}

        {problem ? (
          <p className="m-0 mx-4 mt-4 rounded-[14px] bg-rose-50 px-3.5 py-2.5 text-[13px] font-semibold text-rose-900" role="alert">
            {problem}
          </p>
        ) : null}
      </div>

      {/* the design's glass bar: how many, what it costs, save */}
      <div className="frenz-nav-glass fixed inset-x-0 bottom-0 z-[71] border-t border-frenz-line px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3.5">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <span className="flex min-w-[96px] flex-col">
            <span className="text-[12px] font-bold text-frenz-muted">
              {replacedCount === 1 ? "1 replacement" : `${replacedCount} replacements`}
            </span>
            {quoteProblem ? (
              <span className="max-w-[11rem] text-[12px] font-semibold leading-snug text-rose-600">{quoteProblem}</span>
            ) : (
              <span className={cn("flex items-center gap-1.5 font-heading text-[16px] font-extrabold tabular-nums", quoting && "opacity-55")}>
                {/* the server's number, never a guess — "—" until it has priced these choices */}
                {credits === null ? "—" : credits === 0 ? "Free" : `+${formatCredits(credits)}`}
                {quoting ? <Loader2 className="h-3 w-3 animate-spin text-frenz-violet motion-reduce:animate-none" aria-hidden /> : null}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={save}
            disabled={!answer || uploading}
            className="inline-flex min-h-[3.5rem] flex-1 items-center justify-center rounded-full bg-frenz-gradient-x px-5 font-heading text-[17px] font-bold text-white shadow-frenz-card transition active:scale-[0.98] disabled:opacity-45 motion-reduce:active:scale-100"
          >
            {targets.length === 0 && initial?.targets.length ? "Remove replacements" : "Save replacements"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Badge({ n, on, className }: { n: number; on: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-white font-heading text-[11px] font-extrabold",
        on ? "bg-frenz-violet text-white" : "bg-white text-frenz-ink",
        className,
      )}
    >
      {n}
    </span>
  );
}

function SourceButton({ icon, label, onClick, disabled, pressed }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean; pressed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      className={cn(
        "flex h-[88px] flex-1 flex-col items-center justify-center gap-1.5 rounded-[18px] border border-frenz-line bg-white text-[13px] font-bold text-frenz-ink transition active:scale-[0.98] disabled:opacity-45 motion-reduce:active:scale-100",
        pressed && "border-frenz-violet/50 bg-frenz-violet/[0.04]",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function DescribeField({ n, value, required, onChange }: { n: number; value: string; required: boolean; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="px-4 pt-4">
      <label htmlFor={id} className="block px-1 text-[13px] font-semibold">
        Describe Person {n} {required ? <span className="text-rose-600">(needed)</span> : <span className="font-normal text-frenz-muted">(optional)</span>}
      </label>
      <p className="m-0 mt-0.5 px-1 text-[12px] leading-snug text-frenz-muted">
        {required ? "They're standing very close to someone else, so say who you mean — for example “the man in the blue shirt”." : "A few words help the right person be replaced — for example “the woman in the red dress”."}
      </p>
      <input
        id={id}
        type="text"
        value={value}
        maxLength={PERSON_DESCRIPTION_MAX_CHARS}
        onChange={(e) => onChange(e.target.value)}
        placeholder="the man in the blue shirt"
        className="mt-2 h-11 w-full rounded-[14px] border border-frenz-line bg-white px-3.5 text-[15px] text-frenz-ink outline-none focus:border-frenz-violet"
      />
    </div>
  );
}

/**
 * The frame the people were found on, with a numbered box on each — tapping one chooses them. Play swaps
 * in the video itself (boxes hidden: they describe one moment, not the whole clip); pause or the end
 * returns to the frame.
 */
function VideoPreview({
  videoUrl,
  answer,
  finding,
  targets,
  numberOf,
  onPick,
}: {
  videoUrl: string;
  answer: PeopleAnswer | null;
  finding: boolean;
  targets: ReplaceTarget[];
  numberOf: (id: string) => number;
  onPick: (id: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const duration = answer?.facts.durationMs ?? 0;
  const W = answer?.facts.width ?? 16;
  const H = answer?.facts.height ?? 9;
  // the picture keeps its own shape, at most 250 px tall
  const sized: CSSProperties = { aspectRatio: `${W} / ${H}`, width: `min(100%, ${(250 * W) / H}px)` };

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => setPlaying(false));
    else v.pause();
  };

  return (
    <section aria-label="Reference video preview" className="relative mx-4 mt-3 flex min-h-[200px] items-center justify-center overflow-hidden rounded-[24px] bg-frenz-ink">
      <div className="relative" style={sized}>
        {answer?.frame.url ? (
          // eslint-disable-next-line @next/next/no-img-element -- the inspection frame, a signed storage URL
          <img src={answer.frame.url} alt="" className={cn("absolute inset-0 h-full w-full object-cover", playing && "invisible")} />
        ) : null}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- the member's own clip, previewed */}
        <video
          ref={video}
          src={videoUrl}
          playsInline
          preload="none"
          className={cn("absolute inset-0 h-full w-full object-cover", !playing && "invisible")}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime * 1000)}
        />
        {answer && !playing
          ? answer.people.map((p) => {
              const on = targets.some((t) => t.personId === p.id);
              const n = numberOf(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onPick(p.id)}
                  aria-label={`Person ${n}${on ? ", chosen" : ""}`}
                  className={cn("absolute rounded-[14px] border-[2.5px] ring-1 ring-black/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white", on ? "border-white" : "border-white/55")}
                  style={{ left: `${p.box.x * 100}%`, top: `${p.box.y * 100}%`, width: `${p.box.w * 100}%`, height: `${p.box.h * 100}%` }}
                >
                  <Badge n={n} on={on} className="-left-2.5 -top-3" />
                </button>
              );
            })
          : null}
      </div>

      {finding ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/35 text-white" role="status">
          <Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none" aria-hidden />
          <span className="text-[13px] font-semibold">Finding the people in your video…</span>
        </div>
      ) : null}

      {answer ? (
        <span className="absolute right-3 top-3 rounded-full border border-white/30 bg-white/15 px-2.5 py-1 text-[12px] font-bold text-white backdrop-blur-[8px]">
          {answer.people.length === 1 ? "1 person found" : `${answer.people.length} people found`}
        </span>
      ) : null}

      <div className="absolute inset-x-3 bottom-3 flex h-11 items-center gap-2.5 rounded-full border border-white/25 bg-black/35 px-1.5 backdrop-blur-[8px]">
        <button type="button" onClick={toggle} aria-label={playing ? "Pause preview" : "Play preview"} className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-white text-frenz-ink">
          {playing ? <Pause className="h-3 w-3" fill="currentColor" aria-hidden /> : <Play className="h-3 w-3" fill="currentColor" aria-hidden />}
        </button>
        <span className="h-1 flex-1 rounded-full bg-white/30">
          <span className="block h-full rounded-full bg-white" style={{ width: `${duration ? Math.min(100, (time / duration) * 100) : 0}%` }} />
        </span>
        <span className="pr-2 text-[12px] font-bold tabular-nums text-white">
          {clock(time)} / {clock(duration)}
        </span>
      </div>
    </section>
  );
}
