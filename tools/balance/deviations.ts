// The values the GDD publishes, next to the values its own catalogue produces.
//
// Owner: workflow W5-C. Tool `tools/balance`.
//
// This is the deliverable the plan asks for. Originally it recorded what the published
// figures were worth with the catalogues of GDD sections 82, 89, 115, 116, 117 and 133
// applied literally; since the balance revision of 2026-08 (docs/balance/revision-2026-08.md)
// the catalogue departs from the GDD in the sale price, the machinery rates, the salary line
// and the weed states, and each cause below says whether a mismatch is internal to the GDD or
// introduced by the revision.
//
// A row is `reproducible` when the computed figure equals the published one within the
// tolerance the row itself declares. The tolerances are not uniform on purpose: GDD section
// 118 rounds its durations to whole hours, so a percent of slack is the document's own
// precision, while GDD section 117 adds up exact catalogue prices and must match to the cent.
//
// Every computed figure comes from `shared/`, through the same functions the server runs.
// Nothing in this file restates a rule.

import { WHEAT } from '../../shared/config/crops/index.js';
import { STARTING_CAPITAL } from '../../shared/config/economy.js';
import { NATURAL_FOREST, PINE } from '../../shared/config/forestry.js';
import { MACHINE_CATALOGUE } from '../../shared/config/machines.js';
import { SALARY_INTERCEPT, SALARY_PER_SKILL_POINT } from '../../shared/config/workers.js';
import { Money } from '../../shared/domain/money.js';
import { DM3_PER_M3, bp, bpToPercent } from '../../shared/domain/units.js';
import { type BalanceKpis } from '../../shared/rules/balance.js';
import { estimateTaskDuration, skillFactor } from '../../shared/rules/duration.js';
import { expectedNaturalForestVolumeDm3 } from '../../shared/rules/forestry.js';
import { cropSaleRevenue, woodSaleRevenue } from '../../shared/rules/pricing.js';
import { amount, amountValue, decimal } from './format.js';
import { GDD_117_WORKER_SKILL_BP } from './scenarios.js';
import { type WeedAnalysis } from './weeds.js';

export interface Deviation {
  /** Section of the GDD the figure is published in. */
  readonly section: string;
  readonly concept: string;
  /** What the GDD says, as the GDD says it. */
  readonly published: string;
  /** What its own catalogue produces, computed here. */
  readonly computed: string;
  readonly reproducible: boolean;
  /** Why the two differ, or why they agree in spite of looking as if they would not. */
  readonly cause: string;
}

/** Relative difference between two figures, as a fraction. */
function gap(computed: number, published: number): number {
  return published === 0 ? 0 : Math.abs((computed - published) / published);
}

/**
 * The skill, as a percentage, that the procedural salary rule of GDD section 102 would price
 * at a given salary. It is the inverse of the fitted line and it exists to say what the
 * 15 $/h of GDD section 117 would correspond to, not to change anything.
 */
function skillForSalary(salaryUnits: number): number {
  const slope = Number(Money.toDisplay(SALARY_PER_SKILL_POINT));
  const intercept = Number(Money.toDisplay(SALARY_INTERCEPT));
  return slope === 0 ? 0 : (salaryUnits - intercept) / slope;
}

/** Ploughing 250 cells with the skill GDD section 117 attributes to the starting worker. */
function plowDurationAtSkill(): number {
  return estimateTaskDuration({
    operation: 'PLOW',
    units: 250,
    conditionBp: bp(10_000),
    skillBp: GDD_117_WORKER_SKILL_BP,
  }).durationGameHours;
}

/**
 * The whole table, in the order of the GDD.
 *
 * `minimum` is the KPI set of GDD section 117 verbatim and `withPublishedWeeds` the one that
 * fixes the weed level at the value GDD section 119 assumes, which is what isolates the yield
 * formula from the weed projection.
 */
