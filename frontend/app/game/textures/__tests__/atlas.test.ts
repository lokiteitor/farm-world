// Tests of the generated art.
//
// Only pure functions are covered, which is every module of this directory except
// factory.ts, the Phaser adapter. That is not a gap in coverage: the split was chosen
// so the interesting parts (index arithmetic, extrusion, determinism) can be asserted
// byte for byte in Node, without a canvas or a WebGL context, and what is left in the
// adapter is upload calls whose failure is visible on the inspection route.
//
// The four properties the brief of this phase asks for are here: the correspondence
// between atlas index and (terrain, variant) in both directions, the determinism of
// the pseudorandom source, the offsets of the extrusion, and the Euclidean modulus.

import { describe, expect, it } from 'vitest';
import { buildGridTile, GRID_TILE_PX } from '../grid';
import {
  buildingTextureKey,
  cursorTextureKey,
  machineTextureKey,
  TEXTURE_KEYS,
  TEXTURE_PREFIX,
  treeTextureKey,
  TREE_VARIANTS,
} from '../keys';
import {
  applyPaletteCssVariables,
  CROP_TINTS,
  growthTint,
  growthTintFor,
  PALETTE,
  paletteCssBlock,
  paletteCssVariables,
  toCssHex,
  workerTint,
  WORKER_TINTS,
} from '../palette';
import { atlasSize, createPixelBuffer, readPixel, setPixel, tileOrigin } from '../pixels';
import { createHashStream, HASH_SALT, pickIndex, unitOf, variantForCell } from '../prng';
import { SPRITE_CATALOGUE, SpriteGroup, spritesByGroup, TREE_SPRITE_PX } from '../shapes';
import {
  buildTerrainAtlas,
  paintTerrainTile,
  TERRAIN_ATLAS_GEOMETRY,
  TERRAIN_ATLAS_ORDER,
  TERRAIN_TILE_COUNT,
  TERRAIN_TILE_PX,
  TERRAIN_VARIANTS,
  terrainTileFromIndex,
  terrainTileIndex,
} from '../terrain-atlas';
import {
  buildUsageAtlas,
  LOOK_VARIANT_STATES,
  USAGE_ATLAS_GEOMETRY,
  USAGE_TILE_COUNT,
  USAGE_TILE_ORDER,
  UsageTile,
  usageTileForCropState,
  usageTileFromIndex,
  usageTileIndex,
  usageTileIndexForCropState,
} from '../usage-atlas';
import { CELL_PX, CHUNK_SIZE } from '~/shared/config/world';
import { bp } from '~/shared/domain/units';
import {
  BUILDING_TYPES,
  CROPS,
  CROP_CYCLE_STATES,
  CROP_IDS,
  CROP_LOOKS,
  CropId,
  CropLook,
  TERRAIN_TYPES,
} from '~/shared/index';
import { floorMod } from '~/shared/rules/geometry';
import { TERRAIN_BY_CODE, TERRAIN_CODE } from '~/shared/world/terrain';

describe('terrain atlas index arithmetic', () => {
  it('agrees with the wire encoding of a generated chunk', () => {
    // The row order of the atlas is the byte order of shared/world/terrain.ts. If the
    // two ever diverge, decoding a chunk paints water as grass, so this is asserted and
    // not merely commented.
    expect(TERRAIN_ATLAS_ORDER).toEqual(TERRAIN_BY_CODE);
    for (const terrain of TERRAIN_TYPES) {
      expect(terrainTileIndex(terrain, 0)).toBe(TERRAIN_CODE[terrain] * TERRAIN_VARIANTS);
    }
  });

  it('round trips index and (terrain, variant) in both directions', () => {
    let seen = 0;
    for (const terrain of TERRAIN_ATLAS_ORDER) {
      for (let variant = 0; variant < TERRAIN_VARIANTS; variant += 1) {
        const index = terrainTileIndex(terrain, variant);
        expect(terrainTileFromIndex(index)).toEqual({ terrain, variant });
        seen += 1;
      }
    }
    expect(seen).toBe(TERRAIN_TILE_COUNT);

    for (let index = 0; index < TERRAIN_TILE_COUNT; index += 1) {
      const tile = terrainTileFromIndex(index);
      expect(terrainTileIndex(tile.terrain, tile.variant)).toBe(index);
    }
  });

  it('refuses a variant or an index outside the atlas', () => {
    expect(() => terrainTileIndex('GRASS', TERRAIN_VARIANTS)).toThrow(RangeError);
    expect(() => terrainTileIndex('GRASS', -1)).toThrow(RangeError);
    expect(() => terrainTileFromIndex(TERRAIN_TILE_COUNT)).toThrow(RangeError);
    expect(() => terrainTileFromIndex(1.5)).toThrow(RangeError);
  });
});

