// The handlers of the simulated server: one per route of the contract.
//
// Owner: W3-C.
//
// The table is keyed by `ApiRouteKey`, so a route added to `API_ROUTES` without a handler
// here is a compile error and not a 404 a panel discovers at run time. That is the whole
// reason it is a record rather than a switch.
//
// How much behaviour each handler has is a deliberate gradient. The routes a panel of W4 to
// W6 has to see behave are simulated for real: buying land claims the purchasable cells and
// charges only those, buying a machine refuses when the garage is full, assigning a task
// reserves the worker and the machinery, selling moves the stock and the balance, and every
// one of them emits the frames the contract declares before it answers. The remaining ones
// answer a coherent reply and change what the reply says they changed, without simulating
// the parts no panel reads. The handoff lists which is which.
//
// Two invariants hold everywhere, because they are what the client is being tested against:
// a mutating route emits its frames first and answers with the sequence of the last one, and
// no reply is built by hand from a literal where a shared rule can produce it.

import { matchRoute, splitUrl } from '~/mock/router';
import { type MockServer } from '~/mock/server';
import {
  MOCK_CONTRACT_VERSION,
  MOCK_FARM_ID,
  MOCK_GENERATOR_VERSION,
  MOCK_PLAYER_ID,
  MOCK_WOOD_PRICE_PER_DM3,
  MOCK_WORLD_ID,
  mockChunkCells,
  mockChunkVersion,
  mockClock,
  mockMarketPrices,
  type MockWorld,
} from '~/mock/world';
import {
  ACCESS_TOKEN_TTL_REAL_MS,
  API_ERROR_HTTP_STATUS,
  ApiTransportCode,
  BUILDING_CATALOGUE,
  BuildingType,
  CELL_PX,
  CELL_SIZE_M,
  CHUNK_SIZE,
  CONDITION_WARNING_THRESHOLD,
  CROPS,
  CellOwnership,
  CropCycleState,
  CropId,
  STORAGE_RESOURCES,
  LandUse,
  MACHINE_CATALOGUE,
  MAX_SELECTION_CELLS,
  MIN_CONDITION_TO_ASSIGN,
  MachineStatus,
  Money,
  OPERATION_REQUIREMENTS,
  POOL_REFRESH_INTERVAL_GAME_HOURS,
  SoilCondition,
  StorageResource,
  type StockItem,
  TaskStatus,
  TreeStatus,
  ValidationCode,
  WS_PATH,
  WS_TICKET_TTL_REAL_MS,
  WorkerStatus,
  addGameMs,
  apiErrorReply,
  bp,
  buildingResaleValue,
  canPurchase,
  cellKey,
  cellPrice,
  chunkOf,
  estimateTaskDuration,
  finalYieldLiters,
  fromWireGameMs,
  fromWireMoney,
  gameHours,
  gameHoursToGameMs,
  landPurchasePrice,
  machineResaleValue,
  multiplyByCount,
  skillFactor,
  terrainAt,
  toWireGameMs,
  toWireMoney,
  toWireRealMs,
  realMs,
  type ApiErrorCode,
  type ApiErrorDetails,
  type ApiRouteKey,
  type CellCoordWire,
  type FarmDto,
  type FieldDto,
  type LedgerEntryDto,
  type LedgerType,
  type MachineDto,
  type MachineType,
  type SelectionCell,
  type TaskDto,
  type TaskOperation,
  type WorkerDto,
} from '~/shared/index';

// ---------------------------------------------------------------------------
// Request and reply
// ---------------------------------------------------------------------------

export interface MockRequest {
  readonly routeKey: ApiRouteKey;
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
}

export interface MockReply {
  readonly status: number;
  readonly body: unknown;
  readonly contentType?: string;
}

type Handler = (server: MockServer, request: MockRequest) => MockReply;

function ok(body: unknown): MockReply {
  return { status: 200, body };
}

function text(body: string, contentType: string): MockReply {
  return { status: 200, body, contentType };
}

/**
 * The refusal of `expectedTotal`, or null when the budget the client sent still holds.
 *
 * The real server compares its own total against the one the request declares and answers 400
 * naming the field, with the two figures in the details (`modules/machinery/service.ts`,
 * `modules/land/service.ts`, `modules/farms/index.ts`). A declared field nobody checks is worse
 * than an undeclared one, and the simulated server could not exercise the refusal at all
 * (docs/handoff/NOTES-w5f.md 3.6).
 */
function expectedTotalMismatch(expected: string | undefined, actual: Money): MockReply | null {
  if (expected === undefined) {
    return null;
  }
  if (Money.compare(fromWireMoney(expected), actual) === 0) {
    return null;
  }
  return fail(ValidationCode.VALIDATION_FAILED, {
    field: 'body.expectedTotal',
    expected: toWireMoney(actual),
    actual: expected,
  });
}

function fail(code: ApiErrorCode, details?: ApiErrorDetails): MockReply {
  const reply = apiErrorReply(code, details);
  return { status: statusOf(code), body: reply };
}

/**
 * The status of a code comes from the contract table and is never chosen here: a simulated
 * server that answered a different status from the real one would train the client on a
 * behaviour it will not meet.
 */
function statusOf(code: ApiErrorCode): number {
  return API_ERROR_HTTP_STATUS[code];
}

/** The envelope of a mutating reply. Emitted frames must already have been pushed. */
function mutation(server: MockServer, result: unknown): MockReply {
  return ok({
    seq: server.currentSeq(),
    atGameMs: toWireGameMs(server.world.nowGameMs),
    result,
  });
}

function body<T>(request: MockRequest): T {
  return request.body as T;
}

// ---------------------------------------------------------------------------
// Shared state changes
// ---------------------------------------------------------------------------

/** Applies a signed amount to the balance and emits the two frames that report it. */
function post(
  server: MockServer,
  amount: Money,
  type: LedgerType,
  reference: { refType: string; refId: string },
): void {
  const world = server.world;
  world.balance = Money.add(world.balance, amount);
  world.ledgerSeq += 1;
  const entry: LedgerEntryDto = {
    id: `ledger-${world.ledgerSeq}`,
    seq: world.ledgerSeq,
    type,
    amount: toWireMoney(amount),
    balanceAfter: toWireMoney(world.balance),
    atGameMs: toWireGameMs(world.nowGameMs),
    refType: reference.refType,
    refId: reference.refId,
    meta: null,
  };
  world.ledger = [...world.ledger, entry];
  world.player = {
    ...world.player,
    balance: toWireMoney(world.balance),
    projectedBalance: toWireMoney(world.balance),
    ledgerSeq: world.ledgerSeq,
  };
  server.emit('PLAYER_UPSERTED', { player: world.player });
  server.emit('LEDGER_APPENDED', { entries: [entry], balance: toWireMoney(world.balance) });
}

/** Emits one `CHUNK_PATCHED` per touched chunk, bumping its version. */
function patchChunks(server: MockServer, cells: readonly CellCoordWire[]): void {
  const world = server.world;
  const touched = new Set<string>();
  for (const cell of cells) {
    const chunk = chunkOf(cell.cellX, cell.cellY);
    touched.add(`${chunk.chunkX}:${chunk.chunkY}`);
  }
  for (const key of touched) {
    const [xPart = '0', yPart = '0'] = key.split(':');
    const chunkX = Number(xPart);
    const chunkY = Number(yPart);
    const version = mockChunkVersion(world, chunkX, chunkY) + 1;
    world.chunkVersions.set(key, version);
    const patches = mockChunkCells(world, chunkX, chunkY);
    if (patches.length === 0) {
      continue;
    }
    server.emit('CHUNK_PATCHED', { chunkX, chunkY, version, cells: patches });
  }
}

/**
 * The cells of a request with the repeats removed, in the order they arrived.
 *
 * The union of rectangles the selection tool composes can name a cell twice, and the real
 * server never charges for it twice: it claims by unique key and reports what it actually
 * acquired. Valuing the duplicate would make the simulated total larger than the real one,
 * which is the difference that a panel comparing its own estimate with the reply would
 * report as an error of the panel (docs/handoff/NOTES-w4a.md 1.3, NOTES-w4-cierre.md 6).
 */
function distinctCells(cells: readonly CellCoordWire[]): readonly CellCoordWire[] {
  const seen = new Set<number>();
  const unique: CellCoordWire[] = [];
  for (const cell of cells) {
    const key = cellKey(cell.cellX, cell.cellY);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(cell);
  }
  return unique;
}

/** The cell as the shared selection rules want it, from the point of view of the player. */
function selectionCellOf(world: MockWorld, cell: CellCoordWire): SelectionCell {
  const owned = world.cells.get(cellKey(cell.cellX, cell.cellY));
  return {
    cellX: cell.cellX,
    cellY: cell.cellY,
    terrain: terrainAt(world.seed, cell.cellX, cell.cellY),
    ownership: owned === undefined ? CellOwnership.UNOWNED : CellOwnership.PLAYER,
    landUse: owned?.landUse ?? LandUse.NONE,
    hasStandingTree: owned?.hasStandingTree ?? false,
  };
}

/** Storage capacity of the farm for one resource, added up from its buildings. */
function storageCapacityOf(world: MockWorld, resource: StorageResource): number {
  let total = 0;
  for (const building of world.buildings) {
    const definition = BUILDING_CATALOGUE[building.type];
    if (definition.capacityKind === 'STORAGE' && definition.capacityResource === resource) {
      total += definition.capacity ?? 0;
    }
  }
  return total;
}

/** The same usage the sample world is built with: stock, reservation and occupancy. */
function usageWithCapacity(
  current: { readonly storedUnits: number; readonly reservedUnits: number },
  capacityUnits: number,
): { storedUnits: number; reservedUnits: number; capacityUnits: number; occupancyBp: number } {
  const occupancy =
    capacityUnits <= 0
      ? 0
      : Math.min(
          10_000,
          Math.round(((current.storedUnits + current.reservedUnits) / capacityUnits) * 10_000),
        );
  return {
    storedUnits: current.storedUnits,
    reservedUnits: current.reservedUnits,
    capacityUnits,
    occupancyBp: occupancy,
  };
}

