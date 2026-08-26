"use client";

import { FileDown } from "lucide-react";
import { useState } from "react";

import { DownloadLogTable } from "@/features/admin/download-log";
import { ExportButton, RangeTabs } from "@/features/admin/analytics-dashboard";
import type { Range } from "@/lib/analytics/download-log";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DOWNLOAD HISTORY — its own section in Traffic
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-08-25: *"put download history in it own section in traffic with a
 * top nav, so i can easily located download history in traffic section."*
 *
 * It used to render INSIDE `AnalyticsDashboard`, below the aggregate cards and
 * above the Pages table — reachable only by scrolling the whole live dashboard,
 * which is precisely the "I can't find it" being reported. It is now a tab of
 * its own on the Traffic panel, so it is one tap from anywhere in that section.
 *
 * ── Why it carries its own range control ─────────────────────────────────────
 * It used to borrow `AnalyticsDashboard`'s `range` state. Lifted out of that
 * component, it has no parent to borrow from — and it should not: the question
 * "who downloaded what" is asked over a different window than "what is the site
 * doing right now". Its own state also means switching Traffic tabs cannot
 * silently re-scope the table under the operator.
 *
 * The CSV export moves with it. It is the same button the live dashboard shows,
 * exporting the same rows this table displays, and leaving it behind would put
 * the export for this data on a different tab from the data.
 *
 * 🔴 `RangeTabs` and `ExportButton` are IMPORTED, not copied. Both briefly
 * existed as duplicates here and the route-weight budget caught it — /admin was
 * already at its ceiling, so the duplication was measurable. Two copies of the
 * range selector would also let two tabs of one section disagree about what
 * "7 days" means.
 */
export function DownloadHistoryPanel() {
  const [range, setRange] = useState<Range>("7d");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-semibold">
            <FileDown className="h-4 w-4 text-muted-foreground" aria-hidden /> Download history
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Every download, successful and failed, with the source link and who fetched it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton range={range} type="downloads" label="Downloads CSV" />
          <RangeTabs range={range} onChange={setRange} />
        </div>
      </div>

      <DownloadLogTable range={range} />
    </div>
  );
}
