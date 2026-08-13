<script setup lang="ts">
// Forestry: the plots, what is standing in them, and what a felling would produce.
//
// Owner: W6-D. Panel `forestry` of the frozen registry. Surface: side panel of the forestry
// tab, and the destination of the `FOREST_PLOT` mode of the selection tool.
//
// GDD section 128 is explicit that forestry is a parallel production system and not a
// variation of agriculture, and the difference shows in what this panel has to say. A field
// has one state for the whole area; a plot is a collection of individual trees at different
// stages (GDD sections 129 and 130), so the reading that matters is a composition and not a
// state: how many trees at each of the four stages, how much wood is standing, and how much
// of it a felling could take today.
//
// Every figure here is derived and none of it is stored. A tree stores only when it was
// planted (ADR-0030 of the plan and `shared/rules/forestry.ts`), and the stage, the volume
// and the value follow from that instant, the species and the clock. The reply carries them
// already derived, and the panel keeps deriving the sub area figures with the same functions,
// which is what lets a forest mature on screen with no traffic at all.
//
// Three things start here and finish elsewhere, which is the division ADR-0032 asks for: the
// creation of a plot is a selection plus a name and is answered by this panel; the inspection
// of one plot is `forest-plot`; and the felling, the replanting and the clearing are tasks,
// so they are `task-assign`, which is the one place that decides a worker and a combination
// of machines. Answering the machinery question twice would be exactly the duplication
// ADR-0033 documented for the placement plan.
import { computed, onBeforeUnmount, ref } from 'vue';
import {
  judgeSelection,
  jumpToCell,
  panelCellReader,
  reasonLines,
  startSelectionMode,
  stopSelectionMode,
} from '~/components/panels/cell-inspector/worldAccess';
import { formatArea } from '~/components/panels/legend/units';
import { OPERATION_LABELS } from '~/components/panels/legend/vocabulary';
import {
  emptyCells,
  fellBlockingCode,
  occupancyBp,
  replantBlockingCode,
  stageRows,
  woodM3,
  woodValue,
} from '~/components/panels/shared/forestPresentation';
import UiBadge from '~/components/ui/UiBadge.vue';
import UiButton from '~/components/ui/UiButton.vue';
import UiCard from '~/components/ui/UiCard.vue';
import UiEmptyState from '~/components/ui/UiEmptyState.vue';
import UiMeter from '~/components/ui/UiMeter.vue';
import UiStat from '~/components/ui/UiStat.vue';
import { useApi } from '~/composables/useApi';
import { useFormatting } from '~/composables/useFormatting';
import { useGameBridge } from '~/composables/useGameBridge';
import { useShellUi } from '~/composables/useShellUi';
import { SelectionToolMode } from '~/game/selection/modes';
import { isApiClientError } from '~/net/errors';
import {
  MAX_NAME_LENGTH,
  TaskOperation,
  VALIDATION_MESSAGES,
  apiErrorMessage,
  type ForestPlotDto,
  type ValidationCode,
} from '~/shared/index';
import { useFarmsStore } from '~/stores/farms';
import { useForestryStore } from '~/stores/forestry';
import { usePlayerStore } from '~/stores/player';
import { useSelectionStore } from '~/stores/selection';
import { useTasksStore } from '~/stores/tasks';
import { useWorldStore } from '~/stores/world';

const forestry = useForestryStore();
const farms = useFarmsStore();
const tasks = useTasksStore();
const player = usePlayerStore();
const selection = useSelectionStore();
const world = useWorldStore();
const shell = useShellUi();
const bridge = useGameBridge();
const api = useApi();
const format = useFormatting();

const creating = ref(false);
const name = ref('');
const farmId = ref<string | null>(farms.primary?.id ?? null);
const sending = ref(false);
const failure = ref('');

const reader = panelCellReader(world, () => player.id);

// ---------------------------------------------------------------------------
// The holding
// ---------------------------------------------------------------------------

const plots = computed(() => forestry.all);

