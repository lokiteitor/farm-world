# NOTES-w6a

Agente del motor de tareas. Fase W6. Ambito escrito, exclusivamente:

- `backend/src/modules/tasks/**`
- `backend/src/__tests__/tasks/**`
- este fichero

No se ha escrito en ningun otro directorio. `backend/src/app.ts`, `backend/src/handlers.ts`, el
registro de rutas, `backend/src/lib/**`, `shared/**`, `backend/prisma/**` y el resto de ficheros
congelados quedan intactos: sustituir el andamiaje consistio en cambiar `defineStubRoute` por
`defineRoute` dentro del propio modulo y en sustituir el cuerpo de `modules/tasks/jobs.ts`,
conforme a la regla 3 de la seccion 11 del plan.

No se ha ejecutado `git`, `npm install`, `prisma generate`, `prisma migrate`, `docker compose` ni
ninguna construccion de produccion. El unico servidor levantado fue el de la verificacion del
apartado 1.3, que se apago al terminar y cuyo mundo efimero se borro.

---

## 1. Que se ha implementado

### 1.1 Las cinco rutas del area `tasks` y el manejador de `TASK_COMPLETE`

| Ruta | Avanza al jugador | Secuenciada | Mueve dinero |
|---|---|---|---|
| `GET /api/tasks` | Si | No | No |
| `GET /api/tasks/:taskId` | Si | No | No |
| `POST /api/tasks/estimate` | Si | No | No |
| `POST /api/tasks` | Si | Si | No |
| `POST /api/tasks/:taskId/cancel` | Si | Si | No |

Las dos rutas mutantes se ejecutan dentro de `withPlayerAdvanced`, que es lo unico que devuelve el
`seq` que una respuesta secuenciada debe llevar (ADR-0017). Ninguna de las dos lleva clave de
idempotencia, exactamente como el contrato declara: crear una tarea no cobra nada, porque el coste
de operacion de GDD §94 es un devengo continuo sobre el intervalo en que la tarea corre (plan 6.2);
lo que la protege de un doble envio es la reserva condicional del trabajador y de las maquinas.

`TASK_COMPLETE` deja de ser andamiaje. Con el manejador de `modules/forestry` para
`FOREST_NOTIFY_MILESTONE`, la metrica `farm_world_scheduled_events_unhandled_total` queda plana en
cero; la comprobacion con salida real esta en el apartado 1.3.

### 1.2 Ficheros del modulo

| Fichero | Contenido |
|---|---|
| `modules/tasks/record.ts` | La fila `Task`, sus lecturas derivadas (`progressBp`, horas trabajadas) y el modelo de lectura |
| `modules/tasks/assignment.ts` | Las seis comprobaciones de GDD §104 y la formula de GDD §91, evaluadas una sola vez para la prevision y para la creacion |
| `modules/tasks/service.ts` | Los tres caminos de escritura y el nucleo que comparten, mas la estrategia `CANCEL_TASKS` |
| `modules/tasks/routes.ts` | La superficie HTTP, que convierte y no decide nada |
| `modules/tasks/jobs.ts` | El manejador real de `TASK_COMPLETE` |
| `modules/tasks/index.ts` | Registro de rutas y superficie que exportan los demas |

Pruebas en `backend/src/__tests__/tasks/`: `lifecycle.int.test.ts` (5), `assignment.int.test.ts`
(7) y `cancel.int.test.ts` (3), mas `fixtures.ts`, que es auxiliar y no una suite. 15 pruebas.

Lo que cada una fija:

- `lifecycle`: el ejemplo narrativo de GDD §110 de extremo a extremo (duracion 86,1883 h, campo
  `VIRGIN -> PLOWED`, habilidad 70 % -> 71 %, desgaste sobre las horas trabajadas); el rendimiento
  de la cosecha comparado con `finalYieldLiters` recalculado en la prueba y no copiado de la
  respuesta; el silo que se llena hasta capacidad con el asiento `HARVEST_WASTE`; el manejador
  ejecutado dos veces con un solo efecto; y una tarea cuyo vencimiento ya paso aplicada por el
  camino de reconciliacion, con `endedGameMs` en el vencimiento y no en el instante actual.
