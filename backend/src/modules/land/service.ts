// The domain of the `land` area: quoting a selection and buying it.
//
// Owner: workflow W4-A. Module `land`.
//
// Two operations that share one rule and differ in everything else. The quote reads and
// mutates nothing; the purchase writes, charges and emits. What they share is the
// validation, and sharing it is the point: `shared/rules/selection.ts` is the very
// function the client calls on every cell boundary crossing while dragging, so the green
// highlight, the figure the panel shows and the refusal of the server come from one
// implementation and cannot drift (plan section 8).
//
// The server never trusts the client (GDD section 54). The quote is advisory: by the time
// the purchase arrives, another player may own a cell of the selection, the terrain may
// have been cleared and the balance may have moved on with the offline accrual. So the
// purchase re-derives everything from the database, inside its own transaction, and the
// figure it charges is the one it computed there and never the one it was sent.
//
// Duplicates are collapsed before anything else. `cellSelectionSchema` says so explicitly
// ("the server deduplicates, because it must be able to do so anyway for a request that
// arrives twice"), and it is not cosmetic: pricing a repeated cell twice would quote a
// total the purchase could never charge, because the unique index on the cell makes the
// second copy acquire nothing.
//
// Buying forest does not materialise trees. A purchase changes ownership and nothing else
// (GDD sections 13 and 14); the trees of a forest appear when the forest plot is created,
// which is the decision of plan section 2.2 and belongs to workflow W6-C.

import { type MutationContext } from '../../lib/advancePlayer.js';
import { type ServiceContext } from '../../lib/context.js';
import { toMoney } from '../../lib/dbMap.js';
import { charge } from '../../lib/ledger.js';
import { buildPlayerDto, toLedgerEntryDto } from '../../lib/playerView.js';
import { type Db } from '../../lib/tx.js';
import {
  ApiError,
  GameEventType,
  LedgerType,
  MAX_ABSOLUTE_CELL_COORDINATE,
  MAX_SELECTION_CELLS,
  Money,
  SelectionPurpose,
  ValidationCode,
  canPurchase,
  cellKey,
  cellPrice,
  insufficientFunds,
  landPurchasePrice,
  multiplyByCount,
  selectionTooLarge,
  toWireMoney,
  validationFailed,
  type CellCoord,
  type LedgerEntry,
  type PlayerId,
  type SelectionCell,
  type SelectionIssue,
  type TerrainType,
  type World,
} from '../../shared/index.js';
import { chunkPatchesFor, claimCells, validateCellSelection } from '../world/service.js';

// ---------------------------------------------------------------------------
// The selection
// ---------------------------------------------------------------------------

/**
 * The selection with every repeated cell collapsed, in the order the cells were first
 * sent, and with the coordinates checked against the keyable range.
 *
 * The range check is not defensive noise. `cellOrdinateSchema` admits any safe integer,
 * while `cellKey` refuses anything beyond 2^25 cells from the origin (ADR-0010), so a
 * coordinate in between would leave the transport as a valid request and arrive here as a
 * `RangeError`, that is as a 500. It is a malformed request and it is reported as one.
 */
export function normaliseSelection(cells: readonly CellCoord[]): readonly CellCoord[] {
  const seen = new Set<number>();
  const unique: CellCoord[] = [];
  for (const cell of cells) {
    if (
      Math.abs(cell.cellX) > MAX_ABSOLUTE_CELL_COORDINATE ||
      Math.abs(cell.cellY) > MAX_ABSOLUTE_CELL_COORDINATE
    ) {
      throw validationFailed('body.cells', { cells: [{ cellX: cell.cellX, cellY: cell.cellY }] });
    }
    const key = cellKey(cell.cellX, cell.cellY);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push({ cellX: cell.cellX, cellY: cell.cellY });
  }
  if (unique.length > MAX_SELECTION_CELLS) {
    // Unreachable through HTTP, because the contract schema caps the array at the same
    // constant. It is stated anyway because this function is also the entry point of the
    // module for a caller inside the process, and because a ceiling that lives in only one
    // of the two layers is a ceiling that moves when somebody edits the other one.
    throw selectionTooLarge(unique.length, MAX_SELECTION_CELLS);
  }
  return unique;
}

