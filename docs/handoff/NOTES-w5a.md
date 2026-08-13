# NOTES-w5a

Agente de maquinaria del flujo W5. Ambito escrito, y nada mas:

- `backend/src/modules/machinery/` (`index.ts`, `record.ts`, `readModel.ts`, `service.ts`, `jobs.ts`,
  `routes.ts`)
- `backend/src/__tests__/machinery/` (`fixtures.ts`, `machinery.int.test.ts`, `repair.int.test.ts`)
- Este fichero

No se ha tocado `src/app.ts`, `src/handlers.ts`, `plugins/`, `lib/`, `prisma/`, `shared/`, el Makefile,
los ficheros de Compose ni ningun `package.json` o `tsconfig`. Sustituir el andamiaje consistio en
cambiar `defineStubRoute` por `defineRoute` dentro del propio modulo, conforme a la regla 3 del plan.

No se ha ejecutado `git`, `npm install`, `prisma migrate`, `prisma generate`, `docker compose` ni
ninguna construccion de produccion. El unico servidor levantado, un `tsx src/server.ts` en el puerto
3211 para la verificacion por HTTP, quedo apagado al terminar, y los tres jugadores de prueba que esa
verificacion creo (`w5a-*@test.invalid`) fueron borrados de la base de desarrollo.

---

## 1. Verificacion

Salidas reales, desde la raiz del repositorio, con PostgreSQL en 55432 y Redis en 56379.

| Orden | Resultado |
|---|---|
| `make sync-types` | exit 0. 53 ficheros a cada copia |
| `npx tsc --noEmit` en `backend/` | exit 0, sin salida |
| `make typecheck` | exit 0 |
| `make test-unit` | exit 0. `shared` 23 ficheros y 418 pruebas; cliente 40 ficheros y 368 pruebas |
| `npx vitest run --config vitest.int.config.ts src/__tests__/machinery` | exit 0. 2 ficheros y 17 pruebas |
| `make test-int` | exit 1. 25 ficheros y 212 pruebas, 211 en verde y 1 en rojo, la del apartado 2.1 |
| `make lint` | exit 1, por cinco ficheros de `backend/src/__tests__/economy/` sin formatear. Ninguno es de este agente; `npx eslint backend/src/modules/machinery backend/src/__tests__/machinery` y `npx prettier --check` sobre esos dos directorios devuelven 0 |

Las diecisiete pruebas del modulo, por si sirve para localizar una regresion:

```
✓ desgaste (GDD §93) > el desgaste por hora trabajada coincide con la tasa del catalogo
✓ desgaste (GDD §93) > no aplica desgaste por inactividad ni retrocede la marca
✓ desgaste (GDD §93) > rechaza la asignacion por debajo de la condicion minima
✓ reparacion (GDD §29 y §93) > rechaza la reparacion en una granja sin taller
✓ reparacion (GDD §29 y §93) > cobra el coste de la formula de §93 y agenda el evento con su duracion
✓ reparacion (GDD §29 y §93) > pasa por IN_REPAIR y vuelve a IDLE con la condicion restaurada al vencer el evento
✓ reparacion (GDD §29 y §93) > admite una reparacion parcial y no admite una segunda mientras dura
✓ reparacion (GDD §29 y §93) > rechaza reparar una maquina que ya esta en condicion plena
✓ mantenimiento devengado (GDD §94) > el devengo de una maquina coincide con la integral de su intervalo de vigencia
✓ GET /api/machines/catalog > publica el catalogo de §89 y §134 y la tabla de compatibilidad de §90
✓ POST /api/machines > compra una maquina, la deja en IDLE al 100 % y ocupa una plaza de garaje
✓ POST /api/machines > rechaza la quinta maquina en un garaje de cuatro plazas con GARAGE_CAPACITY_EXCEEDED
✓ POST /api/machines > con una sola plaza libre, dos compras concurrentes dejan ganar a una
✓ POST /api/machines > rechaza un presupuesto obsoleto sin cobrar nada
✓ POST /api/machines > rechaza un garaje que no es de la granja
✓ POST /api/machines/:machineId/sell > libera la plaza, cierra el intervalo de vigencia y abona el valor de reventa
✓ POST /api/machines/:machineId/sell > rechaza vender una maquina asignada a una tarea en curso
```

