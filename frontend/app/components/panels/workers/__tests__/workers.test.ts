// The payroll panel: who is on it, at what rate, and the one refusal of GDD section 109.
//
// Owner: W5-F.
//
// The labels and the refusal are pure and are asserted directly. On the component the suite
// checks the three things a panel can get wrong on its own: that a status reaches the player
// as a word and not as an enum identifier, that the skill factor shown is the one the shared
// rule derives rather than a second calculation, and that a dismissal is offered exactly for
// the worker who is idle.

import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootMockClient,
  settle,
  teardownMockClient,
} from '~/components/panels/cell-inspector/__tests__/harness';
import {
  WORKER_STATUS_LABELS,
  derivedSkillFactor,
  fireBlockingCode,
  formatSkillFactor,
  homeOccupancy,
  isAtSkillCap,
  skillAfterNextTask,
} from '~/components/panels/workers/workerPresentation';
import WorkersPanel from '~/components/panels/workers/WorkersPanel.vue';
import { formatBp, formatRatePerGameHour } from '~/composables/useFormatting';
import { useShellUi } from '~/composables/useShellUi';
import { MOCK_FARM_ID } from '~/mock/world';
import {
  BuildingType,
  SKILL_CAP_BP,
  VALIDATION_MESSAGES,
  ValidationCode,
  WORKER_STATUSES,
  WorkerStatus,
  bp,
  fromWireMoney,
  skillFactor,
  type WorkerDto,
} from '~/shared/index';
import { useBuildingsStore } from '~/stores/buildings';
import { useWorkersStore } from '~/stores/workers';

function worker(overrides: Partial<WorkerDto> = {}): WorkerDto {
  return {
    id: 'worker-x',
    farmId: 'farm-1',
    homeId: 'building-home',
    name: 'Nombre Apellido',
    skillBp: bp(6_000),
    salaryPerGameHour: '18.0000',
    status: WorkerStatus.IDLE,
    currentTaskId: null,
    completedTaskCount: 3,
    hiredGameMs: '0',
    skillFactor: 0.8,
    ...overrides,
  };
}

describe('la presentacion de un trabajador', () => {
  it('los seis estados tienen etiqueta en castellano, incluidos los reservados', () => {
    for (const status of WORKER_STATUSES) {
      expect(WORKER_STATUS_LABELS[status]).not.toBe(status);
      expect(WORKER_STATUS_LABELS[status].length).toBeGreaterThan(2);
    }
  });

  it('solo se despide a quien esta ocioso (§109)', () => {
    expect(fireBlockingCode(worker())).toBeNull();
    expect(fireBlockingCode(worker({ status: WorkerStatus.WORKING }))).toBe(
      ValidationCode.WORKER_NOT_IDLE,
    );
    expect(fireBlockingCode(worker({ currentTaskId: 'task-1' }))).toBe(
      ValidationCode.WORKER_NOT_IDLE,
    );
  });

  it('el factor de habilidad es el de la regla compartida (§103)', () => {
    expect(derivedSkillFactor(0)).toBeCloseTo(0.5, 10);
    expect(derivedSkillFactor(5_000)).toBeCloseTo(0.75, 10);
    expect(derivedSkillFactor(10_000)).toBeCloseTo(1, 10);
    expect(formatSkillFactor(derivedSkillFactor(7_400))).toBe('x0.87');
  });

  it('la progresion se detiene en el techo de la seccion 103', () => {
    expect(skillAfterNextTask(7_000)).toBe(7_100);
    expect(isAtSkillCap(SKILL_CAP_BP)).toBe(true);
    expect(skillAfterNextTask(SKILL_CAP_BP)).toBe(SKILL_CAP_BP);
  });

  it('la ocupacion de vivienda cuenta la plantilla que la nombra (§108)', () => {
    const homes = [
      { id: 'home-a', capacity: 4 },
      { id: 'home-b', capacity: 2 },
    ];
    const payroll = [
      worker({ id: 'w1', homeId: 'home-a' }),
      worker({ id: 'w2', homeId: 'home-b' }),
      worker({ id: 'w3', homeId: 'otro' }),
    ];
    expect(homeOccupancy(homes, payroll)).toEqual({ used: 2, total: 6, free: 4 });
    expect(homeOccupancy([], payroll)).toEqual({ used: 0, total: 0, free: 0 });
  });
});

