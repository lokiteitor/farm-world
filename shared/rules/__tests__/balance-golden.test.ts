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

// Golden balance test: the published figures of GDD sections 117, 118, 119 and 138
// recomputed from the catalogue, with every deviation asserted at its real value.
//
// The rule of plan section 2.2 applies throughout: the catalogue constants are
// authoritative and are implemented literally, and the derived figures that do not
// reproduce are documented as deviations rather than adjusted. This test is therefore
// not a gate to be turned green by tuning: it is the executable record of which numbers
// of the GDD come out of the GDD's own catalogue and which do not.

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

  it('deviation: the combined maintenance rate is 37 per hour and not about 70', () => {
    // GDD section 118 assumes "~$70/h combined" maintenance. The catalogue of GDD
    // section 89 gives maintenance only to the tractor (12) and the combine (25); the
    // implements declare none, so the real rate is 37. Taken literally, as plan section
    // 2.2 requires; nothing is tuned.
    const combined = Money.sum(
      SCENARIO.machines.map((type) => MACHINE_CATALOGUE[type].maintenanceCostPerGameHour),
    );
    expect(combined).toBe(Money.fromUnits(37));
    // 37 x 325.3417 = 12 037.6442, against the 22 750 of GDD section 118.
    expect(kpis.holding.maintenance).toBe(Money.fromString('12037.6442'));
  });

  it('deviation: the wage of 15 per hour is not reproducible from the pool rule of GDD 102', () => {
    // The scenario uses the 15 $/h that GDD sections 117 and 118 state. The procedural
    // rule of GDD section 102, fitted in shared/config/workers, gives 22.75 $/h for the
    // 70 % skill that the durations of GDD section 118 imply and 18.25 $/h for the
    // "~60 %" that GDD section 117 mentions for the same worker. The three figures
    // cannot all hold; the catalogue keeps the procedural rule and the balance report
    // records the other two as not reproducible.
    expect(SCENARIO.workers[0]?.salaryPerGameHour).toBe(Money.fromUnits(15));
    // 15 x 325.3417 = 4 880.1260, against the 4 875 of GDD section 118, which multiplies
    // by the rounded 325 h.
    expect(kpis.holding.wages).toBe(Money.fromString('4880.1260'));
  });

  it('deviation: GDD 118 omits the operating cost, which is 8 771 over the cycle', () => {
    // GDD sections 94, 107 and 114 are explicit that operation is paid on top of
    // possession while a machine works. GDD section 118 counts only salary and
    // maintenance, so its total is missing this category entirely.
    expect(kpis.holding.operating).toBe(Money.fromString('8771.0084'));
  });

  it('the real holding cost per cycle is 25 688.78, against the 27 625 published', () => {
    expect(kpis.holding.total).toBe(Money.fromString('25688.7786'));
    // The two errors nearly cancel: the maintenance the catalogue does not support is
    // about 10 712 too high in the GDD, and the operating cost it forgets is about
    // 8 771, so the published total is only about 7 % above the real one.
    const published = Money.fromUnits(27_625);
    const gap = Money.sub(published, kpis.holding.total);
    expect(gap).toBe(Money.fromString('1936.2214'));
  });

  it('confirms that the holding cost exceeds the cushion, as GDD 118 intends', () => {
    expect(Money.compare(kpis.holding.total, kpis.capitalCushionAfterSetup)).toBe(1);
  });
});

