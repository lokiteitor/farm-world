# NOTES-w4b

Agente de granjas y edificios. Fase W4. Ambito escrito, exclusivamente:

- `backend/src/modules/farms/**`
- `backend/src/__tests__/farms/**`
- este fichero

No se ha escrito en ningun otro directorio. `backend/src/app.ts`, el registro de rutas, `shared/**`,
`backend/prisma/**` y el resto de ficheros congelados quedan intactos: sustituir el andamiaje consistio
en cambiar `defineStubRoute` por `defineRoute` dentro del propio modulo, conforme a la regla 3 de la
seccion 11 del plan.

---

## 1. Que se ha implementado

Las cuatro rutas del area `farms` del contrato, que estaban en andamiaje y respondian 501:

| Ruta | Secuenciada | Mueve dinero |
|---|---|---|
| `GET /api/farms` | No | No |
| `POST /api/farms` | Si | No |
| `POST /api/farms/:farmId/buildings` | Si | Si |
| `DELETE /api/buildings/:buildingId` | Si | Si |

Las tres rutas mutantes se ejecutan dentro de `withPlayerAdvanced`, que es lo unico que devuelve el
`seq` que la respuesta secuenciada debe llevar (ADR-0017 y punto 2 del cierre de W3).

Ficheros del modulo:

| Fichero | Contenido |
|---|---|
| `modules/farms/index.ts` | Las cuatro rutas y el orden de escritura de la construccion |
| `modules/farms/placement.ts` | Huella, validacion contra `shared/rules/selection.ts` y precio |
| `modules/farms/readModel.ts` | `FarmDto`, `BuildingDto` y la respuesta de `GET /api/farms` |
| `modules/farms/service.ts` | API interna de capacidades y existencias (apartado 2) |
| `modules/farms/constraints.ts` | Traduccion de las restricciones de la base a `ValidationCode` |

Pruebas en `backend/src/__tests__/farms/`: `buildings.int.test.ts` (10 pruebas),
`capacity.int.test.ts` (10 pruebas) y `terrain.ts`, que busca terreno real en el mundo de la ejecucion
en lugar de suponer coordenadas, porque el arnes asigna una semilla aleatoria por ejecucion.

---

## 2. Servicio interno de capacidades (lo que consumen W5 y W6)

Vive en `backend/src/modules/farms/service.ts`. Las zonas de ESLint ya admiten la importacion: la regla
de `eslint.config.js` distingue fases y `farms` pertenece a la fase anterior a `machinery`, `workers`,
`economy`, `tasks` y `forestry`. La importacion es
`import { ... } from '../farms/service.js';` desde cualquiera de esos cinco modulos.

Todas las funciones de lectura aceptan `Db` (cliente o transaccion); las de escritura exigen `Tx`.

### 2.1 Lectura de capacidades

```ts
interface FarmCapacities {
  farmId: FarmId;
  playerId: PlayerId;
  name: string;
  machineSlots: SlotUsage;   // { used, total }  GDD §96
  workerSlots: SlotUsage;    // { used, total }  GDD §108
  wheat: StorageUsage;       // litros           GDD §27, §83
  wood: StorageUsage;        // decimetros cubicos GDD §136
  hasWorkshop: boolean;      //                  GDD §29, §93
  buildingCount: number;
}

farmCapacities(db, playerId, farmId): Promise<FarmCapacities>        // lanza NOT_FOUND / NOT_OWNED
playerFarmCapacities(db, playerId): Promise<readonly FarmCapacities[]>
requireFarm(db, playerId, farmId): Promise<FarmRow>                  // lanza NOT_FOUND / NOT_OWNED
loadFarms(db, playerId): Promise<readonly FarmRow[]>
loadBuildings(db, farmIds): Promise<readonly BuildingRow[]>          // orden ascendente de id
capacitiesOf(farm, buildings): FarmCapacities                        // pura, para lotes
```

`StorageUsage` y `SlotUsage` son los tipos del contrato (`shared/api/schemas/farms.ts`), de modo que lo
que el servicio devuelve es lo que viaja en la respuesta sin conversion.