describe('el panel de trabajadores', () => {
  beforeEach(async () => {
    await bootMockClient();
  });

  afterEach(() => {
    teardownMockClient();
  });

  it('pinta la plantilla con habilidad, salario y estado legibles', async () => {
    const workers = useWorkersStore();
    const wrapper = mount(WorkersPanel);
    await settle();

    const text = wrapper.text();
    expect(workers.count).toBe(2);
    for (const row of workers.all) {
      expect(text).toContain(row.name);
      expect(text).toContain(formatBp(row.skillBp));
      expect(text).toContain(formatRatePerGameHour(fromWireMoney(row.salaryPerGameHour)));
      expect(text).toContain(WORKER_STATUS_LABELS[row.status]);
      // The factor the row carries and the one the panel derives are the same number.
      expect(row.skillFactor).toBeCloseTo(skillFactor(bp(row.skillBp)), 10);
      expect(text).toContain(formatSkillFactor(row.skillFactor));
    }
    expect(text).toContain(formatRatePerGameHour(workers.totalSalaryPerGameHour));
    wrapper.unmount();
  });

  it('muestra las plazas de vivienda y el coste salarial de la seccion 107', async () => {
    const buildings = useBuildingsStore();
    const workers = useWorkersStore();
    const wrapper = mount(WorkersPanel);
    await settle();
    const slots = homeOccupancy(
      buildings.ofType(MOCK_FARM_ID, BuildingType.WORKER_HOME),
      workers.ofFarm(MOCK_FARM_ID),
    );
    expect(wrapper.text()).toContain(`${slots.used} / ${slots.total}`);
    wrapper.unmount();
  });

  it('el trabajador de la tarea en curso no se despide y dice por que', async () => {
    const workers = useWorkersStore();
    const wrapper = mount(WorkersPanel);
    await settle();

    const busyIndex = workers.all.findIndex((row) => row.status === WorkerStatus.WORKING);
    expect(busyIndex).toBeGreaterThanOrEqual(0);
    const buttons = wrapper.findAll('button').filter((button) => button.text() === 'Despedir');
    expect(buttons[busyIndex]?.attributes('disabled')).toBeDefined();
    expect(buttons[busyIndex]?.attributes('title')).toBe(
      VALIDATION_MESSAGES[ValidationCode.WORKER_NOT_IDLE],
    );
    expect(wrapper.text()).toContain(VALIDATION_MESSAGES[ValidationCode.WORKER_NOT_IDLE]);
    wrapper.unmount();
  });

  it('despedir al ocioso lo retira de la plantilla y libera su plaza', async () => {
    const workers = useWorkersStore();
    const buildings = useBuildingsStore();
    const wrapper = mount(WorkersPanel);
    await settle();

    const idleIndex = workers.all.findIndex((row) => row.status === WorkerStatus.IDLE);
    const idleId = workers.all[idleIndex]?.id ?? '';
    const buttons = wrapper.findAll('button').filter((button) => button.text() === 'Despedir');
    await buttons[idleIndex]?.trigger('click');
    const confirm = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Confirmar despido');
    await confirm?.trigger('click');
    await settle();

    expect(workers.get(idleId)).toBeUndefined();
    expect(workers.count).toBe(1);
    expect(
      homeOccupancy(
        buildings.ofType(MOCK_FARM_ID, BuildingType.WORKER_HOME),
        workers.ofFarm(MOCK_FARM_ID),
      ).free,
    ).toBe(3);
    wrapper.unmount();
  });

  it('el acceso a los candidatos abre el pool en el panel lateral', async () => {
    const wrapper = mount(WorkersPanel);
    await settle();
    const button = wrapper.findAll('button').find((entry) => entry.text() === 'Ver candidatos');
    await button?.trigger('click');
    expect(useShellUi().sidePanel.value?.panelId).toBe('labor-pool');
    wrapper.unmount();
  });
});
