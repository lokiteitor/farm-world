// Acceptance of valid payloads and rejection of representative malformed ones.
//
// Owner: workflow W2 (API contract).
//
// The malformed cases are chosen, not exhaustive. Each one stands for a class of mistake
// a real client makes: a field of the wrong shape, a field that belongs to another
// operation, a selection above the shared ceiling, an unknown member of a closed set, and
// an extra key that a permissive schema would have silently dropped. The last class is
// why every object of the contract is strict: dropping an unknown key turns a renamed
// field into a silent default instead of an error.

import { describe, expect, it } from 'vitest';
import { MAX_SELECTION_CELLS } from '../../config/world.js';
import { apiErrorSchema, ApiTransportCode, apiErrorBody } from '../errors.js';
import { loginBodySchema, registerBodySchema, sessionReplySchema } from '../schemas/auth.js';
import { cellSelectionSchema, MAX_CHUNKS_PER_REQUEST } from '../schemas/common.js';
import { ledgerQuerySchema, sellBodySchema } from '../schemas/economy.js';
import { placeBuildingBodySchema } from '../schemas/farms.js';
import { createFieldBodySchema, mergeFieldsBodySchema } from '../schemas/fields.js';
import { createForestPlotBodySchema } from '../schemas/forestry.js';
import { landPurchaseBodySchema, landQuoteReplySchema } from '../schemas/land.js';
import { buyMachineBodySchema } from '../schemas/machinery.js';
import { snapshotReplySchema } from '../schemas/state.js';
import { agriculturalTaskRequestSchema, taskRequestSchema } from '../schemas/tasks.js';
import { hireWorkerBodySchema } from '../schemas/workers.js';
import { chunkBatchBodySchema, worldInfoReplySchema } from '../schemas/world.js';
import {
  AT_GAME_MS,
  buildingFixture,
  cellRun,
  clockFixture,
  farmFixture,
  fieldFixture,
  forestPlotFixture,
  inventoryFarmFixture,
  machineFixture,
  maximumSelection,
  noticeFixture,
  oversizedSelection,
  playerFixture,
  taskFixture,
  workerCandidateFixture,
  workerFixture,
} from './fixtures.js';

const worldInfoFixture = {
  worldId: 'wld_000000000001',
  seed: 1_234_567,
  generatorVersion: 1,
  chunkSize: 32,
  cellSizeM: 10,
  cellPx: 16,
  maxSelectionCells: MAX_SELECTION_CELLS,
  contractVersion: '0.1.0',
  clock: clockFixture,
  spawnCellX: 1200,
  spawnCellY: -340,
};

describe('selection bodies', () => {
  it('accepts a selection exactly at the shared ceiling', () => {
    expect(cellSelectionSchema.safeParse({ cells: maximumSelection }).success).toBe(true);
  });

  it('rejects an empty selection and one above the ceiling', () => {
    expect(cellSelectionSchema.safeParse({ cells: [] }).success).toBe(false);
    expect(cellSelectionSchema.safeParse({ cells: oversizedSelection }).success).toBe(false);
  });

  it('applies the ceiling to every route that takes a selection', () => {
    const oversized = oversizedSelection;
    expect(
      landPurchaseBodySchema.safeParse({ cells: oversized, allowPartial: false }).success,
    ).toBe(false);
    expect(
      createFieldBodySchema.safeParse({ name: 'Campo', farmId: null, cells: oversized }).success,
    ).toBe(false);
    expect(
      createForestPlotBodySchema.safeParse({ name: 'Pinar', farmId: null, cells: oversized })
        .success,
    ).toBe(false);
  });

  it('rejects a cell coordinate that is not an integer', () => {
    expect(cellSelectionSchema.safeParse({ cells: [{ cellX: 1.5, cellY: 0 }] }).success).toBe(
      false,
    );
  });

  it('rejects an unknown key inside a cell', () => {
    expect(cellSelectionSchema.safeParse({ cells: [{ cellX: 1, cellY: 0, z: 0 }] }).success).toBe(
      false,
    );
  });
});

