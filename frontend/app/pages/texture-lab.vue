<script setup lang="ts">
// Inspection route of the generated art. Development only.
//
// Owner: workflow W3-D (rendering core). There is no graphic asset in the project:
// every texture is written by code at boot (plan section 9.4). That makes the art
// reviewable only by running it, so this route runs it and shows the result: every
// atlas and every sprite in a labelled grid at several zooms, the extrusion checked
// against the pixels of the uploaded texture, the timing of each generation step
// against its budget, and any console incident during the boot.
//
// It is also the verification surface of this phase. The report block of the first
// section is plain text on purpose, so it can be read from a headless browser and
// pasted into a handoff note without a screenshot.
//
// It touches no store and no network: it drives the same `createGame` the viewport
// uses, with no world scene registered, which is exactly the case `PreloadScene`
// handles by stopping after it publishes its report.
import type Phaser from 'phaser';
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import {
  createGame,
  SCENE_KEYS,
  type GameHandle,
  type TextureGenerationReport,
  type TextureProgress,
} from '~/game/index';
import { GRID_TILE_PX } from '~/game/textures/grid';
import { TEXTURE_KEYS } from '~/game/textures/keys';
import { paletteCssBlock, paletteCssVariables } from '~/game/textures/palette';
import { atlasSize, tileOrigin, type TilesetGeometry } from '~/game/textures/pixels';
import { SPRITE_CATALOGUE, SpriteGroup } from '~/game/textures/shapes';
import {
  TERRAIN_ATLAS_GEOMETRY,
  TERRAIN_TILE_COUNT,
  TERRAIN_TILE_PX,
  TERRAIN_VARIANTS,
  terrainTileFromIndex,
} from '~/game/textures/terrain-atlas';
import {
  USAGE_ATLAS_GEOMETRY,
  USAGE_TILE_COUNT,
  usageTileFromIndex,
  usageTileIndexForCropState,
} from '~/game/textures/usage-atlas';
import { CROP_CYCLE_STATES, type CropCycleState } from '~/shared/domain/enums';

interface TileCard {
  readonly index: number;
  readonly label: string;
  readonly source: string;
}

interface SpriteCard {
  readonly key: string;
  readonly label: string;
  readonly group: string;
  readonly width: number;
  readonly height: number;
  readonly source: string;
}

interface AtlasCard {
  readonly key: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly tilePx: number;
  readonly source: string;
  readonly tiles: readonly TileCard[];
  readonly extrusionChecked: number;
  readonly extrusionFailures: readonly string[];
}

interface CropCard {
  readonly state: CropCycleState;
  readonly index: number;
  readonly source: string;
}

const host = ref<HTMLDivElement | null>(null);
const handle = shallowRef<GameHandle | null>(null);

const phase = ref<string>('IDLE');
const progress = ref<TextureProgress | null>(null);
const report = ref<TextureGenerationReport | null>(null);
const incidents = ref<string[]>([]);
const atlases = ref<AtlasCard[]>([]);
const cropCards = ref<CropCard[]>([]);
const gridSource = ref<string>('');
const sprites = ref<SpriteCard[]>([]);
const summary = ref<string>('generando');

const spriteGroups: readonly { readonly group: string; readonly label: string }[] = [
  { group: SpriteGroup.BUILDING, label: 'Edificios' },
  { group: SpriteGroup.MACHINE, label: 'Maquinaria' },
  { group: SpriteGroup.WORKER, label: 'Trabajadores' },
  { group: SpriteGroup.TREE, label: 'Arboles' },
  { group: SpriteGroup.CURSOR, label: 'Cursores' },
  { group: SpriteGroup.PARTICLE, label: 'Particulas' },
];

const paletteEntries = Object.entries(paletteCssVariables());
const cssBlock = paletteCssBlock();

/** Zooms every sprite is shown at. Nearest neighbour, so 1x is the authored art. */
const spriteZooms: readonly number[] = [1, 2, 4];

/** The atlases are shown larger: the extrusion border is one pixel wide. */
const atlasZooms: readonly number[] = [4, 8];

function spritesOf(group: string): readonly SpriteCard[] {
  return sprites.value.filter((sprite) => sprite.group === group);
}