### 2.2 Capacidad contada: garaje y vivienda

```ts
buildingsWithFreeSlot(db, farmId, BuildingType.GARAGE | BuildingType.WORKER_HOME)
  : Promise<readonly BuildingSlot[]>            // { buildingId, farmId, type, used, total }

requireGarageSlot(db, farmId): Promise<BuildingSlot>   // lanza GARAGE_CAPACITY_EXCEEDED (409)
requireHomeSlot(db, farmId): Promise<BuildingSlot>     // lanza HOME_CAPACITY_EXCEEDED  (409)
hasWorkshop(db, farmId): Promise<boolean>
requireWorkshop(db, farmId): Promise<void>             // lanza WORKSHOP_REQUIRED (409)
```

Devuelven el edificio de identificador mas bajo con hueco, que es el paso 3 del orden canonico de
bloqueos de `lib/tx.ts`. W5-A escribe `Machine.garageId` con lo que devuelve `requireGarageSlot`;
W5-B escribe `Worker.homeId` con lo que devuelve `requireHomeSlot`. Ninguno de los dos debe incrementar
`machineCount` ni `workerCount`: los mantienen los disparadores `machines_garage_occupancy` y
`workers_home_occupancy` dentro de la misma transaccion, y el `CHECK` de la fila resuelve la carrera
real por la ultima plaza. La prueba `capacity.int.test.ts` lo comprueba insertando cuatro maquinas y
leyendo el contador.

### 2.3 Existencias fungibles

```ts
storageUsageOf(farm, resource): StorageUsage           // pura
freeStorageUnits(farm, resource): number               // pura
occupancyBp(stored, reserved, capacity): number        // pura, capacidad 0 -> 0

reserveStorage(tx, farmId, resource, units): Promise<{ ok, usage }>
releaseStorageReservation(tx, farmId, resource, units): Promise<StorageUsage>
depositStorage(tx, farmId, resource, units, { releaseReservedUnits? })
  : Promise<{ acceptedUnits, wastedUnits, usage }>
withdrawStorage(tx, farmId, resource, units): Promise<{ ok, usage }>

storageCapacityError(resource, usage, requiredUnits): ApiError
```

`resource` es `'WHEAT_LITERS' | 'WOOD_M3'`. Las unidades son siempre enteras y en la unidad almacenada
(ADR-0013): litros para el trigo, decimetros cubicos para la madera.

Las tres capas de la seccion 5.4 del plan, en el orden en que W6-A debe usarlas:

1. Al asignar la tarea de cosecha, `reserveStorage`. Si devuelve `ok: false`, rechazar con
   `storageCapacityError`, que produce `SILO_CAPACITY_EXCEEDED`, `WOOD_STORAGE_CAPACITY_EXCEEDED` o
   `STORAGE_REQUIRED` cuando la granja no tiene almacen del recurso.
2. Al completar, `depositStorage(..., { releaseReservedUnits: loQueSeReservo })`. Es un unico statement
   acotado: no puede violar `farms_stock_check` diga lo que diga el llamante, que es lo que impide que
   un trabajo de BullMQ entre en reintento indefinido. `wastedUnits` es el grano que no cupo y es lo que
   alimenta el asiento `HARVEST_WASTE` de GDD §83 y §97.
3. Al cancelar, `releaseStorageReservation`.

`withdrawStorage` es la retirada para una venta (W5-C): actualizacion condicional con recuento de filas,
`ok: false` significa `INSUFFICIENT_STOCK`.

### 2.4 Lo que este modulo NO hace y corresponde a otros

- No crea, mueve ni retira maquinas ni trabajadores. Solo informa de si caben y donde.
- No vende suelo. Retirar un edificio libera las celdas a `OWNED`; la venta de tierra es de `land`
  (W4-A) o de la liquidacion forzosa.