describe('land bodies', () => {
  it('accepts a purchase with and without the expected total', () => {
    const cells = cellRun(3);
    expect(landPurchaseBodySchema.safeParse({ cells, allowPartial: false }).success).toBe(true);
    expect(
      landPurchaseBodySchema.safeParse({ cells, allowPartial: true, expectedTotal: '360.0000' })
        .success,
    ).toBe(true);
  });

  it('rejects a purchase whose expected total is a number', () => {
    expect(
      landPurchaseBodySchema.safeParse({
        cells: cellRun(1),
        allowPartial: false,
        expectedTotal: 360,
      }).success,
    ).toBe(false);
  });

  it('rejects a purchase that omits the partial flag', () => {
    // The flag is deliberately required: the two behaviours are both legitimate and the
    // server must not guess which one the player was shown.
    expect(landPurchaseBodySchema.safeParse({ cells: cellRun(1) }).success).toBe(false);
  });

  it('accepts a quote reply that reports a blocked cell with a code and no price', () => {
    const reply = {
      cells: [
        { cellX: 0, cellY: 0, terrain: 'GRASS', price: '120.0000', blockedBy: null },
        { cellX: 1, cellY: 0, terrain: 'WATER', price: null, blockedBy: 'TERRAIN_NOT_PURCHASABLE' },
      ],
      purchasableCount: 1,
      blockedCount: 1,
      total: '120.0000',
      balance: '160000.0000',
      affordable: true,
      firstBlockedCell: { cellX: 1, cellY: 0 },
    };
    expect(landQuoteReplySchema.safeParse(reply).success).toBe(true);
  });

  it('rejects a quote reply whose blocking reason is not a known code', () => {
    const reply = {
      cells: [{ cellX: 0, cellY: 0, terrain: 'GRASS', price: null, blockedBy: 'BECAUSE' }],
      purchasableCount: 0,
      blockedCount: 1,
      total: '0.0000',
      balance: '0.0000',
      affordable: false,
      firstBlockedCell: null,
    };
    expect(landQuoteReplySchema.safeParse(reply).success).toBe(false);
  });
});

