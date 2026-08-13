// One chunk on screen, in both levels of detail.
//
// Owner: workflow W4-D (world rendering). This is the only module of the world
// directory that touches Phaser objects; everything it draws was decided by the pure
// modules next to it, which is what makes the tile arithmetic, the colour rules and
// the outline extraction testable without a WebGL context.
//
// Plan section 9.3 asks for two representations fed by the same data structure, built
// per chunk and both alive at once, so that crossing the threshold only switches
// visibility and rebuilds nothing:
//
//   - Near: a Phaser tilemap with two layers over the two generated tilesets. Margin 1
//     and spacing 2 are not optional: W3-D extruded both atlases (16 px tiles inside
//     18 px cells) and registering them without those two numbers samples the
//     neighbouring tile at fractional zoom, which reads as a bright grid over the whole
//     world.
//   - Far: a 32 x 32 canvas texture, one pixel per cell, drawn as one scaled quad with
//     nearest filtering.
//
// One deviation from the literal reading of the plan, measured rather than assumed, and
// it is the same deviation twice. The pixels of both representations are computed when
// the chunk is loaded, from the same data structure, and they are what the minimap reads,
// so there is still only one data path. What is deferred is the engine object of the half
// that has not been needed yet: the tilemap is created the first time the chunk is drawn
// up close, and the canvas texture of the thumbnail the first time it is drawn far away.
// Once created, neither is ever destroyed while the chunk lives, so crossing the
// threshold switches visibility and rebuilds nothing, which is the property the plan is
// protecting.
//
// Both halves of the deferral are there because they were measured. A tilemap is 2 048
// `Tile` objects, and the far case of the brief holds 200 chunks, which would be 409 600
// tile objects for something no player can see at four pixels per chunk. And a canvas
// texture costs about 1.9 ms per chunk on the machine of this workflow, almost all of it
// the creation and upload of a GPU texture, which is more than the whole tilemap: paying
// it for a chunk that is only ever drawn up close is 60 ms of hitch per streaming tick
// of 32 chunks, and it was visible as a drop to 20 frames per second while panning.

import type Phaser from 'phaser';
import { TEXTURE_KEYS } from '../textures/keys';
import { TERRAIN_TILE_PX } from '../textures/terrain-atlas';
import { DEPTH, LevelOfDetail } from './config';
import { chunkKeyOf, type WorldChunkView } from './source';
import { chunkThumbnailPixels, type ThumbnailContext } from './thumbnail';
import { NO_TINT, NO_USAGE_TILE, toRows, usageTileIndices, terrainTileIndices } from './tiles';
import { type UsageContext } from './tiles';

/** Margin and spacing of the extruded atlases (NOTES-w3d, "Geometria de los dos atlas"). */
const ATLAS_MARGIN = 1;
const ATLAS_SPACING = 2;

/** Prefix of the per chunk thumbnail texture. Removed with the chunk. */
const THUMBNAIL_TEXTURE_PREFIX = 'fw-chunk-';

/** Everything a chunk view needs from the outside. */
export interface ChunkViewDeps {
  readonly scene: Phaser.Scene;
  readonly seed: number;
  readonly chunkSize: number;
  readonly cellPx: number;
  /** Resolved once per build, so a field that changed phase repaints on the next apply. */
  readonly context: () => UsageContext & ThumbnailContext;
}

/** Whether any cell of a chunk replaces its generated terrain (GDD section 10). */
function chunkHasTerrainOverride(chunk: WorldChunkView): boolean {
  for (const patch of chunk.patches.values()) {
    if (patch.terrainOverride !== null) {
      return true;
    }
  }
  return false;
}

/** Counters the debug overlay and the measurement route read. */
export interface ChunkQuadCount {
  readonly terrain: number;
  readonly usage: number;
  readonly thumbnail: number;
}

export class ChunkView {
  readonly chunkX: number;

  readonly chunkY: number;

  readonly key: string;

  /** Version of the modification layer this view was built from. */
  version: number;

  private readonly deps: ChunkViewDeps;

  private readonly textureKey: string;

  private thumbnail: Phaser.GameObjects.Image | null = null;

  private thumbnailTexture: Phaser.Textures.CanvasTexture | null = null;

  private map: Phaser.Tilemaps.Tilemap | null = null;

  private terrainLayer: Phaser.Tilemaps.TilemapLayer | null = null;

  private usageLayer: Phaser.Tilemaps.TilemapLayer | null = null;

  private level: LevelOfDetail = LevelOfDetail.FAR;

  private culled = false;

  private usageQuads = 0;

