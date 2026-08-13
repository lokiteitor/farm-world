// Formatting of the report: Spanish figures, and nothing that changes between two runs.
//
// Owner: workflow W5-C. Tool `tools/balance`.
//
// Two rules govern the whole file.
//
// The report is deterministic. It carries no generation timestamp and no host name, so two
// runs over the same catalogue produce byte identical output and the only reason the file
// under `docs/balance/` ever changes is that a constant changed. That is what makes it usable
// as a review artefact and as a check in continuous integration; a report stamped with the
// hour would show a diff on every run and the real change would be lost in it.
//
// The figures are Spanish, because the report is. `Intl.NumberFormat('es-ES')` gives the
// thousands separator and the decimal comma the rest of `docs/` uses, and the amounts are
// converted from the canonical four decimal string of `Money` and never from a float that was
// carried through a calculation.

import { Money } from '../../shared/domain/money.js';

// `useGrouping: 'always'` on purpose. Spanish typography allows a four digit integer to go
// without the thousands separator, and the default follows that rule, which would print
// "2475,00" next to "13.900,00" in the same column of the same table. Uniformity reads better
// in a table of figures than the typographic nicety does.
const GROUPING = { useGrouping: 'always' } as const;

const AMOUNT = new Intl.NumberFormat('es-ES', {
  ...GROUPING,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const DECIMAL = new Intl.NumberFormat('es-ES', {
  ...GROUPING,
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const INTEGER = new Intl.NumberFormat('es-ES', { ...GROUPING, maximumFractionDigits: 0 });

/** An amount, with two decimals and the Spanish separators. */
export function amount(value: Money): string {
  return AMOUNT.format(Number(Money.toDisplay(value)));
}

/** An amount with its currency mark, which the report uses in prose. */
export function money(value: Money): string {
  return `${amount(value)} $`;
}

/** A plain number with up to two decimals, or as many as asked for. */
export function decimal(value: number, fractionDigits = 2): string {
  return fractionDigits === 2
    ? DECIMAL.format(value)
    : new Intl.NumberFormat('es-ES', {
        ...GROUPING,
        minimumFractionDigits: 0,
        maximumFractionDigits: fractionDigits,
      }).format(value);
}

/**
 * A ratio, with three decimals. Two would round the ratio of the first cycle, which is 0,096,
 * to a tenth and lose the very digit the KPI is about.
 */
export function ratio(value: number): string {
  return decimal(value, 3);
}

/** The numeric value of an amount, for a comparison. Never the formatted string. */
export function amountValue(value: Money): number {
  return Number(Money.toDisplay(value));
}

/** A whole number. */
export function integer(value: number): string {
  return INTEGER.format(Math.round(value));
}

/** A duration in game hours. */
export function hours(value: number): string {
  return `${decimal(value)} h`;
}

/** A ratio in basis points, shown as the percentage the GDD writes. */
export function percentFromBp(value: number): string {
  return `${decimal(value / 100)} %`;
}

/** A ratio in 0..1, shown as a percentage. */
export function percentFromRatio(value: number): string {
  return `${decimal(value * 100)} %`;
}

/** The relative difference between a computed figure and the one the GDD publishes. */
export function relativeGap(computed: number, published: number): string {
  if (published === 0) {
    return '—';
  }
  const gap = (computed - published) / published;
  const sign = gap > 0 ? '+' : '';
  return `${sign}${decimal(gap * 100)} %`;
}

/** A markdown table, with the pipes escaped in the cells. */
export function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const escape = (cell: string): string => cell.replace(/\|/g, '\\|');
  const lines = [
    `| ${headers.map(escape).join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.map(escape).join(' | ')} |`),
  ];
  return lines.join('\n');
}