const totals = computed(() => {
  let standingDm3 = 0;
  let fellableDm3 = 0;
  let standingTrees = 0;
  for (const plot of plots.value) {
    standingDm3 += plot.standingWoodDm3;
    fellableDm3 += plot.fellableWoodDm3;
    standingTrees += plot.standingTreeCount;
  }
  return {
    standingDm3,
    fellableDm3,
    standingTrees,
    fellableValue: woodValue(fellableDm3),
  };
});

interface PlotRow {
  readonly plot: ForestPlotDto;
  readonly stages: ReturnType<typeof stageRows>;
  readonly occupancyBp: number;
  readonly standingM3: number;
  readonly fellableM3: number;
  readonly emptyCellCount: number;
  readonly replantableCellCount: number;
  readonly fellCode: ValidationCode | null;
  readonly replantCode: ValidationCode | null;
  /**
   * Why replanting is refused, which is not always a code of the contract.
   *
   * `POST .../replant` names its cells one by one (GDD section 137), so the panel can only
   * offer it when the cells it would name are the empty ones the plot reports. The tree page
   * does not travel in the snapshot (`shared/api/schemas/state.ts`), and `emptyCells` over an
   * empty tree page returns *every* cell of the plot, so the count is the check: when the
   * cells derived locally are not exactly `emptyCellCount`, what the client holds is not
   * enough to compose the request. That refusal has no `ValidationCode` —the server would
   * accept a correct request— and a control disabled with no sentence is what ADR-0032
   * forbids, so it carries one.
   */
  readonly replantReason: string;
  readonly taskLabel: string | null;
}

const rows = computed<readonly PlotRow[]>(() =>
  plots.value.map((plot) => {
    const task = plot.currentTaskId === null ? undefined : tasks.get(plot.currentTaskId);
    const free = emptyCells(forestry.cellsOf(plot.id), forestry.treesOf(plot.id));
    const replantCode = replantBlockingCode(plot);
    return {
      plot,
      stages: stageRows(plot.stageHistogram),
      occupancyBp: occupancyBp(plot),
      standingM3: woodM3(plot.standingWoodDm3),
      fellableM3: woodM3(plot.fellableWoodDm3),
      emptyCellCount: plot.emptyCellCount,
      replantableCellCount: free.length,
      fellCode: fellBlockingCode(plot),
      replantCode,
      replantReason:
        replantCode !== null
          ? VALIDATION_MESSAGES[replantCode]
          : free.length === plot.emptyCellCount
            ? ''
            : 'El arbolado de la parcela no se ha leido todavia. Abre la parcela para nombrar sus celdas vacias.',
      taskLabel: task === undefined ? null : OPERATION_LABELS[task.operation],
    };
  }),
);

function reasonOf(code: ValidationCode | null): string {
  return code === null ? '' : VALIDATION_MESSAGES[code];
}

// ---------------------------------------------------------------------------
// Creating a plot over owned forest
// ---------------------------------------------------------------------------

const cells = computed(() => selection.cells);

const verdict = computed(() => {
  void world.revision;
  return judgeSelection(reader, { mode: SelectionToolMode.FOREST_PLOT }, cells.value);
});

const reasons = computed(() => reasonLines(verdict.value.validation));

const trimmedName = computed(() => name.value.trim());

/** Why the plot cannot be created, or null. The codes are the shared ones (ADR-0032). */
const creationBlockedBy = computed<string | null>(() => {
  if (trimmedName.value.length === 0) {
    return 'La parcela necesita un nombre.';
  }
  if (trimmedName.value.length > MAX_NAME_LENGTH) {
    return `El nombre admite ${MAX_NAME_LENGTH} caracteres como maximo.`;
  }
  if (cells.value.length === 0) {
    return 'Arrastra sobre el mapa para elegir las celdas de bosque en propiedad.';
  }
  if (verdict.value.unresolvedCount > 0) {
    return `Faltan por cargar ${verdict.value.unresolvedCount} celdas de la seleccion.`;
  }
  return reasons.value[0]?.message ?? null;
});

