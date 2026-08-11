import { describe, expect, it } from 'vitest';
import { WHEAT } from '../../config/crops.js';
import { CropCycleState } from '../../domain/enums.js';
import { BP_ONE, BP_ZERO, bp, gameMs } from '../../domain/units.js';
import {
  fertilityAfterHarvest,
  fertilityToYield,
  fertilizationToYield,
  finalYieldLiters,
  growthProgressBp,
  projectCropPhase,
  projectFallowFertility,
  projectWeedLevel,
  weedToYieldPenalty,
} from '../yield.js';

const HOUR = 3_600_000n;
const at = (hours: number): ReturnType<typeof gameMs> =>
  gameMs(BigInt(Math.round(hours * 3_600_000)));

describe('yield multipliers', () => {
  it('reads the three curves of GDD sections 77, 78 and 79', () => {
    expect(fertilityToYield(BP_ONE)).toBe(1);
    expect(fertilityToYield(bp(5_000))).toBe(0.65);
    expect(weedToYieldPenalty(BP_ZERO)).toBe(0);
    expect(weedToYieldPenalty(BP_ONE)).toBe(0.5);
    expect(fertilizationToYield(BP_ZERO)).toBe(1);
    expect(fertilizationToYield(BP_ONE)).toBe(1);
  });
});

describe('finalYieldLiters (GDD section 83)', () => {
  const base = {
    cellCount: 250,
    crop: WHEAT,
    fertilityBp: BP_ONE,
    fertilizationBp: BP_ONE,
    weedLevelBp: BP_ZERO,
  };

  it('multiplies the base yield by every factor in the published order', () => {
    expect(finalYieldLiters(base).liters).toBe(22_500);
    expect(finalYieldLiters({ ...base, weedLevelBp: bp(2_000) }).liters).toBe(20_700);
    expect(finalYieldLiters({ ...base, weedLevelBp: BP_ONE }).liters).toBe(11_250);
    // Fertility at 85 %, which is where one wheat cycle leaves the field (GDD section 84).
    expect(finalYieldLiters({ ...base, fertilityBp: bp(8_500) }).liters).toBe(20_137);
  });

  it('compounds fertility and weeds, which is the combination of GDD section 79', () => {
    // 22 500 x 0.65 x (1 - 0.2) = 11 700.
    expect(
      finalYieldLiters({ ...base, fertilityBp: bp(5_000), weedLevelBp: bp(5_000) }).liters,
    ).toBe(11_700);
  });

  it('returns whole litres, truncated, so the silo never gains a litre from rounding', () => {
    const breakdown = finalYieldLiters({ ...base, cellCount: 7, fertilityBp: bp(3_333) });
    expect(Number.isInteger(breakdown.liters)).toBe(true);
    expect(breakdown.liters).toBeLessThanOrEqual(
      breakdown.baseLiters * breakdown.fertilityMultiplier,
    );
  });

  it('is zero for an empty or negative cell count instead of failing', () => {
    expect(finalYieldLiters({ ...base, cellCount: 0 }).liters).toBe(0);
    expect(finalYieldLiters({ ...base, cellCount: -5 }).liters).toBe(0);
  });

  it('scales linearly with the area, which is the argument of GDD section 122', () => {
    const small = finalYieldLiters({ ...base, cellCount: 250 }).liters;
    const large = finalYieldLiters({ ...base, cellCount: 500 }).liters;
    expect(large).toBe(small * 2);
  });
});

describe('projectCropPhase (GDD section 76)', () => {
  const seeded = at(0);

  it('walks the three timed phases and then stops at ready to harvest', () => {
    expect(projectCropPhase(seeded, at(0)).state).toBe(CropCycleState.SEEDED);
    expect(projectCropPhase(seeded, at(5.9)).state).toBe(CropCycleState.SEEDED);
    // The 6 h to germinate is the one intermediate figure GDD section 84 publishes.
    expect(projectCropPhase(seeded, at(6)).state).toBe(CropCycleState.GERMINATING);
    expect(projectCropPhase(seeded, at(17.9)).state).toBe(CropCycleState.GERMINATING);
    expect(projectCropPhase(seeded, at(18)).state).toBe(CropCycleState.GROWING);
    expect(projectCropPhase(seeded, at(95.9)).state).toBe(CropCycleState.GROWING);
    // The 96 h total is `growthDuration` of GDD section 82.
    expect(projectCropPhase(seeded, at(96)).state).toBe(CropCycleState.READY_TO_HARVEST);
    expect(projectCropPhase(seeded, at(10_000)).state).toBe(CropCycleState.READY_TO_HARVEST);
  });

  it('reports the instant the phase was entered and the next boundary', () => {
    const growing = projectCropPhase(seeded, at(50));
    expect(growing.state).toBe(CropCycleState.GROWING);
    expect(growing.enteredAtGameMs).toBe(at(18));
    expect(growing.nextBoundaryGameMs).toBe(at(96));
    const ready = projectCropPhase(seeded, at(200));
    expect(ready.enteredAtGameMs).toBe(at(96));
    expect(ready.nextBoundaryGameMs).toBeNull();
  });

  it('treats an instant before sowing as the moment of sowing', () => {
    const projection = projectCropPhase(at(10), at(0));
    expect(projection.state).toBe(CropCycleState.SEEDED);
    expect(projection.enteredAtGameMs).toBe(at(10));
    expect(projection.growthProgressBp).toBe(BP_ZERO);
  });

  it('reports growth progress over the whole timed part (GDD section 80)', () => {
    expect(growthProgressBp(seeded, at(0))).toBe(0);
    expect(growthProgressBp(seeded, at(48))).toBe(5_000);
    expect(growthProgressBp(seeded, at(96))).toBe(BP_ONE);
    expect(growthProgressBp(seeded, at(500))).toBe(BP_ONE);
  });
});

