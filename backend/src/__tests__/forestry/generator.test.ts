// The natural forest generator and the milestone window, as pure functions.
//
// Owner: workflow W6-C. Tests of the module `forestry`.
//
// No database and no clock service: everything asserted here is a function of the seed, the
// coordinate and an instant, which is precisely the property GDD section 130 needs the
// generation to have and the one that makes deleting and recreating a plot impossible to
// exploit. The integration suite then checks that the module actually writes what these
// functions decide.

import { describe, expect, it } from 'vitest';
import {
  FOREST_SALT,
  forestUnitHash,
  generateNaturalForest,
  generatedFellableVolumeDm3,
  naturalTreeAt,
  stageAgeWindow,
  stageForDraw,
} from '../../modules/forestry/generator.js';
import { type TreeRecord } from '../../modules/forestry/record.js';
import {
  MILESTONE_WINDOW_GAME_MS,
  milestoneWindowEnd,
  nextMilestoneGameMs,
  treesCrossingMilestone,
} from '../../modules/forestry/service.js';
import {
  GENERATOR_VERSION,
  INITIAL_ANCHOR_GAME_MS,
  NATURAL_FOREST,
  NATURAL_FOREST_AVERAGE_VOLUME_DM3,
  PINE,
  TreeSpecies,
  TreeStatus,
  expectedNaturalForestVolumeDm3,
  gameHours,
  gameHoursToGameMs,
  gameMs,
  treeStageAt,
  type CellCoord,
  type GameMs,
  type PlayerId,
} from '../../shared/index.js';

/** An instant far enough from zero that a tree of any drawn age has a positive planting mark. */
const AT: GameMs = gameMs(INITIAL_ANCHOR_GAME_MS + gameHoursToGameMs(gameHours(1_000)));

function block(width: number, height: number, originX = 0, originY = 0): readonly CellCoord[] {
  const cells: CellCoord[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      cells.push({ cellX: originX + x, cellY: originY + y });
    }
  }
  return cells;
}

describe('la generacion procedural del bosque salvaje (GDD 130)', () => {
  const cells = block(32, 32);

  it('es determinista: la misma semilla y las mismas coordenadas dan bytes identicos', () => {
    const first = generateNaturalForest(4_242, GENERATOR_VERSION, cells, AT);
    const second = generateNaturalForest(4_242, GENERATOR_VERSION, cells, AT);
    expect(second).toEqual(first);
    // Y no es determinista por ser constante: otra semilla produce otro bosque.
    const other = generateNaturalForest(4_243, GENERATOR_VERSION, cells, AT);
    expect(other).not.toEqual(first);
  });

  it('no depende del orden en que se le den las celdas', () => {
    const straight = generateNaturalForest(77, GENERATOR_VERSION, cells, AT);
    const shuffled = generateNaturalForest(77, GENERATOR_VERSION, [...cells].reverse(), AT);
    const key = (tree: { cellX: number; cellY: number }): string => `${tree.cellX},${tree.cellY}`;
    expect(new Map(shuffled.map((tree) => [key(tree), tree.plantedAtGameMs]))).toEqual(
      new Map(straight.map((tree) => [key(tree), tree.plantedAtGameMs])),
    );
  });

  it('puebla toda celda de bosque, que es lo que GDD 138 cuenta al valorar 250 arboles', () => {
    expect(NATURAL_FOREST.treeDensityBp).toBe(10_000);
    expect(generateNaturalForest(9, GENERATOR_VERSION, cells, AT)).toHaveLength(cells.length);
  });

  it('la fase que dibuja se lee de vuelta desde la edad y nunca se almacena', () => {
    for (const tree of generateNaturalForest(31, GENERATOR_VERSION, cells, AT)) {
      const derived = treeStageAt(
        {
          species: TreeSpecies.PINE,
          plantedAtGameMs: tree.plantedAtGameMs,
          status: TreeStatus.STANDING,
        },
        AT,
      );
      expect(derived).toBe(tree.drawnStage);
    }
  });

  it('la edad cae dentro de la ventana de su fase', () => {
    for (const tree of generateNaturalForest(55, GENERATOR_VERSION, cells, AT)) {
      const window = stageAgeWindow(tree.drawnStage, PINE, NATURAL_FOREST);
      expect(tree.ageGameHours).toBeGreaterThanOrEqual(window.fromGameHours);
      expect(tree.ageGameHours).toBeLessThan(window.toGameHours);
    }
  });

  it('reproduce la mezcla de fases dentro de un margen razonable sobre mil celdas', () => {
    const wide = block(40, 25);
    const trees = generateNaturalForest(101, GENERATOR_VERSION, wide, AT);
    const counted = { SAPLING: 0, YOUNG: 0, MATURE: 0, OLD_GROWTH: 0 };
    for (const tree of trees) {
      counted[tree.drawnStage] += 1;
    }
    for (const stage of ['SAPLING', 'YOUNG', 'MATURE', 'OLD_GROWTH'] as const) {
      const expected = (NATURAL_FOREST.stageMixBp[stage] / 10_000) * trees.length;
      // Cinco puntos porcentuales de holgura sobre mil muestras: la mezcla es una
      // distribucion, no una cuota.
      expect(Math.abs(counted[stage] - expected)).toBeLessThan(0.05 * trees.length);
    }
  });

  it('el volumen medio generado se acerca a la forma cerrada del informe de balance', () => {
    const wide = block(40, 25);
    const trees = generateNaturalForest(202, GENERATOR_VERSION, wide, AT);
    const closedForm = expectedNaturalForestVolumeDm3(wide.length, NATURAL_FOREST, PINE);
    const drawn = generatedFellableVolumeDm3(trees);
    expect(Math.abs(drawn - closedForm) / closedForm).toBeLessThan(0.1);
    // Y la constante que el informe cita sigue siendo la media con plantones incluidos.
    expect(NATURAL_FOREST_AVERAGE_VOLUME_DM3).toBeGreaterThan(closedForm / wide.length);
  });

  it('las tres extracciones son independientes entre si', () => {
    const cell = { cellX: 17, cellY: 23 };
    const presence = forestUnitHash(5, GENERATOR_VERSION, cell, FOREST_SALT.PRESENCE);
    const stage = forestUnitHash(5, GENERATOR_VERSION, cell, FOREST_SALT.STAGE);
    const age = forestUnitHash(5, GENERATOR_VERSION, cell, FOREST_SALT.AGE);
    expect(presence).not.toBe(stage);
    expect(stage).not.toBe(age);
    expect(presence).not.toBe(age);
  });

  it('la extraccion de fase respeta el orden acumulado de la mezcla', () => {
    expect(stageForDraw(0, NATURAL_FOREST)).toBe('SAPLING');
    expect(stageForDraw(0.079, NATURAL_FOREST)).toBe('SAPLING');
    expect(stageForDraw(0.081, NATURAL_FOREST)).toBe('YOUNG');
    expect(stageForDraw(0.279, NATURAL_FOREST)).toBe('YOUNG');
    expect(stageForDraw(0.281, NATURAL_FOREST)).toBe('MATURE');
    expect(stageForDraw(0.779, NATURAL_FOREST)).toBe('MATURE');
    expect(stageForDraw(0.781, NATURAL_FOREST)).toBe('OLD_GROWTH');
    expect(stageForDraw(0.999_9, NATURAL_FOREST)).toBe('OLD_GROWTH');
  });

  it('una celda sin arbol lo es por la extraccion de presencia y no por accidente', () => {
    // Con densidad al 100 % ninguna celda queda vacia; con densidad al 50 % aproximadamente
    // la mitad lo hace, y siempre las mismas.
    const half = {
      ...NATURAL_FOREST,
      treeDensityBp: 5_000 as (typeof NATURAL_FOREST)['treeDensityBp'],
    };
    const cell = { cellX: 3, cellY: 4 };
    const drawn = naturalTreeAt(11, GENERATOR_VERSION, cell, AT, half);
    expect(naturalTreeAt(11, GENERATOR_VERSION, cell, AT, half)).toEqual(drawn);
    const populated = generateNaturalForest(11, GENERATOR_VERSION, block(32, 32), AT, half).length;
    expect(populated).toBeGreaterThan(300);
    expect(populated).toBeLessThan(724);
  });
});