const canCreate = computed(() => creationBlockedBy.value === null && verdict.value.sendable);
/** `exactOptionalPropertyTypes` is on: the reason is bound as an object or not at all. */
const creationReasonProps = computed(() =>
  creationBlockedBy.value === null ? {} : { reason: creationBlockedBy.value },
);

function startCreation(): void {
  creating.value = true;
  name.value = `Bosque ${forestry.count + 1}`;
  startSelectionMode({ bridge, selection }, { mode: SelectionToolMode.FOREST_PLOT });
}

function stopCreation(): void {
  creating.value = false;
  stopSelectionMode({ bridge, selection });
}

onBeforeUnmount(() => {
  if (creating.value) {
    stopSelectionMode({ bridge, selection });
  }
});

/**
 * Creates the plot, which generates its natural forest exactly once.
 *
 * It moves no money: the land was paid for when it was bought (GDD sections 14 and 130), so
 * the route carries no idempotency key. What stops a second plot from farming free trees is
 * `naturalTreeConsumed` on the cell, which answers `NATURAL_TREES_ALREADY_CONSUMED`
 * (`shared/api/schemas/forestry.ts`).
 */
async function create(): Promise<void> {
  if (!canCreate.value || sending.value) {
    return;
  }
  sending.value = true;
  failure.value = '';
  try {
    const reply = await api.mutate('POST /api/forest-plots', {
      body: {
        name: trimmedName.value,
        farmId: farmId.value,
        cells: cells.value.map((cell) => ({ cellX: cell.cellX, cellY: cell.cellY })),
      },
    });
    stopCreation();
    selection.cancel();
    shell.openSidePanel('forest-plot', { forestPlotId: reply.result.plot.id });
  } catch (error) {
    failure.value = isApiClientError(error)
      ? apiErrorMessage(error.code)
      : 'No se pudo crear la parcela forestal.';
  } finally {
    sending.value = false;
  }
}

function goToConflict(): void {
  const target = verdict.value.firstConflict;
  if (target !== null) {
    jumpToCell(bridge, target);
  }
}

// ---------------------------------------------------------------------------
// What a plot leads to
// ---------------------------------------------------------------------------

function inspect(plot: ForestPlotDto): void {
  shell.openSidePanel('forest-plot', { forestPlotId: plot.id });
}

/** The whole plot, which is what an omitted `cells` means on the wire (GDD section 132). */
function fellWholePlot(plot: ForestPlotDto): void {
  shell.openModal('task-assign', {
    forestPlotId: plot.id,
    operation: TaskOperation.FELL,
    cells: [],
  });
}

/** The sub area of GDD section 132, option B: the tool picks it and the inspector confirms. */
function fellArea(plot: ForestPlotDto): void {
  startSelectionMode(
    { bridge, selection },
    { mode: SelectionToolMode.FELL_AREA, forestPlotId: plot.id },
  );
  shell.openSidePanel('forest-plot', { forestPlotId: plot.id });
}

/** Replanting names the empty cells one by one (GDD section 137). */
function replant(row: PlotRow): void {
  const free = emptyCells(forestry.cellsOf(row.plot.id), forestry.treesOf(row.plot.id));
  shell.openModal('task-assign', {
    forestPlotId: row.plot.id,
    operation: TaskOperation.REPLANT,
    cells: free,
  });
}
</script>

