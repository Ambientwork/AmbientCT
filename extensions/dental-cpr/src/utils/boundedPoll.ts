// extensions/dental-cpr/src/utils/boundedPoll.ts
//
// Small dependency-free bounded polling helper. Replaces the unbounded
// `setTimeout(tryLoad, 800)` loops in DentalMPRViewport / DentalMPRDiffViewport
// (plan §10 addendum 18.2) that previously left the UI stuck on "Waiting for
// volume…" forever when a volume never becomes ready (e.g. the series is
// missing or failed to load). Pure timer logic — no React, no cornerstone —
// so it is unit-testable with jest fake timers.

export interface BoundedPollOptions {
  /** Delay between readiness checks, in ms. */
  intervalMs: number;
  /** Total time budget before giving up and calling onTimeout, in ms. */
  timeoutMs: number;
}

export interface BoundedPollHandlers {
  /** Returns true once the awaited condition is satisfied. Must not throw. */
  isReady: () => boolean;
  onReady: () => void;
  onTimeout: () => void;
}

export interface PollScheduler {
  setTimeout: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
  now: () => number;
}

const defaultScheduler: PollScheduler = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: id => clearTimeout(id),
  now: () => Date.now(),
};

export interface BoundedPollHandle {
  cancel: () => void;
}

/**
 * Polls `isReady()` every `intervalMs` until it returns true (→ onReady) or
 * `timeoutMs` elapses (→ onTimeout). Exactly one of the two callbacks fires,
 * exactly once, unless `cancel()` is called first. Starts immediately
 * (checks once synchronously before scheduling the first delayed retry).
 */
export function startBoundedPoll(
  { intervalMs, timeoutMs }: BoundedPollOptions,
  { isReady, onReady, onTimeout }: BoundedPollHandlers,
  scheduler: PollScheduler = defaultScheduler
): BoundedPollHandle {
  let cancelled = false;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  const deadline = scheduler.now() + timeoutMs;

  const tick = () => {
    if (cancelled) return;
    timerId = null;

    let ready = false;
    try {
      ready = isReady();
    } catch {
      ready = false;
    }

    if (ready) {
      onReady();
      return;
    }

    if (scheduler.now() >= deadline) {
      onTimeout();
      return;
    }

    timerId = scheduler.setTimeout(tick, intervalMs);
  };

  tick();

  return {
    cancel: () => {
      cancelled = true;
      if (timerId !== null) {
        scheduler.clearTimeout(timerId);
        timerId = null;
      }
    },
  };
}
