export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/metrics/playback — accepts a small playback-health beacon (see
 * lib/media/playback-metrics.ts) and logs one structured line so it's queryable in
 * the platform logs (Vercel). No auth (non-sensitive aggregate), no storage — a
 * log sink is enough to watch time-to-first-frame + rebuffer rate by source. Always
 * returns 204 so `sendBeacon` never retries.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { mode, ttffMs, rebuffers, postId, droppedFrames, decodedFrames, bitrateKbps, errored } = (body ?? {}) as Record<
      string,
      unknown
    >;
    const dropRatio =
      typeof droppedFrames === "number" && typeof decodedFrames === "number" && decodedFrames > 0
        ? ((droppedFrames / decodedFrames) * 100).toFixed(1)
        : null;
    // One compact line per playback — grep "[playback]" in logs.
    console.log(
      `[playback] mode=${mode ?? "?"} ttffMs=${ttffMs ?? "-"} rebuffers=${rebuffers ?? 0}` +
        `${bitrateKbps ? ` bitrateKbps=${bitrateKbps}` : ""}${dropRatio ? ` droppedPct=${dropRatio}` : ""}` +
        `${errored ? " errored=1" : ""}${postId ? ` post=${postId}` : ""}`,
    );
  } catch {
    /* malformed beacon — ignore */
  }
  return new Response(null, { status: 204 });
}