  private destroyed = false;

  /** Reused across repaints, so a live patch allocates nothing. */
  private thumbnailPixels: Uint8ClampedArray | null = null;

  /** The usage layer as it currently stands, so a repaint writes only what changed. */
  private usageIndices: Int16Array | null = null;

  private usageTints: Uint32Array | null = null;

  /**
   * Whether any cell of the chunk carries a terrain override.
   *
   * The terrain layer only changes when a forest is cleared (GDD section 10), which is
   * rare. Knowing that no cell overrides it, and that none did before, is what lets a
   * repaint skip a thousand hashes and a thousand tile writes on the common path.
   */
  private hadTerrainOverride = false;

  constructor(deps: ChunkViewDeps, chunk: WorldChunkView) {
    this.deps = deps;
    this.chunkX = chunk.chunkX;
    this.chunkY = chunk.chunkY;
    this.key = chunkKeyOf(chunk.chunkX, chunk.chunkY);
    this.textureKey = `${THUMBNAIL_TEXTURE_PREFIX}${this.key}`;
    this.version = chunk.version;
    this.hadTerrainOverride = chunkHasTerrainOverride(chunk);
    this.thumbnailPixels = chunkThumbnailPixels(chunk, deps.chunkSize, deps.context());
  }

  /** North west corner of the chunk in world pixels. */
  get originPx(): { readonly x: number; readonly y: number } {
    const side = this.deps.chunkSize * this.deps.cellPx;
    return { x: this.chunkX * side, y: this.chunkY * side };
  }

  get levelOfDetail(): LevelOfDetail {
    return this.level;
  }

  /** Quads this chunk contributes when it is visible at its current level of detail. */
  quads(): ChunkQuadCount {
    if (this.culled) {
      return { terrain: 0, usage: 0, thumbnail: 0 };
    }
    if (this.level === LevelOfDetail.NEAR && this.map !== null) {
      const cells = this.deps.chunkSize * this.deps.chunkSize;
      return { terrain: cells, usage: this.usageQuads, thumbnail: 0 };
    }
    return { terrain: 0, usage: 0, thumbnail: this.thumbnail === null ? 0 : 1 };
  }

  // -------------------------------------------------------------------------
  // Building
  // -------------------------------------------------------------------------

  /**
   * The pixels of the thumbnail: four kilobytes, one per cell.
   *
   * Always computed and always current, because they are what the minimap reads: plan
   * section 9.3 requires one data path and not two, and this is it.
   */
  get thumbnail32(): Uint8ClampedArray | null {
    return this.thumbnailPixels;
  }

  /** The thumbnail as a texture and a quad. Built on demand; see the header. */
  ensureFar(): void {
    const pixels = this.thumbnailPixels;
    if (this.thumbnail !== null || this.destroyed || pixels === null) {
      return;
    }
    const size = this.deps.chunkSize;
    const textures = this.deps.scene.textures;
    if (textures.exists(this.textureKey)) {
      textures.remove(this.textureKey);
    }
    // `createCanvas` and not a canvas of our own: it takes the element from the pool of
    // Phaser and gives it back on destroy, which is what keeps ten thousand chunk loads
    // from leaving ten thousand canvas elements for the collector.
    const texture = textures.createCanvas(this.textureKey, size, size);
    if (texture === null) {
      throw new Error(`The texture manager refused the thumbnail of chunk ${this.key}`);
    }
    const imageData = texture.imageData;
    imageData.data.set(pixels);
    // `putData` writes the 2D canvas and `update` is what re-reads it and uploads it to
    // the GPU. Both are needed: `putData` alone leaves a texture that draws the empty
    // canvas the pool handed out, which is a chunk that renders as a transparent square.
    texture.putData(imageData, 0, 0);
    texture.update();
    this.thumbnailTexture = texture;

    const origin = this.originPx;
    const image = this.deps.scene.add.image(origin.x, origin.y, this.textureKey);
    image.setOrigin(0, 0);
    // One pixel of the thumbnail is one cell, so the quad covers the chunk exactly.
    image.setScale(this.deps.cellPx);
    image.setDepth(DEPTH.THUMBNAIL);
    this.thumbnail = image;
    this.applyVisibility();
  }

