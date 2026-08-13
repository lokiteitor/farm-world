# Revision adversarial de formulas y balance (W7-C)

Revision contradictoria de la implementacion frente al GDD v0.4. El objetivo declarado del
encargo es refutar que la implementacion respeta el documento, no confirmarlo: cada punto se
localiza en el codigo, se lee y, donde el valor es calculable, se ejecuta.

## 1. Metodo

Cada afirmacion marcada como CONFIRMADO procede de una ejecucion real, no de la lectura de un
comentario. Las ejecuciones se hicieron con una suite desechable montada fuera del
repositorio, en `/tmp/.../scratchpad/w7c`, que importa por ruta absoluta los modulos de
`shared/rules`, `shared/config`, `tools/balance` y `backend/src/modules/workers/pool.ts` y los
evalua con Vitest 4.1.10 (el binario de `shared/node_modules`). No se escribio en el
repositorio salvo en este fichero. No se levanto ningun servidor ni navegador.

Cuando una desviacion respecto al GDD esta recogida en `docs/erratas-gdd-stack.md` se indica
la entrada concreta y la desviacion no se contabiliza como defecto. El apartado 2 solo
enumera lo que no lo esta, mas una entrada ya registrada cuyo efecto sigue vivo en un
entregable publicado.

Estado general: `shared/config` reproduce literalmente los catalogos del GDD y las once
formulas revisadas estan implementadas donde el GDD las enuncia. Las cifras de §117, §118 y
§119 salen del catalogo con las desviaciones que el informe de balance ya declara. Los
hallazgos de este documento son de dos clases: dos desviaciones de comportamiento no
registradas (H2 y H3), una divergencia entre dos implementaciones de la misma regla (H4) y
tres defectos no registrados en el entregable generado por `tools/balance` (H1, H5 y H7), mas
uno ya registrado y todavia sin corregir (H6).

## 2. Hallazgos, por gravedad

| N. | Gravedad | Fichero | Estado |
|---|---|---|---|
| H1 | Grave | `tools/balance/deviations.ts:262` | CONFIRMADO. Defecto de codigo; publica una cifra falsa |
| H2 | Grave | `backend/src/modules/forestry/tasks.ts:520` y `533` | CONFIRMADO. Contradice §131, sin registrar |
| H3 | Media | `shared/config/machines.ts:352` | CONFIRMADO. Amplia §78, sin registrar |
| H4 | Media | `frontend/app/stores/fields.ts:137` | CONFIRMADO por ejecucion. Divergencia cliente-servidor |
| H5 | Media | `tools/balance/report.ts:220` | CONFIRMADO. Afirmacion falsa y literales incrustados |
| H6 | Baja | `tools/balance/deviations.ts:299` | CONFIRMADO. Ya registrado como errata 41, sin corregir |
| H7 | Baja | `tools/balance/report.ts:157` | CONFIRMADO. KPI 2 rotulado como §114 no lo es |
| H8 | Informativa | `shared/config/transitions.ts:138` | Lectura discutible de §78. Aplicada la lectura estricta en la revisión de balance de 2026-08 |
| H9 | Trivial | `shared/config/workers.ts:40` | CONFIRMADO. Comentario inexacto, sin efecto |

### H1. La calculadora publica «1 %» donde deberia publicar «147,6 %»

Fichero y linea: `tools/balance/deviations.ts:262-264`.

```ts
computed: `${bpToPercent(weeds.levelAtHarvestBp)} % (saturado; sin techo serian ${
  (weeds.unclampedLevelBp / 100, 1)
} %)`,
```

Que falla. La expresion entre llaves es un operador coma: evalua
`weeds.unclampedLevelBp / 100`, descarta el resultado y devuelve el literal `1`. Falta la
llamada a `decimal(...)`, que es la que el resto del fichero usa. El fichero compila y pasa
`lint` porque una expresion coma es sintaxis valida.

Caso concreto. `docs/balance/informe-balance.md:126` publica hoy, en la tabla de valores no
reproducibles, «100 % (saturado; sin techo serian 1 %)». El valor correcto es 147,64 %, y el
propio informe lo publica bien en su apartado 7 («Nivel proyectado sin techo | 147,64 %»),
porque esa tabla la genera `report.ts` por otro camino. El informe se contradice consigo
mismo en dos paginas, y la cifra erronea aparece precisamente en la fila que el informe
declara «el hallazgo principal».

Correccion propuesta. `decimal(weeds.unclampedLevelBp / 100, 1)`. Es la unica ocurrencia del
patron en `tools/balance/`, comprobado con `grep -rn "([A-Za-z0-9_.]* / [0-9_]*, [0-9])"`.
Conviene ademas una regla de lint que prohiba el operador coma (`no-sequences` de ESLint), que
es la unica defensa estructural frente a esta clase de error.

### H2. Una tala por lote destruye los plantones, que §131 declara no talables

Ficheros y lineas: `backend/src/modules/forestry/tasks.ts:489-495` (recuento),
`:520` (marcado), `:533-542` (`markTreesForHarvest`), `:877-882` (finalizacion).

Que dice el GDD. §131 fija en su tabla, columna «Talable», el valor «No» para `SAPLING`, y le
asigna «sin valor comercial». §135 define `woodProduced = Σ tree.woodVolume` sobre «arboles
talados en el lote».

