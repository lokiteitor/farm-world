// Clock, scheduling horizon and periodic intervals.
//
// Owner: workflow W2 (vocabulary).
//
// Two units appear here and must not be mixed: `...RealMs` values are wall clock
// milliseconds and belong to the queue and to the transport, while everything with
// simulation meaning is expressed in game time (plan section 6.1).

import { gameHours, gameHoursToGameMs, type GameMs } from '../domain/units.js';
import { NATURAL_FOREST, PINE } from './forestry.js';

/** Rational multiplier of the clock: game milliseconds per real millisecond. */
export interface GameRate {
  readonly rateNum: number;
  readonly rateDen: number;
}

/**
 * Default multiplier: 24 game hours per real hour (GDD section 51, which leaves
 * the value as server configuration, and plan section 2). One game hour is
 * therefore two and a half real minutes, and the 325 hour cycle of GDD section 118
 * takes about thirteen and a half real hours.
 *
 * It is expressed as a rational so that the conversion is invertible without
 * floating point error. `rateNum = 0` is a paused world.
 *
 * The smoke test of plan section 10 overrides it with `{ rateNum: 360000,
 * rateDen: 1 }`, which makes one game hour last ten real milliseconds.
 */
export const DEFAULT_GAME_RATE: GameRate = { rateNum: 24, rateDen: 1 };

/**
 * Game instant the clock of a new world is anchored at, which is 960 game hours and
 * not zero.
 *
 * The reason is forestry: a forest arrives already populated when it is first bought
 * (GDD sections 130 and 141), so a generated tree carries a `plantedAtGameMs` in the
 * past, and the oldest one the generator can draw is the start of `OLD_GROWTH` plus
 * the width of its age window. With the world anchored at zero that tree would need
 * a negative planting instant, which the domain forbids: a game instant never
 * precedes the epoch of the world (plan section 6.1), and the constructor `gameMs`
 * raises `RangeError`.
 *
 * Derived from the forestry catalogue and not invented, so that retuning the species
 * moves the anchor with it. Three consumers need the same value and that is why it
 * lives here and not in the seed: the seed of the world, the generator of a populated
 * forest and the property tests of the clock (docs/handoff/NOTES-w2d.md, item 8).
 */
export const INITIAL_ANCHOR_GAME_MS: GameMs = gameHoursToGameMs(
  gameHours(PINE.stageStartGameHours.OLD_GROWTH + NATURAL_FOREST.oldGrowthAgeSpanGameHours),
);

/**
 * Game hours in a game day. Used only to display the player's own day counter
 * (GDD section 61), which is why there is no season: seasons are outside the MVP
 * (GDD sections 82 and 86).
 */
export const GAME_HOURS_PER_GAME_DAY = 24;

/**
 * Real time window within which a due event gets an alarm clock in Redis (plan
 * section 6.4). Everything further out stays as a pending row in PostgreSQL, which
 * bounds the memory of Redis with tens of thousands of trees in the world and keeps
 * a re-anchoring to rescheduling a few dozen jobs.
 */
export const SCHEDULE_HORIZON_REAL_MS = 24 * 60 * 60 * 1000;

/**
 * Floor applied to the delay of a job. An event that is already due is enqueued
 * with this delay instead of zero, which keeps a handler that re-enqueues from
 * spinning. Invented value; the only requirement is that it be small compared to
 * the shortest domain interval.
 */
export const MIN_JOB_DELAY_REAL_MS = 50;

/**
 * Period of the reconciliation sweep, which enqueues everything already due, in
 * order (plan section 6.4). Losing the contents of Redis loses nothing, and that is
 * only true because of this job.
 */
export const RECONCILE_INTERVAL_REAL_MS = 60 * 1000;

/**
 * Period of the per player settlement sweep, which settles accruals, applies the
 * overdraft interest and triggers forced liquidation (plan section 6.6). It is
 * deliberately not the login that triggers liquidation, so that it never appears as
 * a retroactive punishment.
 */
export const SETTLE_SWEEP_INTERVAL_REAL_MS = 15 * 60 * 1000;

/** Lifetime of the cached return summary in Redis (plan section 6.7). */
export const WELCOME_BACK_CACHE_TTL_REAL_MS = 5 * 60 * 1000;

/** Heartbeat of the WebSocket connection (plan section 7). */
export const WS_HEARTBEAT_INTERVAL_REAL_MS = 20 * 1000;

/** Period of the `CLOCK` event the server pushes so the client can extrapolate. */
export const CLOCK_EVENT_INTERVAL_REAL_MS = 60 * 1000;

/**
 * Deviation above which the client stops interpolating and jumps to the server
 * time (plan section 7). Five game minutes: below that a jump would be more visible
 * than the drift itself.
 */
export const CLOCK_RESYNC_THRESHOLD_GAME_MS = 5n * 60n * 1000n;

/** Lifetime of the single use ticket that authenticates a WebSocket (plan section 7). */
export const WS_TICKET_TTL_REAL_MS = 30 * 1000;

/** Lifetime of an access token (stack section 6). */
export const ACCESS_TOKEN_TTL_REAL_MS = 15 * 60 * 1000;
