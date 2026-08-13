// The balance calculator. Entry point of `make balance`.
//
// Owner: workflow W5-C. Tool `tools/balance`.
//
// It answers what GDD section 127 asks for: turn sections 117 to 121 into a sheet outside the
// GDD, so that a profitability problem is found in design and not in production. Plan section
// 10 adds the constraint that makes it worth having: it imports the same constants the game
// imports, so the report cannot drift from the game, and with the decision not to adjust the
// balance it is the deliverable that documents the deviation rather than a gate to be brought
// into the green.
//
// It writes two files into `docs/balance/`:
//
//   `informe-balance.md`  the report a person reads, in Spanish.
//   `kpis.json`           the same figures as data, for the closing review of workflow W7 and
//                         for a diff that shows what moved between two catalogues.
//
// Both are deterministic. No timestamp, no host, no random: two runs over the same catalogue
// produce identical bytes, so a change in either file means a constant changed.
//
// It exits zero even when the balance is negative, which it is. That is deliberate and it is
// what plan section 10 says: "con la decision de no ajustar balance, este informe es el
// entregable que documenta la desviacion, no una puerta que haya que poner en verde". It exits
// non zero only when it cannot compute or cannot write, which are failures of the tool.
//
// The imports reach `shared/` directly and not through the synchronised copies of the backend
// or the frontend, because this tool is neither: `scripts/sync-shared-types.sh` exists so that
// two npm projects can consume the contract without a workspace, and a third consumer that
// runs from the repository root has no reason to read a copy. The catalogues and the rules come
// from their own module paths, so that what the tool loads is exactly what the report is about;
// the contract version comes from the barrel, which is the one place it is declared.

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Money } from '../../shared/domain/money.js';
import { SHARED_CONTRACT_VERSION } from '../../shared/index.js';
import { type BalanceKpis } from '../../shared/rules/balance.js';
import { renderReport } from './report.js';
import { evaluateScenarios, MINIMUM_SETUP, SCENARIOS } from './scenarios.js';
import { analyseWeeds } from './weeds.js';

/** Directory the report is written to, resolved from this file and never from the cwd. */
const OUTPUT_DIR = new URL('../../docs/balance/', import.meta.url);

const REPORT_FILE = new URL('informe-balance.md', OUTPUT_DIR);
const DATA_FILE = new URL('kpis.json', OUTPUT_DIR);

/** The KPI set as data, with every amount as its canonical decimal string. */
function toJson(kpis: BalanceKpis): Record<string, unknown> {
  return {
    minimumSetupCost: Money.toString(kpis.minimumSetupCost),
    holdingCostPerCycle: Money.toString(kpis.holdingCostPerCycle),
    revenuePerCycle: Money.toString(kpis.revenuePerCycle),
    revenueToCostRatio: kpis.revenueToCostRatio,
    gameHoursToFirstBreakEven: kpis.gameHoursToFirstBreakEven,
    capitalCushionAfterSetup: Money.toString(kpis.capitalCushionAfterSetup),
    cycleGameHours: kpis.cycleGameHours,
    netPerCycle: Money.toString(kpis.netPerCycle),
    breakEvenCycles: kpis.breakEvenCycles,
    weedLevelAtHarvestBp: kpis.weedLevelAtHarvestBp,
    weedGrowingGameHours: kpis.weedGrowingGameHours,
    setup: {
      landCells: kpis.setup.landCells,
      land: Money.toString(kpis.setup.land),
      buildings: Money.toString(kpis.setup.buildings),
      machinery: Money.toString(kpis.setup.machinery),
      total: Money.toString(kpis.setup.total),
    },
    holding: {
      wages: Money.toString(kpis.holding.wages),
      maintenance: Money.toString(kpis.holding.maintenance),
      operating: Money.toString(kpis.holding.operating),
      interest: Money.toString(kpis.holding.interest),
      total: Money.toString(kpis.holding.total),
      windowGameHours: kpis.holding.windowGameHours,
    },
    yield: {
      baseLiters: kpis.yield.baseLiters,
      fertilityMultiplier: kpis.yield.fertilityMultiplier,
      fertilizationMultiplier: kpis.yield.fertilizationMultiplier,
      weedPenalty: kpis.yield.weedPenalty,
      liters: kpis.yield.liters,
    },
    phases: kpis.phases.map((phase) => ({
      state: phase.state,
      operation: phase.operation,
      gameHours: phase.gameHours,
      machineTypes: [...phase.machineTypes],
    })),
  };
}

