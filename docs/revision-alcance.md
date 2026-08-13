# Revision adversarial de reglas de juego y alcance

Agente: W7-D. Fecha: 2026-08-13. Fase: W7, revision.

Este documento recoge dos trabajos independientes. El apartado 2 es un intento deliberado de refutar
que el servidor sea la unica fuente de verdad (GDD §54): cada regla dura se ataco por HTTP contra la
pila real, y se registra la peticion enviada, la respuesta obtenida y si el estado quedo intacto. El
apartado 3 confronta el arbol implementado con las cinco listas de «que entra en el MVP» del GDD
(§86, §99, §112, §126, §141), con el MVP de §69 y con el roadmap de §71. El apartado 4 ordena los
hallazgos por gravedad y separa lo confirmado por ejecucion de lo sospechado.

---

## 1. Metodo y entorno de la validacion

Se levantaron dos procesos de backend sobre la base de datos y el Redis de desarrollo, ambos apagados
al terminar:

| Proceso | Puerto | Bandera | Proposito |
|---|---|---|---|
| `backend/src/server.ts` | 3210 | `DEV_ENDPOINTS=true` | Superficie completa, incluidas las rutas de desarrollo |
| `backend/src/server.ts` | 3211 | `DEV_ENDPOINTS=false` | Comprobar la guarda de desarrollo con la bandera apagada |

No se ejecuto en ningun momento el proceso `worker.ts`. La decision es deliberada: la seccion 6.3 del
plan afirma que BullMQ es un requisito de puntualidad y no de correccion, y que la primera peticion de
un jugador repara su mundo. Durante toda la sesion se observaron las transiciones automaticas de fase
de cultivo (§76), la finalizacion de tareas (§105), el fin de una reparacion y el refresco del pool de
contratacion (§102) sin ningun consumidor de cola en ejecucion. La afirmacion queda verificada.

Se registraron dos jugadores nuevos, `w7d-audit@farm-world.local` y `w7d-other@farm-world.local`. El
segundo existe unicamente para atacar los recursos del primero desde una sesion legitima ajena, que es
la unica forma de comprobar la propiedad sin falsificar tokens.

Se uso `POST /api/dev/grant` para dotar de caja al jugador de auditoria y `POST /api/dev/retime` para
llevar el multiplicador a 36.000 durante los ciclos largos. Sin lo segundo, el ciclo de 96 horas de
juego de §82 tarda ocho horas reales con el multiplicador 12 del entorno de desarrollo.

Estado que queda en la base de datos de desarrollo: dos jugadores adicionales, dos granjas con seis
edificios, ocho maquinas, cuatro trabajadores, dos campos, dos parcelas forestales y unos 1.700
asientos de ledger. Conviene ejecutar `make reset` antes de cualquier medida de balance sobre esa base.

---

## 2. Validacion autoritativa: intentos de saltarse las reglas por HTTP

### 2.1 Tabla de compatibilidad de operacion y maquinaria (§90)

Se recorrieron las 120 combinaciones de las cuatro operaciones agricolas contra las seis maquinas del
catalogo agricola, en los dos papeles (`poweredMachineId` e `implementMachineId`). Las cuatro
combinaciones que §90 declara validas se excluyeron del barrido.

Resultado agregado: 116 combinaciones invalidas rechazadas con el codigo correcto y sin mutacion; 4
combinaciones invalidas aceptadas. Las cuatro aceptadas son la misma: intercambiar los dos papeles.

| Combinacion | Respuesta | Estado |
|---|---|---|
| `PLOW` propulsada TRACTOR, implemento CULTIVATOR / SEEDER / HARVESTER / TRAILER | 400 `IMPLEMENT_REQUIRED` | Intacto |
| `PLOW` propulsada HARVESTER / CULTIVATOR / SEEDER / TRAILER | 400 `POWERED_MACHINE_REQUIRED` | Intacto |
| `HARVEST` propulsada TRACTOR, implemento PLOW | 400 `POWERED_MACHINE_REQUIRED` | Intacto |
| `FELL` propulsada TRACTOR o FORWARDER | 400 `POWERED_MACHINE_REQUIRED` | Intacto |
| `FELL` sin autocargador en la flota | 409 `FORWARDER_REQUIRED` | Intacto |
| `PLOW` propulsada PLOW, implemento TRACTOR | 200, tarea creada | Modificado |
| `CULTIVATE` propulsada CULTIVATOR, implemento TRACTOR | 200, tarea creada | Modificado |
| `SEED` propulsada SEEDER, implemento TRACTOR | 200, tarea creada | Modificado |
| `HARVEST` propulsada TRAILER, implemento HARVESTER | Supera §90; se detiene en la comprobacion 2 por condicion de maquina | — |

Peticion y respuesta literales del caso limpio:

```text
POST /api/tasks
{"operation":"CULTIVATE",
 "workerId":"019ffc65-7bc4-73cd-8d71-a9e45b9c42a9",
 "poweredMachineId":"019ffc64-d8bc-7649-80b3-f552fbddd8de",   <- cultivador (implemento)
 "implementMachineId":"019ffc64-d88e-740d-97cb-500d028aae1f", <- tractor (propulsada)
 "targetFieldId":"019ffc65-b8ae-7139-a47e-4c1372fd7618"}

200 {"seq":566,"result":{"task":{"id":"019ffc78-c699-71de-9055-b0decf15e0a1",
     "machineIds":["019ffc64-d88e-...","019ffc64-d8bc-..."],
     "operation":"CULTIVATE","status":"IN_PROGRESS","effectiveWorkSpeedMilli":4259}}}
```

