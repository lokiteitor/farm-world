# NOTES-w5b

Agente de trabajadores de la fase W5. Ambito escrito: `backend/src/modules/workers/**`,
`backend/src/__tests__/workers/**` y este fichero. No se ha tocado ninguna otra ruta del arbol.

Contenido: el sistema de §100 a §112 del GDD. Pool de contratacion procedural por jugador con refresco
agendado, contratacion con validacion de dinero y de vivienda, despido solo en estado ocioso,
progresion de habilidad y las comprobaciones que consumira el motor de tareas de W6-A.

---

## 1. Ficheros creados

| Ruta | Contenido |
|---|---|
| `backend/src/modules/workers/pool.ts` | Regla procedural de §102, pura y determinista. Habilidad uniforme en 30-90 %, salario sobre la recta ajustada a los tres ejemplos publicados, ruido multiplicativo y suelo. Sin `Math.random` ni `Date.now` |
| `backend/src/modules/workers/service.ts` | API interna: lecturas de plantilla y pool, modelos de lectura, marcos de WebSocket, las cuatro reglas que consume una fase posterior, escritura del pool y las dos transiciones de contratacion y despido |
| `backend/src/modules/workers/routes.ts` | Las cuatro rutas del area, sustituyendo el andamiaje |
| `backend/src/modules/workers/jobs.ts` | Manejador real de `WORKER_POOL_REFRESH`, sustituyendo el andamiaje de W3-A |
| `backend/src/modules/workers/index.ts` | Barril del modulo |
| `backend/src/__tests__/workers/pool.test.ts` | 13 pruebas unitarias puras de la regla de §102 |
| `backend/src/__tests__/workers/hiring.int.test.ts` | 15 pruebas de integracion: pool, contratacion, despido, granja del trabajador y refresco |
| `backend/src/__tests__/workers/wages.int.test.ts` | 5 pruebas de integracion del devengo salarial como integral de solapes |

No se toco `backend/src/app.ts`, ni `src/handlers.ts`, ni el registro de rutas: sustituir un andamiaje
fue cambiar `defineStubRoute` por `defineRoute` dentro del propio modulo, conforme a la regla 3 de la
seccion 11 del plan.

---

## 2. Verificacion con salida real

Ejecutado desde la raiz del repositorio, con PostgreSQL en 55432 y Redis en 56379.

| Orden | Resultado |
|---|---|
| `make sync-types` | exit 0. 53 ficheros a `backend/src/shared` y 53 a `frontend/app/shared` |
| `cd backend && npx tsc --noEmit` | exit 0, sin salida |
| `npx eslint backend/src/modules/workers backend/src/__tests__/workers` | exit 0, sin hallazgos, incluidas las reglas de zona |
| `npx prettier --check` sobre los mismos directorios | "All matched files use Prettier code style!" |
| `npx vitest run --config vitest.config.ts src/__tests__/workers/pool.test.ts` | 1 fichero, 13 pruebas, todas en verde |
| `npx vitest run --config vitest.int.config.ts src/__tests__/workers` | 2 ficheros, 20 pruebas, todas en verde |
| `make test-int` | 24 ficheros, 211 pruebas: 210 en verde y 1 en rojo, ajena a este modulo (apartado 4.1) |
| `cd shared && npm run test` | 23 ficheros, 418 pruebas, todas en verde |
| `make test-unit` | Rojo en 1 prueba del cliente, ajena a este modulo (apartado 4.2) |
| `make lint` | ESLint sin hallazgos; Prettier senala 6 ficheros de otro agente (apartado 4.3) |

Llamada HTTP real contra la pila de desarrollo. Servidor levantado con
`PORT=3219 DEV_ENDPOINTS=true npx tsx src/server.ts` y apagado al terminar; se verifico con `ss` que el
puerto quedo libre. Se eligio 3219 porque 3000, 3001 y 3100 los ocupa otro proyecto y 3211 lo tenia
tomado otro agente de esta misma fase.

