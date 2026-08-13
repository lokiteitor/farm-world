// The hiring pool: the three figures of a candidate and the two ways a hire is refused.
//
// Owner: W5-F.
//
// The order of the refusals is asserted on `hiring.ts`, which is where it lives. On the
// component the suite checks that the derived skill factor of GDD section 103 is shown next
// to the raw percentage, that the countdown to the refresh of GDD section 102 is a duration
// and not a dash, and that hiring until the worker homes are full turns the last candidate
// into the refusal of GDD section 108 rather than into a silent failure.

import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootMockClient,
  settle,
  teardownMockClient,
} from '~/components/panels/cell-inspector/__tests__/harness';
import {
  hireBlockingCode,
  payrollAfterHire,
  refreshCountdown,
} from '~/components/panels/labor-pool/hiring';
import LaborPoolPanel from '~/components/panels/labor-pool/LaborPoolPanel.vue';
import {
  derivedSkillFactor,
  formatSkillFactor,
} from '~/components/panels/workers/workerPresentation';
import { formatBp, formatRatePerGameHour } from '~/composables/useFormatting';
import {
  MS_PER_GAME_HOUR,
  Money,
  POOL_REFRESH_INTERVAL_GAME_HOURS,
  VALIDATION_MESSAGES,
  ValidationCode,
  bp,
  fromWireMoney,
  gameMs,
  skillFactor,
  type WorkerCandidateDto,
} from '~/shared/index';
import { useLaborPoolStore } from '~/stores/laborPool';
import { useWorkersStore } from '~/stores/workers';

function candidate(overrides: Partial<WorkerCandidateDto> = {}): WorkerCandidateDto {
  return {
    id: 'candidate-x',
    name: 'Nombre Apellido',
    skillBp: bp(6_200),
    askingSalaryPerGameHour: '18.0000',
    listedAtGameMs: '0',
    skillFactor: 0.81,
    ...overrides,
  };
}

describe('la decision de contratar', () => {
  it('un candidato que ya no esta en el pool responde antes que nada (§102)', () => {
    expect(
      hireBlockingCode({
        candidate: null,
        settledBalance: Money.fromUnits(-500),
        freeHomeSlots: 0,
      }),
    ).toBe(ValidationCode.CANDIDATE_NOT_AVAILABLE);
  });

  it('el saldo negativo bloquea antes que la vivienda', () => {
    expect(
      hireBlockingCode({
        candidate: candidate(),
        settledBalance: Money.fromUnits(-1),
        freeHomeSlots: 0,
      }),
    ).toBe(ValidationCode.SPENDING_BLOCKED_IN_DEBT);
  });

  it('sin plaza de vivienda no se contrata (§108)', () => {
    expect(
      hireBlockingCode({
        candidate: candidate(),
        settledBalance: Money.fromUnits(1_000),
        freeHomeSlots: 0,
      }),
    ).toBe(ValidationCode.HOME_CAPACITY_EXCEEDED);
    expect(
      hireBlockingCode({
        candidate: candidate(),
        settledBalance: Money.ZERO,
        freeHomeSlots: 1,
      }),
    ).toBeNull();
  });

  it('el coste salarial previsto suma el salario pedido (§107)', () => {
    expect(
      payrollAfterHire(Money.fromUnits(30), candidate({ askingSalaryPerGameHour: '12.5000' })),
    ).toBe(Money.fromString('42.5'));
  });

  it('la cuenta atras del refresco nunca es negativa', () => {
    const now = gameMs(1_000n);
    expect(refreshCountdown(gameMs(1_500n), now)).toBe(500n);
    expect(refreshCountdown(gameMs(900n), now)).toBe(0n);
    expect(refreshCountdown(null, now)).toBe(0n);
  });
});

describe('el panel del pool de contratacion', () => {
  beforeEach(async () => {
    await bootMockClient();
  });

  afterEach(() => {
    teardownMockClient();
  });

  it('pinta cada candidato con habilidad, factor y salario pedido', async () => {
    const pool = useLaborPoolStore();
    const wrapper = mount(LaborPoolPanel);
    await settle();

    const text = wrapper.text();
    expect(pool.count).toBe(3);
    for (const entry of pool.candidates) {
      expect(text).toContain(entry.name);
      expect(text).toContain(formatBp(entry.skillBp));
      expect(text).toContain(formatRatePerGameHour(fromWireMoney(entry.askingSalaryPerGameHour)));
      expect(text).toContain(formatSkillFactor(derivedSkillFactor(entry.skillBp)));
      expect(entry.skillFactor).toBeCloseTo(skillFactor(bp(entry.skillBp)), 10);
    }
    wrapper.unmount();
  });

  it('la cuenta atras del refresco es el intervalo del pool y no un guion', async () => {
    const pool = useLaborPoolStore();
    const wrapper = mount(LaborPoolPanel);
    await settle();
    expect(pool.nextRefresh).not.toBeNull();
    // The sample world lists the pool now, so the countdown is the whole interval.
    const remaining = refreshCountdown(pool.nextRefresh, gameMs(0n));
    expect(remaining).toBeGreaterThan(0n);
    expect(wrapper.text()).toMatch(/\d+ (d|h|min)/);
    expect(POOL_REFRESH_INTERVAL_GAME_HOURS).toBe(48);
    wrapper.unmount();
  });

  it('contratar retira al candidato del pool y lo pone en la plantilla', async () => {
    const pool = useLaborPoolStore();
    const workers = useWorkersStore();
    const wrapper = mount(LaborPoolPanel);
    await settle();

    const before = workers.totalSalaryPerGameHour;
    const chosen = pool.candidates[0];
    expect(chosen).toBeDefined();
    const buttons = wrapper.findAll('button').filter((button) => button.text() === 'Contratar');
    await buttons[0]?.trigger('click');
    await settle();

    expect(pool.count).toBe(2);
    expect(workers.count).toBe(3);
    expect(workers.all.some((row) => row.name === chosen?.name)).toBe(true);
    expect(workers.totalSalaryPerGameHour).toBe(
      Money.add(before, fromWireMoney(chosen?.askingSalaryPerGameHour ?? '0')),
    );
    wrapper.unmount();
  });

  it('al llenar la vivienda, el ultimo candidato queda bloqueado por la seccion 108', async () => {
    const pool = useLaborPoolStore();
    const workers = useWorkersStore();
    const wrapper = mount(LaborPoolPanel);
    await settle();

    // The sample world houses two of the four places, so two hires fill the home.
    for (let round = 0; round < 2; round += 1) {
      const button = wrapper.findAll('button').find((entry) => entry.text() === 'Contratar');
      await button?.trigger('click');
      await settle();
    }
    expect(workers.count).toBe(4);
    expect(pool.count).toBe(1);

    const last = wrapper.findAll('button').find((entry) => entry.text() === 'Contratar');
    expect(last?.attributes('disabled')).toBeDefined();
    expect(last?.attributes('title')).toBe(
      VALIDATION_MESSAGES[ValidationCode.HOME_CAPACITY_EXCEEDED],
    );
    expect(wrapper.text()).toContain(VALIDATION_MESSAGES[ValidationCode.HOME_CAPACITY_EXCEEDED]);
    wrapper.unmount();
  });

  it('la hora de juego del intervalo del pool son 48 horas exactas', () => {
    const interval = BigInt(POOL_REFRESH_INTERVAL_GAME_HOURS) * MS_PER_GAME_HOUR;
    expect(refreshCountdown(gameMs(interval), gameMs(0n))).toBe(interval);
  });
});
