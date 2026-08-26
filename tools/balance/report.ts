// The Spanish report that `make balance` writes into docs/balance/.
//
// Owner: workflow W5-C. Tool `tools/balance`.
//
// GDD section 127 asks for sections 117 to 121 to be turned into a balance sheet outside the
// GDD, "donde las formulas se ajusten interactivamente, para evitar descubrir problemas de
// rentabilidad ya en produccion". This is that sheet. The original implementation applied the
// GDD literally and this report documented that the result was an order of magnitude short of
// the GDD's own target; the balance revision of 2026-08 (docs/balance/revision-2026-08.md)
// then adjusted the sale price, the machinery rates, the salary line and the weed states, and
// the report now records the revised balance next to what the GDD publishes.
//
// Structure, and why each part is there:
//
//   1-2  what the report is and what it evaluates.
//   3    the six KPIs of GDD section 125, per scenario.
//   4-6  the reproduction of GDD sections 117, 118 and 119, which is what the brief of the
//        tool asks for literally.
//   7    the table of published values that the catalogue does not reproduce, with the real
//        figure beside each one.
//   8    the effect of the weed rate of GDD section 82 on the first cycle, which is the main
//        finding and the one that costs the most money.
//   9    the break-even of GDD section 121 and the magnitude of the levers of GDD section 120,
//        stated and not applied.
//  10    the consequences that are already implemented elsewhere, so that a reader who arrives
//        here from the GDD knows the deficit is a designed state and not an oversight.

import { BUILDING_CATALOGUE } from '../../shared/config/buildings.js';
import { CROPS, WHEAT } from '../../shared/config/crops/index.js';
import {
  LIQUIDATION_DEBT_THRESHOLD_BP,
  LIQUIDATION_STEPS,
  OVERDRAFT_INTEREST_BP_PER_GAME_HOUR,
  RESALE_FACTOR_BP,
} from '../../shared/config/economy.js';
import { MACHINE_CATALOGUE } from '../../shared/config/machines.js';
import { CROP_FAMILIES, CROP_IDS, SEASONS, type CropId } from '../../shared/domain/enums.js';
import { Money } from '../../shared/domain/money.js';
import { type BalanceKpis } from '../../shared/rules/balance.js';
import {
  catalogueMaintenancePerHour,
  catalogueOperatingPerHour,
  deviations,
  litersNeededForBreakEven,
  priceNeededForBreakEven,
  type Deviation,
} from './deviations.js';
import {
  amount,
  amountValue,
  decimal,
  hours,
  integer,
  money,
  percentFromBp,
  percentFromRatio,
  ratio,
  table,
} from './format.js';
import {
  GDD_119_ASSUMPTION,
  MINIMUM_SETUP,
  SCENARIOS,
  STAGGERED_SETUP,
  STARTING_CAPITAL,
} from './scenarios.js';
import { CROP_FAMILY_LABELS, SEASON_LABELS, STORAGE_CATEGORY_LABELS } from './vocabulary.js';
import { WEED_STATES_LABEL, type WeedAnalysis } from './weeds.js';

export interface ReportInput {
  readonly kpis: ReadonlyMap<string, BalanceKpis>;
  /** The same setup run once per crop of the catalogue, keyed by identifier. */
  readonly catalogue: ReadonlyMap<CropId, BalanceKpis>;
  readonly weeds: WeedAnalysis;
  readonly contractVersion: string;
}

/** The whole report, as markdown. Deterministic: two runs produce identical bytes. */
export function renderReport(input: ReportInput): string {
  const minimum = required(input.kpis, MINIMUM_SETUP.key);
  const staggered = required(input.kpis, STAGGERED_SETUP.key);
  const published = required(input.kpis, GDD_119_ASSUMPTION.key);
  const rows = deviations(minimum, published, input.weeds);

  return [
    header(input.contractVersion),
    sectionMethod(),
    sectionKpis(input.kpis),
    sectionSetup(minimum),
    sectionHoldingCost(minimum, staggered),
    sectionRevenue(minimum, published, input.weeds),
    sectionDeviations(rows),
    sectionWeeds(input.weeds),
    sectionBreakEven(minimum, staggered),
    sectionCatalogue(input.catalogue),
    sectionConsequences(),
  ].join('\n\n');
}