Que hace el codigo. La asignacion carga todos los arboles vivos del area
(`LIVE_TREE_STATUSES = [STANDING, MARKED_FOR_HARVEST]`), comprueba unicamente que
`fellableCount > 0` y a continuacion marca **todos** los arboles vivos, sin filtrar por fase:

```ts
await markTreesForHarvest(context.tx, trees);   // linea 520
// ...
where: { id: { in: trees.map((tree) => tree.id) }, status: TreeStatus.STANDING },  // linea 538
```

El unico filtro de `markTreesForHarvest` es el estado `STANDING`, nunca la fase. La
finalizacion tala todo lo marcado (`status: FELLED`, linea 881) y calcula el volumen con
`batchWoodVolume`, que si excluye los plantones. La regla pura que expresa la restriccion de
§131, `isFellable` de `shared/rules/forestry.ts:144`, solo se usa para contar; no filtra nada.

Caso concreto. Con la mezcla del generador (`NATURAL_FOREST.stageMixBp.SAPLING = 800`), una
parcela de 250 celdas recien comprada lleva unos 20 plantones. Una tala del lote completo
—que es el unico gesto que §141 admite en el MVP— los pasa a `FELLED` y produce 0 dm3 por cada
uno. El jugador pierde 20 arboles que a `OLD_GROWTH` habrian valido 20 x 2,5 m3 x 45 $ = 2.250 $,
sin aviso, sin asiento y sin ninguna forma de excluirlos desde la interfaz.

Ademas el comportamiento es internamente incoherente y ademas inestable en el tiempo: si un
planton se marca a la edad de 100 h y la tala de 250 arboles dura 312,5 h a 0,8 arboles/h
(§134, §135), en el instante de la finalizacion ese arbol ya tiene 412 h, `treeStageAt`
devuelve `YOUNG` y si aporta sus 400 dm3. De modo que hoy el que un planton pague o no depende
de cuanto dure la tala, que es exactamente el tipo de resultado que ninguna de las dos
lecturas de §131 admite.

Correccion propuesta. Filtrar el conjunto que se marca por `isFellable`, no por el estado de
la fila:

```ts
const fellable = trees.filter((tree) => isFellable(treeView(tree), context.reading.gameNow));
await markTreesForHarvest(context.tx, fellable);
```

`units` debe seguir siendo `batch.treeCount` (todos los vivos), porque la duracion de §135 se
mide sobre los arboles del area y esa lectura ya esta razonada en el propio fichero. Con ello
el planton estorba —cuesta tiempo de maquina— pero no se destruye, que es lo que §131 y §137
describen conjuntamente. La alternativa, incluir el volumen del planton en la produccion,
contradice «sin valor comercial» y ademas invalidaria la errata 40, que fija la produccion de
una tala en 1.530 dm3 por celda precisamente por excluirlos.

### H3. La cosecha reinicia el nivel de malezas, y §78 solo se lo atribuye a `CULTIVATE`

Ficheros y lineas: `shared/config/machines.ts:352` (`resetsWeedLevel: true` en la fila
`HARVEST`), aplicado en `backend/src/modules/fields/service.ts:406`.

Que dice el GDD. §78: «`CULTIVATE` lo reduce a 0». Es la unica via que la seccion enumera, y
la unica alternativa que menciona, los herbicidas, la deja fuera del MVP. §89 recoge el mismo
efecto como `sideEffect` exclusivo del cultivador. Ni §76, ni §83, ni §84 atribuyen ningun
efecto sobre las malezas a la cosecha; §84 termina el ciclo narrando la caida de fertilidad y
nada mas.

Que hace el codigo. La fila `HARVEST` de `OPERATION_REQUIREMENTS` declara
`resetsWeedLevel: true`, y `writeSettledField` escribe `weedLevelBp = 0` cuando la mutacion lo
pide. El rendimiento se calcula antes de la transicion, de modo que la penalizacion del ciclo
si se aplica: el efecto es sobre el ciclo siguiente, que arranca en `VIRGIN` con 0 % de
malezas en lugar de heredar el nivel acumulado.

Por que importa aunque hoy no mueva dinero. Con la tasa publicada de 0,6 %/h el nivel satura
dentro de un solo ciclo (166,67 h de las 246,07 h en que crecen), de modo que heredar 100 %
o heredar 0 % da el mismo rendimiento final y el efecto de balance medido hoy es nulo. Deja
de serlo en cuanto se toque la tasa, que es la palanca que el propio informe de balance
cuantifica en su apartado 7.2: con 0,0813 %/h, arrastrar el nivel entre ciclos frente a
reiniciarlo es la diferencia entre una penalizacion creciente y una constante. Es decir, es
una decision de balance tomada en el catalogo y no registrada en ninguna parte.

Correccion propuesta. No cambiar el comportamiento sin decidirlo: registrar la entrada
correspondiente en `docs/erratas-gdd-stack.md`, apartado 2, con la justificacion (la cosecha
retira la biomasa del campo junto con el cultivo) y la consecuencia (`CULTIVATE` pierde el
unico uso estrategico que el plan le atribuia tambien por esta via, y no solo por la
saturacion que la errata 1 ya describe). Si se prefiere la lectura literal, basta poner la
celda a `false`; el resto del camino no cambia.

