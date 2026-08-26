// What the sixty two crops are worth, measured with the engine and not by hand.
//
// Owner: workflow W2 (pure rules).
//
// The catalogue is not balanced crop by crop by a person reading a table. The families set
// a target of net margin per game hour, the prices were derived from it against this very
// engine, and this file is what keeps that true: a crop that would be a trap or a crop that
// would dominate the catalogue fails the suite instead of reaching a player.
//
// Measured on `MINIMUM_SETUP_SCENARIO`, which is the setup of GDD section 117: the same
// land, buildings, machinery and worker for every crop. Only the crop changes, so what is
// compared is the crops and nothing else.
//
// Net margin per game hour and not per cycle, because that is what compares two crops of
// unlike length: a long cycle with a bigger margin per cycle can be worth less than a short
// one that comes round twice as often.

import { describe, expect, it } from 'vitest';
import { CROPS } from '../../config/crops/index.js';
import { CROP_IDS, SEASONS, type CropId } from '../../domain/enums.js';
import { Money } from '../../domain/money.js';
import { balanceKpis, MINIMUM_SETUP_SCENARIO } from '../balance.js';

/** Net margin per game hour of one crop on the reference setup. */
function marginPerGameHour(cropId: CropId): number {
  const kpis = balanceKpis({ ...MINIMUM_SETUP_SCENARIO, cropId });
  return kpis.cycleGameHours <= 0
    ? 0
    : Number(Money.toString(kpis.netPerCycle)) / kpis.cycleGameHours;
}

const MARGINS = new Map(CROP_IDS.map((cropId) => [cropId, marginPerGameHour(cropId)]));

describe('the economics of the catalogue', () => {
  it('leaves no crop that loses money on the reference setup', () => {
    // A crop with a negative margin is a trap: nothing in the interface would warn the
    // player, and the loss only shows up a cycle later.
    for (const [cropId, margin] of MARGINS) {
      expect(margin, cropId).toBeGreaterThan(0);
    }
  });

  it('keeps wheat where the balance revision left it', () => {
    // The anchor of the whole catalogue. Every other price was derived relative to this
    // one, and the golden tests and the published report are built on it.
    const kpis = balanceKpis(MINIMUM_SETUP_SCENARIO);
    expect(Money.toString(kpis.revenuePerCycle)).toBe('16459.2000');
    expect(Money.toString(kpis.netPerCycle)).toBe('264.9565');
  });

  it('holds the spread narrow enough that no crop dominates', () => {
    // Three to one between the best and the worst. Wider than that and the catalogue
    // collapses into one sensible choice and sixty one nobody would sow.
    const sorted = [...MARGINS.values()].sort((left, right) => left - right);
    const lowest = sorted[0] ?? 0;
    const highest = sorted[sorted.length - 1] ?? 0;
    expect(highest / lowest).toBeLessThanOrEqual(3.5);
  });

  it('gives every season something worth sowing', () => {
    // Not merely something sowable, which `catalog.test.ts` already checks: something whose
    // margin is at least half the best of the catalogue, so no season is a dead quarter.
    const best = Math.max(...MARGINS.values());
    for (const season of SEASONS) {
      const viable = CROP_IDS.filter(
        (cropId) =>
          CROPS[cropId].sowingSeasons.includes(season) && (MARGINS.get(cropId) ?? 0) >= best / 2,
      );
      expect(viable.length, season).toBeGreaterThanOrEqual(3);
    }
  });

  it('pays a family more when its harvest needs a store the player does not start with', () => {
    // The silo is part of the starting setup; the cold store is not. A produce crop that
    // paid the same per hour as a cereal would never repay the fourteen thousand its store
    // costs, and nobody would ever grow one.
    const average = (family: string): number => {
      const ids = CROP_IDS.filter((cropId) => CROPS[cropId].family === family);
      return ids.reduce((total, cropId) => total + (MARGINS.get(cropId) ?? 0), 0) / ids.length;
    };
    expect(average('FRUITING')).toBeGreaterThan(average('CEREAL'));
    expect(average('LEAFY')).toBeGreaterThan(average('CEREAL'));
    expect(average('FLOWER')).toBeGreaterThan(average('CEREAL'));
  });
});
