<script setup lang="ts">
// The minimap: the neighbourhood of the camera, composed from the chunk thumbnails.
//
// Owner: W4-E. Surface: overlay, anchored over the canvas without taking input from it.
//
// It has no data path of its own. Every pixel it draws is `chunkThumbnailPixels` of
// `game/world/thumbnail.ts` over the same decoded chunk cache the renderer streams into,
// which is exactly what plan section 9.3 asks for: "la misma miniatura alimenta el minimapa,
// sin un segundo camino de datos". One pixel per cell, so a chunk is 32 by 32 and the whole
// window of seven by seven chunks is one 224 pixel `ImageData` written once per repaint and
// blown up with nearest filtering.
//
// What it adds over the thumbnail is the two things a minimap is for: the rectangle of what
// the camera is looking at, and a click that moves the camera there. Both travel over the
// bridge (`camera:changed` in, `camera:goto` out), so the panel never reaches into a scene
// and works unchanged whether the canvas is mounted or not.
//
// A chunk that is not in the cache is left as the void colour rather than generated on the
// spot. Generating it would be cheap and wrong: the minimap would then show ownership and
// crops for the streamed chunks and bare terrain for the rest, with no way to tell which is
// which, and the empty area is itself information -- it is the edge of what the client
// holds.
import { computed, onMounted, ref, watch } from 'vue';
import {
  MINIMAP_CHUNKS_ACROSS,
  cellOfPoint,
  chunkOffset,
  minimapWindow,
  viewportRect,
  windowChunks,
} from '~/components/panels/minimap/compose';
import UiButton from '~/components/ui/UiButton.vue';
import UiCard from '~/components/ui/UiCard.vue';
import { useGameBridge, type CameraView } from '~/composables/useGameBridge';
import { PALETTE, toCssHex } from '~/game/textures/palette';
import { chunkThumbnailPixels } from '~/game/world/thumbnail';
import { bp } from '~/shared/index';
import { useFieldsStore } from '~/stores/fields';
import { usePendingStore } from '~/stores/pending';
import { usePlayerStore } from '~/stores/player';
import { useWorldStore } from '~/stores/world';

/** Side of the minimap in CSS pixels. */
const SIDE_PX = 168;

const world = useWorldStore();
const player = usePlayerStore();
const fields = useFieldsStore();
const pending = usePendingStore();
const bridge = useGameBridge();

const canvas = ref<HTMLCanvasElement | null>(null);
/** True once the host turned out to have no 2D context, so the repaint stops asking. */
let unpaintable = false;
const camera = ref<CameraView | null>(bridge.latest('camera:changed') ?? null);

bridge.on('camera:changed', (payload) => {
  camera.value = payload;
});

/** Centre of the window: the camera when there is one, the spawn cell before that. */
const centre = computed(() => {
  const view = camera.value;
  if (view !== null) {
    return { cellX: view.centreCellX, cellY: view.centreCellY };
  }
  return world.spawnCell ?? { cellX: 0, cellY: 0 };
});

const view = computed(() =>
  minimapWindow(centre.value.cellX, centre.value.cellY, world.chunkSize, MINIMAP_CHUNKS_ACROSS),
);

const loadedInWindow = computed(() => {
  void world.revision;
  return windowChunks(view.value).filter(
    (chunk) => world.getChunk(chunk.chunkX, chunk.chunkY) !== undefined,
  ).length;
});

const rect = computed(() =>
  camera.value === null ? null : viewportRect(view.value, camera.value, SIDE_PX),
);

/**
 * Repaints the whole window.
 *
 * One `ImageData` for the seven by seven chunks and one `putImageData`, rather than a draw
 * per chunk: at one pixel per cell the whole window is 224 by 224, that is under 200 kB, and
 * a single write is both simpler and cheaper than forty nine texture uploads.
 */