### 1.1 Llamadas HTTP reales

Servidor propio en `127.0.0.1:3211` contra la base de desarrollo. Recorrido completo: registro,
`GET /api/world/info` para el origen del jugador, granja, garaje de 6 x 8 con cuatro plazas, compra,
listado, reparacion sin taller, cuarta y quinta compra, venta y recompra. Extractos literales:

```
### POST /api/machines (compra de tractor)
"machine": { "type": "TRACTOR", "conditionBp": 10000, "status": "IDLE",
             "repairEndsAtGameMs": null, "purchasePrice": "18000.0000",
             "resaleValue": "10800.0000", "assignable": true },
"totalPaid": "18000.0000", "garageSlotsUsed": 1, "garageSlotsTotal": 4

### quinta maquina en un garaje de cuatro plazas
HTTP 409
{"error":{"code":"GARAGE_CAPACITY_EXCEEDED","message":"No queda plaza libre de garaje.",
          "details":{"occupancy":4,"capacity":4}}}

### POST /api/machines/:id/repair sin taller
HTTP 409
{"error":{"code":"WORKSHOP_REQUIRED","message":"La reparacion exige un taller en la granja.", ...}}

### POST /api/machines/:id/sell
"result": {"refund":"10800.0000","balanceAfter":"119539.9869",
           "garageSlotsUsed":3,"garageSlotsTotal":4}

### recompra tras la venta
HTTP 200
```

Segundo recorrido, con taller construido y la condicion bajada al 50 % por escritura directa, porque el
desgaste solo lo produce el motor de tareas de W6:

```
### POST /api/machines/:id/repair con taller
"machine": { "conditionBp": 5000, "status": "IN_REPAIR",
             "conditionUpdatedAtGameMs": "4436665296",
             "repairEndsAtGameMs": "4481665296",
             "repairCost": "2700.0000", "repairDurationGameHours": 12.5,
             "assignable": false },
"pointsRestored": 50, "totalPaid": "2700.0000"

### venta durante la reparacion
HTTP 409 MACHINE_NOT_IDLE

### segunda reparacion mientras dura la primera
HTTP 409 MACHINE_NOT_REPAIRABLE
```

Las dos cifras son las del catalogo sin intermediarios: 54 $ por punto por cincuenta puntos son
2.700 $, y 0,25 h por punto por cincuenta puntos son 12,5 h de juego, que es exactamente la diferencia
`4481665296 - 4436665296 = 45.000.000` ms.

---

## 2. Pendiente

### 2.3 El cuerpo vacio de `POST /api/machines/:machineId/sell`

Categoria: informativo, para el agente de paneles W5-F
Ficheros afectados: ninguno del servidor

La ruta de venta no declara cuerpo en el contrato. Un cliente que envie
`Content-Type: application/json` sin carga recibe 400 `VALIDATION_FAILED`, porque Fastify rechaza el
cuerpo JSON vacio antes de llegar al manejador. El panel debe emitir la peticion sin cuerpo y sin esa
cabecera, o con `{}`. La cabecera `Idempotency-Key` si es obligatoria en las tres rutas mutantes.

---

## 3. Decisiones para el ADR

La numeracion de esta fase arranca en 0039 y la escribe el agente de cierre. Estas son las decisiones
que este modulo tomo y que no estaban ya escritas.

### 3.1 La duracion de la reparacion codifica los puntos comprados

El plan situa en W6 la entrada «reparacion como evento agendado que activa IN_REPAIR»; la
implementacion es de esta fase, de modo que la decision se documenta aqui y el numero lo asigna quien
cierre.

