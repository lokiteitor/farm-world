// The procedural rule of the hiring pool, on its own (GDD section 102).
//
// Owner: workflow W5-B. Tests of the module `workers`.
//
// `modules/workers/pool.ts` is pure, so this suite needs neither PostgreSQL nor Redis and is
// the fast half of the module's coverage: it asserts the rule of GDD section 102 over
// thousands of draws, which an integration suite could not afford. The three properties it
// checks are the three claims the section makes, and nothing else:
//
//   1. Skill lies in 30 % to 90 %, and both ends are actually reachable.
//   2. The salary is correlated with the skill plus noise, which is checked twice: every
//      draw sits inside the band the fitted line and the noise half width define, and over a
//      large sample the linear correlation is strong. A generator that ignored the skill
//      would pass the band check on its own if the band were wide, so the correlation is
//      what makes the band meaningful.
//   3. The three published examples of GDD section 102 are inside the band the generator can
//      produce, which is the check that keeps the fit in `shared/config/workers.ts` honest.
//
// And one property the section does not state but the project depends on: the same world
// seed, the same player and the same listing instant rebuild the same pool. Without it the
// integration suite below could not assert a candidate at all.
//
// NOTE ON THE GATE. `make test-unit` runs the suites of `shared/` and of the client only, so
// this file enters no gate today; it is run with `cd backend && npx vitest run`. That is a
// known pending item of `docs/handoff/NOTES-w4-cierre.md`, section 5, and it is why the band
// is asserted a second time in `hiring.int.test.ts` against the pool the server really wrote.

import { describe, expect, it } from 'vitest';
import {
  POOL_SKILL_BAND,
  askingSalary,
  candidateSkillBp,
  fittedSalary,
  generateCandidate,
  generatePool,
  poolGeneration,
  salaryNoiseFactor,
} from '../../modules/workers/pool.js';
import {
  MS_PER_GAME_HOUR,
  Money,
  POOL_SIZE,
  SALARY_FLOOR,
  SALARY_NOISE_BP,
  bpToPercent,
  gameMs,
  type Bp,
  type GameMs,
} from '../../shared/index.js';

/** A listing instant that is a whole number of game hours, as every refresh boundary is. */
function atGameHour(hour: number): GameMs {
  return gameMs(BigInt(hour) * MS_PER_GAME_HOUR);
}

const SEED = { worldSeed: 20260812, playerId: '0199a6ec-1f5b-7c31-9a5d-6f3b1c0a7e42' };

/** Every candidate of a range of generations, which is the sample the properties run on. */
function sample(generations: number): readonly { skillBp: Bp; salary: Money }[] {
  const drawn: { skillBp: Bp; salary: Money }[] = [];
  for (let generation = 0; generation < generations; generation += 1) {
    for (const candidate of generatePool({
      ...SEED,
      listedAtGameMs: atGameHour(generation * 48),
    })) {
      drawn.push({ skillBp: candidate.skillBp, salary: candidate.askingSalaryPerGameHour });
    }
  }
  return drawn;
}

/** An amount as a plain number. Only the tests do this; the domain never leaves `Money`. */
function amount(value: Money): number {
  return Number(Money.toString(value));
}

describe('la habilidad de un candidato (GDD 102)', () => {
  it('cae siempre dentro de la banda 30-90 por ciento', () => {
    for (const candidate of sample(400)) {
      expect(candidate.skillBp).toBeGreaterThanOrEqual(POOL_SKILL_BAND.minBp);
      expect(candidate.skillBp).toBeLessThanOrEqual(POOL_SKILL_BAND.maxBp);
    }
  });

  it('alcanza los dos extremos de la banda, que son cerrados', () => {
    expect(candidateSkillBp(0)).toBe(POOL_SKILL_BAND.minBp);
    // The unit draw is a fraction below one, so the last representable value has to land on
    // the maximum: a half open range would make the best candidate unreachable.
    expect(candidateSkillBp(1 - Number.EPSILON)).toBe(POOL_SKILL_BAND.maxBp);
    expect(candidateSkillBp(1)).toBe(POOL_SKILL_BAND.maxBp);
  });

  it('cubre la banda de forma razonablemente uniforme', () => {
    const drawn = sample(400);
    const low = drawn.filter((candidate) => candidate.skillBp < 5_000).length;
    const high = drawn.length - low;
    // A generator stuck on one half of the range would make the "cheap crowd against few
    // experts" trade off of GDD sections 65 and 103 unreachable.
    expect(low / drawn.length).toBeGreaterThan(0.25);
    expect(high / drawn.length).toBeGreaterThan(0.25);
  });
});