### H4. El cliente proyecta las malezas de §78 con un algoritmo distinto al del servidor

Fichero y lineas: `frontend/app/stores/fields.ts:137-158`, frente a
`backend/src/modules/fields/projection.ts:227-249` (`settleWeedLevel`).

Que hace el servidor. Corta el intervalo `[weedLevelUpdatedAtGameMs, ahora)` en las fronteras
de fase con `phaseSegments` y acumula segmento a segmento, de modo que las horas en `SEEDED` y
`GERMINATING` no producen malezas, conforme a §78.

Que hace el cliente. Una sola llamada a `projectWeedLevel` sobre todo el intervalo, con el
estado proyectado **al instante final**:

```ts
const state = phaseAt(fieldId, atGameMs)?.state ?? field.cropCycleState;
const weedLevelBp = projectWeedLevel({ ..., updatedAtGameMs: fromWireGameMs(field.weedLevelUpdatedAtGameMs), toGameMs: atGameMs, cropCycleState: state, crop });
```

Si el estado final es de crecimiento y el intervalo cubre las 18 h de `SEEDED` mas
`GERMINATING`, esas 18 h se contabilizan como si hubieran producido malezas.

Caso concreto, CONFIRMADO por ejecucion. Campo sembrado en t0, `weedLevelUpdatedAtGameMs = t0`,
250 celdas, fertilidad 100 %:

| Instante | Servidor (bp) | Cliente (bp) | Rendimiento servidor | Rendimiento cliente | Diferencia |
|---|---|---|---|---|---|
| t0 + 18 h | 0 | 1.080 | 22.500 L | 21.528 L | 972 L |
| t0 + 30 h | 720 | 1.800 | 21.852 L | 20.880 L | 972 L |
| t0 + 96 h | 4.680 | 5.760 | 18.288 L | 16.974 L | 1.314 L |
| t0 + 120 h | 6.120 | 7.200 | 16.488 L | 15.029 L | 1.459 L |

El desfase es constante en 1.080 puntos base, que son exactamente las 18 h de las dos fases en
las que §78 no admite crecimiento.

Alcance real. La ventana en la que el defecto se observa esta acotada, porque
`fieldAdvancePhaseHandler` materializa cada frontera y emite `FIELD_UPSERTED` con el nivel y
la marca ya liquidados: en cuanto la trama llega, el intervalo del cliente vuelve a caer dentro
de una sola fase y las dos implementaciones coinciden. El defecto se observa mientras la
proyeccion del cliente va por delante de la fila almacenada, que es un estado que el propio
cliente documenta y ofrece (`operationsFromStoredState`), y que ocurre con el trabajador caido,
con un evento aun fuera del horizonte de agendado o simplemente en el intervalo entre el
vencimiento y la entrega de la trama.

Lo que lo convierte en un hallazgo y no en un detalle: el DTO ya trae la cifra autoritativa.
`buildFieldDto` publica `projection.weedLevelBp` y `projection.expectedYieldLiters` calculados
con el camino segmentado (`backend/src/modules/fields/service.ts:310-315`), y los dos paneles
que muestran el rendimiento —`FieldInspectorPanel.vue:103` y `FieldListPanel.vue:85`— prefieren
la proyeccion local. Se recalcula peor una cifra que ya venia bien.

Correccion propuesta. Dos opciones, en orden de preferencia:

1. Que el cliente muestre `field.projection.*` cuando `atGameMs` coincide con
   `projection.atGameMs`, y reserve la proyeccion local para extrapolar por delante de esa
   marca. Es un cambio en `stores/fields.ts` y en ningun sitio mas.
2. Si se conserva la proyeccion local, replicar la segmentacion: recorrer
   `projectCropPhase` desde `weedLevelUpdatedAtGameMs` acumulando por tramo, que es el bucle de
   ocho lineas de `settleWeedLevel`. Lo natural seria promover ese bucle a
   `shared/rules/yield.ts` para que exista una sola implementacion, que es lo que la seccion 8
   del plan exige de todas las reglas compartidas.

### H5. El informe afirma una asequibilidad que la implementacion desmiente

Fichero y linea: `tools/balance/report.ts:220`; efecto en
`docs/balance/informe-balance.md:56`.

```ts
`Con un colchon de ${money(minimum.capitalCushionAfterSetup)} el jugador no puede permitirse el taller (9.000 $), un segundo trabajador ni el cultivador (5.200 $).`
```

Tres problemas en una linea:

1. La afirmacion es falsa tal y como esta redactada. El colchon es 13.900,00 $ y el taller
   cuesta 9.000 $: el jugador si puede permitirselo. Lo que no puede es comprar los dos
   (9.000 + 5.200 = 14.200 $ > 13.900 $). §117 enuncia la restriccion en conjunto; el informe
   la reescribe como tres restricciones individuales y dos de las tres no se sostienen.
2. «Un segundo trabajador» no cuesta dinero en esta implementacion. La errata 47 y
   `backend/src/modules/workers/service.ts:24-27` establecen que contratar no mueve dinero, no
   escribe asiento y no lleva clave de idempotencia; el unico bloqueo economico es la politica
   de deuda. La restriccion real al segundo trabajador es la capacidad de la vivienda de §116,
   que son cuatro plazas y por tanto no lo impide. La afirmacion no describe el juego.