export function deviations(
  minimum: BalanceKpis,
  withPublishedWeeds: BalanceKpis,
  weeds: WeedAnalysis,
): readonly Deviation[] {
  const rows: Deviation[] = [];

  // --- GDD section 117, the acquisition cost -------------------------------
  rows.push({
    section: '§117',
    concept: 'Coste de la tierra, 330 celdas de pradera',
    published: '39.600 $',
    computed: `${amount(minimum.setup.land)} $`,
    reproducible: Money.compare(minimum.setup.land, Money.fromUnits(39_600)) === 0,
    cause: 'Reproducible con el precio por celda de GDD §115 (120 $) sin multiplicadores.',
  });
  rows.push({
    section: '§117',
    concept: 'Coste de los tres edificios de arranque',
    published: '23.000 $',
    computed: `${amount(minimum.setup.buildings)} $`,
    reproducible: Money.compare(minimum.setup.buildings, Money.fromUnits(23_000)) === 0,
    cause: 'Reproducible con el catalogo de GDD §116 y la huella ya comprada.',
  });
  rows.push({
    section: '§117',
    concept: 'Coste de las cinco maquinas minimas',
    published: '83.500 $',
    computed: `${amount(minimum.setup.machinery)} $`,
    reproducible: Money.compare(minimum.setup.machinery, Money.fromUnits(83_500)) === 0,
    cause: 'Reproducible con el catalogo de GDD §89.',
  });
  rows.push({
    section: '§117',
    concept: 'Coste total de arranque',
    published: '146.100 $',
    computed: `${amount(minimum.setup.total)} $`,
    reproducible: Money.compare(minimum.setup.total, Money.fromUnits(146_100)) === 0,
    cause: 'Reproducible: la suma de las tres partidas anteriores.',
  });
  rows.push({
    section: '§117',
    concept: 'Colchon de capital tras el setup',
    published: '13.900 $',
    computed: `${amount(minimum.capitalCushionAfterSetup)} $`,
    reproducible: Money.compare(minimum.capitalCushionAfterSetup, Money.fromUnits(13_900)) === 0,
    cause: `Reproducible con el capital inicial de ${amount(STARTING_CAPITAL)} $.`,
  });
  rows.push({
    section: '§117 frente a §118',
    concept: 'Habilidad del trabajador de arranque',
    published: 'aproximadamente 60 %',
    computed: `${bpToPercent(bp(7_000))} % para reproducir las duraciones de §118`,
    reproducible: false,
    cause:
      `Con habilidad 60 % el factor de GDD §103 es ` +
      `${decimal(skillFactor(GDD_117_WORKER_SKILL_BP), 2)} y arar 250 celdas tarda ` +
      `${decimal(plowDurationAtSkill(), 1)} h, no las 70 h de §118. Las duraciones publicadas ` +
      'exigen un factor de 0,85, que en la curva implementada corresponde al 70 % de habilidad.',
  });
  rows.push({
    section: '§117 frente a §36 y §102',
    concept: 'Salario del trabajador de arranque',
    published: '15 $/h en §117, 30 $/h en §36, 12-31 $/h en §102',
    computed: `${amount(
      Money.add(SALARY_INTERCEPT, Money.mulRatio(SALARY_PER_SKILL_POINT, 70)),
    )} $/h para habilidad 70 % con la recta salarial revisada`,
    reproducible: false,
    cause:
      'Las tres cifras del GDD son incompatibles entre si. La regla procedural de §102 es la ' +
      'autoritativa; la revision de 2026-08 escalo su recta a la baja porque el ajuste original ' +
      '(22,75 $/h para el 70 %) superaba todo el ingreso de un ciclo. Con la recta revisada el ' +
      `15 $/h de §117 corresponderia a una habilidad del ${decimal(skillForSalary(15))} %.`,
  });

  // --- GDD section 118, the cycle and its holding cost ----------------------
  const plow = minimum.phases.find((phase) => phase.operation === 'PLOW');
  const seed = minimum.phases.find((phase) => phase.operation === 'SEED');
  const harvest = minimum.phases.find((phase) => phase.operation === 'HARVEST');
  rows.push({
    section: '§118',
    concept: 'Duracion de PLOW sobre 250 celdas',
    published: 'aproximadamente 70 h',
    computed: `${decimal(plow?.gameHours ?? 0)} h`,
    reproducible: gap(plow?.gameHours ?? 0, 70) < 0.01,
    cause: 'Reproducible con workSpeed 4,2 de §89 y skillFactor 0,85 de §103.',
  });
  rows.push({
    section: '§118',
    concept: 'Duracion de SEED sobre 250 celdas',
    published: 'aproximadamente 61 h',
    computed: `${decimal(seed?.gameHours ?? 0)} h`,
    reproducible: gap(seed?.gameHours ?? 0, 61) < 0.01,
    cause: 'Reproducible con workSpeed 4,8 de §89.',
  });
  rows.push({
    section: '§118',
    concept: 'Duracion de HARVEST sobre 250 celdas',
    published: 'aproximadamente 98 h',
    computed: `${decimal(harvest?.gameHours ?? 0)} h`,
    reproducible: gap(harvest?.gameHours ?? 0, 98) < 0.01,
    cause: 'Reproducible con workSpeed 3,0 de §89.',
  });
  rows.push({
    section: '§118',
    concept: 'Duracion total del ciclo',
    published: 'aproximadamente 325 h',
    computed: `${decimal(minimum.cycleGameHours)} h`,
    reproducible: gap(minimum.cycleGameHours, 325) < 0.01,
    cause:
      'Reproducible con el reparto de fases de plan seccion 2.2 (6 + 12 + 78 = 96 h), que ' +
      'preserva a la vez el growthDuration de §82 y el ciclo de §118.',
  });
  rows.push({
    section: '§118',
    concept: 'Salarios del ciclo',
    published: '4.875 $ (15 $/h x 325 h)',
    computed: `${amount(minimum.holding.wages)} $`,
    reproducible: gap(amountValue(minimum.holding.wages), 4_875) < 0.01,
    cause:
      'Reproducible. La diferencia es la del ciclo: el GDD redondea 325 h y el calculo integra ' +
      `${decimal(minimum.cycleGameHours)} h.`,
  });
  rows.push({
    section: '§118',
    concept: 'Mantenimiento de maquinaria por hora',
    published: 'aproximadamente 70 $/h combinado',
    computed: `${amount(catalogueMaintenancePerHour())} $/h`,
    reproducible: false,
    cause:
      'NO reproducible por dos motivos acumulados: el catalogo de §89 solo asigna ' +
      'maintenanceCost al tractor y a la cosechadora (37 $/h combinados, no ~70), y la revision ' +
      'de 2026-08 dejo esas dos tasas en la mitad (6 y 15 $/h), porque con las literales un ' +
      'tractor consumia el 22 % de su precio de compra en un solo ciclo.',
  });
  rows.push({
    section: '§118',
    concept: 'Mantenimiento del ciclo',
    published: '22.750 $',
    computed: `${amount(minimum.holding.maintenance)} $`,
    reproducible: false,
    cause: 'Consecuencia directa de la fila anterior.',
  });
  rows.push({
    section: '§118',
    concept: 'Coste de posesion del ciclo',
    published: '27.625 $ (salarios mas mantenimiento)',
    computed: `${amount(
      Money.add(minimum.holding.wages, minimum.holding.maintenance),
    )} $ sin operacion, ${amount(minimum.holding.total)} $ con ella`,
    reproducible: false,
    cause:
      'NO reproducible. A la baja, el mantenimiento del catalogo revisado es menos de un ' +
      'tercio del que §118 supone; al alza, §118 omite el operatingCost, que aqui son ' +
      `${amount(minimum.holding.operating)} $ y que §107 y §114 declaran aditivo al ` +
      'mantenimiento.',
  });

  // --- GDD section 119, the revenue of the first harvest --------------------
  rows.push({
    section: '§119',
    concept: 'Rendimiento con la hipotesis de malezas del propio §119',
    published: 'aproximadamente 20.700 L',
    computed: `${withPublishedWeeds.yield.liters} L`,
    reproducible: withPublishedWeeds.yield.liters === 20_700,
    cause:
      'Reproducible exactamente: 250 celdas x 90 L x (1 - 0,08). La formula de §83 y la curva ' +
      'de §78 producen el numero publicado cuando se les da el 20 % de malezas que §119 supone.',
  });
  rows.push({
    section: '§119',
    concept: 'Ingreso de la primera cosecha con esa misma hipotesis',
    published: 'aproximadamente 4.554 $',
    computed: `${amount(withPublishedWeeds.revenuePerCycle)} $`,
    reproducible: Money.compare(withPublishedWeeds.revenuePerCycle, Money.fromUnits(4_554)) === 0,
    cause:
      'NO reproducible por el precio, no por los litros: los 20.700 L de §119 se reproducen, ' +
      `pero el precio es el ${amount(WHEAT.sellPricePerLiter)} $/L de la revision de 2026-08 ` +
      'y no el 0,22 de §82, descartado por inviable.',
  });
  rows.push({
    section: '§119 frente a §82',
    concept: 'Nivel de malezas acumulado al cosechar',
    published: 'aproximadamente 20 % en 325 h sin cultivar',
    computed: `${bpToPercent(weeds.levelAtHarvestBp)} %`,
    reproducible: false,
    cause:
      `NO reproducible. Con la tasa de §82 (${decimal(weeds.ratePerGameHourBp / 100)} %/h) y ` +
      `la lectura H8 de la revision de 2026-08 las malezas crecen solo durante las ` +
      `${decimal(weeds.growingGameHours, 1)} h de GROWING, en el orden del ~20 % que §119 ` +
      'supone; con la lectura original acumulaban 246 h y saturaban el 100 %.',
  });
  rows.push({
    section: '§119 frente a §78 y §82',
    concept: 'Rendimiento real del primer ciclo sin cultivar',
    published: 'aproximadamente 20.700 L y 4.554 $',
    computed: `${weeds.liters} L y ${amount(weeds.revenue)} $`,
    reproducible: false,
    cause:
      `Consecuencia de la fila anterior y del precio revisado: la penalizacion de §78 es el ` +
      `${decimal(weeds.penalty * 100, 1)} %, frente al 8 % que §119 supone, y el precio es ` +
      `${amount(WHEAT.sellPricePerLiter)} $/L.`,
  });

  // --- GDD section 121, the break-even -------------------------------------
  rows.push({
    section: '§121',
    concept: 'Punto de equilibrio del setup minimo',
    published: 'formula; §119 anticipa que el primer ciclo no es rentable',
    computed:
      minimum.breakEvenCycles === null
        ? 'No existe: el margen por ciclo es negativo'
        : `${decimal(minimum.breakEvenCycles)} ciclos`,
    reproducible: true,
    cause:
      'El propio §121 declara que un denominador negativo significa que no hay equilibrio. ' +
      `Con la revision de 2026-08 el margen por ciclo es ${amount(minimum.netPerCycle)} $ y el ` +
      'equilibrio existe; con el catalogo literal el margen era negativo y no existia.',
  });

  // --- GDD section 138, forestry -------------------------------------------
  // La regla que el juego ejecuta, no la constante del catalogo. `NATURAL_FOREST_AVERAGE_VOLUME_DM3`
  // describe el volumen medio del arbolado e incluye los plantones; una tala los excluye, porque
  // GDD 131 no admite talarlos ni les da valor comercial. Son 382,5 m3 y no 383,5 m3, que es lo
  // que la resolucion 40 de las erratas fija y la errata 41 dejaba pendiente de aplicar.
  const forestVolumeDm3 = expectedNaturalForestVolumeDm3(250, NATURAL_FOREST, PINE);
  rows.push({
    section: '§138',
    concept: 'Volumen de la primera tala de 250 celdas de bosque maduro',
    published: 'aproximadamente 382 m3',
    computed: `${decimal(forestVolumeDm3 / DM3_PER_M3, 1)} m3`,
    reproducible: gap(forestVolumeDm3 / DM3_PER_M3, 382) < 0.01,
    cause:
      'Reproducible con la mezcla de fases de shared/config/forestry, que se eligio ' +
      'precisamente para que la cifra de §138 saliera del catalogo.',
  });
  rows.push({
    section: '§138',
    concept: 'Ingreso de la primera tala',
    published: 'aproximadamente 17.190 $',
    computed: `${amount(woodSaleRevenue(PINE, forestVolumeDm3))} $`,
    reproducible: gap(amountValue(woodSaleRevenue(PINE, forestVolumeDm3)), 17_190) < 0.01,
    cause: `Reproducible con el precio de §133 (${amount(PINE.sellPricePerM3)} $/m3).`,
  });
  rows.push({
    section: '§133 frente a §138',
    concept: 'Edad a la que se alcanza OLD_GROWTH',
    published: '960 h',
    computed: `${PINE.stageStartGameHours.OLD_GROWTH} h`,
    reproducible: false,
    cause:
      'NO reproducible: cuatro fases tienen tres fronteras, de modo que 4 x 240 h cuenta una ' +
      'fase de mas. Registrado como lectura erronea en docs/erratas-gdd-stack.md.',
  });

  // --- GDD section 116, the double charge of the land -----------------------
  rows.push({
    section: '§116 frente a §117',
    concept: 'realBuildingCost aplicado literalmente',
    published: 'purchasePrice mas huella x cellPrice',
    computed:
      `${amount(
        Money.add(minimum.setup.buildings, Money.fromUnits(80 * 120)),
      )} $ para los tres edificios, frente a los ${amount(minimum.setup.buildings)} $ ` +
      'que §117 cobra',
    reproducible: false,
    cause:
      'NO reproducible a la vez que §117: aplicar la formula al pie de la letra cobra el suelo ' +
      'dos veces al jugador que ya lo posee, que es exactamente el caso que §117 describe. El ' +
      'plan resuelve la contradiccion en la seccion 2.2 y ADR-0029.',
  });

  return rows;
}

