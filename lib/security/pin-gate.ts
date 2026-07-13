import { hasValidStepUp } from "@/lib/security/stepup";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Whether a Server Component should withhold real content because this
 * account has a quick-lock PIN set and hasn't cleared the SSR-visible
 * pin-unlock step-up (see /api/v1/app/security/pin/verify, which issues it
 * on success). The client-only `PinLockGate` overlay alone wasn't enough —
 * a Server Component that fetches and embeds real message content into the
 * initial HTML/RSC payload does so BEFORE the client ever decides whether
 * to show the lock screen, so the content was visible via View Source/the
 * network tab (and briefly flashed on screen) even while "locked." Pages
 * that call this and find it `true` must skip their real data fetch
 * entirely and render a locked placeholder instead.
 */
export async function isPinLocked(userId: string): Promise<boolean> {
  // Fails OPEN (not locked) on any unexpected error rather than throwing —
  // this runs on every gated Server Component render, so an unhandled
  // exception here (a transient DB hiccup, a cold-start timeout) crashed the
  // whole page to the generic error boundary instead of just showing content
  // a beat later. Same "stalled check degrades to not-locked" contract the
  // client PinLockGate already documents for its own status fetch.
  try {
    const { data } = await createAdminClient()
      .from("security_pin")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) return false; // no PIN set — never locked, zero behavior change
    return !(await hasValidStepUp(userId, "pin-unlock"));
  } catch {
    return false;
  }
}