3. Las cifras 9.000 y 5.200 estan escritas a mano en la herramienta, cuando el apartado 1 del
   informe generado declara: «No hay ninguna cifra escrita en la herramienta». Si manana
   cambia `BUILDING_CATALOGUE.WORKSHOP.purchasePrice`, el informe seguira diciendo 9.000.

Correccion propuesta. Derivar las tres cifras del catalogo
(`BUILDING_CATALOGUE.WORKSHOP.purchasePrice`, `MACHINE_CATALOGUE.CULTIVATOR.purchasePrice`) y
formular la comparacion como la hace §117, sobre la suma, indicando ademas cual de las
partidas si cabria por separado. El segundo trabajador debe salir de la frase o citarse por lo
que de verdad cuesta, que es el salario continuo de §107.

### H6. El volumen de la primera tala publicado no es el que la regla calcula

Fichero y linea: `tools/balance/deviations.ts:299`; efecto en
`docs/balance/informe-balance.md:152-153`.

Ya registrado como errata 41 de `docs/erratas-gdd-stack.md` (apartado de pendientes) y como
resolucion 40 del apartado 2. Se incluye porque el efecto sigue vivo en el entregable
publicado y porque esta revision lo confirma por ejecucion.

```
250 x NATURAL_FOREST_AVERAGE_VOLUME_DM3      = 383.500 dm3 = 383,5 m3 -> 17.257,50 $
expectedNaturalForestVolumeDm3(250, ...)     = 382.500 dm3 = 382,5 m3 -> 17.212,50 $
```

La constante del catalogo incluye los plantones porque describe el volumen medio del arbolado;
la regla que el juego ejecuta (`batchWoodVolume`, via `expectedNaturalForestVolumeDm3`) los
excluye porque §131 no les da valor. El informe cita la primera bajo el rotulo «Volumen de la
primera tala», que es la magnitud de la segunda.

Correccion propuesta. Sustituir la constante por
`expectedNaturalForestVolumeDm3(250, NATURAL_FOREST, PINE)` en `deviations.ts:299`. Nota: si
se aplica H2 tal y como se propone, las dos cifras siguen siendo distintas y ambas siguen
siendo correctas en su contexto, de modo que la correccion es independiente.

### H7. El KPI 2 publicado no es el «coste de posesion» que §114 y §125 definen

Fichero y linea: `tools/balance/report.ts:157` (cabecera «2. Posesion por ciclo»), alimentado
por `BalanceKpis.holdingCostPerCycle` de `shared/rules/balance.ts:165`.

§114 separa explicitamente tres niveles y define el coste de posesion como
`maintenanceCost + salaryPerHour`, dejando `operatingCost` en un nivel propio. §125 enumera
como KPI 2 «Coste de posesion por ciclo completo». El valor publicado, 25.688,78 $, es la suma
de las cuatro categorias del devengo: salarios (4.880,13), mantenimiento (12.037,64),
operacion (8.771,01) e interes (0,00). El coste de posesion en el sentido de §114 es
16.917,77 $.

La decision de contabilizar la operacion esta registrada (errata 34) y es correcta para el
denominador de §121; lo que no esta registrado es que se publique bajo el rotulo de §114. El
propio informe lo desambigua en su apartado 6.1 («16.917,77 $ sin operacion, 25.688,78 $ con
ella»), de modo que el defecto es de rotulo y de comparabilidad: un lector que contraste la
columna 2 con los 27.625 $ de §118 esta comparando una suma de tres partidas con una de dos.

Correccion propuesta. Rotular la columna «2. Coste por ciclo (posesion + operacion)», o bien
partirla en dos columnas y conservar el orden de §125. No requiere tocar
`shared/rules/balance.ts`, que ya expone el desglose completo en `holding`.

### H8. Las malezas crecen durante el arado y durante la cosecha

Fichero y linea: `shared/config/transitions.ts:138` (`WEED_GROWTH_STATES`).

§78 enumera los estados de crecimiento como «`GROWING`, `READY_TO_HARVEST` sin cosechar, o
`VIRGIN` sin trabajar». La tabla implementada incluye los tres estados sin condicion, de modo
que las 70,03 h de la tarea de arado —el campo esta en `VIRGIN` y precisamente se le esta
trabajando— y las 98,04 h de la tarea de cosecha —el campo esta en `READY_TO_HARVEST` y
precisamente se le esta cosechando— computan como horas de crecimiento. Son 168,07 h de las
246,07 h que el informe publica.

No es un defecto: la lectura implementada es defendible, porque el campo no esta arado hasta
que la tarea termina, y el informe declara el criterio de forma expresa («cuentan la tarea de
arado y la de cosecha»). Tampoco tiene hoy efecto de balance, porque con la tasa publicada el
nivel satura igualmente: 78 + 98,04 = 176,04 h bastan para llegar al 100 %. Se registra
porque es una interpretacion de §78 que no figura en `docs/erratas-gdd-stack.md` y que si
tendria efecto si la tasa se ajustara alguna vez.

*Actualizacion (agosto de 2026):* la revision de balance de `docs/balance/revision-2026-08.md`
adopto la lectura estricta de este hallazgo: `WEED_GROWTH_STATES` contiene solo `GROWING`. La
consecuencia sobre el abandono (un campo virgen o sin cosechar ya no acumula malezas) queda
registrada alli como asunto abierto.

