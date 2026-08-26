// La proyeccion local de un campo, sobre el punto en el que divergia del servidor.
//
// Propietario: W7-E (correcciones de la revision adversarial).
//
// El caso es el hallazgo H4 de `docs/revision-formulas.md`: el almacen proyectaba las
// malezas de GDD 78 con una sola llamada y el estado del instante final, mientras el
// servidor corta el intervalo por las fronteras de fase. Con un campo sembrado cuyo trabajo
// materializador no ha corrido todavia —que es el estado que el propio almacen documenta y
// ofrece con `operationsFromStoredState`— las dos cifras se separaban en 1.080 puntos base,
// que son exactamente las 18 h de `SEEDED` mas `GERMINATING`, y hasta 1.459 L en el
// rendimiento de GDD 83 que muestran el inspector y el listado de campos.
//
// La prueba afirma la igualdad con la regla compartida, no con un literal: lo que se
// defiende es que hay una unica implementacion, no un numero concreto.

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CropCycleState,
  SoilCondition,
  bp,
  finalYieldLiters,
  gameMs,
  projectWeedLevelAcrossPhases,
  toWireGameMs,
  WHEAT,
  type FieldDto,
} from '~/shared/index';
import { useFieldsStore } from '~/stores/fields';

const FIELD_ID = '019ffc00-0000-7000-8000-000000000001';
const SEEDED_AT = gameMs(0n);
const at = (hours: number): bigint => BigInt(Math.round(hours * 3_600_000));

/** Un campo sembrado en t0 cuya fila sigue en `SEEDED`, que es el caso del defecto. */
function sownField(): FieldDto {
  return {
    id: FIELD_ID,
    farmId: null,
    name: 'Campo de la proyeccion',
    cellCount: 250,
    cropId: 'WHEAT',
    cropCycleState: CropCycleState.SEEDED,
    soilCondition: SoilCondition.PLOWED,
    fertilityBp: 10_000,
    fertilityUpdatedAtGameMs: toWireGameMs(SEEDED_AT),
    weedLevelBp: 0,
    weedLevelUpdatedAtGameMs: toWireGameMs(SEEDED_AT),
    fertilizationBp: 0,
    fertilizationUpdatedAtGameMs: toWireGameMs(SEEDED_AT),
    stateEnteredAtGameMs: toWireGameMs(SEEDED_AT),
    seededAtGameMs: toWireGameMs(SEEDED_AT),
    currentTaskId: null,
    createdAtGameMs: toWireGameMs(SEEDED_AT),
    projection: {
      atGameMs: toWireGameMs(SEEDED_AT),
      cropCycleState: CropCycleState.SEEDED,
      growthProgressBp: 0,
      weedLevelBp: 0,
      fertilityBp: 10_000,
      fertilizationBp: 0,
      readyAtGameMs: toWireGameMs(gameMs(at(96))),
      expectedYieldLiters: 22_500,
      availableOperations: [],
    },
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('la proyeccion local de malezas de un campo sembrado', () => {
  it('coincide con la regla compartida segmentada por fase, no con una sola llamada', () => {
    const store = useFieldsStore();
    store.upsert(sownField());

    for (const hours of [6, 18, 30, 96, 120]) {
      const instant = gameMs(at(hours));
      const expected = projectWeedLevelAcrossPhases({
        weedLevelBp: bp(0),
        updatedAtGameMs: SEEDED_AT,
        toGameMs: instant,
        cropCycleState: CropCycleState.SEEDED,
        seededAtGameMs: SEEDED_AT,
        land: WHEAT,
        crop: WHEAT,
      });
      const projected = store.projectAt(FIELD_ID, instant);
      expect(projected, `sin proyeccion a las ${hours} h`).not.toBeNull();
      expect(projected?.weedLevelBp, `malezas a las ${hours} h`).toBe(expected);
    }
  });

  it('no acumula malezas en las 18 h de SEEDED y GERMINATING (GDD 78)', () => {
    const store = useFieldsStore();
    store.upsert(sownField());
    expect(store.projectAt(FIELD_ID, gameMs(at(18)))?.weedLevelBp).toBe(0);
  });

  it('publica el rendimiento de GDD 83 que se deriva de ese nivel', () => {
    const store = useFieldsStore();
    store.upsert(sownField());
    const instant = gameMs(at(96));
    const projected = store.projectAt(FIELD_ID, instant);
    expect(projected).not.toBeNull();
    const expected = finalYieldLiters({
      cellCount: 250,
      crop: WHEAT,
      fertilityBp: bp(10_000),
      fertilizationBp: bp(0),
      weedLevelBp: bp(projected?.weedLevelBp ?? 0),
    });
    expect(projected?.expectedYieldLiters).toBe(expected.liters);
    // 78 h de `GROWING` a 60 bp/h: el 46,8 % que la desviacion documentada publica.
    expect(projected?.weedLevelBp).toBe(4_680);
    expect(projected?.expectedYieldLiters).toBe(18_288);
  });
});
