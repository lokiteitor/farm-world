// The reducer, on the three things W6 added to it.
//
// Owner: W6-W (client seam).
//
// What is exercised here is deliberately not the whole reducer: the twenty two sequenced
// routes are already covered end to end by `app/__tests__/mock-server.test.ts`, which runs
// the real client against the simulated server. What was missing is the part of a reply
// that the table of appliers cannot express, and the part of a frame that was being
// dropped:
//
//   1. The slot counters, which say how many places are taken and never whose, so they
//      need a second field of the same result to be placeable.
//   2. The condition a cancellation reports for each machine.
//   3. The geometry of a forest plot, which travels in the frame and in the snapshot and
//      never inside `ForestPlotDto`.
//
// The fixtures come from the simulated server wherever a whole entity is needed, so no
// hand written row can drift from the contract; the two cases the simulated server cannot
// produce are built as literal results, which is exactly the shape the reducer receives.

import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockTransport } from '~/mock/index';
import { createMockServer, type MockServer } from '~/mock/server';
import { apiCall, apiOpenSession } from '~/net/api';
import { configureClientRuntime, resetClientRuntime } from '~/net/runtime';
import { FrameVerdict } from '~/net/sequence';
import { resetSession } from '~/net/session';
import { resetHttpTransport, setHttpTransport } from '~/net/transport';
import {
  MIN_CONDITION_TO_ASSIGN,
  MachineStatus,
  type SnapshotReply,
  type WsServerFrame,
} from '~/shared/index';
import { useFarmsStore } from '~/stores/farms';
import { useForestryStore } from '~/stores/forestry';
import { useMachinesStore } from '~/stores/machines';
import { useSyncStore } from '~/stores/sync';
import { useWorkersStore } from '~/stores/workers';

let server: MockServer;

async function loadState(): Promise<SnapshotReply> {
  await apiOpenSession('POST /api/auth/login', {
    email: 'dev@farm-world.local',
    password: 'farm-world-dev',
  });
  const snapshot = await apiCall('GET /api/state/snapshot');
  useSyncStore().applySnapshot(snapshot);
  return snapshot;
}

beforeEach(() => {
  setActivePinia(createPinia());
  resetSession();
  resetClientRuntime();
  configureClientRuntime({ validateReplies: true, requestTimeoutRealMs: 2_000 });
  server = createMockServer({ sessionOpen: false });
  setHttpTransport(createMockTransport(server));
});

afterEach(() => {
  resetHttpTransport();
  resetSession();
  resetClientRuntime();
});

