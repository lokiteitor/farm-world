# NOTES-w4a

Agente de tierra. Fase W4. Ambito escrito: `backend/src/modules/land/**`,
`backend/src/__tests__/land/**` y este fichero.

Este fichero recoge lo que otros agentes deben hacer y que W4-A no podia hacer, las decisiones
del modulo que condicionan a las fases siguientes, y las discrepancias detectadas entre el
brief, el plan, el contrato congelado y la tabla de propiedad.

## 1. Pendiente para otros agentes

### 1.2 El contrato no lleva ni los motivos agregados ni el desglose por terreno

Categoria: contrato
Ficheros afectados: `shared/api/schemas/land.ts`, `landQuoteReplySchema`
Propietario del cambio: W7-A, si se decide ampliarlo

El brief de este agente pide que el presupuesto devuelva «el desglose por tipo de terreno» y
«la lista agregada de motivos de invalidez por ValidationCode, que es lo que el panel pinta».
`landQuoteReplySchema` es un objeto estricto y no declara ninguno de los dos campos: lleva
`cells`, `purchasableCount`, `blockedCount`, `total`, `balance`, `affordable` y
`firstBlockedCell`, y nada mas.

Resolucion adoptada, sin tocar el contrato: los dos son derivables de lo que si viaja, y se
derivan con la misma funcion compartida en los dos lados.

- El desglose por terreno sale de `cells[].terrain` y `cells[].price`, que el panel agrupa. El
  servicio calcula ademas el agregado (`LandQuote.byTerrain`) y las pruebas lo afirman, de modo
  que la cifra existe y esta comprobada aunque no cruce el cable.
- La lista agregada de motivos sale de `cells[].blockedBy`. El cliente no tiene que escribir esa
  agregacion: `validateSelection` de `shared/rules/selection.ts` ya la produce como
  `SelectionIssue[]`, con el recuento y la primera celda por codigo, y es la misma funcion que el
  servidor ejecuta. `firstBlockedCell` cubre ademas el caso concreto que el panel necesita para
  mover la camara al primer conflicto.

Si aun asi se prefiere que los dos viajen, la adicion natural es un campo `issues` y un campo
`byTerrain` en `landQuoteReplySchema`, ambos como adicion compatible: `LandQuote` ya los expone
con la forma exacta que tendrian.

## 2. Decisiones de W4-A, para las entradas de ADR de la fase

El apartado 3.3 de `docs/ownership.md` asigna a W4-A la redaccion de las entradas 0023 a 0026 de
`docs/adr.md`. No se ha escrito ninguna, por los dos motivos que ya llevaron a W3-A a la misma
conclusion (`NOTES-w3a.md`, apartado 1.4): el brief de este agente no incluye `docs/adr.md` entre
los directorios que puede escribir, y los agentes de la fase trabajan en paralelo, de modo que un
escritor que abra el fichero ahora no puede recoger las decisiones de los otros. El material va
aqui para que el agente de cierre lo incorpore con `scripts/adr-append.mjs`.

Conviene ademas tener presente que el reparto por temas del plan para esta fase (niveles de
detalle del renderizado, cache de chunks, geometria de campos y devengo por integral de solapes)
no cubre la compra de tierra. Lo que sigue es material para una entrada adicional, al modo de
ADR-0021 y ADR-0022, que W3 anadio fuera de su reparto; si no se considera que la merezca, los
tres puntos siguen documentados aqui y en los comentarios del modulo.

### 2.1 La compra cobra lo adquirido, no lo pedido

Decision: la compra revalida la seleccion contra la base de datos dentro de su propia
transaccion, reclama las celdas con la actualizacion condicional de `claimCells` y calcula el
precio sobre las celdas que esa llamada devolvio, nunca sobre las que la peticion pedia ni sobre
las que la validacion aprobo.

