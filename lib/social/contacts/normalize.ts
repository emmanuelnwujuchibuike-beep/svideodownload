/**
 * Contact Discovery (Feature 19 · Part 5) — everything that happens to a
 * contact ON THE DEVICE. Pure and dependency-free, so it runs in the browser
 * and is tested here.
 *
 * A contact never leaves the device. What leaves is, per e-mail address, the
 * SHA-256 of `normalizeEmail(address)`, and the database computes the SAME
 * hash of each member's confirmed address (`lower(trim(email))` in migration
 * 0220). The two normalisations must agree, and contacts.test.ts holds them
 * together.
 *
 * Phone numbers are read so that an invite can be addressed by SMS or
 * WhatsApp, and are never hashed or sent: Frenz has no verified phone numbers
 * to match against (see the 0220 header).
 */

export interface DeviceContact {
  /** A stable local key (the first e-mail, else the first phone, else the name). */
  key: string;
  name: string;
  emails: string[];
  phones: string[];
}

/** The ONE normalisation, mirrored by `lower(trim(email))` in SQL. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@<>()[\]",;:]+@[^\s@<>()[\]",;:]+\.[a-z]{2,}$/i;

export function isEmail(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}

/** Digits and one leading +, 7–15 digits (E.164 length). Used only to address an SMS or WhatsApp invite. */
export function normalizePhone(raw: string): string | null {
  const t = raw.trim();
  const digits = t.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return (t.startsWith("+") || t.startsWith("00") ? "+" : "") + (t.startsWith("00") ? digits.slice(2) : digits);
}

function contact(name: string, emails: string[], phones: string[]): DeviceContact | null {
  const e = [...new Set(emails.filter(isEmail).map(normalizeEmail))];
  const p = [...new Set(phones.map(normalizePhone).filter((x): x is string => !!x))];
  if (!e.length && !p.length) return null;
  const label = name.trim() || e[0] || p[0]!;
  return { key: e[0] ?? p[0] ?? label, name: label, emails: e, phones: p };
}

/** Free text a member pasted: addresses and numbers separated by commas, semicolons or new lines. "Name <a@b.c>" keeps the name. */
export function parsePastedContacts(text: string): DeviceContact[] {
  const out: DeviceContact[] = [];
  for (const part of text.split(/[\n,;]+/)) {
    const s = part.trim();
    if (!s) continue;
    const angle = s.match(/^(.*?)<([^>]+)>$/);
    if (angle) {
      const c = contact(angle[1]!.replace(/"/g, ""), [angle[2]!], []);
      if (c) out.push(c);
      continue;
    }
    const c = isEmail(s) ? contact("", [s], []) : contact("", [], [s]);
    if (c) out.push(c);
  }
  return mergeContacts(out);
}

/** A .vcf (vCard 2.1/3.0/4.0) export from a phone or Google/Apple/Outlook Contacts. */
export function parseVcf(text: string): DeviceContact[] {
  const out: DeviceContact[] = [];
  // unfold continuation lines (RFC 6350 §3.2)
  const lines = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  let name = "";
  let emails: string[] = [];
  let phones: string[] = [];
  let inCard = false;
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith("BEGIN:VCARD")) {
      inCard = true;
      name = "";
      emails = [];
      phones = [];
    } else if (upper.startsWith("END:VCARD")) {
      if (inCard) {
        const c = contact(name, emails, phones);
        if (c) out.push(c);
      }
      inCard = false;
    } else if (inCard) {
      const at = line.indexOf(":");
      if (at < 0) continue;
      const prop = upper.slice(0, at).split(";")[0]!.split(".").pop()!;
      const value = line.slice(at + 1).trim();
      if (prop === "FN") name = value.replace(/\\,/g, ",");
      else if (prop === "N" && !name) name = value.split(";").slice(0, 2).reverse().filter(Boolean).join(" ");
      else if (prop === "EMAIL") emails.push(value);
      else if (prop === "TEL") phones.push(value.replace(/^tel:/i, ""));
    }
  }
  return mergeContacts(out);
}

