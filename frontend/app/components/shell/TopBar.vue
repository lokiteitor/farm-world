<script setup lang="ts">
// The top bar: balance, day, multiplier, payroll, silo, burn rate and connection.
//
// Owner: W3-C.
//
// The seven figures are the ones plan section 9.6 asks for, and they are the seven a player
// of an idle management game needs before deciding anything. Two of them deserve a note.
//
// The balance shown is the projected one and not the settled one. They differ by the
// continuous costs accrued since the last settlement, so the projection is what "how much
// money do I have right now" means, while every affordability check is answered by the
// server against the settled figure inside its own transaction (plan section 6.2). Showing
// the settled one would make the bar freeze between writes.
//
// The multiplier is read only. It is a server setting and not a control of the player (GDD
// section 51, plan section 2.2), and changing it alters the cash burn of everyone at once.
import { computed } from 'vue';
import ConnectionStatus from '~/components/shell/ConnectionStatus.vue';
import UiButton from '~/components/ui/UiButton.vue';
import UiStat from '~/components/ui/UiStat.vue';
import { useFormatting } from '~/composables/useFormatting';
import { useGameClock } from '~/composables/useGameClock';
import { useShellUi } from '~/composables/useShellUi';
import { Money, StorageResource, fromWireGameMs } from '~/shared/index';
import { useClockStore } from '~/stores/clock';
import { useInventoryStore } from '~/stores/inventory';
import { useMachinesStore } from '~/stores/machines';
import { useNoticesStore } from '~/stores/notices';
import { usePlayerStore } from '~/stores/player';
import { useWorkersStore } from '~/stores/workers';

const clock = useClockStore();
const player = usePlayerStore();
const workers = useWorkersStore();
const machines = useMachinesStore();
const inventory = useInventoryStore();
const notices = useNoticesStore();
const shell = useShellUi();
const gameClock = useGameClock();
const format = useFormatting();

const balance = computed(() => format.formatMoney(player.projectedBalance));
const balanceTone = computed(() => (player.inDebt ? 'danger' : 'neutral'));

const day = computed(() => {
  const dto = player.dto;
  if (dto === null) {
    return '—';
  }
  return format.formatGameDay(gameClock.gameMs.value, fromWireGameMs(dto.startedAtGameMs));
});

const rate = computed(() => {
  const reading = clock.dto;
  return reading === null ? '—' : format.formatRate(reading.rateNum, reading.rateDen);
});

const payroll = computed(() => `${workers.headcount}`);
const payrollHint = computed(
  () => `Salarios: ${format.formatRatePerGameHour(workers.totalSalaryPerGameHour)}`,
);

const siloBp = computed(() => inventory.worstOccupancyBp[StorageResource.WHEAT_LITERS] ?? 0);
const silo = computed(() => format.formatBp(siloBp.value, 0));
const siloTone = computed(() => (siloBp.value >= 9_000 ? 'warning' : 'neutral'));

const burn = computed(() => format.formatMoney(player.holdingCostPerGameHour));
const burnHint = computed(() => {
  const local = player.localHoldingRate;
  return [
    `Salarios ${format.formatMoney(local.wagesPerGameHour)}`,
    `mantenimiento ${format.formatMoney(local.maintenancePerGameHour)}`,
    `operacion ${format.formatMoney(local.operatingPerGameHour)}`,
  ].join(' · ');
});
const burnTone = computed(() =>
  Money.isZero(player.holdingCostPerGameHour) ? 'muted' : 'warning',
);

const machineCount = computed(() => `${machines.count}`);
</script>

<template>
  <header class="fw-topbar">
    <div class="fw-topbar__brand">
      <span class="fw-topbar__name">{{ player.displayName || 'Farm World' }}</span>
    </div>

    <div class="fw-topbar__stats">
      <UiStat label="Saldo" :value="balance" :tone="balanceTone" hint="Saldo proyectado a ahora" />
      <UiStat label="Dia" :value="day" hint="Dia propio del jugador" />
      <UiStat
        label="Multiplicador"
        :value="rate"
        tone="muted"
        hint="Configuracion del servidor, en solo lectura"
      />
      <UiStat label="Plantilla" :value="payroll" :hint="payrollHint" />
      <UiStat label="Maquinaria" :value="machineCount" />
      <UiStat label="Silo" :value="silo" :tone="siloTone" hint="Ocupacion, reserva incluida" />
      <UiStat label="Consumo" :value="burn" unit="/h" :tone="burnTone" :hint="burnHint" />
    </div>

    <div class="fw-topbar__aside">
      <UiButton
        size="sm"
        variant="ghost"
        :aria-pressed="shell.noticeTrayOpen.value"
        @click="shell.noticeTrayOpen.value = !shell.noticeTrayOpen.value"
      >
        Avisos<span v-if="notices.unreadCount > 0"> ({{ notices.unreadCount }})</span>
      </UiButton>
      <ConnectionStatus />
    </div>
  </header>
</template>

<style scoped>
.fw-topbar {
  display: flex;
  gap: var(--fw-gap-lg, 16px);
  align-items: center;
  height: 100%;
  padding: 0 12px;
  border-bottom: 1px solid var(--fw-border, #333a45);
  background: var(--fw-surface, #1c2027);
}

.fw-topbar__brand {
  flex: 0 0 auto;
  min-width: 0;
}

.fw-topbar__name {
  overflow: hidden;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.fw-topbar__stats {
  display: flex;
  flex: 1 1 auto;
  gap: var(--fw-gap-lg, 16px);
  align-items: center;
  min-width: 0;
  overflow-x: auto;
}

.fw-topbar__aside {
  display: flex;
  flex: 0 0 auto;
  gap: var(--fw-gap, 8px);
  align-items: center;
}
</style>