// ---------------------------------------------------------------------------
// The quote
// ---------------------------------------------------------------------------

/** One cell of a quote. `price` is non null exactly when `blockedBy` is null. */
export interface QuotedCell extends CellCoord {
  readonly terrain: TerrainType;
  readonly price: Money | null;
  readonly blockedBy: ValidationCode | null;
}

/**
 * What a terrain contributes to the total (GDD section 115). Not part of the wire
 * contract, which carries the terrain and the price of every cell and lets the panel
 * aggregate; it is the aggregate this module asserts in its tests and the shape a future
 * addition to `landQuoteReplySchema` would take.
 */
export interface TerrainSubtotal {
  readonly terrain: TerrainType;
  readonly cellCount: number;
  readonly unitPrice: Money;
  readonly subtotal: Money;
}

export interface LandQuote {
  /** One entry per distinct cell of the request, in the order it was first sent. */
  readonly cells: readonly QuotedCell[];
  readonly purchasableCount: number;
  readonly blockedCount: number;
  /** Price of the purchasable cells only (GDD section 115). */
  readonly total: Money;
  readonly byTerrain: readonly TerrainSubtotal[];
  /** The settled balance, which is what an affordability check compares against. */
  readonly balance: Money;
  readonly affordable: boolean;
  readonly firstBlockedCell: CellCoord | null;
  /** One issue per `ValidationCode`, with its cell count and its first cell. */
  readonly issues: readonly SelectionIssue[];
}

/** Subtotal per terrain over the cells that can actually be bought. */
function subtotalsByTerrain(cells: readonly SelectionCell[]): readonly TerrainSubtotal[] {
  const counts = new Map<TerrainType, number>();
  for (const cell of cells) {
    counts.set(cell.terrain, (counts.get(cell.terrain) ?? 0) + 1);
  }
  const subtotals: TerrainSubtotal[] = [];
  for (const [terrain, cellCount] of counts) {
    const unitPrice = cellPrice(terrain);
    if (unitPrice === null) {
      continue;
    }
    subtotals.push({
      terrain,
      cellCount,
      unitPrice,
      subtotal: multiplyByCount(unitPrice, cellCount),
    });
  }
  return subtotals;
}

/**
 * Budget of a selection, mutating nothing (GDD sections 8, 14 and 115).
 *
 * The route that serves it is declared `advancesPlayer` and not `sequenced`, so the guard
 * of `plugins/routes.ts` has already settled the accruals of this player by the time the
 * body runs. That is what lets `balance` be read from the column instead of projected: the
 * column is the settled value, and it is the same value `charge` will compare the price
 * against inside the purchase transaction (plan section 6.2).
 */
export async function quoteSelection(
  services: ServiceContext,
  db: Db,
  world: World,
  playerId: PlayerId,
  requested: readonly CellCoord[],
): Promise<LandQuote> {
  const cells = normaliseSelection(requested);
  const { cells: loaded, validation } = await validateCellSelection(services, db, world, {
    playerId,
    purpose: SelectionPurpose.PURCHASE,
    cells,
  });

  const quoted: QuotedCell[] = loaded.map((cell) => {
    const blockedBy = canPurchase(cell);
    return {
      cellX: cell.cellX,
      cellY: cell.cellY,
      terrain: cell.terrain,
      // The contract requires `price` to be null exactly when `blockedBy` is not, and the
      // two come from the same pair of shared functions: `canPurchase` refuses a terrain
      // with no price, so a cell that passes it always has one.
      price: blockedBy === null ? cellPrice(cell.terrain) : null,
      blockedBy,
    };
  });

  const purchasable = loaded.filter((cell) => canPurchase(cell) === null);
  const total = landPurchasePrice(purchasable.map((cell) => cell.terrain)).total;
  const player = await db.player.findUniqueOrThrow({
    where: { id: playerId },
    select: { balance: true },
  });
  const balance = toMoney(player.balance);
  const firstBlocked = quoted.find((cell) => cell.blockedBy !== null);

  return {
    cells: quoted,
    purchasableCount: purchasable.length,
    blockedCount: quoted.length - purchasable.length,
    total,
    byTerrain: subtotalsByTerrain(purchasable),
    balance,
    affordable: Money.compare(total, balance) <= 0,
    firstBlockedCell:
      firstBlocked === undefined ? null : { cellX: firstBlocked.cellX, cellY: firstBlocked.cellY },
    issues: validation.issues,
  };
}

