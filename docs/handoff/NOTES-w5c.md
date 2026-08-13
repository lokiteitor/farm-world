# NOTES-w5c

Agente de economia y mercado. Fase W5. Ambito escrito, exclusivamente:

- `backend/src/modules/economy/**`
- `backend/src/__tests__/economy/**`
- `tools/balance/**`
- `docs/balance/**` (generado por `make balance`)
- este fichero

No se ha escrito en ningun otro directorio. `backend/src/app.ts`, `backend/src/handlers.ts`, el
registro de rutas, `backend/src/lib/**`, `shared/**`, `backend/prisma/**` y el resto de ficheros
congelados quedan intactos: sustituir el andamiaje consistio en cambiar `defineStubRoute` por
`defineRoute` dentro del propio modulo, conforme a la regla 3 de la seccion 11 del plan.

---

## 1. Que se ha implementado

### 1.1 Las cuatro rutas del area `economy`

| Ruta | Avanza al jugador | Secuenciada | Mueve dinero |
|---|---|---|---|
| `GET /api/inventory` | Si | No | No |
| `GET /api/market/prices` | No | No | No |
| `GET /api/economy/ledger` | Si | No | No |
| `POST /api/market/sell` | Si | Si | Si |

La ruta mutante se ejecuta dentro de `withPlayerAdvanced`, que es lo unico que devuelve el `seq`
que la respuesta secuenciada debe llevar (ADR-0017).

### 1.2 Ficheros del modulo

| Fichero | Contenido |
|---|---|
| `modules/economy/index.ts` | Registro de rutas y del enganche del barrido; superficie que exportan los demas |
| `modules/economy/market.ts` | Precio fijo de GDD §123 y la venta de existencias |
| `modules/economy/readModel.ts` | Inventario como lo lleva el contrato (GDD §27, §49, §136) |
| `modules/economy/ledger.ts` | Consulta del historico, paginada por secuencia, con filtros |
| `modules/economy/debt.ts` | Mitad legible de la politica de deuda del plan 6.6 |
| `modules/economy/liquidation.ts` | Liquidacion forzosa en el orden publicado |
| `modules/economy/jobs.ts` | Registro de la liquidacion como extension del barrido |
| `modules/economy/routes.ts` | Superficie HTTP, que convierte y no decide nada |

Pruebas en `backend/src/__tests__/economy/`: `market.int.test.ts` (11), `debt.int.test.ts` (6),
`liquidation.int.test.ts` (7), `ledger.int.test.ts` (9) y `recompute.int.test.ts` (1 propiedad con
fast-check sobre 8 secuencias aleatorias), mas `fixtures.ts`, que es auxiliar y no una suite.
34 pruebas en total.

### 1.3 La politica de deuda del plan 6.6

Los cuatro escalones, y donde vive cada uno:

1. `IN_DEBT` derivado del saldo liquidado. Ya lo aplicaba `applyDebtPolicy` de
   `lib/advancePlayer.ts` en cada avance; este modulo anade el rechazo con codigo propio,
   `assertDiscretionarySpendingAllowed`, que produce `SPENDING_BLOCKED_IN_DEBT`. Vender no lo
   consulta: es la unica via de ingreso y bloquearla produciria un bloqueo permanente.
2. Interes de descubierto como cuarto tipo de devengo con tasa cero. Estaba implementado de
   extremo a extremo desde W2 y W3 (`OVERDRAFT_INTEREST` en `ACCRUAL_LEDGER_TYPES`, la integral en
   `shared/rules/holding.ts`, la liquidacion en `lib/accrual.ts`); lo que esta fase anade es la
   prueba de que la tasa es cero y de que no se escribe ningun asiento.
3. Liquidacion forzosa por encima del 30 % del valor liquidable, en el orden publicado de
   `LIQUIDATION_STEPS`, con un asiento por activo vendido y un asiento agregado `LIQUIDATION` de
   importe cero que explica el conjunto. La dispara el barrido y no el login.
4. `BANKRUPT` reservado y nunca producido. Sin cambios.

### 1.4 La calculadora de balance

`tools/balance/` importa las mismas constantes que el juego desde `shared/config/` y las mismas
reglas puras desde `shared/rules/`, y emite en `docs/balance/`:

- `informe-balance.md`, en espanol, con los seis KPI de GDD §125, la reproduccion de §117, §118 y
  §119, la tabla de valores no reproducibles con su valor real al lado, el efecto de la tasa de
  malezas de §82 sobre el primer ciclo y el punto de equilibrio de §121.
- `kpis.json`, las mismas cifras como datos, para el cierre de W7-D y para que un diff entre dos
  catalogos sea legible.

Ambos son deterministas: no llevan marca de tiempo, de modo que dos ejecuciones producen bytes
identicos y la unica razon por la que el fichero cambia es que ha cambiado una constante. Ninguna
constante se ha ajustado.

---

## 2. Pendiente sobre ficheros de otros agentes

### 2.5 La guarda de gasto discrecional no la consumen los hermanos de esta fase

Categoria: consecuencia de la regla 4, sin cambio pendiente
`machinery` (W5-A) y `workers` (W5-B) son hermanos de fase y no pueden importar
`modules/economy`. `assertDiscretionarySpendingAllowed` queda exportada para W6 y W7. Mientras
tanto una compra con saldo negativo se sigue rechazando, porque `charge` de `lib/ledger.ts` es una
actualizacion condicional y un saldo negativo no cubre ningun importe positivo: lo que cambia es el
codigo, `INSUFFICIENT_FUNDS` en lugar de `SPENDING_BLOCKED_IN_DEBT`. La prueba
`debt.int.test.ts` lo comprueba contra `POST /api/land/purchase`, que es una ruta real de una fase
anterior.

### 2.6 `docs/balance/` figura como propiedad de W6-E

Categoria: ajuste de la tabla de propiedad
Ficheros afectados: `docs/ownership.md`, apartado 3.7
Propietario: el agente de cierre de W5

`docs/ownership.md` atribuye `tools/balance/` a W6-E y `docs/balance/` a "W6-E genera, W7-D
cierra". El brief de este agente asigna la calculadora a W5-C, y es coherente con el reparto real:
la calculadora consume `shared/rules/balance.ts` y la politica de deuda, que son de esta fase. La
tabla del apartado 3.7 deberia pasar a `tools/balance/` propietario W5-C, fase W5, y `docs/balance/`
a "W5-C genera, W7-D cierra".

---

## 3. Decisiones para el ADR

Las redacta el agente de cierre de la fase. Tramo de W5: 0039-0041.

### 3.1 Deuda, interes de descubierto y liquidacion forzosa

Contexto: el GDD no define la quiebra y, con sus valores sin ajustar, el saldo negativo es el estado
esperado del primer ciclo: el informe de balance mide 25.688,78 $ de coste de posesion frente a
2.475,00 $ de ingreso. La deuda no es un caso limite que haya que defender, esta en el camino
critico.

Decision, en cuatro partes:

1. `IN_DEBT` es derivado del saldo liquidado y de nada mas. Bloquea el gasto discrecional y no
   bloquea vender ni asignar tareas. La asimetria no es una concesion: vender es la unica via de
   ingreso, y bloquearla convertiria la deuda en un bloqueo permanente. El codigo del rechazo es
   `SPENDING_BLOCKED_IN_DEBT` y no `INSUFFICIENT_FUNDS`, porque "no te lo puedes permitir" invita a
   ahorrar y "el gasto esta bloqueado mientras estas en deuda" nombra el estado y senala la salida.
2. El interes de descubierto existe como cuarto tipo de devengo, con tasa cero. Implementado de
   extremo a extremo y desactivado por el valor de la constante, no por una rama de codigo: es una
   palanca disponible sin migracion, y cobrarlo hoy solo profundizaria un deficit que el propio GDD
   documenta.
3. La liquidacion forzosa se dispara cuando la deuda supera una fraccion del valor liquidable, no
   una cifra absoluta, de modo que escala con el jugador. Recorre `LIQUIDATION_STEPS` de
   `shared/config/economy.ts` —el orden es politica y vive en un unico sitio— y se detiene en
   cuanto el saldo deja de ser negativo: vender mas de lo que la deuda necesita seria confiscacion
   y no liquidacion. Dentro de `INVENTORY` se venden solo las unidades que la deuda necesita,
   redondeadas al alza.