describe('task requests', () => {
  const base = { workerId: 'wrk_1', poweredMachineId: 'mch_1' };

  it('accepts each of the four agricultural operations with its own fields', () => {
    expect(
      agriculturalTaskRequestSchema.safeParse({
        operation: 'PLOW',
        ...base,
        implementMachineId: 'mch_2',
        targetFieldId: 'fld_1',
      }).success,
    ).toBe(true);
    expect(
      agriculturalTaskRequestSchema.safeParse({
        operation: 'SEED',
        ...base,
        implementMachineId: 'mch_2',
        targetFieldId: 'fld_1',
        cropId: 'WHEAT',
      }).success,
    ).toBe(true);
    expect(
      agriculturalTaskRequestSchema.safeParse({
        operation: 'HARVEST',
        ...base,
        implementMachineId: 'mch_2',
        targetFieldId: 'fld_1',
        destinationFarmId: 'frm_1',
      }).success,
    ).toBe(true);
  });

  it('rejects sowing without a crop, which check six of GDD section 104 demands', () => {
    expect(
      agriculturalTaskRequestSchema.safeParse({
        operation: 'SEED',
        ...base,
        implementMachineId: 'mch_2',
        targetFieldId: 'fld_1',
      }).success,
    ).toBe(false);
  });

  it('rejects a crop on an operation that takes none', () => {
    expect(
      agriculturalTaskRequestSchema.safeParse({
        operation: 'PLOW',
        ...base,
        implementMachineId: 'mch_2',
        targetFieldId: 'fld_1',
        cropId: 'WHEAT',
      }).success,
    ).toBe(false);
  });

  it('rejects plowing without an implement, which the compatibility table demands', () => {
    expect(
      agriculturalTaskRequestSchema.safeParse({
        operation: 'PLOW',
        ...base,
        targetFieldId: 'fld_1',
      }).success,
    ).toBe(false);
  });

  it('rejects a harvest that names no destination for the produce', () => {
    expect(
      agriculturalTaskRequestSchema.safeParse({
        operation: 'HARVEST',
        ...base,
        implementMachineId: 'mch_2',
        targetFieldId: 'fld_1',
      }).success,
    ).toBe(false);
  });

  it('rejects a forestry operation on the agricultural route', () => {
    const fell = {
      operation: 'FELL',
      ...base,
      targetForestPlotId: 'fpl_1',
      destinationFarmId: 'frm_1',
    };
    expect(agriculturalTaskRequestSchema.safeParse(fell).success).toBe(false);
    // The estimate accepts all seven, because it computes and mutates nothing.
    expect(taskRequestSchema.safeParse(fell).success).toBe(true);
  });

  it('rejects a field as the target of a felling and a plot as the target of a plowing', () => {
    expect(
      taskRequestSchema.safeParse({
        operation: 'FELL',
        ...base,
        targetFieldId: 'fld_1',
        destinationFarmId: 'frm_1',
      }).success,
    ).toBe(false);
    expect(
      taskRequestSchema.safeParse({
        operation: 'PLOW',
        ...base,
        implementMachineId: 'mch_2',
        targetForestPlotId: 'fpl_1',
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown operation', () => {
    expect(
      taskRequestSchema.safeParse({ operation: 'FERTILIZE', ...base, targetFieldId: 'fld_1' })
        .success,
    ).toBe(false);
  });

  it('rejects replanting without cells and clearing without cells', () => {
    expect(
      taskRequestSchema.safeParse({ operation: 'REPLANT', ...base, targetForestPlotId: 'fpl_1' })
        .success,
    ).toBe(false);
    expect(
      taskRequestSchema.safeParse({ operation: 'CLEAR_LAND', ...base, implementMachineId: 'mch_2' })
        .success,
    ).toBe(false);
  });
});

describe('other request bodies', () => {
  it('rejects a registration with a malformed address or a short password', () => {
    expect(
      registerBodySchema.safeParse({
        email: 'no-arroba',
        password: 'contrasena-larga',
        displayName: 'Ana',
      }).success,
    ).toBe(false);
    expect(
      registerBodySchema.safeParse({
        email: 'ana@example.com',
        password: 'corta',
        displayName: 'Ana',
      }).success,
    ).toBe(false);
    expect(
      registerBodySchema.safeParse({
        email: 'ana@example.com',
        password: 'contrasena-larga',
        displayName: 'Ana',
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown key in a login body', () => {
    expect(
      loginBodySchema.safeParse({
        email: 'ana@example.com',
        password: 'contrasena-larga',
        remember: true,
      }).success,
    ).toBe(false);
  });

  it('rejects a chunk batch that is empty or above the transport limit', () => {
    expect(chunkBatchBodySchema.safeParse({ chunks: [] }).success).toBe(false);
    const many = Array.from({ length: MAX_CHUNKS_PER_REQUEST + 1 }, (_value, index) => ({
      chunkX: index,
      chunkY: 0,
    }));
    expect(chunkBatchBodySchema.safeParse({ chunks: many }).success).toBe(false);
    expect(
      chunkBatchBodySchema.safeParse({ chunks: [{ chunkX: 0, chunkY: 0, rev: 3 }] }).success,
    ).toBe(true);
  });

  it('rejects a building placement with an unknown type and accepts the wood store', () => {
    expect(
      placeBuildingBodySchema.safeParse({
        type: 'BARN',
        originCellX: 0,
        originCellY: 0,
        purchaseFootprintLand: false,
      }).success,
    ).toBe(false);
    expect(
      placeBuildingBodySchema.safeParse({
        type: 'WOOD_STORAGE',
        originCellX: 0,
        originCellY: 0,
        purchaseFootprintLand: true,
      }).success,
    ).toBe(true);
  });

  it('rejects a machine purchase with an unknown type', () => {
    expect(buyMachineBodySchema.safeParse({ farmId: 'frm_1', type: 'DRONE' }).success).toBe(false);
    expect(
      buyMachineBodySchema.safeParse({ farmId: 'frm_1', type: 'HARVESTER_FORESTRY' }).success,
    ).toBe(true);
  });

  it('rejects a sale of a quantity that is not positive', () => {
    expect(
      sellBodySchema.safeParse({ farmId: 'frm_1', resource: 'WHEAT_LITERS', quantityUnits: 0 })
        .success,
    ).toBe(false);
    expect(
      sellBodySchema.safeParse({ farmId: 'frm_1', resource: 'WHEAT_LITERS', quantityUnits: -5 })
        .success,
    ).toBe(false);
    // Omitting the quantity sells the whole free stock, which is a distinct request.
    expect(sellBodySchema.safeParse({ farmId: 'frm_1', resource: 'WOOD_M3' }).success).toBe(true);
  });

  it('rejects a merge of fewer than two fields', () => {
    expect(mergeFieldsBodySchema.safeParse({ name: 'Campo', fieldIds: ['fld_1'] }).success).toBe(
      false,
    );
    expect(
      mergeFieldsBodySchema.safeParse({ name: 'Campo', fieldIds: ['fld_1', 'fld_2'] }).success,
    ).toBe(true);
  });

  it('rejects a hire with an empty candidate identifier', () => {
    expect(hireWorkerBodySchema.safeParse({ candidateId: '', farmId: 'frm_1' }).success).toBe(
      false,
    );
  });

  it('coerces a query page size and rejects one above the maximum', () => {
    const parsed = ledgerQuerySchema.parse({ limit: '25' });
    expect(parsed.limit).toBe(25);
    expect(ledgerQuerySchema.parse({}).limit).toBe(50);
    expect(ledgerQuerySchema.safeParse({ limit: '1000' }).success).toBe(false);
    expect(ledgerQuerySchema.safeParse({ limit: 'muchos' }).success).toBe(false);
  });
});

describe('replies', () => {
  it('accepts the world description', () => {
    expect(worldInfoReplySchema.safeParse(worldInfoFixture).success).toBe(true);
  });

  it('accepts a session reply built from the player fixture', () => {
    const reply = {
      accessToken: 'a'.repeat(32),
      accessTokenExpiresInRealMs: 900_000,
      accessTokenExpiresAtRealMs: '1700000900000',
      playerId: playerFixture.id,
      worldId: worldInfoFixture.worldId,
      player: playerFixture,
      clock: clockFixture,
      firstSession: true,
    };
    expect(sessionReplySchema.safeParse(reply).success).toBe(true);
  });

  it('accepts a full snapshot assembled from every read model', () => {
    const snapshot = {
      seq: playerFixture.eventSeq,
      atGameMs: AT_GAME_MS,
      world: worldInfoFixture,
      player: playerFixture,
      farms: [farmFixture],
      buildings: [buildingFixture],
      fields: [fieldFixture],
      fieldCells: [{ fieldId: fieldFixture.id, cells: cellRun(4) }],
      machines: [machineFixture],
      workers: [workerFixture],
      laborPool: {
        candidates: [workerCandidateFixture],
        nextRefreshAtGameMs: '172800000',
      },
      tasks: [taskFixture],
      forestPlots: [forestPlotFixture],
      forestPlotCells: [{ forestPlotId: forestPlotFixture.id, cells: cellRun(4, 100) }],
      inventory: [inventoryFarmFixture],
      notices: [noticeFixture],
      welcomeBackPending: false,
    };
    const result = snapshotReplySchema.safeParse(snapshot);
    expect(result.success ? null : result.error.issues).toBe(null);
  });

  it('rejects a snapshot whose player balance is a number', () => {
    const snapshot = {
      seq: 0,
      atGameMs: AT_GAME_MS,
      world: worldInfoFixture,
      player: { ...playerFixture, balance: 160_000 },
      farms: [],
      buildings: [],
      fields: [],
      fieldCells: [],
      machines: [],
      workers: [],
      laborPool: { candidates: [], nextRefreshAtGameMs: null },
      tasks: [],
      forestPlots: [],
      forestPlotCells: [],
      inventory: [],
      notices: [],
      welcomeBackPending: false,
    };
    expect(snapshotReplySchema.safeParse(snapshot).success).toBe(false);
  });
});

describe('error bodies', () => {
  it('accepts a domain code and a transport code in the same field', () => {
    expect(apiErrorSchema.safeParse(apiErrorBody('GARAGE_CAPACITY_EXCEEDED')).success).toBe(true);
    expect(
      apiErrorSchema.safeParse(apiErrorBody(ApiTransportCode.IDEMPOTENCY_KEY_REQUIRED)).success,
    ).toBe(true);
  });

  it('accepts the well known keys of the details and keeps unknown ones', () => {
    const body = apiErrorBody('INSUFFICIENT_FUNDS', {
      requiredMoney: '18000.0000',
      availableMoney: '1200.5000',
      hint: 'vender trigo',
    });
    const parsed = apiErrorSchema.parse(body);
    expect(parsed.details?.requiredMoney).toBe('18000.0000');
    expect(parsed.details?.hint).toBe('vender trigo');
  });

  it('rejects an unknown code and a missing message', () => {
    expect(apiErrorSchema.safeParse({ code: 'KABOOM', message: 'x' }).success).toBe(false);
    expect(apiErrorSchema.safeParse({ code: 'NOT_FOUND' }).success).toBe(false);
    expect(apiErrorSchema.safeParse({ code: 'NOT_FOUND', message: '' }).success).toBe(false);
  });
});
