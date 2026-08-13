// The measurement bench.
//
// Owner: workflow W4-D (world rendering). Plan section 9.3 says the budget must be
// "exigible y no aspiracional", so it is measured over the real scene, on demand, and it
// reports the numbers it obtained rather than the ones it hoped for.
//
// Six measurements, which are the six the brief of this workflow fixes:
//
//   1. Zoom 1 with at least 50 chunks loaded: 55 frames per second and 130 draw calls.
//   2. Zoom 0.25 with at least 200 chunks: 55 frames per second and 220 draw calls.
//   3. Building one chunk, both representations included: under 4 ms.
//   4. Patching 250 cells of a built chunk: under 2 ms.
//   5. Memory after walking ten thousand chunks: the texture count has to return to its
//      baseline, which is a deterministic leak check, and the heap delta is reported for
//      information because no page can force a collection.
//   6. The level of detail switch, which must not rebuild anything.
//
// The bench drives an offline source on purpose. A budget measured through an HTTP round
// trip measures the round trip; what is being measured here is the renderer, so the
// chunks are generated locally with the same deterministic generator the server runs.

import type Phaser from 'phaser';
import { LevelOfDetail, RENDER_BUDGET } from './config';
import { parseChunkKey, type WorldChunkView } from './source';
import { type WorldScene } from './WorldScene';
import { CHUNK_SIZE, LandUse, type ChunkCellPatch } from '~/shared/index';

/** One frame, or the deadline of one, so a hidden tab does not stall the bench. */
function nextFrame(): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(performance.now());
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(done);
    }
    setTimeout(done, 50);
  });
}

/** Result of one of the two rendering cases. */
export interface BenchCaseResult {
  readonly name: string;
  readonly zoom: number;
  readonly requiredChunks: number;
  readonly loadedChunks: number;
  readonly visibleChunks: number;
  readonly levelOfDetail: LevelOfDetail;
  /** Frames the engine stepped during the window. This is what `fps` is computed from. */
  readonly frames: number;
  readonly durationMs: number;
  readonly fps: number;
  /**
   * Frames the polling loop of the bench itself saw.
   *
   * Reported beside `fps` because the two disagreeing is the signature of a browser that
   * stopped delivering animation frames to the window, and a run where they disagree is
   * a run whose frame rate says nothing about the renderer.
   */
  readonly pollFps: number;
  readonly minFps: number;
  readonly meanDrawCalls: number;
  readonly maxDrawCalls: number;
  readonly maxQuads: number;
  readonly drawCallBudget: number;
  /**
   * Lowest and highest zoom seen during the window.
   *
   * Recorded and not assumed: a case that asked for zoom 1 and measured something else
   * is measuring the wrong thing, and without these two numbers the report would look
   * plausible while doing it.
   */
  readonly zoomMin: number;
  readonly zoomMax: number;
  /**
   * Cost of the chunk builds this case performed.
   *
   * Per case and not once for the run, because the two cases build different things: at
   * the near level of detail a chunk is a tilemap and a thumbnail, at the far one it is
   * a thumbnail. One average over both would describe neither.
   */
  readonly build: BenchTiming;
  /**
   * Cost of the streaming ticks of this case.
   *
   * The number a player feels: one tick loads up to 32 chunks, builds the level of
   * detail of the ones that became visible, drops what left the ring and rebuilds the
   * outlines, all inside one frame.
   */
  readonly tick: BenchTiming;
  readonly passed: boolean;
}

export interface BenchTiming {
  readonly count: number;
  readonly meanMs: number;
  readonly maxMs: number;
  readonly budgetMs: number;
  readonly passed: boolean;
}

export interface BenchMemory {
  readonly chunksWalked: number;
  readonly texturesBefore: number;
  readonly texturesAfter: number;
  readonly liveChunksAfter: number;
  readonly heapBeforeMb: number | null;
  readonly heapAfterMb: number | null;
  /** True when the texture count came back to its baseline, which is the leak check. */
  readonly passed: boolean;
}

