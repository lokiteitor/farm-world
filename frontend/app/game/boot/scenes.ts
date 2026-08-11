// Scene keys.
//
// Owner: workflow W3-D (rendering core). The four scenes of plan section 9.2 are
// named here so that a later workflow starting or stopping a scene never writes a
// string literal: Phaser answers an unknown scene key by doing nothing at all, which
// is the hardest kind of mistake to see.
//
// `WORLD` and `OVERLAY` are declared in this phase and implemented in the next ones,
// W4 and W5. That is rule 3 of plan section 11 applied to scenes: whoever writes a
// registry also writes what it refers to, with its final name, so the registry is
// never edited again.

/** Keys of the four scenes of plan section 9.2. */
export const SCENE_KEYS = {
  /** Renderer and camera configuration. Runs once and hands over to `PRELOAD`. */
  BOOT: 'boot',
  /** Generates every texture by code and reports progress. Makes no loader call. */
  PRELOAD: 'preload',
  /** Camera, chunk streaming, terrain and usage layers, outlines, entities. W4. */
  WORLD: 'world',
  /** Labels and progress bars, on a camera that does not scroll. W5. */
  OVERLAY: 'overlay',
} as const;
export type SceneKey = (typeof SCENE_KEYS)[keyof typeof SCENE_KEYS];