// ---------------------------------------------------------------------------
// The purchase
// ---------------------------------------------------------------------------

export interface LandPurchaseInput {
  readonly cells: readonly CellCoord[];
  /**
   * Whether a selection that contains cells that cannot be bought is acceptable. False,
   * the safe default of the contract, refuses the whole request.
   */
  readonly allowPartial: boolean;
  /**
   * The total the client showed the player, or null when it showed none. When it is
   * present it is compared against the figure this transaction actually computed
   * (`docs/handoff/NOTES-W2c.md`, item 1.3).
   */
  readonly expectedTotal: Money | null;
  /** Idempotency key of the ledger entry, derived from the header by the route. */
  readonly idempotencyKey: string;
}

export interface LandPurchaseOutcome {
  readonly purchasedCells: readonly CellCoord[];
  readonly purchasedCount: number;
  /** Distinct cells of the request that were not bought, for whatever reason. */
  readonly skippedCount: number;
  readonly totalPaid: Money;
  readonly balanceAfter: Money;
}

/**
 * Buys the purchasable cells of a selection and charges for exactly those.
 *
 * Runs inside `withPlayerAdvanced`, so the player row is locked, the accruals are settled
 * up to this instant and everything below is one transaction: if any step refuses, no cell
 * changes hands and no money moves.
 *
 * The order of the steps is the design and not a preference:
 *
 *   1. Authoritative revalidation against the database (GDD section 54). The quote the
 *      client holds is advisory and may be stale by seconds.
 *   2. Claiming by conditional update with a row count (plan section 5.4). Two concurrent
 *      buyers of the same cell both write the same row, so PostgreSQL serialises them and
 *      the loser acquires nothing and is told so. The chunk versions move inside the same
 *      call, taken in ascending order of identifier.
 *   3. The price of what was acquired, compared against `expectedTotal`. Comparing after
 *      the claim and not before is what makes one rule cover both a stale quote and a lost
 *      race: in either case the figure differs from the one the player agreed to.
 *   4. The charge, which is itself a conditional update: insufficient funds is a row count
 *      of zero and not an exception, and it aborts the transaction, so the cells claimed in
 *      step 2 are rolled back with it.
 */
