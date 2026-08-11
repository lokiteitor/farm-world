// Preload scene.
//
// Owner: workflow W3-D (rendering core). Second of the four scenes of plan section
// 9.2, and the one that makes plan section 9.4 true: it generates every texture of
// the game by code and makes exactly zero calls to `this.load`. There is no asset
// directory, no atlas file and no network request for art.
//
// The progress bar is real. It is driven by the steps of the factory, not by a
// tween: `TextureFactory` yields a frame between steps precisely so the bar it draws
// is presented, and the label under the bar names the step that just finished. A
// simulated bar would be worse than none, because it would hide a step that hangs.
//
// Handing over to the world. This scene starts the world scene of W4 if it is
// registered, and otherwise stops after publishing the report. That is what lets the
// inspection route of this phase boot the same pipeline with no world at all, and it
// is why W4 has nothing to change here: it registers its scene through `createGame`.

import Phaser from 'phaser';
import { TextureFactory, type TextureProgress } from '../textures/factory';
import { PALETTE } from '../textures/palette';
import { GamePhase, type GameBridge } from './bridge';
import { SCENE_KEYS } from './scenes';

/** Geometry of the progress bar, in pixels. */
const BAR = { width: 320, height: 10, labelGap: 18 } as const;

export class PreloadScene extends Phaser.Scene {
  private readonly bridge: GameBridge;

  private readonly startSceneKey: string;

  private bar: Phaser.GameObjects.Graphics | null = null;

  private label: Phaser.GameObjects.Text | null = null;

  constructor(bridge: GameBridge, startSceneKey: string = SCENE_KEYS.WORLD) {
    super({ key: SCENE_KEYS.PRELOAD });
    this.bridge = bridge;
    this.startSceneKey = startSceneKey;
  }

  create(): void {
    this.bridge.setPhase(GamePhase.GENERATING);
    this.drawChrome();
    void this.generate();
  }

  /** The frame of the bar and its label, drawn once. */
  private drawChrome(): void {
    const { width, height } = this.scale.gameSize;
    const originX = Math.round((width - BAR.width) / 2);
    const originY = Math.round(height / 2);

    const frame = this.add.graphics();
    frame.lineStyle(1, PALETTE.ui.cursorNeutral, 0.35);
    frame.strokeRect(originX - 0.5, originY - 0.5, BAR.width + 1, BAR.height + 1);

    this.bar = this.add.graphics();
    this.label = this.add.text(originX, originY + BAR.labelGap, 'Generando texturas', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '12px',
      color: '#9aa4b2',
    });
  }

  /** Redraws the filled part of the bar. Called once per step, never per frame. */
  private renderProgress(progress: TextureProgress): void {
    const { width, height } = this.scale.gameSize;
    const originX = Math.round((width - BAR.width) / 2);
    const originY = Math.round(height / 2);

    this.bar?.clear();
    this.bar?.fillStyle(PALETTE.ui.cursorValid, 0.9);
    this.bar?.fillRect(originX, originY, Math.round(BAR.width * progress.ratio), BAR.height);
    this.label?.setText(`${progress.label} (${progress.completed}/${progress.total})`);
  }

  /**
   * Runs the factory and hands over.
   *
   * A failure of a single step is not fatal and is carried in the report; a failure of
   * the whole generation is, and it moves the bridge to `FAILED` so the viewport can
   * say so instead of showing an empty canvas.
   */
  private async generate(): Promise<void> {
    const factory = new TextureFactory(this);
    try {
      const report = await factory.generate((progress) => {
        this.renderProgress(progress);
        this.bridge.emit('progress', progress);
      });
      this.bridge.setReport(report);
      this.handOver();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.bridge.emit('failed', { reason });
      this.bridge.setPhase(GamePhase.FAILED);
      this.label?.setText(`No se pudo generar el arte: ${reason}`);
    }
  }

  /** Starts the world scene when there is one, and otherwise stays out of the way. */
  private handOver(): void {
    if (this.scene.manager.keys[this.startSceneKey] === undefined) {
      // No world scene registered: the inspection route and any future harness boot
      // the pipeline for its textures alone. Leave the bar on screen, since it is the
      // only thing this scene has drawn.
      return;
    }
    this.scene.start(this.startSceneKey);
  }
}
