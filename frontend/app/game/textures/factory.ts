// Texture factory.
//
// Owner: workflow W3-D (rendering core). The project has no graphic asset: plan
// section 9.4 requires every texture to be generated at boot, and `PreloadScene`
// makes exactly zero calls to the Phaser loader. This module is the only place that
// touches the Phaser texture manager, so everything else in this directory stays a
// pure function over byte buffers and is unit testable without a browser.
//
// Two responsibilities, and they are kept apart on purpose:
//
//   1. Upload. Pixel buffers become canvas textures with per tile frames; the
//      catalogue of shapes becomes one canvas texture each through
//      `Graphics.generateTexture`.
//   2. Report. Each step is timed and the total is compared against the budget of
//      250 ms that the brief of this phase fixes. The budget is measured and
//      published in the inspection route, so it is enforceable rather than
//      aspirational.
//
// About the two times in the report. `generationMs` is the sum of the work of the
// steps and is what the budget applies to. `wallMs` also includes the frame the
// factory yields between steps, which it does so the progress bar actually paints:
// a canvas draw is not presented until the frame ends, so a loop without yields
// would show an empty bar and then a full one, which is not a progress bar. Nine
// yielded frames are about 150 ms of wall time that no amount of optimisation would
// remove, and confusing the two numbers would make the budget meaningless.

import Phaser from 'phaser';
import { buildGridTile } from './grid';
import { TEXTURE_KEYS } from './keys';
import { applyPaletteCssVariables } from './palette';
import { atlasSize, type PixelBuffer, type TilesetGeometry, tileOrigin } from './pixels';
import { SPRITE_CATALOGUE, SpriteGroup, spritesByGroup, type SpriteSpec } from './shapes';
import { buildTerrainAtlas, TERRAIN_ATLAS_GEOMETRY, TERRAIN_TILE_COUNT } from './terrain-atlas';
import { buildUsageAtlas, USAGE_ATLAS_GEOMETRY, USAGE_TILE_COUNT } from './usage-atlas';

/**
 * Budget of the whole generation, in milliseconds of work. Fixed by the brief of
 * workflow W3. It is a boot cost paid once per page load, and it competes with the
 * time to first interaction, which is why it is small.
 */
export const TEXTURE_BUDGET_MS = 250;

/** What one step of the generation did, and how long its work took. */
export interface TextureStepReport {
  readonly key: string;
  readonly label: string;
  readonly durationMs: number;
  readonly textures: number;
}

/** A step that threw. The generation continues: one missing sprite is not a dead boot. */
export interface TextureStepFailure {
  readonly key: string;
  readonly message: string;
}

/** Outcome of a full generation. */
export interface TextureGenerationReport {
  readonly steps: readonly TextureStepReport[];
  readonly failures: readonly TextureStepFailure[];
  /** Sum of the work of the steps. This is what the budget applies to. */
  readonly generationMs: number;
  /** Wall clock, yielded frames included. */
  readonly wallMs: number;
  readonly textureCount: number;
  readonly budgetMs: number;
  readonly withinBudget: boolean;
}

/** Progress of the generation, emitted once per step. */
export interface TextureProgress {
  /** Steps already finished. */
  readonly completed: number;
  readonly total: number;
  /** Label of the step just finished, in Spanish. */
  readonly label: string;
  /** `completed / total`, in 0..1. */
  readonly ratio: number;
  readonly elapsedMs: number;
}

/** One unit of work of the generation. */
interface TextureStep {
  readonly key: string;
  readonly label: string;
  run(): number;
}

/**
 * Yields one frame, so whatever was drawn is presented before the next step runs.
 *
 * The timer is not a fallback for a browser without `requestAnimationFrame`: it is
 * the deadline for a browser that has stopped producing frames. A hidden tab receives
 * no animation frame at all, so a generation that only awaited frames would stall
 * with the progress bar half drawn and resume only when the tab is shown again. The
 * timer keeps the work moving; whichever fires first wins, which under normal
 * conditions is the frame.
 */
