"use client";

import { Eye, EyeOff, KeyRound, Loader2, Lock, Mail, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/*
  The admin dashboard lock's screens (0301, lib/admin/lock.ts). The page decides the mode on the server; this only
  collects what is typed and posts it to /api/admin/lock. A full page load follows every success, so the server (not
  this component) decides what opens next. Nothing here is trusted: every rule is checked again on the server.
*/

type Mode =
  | { kind: "unlock"; stage: "password" | "pin"; next: string; lockedUntil: string | null }
  | { kind: "not_set" }
  | { kind: "setup"; token: string }
  | { kind: "reset_request"; hasPrevious: boolean }
  | { kind: "new_pin"; token: string }
  | { kind: "link_invalid"; purpose: "setup" | "pin_reset" };

const FIELD = "mt-1.5 h-12 w-full rounded-xl bg-background px-3.5 text-base text-foreground outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary disabled:opacity-60";
const BUTTON = "mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-frenz-ink font-semibold text-frenz-page transition active:scale-[0.99] disabled:opacity-60";

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch("/api/admin/lock", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    return r.ok && j.ok ? { ok: true } : { ok: false, error: j.error || "That didn't work. Try again." };
  } catch {
    return { ok: false, error: "No connection. Try again." };
  }
}

function Shell({ title, lead, children }: { title: string; lead: ReactNode; children: ReactNode }) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-[26rem]">
        <div className="mb-7 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-frenz-ink text-frenz-page">
            <Lock className="h-5 w-5" aria-hidden />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-[-0.02em] text-foreground">{title}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{lead}</p>
        </div>
        <div className="rounded-3xl border border-border/70 bg-card p-5 shadow-card sm:p-6">{children}</div>
      </div>
    </main>
  );
}

function Secret({ id, label, value, onChange, pin, autoFocus, autoComplete }: { id: string; label: string; value: string; onChange: (v: string) => void; pin?: boolean; autoFocus?: boolean; autoComplete?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="mt-4 first:mt-0">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(pin ? e.target.value.replace(/\D/g, "").slice(0, 6) : e.target.value)}
          inputMode={pin ? "numeric" : undefined}
          maxLength={pin ? 6 : 200}
          autoFocus={autoFocus}
          autoComplete={autoComplete ?? "off"}
          className={cn(FIELD, "pr-12", pin && "tracking-[0.5em]")}
        />
        <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide" : "Show"} className="absolute right-1.5 top-1/2 mt-[3px] flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary">
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function ErrorNote({ text }: { text: string | null }) {
  return text ? (
    <p role="alert" className="mt-3 rounded-xl bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-600 dark:text-rose-400">
      {text}
    </p>
  ) : null;
}

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (body: Record<string, unknown>, onOk: () => void) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await post(body);
    if (r.ok) onOk();
    else {
      setError(r.error ?? null);
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

export function AdminLockScreen({ mode }: { mode: Mode }) {
  switch (mode.kind) {
    case "unlock":
      return mode.stage === "password" ? <PasswordStep next={mode.next} lockedUntil={mode.lockedUntil} /> : <PinStep next={mode.next} />;
    case "not_set":
      return <NotSet />;
    case "setup":
      return <Setup token={mode.token} />;
    case "reset_request":
      return <ResetRequest hasPrevious={mode.hasPrevious} />;
    case "new_pin":
      return <NewPin token={mode.token} />;
    case "link_invalid":
      return (
        <Shell title="This link has expired" lead="Links work once, for 30 minutes, and only for the admin account they were sent to.">
          <Link href={mode.purpose === "setup" ? "/admin/unlock" : "/admin/unlock/reset-pin"} className={BUTTON}>
            Ask for a new link
          </Link>
        </Shell>
      );
  }
}

function PasswordStep({ next, lockedUntil }: { next: string; lockedUntil: string | null }) {
  const [password, setPassword] = useState("");
  const { busy, error, run } = useSubmit();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run({ action: "password", password }, () => window.location.assign(`/admin/unlock?next=${encodeURIComponent(next)}`));
  };
  return (
    <Shell title="Admin dashboard" lead="Enter the dashboard password. The PIN comes next.">
      <form onSubmit={submit}>
        {lockedUntil ? <ErrorNote text={`Too many tries. The dashboard is locked until ${new Date(lockedUntil).toLocaleTimeString()}.`} /> : null}
        <Secret id="lock-password" label="Dashboard password" value={password} onChange={setPassword} autoFocus autoComplete="current-password" />
        <ErrorNote text={error} />
        <button type="submit" disabled={busy || !password} className={BUTTON}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <KeyRound className="h-4 w-4" aria-hidden />} Continue
        </button>
      </form>
    </Shell>
  );
}