function required<K>(kpis: ReadonlyMap<K, BalanceKpis>, key: K): BalanceKpis {
  const value = kpis.get(key);
  if (value === undefined) {
    throw new Error(`El informe necesita el escenario ${key} y no se ha evaluado.`);
  }
  return value;
}

function header(contractVersion: string): string {
  return [
    '# Informe de balance del MVP',
    '',
    `Generado por \`make balance\` desde \`tools/balance/\`. Contrato compartido ${contractVersion}.`,
    '',
    'Documento generado. No se edita a mano: cualquier cifra que haya que cambiar se cambia en',
    '`shared/config/`, que es de donde salen todas.',
  ].join('\n');
}

function sectionMethod(): string {
  return [
    '## 1. Alcance y metodo',
    '',
    'La calculadora importa las mismas constantes que el juego, desde `shared/config/`, y las',
    'mismas reglas puras, desde `shared/rules/`. No hay ninguna cifra escrita en la herramienta:',
    'el coste de posesion se obtiene con la misma integral de solapes que el servidor liquida, y',
    'el rendimiento con la misma formula de GDD §83 que aplica la cosecha. Si se retoca una',
    'constante, este informe se mueve con ella.',
    '',
    'La implementacion original aplicaba el balance del GDD sin modificarlo, y este informe midio',
    'que el resultado quedaba un orden de magnitud por debajo del objetivo del propio documento.',
    'La revision de balance de 2026-08 (`docs/balance/revision-2026-08.md`) ajusto cuatro grupos de',
    'constantes: el precio de venta del trigo, las tasas horarias de la maquinaria, la recta',
    'salarial y los estados en los que crecen las malezas. El informe compara ahora el catalogo',
    'revisado con lo que el GDD publica, y senala en cada desviacion si procede del GDD o de la',
    'revision.',
    '',
    'El informe no lleva marca de tiempo. Dos ejecuciones sobre el mismo catalogo producen bytes',
    'identicos, de modo que la unica razon por la que este fichero cambia es que ha cambiado una',
    'constante, que es lo que lo hace util en revision y en integracion continua.',
  ].join('\n');
}

function sectionKpis(kpis: ReadonlyMap<string, BalanceKpis>): string {
  const rows = SCENARIOS.map((named) => {
    const value = required(kpis, named.key);
    return [
      named.title,
      money(value.minimumSetupCost),
      money(value.holdingCostPerCycle),
      money(value.revenuePerCycle),
      value.revenueToCostRatio === null ? '—' : ratio(value.revenueToCostRatio),
      value.gameHoursToFirstBreakEven === null
        ? 'No existe'
        : hours(value.gameHoursToFirstBreakEven),
      money(value.capitalCushionAfterSetup),
    ];
  });

  return [
    '## 2. Los seis KPI de GDD §125',
    '',
    'Uno por columna, en el orden en que GDD §125 los enumera. El objetivo que la propia seccion',
    'recomienda para el MVP es un ratio ingreso/coste entre 1,3 y 1,8 en el primer ciclo jugado de',
    'forma eficiente.',
    '',
    table(
      [
        'Escenario',
        '1. Setup minimo',
        // §114 llama coste de posesion a `maintenance + salary` y situa `operatingCost` en un
        // nivel propio; el KPI 2 publicado suma los cuatro devengos, que es lo que el
        // denominador de §121 necesita (errata 34). El rotulo lo dice, para que nadie compare
        // esta columna con los 27.625 $ de §118 creyendo que son la misma magnitud.
        '2. Coste por ciclo (posesion + operacion)',
        '3. Ingreso por ciclo',
        '4. Ratio ingreso/coste',
        '5. Horas hasta equilibrio',
        '6. Colchon tras setup',
      ],
      rows,
    ),
    '',
    ...SCENARIOS.map((named) => `- **${named.title}**: ${named.purpose}`),
  ].join('\n');
}