La misma peticion con los papeles en su sitio devuelve `effectiveWorkSpeedMilli` 4259, identico. Ver
el hallazgo H1 del apartado 4 para la causa y la correccion propuesta.

### 2.2 Secuencia de seis comprobaciones de §104

Se ataco cada comprobacion por separado y despues se combinaron violaciones para observar cual gana.
La columna «Estado» compara la instantanea completa de maquinas, trabajadores, tareas, campos,
edificios y almacenes antes y despues de cada intento.

| Intento | Respuesta | Estado |
|---|---|---|
| 1. Trabajador inexistente | 404 `NOT_FOUND` | Intacto |
| 1. Trabajador de otro jugador (atacante = jugador 2) | 403 `NOT_OWNED` | Intacto |
| 1. Trabajador ocupado en otra tarea | 409 `WORKER_NOT_IDLE` | Intacto |
| 2. Maquina propulsada inexistente | 404 `NOT_FOUND` | Intacto |
| 2. Implemento inexistente | 404 `NOT_FOUND` | Intacto |
| 2. Maquina en reparacion (`IN_REPAIR`) | 409 `MACHINE_NOT_IDLE` | Intacto |
| 2. Maquina por debajo del minimo de condicion | 409 `MACHINE_CONDITION_TOO_LOW` | Intacto |
| 3. Tabla de §90 | ver 2.1 | ver 2.1 |
| 5. Campo inexistente | 404 `NOT_FOUND` | Intacto |
| 5. Campo de otro jugador | 403 `NOT_OWNED` | Intacto |
| 5. `CULTIVATE` sobre campo `VIRGIN` | 409 `FIELD_STATE_NOT_ALLOWED` | Intacto |
| 5. `SEED` sobre campo `VIRGIN` | 409 `FIELD_STATE_NOT_ALLOWED` | Intacto |
| 5. `HARVEST` sobre campo `VIRGIN` | 409 `FIELD_STATE_NOT_ALLOWED` | Intacto |
| 6. `SEED` sin `cropId` | 400 `VALIDATION_FAILED` | Intacto |
| 6. `SEED` con cultivo fuera del catalogo | 400 `VALIDATION_FAILED` | Intacto |
| 6. `PLOW` con `cropId` | 400 `VALIDATION_FAILED` | Intacto |

Orden observado con varias violaciones simultaneas:

| Intento | Respuesta | Comprobacion que gana |
|---|---|---|
| Trabajador inexistente + maquina incompatible + estado de campo invalido | 404 `NOT_FOUND` | 1 antes que 3 y que 5 |
| Trabajador ocioso + maquina incompatible + estado de campo invalido | 400 `POWERED_MACHINE_REQUIRED` | 3 antes que 5 |
| Estado de campo invalido + granja de destino ajena | 409 `FIELD_STATE_NOT_ALLOWED` | 5 antes que la validacion del destino |

El orden de §104 se respeta. No se observo ninguna ejecucion parcial: en los diecisiete rechazos la
instantanea previa y la posterior son identicas byte a byte.

Comprobacion 4 no cubierta: la disponibilidad del implemento como refusal independiente no se pudo
provocar con un unico tractor en la flota, porque la maquina propulsada agota antes la comprobacion 2.
No es un hallazgo; es cobertura que falta y que corresponde a la prueba de integracion.

### 2.3 Restricciones duras

| Restriccion | Intento | Respuesta | Estado |
|---|---|---|---|
| Garaje §96 | Comprar la quinta maquina en un garaje de cuatro plazas | 409 `GARAGE_CAPACITY_EXCEEDED` `{occupancy:4, capacity:4}` | Intacto |
| Vivienda §108 | Contratar al quinto trabajador con una vivienda de cuatro plazas | 409 `HOME_CAPACITY_EXCEEDED` `{occupancy:4, capacity:4}` | Intacto, el candidato sigue en el pool |
| Vivienda §108 | Contratar en una granja sin vivienda | 409 `HOME_CAPACITY_EXCEEDED` `{occupancy:0, capacity:0}` | Intacto |
| Vivienda §108 | Contratar en la granja de otro jugador | 403 `NOT_OWNED` | Intacto |
| Silo §83 | Cosechar 54.000 L con 46.000 L libres | 200; reserva 46.000, `overflowUnits` 8.000 | Ver nota |
| Silo §83 | Vender con el silo vacio | 409 `INSUFFICIENT_STOCK` `{requiredUnits:1000, availableUnits:0}` | Intacto |
| Uso exclusivo §15 | Campo sobre la huella del garaje | 409 `CELL_IN_USE` | Intacto |
| Uso exclusivo §15 | Campo sobre las celdas de otro campo | 409 `CELL_IN_USE` | Intacto |
| Uso exclusivo §15 | Edificio sobre las celdas de un campo | 409 `BUILDING_FOOTPRINT_OVERLAPS` | Intacto |
| Uso exclusivo §15 | Edificio solapando otro edificio | 409 `BUILDING_FOOTPRINT_OVERLAPS` | Intacto |
| Uso exclusivo §15 | Parcela forestal sobre las celdas de un campo | 409 `TERRAIN_NOT_FORESTABLE` | Intacto |
| Contiguidad §17 | Dos bloques disjuntos | 400 `SELECTION_NOT_CONTIGUOUS` | Intacto |
| Contiguidad §17 | Contacto solo en diagonal | 400 `SELECTION_NOT_CONTIGUOUS` | Intacto |
| Contiguidad §17 | Seleccion vacia | 400 `VALIDATION_FAILED` | Intacto |
| Contiguidad §17 | Seleccion de 2.116 celdas, por encima del tope de 2.000 | 400 `VALIDATION_FAILED` | Intacto |
| Adyacencia §20 | Ampliar un campo con un bloque no adyacente | 400 `SELECTION_NOT_ADJACENT` | Intacto |
| Fusion §22 | Fusionar dos campos que no se tocan | 409 `FIELD_MERGE_INCOMPATIBLE` | Intacto |
| Propiedad §14 | Campo sobre celdas sin propietario | 409 `CELL_NOT_OWNED` | Intacto |
| Propiedad §14 | Campo sobre celdas del jugador 2 | 409 `CELL_NOT_OWNED` | Intacto |
| Propiedad §14 | Edificio sobre celdas sin propietario | 409 `CELL_NOT_OWNED` | Intacto |
| Propiedad §14 | Comprar celdas ya compradas por el jugador 1, desde el jugador 2 | 409 `CELL_ALREADY_OWNED` | Intacto |
| Propiedad §14 | Leer, ampliar o dividir el campo del jugador 1 desde el jugador 2 | 403 `NOT_OWNED` | Intacto |

