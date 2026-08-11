// The two routes of the `world` area.
//
// Owner: workflow W3-B. Module `world`.
//
// `GET /api/world/info` is everything the client needs before it can draw anything: the seed
// and the generator version, which feed its own copy of the generator; the scale; the clock
// anchor, from which every countdown extrapolates without asking again; and the origin of
// this player, so the camera opens on its land.
//
// `POST /api/world/chunks` carries the overlay of modifications and nothing else. The terrain
// does not travel: it is a pure function of the seed and the coordinate and the client runs
// the very same generator, byte for byte (GDD sections 7 and 58, ADR-0010,
// `docs/handoff/NOTES-W2c.md` item 1.5). A chunk is therefore renderable as soon as the seed
// is known, and the reply only decides ownership, use, the cleared forest and where a tree
// stands.
//
// Neither route advances the player and neither is sequenced, which is what the contract
// declares (`shared/api/routes.ts`). That is not an oversight: the grid is world state and not
// player state, so reading it neither settles a cost nor produces an event. Both are
// authenticated, because a world shared by several players still reports who owns what.
//
// Three properties of the reply that the tests pin down:
//
//   - `unchanged` is answered when the version the client sent is the current one, which is
//     what makes revisiting a chunk free while panning (plan section 9.5).
//   - A chunk with no row is answered with version 0 and no cells, without a second statement:
//     `world_cells` has a foreign key to `chunks`, so absence proves emptiness.
//   - A repeated coordinate is answered once, in the order it was first asked for.

import { type FastifyInstance } from 'fastify';
import { toClockDto } from '../../lib/playerView.js';
import { readClock, requirePlayer } from '../../plugins/auth.js';
import { defineRoute } from '../../plugins/routes.js';
import {
  CELL_PX,
  CELL_SIZE_M,
  MAX_SELECTION_CELLS,
  SHARED_CONTRACT_VERSION,
  toWireGameMs,
  type ChunkResult,
  type RouteReply,
} from '../../shared/index.js';
import { cellRepositoryOf } from './cellRepo.js';

/** Registers the routes of the area. Invoked once by `src/app.ts`. */
export function registerWorldRoutes(app: FastifyInstance): void {
  // -------------------------------------------------------------------------
  // GET /api/world/info
  // -------------------------------------------------------------------------
  defineRoute(app, 'GET /api/world/info', async (request) => {
    const auth = requirePlayer(request);
    const services = request.server.services;
    const reading = await readClock(request);
    const world = reading.world;

    // The origin is read from the player row and not re-derived from the allocator: a
    // re-derivation would need the player index, which is only meaningful while the world row
    // is locked, and the column exists precisely so that no read path has to take that lock
    // (backend/prisma/schema.prisma, `Player.spawnCellX`).
    const player = await services.prisma.player.findUnique({
      where: { id: auth.playerId },
      select: { spawnCellX: true, spawnCellY: true },
    });

    const body: RouteReply<'GET /api/world/info'> = {
      worldId: world.id,
      seed: world.seed,
      generatorVersion: world.generatorVersion,
      // From the persisted row and not from `shared/config`: the start-up check of
      // `lib/gameClock.ts` already refuses to boot when the two disagree, so reporting the row
      // is reporting what every stored coordinate actually means (ADR-0010).
      chunkSize: world.chunkSize,
      cellSizeM: CELL_SIZE_M,
      cellPx: CELL_PX,
      maxSelectionCells: MAX_SELECTION_CELLS,
      contractVersion: SHARED_CONTRACT_VERSION,
      clock: toClockDto(reading),
      spawnCellX: player?.spawnCellX ?? null,
      spawnCellY: player?.spawnCellY ?? null,
    };
    return body;
  });

  // -------------------------------------------------------------------------
  // POST /api/world/chunks
  // -------------------------------------------------------------------------
  defineRoute(app, 'POST /api/world/chunks', async (request) => {
    requirePlayer(request);
    const services = request.server.services;
    const reading = await readClock(request);

    const states = await cellRepositoryOf(services).chunkStates(
      services.prisma,
      reading.world,
      request.body.chunks,
    );

    const body: RouteReply<'POST /api/world/chunks'> = {
      chunks: states.map((state): ChunkResult => {
        // The two members of the union are strict objects, so an `unchanged` chunk must not
        // carry `cells` at all. Building the two shapes apart is what keeps the serialiser
        // from rejecting a reply that is merely over-informative.
        if (state.unchanged) {
          return {
            chunkX: state.chunkX,
            chunkY: state.chunkY,
            version: state.version,
            unchanged: true,
          };
        }
        return {
          chunkX: state.chunkX,
          chunkY: state.chunkY,
          version: state.version,
          unchanged: false,
          cells: [...state.cells],
        };
      }),
      atGameMs: toWireGameMs(reading.gameNow),
    };
    return body;
  });
}
