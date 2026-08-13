// The return summary, read as figures rather than as prose.
//
// Owner: W6-D. Read by the return summary panel and by its suite.
//
// GDD section 68 sketches the summary and GDD section 124 gives the exact analytical form:
// four aggregates, each an integral over the interval, and a net change that is their signed
// sum. The route already computes them (`shared/api/schemas/state.ts`), so this module does
// not recompute anything. What it does is the one thing a summary of money must do and a
// template cannot: check that the lines add up, and say so when they do not.
//
// The check is not defensive programming. ADR-0009 made the ledger auditable by storing
// `balanceAfter` on every entry precisely so that a discrepancy is detectable rather than
// plausible, and the summary is the first place a player would notice one. A summary whose
// lines do not reconcile is a bug in the accrual, and showing "the lines do not add up" is
// strictly better than showing five numbers that quietly disagree with the balance the top
// bar reports.
//
// Two reconciliations, and they are different questions. `linesReconcile` asks whether the
// five aggregates sum to the net change, which is the arithmetic of GDD section 124.
// `balanceReconciles` asks whether the balance before plus the net change is the balance
// after, which is the invariant of ADR-0009 carried into the interval.

import {
  type LedgerType,
  Money,
  fromWireMoney,
  type WelcomeBackEconomy,
  type WelcomeBackLedgerLine,
  type WelcomeBackReply,
} from '~/shared/index';

/**
 * Name of each kind of ledger entry, in Spanish.
 *
 * It belongs with the rest of the vocabulary in `legend/vocabulary.ts`, which is the module
 * ADR-0037 made the home of the words of this interface; that file is owned by W4-E and is
 * not this agent's to write, so the table lives here and the move is recorded in
 * `docs/handoff/NOTES-w6d.md`. It is a total record over the enum, so a kind added to
 * `shared/domain/enums.ts` stops the compilation instead of reaching the player as an
 * identifier.
 */
export const LEDGER_TYPE_LABELS: Readonly<Record<LedgerType, string>> = {
  LAND_PURCHASE: 'Compra de tierra',
  LAND_SALE: 'Venta de tierra',
  BUILDING_PURCHASE: 'Construccion',
  BUILDING_SALE: 'Venta de edificio',
  MACHINE_PURCHASE: 'Compra de maquinaria',
  MACHINE_SALE: 'Venta de maquinaria',
  MACHINE_REPAIR: 'Reparacion',
  CROP_SALE: 'Venta de cosecha',
  WOOD_SALE: 'Venta de madera',
  HARVEST_WASTE: 'Cosecha desperdiciada',
  WORKER_WAGES: 'Salarios',
  MACHINE_MAINTENANCE: 'Mantenimiento',
  MACHINE_OPERATING: 'Operacion',
  OVERDRAFT_INTEREST: 'Interes de descubierto',
  LIQUIDATION: 'Liquidacion forzosa',
  COMPENSATION: 'Compensacion',
  SEED_PURCHASE: 'Compra de semilla',
  STARTING_CAPITAL: 'Capital inicial',
};

/** Name of each step of the published liquidation order (plan section 6.6, ADR-0039). */
export const LIQUIDATION_STEP_LABELS: Readonly<Record<string, string>> = {
  INVENTORY: 'Existencias',
  IDLE_MACHINES: 'Maquinaria ociosa',
  CANCEL_TASKS: 'Tareas canceladas',
  WORKERS: 'Trabajadores',
  BUILDINGS: 'Edificios',
  UNUSED_LAND: 'Tierra sin campo',
};

export interface EconomyLine {
  readonly key: string;
  readonly label: string;
  readonly amount: Money;
  /** Sections of the GDD the line answers to, printed so the figure can be crossed. */
  readonly gddSection: number;
}

/**
 * The four aggregates of GDD section 124 plus the rest, each already signed by the server.
 *
 * "Everything else" is a line and not a footnote: acquisitions, repairs, overdraft interest
 * and forced liquidations all land there, and hiding them would make the net change stop
 * agreeing with the four lines above it, which is the one thing this panel must not do.
 */
export function economyLines(economy: WelcomeBackEconomy): readonly EconomyLine[] {
  return [
    {
      key: 'revenue',
      label: 'Ingresos',
      amount: fromWireMoney(economy.totalRevenue),
      gddSection: 124,
    },
    {
      key: 'salaries',
      label: 'Salarios',
      amount: fromWireMoney(economy.totalSalaries),
      gddSection: 107,
    },
    {
      key: 'maintenance',
      label: 'Mantenimiento',
      amount: fromWireMoney(economy.totalMaintenance),
      gddSection: 94,
    },
    {
      key: 'operating',
      label: 'Operacion',
      amount: fromWireMoney(economy.totalOperating),
      gddSection: 114,
    },
    {
      key: 'other',
      label: 'Otros movimientos',
      amount: fromWireMoney(economy.totalOther),
      gddSection: 124,
    },
  ];
}

/** Signed sum of the five lines, which GDD section 124 calls `netChange`. */
export function sumOfLines(economy: WelcomeBackEconomy): Money {
  return economyLines(economy).reduce((total, line) => Money.add(total, line.amount), Money.ZERO);
}

/** Whether the five lines add up to the net change the server reports (GDD section 124). */
export function linesReconcile(economy: WelcomeBackEconomy): boolean {
  return Money.compare(sumOfLines(economy), fromWireMoney(economy.netChange)) === 0;
}