Motivo: entre la validacion y la reclamacion cabe un competidor. Bajo `READ COMMITTED` las dos
transacciones leen la misma celda como libre, y lo unico que las obliga a verse es que las dos
escriben la misma fila; el recuento de filas es entonces la decision (ADR-0018). Calcular el
precio antes de la reclamacion habria cobrado una celda que otro jugador se llevo.

Consecuencia comprobada: dos compras concurrentes de la misma celda dejan exactamente una fila,
exactamente un asiento `LAND_PURCHASE` entre los dos jugadores, y el que no la obtuvo no paga
nada.

### 2.2 `expectedTotal` se compara despues de la reclamacion, no antes

Decision: cuando el cuerpo lleva `expectedTotal`, se compara con el total de lo realmente
adquirido y no con el de lo presupuestado. Si difieren se responde `VALIDATION_FAILED` con
`details.expected` y `details.actual`, y la transaccion entera revierte, de modo que ni se
reclama ni se cobra nada.

Motivo: una sola regla cubre los dos casos que el campo existe para atrapar. Un presupuesto
caducado da un total distinto porque alguien compro una celda de la seleccion; una carrera
perdida da un total distinto por la misma razon, solo que unos milisegundos mas tarde. Comparar
antes de reclamar habria dejado el segundo caso sin cubrir, que es precisamente el que
`NOTES-W2c.md` apartado 1.3 quiere evitar: «en lugar de cobrar en silencio un presupuesto
caducado».

Coste asumido: con `allowPartial: true` y `expectedTotal` presente, una carrera perdida rechaza
la peticion entera en lugar de comprar menos. Es deliberado: el campo declara que el jugador
acepto una cifra concreta, y comprar por otra cifra sin decirselo es lo que el campo prohibe.

### 2.3 La seleccion se deduplica en el servidor y las cuentas se refieren al conjunto distinto

Decision: las dos rutas colapsan las celdas repetidas antes de cualquier otra cosa. El
presupuesto devuelve una entrada por celda distinta, y en la compra
`purchasedCount + skippedCount` es el numero de celdas distintas de la peticion.

Motivo: lo exige el propio contrato (`cellSelectionSchema` lo declara en su comentario) y sin
ello el presupuesto seria incumplible. La unicidad `(worldId, chunkX, chunkY, idx)` hace que la
segunda copia de una celda no adquiera nada, de modo que un total que la hubiera valorado dos
veces no podria cobrarse nunca y el panel mostraria una cifra que la compra contradice.

Consecuencia registrada: es la divergencia con el servidor simulado del apartado 1.3.

## 3. Lo que las fases siguientes encuentran hecho

No es una peticion; es lo que conviene leer antes de tocar la rejilla desde otro modulo.

- `modules/land/service.ts` exporta `normaliseSelection`, `quoteSelection` y `purchaseLand`. Las
  tres son consumibles desde otro modulo de una fase posterior, porque las zonas de ESLint ya
  distinguen fases: `machinery`, `workers`, `economy`, `tasks`, `session` y `forestry` pueden
  importar `land`; `farms` y `fields`, hermanos de esta fase, no.
- `normaliseSelection` es la unica funcion del modulo que decide que es una seleccion valida en
  tamano y en rango de coordenada. Comprueba el limite de `MAX_ABSOLUTE_CELL_COORDINATE` que
  `cellKey` impone y que `cellOrdinateSchema` no cubre, de modo que una coordenada enorme es un
  400 y no un 500. Cualquier modulo que reciba una seleccion del cliente tiene el mismo hueco y
  conviene que lo cierre igual.
- La compra emite las tres tramas del contrato en su orden declarado: una `CHUNK_PATCHED` por
  chunk tocado, una `PLAYER_UPSERTED` y una `LEDGER_APPENDED`. La ultima solo se emite cuando
  hubo asiento, es decir cuando se adquirio algo: una compra que no adquiere nada no escribe un
  asiento de importe cero.
