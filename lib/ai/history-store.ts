import { AI_HISTORY_KEY } from "@/lib/ai/device-keys";
import type { AiJobView } from "@/lib/ai/jobs";
import { readCookieJar } from "@/lib/dom/cookie";
import { readSessionUserId } from "@/lib/supabase/session-cookie";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE AI HISTORY, KEPT ON THE DEVICE — like the download history
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-06: "the AI history … should save in local storage like the
 * download history and never call server each time a user enters the page or
 * view a video or audio."
 *
 * So the list lives here, in localStorage, and the History page READS it. The
 * server is asked:
 *
 *   · ONCE EVER per account on this browser — the first visit, to seed an
 *     empty store (`syncedAt === null`);
 *   · when the member taps Refresh or "Show more" (their action);
 *   · never on a visit, and never on a timer (the old page re-fetched on every
 *     entry and polled every 15 s while a job ran).
 *
 * It stays current WITHOUT asking: every job the app already receives —
 * a tool page watching its job, a generation finishing, a save, a delete —
 * passes through `lib/ai/client.ts`, which writes it here. Zero extra
 * requests.
 *
 * ── 🔴 A shared phone ───────────────────────────────────────────────────────
 * localStorage belongs to the browser, not the account. The store is stamped
 * with the account id from the session cookie and discarded on a mismatch, and
 * sign-out clears it (lib/auth/sign-out.ts). It holds what `AiJobView` already
 * allows to leave the server — the member's own names, sizes and dates — no
 * signed URLs, paths or tokens.
 */

const KEY = AI_HISTORY_KEY;
/** Kept generously; trimmed only when the browser's quota refuses a write. */
const MAX_ROWS = 400;

export interface AiHistorySnapshot {
  jobs: AiJobView[];
  /** When the server last answered a full first page; null = never on this browser. */
  syncedAt: number | null;
  /** The server's cursor for the NEXT older page; null = nothing older (or unknown). */
  cursor: string | null;
}

interface Stored extends AiHistorySnapshot {
  owner: string | null;
}

const EMPTY: AiHistorySnapshot = { jobs: [], syncedAt: null, cursor: null };

let state: AiHistorySnapshot = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function currentOwner(): string | null {
  const jar = readCookieJar();
  if (!jar) return null;
  const cookies = jar.split(/;\s*/).map((pair) => {
    const at = pair.indexOf("=");
    const rawValue = at === -1 ? "" : pair.slice(at + 1);
    let value = rawValue;
    try {
      value = decodeURIComponent(rawValue);
    } catch {
      /* a malformed value is read as-is */
    }
    return { name: at === -1 ? pair : pair.slice(0, at), value };
  });
  return readSessionUserId(cookies);
}

function load(): void {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    // another account's list is never shown — not even for a frame
    if (!parsed || parsed.owner !== currentOwner() || !Array.isArray(parsed.jobs)) return;
    state = {
      jobs: parsed.jobs,
      syncedAt: typeof parsed.syncedAt === "number" ? parsed.syncedAt : null,
      cursor: typeof parsed.cursor === "string" ? parsed.cursor : null,
    };
  } catch {
    state = EMPTY;
  }
}

function persist(): void {
  if (typeof window === "undefined") return;
  const owner = currentOwner();
  for (let rows = Math.min(state.jobs.length, MAX_ROWS); rows >= 0; rows = rows === 0 ? -1 : Math.floor(rows / 2)) {
    try {
      const stored: Stored = { ...state, jobs: state.jobs.slice(0, rows), owner };
      window.localStorage.setItem(KEY, JSON.stringify(stored));
      return;
    } catch {
      /* quota: keep the newest half and try again — the list on screen is untouched */
    }
  }
}

function emit(): void {
  for (const l of listeners) l();
}

function set(next: AiHistorySnapshot): void {
  state = next;
  persist();
  emit();
}

const newestFirst = (a: AiJobView, b: AiJobView) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);

/** Merge jobs in by id (a newer copy replaces an older one), newest first. */
export function upsertAiHistory(jobs: readonly AiJobView[]): void {
  if (typeof window === "undefined" || jobs.length === 0) return;
  load();
  const byId = new Map(state.jobs.map((j) => [j.id, j]));
  for (const j of jobs) byId.set(j.id, j);
  set({ ...state, jobs: [...byId.values()].sort(newestFirst) });
}

export function removeFromAiHistory(id: string): void {
  if (typeof window === "undefined") return;
  load();
  if (!state.jobs.some((j) => j.id === id)) return;
  set({ ...state, jobs: state.jobs.filter((j) => j.id !== id) });
}

/** A first page arrived from the server: it is now the truth for its range. */
export function replaceAiHistoryFirstPage(jobs: readonly AiJobView[], cursor: string | null): void {
  if (typeof window === "undefined") return;
  load();
  const fresh = new Set(jobs.map((j) => j.id));
  const oldest = jobs.length ? jobs[jobs.length - 1]!.createdAt : null;
  // rows older than the page are kept (they came from "Show more"); rows inside its range that the server no longer returns were deleted elsewhere
  const kept = state.jobs.filter((j) => !fresh.has(j.id) && oldest !== null && j.createdAt < oldest);
  set({ jobs: [...jobs, ...kept].sort(newestFirst), syncedAt: Date.now(), cursor });
}

export function appendAiHistoryPage(jobs: readonly AiJobView[], cursor: string | null): void {
  if (typeof window === "undefined") return;
  load();
  const byId = new Map(state.jobs.map((j) => [j.id, j]));
  for (const j of jobs) byId.set(j.id, j);
  set({ ...state, jobs: [...byId.values()].sort(newestFirst), cursor });
}

export function clearAiHistoryStore(): void {
  state = EMPTY;
  loaded = true;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* nothing to do */
    }
  }
  emit();
}

export function subscribeAiHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAiHistorySnapshot(): AiHistorySnapshot {
  load();
  return state;
}

export function getAiHistoryServerSnapshot(): AiHistorySnapshot {
  return EMPTY;
}