- No posee ningun manejador de evento agendado. `src/handlers.ts` no asigna ningun `ScheduledEventKind`
  a `farms`, de modo que el punto 6 del cierre de W3 y la metrica
  `farm_world_scheduled_events_unhandled_total` no le afectan: no hay `modules/farms/jobs.ts` que
  sustituir. Los cinco andamiajes pendientes siguen siendo los de `fields`, `machinery`, `workers`,
  `tasks` y `forestry`.

---

## 3. Pendiente

### 3.2 Sin pendientes sobre ficheros congelados

Este modulo no necesita ningun cambio en `shared/`, en `schema.prisma`, en `eslint.config.js`, en el
`Makefile` ni en ningun `package.json`. En concreto, el punto 2 del cierre de W3 (las zonas de ESLint
impedian que los modulos de W4 consumieran `modules/world/service.ts`) esta resuelto en el arbol actual:
`eslint.config.js` agrupa los modulos por fase y admite la importacion de los de fases anteriores.
`npx eslint backend/src/modules/farms` devuelve 0 con las cuatro importaciones de `../world/service.js`
en su sitio. Conviene que el agente de cierre lo mueva a "Resuelto" en `NOTES-w3-cierre.md`.

---

## 4. Decisiones para el ADR

Las redacta el agente de cierre de la fase (W4-A escribe 0023-0026, `docs/ownership.md` apartado 3.3).
Este agente no escribe en `docs/adr.md`.

### 4.1 El precio transaccional de un edificio y la propiedad parcial de la huella

Contexto: GDD §116 define `realBuildingCost = purchasePrice + footprint x cellPrice` y GDD §117 compra
las 330 celdas una vez y despues paga solo las estructuras. La seccion 2.2 del plan y ADR-0011 ya
resolvieron la contradiccion con el parametro `landAlreadyOwned` de `shared/rules/pricing.ts`.

Lo que la implementacion obligo a decidir es el caso que ninguno de los dos documentos contempla: una
huella parcialmente poseida, por ejemplo cuarenta y ocho celdas de las que treinta ya son del jugador.
`realBuildingCost` solo admite un booleano y cobraria la huella entera. La decision: el importe del
suelo se calcula con `landPurchasePrice` sobre las celdas que la peticion adquiere realmente, que es la
misma regla de GDD §115 que `realBuildingCost` usa por dentro; `realBuildingCost` se sigue invocando con
`landAlreadyOwned` explicito, porque es donde la resolucion de §116 frente a §117 queda visible en el
codigo, y aporta `plannedCostWithLand` para el panel de planificacion. En los dos extremos las dos
cifras coinciden exactamente.

Consecuencia: la respuesta desglosa `buildingPaid`, `landPaid` y `totalPaid`, y se escriben dos asientos,
`BUILDING_PURCHASE` y `LAND_PURCHASE`, no uno. Es lo que exige el modelo (`Building.purchasePrice`
excluye el suelo) y lo que permite que el resumen de regreso de GDD §124 agregue por concepto sin que
un edificio parezca tierra.

### 4.2 La proyeccion posterior a la compra como forma de reutilizar la regla compartida

Contexto: `canBuildOn` de `shared/rules/selection.ts` exige que la celda sea del jugador. Un jugador
nuevo no posee nada, de modo que aplicada literalmente ninguna primera granja seria construible, y la
alternativa evidente (escribir una segunda regla "construible o comprable") duplicaria en el servidor
la regla que el cliente pinta en verde, que es justo lo que la seccion 8 del plan prohibe.

Decision: `projectAfterPurchase` proyecta la huella al estado que tendria una vez ejecutada la compra
—solo propiedad y uso— y la regla compartida decide sobre esa proyeccion. No es una segunda regla: el
terreno efectivo y la presencia de arbol se dejan intactos, de modo que `canBuildOn` sigue siendo quien
rechaza. Despues se valida el subconjunto que hay que comprar con `validateSelection(PURCHASE)`.

Orden deliberado: primero la regla de edificio y despues la de compra. Una celda de agua es a la vez
incomprable e inconstruible, y `TERRAIN_NOT_BUILDABLE` es la respuesta que dice al panel de colocacion
que se mueva, mientras que `TERRAIN_NOT_PURCHASABLE` lo mandaria a la herramienta de tierra por una
celda que ninguna compra arreglaria.

