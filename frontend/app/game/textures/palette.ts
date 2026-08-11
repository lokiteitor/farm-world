// Canonical palette of the game.
//
// Owner: workflow W3-D (rendering core). Single module, as plan section 9.4
// requires: there is no graphic asset in the project, every texture is generated
// by code, and the legend, the panels and the canvas must not be able to drift
// apart. The palette is therefore re-exported as a block of CSS custom
// properties, and `applyPaletteCssVariables` writes those same values onto the
// document at boot, so both consumers read one source at run time instead of two
// copies of it.
//
// Why a palette is a requirement and not decoration: GDD section 60 demands that
// water, forest, mountain, grass, owned land, fields, farm buildings, machines
// and workers be clearly distinguishable, and that the agricultural and forestry
// states carry enough visual information for the player to read them at a
// glance. With abstract, code-generated art that is a colour problem before it is
// a shape problem.
//
// Form. Colours are packed 24 bit integers (`0xRRGGBB`), which is what Phaser
// consumes for tints and for `Graphics` fills and what the pixel writers of this
// directory unpack. Alpha never travels inside a colour: it is a separate
// argument, because a tint has no alpha channel.

import {
  type BuildingType,
  type CropCycleState,
  type LandUse,
  type MachineType,
  type TerrainType,
  type TreeGrowthStage,
} from '~/shared/domain/enums';
import { bpToRatio, type Bp } from '~/shared/domain/units';

/** A colour as Phaser consumes it: `0xRRGGBB`, no alpha. */
export type Rgb = number;

/**
 * Shades of one terrain type. The tile writer uses `base` as the ground, `dark`
 * and `light` for the per pixel noise, and `accent` for the larger decorative
 * shapes (tufts, rocks, wave crests) that give the tile its identity at zoom 1.
 */
export interface TerrainShades {
  readonly base: Rgb;
  readonly dark: Rgb;
  readonly light: Rgb;
  readonly accent: Rgb;
}

/**
 * Soil and mark of one state of the crop cycle (GDD sections 41 and 76). `soil`
 * is the ground of the tile, `mark` the pattern that names the state and
 * `markAlt` a second tone so the pattern stays legible against the soil at 16 px.
 */
export interface CropShades {
  readonly soil: Rgb;
  readonly mark: Rgb;
  readonly markAlt: Rgb;
}

/** Wall, roof and trim of a building of the catalogue (GDD sections 116 and 136). */
export interface BuildingShades {
  readonly wall: Rgb;
  readonly roof: Rgb;
  readonly trim: Rgb;
}

/** Body, accent and wheel of a machine of the catalogue (GDD sections 89 and 134). */
export interface MachineShades {
  readonly body: Rgb;
  readonly accent: Rgb;
  readonly wheel: Rgb;
}

/** Canopy, its shadow side and the trunk of a tree stage (GDD section 131). */
export interface TreeShades {
  readonly canopy: Rgb;
  readonly canopyDark: Rgb;
  readonly trunk: Rgb;
}

/**
 * Generated terrain (GDD sections 8 to 12). Muted and low saturation on purpose:
 * the terrain fills the whole viewport, and the saturated end of the range is
 * reserved for what the player has to find, which is ownership, state marks and
 * cursors.
 */
const TERRAIN_PALETTE: Readonly<Record<TerrainType, TerrainShades>> = {
  GRASS: { base: 0x7a9c4f, dark: 0x6a8b45, light: 0x8aac5c, accent: 0x93b566 },
  FOREST: { base: 0x35583a, dark: 0x2b4a31, light: 0x3f6644, accent: 0x4a7350 },
  MOUNTAIN: { base: 0x7b7970, dark: 0x6a685f, light: 0x8d8b83, accent: 0x9c9a92 },
  WATER: { base: 0x2f5f8c, dark: 0x27527b, light: 0x3a6f9e, accent: 0x4880ac },
};

/**
 * The eight states of the crop cycle. The pattern carries the meaning and the
 * colour only reinforces it, because a player who cannot separate two hues must
 * still be able to tell plowed from cultivated: wide furrows, fine furrows, dots,
 * green dots, vertical strokes, ears and stubble.
 */
