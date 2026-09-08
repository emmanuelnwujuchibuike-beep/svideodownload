"use client";

import { AICleanEmptyState } from "@/features/ai/ai-clean-empty-state";

/**
 * A client wrapper so the screenshot harness can mount the input page.
 *
 * 🔴 IT EXISTS BECAUSE OF A REAL BOUNDARY ERROR, NOT FOR TIDINESS.
 *
 * The probe page is a SERVER component, and the first attempt passed
 * `onFile={() => {}}` straight into it:
 *
 *     Error: Event handlers cannot be passed to Client Component props.
 *
 * Functions cannot cross the server-to-client boundary. That is the same class
 * of mistake that once took the whole Frenz AI hub down with "something went
 * wrong" — and the harness caught this one before it reached anybody, which is
 * the entire argument for having a harness that renders the REAL component
 * rather than a stub.
 *
 * The handlers are deliberately no-ops: this mounts the page to be photographed,
 * not to be used.
 */
export function AICleanInputPreview() {
  return <AICleanEmptyState onFile={() => {}} onPasteLink={() => {}} entitlement={null} />;
}
