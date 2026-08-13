// `POST /api/land/purchase`: the canonical money moving route of the contract.
//
// Owner: workflow W4-A. Module `land`.
//
// The cases below are the ones the design of the module rests on, and every one of them is
// a way the purchase could be wrong without any test failing:
//
//   - The figure. 330 grass cells charge exactly 39 600 (GDD sections 115 and 117), and the
//     ledger entry, the balance and the reply all agree on it.
//   - The refusals: mountain and water, a cell that is already owned, a selection above the
//     shared ceiling, insufficient funds, and a stale `expectedTotal`.
//   - The race. Two buyers of the same cell: exactly one acquires it and only one is
//     charged, which is the conditional update with a row count of plan section 5.4.
//   - The chunk version moves once per purchase, however many cells of that chunk it bought.
//   - The frame reaches a real WebSocket, over the real ticket, the real channel and the
//     real socket.
//   - The ledger still adds up to the balance, which is the invariant of ADR-0009.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ClockReading } from '../../lib/gameClock.js';
import { auditBalance } from '../../lib/ledger.js';
import { withPlainTransaction } from '../../lib/tx.js';
import { cellRepositoryOf } from '../../modules/world/cellRepo.js';
import { claimCells } from '../../modules/world/service.js';
import {
  GameEventType,
  LandUse,
  LedgerType,
  MAX_SELECTION_CELLS,
  Money,
  TerrainType,
  ValidationCode,
  WS_PATH,
  chunkOf,
  type CellCoord,
  type PlayerId,
  type World,
} from '../../shared/index.js';
import { bearer, createHarness, registerViaHttp, type Harness } from '../harness.js';
import {
  balanceOf,
  clearGrid,
  errorCode,
  findCellsOfTerrain,
  mutationResult,
  postPurchase,
} from './fixtures.js';

let harness: Harness;
let reading: ClockReading;
let world: World;
let playerId: PlayerId;
let accessToken: string;

/** Chunk rows this file owns, one band per case so no two cases contend by accident. */
const BAND = {
  BULK: 600,
  MOUNTAIN: 605,
  WATER: 610,
  OWNED: 615,
  FUNDS: 620,
  EXPECTED: 625,
  RACE: 630,
  VERSION: 635,
  SOCKET: 640,
  PARTIAL: 645,
} as const;

beforeAll(async () => {
  harness = await createHarness();
  reading = await harness.services.clock.read();
  world = reading.world;
  const player = await registerViaHttp(harness, 'land-purchase');
  playerId = player.playerId;
  accessToken = player.accessToken;
});

afterAll(async () => {
  await clearGrid(harness, world);
  await harness.teardown();
});