const CROP_PALETTE: Readonly<Record<CropCycleState, CropShades>> = {
  VIRGIN: { soil: 0x8fae62, mark: 0x9dbb70, markAlt: 0x7f9d57 },
  PLOWED: { soil: 0x6d4a2f, mark: 0x573a25, markAlt: 0x7d573a },
  CULTIVATED: { soil: 0x7d5836, mark: 0x664428, markAlt: 0x8d6842 },
  SEEDED: { soil: 0x85603c, mark: 0xb9a06a, markAlt: 0x6f4f31 },
  GERMINATING: { soil: 0x85603c, mark: 0x9dc167, markAlt: 0x6f4f31 },
  GROWING: { soil: 0x7a6a44, mark: 0x5f9a3f, markAlt: 0x4c7f33 },
  READY_TO_HARVEST: { soil: 0xcba64a, mark: 0xefd989, markAlt: 0xb08f38 },
  HARVESTED: { soil: 0xa08d5e, mark: 0xc8b482, markAlt: 0x8a7850 },
};

/** Buildings of the catalogue (GDD sections 116 and 136). */
const BUILDING_PALETTE: Readonly<Record<BuildingType, BuildingShades>> = {
  GARAGE: { wall: 0x5b6570, roof: 0x414a54, trim: 0x8b96a2 },
  SILO: { wall: 0xb6bcc2, roof: 0x8d949b, trim: 0xd6dbe0 },
  WORKER_HOME: { wall: 0xb6a58a, roof: 0x8c4a3c, trim: 0xd8cbb3 },
  WORKSHOP: { wall: 0x7a6a58, roof: 0xb5713a, trim: 0xa2907a },
  WOOD_STORAGE: { wall: 0x8a6b45, roof: 0x5e4630, trim: 0xb08a5c },
};

/** The eight machine types (GDD sections 89 and 134). */
const MACHINE_PALETTE: Readonly<Record<MachineType, MachineShades>> = {
  TRACTOR: { body: 0x4d7c34, accent: 0xd9c33a, wheel: 0x2a2a2a },
  PLOW: { body: 0x5a5f66, accent: 0x9aa1a9, wheel: 0x2a2a2a },
  CULTIVATOR: { body: 0x4f6b86, accent: 0xa8bccd, wheel: 0x2a2a2a },
  SEEDER: { body: 0x6b5f86, accent: 0xbcaed4, wheel: 0x2a2a2a },
  HARVESTER: { body: 0xa83c30, accent: 0xe0c24a, wheel: 0x2a2a2a },
  TRAILER: { body: 0x6f7a6a, accent: 0xb2bcab, wheel: 0x2a2a2a },
  HARVESTER_FORESTRY: { body: 0xc96a1e, accent: 0xf0c07a, wheel: 0x2a2a2a },
  FORWARDER: { body: 0xc9a41e, accent: 0xf0dc8a, wheel: 0x2a2a2a },
};

/** The four life stages of a tree (GDD section 131). */
const TREE_PALETTE: Readonly<Record<TreeGrowthStage, TreeShades>> = {
  SAPLING: { canopy: 0x6f9a4a, canopyDark: 0x56773a, trunk: 0x6b4a2f },
  YOUNG: { canopy: 0x4f7f3f, canopyDark: 0x3c6330, trunk: 0x6b4a2f },
  MATURE: { canopy: 0x366634, canopyDark: 0x2a4f28, trunk: 0x5a3e28 },
  OLD_GROWTH: { canopy: 0x27512c, canopyDark: 0x1d3f22, trunk: 0x5a3e28 },
};

/**
 * What a cell is used for (GDD section 15), keyed by the domain enum minus `NONE`:
 * unowned land has no tint, because the terrain is the whole message there.
 *
 * `ROAD` is a reserved value of the enum, outside the MVP list of GDD section 69. It
 * carries a colour anyway, so that the day roads exist the legend is not the thing
 * that has to be invented.
 */
const LAND_USE_PALETTE: Readonly<Record<Exclude<LandUse, 'NONE'>, Rgb>> = {
  OWNED: 0xe0b352,
  FIELD: 0x8a6a3a,
  FOREST_PLOT: 0x4a7350,
  BUILDING: 0x8a8377,
  ROAD: 0x5c5c5c,
};

