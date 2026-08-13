import { describe, expect, it } from 'vitest';
import { BUILDING_CATALOGUE } from '../../config/buildings.js';
import { WHEAT } from '../../config/crops.js';
import { STARTING_CAPITAL } from '../../config/economy.js';
import { NATURAL_FOREST, PINE } from '../../config/forestry.js';
import { MACHINE_CATALOGUE } from '../../config/machines.js';
import { Money } from '../../domain/money.js';
import { bp } from '../../domain/units.js';
import { MINIMUM_SETUP_SCENARIO, balanceKpis, breakEvenCycles } from '../balance.js';
import { estimateTaskDuration } from '../duration.js';
import { expectedNaturalForestVolumeDm3 } from '../forestry.js';
import { cropSaleRevenue, landPurchasePrice, woodSaleRevenue } from '../pricing.js';

// Golden balance test: the figures of the revised balance recomputed from the
// catalogue, with every deviation from the GDD asserted at its real value.
//
// Two regimes meet here. The structural figures (setup cost, durations, forestry
// volumes) still reproduce GDD sections 117, 118 and 138 literally. The economic
// rates (sale price, running costs, salaries, weed accumulation) follow the balance
// revision of 2026-08 (docs/balance/revision-2026-08.md), which replaced the literal
// GDD values after docs/balance/informe-para-revision.md showed they left the first
// cycle an order of magnitude short of the GDD's own target. This test is the
// executable record of the revised balance: a change in any constant moves a figure
// here and must be deliberate.

const SCENARIO = MINIMUM_SETUP_SCENARIO;

describe('GDD section 117, minimum viable setup', () => {
  const kpis = balanceKpis(SCENARIO);

  it('reproduces the land, buildings, machinery and total exactly', () => {
    // 330 cells x 120 = 39 600.
    expect(kpis.setup.landCells).toBe(330);
    expect(kpis.setup.land).toBe(Money.fromUnits(39_600));
    // Garage 8 000 + silo 10 000 + worker home 5 000 = 23 000.
    expect(kpis.setup.buildings).toBe(Money.fromUnits(23_000));
    // Tractor 18 000 + plow 6 500 + seeder 9 800 + harvester 42 000 + trailer 7 200.
    expect(kpis.setup.machinery).toBe(Money.fromUnits(83_500));
    expect(kpis.setup.total).toBe(Money.fromUnits(146_100));
  });

  it('reproduces the cushion of 13 900 over the starting capital of 160 000', () => {
    expect(STARTING_CAPITAL).toBe(Money.fromUnits(160_000));
    expect(kpis.capitalCushionAfterSetup).toBe(Money.fromUnits(13_900));
  });

  it('agrees with the footprint the building catalogue adds up to', () => {
    const footprint =
      BUILDING_CATALOGUE.GARAGE.footprintCells +
      BUILDING_CATALOGUE.SILO.footprintCells +
      BUILDING_CATALOGUE.WORKER_HOME.footprintCells;
    expect(footprint).toBe(SCENARIO.farmFootprintCells);
  });

  it('prices the land through the same formula the purchase endpoint uses', () => {
    const terrains = Array.from({ length: 330 }, () => 'GRASS' as const);
    expect(landPurchasePrice(terrains).total).toBe(kpis.setup.land);
  });
});

