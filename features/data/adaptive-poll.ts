/**
 * Part 9 (2026-10-09): a poll that is fast only while a conversation is live.
 *
 * Fixed-period polls (secret chat every 4 s, support chat every 5 s) kept a
 * phone's radio and a function invocation busy for as long as the page stayed
 * open, even when nobody was typing. This one:
 *   · polls every `fastMs` for `fastForMs` after any activity (a send, an arrival)
 *   · then slows to `slowMs`
 *   · never polls while the page is hidden, and checks at once when it returns
 *   · runs ONE timer at a time: a bump or a visibility event never starts a second chain
 *
 * `run` resolves to true when something new arrived (that counts as activity).
 */
export interface AdaptivePoll {
  /** something happened (a send): poll fast again, starting now */
  bump(): void;
  stop(): void;
}

export function startAdaptivePoll(run: () => Promise<boolean | void>, opts: { fastMs: number; slowMs: number; fastForMs?: number }): AdaptivePoll {
  const fastFor = opts.fastForMs ?? 60_000;
  let lastActivity = Date.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let stopped = false;

  const delay = () => (Date.now() - lastActivity < fastFor ? opts.fastMs : opts.slowMs);
  const schedule = () => {
    if (stopped || timer || typeof document === "undefined" || document.visibilityState !== "visible") return;
    timer = setTimeout(tick, delay());
  };
  async function tick() {
    timer = null;
    if (stopped || inFlight || document.visibilityState !== "visible") return;
    inFlight = true;
    try {
      if ((await run()) === true) lastActivity = Date.now();
    } catch {
      /* best-effort: the next tick retries */
    } finally {
      inFlight = false;
    }
    schedule();
  }
  const now = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    void tick();
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") now();
    else if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  document.addEventListener("visibilitychange", onVisible);
  schedule();

  return {
    bump() {
      lastActivity = Date.now();
      now();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    },
  };
}
