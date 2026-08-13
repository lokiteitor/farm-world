// The scenarios the report evaluates, all of them built from the shared catalogues.
//
// Owner: workflow W5-C. Tool `tools/balance`.
//
// The calculator imports the same constants the game imports, from `shared/config` and
// `shared/rules`, and never restates a figure. That is the whole point of GDD section 127,
// which asks for sections 117 to 121 to become a spreadsheet outside the GDD: if the report
// held its own copy of the price of wheat, it would agree with the GDD and disagree with the
// game, which is the one outcome that would make it worse than not existing.
//
// Four scenarios, and each one answers a question the GDD asks:
//
//   `minimumSetup`     GDD section 117 verbatim: the whole fleet bought on day one, which is
//                      what GDD section 118 costs.
//   `staggered`        GDD section 120, lever A: each machine bought when the phase that
//                      needs it starts. It is the recommendation the GDD itself makes.
//   `gddWeedAssumption` GDD section 119 with its own assumption of about 20 % of weeds at
//                      harvest, which is what makes its 20 700 L come out. It is the control:
//                      it shows that the yield formula reproduces the GDD exactly, and that
//                      what does not reproduce is the weed level, not the yield.
//
// The effect of `CULTIVATE`, which GDD section 82 makes optional for wheat, is not a scenario:
// the operation does not change the length of the cycle nor the fleet that pays maintenance,
// it moves the instant from which weeds accumulate. It is therefore analysed in `weeds.ts`,
// where the question can be asked exactly.

import { WHEAT } from '../../shared/config/crops.js';
import { STARTING_CAPITAL } from '../../shared/config/economy.js';
import { WEED_GROWTH_STATES } from '../../shared/config/transitions.js';
import { bp, type Bp } from '../../shared/domain/units.js';
import {
  balanceKpis,
  cyclePhases,
  MINIMUM_SETUP_SCENARIO,
  type BalanceKpis,
  type BalanceScenario,
} from '../../shared/rules/balance.js';

/** The weed level GDD section 119 assumes at harvest, stated there as "about 20 %". */
export const GDD_119_WEED_LEVEL_BP: Bp = bp(2_000);

/** Skill GDD section 117 attributes to the starting worker, stated there as "about 60 %". */
export const GDD_117_WORKER_SKILL_BP: Bp = bp(6_000);

export interface NamedScenario {
  readonly key: string;
  readonly title: string;
  readonly purpose: string;
  readonly scenario: BalanceScenario;
}

/** GDD section 117 verbatim, which is the scenario `shared/rules/balance.ts` publishes. */
export const MINIMUM_SETUP: NamedScenario = {
  key: 'minimumSetup',
  title: 'Setup minimo viable, compra completa el dia uno',
  purpose:
    'Reproduce literalmente GDD §117 y §118: las cinco maquinas se adquieren al arrancar y ' +
    'se mantienen durante todo el ciclo.',
  scenario: MINIMUM_SETUP_SCENARIO,
};

/** GDD section 120, lever A: the staggered purchase the GDD recommends. */
export const STAGGERED_SETUP: NamedScenario = {
  key: 'staggered',
  title: 'Setup minimo viable, compra escalonada',
  purpose:
    'Aplica la recomendacion de GDD §120: cada maquina se adquiere cuando empieza la fase ' +
    'que la necesita, de modo que su mantenimiento solo corre desde ese momento.',
  scenario: { ...MINIMUM_SETUP_SCENARIO, ownershipMode: 'STAGGERED' },
};

/** The control that isolates the weed level from the rest of the yield formula. */
export const GDD_119_ASSUMPTION: NamedScenario = {
  key: 'gddWeedAssumption',
  title: 'Primer ciclo con la hipotesis de malezas de GDD §119',
  purpose:
    'Fija el nivel de malezas en el 20 % que GDD §119 supone, en lugar de proyectarlo con ' +
    'la tasa de GDD §82. Sirve para comprobar que la formula de rendimiento reproduce el ' +
    'ingreso publicado y que la discrepancia esta en el nivel de malezas.',
  scenario: { ...MINIMUM_SETUP_SCENARIO, weedLevelAtHarvestBp: GDD_119_WEED_LEVEL_BP },
};

export const SCENARIOS: readonly NamedScenario[] = [
  MINIMUM_SETUP,
  STAGGERED_SETUP,
  GDD_119_ASSUMPTION,
];

/** The KPIs of every scenario, keyed by the name the report shows. */
export function evaluateScenarios(): ReadonlyMap<string, BalanceKpis> {
  return new Map(SCENARIOS.map((named) => [named.key, balanceKpis(named.scenario)]));
}

/**
 * Game hours of a cycle in which weeds grow (GDD section 78).
 *
 * They are not the whole cycle: the field accumulates weeds while it is virgin, growing or
 * ready and not harvested, so the ploughing task and the harvesting task count and the sown
 * and germinating phases do not. It is computed from `WEED_GROWTH_STATES`, so a change to
 * that list moves the figure instead of leaving the report quoting an old one.
 */
export function weedGrowingGameHours(scenario: BalanceScenario): number {
  return cyclePhases(scenario, WHEAT)
    .filter((phase) => WEED_GROWTH_STATES.includes(phase.state))
    .reduce((total, phase) => total + phase.gameHours, 0);
}

/** The starting capital, re-exported so the report has one import for its inputs. */
export { STARTING_CAPITAL };
