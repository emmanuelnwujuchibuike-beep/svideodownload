import "server-only";

import { createHash } from "node:crypto";

import { cacheGet, cacheSet } from "@/lib/cache";

/**
 * Whole-page translation, server half (owner, 2026-10-15: "the language translator is not
 * working, only on language showed in a few sections, I want all language to change in
 * everything that has text that is translatable").
 *
 * 🔴 THE ENGINE IS GOOGLE'S FREE WEB TRANSLATOR — NO API KEY (owner, 2026-10-31: "Don't use
 * anthropic … I made translator on my other app project without any API key"). The model it
 * replaced needed ANTHROPIC_API_KEY, which production does not carry, so every string came back
 * in English and changing the language changed nothing. Google's public endpoint
 * (translate.googleapis.com, client=gtx) answers a whole screen's strings in one request.
 *
 * The catalogues and their human-reviewed pipeline (scripts/i18n.mjs) are untouched and still
 * win wherever they have a string. Each distinct string is translated ONCE per language and
 * cached for everyone (`mt:v1:<lang>:<sha1>`, 180 days), so Google is asked only for text nobody
 * has seen in that language yet — which also keeps the unofficial endpoint's rate limit far away.
 * A failure returns the English, never an error on the page.
 */

const TTL_SECONDS = 180 * 24 * 3600;
const GOOGLE_URL = "https://translate.googleapis.com/translate_a/t";
const REQUEST_TIMEOUT_MS = 8000;
/** strings per request — a page's worth */
const CHUNK = 60;
/** characters per request (after protection markup) — the free endpoint answers a few thousand at a time */
const CHUNK_CHARS = 4500;

export const MAX_STRINGS_PER_REQUEST = 120;
export const MAX_STRING_LENGTH = 1000;

const key = (lang: string, text: string) => `mt:v1:${lang}:${createHash("sha1").update(text).digest("hex")}`;

/** Google's code where it differs from ours (lib/i18n/languages.ts). */
const GOOGLE_CODE: Record<string, string> = { zh: "zh-CN", he: "iw", fil: "tl" };
export const googleLang = (code: string): string => GOOGLE_CODE[code] ?? code;

/**
 * Never translated: the brand, platform and product names, {placeholders}, @handles, #tags,
 * URLs and e-mail addresses. Measured 2026-10-31: into Chinese, Google turned "Frenz" into 弗伦兹
 * and "{name}" into {名字}. Wrapped in translate="no" (format=html), Google returns them as they were.
 */
const KEEP = new RegExp(
  [
    String.raw`\{[^{}\s]{1,40}\}`,
    String.raw`https?:\/\/\S+`,
    String.raw`\b\S+@\S+\.\S+\b`,
    String.raw`(?<![\w@#])[@#][\p{L}\p{N}_.]{1,40}`,
    String.raw`\b(?:Frenzsave|Frenz|TikTok|Instagram|YouTube|Facebook|Snapchat|Pinterest|WhatsApp|Telegram|Threads|Twitter|Vimeo|Paystack|Flutterwave|Kling|Claude|Google|Apple|Android|iPhone)\b`,
  ].join("|"),
  "gu",
);

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** One string as Google's HTML input: escaped, with the parts to keep wrapped in translate="no". */
export function protectForGoogle(text: string): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(KEEP)) {
    out += escapeHtml(text.slice(last, m.index));
    out += `<span translate="no">${escapeHtml(m[0])}</span>`;
    last = m.index! + m[0].length;
  }
  return out + escapeHtml(text.slice(last));
}

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Google's HTML answer back to plain text: the kept parts unwrapped, entities decoded. */
export function restoreFromGoogle(html: string): string {
  return html
    .replace(/<span translate="no">([\s\S]*?)<\/span>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ent: string) => {
      if (ent[0] === "#") {
        const n = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
      }
      return ENTITY[ent.toLowerCase()] ?? whole;
    });
}

/** One request for a chunk of strings. Null when the answer cannot be trusted (an error, a wrong count). */
async function translateChunk(lang: string, texts: string[]): Promise<string[] | null> {
  const body = new URLSearchParams();
  for (const t of texts) body.append("q", protectForGoogle(t));
  try {
    const res = await fetch(`${GOOGLE_URL}?client=gtx&sl=en&tl=${encodeURIComponent(googleLang(lang))}&format=html`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn("[i18n/mt] google answered", res.status);
      return null;
    }
    const data: unknown = await res.json();
    // one entry per string, in order: a string, or a [translation, source language] pair on some answers
    const list = Array.isArray(data) ? data : [data];
    const out = list.map((x) => (typeof x === "string" ? x : Array.isArray(x) && typeof x[0] === "string" ? x[0] : null));
    if (out.length !== texts.length || out.some((x) => x === null)) return null;
    return out.map((t, i) => {
      const plain = restoreFromGoogle(t!).trim();
      return plain ? plain : texts[i]!;
    });
  } catch (err) {
    console.error("[i18n/mt] failed", { message: (err as Error).message });
    return null;
  }
}

/** Chunks by count AND by characters, so a page of long strings still fits one request each. */
function chunk(texts: string[]): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let chars = 0;
  for (const t of texts) {
    const size = protectForGoogle(t).length;
    if (cur.length && (cur.length >= CHUNK || chars + size > CHUNK_CHARS)) {
      out.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(t);
    chars += size;
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Translate `texts` into `lang`. Same length and order as the input; anything that could not
 * be translated comes back as the original. Duplicates are translated once. (`langName` is kept
 * for the callers; Google needs only the code.)
 */
export async function translateTexts(lang: string, _langName: string, texts: string[]): Promise<string[]> {
  const unique = [...new Set(texts)];
  const done = new Map<string, string>();
  const cached = await Promise.all(unique.map((t) => cacheGet<string>(key(lang, t))));
  const missing: string[] = [];
  unique.forEach((t, i) => {
    const hit = cached[i];
    if (typeof hit === "string") done.set(t, hit);
    else missing.push(t);
  });

  const chunks = chunk(missing);
  const results = await Promise.all(chunks.map((ch) => translateChunk(lang, ch)));
  const writes: Promise<void>[] = [];
  chunks.forEach((ch, ci) => {
    const out = results[ci];
    if (!out) return; // not cached: the next visitor tries again
    ch.forEach((t, i) => {
      done.set(t, out[i]!);
      writes.push(cacheSet(key(lang, t), out[i]!, TTL_SECONDS));
    });
  });
  await Promise.all(writes).catch(() => undefined);
  return texts.map((t) => done.get(t) ?? t);
}