Nota sobre §83. La cosecha que desborda no se rechaza: se acepta con aviso, se reserva la capacidad
disponible y al completar se llena el silo hasta el tope y se desperdicia el resto. El silo termino en
`storedUnits` 100.000 sobre `capacityUnits` 100.000, con este asiento:

```text
{"seq":1711,"type":"HARVEST_WASTE","amount":"0.0000","refType":"TASK",
 "meta":{"resource":"WHEAT_LITERS","gddSection":83,
         "wastedUnits":8000,"acceptedUnits":46000,"producedUnits":54000}}
```

Es el comportamiento que ADR-0052 elige de forma explicita y que la resolucion 9 del apartado 2 de las
erratas fija. La restriccion dura, que la capacidad no se supere nunca, se cumple. Queda una
inconsistencia de redaccion con la seccion 5.4 del plan, recogida como O5.

### 2.4 Cancelacion (§106) y despido (§109)

| Intento | Respuesta | Efecto |
|---|---|---|
| Cancelar una tarea inexistente | 404 `NOT_FOUND` | Intacto |
| Cancelar la tarea de otro jugador | 403 `NOT_OWNED` | Intacto |
| Cancelar la propia tarea en curso | 200 | Campo `VIRGIN` antes y `VIRGIN` despues; trabajador y ambas maquinas a `IDLE` |
| Cancelar dos veces la misma tarea | 409 `TASK_ALREADY_FINISHED` | Intacto |
| Cancelar una tala en curso | 200 | 34 arboles en pie antes y 34 despues; `reservedUnits` del almacen de madera 77.300 durante la tala y 0 despues |
| Despedir a un trabajador inexistente | 404 `NOT_FOUND` | Intacto |
| Despedir al trabajador de otro jugador | 403 `NOT_OWNED` | Intacto |
| Despedir a un trabajador en plena tarea | 409 `WORKER_NOT_IDLE` | Intacto; la tarea sigue `IN_PROGRESS` |
| Despedir a un trabajador ocioso | 200 | Plazas de vivienda 3/4 a 2/4 |

El modelo todo-o-nada de §106 se cumple: el progreso parcial (`progressBp` 9 en uno de los casos) se
pierde y el campo no avanza de estado. La cancelacion de una tala devuelve los arboles marcados a
`STANDING` y libera la reserva de almacen exactamente una vez, que es el doble descuento que la
integracion previa senalaba como riesgo.

### 2.5 El cliente no fija su dinero, su tiempo ni el estado de un campo

| Intento | Respuesta |
|---|---|
| `POST /api/farms` con un campo `balance` adicional | 400 `VALIDATION_FAILED` |
| `POST /api/dev/grant` con un campo `balanceAfter` adicional | 400 `VALIDATION_FAILED` |
| `POST /api/land/purchase` con `expectedTotal` de 1,00 frente a 120,00 | 400 `VALIDATION_FAILED`, sin cargo |
| `POST /api/machines` con `expectedTotal` de 1,00 frente a 18.000,00 | 400 `VALIDATION_FAILED`, sin cargo |
| `POST /api/market/sell` con cantidad negativa o cero | 400 `VALIDATION_FAILED` |
| `POST /api/market/sell` sobre la granja de otro jugador | 403 `NOT_OWNED` |
| `POST /api/tasks` con `scheduledEndGameMs` propio | 400 `VALIDATION_FAILED` |
| `POST /api/tasks` con `startGameMs` y `durationGameHours` propios | 400 `VALIDATION_FAILED` |
| `POST /api/fields` con `cropCycleState: READY_TO_HARVEST` | 400 `VALIDATION_FAILED` |
| `POST /api/fields` con `fertilityBp` y `cropId` | 400 `VALIDATION_FAILED` |
| `PUT` y `PATCH` sobre `/api/fields/:id` | 404 `NOT_FOUND`, no existen |
| `POST /api/dev/*` con la bandera de desarrollo apagada, autenticado o no | 403 `DEV_ENDPOINT_DISABLED`, sin efecto |

Todos los esquemas del contrato son `z.strictObject`, de modo que cualquier campo no declarado produce
`VALIDATION_FAILED` con `details.field: unrecognized_keys`. No existe ninguna ruta que acepte del
cliente un instante de juego, un importe resultante o un estado de campo.

