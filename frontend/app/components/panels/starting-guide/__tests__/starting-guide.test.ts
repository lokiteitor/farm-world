// The starting guide: the sequence of GDD section 120 and the figures of GDD section 117.
//
// Owner: W5-F.
//
// Most of this suite is about the derivation, because that is where the guide could be
// wrong in a way nobody would notice: the sequence and its instants come from
// `shared/rules/balance.ts`, so what has to be checked is that they reproduce the numbers
// the GDD publishes for the same scenario, and that the recommendation of GDD section 120
// falls out of the timeline rather than being asserted by the panel.
//
// On the component the suite checks the one behaviour that is not pure: that a step is
// ticked from the stores rather than from a stored progress mark, and that a machine the
// cycle does not need yet is shown as early rather than as missing.

import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootMockClient,
  settle,
  teardownMockClient,
} from '~/components/panels/cell-inspector/__tests__/harness';
import { labelOfMachineType } from '~/components/panels/machinery/machineryPresentation';
import StartingGuidePanel from '~/components/panels/starting-guide/StartingGuidePanel.vue';
import {
  StepKind,
  StepStatus,
  evaluateSequence,
  isStepDone,
  startingBudget,
  startingSequence,
  stepStatus,
  type HoldingSituation,
} from '~/components/panels/starting-guide/steps';
import { formatMoney } from '~/composables/useFormatting';
import { BuildingType, CropCycleState, MachineType, Money, STARTING_CAPITAL } from '~/shared/index';

const EMPTY: HoldingSituation = {
  hasFarm: false,
  buildingTypes: [],
  fieldCount: 0,
  workerCount: 0,
  ownedMachineTypes: [],
  furthestFieldState: null,
};

function situation(overrides: Partial<HoldingSituation> = {}): HoldingSituation {
  return { ...EMPTY, ...overrides };
}