function recomputeFarm(world: MockWorld): void {
  const garage = world.buildings.find((building) => building.type === BuildingType.GARAGE);
  const home = world.buildings.find((building) => building.type === BuildingType.WORKER_HOME);
  world.farm = {
    ...world.farm,
    machineSlots: { used: world.machines.length, total: garage?.capacity ?? 0 },
    workerSlots: { used: world.workers.length, total: home?.capacity ?? 0 },
    buildingCount: world.buildings.length,
    hasWorkshop: world.buildings.some((building) => building.type === BuildingType.WORKSHOP),
    // Capacity comes from the buildings and stock does not, which is the asymmetry of plan
    // section 5.4: what is counted is checked per building, what is fungible is held by
    // the farm. Without this, building a second silo left the capacity where it was and
    // the occupancy of the panel disagreed with the catalogue.
    storage: world.farm.storage.map((row) => ({
      category: row.category,
      usage: usageWithCapacity(row.usage, storageCapacityOf(world, row.category)),
    })),
  };
  if (garage !== undefined) {
    garage.occupancy = world.machines.length;
  }
  if (home !== undefined) {
    home.occupancy = world.workers.length;
  }
}

function machineDtoOf(
  world: MockWorld,
  id: string,
  type: MachineType,
  garageId: string | null,
): MachineDto {
  const definition = MACHINE_CATALOGUE[type];
  const condition = bp(10_000);
  return {
    id,
    farmId: MOCK_FARM_ID,
    garageId,
    type,
    conditionBp: condition,
    conditionUpdatedAtGameMs: toWireGameMs(world.nowGameMs),
    status: MachineStatus.IDLE,
    currentTaskId: null,
    repairEndsAtGameMs: null,
    purchasePrice: toWireMoney(definition.purchasePrice),
    acquiredGameMs: toWireGameMs(world.nowGameMs),
    resaleValue: toWireMoney(
      machineResaleValue({ purchasePrice: definition.purchasePrice, conditionBp: condition }),
    ),
    repairCost: toWireMoney(Money.ZERO),
    repairDurationGameHours: 0,
    assignable: true,
  };
}

function fieldProjectionOf(world: MockWorld, field: FieldDto): FieldDto {
  const crop = CROPS[field.cropId ?? CropId.WHEAT];
  const expected = finalYieldLiters({
    cellCount: field.cellCount,
    crop,
    fertilityBp: bp(field.fertilityBp),
    fertilizationBp: bp(field.fertilizationBp),
    weedLevelBp: bp(field.weedLevelBp),
  });
  const operations = Object.values(OPERATION_REQUIREMENTS)
    .filter((requirement) => requirement.fromCropStates.includes(field.cropCycleState))
    .map((requirement) => requirement.operation);
  return {
    ...field,
    projection: {
      ...field.projection,
      atGameMs: toWireGameMs(world.nowGameMs),
      cropCycleState: field.cropCycleState,
      expectedYieldLiters: expected.liters,
      availableOperations: field.currentTaskId === null ? operations : [],
    },
  };
}

/**
 * Farms founded during the session, beyond the one the sample world is built with.
 *
 * Keyed by the world so that a fresh `createMockWorld` starts with one holding again, and
 * held here rather than in `mock/world.ts` because `MockWorld` declares a single `farm`
 * and that module belongs to another agent. The consequence is the one that matters for
 * the panels: `GET /api/farms` and the snapshot list every holding, so the multi farm
 * exploitation of GDD section 31 can be exercised against the simulated server exactly as
 * it can against the real one (docs/handoff/NOTES-w4f.md, section 4.1).
 */
const foundedFarms = new WeakMap<MockWorld, FarmDto[]>();

/** Every holding of the player: the one of the sample world and the founded ones. */
function farmsOf(world: MockWorld): readonly FarmDto[] {
  return [world.farm, ...(foundedFarms.get(world) ?? [])];
}

/**
 * A farm with nothing in it, which is what founding one produces.
 *
 * Founding is an accounting act and not a physical one (ADR-0029): no price, no footprint
 * and no capacity, because what occupies cells and costs money is each building. Every
 * counter therefore starts at zero, and it is the buildings that raise them.
 */
function emptyFarm(world: MockWorld, id: string, name: string): FarmDto {
  const empty = { storedUnits: 0, reservedUnits: 0, capacityUnits: 0, occupancyBp: 0 };
  return {
    id,
    name,
    storage: STORAGE_RESOURCES.map((category) => ({ category, usage: empty })),
    machineSlots: { used: 0, total: 0 },
    workerSlots: { used: 0, total: 0 },
    hasWorkshop: false,
    buildingCount: 0,
    createdAtGameMs: toWireGameMs(world.nowGameMs),
  };
}

/** The occupancy of one category, as the mock farm holds it. */
function categoryUsage(world: MockWorld, category: StorageResource) {
  return (
    world.farm.storage.find((row) => row.category === category)?.usage ?? {
      storedUnits: 0,
      reservedUnits: 0,
      capacityUnits: 0,
      occupancyBp: 0,
    }
  );
}

/** The category a pile counts against, which is the meter it moves. */
function itemCategory(item: StockItem): StorageResource {
  return item === 'WOOD' ? StorageResource.WOOD_M3 : CROPS[item].storageResource;
}

/** The price of one pile: the crop's, or the wood constant the mock quotes. */
function itemPrice(item: StockItem) {
  return item === 'WOOD' ? MOCK_WOOD_PRICE_PER_DM3 : CROPS[item].sellPricePerLiter;
}

