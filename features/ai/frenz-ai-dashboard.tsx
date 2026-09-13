"use client";

import { ChevronRight, History, Loader2, Plus, Wallet } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { formatCents } from "@/lib/ai/economy";
import { majorInputToMinor } from "@/lib/money/units";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FRENZ AI DASHBOARD — a button on the page, a sheet when it is tapped
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "I still don't see the dashboard and all we have been
 * doing about the dashboard, deposit, usage and all, it should be on this page."
 * Then: "make the dashboard card in the ai page to be inside a dashboard button
 * in the page that when clicked it opens the dashboard modal."
 *
 * So the page carries ONE row — the balance and what is free today, tappable —
 * and everything else (recharge, the counters, the price, the ledger, the way
 * to history) lives in a sheet that opens from it. The standing rule's §17
 * panel is intact; it is simply behind a tap rather than pushing the drop zone
 * down the screen.
 *
 * ── 🔴 IT RENDERS NOTHING UNTIL IT KNOWS SOMETHING ──────────────────────────
 *
 * No skeleton of zeroes. "0 free left" and "$0.00" are both statements about
 * somebody's account, and showing them before the answer arrives tells a member
 * with credit that they have none — for as long as the request takes, on
 * exactly the connection where it takes longest. The row is absent, then
 * correct.
 *
 * ── 🔴 ONE REQUEST, AND NO POLLING ──────────────────────────────────────────
 *
 * `/api/ai/balance` returns every fact together because they are one panel and
 * are meaningless apart. It is fetched on mount, when the sheet opens, after a
 * job completes, and after a payment is verified — never on a timer. This sits
 * on a page somebody leaves open while a video processes, and an interval here
 * would be the battery rule broken for a number that changes twice a day.
 *
 * ── 🔴 A RECHARGE IS VERIFIED ON RETURN, NOT ASSUMED ────────────────────────
 *
 * Owner, 2026-09-09: "i just recharged but it didnt show in the dashboard."
 *
 * Paystack sends the member back with `?reference=…` in the URL. Until now
 * nothing read it: the page fetched the balance once on mount — usually before
 * the webhook had landed, and forever if the webhook URL was never configured
 * on the Paystack side. So the money moved and the screen said it had not.
 *
 * Now the reference is posted to `/api/ai/balance/topup/verify`, which asks
 * PAYSTACK what became of it and credits only what Paystack says settled, under
 * the same idempotency key the webhook uses. The browser supplies an
 * identifier, never an outcome — see that route. Then the balance is re-read
 * and the sheet opens on the new number, so the member sees their credit
 * without hunting for it.
 *
 * ── Money is displayed, never computed ──────────────────────────────────────
 *
 * Every amount arrives as integer minor units and passes through `formatCents`
 * once, on the way to the screen. The one place a decimal is touched is the
 * custom amount field, and it goes through `majorInputToMinor` — the same
 * conversion the admin form uses — to become an integer BEFORE it is sent. The
 * server re-validates it against the operator's bounds regardless.
 */

/*
  The sheet is the app's shared glass bottom-sheet, which imports framer-motion.
  Loaded only when somebody actually opens the dashboard: the AI pages have a
  first-load budget, and a member who never taps the row never pays for it.
*/
const GlassSheetShell = dynamic(
  () => import("@/features/ui/glass-sheet-shell").then((m) => m.GlassSheetShell),
  { ssr: false },
);

interface DashboardState {
  balanceCents: number;
  symbol: string;
  priceCents: number;
  topupOptionsCents: number[];
  minTopupCents: number;
  maxTopupCents: number;
  usedToday: number;
  dailyLimit: number;
  usedThisWeek: number;
  weeklyLimit: number;
  freeRemaining: number;
  weekResetsAt: string;
  ledger: {
    id: string;
    deltaCents: number;
    kind: "topup" | "admin_credit" | "job_charge" | "job_refund";
    createdAt: string;
  }[];
}

/**
 * The row on the page, and the sheet it opens.
 *
 * Owns the data: one `load`, called on mount, on open, after a finished job and
 * after a verified payment. The panel inside is display and actions only.
 */