```
GET /api/workers            {"workers":[],"totalSalaryPerGameHour":"0.0000","homeSlotsUsed":0,"homeSlotsTotal":0}

GET /api/workers/pool       tres candidatos, "nextRefreshAtGameMs":"4609129344"
                            listado en 4436329344, diferencia 172800000 ms = 48 h de juego
                            Martin Gallego   skill 3681 bp  pide  8.1749  factor 0.68405
                            Olga Herrera     skill 8368 bp  pide 27.3957  factor 0.9184
                            Daniel Escudero  skill 7482 bp  pide 25.9634  factor 0.8741

POST /api/workers/hire      200. seq 9. worker IDLE, salario 8.1749 igual al pedido (sin negociacion),
                            hiredGameMs 4436730876, pool con dos candidatos, homeSlotsUsed 1 de 4

POST /api/workers/hire      409 CANDIDATE_NOT_AVAILABLE (mismo candidato por segunda vez)
POST /api/workers/:id/fire  200. homeSlotsUsed 0, totalSalaryPerGameHour "0.0000"
POST /api/workers/:id/fire  404 NOT_FOUND (segundo despido del mismo trabajador)
POST /api/workers/hire      409 HOME_CAPACITY_EXCEEDED, details {"occupancy":0,"capacity":0}
                            (granja sin vivienda)
GET  /metrics               farm_world_scheduled_events_unhandled_total sin ninguna serie
```

Comprobacion de la banda de §102 sobre esos tres candidatos reales, con la recta ajustada del catalogo
(`-8.75 + 0.45 x skill`) y el ruido de +/- 12 %: 36,81 % ajusta 7,815 y pide 8,1749 (factor 1,046);
83,68 % ajusta 28,906 y pide 27,3957 (factor 0,948); 74,82 % ajusta 24,919 y pide 25,9634 (factor
1,042). Los tres dentro de banda.

No ejecutado, conforme al brief: `git`, `npm install`, `prisma generate`, `prisma migrate`,
`docker compose` y construcciones de produccion. El modulo no necesita migracion: `Worker` y
`WorkerCandidate` ya estan en `20260811205212_init` con sus restricciones y sus disparadores.

---

## 3. Decisiones para el ADR

Se anotan aqui y no se escriben en `docs/adr.md`, que tiene un unico escritor por fase.

### 3.1 El refresco reemplaza el pool entero, no rellena huecos

§102 dice que al contratar el candidato se retira y aparece uno nuevo tras `poolRefreshInterval`, lo que
admite dos lecturas: rellenar la plaza vacia, o renovar el pool completo. Se implemento la segunda.

Motivo: con relleno, los candidatos no contratados permanecerian listados indefinidamente y el jugador
podria reservar al candidato ideal y contratarlo cuando le conviniera, de modo que el intervalo no
aplicaria a nada y §102 dejaria de ser una decision. La renovacion completa satisface ademas la primera
lectura, porque la plaza del contratado se rellena en el siguiente vencimiento. El candidato retirado
conserva su fila con `removedGameMs`, que es lo que hace auditable el refresco e impide contratarlo dos
veces.

### 3.2 El pool se lista de forma perezosa en la primera lectura

El jugador lo crea `modules/auth`, que pertenece a una fase congelada y no sabe nada de contratacion, de
modo que no hay donde listar el primer pool en el registro sin reabrir un modulo congelado. Se lista al
vuelo en la primera llamada a `GET /api/workers/pool` y en la primera contratacion, con el mismo patron
perezoso que usa el ciclo de cultivo: el estado se deriva del reloj y se materializa cuando alguien
mira.

Consecuencia declarada: una ruta GET escribe. Se acota a un unico caso, la condicion es la ausencia de
evento de refresco pendiente —que solo puede darse antes del primer listado, porque el manejador agenda
siempre el siguiente—, la escritura toma el cerrojo de la fila del jugador para que dos primeras
peticiones concurrentes no dejen seis candidatos, y no emite ningun marco, porque el contrato no declara
`emits` para esa ruta y la respuesta ya lleva el pool.

### 3.3 El refresco salta intervalos enteros en lugar de reproducirlos

