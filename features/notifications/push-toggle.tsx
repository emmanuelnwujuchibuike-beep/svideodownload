"use client";

import { Bell, BellOff, Loader2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import {
  disablePush,
  enablePush,
  getPushState,
  PushSessionExpiredError,
  PushSubscribeFailedError,
  pushSupported,
  type PushState,
} from "@/features/notifications/push";
import { cn } from "@/lib/utils";

/**
 * "Turn on push" control for the Notification Center. Reflects the live browser
 * permission/subscription state and lets the user enable or mute device pushes.
 * Renders nothing when the browser can't do push or VAPID isn't configured.
 */
export function PushToggle() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (!pushSupported()) {
      setState("unsupported");
      return;
    }
    void getPushState().then(setState);
  }, []);

  if (state === null || state === "unsupported") return null;

  const on = state === "subscribed";
  const denied = state === "denied";

  const toggle = async () => {
    if (busy || denied) return;
    setBusy(true);
    setFailed(null);
    setExpired(false);
    try {
      setState(on ? await disablePush() : await enablePush());
    } catch (err) {
      // enablePush() throws on a real failure (subscribe rejected, server
      // save failed) instead of silently reporting "unsubscribed" — without
      // this catch, `state` never updates and the button just reverts to
      // idle with zero feedback, indistinguishable from "the click did
      // nothing." The thrown error's own message is shown directly (rather
      // than one hardcoded string) so a browser-side subscribe failure and a
      // server-side save failure read as the two different problems they are.
      if (err instanceof PushSessionExpiredError) setExpired(true);
      else if (err instanceof PushSubscribeFailedError) setFailed(err.message);
      else setFailed(err instanceof Error ? err.message : "Couldn't update push — try again.");
    } finally {
      setBusy(false);
    }
  };

  if (denied) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-card/60 px-3.5 py-2 text-xs font-medium text-muted-foreground">
        <BellOff className="h-4 w-4" /> Push blocked in browser
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={on}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition disabled:opacity-60",
          on
            ? "border border-border/70 bg-card/60 text-foreground hover:bg-secondary"
            : "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-md shadow-violet-500/25 hover:opacity-95",
        )}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : on ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
        {on ? "Mute push" : "Turn on push"}
      </button>
      {expired ? (
        <Link
          href={`/login?next=${encodeURIComponent(pathname || "/home")}`}
          className="text-[11px] font-medium text-rose-500 underline underline-offset-2"
        >
          Session expired — sign in again
        </Link>
      ) : failed ? (
        <span className="text-[11px] font-medium text-rose-500">{failed}</span>
      ) : null}
    </span>
  );
}
