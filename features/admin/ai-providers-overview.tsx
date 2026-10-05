import { AlertTriangle, CheckCircle2, CircleDashed, XCircle } from "lucide-react";

import { AdminJobsAreTestsToggle } from "@/features/admin/admin-jobs-are-tests-toggle";
import type { AiProviderOverview, FeatureHealth } from "@/lib/ai/providers/overview";
import { cn } from "@/lib/utils";

/**
 * Admin → AI → Providers (Part 8 §4, §8, §9, §11, §14, §16, §41, §42, §64).
 *
 * READ-ONLY by design. There is no provider dropdown, no fallback switch and
 * no pause control: the production architecture is fixed in code — Video →
 * Kling, Audio → ElevenLabs — and Replicate / fal.ai are retired. The one
 * setting left on this tab is whether an admin's own jobs count as tests.
 *
 * A server component: no client JavaScript except that one toggle.
 */

const STATE = {
  healthy: { label: "Healthy", icon: CheckCircle2, cls: "text-emerald-700 dark:text-emerald-400" },
  degraded: { label: "Degraded", icon: AlertTriangle, cls: "text-amber-700 dark:text-amber-400" },
  unavailable: { label: "Unavailable", icon: XCircle, cls: "text-rose-700 dark:text-rose-400" },
  unknown: { label: "No recent jobs", icon: CircleDashed, cls: "text-muted-foreground" },
} as const;

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}

function StateLabel({ state }: { state: FeatureHealth["state"] }) {
  const s = STATE[state];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm font-semibold", s.cls)}>
      <s.icon className="h-4 w-4" aria-hidden />
      {s.label}
    </span>
  );
}

export function AiProvidersOverview({ overview }: { overview: AiProviderOverview }) {
  const vendors = [
    { id: "kling" as const, name: "Kling", role: "Video AI provider — the only one", configured: overview.configured.kling },
    { id: "elevenlabs" as const, name: "ElevenLabs", role: "Text to Audio · Voice Cloning (direct API)", configured: overview.configured.elevenlabs },
  ];

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-1 font-semibold">Production providers</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Fixed in code, not chosen here. Credentials live in the deployment&apos;s environment and are never shown — this only says whether one is present.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {vendors.map((v) => (
            <div key={v.id} className="rounded-2xl border border-border/70 p-4">
              <p className="text-sm font-semibold">{v.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{v.role}</p>
              <p className={cn("mt-2 inline-flex items-center gap-1.5 text-sm font-semibold", v.configured ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400")}>
                {v.configured ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <XCircle className="h-4 w-4" aria-hidden />}
                {v.configured ? "Connected (credential present)" : "Connection error — credential missing"}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-1 font-semibold">Feature pipelines</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Every tool keeps its own pipeline. Health is from real jobs in the last {overview.windowDays} days; a tool with no jobs says so rather than claiming to be healthy.
        </p>
        {overview.unreadable ? (
          <p className="rounded-2xl border border-dashed border-amber-400/60 px-4 py-6 text-center text-sm text-amber-800 dark:text-amber-300">
            The job history could not be read just now — these figures are not zeros, they are unknown. Reload to try again.
          </p>
        ) : (
          <ul className="divide-y divide-border/60 rounded-2xl border border-border/70">
            {overview.features.map((f) => (
              <li key={f.id} className="grid gap-2 p-4 sm:grid-cols-[1.3fr_1fr_1fr] sm:items-center">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{f.label}</p>
                  <p className="text-xs text-muted-foreground">
                    Provider: <span className="font-medium text-foreground">{f.vendor === "kling" ? "Kling" : "ElevenLabs"}</span> · Pipeline: {f.pipeline}
                  </p>
                </div>
                <div>
                  <StateLabel state={f.state} />
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {f.completed} done · {f.failed} failed · {f.inFlight} running
                  </p>
                </div>
                <div className="text-xs text-muted-foreground">
                  <p>Last success: {when(f.lastSuccessAt)}</p>
                  {f.topFailure ? (
                    <p className="break-words">
                      Most common failure: <span className="font-mono">{f.topFailure.code}</span> ×{f.topFailure.count}
                    </p>
                  ) : (
                    <p>No failures</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-border/70 p-4">
        <h2 className="mb-1 font-semibold">Retired providers</h2>
        <p className="text-sm text-muted-foreground">
          Replicate and fal.ai have no production route. They are permanently paused, and nothing in the admin can change a provider, add a fallback or un-pause them — the server refuses those settings.
        </p>
      </section>

      <AdminJobsAreTestsToggle initial={overview.adminJobsAreTests} />
    </div>
  );
}