describe('GDD section 118, cost of sustaining the first cycle', () => {
  const kpis = balanceKpis(SCENARIO);
  const phases = kpis.phases;

  it('reproduces the four phase durations, which the GDD rounds to whole hours', () => {
    // 250 / (4.2 x 0.85) = 70.028, published as about 70 h.
    expect(phases[0]?.operation).toBe('PLOW');
    expect(phases[0]?.gameHours).toBeCloseTo(70.028, 3);
    // 250 / (4.8 x 0.85) = 61.2745, published as about 61 h.
    expect(phases[1]?.operation).toBe('SEED');
    expect(phases[1]?.gameHours).toBeCloseTo(61.2745, 4);
    // The three timed phases add up to the 96 h of GDD section 82.
    expect(
      (phases[2]?.gameHours ?? 0) + (phases[3]?.gameHours ?? 0) + (phases[4]?.gameHours ?? 0),
    ).toBe(96);
    // 250 / (3.0 x 0.85) = 98.0392, published as about 98 h.
    expect(phases[5]?.operation).toBe('HARVEST');
    expect(phases[5]?.gameHours).toBeCloseTo(98.0392, 4);
  });

  it('reproduces the cycle length of about 325 game hours', () => {
    expect(kpis.cycleGameHours).toBeCloseTo(325.3417, 4);
    expect(Math.round(kpis.cycleGameHours)).toBe(325);
  });

  it('the combined maintenance rate is 21 per hour after the revision', () => {
    // Only the tractor (6) and the combine (15) carry maintenance; the implements
    // declare none, as in the catalogue of GDD section 89. The rates are half the
    // literal GDD figures, per the balance revision of 2026-08.
    const combined = Money.sum(
      SCENARIO.machines.map((type) => MACHINE_CATALOGUE[type].maintenanceCostPerGameHour),
    );
    expect(combined).toBe(Money.fromUnits(21));
    // 21 x 325.3417 h of cycle.
    expect(kpis.holding.maintenance).toBe(Money.fromString('6832.1765'));
  });

  it('uses the wage the pool rule of GDD 102 actually produces for the 70 % worker', () => {
    // The 15 $/h of GDD section 117 was inconsistent with the procedural rule of GDD
    // section 102. The revised salary line (-6 + 0.31 x skill) prices the 70 % starting
    // worker at 15.70 $/h, and the scenario uses that value so the KPIs measure what
    // the player actually pays.
    expect(SCENARIO.workers[0]?.salaryPerGameHour).toBe(Money.fromString('15.70'));
    expect(kpis.holding.wages).toBe(Money.fromString('5107.8653'));
  });

  it('includes the operating cost that GDD 118 omitted', () => {
    // GDD sections 94, 107 and 114 are explicit that operation is paid on top of
    // possession while a machine works. With the revised rates (tractor 10, combine 30)
    // it is 4 254.20 over the cycle.
    expect(kpis.holding.operating).toBe(Money.fromString('4254.2017'));
  });

  it('the holding cost per cycle is 16 194.24 after the revision', () => {
    expect(kpis.holding.total).toBe(Money.fromString('16194.2435'));
  });

  it('confirms that the holding cost exceeds the cushion, which is the debt dip by design', () => {
    // Deliberate in the revision: the player who buys the whole fleet on day one
    // accrues more than the 13 900 cushion before the harvest is sold, passes through
    // IN_DEBT during the harvest, and the sale rescues the balance. The staggered
    // purchase of GDD section 120 avoids the dip entirely.
    expect(Money.compare(kpis.holding.total, kpis.capitalCushionAfterSetup)).toBe(1);
  });
});

