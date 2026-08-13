// Fields: the crop cycle, the geometry and the projected attributes.
//
// Owner: W3-C.
//
// Every attribute of a field that moves with time is lazily accrued on the server (plan
// section 6.5), which means the row carries a value together with the instant it was
// settled at, and the value the player should be looking at is the projection of that
// pair to now. The reply also carries the projection, correct at the instant of the
// reply, so the store keeps both: the reply's projection is authoritative and this
// store's own projection is what keeps a weed bar moving between replies.
//
// Both are computed with the functions of shared/rules, the same ones the server
// validates and settles with, so the number on the panel and the number the harvest will
// use come from one implementation. That is the whole point of the shared rules
// (plan section 8) and the reason nothing here reimplements a formula.

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import {
  CROPS,
  CROP_CYCLE_TRANSITIONS,
  CropCycleState,
  CropId,
  bp,
  finalYieldLiters,
  fromWireGameMs,
  projectCropPhase,
  projectFallowFertility,
  projectWeedLevelAcrossPhases,
  type CellCoordWire,
  type CropPhaseProjection,
  type FieldDto,
  type GameMs,
  type TaskOperation,
  type YieldBreakdown,
} from '~/shared/index';
import { createCollection } from '~/stores/collection';

/** The attributes of a field projected to an instant, computed on the client. */
export interface LocalFieldProjection {
  readonly atGameMs: GameMs;
  readonly cropCycleState: CropCycleState;
  readonly weedLevelBp: number;
  readonly fertilityBp: number;
  readonly fertilizationBp: number;
  readonly growthProgressBp: number;
  readonly readyAtGameMs: GameMs | null;
  readonly nextBoundaryGameMs: GameMs | null;
  readonly expectedYieldLiters: number;
}

/**
 * Operations the state machine admits from a state (GDD sections 76 and 90), read off the
 * transition table of shared/config rather than a switch. A table can be crossed with the
 * machinery requirements in a test; two switches cross with nothing.
 */
export function operationsFromState(state: CropCycleState): readonly TaskOperation[] {
  const operations: TaskOperation[] = [];
  for (const transition of CROP_CYCLE_TRANSITIONS) {
    if (transition.from === state && transition.operation !== null) {
      if (!operations.includes(transition.operation)) {
        operations.push(transition.operation);
      }
    }
  }
  return operations;
}

