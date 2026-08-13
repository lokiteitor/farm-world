// State area: the player, the full snapshot, the event replay and the return summary.
//
// Owner: workflow W2 (API contract).
//
// Three ways in, one rule. The client is a cache and never an authority (plan section
// 7), so it has exactly three ways to learn the state and they are ordered by cost:
// the WebSocket, which pushes each change; `GET /api/events?since`, which replays a
// bounded ring when a sequence gap appears; and `GET /api/state/snapshot`, which
// rebuilds everything when the ring no longer covers the gap. All three carry the same
// sequence, so the reducer treats them identically.
//
// The reply schema of the replay lives in shared/ws, not here: what it carries is a
// list of WebSocket frames, so defining it anywhere else would duplicate the event
// union. The query schema of the route does live here, because it belongs to this area.

import { z } from 'zod';
import { LedgerType, PlayerStatus } from '../../domain/enums.js';
import { apiErrorCodeSchema } from '../errors.js';
import {
  bpSchema,
  cellCoordSchema,
  countSchema,
  farmIdSchema,
  fieldIdSchema,
  forestPlotIdSchema,
  gameHoursSchema,
  gameMsSchema,
  jsonObjectSchema,
  limitQuerySchema,
  machineIdSchema,
  MAX_EVENT_REPLAY,
  moneySchema,
  playerIdSchema,
  seqQuerySchema,
  seqSchema,
  storageUnitsSchema,
  taskIdSchema,
  workerIdSchema,
} from './common.js';
import { inventoryFarmSchema } from './economy.js';
import { buildingDtoSchema, farmDtoSchema } from './farms.js';
import { fieldDtoSchema } from './fields.js';
import { forestPlotDtoSchema } from './forestry.js';
import { machineDtoSchema } from './machinery.js';
import { taskDtoSchema } from './tasks.js';
import { workerCandidateDtoSchema, workerDtoSchema } from './workers.js';
import { worldInfoReplySchema } from './world.js';

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

/**
 * The player as every reply carries it.
 *
 * Two balances travel and the difference matters. `balance` is the settled balance,
 * the one every affordability check uses inside its own transaction; `projectedBalance`
 * is that same balance carried forward to `atGameMs` by the continuous costs, and it is
 * what the top bar shows. A check against the projection would create money out of
 * nothing under concurrency, which is why the two are named and never merged (plan
 * section 6.2).
 *
 * `status` derives from the settled balance: `IN_DEBT` blocks discretionary spending and
 * never blocks selling or assigning a task, which are the only sources of income (plan
 * section 6.6).
 */
export const playerDtoSchema = z.strictObject({
  id: playerIdSchema,
  email: z.string().min(3).max(200),
  displayName: z.string().min(1).max(64),
  status: z.enum(PlayerStatus),
  balance: moneySchema,
  projectedBalance: moneySchema,
  /** Start of the player's own day counter (GDD section 61, plan section 2.2). */
  startedAtGameMs: gameMsSchema,
  /** Day number the interface shows, derived from `startedAtGameMs` and the clock. */
  dayNumber: z.number().int().positive(),
  lastAccrualGameMs: gameMsSchema,
  lastLoginGameMs: gameMsSchema,
  /** Distinct from the login mark: reloading must not erase a pending summary. */
  lastSummaryGameMs: gameMsSchema,
  ledgerSeq: seqSchema,
  /** The sequence the client checks for gaps (plan section 7). */
  eventSeq: seqSchema,
  /**
   * Sum of the continuous costs per game hour at this instant (GDD section 107):
   * wages, plus maintenance of every machine, plus the operating cost of the machines
   * that are working. It is what the top bar shows as the burn rate.
   */
  holdingCostPerGameHour: moneySchema,
  atGameMs: gameMsSchema,
});
export type PlayerDto = z.infer<typeof playerDtoSchema>;

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

/**
 * Kinds of notice. A notice is information the player must see and that is not the
 * change of an entity: a silo that overflowed while nobody was looking, a forced
 * liquidation, a forest that matured, a retiming of the world.
 *
 * The set is declared here and not in shared/domain because a notice is a message of
 * the transport and not a datum of the domain: nothing is stored with these values,
 * and a shared rule never produces one.
 */
export const NoticeKind = {
  /** Grain that did not fit in the silo was wasted (GDD sections 83 and 97). */
  HARVEST_OVERFLOW: 'HARVEST_OVERFLOW',
  /** Wood that did not fit in the store was wasted. */
  WOOD_OVERFLOW: 'WOOD_OVERFLOW',
  /** Assets were sold to cover the debt (plan section 6.6). */
  FORCED_LIQUIDATION: 'FORCED_LIQUIDATION',
  /** The settled balance turned negative, or stopped being negative. */
  DEBT_ENTERED: 'DEBT_ENTERED',
  DEBT_CLEARED: 'DEBT_CLEARED',
  /** Trees of a plot reached a stage worth reporting (GDD section 131). */
  FOREST_MILESTONE: 'FOREST_MILESTONE',
  /** A field advanced on its own while the player was away (GDD section 76). */
  FIELD_PHASE_ADVANCED: 'FIELD_PHASE_ADVANCED',
  /** A repair finished (plan section 2.2). */
  REPAIR_COMPLETED: 'REPAIR_COMPLETED',
  /** The multiplier of the world changed (plan section 6.1). */
  WORLD_RETIMED: 'WORLD_RETIMED',
  /** Anything else the server wants to say once. */
  GENERIC: 'GENERIC',
} as const;
export type NoticeKind = (typeof NoticeKind)[keyof typeof NoticeKind];
export const NOTICE_KINDS: readonly NoticeKind[] = Object.values(NoticeKind);