### H9. El comentario de la recta de salarios describe un ajuste que no es el suyo

Fichero y lineas: `shared/config/workers.ts:29-41`; repetido en la resolucion 39 de
`docs/erratas-gdd-stack.md`.

El comentario afirma que los coeficientes son «el ajuste por minimos cuadrados de los tres
ejemplos de §102, redondeado a dos decimales». Ejecutado el ajuste sobre (45, 12), (62, 18) y
(88, 31): pendiente 0,4466950959 e interseccion −8,7018479033. Redondeados a dos decimales
serian 0,45 y −8,70, no −8,75. La pareja implementada, (0,45; −8,75), es un ajuste razonable
pero no el de minimos cuadrados redondeado.

Sin efecto: los tres ejemplos de §102 siguen siendo alcanzables dentro de la banda de ruido
del 12 % —12 esta en [10,12; 12,88], 18 en [16,85; 21,45] y 31 en [27,15; 34,55]—, que es lo
unico que §102 exige. Corresponde corregir la redaccion, no los numeros.

## 3. Revision punto por punto

Los once puntos del encargo, con el veredicto de cada uno. Se dice explicitamente donde no hay
hallazgo.

### 3.1 §91, duracion de tarea y factor de condicion

`shared/rules/duration.ts:75-105`, tabla en `shared/config/curves.ts:28-33`.

`taskDuration = units / (workSpeed x conditionFactor x skillFactor)`, calculada una sola vez en
la asignacion (`backend/src/modules/tasks/assignment.ts:780`) y con la condicion de la maquina
que marca el paso, que es el implemento cuando lo hay (`paceConditionBp`, linea 237). Coincide
con §91.

Nodos, CONFIRMADO por ejecucion: 0 % → 0,20 · 10 % → 0,40 · 50 % → 0,75 · 100 % → 1,00.
Interpolacion lineal entre nodos comprobada en 5 % → 0,30, 20 % → 0,4875 y 30 % → 0,575, que es
lo que la recta entre `[10, 0.4]` y `[50, 0.75]` da. Fuera de la tabla se acota, nunca se
extrapola. El suelo de 0,2 y el nodo de 0 % son valores inventados y estan registrados (errata
7); el rechazo de asignacion por debajo del 10 % (`MIN_CONDITION_TO_ASSIGN`) tambien (errata 6).

Reproduccion de §118 con habilidad 70 % y condicion 100 %, CONFIRMADO por ejecucion:
arar 250 celdas 70,0280 h (§118 publica ~70), sembrar 61,2745 h (~61), cosechar 98,0392 h
(~98). Ciclo total 325,34 h frente a las ~325 h de §118.

Reproduccion del ejemplo de §110, CONFIRMADO: 300 / (4,2 x 0,975 x 0,85) = 86,1883 h, que es
lo que la errata 31 fija como valor correcto frente a las 84 h que el ejemplo enuncia.

Sin hallazgos.

### 3.2 §103, factor de habilidad y progresion con techo

`shared/rules/duration.ts:51-66` y `shared/rules/skill.ts:32-43`.

`skillFactor = 0,5 + (skill / 100) x 0,5`, literal. CONFIRMADO: 0 % → 0,50, 50 % → 0,75,
70 % → 0,85, 100 % → 1,00. Los tres valores que §103 publica coinciden.

Progresion: un punto por tarea completada (`SKILL_GAIN_PER_TASK_BP = 100`), que es lo que el
ejemplo de §110 muestra al pasar un trabajador de 70 % a 71 %, con techo en 95 %
(`SKILL_CAP_BP = 9500`), que es el ejemplo que §103 propone. Se aplica en el mismo statement
que libera al trabajador (`backend/src/modules/workers/service.ts:571-583`), de modo que una
finalizacion no puede aplicar una cosa sin la otra. Un trabajador ya en el techo conserva su
habilidad en lugar de ser arrastrado a el.

Sin hallazgos.

### 3.3 §77 fertilidad, §78 malezas, §79 fertilizacion

Curvas en `shared/config/curves.ts:41-60`, aplicadas por `shared/rules/yield.ts:64-95`.

Fertilidad, CONFIRMADO: 100 % → 1,00, 50 % → 0,65, 10 % → 0,25, los tres nodos de §77. Por
debajo del 10 % la curva se acota en 0,25 en lugar de extrapolar hacia cero, que es una
decision registrada (cabecera de `shared/config/curves.ts`) y la unica que no inventa un
numero de balance. Drenaje de 15 puntos por cosecha (§77, §82), aplicado antes de la
transicion y sobre el valor liquidado (`backend/src/modules/fields/service.ts:577`).
La regeneracion en barbecho es un anadido registrado (errata 8).

Malezas, CONFIRMADO: 0 % → 0 % de penalizacion, 50 % → 20 %, 100 % → 50 %, los tres nodos de
§78, con interpolacion lineal. Tasa 0,6 %/h literal de §82, con saturacion en 100, y su
consecuencia registrada como errata 1. Estados de crecimiento conforme a §78, con la matizacion
del hallazgo H8. El reinicio por `CULTIVATE` es el `sideEffect` de §89; el reinicio adicional
por `HARVEST` es el hallazgo H3.