// ---------------------------------------------------------------------------
// The milestone, per plot and never per tree
// ---------------------------------------------------------------------------

function tree(plantedAtGameMs: GameMs, id = 't'): TreeRecord {
  return {
    id,
    forestPlotId: 'plot',
    playerId: 'player' as PlayerId,
    worldId: 'world',
    cellX: 0,
    cellY: 0,
    species: TreeSpecies.PINE,
    plantedAtGameMs,
    status: TreeStatus.STANDING,
    felledAtGameMs: null,
    naturallyGenerated: true,
  };
}

describe('el hito de crecimiento de una parcela (GDD 131)', () => {
  const now: GameMs = gameMs(INITIAL_ANCHOR_GAME_MS);

  it('cuantiza el instante de aviso, de modo que una parcela agenda un evento por ventana', () => {
    // Diez arboles que maduran en diez instantes distintos dentro de la misma ventana.
    const trees = Array.from({ length: 10 }, (_, index) =>
      tree(gameMs(now - gameHoursToGameMs(gameHours(480 - 1 - index * 0.1))), `t${index}`),
    );
    const due = nextMilestoneGameMs(trees, now);
    expect(due).not.toBeNull();
    // Todos caen en la misma ventana, luego el aviso es uno solo y los reporta a los diez.
    expect(treesCrossingMilestone(trees, due as GameMs)).toHaveLength(10);
    expect((due as GameMs) % MILESTONE_WINDOW_GAME_MS).toBe(0n);
  });

  it('no agenda nada para un arbol que ya estaba maduro cuando la parcela se creo', () => {
    const grown = tree(gameMs(now - gameHoursToGameMs(gameHours(700))));
    expect(nextMilestoneGameMs([grown], now)).toBeNull();
  });

  it('no agenda nada para una parcela sin arboles en pie', () => {
    expect(nextMilestoneGameMs([], now)).toBeNull();
    const felled: TreeRecord = { ...tree(gameMs(now)), status: TreeStatus.FELLED };
    expect(nextMilestoneGameMs([felled], now)).toBeNull();
  });

  it('cada frontera cae en exactamente una ventana, que es lo que hace innecesario el estado', () => {
    const early = tree(gameMs(now - gameHoursToGameMs(gameHours(479))), 'early');
    const late = tree(gameMs(now - gameHoursToGameMs(gameHours(300))), 'late');
    const first = nextMilestoneGameMs([early, late], now) as GameMs;
    expect(treesCrossingMilestone([early, late], first).map((each) => each.id)).toEqual(['early']);
    const second = nextMilestoneGameMs([early, late], first) as GameMs;
    expect(second).toBeGreaterThan(first);
    expect(treesCrossingMilestone([early, late], second).map((each) => each.id)).toEqual(['late']);
  });

  it('la ventana de una frontera es el primer multiplo que la alcanza', () => {
    expect(milestoneWindowEnd(gameMs(MILESTONE_WINDOW_GAME_MS))).toBe(MILESTONE_WINDOW_GAME_MS);
    expect(milestoneWindowEnd(gameMs(MILESTONE_WINDOW_GAME_MS + 1n))).toBe(
      MILESTONE_WINDOW_GAME_MS * 2n,
    );
  });
});
