"use client";

import { BadgeCheck, Check, Eye, IdCard, Loader2, ScanFace, ShieldOff, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  ID_DOCUMENT_TYPES,
  REJECTION_CODES,
  VERIFICATION_CATEGORIES,
  type VerificationRequest,
} from "@/lib/social/verification-shared";
import { cn } from "@/lib/utils";

type QueueRow = VerificationRequest & {
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

interface Docs {
  front: string | null;
  back: string | null;
  selfie: string | null;
}

/**
 * Verification review — the admin side.
 *
 * Two independent jobs on one panel, because they are two different situations:
 *
 *  • The QUEUE. Applications waiting on a decision, oldest first. Documents are
 *    not embedded in the page — the reviewer taps "Open documents" and the server
 *    mints signed URLs that die in 5 minutes, so nobody's passport ends up
 *    sitting in page source or a browser cache. The legal name is shown right
 *    beside the display name, because a mismatch between the two is the single
 *    most common reason to decline.
 *
 *  • ISSUE DIRECTLY. Type a username, grant the tick (owner: "admin can issue
 *    directly to skip all the processes"). No application, no documents. It is
 *    still recorded as an approved, `issued_directly` request naming the admin,
 *    so the audit trail can always answer who verified an account and why.
 */
export function VerificationQueue({
  queue,
  counts,
}: {
  queue: QueueRow[];
  counts: { pending: number; approved: number; rejected: number };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [docs, setDocs] = useState<Record<string, Docs>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const call = async (payload: Record<string, unknown>, key: string) => {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch("/api/admin/verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; urls?: Docs };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Action failed.");
        return null;
      }
      return json;
    } catch {
      setError("Network error.");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const openDocs = async (id: string) => {
    const json = await call({ action: "documents", requestId: id }, `docs:${id}`);
    if (json?.urls) setDocs((d) => ({ ...d, [id]: json.urls! }));
  };

  const decide = async (row: QueueRow, approve: boolean) => {
    const reason = reasons[row.id]?.trim() ?? "";
    if (!approve && !codes[row.id]) {
      setError("Choose a reason code before declining.");
      return;
    }
    const json = await call(
      approve
        ? { action: "approve", requestId: row.id, reason }
        : { action: "reject", requestId: row.id, code: codes[row.id], reason },
      row.id,
    );
    if (json) router.refresh();
  };

  return (
    <section className="mt-6 rounded-3xl border border-border bg-card p-5 shadow-card sm:p-6">
      <h2 className="mb-1 flex flex-wrap items-center gap-2 font-semibold">
        <BadgeCheck className="h-5 w-5 text-primary" /> Verification
        {counts.pending > 0 ? (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-500">
            {counts.pending} waiting
          </span>
        ) : null}
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {counts.approved} verified
        </span>
      </h2>
      <p className="mb-5 text-sm text-muted-foreground">
        Check that the legal name matches the document, and that the selfie is the same person. Document links expire
        after 5 minutes.
      </p>

      {error ? <p className="mb-4 text-sm font-medium text-rose-500">{error}</p> : null}

      <IssueDirectly onDone={() => router.refresh()} />

      {queue.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No applications waiting.</p>
      ) : (
        <ul className="mt-6 space-y-4">
          {queue.map((row) => {
            const nameMismatch =
              !!row.legalName && !!row.displayName && row.legalName.trim().toLowerCase() !== row.displayName.trim().toLowerCase();
            const d = docs[row.id];
            return (
              <li key={row.id} className="rounded-2xl border border-border/70 bg-background/40 p-4">
                {/* Applicant */}
                <div className="flex items-start gap-3">
                  {row.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={row.avatarUrl} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-bold text-muted-foreground">
                      {(row.displayName ?? "?").charAt(0).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      {row.displayName ?? "Unnamed"}
                      {row.handle ? <span className="text-xs font-normal text-muted-foreground">@{row.handle}</span> : null}
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        {VERIFICATION_CATEGORIES.find((c) => c.value === row.category)?.label ?? row.category}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Submitted{" "}
                      {row.submittedAt
                        ? new Date(row.submittedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
                        : "—"}
                    </p>
                  </div>
                </div>

                {/* The identity claim */}
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <Detail label="Legal name" value={row.legalName} warn={nameMismatch} />
                  <Detail label="Verified as" value={row.displayName} warn={nameMismatch} />
                  <Detail
                    label="Document"
                    value={`${ID_DOCUMENT_TYPES.find((t) => t.value === row.idDocumentType)?.label ?? row.idDocumentType ?? "—"}${
                      row.idNumberLast4 ? ` ···${row.idNumberLast4}` : ""
                    }`}
                  />
                  <Detail label="Country" value={row.country} />
                </dl>
                {nameMismatch ? (
                  <p className="mt-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-600 dark:text-amber-400">
                    The legal name and the display name differ. That can be legitimate (a stage or business name) — check
                    the document and the supporting links before deciding.
                  </p>
                ) : null}
                {row.statement ? <p className="mt-2 text-sm text-muted-foreground">“{row.statement}”</p> : null}

                {/* Documents */}
                <div className="mt-3">
                  {d ? (
                    <div className="grid grid-cols-3 gap-2">
                      <DocThumb label="ID front" url={d.front} icon={IdCard} />
                      <DocThumb label="ID back" url={d.back} icon={IdCard} />
                      <DocThumb label="Selfie" url={d.selfie} icon={ScanFace} />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void openDocs(row.id)}
                      disabled={busy === `docs:${row.id}`}
                      className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-semibold transition hover:bg-secondary"
                    >
                      {busy === `docs:${row.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                      Open documents
                    </button>
                  )}
                </div>

                {/* Decision */}
                <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,14rem)_1fr]">
                  <select
                    value={codes[row.id] ?? ""}
                    onChange={(e) => setCodes((c) => ({ ...c, [row.id]: e.target.value }))}
                    className="h-10 rounded-xl bg-background px-3 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Decline reason…</option>
                    {REJECTION_CODES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <input
                    value={reasons[row.id] ?? ""}
                    onChange={(e) => setReasons((r) => ({ ...r, [row.id]: e.target.value }))}
                    placeholder="Note for the decision (shown to the applicant if declined)"
                    className="h-10 rounded-xl bg-background px-3 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy === row.id}
                    onClick={() => void decide(row, true)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 py-2 text-sm font-bold text-white transition hover:bg-emerald-600 disabled:opacity-60"
                  >
                    {busy === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve
                  </button>
                  <button
                    type="button"
                    disabled={busy === row.id}
                    onClick={() => void decide(row, false)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/40 px-3.5 py-2 text-sm font-bold text-rose-500 transition hover:bg-rose-500/10 disabled:opacity-60"
                  >
                    <X className="h-4 w-4" /> Decline
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Detail({ label, value, warn }: { label: string; value: string | null; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("truncate font-medium", warn && "text-amber-600 dark:text-amber-400")}>{value || "—"}</dd>
    </div>
  );
}

function DocThumb({ label, url, icon: Icon }: { label: string; url: string | null; icon: typeof IdCard }) {
  if (!url) {
    return (
      <div className="flex aspect-[4/3] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border text-muted-foreground">
        <Icon className="h-5 w-5" />
        <span className="text-[10px] font-semibold">Not provided</span>
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="group relative block overflow-hidden rounded-xl border border-border">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={label} className="aspect-[4/3] w-full object-cover transition group-hover:scale-[1.03]" />
      <span className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1 text-[10px] font-bold text-white">{label}</span>
    </a>
  );
}

/** Grant the tick with no application at all. */
function IssueDirectly({ onDone }: { onDone: () => void }) {
  const [handle, setHandle] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const issue = async () => {
    if (!handle.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "issue", handle: handle.trim(), reason: reason.trim() }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && json.ok) {
        setMsg({ ok: true, text: `@${handle.replace(/^@/, "")} is now verified.` });
        setHandle("");
        setReason("");
        onDone();
      } else {
        setMsg({ ok: false, text: json.error ?? "Failed to issue." });
      }
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-violet-500/25 bg-violet-500/5 p-4">
      <p className="flex items-center gap-2 text-sm font-bold">
        <Sparkles className="h-4 w-4 text-violet-500" /> Issue directly
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Grant the tick immediately, with no application and no documents. Recorded against your account in the audit
        trail.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,12rem)_1fr_auto]">
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="@username"
          className="h-10 rounded-xl bg-background px-3 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
        />
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why (e.g. known partner, verified out of band)"
          className="h-10 rounded-xl bg-background px-3 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
        />
        <button
          type="button"
          onClick={() => void issue()}
          disabled={busy || !handle.trim()}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 text-sm font-bold text-white transition disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />} Verify
        </button>
      </div>
      {msg ? (
        <p className={cn("mt-2 text-xs font-medium", msg.ok ? "text-emerald-500" : "text-rose-500")}>{msg.text}</p>
      ) : null}
      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <ShieldOff className="h-3 w-3" /> To take a tick back, use the same box with a reason and the Revoke action from
        the member&apos;s moderation record.
      </p>
    </div>
  );
}
