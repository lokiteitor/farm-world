// The pure half of the fields module: the phase machine and the lazily accrued attributes.
//
// Owner: workflow W4-C. Module `fields`.
//
// These are the properties the rest of the module rests on, and every one of them would
// fail silently if it broke, because a wrong weed level or a wrong phase boundary still
// produces a plausible number:
//
//   - Weeds accrue exactly the analytic rate of GDD section 78 over the states GDD section
//     78 lists, and over no others. The expected values here are written as `rate x hours`
//     and not taken from the implementation, which is the only way this file can catch a
//     regression in the implementation.
//   - The interval since an attribute was settled is cut at the phase boundaries. A field
//     sown and left alone for a hundred hours must accrue weeds during `GROWING` and
//     `READY_TO_HARVEST` and not during `SEEDED` or `GERMINATING`.
//   - The phase machine of GDD section 76 refuses what the table does not contain.
//   - The narrative cycle of GDD section 84 is reproduced end to end with an injected clock,
//     with the deviation the plan predicted recorded as an assertion rather than as prose.
//
// No database and no clock: every instant is a parameter.

import { describe, expect, it } from 'vitest';
import {
  availableOperations,
  cropOf,
  expectedYieldLiters,
  nextTimedState,
  phaseBoundaryAfter,
  phaseSegments,
  projectFieldPhase,
  settleAttributes,
  settleFertility,
  settleWeedLevel,
  type FieldAttributes,
} from '../../modules/fields/projection.js';
import {
  requireOperationAllowed,
  requireTransition,
  statesReachableFrom,
  transitionBetween,
} from '../../modules/fields/stateMachine.js';
import {
  CropCycleState,
  INITIAL_ANCHOR_GAME_MS,
  MS_PER_GAME_HOUR,
  SoilCondition,
  ValidationCode,
  WHEAT,
  bp,
  fertilityAfterHarvest,
  gameMs as gameMsValue,
  isApiError,
  type GameMs,
} from '../../shared/index.js';

/** Origin of the timeline of this file. Any instant works; the anchor of a world reads best. */
const T0: GameMs = gameMsValue(INITIAL_ANCHOR_GAME_MS);

/** An instant, in whole game hours from the origin. */
function at(gameHours: number): GameMs {
  return gameMsValue(T0 + BigInt(Math.round(gameHours * Number(MS_PER_GAME_HOUR))));
}

function field(overrides: Partial<FieldAttributes> = {}): FieldAttributes {
  const base: FieldAttributes = {
    cellCount: 250,
    cropId: null,
    cropCycleState: CropCycleState.VIRGIN,
    soilCondition: SoilCondition.UNTOUCHED,
    fertilityBp: bp(10_000),
    fertilityUpdatedAtGameMs: T0,
    weedLevelBp: bp(0),
    weedLevelUpdatedAtGameMs: T0,
    fertilizationBp: bp(0),
    fertilizationUpdatedAtGameMs: T0,
    stateEnteredAtGameMs: T0,
    seededAtGameMs: null,
    currentTaskId: null,
  };
  return { ...base, ...overrides };
}

/** A field sown at the origin, which is the only fixture the timed tests need. */
function sownField(overrides: Partial<FieldAttributes> = {}): FieldAttributes {
  return field({
    cropId: 'WHEAT',
    cropCycleState: CropCycleState.SEEDED,
    seededAtGameMs: T0,
    soilCondition: SoilCondition.PLOWED,
    ...overrides,
  });
}

/** The analytic form of GDD section 78: level plus rate by elapsed hours, saturating at 100 %. */
function analyticWeedBp(fromBp: number, gameHours: number): number {
  const grown = fromBp + WHEAT.weedGrowthBpPerGameHour * gameHours;
  return Math.min(10_000, Math.floor(grown));
}

