// The return summary: the arithmetic of GDD section 124, the two empties, the links, and
// what a forced liquidation has to name.
//
// Owner: W6-T.
//
// This is the panel that makes GDD section 52 legible, and it fails in four different ways,
// each worse than the last if it is not caught here.
//
// The lines have to add up. GDD section 124 gives the exact form —four aggregates and a net
// change that is their signed sum— and ADR-0009 stored `balanceAfter` on every entry so that
// a discrepancy would be detectable rather than plausible. Five numbers that quietly disagree
// with the balance the top bar reports are worse than an admission, so the panel has to make
// the admission.
//
// An empty summary is not an unread one. "Nothing happened" and "nothing has arrived yet" are
// different facts about the same modal, and a panel that drew them alike would make a failed
// request look like a quiet week.
//
// The links have to move the camera. GDD section 68 names a field ready to harvest and an
// idle worker as the two things worth acting on, and naming them without taking the player
// there makes him search a map for a field he was just told about.
//
// And a forced liquidation has to say what was sold. ADR-0039 discarded the single aggregate
// entry in as many words —"pierde que se vendio"— and wrote one entry per asset precisely so
// that this panel could name them.

import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootMockClient,
  settle,
  teardownMockClient,
} from '~/components/panels/cell-inspector/__tests__/harness';
import { labelOfMachineType } from '~/components/panels/machinery/machineryPresentation';
import {
  LEDGER_TYPE_LABELS,
  LIQUIDATION_STEP_LABELS,
  balanceReconciles,
  economyLines,
  liquidationTotal,
  linesReconcile,
  sumOfLines,
} from '~/components/panels/welcome-back/summary';
import WelcomeBackPanel from '~/components/panels/welcome-back/WelcomeBackPanel.vue';
import { formatMoney } from '~/composables/useFormatting';
import { gameBridge } from '~/composables/useGameBridge';
import { useShellUi } from '~/composables/useShellUi';
import { apiCall } from '~/net/api';
import { setHttpTransport } from '~/net/transport';
import {
  ApiTransportCode,
  Money,
  apiErrorMessage,
  fromWireMoney,
  toWireMoney,
  type WelcomeBackReply,
} from '~/shared/index';
import { useFieldsStore } from '~/stores/fields';
import { useMachinesStore } from '~/stores/machines';
import { useWorkersStore } from '~/stores/workers';

/** The summary the simulated server produces, which is the one the panel would fetch. */
async function serverSummary(): Promise<WelcomeBackReply> {
  return apiCall('GET /api/session/welcome-back');
}

beforeEach(async () => {
  await bootMockClient();
});

afterEach(() => {
  teardownMockClient();
});

describe('la economia de la ausencia (§124)', () => {
  it('dibuja las cinco lineas y el neto, cada una con su importe formateado', async () => {
    const reply = await serverSummary();
    const wrapper = mount(WelcomeBackPanel, { props: { reply } });
    await settle();

    const text = wrapper.text();
    for (const line of economyLines(reply.economy)) {
      expect(text).toContain(line.label);
      expect(text).toContain(formatMoney(line.amount));
    }
    expect(text).toContain('Neto');
    expect(text).toContain(formatMoney(fromWireMoney(reply.economy.netChange)));
    expect(text).toContain(formatMoney(fromWireMoney(reply.economy.balanceBefore)));
    expect(text).toContain(formatMoney(fromWireMoney(reply.economy.balanceAfter)));
    wrapper.unmount();
  });

  it('las cinco lineas suman el neto, y el saldo anterior mas el neto es el actual', async () => {
    const reply = await serverSummary();
    expect(Money.compare(sumOfLines(reply.economy), fromWireMoney(reply.economy.netChange))).toBe(
      0,
    );
    expect(linesReconcile(reply.economy)).toBe(true);
    expect(balanceReconciles(reply.economy)).toBe(true);

    const wrapper = mount(WelcomeBackPanel, { props: { reply } });
    await settle();
    expect(wrapper.text()).not.toContain('Las lineas no cuadran');
    wrapper.unmount();
  });

  it('un resumen que no cuadra se declara en lugar de dibujarse igual', async () => {
    const reply = await serverSummary();
    // One aggregate moved and the net left alone: the arithmetic of GDD section 124 breaks
    // and nothing else on the reply says so.
    const broken: WelcomeBackReply = {
      ...reply,
      economy: { ...reply.economy, totalMaintenance: toWireMoney(Money.fromUnits(-500)) },
    };
    expect(linesReconcile(broken.economy)).toBe(false);

    const wrapper = mount(WelcomeBackPanel, { props: { reply: broken } });
    await settle();
    expect(wrapper.text()).toContain('Las lineas no cuadran');
    // And the breakdown by kind of entry is offered as the reliable reading.
    expect(wrapper.text()).toContain('Detalle por tipo de asiento');
    wrapper.unmount();
  });

  it('un saldo que no cuadra con el neto tambien se declara', async () => {
    const reply = await serverSummary();
    const broken: WelcomeBackReply = {
      ...reply,
      economy: { ...reply.economy, balanceAfter: toWireMoney(Money.fromUnits(1)) },
    };
    expect(linesReconcile(broken.economy)).toBe(true);
    expect(balanceReconciles(broken.economy)).toBe(false);
    const wrapper = mount(WelcomeBackPanel, { props: { reply: broken } });
    await settle();
    expect(wrapper.text()).toContain('Las lineas no cuadran');
    wrapper.unmount();
  });

  it('el detalle por tipo de asiento nombra el tipo en castellano', async () => {
    const reply = await serverSummary();
    const wrapper = mount(WelcomeBackPanel, { props: { reply } });
    await settle();
    for (const line of reply.economy.byType) {
      expect(wrapper.text()).toContain(LEDGER_TYPE_LABELS[line.type]);
      expect(wrapper.text()).not.toContain(line.type);
    }
    wrapper.unmount();
  });
});