export function FrenzAIDashboard({
  historyHref,
  className,
}: {
  historyHref: string;
  className?: string;
}) {
  const [state, setState] = useState<DashboardState | null>(null);
  const [open, setOpen] = useState(false);
  /*
    The sheet is mounted on the FIRST open and then kept: mounting it on every
    open would cut its close animation short (the shell animates out inside an
    AnimatePresence, which needs to stay rendered to do so), and mounting it on
    page load would fetch framer-motion for a member who never taps the row.
  */
  const [sheetMounted, setSheetMounted] = useState(false);
  /** A sentence about a payment that just verified — shown once, in the sheet. */
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/balance", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as DashboardState;
      if (typeof json.balanceCents === "number") setState(json);
    } catch {
      // Left absent rather than wrong. See the note at the top.
    }
  }, []);

  useEffect(() => {
    void load();
    /*
      A finished job changes both counters and, for a paid one, the balance —
      the workspace dispatches this the moment it hears. Listening is cheaper
      than polling and exact where polling is approximate.
    */
    const onFinished = () => void load();
    window.addEventListener("frenz-ai:job-finished", onFinished);
    return () => window.removeEventListener("frenz-ai:job-finished", onFinished);
  }, [load]);

  /*
    ── 🔴 THE RETURN FROM PAYSTACK ────────────────────────────────────────────

    `reference` (and its alias `trxref`) is what Paystack appends to the
    callback URL. It is read once, sent to the verify route, and then REMOVED
    from the address bar with `replaceState` — so a reload, a bookmark or a
    back-swipe does not re-run a verification, and the URL somebody shares is
    the page and not their transaction.
  */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get("reference") ?? params.get("trxref");
    if (!reference) return;

    params.delete("reference");
    params.delete("trxref");
    const rest = params.toString();
    const clean = `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", clean);

    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/ai/balance/topup/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reference }),
        });
        const json = (await res.json()) as { credited?: boolean; pending?: boolean };
        if (!alive) return;
        await load();
        if (!alive) return;
        /*
          Opened on the member's behalf, whichever way it went: a credited
          payment deserves to be SEEN, and a pending one deserves a sentence
          rather than a silent old number.
        */
        setNotice(
          json.credited
            ? "Payment received — your AI balance has been updated."
            : json.pending
              ? "Your payment is still being confirmed. This will update shortly."
              : null,
        );
        setSheetMounted(true);
        setOpen(true);
      } catch {
        if (alive) void load();
      }
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  const openSheet = () => {
    haptic("selection");
    setSheetMounted(true);
    setOpen(true);
    void load();
  };
  const closeSheet = useCallback(() => {
    setOpen(false);
    setNotice(null);
  }, []);

  if (!state) return null;

  const freeLine =
    state.freeRemaining > 0
      ? `${state.freeRemaining} free ${state.freeRemaining === 1 ? "video" : "videos"} left today`
      : `${formatCents(state.priceCents, state.symbol)} per video`;

  return (
    <>
      {/* ── the button on the page ─────────────────────────────────────────── */}
      <button
        type="button"
        onClick={openSheet}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "group flex w-full items-center gap-3 rounded-[1.25rem] border border-border/70 bg-card/95 px-3.5 py-3 text-left",
          "transition hover:border-foreground/20 active:scale-[0.995]",
          className,
        )}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-500 to-fuchsia-500 text-white shadow-sm">
          <Wallet className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              AI balance
            </span>
            <span className="text-[15px] font-bold leading-none tabular-nums">
              {formatCents(state.balanceCents, state.symbol)}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">{freeLine}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[12px] font-semibold text-primary">
          Dashboard
          <ChevronRight
            className="h-4 w-4 transition-transform motion-safe:group-hover:translate-x-0.5"
            aria-hidden
          />
        </span>
      </button>

      {/* ── the sheet ──────────────────────────────────────────────────────── */}
      {sheetMounted ? (
        <GlassSheetShell open={open} onClose={closeSheet} title="AI dashboard" fitContent defaultHeightVh={90}>
          <DashboardPanel historyHref={historyHref} state={state} reload={load} notice={notice} />
        </GlassSheetShell>
      ) : null}
    </>
  );
}

/* ═══════════════════════════ the panel inside the sheet ════════════════════ */

function DashboardPanel({
  historyHref,
  state,
  reload,
  notice,
}: {
  historyHref: string;
  state: DashboardState;
  reload: () => void;
  notice: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [showTopup, setShowTopup] = useState(false);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);

  const topup = async (amountCents: number) => {
    setBusy(true);
    setError(null);
    haptic("selection");
    try {
      const res = await fetch("/api/ai/balance/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountCents,
          /*
            So Paystack sends them back HERE. The server accepts only a fixed
            set of AI paths for this — anything else is the default — so the
            value is a hint the route may decline, never a redirect it obeys.
          */
          returnTo: window.location.pathname,
        }),
      });
      const json = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !json.url) {
        setError(json.error ?? "We couldn't start that payment. Try again.");
        setBusy(false);
        return;
      }
      /*
        🔴 A full navigation to Paystack's hosted page, not a popup or an
        iframe. Card entry belongs on the payment provider's own origin — it is
        their PCI scope, their fraud tooling, and the only place a member can
        check the padlock against a name they recognise.
      */
      window.location.href = json.url;
    } catch {
      setError("We couldn't start that payment. Try again.");
      setBusy(false);
    }
  };

  /*
    ── 🔴 THE CUSTOM AMOUNT (owner, 2026-09-09) ──────────────────────────────

    "the add balance dont have an input field to add a custom amount."

    Typed in major units — "500" for ₦500 — because that is how a person says
    money, and converted ONCE with the same `majorInputToMinor` the admin form
    uses, so the two ends of this system cannot disagree about what a typed
    number means. The bounds shown come from the server and the button is
    disabled outside them; the server refuses anything outside them regardless,
    so this is a courtesy that saves a round trip, not the gate.
  */
  const customCents = majorInputToMinor(custom);
  const customValid =
    customCents !== null && customCents >= state.minTopupCents && customCents <= state.maxTopupCents;

  const outOfFree = state.freeRemaining <= 0;
  const canAfford = state.balanceCents >= state.priceCents;

  return (
    <div className="pb-1">
      {notice ? (
        <p
          role="status"
          className="mb-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.07] px-3.5 py-2.5 text-[13px] font-semibold text-emerald-700 dark:text-emerald-300"
        >
          {notice}
        </p>
      ) : null}

      {/* ── balance, and the way to add to it ───────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            <Wallet className="h-3.5 w-3.5" aria-hidden />
            AI balance
          </p>
          <p className="mt-0.5 text-[1.75rem] font-bold leading-none tabular-nums">
            {formatCents(state.balanceCents, state.symbol)}
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            haptic("selection");
            setShowTopup((v) => !v);
          }}
          aria-expanded={showTopup}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2.5 text-[13px] font-bold",
            "bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500 text-white",
            "shadow-[0_10px_26px_-12px_rgb(99_102_241/0.9)] transition active:scale-[0.98]",
          )}
        >
          <Plus className="h-4 w-4" aria-hidden />
          Recharge
        </button>
      </div>

      {/* ── the three facts, as the reference asks ──────────────────────── */}
      <dl className="mt-4 grid grid-cols-3 gap-2">
        <Fact
          label="Today"
          value={`${state.usedToday} / ${state.dailyLimit}`}
          hint="free"
          spent={state.usedToday >= state.dailyLimit}
        />
        <Fact
          label="This week"
          value={`${state.usedThisWeek} / ${state.weeklyLimit}`}
          hint="free"
          spent={state.usedThisWeek >= state.weeklyLimit}
        />
        <Fact label="Per video" value={formatCents(state.priceCents, state.symbol)} hint="after free" />
      </dl>

      {/*
        ── 🔴 THE RECHARGE STATE, AND ITS TONE ──────────────────────────────

        §18: "Show a clear professional state… Do not use aggressive advertising
        language. Do not tell users to watch ads to continue AI processing."

        So it states three facts and offers one action. It appears only when the
        free allowance is actually spent AND the balance will not cover a video —
        a member with credit is simply charged and never sees this at all.
      */}
      {outOfFree && !canAfford ? (
        <div className="mt-4 rounded-2xl border border-amber-500/35 bg-amber-500/[0.06] p-3.5">
          <p className="text-[13.5px] font-bold">AI balance too low</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
            Your free AI allowance has been used for this period. Recharge your AI balance to keep
            going — {formatCents(state.priceCents, state.symbol)} per video. Free videos come back{" "}
            {resetWording(state.weekResetsAt)}.
          </p>
        </div>
      ) : null}

      {/* ── the amounts, revealed rather than always present ────────────── */}
      {showTopup ? (
        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Add balance
          </p>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {state.topupOptionsCents.map((cents) => (
              <button
                key={cents}
                type="button"
                disabled={busy}
                onClick={() => void topup(cents)}
                className={cn(
                  "rounded-xl border border-border/70 bg-background px-2 py-2.5 text-[13px] font-bold tabular-nums",
                  "transition hover:border-foreground/25 active:scale-[0.97] disabled:opacity-60",
                )}
              >
                {formatCents(cents, state.symbol)}
              </button>
            ))}
          </div>

          {/* ── or any amount ──────────────────────────────────────────────── */}
          <form
            className="mt-2.5 flex items-stretch gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (customValid && customCents !== null) void topup(customCents);
            }}
          >
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Custom amount</span>
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[13px] font-bold text-muted-foreground"
              >
                {state.symbol}
              </span>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="Other amount"
                value={custom}
                onChange={(e) => {
                  setCustom(e.target.value);
                  setError(null);
                }}
                disabled={busy}
                className={cn(
                  "h-11 w-full rounded-xl border border-border/70 bg-background pr-3 text-[14px] font-bold tabular-nums",
                  "placeholder:font-medium placeholder:text-muted-foreground/70",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                )}
                style={{ paddingLeft: `${0.75 + state.symbol.length * 0.55}rem` }}
              />
            </label>
            <button
              type="submit"
              disabled={busy || !customValid}
              className={cn(
                "inline-flex h-11 shrink-0 items-center gap-1 rounded-xl px-4 text-[13px] font-bold text-white",
                "bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500 transition active:scale-[0.98]",
                "disabled:opacity-45 disabled:saturate-50",
              )}
            >
              <Plus className="h-4 w-4" aria-hidden />
              Add
            </button>
          </form>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            {busy
              ? "Opening secure checkout…"
              : `Any amount from ${formatCents(state.minTopupCents, state.symbol)} to ${formatCents(state.maxTopupCents, state.symbol)}. Paid securely through Paystack.`}
          </p>
          {error ? (
            <p role="alert" className="mt-1.5 text-[12px] font-medium text-amber-600 dark:text-amber-400">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* ── recent activity, and the way to the full list ───────────────── */}
      {state.ledger.length > 0 ? (
        <div className="mt-4 border-t border-border/60 pt-3">
          <ul className="space-y-1.5">
            {state.ledger.slice(0, 5).map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 text-[12.5px]">
                <span className="min-w-0 truncate text-muted-foreground">{LEDGER_LABEL[row.kind]}</span>
                <span
                  className={cn(
                    "shrink-0 font-bold tabular-nums",
                    row.deltaCents > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-foreground",
                  )}
                >
                  {row.deltaCents > 0 ? "+" : ""}
                  {formatCents(row.deltaCents, state.symbol)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-2">
        <Link
          href={historyHref}
          prefetch={false}
          className="flex items-center gap-2 rounded-xl px-1 py-1.5 text-[13px] font-semibold transition hover:text-primary"
        >
          <History className="h-4 w-4 text-muted-foreground" aria-hidden />
          Usage &amp; history
          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
        </Link>
        <button
          type="button"
          onClick={() => {
            haptic("selection");
            reload();
          }}
          className="rounded-xl px-2 py-1.5 text-[12px] font-semibold text-muted-foreground transition hover:text-foreground"
        >
          Refresh
        </button>
      </div>

      {busy ? (
        <span className="sr-only" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Opening checkout
        </span>
      ) : null}
    </div>
  );
}

/**
 * 🔴 A total `Record` over the ledger's kinds, so a new entry type fails the
 * BUILD here rather than rendering as an empty row on somebody's statement.
 */
const LEDGER_LABEL: Record<DashboardState["ledger"][number]["kind"], string> = {
  topup: "Balance added",
  admin_credit: "Credit from Frenz",
  job_charge: "AI video",
  job_refund: "Refunded — job didn't finish",
};

function Fact({
  label,
  value,
  hint,
  spent,
}: {
  label: string;
  value: string;
  hint: string;
  spent?: boolean;
}) {
  return (
    <div className="rounded-xl bg-secondary/40 px-2.5 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-0.5 text-[15px] font-bold tabular-nums leading-none",
          // Amber rather than red: a spent allowance is an ordinary state with
          // a next step, not a failure.
          spent && "text-amber-600 dark:text-amber-400",
        )}
      >
        {value}
      </dd>
      <dd className="mt-0.5 text-[10px] text-muted-foreground/70">{hint}</dd>
    </div>
  );
}

/**
 * "on Monday", or "tomorrow" when that is what Monday is.
 *
 * 🔴 Said as a DAY, never a timestamp. "Your free videos come back at
 * 00:00 UTC on 2026-09-14" is a true sentence nobody can act on; the weekly
 * boundary is Monday and that is the useful half of it.
 */
function resetWording(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "next week";
  const days = Math.ceil((at - Date.now()) / 86_400_000);
  if (days <= 1) return "tomorrow";
  return `on ${new Date(at).toLocaleDateString(undefined, { weekday: "long" })}`;
}
