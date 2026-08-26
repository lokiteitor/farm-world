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
  HAY_BARN: 'henil',
  COLD_STORE: 'camara fria',
  WAREHOUSE: 'almacen',
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

// ---------------------------------------------------------------------------
// Machinery
// ---------------------------------------------------------------------------

/**
 * Canvas of a machine sprite. Uniform for the eight types, and 64 x 48 px, that is
 * two cells by one and a half at zoom 1: a machine has to be findable on a field of
 * 250 cells without hiding the state of the cells underneath it.
 *
 * Uniform and not per type so that the entity layer can rotate every machine about
 * the centre of its canvas with one rule.
 */
export const MACHINE_SPRITE = { width: 64, height: 48 } as const;

/** Wheels of a powered machine: large at the rear, small at the front, with tread and rims. */
function drawPoweredWheels(
  graphics: Phaser.GameObjects.Graphics,
  wheel: number,
  rim: number,
): void {
  // Heavy rear wheels
  graphics.fillStyle(0x181a1d, 1);
  graphics.fillRoundedRect(10, 4, 15, 10, 2);
  graphics.fillRoundedRect(10, 34, 15, 10, 2);
  // Rear rims
  graphics.fillStyle(rim, 1);
  graphics.fillRect(14, 6, 7, 6);
  graphics.fillRect(14, 36, 7, 6);
  graphics.fillStyle(0x111111, 1);
  graphics.fillCircle(17, 9, 2);
  graphics.fillCircle(17, 39, 2);

  // Front steering wheels
  graphics.fillStyle(0x181a1d, 1);
  graphics.fillRoundedRect(42, 6, 11, 8, 2);
  graphics.fillRoundedRect(42, 34, 11, 8, 2);
  // Front rims
  graphics.fillStyle(rim, 1);
  graphics.fillRect(45, 8, 5, 4);
  graphics.fillRect(45, 36, 5, 4);
}

/** Drawbar of an implement, pointing west towards the machine that tows it. */
function drawDrawbar(graphics: Phaser.GameObjects.Graphics, colour: number): void {
  graphics.fillStyle(0x33373d, 1);
  graphics.fillRect(0, 22, 14, 4);
  graphics.fillStyle(colour, 1);
  graphics.fillCircle(3, 24, 3);
  graphics.fillStyle(0x111111, 1);
  graphics.fillCircle(3, 24, 1);
}

/**
 * Silhouette of one machine type. Distinguishable by shape alone and not only by
 * colour.
 */