Idempotencia:

| Intento | Respuesta |
|---|---|
| `POST /api/dev/grant` dos veces con la misma clave y el mismo cuerpo | 200 las dos; saldo +100 una sola vez; respuestas identicas byte a byte |
| Misma clave con cuerpo distinto | 409 `IDEMPOTENCY_KEY_REUSED` |
| La misma clave usada por dos jugadores distintos | 200 las dos, operaciones independientes |
| `POST /api/land/purchase` sin cabecera `Idempotency-Key` | 400 `IDEMPOTENCY_KEY_REQUIRED` |

Autenticacion:

| Intento | Respuesta |
|---|---|
| Peticion sin token | 401 `AUTH_REQUIRED` |
| Token con formato invalido | 401 `AUTH_REQUIRED` |
| Token con la firma manipulada | 401 `AUTH_REQUIRED` |
| Token caducado | 401 `AUTH_TOKEN_EXPIRED` |
| Contrasena incorrecta | 401 `AUTH_INVALID_CREDENTIALS` |
| Registro de un correo ya existente | 409 `EMAIL_ALREADY_REGISTERED` |
| Rafaga de 600 peticiones en una ventana de 60 s | 429 `RATE_LIMITED` |

### 2.6 Auto-auditoria del ledger

Se pagino el ledger completo del jugador de auditoria: 1.677 asientos.

```text
seq estrictamente creciente y sin huecos desde 1 hasta 1677 : si
filas cuyo balanceAfter no coincide con la suma acumulada   : 0
saldo liquidado y saldo proyectado                          : coinciden
```

El reparto por tipo de asiento (676 `MACHINE_MAINTENANCE`, 668 `WORKER_WAGES`, 296
`MACHINE_OPERATING`) confirma que los tres niveles de coste de §114 se devengan por separado y que el
coste de operacion solo aparece mientras hay tarea.

### 2.7 Recorrido funcional completo

Ejecutado de extremo a extremo por HTTP, sin worker de simulacion:

- Agricola: `VIRGIN` a `PLOWED` a `CULTIVATED` a `SEEDED` a `GERMINATING` a `GROWING` a
  `READY_TO_HARVEST` a `HARVESTED` a `VIRGIN`. Fertilidad 100 % a 85 % tras la cosecha (§77), malezas
  reiniciadas por `CULTIVATE` (§78), rendimiento 6.152 L sobre 112 celdas.
- Reparacion: `POST /api/machines/:id/repair` con coste 5.400,00, duracion 25 horas de juego y estado
  `IN_REPAIR` activo durante la ventana.
- Silvicultura: compra de bosque, parcela poblada con 28 arboles y su histograma de cuatro fases, tala
  por lote de 67.900 dm3, almacen de madera separado del silo, venta a 45,00 el metro cubico y
  cancelacion de una tala con restitucion de los arboles.
- Geometria: division de un campo de 112 celdas en dos de 56 y fusion posterior a 112.

---

## 3. Alcance frente al MVP

Leyenda de la columna «Estado real»: Implementado, No implementado, Reservado (el valor existe en el
enum o en el esquema y ninguna ruta lo escribe).

### 3.1 §86 Sistema agricola

| Punto | GDD | Estado real | Evidencia |
|---|---|---|---|
| `CropCycleState` completo, ocho estados | Incluido | Implementado | `shared/domain/enums.ts:62-73`; recorrido completo observado en 2.7 |
| Fertilidad con decaimiento por cosecha | Incluido | Implementado | `shared/rules/yield.ts`; `fertilityBp` 10000 a 8500 tras cosechar |
| Malezas con crecimiento por tiempo | Incluido | Implementado | `weedLevelBp` 0, 4680 y 10000 en lecturas sucesivas de `GET /api/fields/:id` |
| `GrowthProgress` basado en eventos | Incluido | Implementado | `projection.growthProgressBp`; evento `FIELD_ADVANCE_PHASE` |
| Formula de rendimiento con fertilidad y malezas | Incluido | Implementado | `shared/rules/yield.ts:111-144`; 1.200 x 90 x 1,00 x 0,611 = 54.000 observado |
| Un solo cultivo, trigo | Incluido | Implementado | `CropId` solo `WHEAT`; `cropId: BARLEY` rechazado con 400 |
| Fertilizacion activa | Excluido | No implementado, modelado | `FERTILIZATION_TO_YIELD_CURVE = [[0,1.0],[100,1.0]]`; `fertilizationBp` siempre 0 |
| `SoilCondition` a `COMPACTED` | Excluido | Reservado | `shared/domain/enums.ts:83`; ninguna escritura en el backend |
| Estacion y clima | Excluido | No implementado | Unica mencion en `shared/config/time.ts:55`, como comentario |
| Riego y humedad | Excluido | No implementado | `moisture` aparece solo como campo de ruido del generador de terreno |

### 3.2 §99 Sistema de maquinaria

