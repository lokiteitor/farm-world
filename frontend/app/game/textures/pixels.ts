// Direct pixel writing.
//
// Owner: workflow W3-D (rendering core). Plan section 9.4 splits the generated art
// in two: direct pixel writes for what is gridded and noisy (terrain tiles,
// thumbnails, grid) and `Graphics.generateTexture` for shapes with a stroke
// (buildings, machines, workers, trees, cursors). This module is the first half.
//
// It knows nothing about Phaser on purpose. A buffer is a plain RGBA byte array,
// so every pixel writer in this directory is a pure function that a unit test can
// assert byte for byte without a canvas, a WebGL context or a browser. The upload
// into a Phaser texture happens in one place, factory.ts.

/** An RGBA byte buffer in row major order, four bytes per pixel. */
export interface PixelBuffer {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** A fully transparent buffer of the given size. */
export function createPixelBuffer(width: number, height: number): PixelBuffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(
      `A pixel buffer needs positive integer dimensions, got ${width}x${height}`,
    );
  }
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** Byte offset of a pixel, or `-1` when the coordinate is outside the buffer. */
export function offsetOf(buffer: PixelBuffer, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) {
    return -1;
  }
  return (y * buffer.width + x) * 4;
}

/**
 * Writes a pixel, replacing whatever was there. Out of range coordinates are
 * ignored rather than throwing: every shape writer clips against the tile, and a
 * throw would turn a one pixel overhang into a failed boot.
 */
export function setPixel(
  buffer: PixelBuffer,
  x: number,
  y: number,
  colour: number,
  alpha = 255,
): void {
  const offset = offsetOf(buffer, x, y);
  if (offset < 0) {
    return;
  }
  buffer.data[offset] = (colour >>> 16) & 0xff;
  buffer.data[offset + 1] = (colour >>> 8) & 0xff;
  buffer.data[offset + 2] = colour & 0xff;
  buffer.data[offset + 3] = alpha;
}

/**
 * Composites a pixel over what is already there, source over. Needed for the
 * translucent marks of the usage atlas and for the grid: writing a mark of alpha
 * 120 over a wash of alpha 56 with `setPixel` would punch a hole in the wash.
 */
export function blendPixel(
  buffer: PixelBuffer,
  x: number,
  y: number,
  colour: number,
  alpha: number,
): void {
  const offset = offsetOf(buffer, x, y);
  if (offset < 0) {
    return;
  }
  if (alpha >= 255) {
    setPixel(buffer, x, y, colour, 255);
    return;
  }
  if (alpha <= 0) {
    return;
  }
  const sourceAlpha = alpha / 255;
  const destinationAlpha = (buffer.data[offset + 3] ?? 0) / 255;
  const outAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  if (outAlpha <= 0) {
    return;
  }
  const mix = (channel: number, sourceValue: number): number => {
    const destinationValue = buffer.data[offset + channel] ?? 0;
    return (
      (sourceValue * sourceAlpha + destinationValue * destinationAlpha * (1 - sourceAlpha)) /
      outAlpha
    );
  };
  buffer.data[offset] = mix(0, (colour >>> 16) & 0xff);
  buffer.data[offset + 1] = mix(1, (colour >>> 8) & 0xff);
  buffer.data[offset + 2] = mix(2, colour & 0xff);
  buffer.data[offset + 3] = Math.round(outAlpha * 255);
}

/** Reads a pixel as `0xRRGGBBAA`. Out of range reads return 0, which is transparent. */
export function readPixel(buffer: PixelBuffer, x: number, y: number): number {
  const offset = offsetOf(buffer, x, y);
  if (offset < 0) {
    return 0;
  }
  return (
    (((buffer.data[offset] ?? 0) << 24) |
      ((buffer.data[offset + 1] ?? 0) << 16) |
      ((buffer.data[offset + 2] ?? 0) << 8) |
      (buffer.data[offset + 3] ?? 0)) >>>
    0
  );
}

/** Fills a rectangle, replacing what was there. */
export function fillRect(
  buffer: PixelBuffer,
  x: number,
  y: number,
  width: number,
  height: number,
  colour: number,
  alpha = 255,
): void {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      setPixel(buffer, column, row, colour, alpha);
    }
  }
}

