import { alertEmailHtml, sendAdminAlertOnce } from "@/lib/notify";
import { createAdminClient } from "@/lib/supabase/admin";
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

/**
 * Aggregate download stats.
 *
 * ── 🔴 THIS READS AS THE SERVICE ROLE, AND THAT IS THE FIX ───────────────────
 *
 * Owner, 2026-09-08: "my downloads in admin revenue and traffic doesnt show all
 * downloads, it ends at 4 or 8 even i have hundreds of visitors that download
 * that day."
 *
 * It was reading through the SIGNED-IN ADMIN'S client, relying on the RLS
 * policy `auth.uid() = user_id or public.is_admin()`. The second half never
 * fired, because this product has TWO definitions of "admin" and they had
 * drifted apart:
 *
 *   • the route guard (lib/admin/require-admin.ts) accepts
 *     `profiles.role = 'admin'` OR a match in the ADMIN_EMAILS env var;
 *   • `public.is_admin()` in SQL accepts ONLY `profiles.role = 'admin'`.
 *
 * The owner is an admin by the env var, and no profile carries the role. So
 * they passed the guard, saw the page, and then RLS quietly narrowed every
 * query to `auth.uid() = user_id` — their OWN downloads. Measured on
 * 2026-09-08: the dashboard showed a handful against a real 17,657 total and 33
 * that day, because 16,102 of those downloads are signed-out and belong to
 * nobody.
 *
 * Reading with the service role removes the second definition from the path
 * entirely. The AUTHORIZATION has not moved: every caller is behind
 * `requireAdminPage`, which verifies the session against the auth server before
 * this function is ever reached. What changes is that the answer no longer
 * depends on a SQL function agreeing with the guard — which is the class of bug
 * that produced a dashboard confidently reporting the wrong number.
 *
 * ⚠️ The same divergence still silences other admin-only policies (the
 * `analytics` table is `using (public.is_admin())` with no owner fallback at
 * all). Setting `role = 'admin'` on the operator's profile fixes those too and
 * is worth doing separately.
 */
export async function fetchDownloadStats(): Promise<DownloadStats | null> {
  try {
    /*
      🔴 Service role, NOT the member's client. Safe only because every caller
      is admin-gated first — see the note above. A new caller must keep that
      property.
    */
    const supabase = createAdminClient();
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

/**
 * Recent admin alerts (milestones, proxy warnings) for the dashboard log.
 *
 * 🔴 Service role, for the same reason as `fetchDownloadStats` above and with
 * more force: `admin_alerts` is admin-read-ONLY, with no owner fallback at all.
 * So while `public.is_admin()` disagreed with the route guard, this returned an
 * empty list every single time and the dashboard showed "no alerts" — which is
 * indistinguishable from "nothing has gone wrong", and is the worse of the two
 * failures a monitoring panel can have.
 *
 * Caller is `requireAdminPage`-gated; the authorization has not moved.
 */
export async function fetchRecentAlerts(): Promise<AdminAlert[]> {
  try {
    const supabase = createAdminClient();
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
