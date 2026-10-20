/**
 * Save the creator's subscription settings (price, live / paused, notifications) — the one call the profile's
 * Exclusive card and the Subscriptions dashboard (step 20) both make.
 */
export async function saveSubSettings(patch: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/members", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "settings", ...patch }) }).catch(() => null);
  const j = (await res?.json().catch(() => null)) as { error?: string } | null;
  return res?.ok ? { ok: true } : { ok: false, error: j?.error ?? "Couldn't save that. Try again." };
}