/** The palette. One module, as plan section 9.4 requires. */
export const PALETTE = {
  terrain: TERRAIN_PALETTE,

  use: LAND_USE_PALETTE,

  /**
   * Land owned by another player (GDD section 14). A tone of its own and not a
   * variation of `use.OWNED`: the MVP has no direct interaction between players, but
   * foreign land is visible and buying it is refused, so the reason has to be
   * readable before the click and not only in the error body.
   */
  ownedForeign: 0x9b7fc4,

  crop: CROP_PALETTE,

  /**
   * Tint ramp of the growth phase (GDD section 80). The progress of a growing
   * field travels as a tint and never as more tiles, which is what keeps the
   * usage atlas at one tile per state (plan section 9.3). A tint multiplies, so
   * `end` is white, that is the tile exactly as it was drawn.
   */
  growth: {
    start: 0xa8b878,
    end: 0xffffff,
  },

  building: BUILDING_PALETTE,
  machine: MACHINE_PALETTE,

  /** Worker figure. The jacket is tinted per worker; see `workerTint`. */
  worker: {
    jacket: 0xd8d2c4,
    skin: 0xc99b76,
    boots: 0x3f4a5a,
  },

  tree: TREE_PALETTE,

  /**
   * Interface layer drawn inside the canvas: grid, cursors, outlines and
   * particles. The panels of Vue read the same values through the CSS block
   * below.
   */
  ui: {
    /**
     * What shows where no chunk is loaded yet. Darker than any terrain, so the edge
     * of the streamed area reads as "not loaded" and never as a terrain type.
     */
    canvasVoid: 0x101317,
    grid: 0xffffff,
    cursorValid: 0x7ad07a,
    cursorInvalid: 0xd9584c,
    cursorNeutral: 0xe8e8e8,
    /** A cell whose confirmation the server has not answered yet (plan section 7). */
    pending: 0x4fc3d9,
    selection: 0xffffff,
    outlineProperty: 0xe0b352,
    outlineField: 0x9dc167,
    outlineFarm: 0xcfd4dc,
    outlineForestPlot: 0x9fd08f,
    particleDust: 0xc9b98f,
    particleLeaf: 0x6f9a4a,
    /**
     * Loud on purpose. It fills the padding tiles of the usage atlas, so an off
     * by one in the tile index of a later workflow shows up as magenta instead of
     * as a plausible tile.
     */
    missing: 0xff00ff,
  },
} as const;

/**
 * Alpha of the grid line, out of 255. The grid is one repeated tile over the
 * terrain (plan section 9.3), so it has to read at zoom 1 without competing with
 * the state marks.
 */
export const GRID_LINE_ALPHA = 26;

/**
 * Alpha of the ownership wash and of the farm footprint, out of 255. The usage
 * layer sits on top of the terrain layer, so its tiles are translucent wherever
 * the terrain has to stay visible.
 */
export const OWNERSHIP_WASH_ALPHA = 56;

/** Alpha of the border a usage tile draws along its own edge, out of 255. */
export const OWNERSHIP_EDGE_ALPHA = 170;

/**
 * Jacket tints of the worker sprite. A curated list and not a computed hue:
 * eight colours chosen to be distinguishable from each other and from the
 * terrain, which a free hue rotation does not guarantee, since a green worker on
 * grass is invisible however deterministic its derivation was.
 */
export const WORKER_TINTS: readonly Rgb[] = [
  0xe0e0e0, 0xf0c04a, 0x6fb0e0, 0xe08a5a, 0xb08ad0, 0x7ad0a8, 0xd07a9a, 0xc0c060,
];

/**
 * Tint of a worker, derived from the identifier so that the same worker keeps the
 * same colour across sessions and across two open tabs. A pure function of the
 * string: there is no `Math.random` anywhere in the art, for the same reason the
 * terrain generator has none.
 *
 * The mixer is FNV-1a, which is enough to spread short identifiers over eight
 * slots and is two operations per character.
 */
export function workerTint(workerId: string): Rgb {
  let hash = 0x811c_9dc5;
  for (let index = 0; index < workerId.length; index += 1) {
    hash ^= workerId.charCodeAt(index);
    hash = Math.imul(hash, 0x0100_0193);
  }
  const slot = (hash >>> 0) % WORKER_TINTS.length;
  return WORKER_TINTS[slot] ?? PALETTE.worker.jacket;
}

