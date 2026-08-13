// Depth ordering of the entity layer.
//
// Owner: workflow W5-D (canvas entities). Pure, so the order the player sees is asserted
// by a test rather than by looking at a screenshot of a tractor behind a silo.
//
// A top down view has no z axis, so what stands in for it is the y coordinate: whatever
// is further south is nearer the camera and draws last. That is the whole rule, and the
// two refinements below exist for cases the rule alone leaves undecided.
//
// The tie break by kind. Two entities on the same row still have to be ordered, and the
// order has to be the same on every frame or the pair flickers. The rank of the kind
// (`ENTITY_KIND_RANK`) decides it: ground furniture first, then canopies, then the
// machines and workers the player is looking for.
//
// The stability. A sort that is not stable reorders equal keys according to whatever the
// engine felt like, and two entities of the same kind on the same row are exactly that
// case. `orderByDepth` decorates with the arrival index and sorts on it as the last key,
// so the order of equals is the order they were added in and is reproducible.
//
// Why the key is a single number and not a comparator handed to the engine. The layer is
// a `Phaser.GameObjects.Layer`, whose children are sorted by their `depth` property with
// a stable sort. Publishing one number per sprite lets the engine do the sorting while
// this module keeps the definition of the order, which is the part worth testing.

import { DEPTH_KIND_STEP, ENTITY_KIND_RANK, type EntityKind } from './config';

/** Anything the layer can sort: where it is and what it is. */
export interface DepthSubject {
  readonly kind: EntityKind;
  /** World y of the anchor of the sprite, in pixels. */
  readonly worldY: number;
}

/**
 * The depth of a subject.
 *
 * The kind contributes a sixteenth of a pixel, so it can never reorder two entities that
 * are genuinely at different depths and always orders two that are at the same one.
 */
export function depthKeyOf(subject: DepthSubject): number {
  return subject.worldY + ENTITY_KIND_RANK[subject.kind] * DEPTH_KIND_STEP;
}

/**
 * A stable ordering by depth key.
 *
 * Implemented with an explicit arrival index rather than by relying on the sort of the
 * platform. `Array.prototype.sort` has been stable since ES2019 and this would work
 * without the decoration, but the property is load bearing here and a test that asserts
 * it should be asserting this module and not the engine of the day.
 */
export function orderByDepth<T>(items: readonly T[], keyOf: (item: T) => number): readonly T[] {
  return items
    .map((item, index) => ({ item, index, key: keyOf(item) }))
    .sort((a, b) => a.key - b.key || a.index - b.index)
    .map((entry) => entry.item);
}