4. La dispara el barrido periodico y no el login. Una liquidacion que apareciera al volver se
   leeria como un castigo por haber estado ausente, y ausentarse es legitimo en un juego asincrono.

Consecuencia sobre el ledger: un asiento por activo vendido, con `refType` y `refId` apuntando a
el y el paso en `meta`, mas un unico asiento agregado de tipo `LIQUIDATION` e importe cero que
lleva en `meta` la deuda previa, el valor liquidable, el umbral, lo recaudado y la lista de activos
y de pasos. Los asientos por activo usan los tipos de venta correspondientes y no `LIQUIDATION`,
que el vocabulario reserva para el agregado; el importe del agregado es cero porque el dinero ya se
movio en los asientos por activo y contarlo dos veces romperia la auditoria de que la suma de los
asientos es el saldo. Un trabajador no se vende: se despide, lo que detiene el devengo salarial, y
el despido queda donde queda cualquier otro, en `Worker.terminatedGameMs`.

### 3.2 El precio como dato del catalogo y la unidad almacenada como unidad de calculo

Contexto: GDD §123 fija el precio sin fluctuacion y GDD §133 lo publica por metro cubico, mientras
que las existencias se guardan en la unidad entera del recurso (litros y decimetros cubicos,
ADR-0013).

Decision: `GET /api/market/prices` existe para que el cliente no reescriba 0,22 y 45, y publica dos
cifras por recurso, la de la unidad almacenada y la de la unidad mostrada, con el divisor. El
servidor calcula siempre sobre la unidad almacenada y con las reglas compartidas
(`cropSaleRevenue`, `woodSaleRevenue`), que multiplican primero y dividen una sola vez; el precio
por unidad almacenada es exacto con el catalogo actual y la suite lo comprueba, de modo que si un
precio futuro hiciera divergir las dos vias, la regla compartida es la autoridad y el precio por
unidad pasa a ser una cifra de presentacion.

Consecuencia sobre la venta: la retirada de existencias precede al abono y va antes que el, pero
detras de la comprobacion de la clave de idempotencia. La guarda HTTP de `plugins/auth.ts` ya
reproduce la respuesta almacenada, y la comprobacion del ledger es la segunda defensa: `credit`
colapsa el asiento, no la retirada que ocurrio antes de el.

### 3.3 La paginacion del ledger por secuencia y no por desplazamiento

Contexto: la consulta del historico es la primera ruta paginada del contrato.

Decision: se pagina por `seq`, que es unico y monotono por jugador y esta indexado con el, en orden
descendente. Un desplazamiento relee las filas que salta y, sobre todo, se mueve bajo el lector: un
jugador al que se le esta liquidando el devengo mientras pagina veria un asiento dos veces o
perderia otro. El cursor es opaco en el contrato, que es lo que permite que hoy sea la secuencia y
manana sea otra cosa sin tocar el cliente. El `balance` de la respuesta es el saldo liquidado, que
es exactamente el `balanceAfter` del asiento mas reciente, de modo que el cliente puede auditar la
pagina que acaba de recibir sin pedir nada mas.

### 3.4 El informe de balance como entregable y no como puerta

Contexto: GDD §127 pide convertir §117-§121 en una hoja de calculo fuera del GDD; la seccion 1 del
plan decide implementar el balance sin tocarlo.

Decision: la calculadora importa las constantes del juego y ninguna cifra esta escrita en ella, de
modo que no puede divergir; el informe no lleva marca de tiempo, de modo que es reproducible byte a
byte y un diff senala un cambio de constante y no la hora a la que se genero; y `make balance`
termina en cero aunque el margen sea negativo, porque el informe documenta la desviacion en lugar
de exigir que se corrija. Cuando el informe cita el valor que una palanca deberia tener, lo marca
como informativo y no lo aplica.

---

## 4. Discrepancias detectadas

1. **`shared/api/schemas/economy.ts`, `ledgerQuerySchema`.** No lleva filtros por tipo ni por
   intervalo, que es lo que el brief de esta fase pide y lo que el resumen de regreso de GDD §124
   necesita. Apartado 2.3.

2. **`lib/jobs.ts`, `registerSettleSweepHook`.** El mecanismo es correcto y el punto de registro no
   existe para el proceso worker. Apartado 2.1.

