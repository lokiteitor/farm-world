// Wire primitives of the REST contract.
//
// Owner: workflow W2 (API contract). Imported by every other schema file, by
// shared/ws, by the Fastify registration, by the typed client of the frontend and
// by the simulated server.
//
// Four conventions run through the whole contract, all of them from plan sections
// 5.3, 6.1 and 7. They are implemented here once so that no area file can restate
// them differently:
//
//   - Money travels as a decimal string, never as a number. A JSON number is an
//     IEEE 754 double and would silently lose the fourth decimal place that
//     `numeric(20,4)` keeps.
//   - Game instants travel as the decimal digits of a `bigint`, never as a number.
//     Game time is a `bigint` in the domain and JSON has no integer type.
//   - Percentages travel as integers in basis points, which is also how they are
//     stored, so no rounding happens at the boundary.
//   - A mutating reply carries `seq`, so the client can feed it through the same
//     reducer that consumes the WebSocket frames and converge regardless of which
//     of the two arrives first.
//
// Branding at the boundary. The wire types are plain `string` and `number`: a
// branded `Money` or `GameMs` cannot be produced by a Zod schema without a
// transform, and a transform would make the request type and the reply type of the
// same field differ, which breaks the symmetry the simulated server relies on.
// Instead the boundary converts explicitly, with the helpers below and with the
// constructors of shared/domain, and the direction is visible at every call site.

import { z } from 'zod';
import { CELLS_PER_CHUNK, MAX_SELECTION_CELLS } from '../../config/world.js';
import { type JsonObject, type JsonValue } from '../../domain/entities.js';
import { Money } from '../../domain/money.js';
import { gameMs, realMs, type GameMs, type RealMs } from '../../domain/units.js';

// ---------------------------------------------------------------------------
// Transport limits
// ---------------------------------------------------------------------------
//
// These are limits of the transport and not balance numbers, which is why they
// live here and not in shared/config: they bound the size of a single request or
// reply so that a malicious or buggy client cannot ask the server to build an
// unbounded response.

/** Chunks a single batch request may ask for. Plan section 9.5 loads at most 32 per tick. */
export const MAX_CHUNKS_PER_REQUEST = 64;

/** Chunks a WebSocket connection may be subscribed to at once. */
export const MAX_CHUNK_SUBSCRIPTIONS = 512;

/** Event frames a single replay response may carry (plan section 7). */
export const MAX_EVENT_REPLAY = 500;

/** Ledger entries a single page may carry. */
export const MAX_LEDGER_PAGE = 200;
export const DEFAULT_LEDGER_PAGE = 50;

/** Rows a single listing page may carry, for tasks and trees. */
export const MAX_LIST_PAGE = 500;
export const DEFAULT_LIST_PAGE = 100;

/** Trees a single forest plot reply may carry. Matches the selection ceiling. */
export const MAX_TREES_PER_REPLY = MAX_SELECTION_CELLS;

/** Length of a player supplied name, for farms, fields and forest plots. */
export const MAX_NAME_LENGTH = 48;

/** Length of an identifier on the wire. A cuid or a uuid fits well inside. */
export const MAX_ID_LENGTH = 64;

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** Header that carries the idempotency key of a money moving request (plan section 6.3). */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/** Header the client sends with the contract version it was built against. */
export const CONTRACT_VERSION_HEADER = 'x-contract-version';

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * Accepted decimal amount: optional sign, up to 24 integer digits and up to four
 * decimals. Identical to the pattern the `Money` module accepts, so a value that
 * validates here is always parseable and a canonical amount always validates.
 */
export const MONEY_WIRE_PATTERN = /^[+-]?\d{1,24}(?:\.\d{1,4})?$/;

/**
 * An amount as a decimal string. The server always emits the canonical form with
 * exactly four decimal places; a request may send fewer.
 */
export const moneySchema = z
  .string()
  .regex(MONEY_WIRE_PATTERN, 'Importe decimal con hasta cuatro decimales.');

/** Canonical wire form of an amount. */
export function toWireMoney(value: Money): string {
  return Money.toString(value);
}

