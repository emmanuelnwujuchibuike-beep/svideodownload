"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The Paystack bank picker and account check, shared by the SUB withdraw sheet
 * and the saved payout account. The bank list is read once when shown; the
 * holder's name comes from Paystack as soon as ten digits are in, so nobody ever
 * types a name the money then goes to.
 */

export const FIELD = "w-full rounded-2xl border border-border bg-background px-3 py-2.5 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

export function useBankLookup() {
  const [banks, setBanks] = useState<{ name: string; code: string }[] | null>(null);
  const [bankCode, setBankCode] = useState("");
  const [acct, setAcct] = useState("");
  const [resolved, setResolved] = useState<{ key: string; name: string | null; checking: boolean; error: string | null }>({ key: "", name: null, checking: false, error: null });

  useEffect(() => {
    let live = true;
    void fetch("/api/rewards/banks")
      .then((r) => r.json())
      .then((j: { banks?: { name: string; code: string }[] }) => live && setBanks(j.banks ?? []))
      .catch(() => live && setBanks([]));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!bankCode || !/^\d{10}$/.test(acct)) return;
    const key = `${bankCode}:${acct}`;
    let cancelled = false;
    setResolved({ key, name: null, checking: true, error: null });
    void fetch("/api/rewards/resolve-account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountNumber: acct, bankCode }) })
      .then((r) => r.json())
      .then((j: { ok?: boolean; accountName?: string; error?: string }) => !cancelled && setResolved({ key, name: j.ok ? (j.accountName ?? null) : null, checking: false, error: j.ok ? null : (j.error ?? "Couldn't check that account.") }))
      .catch(() => !cancelled && setResolved({ key, name: null, checking: false, error: "Couldn't check that account." }));
    return () => {
      cancelled = true;
    };
  }, [bankCode, acct]);

  const accountOk = resolved.key === `${bankCode}:${acct}` && !!resolved.name;
  const bankName = banks?.find((b) => b.code === bankCode)?.name ?? "";
  const reset = () => {
    setBankCode("");
    setAcct("");
  };
  return { banks, bankCode, setBankCode, acct, setAcct, resolved, accountOk, bankName, reset };
}

export function BankFields({ lookup, idPrefix }: { lookup: ReturnType<typeof useBankLookup>; idPrefix: string }) {
  const { banks, bankCode, setBankCode, acct, setAcct, resolved, accountOk } = lookup;
  return (
    <>
      <label className="mt-3 block text-[13px] font-semibold" htmlFor={`${idPrefix}-bank`}>
        Bank
      </label>
      <select id={`${idPrefix}-bank`} value={bankCode} onChange={(ev) => setBankCode(ev.target.value)} className={cn(FIELD, "mt-1")} disabled={!banks?.length}>
        <option value="">{banks === null ? "Loading banks…" : banks.length ? "Choose your bank" : "Banks unavailable right now"}</option>
        {(banks ?? []).map((b) => (
          <option key={b.code} value={b.code}>
            {b.name}
          </option>
        ))}
      </select>
      <label className="mt-3 block text-[13px] font-semibold" htmlFor={`${idPrefix}-acct`}>
        Account number
      </label>
      <input id={`${idPrefix}-acct`} inputMode="numeric" autoComplete="off" value={acct} onChange={(ev) => setAcct(ev.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="10 digits" className={cn(FIELD, "mt-1")} />
      <p className="mt-1.5 text-[12.5px]">
        {resolved.checking ? <span className="text-muted-foreground">Checking the account…</span> : accountOk ? <span className="font-semibold text-emerald-700 dark:text-emerald-400">✓ {resolved.name}</span> : resolved.error && resolved.key === `${bankCode}:${acct}` ? <span className="text-rose-600">{resolved.error}</span> : <span className="text-muted-foreground">Paystack confirms the account holder before anything is saved or sent.</span>}
      </p>
    </>
  );
}
