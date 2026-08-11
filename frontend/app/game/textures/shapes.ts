// Shapes drawn with `Graphics` and baked into textures.
//
// Owner: workflow W3-D (rendering core). Second half of plan section 9.4: what has
// a stroke and a silhouette (buildings, machinery, workers, trees, cursors,
// particles) is drawn with `Graphics` and captured with `generateTexture`, while
// what is gridded and noisy is written pixel by pixel in the other modules of this
// directory.
//
// The module is a catalogue and not a sequence of calls: every sprite is an entry
// with its key, its label, its size and its draw function. Three consumers read the
// same catalogue, which is what keeps them from drifting: the factory, which bakes
// it; the inspection route, which paints it; and the unit tests, which assert that
// the eight machine types, the five buildings and the four tree stages are all
// present. Adding a sprite is adding an entry.
//
// Phaser is imported as a type only, so the catalogue itself carries no runtime
// dependency on the engine and can be enumerated by a test in Node.
//
// Two conventions the world and entity layers of W4 and W5 depend on, and which are
// stated here because they cannot be read off a texture:
//
//   - Orientation. Every machine and the worker are drawn facing east, that is towards
//     positive x, centred in their canvas. The entity layer derives the heading from
//     the serpentine path of the task (GDD section 92, plan section 9.5) and sets
//     `rotation`; nothing needs a second set of textures per direction.
//   - Anchor. A building fills its footprint exactly, so it is placed with origin
//     (0, 0) on the north west cell the server reserved. A tree has its trunk at the
//     bottom centre of its canvas, so it is placed with origin (0.5, 1) on the south
//     edge of its cell, which is what makes a row of trees overlap correctly. Machines,
//     workers, cursors and particles are centred, origin (0.5, 0.5).

import type Phaser from 'phaser';
import {
  buildingTextureKey,
  cursorTextureKey,
  CursorKind,
  machineTextureKey,
  particleTextureKey,
  ParticleKind,
  TEXTURE_KEYS,
  treeTextureKey,
  TREE_VARIANTS,
} from './keys';
import { PALETTE } from './palette';
import { BUILDING_CATALOGUE } from '~/shared/config/buildings';
import { MACHINE_CATALOGUE } from '~/shared/config/machines';
import { CELL_PX } from '~/shared/config/world';
import {
  BUILDING_TYPES,
  MACHINE_TYPES,
  TREE_GROWTH_STAGES,
  type BuildingType,
  type MachineType,
  type TreeGrowthStage,
} from '~/shared/domain/enums';

/**
 * Labels of the inspection route, in Spanish, which is the language of the
 * interface. They exist only so the lab route can name a sprite: neither shared
 * catalogue carries a display label, and the panels of W4 to W6 own theirs. Nothing
 * of the game reads these.
 */
const BUILDING_LABELS: Readonly<Record<BuildingType, string>> = {
  GARAGE: 'garaje',
  SILO: 'silo',
  WORKER_HOME: 'vivienda',
  WORKSHOP: 'taller',
  WOOD_STORAGE: 'almacen de madera',
};

const MACHINE_LABELS: Readonly<Record<MachineType, string>> = {
  TRACTOR: 'tractor',
  PLOW: 'arado',
  CULTIVATOR: 'cultivador',
  SEEDER: 'sembradora',
  HARVESTER: 'cosechadora',
  TRAILER: 'remolque',
  HARVESTER_FORESTRY: 'cosechadora forestal',
  FORWARDER: 'autocargador',
};

const TREE_STAGE_LABELS: Readonly<Record<TreeGrowthStage, string>> = {
  SAPLING: 'planton',
  YOUNG: 'joven',
  MATURE: 'maduro',
  OLD_GROWTH: 'viejo',
};

/** Family of a sprite, used to group the inspection route and to report progress. */
export const SpriteGroup = {
  BUILDING: 'BUILDING',
  MACHINE: 'MACHINE',
  WORKER: 'WORKER',
  TREE: 'TREE',
  CURSOR: 'CURSOR',
  PARTICLE: 'PARTICLE',
} as const;
export type SpriteGroup = (typeof SpriteGroup)[keyof typeof SpriteGroup];