Fertilizacion, CONFIRMADO: multiplicador fijo en 1,0 en todo el rango, conforme a §79 y §86, y
`settleFertilization` devuelve el valor almacenado sin decaimiento, que es lo que el MVP pide.

Hallazgos: H3 y H8.

### 3.4 §80 progreso de crecimiento y §76 maquina de estados

`shared/rules/yield.ts:243-311`, `shared/config/transitions.ts:55-120`,
`backend/src/modules/fields/service.ts:446-465` y `backend/src/modules/fields/jobs.ts`.

`growthProgress = min(100, transcurrido / growthDuration)` medido desde la siembra sobre las
96 h de §82. Es la formula literal de §80; la contradiccion con «dentro de GROWING» esta
registrada (errata 33).

Las nueve transiciones de §76 estan como datos. Las cuatro automaticas se aplican: las tres
cronometradas por `materializeProjectedPhase`, que las escribe **en el instante de cada
frontera** y no en el instante en que se descubren —lo que mantiene exacta la acumulacion de
malezas por tramo—, y `HARVESTED → VIRGIN` dentro de la misma llamada que la cosecha
(`service.ts:592-603`), de modo que el campo nunca reposa en `HARVESTED`, conforme al ciclo
narrado en §84. La transicion adicional `PLOWED → SEEDED` es la que §90 enuncia
(«CULTIVATED/PLOWED → SEEDED») para un cultivo con `requiresCultivation: false`.

El manejador agendado y el camino de escritura convergen porque los dos llaman a la misma
funcion; una segunda entrega del mismo evento no escribe nada.

Sin hallazgos.

### 3.5 §83 formula de rendimiento final

`shared/rules/yield.ts:117-152`.

`base x fertilityMult x fertilizationMult x (1 - weedPenalty)`, en ese orden y truncado al
litro. CONFIRMADO contra §119: con 250 celdas, 90 L/celda, fertilidad 100 % y el nivel de
malezas del 20 % que §119 supone, el resultado es 20.700 L exactos y 4.554,00 $ exactos, que
son las dos cifras publicadas. Con el nivel que la tasa de §82 produce (saturado), 11.250 L y
2.475,00 $, que es la desviacion registrada como errata 1.

El desbordamiento de silo (§83, §97) se resuelve con reserva en la asignacion y deposito
acotado en la finalizacion, registrado como errata 9.

Sin hallazgos.

### 3.6 §93 desgaste y coste de reparacion

`shared/rules/machinery.ts:47-84`, catalogo en `shared/config/machines.ts`.

`repairCost = (100 - condition) x repairCostPerPoint`, literal. La tarifa por punto es el
0,30 % del precio de compra y esta escrita a mano en el catalogo; CONFIRMADO que las ocho filas
son coherentes con esa derivacion: tractor 18.000 → 54, arado 6.500 → 19,5, cultivador
5.200 → 15,6, sembradora 9.800 → 29,4, cosechadora 42.000 → 126, remolque 7.200 → 21,6,
procesador forestal 65.000 → 195, autocargador 38.000 → 114.

El desgaste solo corre sobre horas trabajadas, nunca por inactividad, conforme a §93 y §99, y
se aplica sobre el mismo intervalo `[startGameMs, endedGameMs)` que factura el coste de
operacion (`backend/src/modules/machinery/service.ts:200-227`), incluida la cancelacion
prorrateada. La tasa por tipo, la duracion de la reparacion, la reparacion parcial y el umbral
de aviso del 20 % son valores inventados y estan registrados (erratas 6, 11, 49 y 51).

Sin hallazgos.

### 3.7 §115 precio de la tierra y §116 coste de infraestructura

`shared/rules/pricing.ts:58-160`, `backend/src/modules/farms/placement.ts:230-250`.

`cellPrice = base x locationMultiplier x accessibilityMultiplier` con los dos multiplicadores
en 1,0, conforme a §115 y §126. Pradera 120 $, bosque 70 $. Montana y agua se expresan como
ausencia de precio, no como bandera.

Criterio de doble cobro. El ADR (errata 10, ADR-0011 y ADR-0029) fija que §116 es ayuda de
planificacion y que el precio transaccional cobra el suelo solo cuando no es del jugador. El
codigo lo cumple y va mas alla del caso binario: `landPaid` se calcula sobre las celdas que la
peticion adquiere realmente, de modo que una huella parcialmente poseida se cobra por su parte
(errata 43), y `plannedCostWithLand` viaja aparte para que la interfaz pueda mostrar la formula
literal de §116. En los dos extremos ambas cifras coinciden.

Sin hallazgos.

### 3.8 §107 coste de posesion y §124 resumen de regreso

`shared/rules/holding.ts`, `backend/src/lib/accrual.ts`,
`backend/src/modules/session/welcomeBack.ts`.

`holdingRatePerGameHour` suma todos los salarios, todos los mantenimientos y el coste de
operacion solo de las maquinas en `WORKING`, que es literalmente §107, con maintenance y
operating aditivos conforme a §107 y §114 (errata 3). El lector filtra bajas y ventas
(`playerView.ts:93-100`).

