// Typed errors of the API and their correspondence with HTTP status codes.
//
// Owner: workflow W2 (API contract).
//
// Every error of the API, whatever its origin, has the same body:
//
//     { code, message, details? }
//
// `code` is a member of a closed set, `message` is the Spanish text of the message
// table, and `details` carries the concrete figures. A code names a rule and never
// a field: the offending field, cell or identifier travels in `details`, so the
// client composes an actionable message without parsing text, and the reason a
// selection is highlighted in red and the reason the server returns an error cannot
// diverge (plan section 8).
//
// Two families of code.
//
//   - `ValidationCode`, from shared/domain: the rules of the domain. It is the set
//     the shared rules of shared/rules produce, and the one the client switches on
//     when it validates a selection locally.
//   - `ApiTransportCode`, declared here: the six failures that are properties of
//     the service and not of the player, which are the idempotency header, the rate
//     limit, the development flag, a declared stub, a dependency that is down and
//     anything unforeseen. No shared rule can produce one and the client never
//     predicts one.
//
// The authentication codes started in this module, because `ValidationCode` had no
// member for "the token is missing" or "the credentials are wrong" and shared/domain
// was outside the scope of the contract agent (docs/handoff/NOTES-W2c.md, item 1.2).
// The W2.5 patching window unified them: `AUTH_REQUIRED`,
// `AUTH_INVALID_CREDENTIALS`, `AUTH_TOKEN_EXPIRED`, `AUTH_TICKET_INVALID` and
// `EMAIL_ALREADY_REGISTERED` now live in `ValidationCode`. This module kept its
// shape, exactly as that note predicted, and no consumer changed, because they all
// read `ApiErrorCode`, `API_ERROR_MESSAGES` and `API_ERROR_HTTP_STATUS`.

import { z } from 'zod';
import { MAX_SELECTION_CELLS } from '../config/world.js';
import { VALIDATION_MESSAGES, ValidationCode } from '../domain/enums.js';
import { cellCoordSchema, IDEMPOTENCY_KEY_HEADER } from './schemas/common.js';

// ---------------------------------------------------------------------------
// Transport codes
// ---------------------------------------------------------------------------

/**
 * Failures that are not rules of the domain. No shared rule produces one, and the
 * client never predicts one: it reacts to it.
 *
 * Authentication is not here: those five codes belong to `ValidationCode` since the
 * W2.5 patching window, see the header of this module.
 */