| Punto | GDD | Estado real | Evidencia |
|---|---|---|---|
| Catalogo de seis maquinas | Incluido | Implementado | `MACHINE_CATALOGUE`; `GET /api/machines/catalog` |
| Tabla de compatibilidad operacion y maquinaria | Incluido | Implementado con defecto | Hallazgo H1; `shared/rules/machinery.ts:184-240` |
| Duracion via `workSpeed`, condicion y habilidad | Incluido | Implementado | `shared/rules/duration.ts:75-191`; `effectiveWorkSpeedMilli` 4259 |
| Desgaste por hora trabajada | Incluido | Implementado | `conditionAfterWork`; tractor de 10000 a 0 pb tras unas 700 horas |
| `maintenanceCost` frente a `operatingCost` | Incluido | Implementado | 676 asientos `MACHINE_MAINTENANCE` y 296 `MACHINE_OPERATING` |
| Reparacion en taller | Incluido | Implementado | `POST /api/machines/:id/repair`; `WORKSHOP_REQUIRED` en `modules/farms/service.ts:442` |
| Limite de garaje bloqueando compras | Incluido | Implementado | 409 `GARAGE_CAPACITY_EXCEEDED` con ocupacion y capacidad |
| Fallos aleatorios, `BROKEN` | Excluido | Reservado | `modules/machinery/service.ts:38`; el estado nunca se escribe |
| Llenado incremental del remolque | Excluido | No implementado | No existe `currentLoad` en el arbol |
| `requiredPower` o caballos como restriccion | Excluido | No implementado | Sin coincidencias en `shared/` ni en `backend/src/` |
| Degradacion por inactividad | Excluido | No implementado | `conditionAfterWork` solo consume horas trabajadas |

### 3.3 §112 Sistema de trabajadores

| Punto | GDD | Estado real | Evidencia |
|---|---|---|---|
| Pool de contratacion procedural con refresco | Incluido | Implementado | `POOL_SIZE = 3`, `POOL_REFRESH_INTERVAL_GAME_HOURS = 48`; refresco observado |
| Contratar y despedir solo si `IDLE` | Incluido | Implementado | 409 `WORKER_NOT_IDLE`; despido de ocioso libera plaza |
| `skillFactor` con piso de 0,5 | Incluido | Implementado | `SKILL_FACTOR_BASE = 0.5`, `SKILL_FACTOR_SPAN = 0.5` |
| Progresion de habilidad al completar tarea | Incluido | Implementado | `SKILL_GAIN_PER_TASK_BP = 100`, tope `SKILL_CAP_BP = 9500` |
| Asignacion validada en servidor | Incluido | Implementado, orden verificado | Apartado 2.2 |
| Salario continuo como coste de oportunidad | Incluido | Implementado | 668 asientos `WORKER_WAGES`, tambien con el trabajador ocioso |
| Cancelacion todo-o-nada | Incluido | Implementado | Apartado 2.4 |
| Alojamiento como restriccion dura | Incluido | Implementado | Apartado 2.3 |
| Vinculo trabajador y granja via `homeId` | Incluido | Implementado | `hireWorkerBodySchema` con `farmId` obligatorio y `homeId` opcional |
| Negociacion de salario | Excluido | No implementado | El cuerpo de contratacion no admite importe |
| Renuncias y reputacion del pool | Excluido | No implementado | — |
| Multitarea del trabajador | Excluido | No implementado | 409 `WORKER_NOT_IDLE` en el segundo intento |
| Progreso parcial persistente al cancelar | Excluido | No implementado | `progressBp` se descarta, el campo no avanza |
| Mudanza entre granjas | Excluido | No implementado | Sin ruta en el contrato |
| `TRAVELING`, `UNAVAILABLE`, `INJURED` | Excluido | Reservado | `shared/domain/enums.ts:156-161` |

### 3.4 §126 Economia y balance

| Punto | GDD | Estado real | Evidencia |
|---|---|---|---|
| Coste de tierra sin multiplicadores | Incluido | Implementado | `BASE_PRICE_BY_TERRAIN`; 400 celdas de pradera por 47.750,00 |
| Coste de infraestructura, compra mas huella | Incluido | Implementado | `placeBuildingBodySchema.purchaseFootprintLand`; ADR-0029 |
| Separacion adquisicion, posesion y operacion | Incluido | Implementado | Tres familias de asiento distintas en el ledger |
| Formula de punto de equilibrio | Incluido | Implementado | `shared/rules/balance.ts:65`, `breakEvenCycles` |
| Precio de venta fijo | Incluido | Implementado | `sellPricePerLiter = 0.22`; `GET /api/market/prices` constante entre llamadas |
| Resumen de regreso con formula analitica | Incluido | Implementado | `GET /api/session/welcome-back` con desglose `byType` |
| KPIs de balance | Incluido | Implementado | `docs/balance/informe-balance.md` y `docs/balance/kpis.json` |
| Multiplicadores de ubicacion o accesibilidad | Excluido | No implementado | Precio derivado solo del tipo de terreno |
| Fluctuacion de mercado | Excluido | No implementado | Precio constante del catalogo |
| Contratos a futuro | Excluido | No implementado | — |
| Reputacion afectando precios | Excluido | No implementado | — |

### 3.5 §141 Sistema de silvicultura

| Punto | GDD | Estado real | Evidencia |
|---|---|---|---|
| `ForestPlot` separada de `Field`, multi-chunk | Incluido | Implementado | `POST /api/forest-plots`; parcela de 28 celdas creada |
| Arbol individual con cuatro fases | Incluido | Implementado | `stageHistogram` con las cuatro fases pobladas |
| Generacion procedural de bosque ya poblado | Incluido | Implementado | 28 arboles en 28 celdas al crear la parcela |
| Tala por lote, no arbol por arbol | Incluido | Implementado | `POST /api/forest-plots/:id/fell` con `cells` opcional |
| Una sola especie | Incluido | Implementado | `PINE` unico miembro del catalogo |
| Maquinaria forestal separada | Incluido | Implementado | `HARVESTER_FORESTRY` y `FORWARDER`; `FORWARDER_REQUIRED` verificado |
| Almacen de madera separado del silo | Incluido | Implementado | `WOOD_STORAGE` con 500.000 dm3, contabilidad independiente |
| Replantacion manual | Incluido | Implementado | `POST /api/forest-plots/:id/replant`; `CELL_ALREADY_HAS_TREE` verificado |
| Reutilizacion de trabajador y `skillFactor` | Incluido | Implementado | Misma ruta de asignacion, sin habilidad forestal propia |
| Tala arbol por arbol desde la interfaz | Excluido | No implementado | El cuerpo solo admite un conjunto de celdas |
| Multiples especies | Excluido | No implementado | — |
| Conversion bosque a campo mas alla del desmonte | Excluido | No implementado | Solo `POST /api/land/clear` |
| Reforestacion de campos agricolas | Excluido | No implementado | Sin ruta |
| Habilidad forestal diferenciada | Excluido | No implementado | — |