  /** The tilemap. Built on demand; see the deviation in the header. */
  ensureNear(chunk: WorldChunkView): void {
    if (this.map !== null || this.destroyed) {
      return;
    }
    const size = this.deps.chunkSize;
    const context = this.deps.context();
    const terrain = terrainTileIndices(chunk, this.deps.seed, size);
    const usage = usageTileIndices(chunk, size, context);
    const origin = this.originPx;

    const map = this.deps.scene.make.tilemap({
      data: toRows(terrain, size),
      tileWidth: TERRAIN_TILE_PX,
      tileHeight: TERRAIN_TILE_PX,
      width: size,
      height: size,
    });
    const terrainSet = map.addTilesetImage(
      'terrain',
      TEXTURE_KEYS.terrainAtlas,
      TERRAIN_TILE_PX,
      TERRAIN_TILE_PX,
      ATLAS_MARGIN,
      ATLAS_SPACING,
    );
    const usageSet = map.addTilesetImage(
      'usage',
      TEXTURE_KEYS.usageAtlas,
      TERRAIN_TILE_PX,
      TERRAIN_TILE_PX,
      ATLAS_MARGIN,
      ATLAS_SPACING,
    );
    if (terrainSet === null || usageSet === null) {
      map.destroy();
      throw new Error(`The tilesets of chunk ${this.key} could not be registered`);
    }
    const terrainLayer = map.createLayer(0, terrainSet, origin.x, origin.y);
    const usageLayer = map.createBlankLayer(
      'usage',
      usageSet,
      origin.x,
      origin.y,
      size,
      size,
      TERRAIN_TILE_PX,
      TERRAIN_TILE_PX,
    );
    if (terrainLayer === null || usageLayer === null) {
      map.destroy();
      throw new Error(`The layers of chunk ${this.key} could not be created`);
    }
    terrainLayer.setDepth(DEPTH.TERRAIN);
    usageLayer.setDepth(DEPTH.USAGE);
    this.map = map;
    this.terrainLayer = terrainLayer;
    this.usageLayer = usageLayer;
    // The layer is blank, so the first write has to be a full one whatever state the
    // view remembered while it had no tilemap.
    this.usageIndices = null;
    this.usageTints = null;
    this.writeUsage(usage.indices, usage.tints);
    this.applyVisibility();
  }

  // -------------------------------------------------------------------------
  // Updating
  // -------------------------------------------------------------------------

  /**
   * Repaints the chunk from its current data, in place.
   *
   * Nothing is created and nothing is destroyed: the tile objects and the canvas
   * texture are reused and only their contents change. That is what makes a patch of
   * 250 cells cheap enough for the budget of the brief, and it is why a live
   * `CHUNK_PATCHED` does not make the world blink.
   */
  apply(chunk: WorldChunkView): void {
    if (this.destroyed) {
      return;
    }
    this.version = chunk.version;
    const size = this.deps.chunkSize;
    const context = this.deps.context();

    const pixels = chunkThumbnailPixels(chunk, size, context, this.thumbnailPixels ?? undefined);
    this.thumbnailPixels = pixels;
    const texture = this.thumbnailTexture;
    if (texture !== null) {
      const imageData = texture.imageData;
      imageData.data.set(pixels);
      texture.putData(imageData, 0, 0);
      texture.update();
    }

    if (this.usageLayer !== null) {
      const usage = usageTileIndices(chunk, size, context);
      this.writeUsage(usage.indices, usage.tints);
    }
    const hasOverride = chunkHasTerrainOverride(chunk);
    if (this.terrainLayer !== null && (hasOverride || this.hadTerrainOverride)) {
      // The terrain only changes when a forest is cleared (GDD section 10), which is
      // rare, so the common patch skips this entirely. It is not an optimisation of
      // convenience: it is a thousand hashes and a thousand tile writes per patched
      // chunk, and a patch arrives on every live edit of every player nearby.
      this.writeTerrain(terrainTileIndices(chunk, this.deps.seed, size));
    }
    this.hadTerrainOverride = hasOverride;
  }

  private writeTerrain(indices: Uint16Array): void {
    const layer = this.terrainLayer;
    if (layer === null) {
      return;
    }
    const size = this.deps.chunkSize;
    const rows = layer.layer.data;
    for (let y = 0; y < size; y += 1) {
      const row = rows[y];
      if (row === undefined) {
        continue;
      }
      const offset = y * size;
      for (let x = 0; x < size; x += 1) {
        const tile = row[x];
        if (tile === undefined) {
          continue;
        }
        tile.index = indices[offset + x] ?? 0;
      }
    }
  }

