import { describe, expect, it } from "vitest";

import { parseVisionAnswer } from "./vision";

/** The vision layer's answer is an INPUT to the decision engine — so what it says must be exactly shaped, or ignored. */
describe("preflight vision — parsing the model's answer", () => {
  const good = { usable: true, confidence: 0.86, subjectType: "full_body", faceVisibility: "clear", bodyVisibility: "sufficient", obstruction: "low", recommendation: "pass" };
  it("a bare JSON object, or one wrapped in prose or a code fence, is read; the confidence is clamped", () => {
    expect(parseVisionAnswer(JSON.stringify(good))).toEqual(good);
    expect(parseVisionAnswer("Sure — here is the judgement:\n```json\n" + JSON.stringify({ ...good, confidence: 1.4 }) + "\n```")).toEqual({ ...good, confidence: 1 });
  });
  it("🔴 a missing or invented value is a null answer, never a guess", () => {
    expect(parseVisionAnswer("I think it is fine.")).toBeNull();
    expect(parseVisionAnswer(JSON.stringify({ ...good, usable: "yes" }))).toBeNull();
    expect(parseVisionAnswer(JSON.stringify({ ...good, subjectType: "torso" }))).toBeNull();
    expect(parseVisionAnswer(JSON.stringify({ ...good, recommendation: "maybe" }))).toBeNull();
    expect(parseVisionAnswer(JSON.stringify({ ...good, confidence: "high" }))).toBeNull();
    expect(parseVisionAnswer("{ not json")).toBeNull();
  });
});
