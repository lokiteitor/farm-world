// Module `session`: the snapshot, the event replay and the return summary.
//
// Owner: workflow W6-B. Replaces the scaffolding workflow W3-A left with the definitive path
// and signature (plan section 11, rule 3): `src/app.ts` and the route registry were not
// touched, only the body of this module. `defineStubRoute` became `defineRoute`, in place.
//
// The shape of the module:
//
//   `snapshot.ts`    the complete state of a player at one sequence (GDD section 52).
//   `replay.ts`      the bounded replay of the event ring (plan section 7).
//   `welcomeBack.ts` the return summary of GDD section 68 with the economics of GDD 124.
//   `cache.ts`       the short lived cache of that summary (plan section 6.7).
//   `readModel.ts`   the task and the plot as the snapshot carries them.
//   `routes.ts`      the HTTP surface, which converts and decides nothing.
//
// What this module is responsible for, stated once so the boundary is not guessed:
//
//   - It owns the three ways a client learns state that the WebSocket did not deliver, and
//     nothing else. It writes exactly one column, `Player.lastSummaryGameMs`, and only through
//     the acknowledgement.
//   - It is a reader of every other module. Every entity it reports comes from the builder its
//     owning module publishes, which is what keeps a snapshot and a listing route from
//     disagreeing about the same row (ADR-0006).
//   - It stores nothing for the summary. The ledger covers the economic block and the
//     timestamped domain columns cover the block of events, so no module has to remember to
//     append to a summary table as things happen (plan section 6.7).
//
// The two entities of the snapshot whose modules are siblings of this phase — `tasks` (W6-A)
// and `forestry` (W6-C) — are projected in `readModel.ts` of this module, because rule 4 of
// plan section 11 forbids the import and a snapshot missing them would silently drop every
// task in flight of a client that had just lost its place. The duplication is bounded to the
// projection and every derived figure goes through the same shared rule the sibling calls.

import { type FastifyInstance } from 'fastify';
import { registerSessionRoutes as registerRoutes } from './routes.js';

/** Registers the routes of the area. Invoked once by `src/app.ts`. */
export function registerSessionRoutes(app: FastifyInstance): void {
  registerRoutes(app);
}

export {
  WELCOME_BACK_CACHE_TTL_REAL_MS,
  clearCachedWelcomeBack,
  readCachedWelcomeBack,
  writeCachedWelcomeBack,
} from './cache.js';

export { buildReplay, type ReplayInput } from './replay.js';

export {
  MAX_SNAPSHOT_NOTICES,
  buildSnapshot,
  buildWorldInfo,
  loadRecentNotices,
} from './snapshot.js';

export {
  loadActiveTaskDtos,
  loadForestPlotDtos,
  forestPlotCells,
  taskProgressBp,
  toForestPlotDto,
  toTaskDto,
  type ForestPlotRow,
  type StandingTreeRow,
  type TaskRow,
} from './readModel.js';

export {
  MIN_PENDING_ELAPSED_GAME_MS,
  REVENUE_LEDGER_TYPES,
  buildEconomy,
  buildWelcomeBack,
  fieldTransitionsIn,
  liquidationsOf,
  storageOf,
  summaryWindow,
  treeStageChangesIn,
  wastedOf,
  welcomeBackPending,
  type SummaryWindow,
} from './welcomeBack.js';