function sectionSetup(minimum: BalanceKpis): string {
  return [
    '## 3. Reproduccion de GDD §117: el setup minimo viable',
    '',
    'Se reproduce exactamente. Las tres partidas y su suma salen del catalogo de precios de GDD',
    '§115 y §116 sin ningun ajuste.',
    '',
    table(
      ['Partida', 'GDD §117', 'Calculado', 'Coincide'],
      [
        [
          `Tierra, ${integer(minimum.setup.landCells)} celdas de pradera`,
          '39.600,00 $',
          money(minimum.setup.land),
          si(Money.compare(minimum.setup.land, Money.fromUnits(39_600)) === 0),
        ],
        [
          'Edificios (garaje, silo y vivienda)',
          '23.000,00 $',
          money(minimum.setup.buildings),
          si(Money.compare(minimum.setup.buildings, Money.fromUnits(23_000)) === 0),
        ],
        [
          'Maquinaria minima (cinco maquinas)',
          '83.500,00 $',
          money(minimum.setup.machinery),
          si(Money.compare(minimum.setup.machinery, Money.fromUnits(83_500)) === 0),
        ],
        [
          'Total de arranque',
          '146.100,00 $',
          money(minimum.setup.total),
          si(Money.compare(minimum.setup.total, Money.fromUnits(146_100)) === 0),
        ],
        [
          'Capital inicial',
          '160.000,00 $',
          money(STARTING_CAPITAL),
          si(Money.compare(STARTING_CAPITAL, Money.fromUnits(160_000)) === 0),
        ],
        [
          'Colchon tras el setup',
          '13.900,00 $',
          money(minimum.capitalCushionAfterSetup),
          si(Money.compare(minimum.capitalCushionAfterSetup, Money.fromUnits(13_900)) === 0),
        ],
      ],
    ),
    '',
    'Se cumple la regla de GDD §47: el capital alcanza para arrancar y no para comprarlo todo.',
    afterSetupSentence(minimum),
  ].join('\n');
}

/**
 * Lo que el colchon de GDD §117 alcanza a comprar, derivado del catalogo.
 *
 * Se enuncia sobre la suma, que es como §117 formula la restriccion, y no como tres
 * restricciones individuales: dos de las tres no se sostienen. Contratar no mueve dinero en
 * esta implementacion (errata 47), de modo que el segundo trabajador cuesta su salario
 * continuo de §107 y no una tarifa; lo que de verdad lo limita es la vivienda de §116.
 */
function afterSetupSentence(minimum: BalanceKpis): string {
  const workshop = BUILDING_CATALOGUE.WORKSHOP.purchasePrice;
  const cultivator = MACHINE_CATALOGUE.CULTIVATOR.purchasePrice;
  const both = Money.add(workshop, cultivator);
  const cushion = minimum.capitalCushionAfterSetup;
  const fitsWorkshop = Money.compare(cushion, workshop) >= 0;
  const fitsCultivator = Money.compare(cushion, cultivator) >= 0;
  const fitsBoth = Money.compare(cushion, both) >= 0;
  const oneOf =
    fitsWorkshop && fitsCultivator
      ? 'el taller o el cultivador, pero no los dos'
      : fitsWorkshop
        ? 'el taller y no el cultivador'
        : fitsCultivator
          ? 'el cultivador y no el taller'
          : 'ninguno de los dos';
  return (
    `Con un colchon de ${money(cushion)} el jugador puede permitirse ${oneOf}: el taller ` +
    `cuesta ${money(workshop)} y el cultivador ${money(cultivator)}, y juntos ${money(both)}` +
    `${fitsBoth ? '' : ', por encima del colchon'}. Contratar a un segundo trabajador no ` +
    'mueve dinero (§102 leido como politica de deuda, errata 47): cuesta su salario continuo ' +
    'de §107 y lo limita la capacidad de la vivienda de §116.'
  );
}