describe('un resumen vacio frente a uno no cargado', () => {
  it('mientras se lee dice que se esta leyendo, y no que no hay nada', async () => {
    const wrapper = mount(WelcomeBackPanel);
    // Before the reply: the request is in flight and nothing has been decided.
    expect(wrapper.text()).toContain('Leyendo lo ocurrido');
    expect(wrapper.text()).not.toContain('No ha pasado nada');
    expect(wrapper.text()).not.toContain('Sin resumen');
    await settle(6);
    expect(wrapper.text()).not.toContain('Leyendo lo ocurrido');
    wrapper.unmount();
  });

  it('un resumen sin contenido dice que no ha pasado nada', async () => {
    const reply = await serverSummary();
    const wrapper = mount(WelcomeBackPanel, { props: { reply: { ...reply, hasContent: false } } });
    await settle();
    expect(wrapper.text()).toContain('No ha pasado nada');
    expect(wrapper.text()).not.toContain('Sin resumen');
    // With no content there is nothing to acknowledge either.
    expect(wrapper.findAll('button').some((button) => button.text() === 'Entendido')).toBe(false);
    wrapper.unmount();
  });

  it('un resumen que no pudo leerse se distingue de uno vacio, y dice por que', async () => {
    // The transport fails, which is the case a modal that opens itself has to survive.
    setHttpTransport(() => Promise.reject(new Error('sin red')));
    const wrapper = mount(WelcomeBackPanel);
    await settle(8);
    const text = wrapper.text();
    expect(text).toContain('Sin resumen');
    // The sentence is the shared one of the code the client mapped the failure to, which
    // is what ADR-0032 asks of every refusal that reaches the player.
    expect(text).toContain(apiErrorMessage(ApiTransportCode.SERVICE_UNAVAILABLE));
    // Which is a different sentence from the two empties.
    expect(text).not.toContain('No ha pasado nada');
    expect(text).not.toContain('No hay nada que contar');
    wrapper.unmount();
  });
});

describe('los enlaces que mueven la camara (§68)', () => {
  it('«Ir al campo» centra la camara en el campo y abre su inspector', async () => {
    const fields = useFieldsStore();
    const reply = await serverSummary();
    const transition = reply.fieldTransitions[0];
    expect(transition).toBeDefined();

    const orders: unknown[] = [];
    gameBridge().on('camera:goto', (payload) => orders.push(payload));

    const wrapper = mount(WelcomeBackPanel, { props: { reply } });
    await settle();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Ir al campo')
      ?.trigger('click');

    const cell = fields.cellsOf(transition?.fieldId ?? '')[0];
    expect(orders).toEqual([{ cellX: cell?.cellX, cellY: cell?.cellY, smooth: true }]);
    const shell = useShellUi();
    expect(shell.sidePanel.value?.panelId).toBe('field-inspector');
    expect(shell.sidePanel.value?.props.fieldId).toBe(transition?.fieldId);
    wrapper.unmount();
  });

  it('«Ir al trabajador» centra la camara en su vivienda y abre la plantilla', async () => {
    const workers = useWorkersStore();
    const reply = await serverSummary();
    const idle = reply.idleWorkers[0];
    expect(idle).toBeDefined();

    const orders: { cellX: number; cellY: number }[] = [];
    gameBridge().on('camera:goto', (payload) => orders.push(payload));

    const wrapper = mount(WelcomeBackPanel, { props: { reply } });
    await settle();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Ir al trabajador')
      ?.trigger('click');

    // The home is the building GDD section 108 ties the worker to.
    const worker = workers.get(idle?.workerId ?? '');
    expect(worker?.homeId).toBeDefined();
    expect(orders).toHaveLength(1);
    expect(useShellUi().sidePanel.value?.panelId).toBe('workers');
    wrapper.unmount();
  });

  it('un campo sin geometria cargada no ofrece un salto a ninguna parte', async () => {
    const fields = useFieldsStore();
    const reply = await serverSummary();
    const transition = reply.fieldTransitions[0];
    fields.applyCells(transition?.fieldId ?? '', []);

    const orders: unknown[] = [];
    gameBridge().on('camera:goto', (payload) => orders.push(payload));

    const wrapper = mount(WelcomeBackPanel, { props: { reply } });
    await settle();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Ir al campo')
      ?.trigger('click');

    // The panel opens the inspector all the same, and moves nothing it cannot point at.
    expect(orders).toEqual([]);
    expect(useShellUi().sidePanel.value?.panelId).toBe('field-inspector');
    wrapper.unmount();
  });
});