El requisito explicito de §124 —«`totalOperating` requiere revisar los eventos agendados, no
una simple multiplicacion»— se cumple por construccion: el devengo es la integral de solapes
de la ventana con `[startGameMs, coalesce(endedGameMs, scheduledEndGameMs))` de cada tarea,
por tipo de maquina (`holding.ts:236-252`), y la consulta que carga las fuentes expresa esa
misma condicion de solape en SQL (`accrual.ts:97-110`). En ninguna parte hay un producto
`tasa x horas transcurridas`. El resumen de regreso agrega despues por tipo de asiento
(`welcomeBack.ts:270`), de modo que la cifra que ve el jugador es la que el ledger escribio y
no un segundo calculo.

Coherencia comprobada de dos extremos: la finalizacion sella `endedGameMs` con el instante de
vencimiento del evento y no con el instante en que se procesa
(`backend/src/modules/tasks/service.ts:455-470`), de modo que un trabajador caido produce
exactamente el mismo intervalo facturado que una ejecucion puntual.

Sin hallazgos.

### 3.9 §121 punto de equilibrio y §125 los seis KPI

`shared/rules/balance.ts:65-77` y `:155-180`.

`breakEvenCycles = inversion / (ingreso - coste)`, con `null` cuando el denominador no es
positivo, que es lo que §121 declara. CONFIRMADO por ejecucion sobre el escenario minimo:
ingreso 2.475,00 $, coste 25.688,78 $, margen −23.213,78 $, no existe equilibrio. Con compra
escalonada, coste 20.006,22 $ y margen −17.531,22 $. Es el resultado que §119 anticipa y que
el informe declara.

Los seis KPI estan los seis y en el orden de §125. KPI 1 CONFIRMADO en 146.100,00 $ y KPI 6 en
13.900,00 $, ambos exactos frente a §117. KPI 2 es el hallazgo H7. KPI 4 y KPI 5 se derivan de
KPI 2 y arrastran su criterio, de modo que la correccion de H7 debe declararlo en el rotulo,
no cambiar el numero.

Hallazgo: H7.

### 3.10 §131 fases del arbol y volumen, §133 especie, §135 duracion de tala

`shared/rules/forestry.ts`, `shared/config/forestry.ts`.

Fronteras de fase, CONFIRMADO por ejecucion: 0-239 h `SAPLING` (50 dm3), 240-479 h `YOUNG`
(400), 480-719 h `MATURE` (1.800), desde 720 h `OLD_GROWTH` (2.500), estancado a partir de ahi
(comprobado a 960 h y a 5.000 h). Los cuatro volumenes son los de §131 y las fronteras son las
de §133 leidas como tres y no como cuatro, que es la errata 13. Nada del arbol se almacena
salvo el instante de plantacion (errata 14).

§133: 240 h por fase, volumen maximo 2,5 m3, precio 45 $/m3, maquinaria requerida
`[HARVESTER_FORESTRY, FORWARDER]`. Literal.

§135: `taskDuration = treeCount / effectiveWorkSpeed` con la misma funcion que §91 y la
velocidad 0,8 arboles/h de §134; `treeCount` cuenta los arboles con estado distinto de
`FELLED`, incluidos los plantones, que es la definicion literal de §135. La produccion se
recalcula en el instante de la finalizacion y no se lee de la tarea, que es correcto porque los
arboles siguen creciendo mientras el procesador trabaja.

Hallazgos: H2 y H6.

### 3.11 §102 regla del pool de contratacion

`backend/src/modules/workers/pool.ts`, `shared/config/workers.ts`.

Generacion procedural sin `Math.random` ni `Date.now`: el mezclador es `hashGrid`, alimentado
por semilla del mundo, jugador, generacion, ranura y atributo, de modo que un pool es
reproducible en una prueba. Tamano 3, por literalidad del ejemplo (errata 39).

Banda de habilidad, CONFIRMADO: minimo 3.000 bp y maximo 9.000 bp alcanzables, cerrada por los
dos extremos, que es el «skill 30-90 %» de §102. Salario correlacionado con la habilidad mas
ruido multiplicativo del ±12 %, con suelo de 6 $/h; CONFIRMADO que los tres candidatos
publicados por §102 son alcanzables. Sin negociacion: el candidato es una terna fija.

Al contratar, el candidato se retira conservando su fila (`removedGameMs`), y la reposicion
llega con el refresco de `poolRefreshInterval`, fijado en 48 h de juego (errata 21). La
renovacion es integra y no por relleno, decision registrada como errata 46. La puesta al dia
de un jugador ausente salta intervalos completos en lugar de reproducirlos uno a uno, lo que es
correcto porque el pool no tiene historia contable.

«Validar dinero» se lee como la politica de deuda y no como una tarifa, decision registrada
(errata 47). Consecuencia relevante para H5: contratar no cuesta dinero.

Hallazgos: ninguno propio. H5 depende de esta lectura.

## 4. Constantes de catalogo frente al GDD

La decision del usuario fue implementar el balance sin tocarlo, de modo que toda diferencia sin
errata seria un hallazgo grave. No se encontro ninguna. Comprobacion literal, valor a valor:

### §82, cultivo

