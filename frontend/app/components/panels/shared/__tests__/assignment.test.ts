// The assignment as the interface judges it: the table of GDD section 76, the table of
// GDD section 90, and the order of the nine refusals of GDD section 104.
//
// Owner: W6-T.
//
// The three tables are asserted here and not on the component, because they are pure and a
// rendered `<select>` is the worst place to read a state machine from. What the component
// suite adds is the half that is not pure: that the offered options are these ones, that a
// refused row is rendered disabled and carries its sentence, and that the preview is asked
// for.
//
// The tables below are transcribed from the GDD and not derived from the code they check.
// Deriving them would make the test agree with the implementation by construction, which is
// exactly the failure mode a transcription of a specification exists to catch.

import { describe, expect, it } from 'vitest';
import {
  assignmentBlockingCode,
  catalogueOf,
  combinationBlockingCode,
  cropBlockingCode,
  isMachineBusy,
  machineCombinations,
  missingMachineryCode,
  operationsForField,
  operationsFromState,
  requirementOf,
  reservedMachineTypes,
  storageBlockingCode,
  targetBlockingCode,
  unitLabel,
  unitsForAssignment,
  workerBlockingCode,
  workerChoices,
  type TargetSituation,
} from '~/components/panels/shared/assignment';
import {
  CROP_CYCLE_STATES,
  CropCycleState,
  CropId,
  MACHINE_TYPES,
  MIN_CONDITION_TO_ASSIGN,
  MachineRole,
  MachineStatus,
  MachineType,
  SoilCondition,
  TASK_OPERATIONS,
  TaskOperation,
  VALIDATION_MESSAGES,
  ValidationCode,
  WorkerStatus,
  bp,
  explainIncompatibility,
  type FieldDto,
  type ForestPlotDto,
  type MachineDto,
  type WorkerDto,
} from '~/shared/index';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function machine(overrides: Partial<MachineDto> = {}): MachineDto {
  return {
    id: 'machine-tractor',
    farmId: 'farm-1',
    garageId: 'building-garage',
    type: MachineType.TRACTOR,
    conditionBp: bp(8_000),
    conditionUpdatedAtGameMs: '0',
    status: MachineStatus.IDLE,
    currentTaskId: null,
    repairEndsAtGameMs: null,
    purchasePrice: '18000.0000',
    acquiredGameMs: '0',
    resaleValue: '9000.0000',
    repairCost: '2700.0000',
    repairDurationGameHours: 12.5,
    assignable: true,
    ...overrides,
  };
}

function worker(overrides: Partial<WorkerDto> = {}): WorkerDto {
  return {
    id: 'worker-1',
    farmId: 'farm-1',
    homeId: 'building-home',
    name: 'Elena Prado',
    skillBp: bp(7_400),
    salaryPerGameHour: '22.0000',
    status: WorkerStatus.IDLE,
    currentTaskId: null,
    completedTaskCount: 0,
    hiredGameMs: '0',
    skillFactor: 0.9,
    ...overrides,
  };
}

function field(state: CropCycleState, overrides: Partial<FieldDto> = {}): FieldDto {
  const base: FieldDto = {
    id: 'field-1',
    farmId: 'farm-1',
    name: 'Parcela',
    cellCount: 120,
    cropId: null,
    cropCycleState: state,
    soilCondition: SoilCondition.UNTOUCHED,
    fertilityBp: bp(8_000),
    fertilityUpdatedAtGameMs: '0',
    weedLevelBp: bp(1_000),
    weedLevelUpdatedAtGameMs: '0',
    fertilizationBp: bp(0),
    fertilizationUpdatedAtGameMs: '0',
    stateEnteredAtGameMs: '0',
    seededAtGameMs: null,
    currentTaskId: null,
    createdAtGameMs: '0',
    projection: {
      atGameMs: '0',
      cropCycleState: state,
      growthProgressBp: bp(0),
      weedLevelBp: bp(1_000),
      fertilityBp: bp(8_000),
      fertilizationBp: bp(0),
      readyAtGameMs: null,
      expectedYieldLiters: 0,
      availableOperations: [],
    },
  };
  return { ...base, ...overrides };
}