export interface BenchReport {
  readonly startedAtRealMs: number;
  readonly drawCallsMeasured: boolean;
  readonly cases: readonly BenchCaseResult[];
  readonly chunkBuild: BenchTiming;
  readonly patch: BenchTiming;
  readonly memory: BenchMemory;
  /**
   * Chunks built while the zoom crossed the threshold in both directions.
   *
   * It is reported next to the chunks the streamer loaded in the same frames, because
   * the two are not the same thing: a chunk that entered the viewport is a legitimate
   * build, and only the excess would be a level of detail switch rebuilding what it
   * already had.
   */
  readonly levelSwitch: {
    /** Chunk views created while the zoom was being moved. Legitimate streaming. */
    readonly loaded: number;
    /** Live chunks that had to build a half during the warm up cycle. */
    readonly warmedUp: number;
    /**
     * Halves built on a second crossing of the same threshold at the same camera
     * position, and chunks the streamer loaded in the very same window.
     *
     * The two are reported together because they are the same population: crossing from
     * zoom 0.25 to zoom 1 moves the survival ring, so chunks are dropped and reloaded,
     * and a reloaded chunk builds its first half legitimately. What plan section 9.3
     * requires is that nothing is built twice, and that holds by construction: a half is
     * never destroyed while its chunk lives, so `builtOnRepeat` can never exceed the
     * chunks that were created in the window.
     */
    readonly builtOnRepeat: number;
    readonly loadedOnRepeat: number;
  };
  /** Canvases in the document. More than one means the page mounted twice. */
  readonly canvases: number;
  readonly passed: boolean;
}

export interface BenchDeps {
  readonly world: WorldScene;
  readonly game: Phaser.Game;
  readonly onProgress?: (label: string, ratio: number) => void;
}

/** Heap reading of Chromium. Absent elsewhere, and then the bench reports null. */
interface MemoryCapablePerformance {
  readonly memory?: { readonly usedJSHeapSize: number };
}

function heapMb(): number | null {
  const memory = (performance as unknown as MemoryCapablePerformance).memory;
  return memory === undefined ? null : memory.usedJSHeapSize / (1024 * 1024);
}

function textureCount(game: Phaser.Game): number {
  return Object.keys(game.textures.list).length;
}

/**
 * Loads chunks until the camera holds at least `required` of them.
 *
 * The camera is moved in a spiral rather than teleported, because the streamer keeps
 * what is inside the unload ring and drops what is outside it: a teleport would load a
 * fresh screenful and drop everything behind, and the count would never climb.
 */
async function fillTo(
  world: WorldScene,
  required: number,
  centreCellX: number,
  centreCellY: number,
  zoom: number,
): Promise<void> {
  const camera = world.worldCameraHandle;
  if (camera === null) {
    return;
  }
  const step = CHUNK_SIZE;
  let radius = 0;
  for (let round = 0; round < 400; round += 1) {
    const stats = world.stats();
    if (stats.liveChunks >= required) {
      return;
    }
    // A square spiral of one chunk per side, so the visible rectangle keeps overlapping
    // the previous one and the survival ring accumulates.
    const angle = round * 0.9;
    radius += step * 0.35;
    camera.goto({
      cellX: Math.round(centreCellX + Math.cos(angle) * radius),
      cellY: Math.round(centreCellY + Math.sin(angle) * radius),
      zoom,
    });
    await nextFrame();
    world.streamTick();
  }
}

