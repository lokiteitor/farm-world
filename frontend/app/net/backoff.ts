// Exponential backoff with jitter.
//
// Owner: W3-C. Pure, and the randomness is injected: a reconnection policy that reads
// an ambient source cannot be tested for its own bounds, which is the only property of
// it that matters.
//
// Why jitter. Every client of a server that restarted reconnects at the same instant,
// and a plain exponential schedule keeps them synchronised for as long as the outage
// lasts, so the recovering server is hit by the whole population at once, fails again
// and re-synchronises them. Spreading each delay over a band breaks the convoy.

export interface BackoffConfig {
  /** Delay of the first retry, before jitter. */
  readonly baseRealMs: number;
  /** Ceiling of the delay, jitter included. Never exceeded. */
  readonly maxRealMs: number;
  /** Floor of the delay, jitter included. Stops a burst of immediate retries. */
  readonly minRealMs: number;
  /** Growth per attempt. */
  readonly factor: number;
  /**
   * Half width of the band, in basis points of the nominal delay. 3 000 means the
   * delay lands anywhere between 70 % and 130 % of the nominal value.
   */
  readonly jitterBp: number;
}

export const DEFAULT_BACKOFF: BackoffConfig = {
  baseRealMs: 500,
  maxRealMs: 30_000,
  minRealMs: 250,
  factor: 2,
  jitterBp: 3_000,
};

/** Nominal delay of an attempt, without jitter. Attempt zero is the first retry. */
export function nominalBackoffRealMs(attempt: number, config: BackoffConfig): number {
  const exponent = attempt < 0 ? 0 : attempt;
  // Computed by repeated multiplication with an early exit, so that a long outage
  // cannot overflow to `Infinity` before the clamp is applied.
  let delay = config.baseRealMs;
  for (let step = 0; step < exponent; step += 1) {
    delay *= config.factor;
    if (delay >= config.maxRealMs) {
      return config.maxRealMs;
    }
  }
  return Math.min(delay, config.maxRealMs);
}

/**
 * Delay of an attempt, jitter included, clamped to `[minRealMs, maxRealMs]`.
 *
 * `random` returns a value in `[0, 1)`, exactly like `Math.random`, and is a parameter
 * so that the tests can pin the ends of the band.
 */
export function backoffDelayRealMs(
  attempt: number,
  random: () => number,
  config: BackoffConfig = DEFAULT_BACKOFF,
): number {
  const nominal = nominalBackoffRealMs(attempt, config);
  const spread = (nominal * config.jitterBp) / 10_000;
  const jittered = nominal + spread * (2 * random() - 1);
  const clamped = Math.min(config.maxRealMs, Math.max(config.minRealMs, jittered));
  return Math.round(clamped);
}