`ScheduledEvent` transporta identificadores, `dueGameMs` y `epoch`, nunca cantidades (plan 6.4), y
`Machine` no tiene columna para la condicion objetivo de una reparacion. Ninguna de las dos cosas hace
falta, porque la longitud de la reparacion **es** el numero de puntos pagados:

```
durationGameMs = (objetivoBp - condicionBp) x REPAIR_MS_PER_CONDITION_POINT / 100
restauradoBp   = (repairEndsAtGameMs - conditionUpdatedAtGameMs) x 100 / REPAIR_MS_PER_CONDITION_POINT
```

`conditionUpdatedAtGameMs` se escribe con el instante en que arranca la reparacion, que es cierto en
el sentido estricto que la columna tiene: la condicion quedo liquidada entonces, y no puede moverse
mientras la maquina esta en el taller, porque el desgaste solo se aplica a horas trabajadas (§93) y una
maquina `IN_REPAIR` no puede asignarse a una tarea. El manejador recalcula lo que la peticion compro en
lugar de recordarlo, que es la misma disciplina que `modules/fields` sigue con la fase proyectada. Las
dos conversiones son exactas en enteros: 0,25 h por punto son 900.000 ms, y 9.000 ms por punto basico.

La alternativa descartada era restaurar la condicion al agendar y usar `IN_REPAIR` solo como ocupacion.
Es mas simple y es mentira: dejaria una maquina al 100 % que todavia esta en el taller, y el valor de
reventa que el panel muestra seria el de una reparacion que no ha ocurrido.

### 3.2 La reparacion parcial se valora con la misma regla evaluada dos veces

`repairCostBetween(c, t) = repairCost(c) - repairCost(t)`, que por construccion es
`repairCostPerPoint x (t - c) / 100` y coincide exactamente con `repairCost(c)` cuando el objetivo es la
condicion plena. Lo mismo con la duracion. Asi la reparacion parcial que el contrato admite
(`toConditionBp`) y la reparacion completa que describe §93 no pueden separarse, y no hay una segunda
formula que mantener.

Consecuencia menor y declarada: el contrato tipa `pointsRestored` como entero positivo, mientras que la
restauracion es exacta en puntos basicos. Se informa `Math.ceil((objetivo - condicion) / 100)`, de modo
que una maquina cuya condicion no es un numero entero de puntos informa el punto en el que esta. El
importe cobrado es siempre el exacto.

### 3.3 La plaza de garaje se decide en `farms` y la restriccion es red de seguridad

`resolveGarageSlot` responde el caso previsible antes de la sentencia, con
`requireGarageSlot`/`buildingsWithFreeSlot` de `modules/farms/service.ts`, de modo que el rechazo lleva
las cifras de ocupacion que el panel necesita. `buildings_capacity_check` queda como red de seguridad,
traducida por `withConstraintTranslation` de `farms`, y el contador `machineCount` no lo escribe nunca
este modulo: lo mantiene el disparador `machines_garage_occupancy`, que reacciona tanto al alta como al
borrado logico, y es lo que hace que vender libere la plaza sin codigo adicional.

La serializacion real de dos compras concurrentes del mismo jugador la da el bloqueo de la fila del
jugador de `withPlayerAdvanced`, no la restriccion: la prueba de carrera comprueba que exactamente una
de las dos gana y que el contador queda en cuatro.

### 3.4 Las dos piezas que consume el motor de tareas de W6

`requireAssignableMachines(db, playerId, ids, minConditionBp)` y
`applyMachineWear(tx, ids, horas, atGameMs)`, mas su variante por intervalo. El desgaste se pasa en
horas y no en instantes porque la cancelacion de §106 lo prorratea sobre las horas realmente
trabajadas, que el motor ya calcula; la variante por intervalo existe porque
`[startGameMs, endedGameMs)` es exactamente el intervalo sobre el que `lib/accrual.ts` integra el coste
de operacion, de modo que las horas que desgastan y las horas que se facturan son las mismas por
construccion.