describe('el nivel de malezas (GDD 78)', () => {
  it('acumula exactamente la formula analitica sobre suelo virgen', () => {
    for (const hours of [1, 10, 100, 166]) {
      expect(settleWeedLevel(field(), at(hours))).toBe(analyticWeedBp(0, hours));
    }
    // 0,6 %/h son 60 puntos base por hora de juego: cien horas son el 6 %.
    expect(settleWeedLevel(field(), at(100))).toBe(6_000);
  });

  it('satura en el 100 % y no lo rebasa', () => {
    expect(settleWeedLevel(field(), at(1_000))).toBe(10_000);
    expect(settleWeedLevel(field({ weedLevelBp: bp(9_990) }), at(10))).toBe(10_000);
  });

  it('no crece en los estados que la seccion 78 no enumera', () => {
    for (const state of [
      CropCycleState.PLOWED,
      CropCycleState.CULTIVATED,
      CropCycleState.SEEDED,
      CropCycleState.GERMINATING,
      CropCycleState.HARVESTED,
    ]) {
      expect(settleWeedLevel(field({ cropCycleState: state }), at(200))).toBe(0);
    }
  });

  it('corta el intervalo por las fronteras de fase de un campo sembrado', () => {
    const sown = sownField();
    // SEEDED dura 6 h y GERMINATING 12 h, de modo que hasta la hora 18 no crece nada.
    expect(settleWeedLevel(sown, at(18))).toBe(0);
    // GROWING empieza en la hora 18: doce horas dentro son 12 x 60.
    expect(settleWeedLevel(sown, at(30))).toBe(analyticWeedBp(0, 12));
    // El ciclo cronometrado termina en la hora 96, con 78 h de GROWING.
    expect(settleWeedLevel(sown, at(96))).toBe(analyticWeedBp(0, 78));
    // READY_TO_HARVEST sigue acumulando (GDD 78: "sin cosechar").
    expect(settleWeedLevel(sown, at(120))).toBe(analyticWeedBp(0, 78 + 24));
  });

  it('produce los segmentos de fase que el corte usa', () => {
    const segments = phaseSegments(sownField(), WHEAT, T0, at(120));
    expect(segments.map((segment) => segment.state)).toEqual([
      CropCycleState.SEEDED,
      CropCycleState.GERMINATING,
      CropCycleState.GROWING,
      CropCycleState.READY_TO_HARVEST,
    ]);
    expect(segments.map((segment) => segment.toGameMs)).toEqual([at(6), at(18), at(96), at(120)]);
  });
});

describe('la fertilidad en barbecho (GDD 77)', () => {
  it('se recupera solo en VIRGIN, a la tasa del catalogo', () => {
    const drained = field({ fertilityBp: bp(8_500) });
    expect(settleFertility(drained, at(100))).toBe(
      8_500 + WHEAT.fertilityRegenBpPerGameHourInFallow * 100,
    );
    expect(settleFertility(drained, at(1_000_000))).toBe(10_000);
  });

  it('no se mueve fuera del barbecho', () => {
    const growing = sownField({ cropCycleState: CropCycleState.GROWING, fertilityBp: bp(8_500) });
    expect(settleFertility(growing, at(500))).toBe(8_500);
  });
});