export const NOTICE_SEVERITIES = ['INFO', 'WARNING'] as const;
export type NoticeSeverity = (typeof NOTICE_SEVERITIES)[number];

/**
 * A notice. `code` is present only when the notice reports a rule that was not met, in
 * which case the message is the one of the shared table; otherwise the server supplies
 * the text. `details` follows the same convention as the details of an error: the
 * figures travel structured so the client composes them without parsing text.
 */
export const noticeDtoSchema = z.strictObject({
  kind: z.enum(NoticeKind),
  severity: z.enum(NOTICE_SEVERITIES),
  code: apiErrorCodeSchema.nullable(),
  message: z.string().min(1).max(500),
  details: jsonObjectSchema.nullable(),
  atGameMs: gameMsSchema,
  /** Entity the notice is about, so the interface can offer a jump to it. */
  subjectType: z.string().max(64).nullable(),
  subjectId: z.string().max(64).nullable(),
});
export type NoticeDto = z.infer<typeof noticeDtoSchema>;

// ---------------------------------------------------------------------------
// GET /api/state/snapshot
// ---------------------------------------------------------------------------

/**
 * Everything except the world grid. The chunks are not here on purpose: they are
 * streamed by coordinate and cached with the version in the key, so putting them in
 * the snapshot would download the whole holding to rebuild a state the renderer
 * already has (plan sections 5.1 and 9.5). What the snapshot does carry are the cells
 * of every field and plot, which is what the outline layer needs.
 *
 * `seq` is the sequence the snapshot is consistent at. The client sets its own mark to
 * it and discards every frame at or below it.
 */
export const snapshotReplySchema = z.strictObject({
  seq: seqSchema,
  atGameMs: gameMsSchema,
  world: worldInfoReplySchema,
  player: playerDtoSchema,
  farms: z.array(farmDtoSchema),
  buildings: z.array(buildingDtoSchema),
  fields: z.array(fieldDtoSchema),
  /** Cells of each field, so the outline layer needs no request per field. */
  fieldCells: z.array(z.strictObject({ fieldId: fieldIdSchema, cells: z.array(cellCoordSchema) })),
  machines: z.array(machineDtoSchema),
  workers: z.array(workerDtoSchema),
  laborPool: z.strictObject({
    candidates: z.array(workerCandidateDtoSchema),
    nextRefreshAtGameMs: gameMsSchema.nullable(),
  }),
  tasks: z.array(taskDtoSchema),
  forestPlots: z.array(forestPlotDtoSchema),
  forestPlotCells: z.array(
    z.strictObject({ forestPlotId: forestPlotIdSchema, cells: z.array(cellCoordSchema) }),
  ),
  inventory: z.array(inventoryFarmSchema),
  notices: z.array(noticeDtoSchema),
  /** Whether a return summary is waiting to be shown (plan section 6.7). */
  welcomeBackPending: z.boolean(),
});
export type SnapshotReply = z.infer<typeof snapshotReplySchema>;

// ---------------------------------------------------------------------------
// GET /api/events
// ---------------------------------------------------------------------------

/**
 * Replay of the event ring from a sequence the client already has. The reply schema is
 * `eventReplayReplySchema` in shared/ws, because what it carries is a list of
 * WebSocket frames.
 */
export const eventsQuerySchema = z.strictObject({
  /** Last sequence the client applied. The reply starts at `since + 1`. */
  since: seqQuerySchema,
  limit: limitQuerySchema(MAX_EVENT_REPLAY, MAX_EVENT_REPLAY),
});
export type EventsQuery = z.infer<typeof eventsQuerySchema>;

// ---------------------------------------------------------------------------
// GET /api/session/welcome-back
// ---------------------------------------------------------------------------

/**
 * The return summary of GDD section 68, with the exact analytical economics of GDD
 * section 124. Nothing here is stored: the ledger covers the economic block and the
 * timestamped domain columns cover the block of events (plan section 6.7).
 */
export const welcomeBackLedgerLineSchema = z.strictObject({
  type: z.enum(LedgerType),
  entryCount: countSchema,
  /** Signed sum of the entries of this kind: negative is an outflow. */
  total: moneySchema,
});
export type WelcomeBackLedgerLine = z.infer<typeof welcomeBackLedgerLineSchema>;