export async function purchaseLand(
  ctx: MutationContext,
  input: LandPurchaseInput,
): Promise<LandPurchaseOutcome> {
  const { services, tx, reading } = ctx;
  const world = reading.world;
  const playerId = ctx.lock.playerId;
  const cells = normaliseSelection(input.cells);

  // 1. Revalidation. Never the client's word: `loadSelectionCells` resolves the effective
  //    terrain, the owner and the use of every cell from the database and the generator.
  const { cells: loaded, validation } = await validateCellSelection(services, tx, world, {
    playerId,
    purpose: SelectionPurpose.PURCHASE,
    cells,
  });
  const purchasable = loaded.filter((cell) => canPurchase(cell) === null);

  if (!input.allowPartial && purchasable.length !== loaded.length) {
    throw refusalOf(validation.issues);
  }

  // 2. Claiming. Only the cells that passed the rules are offered to the repository, and
  //    only the ones it returns were actually acquired.
  const claim = await claimCells(
    services,
    tx,
    world,
    playerId,
    purchasable.map((cell) => ({ cellX: cell.cellX, cellY: cell.cellY })),
    reading.atRealMs,
  );

  if (!input.allowPartial && claim.acquired.length !== purchasable.length) {
    // The selection validated and something took a cell between the validation and the
    // claim. With `allowPartial` false the player agreed to buy the whole selection, so the
    // honest answer is the conflict and not a smaller purchase.
    const contested = claim.refused[0];
    throw new ApiError(
      ValidationCode.CELL_ALREADY_OWNED,
      contested === undefined ? {} : { cells: [contested] },
    );
  }

  // 3. The price of what was really acquired (GDD section 115).
  const terrainOf = new Map<number, TerrainType>();
  for (const cell of loaded) {
    terrainOf.set(cellKey(cell.cellX, cell.cellY), cell.terrain);
  }
  const acquiredTerrains: TerrainType[] = [];
  for (const cell of claim.acquired) {
    const terrain = terrainOf.get(cellKey(cell.cellX, cell.cellY));
    if (terrain === undefined) {
      // Unreachable: every acquired cell was offered, and every offered cell was loaded.
      throw new Error(`Sin terreno cargado para la celda (${cell.cellX}, ${cell.cellY})`);
    }
    acquiredTerrains.push(terrain);
  }
  const total = landPurchasePrice(acquiredTerrains).total;

  if (input.expectedTotal !== null && Money.compare(total, input.expectedTotal) !== 0) {
    // `expected` is the authoritative figure of the server and `actual` what the request
    // carried, which is the criterion `shared/api/errors.ts` states and the one the machinery
    // routes already followed. This route had the two the other way round, so a panel that
    // composed "expected X, got Y" from them said it backwards on one of the two routes
    // (`docs/revision-alcance.md`, O1).
    throw validationFailed('body.expectedTotal', {
      expected: Money.toString(total),
      actual: Money.toString(input.expectedTotal),
    });
  }

  // 4. The charge. Skipped when nothing was acquired, so a selection that turned out to be
  //    entirely unavailable leaves no zero valued entry behind in the ledger.
  let entry: LedgerEntry | null = null;
  let balanceAfter: Money;
  if (Money.isZero(total)) {
    const player = await tx.player.findUniqueOrThrow({
      where: { id: playerId },
      select: { balance: true },
    });
    balanceAfter = toMoney(player.balance);
  } else {
    const charged = await charge(tx, ctx.lock, {
      type: LedgerType.LAND_PURCHASE,
      amount: total,
      atGameMs: reading.gameNow,
      atRealMs: reading.atRealMs,
      idempotencyKey: input.idempotencyKey,
      refType: 'LAND',
      refId: null,
      meta: { cells: claim.acquired.length, gddSection: 115 },
    });
    if (!charged.ok) {
      throw insufficientFunds(toWireMoney(charged.required), toWireMoney(charged.available));
    }
    entry = charged.entry;
    balanceAfter = charged.balanceAfter;
    services.metrics.ledgerEntries.inc({ type: LedgerType.LAND_PURCHASE });
  }

  // 5. The frames, in the order the contract declares them for this route.
  if (claim.acquired.length > 0) {
    const patches = await chunkPatchesFor(services, tx, world, claim.touchedChunks);
    for (const patch of patches) {
      if (patch.cells.length === 0) {
        continue;
      }
      ctx.emit({ type: GameEventType.CHUNK_PATCHED, payload: patch });
    }
    ctx.emit({
      type: GameEventType.PLAYER_UPSERTED,
      payload: { player: await buildPlayerDto(tx, playerId, reading) },
    });
  }
  if (entry !== null) {
    ctx.emit({
      type: GameEventType.LEDGER_APPENDED,
      payload: { entries: [toLedgerEntryDto(entry)], balance: toWireMoney(balanceAfter) },
    });
  }

  return {
    purchasedCells: claim.acquired,
    purchasedCount: claim.acquired.length,
    // Relative to the deduplicated selection, so that `purchasedCount + skippedCount` is
    // the number of distinct cells the request named.
    skippedCount: cells.length - claim.acquired.length,
    totalPaid: total,
    balanceAfter,
  };
}

/**
 * The refusal of a whole selection, taken from the aggregated issues.
 *
 * The first issue is the most explanatory one by construction: `validateSelection` puts the
 * whole selection rules before the per cell ones, and the per cell ones in the order they
 * were first met. Its first cell travels in `details.cells`, which is what lets the panel
 * move the camera to the conflict instead of listing two thousand identical errors.
 */
function refusalOf(issues: readonly SelectionIssue[]): ApiError {
  const first = issues[0];
  if (first === undefined) {
    // Unreachable: this is only called when at least one cell failed its rule.
    return new ApiError(ValidationCode.VALIDATION_FAILED);
  }
  return new ApiError(first.code, first.firstCell === null ? {} : { cells: [first.firstCell] });
}