describe('la maquina de estados del ciclo (GDD 76 y 80)', () => {
  it('recorre SEEDED, GERMINATING, GROWING y READY_TO_HARVEST en sus fronteras', () => {
    const sown = sownField();
    const cases: readonly (readonly [number, CropCycleState])[] = [
      [0, CropCycleState.SEEDED],
      [5.5, CropCycleState.SEEDED],
      [6, CropCycleState.GERMINATING],
      [17.5, CropCycleState.GERMINATING],
      [18, CropCycleState.GROWING],
      [95.5, CropCycleState.GROWING],
      [96, CropCycleState.READY_TO_HARVEST],
      [500, CropCycleState.READY_TO_HARVEST],
    ];
    for (const [hours, expected] of cases) {
      expect(projectFieldPhase(sown, at(hours)).state).toBe(expected);
    }
  });

  it('publica el progreso de crecimiento de la seccion 80', () => {
    const sown = sownField();
    expect(projectFieldPhase(sown, at(0)).growthProgressBp).toBe(0);
    expect(projectFieldPhase(sown, at(48)).growthProgressBp).toBe(5_000);
    expect(projectFieldPhase(sown, at(96)).growthProgressBp).toBe(10_000);
    expect(projectFieldPhase(sown, at(200)).growthProgressBp).toBe(10_000);
  });

  it('publica el instante de cosecha mientras el campo sigue dentro de la parte cronometrada', () => {
    const sown = sownField();
    expect(projectFieldPhase(sown, at(48)).readyAtGameMs).toBe(at(96));
    expect(projectFieldPhase(sown, at(96)).readyAtGameMs).toBeNull();
    expect(projectFieldPhase(field(), at(48)).readyAtGameMs).toBeNull();
  });

  it('es idempotente: proyectar en el instante de entrada devuelve la misma fase', () => {
    const sown = sownField();
    for (const hours of [0, 6, 18, 96, 130]) {
      const first = projectFieldPhase(sown, at(hours));
      const again = projectFieldPhase(sown, first.enteredAtGameMs);
      expect(again.state).toBe(first.state);
      expect(again.enteredAtGameMs).toBe(first.enteredAtGameMs);
    }
  });

  it('deriva las fronteras y el sucesor de cada fase cronometrada', () => {
    expect(phaseBoundaryAfter(CropCycleState.SEEDED, T0, WHEAT)).toBe(at(6));
    expect(phaseBoundaryAfter(CropCycleState.GERMINATING, T0, WHEAT)).toBe(at(18));
    expect(phaseBoundaryAfter(CropCycleState.GROWING, T0, WHEAT)).toBe(at(96));
    expect(phaseBoundaryAfter(CropCycleState.VIRGIN, T0, WHEAT)).toBeNull();

    expect(nextTimedState(CropCycleState.SEEDED)).toBe(CropCycleState.GERMINATING);
    expect(nextTimedState(CropCycleState.GERMINATING)).toBe(CropCycleState.GROWING);
    expect(nextTimedState(CropCycleState.GROWING)).toBe(CropCycleState.READY_TO_HARVEST);
    expect(nextTimedState(CropCycleState.READY_TO_HARVEST)).toBeNull();
  });

  it('rechaza una transicion que la tabla no contiene', () => {
    expect(transitionBetween(CropCycleState.VIRGIN, CropCycleState.PLOWED)).not.toBeNull();
    expect(transitionBetween(CropCycleState.VIRGIN, CropCycleState.SEEDED)).toBeNull();

    try {
      requireTransition(CropCycleState.VIRGIN, CropCycleState.SEEDED, 'SEED');
      expect.unreachable('la transicion VIRGIN -> SEEDED no existe en la tabla');
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) {
        expect(error.code).toBe(ValidationCode.FIELD_STATE_NOT_ALLOWED);
        expect(error.details?.allowedStates).toEqual(statesReachableFrom(CropCycleState.VIRGIN));
      }
    }
  });

  it('rechaza una operacion que el estado no admite (GDD 90 y 104)', () => {
    try {
      requireOperationAllowed('HARVEST', CropCycleState.VIRGIN);
      expect.unreachable('cosechar suelo virgen no esta permitido');
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) {
        expect(error.code).toBe(ValidationCode.FIELD_STATE_NOT_ALLOWED);
        expect(error.details?.fromState).toBe(CropCycleState.VIRGIN);
      }
    }
    expect(requireOperationAllowed('PLOW', CropCycleState.VIRGIN).toCropState).toBe(
      CropCycleState.PLOWED,
    );
    expect(requireOperationAllowed('SEED', CropCycleState.PLOWED).requiresCrop).toBe(true);
  });

  it('enumera las operaciones disponibles a partir de la tabla', () => {
    expect(availableOperations(CropCycleState.VIRGIN, null, false)).toEqual(['PLOW']);
    // El trigo tiene `requiresCultivation: false`, de modo que desde PLOWED admite las dos.
    expect(availableOperations(CropCycleState.PLOWED, null, false)).toEqual(['CULTIVATE', 'SEED']);
    expect(availableOperations(CropCycleState.CULTIVATED, 'WHEAT', false)).toEqual(['SEED']);
    expect(availableOperations(CropCycleState.GROWING, 'WHEAT', false)).toEqual([]);
    expect(availableOperations(CropCycleState.READY_TO_HARVEST, 'WHEAT', false)).toEqual([
      'HARVEST',
    ]);
    // Un campo con tarea en curso no admite ninguna (GDD 104).
    expect(availableOperations(CropCycleState.VIRGIN, null, true)).toEqual([]);
  });
});

