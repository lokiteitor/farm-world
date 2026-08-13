// Steps, assertions and the table of balance variations.
//
// Owner: workflow W7-B. `scripts/smoke/**`.
//
// Every assertion carries three things and never fewer: the step it belongs to, what was
// expected and what was observed. A smoke test that says "failed" is a smoke test nobody can
// act on, and the brief of this window is explicit that a failing loop must be reported and not
// dressed up.
//
// The table at the end is the ledger of the run seen from the outside: one row per step that
// moved money, with the variation and the balance it left behind. It is what makes the deficit
// of the first cycle of GDD sections 118 and 119 visible as a fact of the run rather than as a
// claim of a document.

import process from 'node:process';
import { Money } from '../../shared/index.js';

/** A failed expectation, with everything needed to act on it. */
export class SmokeFailure extends Error {
  constructor(
    readonly step: string,
    readonly claim: string,
    readonly expected: string,
    readonly observed: string,
  ) {
    super(`Paso ${step}: ${claim}\n    esperado : ${expected}\n    observado: ${observed}`);
    this.name = 'SmokeFailure';
  }
}

export interface BalanceRow {
  readonly step: string;
  readonly label: string;
  readonly delta: string;
  readonly balance: string;
}

export class Report {
  private step = '0';
  private stepTitle = '';
  private readonly rows: BalanceRow[] = [];
  private readonly checks: string[] = [];
  private checkCount = 0;
  private readonly startedAtRealMs = Date.now();

  /** Opens a step. Everything asserted from here on is attributed to it. */
  begin(step: string, title: string): void {
    this.step = step;
    this.stepTitle = title;
    console.log(`\n[${step}] ${title}`);
  }

  /** A line of narration inside the current step. Never an assertion. */
  note(text: string): void {
    console.log(`      ${text}`);
  }

  /** Records one satisfied expectation, with the value that satisfied it. */
  private pass(claim: string, observed: string): void {
    this.checkCount += 1;
    this.checks.push(`${this.step} ${claim}`);
    console.log(`  ok  ${claim}: ${observed}`);
  }

  get satisfiedChecks(): number {
    return this.checkCount;
  }

  get currentStep(): string {
    return `${this.step} (${this.stepTitle})`;
  }

  check(claim: string, condition: boolean, expected: string, observed: string): void {
    if (!condition) {
      throw new SmokeFailure(this.currentStep, claim, expected, observed);
    }
    this.pass(claim, observed);
  }

  equal<TValue>(claim: string, observed: TValue, expected: TValue): void {
    this.check(claim, Object.is(observed, expected), String(expected), String(observed));
  }

  /** Equality of two amounts, compared through `Money` and never as text or as a double. */
  money(claim: string, observed: string, expected: string): void {
    this.check(
      claim,
      Money.compare(Money.fromString(observed), Money.fromString(expected)) === 0,
      Money.toString(Money.fromString(expected)),
      Money.toString(Money.fromString(observed)),
    );
  }

  /** Equality of two integers within an absolute tolerance, which the claim must justify. */
  near(claim: string, observed: number, expected: number, tolerance: number): void {
    this.check(
      claim,
      Math.abs(observed - expected) <= tolerance,
      `${String(expected)} +/- ${String(tolerance)}`,
      String(observed),
    );
  }

  /** One row of the balance table. `balance` is the settled balance the step left behind. */
  recordBalance(label: string, delta: string, balance: string): void {
    this.rows.push({
      step: this.step,
      label,
      delta: Money.toString(Money.fromString(delta)),
      balance: Money.toString(Money.fromString(balance)),
    });
  }

  /** Prints the table of variations. Called once, at the end of a successful run. */
  printBalanceTable(): void {
    const header: BalanceRow = {
      step: 'Paso',
      label: 'Concepto',
      delta: 'Variacion',
      balance: 'Saldo',
    };
    const all = [header, ...this.rows];
    const width = (pick: (row: BalanceRow) => string): number =>
      all.reduce((widest, row) => Math.max(widest, pick(row).length), 0);
    const widths = {
      step: width((row) => row.step),
      label: width((row) => row.label),
      delta: width((row) => row.delta),
      balance: width((row) => row.balance),
    };
    const line = (row: BalanceRow): string =>
      `  ${row.step.padEnd(widths.step)}  ${row.label.padEnd(widths.label)}  ` +
      `${row.delta.padStart(widths.delta)}  ${row.balance.padStart(widths.balance)}`;

    console.log('\nVariaciones de saldo');
    console.log(line(header));
    console.log(
      `  ${'-'.repeat(widths.step)}  ${'-'.repeat(widths.label)}  ` +
        `${'-'.repeat(widths.delta)}  ${'-'.repeat(widths.balance)}`,
    );
    for (const row of this.rows) {
      console.log(line(row));
    }
  }

  /** Closing line of a successful run. */
  printSummary(requestCount: number): void {
    const elapsed = (Date.now() - this.startedAtRealMs) / 1000;
    console.log(
      `\nSmoke completo: ${String(this.checkCount)} comprobaciones, ` +
        `${String(requestCount)} peticiones HTTP, ${elapsed.toFixed(1)} s de reloj real.`,
    );
  }

  /** Closing block of a failed run, printed before the process exits with a non zero code. */
  printFailure(error: unknown, logTail: string): void {
    console.error('\n=== SMOKE FALLIDO ===');
    if (error instanceof SmokeFailure) {
      console.error(`  paso      : ${error.step}`);
      console.error(`  afirmacion: ${error.claim}`);
      console.error(`  esperado  : ${error.expected}`);
      console.error(`  observado : ${error.observed}`);
    } else {
      console.error(`  paso  : ${this.currentStep}`);
      console.error(
        `  error : ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      );
    }
    console.error(`  comprobaciones satisfechas antes del fallo: ${String(this.checkCount)}`);
    if (this.rows.length > 0) {
      this.printBalanceTable();
    }
    if (logTail.length > 0) {
      console.error('\n=== Salida de los procesos del backend ===');
      console.error(logTail);
    }
    process.exitCode = 1;
  }
}
