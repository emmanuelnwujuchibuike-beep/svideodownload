"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { type ApiResult, type PinState, walletApi } from "./api";
import { failMessage } from "./state";
import { KeyIcon, ShieldCheckIcon } from "./wallet-icons";
import { ActionBar, Notice, PillButton, PinField, SessionExpired, SubHeader, Unavailable, WalletScreen } from "./wallet-ui";

type Mode = "setup" | "change" | "reset-request" | "reset-confirm";
type Fail = { msg: string; expired: boolean };

/**
 * /wallet/security — the Frenz Coin TRANSACTION PIN: set it, change it, or reset it with a code sent to the confirmed
 * email. PINs are typed into masked one-time fields, sent once, then cleared — never stored on the device, never shown.
 * The server's own wording is used for refusals (it is deliberately generic: it never says which part was wrong).
 */
export function WalletSecurity({ pin }: { pin: PinState }) {
  const router = useRouter();
  const locked = !!pin.lockedUntil && Date.parse(pin.lockedUntil) > Date.now();
  const [mode, setMode] = useState<Mode>(pin.set ? (locked ? "reset-request" : "change") : "setup");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Fail | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [sentNote, setSentNote] = useState<string | null>(null);

  if (!pin.available)
    return (
      <WalletScreen label="PIN and security">
        <SubHeader title="Security" />
        <Unavailable title="Transaction PINs aren't available">Setting a PIN isn&apos;t available right now. Transfers and withdrawals stay off until it is.</Unavailable>
      </WalletScreen>
    );

  const clear = () => {
    setCurrent("");
    setNext("");
    setAgain("");
    setCode("");
  };
  const finish = async (r: ApiResult<unknown>, done: string) => {
    setBusy(false);
    clear();
    if (!r.ok) return setError({ msg: failMessage(r, "pin"), expired: r.session === "expired" });
    setSuccess(done);
    setSentNote(null);
    setMode("change");
    // the wallet's "can send" depends on this: re-read it (and drop the cached wallet pages)
    router.refresh();
  };
  const go = (m: Mode) => {
    clear();
    setError(null);
    setSuccess(null);
    setMode(m);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setSuccess(null);
    if (mode === "reset-request") {
      setBusy(true);
      const r = await walletApi.requestReset();
      setBusy(false);
      if (!r.ok) return setError({ msg: failMessage(r, "pin"), expired: r.session === "expired" });
      setSentNote(r.data.message);
      setMode("reset-confirm");
      return;
    }
    if (next.length !== 6 || again.length !== 6 || (mode === "change" && current.length !== 6) || (mode === "reset-confirm" && code.length !== 8)) return setError({ msg: mode === "reset-confirm" && code.length !== 8 ? "Enter the 8-digit code from the email." : "A transaction PIN is exactly 6 digits.", expired: false });
    if (next !== again) return setError({ msg: "The two new PINs don't match.", expired: false });
    setBusy(true);
    if (mode === "setup") return finish(await walletApi.setPin(next, again), "Your transaction PIN is set. You'll use it to confirm transfers and withdrawals.");
    if (mode === "change") return finish(await walletApi.changePin(current, next, again), "Your transaction PIN was changed.");
    return finish(await walletApi.confirmReset(code, next, again), "Your transaction PIN was reset.");
  };

  const title = mode === "setup" ? "Set your transaction PIN" : mode === "change" ? "Change your PIN" : mode === "reset-request" ? "Reset your PIN" : "Enter your reset code";
  const cta = mode === "setup" ? "Set PIN" : mode === "change" ? "Change PIN" : mode === "reset-request" ? "Email me a code" : "Reset PIN";

  return (
    <WalletScreen label="PIN and security">
      <SubHeader title="Security" />
      <div className="mx-4 mt-5 flex items-center gap-3 rounded-[22px] bg-frenz-fill/70 px-4 py-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-frenz-gradient text-white">{pin.set ? <ShieldCheckIcon size={20} /> : <KeyIcon size={20} />}</span>
        <span className="flex flex-col">
          <span className="font-heading text-[15px] font-bold text-frenz-ink">Transaction PIN</span>
          <span className="text-[12.5px] text-frenz-muted">{locked ? "Locked after too many wrong tries" : pin.set ? "On — confirms every transfer and withdrawal" : "Not set — needed to send or withdraw"}</span>
        </span>
      </div>

      {success ? (
        <Notice tone="success" className="mt-4">
          {success}
        </Notice>
      ) : null}

      <form onSubmit={(e) => void submit(e)} className="mt-2 flex flex-col" aria-labelledby="pin-form-title">
        <h2 id="pin-form-title" className="px-5 pb-1 pt-5 font-heading text-[19px] font-bold tracking-[-0.4px] text-frenz-ink">
          {title}
        </h2>
        <p className="px-5 pb-3 text-[13px] text-frenz-muted">
          {mode === "setup"
            ? "Choose 6 digits that aren't a birthday, one digit repeated or a straight run. It's separate from any other Frenz PIN."
            : mode === "change"
              ? "Enter your current PIN, then the new one twice."
              : mode === "reset-request"
                ? "We'll email a one-time code to your confirmed address. It expires after a few minutes."
                : sentNote ?? "Enter the 8-digit code from the email, then your new PIN twice."}
        </p>
        <div className="mx-4 flex flex-col gap-3">
          {mode === "reset-confirm" ? (
            <label htmlFor="pin-code" className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold text-frenz-muted">8-digit code</span>
              <input id="pin-code" data-large-text inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))} className="h-14 rounded-2xl bg-frenz-fill px-4 text-center font-heading !text-xl font-bold tracking-[0.4em] text-frenz-ink outline-none focus-visible:ring-2 focus-visible:ring-frenz-blue" />
            </label>
          ) : null}
          {mode === "change" ? <PinField id="pin-current" label="Current PIN" value={current} onChange={setCurrent} disabled={busy} /> : null}
          {mode !== "reset-request" ? (
            <>
              <PinField id="pin-new" label={mode === "setup" ? "New PIN" : "New PIN"} value={next} onChange={setNext} disabled={busy} />
              <PinField id="pin-again" label="Type it again" value={again} onChange={setAgain} disabled={busy} />
            </>
          ) : null}
        </div>
        {error ? <div className="mt-4">{error.expired ? <SessionExpired next="/wallet/security" /> : <Notice tone="error">{error.msg}</Notice>}</div> : null}

        <div className="mt-4 flex flex-col items-center gap-1 px-4">
          {mode === "change" ? (
            <button type="button" onClick={() => go("reset-request")} className="h-11 rounded-full px-3 text-sm font-bold text-frenz-violet outline-none focus-visible:ring-2 focus-visible:ring-frenz-blue">
              Forgot your PIN?
            </button>
          ) : null}
          {(mode === "reset-request" || mode === "reset-confirm") && pin.set && !locked ? (
            <button type="button" onClick={() => go("change")} className="h-11 rounded-full px-3 text-sm font-bold text-frenz-violet outline-none focus-visible:ring-2 focus-visible:ring-frenz-blue">
              I remember it — change it instead
            </button>
          ) : null}
          {mode === "reset-confirm" ? (
            <button type="button" onClick={() => go("reset-request")} className="h-11 rounded-full px-3 text-sm font-bold text-frenz-violet outline-none focus-visible:ring-2 focus-visible:ring-frenz-blue">
              Send a new code
            </button>
          ) : null}
        </div>

        <ActionBar>
          <PillButton type="submit" disabled={busy} aria-busy={busy}>
            {busy ? "Please wait…" : cta}
          </PillButton>
        </ActionBar>
      </form>
    </WalletScreen>
  );
}