describe('el ejemplo narrativo de la seccion 84', () => {
  it('reproduce el ciclo completo con reloj inyectado', () => {
    // Dia 1: Field #12, VIRGIN, fertilidad 100 %, malezas 0 %.
    const virgin = field({ cellCount: 250 });
    expect(projectFieldPhase(virgin, T0).state).toBe(CropCycleState.VIRGIN);
    expect(settleAttributes(virgin, T0).fertilityBp).toBe(10_000);

    // El jugador ejecuta PLOW y despues SEED, ambos en el mismo instante del ejemplo.
    requireTransition(CropCycleState.VIRGIN, CropCycleState.PLOWED, 'PLOW');
    requireTransition(CropCycleState.PLOWED, CropCycleState.SEEDED, 'SEED');
    const sown = sownField({ cellCount: 250 });
    expect(projectFieldPhase(sown, T0).growthProgressBp).toBe(0);

    // Seis horas despues, desconectado: GERMINATING.
    expect(projectFieldPhase(sown, at(6)).state).toBe(CropCycleState.GERMINATING);

    // Noventa y seis horas despues: GROWING alcanza el 100 % y pasa a READY_TO_HARVEST.
    const ready = projectFieldPhase(sown, at(96));
    expect(ready.state).toBe(CropCycleState.READY_TO_HARVEST);
    expect(ready.growthProgressBp).toBe(10_000);

    // DESVIACION DOCUMENTADA (plan seccion 2.2, erratas del GDD). El ejemplo narra un
    // nivel de malezas del 34 % y una penalizacion de alrededor del 14 %. Con la tasa que
    // la seccion 82 publica, 0,6 %/h, las 78 h de GROWING dan 46,8 % y la curva de la
    // seccion 78 da el 18,72 %. No se ajusta ningun valor: se implementa el catalogo
    // literal y la diferencia se afirma aqui.
    const settled = settleAttributes(sown, at(96));
    expect(settled.weedLevelBp).toBe(4_680);
    expect(settled.fertilityBp).toBe(10_000);

    // El jugador ejecuta HARVEST.
    requireTransition(CropCycleState.READY_TO_HARVEST, CropCycleState.HARVESTED, 'HARVEST');
    expect(expectedYieldLiters(sown, settled)).toBe(18_288);

    // Field #12: HARVESTED -> VIRGIN, fertilidad baja al 85 %, que es el numero que el
    // ejemplo si publica y que el catalogo reproduce.
    expect(fertilityAfterHarvest(settled.fertilityBp, cropOf('WHEAT'))).toBe(8_500);
    expect(WHEAT.afterHarvestState).toBe(CropCycleState.VIRGIN);
  });

  it('cosechar sin cultivar cuesta lo que la curva de la seccion 78 dice', () => {
    const sown = sownField({ cellCount: 250 });
    const clean = expectedYieldLiters(sown, {
      fertilityBp: bp(10_000),
      weedLevelBp: bp(0),
      fertilizationBp: bp(0),
    });
    const weedy = expectedYieldLiters(sown, settleAttributes(sown, at(96)));
    expect(clean).toBe(90 * 250);
    expect(weedy).toBeLessThan(clean);
    // 18,72 % de penalizacion sobre 22 500 litros.
    expect(clean - weedy).toBe(4_212);
  });
});