describe('el reductor y los contadores de plaza', () => {
  it('aplica la ocupacion de garaje que trae la venta, despues de retirar la maquina', async () => {
    const snapshot = await loadState();
    const sync = useSyncStore();
    const farms = useFarmsStore();
    const machines = useMachinesStore();

    const machine = snapshot.machines.find(
      (candidate) => candidate.garageId !== null && candidate.status === MachineStatus.IDLE,
    );
    expect(machine).toBeDefined();
    const before = farms.get(machine!.farmId)?.machineSlots.used ?? 0;

    const reply = await apiCall('POST /api/machines/:machineId/sell', {
      params: { machineId: machine!.id },
      idempotencyKey: 'w6w-sell',
    });
    sync.applyMutationReply(reply);

    // The field order of the reply removes the machine before the counters are reached,
    // which is why they are not appliers of the table: without resolving the farm first
    // there would be nothing left to resolve it from.
    expect(machines.get(machine!.id)).toBeUndefined();
    expect(reply.result.garageSlotsUsed).toBe(before - 1);
    expect(farms.get(machine!.farmId)?.machineSlots.used).toBe(reply.result.garageSlotsUsed);
    expect(farms.get(machine!.farmId)?.machineSlots.total).toBe(reply.result.garageSlotsTotal);
  });

  it('aplica la ocupacion de vivienda de un despido como cifra de toda la hacienda', async () => {
    const snapshot = await loadState();
    const sync = useSyncStore();
    const workers = useWorkersStore();
    const farms = useFarmsStore();

    const worker = snapshot.workers.find((candidate) => candidate.currentTaskId === null);
    expect(worker).toBeDefined();
    const farmBefore = farms.get(worker!.farmId)?.workerSlots.used;

    const reply = await apiCall('POST /api/workers/:workerId/fire', {
      params: { workerId: worker!.id },
    });
    sync.applyMutationReply(reply);

    expect(workers.homeSlots).toEqual({
      used: reply.result.homeSlotsUsed,
      total: reply.result.homeSlotsTotal,
    });
    expect(workers.freeHomeSlots).toBe(reply.result.homeSlotsTotal - reply.result.homeSlotsUsed);
    // And it is not written onto the farm: the server aggregates it over the whole
    // holding, so the per farm reading is left to `GET /api/farms` and to the frame.
    expect(farms.get(worker!.farmId)?.workerSlots.used).toBe(farmBefore);
  });

  it('los toma aunque la trama se haya adelantado y el reductor descarte la respuesta', async () => {
    const snapshot = await loadState();
    const sync = useSyncStore();
    const farms = useFarmsStore();
    const machines = useMachinesStore();

    const machine = snapshot.machines.find(
      (candidate) => candidate.garageId !== null && candidate.status === MachineStatus.IDLE,
    );
    expect(machine).toBeDefined();
    const before = farms.get(machine!.farmId)?.machineSlots.used ?? 0;

    // What a live socket does: every frame of the mutation is collected as the simulated
    // server pushes it, and applied before the reply. That order is the ordinary one and
    // not the exotic one, and it leaves the mark at the sequence of the reply.
    const emitted: WsServerFrame[] = [];
    const unsubscribe = server.subscribe((frame) => {
      emitted.push(frame);
    });
    const reply = await apiCall('POST /api/machines/:machineId/sell', {
      params: { machineId: machine!.id },
      idempotencyKey: 'w6w-sell-carrera',
    });
    unsubscribe();
    for (const frame of emitted) {
      sync.applyFrame(frame);
    }

    expect(machines.get(machine!.id)).toBeUndefined();
    expect(sync.lastAppliedSeq).toBe(reply.seq);

    const outcome = sync.applyMutationReply(reply);

    expect(outcome.verdict).toBe(FrameVerdict.DISCARD);
    // Discarded and yet the counters landed: no frame carries them, so the sequencing
    // guard cannot be the thing that decides whether they are applied.
    expect(farms.get(machine!.farmId)?.machineSlots.used).toBe(before - 1);
    expect(farms.get(machine!.farmId)?.machineSlots.used).toBe(reply.result.garageSlotsUsed);
  });

  it('no deja que una respuesta atrasada pise una lectura mas reciente', async () => {
    await loadState();
    const sync = useSyncStore();
    const workers = useWorkersStore();
    const seq = sync.lastAppliedSeq;

    sync.applyMutationReply({
      seq: seq + 2,
      atGameMs: '0',
      result: { homeSlotsUsed: 2, homeSlotsTotal: 4 },
    });
    expect(workers.homeSlots).toEqual({ used: 2, total: 4 });

    // A reply of an earlier sequence that arrived late describes an older world, and the
    // mark of the counters is what keeps it from undoing the newer reading.
    sync.applyMutationReply({
      seq: seq + 1,
      atGameMs: '0',
      result: { homeSlotsUsed: 9, homeSlotsTotal: 9 },
    });

    expect(workers.homeSlots).toEqual({ used: 2, total: 4 });
  });

  it('ignora los contadores cuando no hay sujeto al que atribuirlos', async () => {
    await loadState();
    const sync = useSyncStore();
    const farms = useFarmsStore();
    const before = farms.all.map((farm) => farm.machineSlots.used);

    sync.applyMutationReply({
      seq: sync.lastAppliedSeq + 1,
      atGameMs: '0',
      result: { garageSlotsUsed: 99, garageSlotsTotal: 99 },
    });

    expect(farms.all.map((farm) => farm.machineSlots.used)).toEqual(before);
  });
});