function PinStep({ next }: { next: string }) {
  const [pin, setPin] = useState("");
  const { busy, error, run } = useSubmit();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run({ action: "pin", pin }, () => window.location.assign(next));
  };
  return (
    <Shell title="Enter your admin PIN" lead="Six digits. The dashboard opens for 8 hours on this device.">
      <form onSubmit={submit}>
        <Secret id="lock-pin" label="PIN" value={pin} onChange={setPin} pin autoFocus />
        <ErrorNote text={error} />
        <button type="submit" disabled={busy || pin.length !== 6} className={BUTTON}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />} Unlock
        </button>
        <div className="mt-4 text-center">
          <Link href="/admin/unlock/reset-pin" className="text-sm font-medium text-muted-foreground underline-offset-2 hover:underline">
            Forgot the PIN?
          </Link>
        </div>
      </form>
    </Shell>
  );
}

function NotSet() {
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useSubmit();
  return (
    <Shell title="Set up the dashboard lock" lead="Before the dashboard opens, choose a dashboard password and a PIN. We'll email you a setup link first.">
      {sent ? (
        <p className="flex items-start gap-2.5 text-sm text-foreground">
          <Mail className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> If this account can set up the lock, a link is on its way to your email. It works once, for 30 minutes.
        </p>
      ) : (
        <>
          <ErrorNote text={error} />
          <button type="button" disabled={busy} onClick={() => void run({ action: "setup_link" }, () => setSent(true))} className={cn(BUTTON, "mt-0")}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Mail className="h-4 w-4" aria-hidden />} Email me the setup link
          </button>
        </>
      )}
    </Shell>
  );
}

function Setup({ token }: { token: string }) {
  const [v, setV] = useState({ password: "", password2: "", pin: "", pin2: "" });
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  const { busy, error, run } = useSubmit();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run({ action: "setup", token, ...v }, () => window.location.assign("/admin/unlock"));
  };
  return (
    <Shell title="Choose your password and PIN" lead="The password is for this dashboard only (12+ characters). Keep both somewhere safe.">
      <form onSubmit={submit}>
        <Secret id="s-pw" label="Dashboard password" value={v.password} onChange={set("password")} autoFocus autoComplete="new-password" />
        <Secret id="s-pw2" label="Type it again" value={v.password2} onChange={set("password2")} autoComplete="new-password" />
        <Secret id="s-pin" label="PIN (6 digits)" value={v.pin} onChange={set("pin")} pin />
        <Secret id="s-pin2" label="Type the PIN again" value={v.pin2} onChange={set("pin2")} pin />
        <ErrorNote text={error} />
        <button type="submit" disabled={busy} className={BUTTON}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Save and continue
        </button>
      </form>
    </Shell>
  );
}

function ResetRequest({ hasPrevious }: { hasPrevious: boolean }) {
  const [current, setCurrent] = useState("");
  const [previous, setPrevious] = useState("");
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useSubmit();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run({ action: "reset_request", current, previous }, () => setSent(true));
  };
  return (
    <Shell
      title="Reset the admin PIN"
      lead={hasPrevious ? "Enter your current dashboard password and the one you used before it." : "Enter your dashboard password twice. There's no earlier password on record."}
    >
      {sent ? (
        <p className="flex items-start gap-2.5 text-sm text-foreground">
          <Mail className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Check your email. The link opens the page to choose a new PIN. It works once, for 30 minutes.
        </p>
      ) : (
        <form onSubmit={submit}>
          <Secret id="r-cur" label="Current dashboard password" value={current} onChange={setCurrent} autoFocus autoComplete="current-password" />
          <Secret id="r-prev" label={hasPrevious ? "Previous dashboard password" : "Current dashboard password, again"} value={previous} onChange={setPrevious} />
          <ErrorNote text={error} />
          <button type="submit" disabled={busy || !current || !previous} className={BUTTON}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Mail className="h-4 w-4" aria-hidden />} Email me the reset link
          </button>
          <div className="mt-4 text-center">
            <Link href="/admin/unlock" className="text-sm font-medium text-muted-foreground underline-offset-2 hover:underline">
              Back
            </Link>
          </div>
        </form>
      )}
    </Shell>
  );
}

function NewPin({ token }: { token: string }) {
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const { busy, error, run } = useSubmit();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run({ action: "reset_complete", token, pin, pin2 }, () => window.location.assign("/admin/unlock"));
  };
  return (
    <Shell title="Choose a new admin PIN" lead="Six digits. Every open dashboard signs out of the lock, and you'll unlock again with the new PIN.">
      <form onSubmit={submit}>
        <Secret id="n-pin" label="New PIN" value={pin} onChange={setPin} pin autoFocus />
        <Secret id="n-pin2" label="Type it again" value={pin2} onChange={setPin2} pin />
        <ErrorNote text={error} />
        <button type="submit" disabled={busy || pin.length !== 6 || pin2.length !== 6} className={BUTTON}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Save the new PIN
        </button>
      </form>
    </Shell>
  );
}