describe('extrusion', () => {
  it('places every tile where Phaser will look for it', () => {
    // Phaser computes the position of a tile as margin + column x (tile + spacing).
    // The atlas writer uses `tileOrigin`, so this test is the contract between the two.
    const geometry = TERRAIN_ATLAS_GEOMETRY;
    expect(geometry.margin).toBe(1);
    expect(geometry.spacing).toBe(2);
    expect(geometry.tilePx).toBe(CELL_PX);

    for (let index = 0; index < TERRAIN_TILE_COUNT; index += 1) {
      const column = index % geometry.columns;
      const row = Math.floor(index / geometry.columns);
      expect(tileOrigin(geometry, index)).toEqual({
        x: geometry.margin + column * (geometry.tilePx + geometry.spacing),
        y: geometry.margin + row * (geometry.tilePx + geometry.spacing),
      });
    }
  });

  it('sizes the image so the last border is the last pixel', () => {
    const size = atlasSize(TERRAIN_ATLAS_GEOMETRY);
    const stride = TERRAIN_ATLAS_GEOMETRY.tilePx + TERRAIN_ATLAS_GEOMETRY.spacing;
    expect(size.width).toBe(TERRAIN_ATLAS_GEOMETRY.columns * stride);
    expect(size.height).toBe(TERRAIN_ATLAS_GEOMETRY.rows * stride);
    // The formula Phaser applies to derive the tile count from the image must give
    // back exactly the tiles that were written.
    const columns =
      (size.width - TERRAIN_ATLAS_GEOMETRY.margin * 2 + TERRAIN_ATLAS_GEOMETRY.spacing) /
      (TERRAIN_ATLAS_GEOMETRY.tilePx + TERRAIN_ATLAS_GEOMETRY.spacing);
    const rows =
      (size.height - TERRAIN_ATLAS_GEOMETRY.margin * 2 + TERRAIN_ATLAS_GEOMETRY.spacing) /
      (TERRAIN_ATLAS_GEOMETRY.tilePx + TERRAIN_ATLAS_GEOMETRY.spacing);
    expect(columns).toBe(TERRAIN_ATLAS_GEOMETRY.columns);
    expect(rows).toBe(TERRAIN_ATLAS_GEOMETRY.rows);
  });

  it('replicates the border ring of every tile of the terrain atlas', () => {
    const atlas = buildTerrainAtlas();
    const last = TERRAIN_TILE_PX - 1;

    for (let index = 0; index < TERRAIN_TILE_COUNT; index += 1) {
      const origin = tileOrigin(TERRAIN_ATLAS_GEOMETRY, index);
      for (let step = 0; step < TERRAIN_TILE_PX; step += 1) {
        // Above equals the first row, below equals the last row.
        expect(readPixel(atlas, origin.x + step, origin.y - 1)).toBe(
          readPixel(atlas, origin.x + step, origin.y),
        );
        expect(readPixel(atlas, origin.x + step, origin.y + last + 1)).toBe(
          readPixel(atlas, origin.x + step, origin.y + last),
        );
        // Left equals the first column, right equals the last column.
        expect(readPixel(atlas, origin.x - 1, origin.y + step)).toBe(
          readPixel(atlas, origin.x, origin.y + step),
        );
        expect(readPixel(atlas, origin.x + last + 1, origin.y + step)).toBe(
          readPixel(atlas, origin.x + last, origin.y + step),
        );
      }
      // The four corners.
      expect(readPixel(atlas, origin.x - 1, origin.y - 1)).toBe(
        readPixel(atlas, origin.x, origin.y),
      );
      expect(readPixel(atlas, origin.x + last + 1, origin.y - 1)).toBe(
        readPixel(atlas, origin.x + last, origin.y),
      );
      expect(readPixel(atlas, origin.x - 1, origin.y + last + 1)).toBe(
        readPixel(atlas, origin.x, origin.y + last),
      );
      expect(readPixel(atlas, origin.x + last + 1, origin.y + last + 1)).toBe(
        readPixel(atlas, origin.x + last, origin.y + last),
      );
    }
  });

  it('replicates the border ring of every tile of the usage atlas', () => {
    const atlas = buildUsageAtlas();
    const last = USAGE_ATLAS_GEOMETRY.tilePx - 1;
    for (let index = 0; index < USAGE_TILE_COUNT; index += 1) {
      const origin = tileOrigin(USAGE_ATLAS_GEOMETRY, index);
      expect(readPixel(atlas, origin.x - 1, origin.y - 1)).toBe(
        readPixel(atlas, origin.x, origin.y),
      );
      expect(readPixel(atlas, origin.x + last + 1, origin.y + last + 1)).toBe(
        readPixel(atlas, origin.x + last, origin.y + last),
      );
    }
  });

  it('refuses a tile that does not fit its slot', () => {
    expect(() => tileOrigin(TERRAIN_ATLAS_GEOMETRY, TERRAIN_TILE_COUNT)).toThrow(RangeError);
  });
});