Segunda traduccion, tambien una decision: `CELL_IN_USE` procedente de una seleccion de edificio se
reporta como `BUILDING_FOOTPRINT_OVERLAPS`, que es el codigo que el contrato reserva para esa situacion
exacta (exclusividad de GDD §15). Los codigos por celda restantes conservan su nombre, porque "no es tu
celda" y "hay un edificio ahi" llevan al jugador a acciones distintas.

### 4.3 Reparto entre la aplicacion y las restricciones de la base para las capacidades de granja

Contexto: ADR-0018 fija que la restriccion declarativa es la red de seguridad y nunca el mecanismo. Este
modulo es el primero que tiene que aplicarlo sobre contadores mantenidos por disparador
(`machineCount`, `workerCount`) y sobre una capacidad recalculada por disparador
(`capacityWheatLiters`, `capacityWoodDm3`).

Decision, en tres partes:

1. El modulo no duplica ningun contador ni ninguna capacidad: los lee. Construir un edificio de
   almacenamiento no escribe la capacidad de la granja; la escribe el disparador
   `buildings_farm_storage_capacity` y el modulo relee la fila para componer la respuesta.
2. Todo rechazo previsible se responde antes del statement, con sus cifras: garaje lleno, vivienda
   llena, taller ausente, edificio no vacio, y en la demolicion de un almacen la comprobacion de que
   retirar su capacidad no deja las existencias por encima de lo que queda. La migracion inicial ya
   anticipaba este ultimo caso y lo nombraba `BUILDING_NOT_EMPTY`.
3. Lo que queda es la carrera real, y para ella existe `constraints.ts`, que reconoce
   `buildings_capacity_check`, `farms_stock_check` y `world_cells_use_exclusivity_check` por su nombre
   en el texto del error y devuelve el codigo del contrato. Se reconoce por el nombre y no por la clase
   de error de Prisma porque las zonas de ESLint impiden que un modulo de dominio alcance el cliente
   generado, restriccion que se considera correcta. Lo que no reconoce se relanza intacto, de modo que
   una restriccion inesperada sigue siendo un 500 con su traza.

Consecuencia asumida: cuando la traduccion se dispara, la transaccion ya esta abortada y no se puede
leer para informar de la ocupacion, de modo que el error lleva el codigo y el identificador pero no las
cifras. Las cifras las lleva siempre el rechazo anticipado, que es el camino normal.

### 4.4 La granja como unidad contable y el edificio como unidad fisica

Contexto: GDD §23 declara la granja una entidad fisica que ocupa celdas reales, y el modelo de datos no
le da geometria alguna.

Decision, que ya estaba implicita en `schema.prisma` y que esta implementacion hace explicita: lo que
ocupa celdas son los edificios (GDD §25 a §29), y la granja es la unidad que agrupa. De ahi que
`POST /api/farms` no cueste nada, no ocupe nada y no exija clave de idempotencia, y que toda la
consecuencia fisica y economica recaiga en `POST /api/farms/:farmId/buildings`. La afirmacion de §23 se
sostiene igualmente: la prueba comprueba que un garaje son cuarenta y ocho celdas reales que dejan de
ser aptas para campo.

Simetria de la retirada: el borrado de un edificio es logico (`disposedGameMs`), porque el asiento que
lo pago apunta a su identificador sin clave ajena (ADR-0009), mientras que las celdas si vuelven de
verdad a `OWNED` con `buildingId` nulo. El valor de reventa sale de `buildingResaleValue` de
`shared/rules/pricing.ts` tanto en el modelo de lectura como en el reembolso, de modo que la cifra que
el panel muestra y la que el servidor abona no pueden diferir.

---

## 5. Discrepancias detectadas

1. `shared/rules/pricing.ts`, `realBuildingCost`: el parametro `landAlreadyOwned` es booleano y no
   admite una huella parcialmente poseida, caso que el GDD no contempla y que el juego si produce en
   cuanto un jugador amplia su granja sobre suelo que ya tenia. Resuelto en `placement.ts` sin tocar la
   regla compartida (apartado 4.1). Si algun dia se toca `shared/`, la firma natural seria recibir el
   numero de celdas a comprar en lugar del booleano.

