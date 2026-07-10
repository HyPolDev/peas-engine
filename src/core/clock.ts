export interface Clock {
  nowMs(): number;
}

function assertEpochMs(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Clock values must be non-negative safe integer milliseconds");
  }
}

export class SystemClock implements Clock {
  nowMs(): number {
    return Date.now();
  }
}

export class ManualClock implements Clock {
  readonly #initialMs: number;
  #currentMs: number;

  constructor(initialMs = 0) {
    assertEpochMs(initialMs);
    this.#initialMs = initialMs;
    this.#currentMs = initialMs;
  }

  nowMs(): number {
    return this.#currentMs;
  }

  advanceTo(nextMs: number): void {
    assertEpochMs(nextMs);
    if (nextMs < this.#currentMs) throw new RangeError("A manual clock cannot move backwards");
    this.#currentMs = nextMs;
  }

  advanceBy(deltaMs: number): void {
    if (!Number.isSafeInteger(deltaMs) || deltaMs < 0) {
      throw new RangeError("Clock deltas must be non-negative safe integers");
    }
    this.advanceTo(this.#currentMs + deltaMs);
  }

  reset(): void {
    this.#currentMs = this.#initialMs;
  }
}
