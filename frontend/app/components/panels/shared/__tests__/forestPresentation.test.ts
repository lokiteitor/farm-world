// How a plot and its trees are counted, valued and named.
//
// Owner: W6-T.
//
// Everything about a tree except the instant it was planted is derived (ADR-0030), so the
// question these tests ask is never "is the stored volume right" but "does the panel derive
// the same figure the server derives". They therefore drive the functions with an injected
// instant and compare against the catalogue of GDD sections 131 and 133, not against a
// number written down here.
//
// The blocking codes are the other half. A plot refuses a felling for reasons that belong to
// the plot, and the machinery and the worker are the assignment panel's question (ADR-0032):
// what is asserted is that the codes are the shared ones and that nothing else leaks in.

import { describe, expect, it } from 'vitest';
import { TREE_STAGE_LABELS } from '~/components/panels/legend/vocabulary';
import {
  asTreeView,
  composeArea,
  emptyCells,
  fellBlockingCode,
  occupancyBp,
  replantBlockingCode,
  stageRows,
  woodM3,
  woodValue,
} from '~/components/panels/shared/forestPresentation';
import {
  DM3_PER_M3,
  Money,
  TREE_GROWTH_STAGES,
  TREE_SPECIES_CATALOGUE,
  TreeGrowthStage,
  TreeSpecies,
  TreeStatus,
  ValidationCode,
  gameMs,
  isFellable,
  treeStageAt,
  woodSaleRevenue,
  type ForestPlotDto,
  type GameMs,
  type TreeDto,
} from '~/shared/index';

const PINE = TREE_SPECIES_CATALOGUE.PINE;
const NOW: GameMs = gameMs(5_000n * 3_600_000n);

/** A tree of the given age at `NOW`, so its stage is a consequence and never a claim. */
function tree(ageGameHours: number, overrides: Partial<TreeDto> = {}): TreeDto {
  const plantedAt = gameMs(NOW - BigInt(ageGameHours) * 3_600_000n);
  const view = {
    species: TreeSpecies.PINE,
    plantedAtGameMs: plantedAt,
    status: TreeStatus.STANDING,
  };
  const stage = treeStageAt(view, NOW);
  return {
    id: `tree-${ageGameHours}`,
    forestPlotId: 'plot-1',
    cellX: 10,
    cellY: 10,
    species: TreeSpecies.PINE,
    plantedAtGameMs: plantedAt.toString(),
    status: TreeStatus.STANDING,
    felledAtGameMs: null,
    naturallyGenerated: true,
    ageGameHours,
    growthStage: stage,
    woodVolumeDm3: PINE.woodVolumeDm3ByStage[stage],
    fellable: PINE.fellableStages.includes(stage),
    nextStageAtGameMs: null,
    ...overrides,
  };
}

function plot(overrides: Partial<ForestPlotDto> = {}): ForestPlotDto {
  return {
    id: 'plot-1',
    farmId: 'farm-1',
    name: 'Bosque',
    cellCount: 100,
    emptyCellCount: 0,
    standingTreeCount: 100,
    fellableTreeCount: 80,
    standingWoodDm3: 120_000,
    fellableWoodDm3: 100_000,
    fellableWoodValue: '4500.0000',
    stageHistogram: { SAPLING: 20, YOUNG: 30, MATURE: 30, OLD_GROWTH: 20 },
    currentTaskId: null,
    createdAtGameMs: '0',
    atGameMs: NOW.toString(),
    ...overrides,
  };
}