function sectionHoldingCost(minimum: BalanceKpis, staggered: BalanceKpis): string {
  const phases = minimum.phases.map((phase) => [
    phase.operation ?? `Fase ${phase.state}`,
    phase.state,
    hours(phase.gameHours),
    phase.machineTypes.length === 0 ? '—' : phase.machineTypes.join(', '),
  ]);

  return [
    '## 4. Reproduccion de GDD §118: el coste de sostener el primer ciclo',
    '',
    '### 4.1 Duracion del ciclo',
    '',
    'Las cuatro duraciones que GDD §118 publica se reproducen dentro de su propio redondeo. La',
    'duracion de cada operacion sale de `workSpeed` de GDD §89 y del factor de habilidad de GDD',
    '§103; las tres fases de crecimiento son el reparto de la seccion 2.2 del plan, que preserva a',
    'la vez el `growthDuration` de 96 h de GDD §82 y el ciclo de unas 325 h de GDD §118.',
    '',
    table(['Tramo', 'Estado del campo', 'Duracion', 'Maquinaria'], phases),
    '',
    `Duracion total del ciclo: **${hours(minimum.cycleGameHours)}**, frente a las 325 h de GDD §118.`,
    '',
    '### 4.2 Coste de posesion',
    '',
    'Aqui aparece la primera desviacion de fondo. GDD §118 supone unos 70 $/h de mantenimiento',
    'combinado; ya el catalogo literal de GDD §89 producia solo 37 $/h (unicamente el tractor y la',
    'cosechadora declaran `maintenanceCost`), y la revision de balance de 2026-08 dejo las tasas en',
    'la mitad (tractor 6 $/h, cosechadora 15 $/h). Ademas GDD §118 omite el `operatingCost`, que',
    'GDD §107 y §114 declaran aditivo al mantenimiento.',
    '',
    table(
      ['Concepto', 'GDD §118', 'Calculado', 'Nota'],
      [
        [
          'Salarios del ciclo',
          '4.875,00 $',
          money(minimum.holding.wages),
          'Reproducible; la diferencia es el redondeo del ciclo a 325 h.',
        ],
        [
          'Mantenimiento por hora',
          '~70,00 $/h',
          `${money(catalogueMaintenancePerHour())}/h`,
          'No reproducible: los implementos no tienen mantenimiento en GDD §89.',
        ],
        [
          'Mantenimiento del ciclo',
          '22.750,00 $',
          money(minimum.holding.maintenance),
          'Consecuencia de la fila anterior.',
        ],
        [
          'Operacion por hora (maquinas trabajando)',
          'No contabilizado',
          `${money(catalogueOperatingPerHour())}/h`,
          'GDD §107 y §114 lo declaran aditivo; GDD §118 lo omite.',
        ],
        [
          'Operacion del ciclo',
          'No contabilizado',
          money(minimum.holding.operating),
          'Solo durante las tareas activas, por integral de solapes.',
        ],
        [
          'Interes de descubierto',
          'No contemplado',
          money(minimum.holding.interest),
          `Tasa ${percentFromBp(OVERDRAFT_INTEREST_BP_PER_GAME_HOUR)} por hora de juego.`,
        ],
        [
          'Coste total del ciclo (posesion + operacion)',
          '27.625,00 $',
          money(minimum.holding.total),
          'No reproducible: dos desviaciones de signo contrario que se compensan en parte.',
        ],
      ],
    ),
    '',
    'La compra escalonada que GDD §120 recomienda es la palanca que el propio sistema ya habilita.',
    `Con ella el coste de posesion del ciclo baja a ${money(staggered.holdingCostPerCycle)}, es decir ${money(Money.sub(minimum.holdingCostPerCycle, staggered.holdingCostPerCycle))} menos, porque el mantenimiento de cada maquina solo corre desde que se compra.`,
  ].join('\n');
}

function sectionRevenue(minimum: BalanceKpis, published: BalanceKpis, weeds: WeedAnalysis): string {
  return [
    '## 5. Reproduccion de GDD §119: el ingreso de la primera cosecha',
    '',
    'La formula de rendimiento de GDD §83 y la curva de penalizacion de GDD §78 reproducen el',
    'numero publicado **exactamente**, siempre que se les de el nivel de malezas que el propio',
    'GDD §119 supone. Lo que no se reproduce es ese nivel de malezas, y el apartado 7 lo desarrolla.',
    '',
    table(
      ['Concepto', 'GDD §119', 'Con la hipotesis de §119', 'Con la tasa de §82'],
      [
        [
          'Nivel de malezas al cosechar',
          '~20 %',
          percentFromBp(published.weedLevelAtHarvestBp),
          percentFromBp(weeds.levelAtHarvestBp),
        ],
        [
          'Penalizacion de GDD §78',
          '~8 %',
          percentFromRatio(published.yield.weedPenalty),
          percentFromRatio(weeds.penalty),
        ],
        [
          'Rendimiento',
          '~20.700 L',
          `${integer(published.yield.liters)} L`,
          `${integer(weeds.liters)} L`,
        ],
        [
          'Ingreso',
          '~4.554,00 $',
          money(published.revenuePerCycle),
          money(minimum.revenuePerCycle),
        ],
      ],
    ),
    '',
    `El precio de venta es ${money(WHEAT.sellPricePerLiter)} por litro, fijo y sin fluctuacion (GDD §123). Es el precio de la revision de balance de 2026-08: el 0,22 $/L de GDD §82 hacia inviable cualquier ciclo y fue la constante que la revision senalo como mas desproporcionada.`,
  ].join('\n');
}

