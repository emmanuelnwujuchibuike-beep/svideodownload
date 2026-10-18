/**
 * Chat message grouping (owner brief, 2026-10-18: "group consecutive messages, one timestamp per
 * group"; design/Chat.dc.html). Consecutive messages read as one group when they share a sender and
 * a calendar day, each is within GROUP_GAP_MS of the one before it, and neither is a system notice.
 * A group shows one time (and, for your newest message, the receipt) under its last bubble, and only
 * that bubble carries the tail.
 */
export const GROUP_GAP_MS = 5 * 60_000;

type GroupableMessage = { senderId: string; createdAt: string; metadata?: { kind?: string } | null };

function sameLocalDay(a: string, b: string): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

export function sameMessageGroup(a: GroupableMessage, b: GroupableMessage): boolean {
  if (a.metadata?.kind === "system" || b.metadata?.kind === "system") return false;
  if (a.senderId !== b.senderId || !sameLocalDay(a.createdAt, b.createdAt)) return false;
  return Math.abs(new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) <= GROUP_GAP_MS;
}