<template>
  <UiCard title="Silvicultura" subtitle="Parcelas, arbolado en pie y volumen talable">
    <template #header>
      <UiButton v-if="!creating" size="sm" @click="startCreation">Crear parcela</UiButton>
      <UiButton v-else size="sm" variant="ghost" @click="stopCreation">Salir del modo</UiButton>
    </template>

    <div class="fw-forestry">
      <div class="fw-forestry__stats">
        <UiStat label="Parcelas" :value="format.formatCount(forestry.count)" />
        <UiStat label="Arboles en pie" :value="format.formatCount(totals.standingTrees)" />
        <UiStat
          label="Madera en pie"
          :value="`${woodM3(totals.standingDm3).toFixed(2)} m3`"
          hint="Volumen derivado de la fase de cada arbol (§131)"
        />
        <UiStat
          label="Talable ahora"
          :value="`${woodM3(totals.fellableDm3).toFixed(2)} m3`"
          hint="Los plantones no se talan y no tienen valor comercial (§131)"
        />
        <UiStat
          label="Valor de la tala"
          :value="format.formatMoney(totals.fellableValue)"
          tone="muted"
          hint="Al precio fijo de la seccion 133"
        />
      </div>

      <p v-if="failure !== ''" class="fw-forestry__failure">{{ failure }}</p>

      <!-- Creation over owned forest cells (§10, §129 y §130). -->
      <section v-if="creating" class="fw-forestry__create">
        <h3 class="fw-forestry__heading">
          Parcela nueva
          <span>
            {{ format.formatCount(cells.length) }} celdas ·
            {{ formatArea(cells.length, world.cellSizeM) }}
          </span>
        </h3>
        <label class="fw-forestry__field">
          <span>Nombre</span>
          <input v-model="name" type="text" :maxlength="MAX_NAME_LENGTH" />
        </label>
        <label class="fw-forestry__field">
          <span>Granja que la atiende</span>
          <select v-model="farmId">
            <option :value="null">Sin granja</option>
            <option v-for="farm in farms.all" :key="farm.id" :value="farm.id">
              {{ farm.name }}
            </option>
          </select>
        </label>
        <p class="fw-forestry__muted">
          Solo celdas de bosque en propiedad y sin uso. Al crearla se genera el arbolado natural una
          sola vez (§130).
        </p>
        <ul v-if="reasons.length > 0" class="fw-forestry__reasons">
          <li v-for="reason in reasons" :key="reason.code">
            <UiBadge tone="danger">{{ format.formatCount(reason.cellCount) }}</UiBadge>
            {{ reason.message }}
          </li>
        </ul>
        <div class="fw-forestry__actions">
          <UiButton
            variant="primary"
            :disabled="!canCreate"
            :busy="sending"
            v-bind="creationReasonProps"
            @click="create"
          >
            Crear parcela
          </UiButton>
          <UiButton
            size="sm"
            variant="ghost"
            :disabled="verdict.firstConflict === null"
            @click="goToConflict"
          >
            Ir al primer conflicto
          </UiButton>
          <span v-if="creationBlockedBy !== null" class="fw-forestry__muted">
            {{ creationBlockedBy }}
          </span>
        </div>
      </section>

      <!-- The plots, with the histogram of GDD section 131. -->
      <section>
        <h3 class="fw-forestry__heading">Parcelas <span>§128 · §131 · §135</span></h3>
        <UiEmptyState
          v-if="rows.length === 0"
          title="Sin parcelas forestales"
          detail="Compra celdas de bosque y crea una parcela sobre ellas: nace ya poblada con arboles en distintas fases."
        />
        <ul v-else class="fw-forestry__list">
          <li v-for="row in rows" :key="row.plot.id" class="fw-forestry__row">
            <div class="fw-forestry__rowhead">
              <span class="fw-forestry__name">{{ row.plot.name }}</span>
              <UiBadge v-if="row.taskLabel !== null" tone="accent">Con tarea en curso</UiBadge>
              <span class="fw-forestry__muted">
                {{ format.formatCount(row.plot.cellCount) }} celdas ·
                {{ formatArea(row.plot.cellCount, world.cellSizeM) }}
              </span>
            </div>

            <UiMeter label="Celdas con arbol" :value-bp="row.occupancyBp" tone="accent" />

            <!-- The four stages, always all four: an empty stage is a fact worth reading. -->
            <ul class="fw-forestry__stages">
              <li v-for="stage in row.stages" :key="stage.stage">
                <span class="fw-forestry__swatch" :style="{ background: stage.colour }" />
                <span class="fw-forestry__stagename">{{ stage.label }}</span>
                <span class="fw-forestry__stagecount">{{ format.formatCount(stage.count) }}</span>
                <span class="fw-forestry__muted">
                  {{ stage.volumeM3.toFixed(2) }} m3<template v-if="!stage.fellable">
                    · no talable</template
                  >
                </span>
              </li>
            </ul>

            <p class="fw-forestry__muted">
              En pie {{ row.standingM3.toFixed(2) }} m3 · talable ahora
              {{ row.fellableM3.toFixed(2) }} m3 ·
              {{ format.formatMoney(woodValue(row.plot.fellableWoodDm3)) }}
            </p>
            <p class="fw-forestry__muted">
              Celdas vacias {{ format.formatCount(row.emptyCellCount) }}
              <template v-if="row.replantableCellCount !== row.emptyCellCount">
                · arbolado no leido todavia
              </template>
            </p>

            <div class="fw-forestry__actions">
              <UiButton size="sm" variant="ghost" @click="inspect(row.plot)">Inspeccionar</UiButton>
              <UiButton
                size="sm"
                :disabled="row.fellCode !== null"
                :reason="reasonOf(row.fellCode)"
                @click="fellWholePlot(row.plot)"
              >
                Talar la parcela
              </UiButton>
              <UiButton
                size="sm"
                variant="ghost"
                :disabled="row.fellCode !== null"
                :reason="reasonOf(row.fellCode)"
                @click="fellArea(row.plot)"
              >
                Talar un area
              </UiButton>
              <UiButton
                size="sm"
                :disabled="row.replantReason !== ''"
                :reason="row.replantReason"
                @click="replant(row)"
              >
                Replantar
              </UiButton>
            </div>
            <p v-if="row.fellCode !== null" class="fw-forestry__blocked">
              {{ reasonOf(row.fellCode) }}
            </p>
          </li>
        </ul>
      </section>
    </div>
  </UiCard>