/** A CSV export (Google Contacts, Outlook, a spreadsheet): any column whose header mentions e-mail, phone or name. */
export function parseCsv(text: string): DeviceContact[] {
  const rows = csvRows(text);
  const head = rows.shift()?.map((h) => h.toLowerCase()) ?? [];
  const emailCols = head.flatMap((h, i) => (/e-?mail/.test(h) && !/type|label/.test(h) ? [i] : []));
  const phoneCols = head.flatMap((h, i) => (/phone|mobile|tel/.test(h) && !/type|label/.test(h) ? [i] : []));
  const nameCol = head.findIndex((h) => h === "name" || h === "display name" || h === "full name");
  const firstCol = head.findIndex((h) => h === "first name" || h === "given name");
  const lastCol = head.findIndex((h) => h === "last name" || h === "family name");
  const out: DeviceContact[] = [];
  for (const r of rows) {
    const name = nameCol >= 0 ? r[nameCol] ?? "" : [r[firstCol] ?? "", r[lastCol] ?? ""].join(" ");
    // Google puts several values in one cell separated by " ::: "
    const split = (cols: number[]) => cols.flatMap((i) => (r[i] ?? "").split(/\s*:::\s*/));
    const c = contact(name, split(emailCols), split(phoneCols));
    if (c) out.push(c);
  }
  return mergeContacts(out);
}

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

/** One person per address: two entries sharing an e-mail (or, with no e-mail, a phone) merge. Contact Health's "duplicates". */
export function mergeContacts(list: DeviceContact[]): DeviceContact[] {
  const byKey = new Map<string, DeviceContact>();
  const index = new Map<string, string>();
  for (const c of list) {
    const ids = [...c.emails.map((e) => "e:" + e), ...c.phones.map((p) => "p:" + p)];
    const hit = ids.map((i) => index.get(i)).find(Boolean);
    if (hit) {
      const into = byKey.get(hit)!;
      into.emails = [...new Set([...into.emails, ...c.emails])];
      into.phones = [...new Set([...into.phones, ...c.phones])];
      if ((!into.name || into.name === into.key) && c.name !== c.key) into.name = c.name;
      for (const i of ids) index.set(i, hit);
    } else {
      byKey.set(c.key, { ...c });
      for (const i of ids) index.set(i, c.key);
    }
  }
  return [...byKey.values()];
}

/** How many entries merged away — Contact Health's duplicate count, from the device's own list. */
export function duplicateCount(before: number, after: DeviceContact[]): number {
  return Math.max(0, before - after.length);
}

/** The invite channels the brief lists. Every one is a link the DEVICE opens, so nothing is sent by Frenz and no contact reaches a server. */
export type InviteChannel = "email" | "sms" | "whatsapp" | "telegram";

export function inviteMessage(link: string, fromName: string | null): string {
  return `${fromName ? `${fromName} invited you to Frenz` : "Join me on Frenz"}: save videos, share moments and keep up with friends. ${link}`;
}

export function inviteHref(channel: InviteChannel, c: Pick<DeviceContact, "emails" | "phones">, link: string, fromName: string | null): string | null {
  const msg = inviteMessage(link, fromName);
  const phone = c.phones[0];
  switch (channel) {
    case "email":
      return c.emails[0] ? `mailto:${encodeURIComponent(c.emails[0])}?subject=${encodeURIComponent("Join me on Frenz")}&body=${encodeURIComponent(msg)}` : null;
    case "sms":
      // `?&body=` is read by both iOS and Android
      return phone ? `sms:${phone}?&body=${encodeURIComponent(msg)}` : null;
    case "whatsapp":
      return phone ? `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    case "telegram":
      return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(msg.replace(` ${link}`, ""))}`;
  }
}

/** At most this many hashes per request (the database refuses more — migration 0220). */
export const MATCH_BATCH = 500;
/** And this many per member per UTC day. */
export const MATCH_DAILY_CAP = 2000;
