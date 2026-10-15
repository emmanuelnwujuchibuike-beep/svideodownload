import { NextResponse } from "next/server";
import { z } from "zod";

import { LANGUAGES } from "@/lib/i18n/languages";
import { MAX_STRING_LENGTH, MAX_STRINGS_PER_REQUEST, translateTexts } from "@/lib/i18n/machine-translate";
import { clientId, translateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/i18n/translate { lang, texts } → { translations } — the page translator's server
 * (lib/i18n/machine-translate.ts). Same length and order as `texts`. Never fails the page:
 * anything it cannot translate comes back as sent.
 */
const bodySchema = z.object({
  lang: z.string().min(2).max(8),
  texts: z.array(z.string().max(MAX_STRING_LENGTH)).min(1).max(MAX_STRINGS_PER_REQUEST),
});

export async function POST(request: Request) {
  const { success, reset } = await translateLimiter.limit(clientId(request.headers));
  if (!success) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((reset - Date.now()) / 1000))) } });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { lang, texts } = parsed.data;
  const language = LANGUAGES.find((l) => l.code === lang.toLowerCase());
  // English (the source) and anything not in the picker is answered as sent
  if (!language || language.code === "en") return NextResponse.json({ translations: texts });
  const translations = await translateTexts(language.code, language.name, texts);
  return NextResponse.json({ translations }, { headers: { "Cache-Control": "no-store" } });
}