export const useFieldsStore = defineStore('fields', () => {
  const collection = createCollection<FieldDto>();
  /** Geometry per field. It travels in the detail reply and in the snapshot, not in lists. */
  const cellsByFieldId = ref<Record<string, readonly CellCoordWire[]>>({});

  const totalCellCount = computed(() =>
    collection.all.value.reduce((total, field) => total + field.cellCount, 0),
  );

  const readyToHarvest = computed(() =>
    collection.all.value.filter(
      (field) => field.projection.cropCycleState === CropCycleState.READY_TO_HARVEST,
    ),
  );

  function ofFarm(farmId: string): readonly FieldDto[] {
    return collection.all.value.filter((field) => field.farmId === farmId);
  }

  function cellsOf(fieldId: string): readonly CellCoordWire[] {
    return cellsByFieldId.value[fieldId] ?? [];
  }

  /** Operations the server would accept right now, as the reply reported them. */
  function availableOperations(fieldId: string): readonly TaskOperation[] {
    const field = collection.get(fieldId);
    return field?.projection.availableOperations ?? [];
  }

  /**
   * The same question answered locally from the stored state.
   *
   * It differs from the reply in one case that matters: a field whose materialising job
   * has not run yet is still in its stored state on the row while the projection has
   * already moved on (plan section 6.5). Validation on the server accepts the projected
   * state, so the interface offers the projected one and this function exists to explain
   * the difference in a panel rather than to hide it.
   */
  function operationsFromStoredState(fieldId: string): readonly TaskOperation[] {
    const field = collection.get(fieldId);
    return field === undefined ? [] : operationsFromState(field.cropCycleState);
  }

  /** Where a sown field is in the timed part of its cycle (GDD section 76). */
  function phaseAt(fieldId: string, atGameMs: GameMs): CropPhaseProjection | null {
    const field = collection.get(fieldId);
    if (field === undefined || field.seededAtGameMs === null || field.cropId === null) {
      return null;
    }
    return projectCropPhase(fromWireGameMs(field.seededAtGameMs), atGameMs, CROPS[field.cropId]);
  }

  /**
   * The full projection at an instant, with the shared rules.
   *
   * The order is not arbitrary: the phase decides which state the weed and fertility
   * projections are evaluated in, because weeds grow only in some states and fertility
   * recovers only while fallow (shared/config/transitions.ts).
   */
  function projectAt(fieldId: string, atGameMs: GameMs): LocalFieldProjection | null {
    const field = collection.get(fieldId);
    if (field === undefined) {
      return null;
    }
    const crop = CROPS[field.cropId ?? CropId.WHEAT];
    const phase = phaseAt(fieldId, atGameMs);
    const state = phase?.state ?? field.cropCycleState;

    // The interval is cut at the phase boundaries, with the shared rule the server settles
    // with. Projecting the whole stretch with the state of the final instant would count the
    // eighteen hours of `SEEDED` plus `GERMINATING` as weed growing hours, which GDD section
    // 78 does not admit, and the panel would show a yield below the authoritative one.
    const weedLevelBp = projectWeedLevelAcrossPhases({
      weedLevelBp: bp(field.weedLevelBp),
      updatedAtGameMs: fromWireGameMs(field.weedLevelUpdatedAtGameMs),
      toGameMs: atGameMs,
      cropCycleState: field.cropCycleState,
      seededAtGameMs: field.seededAtGameMs === null ? null : fromWireGameMs(field.seededAtGameMs),
      crop,
    });
    const fertilityBp = projectFallowFertility({
      fertilityBp: bp(field.fertilityBp),
      updatedAtGameMs: fromWireGameMs(field.fertilityUpdatedAtGameMs),
      toGameMs: atGameMs,
      cropCycleState: state,
      crop,
    });
    const fertilizationBp = bp(field.fertilizationBp);
    const expected = finalYieldLiters({
      cellCount: field.cellCount,
      crop,
      fertilityBp,
      fertilizationBp,
      weedLevelBp,
    });

    return {
      atGameMs,
      cropCycleState: state,
      weedLevelBp,
      fertilityBp,
      fertilizationBp,
      growthProgressBp: phase?.growthProgressBp ?? field.projection.growthProgressBp,
      readyAtGameMs:
        field.projection.readyAtGameMs === null
          ? null
          : fromWireGameMs(field.projection.readyAtGameMs),
      nextBoundaryGameMs: phase?.nextBoundaryGameMs ?? null,
      expectedYieldLiters: expected.liters,
    };
  }

  /**
   * Expected yield with its factors, so a panel can say why the number is what it is
   * (GDD section 83). This is the figure the harvest assignment has to reserve room for.
   */
  function expectedYieldAt(fieldId: string, atGameMs: GameMs): YieldBreakdown | null {
    const field = collection.get(fieldId);
    const projection = projectAt(fieldId, atGameMs);
    if (field === undefined || projection === null) {
      return null;
    }
    return finalYieldLiters({
      cellCount: field.cellCount,
      crop: CROPS[field.cropId ?? CropId.WHEAT],
      fertilityBp: bp(projection.fertilityBp),
      fertilizationBp: bp(projection.fertilizationBp),
      weedLevelBp: bp(projection.weedLevelBp),
    });
  }

  function applyCells(fieldId: string, cells: readonly CellCoordWire[]): void {
    cellsByFieldId.value[fieldId] = cells;
  }

  function removeWithCells(fieldId: string): void {
    collection.remove(fieldId);
    delete cellsByFieldId.value[fieldId];
  }

  function replaceAllCells(
    entries: readonly { readonly fieldId: string; readonly cells: readonly CellCoordWire[] }[],
  ): void {
    const map: Record<string, readonly CellCoordWire[]> = {};
    for (const entry of entries) {
      map[entry.fieldId] = entry.cells;
    }
    cellsByFieldId.value = map;
  }

  function reset(): void {
    collection.clear();
    cellsByFieldId.value = {};
  }

  return {
    byId: collection.byId,
    all: collection.all,
    count: collection.count,
    get: collection.get,
    upsert: collection.upsert,
    upsertMany: collection.upsertMany,
    replaceAll: collection.replaceAll,
    cellsByFieldId,
    totalCellCount,
    readyToHarvest,
    ofFarm,
    cellsOf,
    availableOperations,
    operationsFromStoredState,
    phaseAt,
    projectAt,
    expectedYieldAt,
    applyCells,
    remove: removeWithCells,
    replaceAllCells,
    reset,
  };
});