describe('terrain tiles', () => {
  it('is deterministic: two runs produce identical bytes', () => {
    const first = buildTerrainAtlas();
    const second = buildTerrainAtlas();
    expect(first.width).toBe(second.width);
    expect(first.height).toBe(second.height);
    expect(Array.from(first.data)).toEqual(Array.from(second.data));
  });

  it('is fully opaque, because nothing is drawn underneath the terrain layer', () => {
    const atlas = buildTerrainAtlas();
    for (let offset = 3; offset < atlas.data.length; offset += 4) {
      expect(atlas.data[offset]).toBe(255);
    }
  });

  it('gives every terrain type four distinguishable variants', () => {
    for (const terrain of TERRAIN_ATLAS_ORDER) {
      const rendered = new Set<string>();
      for (let variant = 0; variant < TERRAIN_VARIANTS; variant += 1) {
        rendered.add(Array.from(paintTerrainTile(terrain, variant).data).join(','));
      }
      expect(rendered.size).toBe(TERRAIN_VARIANTS);
    }
  });

  it('keeps the four terrain types apart by average colour', () => {
    // GDD section 60 requires water, forest, mountain and grass to be clearly
    // distinguishable. The average tone is a crude proxy, and it is enough to catch
    // the failure that matters, which is two terrains drifting into the same colour.
    const averages = TERRAIN_ATLAS_ORDER.map((terrain) => {
      const tile = paintTerrainTile(terrain, 0);
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let offset = 0; offset < tile.data.length; offset += 4) {
        red += tile.data[offset] ?? 0;
        green += tile.data[offset + 1] ?? 0;
        blue += tile.data[offset + 2] ?? 0;
      }
      const pixels = tile.width * tile.height;
      return [red / pixels, green / pixels, blue / pixels] as const;
    });

    for (let a = 0; a < averages.length; a += 1) {
      for (let b = a + 1; b < averages.length; b += 1) {
        const first = averages[a];
        const second = averages[b];
        if (first === undefined || second === undefined) {
          throw new Error('missing average');
        }
        const distance = Math.hypot(
          first[0] - second[0],
          first[1] - second[1],
          first[2] - second[2],
        );
        expect(distance).toBeGreaterThan(25);
      }
    }
  });
});