/** A canvas as a data URL, which is what lets the same image be shown at several zooms. */
function toSource(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png');
}

/** Copies a region of a texture source into a fresh canvas. */
function cutOut(
  source: CanvasImageSource,
  x: number,
  y: number,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context !== null) {
    context.imageSmoothingEnabled = false;
    context.drawImage(source, x, y, width, height, 0, 0, width, height);
  }
  return canvas;
}

/** The image behind a texture key, or null when the key was never registered. */
function sourceImageOf(game: Phaser.Game, key: string): CanvasImageSource | null {
  if (!game.textures.exists(key)) {
    return null;
  }
  const image = game.textures.get(key).getSourceImage();
  if (image instanceof HTMLCanvasElement || image instanceof HTMLImageElement) {
    return image;
  }
  return null;
}

/**
 * Checks the extrusion on the pixels of the texture that was actually uploaded, and
 * not on the buffer the writer produced.
 *
 * The unit tests already assert the buffer, so what is verified here is the rest of
 * the chain: that the upload did not shift the image, that the geometry the frames
 * were registered with matches the one the writer used, and that no later step
 * overwrote a border. It is the only part of the pipeline a test in Node cannot reach.
 */
function checkExtrusion(
  source: CanvasImageSource,
  geometry: TilesetGeometry,
  tileCount: number,
): { readonly checked: number; readonly failures: readonly string[] } {
  const size = atlasSize(geometry);
  const context = cutOut(source, 0, 0, size.width, size.height).getContext('2d');
  if (context === null) {
    return { checked: 0, failures: ['sin contexto 2D para leer los pixeles'] };
  }
  const pixels = context.getImageData(0, 0, size.width, size.height);
  const at = (x: number, y: number): string => {
    const offset = (y * size.width + x) * 4;
    return [
      pixels.data[offset],
      pixels.data[offset + 1],
      pixels.data[offset + 2],
      pixels.data[offset + 3],
    ].join(',');
  };

  const failures: string[] = [];
  const last = geometry.tilePx - 1;
  for (let index = 0; index < tileCount; index += 1) {
    const origin = tileOrigin(geometry, index);
    for (let step = 0; step < geometry.tilePx; step += 1) {
      const sides: readonly (readonly [string, string, string])[] = [
        ['norte', at(origin.x + step, origin.y - 1), at(origin.x + step, origin.y)],
        ['sur', at(origin.x + step, origin.y + last + 1), at(origin.x + step, origin.y + last)],
        ['oeste', at(origin.x - 1, origin.y + step), at(origin.x, origin.y + step)],
        ['este', at(origin.x + last + 1, origin.y + step), at(origin.x + last, origin.y + step)],
      ];
      for (const [side, border, edge] of sides) {
        if (border !== edge) {
          failures.push(`tesela ${index}, borde ${side}, paso ${step}: ${border} frente a ${edge}`);
        }
      }
    }
  }
  return { checked: tileCount, failures: failures.slice(0, 12) };
}

/** Builds the card of an atlas: the whole image, its tiles, and the extrusion check. */
function buildAtlasCard(
  game: Phaser.Game,
  key: string,
  label: string,
  geometry: TilesetGeometry,
  tileCount: number,
  labelOf: (index: number) => string,
): AtlasCard | null {
  const source = sourceImageOf(game, key);
  if (source === null) {
    incidents.value = [...incidents.value, `atlas ausente: ${key}`];
    return null;
  }
  const size = atlasSize(geometry);
  const tiles: TileCard[] = [];
  for (let index = 0; index < tileCount; index += 1) {
    const origin = tileOrigin(geometry, index);
    tiles.push({
      index,
      label: labelOf(index),
      source: toSource(cutOut(source, origin.x, origin.y, geometry.tilePx, geometry.tilePx)),
    });
  }
  const extrusion = checkExtrusion(source, geometry, tileCount);
  return {
    key,
    label,
    width: size.width,
    height: size.height,
    tilePx: geometry.tilePx,
    source: toSource(cutOut(source, 0, 0, size.width, size.height)),
    tiles,
    extrusionChecked: extrusion.checked,
    extrusionFailures: extrusion.failures,
  };
}

