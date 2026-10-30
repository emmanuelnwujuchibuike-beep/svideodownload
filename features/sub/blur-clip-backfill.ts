"use client";

import { makeBlurClip } from "@/lib/media/make-blur-clip";
import { presignUpload, uploadWithPlan } from "@/lib/storage/client-upload";

/*
  0306 — an older locked video gets its blurred clip from its creator's own browser (owner, 2026-10-29: every locked
  video plays blurred to non-subscribers, no cover needed). Posts made before every video got a clip at publish have
  none, and only the creator may read the file. So their visit to their own Exclusive tab makes up to two, once per
  session, when the page is idle: the first seconds are streamed from a five-minute link, drawn 24 px wide and blurred
  (lib/media/make-blur-clip.ts), and only that clip is uploaded. Best effort — any failure waits for the next visit.
*/
const RAN = "frenz-blur-clips-ran";
let running = false;

export function backfillBlurClips(): void {
  if (running || typeof window === "undefined") return;
  try {
    if (sessionStorage.getItem(RAN)) return;
    sessionStorage.setItem(RAN, "1");
  } catch {
    /* no session storage: the module flag still keeps it to one run */
  }
  running = true;
  const start = () => void run().finally(() => (running = false));
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(start, { timeout: 4000 });
  else window.setTimeout(start, 2500);
}

async function run(): Promise<void> {
  const r = await fetch("/api/sub/posts/blur-clips", { credentials: "same-origin" }).catch(() => null);
  const j = (await r?.json().catch(() => null)) as { todo?: { postId: string; idx: number; url: string; width?: number }[] } | null;
  for (const t of j?.todo ?? []) {
    // at the size the post's blur level stores (0307 — 24 px unless the creator chose Light)
    const clip = await makeBlurClip(t.url, t.width).catch(() => null);
    if (!clip) continue;
    const url = await uploadWithPlan(await presignUpload("video", clip.ext), clip.blob, clip.type).catch(() => null);
    if (!url) continue;
    await fetch("/api/sub/posts/blur-clips", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postId: t.postId, idx: t.idx, url }) }).catch(() => null);
  }
}