function sectionDeviations(rows: readonly Deviation[]): string {
  const notReproducible = rows.filter((row) => !row.reproducible);
  const reproducible = rows.filter((row) => row.reproducible);

  return [
    '## 6. Valores del GDD que su propio catalogo no reproduce',
    '',
    `De las ${rows.length} cifras publicadas que la calculadora comprueba, ${reproducible.length} se reproducen y ${notReproducible.length} no. La columna "calculado" es lo que sale del catalogo implementado, que desde la revision de 2026-08 se aparta deliberadamente del GDD en el precio de venta, las tasas de maquinaria, la recta salarial y los estados de malezas; la columna "causa" distingue las desviaciones internas del GDD de las introducidas por la revision.`,
    '',
    '### 6.1 No reproducibles',
    '',
    table(
      ['Seccion', 'Concepto', 'Publicado', 'Calculado', 'Causa'],
      notReproducible.map((row) => [
        row.section,
        row.concept,
        row.published,
        row.computed,
        row.cause,
      ]),
    ),
    '',
    '### 6.2 Reproducibles',
    '',
    'Se enumeran porque un informe que solo listara los desajustes daria a entender que el',
    'catalogo no sostiene el documento, y no es el caso: la mayor parte de las cifras del GDD',
    'salen de sus propias constantes.',
    '',
    table(
      ['Seccion', 'Concepto', 'Publicado', 'Calculado'],
      reproducible.map((row) => [row.section, row.concept, row.published, row.computed]),
    ),
  ].join('\n');
}

function sectionWeeds(weeds: WeedAnalysis): string {
  return [
    '## 7. Efecto de la tasa de malezas de GDD §82 sobre el primer ciclo',
    '',
    'Es el hallazgo principal del informe y el que mas dinero mueve.',
    '',
    `GDD §82 fija \`weedGrowthRate\` en ${decimal(weeds.ratePerGameHourBp / 100)} %/h. Desde la revision de 2026-08 las malezas crecen solo en los estados ${WEED_STATES_LABEL.join(', ')} (lectura estricta del hallazgo H8), que en este ciclo suman ${hours(weeds.growingGameHours)} de las ${hours(weeds.cycleGameHours)} totales: las tareas de arado y cosecha, durante las que el campo esta siendo trabajado, quedan excluidas, igual que las fases de sembrado y germinacion.`,
    '',
    table(
      ['Magnitud', 'Valor'],
      [
        ['Tasa de GDD §82', `${decimal(weeds.ratePerGameHourBp / 100)} %/h`],
        ['Horas del ciclo con crecimiento de malezas', hours(weeds.growingGameHours)],
        ['Horas necesarias para saturar al 100 %', hours(weeds.saturationGameHours)],
        ['Nivel proyectado sin techo', `${decimal(weeds.unclampedLevelBp / 100)} %`],
        ['Nivel efectivo al cosechar', percentFromBp(weeds.levelAtHarvestBp)],
        ['Penalizacion de GDD §78 a ese nivel', percentFromRatio(weeds.penalty)],
        ['Rendimiento resultante', `${integer(weeds.liters)} L`],
        ['Ingreso resultante', money(weeds.revenue)],
        ['Rendimiento que supone GDD §119', `${integer(weeds.publishedLiters)} L`],
        ['Ingreso que supone GDD §119', money(weeds.publishedRevenue)],
        ['Diferencia de rendimiento', `${integer(weeds.litersLost)} L`],
        ['Diferencia de ingreso', money(weeds.revenueLost)],
      ],
    ),
    '',
    '### 7.1 CULTIVATE no cambia el ingreso del ciclo',
    '',
    'La seccion 2.2 del plan preveia que `CULTIVATE`, que GDD §82 declara opcional para el trigo,',
    'tuviera un uso estrategico real: resetear las malezas antes de sembrar. La calculadora mide',
    'ese supuesto y, bajo la lectura H8 de la revision de 2026-08, no se sostiene.',
    '',
    `Aunque el jugador cultive justo antes de sembrar, quedan ${hours(weeds.growingGameHoursAfterSowing)} de crecimiento de malezas hasta la cosecha, que a ${decimal(weeds.ratePerGameHourBp / 100)} %/h llevan el nivel a ${percentFromBp(weeds.levelAfterCultivateBp)}. ${
      weeds.levelAfterCultivateBp === weeds.levelAtHarvestBp
        ? 'Es exactamente el mismo nivel que sin cultivar: toda la acumulacion es posterior a la ' +
          'siembra, de modo que el reseteo no toca el ingreso del ciclo. Devolver a las malezas ' +
          'un papel de decision queda registrado como asunto abierto de la revision.'
        : 'Cultivar reduce el nivel al cosechar en ' +
          `${decimal((weeds.levelAtHarvestBp - weeds.levelAfterCultivateBp) / 100)} puntos.`
    }`,
    '',
    '### 7.2 Que valor tendria que tener la tasa',
    '',
    `Para que el nivel de malezas al cosechar fuera el 20 % que GDD §119 supone, la tasa tendria que ser ${decimal(weeds.rateThatWouldReachPublishedLevelBp / 100, 4)} %/h en lugar de ${decimal(weeds.ratePerGameHourBp / 100)} %/h, es decir unas ${decimal(weeds.ratePerGameHourBp / weeds.rateThatWouldReachPublishedLevelBp)} veces menos.`,
    '',
    'Se deja constancia y no se aplica: la revision de 2026-08 mantuvo la tasa de GDD §82 y',
    'corrigio los estados de acumulacion, que era la desviacion de mas peso.',
  ].join('\n');
}

