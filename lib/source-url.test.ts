import { describe, expect, it } from "vitest";

import { checkSourceUrl } from "@/lib/source-url";
import { sourceUrlSchema } from "@/lib/validation";

/*
  The paste box checks a link with `checkSourceUrl` (no zod, 2026-10-26); the server checks it with
  `sourceUrlSchema`. They must agree on every link — the verdict, the trimmed value and the message.
*/
const CASES = [
  "https://www.tiktok.com/@a/video/1",
  "  https://vm.tiktok.com/abc/  ",
  "http://instagram.com/p/x",
  "",
  "   ",
  "not a url",
  "ftp://example.com/file",
  "javascript:alert(1)",
  "http://localhost:3000/x",
  "http://127.0.0.1/x",
  "http://10.0.0.5/x",
  "http://192.168.1.1/",
  "http://172.20.1.1/",
  "http://169.254.169.254/latest/meta-data",
  "http://[::1]/",
  "http://printer.local/",
  "https://example.com/" + "a".repeat(2100),
];

describe("checkSourceUrl agrees with sourceUrlSchema", () => {
  for (const input of CASES) {
    it(JSON.stringify(input.slice(0, 50)), () => {
      const schema = sourceUrlSchema.safeParse(input);
      const plain = checkSourceUrl(input);
      expect(plain.ok).toBe(schema.success);
      if (plain.ok && schema.success) expect(plain.url).toBe(schema.data);
      if (!plain.ok && !schema.success) expect(plain.message).toBe(schema.error.issues[0]?.message);
    });
  }

  it("the comparison has teeth: a looser check would disagree", () => {
    const loose = (s: string) => /^https?:\/\//.test(s.trim());
    expect(loose("http://127.0.0.1/x")).not.toBe(sourceUrlSchema.safeParse("http://127.0.0.1/x").success);
  });
});
