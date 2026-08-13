<script setup lang="ts">
// One forest plot: what it is made of, what it is worth and what is being done to it.
//
// Owner: W6-D. Panel `forest-plot` of the frozen registry. Surface: side panel of the
// forestry tab, and the destination of the `FELL_AREA` and `CLEAR_LAND` modes of the tool.
//
// The listing answers "what do I own"; this panel answers the three questions that decide
// what to do with one plot.
//
//   What is in it. The histogram of the four stages of GDD section 131, and the wood each
//   one holds. A mature stand and a stand of saplings have the same cell count and nothing
//   else in common, and only the composition says which is which.
//   What it is worth. The volume of the fellable trees at the fixed price of GDD section
//   133, computed with `woodSaleRevenue`, which is the function the server writes the ledger
//   entry with. The panel never multiplies a price (ADR-0048).
//   What is happening to it. The task in flight, with the same countdown as the task listing
//   and from the same clock.
//
// It also owns the two selections that end here. The felling of GDD section 132 is by batch
// and never tree by tree: the interface picks the whole plot or a sub area, which is option B
// of that section and the one thing the MVP implements (GDD section 141). And the clearing of
// GDD section 10 turns felled ground into arable land, which is the one direction the MVP
// supports, GDD section 137 leaving reforestation of a field outside it.
//
// Neither selection is sent from here. Both are tasks, and a task needs a worker and a
// machine, which is `task-assign` and nowhere else. What this panel decides is the area; what
// the dialogue decides is who works it.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  judgeSelection,
  jumpToCell,
  panelCellReader,
  reasonLines,
  startSelectionMode,
  stopSelectionMode,
} from '~/components/panels/cell-inspector/worldAccess';
import { formatArea } from '~/components/panels/legend/units';
import { OPERATION_LABELS, TREE_STAGE_LABELS } from '~/components/panels/legend/vocabulary';
import {
  composeArea,
  emptyCells,
  fellBlockingCode,
  occupancyBp,
  replantBlockingCode,
  stageRows,
  woodM3,
  woodValue,
} from '~/components/panels/shared/forestPresentation';
import { taskProgressBp, taskRemainingGameMs } from '~/components/panels/shared/taskProgress';
import UiBadge from '~/components/ui/UiBadge.vue';
import UiButton from '~/components/ui/UiButton.vue';
import UiCard from '~/components/ui/UiCard.vue';
import UiEmptyState from '~/components/ui/UiEmptyState.vue';
import UiMeter from '~/components/ui/UiMeter.vue';
import UiStat from '~/components/ui/UiStat.vue';
import { useApi } from '~/composables/useApi';
import { useFormatting } from '~/composables/useFormatting';
import { useGameBridge } from '~/composables/useGameBridge';
import { useGameClock } from '~/composables/useGameClock';
import { useShellUi } from '~/composables/useShellUi';
import { SelectionToolMode } from '~/game/selection/modes';
import { isApiClientError } from '~/net/errors';
import {
  TaskOperation,
  VALIDATION_MESSAGES,
  ValidationCode,
  apiErrorMessage,
  cellKey,
  gameMs,
  type CellCoordWire,
  type GameMs,
} from '~/shared/index';
import { useForestryStore } from '~/stores/forestry';
import { usePlayerStore } from '~/stores/player';
import { useSelectionStore } from '~/stores/selection';
import { useTasksStore } from '~/stores/tasks';
import { useWorldStore } from '~/stores/world';

const props = withDefaults(
  defineProps<{
    forestPlotId?: string | null;
    /**
     * Instant the derived figures are drawn at. Injected so a suite drives the clock.
     *
     * A plain `bigint` and branded below, not `GameMs`: the runtime type of a property is
     * inferred from its written type and a branded bigint is an intersection, which becomes
     * `Object` and makes every mount that passes the instant warn about its type.
     */
    atGameMs?: bigint | null;
  }>(),
  { forestPlotId: null, atGameMs: null },
);