export const ApiTransportCode = {
  /** The idempotency key header is required by this route and was not sent. */
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  /** The rate limit of the route was exceeded. */
  RATE_LIMITED: 'RATE_LIMITED',
  /** The route exists but is only enabled behind the development flag. */
  DEV_ENDPOINT_DISABLED: 'DEV_ENDPOINT_DISABLED',
  /** The route exists in the contract and is still a stub. */
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  /** A dependency of the service is unavailable. */
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  /** Anything the server did not foresee. Never carries internal detail. */
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type ApiTransportCode = (typeof ApiTransportCode)[keyof typeof ApiTransportCode];
export const API_TRANSPORT_CODES: readonly ApiTransportCode[] = Object.values(ApiTransportCode);

/** Message table of the transport codes, in Spanish and in impersonal voice. */
export const API_TRANSPORT_MESSAGES: Readonly<Record<ApiTransportCode, string>> = {
  IDEMPOTENCY_KEY_REQUIRED: 'La operacion exige la cabecera Idempotency-Key.',
  RATE_LIMITED: 'Se ha superado el limite de peticiones admitido.',
  DEV_ENDPOINT_DISABLED: 'El endpoint solo esta disponible con la bandera de desarrollo activa.',
  NOT_IMPLEMENTED: 'La operacion todavia no esta implementada.',
  SERVICE_UNAVAILABLE: 'El servicio no esta disponible en este momento.',
  INTERNAL_ERROR: 'Se ha producido un error interno.',
};

// ---------------------------------------------------------------------------
// The code of an error
// ---------------------------------------------------------------------------

export type ApiErrorCode = ValidationCode | ApiTransportCode;

/** Every code the API can return, domain rules first. */
export const API_ERROR_CODES: readonly ApiErrorCode[] = [
  ...(Object.values(ValidationCode) as ValidationCode[]),
  ...API_TRANSPORT_CODES,
];

/** The two message tables as one lookup. */
export const API_ERROR_MESSAGES: Readonly<Record<ApiErrorCode, string>> = {
  ...VALIDATION_MESSAGES,
  ...API_TRANSPORT_MESSAGES,
};

/** The message of a code. Never interpolated: the figures travel in `details`. */
export function apiErrorMessage(code: ApiErrorCode): string {
  return API_ERROR_MESSAGES[code];
}

// ---------------------------------------------------------------------------
// The body of an error
// ---------------------------------------------------------------------------

export const apiErrorCodeSchema = z.enum({ ...ValidationCode, ...ApiTransportCode });

/**
 * Well known keys of `details`. The object is deliberately open: a rule may add a
 * figure without a contract change, and the client renders what it knows and
 * ignores the rest. The keys listed here are the ones the panels of plan section
 * 9.6 read, so they are typed rather than guessed.
 *
 * Money valued keys are decimal strings and quantity valued keys are integers in
 * the stored unit of the resource, exactly as everywhere else in the contract.
 */
export const apiErrorDetailsSchema = z.looseObject({
  /** Name of the offending field of the request, in dotted form. */
  field: z.string().optional(),
  /** Identifier and kind of the offending entity. */
  entityId: z.string().optional(),
  entityKind: z.string().optional(),
  /** Cells that caused the rejection. Bounded so an error cannot be larger than the request. */
  cells: z.array(cellCoordSchema).max(MAX_SELECTION_CELLS).optional(),
  /** Size of the offending selection and the ceiling it exceeded. */
  cellCount: z.number().int().optional(),
  limit: z.number().int().optional(),
  /** Amounts, as decimal strings. */
  requiredMoney: z.string().optional(),
  availableMoney: z.string().optional(),
  /** Quantities, in the stored unit of the resource. */
  requiredUnits: z.number().int().optional(),
  availableUnits: z.number().int().optional(),
  /** Occupancy of a building that rejected the operation. */
  occupancy: z.number().int().optional(),
  capacity: z.number().int().optional(),
  /** State machine context, for a rejected field operation. */
  operation: z.string().optional(),
  fromState: z.string().optional(),
  allowedStates: z.array(z.string()).optional(),
  /** Machinery context, for a rejected assignment. */
  machineType: z.string().optional(),
  requiredMachineType: z.string().optional(),
  /** Condition and the minimum the rule demands, in basis points. */
  conditionBp: z.number().int().optional(),
  minimumConditionBp: z.number().int().optional(),
  /** Contract versions, for a mismatch. */
  expected: z.string().optional(),
  actual: z.string().optional(),
});
export type ApiErrorDetails = z.infer<typeof apiErrorDetailsSchema>;

/** The one shape every error of the API takes. */
export const apiErrorSchema = z.strictObject({
  code: apiErrorCodeSchema,
  message: z.string().min(1),
  details: apiErrorDetailsSchema.optional(),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

/**
 * Reply body of any failing request. The wrapper exists so that a success body and
 * a failure body are never the same shape at the same status: a client that forgets
 * to check the status still cannot read an error as a result.
 */
export const apiErrorReplySchema = z.strictObject({ error: apiErrorSchema });
export type ApiErrorReply = z.infer<typeof apiErrorReplySchema>;

/** Whether an unknown value is an error reply of this API. */
export function isApiErrorReply(value: unknown): value is ApiErrorReply {
  return apiErrorReplySchema.safeParse(value).success;
}

// ---------------------------------------------------------------------------
// Status codes
// ---------------------------------------------------------------------------
//
// Assignment rule, applied uniformly so that a route needs no table of its own:
//
//   400 the request cannot be read or is internally inconsistent, independently of
//       the state of the world: a malformed body, an empty or oversized selection,
//       a non contiguous set of cells, a crop that is not in the catalogue.
//   401 the request carries no valid session.
//   402 the request is well formed and legal but the player cannot pay for it. It
//       is the one status that names the reason precisely, and the debt policy of
//       plan section 6.6 makes the distinction load bearing.
//   403 the resource exists and belongs to somebody else, or the route is disabled.
//   404 the resource does not exist.
//   409 the request is well formed but the current state of the world forbids it:
//       capacity, reservation, cycle state, ownership of a cell. This is the bulk
//       of the domain rules, and it is what the negative assertions of the smoke
//       test of plan section 10 expect.
//   429 the rate limit was exceeded.
//   500 unforeseen. 501 declared and not implemented. 503 a dependency is down.
//
// A client never branches on the status: it branches on `code`. The status exists
// so that proxies, logs and metrics classify correctly.

export const API_ERROR_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  SERVICE_UNAVAILABLE: 503,
} as const;
export type ApiErrorStatus = (typeof API_ERROR_STATUS)[keyof typeof API_ERROR_STATUS];

/** Status of every code. Exhaustive by construction: the record is keyed by the union. */
export const API_ERROR_HTTP_STATUS: Readonly<Record<ApiErrorCode, ApiErrorStatus>> = {
  // --- Generic ------------------------------------------------------------
  VALIDATION_FAILED: API_ERROR_STATUS.BAD_REQUEST,
  NOT_FOUND: API_ERROR_STATUS.NOT_FOUND,
  NOT_OWNED: API_ERROR_STATUS.FORBIDDEN,
  WORLD_PAUSED: API_ERROR_STATUS.CONFLICT,
  CONTRACT_VERSION_MISMATCH: API_ERROR_STATUS.CONFLICT,
  IDEMPOTENCY_KEY_REUSED: API_ERROR_STATUS.CONFLICT,

  // --- Authentication and session -----------------------------------------
  AUTH_REQUIRED: API_ERROR_STATUS.UNAUTHORIZED,
  AUTH_INVALID_CREDENTIALS: API_ERROR_STATUS.UNAUTHORIZED,
  AUTH_TOKEN_EXPIRED: API_ERROR_STATUS.UNAUTHORIZED,
  AUTH_TICKET_INVALID: API_ERROR_STATUS.UNAUTHORIZED,
  EMAIL_ALREADY_REGISTERED: API_ERROR_STATUS.CONFLICT,

  // --- Economy ------------------------------------------------------------
  INSUFFICIENT_FUNDS: API_ERROR_STATUS.PAYMENT_REQUIRED,
  SPENDING_BLOCKED_IN_DEBT: API_ERROR_STATUS.PAYMENT_REQUIRED,
  INSUFFICIENT_STOCK: API_ERROR_STATUS.CONFLICT,
  QUANTITY_NOT_POSITIVE: API_ERROR_STATUS.BAD_REQUEST,

  // --- Selection and land -------------------------------------------------
  SELECTION_EMPTY: API_ERROR_STATUS.BAD_REQUEST,
  SELECTION_TOO_LARGE: API_ERROR_STATUS.BAD_REQUEST,
  SELECTION_NOT_CONTIGUOUS: API_ERROR_STATUS.BAD_REQUEST,
  SELECTION_NOT_ADJACENT: API_ERROR_STATUS.BAD_REQUEST,
  TERRAIN_NOT_PURCHASABLE: API_ERROR_STATUS.CONFLICT,
  TERRAIN_NOT_ARABLE: API_ERROR_STATUS.CONFLICT,
  TERRAIN_NOT_BUILDABLE: API_ERROR_STATUS.CONFLICT,
  TERRAIN_NOT_FORESTABLE: API_ERROR_STATUS.CONFLICT,
  CELL_ALREADY_OWNED: API_ERROR_STATUS.CONFLICT,
  CELL_NOT_OWNED: API_ERROR_STATUS.CONFLICT,
  CELL_IN_USE: API_ERROR_STATUS.CONFLICT,
  CELL_HAS_STANDING_TREE: API_ERROR_STATUS.CONFLICT,
  CELL_ALREADY_HAS_TREE: API_ERROR_STATUS.CONFLICT,
  NATURAL_TREES_ALREADY_CONSUMED: API_ERROR_STATUS.CONFLICT,

  // --- Fields -------------------------------------------------------------
  FIELD_STATE_NOT_ALLOWED: API_ERROR_STATUS.CONFLICT,
  FIELD_HAS_ACTIVE_TASK: API_ERROR_STATUS.CONFLICT,
  FIELD_CROP_REQUIRED: API_ERROR_STATUS.BAD_REQUEST,
  FIELD_CROP_NOT_ALLOWED: API_ERROR_STATUS.BAD_REQUEST,
  FIELD_MERGE_INCOMPATIBLE: API_ERROR_STATUS.CONFLICT,
  FIELD_SPLIT_INCOMPLETE: API_ERROR_STATUS.BAD_REQUEST,
  CROP_UNKNOWN: API_ERROR_STATUS.BAD_REQUEST,

  // --- Farm and buildings -------------------------------------------------
  BUILDING_FOOTPRINT_OVERLAPS: API_ERROR_STATUS.CONFLICT,
  BUILDING_NOT_EMPTY: API_ERROR_STATUS.CONFLICT,
  GARAGE_CAPACITY_EXCEEDED: API_ERROR_STATUS.CONFLICT,
  HOME_CAPACITY_EXCEEDED: API_ERROR_STATUS.CONFLICT,
  SILO_CAPACITY_EXCEEDED: API_ERROR_STATUS.CONFLICT,
  WOOD_STORAGE_CAPACITY_EXCEEDED: API_ERROR_STATUS.CONFLICT,
  WORKSHOP_REQUIRED: API_ERROR_STATUS.CONFLICT,
  STORAGE_REQUIRED: API_ERROR_STATUS.CONFLICT,

  // --- Machinery ----------------------------------------------------------
  MACHINE_NOT_IDLE: API_ERROR_STATUS.CONFLICT,
  MACHINE_TYPE_NOT_COMPATIBLE: API_ERROR_STATUS.BAD_REQUEST,
  POWERED_MACHINE_REQUIRED: API_ERROR_STATUS.BAD_REQUEST,
  IMPLEMENT_REQUIRED: API_ERROR_STATUS.BAD_REQUEST,
  IMPLEMENT_NOT_ALLOWED: API_ERROR_STATUS.BAD_REQUEST,
  TRAILER_REQUIRED: API_ERROR_STATUS.CONFLICT,
  FORWARDER_REQUIRED: API_ERROR_STATUS.CONFLICT,
  MACHINE_CONDITION_TOO_LOW: API_ERROR_STATUS.CONFLICT,
  MACHINE_CONDITION_ALREADY_FULL: API_ERROR_STATUS.CONFLICT,
  MACHINE_NOT_REPAIRABLE: API_ERROR_STATUS.CONFLICT,
  MACHINE_WRONG_FARM: API_ERROR_STATUS.CONFLICT,

  // --- Workers ------------------------------------------------------------
  WORKER_NOT_IDLE: API_ERROR_STATUS.CONFLICT,
  WORKER_WRONG_FARM: API_ERROR_STATUS.CONFLICT,
  CANDIDATE_NOT_AVAILABLE: API_ERROR_STATUS.CONFLICT,

  // --- Tasks --------------------------------------------------------------
  TASK_NOT_CANCELABLE: API_ERROR_STATUS.CONFLICT,
  TASK_ALREADY_FINISHED: API_ERROR_STATUS.CONFLICT,
  OPERATION_NOT_SUPPORTED: API_ERROR_STATUS.BAD_REQUEST,
  TARGET_KIND_MISMATCH: API_ERROR_STATUS.BAD_REQUEST,

  // --- Forestry -----------------------------------------------------------
  NO_FELLABLE_TREES: API_ERROR_STATUS.CONFLICT,
  TREE_STAGE_NOT_FELLABLE: API_ERROR_STATUS.CONFLICT,

  // --- Transport ----------------------------------------------------------
  IDEMPOTENCY_KEY_REQUIRED: API_ERROR_STATUS.BAD_REQUEST,
  RATE_LIMITED: API_ERROR_STATUS.TOO_MANY_REQUESTS,
  DEV_ENDPOINT_DISABLED: API_ERROR_STATUS.FORBIDDEN,
  NOT_IMPLEMENTED: API_ERROR_STATUS.NOT_IMPLEMENTED,
  SERVICE_UNAVAILABLE: API_ERROR_STATUS.SERVICE_UNAVAILABLE,
  INTERNAL_ERROR: API_ERROR_STATUS.INTERNAL_SERVER_ERROR,
};

/** Status a code maps to. */
export function httpStatusForApiErrorCode(code: ApiErrorCode): ApiErrorStatus {
  return API_ERROR_HTTP_STATUS[code];
}

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

/** Builds the body of an error, taking the message from the table. */
export function apiErrorBody(code: ApiErrorCode, details?: ApiErrorDetails): ApiErrorBody {
  return details === undefined
    ? { code, message: apiErrorMessage(code) }
    : { code, message: apiErrorMessage(code), details };
}

/** Builds the reply body of an error. */
export function apiErrorReply(code: ApiErrorCode, details?: ApiErrorDetails): ApiErrorReply {
  return { error: apiErrorBody(code, details) };
}

/**
 * A failure of the API as an exception, so that a handler can abandon a
 * transaction from anywhere without threading a result type through every layer.
 * The status and the message derive from the code, so a throw site cannot pick a
 * status that contradicts the table.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: ApiErrorStatus;
  readonly details: ApiErrorDetails | undefined;

  constructor(code: ApiErrorCode, details?: ApiErrorDetails) {
    super(apiErrorMessage(code));
    this.name = 'ApiError';
    this.code = code;
    this.status = httpStatusForApiErrorCode(code);
    this.details = details;
  }

  /** The reply body of this error. */
  toReply(): ApiErrorReply {
    return this.details === undefined
      ? apiErrorReply(this.code)
      : apiErrorReply(this.code, this.details);
  }
}

/** Whether an unknown thrown value is an `ApiError`. */
export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

// The typed constructors below cover the cases that appear in more than one module.
// They exist so that the shape of `details` is decided once per rule instead of at
// every throw site, which is what keeps the client able to render the figures.

/** The resource does not exist, or exists and is not visible to this player. */
export function notFound(entityKind: string, entityId: string): ApiError {
  return new ApiError(ValidationCode.NOT_FOUND, { entityKind, entityId });
}

/** The resource exists and belongs to another player. */
export function notOwned(entityKind: string, entityId: string): ApiError {
  return new ApiError(ValidationCode.NOT_OWNED, { entityKind, entityId });
}

/** The settled balance does not cover the price. Both amounts are decimal strings. */
export function insufficientFunds(requiredMoney: string, availableMoney: string): ApiError {
  return new ApiError(ValidationCode.INSUFFICIENT_FUNDS, { requiredMoney, availableMoney });
}

/** Discretionary spending while the settled balance is negative (plan section 6.6). */
export function spendingBlockedInDebt(availableMoney: string): ApiError {
  return new ApiError(ValidationCode.SPENDING_BLOCKED_IN_DEBT, { availableMoney });
}

/** The stored stock does not cover the quantity. Units are the stored unit of the resource. */
export function insufficientStock(requiredUnits: number, availableUnits: number): ApiError {
  return new ApiError(ValidationCode.INSUFFICIENT_STOCK, { requiredUnits, availableUnits });
}

/** The selection exceeds the shared ceiling of cells. */
export function selectionTooLarge(cellCount: number, limit: number): ApiError {
  return new ApiError(ValidationCode.SELECTION_TOO_LARGE, { cellCount, limit });
}

/** The selected cells do not form one contiguous surface (GDD section 17). */
export function selectionNotContiguous(
  cells: readonly { readonly cellX: number; readonly cellY: number }[],
): ApiError {
  return new ApiError(ValidationCode.SELECTION_NOT_CONTIGUOUS, { cells: [...cells] });
}

/** A capacity counter rejected the operation (GDD sections 96, 108, 83). */
export function capacityExceeded(
  code:
    | typeof ValidationCode.GARAGE_CAPACITY_EXCEEDED
    | typeof ValidationCode.HOME_CAPACITY_EXCEEDED
    | typeof ValidationCode.SILO_CAPACITY_EXCEEDED
    | typeof ValidationCode.WOOD_STORAGE_CAPACITY_EXCEEDED,
  occupancy: number,
  capacity: number,
  entityId?: string,
): ApiError {
  return new ApiError(
    code,
    entityId === undefined ? { occupancy, capacity } : { occupancy, capacity, entityId },
  );
}

/** The crop cycle state of the field does not admit the operation (GDD sections 76, 104). */
export function fieldStateNotAllowed(
  operation: string,
  fromState: string,
  allowedStates: readonly string[],
): ApiError {
  return new ApiError(ValidationCode.FIELD_STATE_NOT_ALLOWED, {
    operation,
    fromState,
    allowedStates: [...allowedStates],
  });
}

/** The machine type is not compatible with the operation (GDD section 90). */
export function machineTypeNotCompatible(
  operation: string,
  machineType: string,
  requiredMachineType: string,
): ApiError {
  return new ApiError(ValidationCode.MACHINE_TYPE_NOT_COMPATIBLE, {
    operation,
    machineType,
    requiredMachineType,
  });
}

/** The condition of the machine is below the minimum to assign it (plan section 2.2). */
export function machineConditionTooLow(
  entityId: string,
  conditionBp: number,
  minimumConditionBp: number,
): ApiError {
  return new ApiError(ValidationCode.MACHINE_CONDITION_TOO_LOW, {
    entityId,
    conditionBp,
    minimumConditionBp,
  });
}

/** The request failed schema validation. `field` is the dotted path of the offender. */
export function validationFailed(field: string, details?: ApiErrorDetails): ApiError {
  return new ApiError(ValidationCode.VALIDATION_FAILED, { ...details, field });
}

/** The client was built against another version of the shared contract (plan section 7). */
export function contractVersionMismatch(expected: string, actual: string): ApiError {
  return new ApiError(ValidationCode.CONTRACT_VERSION_MISMATCH, { expected, actual });
}

/** The route requires the idempotency key header and it was not sent (plan section 6.3). */
export function idempotencyKeyRequired(): ApiError {
  return new ApiError(ApiTransportCode.IDEMPOTENCY_KEY_REQUIRED, {
    field: `headers.${IDEMPOTENCY_KEY_HEADER}`,
  });
}

/** No session, or a session that is no longer valid. */
export function authRequired(): ApiError {
  return new ApiError(ValidationCode.AUTH_REQUIRED);
}

/** The route is declared in the contract and still a stub (plan section 11, rule 3). */
export function notImplemented(route: string): ApiError {
  return new ApiError(ApiTransportCode.NOT_IMPLEMENTED, { field: route });
}
