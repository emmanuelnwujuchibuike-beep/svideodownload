"use client";

import { AiStepRail } from "@/features/ai/design/ai-step-rail";
import { stepIndex, WORKSPACE_STEPS, type WorkspaceStep } from "@/lib/ai/character-replace/workspace";

/**
 * The five steps, as a rail across the top of the workspace. The rail itself
 * is the shared `AiStepRail` (features/ai/design) — this only maps the
 * workspace's steps onto it.
 */
export function CharacterReplaceStepper({
  current,
  furthest,
  onGo,
  className,
}: {
  current: WorkspaceStep;
  /** The furthest step the member may open. */
  furthest: WorkspaceStep;
  onGo: (step: WorkspaceStep) => void;
  className?: string;
}) {
  return (
    <AiStepRail
      steps={WORKSPACE_STEPS}
      currentIndex={stepIndex(current)}
      furthestIndex={stepIndex(furthest)}
      onGo={onGo}
      className={className}
    />
  );
}