const forestry = useForestryStore();
const tasks = useTasksStore();
const player = usePlayerStore();
const selection = useSelectionStore();
const world = useWorldStore();
const shell = useShellUi();
const bridge = useGameBridge();
const clock = useGameClock();
const api = useApi();
const format = useFormatting();

const failure = ref('');
const loading = ref(false);
/** Which of the two area modes this panel put the canvas into, or null. */
const areaMode = ref<'FELL' | 'CLEAR' | null>(null);

const reader = panelCellReader(world, () => player.id);

const plot = computed(() =>
  props.forestPlotId === null ? null : (forestry.get(props.forestPlotId) ?? null),
);

const now = computed<GameMs>(() =>
  props.atGameMs === null ? clock.gameMs.value : gameMs(props.atGameMs),
);

/**
 * Loads the tree page of the plot when the client does not hold it.
 *
 * The trees travel in the snapshot and in the `TREES_UPSERTED` frame, and the detail route
 * exists precisely for the client that has the plot and not its trees
 * (`shared/api/schemas/forestry.ts`). It writes the same store slice the reducer writes with
 * the same payload, which is the precedent `ensureFieldGeometry` set for the field geometry:
 * nothing is invented here, and the alternative is a panel that cannot describe a sub area.
 */
async function ensureTrees(): Promise<void> {
  const current = plot.value;
  if (current === null || loading.value || forestry.treesOf(current.id).length > 0) {
    return;
  }
  loading.value = true;
  try {
    const reply = await api.query('GET /api/forest-plots/:forestPlotId', {
      params: { forestPlotId: current.id },
    });
    forestry.upsert(reply.plot);
    forestry.replacePlotTrees(current.id, reply.trees);
  } catch (error) {
    failure.value = isApiClientError(error)
      ? apiErrorMessage(error.code)
      : 'No se pudo leer el arbolado de la parcela.';
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void ensureTrees();
});

watch(
  () => props.forestPlotId,
  () => {
    void ensureTrees();
  },
);

onBeforeUnmount(() => {
  if (areaMode.value !== null) {
    stopSelectionMode({ bridge, selection });
  }
});

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

const stages = computed(() => (plot.value === null ? [] : stageRows(plot.value.stageHistogram)));

const occupancy = computed(() => (plot.value === null ? 0 : occupancyBp(plot.value)));

const freeCells = computed<readonly CellCoordWire[]>(() =>
  plot.value === null
    ? []
    : emptyCells(forestry.cellsOf(plot.value.id), forestry.treesOf(plot.value.id)),
);

/**
 * The tree that changes stage soonest, which is the only thing about a plot that is worth
 * waiting for: GDD section 131 is explicit that a mature tree is not lost if it is not felled
 * in time, so nothing here is urgent and the figure is an investment horizon and not a timer.
 */
const nextMilestone = computed(() => {
  const current = plot.value;
  if (current === null) {
    return null;
  }
  let best: { atGameMs: GameMs; stage: string } | null = null;
  for (const tree of forestry.treesOf(current.id)) {
    const derived = forestry.derive(tree, now.value);
    if (derived.nextStageAtGameMs === null) {
      continue;
    }
    if (best === null || derived.nextStageAtGameMs < best.atGameMs) {
      best = { atGameMs: derived.nextStageAtGameMs, stage: TREE_STAGE_LABELS[derived.growthStage] };
    }
  }
  return best;
});

// ---------------------------------------------------------------------------
// The task in flight
// ---------------------------------------------------------------------------

const currentTask = computed(() => {
  const id = plot.value?.currentTaskId ?? null;
  return id === null ? null : (tasks.get(id) ?? null);
});

const taskProgress = computed(() =>
  currentTask.value === null ? 0 : taskProgressBp(currentTask.value, now.value),
);
const taskRemaining = computed(() =>
  currentTask.value === null ? null : taskRemainingGameMs(currentTask.value, now.value),
);

// ---------------------------------------------------------------------------
// The area
// ---------------------------------------------------------------------------

const cells = computed(() => selection.cells);