/** Parses an amount coming from the wire into the canonical domain form. */
export function fromWireMoney(text: string): Money {
  return Money.fromString(text);
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/**
 * A non negative integer with no leading zeroes and at most nineteen digits, which
 * is the serialised form of a `bigint` instant. Nineteen digits cover the whole
 * range of a signed 64 bit integer, which is what PostgreSQL stores.
 */
export const BIGINT_WIRE_PATTERN = /^(?:0|[1-9]\d{0,18})$/;

/** A game instant, as the decimal digits of a `bigint` (plan section 6.1). */
export const gameMsSchema = z
  .string()
  .regex(BIGINT_WIRE_PATTERN, 'Instante de juego en milisegundos, como cadena de entero.');

/**
 * A duration in game milliseconds. Same form as an instant, and non negative for
 * the same reason: a duration in the domain is never negative, and an elapsed
 * interval that could be negative is not a duration.
 */
export const gameMsDurationSchema = z
  .string()
  .regex(BIGINT_WIRE_PATTERN, 'Duracion en milisegundos de juego, como cadena de entero.');

/** A wall clock instant, as the decimal digits of a `bigint`. Traces and scheduling only. */
export const realMsSchema = z
  .string()
  .regex(BIGINT_WIRE_PATTERN, 'Instante real en milisegundos, como cadena de entero.');

/** Wire form of a game instant. */
export function toWireGameMs(value: GameMs): string {
  return value.toString();
}

/** Parses a game instant coming from the wire. */
export function fromWireGameMs(text: string): GameMs {
  return gameMs(BigInt(text));
}

/** Wire form of a wall clock instant. */
export function toWireRealMs(value: RealMs): string {
  return value.toString();
}

/** Parses a wall clock instant coming from the wire. */
export function fromWireRealMs(text: string): RealMs {
  return realMs(BigInt(text));
}

/**
 * A duration or offset in game hours, as a number. Game hours are the unit of the
 * balance catalogues and of everything the interface shows, and a double holds
 * them exactly enough for display; a stored instant is never a number.
 */
export const gameHoursSchema = z.number().finite().nonnegative();

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** A percentage in basis points: integer 0..10 000 (plan section 5.2). */
export const bpSchema = z.number().int().min(0).max(10_000);

/** A monotonic per player sequence number (plan section 7). */
export const seqSchema = z.number().int().nonnegative();

/** A count of things. */
export const countSchema = z.number().int().nonnegative();

/** A positive count of things. */
export const positiveCountSchema = z.number().int().positive();

/**
 * A quantity of a fungible resource, in the stored unit of that resource: litres
 * for wheat and cubic decimetres for wood (`STORAGE_RESOURCE_UNITS`). Always an
 * integer, so that a lazy sum of thousands of rows does not depend on its order.
 */
export const storageUnitsSchema = z.number().int().nonnegative();

/** An absolute cell coordinate on the world grid. */
export const cellOrdinateSchema = z.number().int().safe();

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------
//
// Every identifier is the same shape on the wire; the distinct names exist so that
// the generated documentation and the client read correctly, and so that a later
// change of shape happens in one place per entity.

function idSchema(): z.ZodString {
  return z.string().min(1).max(MAX_ID_LENGTH);
}

export const worldIdSchema = idSchema();
export const playerIdSchema = idSchema();
export const farmIdSchema = idSchema();
export const buildingIdSchema = idSchema();
export const fieldIdSchema = idSchema();
export const machineIdSchema = idSchema();
export const workerIdSchema = idSchema();
export const workerCandidateIdSchema = idSchema();
export const taskIdSchema = idSchema();
export const forestPlotIdSchema = idSchema();
export const treeIdSchema = idSchema();
export const ledgerEntryIdSchema = idSchema();

/**
 * Client supplied key that makes a money moving request idempotent (plan section
 * 6.3). Long enough for a uuid, short enough to index.
 */
export const idempotencyKeySchema = z.string().min(8).max(128);

/** A player supplied name for a farm, a field or a forest plot. */
export const nameSchema = z.string().trim().min(1).max(MAX_NAME_LENGTH);

/** An opaque pagination cursor. Its content is a server detail. */
export const cursorSchema = z.string().min(1).max(256);

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** An absolute cell coordinate (GDD section 7). */
export const cellCoordSchema = z.strictObject({
  cellX: cellOrdinateSchema,
  cellY: cellOrdinateSchema,
});
export type CellCoordWire = z.infer<typeof cellCoordSchema>;

/** A chunk coordinate (GDD section 6). */
export const chunkCoordSchema = z.strictObject({
  chunkX: cellOrdinateSchema,
  chunkY: cellOrdinateSchema,
});
export type ChunkCoordWire = z.infer<typeof chunkCoordSchema>;

/** Index of a cell inside its chunk, row major. */
export const cellIndexSchema = z
  .number()
  .int()
  .min(0)
  .max(CELLS_PER_CHUNK - 1);

/**
 * A selection of cells, capped at `MAX_SELECTION_CELLS` (plan section 2, resolution
 * of GDD sections 17 and 19). The client applies the same ceiling while dragging,
 * with the same constant, so the highlight and the rejection cannot disagree.
 *
 * The selection travels as the explicit set of cells and not as a list of
 * rectangles: the client composes arbitrary shapes out of union, subtraction and
 * per cell toggling, so the rectangle is a tool of the interface and never the
 * unit the server validates. Duplicates are not rejected here; the server
 * deduplicates, because it must be able to do so anyway for a request that arrives
 * twice.
 */
export const cellSelectionSchema = z.strictObject({
  cells: z.array(cellCoordSchema).min(1).max(MAX_SELECTION_CELLS),
});
export type CellSelectionWire = z.infer<typeof cellSelectionSchema>;

// ---------------------------------------------------------------------------
// Free form JSON
// ---------------------------------------------------------------------------

/**
 * Any JSON value. Used only where the payload is genuinely open: the `meta` of a
 * ledger entry and the `details` of an error. Nothing in the domain travels this
 * way.
 */
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema);

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

