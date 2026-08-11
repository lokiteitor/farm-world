// Hiring pool and worker skill parameters.
//
// Owner: workflow W2 (vocabulary).
//
// The procedural rule of GDD section 102 is the authoritative source of salaries. The
// 30 $/h of GDD section 36 and the 15 $/h of GDD section 117 are inconsistent with it
// and with each other, and are documented as non reproducible in the balance report
// rather than reconciled (plan section 2.2).

import { Money } from '../domain/money.js';
import { bp, gameHours, type Bp, type GameHours } from '../domain/units.js';

/** Candidates offered at a time. GDD section 102 illustrates the pool with three. */
export const POOL_SIZE = 3;

/**
 * Interval after which a hired or expired candidate is replaced (GDD section 102 names
 * `poolRefreshInterval` but gives neither value nor unit). 48 game hours, for coherence
 * with the rest of the domain, which is measured in game hours (plan section 2.2).
 */
export const POOL_REFRESH_INTERVAL_GAME_HOURS: GameHours = gameHours(48);

/** Skill range of a generated candidate (GDD section 102). */
export const POOL_SKILL_MIN_BP: Bp = bp(3000);
export const POOL_SKILL_MAX_BP: Bp = bp(9000);

/**
 * Salary as a function of skill: `SALARY_INTERCEPT + SALARY_PER_SKILL_POINT x skill`,
 * with skill as a percentage in 0..100, then perturbed by noise and floored.
 *
 * The two coefficients are the least squares fit of the three examples of GDD section
 * 102 (skill 45 % asking 12 $/h, skill 62 % asking 18 $/h, skill 88 % asking 31 $/h),
 * rounded to two decimals. The fit gives 11.50, 19.15 and 30.85, so the largest
 * residual is 1.15 $/h on the middle example, well inside the noise band that GDD
 * section 102 itself prescribes ("salary correlated with skill plus noise").
 *
 * The intercept is negative, which is what makes low skill labour cheap and keeps the
 * "many cheap workers against few experts" trade off of GDD sections 65 and 103 alive.
 */
export const SALARY_INTERCEPT = Money.fromString('-8.75');
export const SALARY_PER_SKILL_POINT = Money.fromString('0.45');

/**
 * Half width of the multiplicative noise applied to the fitted salary, in basis points:
 * the asking salary is drawn from the fit multiplied by a factor in 0.88..1.12. Invented
 * value, since GDD section 102 asks for noise without quantifying it. Twelve per cent
 * covers the residuals of the fit, so the three published examples are inside the range
 * the generator can produce.
 */
export const SALARY_NOISE_BP: Bp = bp(1200);

/**
 * Floor on the asking salary. Invented value: with the fitted line, the minimum skill of
 * the pool (30 %) yields 4.75 $/h, and noise could push it lower. Six per game hour keeps
 * the cheapest worker meaningfully cheap without making labour free, which would break the
 * cash flow tension of GDD section 118.
 */
export const SALARY_FLOOR = Money.fromString('6');

/**
 * Skill gained on completing a task (GDD sections 103 and 105). One point, which is what
 * the narrative example of GDD section 110 shows when a worker goes from 70 % to 71 %.
 */
export const SKILL_GAIN_PER_TASK_BP: Bp = bp(100);

/** Ceiling on skill progression (GDD section 103). */
export const SKILL_CAP_BP: Bp = bp(9500);

/**
 * `skillFactor = SKILL_FACTOR_BASE + (skill / 100) x SKILL_FACTOR_SPAN` (GDD section
 * 103). The floor of 0.5 is a design decision of the GDD: skill never makes a worker
 * useless.
 */
export const SKILL_FACTOR_BASE = 0.5;
export const SKILL_FACTOR_SPAN = 0.5;

/**
 * Name pools for generated candidates. Content invented, with no balance effect: the
 * generator picks deterministically from the seed of the world and the player, so the
 * same pool is reproducible in the tests.
 */
export const CANDIDATE_FIRST_NAMES: readonly string[] = [
  'Adrian',
  'Alba',
  'Alvaro',
  'Ana',
  'Bruno',
  'Carla',
  'Daniel',
  'Elena',
  'Emilio',
  'Eva',
  'Gonzalo',
  'Irene',
  'Javier',
  'Julia',
  'Lucas',
  'Marina',
  'Martin',
  'Nadia',
  'Nicolas',
  'Olga',
  'Pablo',
  'Raquel',
  'Sergio',
  'Teresa',
];

export const CANDIDATE_LAST_NAMES: readonly string[] = [
  'Arribas',
  'Bermejo',
  'Cabrera',
  'Duran',
  'Escudero',
  'Fuentes',
  'Gallego',
  'Herrera',
  'Ibanez',
  'Jimeno',
  'Lozano',
  'Merino',
  'Nogales',
  'Pedraza',
  'Quintana',
  'Rivas',
  'Salgado',
  'Tejedor',
  'Ureta',
  'Vidal',
];
