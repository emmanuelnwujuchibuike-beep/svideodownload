import { describe, expect, it } from "vitest";

import { buildVCard, vCardFilename, type VCardInput } from "@/lib/profile/vcard";

const base: VCardInput = {
  displayName: "Ada Lovelace",
  handle: "ada",
  headline: null,
  organization: null,
  email: null,
  phone: null,
  website: null,
  address: null,
  city: null,
  country: null,
  note: null,
  profileUrl: "https://frenzsave.com/u/ada",
  avatarUrl: null,
};

const lines = (input: Partial<VCardInput> = {}) => buildVCard({ ...base, ...input }).split("\r\n");

describe("buildVCard", () => {
  it("opens and closes a valid vCard 3.0", () => {
    const out = lines();
    expect(out[0]).toBe("BEGIN:VCARD");
    expect(out[1]).toBe("VERSION:3.0");
    expect(out.filter(Boolean).at(-1)).toBe("END:VCARD");
  });

  it("uses CRLF line endings, as the spec requires", () => {
    expect(buildVCard(base)).toContain("\r\n");
    expect(buildVCard(base).split("\n").every((l) => l === "" || l.endsWith("\r"))).toBe(true);
  });

  it("splits a two-part name into family;given", () => {
    expect(lines()).toContain("N:Lovelace;Ada;;;");
    expect(lines()).toContain("FN:Ada Lovelace");
  });

  it("puts a single-word or business name in the family slot", () => {
    expect(lines({ displayName: "Frenzsave" })).toContain("N:Frenzsave;;;;");
  });

  it("always carries the profile URL, even with nothing else filled in", () => {
    expect(lines()).toContain("URL:https://frenzsave.com/u/ada");
  });

  it("escapes commas and semicolons so the card can't mis-parse", () => {
    const out = lines({ organization: "Smith, Jones & Co.; Ltd" });
    expect(out).toContain("ORG:Smith\\, Jones & Co.\\; Ltd");
  });

  it("escapes newlines in a bio into the literal \\n vCard sequence", () => {
    const out = buildVCard({ ...base, note: "Line one\nLine two" });
    expect(out).toContain("NOTE:Line one\\nLine two");
    // The raw newline must NOT survive — it would end the NOTE line early.
    expect(out).not.toContain("NOTE:Line one\nLine two");
  });

  it("escapes backslashes before anything else", () => {
    expect(lines({ note: "back\\slash" })).toContain("NOTE:back\\\\slash");
  });

  it("strips carriage returns that would truncate a line", () => {
    expect(buildVCard({ ...base, note: "a\rb" })).toContain("NOTE:ab");
  });

  it("omits fields that aren't set rather than emitting empty ones", () => {
    const out = lines();
    expect(out.some((l) => l.startsWith("EMAIL"))).toBe(false);
    expect(out.some((l) => l.startsWith("TEL"))).toBe(false);
    expect(out.some((l) => l.startsWith("ADR"))).toBe(false);
    expect(out.some((l) => l.startsWith("ORG"))).toBe(false);
  });

  it("emits contact fields when they are set", () => {
    const out = lines({ email: "ada@example.com", phone: "+234 800 000 0000", city: "Lagos", country: "Nigeria" });
    expect(out).toContain("EMAIL;TYPE=INTERNET:ada@example.com");
    expect(out).toContain("TEL;TYPE=CELL:+234 800 000 0000");
    expect(out).toContain("ADR;TYPE=WORK:;;;Lagos;;;Nigeria");
  });
});

describe("vCardFilename", () => {
  it("keeps a normal handle", () => {
    expect(vCardFilename("ada_love")).toBe("ada_love.vcf");
  });

  it("strips anything that could escape the filename", () => {
    expect(vCardFilename("../../etc/passwd")).toBe("etcpasswd.vcf");
    expect(vCardFilename('a"b')).toBe("ab.vcf");
  });

  it("falls back rather than producing a nameless file", () => {
    expect(vCardFilename("...")).toBe("contact.vcf");
  });
});