/** Reads every generated texture out of the manager and turns it into cards. */
function collect(game: Phaser.Game): void {
  const cards: AtlasCard[] = [];

  const terrain = buildAtlasCard(
    game,
    TEXTURE_KEYS.terrainAtlas,
    'Atlas de terreno',
    TERRAIN_ATLAS_GEOMETRY,
    TERRAIN_TILE_COUNT,
    (index) => {
      const tile = terrainTileFromIndex(index);
      return `${index} · ${tile.terrain} v${tile.variant}`;
    },
  );
  if (terrain !== null) {
    cards.push(terrain);
  }

  const usage = buildAtlasCard(
    game,
    TEXTURE_KEYS.usageAtlas,
    'Atlas de uso del suelo',
    USAGE_ATLAS_GEOMETRY,
    USAGE_TILE_COUNT,
    (index) => `${index} · ${usageTileFromIndex(index)}`,
  );
  if (usage !== null) {
    cards.push(usage);
    cropCards.value = CROP_CYCLE_STATES.map((state) => {
      const index = usageTileIndexForCropState(state);
      return { state, index, source: usage.tiles[index]?.source ?? '' };
    });
  }
  atlases.value = cards;

  const grid = sourceImageOf(game, TEXTURE_KEYS.grid);
  gridSource.value = grid === null ? '' : toSource(cutOut(grid, 0, 0, GRID_TILE_PX, GRID_TILE_PX));

  sprites.value = SPRITE_CATALOGUE.flatMap((sprite) => {
    const source = sourceImageOf(game, sprite.key);
    if (source === null) {
      incidents.value = [...incidents.value, `textura ausente: ${sprite.key}`];
      return [];
    }
    return [
      {
        key: sprite.key,
        label: sprite.label,
        group: sprite.group,
        width: sprite.width,
        height: sprite.height,
        source: toSource(cutOut(source, 0, 0, sprite.width, sprite.height)),
      },
    ];
  });
}

/** Machine readable summary, so the route can be verified without a screenshot. */
function buildSummary(): string {
  const current = report.value;
  if (current === null) {
    return 'generando';
  }
  const extrusionTiles = atlases.value.reduce((total, atlas) => total + atlas.extrusionChecked, 0);
  const extrusionFailures = atlases.value.reduce(
    (total, atlas) => total + atlas.extrusionFailures.length,
    0,
  );
  return [
    `fase=${phase.value}`,
    `atlas=${atlases.value.length}`,
    `sprites=${sprites.value.length}`,
    `rejilla=${gridSource.value === '' ? 'no' : 'si'}`,
    `generacion_ms=${current.generationMs.toFixed(1)}`,
    `reloj_ms=${current.wallMs.toFixed(1)}`,
    `presupuesto_ms=${current.budgetMs}`,
    `dentro_de_presupuesto=${current.withinBudget ? 'si' : 'no'}`,
    `fallos_de_paso=${current.failures.length}`,
    `incidencias_de_consola=${incidents.value.length}`,
    `extrusion_teselas=${extrusionTiles}`,
    `extrusion_fallos=${extrusionFailures}`,
    ...current.steps.map(
      (step) => `paso ${step.key}=${step.durationMs.toFixed(1)}ms/${step.textures}tex`,
    ),
    ...current.failures.map((failure) => `fallo ${failure.key}=${failure.message}`),
    ...incidents.value.map((incident) => `incidencia ${incident}`),
  ].join('\n');
}

let restoreConsole: (() => void) | null = null;

