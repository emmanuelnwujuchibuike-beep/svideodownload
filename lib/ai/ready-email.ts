import "server-only";

import type { AiFeature } from "@/lib/ai/jobs";
import { emailMember } from "@/lib/email/member-email";
import { getNotificationSettings } from "@/lib/social/notification-settings";

/**
 * "Your AI video is ready" by EMAIL (owner, 2026-10-10: "make users get email
 * notifications when their AI video generation completes").
 *
 * A video takes minutes, the member leaves, and a push needs a device that
 * subscribed. An email reaches them anywhere. It is sent from the same place
 * as the push (lib/ai/notify.ts, after the one-time claim), so a job is
 * emailed exactly once, however many safety nets race to announce it.
 *
 * Only for tools that make a VIDEO, which is what was asked, and only when the
 * member has not switched notifications off: the master switch, or the
 * "downloads" category this result belongs to (the same switches that govern
 * the push). Best-effort: it never throws and never touches the job.
 */
export const AI_VIDEO_FEATURES: ReadonlySet<AiFeature> = new Set<AiFeature>([
  "ai_character_replace",
  "ai_lip_sync",
  "ai_text_to_video",
  "ai_image_to_video",
  "ai_clean",
]);

const TOOL_NAME: Partial<Record<AiFeature, string>> = {
  ai_character_replace: "Character Replace",
  ai_lip_sync: "Lip Sync Pro",
  ai_text_to_video: "Text to Video",
  ai_image_to_video: "Image to Video",
  ai_clean: "AI Clean",
};

/** Pure: should this job be emailed, given the member's settings? Exported for tests. */
export function shouldEmailAiVideo(feature: AiFeature, settings: { masterEnabled: boolean; categoryPrefs: Record<string, { enabled?: boolean } | undefined> }): boolean {
  if (!AI_VIDEO_FEATURES.has(feature)) return false;
  if (!settings.masterEnabled) return false;
  return settings.categoryPrefs.downloads?.enabled !== false;
}

export async function emailAiVideoReady(opts: { userId: string; feature: AiFeature; resultPath: string; earnedLine?: string | null }): Promise<boolean> {
  try {
    const settings = await getNotificationSettings(opts.userId);
    if (!shouldEmailAiVideo(opts.feature, settings as never)) return false;
    const tool = TOOL_NAME[opts.feature] ?? "Frenz AI";
    await emailMember(opts.userId, {
      subject: "Your Frenz AI video is ready",
      heading: "Your video is ready",
      intro: `Your ${tool} video has finished and is waiting for you.`,
      body: opts.earnedLine ?? undefined,
      ctaLabel: "Watch your video",
      ctaPath: opts.resultPath,
    });
    return true;
  } catch (e) {
    console.error("[ai/ready-email] failed", { userId: opts.userId, error: String(e).slice(0, 160) });
    return false;
  }
}