function drawMachine(graphics: Phaser.GameObjects.Graphics, type: MachineType): void {
  const shades = PALETTE.machine[type];

  if (MACHINE_CATALOGUE[type].role === 'POWERED') {
    drawPoweredWheels(graphics, shades.wheel, shades.accent);
  } else {
    drawDrawbar(graphics, shades.accent);
  }

  switch (type) {
    // Cab towards the front, big rear wheels, exhaust stack, headlights and cab glass.
    case 'TRACTOR':
      // Chassis & body hood
      graphics.fillStyle(shades.body, 1);
      graphics.fillRoundedRect(12, 14, 40, 20, 3);
      // Engine hood highlight
      graphics.fillStyle(shades.accent, 1);
      graphics.fillRect(28, 16, 22, 16);
      // Front radiator grille & chrome
      graphics.fillStyle(0x1a1a1a, 1);
      graphics.fillRect(51, 17, 3, 14);
      // Twin headlights
      graphics.fillStyle(0xffea78, 1);
      graphics.fillRect(52, 18, 2, 3);
      graphics.fillRect(52, 27, 2, 3);
      // Enclosed glass cabin
      graphics.fillStyle(0x222b35, 1);
      graphics.fillRect(16, 15, 18, 18);
      graphics.fillStyle(0x8ed4f8, 0.85);
      graphics.fillRect(18, 17, 14, 14);
      // Glass specular reflection
      graphics.fillStyle(0xffffff, 0.7);
      graphics.fillRect(20, 19, 4, 10);
      // Cab roof
      graphics.fillStyle(shades.body, 1);
      graphics.fillRect(15, 14, 20, 2);
      // Amber hazard beacon light
      graphics.fillStyle(0xf39c12, 1);
      graphics.fillRect(24, 11, 4, 3);
      // Vertical exhaust stack
      graphics.fillStyle(0x2c3e50, 1);
      graphics.fillRect(36, 10, 3, 6);
      graphics.fillCircle(37, 10, 2);
      break;

    // Frame with curved shares and depth wheel.
    case 'PLOW':
      graphics.fillStyle(shades.body, 1);
      graphics.fillRect(14, 16, 36, 16);
      // Steel moldboard shares pointing west
      graphics.fillStyle(shades.accent, 1);
      for (let index = 0; index < 4; index += 1) {
        const x = 18 + index * 9;
        graphics.fillTriangle(x, 32, x + 8, 32, x, 44);
        graphics.fillStyle(0xdde2e8, 1); // polished cutting edge
        graphics.fillTriangle(x, 32, x + 3, 32, x, 44);
        graphics.fillStyle(shades.accent, 1);
      }
      // Depth gauge wheel
      graphics.fillStyle(0x1a1a1a, 1);
      graphics.fillCircle(46, 38, 4);
      graphics.fillStyle(0xcccccc, 1);
      graphics.fillCircle(46, 38, 2);
      break;

    // Spring tines and crumbler roller.
    case 'CULTIVATOR':
      graphics.fillStyle(shades.body, 1);
      graphics.fillRect(14, 18, 38, 12);
      graphics.fillStyle(shades.accent, 1);
      // Dual row spring tines
      for (let index = 0; index < 9; index += 1) {
        const x = 16 + index * 4;
        graphics.fillRect(x, 30, 2, 12);
        graphics.fillRect(x - 1, 40, 4, 3); // duckfoot shovel tip
      }
      // Rear crumbler cage roller
      graphics.fillStyle(0x5a6572, 1);
      graphics.fillRect(12, 15, 42, 3);
      break;

    // Large V-hopper, safety walkway and seed tubes.
    case 'SEEDER':
      graphics.fillStyle(shades.body, 1);
      graphics.fillRoundedRect(16, 12, 36, 18, 2);
      // Seed hopper lid
      graphics.fillStyle(shades.accent, 1);
      graphics.fillTriangle(18, 12, 50, 12, 42, 4);
      // Delivery seed tubes
      for (let index = 0; index < 7; index += 1) {
        const x = 18 + index * 5;
        graphics.fillStyle(0x222222, 1);
        graphics.fillRect(x, 30, 2, 10);
        graphics.fillStyle(shades.accent, 1);
        graphics.fillCircle(x + 1, 41, 3); // coulter disc
      }
      break;

    // Header bar with reel, glass cab, grain tank and unloading auger.
    case 'HARVESTER':
      graphics.fillStyle(shades.body, 1);
      graphics.fillRect(8, 12, 40, 24);
      // High operator cab
      graphics.fillStyle(0x8ed4f8, 0.85);
      graphics.fillRect(28, 15, 16, 14);
      graphics.fillStyle(0xffffff, 0.7);
      graphics.fillRect(32, 17, 4, 10);
      // Grain tank with golden grain
      graphics.fillStyle(0xf1c40f, 1);
      graphics.fillRect(12, 16, 14, 16);
      // Side unloading auger pipe
      graphics.fillStyle(shades.accent, 1);
      graphics.fillRect(6, 10, 24, 3);
      // Giant front harvesting header
      graphics.fillStyle(shades.body, 1);
      graphics.fillRect(48, 2, 8, 44);
      graphics.fillStyle(shades.accent, 1);
      graphics.fillRect(54, 4, 4, 40);
      // Rotating reel teeth
      graphics.fillStyle(0x1a1a1a, 1);
      for (let index = 0; index < 9; index += 1) {
        graphics.fillRect(58, 4 + index * 4, 4, 2);
      }
      break;

    // High sided grain trailer with visible wheat and dual axles.
    case 'TRAILER':
      graphics.fillStyle(shades.body, 1);
      graphics.fillRoundedRect(14, 10, 44, 28, 2);
      // Inside cargo (golden wheat)
      graphics.fillStyle(0xf1c40f, 1);
      graphics.fillRect(18, 14, 36, 20);
      // Ribbed side structural posts
      graphics.fillStyle(shades.accent, 1);
      for (let p = 0; p < 5; p += 1) {
        graphics.fillRect(16 + p * 8, 9, 3, 30);
      }
      // Dual wheel axles
      graphics.fillStyle(shades.wheel, 1);
      graphics.fillRect(22, 38, 10, 6);
      graphics.fillRect(38, 38, 10, 6);
      break;

    // Articulated chassis, crane boom, hydraulic cylinders and processing head.
    case 'HARVESTER_FORESTRY':
      graphics.fillStyle(shades.body, 1);
      graphics.fillRoundedRect(10, 14, 34, 20, 2);
      // Operator cab with safety cage
      graphics.fillStyle(0x8ed4f8, 0.85);
      graphics.fillRect(24, 16, 14, 16);
      graphics.lineStyle(1, 0x111111, 0.8);
      graphics.strokeRect(24, 16, 14, 16);
      // Hydraulic telescopic boom
      graphics.lineStyle(4, shades.accent, 1);
      graphics.lineBetween(38, 18, 54, 10);
      graphics.lineStyle(2, 0xdde2e8, 1);
      graphics.lineBetween(40, 20, 52, 12);
      // Harvester felling head
      graphics.fillStyle(shades.accent, 1);
      graphics.fillCircle(56, 9, 5);
      graphics.fillStyle(0x222222, 1);
      graphics.fillRect(57, 10, 5, 2); // chainsaw bar
      break;

    // Articulated transporter with log bunk, real log textures and crane.
    case 'FORWARDER':
      graphics.fillStyle(shades.body, 1);
      graphics.fillRoundedRect(8, 14, 48, 20, 2);
      // Log bunk with stacked logs showing end-grain growth rings
      graphics.fillStyle(PALETTE.tree.MATURE.trunk, 1);
      graphics.fillCircle(18, 20, 5);
      graphics.fillCircle(29, 20, 5);
      graphics.fillCircle(23, 28, 5);
      graphics.fillCircle(34, 28, 5);
      // Log growth rings
      graphics.fillStyle(0xd4ac0d, 1);
      graphics.fillCircle(18, 20, 3);
      graphics.fillCircle(29, 20, 3);
      graphics.fillCircle(23, 28, 3);
      graphics.fillCircle(34, 28, 3);
      // Cab & knuckleboom crane
      graphics.fillStyle(shades.accent, 1);
      graphics.fillRect(44, 16, 10, 16);
      graphics.lineStyle(3, shades.accent, 1);
      graphics.lineBetween(48, 16, 60, 24);
      // Log grapple claw
      graphics.fillStyle(0x222222, 1);
      graphics.fillCircle(60, 24, 4);
      break;
  }
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

/**
 * A building sprite is exactly its footprint, so the world layer places it on the
 * cells the server reserved and no scaling factor has to be agreed anywhere.
 */
function buildingSize(type: BuildingType): { readonly width: number; readonly height: number } {
  const definition = BUILDING_CATALOGUE[type];
  return { width: definition.widthCells * CELL_PX, height: definition.heightCells * CELL_PX };
}

/** Silhouette of one building type, drawn to fill its footprint with high architectural detail. */
function drawBuilding(graphics: Phaser.GameObjects.Graphics, type: BuildingType): void {
  const shades = PALETTE.building[type];
  const size = buildingSize(type);
  const width = size.width;
  const height = size.height;

  // Soft ambient ground shadow cast to south and east
  graphics.fillStyle(0x000000, 0.22);
  graphics.fillRoundedRect(8, 8, width - 8, height - 8, 4);

  switch (type) {
    // -----------------------------------------------------------------------
    // GARAGE: Modern agricultural machinery depot with 3 sectional doors,
    // skylights, concrete apron, floodlights and fuel service tank.
    // -----------------------------------------------------------------------
    case 'GARAGE': {
      // Concrete apron & driveway in front of the bays
      graphics.fillStyle(0x8a929a, 1);
      graphics.fillRect(6, height - 80, width - 12, 74);
      // Concrete expansion seams & tire tracks
      graphics.fillStyle(0x727a82, 1);
      graphics.fillRect(6, height - 42, width - 12, 2);
      graphics.fillRect(width / 3 + 2, height - 80, 2, 74);
      graphics.fillRect((width * 2) / 3 - 2, height - 80, 2, 74);
      // Tire grease marks
      graphics.fillStyle(0x5a6068, 0.4);
      graphics.fillRect(24, height - 60, 20, 50);
      graphics.fillRect(width / 3 + 24, height - 60, 20, 50);
      graphics.fillRect((width * 2) / 3 + 20, height - 60, 20, 50);

      // Main structural walls
      graphics.fillStyle(shades.wall, 1);
      graphics.fillRect(6, 6, width - 12, height - 86);
      // Steel vertical panel seams
      graphics.fillStyle(0x48505a, 0.6);
      for (let vx = 18; vx < width - 18; vx += 12) {
        graphics.fillRect(vx, 6, 2, height - 86);
      }

      // Pitched corrugated steel roof
      graphics.fillStyle(shades.roof, 1);
      graphics.fillRect(10, 10, width - 20, height - 120);
      // Roof corrugation ribs
      graphics.fillStyle(0x2d343c, 0.7);
      for (let ry = 16; ry < height - 122; ry += 10) {
        graphics.fillRect(12, ry, width - 24, 2);
      }

      // 4 Multi-pane glass skylights with specular glare
      const drawSkylight = (sx: number, sy: number) => {
        graphics.fillStyle(0x1a222a, 1);
        graphics.fillRect(sx - 2, sy - 2, 36, 22);
        graphics.fillStyle(0x8ed4f8, 0.9);
        graphics.fillRect(sx, sy, 32, 18);
        graphics.fillStyle(0xffffff, 0.85);
        graphics.fillTriangle(sx + 4, sy + 16, sx + 14, sy + 2, sx + 20, sy + 2);
        graphics.lineStyle(1, 0x1a222a, 0.8);
        graphics.strokeRect(sx, sy, 32, 18);
        graphics.lineBetween(sx + 16, sy, sx + 16, sy + 18);
      };
      drawSkylight(28, 26);
      drawSkylight(width - 64, 26);
      drawSkylight(28, 72);
      drawSkylight(width - 64, 72);

      // 3 Roof turbine ventilators
      const drawVent = (vx: number, vy: number) => {
        graphics.fillStyle(shades.trim, 1);
        graphics.fillCircle(vx, vy, 7);
        graphics.fillStyle(0x2c3e50, 1);
        graphics.fillCircle(vx, vy, 4);
        graphics.fillStyle(0xffffff, 0.8);
        graphics.fillCircle(vx - 2, vy - 2, 2);
      };
      drawVent(width / 4, 114);
      drawVent(width / 2, 114);
      drawVent((width * 3) / 4, 114);

      // 3 Large roll-up sectional doors along the south facade
      const bayWidth = Math.floor((width - 36) / 3);
      for (let i = 0; i < 3; i += 1) {
        const doorX = 14 + i * (bayWidth + 4);
        const doorY = height - 100;
        const doorH = 48;

        // Recessed dark frame
        graphics.fillStyle(0x222830, 1);
        graphics.fillRect(doorX - 2, doorY - 2, bayWidth + 4, doorH + 4);
        // Door panels in trim tone
        graphics.fillStyle(0x4a5460, 1);
        graphics.fillRect(doorX, doorY, bayWidth, doorH);

        // Window lites row
        graphics.fillStyle(0x8ed4f8, 0.95);
        for (let w = 0; w < 4; w += 1) {
          const wx = doorX + 4 + w * Math.floor((bayWidth - 8) / 4);
          graphics.fillRect(wx, doorY + 6, Math.floor((bayWidth - 16) / 4), 8);
        }

        // Horizontal panel slats
        graphics.fillStyle(0x222830, 0.9);
        graphics.fillRect(doorX, doorY + 18, bayWidth, 2);
        graphics.fillRect(doorX, doorY + 28, bayWidth, 2);
        graphics.fillRect(doorX, doorY + 38, bayWidth, 2);

        // Yellow & Black hazard threshold bumper
        for (let hz = 0; hz < bayWidth; hz += 8) {
          graphics.fillStyle(hz % 16 === 0 ? 0xf1c40f : 0x111111, 1);
          graphics.fillRect(doorX + hz, doorY + doorH - 4, 8, 4);
        }

        // Exterior floodlight fixture
        graphics.fillStyle(0x111111, 1);
        graphics.fillRect(doorX + bayWidth / 2 - 4, doorY - 8, 8, 4);
        graphics.fillStyle(0xffea78, 1);
        graphics.fillCircle(doorX + bayWidth / 2, doorY - 5, 3);
      }

      // Red fuel / diesel storage tank on the side
      graphics.fillStyle(0xc0392b, 1);
      graphics.fillRoundedRect(width - 24, height - 76, 16, 32, 3);
      graphics.fillStyle(0xffffff, 1);
      graphics.fillRect(width - 20, height - 64, 8, 8); // hazard diamond
      graphics.fillStyle(0x111111, 1);
      graphics.fillRect(width - 22, height - 78, 4, 4); // fill cap
      graphics.lineStyle(2, 0x111111, 1);
      graphics.lineBetween(width - 12, height - 60, width - 8, height - 48); // hose
      break;
    }

    // -----------------------------------------------------------------------
    // SILO: Cylindrical corrugated galvanized steel grain silo with 3D radial
    // lighting, apex dome, cage ladder, fill pipe and discharge chute.
    // -----------------------------------------------------------------------
    case 'SILO': {
      const centerX = width / 2;
      const centerY = height / 2 - 2;
      const radius = Math.round(Math.min(width, height) / 2) - 8;

      // Reinforced octagonal concrete foundation plinth
      graphics.fillStyle(0x7f8c8d, 1);
      graphics.fillCircle(centerX, centerY + 4, radius + 6);
      graphics.fillStyle(0x95a5a6, 1);
      graphics.fillCircle(centerX, centerY + 2, radius + 4);

      // Main cylindrical silo body with 3D radial lighting
      graphics.fillStyle(0x5a636e, 1); // dark shadow side (SE)
      graphics.fillCircle(centerX + 3, centerY + 3, radius);
      graphics.fillStyle(shades.wall, 1); // mid-tone galvanized steel
      graphics.fillCircle(centerX, centerY, radius);
      graphics.fillStyle(0xe4ebf2, 1); // bright specular highlight stripe (NW)
      graphics.fillCircle(centerX - 8, centerY - 8, radius * 0.7);

      // Concentric corrugated reinforcement rings
      graphics.lineStyle(2, 0x707b88, 0.7);
      graphics.strokeCircle(centerX, centerY, radius * 0.85);
      graphics.strokeCircle(centerX, centerY, radius * 0.65);
      graphics.strokeCircle(centerX, centerY, radius * 0.45);
      graphics.strokeCircle(centerX, centerY, radius * 0.25);

      // Conical dome roof cap with radial ribs
      graphics.fillStyle(shades.roof, 1);
      graphics.fillCircle(centerX, centerY, radius * 0.5);
      graphics.fillStyle(shades.trim, 1);
      graphics.fillCircle(centerX - 3, centerY - 3, radius * 0.4);
      graphics.lineStyle(1, 0x48525d, 0.9);
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
        graphics.lineBetween(
          centerX,
          centerY,
          centerX + Math.cos(angle) * radius * 0.5,
          centerY + Math.sin(angle) * radius * 0.5,
        );
      }

      // Central apex aeration ventilator & inspection hatch
      graphics.fillStyle(0x2c3e50, 1);
      graphics.fillCircle(centerX, centerY, 8);
      graphics.fillStyle(0xd6dbe0, 1);
      graphics.fillCircle(centerX - 2, centerY - 2, 5);

      // Full-height safety cage ladder on the east side
      const ladderX = centerX + radius - 8;
      graphics.fillStyle(0x2c3e50, 1);
      graphics.fillRect(ladderX, centerY - radius + 10, 4, radius * 1.8);
      for (let rung = centerY - radius + 14; rung < centerY + radius - 6; rung += 7) {
        graphics.fillRect(ladderX - 4, rung, 10, 2); // rungs
        graphics.lineStyle(1, 0xd6dbe0, 0.9);
        graphics.strokeCircle(ladderX + 2, rung, 5); // safety hoops
      }

      // External galvanized grain fill pipe running up the west side
      graphics.lineStyle(3, 0xdfe6ed, 1);
      graphics.lineBetween(centerX - radius + 4, centerY + radius - 10, centerX - 4, centerY);
      graphics.fillStyle(0x2c3e50, 1);
      graphics.fillCircle(centerX - radius + 4, centerY + radius - 10, 4); // intake hopper

      // Bottom grain discharge chute
      graphics.fillStyle(0x34495e, 1);
      graphics.fillRect(centerX - 8, height - 18, 16, 12);
      graphics.fillStyle(0xf1c40f, 1); // grain stream marker
      graphics.fillRect(centerX - 4, height - 10, 8, 4);
      break;
    }

    // -----------------------------------------------------------------------
    // WORKER_HOME: Cozy country farmhouse with terracotta tiled roof, dormer,
    // timber framing, stone chimney, shutters, porch and flower boxes.
    // -----------------------------------------------------------------------
    case 'WORKER_HOME': {
      // Cobblestone walkway & rustic stone foundation
      graphics.fillStyle(0x7f8c8d, 1);
      graphics.fillRoundedRect(6, 6, width - 12, height - 12, 3);
      graphics.fillStyle(0x95a5a6, 1);
      graphics.fillRect(width / 2 - 12, height - 18, 24, 16); // stone path

      // Warm half-timbered walls
      graphics.fillStyle(shades.wall, 1);
      graphics.fillRect(10, 10, width - 20, height - 20);
      // Dark oak timber framing beams
      graphics.fillStyle(0x5a3e28, 1);
      graphics.fillRect(10, 10, 4, height - 20);
      graphics.fillRect(width - 14, 10, 4, height - 20);
      graphics.fillRect(10, height / 2 + 6, width - 20, 3);

      // Terracotta tiled roof with individual scalloped tile courses
      graphics.fillStyle(shades.roof, 1);
      graphics.fillTriangle(6, height / 2 + 4, width / 2, 8, width - 6, height / 2 + 4);
      // Tile shading courses
      for (let row = 16; row < height / 2 + 2; row += 8) {
        const factor = (row - 8) / (height / 2 - 4);
        const span = (width / 2 - 8) * factor;
        graphics.fillStyle(0x641e16, 0.8); // tile shadow line
        graphics.fillRect(width / 2 - span, row, span * 2, 2);
        graphics.fillStyle(0xd35400, 0.6); // tile ridge highlight
        graphics.fillRect(width / 2 - span, row - 2, span * 2, 1);
      }
      // Roof ridge cap
      graphics.fillStyle(0x501810, 1);
      graphics.fillRect(width / 2 - 6, 6, 12, 4);

      // Stone chimney with clay pot on the side
      graphics.fillStyle(0x5d6d7e, 1);
      graphics.fillRect(width - 26, 12, 14, 28);
      graphics.fillStyle(0x34495e, 1);
      graphics.fillRect(width - 28, 10, 18, 4);
      graphics.fillStyle(0xd35400, 1);
      graphics.fillCircle(width - 19, 8, 3); // clay chimney pot

      // Gabled dormer window in attic roof
      graphics.fillStyle(shades.roof, 1);
      graphics.fillTriangle(width / 2 - 14, 38, width / 2, 20, width / 2 + 14, 38);
      graphics.fillStyle(0x8ed4f8, 0.95);
      graphics.fillRect(width / 2 - 8, 28, 16, 12);
      graphics.fillStyle(0xffffff, 0.8);
      graphics.fillRect(width / 2 - 6, 30, 4, 8); // glint
      graphics.lineStyle(1, 0x5a3e28, 1);
      graphics.strokeRect(width / 2 - 8, 28, 16, 12);

      // Covered front porch with wooden deck, posts and awning
      const porchW = 36;
      const porchH = 26;
      const porchX = width / 2 - porchW / 2;
      const porchY = height - 34;
      graphics.fillStyle(0x6b4a2f, 1); // wooden deck
      graphics.fillRect(porchX, porchY, porchW, porchH);
      graphics.fillStyle(0x4a3220, 1);
      graphics.fillRect(porchX + 2, porchY, 3, porchH); // left post
      graphics.fillRect(porchX + porchW - 5, porchY, 3, porchH); // right post
      graphics.fillStyle(shades.roof, 1); // porch roof awning
      graphics.fillRect(porchX - 4, porchY - 2, porchW + 8, 4);

      // Solid oak front door with brass handle
      graphics.fillStyle(0x4a3220, 1);
      graphics.fillRect(width / 2 - 7, porchY + 4, 14, 20);
      graphics.fillStyle(0xf1c40f, 1);
      graphics.fillCircle(width / 2 + 3, porchY + 14, 1.5); // brass knob
      // Welcome lantern
      graphics.fillStyle(0xffea78, 1);
      graphics.fillCircle(porchX + porchW - 8, porchY + 8, 2.5);

      // 2 Lower multi-pane windows with floral boxes
      const drawWindowWithFlowers = (wx: number, wy: number) => {
        // Wooden shutters
        graphics.fillStyle(0x3e2718, 1);
        graphics.fillRect(wx - 4, wy - 2, 26, 22);
        // Glass panes
        graphics.fillStyle(0x8ed4f8, 0.95);
        graphics.fillRect(wx, wy, 18, 18);
        graphics.fillStyle(0xffffff, 0.85);
        graphics.fillRect(wx + 2, wy + 2, 4, 12);
        // Window mullion cross
        graphics.fillStyle(0xffffff, 1);
        graphics.fillRect(wx + 8, wy, 2, 18);
        graphics.fillRect(wx, wy + 8, 18, 2);
        // Flower planter box
        graphics.fillStyle(0x5a3e28, 1);
        graphics.fillRect(wx - 2, wy + 18, 22, 5);
        // Blooming flowers (red & yellow geraniums)
        graphics.fillStyle(0x27ae60, 1);
        graphics.fillRect(wx, wy + 16, 18, 3);
        graphics.fillStyle(0xe74c3c, 1);
        graphics.fillCircle(wx + 3, wy + 16, 2);
        graphics.fillCircle(wx + 11, wy + 16, 2);
        graphics.fillStyle(0xf1c40f, 1);
        graphics.fillCircle(wx + 7, wy + 16, 2);
        graphics.fillCircle(wx + 15, wy + 16, 2);
      };
      drawWindowWithFlowers(18, height / 2 + 10);
      drawWindowWithFlowers(width - 36, height / 2 + 10);
      break;
    }

    // -----------------------------------------------------------------------
    // WORKSHOP: Industrial brick repair forge with clerestory sawtooth roof,
    // double steel sliding doors, outdoor workbench, tool emblem and gas tanks.
    // -----------------------------------------------------------------------
    case 'WORKSHOP': {
      // Concrete foundation plinth
      graphics.fillStyle(0x7f8c8d, 1);
      graphics.fillRoundedRect(6, 6, width - 12, height - 12, 4);

      // Industrial brick walls with Flemish brick texture
      graphics.fillStyle(0x8a4528, 1);
      graphics.fillRect(10, 10, width - 20, height - 20);
      // Brick mortar lines
      graphics.fillStyle(0x6e351e, 0.7);
      for (let by = 16; by < height - 18; by += 8) {
        graphics.fillRect(10, by, width - 20, 1);
      }

      // Main monitor roof
      graphics.fillStyle(shades.roof, 1);
      graphics.fillRect(12, 12, width - 24, height - 58);
      // Roof sheet seams
      graphics.fillStyle(0x783510, 0.8);
      for (let rx = 18; rx < width - 20; rx += 14) {
        graphics.fillRect(rx, 12, 2, height - 58);
      }

      // Raised central clerestory skylight monitor
      graphics.fillStyle(0x34495e, 1);
      graphics.fillRect(26, 24, width - 52, 34);
      // 6 Glass skylight panes
      for (let p = 0; p < 6; p += 1) {
        const px = 30 + p * Math.floor((width - 64) / 6);
        graphics.fillStyle(0x8ed4f8, 0.95);
        graphics.fillRect(px, 28, Math.floor((width - 76) / 6), 24);
        graphics.fillStyle(0xffffff, 0.85);
        graphics.fillRect(px + 2, 30, 3, 14); // glare
      }

      // 2 Roof ventilation cupolas
      graphics.fillStyle(0xd6dbe0, 1);
      graphics.fillCircle(width / 3, 16, 5);
      graphics.fillCircle((width * 2) / 3, 16, 5);
      graphics.fillStyle(0x2c3e50, 1);
      graphics.fillCircle(width / 3, 16, 2.5);
      graphics.fillCircle((width * 2) / 3, 16, 2.5);

      // Large crossed tools emblem inside brass cog medallion on pediment
      const emblemY = height / 2 + 10;
      graphics.fillStyle(0xd4ac0d, 1);
      graphics.fillCircle(width / 2, emblemY, 18);
      graphics.fillStyle(0x2c3e50, 1);
      graphics.fillCircle(width / 2, emblemY, 15);
      // Crossed wrench & hammer
      graphics.lineStyle(4, 0xdde2e8, 1);
      graphics.lineBetween(width / 2 - 10, emblemY + 10, width / 2 + 10, emblemY - 10);
      graphics.lineBetween(width / 2 - 10, emblemY - 10, width / 2 + 10, emblemY + 10);
      graphics.fillStyle(0xf1c40f, 1);
      graphics.fillCircle(width / 2, emblemY, 4);

      // Double sliding industrial metal doors
      const doorW = 56;
      const doorH = 42;
      const doorX = width / 2 - doorW / 2;
      const doorY = height - 52;
      // Overhead track
      graphics.fillStyle(0x1a242f, 1);
      graphics.fillRect(doorX - 6, doorY - 4, doorW + 12, 4);
      // Door leaves
      graphics.fillStyle(0x47535e, 1);
      graphics.fillRect(doorX, doorY, doorW, doorH);
      // Z-bracing & trim
      graphics.lineStyle(2, shades.trim, 1);
      graphics.strokeRect(doorX, doorY, doorW / 2, doorH);
      graphics.strokeRect(doorX + doorW / 2, doorY, doorW / 2, doorH);
      graphics.lineBetween(doorX, doorY, doorX + doorW / 2, doorY + doorH);
      graphics.lineBetween(doorX + doorW / 2, doorY, doorX + doorW, doorY + doorH);
      // Threshold hazard stripes
      for (let th = 0; th < doorW; th += 8) {
        graphics.fillStyle(th % 16 === 0 ? 0xf1c40f : 0x111111, 1);
        graphics.fillRect(doorX + th, doorY + doorH - 3, 8, 3);
      }

      // Outdoor steel workbench with mounted vice on the west
      graphics.fillStyle(0x34495e, 1);
      graphics.fillRect(14, height - 44, 20, 14);
      graphics.fillStyle(0x7f8c8d, 1);
      graphics.fillRect(16, height - 48, 8, 6); // bench vice

      // Welding gas cylinder tanks (Oxygen/Acetylene) on the east
      graphics.fillStyle(0x27ae60, 1); // Green Oxygen tank
      graphics.fillRoundedRect(width - 24, height - 48, 6, 20, 2);
      graphics.fillStyle(0x962d22, 1); // Red Acetylene tank
      graphics.fillRoundedRect(width - 16, height - 44, 6, 16, 2);
      break;
    }

    // -----------------------------------------------------------------------
    // WOOD_STORAGE: Open timber barn with rustic trusses, 3 tiered pyramids
    // of harvested tree logs with bark and rings, axe on stump and lumber.
    // -----------------------------------------------------------------------
    case 'WOOD_STORAGE': {
      // Dirt yard floor with sawdust and woodchip textures
      graphics.fillStyle(0x6e5238, 1);
      graphics.fillRoundedRect(6, 6, width - 12, height - 12, 4);
      graphics.fillStyle(0xd4ac0d, 0.4); // scattered wood chips
      for (let sc = 0; sc < 24; sc += 1) {
        graphics.fillRect(14 + ((sc * 37) % (width - 28)), 16 + ((sc * 43) % (height - 32)), 4, 3);
      }

      // Open timber shed roof with rafters & overhang
      graphics.fillStyle(shades.roof, 1);
      graphics.fillRect(8, 8, width - 16, 28);
      graphics.fillStyle(0x3d2817, 1);
      for (let rf = 12; rf < width - 12; rf += 16) {
        graphics.fillRect(rf, 6, 3, 32); // timber rafters
      }
      graphics.fillStyle(0x27ae60, 0.4); // moss patches on roof
      graphics.fillCircle(24, 16, 6);
      graphics.fillCircle(width - 32, 18, 8);

      // Heavy timber support posts
      const postX = [12, width / 2 - 3, width - 15];
      graphics.fillStyle(0x4a3220, 1);
      for (const px of postX) {
        graphics.fillRect(px, 12, 6, height - 24);
      }

      // 3 Organized stacks of harvested tree logs (Pyramids of timber)
      const drawLog = (lx: number, ly: number, lRadius: number) => {
        // Outer bark with crevices
        graphics.fillStyle(0x3b2616, 1);
        graphics.fillCircle(lx, ly, lRadius);
        // Sapwood ring
        graphics.fillStyle(0xd4ac0d, 1);
        graphics.fillCircle(lx, ly, lRadius - 2);
        // Heartwood core
        graphics.fillStyle(0x9e6b1f, 1);
        graphics.fillCircle(lx, ly, Math.max(2, lRadius - 4));
        // Growth rings
        graphics.fillStyle(0x6e4511, 1);
        graphics.fillCircle(lx, ly, Math.max(1, lRadius - 6));
        graphics.fillCircle(lx, ly, 1); // pith
      };

      // 3 Tiers of log stacks
      const tierY = [62, 126, 190];
      for (const ty of tierY) {
        // Steel retention stanchions
        graphics.fillStyle(0x2c3e50, 1);
        graphics.fillRect(18, ty - 18, 4, 40);
        graphics.fillRect(width - 48, ty - 18, 4, 40);

        // Bottom layer of logs
        for (let col = 0; col < 6; col += 1) {
          drawLog(30 + col * 18, ty + 8, 9);
        }
        // Top layer of logs
        for (let col = 0; col < 5; col += 1) {
          drawLog(39 + col * 18, ty - 8, 9);
        }
      }

      // Tree stump with felling axe embedded in top
      const stumpX = width - 30;
      const stumpY = height - 36;
      drawLog(stumpX, stumpY, 12);
      // Steel axe head and wooden handle
      graphics.fillStyle(0xdde2e8, 1); // steel head
      graphics.fillRect(stumpX - 4, stumpY - 4, 8, 4);
      graphics.fillStyle(0x8a5528, 1); // wooden handle
      graphics.fillRect(stumpX + 2, stumpY - 14, 3, 16);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------

/** Canvas of a worker sprite: 24 x 32 px. */
export const WORKER_SPRITE = { width: 24, height: 32 } as const;

/**
 * Worker figure with straw hat, denim overalls, tinted jacket, facial details and boots.
 */
function drawWorker(graphics: Phaser.GameObjects.Graphics, busy: boolean): void {
  const palette = PALETTE.worker;

  // Leather work boots with thick soles
  graphics.fillStyle(palette.boots, 1);
  graphics.fillRoundedRect(5, 25, 5, 7, 1);
  graphics.fillRoundedRect(14, 25, 5, 7, 1);
  graphics.fillStyle(0x111111, 1);
  graphics.fillRect(5, 30, 6, 2);
  graphics.fillRect(14, 30, 6, 2);

  // Denim overalls trousers
  graphics.fillStyle(0x294e75, 1);
  graphics.fillRect(5, 17, 14, 9);

  // Tinted worker jacket
  graphics.fillStyle(palette.jacket, 1);
  graphics.fillRoundedRect(4, 11, 16, 8, 2);

  // Overalls straps & brass buckles
  graphics.fillStyle(0x294e75, 1);
  graphics.fillRect(6, 12, 3, 6);
  graphics.fillRect(15, 12, 3, 6);
  graphics.fillStyle(0xf1c40f, 1);
  graphics.fillRect(6, 16, 3, 2);
  graphics.fillRect(15, 16, 3, 2);

  // Head and face
  graphics.fillStyle(palette.skin, 1);
  graphics.fillCircle(12, 7, 5);

  // Farmer straw hat with wide brim and dark band
  graphics.fillStyle(0xd4ac0d, 1);
  graphics.fillRect(2, 4, 20, 3); // brim
  graphics.fillRoundedRect(6, 1, 12, 4, 1); // crown
  graphics.fillStyle(0x8a6a1a, 1);
  graphics.fillRect(6, 4, 12, 1); // hatband

  // Facing east nose and eyes
  graphics.fillStyle(0x5a3e28, 1);
  graphics.fillRect(15, 6, 2, 2);

  if (busy) {
    // Steel pitchfork / tool raised in active work pose
    graphics.fillStyle(0x6b4a2f, 1); // wooden handle
    graphics.fillRect(18, 8, 3, 18);
    graphics.fillStyle(0xdde2e8, 1); // steel head
    graphics.fillRect(17, 6, 6, 3);
    graphics.fillRect(17, 3, 2, 4);
    graphics.fillRect(21, 3, 2, 4);
  }
}

// ---------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------

/**
 * Canvas of a tree, per stage. Scaled for 32px cell size.
 */
export const TREE_SPRITE_PX: Readonly<Record<TreeGrowthStage, number>> = {
  SAPLING: 24,
  YOUNG: 36,
  MATURE: 52,
  OLD_GROWTH: 64,
};

/**
 * One tree with layered spherical foliage, ambient ground shadow and textured trunk.
 */
function drawTree(
  graphics: Phaser.GameObjects.Graphics,
  stage: TreeGrowthStage,
  variant: number,
): void {
  const shades = PALETTE.tree[stage];
  const size = TREE_SPRITE_PX[stage];
  const centre = size / 2;
  const trunkWidth = Math.max(3, Math.round(size / 7));

  // Ground shadow
  graphics.fillStyle(0x000000, 0.25);
  graphics.fillEllipse(centre, size - 3, size * 0.35, size * 0.15);

  // Tree trunk with roots and bark
  graphics.fillStyle(shades.trunk, 1);
  graphics.fillRect(Math.round(centre - trunkWidth / 2), centre - 2, trunkWidth, size / 2 + 1);
  // Root flare
  graphics.fillTriangle(
    centre - trunkWidth,
    size - 2,
    centre + trunkWidth,
    size - 2,
    centre,
    centre + size / 4,
  );

  const lobes = stage === 'SAPLING' ? 4 : 6;
  const lobeRadius = size / (stage === 'SAPLING' ? 4.2 : 3.6);
  const orbit = size / 4.8;
  const phase = (variant * Math.PI) / 2;

  // Dark shadow foliage base
  graphics.fillStyle(shades.canopyDark, 1);
  for (let index = 0; index < lobes; index += 1) {
    const angle = phase + (index * 2 * Math.PI) / lobes;
    graphics.fillCircle(
      centre + Math.cos(angle) * orbit,
      centre + Math.sin(angle) * orbit * 0.7 + 1,
      lobeRadius,
    );
  }

  // Midtone main canopy
  graphics.fillStyle(shades.canopy, 1);
  for (let index = 0; index < lobes; index += 1) {
    const angle = phase + (index * 2 * Math.PI) / lobes;
    graphics.fillCircle(
      centre + Math.cos(angle) * orbit - 1,
      centre + Math.sin(angle) * orbit * 0.7 - 2,
      lobeRadius - 1,
    );
  }

  // Sunlit highlight crowns on top-left
  graphics.fillStyle(0x9bd85a, 0.7);
  graphics.fillCircle(centre - 2, centre - 4, lobeRadius * 0.7);
}

// ---------------------------------------------------------------------------
// Cursors and particles
// ---------------------------------------------------------------------------

/** A cursor covers exactly one cell (32px). */
export const CURSOR_SPRITE_PX = CELL_PX;

/** Cursor frame: double border plus corner ticks. */
function drawCursor(graphics: Phaser.GameObjects.Graphics, kind: CursorKind): void {
  const colour =
    kind === CursorKind.VALID
      ? PALETTE.ui.cursorValid
      : kind === CursorKind.INVALID
        ? PALETTE.ui.cursorInvalid
        : PALETTE.ui.cursorNeutral;
  const size = CURSOR_SPRITE_PX;

  // Translucent fill
  graphics.fillStyle(colour, 0.18);
  graphics.fillRect(0, 0, size, size);

  // Outer border
  graphics.lineStyle(2, colour, 0.95);
  graphics.strokeRect(1, 1, size - 2, size - 2);

  // Corner brackets
  graphics.fillStyle(colour, 1);
  const tick = 8;
  graphics.fillRect(0, 0, tick, 3);
  graphics.fillRect(0, 0, 3, tick);
  graphics.fillRect(size - tick, 0, tick, 3);
  graphics.fillRect(size - 3, 0, 3, tick);
  graphics.fillRect(0, size - 3, tick, 3);
  graphics.fillRect(0, size - tick, 3, tick);
  graphics.fillRect(size - tick, size - 3, tick, 3);
  graphics.fillRect(size - 3, size - tick, 3, tick);

  if (kind === CursorKind.INVALID) {
    // Thick diagonal cross
    graphics.lineStyle(3, colour, 0.9);
    graphics.lineBetween(4, 4, size - 4, size - 4);
    graphics.lineBetween(size - 4, 4, 4, size - 4);
  }
}

/** Size of a particle, per kind. */
export const PARTICLE_SPRITE_PX: Readonly<Record<ParticleKind, number>> = {
  dust: 8,
  leaf: 6,
  spark: 4,
};

/** A particle with glowing core. */
function drawParticle(graphics: Phaser.GameObjects.Graphics, kind: ParticleKind): void {
  const size = PARTICLE_SPRITE_PX[kind];
  const colour =
    kind === ParticleKind.DUST
      ? PALETTE.ui.particleDust
      : kind === ParticleKind.LEAF
        ? PALETTE.ui.particleLeaf
        : PALETTE.ui.cursorNeutral;

  if (kind === ParticleKind.LEAF) {
    graphics.fillStyle(colour, 0.9);
    graphics.fillEllipse(size / 2, size / 2, size / 2, size / 3);
    graphics.lineStyle(1, 0x3f6628, 1);
    graphics.lineBetween(1, size / 2, size - 1, size / 2);
  } else {
    graphics.fillStyle(colour, 0.85);
    graphics.fillCircle(size / 2, size / 2, size / 2);
    graphics.fillStyle(0xffffff, 1);
    graphics.fillCircle(size / 2, size / 2, Math.max(1, size / 4));
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
