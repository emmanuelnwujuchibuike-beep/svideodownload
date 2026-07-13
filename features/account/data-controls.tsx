"use client";

import { AlertTriangle, Download, Loader2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { toast } from "@/features/ui/toast";
import { cn } from "@/lib/utils";

/** Part 11c — Privacy Dashboard's "Your data": download an export, or request account deletion (30-day grace period, cancellable). */
export function DataControls() {
  const [exporting, setExporting] = useState(false);
  const [requestedAt, setRequestedAt] = useState<string | null>(null);
  const [purgesAt, setPurgesAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    void fetch("/api/account/delete")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j) {
          setRequestedAt(j.requestedAt);
          setPurgesAt(j.purgesAt);
        }
      });
  }, []);

  const download = async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/account/export");
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "frenz-data-export.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast("Couldn't download your data.", "error");
    } finally {
      setExporting(false);
    }
  };

  const requestDeletion = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/account/delete", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error();
      setRequestedAt(json.requestedAt);
      setPurgesAt(new Date(Date.now() + json.purgesInDays * 864e5).toISOString());
      setConfirmOpen(false);
      setConfirmText("");
      toast("Account deletion requested.", "success");
    } catch {
      toast("Couldn't request deletion.", "error");
    } finally {
      setBusy(false);
    }
  };

  const cancelDeletion = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/account/delete", { method: "DELETE" });
      if (!res.ok) throw new Error();
      setRequestedAt(null);
      setPurgesAt(null);
      toast("Deletion request cancelled.", "success");
    } catch {
      toast("Couldn't cancel.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 sm:p-8">
      <h2 className="mb-1 text-sm font-semibold">Your data</h2>
      <p className="mb-4 text-xs text-muted-foreground">Download a copy of your data, or delete your account.</p>

      <button
        type="button"
        onClick={download}
        disabled={exporting}
        className="mb-4 inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium transition hover:bg-secondary disabled:opacity-60"
      >
        {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        Download my data
      </button>

      {requestedAt ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/[0.04] p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-red-500">
            <AlertTriangle className="h-4 w-4" /> Account deletion requested
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Your account and all its content will be permanently deleted on{" "}
            {purgesAt ? new Date(purgesAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "the scheduled date"}
            . Cancel any time before then.
          </p>
          <button
            type="button"
            onClick={cancelDeletion}
            disabled={busy}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition hover:bg-secondary disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Cancel deletion
          </button>
        </div>
      ) : confirmOpen ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/[0.04] p-4">
          <p className="text-sm font-semibold text-red-500">This can't be undone after the grace period</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Your account and content will be deleted in 30 days unless you cancel first. Type <span className="font-mono font-semibold">delete</span> to confirm.
          </p>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="delete"
            className="mt-2 w-full max-w-[10rem] rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-red-500/40"
          />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={requestDeletion}
              disabled={busy || confirmText.trim().toLowerCase() !== "delete"}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg bg-red-500 px-3 py-1.5 text-xs font-semibold text-white transition disabled:opacity-50",
              )}
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Request deletion
            </button>
            <button
              type="button"
              onClick={() => { setConfirmOpen(false); setConfirmText(""); }}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 px-4 py-2.5 text-sm font-medium text-red-500 transition hover:bg-red-500/10"
        >
          <Trash2 className="h-4 w-4" />
          Delete my account
        </button>
      )}
    </div>
  );
}