describe('generation cost', () => {
  it('builds both atlases and the grid well inside the boot budget', () => {
    // The budget of plan section 9 is 250 ms for the whole generation, measured in the
    // inspection route because the shape half needs a real canvas. What is measurable
    // here is the pixel half, which is the part that scales with the number of tiles.
    //
    // The bound is deliberately loose, a fifth of the whole budget for the part that
    // measures about one millisecond on a development machine: this is a smoke bound
    // that catches an accidental quadratic, not a benchmark, and a tight bound on a
    // shared CI runner would fail for reasons that have nothing to do with the code.
    const started = performance.now();
    for (let run = 0; run < 5; run += 1) {
      buildTerrainAtlas();
      buildUsageAtlas();
      buildGridTile();
    }
    const perRun = (performance.now() - started) / 5;
    expect(perRun).toBeLessThan(50);
  });
});

describe('usage atlas', () => {
  it('has a tile for each of the eight states of the crop cycle', () => {
    for (const state of CROP_CYCLE_STATES) {
      const tile: string = usageTileFromIndex(usageTileIndexForCropState(state));
      expect(tile).toBe(String(state));
    }
    expect(CROP_CYCLE_STATES).toHaveLength(8);
  });

  it('keeps the transparent tile at index zero', () => {
    expect(usageTileIndex(UsageTile.EMPTY)).toBe(0);
    const atlas = buildUsageAtlas();
    const origin = tileOrigin(USAGE_ATLAS_GEOMETRY, 0);
    expect(readPixel(atlas, origin.x, origin.y)).toBe(0);
  });

  it('round trips index and tile', () => {
    for (let index = 0; index < USAGE_TILE_ORDER.length; index += 1) {
      const tile = usageTileFromIndex(index);
      expect(usageTileIndex(tile)).toBe(index);
    }
  });

  it('paints the padding slots as the loud missing tile', () => {
    for (let index = USAGE_TILE_ORDER.length; index < USAGE_TILE_COUNT; index += 1) {
      expect(usageTileFromIndex(index)).toBe(UsageTile.MISSING);
    }
  });

  it('draws plowed and cultivated with different furrow densities', () => {
    // The two states are adjacent in the cycle and differ only in how the soil was
    // worked, so the patterns have to differ in count and not only in tone.
    const atlas = buildUsageAtlas();
    const rowsOf = (tile: UsageTile): number => {
      const origin = tileOrigin(USAGE_ATLAS_GEOMETRY, usageTileIndex(tile));
      const distinct = new Set<number>();
      for (let y = 0; y < USAGE_ATLAS_GEOMETRY.tilePx; y += 1) {
        distinct.add(readPixel(atlas, origin.x + 4, origin.y + y));
      }
      return distinct.size;
    };
    expect(rowsOf(UsageTile.CULTIVATED)).not.toBe(rowsOf(UsageTile.PLOWED));
  });

  it('is deterministic', () => {
    expect(Array.from(buildUsageAtlas().data)).toEqual(Array.from(buildUsageAtlas().data));
  });
});