onMounted(() => {
  const element = host.value;
  if (element === null) {
    return;
  }

  // Console capture. The route exists to confirm that generating the art produces no
  // console output, so the output is collected instead of being left for whoever
  // happens to have the developer tools open.
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = (...args: unknown[]): void => {
    incidents.value = [...incidents.value, `warn: ${args.map(String).join(' ')}`];
    originalWarn(...args);
  };
  console.error = (...args: unknown[]): void => {
    incidents.value = [...incidents.value, `error: ${args.map(String).join(' ')}`];
    originalError(...args);
  };
  const onWindowError = (event: ErrorEvent): void => {
    incidents.value = [...incidents.value, `excepcion: ${event.message}`];
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    incidents.value = [...incidents.value, `promesa rechazada: ${String(event.reason)}`];
  };
  window.addEventListener('error', onWindowError);
  window.addEventListener('unhandledrejection', onRejection);
  restoreConsole = (): void => {
    console.warn = originalWarn;
    console.error = originalError;
    window.removeEventListener('error', onWindowError);
    window.removeEventListener('unhandledrejection', onRejection);
  };

  const created = createGame({
    host: element,
    // No world scene: the preload scene stops once the report is published, which is
    // exactly what this route wants.
    startSceneKey: SCENE_KEYS.PRELOAD,
  });
  handle.value = created;

  created.bridge.on('phase', (next) => {
    phase.value = next;
  });
  created.bridge.on('progress', (next) => {
    progress.value = next;
  });
  created.bridge.on('ready', (next) => {
    report.value = next;
    collect(created.game);
    summary.value = buildSummary();
  });
  created.bridge.on('failed', (failure) => {
    incidents.value = [...incidents.value, `generacion fallida: ${failure.reason}`];
    summary.value = `fase=FAILED\nmotivo=${failure.reason}`;
  });
});

onBeforeUnmount(() => {
  handle.value?.destroy();
  handle.value = null;
  restoreConsole?.();
  restoreConsole = null;
});
</script>