- El modulo `land` no tiene manejador de evento agendado y no aparece en `src/handlers.ts`, de
  modo que no contribuye a `farm_world_scheduled_events_unhandled_total`. El punto 6 del brief
  no le aplica.

## 4. Discrepancias detectadas

### 4.1 El brief pide campos que el contrato congelado no declara

Recogida en el apartado 1.2. Se ha seguido el contrato, que es el artefacto congelado, y se ha
dejado la agregacion derivable con la misma funcion compartida en los dos lados.

### 4.2 El tope de seleccion se aplica dos veces y solo una es alcanzable

`MAX_SELECTION_CELLS` esta en `shared/config/world.ts` y lo aplican dos capas: el esquema del
contrato, que acota el array en 2.000, y `normaliseSelection`. Como el esquema rechaza antes, la
comprobacion del modulo es inalcanzable por HTTP y el codigo que un cliente recibe al pasarse es
`VALIDATION_FAILED` y no `SELECTION_TOO_LARGE`.

No es un defecto: los dos son 400 y el cliente no puede llegar ahi, porque aplica el mismo tope
al arrastrar. Se registra porque una prueba que espere `SELECTION_TOO_LARGE` desde HTTP fallara,
y porque `selectionTooLarge()` de `shared/api/errors.ts` queda sin llamante en este modulo salvo
para un consumidor interno al proceso.

### 4.3 `docs/ownership.md` no recoge los ficheros de este modulo

El apartado 3.5 atribuye `backend/src/modules/land/` y `backend/src/__tests__/land/` a W4-A, que
es correcto, y no enumera ficheros. Los que existen son `index.ts`, `routes.ts` y `service.ts` en
el modulo, y `fixtures.ts`, `quote.int.test.ts` y `purchase.int.test.ts` en las pruebas. Ninguno
queda sin dueno; se listan para que el cierre de la fase pueda cuadrar la tabla con
`git ls-files` sin abrir el directorio.

### 4.4 La convencion de nombres de los ficheros de traspaso sigue sin ser uniforme

Este fichero se llama `NOTES-w4a.md`, en minuscula, siguiendo a `NOTES-w3a.md` y no a
`NOTES-W2a.md`. El apartado 3.3 de `docs/ownership.md` ya admite que el nombre es libre siempre
que sea unico por agente.

## 5. Verificacion ejecutada

| Orden | Resultado |
|---|---|
| `make sync-types` | exit 0. 53 ficheros a cada copia |
| `cd backend && npx tsc --noEmit` | exit 0, sin salida |
| `make typecheck` | exit 0. `shared`, `backend` y `vue-tsc` del cliente en verde |
| `npx eslint backend/src/modules/land backend/src/__tests__/land` | exit 0, sin hallazgos, incluidas las reglas de zona |
| `npx prettier --check` sobre los seis ficheros del ambito | exit 0, "All matched files use Prettier code style!" |
| `make lint` | exit 1, por un `no-unused-vars` en `backend/src/__tests__/farms/capacity.int.test.ts`, que es de W4-B. Ningun hallazgo en el ambito de W4-A |
| `make test-unit` | exit 0. `shared` 23 ficheros y 418 pruebas; cliente 9 ficheros y 93 pruebas |
| `cd backend && npx vitest run --config vitest.int.config.ts src/__tests__/land` | exit 0. 2 ficheros y 24 pruebas en verde |
| `make test-int` | exit 2. 15 ficheros y 162 pruebas: 158 en verde y 4 en rojo, las cuatro del apartado 1.1, todas de `app.int.test.ts` y ninguna del modulo `land` |
| Servidor arrancado con `PORT=3211 npx tsx src/server.ts` y comprobacion por HTTP | Presupuesto, compra, `expectedTotal` desfasado, repeticion con la misma clave de idempotencia y segunda compra de las mismas celdas. Salidas en el apartado 6 |

No ejecutado, conforme al brief: `git`, `npm install`, `prisma generate`, `prisma migrate`,
`docker compose` y construcciones de produccion.