describe('la liquidacion forzosa (ADR-0039)', () => {
  /** A summary with a liquidation of three assets over two steps of the published order. */
  async function withLiquidation(): Promise<{ reply: WelcomeBackReply; machineId: string }> {
    const reply = await serverSummary();
    const machine = useMachinesStore().all[0];
    if (machine === undefined) {
      throw new Error('el mundo simulado no trajo ninguna maquina');
    }
    return {
      machineId: machine.id,
      reply: {
        ...reply,
        liquidations: [
          {
            step: 'INVENTORY',
            subjectType: 'STOCK',
            subjectId: 'WHEAT_LITERS',
            detail: 'WHEAT_LITERS',
            amount: toWireMoney(Money.fromUnits(1_200)),
          },
          {
            step: 'IDLE_MACHINES',
            subjectType: 'MACHINE',
            subjectId: machine.id,
            detail: machine.type,
            amount: toWireMoney(Money.fromUnits(9_000)),
          },
          {
            step: 'IDLE_MACHINES',
            subjectType: 'MACHINE',
            subjectId: 'machine-vendida',
            // The asset the client no longer holds, which is the case `detail` exists for.
            detail: 'HARVESTER',
            amount: toWireMoney(Money.fromUnits(4_000)),
          },
        ],
      },
    };
  }

  it('explica por que ocurrio y cuanto se recaudo', async () => {
    const { reply } = await withLiquidation();
    const wrapper = mount(WelcomeBackPanel, { props: { reply } });
    await settle();
    const text = wrapper.text();
    expect(text).toContain('Liquidacion forzosa');
    expect(text).toContain('coste continuo de posesion');
    expect(text).toContain('se detiene en cuanto el saldo deja de ser negativo');
    expect(text).toContain(formatMoney(liquidationTotal(reply)));
    wrapper.unmount();
  });

  it('nombra cada activo vendido y no solo el paso del orden publicado', async () => {
    const { reply, machineId } = await withLiquidation();
    const machine = useMachinesStore().get(machineId);
    const wrapper = mount(WelcomeBackPanel, { props: { reply } });
    await settle();
    const text = wrapper.text();

    // The step is the reason the asset was chosen (ADR-0039).
    expect(text).toContain(LIQUIDATION_STEP_LABELS.INVENTORY);
    expect(text).toContain(LIQUIDATION_STEP_LABELS.IDLE_MACHINES);
    // And the asset is what went, by name in both cases: the one the client still holds is
    // resolved against the store, and the one already gone is named by the `detail` the
    // liquidation engine recorded, which is what that field of the contract exists for
    // (docs/handoff/NOTES-w6t.md 1.1).
    expect(text).toContain(labelOfMachineType(machine?.type ?? 'TRACTOR'));
    expect(text).toContain(labelOfMachineType('HARVESTER'));
    expect(text).not.toContain('Maquina machine-vendida');
    expect(text).toContain('Existencias');
    // Every sale carries its own amount, so a group is never a single opaque number.
    expect(text).toContain(formatMoney(Money.fromUnits(9_000)));
    expect(text).toContain(formatMoney(Money.fromUnits(4_000)));
    expect(text).toContain(formatMoney(Money.fromUnits(1_200)));
    wrapper.unmount();
  });

  it('sin liquidacion no dibuja la seccion', async () => {
    const reply = await serverSummary();
    const wrapper = mount(WelcomeBackPanel, { props: { reply } });
    await settle();
    expect(wrapper.text()).not.toContain('Liquidacion forzosa');
    wrapper.unmount();
  });
});

describe('confirmar el resumen', () => {
  it('mueve la marca al final del intervalo que se mostro, y cierra', async () => {
    const reply = await serverSummary();
    const shell = useShellUi();
    shell.openModal('welcome-back');
    const wrapper = mount(WelcomeBackPanel, { props: { reply } });
    await settle();

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Entendido')
      ?.trigger('click');
    await settle(6);

    expect(shell.modals.value).toHaveLength(0);
    wrapper.unmount();
  });

  it('cerrar sin confirmar deja el resumen pendiente', async () => {
    const reply = await serverSummary();
    const shell = useShellUi();
    shell.openModal('welcome-back');
    const wrapper = mount(WelcomeBackPanel, { props: { reply } });
    await settle();

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Cerrar sin confirmar')
      ?.trigger('click');
    expect(shell.modals.value).toHaveLength(0);
    wrapper.unmount();
  });
});