3. **GDD §82 frente a §119, medido.** La tasa de malezas de 0,6 %/h satura el nivel al 100 % a las
   166,67 h de crecimiento, y el ciclo de GDD §118 tiene 246,07 h de crecimiento de malezas, de modo
   que la penalizacion al cosechar es la maxima de GDD §78, el 50 %, y no el 8 % que GDD §119 supone.
   El primer ciclo rinde 11.250 L y 2.475,00 $ en lugar de 20.700 L y 4.554,00 $.

   Hallazgo nuevo, que la seccion 2.2 del plan no anticipaba: `CULTIVATE` **no evita la saturacion**.
   Aunque el jugador cultive justo antes de sembrar, quedan 176,04 h de crecimiento de malezas hasta
   la cosecha —la fase `GROWING` mas la propia tarea de cosecha—, y 176,04 h por 0,6 %/h vuelven a
   llevar el nivel al 100 %. El plan da a `CULTIVATE` "uso estrategico real: resetear malezas", y con
   estas constantes resetearlas no cambia el ingreso del ciclo. Conviene que el agente de cierre lo
   recoja en `docs/erratas-gdd-stack.md`.

4. **GDD §118, mantenimiento.** El catalogo de GDD §89 solo asigna `maintenanceCost` al tractor (12)
   y a la cosechadora (25): 37 $/h combinados frente a los ~70 $/h que §118 supone. En sentido
   contrario, §118 omite el `operatingCost` que §107 y §114 declaran aditivo, que en este ciclo son
   8.771,01 $. Las dos desviaciones se compensan en parte y el coste de posesion resulta
   25.688,78 $ frente a los 27.625 $ publicados.

5. **GDD §117 frente a §118, habilidad.** §117 dice "skill ~60 %" y las duraciones de §118 exigen
   `skillFactor` 0,85, que en la curva implementada corresponde al 70 %. Con el 60 % arar 250 celdas
   tarda 74,4 h y no 70 h.

6. **GDD §117 frente a §36 y §102, salario.** La regla procedural de §102, que el plan declara
   autoritativa, cobra 22,75 $/h por una habilidad del 70 %. El 15 $/h de §117 corresponderia al
   52,78 % de habilidad y el 30 $/h de §36 al 86,11 %.

7. **`shared/api/errors.ts`, `insufficientStock`.** Toma dos numeros y no dice en que unidad, que
   para la madera son decimetros cubicos y no metros cubicos. El cliente tiene que dividir por
   `displayDivisor`, que viaja en el inventario pero no en el error. No es un fallo del contrato,
   pero conviene saberlo antes de que un panel muestre "faltan 1.200 m3".

8. **`shared/domain/enums.ts`, `LedgerType.LIQUIDATION`.** El comentario lo describe como "the
   aggregate entry of a forced liquidation". La implementacion lo respeta escribiendo un unico
   asiento agregado de importe cero, lo que significa que hay un asiento sin dinero en el ledger.
   Es coherente con la auditoria (suma cero, no altera el saldo) y con el resumen de regreso, que es
   quien lo lee, pero es la primera vez que el ledger lleva un asiento cuyo valor es la explicacion
   y no el importe. `HARVEST_WASTE` de W6-A sera el segundo caso.

9. **`docs/ownership.md`, apartado 3.7.** Atribuye `tools/balance/` a W6-E. Apartado 2.6.

10. **Restos de otros agentes en la base de desarrollo.** Al terminar quedan dos jugadores de prueba
    que no son de este agente: `w3a-b0ac4646-chunks@test.invalid` y `w5b-http-1786567297@test.invalid`.
    Los de este agente se han borrado. Se anota porque `make seed` supone una base limpia.

---

## 5. Verificacion

Ordenes ejecutadas desde la raiz del repositorio, con PostgreSQL en 55432 y Redis en 56379.

| Orden | Resultado |
|---|---|
| `make sync-types` | exit 0. 53 ficheros a `backend/src/shared` y 53 a `frontend/app/shared` |
| `npx tsc --noEmit` (en `backend/`) | exit 0, sin salida |
| `npx tsc -p tools/balance/tsconfig.json` | exit 0, sin salida |
| `make typecheck` | exit 0. `shared`, `backend` y `vue-tsc` del cliente en verde |
| `make lint` | exit 0. `eslint .` sin hallazgos y Prettier conforme |
| `make test-unit` | exit 0. 40 ficheros y 368 pruebas |
| `npx vitest run --config vitest.int.config.ts src/__tests__/economy` | exit 0. 5 ficheros y 34 pruebas |
| `make test-int` | exit 1. 25 ficheros y 213 pruebas: 212 en verde y 1 en rojo, la del apartado 2.2 |
| `make balance` | exit 0. Informe y datos en `docs/balance/` |

