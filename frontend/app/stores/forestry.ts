// Forest plots and trees.
//
// Owner: W3-C.
//
// Addition to the store list of plan section 9.6, which names sixteen slices and none of
// them forestry, while the contract has `FOREST_PLOT_UPSERTED`, `FOREST_PLOT_REMOVED` and
// `TREES_UPSERTED` and the panels of W6 need somewhere to read them from. Since this
// directory is frozen after W3, leaving the gap would force a later agent to open a
// frozen file; the alternative, folding plots into the fields store, would put two
// different entities behind one key space. Recorded in the handoff.
//
// A tree stores only when it was planted, and its stage and volume are derived from the
// clock (plan section 2.2, GDD sections 130 and 131). The reply carries the derived
// values because they are what the panel shows, and this store keeps deriving them
// locally between replies with the same shared rules, which is what lets a tree mature on
// screen with no traffic at all.

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import {
  TreeStatus,
  batchWoodVolume,
  fromWireGameMs,
  isFellable,
  nextStageBoundaryGameMs,
  treeStageAt,
  type BatchWoodVolume,
  type ForestPlotDto,
  type GameMs,
  type TreeDto,
  type TreeGrowthStage,
  type TreeView,
} from '~/shared/index';
import { createCollection } from '~/stores/collection';

/** A tree with the values that are derived rather than stored, at one instant. */
export interface DerivedTree {
  readonly tree: TreeDto;
  readonly growthStage: TreeGrowthStage;
  readonly fellable: boolean;
  readonly nextStageAtGameMs: GameMs | null;
}

export const useForestryStore = defineStore('forestry', () => {
  const collection = createCollection<ForestPlotDto>();
  /** Trees of each plot, paginated on the wire and merged here by identifier. */
  const treesByPlotId = ref<Record<string, Record<string, TreeDto>>>({});

  const totalCellCount = computed(() =>
    collection.all.value.reduce((total, plot) => total + plot.cellCount, 0),
  );

  const totalFellableTrees = computed(() =>
    collection.all.value.reduce((total, plot) => total + plot.fellableTreeCount, 0),
  );

  function ofFarm(farmId: string): readonly ForestPlotDto[] {
    return collection.all.value.filter((plot) => plot.farmId === farmId);
  }

  function treesOf(forestPlotId: string): readonly TreeDto[] {
    const trees = treesByPlotId.value[forestPlotId];
    return trees === undefined ? [] : Object.values(trees);
  }

  function standingTreesOf(forestPlotId: string): readonly TreeDto[] {
    return treesOf(forestPlotId).filter((tree) => tree.status === TreeStatus.STANDING);
  }

  /** The row as the shared forestry rules want it (`TreeView`). */
  function asTreeView(tree: TreeDto): TreeView {
    return {
      species: tree.species,
      plantedAtGameMs: fromWireGameMs(tree.plantedAtGameMs),
      status: tree.status,
    };
  }

  /** The derived state of one tree at an instant, with the shared rules. */
  function derive(tree: TreeDto, atGameMs: GameMs): DerivedTree {
    const view = asTreeView(tree);
    return {
      tree,
      growthStage: treeStageAt(view, atGameMs),
      fellable: isFellable(view, atGameMs),
      nextStageAtGameMs: nextStageBoundaryGameMs(view, atGameMs),
    };
  }

  /**
   * Volume and value of the standing, fellable trees of a plot at an instant (GDD
   * sections 131, 133 and 135). It is what a felling would produce now, which is the
   * figure the assignment panel needs before it can warn about the wood store.
   */
  function fellableVolumeAt(forestPlotId: string, atGameMs: GameMs): BatchWoodVolume {
    return batchWoodVolume(standingTreesOf(forestPlotId).map(asTreeView), atGameMs);
  }

  function applyTrees(
    forestPlotId: string,
    upserted: readonly TreeDto[],
    removedTreeIds: readonly string[],
  ): void {
    const existing = treesByPlotId.value[forestPlotId] ?? {};
    const next: Record<string, TreeDto> = { ...existing };
    for (const tree of upserted) {
      next[tree.id] = tree;
    }
    for (const treeId of removedTreeIds) {
      delete next[treeId];
    }
    treesByPlotId.value[forestPlotId] = next;
  }

  function replacePlotTrees(forestPlotId: string, trees: readonly TreeDto[]): void {
    const next: Record<string, TreeDto> = {};
    for (const tree of trees) {
      next[tree.id] = tree;
    }
    treesByPlotId.value[forestPlotId] = next;
  }

  function removeWithTrees(forestPlotId: string): void {
    collection.remove(forestPlotId);
    delete treesByPlotId.value[forestPlotId];
  }

  function reset(): void {
    collection.clear();
    treesByPlotId.value = {};
  }

  return {
    byId: collection.byId,
    all: collection.all,
    count: collection.count,
    get: collection.get,
    upsert: collection.upsert,
    upsertMany: collection.upsertMany,
    replaceAll: collection.replaceAll,
    treesByPlotId,
    totalCellCount,
    totalFellableTrees,
    ofFarm,
    treesOf,
    standingTreesOf,
    asTreeView,
    derive,
    fellableVolumeAt,
    applyTrees,
    replacePlotTrees,
    remove: removeWithTrees,
    reset,
  };
});