## 6. Comprobacion por HTTP contra la pila real

Jugador registrado en el mundo de desarrollo (semilla 20260811), veinte celdas a partir de su
origen. El jugador y sus celdas se borraron al terminar; ver el apartado 1.4 sobre las filas de
`chunks` que quedaron.

```text
--- POST /api/land/quote ---
{'purchasableCount': 20, 'blockedCount': 0, 'total': '2400.0000', 'balance': '160000.0000',
 'affordable': True, 'firstBlockedCell': None}
primeras 3 celdas: [{'cellX': 696, 'cellY': 621, 'terrain': 'GRASS', 'price': '120.0000', 'blockedBy': None}, ...]

--- POST /api/land/purchase con expectedTotal desfasado ---
HTTP 400  {"error":{"code":"VALIDATION_FAILED","message":"La peticion no cumple el esquema esperado.",
           "details":{"field":"body.expectedTotal","expected":"1.0000","actual":"2400.0000"}}}

--- POST /api/land/purchase ---
HTTP 200  seq= 4 atGameMs= 4239311508
{'purchasedCount': 20, 'skippedCount': 0, 'totalPaid': '2400.0000', 'balanceAfter': '157600.0000'}

--- repeticion con la misma Idempotency-Key ---
HTTP 200   respuesta identica: True

--- segunda compra de las mismas celdas, allowPartial=false ---
HTTP 409  {"error":{"code":"CELL_ALREADY_OWNED","message":"Alguna de las celdas ya tiene propietario.",
           "details":{"cells":[{"cellX":696,"cellY":621}]}}}

--- GET /api/auth/me ---
{'balance': '157600.0000', 'projectedBalance': '157600.0000', 'ledgerSeq': 2, 'eventSeq': 4}
```

Estado del libro mayor y del registro de eventos de ese jugador, leidos antes de borrarlo:

```text
seq=1 STARTING_CAPITAL amount=160000 balanceAfter=160000 key=starting-capital:019ff6bb-...
seq=2 LAND_PURCHASE    amount=-2400  balanceAfter=157600 key=land-purchase:019ff6bb-...:w4a-ok-1
suma=157600.0000 saldo=157600.0000
eventos: 1:CHUNK_PATCHED 2:CHUNK_PATCHED 3:PLAYER_UPSERTED 4:LEDGER_APPENDED
```

Las veinte celdas cruzan dos chunks, de ahi las dos tramas `CHUNK_PATCHED`. La secuencia no tiene
huecos y termina exactamente en el `seq` que la respuesta mutante reporta, que es lo que permite
al cliente aplicar la respuesta y descartar el eco en cualquier orden (ADR-0019).

## 7. Cobertura de las pruebas del modulo

`backend/src/__tests__/land/`, 24 pruebas de integracion contra PostgreSQL y Redis reales. Ningun
literal de precio: las cifras se reconstruyen desde `shared/config/economy.ts` a traves de
`Money.fromUnits`, de modo que un cambio de balance mueve la prueba y no la rompe.

Ninguna coordenada esta escrita a mano. El mundo del arnes lleva una semilla negativa aleatoria,
asi que cada caso busca sus celdas ejecutando el mismo generador determinista que el modulo, lo
que hace las afirmaciones validas para cualquier semilla en lugar de para una.

