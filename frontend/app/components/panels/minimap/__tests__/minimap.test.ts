// The minimap: its geometry and its two gestures.
//
// Owner: W4-E.
//
// The arithmetic is asserted on `compose.ts`, which is pure, because a click that lands on the
// wrong cell is the kind of defect a screenshot never shows. What is asserted on the component
// is that it reads the camera from the bridge and answers with `camera:goto`, and that it says
// how much of the window the client actually holds -- an empty area of the minimap is the edge
// of the streamed region and not an empty world.

import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootMockClient,
  loadChunksFor,
  settle,
  teardownMockClient,
} from '~/components/panels/cell-inspector/__tests__/harness';
import {
  MINIMAP_CHUNKS_ACROSS,
  cellOfPoint,
  chunkOffset,
  minimapWindow,
  viewportRect,
  windowChunks,
  windowContains,
} from '~/components/panels/minimap/compose';
import MinimapPanel from '~/components/panels/minimap/MinimapPanel.vue';
import { gameBridge } from '~/composables/useGameBridge';
import { CHUNK_SIZE } from '~/shared/index';
import { useWorldStore } from '~/stores/world';

describe('la geometria del minimapa', () => {
  it('centra una ventana impar de chunks sobre la celda de la camara', () => {
    const view = minimapWindow(100, 100, CHUNK_SIZE, 7);
    expect(view.chunksAcross).toBe(7);
    expect(view.sideCells).toBe(7 * CHUNK_SIZE);
    // The camera chunk is the middle one: three chunks on each side.
    expect(view.fromChunkX).toBe(Math.floor(100 / CHUNK_SIZE) - 3);
    expect(windowChunks(view)).toHaveLength(49);
    expect(windowContains(view, 100, 100)).toBe(true);
  });

  it('coloca un chunk al oeste del origen sin salirse del buffer', () => {
    // Negative chunk coordinates are the case a remainder operator gets wrong: `%` of a
    // negative number is negative in JavaScript, which would write outside the buffer.
    const view = minimapWindow(-100, -100, CHUNK_SIZE, 7);
    for (const chunk of windowChunks(view)) {
      const offset = chunkOffset(view, chunk.chunkX, chunk.chunkY);
      expect(offset.x).toBeGreaterThanOrEqual(0);
      expect(offset.y).toBeGreaterThanOrEqual(0);
      expect(offset.x + CHUNK_SIZE).toBeLessThanOrEqual(view.sideCells);
      expect(offset.y + CHUNK_SIZE).toBeLessThanOrEqual(view.sideCells);
    }
  });

  it('el punto central del cuadro es la celda central de la ventana', () => {
    const view = minimapWindow(100, 100, CHUNK_SIZE, 7);
    const side = 168;
    const cell = cellOfPoint(view, side / 2, side / 2, side);
    expect(cell.cellX).toBe(view.originCellX + view.sideCells / 2);
    expect(cell.cellY).toBe(view.originCellY + view.sideCells / 2);
  });

  it('recorta el rectangulo del visor a la ventana en lugar de ocultarlo', () => {
    const view = minimapWindow(0, 0, CHUNK_SIZE, 7);
    const rect = viewportRect(
      view,
      { minCellX: -10_000, minCellY: -10_000, maxCellX: 10_000, maxCellY: 10_000 },
      168,
    );
    expect(rect).toEqual({ x: 0, y: 0, width: 168, height: 168 });
  });

  it('el rectangulo del visor nunca es de ancho cero', () => {
    const view = minimapWindow(0, 0, CHUNK_SIZE, 7);
    const rect = viewportRect(
      view,
      { minCellX: 9_000, minCellY: 9_000, maxCellX: 9_001, maxCellY: 9_001 },
      168,
    );
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
  });
});

describe('el panel de minimapa', () => {
  beforeEach(async () => {
    await bootMockClient();
  });

  afterEach(() => {
    teardownMockClient();
  });

  it('dice cuantos chunks de la ventana tiene el cliente', async () => {
    const world = useWorldStore();
    const spawn = world.spawnCell;
    expect(spawn).not.toBeNull();
    const wrapper = mount(MinimapPanel);
    await settle();
    expect(wrapper.text()).toContain(`0 de ${MINIMAP_CHUNKS_ACROSS * MINIMAP_CHUNKS_ACROSS}`);

    await loadChunksFor([spawn ?? { cellX: 0, cellY: 0 }]);
    await settle();
    expect(wrapper.text()).toContain(`1 de ${MINIMAP_CHUNKS_ACROSS * MINIMAP_CHUNKS_ACROSS}`);
    wrapper.unmount();
  });

  it('sigue a la camara que publica el puente', async () => {
    const wrapper = mount(MinimapPanel);
    await settle();
    gameBridge().emit('camera:changed', {
      centreCellX: 512,
      centreCellY: 640,
      zoom: 1,
      minCellX: 500,
      minCellY: 630,
      maxCellX: 524,
      maxCellY: 650,
    });
    await settle();
    expect(wrapper.text()).toContain('Celda 512, 640');
    expect(wrapper.find('.fw-minimap__viewport').exists()).toBe(true);
    wrapper.unmount();
  });

  it('un clic publica la orden de camara de la celda pulsada', async () => {
    const orders: { cellX: number; cellY: number }[] = [];
    gameBridge().on('camera:goto', (payload) => orders.push(payload));
    gameBridge().emit('camera:changed', {
      centreCellX: 512,
      centreCellY: 640,
      zoom: 1,
      minCellX: 500,
      minCellY: 630,
      maxCellX: 524,
      maxCellY: 650,
    });

    const wrapper = mount(MinimapPanel);
    await settle();
    await wrapper.find('canvas').trigger('click', { clientX: 84, clientY: 84 });

    const view = minimapWindow(512, 640, CHUNK_SIZE, MINIMAP_CHUNKS_ACROSS);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toEqual({ ...cellOfPoint(view, 84, 84, 168), smooth: true });
    wrapper.unmount();
  });

  it('a la granja lleva la camara a la celda de origen', async () => {
    const world = useWorldStore();
    const orders: unknown[] = [];
    gameBridge().on('camera:goto', (payload) => orders.push(payload));

    const wrapper = mount(MinimapPanel);
    await settle();
    const button = wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'A la granja');
    await button?.trigger('click');

    expect(orders).toEqual([
      { cellX: world.spawnCell?.cellX, cellY: world.spawnCell?.cellY, smooth: true },
    ]);
    wrapper.unmount();
  });
});
