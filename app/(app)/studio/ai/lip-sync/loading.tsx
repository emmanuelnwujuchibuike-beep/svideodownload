import { AiToolSkeleton } from "@/features/ai/ai-skeletons";

/** Part 7 §44 — the tool's own shape (see the twin in app/(marketing)/ai/lip-sync). */
export default function Loading() {
  return <AiToolSkeleton label="Loading Lip Sync" layout="reference" />;
}
