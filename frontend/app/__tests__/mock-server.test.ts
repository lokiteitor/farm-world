// The simulated server against the real client, end to end.
//
// Owner: W3-C. It replaces the W1 scaffolding test, which asserted that the harness compiled a
// single file component; that is now covered by the panel tests, and what needs covering here is
// the seam the whole phase exists to provide.
//
// This is the test that says the mock is worth having: the same typed client, the same reducer
// and the same sequence rule run against it, so a panel of W4 to W6 developed with no backend is
// exercising the real paths. It also pins the two properties a fake server usually gets wrong,
// which are that every reply validates against the schema of its route and that a mutation emits
// its frames before it answers.

import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockTransport } from '~/mock/index';
import { createMockServer, type MockServer } from '~/mock/server';
import { apiCall, apiOpenSession } from '~/net/api';
import { configureClientRuntime, resetClientRuntime } from '~/net/runtime';
import { resetSession } from '~/net/session';
import { resetHttpTransport, setHttpTransport } from '~/net/transport';
import { API_ROUTE_KEYS, pathParamNames, routeDefinition, type ApiRouteKey } from '~/shared/index';
import { useFarmsStore } from '~/stores/farms';
import { useMachinesStore } from '~/stores/machines';
import { usePlayerStore } from '~/stores/player';
import { useSyncStore } from '~/stores/sync';
import { useWorldStore } from '~/stores/world';

let server: MockServer;