describe('la compra de tierra', () => {
  it('compra 330 celdas de pradera y descuenta exactamente 330 x 120 (GDD 115 y 117)', async () => {
    const cells = await findCellsOfTerrain(harness, world, TerrainType.GRASS, 330, {
      chunkY: BAND.BULK,
    });
    const before = await balanceOf(harness, playerId);
    const expected = Money.toString(Money.fromUnits(39_600));

    const { statusCode, body } = await postPurchase(harness, accessToken, { cells });
    expect(statusCode).toBe(200);

    const result = mutationResult(body);
    expect(result['purchasedCount']).toBe(330);
    expect(result['skippedCount']).toBe(0);
    expect(result['totalPaid']).toBe(expected);
    expect(typeof body['seq']).toBe('number');
    expect(typeof body['atGameMs']).toBe('string');

    // The reply, the column and the entry all agree on the same figure.
    const after = await balanceOf(harness, playerId);
    expect(result['balanceAfter']).toBe(after);
    expect(Money.toString(Money.sub(before, after))).toBe(expected);

    const entry = await harness.prisma.ledgerEntry.findFirst({
      where: { playerId, type: LedgerType.LAND_PURCHASE },
      orderBy: { seq: 'desc' },
    });
    expect(entry).not.toBeNull();
    expect(Money.toString(Money.fromString(entry?.amount.toString() ?? '0'))).toBe(
      Money.toString(Money.negate(Money.fromUnits(39_600))),
    );

    // Buying changes ownership and nothing else: no field is created (GDD sections 13, 14).
    const owned = await harness.prisma.worldCell.count({
      where: { worldId: world.id, ownerPlayerId: playerId, landUse: LandUse.OWNED },
    });
    expect(owned).toBeGreaterThanOrEqual(330);
    expect(await harness.prisma.field.count({ where: { playerId } })).toBe(0);
  });

  it('no materializa arboles al comprar bosque (plan 2.2)', async () => {
    const cells = await findCellsOfTerrain(harness, world, TerrainType.FOREST, 12, {
      chunkY: BAND.BULK,
      fromChunkX: 40,
    });
    const { statusCode, body } = await postPurchase(harness, accessToken, { cells });
    expect(statusCode).toBe(200);
    expect(mutationResult(body)['totalPaid']).toBe(Money.toString(Money.fromUnits(840)));
    // The trees appear when the forest plot is created, which is workflow W6-C.
    expect(await harness.prisma.tree.count({ where: { worldId: world.id } })).toBe(0);
  });

  it('rechaza la montana y el agua con TERRAIN_NOT_PURCHASABLE (GDD 8, 11 y 12)', async () => {
    for (const terrain of [TerrainType.MOUNTAIN, TerrainType.WATER] as const) {
      const cells = await findCellsOfTerrain(harness, world, terrain, 3, {
        chunkY: terrain === TerrainType.MOUNTAIN ? BAND.MOUNTAIN : BAND.WATER,
      });
      const before = await balanceOf(harness, playerId);
      const { statusCode, body } = await postPurchase(harness, accessToken, { cells });

      expect(statusCode).toBe(409);
      expect(errorCode(body)).toBe(ValidationCode.TERRAIN_NOT_PURCHASABLE);
      expect(await balanceOf(harness, playerId)).toBe(before);
      const first = cells[0] as CellCoord;
      expect(
        await harness.prisma.worldCell.count({
          where: { worldId: world.id, cellX: first.cellX, cellY: first.cellY },
        }),
      ).toBe(0);
    }
  });

  it('rechaza una celda que ya es del jugador y no la revende', async () => {
    const cells = await findCellsOfTerrain(harness, world, TerrainType.GRASS, 2, {
      chunkY: BAND.OWNED,
    });
    const first = await postPurchase(harness, accessToken, { cells });
    expect(first.statusCode).toBe(200);
    const balance = await balanceOf(harness, playerId);

    const second = await postPurchase(harness, accessToken, { cells });
    expect(second.statusCode).toBe(409);
    expect(errorCode(second.body)).toBe(ValidationCode.CELL_ALREADY_OWNED);
    expect(await balanceOf(harness, playerId)).toBe(balance);
  });

  it('rechaza una seleccion por encima del tope de celdas', async () => {
    const cells: CellCoord[] = Array.from(
      { length: MAX_SELECTION_CELLS + 1 },
      (_unused, index) => ({ cellX: index, cellY: BAND.BULK * world.chunkSize }),
    );
    const { statusCode, body } = await postPurchase(harness, accessToken, { cells });
    expect(statusCode).toBe(400);
    expect(errorCode(body)).toBe(ValidationCode.VALIDATION_FAILED);
  });

  it('rechaza por fondos insuficientes y no reclama ninguna celda', async () => {
    const buyer = await registerViaHttp(harness, 'land-broke');
    // The settled balance is what an affordability check compares against, so it is moved
    // through the ledger and not by writing the column (ADR-0009).
    await harness.prisma.player.update({
      where: { id: buyer.playerId },
      data: { balance: '100.0000' },
    });

    const cells = await findCellsOfTerrain(harness, world, TerrainType.GRASS, 5, {
      chunkY: BAND.FUNDS,
    });
    const { statusCode, body } = await postPurchase(harness, buyer.accessToken, { cells });

    expect(statusCode).toBe(402);
    expect(errorCode(body)).toBe(ValidationCode.INSUFFICIENT_FUNDS);
    // The charge is a conditional update inside the same transaction, so its refusal rolls
    // back the cells the claim had already taken.
    expect(
      await harness.prisma.worldCell.count({
        where: { worldId: world.id, ownerPlayerId: buyer.playerId },
      }),
    ).toBe(0);
    expect(await balanceOf(harness, buyer.playerId)).toBe(Money.fromUnits(100));
  });

  it('rechaza un expectedTotal desfasado, con la cifra esperada y la real', async () => {
    const cells = await findCellsOfTerrain(harness, world, TerrainType.GRASS, 4, {
      chunkY: BAND.EXPECTED,
    });
    const before = await balanceOf(harness, playerId);

    const stale = await postPurchase(harness, accessToken, {
      cells,
      // What the panel would have shown before somebody else bought a cell of the drag.
      expectedTotal: Money.toString(Money.fromUnits(600)),
    });
    expect(stale.statusCode).toBe(400);
    expect(errorCode(stale.body)).toBe(ValidationCode.VALIDATION_FAILED);
    const details = (stale.body['error'] as Record<string, unknown>)['details'] as Record<
      string,
      unknown
    >;
    // `expected` es la cifra autoritativa del servidor y `actual` la que traia la peticion,
    // que es el criterio de `shared/api/errors.ts` y el que ya seguian maquinaria y granjas.
    // Esta ruta los llevaba al reves (docs/revision-alcance.md, O1).
    expect(details['expected']).toBe(Money.toString(Money.fromUnits(480)));
    expect(details['actual']).toBe(Money.toString(Money.fromUnits(600)));
    expect(await balanceOf(harness, playerId)).toBe(before);

    // The same request with the right figure goes through: the check is on the number and
    // not on the presence of the field.
    const honoured = await postPurchase(harness, accessToken, {
      cells,
      expectedTotal: Money.toString(Money.fromUnits(480)),
    });
    expect(honoured.statusCode).toBe(200);
    expect(mutationResult(honoured.body)['totalPaid']).toBe(Money.toString(Money.fromUnits(480)));
  });

  it('dos compras concurrentes de la misma celda: gana exactamente una y solo esa paga', async () => {
    const left = await registerViaHttp(harness, 'land-race-left');
    const right = await registerViaHttp(harness, 'land-race-right');
    const cells = await findCellsOfTerrain(harness, world, TerrainType.GRASS, 1, {
      chunkY: BAND.RACE,
    });
    const cell = cells[0] as CellCoord;
    const before = {
      left: await balanceOf(harness, left.playerId),
      right: await balanceOf(harness, right.playerId),
    };

    const [first, second] = await Promise.all([
      postPurchase(harness, left.accessToken, { cells: [cell] }),
      postPurchase(harness, right.accessToken, { cells: [cell] }),
    ]);

    const statuses = [first.statusCode, second.statusCode].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    // Exactly one row, and its owner is the one that paid.
    const rows = await harness.prisma.worldCell.findMany({
      where: { worldId: world.id, cellX: cell.cellX, cellY: cell.cellY },
      select: { ownerPlayerId: true },
    });
    expect(rows).toHaveLength(1);
    const owner = rows[0]?.ownerPlayerId;
    expect([left.playerId, right.playerId]).toContain(owner);

    const paid = {
      left: Money.sub(before.left, await balanceOf(harness, left.playerId)),
      right: Money.sub(before.right, await balanceOf(harness, right.playerId)),
    };
    const cellPrice = Money.fromUnits(120);
    expect(Money.toString(Money.add(paid.left, paid.right))).toBe(Money.toString(cellPrice));
    expect(Money.toString(owner === left.playerId ? paid.left : paid.right)).toBe(
      Money.toString(cellPrice),
    );

    // And no double charge: one LAND_PURCHASE entry between the two of them.
    const entries = await harness.prisma.ledgerEntry.count({
      where: { playerId: { in: [left.playerId, right.playerId] }, type: LedgerType.LAND_PURCHASE },
    });
    expect(entries).toBe(1);
  });

  it('sube la version del chunk una sola vez por compra', async () => {
    const repository = cellRepositoryOf(harness.services);
    const cells = await findCellsOfTerrain(harness, world, TerrainType.GRASS, 8, {
      chunkY: BAND.VERSION,
    });
    const chunk = chunkOf(
      (cells[0] as CellCoord).cellX,
      (cells[0] as CellCoord).cellY,
      world.chunkSize,
    );
    const sameChunk = cells.filter((cell) => {
      const owner = chunkOf(cell.cellX, cell.cellY, world.chunkSize);
      return owner.chunkX === chunk.chunkX && owner.chunkY === chunk.chunkY;
    });
    expect(sameChunk.length).toBeGreaterThan(1);

    const versionsBefore = await repository.chunkVersions(harness.prisma, world.id, [chunk]);
    const before = versionsBefore.get(`${chunk.chunkX}:${chunk.chunkY}`) ?? 0;

    const { statusCode } = await postPurchase(harness, accessToken, { cells: sameChunk });
    expect(statusCode).toBe(200);

    const versionsAfter = await repository.chunkVersions(harness.prisma, world.id, [chunk]);
    // One increment for the whole purchase, not one per cell: the renderer applies one
    // `CHUNK_PATCHED` per chunk and the gap rule is per chunk (ADR-0019, point 3).
    expect(versionsAfter.get(`${chunk.chunkX}:${chunk.chunkY}`)).toBe(before + 1);
  });

  it('compra parcialmente cuando allowPartial lo permite y cobra solo lo adquirido', async () => {
    const grass = await findCellsOfTerrain(harness, world, TerrainType.GRASS, 3, {
      chunkY: BAND.PARTIAL,
    });
    const water = await findCellsOfTerrain(harness, world, TerrainType.WATER, 2, {
      chunkY: BAND.PARTIAL,
    });
    const before = await balanceOf(harness, playerId);

    const { statusCode, body } = await postPurchase(harness, accessToken, {
      cells: [...grass, ...water],
      allowPartial: true,
    });
    expect(statusCode).toBe(200);

    const result = mutationResult(body);
    expect(result['purchasedCount']).toBe(3);
    expect(result['skippedCount']).toBe(2);
    expect(result['totalPaid']).toBe(Money.toString(Money.fromUnits(360)));
    expect(Money.toString(Money.sub(before, await balanceOf(harness, playerId)))).toBe(
      Money.toString(Money.fromUnits(360)),
    );

    // The water cells were never claimed.
    for (const cell of water) {
      expect(
        await harness.prisma.worldCell.count({
          where: { worldId: world.id, cellX: cell.cellX, cellY: cell.cellY },
        }),
      ).toBe(0);
    }
  });

  it('exige la cabecera de idempotencia y reproduce la respuesta almacenada', async () => {
    const cells = await findCellsOfTerrain(harness, world, TerrainType.GRASS, 2, {
      chunkY: BAND.PARTIAL,
      fromChunkX: 30,
    });
    const missing = await harness.app.inject({
      method: 'POST',
      url: '/api/land/purchase',
      headers: bearer(accessToken),
      payload: { cells, allowPartial: false },
    });
    expect(missing.statusCode).toBe(400);
    expect(errorCode(missing.json<Record<string, unknown>>())).toBe('IDEMPOTENCY_KEY_REQUIRED');

    const key = 'land-idempotent-case';
    const first = await postPurchase(harness, accessToken, { cells, idempotencyKey: key });
    expect(first.statusCode).toBe(200);
    const balance = await balanceOf(harness, playerId);

    const replay = await postPurchase(harness, accessToken, { cells, idempotencyKey: key });
    expect(replay.statusCode).toBe(200);
    expect(replay.body).toEqual(first.body);
    // The replay ran nothing: the balance did not move a second time.
    expect(await balanceOf(harness, playerId)).toBe(balance);
  });

  it('la suma del libro mayor sigue cuadrando con el saldo (ADR-0009)', async () => {
    const audit = await withPlainTransaction(harness.prisma, (tx) => auditBalance(tx, playerId));
    expect(audit.ok).toBe(true);
    expect(audit.storedBalance).toBe(audit.summedBalance);
    expect(audit.entryCount).toBeGreaterThan(1);
  });
});