/** Composition of the selected sub area, which no route reports (GDD section 132, option B). */
const areaComposition = computed(() => {
  const current = plot.value;
  if (current === null || cells.value.length === 0) {
    return null;
  }
  const wanted = new Set(cells.value.map((cell) => cellKey(cell.cellX, cell.cellY)));
  const inside = forestry
    .treesOf(current.id)
    .filter((tree) => wanted.has(cellKey(tree.cellX, tree.cellY)));
  return composeArea(inside, now.value);
});

/**
 * The verdict of a clearing selection.
 *
 * `CLEAR_LAND` is one of the two modes the shared rules have a purpose for and the felling
 * area is one of the two they do not (`game/selection/rules.ts`, ADR-0030), so the clearing
 * is judged with the shared function and the felling area is judged by its composition, which
 * is what `NO_FELLABLE_TREES` reports.
 */
const clearVerdict = computed(() => {
  void world.revision;
  return judgeSelection(reader, { mode: SelectionToolMode.CLEAR_LAND }, cells.value);
});

const clearReasons = computed(() => reasonLines(clearVerdict.value.validation));

const fellCode = computed<ValidationCode | null>(() => {
  const current = plot.value;
  if (current === null) {
    return ValidationCode.NOT_FOUND;
  }
  const plotCode = fellBlockingCode(current);
  if (plotCode !== null) {
    return plotCode;
  }
  const area = areaComposition.value;
  if (area === null) {
    return null;
  }
  return area.fellableCount > 0 ? null : ValidationCode.NO_FELLABLE_TREES;
});

const replantCode = computed<ValidationCode | null>(() =>
  plot.value === null ? ValidationCode.NOT_FOUND : replantBlockingCode(plot.value),
);

/**
 * Why replanting is refused, which is not always a code of the contract.
 *
 * `POST .../replant` names its cells one by one (GDD section 137), so the panel may only
 * offer it when the cells it would name are the empty ones the plot reports. The tree page
 * does not travel in the snapshot and `emptyCells` over an empty tree page returns *every*
 * cell of the plot, so the count is the check: while `ensureTrees` has not answered, what
 * the client holds is not enough to compose the request. The refusal has no
 * `ValidationCode`, and a control disabled in silence is what ADR-0032 forbids.
 */
const replantReason = computed<string>(() => {
  if (replantCode.value !== null) {
    return VALIDATION_MESSAGES[replantCode.value];
  }
  return freeCells.value.length === (plot.value?.emptyCellCount ?? 0)
    ? ''
    : 'El arbolado de la parcela se esta leyendo todavia.';
});

function reasonOf(code: ValidationCode | null): string {
  return code === null ? '' : VALIDATION_MESSAGES[code];
}

function startArea(mode: 'FELL' | 'CLEAR'): void {
  const current = plot.value;
  if (current === null) {
    return;
  }
  areaMode.value = mode;
  startSelectionMode(
    { bridge, selection },
    mode === 'FELL'
      ? { mode: SelectionToolMode.FELL_AREA, forestPlotId: current.id }
      : { mode: SelectionToolMode.CLEAR_LAND, forestPlotId: current.id },
  );
}

function stopArea(): void {
  areaMode.value = null;
  stopSelectionMode({ bridge, selection });
}

function goToConflict(): void {
  const target = clearVerdict.value.firstConflict;
  if (target !== null) {
    jumpToCell(bridge, target);
  }
}

/** Hands the area to the assignment dialogue, which is where a task gets its worker. */
function assign(operation: TaskOperation, area: readonly CellCoordWire[]): void {
  const current = plot.value;
  if (current === null) {
    return;
  }
  shell.openModal('task-assign', {
    forestPlotId: current.id,
    operation,
    cells: area.map((cell) => ({ cellX: cell.cellX, cellY: cell.cellY })),
  });
}
</script>