`advancePlayer` lee su lote de eventos vencidos antes de ejecutar los manejadores, de modo que un
manejador que agende el siguiente vencimiento en el pasado no lo aplica en la misma pasada. El ciclo de
cultivo acepta ese coste porque cada frontera de fase deja historia en la fila. El pool no: solo se puede
contratar del pool listado ahora, y ninguna de las renovaciones que un jugador desconectado nunca vio
cambia el ledger ni ninguna otra fila.

`poolCatchUp` calcula por tanto la ultima frontera anterior o igual al instante actual y agenda la
siguiente, de modo que una ausencia de tres semanas de juego se resuelve con un refresco y no con
doscientas idas y vueltas de la cola. El agendado sigue en la misma retícula de 48 horas, sin deriva.

### 3.4 "Validar dinero" de §102 es la politica de deuda, no una tasa de contratacion

§102 pide validar dinero al contratar, pero ni el catalogo define coste de contratacion ni §109 define
indemnizacion. Lo que la comprobacion puede significar es que el jugador pueda sostener el salario, y eso
es exactamente la politica de deuda de la seccion 6.6 del plan: comprometer un coste continuo es gasto
discrecional y un saldo liquidado negativo lo bloquea. Se responde `SPENDING_BLOCKED_IN_DEBT`, 402, y no
`INSUFFICIENT_FUNDS`, porque no hay importe requerido que comparar. Vender y asignar tareas siguen
disponibles, que es lo unico que impide un bloqueo permanente.

Consecuencia: contratar y despedir no mueven dinero, no escriben asiento y no llevan clave de
idempotencia, que es lo que el contrato ya declaraba. Lo que protege una contratacion de un doble envio es
que el candidato sale del pool.

### 3.5 `homeSlotsUsed` y `homeSlotsTotal` son del jugador, no de la granja

El campo aparece con el mismo nombre en las tres respuestas del area. Se decidio que signifique lo mismo
en las tres —el agregado de todas las viviendas vivas del jugador— porque un campo que significara la
granja en una respuesta y la explotacion en otra es la clase de ambiguedad que un cliente resuelve mal
exactamente una vez. La lectura por granja ya la da `GET /api/farms`, y el marco `BUILDING_UPSERTED` que
emiten la contratacion y el despido lleva la ocupacion de la vivienda que realmente cambio.

### 3.6 La generacion del pool reutiliza el mezclador del generador de terreno

`hashGrid` de `shared/world/terrain.ts` es el finalizador de avalancha de 32 bits ya auditado y con
pruebas de determinismo. Se reutiliza en lugar de escribir un segundo mezclador, con las cinco ranuras
enteras llevando semilla del mundo, jugador, generacion, ranura del pool y atributo. El jugador entra
como entero mediante un FNV-1a de su identificador, y la generacion es el instante de listado en horas de
juego enteras. Consecuencia util: el mismo mundo, jugador e instante reconstruyen el mismo pool, que es
lo que permite afirmar algo sobre un candidato en una prueba.

### 3.7 Estados reservados y estados activos

`IDLE` y `WORKING` son los unicos que se escriben. `TRAVELING`, `UNAVAILABLE`, `RESTING` e `INJURED`
figuran en `ACTIVE_WORKER_STATUSES` y `RESERVED_WORKER_STATUSES` del servicio como vocabulario explicito,
sin ninguna ruta que los produzca (§35, §101 y §112).

---

## 4. Discrepancias detectadas

### 4.1 `make test-int`: una prueba en rojo por la implementacion del modulo `machinery`

Categoria: prueba de otro agente que una fase posterior invalida
Ficheros afectados: `backend/src/__tests__/idempotency.int.test.ts`
Propietario: W3-A (cerrado), a aplicar por la ventana de integracion

Salida real:

```
FAIL  src/__tests__/idempotency.int.test.ts > la cabecera Idempotency-Key >
      no almacena la respuesta de un fallo del servidor, de modo que el reintento sigue abierto
AssertionError: expected 404 to be 501
```

