// How a machine is named, described and judged in the interface.
//
// Owner: W5-F. Read by the machinery panel, by the starting guide, and available to any
// other panel that shows a machine: `docs/handoff/NOTES-w4f.md`, section 2.4, records that
// the building inspector prints the raw enum identifier of `MachineType` and
// `MachineStatus` because no table of Spanish labels existed, and asks for one that both
// panels can read. This is that table.
//
// It follows the shape `farm-overview/buildingPresentation.ts` established for buildings
// (ADR-0037): presentation only, every figure taken from `MACHINE_CATALOGUE`, so adding a
// machine to `shared/config/machines.ts` adds it here with no edit and no price, speed or
// capacity is ever written as a literal (ADR-0011).
//
// The three blocking-code functions are the other half. ADR-0032 fixes that the reason a
// control is disabled is the `ValidationCode` the server would refuse the request with, in
// the same order the server evaluates it, so the functions mirror
// `backend/src/modules/machinery/service.ts` step by step and are pure, which is what lets
// the suite assert the code rather than the sentence.

import {
  CONDITION_WARNING_THRESHOLD,
  MACHINE_CATALOGUE,
  MIN_CONDITION_TO_ASSIGN,
  type MachineRole,
  MachineStatus,
  type MachineType,
  Money,
  ValidationCode,
  bp,
  canRepairMachine,
  fromWireMoney,
  type MachineDefinition,
  type MachineDto,
} from '~/shared/index';

/** Tone vocabulary of the shell components, so a panel never invents a colour. */
export type StatusTone = 'neutral' | 'accent' | 'warning' | 'danger' | 'info';
/** The subset `UiMeter` accepts: a bar has no informative tone. */
export type MeterTone = 'neutral' | 'accent' | 'warning' | 'danger';

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** Name of each machine type, in Spanish, as the interface says it. */
export const MACHINE_TYPE_LABELS: Readonly<Record<MachineType, string>> = {
  // Agricultural catalogue, GDD section 89.
  TRACTOR: 'Tractor',
  PLOW: 'Arado',
  CULTIVATOR: 'Cultivador',
  SEEDER: 'Sembradora',
  HARVESTER: 'Cosechadora',
  TRAILER: 'Remolque',
  // Forestry catalogue, GDD section 134.
  HARVESTER_FORESTRY: 'Cosechadora forestal',
  FORWARDER: 'Autocargador',
};

/** Self propelled machine or towed implement (GDD section 88). */
export const MACHINE_ROLE_LABELS: Readonly<Record<MachineRole, string>> = {
  POWERED: 'Automotriz',
  IMPLEMENT: 'Apero',
};

/**
 * Machine status (GDD section 95).
 *
 * `BROKEN` is reserved and the MVP never produces it, and it is named here anyway: a state
 * the interface cannot express is a state that will be shown as a raw identifier the day
 * something writes it.
 */
export const MACHINE_STATUS_LABELS: Readonly<Record<MachineStatus, string>> = {
  IDLE: 'Ociosa',
  WORKING: 'Trabajando',
  BROKEN: 'Averiada',
  IN_REPAIR: 'En reparacion',
};

export const MACHINE_STATUS_TONES: Readonly<Record<MachineStatus, StatusTone>> = {
  IDLE: 'neutral',
  WORKING: 'accent',
  BROKEN: 'danger',
  IN_REPAIR: 'warning',
};

/** Section of the GDD each machine comes from, printed next to its figures. */
export const MACHINE_TYPE_SECTIONS: Readonly<Record<MachineType, number>> = {
  TRACTOR: 89,
  PLOW: 89,
  CULTIVATOR: 89,
  SEEDER: 89,
  HARVESTER: 89,
  TRAILER: 89,
  HARVESTER_FORESTRY: 134,
  FORWARDER: 134,
};

export function labelOfMachineType(type: MachineType): string {
  return MACHINE_TYPE_LABELS[type];
}

export function labelOfMachineStatus(status: MachineStatus): string {
  return MACHINE_STATUS_LABELS[status];
}

export function toneOfMachineStatus(status: MachineStatus): StatusTone {
  return MACHINE_STATUS_TONES[status];
}

export function definitionOfMachineType(type: MachineType): MachineDefinition {
  return MACHINE_CATALOGUE[type];
}

/** Catalogue order, which is the order the shop shows and the tests iterate. */
export const MACHINE_TYPE_ORDER: readonly MachineType[] = Object.keys(
  MACHINE_CATALOGUE,
) as readonly MachineType[];

// ---------------------------------------------------------------------------
// Condition (GDD section 93)
// ---------------------------------------------------------------------------

/**
 * Tone of the condition bar.
 *
 * The two thresholds are catalogue constants and not literals: below
 * `MIN_CONDITION_TO_ASSIGN` the machine cannot take a task at all, which is a refusal and
 * therefore danger; below `CONDITION_WARNING_THRESHOLD` GDD section 93 asks for a warning.
 */