<template>
  <UiCard title="Parcela forestal" :subtitle="plot?.name ?? 'Sin parcela seleccionada'">
    <template #header>
      <UiButton size="sm" variant="ghost" @click="shell.openSidePanel('forestry')">
        Ver todas
      </UiButton>
    </template>

    <UiEmptyState
      v-if="plot === null"
      title="Ninguna parcela seleccionada"
      detail="Elige una parcela en el listado de silvicultura o haz clic sobre ella en el mapa."
    />

    <div v-else class="fw-plot">
      <div class="fw-plot__stats">
        <UiStat
          label="Celdas"
          :value="format.formatCount(plot.cellCount)"
          :unit="` · ${formatArea(plot.cellCount, world.cellSizeM)}`"
        />
        <UiStat label="Arboles en pie" :value="format.formatCount(plot.standingTreeCount)" />
        <UiStat
          label="Madera en pie"
          :value="`${woodM3(plot.standingWoodDm3).toFixed(2)} m3`"
          hint="Derivada de la fase de cada arbol, nunca almacenada (§131)"
        />
        <UiStat
          label="Talable ahora"
          :value="`${woodM3(plot.fellableWoodDm3).toFixed(2)} m3`"
          hint="Los plantones no se talan (§131)"
        />
        <UiStat
          label="Valor"
          :value="format.formatMoney(woodValue(plot.fellableWoodDm3))"
          tone="muted"
          hint="Al precio fijo de 45 $/m3 de la seccion 133"
        />
      </div>

      <UiMeter label="Celdas con arbol" :value-bp="occupancy" tone="accent" />

      <p v-if="failure !== ''" class="fw-plot__failure">{{ failure }}</p>

      <!-- Composition: the four stages of the life cycle (§131). -->
      <section>
        <h3 class="fw-plot__heading">Composicion <span>§130 · §131</span></h3>
        <ul class="fw-plot__stages">
          <li v-for="stage in stages" :key="stage.stage">
            <span class="fw-plot__swatch" :style="{ background: stage.colour }" />
            <span class="fw-plot__stagename">{{ stage.label }}</span>
            <span class="fw-plot__stagecount">{{ format.formatCount(stage.count) }}</span>
            <span class="fw-plot__muted">
              {{ stage.volumeM3.toFixed(2) }} m3 por arbol<template v-if="!stage.fellable">
                · no talable</template
              >
            </span>
          </li>
        </ul>
        <p v-if="nextMilestone !== null" class="fw-plot__muted">
          Proximo cambio de fase en
          {{ format.formatGameDuration(nextMilestone.atGameMs - now) }}. Un arbol maduro no se
          pierde si no se tala: sigue acumulando volumen hasta estancarse (§131).
        </p>
        <p v-else-if="loading" class="fw-plot__muted">Leyendo el arbolado…</p>
      </section>

      <!-- The task in flight, with the countdown of the task listing. -->
      <section v-if="currentTask !== null">
        <h3 class="fw-plot__heading">Tarea en curso <span>§105</span></h3>
        <div class="fw-plot__rowhead">
          <span class="fw-plot__name">{{ OPERATION_LABELS[currentTask.operation] }}</span>
          <UiBadge tone="accent">
            {{ taskRemaining === null ? 'ahora' : format.formatGameDuration(taskRemaining) }}
          </UiBadge>
        </div>
        <UiMeter label="Progreso" :value-bp="taskProgress" tone="accent" />
        <UiButton size="sm" variant="ghost" @click="shell.openSidePanel('task-list')">
          Ver las tareas
        </UiButton>
      </section>

      <!-- The area, which is what this panel decides (§132 opcion B y §10). -->
      <section>
        <h3 class="fw-plot__heading">Tala y desmonte <span>§132 · §135 · §10</span></h3>

        <div v-if="areaMode === null" class="fw-plot__actions">
          <UiButton
            size="sm"
            :disabled="fellCode !== null"
            :reason="reasonOf(fellCode)"
            @click="assign(TaskOperation.FELL, [])"
          >
            Talar la parcela entera
          </UiButton>
          <UiButton size="sm" variant="ghost" @click="startArea('FELL')">Elegir area</UiButton>
          <UiButton size="sm" variant="ghost" @click="startArea('CLEAR')">Desmontar area</UiButton>
          <UiButton
            size="sm"
            :disabled="replantReason !== ''"
            :reason="replantReason"
            @click="assign(TaskOperation.REPLANT, freeCells)"
          >
            Replantar {{ format.formatCount(freeCells.length) }} celdas
          </UiButton>
        </div>

        <div v-else class="fw-plot__area">
          <p class="fw-plot__muted">
            {{ format.formatCount(cells.length) }} celdas ·
            {{ formatArea(cells.length, world.cellSizeM) }}. Mayusculas une, alt resta y control
            conmuta una celda.
          </p>

          <template v-if="areaMode === 'FELL'">
            <p v-if="areaComposition !== null" class="fw-plot__muted">
              En el area: {{ format.formatCount(areaComposition.standingCount) }} arboles,
              {{ format.formatCount(areaComposition.fellableCount) }} talables ·
              {{ areaComposition.volumeM3.toFixed(2) }} m3 ·
              {{ format.formatMoney(areaComposition.value) }}
            </p>
            <div class="fw-plot__actions">
              <UiButton
                variant="primary"
                :disabled="fellCode !== null || cells.length === 0"
                :reason="reasonOf(fellCode)"
                @click="assign(TaskOperation.FELL, cells)"
              >
                Talar el area
              </UiButton>
              <UiButton size="sm" variant="ghost" @click="stopArea">Salir del modo</UiButton>
            </div>
          </template>

          <template v-else>
            <p class="fw-plot__muted">
              El desmonte convierte celdas ya taladas en terreno cultivable. Es la unica direccion
              del MVP: reforestar un campo queda fuera (§10 y §137).
            </p>
            <ul v-if="clearReasons.length > 0" class="fw-plot__reasons">
              <li v-for="reason in clearReasons" :key="reason.code">
                <UiBadge tone="danger">{{ format.formatCount(reason.cellCount) }}</UiBadge>
                {{ reason.message }}
              </li>
            </ul>
            <div class="fw-plot__actions">
              <UiButton
                variant="primary"
                :disabled="!clearVerdict.sendable"
                :reason="clearReasons[0]?.message ?? ''"
                @click="assign(TaskOperation.CLEAR_LAND, cells)"
              >
                Desmontar el area
              </UiButton>
              <UiButton
                size="sm"
                variant="ghost"
                :disabled="clearVerdict.firstConflict === null"
                @click="goToConflict"
              >
                Ir al primer conflicto
              </UiButton>
              <UiButton size="sm" variant="ghost" @click="stopArea">Salir del modo</UiButton>
            </div>
          </template>
        </div>
      </section>
    </div>
  </UiCard>