<template>
  <main class="lab">
    <header>
      <h1>Laboratorio de texturas</h1>
      <p class="lab__lead">
        Ruta de desarrollo. Genera todo el arte del juego por codigo, lo pinta a varios zooms con
        filtrado nearest y comprueba la extrusion sobre los pixeles de la textura ya subida a
        Phaser.
      </p>
    </header>

    <section class="lab__block">
      <h2>1. Arranque y presupuesto</h2>
      <div class="lab__boot">
        <div ref="host" class="lab__canvas" />
        <dl class="lab__facts">
          <dt>Fase</dt>
          <dd>{{ phase }}</dd>
          <dt>Paso</dt>
          <dd>
            {{
              progress
                ? progress.label + ' (' + progress.completed + '/' + progress.total + ')'
                : 'sin datos'
            }}
          </dd>
          <dt>Generacion</dt>
          <dd>{{ report ? report.generationMs.toFixed(1) + ' ms de trabajo' : 'en curso' }}</dd>
          <dt>Reloj de pared</dt>
          <dd>
            {{
              report ? report.wallMs.toFixed(1) + ' ms, fotogramas cedidos incluidos' : 'en curso'
            }}
          </dd>
          <dt>Presupuesto</dt>
          <dd>
            {{
              report
                ? report.budgetMs + ' ms, ' + (report.withinBudget ? 'cumplido' : 'excedido')
                : 'en curso'
            }}
          </dd>
          <dt>Texturas</dt>
          <dd>{{ sprites.length + atlases.length + (gridSource === '' ? 0 : 1) }}</dd>
        </dl>
      </div>

      <table v-if="report" class="lab__table">
        <thead>
          <tr>
            <th>Paso</th>
            <th>Etiqueta</th>
            <th class="lab__num">Texturas</th>
            <th class="lab__num">Trabajo</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="step in report.steps" :key="step.key">
            <td class="lab__mono">{{ step.key }}</td>
            <td>{{ step.label }}</td>
            <td class="lab__num">{{ step.textures }}</td>
            <td class="lab__num">{{ step.durationMs.toFixed(1) }} ms</td>
          </tr>
        </tbody>
      </table>

      <h3>Incidencias</h3>
      <p v-if="incidents.length === 0" class="lab__ok">Sin incidencias de consola.</p>
      <ul v-else class="lab__bad">
        <li v-for="(incident, index) in incidents" :key="index">{{ incident }}</li>
      </ul>

      <h3>Resumen legible por herramienta</h3>
      <pre id="fw-report" class="lab__pre">{{ summary }}</pre>
    </section>

    <section v-for="atlas in atlases" :key="atlas.key" class="lab__block">
      <h2>{{ atlas.label }}</h2>
      <p class="lab__meta">
        {{ atlas.key }}, {{ atlas.width }} x {{ atlas.height }} px, margen 1, espaciado 2,
        {{ atlas.tiles.length }} teselas de {{ atlas.tilePx }} px.
      </p>
      <p v-if="atlas.extrusionFailures.length === 0" class="lab__ok">
        Extrusion correcta en las {{ atlas.extrusionChecked }} teselas: los cuatro bordes de cada
        tesela replican su fila o su columna de contorno.
      </p>
      <ul v-else class="lab__bad">
        <li v-for="(failure, index) in atlas.extrusionFailures" :key="index">{{ failure }}</li>
      </ul>
      <div class="lab__zooms">
        <figure v-for="zoom in atlasZooms" :key="zoom">
          <img
            class="lab__img"
            :src="atlas.source"
            :style="{ width: atlas.width * zoom + 'px', height: atlas.height * zoom + 'px' }"
            :alt="atlas.label"
          />
          <figcaption>
            Atlas completo a {{ zoom }}x. Las juntas de 2 px no se distinguen porque replican el
            borde de cada tesela, que es precisamente el objeto de la extrusion.
          </figcaption>
        </figure>
      </div>
      <div class="lab__grid">
        <figure v-for="tile in atlas.tiles" :key="tile.index" class="lab__cell">
          <div class="lab__cellzooms">
            <img
              v-for="zoom in spriteZooms"
              :key="zoom"
              class="lab__img"
              :src="tile.source"
              :style="{ width: atlas.tilePx * zoom + 'px', height: atlas.tilePx * zoom + 'px' }"
              :alt="tile.label"
            />
          </div>
          <figcaption>{{ tile.label }}</figcaption>
        </figure>
      </div>
    </section>

    <section v-if="cropCards.length > 0" class="lab__block">
      <h2>Recorrido del ciclo de cultivo</h2>
      <p class="lab__meta">
        Los ocho estados de GDD seccion 41 en orden de ciclo, con el indice de tesela que el
        renderizador usa. El patron distingue el estado sin depender del color.
      </p>
      <div class="lab__grid">
        <figure v-for="card in cropCards" :key="card.state" class="lab__cell">
          <div class="lab__cellzooms">
            <img
              v-for="zoom in spriteZooms"
              :key="zoom"
              class="lab__img"
              :src="card.source"
              :style="{
                width: TERRAIN_TILE_PX * zoom + 'px',
                height: TERRAIN_TILE_PX * zoom + 'px',
              }"
              :alt="card.state"
            />
          </div>
          <figcaption>{{ card.state }}, tesela {{ card.index }}</figcaption>
        </figure>
      </div>
    </section>

    <section class="lab__block">
      <h2>Rejilla</h2>
      <p class="lab__meta">
        Una tesela de una celda, repetida por un unico TileSprite. Lineas solo en el norte y el
        oeste: cerrar los cuatro lados duplicaria la linea en cada junta.
      </p>
      <div class="lab__zooms">
        <figure v-for="zoom in atlasZooms" :key="zoom">
          <div
            class="lab__tiled"
            :style="{
              backgroundImage: 'url(' + gridSource + ')',
              backgroundSize: GRID_TILE_PX * zoom + 'px ' + GRID_TILE_PX * zoom + 'px',
              width: GRID_TILE_PX * zoom * 4 + 'px',
              height: GRID_TILE_PX * zoom * 3 + 'px',
            }"
          />
          <figcaption>Repetida a {{ zoom }}x sobre el tono de la pradera</figcaption>
        </figure>
      </div>
    </section>

    <section v-for="entry in spriteGroups" :key="entry.group" class="lab__block">
      <h2>{{ entry.label }}</h2>
      <div class="lab__grid">
        <figure v-for="sprite in spritesOf(entry.group)" :key="sprite.key" class="lab__cell">
          <div class="lab__cellzooms">
            <img
              v-for="zoom in spriteZooms"
              :key="zoom"
              class="lab__img"
              :src="sprite.source"
              :style="{ width: sprite.width * zoom + 'px', height: sprite.height * zoom + 'px' }"
              :alt="sprite.label"
            />
          </div>
          <figcaption>
            {{ sprite.label }}
            <span class="lab__mono">{{ sprite.key }}, {{ sprite.width }}x{{ sprite.height }}</span>
          </figcaption>
        </figure>
      </div>
    </section>

    <section class="lab__block">
      <h2>Paleta y variables CSS</h2>
      <p class="lab__meta">
        {{ paletteEntries.length }} variables, escritas sobre el elemento raiz al arrancar el juego,
        de modo que la leyenda, los paneles y el lienzo no puedan divergir.
      </p>
      <ul class="lab__swatches">
        <li v-for="entry in paletteEntries" :key="entry[0]">
          <span class="lab__swatch" :style="{ background: entry[1] }" />
          <span class="lab__mono">{{ entry[0] }}</span>
          <span class="lab__mono">{{ entry[1] }}</span>
        </li>
      </ul>
      <h3>Bloque para app/assets/tokens.css</h3>
      <pre class="lab__pre">{{ cssBlock }}</pre>
    </section>

    <footer class="lab__foot">
      <p>
        Variantes de terreno por tipo: {{ TERRAIN_VARIANTS }}. Teselas de terreno:
        {{ TERRAIN_TILE_COUNT }}. Teselas de uso: {{ USAGE_TILE_COUNT }}.
      </p>
    </footer>
  </main>