const FRAME_DEADLINE_MS = 50;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(done);
    }
    setTimeout(done, FRAME_DEADLINE_MS);
  });
}

/**
 * Generates every texture of the game into the texture manager of a scene.
 *
 * The instance is disposable: one generation per boot. It is a class and not a
 * function because the `Graphics` object used to bake the shape catalogue is
 * expensive to create and is reused across the eight hundred odd draw calls of the
 * catalogue, and it has to be destroyed afterwards.
 */
export class TextureFactory {
  private readonly scene: Phaser.Scene;

  private readonly steps: readonly TextureStep[];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.steps = this.buildSteps();
  }

  /** Number of steps, which is what the progress bar divides by. */
  get stepCount(): number {
    return this.steps.length;
  }

  /**
   * Runs every step in order, yielding a frame between them and reporting progress
   * after each one.
   *
   * A step that throws is recorded and skipped. The reason is a judgement about
   * failure modes: a texture that fails to generate produces a magenta placeholder
   * in one sprite, whereas an exception escaping the preload scene leaves the player
   * looking at a blank canvas with no explanation. The report carries the failures
   * and the inspection route shows them.
   */
  async generate(
    onProgress?: (progress: TextureProgress) => void,
  ): Promise<TextureGenerationReport> {
    const wallStart = performance.now();
    const steps: TextureStepReport[] = [];
    const failures: TextureStepFailure[] = [];
    let generationMs = 0;
    let textureCount = 0;

    for (let index = 0; index < this.steps.length; index += 1) {
      const step = this.steps[index];
      if (step === undefined) {
        continue;
      }
      await nextFrame();
      const start = performance.now();
      let textures = 0;
      try {
        textures = step.run();
      } catch (error) {
        failures.push({
          key: step.key,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      const durationMs = performance.now() - start;
      generationMs += durationMs;
      textureCount += textures;
      steps.push({ key: step.key, label: step.label, durationMs, textures });
      onProgress?.({
        completed: index + 1,
        total: this.steps.length,
        label: step.label,
        ratio: (index + 1) / this.steps.length,
        elapsedMs: performance.now() - wallStart,
      });
    }

    return {
      steps,
      failures,
      generationMs,
      wallMs: performance.now() - wallStart,
      textureCount,
      budgetMs: TEXTURE_BUDGET_MS,
      withinBudget: generationMs <= TEXTURE_BUDGET_MS,
    };
  }

  /**
   * The list of steps.
   *
   * The grouping is not arbitrary: it is the grouping the progress bar shows, so a
   * step is a unit the player can read ("terreno", "maquinaria") and not a unit of
   * implementation. The sprite catalogue is split by family for the same reason.
   */
  private buildSteps(): readonly TextureStep[] {
    const spriteStep = (group: SpriteGroup, label: string): TextureStep => ({
      key: `sprites:${group}`,
      label,
      run: () => this.bakeSprites(spritesByGroup(group)),
    });

    return [
      {
        key: 'palette',
        label: 'Paleta y variables CSS',
        run: () => {
          // The palette reaches the CSS from the same module the canvas reads, which
          // is what makes the legend and the tiles unable to disagree (plan 9.4).
          if (typeof document !== 'undefined') {
            applyPaletteCssVariables(document.documentElement);
          }
          return 0;
        },
      },
      {
        key: 'terrain',
        label: 'Atlas de terreno',
        run: () =>
          this.uploadAtlas(
            TEXTURE_KEYS.terrainAtlas,
            buildTerrainAtlas(),
            TERRAIN_ATLAS_GEOMETRY,
            TERRAIN_TILE_COUNT,
          ),
      },
      {
        key: 'usage',
        label: 'Atlas de uso del suelo',
        run: () =>
          this.uploadAtlas(
            TEXTURE_KEYS.usageAtlas,
            buildUsageAtlas(),
            USAGE_ATLAS_GEOMETRY,
            USAGE_TILE_COUNT,
          ),
      },
      {
        key: 'grid',
        label: 'Rejilla de celdas',
        run: () => this.uploadBuffer(TEXTURE_KEYS.grid, buildGridTile()),
      },
      spriteStep(SpriteGroup.BUILDING, 'Edificios'),
      spriteStep(SpriteGroup.MACHINE, 'Maquinaria'),
      spriteStep(SpriteGroup.WORKER, 'Trabajadores'),
      spriteStep(SpriteGroup.TREE, 'Arboles'),
      spriteStep(SpriteGroup.CURSOR, 'Cursores'),
      spriteStep(SpriteGroup.PARTICLE, 'Particulas'),
    ];
  }

  /**
   * Uploads a pixel buffer as a canvas texture. Replaces an existing key, so a hot
   * reload of the dev server does not accumulate stale textures.
   */
  private uploadBuffer(key: string, buffer: PixelBuffer): number {
    const textures = this.scene.textures;
    if (textures.exists(key)) {
      textures.remove(key);
    }
    const texture = textures.createCanvas(key, buffer.width, buffer.height);
    if (texture === null) {
      throw new Error(`The texture manager refused the canvas of ${key}`);
    }
    const imageData = texture.imageData;
    imageData.data.set(buffer.data);
    texture.putData(imageData, 0, 0);
    // `update` rebuilds the internal views and re-uploads to the GPU under WebGL.
    texture.update();
    return 1;
  }

  /**
   * Uploads an extruded atlas and registers one frame per tile.
   *
   * Two consumers, one texture. A Phaser tilemap reads the raw image and applies
   * margin and spacing itself, so it needs no frames; the inspection route and any
   * sprite that shows a single tile need frames. The frame of tile `n` is named `n`,
   * and its rectangle is computed with the same `tileOrigin` the atlas writer used,
   * which is what guarantees the frame and the tilemap point at the same pixels.
   */
  private uploadAtlas(
    key: string,
    buffer: PixelBuffer,
    geometry: TilesetGeometry,
    tileCount: number,
  ): number {
    const expected = atlasSize(geometry);
    if (buffer.width !== expected.width || buffer.height !== expected.height) {
      throw new Error(
        `Atlas ${key} is ${buffer.width}x${buffer.height} and the geometry says ` +
          `${expected.width}x${expected.height}`,
      );
    }
    this.uploadBuffer(key, buffer);
    const texture = this.scene.textures.get(key);
    for (let index = 0; index < tileCount; index += 1) {
      const origin = tileOrigin(geometry, index);
      texture.add(index, 0, origin.x, origin.y, geometry.tilePx, geometry.tilePx);
    }
    return 1;
  }

  /** Bakes a family of the shape catalogue, one texture per entry. */
  private bakeSprites(sprites: readonly SpriteSpec[]): number {
    if (sprites.length === 0) {
      return 0;
    }
    const graphics = new Phaser.GameObjects.Graphics(this.scene);
    try {
      let generated = 0;
      for (const sprite of sprites) {
        if (this.scene.textures.exists(sprite.key)) {
          this.scene.textures.remove(sprite.key);
        }
        graphics.clear();
        sprite.draw(graphics);
        graphics.generateTexture(sprite.key, sprite.width, sprite.height);
        generated += 1;
      }
      return generated;
    } finally {
      graphics.destroy();
    }
  }
}

/** Every texture key the factory registers, in generation order. For the lab route. */
export function generatedTextureKeys(): readonly string[] {
  return [
    TEXTURE_KEYS.terrainAtlas,
    TEXTURE_KEYS.usageAtlas,
    TEXTURE_KEYS.grid,
    ...SPRITE_CATALOGUE.map((sprite) => sprite.key),
  ];
}