2. `shared/api/errors.ts`, `capacityExceeded(code, occupancy, capacity, entityId?)`: exige las dos
   cifras. En el camino de traduccion de una violacion de restriccion no son legibles, porque la
   transaccion ya esta abortada, y se pasan como cero. No es un fallo del contrato, es una
   consecuencia de que ese camino sea excepcional; conviene saberlo antes de que un panel las muestre
   sin comprobar.

3. `backend/prisma/schema.prisma`, `Farm.disposedGameMs`: la columna existe y ninguna ruta del contrato
   dispone de una granja. El modulo filtra por `disposedGameMs: null` en todas sus lecturas, de modo
   que el dia que exista la ruta el servicio de capacidades ya se comporta bien. No hace falta ningun
   cambio.

4. `shared/api/schemas/farms.ts`, `buildingDtoSchema.capacity`: se documenta como "capacidad en la
   unidad que su tipo implica" y el taller no tiene ninguna, de modo que informa cero. Se ha resuelto
   leyendo `capacityKind` del catalogo compartido en lugar de un `switch` por tipo, para que anadir un
   edificio a `shared/config/buildings.ts` no obligue a tocar el modelo de lectura.

5. `docs/ownership.md` apartado 3.5 cubre `backend/src/__tests__/<modulo>/` de forma generica, de modo
   que `backend/src/__tests__/farms/` no necesita fila propia. Se anota porque el agente de cierre
   cuadra la tabla con el arbol real: la fase anade tres ficheros ahi
   (`buildings.int.test.ts`, `capacity.int.test.ts` y `terrain.ts`, que es un auxiliar y no una suite).

6. `backend/src/__tests__/harness.ts`, `createFarmFixture`: crea edificios con huellas de 2 x 2 que no
   corresponden a ninguna entrada del catalogo (el garaje es 6 x 8 y la vivienda 4 x 4) y con celdas de
   origen que no existen como filas. Es legitimo, porque ese fixture existe para las pruebas de devengo
   y no para las de geometria, pero conviene no tomarlo como ejemplo de como se construye un edificio.
   Las pruebas de este modulo pasan siempre por la ruta real.

---

## 6. Verificacion

Ordenes ejecutadas desde la raiz del repositorio, con PostgreSQL en 55432 y Redis en 56379.

| Orden | Resultado |
|---|---|
| `make sync-types` | exit 0. 53 ficheros a `backend/src/shared` y 53 a `frontend/app/shared` |
| `npx tsc --noEmit` (en `backend/`) | exit 0, sin salida |
| `make typecheck` | exit 0. `shared`, `backend` y `vue-tsc` del cliente en verde |
| `make lint` | exit 0. `eslint .` sin hallazgos y Prettier conforme |
| `make test-unit` | exit 0. shared 23 ficheros y 418 pruebas; cliente 9 ficheros y 93 pruebas |
| `npx vitest run --config vitest.int.config.ts src/__tests__/farms` | exit 0. 2 ficheros y 20 pruebas |
| `make test-int` | exit 2. 15 ficheros y 162 pruebas: 158 en verde y 4 en rojo, las del apartado 3.1 |

Comprobacion por HTTP real contra `npx tsx src/server.ts` en el puerto 3211, con el mundo de desarrollo:

```text
register             200
world/info           200 spawn 617 105
GET /api/farms       200 {"farms":[],"buildings":[]}
POST /api/farms      200 seq 1
POST buildings       200 origen 617 105
  seq                6
  footprintCells     48
  landPurchasedCells 48
  buildingPaid       8000.0000
  landPaid           5760.0000
  totalPaid          13760.0000
  balanceAfter       146240.0000
  farm.machineSlots  {"used":0,"total":4}
solape               409 BUILDING_FOOTPRINT_OVERLAPS
sin suelo propio     409 CELL_NOT_OWNED
GET /api/farms       200 granjas 1 edificios 1 reventa 4800.0000
DELETE building      200 refund 4800.0000
  releasedCells      48
  balanceAfter       151040.0000
DELETE otra vez      404 NOT_FOUND
```