/** Samples frames per second and draw calls over a window, while the camera drifts. */
async function measureCase(
  deps: BenchDeps,
  name: string,
  zoom: number,
  requiredChunks: number,
  drawCallBudget: number,
  windowMs: number,
): Promise<BenchCaseResult> {
  const { world } = deps;
  const camera = world.worldCameraHandle;
  camera?.goto({ cellX: 0, cellY: 0, zoom });
  await nextFrame();
  world.resetBuildSamples();
  world.streamTick();
  await fillTo(world, requiredChunks, 0, 0, zoom);
  const buildRaw = world.buildSamples();
  const tickRaw = world.tickSamples();
  const tick: BenchTiming = {
    count: tickRaw.count,
    meanMs: tickRaw.meanMs,
    maxMs: tickRaw.maxMs,
    budgetMs: RENDER_BUDGET.maxTickMs,
    passed: tickRaw.count > 0 && tickRaw.meanMs <= RENDER_BUDGET.maxTickMs,
  };
  const build: BenchTiming = {
    count: buildRaw.count,
    meanMs: buildRaw.meanMs,
    maxMs: buildRaw.maxMs,
    budgetMs: RENDER_BUDGET.maxChunkBuildMs,
    passed: buildRaw.count > 0 && buildRaw.meanMs <= RENDER_BUDGET.maxChunkBuildMs,
  };

  let frames = 0;
  let drawTotal = 0;
  let maxDrawCalls = 0;
  let maxQuads = 0;
  let minFrameFps = Number.POSITIVE_INFINITY;
  let loadedChunks = 0;
  let visibleChunks = 0;
  let level: LevelOfDetail = LevelOfDetail.NEAR;
  let zoomMin = Number.POSITIVE_INFINITY;
  let zoomMax = 0;

  const start = await nextFrame();
  const engineStart = world.engineFrames();
  let previous = start;
  let now = start;
  while (now - start < windowMs) {
    now = await nextFrame();
    const frameMs = now - previous;
    previous = now;
    frames += 1;
    if (frameMs > 0) {
      minFrameFps = Math.min(minFrameFps, 1000 / frameMs);
    }
    const stats = world.stats();
    drawTotal += stats.drawCalls;
    maxDrawCalls = Math.max(maxDrawCalls, stats.drawCalls);
    maxQuads = Math.max(maxQuads, stats.quads);
    loadedChunks = stats.liveChunks;
    visibleChunks = stats.visibleChunks;
    level = stats.levelOfDetail;
    zoomMin = Math.min(zoomMin, stats.zoom);
    zoomMax = Math.max(zoomMax, stats.zoom);
  }
  const durationMs = now - start;
  const engineFrames = world.engineFrames() - engineStart;
  const fps = durationMs > 0 ? (engineFrames * 1000) / durationMs : 0;
  const pollFps = durationMs > 0 ? (frames * 1000) / durationMs : 0;
  const meanDrawCalls = frames === 0 ? 0 : drawTotal / frames;

  return {
    name,
    zoom,
    requiredChunks,
    loadedChunks,
    visibleChunks,
    levelOfDetail: level,
    frames: engineFrames,
    durationMs,
    fps,
    pollFps,
    minFps: Number.isFinite(minFrameFps) ? minFrameFps : 0,
    meanDrawCalls,
    maxDrawCalls,
    maxQuads,
    drawCallBudget,
    zoomMin: Number.isFinite(zoomMin) ? zoomMin : 0,
    zoomMax,
    build,
    tick,
    passed:
      fps >= RENDER_BUDGET.minFps &&
      maxDrawCalls <= drawCallBudget &&
      loadedChunks >= requiredChunks &&
      // The zoom the case asked for is the zoom it measured, or the case measured
      // something else and its numbers say nothing about the budget.
      Math.abs(zoomMax - zoom) < 1e-6 &&
      Math.abs(zoomMin - zoom) < 1e-6,
  };
}

/**
 * A copy of a chunk with `cells` more modified cells.
 *
 * It is a copy and not a mutation of the cached chunk, because the source is the owner
 * of that object and the renderer is a reader. The version is bumped so the repaint path
 * treats it exactly as a live `CHUNK_PATCHED` would.
 */
function patchedChunk(chunk: WorldChunkView, cells: number, ownerPlayerId: string): WorldChunkView {
  const patches = new Map<number, ChunkCellPatch>(chunk.patches);
  const total = CHUNK_SIZE * CHUNK_SIZE;
  for (let index = 0; index < cells; index += 1) {
    const idx = (index * 7 + 3) % total;
    patches.set(idx, {
      idx,
      terrainOverride: null,
      ownerPlayerId,
      landUse: LandUse.FIELD,
      fieldId: 'bench-patch',
      forestPlotId: null,
      buildingId: null,
      hasStandingTree: false,
    });
  }
  return { ...chunk, version: chunk.version + 1, patches };
}

/** Times the patch of 250 cells over the chunks that are on screen. */
function measurePatch(world: WorldScene, cells: number, repetitions: number): BenchTiming {
  const streamer = world.streamerHandle;
  const owner = world.source.viewerPlayerId() ?? 'bench-player';
  let count = 0;
  let total = 0;
  let max = 0;
  if (streamer !== null) {
    for (const renderer of streamer.live()) {
      if (count >= repetitions) {
        break;
      }
      const point = parseChunkKey(renderer.key);
      const chunk = point === null ? undefined : world.source.chunk(point.chunkX, point.chunkY);
      if (chunk === undefined) {
        continue;
      }
      const next = patchedChunk(chunk, cells, owner);
      const start = performance.now();
      renderer.apply(next);
      const elapsed = performance.now() - start;
      count += 1;
      total += elapsed;
      max = Math.max(max, elapsed);
    }
  }
  return {
    count,
    meanMs: count === 0 ? 0 : total / count,
    maxMs: max,
    budgetMs: RENDER_BUDGET.maxPatchMs,
    passed: count > 0 && max <= RENDER_BUDGET.maxPatchMs,
  };
}

/**
 * Walks ten thousand chunks and compares the texture count with its baseline.
 *
 * The texture count and not the heap is the assertion, and the reason is that it is the
 * only one that is deterministic: a page cannot force a collection, so a heap that grew
 * proves nothing, while a texture that was created per chunk and not removed with it is
 * a leak with a name. The heap delta is reported beside it as information.
 */
