/**
 * Per-instance concurrency control for expensive download jobs.
 *
 * Each active download spawns a yt-dlp (+ ffmpeg) process and writes a temp
 * file, so unbounded concurrency would exhaust CPU / memory / disk on a single
 * box. This semaphore caps simultaneous jobs and queues the overflow; once the
 * queue is full it sheds load with a `BusyError` (surfaced as HTTP 503) so the
 * instance stays healthy under heavy traffic.
 *
 * Horizontal scaling is the capacity lever: run N instances behind a load
 * balancer and total throughput ≈ N × DOWNLOAD_MAX_CONCURRENCY.
 */

const MAX_CONCURRENCY = Math.max(
  1,
  Number(process.env.DOWNLOAD_MAX_CONCURRENCY || 16),
);
const MAX_QUEUE = Math.max(0, Number(process.env.DOWNLOAD_MAX_QUEUE || 256));

export class BusyError extends Error {
  constructor() {
    super("Server is at capacity, please retry shortly.");
    this.name = "BusyError";
  }
}

class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(
    private readonly max: number,
    private readonly maxQueue: number,
  ) {}

  acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1;
      return Promise.resolve();
    }
    if (this.queue.length >= this.maxQueue) {
      return Promise.reject(new BusyError());
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) next();
  }

  get stats() {
    return { active: this.active, queued: this.queue.length, max: this.max };
  }
}

const downloadSemaphore = new Semaphore(MAX_CONCURRENCY, MAX_QUEUE);

/** Runs `fn` under the global download concurrency limit. */
export async function withDownloadSlot<T>(fn: () => Promise<T>): Promise<T> {
  await downloadSemaphore.acquire();
  try {
    return await fn();
  } finally {
    downloadSemaphore.release();
  }
}

export function downloadConcurrencyStats() {
  return downloadSemaphore.stats;
}