- `assignment`: las seis combinaciones invalidas de la tabla de GDD §90 y siete situaciones en las
  que dos o tres motivos son ciertos a la vez, cada una con una instantanea del estado antes y
  despues que comprueba que no hubo mutacion parcial.
- `cancel`: la cancelacion todo o nada, la reserva de silo devuelta, el coste de operacion no
  reembolsado, la ausencia de trabajo agendado huerfano y la estrategia `CANCEL_TASKS`.

### 1.3 Verificacion con salida real

Ejecutada desde la raiz del repositorio, con PostgreSQL en 55432 y Redis en 56379.

| Orden | Resultado |
|---|---|
| `make sync-types` | 0. 53 ficheros a `backend/src/shared` y 53 a `frontend/app/shared` |
| `make typecheck` | 0. `tsc` en `shared` y en `backend` sin salida; `vue-tsc` del cliente en verde |
| `make lint` | 0. `npx eslint .` sin hallazgos, incluidas las reglas de zona; Prettier responde "All matched files use Prettier code style!" |
| `make test-unit` | 0. `shared`: 23 ficheros y 418 pruebas. Cliente: 51 ficheros y 514 pruebas |
| `npx vitest run --config vitest.int.config.ts src/__tests__/tasks/` | 0. 3 ficheros y 15 pruebas |
| `make test-int` | 0. 32 ficheros y 253 pruebas, todas en verde |

Bucle completo por HTTP contra un servidor real con el multiplicador acelerado a 360000/1, es
decir una hora de juego cada diez milisegundos reales, sobre un mundo propio de semilla negativa
que se borro al terminar. Salida literal:

```
[verify] mundo creado {"seed":-777001,"rate":"360000/1"}
[verify] ARAR · prevision {"units":300,"durationGameHours":"84.0336","operatingCost":"1848.7395"}
[verify] ARAR · completada {"endedGameMs":"1005241008","scheduledEndGameMs":"1005241008","progressBp":10000}
[verify] SEMBRAR · prevision {"units":300,"durationGameHours":"73.0994","operatingCost":"1608.1871"}
[verify] SEMBRAR · completada {"endedGameMs":"1367637895","scheduledEndGameMs":"1367637895","progressBp":10000}
[verify] CRECIMIENTO · listo para cosechar {"almacenado":"READY_TO_HARVEST","proyectado":"READY_TO_HARVEST","rendimientoEsperado":13500}
[verify] COSECHAR · prevision {"units":300,"durationGameHours":"116.2791","operatingCost":"6976.7442","expectedProductionUnits":13500,"overflowUnits":0}
[verify] COSECHAR · completada {"endedGameMs":"2161004651","scheduledEndGameMs":"2161004651","progressBp":10000}
[verify] INVENTARIO ... "usage":{"storedUnits":13500,"reservedUnits":0,"capacityUnits":60000,"occupancyBp":2250}
[verify] CAMPO tras el ciclo {"estado":"VIRGIN","fertilidadBp":8500,"cultivo":null}
[verify] TRABAJADOR tras el ciclo {"estado":"IDLE","habilidadBp":7300,"tareasCompletadas":3}
[verify] /metrics · series de eventos sin manejador:
  # HELP farm_world_scheduled_events_unhandled_total Eventos vencidos cuyo tipo no tiene manejador registrado.
  # TYPE farm_world_scheduled_events_unhandled_total counter
[verify] /metrics · eventos vencidos por tipo:
  farm_world_scheduled_events_due_total{kind="PLAYER_SETTLE_SWEEP",service="server"} 26
  farm_world_scheduled_events_due_total{kind="TASK_COMPLETE",service="server"} 3
  farm_world_scheduled_events_due_total{kind="FIELD_ADVANCE_PHASE",service="server"} 3
```

El contador de eventos sin manejador no tiene ninguna serie, que es la forma en que `prom-client`
expresa un contador etiquetado que nunca se incremento: plana en cero, no en cero declarado.

Tres lecturas del bucle que conviene dejar afirmadas:

- Las tres duraciones bajan (84,03 h, 73,10 h, 116,28 h) porque la habilidad sube un punto por
  tarea completada (GDD §103 y §105) y el ritmo de la cosecha lo marca la cosechadora, a 3,0
  celdas/h frente a las 4,2 del arado y las 4,8 de la sembradora (GDD §89).
- La fertilidad pasa de 10 000 a 8 500 puntos base, que es exactamente
  `fertilityDrainPerCycleBp` de GDD §82.
- El rendimiento son 13 500 L y no los 27 000 L de la formula sin penalizacion, porque las malezas
  saturan al 100 % durante el ciclo y GDD §78 aplica entonces su penalizacion maxima del 50 %. Es
  el hallazgo principal del informe de balance (plan 2.2, resolucion de §82 frente a §119)
  reproducido por el bucle real y no una desviacion de este modulo.

---

## 2. Pendiente fuera de mi ambito

### 2.3 `Task.jobId` se queda en nulo, por construccion

Categoria: observacion sobre una columna del esquema, sin cambio pendiente
Ficheros afectados: `backend/prisma/schema.prisma`, `Task.jobId`

La columna existe para poder retirar el trabajo encolado al cancelar (GDD §106). Este modulo la
deja nula y no es un olvido: el identificador del trabajo lo asigna el despachador despues del
commit, de modo que no puede escribirse en la transaccion que crea la tarea, y ya vive en la fila
del outbox, que es la autoritativa. La cancelacion retira el trabajo con
`cancelScheduledEventsFor`, que lee el identificador de la fila que lo tiene. Una segunda copia
aqui quedaria ademas obsoleta en el primer re-anclaje, que reasigna todos los identificadores de
trabajo con la nueva epoca (plan 6.4). Si alguna fase posterior quiere la columna poblada, lo que
procede es que el despachador la escriba junto a `scheduled_events.jobId`, no que la escriba este
modulo.

### 2.4 Restos de dos ejecuciones fallidas de esta suite, ya limpiados

Categoria: dato de desarrollo, resuelto
Durante la puesta a punto, dos ejecuciones de `lifecycle.int.test.ts` fallaron con el `teardown` a
medias y dejaron dos mundos efimeros con cinco jugadores cada uno y siete tareas `IN_PROGRESS`. Se
purgaron por completo (mundos de semilla -1251569 y -1610565). Queda una tarea `IN_PROGRESS` en el
mundo de semilla -1330047, que pertenece a la suite de otro agente y no se ha tocado. La causa del
fallo de limpieza era el orden del `teardown`, corregida en `fixtures.ts`: el `CHECK`
`farms_stock_check` impide borrar un silo que todavia guarda grano, de modo que la existencia se
vacia antes de borrar los edificios.

---

## 3. Discrepancias detectadas

### 3.1 ADR-0040 descarta escribir en tablas ajenas y no publica reserva ni liberacion de maquina

Categoria: hueco entre una decision y la superficie que la implementa

ADR-0040 enumera entre sus alternativas descartadas "que `modules/tasks` escriba directamente en
las tablas de maquinaria y de trabajadores", y `modules/workers` publica en efecto
`reserveWorkerForTask` y `releaseWorkerFromTask`. `modules/machinery` publica
`requireAssignableMachines` y `applyMachineWear`, que son la comprobacion y el desgaste, y no
publica el simetrico de las dos de trabajadores.

Como la columna de reserva `Machine.currentTaskId` y `Machine.status` son precisamente lo que
`requireAssignableMachines` consulta y lo que el `CHECK` `machines_life_check` defiende, escribir
solo `task_machines` dejaria la comprobacion de disponibilidad ciega a la doble reserva. La reserva
y la liberacion viven por tanto en `modules/tasks/service.ts`, en una funcion por sentido, ambas
actualizaciones condicionales cuyo recuento de filas decide, con el mismo codigo de rechazo
(`MACHINE_NOT_IDLE`) que la comprobacion habria producido.

