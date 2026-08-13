// The effect of the weed rate of GDD section 82 on the yield of the first cycle.
//
// Owner: workflow W5-C. Tool `tools/balance`.
//
// This was the main finding of the original report: GDD section 82 gives
// `weedGrowthRate: 0.6 %/h`, GDD section 118 gives a cycle of about 325 game hours, and GDD
// section 119 then assumes "about 20 % accumulated in 325 h without cultivating". With weeds
// growing over the whole cycle the level saturated at 100 % and the penalty was the maximum
// 50 %. The balance revision of 2026-08 (docs/balance/revision-2026-08.md) adopted the strict
// reading of finding H8: only `GROWING` accumulates, so the level at harvest is now 46.8 %,
// in the order of what GDD section 119 assumes.
//
// Nothing here changes a constant. The module measures the consequence exactly, including
// the question a designer would ask next: what the optional `CULTIVATE` of GDD section 82,
// whose side effect is resetting the weeds, buys the player. Under the H8 reading the answer
// is nothing for the harvest: `GROWING` always starts after sowing, so a reset before sowing
// leaves the level at harvest untouched. The figures below make that measurable.
//
// The hours that count come from `WEED_GROWTH_STATES`, so a change to that list moves every
// figure of this module instead of leaving the report quoting an old reading.

import { WHEAT, type CropDefinition } from '../../shared/config/crops.js';
import { WEED_GROWTH_STATES, WEED_LEVEL_MAX_BP } from '../../shared/config/transitions.js';
import { Money } from '../../shared/domain/money.js';
import { clampBp, type Bp } from '../../shared/domain/units.js';
import { cyclePhases, type BalanceScenario } from '../../shared/rules/balance.js';
import { cropSaleRevenue } from '../../shared/rules/pricing.js';
import { finalYieldLiters } from '../../shared/rules/yield.js';

export interface WeedAnalysis {
  /** Rate of GDD section 82, in basis points per game hour. */
  readonly ratePerGameHourBp: number;
  /** Game hours of the cycle in which weeds grow (GDD section 78). */
  readonly growingGameHours: number;
  /** Game hours of the whole cycle, for the contrast. */
  readonly cycleGameHours: number;
  /** Level the rate would reach with no ceiling, which is the figure that shows the gap. */
  readonly unclampedLevelBp: number;
  /** Level actually reached, saturated at 100 % (`WEED_LEVEL_MAX_BP`). */
  readonly levelAtHarvestBp: Bp;
  /** Game hours the rate needs to saturate from zero. */
  readonly saturationGameHours: number;
  /** Penalty of GDD section 78 at that level. */
  readonly penalty: number;
  /** Litres the cycle yields with it. */
  readonly liters: number;
  readonly revenue: Money;

  /** The same three figures under the assumption of GDD section 119. */
  readonly publishedLevelBp: Bp;
  readonly publishedPenalty: number;
  readonly publishedLiters: number;
  readonly publishedRevenue: Money;

  /** What the yield loses to the difference between the two, in litres and in money. */
  readonly litersLost: number;
  readonly revenueLost: Money;

  /** Weed growing hours that remain after sowing, which is what `CULTIVATE` cannot avoid. */
  readonly growingGameHoursAfterSowing: number;
  /** Level reached from a reset at sowing time. */
  readonly levelAfterCultivateBp: Bp;
  /** Whether resetting the weeds before sowing avoids the ceiling at all. */
  readonly cultivateAvoidsSaturation: boolean;
  /** Rate that would keep the level of GDD section 119 at harvest, for reference only. */
  readonly rateThatWouldReachPublishedLevelBp: number;
}

/**
 * Measures the effect, with everything derived from the catalogue.
 *
 * Nothing here writes a constant back. `rateThatWouldReachPublishedLevelBp` is reported
 * because a balance report has to say what the lever would have to be worth; the revision
 * of 2026-08 kept the rate of GDD section 82 and corrected the accumulation states instead.
 */
export function analyseWeeds(
  scenario: BalanceScenario,
  crop: CropDefinition = WHEAT,
  publishedLevelBp: Bp = clampBp(2_000),
): WeedAnalysis {
  const phases = cyclePhases(scenario, crop);
  const cycleGameHours = phases.reduce((total, phase) => total + phase.gameHours, 0);
  const growingGameHours = phases
    .filter((phase) => WEED_GROWTH_STATES.includes(phase.state))
    .reduce((total, phase) => total + phase.gameHours, 0);

  // Everything after the field has been sown, which is what a reset before sowing leaves
  // untouched: the growth phases and the harvesting task.
  const sowingIndex = phases.findIndex((phase) => phase.operation === 'SEED');
  const growingGameHoursAfterSowing = phases
    .slice(sowingIndex + 1)
    .filter((phase) => WEED_GROWTH_STATES.includes(phase.state))
    .reduce((total, phase) => total + phase.gameHours, 0);

  const rate = crop.weedGrowthBpPerGameHour;
  const unclampedLevelBp = rate * growingGameHours;
  const levelAtHarvestBp = clampBp(scenario.initialWeedLevelBp + unclampedLevelBp);
  const levelAfterCultivateBp = clampBp(rate * growingGameHoursAfterSowing);
  const saturationGameHours = rate === 0 ? Number.POSITIVE_INFINITY : WEED_LEVEL_MAX_BP / rate;

  const reached = yieldAt(scenario, crop, levelAtHarvestBp);
  const published = yieldAt(scenario, crop, publishedLevelBp);

  return {
    ratePerGameHourBp: rate,
    growingGameHours,
    cycleGameHours,
    unclampedLevelBp,
    levelAtHarvestBp,
    saturationGameHours,
    penalty: reached.penalty,
    liters: reached.liters,
    revenue: reached.revenue,
    publishedLevelBp,
    publishedPenalty: published.penalty,
    publishedLiters: published.liters,
    publishedRevenue: published.revenue,
    litersLost: published.liters - reached.liters,
    revenueLost: Money.sub(published.revenue, reached.revenue),
    growingGameHoursAfterSowing,
    levelAfterCultivateBp,
    cultivateAvoidsSaturation: levelAfterCultivateBp < WEED_LEVEL_MAX_BP,
    rateThatWouldReachPublishedLevelBp:
      growingGameHours === 0 ? 0 : publishedLevelBp / growingGameHours,
  };
}

/** The yield of the cycle at one weed level, with everything else held at the scenario. */
function yieldAt(
  scenario: BalanceScenario,
  crop: CropDefinition,
  weedLevelBp: Bp,
): { readonly penalty: number; readonly liters: number; readonly revenue: Money } {
  const breakdown = finalYieldLiters({
    cellCount: scenario.fieldCells,
    crop,
    fertilityBp: scenario.fertilityBp,
    fertilizationBp: scenario.fertilizationBp,
    weedLevelBp,
  });
  return {
    penalty: breakdown.weedPenalty,
    liters: breakdown.liters,
    revenue: cropSaleRevenue(crop, breakdown.liters),
  };
}

/** The states in which weeds grow (GDD section 78), for the report to name them. */
export const WEED_STATES_LABEL: readonly string[] = [...WEED_GROWTH_STATES];