function sectionBreakEven(minimum: BalanceKpis, staggered: BalanceKpis): string {
  const priceNeeded = priceNeededForBreakEven(minimum);
  const litersNeeded = litersNeededForBreakEven(minimum);

  return [
    '## 8. Punto de equilibrio de GDD §121 y magnitud de las palancas de GDD §120',
    '',
    '```text',
    'breakEvenCycles = totalUpfrontInvestment / (revenuePerCycle - holdingCostPerCycle)',
    '```',
    '',
    'GDD §121 declara que un denominador negativo significa que no hay equilibrio y que la granja',
    'quiebra, y anade que es el KPI principal a vigilar. Con el catalogo literal era exactamente el',
    'caso; con la revision de 2026-08 el margen es positivo en los dos escenarios: ajustado en la',
    'compra completa, que es el episodio de deuda de caja buscado por diseno, y claro en la compra',
    'escalonada, que es la estrategia que GDD §120 recomienda.',
    '',
    table(
      ['Escenario', 'Ingreso por ciclo', 'Coste por ciclo', 'Margen', 'Ciclos hasta equilibrio'],
      [
        [
          MINIMUM_SETUP.title,
          money(minimum.revenuePerCycle),
          money(minimum.holdingCostPerCycle),
          money(minimum.netPerCycle),
          minimum.breakEvenCycles === null ? 'No existe' : decimal(minimum.breakEvenCycles),
        ],
        [
          STAGGERED_SETUP.title,
          money(staggered.revenuePerCycle),
          money(staggered.holdingCostPerCycle),
          money(staggered.netPerCycle),
          staggered.breakEvenCycles === null ? 'No existe' : decimal(staggered.breakEvenCycles),
        ],
      ],
    ),
    '',
    'Magnitud de cada palanca de GDD §120 respecto del punto de equilibrio del ciclo, sobre el',
    'escenario de compra completa. Son cifras informativas que situan el margen actual; ninguna se',
    'aplica sobre el catalogo.',
    '',
    table(
      ['Palanca', 'Que haria falta'],
      [
        [
          'A. Reducir el coste de posesion',
          `Bajarlo de ${money(minimum.holdingCostPerCycle)} a menos de ${money(
            minimum.revenuePerCycle,
          )}, es decir un ${decimal(
            (1 -
              Number(Money.toDisplay(minimum.revenuePerCycle)) /
                Number(Money.toDisplay(minimum.holdingCostPerCycle))) *
              100,
          )} % menos.`,
        ],
        [
          'B1. Subir el precio de venta',
          `De ${money(WHEAT.sellPricePerLiter)}/L a ${money(priceNeeded)}/L con el rendimiento ` +
            'efectivo del ciclo.',
        ],
        [
          'B2. Subir el rendimiento',
          `De ${integer(minimum.yield.liters)} L a ${integer(litersNeeded)} L por ciclo al precio ` +
            'publicado, lo que con 90 L por celda exigiria un campo de ' +
            `${integer(litersNeeded / WHEAT.baseYieldPerCellLiters)} celdas si no hubiera ` +
            'penalizacion.',
        ],
        [
          'C. Acortar el ciclo economico',
          'El multiplicador de tiempo es configuracion de servidor (plan seccion 6.1) y no cambia ' +
            'el balance: todos los costes del GDD estan por hora de juego, de modo que acelerar el ' +
            'reloj acelera por igual el ingreso y el gasto. Lo que si acorta el ciclo economico es ' +
            '`growthDuration` de GDD §82.',
        ],
      ],
    ),
  ].join('\n');
}

