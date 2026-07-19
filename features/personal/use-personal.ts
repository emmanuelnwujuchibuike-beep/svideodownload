"use client";

import { mutate } from "@/features/data/cache";
import { useQuery } from "@/features/data/use-query";
import { toast } from "@/features/ui/toast";
import type { PersonalItemKind, PersonalItemState } from "@/lib/personal/items";

/**
 * The reader's personal plane, client-side.
 *
 * ── One key for the whole list, not one per item ──────────────────────────────
 *
 * A reader has tens of these, not thousands, and the pages that show them want
 * the whole set at once (a saved list, a course's progress bar, a school page
 * counting finished lessons). Keying per item would turn one request into one
 * per lesson on a school page, and the cache's cross-component sharing — the
 * thing that keeps a toggle in sync with a progress bar elsewhere on the page —
 * would be lost.
 *
 * ── Deliberately not written on page view ─────────────────────────────────────
 *
 * `last_viewed_at` exists in the schema and nothing writes it on mount. A write
 * per page view would put a database round trip behind every lesson open, for a
 * column no feature reads yet. The column is there because widening a table with
 * rows in it is the migration nobody wants to write; the write can arrive with
 * the feature that needs it.
 */

const KEY = "personal:items";

async function fetchItems(): Promise<PersonalItemState[]> {
  const res = await fetch("/api/personal");
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: PersonalItemState[] };
  return data.items ?? [];
}

/** Everything this reader has completed, saved or noted. Empty when signed out. */
export function usePersonalItems(): PersonalItemState[] {
  const { data } = useQuery(KEY, fetchItems, { initialData: [] });
  return data ?? [];
}

/** One item's state, or null if the reader has never touched it. */
export function usePersonalItem(
  kind: PersonalItemKind,
  slug: string,
): PersonalItemState | null {
  const items = usePersonalItems();
  return items.find((item) => item.kind === kind && item.slug === slug) ?? null;
}

interface PersonalPatch {
  completed?: boolean;
  bookmarked?: boolean;
  note?: string | null;
}

function applyPatch(
  items: PersonalItemState[],
  kind: PersonalItemKind,
  slug: string,
  patch: PersonalPatch,
): PersonalItemState[] {
  const now = new Date().toISOString();
  const existing = items.find((item) => item.kind === kind && item.slug === slug);

  const next: PersonalItemState = {
    kind,
    slug,
    completedAt: existing?.completedAt ?? null,
    bookmarkedAt: existing?.bookmarkedAt ?? null,
    lastViewedAt: existing?.lastViewedAt ?? null,
    note: existing?.note ?? null,
  };

  if (patch.completed !== undefined) next.completedAt = patch.completed ? now : null;
  if (patch.bookmarked !== undefined) next.bookmarkedAt = patch.bookmarked ? now : null;
  if (patch.note !== undefined) next.note = patch.note;

  return existing
    ? items.map((item) => (item === existing ? next : item))
    : [...items, next];
}

/**
 * Optimistic write with rollback.
 *
 * The same shape as `setChatAppearance`, and for the same reason: a checkbox
 * that waits on a round trip before it moves reads as broken on a slow
 * connection, which is most of this audience. `mutate` returns the rollback so a
 * failed save puts the control back where it was rather than leaving the
 * interface asserting something the server never accepted.
 */
export async function setPersonalItem(
  kind: PersonalItemKind,
  slug: string,
  patch: PersonalPatch,
): Promise<void> {
  const rollback = mutate<PersonalItemState[]>(KEY, (prev) =>
    applyPatch(prev ?? [], kind, slug, patch),
  );

  try {
    const res = await fetch("/api/personal", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, slug, ...patch }),
    });
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    rollback();
    toast("Couldn't save that.", "error");
  }
}