function refreshInventory(world: MockWorld): void {
  world.inventory = world.inventory.map((farm) => ({
    ...farm,
    categories: farm.categories.map((row) => ({
      ...row,
      usage: usageWithCapacity(
        categoryUsage(world, row.category),
        storageCapacityOf(world, row.category),
      ),
    })),
    lines: farm.lines.map((line) => ({
      ...line,
      marketValue: toWireMoney(multiplyByCount(itemPrice(line.item), line.storedUnits)),
    })),
  }));
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

function sessionReply(server: MockServer, firstSession: boolean): MockReply {
  const world = server.world;
  server.sessionOpen = true;
  return ok({
    accessToken: 'mock-access-token-0000000000',
    accessTokenExpiresInRealMs: ACCESS_TOKEN_TTL_REAL_MS,
    accessTokenExpiresAtRealMs: toWireRealMs(realMs(BigInt(Date.now() + ACCESS_TOKEN_TTL_REAL_MS))),
    playerId: MOCK_PLAYER_ID,
    worldId: MOCK_WORLD_ID,
    player: world.player,
    clock: mockClock(world),
    firstSession,
  });
}

function requireSession(server: MockServer): MockReply | null {
  return server.sessionOpen ? null : fail(ValidationCode.AUTH_REQUIRED);
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

export const MOCK_HANDLERS: Readonly<Record<ApiRouteKey, Handler>> = {
  // --- auth ---------------------------------------------------------------
  'POST /api/auth/register': (server) => sessionReply(server, true),
  'POST /api/auth/login': (server) => sessionReply(server, false),
  'POST /api/auth/refresh': (server) => {
    if (!server.sessionOpen) {
      return fail(ValidationCode.AUTH_REQUIRED);
    }
    return ok({
      accessToken: 'mock-access-token-0000000000',
      accessTokenExpiresInRealMs: ACCESS_TOKEN_TTL_REAL_MS,
      accessTokenExpiresAtRealMs: toWireRealMs(
        realMs(BigInt(Date.now() + ACCESS_TOKEN_TTL_REAL_MS)),
      ),
    });
  },
  'POST /api/auth/logout': (server) => {
    server.sessionOpen = false;
    return ok({ ok: true });
  },
  'POST /api/auth/ws-ticket': (server) => {
    const guard = requireSession(server);
    if (guard !== null) {
      return guard;
    }
    return ok({
      ticket: `mock-ticket-${server.currentSeq()}-000000000000`,
      expiresAtRealMs: toWireRealMs(realMs(BigInt(Date.now() + WS_TICKET_TTL_REAL_MS))),
      expiresInRealMs: WS_TICKET_TTL_REAL_MS,
      path: WS_PATH,
    });
  },
  'GET /api/auth/me': (server) => {
    const guard = requireSession(server);
    if (guard !== null) {
      return guard;
    }
    return ok({
      player: server.world.player,
      worldId: MOCK_WORLD_ID,
      clock: mockClock(server.world),
    });
  },

  // --- state --------------------------------------------------------------
  'GET /api/state/snapshot': (server) => {
    const guard = requireSession(server);
    if (guard !== null) {
      return guard;
    }
    const world = server.world;
    return ok({
      seq: server.currentSeq(),
      atGameMs: toWireGameMs(world.nowGameMs),
      world: worldInfo(server),
      player: world.player,
      farms: farmsOf(world),
      buildings: world.buildings,
      fields: world.fields,
      fieldCells: [...world.fieldCells].map(([fieldId, cells]) => ({ fieldId, cells })),
      machines: world.machines,
      workers: world.workers,
      laborPool: {
        candidates: world.candidates,
        nextRefreshAtGameMs: toWireGameMs(
          addGameMs(world.nowGameMs, gameHoursToGameMs(POOL_REFRESH_INTERVAL_GAME_HOURS)),
        ),
      },
      tasks: world.tasks,
      forestPlots: world.forestPlots,
      forestPlotCells: [...world.forestPlotCells].map(([forestPlotId, cells]) => ({
        forestPlotId,
        cells,
      })),
      inventory: world.inventory,
      notices: world.notices,
      // Derived, as the real server derives it: the mark of the last summary is behind the
      // present instant, so there is a window to summarise. It was a literal `false`, which
      // made the return summary the one panel that could not be reached against this server
      // (docs/handoff/NOTES-w6w.md 4.4). Flipping the literal to `true` would have been worse:
      // the modal would open in every development session, including right after a dismissal,
      // and `POST /api/session/welcome-back/ack` moves the mark precisely so it does not.
      welcomeBackPending: fromWireGameMs(world.player.lastSummaryGameMs) < world.nowGameMs,
    });
  },
  'GET /api/events': (server, request) => {
    const guard = requireSession(server);
    if (guard !== null) {
      return guard;
    }
    const since = Number(request.query.since ?? '0');
    const limit = Number(request.query.limit ?? '500');
    const { frames, truncated } = server.replay(since, limit);
    const last = frames.at(-1);
    return ok({
      since,
      through: last?.seq ?? since,
      currentSeq: server.currentSeq(),
      oldestReplaySeq: server.oldestReplaySeq(),
      truncated,
      frames,
      atGameMs: toWireGameMs(server.world.nowGameMs),
    });
  },
  'GET /api/session/welcome-back': (server) => {
    const guard = requireSession(server);
    if (guard !== null) {
      return guard;
    }
    const world = server.world;
    const from = fromWireGameMs(world.player.lastSummaryGameMs);
    return ok({
      fromGameMs: toWireGameMs(from),
      toGameMs: toWireGameMs(world.nowGameMs),
      elapsedGameHours: Number(world.nowGameMs - from) / 3_600_000,
      hasContent: true,
      economy: {
        balanceBefore: toWireMoney(Money.add(world.balance, Money.fromUnits(1_240))),
        balanceAfter: toWireMoney(world.balance),
        totalRevenue: toWireMoney(Money.ZERO),
        totalSalaries: toWireMoney(Money.negate(Money.fromUnits(1_240))),
        totalMaintenance: toWireMoney(Money.ZERO),
        totalOperating: toWireMoney(Money.ZERO),
        totalOther: toWireMoney(Money.ZERO),
        netChange: toWireMoney(Money.negate(Money.fromUnits(1_240))),
        byType: [
          {
            type: 'WORKER_WAGES',
            entryCount: 1,
            total: toWireMoney(Money.negate(Money.fromUnits(1_240))),
          },
        ],
      },
      tasksClosed: [],
      fieldTransitions: world.fields
        .filter((field) => field.cropCycleState === CropCycleState.GROWING)
        .map((field) => ({
          fieldId: field.id,
          name: field.name,
          fromState: CropCycleState.GERMINATING,
          toState: CropCycleState.GROWING,
          atGameMs: toWireGameMs(world.nowGameMs),
        })),
      idleWorkers: world.workers
        .filter((worker) => worker.status === WorkerStatus.IDLE)
        .map((worker) => ({ workerId: worker.id, name: worker.name })),
      repairsCompleted: [],
      storage: world.farm.storage
        .filter((row) => row.usage.capacityUnits > 0)
        .map((row) => ({
          farmId: MOCK_FARM_ID,
          resource: row.category,
          storedUnits: row.usage.storedUnits,
          capacityUnits: row.usage.capacityUnits,
          occupancyBp: row.usage.occupancyBp,
        })),
      treeStageChanges: [],
      wasted: [],
      liquidations: [],
      notices: world.notices,
    });
  },
  'POST /api/session/welcome-back/ack': (server, request) => {
    const guard = requireSession(server);
    if (guard !== null) {
      return guard;
    }
    const input = body<{ throughGameMs: string }>(request);
    server.world.player = { ...server.world.player, lastSummaryGameMs: input.throughGameMs };
    server.emit('PLAYER_UPSERTED', { player: server.world.player });
    return mutation(server, { lastSummaryGameMs: input.throughGameMs });
  },

  // --- world --------------------------------------------------------------
  'GET /api/world/info': (server) => {
    const guard = requireSession(server);
    return guard ?? ok(worldInfo(server));
  },
  'POST /api/world/chunks': (server, request) => {
    const guard = requireSession(server);
    if (guard !== null) {
      return guard;
    }
    const input = body<{ chunks: { chunkX: number; chunkY: number; rev?: number }[] }>(request);
    const world = server.world;
    return ok({
      chunks: input.chunks.map((requested) => {
        const version = mockChunkVersion(world, requested.chunkX, requested.chunkY);
        if (requested.rev !== undefined && requested.rev === version) {
          return {
            chunkX: requested.chunkX,
            chunkY: requested.chunkY,
            version,
            unchanged: true,
          };
        }
        return {
          chunkX: requested.chunkX,
          chunkY: requested.chunkY,
          version,
          unchanged: false,
          cells: mockChunkCells(world, requested.chunkX, requested.chunkY),
        };
      }),
      atGameMs: toWireGameMs(world.nowGameMs),
    });
  },

  // --- land ---------------------------------------------------------------
  'POST /api/land/quote': (server, request) => {
    const guard = requireSession(server);
    if (guard !== null) {
      return guard;
    }
    const world = server.world;
    const input = body<{ cells: CellCoordWire[] }>(request);
    const requested = distinctCells(input.cells);
    const cells = requested.map((cell) => {
      const resolved = selectionCellOf(world, cell);
      const blockedBy = canPurchase(resolved);
      const price = blockedBy === null ? cellPrice(resolved.terrain) : null;
      return {
        cellX: cell.cellX,
        cellY: cell.cellY,
        terrain: resolved.terrain,
        price: price === null ? null : toWireMoney(price),
        blockedBy,
      };
    });
    const purchasable = cells.filter((cell) => cell.blockedBy === null);
    const total = landPurchasePrice(
      requested
        .map((cell) => selectionCellOf(world, cell))
        .filter((cell) => canPurchase(cell) === null)
        .map((cell) => cell.terrain),
    ).total;
    const firstBlocked = cells.find((cell) => cell.blockedBy !== null);
    return ok({
      cells,
      purchasableCount: purchasable.length,
      blockedCount: cells.length - purchasable.length,
      total: toWireMoney(total),
      balance: toWireMoney(world.balance),
      affordable: Money.compare(total, world.balance) <= 0,
      firstBlockedCell:
        firstBlocked === undefined
          ? null
          : { cellX: firstBlocked.cellX, cellY: firstBlocked.cellY },
    });
  },
  'POST /api/land/purchase': (server, request) => {
    const guard = requireSession(server);
    if (guard !== null) {
      return guard;
    }
    const world = server.world;
    const input = body<{ cells: CellCoordWire[]; allowPartial: boolean }>(request);
    // Deduplicated first and measured after, which is the order of `normaliseSelection` in
    // `backend/src/modules/land/service.ts`: the ceiling is a ceiling on distinct cells.
    const requested = distinctCells(input.cells);
    if (requested.length > MAX_SELECTION_CELLS) {
      return fail(ValidationCode.SELECTION_TOO_LARGE, {
        cellCount: requested.length,
        limit: MAX_SELECTION_CELLS,
      });
    }
    const resolved = requested.map((cell) => selectionCellOf(world, cell));
    const purchasable = resolved.filter((cell) => canPurchase(cell) === null);
    if (purchasable.length < resolved.length && !input.allowPartial) {
      // The whole request is refused with the reason of the first cell that blocked it, which
      // is the behaviour `allowPartial: false` asks for: the client showed a total and must
      // not be charged a different one.
      const blocked = resolved.find((cell) => canPurchase(cell) !== null);
      const reason =
        blocked === undefined ? null : (canPurchase(blocked) ?? ValidationCode.CELL_ALREADY_OWNED);
      return fail(reason ?? ValidationCode.CELL_ALREADY_OWNED, {
        cells: blocked === undefined ? [] : [{ cellX: blocked.cellX, cellY: blocked.cellY }],
      });
    }
    const total = landPurchasePrice(purchasable.map((cell) => cell.terrain)).total;
    if (Money.compare(total, world.balance) > 0) {
      return fail(ValidationCode.INSUFFICIENT_FUNDS, {
        requiredMoney: toWireMoney(total),
        availableMoney: toWireMoney(world.balance),
      });
    }
    for (const cell of purchasable) {
      world.cells.set(cellKey(cell.cellX, cell.cellY), {
        cellX: cell.cellX,
        cellY: cell.cellY,
        landUse: LandUse.OWNED,
        fieldId: null,
        forestPlotId: null,
        buildingId: null,
        hasStandingTree: cell.terrain === 'FOREST',
      });
    }
    const acquired = purchasable.map((cell) => ({ cellX: cell.cellX, cellY: cell.cellY }));
    patchChunks(server, acquired);
    post(server, Money.negate(total), 'LAND_PURCHASE', { refType: 'LAND', refId: 'selection' });
    return mutation(server, {
      purchasedCells: acquired,
      purchasedCount: acquired.length,
      skippedCount: resolved.length - acquired.length,
      totalPaid: toWireMoney(total),
      balanceAfter: toWireMoney(world.balance),
    });
  },

  // --- farms --------------------------------------------------------------
  'GET /api/farms': (server) => {
    const guard = requireSession(server);
    return guard ?? ok({ farms: farmsOf(server.world), buildings: server.world.buildings });
  },
  'POST /api/farms': (server, request) => {
    const guard = requireSession(server);
    if (guard !== null) {
      return guard;
    }
    // A second holding, as the real route creates one: a row with a name and nothing else.
    // It used to rename the only farm of the sample world, which made the founding flow
    // untestable against the simulated server and was the opposite of what the panel says
    // is happening (docs/handoff/NOTES-w4f.md, section 4.1).
    const world = server.world;
    const input = body<{ name: string }>(request);
    const founded = foundedFarms.get(world) ?? [];
    const farm = emptyFarm(world, `farm-${founded.length + 2}`, input.name);
    foundedFarms.set(world, [...founded, farm]);
    server.emit('FARM_UPSERTED', { farm });
    return mutation(server, { farm });
  },
  'POST /api/farms/:farmId/buildings': (server, request) => {
    const guard = requireSession(server);
    if (guard !== null) {
      return guard;
    }
    const world = server.world;
    const input = body<{
      type: BuildingType;
      originCellX: number;
      originCellY: number;
      purchaseFootprintLand: boolean;
    }>(request);
    const definition = BUILDING_CATALOGUE[input.type];
    const footprint: CellCoordWire[] = [];
    for (let dy = 0; dy < definition.heightCells; dy += 1) {
      for (let dx = 0; dx < definition.widthCells; dx += 1) {
        footprint.push({ cellX: input.originCellX + dx, cellY: input.originCellY + dy });
      }
    }
    const notOwned = footprint.filter((cell) => !world.cells.has(cellKey(cell.cellX, cell.cellY)));
    if (notOwned.length > 0 && !input.purchaseFootprintLand) {
      return fail(ValidationCode.CELL_NOT_OWNED, { cells: notOwned.slice(0, 32) });
    }
    const landPrice = landPurchasePrice(
      notOwned.map((cell) => selectionCellOf(world, cell).terrain),
    ).total;
    const totalPrice = Money.add(definition.purchasePrice, landPrice);
    if (Money.compare(totalPrice, world.balance) > 0) {
      return fail(ValidationCode.INSUFFICIENT_FUNDS, {
        requiredMoney: toWireMoney(totalPrice),
        availableMoney: toWireMoney(world.balance),
      });
    }
    const id = `building-${world.buildings.length + 1}`;
    const created = {
      id,
      farmId: MOCK_FARM_ID,
      type: input.type,
      originCellX: input.originCellX,
      originCellY: input.originCellY,
      widthCells: definition.widthCells,
      heightCells: definition.heightCells,
      capacity: definition.capacity ?? 0,
      occupancy: 0,
      builtAtGameMs: toWireGameMs(world.nowGameMs),
      resaleValue: toWireMoney(buildingResaleValue(input.type)),
    };
    for (const cell of footprint) {
      world.cells.set(cellKey(cell.cellX, cell.cellY), {
        cellX: cell.cellX,
        cellY: cell.cellY,
        landUse: LandUse.BUILDING,
        fieldId: null,
        forestPlotId: null,
        buildingId: id,
        hasStandingTree: false,
      });
    }
    world.buildings = [...world.buildings, created];
    recomputeFarm(world);
    refreshInventory(world);
    server.emit('BUILDING_UPSERTED', { building: created });
    server.emit('INVENTORY_UPSERTED', { farms: world.inventory });
    server.emit('FARM_UPSERTED', { farm: world.farm });
    patchChunks(server, footprint);
    post(server, Money.negate(totalPrice), 'BUILDING_PURCHASE', {
      refType: 'BUILDING',
      refId: id,
    });
    return mutation(server, {
      building: created,
      farm: world.farm,
      landPurchasedCells: notOwned.length,
      buildingPaid: toWireMoney(definition.purchasePrice),
      landPaid: toWireMoney(landPrice),
      totalPaid: toWireMoney(totalPrice),
      balanceAfter: toWireMoney(world.balance),
      footprintCells: footprint,
    });
  },
  'DELETE /api/buildings/:buildingId': (server, request) => {
    const guard = requireSession(server);
    if (guard !== null) {
      return guard;
    }
    const world = server.world;
    const buildingId = request.params.buildingId ?? '';
    const building = world.buildings.find((candidate) => candidate.id === buildingId);
    if (building === undefined) {
      return fail(ValidationCode.NOT_FOUND, { entityKind: 'BUILDING', entityId: buildingId });
    }
    if (building.occupancy > 0) {
      return fail(ValidationCode.BUILDING_NOT_EMPTY, {
        occupancy: building.occupancy,
        capacity: building.capacity,
        entityId: buildingId,
      });
    }
    // Storage: removing the capacity must not leave the farm holding more than it can. The
    // second refusal of the real route, in its order and with its code, and the reason the
    // silo of the sample world cannot be sold with 18 400 L inside
    // (`backend/src/modules/farms/index.ts`, and docs/handoff/NOTES-w4f.md, section 4.2).
    const definition = BUILDING_CATALOGUE[building.type];
    if (definition.capacityKind === 'STORAGE' && definition.capacityResource !== null) {
      const usage = categoryUsage(world, definition.capacityResource);
      const remaining = usage.capacityUnits - (definition.capacity ?? 0);
      if (usage.storedUnits + usage.reservedUnits > remaining) {
        return fail(ValidationCode.BUILDING_NOT_EMPTY, {
          occupancy: usage.storedUnits + usage.reservedUnits,
          capacity: remaining < 0 ? 0 : remaining,
          entityId: buildingId,
        });
      }
    }
    const released: CellCoordWire[] = [];
    for (const [key, cell] of [...world.cells]) {
      if (cell.buildingId === buildingId) {
        world.cells.set(key, { ...cell, landUse: LandUse.OWNED, buildingId: null });
        released.push({ cellX: cell.cellX, cellY: cell.cellY });
      }
    }
    world.buildings = world.buildings.filter((candidate) => candidate.id !== buildingId);
    recomputeFarm(world);
    refreshInventory(world);
    const refund = fromWireMoney(building.resaleValue);
    server.emit('BUILDING_REMOVED', {
      buildingId,
      farmId: MOCK_FARM_ID,
      releasedCells: released,
    });
    server.emit('INVENTORY_UPSERTED', { farms: world.inventory });
    server.emit('FARM_UPSERTED', { farm: world.farm });
    patchChunks(server, released);
    post(server, refund, 'BUILDING_SALE', { refType: 'BUILDING', refId: buildingId });
    return mutation(server, {
      buildingId,
      farm: world.farm,
      refund: toWireMoney(refund),
      balanceAfter: toWireMoney(world.balance),
      releasedCells: released,
    });
  },

  // --- fields -------------------------------------------------------------
  'GET /api/fields': (server) => {
    const guard = requireSession(server);
    return guard ?? ok({ fields: server.world.fields });
  },
  'GET /api/fields/:fieldId': (server, request) => {
    const guard = requireSession(server);
    if (guard !== null) {
      return guard;
    }
    const fieldId = request.params.fieldId ?? '';
    const field = server.world.fields.find((candidate) => candidate.id === fieldId);
    if (field === undefined) {
      return fail(ValidationCode.NOT_FOUND, { entityKind: 'FIELD', entityId: fieldId });
    }
    return ok({ field, cells: server.world.fieldCells.get(fieldId) ?? [] });
  },
  'POST /api/fields': (server, request) => {
    const guard = requireSession(server);
    if (guard !== null) {
      return guard;
    }
    const world = server.world;
    const input = body<{ name: string; farmId: string | null; cells: CellCoordWire[] }>(request);
    const id = `field-${world.fields.length + 1}`;
    for (const cell of input.cells) {
      const key = cellKey(cell.cellX, cell.cellY);
      const owned = world.cells.get(key);
      if (owned === undefined) {
        return fail(ValidationCode.CELL_NOT_OWNED, { cells: [cell] });
      }
      if (owned.landUse !== LandUse.OWNED) {
        return fail(ValidationCode.CELL_IN_USE, { cells: [cell] });
      }
    }
    for (const cell of input.cells) {
      const key = cellKey(cell.cellX, cell.cellY);
      const owned = world.cells.get(key);
      if (owned !== undefined) {
        world.cells.set(key, { ...owned, landUse: LandUse.FIELD, fieldId: id });
      }
    }
    const field = fieldProjectionOf(world, {
      id,
      farmId: input.farmId,
      name: input.name,
      cellCount: input.cells.length,
      cropId: null,
      cropCycleState: CropCycleState.VIRGIN,
      soilCondition: SoilCondition.UNTOUCHED,
      fertilityBp: bp(10_000),
      fertilityUpdatedAtGameMs: toWireGameMs(world.nowGameMs),
      weedLevelBp: bp(0),
      weedLevelUpdatedAtGameMs: toWireGameMs(world.nowGameMs),
      fertilizationBp: bp(0),
      fertilizationUpdatedAtGameMs: toWireGameMs(world.nowGameMs),
      stateEnteredAtGameMs: toWireGameMs(world.nowGameMs),
      seededAtGameMs: null,
      currentTaskId: null,
      createdAtGameMs: toWireGameMs(world.nowGameMs),
      projection: {
        atGameMs: toWireGameMs(world.nowGameMs),
        cropCycleState: CropCycleState.VIRGIN,
        growthProgressBp: bp(0),
        weedLevelBp: bp(0),
        fertilityBp: bp(10_000),
        fertilizationBp: bp(0),
        readyAtGameMs: null,
        expectedYieldLiters: 0,
        availableOperations: [],
      },
    });
    world.fields = [...world.fields, field];
    world.fieldCells.set(id, input.cells);
    server.emit('FIELD_UPSERTED', { field, cells: input.cells });
    patchChunks(server, input.cells);
    return mutation(server, { field, cells: input.cells });
  },
  'POST /api/fields/:fieldId/extend': (server, request) => {
    const guard = requireSession(server);
    if (guard !== null) {
      return guard;
    }
    const world = server.world;
    const fieldId = request.params.fieldId ?? '';
    const input = body<{ cells: CellCoordWire[] }>(request);
    const index = world.fields.findIndex((candidate) => candidate.id === fieldId);
    const field = world.fields[index];
    if (field === undefined) {
      return fail(ValidationCode.NOT_FOUND, { entityKind: 'FIELD', entityId: fieldId });
    }
    for (const cell of input.cells) {
      const key = cellKey(cell.cellX, cell.cellY);
      const owned = world.cells.get(key);
      if (owned === undefined || owned.landUse !== LandUse.OWNED) {
        return fail(ValidationCode.CELL_IN_USE, { cells: [cell] });
      }
      world.cells.set(key, { ...owned, landUse: LandUse.FIELD, fieldId });
    }
    const cells = [...(world.fieldCells.get(fieldId) ?? []), ...input.cells];
    world.fieldCells.set(fieldId, cells);
    const updated = fieldProjectionOf(world, { ...field, cellCount: cells.length });
    world.fields = world.fields.map((candidate) =>
      candidate.id === fieldId ? updated : candidate,
    );
    server.emit('FIELD_UPSERTED', { field: updated, cells });
    patchChunks(server, input.cells);
    return mutation(server, { field: updated, cells });
  },
  'POST /api/fields/:fieldId/split': (server, request) => {
    const guard = requireSession(server);
    if (guard !== null) {
      return guard;
    }
    const world = server.world;
    const fieldId = request.params.fieldId ?? '';
    const input = body<{ name: string; cells: CellCoordWire[] }>(request);
    const original = world.fields.find((candidate) => candidate.id === fieldId);
    if (original === undefined) {
      return fail(ValidationCode.NOT_FOUND, { entityKind: 'FIELD', entityId: fieldId });
    }
    const moved = new Set(input.cells.map((cell) => cellKey(cell.cellX, cell.cellY)));
    const remaining = (world.fieldCells.get(fieldId) ?? []).filter(
      (cell) => !moved.has(cellKey(cell.cellX, cell.cellY)),
    );
    if (remaining.length === 0 || input.cells.length === 0) {
      return fail(ValidationCode.FIELD_SPLIT_INCOMPLETE);
    }
    const createdId = `field-${world.fields.length + 1}`;
    for (const cell of input.cells) {
      const key = cellKey(cell.cellX, cell.cellY);
      const owned = world.cells.get(key);
      if (owned !== undefined) {
        world.cells.set(key, { ...owned, fieldId: createdId });
      }
    }
    const updatedOriginal = fieldProjectionOf(world, {
      ...original,
      cellCount: remaining.length,
    });
    const created = fieldProjectionOf(world, {
      ...original,
      id: createdId,
      name: input.name,
      cellCount: input.cells.length,
      currentTaskId: null,
    });
    world.fieldCells.set(fieldId, remaining);
    world.fieldCells.set(createdId, input.cells);
    world.fields = [
      ...world.fields.map((candidate) => (candidate.id === fieldId ? updatedOriginal : candidate)),
      created,
    ];
    server.emit('FIELD_UPSERTED', { field: updatedOriginal, cells: remaining });
    server.emit('FIELD_UPSERTED', { field: created, cells: input.cells });
    patchChunks(server, input.cells);
    return mutation(server, {
      original: updatedOriginal,
      created,
      movedCells: input.cells,
    });
  },
  'POST /api/fields/merge': (server, request) => {
    const guard = requireSession(server);
    if (guard !== null) {
      return guard;
    }
    const world = server.world;
    const input = body<{ name: string; fieldIds: string[] }>(request);
    const merged = input.fieldIds
      .map((id) => world.fields.find((candidate) => candidate.id === id))
      .filter((candidate): candidate is FieldDto => candidate !== undefined);
    if (merged.length < 2) {
      return fail(ValidationCode.NOT_FOUND, {
        entityKind: 'FIELD',
        entityId: input.fieldIds.join(','),
      });
    }
    const first = merged[0];
    if (first === undefined) {
      return fail(ValidationCode.VALIDATION_FAILED, { field: 'fieldIds' });
    }
    const cells = merged.flatMap((field) => world.fieldCells.get(field.id) ?? []);
    const removedFieldIds = merged.slice(1).map((field) => field.id);
    for (const cell of cells) {
      const key = cellKey(cell.cellX, cell.cellY);
      const owned = world.cells.get(key);
      if (owned !== undefined) {
        world.cells.set(key, { ...owned, fieldId: first.id });
      }
    }
    const field = fieldProjectionOf(world, {
      ...first,
      name: input.name,
      cellCount: cells.length,
    });
    world.fieldCells.set(first.id, cells);
    for (const id of removedFieldIds) {
      world.fieldCells.delete(id);
    }
    world.fields = [
      field,
      ...world.fields.filter(
        (candidate) => candidate.id !== first.id && !removedFieldIds.includes(candidate.id),
      ),
    ];
    server.emit('FIELD_UPSERTED', { field, cells });
    for (const id of removedFieldIds) {
      server.emit('FIELD_REMOVED', { fieldId: id });
    }
    patchChunks(server, cells);
    return mutation(server, { field, removedFieldIds });
  },

  // --- machinery ----------------------------------------------------------
  'GET /api/machines': (server) => {
    const guard = requireSession(server);
    return guard ?? ok({ machines: server.world.machines });
  },
  'GET /api/machines/catalog': () =>
    ok({
      machines: Object.values(MACHINE_CATALOGUE).map((definition) => ({
        type: definition.type,
        role: definition.role,
        purchasePrice: toWireMoney(definition.purchasePrice),
        maintenanceCostPerGameHour: toWireMoney(definition.maintenanceCostPerGameHour),
        operatingCostPerGameHour: toWireMoney(definition.operatingCostPerGameHour),
        workSpeedUnitsPerGameHour: definition.workSpeedUnitsPerGameHour,
        workUnit: definition.workUnit,
        workWidthM: definition.workWidthM,
        capacity: definition.capacity,
        capacityResource: definition.capacityResource,
        wearRateBpPerGameHour: definition.wearRateBpPerGameHour,
        repairCostPerConditionPoint: toWireMoney(definition.repairCostPerConditionPoint),
        compatibleImplements: definition.compatibleImplements,
      })),
      operations: Object.values(OPERATION_REQUIREMENTS).map((requirement) => ({
        operation: requirement.operation,
        targetKind: requirement.targetKind,
        workUnit: requirement.workUnit,
        poweredMachine: requirement.poweredMachine,
        requiredImplement: requirement.requiredImplement,
        requiredPossession: requirement.requiredPossession,
        requiresCrop: requirement.requiresCrop,
        // `FROM_CROP` es un centinela de la tabla de requisitos, no una categoria: la
        // ruta informa null y `storageFromCrop` es lo que dice que la decide el cultivo.
        requiresStorage:
          requirement.requiresStorage === 'FROM_CROP' ? null : requirement.requiresStorage,
        storageFromCrop: requirement.requiresStorage === 'FROM_CROP',
      })),
      minConditionToAssignBp: MIN_CONDITION_TO_ASSIGN,
      conditionWarningThresholdBp: CONDITION_WARNING_THRESHOLD,
    }),
  'POST /api/machines': (server, request) => {
    const guard = requireSession(server);
    if (guard !== null) {
      return guard;
    }
    const world = server.world;
    const input = body<{
      farmId: string;
      type: MachineType;
      garageId?: string;
      expectedTotal?: string;
    }>(request);
    const garage = world.buildings.find(
      (building) =>
        building.type === BuildingType.GARAGE &&
        (input.garageId === undefined || building.id === input.garageId),
    );
    if (garage === undefined) {
      return fail(ValidationCode.GARAGE_CAPACITY_EXCEEDED, { occupancy: 0, capacity: 0 });
    }
    if (garage.occupancy >= garage.capacity) {
      return fail(ValidationCode.GARAGE_CAPACITY_EXCEEDED, {
        occupancy: garage.occupancy,
        capacity: garage.capacity,
        entityId: garage.id,
      });
    }
    const definition = MACHINE_CATALOGUE[input.type];
    // The price contract of ADR-0034, which the real server applies and this one ignored: a
    // budget the panel computed before the catalogue moved must be refused and not charged in
    // silence (docs/handoff/NOTES-w5f.md 3.6).
    const priceMismatch = expectedTotalMismatch(input.expectedTotal, definition.purchasePrice);
    if (priceMismatch !== null) {
      return priceMismatch;
    }
    if (Money.compare(definition.purchasePrice, world.balance) > 0) {
      return fail(ValidationCode.INSUFFICIENT_FUNDS, {
        requiredMoney: toWireMoney(definition.purchasePrice),
        availableMoney: toWireMoney(world.balance),
      });
    }
    const machine = machineDtoOf(
      world,
      `machine-${world.machines.length + 1}`,
      input.type,
      garage.id,
    );
    world.machines = [...world.machines, machine];
    recomputeFarm(world);
    server.emit('MACHINE_UPSERTED', { machine });
    server.emit('BUILDING_UPSERTED', { building: garage });
    post(server, Money.negate(definition.purchasePrice), 'MACHINE_PURCHASE', {
      refType: 'MACHINE',
      refId: machine.id,
    });
    return mutation(server, {
      machine,
      totalPaid: toWireMoney(definition.purchasePrice),
      balanceAfter: toWireMoney(world.balance),
      garageSlotsUsed: garage.occupancy,
      garageSlotsTotal: garage.capacity,
    });
  },
  'POST /api/machines/:machineId/sell': (server, request) => {
    const guard = requireSession(server);
    if (guard !== null) {
      return guard;
    }
    const world = server.world;
    const machineId = request.params.machineId ?? '';
    const machine = world.machines.find((candidate) => candidate.id === machineId);
    if (machine === undefined) {
      return fail(ValidationCode.NOT_FOUND, { entityKind: 'MACHINE', entityId: machineId });
    }
    if (machine.status !== MachineStatus.IDLE) {
      return fail(ValidationCode.MACHINE_NOT_IDLE, { entityId: machineId });
    }
    world.machines = world.machines.filter((candidate) => candidate.id !== machineId);
    recomputeFarm(world);
    const garage = world.buildings.find((building) => building.type === BuildingType.GARAGE);
    const refund = fromWireMoney(machine.resaleValue);
    server.emit('MACHINE_REMOVED', { machineId, farmId: MOCK_FARM_ID });
    if (garage !== undefined) {
      server.emit('BUILDING_UPSERTED', { building: garage });
    }
    post(server, refund, 'MACHINE_SALE', { refType: 'MACHINE', refId: machineId });
    return mutation(server, {
      machineId,
      refund: toWireMoney(refund),
      balanceAfter: toWireMoney(world.balance),
      garageSlotsUsed: garage?.occupancy ?? 0,
      garageSlotsTotal: garage?.capacity ?? 0,
    });
  },
  'POST /api/machines/:machineId/repair': (server, request) => {
    const guard = requireSession(server);
    if (guard !== null) {
      return guard;
    }
    const world = server.world;
    const machineId = request.params.machineId ?? '';
    const input = body<{ toConditionBp?: number; expectedTotal?: string }>(request);
    const machine = world.machines.find((candidate) => candidate.id === machineId);
    if (machine === undefined) {
      return fail(ValidationCode.NOT_FOUND, { entityKind: 'MACHINE', entityId: machineId });
    }
    if (!world.farm.hasWorkshop) {
      return fail(ValidationCode.WORKSHOP_REQUIRED);
    }
    const target = input.toConditionBp ?? 10_000;
    if (target <= machine.conditionBp) {
      return fail(ValidationCode.MACHINE_CONDITION_ALREADY_FULL, {
        conditionBp: machine.conditionBp,
      });
    }
    const points = Math.ceil((target - machine.conditionBp) / 100);
    const definition = MACHINE_CATALOGUE[machine.type];
    const cost = multiplyByCount(definition.repairCostPerConditionPoint, points);
    const costMismatch = expectedTotalMismatch(input.expectedTotal, cost);
    if (costMismatch !== null) {
      return costMismatch;
    }
    if (Money.compare(cost, world.balance) > 0) {
      return fail(ValidationCode.INSUFFICIENT_FUNDS, {
        requiredMoney: toWireMoney(cost),
        availableMoney: toWireMoney(world.balance),
      });
    }
    const endsAt = addGameMs(world.nowGameMs, gameHoursToGameMs(gameHours(points * 0.25)));
    const repaired: MachineDto = {
      ...machine,
      conditionBp: bp(target),
      conditionUpdatedAtGameMs: toWireGameMs(world.nowGameMs),
      status: 'IN_REPAIR',
      repairEndsAtGameMs: toWireGameMs(endsAt),
      resaleValue: toWireMoney(
        machineResaleValue({
          purchasePrice: definition.purchasePrice,
          conditionBp: bp(target),
        }),
      ),
      repairCost: toWireMoney(Money.ZERO),
      repairDurationGameHours: 0,
      assignable: target >= MIN_CONDITION_TO_ASSIGN,
    };
    world.machines = world.machines.map((candidate) =>
      candidate.id === machineId ? repaired : candidate,
    );
    server.emit('MACHINE_UPSERTED', { machine: repaired });
    post(server, Money.negate(cost), 'MACHINE_REPAIR', { refType: 'MACHINE', refId: machineId });
    return mutation(server, {
      machine: repaired,
      pointsRestored: points,
      totalPaid: toWireMoney(cost),
      balanceAfter: toWireMoney(world.balance),
      repairEndsAtGameMs: toWireGameMs(endsAt),
    });
  },

  // --- workers ------------------------------------------------------------
  'GET /api/workers': (server) => {
    const guard = requireSession(server);
    if (guard !== null) {
      return guard;
    }
    const world = server.world;
    const home = world.buildings.find((building) => building.type === BuildingType.WORKER_HOME);
    return ok({
      workers: world.workers,
      totalSalaryPerGameHour: toWireMoney(
        Money.sum(world.workers.map((worker) => fromWireMoney(worker.salaryPerGameHour))),
      ),
      homeSlotsUsed: world.workers.length,
      homeSlotsTotal: home?.capacity ?? 0,
    });
  },
  'GET /api/workers/pool': (server) => {
    const guard = requireSession(server);
    if (guard !== null) {
      return guard;
    }
    return ok({
      candidates: server.world.candidates,
      nextRefreshAtGameMs: toWireGameMs(
        addGameMs(server.world.nowGameMs, gameHoursToGameMs(POOL_REFRESH_INTERVAL_GAME_HOURS)),
      ),
    });
  },
  'POST /api/workers/hire': (server, request) => {
    const guard = requireSession(server);
    if (guard !== null) {
      return guard;
    }
    const world = server.world;
    const input = body<{ candidateId: string; farmId: string; homeId?: string }>(request);
    const candidate = world.candidates.find((entry) => entry.id === input.candidateId);
    if (candidate === undefined) {
      return fail(ValidationCode.CANDIDATE_NOT_AVAILABLE, { entityId: input.candidateId });
    }
    const home = world.buildings.find(
      (building) =>
        building.type === BuildingType.WORKER_HOME &&
        (input.homeId === undefined || building.id === input.homeId),
    );
    if (home === undefined || home.occupancy >= home.capacity) {
      return fail(ValidationCode.HOME_CAPACITY_EXCEEDED, {
        occupancy: home?.occupancy ?? 0,
        capacity: home?.capacity ?? 0,
      });
    }
    const worker: WorkerDto = {
      id: `worker-${world.workers.length + 1}`,
      farmId: MOCK_FARM_ID,
      homeId: home.id,
      name: candidate.name,
      skillBp: candidate.skillBp,
      salaryPerGameHour: candidate.askingSalaryPerGameHour,
      status: WorkerStatus.IDLE,
      currentTaskId: null,
      completedTaskCount: 0,
      hiredGameMs: toWireGameMs(world.nowGameMs),
      skillFactor: skillFactor(bp(candidate.skillBp)),
    };
    world.workers = [...world.workers, worker];
    world.candidates = world.candidates.filter((entry) => entry.id !== input.candidateId);
    recomputeFarm(world);
    const pool = {
      candidates: world.candidates,
      nextRefreshAtGameMs: toWireGameMs(
        addGameMs(world.nowGameMs, gameHoursToGameMs(POOL_REFRESH_INTERVAL_GAME_HOURS)),
      ),
    };
    server.emit('WORKER_UPSERTED', { worker });
    server.emit('WORKER_POOL_UPSERTED', pool);
    server.emit('BUILDING_UPSERTED', { building: home });
    return mutation(server, {
      worker,
      pool,
      homeSlotsUsed: world.workers.length,
      homeSlotsTotal: home.capacity,
    });
  },
  'POST /api/workers/:workerId/fire': (server, request) => {
    const guard = requireSession(server);
    if (guard !== null) {
      return guard;
    }
    const world = server.world;
    const workerId = request.params.workerId ?? '';
    const worker = world.workers.find((candidate) => candidate.id === workerId);
    if (worker === undefined) {
      return fail(ValidationCode.NOT_FOUND, { entityKind: 'WORKER', entityId: workerId });
    }
    if (worker.status !== WorkerStatus.IDLE) {
      return fail(ValidationCode.WORKER_NOT_IDLE, { entityId: workerId });
    }
    world.workers = world.workers.filter((candidate) => candidate.id !== workerId);
    recomputeFarm(world);
    const home = world.buildings.find((building) => building.id === worker.homeId);
    server.emit('WORKER_REMOVED', { workerId, farmId: MOCK_FARM_ID });
    if (home !== undefined) {
      server.emit('BUILDING_UPSERTED', { building: home });
    }
    return mutation(server, {
      workerId,
      homeSlotsUsed: world.workers.length,
      homeSlotsTotal: home?.capacity ?? 0,
      totalSalaryPerGameHour: toWireMoney(
        Money.sum(world.workers.map((candidate) => fromWireMoney(candidate.salaryPerGameHour))),
      ),
    });
  },

  // --- tasks --------------------------------------------------------------
  'GET /api/tasks': (server) => {
    const guard = requireSession(server);
    return (
      guard ??
      ok({
        tasks: server.world.tasks,
        nextCursor: null,
        atGameMs: toWireGameMs(server.world.nowGameMs),
      })
    );
  },
  'GET /api/tasks/:taskId': (server, request) => {
    const guard = requireSession(server);
    if (guard !== null) {
      return guard;
    }
    const taskId = request.params.taskId ?? '';
    const task = server.world.tasks.find((candidate) => candidate.id === taskId);
    if (task === undefined) {
      return fail(ValidationCode.NOT_FOUND, { entityKind: 'TASK', entityId: taskId });
    }
    return ok({ task, atGameMs: toWireGameMs(server.world.nowGameMs) });
  },
  'POST /api/tasks/estimate': (server, request) => estimateReply(server, request),
  'POST /api/tasks': (server, request) => createTaskReply(server, request),
  'POST /api/tasks/:taskId/cancel': (server, request) => {
    const guard = requireSession(server);
    if (guard !== null) {
      return guard;
    }
    const world = server.world;
    const taskId = request.params.taskId ?? '';
    const task = world.tasks.find((candidate) => candidate.id === taskId);
    if (task === undefined) {
      return fail(ValidationCode.NOT_FOUND, { entityKind: 'TASK', entityId: taskId });
    }
    if (task.status !== TaskStatus.IN_PROGRESS) {
      return fail(ValidationCode.TASK_ALREADY_FINISHED, { entityId: taskId });
    }
    const cancelled: TaskDto = {
      ...task,
      status: TaskStatus.CANCELED,
      endedGameMs: toWireGameMs(world.nowGameMs),
      cancelable: false,
    };
    world.tasks = world.tasks.map((candidate) => (candidate.id === taskId ? cancelled : candidate));
    releaseReservations(server, task);
    server.emit('TASK_UPSERTED', { task: cancelled });
    return mutation(server, {
      task: cancelled,
      machineConditionBp: task.machineIds.map((machineId) => ({
        machineId,
        conditionBp:
          world.machines.find((machine) => machine.id === machineId)?.conditionBp ?? 10_000,
      })),
      releasedStorageUnits: task.reservedStorageUnits,
    });
  },

  // --- economy ------------------------------------------------------------
  'GET /api/inventory': (server) => {
    const guard = requireSession(server);
    return (
      guard ?? ok({ farms: server.world.inventory, atGameMs: toWireGameMs(server.world.nowGameMs) })
    );
  },
  'GET /api/market/prices': (server) => {
    const guard = requireSession(server);
    return (
      guard ?? ok({ prices: mockMarketPrices(), atGameMs: toWireGameMs(server.world.nowGameMs) })
    );
  },
  'GET /api/economy/ledger': (server, request) => {
    const guard = requireSession(server);
    if (guard !== null) {
      return guard;
    }
    const limit = Number(request.query.limit ?? '50');
    const entries = [...server.world.ledger].reverse().slice(0, limit);
    return ok({
      entries,
      nextCursor: null,
      balance: toWireMoney(server.world.balance),
      entryCount: server.world.ledger.length,
    });
  },
  'POST /api/market/sell': (server, request) => {
    const guard = requireSession(server);
    if (guard !== null) {
      return guard;
    }
    const world = server.world;
    const input = body<{ farmId: string; item: StockItem; quantityUnits?: number }>(request);
    // The pile decides the price and the category decides the meter, exactly as the server
    // does: selling barley must not take wheat out of the silo.
    const category = itemCategory(input.item);
    const line = world.inventory[0]?.lines.find((row) => row.item === input.item);
    const available = line?.storedUnits ?? 0;
    const quantity = input.quantityUnits ?? available;
    if (quantity <= 0 || quantity > available) {
      return fail(ValidationCode.INSUFFICIENT_STOCK, {
        requiredUnits: quantity,
        availableUnits: available,
      });
    }
    const revenue = multiplyByCount(itemPrice(input.item), quantity);
    const usage = categoryUsage(world, category);
    const nextStored = usage.storedUnits - quantity;
    const nextUsage = {
      ...usage,
      storedUnits: nextStored,
      occupancyBp:
        usage.capacityUnits <= 0
          ? 0
          : Math.round(((nextStored + usage.reservedUnits) / usage.capacityUnits) * 10_000),
    };
    world.farm = {
      ...world.farm,
      storage: world.farm.storage.map((row) =>
        row.category === category ? { ...row, usage: nextUsage } : row,
      ),
    };
    world.inventory = world.inventory.map((farm) => ({
      ...farm,
      lines: farm.lines.map((row) =>
        row.item === input.item ? { ...row, storedUnits: nextStored } : row,
      ),
    }));
    refreshInventory(world);
    server.emit('INVENTORY_UPSERTED', { farms: world.inventory });
    server.emit('FARM_UPSERTED', { farm: world.farm });
    post(server, revenue, input.item === 'WOOD' ? 'WOOD_SALE' : 'CROP_SALE', {
      refType: 'FARM',
      refId: MOCK_FARM_ID,
    });
    return mutation(server, {
      item: input.item,
      category,
      quantitySoldUnits: quantity,
      revenue: toWireMoney(revenue),
      balanceAfter: toWireMoney(world.balance),
      usage: nextUsage,
    });
  },

  // --- forestry -----------------------------------------------------------
  'GET /api/forest-plots': (server) => {
    const guard = requireSession(server);
    return guard ?? ok({ plots: server.world.forestPlots });
  },
  'GET /api/forest-plots/:forestPlotId': (server, request) => {
    const guard = requireSession(server);
    if (guard !== null) {
      return guard;
    }
    const world = server.world;
    const plotId = request.params.forestPlotId ?? '';
    const plot = world.forestPlots.find((candidate) => candidate.id === plotId);
    if (plot === undefined) {
      return fail(ValidationCode.NOT_FOUND, { entityKind: 'FOREST_PLOT', entityId: plotId });
    }
    const limit = Number(request.query.limit ?? '2000');
    return ok({
      plot,
      trees: world.trees.filter((tree) => tree.forestPlotId === plotId).slice(0, limit),
      nextCursor: null,
      atGameMs: toWireGameMs(world.nowGameMs),
    });
  },
  'POST /api/forest-plots': (server, request) => {
    const guard = requireSession(server);
    if (guard !== null) {
      return guard;
    }
    const world = server.world;
    const input = body<{ name: string; farmId: string | null; cells: CellCoordWire[] }>(request);
    const id = `plot-${world.forestPlots.length + 1}`;
    for (const cell of input.cells) {
      const key = cellKey(cell.cellX, cell.cellY);
      const owned = world.cells.get(key);
      if (owned === undefined) {
        return fail(ValidationCode.CELL_NOT_OWNED, { cells: [cell] });
      }
      world.cells.set(key, { ...owned, landUse: LandUse.FOREST_PLOT, forestPlotId: id });
    }
    const plot = {
      id,
      farmId: input.farmId,
      name: input.name,
      cellCount: input.cells.length,
      emptyCellCount: input.cells.length,
      standingTreeCount: 0,
      fellableTreeCount: 0,
      standingWoodDm3: 0,
      fellableWoodDm3: 0,
      fellableWoodValue: toWireMoney(Money.ZERO),
      stageHistogram: { SAPLING: 0, YOUNG: 0, MATURE: 0, OLD_GROWTH: 0 },
      currentTaskId: null,
      createdAtGameMs: toWireGameMs(world.nowGameMs),
      atGameMs: toWireGameMs(world.nowGameMs),
    };
    world.forestPlots = [...world.forestPlots, plot];
    world.forestPlotCells.set(id, input.cells);
    server.emit('FOREST_PLOT_UPSERTED', { plot, cells: input.cells });
    server.emit('TREES_UPSERTED', {
      forestPlotId: id,
      trees: [],
      removedTreeIds: [],
      plot,
    });
    patchChunks(server, input.cells);
    return mutation(server, { plot, trees: [], generatedTreeCount: 0 });
  },
  'POST /api/forest-plots/:forestPlotId/fell': (server, request) =>
    forestryTaskReply(server, request, 'FELL'),
  'POST /api/forest-plots/:forestPlotId/replant': (server, request) =>
    forestryTaskReply(server, request, 'REPLANT'),
  'POST /api/land/clear': (server, request) => forestryTaskReply(server, request, 'CLEAR_LAND'),

  // --- system -------------------------------------------------------------
  'GET /health': (server) =>
    ok({
      status: 'ok',
      role: 'server',
      version: 'mock',
      contractVersion: MOCK_CONTRACT_VERSION,
      uptimeRealMs: 0,
      checks: { postgres: 'up', redis: 'up', queue: 'up' },
      clock: mockClock(server.world),
    }),
  'GET /metrics': () =>
    text('# El servidor simulado no publica metricas.\n', 'text/plain; charset=utf-8'),
  'GET /docs': () =>
    text(
      '<!doctype html><title>Servidor simulado</title><p>La documentacion OpenAPI la sirve el backend real.</p>',
      'text/html; charset=utf-8',
    ),
  'POST /api/dev/retime': (server, request) => {
    const input = body<{ rateNum: number; rateDen: number }>(request);
    const clock = { ...mockClock(server.world), rateNum: input.rateNum, rateDen: input.rateDen };
    server.emitTransport('CLOCK', { clock });
    return ok({ clock, rescheduledJobs: 0 });
  },
  'POST /api/dev/advance-player': (server, request) => {
    const input = body<{ toGameMs: string }>(request);
    server.world.nowGameMs = fromWireGameMs(input.toGameMs);
    server.world.player = {
      ...server.world.player,
      atGameMs: input.toGameMs,
      lastAccrualGameMs: input.toGameMs,
    };
    server.emit('PLAYER_UPSERTED', { player: server.world.player });
    return ok({
      processedEvents: 0,
      lastAccrualGameMs: input.toGameMs,
      balance: toWireMoney(server.world.balance),
    });
  },
  'POST /api/dev/grant': (server, request) => {
    const input = body<{ amount: string; reason: string }>(request);
    post(server, fromWireMoney(input.amount), 'COMPENSATION', {
      refType: 'DEV',
      refId: input.reason,
    });
    return mutation(server, {
      amount: input.amount,
      balanceAfter: toWireMoney(server.world.balance),
    });
  },
  'POST /api/dev/reconcile': () => ok({ enqueuedEvents: 0, pendingEvents: 0 }),
};

// ---------------------------------------------------------------------------
// The three handlers that needed more than a literal
// ---------------------------------------------------------------------------

function worldInfo(server: MockServer) {
  const world = server.world;
  return {
    worldId: MOCK_WORLD_ID,
    seed: world.seed,
    generatorVersion: MOCK_GENERATOR_VERSION,
    chunkSize: CHUNK_SIZE,
    cellSizeM: CELL_SIZE_M,
    cellPx: CELL_PX,
    maxSelectionCells: MAX_SELECTION_CELLS,
    contractVersion: MOCK_CONTRACT_VERSION,
    clock: mockClock(world),
    spawnCellX: world.spawnCell.cellX,
    spawnCellY: world.spawnCell.cellY,
  };
}

interface TaskRequestBody {
  readonly operation?: TaskOperation;
  readonly workerId: string;
  readonly poweredMachineId: string;
  readonly implementMachineId?: string;
  readonly targetFieldId?: string;
  readonly targetForestPlotId?: string;
  readonly destinationFarmId?: string;
  readonly cropId?: CropId;
  readonly cells?: CellCoordWire[];
}

/** Units the operation would work on: the cells of the target, or the trees of the plot. */
function unitsFor(world: MockWorld, operation: TaskOperation, input: TaskRequestBody): number {
  if (operation === 'FELL') {
    return world.trees.filter(
      (tree) =>
        tree.forestPlotId === input.targetForestPlotId && tree.status === TreeStatus.STANDING,
    ).length;
  }
  if (input.cells !== undefined) {
    return input.cells.length;
  }
  const field = world.fields.find((candidate) => candidate.id === input.targetFieldId);
  return field?.cellCount ?? 0;
}

function estimateReply(server: MockServer, request: MockRequest): MockReply {
  const guard = requireSession(server);
  if (guard !== null) {
    return guard;
  }
  const world = server.world;
  const input = body<TaskRequestBody>(request);
  const operation = input.operation ?? 'PLOW';
  const worker = world.workers.find((candidate) => candidate.id === input.workerId);
  const powered = world.machines.find((candidate) => candidate.id === input.poweredMachineId);
  const paceMachine =
    world.machines.find((candidate) => candidate.id === input.implementMachineId) ?? powered;
  const blockers: { code: ApiErrorCode; message: string }[] = [];
  if (worker === undefined || worker.status !== WorkerStatus.IDLE) {
    blockers.push({
      code: ValidationCode.WORKER_NOT_IDLE,
      message: 'El trabajador no esta disponible.',
    });
  }
  if (powered === undefined || powered.status !== MachineStatus.IDLE) {
    blockers.push({
      code: ValidationCode.MACHINE_NOT_IDLE,
      message: 'La maquina no esta disponible.',
    });
  }
  const units = unitsFor(world, operation, input);
  const estimate = estimateTaskDuration({
    operation,
    units: Math.max(1, units),
    conditionBp: bp(paceMachine?.conditionBp ?? 10_000),
    skillBp: bp(worker?.skillBp ?? 5_000),
  });
  const durationGameMs = gameHoursToGameMs(estimate.durationGameHours);
  const definition = powered === undefined ? null : MACHINE_CATALOGUE[powered.type];
  const operatingCost =
    definition === null
      ? Money.ZERO
      : Money.mulGameMs(definition.operatingCostPerGameHour, durationGameMs);
  const wages =
    worker === undefined
      ? Money.ZERO
      : Money.mulGameMs(fromWireMoney(worker.salaryPerGameHour), durationGameMs);
  const produces = operation === 'HARVEST' || operation === 'FELL';
  return ok({
    feasible: blockers.length === 0,
    blockers,
    operation,
    units,
    effectiveWorkSpeedMilli: estimate.effectiveWorkSpeedMilli,
    durationGameHours: estimate.durationGameHours,
    durationGameMs: durationGameMs.toString(),
    scheduledEndGameMs: toWireGameMs(addGameMs(world.nowGameMs, durationGameMs)),
    operatingCost: toWireMoney(operatingCost),
    workerWages: toWireMoney(wages),
    conditionLossBp: Math.round(
      (definition?.wearRateBpPerGameHour ?? 0) * estimate.durationGameHours,
    ),
    expectedProductionUnits: produces ? estimateProduction(world, operation, input) : null,
    reservedStorageUnits: produces ? estimateProduction(world, operation, input) : null,
    overflowUnits: 0,
    atGameMs: toWireGameMs(world.nowGameMs),
  });
}

function estimateProduction(
  world: MockWorld,
  operation: TaskOperation,
  input: TaskRequestBody,
): number {
  if (operation === 'FELL') {
    return world.trees
      .filter(
        (tree) =>
          tree.forestPlotId === input.targetForestPlotId && tree.status === TreeStatus.STANDING,
      )
      .reduce((total, tree) => total + tree.woodVolumeDm3, 0);
  }
  const field = world.fields.find((candidate) => candidate.id === input.targetFieldId);
  return field?.projection.expectedYieldLiters ?? 0;
}

function createTaskReply(server: MockServer, request: MockRequest): MockReply {
  const guard = requireSession(server);
  if (guard !== null) {
    return guard;
  }
  const world = server.world;
  const input = body<TaskRequestBody>(request);
  const operation = input.operation ?? 'PLOW';
  const worker = world.workers.find((candidate) => candidate.id === input.workerId);
  if (worker === undefined) {
    return fail(ValidationCode.NOT_FOUND, { entityKind: 'WORKER', entityId: input.workerId });
  }
  if (worker.status !== WorkerStatus.IDLE) {
    return fail(ValidationCode.WORKER_NOT_IDLE, { entityId: worker.id });
  }
  const machineIds = [input.poweredMachineId, input.implementMachineId].filter(
    (id): id is string => id !== undefined,
  );
  for (const machineId of machineIds) {
    const machine = world.machines.find((candidate) => candidate.id === machineId);
    if (machine === undefined) {
      return fail(ValidationCode.NOT_FOUND, { entityKind: 'MACHINE', entityId: machineId });
    }
    if (machine.status !== MachineStatus.IDLE) {
      return fail(ValidationCode.MACHINE_NOT_IDLE, { entityId: machineId });
    }
    if (machine.conditionBp < MIN_CONDITION_TO_ASSIGN) {
      return fail(ValidationCode.MACHINE_CONDITION_TOO_LOW, {
        entityId: machineId,
        conditionBp: machine.conditionBp,
        minimumConditionBp: MIN_CONDITION_TO_ASSIGN,
      });
    }
  }
  const units = Math.max(1, unitsFor(world, operation, input));
  const paceId = input.implementMachineId ?? input.poweredMachineId;
  const pace = world.machines.find((candidate) => candidate.id === paceId);
  const estimate = estimateTaskDuration({
    operation,
    units,
    conditionBp: bp(pace?.conditionBp ?? 10_000),
    skillBp: bp(worker.skillBp),
  });
  const start = world.nowGameMs;
  const end = addGameMs(start, gameHoursToGameMs(estimate.durationGameHours));
  const task: TaskDto = {
    id: `task-${world.tasks.length + 1}`,
    workerId: worker.id,
    machineIds,
    operation,
    status: TaskStatus.IN_PROGRESS,
    targetFieldId: input.targetFieldId ?? null,
    targetForestPlotId: input.targetForestPlotId ?? null,
    destinationFarmId: input.destinationFarmId ?? null,
    cropId: input.cropId ?? null,
    unitsAtStart: units,
    effectiveWorkSpeedMilli: Math.max(1, estimate.effectiveWorkSpeedMilli),
    reservedStorageUnits:
      operation === 'HARVEST' || operation === 'FELL'
        ? estimateProduction(world, operation, input)
        : null,
    startGameMs: toWireGameMs(start),
    scheduledEndGameMs: toWireGameMs(end),
    endedGameMs: null,
    cancelable: true,
    progressBp: 0,
  };
  world.tasks = [...world.tasks, task];
  reserveFor(server, task);
  server.emit('TASK_UPSERTED', { task });
  return mutation(server, {
    task,
    targetFieldId: task.targetFieldId,
    targetForestPlotId: task.targetForestPlotId,
  });
}

function forestryTaskReply(
  server: MockServer,
  request: MockRequest,
  operation: TaskOperation,
): MockReply {
  const plotId = request.params.forestPlotId;
  const merged: MockRequest = {
    ...request,
    body: {
      ...(request.body as Record<string, unknown>),
      operation,
      ...(plotId === undefined ? {} : { targetForestPlotId: plotId }),
    },
  };
  return createTaskReply(server, merged);
}

/** Marks the worker, the machines and the target as reserved by a task. */
function reserveFor(server: MockServer, task: TaskDto): void {
  const world = server.world;
  world.workers = world.workers.map((worker) =>
    worker.id === task.workerId
      ? { ...worker, status: WorkerStatus.WORKING, currentTaskId: task.id }
      : worker,
  );
  world.machines = world.machines.map((machine) =>
    task.machineIds.includes(machine.id)
      ? { ...machine, status: MachineStatus.WORKING, currentTaskId: task.id }
      : machine,
  );
  const worker = world.workers.find((candidate) => candidate.id === task.workerId);
  if (worker !== undefined) {
    server.emit('WORKER_UPSERTED', { worker });
  }
  for (const machineId of task.machineIds) {
    const machine = world.machines.find((candidate) => candidate.id === machineId);
    if (machine !== undefined) {
      server.emit('MACHINE_UPSERTED', { machine });
    }
  }
  if (task.targetFieldId !== null) {
    world.fields = world.fields.map((field) =>
      field.id === task.targetFieldId
        ? fieldProjectionOf(world, { ...field, currentTaskId: task.id })
        : field,
    );
    const field = world.fields.find((candidate) => candidate.id === task.targetFieldId);
    if (field !== undefined) {
      server.emit('FIELD_UPSERTED', { field, cells: null });
    }
  }
}

/** The inverse of `reserveFor`, applied on cancellation. */
function releaseReservations(server: MockServer, task: TaskDto): void {
  const world = server.world;
  world.workers = world.workers.map((worker) =>
    worker.id === task.workerId
      ? { ...worker, status: WorkerStatus.IDLE, currentTaskId: null }
      : worker,
  );
  world.machines = world.machines.map((machine) =>
    task.machineIds.includes(machine.id)
      ? { ...machine, status: MachineStatus.IDLE, currentTaskId: null }
      : machine,
  );
  const worker = world.workers.find((candidate) => candidate.id === task.workerId);
  if (worker !== undefined) {
    server.emit('WORKER_UPSERTED', { worker });
  }
  for (const machineId of task.machineIds) {
    const machine = world.machines.find((candidate) => candidate.id === machineId);
    if (machine !== undefined) {
      server.emit('MACHINE_UPSERTED', { machine });
    }
  }
  if (task.targetFieldId !== null) {
    world.fields = world.fields.map((field) =>
      field.id === task.targetFieldId
        ? fieldProjectionOf(world, { ...field, currentTaskId: null })
        : field,
    );
    const field = world.fields.find((candidate) => candidate.id === task.targetFieldId);
    if (field !== undefined) {
      server.emit('FIELD_UPSERTED', { field, cells: null });
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Resolves a request against the table. Returns 404 for a path outside the contract. */
export function handleMockRequest(
  server: MockServer,
  method: string,
  url: string,
  bodyText: string | null,
  headers: Readonly<Record<string, string>>,
): MockReply {
  const matched = matchRoute(method, url);
  if (matched === null) {
    return fail(ValidationCode.NOT_FOUND, { field: url });
  }
  const { query } = splitUrl(url);
  let parsed: unknown = undefined;
  if (bodyText !== null && bodyText.length > 0) {
    try {
      parsed = JSON.parse(bodyText) as unknown;
    } catch {
      return fail(ValidationCode.VALIDATION_FAILED, { field: 'body' });
    }
  }
  const handler = MOCK_HANDLERS[matched.routeKey];
  try {
    return handler(server, {
      routeKey: matched.routeKey,
      params: matched.params,
      query,
      body: parsed,
      headers,
    });
  } catch (error) {
    console.error('[mock] el manejador lanzo', matched.routeKey, error);
    return fail(ApiTransportCode.INTERNAL_ERROR);
  }
}