describe('la secuencia de arranque', () => {
  const steps = startingSequence();

  /** The step of one machine type. Throws rather than asserting on `undefined`. */
  function machineStep(type: MachineType) {
    const found = steps.find((step) => step.machineType === type);
    if (found === undefined) {
      throw new Error(`La secuencia no incluye ${type}`);
    }
    return found;
  }

  function buildingStep(type: BuildingType) {
    const found = steps.find((step) => step.buildingType === type);
    if (found === undefined) {
      throw new Error(`La secuencia no incluye ${type}`);
    }
    return found;
  }

  it('cubre el setup minimo de la seccion 117 y nada mas', () => {
    expect(steps.filter((step) => step.kind === StepKind.BUILDING)).toHaveLength(3);
    // The five machines of GDD section 117, each once: the tractor pulls two implements.
    expect(
      steps.filter((step) => step.kind === StepKind.MACHINE).map((step) => step.machineType),
    ).toEqual([
      MachineType.TRACTOR,
      MachineType.PLOW,
      MachineType.SEEDER,
      MachineType.HARVESTER,
      MachineType.TRAILER,
    ]);
    // The workshop is postponed in GDD section 117 and the cultivator is not needed for wheat.
    expect(steps.some((step) => step.buildingType === BuildingType.WORKSHOP)).toBe(false);
    expect(steps.some((step) => step.machineType === MachineType.CULTIVATOR)).toBe(false);
    expect(steps).toHaveLength(11);
  });

  it('la cosechadora no hace falta hasta unas 230 horas de ciclo (§120)', () => {
    expect(machineStep(MachineType.TRACTOR).neededAtGameHours).toBe(0);
    expect(machineStep(MachineType.HARVESTER).neededAtGameHours).toBeGreaterThan(200);
    expect(machineStep(MachineType.HARVESTER).neededAtGameHours).toBeLessThan(250);
    expect(machineStep(MachineType.HARVESTER).dueFromState).toBe(CropCycleState.READY_TO_HARVEST);
  });

  it('sin campo, solo la maquinaria de la primera operacion esta en su momento', () => {
    const evaluated = evaluateSequence(situation({ hasFarm: true }));
    const byType = new Map(
      evaluated
        .filter((row) => row.step.machineType !== null)
        .map((row) => [row.step.machineType, row.status]),
    );
    expect(byType.get(MachineType.TRACTOR)).toBe(StepStatus.DUE);
    expect(byType.get(MachineType.PLOW)).toBe(StepStatus.DUE);
    expect(byType.get(MachineType.SEEDER)).toBe(StepStatus.LATER);
    expect(byType.get(MachineType.HARVESTER)).toBe(StepStatus.LATER);
    expect(byType.get(MachineType.TRAILER)).toBe(StepStatus.LATER);
  });

  it('el estado del campo hace avanzar la secuencia', () => {
    const plowed = situation({ hasFarm: true, furthestFieldState: CropCycleState.PLOWED });
    expect(stepStatus(machineStep(MachineType.SEEDER), plowed)).toBe(StepStatus.DUE);
    expect(stepStatus(machineStep(MachineType.HARVESTER), plowed)).toBe(StepStatus.LATER);

    const ready = situation({ hasFarm: true, furthestFieldState: CropCycleState.READY_TO_HARVEST });
    expect(stepStatus(machineStep(MachineType.HARVESTER), ready)).toBe(StepStatus.DUE);
  });

  it('un paso ya cumplido se lee del estado de la explotacion', () => {
    const garage = buildingStep(BuildingType.GARAGE);
    expect(isStepDone(garage, EMPTY)).toBe(false);
    expect(isStepDone(garage, situation({ buildingTypes: [BuildingType.GARAGE] }))).toBe(true);
    expect(
      isStepDone(
        machineStep(MachineType.TRACTOR),
        situation({ ownedMachineTypes: [MachineType.TRACTOR] }),
      ),
    ).toBe(true);
  });

  it('reproduce el presupuesto de la seccion 117 desde los catalogos', () => {
    const budget = startingBudget();
    expect(budget.setup.landCells).toBe(330);
    expect(budget.setup.land).toBe(Money.fromUnits(39_600));
    expect(budget.setup.buildings).toBe(Money.fromUnits(23_000));
    expect(budget.setup.machinery).toBe(Money.fromUnits(83_500));
    expect(budget.setup.total).toBe(Money.fromUnits(146_100));
    expect(budget.startingCapital).toBe(STARTING_CAPITAL);
    expect(budget.cushion).toBe(Money.fromUnits(13_900));
  });

  it('la compra escalonada ahorra coste de posesion en el ciclo (§118 y §120)', () => {
    const budget = startingBudget();
    expect(Money.compare(budget.holdingStaggered, budget.holdingUpfront)).toBe(-1);
    expect(Money.isNegative(budget.saving)).toBe(false);
    expect(Money.isZero(budget.saving)).toBe(false);
    expect(budget.cycleGameHours).toBeGreaterThan(300);
  });
});

describe('el panel de guia de arranque', () => {
  beforeEach(async () => {
    await bootMockClient();
  });

  afterEach(() => {
    teardownMockClient();
  });

  it('marca como hecho lo que el mundo de ejemplo ya tiene', async () => {
    const wrapper = mount(StartingGuidePanel);
    await settle();
    // Farm, three buildings, field, worker and four of the five machines are in place.
    expect(wrapper.text()).toContain('10 / 11');
    expect(wrapper.text()).toContain('Hecho');
    wrapper.unmount();
  });

  it('el remolque que falta se presenta como todavia no, no como pendiente', async () => {
    const wrapper = mount(StartingGuidePanel);
    await settle();
    const text = wrapper.text();
    expect(text).toContain('Todavia no');
    expect(text).toContain(labelOfMachineType(MachineType.TRAILER).toLocaleLowerCase('es-ES'));
    expect(text).toContain('comprarlo ahora solo paga mantenimiento');
    wrapper.unmount();
  });

  it('publica las cifras de las secciones 117 a 120 con el formato de la interfaz', async () => {
    const budget = startingBudget();
    const wrapper = mount(StartingGuidePanel);
    await settle();
    const text = wrapper.text();
    expect(text).toContain(formatMoney(budget.setup.total));
    expect(text).toContain(formatMoney(budget.cushion));
    expect(text).toContain(formatMoney(budget.holdingUpfront));
    expect(text).toContain(formatMoney(budget.holdingStaggered));
    expect(text).toContain(formatMoney(budget.saving));
    wrapper.unmount();
  });
});
