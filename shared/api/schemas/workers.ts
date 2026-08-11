// Workers area: the payroll and the hiring pool.
//
// Owner: workflow W2 (API contract).
//
// Hiring and firing move no money. GDD section 102 asks that hiring validate money,
// but the catalogue defines no hiring fee and GDD section 109 defines no severance:
// what the check means is that the player can sustain the salary, and the salary is a
// continuous accrual and not a transaction. Both routes therefore carry no
// idempotency key. What protects hiring from a double submission is that the candidate
// leaves the pool, which is reported as `CANDIDATE_NOT_AVAILABLE`.

import { z } from 'zod';
import { WorkerStatus } from '../../domain/enums.js';
import {
  bpSchema,
  buildingIdSchema,
  countSchema,
  farmIdSchema,
  gameMsSchema,
  moneySchema,
  taskIdSchema,
  workerCandidateIdSchema,
  workerIdSchema,
} from './common.js';

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export const workerDtoSchema = z.strictObject({
  id: workerIdSchema,
  farmId: farmIdSchema,
  /** Worker home where the worker lives. A hard restriction (GDD section 108). */
  homeId: buildingIdSchema,
  name: z.string().min(1).max(64),
  skillBp: bpSchema,
  salaryPerGameHour: moneySchema,
  status: z.enum(WorkerStatus),
  currentTaskId: taskIdSchema.nullable(),
  completedTaskCount: countSchema,
  hiredGameMs: gameMsSchema,
  /** Derived: `skillFactor` of GDD section 103, with its floor of 0.5. */
  skillFactor: z.number().positive(),
});
export type WorkerDto = z.infer<typeof workerDtoSchema>;

export const workersReplySchema = z.strictObject({
  workers: z.array(workerDtoSchema),
  /** Sum of the salaries per game hour of the whole payroll (GDD section 107). */
  totalSalaryPerGameHour: moneySchema,
  homeSlotsUsed: countSchema,
  homeSlotsTotal: countSchema,
});
export type WorkersReply = z.infer<typeof workersReplySchema>;

export const workerParamsSchema = z.strictObject({ workerId: workerIdSchema });
export type WorkerParams = z.infer<typeof workerParamsSchema>;

/**
 * A candidate of the hiring pool (GDD section 102). The pool is per player, so no
 * candidate is ever contended between two players, which is the contention the MVP
 * avoids explicitly (plan section 5.2).
 */
export const workerCandidateDtoSchema = z.strictObject({
  id: workerCandidateIdSchema,
  name: z.string().min(1).max(64),
  skillBp: bpSchema,
  askingSalaryPerGameHour: moneySchema,
  listedAtGameMs: gameMsSchema,
  skillFactor: z.number().positive(),
});
export type WorkerCandidateDto = z.infer<typeof workerCandidateDtoSchema>;

export const workerPoolReplySchema = z.strictObject({
  candidates: z.array(workerCandidateDtoSchema),
  /** Instant the pool is refreshed next, so the panel can show a countdown. */
  nextRefreshAtGameMs: gameMsSchema.nullable(),
});
export type WorkerPoolReply = z.infer<typeof workerPoolReplySchema>;

// ---------------------------------------------------------------------------
// POST /api/workers/hire
// ---------------------------------------------------------------------------

/**
 * Housing is a hard restriction (GDD section 108) and it is checked per building, not
 * per farm: the counter and its constraint live on the home, which is stronger than
 * the aggregate of the GDD formula and is satisfied by construction because
 * `homeId` is mandatory. `homeId` may be omitted, in which case the server picks the
 * first home of the farm with room.
 */
export const hireWorkerBodySchema = z.strictObject({
  candidateId: workerCandidateIdSchema,
  farmId: farmIdSchema,
  homeId: buildingIdSchema.optional(),
});
export type HireWorkerBody = z.infer<typeof hireWorkerBodySchema>;

export const hireWorkerResultSchema = z.strictObject({
  worker: workerDtoSchema,
  /** The pool after the hire: the candidate is gone and the replacement is scheduled. */
  pool: workerPoolReplySchema,
  homeSlotsUsed: countSchema,
  homeSlotsTotal: countSchema,
});
export type HireWorkerResult = z.infer<typeof hireWorkerResultSchema>;

// ---------------------------------------------------------------------------
// POST /api/workers/:workerId/fire
// ---------------------------------------------------------------------------

/**
 * Only an idle worker can be dismissed (GDD section 109). The row survives with
 * `terminatedGameMs` set, because the wage accrual of any past interval must stay
 * recomputable and the ledger keeps pointing at it (plan section 5.3).
 */
export const fireWorkerResultSchema = z.strictObject({
  workerId: workerIdSchema,
  homeSlotsUsed: countSchema,
  homeSlotsTotal: countSchema,
  totalSalaryPerGameHour: moneySchema,
});
export type FireWorkerResult = z.infer<typeof fireWorkerResultSchema>;
