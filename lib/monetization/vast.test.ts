import { describe, expect, it } from "vitest";

import {
  exoClickVastUrl,
  parseVast,
  parseVastDuration,
  parseVastOffset,
  vastWrapperUrl,
} from "./vast";

/**
 * VAST reading — the pipeline the ExoClick work was missing.
 *
 * The first implementation rendered ExoClick's `<ins>` display tag. The owner's
 * zone is a VIDEO zone answering on `vast.php`, so the provider script loaded,
 * matched no placeholder, and rendered nothing with no error anywhere. These
 * cases are built from the REAL response that zone returned, so the shape being
 * parsed is the shape actually served rather than one from the spec.
 */

/** Trimmed from the live `vast.php?idzone=6015286` response (2026-08-30). */
const LIVE = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="3.0">
  <Ad id="8539462">
    <InLine>
      <AdSystem>ExoClick</AdSystem>
      <AdTitle/>
      <Impression id="exotr"><![CDATA[https://s.magsrv.com/vregister.php?a=vimp&idzone=6015286]]></Impression>
      <Creatives>
        <Creative id="8539462">
          <Linear>
            <Duration>00:00:20.736</Duration>
            <MediaFiles>
              <MediaFile delivery="progressive" type="video/mp4" width="720" height="1280"><![CDATA[https://n2j9y0x0.bxcdn.net/library/1001276/ad81086de7a2bd31b22dea6e960488a9d36749bf.mp4]]></MediaFile>
            </MediaFiles>
            <VideoClicks>
              <ClickThrough><![CDATA[https://s.magsrv.com/click.php?d=H4sIAAAA]]></ClickThrough>
            </VideoClicks>
          </Linear>
        </Creative>
      </Creatives>
    </InLine>
  </Ad>
</VAST>`;

describe("parseVast — the live ExoClick response", () => {
  it("reads the creative the owner's zone actually serves", () => {
    const ad = parseVast(LIVE)!;
    expect(ad).toBeTruthy();
    expect(ad.mediaUrl).toBe(
      "https://n2j9y0x0.bxcdn.net/library/1001276/ad81086de7a2bd31b22dea6e960488a9d36749bf.mp4",
    );
    expect(ad.mediaType).toBe("video/mp4");
    expect(ad.width).toBe(720);
    expect(ad.height).toBe(1280);
    expect(ad.durationSeconds).toBeCloseTo(20.736, 3);
    expect(ad.impressions).toHaveLength(1);
    expect(ad.clickThrough).toContain("s.magsrv.com/click.php");
  });

  it("returns null rather than throwing on anything unrecognisable", () => {
    // The parser is regex over a third party's document. Every shape it does not
    // understand must degrade to "no ad", never to an exception on a page render.
    for (const junk of ["", "<html>nope</html>", "<VAST></VAST>", "{}", "<VAST><Ad/></VAST>"]) {
      expect(() => parseVast(junk)).not.toThrow();
      expect(parseVast(junk)).toBeNull();
    }
  });
});

describe("parseVast — media selection", () => {
  const build = (files: string) =>
    `<VAST><Ad><InLine><Creatives><Creative><Linear><Duration>00:00:10</Duration><MediaFiles>${files}</MediaFiles></Linear></Creative></Creatives></InLine></Ad></VAST>`;

  it("🔴 prefers the TALLEST rendition — these slots are 9:16", () => {
    // A landscape rendition letterboxes into a thin band inside a vertical slot,
    // which is the whole shape the owner asked for.
    const ad = parseVast(
      build(
        `<MediaFile delivery="progressive" type="video/mp4" width="1280" height="720"><![CDATA[https://x/land.mp4]]></MediaFile>
         <MediaFile delivery="progressive" type="video/mp4" width="720" height="1280"><![CDATA[https://x/vert.mp4]]></MediaFile>`,
      ),
    )!;
    expect(ad.mediaUrl).toBe("https://x/vert.mp4");
  });

  it("🔴 prefers PROGRESSIVE — streaming delivery needs a library we do not ship", () => {
    const ad = parseVast(
      build(
        `<MediaFile delivery="streaming" type="video/mp4" width="1080" height="1920"><![CDATA[https://x/hls.mp4]]></MediaFile>
         <MediaFile delivery="progressive" type="video/mp4" width="360" height="640"><![CDATA[https://x/prog.mp4]]></MediaFile>`,
      ),
    )!;
    // Taller, but unplayable from a bare <video src>. Progressive wins outright.
    expect(ad.mediaUrl).toBe("https://x/prog.mp4");
  });

  it("🔴 refuses a javascript: URL anywhere it would be executed", () => {
    /*
     * Every URL here comes from a third party and is handed to `new Image().src`
     * or `window.open`. A `javascript:` ClickThrough would otherwise be a
     * straight XSS delivered by the ad network.
     */
    const ad = parseVast(
      `<VAST><Ad><InLine>
        <Impression><![CDATA[javascript:alert(1)]]></Impression>
        <Impression><![CDATA[https://ok/imp]]></Impression>
        <Creatives><Creative><Linear><Duration>00:00:05</Duration>
        <MediaFiles><MediaFile delivery="progressive" type="video/mp4"><![CDATA[https://x/a.mp4]]></MediaFile></MediaFiles>
        <VideoClicks><ClickThrough><![CDATA[javascript:alert(2)]]></ClickThrough></VideoClicks>
        </Linear></Creative></Creatives>
      </InLine></Ad></VAST>`,
    )!;
    expect(ad.impressions).toEqual(["https://ok/imp"]);
    expect(ad.clickThrough).toBeNull();
  });

  it("drops a creative whose only media file is unusable", () => {
    expect(
      parseVast(build(`<MediaFile delivery="progressive" type="video/mp4"><![CDATA[javascript:x]]></MediaFile>`)),
    ).toBeNull();
  });

  it("collects quartile tracking pixels by event name", () => {
    const ad = parseVast(
      `<VAST><Ad><InLine><Creatives><Creative><Linear><Duration>00:00:30</Duration>
        <TrackingEvents>
          <Tracking event="start"><![CDATA[https://t/s]]></Tracking>
          <Tracking event="midpoint"><![CDATA[https://t/m]]></Tracking>
          <Tracking event="complete"><![CDATA[https://t/c]]></Tracking>
        </TrackingEvents>
        <MediaFiles><MediaFile delivery="progressive" type="video/mp4"><![CDATA[https://x/a.mp4]]></MediaFile></MediaFiles>
      </Linear></Creative></Creatives></InLine></Ad></VAST>`,
    )!;
    expect(ad.tracking.start).toEqual(["https://t/s"]);
    expect(ad.tracking.midpoint).toEqual(["https://t/m"]);
    expect(ad.tracking.complete).toEqual(["https://t/c"]);
  });
});

describe("🔴 progress trackers — the view counter", () => {
  /*
   * THE ZERO-VIEWS BUG. ExoClick reported ~100 impressions, 0 views, $0.00.
   *
   * Their VAST sends NO `start` and NO quartile events. Every tracker is
   * `event="progress"` with a time offset, and the URL behind it is
   * `vregister.php?a=vview` — literally their view beacon. Keying trackers by
   * event NAME alone put all five into an unused `progress` bucket, so `a=vimp`
   * fired on every play and `a=vview` never fired once.
   *
   * Verbatim shape from the live zone (token elided).
   */
  const WITH_PROGRESS = `<VAST version="3.0"><Ad><InLine>
    <Impression><![CDATA[https://s.magsrv.com/vregister.php?a=vimp&idzone=6015286]]></Impression>
    <Creatives><Creative><Linear><Duration>00:00:20.736</Duration>
      <TrackingEvents>
        <Tracking id="prog_1" event="progress" offset="00:00:03.000"><![CDATA[https://s.magsrv.com/vregister.php?a=vview&progress=3]]></Tracking>
        <Tracking id="prog_2" event="progress" offset="00:00:10.000"><![CDATA[https://s.magsrv.com/vregister.php?a=vview&progress=10]]></Tracking>
        <Tracking event="progress" offset="50%"><![CDATA[https://s.magsrv.com/vregister.php?a=vview&progress=half]]></Tracking>
      </TrackingEvents>
      <MediaFiles><MediaFile delivery="progressive" type="video/mp4"><![CDATA[https://x/a.mp4]]></MediaFile></MediaFiles>
    </Linear></Creative></Creatives>
  </InLine></Ad></VAST>`;

  it("extracts progress trackers WITH their offsets", () => {
    const ad = parseVast(WITH_PROGRESS)!;
    expect(ad.progress).toHaveLength(3);
    expect(ad.progress[0]).toEqual({
      offsetSeconds: 3,
      url: "https://s.magsrv.com/vregister.php?a=vview&progress=3",
    });
  });

  it("resolves a PERCENTAGE offset against the real duration", () => {
    const ad = parseVast(WITH_PROGRESS)!;
    // 50% of 20.736s. Sorted, so it lands between the 3s and 10s markers.
    expect(ad.progress.map((p) => p.offsetSeconds)).toEqual([3, 10, 10.368]);
  });

  it("🔴 keeps the view beacon OUT of the named-event bucket", () => {
    // The regression itself: while these lived under `tracking.progress`,
    // nothing fired them, because the player only looks for start/quartiles.
    const ad = parseVast(WITH_PROGRESS)!;
    expect(ad.tracking.progress).toBeUndefined();
    expect(ad.impressions).toHaveLength(1);
  });

  it("drops an unreadable offset rather than guessing at one", () => {
    // A view beacon fired at the wrong moment is worse than one not fired —
    // it is the number the advertiser is billed on.
    const ad = parseVast(
      WITH_PROGRESS.replace('offset="00:00:03.000"', 'offset="soon"'),
    )!;
    expect(ad.progress.map((p) => p.offsetSeconds)).toEqual([10, 10.368]);
  });

  it("a percentage offset needs a duration, and returns null without one", () => {
    expect(parseVastOffset("50%", null)).toBeNull();
    expect(parseVastOffset("50%", 20)).toBe(10);
    expect(parseVastOffset("00:00:03.000", null)).toBe(3);
    expect(parseVastOffset(null, 20)).toBeNull();
  });

  it("the live InLine fixture has no progress trackers and does not invent any", () => {
    expect(parseVast(LIVE)!.progress).toEqual([]);
  });
});

describe("VAST wrappers", () => {
  it("exposes the next document to fetch", () => {
    // Wrappers are how resellers chain to the real creative — ignoring them
    // would silently drop a share of the fill.
    const xml = `<VAST><Ad><Wrapper><VASTAdTagURI><![CDATA[https://next/vast.xml]]></VASTAdTagURI></Wrapper></Ad></VAST>`;
    expect(vastWrapperUrl(xml)).toBe("https://next/vast.xml");
    // …and a wrapper has no creative of its own, so parsing must not invent one.
    expect(parseVast(xml)).toBeNull();
  });

  it("has no wrapper url on an inline document", () => {
    expect(vastWrapperUrl(LIVE)).toBeNull();
  });
});

describe("parseVastDuration", () => {
  it("reads HH:MM:SS(.mmm)", () => {
    expect(parseVastDuration("00:00:20.736")).toBeCloseTo(20.736, 3);
    expect(parseVastDuration("00:01:05")).toBe(65);
    expect(parseVastDuration("01:00:00")).toBe(3600);
  });

  it("is null on junk rather than NaN", () => {
    // NaN would propagate into the quartile maths and fire every pixel at once.
    for (const junk of [null, "", "20", "abc", "1:2"]) {
      expect(parseVastDuration(junk)).toBeNull();
    }
  });
});

describe("exoClickVastUrl", () => {
  it("builds the endpoint from a zone id", () => {
    expect(exoClickVastUrl("6015286")).toBe("https://s.magsrv.com/v1/vast.php?idzone=6015286");
  });

  it("encodes the id rather than interpolating it raw", () => {
    expect(exoClickVastUrl("a b&c")).toBe("https://s.magsrv.com/v1/vast.php?idzone=a%20b%26c");
  });
});
