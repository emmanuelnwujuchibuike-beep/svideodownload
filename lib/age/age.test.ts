import { describe, expect, it } from "vitest";

import { ageOn, birthdayAt, checkBirthDate, evaluateBirthDate, parseIsoDate } from "./age";

const d = (s: string) => parseIsoDate(s)!;

describe("the age check's arithmetic", () => {
  it("reads only real calendar dates", () => {
    expect(parseIsoDate("2008-10-18")).not.toBeNull();
    expect(parseIsoDate("2026-02-30")).toBeNull();
    expect(parseIsoDate("2008-13-01")).toBeNull();
    expect(parseIsoDate("18/10/2008")).toBeNull();
    expect(parseIsoDate(20081018)).toBeNull();
  });

  it("turns 18 on the birthday, not a day before", () => {
    const dob = d("2008-10-18");
    expect(ageOn(dob, d("2026-10-17"))).toBe(17);
    expect(ageOn(dob, d("2026-10-18"))).toBe(18);
    expect(evaluateBirthDate(dob, d("2026-10-17"))).toEqual({ result: "minor", eligibleOn: "2026-10-18" });
    expect(evaluateBirthDate(dob, d("2026-10-18"))).toEqual({ result: "adult" });
  });

  it("a 29 February birthday reaches 18 on 1 March in a common year — never early", () => {
    const dob = d("2008-02-29");
    expect(birthdayAt(dob, 18).toISOString().slice(0, 10)).toBe("2026-03-01");
    expect(ageOn(dob, d("2026-02-28"))).toBe(17);
    expect(evaluateBirthDate(dob, d("2026-02-28"))).toEqual({ result: "minor", eligibleOn: "2026-03-01" });
    expect(evaluateBirthDate(dob, d("2026-03-01"))).toEqual({ result: "adult" });
  });

  it("refuses a date in the future and an impossible age", () => {
    const today = d("2026-10-18");
    expect(checkBirthDate("2026-10-19", today)).toEqual({ ok: false, problem: "future" });
    expect(checkBirthDate("1890-01-01", today)).toEqual({ ok: false, problem: "too_old" });
    expect(checkBirthDate("", today)).toEqual({ ok: false, problem: "invalid" });
    expect(checkBirthDate("1990-05-04", today).ok).toBe(true);
  });
});