/** One channel of a linear interpolation between two packed colours. */
function lerpChannel(from: Rgb, to: Rgb, shift: number, ratio: number): number {
  const start = (from >>> shift) & 0xff;
  const end = (to >>> shift) & 0xff;
  return Math.round(start + (end - start) * ratio);
}

/**
 * Tint of a growing field for a given progress (GDD section 80). Linear
 * interpolation between the two ends of `PALETTE.growth` in RGB, which is enough
 * for a ramp between two nearby tones and avoids a colour space conversion on a
 * path that runs once per visible chunk.
 */
export function growthTint(progress: Bp): Rgb {
  const ratio = Math.min(1, Math.max(0, bpToRatio(progress)));
  const from = PALETTE.growth.start;
  const to = PALETTE.growth.end;
  return (
    (lerpChannel(from, to, 16, ratio) << 16) |
    (lerpChannel(from, to, 8, ratio) << 8) |
    lerpChannel(from, to, 0, ratio)
  );
}

// ---------------------------------------------------------------------------
// Re-export as CSS custom properties
// ---------------------------------------------------------------------------

/** `0xRRGGBB` as the `#rrggbb` string that CSS expects. */
export function toCssHex(colour: Rgb): string {
  return `#${(colour & 0xff_ffff).toString(16).padStart(6, '0')}`;
}

/** `0xRRGGBB` plus an alpha byte as the eight digit hex CSS also accepts. */
export function toCssHexAlpha(colour: Rgb, alpha: number): string {
  return `${toCssHex(colour)}${Math.round(alpha).toString(16).padStart(2, '0')}`;
}

/** `SCREAMING_SNAKE` to `kebab-case`, so an enum member names its variable. */
function kebab(name: string): string {
  return name.toLowerCase().replace(/_/g, '-');
}

/**
 * Token suffix of each state of the crop cycle.
 *
 * It is a table and not `kebab(state)` because of one name: the token of
 * `READY_TO_HARVEST` is `--fw-crop-ready`, which is what `app/assets/tokens.css`
 * declares and what the panels of W4 to W6 read. The mapping is explicit so a state
 * added to the domain fails the type check here instead of silently producing a
 * token nobody reads.
 */
const CROP_TOKEN_SUFFIX: Readonly<Record<CropCycleState, string>> = {
  VIRGIN: 'virgin',
  PLOWED: 'plowed',
  CULTIVATED: 'cultivated',
  SEEDED: 'seeded',
  GERMINATING: 'germinating',
  GROWING: 'growing',
  READY_TO_HARVEST: 'ready',
  HARVESTED: 'harvested',
};

/**
 * The palette as CSS custom properties.
 *
 * The names are not chosen here. `app/assets/tokens.css` declares the palette block
 * as the contract between the canvas and the DOM, and the panels, the legend and
 * `shell.css` read those names; this function re-exports exactly them, with the
 * values of this module, which is the single source of truth the same file names.
 * Scope: colours of the world and of the entities. The tokens of the page shell
 * (surfaces, text, layout metrics) belong to the interface block of that file and
 * none of them is redefined here.
 *
 * Four token families go beyond the declared block, and each is an addition rather
 * than a rename: `--fw-use-owned-foreign`, because the legend has to separate own
 * land from somebody else's; `--fw-machine-*`, because
 * `--fw-entity-implement` collapses the four implements of GDD section 89 into one
 * colour and the machinery panel lists them apart; `--fw-building-*`, for the same
 * reason on the five buildings of GDD sections 116 and 136; and `--fw-canvas-void`,
 * the colour behind a chunk that has not streamed in yet.
 */
