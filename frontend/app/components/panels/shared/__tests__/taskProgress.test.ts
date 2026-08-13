// Where a task is at an instant, with the clock as a parameter.
//
// Owner: W6-T.
//
// The two properties this module exists for are asserted here, because both are statements
// about arithmetic and neither needs a rendered bar to be read.
//
// The instant is injected. Nothing in these tests reads the wall clock, and the module has
// no way of reading it either: game time is an extrapolation from an anchor with a rational
// multiplier (ADR-0007), so a countdown built on `Date.now` would part company with every
// other figure of the interface as soon as the multiplier changed.
//
// A finished task stops where it stopped. `endedGameMs` differs from the scheduled end
// exactly when the task was cancelled (GDD section 106), and a cancelled bar that kept
// filling would be drawing a completion that is not going to happen.

import { describe, expect, it } from 'vitest';
import {
  byMostRecentlyEnded,
  byNextToFinish,
  isRunning,
  scheduledDurationGameMs,
  taskEndGameMs,
  taskProgressBp,
  taskRemainingGameMs,
  workedGameHours,
} from '~/components/panels/shared/taskProgress';
import {
  MS_PER_GAME_HOUR,
  TaskOperation,
  TaskStatus,
  gameMs,
  type GameMs,
  type TaskDto,
} from '~/shared/index';

/** Start of the sample task, and the ten game hours it was scheduled for. */
const START = 1_000n * MS_PER_GAME_HOUR;
const DURATION = 10n * MS_PER_GAME_HOUR;

function at(gameHoursAfterStart: number): GameMs {
  return gameMs(START + BigInt(Math.round(gameHoursAfterStart * 3_600_000)));
}

function task(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: 'task-1',
    workerId: 'worker-1',
    machineIds: ['machine-tractor', 'machine-plow'],
    operation: TaskOperation.PLOW,
    status: TaskStatus.IN_PROGRESS,
    targetFieldId: 'field-1',
    targetForestPlotId: null,
    destinationFarmId: null,
    cropId: null,
    unitsAtStart: 120,
    effectiveWorkSpeedMilli: 12_000,
    reservedStorageUnits: null,
    startGameMs: START.toString(),
    scheduledEndGameMs: (START + DURATION).toString(),
    endedGameMs: null,
    cancelable: true,
    // Correct at the instant of the reply only, and deliberately absurd here: nothing
    // below may read it.
    progressBp: 9_999,
    ...overrides,
  };
}

describe('el progreso de una tarea', () => {
  it('avanza con el reloj inyectado y no con el que trae la fila', () => {
    const row = task();
    expect(taskProgressBp(row, at(0))).toBe(0);
    expect(taskProgressBp(row, at(2.5))).toBe(2_500);
    expect(taskProgressBp(row, at(5))).toBe(5_000);
    expect(taskProgressBp(row, at(10))).toBe(10_000);
    // The figure of the row is never consulted, in either direction.
    expect(taskProgressBp(row, at(1))).not.toBe(row.progressBp);
  });

  it('no retrocede ni se pasa de cien por cien', () => {
    const row = task();
    expect(taskProgressBp(row, at(-5))).toBe(0);
    expect(taskProgressBp(row, at(40))).toBe(10_000);
  });

  it('una tarea cancelada se congela donde se quedo (§106)', () => {
    const cancelled = task({
      status: TaskStatus.CANCELED,
      endedGameMs: (START + 3n * MS_PER_GAME_HOUR).toString(),
    });
    expect(taskProgressBp(cancelled, at(3))).toBe(3_000);
    // Hours later the bar is still at the fraction it reached.
    expect(taskProgressBp(cancelled, at(9))).toBe(3_000);
    expect(taskProgressBp(cancelled, at(500))).toBe(3_000);
    expect(taskEndGameMs(cancelled)).toBe(START + 3n * MS_PER_GAME_HOUR);
  });

  it('una tarea completada llega al final y se queda ahi', () => {
    const done = task({
      status: TaskStatus.COMPLETED,
      endedGameMs: (START + DURATION).toString(),
    });
    expect(taskProgressBp(done, at(10))).toBe(10_000);
    expect(taskProgressBp(done, at(80))).toBe(10_000);
  });

  it('una duracion nula no divide por cero', () => {
    const instant = task({ scheduledEndGameMs: START.toString() });
    expect(taskProgressBp(instant, at(0))).toBe(10_000);
    expect(scheduledDurationGameMs(instant)).toBe(0n);
  });
});

describe('la cuenta atras', () => {
  it('descuenta con el reloj y nunca informa de un tiempo negativo', () => {
    const row = task();
    expect(taskRemainingGameMs(row, at(0))).toBe(DURATION);
    expect(taskRemainingGameMs(row, at(6))).toBe(4n * MS_PER_GAME_HOUR);
    // The completion job has not run yet: the task reads "ahora" and not a negative figure,
    // which would be a fact about the queue and not about the task.
    expect(taskRemainingGameMs(row, at(13))).toBe(0n);
  });

  it('una tarea que ya no corre no tiene cuenta atras', () => {
    expect(taskRemainingGameMs(task({ status: TaskStatus.COMPLETED }), at(1))).toBeNull();
    expect(taskRemainingGameMs(task({ status: TaskStatus.CANCELED }), at(1))).toBeNull();
    expect(isRunning(task())).toBe(true);
    expect(isRunning(task({ status: TaskStatus.CANCELED }))).toBe(false);
  });
});

describe('las horas ya trabajadas, que es lo que la cancelacion cuesta', () => {
  it('son las transcurridas hasta el instante, acotadas por el fin real', () => {
    const row = task();
    expect(workedGameHours(row, at(0))).toBe(0);
    expect(workedGameHours(row, at(4.5))).toBeCloseTo(4.5, 10);
    const cancelled = task({
      status: TaskStatus.CANCELED,
      endedGameMs: (START + 3n * MS_PER_GAME_HOUR).toString(),
    });
    expect(workedGameHours(cancelled, at(9))).toBeCloseTo(3, 10);
  });

  it('nunca son negativas antes de empezar', () => {
    expect(workedGameHours(task(), at(-2))).toBe(0);
  });
});

describe('el orden de las dos listas', () => {
  it('las activas se ordenan por la que termina antes, con desempate estable', () => {
    const soon = task({ id: 'b', scheduledEndGameMs: (START + 2n * MS_PER_GAME_HOUR).toString() });
    const late = task({ id: 'a', scheduledEndGameMs: (START + 9n * MS_PER_GAME_HOUR).toString() });
    const tie = task({ id: 'c', scheduledEndGameMs: (START + 2n * MS_PER_GAME_HOUR).toString() });
    expect([late, tie, soon].sort(byNextToFinish).map((row) => row.id)).toEqual(['b', 'c', 'a']);
  });

  it('el historial se ordena por la que termino mas tarde, contando el fin real', () => {
    const cancelledEarly = task({
      id: 'a',
      status: TaskStatus.CANCELED,
      endedGameMs: (START + 1n * MS_PER_GAME_HOUR).toString(),
    });
    const completed = task({
      id: 'b',
      status: TaskStatus.COMPLETED,
      endedGameMs: (START + DURATION).toString(),
    });
    expect([cancelledEarly, completed].sort(byMostRecentlyEnded).map((row) => row.id)).toEqual([
      'b',
      'a',
    ]);
  });
});
