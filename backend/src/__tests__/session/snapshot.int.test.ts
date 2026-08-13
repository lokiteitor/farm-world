// The full snapshot: validity against the contract, completeness, and size.
//
// Owner: workflow W6-B. Module `session`.
//
// Two things are being asserted, and the second is the one that is easy to skip and expensive to
// discover later. The first is that the reply validates against `snapshotReplySchema`, which is
// the same schema the response serialiser enforces and the same one the client parses, so a
// field that this module builds wrongly fails here rather than in a browser.
//
// The second is the size. The snapshot is the rung of the ladder a client reaches when the ring
// no longer covers its gap, and it carries the cells of every field, which is the one part of it
// that grows with the holding. A player with twenty fields is the reference the brief of this
// module names, and the figure is measured rather than assumed: the case prints the real number
// so that the value recorded in `docs/handoff/NOTES-w6b.md` is a measurement and not an estimate.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CropCycleState,
  MS_PER_GAME_HOUR,
  Money,
  gameMs as toGameMsValue,
  snapshotReplySchema,
  type World,
} from '../../shared/index.js';
import { createHarness, type Harness } from '../harness.js';
import {
  attachCells,
  clearDomain,
  createField,
  createForestPlot,
  createMachine,
  createRunningTask,
  createSessionPlayer,
  createWorker,
  getJson,
  getRaw,
  signIn,
} from './fixtures.js';

let harness: Harness;
let world: World;

/** Fields of the reference holding, and the cells of each (GDD section 117 uses 250). */
const REFERENCE_FIELDS = 20;
const CELLS_PER_FIELD = 250;

/**
 * Ceiling the reply of the reference holding has to stay under, in bytes.
 *
 * Half a megabyte is not a limit of the transport: it is the point past which downloading the
 * whole holding to repair a sequence gap stops being cheaper than the alternative, which would
 * be paging the cells of the fields separately. The measured figure is printed by the case, and
 * the margin against this ceiling is what says whether that alternative is still far away.
 */
const SNAPSHOT_SIZE_CEILING_BYTES = 512 * 1024;

beforeAll(async () => {
  harness = await createHarness();
  world = (await harness.services.clock.read()).world;
});

afterAll(async () => {
  await clearDomain(harness, world);
  await harness.teardown();
});

describe('GET /api/state/snapshot', () => {
  it('valida contra el esquema compartido y lleva cada entidad del jugador', async () => {
    const player = await createSessionPlayer(harness, 'snap-esquema');
    const workerId = await createWorker(harness, player, 'Carla', Money.fromUnits(10));
    const tractorId = await createMachine(harness, player, 'TRACTOR');
    const ploughId = await createMachine(harness, player, 'PLOW');
    const fieldId = await createField(harness, player, {
      name: 'Parcela sur',
      cellCount: 120,
      cropId: 'WHEAT',
      cropCycleState: CropCycleState.SEEDED,
      seededAtGameMs: player.startedAtGameMs,
    });
    await attachCells(harness, world, player, fieldId, 0, 120);
    await createRunningTask(harness, player, {
      workerId,
      machineIds: [tractorId, ploughId],
      startGameMs: player.startedAtGameMs,
      scheduledEndGameMs: toGameMsValue(player.startedAtGameMs + 40n * MS_PER_GAME_HOUR),
      targetFieldId: fieldId,
    });
    await createForestPlot(harness, world, player, {
      name: 'Pinar alto',
      cellCount: 40,
      treeCount: 12,
      // Old enough to be past the first stage boundary of the pine (GDD section 133).
      plantedAtGameMs: player.startedAtGameMs,
    });

    harness.advanceGameHours(300);
    const token = await signIn(harness, player.email);
    const { statusCode, body } = await getJson(harness, token, '/api/state/snapshot');
    expect(statusCode, JSON.stringify(body).slice(0, 500)).toBe(200);

    const snapshot = snapshotReplySchema.parse(body);

    expect(snapshot.player.id).toBe(player.playerId);
    expect(snapshot.world.seed).toBe(world.seed);
    expect(snapshot.farms).toHaveLength(1);
    // Silo, garage and worker home.
    expect(snapshot.buildings).toHaveLength(3);
    expect(snapshot.fields).toHaveLength(1);
    expect(snapshot.fieldCells[0]?.cells).toHaveLength(120);
    expect(snapshot.machines).toHaveLength(2);
    expect(snapshot.workers).toHaveLength(1);
    expect(snapshot.inventory).toHaveLength(1);

    // The two entities of a sibling module of this phase, which the snapshot projects itself.
    expect(snapshot.tasks).toHaveLength(1);
    expect(snapshot.tasks[0]?.machineIds).toEqual([tractorId, ploughId]);
    expect(snapshot.tasks[0]?.progressBp).toBe(10_000);
    expect(snapshot.forestPlots).toHaveLength(1);
    expect(snapshot.forestPlots[0]?.standingTreeCount).toBe(12);
    expect(snapshot.forestPlots[0]?.emptyCellCount).toBe(28);
    // Three hundred game hours put every pine past the first boundary of GDD section 133, so
    // none of them is a sapling any more and all of them can be felled.
    expect(snapshot.forestPlots[0]?.stageHistogram.SAPLING).toBe(0);
    expect(snapshot.forestPlots[0]?.fellableTreeCount).toBe(12);
    expect(snapshot.forestPlots[0]?.fellableWoodValue).not.toBe(Money.toString(Money.ZERO));

    // The sequence the snapshot is consistent at is the one the player row carries.
    const row = await harness.prisma.player.findUniqueOrThrow({
      where: { id: player.playerId },
      select: { eventSeq: true },
    });
    expect(snapshot.seq).toBe(row.eventSeq);
  });

  it('se mantiene por debajo del techo con un jugador de veinte campos', async () => {
    const player = await createSessionPlayer(harness, 'snap-tamano');
    await createWorker(harness, player, 'Diego', Money.fromUnits(10));
    for (let index = 0; index < REFERENCE_FIELDS; index += 1) {
      const fieldId = await createField(harness, player, {
        name: `Parcela ${index + 1}`,
        cellCount: CELLS_PER_FIELD,
        cropId: 'WHEAT',
        cropCycleState: CropCycleState.VIRGIN,
      });
      await attachCells(
        harness,
        world,
        player,
        fieldId,
        // A band of its own per field, so no two fields claim the same cell.
        200_000 + index * CELLS_PER_FIELD,
        CELLS_PER_FIELD,
      );
    }

    const token = await signIn(harness, player.email);
    const { statusCode, body } = await getRaw(harness, token, '/api/state/snapshot');
    expect(statusCode).toBe(200);

    const sizeBytes = Buffer.byteLength(body, 'utf8');
    const snapshot = snapshotReplySchema.parse(JSON.parse(body));
    expect(snapshot.fields).toHaveLength(REFERENCE_FIELDS);
    expect(snapshot.fieldCells.reduce((total, entry) => total + entry.cells.length, 0)).toBe(
      REFERENCE_FIELDS * CELLS_PER_FIELD,
    );

    // Printed rather than merely asserted: the figure recorded in the handoff notes has to be a
    // measurement, and a suite that only compares against a ceiling never produces one.
    process.stdout.write(
      `\n  instantanea de ${REFERENCE_FIELDS} campos de ${CELLS_PER_FIELD} celdas: ` +
        `${sizeBytes} bytes (${(sizeBytes / 1024).toFixed(1)} KiB)\n`,
    );
    expect(sizeBytes).toBeLessThan(SNAPSHOT_SIZE_CEILING_BYTES);
  });
});
