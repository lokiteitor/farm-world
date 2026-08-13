// Counting draw calls.
//
// Owner: workflow W4-D (world rendering). Plan section 9.3 states a budget in draw
// calls and adds that it must be "exigible y no aspiracional". Phaser 3.90 publishes
// `drawCount` on the canvas renderer and nothing equivalent on the WebGL one, so the
// number has to be obtained rather than read.
//
// It is obtained from the only place that cannot be wrong: the WebGL context of this
// game instance. `drawArrays` and `drawElements` are wrapped with a counter, so what is
// reported is what the driver was asked to draw, batching, pipeline flushes and render
// textures included. The alternative, counting game objects, measures the scene graph
// and not the renderer, and the two differ by exactly the thing the budget is about.
//
// The wrapping is local to the context of one game and is undone on dispose. No Phaser
// prototype is patched, so nothing here leaks into another instance or into a test.

import Phaser from 'phaser';

export interface DrawCallProbe {
  /** Draw calls since the previous sample. Called once per frame. */
  sample(): number;
  /** Whether a real counter is installed, as opposed to the fallback of zero. */
  readonly active: boolean;
  dispose(): void;
}

/** A probe that reports nothing, for a renderer that offers no counter. */
const INERT: DrawCallProbe = {
  sample: () => 0,
  active: false,
  dispose: () => undefined,
};

type DrawArrays = WebGLRenderingContext['drawArrays'];
type DrawElements = WebGLRenderingContext['drawElements'];

export function attachDrawCallProbe(game: Phaser.Game): DrawCallProbe {
  const renderer = game.renderer;

  if (renderer instanceof Phaser.Renderer.Canvas.CanvasRenderer) {
    let previous = 0;
    return {
      sample: () => {
        const current = renderer.drawCount;
        const delta = current - previous;
        previous = current;
        return Math.max(0, delta);
      },
      active: true,
      dispose: () => undefined,
    };
  }

  const gl = (renderer as Phaser.Renderer.WebGL.WebGLRenderer).gl as
    WebGLRenderingContext | null | undefined;
  if (gl === null || gl === undefined) {
    return INERT;
  }

  let calls = 0;
  const originalDrawArrays = gl.drawArrays.bind(gl) as DrawArrays;
  const originalDrawElements = gl.drawElements.bind(gl) as DrawElements;

  gl.drawArrays = function countedDrawArrays(mode: number, first: number, count: number): void {
    calls += 1;
    originalDrawArrays(mode, first, count);
  };
  gl.drawElements = function countedDrawElements(
    mode: number,
    count: number,
    type: number,
    offset: number,
  ): void {
    calls += 1;
    originalDrawElements(mode, count, type, offset);
  };

  return {
    sample: () => {
      const drawn = calls;
      calls = 0;
      return drawn;
    },
    active: true,
    dispose: () => {
      gl.drawArrays = originalDrawArrays;
      gl.drawElements = originalDrawElements;
    },
  };
}