/** Copies a buffer into another at an offset, replacing what was there. */
export function blit(target: PixelBuffer, source: PixelBuffer, x: number, y: number): void {
  for (let row = 0; row < source.height; row += 1) {
    const targetRow = y + row;
    if (targetRow < 0 || targetRow >= target.height) {
      continue;
    }
    for (let column = 0; column < source.width; column += 1) {
      const sourceOffset = (row * source.width + column) * 4;
      const destination = offsetOf(target, x + column, y + row);
      if (destination < 0) {
        continue;
      }
      target.data[destination] = source.data[sourceOffset] ?? 0;
      target.data[destination + 1] = source.data[sourceOffset + 1] ?? 0;
      target.data[destination + 2] = source.data[sourceOffset + 2] ?? 0;
      target.data[destination + 3] = source.data[sourceOffset + 3] ?? 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Extruded tileset geometry
// ---------------------------------------------------------------------------

/**
 * Geometry of an extruded tileset.
 *
 * The detail that costs a day if it is missed, and which plan section 9.3 names
 * explicitly: a generated tileset has to be extruded. Each tile of 16 px is drawn
 * inside a cell of 18 px with its border row and column replicated, and the
 * tileset is registered with margin 1 and spacing 2. Without it, fractional zoom
 * samples half a texel outside the tile and the neighbouring tile bleeds into the
 * seam, which reads as a bright or dark grid over the whole world.
 *
 * The numbers are not free: Phaser computes the position of tile `(row, column)`
 * as `margin + column x (tileWidth + spacing)`, that is `1 + 18 x column`. So cell
 * `k` spans `[18k, 18k + 17]` and its tile sits at `[18k + 1, 18k + 16]`, which is
 * exactly one pixel of replicated border on each side with no wasted space.
 */
export interface TilesetGeometry {
  /** Side of a tile in pixels. */
  readonly tilePx: number;
  /** Replicated border on each side, in pixels. Phaser's `margin`. */
  readonly margin: number;
  /** Gap between two tiles, which is two borders. Phaser's `spacing`. */
  readonly spacing: number;
  /** Tiles per row of the atlas. */
  readonly columns: number;
  /** Rows of the atlas. */
  readonly rows: number;
}

/** The standard extrusion of one border pixel, for a square tile. */
export function extrudedGeometry(tilePx: number, columns: number, rows: number): TilesetGeometry {
  return { tilePx, margin: 1, spacing: 2, columns, rows };
}

/** Pixel size of the atlas image for a geometry. */
export function atlasSize(geometry: TilesetGeometry): {
  readonly width: number;
  readonly height: number;
} {
  const cell = geometry.tilePx + geometry.spacing;
  return {
    width: geometry.columns * cell,
    height: geometry.rows * cell,
  };
}

/**
 * Top left corner of the tile of a slot, that is the first pixel of the tile
 * proper and not of its border. Same formula Phaser applies when it registers the
 * tileset, which is why it is written once here and asserted by a test.
 */
export function tileOrigin(
  geometry: TilesetGeometry,
  index: number,
): { readonly x: number; readonly y: number } {
  if (!Number.isInteger(index) || index < 0 || index >= geometry.columns * geometry.rows) {
    throw new RangeError(`Tile index ${index} is outside the atlas`);
  }
  const column = index % geometry.columns;
  const row = Math.floor(index / geometry.columns);
  const stride = geometry.tilePx + geometry.spacing;
  return { x: geometry.margin + column * stride, y: geometry.margin + row * stride };
}

/**
 * Writes a tile into its slot of the atlas and replicates its border ring.
 *
 * The replication is the whole point: the row above the tile is a copy of its
 * first row, the row below a copy of its last, likewise for the columns, and the
 * four corners copy the corner pixel. A sampler that reads slightly outside the
 * tile therefore reads the same colour instead of the neighbouring tile.
 */
export function writeExtrudedTile(
  atlas: PixelBuffer,
  tile: PixelBuffer,
  geometry: TilesetGeometry,
  index: number,
): void {
  if (tile.width !== geometry.tilePx || tile.height !== geometry.tilePx) {
    throw new RangeError(
      `Tile of ${tile.width}x${tile.height} does not fit a ${geometry.tilePx} px slot`,
    );
  }
  const origin = tileOrigin(geometry, index);
  blit(atlas, tile, origin.x, origin.y);

  const last = geometry.tilePx - 1;
  const margin = geometry.margin;
  for (let step = 0; step < geometry.tilePx; step += 1) {
    // Top and bottom rows.
    copyPixel(atlas, tile, origin, step, 0, step, -margin);
    copyPixel(atlas, tile, origin, step, last, step, last + margin);
    // Left and right columns.
    copyPixel(atlas, tile, origin, 0, step, -margin, step);
    copyPixel(atlas, tile, origin, last, step, last + margin, step);
  }
  // The four corners, which no row or column of the loop above covers.
  copyPixel(atlas, tile, origin, 0, 0, -margin, -margin);
  copyPixel(atlas, tile, origin, last, 0, last + margin, -margin);
  copyPixel(atlas, tile, origin, 0, last, -margin, last + margin);
  copyPixel(atlas, tile, origin, last, last, last + margin, last + margin);
}

/** Copies one pixel of the tile to a position relative to the tile origin. */
function copyPixel(
  atlas: PixelBuffer,
  tile: PixelBuffer,
  origin: { readonly x: number; readonly y: number },
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
): void {
  const sourceOffset = (sourceY * tile.width + sourceX) * 4;
  const targetOffset = offsetOf(atlas, origin.x + targetX, origin.y + targetY);
  if (targetOffset < 0) {
    return;
  }
  atlas.data[targetOffset] = tile.data[sourceOffset] ?? 0;
  atlas.data[targetOffset + 1] = tile.data[sourceOffset + 1] ?? 0;
  atlas.data[targetOffset + 2] = tile.data[sourceOffset + 2] ?? 0;
  atlas.data[targetOffset + 3] = tile.data[sourceOffset + 3] ?? 0;
}