Las cifras cuadran con el catalogo sin literales: garaje 8.000 (GDD §116), suelo 48 x 120 = 5.760
(GDD §115), capital inicial 160.000 (GDD §117) menos 13.760 son 146.240, y la reventa al 60 %
(`RESALE_FACTOR_BP`) son 4.800, que devueltos dejan 151.040. Las dos partidas de prueba creadas en la
base de desarrollo se han borrado despues (celdas, edificio, granja y jugador), de modo que el mundo de
desarrollo queda como estaba.

No ejecutado, conforme al brief: `git`, `npm install`, `prisma generate`, `prisma migrate`,
`docker compose` y construcciones de produccion. `make sync-types`, `make typecheck`, `make lint`,
`make test-unit` y `make test-int` regeneran `backend/src/shared`, `frontend/app/shared` y
`frontend/.nuxt`, las tres ignoradas por git y no editables a mano.

## Resuelto

Las notas aplicadas se conservan aqui con su numeracion original, porque otros documentos y
varios comentarios de codigo las citan por numero.

### 3.1 `app.int.test.ts` afirma 501 para dos rutas ya implementadas

Resuelto por ADR-0038: la lista se deriva de `stubRouteKeys()`.

El texto original de la nota:

Categoria: cambio en fichero de otro agente
Ficheros afectados: `backend/src/__tests__/app.int.test.ts`
Propietario del cambio: W3-A (cerrado), a aplicar por el agente de cierre de W4 o por W7-A
Motivo: la constante `IMPLEMENTED` enumera las quince rutas que W3 implemento, y la prueba generada
afirma 501 para todas las demas. Al implementar el area `farms`, dos de sus cuatro rutas fallan. Las
otras dos no fallan solo porque la prueba envia un cuerpo vacio que no satisface el esquema y entra por
la rama de 400 que ella misma admite.

Salida real (`make test-int`, con el modulo de campos de W4-C tambien presente):

```text
FAIL  src/__tests__/app.int.test.ts > las rutas todavia no implementadas >
      GET /api/farms responde 501 con NOT_IMPLEMENTED          AssertionError: expected 200 to be 501
FAIL  src/__tests__/app.int.test.ts > las rutas todavia no implementadas >
      DELETE /api/buildings/:buildingId responde 501 ...        AssertionError: expected 200 to be 501
FAIL  src/__tests__/app.int.test.ts > las rutas todavia no implementadas >
      GET /api/fields responde 501 con NOT_IMPLEMENTED          AssertionError: expected 200 to be 501
FAIL  src/__tests__/app.int.test.ts > las rutas todavia no implementadas >
      GET /api/fields/:fieldId responde 501 ...                 AssertionError: expected 404 to be 501
Test Files  1 failed | 14 passed (15)
Tests  4 failed | 158 passed (162)
```

Cambio a aplicar por la parte que corresponde a este agente: anadir a `IMPLEMENTED` las cuatro claves

```text
'GET /api/farms',
'POST /api/farms',
'POST /api/farms/:farmId/buildings',
'DELETE /api/buildings/:buildingId',
```

y restar cuatro a la afirmacion `expect(stubs.length).toBe(40)`, junto con el comentario que la
acompana. Las rutas de `land` y de `fields` anaden las suyas y descuentan las suyas; el numero final lo
fija quien aplique las tres notas a la vez.

Mitigacion adoptada: ninguna posible sin escribir fuera del ambito. Se ha optado deliberadamente por no
tocar el fichero: los tres agentes de W4 tendrian que editar la misma constante a la vez y el ultimo en
escribir borraria a los otros dos, que es exactamente el trabajo perdido que la regla 1 evita. El fallo
es visible, explicito y no oculta ningun defecto del servicio: las veinte pruebas de
`backend/src/__tests__/farms/` estan en verde y las 158 restantes de la suite tambien.