/** One generated sprite: its key, its size and how it is drawn. */
export interface SpriteSpec {
  readonly key: string;
  /** Label in Spanish, which is the language of the interface and of the lab route. */
  readonly label: string;
  readonly group: SpriteGroup;
  readonly width: number;
  readonly height: number;
  readonly draw: (graphics: Phaser.GameObjects.Graphics) => void;
}

// ---------------------------------------------------------------------------
// Machinery
// ---------------------------------------------------------------------------

/**
 * Canvas of a machine sprite. Uniform for the eight types, and 32 x 24 px, that is
 * two cells by one and a half at zoom 1: a machine has to be findable on a field of
 * 250 cells without hiding the state of the cells underneath it.
 *
 * Uniform and not per type so that the entity layer can rotate every machine about
 * the centre of its canvas with one rule.
 */
export const MACHINE_SPRITE = { width: 32, height: 24 } as const;

/** Wheels of a powered machine: large at the rear, small at the front. */
function drawPoweredWheels(graphics: Phaser.GameObjects.Graphics, wheel: number): void {
  graphics.fillStyle(wheel, 1);
  graphics.fillRect(5, 2, 7, 5);
  graphics.fillRect(5, 17, 7, 5);
  graphics.fillRect(21, 3, 5, 4);
  graphics.fillRect(21, 17, 5, 4);
}

/** Drawbar of an implement, pointing west towards the machine that tows it. */
function drawDrawbar(graphics: Phaser.GameObjects.Graphics, colour: number): void {
  graphics.fillStyle(colour, 1);
  graphics.fillRect(0, 11, 7, 2);
}

/**
 * Silhouette of one machine type. Distinguishable by shape alone and not only by
 * colour.
 *
 * The undercarriage comes from the role in the shared catalogue and not from a list
 * written here: a powered machine gets wheels and an implement gets a drawbar
 * pointing west (GDD section 88). That way the sprite of a ninth machine is right by
 * construction, and the visual grammar of "this one tows, this one is towed" cannot
 * contradict the validation that enforces it.
 */