</template>

<style scoped>
.fw-plot {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.fw-plot__stats {
  display: flex;
  gap: var(--fw-gap-lg, 16px);
  flex-wrap: wrap;
}

.fw-plot__heading {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin: 0 0 6px;
  font-size: var(--fw-font-size, 14px);
}

.fw-plot__heading span {
  color: var(--fw-text-muted, #9aa4b2);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-plot__stages {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0 0 6px;
  padding: 0;
  list-style: none;
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-plot__stages li {
  display: flex;
  gap: 6px;
  align-items: center;
}

.fw-plot__swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.fw-plot__stagename {
  flex: 1 1 auto;
}

.fw-plot__stagecount {
  font-family: var(--fw-font-mono, monospace);
  font-variant-numeric: tabular-nums;
}

.fw-plot__rowhead {
  display: flex;
  gap: 8px;
  align-items: baseline;
  flex-wrap: wrap;
}

.fw-plot__name {
  font-weight: 600;
}

.fw-plot__area {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--fw-border-strong, #48525f);
  border-radius: var(--fw-radius, 4px);
}

.fw-plot__reasons {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-plot__muted {
  margin: 0;
  color: var(--fw-text-muted, #9aa4b2);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-plot__failure {
  margin: 0;
  color: var(--fw-danger, #b4544a);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-plot__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
</style>