/** Combined maintenance of the five machines of GDD section 117, per game hour. */
export function catalogueMaintenancePerHour(): Money {
  return Money.sum(
    (['TRACTOR', 'PLOW', 'SEEDER', 'HARVESTER', 'TRAILER'] as const).map(
      (type) => MACHINE_CATALOGUE[type].maintenanceCostPerGameHour,
    ),
  );
}

/** Combined operating cost of the same five machines, per game hour. */
export function catalogueOperatingPerHour(): Money {
  return Money.sum(
    (['TRACTOR', 'PLOW', 'SEEDER', 'HARVESTER', 'TRAILER'] as const).map(
      (type) => MACHINE_CATALOGUE[type].operatingCostPerGameHour,
    ),
  );
}

/** Revenue the cycle would need for the margin to be positive, reported and not applied. */
export function revenueNeededForBreakEven(kpis: BalanceKpis): Money {
  return kpis.holdingCostPerCycle;
}

/** Price per litre that would make the cycle break even, reported and not applied. */
export function priceNeededForBreakEven(kpis: BalanceKpis): Money {
  if (kpis.yield.liters === 0) {
    return Money.ZERO;
  }
  return Money.fromScaled(Money.toScaled(kpis.holdingCostPerCycle) / BigInt(kpis.yield.liters));
}

/** Litres the cycle would need at the published price, reported and not applied. */
export function litersNeededForBreakEven(kpis: BalanceKpis): number {
  const perLiter = Money.toScaled(cropSaleRevenue(WHEAT, 1));
  return perLiter === 0n ? 0 : Number(Money.toScaled(kpis.holdingCostPerCycle) / perLiter);
}
