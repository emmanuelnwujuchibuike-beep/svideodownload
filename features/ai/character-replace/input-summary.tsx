"use client";

import { Check, Circle } from "lucide-react";

import type { CharacterReplacePublicConfig } from "@/lib/ai/character-replace/config";
import type { CharacterReplaceProject } from "@/lib/ai/character-replace/types";
import { inputReadiness } from "@/lib/ai/character-replace/validate";
import { formatSeconds, originalDurationSeconds, selectedDurationSeconds } from "@/lib/ai/character-replace/workspace";
import { cn } from "@/lib/utils";

/**
 * Part 2, §15 — the input summary.
 *
 *     Character       ✓ Ready
 *     Source video    ✓ Ready
 *     Duration        18.4 sec
 *     Selected        10.0 sec
 *     Source          1080p
 *     Output          720p
 *
 * Drawn from the draft and the readiness layer, so it can never say "Ready"
 * about a file that is gone. Rendered once a video is in (the photo step came
 * first, so both are usually in by then), and again on the settings step
 * where the output line means something. Colour is never the only signal —
 * every row has its word.
 */
export function CharacterReplaceInputSummary({
  project,
  config,
  className,
}: {
  project: CharacterReplaceProject;
  config: CharacterReplacePublicConfig | null;
  className?: string;
}) {
  const { ready, issues } = inputReadiness(project, config);
  const quality = config?.qualities.find((q) => q.id === project.settings.quality);
  const meta = project.video?.metadata ?? null;
  const original = originalDurationSeconds(project);
  const selected = selectedDurationSeconds(project);
  const trimIssue = issues.find((i) => i.startsWith("trim-") || i === "video-unmeasured") ?? null;

  return (
    <section aria-label="Input summary" className={cn("rounded-[1.25rem] border border-border/70 bg-card", className)}>
      <dl className="divide-y divide-border/60">
        <Row label="Character">
          <Status ok={!!project.character} okText="Ready" notText="Missing" />
        </Row>
        <Row label="Source video">
          <Status ok={!!project.video} okText="Ready" notText="Missing" />
        </Row>
        {project.video ? (
          <>
            <Row label="Duration">
              <span className="tabular-nums">{formatSeconds(original)}</span>
            </Row>
            <Row label="Selected">
              <span className={cn("tabular-nums", trimIssue && "text-rose-500")}>
                {formatSeconds(selected)}
                {trimIssue === "trim-too-long" ? " · too long" : trimIssue === "trim-too-short" ? " · too short" : trimIssue === "video-unmeasured" ? " · unmeasured" : ""}
              </span>
            </Row>
            <Row label="Source">
              <span className="tabular-nums">{meta?.resolutionLabel ?? "—"}</span>
            </Row>
            <Row label="Output">
              <span className="tabular-nums">{quality?.label ?? project.settings.quality}</span>
            </Row>
          </>
        ) : null}
      </dl>
      <p className={cn("border-t border-border/60 px-4 py-2.5 text-[12px] font-semibold", ready ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")} aria-live="polite">
        {ready ? "Ready to continue." : issues.includes("photo-missing") ? "Add your photo to continue." : issues.includes("video-missing") ? "Add your video to continue." : trimIssue === "trim-too-long" ? "Trim the video to continue." : trimIssue === "video-unmeasured" ? "This video's length couldn't be read." : "Check the selected range to continue."}
      </p>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="text-right text-[13px] font-semibold">{children}</dd>
    </div>
  );
}

function Status({ ok, okText, notText }: { ok: boolean; okText: string; notText: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", ok ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
      {ok ? <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden /> : <Circle className="h-3 w-3" aria-hidden />}
      {ok ? okText : notText}
    </span>
  );
}