async function openSession(): Promise<void> {
  await apiOpenSession('POST /api/auth/login', {
    email: 'dev@farm-world.local',
    password: 'farm-world-dev',
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  resetSession();
  resetClientRuntime();
  // Reply validation on: the point of the test is that the fixtures satisfy the contract.
  configureClientRuntime({ validateReplies: true, requestTimeoutRealMs: 2_000 });
  server = createMockServer({ sessionOpen: false });
  setHttpTransport(createMockTransport(server));
});

afterEach(() => {
  resetHttpTransport();
  resetSession();
  resetClientRuntime();
});

describe('el servidor simulado', () => {
  it('exige sesion antes de servir estado', async () => {
    await expect(apiCall('GET /api/state/snapshot')).rejects.toThrow();
    await openSession();
    const snapshot = await apiCall('GET /api/state/snapshot');
    expect(snapshot.player.id).toBe('player-mock');
  });

  it('sirve un mundo coherente: capacidades, ocupacion y celdas', async () => {
    await openSession();
    const snapshot = await apiCall('GET /api/state/snapshot');

    const farm = snapshot.farms[0];
    expect(farm).toBeDefined();
    expect(farm?.machineSlots.used).toBe(snapshot.machines.length);
    expect(farm?.workerSlots.used).toBe(snapshot.workers.length);
    expect(farm?.machineSlots.used).toBeLessThanOrEqual(farm?.machineSlots.total ?? 0);
    expect(farm?.workerSlots.used).toBeLessThanOrEqual(farm?.workerSlots.total ?? 0);

    // Every field has geometry, and the cell count matches it.
    for (const field of snapshot.fields) {
      const cells = snapshot.fieldCells.find((entry) => entry.fieldId === field.id);
      expect(cells).toBeDefined();
      expect(cells?.cells.length).toBe(field.cellCount);
    }
    expect(snapshot.world.spawnCellX).not.toBeNull();
  });

  it('la instantanea llena todas las porciones del reductor', async () => {
    await openSession();
    const sync = useSyncStore();
    const snapshot = await apiCall('GET /api/state/snapshot');
    sync.applySnapshot(snapshot);

    expect(usePlayerStore().id).toBe('player-mock');
    expect(useFarmsStore().count).toBe(1);
    expect(useMachinesStore().count).toBeGreaterThan(0);
    expect(useWorldStore().ready).toBe(true);
    expect(sync.lastAppliedSeq).toBe(snapshot.seq);
  });

  it('una mutacion emite sus tramas antes de responder, y la respuesta lleva la ultima', async () => {
    await openSession();
    const sync = useSyncStore();
    sync.applySnapshot(await apiCall('GET /api/state/snapshot'));

    const seen: number[] = [];
    const unsubscribe = server.subscribe((frame) => {
      seen.push(frame.seq);
    });

    const before = sync.lastAppliedSeq;
    const reply = await apiCall('POST /api/farms', { body: { name: 'Granja renombrada' } });
    unsubscribe();

    expect(reply.seq).toBeGreaterThan(before);
    expect(seen.at(-1)).toBe(reply.seq);

    sync.applyMutationReply(reply);
    expect(useFarmsStore().primary?.name).toBe('Granja renombrada');
    expect(sync.lastAppliedSeq).toBe(reply.seq);
  });

  it('el eco por WebSocket de una mutacion ya aplicada se descarta', async () => {
    await openSession();
    const sync = useSyncStore();
    sync.applySnapshot(await apiCall('GET /api/state/snapshot'));

    const frames: Parameters<typeof sync.applyFrame>[0][] = [];
    const unsubscribe = server.subscribe((frame) => {
      frames.push(frame);
    });
    const reply = await apiCall('POST /api/farms', { body: { name: 'Granja del eco' } });
    unsubscribe();

    sync.applyMutationReply(reply);
    const discardedBefore = sync.discardedCount;
    for (const frame of frames) {
      sync.applyFrame(frame);
    }
    expect(sync.discardedCount).toBeGreaterThan(discardedBefore);
    expect(useFarmsStore().primary?.name).toBe('Granja del eco');
  });

  it('rechaza la quinta maquina en un garaje de cuatro plazas', async () => {
    await openSession();
    const snapshot = await apiCall('GET /api/state/snapshot');
    const garage = snapshot.buildings.find((building) => building.type === 'GARAGE');
    expect(garage).toBeDefined();
    expect(garage?.occupancy).toBe(garage?.capacity);

    await expect(
      apiCall('POST /api/machines', {
        body: { farmId: 'farm-mock', type: 'CULTIVATOR' },
        idempotencyKey: 'buy-attempt-0001',
      }),
    ).rejects.toMatchObject({ code: 'GARAGE_CAPACITY_EXCEEDED' });
  });

  it('el presupuesto de tierra explica el motivo por celda bloqueada', async () => {
    await openSession();
    const info = await apiCall('GET /api/world/info');
    const spawnX = info.spawnCellX ?? 0;
    const spawnY = info.spawnCellY ?? 0;
    const quote = await apiCall('POST /api/land/quote', {
      body: {
        cells: [
          { cellX: spawnX, cellY: spawnY },
          { cellX: spawnX + 200, cellY: spawnY + 200 },
        ],
      },
    });
    expect(quote.cells).toHaveLength(2);
    for (const cell of quote.cells) {
      // La invariante del contrato: el precio es nulo exactamente cuando hay motivo.
      expect(cell.price === null).toBe(cell.blockedBy !== null);
    }
  });

  it('responde a todas las rutas del contrato', async () => {
    await openSession();
    const unreachable: ApiRouteKey[] = [];
    let answered = 0;
    for (const routeKey of API_ROUTE_KEYS) {
      const route = routeDefinition(routeKey);
      // Las rutas que mutan estado se ejercitan en los casos de arriba; aqui se recorren las
      // de lectura sin parametros de ruta, que son las que se pueden invocar sin inventar un
      // identificador. Que ninguna quede sin manejador lo garantiza la tabla por clave en
      // compilacion; esto lo confirma en ejecucion.
      if (route.method !== 'GET' || pathParamNames(route.path).length > 0) {
        continue;
      }
      try {
        await apiCall(routeKey, routeKey === 'GET /api/events' ? { query: { since: 0 } } : {});
        answered += 1;
      } catch {
        unreachable.push(routeKey);
      }
    }
    expect(unreachable).toEqual([]);
    expect(answered).toBeGreaterThan(10);
  });
});
