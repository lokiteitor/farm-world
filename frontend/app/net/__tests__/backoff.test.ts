// The bounds of the reconnection backoff.
//
// Owner: W3-C.
//
// The randomness is injected, which is what makes the band testable at all: the two ends of
// the jitter are pinned by feeding the generator zero and a value just below one, and the
// ceiling is checked at an attempt number no outage would ever reach, because that is the case
// where an unclamped exponential silently becomes `Infinity` and a `setTimeout` of `Infinity`
// never fires.

import { describe, expect, it } from 'vitest';
import { DEFAULT_BACKOFF, backoffDelayRealMs, nominalBackoffRealMs } from '~/net/backoff';

const ALMOST_ONE = 0.999999;

describe('el retroceso exponencial', () => {
  it('crece por potencias del factor hasta el techo', () => {
    expect(nominalBackoffRealMs(0, DEFAULT_BACKOFF)).toBe(500);
    expect(nominalBackoffRealMs(1, DEFAULT_BACKOFF)).toBe(1_000);
    expect(nominalBackoffRealMs(2, DEFAULT_BACKOFF)).toBe(2_000);
    expect(nominalBackoffRealMs(6, DEFAULT_BACKOFF)).toBe(30_000);
  });

  it('no supera el techo ni con un numero de intento absurdo', () => {
    expect(nominalBackoffRealMs(1_000, DEFAULT_BACKOFF)).toBe(DEFAULT_BACKOFF.maxRealMs);
    expect(Number.isFinite(nominalBackoffRealMs(1_000, DEFAULT_BACKOFF))).toBe(true);
  });

  it('trata un intento negativo como el primero', () => {
    expect(nominalBackoffRealMs(-3, DEFAULT_BACKOFF)).toBe(DEFAULT_BACKOFF.baseRealMs);
  });
});

describe('el jitter', () => {
  it('coloca el retardo en la banda declarada', () => {
    const nominal = nominalBackoffRealMs(2, DEFAULT_BACKOFF);
    const low = backoffDelayRealMs(2, () => 0, DEFAULT_BACKOFF);
    const high = backoffDelayRealMs(2, () => ALMOST_ONE, DEFAULT_BACKOFF);
    const middle = backoffDelayRealMs(2, () => 0.5, DEFAULT_BACKOFF);

    // 3 000 puntos base de media banda: del 70 % al 130 % del valor nominal.
    expect(low).toBe(Math.round(nominal * 0.7));
    expect(high).toBeLessThanOrEqual(Math.round(nominal * 1.3));
    expect(high).toBeGreaterThan(nominal);
    expect(middle).toBe(nominal);
  });

  it('respeta el suelo y el techo con el jitter incluido', () => {
    const first = backoffDelayRealMs(0, () => 0, DEFAULT_BACKOFF);
    expect(first).toBeGreaterThanOrEqual(DEFAULT_BACKOFF.minRealMs);

    const last = backoffDelayRealMs(20, () => ALMOST_ONE, DEFAULT_BACKOFF);
    expect(last).toBeLessThanOrEqual(DEFAULT_BACKOFF.maxRealMs);
  });

  it('mantiene los limites en todo el recorrido de intentos y de azar', () => {
    for (let attempt = 0; attempt <= 12; attempt += 1) {
      for (const random of [0, 0.25, 0.5, 0.75, ALMOST_ONE]) {
        const delay = backoffDelayRealMs(attempt, () => random, DEFAULT_BACKOFF);
        expect(delay).toBeGreaterThanOrEqual(DEFAULT_BACKOFF.minRealMs);
        expect(delay).toBeLessThanOrEqual(DEFAULT_BACKOFF.maxRealMs);
      }
    }
  });

  it('reparte la cola: dos clientes con azar distinto no reconectan a la vez', () => {
    const a = backoffDelayRealMs(4, () => 0.1, DEFAULT_BACKOFF);
    const b = backoffDelayRealMs(4, () => 0.9, DEFAULT_BACKOFF);
    expect(a).not.toBe(b);
  });
});
