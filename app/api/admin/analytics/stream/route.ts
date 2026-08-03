import { getAdminUser } from "@/lib/admin/guard";
import { getAnalyticsSummary, type Range } from "@/lib/analytics/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/analytics/stream?range=24h|7d|30d — a Server-Sent Events stream
 * of the live analytics summary. Replaces the dashboard's 15s poll: the server
 * pushes a fresh snapshot every ~10s over one long-lived connection, with a comment
 * heartbeat to keep intermediaries from closing it.
 *
 * Bounded lifetime (5 min) then a clean close — EventSource reconnects on its own,
 * so this caps server work per connection without the client ever noticing a gap.
 * Admin-guarded; a non-admin gets 403 before the stream opens.
 */
const TICK_MS = 10_000;
const PING_MS = 25_000;
const MAX_LIFETIME_MS = 5 * 60_000;

export async function GET(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return new Response("Forbidden", { status: 403 });

  const r = new URL(request.url).searchParams.get("range");
  const range: Range = r === "7d" || r === "30d" ? r : "24h";

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const enqueue = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          closed = true;
        }
      };

      const push = async () => {
        try {
          const summary = await getAnalyticsSummary(range);
          enqueue(`event: summary\ndata: ${JSON.stringify(summary)}\n\n`);
        } catch {
          /* transient — the next tick retries */
        }
      };

      let tick: ReturnType<typeof setInterval> | null = null;
      let ping: ReturnType<typeof setInterval> | null = null;
      let life: ReturnType<typeof setTimeout> | null = null;

      const stop = () => {
        if (closed) return;
        closed = true;
        if (tick) clearInterval(tick);
        if (ping) clearInterval(ping);
        if (life) clearTimeout(life);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // Prime immediately, then stream.
      void push();
      tick = setInterval(() => void push(), TICK_MS);
      ping = setInterval(() => enqueue(`: ping\n\n`), PING_MS);
      life = setTimeout(stop, MAX_LIFETIME_MS);
      request.signal.addEventListener("abort", stop);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