function drawMachine(graphics: Phaser.GameObjects.Graphics, type: MachineType): void {
  const shades = PALETTE.machine[type];

  if (MACHINE_CATALOGUE[type].role === 'POWERED') {
    drawPoweredWheels(graphics, shades.wheel);
  } else {
    drawDrawbar(graphics, shades.accent);
  }

  switch (type) {
    // Cab towards the front, big rear wheels, exhaust stack: the shape the player
    // reads as "the machine that tows the others" (GDD section 88).
    case 'TRACTOR':
      graphics.fillStyle(shades.body, 1);
      graphics.fillRect(6, 7, 20, 10);
      graphics.fillStyle(shades.accent, 1);
      graphics.fillRect(15, 8, 8, 8);
      graphics.fillRect(26, 10, 4, 4);
      graphics.fillStyle(shades.wheel, 1);
      graphics.fillRect(9, 5, 2, 3);
      break;

    // Frame with three shares. The shares point west, which is the direction the
    // soil is turned as the machine advances east.
    case 'PLOW':
      graphics.fillStyle(shades.body, 1);
      graphics.fillRect(7, 8, 18, 8);
      graphics.fillStyle(shades.accent, 1);
      for (let index = 0; index < 3; index += 1) {
        const x = 9 + index * 6;
        graphics.fillTriangle(x, 16, x + 5, 16, x, 22);
      }
      break;

    // Many thin tines instead of three shares: the difference between plowing and
    // cultivating has to be visible in the machine as well as in the tile.
    case 'CULTIVATOR':
      graphics.fillStyle(shades.body, 1);
      graphics.fillRect(7, 9, 19, 6);
      graphics.fillStyle(shades.accent, 1);
      for (let index = 0; index < 7; index += 1) {
        graphics.fillRect(8 + index * 3, 15, 1, 6);
      }
      break;

    // Hopper and tubes: the sprite says where the seed comes from, which matters
    // because the catalogue does not cost the seed (GDD section 117).
    case 'SEEDER':
      graphics.fillStyle(shades.body, 1);
      graphics.fillRect(8, 6, 18, 9);
      graphics.fillStyle(shades.accent, 1);
      graphics.fillTriangle(9, 6, 25, 6, 21, 2);
      for (let index = 0; index < 5; index += 1) {
        graphics.fillRect(9 + index * 4, 15, 2, 5);
      }
      break;

    // Header bar with teeth across the front. The widest silhouette of the eight,
    // which is what a machine of 180 000 has to look like (GDD section 89).
    case 'HARVESTER':
      graphics.fillStyle(shades.body, 1);
      graphics.fillRect(4, 6, 20, 12);
      graphics.fillStyle(shades.accent, 1);
      graphics.fillRect(14, 8, 8, 8);
      graphics.fillRect(25, 1, 4, 22);
      graphics.fillStyle(shades.wheel, 1);
      for (let index = 0; index < 6; index += 1) {
        graphics.fillRect(29, 2 + index * 4, 2, 2);
      }
      break;

    // Open box with side rails and a low tailgate: it carries grain, it does not
    // work the soil.
    case 'TRAILER':
      graphics.fillStyle(shades.body, 1);
      graphics.fillRect(7, 5, 22, 14);
      graphics.fillStyle(shades.accent, 1);
      graphics.fillRect(8, 6, 20, 2);
      graphics.fillRect(8, 16, 20, 2);
      graphics.fillStyle(shades.wheel, 1);
      graphics.fillRect(12, 19, 5, 4);
      graphics.fillRect(21, 19, 5, 4);
      break;

    // Crane and grapple: forestry machinery is a separate catalogue by design (GDD
    // section 134) and its silhouette says so.
    case 'HARVESTER_FORESTRY':
      graphics.fillStyle(shades.body, 1);
      graphics.fillRect(5, 7, 17, 10);
      graphics.fillStyle(shades.accent, 1);
      graphics.fillRect(12, 8, 7, 8);
      graphics.lineStyle(2, shades.accent, 1);
      graphics.lineBetween(20, 9, 28, 4);
      graphics.fillStyle(shades.accent, 1);
      graphics.fillCircle(29, 3, 3);
      break;

    // Long bed with a bundle of logs and a crane: the forwarder transports, it does
    // not fell (GDD section 134).
    case 'FORWARDER':
      graphics.fillStyle(shades.body, 1);
      graphics.fillRect(4, 7, 24, 10);
      graphics.fillStyle(PALETTE.tree.MATURE.trunk, 1);
      graphics.fillCircle(9, 10, 3);
      graphics.fillCircle(15, 10, 3);
      graphics.fillCircle(12, 15, 3);
      graphics.fillStyle(shades.accent, 1);
      graphics.fillRect(22, 8, 6, 8);
      graphics.lineStyle(2, shades.accent, 1);
      graphics.lineBetween(24, 8, 30, 12);
      break;
  }
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

/**
 * A building sprite is exactly its footprint, so the world layer places it on the
 * cells the server reserved and no scaling factor has to be agreed anywhere: garage
 * and wood store 6 x 8 cells, silo and worker home 4 x 4, workshop 5 x 5 (GDD
 * sections 116 and 136).
 */
function buildingSize(type: BuildingType): { readonly width: number; readonly height: number } {
  const definition = BUILDING_CATALOGUE[type];
  return { width: definition.widthCells * CELL_PX, height: definition.heightCells * CELL_PX };
}

/** Silhouette of one building type, drawn to fill its footprint. */
function drawBuilding(graphics: Phaser.GameObjects.Graphics, type: BuildingType): void {
  const shades = PALETTE.building[type];
  const size = buildingSize(type);
  const width = size.width;
  const height = size.height;

  // Common base: walls inset by two pixels, so two adjacent buildings do not merge
  // into one block, plus a shadow on the south and east sides for depth.
  graphics.fillStyle(shades.wall, 1);
  graphics.fillRect(2, 2, width - 4, height - 4);
  graphics.fillStyle(shades.roof, 1);
  graphics.fillRect(2, height - 6, width - 4, 4);
  graphics.fillRect(width - 6, 2, 4, height - 4);

  switch (type) {
    // Three door bays along the south face: the garage is where machines live and
    // its capacity is a hard constraint (GDD section 96).
    case 'GARAGE': {
      graphics.fillStyle(shades.roof, 1);
      graphics.fillRect(6, 6, width - 12, height - 20);
      graphics.fillStyle(shades.trim, 1);
      const bay = Math.floor((width - 16) / 3);
      for (let index = 0; index < 3; index += 1) {
        graphics.fillRect(8 + index * bay, height - 18, bay - 4, 10);
      }
      break;
    }

    // A round tank: the only curved silhouette of the five, which is what makes the
    // silo findable at a glance when the player is looking for storage.
    case 'SILO': {
      const radius = Math.round(Math.min(width, height) / 2) - 4;
      graphics.fillStyle(shades.roof, 1);
      graphics.fillCircle(width / 2, height / 2, radius);
      graphics.fillStyle(shades.trim, 1);
      graphics.fillCircle(width / 2, height / 2, radius - 4);
      graphics.lineStyle(1, shades.roof, 1);
      graphics.strokeRect(Math.round(width / 2) - 2, height - 12, 4, 8);
      break;
    }

    // Pitched roof and a door: domestic shape, because housing capacity is what
    // gates hiring (GDD section 108).
    case 'WORKER_HOME': {
      graphics.fillStyle(shades.roof, 1);
      graphics.fillTriangle(4, height / 2, width / 2, 4, width - 4, height / 2);
      graphics.fillStyle(shades.trim, 1);
      graphics.fillRect(Math.round(width / 2) - 4, height - 14, 8, 10);
      graphics.fillRect(8, height / 2 + 4, 6, 6);
      graphics.fillRect(width - 14, height / 2 + 4, 6, 6);
      break;
    }

    // A cross of tools: the workshop is a precondition of repair (GDD section 93),
    // and repair is the only place the player meets it.
    case 'WORKSHOP': {
      graphics.fillStyle(shades.roof, 1);
      graphics.fillRect(5, 5, width - 10, height - 10);
      graphics.lineStyle(3, shades.trim, 1);
      graphics.lineBetween(10, 10, width - 10, height - 10);
      graphics.lineBetween(width - 10, 10, 10, height - 10);
      break;
    }

    // Stacked logs in a yard: the wood store is a building of its own and not a
    // flag on the silo (GDD section 136).
    case 'WOOD_STORAGE': {
      graphics.fillStyle(PALETTE.tree.MATURE.trunk, 1);
      const logGapX = Math.floor((width - 24) / 3);
      const logGapY = Math.floor((height - 32) / 2);
      for (let row = 0; row < 3; row += 1) {
        for (let column = 0; column < 4; column += 1) {
          graphics.fillCircle(12 + column * logGapX, 16 + row * logGapY, 5);
        }
      }
      graphics.fillStyle(shades.trim, 1);
      graphics.fillRect(4, height - 10, width - 8, 3);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------

/** Canvas of a worker sprite: less than a cell, because a worker is not an obstacle. */
export const WORKER_SPRITE = { width: 12, height: 16 } as const;

/**
 * Worker figure. Drawn in the neutral jacket tone and tinted per worker by
 * `workerTint`, which is the reason it is one texture and not eight: a tint costs
 * nothing and eight textures would have to be regenerated whenever the palette
 * changes.
 */
function drawWorker(graphics: Phaser.GameObjects.Graphics, busy: boolean): void {
  const palette = PALETTE.worker;
  graphics.fillStyle(palette.boots, 1);
  graphics.fillRect(3, 13, 2, 3);
  graphics.fillRect(7, 13, 2, 3);
  graphics.fillStyle(palette.jacket, 1);
  graphics.fillRect(3, 7, 6, 6);
  graphics.fillStyle(palette.skin, 1);
  graphics.fillCircle(6, 4, 3);
  // Facing east, like the machinery, so a worker walking a serpentine path can be
  // rotated with the same rule.
  graphics.fillStyle(palette.boots, 1);
  graphics.fillRect(8, 3, 2, 1);
  if (busy) {
    // A raised tool: the entity layer needs "working" to be legible without a
    // label, because labels live in the overlay scene and are hidden when zoomed out.
    graphics.fillStyle(PALETTE.ui.cursorNeutral, 1);
    graphics.fillRect(9, 6, 1, 6);
    graphics.fillRect(8, 5, 3, 1);
  }
}

// ---------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------

/**
 * Canvas of a tree, per stage. The four sizes are the visual reading of GDD section
 * 131: a sapling is barely a cell and an old growth tree is two, which is what makes
 * the age of a plot legible without opening a panel.
 */
export const TREE_SPRITE_PX: Readonly<Record<TreeGrowthStage, number>> = {
  SAPLING: 12,
  YOUNG: 18,
  MATURE: 26,
  OLD_GROWTH: 32,
};

/**
 * One tree. The variant rotates the canopy lobes by a quarter turn each, which is
 * enough to break the repetition of a plot of hundreds of trees without four
 * different drawings; the trunk stays centred so the sprite can be placed on the
 * centre of its cell.
 */
function drawTree(
  graphics: Phaser.GameObjects.Graphics,
  stage: TreeGrowthStage,
  variant: number,
): void {
  const shades = PALETTE.tree[stage];
  const size = TREE_SPRITE_PX[stage];
  const centre = size / 2;
  const trunkWidth = Math.max(2, Math.round(size / 8));

  graphics.fillStyle(shades.trunk, 1);
  graphics.fillRect(Math.round(centre - trunkWidth / 2), centre, trunkWidth, size / 2 - 1);

  const lobes = stage === 'SAPLING' ? 3 : 5;
  const lobeRadius = size / (stage === 'SAPLING' ? 5 : 4.2);
  const orbit = size / 5;
  const phase = (variant * Math.PI) / 2;

  graphics.fillStyle(shades.canopyDark, 1);
  for (let index = 0; index < lobes; index += 1) {
    const angle = phase + (index * 2 * Math.PI) / lobes;
    graphics.fillCircle(
      centre + Math.cos(angle) * orbit,
      centre - 1 + Math.sin(angle) * orbit * 0.8,
      lobeRadius,
    );
  }
  graphics.fillStyle(shades.canopy, 1);
  for (let index = 0; index < lobes; index += 1) {
    const angle = phase + (index * 2 * Math.PI) / lobes;
    graphics.fillCircle(
      centre + Math.cos(angle) * orbit,
      centre - 2 + Math.sin(angle) * orbit * 0.8,
      lobeRadius - 1,
    );
  }
}

// ---------------------------------------------------------------------------
// Cursors and particles
// ---------------------------------------------------------------------------

/** A cursor covers exactly one cell, which is the unit the player selects in. */
export const CURSOR_SPRITE_PX = CELL_PX;

/** Cursor frame: a border plus corner ticks, so it reads over any terrain. */
function drawCursor(graphics: Phaser.GameObjects.Graphics, kind: CursorKind): void {
  const colour =
    kind === CursorKind.VALID
      ? PALETTE.ui.cursorValid
      : kind === CursorKind.INVALID
        ? PALETTE.ui.cursorInvalid
        : PALETTE.ui.cursorNeutral;
  const size = CURSOR_SPRITE_PX;
  graphics.fillStyle(colour, 0.18);
  graphics.fillRect(0, 0, size, size);
  graphics.lineStyle(1, colour, 0.95);
  graphics.strokeRect(0.5, 0.5, size - 1, size - 1);
  graphics.fillStyle(colour, 1);
  const tick = 4;
  graphics.fillRect(0, 0, tick, 1);
  graphics.fillRect(0, 0, 1, tick);
  graphics.fillRect(size - tick, 0, tick, 1);
  graphics.fillRect(size - 1, 0, 1, tick);
  graphics.fillRect(0, size - 1, tick, 1);
  graphics.fillRect(0, size - tick, 1, tick);
  graphics.fillRect(size - tick, size - 1, tick, 1);
  graphics.fillRect(size - 1, size - tick, 1, tick);
  if (kind === CursorKind.INVALID) {
    // A diagonal, so the reason is readable without relying on the red.
    graphics.lineStyle(1, colour, 0.9);
    graphics.lineBetween(2, 2, size - 2, size - 2);
  }
}

/** Size of a particle, per kind. Small on purpose: they are decoration, not state. */
export const PARTICLE_SPRITE_PX: Readonly<Record<ParticleKind, number>> = {
  dust: 4,
  leaf: 3,
  spark: 2,
};

/** A particle: a filled square with a lighter core, which reads as a mote at any zoom. */
function drawParticle(graphics: Phaser.GameObjects.Graphics, kind: ParticleKind): void {
  const size = PARTICLE_SPRITE_PX[kind];
  const colour =
    kind === ParticleKind.DUST
      ? PALETTE.ui.particleDust
      : kind === ParticleKind.LEAF
        ? PALETTE.ui.particleLeaf
        : PALETTE.ui.cursorNeutral;
  graphics.fillStyle(colour, 0.85);
  graphics.fillRect(0, 0, size, size);
  if (size >= 3) {
    graphics.fillStyle(colour, 1);
    graphics.fillRect(1, 1, size - 2, size - 2);
  }
}

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

/**
 * Every sprite drawn with `Graphics`, in generation order. Derived from the shared
 * catalogues and from the domain enums, never from a list written by hand: a ninth
 * machine type added to `MachineType` appears here without touching this file, which
 * is what stops the art from silently lagging behind the domain.
 */
export const SPRITE_CATALOGUE: readonly SpriteSpec[] = [
  ...BUILDING_TYPES.map((type): SpriteSpec => {
    const size = buildingSize(type);
    return {
      key: buildingTextureKey(type),
      label: `Edificio: ${BUILDING_LABELS[type]}`,
      group: SpriteGroup.BUILDING,
      width: size.width,
      height: size.height,
      draw: (graphics) => drawBuilding(graphics, type),
    };
  }),
  ...MACHINE_TYPES.map((type): SpriteSpec => ({
    key: machineTextureKey(type),
    label: `Maquina: ${MACHINE_LABELS[type]}`,
    group: SpriteGroup.MACHINE,
    width: MACHINE_SPRITE.width,
    height: MACHINE_SPRITE.height,
    draw: (graphics) => drawMachine(graphics, type),
  })),
  {
    key: TEXTURE_KEYS.worker,
    label: 'Trabajador en reposo',
    group: SpriteGroup.WORKER,
    width: WORKER_SPRITE.width,
    height: WORKER_SPRITE.height,
    draw: (graphics) => drawWorker(graphics, false),
  },
  {
    key: TEXTURE_KEYS.workerBusy,
    label: 'Trabajador en tarea',
    group: SpriteGroup.WORKER,
    width: WORKER_SPRITE.width,
    height: WORKER_SPRITE.height,
    draw: (graphics) => drawWorker(graphics, true),
  },
  ...TREE_GROWTH_STAGES.flatMap((stage): SpriteSpec[] =>
    Array.from({ length: TREE_VARIANTS }, (_unused, variant): SpriteSpec => ({
      key: treeTextureKey(stage, variant),
      label: `Arbol ${TREE_STAGE_LABELS[stage]}, variante ${variant}`,
      group: SpriteGroup.TREE,
      width: TREE_SPRITE_PX[stage],
      height: TREE_SPRITE_PX[stage],
      draw: (graphics) => drawTree(graphics, stage, variant),
    })),
  ),
  ...Object.values(CursorKind).map((kind): SpriteSpec => ({
    key: cursorTextureKey(kind),
    label: `Cursor ${kind}`,
    group: SpriteGroup.CURSOR,
    width: CURSOR_SPRITE_PX,
    height: CURSOR_SPRITE_PX,
    draw: (graphics) => drawCursor(graphics, kind),
  })),
  ...Object.values(ParticleKind).map((kind): SpriteSpec => ({
    key: particleTextureKey(kind),
    label: `Particula ${kind}`,
    group: SpriteGroup.PARTICLE,
    width: PARTICLE_SPRITE_PX[kind],
    height: PARTICLE_SPRITE_PX[kind],
    draw: (graphics) => drawParticle(graphics, kind),
  })),
];

/** The catalogue grouped by family, which is how the inspection route lays it out. */
export function spritesByGroup(group: SpriteGroup): readonly SpriteSpec[] {
  return SPRITE_CATALOGUE.filter((sprite) => sprite.group === group);
}