La suite del modulo se ha ejecutado tres veces seguidas con el mismo resultado, para descartar que
la prueba de propiedad o las del barrido dependieran del reloj.

### 5.1 `make balance`

```text
Informe de balance generado.
  /home/ddelgado/git/lab/farm-world/docs/balance/informe-balance.md
  /home/ddelgado/git/lab/farm-world/docs/balance/kpis.json

KPIs de GDD 125, setup minimo con compra completa:
  1. Coste de setup minimo      146100.00
  2. Coste de posesion / ciclo  25688.78
  3. Ingreso / ciclo            2475.00
  4. Ratio ingreso/coste        0.0963
  5. Horas hasta el equilibrio  no existe (margen negativo, GDD 121)
  6. Colchon tras el setup      13900.00

Malezas al cosechar: 100.0 % (GDD 119 supone 20.0 %). Diferencia de ingreso: 2079.00.
```

Dos ejecuciones seguidas producen ficheros identicos byte a byte, comprobado con `diff`.

### 5.2 Comprobacion por HTTP real

Contra `npx tsx src/server.ts` en el puerto 3212, con el mundo de desarrollo. El deposito de
existencias es la unica escritura directa: la cosecha es de W6-A y todavia no existe.

```text
register             playerId 019ff7c7-5b46-775e-afcb-65a776252ed2
world/info           spawn 617 105
POST /api/farms      farmId 019ff7c7-...
POST buildings SILO  buildingPaid 10000.0000 landPaid 1920.0000 balanceAfter 148080.0000
                     capacidad trigo 100000
GET  /api/inventory  WHEAT_LITERS 20700 L cap 100000 ocupacion bp 2070 valor 4554.0000
                     WOOD_M3 0 dm3 cap 0 ocupacion bp 0 valor 0.0000
GET  /api/market/prices
                     WHEAT_LITERS 0.2200 / L      0.2200 / L
                     WOOD_M3      0.0450 / dm3   45.0000 / m3
POST /api/market/sell 20.700 L
                     seq 10 vendidos 20700 ingreso 4554.0000 saldo 152634.0000 ocupacion bp 0
POST /api/market/sell misma clave de idempotencia
                     status 200, respuesta identica, un solo asiento
POST /api/market/sell de mas de lo almacenado
                     409 INSUFFICIENT_STOCK {'requiredUnits': 1, 'availableUnits': 0}
GET  /api/economy/ledger?limit=5
                     entryCount 4 balance 152634.0000 nextCursor None
                       4 CROP_SALE        4554.0000  -> 152634.0000
                       3 BUILDING_PURCHASE -10000.0000 -> 148080.0000
                       2 LAND_PURCHASE     -1920.0000 -> 158080.0000
                       1 STARTING_CAPITAL 160000.0000 -> 160000.0000
POST /api/dev/grant -200000
                     saldo -47366.0000
POST /api/land/purchase con saldo negativo
                     402 INSUFFICIENT_FUNDS
POST /api/market/sell con saldo negativo
                     200, ingreso 220.0000, saldo -47146.0000
limpieza             jugador, granja, edificio y celdas borrados
```

Las cifras cuadran con el catalogo sin literales: 20.700 L a 0,22 $/L son 4.554,00 $ (GDD §119 y
§123); el silo cuesta 10.000 $ (GDD §116) y su huella 16 celdas a 120 $, 1.920 $ (GDD §115); la
ocupacion de 20.700 L sobre 100.000 L son 2.070 puntos base, es decir el 20,7 %; y la madera se
cotiza a 0,0450 $ por decimetro cubico, que son los 45 $/m3 de GDD §133 divididos por mil. La
partida de prueba se ha borrado despues, de modo que el mundo de desarrollo queda como estaba
salvo por los restos de otros agentes del apartado 4.10.

### 5.3 No ejecutado