  /**
   * Writes the usage layer, touching only the tiles that changed.
   *
   * The previous state is kept precisely so that a patch of 250 cells costs 250 writes
   * and not 1 024. The comparison is two typed array reads per cell, which is far
   * cheaper than the property writes it avoids and, more importantly, than the work
   * Phaser does behind them.
   */
  private writeUsage(indices: Int16Array, tints: Uint32Array): void {
    const layer = this.usageLayer;
    if (layer === null) {
      // No tilemap yet: remember the state anyway, so the first build writes the whole
      // layer and every repaint after it writes only differences.
      this.usageIndices = indices;
      this.usageTints = tints;
      return;
    }
    const size = this.deps.chunkSize;
    const rows = layer.layer.data;
    const previousIndices = this.usageIndices;
    const previousTints = this.usageTints;
    const full = previousIndices === null || previousTints === null;
    let drawn = 0;
    for (let y = 0; y < size; y += 1) {
      const row = rows[y];
      if (row === undefined) {
        continue;
      }
      const offset = y * size;
      for (let x = 0; x < size; x += 1) {
        const at = offset + x;
        const index = indices[at] ?? NO_USAGE_TILE;
        const tint = tints[at] ?? NO_TINT;
        if (index !== NO_USAGE_TILE) {
          drawn += 1;
        }
        if (!full && previousIndices[at] === index && previousTints[at] === tint) {
          continue;
        }
        const tile = row[x];
        if (tile === undefined) {
          continue;
        }
        tile.index = index;
        tile.tint = tint;
      }
    }
    this.usageIndices = indices;
    this.usageTints = tints;
    this.usageQuads = drawn;
  }

  // -------------------------------------------------------------------------
  // Visibility
  // -------------------------------------------------------------------------

  /**
   * Switches the level of detail.
   *
   * For a chunk that has already been drawn at this level, only visibility changes and
   * nothing is rebuilt, which is the property of plan section 9.3. For one that has
   * never been drawn at it, the engine object of that half is created once, and never
   * again for the life of the chunk.
   */
  setLevelOfDetail(level: LevelOfDetail): void {
    if (this.level === level) {
      return;
    }
    this.level = level;
    this.applyVisibility();
  }

  /**
   * Builds the half the current level of detail needs, if it does not exist yet.
   *
   * Separate from `setLevelOfDetail`, and the separation is not cosmetic: it is what
   * keeps the threshold crossing bounded. Building on the switch itself meant every live
   * chunk built its missing half in one frame, and with two hundred chunks that is two
   * hundred canvas textures inside a single animation frame, which on the machine of this
   * workflow stopped the engine loop outright. The streamer calls this for the visible
   * chunks only, a fixed number per tick, so a crossing costs a few ticks of catching up
   * instead of one frame that never ends.
   */
  ensureLevel(chunk: WorldChunkView | undefined): void {
    if (this.level === LevelOfDetail.NEAR) {
      if (chunk !== undefined) {
        this.ensureNear(chunk);
      }
      return;
    }
    this.ensureFar();
  }

  /**
   * Whether the engine object of a level already exists.
   *
   * Public because it is what makes the claim of plan section 9.3 measurable: the
   * measurement route counts how many live chunks had to build anything when the zoom
   * crossed the threshold, and the answer has to be zero once a chunk has been seen at
   * both levels.
   */
  hasLevel(level: LevelOfDetail): boolean {
    return level === LevelOfDetail.NEAR ? this.map !== null : this.thumbnail !== null;
  }

  /** Culls the chunk out of the viewport, which is what keeps the draw calls bounded. */
  setCulled(culled: boolean): void {
    if (this.culled === culled) {
      return;
    }
    this.culled = culled;
    this.applyVisibility();
  }

  private applyVisibility(): void {
    const near = this.level === LevelOfDetail.NEAR && this.map !== null;
    const shown = !this.culled;
    this.thumbnail?.setVisible(shown && !near);
    this.terrainLayer?.setVisible(shown && near);
    this.usageLayer?.setVisible(shown && near);
  }

  /**
   * Destroys everything the chunk owns, including its texture.
   *
   * The texture matters: a canvas texture that outlives its chunk is a leak with a
   * name, and the memory sweep of the measurement route walks ten thousand chunks
   * precisely to prove that this path releases them.
   */
  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.thumbnail?.destroy();
    this.thumbnail = null;
    this.terrainLayer?.destroy();
    this.terrainLayer = null;
    this.usageLayer?.destroy();
    this.usageLayer = null;
    this.map?.destroy();
    this.map = null;
    this.thumbnailTexture = null;
    this.thumbnailPixels = null;
    this.usageIndices = null;
    this.usageTints = null;
    if (this.deps.scene.textures.exists(this.textureKey)) {
      this.deps.scene.textures.remove(this.textureKey);
    }
  }
}