La prueba usa `POST /api/machines` como ejemplo de andamiaje que responde 501, y W5-A lo ha implementado
en esta misma fase, de modo que ahora responde 404 por granja inexistente. Es el mismo defecto que
ADR-0038 resolvio para la lista de rutas implementadas: una prueba que nombra por literal un andamiaje
concreto se rompe en cuanto ese andamiaje desaparece. El arreglo natural es elegir la ruta con
`stubRouteKeys()`, quedandose con la primera que declare `movesMoney`, o bien construir el caso con una
ruta que siga siendo andamiaje. No se toco el fichero, que es de W3-A y punto de encuentro de tres
agentes de esta fase.

Este modulo no participa: ninguna ruta del area `workers` declara `movesMoney` ni exige cabecera de
idempotencia, de modo que la prueba nunca la ejercita.

### 4.2 `make test-unit`: una prueba en rojo en el registro de paneles del cliente

Categoria: prueba de otro agente, ya declarada
Ficheros afectados: `frontend/app/components/panels/__tests__/registry.test.ts`
Propietario: W3-C (cerrado), a aplicar por W7-A

```
FAIL  app/components/panels/__tests__/registry.test.ts > los paneles registrados >
      todos montan sin error de consola
Error: Test timed out in 5000ms.
```

Es el pendiente 1 de `NOTES-w4-cierre-2.md`, ahora con otro sintoma: ya no falla por el texto "No
implementado" sino por tiempo de espera, presumiblemente porque el agente de paneles de esta fase ha
anadido paneles con mas montaje. `shared` sigue en verde con 418 pruebas. Este modulo no escribe nada en
el cliente.

### 4.3 `make lint`: seis ficheros del modulo `economy` sin formatear

Categoria: formato en ficheros de otro agente
Ficheros afectados: `backend/src/modules/economy/market.ts` y las cinco suites de
`backend/src/__tests__/economy/`
Propietario: W5-C

ESLint no da ningun hallazgo; lo unico que falla es `prettier --check`. Se deja constancia y no se
formatea, porque son ficheros de otro agente y `prettier --write` sobre ellos seria escribir fuera del
ambito asignado.

### 4.4 El disparador de despido habla antes que la restriccion `CHECK`

Categoria: observacion sobre el modelo, sin accion pendiente
Ficheros afectados: `backend/prisma/migrations/20260811205212_init/migration.sql`

`workers_termination_guard` es un `BEFORE UPDATE`, de modo que se ejecuta antes de que PostgreSQL evalue
`workers_life_check`. En la practica significa que la restriccion de la fila nunca llega a hablar mientras
la tarea siga `IN_PROGRESS`: el mensaje que llega al llamante es siempre el del disparador. No es un
defecto —las dos capas prohiben lo mismo y la de arriba es la mas fuerte, porque lee las tareas en lugar
de la columna de reserva—, pero la prueba tuvo que cerrar la tarea para poder observar la restriccion por
separado. El comentario de la migracion presenta el `CHECK` como la defensa que el disparador refuerza, y
el orden real es el inverso.

### 4.5 Los tres salarios de §102 no son reproducibles con exactitud, y no deben serlo

Categoria: desviacion de balance ya documentada
Ficheros afectados: ninguno

La recta ajustada de `shared/config/workers.ts` da 11,50, 19,15 y 30,85 frente a los 12, 18 y 31 de §102.
Las pruebas comprueban que los tres valores publicados caen dentro de la banda de ruido de su propia
habilidad, que es la unica afirmacion que la regla procedural puede sostener; reproducirlos exactamente
exigiria una tabla en lugar de una recta y §102 pide explicitamente generacion procedural. Los 30 $/h de
§36 y los 15 $/h de §117 siguen sin ser reproducibles, como ya declara la seccion 2.2 del plan y el
encabezado del propio catalogo. Corresponde al informe de balance de W6-E y W7-D.

### 4.6 Las pruebas unitarias del backend siguen sin entrar en ninguna puerta