describe('las cuatro fases del ciclo de vida (§131)', () => {
  it('el histograma se lee siempre con las cuatro filas, en orden y con las vacias', () => {
    const rows = stageRows({ SAPLING: 0, YOUNG: 4, MATURE: 0, OLD_GROWTH: 1 });
    expect(rows.map((row) => row.stage)).toEqual([...TREE_GROWTH_STAGES]);
    expect(rows.map((row) => row.count)).toEqual([0, 4, 0, 1]);
    for (const row of rows) {
      expect(row.label).toBe(TREE_STAGE_LABELS[row.stage]);
      expect(row.label).not.toBe(row.stage);
      expect(row.colour).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('el volumen por fase es el del catalogo, convertido a metros cubicos', () => {
    const rows = stageRows({ SAPLING: 1, YOUNG: 1, MATURE: 1, OLD_GROWTH: 1 });
    for (const row of rows) {
      expect(row.volumeM3).toBeCloseTo(PINE.woodVolumeDm3ByStage[row.stage] / DM3_PER_M3, 10);
    }
    // The four figures GDD section 131 publishes.
    expect(rows.map((row) => row.volumeM3)).toEqual([0.05, 0.4, 1.8, 2.5]);
  });

  it('el planton no es talable y las otras tres si', () => {
    const rows = stageRows({ SAPLING: 1, YOUNG: 1, MATURE: 1, OLD_GROWTH: 1 });
    expect(rows.map((row) => row.fellable)).toEqual([false, true, true, true]);
  });

  it('el reparto en puntos base suma diez mil cuando hay arboles, y cero cuando no', () => {
    const rows = stageRows({ SAPLING: 0, YOUNG: 5, MATURE: 5, OLD_GROWTH: 0 });
    expect(rows.reduce((sum, row) => sum + row.shareBp, 0)).toBe(10_000);
    const empty = stageRows({ SAPLING: 0, YOUNG: 0, MATURE: 0, OLD_GROWTH: 0 });
    expect(empty.every((row) => row.shareBp === 0)).toBe(true);
  });
});

describe('la composicion de un area, que ninguna ruta informa (§132 opcion B)', () => {
  it('cuenta arboles en pie, talables y volumen con las reglas compartidas', () => {
    const trees = [tree(100), tree(300), tree(600), tree(900)];
    const area = composeArea(trees, NOW);
    expect(area.standingCount).toBe(4);
    // The sapling of a hundred hours is standing and not fellable (GDD section 131).
    expect(area.fellableCount).toBe(3);
    expect(area.histogram).toEqual({ SAPLING: 1, YOUNG: 1, MATURE: 1, OLD_GROWTH: 1 });
    const expectedDm3 =
      PINE.woodVolumeDm3ByStage.YOUNG +
      PINE.woodVolumeDm3ByStage.MATURE +
      PINE.woodVolumeDm3ByStage.OLD_GROWTH;
    expect(area.volumeDm3).toBe(expectedDm3);
    expect(area.volumeM3).toBeCloseTo(expectedDm3 / DM3_PER_M3, 10);
  });

  it('un arbol talado no cuenta para nada', () => {
    const felled = tree(900, { status: TreeStatus.FELLED, felledAtGameMs: NOW.toString() });
    const area = composeArea([tree(600), felled], NOW);
    expect(area.standingCount).toBe(1);
    expect(area.fellableCount).toBe(1);
    expect(area.histogram.OLD_GROWTH).toBe(0);
  });

  it('el bosque madura con el reloj sin trafico alguno', () => {
    const young = [tree(239)];
    expect(composeArea(young, NOW).fellableCount).toBe(0);
    // One game hour later the same row crosses the boundary of the catalogue.
    const later = gameMs(NOW + 3_600_000n);
    expect(composeArea(young, later).fellableCount).toBe(1);
    expect(isFellable(asTreeView(young[0] as TreeDto), later)).toBe(true);
  });

  it('el valor es el de la regla compartida y nunca un precio multiplicado aqui', () => {
    const trees = [tree(600), tree(900)];
    const area = composeArea(trees, NOW);
    expect(Money.compare(area.value, woodSaleRevenue(PINE, area.volumeDm3))).toBe(0);
    // 4.3 m3 at the fixed 45 $/m3 of GDD section 133.
    expect(Money.compare(area.value, Money.fromString('193.5000'))).toBe(0);
    expect(Money.compare(woodValue(0), Money.ZERO)).toBe(0);
  });

  it('la conversion a metros cubicos usa el divisor del catalogo de almacenamiento', () => {
    expect(woodM3(2_500)).toBeCloseTo(2.5, 10);
    expect(woodM3(0)).toBe(0);
  });
});

describe('las celdas vacias que la replantacion rellena (§137)', () => {
  it('son las de la geometria sin arbol en pie', () => {
    const cells = [
      { cellX: 10, cellY: 10 },
      { cellX: 11, cellY: 10 },
      { cellX: 12, cellY: 10 },
    ];
    const standing = tree(600, { id: 't1', cellX: 10, cellY: 10 });
    const felled = tree(600, {
      id: 't2',
      cellX: 11,
      cellY: 10,
      status: TreeStatus.FELLED,
      felledAtGameMs: NOW.toString(),
    });
    expect(emptyCells(cells, [standing, felled])).toEqual([
      { cellX: 11, cellY: 10 },
      { cellX: 12, cellY: 10 },
    ]);
  });

  it('sin geometria cargada no inventa celdas', () => {
    expect(emptyCells([], [tree(600)])).toEqual([]);
  });
});

describe('los motivos que pertenecen a la parcela', () => {
  it('una tarea en curso responde antes que la composicion', () => {
    expect(fellBlockingCode(plot({ currentTaskId: 'task-1' }))).toBe(
      ValidationCode.FIELD_HAS_ACTIVE_TASK,
    );
    expect(replantBlockingCode(plot({ currentTaskId: 'task-1', emptyCellCount: 4 }))).toBe(
      ValidationCode.FIELD_HAS_ACTIVE_TASK,
    );
  });

  it('sin arboles talables la tala se niega, y sin celdas vacias la replantacion', () => {
    expect(fellBlockingCode(plot({ fellableTreeCount: 0 }))).toBe(ValidationCode.NO_FELLABLE_TREES);
    expect(fellBlockingCode(plot())).toBeNull();
    expect(replantBlockingCode(plot({ emptyCellCount: 0 }))).toBe(
      ValidationCode.CELL_ALREADY_HAS_TREE,
    );
    expect(replantBlockingCode(plot({ emptyCellCount: 3 }))).toBeNull();
  });

  it('la ocupacion sale de las dos cuentas que la parcela ya informa', () => {
    expect(occupancyBp(plot({ cellCount: 100, standingTreeCount: 40 }))).toBe(4_000);
    expect(occupancyBp(plot({ cellCount: 0, standingTreeCount: 0 }))).toBe(0);
    expect(occupancyBp(plot({ cellCount: 3, standingTreeCount: 3 }))).toBe(10_000);
  });
});

describe('la vista que las reglas compartidas quieren', () => {
  it('lleva especie, instante de plantacion y estado, y nada derivado', () => {
    const row = tree(600);
    expect(asTreeView(row)).toEqual({
      species: TreeSpecies.PINE,
      plantedAtGameMs: gameMs(BigInt(row.plantedAtGameMs)),
      status: TreeStatus.STANDING,
    });
    expect(treeStageAt(asTreeView(row), NOW)).toBe(TreeGrowthStage.MATURE);
  });
});