Lo que procede si se quiere cerrar el hueco es que `modules/machinery` publique
`reserveMachineForTask` y `releaseMachineFromTask` con la misma firma que las de trabajadores, y
que este modulo las consuma; son dos funciones de cinco lineas y el cambio no altera ningun
comportamiento. Mientras tanto la verdad sigue estando donde ADR-0040 la puso, en la tabla de
tareas, y las columnas siguen siendo reserva y no autoridad.

### 3.2 GDD §90 y §104 no dicen que ocurre cuando el implemento no existe

Categoria: hueco del GDD resuelto en la implementacion

La secuencia de §104 numera "maquina existe, pertenece al jugador, esta ociosa" como paso 2, "tipo
compatible" como 3 e "implemento libre y asignado" como 4. El paso 3 es sobre tipos, y no hay tipo
sin fila: la fila del implemento tiene que leerse antes de poder consultar la tabla de §90. La
resolucion aplicada, y declarada en el encabezado de `assignment.ts`, es que la existencia y la
propiedad de las dos maquinas se resuelven antes que la tabla, y que la ociosidad y la condicion
del implemento se juzgan despues, en el paso 4. Consecuencia observable: una peticion que nombra un
implemento inexistente recibe `NOT_FOUND` antes que la incompatibilidad de tipos, y una que nombra
un implemento del tipo equivocado recibe el codigo de la tabla antes que "esta ocupado".

### 3.3 §104 no menciona la regla de granja de §108, que sin embargo aplica

Categoria: hueco del GDD resuelto en la implementacion