export function conditionTone(conditionBp: number): MeterTone {
  if (conditionBp < MIN_CONDITION_TO_ASSIGN) {
    return 'danger';
  }
  return conditionBp < CONDITION_WARNING_THRESHOLD ? 'warning' : 'neutral';
}

/** Why a machine cannot be given a task, or the empty string when it can. */
export function assignabilityNote(machine: MachineDto): string {
  if (machine.assignable) {
    return '';
  }
  return `Por debajo del ${MIN_CONDITION_TO_ASSIGN / 100} % no admite asignacion (§91).`;
}

// ---------------------------------------------------------------------------
// Garage places (GDD section 96)
// ---------------------------------------------------------------------------

export interface SlotReading {
  readonly used: number;
  readonly total: number;
  readonly free: number;
}

/**
 * Garage occupancy counted over the machines rather than read off the counter of the
 * building.
 *
 * The counter on the building is the authority, and it is the one the `CHECK` of ADR-0018
 * defends; the trouble is how it reaches the client. Neither `POST /api/machines` nor the
 * sale carries the building in the result of the mutation, only in the `BUILDING_UPSERTED`
 * frame (`shared/api/routes.ts`), so a client whose socket is not live keeps a full garage
 * after selling and would refuse the purchase the server would accept. The machine, on the
 * other hand, travels in the reply and carries `garageId`, which is exactly the fact the
 * trigger counts.
 *
 * So this counts the same thing from the datum that always arrives. The two agree by
 * construction; when they cannot, the machine rows are the fresher of the two, and a
 * disagreement resolves itself on the next frame or snapshot. The gap in the reducer is
 * noted for the integration window in `docs/handoff/NOTES-w5f.md`.
 */
export function garageOccupancy(
  garages: readonly { readonly id: string; readonly capacity: number }[],
  machinesOfFarm: readonly MachineDto[],
): SlotReading {
  const ids = new Set(garages.map((garage) => garage.id));
  const used = machinesOfFarm.filter(
    (machine) => machine.garageId !== null && ids.has(machine.garageId),
  ).length;
  const total = garages.reduce((sum, garage) => sum + garage.capacity, 0);
  const free = total - used;
  return { used, total, free: free > 0 ? free : 0 };
}

// ---------------------------------------------------------------------------
// Blocking codes (ADR-0032)
// ---------------------------------------------------------------------------

export interface PurchaseSituation {
  /** Free garage places of the farm, the hard block of GDD section 96. */
  readonly freeGarageSlots: number;
  /** Settled balance, which is what the server checks affordability against. */
  readonly settledBalance: Money;
  readonly price: Money;
}

/**
 * Why a purchase would be refused, in the order of `buyMachine`
 * (`backend/src/modules/machinery/service.ts`): the garage slot of GDD section 96 first,
 * because it is answered before anything is inserted and it is the block the panel exists
 * to explain, then the debt gate of plan section 6.6, then the funds.
 */
export function purchaseBlockingCode(situation: PurchaseSituation): ValidationCode | null {
  if (situation.freeGarageSlots <= 0) {
    return ValidationCode.GARAGE_CAPACITY_EXCEEDED;
  }
  if (Money.isNegative(situation.settledBalance)) {
    return ValidationCode.SPENDING_BLOCKED_IN_DEBT;
  }
  if (Money.compare(situation.settledBalance, situation.price) < 0) {
    return ValidationCode.INSUFFICIENT_FUNDS;
  }
  return null;
}

/**
 * Why a machine cannot be sold. `MACHINE_NOT_IDLE` covers the status and the reservation
 * column, which the server treats as the same fact seen twice.
 */
export function sellBlockingCode(machine: MachineDto): ValidationCode | null {
  if (machine.status !== MachineStatus.IDLE || machine.currentTaskId !== null) {
    return ValidationCode.MACHINE_NOT_IDLE;
  }
  return null;
}

export interface RepairSituation {
  readonly machine: MachineDto;
  /** Whether the farm has a workshop (GDD sections 29 and 93). */
  readonly hasWorkshop: boolean;
  readonly settledBalance: Money;
}

/**
 * Why a repair would be refused. The first three checks are `canRepairMachine` of
 * `shared/rules/machinery.ts` and not a copy of it, so the order the server documents
 * — no workshop answers first, whatever else is true of the machine — holds here too.
 */
export function repairBlockingCode(situation: RepairSituation): ValidationCode | null {
  const refusal = canRepairMachine(
    {
      type: situation.machine.type,
      conditionBp: bp(situation.machine.conditionBp),
      status: situation.machine.status,
    },
    situation.hasWorkshop,
  );
  if (refusal !== null) {
    return refusal;
  }
  const price = fromWireMoney(situation.machine.repairCost);
  if (Money.isNegative(situation.settledBalance)) {
    return ValidationCode.SPENDING_BLOCKED_IN_DEBT;
  }
  if (Money.compare(situation.settledBalance, price) < 0) {
    return ValidationCode.INSUFFICIENT_FUNDS;
  }
  return null;
}
