import { alertEmailHtml, sendAdminAlertOnce } from "@/lib/notify";
import { emit } from "@/lib/platform/event-bus";
import { detectPlatform } from "@/lib/platforms";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MediaKind } from "@/types";

/**
 * Best-effort, fire-and-forget download analytics. Inserts an anonymous row into
 * `downloads` (via the service-role client, bypassing RLS) which the
 * `bump_platform_stats` trigger rolls up into `platform_stats` for the admin
 * dashboard. Never blocks or fails a download.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;

// Email the admin every N downloads (configurable). Default: every 100.
const MILESTONE_EVERY = Math.max(1, Number(process.env.ALERT_DOWNLOAD_EVERY) || 100);

export function recordDownloadEvent(
  url: string,
  kind: MediaKind,
  title?: string,
): void {
  const platform = detectPlatform(url);
  // Publish the domain event (in-process, fire-and-forget) so any consumer —
  // observability metering today, more later — reacts without this code knowing.
  emit("download.completed", { platform: platform.id, userId: null });

  if (!hasSupabase) return;

  void (async () => {
    try {
      const supabase = createAdminClient();
      await supabase.from("downloads").insert({
        source_url: url,
        platform: platform.id,
        title: title ?? null,
        format: kind,
        status: "completed",
      });
      await checkDownloadMilestone(supabase);
    } catch {
      /* analytics must never affect the download */
    }
  })();
}

/** Emails the admin when total downloads cross a new milestone (every N). */
async function checkDownloadMilestone(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<void> {
  const { count } = await supabase
    .from("downloads")
    .select("*", { count: "exact", head: true });
  if (!count) return;

  // Highest milestone reached so far — robust even if concurrent inserts skip
  // the exact multiple. Dedupe by milestone value means one email per milestone.
  const milestone = Math.floor(count / MILESTONE_EVERY) * MILESTONE_EVERY;
  if (milestone < MILESTONE_EVERY) return;

  await sendAdminAlertOnce(
    `downloads-${milestone}`,
    "download_milestone",
    `🎉 ${milestone.toLocaleString()} downloads on FrenzSave`,
    alertEmailHtml({
      heading: `${milestone.toLocaleString()} downloads & counting`,
      intro: "Your downloader just crossed a new milestone. Nice work! 🚀",
      rows: [
        { label: "Total downloads", value: count.toLocaleString() },
        { label: "Milestone", value: milestone.toLocaleString() },
      ],
      footnote: `You'll get the next nudge at ${(milestone + MILESTONE_EVERY).toLocaleString()} downloads.`,
    }),
  );
}