describe('GDD section 119, revenue of the first harvest', () => {
  it('reproduces the 20 700 L of the GDD under the weed level it assumes', () => {
    const withGddWeeds = balanceKpis({ ...SCENARIO, weedLevelAtHarvestBp: bp(2000) });
    // 250 x 90 x 1.0 x (1 - 0.08) = 20 700 L, exactly as GDD section 119 computes.
    // The revenue departs from its 4 554 because the sale price is 0.90 since the
    // balance revision, not the published 0.22.
    expect(withGddWeeds.yield.baseLiters).toBe(22_500);
    expect(withGddWeeds.yield.weedPenalty).toBeCloseTo(0.08, 12);
    expect(withGddWeeds.yield.liters).toBe(20_700);
    expect(withGddWeeds.revenuePerCycle).toBe(Money.fromUnits(18_630));
    expect(cropSaleRevenue(WHEAT, 20_700)).toBe(Money.fromUnits(18_630));
  });

  it('accumulates weeds only during GROWING, the strict reading of finding H8', () => {
    const kpis = balanceKpis(SCENARIO);
    // 78 h of `GROWING` at the 0.6 %/h of GDD section 82: 46.8 % at harvest, in the
    // order of the ~20 % GDD section 119 assumes. Before the revision the plowing and
    // harvesting tasks also accumulated (246.07 h in total) and the level saturated at
    // 100 %, which forced the maximum penalty of 50 % on every cycle.
    expect(kpis.weedGrowingGameHours).toBe(78);
    expect(kpis.weedLevelAtHarvestBp).toBe(4_680);
    expect(kpis.yield.weedPenalty).toBeCloseTo(0.1872, 12);
    expect(kpis.yield.liters).toBe(18_288);
    expect(kpis.revenuePerCycle).toBe(Money.fromString('16459.20'));
  });

  it('records that the weed level no longer depends on field size or on cultivating', () => {
    // Under the strict H8 reading the accumulation window is the fixed 78 h growth
    // phase: task durations are excluded, so a larger field lengthens the cycle but
    // not the window, and cultivating (which resets the level before sowing) has no
    // effect on the harvest because `GROWING` always starts after sowing. Weeds are a
    // flat, predictable levy on the MVP cycle; making them a decision again would need
    // idle-time accumulation, recorded as an open question of the 2026-08 revision.
    const smaller = balanceKpis({ ...SCENARIO, fieldCells: 120 });
    expect(smaller.weedGrowingGameHours).toBe(78);
    expect(smaller.weedLevelAtHarvestBp).toBe(4_680);
    const harvestGameHours = estimateTaskDuration({
      operation: 'HARVEST',
      units: SCENARIO.fieldCells,
      conditionBp: SCENARIO.machineConditionBp,
      skillBp: SCENARIO.operatorSkillBp,
    }).durationGameHours;
    // The excluded stretches are real: harvesting alone is longer than the window.
    expect(harvestGameHours).toBeGreaterThan(78);
  });
});

describe('GDD sections 121 and 125, the six KPIs', () => {
  const kpis = balanceKpis(SCENARIO);

  it('reaches break-even with the revised values, unlike the literal GDD catalogue', () => {
    // The all-upfront purchase is nearly neutral by design (+264.96 per cycle): it
    // exists, but the staggered purchase of GDD section 120 is the strategy that
    // actually pays. Before the revision the net was -23 213 and no break-even existed.
    expect(Money.isNegative(kpis.netPerCycle)).toBe(false);
    expect(kpis.netPerCycle).toBe(Money.fromString('264.9565'));
    expect(kpis.breakEvenCycles).toBeCloseTo(551.41, 2);
    expect(
      breakEvenCycles(kpis.setup.total, kpis.revenuePerCycle, kpis.holding.total),
    ).not.toBeNull();
  });

  it('reports a revenue to cost ratio of 1.016 for the all-upfront purchase', () => {
    expect(kpis.revenueToCostRatio).toBeCloseTo(1.0164, 4);
  });

  it('rewards the staggered purchase of GDD 120 with a ratio of 1.287', () => {
    // Buying each machine when its phase starts cuts the holding cost from 16 194 to
    // 12 785, lifts the net per cycle to 3 674.49, and brings break-even to about 40
    // cycles. The gap between the two ownership modes is the intended teaching of GDD
    // section 120: the recommended strategy is the profitable one.
    const staggered = balanceKpis({ ...SCENARIO, ownershipMode: 'STAGGERED' });
    expect(staggered.holding.total).toBe(Money.fromString('12784.7057'));
    expect(staggered.holding.maintenance).toBe(Money.fromString('3422.6387'));
    expect(staggered.revenueToCostRatio).toBeCloseTo(1.2874, 4);
    expect(staggered.breakEvenCycles).toBeCloseTo(39.76, 2);
  });

  it('exposes the six KPIs of GDD section 125 as one object', () => {
    expect(kpis.minimumSetupCost).toBe(Money.fromUnits(146_100));
    expect(kpis.holdingCostPerCycle).toBe(Money.fromString('16194.2435'));
    expect(kpis.revenuePerCycle).toBe(Money.fromString('16459.20'));
    expect(kpis.revenueToCostRatio).not.toBeNull();
    expect(kpis.gameHoursToFirstBreakEven).not.toBeNull();
    expect(kpis.capitalCushionAfterSetup).toBe(Money.fromUnits(13_900));
  });
});