</template>

<style scoped>
.lab {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.lab__lead,
.lab__meta {
  color: var(--fw-text-muted);
  max-width: 90ch;
}

.lab__block {
  border-top: 1px solid var(--fw-border);
  padding-top: 1rem;
}

.lab__boot {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
  align-items: flex-start;
}

.lab__canvas {
  width: 480px;
  height: 160px;
  border: 1px solid var(--fw-border);
}

.lab__facts {
  display: grid;
  grid-template-columns: auto auto;
  gap: 0.15rem 1rem;
  margin: 0;
}

.lab__facts dt {
  color: var(--fw-text-muted);
}

.lab__facts dd {
  margin: 0;
  font-family: var(--fw-font-mono);
}

.lab__table {
  border-collapse: collapse;
  margin: 1rem 0;
}

.lab__table th,
.lab__table td {
  border-bottom: 1px solid var(--fw-border);
  padding: 0.25rem 0.75rem 0.25rem 0;
  text-align: left;
}

.lab__num {
  text-align: right;
  font-family: var(--fw-font-mono);
}

.lab__mono {
  font-family: var(--fw-font-mono);
  font-size: 12px;
  color: var(--fw-text-muted);
}

.lab__ok {
  color: var(--fw-accent);
}

.lab__bad {
  color: var(--fw-danger);
  font-family: var(--fw-font-mono);
  font-size: 12px;
}

.lab__pre {
  background: var(--fw-surface);
  border: 1px solid var(--fw-border);
  padding: 0.75rem;
  overflow-x: auto;
  font-family: var(--fw-font-mono);
  font-size: 12px;
}

.lab__zooms {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
  align-items: flex-start;
  margin: 1rem 0;
}

.lab__grid {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.lab__cell {
  margin: 0;
  padding: 0.5rem;
  border: 1px solid var(--fw-border);
  background: var(--fw-surface);
}

.lab__cellzooms {
  display: flex;
  gap: 0.5rem;
  align-items: flex-end;
  padding: 0.25rem;
  /* Checkerboard, so a transparent tile reads as transparent and not as black. */
  background-image:
    linear-gradient(45deg, #2a2f36 25%, transparent 25%),
    linear-gradient(-45deg, #2a2f36 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #2a2f36 75%),
    linear-gradient(-45deg, transparent 75%, #2a2f36 75%);
  background-size: 8px 8px;
  background-position:
    0 0,
    0 4px,
    4px -4px,
    -4px 0;
}

figcaption {
  display: block;
  color: var(--fw-text-muted);
  font-size: 12px;
  margin-top: 0.35rem;
}

.lab__img {
  image-rendering: pixelated;
  display: block;
}

.lab__tiled {
  image-rendering: pixelated;
  background-repeat: repeat;
  background-color: var(--fw-terrain-grass, #7a9c4f);
  border: 1px solid var(--fw-border);
}

.lab__swatches {
  list-style: none;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(22rem, 1fr));
  gap: 0.25rem;
}

.lab__swatches li {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

.lab__swatch {
  width: 2rem;
  height: 1rem;
  border: 1px solid var(--fw-border);
}

.lab__foot {
  color: var(--fw-text-muted);
  font-size: 12px;
}
</style>
