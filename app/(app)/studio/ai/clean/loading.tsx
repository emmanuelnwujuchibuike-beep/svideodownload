import { AICleanSkeleton } from "@/features/ai/ai-skeletons";

/**
 * AI Clean's Suspense fallback: the header block and the stage, in position.
 * The drop zone is the largest thing on the finished page and the largest thing
 * here, so the arrival is a fill rather than a jump.
 */
export default function Loading() {
  return <AICleanSkeleton />;
}