describe('GDD section 138, forestry economy', () => {
  it('reproduces the minimum forestry setup of 132 500 exactly', () => {
    const plot = landPurchasePrice(Array.from({ length: 250 }, () => 'FOREST' as const)).total;
    // 250 cells x 70 = 17 500.
    expect(plot).toBe(Money.fromUnits(17_500));
    const total = Money.sum([
      plot,
      MACHINE_CATALOGUE.HARVESTER_FORESTRY.purchasePrice,
      MACHINE_CATALOGUE.FORWARDER.purchasePrice,
      BUILDING_CATALOGUE.WOOD_STORAGE.purchasePrice,
    ]);
    expect(total).toBe(Money.fromUnits(132_500));
  });

  it('reproduces the volume and revenue of a first clear cut within a per cent', () => {
    // GDD section 138 estimates 250 trees x about 1.8 m³ x 0.85, that is about 382 m³.
    // The stage mix of the generator gives 382.5 m³ once saplings are excluded, since
    // GDD section 131 gives them no commercial value and forbids felling them.
    const volumeDm3 = expectedNaturalForestVolumeDm3(250, NATURAL_FOREST, PINE);
    expect(volumeDm3).toBe(382_500);
    expect(volumeDm3 / 1000).toBeCloseTo(382.5, 6);
    // 382.5 x 45 = 17 212.50, against the about 17 190 of GDD section 138.
    expect(woodSaleRevenue(PINE, volumeDm3)).toBe(Money.fromString('17212.50'));
  });

  it('confirms the first cut fits in one wood store', () => {
    expect(BUILDING_CATALOGUE.WOOD_STORAGE.capacity).toBe(500_000);
    expect(expectedNaturalForestVolumeDm3(250, NATURAL_FOREST, PINE)).toBeLessThan(500_000);
  });

  it('confirms that forestry is liquid on day one and agriculture is not', () => {
    // The contrast GDD section 138 draws, now as arithmetic: the first cut of a bought
    // forest returns 17 212 against a 132 500 investment with no growth to wait for,
    // while the first agricultural cycle returns 2 475 against a holding cost of 25 689.
    const forestry = woodSaleRevenue(
      PINE,
      expectedNaturalForestVolumeDm3(250, NATURAL_FOREST, PINE),
    );
    const agriculture = balanceKpis(SCENARIO).revenuePerCycle;
    expect(Money.compare(forestry, agriculture)).toBe(1);
  });
});

describe('GDD section 110, the narrative example', () => {
  it('deviation: the example is inconsistent with the table of GDD 91 and with itself', () => {
    // GDD section 110 writes `300 / (4.2 x 0.95 x 0.85) ~ 84h` for a machine at 95 %
    // condition. Two separate problems:
    //
    //   - It uses 0.95 directly as `conditionFactor`, while the table of GDD section 91
    //     maps 50 % to 0.75 and 100 % to 1.0, so 95 % interpolates to 0.975. The table is
    //     authoritative and the rule follows it, giving 86.19 h.
    //   - Its own expression evaluates to 88.46 h, not to the 84 h it states.
    const estimate = estimateTaskDuration({
      operation: 'PLOW',
      units: 300,
      conditionBp: bp(9500),
      skillBp: bp(7000),
    });
    expect(estimate.conditionFactor).toBeCloseTo(0.975, 12);
    expect(estimate.skillFactor).toBeCloseTo(0.85, 12);
    expect(estimate.durationGameHours).toBeCloseTo(86.1883, 4);
    expect(300 / (4.2 * 0.95 * 0.85)).toBeCloseTo(88.4564, 4);
  });
});