async function main(): Promise<void> {
  const kpis = evaluateScenarios();
  const weeds = analyseWeeds(MINIMUM_SETUP.scenario);
  const markdown = renderReport({ kpis, weeds, contractVersion: SHARED_CONTRACT_VERSION });

  const data = {
    contractVersion: SHARED_CONTRACT_VERSION,
    scenarios: Object.fromEntries(
      SCENARIOS.map((named) => [
        named.key,
        { title: named.title, kpis: toJson(kpis.get(named.key) as BalanceKpis) },
      ]),
    ),
    weeds: {
      ratePerGameHourBp: weeds.ratePerGameHourBp,
      growingGameHours: weeds.growingGameHours,
      saturationGameHours: weeds.saturationGameHours,
      unclampedLevelBp: weeds.unclampedLevelBp,
      levelAtHarvestBp: weeds.levelAtHarvestBp,
      penalty: weeds.penalty,
      liters: weeds.liters,
      revenue: Money.toString(weeds.revenue),
      publishedLevelBp: weeds.publishedLevelBp,
      publishedLiters: weeds.publishedLiters,
      publishedRevenue: Money.toString(weeds.publishedRevenue),
      litersLost: weeds.litersLost,
      revenueLost: Money.toString(weeds.revenueLost),
      growingGameHoursAfterSowing: weeds.growingGameHoursAfterSowing,
      levelAfterCultivateBp: weeds.levelAfterCultivateBp,
      cultivateAvoidsSaturation: weeds.cultivateAvoidsSaturation,
    },
  };

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(REPORT_FILE, `${markdown}\n`, 'utf8');
  await writeFile(DATA_FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

  const minimum = kpis.get(MINIMUM_SETUP.key) as BalanceKpis;
  console.log('Informe de balance generado.');
  console.log(`  ${fileURLToPath(REPORT_FILE)}`);
  console.log(`  ${fileURLToPath(DATA_FILE)}`);
  console.log('');
  console.log('KPIs de GDD 125, setup minimo con compra completa:');
  console.log(`  1. Coste de setup minimo      ${Money.toDisplay(minimum.minimumSetupCost)}`);
  console.log(`  2. Coste por ciclo            ${Money.toDisplay(minimum.holdingCostPerCycle)}`);
  console.log(`  3. Ingreso / ciclo            ${Money.toDisplay(minimum.revenuePerCycle)}`);
  console.log(
    `  4. Ratio ingreso/coste        ${
      minimum.revenueToCostRatio === null ? 'n/d' : minimum.revenueToCostRatio.toFixed(4)
    }`,
  );
  console.log(
    `  5. Horas hasta el equilibrio  ${
      minimum.gameHoursToFirstBreakEven === null
        ? 'no existe (margen negativo, GDD 121)'
        : minimum.gameHoursToFirstBreakEven.toFixed(2)
    }`,
  );
  console.log(
    `  6. Colchon tras el setup      ${Money.toDisplay(minimum.capitalCushionAfterSetup)}`,
  );
  console.log('');
  console.log(
    `Malezas al cosechar: ${(weeds.levelAtHarvestBp / 100).toFixed(1)} % ` +
      `(GDD 119 supone ${(weeds.publishedLevelBp / 100).toFixed(1)} %). ` +
      `Diferencia de ingreso: ${Money.toDisplay(weeds.revenueLost)}.`,
  );
}

await main();