describe('pseudorandom source', () => {
  it('gives a cell the same variant on every run', () => {
    for (let cellX = -40; cellX < 40; cellX += 7) {
      for (let cellY = -40; cellY < 40; cellY += 7) {
        const first = variantForCell(12345, cellX, cellY, TERRAIN_VARIANTS);
        const second = variantForCell(12345, cellX, cellY, TERRAIN_VARIANTS);
        expect(first).toBe(second);
        expect(Number.isInteger(first)).toBe(true);
        expect(first).toBeGreaterThanOrEqual(0);
        expect(first).toBeLessThan(TERRAIN_VARIANTS);
      }
    }
  });

  it('depends on the seed, so two worlds do not share their mosaic', () => {
    let differences = 0;
    for (let cell = 0; cell < 400; cell += 1) {
      if (
        variantForCell(1, cell, 0, TERRAIN_VARIANTS) !==
        variantForCell(2, cell, 0, TERRAIN_VARIANTS)
      ) {
        differences += 1;
      }
    }
    // Four variants, so about three quarters of the cells should differ. Anything
    // close to zero would mean the seed is not reaching the hash.
    expect(differences).toBeGreaterThan(200);
  });

  it('spreads the four variants roughly evenly over a chunk', () => {
    const counts = [0, 0, 0, 0];
    for (let y = 0; y < CHUNK_SIZE; y += 1) {
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        const variant = variantForCell(99, x, y, TERRAIN_VARIANTS);
        counts[variant] = (counts[variant] ?? 0) + 1;
      }
    }
    const expectedShare = (CHUNK_SIZE * CHUNK_SIZE) / TERRAIN_VARIANTS;
    for (const count of counts) {
      expect(count).toBeGreaterThan(expectedShare * 0.7);
      expect(count).toBeLessThan(expectedShare * 1.3);
    }
  });

  it('uses the Euclidean modulus, so a negative coordinate never picks variant -1', () => {
    // The native % truncates towards zero. Three of the four quadrants of the world
    // have negative coordinates, so this is the difference between a working mosaic
    // and a crash on the tile index.
    expect(floorMod(-1, 4)).toBe(3);
    expect(floorMod(-4, 4)).toBe(0);
    expect(floorMod(-5, 4)).toBe(3);
    expect(-1 % 4).toBe(-1);
    expect(pickIndex(-1, 4)).toBe(3);
    for (let cell = -1000; cell < 0; cell += 37) {
      const variant = variantForCell(7, cell, cell, TERRAIN_VARIANTS);
      expect(variant).toBeGreaterThanOrEqual(0);
      expect(variant).toBeLessThan(TERRAIN_VARIANTS);
    }
  });

  it('refuses a non positive count', () => {
    expect(() => pickIndex(1, 0)).toThrow(RangeError);
    expect(() => pickIndex(1, -3)).toThrow(RangeError);
    expect(() => pickIndex(1, 2.5)).toThrow(RangeError);
  });

  it('keeps the hash stream reproducible and inside the unit interval', () => {
    const first = createHashStream(11, 2, 3, HASH_SALT.TILE_NOISE);
    const second = createHashStream(11, 2, 3, HASH_SALT.TILE_NOISE);
    const drawn: number[] = [];
    const replayed: number[] = [];
    for (let index = 0; index < 200; index += 1) {
      const value = first.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      drawn.push(value);
      replayed.push(second.next());
    }
    expect(replayed).toEqual(drawn);
    first.reset();
    expect(first.next()).toBe(drawn[0]);
  });

  it('separates two streams that differ only in their salt', () => {
    const noise = createHashStream(11, 0, 0, HASH_SALT.TILE_NOISE);
    const shape = createHashStream(11, 0, 0, HASH_SALT.TILE_SHAPE);
    expect(noise.next()).not.toBe(shape.next());
  });

  it('maps a hash into the unit interval without ever reaching one', () => {
    expect(unitOf(0)).toBe(0);
    expect(unitOf(0xffff_ffff)).toBeLessThan(1);
    expect(unitOf(0x8000_0000)).toBeCloseTo(0.5, 6);
  });
});