Tres propiedades de las que el llamante depende: cero o menos horas no escriben nada, porque una tarea
cancelada en el instante en que empezo trabajo nada; la marca no retrocede, de modo que una segunda
entrega del mismo cierre es inocua; y no hay degradacion por inactividad (§93 y §99), que es la razon
de que la marca solo se mueva cuando hay horas contabilizadas.

### 3.5 `MACHINE_NOT_IDLE` cubre tres capas del mismo hecho

La venta comprueba el estado, la columna de reserva `currentTaskId` y el enlace `task_machines` con una
tarea `IN_PROGRESS`. Son el mismo hecho visto desde tres sitios, y una venta que se colara por una de
ellas dejaria una tarea en curso apuntando a una maquina que ya no existe. El contrato no tiene un
codigo distinto para «reservada por una tarea», y no hace falta: el panel lo que necesita saber es que
no esta disponible.

### 3.6 `record.ts` existe para romper un ciclo, no para anadir una capa

`service.ts` emite sobres y por tanto necesita el modelo de lectura, y `readModel.ts` necesita la fila
y sus derivados. Todo lo que ambos comparten vive en `record.ts`, de modo que el grafo del modulo es
una cadena (`record` <- `readModel` <- `service`) y no un lazo.

---

## 4. Discrepancias detectadas

1. **§95 frente al plan 2.2, ya recogida en las erratas.** El GDD marca `IN_REPAIR` como reservado; el
   plan lo activa. Implementado como estado real. `BROKEN` no se escribe en ningun camino: los fallos
   aleatorios quedan fuera del MVP estricto y el valor existe en el enumerado, que es lo unico que §95
   pide.
2. **§93 no define `wearRatePerHour` ni el coste por punto ni la duracion.** Los tres son valores
   inventados que ya estaban en `shared/config/machines.ts` con su justificacion (15, 25 y 30 bp/h;
   0,30 % del precio por punto; 0,25 h por punto). Este modulo no anade ninguna constante de balance.
3. **§98 lista `maintenanceCost`, `operatingCost`, `workWidth` y `workSpeed` como columnas de
   `Machine`.** Son catalogo indexado por tipo (plan 5.2) y no viajan en el DTO. Lo que si viaja es
   `purchasePrice`, el precio realmente pagado, para que la reventa siga siendo auditable tras un
   reajuste del catalogo.
4. **§93 habla de un umbral de advertencia «ej. 20 %» sin decir quien lo aplica.** El servidor lo
   publica en `GET /api/machines/catalog` como `conditionWarningThresholdBp` y no lo usa para nada mas;
   la advertencia es de interfaz.
5. **El coste de la reparacion no es una compra.** Se asienta con su propio tipo `MACHINE_REPAIR`, para
   que el resumen de regreso de §124, que agrega por tipo de asiento, no lo confunda con
   `MACHINE_PURCHASE`. Lo mismo con `MACHINE_SALE` frente al resto de ingresos.
6. **Faltan las etiquetas en castellano de `MachineType` y de `MachineStatus`**, ya declarado en
   `NOTES-w4f.md` 2.4. Corresponden al panel de maquinaria de W5-F. El servidor entrega los
   identificadores del enumerado y las cifras del catalogo; no hay texto de presentacion en el
   contrato.
7. **La compatibilidad de §90 no la valida este modulo.** `explainIncompatibility` de
   `shared/rules/machinery.ts` es la regla, y quien la invoca es el motor de tareas de W6-A al validar
   la secuencia de seis comprobaciones de §104. Este modulo solo publica la tabla en el catalogo.

## Resuelto

Las notas aplicadas se conservan aqui con su numeracion original, porque otros documentos y
varios comentarios de codigo las citan por numero.

### 2.2 Cinco ficheros sin formatear dejan `make lint` en rojo

Resuelto: `npx prettier --check .` no senala ningun fichero.

El texto original de la nota:

Categoria: informativo, fuera de ambito
Ficheros afectados: `backend/src/__tests__/economy/{debt,liquidation,market,recompute}.int.test.ts` y
`backend/src/__tests__/economy/fixtures.ts`
Propietario: W5-C

`npx prettier --check` los senala. No se han tocado. Los directorios de este agente pasan `eslint` y
`prettier --check` sin hallazgos.

### 2.1 `make test-int` queda en rojo por una referencia literal a una ruta de este modulo

Resuelto por la ventana de integracion intermedia de W6, y no con el parche que esta nota propone sino
con otro mejor: la prueba ejercita `completeIdempotency` directamente, con un registro creado a mano y una
respuesta 503, de modo que la invariante que defiende deja de depender de ninguna ruta.

El texto original de la nota:

Categoria: cambio en fichero de otro agente
Fichero afectado: `backend/src/__tests__/idempotency.int.test.ts`, lineas 147-159
Propietario: W3-A (cerrado), a aplicar por W7-A
Mitigacion: ninguna posible desde este ambito; el resto de la suite queda en verde

El caso «no almacena la respuesta de un fallo del servidor, de modo que el reintento sigue abierto»
usa `POST /api/machines` como ejemplo de andamiaje que responde 501. Implementado el modulo, esa ruta
ya no responde 501, de modo que la prueba falla:

```
FAIL  src/__tests__/idempotency.int.test.ts > la cabecera Idempotency-Key >
      no almacena la respuesta de un fallo del servidor, de modo que el reintento sigue abierto
AssertionError: expected 404 to be 501
```

Es el mismo defecto que ADR-0038 resolvio en `app.int.test.ts`: una prueba escrita contra una lista
literal de rutas sin implementar. No se ha tocado por el mismo motivo por el que los tres agentes de
backend de W4 se abstuvieron de `app.int.test.ts`: es punto de encuentro de varios agentes y el ultimo
en escribir borraria a los otros.

Advertencia para quien lo aplique: **no queda ninguna ruta con `requiresIdempotencyKey` sin
implementar despues de W5**. Las ocho del contrato son `land/purchase`, `farms/:id/buildings`,
`buildings/:id`, las tres de `machines`, `market/sell` y `dev/grant`, y la unica que seguia siendo
andamiaje ademas de las mias, `POST /api/market/sell`, la implementa W5-C en esta misma fase. Derivar
la ruta de `stubRouteKeys()` por tanto no sirve aqui.

El parche minimo, verificado con salida real, conserva la intencion del caso provocando un 5xx
autentico en lugar de un 501: un `farmId` que pasa el esquema (`z.string().min(1).max(64)`) pero no es
un UUID hace que Prisma lance P2023, que `plugins/errors.ts` mapea a `INTERNAL_ERROR` y 500, y el
gancho `completeIdempotency` borra el registro por ser `statusCode >= 500`.

```diff
-    // A stub route that moves money answers 501, which is a server failure: the record must be
-    // removed so a retry once the module lands is not answered with a stale 501.
-    const stub = await harness.app.inject({
+    // A money moving route that fails inside the server: the record must be removed so a retry
+    // is not answered with a stale 5xx. `farmId` passes the schema and is not a UUID, which
+    // makes the identifier cast fail in PostgreSQL and reach the caller as INTERNAL_ERROR.
+    const failed = await harness.app.inject({
       method: 'POST',
       url: '/api/machines',
       headers: { ...bearer(player.accessToken), 'idempotency-key': key },
-      payload: { farmId: '00000000-0000-4000-8000-000000000000', type: 'TRACTOR' },
+      payload: { farmId: 'no-es-un-uuid', type: 'TRACTOR' },
     });
-    expect(stub.statusCode).toBe(501);
+    expect(failed.statusCode).toBe(500);
```

Comprobado antes de proponerlo, con el arnes real: la respuesta es 500 y
`requestIdempotency.count({ where: { playerId, key } })` devuelve 0.