### 3.6 §69 MVP y §71 roadmap

| Bloque de §69 | Estado real | Evidencia |
|---|---|---|
| Mundo: generacion procedural, semilla, chunks, cuatro terrenos, camara con zoom y desplazamiento | Implementado | `shared/world/`, `GET /api/world/info`, `POST /api/world/chunks`, `WorldScene` |
| Tierra: compra, propiedad, celdas, creacion de campos, campos multi-chunk | Implementado | Apartado 2.3; campo de 1.200 celdas repartido en varios chunks |
| Agricultura: un cultivo y ciclo completo | Implementado | Apartado 2.7 |
| Maquinaria: seis tipos con catalogo y formulas | Implementado | Apartado 3.2 |
| Trabajadores: contratar, salario, asignar, trabajar, ocioso | Implementado | Apartado 3.3 |
| Granja: huella, garaje, silo, vivienda, taller | Implementado | Los cinco tipos en `BUILDING_CATALOGUE`, los cinco colocados en esta sesion |
| Economia: capital inicial de 160.000, compras, salarios, mantenimiento y venta | Implementado | Asiento `STARTING_CAPITAL` de 160.000,00 al registrar |
| Persistencia: cuenta, partida guardada, simulacion offline | Implementado | `advancePlayer`; verificado sin worker en el apartado 1 |

| Fase de §71 | Estado real |
|---|---|
| 0 Foundation, 1 World, 2 Land, 3 Farming, 4 Machinery, 5 Farm, 6 Economy, 7 Idle, 8 Forestry | Implementadas |
| 9 Expansion: mas cultivos, mas maquinaria, mas edificios, economia avanzada | No implementadas |
| 9 Expansion: multiples granjas | Implementada por adelantado, ver O6 |

Ningun elemento de la lista «fuera del MVP» de §70 aparece implementado. Se recorrio el arbol buscando
ganaderia, clima, contratos, prestamos, fertilizantes, herbicidas, mineria, pesca, carreteras, riego y
multijugador directo: las unicas coincidencias son comentarios que declaran la exclusion y dos valores
reservados de enumeracion, `LandUse.ROAD` y `SoilCondition.COMPACTED`, que ninguna ruta escribe.

---

## 4. Hallazgos, por gravedad

### H1. La tabla de §90 se valida como conjunto y no por papel (confirmado, gravedad alta)

`POST /api/tasks` acepta una peticion en la que `poweredMachineId` nombra al implemento y
`implementMachineId` a la maquina propulsada. Confirmado por ejecucion en las cuatro operaciones
agricolas; el caso literal esta en el apartado 2.1. §90 dice que el servidor valida esa tabla antes de
aceptar cualquier asignacion y que las combinaciones invalidas se rechazan.

Causa. `backend/src/modules/tasks/assignment.ts:378` construye `offeredMachineTypes` como la lista de
los tipos de las maquinas resueltas, perdiendo el papel con el que el cliente las nombro.
`explainIncompatibility`, en `shared/rules/machinery.ts:184-240`, consume esa lista como multiconjunto
con la funcion `take` declarada en la linea 202, de modo que solo comprueba que los tipos requeridos
esten presentes.

Alcance real hoy. El defecto es inerte: la velocidad de trabajo sale de `baseWorkSpeedForOperation` y
la condicion que marca el ritmo de `paceMachineType`, y ambas resuelven por tipo a partir de la tabla
de requisitos, no del papel recibido. La peticion intercambiada y la correcta producen el mismo
`effectiveWorkSpeedMilli`, el mismo desgaste y la misma reserva. Lo que falla es la validacion, no el
calculo.

Por que corregirlo aun asi. Primero, porque §90 es una regla del GDD que el servidor declara validar y
no valida. Segundo, porque la prevision de `POST /api/tasks/estimate` presenta como factible una
combinacion que el panel nunca ofreceria, y ADR-0032 hace del codigo del servidor el motivo unico de
un control inhabilitado. Tercero, porque la inocuidad depende de que ningun consumidor lea el papel: en
el momento en que una operacion admita dos maquinas propulsadas posibles, o en que el calculo pase a
leer `collector.powered`, el defecto deja de ser inerte sin que nada lo avise.

Correccion propuesta. Ampliar la entrada de `explainIncompatibility` con los dos papeles, por ejemplo
`poweredType` e `implementType`, y comprobar `poweredType === requirement.poweredMachine` e
`implementType === requirement.requiredImplement` antes del recuento de sobrantes, emitiendo
`POWERED_MACHINE_REQUIRED` e `IMPLEMENT_NOT_ALLOWED` respectivamente. La regla debe seguir viviendo en
`shared/rules/`, no en el modulo del backend, para que el cliente y el servidor no puedan divergir
(seccion 8 del plan). Anadir a `shared/rules/__tests__/machinery.test.ts` un caso que afirme el rechazo
del intercambio, y a `backend/src/__tests__/tasks/` la asercion negativa equivalente por HTTP.

