import { describe, expect, it } from 'vitest';
import { NATURAL_FOREST, PINE } from '../../config/forestry.js';
import { TreeGrowthStage, TreeStatus } from '../../domain/enums.js';
import { gameHours, gameMs, type GameMs } from '../../domain/units.js';
import {
  batchWoodVolume,
  batchWoodVolumeM3,
  expectedNaturalForestVolumeDm3,
  isFellable,
  nextStageBoundaryGameMs,
  treeAgeGameHours,
  treeStageAt,
  treeStageBoundaryGameMs,
  treeStageForAge,
  treeWoodVolumeDm3,
  treeWoodVolumeM3,
  type TreeView,
} from '../forestry.js';

// Trees derive everything from the instant they were planted (GDD sections 130, 131 and
// 140). The boundary cases are the whole point: the stage changes exactly at 240, 480 and
// 720 game hours, not at the 960 h that GDD section 133 misreads.

const at = (hours: number): GameMs => gameMs(BigInt(Math.round(hours * 3_600_000)));

function tree(overrides: Partial<TreeView> = {}): TreeView {
  return { species: 'PINE', plantedAtGameMs: at(0), status: TreeStatus.STANDING, ...overrides };
}

describe('treeAgeGameHours', () => {
  it('measures the elapsed game hours since planting', () => {
    expect(treeAgeGameHours(at(0), at(240))).toBe(240);
    expect(treeAgeGameHours(at(100), at(340))).toBe(240);
  });

  it('is zero rather than negative for an instant before planting', () => {
    expect(treeAgeGameHours(at(100), at(0))).toBe(0);
  });
});

describe('treeStageForAge (GDD section 131)', () => {
  it('changes stage exactly at 240, 480 and 720 game hours', () => {
    expect(treeStageForAge(0, PINE)).toBe(TreeGrowthStage.SAPLING);
    expect(treeStageForAge(239.99, PINE)).toBe(TreeGrowthStage.SAPLING);
    expect(treeStageForAge(240, PINE)).toBe(TreeGrowthStage.YOUNG);
    expect(treeStageForAge(479.99, PINE)).toBe(TreeGrowthStage.YOUNG);
    expect(treeStageForAge(480, PINE)).toBe(TreeGrowthStage.MATURE);
    expect(treeStageForAge(719.99, PINE)).toBe(TreeGrowthStage.MATURE);
    // Four stages have three boundaries: the fourth is reached at 720 h, and the 960 h of
    // GDD section 133 is documented as a misreading.
    expect(treeStageForAge(720, PINE)).toBe(TreeGrowthStage.OLD_GROWTH);
    expect(treeStageForAge(960, PINE)).toBe(TreeGrowthStage.OLD_GROWTH);
    expect(treeStageForAge(100_000, PINE)).toBe(TreeGrowthStage.OLD_GROWTH);
  });

  it('treats a negative age as a sapling instead of failing', () => {
    expect(treeStageForAge(-50, PINE)).toBe(TreeGrowthStage.SAPLING);
  });
});

describe('wood volume (GDD section 131)', () => {
  it('publishes the four volumes in cubic decimetres and in cubic metres', () => {
    expect(treeWoodVolumeDm3(tree(), at(0))).toBe(50);
    expect(treeWoodVolumeDm3(tree(), at(240))).toBe(400);
    expect(treeWoodVolumeDm3(tree(), at(480))).toBe(1_800);
    expect(treeWoodVolumeDm3(tree(), at(720))).toBe(2_500);
    expect(treeWoodVolumeM3(tree(), at(480))).toBe(1.8);
    expect(treeWoodVolumeM3(tree(), at(720))).toBe(2.5);
  });

  it('stops growing at the last stage, which is what makes forestry patient capital', () => {
    // GDD section 131: a mature tree is not lost by not felling it on time, it keeps
    // accumulating volume until it stagnates.
    expect(treeWoodVolumeDm3(tree(), at(5_000))).toBe(PINE.maxWoodVolumeDm3);
  });

  it('locates the boundary instants for the milestone job', () => {
    const planted = at(1_000);
    expect(treeStageBoundaryGameMs(planted, TreeGrowthStage.MATURE, PINE)).toBe(at(1_480));
    expect(nextStageBoundaryGameMs(tree({ plantedAtGameMs: planted }), at(1_000))).toBe(at(1_240));
    expect(nextStageBoundaryGameMs(tree({ plantedAtGameMs: planted }), at(1_500))).toBe(at(1_720));
    // Nothing is scheduled once the tree has reached the last stage.
    expect(nextStageBoundaryGameMs(tree({ plantedAtGameMs: planted }), at(2_000))).toBeNull();
  });
});