describe('el reductor y la condicion de una cancelacion', () => {
  it('aplica la condicion de cada maquina y recalcula si es asignable', async () => {
    const snapshot = await loadState();
    const sync = useSyncStore();
    const machines = useMachinesStore();

    const machine = snapshot.machines[0];
    expect(machine).toBeDefined();
    const below = MIN_CONDITION_TO_ASSIGN - 1;

    sync.applyMutationReply({
      seq: sync.lastAppliedSeq + 1,
      atGameMs: '0',
      result: { machineConditionBp: [{ machineId: machine!.id, conditionBp: below }] },
    });

    expect(machines.get(machine!.id)?.conditionBp).toBe(below);
    // `assignable` is a derivation of the condition and not an independent field: leaving
    // it as it was would enable a button the server refuses.
    expect(machines.get(machine!.id)?.assignable).toBe(false);
  });

  it('no toca nada cuando la lista no cumple su esquema', async () => {
    const snapshot = await loadState();
    const sync = useSyncStore();
    const machines = useMachinesStore();
    const machine = snapshot.machines[0];
    const before = machines.get(machine!.id)?.conditionBp;

    sync.applyMutationReply({
      seq: sync.lastAppliedSeq + 1,
      atGameMs: '0',
      result: { machineConditionBp: [{ machineId: machine!.id, conditionBp: 'mucha' }] },
    });

    expect(machines.get(machine!.id)?.conditionBp).toBe(before);
  });
});

describe('el reductor y la geometria de una parcela forestal', () => {
  it('la toma de la instantanea', async () => {
    const snapshot = await loadState();
    const forestry = useForestryStore();

    expect(snapshot.forestPlotCells.length).toBeGreaterThan(0);
    for (const entry of snapshot.forestPlotCells) {
      expect(forestry.cellsOf(entry.forestPlotId)).toEqual(entry.cells);
    }
  });

  it('la actualiza con la trama, y la conserva cuando la trama la declara sin cambio', async () => {
    const snapshot = await loadState();
    const sync = useSyncStore();
    const forestry = useForestryStore();

    const plot = snapshot.forestPlots[0];
    expect(plot).toBeDefined();
    const cells = [
      { cellX: 10, cellY: 10 },
      { cellX: 11, cellY: 10 },
    ];

    sync.applyFrame({
      seq: sync.lastAppliedSeq + 1,
      atGameMs: '0',
      type: 'FOREST_PLOT_UPSERTED',
      payload: { plot: plot!, cells },
    });
    expect(forestry.cellsOf(plot!.id)).toEqual(cells);

    // Null means "unchanged" and never "empty", the same rule `FIELD_UPSERTED` follows.
    sync.applyFrame({
      seq: sync.lastAppliedSeq + 1,
      atGameMs: '0',
      type: 'FOREST_PLOT_UPSERTED',
      payload: { plot: plot!, cells: null },
    });
    expect(forestry.cellsOf(plot!.id)).toEqual(cells);
  });

  it('olvida la geometria de una parcela retirada', async () => {
    const snapshot = await loadState();
    const sync = useSyncStore();
    const forestry = useForestryStore();
    const plot = snapshot.forestPlots[0];

    expect(forestry.cellsOf(plot!.id).length).toBeGreaterThan(0);
    sync.applyFrame({
      seq: sync.lastAppliedSeq + 1,
      atGameMs: '0',
      type: 'FOREST_PLOT_REMOVED',
      payload: { forestPlotId: plot!.id },
    });
    expect(forestry.cellsOf(plot!.id)).toEqual([]);
  });
});