/**
 * Reading of the game clock, with the anchor that lets the client extrapolate
 * without asking again (plan section 7). The multiplier is rational so that the
 * client reproduces exactly the same conversion as the server; `rateNum = 0` is a
 * paused world.
 */
export const clockDtoSchema = z.strictObject({
  gameMs: gameMsSchema,
  realMs: realMsSchema,
  anchorGameMs: gameMsSchema,
  anchorRealMs: realMsSchema,
  rateNum: z.number().int().nonnegative(),
  rateDen: z.number().int().positive(),
  scheduleEpoch: z.number().int().nonnegative(),
});
export type ClockDto = z.infer<typeof clockDtoSchema>;

// ---------------------------------------------------------------------------
// Replies
// ---------------------------------------------------------------------------

/** Reply of an endpoint that only acknowledges. */
export const okReplySchema = z.strictObject({ ok: z.literal(true) });
export type OkReply = z.infer<typeof okReplySchema>;

/**
 * Registry of the reply schemas built by `mutationReplySchema`. It exists so that
 * the contract test can assert, structurally and not by convention, that every
 * route the map declares as mutating replies with a sequence carrying envelope.
 */
const MUTATION_REPLY_SCHEMAS = new WeakSet<object>();

/**
 * Wraps the result of a mutation in the envelope every mutating reply shares
 * (plan section 7).
 *
 * `seq` is the value of the player's event sequence once the mutation is
 * committed, that is the sequence of the last event it produced. The client
 * applies the reply if `seq` is above the last sequence it applied and discards it
 * otherwise, which is the same rule it applies to a WebSocket frame; because every
 * entity in `result` is a full replacement and not a delta, applying the reply and
 * later discarding the echo converges to the same state as the opposite order.
 *
 * `result` carries the new state of every entity the mutation touched, so that the
 * reducer needs no per endpoint knowledge beyond which slice each field belongs to.
 */
export function mutationReplySchema<TResult extends z.ZodType>(result: TResult) {
  const schema = z.strictObject({
    seq: seqSchema,
    atGameMs: gameMsSchema,
    result,
  });
  MUTATION_REPLY_SCHEMAS.add(schema);
  return schema;
}

/** Whether a schema was produced by `mutationReplySchema`. */
export function isMutationReplySchema(schema: unknown): boolean {
  return typeof schema === 'object' && schema !== null && MUTATION_REPLY_SCHEMAS.has(schema);
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------
//
// Query string values always arrive as strings, so they are coerced. Bodies are
// JSON and are never coerced: a body that sends a number as a string is a bug in
// the client and must be reported as one.

/** A page size in a query string, coerced from its textual form. */
export function limitQuerySchema(maximum: number, fallback: number): z.ZodType<number, unknown> {
  return z.coerce.number().int().min(1).max(maximum).default(fallback);
}

/** A sequence number in a query string, coerced from its textual form. */
export const seqQuerySchema = z.coerce.number().int().nonnegative();

/** A boolean in a query string. Only the two literal spellings are accepted. */
export const booleanQuerySchema = z.enum(['true', 'false']).transform((value) => value === 'true');
