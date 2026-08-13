// Procedural generation of the hiring pool (GDD section 102).
//
// Owner: workflow W5-B. Module `workers`.
//
// GDD section 102 states the rule in one line: "pool generado proceduralmente (skill
// 30-90%, salario correlacionado con skill + ruido); al contratar, el candidato se retira y
// aparece uno nuevo tras `poolRefreshInterval`; sin negociacion de salario". Everything this
// file does is that sentence and nothing else; every constant it uses lives in
// `shared/config/workers.ts` with its own justification, so no balance number is written
// here.
//
// The whole file is pure and deterministic. There is no `Math.random` and no `Date.now`,
// which is not a stylistic rule but the reason the pool can be asserted in a test: the same
// world seed, the same player and the same listing instant rebuild the same three candidates
// byte for byte, on this process and on the next one. Randomness that cannot be replayed is
// randomness that cannot be debugged when a player reports an impossible salary.
//
// The mixer is `hashGrid` of `shared/world/terrain.ts` and not a new one. It is the audited
// 32 bit avalanche finaliser the terrain generator already depends on, its five integer slots
// are folded independently, and reusing it means the project has one hash instead of two. The
// parameter names of that function describe its terrain use; here the five slots carry the
// world seed, the player, the generation, the slot inside the pool and the attribute being
// drawn, which is what keeps two attributes of one candidate, two candidates of one pool and
// two pools of two players uncorrelated.
//
// What the pool is NOT: a market. There is no negotiation and no rejection of a low offer
// (GDD section 102, "Fuera del MVP"), so a candidate is a fixed triple of name, skill and
// asking salary, and hiring is an acceptance rather than a bid.

import {
  CANDIDATE_FIRST_NAMES,
  CANDIDATE_LAST_NAMES,
  MS_PER_GAME_HOUR,
  Money,
  POOL_SIZE,
  POOL_SKILL_MAX_BP,
  POOL_SKILL_MIN_BP,
  SALARY_FLOOR,
  SALARY_INTERCEPT,
  SALARY_NOISE_BP,
  SALARY_PER_SKILL_POINT,
  bpToPercent,
  clampBp,
  hashGrid,
  type Bp,
  type GameMs,
} from '../../shared/index.js';

// ---------------------------------------------------------------------------
// The deterministic source
// ---------------------------------------------------------------------------

/** Attribute a draw belongs to. Keeps the four draws of a candidate independent. */
const Salt = {
  SKILL: 1,
  SALARY_NOISE: 2,
  FIRST_NAME: 3,
  LAST_NAME: 4,
} as const;

/** 32 bit FNV-1a of a text, which is how a UUID becomes an integer the mixer can fold. */
export function hashText(text: string): number {
  let hash = 0x811c_9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x0100_0193);
  }
  return hash >>> 0;
}

/**
 * Generation of a pool: the listing instant expressed in whole game hours.
 *
 * Whole hours and not milliseconds so that the value stays inside the range the mixer folds
 * without truncation surprises, and because two pools can never be listed inside the same
 * game hour: the refresh interval is 48 game hours and the initial listing happens once.
 */
export function poolGeneration(listedAtGameMs: GameMs): number {
  return Number(BigInt.asIntN(32, listedAtGameMs / MS_PER_GAME_HOUR));
}

/** One draw of one attribute of one candidate, as a 32 bit integer. */
function draw(
  worldSeed: number,
  playerHash: number,
  generation: number,
  slot: number,
  salt: number,
): number {
  return hashGrid(worldSeed, playerHash, generation, slot, salt);
}

/** The same draw as a fraction in 0..1. */
function unitDraw(
  worldSeed: number,
  playerHash: number,
  generation: number,
  slot: number,
  salt: number,
): number {
  return draw(worldSeed, playerHash, generation, slot, salt) / 4_294_967_296;
}

// ---------------------------------------------------------------------------
// The two numbers of a candidate
// ---------------------------------------------------------------------------

/**
 * Skill of a candidate, uniform over the 30 % to 90 % of GDD section 102, both ends
 * included.
 *
 * The range is closed on both sides because the section states it as "skill 30-90%", and a
 * half open range would make the best candidate the game can offer unreachable by one basis
 * point, which is the kind of detail that only shows up as a balance report that never
 * reproduces its own maximum.
 */
export function candidateSkillBp(unit: number): Bp {
  const span = POOL_SKILL_MAX_BP - POOL_SKILL_MIN_BP + 1;
  const offset = Math.floor(unit * span);
  return clampBp(POOL_SKILL_MIN_BP + (offset >= span ? span - 1 : offset));
}

/**
 * The fitted salary of a skill, before noise: the least squares line of the three examples
 * of GDD section 102, whose coefficients live in `shared/config/workers.ts`.
 *
 * Exported because it is the centre of the band the tests assert against: a generated salary
 * is correct exactly when it sits inside this value times the noise factor, and the three
 * published examples of GDD section 102 have to be reachable from it.
 */
