// Module `workers`: the payroll, the procedural hiring pool and the two transitions of GDD
// sections 100 to 112.
//
// Owner: workflow W5-B. Replaces the scaffolding workflow W3-A left with the definitive path
// and signature (plan section 11, rule 3): `src/app.ts` and the route registry were not
// touched, only the body of this module. Substituting a scaffold is changing
// `defineStubRoute(app, key)` for `defineRoute(app, key, handler)` inside the module, and
// that is all that was done.
//
// The shape of the module, and why it is split the way it is:
//
//   - `pool.ts` is pure. It is the procedural rule of GDD section 102 and nothing else:
//     skill uniform over 30 % to 90 %, salary on the fitted line of the three published
//     examples perturbed by noise and floored. Deterministic from the world seed, the player
//     and the listing instant, with no `Math.random` anywhere, so a pool can be asserted.
//   - `service.ts` is the internal API. It owns the payroll reads, the two write paths and
//     the four rules a later phase consumes: idleness (GDD sections 104 and 109), the farm a
//     worker belongs to through his home (GDD section 108), the reservation of a worker for a
//     task and its release, and the skill progression of GDD sections 103 and 105.
//   - `jobs.ts` is the handler of `WORKER_POOL_REFRESH`, registered for real by
//     `src/handlers.ts`, so `farm_world_scheduled_events_unhandled_total` no longer counts
//     this module.
//   - `routes.ts` is the HTTP surface, deliberately thin.
//
// Housing capacity is asked of `modules/farms/service.ts`, a module of an earlier phase, and
// never counted here. `machinery` and `economy` are siblings of this phase and are not
// imported (plan section 11, rule 4); what the task engine of workflow W6-A needs from this
// module is exported below.

export { registerWorkersRoutes } from './routes.js';

export { OWNED_EVENT_KIND, workerPoolRefreshHandler } from './jobs.js';

export {
  POOL_SKILL_BAND,
  askingSalary,
  candidateSkillBp,
  fittedSalary,
  generateCandidate,
  generatePool,
  hashText,
  poolGeneration,
  salaryNoiseFactor,
  type GeneratedCandidate,
  type PoolSeed,
} from './pool.js';

export {
  ACTIVE_WORKER_STATUSES,
  POOL_REFRESH_INTERVAL_GAME_MS,
  POOL_REF_TYPE,
  RESERVED_WORKER_STATUSES,
  accruedWages,
  applyTaskCompletion,
  buildPoolReply,
  buildWorkersReply,
  canOperateFarmMachinery,
  dismissWorker,
  ensurePool,
  findLiveWorker,
  hireCandidate,
  homeSlots,
  homeUpsertedFrames,
  loadFarmWorkers,
  loadListedCandidates,
  loadPlayerWorkers,
  nextPoolRefreshAt,
  payrollPerGameHour,
  poolCatchUp,
  poolUpsertedFrame,
  releaseWorkerFromTask,
  replacePool,
  requireIdleWorker,
  requireWorker,
  requireWorkerOfFarm,
  reserveWorkerForTask,
  schedulePoolRefresh,
  toCandidateDto,
  toCandidateRecord,
  toWorkerDto,
  toWorkerRecord,
  workerRemovedFrame,
  workerUpsertedFrame,
  type CandidateRecord,
  type HireInput,
  type HireOutcome,
  type PoolWriteOutcome,
  type WorkerRecord,
} from './service.js';
