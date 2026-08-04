import type { AlpacaDeadlineHandle, AlpacaDeadlineScheduler } from "./contracts.js";
import { clearTimeout, setTimeout } from "node:timers";
import { performance } from "node:perf_hooks";

const ownedSchedulers = new WeakSet<object>();

export class AlpacaDeadlineElapsed extends Error {
  constructor() {
    super("alpaca-attempt-deadline-elapsed");
    this.name = "AlpacaDeadlineElapsed";
  }
}

export type AlpacaDeadlineProbe = Readonly<{
  armed(input: Readonly<{ delayMs: number; expireNow(): void }>): void;
  cancelled?(): void;
  settled?(): void;
}>;

/**
 * Fixed-behaviour deadline composition. A probe may observe or shorten a deadline for deterministic
 * offline tests, but it cannot extend, cancel, or replace the native absolute timer.
 */
export function createOwnedAlpacaDeadlineScheduler(
  probe?: AlpacaDeadlineProbe,
): AlpacaDeadlineScheduler {
  const scheduler: AlpacaDeadlineScheduler = Object.freeze({
    arm(delayMs: number): AlpacaDeadlineHandle {
      if (!Number.isSafeInteger(delayMs) || delayMs < 1) {
        throw new RangeError("alpaca-deadline-delay-invalid");
      }
      let expire!: () => void;
      let settle!: () => void;
      let expired = false;
      let cancelled = false;
      const absoluteDeadlineMs = performance.now() + delayMs;
      const expiredPromise = new Promise<void>((resolve) => {
        expire = (): void => {
          if (expired || cancelled) return;
          expired = true;
          resolve();
          settle();
        };
      });
      const settledPromise = new Promise<void>((resolve) => {
        settle = resolve;
      });
      const timer = setTimeout(expire, delayMs);
      const handle: AlpacaDeadlineHandle = Object.freeze({
        expired: expiredPromise,
        assertRemaining(): void {
          if (expired || performance.now() >= absoluteDeadlineMs) {
            expire();
            throw new AlpacaDeadlineElapsed();
          }
        },
        cancel(): void {
          if (cancelled) return;
          cancelled = true;
          clearTimeout(timer);
          try {
            probe?.cancelled?.();
          } catch {
            // Probes cannot affect timer cancellation.
          }
          if (!expired) settle();
        },
        async settle(): Promise<void> {
          await settledPromise;
          try {
            probe?.settled?.();
          } catch {
            // Probes cannot affect bounded settlement.
          }
        },
      });
      try {
        probe?.armed(Object.freeze({ delayMs, expireNow: expire }));
      } catch (error) {
        handle.cancel();
        throw error;
      }
      return handle;
    },
  });
  ownedSchedulers.add(scheduler);
  return scheduler;
}

export function assertOwnedAlpacaDeadlineScheduler(value: AlpacaDeadlineScheduler): void {
  if (!ownedSchedulers.has(value) || !Object.isFrozen(value)) {
    throw new TypeError("owned-alpaca-deadline-scheduler-required");
  }
}
