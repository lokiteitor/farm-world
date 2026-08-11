// Boot scene.
//
// Owner: workflow W3-D (rendering core). First of the four scenes of plan section
// 9.2. It configures what belongs to the renderer and to the camera and hands over
// immediately: it loads nothing, because there is nothing to load, and it draws
// nothing, because the progress bar belongs to the scene that makes the progress.
//
// What is here and not in the game configuration: everything that is a property of a
// camera or of a context rather than of the game. The configuration object cannot
// set them, and setting them once at boot is what keeps every later scene from having
// to remember.

import Phaser from 'phaser';
import { PALETTE } from '../textures/palette';
import { GamePhase, type GameBridge } from './bridge';
import { SCENE_KEYS } from './scenes';

export class BootScene extends Phaser.Scene {
  private readonly bridge: GameBridge;

  constructor(bridge: GameBridge) {
    super({ key: SCENE_KEYS.BOOT });
    this.bridge = bridge;
  }

  create(): void {
    this.bridge.setPhase(GamePhase.BOOTING);

    // Rounding on the camera as well as on the game: the game flag rounds the
    // vertices of a sprite, the camera flag rounds the scroll, and a fractional
    // scroll with rounded vertices still shifts the whole world by half a pixel,
    // which reads as a shimmer while panning.
    this.cameras.main.setRoundPixels(true);
    this.cameras.main.setBackgroundColor(PALETTE.ui.canvasVoid);

    // Nearest neighbour on the canvas renderer too. Under WebGL the texture filter
    // comes from `pixelArt`, but the canvas fallback has its own smoothing flag and
    // ignores it, and the fallback is what a machine without a GPU gets.
    const context = this.sys.game.context;
    if (
      typeof CanvasRenderingContext2D !== 'undefined' &&
      context instanceof CanvasRenderingContext2D
    ) {
      context.imageSmoothingEnabled = false;
    }

    this.scene.start(SCENE_KEYS.PRELOAD);
  }
}