| Campo | GDD §82 | `shared/config/crops.ts` | Coincide |
|---|---|---|---|
| `growthDuration` | 96 h | 96 h (6 + 12 + 78) | Si |
| `baseYieldPerCell` | 90 L | 90 | Si |
| `sellPricePerLiter` | 0,22 $ | 0,22 | Si |
| `requiresCultivation` | false | false | Si |
| `requiredMachinery` | plow, seeder, harvester | `['PLOW','SEEDER','HARVESTER']` | Si |
| `weedGrowthRate` | 0,6 %/h | 60 bp/h | Si |
| `fertilityDrainPerCycle` | 15 % | 1.500 bp | Si |

El reparto interno de las tres fases no lo publica el GDD y esta registrado (errata 2).

### §89 y §134, maquinaria

| Maquina | Precio | Mantenimiento | Operacion | Velocidad | Ancho / capacidad | Coincide |
|---|---|---|---|---|---|---|
| TRACTOR | 18.000 | 12 | 22 | — | — | Si |
| PLOW | 6.500 | — | — | 4,2 celdas/h | 3 m | Si |
| CULTIVATOR | 5.200 | — | — | 5,5 celdas/h | 4 m | Si |
| SEEDER | 9.800 | — | — | 4,8 celdas/h | 3 m | Si |
| HARVESTER | 42.000 | 25 | 60 | 3,0 celdas/h | 6 m | Si |
| TRAILER | 7.200 | — | — | — | 12.000 L | Si |
| HARVESTER_FORESTRY | 65.000 | 30 | 70 | 0,8 arboles/h | — | Si |
| FORWARDER | 38.000 | — | — | — | 15 m3 | Si |

Los implementos y el autocargador quedan a cero porque el GDD no les asigna coste continuo;
las dos consecuencias estan registradas (erratas 4 y 37). La compatibilidad del tractor es la
lista literal de §89. La compatibilidad cosechadora-remolque no figura en §89 y se deriva de
§90, que la exige.

### §115, precio de la tierra

| Terreno | GDD §115 | Implementado | Coincide |
|---|---|---|---|
| GRASS | 120 $/celda | 120 | Si |
| FOREST | 70 $/celda | 70 | Si |
| Multiplicadores | 1,0 en el MVP | 10.000 bp | Si |

### §116 y §136, edificios

| Edificio | Precio | Huella | Capacidad | Coincide |
|---|---|---|---|---|
| GARAGE | 8.000 | 6 x 8 = 48 | 4 maquinas | Si |
| SILO | 10.000 | 4 x 4 = 16 | 100.000 L | Si |
| WORKER_HOME | 5.000 | 4 x 4 = 16 | 4 trabajadores | Si |
| WORKSHOP | 9.000 | 5 x 5 = 25 | acceso a reparacion | Si |
| WOOD_STORAGE | 12.000 | 6 x 8 = 48 (inventada) | 500 m3 | Precio y capacidad si |

La huella del almacen de madera no la publica §136 y esta registrada como inventada (errata
38). La suma de las tres huellas de arranque da 80 celdas, que es la cifra de §117.

### §133, especie

| Campo | GDD §133 | Implementado | Coincide |
|---|---|---|---|
| `growthDurationPerStage` | 240 h | 240 h | Si |
| `maxWoodVolume` | 2,5 m3 | 2.500 dm3 | Si |
| `sellPricePerM3` | 45 $ | 45 | Si |
| `requiredMachinery` | chainsaw harvester, forwarder | idem | Si |
| Edad de `OLD_GROWTH` | «≈960 h» | 720 h | No; errata 13 |

### §117, economia

`STARTING_CAPITAL = 160.000 $`, literal de §117. Setup calculado 146.100,00 $ y colchon
13.900,00 $, ambos exactos.

Los unicos valores economicos que no proceden del GDD son el factor de reventa (60 %), el
umbral de liquidacion forzosa (30 %) y el interes de descubierto (0 %), los tres declarados
como inventados en el catalogo y registrados en ADR-0014 y en la errata 28, y ninguno de ellos
altera ninguna cifra publicada por el GDD.

## 5. Reproduccion de las comprobaciones ejecutadas

Las cifras marcadas CONFIRMADO salen de estas evaluaciones, todas sobre `shared/` y
`tools/balance/` sin modificar nada:

1. Curva de condicion en 0, 5, 10, 20, 30, 50, 75 y 100 %, y factor de habilidad en 0, 30, 50,
   70, 88, 95 y 100 %.
2. `estimateTaskDuration` para las cuatro operaciones agricolas sobre 250 celdas con condicion
   100 % y habilidad 70 %.
3. `balanceKpis(MINIMUM_SETUP_SCENARIO)` en los modos de compra completa y escalonada, y con
   el nivel de malezas fijado al 20 % de §119.
4. `finalYieldLiters` con los tres niveles de malezas relevantes y las curvas de §77 y §78.
5. `expectedNaturalForestVolumeDm3` frente a `250 x NATURAL_FOREST_AVERAGE_VOLUME_DM3`, y
   `treeStageForAge` en 0, 239, 240, 479, 480, 719, 720, 960 y 5.000 h.
6. Reproduccion lado a lado del acumulador de malezas del servidor (segmentado por fase) y del
   cliente (una sola llamada), sobre el mismo campo, en seis instantes.
7. Ajuste por minimos cuadrados de los tres candidatos de §102 y banda de ruido de
   `askingSalary`.