export function paletteCssVariables(): Readonly<Record<string, string>> {
  const variables: Record<string, string> = {};

  // Terrain, the four values of TerrainType.
  for (const [terrain, shades] of Object.entries(PALETTE.terrain)) {
    variables[`--fw-terrain-${kebab(terrain)}`] = toCssHex(shades.base);
  }

  // Land use, the five values of LandUse that carry a colour.
  for (const [use, colour] of Object.entries(PALETTE.use)) {
    variables[`--fw-use-${kebab(use)}`] = toCssHex(colour);
  }
  variables['--fw-use-owned-foreign'] = toCssHex(PALETTE.ownedForeign);

  // Crop cycle, the eight values of CropCycleState. The mark and not the soil: the
  // mark is what names the state, and two states share a soil colour on purpose.
  for (const state of Object.keys(CROP_TOKEN_SUFFIX) as CropCycleState[]) {
    variables[`--fw-crop-${CROP_TOKEN_SUFFIX[state]}`] = toCssHex(PALETTE.crop[state].mark);
  }

  // Tree growth stages.
  for (const [stage, shades] of Object.entries(PALETTE.tree)) {
    variables[`--fw-tree-${kebab(stage)}`] = toCssHex(shades.canopy);
  }

  // Entities drawn on the canvas. Five buckets over eight machine types, which is
  // what the declared block asks for; the per type tokens follow below.
  variables['--fw-entity-worker'] = toCssHex(PALETTE.worker.jacket);
  variables['--fw-entity-tractor'] = toCssHex(PALETTE.machine.TRACTOR.body);
  variables['--fw-entity-implement'] = toCssHex(PALETTE.machine.PLOW.body);
  variables['--fw-entity-harvester'] = toCssHex(PALETTE.machine.HARVESTER.body);
  variables['--fw-entity-forestry'] = toCssHex(PALETTE.machine.HARVESTER_FORESTRY.body);

  // Selection, outlines and grid.
  variables['--fw-select-valid'] = toCssHex(PALETTE.ui.cursorValid);
  variables['--fw-select-invalid'] = toCssHex(PALETTE.ui.cursorInvalid);
  variables['--fw-select-neutral'] = toCssHex(PALETTE.ui.cursorNeutral);
  variables['--fw-select-pending'] = toCssHex(PALETTE.ui.pending);
  variables['--fw-outline-owned'] = toCssHex(PALETTE.ui.outlineProperty);
  variables['--fw-outline-field'] = toCssHex(PALETTE.ui.outlineField);
  variables['--fw-outline-farm'] = toCssHex(PALETTE.ui.outlineFarm);
  variables['--fw-outline-forest-plot'] = toCssHex(PALETTE.ui.outlineForestPlot);
  // The grid line carries its alpha, because the DOM legend has to show the same
  // faint line the canvas draws and not an opaque white.
  variables['--fw-grid-line'] = toCssHexAlpha(PALETTE.ui.grid, GRID_LINE_ALPHA);

  // Additions, documented above.
  for (const [machine, shades] of Object.entries(PALETTE.machine)) {
    variables[`--fw-machine-${kebab(machine)}`] = toCssHex(shades.body);
  }
  for (const [building, shades] of Object.entries(PALETTE.building)) {
    variables[`--fw-building-${kebab(building)}`] = toCssHex(shades.wall);
  }
  variables['--fw-canvas-void'] = toCssHex(PALETTE.ui.canvasVoid);

  return variables;
}

/** Markers that delimit the generated block inside `app/assets/tokens.css`. */
export const PALETTE_BLOCK_START =
  'fw-palette:start — generated block. Owner W3-D, from game/textures/palette.ts';
export const PALETTE_BLOCK_END = 'fw-palette:end';

/**
 * The same variables as the `:root` block of `app/assets/tokens.css`.
 *
 * It exists so the values are reviewable as a diff and so anything styled before the
 * canvas boots already has the right colour. It is not the mechanism that keeps CSS
 * and canvas in agreement: `applyPaletteCssVariables` is, because it writes the
 * values from this module onto the document at boot and therefore cannot go stale.
 * Regenerating the file is a copy of this string between the two markers.
 */
export function paletteCssBlock(): string {
  const lines = Object.entries(paletteCssVariables()).map(
    ([name, value]) => `  ${name}: ${value};`,
  );
  return [
    '/* Generated from app/game/textures/palette.ts (W3-D). Do not edit by hand. */',
    ':root {',
    ...lines,
    '}',
    '',
  ].join('\n');
}

/**
 * Writes the palette onto an element as inline custom properties, normally the
 * document root, at game boot. This is what makes divergence between the CSS and
 * the canvas impossible rather than merely unlikely.
 */
export function applyPaletteCssVariables(root: HTMLElement): void {
  for (const [name, value] of Object.entries(paletteCssVariables())) {
    root.style.setProperty(name, value);
  }
}
