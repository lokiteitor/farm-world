// System area: health, metrics, documentation and the development routes.
//
// Owner: workflow W2 (API contract).
//
// Two of these routes do not return JSON. `/metrics` returns the text exposition
// format of Prometheus and `/docs` returns the HTML of the documentation viewer, so
// their reply schema is a string and the route map declares the content type. They are
// in the map anyway, and not left implicit, because the invariant the contract test
// checks is that every declared route has a reply schema: an exception would make the
// test unable to distinguish a route that returns text from one whose schema was
// forgotten.
//
// Neither `/health` nor `/metrics` is published through the reverse proxy: Prometheus
// scrapes the backend and the worker directly over the compose network
// (infra/caddy/Caddyfile). They are declared with root paths for that reason, outside
// the `/api` namespace.

import { z } from 'zod';
import { clockDtoSchema, gameMsSchema, moneySchema, playerIdSchema } from './common.js';

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------

export const HEALTH_STATUSES = ['ok', 'degraded', 'down'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const DEPENDENCY_STATUSES = ['up', 'down'] as const;
export type DependencyStatus = (typeof DEPENDENCY_STATUSES)[number];

/**
 * Health of the process and of its dependencies. `ok` means everything answers;
 * `degraded` means the process is serving but a dependency that is not on the critical
 * path is down, which is the case of Redis: losing it loses no correctness, because
 * `ScheduledEvent` in PostgreSQL is the authoritative list and the reconciliation sweep
 * re-enqueues everything due (plan section 6.4). `down` means PostgreSQL is unreachable,
 * which is not survivable.
 */
export const healthReplySchema = z.strictObject({
  status: z.enum(HEALTH_STATUSES),
  /** Which process answered, so a compose deployment can tell them apart. */
  role: z.enum(['server', 'worker']),
  version: z.string().min(1).max(64),
  contractVersion: z.string().min(1).max(64),
  uptimeRealMs: z.number().int().nonnegative(),
  checks: z.strictObject({
    postgres: z.enum(DEPENDENCY_STATUSES),
    redis: z.enum(DEPENDENCY_STATUSES),
    queue: z.enum(DEPENDENCY_STATUSES),
  }),
  /** Null when the world row has not been read yet, which is the case during boot. */
  clock: clockDtoSchema.nullable(),
});
export type HealthReply = z.infer<typeof healthReplySchema>;

// ---------------------------------------------------------------------------
// GET /metrics and GET /docs
// ---------------------------------------------------------------------------

/** The Prometheus text exposition format. Not JSON. */
export const metricsReplySchema = z.string();

/** The HTML of the documentation viewer. Not JSON. */
export const docsReplySchema = z.string();

// ---------------------------------------------------------------------------
// POST /api/dev/*
// ---------------------------------------------------------------------------
//
// Every route below is refused with `DEV_ENDPOINT_DISABLED` unless the development flag
// is on. They exist because two of the acceptance criteria of plan section 12 are not
// reachable otherwise: exercising a 325 hour cycle in seconds needs the multiplier to be
// settable, and exercising the debt policy needs a balance to be settable.

/**
 * Retiming the world is a domain operation and not a configuration change (plan section
 * 6.1): it freezes the past under the previous multiplier, re-anchors, increments the
 * schedule epoch, records the segment and reschedules the jobs of the horizon. The
 * multiplier is rational so the conversion stays invertible; `rateNum` zero pauses the
 * world, which is the one admissible mitigation for a prolonged outage.
 */
export const devRetimeBodySchema = z.strictObject({
  rateNum: z.number().int().nonnegative(),
  rateDen: z.number().int().positive(),
});
export type DevRetimeBody = z.infer<typeof devRetimeBodySchema>;

export const devRetimeResultSchema = z.strictObject({
  clock: clockDtoSchema,
  /** Jobs of the scheduling horizon that were rescheduled by the re-anchoring. */
  rescheduledJobs: z.number().int().nonnegative(),
});
export type DevRetimeResult = z.infer<typeof devRetimeResultSchema>;

/**
 * Advances the player to an instant, running every due event in order (plan section
 * 6.3). It does not move the clock of the world: it runs what the clock has already
 * passed, which is exactly what the first request of a returning player does.
 */
export const devAdvancePlayerBodySchema = z.strictObject({
  playerId: playerIdSchema.optional(),
  toGameMs: gameMsSchema,
});
export type DevAdvancePlayerBody = z.infer<typeof devAdvancePlayerBodySchema>;

export const devAdvancePlayerResultSchema = z.strictObject({
  processedEvents: z.number().int().nonnegative(),
  lastAccrualGameMs: gameMsSchema,
  balance: moneySchema,
});
export type DevAdvancePlayerResult = z.infer<typeof devAdvancePlayerResultSchema>;

/**
 * Credits or debits the player with one ledger entry of kind `COMPENSATION`, which is
 * the kind reserved for exactly this: an incident is compensated with an entry and never
 * by rewinding the clock (plan section 6.1). It moves money, so it carries an
 * idempotency key like every other route that does.
 */
export const devGrantBodySchema = z.strictObject({
  playerId: playerIdSchema.optional(),
  /** Signed amount, as a decimal string. Negative debits. */
  amount: moneySchema,
  reason: z.string().min(1).max(200),
});
export type DevGrantBody = z.infer<typeof devGrantBodySchema>;

export const devGrantResultSchema = z.strictObject({
  amount: moneySchema,
  balanceAfter: moneySchema,
});
export type DevGrantResult = z.infer<typeof devGrantResultSchema>;

/**
 * Runs the reconciliation sweep now: enqueues, in order, everything already due (plan
 * section 6.4). It is what makes "empty Redis and check that nothing was lost" an
 * executable test rather than a claim.
 */
export const devReconcileResultSchema = z.strictObject({
  enqueuedEvents: z.number().int().nonnegative(),
  pendingEvents: z.number().int().nonnegative(),
});
export type DevReconcileResult = z.infer<typeof devReconcileResultSchema>;
