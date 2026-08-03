/**
 * Profile Export™ — the digital contact card (Feature 18 · Part 14).
 *
 * vCard 3.0, hand-built. No dependency: the format is a dozen lines of text,
 * and 3.0 (rather than 4.0) is what iOS Contacts, Android and Outlook all
 * import without complaint.
 *
 * ── Escaping is a correctness requirement, not politeness ─────────────────
 * A vCard is line-based and comma/semicolon-delimited. A member whose company
 * is "Smith, Jones & Co." or whose bio contains a newline would otherwise
 * produce a file that silently truncates or mis-parses in the importing app.
 * Every value goes through `esc`.
 *
 * Pure: no React, no Supabase, no I/O.
 */

export interface VCardInput {
  displayName: string;
  handle: string;
  headline: string | null;
  organization: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  note: string | null;
  profileUrl: string;
  avatarUrl: string | null;
}

/** Escapes a vCard text value (RFC 2426 §2.4.2) and strips control chars. */
function esc(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    // A stray CR would end the line early in a strict parser.
    .replace(/\r/g, "");
}

/**
 * Splits a display name into vCard's structured N field as well as it can be
 * done. Deliberately simple: for a one-word name (or a business) the whole
 * thing is the family name, which is what importers show. Guessing harder —
 * middle names, particles, honorifics — gets more names wrong, not fewer.
 */
function structuredName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  if (parts.length === 1) return `${esc(parts[0]!)};;;;`;
  const last = parts.pop()!;
  return `${esc(last)};${esc(parts.join(" "))};;;`;
}

export function buildVCard(input: VCardInput): string {
  const lines = ["BEGIN:VCARD", "VERSION:3.0"];

  lines.push(`N:${structuredName(input.displayName)}`);
  lines.push(`FN:${esc(input.displayName)}`);
  if (input.organization) lines.push(`ORG:${esc(input.organization)}`);
  if (input.headline) lines.push(`TITLE:${esc(input.headline)}`);
  if (input.email) lines.push(`EMAIL;TYPE=INTERNET:${esc(input.email)}`);
  if (input.phone) lines.push(`TEL;TYPE=CELL:${esc(input.phone)}`);
  if (input.website) lines.push(`URL:${esc(input.website)}`);
  // The profile itself is always a URL on the card — it is the one address
  // that stays correct when everything else changes.
  lines.push(`URL:${esc(input.profileUrl)}`);
  if (input.avatarUrl) lines.push(`PHOTO;VALUE=URI:${esc(input.avatarUrl)}`);

  if (input.address || input.city || input.country) {
    // ADR is ;-delimited: PO box; extended; street; locality; region; postcode; country
    lines.push(
      `ADR;TYPE=WORK:;;${esc(input.address ?? "")};${esc(input.city ?? "")};;;${esc(input.country ?? "")}`,
    );
  }

  lines.push(`NICKNAME:${esc(`@${input.handle}`)}`);
  if (input.note) lines.push(`NOTE:${esc(input.note)}`);
  lines.push(`REV:${new Date().toISOString()}`);
  lines.push("END:VCARD");

  // CRLF is what the spec requires and what strict importers expect.
  return `${lines.join("\r\n")}\r\n`;
}

/** A safe, recognisable download filename for this handle. */
export function vCardFilename(handle: string): string {
  const safe = handle.replace(/[^a-z0-9_-]/gi, "") || "contact";
  return `${safe}.vcf`;
}