function repaint(): void {
  const element = canvas.value;
  if (element === null || unpaintable) {
    return;
  }
  const context = element.getContext('2d');
  if (context === null) {
    // Asked once and remembered: a host with no 2D context is not going to grow one, and the
    // repaint runs on every chunk that lands.
    unpaintable = true;
    return;
  }
  const current = view.value;
  const side = current.sideCells;
  if (element.width !== side || element.height !== side) {
    element.width = side;
    element.height = side;
  }
  const image = context.createImageData(side, side);
  fillVoid(image.data);

  const thumbnailContext = {
    viewerPlayerId: player.id,
    fieldState: (fieldId: string) => {
      const field = fields.get(fieldId);
      return field === undefined
        ? undefined
        : {
            cropCycleState: field.projection.cropCycleState,
            growthProgressBp: bp(field.projection.growthProgressBp),
          };
    },
    pending: pending.pendingCellKeys,
  };

  for (const coord of windowChunks(current)) {
    const chunk = world.getChunk(coord.chunkX, coord.chunkY);
    if (chunk === undefined) {
      continue;
    }
    const pixels = chunkThumbnailPixels(chunk, current.chunkSize, thumbnailContext);
    const offset = chunkOffset(current, coord.chunkX, coord.chunkY);
    blit(image.data, side, pixels, current.chunkSize, offset.x, offset.y);
  }
  context.putImageData(image, 0, 0);
}

/** The colour of a chunk the client does not hold. Same one the canvas paints behind. */
function fillVoid(data: Uint8ClampedArray): void {
  const colour = PALETTE.ui.canvasVoid;
  for (let index = 0; index < data.length; index += 4) {
    data[index] = (colour >>> 16) & 0xff;
    data[index + 1] = (colour >>> 8) & 0xff;
    data[index + 2] = colour & 0xff;
    data[index + 3] = 255;
  }
}

/** Copies one chunk thumbnail into the window buffer, row by row. */
function blit(
  target: Uint8ClampedArray,
  targetSide: number,
  source: Uint8ClampedArray,
  sourceSide: number,
  atX: number,
  atY: number,
): void {
  for (let row = 0; row < sourceSide; row += 1) {
    const from = row * sourceSide * 4;
    const to = ((atY + row) * targetSide + atX) * 4;
    target.set(source.subarray(from, from + sourceSide * 4), to);
  }
}

onMounted(repaint);
watch([() => world.revision, view, () => player.id], repaint);

function goTo(event: MouseEvent): void {
  const element = canvas.value;
  if (element === null) {
    return;
  }
  const bounds = element.getBoundingClientRect();
  // The declared side when the element has not been laid out. A measured width of zero would
  // turn the scale into infinity and the target cell into `NaN`, which is a camera order the
  // scene cannot honour and a bug that only appears on the first click after a mount.
  const sidePx = bounds.width > 0 ? bounds.width : SIDE_PX;
  const cell = cellOfPoint(
    view.value,
    event.clientX - bounds.left,
    event.clientY - bounds.top,
    sidePx,
  );
  bridge.emit('camera:goto', { cellX: cell.cellX, cellY: cell.cellY, smooth: true });
}

function goHome(): void {
  const spawn = world.spawnCell;
  if (spawn !== null) {
    bridge.emit('camera:goto', { cellX: spawn.cellX, cellY: spawn.cellY, smooth: true });
  }
}
</script>

<template>
  <UiCard title="Minimapa" class="fw-minimap">
    <template #header>
      <UiButton size="sm" variant="ghost" :disabled="world.spawnCell === null" @click="goHome">
        A la granja
      </UiButton>
    </template>

    <div class="fw-minimap__frame" :style="{ width: `${SIDE_PX}px`, height: `${SIDE_PX}px` }">
      <canvas
        ref="canvas"
        class="fw-minimap__canvas"
        :aria-label="`Minimapa centrado en la celda ${centre.cellX}, ${centre.cellY}`"
        @click="goTo"
      />
      <div
        v-if="rect !== null"
        class="fw-minimap__viewport"
        :style="{
          left: `${rect.x}px`,
          top: `${rect.y}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          borderColor: toCssHex(PALETTE.ui.outlineFarm),
        }"
      />
    </div>

    <p class="fw-small fw-muted">
      Celda {{ centre.cellX }}, {{ centre.cellY }} · {{ loadedInWindow }} de
      {{ MINIMAP_CHUNKS_ACROSS * MINIMAP_CHUNKS_ACROSS }} chunks cargados
    </p>
  </UiCard>
</template>

<style scoped>
.fw-minimap {
  width: max-content;
}

.fw-minimap__frame {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--fw-border-strong, #48525f);
  border-radius: var(--fw-radius, 4px);
  background: var(--fw-canvas-void, #101317);
}

.fw-minimap__canvas {
  display: block;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
  cursor: crosshair;
}

.fw-minimap__viewport {
  position: absolute;
  border: 1px solid;
  pointer-events: none;
}
</style>
