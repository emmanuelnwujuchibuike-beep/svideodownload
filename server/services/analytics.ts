import { getDownloadAlerts } from "@/lib/analytics/download-alert-settings";
import { getGrowthAlerts, milestoneFor } from "@/lib/analytics/growth-alert-settings";
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

// The milestone interval and its on/off switch now live in `settings`, tunable
// from the dashboard without a redeploy — see lib/analytics/download-alert-settings.ts.
// `ALERT_DOWNLOAD_EVERY` remains the default when nothing has been saved.

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
  // Read the switch BEFORE counting: when the alert is off there is no reason
  // to spend an exact count on the download path at all.
  const { every, enabled } = await getDownloadAlerts();
  if (!enabled) return;

  const { count } = await supabase
    .from("downloads")
    .select("*", { count: "exact", head: true });
  if (!count) return;

  // Highest milestone reached so far — robust even if concurrent inserts skip
  // the exact multiple. Dedupe by milestone value means one email per milestone.
  const milestone = Math.floor(count / every) * every;
  if (milestone < every) return;

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
      footnote: `You'll get the next nudge at ${(milestone + every).toLocaleString()} downloads.`,
    }),
  );
}

/* ───────────────────────── growth milestones (2026-09-20) ────────────────── */

/**
 * Emails the admin when total unique visitors or total members cross a new
 * milestone (every N of each, set on the dashboard — lib/analytics/
 * growth-alert-settings.ts). The same lock the download milestone uses
 * (`admin_alerts.key`), so a milestone is announced once however many
 * callers notice it.
 *
 * Two callers: the daily digest cron (every run) and the analytics collect
 * route, sampled and throttled — one count per instance per ten minutes at
 * most, because the visitor count is a DISTINCT over every human event ever
 * recorded (index-only on `analytics_events_human_visitor_idx`, but not free).
 */
let lastGrowthCheckAt = 0;
const GROWTH_CHECK_THROTTLE_MS = 10 * 60_000;

export async function checkGrowthMilestones(opts: { force?: boolean } = {}): Promise<{ visitors: number | null; users: number | null; sent: string[] }> {
  const sent: string[] = [];
  if (!hasSupabase) return { visitors: null, users: null, sent };
  if (!opts.force && Date.now() - lastGrowthCheckAt < GROWTH_CHECK_THROTTLE_MS) return { visitors: null, users: null, sent };
  lastGrowthCheckAt = Date.now();
  const settings = await getGrowthAlerts();
  if (!settings.visitors.enabled && !settings.users.enabled) return { visitors: null, users: null, sent };
  const supabase = createAdminClient();
  let visitors: number | null = null;
  let users: number | null = null;
  try {
    if (settings.visitors.enabled) {
      const { data, error } = await supabase.rpc("analytics_visitors_total");
      if (!error && typeof data === "number") visitors = data;
      else if (!error && data && typeof data === "object" && "count" in (data as object)) visitors = Number((data as { count: unknown }).count);
    }
    if (settings.users.enabled) {
      const { count } = await supabase.from("profiles").select("id", { count: "exact", head: true });
      users = count ?? null;
    }
  } catch (e) {
    console.error("[analytics] growth counts failed", { error: String(e).slice(0, 160) });
    return { visitors, users, sent };
  }
  for (const [name, count, every, noun, intro] of [
    ["visitors", visitors, settings.visitors.every, "visitors", "People keep finding FrenzSave. Nice work! 🚀"],
    ["users", users, settings.users.every, "members", "More people have made FrenzSave theirs. Nice work! 🚀"],
  ] as const) {
    if (count === null) continue;
    const milestone = milestoneFor(count, every);
    if (!milestone) continue;
    const outcome = await sendAdminAlertOnce(
      `${name}-${milestone}`,
      `${name === "visitors" ? "visitor" : "user"}_milestone`,
      `🎉 ${milestone.toLocaleString()} ${noun} on FrenzSave`,
      alertEmailHtml({
        heading: `${milestone.toLocaleString()} ${noun} & counting`,
        intro,
        rows: [
          { label: name === "visitors" ? "Unique visitors, all time" : "Members, all time", value: count.toLocaleString() },
          { label: "Milestone", value: milestone.toLocaleString() },
        ],
        footnote: `You'll get the next nudge at ${(milestone + every).toLocaleString()} ${noun}.`,
      }),
    );
    if (outcome === "sent") sent.push(`${name}-${milestone}`);
  }
  return { visitors, users, sent };
}