export const welcomeBackEconomySchema = z.strictObject({
  balanceBefore: moneySchema,
  balanceAfter: moneySchema,
  /** The four aggregates GDD section 124 names, each already signed. */
  totalRevenue: moneySchema,
  totalSalaries: moneySchema,
  totalMaintenance: moneySchema,
  totalOperating: moneySchema,
  /** Everything else: acquisitions, repairs, interest, liquidations. */
  totalOther: moneySchema,
  netChange: moneySchema,
  byType: z.array(welcomeBackLedgerLineSchema),
});
export type WelcomeBackEconomy = z.infer<typeof welcomeBackEconomySchema>;

export const welcomeBackTaskSchema = z.strictObject({
  taskId: taskIdSchema,
  operation: z.string().min(1).max(32),
  status: z.string().min(1).max(32),
  targetName: z.string().max(64).nullable(),
  endedGameMs: gameMsSchema,
  /** What it produced, in the stored unit of its resource, or null. */
  producedUnits: storageUnitsSchema.nullable(),
});
export type WelcomeBackTask = z.infer<typeof welcomeBackTaskSchema>;

export const welcomeBackFieldSchema = z.strictObject({
  fieldId: fieldIdSchema,
  name: z.string().min(1).max(64),
  fromState: z.string().min(1).max(32),
  toState: z.string().min(1).max(32),
  atGameMs: gameMsSchema,
});
export type WelcomeBackField = z.infer<typeof welcomeBackFieldSchema>;

export const welcomeBackStorageSchema = z.strictObject({
  farmId: farmIdSchema,
  resource: z.string().min(1).max(32),
  storedUnits: storageUnitsSchema,
  capacityUnits: storageUnitsSchema,
  occupancyBp: bpSchema,
});
export type WelcomeBackStorage = z.infer<typeof welcomeBackStorageSchema>;

export const welcomeBackTreesSchema = z.strictObject({
  forestPlotId: forestPlotIdSchema,
  stage: z.string().min(1).max(32),
  count: countSchema,
});
export type WelcomeBackTrees = z.infer<typeof welcomeBackTreesSchema>;

export const welcomeBackLiquidationSchema = z.strictObject({
  step: z.string().min(1).max(32),
  subjectType: z.string().max(64).nullable(),
  subjectId: z.string().max(64).nullable(),
  /**
   * The machine type, the resource or the name of the worker, which the liquidation engine
   * already writes into `meta.assets[].detail` of the aggregate entry.
   *
   * ADR-0039 rules out the single aggregate entry precisely because it "loses what was sold",
   * and without this field the summary lost it again at the last step: an asset sold during the
   * absence and already gone from the client read as "Machine <identifier>" and not as
   * "Cosechadora" (docs/handoff/NOTES-w6t.md 1.1).
   */
  detail: z.string().max(64).nullable(),
  amount: moneySchema,
});
export type WelcomeBackLiquidation = z.infer<typeof welcomeBackLiquidationSchema>;

export const welcomeBackReplySchema = z.strictObject({
  fromGameMs: gameMsSchema,
  toGameMs: gameMsSchema,
  elapsedGameHours: gameHoursSchema,
  /** False when nothing happened, so the interface can skip the modal entirely. */
  hasContent: z.boolean(),
  economy: welcomeBackEconomySchema,
  tasksClosed: z.array(welcomeBackTaskSchema),
  fieldTransitions: z.array(welcomeBackFieldSchema),
  idleWorkers: z.array(z.strictObject({ workerId: workerIdSchema, name: z.string().max(64) })),
  repairsCompleted: z.array(
    z.strictObject({ machineId: machineIdSchema, conditionBp: bpSchema, atGameMs: gameMsSchema }),
  ),
  storage: z.array(welcomeBackStorageSchema),
  treeStageChanges: z.array(welcomeBackTreesSchema),
  /** Production lost for want of capacity (GDD sections 83 and 97). */
  wasted: z.array(
    z.strictObject({
      resource: z.string().max(32),
      units: storageUnitsSchema,
      farmId: farmIdSchema,
    }),
  ),
  liquidations: z.array(welcomeBackLiquidationSchema),
  notices: z.array(noticeDtoSchema),
});
export type WelcomeBackReply = z.infer<typeof welcomeBackReplySchema>;

// ---------------------------------------------------------------------------
// POST /api/session/welcome-back/ack
// ---------------------------------------------------------------------------

/**
 * Acknowledging the summary moves the summary mark forward, which is what makes the
 * next summary start where this one ended. The instant is explicit and not implicit in
 * "now" so that a summary read and acknowledged minutes later does not silently discard
 * what happened in between.
 */
export const welcomeBackAckBodySchema = z.strictObject({
  throughGameMs: gameMsSchema,
});
export type WelcomeBackAckBody = z.infer<typeof welcomeBackAckBodySchema>;

export const welcomeBackAckResultSchema = z.strictObject({
  lastSummaryGameMs: gameMsSchema,
});
export type WelcomeBackAckResult = z.infer<typeof welcomeBackAckResultSchema>;