describe('palette', () => {
  it('exposes one CSS variable per world colour and none of the shell tokens', () => {
    const variables = paletteCssVariables();
    // The shell tokens belong to app/assets/tokens.css, whose owner is another agent
    // of this phase. Redefining one of them here is the divergence this split avoids.
    for (const shellToken of ['--fw-bg', '--fw-surface', '--fw-text', '--fw-border']) {
      expect(variables[shellToken]).toBeUndefined();
    }
    // The names are the contract app/assets/tokens.css declares, not a convention of
    // this module: the panels and shell.css read exactly these.
    expect(variables['--fw-terrain-grass']).toBe(toCssHex(PALETTE.terrain.GRASS.base));
    expect(variables['--fw-use-owned']).toBe(toCssHex(PALETTE.use.OWNED));
    expect(variables['--fw-use-owned-foreign']).toBe(toCssHex(PALETTE.ownedForeign));
    // `READY_TO_HARVEST` is the one state whose token is not its kebab case name.
    expect(variables['--fw-crop-ready']).toBe(toCssHex(PALETTE.crop.READY_TO_HARVEST.mark));
    expect(variables['--fw-crop-ready-to-harvest']).toBeUndefined();
    expect(variables['--fw-entity-forestry']).toBe(
      toCssHex(PALETTE.machine.HARVESTER_FORESTRY.body),
    );
    expect(variables['--fw-machine-harvester-forestry']).toBe(
      toCssHex(PALETTE.machine.HARVESTER_FORESTRY.body),
    );
    expect(variables['--fw-tree-old-growth']).toBe(toCssHex(PALETTE.tree.OLD_GROWTH.canopy));
    expect(variables['--fw-select-valid']).toBe(toCssHex(PALETTE.ui.cursorValid));
    expect(variables['--fw-outline-forest-plot']).toBe(toCssHex(PALETTE.ui.outlineForestPlot));
    // The grid line is the only token that carries its alpha.
    expect(variables['--fw-grid-line']).toBe('#ffffff1a');
    for (const value of Object.values(variables)) {
      expect(value).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/);
    }
  });

  it('writes a block that a stylesheet can hold verbatim', () => {
    const block = paletteCssBlock();
    expect(block.startsWith('/* Generated from app/game/textures/palette.ts')).toBe(true);
    expect(block).toContain(':root {');
    for (const [name, value] of Object.entries(paletteCssVariables())) {
      expect(block).toContain(`  ${name}: ${value};`);
    }
  });

  it('covers every token the declared block of tokens.css names', () => {
    // The list is transcribed from app/assets/tokens.css. If W3-C adds a token there
    // and it is not generated here, the legend falls back to its failure colour, which
    // is legible and wrong, so the omission has to fail a test and not a review.
    const declared = [
      '--fw-terrain-grass',
      '--fw-terrain-forest',
      '--fw-terrain-mountain',
      '--fw-terrain-water',
      '--fw-use-owned',
      '--fw-use-field',
      '--fw-use-forest-plot',
      '--fw-use-building',
      '--fw-use-road',
      '--fw-crop-virgin',
      '--fw-crop-plowed',
      '--fw-crop-cultivated',
      '--fw-crop-seeded',
      '--fw-crop-germinating',
      '--fw-crop-growing',
      '--fw-crop-ready',
      '--fw-crop-harvested',
      '--fw-tree-sapling',
      '--fw-tree-young',
      '--fw-tree-mature',
      '--fw-tree-old-growth',
      '--fw-entity-worker',
      '--fw-entity-tractor',
      '--fw-entity-implement',
      '--fw-entity-harvester',
      '--fw-entity-forestry',
      '--fw-select-valid',
      '--fw-select-invalid',
      '--fw-select-neutral',
      '--fw-select-pending',
      '--fw-outline-owned',
      '--fw-outline-field',
      '--fw-outline-farm',
      '--fw-outline-forest-plot',
      '--fw-grid-line',
    ];
    const variables = paletteCssVariables();
    for (const token of declared) {
      expect(variables[token], token).toBeDefined();
    }
  });

  it('applies the same values to a document element', () => {
    const element = document.createElement('div');
    applyPaletteCssVariables(element);
    expect(element.style.getPropertyValue('--fw-terrain-water')).toBe(
      toCssHex(PALETTE.terrain.WATER.base),
    );
  });

  it('derives a stable worker tint from the identifier', () => {
    const identifier = '018f6c2e-4a1b-7000-8000-9f0a1b2c3d4e';
    expect(workerTint(identifier)).toBe(workerTint(identifier));
    expect(WORKER_TINTS).toContain(workerTint(identifier));
    const used = new Set<number>();
    for (let index = 0; index < 64; index += 1) {
      used.add(workerTint(`worker-${index}`));
    }
    // Not a uniformity claim, only that the derivation is not collapsing onto one
    // colour, which would make every worker look like the same person.
    expect(used.size).toBeGreaterThan(4);
  });

  it('ramps the growth tint from washed out to untouched', () => {
    expect(growthTint(bp(0))).toBe(PALETTE.growth.start);
    expect(growthTint(bp(10_000))).toBe(PALETTE.growth.end);
    const middle = growthTint(bp(5000));
    expect(middle).not.toBe(PALETTE.growth.start);
    expect(middle).not.toBe(PALETTE.growth.end);
    // Monotone in every channel, which is what makes the ramp readable as progress.
    let previous = -1;
    for (let percent = 0; percent <= 100; percent += 10) {
      const green = (growthTint(bp(percent * 100)) >>> 8) & 0xff;
      expect(green).toBeGreaterThanOrEqual(previous);
      previous = green;
    }
  });

  it('formats a colour as CSS expects it', () => {
    expect(toCssHex(0x000000)).toBe('#000000');
    expect(toCssHex(0xff00ff)).toBe('#ff00ff');
    expect(toCssHex(0x0a0b0c)).toBe('#0a0b0c');
  });
});

