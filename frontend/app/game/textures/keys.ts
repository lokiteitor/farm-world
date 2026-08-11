// Texture keys.
//
// Owner: workflow W3-D (rendering core). Every key the generated art registers in
// the Phaser texture manager is named here and nowhere else. The world layer of W4
// and the entity layer of W5 read these constants: a key written as a literal at
// the point of use is the way a renaming turns into an invisible missing texture,
// because Phaser answers a missing key with its green "__MISSING" placeholder and
// carries on.
//
// The prefix `fw-` keeps the generated art apart from anything Phaser registers on
// its own (`__DEFAULT`, `__MISSING`, `__WHITE`).

import { type BuildingType, type MachineType, type TreeGrowthStage } from '~/shared/domain/enums';

/** Prefix of every generated texture. */
export const TEXTURE_PREFIX = 'fw-';

/** The two tilesets, the grid and the two worker poses. */
export const TEXTURE_KEYS = {
  /** Terrain tileset, extruded, four variants per terrain type. */
  terrainAtlas: 'fw-terrain',
  /** Usage tileset, extruded: ownership, crop cycle, farm, forest plot, pending. */
  usageAtlas: 'fw-usage',
  /** One cell of grid, repeated by a `TileSprite` at scene level (plan section 9.3). */
  grid: 'fw-grid',
  /** Worker at rest. */
  worker: 'fw-worker',
  /** Worker executing a task, which is the state the entity layer animates. */
  workerBusy: 'fw-worker-busy',
} as const;

/** Key of the sprite of a building of the catalogue. */
export function buildingTextureKey(type: BuildingType): string {
  return `fw-building-${type.toLowerCase().replace(/_/g, '-')}`;
}

/** Key of the sprite of a machine of the catalogue. */
export function machineTextureKey(type: MachineType): string {
  return `fw-machine-${type.toLowerCase().replace(/_/g, '-')}`;
}

/**
 * Key of the sprite of a tree stage and rotation variant. The variant is part of
 * the key and not a frame, because the four variants differ in size as well as in
 * rotation and a sprite sheet would have to pad them all to the largest.
 */
export function treeTextureKey(stage: TreeGrowthStage, variant: number): string {
  return `fw-tree-${stage.toLowerCase().replace(/_/g, '-')}-${variant}`;
}

/** Cursor kinds drawn inside the canvas, one cell each. */
export const CursorKind = {
  VALID: 'valid',
  INVALID: 'invalid',
  NEUTRAL: 'neutral',
} as const;
export type CursorKind = (typeof CursorKind)[keyof typeof CursorKind];

/** Key of a cursor sprite. */
export function cursorTextureKey(kind: CursorKind): string {
  return `fw-cursor-${kind}`;
}

/** Particle kinds: dust behind machinery, leaves when felling, a spark on completion. */
export const ParticleKind = {
  DUST: 'dust',
  LEAF: 'leaf',
  SPARK: 'spark',
} as const;
export type ParticleKind = (typeof ParticleKind)[keyof typeof ParticleKind];

/** Key of a particle sprite. */
export function particleTextureKey(kind: ParticleKind): string {
  return `fw-particle-${kind}`;
}

/** Rotation variants generated per tree stage. */
export const TREE_VARIANTS = 4;