function plot(overrides: Partial<ForestPlotDto> = {}): ForestPlotDto {
  return {
    id: 'plot-1',
    farmId: 'farm-1',
    name: 'Bosque',
    cellCount: 40,
    emptyCellCount: 0,
    standingTreeCount: 40,
    fellableTreeCount: 30,
    standingWoodDm3: 12_000,
    fellableWoodDm3: 9_000,
    fellableWoodValue: '405.0000',
    stageHistogram: { SAPLING: 10, YOUNG: 10, MATURE: 10, OLD_GROWTH: 10 },
    currentTaskId: null,
    createdAtGameMs: '0',
    atGameMs: '0',
    ...overrides,
  };
}

function target(overrides: Partial<TargetSituation> = {}): TargetSituation {
  return {
    field: null,
    plot: null,
    selectedCellCount: 0,
    fellableTreeCount: 0,
    emptyCellCount: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// GDD section 76
// ---------------------------------------------------------------------------

/**
 * The transitions of GDD section 76, transcribed from the table of that section plus its
 * note, which admits `PLOWED -> SEEDED` for a crop with `requiresCultivation: false` and
 * which GDD section 90 states outright as "CULTIVATED/PLOWED -> SEEDED".
 */
const OPERATIONS_OF_SECTION_76: Readonly<Record<CropCycleState, readonly TaskOperation[]>> = {
  VIRGIN: [TaskOperation.PLOW],
  PLOWED: [TaskOperation.CULTIVATE, TaskOperation.SEED],
  CULTIVATED: [TaskOperation.SEED],
  SEEDED: [],
  GERMINATING: [],
  GROWING: [],
  READY_TO_HARVEST: [TaskOperation.HARVEST],
  HARVESTED: [],
};

describe('las operaciones que ofrece un campo (§76)', () => {
  it('los ocho estados del ciclo tienen fila propia y ninguno queda sin comprobar', () => {
    expect(CROP_CYCLE_STATES).toHaveLength(8);
    expect(Object.keys(OPERATIONS_OF_SECTION_76).sort()).toEqual([...CROP_CYCLE_STATES].sort());
  });

  it('cada estado ofrece exactamente las transiciones de la tabla', () => {
    for (const state of CROP_CYCLE_STATES) {
      expect(operationsFromState(state)).toEqual(OPERATIONS_OF_SECTION_76[state]);
    }
  });

  it('los cinco estados automaticos no ofrecen ninguna operacion', () => {
    const automatic = [
      CropCycleState.SEEDED,
      CropCycleState.GERMINATING,
      CropCycleState.GROWING,
      CropCycleState.HARVESTED,
    ];
    for (const state of automatic) {
      expect(operationsFromState(state)).toEqual([]);
    }
  });

  it('la operacion ofrecida sale de la proyeccion y no del estado almacenado', () => {
    // The two differ exactly while the materialising job has not run, and the server
    // validates against the projection (ADR-0035).
    const ready = field(CropCycleState.GROWING, {
      projection: {
        ...field(CropCycleState.GROWING).projection,
        cropCycleState: CropCycleState.READY_TO_HARVEST,
      },
    });
    expect(ready.cropCycleState).toBe(CropCycleState.GROWING);
    expect(operationsForField(ready)).toEqual([TaskOperation.HARVEST]);
  });
});

// ---------------------------------------------------------------------------
// GDD section 90
// ---------------------------------------------------------------------------

/** The table of GDD section 90, plus the three operations the plan adds to it. */
const MACHINERY_OF_SECTION_90: Readonly<
  Record<TaskOperation, { powered: MachineType; implement: MachineType | null }>
> = {
  PLOW: { powered: MachineType.TRACTOR, implement: MachineType.PLOW },
  CULTIVATE: { powered: MachineType.TRACTOR, implement: MachineType.CULTIVATOR },
  SEED: { powered: MachineType.TRACTOR, implement: MachineType.SEEDER },
  HARVEST: { powered: MachineType.HARVESTER, implement: MachineType.TRAILER },
  FELL: { powered: MachineType.HARVESTER_FORESTRY, implement: null },
  REPLANT: { powered: MachineType.HARVESTER_FORESTRY, implement: null },
  CLEAR_LAND: { powered: MachineType.TRACTOR, implement: MachineType.PLOW },
};

const POWERED_TYPES = MACHINE_TYPES.filter(
  (type) => catalogueOf(type).role === MachineRole.POWERED,
);
const IMPLEMENT_TYPES = MACHINE_TYPES.filter(
  (type) => catalogueOf(type).role === MachineRole.IMPLEMENT,
);

describe('la tabla de compatibilidad de §90', () => {
  it('el catalogo declara para cada operacion la maquina y el implemento de la tabla', () => {
    for (const operation of TASK_OPERATIONS) {
      const requirement = requirementOf(operation);
      const expected = MACHINERY_OF_SECTION_90[operation];
      expect(requirement.poweredMachine).toBe(expected.powered);
      expect(requirement.requiredImplement).toBe(expected.implement);
      expect(reservedMachineTypes(operation)).toEqual(
        expected.implement === null ? [expected.powered] : [expected.powered, expected.implement],
      );
    }
  });

  it('toda combinacion distinta de la de la tabla se rechaza con un motivo legible', () => {
    const owned = [...MACHINE_TYPES];
    let refused = 0;
    for (const operation of TASK_OPERATIONS) {
      const expected = MACHINERY_OF_SECTION_90[operation];
      const candidates: (readonly MachineType[])[] = [];
      for (const powered of POWERED_TYPES) {
        candidates.push([powered]);
        for (const implement of IMPLEMENT_TYPES) {
          candidates.push([powered, implement]);
        }
      }
      for (const offered of candidates) {
        const valid =
          offered[0] === expected.powered &&
          (expected.implement === null
            ? offered.length === 1
            : offered.length === 2 && offered[1] === expected.implement);
        const codes = explainIncompatibility({
          operation,
          offeredMachineTypes: offered,
          ownedMachineTypes: owned,
        });
        if (valid) {
          expect(codes).toEqual([]);
          continue;
        }
        refused += 1;
        expect(codes.length).toBeGreaterThan(0);
        for (const code of codes) {
          const message = VALIDATION_MESSAGES[code];
          expect(message).toBeDefined();
          expect(message).not.toBe(code);
          expect(message.length).toBeGreaterThan(10);
        }
      }
    }
    // Three powered types and four implement types give fifteen candidates per operation,
    // of which exactly one is the row of the table.
    expect(refused).toBe(
      TASK_OPERATIONS.length * (POWERED_TYPES.length * (1 + IMPLEMENT_TYPES.length) - 1),
    );
  });

  it('la tala exige poseer el autocargador aunque no lo reserve (§134)', () => {
    const withoutForwarder = MACHINE_TYPES.filter((type) => type !== MachineType.FORWARDER);
    expect(
      explainIncompatibility({
        operation: TaskOperation.FELL,
        offeredMachineTypes: [MachineType.HARVESTER_FORESTRY],
        ownedMachineTypes: withoutForwarder,
      }),
    ).toEqual([ValidationCode.FORWARDER_REQUIRED]);
    expect(
      explainIncompatibility({
        operation: TaskOperation.FELL,
        offeredMachineTypes: [MachineType.HARVESTER_FORESTRY],
        ownedMachineTypes: [...MACHINE_TYPES],
      }),
    ).toEqual([]);
  });

  it('la cosecha sin remolque nombra el remolque y no un implemento generico', () => {
    expect(
      explainIncompatibility({
        operation: TaskOperation.HARVEST,
        offeredMachineTypes: [MachineType.HARVESTER],
        ownedMachineTypes: [MachineType.HARVESTER],
      }),
    ).toEqual([ValidationCode.TRAILER_REQUIRED]);
  });
});

describe('las combinaciones que el panel enumera', () => {
  it('enumera el producto de los tipos requeridos y ninguno mas', () => {
    const holding = [
      machine({ id: 'tractor-a' }),
      machine({ id: 'tractor-b' }),
      machine({ id: 'plow-a', type: MachineType.PLOW }),
      machine({ id: 'plow-b', type: MachineType.PLOW }),
      machine({ id: 'seeder', type: MachineType.SEEDER }),
    ];
    const rows = machineCombinations(TaskOperation.PLOW, holding);
    expect(rows.map((row) => row.key)).toEqual([
      'tractor-a+plow-a',
      'tractor-a+plow-b',
      'tractor-b+plow-a',
      'tractor-b+plow-b',
    ]);
    expect(rows.every((row) => row.usable)).toBe(true);
    // The implement sets the pace when there is one (GDD section 91).
    expect(rows[0]?.paceMachine.id).toBe('plow-a');
  });

  it('una combinacion inutilizable sigue apareciendo, con su codigo', () => {
    const holding = [
      machine({ id: 'tractor-busy', status: MachineStatus.WORKING, currentTaskId: 'task-1' }),
      machine({ id: 'plow-worn', type: MachineType.PLOW, conditionBp: bp(500) }),
    ];
    const rows = machineCombinations(TaskOperation.PLOW, holding);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.usable).toBe(false);
    // The powered machine is check 2 and the implement is check 5: the tractor answers.
    expect(rows[0]?.code).toBe(ValidationCode.MACHINE_NOT_IDLE);
    expect(isMachineBusy(holding[0] as MachineDto)).toBe(true);
  });

  it('el orden de los cuatro chequeos de maquinaria es el del servidor', () => {
    const busy = machine({ status: MachineStatus.WORKING });
    const worn = machine({ conditionBp: bp(MIN_CONDITION_TO_ASSIGN - 1) });
    const plow = machine({ id: 'plow', type: MachineType.PLOW });
    const wornPlow = machine({ id: 'plow', type: MachineType.PLOW, conditionBp: bp(1) });
    const owned = [MachineType.TRACTOR, MachineType.PLOW];

    // 2. The powered machine, before the table.
    expect(
      combinationBlockingCode({
        operation: TaskOperation.PLOW,
        powered: busy,
        implement: wornPlow,
        ownedMachineTypes: owned,
      }),
    ).toBe(ValidationCode.MACHINE_NOT_IDLE);
    expect(
      combinationBlockingCode({
        operation: TaskOperation.PLOW,
        powered: worn,
        implement: plow,
        ownedMachineTypes: owned,
      }),
    ).toBe(ValidationCode.MACHINE_CONDITION_TOO_LOW);
    // 4 and 5: the table answers before the availability of the implement.
    expect(
      combinationBlockingCode({
        operation: TaskOperation.CULTIVATE,
        powered: machine(),
        implement: wornPlow,
        ownedMachineTypes: owned,
      }),
    ).toBe(ValidationCode.IMPLEMENT_REQUIRED);
    expect(
      combinationBlockingCode({
        operation: TaskOperation.PLOW,
        powered: machine(),
        implement: wornPlow,
        ownedMachineTypes: owned,
      }),
    ).toBe(ValidationCode.MACHINE_CONDITION_TOO_LOW);
    expect(
      combinationBlockingCode({
        operation: TaskOperation.PLOW,
        powered: machine(),
        implement: plow,
        ownedMachineTypes: owned,
      }),
    ).toBeNull();
  });

  it('sin ninguna maquina del tipo, el motivo nombra lo que falta', () => {
    expect(missingMachineryCode(TaskOperation.PLOW, [])).toBe(
      ValidationCode.POWERED_MACHINE_REQUIRED,
    );
    expect(missingMachineryCode(TaskOperation.PLOW, [machine()])).toBe(
      ValidationCode.IMPLEMENT_REQUIRED,
    );
    expect(
      missingMachineryCode(TaskOperation.HARVEST, [
        machine({ type: MachineType.HARVESTER, id: 'combine' }),
      ]),
    ).toBe(ValidationCode.TRAILER_REQUIRED);
    expect(
      missingMachineryCode(TaskOperation.FELL, [
        machine({ type: MachineType.HARVESTER_FORESTRY, id: 'forest-head' }),
      ]),
    ).toBe(ValidationCode.FORWARDER_REQUIRED);
  });
});

// ---------------------------------------------------------------------------
// The rest of the sequence of GDD section 104
// ---------------------------------------------------------------------------

describe('el trabajador (chequeos 1 y 6)', () => {
  it('el estado responde antes que la granja, que es lo que hace el servidor', () => {
    const busyElsewhere = worker({
      status: WorkerStatus.WORKING,
      currentTaskId: 'task-1',
      farmId: 'farm-2',
    });
    expect(workerBlockingCode(busyElsewhere, 'farm-1')).toBe(ValidationCode.WORKER_NOT_IDLE);
    expect(workerBlockingCode(worker({ farmId: 'farm-2' }), 'farm-1')).toBe(
      ValidationCode.WORKER_WRONG_FARM,
    );
    expect(workerBlockingCode(worker(), 'farm-1')).toBeNull();
    expect(workerBlockingCode(worker({ farmId: 'farm-2' }), null)).toBeNull();
  });

  it('la plantilla se devuelve entera y en el orden recibido, con su veredicto', () => {
    const rows = workerChoices([worker(), worker({ id: 'w2', farmId: 'farm-2' })], 'farm-1');
    expect(rows.map((row) => row.worker.id)).toEqual(['worker-1', 'w2']);
    expect(rows.map((row) => row.usable)).toEqual([true, false]);
    expect(rows[1]?.code).toBe(ValidationCode.WORKER_WRONG_FARM);
  });
});

describe('el objetivo, el cultivo y el almacen (chequeos 7, 8 y 9)', () => {
  it('un campo con tarea en curso responde antes que su estado', () => {
    const busy = field(CropCycleState.GROWING, { currentTaskId: 'task-1' });
    expect(targetBlockingCode(TaskOperation.PLOW, target({ field: busy }))).toBe(
      ValidationCode.FIELD_HAS_ACTIVE_TASK,
    );
    expect(
      targetBlockingCode(TaskOperation.PLOW, target({ field: field(CropCycleState.GROWING) })),
    ).toBe(ValidationCode.FIELD_STATE_NOT_ALLOWED);
    expect(
      targetBlockingCode(TaskOperation.PLOW, target({ field: field(CropCycleState.VIRGIN) })),
    ).toBeNull();
    expect(targetBlockingCode(TaskOperation.PLOW, target())).toBe(ValidationCode.NOT_FOUND);
  });

  it('una tala sin arboles talables y una replantacion sin celdas se niegan por su motivo', () => {
    expect(
      targetBlockingCode(TaskOperation.FELL, target({ plot: plot(), fellableTreeCount: 0 })),
    ).toBe(ValidationCode.NO_FELLABLE_TREES);
    expect(
      targetBlockingCode(TaskOperation.FELL, target({ plot: plot(), fellableTreeCount: 3 })),
    ).toBeNull();
    expect(
      targetBlockingCode(
        TaskOperation.REPLANT,
        target({ plot: plot({ emptyCellCount: 5 }), emptyCellCount: 5 }),
      ),
    ).toBe(ValidationCode.SELECTION_EMPTY);
    expect(targetBlockingCode(TaskOperation.REPLANT, target({ plot: plot() }))).toBe(
      ValidationCode.CELL_ALREADY_HAS_TREE,
    );
    expect(targetBlockingCode(TaskOperation.CLEAR_LAND, target())).toBe(
      ValidationCode.SELECTION_EMPTY,
    );
    expect(
      targetBlockingCode(TaskOperation.CLEAR_LAND, target({ selectedCellCount: 4 })),
    ).toBeNull();
  });

  it('solo la siembra exige cultivo, y uno del catalogo', () => {
    for (const operation of TASK_OPERATIONS) {
      expect(requirementOf(operation).requiresCrop).toBe(operation === TaskOperation.SEED);
    }
    expect(cropBlockingCode(TaskOperation.SEED, null)).toBe(ValidationCode.FIELD_CROP_REQUIRED);
    expect(cropBlockingCode(TaskOperation.SEED, CropId.WHEAT)).toBeNull();
    expect(cropBlockingCode(TaskOperation.SEED, 'BARLEY' as CropId)).toBe(
      ValidationCode.CROP_UNKNOWN,
    );
    expect(cropBlockingCode(TaskOperation.PLOW, CropId.WHEAT)).toBe(
      ValidationCode.FIELD_CROP_NOT_ALLOWED,
    );
    expect(cropBlockingCode(TaskOperation.PLOW, null)).toBeNull();
  });

  it('el almacen niega por falta de instalacion o de hueco, y no por caber solo en parte', () => {
    expect(storageBlockingCode(TaskOperation.PLOW, null)).toBeNull();
    expect(storageBlockingCode(TaskOperation.HARVEST, null)).toBe(ValidationCode.STORAGE_REQUIRED);
    expect(storageBlockingCode(TaskOperation.HARVEST, { hasStore: false, freeUnits: 0 })).toBe(
      ValidationCode.STORAGE_REQUIRED,
    );
    expect(storageBlockingCode(TaskOperation.HARVEST, { hasStore: true, freeUnits: 0 })).toBe(
      ValidationCode.STORAGE_CAPACITY_EXCEEDED,
    );
    expect(storageBlockingCode(TaskOperation.FELL, { hasStore: true, freeUnits: 0 })).toBe(
      ValidationCode.STORAGE_CAPACITY_EXCEEDED,
    );
    // Room for part of the harvest is a warning and not a refusal (GDD sections 83 y 97).
    expect(storageBlockingCode(TaskOperation.HARVEST, { hasStore: true, freeUnits: 1 })).toBeNull();
  });
});

describe('la secuencia completa', () => {
  const holding = [machine(), machine({ id: 'plow', type: MachineType.PLOW })];
  const good = machineCombinations(TaskOperation.PLOW, holding)[0] ?? null;

  it('con todo en orden no hay motivo', () => {
    expect(
      assignmentBlockingCode({
        operation: TaskOperation.PLOW,
        worker: worker(),
        combination: good,
        machines: holding,
        target: target({ field: field(CropCycleState.VIRGIN) }),
        cropId: null,
        storage: null,
      }),
    ).toBeNull();
  });

  it('con cuatro motivos ciertos a la vez responde el primero de la secuencia', () => {
    // Busy worker, busy machinery, field with a task and no silo: the server answers the
    // worker, and so does the panel (ADR-0048).
    const busyHolding = [
      machine({ status: MachineStatus.WORKING }),
      machine({ id: 'plow', type: MachineType.PLOW, status: MachineStatus.WORKING }),
    ];
    const code = assignmentBlockingCode({
      operation: TaskOperation.HARVEST,
      worker: worker({ status: WorkerStatus.WORKING, currentTaskId: 'task-1' }),
      combination: machineCombinations(TaskOperation.HARVEST, busyHolding)[0] ?? null,
      machines: busyHolding,
      target: target({ field: field(CropCycleState.GROWING, { currentTaskId: 'task-9' }) }),
      cropId: null,
      storage: { hasStore: false, freeUnits: 0 },
    });
    expect(code).toBe(ValidationCode.WORKER_NOT_IDLE);
  });

  it('la granja del trabajador se comprueba despues de la maquinaria, no antes', () => {
    const wornHolding = [
      machine({ conditionBp: bp(1) }),
      machine({ id: 'plow', type: MachineType.PLOW }),
    ];
    expect(
      assignmentBlockingCode({
        operation: TaskOperation.PLOW,
        worker: worker({ farmId: 'farm-2' }),
        combination: machineCombinations(TaskOperation.PLOW, wornHolding)[0] ?? null,
        machines: wornHolding,
        target: target({ field: field(CropCycleState.VIRGIN) }),
        cropId: null,
        storage: null,
      }),
    ).toBe(ValidationCode.MACHINE_CONDITION_TOO_LOW);
    expect(
      assignmentBlockingCode({
        operation: TaskOperation.PLOW,
        worker: worker({ farmId: 'farm-2' }),
        combination: good,
        machines: holding,
        target: target({ field: field(CropCycleState.VIRGIN) }),
        cropId: null,
        storage: null,
      }),
    ).toBe(ValidationCode.WORKER_WRONG_FARM);
  });

  it('sin plantilla el motivo es el trabajador y sin maquinaria, la que falta', () => {
    expect(
      assignmentBlockingCode({
        operation: TaskOperation.PLOW,
        worker: null,
        combination: null,
        machines: [],
        target: target({ field: field(CropCycleState.VIRGIN) }),
        cropId: null,
        storage: null,
      }),
    ).toBe(ValidationCode.WORKER_NOT_IDLE);
    expect(
      assignmentBlockingCode({
        operation: TaskOperation.PLOW,
        worker: worker(),
        combination: null,
        machines: [machine()],
        target: target({ field: field(CropCycleState.VIRGIN) }),
        cropId: null,
        storage: null,
      }),
    ).toBe(ValidationCode.IMPLEMENT_REQUIRED);
  });
});

describe('las unidades de la tarea', () => {
  it('el campo cuenta celdas, la tala cuenta arboles y el desmonte, la seleccion', () => {
    expect(
      unitsForAssignment(TaskOperation.PLOW, target({ field: field(CropCycleState.VIRGIN) })),
    ).toBe(120);
    expect(
      unitsForAssignment(TaskOperation.FELL, target({ plot: plot(), fellableTreeCount: 17 })),
    ).toBe(17);
    expect(
      unitsForAssignment(TaskOperation.REPLANT, target({ plot: plot(), selectedCellCount: 9 })),
    ).toBe(9);
    expect(unitsForAssignment(TaskOperation.CLEAR_LAND, target({ selectedCellCount: 4 }))).toBe(4);
  });

  it('la unidad se nombra en singular y en plural, y la tala habla de arboles', () => {
    expect(unitLabel(TaskOperation.FELL, 1)).toBe('arbol');
    expect(unitLabel(TaskOperation.FELL, 2)).toBe('arboles');
    expect(unitLabel(TaskOperation.PLOW, 1)).toBe('celda');
    expect(unitLabel(TaskOperation.PLOW, 2)).toBe('celdas');
  });
});