/** Whether the balance before plus the net change is the balance after (ADR-0009). */
export function balanceReconciles(economy: WelcomeBackEconomy): boolean {
  const expected = Money.add(
    fromWireMoney(economy.balanceBefore),
    fromWireMoney(economy.netChange),
  );
  return Money.compare(expected, fromWireMoney(economy.balanceAfter)) === 0;
}

export interface TypeLine extends WelcomeBackLedgerLine {
  readonly label: string;
  readonly value: Money;
}

/**
 * The breakdown by kind of entry, largest movement first.
 *
 * By absolute value and not by sign: what the player wants to see at the top is what moved
 * the balance most, and a ranking by sign would bury a large outflow under a small inflow.
 */
export function typeLines(economy: WelcomeBackEconomy): readonly TypeLine[] {
  return [...economy.byType]
    .map((line) => ({
      ...line,
      label: LEDGER_TYPE_LABELS[line.type],
      value: fromWireMoney(line.total),
    }))
    .sort((left, right) => {
      const compared = Money.compare(magnitude(right.value), magnitude(left.value));
      return compared !== 0 ? compared : left.type < right.type ? -1 : 1;
    });
}

/** Absolute value of an amount. `Money` has no `abs`, and the sign is the sort key here. */
function magnitude(value: Money): Money {
  return Money.isNegative(value) ? Money.negate(value) : value;
}

/**
 * Kind of asset a forced sale took, as the interface names it.
 *
 * The three the engine can produce (`backend/src/modules/economy/liquidation.ts`,
 * `LiquidatedAsset.assetKind`). Unknown kinds fall through to their own identifier rather
 * than being hidden, because a sale nobody can name is the one thing ADR-0039 refuses to
 * report.
 */
export const LIQUIDATION_SUBJECT_LABELS: Readonly<Record<string, string>> = {
  STOCK: 'Existencias',
  MACHINE: 'Maquina',
  WORKER: 'Trabajador',
};

export interface LiquidationAsset {
  readonly subjectType: string | null;
  readonly subjectId: string | null;
  /**
   * The machine type, the resource or the name of the worker, as the engine recorded it. Null
   * only for an entry written before the field existed in the contract.
   */
  readonly detail: string | null;
  /** What was sold, named: the kind of asset and nothing invented. */
  readonly label: string;
  readonly amount: Money;
}

export interface LiquidationGroup {
  readonly step: string;
  readonly label: string;
  readonly assetCount: number;
  readonly total: Money;
  /** One entry per asset sold, which is what ADR-0039 wrote one ledger line each for. */
  readonly assets: readonly LiquidationAsset[];
}

/** The kind of an asset in Spanish, or its own identifier when the kind is unknown. */
export function liquidationSubjectLabel(subjectType: string | null): string {
  if (subjectType === null) {
    return 'Activo';
  }
  return LIQUIDATION_SUBJECT_LABELS[subjectType] ?? subjectType;
}

/**
 * The forced liquidation, grouped by the step of the published order.
 *
 * ADR-0039 writes one ledger entry per asset sold precisely so that the summary can say what
 * was sold and why, and the order is what the "why" is: the engine walks
 * `LIQUIDATION_STEPS` and stops as soon as the balance stops being negative, so the step a
 * sale belongs to is the reason it was chosen.
 *
 * The group therefore keeps the assets and does not collapse them into a count. A group that
 * reported only "two assets" would be the alternative ADR-0039 discarded in as many words —
 * "un unico asiento de liquidacion por el importe total: pierde que se vendio"— reintroduced
 * one layer higher up. What the wire allows is the kind and the identifier
 * (`welcomeBackLiquidationSchema`), and that is what is named.
 */
export function liquidationGroups(reply: WelcomeBackReply): readonly LiquidationGroup[] {
  const groups = new Map<string, { total: Money; assets: LiquidationAsset[] }>();
  for (const entry of reply.liquidations) {
    const amount = fromWireMoney(entry.amount);
    const asset: LiquidationAsset = {
      subjectType: entry.subjectType,
      subjectId: entry.subjectId,
      detail: entry.detail,
      label: liquidationSubjectLabel(entry.subjectType),
      amount,
    };
    const existing = groups.get(entry.step);
    if (existing === undefined) {
      groups.set(entry.step, { total: amount, assets: [asset] });
    } else {
      existing.assets.push(asset);
      groups.set(entry.step, {
        total: Money.add(existing.total, amount),
        assets: existing.assets,
      });
    }
  }
  return [...groups].map(([step, group]) => ({
    step,
    label: LIQUIDATION_STEP_LABELS[step] ?? step,
    assetCount: group.assets.length,
    total: group.total,
    assets: group.assets,
  }));
}

/** Total recovered by a forced liquidation, which is what the debt was covered with. */
export function liquidationTotal(reply: WelcomeBackReply): Money {
  return reply.liquidations.reduce(
    (total, entry) => Money.add(total, fromWireMoney(entry.amount)),
    Money.ZERO,
  );
}

/**
 * Whether the summary has anything to say beyond the economy.
 *
 * `hasContent` of the reply already answers "is there a summary at all"; this answers "is
 * there a list of events", which is what decides whether the second half of GDD section 68
 * is drawn.
 */
export function hasEvents(reply: WelcomeBackReply): boolean {
  return (
    reply.tasksClosed.length > 0 ||
    reply.fieldTransitions.length > 0 ||
    reply.idleWorkers.length > 0 ||
    reply.repairsCompleted.length > 0 ||
    reply.treeStageChanges.length > 0 ||
    reply.wasted.length > 0 ||
    reply.liquidations.length > 0 ||
    reply.notices.length > 0
  );
}
