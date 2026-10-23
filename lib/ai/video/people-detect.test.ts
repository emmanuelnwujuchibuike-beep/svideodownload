import { describe, expect, it } from "vitest";

import { chooseInspectionFrame, normalizePeople, parseFfprobe, parseFrameRate, peopleCountsVary, PEOPLE_DETECTION, type SampledFrame } from "./people-detect";

/** The rules people-detect.ts says are asserted here — each with a case that fails on a bad fixture. */

const W = 1280;
const H = 720;
const det = (x: number, w: number, h = 400, score = 0.9) => ({ score, box: { x, y: 100, w, h } });
const frame = (positionMs: number, people: SampledFrame["people"]): SampledFrame => ({ positionMs, width: W, height: H, people });

describe("ffprobe", () => {
  it("reads fractional and plain frame rates, and refuses junk", () => {
    expect(parseFrameRate("30000/1001")).toBe(29.97);
    expect(parseFrameRate("25")).toBe(25);
    expect(parseFrameRate("0/0")).toBeNull();
    expect(parseFrameRate(undefined)).toBeNull();
    expect(parseFrameRate("abc")).toBeNull();
  });

  it("🔴 a portrait phone clip (coded landscape + 90° rotation) is reported as DISPLAYED", () => {
    const p = parseFfprobe({
      streams: [{ codec_type: "video", width: 1920, height: 1080, avg_frame_rate: "30/1", side_data_list: [{ rotation: -90 }] }, { codec_type: "audio" }],
      format: { duration: "5.04", format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
    })!;
    expect([p.facts.width, p.facts.height]).toEqual([1080, 1920]);
    expect(p.facts.durationMs).toBe(5040);
    expect(p.facts.fps).toBe(30);
    expect(p.hasAudio).toBe(true);
  });

  it("an unrotated clip keeps its size; no video stream is null", () => {
    const p = parseFfprobe({ streams: [{ codec_type: "video", width: 1280, height: 720, r_frame_rate: "24/1" }], format: { duration: "3" } })!;
    expect([p.facts.width, p.facts.height]).toEqual([1280, 720]);
    expect(p.hasAudio).toBe(false);
    expect(parseFfprobe({ streams: [{ codec_type: "audio" }] })).toBeNull();
    expect(parseFfprobe(null)).toBeNull();
  });
});

describe("who is tappable", () => {
  it("keeps confident, visible people, as fractions, ids p1…pN left to right", () => {
    const people = normalizePeople(frame(0, [det(900, 160), det(100, 160), det(500, 160, 400, 0.2)]));
    expect(people.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(people[0]!.box.x).toBeCloseTo(100 / W, 3);
    expect(people[1]!.box.x).toBeCloseTo(900 / W, 3);
  });

  it("🔴 drops a speck in the background, and clips a box that runs off the frame", () => {
    const tiny = PEOPLE_DETECTION.minHeightFrac * H * 0.5;
    expect(normalizePeople(frame(0, [det(100, 40, tiny)]))).toEqual([]);
    const [edge] = normalizePeople(frame(0, [{ score: 0.9, box: { x: 1200, y: 300, w: 200, h: 600 } }]));
    expect(edge!.box.x + edge!.box.w).toBeLessThanOrEqual(1);
    expect(edge!.box.y + edge!.box.h).toBeLessThanOrEqual(1);
  });

  it("keeps the biggest people when there are too many", () => {
    const many = Array.from({ length: PEOPLE_DETECTION.maxPeople + 3 }, (_, i) => det(i * 80, 60, i === 0 ? 700 : 200));
    const people = normalizePeople(frame(0, many));
    expect(people).toHaveLength(PEOPLE_DETECTION.maxPeople);
    // the tallest one (x = 0) survived the cut
    // its box runs from y=100 past the bottom, so it is clipped to the frame: (720 - 100) / 720
    expect(people[0]!.box.h).toBeCloseTo((H - 100) / H, 3);
  });

  it("an unsized frame has nobody on it", () => {
    expect(normalizePeople({ positionMs: 0, width: 0, height: 0, people: [det(100, 160)] })).toEqual([]);
  });
});

describe("the frame the member picks on", () => {
  it("is the one with the MOST people, the earliest on a tie", () => {
    const frames = [frame(4000, [det(100, 160), det(600, 160)]), frame(1000, [det(100, 160)]), frame(2500, [det(100, 160), det(600, 160)])];
    const chosen = chooseInspectionFrame(frames)!;
    expect(chosen.frame.positionMs).toBe(2500);
    expect(chosen.people).toHaveLength(2);
    expect(chooseInspectionFrame([])).toBeNull();
  });

  it("notices people walking in or out", () => {
    expect(peopleCountsVary([frame(0, [det(100, 160)]), frame(1, [det(100, 160), det(600, 160)])])).toBe(true);
    expect(peopleCountsVary([frame(0, [det(100, 160)]), frame(1, [det(120, 160)])])).toBe(false);
  });
});
