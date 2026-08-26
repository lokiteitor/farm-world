// The staged purchase sequence of GDD section 120, derived and not written down.
//
// Owner: W5-F. Read by the starting guide panel and by its suite.
//
// GDD section 117 costs a minimum setup of 146 100 against a starting capital of 160 000,
// GDD section 118 shows that holding all five machines idle through the 325 hour cycle costs
// more than the 13 900 cushion, and GDD section 120 draws the conclusion: the player should
// not buy the combine on day one, because it is not needed until roughly 230 hours later,
// and the onboarding has to state that sequence explicitly. This module is that sequence.
//
// Nothing here is a transcription of those numbers. The setup comes from
// `MINIMUM_SETUP_SCENARIO` and `setupCost` of `shared/rules/balance.ts`, and the instant at
// which each machine is first needed comes from `cyclePhases`, which lays out the cycle from
// the crop catalogue, the compatibility table of GDD section 90 and the duration formula of
// GDD section 91. So the "about 230 hours" of GDD section 120 is computed, and if a work
// speed or a phase duration changes the guide moves with it. The balance report of
// `tools/balance` reads the same functions, which is what keeps the guide and the report
// from disagreeing about the arithmetic of the same cycle.
//
// The saving the sequence buys is `balanceKpis` run twice over the same scenario, once with
// `ALL_UPFRONT` and once with `STAGGERED`. It is the same accrual integral the server
// settles wages and maintenance with (plan section 6.2), so the figure the guide promises is
// the figure the ledger will show.

import { labelOfBuildingType } from '~/components/panels/farm-overview/buildingPresentation';
import { OPERATION_LABELS } from '~/components/panels/legend/vocabulary';
import { labelOfMachineType } from '~/components/panels/machinery/machineryPresentation';
import {
  BUILDING_CATALOGUE,
  type BuildingType,
  CROPS,
  CROP_CYCLE_STATES,
  CropCycleState,
  type CropId,
  MACHINE_CATALOGUE,
  MINIMUM_SETUP_SCENARIO,
  MS_PER_GAME_HOUR,
  MachineryOwnershipMode,
  type MachineType,
  Money,
  OPERATION_REQUIREMENTS,
  STARTING_CAPITAL,
  type TaskOperation,
  balanceKpis,
  cycleOperations,
  cyclePhases,
  machineTypesForOperation,
  setupCost,
  type SetupCostBreakdown,
} from '~/shared/index';

/** What a step is waiting on, which is also what the panel groups by. */
export const StepStatus = {
  /** Already in the holding. */
  DONE: 'DONE',
  /** Needed now: the next thing to buy or build. */
  DUE: 'DUE',
  /** Needed later in the cycle. Buying it now only pays maintenance (GDD section 120). */
  LATER: 'LATER',
} as const;
export type StepStatus = (typeof StepStatus)[keyof typeof StepStatus];

export const StepKind = {
  FARM: 'FARM',
  BUILDING: 'BUILDING',
  FIELD: 'FIELD',
  WORKER: 'WORKER',
  MACHINE: 'MACHINE',
} as const;
export type StepKind = (typeof StepKind)[keyof typeof StepKind];

export interface StartingStep {
  readonly id: string;
  readonly kind: StepKind;
  readonly title: string;
  readonly detail: string;
  readonly gddSections: readonly number[];
  /** Catalogue cost, or zero for a step whose cost depends on the selection. */
  readonly cost: Money;
  readonly buildingType: BuildingType | null;
  readonly machineType: MachineType | null;
  /** Operation the machine serves, which is what fixes when it is first needed. */
  readonly operation: TaskOperation | null;
  /** Game hours from the start of the cycle at which it is first needed. */
  readonly neededAtGameHours: number;
  /**
   * Crop cycle state from which the operation may start. A machine is due once a field of
   * the holding has reached it, and later until then.
   */
  readonly dueFromState: CropCycleState | null;
}

/** State of the holding the guide reads. Everything a panel can answer from its stores. */
export interface HoldingSituation {
  readonly hasFarm: boolean;
  readonly buildingTypes: readonly BuildingType[];
  readonly fieldCount: number;
  readonly workerCount: number;
  readonly ownedMachineTypes: readonly MachineType[];
  /**
   * Furthest crop cycle state any field of the holding has reached, projected to now, or
   * null when there is no field. It is what turns the sequence from a checklist into a
   * guide that advances with the player.
   */
  readonly furthestFieldState: CropCycleState | null;
}

export interface EvaluatedStep {
  readonly step: StartingStep;
  readonly status: StepStatus;
}

// ---------------------------------------------------------------------------
// The sequence
// ---------------------------------------------------------------------------

const SCENARIO = MINIMUM_SETUP_SCENARIO;
const CROP = CROPS[SCENARIO.cropId as CropId];

/** Index of a state in the cycle, which is what "further along" means. */
function stateIndex(state: CropCycleState): number {
  return CROP_CYCLE_STATES.indexOf(state);
}