| Caso | Afirmacion |
|---|---|
| Presupuesto de 330 celdas de pradera | 39.600 exactos, 120 por celda, sin celdas bloqueadas (GDD 115 y 117) |
| Presupuesto de bosque | 70 por celda |
| Presupuesto mixto | 5 x 120 + 3 x 70 = 810 |
| Montana y agua | `TERRAIN_NOT_PURCHASABLE` y precio nulo en las dos, con `firstBlockedCell` |
| Celda ya poseida | `CELL_ALREADY_OWNED`, precio nulo, y solo la otra celda se valora |
| Celdas repetidas | Una entrada, un precio |
| Saldo y asequibilidad | El saldo liquidado de la columna y `affordable` coherente |
| El presupuesto no muta | Ni celdas, ni chunks, ni asientos, ni saldo |
| Tope de seleccion | 400 en las dos rutas |
| Compra de 330 celdas de pradera | Descuenta 39.600 exactos; la respuesta, la columna y el asiento coinciden; no se crea ningun campo |
| Compra de bosque | No se materializa ningun arbol (plan 2.2) |
| Montana y agua | 409, sin cobro y sin fila de celda |
| Segunda compra de lo ya poseido | 409 `CELL_ALREADY_OWNED`, saldo intacto |
| Fondos insuficientes | 402, y ninguna celda reclamada: la reversion arrastra la reclamacion |
| `expectedTotal` desfasado | 400 con `expected` y `actual`; la misma peticion con la cifra correcta pasa |
| Dos compras concurrentes de la misma celda | Estados `[200, 409]`, una sola fila, un solo asiento, y paga el que la obtuvo |
| Version de chunk | Sube una sola vez por compra, con varias celdas del mismo chunk |
| Compra parcial | Cobra solo lo adquirido y no reclama lo bloqueado |
| Idempotencia | Sin cabecera es 400; con la misma clave la respuesta se reproduce y el saldo no se mueve dos veces |
| Auditoria del libro mayor | La suma de los asientos es exactamente igual al saldo (ADR-0009) |
| WebSocket | Sobre un socket real, con ticket real: `CHUNK_PATCHED`, `PLAYER_UPSERTED` y `LEDGER_APPENDED` en ese orden, sin huecos de secuencia y terminando en el `seq` de la respuesta |
| Celda vendida antes de la compra | Con `allowPartial`, 200 con cero compradas, sin cobro y sin asiento |

## Resuelto

Las notas aplicadas se conservan aqui con su numeracion original, porque otros documentos y
varios comentarios de codigo las citan por numero.

### 1.4 La comprobacion por HTTP dejo filas de `chunks` en la base de desarrollo

Aplicado por W7-A (integracion). La base de desarrollo queda con un solo mundo, el de semilla 20260811, y
un solo jugador, el de la semilla. Se borraron los ocho mundos efimeros de suites cuyo `teardown` no llego
a correr y los dieciocho jugadores de verificacion de W3, W4, W5 y W6, en el orden que imponen las
restricciones `onDelete: Restrict`, y con ellos los diecinueve eventos agendados que el proceso worker
reportaba como \«due event of a player that no longer exists\».

El texto original de la nota:

Categoria: estado de la maquina de desarrollo
Ficheros afectados: ninguno; base de datos de desarrollo, mundo de semilla 20260811
Propietario: W7-A, si decide reiniciar la base

La comprobacion con el servidor arrancado registro un jugador, compro veinte celdas y borro
despues las celdas y el jugador. Las filas de `chunks` que la compra creo siguen ahi, con
`version` en 1 y sin ninguna celda asociada. Es inocuo: un chunk con version 1 y sin celdas y un
chunk sin fila se responden con el mismo contenido y solo difieren en el numero de version, de
modo que un cliente que ya lo tuviera cacheado recargaria una vez.

No se borraron a proposito. Los agentes W4-B y W4-C estaban escribiendo sobre la misma base al
mismo tiempo, y un borrado por criterio amplio sobre `chunks` habria podido llevarse filas suyas.

### 1.3 El servidor simulado del cliente valora dos veces una celda repetida

Aplicado antes de W7: `frontend/app/mock/handlers.ts` deduplica por `cellKey` con `distinctCells` al
entrar en el presupuesto y en la compra, igual que el servidor real.

El texto original de la nota:

Categoria: divergencia entre el servidor real y el servidor simulado
Ficheros afectados: `frontend/app/mock/handlers.ts`, manejadores de `land`
Propietario del cambio: W3-C (cerrado), a aplicar por W7-A