### H2. El arranque del backend re-ancla el reloj del mundo desde la configuracion (confirmado, gravedad media-alta)

Confirmado por ejecucion. Con el mundo en un multiplicador de 36.000, arrancar una segunda instancia
del backend con `GAME_RATE_NUM=12` en su entorno cambio el multiplicador del mundo vivo a 12 e
incremento `scheduleEpoch` de 3 a 4, sin ninguna accion de operador y sin ninguna traza de nivel de
aviso.

Causa. `backend/src/lib/gameClock.ts:279`, `verifyOnStartup`: la version de generador y el tamano de chunk
son parada dura, pero una diferencia de multiplicador se resuelve llamando a `retimeWorld`.

Contradiccion. El punto 3 de ADR-0007 dice literalmente que cambiar el multiplicador es una operacion
de dominio, `retimeWorld`, y no una actualizacion de configuracion. `verifyOnStartup` la convierte
exactamente en una actualizacion de configuracion, aplicada en cada arranque de cada proceso. La
seccion 6.1 del plan senala ademas la consecuencia: cambiar el multiplicador altera el consumo de caja
de todos los jugadores a la vez.

Los invariantes mecanicos si se respetan, porque el camino pasa por `retimeWorld`: se congela el pasado
en `WorldTimeSegment`, se re-ancla, se incrementa la epoca y se reprograman los trabajos del horizonte.
Lo que se pierde es la intencionalidad. Dos consecuencias operativas concretas: un `POST
/api/dev/retime` no sobrevive a un reinicio, y dos procesos con entornos distintos, por ejemplo el
servidor y el worker desplegados por separado, se pisan el multiplicador mutuamente en cada arranque.

Correccion propuesta. Tratar la divergencia como las otras dos constantes de mundo, es decir, abortar
el arranque con un mensaje que nombre el valor persistido y el configurado, y exigir una variable
explicita del estilo `GAME_RATE_APPLY_ON_BOOT=true` para autorizar el re-anclaje. Alternativa mas
barata: conservar el re-anclaje pero registrarlo con nivel de aviso y exponerlo en `/health`, de modo
que sea observable. En cualquiera de los dos casos, ADR-0007 necesita una nota que reconozca la
excepcion, porque hoy el codigo y la decision dicen cosas distintas.

### H3. La validacion de esquema precede a la guarda de desarrollo y a la autenticacion (confirmado, gravedad media)

Confirmado por ejecucion contra el proceso con `DEV_ENDPOINTS=false`. Una peticion sin token y con
cuerpo vacio a `POST /api/dev/grant` devuelve 400 `VALIDATION_FAILED` con `details.field: amount`. La
misma ruta con un cuerpo bien formado devuelve 403 `DEV_ENDPOINT_DISABLED`.

No es una elusion de autorizacion: se comprobo que ni el saldo ni el reloj cambian en ninguno de los
dos casos, con token o sin el. El problema es de orden. Un llamante no autenticado puede enumerar el
esquema de cuerpo de cualquier ruta del servicio, incluidas las que estan deshabilitadas, campo a
campo, leyendo el nombre que devuelve `details.field`. Es informacion que la documentacion OpenAPI
publica de todos modos en desarrollo, pero que en produccion, donde `/docs` puede no exponerse, deja de
estarlo.

Correccion propuesta. Registrar la guarda de desarrollo y el enganche de autenticacion en `onRequest`,
que Fastify ejecuta antes de `preValidation`, en lugar de despues. Es un cambio de fase de enganche en
`backend/src/plugins/`, sin efecto sobre las respuestas legitimas.

### O1. Semantica invertida de `details.expected` y `details.actual` entre rutas (confirmado, gravedad baja)

Con un `expectedTotal` que no cuadra, las dos rutas rellenan los mismos dos campos al reves:

```text
POST /api/land/purchase  -> details {"field":"body.expectedTotal","expected":"1.0000","actual":"120.0000"}
POST /api/machines       -> details {"field":"body.expectedTotal","expected":"18000.0000","actual":"1.0000"}
```

En la primera, `expected` es lo que envio el cliente; en la segunda, lo que calculo el servidor. Un
panel que componga «se esperaba X y se obtuvo Y» a partir de estos campos muestra el mensaje al reves
en una de las dos. El contrato no fija cual es cual: `shared/api/errors.ts` documenta los dos campos
como «versiones de contrato, para un desajuste». Correccion: fijar el criterio en el comentario de
`apiErrorDetailsSchema` y alinear las rutas; lo natural es que `expected` sea el valor autoritativo del
servidor, porque es el unico de los dos que el cliente no conoce ya.

### O2. Limite de peticiones unico y global, sin freno por cuenta (confirmado, gravedad baja)

El limitador es de 600 peticiones por minuto y direccion, compartido por todas las rutas
(`backend/src/app.ts:58-61`). Se confirmo que dispara: 52 intentos de inicio de sesion con contrasena
incorrecta pasaron antes del 429, porque consumian el mismo presupuesto que el resto del trafico de la
sesion. No hay contador por cuenta ni retardo creciente tras un fallo de credenciales. La superficie de
autenticacion no figura en ninguna de las cinco listas del MVP, de modo que no es un incumplimiento de
alcance; se deja anotado como deuda de seguridad para la fase que endurezca el despliegue.