/** Earliest state an operation may start from (GDD sections 76 and 90). */
function earliestStateFor(operation: TaskOperation): CropCycleState {
  const from = OPERATION_REQUIREMENTS[operation].fromCropStates;
  let earliest: CropCycleState = CropCycleState.VIRGIN;
  let best = Number.POSITIVE_INFINITY;
  for (const state of from) {
    const index = stateIndex(state);
    if (index < best) {
      best = index;
      earliest = state;
    }
  }
  return earliest;
}

const BUILDING_STEP_DETAIL: Readonly<Record<BuildingType, string>> = {
  GARAGE: 'Sin plaza de garaje libre no se compra maquinaria.',
  SILO: 'La cosecha necesita sitio donde descargar; sin silo no se asigna.',
  WORKER_HOME: 'Sin plaza de vivienda no se contrata.',
  WORKSHOP: 'Da acceso a la reparacion. El arranque no lo costea.',
  WOOD_STORAGE: 'Almacena la madera de la explotacion forestal.',
  HAY_BARN: 'Guarda el forraje. Sin henil no se cosecha un cultivo forrajero.',
  COLD_STORE: 'Guarda hortaliza, raiz, fruto, hierba y flor: todo lo perecedero.',
  WAREHOUSE: 'Guarda algodon y tabaco, que aguantan secos.',
};

const BUILDING_STEP_SECTIONS: Readonly<Record<BuildingType, readonly number[]>> = {
  GARAGE: [26, 96],
  SILO: [27, 83],
  WORKER_HOME: [28, 108],
  WORKSHOP: [29, 93],
  HAY_BARN: [27, 83],
  COLD_STORE: [27, 83],
  WAREHOUSE: [27, 83],
  WOOD_STORAGE: [136],
};

/**
 * The sequence, in the order the guide shows it: the holding first, then each machine at
 * the point of the cycle that needs it.
 *
 * The machines of one operation travel together, because GDD section 90 requires both: a
 * tractor without a plough ploughs nothing, so offering them as separate steps would let the
 * player complete one and still not be able to work.
 */