La secuencia de §104 no incluye la restriccion de §108 ("un trabajador de Farm #1 no puede operar
maquinaria de Farm #2"), que el disparador `task_machines_farm_guard` de la migracion inicial si
impone. Se comprueba en la aplicacion como parte del paso 4, porque es una propiedad del par y no
de ninguno de los dos por separado, y el rechazo es `WORKER_WRONG_FARM`. Sin la comprobacion en la
aplicacion el rechazo llegaria como violacion de restriccion y no como codigo del contrato.

### 3.4 Estado de las puertas comunes al cerrar este trabajo

Categoria: informacion para el cierre de la fase, sin cambio pendiente de este agente

Durante la verificacion, `make typecheck`, `make lint` y `make test-int` estuvieron en rojo en
distintos momentos por ficheros de W6-B y de W6-C que se estaban escribiendo en paralelo:
`src/__tests__/forestry/fixtures.ts` con tres errores de tipos, `src/__tests__/forestry/generator.test.ts`
con un hallazgo de `import/order` y `src/__tests__/session/welcome-back.int.test.ts` con una
asercion en rojo. Ninguno estaba en un fichero de este agente y los tres los resolvieron sus
propietarios. La ultima ejecucion de las tres puertas, ya con todo integrado, devuelve 0:
`make typecheck` sin salida, `make lint` sin hallazgos y `make test-int` con 32 ficheros y 253
pruebas. Se recoge como estado observado para que el cierre de la fase no lo interprete como una
incidencia abierta.

---

## 4. Decisiones para el ADR de la fase

Este agente propone una entrada, ADR-0049, con este contenido. La escribe el agente de cierre de
W6, que es quien tiene el fichero.

### ADR-0049 — Una sola evaluacion para la prevision y para la asignacion, y la puerta de transicion como unica fuente de idempotencia

Contexto. GDD §104 fija una secuencia numerada de seis comprobaciones y GDD §90 una tabla de
compatibilidad, y el contrato pide dos respuestas distintas sobre exactamente las mismas reglas:
`POST /api/tasks/estimate` devuelve una lista de bloqueos, porque el panel de asignacion los
muestra todos a la vez, y `POST /api/tasks` devuelve uno solo, porque una peticion se rechaza una
vez. ADR-0048 ya fijo que el motivo de un control inhabilitado es el primero de la secuencia del
servidor; dos implementaciones de esa secuencia harian que el panel habilitara un boton que el
servidor rechaza, que es precisamente lo que aquella decision evita.

Decision, en cuatro partes.

1. La prevision y la creacion son la misma evaluacion en dos modos. `evaluateAssignment` recorre la
   secuencia de §104 acumulando rechazos en el orden en que la seccion los numera; la prevision los
   devuelve todos y la creacion lanza el primero. No hay ninguna regla que una de las dos conozca y
   la otra no, y la propia lista es la que ordena los motivos.

2. La tabla de §90 se consulta una vez, con `explainIncompatibility` de `shared/rules/machinery.ts`,
   y sus codigos se reportan en el orden en que esa funcion los produce, que es el orden de la
   tabla: maquina autopropulsada, implemento requerido, implemento sobrante y requisitos de
   posesion. Ese orden coincide con el de §104, de modo que no hay que reordenarlo ni elegir.

3. La idempotencia de cerrar una tarea es la puerta de transicion condicional y nada mas.
   `UPDATE tasks SET status = ... WHERE id = ? AND status = 'IN_PROGRESS'` decide por recuento de
   filas y todos los efectos viven dentro de la rama que la gano. Las piezas que hay debajo son
   ademas idempotentes por su cuenta —`applyMachineWear` no retrocede la marca de condicion, las
   liberaciones son condicionales al identificador de la tarea y el asiento del desperdicio lleva
   `harvest:<taskId>`— pero eso es defensa en profundidad y no el mecanismo.

4. Completar y cancelar comparten nucleo. Cerrar una tarea son cinco pasos —reclamar la fila,
   liberar el objetivo, devolver la reserva de almacen, aplicar el desgaste de las horas realmente
   trabajadas y devolver trabajador y maquinas— y las dos operaciones difieren en tres cosas y en
   ninguna mas: el instante al que cierran, si se aplica la transicion del campo y si sube la
   habilidad. El prorrateo del desgaste de §106 no tiene por tanto codigo propio: es la misma
   llamada con otro instante, y ese instante es el mismo sobre el que `lib/accrual.ts` integra el
   coste de operacion, de modo que las horas que desgastan y las que se facturan coinciden por
   construccion.

Consecuencias. El panel no puede divergir del servidor en el motivo ni en el orden. Una segunda
entrega del mismo vencimiento no duplica ningun efecto, lo que la prueba comprueba devolviendo la
fila del evento a `PENDING` para llegar al manejador por segunda vez: la puerta exterior de
`advancePlayer` ya no decide nada ahi, y quien decide es la de la tarea. Y una tarea cuyo
vencimiento paso mientras el worker estaba caido produce las mismas filas que una puntual, porque
todo se aplica al instante de vencimiento y nunca al actual.

Coste asumido. La evaluacion se ejecuta dos veces cuando el cliente previsualiza y despues asigna,
que son dos lecturas del mismo conjunto de filas. Es deliberado: la alternativa seria cachear la
prevision y validar contra ella, que es exactamente la clase de cache autoritativa que el pilar de
servidor autoritativo prohibe.

Alternativas descartadas. Que la ruta mutante reutilice la lista de bloqueos de una prevision que
el cliente adjunte: convierte al cliente en autoridad sobre su propia validacion. Que la prevision
llame a la creacion en una transaccion que se deshace: escribe filas, consume identificadores y
mueve el contador de secuencia para responder una pregunta. Marcar la tarea como completada y
aplicar los efectos en transacciones separadas: rompe la unica garantia que hace inocua la doble
entrega de BullMQ. Y un desbordamiento de silo como rechazo en lugar de aviso: plan 2.2 resuelve
§83 y §97 como aviso al asignar, llenado hasta capacidad al completar y desperdicio del resto con
asiento, y rechazar convertiria una cosecha parcialmente aprovechable en tierra sin cosechar.

## Resuelto

Las notas aplicadas se conservan aqui con su numeracion original, porque otros documentos y
varios comentarios de codigo las citan por numero.

### 2.2 El contrato no declara `FARM_UPSERTED` entre los eventos de las dos rutas mutantes

Aplicado por W7-A (integracion): las dos entradas declaran `GameEventType.FARM_UPSERTED`, y la de
cancelacion declara ademas `TREES_UPSERTED`, que la devolucion de las marcas de una tala cancelada
produce.

El texto original de la nota:

Categoria: cambio en fichero congelado del contrato
Ficheros afectados: `shared/api/routes.ts`, entradas `POST /api/tasks` y `POST /api/tasks/:taskId/cancel`
Propietario: W2-C (cerrado), a aplicar por W7-A

La asignacion de una cosecha compromete capacidad de silo y la cancelacion la devuelve. La
ocupacion que el cliente dibuja es almacenado mas reservado (`modules/farms/service.ts`), de modo
que sin la trama de la granja el indicador del silo se queda ofreciendo sitio que ya esta
comprometido. Este modulo emite `FARM_UPSERTED` en los dos casos, y solo cuando hubo reserva o
liberacion real; el contrato no lo lista.

La ampliacion es anadir `GameEventType.FARM_UPSERTED` al array `emits` de las dos entradas. Nada
se rompe mientras tanto —`emits` es declaracion y no se comprueba en ninguna puerta— y la
alternativa, no emitir la trama, dejaria un indicador desincronizado hasta la siguiente lectura
completa. Es el mismo tipo de hueco que `NOTES-w5-cierre.md` 2.6 recoge para las rutas de
maquinaria y personal.

### 2.1 La estrategia `CANCEL_TASKS` no la puede nombrar este agente

Aplicado por W7-A (integracion), con la semantica que la nota describe y otro mecanismo. `STEP_PLAN` no
nombra a `modules/tasks`, que es de una fase posterior: la estrategia llega por
`taskCancellerForLiquidation` de `lib/moduleSeams.ts`, que `src/handlers.ts` rellena. El paso lleva ademas
un predicado `available`, de modo que sin estrategia registrada se reporta como no ejecutado en lugar de
no hacer nada en silencio. `LiquidatedAsset['assetKind']` admite ya `'TASK'`.

El texto original de la nota:

Categoria: dependencia entre modulos, cambio en fichero de otro propietario
Ficheros afectados: `backend/src/modules/economy/liquidation.ts`, tabla `STEP_PLAN`
Propietario: W5-C (cerrado), a aplicar por W7-A

`modules/tasks` exporta `cancelTasksForLiquidation`, que es la semantica completa que
`NOTES-w5c.md` 2.4 pedia: desgaste prorrateado, liberacion de la reserva de silo, devolucion de
trabajador y maquinaria y retirada del trabajo agendado. Esta probada de extremo a extremo en
`cancel.int.test.ts`, invocada exactamente como el motor la invocara —dentro de la transaccion del
avance y al instante del evento—, y es idempotente: un segundo recorrido no encuentra nada que
cancelar.

Lo que falta es nombrarla, y eso es un cambio en un fichero de `modules/economy`. El parche, sobre
`liquidation.ts`:

```ts
// junto a los demas importes de modulo
import { cancelTasksForLiquidation } from '../tasks/index.js';

// y en STEP_PLAN, sustituyendo la entrada actual
  CANCEL_TASKS: {
    step: 'CANCEL_TASKS',
    reason: null,
    run: async (state) => {
      const cancelled = await cancelTasksForLiquidation(state.context, state.atGameMs);
      for (const outcome of cancelled) {
        state.assets.push({
          step: 'CANCEL_TASKS',
          assetKind: 'TASK',
          assetId: outcome.task.id,
          detail: outcome.task.operation,
          units: 1,
          proceeds: Money.ZERO,
        });
      }
    },
  },
```

Dos precisiones para quien lo aplique. La primera: `LiquidatedAsset['assetKind']` es hoy
`'STOCK' | 'MACHINE' | 'WORKER'` y hay que anadirle `'TASK'`; es una union local de
`liquidation.ts` y no del contrato. La segunda: el paso no recauda nada, igual que `WORKERS`, de
modo que no toca `state.balance` y no escribe asiento propio; lo que aporta es detener el coste de
operacion de GDD §94 y devolver la maquinaria a `IDLE`, que es lo que hace que el paso
`IDLE_MACHINES` —que va antes en el orden publicado— tenga algo que vender en la siguiente
liquidacion. El orden de `LIQUIDATION_STEPS` no se toca.

Sin este parche la liquidacion forzosa sigue funcionando y sigue registrando `CANCEL_TASKS` entre
los pasos que no ejecuto, que es el comportamiento que W5-C dejo deliberadamente.