describe('el evento de compra por WebSocket', () => {
  it('entrega CHUNK_PATCHED, PLAYER_UPSERTED y LEDGER_APPENDED en secuencia', async () => {
    const listener = await registerViaHttp(harness, 'land-socket');
    await harness.app.listen({ port: 0, host: '127.0.0.1' });
    const address = harness.app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('El servidor de pruebas no publico un puerto');
    }

    const ticketResponse = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/ws-ticket',
      headers: bearer(listener.accessToken),
    });
    expect(ticketResponse.statusCode).toBe(200);
    const ticket = ticketResponse.json<{ ticket: string }>().ticket;

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}${WS_PATH}?ticket=${ticket}`);
    const frames: { type: string; seq: number }[] = [];
    const greeted = new Promise<void>((resolve, reject) => {
      socket.addEventListener('error', () => {
        reject(new Error('el socket no pudo abrirse'));
      });
      socket.addEventListener('message', (event: MessageEvent) => {
        const frame = JSON.parse(String(event.data)) as { type: string; seq: number };
        frames.push(frame);
        if (frame.type === 'HELLO') {
          resolve();
        }
      });
    });
    await greeted;

    const cells = await findCellsOfTerrain(harness, world, TerrainType.GRASS, 2, {
      chunkY: BAND.SOCKET,
    });
    const { statusCode, body } = await postPurchase(harness, listener.accessToken, { cells });
    expect(statusCode).toBe(200);

    // The frames travel through Redis after the commit, so the assertion waits for them
    // rather than assuming they arrived before the reply did.
    const deadline = Date.now() + 5_000;
    while (
      Date.now() < deadline &&
      !frames.some((frame) => frame.type === GameEventType.LEDGER_APPENDED)
    ) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    socket.close();

    const domain = frames.filter((frame) => frame.type !== 'HELLO' && frame.type !== 'CLOCK');
    expect(domain.map((frame) => frame.type)).toEqual([
      GameEventType.CHUNK_PATCHED,
      GameEventType.PLAYER_UPSERTED,
      GameEventType.LEDGER_APPENDED,
    ]);
    // Gapless and ending exactly at the sequence the mutating reply reported, which is what
    // lets the client apply the reply and discard the echo in either order (ADR-0019).
    expect(domain.map((frame) => frame.seq)).toEqual([
      domain[0]?.seq,
      (domain[0]?.seq ?? 0) + 1,
      (domain[0]?.seq ?? 0) + 2,
    ]);
    expect(body['seq']).toBe(domain[2]?.seq);
  });
});

describe('la reclamacion frente a un competidor ya comprometido', () => {
  it('no cobra nada cuando la celda se vendio entre la validacion y la compra', async () => {
    const buyer = await registerViaHttp(harness, 'land-lost');
    const cells = await findCellsOfTerrain(harness, world, TerrainType.GRASS, 1, {
      chunkY: BAND.RACE,
      fromChunkX: 20,
    });
    const cell = cells[0] as CellCoord;
    // Somebody else already owns it, which is the committed form of the same conflict.
    await harness.services.transaction((tx) =>
      claimCells(harness.services, tx, world, playerId, [cell], harness.nowRealMs()),
    );

    const before = await balanceOf(harness, buyer.playerId);
    const partial = await postPurchase(harness, buyer.accessToken, {
      cells: [cell],
      allowPartial: true,
    });
    expect(partial.statusCode).toBe(200);
    const result = mutationResult(partial.body);
    expect(result['purchasedCount']).toBe(0);
    expect(result['skippedCount']).toBe(1);
    expect(result['totalPaid']).toBe(Money.toString(Money.ZERO));
    expect(await balanceOf(harness, buyer.playerId)).toBe(before);
    // Nothing to explain, so no entry and no frame were written.
    expect(
      await harness.prisma.ledgerEntry.count({
        where: { playerId: buyer.playerId, type: LedgerType.LAND_PURCHASE },
      }),
    ).toBe(0);
  });
});