describe('el salario pedido (GDD 102)', () => {
  const halfWidth = SALARY_NOISE_BP / 10_000;

  it('cae dentro de la banda de la recta ajustada mas el ruido', () => {
    for (const candidate of sample(400)) {
      const fitted = amount(fittedSalary(candidate.skillBp));
      const lower = Math.max(amount(SALARY_FLOOR), fitted * (1 - halfWidth));
      const upper = Math.max(amount(SALARY_FLOOR), fitted * (1 + halfWidth));
      const asked = amount(candidate.salary);
      // A tenth of a cent of slack for the single rounding of `Money.mulRatio`.
      expect(asked).toBeGreaterThanOrEqual(lower - 0.001);
      expect(asked).toBeLessThanOrEqual(upper + 0.001);
    }
  });

  it('nunca baja del suelo del catalogo', () => {
    for (const candidate of sample(200)) {
      expect(Money.compare(candidate.salary, SALARY_FLOOR)).toBeGreaterThanOrEqual(0);
    }
    // Even the cheapest possible draw: minimum skill with the most favourable noise.
    expect(Money.compare(askingSalary(POOL_SKILL_BAND.minBp, 0), SALARY_FLOOR)).toBe(0);
  });

  it('esta fuertemente correlacionado con la habilidad', () => {
    const drawn = sample(400);
    const xs = drawn.map((candidate) => bpToPercent(candidate.skillBp));
    const ys = drawn.map((candidate) => amount(candidate.salary));
    expect(pearson(xs, ys)).toBeGreaterThan(0.95);
  });

  it('puede producir los tres ejemplos publicados por GDD 102', () => {
    // Skill 45 % asking 12, skill 62 % asking 18, skill 88 % asking 31. The fit is the least
    // squares line of these three, so each has to be inside its own noise band; if it were
    // not, the coefficients of `shared/config/workers.ts` would be describing another game.
    const published: readonly [number, number][] = [
      [4_500, 12],
      [6_200, 18],
      [8_800, 31],
    ];
    for (const [skillBp, asked] of published) {
      const fitted = amount(fittedSalary(skillBp as Bp));
      expect(asked).toBeGreaterThanOrEqual(fitted * (1 - halfWidth));
      expect(asked).toBeLessThanOrEqual(fitted * (1 + halfWidth));
    }
  });

  it('el factor de ruido recorre exactamente la banda del catalogo', () => {
    expect(salaryNoiseFactor(0)).toBeCloseTo(1 - halfWidth, 12);
    expect(salaryNoiseFactor(0.5)).toBeCloseTo(1, 12);
    expect(salaryNoiseFactor(1)).toBeCloseTo(1 + halfWidth, 12);
  });
});

describe('el determinismo del generador', () => {
  it('reconstruye el mismo pool con la misma semilla, jugador e instante', () => {
    const listedAtGameMs = atGameHour(96);
    const first = generatePool({ ...SEED, listedAtGameMs });
    const second = generatePool({ ...SEED, listedAtGameMs });
    expect(second).toEqual(first);
    expect(first).toHaveLength(POOL_SIZE);
  });

  it('da pools distintos a dos jugadores y a dos generaciones', () => {
    const listedAtGameMs = atGameHour(96);
    const mine = generatePool({ ...SEED, listedAtGameMs });
    const other = generatePool({
      ...SEED,
      playerId: '0199a6ec-1f5b-7c31-9a5d-6f3b1c0a7e43',
      listedAtGameMs,
    });
    const later = generatePool({ ...SEED, listedAtGameMs: atGameHour(144) });
    expect(other).not.toEqual(mine);
    expect(later).not.toEqual(mine);
  });

  it('no repite nombre dentro de un mismo pool', () => {
    for (let generation = 0; generation < 400; generation += 1) {
      const names = generatePool({ ...SEED, listedAtGameMs: atGameHour(generation * 48) }).map(
        (candidate) => candidate.name,
      );
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('numera la generacion por horas de juego enteras', () => {
    expect(poolGeneration(atGameHour(0))).toBe(0);
    expect(poolGeneration(atGameHour(48))).toBe(48);
    // Half an hour past a boundary still belongs to the same hour, which is what keeps the
    // generation stable against a listing instant that is not exactly on the hour.
    expect(poolGeneration(gameMs(48n * MS_PER_GAME_HOUR + MS_PER_GAME_HOUR / 2n))).toBe(48);
  });

  it('cada ranura del pool es independiente de las demas', () => {
    const listedAtGameMs = atGameHour(48);
    const slots = [0, 1, 2].map((slot) => generateCandidate({ ...SEED, listedAtGameMs }, slot));
    expect(new Set(slots.map((candidate) => candidate.skillBp)).size).toBeGreaterThan(1);
  });
});

/** Pearson correlation of two samples of the same length. */
function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  const meanX = xs.reduce((total, value) => total + value, 0) / n;
  const meanY = ys.reduce((total, value) => total + value, 0) / n;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let index = 0; index < n; index += 1) {
    const dx = (xs[index] ?? 0) - meanX;
    const dy = (ys[index] ?? 0) - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }
  return covariance / Math.sqrt(varianceX * varianceY);
}
