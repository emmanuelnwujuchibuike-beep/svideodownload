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
  platforms: { platform: string; total_downloads: number }[];
  recent: { platform: string; title: string | null; created_at: string }[];
}

/** Aggregate download stats from Supabase (admin reads via RLS policy). */
export async function fetchDownloadStats(): Promise<DownloadStats | null> {
  try {
    const supabase = await createClient();

    const countRes = await supabase
      .from("downloads")
      .select("*", { count: "exact", head: true });

    const platformsRes = await supabase
      .from("platform_stats")
      .select("platform, total_downloads")
      .order("total_downloads", { ascending: false })
      .limit(12);

    const recentRes = await supabase
      .from("downloads")
      .select("platform, title, created_at")
      .order("created_at", { ascending: false })
      .limit(8);

    return {
      total: countRes.count ?? 0,
      platforms: platformsRes.data ?? [],
      recent: recentRes.data ?? [],
    };
  } catch {
    return null;
  }
}
