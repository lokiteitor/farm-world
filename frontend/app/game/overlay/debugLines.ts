// The lines of the F3 counter.
//
// Owner: workflow W4-D (world rendering). Pure formatting, separated from the scene
// that draws it for the usual reason: what the counter says is asserted in a test, and
// the drawing is three calls to Phaser that a test cannot say anything useful about.
//
// The seven values are the ones the brief of this workflow lists, and each one answers a
// question that comes up while looking at the canvas: is the frame budget being met, at
// what zoom and therefore in which level of detail, how much is loaded against how much
// is on screen, what the renderer is actually being asked to draw, and whether the
// streamer is waiting on the network. Text and not a graph, because the number matters
// and its history does not.

import { RENDER_BUDGET } from '../world/config';
// A type-only import, written with `import type` and not with an inline `type` keyword:
// `verbatimModuleSyntax` keeps the import statement of the second form, which would pull
// the world scene, and with it Phaser, into a unit test that has no canvas.
import type { WorldStats } from '../world/WorldScene';

/** Formats a number of milliseconds with one decimal, which is the useful precision. */
function ms(value: number): string {
  return `${value.toFixed(1)} ms`;
}

/**
 * The counter, one line per fact.
 *
 * The draw call line carries its ceiling, which depends on the level of detail: the two
 * cases of plan section 9.3 have different budgets and a single number would be either
 * too tight at zoom 0.25 or meaningless at zoom 1.
 */
export function debugLines(stats: WorldStats): readonly string[] {
  const budget =
    stats.levelOfDetail === 'NEAR'
      ? RENDER_BUDGET.near.maxDrawCalls
      : RENDER_BUDGET.far.maxDrawCalls;
  return [
    `FPS ${stats.fps.toFixed(0)} (min ${RENDER_BUDGET.minFps})`,
    `Zoom ${stats.zoom.toFixed(2)} · Detalle ${stats.levelOfDetail === 'NEAR' ? 'cerca' : 'lejos'}`,
    `Chunks ${stats.liveChunks} cargados · ${stats.visibleChunks} visibles`,
    `Draw calls ${stats.drawCalls} / ${budget} · ${stats.quads} cuadrilateros`,
    `Contornos ${stats.outlineSegments} segmentos (${ms(stats.lastOutlineMs)})`,
    `Streaming ${ms(stats.lastTickMs)} · chunk ${ms(stats.lastChunkBuildMs)}`,
    `Peticiones en vuelo ${stats.inFlightRequests}`,
  ];
}

/** True when a value is outside its budget, so the counter can colour the line. */
export function isOverBudget(stats: WorldStats): boolean {
  const budget =
    stats.levelOfDetail === 'NEAR'
      ? RENDER_BUDGET.near.maxDrawCalls
      : RENDER_BUDGET.far.maxDrawCalls;
  return stats.drawCalls > budget || stats.fps < RENDER_BUDGET.minFps;
}