/**
 * The catalogue, one row per crop, on the setup of GDD section 117.
 *
 * Deliberately not one section per crop. Sixty two narratives would be four thousand lines
 * nobody reads and would turn every retune of a constant into a diff nobody can review. The
 * question a designer asks with sixty two crops is not "what does the beet yield" but "is
 * any crop broken, and how far apart are they", and that is what a table and a dispersion
 * answer in two screens.
 */
function sectionCatalogue(catalogue: ReadonlyMap<CropId, BalanceKpis>): string {
  const rows = CROP_IDS.map((cropId) => {
    const crop = CROPS[cropId];
    const value = catalogue.get(cropId);
    if (value === undefined) {
      throw new Error(`El informe necesita los KPI del cultivo ${cropId} y no se han evaluado.`);
    }
    return [
      crop.nameEs,
      CROP_FAMILY_LABELS[crop.family],
      STORAGE_CATEGORY_LABELS[crop.storageResource],
      crop.sowingSeasons.map((season) => SEASON_LABELS[season]).join(', '),
      hours(value.cycleGameHours),
      integer(crop.baseYieldPerCellLiters),
      amount(crop.sellPricePerLiter),
      money(value.revenuePerCycle),
      money(value.holdingCostPerCycle),
      money(value.netPerCycle),
      decimal(netPerGameHour(value), 2),
    ];
  });

  const margins = CROP_IDS.map((cropId) => netPerGameHour(required(catalogue, cropId)));
  const sorted = [...margins].sort((left, right) => left - right);
  const middle = median(sorted);
  const lowest = sorted[0] ?? 0;
  const highest = sorted[sorted.length - 1] ?? 0;
  const outliers = CROP_IDS.filter(
    (cropId) =>
      Math.abs(netPerGameHour(required(catalogue, cropId)) - middle) > 0.5 * Math.abs(middle),
  );

  return [
    '## 9. El catalogo de cultivos',
    '',
    'Los sesenta y dos cultivos sobre el mismo setup de GDD §117: la misma tierra, los mismos',
    'edificios, la misma maquinaria y el mismo trabajador. Solo cambia el cultivo, de modo que la',
    'tabla compara los cultivos y nada mas. El margen por hora es lo que hay que mirar: un ciclo',
    'largo con mas margen por ciclo puede rendir menos que uno corto que se repite.',
    '',
    '### 9.1 Tabla comparativa',
    '',
    table(
      [
        'Cultivo',
        'Familia',
        'Almacen',
        'Siembra',
        'Ciclo',
        'Rendimiento (L/celda)',
        'Precio (/L)',
        'Ingreso / ciclo',
        'Coste / ciclo',
        'Margen / ciclo',
        'Margen / hora',
      ],
      rows,
    ),
    '',
    '### 9.2 Dispersion',
    '',
    'La cifra sobre la que se actua. Un catalogo bien afinado tiene los sesenta y dos cerca de la',
    'mediana; uno roto tiene un cultivo que domina y sesenta y uno que nadie sembraria.',
    '',
    table(
      ['Magnitud', 'Margen por hora de juego'],
      [
        ['Minimo', decimal(lowest, 2)],
        ['Mediana', decimal(middle, 2)],
        ['Maximo', decimal(highest, 2)],
        ['Razon maximo/minimo', lowest === 0 ? '—' : ratio(highest / lowest)],
      ],
    ),
    '',
    '### 9.3 Cultivos fuera de banda',
    '',
    outliers.length === 0
      ? 'Ninguno se aparta de la mediana en mas de la mitad de su valor. Esta seccion crece solo cuando hay un problema.'
      : [
          'Se apartan de la mediana en mas de la mitad de su valor:',
          '',
          ...outliers.map((cropId) => {
            const margin = netPerGameHour(required(catalogue, cropId));
            const direction = margin > middle ? 'por encima' : 'por debajo';
            return `- **${CROPS[cropId].nameEs}**: ${decimal(margin, 2)} por hora, ${direction} de la mediana de ${decimal(middle, 2)}.`;
          }),
        ].join('\n'),
    '',
    '### 9.4 Cobertura estacional',
    '',
    'Cuantos cultivos de cada familia admite cada estacion. Una estacion sin ningun cultivo viable',
    'seria un trimestre muerto, y aqui se ve de un vistazo.',
    '',
    table(
      ['Familia', ...SEASONS.map((season) => SEASON_LABELS[season])],
      CROP_FAMILIES.map((family) => [
        CROP_FAMILY_LABELS[family],
        ...SEASONS.map((season) =>
          integer(
            CROP_IDS.filter(
              (cropId) =>
                CROPS[cropId].family === family && CROPS[cropId].sowingSeasons.includes(season),
            ).length,
          ),
        ),
      ]),
    ),
  ].join('\n');
}