El servidor real colapsa las celdas repetidas antes de presupuestar y antes de comprar, que es
lo que `cellSelectionSchema` declara expresamente («the server deduplicates»). El servidor
simulado recorre `input.cells` sin deduplicar, de modo que una celda enviada dos veces se
presupuesta a 240 y no a 120.

Consecuencia concreta para el panel de compra de W4-E: contra el servidor simulado,
`purchasedCount + skippedCount` es el numero de celdas enviadas; contra el servidor real es el
numero de celdas distintas. Un panel que asuma la primera igualdad mostrara un descuadre cuando
la seleccion contenga solapes, que es justo lo que produce la union de rectangulos de la
herramienta de seleccion de W5-E.

Mitigacion adoptada: ninguna necesaria en el servidor real, que es el autoritativo. El cambio en
el simulado es deduplicar por `cellKey` al entrar en los dos manejadores.

### 1.1 La lista `IMPLEMENTED` de `app.int.test.ts` esta desfasada

Resuelto por ADR-0038, que derivo la lista de `stubRouteKeys()` del registro de rutas. La prueba no
depende ya de que ninguna ruta concreta siga siendo andamiaje.

El texto original de la nota:

Categoria: cambio en fichero de otro agente
Ficheros afectados: `backend/src/__tests__/app.int.test.ts`
Propietario del cambio: W3-A (cerrado), a aplicar por el agente de cierre de W4 o por W7-A

Es la reaparicion, con otros modulos, del apartado 1 de `NOTES-w3-cierre.md`. La constante
`IMPLEMENTED` enumera las quince rutas que W3 sirvio, y `POST /api/land/quote` y
`POST /api/land/purchase` ya no son andamiaje. Las dos siguen figurando en `stubs`, y la
afirmacion `expect(stubs.length).toBe(40)` sigue pasando.

Las dos rutas de tierra no ponen la prueba en rojo hoy, por una razon que conviene registrar
porque es fragil: el cuerpo vacio que la prueba envia no satisface el esquema del contrato, de
modo que las dos entran por la rama de 400 que la propia prueba admite. Es decir, la prueba
pasa sin comprobar nada sobre ellas. Si algun dia el cuerpo de la prueba pasara a satisfacer el
esquema, las dos fallarian.

Lo que si esta en rojo al cerrar esta fase son cuatro rutas de los modulos hermanos, cuyas
lecturas no llevan cuerpo y por tanto responden 200 donde la lista espera 501:

```text
FAIL  src/__tests__/app.int.test.ts > las rutas todavia no implementadas > GET /api/farms responde 501 con NOT_IMPLEMENTED
FAIL  src/__tests__/app.int.test.ts > las rutas todavia no implementadas > GET /api/fields responde 501 con NOT_IMPLEMENTED
FAIL  src/__tests__/app.int.test.ts > las rutas todavia no implementadas > DELETE /api/buildings/:buildingId responde 501 con NOT_IMPLEMENTED
FAIL  src/__tests__/app.int.test.ts > las rutas todavia no implementadas > GET /api/fields/:fieldId responde 501 con NOT_IMPLEMENTED
Test Files  1 failed | 14 passed (15)
Tests  4 failed | 158 passed (162)
```

Cambio a aplicar: anadir a `IMPLEMENTED` las rutas que W4 sirve, incluidas
`'POST /api/land/quote'` y `'POST /api/land/purchase'`, y ajustar el recuento de
`expect(stubs.length).toBe(40)` y el comentario que lo acompana. El recuento final depende de
cuantas rutas cierren los tres modulos de la fase, de modo que conviene aplicarlo una sola vez
al cerrar W4 y no una vez por modulo.

Mitigacion adoptada mientras tanto: ninguna posible desde este ambito. La regla 1 de
`docs/ownership.md` atribuye el fichero a W3-A y este agente no lo ha tocado.
