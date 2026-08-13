<script setup lang="ts">
// Miniature of the footprint of a farm.
//
// Owner: W4-F.
//
// GDD section 23 makes the farm a physical entity that occupies real cells and not a menu,
// and the model gives the geometry to the buildings and not to the farm (ADR-0029). The
// miniature is therefore drawn from the rectangles of the buildings, in world cell
// coordinates, with one `viewBox` and no arithmetic of its own: the SVG scales the drawing
// and the component never converts cells to pixels, which is what keeps it correct at any
// panel width.
//
// The colours are the tokens of the shared palette, the same ones the canvas paints the
// buildings with, so the miniature and the world cannot disagree (plan section 9.4).
import { computed } from 'vue';
import {
  colourOfBuildingType,
  labelOfBuildingType,
} from '~/components/panels/farm-overview/buildingPresentation';
import { type BuildingDto } from '~/shared/index';

const props = defineProps<{ buildings: readonly BuildingDto[] }>();

/** One cell of margin around the drawing, so the outline of a building is not clipped. */
const MARGIN_CELLS = 1;

const box = computed(() => {
  const first = props.buildings[0];
  if (first === undefined) {
    return null;
  }
  let minX = first.originCellX;
  let minY = first.originCellY;
  let maxX = first.originCellX + first.widthCells;
  let maxY = first.originCellY + first.heightCells;
  for (const building of props.buildings) {
    minX = Math.min(minX, building.originCellX);
    minY = Math.min(minY, building.originCellY);
    maxX = Math.max(maxX, building.originCellX + building.widthCells);
    maxY = Math.max(maxY, building.originCellY + building.heightCells);
  }
  return {
    minX: minX - MARGIN_CELLS,
    minY: minY - MARGIN_CELLS,
    widthCells: maxX - minX + MARGIN_CELLS * 2,
    heightCells: maxY - minY + MARGIN_CELLS * 2,
  };
});

const viewBox = computed(() =>
  box.value === null
    ? '0 0 1 1'
    : `${box.value.minX} ${box.value.minY} ${box.value.widthCells} ${box.value.heightCells}`,
);

/** Cells the buildings of the farm occupy, which is the figure the panel states. */
const occupiedCells = computed(() =>
  props.buildings.reduce(
    (total, building) => total + building.widthCells * building.heightCells,
    0,
  ),
);
</script>

<template>
  <figure class="fw-footprint">
    <svg
      v-if="box !== null"
      class="fw-footprint__svg"
      :viewBox="viewBox"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Huella de la granja"
    >
      <rect
        v-for="building in props.buildings"
        :key="building.id"
        :x="building.originCellX"
        :y="building.originCellY"
        :width="building.widthCells"
        :height="building.heightCells"
        :fill="colourOfBuildingType(building.type)"
        stroke="var(--fw-outline-farm, #cfd4dc)"
        stroke-width="0.25"
      >
        <title>
          {{ labelOfBuildingType(building.type) }} ({{ building.originCellX }},
          {{ building.originCellY }})
        </title>
      </rect>
    </svg>
    <p v-else class="fw-footprint__empty">Sin edificios: la granja no ocupa ninguna celda.</p>
    <figcaption v-if="box !== null" class="fw-footprint__caption">
      {{ occupiedCells }} celdas ocupadas en un area de {{ box.widthCells - MARGIN_CELLS * 2 }} x
      {{ box.heightCells - MARGIN_CELLS * 2 }}
    </figcaption>
  </figure>
</template>

<style scoped>
.fw-footprint {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
}

.fw-footprint__svg {
  width: 100%;
  height: 96px;
  border: 1px solid var(--fw-border, #333a45);
  border-radius: var(--fw-radius, 4px);
  background: var(--fw-surface-sunken, #101318);
}

.fw-footprint__empty,
.fw-footprint__caption {
  margin: 0;
  color: var(--fw-text-muted, #9aa4b2);
  font-size: var(--fw-font-size-sm, 12px);
}
</style>