</template>

<style scoped>
.fw-forestry {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.fw-forestry__stats {
  display: flex;
  gap: var(--fw-gap-lg, 16px);
  flex-wrap: wrap;
}

.fw-forestry__heading {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin: 0 0 6px;
  font-size: var(--fw-font-size, 14px);
}

.fw-forestry__heading span {
  color: var(--fw-text-muted, #9aa4b2);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-forestry__create {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--fw-border-strong, #48525f);
  border-radius: var(--fw-radius, 4px);
}

.fw-forestry__field {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: space-between;
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-forestry__field input,
.fw-forestry__field select {
  flex: 1 1 auto;
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid var(--fw-border-strong, #48525f);
  border-radius: var(--fw-radius, 4px);
  background: var(--fw-surface-sunken, #101318);
  color: var(--fw-text, #e6e9ee);
}

.fw-forestry__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.fw-forestry__row {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 8px;
  border: 1px solid var(--fw-border, #333a45);
  border-radius: var(--fw-radius, 4px);
}

.fw-forestry__rowhead {
  display: flex;
  gap: 8px;
  align-items: baseline;
  flex-wrap: wrap;
}

.fw-forestry__name {
  font-weight: 600;
}

.fw-forestry__stages {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-forestry__stages li {
  display: flex;
  gap: 6px;
  align-items: center;
}

.fw-forestry__swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.fw-forestry__stagename {
  flex: 1 1 auto;
}

.fw-forestry__stagecount {
  font-family: var(--fw-font-mono, monospace);
  font-variant-numeric: tabular-nums;
}

.fw-forestry__muted {
  margin: 0;
  color: var(--fw-text-muted, #9aa4b2);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-forestry__blocked {
  margin: 0;
  color: var(--fw-warning, #c9a227);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-forestry__failure {
  margin: 0;
  color: var(--fw-danger, #b4544a);
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-forestry__reasons {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-forestry__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
</style>