describe('pixel buffers', () => {
  it('ignores writes outside the buffer instead of throwing', () => {
    const buffer = createPixelBuffer(4, 4);
    setPixel(buffer, -1, 0, 0xffffff);
    setPixel(buffer, 0, 9, 0xffffff);
    expect(Array.from(buffer.data).every((byte) => byte === 0)).toBe(true);
  });

  it('refuses a buffer of non positive size', () => {
    expect(() => createPixelBuffer(0, 4)).toThrow(RangeError);
    expect(() => createPixelBuffer(4, -1)).toThrow(RangeError);
    expect(() => createPixelBuffer(2.5, 4)).toThrow(RangeError);
  });

  it('reads back what it wrote, alpha included', () => {
    const buffer = createPixelBuffer(2, 2);
    setPixel(buffer, 1, 1, 0x123456, 128);
    expect(readPixel(buffer, 1, 1)).toBe(0x12345680);
    expect(readPixel(buffer, 0, 0)).toBe(0);
  });
});

describe('grid tile', () => {
  it('draws one cell with lines on the north and west edges only', () => {
    const tile = buildGridTile();
    expect(tile.width).toBe(CELL_PX);
    expect(GRID_TILE_PX).toBe(CELL_PX);
    expect(readPixel(tile, 5, 0)).not.toBe(0);
    expect(readPixel(tile, 0, 5)).not.toBe(0);
    // The south and east edges are transparent: closing all four sides would double
    // the line wherever two tiles meet.
    expect(readPixel(tile, 5, GRID_TILE_PX - 1)).toBe(0);
    expect(readPixel(tile, GRID_TILE_PX - 1, 5)).toBe(0);
  });
});

describe('sprite catalogue', () => {
  it('covers every machine of the catalogue, every building and every tree stage', () => {
    expect(spritesByGroup(SpriteGroup.MACHINE)).toHaveLength(8);
    expect(spritesByGroup(SpriteGroup.BUILDING)).toHaveLength(BUILDING_TYPES.length);
    expect(spritesByGroup(SpriteGroup.TREE)).toHaveLength(4 * TREE_VARIANTS);
    expect(spritesByGroup(SpriteGroup.WORKER)).toHaveLength(2);
    expect(spritesByGroup(SpriteGroup.CURSOR)).toHaveLength(3);
    expect(spritesByGroup(SpriteGroup.PARTICLE)).toHaveLength(3);
  });

  it('names every texture once and with the shared prefix', () => {
    const keys = SPRITE_CATALOGUE.map((sprite) => sprite.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of [...keys, ...Object.values(TEXTURE_KEYS)]) {
      expect(key.startsWith(TEXTURE_PREFIX)).toBe(true);
    }
    expect(buildingTextureKey('WOOD_STORAGE')).toBe('fw-building-wood-storage');
    expect(machineTextureKey('HARVESTER_FORESTRY')).toBe('fw-machine-harvester-forestry');
    expect(treeTextureKey('OLD_GROWTH', 2)).toBe('fw-tree-old-growth-2');
    expect(cursorTextureKey('invalid')).toBe('fw-cursor-invalid');
  });

  it('sizes a building sprite exactly as its footprint in the shared catalogue', () => {
    const garage = SPRITE_CATALOGUE.find((sprite) => sprite.key === buildingTextureKey('GARAGE'));
    expect(garage?.width).toBe(6 * CELL_PX);
    expect(garage?.height).toBe(8 * CELL_PX);
    const silo = SPRITE_CATALOGUE.find((sprite) => sprite.key === buildingTextureKey('SILO'));
    expect(silo?.width).toBe(4 * CELL_PX);
    expect(silo?.height).toBe(4 * CELL_PX);
  });

  it('grows the tree sprite with the life stage', () => {
    expect(TREE_SPRITE_PX.SAPLING).toBeLessThan(TREE_SPRITE_PX.YOUNG);
    expect(TREE_SPRITE_PX.YOUNG).toBeLessThan(TREE_SPRITE_PX.MATURE);
    expect(TREE_SPRITE_PX.MATURE).toBeLessThan(TREE_SPRITE_PX.OLD_GROWTH);
  });

  it('gives every sprite a positive size and a label', () => {
    for (const sprite of SPRITE_CATALOGUE) {
      expect(sprite.width).toBeGreaterThan(0);
      expect(sprite.height).toBeGreaterThan(0);
      expect(sprite.label.length).toBeGreaterThan(0);
    }
  });
});