Conforme al brief: `git`, `npm install`, `prisma generate`, `prisma migrate`, `docker compose` y
construcciones de produccion. El servidor de desarrollo del apartado 5.2 se apago al terminar
(`puerto 3212 cerrado`). `make sync-types`, `make typecheck`, `make lint`, `make test-unit` y
`make test-int` regeneran `backend/src/shared`, `frontend/app/shared` y `frontend/.nuxt`, las tres
ignoradas por git y no editables a mano.

## Resuelto

Las notas aplicadas se conservan aqui con su numeracion original, porque otros documentos y
varios comentarios de codigo las citan por numero.

### 2.4 Tres pasos de la liquidacion quedan declarados y sin estrategia

Aplicado en parte por W7-A (integracion): `CANCEL_TASKS` tiene ya estrategia, la de `modules/tasks`, que
llega por el registro de `lib/moduleSeams.ts` porque `tasks` es de una fase posterior y ninguna relajacion
de la zona de ESLint podria permitir el import. `BUILDINGS` y `UNUSED_LAND` siguen declarados sin
estrategia y el asiento agregado los reporta como no ejecutados, que es el comportamiento deliberado.

El texto original de la nota:

Categoria: dependencia entre modulos, no un cambio en fichero ajeno
Propietarios: `modules/tasks` (W6-A), `modules/farms` (W4-B) y `modules/world` (W3-B)

El motor recorre `LIQUIDATION_STEPS` completo y cada paso declara o una estrategia o el motivo por
el que no la tiene; el asiento agregado registra los que ejecuto y los que no. Activos:
`INVENTORY`, `IDLE_MACHINES` y `WORKERS`. Declarados e inactivos:

| Paso | Que hace falta | Propietario |
|---|---|---|
| `CANCEL_TASKS` | Cancelar una tarea con desgaste prorrateado, liberacion de la reserva de silo y retirada del trabajo encolado | W6-A |
| `BUILDINGS` | Demoler un edificio: liberar las celdas de la huella y recalcular la capacidad de almacenamiento | W4-B |
| `UNUSED_LAND` | Devolver la propiedad de una celda: el simetrico de `claimCells` con incremento de version de chunk | W3-B |

Se ha optado deliberadamente por no implementarlos a medias. La liquidacion escribe en tablas de
otros modulos —`machines` y `workers`— porque la regla 4 prohibe importar un modulo hermano y
porque disponer de un activo sin que el jugador lo pida es, por definicion, la unica operacion que
no pertenece al modulo que lo administra; pero se limita a las dos marcas que el esquema garantiza
(`disposedGameMs` y `terminatedGameMs`), cuyos disparadores mantienen los contadores de ocupacion,
y filtra por `currentTaskId: null`, que es lo que el `CHECK` de la migracion inicial exige. Una
demolicion o una cancelacion a medias dejarian el estado incoherente, que es peor que no liquidar.

Activar un paso es anadir una funcion a la tabla `STEP_PLAN` de `liquidation.ts`. El umbral no se
mueve al hacerlo: el valor liquidable ya cuenta edificios y tierra sin uso, precisamente para que
activarlos no cambie cuando salta una liquidacion.

### 2.3 El contrato no lleva los filtros de la consulta del ledger

Aplicado por W7-A (integracion), con la ampliacion que la nota propone y una precision: `type` admite un
valor o una lista, que es lo que producen uno o varios `?type=`. `modules/economy/routes.ts` traduce los
tres campos y ya no pasa `NO_LEDGER_FILTER` completo.

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `shared/api/schemas/economy.ts`, `ledgerQuerySchema`
Propietario: W2-C (cerrado), a aplicar por W7-A si se considera

El brief pide la consulta del historico "paginada, con filtro por tipo y por intervalo".
`ledgerQuerySchema` es un `strictObject` con `limit` y `cursor` unicamente, de modo que una
peticion que nombre un tipo se rechaza en la frontera antes de llegar al modulo. El filtro esta
implementado y probado en `queryLedger` y `sumLedger`, y la ruta pasa el filtro vacio de forma
explicita (`NO_LEDGER_FILTER`) para que el hueco sea visible en el codigo. Ampliacion propuesta,
que no obliga a cambiar el modulo:

```ts
export const ledgerQuerySchema = z.strictObject({
  limit: limitQuerySchema(MAX_LEDGER_PAGE, DEFAULT_LEDGER_PAGE),
  cursor: cursorSchema.optional(),
  type: z.enum(LedgerType).optional(),
  fromGameMs: gameMsSchema.optional(),
  toGameMs: gameMsSchema.optional(),
});
```

`sumLedger` existe ademas porque el bloque economico del resumen de regreso de GDD §124 lo
necesita: agrega por tipo en la base de datos en lugar de traer un ano de asientos por el cable.
Es la funcion que W6-B debe consumir.

### 2.2 `idempotency.int.test.ts` afirma 501 para una ruta ya implementada

Resuelto por la ventana de integracion intermedia de W6.

El texto original de la nota:

Categoria: cambio en fichero de otro agente
Ficheros afectados: `backend/src/__tests__/idempotency.int.test.ts`
Propietario: W3-A (cerrado), a aplicar por W7-A o por el agente de cierre de W5

Es el unico rojo de `make test-int` al cerrar este ambito, y no procede de este modulo: la prueba
"no almacena la respuesta de un fallo del servidor" usa `POST /api/machines` como ejemplo de ruta
que mueve dinero y responde 501, y W5-A ya la ha implementado, de modo que responde 404 al recibir
una granja inexistente. Salida real:

```text
FAIL  src/__tests__/idempotency.int.test.ts > la cabecera Idempotency-Key >
      no almacena la respuesta de un fallo del servidor, de modo que el reintento sigue abierto
AssertionError: expected 404 to be 501
Test Files  1 failed | 24 passed (25)
Tests  1 failed | 212 passed (213)
```

Es el mismo defecto de fondo que ADR-0038 resolvio para `app.int.test.ts`: la prueba depende de
que una ruta concreta siga siendo andamiaje. El arreglo coherente con ese ADR es derivar la ruta
de `stubRouteKeys()` en lugar de nombrarla, tomando la primera clave que sea a la vez andamiaje y
`movesMoney`; si no queda ninguna, la prueba deja de aplicar y debe omitirse en lugar de fallar.
Este agente no la ha tocado por la regla 1: es el punto de encuentro de los tres agentes de W5.

### 2.1 El proceso `worker` no registra el enganche de la liquidacion

Aplicado por W7-A (integracion), y no exactamente como la nota propone. `registerEconomySweepHooks` se
invoca desde `registerModuleExtensions` de `src/handlers.ts`, junto con `registerForestryScheduledHandlers`
y las dos costuras de `lib/moduleSeams.ts`. El punto de relleno es `registerDomainHandlers`, que
`server.ts` y `worker.ts` invocan por igual, que es lo que hace que la instalacion no dependa de haber
construido la aplicacion Fastify.

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `backend/src/handlers.ts`
Propietario: W3-A (cerrado), a aplicar por W7-A
Motivo: `lib/jobs.ts` expone `registerSettleSweepHook` y su cabecera dice que la liquidacion
forzosa de la seccion 6.6 del plan es una de esas extensiones y que "belongs to the economy module
of workflow W5, which registers it here instead of reopening this file". Registrarla desde el
modulo tiene un limite: el unico punto de entrada del modulo es `registerEconomyRoutes`, que
invoca `src/app.ts`, y `src/worker.ts` no construye ninguna instancia de Fastify. El proceso
servidor registra el enganche y todo camino HTTP que avanza a un jugador lo aplica; el proceso
worker, no. Consecuencia real: un barrido aplicado por el worker liquida devengos y encadena el
siguiente barrido, pero no liquida activos.

Cambio a aplicar, una linea de importacion y una de llamada en `registerDomainHandlers`:

```ts
import { registerEconomySweepHooks } from './modules/economy/jobs.js';
// ...
export function registerDomainHandlers(services: ServiceContext): void {
  registerEconomySweepHooks();
  // el resto sin cambios
}
```

`registerEconomySweepHooks` es idempotente (una bandera de modulo), de modo que llamarla desde
`registerDomainHandlers` y desde `registerEconomyRoutes` no apila el enganche dos veces. Mitigacion
adoptada mientras tanto: se registra desde `registerEconomyRoutes`, que es lo que hace que la
politica funcione hoy por el camino HTTP y que las pruebas de integracion la ejerciten de verdad.
