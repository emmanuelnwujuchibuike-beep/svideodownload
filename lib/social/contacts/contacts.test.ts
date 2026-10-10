import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FOLLOW_SOURCES } from "@/lib/social/follow-policy";

import { hashEmail } from "./hash";
import { inviteHref, MATCH_BATCH, MATCH_DAILY_CAP, mergeContacts, normalizeEmail, normalizePhone, parseCsv, parsePastedContacts, parseVcf } from "./normalize";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const M = () => src("supabase/migrations/0220_contact_discovery.sql");

describe("Contact Discovery: the device and the database hash the SAME thing", () => {
  it("hashEmail = SHA-256 of lower(trim(address)), exactly what 0220 computes for a member", async () => {
    const sqlSide = createHash("sha256").update("amaka@mail.com").digest("hex");
    expect(await hashEmail("  Amaka@Mail.COM ")).toBe(sqlSide);
    // teeth: a different normalisation would not match
    expect(await hashEmail("amaka@mail.com.")).not.toBe(sqlSide);
    // and the SQL really normalises that way, in the trigger and the backfill
    expect(M()).toContain("sha256(convert_to(lower(trim(new.email)), 'UTF8'))");
    expect(M()).toContain("sha256(convert_to(lower(trim(u.email)), 'UTF8'))");
    expect(normalizeEmail(" A@B.Co ")).toBe("a@b.co");
  });

  it("only hashes leave the device - the route accepts nothing else, and the page sends nothing else", () => {
    const route = src("app/api/contacts/match/route.ts");
    expect(route).toContain("z.string().regex(/^[0-9a-f]{64}$/)");
    expect(route).toContain(".strict()");
    const page = src("features/friends/contacts.tsx");
    expect(page).toContain("JSON.stringify({ hashes: batch, remember })");
    expect(page).not.toMatch(/JSON\.stringify\(\{[^}]*(emails|phones|name)/);
  });

  it("the batch and daily caps on the device are the database's own", () => {
    expect(M()).toContain(`if v_n > ${MATCH_BATCH} then`);
    expect(M()).toContain(`if v_used > ${MATCH_DAILY_CAP} then`);
  });

  it("privacy, blocks and confirmation are enforced in the database, not the page", () => {
    const m = M();
    expect(m).toContain("where public.contact_findable(v_uid, k.user_id)");
    expect(m).toContain("when 'nobody' then false");
    expect(m).toContain("if new.email is not null and new.email_confirmed_at is not null then");
    expect(m).toContain("from public.blocks b");
    // saved matches are re-checked on every read
    expect(m).toMatch(/my_contact_matches[\s\S]*public\.contact_findable\(auth\.uid\(\), c\.matched_id\)/);
    // nobody but the database reads the keys or the secret
    expect(m).toContain("revoke all on public.contact_match_keys from public, anon, authenticated");
    expect(m).toContain("revoke all on public.contact_private_settings from public, anon, authenticated");
  });

  it("the follow source list is the database's own (follows_source_chk)", () => {
    const sqlList = M().match(/follows_source_chk\s+check \(source is null or source in \(([^)]*)\)\)/)?.[1];
    expect(sqlList?.split(",").map((s) => s.trim().replace(/'/g, ""))).toEqual([...FOLLOW_SOURCES]);
  });
});

describe("reading contacts on the device", () => {
  it("pasted text: names in angle brackets, mixed separators, phones, junk ignored, duplicates merged", () => {
    const out = parsePastedContacts(`Chris Obi <Chris@x.com>, amaka@mail.com; not-an-address\n+234 801 234 5678\nCHRIS@x.com`);
    expect(out.map((c) => c.key)).toEqual(["chris@x.com", "amaka@mail.com", "+2348012345678"]);
    expect(out[0]!.name).toBe("Chris Obi");
  });

  it("vCard: folded lines, several addresses, a card with only a number, a card with nothing usable", () => {
    const vcf = [
      "BEGIN:VCARD", "VERSION:3.0", "FN:Zainab Lawal", "EMAIL;TYPE=HOME:zainab@x.com", "item1.EMAIL;TYPE=INTERNET:z.work@", " x.com", "TEL;TYPE=CELL:0803 111 2222", "END:VCARD",
      "BEGIN:VCARD", "VERSION:3.0", "N:Bello;Tunde;;;", "TEL:+44 7700 900123", "END:VCARD",
      "BEGIN:VCARD", "VERSION:3.0", "FN:Nothing Here", "END:VCARD",
    ].join("\r\n");
    const out = parseVcf(vcf);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ name: "Zainab Lawal", emails: ["zainab@x.com", "z.work@x.com"], phones: ["08031112222"] });
    expect(out[1]).toMatchObject({ name: "Tunde Bello", emails: [], phones: ["+447700900123"] });
  });

  it("CSV: Google's export (quoted cells, ' ::: ' multi-values) and a plain sheet", () => {
    const google = 'Name,Given Name,E-mail 1 - Type,E-mail 1 - Value,Phone 1 - Value\n"Okafor, Ifeanyi",Ifeanyi,* Home,ife@x.com ::: ife.work@x.com,+234 802 000 0000\n';
    const g = parseCsv(google);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ name: "Okafor, Ifeanyi", emails: ["ife@x.com", "ife.work@x.com"], phones: ["+2348020000000"] });
    const sheet = parseCsv("First Name,Last Name,Email\nGrace,Adeyemi,grace@x.com\n,,\n");
    expect(sheet).toEqual([{ key: "grace@x.com", name: "Grace Adeyemi", emails: ["grace@x.com"], phones: [] }]);
  });

  it("merging: the same person from two sources is one entry (Contact Health's duplicates)", () => {
    const merged = mergeContacts([...parsePastedContacts("a@x.com"), ...parseVcf("BEGIN:VCARD\nFN:Ada\nEMAIL:A@x.com\nTEL:+1 555 0100 222\nEND:VCARD")]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ name: "Ada", emails: ["a@x.com"], phones: ["+15550100222"] });
  });

  it("phones: E.164 length only, 00 becomes +", () => {
    expect(normalizePhone("00 44 7700 900123")).toBe("+447700900123");
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("1234567890123456")).toBeNull();
  });
});

describe("invites are links the device opens - Frenz sends nothing", () => {
  const c = { emails: ["amaka@mail.com"], phones: ["+2348012345678"] };
  it("each channel addresses the contact and carries the attribution link", () => {
    const link = "https://frenzsave.com/r/abc123";
    expect(inviteHref("email", c, link, "Emeka")).toMatch(/^mailto:amaka%40mail\.com\?subject=.*body=.*r%2Fabc123/);
    expect(inviteHref("sms", c, link, null)).toMatch(/^sms:\+2348012345678\?&body=.*r%2Fabc123/);
    expect(inviteHref("whatsapp", c, link, null)).toMatch(/^https:\/\/wa\.me\/2348012345678\?text=/);
    expect(inviteHref("telegram", c, link, null)).toContain("t.me/share/url?url=https%3A%2F%2Ffrenzsave.com%2Fr%2Fabc123");
  });
  it("teeth: no address, no e-mail invite - no number, no SMS", () => {
    expect(inviteHref("email", { emails: [], phones: ["+15550100222"] }, "x", null)).toBeNull();
    expect(inviteHref("sms", { emails: ["a@x.com"], phones: [] }, "x", null)).toBeNull();
  });
});
