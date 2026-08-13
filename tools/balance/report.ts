// The Spanish report that `make balance` writes into docs/balance/.
//
// Owner: workflow W5-C. Tool `tools/balance`.
//
// GDD section 127 asks for sections 117 to 121 to be turned into a balance sheet outside the
// GDD, "donde las formulas se ajusten interactivamente, para evitar descubrir problemas de
// rentabilidad ya en produccion". This is that sheet, with one difference the plan is explicit
// about: nothing is adjusted here. The decision recorded in plan section 1 is to implement the
// balance of the GDD without touching it and to document the deviation, so the report is the
// deliverable that records it and not a gate that has to be brought into the green.
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
import { WHEAT } from '../../shared/config/crops.js';
import {
  LIQUIDATION_DEBT_THRESHOLD_BP,
  LIQUIDATION_STEPS,
  OVERDRAFT_INTEREST_BP_PER_GAME_HOUR,
  RESALE_FACTOR_BP,
} from '../../shared/config/economy.js';
import { MACHINE_CATALOGUE } from '../../shared/config/machines.js';
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
import { WEED_STATES_LABEL, type WeedAnalysis } from './weeds.js';

export interface ReportInput {
  readonly kpis: ReadonlyMap<string, BalanceKpis>;
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
    sectionConsequences(),
  ].join('\n\n');
}

function required(kpis: ReadonlyMap<string, BalanceKpis>, key: string): BalanceKpis {
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
    'La decision registrada en la seccion 1 del plan es implementar el balance del GDD sin',
    'modificarlo y documentar la desviacion. Por tanto ninguna constante se ajusta aqui. Cuando el',
    'informe cita el valor que una palanca deberia tener para que el ciclo cerrara en positivo, lo',
    'hace a titulo informativo y se indica expresamente que no se aplica.',
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
    'combinado y el catalogo de GDD §89 no lo produce: solo el tractor (12 $/h) y la cosechadora',
    '(25 $/h) declaran `maintenanceCost`, y los tres implementos no declaran ninguno. Ademas GDD',
    '§118 omite el `operatingCost`, que GDD §107 y §114 declaran aditivo al mantenimiento.',
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
    `El precio de venta es el de GDD §82, ${money(WHEAT.sellPricePerLiter)} por litro, fijo y sin fluctuacion (GDD §123).`,
  ].join('\n');
}

function sectionDeviations(rows: readonly Deviation[]): string {
  const notReproducible = rows.filter((row) => !row.reproducible);
  const reproducible = rows.filter((row) => row.reproducible);

  return [
    '## 6. Valores del GDD que su propio catalogo no reproduce',
    '',
    `De las ${rows.length} cifras publicadas que la calculadora comprueba, ${reproducible.length} se reproducen y ${notReproducible.length} no. Ninguna se ha ajustado: la columna "calculado" es lo que sale del catalogo tal y como esta implementado.`,
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
    `GDD §82 fija \`weedGrowthRate\` en ${decimal(weeds.ratePerGameHourBp / 100)} %/h. Las malezas crecen mientras el campo esta en uno de los estados de GDD §78 (${WEED_STATES_LABEL.join(', ')}), que en este ciclo suman ${hours(weeds.growingGameHours)} de las ${hours(weeds.cycleGameHours)} totales: cuentan la tarea de arado y la de cosecha, y no cuentan las fases de sembrado y germinacion.`,
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
    '### 7.1 CULTIVATE no evita la saturacion con la tasa publicada',
    '',
    'La seccion 2.2 del plan preveia que la consecuencia de implementar la tasa literal fuera dar',
    'a `CULTIVATE`, que GDD §82 declara opcional para el trigo, un uso estrategico real: resetear',
    'las malezas antes de sembrar. La calculadora mide ese supuesto y no se sostiene con estas',
    'constantes.',
    '',
    `Aunque el jugador cultive justo antes de sembrar, quedan ${hours(weeds.growingGameHoursAfterSowing)} de crecimiento de malezas hasta la cosecha —la fase \`GROWING\` mas la propia tarea de cosecha—, que a ${decimal(weeds.ratePerGameHourBp / 100)} %/h llevan el nivel a ${percentFromBp(weeds.levelAfterCultivateBp)}. ${
      weeds.cultivateAvoidsSaturation
        ? 'El nivel queda por debajo del techo, de modo que cultivar si reduce la penalizacion.'
        : 'El nivel vuelve a saturar, de modo que la penalizacion final sigue siendo la maxima y ' +
          'cultivar no cambia el ingreso del ciclo: solo adelanta el instante en que el campo ' +
          'vuelve a estar limpio.'
    }`,
    '',
    '### 7.2 Que valor tendria que tener la tasa',
    '',
    `Para que el nivel de malezas al cosechar fuera el 20 % que GDD §119 supone, la tasa tendria que ser ${decimal(weeds.rateThatWouldReachPublishedLevelBp / 100, 4)} %/h en lugar de ${decimal(weeds.ratePerGameHourBp / 100)} %/h, es decir unas ${decimal(weeds.ratePerGameHourBp / weeds.rateThatWouldReachPublishedLevelBp)} veces menos.`,
    '',
    'Se deja constancia y **no se aplica**: la decision del usuario es implementar el catalogo del',
    'GDD sin tocarlo.',
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
    'quiebra, y anade que es el KPI principal a vigilar. Con las constantes sin ajustar es',
    'exactamente el caso.',
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
    'Magnitud de cada palanca de GDD §120, sobre el escenario de compra completa. Son cifras',
    'informativas: **ninguna se aplica**.',
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
            'saturado por malezas.',
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

function sectionConsequences(): string {
  return [
    '## 9. Consecuencias ya implementadas',
    '',
    'El deficit del primer ciclo no es un descuido del calculo: es el estado esperado con estas',
    'constantes, y por eso esta en el camino critico del diseno. Lo que el juego hace con el esta',
    'implementado y probado, no pendiente:',
    '',
    `- **Saldo negativo permitido.** El devengo continuo puede llevar el saldo por debajo de cero`,
    '  sin ninguna restriccion de base de datos que lo impida, porque impedirlo rechazaria el',
    '  propio devengo (plan seccion 6.2).',
    '- **`IN_DEBT` derivado.** Bloquea el gasto discrecional y no bloquea vender ni asignar tareas,',
    '  que son la unica via de ingreso. Bloquearlas produciria un bloqueo permanente.',
    `- **Interes de descubierto** como cuarto tipo de devengo, con tasa ${percentFromBp(OVERDRAFT_INTEREST_BP_PER_GAME_HOUR)} por hora de juego. Existe para ser una`,
    '  palanca disponible sin migracion; cobrarlo hoy solo profundizaria un deficit que el propio',
    '  GDD documenta.',
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
