import { alertEmailHtml, sendAdminAlertOnce } from "@/lib/notify";
import { createClient } from "@/lib/supabase/server";
import { WORKER_SECRET, WORKER_URL, hasWorker } from "@/lib/worker";
import { getProxyUsage, type ProxyUsage } from "@/server/proxy/proxy-manager";

/** Proxy usage — from the worker (which runs the proxy) or locally. */
export async function fetchProxyUsage(): Promise<ProxyUsage | null> {
  if (hasWorker) {
    try {
      const res = await fetch(`${WORKER_URL}/api/admin/proxy`, {
        headers: { "x-worker-secret": WORKER_SECRET },
        cache: "no-store",
      });
      if (res.ok) return (await res.json()) as ProxyUsage;
    } catch {
      /* worker unreachable */
    }
    return null;
  }
  return getProxyUsage();
}

export interface DownloadStats {
  total: number;
  today: number;
  last7: number;
  byKind: { video: number; audio: number; image: number };
  platforms: { platform: string; total_downloads: number }[];
  recent: { platform: string; title: string | null; created_at: string }[];
}

export interface AdminAlert {
  kind: string;
  subject: string | null;
  created_at: string;
}

const sinceIso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const startOfTodayIso = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

/** Aggregate download stats from Supabase (admin reads via RLS policy). */
export async function fetchDownloadStats(): Promise<DownloadStats | null> {
  try {
    const supabase = await createClient();
    const countAll = () =>
      supabase.from("downloads").select("*", { count: "exact", head: true });

    const [total, today, last7, video, audio, image, platformsRes, recentRes] =
      await Promise.all([
        countAll(),
        countAll().gte("created_at", startOfTodayIso()),
        countAll().gte("created_at", sinceIso(7 * 864e5)),
        countAll().eq("format", "video"),
        countAll().eq("format", "audio"),
        countAll().eq("format", "image"),
        supabase
          .from("platform_stats")
          .select("platform, total_downloads")
          .order("total_downloads", { ascending: false })
          .limit(12),
        supabase
          .from("downloads")
          .select("platform, title, created_at")
          .order("created_at", { ascending: false })
          .limit(8),
      ]);

    return {
      total: total.count ?? 0,
      today: today.count ?? 0,
      last7: last7.count ?? 0,
      byKind: {
        video: video.count ?? 0,
        audio: audio.count ?? 0,
        image: image.count ?? 0,
      },
      platforms: platformsRes.data ?? [],
      recent: recentRes.data ?? [],
    };
  } catch {
    return null;
  }
}

/** Recent admin alerts (milestones, proxy warnings) for the dashboard log. */
export async function fetchRecentAlerts(): Promise<AdminAlert[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("admin_alerts")
      .select("kind, subject, created_at")
      .order("created_at", { ascending: false })
      .limit(6);
    return data ?? [];
  } catch {
    return [];
  }
}

/**
 * Emails the admin once per day when residential-proxy spend crosses 90% of the
 * monthly budget — a genuine cost-protection alert. Cheap: a conflicting dedupe
 * insert short-circuits on every subsequent dashboard load that day.
 */
export async function maybeAlertProxyBudget(proxy: ProxyUsage | null): Promise<void> {
  if (!proxy || proxy.alertLevel < 90) return;
  const day = new Date().toISOString().slice(0, 10);
  await sendAdminAlertOnce(
    `proxy-budget-${day}`,
    "proxy_budget",
    `⚠️ Proxy budget at ${proxy.alertLevel}% — FrenzSave`,
    alertEmailHtml({
      heading: `Residential proxy at ${proxy.alertLevel}% of budget`,
      intro:
        "Your proxy bandwidth is running high this month. Consider raising the cap or reducing proxy-eligible platforms before it runs out.",
      rows: [
        { label: "Used this month", value: `${proxy.gbThisMonth} / ${proxy.limitGb} GB` },
        { label: "Remaining", value: `${proxy.remainingGb} GB` },
        ...(proxy.estimatedCostUsd != null
          ? [{ label: "Est. cost", value: `~$${proxy.estimatedCostUsd}` }]
          : []),
      ],
      footnote: "You'll get at most one proxy alert per day.",
    }),
  );
}
