<script setup lang="ts">
// The legend: what every colour of the canvas means, and what the keyboard does.
//
// Owner: W4-E. Surface: overlay, anchored over the canvas without taking input from it,
// and also reachable from the help tab.
//
// It is not decoration and it is not optional. The art of this game is generated in code
// and deliberately abstract (plan section 9.4), so a brown cell and a slightly different
// brown cell are the difference between a plowed field and a cultivated one, which is the
// whole loop of GDD section 76. GDD sections 59 and 60 ask the interface to make the state
// of the holding readable at a glance; without this panel it is not readable at all.
//
// Every swatch is `toCssHex` of the very number `game/textures/palette.ts` gave to the
// texture factory, through `legend/vocabulary.ts`. Not one colour is written here, and not
// one is read through a CSS variable with a hand written fallback: a fallback is a second
// palette waiting to disagree with the first, and a legend that disagrees with the canvas
// is worse than no legend.
import { ref } from 'vue';
import { SHORTCUT_GROUPS } from '~/components/panels/legend/shortcuts';
import { scaleStatement } from '~/components/panels/legend/units';
import { LEGEND_GROUPS } from '~/components/panels/legend/vocabulary';
import UiButton from '~/components/ui/UiButton.vue';
import UiCard from '~/components/ui/UiCard.vue';
import { useShellUi } from '~/composables/useShellUi';
import { useWorldStore } from '~/stores/world';

const world = useWorldStore();
const shell = useShellUi();

/**
 * Whether the body is shown. Expanded by default: a legend the player has to discover
 * before the interface becomes readable defeats its own purpose. The state is local to
 * the instance, so the overlay copy and the help tab copy are folded independently.
 */
const open = ref(true);
const showShortcuts = ref(false);
</script>

<template>
  <UiCard title="Leyenda" class="fw-legend">
    <template #header>
      <!-- The one way into the settings. The help tab opens the legend by default and the
           settings are a modal nobody else reaches: without this button the panel exists and
           is unreachable, which is the same as not existing. -->
      <UiButton size="sm" variant="ghost" @click="shell.openModal('settings')">Ajustes</UiButton>
      <UiButton size="sm" variant="ghost" :aria-pressed="open" @click="open = !open">
        {{ open ? 'Plegar' : 'Desplegar' }}
      </UiButton>
    </template>

    <div v-if="open" class="fw-legend__body fw-scroll">
      <p class="fw-legend__scale fw-small fw-muted">{{ scaleStatement(world.cellSizeM) }}</p>

      <section v-for="group in LEGEND_GROUPS" :key="group.id" class="fw-legend__group">
        <h3 class="fw-legend__title">
          {{ group.title }}
          <span class="fw-legend__sections fw-mono fw-muted">
            {{ group.gddSections.map((section) => `§${section}`).join(' ') }}
          </span>
        </h3>
        <ul class="fw-legend__list">
          <li v-for="entry in group.entries" :key="entry.key" class="fw-legend__entry">
            <span
              class="fw-legend__swatch"
              :style="{ background: entry.colour }"
              :title="entry.colour"
              aria-hidden="true"
            />
            <span class="fw-legend__label">{{ entry.label }}</span>
            <span class="fw-legend__detail fw-small fw-muted">{{ entry.detail }}</span>
          </li>
        </ul>
      </section>

      <section class="fw-legend__group">
        <h3 class="fw-legend__title">
          Atajos de teclado
          <UiButton
            size="sm"
            variant="ghost"
            :aria-pressed="showShortcuts"
            @click="showShortcuts = !showShortcuts"
          >
            {{ showShortcuts ? 'Ocultar' : 'Mostrar' }}
          </UiButton>
        </h3>
        <dl v-if="showShortcuts" class="fw-legend__keys">
          <template v-for="shortcuts in SHORTCUT_GROUPS" :key="shortcuts.id">
            <dt class="fw-legend__keysTitle fw-small fw-muted">{{ shortcuts.title }}</dt>
            <dd class="fw-legend__keysBody">
              <p v-for="entry in shortcuts.entries" :key="entry.keys" class="fw-legend__key">
                <span class="fw-mono">{{ entry.keys }}</span>
                <span class="fw-small fw-muted">{{ entry.action }}</span>
              </p>
            </dd>
          </template>
        </dl>
      </section>
    </div>
  </UiCard>
</template>

<style scoped>
.fw-legend {
  width: min(320px, calc(100vw - 32px));
  background: var(--fw-surface, #1c2027);
}

.fw-legend__body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: min(46vh, 480px);
}

.fw-legend__scale {
  margin: 0;
}

.fw-legend__group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.fw-legend__title {
  display: flex;
  gap: 6px;
  align-items: baseline;
  justify-content: space-between;
  font-size: var(--fw-font-size-sm, 12px);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.fw-legend__sections {
  font-size: 10px;
  letter-spacing: 0;
}

.fw-legend__list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.fw-legend__entry {
  display: grid;
  grid-template-columns: 12px minmax(96px, auto) 1fr;
  gap: 6px;
  align-items: baseline;
}

.fw-legend__swatch {
  width: 12px;
  height: 12px;
  border: 1px solid var(--fw-border-strong, #48525f);
  border-radius: 2px;
}

.fw-legend__label {
  font-size: var(--fw-font-size-sm, 12px);
}

.fw-legend__detail {
  min-width: 0;
}

.fw-legend__keys {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
}

.fw-legend__keysTitle {
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.fw-legend__keysBody {
  margin: 0;
}

.fw-legend__key {
  display: grid;
  grid-template-columns: minmax(120px, auto) 1fr;
  gap: 6px;
  margin: 0;
  font-size: var(--fw-font-size-sm, 12px);
}
</style>