Categoria: pendiente ya declarado, ahora con mas superficie
Ficheros afectados: `Makefile`, objetivo `test-unit`
Propietario: W7-A

`backend/src/__tests__/workers/pool.test.ts` son 13 pruebas puras que ningun `make` ejecuta, porque
`test-unit` solo recorre `shared` y el cliente. Es el apartado 5 de `NOTES-w4-cierre.md` y el apartado 4
de `NOTES-w4-cierre-2.md`, y esta fase lo agrava. Mitigacion aplicada mientras tanto: la banda de §102 se
comprueba una segunda vez en `hiring.int.test.ts`, sobre el pool que el servidor escribio de verdad, de
modo que la regla si esta cubierta por `make test-int`.

### 4.7 Jugador de verificacion dejado en la base de datos de desarrollo

Categoria: dato de desarrollo, sin accion obligada
Ficheros afectados: ninguno

La verificacion por HTTP registro un jugador `w5b-http-<epoch>@test.invalid` en el mundo de desarrollo,
con dos granjas, una vivienda y dieciseis celdas compradas en el origen de ese jugador. No se borro
porque `world_cells.ownerPlayerId` tiene `onDelete: Restrict` y limpiarlo exigiria borrar celdas del
mundo compartido mientras otros agentes de la fase trabajan. Es equivalente a lo que deja una
comprobacion manual en el navegador. Si molesta, se retira con `make reset` y `make seed` en la ventana
de integracion.

---

## 5. Lo que W6-A puede consumir de este modulo

`modules/tasks` pertenece a una fase posterior y puede importar `modules/workers`. Lo que necesita esta
exportado desde `backend/src/modules/workers/index.ts` y no hay que reimplementarlo:

| Funcion | Regla |
|---|---|
| `requireWorker(db, playerId, workerId)` | Existencia y propiedad, con 404 y 403 separados |
| `requireIdleWorker(worker)` | Paso 1 de la secuencia de §104, comprobando estado y columna de reserva |
| `requireWorkerOfFarm(worker, farmId)` y `canOperateFarmMachinery` | §108: un trabajador no opera maquinaria de otra granja. El disparador `task_machines_farm_guard` es la red de seguridad |
| `reserveWorkerForTask(tx, workerId, taskId)` | Reserva por actualizacion condicional; devuelve `false` si otro la gano, para que el llamante ordene sus rechazos |
| `releaseWorkerFromTask(tx, workerId, taskId)` | Liberacion al completar o cancelar (§105, §106) |
| `applyTaskCompletion(tx, worker, taskId)` | Progresion de habilidad con techo mas contador, y liberacion en la misma sentencia (§103, §105, §110) |
| `accruedWages(worker, window)` | La integral del intervalo de vigencia, para un panel o un informe |
| `loadFarmWorkers(db, farmId)` | El conjunto entre el que elige una asignacion |

Advertencia sobre `applyTaskCompletion`: incrementa `completedTaskCount` siempre y libera al trabajador
solo si la tarea que se le pasa es la que tenia reservada. Una cancelacion no debe llamarla, porque §105
situa el incremento al completar; para cancelar, `releaseWorkerFromTask`.

## Resuelto

Las notas de esta fase viven en el apartado «Discrepancias detectadas». Estas dos las aplico W7-A en la
ventana de integracion, y se recogen aqui con su numeracion original.

### 4.6 Las pruebas unitarias del backend siguen sin entrar en ninguna puerta

Aplicado por W7-A (integracion). El objetivo `test-unit` del `Makefile` recorre `shared`, `backend` y
`frontend`, y las 82 pruebas en 6 ficheros que ninguna puerta ejecutaba entran ya en `make verify`.

### 4.7 Jugador de verificacion dejado en la base de datos de desarrollo

Aplicado por W7-A (integracion). La base de desarrollo queda con el mundo de semilla 20260811 y el
jugador de la semilla. El jugador `w5b-http-...` y sus dieciseis celdas se borraron con el resto de los
restos de verificacion de W3, W4, W5 y W6, en el orden que imponen las restricciones `onDelete: Restrict`.