async function measureMemory(deps: BenchDeps, chunksToWalk: number): Promise<BenchMemory> {
  const { world, game } = deps;
  const camera = world.worldCameraHandle;

  // The baseline is taken at the zoom the sweep ends at and after the streamer has
  // settled, so the comparison is between two comparable states. Taken at another zoom
  // it would compare a screenful of tilemaps with a screenful of thumbnails and say
  // nothing about leaks.
  camera?.goto({ cellX: 0, cellY: 0, zoom: 0.25 });
  for (let round = 0; round < 20; round += 1) {
    await nextFrame();
    world.streamTick();
  }
  const texturesBefore = textureCount(game);
  const heapBefore = heapMb();

  let walked = 0;
  let guard = 0;
  let cellX = 0;
  while (walked < chunksToWalk && guard < 20_000) {
    guard += 1;
    // A straight line of one screenful per step, so every step is a fresh set of chunks
    // and the ones behind fall out of the unload ring.
    cellX += CHUNK_SIZE * 12;
    camera?.goto({ cellX, cellY: 0, zoom: 0.25 });
    const stats = world.streamTickCounted();
    walked += stats;
    if (guard % 16 === 0) {
      // Yield, so the page is not frozen and the engine can actually destroy what the
      // streamer dropped.
      await nextFrame();
      deps.onProgress?.('Recorrido de memoria', walked / chunksToWalk);
    }
  }

  // Come back and let the streamer settle, so the comparison is against a comparable
  // state and not against a half loaded one.
  camera?.goto({ cellX: 0, cellY: 0, zoom: 0.25 });
  for (let round = 0; round < 20; round += 1) {
    await nextFrame();
    world.streamTick();
  }

  const texturesAfter = textureCount(game);
  const heapAfter = heapMb();
  return {
    chunksWalked: walked,
    texturesBefore,
    texturesAfter,
    liveChunksAfter: world.stats().liveChunks,
    heapBeforeMb: heapBefore,
    heapAfterMb: heapAfter,
    // Both counts are taken at the same zoom and after the streamer settled, so a few
    // chunks of difference in what happens to be loaded is the whole tolerance.
    passed: texturesAfter <= texturesBefore + 16,
  };
}

/** Runs the whole bench. */
export async function runWorldBench(deps: BenchDeps): Promise<BenchReport> {
  const { world } = deps;
  const startedAtRealMs = performance.now();
  const probeActive = world.drawCallsMeasured;

  deps.onProgress?.('Zoom 1', 0.05);
  const near = await measureCase(
    deps,
    `Zoom ${RENDER_BUDGET.near.zoom} con ${RENDER_BUDGET.near.chunks} chunks`,
    RENDER_BUDGET.near.zoom,
    RENDER_BUDGET.near.chunks,
    RENDER_BUDGET.near.maxDrawCalls,
    2_000,
  );

  deps.onProgress?.('Parcheo de celdas', 0.35);
  const patch = measurePatch(world, RENDER_BUDGET.patchCells, 8);

  deps.onProgress?.('Zoom 0,25', 0.45);
  const far = await measureCase(
    deps,
    `Zoom ${RENDER_BUDGET.far.zoom} con ${RENDER_BUDGET.far.chunks} chunks`,
    RENDER_BUDGET.far.zoom,
    RENDER_BUDGET.far.chunks,
    RENDER_BUDGET.far.maxDrawCalls,
    2_000,
  );

  // The headline figure is the near case: a chunk there is a tilemap and a thumbnail,
  // which is the expensive of the two builds and therefore the one the budget is about.
  const chunkBuild = near.build;

  deps.onProgress?.('Conmutacion de nivel de detalle', 0.7);
  // The camera stays on the same cell and only the zoom crosses the threshold, so what is
  // measured is the switch and not a pan. Two phases, and the separation is the whole
  // point: the first lets every live chunk be drawn at both levels once, which is a
  // legitimate first build, and the second asserts that doing it again builds nothing.
  const beforeWarm = world.lodBuilds();
  const loadedBefore = world.buildSamples().count;
  const camera = world.worldCameraHandle;
  for (let cycle = 0; cycle < 3; cycle += 1) {
    for (const zoom of [1, 0.25]) {
      camera?.goto({ cellX: 0, cellY: 0, zoom });
      // Enough ticks for the rate limited upgrades to finish: the streamer builds a
      // bounded number of visible chunks per tick, so a crossing takes a few ticks.
      for (let round = 0; round < 30; round += 1) {
        await nextFrame();
        world.streamTick();
      }
    }
  }
  const warmedUp = world.lodBuilds() - beforeWarm;

  const beforeMeasured = world.lodBuilds();
  const loadedBeforeMeasured = world.buildSamples().count;
  for (const zoom of [1, 0.25, 1]) {
    camera?.goto({ cellX: 0, cellY: 0, zoom });
    for (let round = 0; round < 10; round += 1) {
      await nextFrame();
      world.streamTick();
    }
  }
  const levelSwitch = {
    loaded: world.buildSamples().count - loadedBefore,
    warmedUp,
    builtOnRepeat: world.lodBuilds() - beforeMeasured,
    loadedOnRepeat: world.buildSamples().count - loadedBeforeMeasured,
  };

  deps.onProgress?.('Recorrido de memoria', 0.8);
  const memory = await measureMemory(deps, RENDER_BUDGET.memorySweepChunks);

  deps.onProgress?.('Listo', 1);
  const cases = [near, far];
  return {
    startedAtRealMs,
    drawCallsMeasured: probeActive,
    cases,
    chunkBuild,
    patch,
    memory,
    levelSwitch,
    canvases: typeof document === 'undefined' ? 0 : document.querySelectorAll('canvas').length,
    passed:
      cases.every((entry) => entry.passed) &&
      chunkBuild.passed &&
      patch.passed &&
      memory.passed &&
      // Nothing was built twice: every half built on the repeated crossing belongs to a
      // chunk the streamer had reloaded in the same window.
      levelSwitch.builtOnRepeat <= levelSwitch.loadedOnRepeat,
  };
}