export function fittedSalary(skillBp: Bp): Money {
  return Money.add(SALARY_INTERCEPT, Money.mulRatio(SALARY_PER_SKILL_POINT, bpToPercent(skillBp)));
}

/**
 * Multiplicative noise factor of a draw, inside `1 +/- SALARY_NOISE_BP` (GDD section 102
 * asks for noise without quantifying it; the half width is justified in the catalogue).
 */
export function salaryNoiseFactor(unit: number): number {
  const halfWidth = SALARY_NOISE_BP / 10_000;
  return 1 + (2 * unit - 1) * halfWidth;
}

/**
 * Asking salary of a candidate: the fitted line perturbed by noise and floored.
 *
 * The floor is applied last and never the intercept: with the fitted line the cheapest
 * candidate the range can produce asks 4.75 per game hour and noise could push it lower,
 * and free labour would remove the cash flow tension GDD section 118 is built on.
 */
export function askingSalary(skillBp: Bp, noiseUnit: number): Money {
  const noisy = Money.mulRatio(fittedSalary(skillBp), salaryNoiseFactor(noiseUnit));
  return Money.max(SALARY_FLOOR, noisy);
}

// ---------------------------------------------------------------------------
// The candidate
// ---------------------------------------------------------------------------

/** A candidate as the generator produces it, before it becomes a row. */
export interface GeneratedCandidate {
  readonly name: string;
  readonly skillBp: Bp;
  readonly askingSalaryPerGameHour: Money;
}

/** What identifies one pool: the world, the player and the instant it was listed at. */
export interface PoolSeed {
  readonly worldSeed: number;
  readonly playerId: string;
  readonly listedAtGameMs: GameMs;
}

function nameOf(worldSeed: number, playerHash: number, generation: number, slot: number): string {
  const first =
    CANDIDATE_FIRST_NAMES[
      draw(worldSeed, playerHash, generation, slot, Salt.FIRST_NAME) % CANDIDATE_FIRST_NAMES.length
    ];
  const last =
    CANDIDATE_LAST_NAMES[
      draw(worldSeed, playerHash, generation, slot, Salt.LAST_NAME) % CANDIDATE_LAST_NAMES.length
    ];
  // The two tables are non empty constants, so the indices always resolve; the fallback
  // exists because `noUncheckedIndexedAccess` cannot know that.
  return `${first ?? 'Anonimo'} ${last ?? 'Sin nombre'}`;
}

/** One candidate of a pool. Pure: same seed and same slot, same candidate. */
export function generateCandidate(seed: PoolSeed, slot: number): GeneratedCandidate {
  const playerHash = hashText(seed.playerId);
  const generation = poolGeneration(seed.listedAtGameMs);
  const skillBp = candidateSkillBp(
    unitDraw(seed.worldSeed, playerHash, generation, slot, Salt.SKILL),
  );
  const noiseUnit = unitDraw(seed.worldSeed, playerHash, generation, slot, Salt.SALARY_NOISE);
  return {
    name: nameOf(seed.worldSeed, playerHash, generation, slot),
    skillBp,
    askingSalaryPerGameHour: askingSalary(skillBp, noiseUnit),
  };
}

/**
 * A whole pool: `POOL_SIZE` candidates (GDD section 102 illustrates it with three).
 *
 * Two candidates of one pool may draw the same name, which happens for about one pool in a
 * hundred with the twenty four given names and the twenty surnames of the catalogue. The
 * collision is resolved by shifting the surname of the later one by one position, which
 * keeps the whole function pure and total and avoids a pool that reads as a bug.
 */
export function generatePool(
  seed: PoolSeed,
  size: number = POOL_SIZE,
): readonly GeneratedCandidate[] {
  const taken = new Set<string>();
  const candidates: GeneratedCandidate[] = [];
  for (let slot = 0; slot < size; slot += 1) {
    const candidate = generateCandidate(seed, slot);
    candidates.push({ ...candidate, name: uniqueName(candidate.name, taken) });
  }
  return candidates;
}

/** The name, or the next surname of the catalogue when this one is already in the pool. */
function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) {
    taken.add(name);
    return name;
  }
  const [first = '', last = ''] = splitName(name);
  const start = CANDIDATE_LAST_NAMES.indexOf(last);
  for (let step = 1; step <= CANDIDATE_LAST_NAMES.length; step += 1) {
    const next = CANDIDATE_LAST_NAMES[(start + step) % CANDIDATE_LAST_NAMES.length] ?? last;
    const candidate = `${first} ${next}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  taken.add(name);
  return name;
}

function splitName(name: string): readonly [string, string] {
  const index = name.indexOf(' ');
  return index < 0 ? [name, ''] : [name.slice(0, index), name.slice(index + 1)];
}

/** The skill band of GDD section 102, exported so a test asserts against the source. */
export const POOL_SKILL_BAND: { readonly minBp: Bp; readonly maxBp: Bp } = {
  minBp: POOL_SKILL_MIN_BP,
  maxBp: POOL_SKILL_MAX_BP,
};