describe('isFellable (GDD section 131)', () => {
  it('refuses a sapling and accepts the three later stages', () => {
    expect(isFellable(tree(), at(0))).toBe(false);
    expect(isFellable(tree(), at(240))).toBe(true);
    expect(isFellable(tree(), at(480))).toBe(true);
    expect(isFellable(tree(), at(720))).toBe(true);
  });

  it('refuses a tree that was already felled', () => {
    expect(isFellable(tree({ status: TreeStatus.FELLED }), at(720))).toBe(false);
  });

  it('accepts a tree that is only marked, since marking is reserved and not a state change', () => {
    expect(isFellable(tree({ status: TreeStatus.MARKED_FOR_HARVEST }), at(480))).toBe(true);
  });
});

describe('batchWoodVolume (GDD section 135)', () => {
  it('sums the volumes of the trees that are not already felled', () => {
    const trees: TreeView[] = [
      tree({ plantedAtGameMs: at(0) }),
      tree({ plantedAtGameMs: at(0) }),
      tree({ plantedAtGameMs: at(0) }),
    ];
    // At 480 h every tree is mature: 3 x 1 800 dm³.
    const batch = batchWoodVolume(trees, at(480));
    expect(batch.treeCount).toBe(3);
    expect(batch.fellableCount).toBe(3);
    expect(batch.volumeDm3).toBe(5_400);
    expect(batch.volumeM3).toBe(5.4);
  });

  it('counts saplings for the duration but not for the volume', () => {
    // GDD section 135 makes the duration depend on the trees in the area, and GDD section
    // 131 gives a sapling no commercial value and does not allow felling it.
    const trees: TreeView[] = [
      tree({ plantedAtGameMs: at(400) }),
      tree({ plantedAtGameMs: at(0) }),
    ];
    const batch = batchWoodVolume(trees, at(500));
    expect(batch.treeCount).toBe(2);
    expect(batch.fellableCount).toBe(1);
    expect(batch.volumeDm3).toBe(1_800);
  });

  it('excludes trees already felled from both counts', () => {
    const trees: TreeView[] = [
      tree({ status: TreeStatus.FELLED }),
      tree({ plantedAtGameMs: at(0) }),
    ];
    const batch = batchWoodVolume(trees, at(480));
    expect(batch.treeCount).toBe(1);
    expect(batch.volumeDm3).toBe(1_800);
  });

  it('is zero for an empty batch', () => {
    expect(batchWoodVolumeM3([], at(0))).toBe(0);
  });

  it('sums exactly over a large batch, since the unit is an integer', () => {
    const trees: TreeView[] = Array.from({ length: 2_000 }, () => tree({ plantedAtGameMs: at(0) }));
    // 2 000 x 1 800 dm³, exactly, with no floating point drift.
    expect(batchWoodVolume(trees, at(500)).volumeDm3).toBe(3_600_000);
  });
});

describe('expectedNaturalForestVolumeDm3 (GDD section 138)', () => {
  it('reproduces the order of magnitude the GDD estimates for 250 cells', () => {
    // GDD section 138 estimates about 382 m³; the mix gives 382.5 m³ once saplings are
    // excluded. The average of the whole mix, saplings included, is the 1 534 dm³ per cell
    // that shared/config publishes.
    expect(expectedNaturalForestVolumeDm3(250, NATURAL_FOREST, PINE)).toBe(382_500);
  });

  it('scales linearly with the area and is zero for none', () => {
    expect(expectedNaturalForestVolumeDm3(500, NATURAL_FOREST, PINE)).toBe(765_000);
    expect(expectedNaturalForestVolumeDm3(0, NATURAL_FOREST, PINE)).toBe(0);
    expect(expectedNaturalForestVolumeDm3(-10, NATURAL_FOREST, PINE)).toBe(0);
  });

  it('agrees with a generated batch drawn from the same mix', () => {
    // 250 trees in the proportions of the mix: 20 saplings, 50 young, 125 mature and 55
    // old growth, each planted so that it sits in its own stage at the instant of the cut,
    // which is 900 h. A tree planted at 600 h is 300 h old and therefore young; one planted
    // at 400 h is 500 h old and mature.
    const trees: TreeView[] = [
      ...Array.from({ length: 20 }, () => tree({ plantedAtGameMs: at(900) })),
      ...Array.from({ length: 50 }, () => tree({ plantedAtGameMs: at(600) })),
      ...Array.from({ length: 125 }, () => tree({ plantedAtGameMs: at(400) })),
      ...Array.from({ length: 55 }, () => tree({ plantedAtGameMs: at(0) })),
    ];
    const batch = batchWoodVolume(trees, at(900));
    expect(batch.treeCount).toBe(250);
    expect(batch.volumeDm3).toBe(expectedNaturalForestVolumeDm3(250, NATURAL_FOREST, PINE));
  });
});

describe('treeStageAt', () => {
  it('uses the catalogue that is injected, so a test can shorten the stages', () => {
    const fast = {
      PINE: {
        ...PINE,
        stageStartGameHours: {
          SAPLING: gameHours(0),
          YOUNG: gameHours(1),
          MATURE: gameHours(2),
          OLD_GROWTH: gameHours(3),
        },
      },
    };
    expect(treeStageAt(tree(), at(2), fast)).toBe(TreeGrowthStage.MATURE);
  });
});
