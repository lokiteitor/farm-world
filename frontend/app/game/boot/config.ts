// Renderer configuration.
//
// Owner: workflow W3-D (rendering core). It implements the rendering decisions of
// plan section 9.3, and each one has a concrete reason:
//
//   - `pixelArt`. Every texture is generated at 16 px per cell and scaled by the
//     camera zoom. With bilinear filtering a tile of 16 px at zoom 0.5 samples
//     between texels and the whole world turns into a blur; with nearest filtering it
//     stays legible. Phaser derives `antialias: false`, `antialiasGL: false` and
//     `roundPixels: true` from this flag, and all three are declared anyway because a
//     future reader should not have to know that.
//   - `roundPixels`. Sprite positions are rounded to the pixel, which stops the one
//     pixel jitter of a machine crossing a cell boundary at fractional zoom.
//   - `batchSize`. The near level of detail budgets about 110 draw calls and 8 000
//     quads at zoom 1 (plan section 9.3). The default batch of 4 096 quads would
//     split a large tilemap layer into several draw calls for no reason; 8 192 keeps
//     it in one and stays well inside the 16 bit index limit of the pipeline
//     (8 192 x 6 = 49 152 indices).
//   - `banner: false`. The console is a verification surface for this project: the
//     inspection route asserts that generating the art produces no console output, and
//     the Phaser banner would be noise in that assertion.
//   - `Scale.RESIZE`. The CSS grid of plan section 9.1 decides the size of the
//     viewport and a `ResizeObserver` tells Phaser about it. Phaser must never decide
//     the layout, so there is no `FIT`, no `autoCenter` and no fixed aspect ratio.

import Phaser from 'phaser';
import { PALETTE, toCssHex } from '../textures/palette';
import { SCENE_KEYS } from './scenes';

/** Frames per second the renderer targets. */
export const TARGET_FPS = 60;

/**
 * Builds the Phaser configuration for a host element.
 *
 * The scenes are a parameter and not a constant of this module: the boot path is the
 * same for the game and for the inspection route, and the route registers only the
 * two boot scenes because it has no world to show. The world scenes of W4 and W5
 * arrive the same way, through `createGame`.
 */
export function createGameConfig(
  host: HTMLElement,
  scenes: readonly Phaser.Types.Scenes.SceneType[],
): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent: host,
    // The host is sized by the CSS grid; these are only the initial numbers, and
    // `Scale.RESIZE` replaces them as soon as the observer reports.
    width: host.clientWidth > 0 ? host.clientWidth : 800,
    height: host.clientHeight > 0 ? host.clientHeight : 600,
    backgroundColor: toCssHex(PALETTE.ui.canvasVoid),
    banner: false,
    // The world canvas has its own context menu affordances; the browser one would
    // fire in the middle of a right button drag.
    disableContextMenu: true,
    // Do not steal focus from the panels: every text input of the client is HTML.
    autoFocus: false,
    pixelArt: true,
    roundPixels: true,
    render: {
      antialias: false,
      antialiasGL: false,
      pixelArt: true,
      roundPixels: true,
      batchSize: 8192,
      powerPreference: 'high-performance',
      // No mipmaps: the far level of detail is a 32 x 32 thumbnail per chunk drawn as
      // one quad (plan section 9.3), which is already the reduced representation.
      mipmapFilter: 'NEAREST',
    },
    fps: {
      target: TARGET_FPS,
      // No forced timestep: an idle management game has nothing that needs a fixed
      // step, and forcing one wastes battery on a page that is often left open.
      forceSetTimeOut: false,
    },
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.NO_CENTER,
    },
    scene: [...scenes],
  };
}

/** Keys of the scenes the boot path always registers. */
export const BOOT_SCENE_KEYS: readonly string[] = [SCENE_KEYS.BOOT, SCENE_KEYS.PRELOAD];
