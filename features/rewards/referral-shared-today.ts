/**
 * "Shared or copied the invite link today" (owner, 2026-10-08: "when a user have
 * copy the link once it should not show again to that device or user for that
 * day, until the following day"). Kept on the DEVICE, keyed by the local day,
 * so it lapses at the member's midnight. Per device only: the same member on a
 * second phone may see it once there too — a server record would be needed to
 * silence every device, and this banner deliberately makes no request of its own.
 */
const KEY = "frenz:referral-shared-day";

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function markSharedToday(): void {
  try {
    localStorage.setItem(KEY, today());
  } catch {
    /* no storage — the banner may show again; nothing breaks */
  }
}

export function sharedToday(): boolean {
  try {
    return localStorage.getItem(KEY) === today();
  } catch {
    return false;
  }
}