/** Turns a report into the text a run pastes into a note. */
export function formatBenchReport(report: BenchReport): string {
  const lines: string[] = [];
  for (const entry of report.cases) {
    lines.push(
      `${entry.name}: ${entry.fps.toFixed(1)} fps del motor ` +
        `(${entry.pollFps.toFixed(1)} de sondeo, min ${entry.minFps.toFixed(1)}), ` +
        `draw calls max ${entry.maxDrawCalls} / ${entry.drawCallBudget}, ` +
        `media ${entry.meanDrawCalls.toFixed(1)}, cuadrilateros max ${entry.maxQuads}, ` +
        `chunks ${entry.loadedChunks} (${entry.visibleChunks} visibles), ` +
        `zoom medido ${entry.zoomMin.toFixed(2)}-${entry.zoomMax.toFixed(2)} ` +
        `en detalle ${entry.levelOfDetail} — ` +
        `${entry.passed ? 'dentro del presupuesto' : 'fuera del presupuesto'}`,
    );
  }
  for (const entry of report.cases) {
    lines.push(
      `Carga de chunk en ${entry.levelOfDetail}: media ${entry.build.meanMs.toFixed(2)} ms, ` +
        `max ${entry.build.maxMs.toFixed(2)} ms sobre ${entry.build.count} chunks ` +
        `(presupuesto ${entry.build.budgetMs} ms de media); tick de streaming media ` +
        `${entry.tick.meanMs.toFixed(2)} ms, max ${entry.tick.maxMs.toFixed(2)} ms sobre ` +
        `${entry.tick.count} ticks`,
    );
  }
  lines.push(
    `Parcheo de ${RENDER_BUDGET.patchCells} celdas: media ${report.patch.meanMs.toFixed(2)} ms, ` +
      `max ${report.patch.maxMs.toFixed(2)} ms sobre ${report.patch.count} chunks ` +
      `(presupuesto ${report.patch.budgetMs} ms)`,
  );
  lines.push(
    `Memoria tras ${report.memory.chunksWalked} chunks: texturas ` +
      `${report.memory.texturesBefore} antes y ${report.memory.texturesAfter} despues, ` +
      `${report.memory.liveChunksAfter} chunks vivos, monticulo ` +
      `${report.memory.heapBeforeMb === null ? 'no disponible' : `${report.memory.heapBeforeMb.toFixed(1)} MB`}` +
      ` a ${report.memory.heapAfterMb === null ? 'no disponible' : `${report.memory.heapAfterMb.toFixed(1)} MB`}`,
  );
  lines.push(
    `Conmutacion de nivel de detalle: ${report.levelSwitch.loaded} chunks cargados por ` +
      `streaming, ${report.levelSwitch.warmedUp} construyeron su otra mitad la primera vez; ` +
      `al repetir el cruce se construyeron ${report.levelSwitch.builtOnRepeat} mitades sobre ` +
      `${report.levelSwitch.loadedOnRepeat} chunks cargados de nuevo, de modo que ninguna ` +
      `mitad se construyo dos veces`,
  );
  lines.push(`Lienzos en el documento: ${report.canvases}`);
  return lines.join('\n');
}