/** Net per game hour of a cycle, which is what compares two crops of unlike length. */
function netPerGameHour(value: BalanceKpis): number {
  return value.cycleGameHours <= 0 ? 0 : amountValue(value.netPerCycle) / value.cycleGameHours;
}

/**
 * Median of a sorted list.
 *
 * The tie break is declared rather than left to whichever element happens to land in the
 * middle: the catalogue can change parity when a crop is added, and the report is
 * deterministic byte for byte, so an undeclared rule would make the file move for a reason
 * that has nothing to do with a constant changing.
 */
function median(sorted: readonly number[]): number {
  if (sorted.length === 0) {
    return 0;
  }
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function sectionConsequences(): string {
  return [
    '## 10. Consecuencias ya implementadas',
    '',
    'Tras la revision de 2026-08 el deficit ya no es el estado permanente del ciclo, pero el paso',
    'por deuda sigue siendo parte del diseno: quien compra toda la flota el dia uno devenga mas que',
    'el colchon de capital antes de vender la cosecha y atraviesa `IN_DEBT` durante la cosecha. Lo',
    'que el juego hace con el saldo negativo esta implementado y probado, no pendiente:',
    '',
    `- **Saldo negativo permitido.** El devengo continuo puede llevar el saldo por debajo de cero`,
    '  sin ninguna restriccion de base de datos que lo impida, porque impedirlo rechazaria el',
    '  propio devengo (plan seccion 6.2).',
    '- **`IN_DEBT` derivado.** Bloquea el gasto discrecional y no bloquea vender ni asignar tareas,',
    '  que son la unica via de ingreso. Bloquearlas produciria un bloqueo permanente.',
    `- **Interes de descubierto** como cuarto tipo de devengo, con tasa ${percentFromBp(OVERDRAFT_INTEREST_BP_PER_GAME_HOUR)} por hora de juego. Existe para ser una`,
    '  palanca disponible sin migracion; con el episodio de deuda de caja del primer ciclo como',
    '  parte del diseno, cobrarlo es una decision de balance pendiente y no un valor olvidado.',
    `- **Liquidacion forzosa** por encima del ${percentFromBp(LIQUIDATION_DEBT_THRESHOLD_BP)} del valor liquidable, en el orden publicado (${LIQUIDATION_STEPS.join(', ')}), con un asiento por activo vendido para que el resumen de`,
    '  regreso pueda explicar que se vendio y por que. La dispara el barrido periodico y no el',
    '  login, de modo que nunca aparece como castigo retroactivo por haber estado ausente.',
    `- **Factor de reventa** del ${percentFromBp(RESALE_FACTOR_BP)}, escalado ademas por la condicion en el caso de la maquinaria.`,
    '- **`BANKRUPT` reservado y nunca producido.** Terminar la partida de alguien que estaba',
    '  desconectado no es aceptable en un juego asincrono.',
    '',
    'Alcance real de la liquidacion en esta fase, para que el informe no prometa mas de lo que el',
    'codigo hace: de los seis pasos del orden publicado estan activos INVENTORY, IDLE_MACHINES y',
    'WORKERS. Los otros tres estan declarados y sin estrategia porque su semantica pertenece a otro',
    'modulo: CANCEL_TASKS a `modules/tasks`, BUILDINGS a `modules/farms` y UNUSED_LAND a',
    '`modules/world`. El motor recorre el orden completo y el asiento agregado de cada liquidacion',
    'registra los pasos que ejecuto y los que no.',
  ].join('\n');
}

/** Yes or no, written the way the rest of `docs/` writes it. */
function si(value: boolean): string {
  return value ? 'Si' : 'No';
}
