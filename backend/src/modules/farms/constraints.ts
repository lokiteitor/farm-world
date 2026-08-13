// Translation of the database safety net into the codes of the contract.
//
// Owner: workflow W4-B. Module `farms`.
//
// ADR-0018 draws the line this file sits on: the declarative constraint is the safety net
// and never the mechanism of a business rule. Every predictable refusal is answered before
// the statement runs — a garage that is full, a silo that still holds grain — and this file
// exists for what is left, which is the genuine race between two transactions competing for
// the last slot of a building. In that case PostgreSQL is the one that decides, and what
// reaches the caller must still be a code the client can switch on rather than a 500.
//
// Why the constraint is recognised by its name in the message text and not by an error class
// of Prisma. The ESLint zones let a domain module import `lib`, `plugins` and `shared` and
// nothing else of `src`, so this module cannot reach the generated client and cannot compare
// against `PrismaClientKnownRequestError`. That restriction is right: `lib/tx.ts` already
// exposes the two outcomes that are domain answers, `isUniqueViolation` and
// `isMissingRecord`, and a check constraint is neither of them. Matching the name is
// therefore the available reading, and it is stable: the names are written by hand in the
// initial migration and the integration suite of workflow W3 already asserts on one of them.
//
// The translation is deliberately narrow. Anything this file does not recognise is rethrown
// untouched, so an unexpected constraint stays a 500 with its stack instead of being
// reported as a rule of the game that the player could have avoided.

import {
  ApiError,
  BuildingType,
  ValidationCode,
  capacityExceeded,
  type StorageResource,
} from '../../shared/index.js';

/** Constraint names of `backend/prisma/migrations/20260811205212_init/migration.sql`. */
export const FARM_CONSTRAINTS = {
  /** `machineCount <= capacityMachines` and `workerCount <= capacityWorkers` (GDD 96, 108). */
  BUILDING_CAPACITY: 'buildings_capacity_check',
  /** `stored + reserved <= capacity`, per resource and per farm (GDD 27, 83, 136). */
  FARM_STOCK: 'farms_stock_check',
  /** One use per cell, intra-row (GDD section 15). */
  CELL_USE_EXCLUSIVITY: 'world_cells_use_exclusivity_check',
} as const;

/** What the caller was doing, so the translation can name the right capacity. */
export interface ConstraintContext {
  readonly buildingType?: BuildingType;
  readonly resource?: StorageResource;
  readonly entityId?: string;
}

function mentions(error: unknown, constraint: string): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes(constraint);
}

/**
 * The contract error a refused write corresponds to, or null when the failure is not one of
 * the constraints this module is responsible for.
 */
export function translateFarmConstraint(
  error: unknown,
  context: ConstraintContext = {},
): ApiError | null {
  if (mentions(error, FARM_CONSTRAINTS.BUILDING_CAPACITY)) {
    // The occupancy figures are not available: the transaction is already aborted, so no
    // read can run inside it. The code and the identifier are what the panel needs anyway,
    // and the refusal that carries figures is the one raised before the statement.
    const code =
      context.buildingType === BuildingType.WORKER_HOME
        ? ValidationCode.HOME_CAPACITY_EXCEEDED
        : ValidationCode.GARAGE_CAPACITY_EXCEEDED;
    return capacityExceeded(code, 0, 0, context.entityId);
  }
  if (mentions(error, FARM_CONSTRAINTS.FARM_STOCK)) {
    // Reached only by removing storage capacity from under stock that is already there,
    // which is the demolition of a silo that still holds grain. The migration names this
    // case explicitly and says the interface reports it as BUILDING_NOT_EMPTY.
    return new ApiError(ValidationCode.BUILDING_NOT_EMPTY, {
      ...(context.entityId === undefined ? {} : { entityId: context.entityId }),
    });
  }
  if (mentions(error, FARM_CONSTRAINTS.CELL_USE_EXCLUSIVITY)) {
    return new ApiError(ValidationCode.BUILDING_FOOTPRINT_OVERLAPS, {
      ...(context.entityId === undefined ? {} : { entityId: context.entityId }),
    });
  }
  return null;
}

/**
 * Runs a write and rethrows a recognised constraint violation as the error of the contract.
 *
 * A thin wrapper rather than a try block at each call site, so that the two write paths of
 * this module cannot disagree about which constraints they translate.
 */
export async function withConstraintTranslation<T>(
  body: () => Promise<T>,
  context: ConstraintContext = {},
): Promise<T> {
  try {
    return await body();
  } catch (error) {
    const translated = translateFarmConstraint(error, context);
    if (translated === null) {
      throw error;
    }
    throw translated;
  }
}