describe('projectWeedLevel (GDD section 78)', () => {
  it('grows at the published rate while the field is in a growing state', () => {
    // 0.6 %/h, that is 60 basis points per game hour (GDD section 82).
    const level = projectWeedLevel({
      weedLevelBp: BP_ZERO,
      updatedAtGameMs: at(0),
      toGameMs: at(100),
      cropCycleState: CropCycleState.GROWING,
      crop: WHEAT,
    });
    expect(level).toBe(6_000);
  });

  it('saturates at 100 % rather than overshooting', () => {
    expect(
      projectWeedLevel({
        weedLevelBp: BP_ZERO,
        updatedAtGameMs: at(0),
        toGameMs: at(500),
        cropCycleState: CropCycleState.READY_TO_HARVEST,
        crop: WHEAT,
      }),
    ).toBe(BP_ONE);
  });

  it('does not move while the field is plowed, seeded or germinating', () => {
    for (const state of [
      CropCycleState.PLOWED,
      CropCycleState.CULTIVATED,
      CropCycleState.SEEDED,
      CropCycleState.GERMINATING,
      CropCycleState.HARVESTED,
    ]) {
      expect(
        projectWeedLevel({
          weedLevelBp: bp(1_000),
          updatedAtGameMs: at(0),
          toGameMs: at(1_000),
          cropCycleState: state,
          crop: WHEAT,
        }),
      ).toBe(1_000);
    }
  });

  it('grows on virgin land, which is why plowing time already costs yield', () => {
    expect(
      projectWeedLevel({
        weedLevelBp: BP_ZERO,
        updatedAtGameMs: at(0),
        toGameMs: at(70.028),
        cropCycleState: CropCycleState.VIRGIN,
        crop: WHEAT,
      }),
    ).toBe(4_201);
  });

  it('truncates rather than rounding up, so a settlement never grants extra weed', () => {
    // One game minute at 60 bp/h is exactly one basis point; half a minute is none.
    const oneMinute = projectWeedLevel({
      weedLevelBp: BP_ZERO,
      updatedAtGameMs: gameMs(0n),
      toGameMs: gameMs(60_000n),
      cropCycleState: CropCycleState.GROWING,
      crop: WHEAT,
    });
    expect(oneMinute).toBe(1);
    const halfMinute = projectWeedLevel({
      weedLevelBp: BP_ZERO,
      updatedAtGameMs: gameMs(0n),
      toGameMs: gameMs(30_000n),
      cropCycleState: CropCycleState.GROWING,
      crop: WHEAT,
    });
    expect(halfMinute).toBe(0);
  });

  it('is unaffected by an inverted interval', () => {
    expect(
      projectWeedLevel({
        weedLevelBp: bp(500),
        updatedAtGameMs: at(100),
        toGameMs: at(10),
        cropCycleState: CropCycleState.GROWING,
        crop: WHEAT,
      }),
    ).toBe(500);
  });
});

describe('fertility (GDD section 77)', () => {
  it('drops by the drain of the crop on each harvest', () => {
    // 15 % per cycle (GDD sections 77 and 82), which is the 100 -> 85 of GDD section 84.
    expect(fertilityAfterHarvest(BP_ONE, WHEAT)).toBe(8_500);
    expect(fertilityAfterHarvest(bp(8_500), WHEAT)).toBe(7_000);
    // Six cycles take a field from full fertility to depletion, which is why fallow
    // recovery has to exist (plan section 2.2).
    let level = BP_ONE;
    for (let cycle = 0; cycle < 7; cycle += 1) {
      level = fertilityAfterHarvest(level, WHEAT);
    }
    expect(level).toBe(0);
  });

  it('recovers only while the field lies fallow', () => {
    // 5 bp per game hour: 300 fallow hours restore the 1 500 bp one cycle drains.
    expect(
      projectFallowFertility({
        fertilityBp: bp(8_500),
        updatedAtGameMs: at(0),
        toGameMs: at(300),
        cropCycleState: CropCycleState.VIRGIN,
        crop: WHEAT,
      }),
    ).toBe(BP_ONE);
    expect(
      projectFallowFertility({
        fertilityBp: bp(8_500),
        updatedAtGameMs: at(0),
        toGameMs: at(300),
        cropCycleState: CropCycleState.GROWING,
        crop: WHEAT,
      }),
    ).toBe(8_500);
  });

  it('saturates at full fertility', () => {
    expect(
      projectFallowFertility({
        fertilityBp: bp(9_900),
        updatedAtGameMs: gameMs(0n),
        toGameMs: gameMs(10_000n * HOUR),
        cropCycleState: CropCycleState.VIRGIN,
        crop: WHEAT,
      }),
    ).toBe(BP_ONE);
  });
});