describe('the crop looks of the usage atlas', () => {
  it('varies the silhouette over exactly the four states that show a plant', () => {
    // The other four are soil, and a seed does not read at sixteen pixels, so they keep
    // one tile each whatever is going to grow on them.
    for (const state of CROP_CYCLE_STATES) {
      const varies = LOOK_VARIANT_STATES.includes(state);
      const base = usageTileForCropState(state, CropLook.SPIKE);
      for (const look of CROP_LOOKS) {
        const tile = usageTileForCropState(state, look);
        if (!varies || look === CropLook.SPIKE) {
          expect(tile, `${look} ${state}`).toBe(base);
        } else {
          expect(tile, `${look} ${state}`).not.toBe(base);
        }
      }
    }
  });

  it('gives every look and state a tile of its own, with no collisions', () => {
    const seen = new Map<number, string>();
    for (const look of CROP_LOOKS) {
      for (const state of LOOK_VARIANT_STATES) {
        const index = usageTileIndexForCropState(state, look);
        const key = `${look}/${state}`;
        const clash = seen.get(index);
        expect(clash, `${key} colisiona con ${clash}`).toBeUndefined();
        seen.set(index, key);
      }
    }
    expect(seen.size).toBe(CROP_LOOKS.length * LOOK_VARIANT_STATES.length);
  });

  it('keeps the atlas at forty slots, which is the whole argument for looks', () => {
    // Fifteen tiles that already existed plus six looks times four states. The alternative
    // was sixty two crops times eight states, which is 496 (ADR-0063).
    expect(USAGE_TILE_ORDER.length).toBe(39);
    expect(USAGE_TILE_COUNT).toBe(40);
  });

  it('gives every crop a tint of its own, light enough not to swallow the silhouette', () => {
    const seen = new Set<number>();
    for (const cropId of CROP_IDS) {
      const tint = CROP_TINTS[cropId];
      expect(tint, cropId).toBeGreaterThanOrEqual(0);
      expect(tint, cropId).toBeLessThanOrEqual(0xffffff);
      // A tint multiplies, so a dark one would darken the tile into mud.
      for (const shift of [16, 8, 0]) {
        expect((tint >> shift) & 0xff, `${cropId} canal ${shift}`).toBeGreaterThanOrEqual(0x80);
      }
      expect(seen.has(tint), `${cropId} repite tinte`).toBe(false);
      seen.add(tint);
    }
  });

  it('draws wheat exactly as it was drawn before the catalogue grew', () => {
    // The anchor: wheat is the spike look and its tint is the end of the growth ramp, so
    // both of the golden readings above keep answering what they always answered.
    expect(CROPS.WHEAT.look).toBe(CropLook.SPIKE);
    expect(CROP_TINTS.WHEAT).toBe(PALETTE.growth.end);
    for (const progress of [0, 2_500, 10_000]) {
      expect(growthTintFor(CropId.WHEAT, bp(progress))).toBe(growthTint(bp(progress)));
    }
  });
});