describe('GDD section 119, revenue of the first harvest', () => {
  it('reproduces 20 700 L and 4 554 exactly under the weed level the GDD assumes', () => {
    const withGddWeeds = balanceKpis({ ...SCENARIO, weedLevelAtHarvestBp: bp(2000) });
    // 250 x 90 x 1.0 x (1 - 0.08) = 20 700 L.
    expect(withGddWeeds.yield.baseLiters).toBe(22_500);
    expect(withGddWeeds.yield.weedPenalty).toBeCloseTo(0.08, 12);
    expect(withGddWeeds.yield.liters).toBe(20_700);
    // 20 700 x 0.22 = 4 554.
    expect(withGddWeeds.revenuePerCycle).toBe(Money.fromUnits(4_554));
    expect(cropSaleRevenue(WHEAT, 20_700)).toBe(Money.fromUnits(4_554));
  });

  it('deviation: the published weed rate saturates the level, so the penalty is 50 % and not 8 %', () => {
    const kpis = balanceKpis(SCENARIO);
    // Weeds grow while the field is virgin, growing, or ready and not harvested (GDD
    // section 78), which over this cycle is 70.03 + 78 + 98.04 = 246.07 game hours. At
    // the 0.6 %/h of GDD section 82 that is 147.6 %, so the level saturates at 100 %
    // and the penalty is the maximum of GDD section 78.
    expect(kpis.weedGrowingGameHours).toBeCloseTo(246.0672, 4);
    expect(kpis.weedLevelAtHarvestBp).toBe(10_000);
    expect(kpis.yield.weedPenalty).toBe(0.5);
    expect(kpis.yield.liters).toBe(11_250);
    expect(kpis.revenuePerCycle).toBe(Money.fromUnits(2_475));
  });

  it('quantifies the finding: cultivating cannot avoid saturation on a field this size', () => {
    // Cultivating resets the weeds (GDD section 89), so the only stretch that matters
    // afterwards is growth plus the time the ready field waits to be harvested. On 250
    // cells that is already 176.04 h against the 166.67 h the published rate needs to
    // saturate, so the reset buys nothing: the maximum penalty is unavoidable. Field size
    // is therefore the real lever, and the threshold is arithmetic and not a guess.
    const saturationGameHours = 10_000 / WHEAT.weedGrowthBpPerGameHour;
    expect(saturationGameHours).toBeCloseTo(166.6667, 4);
    const harvestGameHours = estimateTaskDuration({
      operation: 'HARVEST',
      units: SCENARIO.fieldCells,
      conditionBp: SCENARIO.machineConditionBp,
      skillBp: SCENARIO.operatorSkillBp,
    }).durationGameHours;
    expect(WHEAT.phaseDurationsGameHours.GROWING + harvestGameHours).toBeCloseTo(176.0392, 4);
    expect(WHEAT.phaseDurationsGameHours.GROWING + harvestGameHours).toBeGreaterThan(
      saturationGameHours,
    );

    // A field of 120 cells stays below saturation even counting the plowing, during which
    // the field is still virgin and the weeds are already growing.
    const smaller = balanceKpis({ ...SCENARIO, fieldCells: 120 });
    expect(smaller.weedGrowingGameHours).toBeCloseTo(158.6723, 4);
    expect(smaller.weedLevelAtHarvestBp).toBe(9520);
    expect(smaller.yield.weedPenalty).toBeCloseTo(0.4712, 4);
  });
});

describe('GDD sections 121 and 125, the six KPIs', () => {
  const kpis = balanceKpis(SCENARIO);

  it('has no break-even with the unadjusted values, which GDD 121 calls out', () => {
    expect(Money.isNegative(kpis.netPerCycle)).toBe(true);
    expect(kpis.breakEvenCycles).toBeNull();
    expect(kpis.gameHoursToFirstBreakEven).toBeNull();
    expect(breakEvenCycles(kpis.setup.total, kpis.revenuePerCycle, kpis.holding.total)).toBeNull();
  });

  it('reports a revenue to cost ratio of 0.096 against the target of 1.3 to 1.8', () => {
    expect(kpis.revenueToCostRatio).toBeCloseTo(0.0963, 4);
  });

  it('deviation: even the staggered purchase of GDD 120 does not reach break-even', () => {
    // GDD section 120 recommends combining lever A (lower possession cost through
    // staggered purchase) with lever C (a shorter cycle). Buying each machine when its
    // phase starts cuts the holding cost from 25 689 to 20 006, and the ratio only rises
    // from 0.096 to 0.124: the shortfall is an order of magnitude, not a margin.
    const staggered = balanceKpis({ ...SCENARIO, ownershipMode: 'STAGGERED' });
    expect(staggered.holding.total).toBe(Money.fromString('20006.2156'));
    expect(staggered.holding.maintenance).toBe(Money.fromString('6355.0812'));
    expect(staggered.revenueToCostRatio).toBeCloseTo(0.1237, 4);
    expect(staggered.breakEvenCycles).toBeNull();
  });

  it('exposes the six KPIs of GDD section 125 as one object', () => {
    expect(kpis.minimumSetupCost).toBe(Money.fromUnits(146_100));
    expect(kpis.holdingCostPerCycle).toBe(Money.fromString('25688.7786'));
    expect(kpis.revenuePerCycle).toBe(Money.fromUnits(2_475));
    expect(kpis.revenueToCostRatio).not.toBeNull();
    expect(kpis.gameHoursToFirstBreakEven).toBeNull();
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