### O3. `CONTRACT_VERSION_MISMATCH` solo es alcanzable por WebSocket (confirmado, gravedad baja)

`GET /api/state/snapshot` con la cabecera `x-contract-version: 9.9.9` responde 200. La cabecera se
declara en la lista de CORS de `backend/src/app.ts:117` y solo se comprueba en el enlace de WebSocket,
`backend/src/plugins/ws.ts:289`. Puede ser deliberado, porque la instantanea devuelve su propia
`contractVersion` en el cuerpo y el cliente puede compararla, pero no esta declarado en ningun sitio.
Correccion: documentarlo en la cabecera de `shared/api/errors.ts` o comprobar la cabecera tambien en
REST.

### O4. El desgaste inventado hace inviable el campo grande que §122 recomienda (confirmado, gravedad baja, materia de balance)

Medido sobre un campo de 1.200 celdas, que son 12 hectareas con la escala de ADR-0012:

```text
PLOW      397 h de juego -> tractor de 9135 a un valor que impide reasignar
CULTIVATE 300 h de juego -> tractor a 0 pb, 409 MACHINE_CONDITION_TOO_LOW en la siembra
HARVEST   854 h de juego -> conditionLossBp 10000, la cosechadora queda inservible en una sola tarea
```

Con las tasas de desgaste que la seccion 2.2 del plan inventa, 0,15 %/h en tractor e implementos y
0,25 %/h en cosechadora, un unico ciclo sobre un campo grande destruye por completo la maquina que lo
trabaja, y el ciclo no se puede completar sin intercalar dos reparaciones. §122 sostiene lo contrario,
que los campos grandes ganan por escala. No es un defecto de implementacion: las constantes se
implementan literalmente, que es la decision de la seccion 1 del plan. Corresponde al informe de
balance recoger el punto de ruptura, es decir el tamano de campo por encima del cual el ciclo deja de
ser ejecutable sin reparacion intermedia, junto a las demas desviaciones no reproducibles.

### O5. Redaccion contradictoria sobre el desbordamiento de silo (confirmado, gravedad baja, documental)

La seccion 5.4 del plan dice que la reserva de capacidad existe «para que el desbordamiento sea un
rechazo accionable». La seccion 2.2 del mismo plan, la resolucion 9 de las erratas y ADR-0052 dicen lo
contrario y eligen aviso al asignar, llenado hasta capacidad y desperdicio del resto con asiento. La
implementacion sigue la segunda, verificado en el apartado 2.3. Corresponde a quien cierre la
documentacion alinear la frase de la seccion 5.4 con ADR-0052, no al reves.

### O6. Multiples granjas implementadas por delante del roadmap (confirmado, gravedad baja, alcance)

`POST /api/farms` no acota el numero de granjas por jugador: en esta sesion se crearon tres sin
oposicion. §69 describe la granja en singular y §71 situa «Multiple farms» en la fase 9, fuera del
alcance declarado de fases 0 a 8. La decision es deliberada y esta razonada en las erratas, que
resuelven §31 frente a §83 con `Field.farmId` como granja que da servicio, y sin ella la pregunta «a
que silo va la cosecha» no tiene respuesta. Se anota como desviacion consciente de alcance, no como
defecto: conviene que `docs/erratas-gdd-stack.md` la declare como tal, porque hoy la justificacion
esta redactada como resolucion de una contradiccion y no como una ampliacion de alcance.

### Sospechado y no confirmado

Ninguno de los intentos del apartado 2 dejo un resultado ambiguo. Dos observaciones intermedias que
parecian hallazgos resultaron ser artefactos del multiplicador de 36.000 y quedan descartadas: una
asignacion aceptada sobre una maquina `IN_REPAIR` y una reparacion rechazada con
`MACHINE_CONDITION_ALREADY_FULL` se explicaban por que la reparacion, de 25 horas de juego, habia
terminado entre dos peticiones consecutivas. Repetidas con el mundo a multiplicador 1, ambas devuelven
`MACHINE_NOT_IDLE` y `MACHINE_NOT_REPAIRABLE`, que es lo correcto.

Queda sin cobertura, no sin resolver, la comprobacion 4 de §104 como refusal independiente, por el
motivo indicado en el apartado 2.2.

---

## 5. Resumen

De las seis materias que el encargo pide refutar, cinco resistieron por completo: la secuencia de §104
en su orden y sin ejecucion parcial, las restricciones duras de garaje, vivienda, silo, exclusividad de
uso, contiguidad y propiedad de la celda, la cancelacion de §106, el despido de §109 y la imposibilidad
de que el cliente fije su dinero, su tiempo o el estado de un campo. La sexta, la tabla de §90, cede
ante el intercambio de papeles entre la maquina propulsada y el implemento: el hallazgo H1.

Fuera de la lista, la validacion autoritativa dejo dos hallazgos mas: el arranque del backend cambia el
multiplicador del mundo desde la configuracion, contra lo que ADR-0007 decide (H2), y la validacion de
esquema se ejecuta antes de la guarda de desarrollo y de la autenticacion (H3).

En cuanto al alcance, las cinco listas de «que entra en el MVP» estan completas y no hay ningun punto
excluido implementado de mas. Las once exclusiones que el GDD pide conservar como valor reservado
figuran en las enumeraciones sin que ninguna ruta las escriba. La unica desviacion de alcance es la
gestion de varias granjas, que pertenece a la fase 9 del roadmap y esta implementada por una decision
deliberada del plan (O6).
