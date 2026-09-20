"use client";

import type { CharacterReplacePublicConfig } from "@/lib/ai/character-replace/config";
import type { ReplacementMode } from "@/lib/ai/character-replace/modes";
import type { CharacterReplaceQuote, CharacterReplaceVoiceSource, QuoteInput } from "@/lib/ai/character-replace/pricing";
import type { CharacterReplaceBalance, CharacterReplaceBilling, CharacterReplacePreflight, CharacterReplaceTransaction } from "@/lib/ai/character-replace/types";
import type { AiErrorCode } from "@/lib/ai/errors";
import type { AiJobView } from "@/lib/ai/jobs";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CHARACTER REPLACE — the browser's reads, and the two things it may ask for
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The workspace needs three things from the server before a member can
 * confirm anything: what the tool OFFERS (the public config), what the member
 * HAS (this tool's balance), and what the chosen settings COST (the quote).
 * All three are reads; none moves money or starts work. The two writes here —
 * beginning a recharge, verifying a return — hand a reference to the server
 * and let it decide.
 *
 * ── 🔴 THIS TOOL'S OWN WALLET (Part 3, §2) ──────────────────────────────────
 *
 * Owner, 2026-09-13: "Character Replace must have its own rechargeable
 * balance… Do NOT combine Character Replace balance with the AI Clean
 * balance." Part 1 presented the platform wallet as this tool's; Part 3
 * gives it a wallet of its own — `ai_product_balances` / `ai_product_ledger`
 * with `product = character_replace` (migration 0154) — and every function
 * here talks to the PRODUCT endpoints under /api/ai/character-replace/.
 * Nothing in this file touches /api/ai/balance.
 *
 * ── 🔴 THE QUOTE IS ASKED FOR, NEVER COMPUTED ──────────────────────────────
 *
 * `getCharacterReplaceQuote` sends the CONFIGURATION (duration, quality,
 * voice, lip sync) and receives the price. The body carries no amount; the
 * route refuses one. The figure the member sees is the server's, signed, and
 * it is the id of that signed quote — not its numbers — that Part 4 hands
 * back at confirm.
 */

export type CharacterReplaceClientResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: AiErrorCode | "NETWORK"; error: string };

async function request<T>(input: RequestInfo, init?: RequestInit): Promise<CharacterReplaceClientResult<T>> {
  let res: Response;
  try {
    /*
      `no-store` on the REQUEST as well as the response (2026-09-14): a job
      poll answered from the browser's HTTP cache showed "Replacing the face"
      four minutes after the job had finished, because the edge had stamped
      a two-hour public max-age on a header-less API answer. The server now
      sends no-store for every AI route; this side refuses a cached answer
      even if a proxy in between ever rewrites that again.
    */
    res = await fetch(input, { cache: "no-store", ...init });
  } catch {
    return { ok: false, code: "NETWORK", error: "You appear to be offline. Try again in a moment." };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* an empty body is handled below */
  }
  if (!res.ok) {
    const b = (body ?? {}) as { code?: AiErrorCode; error?: string };
    return {
      ok: false,
      code: b.code ?? "INTERNAL_ERROR",
      error: b.error ?? "Something went wrong. Try again in a moment.",
    };
  }
  return { ok: true, ...((body ?? {}) as T) };
}

/** What the tool offers, and whether it is on for this member. */
export async function getCharacterReplaceConfig(): Promise<
  CharacterReplaceClientResult<{
    config: CharacterReplacePublicConfig;
    available: boolean;
    audience: string;
    processingAvailable?: boolean;
    /** Part 8 §2: the operator's maintenance notice, when one is up. */
    maintenance?: { active: boolean; message: string | null };
    /** Part 8 §2: new starts are paused (running jobs finish). */
    processingPaused?: boolean;
    /** Part 10 §25: why `available` is false when a launch mode, not a switch, decided it. */
    unavailableReason?: string | null;
  }>
> {
  return request("/api/ai/character-replace/config");
}

/* ───────────────────────────── the job (Part 4) ─────────────────────────── */

export interface CharacterReplaceUploadTicket {
  path: string;
  uploadUrl: string;
  expiresIn: number;
}

/**
 * Open a job and receive two upload tickets. Nothing is charged; nothing is
 * sent to a provider. Idempotent on `clientRequestId` — a retry returns the
 * same job with fresh tickets.
 */
export interface CharacterReplaceUploadTickets {
  video: CharacterReplaceUploadTicket;
  photo: CharacterReplaceUploadTicket;
  /** Part 6: one ticket per extra identity photo, in the order they were sent. */
  references: CharacterReplaceUploadTicket[];
  /** Part 6: the replacement audio's ticket, when one was declared. */
  voice: CharacterReplaceUploadTicket | null;
}