export function startingSequence(): readonly StartingStep[] {
  const phases = cyclePhases(SCENARIO, CROP);
  const steps: StartingStep[] = [
    {
      id: 'farm',
      kind: StepKind.FARM,
      title: 'Fundar la granja',
      detail:
        'La granja es la unidad contable: edificios, campos, maquinaria y plantilla cuelgan de ella.',
      gddSections: [23, 31],
      cost: Money.ZERO,
      buildingType: null,
      machineType: null,
      operation: null,
      neededAtGameHours: 0,
      dueFromState: null,
    },
  ];

  for (const type of SCENARIO.buildings) {
    steps.push({
      id: `building:${type}`,
      kind: StepKind.BUILDING,
      title: `Construir ${labelOfBuildingType(type).toLocaleLowerCase('es-ES')}`,
      detail: `${BUILDING_CATALOGUE[type].widthCells} x ${BUILDING_CATALOGUE[type].heightCells} celdas. ${BUILDING_STEP_DETAIL[type]}`,
      gddSections: BUILDING_STEP_SECTIONS[type],
      cost: BUILDING_CATALOGUE[type].purchasePrice,
      buildingType: type,
      machineType: null,
      operation: null,
      neededAtGameHours: 0,
      dueFromState: null,
    });
  }

  steps.push(
    {
      id: 'field',
      kind: StepKind.FIELD,
      title: `Crear el campo inicial de ${SCENARIO.fieldCells} celdas`,
      detail:
        'El rendimiento escala con la superficie y el coste de posesion no, de modo que un campo pequeno no cubre el ciclo.',
      gddSections: [17, 117, 122],
      cost: Money.ZERO,
      buildingType: null,
      machineType: null,
      operation: null,
      neededAtGameHours: 0,
      dueFromState: null,
    },
    {
      id: 'worker',
      kind: StepKind.WORKER,
      title: 'Contratar un trabajador',
      detail:
        'Ninguna tarea se asigna sin un trabajador ocioso, y el salario corre desde la contratacion.',
      gddSections: [102, 107],
      cost: Money.ZERO,
      buildingType: null,
      machineType: null,
      operation: null,
      neededAtGameHours: 0,
      dueFromState: null,
    },
  );

  // One step per machine type and not per use: the tractor pulls the plough and the seed
  // drill, so it appears in two operations and is bought once, at the earlier of the two.
  const alreadyPlanned = new Set<MachineType>();
  for (const operation of cycleOperations(CROP)) {
    const types = machineTypesForOperation(operation);
    const phase = phases.find((candidate) => candidate.operation === operation);
    const neededAtGameHours = phase === undefined ? 0 : Number(phase.fromGameMs / MS_PER_GAME_HOUR);
    const dueFromState = earliestStateFor(operation);
    for (const type of types) {
      if (alreadyPlanned.has(type)) {
        continue;
      }
      alreadyPlanned.add(type);
      steps.push({
        id: `machine:${type}`,
        kind: StepKind.MACHINE,
        title: `Comprar ${labelOfMachineType(type).toLocaleLowerCase('es-ES')}`,
        detail: `${MACHINE_CATALOGUE[type].role === 'POWERED' ? 'Automotriz' : 'Apero'} de la operacion ${OPERATION_LABELS[operation]}. Su mantenimiento corre desde la compra, trabaje o no (§94).`,
        gddSections: [89, 90, 120],
        cost: MACHINE_CATALOGUE[type].purchasePrice,
        buildingType: null,
        machineType: type,
        operation,
        neededAtGameHours,
        dueFromState,
      });
    }
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/**
 * Whether a step is already satisfied by the holding.
 *
 * A machine counts as owned by type and not by identifier: two ploughs are not two steps,
 * and the guide is about capability rather than about inventory.
 */
export function isStepDone(step: StartingStep, situation: HoldingSituation): boolean {
  switch (step.kind) {
    case StepKind.FARM:
      return situation.hasFarm;
    case StepKind.BUILDING:
      return step.buildingType !== null && situation.buildingTypes.includes(step.buildingType);
    case StepKind.FIELD:
      return situation.fieldCount > 0;
    case StepKind.WORKER:
      return situation.workerCount > 0;
    case StepKind.MACHINE:
      return step.machineType !== null && situation.ownedMachineTypes.includes(step.machineType);
  }
}

/**
 * The status of one step.
 *
 * The whole recommendation of GDD section 120 lives in the `LATER` branch: a machine whose
 * operation cannot start yet is not missing, it is early, and buying it now would only add
 * its maintenance to every hour until it is used. A machine is due once a field of the
 * holding has reached the state its operation departs from, which is the same table the task
 * validation reads, and it stays due afterwards, because a cycle that has gone past it will
 * come round again.
 */
export function stepStatus(step: StartingStep, situation: HoldingSituation): StepStatus {
  if (isStepDone(step, situation)) {
    return StepStatus.DONE;
  }
  if (step.kind !== StepKind.MACHINE || step.dueFromState === null) {
    return StepStatus.DUE;
  }
  if (situation.furthestFieldState === null) {
    // No field yet: only the machinery of the first operation of the cycle is due, which is
    // exactly the "do not buy the combine on day one" of GDD section 120.
    return step.neededAtGameHours === 0 ? StepStatus.DUE : StepStatus.LATER;
  }
  return stateIndex(situation.furthestFieldState) >= stateIndex(step.dueFromState)
    ? StepStatus.DUE
    : StepStatus.LATER;
}

export function evaluateSequence(
  situation: HoldingSituation,
  steps: readonly StartingStep[] = startingSequence(),
): readonly EvaluatedStep[] {
  return steps.map((step) => ({ step, status: stepStatus(step, situation) }));
}

// ---------------------------------------------------------------------------
// The figures of GDD sections 117 to 120
// ---------------------------------------------------------------------------

export interface StartingBudget {
  readonly setup: SetupCostBreakdown;
  readonly startingCapital: Money;
  /** Capital left after the minimum setup (GDD section 117: 13 900). */
  readonly cushion: Money;
  /** Holding cost of one cycle buying everything on day one (GDD section 118). */
  readonly holdingUpfront: Money;
  /** The same cycle with the staged purchase of GDD section 120. */
  readonly holdingStaggered: Money;
  /** What the sequence saves over one cycle. */
  readonly saving: Money;
  readonly revenuePerCycle: Money;
  readonly cycleGameHours: number;
}

let memoisedBudget: StartingBudget | null = null;

/**
 * The budget of the guide, computed once and kept: the scenario is a constant of
 * `shared/rules` and every function it goes through is pure, so the answer cannot change
 * between two calls, and the panel is mounted every time the help tab is opened.
 */
export function startingBudget(): StartingBudget {
  if (memoisedBudget !== null) {
    return memoisedBudget;
  }
  const upfront = balanceKpis({ ...SCENARIO, ownershipMode: MachineryOwnershipMode.ALL_UPFRONT });
  const staggered = balanceKpis({ ...SCENARIO, ownershipMode: MachineryOwnershipMode.STAGGERED });
  const setup = setupCost(SCENARIO);
  memoisedBudget = {
    setup,
    startingCapital: STARTING_CAPITAL,
    cushion: Money.sub(STARTING_CAPITAL, setup.total),
    holdingUpfront: upfront.holdingCostPerCycle,
    holdingStaggered: staggered.holdingCostPerCycle,
    saving: Money.sub(upfront.holdingCostPerCycle, staggered.holdingCostPerCycle),
    revenuePerCycle: upfront.revenuePerCycle,
    cycleGameHours: upfront.cycleGameHours,
  };
  return memoisedBudget;
}
