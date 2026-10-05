import { AiToolSkeleton } from "@/features/ai/ai-skeletons";

/** Part 7 §44 — the tool's own shape (see the twin in app/(marketing)/ai/text-to-video). */
export default function Loading() {
  return <AiToolSkeleton label="Loading Text to Video" />;
}