export async function createCharacterReplaceJob(input: {
  clientRequestId: string;
  /** The finished attempt this one retries (Part 5, §7). */
  retryOf?: string;
  /** Part 6: which replacement. Absent = Full Character. */
  mode?: ReplacementMode;
  photo: { name: string; mimeType: string; size: number; width: number; height: number };
  /** Part 6: extra identity photos (Skin + Face). */
  references?: { name: string; mimeType: string; size: number; width: number; height: number }[];
  video: { name: string; mimeType: string; size: number; durationMs: number; width: number; height: number; hasAudio: boolean };
  /** Part 6: the member's replacement audio, facts only. */
  audio?: { name: string; mimeType: string; size: number; durationMs: number | null };
}): Promise<CharacterReplaceClientResult<{ job: AiJobView; created: boolean; uploads: CharacterReplaceUploadTickets | null }>> {
  return request("/api/ai/character-replace/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

/**
 * Start a job whose two files are in place: hands back the SIGNED quote (its
 * signed fields only), the trim and the consent. The server re-verifies the
 * quote, reserves the charge from this tool's wallet, and hands the job to
 * the worker. Pressing twice is safe: the second call finds the job already
 * started and changes nothing.
 */
export async function startCharacterReplaceJob(
  jobId: string,
  input: {
    quote: Pick<
      CharacterReplaceQuote,
      "id" | "product" | "currency" | "pricingConfigVersion" | "durationMs" | "mode" | "quality" | "voiceMode" | "voiceSource" | "ttsCharacters" | "voiceChange" | "lipSyncMode" | "totalCents" | "expiresAt"
    >;
    trim: { startMs: number; endMs: number } | null;
    consent: true;
    /** 2026-09-20: the pass the preflight route answered for these files — Start refuses without it. */
    preflightToken?: string;
    /** Part 6: the voice in full — only with a new voice. */
    voice?: {
      source: CharacterReplaceVoiceSource;
      text?: string;
      languageCode?: string;
      voiceId?: string;
      /** 2026-09-20: the catalogue voice an uploaded recording is re-voiced in. */
      changeVoiceId?: string;
      trimToFit?: boolean;
      voiceConsent?: boolean;
    };
  },
): Promise<CharacterReplaceClientResult<{ job: AiJobView; started: boolean; balanceCents?: number; shortfallCents?: number; requiredCents?: number }>> {
  return request(`/api/ai/character-replace/jobs/${encodeURIComponent(jobId)}/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

/** The shape `/api/ai/character-replace/balance` answers with. */
interface BalanceResponse {
  product: "character_replace";
  balanceCents: number;
  currency: string;
  symbol: string;
  topupOptionsCents: number[];
  minTopupCents: number;
  maxTopupCents: number;
  checkout?: { currency: string; symbol: string; minorPerUsd: number } | null;
  ledger: CharacterReplaceTransaction[];
}

/**
 * "Checking your media…" (2026-09-20): after the uploads and before Start,
 * the worker measures the photo and the video for the job's mode and the
 * server answers a structured verdict with the words to print — and, on a
 * pass, the short-lived token Start requires. Nothing is charged by this.
 * FEATURE_UNAVAILABLE is "we couldn't check just now" — to retry, unpaid.
 */
export async function preflightCharacterReplaceJob(
  jobId: string,
): Promise<CharacterReplaceClientResult<{ preflight: CharacterReplacePreflight; token: string | null; tokenExpiresAt: string | null }>> {
  return request(`/api/ai/character-replace/jobs/${encodeURIComponent(jobId)}/preflight`, { method: "POST" });
}

/**
 * The member's Character Replace balance, shaped for the balance card, and
 * their recent transactions on THIS wallet. The answer is kept on the device
 * (below) so the next open paints it before the network answers.
 */
export async function getCharacterReplaceBalance(opts?: { ledger?: number }): Promise<
  CharacterReplaceClientResult<{ balance: CharacterReplaceBalance; transactions: CharacterReplaceTransaction[] }>
> {
  const limit = Math.max(1, Math.min(100, Math.floor(opts?.ledger ?? 5)));
  const res = await request<BalanceResponse>(`/api/ai/character-replace/balance?ledger=${limit}`);
  if (!res.ok) return res;
  const balance: CharacterReplaceBalance = {
    balanceCents: res.balanceCents,
    currency: res.currency,
    symbol: res.symbol,
    topupOptionsCents: res.topupOptionsCents,
    minTopupCents: res.minTopupCents,
    maxTopupCents: res.maxTopupCents,
    checkout: res.checkout ?? null,
  };
  writeCachedCharacterReplaceBalance(balance);
  return { ok: true, balance, transactions: res.ledger ?? [] };
}

/* ───────────────────────── the on-device snapshot ────────────────────────── */

/*
  The last figure this browser saw, for the first paint — the same contract
  the AI dashboard keeps for ITS wallet (lib/ai/balance-cache.ts), under a
  key of this product's own so the two snapshots can never be read for each
  other. A day's TTL; cleared on sign-out (lib/auth/sign-out.ts). Nothing
  here is authoritative: the network answer replaces it, and every decision
  that spends money is the server's, made at the moment it matters.
*/
const BALANCE_CACHE_KEY = "frenzsave_cr_balance_v1";
const BALANCE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function readCachedCharacterReplaceBalance(): CharacterReplaceBalance | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(BALANCE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: unknown; value?: Partial<CharacterReplaceBalance> };
    if (typeof parsed.at !== "number" || !parsed.value) return null;
    if (Date.now() - parsed.at > BALANCE_CACHE_TTL_MS) {
      window.localStorage.removeItem(BALANCE_CACHE_KEY);
      return null;
    }
    const v = parsed.value;
    if (typeof v.balanceCents !== "number" || typeof v.symbol !== "string") return null;
    return {
      balanceCents: v.balanceCents,
      currency: typeof v.currency === "string" ? v.currency : "",
      symbol: v.symbol,
      topupOptionsCents: Array.isArray(v.topupOptionsCents) ? v.topupOptionsCents.filter((n): n is number => typeof n === "number") : [],
      minTopupCents: typeof v.minTopupCents === "number" ? v.minTopupCents : 0,
      maxTopupCents: typeof v.maxTopupCents === "number" ? v.maxTopupCents : 0,
    };
  } catch {
    return null;
  }
}

export function writeCachedCharacterReplaceBalance(value: CharacterReplaceBalance): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BALANCE_CACHE_KEY, JSON.stringify({ at: Date.now(), value }));
  } catch {
    /* quota, private mode — the next open pays the network again, no more */
  }
}

/** Called on sign-out. A balance must not outlive the session that read it. */
export function clearCharacterReplaceBalanceCache(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(BALANCE_CACHE_KEY);
  } catch {
    /* nothing to do — the TTL is the backstop */
  }
}

/* ───────────────────────────── the quote ─────────────────────────────────── */

/** What POST /api/ai/character-replace/quote answers with. */
export interface CharacterReplaceQuoteAnswer {
  quote: CharacterReplaceQuote;
  /** The product wallet as the server read it while quoting. */
  balanceCents: number;
  afterCents: number;
  sufficient: boolean;
  shortfallCents: number;
  /** Part 11 §7: whether this video would be a complimentary creation. */
  billing?: CharacterReplaceBilling;
}

/**
 * Ask the server what these settings cost. `signal` lets a newer request
 * abandon an older one — the member drags the trim handle, and only the
 * last answer matters.
 *
 * 🔴 The body is the four priced inputs and nothing else. There is no field
 * for a price here to put a price in.
 */
export async function getCharacterReplaceQuote(
  input: QuoteInput,
  signal?: AbortSignal,
): Promise<CharacterReplaceClientResult<CharacterReplaceQuoteAnswer>> {
  const body: QuoteInput = {
    selectedDurationMs: input.selectedDurationMs,
    mode: input.mode,
    quality: input.quality,
    voiceMode: input.voiceMode,
    voiceSource: input.voiceMode === "new_voice" ? (input.voiceSource ?? null) : null,
    ttsCharacters: input.voiceMode === "new_voice" && input.voiceSource === "tts" ? (input.ttsCharacters ?? 0) : 0,
    voiceChange: input.voiceMode === "new_voice" && input.voiceSource === "upload" && input.voiceChange === true,
    lipSyncMode: input.lipSyncMode,
  };
  try {
    return await request("/api/ai/character-replace/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    return { ok: false, code: "NETWORK", error: "You appear to be offline. Try again in a moment." };
  }
}

/* ───────────────────────────── the recharge ──────────────────────────────── */

/**
 * Begin a recharge of THIS wallet. The server validates the amount against
 * the tool's recharge bounds and answers with Paystack's hosted page; the
 * browser navigates there — a full navigation, never a popup — and Paystack
 * returns the member to `returnTo` (allow-listed server-side; anything else
 * becomes the workspace).
 *
 * 🔴 Nothing here credits anything. The credit happens when Paystack's webhook
 * or the verify-on-return route confirms a payment whose purpose is this
 * product's, idempotently on the reference (lib/ai/character-replace/
 * recharge-server.ts). This function only asks for the page.
 */
export async function beginCharacterReplaceTopup(amountCents: number, returnTo: string): Promise<
  CharacterReplaceClientResult<{ url: string }>
> {
  return request("/api/ai/character-replace/topup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ amountCents, returnTo }),
  });
}

/**
 * Finish a recharge the member came back from.
 *
 * Paystack appends `?reference=` (alias `trxref`) to the return URL. The
 * caller reads it ONCE, strips it from the address bar, and hands it here;
 * the server asks Paystack, checks the payment is this member's and that its
 * purpose is this product's, and credits under the same reference the
 * webhook uses — so whichever lands first credits once. `credited` is the
 * wallet moving; `pending` is Paystack still confirming.
 */
export async function verifyCharacterReplaceTopup(reference: string): Promise<
  CharacterReplaceClientResult<{ credited?: boolean; pending?: boolean; product?: string }>
> {
  return request("/api/ai/balance/topup/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reference }),
  });
}

/**
 * Pull a Paystack return reference out of the address bar, if there is one,
 * and remove it so a reload, a bookmark or a back-swipe never re-verifies.
 * Returns the reference, or null when this is an ordinary visit.
 */
export function takeTopupReturnReference(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const reference = params.get("reference") ?? params.get("trxref");
  if (!reference) return null;
  params.delete("reference");
  params.delete("trxref");
  const rest = params.toString();
  const clean = `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", clean);
  return reference;
}
