// The notice tray.
//
// Owner: W4-E.
//
// Two things are pinned. A notice that carries a validation code is shown with the message of
// the shared table and never with the text of the wire, which is the rule that keeps the
// reason a control is disabled and the reason a notice gives from being worded differently for
// the same code (plan section 8). And a refused request appears with its own code translated,
// because from the point of view of the player a refusal and a consequence are the same
// question: what happened and why.

import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootMockClient,
  settle,
  teardownMockClient,
} from '~/components/panels/cell-inspector/__tests__/harness';
import NoticesPanel from '~/components/panels/notices/NoticesPanel.vue';
import { gameBridge } from '~/composables/useGameBridge';
import { useShellUi } from '~/composables/useShellUi';
import { ValidationCode, apiErrorMessage, type NoticeDto } from '~/shared/index';
import { useNoticesStore } from '~/stores/notices';
import { usePendingStore } from '~/stores/pending';

function notice(overrides: Partial<NoticeDto> = {}): NoticeDto {
  return {
    kind: 'GENERIC',
    severity: 'INFO',
    code: null,
    message: 'Aviso de ejemplo.',
    details: null,
    atGameMs: '0',
    subjectType: null,
    subjectId: null,
    ...overrides,
  };
}

beforeEach(async () => {
  await bootMockClient();
});

afterEach(() => {
  teardownMockClient();
});

describe('el panel de avisos', () => {
  it('pinta los avisos que trajo la instantanea con su tipo en castellano', async () => {
    const wrapper = mount(NoticesPanel);
    await settle();
    expect(wrapper.text()).toContain('Transicion de campo');
    expect(wrapper.text()).toContain('parcela norte');
    wrapper.unmount();
  });

  it('traduce el aviso que lleva codigo con la tabla compartida y no con el texto del cable', async () => {
    const notices = useNoticesStore();
    notices.applyNotice(
      notice({
        kind: 'HARVEST_OVERFLOW',
        severity: 'WARNING',
        code: ValidationCode.STORAGE_CAPACITY_EXCEEDED,
        message: 'texto del servidor que el cliente no debe mostrar',
      }),
      Date.now(),
    );
    const wrapper = mount(NoticesPanel);
    await settle();

    expect(wrapper.text()).toContain(apiErrorMessage(ValidationCode.STORAGE_CAPACITY_EXCEEDED));
    expect(wrapper.text()).not.toContain('texto del servidor');
    expect(wrapper.text()).toContain('Silo desbordado');
    wrapper.unmount();
  });

  it('filtra por tipo y por severidad', async () => {
    const notices = useNoticesStore();
    notices.applyNotice(
      notice({ kind: 'DEBT_ENTERED', severity: 'WARNING', message: 'Saldo negativo.' }),
      Date.now(),
    );
    const wrapper = mount(NoticesPanel);
    await settle();
    expect(wrapper.text()).toContain('Saldo negativo.');

    await wrapper.find('input[type="checkbox"]').setValue(true);
    expect(wrapper.text()).toContain('Saldo negativo.');
    expect(wrapper.text()).not.toContain('parcela norte');
    wrapper.unmount();
  });

  it('descarta uno y descarta todos', async () => {
    const notices = useNoticesStore();
    notices.applyNotice(notice({ message: 'Primero.' }), Date.now());
    notices.applyNotice(notice({ message: 'Segundo.' }), Date.now());
    const wrapper = mount(NoticesPanel);
    await settle();
    const before = notices.unreadCount;

    const dismiss = wrapper.findAll('button').find((candidate) => candidate.text() === 'Descartar');
    await dismiss?.trigger('click');
    expect(notices.unreadCount).toBe(before - 1);

    const all = wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Descartar todos');
    await all?.trigger('click');
    expect(notices.unreadCount).toBe(0);
    expect(wrapper.text()).toContain('Sin avisos');
    wrapper.unmount();
  });

  it('lista las peticiones rechazadas con el mensaje de su codigo', async () => {
    const pending = usePendingStore();
    pending.start({
      idempotencyKey: 'attempt-1',
      routeKey: 'POST /api/land/purchase',
      startedAtRealMs: Date.now(),
    });
    pending.fail('attempt-1', ValidationCode.INSUFFICIENT_FUNDS, Date.now());

    const wrapper = mount(NoticesPanel);
    await settle();
    expect(wrapper.text()).toContain('Peticiones rechazadas');
    expect(wrapper.text()).toContain(apiErrorMessage(ValidationCode.INSUFFICIENT_FUNDS));
    expect(wrapper.text()).toContain('POST /api/land/purchase');
    wrapper.unmount();
  });

  it('salta al campo del que habla el aviso', async () => {
    const orders: unknown[] = [];
    gameBridge().on('camera:goto', (payload) => orders.push(payload));

    const wrapper = mount(NoticesPanel);
    await settle();
    const jump = wrapper.findAll('button').find((candidate) => candidate.text() === 'Ir al campo');
    expect(jump).toBeDefined();
    await jump?.trigger('click');

    expect(useShellUi().sidePanel.value?.panelId).toBe('field-inspector');
    expect(orders).toHaveLength(1);
    wrapper.unmount();
  });
});
